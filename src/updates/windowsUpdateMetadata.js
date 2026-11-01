'use strict';
const { stableVersion, validateManifest } = require('./updateNotifications');
const release = require('./releaseConfig');

const METADATA_FILE = 'windows-update.json';
function releaseUrl(version, filename = METADATA_FILE) {
    if (!stableVersion(version)) throw new Error('Invalid update version');
    return new URL(`/releases/${version}/${filename}`, release.downloadOrigin).href;
}
function validateWindowsUpdate(value, version) {
    const keys = ['schemaVersion', 'version', 'filename', 'bytes', 'sha256', 'sha512', 'releasedAt'];
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).some(key => !keys.includes(key)) || value.schemaVersion !== 1
        || value.version !== version || !stableVersion(version)
        || value.filename !== `Fury-Setup-${version}-win-x64.exe`
        || !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > 2 * 1024 ** 3
        || !/^[a-f0-9]{64}$/.test(value.sha256 || '')
        || typeof value.sha512 !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(value.sha512)
        || Buffer.from(value.sha512, 'base64').length !== 64) throw new Error('Invalid Windows update metadata');
    validateManifest({ schemaVersion: 1, latestVersion: version, releasePageUrl: release.downloadPageUrl, releasedAt: value.releasedAt });
    if (typeof value.releasedAt !== 'string') throw new Error('Missing update date');
    return Object.freeze({ ...value });
}
module.exports = { METADATA_FILE, releaseUrl, validateWindowsUpdate };
