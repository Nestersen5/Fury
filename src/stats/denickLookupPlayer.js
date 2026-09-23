'use strict';

const { getHypixelRankLabel, getHypixelRankPrefix, getHypixelRankNameColor } = require('../../features/minecraft_chat');

function lookupPlayerStats(player) {
    const bw = player.stats?.Bedwars;
    const result = { rank: getHypixelRankLabel(player), rankPrefix: getHypixelRankPrefix(player), nameColor: getHypixelRankNameColor(player) };
    if (player.achievements?.bedwars_level != null) result.star = player.achievements.bedwars_level;
    if (!bw) return result;
    for (const [field, source] of Object.entries({ finals: 'final_kills_bedwars', beds: 'beds_broken_bedwars', wins: 'wins_bedwars', losses: 'losses_bedwars' })) {
        result[field] = Number(bw[source]) || 0;
    }
    result.fkdr = result.finals / Math.max(1, Number(bw.final_deaths_bedwars) || 0);
    result.bblr = result.beds / Math.max(1, Number(bw.beds_lost_bedwars) || 0);
    result.wlr = result.wins / Math.max(1, result.losses);
    // Winstreak can be hidden by the player; missing is not a zero streak.
    result.winstreak = bw.winstreak == null ? null : Number(bw.winstreak);
    return result;
}

module.exports = { lookupPlayerStats };
