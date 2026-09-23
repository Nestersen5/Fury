'use strict';

// Tag parsing for the live overlay panel: turn raw Urchin/Seraph tag
// payloads (which proxy.js already shapes via src/stats/urchin.js +
// the seraph helpers) into a normalized {source, title, value,
// addedBy, reasons, when, rawTooltip} row, and assemble them into a
// per-player tag list with deduping. compactTagName lives in
// proxy.js, so it's injected via createOverlayTagBuilder.

const { stripAnsi, getHypixelRankNameColor } = require('../../features/minecraft_chat.js');
const {
    isUrchinRequestFailed,
    shortUrchinStatusLabel,
    urchinStatusMessage
} = require('../stats/urchin.js');
const { formatNametagTagValue, nametagTagCategory, stripNametagIconGlyphs } = require('./nametags.js');

function cleanOverlayTagText(value = '') {
    return stripNametagIconGlyphs(stripAnsi(String(value || '')))
        .replace(/\r/g, '')
        .trim();
}

function firstTagValue(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null && String(value).trim()) return value;
    }
    return '';
}

function formatOverlayTagTimestamp(value) {
    if (value === undefined || value === null || String(value).trim() === '') return 'Unknown';
    const number = Number(value);
    if (Number.isFinite(number)) {
        const milliseconds = Math.abs(number) < 1e12 ? number * 1000 : number;
        const date = new Date(milliseconds);
        if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
    }
    return String(value).trim();
}

function parseUrchinMetadata(rawTooltip) {
    // Urchin has emitted both "Added by user date" and
    // "Added by user. date" forms. Split the username from the date rather
    // than requiring one exact punctuation style.
    const match = String(rawTooltip || '').match(/\(\s*Added\s+by\s+(.+?)\s*\)/i);
    if (!match) return { match: null, addedBy: 'Unknown', when: 'Unknown' };

    const metadata = match[1].replace(/\s+/g, ' ').trim();
    const parts = metadata.match(/^([A-Za-z0-9_]+)(?:[.,])?(?:\s+(.+))?$/);
    return {
        match,
        addedBy: parts?.[1] || metadata || 'Unknown',
        when: parts?.[2]?.trim() || 'Unknown'
    };
}

