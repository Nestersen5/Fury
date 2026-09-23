'use strict';

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
        if (args.length < 2) {
            sendChat(client, '§cUsage: §e/denick finals <#> beds <#> §6OR §e/denick finalkill <name> beddestroy <name> finals <#>');
            sendChat(client, '§7Skin denick moved to §e/denickskin <player>§7.');
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
                const { candidates, error } = await findDenickCandidatesByStats(parsed.stats);
                if (error) return sendChat(client, `§c${error}`);
                if (candidates.length === 0) return sendChat(client, '§cNo candidates found.');
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
            if (!candidates.length) return sendChat(client, '§cNo candidates matched both cosmetics and finals/beds.');
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
            return { error: 'Set Hypixel and Aurora API keys first.', candidates: [] };
        }

        const lookupRange = Number.isFinite(Number(options.lookupRange)) ? Number(options.lookupRange) : 800;
        const verifyRange = Number.isFinite(Number(options.verifyRange)) ? Number(options.verifyRange) : DENICK_RANGE;
        const verifyLimit = Number.isFinite(Number(options.verifyLimit)) ? Number(options.verifyLimit) : 15;
        const normalizedTargets = {};
        ['finals', 'beds'].forEach(type => {
            const value = parseStatCount(targets[type]);
            if (value !== null) normalizedTargets[type] = value;
        });

        const targetEntries = Object.entries(normalizedTargets);
        if (targetEntries.length === 0) {
            return { error: 'No valid finals or beds target was provided.', candidates: [] };
        }

        const lookupResults = [];
        for (const [type, value] of targetEntries) {
            const res = await axios.get(`https://bordic.xyz/api/v2/resources/lookup/${type}?value=${value}&range=${lookupRange}&max=100&key=${keys.aurora}`);
            if (res.data?.success) {
                lookupResults.push(res.data.data.map(item => String(item.name || '').toLowerCase()).filter(Boolean));
            }
        }

        if (lookupResults.length === 0) return { candidates: [] };

        let names = lookupResults[0];
        for (let i = 1; i < lookupResults.length; i++) {
            const next = new Set(lookupResults[i]);
            names = names.filter(name => next.has(name));
        }

        const candidates = [];
        for (const name of names.slice(0, verifyLimit)) {
            const profile = await getPlayerData(name);
            if (!profile) continue;
            const bw = profile.data.player.stats?.Bedwars || {};
            const finals = bw.final_kills_bedwars || 0;
            const beds = bw.beds_broken_bedwars || 0;
            const finalsOk = normalizedTargets.finals === undefined || Math.abs(finals - normalizedTargets.finals) <= verifyRange;
            const bedsOk = normalizedTargets.beds === undefined || Math.abs(beds - normalizedTargets.beds) <= verifyRange;
            if (!finalsOk || !bedsOk) continue;

            candidates.push({
                name,
                displayName: profile.data.player.displayname || name,
                finals,
                beds,
                fromCache: profile.fromCache,
                score: Math.abs(finals - (normalizedTargets.finals ?? finals)) + Math.abs(beds - (normalizedTargets.beds ?? beds))
            });
        }

        candidates.sort((a, b) => a.score - b.score);
        return { candidates };
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
    denickCandidateKey
};
