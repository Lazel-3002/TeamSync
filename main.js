const { app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut, Menu, Notification, screen, shell, Tray, nativeImage, safeStorage } = require('electron');
app.name = 'TeamSync';
// Donanım hızlandırma tercihi ayarlardan değiştirilebilir (settings.json).
// Varsayılan: AÇIK — backdrop-filter (buzlu cam) yalnızca GPU açıkken çalışır.
// Sadece ayar açıkça false ise kapatılır. Değişiklik yeniden başlatınca etkin olur.
const _diagSettingsPath = require('path').join(app.getPath('userData'), 'settings.json');
let _diagHwAccelEffective = true; // varsayılan açık
try {
  const _fs = require('fs');
  if (_fs.existsSync(_diagSettingsPath)) {
    const _s = JSON.parse(_fs.readFileSync(_diagSettingsPath, 'utf8'));
    if (_s && _s.hardwareAcceleration === false) {
      app.disableHardwareAcceleration();
      _diagHwAccelEffective = false;
    }
  }
} catch (e) { /* ayar okunamazsa varsayılan: donanım hızlandırma açık */ }
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
app.commandLine.appendSwitch('allow-loopback-in-peer-connection');
app.commandLine.appendSwitch('disable-async-dns');

// TEŞHİS: renderer içinde çalışır (executeJavaScript ile enjekte edilir).
// GERÇEKTE yüklenen stylesheet'leri, .dl-btn'in tüm eşleşen kurallarını ve
// canlı bir .dl-btn probe'unun HESAPLANMIŞ stilini toplar. Kapanış (closure)
// yok — tamamen kendine yeten, tarayıcı global'lerini kullanan bir fonksiyon.
async function _diagRendererProbe() {
  const out = {
    href: location.href, userAgent: navigator.userAgent, dpr: window.devicePixelRatio,
    bodyClass: document.body ? document.body.className : '',
    sheets: [], styleLinkHref: '', matchedRules: [], computed: null,
    fetchedCss: null, fetchError: null,
  };
  try { out.sheets = Array.from(document.styleSheets).map(s => s.href || '(inline)'); } catch (e) {}
  try {
    const link = document.querySelector('link[rel="stylesheet"][href*="style.css"]');
    out.styleLinkHref = link ? link.href : '(bulunamadı)';
  } catch (e) {}
  try {
    for (const sheet of Array.from(document.styleSheets)) {
      let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
      if (!rules) continue;
      for (const rule of Array.from(rules)) {
        if (rule.selectorText && rule.selectorText.includes('dl-btn')) {
          out.matchedRules.push({ source: (sheet.href || 'inline').split('/').pop(), text: rule.cssText.slice(0, 300) });
        }
      }
    }
  } catch (e) {}
  try {
    const wrap = document.createElement('div');
    wrap.className = 'img-wrap';
    wrap.style.cssText = 'position:fixed;left:-9999px;top:0;';
    wrap.innerHTML = '<img class="chat-img"><a class="dl-btn"></a>';
    document.body.appendChild(wrap);
    const cs = getComputedStyle(wrap.querySelector('.dl-btn'));
    out.computed = {
      borderRadius: cs.borderRadius, backgroundColor: cs.backgroundColor,
      backgroundImage: cs.backgroundImage,
      backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter || 'none',
      boxShadow: cs.boxShadow, width: cs.width, height: cs.height, border: cs.border,
    };
    document.body.removeChild(wrap);
  } catch (e) { out.computed = { hata: String(e) }; }
  try {
    const link = document.querySelector('link[rel="stylesheet"][href*="style.css"]');
    if (link) out.fetchedCss = await (await fetch(link.href)).text();
  } catch (e) { out.fetchError = String(e); }
  return out;
}
const path = require('path');
const dgram = require('dgram');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
let cloudflaredProcess = null;

const fs = require('fs');
const baseUserData = app.getPath('userData');
const lockFile = path.join(baseUserData, 'teamsync.lock');
let isSecondInstance = false;

// Load .env variables. Bu blok process.env'i modül yüklenirken (pencere/preload
// oluşturulmadan ÖNCE) doldurur; renderer/preload süreçleri bu değerleri kalıtır.
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envFile = fs.readFileSync(envPath, 'utf8');
  envFile.split('\n').forEach(line => {
    const [key, ...rest] = line.split('=');
    const val = rest.join('=');
    if (key && val) process.env[key.trim()] = val.trim();
  });
}

// Gömülü Supabase yapılandırması (fallback). KURULU sürümde pakete .env
// KONMADIĞI için (electron-builder files: "!.env") .env okuması boş kalır ve
// Supabase istemcisi kurulamazdı → "Sunucu yapılandırması eksik" hatası. Anon
// key public bir anahtardır (JWT role=anon), istemcilere dağıtılmak üzere
// tasarlanmıştır ve veritabanını RLS korur; URL zaten CSP'de açıkça yazılıdır.
// .env varsa (dev) onun değerleri bunları EZER — yukarıdaki blok önce çalışır.
const SUPABASE_DEFAULTS = {
  SUPABASE_URL: 'https://zperyrjpfumtblossyod.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpwZXJ5cmpwZnVtdGJsb3NzeW9kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5NjU5ODAsImV4cCI6MjA5OTU0MTk4MH0.BwA7IabSS3qySc0EF3XI__a4J8RlBSa5cLf1HhT4Bc4',
};
for (const [k, v] of Object.entries(SUPABASE_DEFAULTS)) {
  if (!process.env[k]) process.env[k] = v;
}

function isPidRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

