const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  startCloudflared: (port) => ipcRenderer.invoke('start-cloudflared', port),
  stopCloudflared: () => ipcRenderer.send('stop-cloudflared'),
  getLocalIPs: () => ipcRenderer.invoke('get-local-ips'),
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
  getEnv: () => ({
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY
  }),
  windowMin: () => ipcRenderer.send('window-min'),
  windowMax: () => ipcRenderer.send('window-max'),
  windowClose: () => ipcRenderer.send('window-close'),
  appQuitForce: () => ipcRenderer.send('app-quit-force')
});

