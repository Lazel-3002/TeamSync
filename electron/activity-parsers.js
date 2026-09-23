// Oyun algılayıcısının saf (yan etkisiz) yardımcıları. Electron'a bağımlı
// değildir; test/e2e/activity-detector-parse.test.js Node ile doğrudan çalıştırır.
'use strict';

const path = require('path');

// Valve KeyValues (VDF/ACF) ayrıştırıcısı: "anahtar" "değer" ve "anahtar" { ... }
function parseVdf(text) {
  const root = {};
  const stack = [root];
  let i = 0;
  const src = String(text || '');
  const readString = () => {
    let out = '';
    i++; // açılış tırnağı
    while (i < src.length) {
      const ch = src[i];
      if (ch === '\\' && i + 1 < src.length) {
        const next = src[i + 1];
        out += next === 'n' ? '\n' : next === 't' ? '\t' : next;
        i += 2;
        continue;
      }
      if (ch === '"') { i++; break; }
      out += ch;
      i++;
    }
    return out;
  };
  let pendingKey = null;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"') {
      const token = readString();
      if (pendingKey === null) {
        pendingKey = token;
      } else {
        stack[stack.length - 1][pendingKey] = token;
        pendingKey = null;
      }
    } else if (ch === '{') {
      const obj = {};
      if (pendingKey !== null) {
        stack[stack.length - 1][pendingKey] = obj;
        pendingKey = null;
      }
      stack.push(obj);
      i++;
    } else if (ch === '}') {
      if (stack.length > 1) stack.pop();
      pendingKey = null;
      i++;
    } else if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else {
      i++;
    }
  }
  return root;
}

// libraryfolders.vdf → kütüphane klasörleri (eski ve yeni biçim)
function libraryPathsFromVdf(text, steamPath) {
  // Windows yolları büyük/küçük harfe duyarsız: aynı kütüphane iki kez taranmasın.
  const out = new Map();
  const add = p => { const n = path.normalize(p); const k = n.toLowerCase().replace(/[\\/]+$/, ''); if (!out.has(k)) out.set(k, n); };
  if (steamPath) add(steamPath);
  const data = parseVdf(text);
  const root = data.libraryfolders || data.LibraryFolders || {};
  Object.keys(root).forEach(key => {
    if (!/^\d+$/.test(key)) return;
    const entry = root[key];
    if (typeof entry === 'string') add(entry);
    else if (entry && typeof entry.path === 'string') add(entry.path);
  });
  return Array.from(out.values());
}

function parseAcf(text) {
  const data = parseVdf(text);
  const app = data.AppState || data.appstate || null;
  if (!app) return null;
  const appid = parseInt(app.appid, 10);
  const name = typeof app.name === 'string' ? app.name.trim() : '';
  const installdir = typeof app.installdir === 'string' ? app.installdir.trim() : '';
  if (!Number.isInteger(appid) || appid <= 0 || !name || !installdir) return null;
  return { appid, name, installdir };
}

function parseEpicItem(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { return null; }
  if (!data || typeof data !== 'object') return null;
  const name = typeof data.DisplayName === 'string' ? data.DisplayName.trim() : '';
  const installLocation = typeof data.InstallLocation === 'string' ? data.InstallLocation : '';
  const launchExecutable = typeof data.LaunchExecutable === 'string' ? data.LaunchExecutable : '';
  if (!name || !installLocation || !launchExecutable) return null;
  const categories = Array.isArray(data.AppCategories) ? data.AppCategories : [];
  if (categories.length && !categories.includes('games')) return null;
  return {
    name,
    appName: typeof data.AppName === 'string' ? data.AppName : name,
    exePath: path.join(installLocation, launchExecutable),
    exe: path.basename(launchExecutable)
  };
}

// tasklist /fo csv /nh → [{ exe, pid }]
function parseTasklistCsv(text) {
  const out = [];
  String(text || '').split(/\r?\n/).forEach(line => {
    const m = line.match(/^"([^"]+)","(\d+)"/);
    if (!m) return;
    out.push({ exe: m[1], pid: parseInt(m[2], 10) });
  });
  return out;
}

