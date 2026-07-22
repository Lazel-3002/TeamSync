const assert = require('assert');
const {
  spawnPeer, cleanupPeer, createRoom, joinRoom, waitForPeerConnected,
  evalJS, waitFor, clickWhenReady
} = require('./lib/harness');

module.exports = async function run() {
  const host = await spawnPeer({ port: 9312, name: 'ShareHost' });
  const controller = await spawnPeer({ port: 9313, name: 'Controller' });
  try {
    const roomId = await createRoom(host);
    await joinRoom(controller, roomId);
    await waitForPeerConnected(host);
    await waitForPeerConnected(controller);

    await evalJS(controller.client, `requestControl(Array.from(state.peers.keys())[0]); true`);
    await waitFor(host.client, `!document.getElementById('ctrl-modal').classList.contains('hidden')`, 10000, 'control request');
    await clickWhenReady(host.client, 'ctrl-accept');
    await waitFor(controller.client, `state.activeControl && state.controlOwner === 'host'`, 10000, 'control accepted');

    await evalJS(controller.client, `
      broadcastTo(state.activeControl.hostId, { type: 'ctrl-pointer', point: { x: 0.2, y: 0.3 } });
      true
    `);
    await waitFor(host.client, `state.remoteControlPointer && state.remoteControlPointer.x === 0.2`, 10000, 'remote pointer mirrored');

    await evalJS(controller.client, `
      broadcastTo(state.activeControl.hostId, { type: 'ctrl-takeover', point: { x: 0.2, y: 0.3 } });
      true
    `);
    await waitFor(host.client, `state.controlOwner === 'remote'`, 10000, 'host yielded control');
    await waitFor(controller.client, `state.controlOwner === 'remote'`, 10000, 'controller received ownership');

    await evalJS(controller.client, `
      broadcastTo(state.activeControl.hostId, { type: 'ctrl-release' });
      true
    `);
    await waitFor(host.client, `state.controlOwner === 'host'`, 10000, 'host regained control');
    await waitFor(controller.client, `state.controlOwner === 'host'`, 10000, 'controller returned to passive mode');

    const result = await evalJS(host.client, `({
      controlledBy: !!state.controlledBy,
      owner: state.controlOwner,
      pointer: state.remoteControlPointer
    })`);
    assert.strictEqual(result.controlledBy, true);
    assert.strictEqual(result.owner, 'host');
    assert.deepStrictEqual(result.pointer, { x: 0.2, y: 0.3 });
  } finally {
    cleanupPeer(host);
    cleanupPeer(controller);
  }
};
