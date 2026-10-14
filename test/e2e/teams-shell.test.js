// Teams esintili kabuk: etiketli ray + Takvim/Aramalar görünümleri, sohbet
// listesi (önizleme, saat, sabitleme, filtre), DM başlığındaki "son görülme",
// iki gerçek eş arasında birebir arama (zil kartı → kabul → birebir sahne,
// arama geçmişi; ikinci aramada ret) ve takvimden toplantı daveti (DM).
const assert = require('assert');
const {
  spawnPeer,
  cleanupPeer,
  evalJS,
  waitFor,
  waitForShell,
  waitForPeerConnected,
  makeFriends,
} = require('./lib/harness');

module.exports = async function run() {
  const a = await spawnPeer({ port: 9471, name: 'Arayan' });
  const b = await spawnPeer({ port: 9472, name: 'Aranan' });
  try {
    await waitForShell(a);
    await waitForShell(b);
    for (const p of [a, b]) {
      await p.client.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 800, deviceScaleFactor: 1, mobile: false });
    }
    const { fa, fb } = await makeFriends(a, b);
    const A = a.client;
    const B = b.client;

    // --- Ray ve görünümler ---
    const rail = JSON.parse(await evalJS(A, `JSON.stringify(['rail-home', 'side-friends', 'rail-calendar', 'rail-calls', 'rail-meet', 'rail-settings', 'rail-account'].map(id => !!document.getElementById(id)))`));
    assert.deepStrictEqual(rail, [true, true, true, true, true, true, true]);
    await evalJS(A, `document.getElementById('rail-calendar').click(); 1`);
    assert.strictEqual(await evalJS(A, `document.body.dataset.view`), 'calendar');
    assert.strictEqual(await evalJS(A, `getComputedStyle(document.getElementById('shell-side')).display`), 'none');
    assert.strictEqual(await evalJS(A, `document.querySelectorAll('#view-calendar .cal-cell').length`), 42);
    await evalJS(A, `document.getElementById('rail-calls').click(); 1`);
    assert.strictEqual(await evalJS(A, `document.body.dataset.view`), 'calls');
    assert.strictEqual(await evalJS(A, `!!document.querySelector('#view-calls .calls-empty')`), true);

    // --- Sohbet listesi: önizleme, saat, sabitleme, filtre ---
    await evalJS(A, `(() => {
      state.dms[${JSON.stringify(fb)}] = [{ id: 'm1', sender: 'me', type: 'text', content: 'selam nasılsın', timestamp: Date.now() - 60000 }];
      TSDM.renderList();
      return 1;
    })()`);
    const row = JSON.parse(await evalJS(A, `(() => {
      const r = document.querySelector('#dm-list .chat-row[data-fid=${JSON.stringify(fb)}]');
      return JSON.stringify({ sub: r && r.querySelector('.dm-row-sub').textContent, time: r && r.querySelector('.dm-row-time').textContent.trim() });
    })()`));
    assert.ok(/selam nasılsın/.test(row.sub) && row.sub.includes(':'), JSON.stringify(row));
    assert.ok(row.time.length > 0, JSON.stringify(row));
    await evalJS(A, `TSDM.togglePin({ fid: ${JSON.stringify(fb)} }); 1`);
    assert.strictEqual(await evalJS(A, `!!document.querySelector('#dm-list .dm-sec[data-sec="pinned"] + .chat-row[data-fid=${JSON.stringify(fb)}]')`), true);
    await evalJS(A, `document.querySelector('#chat-filters [data-cf="groups"]').click(); 1`);
    assert.strictEqual(await evalJS(A, `!!document.querySelector('#dm-list .chat-row[data-fid=${JSON.stringify(fb)}]')`), false);
    await evalJS(A, `document.querySelector('#chat-filters [data-cf="groups"]').click(); 1`);

    // --- DM başlığı: durum satırı, sekmeler ---
    await waitFor(A, `TSStatus.statusOf(${JSON.stringify(fb)}) === 'online'`, 30000, 'B çevrimiçi görünüyor');
    await evalJS(A, `openDM(${JSON.stringify(fb)}); 1`);
    assert.strictEqual(await evalJS(A, `document.querySelector('#dmh-who .dmh-presence').classList.contains('s-online')`), true);
    await evalJS(A, `document.querySelector('#dmh-tabs [data-dmtab="files"]').click(); 1`);
    assert.strictEqual(await evalJS(A, `getComputedStyle(document.getElementById('dm-main-host')).display === 'none' && !!document.querySelector('#dm-media-pane .dm-media-empty')`), true);
    await evalJS(A, `document.querySelector('#dmh-tabs [data-dmtab="chat"]').click(); 1`);
    // Çevrimdışı arkadaş için "Son görülme"
    const lastSeen = await evalJS(A, `(() => {
      state.friends['KNK-OLD'] = { name: 'Eski', online: false };
      TSLastSeen.mark('KNK-OLD', Date.now() - 2 * 3600e3);
      return TSDM.presenceText('KNK-OLD').text;
    })()`);
    assert.ok(/2/.test(lastSeen) && !/^(Offline|Çevrimdışı)$/.test(lastSeen), lastSeen);

    // --- Birebir arama: zil → kabul ---
    await evalJS(A, `document.getElementById('dmh-voice-call').click(); 1`);
    await waitFor(A, `!!state.room && state.room.startsWith('dc-') && document.querySelector('#view-call .main').classList.contains('stage-solo')`, 20000, 'arama odası kuruldu');
    assert.strictEqual(await evalJS(A, `document.querySelector('#call-stage .call-stage-av').classList.contains('is-ringing')`), true);
    await waitFor(B, `!!document.querySelector('.dc-ring [data-dc="accept"]')`, 20000, 'B zil kartını gördü');
    await evalJS(B, `document.querySelector('.dc-ring [data-dc="accept"]').click(); 1`);
    await waitForPeerConnected(a, 40000);
    await waitForPeerConnected(b, 40000);
    await waitFor(A, `document.querySelector('#view-call .main').classList.contains('stage-duo')`, 10000, 'birebir sahne');
    await waitFor(A, `/^\\d{2}:\\d{2}$/.test(document.getElementById('call-timer').textContent)`, 5000, 'süre sayacı');
    assert.strictEqual(await evalJS(A, `TSDirectCall.outgoing() && TSDirectCall.outgoing().answered`), true);
    await new Promise(r => setTimeout(r, 3500));
    await evalJS(A, `disconnectApp(); 1`);
    await waitFor(A, `!state.room && TSCallLog.list().length > 0`, 10000, 'A arama kaydı');
    // Birebir aramada karşı taraf ayrılınca arama kendiliğinden biter.
    await waitFor(B, `!state.room && TSCallLog.list().length > 0`, 30000, 'B arama kendiliğinden bitti');
    const logA = JSON.parse(await evalJS(A, `JSON.stringify(TSCallLog.list()[0])`));
    assert.strictEqual(logA.kind, 'direct', JSON.stringify(logA));
    assert.strictEqual(logA.dir, 'out', JSON.stringify(logA));
    assert.strictEqual(logA.answered, true, JSON.stringify(logA));
    assert.ok(logA.peers.some(p => p.fid === fb), JSON.stringify(logA));
    const logB = JSON.parse(await evalJS(B, `JSON.stringify(TSCallLog.list()[0])`));
    assert.strictEqual(logB.dir, 'in', JSON.stringify(logB));
    assert.ok(logB.peers.some(p => p.fid === fa), JSON.stringify(logB));

    // --- İkinci arama: ret ---
    await new Promise(r => setTimeout(r, 1500));
    await evalJS(A, `TSDirectCall.call(${JSON.stringify(fb)}); 1`);
    await waitFor(B, `!!document.querySelector('.dc-ring [data-dc="decline"]')`, 20000, 'B ikinci zil');
    await evalJS(B, `document.querySelector('.dc-ring [data-dc="decline"]').click(); 1`);
    await waitFor(A, `!state.room && !TSDirectCall.outgoing()`, 15000, 'ret sonrası A aramayı kapattı');
    assert.strictEqual(await evalJS(B, `TSCallLog.list()[0].dir`), 'declined');

    // --- Takvim: toplantı daveti DM ile gider ---
    await evalJS(A, `TSShell.setView('calendar'); TSCalendar.openEditor(null); 1`);
    await evalJS(A, `(() => {
      const f = document.querySelector('.cal-dialog');
      f.querySelector('input[name="title"]').value = 'Oyun gecesi';
      f.querySelector('input[name="att"][value=${JSON.stringify(fb)}]').checked = true;
      f.requestSubmit();
      return 1;
    })()`);
    assert.strictEqual(await evalJS(A, `TSCalendar.list().length`), 1);
    assert.strictEqual(await evalJS(A, `!!document.querySelector('#view-calendar .cal-ev')`), true);
    await waitFor(B, `(state.dms[${JSON.stringify(fa)}] || []).some(m => String(m.content).includes('Oyun gecesi'))`, 20000, 'B toplantı mesajını aldı');
  } finally {
    cleanupPeer(a);
    cleanupPeer(b);
  }
};

if (require.main === module) {
  module.exports().then(() => { console.log('PASS'); process.exit(0); }, e => { console.error(e); process.exit(1); });
}
