'use strict';
const fs = require('fs');
const { writeFileAtomic } = require('../storage/atomic_file');
const { stableVersion, compareVersions } = require('./updateNotifications');

// Records intent, never permission to download/install. A later launch checks
// the actual running version instead of treating installer handoff as success.
function createUpdateAttempt(file) {
    const clear = async () => { await fs.promises.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; }); };
    return {
        async pending(installedVersion) {
            try {
                if ((await fs.promises.stat(file)).size > 1024) return false;
                const saved = JSON.parse(await fs.promises.readFile(file, 'utf8'));
                if (saved.schemaVersion !== 1 || !stableVersion(saved.fromVersion) || !stableVersion(saved.targetVersion)) return false;
                if (compareVersions(installedVersion, saved.targetVersion) >= 0) { await clear(); return false; }
                return true;
            } catch { return false; }
        },
        async begin(fromVersion, targetVersion) {
            if (!stableVersion(fromVersion) || !stableVersion(targetVersion) || compareVersions(targetVersion, fromVersion) <= 0) throw Error('Invalid update attempt');
            await writeFileAtomic(file, JSON.stringify({ schemaVersion: 1, fromVersion, targetVersion }));
        }, clear
    };
}
module.exports = { createUpdateAttempt };
