'use strict';

// Compare the extracted download with the checkout that produced it. A successful
// UI smoke test alone cannot detect an older but still functional renderer.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const minimatchModule = require('minimatch');
const match = minimatchModule.minimatch || minimatchModule;
const { packagePaths } = require('./smoke_packaged_app');

function runtimeFiles(root, config) {
    const patterns = config.build.files;
    const included = file => patterns.filter(p => !p.startsWith('!')).some(p => match(file, p, { dot: true }))
        && !patterns.filter(p => p.startsWith('!')).some(p => match(file, p.slice(1), { dot: true }));
    const candidates = new Set();
    function walk(directory) {
        for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
            const relative = directory ? `${directory}/${entry.name}` : entry.name;
            if (entry.isDirectory()) walk(relative);
            else if (entry.isFile()) candidates.add(relative);
        }
    }
    for (const pattern of patterns.filter(p => !p.startsWith('!'))) {
        if (pattern.includes('/')) {
            const directory = pattern.split('/')[0];
            assert(!/[?*{}]/.test(directory), `Unsupported runtime root: ${pattern}`);
            if (fs.existsSync(path.join(root, directory))) walk(directory);
        } else {
            for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
                if (entry.isFile()) candidates.add(entry.name);
            }
        }
    }
    return [...candidates].filter(included).sort();
}

function verifySources(root, appRoot) {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const packaged = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
    for (const key of ['name', 'version', 'main', 'dependencies']) {
        assert.deepStrictEqual(packaged[key], config[key], `Packaged ${key} differs from the current source`);
    }
    const files = {};
    for (const file of runtimeFiles(root, config).filter(file => file !== 'package.json')) {
        const source = fs.readFileSync(path.join(root, file));
        const bundled = fs.readFileSync(path.join(appRoot, file));
        assert(source.equals(bundled), `Packaged runtime file differs from current source: ${file}`);
        files[file] = crypto.createHash('sha256').update(source).digest('hex');
    }
    for (const retired of ['fury_hud.js', 'fury_hud.html', 'fury_hud.css', 'fury_hud_preload.js', 'fury-hud-demo']) {
        assert(!fs.existsSync(path.join(appRoot, retired)), `Retired desktop HUD was bundled: ${retired}`);
    }
    return { version: config.version, runtimeFileCount: Object.keys(files).length,
        sourceSha256: crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex'), files };
}

if (require.main === module) {
    const [input, output] = process.argv.slice(2);
    assert(input, 'Usage: node scripts/verify_packaged_sources.js <Fury.app or executable> [report.json]');
    const report = verifySources(path.resolve(__dirname, '..'), packagePaths(input).appRoot);
    if (output) fs.writeFileSync(path.resolve(output), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Current-source parity passed for ${report.runtimeFileCount} runtime files (${report.sourceSha256}).`);
}
module.exports = { runtimeFiles, verifySources };
