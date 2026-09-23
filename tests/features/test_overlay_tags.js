'use strict';

const assert = require('assert');
const {
    parseOverlayUrchinTag,
    parseOverlaySeraphTag,
    createOverlayTagBuilder
} = require('../../src/overlay/tags.js');
const { buildOverlayTagComponents } = require('../../src/overlay/chat_overlay_annotation.js');

// This is the real tooltip shape observed for smokoholic. The period after
// the username is valid provider punctuation and must not erase the metadata.
const smokoholic = parseOverlayUrchinTag({
    tooltip: 'Sniper (Added by bblanket. 2026-06-24) - Violent Legitscaff, AB, Backtrack, Blink, Lagrange, nuke, ect.'
});
assert.deepStrictEqual(
    {
        value: smokoholic.value,
        addedBy: smokoholic.addedBy,
        reasons: smokoholic.reasons,
        when: smokoholic.when
    },
    {
        value: 'Sniper',
        addedBy: 'bblanket',
        reasons: 'Violent Legitscaff, AB, Backtrack, Blink, Lagrange, nuke, ect.',
        when: '2026-06-24'
    },
    'Urchin metadata with punctuation must parse'
);

// The non-punctuated form used by hilr remains compatible.
const hilr = parseOverlayUrchinTag({
    tooltip: 'Closet Cheater (Added by wafflerdot 2025-12-28) - harmful legit scaff, blink'
});
assert.strictEqual(hilr.addedBy, 'wafflerdot');
assert.strictEqual(hilr.when, '2025-12-28');
assert.strictEqual(hilr.reasons, 'harmful legit scaff, blink');

const seraph = parseOverlaySeraphTag({
    tagged: true,
    report_type: 'Velocity',
    tooltip: 'Velocity: Consistent abnormal knockback (2026-08-11 by PreviewAuditor)'
});
assert.deepStrictEqual(
    { value: seraph.value, addedBy: seraph.addedBy, reasons: seraph.reasons, when: seraph.when },
    {
        value: 'Velocity',
        addedBy: 'PreviewAuditor',
        reasons: 'Consistent abnormal knockback',
        when: '2026-08-11'
    },
    'Seraph tooltip metadata must remain available'
);

const seraphWithIntermediateMarker = parseOverlaySeraphTag({
    tagged: true,
    report_type: 'Closet',
    tooltip: 'Closet Cheating: legitscaff, visuals, more ( Upgraded ) ( 1 month ago by remmies )'
});
assert.strictEqual(seraphWithIntermediateMarker.addedBy, 'remmies');
assert.strictEqual(seraphWithIntermediateMarker.when, '1 month ago');
assert.strictEqual(seraphWithIntermediateMarker.reasons, 'legitscaff, visuals, more ( Upgraded )');

const structuredSeraph = parseOverlaySeraphTag({
    tagged: true,
    report_type: 'Sniper',
    reason: 'replay evidence',
    timestamp: 1780000000000
});
assert.strictEqual(structuredSeraph.reasons, 'replay evidence');
assert.notStrictEqual(structuredSeraph.when, 'Unknown');

const builder = createOverlayTagBuilder({ compactTagName: value => String(value || '').slice(0, 10) });
const tags = builder.buildOverlayTags({
    urchin: { ok: true, rawTags: [{
        tooltip: 'Sniper (Added by bblanket. 2026-06-24) - Violent Legitscaff'
    }] },
    seraph: {
        tagged: true,
        report_type: 'Velocity',
        tooltip: 'Velocity: Consistent abnormal knockback (2026-08-11 by PreviewAuditor)'
    }
});
assert.strictEqual(tags.length, 2);
assert.strictEqual(tags[0].addedBy, 'bblanket');
assert.strictEqual(tags[0].reasons, 'Violent Legitscaff');
assert.strictEqual(tags[1].addedBy, 'PreviewAuditor');

const hoverComponents = buildOverlayTagComponents(tags, { clickName: 'smokoholic' });
assert.strictEqual(hoverComponents.length, 2);
assert.ok(hoverComponents[0].hoverEvent.value.includes('bblanket'));
assert.ok(hoverComponents[0].hoverEvent.value.includes('Violent Legitscaff'));
assert.ok(hoverComponents[0].hoverEvent.value.includes('2026-06-24'));
assert.ok(hoverComponents[1].hoverEvent.value.includes('PreviewAuditor'));
assert.ok(hoverComponents[1].hoverEvent.value.includes('Consistent abnormal knockback'));

console.log('overlay tag tests passed');
