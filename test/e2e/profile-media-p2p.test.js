// Profil görselleri sunucuya hiç gitmez: iki gerçek istemci (çevrimdışı test
// modu, Supabase oturumu yok). A gerçek dosya seçicisiyle avatar + arka plan
// seçer → B (arkadaşı) baytları P2P alır, blob: adresinden çizer ve önbellekteki
// baytların SHA-256'sı A'nın tanımlayıcısıyla aynıdır. A avatarı değiştirir →
// B güncellenir. Büyük GIF özel mesajla reddedilir. A kapalıyken B yeniden
// açılır → A'nın resmi önbellekten görünür. Baştan sona CDP ile ağ istekleri
// izlenir: /storage/v1/ isteği yok, hiçbir istek gövdesinde resim verisi yok.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const {
  launch, getPageTarget, cdp, spawnPeer, cleanupPeer, evalJS, waitFor,
  createRoom, joinRoom, waitForPeerConnected, waitForShell, makeFriends,
} = require('./lib/harness');

// ---------- Küçük PNG üretici (yalnız zlib) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, fn) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x, y);
      const o = y * (w * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const SHOTS = process.env.PMEDIA_SHOTS_DIR || '';
async function shot(peer, name) {
  if (!SHOTS) return;
  const r = await peer.client.send('Page.captureScreenshot', { format: 'png' });
  if (r.result && r.result.data) fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(r.result.data, 'base64'));
}

// CDP ağ gözcüsü: her istek URL'si ve gövdesi kaydedilir.
function watchNetwork(peer, sink, label) {
  peer.client.ws.addEventListener('message', ev => {
    let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (msg.method === 'Network.requestWillBeSent') {
      const req = msg.params.request || {};
      sink.push({ peer: label, url: req.url || '', body: req.postData || '', method: req.method });
    }
  });
  return peer.client.send('Network.enable', { maxPostDataSize: 4 * 1024 * 1024 });
}

async function setFile(peer, selector, file) {
  const doc = await peer.client.send('DOM.getDocument', { depth: -1, pierce: true });
  const q = await peer.client.send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector });
  assert.ok(q.result && q.result.nodeId, 'dosya girişi yok: ' + selector);
  const r = await peer.client.send('DOM.setFileInputFiles', { nodeId: q.result.nodeId, files: [file] });
  assert.ok(!r.error, 'setFileInputFiles: ' + JSON.stringify(r.error));
}

const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');

// B'nin yerel önbelleğindeki baytların SHA-256'sı (sayfada hesaplanır).
const cachedHashExpr = ref => `(async () => {
  const r = TSProfileMedia.parse(${JSON.stringify(ref)});
  const rec = r && await TSProfileMedia._idbGet(r.h);
  if (!rec) return null;
  return TSProfileMedia._sha256Hex(new Uint8Array(await rec.blob.arrayBuffer()));
})()`;

