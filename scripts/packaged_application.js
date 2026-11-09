'use strict';
// Build/verification access to both historical loose payloads and Windows ASAR.
// Runtime Electron reads ASAR directly; no extraction is needed at startup.
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');

function applicationRoot(resources) {
    const archive = path.join(resources, 'app.asar'), loose = path.join(resources, 'app');
    assert(!(fs.existsSync(archive) && fs.existsSync(loose)), 'Ambiguous application payload');
    return fs.existsSync(archive) ? archive : loose;
}
function readApplicationFile(root, file) {
    return root.endsWith('.asar') ? require('@electron/asar').extractFile(root, path.normalize(file)) : fs.readFileSync(path.join(root, file));
}
function applicationFileExists(root, file) {
    if (!root.endsWith('.asar')) return fs.existsSync(path.join(root, file));
    try { return !!require('@electron/asar').statFile(root, path.normalize(file)); } catch { return false; }
}
function applicationEntries(root, { skipDependencies = false } = {}) {
    const entries = [];
    if (root.endsWith('.asar')) {
        const asar = require('@electron/asar');
        for (const name of asar.listPackage(root)) {
            const file = name.replace(/^[\\/]/, '').replace(/\\/g, '/');
            const stat = asar.statFile(root, path.normalize(file), false);
            assert(!stat.link, `Unexpected application link: ${file}`);
            if (!stat.files) entries.push(file);
        }
        if (fs.existsSync(root + '.unpacked')) {
            for (const file of applicationEntries(root + '.unpacked')) {
                assert(asar.statFile(root, path.normalize(file), false).unpacked,
                    `Unlisted unpacked application file: ${file}`);
            }
        }
    } else {
        function walk(directory, relative = '') {
            for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
                if (skipDependencies && !relative && entry.name === 'node_modules') continue;
                const file = relative ? `${relative}/${entry.name}` : entry.name;
                assert(!entry.isSymbolicLink(), `Unexpected application link: ${file}`);
                if (entry.isDirectory()) walk(path.join(directory, entry.name), file);
                else entries.push(file);
            }
        }
        walk(root);
    }
    return entries;
}
module.exports = { applicationRoot, readApplicationFile, applicationFileExists, applicationEntries };
