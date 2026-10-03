'use strict';

// Minecraft 1.8.9 ServerSelectionList is 305px wide and reserves 34px beside
// the icon for the MOTD. These widths match the default 1.8.9 ASCII font.
const MOTD_WIDTH = 271;
const SPACE_WIDTH = 4;
const RAINBOW_COLORS = ['c', '6', 'e', 'a', 'b', '9', 'd'];

function minecraftTextWidth(text, bold = false) {
    let width = 0;
    for (const char of text) {
        if (char === ' ') width += SPACE_WIDTH;
        else if ('!.,:;i|'.includes(char)) width += 2;
        else if ("'`l".includes(char)) width += 3;
        else if ('[]It'.includes(char)) width += 4;
        else if ('"()*<>fk{}'.includes(char)) width += 5;
        else if ('@~'.includes(char)) width += 7;
        else width += 6;
        if (bold) width += 1;
    }
    return width;
}

function rainbowText(text) {
    const characters = Array.from(text);
    let previousColor = '';
    return characters.map((character, index) => {
        const color = RAINBOW_COLORS[Math.floor(index * RAINBOW_COLORS.length / characters.length)];
        const prefix = color === previousColor ? '' : `§${color}`;
        previousColor = color;
        return prefix + character;
    }).join('');
}

function createProxyStatus({ host, port = 25565 }) {
    const targetHost = String(host || '').trim().replace(/[\r\n§]/g, '');
    const targetAddress = Number(port) === 25565 ? targetHost
        : `${targetHost.includes(':') && !targetHost.startsWith('[') ? `[${targetHost}]` : targetHost}:${port}`;
    const title = 'FURY PROXY';
    const titleWidth = minecraftTextWidth(title, true);
    const titleSpaces = Math.max(0, Math.floor((MOTD_WIDTH - titleWidth) / (2 * SPACE_WIDTH)));
    const titleCenter = titleSpaces * SPACE_WIDTH + titleWidth / 2;
    const addressSpaces = Math.max(0, Math.round((titleCenter - minecraftTextWidth(targetAddress) / 2) / SPACE_WIDTH));
    // The 1.8.9 wrapper carries formatting across newlines. Reset bold before
    // the address padding so its spaces keep their normal four-pixel width.
    const motd = `${' '.repeat(titleSpaces)}§6§l${title}\n§r${' '.repeat(addressSpaces)}${rainbowText(targetAddress)}`;

    function beforePing(response) {
        response.description = { text: motd };
        return response;
    }

    return { motd, beforePing };
}

module.exports = { createProxyStatus };
