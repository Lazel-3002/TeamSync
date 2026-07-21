const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  startCloudflared: (port) => ipcRenderer.invoke('start-cloudflared', port),
  stopCloudflared: () => ipcRenderer.send('stop-cloudflared'),
  getLocalIPs: () => ipcRenderer.invoke('get-local-ips'),
  detectWarp: () => ipcRenderer.invoke('detect-warp'),
  startDiscovery: (peerId, name, room) => ipcRenderer.send('start-discovery', { peerId, name, room }),
  stopDiscovery: () => ipcRenderer.send('stop-discovery'),
  sendUDPSignal: (ip, signal) => ipcRenderer.send('send-udp-signal', { ip, signal }),
  onUDPSignal: (cb) => ipcRenderer.on('udp-signal', cb),
  directConnect: (ip) => ipcRenderer.send('direct-connect', ip),
  getSources: () => ipcRenderer.invoke('get-sources'),
  setScreenShareSource: (id) => ipcRenderer.send('set-screen-share-source', id),
  registerPTT: (key) => ipcRenderer.send('register-ptt', key),
  unregisterPTT: () => ipcRenderer.send('unregister-ptt'),
  onPTT: (cb) => ipcRenderer.on('ptt-trigger', cb),
  notify: (title, body) => ipcRenderer.send('notify', { title, body }),
  setRemoteControl: (active) => ipcRenderer.send('set-remote-control', active),
  sendRemoteInput: (data) => ipcRenderer.send('remote-input', data),
  onPeerDiscovered: (cb) => ipcRenderer.on('peer-discovered', cb),
  loadAccounts: () => ipcRenderer.invoke('load-accounts'),
  saveAccounts: (accounts) => ipcRenderer.invoke('save-accounts', accounts),
  isSecondInstance: () => ipcRenderer.invoke('is-second-instance'),
  getDeviceCredentials: (slot) => ipcRenderer.invoke('get-device-credentials', slot),
  getEnv: () => ({
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY
  }),
  windowMin: () => ipcRenderer.send('window-min'),
  windowMax: () => ipcRenderer.send('window-max'),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  windowClose: () => ipcRenderer.send('window-close'),
  onWindowVisibility: (cb) => ipcRenderer.on('window-visibility', (e, visible) => cb(visible)),
  appQuitForce: () => ipcRenderer.send('app-quit-force'),
  // Uygulama sürümü (package.json'dan). Başlangıç menüsünde gösterilir.
  getAppVersion: () => { try { return require('./package.json').version; } catch (e) { return null; } },
  // Donanım hızlandırma tercihi (buzlu cam / performans). Yeniden başlatınca etkin.
  getHardwareAcceleration: () => ipcRenderer.invoke('get-hardware-acceleration'),
  getEffectiveHardwareAcceleration: () => ipcRenderer.invoke('get-effective-hardware-acceleration'),
  setHardwareAcceleration: (enabled) => ipcRenderer.invoke('set-hardware-acceleration', enabled),
  // TEŞHİS: DIAG açık mı? ve canlı DOM'daki indirme butonlarını günlüğe gönder.
  diagEnabled: () => ipcRenderer.invoke('diag-enabled'),
  diagCapture: (info) => ipcRenderer.send('diag-capture', info)
});

