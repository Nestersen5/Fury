'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('inspector', {
    action: (action, payload = {}) => ipcRenderer.invoke('denick-inspector:action', action, payload)
});
