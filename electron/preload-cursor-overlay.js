const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cursorOverlay', {
  onUpdate: (callback) => ipcRenderer.on('cursor-overlay-update', (_event, data) => callback(data))
});
