'use strict';
const { stableVersion, compareVersions } = require('./updateNotifications');
const bundled = require('./releaseNotes.json');
const groups = ['features', 'improvements', 'fixes'];
function validateNotes(value) {
    if (!value || value.schemaVersion !== 1 || !Array.isArray(value.releases) || value.releases.length > 50) throw Error('Invalid release notes');
    const versions = new Set();
    const releases = value.releases.map(release => {
        if (!release || !stableVersion(release.version) || versions.has(release.version)) throw Error('Invalid notes version');
        versions.add(release.version);
        const entry = { version: release.version };
        for (const group of groups) {
            if (!Array.isArray(release[group]) || release[group].length > 30) throw Error('Invalid notes section');
            entry[group] = release[group].map(line => {
                if (typeof line !== 'string' || !line.trim() || line.length > 220 || /[\u0000-\u001f\u007f]/.test(line)) throw Error('Invalid notes text');
                return line;
            });
        }
        return entry;
    });
    return { schemaVersion: 1, releases };
}
function summarizeNotes(notes, from, to) {
    const releases = notes.releases.filter(entry => compareVersions(entry.version, to) <= 0
        && (stableVersion(from) ? compareVersions(entry.version, from) > 0 : compareVersions(entry.version, to) === 0));
    return Object.fromEntries(groups.map(group => [group, [...new Set(releases.flatMap(entry => entry[group]))]]));
}
module.exports = { bundled: validateNotes(bundled), validateNotes, summarizeNotes };
