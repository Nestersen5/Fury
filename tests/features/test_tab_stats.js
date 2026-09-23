'use strict';

const assert = require('assert');
const {
    shouldRenderNickedBedwarsStars,
    buildNickedBedwarsTabColumns
} = require('../../src/stats/tabStats.js');
const { formatBedwarsPrestige } = require('../../src/stats/format.js');
const {
    isTransientPlayerLookupFailure,
    isConfirmedPlayerLookupFailure
} = require('../../src/stats/lookupStatus.js');

const levelZero = formatBedwarsPrestige(0);

assert.strictEqual(
    shouldRenderNickedBedwarsStars(['stars', 'name', 'fkdr']),
    true,
    'nicked BedWars rows use a dummy level when stars precedes name'
);
assert.strictEqual(
    shouldRenderNickedBedwarsStars(['tags', 'stars', 'name']),
    true,
    'the rule follows relative field order, even when another field comes first'
);
assert.strictEqual(
    shouldRenderNickedBedwarsStars(['name', 'stars', 'fkdr']),
    false,
    'name-first BedWars rows keep the existing nick rendering'
);
assert.strictEqual(
    shouldRenderNickedBedwarsStars(['stars', 'fkdr']),
    false,
    'a stars field without a rendered name is not treated as stars-before-name'
);

assert.deepStrictEqual(
    buildNickedBedwarsTabColumns(['stars', 'name', 'fkdr'], levelZero, 'NAME [NICK]'),
    [
        { field: 'stars', text: levelZero },
        { field: 'name', text: 'NAME [NICK]' }
    ],
    'nicked rows retain the configured stars/name order and use the real level-zero formatter'
);
assert.deepStrictEqual(
    buildNickedBedwarsTabColumns(['name', 'stars'], levelZero, 'NAME [NICK]'),
    [],
    'name-first nick rows do not gain a dummy level'
);

assert.strictEqual(
    isTransientPlayerLookupFailure({ lookupFailed: true, lookupErrorType: 'hypixel_api_error' }),
    true,
    'temporary Hypixel service failures may preserve a confirmed nick'
);
assert.strictEqual(
    isConfirmedPlayerLookupFailure({ lookupFailed: true, lookupErrorType: 'hypixel_api_error' }),
    false,
    'temporary Hypixel service failures are not treated as definitive player failures'
);
assert.strictEqual(
    isConfirmedPlayerLookupFailure({ lookupFailed: true, lookupErrorType: 'hypixel_key_failed' }),
    true,
    'non-transient lookup failures clear nick precedence'
);
assert.strictEqual(
    isConfirmedPlayerLookupFailure({ lookupFailed: true }),
    true,
    'an unclassified lookup failure fails closed instead of fabricating a nick'
);
assert.strictEqual(
    isConfirmedPlayerLookupFailure({ lookupFailed: true, isNicked: true }),
    true,
    'a definitive failure remains authoritative even if a stale nick flag is also present'
);

console.log('Tab stats nick-field tests passed.');

const { resolveTabPing } = require('../../src/stats/tabStats.js');
assert.strictEqual(resolveTabPing({ avgPing: 40, ping: 45 }), 40, 'tab ping uses the Aurora average shown by /stats and nametags');
assert.strictEqual(resolveTabPing({ avgPing: -1, ping: 45 }), null, 'missing Aurora average hides the column');
assert.strictEqual(resolveTabPing({ avgPing: 0 }), null, 'zero is not a known ping');
assert.strictEqual(resolveTabPing(null), null, 'missing Aurora data hides the column');
