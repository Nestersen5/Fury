'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { needsMaintenance, checked } = require('./windowsMigration');
// electron-builder 26: UUID.v5(com.fury.proxy, 50e065bc-3134-11e6-9bab-38c9862bdaf3).
// The build test checks this against the current appId and locked builder.
const INSTALL_GUID = '83c18ff3-c735-53cd-906d-72fdc8bf6063';

function run({ app, dialog, projectRoot, argv = process.argv }) {
    if (process.platform !== 'win32' || !app.isPackaged) return true;
    const installer = argv.includes('--fury-preserve-storage');
    // Explicit user overrides retain their existing semantics. The installer
    // always protects the legacy default, independently of its own environment.
    const override = String(process.env.FURY_DATA_DIR || '').trim();
    // An override equal to the canonical location must still honor an
    // installer-supplied pending transaction or active maintenance lease.
    if (!installer && override && (!path.isAbsolute(override) ||
        path.normalize(override).toLowerCase() !== path.join(app.getPath('appData'), 'Fury').toLowerCase())) return true;
    const appData = app.getPath('appData');
    const control = path.join(appData, '.Fury-migration-v1');
    let temporary;
    const statusArgument = argv.find(value => value.startsWith('--fury-preservation-result='));
    function installerFailure(code) {
        // A fixed status code only; no error messages, store paths or contents.
        if (installer && statusArgument) {
            const file = statusArgument.slice('--fury-preservation-result='.length);
            const relative = path.relative(os.tmpdir(), file);
            if (relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(file) === 'fury-storage-result.txt') {
                fs.writeFileSync(checked(file), code, { mode: 0o600 });
            }
        }
    }
    try {
        if (!installer && !needsMaintenance(control)) return true;
        checked(appData);
        temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-storage-maintenance-'));
        // A maintenance-only Electron process must not create Chromium files in
        // an otherwise empty canonical profile before the migration decision.
        app.setPath('userData', path.join(temporary, 'launcher_data'));
        const requestFile = path.join(temporary, 'request.json');
        const newInstallationArgument = argv.find(value => value.startsWith('--fury-next-install='));
        const newInstallation = newInstallationArgument?.slice('--fury-next-install='.length);
        const installerPid = Number(argv.find(value => value.startsWith('--fury-installer-pid='))?.slice('--fury-installer-pid='.length)) || 0;
        const options = {
            destination: path.join(appData, 'Fury'), control,
            installations: installer ? (newInstallation ? [newInstallation] : []) : [path.resolve(projectRoot, '..', '..')],
            ...(newInstallation ? { newInstallation } : {})
        };
        fs.writeFileSync(requestFile, JSON.stringify({
            schema: 1, installer, installerPid, launcherPid: process.pid, appData,
            executable: process.execPath, worker: path.join(__dirname, 'windowsMigrationWorker.js'),
            discoverRegistry: true,
            installKey: 'Software\\' + INSTALL_GUID,
            uninstallKey: 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\' + INSTALL_GUID,
            options, planFile: path.join(temporary, 'plan.json'),
            preservedFile: path.join(temporary, 'preserved.json'), resultFile: path.join(temporary, 'result.json')
        }), { mode: 0o600 });
        // SystemRoot comes from Windows, not an installer-created variable. No
        // shell interpolation and no PowerShell profile scripts are involved.
        const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        const result = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', path.join(__dirname, 'windowsMigrationGuard.ps1'), '-RequestFile', requestFile],
        { windowsHide: true, encoding: 'utf8', timeout: 31 * 60 * 1000 });
        if (result.error || result.status !== 0) {
            const code = /^[A-Z_]{3,50}$/.test(result.stderr || '') ? result.stderr : 'MIGRATION_ACCESS_OR_SAFETY_FAILURE';
            installerFailure(code);
            if (!installer) dialog.showErrorBox('Fury data preservation could not finish',
                `Fury has not opened your profile. Close all Fury launchers and proxy processes, check free space and folder permissions, and try again as the Windows user who owns the old profile.\n\nSafety check: ${code}\n\nDo not uninstall the previous Fury installation to work around this error.`);
            if (installer) app.exit(70);
            else app.exit(1);
            return false;
        }
        if (installer) { app.exit(0); return false; }
        return true;
    } catch {
        try { installerFailure('MIGRATION_ACCESS_OR_SAFETY_FAILURE'); } catch { /* installer has its own failure message */ }
        if (!installer) dialog.showErrorBox('Fury data location is unavailable',
            'Fury could not safely prepare your Windows user-data directory. Check its permissions and free space. Your previous installation must be kept until preservation succeeds.');
        app.exit(70);
        return false;
    } finally {
        if (temporary) {
            // Only request/manifest metadata generated by this invocation. Never
            // delete snapshots or data roots, including on a failed migration.
            try { fs.rmSync(temporary, { recursive: true, force: true }); } catch { /* safe to leave metadata */ }
        }
    }
}
module.exports = { run, INSTALL_GUID };
