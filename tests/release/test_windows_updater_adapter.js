'use strict';
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), vm = require('vm');
const { EventEmitter } = require('events');
const { test } = require('node:test');
const metadata = { version: '2.0.0', filename: 'Fury-Setup-2.0.0-win-x64.exe', bytes: 100, sha512: 'fixture', releasedAt: '2026-11-01T12:00:00Z' };
function fixture() {
    let updater, failInstall = false, progress = 0, errors = 0;
    class Provider { constructor(runtime) { this.runtime = runtime; } }
    class NsisUpdater extends EventEmitter {
        constructor(options) { super(); updater = this; this.provider = new options.updateProvider(null, this, {}); }
        async checkForUpdates() { return { isUpdateAvailable: true, updateInfo: { version: metadata.version }, cancellationToken: { cancel() {} } }; }
        async downloadUpdate() { this.emit('download-progress', { percent: 50 }); return ['/isolated/setup.exe']; }
        quitAndInstall(silent, run) { assert(silent && run); if (failInstall) this.emit('error', Object.assign(Error('failed'), { code: 'ENOENT' })); }
    }
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../src/updates/windowsUpdaterAdapter.js'), 'utf8'), {
        module, process: { env: {}, pid: 123 }, URL,
        require: name => name === 'electron-updater' ? { Provider, NsisUpdater } : require('../../src/updates/windowsUpdateMetadata')
    });
    const adapter = module.exports.createWindowsUpdater(metadata, { directory: 'C:\\Fury', onProgress: () => progress++, onError: () => errors++ });
    return { adapter, get updater() { return updater; }, failInstall: () => { failInstall = true; }, progress: () => progress, errors: () => errors };
}
test('differential maps stay on the pinned per-version origin and use single ranges', async () => {
    const f = fixture(), u = f.updater;
    assert.equal(u.autoDownload, false); assert.equal(u.autoInstallOnAppQuit, false);
    assert.equal(u.disableWebInstaller, true); assert.equal(u.disableDifferentialDownload, false);
    assert.equal(u.provider.isUseMultipleRangeRequest, false);
    const maps = u.provider.getBlockMapFiles(new URL('https://untrusted.invalid/ignored.exe'), '1.1.4');
    assert.equal(maps[0].href, 'https://downloads.furyproxy.online/releases/1.1.4/Fury-Setup-1.1.4-win-x64.exe.blockmap');
    assert.equal(maps[1].href, 'https://downloads.furyproxy.online/releases/2.0.0/Fury-Setup-2.0.0-win-x64.exe.blockmap');
    assert.throws(() => u.provider.getBlockMapFiles(null, '../unsafe'));
    assert.equal(await f.adapter.download(), '/isolated/setup.exe'); assert.equal(f.progress(), 1);
    f.adapter.dispose(); assert.equal(u.listenerCount('download-progress'), 0);
});
test('synchronous installer errors are surfaced instead of discarded', async () => {
    const f = fixture(); await f.adapter.download(); f.failInstall();
    assert.throws(() => f.adapter.install(), /failed/); assert.equal(f.errors(), 1);
});
test('a late installer error after shutdown disposal does not become an unhandled error', async () => {
    const f = fixture(); await f.adapter.download(); f.adapter.install(); f.adapter.dispose();
    assert.doesNotThrow(() => f.updater.emit('error', Object.assign(Error('spawn refused'), { code: 'EACCES' })));
    assert.equal(f.errors(), 1);
});
