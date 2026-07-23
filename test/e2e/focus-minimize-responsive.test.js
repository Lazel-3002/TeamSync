const assert = require('assert');
const {
  spawnPeer,
  cleanupPeer,
  createRoom,
  evalJS,
} = require('./lib/harness');

async function inspectControls(peer) {
  return evalJS(
    peer.client,
    `(() => {
       const viewport = {
         width: document.documentElement.clientWidth,
         height: document.documentElement.clientHeight,
       };
       const ids = ['mic', 'deaf', 'share', 'wb-btn', 'act-btn', 'rec', 'vol', 'addip', 'addsdp', 'settings', 'leave'];
       const controls = ids.map(id => {
         const element = document.getElementById(id);
         if (!element) return { id, missing: true };
         const rect = element.getBoundingClientRect();
         const style = getComputedStyle(element);
         return {
           id,
           display: style.display,
           visibility: style.visibility,
           width: rect.width,
           height: rect.height,
           insideViewport:
             rect.left >= 0 &&
             rect.top >= 0 &&
             rect.right <= viewport.width &&
             rect.bottom <= viewport.height,
         };
       });
       return {
         viewport,
         focused: !!document.querySelector('.vcard.focused'),
         focusMode: document.querySelector('.main').classList.contains('focus-mode'),
         focusMinimized: document.getElementById('wb-card').classList.contains('focus-minimized'),
         layout: ['app', 'grid', 'wb-card'].map(id => {
           const element = document.getElementById(id) || document.querySelector('.' + id);
           const rect = element.getBoundingClientRect();
           return {
             id,
             rect: {
               left: rect.left,
               top: rect.top,
               right: rect.right,
               bottom: rect.bottom,
               width: rect.width,
               height: rect.height,
             },
             overflowX: getComputedStyle(element).overflowX,
             overflowY: getComputedStyle(element).overflowY,
             position: getComputedStyle(element).position,
             minWidth: getComputedStyle(element).minWidth,
             top: getComputedStyle(element).top,
             left: getComputedStyle(element).left,
             inlineStyle: element.getAttribute('style'),
           };
         }),
         focusControls: (() => {
           const element = document.getElementById('focus-controls');
           const rect = element.getBoundingClientRect();
           const style = getComputedStyle(element);
           return {
             parentId: element.parentElement && element.parentElement.id,
             display: style.display,
             visibility: style.visibility,
             buttonCount: element.querySelectorAll('button').length,
             rect: {
               left: rect.left,
               top: rect.top,
               right: rect.right,
               bottom: rect.bottom,
               width: rect.width,
               height: rect.height,
             },
             insideViewport:
               rect.left >= 0 &&
               rect.top >= 0 &&
               rect.right <= viewport.width &&
               rect.bottom <= viewport.height,
           };
         })(),
         controls,
       };
     })()`
  );
}

module.exports = async function run() {
  const peer = await spawnPeer({ port: 9375, name: 'Focus Responsive Test' });
  try {
    await peer.client.send('Emulation.setDeviceMetricsOverride', {
      width: 342,
      height: 720,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await createRoom(peer);

    await evalJS(
      peer.client,
      `document.getElementById('wb-card').classList.remove('hidden');
       makeCardFocusable(document.getElementById('wb-card'));
       enterFocus(document.getElementById('wb-card'));
       1`
    );
    await evalJS(peer.client, `document.getElementById('focus-exit-btn').click(); 1`);
    await new Promise(resolve => setTimeout(resolve, 250));

    const result = await inspectControls(peer);
    const unavailable = result.controls.filter(control =>
      control.missing ||
      control.display === 'none' ||
      control.visibility === 'hidden' ||
      control.width === 0 ||
      control.height === 0 ||
      !control.insideViewport
    );

    assert.strictEqual(result.focused, false, JSON.stringify(result, null, 2));
    assert.strictEqual(result.focusMode, false, JSON.stringify(result, null, 2));
    assert.strictEqual(result.focusMinimized, true, JSON.stringify(result, null, 2));
    assert.strictEqual(result.focusControls.parentId, 'wb-card', JSON.stringify(result, null, 2));
    assert.strictEqual(result.focusControls.display, 'flex', JSON.stringify(result, null, 2));
    assert.strictEqual(result.focusControls.visibility, 'visible', JSON.stringify(result, null, 2));
    assert.strictEqual(result.focusControls.buttonCount, 3, JSON.stringify(result, null, 2));
    assert.strictEqual(result.focusControls.insideViewport, true, JSON.stringify(result, null, 2));
    assert.deepStrictEqual(unavailable, [], JSON.stringify(result, null, 2));

    await evalJS(peer.client, `document.getElementById('focus-lock-btn').click(); 1`);
    assert.strictEqual(
      await evalJS(peer.client, `document.getElementById('focus-lock-btn').classList.contains('locked')`),
      true
    );
    await evalJS(peer.client, `document.getElementById('focus-lock-btn').click(); 1`);
    assert.strictEqual(
      await evalJS(peer.client, `document.getElementById('focus-lock-btn').classList.contains('locked')`),
      false
    );

    await evalJS(
      peer.client,
      `window.__focusFullscreenRequested = false;
       document.getElementById('wb-card').requestFullscreen = async () => {
         window.__focusFullscreenRequested = true;
       };
       document.getElementById('focus-fullscreen-btn').click();
       1`
    );
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.strictEqual(
      await evalJS(peer.client, `window.__focusFullscreenRequested`),
      true
    );
    assert.strictEqual(
      await evalJS(peer.client, `document.getElementById('wb-card').classList.contains('focused')`),
      true
    );

    await evalJS(peer.client, `document.getElementById('focus-exit-btn').click(); 1`);
    await evalJS(peer.client, `document.getElementById('focus-exit-btn').click(); 1`);
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.strictEqual(
      await evalJS(peer.client, `document.getElementById('wb-card').classList.contains('focused')`),
      true
    );
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
