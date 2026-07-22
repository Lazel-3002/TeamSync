// Regression guard: "arkadaşım katılma isteği atınca gelmiyor" şikayetinin
// uçtan uca koruması. B, A'nın kalıcı friendId konusuna room_join_request
// yayınlar; A'da (odadayken) köşe bildirim kartı çıkmalı, A kabul edince
// oda ID + şifre B'ye dönmeli ve B otomatik olarak A'nın odasına girmeli.
// Global MQTT failover'lı kanal (connectGlobalBroker) üzerinden gerçek
// broker trafiğiyle test edilir.
const { spawnPeer, cleanupPeer, waitFor, evalJS, createRoom } = require('./lib/harness');

module.exports = async function run() {
  const a = await spawnPeer({ port: 9310, name: 'HostAli' });
  const b = await spawnPeer({ port: 9311, name: 'GuestVeli' });
  try {
    await waitFor(a.client, `!!(window.state && window.state.globalMqtt && window.state.globalMqtt.connected)`, 25000, 'A global mqtt connected');
    await waitFor(b.client, `!!(window.state && window.state.globalMqtt && window.state.globalMqtt.connected)`, 25000, 'B global mqtt connected');

    const aFriendId = await evalJS(a.client, `window.state.friendId`);
    if (!aFriendId) throw new Error('A has no persistent friendId');
    const roomId = await createRoom(a);

    // B, A'nın kalıcı kimliğine katılma isteği yollar (arkadaş listesindeki akışla aynı fonksiyon).
    await evalJS(b.client, `window.requestJoinRoom(${JSON.stringify(aFriendId)}); 1`);

    // A tarafında köşe bildirim kartı görünmeli ve istek B'den gelmiş olmalı.
    await waitFor(
      a.client,
      `(window.state.pendingJoinReq && window.state.pendingJoinReq.name === 'GuestVeli' && document.getElementById('join-request-note') && !document.getElementById('join-request-note').classList.contains('hidden')) ? 'yes' : null`,
      20000,
      'join-request corner card visible on A'
    );

    // A kabul eder; B'nin otomatik olarak aynı odaya girmesi beklenir.
    await evalJS(a.client, `document.getElementById('join-req-accept').click(); 1`);
    await waitFor(
      b.client,
      `(window.state.room && window.state.room === ${JSON.stringify(roomId)}) ? 'yes' : null`,
      30000,
      'B auto-joined A\'s room after accept'
    );
  } finally {
    cleanupPeer(a);
    cleanupPeer(b);
  }
};
