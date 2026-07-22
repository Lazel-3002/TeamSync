const assert = require('assert');
const { spawnPeer, cleanupPeer, evalJS } = require('./lib/harness');

module.exports = async function run() {
  const peer = await spawnPeer({ port: 9311, name: 'CursorTester' });
  try {
    const result = await evalJS(peer.client, `
      (function() {
        const video = document.getElementById('remote-vid');
        const wrap = video.closest('.rwrap');
        const pointer = document.getElementById('remote-pointer');
        const sent = [];

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
        const passive = { visible: pointer.classList.contains('visible'), active: pointer.classList.contains('active'), sent: sent.length };

        mouse('mousedown');
        mouse('mouseup');
        mouse('click');
        const firstClick = { active: pointer.classList.contains('active'), types: sent.map(item => item.message.event.type) };

        mouse('mousedown');
        mouse('mouseup');
        mouse('click');
        const secondClick = { types: sent.map(item => item.message.event.type) };

        document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }));
        const afterEscape = {
          active: pointer.classList.contains('active'),
          status: document.getElementById('remote-control-state-text').textContent
        };
        return { passive, firstClick, secondClick, afterEscape };
      })()
    `, true);

    assert.deepStrictEqual(result.passive, { visible: true, active: false, sent: 0 });
    assert.deepStrictEqual(result.firstClick, { active: true, types: ['mousemove'] });
    assert.deepStrictEqual(result.secondClick.types, ['mousemove', 'mousedown', 'mouseup']);
    assert.strictEqual(result.afterEscape.active, false);
    assert.match(result.afterEscape.status, /İzleme modu/);
  } finally {
    cleanupPeer(peer);
  }
};