// Oyun olmayan, oyun klasörlerinde de bulunan yardımcı programlar ve anlamsız
// genel adlar: bunlar tek başına asla "oyun" sayılmaz.
const DEFAULT_IGNORE = [
  'steam.exe', 'steamwebhelper.exe', 'steamservice.exe', 'gameoverlayui.exe', 'epicgameslauncher.exe',
  'epicwebhelper.exe', 'riotclientservices.exe', 'riotclientux.exe', 'riotclientuxrender.exe', 'battle.net.exe',
  'agent.exe', 'origin.exe', 'eadesktop.exe', 'upc.exe', 'ubisoftconnect.exe', 'galaxyclient.exe',
  'unitycrashhandler64.exe', 'unitycrashhandler32.exe', 'crashreportclient.exe', 'crashpad_handler.exe',
  'easyanticheat.exe', 'easyanticheat_eos.exe', 'easyanticheat_setup.exe', 'beservice.exe', 'battleye.exe',
  'unins000.exe', 'unins001.exe', 'uninstall.exe', 'setup.exe', 'installer.exe', 'vcredist_x64.exe',
  'vcredist_x86.exe', 'vc_redist.x64.exe', 'vc_redist.x86.exe', 'dxsetup.exe', 'dotnetfx.exe',
  'launcher.exe', 'game.exe', 'start.exe', 'play.exe', 'config.exe', 'settings.exe', 'updater.exe',
  'update.exe', 'crashreporter.exe', 'bugreporter.exe', 'reporter.exe', 'helper.exe', 'server.exe',
  'electron.exe', 'teamsync.exe', 'node.exe', 'cmd.exe', 'conhost.exe', 'explorer.exe', 'python.exe',
  'pythonw.exe', 'java.exe', 'discord.exe', 'chrome.exe', 'msedge.exe', 'firefox.exe', 'code.exe'
];

const SKIP_DIRS = new Set(['_commonredist', 'redist', 'redistributables', 'directx', 'vcredist', 'dotnet',
  'support', 'installers', '__installer', 'easyanticheat', 'battleye', 'engine', 'tools', 'prereqs']);

function shouldSkipDir(name) {
  return SKIP_DIRS.has(String(name || '').toLowerCase());
}

// Oyun kaynaklarından tek bir exe → oyun haritası kurar. Öncelik: elle eklenen >
// Epic (kesin yol) > Steam > bilinen liste. Genel adlar yalnızca elle
// eklenmişse eşleşir.
function buildExeIndex({ steamApps = [], epicApps = [], known = [], custom = [], ignore = [] } = {}) {
  const ignoreSet = new Set([...DEFAULT_IGNORE, ...ignore].map(x => String(x).toLowerCase()));
  const index = {};
  const put = (exe, game, force) => {
    const key = String(exe || '').toLowerCase();
    if (!key.endsWith('.exe')) return;
    if (!force && ignoreSet.has(key)) return;
    if (!force && index[key] && index[key].priority >= game.priority) return;
    index[key] = game;
  };
  known.forEach(g => (g.exe || []).forEach(exe => put(exe, {
    id: `known:${g.id}`, name: g.name, source: 'known', steamAppId: g.steam || 0, priority: 1
  })));
  steamApps.forEach(app => (app.exes || []).forEach(exe => put(exe.name, {
    id: `steam:${app.appid}`, name: app.name, source: 'steam', steamAppId: app.appid, path: exe.path, priority: 2
  })));
  epicApps.forEach(app => put(app.exe, {
    id: `epic:${app.appName}`, name: app.name, source: 'epic', steamAppId: 0, path: app.exePath, priority: 3
  }));
  custom.forEach(g => put(g.exe, {
    id: `custom:${g.id}`, name: g.name, source: 'custom', steamAppId: g.steam || 0, path: g.path || '', priority: 4
  }, true));
  return index;
}

// Çalışan süreçlerden şu an oynanan oyunu seçer.
// runningAppId: Steam'in HKCU\...\RunningAppID değeri (0 = oyun yok).
function matchProcesses(processes, index, { hidden = [], runningAppId = 0, previousId = null } = {}) {
  const hiddenSet = new Set(hidden);
  const candidates = [];
  (processes || []).forEach(p => {
    const game = index[String(p.exe || '').toLowerCase()];
    if (!game || hiddenSet.has(game.id)) return;
    candidates.push({ ...game, pid: p.pid, exe: p.exe });
  });
  if (!candidates.length) return null;
  // Steam hangi oyunun çalıştığını kesin söylüyorsa onu seç.
  if (runningAppId) {
    const exact = candidates.find(c => c.steamAppId === runningAppId && c.source === 'steam');
    if (exact) return exact;
  }
  // Oyun değişmediyse aynısında kal (titreme olmasın).
  if (previousId) {
    const same = candidates.find(c => c.id === previousId);
    if (same) return same;
  }
  candidates.sort((a, b) => b.priority - a.priority);
  return candidates[0];
}

module.exports = {
  parseVdf, libraryPathsFromVdf, parseAcf, parseEpicItem, parseTasklistCsv,
  buildExeIndex, matchProcesses, shouldSkipDir, DEFAULT_IGNORE
};
