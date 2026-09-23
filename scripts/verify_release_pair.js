'use strict';

// Extract containers without installing anything. Mount Mac DMGs read-only.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { releaseMatrix, payloadInventory, assertPayloadParity, verifyApplication } = require('./release_artifacts');

function command(executable, args, options = {}) {
    const result = spawnSync(executable, args, { windowsHide: true, encoding: 'utf8', timeout: 300000, maxBuffer: 8 * 1024 * 1024, ...options });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `${path.basename(executable)} failed: ${result.stderr || result.stdout}`);
    return result.stdout;
}

function verifyMacArchitecture(app, arch) {
    assert.equal(process.platform, 'darwin', 'Mac architecture checks require macOS');
    const expected = arch === 'x64' ? 'x86_64' : 'arm64';
    let binaries = 0;
    function walk(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name);
            if (entry.isSymbolicLink()) continue; // inventory checks containment
            if (entry.isDirectory()) { walk(file); continue; }
            const fd = fs.openSync(file, 'r'), bytes = Buffer.alloc(4);
            try { fs.readSync(fd, bytes, 0, 4, 0); } finally { fs.closeSync(fd); }
            if (![0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca].includes(bytes.readUInt32BE(0))) continue;
            // .class files share the fat-binary magic; lipo must recognize code.
            if (file.endsWith('.class')) continue;
            const arches = command('/usr/bin/lipo', ['-archs', file]).trim().split(/\s+/);
            assert(arches.includes(expected), `Wrong Mach-O architecture: ${path.relative(app, file)}`);
            if (file === path.join(app, 'Contents/MacOS/Fury')) assert.deepEqual(arches, [expected], 'Do not create a universal Fury build');
            if (file.includes('/Contents/MacOS/')) assert(fs.statSync(file).mode & 0o111, 'Mac executable lost its executable mode');
            binaries++;
        }
    }
    walk(app);
    assert(binaries > 2, 'Expected Electron helper binaries');
    const identifier = command('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', path.join(app, 'Contents/Info.plist')]).trim();
    assert.equal(identifier, require('../package.json').build.appId);
    return { architecture: arch, binaries, nativeRuntimeTested: false };
}

async function verifyPair({ directory, platform, arch, sourceRoot = path.resolve(__dirname, '..'), reportFile, stage }) {
    assert((platform === 'win' && arch === 'x64') || (platform === 'mac' && ['x64', 'arm64'].includes(arch)), 'Unsupported release pair');
    assert.equal(process.platform, platform === 'win' ? 'win32' : 'darwin', 'Verify artifacts on their target OS');
    const version = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'package.json'))).version;
    const pair = releaseMatrix(version).filter(item => item.os === platform && item.architecture === arch);
    const artifact = distribution => path.join(directory, pair.find(item => item.distribution === distribution).filename);
    for (const entry of pair) assert(fs.statSync(path.join(directory, entry.filename)).isFile());
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-release-pair-'));
    let mounted = false;
    const mount = path.join(temporary, 'mounted');
    try {
        const portable = path.join(temporary, 'Portable With Spaces'); fs.mkdirSync(portable);
        let other, zipApp;
        if (platform === 'win') {
            const sevenZip = await require('app-builder-lib/out/toolsets/7zip').getPath7za();
            const extract = (archive, output) => { fs.mkdirSync(output, { recursive: true }); command(sevenZip, ['x', '-y', '-bd', '-bso0', '-bsp0', '-o' + output, archive]); };
            extract(artifact('portable'), portable); zipApp = portable;
            const embedded = path.join(temporary, 'installer'); extract(artifact('installer'), embedded);
            if (fs.existsSync(path.join(embedded, 'Fury.exe'))) other = embedded;
            else {
                const archives = [];
                function find(directory) { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
                    const file = path.join(directory, entry.name);
                    if (entry.isDirectory()) find(file); else if (entry.name === 'app-64.7z') archives.push(file);
                } }
                find(embedded); assert.equal(archives.length, 1, 'Expected one embedded x64 application');
                other = path.join(temporary, 'NSIS Payload'); extract(archives[0], other);
            }
        } else {
            command('/usr/bin/ditto', ['-x', '-k', artifact('portable'), portable]);
            zipApp = path.join(portable, 'Fury.app'); fs.mkdirSync(mount);
            command('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, artifact('dmg')]); mounted = true;
            assert(fs.lstatSync(path.join(mount, 'Applications')).isSymbolicLink(), 'DMG needs an Applications link');
            assert.equal(fs.readlinkSync(path.join(mount, 'Applications')), '/Applications');
            other = path.join(mount, 'Fury.app');
            verifyMacArchitecture(zipApp, arch); verifyMacArchitecture(other, arch);
            for (const app of [zipApp, other]) command('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
        }
        const source = await verifyApplication(sourceRoot, zipApp, platform, arch);
        await verifyApplication(sourceRoot, other, platform, arch);
        const left = await payloadInventory(zipApp), right = await payloadInventory(other);
        const parity = assertPayloadParity(left, right);
        if (stage) assertPayloadParity(left, await payloadInventory(stage));
        const result = { schemaVersion: 1, version, platform, architecture: arch, containers: pair.map(item => item.filename),
            sourceSha256: source.sourceSha256, runtimeFiles: source.runtimeFileCount, payload: parity,
            nativeRuntimeTested: false, publicDistributionTrustTested: false };
        if (reportFile) fs.writeFileSync(reportFile, JSON.stringify(result, null, 2) + '\n');
        console.log(`Verified ${platform}/${arch} paired payloads: ${parity.files} entries, ${parity.sha256}`);
        return result;
    } finally {
        // Never recursively delete a live mount if detachment fails.
        if (mounted) command('/usr/bin/hdiutil', ['detach', mount]);
        assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
        assert(path.basename(temporary).startsWith('fury-release-pair-'));
        fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
}

if (require.main === module) {
    const [platform, arch, directory] = process.argv.slice(2);
    if (!directory) throw new Error('Usage: node scripts/verify_release_pair.js <win|mac> <x64|arm64> <release-directory>');
    verifyPair({ platform, arch, directory: path.resolve(directory), reportFile: path.resolve(directory, `PAIR-${platform}-${arch}.json`) })
        .catch(error => { console.error(error.stack); process.exitCode = 1; });
}
module.exports = { verifyPair, verifyMacArchitecture, command };
