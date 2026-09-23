'use strict';

// Silent tag tracker. While a game is being scanned, every Caution, Sniper,
// Legit Sniper, or Replays tag found on a player is appended to a plain-text
// log with its full Urchin/Seraph details. Nothing is sent to chat.
//
// Each player's tag is written once per source and tag type, ever. Keys already
// present in the log are loaded on startup so a restart doesn't re-log them.

const fs = require('fs');
const path = require('path');
const { parseOverlayUrchinTag, parseOverlaySeraphTag } = require('./tags.js');
const { nametagTagCategory } = require('./nametags.js');

const TRACKED_CATEGORIES = new Set(['caution', 'sniper', 'legit_sniper', 'replays']);
const CATEGORY_LABELS = { caution: 'Caution', sniper: 'Sniper', legit_sniper: 'Legit Sniper', replays: 'Replays Needed' };

function trackedCategory(value = '') {
    const category = nametagTagCategory(value);
    if (category) return TRACKED_CATEGORIES.has(category) ? category : '';
    return /\breplays?\b/i.test(String(value)) ? 'replays' : '';
}

// Pair each parsed tag with the exact API payload it came from, so the log
// keeps the untouched wording alongside the cleaned fields.
function collectTrackedTags(data = {}) {
    const entries = [];
    for (const raw of data.urchin?.rawTags || []) {
        const tag = parseOverlayUrchinTag(raw);
        const category = tag && trackedCategory(tag.value);
        if (category) entries.push({ category, tag, raw });
    }
    if (!(data.urchin?.rawTags || []).length && data.urchin?.tag) {
        const tag = parseOverlayUrchinTag({ tooltip: data.urchin.tag });
        const category = tag && trackedCategory(tag.value);
        if (category) entries.push({ category, tag, raw: { tooltip: data.urchin.tag } });
    }
    const seraphTag = parseOverlaySeraphTag(data.seraph);
    const seraphCategory = seraphTag && trackedCategory(seraphTag.value);
    if (seraphCategory) entries.push({ category: seraphCategory, tag: seraphTag, raw: data.seraph });
    return entries;
}

function pad(number) {
    return String(number).padStart(2, '0');
}

function formatTimestamp(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatEntry({ at, name, lookupName, gameMode, team, category, tag, raw }) {
    const player = lookupName && lookupName.toLowerCase() !== name.toLowerCase() ? `${name} (real: ${lookupName})` : name;
    const lines = [
        `[${formatTimestamp(at)}] ${String(tag.source).toUpperCase()} | ${CATEGORY_LABELS[category]} | ${player}`,
        `  Game: ${gameMode || 'Unknown'}${team ? ` | Team: ${team}` : ''}`,
        `  Tag: ${tag.value}`,
        `  Reason: ${tag.reasons || 'None given'}`,
        `  Added by: ${tag.addedBy || 'Unknown'} | Date: ${tag.when || 'Unknown'}`,
        `  Full text: ${tag.rawTooltip || 'None'}`,
        `  Raw ${tag.source} data: ${JSON.stringify(raw)}`
    ];
    return `${lines.join('\n')}\n\n`;
}

function entryKey(player, source, label) {
    return [player, source, label].join('|').toLowerCase();
}

// Rebuild the logged keys from entry headers such as
// "[2026-09-17 18:41:32] SERAPH | Legit Sniper | nick (real: name)".
function loggedKeysFromLog(text = '') {
    const keys = new Set();
    for (const match of String(text).matchAll(/^\[[^\]]*\] (\S+) \| (.+?) \| (\S+)(?: \(real: (\S+)\))?\s*$/gm)) {
        keys.add(entryKey(match[4] || match[3], match[1], match[2]));
    }
    return keys;
}

function createTagTracker({ filePath, now = () => new Date(), appendFile = fs.appendFile, mkdir = fs.mkdir, readFile = fs.readFileSync, logger = console } = {}) {
    if (!filePath) throw new Error('createTagTracker requires filePath');
    let logged = null;
    let writeQueue = Promise.resolve();

    function loggedKeys() {
        if (logged) return logged;
        try {
            logged = loggedKeysFromLog(readFile(filePath, 'utf8'));
        } catch (error) {
            if (error.code !== 'ENOENT') logger.error(`[TagTracker] Failed to read ${filePath}: ${error.message}`);
            logged = new Set();
        }
        return logged;
    }

    function write(text) {
        writeQueue = writeQueue
            .then(() => new Promise(resolve => mkdir(path.dirname(filePath), { recursive: true }, () => resolve())))
            .then(() => new Promise(resolve => appendFile(filePath, text, 'utf8', (error) => {
                if (error) logger.error(`[TagTracker] Failed to write ${filePath}: ${error.message}`);
                resolve();
            })));
        return writeQueue;
    }

    // Returns the number of new entries written for this player.
    function track({ name, lookupName = '', gameMode = '', team = '', data } = {}) {
        if (!name || !data) return 0;
        const seen = loggedKeys();
        const at = now();
        let text = '';
        let count = 0;
        for (const entry of collectTrackedTags(data)) {
            const key = entryKey(lookupName || name, entry.tag.source, CATEGORY_LABELS[entry.category]);
            if (seen.has(key)) continue;
            seen.add(key);
            text += formatEntry({ at, name, lookupName, gameMode, team, ...entry });
            count++;
        }
        if (text) write(text);
        return count;
    }

    return { track, flush: () => writeQueue };
}

module.exports = { createTagTracker, collectTrackedTags, trackedCategory, loggedKeysFromLog };
