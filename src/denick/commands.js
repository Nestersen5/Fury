'use strict';

const { createUsage } = require('../../features/chat_controller');
const { getBedwarsScanStats } = require('../stats/scanLine');

// Temporary discovery policy: switch to 'intersection' to restore the prior
// default. Explicit inspector modes remain available for comparison.
const DEFAULT_DENICK_CANDIDATE_MODE = 'union';

// /denick + /denickskin command handlers extracted from proxy.js. Owns the
// Bordic stat lookup, the cosmetic-search HTTP call, and the in-game chat
// reporting for both commands. The skin denicker still lives in
// skin_denicker.js (getRealNameFromSkin); we just call it here.
//
// parseStatCount and denickCandidateKey are pure module-level helpers so
// callers (including src/denick/api.js, which uses parseStatCount inside its
// /denick filter parser) can require them without spinning up the factory.
// The stateful pieces (HTTP, sendChat, key getters, history writer) sit
// behind createDenickCommands DI.

function parseStatCount(value) {
    const text = String(value ?? '').replace(/,/g, '').trim();
    if (!text) return null;
    const parsed = Number(text);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function denickCandidateKey(candidate = {}) {
    return String(candidate.name || candidate.displayName || candidate.uuid || '').trim().toLowerCase();
}

function evaluateDenickStatGaps(targets, counts, options = {}) {
    const applicable = ['finals', 'beds'].every(stat => Number.isFinite(targets[stat]) && Number.isFinite(counts[stat]));
    if (!applicable) return { gapOk: true, finalsGap: null, bedsGap: null, maxBedsGap: null };
    const configured = Number(options.bedsGapAllowancePercent);
    const allowance = Number.isFinite(configured) && configured >= 0 ? configured : 25;
    const finalsGap = Math.abs(targets.finals - counts.finals);
    const bedsGap = Math.abs(targets.beds - counts.beds);
    return { gapOk: bedsGap * 100 <= finalsGap * (100 + allowance), finalsGap, bedsGap,
        maxBedsGap: finalsGap * (100 + allowance) / 100 };
}

function evaluateDenickStats(targets, counts, options = {}, defaultRange = 200) {
    const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    const range = number(options.verifyRange, defaultRange);
    const finalsBehind = number(options.verifyFinalsBehind, range);
    const finalsAhead = number(options.verifyFinalsAhead, 4);
    const bedsBehind = number(options.verifyBedsBehind, range);
    const bedsAhead = number(options.verifyBedsAhead, 0);
    const finalsOk = targets.finals === undefined
        || (counts.finals >= targets.finals - finalsBehind && counts.finals <= targets.finals + Math.max(0, finalsAhead));
    const bedsOk = targets.beds === undefined
        || (counts.beds >= targets.beds - bedsBehind && counts.beds <= targets.beds + bedsAhead);
    return { finalsOk, bedsOk, ...evaluateDenickStatGaps(targets, counts, options),
        score: Math.abs(counts.finals - (targets.finals ?? counts.finals)) + Math.abs(counts.beds - (targets.beds ?? counts.beds)) };
}

function createDenickCommands({
    axios,
    sendChat,
    getKeys,
    hasHypixelApiKeyConfigured,
    cosmeticSearchApiUrl,
    getCosmeticSearchToken,
    denickRange,
    formatInt,
    getPlayerData,
    getRealNameFromSkin,
    isMinecraftUsername,
    appendDenickHistory,
    parseDenickFilters
}) {
    if (!axios) throw new Error('createDenickCommands: axios is required');
    if (typeof sendChat !== 'function') throw new Error('createDenickCommands: sendChat is required');
    if (typeof getKeys !== 'function') throw new Error('createDenickCommands: getKeys is required');
    if (typeof hasHypixelApiKeyConfigured !== 'function') {
        throw new Error('createDenickCommands: hasHypixelApiKeyConfigured is required');
    }
    if (!cosmeticSearchApiUrl) throw new Error('createDenickCommands: cosmeticSearchApiUrl is required');
    if (typeof getCosmeticSearchToken !== 'function') {
        throw new Error('createDenickCommands: getCosmeticSearchToken is required');
    }
    if (!Number.isFinite(Number(denickRange))) {
        throw new Error('createDenickCommands: denickRange is required');
    }
    if (typeof formatInt !== 'function') throw new Error('createDenickCommands: formatInt is required');
    if (typeof getPlayerData !== 'function') throw new Error('createDenickCommands: getPlayerData is required');
    if (typeof getRealNameFromSkin !== 'function') {
        throw new Error('createDenickCommands: getRealNameFromSkin is required');
    }
    if (typeof isMinecraftUsername !== 'function') {
        throw new Error('createDenickCommands: isMinecraftUsername is required');
    }
    if (typeof appendDenickHistory !== 'function') {
        throw new Error('createDenickCommands: appendDenickHistory is required');
    }
    if (typeof parseDenickFilters !== 'function') {
        throw new Error('createDenickCommands: parseDenickFilters is required');
    }

    const DENICK_RANGE = Number(denickRange);

    async function findDenickCandidatesByCosmetics(filters = {}) {
        const params = { ...filters, limit: 20 };
        const token = getCosmeticSearchToken();
        if (token) params.token = token;
        let res;
        try {
            res = await axios.get(`${cosmeticSearchApiUrl}/api/cosmetics/search`, {
                timeout: 10000,
                params
            });
        } catch (e) {
            // The cosmetic search service relays upstream failures as a 502 with
            // the real reason in the body; axios throws before we can read it.
            const upstreamError = e?.response?.data?.error;
            if (upstreamError) throw new Error(`Cosmetic search: ${upstreamError}`);
            throw e;
        }
        if (res.data?.success === false) {
            return { error: res.data?.error || 'Cosmetic search failed.', candidates: [] };
        }
        return {
            candidates: Array.isArray(res.data?.data) ? res.data.data : [],
            totalMatches: Number(res.data?.totalMatches || 0) || 0,
            cache: res.data?.cache || null
        };
    }

    async function handleDenickSkin(client, args, lobbyPlayers, context = {}) {
        const target = args[1];
        if (!target) {
            sendChat(client, '§cUsage: §e/denickskin <player>');
            return;
        }

        const playerData = lobbyPlayers.get(target);

        if (!playerData || !playerData.properties) {
            sendChat(client, `§cCould not find skin data for §f${target}§c. (Try /scan first or make sure they are in your lobby)`);
            return;
        }

        const realName = getRealNameFromSkin(playerData.properties);

        if (realName) {
            if (realName.toLowerCase() === target.toLowerCase()) {
                sendChat(client, `§b[SkinCheck] §f${target} §7is using their own skin metadata.`);
            } else {
                sendChat(client, `\n§b§lSKIN DENICK SUCCESS`);
                sendChat(client, `§7Nicked Name: §c${target}`);
                sendChat(client, `§7Real Name: §a${realName}`);
                sendChat(client, `§8(Owner of the skin currently worn)\n`);
                const saved = typeof context.storeDenickResult === 'function'
                    ? context.storeDenickResult(target, realName, 'skin_manual')
                    : false;
                if (!saved && typeof context.storeDenickResult !== 'function') {
                    appendDenickHistory({
                        nick: target,
                        realIGN: realName,
                        method: 'skin_manual',
                        stats: null,
                        account: client.username
                    });
                }
            }
        } else {
            sendChat(client, `§b[SkinCheck] §7Could not denick §f${target}§7. They are using a generic nick skin.`);
        }
    }

    async function handleDenick(client, args, lobbyPlayers, context = {}) {
        if (args.length < 2 || String(args[1]).toLowerCase() === 'help') {
            const help = createUsage(message => sendChat(client, message), 'Denick usage',
                'Search by stats, cosmetics, or both.');
            help.section('Stats');
            help.command('/denick finals <number> beds <number>', 'Final kills / beds broken. Use either or both.');
            help.section('Cosmetics');
            help.command('/denick <type> <name>', 'Type: finalkill, beddestroy, killmessage. Name: cosmetic, not IGN.');
            help.section('Combined example');
            help.command('/denick beddestroy ghosts finals 102000', 'Ghosts bed effect + matching final kills.');
            help.section('Test AutoDenick');
            help.command('/denick test', 'Simulate finals or beds locally without saving nicknames.');
            help.command('/denick test clear', 'Clear test counts before checking another player.');
            help.command('/denick test messages', 'Preview AutoDenick messages without API requests.');
            return;
        }

        const subCommand = String(args[1] || '').toLowerCase();
        if (subCommand === 'add' || subCommand === 'manual') {
            const nick = String(args[2] || '').trim();
            const realIGN = String(args[3] || '').trim();
            if (!isMinecraftUsername(nick) || !isMinecraftUsername(realIGN)) {
                sendChat(client, '§cUsage: §e/denick add <nick> <realIGN>');
                return;
            }
            if (nick.toLowerCase() === realIGN.toLowerCase()) {
                sendChat(client, '§cNick and real IGN must be different.');
                return;
            }

            appendDenickHistory({
                nick,
                realIGN,
                method: 'manual',
                stats: null,
                gameMode: context.currentGamemode || null,
                account: client.username
            });

            const canApplyNow = typeof context.isCurrentGamePlayer === 'function'
                ? context.isCurrentGamePlayer(nick)
                : false;
            const remembered = canApplyNow && typeof context.rememberKnownDenickInSession === 'function'
                ? context.rememberKnownDenickInSession(nick, realIGN, 'manual')
                : false;
            sendChat(client, `§b[Denick] §aSaved manual nick §c${nick} §8-> §a${realIGN}${remembered ? ' §7(and applied now)' : ''}§a.`);
            return;
        }

        const parsed = parseDenickFilters(args);
        if (parsed.error) {
            sendChat(client, `§c${parsed.error}`);
            sendChat(client, '§7Example: §e/denick killmessage counter finals 102000 beddestroy ghosts');
            return;
        }
        if (!parsed.hasCosmetics && !parsed.hasStats) {
            sendChat(client, '§cAdd at least one cosmetic filter or finals/beds count.');
            return;
        }

        try {
            const keys = getKeys();
            if (parsed.hasStats && !parsed.hasCosmetics) {
                if (!keys.aurora || !hasHypixelApiKeyConfigured()) return sendChat(client, '§cSet Hypixel and Aurora keys first.');
                sendChat(client, `§e[Aurora] Searching for matching stats: §f${parsed.statLabels.join(' §8| §f')}`);
                const { candidates, error, complete } = await findDenickCandidatesByStats(parsed.stats);
                if (error) return sendChat(client, `§c${error}`);
                if (candidates.length === 0) return sendChat(client, complete
                    ? '§cNo candidates found.' : '§eNo verified matches found. The search was limited.');
                if (!complete) sendChat(client, '§7Search results are limited; other matching players may be missing.');
                candidates.forEach(candidate => {
                    sendChat(client, `§6${candidate.displayName} §7- §fF: ${candidate.finals} §7| §fB: ${candidate.beds} ${candidate.fromCache ? '§8(C)' : ''}`);
                });
                return;
            }

            if (parsed.hasCosmetics && !parsed.hasStats) {
                sendChat(client, `§d[CosmeticDenick] §7Searching exact cosmetic match: §f${parsed.cosmeticLabels.join(' §8| §f')}`);
                const { candidates, totalMatches, error } = await findDenickCandidatesByCosmetics(parsed.filters);
                if (error) return sendChat(client, `§c${error}`);
                if (!candidates.length) return sendChat(client, '§cNo perfect cosmetic matches found.');
                sendChat(client, `§d[CosmeticDenick] §a${totalMatches} §7perfect match${totalMatches === 1 ? '' : 'es'} found. Showing top §f${candidates.length}§7.`);
                candidates.forEach(candidate => {
                    sendChat(client, `§6${candidate.name} §8[${candidate.star ?? '?'}?] §7F: §f${formatInt(candidate.finals ?? 0)} §7B: §f${formatInt(candidate.beds ?? 0)} §8${candidate.rank || ''}`);
                });
                return;
            }

            if (!keys.aurora || !hasHypixelApiKeyConfigured()) return sendChat(client, '§cSet Hypixel and Aurora keys first.');
            sendChat(client, `§d[CosmeticDenick] §7Searching combined match: §f${parsed.labels.join(' §8| §f')}`);
            const [cosmeticResult, statResult] = await Promise.all([
                findDenickCandidatesByCosmetics(parsed.filters),
                findDenickCandidatesByStats(parsed.stats)
            ]);
            if (cosmeticResult.error) return sendChat(client, `§c${cosmeticResult.error}`);
            if (statResult.error) return sendChat(client, `§c${statResult.error}`);

            const statsByKey = new Map((statResult.candidates || []).map(candidate => [denickCandidateKey(candidate), candidate]));
            const candidates = (cosmeticResult.candidates || [])
                .filter(candidate => statsByKey.has(denickCandidateKey(candidate)))
                .map(candidate => ({
                    ...candidate,
                    matchedStats: statsByKey.get(denickCandidateKey(candidate)) || null
                }));
            if (!candidates.length) return sendChat(client, statResult.complete
                ? '§cNo candidates matched both cosmetics and finals/beds.' : '§eNo verified combined matches found. The stats search was limited.');
            if (!statResult.complete) sendChat(client, '§7Stats search results are limited; other matching players may be missing.');
            sendChat(client, `§d[CosmeticDenick] §a${candidates.length} §7combined match${candidates.length === 1 ? '' : 'es'} found. Showing top §f${candidates.length}§7.`);
            candidates.slice(0, 20).forEach(candidate => {
                const stats = candidate.matchedStats || {};
                const matched = stats.displayName && stats.displayName !== candidate.name ? ` §8(${stats.displayName})` : '';
                sendChat(client, `§6${candidate.name}${matched} §8[${candidate.star ?? '?'}?] §7F: §f${formatInt(candidate.finals ?? stats.finals ?? 0)} §7B: §f${formatInt(candidate.beds ?? stats.beds ?? 0)} §8${candidate.rank || ''}`);
            });
        } catch (e) {
            const connFailed = e?.code === 'ECONNREFUSED' || e?.code === 'ECONNABORTED'
                || e?.code === 'ETIMEDOUT' || /ECONNREFUSED|ECONNABORTED|ETIMEDOUT/i.test(e?.message || '');
            if (connFailed) {
                sendChat(client, '§cDenick cosmetic search is offline. §7Restart the proxy from the launcher to start the Cosmetic Search service.');
            } else {
                sendChat(client, `§cDenick lookup failed. §7${e.message || ''}`);
            }
        }
    }

    async function findDenickCandidatesByStats(targets = {}, options = {}) {
        const keys = getKeys();
        if (!keys.aurora || !hasHypixelApiKeyConfigured()) {
            return { error: 'Set Hypixel and Aurora API keys first.', retryable: false, candidates: [] };
        }

        const lookupRange = Number.isFinite(Number(options.lookupRange)) ? Number(options.lookupRange) : 800;
        const lookupLimit = Number.isFinite(Number(options.lookupLimit)) ? Math.max(1, Math.min(50, Math.floor(Number(options.lookupLimit)))) : 50;
        const verifyLimit = Number.isFinite(Number(options.verifyLimit)) ? Number(options.verifyLimit) : 25;
        const candidateMode = options.candidateMode || DEFAULT_DENICK_CANDIDATE_MODE;
        const isCurrent = options.isCurrent || (() => true);
        // Inspection is opt-in and must never affect the production lookup.
        const trace = typeof options.onTrace === 'function' ? event => { try { options.onTrace(event); } catch (_) {} } : null;
        const normalizedTargets = {};
        ['finals', 'beds'].forEach(type => {
            const value = parseStatCount(targets[type]);
            if (value !== null) normalizedTargets[type] = value;
        });

        const targetEntries = Object.entries(normalizedTargets);
        if (targetEntries.length === 0) {
            return { error: 'No valid finals or beds target was provided.', candidates: [] };
        }

        // Automatic single-stat suggestions can widen the lower allowance only
        // after the primary pass. Keep manual/custom and combined searches as-is.
        const singleStat = targetEntries.length === 1 ? targetEntries[0][0] : null;
        const behindOption = singleStat === 'finals' ? 'verifyFinalsBehind' : 'verifyBedsBehind';
        const primaryRange = Number(options[behindOption] ?? options.verifyRange ?? DENICK_RANGE);
        const fallbackRange = Number(options.singleStatFallbackRange);
        const fallbackOptions = singleStat && Number.isFinite(fallbackRange) && fallbackRange > primaryRange
            ? { ...options, [behindOption]: fallbackRange } : null;

        const lookupResults = [];
        const auroraCounts = new Map();
        for (const [type, value] of targetEntries) {
            if (!isCurrent()) return { cancelled: true, candidates: [] };
            const res = await axios.get(`https://bordic.xyz/api/v2/resources/lookup/${type}?value=${value}&range=${lookupRange}&max=${lookupLimit}&key=${keys.aurora}`, { timeout: 10000 });
            if (!isCurrent()) return { cancelled: true, candidates: [] };
            if (!res.data?.success || !Array.isArray(res.data.data)) {
                return { error: 'Stats search is unavailable right now.', candidates: [] };
            }
            const rows = res.data.data.slice(0, lookupLimit);
            for (const row of rows) {
                const name = String(row.name || '').toLowerCase();
                if (!name) continue;
                const counts = auroraCounts.get(name) || {};
                for (const stat of ['finals', 'beds']) {
                    const count = parseStatCount(row[stat]);
                    if (count !== null && (stat === type || counts[stat] === undefined)) counts[stat] = count;
                }
                auroraCounts.set(name, counts);
            }
            trace?.({ type: 'discovery', stat: type, value, lookupRange, requestedMax: lookupLimit, rows: rows.map(row =>
                Object.fromEntries(['name', 'uuid', 'finals', 'beds', 'lastUpdated', 'distance'].filter(field => row[field] !== undefined).map(field => [field, row[field]]))) });
            lookupResults.push([...new Set(rows.map(item => String(item.name || '').toLowerCase()).filter(Boolean))]);
        }

        let names = lookupResults[0];
        if (candidateMode === 'union') {
            names = [...new Set(lookupResults.flat())];
        } else {
            for (let i = 1; i < lookupResults.length; i++) {
                const next = new Set(lookupResults[i]);
                names = names.filter(name => next.has(name));
            }
        }
        names = names.filter(name => {
            const counts = auroraCounts.get(name) || {};
            const gaps = evaluateDenickStatGaps(normalizedTargets, counts, options);
            if (!gaps.gapOk) trace?.({ type: 'candidate-filter', source: 'aurora', name, reason: 'beds-final-gap', ...counts, ...gaps });
            return gaps.gapOk;
        });
        const ranking = names.map((name, index) => {
            const counts = auroraCounts.get(name) || {};
            const known = targetEntries.filter(([stat]) => Number.isFinite(counts[stat]));
            const verdict = evaluateDenickStats(normalizedTargets, counts, options, DENICK_RANGE);
            const inRange = known.every(([stat]) => stat === 'finals' ? verdict.finalsOk : verdict.bedsOk);
            const tier = !known.length ? 3 : !inRange ? 2 : known.length === targetEntries.length ? 0 : 1;
            const score = known.reduce((sum, [stat, target]) => sum + Math.abs(counts[stat] - target), 0);
            return { name, index, tier, score, knownStats: known.length,
                reason: tier === 0 ? targetEntries.length === 2 ? 'both stored stats in range' : 'stored stat in range'
                    : tier === 1 ? 'one stored stat in range' : tier === 2 ? 'stored stats outside range' : 'stored counts unknown' };
        }).sort((a, b) => a.tier - b.tier || a.score - b.score || a.index - b.index);
        names = ranking.map(candidate => candidate.name);
        trace?.({ type: 'shortlist', names: [...names], verifyLimit, ranking });

        const candidates = [];
        const rejected = [];
        const addCandidate = ({ name, profile, finals, beds }, score) => candidates.push({
            name,
            displayName: profile.data.player.displayname || name,
            finals,
            beds,
            fromCache: profile.fromCache,
            score,
            ...(options.includeScanStats ? { scanStats: getBedwarsScanStats(profile.data.player), urchin: profile.data.urchin } : {})
        });
        for (const name of names.slice(0, verifyLimit)) {
            if (!isCurrent()) return { cancelled: true, candidates: [] };
            const profile = await getPlayerData(name, { includeErrors: true });
            if (!isCurrent()) return { cancelled: true, candidates: [] };
            if (profile?.error && ['player_not_found', 'hypixel_player_missing'].includes(profile.errorType)) {
                trace?.({ type: 'verification', name, status: 'missing', errorType: profile.errorType });
                continue;
            }
            if (profile?.error || !profile?.data?.player || profile.data.lookupFailed) {
                trace?.({ type: 'verification', name, status: 'error', errorType: profile?.errorType || 'lookup_failed' });
                return { error: 'Could not verify player stats right now.', candidates: [] };
            }
            const bw = profile.data.player.stats?.Bedwars || {};
            const finals = bw.final_kills_bedwars || 0;
            const beds = bw.beds_broken_bedwars || 0;
            const { finalsOk, bedsOk, score, ...gaps } = evaluateDenickStats(normalizedTargets, { finals, beds }, options, DENICK_RANGE);
            trace?.({ type: 'verification', name, status: finalsOk && bedsOk && gaps.gapOk ? 'accepted' : 'rejected', finals, beds, finalsOk, bedsOk, ...gaps, fromCache: Boolean(profile.fromCache) });
            if (!finalsOk || !bedsOk || !gaps.gapOk) {
                if (fallbackOptions) rejected.push({ name, profile, finals, beds });
                continue;
            }

            addCandidate({ name, profile, finals, beds }, score);
            if (fallbackOptions && candidates.length > 3) {
                break; // Four primary matches already rule out single-stat suggestions.
            }
        }

        const primaryCount = candidates.length;
        const expanded = Boolean(fallbackOptions && primaryCount <= 2);
        if (expanded) {
            // Profiles were already checked in the primary pass. Reuse those
            // exact responses; expanding never sends another discovery/profile request.
            for (const entry of rejected) {
                const { finalsOk, bedsOk, score, ...gaps } = evaluateDenickStats(normalizedTargets, entry, fallbackOptions, DENICK_RANGE);
                trace?.({ type: 'verification', name: entry.name, pass: 'expanded', status: finalsOk && bedsOk && gaps.gapOk ? 'accepted' : 'rejected',
                    finals: entry.finals, beds: entry.beds, finalsOk, bedsOk, ...gaps, fromCache: Boolean(entry.profile.fromCache) });
                if (finalsOk && bedsOk && gaps.gapOk) addCandidate(entry, score);
            }
        }

        candidates.sort((a, b) => a.score - b.score);
        const selection = fallbackOptions ? { stat: singleStat, primaryRange, primaryCount, expanded,
            range: expanded ? fallbackRange : primaryRange, tooMany: candidates.length > 3 } : null;
        if (selection) trace?.({ type: 'single-stat', ...selection });
        // A successful bounded lookup is complete even when the provider list
        // or verification budget leaves other players outside this search.
        // Uniqueness is among the profiles checked; API errors/cancellation
        // still exit above without a successful result.
        return { candidates, complete: true, ...(selection ? { singleStat: selection } : {}) };
    }

    return {
        findDenickCandidatesByCosmetics,
        findDenickCandidatesByStats,
        handleDenickSkin,
        handleDenick
    };
}

module.exports = {
    createDenickCommands,
    parseStatCount,
    denickCandidateKey,
    evaluateDenickStats,
    evaluateDenickStatGaps,
    DEFAULT_DENICK_CANDIDATE_MODE
};
