'use strict';

const fs = require('fs');
const path = require('path');
const { createDenickCommands, parseStatCount, evaluateDenickStats, DEFAULT_DENICK_CANDIDATE_MODE } = require('../../src/denick/commands');
const { createHypixelApiClient } = require('../../features/hypixel_api_client');
const { BoundedTtlMap } = require('../../src/util/bounded_ttl_map');
const { getDataDir } = require('../../src/storage/runtimePaths');

const DEFAULTS = Object.freeze({ lookupRange: 800, lookupLimit: 50, verifyRange: 100, verifyFinalsBehind: 100,
    verifyFinalsAhead: 4, verifyBedsBehind: 100, verifyBedsAhead: 0, singleStatFallbackRange: 200, bedsGapAllowancePercent: 25,
    verifyLimit: 25, candidateMode: DEFAULT_DENICK_CANDIDATE_MODE });

function readSavedKeys(directory = getDataDir()) {
    const file = path.join(directory, 'statmod_key.txt');
    if (!fs.existsSync(file)) return { aurora: '', hypixel: '' };
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    const labels = {};
    for (const line of lines) {
        const colon = line.indexOf(':');
        if (colon < 0 || line.trim().startsWith('#')) continue;
        labels[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
    }
    if (!Object.keys(labels).length) return { hypixel: lines[0]?.trim() || '', aurora: lines[2]?.trim() || '' };
    return { hypixel: labels['hypixel api key'] || labels.hypixel || labels['hypixel reserve api key']
        || labels['hypixel secondary api key'] || labels['hypixel api key 2'] || labels.hypixelsecondary || labels.hypixel2 || '',
    aurora: labels['aurora api key'] || labels.aurora || '' };
}

function validateSettings(raw = {}) {
    const result = {};
    for (const [key, fallback] of Object.entries(DEFAULTS)) {
        if (key === 'candidateMode') {
            result[key] = raw[key] === undefined ? fallback : raw[key] === 'union' ? 'union' : 'intersection';
            continue;
        }
        const value = raw[key] === undefined ? fallback : Number(raw[key]);
        if (!Number.isSafeInteger(value) || value < (key === 'lookupLimit' ? 1 : 0)
            || value > (key === 'lookupLimit' ? 50 : key === 'verifyLimit' ? 100 : 100000)) throw new Error(`Invalid ${key}.`);
        result[key] = value;
    }
    return result;
}

function validateTargets(raw = {}) {
    const targets = {};
    for (const stat of ['finals', 'beds']) {
        if (raw[stat] === '' || raw[stat] === null || raw[stat] === undefined) continue;
        const value = parseStatCount(raw[stat]);
        if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(String(raw[stat])) || !Number.isSafeInteger(value)) throw new Error(`Invalid ${stat} count.`);
        targets[stat] = value;
    }
    if (!Object.keys(targets).length) throw new Error('Enter finals, beds, or both.');
    return targets;
}

function projectPlayer(player) {
    const bw = player.stats?.Bedwars || {};
    return { name: player.displayname, uuid: player.uuid, finals: bw.final_kills_bedwars || 0, beds: bw.beds_broken_bedwars || 0,
        stars: player.achievements?.bedwars_level || 0, finalDeaths: bw.final_deaths_bedwars || 0,
        wins: bw.wins_bedwars || 0, losses: bw.losses_bedwars || 0, winstreak: bw.winstreak || 0 };
}

function proxyProfile(profile) {
    return { data: { player: { displayname: profile.name, stats: { Bedwars: {
        final_kills_bedwars: profile.finals, beds_broken_bedwars: profile.beds
    } } } }, fromCache: true };
}

