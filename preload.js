const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qqShot', {
  getStatus: () => ipcRenderer.invoke('status:get'),
  startCapture: () => ipcRenderer.invoke('control:start-capture'),
  openScreenSettings: () => ipcRenderer.invoke('control:open-screen-settings'),
  reportOverlayMetrics: (payload) => ipcRenderer.send('capture:overlay-metrics', payload),
  overlayReady: (sessionId) => ipcRenderer.invoke('capture:overlay-ready', { sessionId }),
  cancelCapture: (sessionId) => ipcRenderer.invoke('capture:cancel', { sessionId }),
  copyCapture: (sessionId, selection) => ipcRenderer.invoke('capture:copy', { sessionId, selection }),
  saveCapture: (sessionId, selection) => ipcRenderer.invoke('capture:save', { sessionId, selection }),
  copyRenderedCapture: (sessionId, dataUrl) =>
    ipcRenderer.invoke('capture:copy-rendered', { sessionId, dataUrl }),
  saveRenderedCapture: (sessionId, dataUrl) =>
    ipcRenderer.invoke('capture:save-rendered', { sessionId, dataUrl }),
  onStatusChanged: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('status-changed', handler);
    return () => ipcRenderer.removeListener('status-changed', handler);
  },
  onCaptureData: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('capture-data', handler);
    return () => ipcRenderer.removeListener('capture-data', handler);
  },
});
