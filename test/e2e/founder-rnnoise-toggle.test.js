// RNNoise is a personal microphone preference. Verify that each participant
// can change their own outbound audio without changing anyone else's filter.
const assert = require('assert');
const {
  spawnPeer,
  cleanupPeer,
  createRoom,
  joinRoom,
  waitForPeerConnected,
  evalJS,
  waitFor,
} = require('./lib/harness');

function audioState(client) {
  return evalJS(client, `(() => {
    const peer = window.state && window.state.peers
      ? Array.from(window.state.peers.values())[0]
      : null;
    const sender = peer && peer.pc
      ? peer.pc.getSenders().find(item => item.track && item.track.kind === 'audio')
      : null;
    const localTrack = window.state && window.state.localStream
      ? window.state.localStream.getAudioTracks()[0]
      : null;
    return {
      enabled: !!(window.state && window.state.useAI),
      active: !!(window.state && window.state.rnnoiseActive),
      status: window.state && window.state.rnnoiseStatus,
      localTrackId: localTrack && localTrack.id,
      senderTrackId: sender && sender.track && sender.track.id,
      connectionState: peer && peer.pc && peer.pc.iceConnectionState
    };
  })()`);
}

async function setPersonalToggle(peer, enabled) {
  const value = enabled ? 1 : 0;
  await evalJS(peer.client, `(() => {
    localStorage.setItem('teamsync_noise_suppression', String(${value}));
    return applyRoomNoiseSuppression(${enabled});
  })()`, true);
}

module.exports = async function run() {
  const founder = await spawnPeer({ port: 9312, name: 'RNNoiseFounder' });
  const guest = await spawnPeer({ port: 9313, name: 'RNNoiseGuest' });

  try {
    const roomId = await createRoom(founder);
    // Guest deliberately starts with a different personal preference.
    await setPersonalToggle(guest, false);
    await joinRoom(guest, roomId);
    await waitForPeerConnected(founder);
    await waitForPeerConnected(guest);

    await waitFor(
      guest.client,
      `window.state && window.state.useAI === false
        && window.state.rnnoiseStatus === 'off'`,
      20000,
      'guest keeps their personal RNNoise setting'
    );

    const beforeFounder = await audioState(founder.client);
    const beforeGuest = await audioState(guest.client);
    assert.strictEqual(beforeFounder.enabled, true);
    assert.strictEqual(beforeGuest.enabled, false);

    // Changing the founder's preference must not change the guest.
    await setPersonalToggle(founder, false);
    await waitFor(founder.client, `window.state && window.state.useAI === false && window.state.noiseSuppressionApplyPromise === null`, 20000, 'founder disables personal RNNoise');
    await waitFor(guest.client, `window.state && window.state.useAI === false && window.state.noiseSuppressionApplyPromise === null`, 20000, 'guest remains disabled');

    const offFounder = await audioState(founder.client);
    assert.notStrictEqual(offFounder.localTrackId, beforeFounder.localTrackId);
    assert.strictEqual(offFounder.senderTrackId, offFounder.localTrackId);
    assert.ok(['connected', 'completed'].includes(offFounder.connectionState));

    // The guest can enable their own filter independently.
    await setPersonalToggle(guest, true);
    await waitFor(guest.client, `window.state && window.state.useAI === true && window.state.noiseSuppressionApplyPromise === null`, 20000, 'guest enables personal RNNoise');
    const onGuest = await audioState(guest.client);
    assert.notStrictEqual(onGuest.localTrackId, beforeGuest.localTrackId);
    assert.strictEqual(onGuest.senderTrackId, onGuest.localTrackId);
    assert.ok(['connected', 'completed'].includes(onGuest.connectionState));
  } finally {
    cleanupPeer(founder);
    cleanupPeer(guest);
  }
};
