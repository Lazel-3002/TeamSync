// Ayarlar > Ses > Arama sesleri (js/call-sounds.js): hazır sesler, kendi ses
// dosyası (yalnızca IndexedDB), hatalı dosyalar, gelen birebir aramada kendi
// sesin çalması, kabul/retle anında susma ve sesin hiçbir yere gitmemesi.
// İsteğe bağlı: CS_SHOT_DIR verilirse Türkçe ekran görüntüleri alınır.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnPeer, cleanupPeer, evalJS, waitFor, waitForShell, makeFriends } = require('./lib/harness');

function wav(seconds, rate = 8000) {
  const n = Math.round(seconds * rate);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 660 * i / rate) * 8000), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

function watch(peer) {
  const log = { big: [], errors: [] };
  peer.client.ws.addEventListener('message', ev => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.method === 'Network.requestWillBeSent') {
      const r = m.params.request || {};
      const len = r.postData ? r.postData.length : 0;
      if (/supabase|\/storage\//i.test(r.url) && r.method !== 'GET' && len > 20000) log.big.push(r.method + ' ' + r.url + ' ' + len);
      if (len > 30000) log.big.push('POST ' + r.url + ' ' + len);
    } else if (m.method === 'Network.webSocketFrameSent') {
      const len = (m.params.response && m.params.response.payloadData || '').length;
      if (len > 30000) log.big.push('ws frame ' + len);
    } else if (m.method === 'Runtime.exceptionThrown') {
      log.errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300));
    }
  });
  return log;
}

async function setFile(client, selector, file) {
  const doc = await client.send('DOM.getDocument', { depth: 0 });
  const q = await client.send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector });
  assert.ok(q.result && q.result.nodeId, 'file input bulunamadı: ' + selector);
  await client.send('DOM.setFileInputFiles', { nodeId: q.result.nodeId, files: [file] });
}

const msgOf = slot => `(document.querySelector('.cs-row[data-cs-slot="${slot}"] .cs-msg:not(.hidden)') || {}).textContent || ''`;
const ring = `JSON.stringify(window.__tsRingDebug())`;

