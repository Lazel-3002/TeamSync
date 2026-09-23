// "Oynuyor" algılayıcısı (main süreç). Discord'daki gibi çalışan oyunu
// otomatik bulur ve renderer'a { name, steamAppId, startedAt } bildirir.
//
// Kaynaklar (öncelik sırasıyla): elle eklenen oyunlar > Epic manifestleri >
// Steam kütüphanesi (appmanifest_*.acf) > resources/activity/known-games.json.
// Steam'in HKCU\Software\Valve\Steam\RunningAppID değeri kesin sinyaldir.
//
// Gizlilik: çalışan program listesi bu süreçten ÇIKMAZ; renderer'a yalnızca
// eşleşen oyunun adı/appid'si gider, ağa da yalnızca o yayınlanır.
'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');
const P = require('./activity-parsers');

const INDEX_VERSION = 2;
const INDEX_MAX_AGE = 24 * 60 * 60 * 1000;
const POLL_MS = 15000;
const POLL_BATTERY_MS = 30000;
const EXE_NAME_RE = /^[\w .()+'&!,-]{1,100}\.exe$/i;

function run(cmd, args, timeoutMs = 8000) {
  return new Promise(resolve => {
    let out = '';
    let done = false;
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true });
    } catch (e) {
      resolve('');
      return;
    }
    const finish = () => { if (!done) { done = true; clearTimeout(timer); resolve(out); } };
    const timer = setTimeout(() => { try { child.kill(); } catch (e) {} finish(); }, timeoutMs);
    child.stdout.on('data', chunk => { if (out.length < 4 * 1024 * 1024) out += chunk.toString('utf8'); });
    child.on('error', finish);
    child.on('close', finish);
  });
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch (e) { return false; }
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch (e) { return fallback; }
}

async function writeJson(file, data) {
  try { await fsp.writeFile(file, JSON.stringify(data)); } catch (e) {}
}

// Oyun klasöründe (derinlik ≤2) exe'leri bulur; yeniden dağıtılabilir paket
// klasörleri atlanır.
async function findExes(root, depth = 2, limit = 40) {
  const out = [];
  const walk = async (dir, level) => {
    if (out.length >= limit) return;
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const entry of entries) {
      if (out.length >= limit) return;
      if (entry.isFile() && /\.exe$/i.test(entry.name)) {
        out.push({ name: entry.name, path: path.join(dir, entry.name) });
      } else if (entry.isDirectory() && level < depth && !P.shouldSkipDir(entry.name)) {
        await walk(path.join(dir, entry.name), level + 1);
      }
    }
  };
  await walk(root, 0);
  return out;
}

async function regQuery(key, value) {
  const text = await run('reg', ['query', key, '/v', value], 4000);
  const line = text.split(/\r?\n/).find(l => l.trim().startsWith(value));
  if (!line) return null;
  const parts = line.trim().split(/\s{2,}|\t/).filter(Boolean);
  return parts.length >= 3 ? parts.slice(2).join(' ').trim() : null;
}

class ActivityDetector {
  constructor({ app, ipcMain, powerMonitor, getWindow, isMainWindowSender }) {
    this.app = app;
    this.ipcMain = ipcMain;
    this.powerMonitor = powerMonitor;
    this.getWindow = getWindow;
    this.isMainWindowSender = isMainWindowSender;
    this.settingsFile = path.join(app.getPath('userData'), 'activity.json');
    this.indexFile = path.join(app.getPath('userData'), 'activity-index.json');
    this.settings = { enabled: true, custom: [], hidden: [] };
    this.index = null;
    this.lookup = {};
    this.current = null;
    this.missCount = 0;
    this.pollTimer = null;
    this.scanning = null;
    this.polling = false;
  }

  async init() {
    const saved = await readJson(this.settingsFile, null);
    if (saved && typeof saved === 'object') {
      this.settings.enabled = saved.enabled !== false;
      this.settings.custom = Array.isArray(saved.custom) ? saved.custom.filter(g => g && EXE_NAME_RE.test(g.exe || '')).slice(0, 200) : [];
      this.settings.hidden = Array.isArray(saved.hidden) ? saved.hidden.filter(x => typeof x === 'string').slice(0, 500) : [];
    }
    this.registerIpc();
    const cached = await readJson(this.indexFile, null);
    if (cached && cached.version === INDEX_VERSION) {
      this.index = cached;
      this.rebuildLookup();
    }
    const stale = !this.index || Date.now() - (this.index.builtAt || 0) > INDEX_MAX_AGE;
    // Açılışı yavaşlatmasın: kütüphane taraması 20 sn sonra arka planda.
    setTimeout(() => { if (stale) this.buildIndex().catch(() => {}); }, stale && this.index ? 20000 : 3000);
    this.schedule(this.index ? 4000 : 25000);
  }

  saveSettings() {
    writeJson(this.settingsFile, this.settings);
  }

  loadKnown() {
    try {
      const file = path.join(__dirname, '..', 'resources', 'activity', 'known-games.json');
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { games: Array.isArray(data.games) ? data.games : [], ignore: Array.isArray(data.ignore) ? data.ignore : [] };
    } catch (e) {
      return { games: [], ignore: [] };
    }
  }

