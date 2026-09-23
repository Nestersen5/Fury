'use strict';

// Build-time artifact identity and content checks. Never imported by Fury runtime.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { runtimeFiles, verifySources } = require('./verify_packaged_sources');
const { assertNoBrowserPayload } = require('./verify_no_browser');

function releaseMatrix(version) {
    assert(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(version), 'Invalid release version');
    return [
        ['win', 'x64', 'installer', 'exe', 'Fury-Setup'],
        ['win', 'x64', 'portable', 'zip', 'Fury-Portable'],
        ['mac', 'x64', 'dmg', 'dmg', 'Fury'],
        ['mac', 'x64', 'portable', 'zip', 'Fury-Portable'],
        ['mac', 'arm64', 'dmg', 'dmg', 'Fury'],
        ['mac', 'arm64', 'portable', 'zip', 'Fury-Portable']
    ].map(([os, architecture, distribution, format, prefix]) => ({
        version, os, architecture, distribution, format,
        filename: `${prefix}-${version}-${os}-${architecture}.${format}`
    }));
}

async function sha256(file) {
    const hash = crypto.createHash('sha256');
    for await (const bytes of fs.createReadStream(file)) hash.update(bytes);
    return hash.digest('hex');
}

async function payloadInventory(root, { modes = process.platform !== 'win32' } = {}) {
    root = path.resolve(root);
    assert(!fs.lstatSync(root).isSymbolicLink(), 'Redirected payload root');
    // Trusted ancestors may be filesystem aliases (macOS /var -> /private/var).
    // Compare real targets against that same canonical root, while still
    // rejecting a redirected payload root and links leaving the actual payload.
    root = fs.realpathSync(root);
    const entries = [];
    async function walk(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name);
            const relative = path.relative(root, file).split(path.sep).join('/');
            const stat = fs.lstatSync(file);
            if (stat.isSymbolicLink()) {
                const link = fs.readlinkSync(file);
                assert(!path.isAbsolute(link), `Absolute payload link: ${relative}`);
                const target = path.relative(root, fs.realpathSync(file));
                assert(target !== '..' && !target.startsWith(`..${path.sep}`) && !path.isAbsolute(target), `Escaping payload link: ${relative}`);
                entries.push({ path: relative, type: 'link', target: link });
            } else if (stat.isDirectory()) await walk(file);
            else {
                assert(stat.isFile(), `Unsupported payload entry: ${relative}`);
                entries.push({ path: relative, type: 'file', bytes: stat.size, sha256: await sha256(file),
                    ...(modes ? { executable: stat.mode & 0o111 } : {}) });
            }
        }
    }
    await walk(root);
    entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    return { entries, bytes: entries.reduce((sum, entry) => sum + (entry.bytes || 0), 0),
        sha256: crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex') };
}

function assertPayloadParity(left, right) {
    assert.deepEqual(right.entries, left.entries, 'Paired application payloads differ');
    return { files: left.entries.length, bytes: left.bytes, sha256: left.sha256 };
}

function verifyApplicationFiles(sourceRoot, appRoot) {
    const source = verifySources(sourceRoot, appRoot);
    const config = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'package.json')));
    const expected = new Set(runtimeFiles(sourceRoot, config));
    function walk(directory, relative = '') {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            // The builder owns dependency pruning; application allowlists must
            // not admit private state or stale files beside those dependencies.
            if (!relative && entry.name === 'node_modules') continue;
            const file = relative ? `${relative}/${entry.name}` : entry.name;
            assert(!entry.isSymbolicLink(), `Unexpected application link: ${file}`);
            if (entry.isDirectory()) walk(path.join(directory, entry.name), file);
            else assert(expected.has(file), `Unlisted/private application file: ${file}`);
        }
    }
    walk(appRoot);
    for (const name of ['auth_tokens', 'launcher_data', 'recordings', 'packet_logs', 'backups', 'tmp', '.env', '.env.local',
        'session_data.json', 'features_config.json', 'server_config.json', 'migration-recovery']) {
        assert(!fs.existsSync(path.join(appRoot, name)), `Private application data bundled: ${name}`);
    }
    return source;
}

async function verifyApplication(sourceRoot, application, os, arch) {
    const resources = path.join(application, ...(os === 'mac' ? ['Contents', 'Resources'] : ['resources']));
    const source = verifyApplicationFiles(sourceRoot, path.join(resources, 'app'));
    assertNoBrowserPayload(application);
    if (os === 'win') {
        assert.equal(arch, 'x64');
        for (const file of [path.join(application, 'Fury.exe')]) {
            const fd = fs.openSync(file, 'r');
            try {
                const header = Buffer.alloc(64); fs.readSync(fd, header, 0, 64, 0);
                assert.equal(header.toString('ascii', 0, 2), 'MZ');
                const pe = Buffer.alloc(6); fs.readSync(fd, pe, 0, 6, header.readUInt32LE(0x3c));
                assert.equal(pe.readUInt32LE(0), 0x4550); assert.equal(pe.readUInt16LE(4), 0x8664, 'Expected x64 executable');
            } finally { fs.closeSync(fd); }
        }
    }
    return source;
}

async function writeReleaseMetadata(directory, version) {
    const artifacts = [];
    for (const item of releaseMatrix(version)) {
        const file = path.join(directory, item.filename);
        const present = fs.existsSync(file);
        if (present) assert(fs.lstatSync(file).isFile(), 'Artifact must be a regular file');
        artifacts.push({ ...item, available: present, size: present ? fs.statSync(file).size : null,
            sha256: present ? await sha256(file) : null });
    }
    // Presence/hashes describe local files, not runtime acceptance or public trust.
    const result = { schemaVersion: 1, version, artifacts };
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'release-metadata.json'), JSON.stringify(result, null, 2) + '\n');
    return result;
}

if (require.main === module) {
    const directory = process.argv[2];
    if (!directory) throw new Error('Usage: node scripts/release_artifacts.js <release-directory>');
    writeReleaseMetadata(path.resolve(directory), require('../package.json').version).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { releaseMatrix, sha256, payloadInventory, assertPayloadParity, verifyApplicationFiles, verifyApplication, writeReleaseMetadata };
