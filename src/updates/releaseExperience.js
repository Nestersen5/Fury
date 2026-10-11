'use strict';
const fs = require('fs');
const { writeFileAtomic } = require('../storage/atomic_file');
const { stableVersion, compareVersions, readManifest, endpoint } = require('./updateNotifications');
const { bundled, validateNotes, summarizeNotes } = require('./releaseNotes');
const config = require('./releaseConfig');

function createReleaseExperience({ installedVersion, isPackaged, statePath, updates, env = process.env, read = readManifest }) {
    let state, previousVersion, initialization, checkPromise, offer, notesKey, notesPromise, stopped = false, writes = Promise.resolve();
    const controller = new AbortController();
    const persist = () => {
        const snapshot = JSON.stringify(state);
        const next = writes.catch(() => {}).then(() => writeFileAtomic(statePath, snapshot));
        writes = next;
        return next;
    };
    function initialize() {
        return initialization ||= (async () => {
            let saved;
            try { saved = JSON.parse(await fs.promises.readFile(statePath, 'utf8')); } catch {}
            state = { lastVersion: stableVersion(saved?.lastVersion) ? saved.lastVersion : null,
                fromVersion: stableVersion(saved?.fromVersion) ? saved.fromVersion : null,
                seen: Array.isArray(saved?.seen) ? saved.seen.filter(stableVersion).slice(-50) : [] };
            previousVersion = state.lastVersion;
            if (!stopped && state.lastVersion !== installedVersion && stableVersion(installedVersion)
                && (isPackaged || env.FURY_UPDATE_TEST_MODE === '1')) {
                state.fromVersion = state.lastVersion;
                state.lastVersion = installedVersion;
                await persist().catch(() => {});
            }
        })();
    }
    async function check() {
        await initialize();
        if (stopped) return null;
        if (checkPromise) return null;
        checkPromise = (async () => {
            const remote = await updates.check();
            if (stopped) return null;
            const welcome = (isPackaged || env.FURY_UPDATE_TEST_MODE === '1') && stableVersion(installedVersion)
                && bundled.releases.some(entry => entry.version === installedVersion)
                && (!previousVersion || compareVersions(installedVersion, previousVersion) > 0);
            const candidate = remote ? { ...remote, kind: 'available', fromVersion: installedVersion }
                : welcome ? { version: installedVersion, kind: 'welcome', fromVersion: previousVersion } : null;
            if (!candidate) return null;
            offer = candidate;
            if (state.seen.includes(candidate.version)) return null;
            return candidate;
        })();
        return checkPromise;
    }
    async function notes() {
        await initialize();
        const target = offer || { version: installedVersion, kind: 'welcome', fromVersion: state.fromVersion };
        const key = `${target.version}:${target.fromVersion || ''}`;
        if (notesKey === key) return notesPromise;
        notesKey = key;
        notesPromise = loadNotes(target);
        return notesPromise;
    }
    async function loadNotes(target) {
        let data = bundled;
        if (target.kind === 'available' && !bundled.releases.some(entry => entry.version === target.version)) {
            try {
                const url = endpoint({ isPackaged, env, release: config });
                if (url) data = validateNotes(await read(new URL('/release-notes.json', url), { signal: controller.signal, maxBytes: 65536 }));
            } catch { /* Retain bundled content and offer a download link. */ }
        }
        return { ...target, sections: summarizeNotes(data, target.fromVersion, target.version),
            complete: data.releases.some(entry => entry.version === target.version) };
    }
    return {
        check, notes,
        async dismiss(version) {
            await initialize();
            if (stopped || version !== (offer?.version || installedVersion)) return false;
            if (!state.seen.includes(version)) state.seen = [...state.seen, version].slice(-50);
            await persist();
            return true;
        },
        dispose() { stopped = true; controller.abort(); },
        async flush() { await initialization; await writes; }
    };
}
module.exports = { createReleaseExperience };
