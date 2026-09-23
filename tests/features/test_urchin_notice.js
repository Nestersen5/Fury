'use strict';

const assert = require('assert');
const {
    URCHIN_DEVELOPER_NOTICE,
    diceCoefficient,
    normalizeNotice,
    isUrchinDeveloperNotice
} = require('../../src/stats/urchinNotice.js');

// Exact notice (as it arrives in a tooltip, with the metadata prefix).
const exactTooltip = `Caution (Added by Unknown 2026-07-22) - ${URCHIN_DEVELOPER_NOTICE}`;
assert.ok(isUrchinDeveloperNotice(exactTooltip), 'exact developer notice tooltip should match');

// ~95% similar variants (different date, minor wording, dropped sentence).
assert.ok(isUrchinDeveloperNotice(
    'Caution (Added by System 2026-07-30) - Notice for the developer of this service: the Urchin API is deprecated and shuts down on August 1. Migrate to the new API - docs: https://api.urchin.gg'
), 'notice with a different date/wording should still match');

assert.ok(isUrchinDeveloperNotice(
    '§eCaution §7(Added by Unknown 2026-07-22) - the Urchin API is deprecated and will shut down soon. Please migrate to the new API'
), 'color-coded, shortened notice should still match via keywords');

// Genuine cheat/report tags must NOT be treated as the notice.
assert.ok(!isUrchinDeveloperNotice('Blatant (Added by Mod 2026-01-01) - scaffold, killaura, autoclicker'), 'blatant cheat tag is not the notice');
assert.ok(!isUrchinDeveloperNotice('Caution (Added by Nester 2026-05-01) - ping abuse suspected'), 'a normal caution tag is not the developer notice');
assert.ok(!isUrchinDeveloperNotice('Blacklisted (Added by Admin 2026-02-02) - banned for cheating'), 'blacklist tag is not the notice');
assert.ok(!isUrchinDeveloperNotice(''), 'empty text is not the notice');

// Sanity on the primitives.
assert.strictEqual(diceCoefficient('abc', 'abc'), 1, 'identical strings score 1');
assert.strictEqual(diceCoefficient('abc', 'xyz'), 0, 'disjoint strings score 0');
assert.ok(normalizeNotice('Foo (Added by Bob 2026-07-22) - Bar').indexOf('added by') === -1, 'metadata block is stripped during normalization');

console.log('test_urchin_notice: all assertions passed');
