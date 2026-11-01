'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const axios = require('axios');
const { createInspector, readSavedKeys, safeError } = require('./service');
const { getDataDir } = require('../../src/storage/runtimePaths');

// This separate developer tool never opens the launcher's Chromium profile.
app.setPath('userData', path.join(os.tmpdir(), `fury-denick-inspector-${process.pid}`));
app.setName('Fury Denick Inspector');
let window, directory = getDataDir();
const fixture = process.argv.includes('--fixture');
const service = createInspector(fixture ? require('./fixture').options() : { axios, readKeys: () => readSavedKeys(directory) });
const page = pathToFileURL(path.join(__dirname, 'index.html')).href;

function authorized(event) {
    if (!window || event.sender !== window.webContents || event.senderFrame?.url !== page) throw new Error('Inspector window is unavailable.');
}
ipcMain.handle('denick-inspector:action', async (event, action, payload) => {
    authorized(event);
    try {
        if (action === 'folder') {
            const choice = await dialog.showOpenDialog(window, { title: 'Choose Fury data folder', properties: ['openDirectory'] });
            if (!choice.canceled) directory = choice.filePaths[0];
            const result = await service.dispatch('info');
            return { ok: true, data: { ...result, directory, fixture } };
        }
        if (action === 'export') {
            const json = JSON.stringify(payload, null, 2);
            if (json.length > 2 * 1024 * 1024) throw new Error('Report is too large to export.');
            const choice = await dialog.showSaveDialog(window, { title: 'Save inspector report', defaultPath: 'denick-inspection.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
            if (!choice.canceled) await fs.promises.writeFile(choice.filePath, json, 'utf8');
            return { ok: true, data: { saved: !choice.canceled } };
        }
        const data = await service.dispatch(action, payload);
        return { ok: true, data: { ...data, directory, fixture } };
    } catch (error) { return { ok: false, error: safeError(error), info: service.info() }; }
});

app.whenReady().then(() => {
    window = new BrowserWindow({ width: 1320, height: 900, minWidth: 850, minHeight: 650,
        title: 'Fury Denick Inspector', backgroundColor: '#101316', show: false,
        webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.once('ready-to-show', () => window.show());
    return window.loadURL(page);
}).catch(() => { console.error('Could not start the Denick Inspector.'); app.exit(1); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { void service.dispatch('cancel'); });
