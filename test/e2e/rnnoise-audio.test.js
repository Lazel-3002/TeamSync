// Regression guard: the real vendored RNNoise WASM AudioWorklet must become
// the outbound microphone track source in a real Electron renderer.
const assert = require('assert');
const { spawnPeer, cleanupPeer, createRoom, evalJS, waitFor } = require('./lib/harness');

module.exports = async function run() {
  const peer = await spawnPeer({ port: 9311, name: 'RNNoisePeer' });
  try {
    await createRoom(peer);
    await waitFor(
      peer.client,
      `window.state && (window.state.rnnoiseStatus === 'active' || window.state.rnnoiseStatus === 'fallback')`,
      15000,
      'RNNoise initialization'
    );
    // AudioWorkletProcessor initializes its WASM module asynchronously. Give a
    // delayed processor error time to trigger the production fallback handler.
    await new Promise(resolve => setTimeout(resolve, 1500));

    const result = await evalJS(peer.client, `
      ({
        requested: window.state.useAI,
        active: window.state.rnnoiseActive,
        status: window.state.rnnoiseStatus,
        hasFilter: !!(window.state.audioNodes && window.state.audioNodes.rnnoiseFilterNode),
        hasOutboundAudio: !!(window.state.localStream && window.state.localStream.getAudioTracks()[0])
      })
    `);

    assert.deepStrictEqual(result, {
      requested: true,
      active: true,
      status: 'active',
      hasFilter: true,
      hasOutboundAudio: true
    });
  } finally {
    cleanupPeer(peer);
  }
};
