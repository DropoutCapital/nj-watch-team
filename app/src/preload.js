const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('watch', {
  getState: () => ipcRenderer.invoke('getState'),
  toggle: () => ipcRenderer.invoke('toggle'),
  saveProfile: (p) => ipcRenderer.invoke('saveProfile', p),
  aceptarConsent: (p) => ipcRenderer.invoke('aceptarConsent', p),
  rechazarConsent: () => ipcRenderer.invoke('rechazarConsent'),
  setSetting: (p) => ipcRenderer.invoke('setSetting', p),
  onEstado: (cb) => ipcRenderer.on('estado', (_e, s) => cb(s))
})
