'use strict';

// Pure shapers, parsers, and status helpers for Urchin tag data. The
// fetcher/cache wiring lives in features/urchin_client.js; this module
// owns the data shape + tag normalization that both sides share. The
// outage chat warning is exposed via createUrchinOutageNotifier because
// it needs a once-per-session flag plus access to the active user's
// client and the sendChat helper.

const { stripAnsi } = require('../../features/minecraft_chat.js');

function makeUrchinData(overrides = {}) {
    return {
        tag: '',
        rawTags: [],
        ok: null,
        requestStatus: 'not_checked',
        error: '',
        hasTag: false,
        ...overrides
    };
}

function classifyUrchinRequestError(error) {
    const status = error?.response?.status;
    const body = error?.response?.data;
    const bodyText = typeof body === 'string'
        ? body
        : [body?.cause, body?.reason, body?.message, body?.error, JSON.stringify(body || {})].filter(Boolean).join(' ');
    const clean = String(bodyText || '').toLowerCase();

    if (status === 401 || status === 403 || clean.includes('invalid') || clean.includes('unauthorized') || clean.includes('forbidden') || clean.includes('api key')) {
        return { requestStatus: 'invalid_key', error: 'Urchin API key is invalid or missing access.' };
    }
    if (status === 429) {
        return { requestStatus: 'rate_limited', error: 'Urchin API is rate limited.' };
    }
    if (error?.code === 'ECONNABORTED' || clean.includes('timeout')) {
        return { requestStatus: 'timeout', error: 'Urchin API request timed out.' };
    }
    if (status >= 500) {
        return { requestStatus: 'api_error', error: 'Urchin API is unavailable.' };
    }
    if (!error?.response) {
        return { requestStatus: 'network_error', error: 'Urchin API network request failed.' };
    }
    return { requestStatus: 'failed', error: 'Urchin API request failed.' };
}

function parseUrchinCubelifyTags(tags) {
    const rawTags = Array.isArray(tags) ? tags : [];
    const data = makeUrchinData({
        ok: true,
        requestStatus: 'ok',
        rawTags
    });

    rawTags.forEach(obj => {
        if (obj.tooltip && obj.tooltip.toLowerCase().includes('added by')) {
            data.tag = obj.tooltip.split('(')[0].trim().replace(/[\[\]]/g, '');
        }
    });

    data.hasTag = Boolean(data.tag || rawTags.some(obj => obj.tooltip?.toLowerCase().includes('added by')));
    return data;
}

function titleCaseUrchinTagType(type = '') {
    return String(type || 'Urchin Tag')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, char => char.toUpperCase()) || 'Urchin Tag';
}

function formatUrchinBatchDate(value) {
    if (!value) return 'Unknown';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toISOString().slice(0, 10);
}

function normalizeUrchinBatchTag(tag = {}) {
    const type = titleCaseUrchinTagType(tag.type || tag.tag_type || tag.tag || tag.name || tag.category);
    const reason = String(tag.reason || tag.notes || tag.description || 'No reason listed').trim();
    const addedBy = tag.hide_username
        ? 'Hidden'
        : (tag.added_by_username || tag.added_by_name || tag.added_by || tag.user || 'Unknown');
    const addedOn = formatUrchinBatchDate(tag.added_on || tag.addedAt || tag.created_at || tag.createdAt);

    return {
        icon: tag.icon || '',
        color: tag.color || 0,
        text: type,
        tooltip: `${type} (Added by ${addedBy} ${addedOn}) - ${reason}`,
        score: tag.score || 0,
        batchTag: true,
        raw: tag
    };
}

function parseUrchinBatchTags(tags) {
    const normalizedTags = Array.isArray(tags) ? tags.map(normalizeUrchinBatchTag) : [];
    return parseUrchinCubelifyTags(normalizedTags);
}

