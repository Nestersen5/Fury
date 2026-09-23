'use strict';

// Raw per-service fetchers for the stats pipeline: Aurora ping
// (with parsing + summarization), Hypixel status / guild, and Seraph
// blacklist. The host (proxy.js) owns the caches, key store, dedupe
// instance, and key-availability checks; this module receives them
// via createStatsSources and exposes pure data shapers next to the
// fetchers that produce them.

const axios = require('axios');
const { normalizeUuidText, hyphenateUuid } = require('../util/uuid.js');

function localDateKey(date = new Date()) {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
}

function parseAuroraDayMs(day) {
    const ms = Date.parse(`${String(day || '').slice(0, 10)}T00:00:00Z`);
    return Number.isFinite(ms) ? ms : 0;
}

function validPingNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : -1;
}

function summarizePingRows(rows = []) {
    const avgValues = rows.map(row => validPingNumber(row.avg)).filter(value => value > 0);
    const minValues = rows.map(row => validPingNumber(row.min)).filter(value => value > 0);
    const maxValues = rows.map(row => validPingNumber(row.max)).filter(value => value > 0);
    return {
        days: rows.length,
        avg: avgValues.length ? Math.round(avgValues.reduce((sum, value) => sum + value, 0) / avgValues.length) : -1,
        min: minValues.length ? Math.min(...minValues) : -1,
        max: maxValues.length ? Math.max(...maxValues) : -1
    };
}

function makePingData(overrides = {}) {
    return {
        ok: null,
        requestStatus: 'not_checked',
        source: 'aurora',
        error: '',
        ping: -1,
        avgPing: -1,
        latestDay: '',
        latestAvg: -1,
        latestMin: -1,
        latestMax: -1,
        todayAvg: -1,
        todayMin: -1,
        todayMax: -1,
        weeklyAvg: -1,
        weeklyMin: -1,
        weeklyMax: -1,
        weeklyDays: 0,
        monthlyAvg: -1,
        monthlyMin: -1,
        monthlyMax: -1,
        monthlyDays: 0,
        totalDays: 0,
        checkedAt: 0,
        ...overrides
    };
}

function parseAuroraPingResponse(payload = {}) {
    const rows = Array.isArray(payload?.data) ? payload.data
        .map(row => ({
            uuid: normalizeUuidText(row.uuid),
            day: String(row.day || '').slice(0, 10),
            dayMs: parseAuroraDayMs(row.day),
            timestamp: Number(row.timestamp || 0),
            min: validPingNumber(row.min),
            avg: validPingNumber(row.avg),
            max: validPingNumber(row.max)
        }))
        .filter(row => row.day && row.avg > 0)
        .sort((a, b) => b.dayMs - a.dayMs || b.timestamp - a.timestamp)
        : [];

    const latest = rows[0] || null;
    const todayKey = localDateKey();
    const today = rows.find(row => row.day === todayKey) || null;
    const now = Date.now();
    const futureLimit = now + 86400000;
    const weeklyCutoff = 7 * 86400000;
    const monthlyCutoff = 30 * 86400000;
    const weeklyRows = [];
    const monthlyRows = [];
    for (const row of rows) {
        if (row.dayMs <= 0 || row.dayMs > futureLimit) continue;
        const age = now - row.dayMs;
        if (age <= monthlyCutoff) monthlyRows.push(row);
        if (age <= weeklyCutoff) weeklyRows.push(row);
    }
    const weekly = summarizePingRows(weeklyRows.length ? weeklyRows : rows.slice(0, 7));
    const monthly = summarizePingRows(monthlyRows.length ? monthlyRows : rows.slice(0, 30));

    const todayAvg = validPingNumber(today?.avg);
    const latestAvg = validPingNumber(latest?.avg);
    const weeklyAvg = validPingNumber(weekly.avg);
    const monthlyAvg = validPingNumber(monthly.avg);

    return makePingData({
        ok: true,
        requestStatus: 'ok',
        ping: todayAvg > 0 ? todayAvg : latestAvg,
        avgPing: weeklyAvg > 0 ? weeklyAvg : (monthlyAvg > 0 ? monthlyAvg : latestAvg),
        latestDay: latest?.day || '',
        latestAvg,
        latestMin: validPingNumber(latest?.min),
        latestMax: validPingNumber(latest?.max),
        todayAvg,
        todayMin: validPingNumber(today?.min),
        todayMax: validPingNumber(today?.max),
        weeklyAvg,
        weeklyMin: validPingNumber(weekly.min),
        weeklyMax: validPingNumber(weekly.max),
        weeklyDays: weekly.days,
        monthlyAvg,
        monthlyMin: validPingNumber(monthly.min),
        monthlyMax: validPingNumber(monthly.max),
        monthlyDays: monthly.days,
        totalDays: rows.length,
        checkedAt: Date.now()
    });
}

