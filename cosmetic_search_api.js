const express = require('express');
const axios = require('axios');
const fs = require('fs');
const { dataPath } = require('./src/storage/runtimePaths.js');

const PORT = Number(process.env.COSMETIC_SEARCH_PORT || 3210);
const BIND_HOST = require('./src/net/cosmeticBind').cosmeticBindHost();
const RESOURCE = String(process.env.AURORA_COSMETIC_RESOURCE || 'superstar').toLowerCase();
const CACHE_TTL_MS = Number(process.env.COSMETIC_SEARCH_CACHE_TTL_MS || 15 * 60 * 1000);
const MAX_LIMIT = Number(process.env.COSMETIC_SEARCH_MAX_LIMIT || 5000);
const CACHE_FILE = dataPath('cosmetic_search_cache.json');
const networkAbort = new AbortController();

const COSMETIC_FIELDS = {
    killMessage: ['killmessage', 'killmessages', 'kill_msg', 'killmsg'],
    activeVictoryDance: ['victorydance', 'victory', 'dance'],
    activeKillEffect: ['killeffect', 'finalkill', 'finalkilleffect', 'finals', 'final'],
    activeBedDestroy: ['beddestroy', 'beddestroy', 'bedbreak', 'bedbreakeffect', 'beds', 'bed'],
    activeWoodType: ['woodtype', 'woodskin', 'wood'],
    activeDeathCry: ['deathcry', 'death'],
    activeProjectileTrail: ['projectiletrail', 'projectile', 'trail'],
    activeGlyph: ['glyph'],
    activeIslandTopper: ['islandtopper', 'topper'],
    activeNPCSkin: ['npcskin', 'shopkeeper', 'shopkeeperskin'],
    activeSprays: ['sprays', 'spray'],
    active_figurine: ['figurine', 'activefigurine']
};

const FIELD_BY_ALIAS = Object.entries(COSMETIC_FIELDS).reduce((map, [field, aliases]) => {
    map.set(normalizeKey(field), field);
    aliases.forEach(alias => map.set(normalizeKey(alias), field));
    return map;
}, new Map());

let memoryCache = {
    at: 0,
    resource: RESOURCE,
    players: [],
    source: 'empty'
};

function normalizeKey(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
}

function normalizeValue(value) {
    if (value === null || value === undefined) return null;
    return String(value).trim().toLowerCase();
}

function requestedNull(value) {
    return ['null', '__null__', '(null)'].includes(normalizeValue(value));
}

function expandRequestedValue(value) {
    const normalized = normalizeValue(value);
    if (requestedNull(value)) return { kind: 'null' };
    if (normalized === 'random') {
        return { kind: 'values', values: ['random_cosmetic', 'random_favorite_cosmetic'] };
    }
    return { kind: 'values', values: [normalized] };
}

function parseValueList(value) {
    if (Array.isArray(value)) return value.flatMap(parseValueList);
    return String(value || '')
        .split(',')
        .map(part => part.trim())
        .filter(Boolean)
        .map(expandRequestedValue);
}

function readDiskCache() {
    try {
        if (!fs.existsSync(CACHE_FILE)) return;
        const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        if (!Array.isArray(parsed.players)) return;
        memoryCache = {
            at: Number(parsed.at || 0),
            resource: parsed.resource || RESOURCE,
            players: parsed.players,
            source: 'disk'
        };
    } catch (e) {}
}

function writeDiskCache() {
    try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify({
            at: memoryCache.at,
            resource: memoryCache.resource,
            players: memoryCache.players
        }), 'utf8');
    } catch (e) {
        console.error('[CosmeticSearch] Failed to save cache:', e.message);
    }
}

function auroraKey() {
    return process.env.AURORA_API_KEY || '';
}

function requireAccess(req, res, next) {
    const token = process.env.COSMETIC_SEARCH_TOKEN || '';
    if (!token) return next();

    const auth = String(req.headers.authorization || '');
    const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
    const supplied = bearer || String(req.query.token || req.body?.token || '');
    if (supplied === token) return next();
    return res.status(401).json({ success: false, error: 'Unauthorized.' });
}

async function fetchAuroraPlayers(force = false) {
    const now = Date.now();
    if (!force && memoryCache.players.length && now - memoryCache.at < CACHE_TTL_MS) {
        return memoryCache;
    }

    const key = auroraKey();
    if (!key) throw new Error('Aurora API key is missing. Set AURORA_API_KEY or /apikey aurora.');

    // No trailing slash — Bordic's router 404s on paths ending in "/".
    const url = `https://bordic.xyz/api/v2/resources/${encodeURIComponent(RESOURCE)}`;
    const response = await axios.get(url, {
        timeout: 20000,
        signal: networkAbort.signal,
        params: { key }
    });

    if (response.data?.success === false) {
        throw new Error(response.data?.message || response.data?.error || 'Aurora request failed.');
    }

    const players = Array.isArray(response.data?.data) ? response.data.data : [];
    memoryCache = {
        at: Date.now(),
        resource: RESOURCE,
        players,
        source: 'aurora'
    };
    if (!networkAbort.signal.aborted) writeDiskCache();
    return memoryCache;
}

