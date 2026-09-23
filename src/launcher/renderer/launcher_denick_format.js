'use strict';

const { legacyTextToSegments, MINECRAFT_LEGACY_PALETTE } = require('../../../features/minecraft_chat');
const { formatBedwarsPrestige } = require('../../stats/format');
const { getFkdrColor, getWlrColor, getWsColor } = require('../../stats/colors');
const palette = Object.fromEntries(MINECRAFT_LEGACY_PALETTE.map(color => [color.name, color.hex]));
const escape = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function legacyHtml(value) {
    return legacyTextToSegments(value).map(segment => {
        const style = [palette[segment.color] ? `color:${palette[segment.color]}` : '', segment.bold ? 'font-weight:700' : ''].filter(Boolean).join(';');
        return `<span${style ? ` style="${style}"` : ''}>${escape(segment.text)}</span>`;
    }).join('');
}

function identity(row, name) {
    const rank = row.rankPrefix == null ? escape(row.rank && !['Default', 'NONE'].includes(row.rank) ? row.rank : '') : legacyHtml(row.rankPrefix);
    const stars = row.star != null && String(row.star).trim() !== '' && Number.isFinite(Number(row.star)) ? legacyHtml(formatBedwarsPrestige(row.star)) : '';
    return `${rank ? `<span class="denick-rank">${rank}</span>` : ''}${stars ? `<span class="denick-result-stars" title="Bed Wars stars">${stars}</span>` : ''}<span class="denick-player-name">${legacyHtml(`${row.nameColor || ''}${name}`)}</span>`;
}

function statValue(key, value, ratio) {
    if (value === null) return '&mdash;';
    const color = { fkdr: getFkdrColor, wlr: getWlrColor, winstreak: getWsColor }[key];
    const prefix = color ? color(value) : key === 'losses' ? '\u00a7c' : '\u00a7a';
    return legacyHtml(`${prefix}${ratio ? value.toFixed(2) : value.toLocaleString()}`);
}

module.exports = { identity, statValue, legacyHtml };
