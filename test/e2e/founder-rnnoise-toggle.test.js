// The founder owns the room-wide RNNoise policy. Verify that late joiners sync
// to it and that live changes replace outbound audio tracks without reconnecting.
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

async function setFounderToggle(founder, enabled) {
  await evalJS(founder.client, `(() => {
    const toggle = document.getElementById('founder-noise-suppression');
    toggle.checked = ${enabled};
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
}

module.exports = async function run() {
  const founder = await spawnPeer({ port: 9312, name: 'RNNoiseFounder' });
  const guest = await spawnPeer({ port: 9313, name: 'RNNoiseGuest' });

  try {
    const roomId = await createRoom(founder);

    // Deliberately choose the opposite local preference. The founder's hello
    // must override this for a participant joining after room creation.
    await evalJS(guest.client, `document.getElementById('join-useAI').checked = false; 1`);
    await joinRoom(guest, roomId);
    await waitForPeerConnected(founder);
    await waitForPeerConnected(guest);

    await waitFor(
      guest.client,
      `window.state && window.state.useAI === true && window.state.rnnoiseStatus === 'active'`,
      20000,
      'late joiner inherits founder RNNoise setting'
    );

    await evalJS(founder.client, `document.getElementById('founder-settings').click(); 1`);
    assert.strictEqual(
      await evalJS(founder.client, `document.getElementById('founder-noise-suppression').checked`),
      true,
      'founder modal reflects the active room policy'
    );

    const beforeFounder = await audioState(founder.client);
    const beforeGuest = await audioState(guest.client);

    await setFounderToggle(founder, false);
    for (const peer of [founder, guest]) {
      await waitFor(
        peer.client,
        `window.state && window.state.useAI === false
          && window.state.rnnoiseStatus === 'off'
          && window.state.noiseSuppressionApplyPromise === null`,
        20000,
        `${peer.name} disables RNNoise live`
      );
    }

    const offFounder = await audioState(founder.client);
    const offGuest = await audioState(guest.client);
    assert.notStrictEqual(offFounder.localTrackId, beforeFounder.localTrackId);
    assert.notStrictEqual(offGuest.localTrackId, beforeGuest.localTrackId);
    assert.strictEqual(offFounder.senderTrackId, offFounder.localTrackId);
    assert.strictEqual(offGuest.senderTrackId, offGuest.localTrackId);
    assert.ok(['connected', 'completed'].includes(offFounder.connectionState));
    assert.ok(['connected', 'completed'].includes(offGuest.connectionState));

    await setFounderToggle(founder, true);
    for (const peer of [founder, guest]) {
      await waitFor(
        peer.client,
        `window.state && window.state.useAI === true
          && window.state.rnnoiseStatus === 'active'
          && window.state.noiseSuppressionApplyPromise === null`,
        20000,
        `${peer.name} enables RNNoise live`
      );
    }

    const onFounder = await audioState(founder.client);
    const onGuest = await audioState(guest.client);
    assert.notStrictEqual(onFounder.localTrackId, offFounder.localTrackId);
    assert.notStrictEqual(onGuest.localTrackId, offGuest.localTrackId);
    assert.strictEqual(onFounder.senderTrackId, onFounder.localTrackId);
    assert.strictEqual(onGuest.senderTrackId, onGuest.localTrackId);
    assert.ok(onFounder.active && onGuest.active);
    assert.ok(['connected', 'completed'].includes(onFounder.connectionState));
    assert.ok(['connected', 'completed'].includes(onGuest.connectionState));
  } finally {
    cleanupPeer(founder);
    cleanupPeer(guest);
  }
};