function collectFilters(input = {}) {
    const filters = [];
    Object.entries(input).forEach(([rawKey, rawValue]) => {
        if (rawValue === undefined || rawValue === '' || ['limit', 'offset', 'token', 'refresh', 'includeCosmetics'].includes(rawKey)) return;
        const field = FIELD_BY_ALIAS.get(normalizeKey(rawKey));
        if (!field) return;
        const values = parseValueList(rawValue);
        if (values.length) filters.push({ field, values });
    });
    return filters;
}

function valueMatches(actual, wantedList) {
    return wantedList.some((wanted) => {
        if (wanted.kind === 'null') return actual === null || actual === undefined;
        const actualValue = normalizeValue(actual);
        return wanted.values.includes(actualValue);
    });
}

function playerMatches(player, filters) {
    return filters.every(filter => valueMatches(player?.[filter.field], filter.values));
}

function filterLabelValue(wantedList) {
    return wantedList.flatMap(wanted => wanted.kind === 'null' ? ['null'] : wanted.values);
}

function playerResponse(player) {
    return {
        uuid: player.uuid || '',
        name: player.name || '',
        star: player.star ?? null,
        rank: player.rank || '',
        finals: player.finals ?? null,
        beds: player.beds ?? null,
        lastUpdated: player.lastUpdated ?? null,
        cosmetics: Object.fromEntries(Object.keys(COSMETIC_FIELDS).map(field => [field, player[field] ?? null]))
    };
}

async function searchCosmetics(input = {}) {
    const force = String(input.refresh || '').toLowerCase() === 'true' || input.refresh === '1';
    const cache = await fetchAuroraPlayers(force);
    const filters = collectFilters(input);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(input.limit || 100) || 100));
    const offset = Math.max(0, Number(input.offset || 0) || 0);
    const matches = filters.length
        ? cache.players.filter(player => playerMatches(player, filters))
        : [];

    return {
        success: true,
        resource: cache.resource,
        totalPlayers: cache.players.length,
        totalMatches: matches.length,
        offset,
        limit,
        cache: {
            source: cache.source,
            updatedAt: cache.at ? new Date(cache.at).toISOString() : null,
            ageMs: cache.at ? Date.now() - cache.at : null,
            ttlMs: CACHE_TTL_MS
        },
        filters: Object.fromEntries(filters.map(filter => [filter.field, filterLabelValue(filter.values)])),
        fields: Object.keys(COSMETIC_FIELDS),
        data: matches.slice(offset, offset + limit).map(playerResponse)
    };
}

readDiskCache();

const app = express();
let stopping = false;
app.use((req, res, next) => stopping ? res.status(503).json({ error: 'Fury is stopping.' }) : next());
app.use(express.json({ limit: '256kb' }));

app.get('/health', (req, res) => {
    res.json({
        success: true,
        resource: RESOURCE,
        playersCached: memoryCache.players.length,
        cacheUpdatedAt: memoryCache.at ? new Date(memoryCache.at).toISOString() : null
    });
});

app.get('/api/cosmetics/fields', (req, res) => {
    res.json({
        success: true,
        fields: Object.entries(COSMETIC_FIELDS).map(([field, aliases]) => ({ field, aliases }))
    });
});

app.get('/api/cosmetics/refresh', requireAccess, async (req, res) => {
    try {
        const cache = await fetchAuroraPlayers(true);
        res.json({
            success: true,
            resource: cache.resource,
            totalPlayers: cache.players.length,
            updatedAt: new Date(cache.at).toISOString()
        });
    } catch (e) {
        res.status(502).json({ success: false, error: e.message });
    }
});

app.get('/api/cosmetics/search', requireAccess, async (req, res) => {
    try {
        res.json(await searchCosmetics(req.query));
    } catch (e) {
        res.status(502).json({ success: false, error: e.message });
    }
});

app.post('/api/cosmetics/search', requireAccess, async (req, res) => {
    try {
        res.json(await searchCosmetics(req.body || {}));
    } catch (e) {
        res.status(502).json({ success: false, error: e.message });
    }
});

const listener = app.listen(PORT, BIND_HOST, () => {
    console.log(`[CosmeticSearch] Listening on ${BIND_HOST}:${PORT}`);
    console.log(`[CosmeticSearch] Resource: ${RESOURCE}, cache TTL: ${CACHE_TTL_MS}ms`);
});

const ownedListener = require('./src/bootstrap/shutdownResources').ownListener(listener);
const ownedIpv6 = BIND_HOST === '127.0.0.1'
    ? require('./src/net/loopback').ownIpv6Loopback(listener) : null;
require('./src/bootstrap/shutdown').installServiceShutdown({
    quiesce() { stopping = true; networkAbort.abort(); ownedListener.quiesce(); ownedIpv6?.quiesce(); },
    close() { return Promise.all([ownedListener.close(), ownedIpv6?.close()]); }
});
