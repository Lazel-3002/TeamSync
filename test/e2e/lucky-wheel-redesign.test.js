const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  spawnPeer,
  cleanupPeer,
  createRoom,
  evalJS,
  waitFor,
} = require('./lib/harness');

async function inspectWheel(peer) {
  return evalJS(
    peer.client,
    `(() => {
      const card = document.getElementById('wheel-card');
      const close = document.getElementById('wheel-close');
      const canvas = document.getElementById('wheel-canvas');
      const overlay = document.getElementById('wheel-winner-overlay');
      const cardRect = card.getBoundingClientRect();
      const closeRect = close.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      return {
        viewport: {
          width: document.documentElement.clientWidth,
          height: document.documentElement.clientHeight,
        },
        cardRect: {
          left: cardRect.left, top: cardRect.top, right: cardRect.right,
          bottom: cardRect.bottom, width: cardRect.width, height: cardRect.height,
        },
        closeRect: {
          left: closeRect.left, top: closeRect.top, right: closeRect.right,
          bottom: closeRect.bottom, width: closeRect.width, height: closeRect.height,
        },
        canvasRect: {
          width: canvasRect.width, height: canvasRect.height,
        },
        itemCount: document.querySelectorAll('.wheel-item-row').length,
        playItemCount: document.querySelectorAll('.wheel-play-item').length,
        setupHidden: document.getElementById('wheel-setup').classList.contains('hidden'),
        playHidden: document.getElementById('wheel-play').classList.contains('hidden'),
        overlayHidden: overlay.classList.contains('hidden'),
        winner: document.getElementById('wheel-winner-text').textContent,
        transform: canvas.style.transform,
        historyCount: document.querySelectorAll('.wheel-history-item').length,
        unsafeImageCount: document.querySelectorAll('#wheel-items-list img').length,
      };
    })()`
  );
}

async function screenshot(peer, name) {
  const result = await peer.client.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  const output = path.join(process.env.TEMP, name);
  fs.writeFileSync(output, Buffer.from(result.result.data, 'base64'));
  return output;
}

module.exports = async function run() {
  const peer = await spawnPeer({ port: 9386, name: 'Lucky Wheel Test' });
  try {
    await peer.client.send('Emulation.setDeviceMetricsOverride', {
      width: 1100,
      height: 760,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await createRoom(peer);
    await evalJS(
      peer.client,
      `openCardFocused('wheel-card');
       window.__wheelSpinDurationMs = 120;
       1`
    );
    await new Promise(resolve => setTimeout(resolve, 300));

    await evalJS(
      peer.client,
      `document.querySelector('[data-wheel-items="Film|Dizi|Oyun|Müzik"]').click();
       document.getElementById('wheel-new-item').value = '<img src=x onerror=alert(1)>';
       document.getElementById('wheel-new-item').dispatchEvent(new Event('input', { bubbles: true }));
       document.getElementById('wheel-add-item').click();
       1`
    );

    const safetyCheck = await inspectWheel(peer);
    assert.strictEqual(safetyCheck.itemCount, 5, JSON.stringify(safetyCheck, null, 2));
    assert.strictEqual(safetyCheck.unsafeImageCount, 0, JSON.stringify(safetyCheck, null, 2));
    await evalJS(
      peer.client,
      `document.querySelector('[data-wheel-items="Film|Dizi|Oyun|Müzik"]').click(); 1`
    );
    const setup = await inspectWheel(peer);
    assert.strictEqual(setup.itemCount, 4, JSON.stringify(setup, null, 2));
    assert.strictEqual(
      await evalJS(peer.client, `document.getElementById('wheel-ready').disabled`),
      false
    );
    const setupScreenshot = await screenshot(peer, 'teamsync-lucky-wheel-setup.png');

    await evalJS(peer.client, `document.getElementById('wheel-ready').click(); 1`);
    await new Promise(resolve => setTimeout(resolve, 100));
    const ready = await inspectWheel(peer);
    assert.strictEqual(ready.setupHidden, true, JSON.stringify(ready, null, 2));
    assert.strictEqual(ready.playHidden, false, JSON.stringify(ready, null, 2));
    assert.strictEqual(ready.playItemCount, 4, JSON.stringify(ready, null, 2));
    assert.ok(ready.canvasRect.width > 220, JSON.stringify(ready, null, 2));
    assert.ok(Math.abs(ready.canvasRect.width - ready.canvasRect.height) < 1, JSON.stringify(ready, null, 2));

    await evalJS(peer.client, `document.getElementById('wheel-spin-btn').click(); 1`);
    assert.strictEqual(
      await evalJS(peer.client, `document.getElementById('wheel-spin-btn').disabled`),
      true
    );
    await waitFor(
      peer.client,
      `!document.getElementById('wheel-winner-overlay').classList.contains('hidden')`,
      5000,
      'wheel winner'
    );

    const result = await inspectWheel(peer);
    const items = ['Film', 'Dizi', 'Oyun', 'Müzik'];
    assert.ok(items.includes(result.winner), JSON.stringify(result, null, 2));
    assert.strictEqual(result.historyCount, 1, JSON.stringify(result, null, 2));
    assert.match(result.transform, /^rotate\([0-9.]+deg\)$/);

    const winnerIndex = items.indexOf(result.winner);
    const targetRotation = Number(result.transform.match(/rotate\(([0-9.]+)deg\)/)[1]);
    const normalized = ((targetRotation % 360) + 360) % 360;
    const expected = ((-winnerIndex * (360 / items.length)) % 360 + 360) % 360;
    assert.ok(Math.abs(normalized - expected) < 0.001, JSON.stringify({ result, normalized, expected }, null, 2));
    const resultScreenshot = await screenshot(peer, 'teamsync-lucky-wheel-result.png');

    await peer.client.send('Emulation.setDeviceMetricsOverride', {
      width: 850,
      height: 600,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await new Promise(resolve => setTimeout(resolve, 250));
    const responsive = await inspectWheel(peer);
    assert.ok(responsive.cardRect.left >= 0, JSON.stringify(responsive, null, 2));
    assert.ok(responsive.cardRect.top >= 0, JSON.stringify(responsive, null, 2));
    assert.ok(responsive.cardRect.right <= responsive.viewport.width, JSON.stringify(responsive, null, 2));
    assert.ok(responsive.cardRect.bottom <= responsive.viewport.height, JSON.stringify(responsive, null, 2));
    assert.ok(responsive.closeRect.width > 0 && responsive.closeRect.height > 0, JSON.stringify(responsive, null, 2));
    assert.ok(responsive.closeRect.right <= responsive.viewport.width, JSON.stringify(responsive, null, 2));
    const responsiveScreenshot = await screenshot(peer, 'teamsync-lucky-wheel-responsive.png');

    await evalJS(
      peer.client,
      `document.getElementById('wheel-winner-close').click();
       document.getElementById('wheel-reset-btn').click();
       1`
    );
    const reset = await inspectWheel(peer);
    assert.strictEqual(reset.setupHidden, false, JSON.stringify(reset, null, 2));
    assert.strictEqual(reset.playHidden, true, JSON.stringify(reset, null, 2));
    assert.strictEqual(reset.overlayHidden, true, JSON.stringify(reset, null, 2));

    if (require.main === module) {
      console.log(setupScreenshot);
      console.log(resultScreenshot);
      console.log(responsiveScreenshot);
    }
  } finally {
    cleanupPeer(peer);
  }
};

if (require.main === module) {
  module.exports()
    .then(() => console.log('PASS lucky-wheel-redesign'))
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
}
