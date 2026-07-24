const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  spawnPeer,
  cleanupPeer,
  evalJS,
  waitFor,
} = require('./lib/harness');

module.exports = async function run() {
  const peer = await spawnPeer({ port: 9407, name: 'Media Library Test' });
  try {
    await peer.client.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await evalJS(peer.client, `openUserSettings('media'); 1`);
    await waitFor(
      peer.client,
      `document.querySelector('[data-settings-content="media"]').classList.contains('active')`,
      5000,
      'media settings panel'
    );

    const newLimitState = await evalJS(
      peer.client,
      `(async () => {
        const formerLimitPhoto = new File(
          [new Uint8Array(3 * 1024 * 1024)],
          'three-megabyte-photo.jpg',
          { type: 'image/jpeg', lastModified: 1770000000100 }
        );
        const underLimit = await TeamSyncMediaLibrary.addFiles([formerLimitPhoto]);
        const saved = (await TeamSyncMediaLibrary.getItems()).find(item => item.name === formerLimitPhoto.name);
        if (saved) await TeamSyncMediaLibrary.deleteItem(saved.id, false);

        const overLimitPhoto = new File(
          [new Uint8Array((20 * 1024 * 1024) + 1)],
          'over-limit-photo.jpg',
          { type: 'image/jpeg', lastModified: 1770000000200 }
        );
        const overLimit = await TeamSyncMediaLibrary.addFiles([overLimitPhoto]);
        return {
          configuredLimit: TeamSyncMediaLibrary.maxFileSize,
          underLimit,
          underLimitWasSaved: !!saved,
          overLimit,
          toastText: [...document.querySelectorAll('#toast-container .toast')]
            .map(toast => toast.textContent)
            .join(' | ')
        };
      })()`,
      true
    );
    assert.strictEqual(newLimitState.configuredLimit, 20 * 1024 * 1024, JSON.stringify(newLimitState, null, 2));
    assert.deepStrictEqual(newLimitState.underLimit, { added: 1, rejected: 0, duplicates: 0 }, JSON.stringify(newLimitState, null, 2));
    assert.strictEqual(newLimitState.underLimitWasSaved, true, JSON.stringify(newLimitState, null, 2));
    assert.deepStrictEqual(newLimitState.overLimit, { added: 0, rejected: 1, duplicates: 0 }, JSON.stringify(newLimitState, null, 2));
    assert.match(newLimitState.toastText, /20 MB sınırını aşıyor/, JSON.stringify(newLimitState, null, 2));
    assert.doesNotMatch(newLimitState.toastText, /desteklenmedi veya/, JSON.stringify(newLimitState, null, 2));

    const added = await evalJS(
      peer.client,
      `(async () => {
        const binary = atob('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==');
        const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
        const file = new File([bytes], 'spark.gif', {
          type: 'image/gif',
          lastModified: 1770000000000
        });
        return TeamSyncMediaLibrary.addFiles([file]);
      })()`,
      true
    );
    assert.deepStrictEqual(added, { added: 1, rejected: 0, duplicates: 0 }, JSON.stringify(added));

    const libraryState = await evalJS(
      peer.client,
      `(async () => {
        const items = await TeamSyncMediaLibrary.getItems();
        const card = document.querySelector('#settings-media-grid .media-library-card');
        return {
          count: items.length,
          kind: items[0].kind,
          type: items[0].type,
          blobSize: items[0].blob.size,
          cardName: card?.querySelector('.media-library-info strong')?.textContent,
          previewTag: card?.querySelector('.media-library-media')?.tagName,
          stat: document.getElementById('settings-media-count').textContent
        };
      })()`,
      true
    );
    assert.strictEqual(libraryState.count, 1, JSON.stringify(libraryState, null, 2));
    assert.strictEqual(libraryState.kind, 'gif', JSON.stringify(libraryState, null, 2));
    assert.strictEqual(libraryState.type, 'image/gif', JSON.stringify(libraryState, null, 2));
    assert.ok(libraryState.blobSize > 0, JSON.stringify(libraryState, null, 2));
    assert.strictEqual(libraryState.cardName, 'spark.gif', JSON.stringify(libraryState, null, 2));
    assert.strictEqual(libraryState.previewTag, 'IMG', JSON.stringify(libraryState, null, 2));
    assert.strictEqual(libraryState.stat, '1', JSON.stringify(libraryState, null, 2));

    await peer.client.send('Page.enable');
    const settingsShot = await peer.client.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const settingsPath = path.join(process.env.TEMP, 'teamsync-media-library-settings.png');
    fs.writeFileSync(settingsPath, Buffer.from(settingsShot.result.data, 'base64'));

    await evalJS(
      peer.client,
      `(() => {
        document.getElementById('settings-v2-close').click();
        state.friends['media-test-friend'] = { name: 'Medya Arkadaşı', online: true };
        state.activeDM = 'media-test-friend';
        state.dms['media-test-friend'] = [];
        window.__mediaPublishes = [];
        state.globalMqtt = {
          connected: true,
          publish(topic, payload) {
            window.__mediaPublishes.push({ topic, payload: String(payload) });
          }
        };
        document.getElementById('dm-btn-file').click();
        return true;
      })()`
    );

    const menuState = await waitFor(
      peer.client,
      `(() => {
        const menu = document.getElementById('dm-attach-menu');
        return !menu.classList.contains('hidden') ? {
          options: menu.querySelectorAll('.dm-attach-option').length,
          count: document.getElementById('dm-attach-library-count').textContent,
          width: Math.round(menu.getBoundingClientRect().width)
        } : null;
      })()`,
      5000,
      'attachment choice menu'
    );
    assert.strictEqual(menuState.options, 2, JSON.stringify(menuState, null, 2));
    assert.strictEqual(menuState.count, '1', JSON.stringify(menuState, null, 2));
    assert.ok(menuState.width >= 330, JSON.stringify(menuState, null, 2));

    const externalWorks = await evalJS(
      peer.client,
      `(() => {
        window.__externalPickerOpened = false;
        document.getElementById('dm-file-input').addEventListener('click', () => {
          window.__externalPickerOpened = true;
        }, { once: true });
        document.getElementById('dm-attach-external').click();
        return window.__externalPickerOpened;
      })()`
    );
    assert.strictEqual(externalWorks, true);

    await evalJS(peer.client, `document.getElementById('dm-btn-file').click(); 1`);
    await waitFor(
      peer.client,
      `!document.getElementById('dm-attach-menu').classList.contains('hidden')`,
      5000,
      'attachment menu reopened'
    );
    await evalJS(peer.client, `document.getElementById('dm-attach-library').click(); 1`);
    await waitFor(
      peer.client,
      `!document.getElementById('media-picker-modal').classList.contains('hidden') &&
       document.getElementById('dm-attach-menu').classList.contains('hidden') &&
       !!document.querySelector('#media-picker-grid .media-picker-card')`,
      5000,
      'saved media picker'
    );
    await new Promise(resolve => setTimeout(resolve, 260));

    const pickerShot = await peer.client.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const pickerPath = path.join(process.env.TEMP, 'teamsync-media-library-picker.png');
    fs.writeFileSync(pickerPath, Buffer.from(pickerShot.result.data, 'base64'));

    await evalJS(
      peer.client,
      `document.querySelector('#media-picker-grid .media-picker-card').click(); 1`
    );
    const sentState = await waitFor(
      peer.client,
      `(() => {
        const message = state.dms['media-test-friend']?.at(-1);
        const start = window.__mediaPublishes
          .map(entry => { try { return JSON.parse(entry.payload); } catch (error) { return null; } })
          .find(payload => payload?.type === 'dm_file_start');
        const pickerClosed = document.getElementById('media-picker-modal').classList.contains('hidden');
        return message && start && pickerClosed ? {
          messageType: message.type,
          fileName: message.fileName,
          isGifData: message.content.startsWith('data:image/gif;base64,'),
          startType: start.msgType,
          startName: start.fileName,
          chunks: window.__mediaPublishes.filter(entry => entry.payload.includes('dm_file_chunk')).length,
          pickerClosed
        } : null;
      })()`,
      8000,
      'saved GIF sent'
    );
    assert.strictEqual(sentState.messageType, 'image', JSON.stringify(sentState, null, 2));
    assert.strictEqual(sentState.fileName, 'spark.gif', JSON.stringify(sentState, null, 2));
    assert.strictEqual(sentState.isGifData, true, JSON.stringify(sentState, null, 2));
    assert.strictEqual(sentState.startType, 'image', JSON.stringify(sentState, null, 2));
    assert.strictEqual(sentState.startName, 'spark.gif', JSON.stringify(sentState, null, 2));
    assert.ok(sentState.chunks >= 1, JSON.stringify(sentState, null, 2));
    assert.strictEqual(sentState.pickerClosed, true, JSON.stringify(sentState, null, 2));

    const largerDmState = await evalJS(
      peer.client,
      `(async () => {
        window.__mediaPublishes = [];
        const photo = new File(
          [new Uint8Array(3 * 1024 * 1024)],
          'dm-three-megabyte-photo.jpg',
          { type: 'image/jpeg', lastModified: 1770000000300 }
        );
        const sent = await sendDMFile(photo);
        const message = state.dms['media-test-friend'].at(-1);
        const start = window.__mediaPublishes
          .map(entry => { try { return JSON.parse(entry.payload); } catch (error) { return null; } })
          .find(payload => payload?.type === 'dm_file_start');
        return {
          sent,
          type: message.type,
          expired: !!message.expired,
          hasLocalContent: message.content.length > 3 * 1024 * 1024,
          startType: start?.msgType,
          chunkCount: window.__mediaPublishes.filter(entry => entry.payload.includes('dm_file_chunk')).length
        };
      })()`,
      true
    );
    assert.strictEqual(largerDmState.sent, true, JSON.stringify(largerDmState, null, 2));
    assert.strictEqual(largerDmState.type, 'image', JSON.stringify(largerDmState, null, 2));
    assert.strictEqual(largerDmState.expired, false, JSON.stringify(largerDmState, null, 2));
    assert.strictEqual(largerDmState.hasLocalContent, true, JSON.stringify(largerDmState, null, 2));
    assert.strictEqual(largerDmState.startType, 'image', JSON.stringify(largerDmState, null, 2));
    assert.ok(largerDmState.chunkCount > 1, JSON.stringify(largerDmState, null, 2));

    const videoState = await evalJS(
      peer.client,
      `(async () => {
        const video = new File([new Uint8Array([0, 1, 2, 3])], 'clip.webm', {
          type: 'video/webm',
          lastModified: 1770000001000
        });
        const sent = await sendDMFile(video);
        return {
          sent,
          type: state.dms['media-test-friend'].at(-1).type,
          rendered: document.querySelectorAll('#dm-messages video').length
        };
      })()`,
      true
    );
    assert.strictEqual(videoState.sent, true, JSON.stringify(videoState, null, 2));
    assert.strictEqual(videoState.type, 'video', JSON.stringify(videoState, null, 2));
    assert.strictEqual(videoState.rendered, 1, JSON.stringify(videoState, null, 2));

    console.log(JSON.stringify({ newLimitState, libraryState, menuState, sentState, largerDmState, videoState, settingsPath, pickerPath }, null, 2));
  } finally {
    cleanupPeer(peer);
  }
};
