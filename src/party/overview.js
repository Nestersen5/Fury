'use strict';

// Pure parsing and classification for the manual /po (Party Overview) command.
// Keeping this separate from the chat renderer makes its safety rules easy to
// test: provider reports, cautions, service notices, nicked accounts, and
// incomplete lookups must never be conflated with a clean player.

const { stripAnsi } = require('../../features/minecraft_chat.js');
const { isUrchinRequestFailed, urchinStatusMessage } = require('../stats/urchin.js');
const { isUrchinDeveloperNotice } = require('../stats/urchinNotice.js');
const { parseOverlayUrchinTag, parseOverlaySeraphTag } = require('../overlay/tags.js');

const CAUTION_WARNING = 'THIS TAG DOES NOT MEAN THE PLAYER IS CHEATING!';

function cleanText(value) {
    return stripAnsi(String(value || '')).replace(/\r/g, '').trim();
}

function detailAfterMetadata(tooltip, metaText = '') {
    const full = cleanText(tooltip);
    const index = metaText ? full.indexOf(metaText) : -1;
    const tail = index >= 0 ? full.slice(index + metaText.length) : full;
    return tail.replace(/^\s*[-:\u2014]\s*/, '').trim() || 'No reason was provided.';
}

function parseUrchinTag(rawTag = {}) {
    const tooltip = cleanText(rawTag.tooltip);
    const parsed = parseOverlayUrchinTag(rawTag);
    if (!parsed || !tooltip || !/added by/i.test(tooltip)) return null;
    const serviceNotice = isUrchinDeveloperNotice(tooltip);
    const caution = !serviceNotice && tooltip.includes(CAUTION_WARNING);

    return {
        source: 'Urchin',
        kind: serviceNotice ? 'service_notice' : (caution ? 'caution' : 'report'),
        value: serviceNotice ? 'Service notice' : (caution ? 'Caution' : parsed.value),
        addedBy: parsed.addedBy,
        when: parsed.when,
        exactReason: parsed.reasons || detailAfterMetadata(tooltip),
        rawTooltip: tooltip
    };
}

function parseUrchinTags(urchin = {}) {
    const seen = new Set();
    const tags = [];
    (Array.isArray(urchin?.rawTags) ? urchin.rawTags : []).forEach((rawTag) => {
        const tag = parseUrchinTag(rawTag);
        if (!tag) return;
        const key = `${tag.kind}:${tag.value}:${tag.addedBy}:${tag.when}:${tag.exactReason}`.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        tags.push(tag);
    });

    if (tags.length === 0 && cleanText(urchin?.tag)) {
        const fallback = cleanText(urchin.tag);
        const serviceNotice = isUrchinDeveloperNotice(fallback);
        const caution = !serviceNotice && fallback.includes(CAUTION_WARNING);
        tags.push({
            source: 'Urchin',
            kind: serviceNotice ? 'service_notice' : (caution ? 'caution' : 'report'),
            value: serviceNotice ? 'Service notice' : (caution ? 'Caution' : fallback),
            addedBy: 'Unknown',
            when: 'Unknown',
            exactReason: fallback,
            rawTooltip: fallback
        });
    }

    return tags;
}

function parseSeraphTag(seraph = {}) {
    const parsed = parseOverlaySeraphTag(seraph);
    if (!parsed) return null;

    return {
        source: 'Seraph',
        kind: 'report',
        value: parsed.value,
        addedBy: parsed.addedBy,
        when: parsed.when,
        exactReason: parsed.reasons || 'No reason was provided.',
        rawTooltip: cleanText(seraph.tooltip)
    };
}

function classifyPartyOverview(profile = {}) {
    const data = profile?.data || profile || {};
    const tags = [
        ...parseUrchinTags(data.urchin),
        parseSeraphTag(data.seraph)
    ].filter(Boolean);
    const reports = tags.filter(tag => tag.kind === 'report');
    const cautions = tags.filter(tag => tag.kind === 'caution');
    const notices = tags.filter(tag => tag.kind === 'service_notice');

    if (data.lookupFailed || profile?.error) {
        return {
            state: 'unknown',
            label: 'Lookup unavailable',
            reason: data.lookupErrorMessage || profile?.message || 'Player lookup failed.',
            tags,
            reports,
            cautions,
            notices
        };
    }
    if (data.isNicked) {
        return {
            state: 'nicked',
            label: 'Nicked / unresolved',
            reason: 'The displayed name could not be resolved to a public Minecraft profile.',
            tags,
            reports,
            cautions,
            notices
        };
    }
    if (isUrchinRequestFailed(data.urchin)) {
        return {
            state: 'unknown',
            label: 'Tag status unknown',
            reason: urchinStatusMessage(data.urchin),
            tags,
            reports,
            cautions,
            notices
        };
    }
    if (reports.length) {
        return { state: 'flagged', label: 'Provider report', reason: '', tags, reports, cautions, notices };
    }
    if (cautions.length) {
        return { state: 'caution', label: 'Caution', reason: cautions[0].exactReason, tags, reports, cautions, notices };
    }
    if (notices.length) {
        return {
            state: 'notice',
            label: 'Tag service notice',
            reason: notices[0].exactReason,
            tags,
            reports,
            cautions,
            notices
        };
    }
    return { state: 'clear', label: 'No known reports', reason: '', tags, reports, cautions, notices };
}

function summarizePartyOverview(results = []) {
    const totals = { flagged: 0, caution: 0, clear: 0, nicked: 0, unknown: 0, notice: 0 };
    results.forEach((result) => {
        const state = result?.verdict?.state;
        if (Object.prototype.hasOwnProperty.call(totals, state)) totals[state] += 1;
    });
    return totals;
}

module.exports = {
    CAUTION_WARNING,
    cleanText,
    parseUrchinTag,
    parseUrchinTags,
    parseSeraphTag,
    classifyPartyOverview,
    summarizePartyOverview
};