try {
  if (!fs.existsSync(baseUserData)) {
    fs.mkdirSync(baseUserData, { recursive: true });
  }

  if (fs.existsSync(lockFile)) {
    try {
      const lockContent = fs.readFileSync(lockFile, 'utf8').trim();
      const existingPid = parseInt(lockContent, 10);
      if (existingPid && isPidRunning(existingPid)) {
        isSecondInstance = true;
      }
    } catch (e) {
      isSecondInstance = true;
    }
  }

  if (!isSecondInstance) {
    fs.writeFileSync(lockFile, process.pid.toString(), 'utf8');
    global.myAppLock = fs.openSync(lockFile, 'r+');
  } else {
    app.setPath('userData', `${baseUserData}-${process.pid}`);
  }
} catch (e) {
  isSecondInstance = true;
  app.setPath('userData', `${baseUserData}-${process.pid}`);
}

let mainWindow = null;
let discoverySocket = null;
let discoveryInterval = null;
let myPeerId = null;
let currentRoom = '';
let currentName = '';
let remoteControlActive = false;
let remoteControlOwner = 'host';
let remoteParticipantPoint = null;
let hostPassivePoint = null;
let remoteInjectionUntil = 0;
let remoteMoveGuard = null;
let currentScreenShareSourceId = null;
let sharedDisplayBounds = null;
let robot = null;
let uIOhook = null;
let inputHookStarted = false;
let cursorOverlayWindow = null;

let tray = null;
let trayMenuWindow = null;
let isQuitting = false;
let notificationWindow = null;

const DISCOVERY_PORT = 41234;

try {
  robot = require('@jitsi/robotjs');
  console.log('✅ robotjs yüklendi - uzaktan kontrol aktif');
} catch (e) {
  console.warn('⚠️ robotjs yüklenemedi. Uzaktan kontrol çalışmaz:', e.message);
  console.warn('   Kurulum: Windows için Visual Studio Build Tools gerekebilir.');
}

try {
  ({ uIOhook } = require('uiohook-napi'));
  console.log('✅ Global fare dinleyicisi yüklendi - tıklayarak kontrol devri aktif');
} catch (e) {
  console.warn('⚠️ Global fare dinleyicisi yüklenemedi; paylaşan kişi tıklayarak kontrolü geri alamaz:', e.message);
}

function getControlBounds() {
  return sharedDisplayBounds || screen.getPrimaryDisplay().bounds;
}

function normalizePrimaryPoint(point = screen.getCursorScreenPoint()) {
  const bounds = getControlBounds();
  return {
    x: Math.max(0, Math.min(1, (point.x - bounds.x) / bounds.width)),
    y: Math.max(0, Math.min(1, (point.y - bounds.y) / bounds.height))
  };
}

function validNormalizedPoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y)
    ? { x: Math.max(0, Math.min(1, point.x)), y: Math.max(0, Math.min(1, point.y)) }
    : null;
}

function createCursorOverlay() {
  if (cursorOverlayWindow && !cursorOverlayWindow.isDestroyed()) return cursorOverlayWindow;
  const bounds = getControlBounds();
  cursorOverlayWindow = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    movable: false,
    resizable: false,
    hasShadow: false,
    enableLargerThanScreen: true,
    webPreferences: {
      preload: path.join(__dirname, 'electron', 'preload-cursor-overlay.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });
  cursorOverlayWindow.setIgnoreMouseEvents(true);
  cursorOverlayWindow.setAlwaysOnTop(true, 'screen-saver');
  cursorOverlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Windows'ta katmanı ekran kaydından çıkarır. Kontrol eden kendi düşük gecikmeli
  // imleçlerini yerel olarak çizer; paylaşan ise bu masaüstü katmanını görür.
  cursorOverlayWindow.setContentProtection(true);
  cursorOverlayWindow.loadFile(path.join(__dirname, 'electron', 'cursor-overlay.html'));
  cursorOverlayWindow.on('closed', () => { cursorOverlayWindow = null; });
  return cursorOverlayWindow;
}

function safeCursorAvatar(value) {
  if (typeof value !== 'string' || value.length > 2_000_000) return '';
  return /^(https?:\/\/|data:image\/)/i.test(value) ? value : '';
}

function cursorProfile(label, avatar) {
  const normalizedLabel = String(label || '').trim();
  if (!normalizedLabel) return null;
  return {
    avatar: safeCursorAvatar(avatar),
    initial: normalizedLabel.charAt(0).toLocaleUpperCase('tr-TR')
  };
}

function renderVirtualCursor(point, options = {}) {
  const normalized = validNormalizedPoint(point);
  const overlay = createCursorOverlay();
  if (!normalized) {
    if (!overlay.isDestroyed()) overlay.webContents.send('cursor-overlay-update', { visible: false });
    return;
  }
  const bounds = getControlBounds();
  if (overlay.getBounds().x !== bounds.x || overlay.getBounds().y !== bounds.y ||
      overlay.getBounds().width !== bounds.width || overlay.getBounds().height !== bounds.height) {
    overlay.setBounds(bounds);
  }
  const update = {
    visible: true,
    x: Math.round(normalized.x * bounds.width),
    y: Math.round(normalized.y * bounds.height),
    label: options.label || '',
    profile: cursorProfile(options.profileLabel, options.avatar),
    activeProfile: null
  };
  const activePoint = options.activeProfile && validNormalizedPoint(options.activeProfile.point);
  if (activePoint) {
    update.activeProfile = {
      x: Math.round(activePoint.x * bounds.width),
      y: Math.round(activePoint.y * bounds.height),
      ...cursorProfile(options.activeProfile.label, options.activeProfile.avatar)
    };
  }
  const show = () => {
    if (!overlay || overlay.isDestroyed()) return;
    overlay.webContents.send('cursor-overlay-update', update);
    overlay.showInactive();
  };
  if (overlay.webContents.isLoadingMainFrame()) overlay.webContents.once('did-finish-load', show);
  else show();
}

function hideVirtualCursor() {
  if (!cursorOverlayWindow || cursorOverlayWindow.isDestroyed()) return;
  cursorOverlayWindow.webContents.send('cursor-overlay-update', { visible: false });
  cursorOverlayWindow.hide();
}

function renderCursorForOwner() {
  if (!remoteControlActive) return hideVirtualCursor();
  if (remoteControlOwner === 'remote') {
    renderVirtualCursor(hostPassivePoint, { label: 'Paylaşan', activeProfile: remoteParticipantPoint });
  } else {
    renderVirtualCursor(remoteParticipantPoint && remoteParticipantPoint.point, {
      label: remoteParticipantPoint && remoteParticipantPoint.label,
      profileLabel: remoteParticipantPoint && remoteParticipantPoint.label,
      avatar: remoteParticipantPoint && remoteParticipantPoint.avatar
    });
  }
}

function handleLocalMouseDown() {
  if (!remoteControlActive || remoteControlOwner !== 'remote') return;
  if (Date.now() <= remoteInjectionUntil) return;
  remoteControlOwner = 'host';
  hostPassivePoint = normalizePrimaryPoint();
  renderCursorForOwner();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('local-control-takeover', { owner: 'host', hostPoint: hostPassivePoint });
  }
}

function handleLocalMouseMove() {
  if (!remoteControlActive || remoteControlOwner !== 'remote') return;
  const point = normalizePrimaryPoint();
  if (remoteMoveGuard && Date.now() <= remoteMoveGuard.until &&
      Math.abs(point.x - remoteMoveGuard.x) < 0.004 && Math.abs(point.y - remoteMoveGuard.y) < 0.004) {
    return;
  }
  hostPassivePoint = point;
  renderCursorForOwner();
}

function startLocalInputHook() {
  if (!uIOhook || inputHookStarted) return;
  try {
    uIOhook.on('mousedown', handleLocalMouseDown);
    uIOhook.on('mousemove', handleLocalMouseMove);
    uIOhook.start();
    inputHookStarted = true;
  } catch (e) {
    console.error('Global fare dinleyicisi başlatılamadı:', e);
  }
}

function stopLocalInputHook() {
  if (!uIOhook || !inputHookStarted) return;
  try {
    uIOhook.stop();
    uIOhook.removeListener('mousedown', handleLocalMouseDown);
    uIOhook.removeListener('mousemove', handleLocalMouseMove);
  } catch (e) {
    console.warn('Global fare dinleyicisi durdurulamadı:', e.message);
  }
  inputHookStarted = false;
}

function setRemoteControlEnabled(active) {
  remoteControlActive = Boolean(active);
  remoteControlOwner = 'host';
  remoteParticipantPoint = null;
  hostPassivePoint = normalizePrimaryPoint();
  if (remoteControlActive) startLocalInputHook();
  else {
    stopLocalInputHook();
    hideVirtualCursor();
  }
  syncControlKillSwitch();
}

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push({ name, address: iface.address, netmask: iface.netmask });
      }
    }
  }
  return ips;
}

