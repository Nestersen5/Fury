'use strict';
// Hidden, synthetic Chromium profile fixture. Never loads Fury's UI or services.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const [mode, sandbox, profile, html, result] = process.argv.slice(2);
for (const target of [profile, html, result]) {
    const relative = path.relative(sandbox, path.resolve(target));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Fixture path outside sandbox');
}
app.setName('Fury Synthetic Storage Verification');
// Exercise the maintenance profile followed by the final canonical profile.
app.setPath('userData', path.join(sandbox, 'maintenance-profile'));
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } });
    await window.loadFile(html);
    if (mode === 'write') {
        await window.webContents.executeJavaScript("localStorage.setItem('synthetic-theme','graphite');localStorage.setItem('synthetic-sidebar','collapsed');");
        await window.webContents.session.cookies.set({ url: 'https://fury-fixture.invalid', name: 'synthetic-cookie',
            value: 'synthetic-only', expirationDate: Math.floor(Date.now() / 1000) + 3600 });
    }
    const state = await window.webContents.executeJavaScript("({theme:localStorage.getItem('synthetic-theme'),sidebar:localStorage.getItem('synthetic-sidebar')})");
    const cookies = await window.webContents.session.cookies.get({ url: 'https://fury-fixture.invalid' });
    window.webContents.session.flushStorageData();
    await window.webContents.session.cookies.flushStore();
    fs.writeFileSync(result, JSON.stringify({ state, cookiePreserved: cookies.some(cookie => cookie.name === 'synthetic-cookie' && cookie.value === 'synthetic-only'),
        userDataMatches: app.getPath('userData') === profile, sessionDataMatches: app.getPath('sessionData') === profile, electron: process.versions.electron }));
    app.quit();
}).catch(() => { process.stderr.write('SYNTHETIC_ELECTRON_FIXTURE_FAILED'); app.exit(1); });
