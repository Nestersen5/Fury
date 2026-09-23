'use strict';

const http = require('http');
const https = require('https');
const config = require('./releaseConfig');
const MAX_BYTES = 8192;
const TIMEOUT_MS = 3000;

// Fury publishes stable SemVer only. Build metadata has no ordering weight;
// prereleases are deliberately unsupported on both sides of this channel.
function stableVersion(value) {
    if (typeof value !== 'string' || value.length > 64) return null;
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value);
    if (!match || match[0] !== value) return null;
    const parts = match.slice(1, 4).map(Number);
    return parts.every(Number.isSafeInteger) ? parts : null;
}

function compareVersions(left, right) {
    const a = stableVersion(left), b = stableVersion(right);
    if (!a || !b) throw new Error('Unsupported stable version');
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
    return 0;
}

function safeUrl(value) {
    if (typeof value !== 'string' || value.length > 256 || /[\s\u0000-\u001f\u007f]/.test(value)) throw new Error('Invalid release URL');
    const url = new URL(value);
    if (url.username || url.password || url.hash || url.search) throw new Error('Invalid release URL');
    return url;
}

function validateManifest(value, downloadPageUrl = config.downloadPageUrl) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1) throw new Error('Unsupported release manifest');
    const allowed = new Set(['schemaVersion', 'latestVersion', 'releasePageUrl', 'releasedAt', 'summary', 'minimumSupportedVersion']);
    if (Object.keys(value).some(key => !allowed.has(key)) || !stableVersion(value.latestVersion)) throw new Error('Invalid release manifest');
    const page = safeUrl(value.releasePageUrl), trusted = safeUrl(downloadPageUrl);
    if (page.protocol !== 'https:' || page.href !== trusted.href) throw new Error('Unexpected release page');
    if (value.summary !== undefined && (typeof value.summary !== 'string' || value.summary.length > 280 || /[\u0000-\u001f\u007f]/.test(value.summary))) throw new Error('Invalid release summary');
    if (value.releasedAt !== undefined) {
        if (typeof value.releasedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value.releasedAt)
            || !Number.isFinite(Date.parse(value.releasedAt))
            || new Date(value.releasedAt).toISOString() !== value.releasedAt.replace('Z', '.000Z')) throw new Error('Invalid release date');
    }
    if (value.minimumSupportedVersion !== undefined && (!stableVersion(value.minimumSupportedVersion)
        || compareVersions(value.minimumSupportedVersion, value.latestVersion) > 0)) throw new Error('Invalid minimum version');
    return { version: value.latestVersion, summary: value.summary || '' };
}

function endpoint({ isPackaged, env, release }) {
    if (!isPackaged) {
        if (env.FURY_UPDATE_TEST_MODE !== '1' || !env.FURY_UPDATE_TEST_URL) return null;
        const url = safeUrl(env.FURY_UPDATE_TEST_URL);
        if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Update fixture must use loopback HTTP');
        return url;
    }
    // Packaged applications never accept environment-controlled release hosts.
    if (!release.manifestUrl) return null;
    const url = safeUrl(release.manifestUrl), page = safeUrl(release.downloadPageUrl);
    if (url.protocol !== 'https:' || url.origin !== page.origin) throw new Error('Untrusted manifest origin');
    return url;
}

function readManifest(url, { signal, timeoutMs = TIMEOUT_MS } = {}) {
    return new Promise((resolve, reject) => {
        let request, timer, settled = false;
        const finish = (error, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            request?.destroy();
            error ? reject(error) : resolve(value);
        };
        const abort = () => finish(new Error('Update check cancelled'));
        if (signal?.aborted) { abort(); return; }
        signal?.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => finish(new Error('Update check timed out')), timeoutMs);
        timer.unref?.();
        try {
            // No Electron session/cookie jar, auth headers, query parameters,
            // identifiers or version/platform headers. Never follow redirects.
            request = (url.protocol === 'https:' ? https : http).get(url, {
                agent: false, headers: { Accept: 'application/json' }
            }, response => {
                if (response.statusCode !== 200 || !/^application\/json(?:;|$)/i.test(response.headers['content-type'] || '')
                    || Number(response.headers['content-length']) > MAX_BYTES) {
                    response.destroy(); finish(new Error('Invalid update response')); return;
                }
                const chunks = []; let bytes = 0;
                response.on('data', chunk => {
                    bytes += chunk.length;
                    if (bytes > MAX_BYTES) { response.destroy(); finish(new Error('Update response too large')); }
                    else chunks.push(chunk);
                });
                response.on('error', error => finish(error));
                response.on('aborted', () => finish(new Error('Incomplete update response')));
                response.on('end', () => {
                    if (settled) return;
                    try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
                    catch { finish(new Error('Invalid update JSON')); }
                });
            });
            request.on('socket', socket => socket.unref());
            request.on('error', error => finish(error));
        } catch (error) { finish(error); }
    });
}

function createUpdateNotifications({ installedVersion, isPackaged, env = process.env,
    release = config, read = readManifest, openExternal }) {
    let pending = null, claimed = false, stopped = false, available = false;
    const controller = new AbortController();
    async function check() {
        if (stopped || !stableVersion(installedVersion)) return null;
        if (!pending) pending = (async () => {
            try {
                const url = endpoint({ isPackaged, env, release });
                if (!url) return null;
                const manifest = validateManifest(await read(url, { signal: controller.signal }), release.downloadPageUrl);
                return compareVersions(manifest.version, installedVersion) > 0 ? manifest : null;
            } catch { return null; } // Startup failures are deliberately silent.
        })();
        const result = await pending;
        if (stopped || claimed || !result) return null;
        claimed = true; available = true;
        return result;
    }
    return {
        check,
        async open() {
            if (stopped || !available) return false;
            // No renderer/manifest URL reaches the system browser.
            await openExternal(release.downloadPageUrl);
            return true;
        },
        dispose() { stopped = true; controller.abort(); }
    };
}

module.exports = { createUpdateNotifications, stableVersion, compareVersions, validateManifest, endpoint, readManifest, MAX_BYTES, TIMEOUT_MS };