function getBroadcastAddresses() {
  const ips = getLocalIPs();
  const bcasts = ['255.255.255.255'];
  ips.forEach(ipInfo => {
    if (ipInfo.address && ipInfo.netmask) {
      const ipParts = ipInfo.address.split('.').map(Number);
      const maskParts = ipInfo.netmask.split('.').map(Number);
      const bcastParts = ipParts.map((part, i) => part | (~maskParts[i] & 255));
      const bcast = bcastParts.join('.');
      if (!bcasts.includes(bcast)) bcasts.push(bcast);
    }
  });
  return bcasts;
}

function startDiscovery(peerId, name) {
  myPeerId = peerId;
  if (discoverySocket) {
    try { discoverySocket.close(); } catch (e) {}
  }
  if (discoveryInterval) {
    clearInterval(discoveryInterval);
  }

  discoverySocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  discoverySocket.on('error', (err) => {
    console.error('Discovery socket hatası:', err);
  });
  discoverySocket.on('message', (msg, rinfo) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.id !== myPeerId && mainWindow && !mainWindow.isDestroyed()) {
        if (data.room !== currentRoom) return;

        if (data.type === 'signal') {
          mainWindow.webContents.send('peer-discovered', {
            id: data.id,
            name: data.name,
            ip: rinfo.address,
            room: data.room
          });
          mainWindow.webContents.send('udp-signal', {
            id: data.id,
            ip: rinfo.address,
            signal: data.signal
          });
        } else {
          mainWindow.webContents.send('peer-discovered', {
            id: data.id,
            name: data.name,
            ip: rinfo.address,
            room: data.room
          });
        }
      }
    } catch (e) {}
  });
  discoverySocket.bind(DISCOVERY_PORT, () => {
    try { discoverySocket.setBroadcast(true); } catch (e) {}
    console.log('🔍 UDP keşfi başlatıldı, port:', DISCOVERY_PORT);
  });

  discoveryInterval = setInterval(() => {
    if (!discoverySocket) return;
    const msg = Buffer.from(JSON.stringify({
      id: myPeerId,
      name: currentName,
      room: currentRoom,
      timestamp: Date.now()
    }));

    
    const addresses = getBroadcastAddresses();
    addresses.forEach(addr => {
      try {
        discoverySocket.send(msg, 0, msg.length, DISCOVERY_PORT, addr);
      } catch (e) {}
    });
  }, 2000);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 850,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      webRTCIPHandlingPolicy: 'default_public_and_private_interfaces',
      autoplayPolicy: 'no-user-gesture-required',
      // Pencere arka planda/simge durumundayken zamanlayıcılar kısılırsa
      // ses kapısı ve sinyalleşme aksar; sesli sohbet uygulaması için kapalı olmalı.
      backgroundThrottling: false
    },
    backgroundColor: '#1e1f22',
    title: 'TeamSync - P2P',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webSecurity: true,
    frame: false
  });
  
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Defense-in-depth: renderer tarafında <webview> etiketine yazılan güvenlik
  // özniteliklerine güvenmek yerine, main process'te de zorla uyguluyoruz.
  // Böylece render sürecindeki bir hata/açık, webview'e Node.js erişimi
  // sızdıramaz.
  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    delete webPreferences.preloadURL;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
  });

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer ${level}] ${message} (${line})`);
  });

  const _loadTarget = process.env.REACT_DEV === 'true' ? 'http://localhost:5173' : 'index.html';
  if (process.env.REACT_DEV === 'true') {
    mainWindow.loadURL('http://localhost:5173');
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile('index.html');
  }
  Menu.setApplicationMenu(null);

  // --- TEŞHİS GÜNLÜĞÜ (opt-in: DIAG=1 veya settings.diagnosticLog) ---
  try {
    const diagnostics = require('./diagnostics');
    const diagInfo = diagnostics.init(app, {
      settingsPath: _diagSettingsPath,
      effectiveHardwareAccel: _diagHwAccelEffective,
      loadedTarget: _loadTarget + ' (çözümlenen: ' + require('path').join(app.getAppPath(), 'index.html') + ')',
    });
    if (diagInfo && diagInfo.enabled) {
      // Renderer yüklendiğinde tarayıcı tarafını da toplayıp aynı dosyaya ekle.
      mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.executeJavaScript(`(${_diagRendererProbe.toString()})()`, true)
          .then(data => diagnostics.appendRenderer(data))
          .catch(err => diagnostics.appendRenderer({ error: String(err) }));
      });
    }
  } catch (e) { console.warn('[DIAG] başlatılamadı:', e.message); }

  if (!app.isPackaged) {
    try {
      require('./tools/dev/yapaydenetleyici.js')(mainWindow);
    } catch (e) {
      console.warn("Yapay denetleyici başlatılamadı:", e);
    }
  }

  let hasShownHideNotification = false;
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      if (!hasShownHideNotification) {
        hasShownHideNotification = true;
        const hideNotif = new Notification({
          title: 'TeamSync Arka Planda',
          body: 'Uygulama tamamen kapatılmadı. Sağ alt köşedeki simgeye sağ tıklayarak çıkış yapabilirsiniz.',
          silent: true
        });
        hideNotif.show();
        setTimeout(() => {
          hideNotif.close();
        }, 1500);
      }
      return false;
    }
  });

  // Pencere tray'e gizlenince renderer haber alsın: Ortak Tarayıcı'daki video
  // sesi pencere kapalıyken de çalmaya devam ediyordu — renderer bu sinyalle
  // webview sesini susturur (sesli sohbete dokunulmaz), pencere dönünce açar.
  mainWindow.on('hide', () => {
    try { mainWindow.webContents.send('window-visibility', false); } catch (e) {}
  });
  mainWindow.on('show', () => {
    try { mainWindow.webContents.send('window-visibility', true); } catch (e) {}
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('get-local-ips', () => getLocalIPs());

// Cloudflare WARP tespiti: 1.1.1.1/cdn-cgi/trace yanıtındaki warp=on/plus
// alanı, isteğin WARP tünelinden çıktığını söyler. Renderer'dan fetch ile
// yapılamıyor (endpoint CORS başlığı göndermiyor); ana süreç CORS'a tabi
// değil. IP-literal olduğu için WARP'ın bozabileceği DNS'e de bağımlı değil.
ipcMain.handle('detect-warp', () => {
  return new Promise((resolve) => {
    const req = require('https').get({ host: '1.1.1.1', path: '/cdn-cgi/trace', timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        const m = /(?:^|\n)warp=(on|plus)(?:\n|$)/.exec(data);
        resolve(m ? m[1] : null);
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
});

ipcMain.handle('toggle-fullscreen', () => {
  if (mainWindow) {
    const isFull = mainWindow.isFullScreen();
    mainWindow.setFullScreen(!isFull);
    return !isFull;
  }
  return false;
});

ipcMain.handle('load-accounts', () => {
  const filePath = path.join(baseUserData, 'accounts.json');
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      return [];
    }
  }
  return [];
});

ipcMain.handle('save-accounts', (event, accounts) => {
  const filePath = path.join(baseUserData, 'accounts.json');
  try {
    fs.writeFileSync(filePath, JSON.stringify(accounts, null, 2), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
});

// --- Uygulama ayarları (settings.json) — donanım hızlandırma tercihi ----------
function readSettings() {
  try {
    const fp = path.join(baseUserData, 'settings.json');
    if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf8')) || {};
  } catch (e) {}
  return {};
}
function writeSettings(obj) {
  try {
    fs.writeFileSync(path.join(baseUserData, 'settings.json'), JSON.stringify(obj, null, 2), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}
ipcMain.handle('get-hardware-acceleration', () => readSettings().hardwareAcceleration !== false);
ipcMain.handle('get-effective-hardware-acceleration', () => _diagHwAccelEffective);
ipcMain.handle('set-hardware-acceleration', (event, enabled) => {
  const s = readSettings();
  s.hardwareAcceleration = !!enabled;
  return writeSettings(s);
});

ipcMain.handle('is-second-instance', () => {
  return isSecondInstance;
});

// --- TEŞHİS: renderer'ın canlı DOM'dan yakaladığı indirme butonlarını günlükle ---
ipcMain.handle('diag-enabled', () => {
  try { return require('./diagnostics').isEnabled(); } catch (e) { return false; }
});
ipcMain.on('diag-capture', (e, info) => {
  try { require('./diagnostics').appendCapture(info); } catch (err) {}
});

// ─── Cihaz Kimliği ───────────────────────────────────────────────────────────
// İlk açılışta bir kez üretilir: 256-bit kriptografik rastgele gizli anahtar.
// Dosya safeStorage (Windows DPAPI) ile şifrelenir; yalnızca bu Windows
// kullanıcı hesabı çözebilir. Ham anahtar renderer'a hiç verilmez — Supabase
// giriş bilgileri SHA-256 ile tek yönlü türetilip IPC üzerinden döner.
const nodeCrypto = require('crypto');
const deviceIdentityFile = path.join(baseUserData, 'device-identity.bin');

function loadOrCreateDeviceSecret() {
  try {
    if (fs.existsSync(deviceIdentityFile)) {
      const raw = fs.readFileSync(deviceIdentityFile);
      return safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(raw)
        : raw.toString('utf8');
    }
  } catch (e) {
    console.error('Cihaz kimliği çözülemedi, yenisi üretilecek:', e.message);
  }
  const secret = nodeCrypto.randomBytes(32).toString('hex');
  const payload = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(secret)
    : Buffer.from(secret, 'utf8');
  // Windows'ta gizli (+h) dosyanın üzerine writeFileSync EPERM verir —
  // yazmadan önce gizliliği kaldır, yazınca geri koy.
  try { spawnSync('attrib', ['-h', deviceIdentityFile]); } catch (e) {}
  fs.writeFileSync(deviceIdentityFile, payload);
  try { spawnSync('attrib', ['+h', deviceIdentityFile]); } catch (e) {}
  return secret;
}

// slot: aynı cihazda birden çok hesap. Hepsi aynı cihaz kimliğini (deviceId)
// paylaşır; slot 0'ın türetimi ilk sürümle birebir aynı kalmalı (geriye uyum).
ipcMain.handle('get-device-credentials', (event, slot) => {
  const s = Number.isInteger(slot) && slot > 0 ? slot : 0;
  const secret = loadOrCreateDeviceSecret();
  const deviceId = nodeCrypto.createHash('sha256').update('teamsync-device-id:' + secret).digest('hex').slice(0, 40);
  const pwSource = s === 0
    ? 'teamsync-device-pw:' + secret
    : 'teamsync-device-pw:' + s + ':' + secret;
  const password = nodeCrypto.createHash('sha256').update(pwSource).digest('base64');
  const emailLocal = s === 0 ? 'd-' + deviceId : 'd-' + deviceId + '-' + s;
  return { email: emailLocal + '@device.teamsync.app', password, deviceId, slot: s };
});

ipcMain.handle('start-cloudflared', async (event, port) => {
  return new Promise((resolve, reject) => {
    const exePath = path.join(app.getAppPath(), 'vendor', 'cloudflared', 'cloudflared.exe');
    cloudflaredProcess = spawn(exePath, ['tunnel', '--url', `localhost:${port}`]);

    cloudflaredProcess.stderr.on('data', (data) => {
      const output = data.toString();
      const match = output.match(/https:\/\/(.*?)\.trycloudflare\.com/);
      if (match && match[1]) {
        resolve(match[1]);
      }
    });

    cloudflaredProcess.on('error', (err) => {
      reject(err);
    });

    setTimeout(() => {
      reject(new Error("Cloudflare tünel adresi oluşturulamadı."));
    }, 15000);
  });
});

ipcMain.on('stop-cloudflared', () => {
  if (cloudflaredProcess) {
    cloudflaredProcess.kill();
    cloudflaredProcess = null;
  }
});

// Custom titlebar handlers
ipcMain.on('window-min', () => {
  if (mainWindow) mainWindow.minimize();
});
ipcMain.on('window-max', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});
ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});
function forceQuit() {
  if (cloudflaredProcess) {
    try { cloudflaredProcess.kill(); } catch (e) {}
  }
  if (discoveryInterval) clearInterval(discoveryInterval);
  if (discoverySocket) { try { discoverySocket.close(); } catch (e) {} }
  if (global.myAppLock) { try { fs.closeSync(global.myAppLock); } catch(e) {} }
  try { if (!isSecondInstance && fs.existsSync(lockFile)) fs.unlinkSync(lockFile); } catch(e) {}
  
  app.exit(0);
  process.exit(0);
}

ipcMain.on('app-quit-force', () => {
  forceQuit();
});

// ---- OTOMATİK GÜNCELLEME (electron-updater + GitHub Releases) ----
// Paketli (kurulu) sürümde açılışta güncelleme denetlenir, varsa arka planda
// indirilir; renderer'a 'update-status' olaylarıyla durum bildirilir. Kurulum
// yalnızca kullanıcı ana menüdeki butona basınca yapılır (quitAndInstall).
// Dev modda (app.isPackaged=false) tamamen devre dışı — dev-app-update.yml yok.
let autoUpdater = null;
let updateStatus = { state: 'idle' };

function sendUpdateStatus(payload) {
  updateStatus = payload;
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send('update-status', payload); } catch (e) {}
  }
}

function setupAutoUpdater() {
  if (!app.isPackaged) return;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (e) {
    console.warn('electron-updater yüklenemedi:', e.message);
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // buton kaçırılsa bile çıkışta kurulur
  autoUpdater.on('checking-for-update', () => sendUpdateStatus({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => sendUpdateStatus({ state: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('update-not-available', () => sendUpdateStatus({ state: 'none' }));
  autoUpdater.on('download-progress', (p) => sendUpdateStatus({ state: 'downloading', percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => sendUpdateStatus({ state: 'downloaded', version: info.version }));
  autoUpdater.on('error', (err) => sendUpdateStatus({ state: 'error', message: (err && err.message || '').slice(0, 200) }));
  autoUpdater.checkForUpdates().catch(() => {});
  // Uygulama açık kaldıkça 4 saatte bir yeniden denetle.
  setInterval(() => { autoUpdater.checkForUpdates().catch(() => {}); }, 4 * 3600 * 1000);
}

ipcMain.handle('update-check', async () => {
  if (!autoUpdater) return { state: app.isPackaged ? 'error' : 'dev' };
  try { await autoUpdater.checkForUpdates(); } catch (e) {}
  return updateStatus;
});
ipcMain.handle('update-get-status', () => (autoUpdater ? updateStatus : { state: app.isPackaged ? 'idle' : 'dev' }));
ipcMain.on('update-install', () => {
  if (!autoUpdater) return;
  // close→tray davranışı quitAndInstall'un pencereyi kapatmasını engellemesin.
  isQuitting = true;
  autoUpdater.quitAndInstall(true, true); // sessiz kur + otomatik yeniden başlat
});

ipcMain.handle('get-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 320, height: 180 }
    });
    return sources.map(s => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL()
    }));
  } catch (e) {
    return [];
  }
});
ipcMain.on('start-discovery', (event, { peerId, name, room }) => {
  currentRoom = room;
  currentName = name;
  startDiscovery(peerId, name);
});

ipcMain.on('stop-discovery', () => {
  if (discoveryInterval) { clearInterval(discoveryInterval); discoveryInterval = null; }
  if (discoverySocket) { try { discoverySocket.close(); } catch (e) {} discoverySocket = null; }
});

ipcMain.on('send-udp-signal', (event, { ip, signal }) => {
  if (!discoverySocket || !myPeerId) return;
  const msg = Buffer.from(JSON.stringify({
    id: myPeerId,
    name: currentName,
    room: currentRoom,
    type: 'signal',
    signal: signal
  }));
  try {
    discoverySocket.send(msg, 0, msg.length, DISCOVERY_PORT, ip);
  } catch (e) {}
});

ipcMain.on('direct-connect', (event, ip) => {
  if (!discoverySocket || !myPeerId) return;
  const msg = Buffer.from(JSON.stringify({
    id: myPeerId,
    name: currentName,
    room: currentRoom,
    timestamp: Date.now()
  }));
  try {
    discoverySocket.send(msg, 0, msg.length, DISCOVERY_PORT, ip);
    console.log(`📡 Direct UDP ping sent to ${ip}`);
  } catch (e) {
    console.error('Direct connect error:', e);
  }
});

ipcMain.on('register-ptt', (event, key) => {
  globalShortcut.unregisterAll();
  const k = key || 'Space';
  try {
    globalShortcut.register(k, () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ptt-trigger');
      }
    });
  } catch (e) {
    console.error('PTT kayıt hatası:', e);
  }
  // unregisterAll kill-switch'i de sildiği için geri yükle
  syncControlKillSwitch();
});
ipcMain.on('unregister-ptt', () => {
  globalShortcut.unregisterAll();
  // unregisterAll kill-switch'i de sildiği için geri yükle
  syncControlKillSwitch();
});

ipcMain.on('notify', (event, { title, body }) => {
  try {
    if (notificationWindow && !notificationWindow.isDestroyed()) {
      notificationWindow.showInactive();
      notificationWindow.webContents.send('show-notification', { title, body });
    }
  } catch (e) {}
});

// Not: tray-action-show / tray-action-quit dinleyicileri whenReady içinde
// kayıtlı (tray kurulumuyla birlikte); burada ikinci kez kaydedilmemeli.

// GÜVENLİK — Denetim kill-switch'i: denetim aktifken Ctrl+X'e kısa aralıkla İKİ KEZ
// basılırsa denetim anında kapatılır. globalShortcut şart, çünkü denetim sırasında
// pencere odakta olmayabilir (karşı taraf tüm masaüstünü yönetiyor). Kısayol yalnızca
// denetim süresince kayıtlıdır; bu sürede tek Ctrl+X (kes) sistem genelinde yutulur —
// güvenlik için bilinçli ödünleşim. Karşı tarafın robotjs ile bastırdığı Ctrl+X de
// OS seviyesinde aynı kısayolu tetikler; bu da güvenli yönde (oturum kapanır).
const CTRL_KILL_ACCEL = 'CommandOrControl+X';
const CTRL_KILL_WINDOW_MS = 1500;
let ctrlKillLastPress = 0;

function syncControlKillSwitch() {
  if (remoteControlActive) {
    if (globalShortcut.isRegistered(CTRL_KILL_ACCEL)) return;
    ctrlKillLastPress = 0;
    try {
      globalShortcut.register(CTRL_KILL_ACCEL, () => {
        const now = Date.now();
        if (now - ctrlKillLastPress <= CTRL_KILL_WINDOW_MS) {
          setRemoteControlEnabled(false);
          console.log('Uzaktan kontrol: Ctrl+X x2 kill-switch ile KAPATILDI');
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('remote-control-killed');
          }
        } else {
          ctrlKillLastPress = now;
        }
      });
    } catch (e) {
      console.error('Kill-switch kayıt hatası:', e);
    }
  } else {
    try { globalShortcut.unregister(CTRL_KILL_ACCEL); } catch (e) {}
  }
}

ipcMain.on('set-remote-control', (event, active) => {
  setRemoteControlEnabled(active);
  console.log('Uzaktan kontrol:', remoteControlActive ? 'AKTİF' : 'KAPALI');
});

ipcMain.on('update-control-pointer', (event, data) => {
  if (!remoteControlActive) return;
  const point = validNormalizedPoint(data);
  if (!point) return;
  remoteParticipantPoint = {
    point,
    label: String(data.label || 'Kontrol eden').slice(0, 40),
    avatar: safeCursorAvatar(data.avatar)
  };
  if (remoteControlOwner === 'host') renderCursorForOwner();
});

ipcMain.handle('set-control-owner', (event, requestedOwner) => {
  if (!remoteControlActive) return { owner: 'host', hostPoint: normalizePrimaryPoint() };
  if (requestedOwner === 'remote') {
    hostPassivePoint = normalizePrimaryPoint();
    remoteControlOwner = 'remote';
  } else {
    remoteControlOwner = 'host';
  }
  renderCursorForOwner();
  return { owner: remoteControlOwner, hostPoint: hostPassivePoint };
});

ipcMain.on('remote-input', (event, data) => {
  if (!remoteControlActive || remoteControlOwner !== 'remote') return;

  if (!robot) {
    // Fallback to Electron's native webContents.sendInputEvent if robotjs is missing
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (data.type === 'keydown' || data.type === 'keyup') {
        let keyCode = data.key;
        if (keyCode === 'Space') keyCode = 'Space';
        else if (keyCode === ' ') keyCode = 'Space';
        
        mainWindow.webContents.sendInputEvent({
          type: data.type === 'keydown' ? 'keyDown' : 'keyUp',
          keyCode: keyCode
        });
        
        if (data.type === 'keydown' && data.key.length === 1) {
          mainWindow.webContents.sendInputEvent({
            type: 'char',
            keyCode: data.key
          });
        }
      } else if (data.type === 'mousemove' || data.type === 'mousedown' || data.type === 'mouseup') {
        const bounds = mainWindow.getContentBounds();
        const x = Math.round(data.x * bounds.width);
        const y = Math.round(data.y * bounds.height);
        let evType = 'mouseMove';
        if (data.type === 'mousedown') evType = 'mouseDown';
        if (data.type === 'mouseup') evType = 'mouseUp';
        
        let button = 'left';
        if (data.button === 2) button = 'right';
        else if (data.button === 1) button = 'middle';
        
        mainWindow.webContents.sendInputEvent({
          type: evType,
          x: x,
          y: y,
          button: button,
          clickCount: 1
        });
      } else if (data.type === 'scroll') {
        mainWindow.webContents.sendInputEvent({
          type: 'mouseWheel',
          x: 0, y: 0,
          deltaX: data.deltaX || 0,
          deltaY: data.deltaY || 0
        });
      }
    }
    return;
  }

  const displayBounds = getControlBounds();
  const { width: sw, height: sh, x: displayX, y: displayY } = displayBounds;

  try {
    if (data.type === 'mousemove' || data.type === 'mousedown' || data.type === 'mouseup' || data.type === 'click') {
      const x = displayX + Math.max(0, Math.min(sw - 1, Math.round(data.x * sw)));
      const y = displayY + Math.max(0, Math.min(sh - 1, Math.round(data.y * sh)));
      remoteMoveGuard = { x: data.x, y: data.y, until: Date.now() + 90 };
      robot.moveMouse(x, y);

      if (data.type === 'mousedown') {
        remoteInjectionUntil = Date.now() + 180;
        robot.mouseToggle('down', mapButton(data.button));
      }
      else if (data.type === 'mouseup') robot.mouseToggle('up', mapButton(data.button));
      else if (data.type === 'click') {
        remoteInjectionUntil = Date.now() + 180;
        robot.mouseClick(mapButton(data.button));
      }
    } else if (data.type === 'keydown' || data.type === 'keyup') {
      const key = normalizeKey(data.key);
      if (key) {
        robot.keyToggle(key, data.type === 'keydown' ? 'down' : 'up');
      }
    } else if (data.type === 'scroll') {
      robot.scrollMouse(data.deltaX || 0, data.deltaY || 0);
    }
  } catch (e) {
    console.error('Input hatası:', e);
  }
});

function mapButton(b) {
  if (b === 2) return 'right';
  if (b === 1) return 'middle';
  return 'left';
}

function normalizeKey(key) {
  if (!key) return null;
  const map = {
    'Enter': 'enter', 'Backspace': 'backspace', 'Tab': 'tab',
    'Escape': 'escape', ' ': 'space', 'Space': 'space',
    'ArrowUp': 'up', 'ArrowDown': 'down', 'ArrowLeft': 'left', 'ArrowRight': 'right',
    'Shift': 'shift', 'Control': 'control', 'Alt': 'alt', 'Meta': 'command',
    'CapsLock': 'capslock'
  };
  return map[key] || (key.length === 1 ? key.toLowerCase() : key);
}

app.whenReady().then(() => {
  app.userAgentFallback = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const { session } = require('electron');
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['*://*.youtube.com/*', '*://*.ytimg.com/*'] },
    (details, callback) => {
      details.requestHeaders['Referer'] = 'https://www.youtube.com/';
      details.requestHeaders['Origin'] = 'https://www.youtube.com';
      callback({ requestHeaders: details.requestHeaders });
    }
  );

  // Reklam engelleme kuralı (Ortak Tarayıcı'da reklamları bloklamak için)
  try {
    const { ElectronBlocker } = require('@ghostery/adblocker-electron');
    const fetch = require('cross-fetch');
    ElectronBlocker.fromPrebuiltAdsAndTracking(fetch).then((blocker) => {
      // disable cosmetic filtering to avoid session.registerPreloadScript missing error
      if (blocker.config) {
        blocker.config.loadCosmeticFilters = false;
      } else {
        blocker.config = { loadCosmeticFilters: false, loadNetworkFilters: true };
      }
      blocker.enableBlockingInSession(session.defaultSession);
      // Ortak Tarayıcı webview'i AYRI bir oturumda yaşıyor (persist:teamsync-ai).
      // Engelleyici sadece defaultSession'a takılıydı; webview'deki YouTube
      // reklamları bu yüzden ağ seviyesinde HİÇ engellenmiyordu.
      try {
        blocker.enableBlockingInSession(session.fromPartition('persist:teamsync-ai'));
      } catch (e) {
        console.warn('Adblocker webview oturumuna takılamadı:', e.message);
      }
      console.log("Adblocker ağı seviyesinde başarıyla aktif edildi.");
    }).catch((err) => {
      console.error('Adblocker yüklenirken hata oluştu:', err);
    });
  } catch (e) {
    console.warn('Adblocker modülü yüklenemedi, atlanıyor:', e.message);
  }

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    let responseHeaders = { ...details.responseHeaders };
    
    // Ortak Tarayıcı (webview) için gömülmeyi engelleyen başlıkları kaldır
    const headersToRemove = [
      'x-frame-options',
      'X-Frame-Options',
      'content-security-policy',
      'Content-Security-Policy',
      'cross-origin-opener-policy',
      'Cross-Origin-Opener-Policy',
      'cross-origin-embedder-policy',
      'Cross-Origin-Embedder-Policy'
    ];
    
    headersToRemove.forEach(header => {
      if (responseHeaders[header]) {
        delete responseHeaders[header];
      }
    });
    
    callback({
      cancel: false,
      responseHeaders: responseHeaders
    });
  });

  // --- WEBRTC MEDYA VE EKRAN PAYLAŞIMI İZİNLERİ ---
  session.defaultSession.setPermissionCheckHandler(() => true);
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true); // Mikrofon ve Kamera izinlerini otomatik onayla
  });

  ipcMain.on('set-screen-share-source', (event, id) => {
    currentScreenShareSourceId = id;
  });

  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['window', 'screen'] }).then((sources) => {
      const selectedSource = sources.find(s => s.id === currentScreenShareSourceId) || sources[0];
      if (selectedSource) {
        if (selectedSource.id.startsWith('screen:')) {
          const selectedDisplay = screen.getAllDisplays().find(display => String(display.id) === String(selectedSource.display_id));
          sharedDisplayBounds = selectedDisplay ? selectedDisplay.bounds : screen.getPrimaryDisplay().bounds;
        } else {
          sharedDisplayBounds = screen.getPrimaryDisplay().bounds;
        }
        callback({ video: selectedSource, audio: 'loopback' });
      } else {
        callback();
      }
      currentScreenShareSourceId = null;
    }).catch(err => {
      console.error('Ekran kaynakları alınamadı:', err);
      callback();
    });
  });

  createWindow();
  setupAutoUpdater();

  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')).resize({ width: 32, height: 32 })); // Bayrak üretilene dek logo
  tray.setToolTip('TeamSync');

  // Custom CSS Tray Menu Window
  trayMenuWindow = new BrowserWindow({
    width: 220,
    height: 100,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'electron', 'preload-tray.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  trayMenuWindow.loadFile(path.join(__dirname, 'electron', 'tray-menu.html'));
  trayMenuWindow.on('blur', () => {
    trayMenuWindow.hide();
  });

  const showTrayMenu = () => {
    if (!tray || !trayMenuWindow) return;
    const bounds = tray.getBounds();
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    let x = bounds.x - 110 + (bounds.width / 2);
    let y = bounds.y - 110;
    
    // Boundary checks
    if (x < 0) x = 0;
    if (x + 220 > width) x = width - 220;
    if (y < 0) y = bounds.y + bounds.height + 10;
    
    trayMenuWindow.setBounds({ x: Math.round(x), y: Math.round(y), width: 220, height: 100 });
    trayMenuWindow.show();
    trayMenuWindow.focus();
  };

  tray.on('click', showTrayMenu);
  tray.on('right-click', showTrayMenu);

  // Not: sistem tepsisinde eskiden burada üretilen kırmızı-yeşil "Osmanlı
  // bayrağı" ikonu tray oluşturulduktan hemen sonra üzerine yazılıyordu —
  // küçük boyutta bulanık/dağınık görünüyordu ve diğer uygulama ikonlarının
  // yanında düzensiz duruyordu. Kaldırıldı; tray artık kalıcı olarak temiz
  // uygulama logosunu (assets/icon.png) kullanıyor.

  ipcMain.on('tray-action-show', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
    if (trayMenuWindow) trayMenuWindow.hide();
  });

  ipcMain.on('tray-action-quit', () => {
    forceQuit();
  });

  notificationWindow = new BrowserWindow({
    width: 350,
    height: 120,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'electron', 'preload-notification.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  // Calculate position: bottom right corner, slightly above taskbar
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  notificationWindow.setPosition(width - 360, height - 130);
  
  notificationWindow.loadFile(path.join(__dirname, 'electron', 'notification.html'));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Gerçek çıkış isteği (güncelleme kurulumu dahil) close→tray engeline takılmasın.
app.on('before-quit', () => { isQuitting = true; });

app.on('will-quit', () => {
  if (cloudflaredProcess) cloudflaredProcess.kill();
  stopLocalInputHook();
  if (cursorOverlayWindow && !cursorOverlayWindow.isDestroyed()) cursorOverlayWindow.destroy();
  globalShortcut.unregisterAll();
  if (discoveryInterval) clearInterval(discoveryInterval);
  if (discoverySocket) {
    try { discoverySocket.close(); } catch (e) {}
  }
  
  if (global.myAppLock) {
    try { fs.closeSync(global.myAppLock); } catch (e) {}
  }

  if (!isSecondInstance) {
    try {
      if (fs.existsSync(lockFile)) {
        fs.unlinkSync(lockFile);
      }
    } catch (e) {}
  } else {
    try {
      const tempPath = app.getPath('userData');
      fs.rmSync(tempPath, { recursive: true, force: true });
    } catch (e) {}
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
