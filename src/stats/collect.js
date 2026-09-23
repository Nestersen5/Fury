'use strict';

// Per-mode stat collection for Bedwars, SkyWars, and Duels.
//
// Pure transformations: each function takes a raw Hypixel `player.stats.X`
// blob plus a mode descriptor and returns the small numeric shape that
// proxy.js's render layer consumes. The shared stat helpers (statValue,
// ratioValue, …) and the mode-def constants live in proxy.js still — once
// stats/render and stats/fetch land they can move into this directory.
//
// Private helpers (skyKey, skyVariantKeys, skyOverallNonMiniValue,
// duelsModeKey, maxStatValue) are only referenced by the three collectors,
// so they move into the closure rather than back into proxy.js.

function createStatsCollector({
    statValue,
    sumStatValues,
    ratioValue,
    safeStatNumber,
    bwKey,
    getSkyWarsLevelFromXp,
    getSkyWarsLevelDelta,
    getTopSkyWarsKit,
    BEDWARS_MODE_DEFS,
    SKYWARS_MODE_DEFS,
    DUELS_MODE_DEFS
} = {}) {
    if (typeof statValue !== 'function') throw new Error('createStatsCollector requires statValue');
    if (typeof sumStatValues !== 'function') throw new Error('createStatsCollector requires sumStatValues');
    if (typeof ratioValue !== 'function') throw new Error('createStatsCollector requires ratioValue');
    if (typeof safeStatNumber !== 'function') throw new Error('createStatsCollector requires safeStatNumber');
    if (typeof bwKey !== 'function') throw new Error('createStatsCollector requires bwKey');
    if (typeof getSkyWarsLevelFromXp !== 'function') throw new Error('createStatsCollector requires getSkyWarsLevelFromXp');
    if (typeof getSkyWarsLevelDelta !== 'function') throw new Error('createStatsCollector requires getSkyWarsLevelDelta');
    if (typeof getTopSkyWarsKit !== 'function') throw new Error('createStatsCollector requires getTopSkyWarsKit');
    if (!Array.isArray(BEDWARS_MODE_DEFS)) throw new Error('createStatsCollector requires BEDWARS_MODE_DEFS');
    if (!Array.isArray(SKYWARS_MODE_DEFS)) throw new Error('createStatsCollector requires SKYWARS_MODE_DEFS');
    if (!Array.isArray(DUELS_MODE_DEFS)) throw new Error('createStatsCollector requires DUELS_MODE_DEFS');

    function skyKey(mode, stat) {
        if (mode.kind === 'overall') return stat;
        if (mode.kind === 'base') return `${stat}_${mode.suffix}`;
        if (mode.kind === 'combo') return `${stat}_${mode.base}_${mode.variant}`;
        return null;
    }

    function skyVariantKeys(stat, variant) {
        return ['solo', 'team', 'mini'].map(base => `${stat}_${base}_${variant}`);
    }

    function skyOverallNonMiniValue(sw = {}, stat) {
        return Math.max(0, statValue(sw, stat) - statValue(sw, `${stat}_mini`));
    }

    function duelsModeKey(mode, stat) {
        return mode?.prefix ? `${mode.prefix}_${stat}` : stat;
    }

    function maxStatValue(stats = {}, keys = []) {
        return Math.max(0, ...keys.map(key => statValue(stats, key)));
    }

    function collectBedwarsStats(bw = {}, mode = BEDWARS_MODE_DEFS[0], root = {}) {
        const wins = statValue(bw, bwKey(mode, 'wins'));
        const losses = statValue(bw, bwKey(mode, 'losses'));
        const kills = statValue(bw, bwKey(mode, 'kills'));
        const deaths = statValue(bw, bwKey(mode, 'deaths'));
        const finals = statValue(bw, bwKey(mode, 'final_kills'));
        const finalDeaths = statValue(bw, bwKey(mode, 'final_deaths'));
        const beds = statValue(bw, bwKey(mode, 'beds_broken'));
        const bedsLost = statValue(bw, bwKey(mode, 'beds_lost'));
        const games = statValue(bw, bwKey(mode, 'games_played'));
        const ws = mode.prefix ? statValue(bw, `${mode.prefix}_winstreak`) : statValue(bw, 'winstreak');
        const xp = mode.id === 'overall' ? statValue(bw, 'Experience') : 0;
        const starsGained = mode.id === 'overall'
            ? (xp > 0 ? xp / 5000 : safeStatNumber(root?.delta?.achievements?.bedwars_level))
            : 0;

        return {
            wins,
            losses,
            wlr: ratioValue(wins, losses),
            kills,
            deaths,
            kdr: ratioValue(kills, deaths),
            finals,
            finalDeaths,
            fkdr: ratioValue(finals, finalDeaths),
            beds,
            bedsLost,
            bblr: ratioValue(beds, bedsLost),
            games,
            ws,
            xp,
            starsGained
        };
    }

    function collectSkyWarsStats(sw = {}, mode = SKYWARS_MODE_DEFS[0], root = {}) {
        const get = (stat) => {
            if (mode.kind === 'overall') return skyOverallNonMiniValue(sw, stat);
            if (mode.kind === 'variant') return sumStatValues(sw, skyVariantKeys(stat, mode.suffix));
            return statValue(sw, skyKey(mode, stat));
        };

        const miniMode = mode.kind === 'base' && mode.suffix === 'mini';
        const wins = get('wins');
        const kills = get('kills');
        const assists = get('assists');
        const playtime = get('time_played');
        const games = get('games');
        const rawLosses = get('losses');
        const losses = miniMode && games > 0 ? Math.max(0, games - wins) : rawLosses;
        const rawDeaths = get('deaths');
        const deaths = miniMode && games > 0 ? Math.max(0, games - wins) : rawDeaths;
        const levelGained = getSkyWarsLevelFromXp(sw)
            || getSkyWarsLevelDelta(sw)
            || safeStatNumber(root?.delta?.achievements?.skywars_you_re_a_star);
        const topKit = getTopSkyWarsKit(sw, mode);

        return {
            wins,
            losses,
            wlr: ratioValue(wins, losses),
            kills,
            deaths,
            kdr: ratioValue(kills, deaths),
            assists,
            playtime,
            games,
            levelGained,
            topKit
        };
    }

    function collectDuelsStats(duels = {}, mode = DUELS_MODE_DEFS[0]) {
        const overall = !mode?.prefix;
        const get = stat => overall ? statValue(duels, stat) : statValue(duels, duelsModeKey(mode, stat));
        const wins = get('wins');
        const losses = get('losses');
        const kills = get('kills');
        const deaths = get('deaths');
        const goals = get('goals');
        const bridgeKills = get('bridge_kills');
        const bridgeDeaths = get('bridge_deaths');
        const rounds = get('rounds_played');
        const games = overall
            ? (statValue(duels, 'games_played_duels') || rounds || wins + losses)
            : (rounds || wins + losses);
        const bowHits = get('bow_hits');
        const bowShots = get('bow_shots');
        const meleeHits = get('melee_hits');
        const meleeSwings = get('melee_swings');
        const prefix = mode?.prefix || '';
        const family = prefix.split('_')[0] || '';
        const currentWs = overall
            ? maxStatValue(duels, ['currentStreak', 'current_winstreak', 'current_overall_winstreak'])
            : maxStatValue(duels, [`current_winstreak_mode_${prefix}`, `current_${family}_winstreak`]);
        const bestWs = overall
            ? maxStatValue(duels, ['best_overall_winstreak', 'best_winstreak', 'best_duels_winstreak'])
            : maxStatValue(duels, [`best_winstreak_mode_${prefix}`, `best_${family}_winstreak`]);

        return {
            wins,
            losses,
            wlr: ratioValue(wins, losses),
            winrate: games > 0 ? wins / Math.max(games, 1) : wins / Math.max(wins + losses, 1),
            kills,
            deaths,
            kdr: ratioValue(kills, deaths),
            goals,
            bridgeKills,
            bridgeDeaths,
            games,
            coins: get('coins') || get('coins_gained'),
            damage: get('damage_dealt'),
            blocksPlaced: get('blocks_placed'),
            blocksBroken: get('blocks_broken'),
            bowHits,
            bowShots,
            bowAccuracy: bowShots > 0 ? bowHits / bowShots : 0,
            meleeHits,
            meleeSwings,
            meleeAccuracy: meleeSwings > 0 ? meleeHits / meleeSwings : 0,
            currentWs,
            bestWs
        };
    }

    // Aggregate every sub-mode of a Duels family (e.g. Classic 1v1 + Classic
    // 2v2) into one "family overall". Counts are summed and the ratios
    // recomputed from those sums — never averaged — so WLR/KDR stay correct.
    // `modeCount` lets callers skip the block for single-mode families where it
    // would just duplicate the mode card.
    function collectDuelsFamilyStats(duels = {}, family = '') {
        const modes = DUELS_MODE_DEFS.filter(mode => mode.prefix && mode.family === family);
        const totals = {
            wins: 0, losses: 0, kills: 0, deaths: 0, goals: 0, games: 0,
            coins: 0, damage: 0, blocksPlaced: 0, blocksBroken: 0,
            bowHits: 0, bowShots: 0, meleeHits: 0, meleeSwings: 0,
            currentWs: 0, bestWs: 0
        };
        modes.forEach(mode => {
            const s = collectDuelsStats(duels, mode);
            totals.wins += s.wins;
            totals.losses += s.losses;
            totals.kills += s.kills;
            totals.deaths += s.deaths;
            totals.goals += s.goals;
            totals.games += s.games;
            totals.coins += s.coins;
            totals.damage += s.damage;
            totals.blocksPlaced += s.blocksPlaced;
            totals.blocksBroken += s.blocksBroken;
            totals.bowHits += s.bowHits;
            totals.bowShots += s.bowShots;
            totals.meleeHits += s.meleeHits;
            totals.meleeSwings += s.meleeSwings;
            totals.currentWs = Math.max(totals.currentWs, s.currentWs);
            totals.bestWs = Math.max(totals.bestWs, s.bestWs);
        });

        return {
            ...totals,
            wlr: ratioValue(totals.wins, totals.losses),
            kdr: ratioValue(totals.kills, totals.deaths),
            winrate: totals.games > 0
                ? totals.wins / Math.max(totals.games, 1)
                : totals.wins / Math.max(totals.wins + totals.losses, 1),
            bowAccuracy: totals.bowShots > 0 ? totals.bowHits / totals.bowShots : 0,
            meleeAccuracy: totals.meleeSwings > 0 ? totals.meleeHits / totals.meleeSwings : 0,
            modeCount: modes.length
        };
    }

    return { collectBedwarsStats, collectSkyWarsStats, collectDuelsStats, collectDuelsFamilyStats };
}

module.exports = { createStatsCollector };