  rebuildLookup() {
    const known = this.loadKnown();
    this.lookup = P.buildExeIndex({
      steamApps: (this.index && this.index.steamApps) || [],
      epicApps: (this.index && this.index.epicApps) || [],
      known: known.games,
      ignore: known.ignore,
      custom: this.settings.custom
    });
  }

  async scanSteam() {
    const steamPath = await regQuery('HKCU\\Software\\Valve\\Steam', 'SteamPath');
    if (!steamPath) return { steamPath: null, apps: [] };
    const normalized = path.normalize(steamPath);
    let libraries = [normalized];
    try {
      const vdf = await fsp.readFile(path.join(normalized, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      libraries = P.libraryPathsFromVdf(vdf, normalized);
    } catch (e) {}
    const apps = [];
    for (const lib of libraries) {
      const steamapps = path.join(lib, 'steamapps');
      let files = [];
      try { files = await fsp.readdir(steamapps); } catch (e) { continue; }
      for (const file of files) {
        if (!/^appmanifest_\d+\.acf$/i.test(file)) continue;
        let acf;
        try { acf = P.parseAcf(await fsp.readFile(path.join(steamapps, file), 'utf8')); } catch (e) { acf = null; }
        if (!acf) continue;
        // Steamworks ortak paketleri / araçlar oyun değildir.
        if (acf.appid === 228980) continue;
        const dir = path.join(steamapps, 'common', acf.installdir);
        const exes = await findExes(dir);
        apps.push({ appid: acf.appid, name: acf.name, installdir: acf.installdir, exes });
      }
    }
    return { steamPath: normalized, apps };
  }

  async scanEpic() {
    const base = path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
    let files = [];
    try { files = await fsp.readdir(base); } catch (e) { return []; }
    const apps = [];
    for (const file of files) {
      if (!/\.item$/i.test(file)) continue;
      try {
        const item = P.parseEpicItem(await fsp.readFile(path.join(base, file), 'utf8'));
        if (item) apps.push(item);
      } catch (e) {}
    }
    return apps;
  }

  buildIndex() {
    if (this.scanning) return this.scanning;
    this.scanning = (async () => {
      const [steam, epicApps] = await Promise.all([this.scanSteam(), this.scanEpic()]);
      this.index = { version: INDEX_VERSION, builtAt: Date.now(), steamPath: steam.steamPath, steamApps: steam.apps, epicApps };
      await writeJson(this.indexFile, this.index);
      this.rebuildLookup();
      return this.gameCount();
    })().finally(() => { this.scanning = null; });
    return this.scanning;
  }

  gameCount() {
    const ids = new Set(Object.values(this.lookup).map(g => g.id));
    return ids.size;
  }

  schedule(delay) {
    clearTimeout(this.pollTimer);
    if (!this.settings.enabled) return;
    let ms = delay;
    if (ms == null) {
      let battery = false;
      try { battery = typeof this.powerMonitor.isOnBatteryPower === 'function' ? this.powerMonitor.isOnBatteryPower() : !!this.powerMonitor.onBatteryPower; } catch (e) {}
      ms = battery ? POLL_BATTERY_MS : POLL_MS;
    }
    this.pollTimer = setTimeout(() => this.poll().finally(() => this.schedule()), ms);
  }

  async runningAppId() {
    if (!this.index || !this.index.steamPath) return 0;
    const raw = await regQuery('HKCU\\Software\\Valve\\Steam', 'RunningAppID');
    const id = raw ? parseInt(raw, raw.startsWith('0x') ? 16 : 10) : 0;
    if (!Number.isInteger(id) || id <= 0) return 0;
    // Yalnızca kurulu bir oyunsa güven (Steam çökünce değer bayat kalabiliyor).
    return (this.index.steamApps || []).some(app => app.appid === id) ? id : 0;
  }

  async poll() {
    if (!this.settings.enabled || this.polling) return;
    this.polling = true;
    try {
      // 40 MB altı süreçler hiçbir oyun değildir; filtre tasklist'i ~2 kat hızlandırır.
      const [csv, runningAppId] = await Promise.all([
        run('tasklist', ['/fo', 'csv', '/nh', '/fi', 'MEMUSAGE gt 40000'], 8000),
        this.runningAppId()
      ]);
      const processes = P.parseTasklistCsv(csv);
      if (!processes.length) return; // tasklist başarısız: durumu değiştirme
      const match = P.matchProcesses(processes, this.lookup, {
        hidden: this.settings.hidden,
        runningAppId,
        previousId: this.current ? this.current.id : null
      });
      if (match) {
        this.missCount = 0;
        if (!this.current || this.current.id !== match.id || this.current.pid !== match.pid) {
          await this.setCurrent(match);
        }
      } else if (this.current) {
        this.missCount++;
        if (this.missCount >= 2) this.setCurrentNone();
      }
    } finally {
      this.polling = false;
    }
  }

  async processStart(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return null;
    const text = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().ToString('o')`], 5000);
    const ms = Date.parse(text.trim());
    return Number.isFinite(ms) && ms <= Date.now() ? ms : null;
  }

  async iconFor(exePath) {
    if (!exePath) return '';
    try {
      const img = await this.app.getFileIcon(exePath, { size: 'normal' });
      return img && !img.isEmpty() ? img.toDataURL() : '';
    } catch (e) { return ''; }
  }

  async setCurrent(match) {
    const sameGame = this.current && this.current.id === match.id;
    const startedAt = sameGame ? this.current.startedAt : ((await this.processStart(match.pid)) || Date.now());
    this.current = {
      id: match.id,
      name: match.name,
      source: match.source,
      steamAppId: match.steamAppId || 0,
      exe: match.exe,
      pid: match.pid,
      startedAt,
      icon: sameGame ? this.current.icon : await this.iconFor(match.path)
    };
    this.emit();
  }

  setCurrentNone() {
    this.current = null;
    this.missCount = 0;
    this.emit();
  }

  publicCurrent() {
    if (!this.current) return null;
    const { id, name, source, steamAppId, startedAt, icon } = this.current;
    return { id, name, source, steamAppId, startedAt, icon };
  }

  emit() {
    const win = this.getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('activity-changed', this.publicCurrent());
  }

  state() {
    return {
      available: true,
      enabled: this.settings.enabled,
      current: this.publicCurrent(),
      custom: this.settings.custom,
      hidden: this.settings.hidden,
      gameCount: this.gameCount(),
      lastScan: this.index ? this.index.builtAt : 0
    };
  }

  async listRunning() {
    const script = "Get-Process | Where-Object { $_.MainWindowTitle -and $_.Path } | Select-Object Id,ProcessName,MainWindowTitle,Path | ConvertTo-Json -Compress";
    const text = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], 10000);
    let rows;
    try { rows = JSON.parse(text); } catch (e) { rows = []; }
    if (!Array.isArray(rows)) rows = rows ? [rows] : [];
    const self = path.basename(process.execPath).toLowerCase();
    const seen = new Set();
    const out = [];
    rows.forEach(r => {
      const exe = path.basename(String(r.Path || ''));
      const key = exe.toLowerCase();
      if (!EXE_NAME_RE.test(exe) || seen.has(key) || key === self || P.DEFAULT_IGNORE.includes(key)) return;
      if (/\\windows\\/i.test(String(r.Path))) return;
      seen.add(key);
      out.push({ exe, title: String(r.MainWindowTitle || '').slice(0, 100), path: String(r.Path || '') });
    });
    return out.sort((a, b) => a.title.localeCompare(b.title)).slice(0, 60);
  }

  registerIpc() {
    const guard = handler => async (event, ...args) => {
      if (!this.isMainWindowSender(event)) return null;
      return handler(...args);
    };
    this.ipcMain.handle('activity-get-state', guard(() => this.state()));
    this.ipcMain.handle('activity-set-enabled', guard(enabled => {
      this.settings.enabled = !!enabled;
      this.saveSettings();
      if (this.settings.enabled) this.schedule(500);
      else { clearTimeout(this.pollTimer); if (this.current) this.setCurrentNone(); }
      return this.state();
    }));
    this.ipcMain.handle('activity-list-running', guard(() => this.listRunning()));
    this.ipcMain.handle('activity-add-custom', guard(game => {
      if (!game || typeof game !== 'object') return this.state();
      const exe = String(game.exe || '').trim();
      const name = String(game.name || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 80);
      if (!EXE_NAME_RE.test(exe) || !name) return this.state();
      const id = exe.toLowerCase();
      this.settings.custom = this.settings.custom.filter(g => g.id !== id);
      this.settings.custom.push({ id, exe, name, path: typeof game.path === 'string' ? game.path.slice(0, 400) : '' });
      this.settings.hidden = this.settings.hidden.filter(h => h !== `custom:${id}`);
      this.saveSettings();
      this.rebuildLookup();
      this.schedule(300);
      return this.state();
    }));
    this.ipcMain.handle('activity-remove-custom', guard(id => {
      this.settings.custom = this.settings.custom.filter(g => g.id !== id);
      this.saveSettings();
      this.rebuildLookup();
      if (this.current && this.current.id === `custom:${id}`) this.setCurrentNone();
      return this.state();
    }));
    this.ipcMain.handle('activity-set-hidden', guard((id, hidden) => {
      if (typeof id !== 'string' || id.length > 200) return this.state();
      this.settings.hidden = this.settings.hidden.filter(h => h !== id);
      if (hidden) this.settings.hidden.push(id);
      this.saveSettings();
      if (hidden && this.current && this.current.id === id) this.setCurrentNone();
      else this.schedule(300);
      return this.state();
    }));
    this.ipcMain.handle('activity-rescan', guard(async () => {
      await this.buildIndex();
      this.schedule(300);
      return this.state();
    }));
  }
}

function initActivityDetector(opts) {
  const detector = new ActivityDetector(opts);
  detector.init().catch(e => console.warn('Oyun algılayıcı başlatılamadı:', e && e.message));
  return detector;
}

module.exports = { initActivityDetector, ActivityDetector };
