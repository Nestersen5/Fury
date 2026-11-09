'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { createInstallerUpdates, verifyInstaller } = require('../../src/updates/windowsInstallerUpdates');
const { validateWindowsUpdate, releaseUrl } = require('../../src/updates/windowsUpdateMetadata');
const { detectWindowsInstallation, canInstallWithCurrentProcesses } = require('../../src/updates/windowsInstallation');
const config = require('../../src/updates/releaseConfig');
const version = '2.0.0', bytes = Buffer.from('synthetic installer');
const metadata = { schemaVersion: 1, version, filename: `Fury-Setup-${version}-win-x64.exe`, bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'), sha512: crypto.createHash('sha512').update(bytes).digest('base64'), releasedAt: '2026-11-01T12:00:00Z' };
const manifest = { schemaVersion: 1, latestVersion: version, releasePageUrl: config.downloadPageUrl };
const installation = { directory: 'C:\\Fury installed' };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture(extra = {}) {
    const changes = [], calls = { reads: [], created: 0, downloads: 0, installs: 0, cancels: 0 };
    let progress;
    const service = createInstallerUpdates({ installedVersion: '1.1.3', getAvailable: async () => ({ version }),
        detectInstallation: async () => installation,
        read: async url => { calls.reads.push(url.href); return url.href === config.manifestUrl ? manifest : metadata; },
        onChange: state => changes.push(state), requestInstall: async handoff => { calls.installs++; handoff(); },
        verify: async () => {},
        createUpdater: (data, options) => {
            calls.created++; progress = options.onProgress;
            return { download: async () => { calls.downloads++; return '/fixture.exe'; }, cancel: () => calls.cancels++, install: () => {}, dispose: () => {} };
        }, ...extra });
    return { service, calls, changes, progress: value => progress(value) };
}
test('metadata pins stable version, installer name, size, hashes, date and fixed origin', () => {
    assert.equal(validateWindowsUpdate(metadata, version).filename, metadata.filename);
    for (const patch of [{ schemaVersion: 2 }, { version: '9.9.9' }, { filename: '../bad.exe' }, { bytes: -1 }, { bytes: 3 * 1024 ** 3 },
        { sha256: 'bad' }, { sha512: 'bad' }, { releasedAt: 'invalid' }, { url: 'https://evil.invalid/update.exe' }]) {
        assert.throws(() => validateWindowsUpdate({ ...metadata, ...patch }, version));
    }
    assert.throws(() => releaseUrl('1.0.0-beta.1'));
    assert.equal(releaseUrl(version), `${config.downloadOrigin}/releases/${version}/windows-update.json`);
});
test('only the real registered Windows x64 installation is eligible', async () => {
    let queries = 0;
    const options = { isPackaged: true, platform: 'win32', arch: 'x64', executable: 'C:\\Installed\\Fury.exe',
        registry: async () => { queries++; return 'C:\\Installed'; }, realpath: async value => value };
    assert.deepEqual(await detectWindowsInstallation(options), { directory: 'C:\\Installed' });
    assert.equal(await detectWindowsInstallation({ ...options, executable: 'C:\\Portable\\Fury.exe' }), null);
    assert.equal(await detectWindowsInstallation({ ...options, registry: async () => { throw Error(); } }), null);
    assert.equal(await detectWindowsInstallation({ ...options, registry: async () => 'relative' }), null);
    assert.equal(await detectWindowsInstallation({ ...options, dataDirectory: 'C:\\Installed\\Custom Data' }), null);
    assert.equal(await detectWindowsInstallation({ ...options, dataDirectory: 'C:\\Installed' }), null);
    assert(await detectWindowsInstallation({ ...options, dataDirectory: 'C:\\User Data\\Fury' }));
    queries = 0;
    for (const patch of [{ isPackaged: false }, { platform: 'darwin' }, { arch: 'arm64' }]) assert.equal(await detectWindowsInstallation({ ...options, ...patch }), null);
    assert.equal(queries, 0);
});
test('startup checks once and never downloads; unsupported copies do not fetch installer metadata', async () => {
    const f = fixture();
    const [a, b] = await Promise.all([f.service.getState(), f.service.getState()]);
    assert.equal(a.status, 'available'); assert.deepEqual(a, b); assert.equal(f.calls.reads.length, 1); assert.equal(f.calls.created, 0);
    const unsupported = fixture({ detectInstallation: async () => null });
    assert.equal((await unsupported.service.getState()).supported, false);
    await unsupported.service.download(); assert.equal(unsupported.calls.reads.length, 0); assert.equal(unsupported.calls.created, 0);
});
test('other Fury instances and unverifiable process checks prevent shutdown without stopping them', async () => {
    for (const [error, output, expected] of [[null, 'clear', true], [null, 'blocked', false], [Error('denied'), '', false]]) {
        assert.equal(await canInstallWithCurrentProcesses({ execute: (file, args, options, done) => {
            assert(options.windowsHide); assert(!args.join(' ').includes('Stop-Process')); done(error, output);
        } }), expected);
    }
    const f = fixture({ canInstall: async () => false }); await f.service.download();
    assert.equal(await f.service.install(), false); assert.equal(f.calls.installs, 0);
    assert((await f.service.getState()).message.includes('other Fury windows'));
});
test('missing or invalid metadata retains the manual-download fallback', async () => {
    for (const read of [async () => { throw Error(); }, async () => ({ ...metadata, filename: 'bad.exe' })]) {
        const f = fixture({ read }); assert.equal((await f.service.getState()).status, 'unavailable');
        await f.service.download(); assert.equal(f.calls.created, 0);
    }
});
test('double clicks share a download; progress is compact and cached installer is verified', async () => {
    const done = deferred(); let downloads = 0, progress, checks = 0;
    const f = fixture({ verify: async () => checks++, createUpdater: (data, options) => {
        progress = options.onProgress;
        return { download: async () => { downloads++; return done.promise; }, dispose() {}, cancel() {}, install() {} };
    } });
    await f.service.getState();
    const a = f.service.download(), b = f.service.download();
    await new Promise(resolve => setImmediate(resolve));
    progress({ percent: 42.8, transferred: 8 }); progress({ percent: 42.9, transferred: 9 });
    assert.equal(f.changes.filter(s => s.percent === 42).length, 1);
    done.resolve('/fixture.exe'); await Promise.all([a, b]);
    assert.equal(downloads, 1); assert.equal(checks, 1); assert.equal((await f.service.getState()).status, 'ready');
    assert.equal(f.calls.installs, 0);
});
test('cancelled and disposed work cannot publish ready or install', async () => {
    for (const dispose of [false, true]) {
        const done = deferred(); let cancels = 0, checks = 0;
        const f = fixture({ verify: async () => checks++, createUpdater: () => ({ download: () => done.promise, cancel: () => cancels++, dispose() {} }) });
        const pending = f.service.download(); await new Promise(resolve => setImmediate(resolve));
        dispose ? f.service.dispose() : f.service.cancel();
        done.resolve('/fixture.exe'); await pending;
        assert(!f.changes.some(s => s.status === 'ready')); assert.equal(await f.service.install(), false);
        assert.equal(checks, 0, 'Stale downloads do not start file verification');
        if (!dispose) assert.equal(cancels, 1);
    }
});

test('an installer changed after downloading offers a fresh download before any shutdown', async () => {
    let checks = 0;
    const f = fixture({ verify: async () => { if (++checks === 2) throw Error('changed installer'); } });
    await f.service.download();
    assert.equal(await f.service.install(), false); assert.equal(f.calls.installs, 0);
    assert.equal((await f.service.getState()).status, 'error');
    assert.equal((await f.service.download()).status, 'ready');
    assert.equal(f.calls.downloads, 2);
});
test('failed download and checksum failure can retry without touching installed data', async () => {
    let attempt = 0;
    const f = fixture({ verify: async () => { if (++attempt === 1) throw Error('checksum'); } });
    assert.equal((await f.service.download()).status, 'error');
    assert.equal((await f.service.download()).status, 'ready'); assert.equal(f.calls.downloads, 2);
});
test('install rechecks the offer, installation identity and bytes before clean shutdown handoff', async () => {
    let verified = 0;
    const f = fixture({ verify: async () => verified++ });
    assert.equal(await f.service.install(), false); await f.service.download();
    assert.equal(await f.service.install(), true); assert.equal(f.calls.installs, 1); assert.equal(verified, 2);
    assert.equal(f.calls.reads.at(-1), config.manifestUrl);
    for (const patch of [
        { read: async url => url.href === config.manifestUrl ? { ...manifest, latestVersion: '1.1.3' } : metadata },
        { detectInstallation: (() => { let count = 0; return async () => ++count === 1 ? installation : null; })() },
        { requestInstall: async () => { throw Error('unclean shutdown'); } }
    ]) {
        const blocked = fixture(patch); await blocked.service.download();
        assert.equal(await blocked.service.install(), false);
        assert(['ready', 'unavailable'].includes((await blocked.service.getState()).status));
    }
});
test('real cached file verification rejects changed and truncated installers', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-updater-hash-'));
    try {
        const file = path.join(directory, 'setup.exe'); fs.writeFileSync(file, bytes); await verifyInstaller(file, metadata);
        fs.writeFileSync(file, Buffer.alloc(bytes.length)); await assert.rejects(verifyInstaller(file, metadata));
        fs.writeFileSync(file, 'short'); await assert.rejects(verifyInstaller(file, metadata));
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('installer handoff is not reported as successful when shutdown never invokes it', async () => {
    const f = fixture({ requestInstall: async () => ({ clean: false, outcome: 'FORCED' }) });
    await f.service.download();
    assert.equal(await f.service.install(), false);
    assert.equal((await f.service.getState()).status, 'ready');
});

test('update intent is durable before handoff and detects a version that did not change', async () => {
    const { createUpdateAttempt } = require('../../src/updates/windowsUpdateAttempt');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-update-attempt-'));
    try {
        const file = path.join(directory, 'attempt.json'), attempt = createUpdateAttempt(file);
        assert.equal(await attempt.pending('1.1.3'), false);
        const f = fixture({ attempt, requestInstall: async handoff => {
            assert.equal(await attempt.pending('1.1.3'), true); handoff();
        } });
        await f.service.download(); assert.equal(await f.service.install(), true);
        const retry = fixture({ attempt });
        assert((await retry.service.getState()).message.includes('previous update did not finish'));
        assert.equal(await attempt.pending(version), false); assert(!fs.existsSync(file));
        await attempt.begin('1.1.3', version);
        assert.equal(await attempt.pending('3.0.0'), false);
        fs.writeFileSync(file, '{broken'); assert.equal(await attempt.pending(version), false);
        await assert.rejects(attempt.begin(version, '1.1.3'));
        const blocked = fixture({ attempt, requestInstall: async () => ({ clean: false }) });
        await blocked.service.download(); assert.equal(await blocked.service.install(), false);
        assert(!fs.existsSync(file), 'A handoff that never ran leaves no pending intent');
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
