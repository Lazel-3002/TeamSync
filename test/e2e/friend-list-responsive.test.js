const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  spawnPeer,
  cleanupPeer,
  evalJS,
  waitFor,
} = require('./lib/harness');

async function inspectAtWidth(peer, width, height) {
  await peer.client.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await new Promise(resolve => setTimeout(resolve, 250));

  return evalJS(
    peer.client,
    `(() => {
       const item = document.querySelector('#friends-list .friend-item');
       const list = document.getElementById('friends-list');
       const actions = item.querySelector('.friend-actions');
       const info = item.querySelector('.friend-info');
       const name = item.querySelector('.friend-name');
       const itemRect = item.getBoundingClientRect();
       const actionRect = actions.getBoundingClientRect();
       const infoRect = info.getBoundingClientRect();
       return {
         viewportWidth: document.documentElement.clientWidth,
         documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
         listOverflow: list.scrollWidth - list.clientWidth,
         itemOverflow: item.scrollWidth - item.clientWidth,
         actionsInside: actionRect.right <= itemRect.right + 1,
         infoInside: infoRect.right <= itemRect.right + 1,
         nameEllipsized: name.scrollWidth > name.clientWidth,
         actionCount: actions.querySelectorAll('button').length,
         actionDisplay: getComputedStyle(actions).display,
         actionColumns: getComputedStyle(actions).gridTemplateColumns,
         itemColumns: getComputedStyle(item).gridTemplateColumns,
       };
     })()`
  );
}

module.exports = async function run() {
  const peer = await spawnPeer({ port: 9373, name: 'Responsive Test' });
  try {
    await waitFor(
      peer.client,
      `!document.getElementById('step-action').classList.contains('hidden')`,
      10000,
      'main menu'
    );
    await evalJS(
      peer.client,
      `state.friends = {
         'KNK-RESPONSIVE': {
           name: 'Çok Uzun Arkadaş Kullanıcı Adı',
           avatar: '',
           online: true,
           room: 'ROOM-RESPONSIVE',
           isMuted: false
         }
       };
       renderFriends();
       1`
    );

    const narrow = await inspectAtWidth(peer, 360, 720);
    const extraNarrow = await inspectAtWidth(peer, 280, 720);

    for (const result of [narrow, extraNarrow]) {
      assert.ok(result.documentOverflow <= 0, `document overflow: ${JSON.stringify(result)}`);
      assert.ok(result.listOverflow <= 0, `friend list overflow: ${JSON.stringify(result)}`);
      assert.ok(result.itemOverflow <= 0, `friend item overflow: ${JSON.stringify(result)}`);
      assert.strictEqual(result.actionsInside, true);
      assert.strictEqual(result.infoInside, true);
      assert.strictEqual(result.actionCount, 4);
      assert.strictEqual(result.nameEllipsized, true);
    }
    await peer.client.send('Emulation.setDeviceMetricsOverride', {
      width: 360,
      height: 720,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const screenshot = await peer.client.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    const screenshotPath = path.join(
      process.env.TEMP,
      'teamsync-responsive-friend-list.png'
    );
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.result.data, 'base64'));
    console.log(JSON.stringify({ narrow, extraNarrow, screenshotPath }, null, 2));
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
