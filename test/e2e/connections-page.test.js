const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  spawnPeer, cleanupPeer, evalJS, waitFor, createRoom, joinRoom, waitForPeerConnected, waitStableIdentity,
} = require('./lib/harness');

// Ayarlar > Bağlantılar (js/net-settings.js):
//  - dört bölüm + Gelişmiş çizilir, test her satır için sonuç ve açıklama verir
//    (çevrimdışı kipte de hata fırlatmadan; satırlar kırmızı olabilir),
//  - aramada kişi başına bağlantı tipi görünür,
//  - "Bu cihaz" listelenir; aynı hesabın iki cihazı birbirini görür ve
//    "Bu cihazdan çıkış yap" komutu (şifreli acct_dev) karşı tarafı çıkarır,
//  - kurucu anahtarı kurucu paneliyle eş, değişiklik diğer eşe gider.
// TEAMSYNC_SHOTS=<klasör> verilirse ekran görüntüleri oraya yazılır.
const SHOTS = process.env.TEAMSYNC_SHOTS || '';

async function shot(peer, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  // Bildirimler görüntüyü kapatmasın.
  await evalJS(peer.client, `(() => { const c = document.getElementById('toast-container'); if (c) c.innerHTML = ''; return 1; })()`);
  await new Promise(r => setTimeout(r, 150));
  const res = await peer.client.send('Page.captureScreenshot', { format: 'png' });
  if (res.result && res.result.data) fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(res.result.data, 'base64'));
}

async function size(peer, width, height = 760) {
  await peer.client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
}

async function openPage(peer) {
  await evalJS(peer.client, `(() => {
    if (document.getElementById('settings-modal').classList.contains('hidden')) openUserSettings('network');
    else setSettingsPanel('network');
    return 1;
  })()`);
  await waitFor(peer.client, `document.querySelectorAll('#net-checks .net-check').length === 4`, 10000, 'bağlantı satırları');
}

async function scrollTo(peer, sel) {
  await evalJS(peer.client, `(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.scrollIntoView({ block: 'start' }); return 1; })()`);
  await new Promise(r => setTimeout(r, 400));
}

