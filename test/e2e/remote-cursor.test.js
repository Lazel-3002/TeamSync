const assert = require('assert');
const { spawnPeer, cleanupPeer, cdp, evalJS, waitFor } = require('./lib/harness');

module.exports = async function run() {
  const peer = await spawnPeer({ port: 9311, name: 'CursorTester' });
  try {
    const result = await evalJS(peer.client, `
      (function() {
        const video = document.getElementById('remote-vid');
        const wrap = video.closest('.rwrap');
        const pointer = document.getElementById('remote-pointer');
        const sent = [];

        setAuthorizedCursorProfile('CursorTester', 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E');

        state.activeControl = { hostId: 'fake-host' };
        broadcastTo = function(peerId, message) { sent.push({ peerId, message }); };
        document.getElementById('remote-modal').classList.remove('hidden');
        Object.defineProperty(video, 'videoWidth', { configurable: true, value: 1920 });
        Object.defineProperty(video, 'videoHeight', { configurable: true, value: 1080 });
        const rect = { left: 0, top: 0, right: 960, bottom: 540, width: 960, height: 540 };
        video.getBoundingClientRect = function() { return rect; };
        wrap.getBoundingClientRect = function() { return rect; };

        const mouse = (type, button = 0) => video.dispatchEvent(new MouseEvent(type, {
          bubbles: true, cancelable: true, clientX: 480, clientY: 270, button
        }));

        mouse('mouseenter');
        mouse('mousemove');
        const passive = {
          visible: pointer.classList.contains('visible'),
          active: pointer.classList.contains('active'),
          avatar: document.getElementById('remote-pointer-avatar').getAttribute('src'),
          messages: sent.map(item => item.message.type)
        };

        mouse('mousedown');
        mouse('mouseup');
        mouse('click');
        const firstClick = {
          active: pointer.classList.contains('active'),
          messages: sent.map(item => item.message.type)
        };

        sent.length = 0;
        remoteOwnerConfirmed = true;
        state.controlOwner = 'remote';
        setHostPassivePointer({ x: 0.25, y: 0.25 }, true);
        mouse('mousedown');
        mouse('mouseup');
        mouse('click');
        const secondClick = {
          messages: sent.map(item => item.message.type),
          eventTypes: sent.filter(item => item.message.type === 'ctrl-event').map(item => item.message.event.type),
          hostPointerVisible: document.getElementById('host-passive-pointer').classList.contains('visible')
        };

        document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }));
        const afterEscape = {
          active: pointer.classList.contains('active'),
          hostPointerVisible: document.getElementById('host-passive-pointer').classList.contains('visible'),
          lastMessage: sent[sent.length - 1].message.type,
          status: document.getElementById('remote-control-state-text').textContent
        };
        return { passive, firstClick, secondClick, afterEscape };
      })()
    `, true);

    assert.strictEqual(result.passive.visible, true);
    assert.strictEqual(result.passive.active, false);
    assert.match(result.passive.avatar, /^data:image\/svg\+xml/);
    assert.deepStrictEqual(result.passive.messages, ['ctrl-pointer']);
    assert.deepStrictEqual(result.firstClick, { active: true, messages: ['ctrl-pointer', 'ctrl-takeover'] });
    assert.deepStrictEqual(result.secondClick.eventTypes, ['mousedown', 'mouseup']);
    assert.strictEqual(result.secondClick.hostPointerVisible, true);
    assert.strictEqual(result.afterEscape.active, false);
    assert.strictEqual(result.afterEscape.hostPointerVisible, false);
    assert.strictEqual(result.afterEscape.lastMessage, 'ctrl-release');
    assert.match(result.afterEscape.status, /İzleme modu/);

    const mainProcessResult = await evalJS(peer.client, `
      (async function() {
        window.electronAPI.setRemoteControl(true);
        await new Promise(resolve => setTimeout(resolve, 100));
        window.electronAPI.updateControlPointer({
          x: 0.4,
          y: 0.6,
          label: 'CursorTester',
          avatar: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E'
        });
        return window.electronAPI.setControlOwner('remote');
      })()
    `, true);
    assert.strictEqual(mainProcessResult.owner, 'remote');
    assert.ok(mainProcessResult.hostPoint.x >= 0 && mainProcessResult.hostPoint.x <= 1);
    assert.ok(mainProcessResult.hostPoint.y >= 0 && mainProcessResult.hostPoint.y <= 1);

    const targets = await (await fetch(`http://127.0.0.1:${peer.port}/json/list`)).json();
    const overlayTarget = targets.find(target => target.type === 'page' && target.url.includes('cursor-overlay.html'));
    assert.ok(overlayTarget, 'Desktop cursor overlay window was not created');
    const overlayClient = cdp(overlayTarget.webSocketDebuggerUrl);
    await overlayClient.ready;
    await overlayClient.send('Runtime.enable');
    await waitFor(overlayClient, `document.readyState === 'complete' && document.getElementById('cursor').classList.contains('visible')`, 5000, 'cursor overlay visible');
    const overlayState = await evalJS(overlayClient, `({
      visible: document.getElementById('cursor').classList.contains('visible'),
      label: document.getElementById('label').textContent
    })`);
    assert.deepStrictEqual(overlayState, { visible: true, label: 'Paylaşan' });
    const overlayProfile = await evalJS(overlayClient, `({
      visible: document.getElementById('active-profile').classList.contains('visible'),
      avatar: document.querySelector('#active-profile img').getAttribute('src')
    })`);
    assert.strictEqual(overlayProfile.visible, true);
    assert.match(overlayProfile.avatar, /^data:image\/svg\+xml/);
    overlayClient.ws.close();
    await evalJS(peer.client, `window.electronAPI.setRemoteControl(false); true`);
  } finally {
    cleanupPeer(peer);
  }
};
