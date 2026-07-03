const { contextBridge, ipcRenderer } = require('electron');

// Bayrak ikonu oluşturma penceresi için minimum API. Node.js erişimi yok.
contextBridge.exposeInMainWorld('flagAPI', {
  sendIcon: (dataUrl) => ipcRenderer.send('set-tray-icon', dataUrl)
});
