'use strict';

const assert = require('assert');
const {
    parseOverlayUrchinTag,
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
assert.strictEqual(tags.length, 1, 'retired provider data is ignored');
assert.strictEqual(tags[0].addedBy, 'bblanket');
assert.strictEqual(tags[0].reasons, 'Violent Legitscaff');

const hoverComponents = buildOverlayTagComponents(tags, { clickName: 'smokoholic' });
assert.strictEqual(hoverComponents.length, 1);
assert.ok(hoverComponents[0].hoverEvent.value.includes('bblanket'));
assert.ok(hoverComponents[0].hoverEvent.value.includes('Violent Legitscaff'));
assert.ok(hoverComponents[0].hoverEvent.value.includes('2026-06-24'));

console.log('overlay tag tests passed');