module.exports = async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-cs-'));
  const files = {
    good: path.join(dir, 'zil-sesim.wav'),
    big: path.join(dir, 'buyuk.wav'),
    long: path.join(dir, 'uzun.wav'),
    text: path.join(dir, 'notlar.mp3')
  };
  const goodWav = wav(2.5);              // ~40 KB
  fs.writeFileSync(files.good, goodWav);
  const big = Buffer.alloc(3 * 1024 * 1024); goodWav.copy(big); fs.writeFileSync(files.big, big);
  fs.writeFileSync(files.long, wav(31));
  fs.writeFileSync(files.text, 'bu bir ses dosyası değil\n'.repeat(50));

  const a = await spawnPeer({ port: 9651, name: 'Arayan' });
  const b = await spawnPeer({ port: 9652, name: 'Aranan' });
  try {
    await waitForShell(a);
    await waitForShell(b);
    const netA = watch(a), netB = watch(b);
    for (const p of [a, b]) {
      await p.client.send('Network.enable');
      await p.client.send('DOM.enable');
      await p.client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 760, deviceScaleFactor: 1, mobile: false });
    }
    const { fb } = await makeFriends(a, b);
    const A = a.client, B = b.client;

    // --- Ayarlar görünümü (Türkçe) ---
    await evalJS(B, `applyUserLanguage('tr', true); openUserSettings('voice'); 1`);
    await waitFor(B, `document.querySelectorAll('#settings-call-sounds .cs-row').length === 2`, 5000, 'arama sesleri bölümü');
    const ui = JSON.parse(await evalJS(B, `JSON.stringify({
      title: document.querySelector('#settings-call-sounds .settings-section-title').textContent,
      inOpts: [...document.querySelectorAll('#cs-select-in option')].map(o => o.value + ':' + o.textContent),
      outOpts: [...document.querySelectorAll('#cs-select-out option')].map(o => o.value),
      vol: document.getElementById('cs-volume').value,
      visible: document.getElementById('settings-call-sounds').getBoundingClientRect().height > 0
    })`));
    assert.strictEqual(ui.title, 'Arama sesleri');
    assert.deepStrictEqual(ui.inOpts, ['normal:Normal', 'soft:Yumuşak', 'classic:Klasik zil', 'digital:Dijital', 'custom:Kendi sesim', 'silent:Sessiz']);
    assert.deepStrictEqual(ui.outOpts, ['normal', 'soft', 'classic', 'digital', 'custom']);
    assert.strictEqual(ui.vol, '80');
    assert.ok(ui.visible);

    // --- Her hazır ses önizlemede hatasız çalar ve durdurulur ---
    for (const slot of ['in', 'out']) {
      for (const sound of ['soft', 'classic', 'digital', 'normal']) {
        await evalJS(B, `(() => { const s = document.getElementById('cs-select-${slot}'); s.value = '${sound}'; s.dispatchEvent(new Event('change', { bubbles: true })); document.querySelector('.cs-row[data-cs-slot="${slot}"] [data-cs="play"]').click(); return 1; })()`);
        await new Promise(r => setTimeout(r, 350));
        const d = JSON.parse(await evalJS(B, ring));
        assert.strictEqual(d.playing, true, `${slot}/${sound} çalmadı`);
        assert.strictEqual(d.sound, sound);
        assert.strictEqual(d.preview, true);
        assert.strictEqual(d.kind, slot === 'in' ? 'ring' : 'ringback');
        assert.ok(Math.abs(d.gain - 0.8) < 0.01, 'ses seviyesi %80');
        assert.strictEqual(await evalJS(B, `document.querySelector('.cs-row[data-cs-slot="${slot}"] [data-cs="play"]').classList.contains('is-playing')`), true);
        await evalJS(B, `document.querySelector('.cs-row[data-cs-slot="${slot}"] [data-cs="play"]').click(); 1`);
        assert.strictEqual(JSON.parse(await evalJS(B, ring)).playing, false, `${slot}/${sound} durmadı`);
      }
    }
    // Önizleme en fazla 5 sn sürer.
    await evalJS(B, `document.querySelector('.cs-row[data-cs-slot="in"] [data-cs="play"]').click(); 1`);
    await new Promise(r => setTimeout(r, 5400));
    assert.strictEqual(JSON.parse(await evalJS(B, ring)).playing, false, 'önizleme 5 sn sonra durmalı');
    // Ses seviyesi kaydırıcısı.
    await evalJS(B, `(() => { const r = document.getElementById('cs-volume'); r.value = '55'; r.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
    assert.strictEqual(await evalJS(B, `TSCallSounds.volume()`), 55);
    assert.strictEqual(await evalJS(B, `document.getElementById('cs-volume-value').textContent`), '55%');

    // --- Hatalı dosyalar ---
    await evalJS(B, `(() => { const s = document.getElementById('cs-select-in'); s.value = 'custom'; s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
    assert.strictEqual(await evalJS(B, `!document.querySelector('.cs-row[data-cs-slot="in"] .cs-file').classList.contains('hidden')`), true);
    await setFile(B, '.cs-row[data-cs-slot="in"] input[type=file]', files.big);
    await waitFor(B, msgOf('in'), 8000, 'büyük dosya hatası');
    assert.strictEqual(await evalJS(B, msgOf('in')), 'Dosya çok büyük (3,0 MB). Sınır 2 MB.');
    await setFile(B, '.cs-row[data-cs-slot="in"] input[type=file]', files.text);
    await waitFor(B, `${msgOf('in')}.startsWith('Bu dosya desteklenmiyor')`, 8000, 'tür hatası');
    await setFile(B, '.cs-row[data-cs-slot="in"] input[type=file]', files.long);
    await waitFor(B, `${msgOf('in')} === 'Ses en fazla 30 saniye olabilir.'`, 8000, 'süre hatası');
    assert.strictEqual(await evalJS(B, `!!document.querySelector('.cs-row[data-cs-slot="in"] [data-cs="remove"]')`), false, 'hatalı dosya saklanmamalı');

    // --- Geçerli dosya: yalnızca IndexedDB ---
    await setFile(B, '.cs-row[data-cs-slot="in"] input[type=file]', files.good);
    await waitFor(B, `!!document.querySelector('.cs-row[data-cs-slot="in"] [data-cs="remove"]')`, 8000, 'dosya kaydedildi');
    assert.strictEqual(await evalJS(B, msgOf('in')), '');
    assert.strictEqual(await evalJS(B, `document.querySelector('.cs-row[data-cs-slot="in"] .cs-file-name').textContent`), 'zil-sesim.wav');
    assert.strictEqual(await evalJS(B, `TSCallSounds.choice('in')`), 'custom');
    const stored = await evalJS(B, `new Promise(res => { const q = indexedDB.open('ts-call-sounds'); q.onsuccess = () => { const g = q.result.transaction('files').objectStore('files').get('in'); g.onsuccess = () => res(g.result ? g.result.bytes.byteLength + ':' + g.result.name : 'none'); }; })`, true);
    assert.strictEqual(stored, `${goodWav.length}:zil-sesim.wav`);
    assert.strictEqual(await evalJS(B, `Object.keys(localStorage).some(k => (localStorage.getItem(k) || '').includes('UklGR'))`), false, 'ses localStorage/yedek yoluna yazılmamalı');

    // Giden satırda "Kendi sesim" seçili ama dosya yok + hata (ekran görüntüsü ve geri dönüş için).
    await evalJS(B, `(() => { const s = document.getElementById('cs-select-out'); s.value = 'custom'; s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
    await setFile(B, '.cs-row[data-cs-slot="out"] input[type=file]', files.big);
    await waitFor(B, msgOf('out'), 8000, 'giden satır hatası');

    const shotDir = process.env.CS_SHOT_DIR;
    if (shotDir) {
      fs.mkdirSync(shotDir, { recursive: true });
      for (const theme of ['aurora', 'white']) {
        for (const w of [1280, 820]) {
          await B.send('Emulation.setDeviceMetricsOverride', { width: w, height: 760, deviceScaleFactor: 1, mobile: false });
          await evalJS(B, `applyUserTheme('${theme}', false); document.getElementById('settings-call-sounds').scrollIntoView({ block: 'center' }); 1`);
          await new Promise(r => setTimeout(r, 500));
          const s = await B.send('Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync(path.join(shotDir, `call-sounds-${theme}-${w}.png`), Buffer.from(s.result.data, 'base64'));
        }
      }
      await B.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 760, deviceScaleFactor: 1, mobile: false });
    }
    await evalJS(B, `document.getElementById('settings-modal').classList.add('hidden'); 1`);
    // Giden satırda "Kendi sesim" seçili ama dosya yok → çalarken sessizce Normal'e döner.
    await evalJS(B, `TSCallSounds.start('ringback', 3000); 1`);
    await waitFor(B, `window.__tsRingDebug().fallback`, 3000, 'geri dönüş');
    assert.strictEqual(JSON.parse(await evalJS(B, ring)).sound, 'normal');
    await evalJS(B, `stopRingLoop(); 1`);
    assert.strictEqual(JSON.parse(await evalJS(B, ring)).playing, false);

    // --- Gelen birebir arama kendi sesi çalar; kabul anında susturur ---
    await evalJS(A, `TSDirectCall.call(${JSON.stringify(fb)}); 1`);
    await waitFor(B, `!!document.querySelector('.dc-ring [data-dc="accept"]')`, 20000, 'B zil kartı');
    await waitFor(B, `window.__tsRingDebug().buffer`, 5000, 'kendi ses tamponu çalıyor');
    const inc = JSON.parse(await evalJS(B, ring));
    assert.strictEqual(inc.kind, 'ring');
    assert.strictEqual(inc.sound, 'custom');
    assert.strictEqual(inc.preview, false);
    assert.ok(Math.abs(inc.bufferDuration - 2.5) < 0.05, 'çalan tampon yüklenen dosya: ' + inc.bufferDuration);
    assert.ok(Math.abs(inc.gain - 0.55) < 0.01);
    // A: varsayılan giden ses (Normal).
    const out = JSON.parse(await evalJS(A, ring));
    assert.strictEqual(out.playing, true);
    assert.strictEqual(out.kind, 'ringback');
    assert.strictEqual(out.sound, 'normal');
    const afterAccept = await evalJS(B, `(() => { document.querySelector('.dc-ring [data-dc="accept"]').click(); return JSON.stringify(window.__tsRingDebug()); })()`);
    assert.strictEqual(JSON.parse(afterAccept).playing, false, 'kabulde zil anında susmalı');
    await waitFor(A, `TSDirectCall.outgoing() && TSDirectCall.outgoing().answered`, 30000, 'A cevaplandı');
    assert.strictEqual(JSON.parse(await evalJS(A, ring)).playing, false, 'cevaplanınca çalma sesi susmalı');
    await evalJS(A, `disconnectApp(); 1`);
    await waitFor(B, `!state.room`, 20000, 'B aramadan çıktı');
    await waitFor(A, `!state.room`, 10000, 'A aramadan çıktı');

    // --- Ret: anında susar (iki tarafta) ---
    await new Promise(r => setTimeout(r, 1500));
    await evalJS(A, `TSDirectCall.call(${JSON.stringify(fb)}); 1`);
    await waitFor(B, `!!document.querySelector('.dc-ring [data-dc="decline"]') && window.__tsRingDebug().buffer`, 20000, 'B ikinci zil');
    const afterDecline = await evalJS(B, `(() => { document.querySelector('.dc-ring [data-dc="decline"]').click(); return JSON.stringify(window.__tsRingDebug()); })()`);
    assert.strictEqual(JSON.parse(afterDecline).playing, false, 'retle zil anında susmalı');
    await waitFor(A, `!state.room && !TSDirectCall.outgoing()`, 15000, 'A ret aldı');
    assert.strictEqual(JSON.parse(await evalJS(A, ring)).playing, false);

    // --- Kaldır: kayıt silinir, Normal'e döner ---
    await evalJS(B, `openUserSettings('voice'); 1`);
    await waitFor(B, `!!document.querySelector('.cs-row[data-cs-slot="in"] [data-cs="remove"]')`, 5000, 'kaldır düğmesi');
    await evalJS(B, `document.querySelector('.cs-row[data-cs-slot="in"] [data-cs="remove"]').click(); 1`);
    await waitFor(B, `TSCallSounds.choice('in') === 'normal' && !document.querySelector('.cs-row[data-cs-slot="in"] [data-cs="remove"]')`, 5000, 'kaldırıldı');

    // --- Ses dosyası hiçbir yere gönderilmedi ---
    assert.deepStrictEqual(netA.big.concat(netB.big), [], 'büyük istek/çerçeve gönderildi');
    assert.deepStrictEqual(netA.errors.concat(netB.errors), [], 'sayfa hatası');
    console.log('call-sounds: ayarlar, 4 hazır ses x 2, hatalar, kendi ses (kabul/ret), ağ temiz');
  } finally {
    cleanupPeer(a);
    cleanupPeer(b);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  }
};

if (require.main === module) module.exports().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
