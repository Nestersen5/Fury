'use strict';
const fs = require('fs');
const { writeFileAtomic } = require('../storage/atomic_file');
const { stableVersion, compareVersions, readManifest, endpoint } = require('./updateNotifications');
const { bundled, validateNotes, summarizeNotes } = require('./releaseNotes');
const config = require('./releaseConfig');
const { destinations } = require('./releaseDestinations');

function createReleaseExperience({ installedVersion, isPackaged, statePath, updates, env = process.env, read = readManifest }) {
    let state, previousVersion, initialization, checkPromise, offer, notesKey, notesPromise, stopped = false, writes = Promise.resolve();
    const controller = new AbortController();
    let mutations = Promise.resolve();
    let readableVersions = new Set(bundled.releases.filter(entry => compareVersions(entry.version, installedVersion) <= 0).map(entry => entry.version));
    const ids = values => Array.isArray(values) ? [...new Set(values.filter(value => typeof value === 'string'))].slice(-200) : [];
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
                seen: Array.isArray(saved?.seen) ? saved.seen.filter(stableVersion).slice(-50) : [],
                readVersions: Array.isArray(saved?.readVersions) ? saved.readVersions.filter(stableVersion).slice(-50) : [],
                unreadVersions: Array.isArray(saved?.unreadVersions) ? saved.unreadVersions.filter(stableVersion).slice(-50) : [],
                discovery: saved?.discovery?.version === installedVersion ? {
                    version: installedVersion,
                    pending: ids(saved.discovery.pending).filter(id => destinations.some(item => item.id === id)),
                    seen: ids(saved.discovery.seen), visited: ids(saved.discovery.visited)
                } : null };
            previousVersion = state.lastVersion;
            const tracked = isPackaged || env.FURY_UPDATE_TEST_MODE === '1';
            const baseline = previousVersion === installedVersion ? state.fromVersion : previousVersion;
            if (tracked && stableVersion(baseline) && (!saved?.unreadVersions || previousVersion !== installedVersion)) {
                state.unreadVersions = [...new Set([...state.unreadVersions, ...bundled.releases
                    .filter(entry => compareVersions(entry.version, baseline) > 0 && compareVersions(entry.version, installedVersion) <= 0)
                    .map(entry => entry.version)])].filter(version => !state.readVersions.includes(version)).slice(-50);
            }
            if (!state.discovery) {
                state.discovery = { version: installedVersion, pending: tracked && stableVersion(baseline)
                    ? destinations.filter(item => item.control && compareVersions(item.version, baseline) > 0
                        && compareVersions(item.version, installedVersion) <= 0).map(item => item.id) : [], seen: [], visited: [] };
            }
            if (!stopped && state.lastVersion !== installedVersion && stableVersion(installedVersion)
                && tracked) {
                state.fromVersion = state.lastVersion;
                state.lastVersion = installedVersion;
                await persist().catch(() => {});
            } else if (!stopped && tracked && !saved?.discovery) await persist().catch(() => {});
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
        await mutations.catch(() => {});
        const target = offer || { version: installedVersion, kind: 'welcome', fromVersion: state.fromVersion };
        const key = `${target.version}:${target.fromVersion || ''}`;
        if (notesKey !== key) { notesKey = key; notesPromise = loadNotes(target); }
        return { ...await notesPromise, readVersions: [...state.readVersions], unreadVersions: [...state.unreadVersions], discovery: discovery() };
    }
    async function loadNotes(target) {
        let data = bundled;
        if (target.kind === 'available' && !bundled.releases.some(entry => entry.version === target.version)) {
            try {
                const url = endpoint({ isPackaged, env, release: config });
                if (url) data = validateNotes(await read(new URL('/release-notes.json', url), { signal: controller.signal, maxBytes: 65536 }));
            } catch { /* Retain bundled content and offer a download link. */ }
        }
        const releases = [...new Map([...data.releases, ...bundled.releases].map(entry => [entry.version, entry])).values()]
            .filter(entry => compareVersions(entry.version, target.version) <= 0)
            .sort((a, b) => compareVersions(b.version, a.version));
        readableVersions = new Set(releases.map(entry => entry.version));
        if (!stopped && target.kind === 'available' && !state.readVersions.includes(target.version) && !state.unreadVersions.includes(target.version)) {
            state.unreadVersions = [...state.unreadVersions, target.version].slice(-50);
            await persist().catch(() => {});
        }
        return { ...target, installedVersion, unreadFromVersion: state.fromVersion || target.fromVersion, releases, sections: summarizeNotes(data, target.fromVersion, target.version),
            complete: data.releases.some(entry => entry.version === target.version) };
    }
    function discovery() {
        return { ...state.discovery, pending: [...state.discovery.pending], seen: [...state.discovery.seen], visited: [...state.discovery.visited] };
    }
    async function recordSeen(payload) {
        await initialize();
        if (stopped || !payload || payload.version !== installedVersion) return null;
        const read = payload.readVersion;
        if (read !== undefined && (!stableVersion(read) || !readableVersions.has(read))) return null;
        if (payload.settings !== undefined && (!Array.isArray(payload.settings) || payload.settings.length > 200
            || payload.settings.some(id => !state.discovery.pending.includes(id)))) return null;
        if (payload.category !== undefined && !destinations.some(item => item.category === payload.category)) return null;
        const before = { readVersions: [...state.readVersions], unreadVersions: [...state.unreadVersions], discovery: discovery() };
        let changed = false;
        if (read && !state.readVersions.includes(read)) { state.readVersions = [...state.readVersions, read].slice(-50); state.unreadVersions = state.unreadVersions.filter(version => version !== read); changed = true; }
        for (const id of payload.settings || []) if (!state.discovery.seen.includes(id)) { state.discovery.seen.push(id); changed = true; }
        if (payload.category && !state.discovery.visited.includes(payload.category)) { state.discovery.visited.push(payload.category); changed = true; }
        if (changed) {
            try { await persist(); }
            catch (error) {
                state.readVersions = before.readVersions;
                state.unreadVersions = [...new Set([...before.unreadVersions, ...state.unreadVersions])];
                state.discovery = before.discovery;
                throw error;
            }
        }
        return { readVersions: [...state.readVersions], unreadVersions: [...state.unreadVersions], discovery: discovery() };
    }
    return {
        check, notes,
        markSeen(payload) {
            const next = mutations.catch(() => {}).then(() => recordSeen(payload));
            mutations = next; return next;
        },
        async available() {
            if (!checkPromise) await check();
            else await checkPromise;
            return !stopped && offer?.kind === 'available' ? { ...offer } : null;
        },
        async dismiss(version) {
            await initialize();
            if (stopped || version !== (offer?.version || installedVersion)) return false;
            if (!state.seen.includes(version)) state.seen = [...state.seen, version].slice(-50);
            await persist();
            return true;
        },
        dispose() { stopped = true; controller.abort(); },
        async flush() { await initialization; await mutations.catch(() => {}); await writes; }
    };
}
module.exports = { createReleaseExperience };
