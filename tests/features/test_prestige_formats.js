'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { BEDWARS_LEVEL_COLOR_PALETTE, formatBedwarsPrestige, getBedwarsPrestigePalette, getBedwarsStarIcon } = require('../../src/stats/format');
const expected = (text, codes) => [...text].map((c, i) => `§${codes[i]}${c}`).join('');
assert.strictEqual(formatBedwarsPrestige(3001), expected('[3001⚝]', 'ee66cc4'));
assert.strictEqual(formatBedwarsPrestige(3199), expected('[3199✥]', '993366e'));
assert.strictEqual(formatBedwarsPrestige(4100), expected('[4100✯]', 'ee6cdd5'));
assert.strictEqual(formatBedwarsPrestige(5900), expected('[5900✯]', '7087ff7'));
assert.strictEqual(formatBedwarsPrestige(9600), expected('[9600✯]', 'eee00e0'));
assert.strictEqual(formatBedwarsPrestige(10000), expected('[10000✯]', '9bffffc4'));
assert.strictEqual(formatBedwarsPrestige(100000), expected('[100000✯]', '9bfffffc4'));
assert.strictEqual(getBedwarsStarIcon(4099), '✥');
assert.strictEqual(getBedwarsStarIcon(4100), '✯');
assert.strictEqual(Object.keys(BEDWARS_LEVEL_COLOR_PALETTE).length, 101);
for (let level = 0; level <= 10000; level += 100) {
    const palette = getBedwarsPrestigePalette(level);
    assert.ok(palette.every(code => /^§[0-9a-f]$/.test(code)));
    assert.deepStrictEqual(getBedwarsPrestigePalette(level + 99), palette);
    assert.strictEqual(formatBedwarsPrestige(level).replace(/§./g, ''), `[${level}${getBedwarsStarIcon(level)}]`);
}
// Execute the launcher helpers to verify the actual UI stays in sync.
const launcher = fs.readFileSync('launcher.html', 'utf8');
const scope = { getBedwarsPrestigePalette, MINECRAFT_STAR_SYMBOL: '✫' };
for (const name of ['getOverlayStarIcon', 'overlayStarPalette']) {
    const source = launcher.match(new RegExp(`        function ${name}\\(level\\) \\{[\\s\\S]*?\\n        \\}`));
    assert.ok(source, `${name} is present`);
    vm.runInNewContext(source[0], scope);
}
for (let level = 0; level <= 10100; level++) {
    assert.strictEqual(scope.getOverlayStarIcon(level), getBedwarsStarIcon(level));
    assert.deepStrictEqual(scope.overlayStarPalette(level), getBedwarsPrestigePalette(level));
}
console.log('Prestige formats: all tiers, boundaries, and launcher parity passed.');
