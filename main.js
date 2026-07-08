const { app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut, Menu, Notification, screen, shell, Tray, nativeImage } = require('electron');
app.name = 'TeamSync';
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
app.commandLine.appendSwitch('allow-loopback-in-peer-connection');
const path = require('path');
const dgram = require('dgram');
const os = require('os');
const { spawn } = require('child_process');
let cloudflaredProcess = null;

const fs = require('fs');
const baseUserData = app.getPath('userData');
const lockFile = path.join(baseUserData, 'teamsync.lock');
let isSecondInstance = false;

// Load .env variables
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envFile = fs.readFileSync(envPath, 'utf8');
  envFile.split('\n').forEach(line => {
    const [key, ...rest] = line.split('=');
    const val = rest.join('=');
    if (key && val) process.env[key.trim()] = val.trim();
  });
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
let robot = null;

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
      autoplayPolicy: 'no-user-gesture-required'
    },
    backgroundColor: '#1e1f22',
    title: 'TeamSync - P2P',
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

  if (process.env.REACT_DEV === 'true') {
    mainWindow.loadURL('http://localhost:5173');
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile('index.html');
  }
  Menu.setApplicationMenu(null);

  if (!app.isPackaged) {
    try {
      require('./yapaydenetleyici.js')(mainWindow);
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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('get-local-ips', () => getLocalIPs());

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

ipcMain.handle('is-second-instance', () => {
  return isSecondInstance;
});

ipcMain.handle('start-cloudflared', async (event, port) => {
  return new Promise((resolve, reject) => {
    const exePath = path.join(app.getAppPath(), 'cloudflared.exe');
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
});
ipcMain.on('unregister-ptt', () => {
  globalShortcut.unregisterAll();
});

ipcMain.on('notify', (event, { title, body }) => {
  try {
    if (notificationWindow && !notificationWindow.isDestroyed()) {
      notificationWindow.showInactive();
      notificationWindow.webContents.send('show-notification', { title, body });
    }
  } catch (e) {}
});

ipcMain.on('tray-action-show', () => {
  if (mainWindow) {
    mainWindow.show();
    if (trayMenuWindow) trayMenuWindow.hide();
  }
});

ipcMain.on('tray-action-quit', () => {
  forceQuit();
});

ipcMain.on('set-remote-control', (event, active) => {
  remoteControlActive = !!active;
  console.log('鼠标 Uzaktan kontrol:', remoteControlActive ? 'AKTİF' : 'KAPALI');
});

ipcMain.on('remote-input', (event, data) => {
  if (!remoteControlActive) return;

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

  const display = screen.getPrimaryDisplay().size;
  const { width: sw, height: sh } = display;

  try {
    if (data.type === 'mousemove' || data.type === 'mousedown' || data.type === 'mouseup' || data.type === 'click') {
      const x = Math.max(0, Math.min(sw - 1, Math.round(data.x * sw)));
      const y = Math.max(0, Math.min(sh - 1, Math.round(data.y * sh)));
      robot.moveMouse(x, y);

      if (data.type === 'mousedown') robot.mouseToggle('down', mapButton(data.button));
      else if (data.type === 'mouseup') robot.mouseToggle('up', mapButton(data.button));
      else if (data.type === 'click') {
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
  session.defaultSession.webRequest.onBeforeRequest(
    {
      urls: [
        '*://*.doubleclick.net/*',
        '*://*.googlesyndication.com/*',
        '*://*.googleadservices.com/*',
        '*://*.googletagservices.com/*',
        '*://*.g.doubleclick.net/*',
        '*://*.pagead2.googlesyndication.com/*',
        '*://*.adsystem.com/*',
        '*://*.adservice.com/*',
        '*://*.analytics.google.com/*'
      ]
    },
    (details, callback) => {
      callback({ cancel: true });
    }
  );

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

  let currentScreenShareSourceId = null;
  ipcMain.on('set-screen-share-source', (event, id) => {
    currentScreenShareSourceId = id;
  });

  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['window', 'screen'] }).then((sources) => {
      const selectedSource = sources.find(s => s.id === currentScreenShareSourceId) || sources[0];
      if (selectedSource) {
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
  
  tray = new Tray(nativeImage.createEmpty()); // Placeholder until flag is generated
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
      preload: path.join(__dirname, 'preload-tray.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  trayMenuWindow.loadFile('tray-menu.html');
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

  // Generate High Quality Ottoman Flag Tray Icon using Canvas
  const flagWin = new BrowserWindow({ 
    width: 128, height: 128, show: false, 
    webPreferences: {
      preload: path.join(__dirname, 'preload-flag.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  
  const flagHtml = `
    <html><body>
      <canvas id="c" width="128" height="128"></canvas>
      <script>
        const canvas = document.getElementById('c');
        const ctx = canvas.getContext('2d');
        const svg = \`
          <svg width="128" height="128" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <mask id="cmask">
                <rect x="0" y="0" width="100" height="100" fill="white" />
                <circle cx="56" cy="50" r="11" fill="black" />
              </mask>
              <g id="hilal">
                <circle cx="50" cy="50" r="14" fill="#FFD700" mask="url(#cmask)" />
              </g>
            </defs>
            <rect width="100" height="100" rx="20" fill="#c8102e" />
            <circle cx="50" cy="50" r="42" fill="#006b3f" />
            <g filter="drop-shadow(0px 1px 2px rgba(0,0,0,0.4))">
              <g transform="translate(-14, 0)"><use href="#hilal" /></g>
              <g transform="translate(10, -18)"><use href="#hilal" /></g>
              <g transform="translate(10, 18)"><use href="#hilal" /></g>
            </g>
          </svg>\`;
        
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0);
          window.flagAPI.sendIcon(canvas.toDataURL('image/png'));
        };
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      </script>
    </body></html>
  `;
  flagWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(flagHtml));
  
  ipcMain.once('set-tray-icon', (event, dataUrl) => {
    if (tray) {
      tray.setImage(nativeImage.createFromDataURL(dataUrl).resize({width: 32, height: 32}));
    }
    flagWin.destroy();
  });
  
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
      preload: path.join(__dirname, 'preload-notification.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  // Calculate position: bottom right corner, slightly above taskbar
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  notificationWindow.setPosition(width - 360, height - 130);
  
  notificationWindow.loadFile('notification.html');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  if (cloudflaredProcess) cloudflaredProcess.kill();
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
