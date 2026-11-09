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
        // R2 supports single byte ranges, not multipart range responses.
        get isUseMultipleRangeRequest() { return false; }
        getBlockMapFiles(baseUrl, oldVersion) {
            return [new URL(releaseUrl(oldVersion, `Fury-Setup-${oldVersion}-win-x64.exe.blockmap`)),
                new URL(releaseUrl(metadata.version, metadata.filename + '.blockmap'))];
        }
    }
    const updater = new NsisUpdater({ provider: 'custom', updateProvider: FuryProvider });
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.allowPrerelease = false;
    updater.disableWebInstaller = true;
    updater.disableDifferentialDownload = false;
    updater.installDirectory = directory;
    updater.logger = { info: () => {}, warn: () => {}, error: () => log('Windows update operation failed.') };
    let installError;
    const handleError = error => { installError = error; onError(error); };
    updater.on('download-progress', onProgress);
    updater.on('error', handleError);
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
            installError = null;
            process.env.FURY_UPDATE_PARENT_PID = String(process.pid);
            updater.quitAndInstall(true, true);
            if (installError) throw installError;
        },
        // Cancellation and installer spawning can emit an error after disposal.
        // Keep the instance-local error sink until that work is collected; an
        // unhandled EventEmitter error must not crash the closing launcher.
        dispose() { token?.cancel(); updater.removeListener('download-progress', onProgress); }
    };
}
module.exports = { createWindowsUpdater };
