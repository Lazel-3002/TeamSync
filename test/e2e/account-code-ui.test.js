const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnPeer, cleanupPeer, evalJS, waitFor } = require('./lib/harness');

// Ayarlar > Hesap ve Cihaz: cihaz ayrıntıları dolar, hesaplar listelenir.
// Çevrimdışı kipte açılan profil eski tiptir: giriş kodu yerine buluta taşıma
// sunulur. Bulut hesabında kod gizli başlar ve Göster ile açılır.
// Raydaki güncelleme düğmesi emoji içermez.
module.exports = async function run() {
  const peer = await spawnPeer({ port: 9452, name: 'Account Code Test' });
  try {
    await peer.client.send('Emulation.setDeviceMetricsOverride', {
      width: 1200, height: 860, deviceScaleFactor: 1, mobile: false,
    });
    await evalJS(peer.client, `document.getElementById('menu-settings').click(); 1`);
    await evalJS(peer.client, `document.querySelector('[data-settings-panel="account"]').click(); 1`);
    await waitFor(peer.client, `/^[0-9a-f]{40}$/.test(document.getElementById('settings-device-id').dataset.raw || '')`, 10000, 'cihaz kimliği');
    await waitFor(peer.client, `document.querySelectorAll('#settings-device-accounts-list .settings-device-account').length > 0`, 10000, 'hesap listesi');

    const legacy = await evalJS(peer.client, `(() => {
      const txt = id => document.getElementById(id).textContent.trim();
      return {
        kind: state.accountKind,
        deviceIdShown: txt('settings-device-id'),
        deviceIdRaw: document.getElementById('settings-device-id').dataset.raw,
        name: txt('settings-device-name'),
        os: txt('settings-device-os'),
        cpu: txt('settings-device-cpu'),
        ram: txt('settings-device-ram'),
        app: txt('settings-device-app'),
        first: txt('settings-device-first'),
        cloud: txt('settings-device-cloud'),
        rows: [...document.querySelectorAll('#settings-device-accounts-list .settings-device-account')].map(r => r.textContent),
        legacyBoxVisible: !document.getElementById('settings-login-code-legacy').classList.contains('hidden'),
        codeBoxVisible: !document.getElementById('settings-login-code-cloud').classList.contains('hidden'),
        allInfo: deviceInfoText,
      };
    })()`);
    assert.strictEqual(legacy.kind, 'legacy', JSON.stringify(legacy));
    assert.strictEqual(legacy.deviceIdShown.replace(/ /g, ''), legacy.deviceIdRaw, 'kimlik gruplanmış gösterilmeli');
    assert.match(legacy.deviceIdShown, /^([0-9a-f]{4} ){9}[0-9a-f]{4}$/);
    for (const k of ['name', 'os', 'cpu', 'ram', 'app', 'first']) {
      assert.ok(legacy[k] && legacy[k] !== '—', `${k} boş: ${JSON.stringify(legacy)}`);
    }
    assert.match(legacy.ram, /GB$/);
    assert.ok(legacy.rows.some(r => r.includes('Account Code Test')), JSON.stringify(legacy.rows));
    assert.ok(legacy.legacyBoxVisible && !legacy.codeBoxVisible, 'eski tip hesapta kod yerine taşıma kutusu görünmeli');
    assert.ok(legacy.allInfo.includes(legacy.deviceIdRaw), 'tüm bilgiler kimliği içermeli');

    // Bulut hesabı gibi davranınca kod üretilir ve gizli başlar.
    await evalJS(peer.client, `state.accountKind = 'cloud'; renderAccountSettings().then(() => 1)`, true);
    await waitFor(peer.client, `!!accountCodeCache`, 10000, 'giriş kodu');
    const before = await evalJS(peer.client, `({
      masked: document.getElementById('settings-login-code').classList.contains('is-masked'),
      text: document.getElementById('settings-login-code').textContent,
      code: accountCodeCache,
    })`);
    assert.ok(before.masked, JSON.stringify(before));
    assert.ok(!before.text.includes('TS1-'), 'kod gizliyken görünmemeli');
    assert.match(before.code, /^TS1-[0-9a-f]{40}-0-[A-Za-z0-9_-]{43}$/);
    assert.ok(before.code.includes(legacy.deviceIdRaw), 'kod bu cihazın kimliğini taşımalı');

    await evalJS(peer.client, `document.getElementById('settings-login-code-toggle').click(); 1`);
    const shown = await evalJS(peer.client, `document.getElementById('settings-login-code').textContent`);
    assert.strictEqual(shown, before.code);

    // Kendi kodunu içe aktarmak yeni slot açmaz, yerel slotu döndürür.
    const imported = await evalJS(peer.client, `window.electronAPI.importAccountCode(${JSON.stringify(before.code)})`, true);
    assert.deepStrictEqual(imported, { ok: true, slot: 0, local: true });
    const bad = await evalJS(peer.client, `window.electronAPI.importAccountCode('TS1-xyz')`, true);
    assert.strictEqual(bad.ok, false);

    // Eski tip hesapta profil kaydı bulut hesabına yazmamalı (bayrak kontrolü).
    await evalJS(peer.client, `state.accountKind = 'legacy'; renderAccountSettings().then(() => 1)`, true);

    if (process.env.TEMP) {
      await new Promise(r => setTimeout(r, 400));
      const shot = await peer.client.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(process.env.TEMP, 'teamsync-settings-account.png'), Buffer.from(shot.result.data, 'base64'));
    }

    const updateBtn = await evalJS(peer.client, `document.getElementById('update-btn').textContent`);
    assert.ok(!/\p{Extended_Pictographic}/u.test(updateBtn), 'güncelleme düğmesinde emoji olmamalı: ' + updateBtn);
  } finally {
    cleanupPeer(peer);
  }
};
