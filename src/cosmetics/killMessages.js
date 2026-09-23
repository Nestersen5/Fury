'use strict';

// Kill-message pattern store + chat-line detection extracted from proxy.js.
// Pattern signatures, scoring, color hints, and the /km recorder command all
// live here. The detection engine owns the in-memory pattern cache and the
// active capture session; proxy.js wires it once via createKillMessages and
// also exposes parseBedDestroyChat (used inside detectKillMessageOwner) as a
// shared export since it's only consumed here.

const fs = require('fs');
const path = require('path');
const { normalizeCosmeticKey } = require('./catalog.js');

const KILL_MESSAGE_PREVIEW_SLOTS = [
    { key: 'regular', label: 'Regular Kill' },
    { key: 'final', label: 'Final Kill' },
    { key: 'void', label: 'Void Kill' },
    { key: 'fall', label: 'Fall/Fall Damage' },
    { key: 'golem', label: 'Golem Kill' },
    { key: 'bed', label: 'Bed Break' }
];
const KILL_MESSAGE_EXTENDED_PREVIEW_SLOTS = [
    { key: 'regular', label: 'Regular Kill' },
    { key: 'final', label: 'Final Kill' },
    { key: 'void', label: 'Void Kill' },
    { key: 'projectile', label: 'Projectile Kill' },
    { key: 'fall', label: 'Fall/Fall Damage' },
    { key: 'golem', label: 'Golem Kill' },
    { key: 'bed', label: 'Bed Break' }
];
const KILL_MESSAGE_EXTENDED_KEYS = new Set(['glorious', 'triumph']);
const AMBIGUOUS_KILL_MESSAGE_KEYS = new Set(['glorious', 'triumph']);
const KILL_MESSAGE_CAPTURE_TIMEOUT_MS = 90 * 1000;

// Ship only reusable examples; actual preview captures stay in the user's data folder.
const DEFAULT_KILL_MESSAGE_PATTERNS = Object.freeze(
    require('../../assets/kill-message-patterns.json').map(pattern => Object.freeze({
        ...pattern,
        lines: Object.freeze([...pattern.lines])
    }))
);

const KILL_MESSAGE_TEMPLATE_TOKENS = new Set([
    'victim', 'killer', 'team', 'num',
    'player', 'was', 'by', 'for', 'from', 'with', 'into', 'the', 'a', 'an',
    'bed', 'final', 'golem', 'void', 'edge', 'ground', 'down', 'up', 'off',
    '<victim>', '<killer>', '<team>', '#<num>', '<num>'
]);

function killMessagePreviewSlots(nameOrKey = '') {
    const key = normalizeCosmeticKey(nameOrKey);
    return KILL_MESSAGE_EXTENDED_KEYS.has(key)
        ? KILL_MESSAGE_EXTENDED_PREVIEW_SLOTS
        : KILL_MESSAGE_PREVIEW_SLOTS;
}

function blankKillMessagePatternStore() {
    return {
        version: 1,
        updatedAt: null,
        slots: KILL_MESSAGE_EXTENDED_PREVIEW_SLOTS,
        patterns: {}
    };
}

