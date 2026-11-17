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
         // Arkadaşlıktan çıkar / engelle artık "..." menüsünde (doğrudan silme düğmesi yok).
         hasMore: !!actions.querySelector('.friend-action-more'),
         hasDirectRemove: !!actions.querySelector('.friend-action-remove'),
         mutedTag: !!item.querySelector('.friend-muted-tag'),
         mutedTagInside: (() => { const tag = item.querySelector('.friend-muted-tag'); return !tag || tag.getBoundingClientRect().right <= itemRect.right + 1; })(),
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

    // Arkadaslik broker'i baglanmadan enjekte edilen sahte arkadas, connect
    // isleyicisindeki markFriendOffline() taramasina yakalanip "cevrimdisi"
    // oluyor; o zaman "Sunucusuna Katil" dugmesi cizilmiyor ve buton sayisi
    // 4 yerine 3 cikiyor. Once baglanti otursun, sonra durumu kuralim.
    await waitFor(
      peer.client,
      `!!(state.globalMqtt && state.globalMqtt.connected)`,
      25000,
      'global mqtt connected'
    );

    await evalJS(
      peer.client,
      `state.friends = {
         'KNK-RESPONSIVE': {
           name: 'Çok Uzun Arkadaş Kullanıcı Adı',
           avatar: '',
           online: true,
           room: 'ROOM-RESPONSIVE',
           isMuted: true
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
      // sohbet + katıl + sessize al + "..." (çevrimiçi ama aramada: hızlı arama düğmesi yok)
      assert.strictEqual(result.actionCount, 4);
      assert.strictEqual(result.hasMore, true, 'row menu button');
      assert.strictEqual(result.hasDirectRemove, false, 'no one-click remove');
      assert.strictEqual(result.mutedTag, true, 'muted friend shows "sessize alındı"');
      assert.strictEqual(result.mutedTagInside, true);
      assert.strictEqual(result.nameEllipsized, true);
    }

    // Sessize alınmış arkadaş artık "Engellenenler"de görünmez; o sekme gerçek engel listesidir.
    const tabs = await evalJS(peer.client, `(() => {
      TSShell.setView('friends');
      TSFriends.setTab('all');
      const inAll = document.querySelectorAll('#friends-list .friend-item:not(.fl-search-miss)').length;
      TSFriends.setTab('blocked');
      const blockedRows = document.querySelectorAll('#people-list .people-item').length;
      const blockedEmpty = !!document.querySelector('#people-list .people-empty');
      TSFriends.setTab('removed');
      const removedEmpty = !!document.querySelector('#people-list .people-empty');
      TSFriends.setTab('online');
      return { inAll, blockedRows, blockedEmpty, removedEmpty };
    })()`);
    assert.deepStrictEqual(tabs, { inAll: 1, blockedRows: 0, blockedEmpty: true, removedEmpty: true });
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
