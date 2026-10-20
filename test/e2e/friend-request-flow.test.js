// İki gerçek istemci arasında arkadaşlık isteği: A formdan gönderir, B'nin
// "Bekleyen" sekmesinde kabul/ret düğmeleriyle görünür, B kabul edince A'nın
// listesinde arkadaş olur ve giden istek kaybolur (E2E çevrimdışı kipi: MQTT).
const assert = require('assert');
const {
  spawnPeer,
  cleanupPeer,
  evalJS,
  waitFor,
  waitStableIdentity,
} = require('./lib/harness');

module.exports = async function run() {
  const a = await spawnPeer({ port: 9393, name: 'Gonderen A' });
  const b = await spawnPeer({ port: 9394, name: 'Alici B' });
  try {
    const menu = `!document.getElementById('step-action').classList.contains('hidden')`;
    await waitFor(a.client, menu, 15000, 'A main menu');
    await waitFor(b.client, menu, 15000, 'B main menu');
    await waitStableIdentity(a);
    const fb = await waitStableIdentity(b);
    const connected = `!!(state.globalMqtt && state.globalMqtt.connected)`;
    await waitFor(a.client, connected, 20000, 'A broker');
    await waitFor(b.client, connected, 20000, 'B broker');

    await evalJS(a.client, `(async () => {
      document.getElementById('friend-id-input').value = ${JSON.stringify(fb.toLowerCase())};
      document.getElementById('btn-add-friend').click();
      await new Promise(r => setTimeout(r, 300));
      return 1;
    })()`, true);
    assert.strictEqual(await evalJS(a.client, `window.TSFriends.wasRequested(${JSON.stringify(fb)})`), true, 'A giden isteği kaydetmeli');

    await waitFor(b.client, `state.friendRequests.length === 1`, 20000, 'B isteği almalı');
    const ui = await evalJS(b.client, `(() => {
      window.TSFriends.setTab('pending');
      const row = document.querySelector('#pending-list .pending-item[data-dir="in"]');
      return {
        accept: !!(row && row.querySelector('[data-accept]')),
        reject: !!(row && row.querySelector('[data-reject]')),
        badge: document.getElementById('ftab-pending-badge').textContent
      };
    })()`);
    assert.deepStrictEqual(ui, { accept: true, reject: true, badge: '1' });

    await evalJS(b.client, `document.querySelector('#pending-list [data-accept]').click()`);
    const fa = await evalJS(a.client, 'state.friendId');
    assert.strictEqual(await evalJS(b.client, `!!(state.friends[${JSON.stringify(fa)}] && state.friendRequests.length === 0)`), true);

    await waitFor(a.client, `!!state.friends[${JSON.stringify(fb)}]`, 20000, 'A kabulü almalı');
    const after = await evalJS(a.client, `(() => {
      window.TSFriends.setTab('pending');
      return {
        name: state.friends[${JSON.stringify(fb)}].name,
        outgoing: window.TSFriends.outgoingIds().length
      };
    })()`);
    assert.deepStrictEqual(after, { name: 'Alici B', outgoing: 0 });
  } finally {
    cleanupPeer(a);
    cleanupPeer(b);
  }
};

if (require.main === module) {
  module.exports().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
