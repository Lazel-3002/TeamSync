const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnPeer, cleanupPeer, evalJS, waitFor } = require('./lib/harness');

// Ayarlar > Hesap ve Cihaz: cihaz kimliği ve giriş kodu üretilir, kod gizli
// başlar ve Göster ile açılır; raydaki güncelleme düğmesi emoji içermez.
module.exports = async function run() {
  const peer = await spawnPeer({ port: 9452, name: 'Account Code Test' });
  try {
    await peer.client.send('Emulation.setDeviceMetricsOverride', {
      width: 1200, height: 800, deviceScaleFactor: 1, mobile: false,
    });
    await evalJS(peer.client, `document.getElementById('menu-settings').click(); 1`);
    await evalJS(peer.client, `document.querySelector('[data-settings-panel="account"]').click(); 1`);
    await waitFor(peer.client, `/^[0-9a-f]{40}$/.test(document.getElementById('settings-device-id').textContent)`, 10000, 'cihaz kimliği');
    await waitFor(peer.client, `!!accountCodeCache`, 10000, 'giriş kodu');

    const before = await evalJS(peer.client, `({
      masked: document.getElementById('settings-login-code').classList.contains('is-masked'),
      text: document.getElementById('settings-login-code').textContent,
      code: accountCodeCache,
      deviceId: document.getElementById('settings-device-id').textContent,
    })`);
    assert.ok(before.masked, JSON.stringify(before));
    assert.ok(!before.text.includes('TS1-'), 'kod gizliyken görünmemeli');
    assert.match(before.code, /^TS1-[0-9a-f]{40}-0-[A-Za-z0-9_-]{43}$/);
    assert.ok(before.code.includes(before.deviceId), 'kod bu cihazın kimliğini taşımalı');

    await evalJS(peer.client, `document.getElementById('settings-login-code-toggle').click(); 1`);
    const shown = await evalJS(peer.client, `document.getElementById('settings-login-code').textContent`);
    assert.strictEqual(shown, before.code);

    // Kendi kodunu içe aktarmak yeni slot açmaz, yerel slotu döndürür.
    const imported = await evalJS(peer.client, `window.electronAPI.importAccountCode(${JSON.stringify(before.code)})`, true);
    assert.deepStrictEqual(imported, { ok: true, slot: 0, local: true });
    const bad = await evalJS(peer.client, `window.electronAPI.importAccountCode('TS1-xyz')`, true);
    assert.strictEqual(bad.ok, false);

    if (process.env.TEMP) {
      const shot = await peer.client.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(process.env.TEMP, 'teamsync-settings-account.png'), Buffer.from(shot.result.data, 'base64'));
    }

    const updateBtn = await evalJS(peer.client, `(() => {
      const b = document.getElementById('update-btn');
      return { text: b.textContent, inRail: !!b.closest('#rail-bottom') };
    })()`);
    assert.ok(!/\p{Extended_Pictographic}/u.test(updateBtn.text), 'güncelleme düğmesinde emoji olmamalı: ' + updateBtn.text);
  } finally {
    cleanupPeer(peer);
  }
};
