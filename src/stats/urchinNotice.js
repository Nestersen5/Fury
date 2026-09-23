'use strict';

// Detects the Urchin API "developer notice" that the service attaches to
// lookups as a Caution tag. It is NOT a report against the player - it is a
// message to operators of this proxy - so features like auto-dodge must not
// treat a player carrying only this tag as tag-worthy.
//
// Example tooltip text:
//   Caution (Added by Unknown 2026-07-22) - Notice for the developer of this
//   service: the Urchin API is deprecated and shuts down on July 31. Blacklist
//   tags are no longer being updated. Migrate to the new API - docs:
//   https://api.urchin.gg
//
// Matching is fuzzy (~95%) so small wording/date changes still match: we
// normalize away the "(Added by ...)" metadata and punctuation, then compare
// with a bigram Dice coefficient, backed by a keyword guard that is on its own
// enough to recognize the notice even if the wording drifts.

const { stripAnsi } = require('../../features/minecraft_chat.js');

const URCHIN_DEVELOPER_NOTICE = 'Notice for the developer of this service: the Urchin API is deprecated and shuts down on July 31. Blacklist tags are no longer being updated. Migrate to the new API - docs: https://api.urchin.gg';

const SIMILARITY_THRESHOLD = 0.9;

function normalizeNotice(text) {
    return stripAnsi(String(text || ''))
        .toLowerCase()
        // Drop the volatile "(added by <user> <date>)" metadata block.
        .replace(/\(\s*added by[^)]*\)/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function bigramCounts(value) {
    const counts = new Map();
    for (let i = 0; i < value.length - 1; i += 1) {
        const gram = value.slice(i, i + 2);
        counts.set(gram, (counts.get(gram) || 0) + 1);
    }
    return counts;
}

// Sørensen–Dice coefficient over character bigrams: 0 (disjoint) .. 1 (equal).
function diceCoefficient(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const aCounts = bigramCounts(a);
    const bCounts = bigramCounts(b);
    let overlap = 0;
    let total = 0;
    for (const [gram, count] of aCounts) {
        total += count;
        if (bCounts.has(gram)) overlap += Math.min(count, bCounts.get(gram));
    }
    for (const [, count] of bCounts) total += count;
    return total === 0 ? 0 : (2 * overlap) / total;
}

const NORMALIZED_NOTICE = normalizeNotice(URCHIN_DEVELOPER_NOTICE);

// Strong keyword guard: the notice always names the Urchin API alongside a
// deprecation/migration cue. Genuine cheat tags never do.
function hasNoticeKeywords(normalized) {
    if (!normalized.includes('urchin')) return false;
    return normalized.includes('deprecat')
        || normalized.includes('shuts down')
        || normalized.includes('migrate to the new api')
        || normalized.includes('api urchin gg');
}

function isUrchinDeveloperNotice(text) {
    const normalized = normalizeNotice(text);
    if (!normalized) return false;
    if (hasNoticeKeywords(normalized)) return true;
    return diceCoefficient(normalized, NORMALIZED_NOTICE) >= SIMILARITY_THRESHOLD;
}

module.exports = {
    URCHIN_DEVELOPER_NOTICE,
    SIMILARITY_THRESHOLD,
    normalizeNotice,
    diceCoefficient,
    isUrchinDeveloperNotice
};
