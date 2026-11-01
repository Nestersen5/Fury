'use strict';

// The supported custom-provider API pins the exact metadata already validated
// by Fury. No second mutable feed can choose another release or executable.
function createWindowsUpdater(metadata, { onProgress, onError, directory, log = () => {} }) {
    const { NsisUpdater, Provider } = require('electron-updater');
    const { releaseUrl } = require('./windowsUpdateMetadata');
    const file = Object.freeze({ url: releaseUrl(metadata.version, metadata.filename),
        size: metadata.bytes, sha512: metadata.sha512 });
    const info = Object.freeze({ version: metadata.version, files: [file], releaseDate: metadata.releasedAt });
    class FuryProvider extends Provider {
        constructor(options, updater, runtime) { super(runtime); }
        async getLatestVersion() { return info; }
        resolveFiles() { return [{ url: new URL(file.url), info: file }]; }
    }
    const updater = new NsisUpdater({ provider: 'custom', updateProvider: FuryProvider });
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.allowPrerelease = false;
    updater.disableWebInstaller = true;
    updater.disableDifferentialDownload = true;
    updater.installDirectory = directory;
    updater.logger = { info: () => {}, warn: () => {}, error: () => log('Windows update operation failed.') };
    updater.on('download-progress', onProgress);
    updater.on('error', onError);
    let token, cancelled = false;
    return {
        async download() {
            const result = await updater.checkForUpdates();
            if (!result?.isUpdateAvailable || result.updateInfo.version !== metadata.version) throw new Error('Update unavailable');
            token = result.cancellationToken;
            if (cancelled) { token.cancel(); throw new Error('Download cancelled'); }
            const files = await updater.downloadUpdate(token);
            return files[0];
        },
        cancel() { cancelled = true; token?.cancel(); },
        install() {
            process.env.FURY_UPDATE_PARENT_PID = String(process.pid);
            updater.quitAndInstall(true, true);
        },
        dispose() { token?.cancel(); updater.removeListener('download-progress', onProgress); updater.removeListener('error', onError); }
    };
}
module.exports = { createWindowsUpdater };
