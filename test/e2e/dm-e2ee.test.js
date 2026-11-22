const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const CryptoJS = require('crypto-js');
const {
  APP_DIR, spawnPeer, cleanupPeer, evalJS, waitFor, makeFriends,
} = require('./lib/harness');

// Uçtan uca şifreli kişisel olaylar (js/space/dm-e2ee.js, v2 zarf).
//  1) A↔B: DM metni, dosya (2 parça), yazıyor, tepki, arama daveti + reddi
//     v2 gider. Ham MQTT yükleri test sürecindeki ayrı bir abone (B'nin
//     kimliğini bilen "üçüncü taraf") ile okunur: düz JSON yok, açık içerik
//     yok, konudaki kimlikle (eski CryptoJS yöntemi) çözülemez.
//  2) Yakalanmış bir v2 mesajı yeniden yayınlanınca reddedilir (replay).
//  3) Anahtarlar bilindikten sonra "A'dan" gelen şifresiz DM reddedilir
//     (düşürme saldırısı).
//  4) Eski sürüm (O, yalnızca cihaz anahtarı) ile eski yola (düz JSON)
//     düşülür ve DM "şifresiz" işaretlenir.
//  5) B'nin anahtarı değişince A'da uyarı (DM başlığı + Kişiler) çıkar;
//     kabul edilince yeniden v2.
// TEAMSYNC_SHOTS=<klasör> verilirse ekran görüntüleri oraya yazılır.
const SHOTS = process.env.TEAMSYNC_SHOTS || '';
const BROKER = 'wss://broker.emqx.io:8084/mqtt';
const rnd = () => Math.random().toString(36).slice(2, 10);

async function shot(peer, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await new Promise(r => setTimeout(r, 300));
  const res = await peer.client.send('Page.captureScreenshot', { format: 'png' });
  if (res.result && res.result.data) fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(res.result.data, 'base64'));
}
const clearToasts = peer => evalJS(peer.client, `(() => { const c = document.getElementById('toast-container'); if (c) c.innerHTML = ''; return 1; })()`);

// Uygulamanın kendi mqtt.js paketi (Node'un yerel WebSocket'iyle) — gözlemci.
function rawClient() {
  if (!global.__tsMqtt) {
    vm.runInThisContext(fs.readFileSync(path.join(APP_DIR, 'vendor', 'mqtt.min.js'), 'utf8') + '\n;globalThis.__tsMqtt = mqtt;');
  }
  const c = global.__tsMqtt.connect(BROKER, { clientId: 'ts-e2e-obs-' + rnd(), reconnectPeriod: 2000, connectTimeout: 10000, forceNativeWebSocket: true });
  const seen = [];
  c.on('message', (topic, msg) => seen.push({ topic, s: msg.toString(), at: Date.now() }));
  const ready = new Promise((resolve, reject) => {
    c.once('connect', resolve);
    setTimeout(() => reject(new Error('gözlemci bağlanamadı')), 15000);
  });
  return { c, seen, ready, sub: t => new Promise(r => c.subscribe(t, { qos: 1 }, r)), pub: (t, s) => new Promise(r => c.publish(t, s, { qos: 1 }, r)) };
}

const stats = peer => evalJS(peer.client, `TSE2E.stats()`);