function createInspector({ axios, readKeys = readSavedKeys, now = Date.now } = {}) {
    let keys = {}, signature = '', discovery = null, busy = false, controller = null;
    const usage = { aurora: 0, mojang: 0, hypixel: 0, cacheHits: 0 };
    const profiles = new BoundedTtlMap({ ttlMs: 5 * 60000, maxEntries: 500, now });
    const discoveries = new BoundedTtlMap({ ttlMs: 60000, maxEntries: 100, now });
    const client = createHypixelApiClient({ axios: { get: (...args) => { usage.hypixel++; return axios.get(...args); } },
        getKeys: () => keys, getGameState: () => ({ gameActive: false }), logger: { warn() {}, log() {}, error() {} } });
    function reloadKeys() {
        keys = readKeys();
        const next = `${keys.aurora}\0${keys.hypixel}`;
        if (next !== signature) { profiles.clear(); discoveries.clear(); discovery = null; signature = next; }
    }
    reloadKeys();
    function info() {
        return { configured: { aurora: Boolean(keys.aurora), hypixel: Boolean(keys.hypixel) }, usage: { ...usage }, defaults: DEFAULTS };
    }
    function cachedProfile(name) {
        const entry = profiles.get(name.toLowerCase());
        return entry && now() - entry.timestamp < 5 * 60000 ? entry : null;
    }
    async function profile(name, force = false) {
        name = String(name || '').trim();
        if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw new Error('Enter a Minecraft player name (3–16 letters, numbers or underscores).');
        const cached = !force && cachedProfile(name);
        if (cached) { usage.cacheHits++; return { ...cached, fromCache: true }; }
        if (!keys.hypixel) throw new Error('Hypixel key is missing in statmod_key.txt.');
        usage.mojang++;
        const identity = await axios.get(`https://api.mojang.com/users/profiles/minecraft/${name}`, { timeout: 10000, signal: controller?.signal });
        const uuid = identity.data?.id;
        if (!/^[a-f0-9]{32}$/i.test(uuid || '')) throw new Error('Minecraft profile was not found.');
        const response = await client.hypixelApiGet(`https://api.hypixel.net/v2/player?uuid=${uuid}`, { timeout: 10000, signal: controller?.signal });
        if (response.data?.success === false || !response.data?.player) throw new Error('Hypixel player data was unavailable.');
        const entry = { player: projectPlayer({ ...response.data.player, uuid }), timestamp: now() };
        profiles.set(name.toLowerCase(), entry);
        return { ...entry, fromCache: false };
    }
    function commands(transport, getPlayerData) {
        return createDenickCommands({ axios: transport, getKeys: () => ({ aurora: keys.aurora || 'offline-replay' }),
            hasHypixelApiKeyConfigured: () => true, sendChat() {}, cosmeticSearchApiUrl: 'http://127.0.0.1',
            getCosmeticSearchToken: () => '', denickRange: 200, formatInt: String, getPlayerData,
            getRealNameFromSkin: () => null, isMinecraftUsername: () => true, appendDenickHistory() {}, parseDenickFilters: () => ({}) });
    }
    async function fetchDiscovery(raw) {
        const targets = validateTargets(raw.targets), settings = validateSettings(raw.settings);
        if (!keys.aurora) throw new Error('Aurora key is missing in statmod_key.txt.');
        const lists = [];
        const transport = { get: async (url, options) => {
            const parsed = new URL(url), stat = parsed.pathname.split('/').at(-1);
            const cacheKey = `${stat}:${parsed.searchParams.get('value')}:${settings.lookupRange}:${settings.lookupLimit}`;
            const cached = !raw.force && discoveries.get(cacheKey);
            if (cached && now() - cached.timestamp < 60000) {
                usage.cacheHits++; lists.push({ ...cached.list, fromCache: true }); return { data: cached.body };
            }
            usage.aurora++;
            const response = await axios.get(url, { ...options, signal: controller?.signal });
            if (response.data?.success && Array.isArray(response.data.data)) {
                // Only the explicit provider projection from the production trace leaves Main.
                lists.push({ stat, fetchedAt: now(), fromCache: false });
            }
            return response;
        } };
        const events = [];
        const result = await commands(transport, async () => { throw new Error('Discovery must not verify profiles.'); })
            .findDenickCandidatesByStats(targets, { ...settings, verifyLimit: 0, isCurrent: () => !controller?.signal.aborted, onTrace: event => events.push(event) });
        if (result.error) throw new Error(result.error);
        if (result.cancelled) throw new Error('Inspection stopped.');
        for (const event of events.filter(event => event.type === 'discovery')) {
            const list = lists.find(item => item.stat === event.stat);
            Object.assign(list, event);
            discoveries.set(`${event.stat}:${event.value}:${settings.lookupRange}:${settings.lookupLimit}`, { timestamp: list.fetchedAt,
                list, body: { success: true, data: event.rows } });
        }
        discovery = { targets, lookupRange: settings.lookupRange, lookupLimit: settings.lookupLimit, lists, at: now() };
        return analyze({ targets, settings });
    }
    async function analyze(raw) {
        const targets = validateTargets(raw.targets), settings = validateSettings(raw.settings);
        if (!discovery) return { ...info(), targets, settings, rows: [], lists: [], outcome: 'Fetch Aurora lists to begin.', events: [] };
        const events = [];
        const result = await commands({ get: async url => {
            const stat = new URL(url).pathname.split('/').at(-1);
            const list = discovery.lists.find(item => item.stat === stat);
            // A missing list is unknown, not an empty complete response.
            return { data: list ? { success: true, data: list.rows } : { success: false } };
        } }, async name => {
            const cached = cachedProfile(name);
            return cached ? proxyProfile(cached.player) : { error: true, errorType: 'inspector_not_verified' };
        }).findDenickCandidatesByStats(targets, { ...settings, onTrace: event => events.push(event) });
        const shortlist = events.find(event => event.type === 'shortlist')?.names || [];
        const priorities = new Map((events.find(event => event.type === 'shortlist')?.ranking || []).map(candidate => [candidate.name, candidate]));
        const verification = new Map(events.filter(event => event.type === 'verification').map(event => [event.name, event]));
        const gapFilters = new Map(events.filter(event => event.type === 'candidate-filter').map(event => [event.name, event]));
        const effectiveSettings = result.singleStat?.expanded
            ? { ...settings, [result.singleStat.stat === 'finals' ? 'verifyFinalsBehind' : 'verifyBedsBehind']: result.singleStat.range } : settings;
        const rows = new Map();
        for (const list of discovery.lists) for (const [index, item] of list.rows.entries()) {
            const name = String(item.name || '').toLowerCase();
            if (!name) continue;
            if (!rows.has(name)) rows.set(name, { name: item.name, sources: [], aurora: {} });
            const row = rows.get(name);
            row.sources.push(list.stat);
            row.aurora[list.stat] = { value: item[list.stat], position: index + 1, lastUpdated: item.lastUpdated, distance: item.distance };
        }
        for (const [key, row] of rows) {
            const cached = cachedProfile(key);
            const position = shortlist.indexOf(key);
            row.profile = cached ? { ...cached.player, fetchedAt: cached.timestamp } : null;
            row.deltas = cached ? { finals: targets.finals === undefined ? null : cached.player.finals - targets.finals,
                beds: targets.beds === undefined ? null : cached.player.beds - targets.beds } : null;
            const checked = verification.get(key);
            const gapFilter = gapFilters.get(key);
            row.proxyStatus = gapFilter ? `Not checked: Aurora beds gap ${gapFilter.bedsGap} exceeds ${gapFilter.maxBedsGap} allowed by finals gap ${gapFilter.finalsGap}`
                : position < 0 ? 'Not considered: missing from another stat list'
                : position >= settings.verifyLimit ? 'Not checked: verification limit'
                    : checked?.status === 'accepted' ? checked.pass === 'expanded' ? 'Accepted by expanded single-stat range' : 'Accepted by proxy lookup'
                        : checked?.status === 'rejected' ? `Rejected: ${[!checked.finalsOk && 'finals outside range', !checked.bedsOk && 'beds outside range', checked.gapOk === false && `beds gap ${checked.bedsGap} exceeds ${checked.maxBedsGap} allowed by finals gap ${checked.finalsGap}`].filter(Boolean).join(', ')}`
                            : checked?.status === 'error' ? 'Lookup stops here: profile not verified'
                                : result.singleStat?.tooMany ? 'Not checked: already four valid single-stat matches'
                                : 'Not reached: an earlier player has no verified profile';
            row.considered = position >= 0;
            row.position = position >= 0 ? position + 1 : null;
            row.priority = priorities.get(key) || null;
            row.status = position < 0 ? 'excluded' : checked?.status === 'accepted' ? 'accepted' : checked?.status === 'rejected' ? 'rejected' : 'unchecked';
            if (cached) {
                const verdict = evaluateDenickStats(targets, cached.player, effectiveSettings, 200);
                row.cachedVerdict = verdict.finalsOk && verdict.bedsOk && verdict.gapOk ? 'Matches entered tolerances' : 'Outside entered tolerances';
            }
        }
        const combined = targets.finals !== undefined && targets.beds !== undefined;
        for (const row of rows.values()) {
            const key = row.name.toLowerCase();
            row.chatStatus = result.error ? 'No result shown: lookup is unfinished'
                : !combined && result.candidates.length > 3 ? 'No suggestions: too many players match; waiting for the other stat'
                    : !combined ? result.candidates.slice(0, 3).some(candidate => candidate.name === key) ? 'Would show a possible match' : 'Not in the suggestions shown'
                    : result.complete && result.candidates.length === 1 && result.candidates[0].name === key ? 'Would show a confirmed match'
                        : result.candidates.slice(0, 3).some(candidate => candidate.name === key) ? 'Would show a possible match; not confirmed' : 'Would not confirm this player';
        }
        const experimental = settings.candidateMode !== DEFAULTS.candidateMode || Object.keys(DEFAULTS).some(key => settings[key] !== DEFAULTS[key]);
        const prefix = experimental ? 'Experiment' : 'Current proxy';
        const outcome = result.error ? 'Proxy lookup cannot finish until the required profiles are verified.'
            : !combined ? `${result.singleStat ? `${result.singleStat.primaryCount} match(es) within ${result.singleStat.primaryRange} below; ${result.singleStat.expanded ? `expanded to ${result.singleStat.range} below` : 'not expanded'}. ` : ''}${result.candidates.length > 3
                ? 'Too many players match; proxy waits silently for the other stat and shows no suggestions.'
                : `Tentative stage: ${result.candidates.length} match(es); proxy shows these possible matches and saves none.`}`
                : result.complete && result.candidates.length === 1 ? `${prefix} would confirm this unique match.`
                    : `${prefix} would not confirm: zero/multiple matches or an incomplete search.`;
        const stale = discovery.lookupRange !== settings.lookupRange || discovery.lookupLimit !== settings.lookupLimit || JSON.stringify(discovery.targets) !== JSON.stringify(targets);
        return { ...info(), targets, settings, rows: [...rows.values()], lists: discovery.lists, events, result: {
            complete: result.complete, error: result.error, singleStat: result.singleStat, acceptedNames: result.candidates.map(item => item.name)
        }, outcome, stale, discoveryTargets: discovery.targets, experimental,
        coverageNote: 'A successful search finishes within the configured profile limit. One verified player matching both stats can confirm even with a full Aurora list or unchecked players beyond that limit. Uniqueness applies to checked profiles; omitted players remain unknown.' };
    }
    async function verify(raw) {
        if (!discovery) throw new Error('Fetch Aurora lists first.');
        const allowed = new Set(discovery.lists.flatMap(list => list.rows.map(row => String(row.name).toLowerCase())));
        const names = [...new Set((Array.isArray(raw.names) ? raw.names : []).map(name => String(name).toLowerCase()))];
        if (!names.length || names.some(name => !allowed.has(name))) throw new Error('Select players from the fetched lists.');
        const budget = Number(raw.budget ?? 5);
        if (!Number.isSafeInteger(budget) || budget < 0 || budget > 50) throw new Error('Fresh profile budget must be between 0 and 50.');
        let fresh = 0;
        const checks = [];
        for (const name of names) {
            if ((!cachedProfile(name) || raw.force) && fresh >= budget) { checks.push({ name, status: 'budget', message: 'Fresh-profile budget reached.' }); continue; }
            if (!cachedProfile(name) || raw.force) fresh++;
            try { const entry = await profile(name, Boolean(raw.force)); checks.push({ name, status: 'verified', fromCache: entry.fromCache }); }
            catch (error) {
                checks.push({ name, status: 'error', message: safeError(error) });
                break; // Do not spend more requests after an API failure.
            }
        }
        return { ...(await analyze(raw)), checks, freshProfiles: fresh };
    }
    async function dispatch(action, payload = {}) {
        if (action === 'cancel') { controller?.abort(); return info(); }
        if (busy) throw new Error('Wait for the current action to finish.');
        busy = true;
        controller = new AbortController();
        try {
            reloadKeys();
            if (action === 'info') return info();
            if (action === 'player') return { ...(await profile(payload.name, Boolean(payload.force))), ...info() };
            if (action === 'fetch') return await fetchDiscovery(payload);
            if (action === 'analyze') return await analyze(payload);
            if (action === 'verify') return await verify(payload);
            throw new Error('Unknown inspector action.');
        } finally { busy = false; controller = null; }
    }
    return { dispatch, info };
}

function safeError(error) {
    const status = error?.response?.status;
    if (status) return `API request failed (HTTP ${status}). No automatic retry was sent.`;
    if (error?.code) return `Request failed (${String(error.code).replace(/[^A-Z0-9_]/g, '')}). No automatic retry was sent.`;
    if (error?.isAxiosError) return 'API request failed. No automatic retry was sent.';
    // Local validation errors contain no remote URL, request configuration or credentials.
    return String(error?.message || 'Inspection failed.').replace(/https?:\/\/\S+/g, '[request URL hidden]').slice(0, 220);
}

module.exports = { createInspector, readSavedKeys, validateTargets, validateSettings, DEFAULTS, safeError };