function killMessageSignatureTokens(signature) {
    return String(signature || '')
        .toLowerCase()
        .match(/[a-z0-9_<#>]+/g) || [];
}

function killMessageDistinctiveTokens(signature) {
    return killMessageSignatureTokens(signature)
        .map(token => token.replace(/[<>#]/g, ''))
        .filter(token => token && !KILL_MESSAGE_TEMPLATE_TOKENS.has(token));
}

function tokenSetOverlapScore(aTokens = [], bTokens = []) {
    const aSet = new Set(aTokens);
    const bSet = new Set(bTokens);
    if (!aSet.size || !bSet.size) return 0;
    let overlap = 0;
    aSet.forEach(token => {
        if (bSet.has(token)) overlap += 1;
    });
    return overlap / Math.max(aSet.size, bSet.size);
}

function killMessageSignatureScore(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const structureScore = tokenSetOverlapScore(killMessageSignatureTokens(a), killMessageSignatureTokens(b));
    const distinctiveScore = tokenSetOverlapScore(killMessageDistinctiveTokens(a), killMessageDistinctiveTokens(b));
    if (!distinctiveScore) return Math.min(structureScore, 0.58);
    return (structureScore * 0.35) + (distinctiveScore * 0.65);
}

function killMessageScoreThreshold(signature = '') {
    const distinctiveCount = killMessageDistinctiveTokens(signature).length;
    if (distinctiveCount <= 1) return 0.92;
    if (distinctiveCount === 2) return 0.86;
    return 0.82;
}

function isAmbiguousKillMessageCandidate(best, candidates = []) {
    if (!best) return true;
    const closeMargin = AMBIGUOUS_KILL_MESSAGE_KEYS.has(best.key) ? 0.12 : 0.08;
    return candidates.some(candidate =>
        candidate.key !== best.key
        && candidate.score >= Math.max(0.74, best.score - closeMargin)
    );
}

function formattedMinecraftChars(text) {
    const chars = [];
    let color = '';
    const raw = String(text || '');
    for (let i = 0; i < raw.length; i += 1) {
        const char = raw[i];
        if (char === '§' && i + 1 < raw.length) {
            const code = `§${String(raw[i + 1]).toLowerCase()}`;
            if (/^§[0-9a-f]$/.test(code)) color = code;
            i += 1;
            continue;
        }
        chars.push({ char, color });
    }
    return chars;
}

function minecraftWordHasColor(formattedText, word, allowedColors = []) {
    const chars = formattedMinecraftChars(formattedText);
    if (!chars.length) return false;
    const plain = chars.map(entry => entry.char).join('').toLowerCase();
    const target = String(word || '').toLowerCase();
    if (!target) return false;
    let index = plain.indexOf(target);
    while (index !== -1) {
        const before = index === 0 ? '' : plain[index - 1];
        const after = plain[index + target.length] || '';
        const bounded = !/[a-z0-9_]/i.test(before) && !/[a-z0-9_]/i.test(after);
        if (bounded && allowedColors.includes(chars[index]?.color)) return true;
        index = plain.indexOf(target, index + target.length);
    }
    return false;
}

function detectKillMessageColorHint(formattedText) {
    if (!String(formattedText || '').includes('§')) return null;
    if (minecraftWordHasColor(formattedText, 'stomped', ['§6'])
        || minecraftWordHasColor(formattedText, 'outclassed', ['§6'])
        || minecraftWordHasColor(formattedText, 'shot', ['§6'])) {
        return {
            key: 'glorious',
            name: 'Glorious',
            score: 0.98,
            label: 'Color Hint',
            slot: 'color',
            colorHint: true
        };
    }
    if (minecraftWordHasColor(formattedText, 'bested', ['§e'])
        || minecraftWordHasColor(formattedText, 'shot', ['§e'])) {
        return {
            key: 'triumph',
            name: 'Triumph',
            score: 0.98,
            label: 'Color Hint',
            slot: 'color',
            colorHint: true
        };
    }
    return null;
}

function createKillMessages({
    sendChat,
    stripAnsi,
    killMessagePatternsFile,
    getDenickKillMessageNames,
    denickCosmeticApiValue
}) {
    let activeKillMessageCapture = null;
    let killMessagePatternStoreCache = null;
    let killMessagePatternStoreCacheMtimeMs = -1;
    const defaultPatterns = Object.fromEntries(DEFAULT_KILL_MESSAGE_PATTERNS.map(pattern => {
        const entry = buildKillMessagePatternEntry(pattern, null);
        entry.samples.forEach(Object.freeze);
        Object.freeze(entry.samples);
        return [entry.key, Object.freeze(entry)];
    }));
    Object.freeze(defaultPatterns);

    function killMessagePatternSignature(text) {
        return stripAnsi(text || '')
            .replace(/\r/g, '')
            .replace(/^\s*(?:BED\s+DESTRUCTION\s*>\s*)?(?:Your|Red|Blue|Green|Yellow|Aqua|White|Pink|Gray|Grey)\s+Bed\b/i, '<team> Bed')
            .replace(/^\s*([A-Za-z0-9_]{3,16})\b/i, '<victim>')
            .replace(/\bby\s+a\s+half-awake\s+([A-Za-z0-9_]{3,16})(?=[.!?]|$)/gi, 'by a half-awake <killer>')
            .replace(/\bby\s+([A-Za-z0-9_]{3,16})'s\s+Golem\b/gi, 'by <killer>\'s Golem')
            .replace(/\bby\s+([A-Za-z0-9_]{3,16})\b/gi, 'by <killer>')
            .replace(/\bfor\s+([A-Za-z0-9_]{3,16})\b/gi, 'for <killer>')
            .replace(/\bfrom\s+([A-Za-z0-9_]{3,16})\b/gi, 'from <killer>')
            .replace(/\b(of|against|fighting|seeing|meet|to|with)\s+([A-Za-z0-9_]{3,16})(?=[.!?]|$)/gi, '$1 <killer>')
            .replace(/\b([A-Za-z0-9_]{3,16})'s\s+final\b/gi, '<killer>\'s final')
            .replace(/\b([A-Za-z0-9_]{3,16})'s\s+Golem\b/gi, '<killer>\'s Golem')
            .replace(/\bFINAL KILL!?\b/gi, '')
            .replace(/#[\d,]+/g, '#<num>')
            .replace(/\b\d[\d,]*(?:\.\d+)?\b/g, '<num>')
            .replace(/\b(red|blue|green|yellow|aqua|white|pink|gray|grey)\b/gi, '<team>')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function normalizeKillMessagePatternStore(raw = {}) {
        const blank = blankKillMessagePatternStore();
        const patterns = raw?.patterns && typeof raw.patterns === 'object' ? raw.patterns : {};
        const nextPatterns = {};

        Object.entries(patterns).forEach(([key, entry]) => {
            if (!entry || typeof entry !== 'object') return;
            const slots = killMessagePreviewSlots(entry.name || entry.key || key);
            const samples = Array.isArray(entry.samples) ? entry.samples : [];
            nextPatterns[key] = {
                key: entry.key || key,
                name: entry.name || key,
                apiValue: entry.apiValue || null,
                updatedAt: entry.updatedAt || null,
                samples: samples
                    .filter(sample => sample && typeof sample === 'object' && sample.text)
                    .slice(0, slots.length)
                    .map((sample, index) => {
                        const slot = slots[index] || {};
                        const text = String(sample.text || '').trim();
                        return {
                            slot: sample.slot || slot.key || `sample_${index + 1}`,
                            label: sample.label || slot.label || `Sample ${index + 1}`,
                            text,
                            signature: killMessagePatternSignature(text),
                            recordedAt: sample.recordedAt || entry.updatedAt || null
                        };
                    })
            };
        });

        return {
            ...blank,
            updatedAt: raw?.updatedAt || null,
            patterns: nextPatterns
        };
    }

    function loadKillMessagePatternStore() {
        try {
            if (!fs.existsSync(killMessagePatternsFile)) {
                killMessagePatternStoreCache = withDefaultPatterns(blankKillMessagePatternStore());
                killMessagePatternStoreCacheMtimeMs = -1;
                return killMessagePatternStoreCache;
            }
            const stat = fs.statSync(killMessagePatternsFile);
            if (killMessagePatternStoreCache && killMessagePatternStoreCacheMtimeMs === stat.mtimeMs) {
                return killMessagePatternStoreCache;
            }
            killMessagePatternStoreCache = withDefaultPatterns(normalizeKillMessagePatternStore(JSON.parse(fs.readFileSync(killMessagePatternsFile, 'utf8'))));
            killMessagePatternStoreCacheMtimeMs = stat.mtimeMs;
            return killMessagePatternStoreCache;
        } catch (e) {
            killMessagePatternStoreCache = withDefaultPatterns(blankKillMessagePatternStore());
            killMessagePatternStoreCacheMtimeMs = -1;
            return killMessagePatternStoreCache;
        }
    }

    function withDefaultPatterns(store) {
        return { ...store, patterns: { ...defaultPatterns, ...store.patterns } };
    }

    function isUnchangedDefault(entry) {
        const seed = defaultPatterns[entry.key];
        return seed && entry.name === seed.name && entry.apiValue === seed.apiValue
            && entry.samples.length === seed.samples.length
            && entry.samples.every((sample, index) => {
                const original = seed.samples[index];
                return sample.slot === original.slot && sample.label === original.label && sample.text === original.text;
            });
    }

    function saveKillMessagePatternStore(store) {
        const next = normalizeKillMessagePatternStore(store);
        next.updatedAt = new Date().toISOString();
        const personal = {
            ...next,
            patterns: Object.fromEntries(Object.entries(next.patterns).filter(([, entry]) => !isUnchangedDefault(entry)))
        };
        fs.mkdirSync(path.dirname(killMessagePatternsFile), { recursive: true });
        fs.writeFileSync(killMessagePatternsFile, JSON.stringify(personal, null, 2), 'utf8');
        try {
            killMessagePatternStoreCacheMtimeMs = fs.statSync(killMessagePatternsFile).mtimeMs;
            killMessagePatternStoreCache = withDefaultPatterns(next);
        } catch (e) {
            killMessagePatternStoreCache = withDefaultPatterns(next);
            killMessagePatternStoreCacheMtimeMs = Date.now();
        }
    }

    function buildKillMessagePatternEntry(pattern, recordedAt = new Date().toISOString()) {
        const slots = killMessagePreviewSlots(pattern.name || pattern.key);
        return {
            key: pattern.key || normalizeCosmeticKey(pattern.name),
            name: pattern.name,
            apiValue: pattern.apiValue || null,
            updatedAt: recordedAt,
            samples: (pattern.lines || []).slice(0, slots.length).map((line, index) => {
                const slot = slots[index] || {};
                return {
                    slot: slot.key || `sample_${index + 1}`,
                    label: slot.label || `Sample ${index + 1}`,
                    text: line,
                    signature: killMessagePatternSignature(line),
                    recordedAt
                };
            })
        };
    }

    function ensureDefaultKillMessagePatterns() {
        return loadKillMessagePatternStore();
    }

    function canonicalKillMessageName(rawName) {
        const names = getDenickKillMessageNames();
        const key = normalizeCosmeticKey(rawName);
        return names.find(name => normalizeCosmeticKey(name) === key)
            || (key.endsWith('s') ? names.find(name => normalizeCosmeticKey(name) === key.slice(0, -1)) : null)
            || null;
    }

    function canonicalKillMessageNameFromApiId(value) {
        const raw = String(value || '').trim();
        if (!raw) return null;
        const cleaned = raw
            .replace(/^killmessages?[_\s-]*/i, '')
            .replace(/^killmsg[_\s-]*/i, '')
            .replace(/^active[_\s-]*/i, '')
            .replace(/_/g, ' ');
        return canonicalKillMessageName(cleaned);
    }

    function parseBedDestroyChat(text) {
        const clean = stripAnsi(text || '').replace(/\s+/g, ' ').trim();
        const match = clean.match(/\bBED\s+DESTRUCTION\b.*?\b(Your|Red|Blue|Green|Yellow|Aqua|White|Pink|Gray|Grey)\s+Bed\b([\s\S]*?)\bby\s+([A-Za-z0-9_]{3,16})\b/i);
        if (!match) return null;
        const bedsMatch = String(match[2] || '').match(/\bbed\s+#([\d,]+)/i);
        return {
            type: 'beddestroy',
            team: match[1],
            beds: bedsMatch ? Number(String(bedsMatch[1]).replace(/,/g, '')) || null : null,
            breaker: match[3],
            text: clean
        };
    }

    function detectKillMessageCosmetic(text) {
        const signature = killMessagePatternSignature(text);
        if (!signature) return null;
        const store = loadKillMessagePatternStore();
        const candidates = [];

        Object.values(store.patterns || {}).forEach((entry) => {
            (entry.samples || []).forEach((sample) => {
                const score = killMessageSignatureScore(signature, sample.signature);
                candidates.push({
                    name: entry.name,
                    key: entry.key,
                    apiValue: entry.apiValue || null,
                    slot: sample.slot,
                    label: sample.label,
                    score,
                    sampleText: sample.text
                });
            });
        });

        candidates.sort((a, b) => b.score - a.score);
        const best = candidates[0];
        if (!best || best.score < killMessageScoreThreshold(signature)) return null;

        const tiedDifferentCosmetic = candidates.some(candidate =>
            candidate.key !== best.key && Math.abs(candidate.score - best.score) <= 0.0001
        );
        if (tiedDifferentCosmetic || isAmbiguousKillMessageCandidate(best, candidates)) return null;
        return best;
    }

    function detectKillMessageOwner(text) {
        const clean = stripAnsi(text || '').replace(/\r/g, '').replace(/\s+/g, ' ').trim();
        if (!clean) return '';

        const bed = parseBedDestroyChat(clean);
        if (bed?.breaker) return bed.breaker;

        const byGolem = clean.match(/\bby\s+([A-Za-z0-9_]{3,16})'s\s+Golem\b/i);
        if (byGolem) return byGolem[1];

        const halfAwake = clean.match(/\bby\s+a\s+half-awake\s+([A-Za-z0-9_]{3,16})(?=[.!?]|$)/i);
        if (halfAwake) return halfAwake[1];

        const possessive = clean.match(/\b([A-Za-z0-9_]{3,16})'s\s+(?:final|Golem)\b/i);
        if (possessive) return possessive[1];

        const by = clean.match(/\bby\s+([A-Za-z0-9_]{3,16})\b/i);
        if (by) return by[1];

        const forPlayer = clean.match(/\bfor\s+([A-Za-z0-9_]{3,16})\b/i);
        if (forPlayer) return forPlayer[1];

        const fromPlayer = clean.match(/\bfrom\s+([A-Za-z0-9_]{3,16})\b/i);
        if (fromPlayer) return fromPlayer[1];

        const endingOwner = clean.match(/\b(?:of|against|fighting|seeing|meet|to|with)\s+([A-Za-z0-9_]{3,16})(?=[.!?]|$)/i);
        if (endingOwner) return endingOwner[1];

        return '';
    }

    function detectKillMessageCosmeticFromChat(text, formattedText = text) {
        const detected = detectKillMessageCosmetic(text);
        const colorHint = detectKillMessageColorHint(formattedText);
        let finalDetected = detected;
        if (colorHint && detected && detected.key === colorHint.key) {
            finalDetected = {
                ...detected,
                score: Math.max(Number(detected.score || 0) || 0, colorHint.score),
                colorHint: true,
                colorHintLabel: colorHint.label
            };
        } else if (colorHint && (!detected || AMBIGUOUS_KILL_MESSAGE_KEYS.has(detected.key))) {
            finalDetected = {
                ...colorHint,
                score: Math.max(Number(detected?.score || 0) || 0, colorHint.score),
                colorOnly: true
            };
        }
        if (!finalDetected) return null;
        const owner = detectKillMessageOwner(text);
        if (!owner) return null;
        return { ...finalDetected, owner };
    }

    function sendKillMessageRecorderUsage(client) {
        sendChat(client, '§6§lKill Message Recorder');
        sendChat(client, '§6/km <kill message name> §7- record the next Hypixel Chat Messages preview');
        sendChat(client, '§6/km list §7- show supported kill message names');
        sendChat(client, '§6/km saved §7- show recorded kill message mappings');
        sendChat(client, '§6/km test <chat line> §7- test a saved pattern against a message');
        sendChat(client, '§6/km status §7- show the current recorder state');
        sendChat(client, '§6/km cancel §7- cancel the active recorder');
    }

    function sendKillMessageNameList(client) {
        const names = getDenickKillMessageNames();
        sendChat(client, '§6§lSupported Kill Messages');
        for (let i = 0; i < names.length; i += 4) {
            sendChat(client, `§7- §f${names.slice(i, i + 4).join('§7, §f')}`);
        }
    }

    function sendSavedKillMessagePatterns(client) {
        const store = loadKillMessagePatternStore();
        const entries = Object.values(store.patterns || {})
            .filter(entry => entry?.name)
            .sort((a, b) => String(a.name).localeCompare(String(b.name)));

        if (!entries.length) {
            sendChat(client, '§6[KM] §7No kill message previews saved yet.');
            return;
        }

        sendChat(client, `§6[KM] §7Saved kill message previews: §f${entries.length}`);
        entries.forEach(entry => {
            const slots = killMessagePreviewSlots(entry.name || entry.key);
            const sampleCount = Array.isArray(entry.samples) ? entry.samples.length : 0;
            sendChat(client, `§7- §f${entry.name} §8(${sampleCount}/${slots.length}) §8${entry.apiValue || ''}`);
        });
    }

    function finalizeKillMessageCapture(capture) {
        if (!capture || !capture.client) return;
        if (capture.timer) clearTimeout(capture.timer);

        const now = new Date().toISOString();
        const store = loadKillMessagePatternStore();
        const slots = killMessagePreviewSlots(capture.name || capture.key);
        store.patterns[capture.key] = {
            key: capture.key,
            name: capture.name,
            apiValue: denickCosmeticApiValue('killmessage', capture.name),
            updatedAt: now,
            samples: capture.lines.slice(0, slots.length).map((line, index) => {
                const slot = slots[index];
                return {
                    slot: slot.key,
                    label: slot.label,
                    text: line,
                    signature: killMessagePatternSignature(line),
                    recordedAt: now
                };
            })
        };
        saveKillMessagePatternStore(store);
        activeKillMessageCapture = null;

        sendChat(capture.client, `§6[KM] §aSaved §f${capture.name} §akill message preview.`);
        store.patterns[capture.key].samples.forEach(sample => {
            sendChat(capture.client, `§8- §7${sample.label}: §f${sample.text}`);
        });
    }

    function clearKillMessageCaptureForClient(client, announce = false) {
        if (!activeKillMessageCapture || activeKillMessageCapture.client !== client) return;
        if (activeKillMessageCapture.timer) clearTimeout(activeKillMessageCapture.timer);
        const name = activeKillMessageCapture.name;
        activeKillMessageCapture = null;
        if (announce) sendChat(client, `§6[KM] §cCancelled recorder for §f${name}§c.`);
    }

    function observeKillMessagePreviewChat(client, text) {
        const capture = activeKillMessageCapture;
        if (!capture || capture.client !== client) return false;

        const clean = stripAnsi(text || '').replace(/\r/g, '').replace(/\s+/g, ' ').trim();
        const isHeader = /^Chat Messages:?$/i.test(clean);

        if (capture.stage === 'waiting_header') {
            if (!isHeader) return false;
            capture.stage = 'collecting';
            capture.headerAt = Date.now();
            capture.lines = [];
            sendChat(client, `§6[KM] §aFound Chat Messages preview. Capturing ${capture.expectedLines} lines...`);
            return true;
        }

        if (capture.stage !== 'collecting') return false;
        if (isHeader) {
            capture.lines = [];
            capture.headerAt = Date.now();
            return true;
        }
        if (!clean) return true;

        const previous = capture.lines[capture.lines.length - 1];
        if (previous !== clean) capture.lines.push(clean);

        if (capture.lines.length >= capture.expectedLines) {
            finalizeKillMessageCapture(capture);
        }

        return true;
    }

    function handleKillMessageRecorderCommand(client, args) {
        const sub = String(args[1] || '').toLowerCase();
        if (!sub || sub === 'help') {
            sendKillMessageRecorderUsage(client);
            return;
        }
        if (sub === 'list') {
            sendKillMessageNameList(client);
            return;
        }
        if (sub === 'saved' || sub === 'patterns') {
            sendSavedKillMessagePatterns(client);
            return;
        }
        if (sub === 'test') {
            const text = args.slice(2).join(' ').trim();
            if (!text) {
                sendChat(client, '§cUsage: §e/km test <chat line>');
                return;
            }
            const detected = detectKillMessageCosmetic(text);
            if (!detected) {
                sendChat(client, '§6[KM] §7No saved kill message pattern matched that line.');
                return;
            }
            sendChat(client, `§6[KM] §aMatched §f${detected.name} §8(${detected.label}, ${Math.round(detected.score * 100)}%)`);
            sendChat(client, `§8Sample: §7${detected.sampleText}`);
            return;
        }
        if (sub === 'status') {
            if (!activeKillMessageCapture || activeKillMessageCapture.client !== client) {
                sendChat(client, '§6[KM] §7No active kill message recorder.');
                sendSavedKillMessagePatterns(client);
                return;
            }
            sendChat(client, `§6[KM] §7Recording §f${activeKillMessageCapture.name}§7: §e${activeKillMessageCapture.stage} §8(${activeKillMessageCapture.lines.length}/${activeKillMessageCapture.expectedLines})`);
            return;
        }
        if (sub === 'cancel' || sub === 'stop') {
            clearKillMessageCaptureForClient(client, true);
            return;
        }

        const rawName = args.slice(1).join(' ').trim();
        const name = canonicalKillMessageName(rawName);
        if (!name) {
            sendChat(client, `§c[KM] Unknown kill message: §f${rawName}`);
            sendChat(client, '§7Use §e/km list §7to see supported names.');
            return;
        }

        clearKillMessageCaptureForClient(client, false);
        const capture = {
            client,
            name,
            key: normalizeCosmeticKey(name),
            stage: 'waiting_header',
            expectedLines: killMessagePreviewSlots(name).length,
            lines: [],
            startedAt: Date.now(),
            timer: null
        };
        capture.timer = setTimeout(() => {
            if (activeKillMessageCapture !== capture) return;
            activeKillMessageCapture = null;
            sendChat(client, `§6[KM] §cRecorder for §f${name} §cexpired. Run §e/km ${name} §cagain.`);
        }, KILL_MESSAGE_CAPTURE_TIMEOUT_MS);
        activeKillMessageCapture = capture;

        sendChat(client, `§6[KM] §aArmed recorder for §f${name}§a.`);
        sendChat(client, '§7Open/show the Hypixel kill message preview now. I will start when chat says §eChat Messages:§7.');
    }

    return {
        killMessagePatternSignature,
        loadKillMessagePatternStore,
        saveKillMessagePatternStore,
        ensureDefaultKillMessagePatterns,
        canonicalKillMessageName,
        canonicalKillMessageNameFromApiId,
        parseBedDestroyChat,
        detectKillMessageCosmetic,
        detectKillMessageOwner,
        detectKillMessageCosmeticFromChat,
        sendKillMessageRecorderUsage,
        sendKillMessageNameList,
        sendSavedKillMessagePatterns,
        finalizeKillMessageCapture,
        clearKillMessageCaptureForClient,
        observeKillMessagePreviewChat,
        handleKillMessageRecorderCommand
    };
}

module.exports = {
    KILL_MESSAGE_PREVIEW_SLOTS,
    KILL_MESSAGE_EXTENDED_PREVIEW_SLOTS,
    KILL_MESSAGE_EXTENDED_KEYS,
    AMBIGUOUS_KILL_MESSAGE_KEYS,
    KILL_MESSAGE_CAPTURE_TIMEOUT_MS,
    DEFAULT_KILL_MESSAGE_PATTERNS,
    KILL_MESSAGE_TEMPLATE_TOKENS,
    killMessagePreviewSlots,
    blankKillMessagePatternStore,
    killMessageSignatureTokens,
    killMessageDistinctiveTokens,
    tokenSetOverlapScore,
    killMessageSignatureScore,
    killMessageScoreThreshold,
    isAmbiguousKillMessageCandidate,
    formattedMinecraftChars,
    minecraftWordHasColor,
    detectKillMessageColorHint,
    createKillMessages
};
