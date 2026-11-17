// Oyun algılayıcısının saf ayrıştırıcıları (Electron gerektirmez): Steam
// libraryfolders.vdf / appmanifest .acf, Epic .item, tasklist CSV ve
// süreç → oyun eşleştirme kuralları.
const assert = require('assert');
const path = require('path');
const P = require('../../electron/activity-parsers');

const LIBRARY_VDF = `"libraryfolders"
{
\t"0"
\t{
\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"
\t\t"apps"
\t\t{
\t\t\t"1229490"\t\t"3886368657"
\t\t}
\t}
\t"1"
\t{
\t\t"path"\t\t"D:\\\\SteamLibrary"
\t}
}`;

const ACF = `"AppState"
{
\t"appid"\t\t"1229490"
\t"name"\t\t"ULTRAKILL"
\t"installdir"\t\t"ULTRAKILL"
\t"StateFlags"\t\t"4"
}`;

const EPIC_ITEM = JSON.stringify({
  DisplayName: 'Celeste',
  InstallLocation: 'C:\\Program Files\\Epic Games\\Celeste',
  LaunchExecutable: 'Celeste.exe',
  AppName: 'Salt',
  AppCategories: ['public', 'games', 'applications']
});

const EPIC_TOOL = JSON.stringify({
  DisplayName: 'Unreal Engine',
  InstallLocation: 'C:\\UE',
  LaunchExecutable: 'UnrealEditor.exe',
  AppName: 'UE',
  AppCategories: ['engines']
});

const TASKLIST = [
  '"System Idle Process","0","Services","0","8 K"',
  '"chrome.exe","1200","Console","1","250.000 K"',
  '"UnityCrashHandler64.exe","4410","Console","1","60.000 K"',
  '"ULTRAKILL.exe","4400","Console","1","1.200.000 K"',
  '"Liar\'s Bar.exe","5000","Console","1","900.000 K"'
].join('\r\n');

