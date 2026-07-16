// Regression guard: removePeer() must detach the departing peer's audio/video
// elements from the DOM, not just drop the state.peers entry (it used to leak
// <audio>/<video> elements on every disconnect).
const assert = require('assert');
const { spawnPeer, cleanupPeer, createRoom, joinRoom, waitForPeerConnected, evalJS } = require('./lib/harness');

module.exports = async function run() {
  const a = await spawnPeer({ port: 9303, name: 'PeerA' });
  const b = await spawnPeer({ port: 9304, name: 'PeerB' });
  try {
    const roomId = await createRoom(a);
    await joinRoom(b, roomId);
    await waitForPeerConnected(a);

    await evalJS(a.client, `
      (function() {
        const id = Array.from(window.state.peers.keys())[0];
        const p = window.state.peers.get(id);
        window.__oldAudioElForTest = p && p.audioEl;
        window.__testPeerId = id;
      })()
    `);

    await evalJS(b.client, `Array.from(window.state.peers.values()).forEach(p => p.pc.close()); 1`);
    const removeResult = await evalJS(a.client, `
      (function() {
        try { removePeer(window.__testPeerId); return 'ok'; }
        catch (e) { return 'ERROR: ' + e.message; }
      })()
    `);
    assert.strictEqual(removeResult, 'ok', 'removePeer threw: ' + removeResult);

    const oldElStillInDom = await evalJS(a.client, `document.body.contains(window.__oldAudioElForTest)`);
    assert.strictEqual(oldElStillInDom, false, 'removePeer left the old audio element attached to the DOM');
  } finally {
    cleanupPeer(a);
    cleanupPeer(b);
  }
};
