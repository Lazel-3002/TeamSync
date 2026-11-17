// Arayüz ekran görüntüleri: uygulamayı e2e düzeneğiyle açar, sahte arkadaş ve
// mesaj ekler, ana ekranların PNG'sini alır. Tasarım değişikliklerini gözle
// karşılaştırmak için:  node tools/ui/screenshots.js <çıktı-klasörü> [tema]
const fs = require('fs');
const path = require('path');
const { spawnPeer, cleanupPeer, evalJS, waitForShell, createRoom } = require('../../test/e2e/lib/harness');

const outDir = path.resolve(process.argv[2] || 'ui-shots');
const theme = process.argv[3] || '';
const W = 1280;
const H = 800;

async function shot(c, name) {
  await new Promise(r => setTimeout(r, 600));
  const res = await c.send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(outDir, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(res.result.data, 'base64'));
  console.log(file);
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const peer = await spawnPeer({ port: 9611, name: 'Ekran Testi' });
  const c = peer.client;
  try {
    await waitForShell(peer);
    await c.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    if (theme) await evalJS(c, `document.documentElement.dataset.theme = ${JSON.stringify(theme)}; 1`);

    await evalJS(c, `(() => {
      const now = Date.now();
      state.friends['KNK-A1'] = { name: 'Elif', online: true, lastSeen: now + 600000 };
      state.friends['KNK-B2'] = { name: 'Mert', online: true, lastSeen: now + 600000 };
      state.friends['KNK-C3'] = { name: 'Zeynep', online: false, lastSeen: now - 3600000 };
      state.dms['KNK-A1'] = [
        { sender: 'them', type: 'text', content: 'Akşam oyun var mı?', timestamp: now - 600000 },
        { sender: 'me', type: 'text', content: 'Olur, 9 gibi girerim', timestamp: now - 540000 },
        { sender: 'them', type: 'text', content: 'Tamam, ekranı da paylaşırım o zaman', timestamp: now - 60000 },
      ];
      renderFriends();
      return 1;
    })()`);

    await evalJS(c, `TSShell.setView('friends'); 1`);
    await shot(c, '01-arkadaslar');

    await evalJS(c, `openDM('KNK-A1'); 1`);
    await shot(c, '02-mesaj');

    await evalJS(c, `openUserSettings('general'); 1`);
    await shot(c, '03-ayarlar');
    await evalJS(c, `document.getElementById('settings-modal')?.classList.add('hidden'); 1`);

    await evalJS(c, `TSShell.setView('friends'); 1`);
    await c.send('Emulation.setDeviceMetricsOverride', { width: 760, height: 700, deviceScaleFactor: 1, mobile: false });
    await shot(c, '04-dar-pencere');

    // Görüşme ekranı: oda kurulur, araç çubuğu (etkinlikler dahil) görünür.
    await c.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    await createRoom(peer);
    await evalJS(c, `TSShell.setView('call'); 1`);
    await shot(c, '05-gorusme');
    await evalJS(c, `document.getElementById('act-btn')?.click(); 1`);
    await shot(c, '06-etkinlikler');
  } catch (e) {
    console.error('HATA:', e && e.message ? e.message : e);
    process.exitCode = 1;
  } finally {
    cleanupPeer(peer);
  }
})();
