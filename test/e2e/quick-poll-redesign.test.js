const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  spawnPeer,
  cleanupPeer,
  createRoom,
  evalJS,
} = require('./lib/harness');

async function inspectPoll(peer) {
  return evalJS(
    peer.client,
    `(() => {
      const card = document.getElementById('poll-card');
      const close = document.getElementById('poll-close');
      const newPoll = document.getElementById('poll-new');
      const cardRect = card.getBoundingClientRect();
      const closeRect = close.getBoundingClientRect();
      const newRect = newPoll.getBoundingClientRect();
      const optionButtons = Array.from(document.querySelectorAll('#poll-opts-container .poll-opt'));
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
        newRect: {
          left: newRect.left, top: newRect.top, right: newRect.right,
          bottom: newRect.bottom, width: newRect.width, height: newRect.height,
        },
        editorRows: document.querySelectorAll('.poll-option-editor').length,
        previewRows: document.querySelectorAll('.poll-preview-options > div').length,
        previewQuestion: document.getElementById('poll-preview-question').textContent,
        createDisabled: document.getElementById('poll-create').disabled,
        setupHidden: document.getElementById('poll-setup').classList.contains('hidden'),
        viewHidden: document.getElementById('poll-view').classList.contains('hidden'),
        question: document.getElementById('poll-view-q').textContent,
        total: document.getElementById('poll-donut-total').textContent,
        totalLabel: document.getElementById('poll-total-votes').textContent,
        leader: document.getElementById('poll-leader-text').textContent,
        optionCount: optionButtons.length,
        checked: optionButtons.map(button => button.getAttribute('aria-checked')),
        percentages: optionButtons.map(button => button.querySelector('.poll-opt-metric strong').textContent),
        disabled: optionButtons.map(button => button.disabled),
        ended: !document.getElementById('poll-finished-banner').classList.contains('hidden'),
        endHidden: document.getElementById('poll-end').classList.contains('hidden'),
        newHidden: document.getElementById('poll-new').classList.contains('hidden'),
        unsafeImages: document.querySelectorAll('#poll-card img').length,
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
  const peer = await spawnPeer({ port: 9387, name: 'Quick Poll Test' });
  try {
    await peer.client.send('Emulation.setDeviceMetricsOverride', {
      width: 1100,
      height: 760,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await createRoom(peer);
    await evalJS(peer.client, `openCardFocused('poll-card'); 1`);
    await new Promise(resolve => setTimeout(resolve, 300));

    await evalJS(
      peer.client,
      `document.querySelector('[data-question="Bu akşam ne yapalım?"]').click(); 1`
    );
    let setup = await inspectPoll(peer);
    assert.strictEqual(setup.editorRows, 4, JSON.stringify(setup, null, 2));
    assert.strictEqual(setup.previewRows, 4, JSON.stringify(setup, null, 2));
    assert.strictEqual(setup.previewQuestion, 'Bu akşam ne yapalım?', JSON.stringify(setup, null, 2));
    assert.strictEqual(setup.createDisabled, false, JSON.stringify(setup, null, 2));

    await evalJS(
      peer.client,
      `document.getElementById('poll-opt1').value = '<img src=x onerror=alert(1)>';
       document.getElementById('poll-opt1').dispatchEvent(new Event('input', { bubbles: true }));
       1`
    );
    const safety = await inspectPoll(peer);
    assert.strictEqual(safety.unsafeImages, 0, JSON.stringify(safety, null, 2));

    await evalJS(
      peer.client,
      `document.querySelector('[data-question="Bu akşam ne yapalım?"]').click(); 1`
    );
    setup = await inspectPoll(peer);
    const setupScreenshot = await screenshot(peer, 'teamsync-quick-poll-setup.png');

    await evalJS(peer.client, `document.getElementById('poll-create').click(); 1`);
    await new Promise(resolve => setTimeout(resolve, 100));
    let live = await inspectPoll(peer);
    assert.strictEqual(live.setupHidden, true, JSON.stringify(live, null, 2));
    assert.strictEqual(live.viewHidden, false, JSON.stringify(live, null, 2));
    assert.strictEqual(live.question, 'Bu akşam ne yapalım?', JSON.stringify(live, null, 2));
    assert.strictEqual(live.optionCount, 4, JSON.stringify(live, null, 2));
    assert.strictEqual(live.endHidden, false, JSON.stringify(live, null, 2));

    await evalJS(peer.client, `document.querySelectorAll('#poll-opts-container .poll-opt')[0].click(); 1`);
    live = await inspectPoll(peer);
    assert.strictEqual(live.total, '1', JSON.stringify(live, null, 2));
    assert.deepStrictEqual(live.checked, ['true', 'false', 'false', 'false'], JSON.stringify(live, null, 2));

    await evalJS(peer.client, `document.querySelectorAll('#poll-opts-container .poll-opt')[1].click(); 1`);
    live = await inspectPoll(peer);
    assert.strictEqual(live.total, '1', JSON.stringify(live, null, 2));
    assert.deepStrictEqual(live.checked, ['false', 'true', 'false', 'false'], JSON.stringify(live, null, 2));

    const pollId = await evalJS(peer.client, `window.pollState.id`);
    await evalJS(
      peer.client,
      `window.activityHandler({
         type: 'poll_vote',
         pollId: ${JSON.stringify(pollId)},
         voterId: 'remote-peer-1',
         choiceIndex: 0
       });
       window.activityHandler({
         type: 'poll_vote',
         pollId: ${JSON.stringify(pollId)},
         voterId: 'remote-peer-2',
         choiceIndex: 0
       });
       1`
    );
    live = await inspectPoll(peer);
    assert.strictEqual(live.total, '3', JSON.stringify(live, null, 2));
    assert.deepStrictEqual(live.percentages, ['67', '33', '0', '0'], JSON.stringify(live, null, 2));
    assert.strictEqual(live.leader, 'Film izleyelim', JSON.stringify(live, null, 2));
    const liveScreenshot = await screenshot(peer, 'teamsync-quick-poll-live.png');

    await evalJS(peer.client, `document.getElementById('poll-end').click(); 1`);
    const ended = await inspectPoll(peer);
    assert.strictEqual(ended.ended, true, JSON.stringify(ended, null, 2));
    assert.ok(ended.disabled.every(Boolean), JSON.stringify(ended, null, 2));
    assert.strictEqual(ended.endHidden, true, JSON.stringify(ended, null, 2));
    assert.strictEqual(ended.newHidden, false, JSON.stringify(ended, null, 2));

    await peer.client.send('Emulation.setDeviceMetricsOverride', {
      width: 850,
      height: 600,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await new Promise(resolve => setTimeout(resolve, 250));
    const responsive = await inspectPoll(peer);
    assert.ok(responsive.cardRect.left >= 0, JSON.stringify(responsive, null, 2));
    assert.ok(responsive.cardRect.top >= 0, JSON.stringify(responsive, null, 2));
    assert.ok(responsive.cardRect.right <= responsive.viewport.width, JSON.stringify(responsive, null, 2));
    assert.ok(responsive.cardRect.bottom <= responsive.viewport.height, JSON.stringify(responsive, null, 2));
    assert.ok(responsive.closeRect.width > 0 && responsive.closeRect.height > 0, JSON.stringify(responsive, null, 2));
    assert.ok(responsive.closeRect.right <= responsive.viewport.width, JSON.stringify(responsive, null, 2));
    assert.ok(responsive.newRect.width > 0 && responsive.newRect.height > 0, JSON.stringify(responsive, null, 2));
    assert.ok(responsive.newRect.bottom <= responsive.cardRect.bottom, JSON.stringify(responsive, null, 2));
    const responsiveScreenshot = await screenshot(peer, 'teamsync-quick-poll-responsive.png');

    await evalJS(peer.client, `document.getElementById('poll-new').click(); 1`);
    const reset = await inspectPoll(peer);
    assert.strictEqual(reset.setupHidden, false, JSON.stringify(reset, null, 2));
    assert.strictEqual(reset.viewHidden, true, JSON.stringify(reset, null, 2));
    assert.strictEqual(reset.createDisabled, true, JSON.stringify(reset, null, 2));

    if (require.main === module) {
      console.log(setupScreenshot);
      console.log(liveScreenshot);
      console.log(responsiveScreenshot);
    }
  } finally {
    cleanupPeer(peer);
  }
};

if (require.main === module) {
  module.exports()
    .then(() => console.log('PASS quick-poll-redesign'))
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
}