module.exports = async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pmedia-'));
  const files = {
    avatar1: path.join(tmp, 'avatar-red.png'),
    avatar2: path.join(tmp, 'avatar-blue.png'),
    banner: path.join(tmp, 'banner.png'),
    bigGif: path.join(tmp, 'big.gif'),
    text: path.join(tmp, 'not-image.png'),
  };
  fs.writeFileSync(files.avatar1, png(320, 240, (x, y) => [220, (x * 255 / 320) | 0, (y * 255 / 240) | 0]));
  fs.writeFileSync(files.avatar2, png(300, 300, (x, y) => [(y * 255 / 300) | 0, 60, 230]));
  fs.writeFileSync(files.banner, png(900, 300, (x, y) => [40, (x * 255 / 900) | 0, 120 + ((y * 100 / 300) | 0)]));
  // 1.2 MB "GIF": imzası GIF, boyutu sınırın üstünde → boyut mesajı
  const gif = Buffer.alloc(1200 * 1024, 0x21); Buffer.from('GIF89a').copy(gif, 0);
  fs.writeFileSync(files.bigGif, gif);
  fs.writeFileSync(files.text, 'bu bir resim degil, sadece metin dosyasi');

  const net = [];
  let a = await spawnPeer({ port: 9481, name: 'Medya A' });
  let b = await spawnPeer({ port: 9482, name: 'Medya B' });
  let bRestarted = null;
  try {
    await watchNetwork(a, net, 'A');
    await watchNetwork(b, net, 'B');
    await waitForShell(a);
    await waitForShell(b);
    const { fa } = await makeFriends(a, b);
    const q = JSON.stringify(fa);
    await waitFor(b.client, `!!(state.friends[${q}] && state.friends[${q}].online)`, 25000, 'B sees A online');

    // 1) A: Ayarlar > Profil, gerçek dosya girişiyle avatar
    await evalJS(a.client, `window.openUserSettings('profile'); 1`);
    await waitFor(a.client, `!!document.querySelector('#settings-profile-root [data-pe-file="avatar"]')`, 10000, 'profile editor');
    const note = await evalJS(a.client, `document.querySelector('[data-pe-local-note]')?.textContent || ''`);
    assert.ok(/yalnızca bu cihazda|only on this device/i.test(note), 'yerel saklama notu yok: ' + note);

    // Desteklenmeyen tür (uzantısı .png ama içerik metin) → imza denetimi
    await setFile(a, '#settings-profile-root [data-pe-file="avatar"]', files.text);
    await waitFor(a.client, `document.querySelector('[data-pe-msg="avatar"].is-error:not(.hidden)')?.textContent || ''`, 10000, 'type error shown');

    await setFile(a, '#settings-profile-root [data-pe-file="avatar"]', files.avatar1);
    const ref1 = await waitFor(a.client, `TSProfileMedia.isRef(state.myAvatar) ? state.myAvatar : null`, 15000, 'A avatar ref');
    const r1 = await evalJS(a.client, `JSON.stringify(TSProfileMedia.parse(${JSON.stringify(ref1)}))`).then(JSON.parse);
    assert.strictEqual(r1.fid, fa);
    assert.ok(r1.s > 0 && r1.s <= 60 * 1024 * 1.2, 'avatar çok büyük: ' + r1.s);
    assert.strictEqual(await evalJS(a.client, cachedHashExpr(ref1), true), r1.h, 'A depo özeti');

    // B: arkadaş listesinde blob: adresli, çözülmüş resim
    await waitFor(b.client, `state.friends[${q}].avatar === ${JSON.stringify(ref1)}`, 30000, 'B adopts A avatar');
    assert.strictEqual(await evalJS(b.client, cachedHashExpr(ref1), true), r1.h, 'B önbellek özeti A tanımlayıcısıyla aynı değil');
    await evalJS(b.client, `TSShell.setView('friends'); renderFriends(); 1`);
    const imgInfo = await waitFor(b.client, `(() => {
      const imgs = [...document.querySelectorAll('img')].filter(i => i.src.startsWith('blob:') && i.complete && i.naturalWidth > 0 && i.offsetParent);
      return imgs.length ? JSON.stringify({ n: imgs.length, w: imgs[0].naturalWidth, src: imgs[0].src }) : null;
    })()`, 15000, 'B renders A avatar from blob').then(JSON.parse);
    assert.ok(imgInfo.w === 256, 'avatar 256 px olmalı: ' + imgInfo.w);

    // 2) Arka plan: dosya seç → Kaydet
    await setFile(a, '#settings-profile-root [data-pe-file="banner"]', files.banner);
    await waitFor(a.client, `!!document.querySelector('[data-pe="save"]') && !document.querySelector('[data-pe-savebar]').classList.contains('hidden')`, 15000, 'banner draft dirty');
    await evalJS(a.client, `document.querySelector('[data-pe="save"]').click(); 1`);
    const bannerRef = await waitFor(a.client, `TSProfileMedia.isRef(TSProfile.mine().bannerUrl) ? TSProfile.mine().bannerUrl : null`, 10000, 'A banner ref');
    const rb = await evalJS(a.client, `JSON.stringify(TSProfileMedia.parse(${JSON.stringify(bannerRef)}))`).then(JSON.parse);
    assert.ok(rb.s <= 300 * 1024 * 1.2, 'banner çok büyük: ' + rb.s);
    await waitFor(b.client, `TSProfile.profileOf(${q})?.bannerUrl === ${JSON.stringify(bannerRef)}`, 30000, 'B gets banner ref');
    await evalJS(b.client, `TSProfile.showCard({ friendId: ${q} }); 1`);
    await waitFor(b.client, `TSProfileMedia.src(${JSON.stringify(bannerRef)}).startsWith('blob:')`, 30000, 'B fetched banner');
    assert.strictEqual(await evalJS(b.client, cachedHashExpr(bannerRef), true), rb.h, 'B banner özeti');
    await waitFor(b.client, `/url\\("?blob:/.test(document.querySelector('.ts-profile-pop .pc-banner')?.style.backgroundImage || '')`, 10000, 'card banner uses blob');
    const bannerSize = await evalJS(b.client, `new Promise(res => { const i = new Image(); i.onload = () => res(i.naturalWidth + 'x' + i.naturalHeight); i.onerror = () => res('err'); i.src = TSProfileMedia.src(${JSON.stringify(bannerRef)}); })`, true);
    assert.strictEqual(bannerSize, '900x300', 'banner boyutu: ' + bannerSize);
    await shot(b, 'b-profile-card');
    await evalJS(b.client, `TSUI.closePopover && TSUI.closePopover(); 1`);

    // 3) Büyük GIF → özel boyut mesajı (sınır + dosya boyutu)
    await setFile(a, '#settings-profile-root [data-pe-file="gif"]', files.bigGif);
    const gifMsg = await waitFor(a.client, `document.querySelector('[data-pe-msg="gif"].is-error:not(.hidden)')?.textContent || ''`, 10000, 'gif size error');
    assert.ok(/1 MB/.test(gifMsg) && /1\.2 MB/.test(gifMsg), 'GIF mesajı sınırı/boyutu söylemiyor: ' + gifMsg);
    assert.ok(!/supabase|sql/i.test(gifMsg), 'mesajda Supabase/SQL geçiyor');
    await evalJS(a.client, `document.querySelector('[data-pe-msg="gif"]').scrollIntoView({ block: 'center' }); 1`);
    await shot(a, 'a-profile-editor-error');

    // 4) A avatarı değiştirir → B güncellenir
    await setFile(a, '#settings-profile-root [data-pe-file="avatar"]', files.avatar2);
    const ref2 = await waitFor(a.client, `TSProfileMedia.isRef(state.myAvatar) && state.myAvatar !== ${JSON.stringify(ref1)} ? state.myAvatar : null`, 15000, 'A avatar 2');
    const r2 = await evalJS(a.client, `JSON.stringify(TSProfileMedia.parse(${JSON.stringify(ref2)}))`).then(JSON.parse);
    await waitFor(b.client, `state.friends[${q}].avatar === ${JSON.stringify(ref2)}`, 30000, 'B adopts A avatar 2');
    assert.strictEqual(await evalJS(b.client, cachedHashExpr(ref2), true), r2.h);
    const url2 = await evalJS(b.client, `TSProfileMedia.src(${JSON.stringify(ref2)})`);
    await waitFor(b.client, `[...document.querySelectorAll('#friends-list img, .ts-av img')].some(i => i.src === ${JSON.stringify(url2)} && i.naturalWidth > 0)`, 15000, 'B list shows avatar 2');
    await shot(b, 'b-friends-list');

    // Eski alanlar: presence `avatar` (eski kova adresi) yok, sunucuya gidecek avatar null
    const pres = await evalJS(a.client, `JSON.stringify({ f: TSProfileMedia.presenceFields(), s: TSProfileMedia.serverAvatar() })`).then(JSON.parse);
    assert.strictEqual(pres.f.avr, ref2);
    assert.ok(!pres.f.avatar, 'eski adres alanı dolu');
    assert.strictEqual(pres.s, null);
    // Koruma: profiles satırına resim verisi yazılamaz
    const guarded = await evalJS(a.client, `JSON.stringify(serverSafeProfileRow({ avatar: 'data:image/png;base64,AAAA', friends: { X: { name: 'x', avatar: 'data:image/jpeg;base64,BBBB' } }, name: 'ok' }))`).then(JSON.parse);
    assert.strictEqual(guarded.avatar, null);
    assert.strictEqual(guarded.friends.X.avatar, null);
    assert.strictEqual(guarded.name, 'ok');

    // 5) DM başlığı ve arama kutucuğu yeni avatarı gösterir
    await evalJS(b.client, `openDM(${q}); 1`);
    await waitFor(b.client, `[...document.querySelectorAll('img')].some(i => i.src === ${JSON.stringify(url2)} && i.offsetParent && i.closest('#view-dm, .dm-head, .dmx-head, [class*="dm"]'))`, 10000, 'DM header avatar');
    await shot(b, 'b-dm-header');
    const roomId = await createRoom(a);
    await joinRoom(b, roomId);
    await waitForPeerConnected(b, 60000);
    await waitFor(b.client, `[...document.querySelectorAll('#grid .ptile[data-tile-uid]')].some(t => t.dataset.tileUid !== 'self' && [...t.querySelectorAll('img')].some(i => i.src === ${JSON.stringify(url2)} && i.naturalWidth > 0))`, 25000, 'B call tile shows A avatar');
    await shot(b, 'b-call-tile');

    // 6) A kapanır; B yeniden açılır → A'nın resmi önbellekten
    cleanupPeer(a);
    a = null;
    await waitFor(b.client, `!state.friends[${q}].online`, 30000, 'A offline');
    try { b.proc.kill(); } catch (e) {}
    await new Promise(r => setTimeout(r, 4000));
    const proc = launch(9482, b.userDataDir);
    const page = await getPageTarget(9482, 40000);
    const client = cdp(page.webSocketDebuggerUrl);
    await client.ready;
    await client.send('Runtime.enable');
    bRestarted = { client, proc, userDataDir: b.userDataDir, port: 9482, name: b.name };
    b = bRestarted;
    await watchNetwork(b, net, 'B2');
    await waitFor(b.client, `document.readyState === 'complete'`, 40000, 'B2 load');
    await new Promise(r => setTimeout(r, 2500));
    await waitFor(b.client, `(() => {
      if (document.body.classList.contains('shell-active')) return true;
      const row = document.querySelector('#accounts-list .account-row');
      if (row) row.click();
      return false;
    })()`, 30000, 'B2 logged in');
    assert.strictEqual(await evalJS(b.client, `state.friends[${q}].avatar`), ref2, 'B2 kalıcı tanımlayıcı');
    await evalJS(b.client, `TSShell.setView('friends'); renderFriends(); 1`);
    await waitFor(b.client, `TSProfileMedia.src(${JSON.stringify(ref2)}).startsWith('blob:') && [...document.querySelectorAll('img')].some(i => i.src.startsWith('blob:') && i.naturalWidth > 0 && i.offsetParent)`, 20000, 'B2 renders cached avatar while A offline');
    assert.strictEqual(await evalJS(b.client, `!!state.friends[${q}].online`), false, 'A çevrimdışı olmalı');
    await shot(b, 'b-restart-offline');

    // 7) Ağ: Supabase Storage'a istek yok, hiçbir gövdede resim verisi yok
    const storage = net.filter(r => /\/storage\/v1\//.test(r.url));
    assert.deepStrictEqual(storage, [], 'Storage isteği: ' + JSON.stringify(storage.slice(0, 3)));
    const IMG_SIG = /data:image\/|iVBORw0KGgo|\/9j\/4|R0lGOD|UklGR/;
    const withImg = net.filter(r => (r.body && (IMG_SIG.test(r.body) || r.body.length > 32 * 1024)));
    assert.deepStrictEqual(withImg.map(r => r.url), [], 'resim verisi taşıyan istek');
    const supa = net.filter(r => /supabase\.co/.test(r.url));
    assert.deepStrictEqual(supa.map(r => r.url), [], 'çevrimdışı modda Supabase isteği');
    console.log(`profile-media-p2p: ${net.length} HTTP isteği izlendi; storage=0, resimli gövde=0`);
  } finally {
    if (a) cleanupPeer(a);
    if (b) cleanupPeer(b);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
};
