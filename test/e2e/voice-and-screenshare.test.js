// Regression guard for "we couldn't hear each other": two real Electron
// instances join the same room and must exchange live audio RTP. Also
// exercises screen share end-to-end, since it rides the same signaling/ICE
// path as voice.
const assert = require('assert');
const { spawnPeer, cleanupPeer, createRoom, joinRoom, waitForPeerConnected, evalJS } = require('./lib/harness');

async function inboundRtpStats(peerClient, kind) {
  return evalJS(peerClient, `
    (async function() {
      const peer = Array.from(window.state.peers.values())[0];
      if (!peer || !peer.pc) return null;
      const stats = await peer.pc.getStats();
      let out = null;
      stats.forEach(r => { if (r.type === 'inbound-rtp' && r.kind === ${JSON.stringify(kind)}) out = { bytesReceived: r.bytesReceived, packetsReceived: r.packetsReceived, framesDecoded: r.framesDecoded }; });
      return out;
    })()
  `, true);
}

module.exports = async function run() {
  const a = await spawnPeer({ port: 9301, name: 'PeerA' });
  const b = await spawnPeer({ port: 9302, name: 'PeerB' });
  try {
    const roomId = await createRoom(a);
    await joinRoom(b, roomId);
    await waitForPeerConnected(a);
    await waitForPeerConnected(b);
    await new Promise(r => setTimeout(r, 3000)); // let fake audio RTP flow

    const statsA = await inboundRtpStats(a.client, 'audio');
    const statsB = await inboundRtpStats(b.client, 'audio');
    assert.ok(statsA && statsA.bytesReceived > 0, 'PeerA received no audio RTP from PeerB: ' + JSON.stringify(statsA));
    assert.ok(statsB && statsB.bytesReceived > 0, 'PeerB received no audio RTP from PeerA: ' + JSON.stringify(statsB));

    // Screen share: A shares, B must receive live video RTP.
    const sourceId = await evalJS(a.client, `
      (async function() {
        const sources = await window.electronAPI.getSources();
        return sources[0] ? sources[0].id : null;
      })()
    `, true);
    assert.ok(sourceId, 'No screen source available to test screen share');

    await evalJS(a.client, `startScreenShare(${JSON.stringify(sourceId)})`, true);
    await new Promise(r => setTimeout(r, 3000));

    const videoStatsB = await inboundRtpStats(b.client, 'video');
    assert.ok(videoStatsB && videoStatsB.bytesReceived > 0, 'PeerB received no screen-share video RTP from PeerA: ' + JSON.stringify(videoStatsB));
  } finally {
    cleanupPeer(a);
    cleanupPeer(b);
  }
};
