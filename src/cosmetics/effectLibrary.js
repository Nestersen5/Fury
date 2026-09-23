'use strict';

// Persisted exemplar library for the cosmetic effect classifier. One entry
// per cosmetic, created ONLY by deliberate recording (/cosmeticfx record
// <name> before triggering the effect in a private game) - live games never
// auto-add entries, so the library stays clean-sample only. Matching against
// the library never mutates fingerprints; it only bumps a "seen" counter.
//
// Performance contract (this runs inside the live proxy):
//  - the file is read ONCE, synchronously, at construction - which happens
//    during proxy startup, never mid-game.
//  - every later mutation schedules a DEBOUNCED ASYNC save (fs.promises,
//    unref'd timer). No synchronous disk writes ever happen on the packet
//    or chat path.

const fs = require('fs');
const path = require('path');
const { dataPath } = require('../storage/runtimePaths.js');
const { similarity } = require('./effectFingerprint.js');

const DEFAULT_FILE = dataPath('src', 'cosmetics', 'effect_library.json');
const DEFAULT_MATCH_THRESHOLD = 0.85;
const SAVE_DEBOUNCE_MS = 1_500;

function createEffectLibrary({
    file = DEFAULT_FILE,
    matchThreshold = DEFAULT_MATCH_THRESHOLD,
    logger = console
} = {}) {
    let entries = [];
    let nextId = 1;
    let settings = {}; // user prefs that must survive restarts (e.g. notify)
    let saveTimer = null;
    let savePending = false;
    let saves = Promise.resolve(), failure = null;

    function loadSync() {
        try {
            if (!fs.existsSync(file)) return;
            const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (Array.isArray(raw?.entries)) {
                entries = raw.entries.filter(entry => entry && entry.fingerprint && entry.kind);
            }
            if (raw?.settings && typeof raw.settings === 'object') settings = raw.settings;
            nextId = Number(raw?.nextId) || (entries.reduce((max, entry) => Math.max(max, Number(entry.id) || 0), 0) + 1);
        } catch (error) {
            logger.error?.('[EffectLibrary] Failed to load library file:', error.message);
            entries = [];
        }
    }

    function saveNow() {
        savePending = false;
        const payload = JSON.stringify({ nextId, entries, settings });
        saves = saves.then(async () => {
            await fs.promises.mkdir(path.dirname(file), { recursive: true });
            await fs.promises.writeFile(file, payload, 'utf8');
        }).catch(() => { failure ||= new Error('Cosmetic library save failed.'); });
        return saves;
    }

    function getSetting(key, fallback) {
        return key in settings ? settings[key] : fallback;
    }

    function setSetting(key, value) {
        settings[key] = value;
        scheduleSave();
    }

    function scheduleSave() {
        savePending = true;
        if (saveTimer) return;
        saveTimer = setTimeout(() => {
            saveTimer = null;
            if (savePending) saveNow();
        }, SAVE_DEBOUNCE_MS);
        saveTimer.unref?.();
    }

    function displayName(entry) {
        return entry.label || `unknown-${entry.id}`;
    }

    function bestMatch(fingerprint, kind) {
        let best = null;
        let bestScore = -1;
        entries.forEach((entry) => {
            if (entry.kind !== kind) return;
            const score = similarity(fingerprint, entry.fingerprint);
            if (score > bestScore) {
                bestScore = score;
                best = entry;
            }
        });
        return best ? { entry: best, score: bestScore } : null;
    }

    // Read-only classification of a live capture. Returns
    // { entry, score, matched } or null when the library has no entry of
    // this kind at all. Never creates or mutates fingerprints.
    function classify(fingerprint, kind) {
        const match = bestMatch(fingerprint, kind);
        if (!match) return null;
        return { ...match, matched: match.score >= matchThreshold };
    }

    // Bump the sighting counter after a confirmed live match (display only).
    function recordSighting(entry) {
        entry.seen = (entry.seen || 0) + 1;
        scheduleSave();
    }

    // Deliberate clean-sample recording. Re-recording an existing label of
    // the same kind REPLACES its fingerprint (newest clean sample wins).
    function addExemplar(fingerprint, kind, label) {
        const cleanLabel = String(label || '').trim();
        if (!cleanLabel || !fingerprint) return null;
        const existing = entries.find(entry => (
            entry.kind === kind && entry.label && entry.label.toLowerCase() === cleanLabel.toLowerCase()
        ));
        if (existing) {
            existing.fingerprint = fingerprint;
            existing.samples = (existing.samples || 1) + 1;
            existing.updatedAt = Date.now();
            scheduleSave();
            return existing;
        }
        const entry = {
            id: nextId,
            label: cleanLabel,
            kind,
            fingerprint,
            samples: 1,
            seen: 0,
            updatedAt: Date.now()
        };
        nextId += 1;
        entries.push(entry);
        scheduleSave();
        return entry;
    }

    // query: an entry id or "unknown-N" (kept for renaming legacy entries).
    function labelEntry(query, label) {
        const idMatch = String(query || '').match(/^(?:unknown-)?(\d+)$/i);
        if (!idMatch || !label) return null;
        const id = Number(idMatch[1]);
        const entry = entries.find(candidate => Number(candidate.id) === id);
        if (!entry) return null;
        entry.label = String(label).trim();
        entry.updatedAt = Date.now();
        scheduleSave();
        return entry;
    }

    function removeEntry(query) {
        const idMatch = String(query || '').match(/^(?:unknown-)?(\d+)$/i);
        const index = idMatch
            ? entries.findIndex(entry => Number(entry.id) === Number(idMatch[1]))
            : entries.findIndex(entry => entry.label && entry.label.toLowerCase() === String(query || '').trim().toLowerCase());
        if (index === -1) return null;
        const [removed] = entries.splice(index, 1);
        scheduleSave();
        return removed;
    }

    function list(kind) {
        return entries
            .filter(entry => !kind || entry.kind === kind)
            .slice()
            .sort((a, b) => {
                if (Boolean(a.label) !== Boolean(b.label)) return a.label ? -1 : 1;
                return (b.seen || 0) - (a.seen || 0);
            });
    }

    function stats() {
        const byKind = {};
        entries.forEach((entry) => {
            const bucket = byKind[entry.kind] || (byKind[entry.kind] = { labeled: 0, unknown: 0 });
            if (entry.label) bucket.labeled += 1;
            else bucket.unknown += 1;
        });
        return { total: entries.length, byKind };
    }

    function dispose() {
        if (saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
        }
        if (savePending) saveNow();
    }

    loadSync();

    return {
        classify,
        recordSighting,
        addExemplar,
        bestMatch,
        labelEntry,
        removeEntry,
        list,
        stats,
        displayName,
        getSetting,
        setSetting,
        saveNow,
        dispose,
        async drain() {
            dispose();
            await saves;
            if (failure) throw failure;
        }
    };
}

module.exports = { createEffectLibrary, DEFAULT_FILE, DEFAULT_MATCH_THRESHOLD };
