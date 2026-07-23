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

    const blockedClientRequest = await evalJS(controller.client, `requestControl(Array.from(state.peers.keys())[0])`);
    assert.strictEqual(blockedClientRequest, false);

    const noShareResponse = await evalJS(host.client, `
      (async function() {
        const sent = [];
        state.peers.set('__control_probe__', {
          name: 'Probe', avatar: null, dc: {
            readyState: 'open',
            send: raw => sent.push(JSON.parse(raw))
          }
        });
        await handleDataMessage('__control_probe__', { type: 'ctrl-req', reqId: 'no-share' });
        state.peers.delete('__control_probe__');
        return sent.find(message => message.type === 'ctrl-res');
      })()
    `, true);
    assert.strictEqual(noShareResponse.accepted, false);
    assert.strictEqual(noShareResponse.reason, 'not-sharing');

    await evalJS(host.client, `state.isSharing = true; broadcast({ type: 'sharing', sharing: true }); true`);
    await waitFor(controller.client, `Array.from(state.peers.values()).some(peer => peer.sharing)`, 10000, 'screen sharing state');
    await evalJS(controller.client, `state.myAvatar = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E'; true`);

    const blockedClosedScreenRequest = await evalJS(controller.client, `requestControl(Array.from(state.peers.keys())[0])`);
    assert.strictEqual(blockedClosedScreenRequest, false);

    await waitFor(controller.client, `!!document.querySelector('.inactive-overlay button')`, 10000, 'screen share open button');
    await evalJS(controller.client, `document.querySelector('.inactive-overlay button').click(); true`);
    const openScreenRequest = await evalJS(controller.client, `requestControl(Array.from(state.peers.keys())[0])`);
    assert.strictEqual(openScreenRequest, true);
    await waitFor(host.client, `!document.getElementById('ctrl-modal').classList.contains('hidden')`, 10000, 'control request');
    await clickWhenReady(host.client, 'ctrl-accept');
    await waitFor(controller.client, `state.activeControl && state.controlOwner === 'host'`, 10000, 'control accepted');

    const cursorAvatar = await evalJS(controller.client, `document.getElementById('remote-pointer-avatar').getAttribute('src')`);
    assert.match(cursorAvatar, /^data:image\/svg\+xml/);

    const busyResponse = await evalJS(host.client, `
      (async function() {
        const sent = [];
        state.peers.set('__second_controller__', {
          name: 'Second Controller', avatar: null, dc: {
            readyState: 'open',
            send: raw => sent.push(JSON.parse(raw))
          }
        });
        await handleDataMessage('__second_controller__', { type: 'ctrl-req', reqId: 'second-request' });
        state.peers.delete('__second_controller__');
        return sent.find(message => message.type === 'ctrl-res');
      })()
    `, true);
    assert.strictEqual(busyResponse.accepted, false);
    assert.strictEqual(busyResponse.reason, 'busy');

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

    await evalJS(host.client, `stopScreenShare(); true`);
    await waitFor(host.client, `!state.controlledBy`, 5000, 'control revoked with screen share');
    await waitFor(controller.client, `!state.activeControl`, 10000, 'controller closed with screen share');
  } finally {
    cleanupPeer(host);
    cleanupPeer(controller);
  }
};