module.exports = async function run() {
  // VDF: kütüphaneler, büyük/küçük harf farkıyla tekrar etmez
  const libs = P.libraryPathsFromVdf(LIBRARY_VDF, 'c:/program files (x86)/steam');
  assert.strictEqual(libs.length, 2, JSON.stringify(libs));
  assert.ok(libs.some(l => /SteamLibrary$/i.test(l)), JSON.stringify(libs));

  // ACF
  assert.deepStrictEqual(P.parseAcf(ACF), { appid: 1229490, name: 'ULTRAKILL', installdir: 'ULTRAKILL' });
  assert.strictEqual(P.parseAcf('"Other" { }'), null);

  // Epic: oyun kabul, motor/araç reddedilir
  const epic = P.parseEpicItem(EPIC_ITEM);
  assert.strictEqual(epic.name, 'Celeste');
  assert.strictEqual(epic.exe, 'Celeste.exe');
  assert.strictEqual(epic.exePath, path.join('C:\\Program Files\\Epic Games\\Celeste', 'Celeste.exe'));
  assert.strictEqual(P.parseEpicItem(EPIC_TOOL), null);
  assert.strictEqual(P.parseEpicItem('not json'), null);

  // tasklist CSV
  const procs = P.parseTasklistCsv(TASKLIST);
  assert.strictEqual(procs.length, 5);
  assert.deepStrictEqual(procs[3], { exe: 'ULTRAKILL.exe', pid: 4400 });
  assert.strictEqual(procs[4].exe, "Liar's Bar.exe");

  // Dizin: yardımcı exe'ler (UnityCrashHandler) oyun sayılmaz; öncelik
  // elle eklenen > Epic > Steam > bilinen liste.
  const index = P.buildExeIndex({
    known: [{ id: 'liarsbar', name: "Liar's Bar", exe: ["Liar's Bar.exe"], steam: 3097560 }, { id: 'x', name: 'Known ULTRAKILL', exe: ['ULTRAKILL.exe'] }],
    steamApps: [{ appid: 1229490, name: 'ULTRAKILL', exes: [{ name: 'ULTRAKILL.exe', path: 'C:\\g\\ULTRAKILL.exe' }, { name: 'UnityCrashHandler64.exe', path: 'C:\\g\\UnityCrashHandler64.exe' }] }],
    epicApps: [epic],
    custom: [{ id: 'launcher.exe', exe: 'launcher.exe', name: 'Benim Oyunum' }]
  });
  assert.strictEqual(index['ultrakill.exe'].source, 'steam', 'Steam kaydı bilinen listeyi ezmeli');
  assert.strictEqual(index['unitycrashhandler64.exe'], undefined, 'yardımcı exe oyun sayılmamalı');
  assert.strictEqual(index['celeste.exe'].source, 'epic');
  assert.strictEqual(index['launcher.exe'].name, 'Benim Oyunum', 'elle eklenen genel ad da eşleşmeli');

  // Eşleştirme: Steam RunningAppID kesin sinyal; gizlenen oyun atlanır
  const both = P.matchProcesses(procs, index, { runningAppId: 1229490 });
  assert.strictEqual(both.id, 'steam:1229490');
  assert.strictEqual(both.pid, 4400);
  const hiddenUk = P.matchProcesses(procs, index, { hidden: ['steam:1229490'] });
  assert.strictEqual(hiddenUk.id, 'known:liarsbar');
  const stay = P.matchProcesses(procs, index, { previousId: 'known:liarsbar' });
  assert.strictEqual(stay.id, 'known:liarsbar', 'oyun değişmediyse aynısında kalmalı');
  assert.strictEqual(P.matchProcesses([{ exe: 'chrome.exe', pid: 1 }], index), null);

  // Paketlenen bilinen oyunlar listesi geçerli JSON ve boş değil
  const known = require('../../resources/activity/known-games.json');
  assert.ok(Array.isArray(known.games) && known.games.length > 100);
  known.games.forEach(g => {
    assert.ok(g.id && g.name && Array.isArray(g.exe) && g.exe.length, JSON.stringify(g));
    g.exe.forEach(e => assert.ok(/\.exe$/i.test(e), e));
  });

  // Gizlenen oyunlar: eski biçim (yalnızca kimlik dizisi) okunur, yeni biçim adı saklar.
  const norm = P.normalizeHiddenList(['steam:1229490', { id: 'known:liarsbar', name: "Liar's Bar" }, 'steam:1229490', 42, { id: '' }]);
  assert.deepStrictEqual(norm, [
    { id: 'steam:1229490', name: '', steamAppId: 0 },
    { id: 'known:liarsbar', name: "Liar's Bar", steamAppId: 0 }
  ]);
  assert.deepStrictEqual(P.resolveGameName('steam:1229490', index), { name: 'ULTRAKILL', steamAppId: 1229490 });
  assert.strictEqual(P.resolveGameName('steam:999', index), null);

  // Algılayıcı: eski activity.json taşınır, yetim custom: kaydı temizlenir,
  // gizle → göster turu adı korur ve eşleştirmeye anında yansır.
  const fs = require('fs');
  const os = require('os');
  const { ActivityDetector } = require('../../electron/activity-detector');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-activity-'));
  try {
    fs.writeFileSync(path.join(dir, 'activity.json'), JSON.stringify({
      enabled: true,
      custom: [{ id: 'launcher.exe', exe: 'Launcher.exe', name: 'Benim Oyunum' }],
      hidden: ['steam:1229490', 'custom:silinmis.exe', 'custom:launcher.exe']
    }));
    const handlers = {};
    const detector = new ActivityDetector({
      app: { getPath: () => dir, getFileIcon: async () => null },
      ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
      powerMonitor: {},
      getWindow: () => null,
      isMainWindowSender: () => true
    });
    detector.schedule = () => {}; // testte tasklist yoklaması yok
    await detector.loadSettings();
    detector.registerIpc();
    detector.lookup = index;
    detector.resolveHiddenNames();
    const call = (name, ...args) => handlers[name]({}, ...args);

    let st = await call('activity-get-state');
    assert.deepStrictEqual(st.hidden, ['steam:1229490', 'custom:launcher.exe'], 'yetim custom: kaydı temizlenmeli: ' + JSON.stringify(st.hidden));
    assert.deepStrictEqual(st.hiddenGames.map(h => h.name), ['ULTRAKILL', 'Benim Oyunum'], JSON.stringify(st.hiddenGames));
    assert.strictEqual(st.hiddenGames[0].steamAppId, 1229490);
    // Diskteki dosya yeni biçimde
    await new Promise(r => setTimeout(r, 50));
    const disk = JSON.parse(fs.readFileSync(path.join(dir, 'activity.json'), 'utf8'));
    assert.ok(disk.hidden.every(h => h && typeof h === 'object' && h.id), JSON.stringify(disk.hidden));

    // Gizli oyun eşleşmez; gösterince eşleşir
    assert.strictEqual(P.matchProcesses(procs, index, { hidden: detector.hiddenIds(), runningAppId: 1229490 }).id, 'known:liarsbar');
    st = await call('activity-set-hidden', 'steam:1229490', false);
    assert.ok(!st.hidden.includes('steam:1229490'), JSON.stringify(st.hidden));
    assert.strictEqual(P.matchProcesses(procs, index, { hidden: detector.hiddenIds(), runningAppId: 1229490 }).id, 'steam:1229490');

    // Çalışan oyunu gizleyince adı ve "şu an gizli çalışıyor" bilgisi saklanır
    detector.current = { id: 'known:liarsbar', name: "Liar's Bar", source: 'known', steamAppId: 0, startedAt: Date.now(), icon: '' };
    st = await call('activity-set-hidden', 'known:liarsbar', true);
    assert.strictEqual(st.current, null);
    assert.strictEqual(st.hiddenCurrent && st.hiddenCurrent.id, 'known:liarsbar', JSON.stringify(st));
    assert.ok(st.hiddenGames.some(h => h.id === 'known:liarsbar' && h.name === "Liar's Bar"), JSON.stringify(st.hiddenGames));
    st = await call('activity-set-hidden', 'known:liarsbar', false);
    assert.strictEqual(st.hiddenCurrent, null);

    // Elle eklenen oyun silinince gizleme kaydı da gider
    st = await call('activity-remove-custom', 'launcher.exe');
    assert.ok(!st.hidden.includes('custom:launcher.exe'), JSON.stringify(st.hidden));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

if (require.main === module) {
  module.exports().then(() => console.log('OK'), error => { console.error(error); process.exitCode = 1; });
}
