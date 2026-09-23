'use strict';

const fs = require('fs');
const path = require('path');
const { createHash } = require('prismarine-auth/src/common/Util');

// Authflow keys its files by the exact supplied username. A successful browser
// sign-in may return a different IGN; the proxy will request that returned IGN.
// Promote only this operation's cache under the name the proxy actually uses.
function promoteAuthCache(stage, authRoot, requestedName, profileName) {
    if (![requestedName, profileName].every(name => /^[A-Za-z0-9_]{3,16}$/.test(name))) {
        throw new Error('Invalid Minecraft account name.');
    }
    const sourcePrefix = `${createHash(requestedName)}_`;
    const targetPrefix = `${createHash(profileName)}_`;
    const files = fs.readdirSync(stage, { withFileTypes: true }).filter(entry => entry.isFile()
        && entry.name.startsWith(sourcePrefix) && entry.name.endsWith('-cache.json'));
    if (!files.some(entry => entry.name.endsWith('_mca-cache.json'))) throw new Error('Microsoft sign-in did not produce a Minecraft login cache.');
    const destination = path.join(authRoot, profileName);
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of files) {
        const target = path.join(destination, targetPrefix + entry.name.slice(sourcePrefix.length));
        const temporary = `${target}.${process.pid}.tmp`;
        try { fs.copyFileSync(path.join(stage, entry.name), temporary); fs.renameSync(temporary, target); }
        finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    }
    const required=path.join(destination,'fury-signin-required.json');
    if(fs.existsSync(required))fs.unlinkSync(required);
    return destination;
}

module.exports = { promoteAuthCache };
