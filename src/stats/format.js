'use strict';

// Numeric + prestige formatters shared across the stats pipeline (collect,
// render, lookup) and a couple of overlay call sites. Pure functions
// except for the two SkyWars level helpers, which need stripAnsi to peel
// color codes out of `sw.levelFormatted`; that comes from the existing
// minecraft_chat feature module.

const { stripAnsi } = require('../../features/minecraft_chat.js');

const MINECRAFT_STAR_SYMBOL = '✫';

const BEDWARS_LEVEL_COLOR_PALETTE = {
    0: ['§7', '§7', '§7', '§7', '§7', '§7', '§7'],
    100: ['§f', '§f', '§f', '§f', '§f', '§f', '§f'],
    200: ['§6', '§6', '§6', '§6', '§6', '§6', '§6'],
    300: ['§b', '§b', '§b', '§b', '§b', '§b', '§b'],
    400: ['§2', '§2', '§2', '§2', '§2', '§2', '§2'],
    500: ['§3', '§3', '§3', '§3', '§3', '§3', '§3'],
    600: ['§4', '§4', '§4', '§4', '§4', '§4', '§4'],
    700: ['§d', '§d', '§d', '§d', '§d', '§d', '§d'],
    800: ['§9', '§9', '§9', '§9', '§9', '§9', '§9'],
    900: ['§5', '§5', '§5', '§5', '§5', '§5', '§5'],
    1000: ['§c', '§6', '§e', '§a', '§b', '§d', '§5'],
    1100: ['§7', '§f', '§f', '§f', '§f', '§f', '§7'],
    1200: ['§7', '§e', '§e', '§e', '§e', '§6', '§7'],
    1300: ['§7', '§b', '§b', '§b', '§b', '§3', '§7'],
    1400: ['§7', '§a', '§a', '§a', '§a', '§2', '§7'],
    1500: ['§7', '§3', '§3', '§3', '§3', '§9', '§7'],
    1600: ['§7', '§c', '§c', '§c', '§c', '§4', '§7'],
    1700: ['§7', '§d', '§d', '§d', '§d', '§5', '§7'],
    1800: ['§7', '§9', '§9', '§9', '§9', '§1', '§7'],
    1900: ['§7', '§5', '§5', '§5', '§5', '§d', '§7'],
    2000: ['§8', '§7', '§f', '§f', '§7', '§7', '§8'],
    2100: ['§f', '§f', '§e', '§e', '§6', '§6', '§6'],
    2200: ['§6', '§6', '§f', '§f', '§b', '§3', '§3'],
    2300: ['§5', '§5', '§d', '§d', '§6', '§e', '§e'],
    2400: ['§b', '§b', '§f', '§f', '§7', '§7', '§8'],
    2500: ['§f', '§f', '§a', '§a', '§2', '§2', '§2'],
    2600: ['§4', '§4', '§c', '§c', '§d', '§d', '§5'],
    2700: ['§e', '§e', '§f', '§f', '§8', '§8', '§8'],
    2800: ['§a', '§a', '§2', '§2', '§6', '§6', '§e'],
    2900: ['§b', '§b', '§3', '§3', '§9', '§9', '§1'],
    3000: ['§e', '§e', '§6', '§6', '§c', '§c', '§4'],
    // 3100–10000 transcribed from the supplied prestige reference.
    3100: ['§9', '§9', '§3', '§3', '§6', '§6', '§e'],
    3200: ['§c', '§4', '§7', '§7', '§4', '§c', '§c'],
    3300: ['§9', '§9', '§9', '§d', '§c', '§c', '§4'],
    3400: ['§2', '§a', '§d', '§d', '§5', '§5', '§2'],
    3500: ['§c', '§c', '§4', '§4', '§2', '§a', '§a'],
    3600: ['§a', '§a', '§a', '§b', '§9', '§9', '§1'],
    3700: ['§4', '§4', '§c', '§c', '§b', '§3', '§3'],
    3800: ['§1', '§1', '§9', '§5', '§5', '§d', '§1'],
    3900: ['§c', '§c', '§a', '§a', '§3', '§9', '§9'],
    4000: ['§5', '§5', '§c', '§c', '§6', '§6', '§e'],
    4100: ['§e', '§e', '§6', '§c', '§d', '§d', '§5'],
    4200: ['§1', '§9', '§3', '§b', '§f', '§7', '§7'],
    4300: ['§0', '§5', '§8', '§8', '§5', '§5', '§0'],
    4400: ['§2', '§2', '§a', '§e', '§6', '§5', '§d'],
    4500: ['§f', '§f', '§b', '§b', '§3', '§3', '§3'],
    4600: ['§3', '§b', '§e', '§6', '§6', '§d', '§5'],
    4700: ['§f', '§4', '§c', '§c', '§9', '§1', '§9'],
    4800: ['§5', '§5', '§c', '§6', '§6', '§b', '§3'],
    4900: ['§2', '§a', '§f', '§f', '§f', '§a', '§2'],
    5000: ['§4', '§4', '§5', '§9', '§9', '§1', '§0'],
    5100: ['§4', '§c', '§c', '§6', '§e', '§f', '§4'],
    5200: ['§1', '§9', '§3', '§b', '§f', '§e', '§1'],
    5300: ['§5', '§d', '§e', '§f', '§e', '§d', '§5'],
    5400: ['§3', '§a', '§2', '§8', '§2', '§a', '§3'],
    5500: ['§2', '§a', '§e', '§f', '§b', '§d', '§5'],
    5600: ['§4', '§c', '§e', '§f', '§e', '§c', '§4'],
    5700: ['§4', '§6', '§2', '§3', '§9', '§5', '§8'],
    5800: ['§5', '§c', '§6', '§f', '§b', '§3', '§9'],
    5900: ['§7', '§0', '§8', '§7', '§f', '§f', '§7'],
    6000: ['§c', '§f', '§f', '§f', '§f', '§c', '§f'],
    6100: ['§6', '§e', '§f', '§f', '§f', '§b', '§3'],
    6200: ['§e', '§f', '§e', '§6', '§6', '§f', '§e'],
    6300: ['§a', '§e', '§e', '§e', '§e', '§a', '§2'],
    6400: ['§b', '§b', '§c', '§c', '§c', '§a', '§a'],
    6500: ['§3', '§3', '§a', '§a', '§f', '§a', '§3'],
    6600: ['§9', '§d', '§d', '§d', '§d', '§b', '§9'],
    6700: ['§5', '§d', '§d', '§d', '§d', '§f', '§5'],
    6800: ['§0', '§6', '§6', '§e', '§e', '§f', '§f'],
    6900: ['§a', '§a', '§a', '§a', '§2', '§2', '§8'],
    7000: ['§3', '§b', '§b', '§b', '§b', '§f', '§3'],
    7100: ['§4', '§c', '§6', '§e', '§c', '§6', '§e'],
    7200: ['§2', '§a', '§f', '§2', '§a', '§f', '§8'],
    7300: ['§2', '§3', '§3', '§b', '§b', '§a', '§2'],
    7400: ['§8', '§8', '§8', '§8', '§8', '§d', '§8'],
    7500: ['§6', '§6', '§2', '§2', '§f', '§f', '§f'],
    7600: ['§f', '§f', '§f', '§7', '§7', '§c', '§8'],
    7700: ['§d', '§c', '§c', '§c', '§c', '§6', '§d'],
    7800: ['§8', '§7', '§f', '§f', '§f', '§e', '§8'],
    7900: ['§6', '§f', '§2', '§6', '§2', '§f', '§6'],
    8000: ['§2', '§a', '§a', '§a', '§c', '§4', '§2'],
    8100: ['§8', '§7', '§f', '§b', '§3', '§9', '§1'],
    8200: ['§f', '§f', '§f', '§f', '§f', '§a', '§f'],
    8300: ['§8', '§8', '§4', '§4', '§c', '§c', '§8'],
    8400: ['§f', '§d', '§d', '§d', '§a', '§a', '§f'],
    8500: ['§3', '§6', '§6', '§6', '§6', '§e', '§3'],
    8600: ['§d', '§f', '§f', '§f', '§f', '§e', '§d'],
    8700: ['§8', '§6', '§6', '§6', '§6', '§6', '§8'],
    8800: ['§4', '§4', '§4', '§c', '§c', '§f', '§f'],
    8900: ['§9', '§b', '§b', '§b', '§3', '§3', '§9'],
    9000: ['§d', '§d', '§d', '§d', '§d', '§5', '§8'],
    9100: ['§0', '§c', '§6', '§6', '§c', '§c', '§4'],
    9200: ['§2', '§d', '§d', '§d', '§d', '§a', '§2'],
    9300: ['§f', '§8', '§8', '§8', '§8', '§f', '§f'],
    9400: ['§e', '§6', '§4', '§8', '§8', '§8', '§8'],
    9500: ['§0', '§0', '§8', '§8', '§7', '§7', '§f'],
    9600: ['§e', '§e', '§e', '§0', '§0', '§e', '§0'],
    9700: ['§d', '§d', '§d', '§e', '§e', '§b', '§e'],
    9800: ['§0', '§8', '§8', '§8', '§8', '§8', '§0'],
    9900: ['§8', '§7', '§f', '§f', '§f', '§e', '§f'],
    10000: ['§9', '§b', '§f', '§f', '§f', '§f', '§c', '§4']
};

