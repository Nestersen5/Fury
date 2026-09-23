'use strict';

const COLORS = { info: '§7', success: '§a', warning: '§e', error: '§c' };
function quickBuyMessage(text, tone = 'info') {
    return `§b§lQuick Buy §8» ${COLORS[tone] || COLORS.info}${text}`;
}

module.exports = { quickBuyMessage };
