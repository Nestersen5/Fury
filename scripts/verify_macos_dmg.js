'use strict';
const assert = require('assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { command, verifyMacArchitecture } = require('./verify_release_pair');
const { releaseMatrix, payloadInventory, assertPayloadParity, verifyApplication } = require('./release_artifacts');

async function main(directory, arch, zipApp) {
    assert.equal(process.platform, 'darwin', 'DMG runtime verification needs macOS');
    assert.equal(process.arch, arch, 'Native runtime architecture required; cross-build/Rosetta inspection is not native acceptance');
    const version = require('../package.json').version;
    const dmg = releaseMatrix(version).find(item => item.os === 'mac' && item.architecture === arch && item.distribution === 'dmg');
    assert(dmg, 'Expected x64 or arm64');
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-dmg-runtime-'));
    const mount = path.join(fixture, 'Mounted DMG'), app = path.join(fixture, 'Applications With Spaces', 'Fury.app');
    let mounted = false;
    try {
        fs.mkdirSync(mount); fs.mkdirSync(path.dirname(app));
        command('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, path.join(directory, dmg.filename)]); mounted = true;
        const mountedApp = path.join(mount, 'Fury.app');
        const original = await payloadInventory(mountedApp);
        command('/usr/bin/ditto', [mountedApp, app]);
        assertPayloadParity(original, await payloadInventory(app));
        verifyMacArchitecture(app, arch);
        await verifyApplication(path.resolve(__dirname, '..'), app, 'mac', arch);
        command('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
        // A copied DMG application must run independently of the mounted image.
        command('/usr/bin/hdiutil', ['detach', mount]); mounted = false;
        command(process.execPath, [path.join(__dirname, 'verify_packaged_runtime.js'), app,
            path.join(directory, `DMG-RUNTIME-${arch}.json`)], { timeout: 360000, stdio: 'inherit' });
        if (zipApp) command(process.execPath, [path.join(__dirname, 'verify_macos_desktop.js'),
            path.resolve(zipApp), app, path.join(directory, `DESKTOP-${arch}.json`)],
            { timeout: 330000, stdio: 'inherit' });
        assertPayloadParity(original, await payloadInventory(app));
        command('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
    } finally {
        if (mounted) command('/usr/bin/hdiutil', ['detach', mount]);
        assert.equal(path.dirname(fixture), path.resolve(os.tmpdir()));
        assert(path.basename(fixture).startsWith('fury-dmg-runtime-'));
        fs.rmSync(fixture, { recursive: true, force: true });
    }
}
if (require.main === module) {
    if (!process.argv[2]) throw new Error('Usage: node scripts/verify_macos_dmg.js <release-directory> <x64|arm64>');
    main(path.resolve(process.argv[2]), process.argv[3], process.argv[4]).catch(error => { console.error(error.stack); process.exitCode = 1; });
}
module.exports = { main };