module.exports = async function run() {
  const peers = [];
  const obs = rawClient();
  try {
    const a = await spawnPeer({ port: 9621, name: 'Ayşe' }); peers.push(a);
    const b = await spawnPeer({ port: 9622, name: 'Bora' }); peers.push(b);
    for (const p of [a, b]) {
      await p.client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await evalJS(p.client, `applyUserLanguage('tr'); applyUserTheme('aurora'); 1`);
    }
    const { fa, fb } = await makeFriends(a, b);
    await obs.ready;
    await obs.sub(`teamsync/user/${fb}/events`);
    await obs.sub(`teamsync/user/${fa}/events`);

    // ---- Anahtar dağıtımı: presence `ak` → iki taraf da v2'ye geçer.
    await waitFor(a.client, `!!TSCrypto.accountKeysSync() && TSE2E.canEncryptTo(${JSON.stringify(fb)})`, 40000, 'A → B v2');
    await waitFor(b.client, `!!TSCrypto.accountKeysSync() && TSE2E.canEncryptTo(${JSON.stringify(fa)})`, 40000, 'B → A v2');
    // Bekleyen eski profil alışverişleri bitsin; bundan sonraki her kişisel olay v2 olmalı.
    await new Promise(r => setTimeout(r, 6000));
    const start = obs.seen.length;

    // ---- 1) DM metni
    const SECRET = 'gizli-mesaj-' + rnd();
    await evalJS(a.client, `TSShell.setView('dm', ${JSON.stringify(fb)}); 1`);
    await evalJS(a.client, `sendDMText(${JSON.stringify(SECRET)}).then(() => 1)`, true);
    await waitFor(b.client, `(state.dms[${JSON.stringify(fa)}] || []).some(m => m.content === ${JSON.stringify(SECRET)})`, 30000, 'B metni aldı');
    const bMsg = await evalJS(b.client, `(state.dms[${JSON.stringify(fa)}] || []).find(m => m.content === ${JSON.stringify(SECRET)})`);
    assert.ok(!bMsg.plain, 'v2 ile gelen mesaj şifresiz işaretlenmemeli');
    const aMsg = await evalJS(a.client, `(state.dms[${JSON.stringify(fb)}] || []).find(m => m.content === ${JSON.stringify(SECRET)})`);
    assert.ok(!aMsg.plain, 'v2 ile giden mesaj şifresiz işaretlenmemeli');
    await waitFor(a.client, `!(state.dms[${JSON.stringify(fb)}] || []).find(m => m.content === ${JSON.stringify(SECRET)}).pending`, 20000, 'onay (dm_ack) A\'ya döndü');

    // ---- dosya (2 parça, base64 ~ 80 KB)
    const FILE_MARK = 'DOSYAICERIGI' + rnd().toUpperCase();
    await evalJS(a.client, `(async () => {
      const head = new TextEncoder().encode(${JSON.stringify(FILE_MARK)});
      const body = new Uint8Array(60000); for (let i = 0; i < body.length; i++) body[i] = (i * 31 + 7) & 255;
      const f = new File([head, body], 'rapor.bin', { type: 'application/octet-stream' });
      return sendDMFile(f);
    })()`, true);
    await waitFor(b.client, `(state.dms[${JSON.stringify(fa)}] || []).some(m => m.type === 'file' && m.fileName === 'rapor.bin' && m.content.length > 80000)`, 40000, 'B dosyayı aldı');
    const fileB64 = await evalJS(b.client, `(state.dms[${JSON.stringify(fa)}] || []).find(m => m.fileName === 'rapor.bin').content`);
    assert.ok(fileB64.startsWith('data:application/octet-stream;base64,'), 'dosya içeriği');
    assert.strictEqual(Buffer.from(fileB64.split(',')[1], 'base64').slice(0, FILE_MARK.length).toString(), FILE_MARK, 'dosya baytları bozulmadan geldi');
    assert.ok(!(await evalJS(b.client, `!!(state.dms[${JSON.stringify(fa)}] || []).find(m => m.fileName === 'rapor.bin').plain`)), 'dosya v2');

    // ---- yazıyor
    await evalJS(a.client, `(() => { const i = document.getElementById('dm-input'); i.value = 'yazıyorum'; i.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
    await waitFor(b.client, `!!TSTyping.text('dm:' + ${JSON.stringify(fa)})`, 15000, 'B yazıyor gördü');
    await evalJS(a.client, `document.getElementById('dm-input').value = ''; 1`);

    // ---- tepki (B, A'nın mesajına)
    const mid = bMsg.id;
    await evalJS(b.client, `TSDMX.toggle(${JSON.stringify(fa)}, ${JSON.stringify(mid)}, '👍'); 1`);
    await waitFor(a.client, `(() => { const m = (state.dms[${JSON.stringify(fb)}] || []).find(x => x.id === ${JSON.stringify(mid)}); return !!(m && m.reactions && (m.reactions['👍'] || []).includes('them')); })()`, 20000, 'A tepkiyi aldı');

    // ---- arama daveti → zil → reddet (call_decline v2)
    await evalJS(a.client, `TSDirectCall.call(${JSON.stringify(fb)}).then(() => 1)`, true);
    await waitFor(b.client, `!!document.querySelector('.dc-ring')`, 30000, 'B çalıyor');
    await evalJS(b.client, `(() => { const r = document.querySelector('.dc-ring'); const btn = r.querySelector('[data-dc="decline"], .dc-decline, button.danger, button:last-of-type'); btn.click(); return 1; })()`);
    await waitFor(a.client, `!TSDirectCall.outgoing() || !state.room`, 30000, 'A ret aldı');
    await evalJS(a.client, `(state.room && disconnectApp(), 1)`);
    await new Promise(r => setTimeout(r, 3000));

    // ---- ham yükler: hepsi v2, düz metin yok, eski sarmal yok
    const raw = obs.seen.slice(start).filter(x => x.topic === `teamsync/user/${fb}/events` || x.topic === `teamsync/user/${fa}/events`);
    console.log(`    ham kişisel olay: ${raw.length}`);
    assert.ok(raw.length >= 8, 'yeterli ham olay yakalanmalı: ' + raw.length);
    const legacy = raw.filter(x => !x.s.startsWith('TS2E:'));
    assert.deepStrictEqual(legacy.map(x => x.s.slice(0, 60)), [], 'v2 olmayan kişisel olay');
    const all = raw.map(x => x.s).join('\n');
    for (const needle of [SECRET, FILE_MARK, Buffer.from(FILE_MARK).toString('base64').slice(0, 12), 'dm_msg', 'dm_typing', 'dm_react', 'server_invite_received', 'call_decline', 'rapor.bin', '"Ayşe"', '"Bora"', '"type"', '"fromId"']) {
      assert.ok(!all.includes(needle), 'ham yükte açık içerik: ' + needle);
    }
    for (const x of raw) {
      const env = JSON.parse(x.s.slice(5));
      assert.ok(env.v === 1 && /^[A-Za-z0-9+/=]+$/.test(env.c) && env.n && env.sk && env.rk, 'zarf alanları');
      // B'nin (alıcının) kimliğini bilen üçüncü taraf: eski yöntemle (anahtar = konu) çözemez.
      const fid = x.topic.split('/')[2];
      let plain = '';
      try { plain = CryptoJS.AES.decrypt(env.c, fid).toString(CryptoJS.enc.Utf8); } catch (e) { plain = ''; }
      assert.ok(!plain.includes('"type"'), 'üçüncü taraf çözebildi');
    }

    // ---- 2) yeniden oynatma
    const bBefore = await stats(b);
    const dmCount = await evalJS(b.client, `(state.dms[${JSON.stringify(fa)}] || []).length`);
    const toB = raw.filter(x => x.topic === `teamsync/user/${fb}/events`);
    for (const x of toB) { await obs.pub(x.topic, x.s); await new Promise(r => setTimeout(r, 250)); }
    await waitFor(b.client, `TSE2E.stats().replay >= ${bBefore.replay + toB.length}`, 20000, 'replay reddi');
    assert.strictEqual(await evalJS(b.client, `(state.dms[${JSON.stringify(fa)}] || []).length`), dmCount, 'tekrar oynatılan mesaj eklenmemeli');

    // ---- 3) düşürme: A adına şifresiz ve eski sarmallı DM
    const FAKE = 'sahte-' + rnd();
    const fakeJson = JSON.stringify({ type: 'dm_msg', fromId: fa, fromName: 'Ayşe', msgType: 'text', content: FAKE, mid: 'f0' + rnd() + rnd() });
    await new Promise(r => setTimeout(r, 1500));
    await obs.pub(`teamsync/user/${fb}/events`, fakeJson);
    try {
      await waitFor(b.client, `TSE2E.stats().downgrade >= ${bBefore.downgrade + 1}`, 20000, 'düşürme reddi (şifresiz)');
    } catch (e) {
      console.log('    B istatistik:', JSON.stringify(await stats(b)), 'önce:', JSON.stringify(bBefore));
      throw e;
    }
    // Eski CryptoJS "E2EE:" sarmalı: uygulamada hiç çalışmamış (mqtt.connect salt
    // okunur, bkz. renderer.js başı) — böyle bir yük ayrıştırılamaz ve düşer.
    await new Promise(r => setTimeout(r, 1500));
    await obs.pub(`teamsync/user/${fb}/events`, 'E2EE:' + CryptoJS.AES.encrypt(fakeJson.replace(FAKE, FAKE + '2'), fb).toString());
    await new Promise(r => setTimeout(r, 3000));
    console.log('    eski CryptoJS katmanı etkin mi:', await evalJS(b.client, `(() => { const d = Object.getOwnPropertyDescriptor(mqtt, 'connect'); return !!(d && (d.writable || d.set)); })()`));
    assert.ok(!(await evalJS(b.client, `(state.dms[${JSON.stringify(fa)}] || []).some(m => String(m.content).includes(${JSON.stringify(FAKE)}))`)), 'sahte DM görünmemeli');

    // Ekran: DM başlığında kilit, profil kartında güvenlik kodu.
    await clearToasts(a);
    await evalJS(a.client, `TSShell.setView('dm', ${JSON.stringify(fb)}); 1`);
    await waitFor(a.client, `!!document.querySelector('#dmh-who .dmh-e2e.is-on')`, 10000, 'kilit rozeti');
    assert.ok((await evalJS(a.client, `document.querySelector('#dmh-who .dmh-e2e').textContent`)).includes('Uçtan uca şifreli'));
    await shot(a, 'e2e-dm-header-lock');
    await evalJS(a.client, `(() => { const t = document.getElementById('dmh-profile-toggle'); if (!document.getElementById('view-dm').classList.contains('panel-open')) t.click(); return 1; })()`);
    await waitFor(a.client, `/^\\d{4} \\d{4} \\d{4}$/.test((document.querySelector('#dm-profile-panel .pc-safety-code') || {}).textContent || '')`, 10000, 'güvenlik kodu');
    const codeA = await evalJS(a.client, `document.querySelector('#dm-profile-panel .pc-safety-code').textContent`);
    const codeB = await evalJS(b.client, `TSE2E.safetyCode(${JSON.stringify(fa)})`, true);
    assert.strictEqual(codeA, codeB, 'iki tarafın güvenlik kodu aynı');
    await shot(a, 'e2e-profile-safety-code');
    await evalJS(a.client, `document.getElementById('dmh-profile-toggle').click(); 1`);

    // ---- 5) B'nin anahtarı değişir → A'da uyarı
    await evalJS(b.client, `window.electronAPI.accountIdentity(${JSON.stringify(fb)}, 'delete').then(() => TSCrypto._test.reload())`, true);
    const newIk = await evalJS(b.client, `TSCrypto.accountKeysSync().ik`);
    await waitFor(a.client, `(() => { const p = TSCrypto.peerKeys(${JSON.stringify(fb)}); return !!(p && p.pend && p.pend.ik === ${JSON.stringify(newIk)}); })()`, 30000, 'A yeni anahtarı bekleyen değişiklik olarak gördü');
    assert.strictEqual(await evalJS(a.client, `TSE2E.status(${JSON.stringify(fb)}).mode`), 'changed');
    await clearToasts(a);
    await waitFor(a.client, `!!document.getElementById('dm-keywarn') && document.getElementById('dm-keywarn').textContent.includes('Bora adlı kişinin güvenlik anahtarı değişti')`, 10000, 'uyarı şeridi');
    await shot(a, 'e2e-key-change-warning');
    await evalJS(a.client, `TSShell.setView('friends'); 1`);
    await waitFor(a.client, `!!document.querySelector('#friends-list .friend-item[data-fid="${fb}"] .friend-key-tag')`, 10000, 'Kişiler rozeti');
    await shot(a, 'e2e-key-change-people');
    // Kabul → yeni anahtarla v2
    await evalJS(a.client, `TSE2E.accept(${JSON.stringify(fb)}) ? 1 : 0`);
    assert.strictEqual(await evalJS(a.client, `TSE2E.status(${JSON.stringify(fb)}).mode`), 'e2ee');
    const AFTER = 'yeni-anahtar-' + rnd();
    await evalJS(a.client, `TSShell.setView('dm', ${JSON.stringify(fb)}); sendDMText(${JSON.stringify(AFTER)}).then(() => 1)`, true);
    await waitFor(b.client, `(state.dms[${JSON.stringify(fa)}] || []).some(m => m.content === ${JSON.stringify(AFTER)} && !m.plain)`, 30000, 'kabulden sonra v2');

    // ---- 4) eski sürüm arkadaş (O): eski sarmal + "şifresiz" işareti
    cleanupPeer(b); peers.splice(peers.indexOf(b), 1);
    const o = await spawnPeer({ port: 9623, name: 'Orhan' }); peers.push(o);
    await o.client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await evalJS(o.client, `applyUserLanguage('tr'); 1`);
    await waitFor(o.client, `!!state.friendId && !!state.globalMqtt && state.globalMqtt.connected`, 30000, 'O bağlı');
    await evalJS(o.client, `TSCrypto._test.deviceOnly(true).then(() => window.electronAPI.accountIdentity(state.friendId, 'delete')).then(() => 1)`, true);
    assert.strictEqual(await evalJS(o.client, `TSCrypto.accountKeysSync()`), null, 'O eski sürüm gibi: hesap anahtarı yok');
    const { fb: fo } = await makeFriends(a, o);
    await obs.sub(`teamsync/user/${fo}/events`);
    await new Promise(r => setTimeout(r, 4000));
    assert.strictEqual(await evalJS(a.client, `TSE2E.canEncryptTo(${JSON.stringify(fo)})`), false, 'O için v2 yok');
    const OLD = 'eski-surume-' + rnd();
    const oStart = obs.seen.length;
    await evalJS(a.client, `TSShell.setView('dm', ${JSON.stringify(fo)}); sendDMText(${JSON.stringify(OLD)}).then(() => 1)`, true);
    await waitFor(o.client, `(state.dms[${JSON.stringify(fa)}] || []).some(m => m.content === ${JSON.stringify(OLD)} && m.plain)`, 30000, 'O eski sarmalla aldı');
    const REPLY = 'eski-yanit-' + rnd();
    await evalJS(o.client, `state.activeDM = ${JSON.stringify(fa)}; sendDMText(${JSON.stringify(REPLY)}).then(() => 1)`, true);
    await waitFor(a.client, `(state.dms[${JSON.stringify(fo)}] || []).some(m => m.content === ${JSON.stringify(REPLY)} && m.plain)`, 30000, 'A eski sürümden aldı (şifresiz işaretli)');
    assert.ok(await evalJS(a.client, `!!(state.dms[${JSON.stringify(fo)}] || []).find(m => m.content === ${JSON.stringify(OLD)}).plain`), 'giden mesaj şifresiz işaretli');
    const oRaw = obs.seen.slice(oStart).filter(x => x.topic === `teamsync/user/${fo}/events`);
    // Eski yol = düz JSON (bu yüzden "şifresiz" işaretleniyor).
    assert.ok(oRaw.some(x => x.s.startsWith('{') && x.s.includes(OLD)), 'eski sürüme giden yol düz JSON');
    await clearToasts(a);
    await waitFor(a.client, `!!document.querySelector('#dmh-who .dmh-e2e.is-off') && !!document.querySelector('.dmx-plain')`, 10000, 'şifresiz rozeti');
    assert.ok((await evalJS(a.client, `document.querySelector('#dmh-who .dmh-e2e').textContent`)).includes('Şifreli değil — Orhan eski bir sürüm kullanıyor'));
    assert.ok((await evalJS(a.client, `document.querySelector('.dmx-plain').textContent`)).includes('şifresiz gönderildi'));
    await shot(a, 'e2e-plain-fallback');
    console.log('    A istatistik:', JSON.stringify(await stats(a)));
  } finally {
    try { obs.c.end(true); } catch (e) {}
    peers.forEach(cleanupPeer);
  }
};

if (require.main === module) {
  module.exports().then(() => { console.log('PASS dm-e2ee'); process.exit(0); })
    .catch((e) => { console.error('FAIL dm-e2ee', e); process.exit(1); });
}