function classifyAuroraPingError(error) {
    const status = error?.response?.status;
    const body = error?.response?.data;
    const bodyText = typeof body === 'string'
        ? body
        : [body?.cause, body?.reason, body?.message, body?.error, JSON.stringify(body || {})].filter(Boolean).join(' ');
    const clean = String(bodyText || '').toLowerCase();

    if (status === 401 || status === 403 || clean.includes('invalid') || clean.includes('unauthorized') || clean.includes('forbidden') || clean.includes('api key')) {
        return { requestStatus: 'invalid_key', error: 'Aurora API key is invalid or missing access.' };
    }
    if (status === 429) return { requestStatus: 'rate_limited', error: 'Aurora ping API is rate limited.' };
    if (status === 404) return { requestStatus: 'not_found', error: 'Aurora has no ping data for this player.' };
    if (error?.code === 'ECONNABORTED' || clean.includes('timeout')) return { requestStatus: 'timeout', error: 'Aurora ping request timed out.' };
    if (status >= 500) return { requestStatus: 'api_error', error: 'Aurora ping API is unavailable.' };
    if (!error?.response) return { requestStatus: 'network_error', error: 'Aurora ping network request failed.' };
    return { requestStatus: 'failed', error: 'Aurora ping request failed.' };
}

function createStatsSources({
    hypixelApiGet,
    hasHypixelApiKeyConfigured,
    getHypixelKey,
    getAuroraKey,
    getSeraphKey,
    guildCache,
    auroraPingCache,
    auroraPingCacheDuration,
    auroraPingDeduper
} = {}) {
    const required = {
        hypixelApiGet, hasHypixelApiKeyConfigured, getHypixelKey, getAuroraKey,
        getSeraphKey, guildCache, auroraPingCache, auroraPingCacheDuration, auroraPingDeduper
    };
    for (const [name, value] of Object.entries(required)) {
        if (value === undefined || value === null) {
            throw new Error(`createStatsSources requires ${name}`);
        }
    }

    async function getHypixelGuildRaw(uuid) {
        const cleanUuid = normalizeUuidText(uuid);
        if (!cleanUuid || !hasHypixelApiKeyConfigured()) return null;
        const cached = guildCache.get(cleanUuid);
        if (cached) return cached;

        try {
            const res = await hypixelApiGet(`https://api.hypixel.net/v2/guild?player=${cleanUuid}`, { timeout: 3500 });
            const guild = res.data?.guild || null;
            guildCache.set(cleanUuid, guild);
            return guild;
        } catch (e) {
            return null;
        }
    }

    async function getHypixelStatusRaw(uuid) {
        try {
            const res = await hypixelApiGet(`https://api.hypixel.net/v2/status?uuid=${uuid}`, { timeout: 1500 });
            const s = res.data.session;
            if (!s || !s.online) return '§7Offline';
            const game = s.gameType === 'BEDWARS' ? 'Bedwars' : s.gameType;
            const mode = s.mode ? `(${s.mode.toLowerCase().replace('eight_one', 'solos').replace('eight_two', 'doubles')})` : '';
            const map = s.map ? `on §e${s.map}` : '';
            return `§aPlaying ${game} ${mode} ${map}`;
        } catch (e) {
            return '§7Unknown';
        }
    }

    async function getAuroraPingRaw(uuid, options = {}) {
        const cleanUuid = normalizeUuidText(uuid);
        const auroraKey = getAuroraKey();
        if (!auroraKey) {
            return makePingData({
                ok: false,
                requestStatus: 'missing_key',
                error: 'Aurora API key is not set.'
            });
        }
        if (!/^[0-9a-f]{32}$/i.test(cleanUuid)) {
            return makePingData({
                ok: false,
                requestStatus: 'missing_uuid',
                error: 'Missing player UUID.'
            });
        }

        const cached = auroraPingCache.get(cleanUuid);
        if (!options.forceRefresh && cached && Date.now() - cached.at < auroraPingCacheDuration) {
            return cached.data;
        }

        return auroraPingDeduper.run(cleanUuid, async () => {
            try {
                const res = await axios.get('https://bordic.xyz/api/v2/resources/ping', {
                    timeout: 3500,
                    params: {
                        uuid: hyphenateUuid(cleanUuid),
                        key: auroraKey
                    }
                });
                if (res.data?.success === false) {
                    const data = makePingData({
                        ok: false,
                        requestStatus: 'failed',
                        error: res.data?.message || res.data?.error || 'Aurora ping request failed.',
                        checkedAt: Date.now()
                    });
                    auroraPingCache.set(cleanUuid, { at: Date.now(), data });
                    return data;
                }
                const data = parseAuroraPingResponse(res.data);
                auroraPingCache.set(cleanUuid, { at: Date.now(), data });
                return data;
            } catch (e) {
                const classified = classifyAuroraPingError(e);
                const data = makePingData({
                    ok: false,
                    ...classified,
                    checkedAt: Date.now()
                });
                auroraPingCache.set(cleanUuid, { at: Date.now(), data });
                return data;
            }
        });
    }

    async function getSeraphRaw(uuid) {
        const seraphKey = getSeraphKey();
        if (!seraphKey || !uuid) return null;
        try {
            const response = await axios.get(`https://api.seraph.si/${uuid}/blacklist?key=${seraphKey}`, { timeout: 3000 });
            const res = response.data;
            if (res && res.success && res.data?.blacklist?.tagged) {
                return res.data.blacklist;
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    return {
        getHypixelGuildRaw,
        getHypixelStatusRaw,
        getAuroraPingRaw,
        getSeraphRaw
    };
}

module.exports = {
    createStatsSources,
    makePingData,
    parseAuroraPingResponse,
    classifyAuroraPingError,
    localDateKey,
    parseAuroraDayMs,
    validPingNumber,
    summarizePingRows
};
