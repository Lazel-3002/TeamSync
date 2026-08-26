const { contextBridge, ipcRenderer } = require('electron');

// Tepsi menüsünün ihtiyaç duyduğu minimum API. Node.js erişimi yok.
contextBridge.exposeInMainWorld('trayAPI', {
  showApp: () => ipcRenderer.send('tray-action-show'),
  quitApp: () => ipcRenderer.send('tray-action-quit'),
  getStrings: () => ipcRenderer.invoke('tray-get-strings'),
  onSetStrings: (callback) => ipcRenderer.on('tray-set-strings', (event, strings) => callback(strings))
});
