const assert = require('assert');
const fs = require('fs');
const path = require('path');
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
         layout: ['app', 'sidebar', 'main', 'focus-area', 'grid', 'bar', 'wb-card'].map(id => {
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
             parentClass: element.parentElement && element.parentElement.className,
             display: style.display,
             visibility: style.visibility,
             position: style.position,
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
    assert.ok(String(result.focusControls.parentClass).includes('main'), JSON.stringify(result, null, 2));
    assert.strictEqual(result.focusControls.display, 'flex', JSON.stringify(result, null, 2));
    assert.strictEqual(result.focusControls.visibility, 'visible', JSON.stringify(result, null, 2));
    assert.strictEqual(result.focusControls.position, 'fixed', JSON.stringify(result, null, 2));
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
    const restored = await inspectControls(peer);
    const focusedCard = restored.layout.find(item => item.id === 'wb-card');
    assert.ok(focusedCard.rect.width >= 240, JSON.stringify(restored, null, 2));
    assert.ok(focusedCard.rect.height >= 180, JSON.stringify(restored, null, 2));
    assert.ok(focusedCard.rect.left >= 0, JSON.stringify(restored, null, 2));
    assert.ok(focusedCard.rect.top >= 0, JSON.stringify(restored, null, 2));
    assert.ok(focusedCard.rect.right <= restored.viewport.width, JSON.stringify(restored, null, 2));
    assert.ok(focusedCard.rect.bottom <= restored.viewport.height, JSON.stringify(restored, null, 2));
    assert.strictEqual(restored.focusControls.insideViewport, true, JSON.stringify(restored, null, 2));

    if (require.main === module) {
      const screenshot = await peer.client.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      });
      const screenshotPath = path.join(
        process.env.TEMP,
        'teamsync-focus-responsive.png'
      );
      fs.writeFileSync(screenshotPath, Buffer.from(screenshot.result.data, 'base64'));
      console.log(screenshotPath);
    }

    await peer.client.send('Emulation.setDeviceMetricsOverride', {
      width: 850,
      height: 600,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await new Promise(resolve => setTimeout(resolve, 250));
    const minimumWindow = await inspectControls(peer);
    const minimumWindowCard = minimumWindow.layout.find(item => item.id === 'wb-card');
    assert.ok(minimumWindowCard.rect.width >= 240, JSON.stringify(minimumWindow, null, 2));
    assert.ok(minimumWindowCard.rect.height >= 180, JSON.stringify(minimumWindow, null, 2));
    assert.ok(minimumWindowCard.rect.left >= 0, JSON.stringify(minimumWindow, null, 2));
    assert.ok(minimumWindowCard.rect.top >= 0, JSON.stringify(minimumWindow, null, 2));
    assert.ok(minimumWindowCard.rect.right <= minimumWindow.viewport.width, JSON.stringify(minimumWindow, null, 2));
    assert.ok(minimumWindowCard.rect.bottom <= minimumWindow.viewport.height, JSON.stringify(minimumWindow, null, 2));
    assert.strictEqual(minimumWindow.focusControls.insideViewport, true, JSON.stringify(minimumWindow, null, 2));

    if (require.main === module) {
      const screenshot = await peer.client.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      });
      const screenshotPath = path.join(
        process.env.TEMP,
        'teamsync-focus-min-window.png'
      );
      fs.writeFileSync(screenshotPath, Buffer.from(screenshot.result.data, 'base64'));
      console.log(screenshotPath);
    }

    await evalJS(peer.client, `document.getElementById('focus-exit-btn').click(); 1`);
    await new Promise(resolve => setTimeout(resolve, 250));
    const minimizedAtMinimumWindow = await inspectControls(peer);
    assert.strictEqual(minimizedAtMinimumWindow.focusMinimized, true, JSON.stringify(minimizedAtMinimumWindow, null, 2));
    assert.ok(
      String(minimizedAtMinimumWindow.focusControls.parentClass).includes('main'),
      JSON.stringify(minimizedAtMinimumWindow, null, 2)
    );
    assert.strictEqual(
      minimizedAtMinimumWindow.focusControls.position,
      'fixed',
      JSON.stringify(minimizedAtMinimumWindow, null, 2)
    );
    assert.strictEqual(
      minimizedAtMinimumWindow.focusControls.buttonCount,
      3,
      JSON.stringify(minimizedAtMinimumWindow, null, 2)
    );
    assert.strictEqual(
      minimizedAtMinimumWindow.focusControls.insideViewport,
      true,
      JSON.stringify(minimizedAtMinimumWindow, null, 2)
    );

    if (require.main === module) {
      const screenshot = await peer.client.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      });
      const screenshotPath = path.join(
        process.env.TEMP,
        'teamsync-focus-controls-minimized.png'
      );
      fs.writeFileSync(screenshotPath, Buffer.from(screenshot.result.data, 'base64'));
      console.log(screenshotPath);
    }

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