function reasonAfterUrchinMetadata(rawTooltip, metadataMatch) {
    if (!metadataMatch) return '';
    return String(rawTooltip || '')
        .slice(metadataMatch.index + metadataMatch[0].length)
        .replace(/^\s*[-:\u2014]\s*/, '')
        .replace(/THIS TAG DOES NOT MEAN THE PLAYER IS CHEATING!/ig, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function displayOverlayTagValue(value = '') {
    const raw = String(value || '');
    const hadIcon = stripNametagIconGlyphs(raw) !== raw;
    if (hadIcon && nametagTagCategory(raw)) {
        return stripAnsi(formatNametagTagValue(raw, { tagDisplayMode: 'full' }));
    }
    return stripNametagIconGlyphs(raw);
}

// The name colour Hypixel would render this player in. Delegates to the
// shared resolver so YouTube and staff ranks, and an MVP++ who picked the
// AQUA monthly colour, all colour the same here as they do in chat.
function getOverlayRankNameColor(player = {}) {
    return getHypixelRankNameColor(player);
}

function parseOverlayUrchinTag(rawTag = {}) {
    const rawTooltip = cleanOverlayTagText(rawTag.tooltip);
    const structuredType = firstTagValue(rawTag.text, rawTag.type, rawTag.tag_type, rawTag.tag, rawTag.name, rawTag.category);
    const structuredReason = cleanOverlayTagText(firstTagValue(rawTag.reason, rawTag.notes, rawTag.description));
    const structuredAddedBy = rawTag.hide_username
        ? 'Hidden'
        : firstTagValue(rawTag.added_by_username, rawTag.added_by_name, rawTag.added_by, rawTag.user);
    const structuredWhen = formatOverlayTagTimestamp(firstTagValue(
        rawTag.added_on,
        rawTag.addedAt,
        rawTag.created_at,
        rawTag.createdAt
    ));
    if (!rawTooltip && !structuredType && !structuredReason) return null;

    let tagName = 'Urchin Tag';
    let addedBy = structuredAddedBy || 'Unknown';
    let when = structuredWhen;
    let reasons = structuredReason || 'No specific cheats listed';

    if (rawTooltip.includes('THIS TAG DOES NOT MEAN THE PLAYER IS CHEATING!')) {
        tagName = 'Caution';
        reasons = 'Replays needed';
    } else if (rawTooltip) {
        tagName = rawTooltip.split('(')[0].trim().replace(/[\[\]]/g, '') || tagName;
    } else {
        tagName = String(structuredType || tagName).replace(/[\[\]]/g, '').trim() || tagName;
    }

    const metadata = parseUrchinMetadata(rawTooltip);
    if (metadata.match) {
        addedBy = metadata.addedBy;
        when = metadata.when;
        reasons = reasonAfterUrchinMetadata(rawTooltip, metadata.match) || reasons;
    }

    return {
        source: 'Urchin',
        title: 'Urchin Report',
        value: displayOverlayTagValue(tagName),
        addedBy: cleanOverlayTagText(addedBy) || 'Unknown',
        reasons: cleanOverlayTagText(reasons),
        when,
        rawTooltip: rawTooltip || cleanOverlayTagText(`${tagName}: ${reasons}`)
    };
}

function parseOverlaySeraphTag(seraphData = {}) {
    if (!seraphData?.tagged) return null;
    const rawTooltip = cleanOverlayTagText(seraphData.tooltip);
    const structuredReason = cleanOverlayTagText(firstTagValue(seraphData.reason, seraphData.notes, seraphData.description));
    const structuredAddedBy = seraphData.hide_username
        ? 'Hidden'
        : firstTagValue(seraphData.added_by_username, seraphData.added_by_name, seraphData.added_by, seraphData.user);
    const structuredWhen = formatOverlayTagTimestamp(firstTagValue(
        seraphData.timestamp,
        seraphData.added_on,
        seraphData.addedAt,
        seraphData.created_at,
        seraphData.createdAt
    ));
    let tagName = cleanOverlayTagText(seraphData.report_type) || 'Seraph';
    let addedBy = structuredAddedBy || 'Unknown';
    let when = structuredWhen;
    let reasons = structuredReason || rawTooltip || 'No details';

    // The final parenthetical is the attribution only when it contains
    // "by". This keeps an intermediate marker such as "(Upgraded)" out of
    // the metadata fields when Seraph includes both parentheticals.
    const metadataMatch = rawTooltip.match(/\(([^()]*(?:\bby\b)[^()]*)\)\s*$/i);
    const body = metadataMatch ? rawTooltip.slice(0, metadataMatch.index).trim() : rawTooltip;
    const colon = body.indexOf(':');
    if (colon >= 0) {
        tagName = body.slice(0, colon).trim() || tagName;
        reasons = body.slice(colon + 1).trim() || reasons;
    }

    if (metadataMatch) {
        const metadata = metadataMatch[1].replace(/\s+/g, ' ').trim();
        const byMatch = metadata.match(/\bby\s+(.+?)\s*$/i);
        if (byMatch?.[1]) {
            addedBy = byMatch[1].trim();
            when = metadata.slice(0, byMatch.index).trim() || when;
        }
    }

    return {
        source: 'Seraph',
        title: 'Seraph Blacklist',
        value: displayOverlayTagValue(tagName),
        addedBy: cleanOverlayTagText(addedBy) || 'Unknown',
        reasons: cleanOverlayTagText(reasons),
        when,
        rawTooltip
    };
}

function createOverlayTagBuilder({ compactTagName } = {}) {
    if (typeof compactTagName !== 'function') {
        throw new Error('createOverlayTagBuilder requires compactTagName');
    }

    function buildOverlayTags(data = {}) {
        const tags = [];
        const seen = new Set();
        const add = (tag) => {
            if (!tag?.value) return;
            const key = `${tag.source}:${tag.value}:${tag.addedBy}:${tag.reasons}:${tag.when}`.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            tags.push(tag);
        };

        (data.urchin?.rawTags || []).forEach(tag => add(parseOverlayUrchinTag(tag)));
        if (!tags.some(tag => tag.source === 'Urchin') && data.urchin?.tag) {
            add(parseOverlayUrchinTag({ tooltip: data.urchin.tag }) || {
                source: 'Urchin',
                title: 'Urchin Report',
                value: displayOverlayTagValue(data.urchin.tag),
                addedBy: 'Unknown',
                reasons: 'No detailed tooltip available',
                when: 'Unknown',
                rawTooltip: cleanOverlayTagText(data.urchin.tag)
            });
        }
        if (isUrchinRequestFailed(data.urchin)) {
            add({
                source: 'Urchin',
                title: 'Urchin API Status',
                value: `API ${shortUrchinStatusLabel(data.urchin)}`,
                addedBy: 'Status check',
                reasons: urchinStatusMessage(data.urchin),
                when: 'Tags unknown',
                rawTooltip: `${urchinStatusMessage(data.urchin)}. This does not mean the player is clean.`
            });
        }

        add(parseOverlaySeraphTag(data.seraph));
        return tags;
    }

    return { buildOverlayTags };
}

module.exports = {
    getOverlayRankNameColor,
    parseOverlayUrchinTag,
    parseOverlaySeraphTag,
    createOverlayTagBuilder
};
