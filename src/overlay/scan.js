'use strict';

const { getBedwarsScanStats, formatBedwarsScanLine, formatSkywarsScanLine } = require('../stats/scanLine');

// Scan runner extracted from proxy.js. Performs the per-game /scan workflow:
// collect candidate names from the lobby/roster, bulk-fetch Hypixel + Urchin
// stats, classify threats per state.threatConfig, and print results to chat.
//
// All collaborators are injected. state.scanMode / state.threatConfig live on
// runtimeState; lastScanSummary still lives in proxy.js so callers that read it
// (health endpoint) keep working — we receive a setter to update it.

function getOneWorder(tag) {
    if (!tag) return null;
    let parts = tag.replace(/[\[\]\(\)]/g, '').split(/[:\-\s]+/);
    let word = parts[0];
    if (word && word.toLowerCase() === 'legacy' && parts.length > 1) word = parts[1];
    return word;
}

function createScanRunner(deps) {
    const {
        state,
        sendChat,
        isSupportedTabStatsMode,
        getPlayerTeam,
        playerLookupKey,
        getUrchinBatchRaw,
        getPlayerDataWithNickDetection,
        isLikelyBot,
        getSkyWarsLevelValue,
        formatSkyWarsLevel,
        inferTeamFromColor,
        getTabNameColor,
        extractDisplayColor,
        getKdrColor,
        getWlrColor,
        getWsColor,
        getInteractiveTags,
        setLastScanSummary,
        setLastScanResults
    } = deps;

    function getScanCandidateNames(lobbyMap, gameRoster) {
        const now = Date.now();
        if (gameRoster && gameRoster.size > 0) {
            return Array.from(gameRoster).filter(name => lobbyMap.has(name));
        }

        const staleAfter = 90 * 1000;
        return Array.from(lobbyMap.entries())
            .filter(([name, info]) => {
                const validName = name.length >= 3 && name.length <= 16 && /^[a-zA-Z0-9_]+$/.test(name);
                if (!validName) return false;
                if (!info) return true;
                if (info.team) return true;
                return info.inTab && now - (info.lastSeen || 0) < staleAfter;
            })
            .map(([name]) => name);
    }

    async function performFullScan(client, lobbyMap, detectedNickedPlayers, myTeam, context = {}) {
        if (state.scanMode === 'off') {
            setLastScanSummary({ at: new Date().toISOString(), candidates: 0, results: 0, mode: state.scanMode, message: 'Scan mode is off' });
            return;
        }

        const scanGameMode = isSupportedTabStatsMode(context.gameMode) ? context.gameMode : null;
        if (!context.gameActive || !scanGameMode) {
            setLastScanSummary({ at: new Date().toISOString(), candidates: 0, results: 0, mode: state.scanMode, message: 'Not in game' });
            sendChat(client, "§cScan is only available while you are in an active Bedwars or SkyWars game.");
            return;
        }
        const isStillActive = typeof context.isStillActive === 'function' ? context.isStillActive : () => true;
        const isOwnPlayer = typeof context.isOwnPlayer === 'function'
            ? context.isOwnPlayer
            : (name) => String(name || '').toLowerCase() === String(client.username || '').toLowerCase();
        const markDetectedNick = typeof context.markNickedPlayer === 'function'
            ? context.markNickedPlayer
            : (name, source = 'scan') => detectedNickedPlayers.set(String(name).toLowerCase(), { name, source, at: Date.now() });
        const isDenickAliasDuplicate = typeof context.isDenickAliasDuplicate === 'function'
            ? context.isDenickAliasDuplicate
            : () => false;
        if (!isStillActive()) return;

        let allPlayers = getScanCandidateNames(lobbyMap, context.gameRoster).filter(name => !isDenickAliasDuplicate(name));
        if (allPlayers.length > 32) {
            const teamPlayers = allPlayers.filter(name => getPlayerTeam(lobbyMap, name));
            if (teamPlayers.length > 0 && teamPlayers.length <= 32) {
                allPlayers = teamPlayers;
            } else {
                setLastScanSummary({ at: new Date().toISOString(), candidates: allPlayers.length, results: 0, mode: state.scanMode, message: 'Roster too large' });
                sendChat(client, `§cCurrent-game roster is too large (${allPlayers.length}). Wait for teams to load, then run /scan again.`);
                return;
            }
        }

        if (allPlayers.length === 0) {
            setLastScanSummary({ at: new Date().toISOString(), candidates: 0, results: 0, mode: state.scanMode, message: 'No players detected' });
            sendChat(client, "§cNo players detected.");
            return;
        }

        // Filter out teammates (anyone on same team as client)
        const players = allPlayers.filter(name => {
            const playerTeam = getPlayerTeam(lobbyMap, name);
            const isMe = isOwnPlayer(name);
            if (isMe) return false;

            const isTeammate = scanGameMode === 'BEDWARS' && myTeam && playerTeam === myTeam;
            if (isTeammate) return false;

            return true;
        });

        if (players.length === 0) {
            setLastScanSummary({ at: new Date().toISOString(), candidates: allPlayers.length, results: 0, mode: state.scanMode, message: 'No enemies to scan' });
            sendChat(client, scanGameMode === 'SKYWARS' ? "§cNo SkyWars players detected." : "§aNo enemies to scan (all players are teammates).");
            return;
        }

        let results = [];
        const batchSize = 5;
        const getCachedPlayerProfile = typeof context.getCachedPlayerProfile === 'function'
            ? context.getCachedPlayerProfile
            : () => null;
        const getKnownDenickResult = (name) => {
            const live = context.autoDenickResults?.get(String(name).toLowerCase());
            const known = live?.realName ? live : (context.getKnownDenick?.(name) || live);
            const realName = String(known?.realName || known?.realIGN || '').trim();
            return /^[a-z0-9_]{3,16}$/i.test(realName) && playerLookupKey(realName) !== playerLookupKey(name)
                ? { ...known, realName } : null;
        };
        const scanTargets = players.map((name) => {
            const denickResult = getKnownDenickResult(name);
            const realName = String(denickResult?.realName || '').trim();
            return {
                name,
                lookupName: realName || name,
                realName,
                denickResult
            };
        });
        const sourceOrder = new Map(scanTargets.map((target, index) => [target.name, index]));
        // Live /share streaming sink (optional). Team membership is known now,
        // before any lookup — only stats lag — so we can emit each team the
        // instant its members all resolve (grouped mode) or each player as it
        // resolves (arrival mode). See createShareTagsBroadcaster.createStream.
        const shareStream = context.shareStream || null;
        const teamKeyOf = (name) => {
            if (scanGameMode === 'SKYWARS') return 'SOLO';
            const team = getPlayerTeam(lobbyMap, name) || inferTeamFromColor(lobbyMap, name);
            return team ? String(team).toUpperCase() : 'UNKNOWN';
        };
        const teamRemaining = new Map();
        const teamRows = new Map();
        if (shareStream) {
            scanTargets.forEach(target => {
                const key = teamKeyOf(target.name);
                teamRemaining.set(key, (teamRemaining.get(key) || 0) + 1);
                if (!teamRows.has(key)) teamRows.set(key, []);
            });
        }
        const noteResolvedForShare = (name, builtRow) => {
            if (!shareStream) return;
            const key = teamKeyOf(name);
            if (builtRow) {
                teamRows.get(key)?.push(builtRow);
                shareStream.onRow(builtRow);
            }
            const remaining = (teamRemaining.get(key) || 1) - 1;
            teamRemaining.set(key, remaining);
            if (remaining <= 0) shareStream.onTeam(key, (teamRows.get(key) || [])
                .sort((a, b) => sourceOrder.get(a.name) - sourceOrder.get(b.name)));
        };

        const pregameProfiles = new Map();
        const cachedProfileRows = await Promise.all(scanTargets.map(async target => {
            const cached = await getCachedPlayerProfile(target.lookupName);
            return [target.name, cached];
        }));
        cachedProfileRows.forEach(([name, cached]) => {
            if (cached?.data?.player && !cached.data.lookupFailed && !cached.data.isNicked) {
                pregameProfiles.set(playerLookupKey(name), cached);
            }
        });
        const uncachedTargets = scanTargets.filter(target => !pregameProfiles.has(playerLookupKey(target.name)));
        const hypixelBulkPlan = null;
        if (false) {
            if (hypixelBulkPlan.canSplit) {
                sendChat(client, `§6§lFury §8» §7Hypixel API: splitting §f${uncachedTargets.length} §7lookups across §f${hypixelBulkPlan.healthy.length} §7healthy keys.`);
            } else {
                sendChat(client, `§6§lFury §8» §7Hypixel API: using single-key path (§f${hypixelBulkPlan.reason}§7).`);
            }
        }
        let outputStarted = false, lastOutputTeam = null;
        function printResolvedRow(m) {
            if (!isStillActive()) return;
            if (!outputStarted) {
                outputStarted = true;
                sendChat(client, '§a§lSCAN RESULTS§r');
            }
            const teamId = scanGameMode === 'SKYWARS' ? 'PLAYERS' : (m.team || 'UNKNOWN');
            if (teamId !== lastOutputTeam) {
                sendChat(client, '§r ');
                const color = teamId === 'UNKNOWN' ? '§7' : (m.color || '§7');
                const teamNames = { '§c': 'RED', '§9': 'BLUE', '§a': 'GREEN', '§e': 'YELLOW', '§b': 'AQUA', '§f': 'WHITE', '§d': 'PINK', '§8': 'GRAY' };
                const title = scanGameMode === 'SKYWARS' ? 'PLAYERS' : teamId === 'UNKNOWN'
                    ? 'UNKNOWN TEAM' : `${teamNames[color] || String(teamId).toUpperCase()} TEAM`;
                sendChat(client, `${scanGameMode === 'SKYWARS' ? '§b' : color}§l${title}§r`);
                lastOutputTeam = teamId;
            }
            const nameColor = m.color || "§7";
            const statName = `${m.isNicked ? '§c[NICKED] ' : ''}${nameColor}${m.name}${m.denickedAs ? ` §8(§a${m.denickedAs}§8)` : ''}`;

            // Build the JSON Component for this player line
            let playerLine = {
                text: " §8» ",
                extra: []
            };

            // A confirmed nick outranks a failed lookup.
            if (m.isNicked && !m.hasDenickedStats) {
                const denickText = m.denickedAs ? ` §8(§a${m.denickedAs}§8)` : '';
                playerLine.extra.push({ text: `§c[NICKED] ${nameColor}${m.name}${denickText} §a✔` });
            } else if (m.lookupFailed) {
                playerLine.extra.push({ text: `§6[FAIL] ${nameColor}${m.name} §7- §c${m.lookupErrorMessage || 'Hypixel API lookup failed'}` });
            } else if (scanGameMode === 'SKYWARS') {
                playerLine.extra.push({ text: formatSkywarsScanLine(m, statName) });
            } else {
                playerLine.extra.push({ text: formatBedwarsScanLine(m, statName) });
            }

            if ((!m.isNicked || m.hasDenickedStats) && !m.lookupFailed) {
                playerLine.extra[0].text = playerLine.extra[0].text
                    .replace(/§7\| §f/g, ' §f');
            }

            // ADD THE INTERACTIVE TAGS HERE
            const tagComponents = getInteractiveTags(m.urchinRaw, m.name);
            playerLine.extra.push(...tagComponents);

            // Add threat marker if applicable
            if (state.scanMode === 'all' && m.isThreat) {
                playerLine.extra.push({ text: ' §4!!!' });
            }

            sendChat(client, playerLine); // Use the JSON-capable sendChat
        }

        // Each profile queues tags as soon as its verified UUID is ready.
        const getPlayerProfile = context.getPlayerProfile || getPlayerDataWithNickDetection;

        async function scanPlayer(target) {
            const cached = pregameProfiles.get(playerLookupKey(target.name));
            let profile = cached || await getPlayerProfile(target.lookupName, {
                apiPriority: 'game'
            });
            // A skin/stats/manual resolution may arrive while this lookup
            // is in flight. Fetch that account before displaying its stats.
            const latest = getKnownDenickResult(target.name);
            if (latest && playerLookupKey(latest.realName) !== playerLookupKey(target.lookupName)) {
                target.lookupName = latest.realName;
                target.realName = latest.realName;
                target.denickResult = latest;
                const realCached = await getCachedPlayerProfile(latest.realName);
                profile = realCached?.data?.player && !realCached.data.lookupFailed && !realCached.data.isNicked
                    ? realCached
                    : await getPlayerProfile(latest.realName, { apiPriority: 'game' });
            }
            if (!isStillActive()) return;
            const name = target.name;
            const denickResult = target.denickResult || getKnownDenickResult(name);
            const knownDenickedAs = String(denickResult?.realName || target.realName || '').trim();
            let builtRow = null;
            if (profile) {
                const data = profile.data;
                const p = data.player;
                if (typeof context.rememberActiveCosmetics === 'function' && data?.player && !data.isNicked && !data.lookupFailed) {
                    context.rememberActiveCosmetics(name, data, 'scan');
                    if (knownDenickedAs) {
                        context.rememberActiveCosmetics(knownDenickedAs, data, 'denick_scan');
                    }
                }
                if (typeof context.rememberOverlayPlayer === 'function') {
                    context.rememberOverlayPlayer(name, profile, {
                        mode: scanGameMode,
                        source: 'scan',
                        info: lobbyMap.get(name) || {},
                        denickResult
                    });
                }

                // Urchin tags
                const uTag = data.urchin?.tag || '';

                const lookupFailed = Boolean(data.lookupFailed);
                // A nick the rest of the proxy already settled (tab stats,
                // pregame chat, a previous scan) stays a nick here even if
                // this scan's own lookup came back empty - a nick's name is
                // never cacheable, so it is the lookup most likely to be
                // rate limited, and a miss must not quietly turn a known
                // nick into a plain row.
                const alreadyDetectedNick = detectedNickedPlayers?.has(String(name).toLowerCase()) || false;
                const isNicked = Boolean(knownDenickedAs) || alreadyDetectedNick || (!lookupFailed && data.isNicked);
                const tagThreat = state.threatConfig.countTags && uTag;
                const nickedThreat = isNicked && !isLikelyBot(name);
                if (nickedThreat) {
                    markDetectedNick(name, 'scan');
                }

                let stats;
                let isThreat;
                if (scanGameMode === 'SKYWARS') {
                    const sw = p.stats?.SkyWars || {};
                    const wins = sw.wins || 0;
                    const losses = sw.losses || 0;
                    const kills = sw.kills || 0;
                    const deaths = sw.deaths || 0;
                    const kdr = kills / Math.max(deaths, 1);
                    const wlr = wins / Math.max(losses, 1);
                    const skyLevelValue = getSkyWarsLevelValue(sw, p);
                    stats = {
                        skyLevel: formatSkyWarsLevel(sw, p),
                        skyLevelValue,
                        kdr,
                        wlr,
                        ws: sw.win_streak || 0,
                        sortValue: kdr
                    };
                    isThreat = lookupFailed
                        || kdr >= state.threatConfig.minSkywarsKdr
                        || wlr >= state.threatConfig.minSkywarsWlr
                        || skyLevelValue >= state.threatConfig.minSkywarsLevel
                        || tagThreat
                        || nickedThreat;
                } else {
                    const { stars, fkdr, wlr, ws } = getBedwarsScanStats(p);
                    stats = {
                        stars,
                        starThreat: stars >= state.threatConfig.minStars,
                        fkdr,
                        wlr,
                        ws,
                        sortValue: fkdr
                    };
                    isThreat = lookupFailed || fkdr >= state.threatConfig.minFkdr || tagThreat || nickedThreat || stars >= state.threatConfig.minStars;
                }

                const shouldInclude = state.scanMode === 'all' || (state.scanMode === 'threats' && isThreat);

                if (shouldInclude) {
                    const info = lobbyMap.get(name) || { color: "§7", letter: "?", team: null };
                    const inferredTeam = inferTeamFromColor(lobbyMap, name) || info.team;
                    const nameColor = scanGameMode === 'BEDWARS'
                        ? getTabNameColor(info, name)
                        : (info.displayColor || extractDisplayColor(info.originalDisplayName, name) || "§f");
                    builtRow = {
                        name: name,
                        color: nameColor,
                        letter: info.letter,
                        team: inferredTeam,
                        gameMode: scanGameMode,
                        ...stats,
                        uTag: uTag,
                        urchinRaw: data.urchin, // <--- Save full Urchin object
                        lookupFailed,
                        lookupErrorMessage: data.lookupErrorMessage || '',
                        isNicked: isNicked,
                        denickedAs: knownDenickedAs,
                        hasDenickedStats: Boolean(knownDenickedAs && p && !lookupFailed && !data.isNicked
                            && playerLookupKey(target.lookupName) === playerLookupKey(knownDenickedAs)),
                        isThreat: isThreat
                    };
                    results.push(builtRow);
                }
            }
            noteResolvedForShare(name, builtRow);
        }

        // Keep five independent lookup owners. Local chat waits for the whole
        // scan, while the shared API queue still owns cadence and quota.
        let nextTarget = 0;
        await Promise.all(Array.from({ length: Math.min(batchSize, scanTargets.length) }, async () => {
            while (isStillActive() && nextTarget < scanTargets.length) {
                const target = scanTargets[nextTarget++];
                try { await scanPlayer(target); }
                catch (error) {
                    if (!isStillActive()) return;
                    noteResolvedForShare(target.name, null);
                    console.error('[Scan] Player lookup failed:', error?.message || error);
                }
                if (nextTarget < scanTargets.length && isStillActive()) {
                    await new Promise(resolve => setTimeout(resolve, 300));
                }
            }
        }));
        if (!isStillActive()) return;

        if (results.length === 0) {
            if (!isStillActive()) return;
            setLastScanSummary({ at: new Date().toISOString(), candidates: players.length, results: 0, mode: state.scanMode, message: `No ${state.scanMode === 'threats' ? 'threats' : 'players'} detected` });
            if (typeof setLastScanResults === 'function') {
                setLastScanResults({
                    at: Date.now(),
                    gameMode: scanGameMode,
                    gameSessionId: context.gameSessionId ?? null,
                    results: []
                });
            }
            sendChat(client, `§6§lFury §8» §aNo ${state.scanMode === 'threats' ? 'threats' : 'players'} detected.`);
            return;
        }

        // Publish local results together after every lookup has settled.
        // Retain the existing arrival order and row formatter for display.
        for (const row of results) printResolvedRow(row);
        if (outputStarted && isStillActive()) sendChat(client, '§r ');

        results.sort((a, b) => {
            if (a.isNicked && !b.isNicked) return -1;
            if (!a.isNicked && b.isNicked) return 1;
            return (b.sortValue || 0) - (a.sortValue || 0) || sourceOrder.get(a.name) - sourceOrder.get(b.name);
        });

        setLastScanSummary({ at: new Date().toISOString(), candidates: players.length, results: results.length, mode: state.scanMode, message: 'Scan completed' });
        if (typeof setLastScanResults === 'function') {
            setLastScanResults({
                at: Date.now(),
                gameMode: scanGameMode,
                gameSessionId: context.gameSessionId ?? null,
                results: results.slice()
            });
        }
        if (!isStillActive()) return;

    }

    return { performFullScan, getScanCandidateNames };
}

module.exports = { createScanRunner, getOneWorder };
