'use strict';

// Color thresholds for stat ratios + ping. Pure look-ups; the comparable
// table in stats_utils.js (loaded by the launcher overlay) intentionally
// stays separate — the launcher imports that file standalone and we don't
// want it dragging proxy.js's module tree in.

function getFkdrColor(fkdr) {
    if (fkdr < 1) return '§7';
    if (fkdr < 3) return '§a';
    if (fkdr < 6) return '§2';
    if (fkdr < 10) return '§e';
    if (fkdr < 15) return '§6';
    return '§4';
}

function getWlrColor(wlr) {
    if (wlr < 1) return '§7';
    if (wlr < 3) return '§a';
    if (wlr < 5) return '§6';
    return '§4';
}

function getKdrColor(kdr) {
    if (kdr < 1) return '§7';
    if (kdr < 3) return '§a';
    if (kdr < 6) return '§2';
    if (kdr < 10) return '§e';
    return '§4';
}

function getWsColor(ws) {
    if (ws === 0) return '§7';
    if (ws < 5) return '§a';
    if (ws < 10) return '§6';
    return '§4';
}

function getPingColor(p) {
    return p < 0 ? '§7' : p < 80 ? '§a' : p < 140 ? '§e' : '§c';
}

// Single-color compact prestige color for the nametag star stat, where the
// full multi-color prestige formatting would blow the 16-char team-field limit.
// One representative § code per 100-star tier.
function getBedwarsStarColor(stars) {
    const s = Math.max(0, Number(stars) || 0);
    if (s < 100) return '§7';
    if (s < 200) return '§f';
    if (s < 300) return '§6';
    if (s < 400) return '§b';
    if (s < 500) return '§2';
    if (s < 600) return '§3';
    if (s < 700) return '§4';
    if (s < 800) return '§d';
    if (s < 900) return '§9';
    if (s < 1000) return '§5';
    return '§6';
}

// Duels card palette. One quality gradient shared by WLR/KDR (and any Duels
// ratio) that climbs gray -> white -> green -> aqua -> gold -> magenta, topping
// out in the Duels accent instead of the "error"-looking dark red the generic
// getWlrColor/getWsColor use. Purely a display choice for the /duels + Duels
// /scan surface; the Bedwars/SkyWars threat colors are left untouched.
function getDuelsRatioColor(value) {
    const v = Number(value) || 0;
    if (v < 1) return '§7';
    if (v < 2) return '§f';
    if (v < 3) return '§a';
    if (v < 5) return '§b';
    if (v < 8) return '§6';
    return '§d';
}

// Winrate takes a 0..1 ratio (wins / games).
function getWinrateColor(ratio) {
    const r = Number(ratio) || 0;
    if (r < 0.40) return '§7';
    if (r < 0.50) return '§f';
    if (r < 0.60) return '§a';
    if (r < 0.70) return '§b';
    if (r < 0.80) return '§6';
    return '§d';
}

// Winstreak on the same warm-at-the-top scale — gold for a strong best streak,
// never dark red.
function getDuelsWinstreakColor(ws) {
    const v = Number(ws) || 0;
    if (v <= 0) return '§7';
    if (v < 5) return '§a';
    if (v < 10) return '§b';
    if (v < 25) return '§6';
    return '§d';
}

module.exports = {
    getFkdrColor,
    getWlrColor,
    getKdrColor,
    getWsColor,
    getPingColor,
    getBedwarsStarColor,
    getDuelsRatioColor,
    getWinrateColor,
    getDuelsWinstreakColor
};
