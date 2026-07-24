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

module.exports = async function run() {
  const peer = await spawnPeer({ port: 9396, name: 'Settings Language Test' });
  try {
    await peer.client.send('Emulation.setDeviceMetricsOverride', {
      width: 1200,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await evalJS(peer.client, `document.getElementById('menu-settings').click(); 1`);
    await new Promise(resolve => setTimeout(resolve, 150));

    const opened = await evalJS(
      peer.client,
      `(() => {
        const modal = document.getElementById('settings-modal');
        const shell = modal.querySelector('.settings-shell');
        const rect = shell.getBoundingClientRect();
        return {
          hidden: modal.classList.contains('hidden'),
          navCount: modal.querySelectorAll('[data-settings-panel]').length,
          activePanel: modal.querySelector('[data-settings-panel].active')?.dataset.settingsPanel,
          rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
          viewport: { width: innerWidth, height: innerHeight },
        };
      })()`
    );
    assert.strictEqual(opened.hidden, false, JSON.stringify(opened, null, 2));
    assert.strictEqual(opened.navCount, 6, JSON.stringify(opened, null, 2));
    assert.strictEqual(opened.activePanel, 'general', JSON.stringify(opened, null, 2));
    assert.ok(opened.rect.right - opened.rect.left >= 800, JSON.stringify(opened, null, 2));
    assert.ok(opened.rect.bottom - opened.rect.top >= 500, JSON.stringify(opened, null, 2));
    assert.ok(opened.rect.left >= 0 && opened.rect.top >= 0, JSON.stringify(opened, null, 2));
    assert.ok(opened.rect.right <= opened.viewport.width, JSON.stringify(opened, null, 2));
    assert.ok(opened.rect.bottom <= opened.viewport.height, JSON.stringify(opened, null, 2));

    await evalJS(
      peer.client,
      `document.querySelector('[data-settings-panel="language"]').click();
       const english = document.querySelector('input[name="settings-language"][value="en"]');
       english.checked = true;
       english.dispatchEvent(new Event('change', { bubbles: true }));
       const time12 = document.querySelector('input[name="settings-time-format"][value="12"]');
       time12.checked = true;
       time12.dispatchEvent(new Event('change', { bubbles: true }));
       1`
    );

    const english = await evalJS(
      peer.client,
      `({
        language: localStorage.getItem('teamsync_language'),
        documentLanguage: document.documentElement.lang,
        title: document.querySelector('[data-settings-content="language"] h2').textContent,
        menuSettings: document.querySelector('#menu-settings [data-i18n]').textContent,
        toolbarVoice: document.querySelector('#mic [data-i18n]').textContent,
        broadcast: document.querySelector('[data-settings-panel="broadcast"] [data-i18n]').textContent,
        mediaNav: document.querySelector('[data-settings-panel="media"] [data-i18n]').textContent,
        mediaTitle: document.querySelector('[data-settings-content="media"] h2').textContent,
        mediaAdd: document.querySelector('#settings-media-add [data-i18n]').textContent,
        mediaLocalTitle: document.querySelector('.media-local-notice strong').textContent,
        mediaPickerTitle: document.getElementById('media-picker-title').textContent,
        externalAttachment: document.querySelector('#dm-attach-external strong').textContent,
        libraryAttachment: document.querySelector('#dm-attach-library strong').textContent,
        microphone: document.querySelector('label[for="user-mic-select"]').textContent,
        switchAccount: document.querySelector('#btn-logout [data-i18n]').textContent,
        back: document.querySelector('#step-join .btn-back [data-i18n]').textContent,
        shareSource: document.querySelector('#share-modal [data-i18n="share.chooseSource"]').textContent,
        defaultRoomName: document.getElementById('create-name').value,
        legacyFocusTitle: document.getElementById('focus-lock-btn').title,
        timeFormat: localStorage.getItem('teamsync_time_format'),
        formattedTime: formatUserTime(new Date(2026, 0, 1, 13, 5)),
      })`
    );
    assert.strictEqual(english.language, 'en', JSON.stringify(english, null, 2));
    assert.strictEqual(english.documentLanguage, 'en', JSON.stringify(english, null, 2));
    assert.strictEqual(english.title, 'Language & Time', JSON.stringify(english, null, 2));
    assert.strictEqual(english.menuSettings, 'Settings', JSON.stringify(english, null, 2));
    assert.strictEqual(english.toolbarVoice, 'Voice', JSON.stringify(english, null, 2));
    assert.strictEqual(english.broadcast, 'Broadcast', JSON.stringify(english, null, 2));
    assert.strictEqual(english.mediaNav, 'GIF & Media', JSON.stringify(english, null, 2));
    assert.strictEqual(english.mediaTitle, 'GIF & Media', JSON.stringify(english, null, 2));
    assert.strictEqual(english.mediaAdd, 'Add Media', JSON.stringify(english, null, 2));
    assert.strictEqual(english.mediaLocalTitle, 'Only on this computer', JSON.stringify(english, null, 2));
    assert.strictEqual(english.mediaPickerTitle, 'Use your media', JSON.stringify(english, null, 2));
    assert.strictEqual(english.externalAttachment, 'Choose an external file', JSON.stringify(english, null, 2));
    assert.strictEqual(english.libraryAttachment, 'Use your media', JSON.stringify(english, null, 2));
    assert.strictEqual(english.microphone, 'Microphone', JSON.stringify(english, null, 2));
    assert.strictEqual(english.switchAccount, 'Switch Account', JSON.stringify(english, null, 2));
    assert.strictEqual(english.back, 'Back', JSON.stringify(english, null, 2));
    assert.strictEqual(english.shareSource, 'Choose a Screen / Window', JSON.stringify(english, null, 2));
    assert.strictEqual(english.defaultRoomName, 'Game Room', JSON.stringify(english, null, 2));
    assert.strictEqual(english.legacyFocusTitle, 'Focus Lock (prevents accidental exit)', JSON.stringify(english, null, 2));
    assert.strictEqual(english.timeFormat, '12', JSON.stringify(english, null, 2));
    assert.match(english.formattedTime, /PM/i, JSON.stringify(english, null, 2));

    const twentyFourHour = await evalJS(
      peer.client,
      `(() => {
        const time24 = document.querySelector('input[name="settings-time-format"][value="24"]');
        time24.checked = true;
        time24.dispatchEvent(new Event('change', { bubbles: true }));
        return {
          stored: localStorage.getItem('teamsync_time_format'),
          formatted: formatUserTime(new Date(2026, 0, 1, 13, 5)),
        };
      })()`
    );
    assert.strictEqual(twentyFourHour.stored, '24', JSON.stringify(twentyFourHour, null, 2));
    assert.match(twentyFourHour.formatted, /13[.:]05/, JSON.stringify(twentyFourHour, null, 2));
    assert.doesNotMatch(twentyFourHour.formatted, /AM|PM/i, JSON.stringify(twentyFourHour, null, 2));

    if (require.main === module) {
      const screenshot = await peer.client.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      });
      const screenshotPath = path.join(process.env.TEMP, 'teamsync-settings-language.png');
      fs.writeFileSync(screenshotPath, Buffer.from(screenshot.result.data, 'base64'));
      console.log(screenshotPath);

      await evalJS(peer.client, `document.querySelector('[data-settings-panel="voice"]').click(); 1`);
      await new Promise(resolve => setTimeout(resolve, 250));
      const voiceScreenshot = await peer.client.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      });
      const voiceScreenshotPath = path.join(process.env.TEMP, 'teamsync-settings-voice.png');
      fs.writeFileSync(voiceScreenshotPath, Buffer.from(voiceScreenshot.result.data, 'base64'));
      console.log(voiceScreenshotPath);

      await evalJS(peer.client, `document.querySelector('[data-settings-panel="broadcast"]').click(); 1`);
      await new Promise(resolve => setTimeout(resolve, 250));
      const broadcastScreenshot = await peer.client.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      });
      const broadcastScreenshotPath = path.join(process.env.TEMP, 'teamsync-settings-broadcast.png');
      fs.writeFileSync(broadcastScreenshotPath, Buffer.from(broadcastScreenshot.result.data, 'base64'));
      console.log(broadcastScreenshotPath);

      await evalJS(peer.client, `document.getElementById('user-broadcast-advanced-toggle').click(); 1`);
      await new Promise(resolve => setTimeout(resolve, 250));
      const advancedScreenshot = await peer.client.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      });
      const advancedScreenshotPath = path.join(process.env.TEMP, 'teamsync-settings-broadcast-advanced.png');
      fs.writeFileSync(advancedScreenshotPath, Buffer.from(advancedScreenshot.result.data, 'base64'));
      console.log(advancedScreenshotPath);
    }

    await evalJS(
      peer.client,
      `document.getElementById('user-turn-url').value = 'turns:test.example:443';
       document.getElementById('user-turn-user').value = 'tester';
       document.getElementById('user-turn-pass').value = 'secret';
       document.getElementById('user-settings-ptt').checked = true;
       document.getElementById('user-quality-select').value = 'high';
       document.getElementById('user-stream-fps').value = '60';
       document.getElementById('user-stream-previews').checked = false;
       document.getElementById('user-share-system-audio').checked = false;
       const micVolume = document.getElementById('user-mic-volume');
       micVolume.value = '42';
       micVolume.dispatchEvent(new Event('input', { bubbles: true }));
       const speakerVolume = document.getElementById('user-speaker-volume');
       speakerVolume.value = '73';
       speakerVolume.dispatchEvent(new Event('input', { bubbles: true }));
       document.getElementById('settings-v2-save').click();
       1`
    );

    const saved = await evalJS(
      peer.client,
      `({
        turnUrl: localStorage.getItem('teamsync_turn_url'),
        turnUser: localStorage.getItem('teamsync_turn_user'),
        turnPass: localStorage.getItem('teamsync_turn_pass'),
        ptt: localStorage.getItem('teamsync_ptt_enabled'),
        quality: localStorage.getItem('teamsync_media_quality'),
        fps: localStorage.getItem('teamsync_stream_fps'),
        previews: localStorage.getItem('teamsync_stream_previews'),
        shareAudio: localStorage.getItem('teamsync_share_system_audio'),
        micVolume: localStorage.getItem('teamsync_mic_volume'),
        speakerVolume: localStorage.getItem('teamsync_speaker_volume'),
        legacyQuality: document.getElementById('quality-select').value,
        legacyVolume: document.getElementById('volslider').value,
        legacyPtt: document.getElementById('settings-ptt').checked,
      })`
    );
    assert.deepStrictEqual(saved, {
      turnUrl: 'turns:test.example:443',
      turnUser: 'tester',
      turnPass: 'secret',
      ptt: '1',
      quality: 'high',
      fps: '60',
      previews: '0',
      shareAudio: '0',
      micVolume: '42',
      speakerVolume: '73',
      legacyQuality: 'high',
      legacyVolume: '73',
      legacyPtt: true,
    });

    await evalJS(
      peer.client,
      `const turkish = document.querySelector('input[name="settings-language"][value="tr"]');
       turkish.checked = true;
       turkish.dispatchEvent(new Event('change', { bubbles: true }));
       document.getElementById('settings-v2-close').click();
       1`
    );
    assert.strictEqual(await evalJS(peer.client, `localStorage.getItem('teamsync_language')`), 'tr');
    assert.strictEqual(
      await evalJS(peer.client, `document.getElementById('focus-lock-btn').title`),
      'Odak Kilidi (yanlışlıkla çıkmayı engeller)'
    );
    assert.strictEqual(
      await evalJS(peer.client, `document.getElementById('settings-modal').classList.contains('hidden')`),
      true
    );

    await createRoom(peer);
    await peer.client.send('Emulation.setDeviceMetricsOverride', {
      width: 640,
      height: 620,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evalJS(peer.client, `document.getElementById('settings').click(); 1`);
    await new Promise(resolve => setTimeout(resolve, 300));
    const compact = await evalJS(
      peer.client,
      `(() => {
        const shell = document.querySelector('#settings-modal .settings-shell');
        const rect = shell.getBoundingClientRect();
        return {
          hidden: document.getElementById('settings-modal').classList.contains('hidden'),
          parent: document.getElementById('settings-modal').parentElement.tagName,
          profileName: document.getElementById('settings-profile-name').textContent,
          rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
          viewport: { width: innerWidth, height: innerHeight },
        };
      })()`
    );
    assert.strictEqual(compact.hidden, false, JSON.stringify(compact, null, 2));
    assert.strictEqual(compact.parent, 'BODY', JSON.stringify(compact, null, 2));
    assert.strictEqual(compact.profileName, 'Settings Language Test', JSON.stringify(compact, null, 2));
    assert.ok(compact.rect.top >= 35, JSON.stringify(compact, null, 2));
    assert.ok(compact.rect.left >= 0 && compact.rect.top >= 0, JSON.stringify(compact, null, 2));
    assert.ok(compact.rect.right <= compact.viewport.width, JSON.stringify(compact, null, 2));
    assert.ok(compact.rect.bottom <= compact.viewport.height, JSON.stringify(compact, null, 2));

    await evalJS(peer.client, `document.querySelector('[data-settings-panel="media"]').click(); 1`);
    await new Promise(resolve => setTimeout(resolve, 200));
    const compactMedia = await evalJS(
      peer.client,
      `(() => {
        const panel = document.querySelector('[data-settings-content="media"]');
        return {
          active: panel.classList.contains('active'),
          panelWidth: panel.getBoundingClientRect().width,
          scrollWidth: panel.scrollWidth,
          dropzoneRight: document.getElementById('settings-media-dropzone').getBoundingClientRect().right,
          viewportWidth: innerWidth
        };
      })()`
    );
    assert.strictEqual(compactMedia.active, true, JSON.stringify(compactMedia, null, 2));
    assert.ok(compactMedia.scrollWidth <= compactMedia.panelWidth + 1, JSON.stringify(compactMedia, null, 2));
    assert.ok(compactMedia.dropzoneRight <= compactMedia.viewportWidth, JSON.stringify(compactMedia, null, 2));

    const liveAudio = await evalJS(
      peer.client,
      `({
        micGain: window.state.micVolumeGainNode?.gain?.value,
        masterVolume: window.state.volume,
        micDevices: document.getElementById('user-mic-select').options.length,
        speakerDevices: document.getElementById('user-speaker-select').options.length,
      })`
    );
    assert.ok(Math.abs(liveAudio.micGain - 0.42) < 0.02, JSON.stringify(liveAudio, null, 2));
    assert.ok(Math.abs(liveAudio.masterVolume - 0.73) < 0.001, JSON.stringify(liveAudio, null, 2));
    assert.ok(liveAudio.micDevices >= 1, JSON.stringify(liveAudio, null, 2));
    assert.ok(liveAudio.speakerDevices >= 1, JSON.stringify(liveAudio, null, 2));

    await evalJS(
      peer.client,
      `document.querySelector('[data-settings-panel="voice"]').click();
       document.getElementById('user-mic-test').click();
       1`
    );
    await new Promise(resolve => setTimeout(resolve, 300));
    const micTest = await evalJS(
      peer.client,
      `({
        active: window.state.settingsMicTestActive,
        buttonActive: document.getElementById('user-mic-test').classList.contains('testing'),
        meterValue: Number(document.getElementById('user-mic-meter').getAttribute('aria-valuenow')),
      })`
    );
    assert.strictEqual(micTest.active, true, JSON.stringify(micTest, null, 2));
    assert.strictEqual(micTest.buttonActive, true, JSON.stringify(micTest, null, 2));
    assert.ok(micTest.meterValue >= 0 && micTest.meterValue <= 100, JSON.stringify(micTest, null, 2));

    await evalJS(
      peer.client,
      `document.getElementById('user-mic-test').click();
       document.getElementById('settings-v2-close').click();
       document.getElementById('share').click();
       1`
    );
    await waitFor(
      peer.client,
      `!document.getElementById('share-modal').classList.contains('hidden') && document.querySelectorAll('#sources .src').length > 0`,
      10000,
      'share source picker'
    );
    const broadcastPrefs = await evalJS(
      peer.client,
      `({
        previewHidden: !!document.querySelector('#sources .source-preview-placeholder'),
        shareAudio: document.getElementById('share-audio').checked,
      })`
    );
    assert.strictEqual(broadcastPrefs.previewHidden, true, JSON.stringify(broadcastPrefs, null, 2));
    assert.strictEqual(broadcastPrefs.shareAudio, false, JSON.stringify(broadcastPrefs, null, 2));

    await evalJS(
      peer.client,
      `navigator.mediaDevices.getDisplayMedia = async constraints => {
         window.__settingsShareConstraints = constraints;
         return document.createElement('canvas').captureStream(1);
       };
       document.querySelector('#sources .src').click();
       1`
    );
    await waitFor(peer.client, `window.state.isSharing === true`, 10000, 'settings-driven screen share');
    const shareConstraints = await evalJS(
      peer.client,
      `({
        audio: window.__settingsShareConstraints.audio,
        width: window.__settingsShareConstraints.video.width.ideal,
        height: window.__settingsShareConstraints.video.height.ideal,
        fpsIdeal: window.__settingsShareConstraints.video.frameRate.ideal,
        fpsMax: window.__settingsShareConstraints.video.frameRate.max,
      })`
    );
    assert.deepStrictEqual(shareConstraints, {
      audio: false,
      width: 1920,
      height: 1080,
      fpsIdeal: 60,
      fpsMax: 60,
    });
    await evalJS(peer.client, `stopScreenShare(); 1`);
  } finally {
    cleanupPeer(peer);
  }
};

if (require.main === module) {
  module.exports()
    .then(() => console.log('PASS settings-language'))
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
}
