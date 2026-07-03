const { contextBridge, ipcRenderer } = require('electron');

// Sadece bildirim penceresinin ihtiyaç duyduğu minimum API'yi expose ediyoruz.
// Node.js'e (fs, require, process vb.) doğrudan erişim YOK.
contextBridge.exposeInMainWorld('notifyAPI', {
  onShowNotification: (callback) => {
    ipcRenderer.on('show-notification', (event, payload) => callback(payload));
  }
});
