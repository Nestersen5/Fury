'use strict';

const { formatBedwarsPrestige } = require('./format');
const { getFkdrColor, getWlrColor, getWsColor } = require('./colors');

function getBedwarsScanStats(player = {}) {
    const bw = player.stats?.Bedwars || {};
    return {
        stars: player.achievements?.bedwars_level || 0,
        fkdr: (bw.final_kills_bedwars || 0) / Math.max(bw.final_deaths_bedwars || 1, 1),
        wlr: (bw.wins_bedwars || 0) / Math.max(bw.losses_bedwars || 1, 1),
        ws: bw.winstreak || 0
    };
}

// Keep automatic denick results and /scan on the same compact stat line.
function formatBedwarsScanLine({ stars = 0, fkdr = 0, wlr = 0, ws = 0 }, name, marker = '§a✔') {
    return `${formatBedwarsPrestige(stars)} ${name}§r ${marker}  §fFKDR: ${getFkdrColor(fkdr)}${fkdr.toFixed(2)}§r  §fWLR: ${getWlrColor(wlr)}${wlr.toFixed(2)}§r  §fWS: ${getWsColor(ws)}${ws}§r`;
}

module.exports = { getBedwarsScanStats, formatBedwarsScanLine };