module.exports = async function run() {
  const a = await spawnPeer({ port: 9711, name: 'Net A' });
  const b = await spawnPeer({ port: 9712, name: 'Net B' });
  try {
    await size(a, 1280);
    await evalJS(a.client, `applyUserLanguage('tr'); 1`);
    await evalJS(b.client, `applyUserLanguage('tr'); 1`);
    await openPage(a);

    // 1) Bölümler
    const sections = await evalJS(a.client, `(() => ({
      checks: [...document.querySelectorAll('#net-checks .net-check')].map(li => li.dataset.check),
      infoButtons: document.querySelectorAll('#net-checks .net-info-btn').length,
      peers: document.getElementById('net-peers').textContent.trim(),
      devices: document.getElementById('net-devices').textContent,
      newdev: document.getElementById('net-newdev').textContent,
      founder: !!document.getElementById('net-autohost-default'),
      advancedHidden: document.getElementById('net-advanced').classList.contains('hidden'),
      dnsSelect: !!document.querySelector('#net-advanced #user-dns-provider'),
      turnInput: !!document.querySelector('#net-advanced #user-turn-url'),
      live: document.getElementById('net-checks').getAttribute('aria-live'),
    }))()`);
    assert.deepStrictEqual(sections.checks, ['sig', 'direct', 'turn', 'dns'], JSON.stringify(sections));
    assert.strictEqual(sections.infoButtons, 4);
    assert.strictEqual(sections.live, 'polite');
    assert.ok(sections.peers.includes('Bir aramadayken'), sections.peers);
    assert.ok(sections.devices.includes('Bu cihaz'), sections.devices);
    assert.ok(sections.newdev.includes('sunucuya taşı'), 'eski tip hesapta taşıma açıklaması: ' + sections.newdev);
    assert.ok(sections.founder && sections.advancedHidden && sections.dnsSelect && sections.turnInput, JSON.stringify(sections));

    // 2) Test: her satır bir sonuç ve açıklama verir, arayüz kilitlenmez.
    await evalJS(a.client, `document.getElementById('net-test-btn').click(); 1`);
    const busy = await evalJS(a.client, `document.getElementById('net-test-btn').disabled && document.querySelector('#net-checks [data-state="checking"]') !== null`);
    assert.ok(busy, 'test sırasında düğme beklemede olmalı');
    const t0 = Date.now();
    await waitFor(a.client, `(() => { const s = TSNetSettings._state(); return !!s.results && !s.running; })()`, 20000, 'test sonucu');
    assert.ok(Date.now() - t0 < 17000, 'test 15 sn içinde bitmeli');
    const res = await evalJS(a.client, `(() => [...document.querySelectorAll('#net-checks .net-check')].map(li => ({
      id: li.dataset.check, state: li.dataset.state,
      label: li.querySelector('.net-state-label').textContent,
      verdict: li.querySelector('.net-verdict').textContent,
    })))()`);
    for (const r of res) {
      assert.ok(['ok', 'warn', 'bad', 'idle'].includes(r.state), JSON.stringify(r));
      assert.ok(r.verdict.length > 10 && r.label.length > 1, JSON.stringify(r));
    }
    console.log('    test sonuçları:', res.map(r => `${r.id}=${r.state}`).join(' '));
    // Açıklama klavyeyle açılan bir <button>.
    const info = await evalJS(a.client, `(() => {
      const btn = document.querySelector('#net-checks [data-check="direct"] .net-info-btn');
      btn.click();
      const panel = document.getElementById(btn.getAttribute('aria-controls'));
      return { tag: btn.tagName, expanded: btn.getAttribute('aria-expanded'), visible: !panel.hidden, text: panel.textContent };
    })()`);
    assert.strictEqual(info.tag, 'BUTTON');
    assert.strictEqual(info.expanded, 'true');
    assert.ok(info.visible && /VPN|WARP/.test(info.text), JSON.stringify(info));
    await shot(a, 'net-top-aurora');
    await evalJS(a.client, `applyUserTheme('white'); 1`);
    await shot(a, 'net-top-white');
    await size(a, 820);
    await shot(a, 'net-top-820');
    await size(a, 1280);
    await evalJS(a.client, `applyUserTheme('aurora'); 1`);

    // 2b) İnternet yokken: sinyal satırı kırmızı, özet ne yapılacağını söyler.
    await a.client.send('Network.enable');
    await a.client.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await evalJS(a.client, `document.getElementById('net-test-btn').click(); 1`);
    await new Promise(r => setTimeout(r, 500));
    await waitFor(a.client, `(() => { const s = TSNetSettings._state(); return !!s.results && !s.running; })()`, 20000, 'çevrimdışı test sonucu');
    const off = await evalJS(a.client, `({
      sig: document.querySelector('#net-checks [data-check="sig"]').dataset.state,
      verdict: document.querySelector('#net-checks [data-check="sig"] .net-verdict').textContent,
      summary: document.getElementById('net-test-summary').textContent,
    })`);
    await a.client.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    assert.strictEqual(off.sig, 'bad', JSON.stringify(off));
    assert.ok(off.verdict.includes('ulaşılamadı') && off.summary.includes('Bu ne demek?'), JSON.stringify(off));
    await evalJS(a.client, `document.querySelector('#net-checks [data-check="sig"] .net-info-btn').click(); 1`);
    await shot(a, 'net-offline-aurora');

    // 3) Arama: kişi başına bağlantı tipi; kurucu anahtarı eşitlenir.
    await evalJS(a.client, `document.getElementById('settings-v2-close').click(); 1`);
    const roomId = await createRoom(a);
    await joinRoom(b, roomId);
    await waitForPeerConnected(a);
    await waitForPeerConnected(b);
    await openPage(a);
    await waitFor(a.client, `(() => { const r = document.querySelectorAll('#net-peers .net-peer'); return r.length === 1 && r[0].dataset.type !== 'connecting'; })()`, 15000, 'kişi satırı');
    const peerRow = await evalJS(a.client, `(() => { const r = document.querySelector('#net-peers .net-peer'); return { type: r.dataset.type, text: r.textContent.replace(/\\s+/g, ' ').trim() }; })()`);
    assert.ok(['direct', 'relay'].includes(peerRow.type), JSON.stringify(peerRow));
    assert.ok(/Doğrudan|Aracı sunucu/.test(peerRow.text) && peerRow.text.includes('Net B'), JSON.stringify(peerRow));
    console.log('    aramadaki kişi:', peerRow.text);

    await waitFor(a.client, `state.isRoomFounder && !!document.getElementById('net-autohost-room')`, 10000, 'kurucu anahtarı');
    const before = await evalJS(a.client, `!!state.autoHost`);
    await evalJS(a.client, `document.getElementById('net-autohost-room').click(); 1`);
    const after = await evalJS(a.client, `({ live: !!state.autoHost, panel: document.getElementById('founder-auto-host').checked, page: document.getElementById('net-autohost-room').checked })`);
    assert.strictEqual(after.live, !before, JSON.stringify(after));
    assert.strictEqual(after.panel, after.live, 'kurucu paneli eşitlenmeli');
    assert.strictEqual(after.page, after.live);
    await waitFor(b.client, `!!state.autoHost === ${after.live}`, 8000, 'diğer eşe founder_settings_update');
    // Kurucu panelinden değişiklik sayfaya yansır.
    await evalJS(a.client, `(() => { const el = document.getElementById('founder-auto-host'); el.checked = !el.checked; el.dispatchEvent(new Event('change')); return 1; })()`);
    await waitFor(a.client, `document.getElementById('net-autohost-room').checked === ${before}`, 5000, 'panelden sayfaya');
    await waitFor(b.client, `!!state.autoHost === ${before}`, 8000, 'geri alma diğer eşe');
    // Kurucu olmayan taraf salt okunur görür.
    await openPage(b);
    const bRoom = await evalJS(b.client, `({ disabled: document.getElementById('net-autohost-room').disabled, text: document.getElementById('net-founder').textContent })`);
    assert.ok(bRoom.disabled && bRoom.text.includes('kurucusu değiştirebilir'), JSON.stringify(bRoom));
    await evalJS(b.client, `document.getElementById('settings-v2-close').click(); 1`);

    await evalJS(a.client, `document.querySelector('#net-info-call') && document.querySelector('[aria-controls="net-info-call"]').click(); 1`);
    await scrollTo(a, '.net-card:has(#net-peers)');
    await shot(a, 'net-call-aurora');
    await evalJS(a.client, `applyUserTheme('white'); 1`);
    await shot(a, 'net-call-white');
    await evalJS(a.client, `applyUserTheme('aurora'); 1`);
    await scrollTo(a, '#net-founder-title');
    await shot(a, 'net-founder-aurora');
    await size(a, 820);
    await shot(a, 'net-founder-820');
    await size(a, 1280);

    // 4) Aynı hesabın iki cihazı: B, A'nın giriş kodunu ekler ve A'nın kimliğine geçer.
    await evalJS(a.client, `document.getElementById('settings-v2-close').click(); 1`);
    await evalJS(a.client, `disconnectApp(); 1`);
    await evalJS(b.client, `disconnectApp(); 1`);
    await new Promise(r => setTimeout(r, 1500));
    const fa = await waitStableIdentity(a);
    await evalJS(a.client, `state.accountKind = 'cloud'; state.deviceSlot = 0; 1`);
    const code = await evalJS(a.client, `window.electronAPI.getAccountCode(0)`, true);
    assert.match(code, /^TS1-/);
    const imported = await evalJS(b.client, `window.electronAPI.importAccountCode(${JSON.stringify(code)})`, true);
    assert.ok(imported && imported.ok && imported.slot >= 1000, JSON.stringify(imported));
    await evalJS(b.client, `(() => {
      const list = JSON.parse(localStorage.getItem('teamsync_device_accounts') || '[]');
      list.push({ slot: ${imported.slot}, name: 'Net A', id: ${JSON.stringify(fa)} });
      localStorage.setItem('teamsync_device_accounts', JSON.stringify(list));
      state.accountKind = 'cloud'; state.deviceSlot = ${imported.slot}; state.friendId = ${JSON.stringify(fa)};
      setupGlobalMQTT();
      return 1;
    })()`);
    await waitFor(b.client, `!!(state.globalMqtt && state.globalMqtt.connected && globalMqttIdentity === ${JSON.stringify(fa)})`, 30000, 'B kişisel konuya bağlandı');
    const keys = await Promise.all([a, b].map(p => evalJS(p.client, `window.electronAPI.getAccountChannelKey(state.deviceSlot)`, true)));
    assert.ok(keys[0] && keys[0] === keys[1], 'iki cihazın kanal anahtarı aynı olmalı');

    await openPage(a);
    const bDevice = await evalJS(b.client, `window.electronAPI.getDeviceInfo().then(i => i.deviceId)`, true);
    await waitFor(a.client, `!!document.querySelector('#net-devices [data-device="${bDevice}"][data-state="ok"]')`, 30000, 'B çevrimiçi görünür');
    const newdev = await evalJS(a.client, `(() => ({ text: document.getElementById('net-newdev').textContent, steps: document.querySelectorAll('#net-newdev .net-steps li').length }))()`);
    assert.strictEqual(newdev.steps, 3);
    assert.ok(newdev.text.includes('Kodla Giriş Yap'), newdev.text);
    await waitFor(a.client, `!document.getElementById('net-login-code-toggle').disabled`, 8000, 'kod yüklendi');
    await scrollTo(a, '#net-devices-title');
    await shot(a, 'net-devices-aurora');
    await evalJS(a.client, `applyUserTheme('white'); 1`);
    await shot(a, 'net-devices-white');
    await scrollTo(a, '#net-newdev-title');
    await shot(a, 'net-newdev-white');
    await evalJS(a.client, `applyUserTheme('aurora'); 1`);
    await shot(a, 'net-newdev-aurora');
    await size(a, 820);
    await scrollTo(a, '#net-devices-title');
    await shot(a, 'net-devices-820');
    await size(a, 1280);

    // Yanlış anahtarla şifrelenmiş komut yok sayılır (B hâlâ içeride).
    await evalJS(b.client, `TSNetSettings.onAccountEvent({ type: 'acct_dev', fromId: state.friendId, d: btoa('x'.repeat(40)) }).then(() => 1)`, true);
    assert.strictEqual(await evalJS(b.client, `state.friendId`), fa);

    // "Bu cihazdan çıkış yap" → onay → B çıkış yapar ve kodu unutur.
    await evalJS(a.client, `document.querySelector('#net-devices [data-signout="${bDevice}"]').click(); 1`);
    await waitFor(a.client, `!document.getElementById('generic-confirm-modal')?.classList.contains('hidden') && !!document.getElementById('generic-confirm-yes')`, 5000, 'onay penceresi').catch(() => {});
    await evalJS(a.client, `(document.getElementById('generic-confirm-yes') || document.querySelector('#generic-confirm-modal .btn-pri')).click(); 1`);
    await waitFor(b.client, `state.friendId === ''`, 15000, 'B çıkış yaptı');
    const bAfter = await evalJS(b.client, `(async () => ({
      list: JSON.parse(localStorage.getItem('teamsync_device_accounts') || '[]').map(x => x.slot),
      creds: await window.electronAPI.getDeviceCredentials(${imported.slot}),
    }))()`, true);
    assert.ok(!bAfter.list.includes(imported.slot) && !bAfter.creds, 'kodla eklenen hesap B\'den kaldırılmalı: ' + JSON.stringify(bAfter));
    assert.strictEqual(await evalJS(a.client, `state.friendId`), fa, 'A içeride kalmalı');
  } finally {
    cleanupPeer(a);
    cleanupPeer(b);
  }
};

if (require.main === module) {
  module.exports().then(() => { console.log('PASS connections-page'); process.exit(0); })
    .catch((e) => { console.error('FAIL connections-page', e); process.exit(1); });
}
