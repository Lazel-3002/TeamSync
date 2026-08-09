const assert = require('assert');
const {
  spawnPeer,
  cleanupPeer,
  evalJS,
  waitFor,
} = require('./lib/harness');

module.exports = async function run() {
  const peer = await spawnPeer({ port: 9383, name: 'Offline Presence Test' });
  try {
    await waitFor(
      peer.client,
      `!document.getElementById('step-action').classList.contains('hidden')`,
      10000,
      'main menu'
    );

    const result = await evalJS(
      peer.client,
      `(() => {
        state.friends = {
          'KNK-OFFLINE': {
            name: 'Çevrimdışı Arkadaş',
            avatar: '',
            online: false,
            room: 'STALE-ROOM',
            isMuted: false
          }
        };
        renderFriends();

        const item = document.querySelector('#friends-list .friend-item');
        return {
          dotOnline: item.querySelector('.friend-status').classList.contains('online'),
          showsServerPresence: Boolean(item.querySelector('.friend-presence')),
          actionCount: item.querySelectorAll('.friend-actions button').length
        };
      })()`
    );

    assert.deepStrictEqual(result, {
      dotOnline: false,
      showsServerPresence: false,
      actionCount: 3
    });

    const cleared = await evalJS(
      peer.client,
      `(() => {
        const friend = state.friends['KNK-OFFLINE'];
        friend.online = true;
        friend.room = 'ROOM-1';
        friend.lastSeen = Date.now();
        markFriendOffline(friend);
        return { online: friend.online, room: friend.room, lastSeen: friend.lastSeen };
      })()`
    );

    assert.deepStrictEqual(cleared, { online: false, room: null, lastSeen: 0 });
  } finally {
    cleanupPeer(peer);
  }
};

if (require.main === module) {
  module.exports().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
