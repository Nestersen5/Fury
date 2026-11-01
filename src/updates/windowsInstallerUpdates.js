'use strict';
const fs = require('fs');
const crypto = require('crypto');
const { readManifest, validateManifest, compareVersions } = require('./updateNotifications');
const { validateWindowsUpdate, releaseUrl } = require('./windowsUpdateMetadata');
const config = require('./releaseConfig');

async function verifyInstaller(file, metadata) {
    const before = await fs.promises.lstat(file);
    if (!before.isFile() || before.isSymbolicLink() || before.size !== metadata.bytes) throw new Error('Invalid cached installer');
    const hash = crypto.createHash('sha512'); let bytes = 0;
    for await (const chunk of fs.createReadStream(file)) {
        bytes += chunk.length;
        if (bytes > metadata.bytes) throw new Error('Installer size changed');
        hash.update(chunk);
    }
    const after = await fs.promises.lstat(file);
    if (bytes !== metadata.bytes || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino
        || !after.isFile() || hash.digest('base64') !== metadata.sha512) throw new Error('Installer verification failed');
}
function createInstallerUpdates({ installedVersion, getAvailable, detectInstallation, onChange = () => {},
    requestInstall, canInstall = async () => true, read = readManifest, createUpdater = (...args) => require('./windowsUpdaterAdapter').createWindowsUpdater(...args),
    verify = verifyInstaller, log = () => {} }) {
    let state = { supported: false, status: 'idle', installedVersion, revision: 0 }, initialization, metadata, installation, adapter;
    let stopped = false, operation, generation = 0, downloaded, installOperation;
    const controller = new AbortController();
    const snapshot = () => ({ ...state });
    function update(patch) {
        if (stopped) return;
        state = { ...state, ...patch, revision: state.revision + 1 };
        onChange(snapshot());
    }
    async function initialize() {
        return initialization ||= (async () => {
            installation = await detectInstallation();
            if (stopped || !installation) return;
            update({ supported: true });
            const offer = await getAvailable();
            if (stopped || !offer || compareVersions(offer.version, installedVersion) <= 0) return;
            update({ version: offer.version, status: 'loading' });
            try {
                metadata = validateWindowsUpdate(await read(new URL(releaseUrl(offer.version)), { signal: controller.signal }), offer.version);
                if (stopped) return;
                update({ status: 'available', bytes: metadata.bytes, releasedAt: metadata.releasedAt });
            } catch {
                update({ status: 'unavailable', message: 'Download this release from the Fury website.' });
            }
        })();
    }
    async function download() {
        await initialize();
        if (stopped || !metadata || ['ready', 'installing'].includes(state.status)) return snapshot();
        if (operation) { await operation; return state.status === 'available' ? download() : snapshot(); }
        const id = ++generation;
        update({ status: 'downloading', percent: 0, transferred: 0, message: '' });
        operation = (async () => {
            try {
                adapter?.dispose();
                adapter = createUpdater(metadata, { directory: installation.directory, log,
                    onError: () => {}, // The awaited download reports one controlled error.
                    onProgress(progress) {
                        if (stopped || id !== generation || state.status !== 'downloading') return;
                        const percent = Math.min(99, Math.max(0, Math.floor(Number(progress.percent) || 0)));
                        if (percent !== state.percent) update({ percent, transferred: Math.min(metadata.bytes, Math.max(0, Math.floor(Number(progress.transferred) || 0))) });
                    } });
                const file = await adapter.download();
                if (stopped || id !== generation) return snapshot();
                await verify(file, metadata);
                if (stopped || id !== generation) return snapshot();
                downloaded = file;
                update({ status: 'ready', percent: 100, transferred: metadata.bytes });
            } catch {
                if (!stopped && id === generation) update({ status: 'error', message: 'Could not download the update. Please try again.' });
            } finally { operation = null; }
            return snapshot();
        })();
        return operation;
    }
    function cancel() {
        if (state.status !== 'downloading') return snapshot();
        generation++; adapter?.cancel();
        update({ status: 'available', percent: 0, transferred: 0, message: '' });
        return snapshot();
    }
    async function install() {
        if (installOperation) return installOperation;
        if (stopped || state.status !== 'ready' || !downloaded) return false;
        installOperation = (async () => {
            try {
                update({ status: 'installing', message: 'Saving your data and closing Fury…' });
                if (!await canInstall()) {
                    update({ status: 'ready', message: 'Close any other Fury windows before updating, then try again.' });
                    return false;
                }
                const [currentInstallation, manifest] = await Promise.all([detectInstallation(),
                    read(new URL(config.manifestUrl), { signal: controller.signal, cache: false })]);
                if (!currentInstallation || currentInstallation.directory.toLowerCase() !== installation.directory.toLowerCase()
                    || validateManifest(manifest).version !== metadata.version) {
                    update({ status: 'unavailable', message: 'This update is no longer available. Download the latest version from the Fury website.' });
                    return false;
                }
                try { await verify(downloaded, metadata); }
                catch {
                    downloaded = null;
                    update({ status: 'error', percent: 0, transferred: 0, message: 'The downloaded update could not be verified. Download it again.' });
                    return false;
                }
                if (stopped) return false;
                // requestInstall invokes the handoff ONLY in the clean terminal
                // branch of Fury's existing shutdown owner, while its lock is held.
                await requestInstall(() => adapter.install());
                return true;
            } catch {
                update({ status: 'ready', message: 'Could not start the update. Check your connection and try again.' });
                return false;
            } finally { installOperation = null; }
        })();
        return installOperation;
    }
    return {
        async getState() { await initialize(); return snapshot(); }, download, cancel, install,
        dispose() { stopped = true; generation++; controller.abort(); adapter?.dispose(); }
    };
}
module.exports = { createInstallerUpdates, verifyInstaller };