function formatInt(value) {
    return Math.round(Number(value) || 0).toLocaleString('en-US');
}

function formatRatio(value) {
    return (Number(value) || 0).toFixed(2);
}

function formatSigned(value, digits = 0) {
    const number = Number(value) || 0;
    const fixed = digits > 0 ? number.toFixed(digits) : Math.round(number).toString();
    return number > 0 ? `+${fixed}` : fixed;
}

function formatDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

function getBedwarsStarIcon(level) {
    const safeLevel = Number.isFinite(Number(level)) ? Math.max(0, Math.floor(Number(level))) : 0;
    if (safeLevel >= 4100) return '✯';
    if (safeLevel >= 3100) return '✥';
    if (safeLevel >= 2100) return '⚝';
    if (safeLevel >= 1100) return '✪';
    return MINECRAFT_STAR_SYMBOL;
}

// Continue the final prestige above 10000, keeping the star and closing bracket colors.
function getBedwarsPrestigePalette(level) {
    const safeLevel = Number.isFinite(Number(level)) ? Math.max(0, Math.floor(Number(level))) : 0;
    const prestige = Math.min(10000, Math.floor(safeLevel / 100) * 100);
    const palette = BEDWARS_LEVEL_COLOR_PALETTE[prestige];
    const extraDigits = String(safeLevel).length - 5;
    return extraDigits > 0
        ? [...palette.slice(0, -2), ...Array(extraDigits).fill(palette[5]), ...palette.slice(-2)]
        : palette;
}

