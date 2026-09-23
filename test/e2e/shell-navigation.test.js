// Discord tarzı kabuk gezinmesi: Arkadaşlar → DM → Arama, arama sürerken
// başka sayfaya geçince "Ses Bağlandı" paneli ve odanın yaşaması, yan
// sütundan bağlantıyı kesme, dar pencerelerde taşma olmaması ve katılma zaman
// aşımında hata penceresinin gerçekten görünmesi (eskiden #app içinde kalıp
// gizli kalıyordu).
const assert = require('assert');
const {
  spawnPeer,
  cleanupPeer,
  evalJS,
  waitFor,
  createRoom,
  waitForShell,
} = require('./lib/harness');

async function setSize(peer, width, height) {
  await peer.client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await new Promise(r => setTimeout(r, 300));
}

module.exports = async function run() {
  const peer = await spawnPeer({ port: 9441, name: 'Kabuk Testi' });
  const c = peer.client;
  try {
    await waitForShell(peer);
    await setSize(peer, 1280, 800);
    assert.strictEqual(await evalJS(c, `document.body.dataset.view`), 'friends');
    assert.strictEqual(await evalJS(c, `getComputedStyle(document.getElementById('login')).display`), 'none');

    // Arkadaş + DM
    await evalJS(c, `(() => {
      state.friends['KNK-NAV'] = { name: 'Gezinti Arkadaşı', online: true, lastSeen: Date.now() + 600000 };
      state.dms['KNK-NAV'] = [{ sender: 'them', type: 'text', content: 'selam', timestamp: Date.now() - 5000 }];
      renderFriends();
      return 1;
    })()`);
    await evalJS(c, `openDM('KNK-NAV'); 1`);
    assert.strictEqual(await evalJS(c, `document.body.dataset.view`), 'dm');
    assert.strictEqual(await evalJS(c, `!!document.querySelector('#dm-list .dm-row.active[data-fid="KNK-NAV"]')`), true);
    assert.strictEqual(await evalJS(c, `document.querySelectorAll('#dm-messages .dmx-msg').length`), 1);

    // Dar pencerelerde yatay taşma yok
    for (const [w, h] of [[1280, 800], [850, 600], [360, 720]]) {
      await setSize(peer, w, h);
      for (const view of ['friends', 'dm']) {
        await evalJS(c, `TSShell.setView(${JSON.stringify(view)}, 'KNK-NAV'); 1`);
        const overflow = await evalJS(c, `document.documentElement.scrollWidth - document.documentElement.clientWidth`);
        assert.ok(overflow <= 0, `${view} @${w}px taşıyor: ${overflow}`);
      }
    }
    await setSize(peer, 1280, 800);
    await evalJS(c, `TSShell.setView('friends'); 1`);

    // Arama: görünüm, kutucuk, ray düğmesi
    await createRoom(peer);
    await waitFor(c, `document.body.dataset.view === 'call'`, 10000, 'call view');
    assert.strictEqual(await evalJS(c, `document.querySelectorAll('#grid .ptile[data-tile-uid]').length`), 1);
    assert.strictEqual(await evalJS(c, `!!document.querySelector('#grid .ptile-invite')`), true);
    assert.strictEqual(await evalJS(c, `!document.getElementById('rail-call').classList.contains('hidden')`), true);

    // Başka sayfaya geç: oda yaşar, "Ses Bağlandı" görünür, arama görünümü ölçülebilir kalır
    await evalJS(c, `document.getElementById('side-friends').click(); 1`);
    const bg = JSON.parse(await evalJS(c, `JSON.stringify({
      view: document.body.dataset.view,
      room: !!state.room,
      mini: getComputedStyle(document.getElementById('voice-mini')).display !== 'none',
      mainWidth: document.querySelector('.main').getBoundingClientRect().width,
      callVisibility: getComputedStyle(document.getElementById('view-call')).visibility
    })`));
    assert.deepStrictEqual({ ...bg, mainWidth: bg.mainWidth > 0 }, { view: 'friends', room: true, mini: true, mainWidth: true, callVisibility: 'hidden' });

    // Ray'daki arama düğmesiyle geri dön
    await evalJS(c, `document.getElementById('rail-call').click(); 1`);
    assert.strictEqual(await evalJS(c, `document.body.dataset.view`), 'call');

    // Sağ üstteki sohbet düğmesi paneli açar/kapatır
    await evalJS(c, `document.getElementById('btn-call-chat').click(); 1`);
    assert.strictEqual(await evalJS(c, `getComputedStyle(document.querySelector('#app > .sidebar')).display !== 'none' && getComputedStyle(document.getElementById('cinput')).display !== 'none'`), true);
    await evalJS(c, `document.getElementById('btn-call-chat').click(); 1`);
    assert.strictEqual(await evalJS(c, `getComputedStyle(document.querySelector('#app > .sidebar')).display`), 'none');

    // Yan sütundan bağlantıyı kes → son ana görünüme dön
    await evalJS(c, `document.getElementById('vm-leave').click(); 1`);
    await waitFor(c, `!state.room && document.getElementById('app').classList.contains('hidden')`, 10000, 'left call');
    assert.strictEqual(await evalJS(c, `document.body.dataset.view`), 'friends');
    assert.strictEqual(await evalJS(c, `document.getElementById('voice-mini').classList.contains('hidden')`), true);
    assert.strictEqual(await evalJS(c, `document.querySelectorAll('#grid .ptile').length`), 0);

    // Hızlı arama: olmayan bir odaya katılma → zaman aşımı hata penceresi GÖRÜNÜR
    await evalJS(c, `TSShell.openQuickCall('join'); 1`);
    assert.strictEqual(await evalJS(c, `document.body.classList.contains('qc-open')`), true);
    await evalJS(c, `document.getElementById('join-id').value = 'ts-yok-' + Date.now(); document.getElementById('btn-join').click(); 1`);
    await waitFor(c, `(() => {
      const m = document.getElementById('error-modal');
      if (!m || m.classList.contains('hidden')) return false;
      const r = m.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && m.parentElement === document.body;
    })()`, 30000, 'error modal visible');
    await evalJS(c, `document.getElementById('error-ok').click(); 1`);
    assert.strictEqual(await evalJS(c, `document.body.classList.contains('qc-open')`), false);
    assert.strictEqual(await evalJS(c, `document.body.dataset.view`), 'friends');
  } finally {
    cleanupPeer(peer);
  }
};

if (require.main === module) {
  module.exports().then(() => console.log('OK'), error => { console.error(error); process.exitCode = 1; });
}
