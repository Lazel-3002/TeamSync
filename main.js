const { app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut, Menu, Notification, screen, shell } = require('electron');
app.name = 'TeamSync';
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
app.commandLine.appendSwitch('allow-loopback-in-peer-connection');
const path = require('path');
const dgram = require('dgram');
const os = require('os');
const { spawn } = require('child_process');
let cloudflaredProcess = null;

let mainWindow = null;
let discoverySocket = null;
let discoveryInterval = null;
let myPeerId = null;
let currentRoom = '';
let currentName = '';
let remoteControlActive = false;
let robot = null;

const DISCOVERY_PORT = 41234;

try {
  robot = require('robotjs');
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
      webviewTag: true
    },
    backgroundColor: '#1e1f22',
    title: 'TeamSync - P2P',
    autoHideMenuBar: true,
    webSecurity: true
  });
  
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer ${level}] ${message} (${line})`);
  });

  mainWindow.loadFile('index.html');
  Menu.setApplicationMenu(null);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('get-local-ips', () => getLocalIPs());

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
    new Notification({ title, body, silent: true }).show();
  } catch (e) {}
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

  createWindow();
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
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