function formatBedwarsPrestige(level) {
    const safeLevel = Number.isFinite(Number(level)) ? Math.max(0, Math.floor(Number(level))) : 0;
    const text = `[${safeLevel}${getBedwarsStarIcon(safeLevel)}]`;
    const palette = getBedwarsPrestigePalette(safeLevel);
    if (!palette) return text;
    return Array.from(text).map((char, index) => `${palette[index] || palette[palette.length - 1] || '§0'}${char}`).join('');
}

function getSkyWarsLevelValue(sw = {}, player = {}) {
    const achievementLevel = player.achievements?.skywars_you_re_a_star;
    if (Number.isFinite(Number(achievementLevel))) return Number(achievementLevel);
    if (Number.isFinite(Number(sw.level))) return Number(sw.level);

    const formatted = stripAnsi(String(sw.levelFormatted || ''));
    const match = formatted.match(/(\d+(?:\.\d+)?)/);
    return match ? Number(match[1]) : 0;
}

function formatSkyWarsLevel(sw = {}, player = {}) {
    const formatted = sw.levelFormatted;
    if (formatted) return String(formatted).replace(/\*/g, MINECRAFT_STAR_SYMBOL);

    const rawLevel = getSkyWarsLevelValue(sw, player) || 1;
    return `§7[${rawLevel}${MINECRAFT_STAR_SYMBOL}]`;
}

module.exports = {
    MINECRAFT_STAR_SYMBOL,
    BEDWARS_LEVEL_COLOR_PALETTE,
    formatInt,
    formatRatio,
    formatSigned,
    formatDuration,
    getBedwarsStarIcon,
    formatBedwarsPrestige,
    getBedwarsPrestigePalette,
    getSkyWarsLevelValue,
    formatSkyWarsLevel
};