function findUrchinBatchTagsForName(players = {}, name = '') {
    if (!players || typeof players !== 'object') return [];
    if (Array.isArray(players)) {
        const match = players.find(entry => {
            const entryName = entry?.username || entry?.name || entry?.player;
            return entryName && String(entryName).toLowerCase() === String(name).toLowerCase();
        });
        return match?.tags || match?.data || [];
    }

    const direct = players[name];
    if (Array.isArray(direct)) return direct;

    const lowerName = String(name || '').toLowerCase();
    const matchedKey = Object.keys(players).find(key => String(key).toLowerCase() === lowerName);
    const value = matchedKey ? players[matchedKey] : null;
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value.tags)) return value.tags;
    return [];
}

function isUrchinRequestFailed(urchin = {}) {
    return Boolean(urchin && urchin.ok === false);
}

function shortUrchinStatusLabel(urchin = {}) {
    const status = urchin.requestStatus || 'failed';
    if (status === 'missing_key') return 'KEY';
    if (status === 'invalid_key') return 'KEY';
    if (status === 'rate_limited') return 'LIMIT';
    if (status === 'timeout') return 'TIMEOUT';
    return 'FAIL';
}

function urchinStatusMessage(urchin = {}) {
    if (urchin.error) return urchin.error;
    const status = urchin.requestStatus || 'failed';
    if (status === 'missing_key') return 'Urchin API key is not set.';
    if (status === 'invalid_key') return 'Urchin API key is invalid or missing access.';
    if (status === 'rate_limited') return 'Urchin API is rate limited.';
    if (status === 'timeout') return 'Urchin API request timed out.';
    if (status === 'api_error') return 'Urchin API is unavailable.';
    if (status === 'network_error') return 'Urchin API network request failed.';
    return 'Urchin API request failed.';
}

function isUrchinOutageStatus(status) {
    return ['timeout', 'api_error', 'network_error'].includes(String(status || ''));
}

function isSyntheticUrchinStatusTag(value) {
    const normalized = stripAnsi(value)
        .toLowerCase()
        .replace(/[^a-z]/g, '');
    return ['timeout', 'fail', 'key', 'limit', 'apitimeout', 'apifail', 'apikey', 'apilimit'].includes(normalized);
}

function getTabStatsUrchinTag(urchin = {}, compactTagName) {
    if (!urchin || urchin.ok === false) return '';
    const tag = compactTagName(urchin.tag);
    if (!tag || isSyntheticUrchinStatusTag(tag)) return '';
    return tag;
}

function mergeUrchinOverride(existing = {}, override = null) {
    if (!override) return existing;
    return {
        ...existing,
        ...override
    };
}

function createUrchinOutageNotifier({ getActiveUser, sendChat } = {}) {
    if (typeof getActiveUser !== 'function') {
        throw new Error('createUrchinOutageNotifier requires getActiveUser');
    }
    if (typeof sendChat !== 'function') {
        throw new Error('createUrchinOutageNotifier requires sendChat');
    }

    let outageWarningSent = false;

    function notifyUrchinOutageOnce(urchin = {}) {
        if (outageWarningSent || !isUrchinOutageStatus(urchin.requestStatus)) return;
        const client = getActiveUser()?.client;
        if (!client) return;
        outageWarningSent = true;
        sendChat(client, `§d[Urchin] §cAPI looks down or unreachable right now. §7Tag data may be missing, so Urchin failure tags are hidden from tabstats.`);
    }

    function resetOutageWarning() {
        outageWarningSent = false;
    }

    return { notifyUrchinOutageOnce, resetOutageWarning };
}

module.exports = {
    makeUrchinData,
    classifyUrchinRequestError,
    parseUrchinCubelifyTags,
    titleCaseUrchinTagType,
    formatUrchinBatchDate,
    normalizeUrchinBatchTag,
    parseUrchinBatchTags,
    findUrchinBatchTagsForName,
    isUrchinRequestFailed,
    shortUrchinStatusLabel,
    urchinStatusMessage,
    isUrchinOutageStatus,
    isSyntheticUrchinStatusTag,
    getTabStatsUrchinTag,
    mergeUrchinOverride,
    createUrchinOutageNotifier
};
