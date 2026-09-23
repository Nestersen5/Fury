'use strict';

const assert = require('assert');
const {
    buildNametagFields,
    formatNametagStat,
    formatNametagSlot,
    nametagRowHasTag,
    normalizeNametagStat,
    normalizeNametagFallback,
    nametagStatSource,
    nametagSessionPeriod,
    NAMETAG_STAT_TYPES,
    clampField,
    cleanNametagText,
    pickNametagTag,
    NAMETAG_TAG_DISPLAY_MODES,
    NAMETAG_TAG_SOURCE_COLORS,
    NAMETAG_TAG_DEFINITIONS,
    NAMETAG_TAG_ICONS,
    NAMETAG_NICK_DEFINITION,
    normalizeNametagTagDisplayMode,
    nametagIconForTag,
    nametagTagSourceColor,
    formatNametagNick,
    formatNametagTagValue,
    MAX_TEAM_FIELD,
    nametagTeamName,
    assignNametagTeamNames,
    composeBedwarsNametagPrefix
} = require('../../src/overlay/nametags.js');
const {
    ENTITY_FLAG_INVISIBLE,
    createEntityTracker,
    entityMetadataFlags
} = require('../../src/net/session/entityTracking.js');

const compactTagName = (tag) => {
    if (!tag || typeof tag !== 'string') return '';
    const clean = tag.replace(/[\[\]\(\)]/g, '').trim();
    const parts = clean.split(/[:\-\s]+/).filter(Boolean);
    if (parts[0] && parts[0].toLowerCase() === 'legacy' && parts[1]) return parts[1].slice(0, 10);
    return (parts[0] || clean).slice(0, 10);
};

const isLikelyBot = (name) => /^[a-z0-9]{10}$/.test(String(name || ''));

const row = (over = {}) => ({
    name: 'Notch',
    isNicked: false,
    lookupFailed: false,
    tags: [],
    stats: {},
    ...over
});

// Build with an explicit audience config and assert the 16-char field budget.
function build(r, audience = { prefixStat: 'none', suffixStat: 'fkdr' }, prefixBudget = MAX_TEAM_FIELD) {
    const fields = buildNametagFields(r, { compactTagName, isLikelyBot, priority: 'urchin', audience, prefixBudget });
    for (const fieldName of ['prefixExtra', 'suffix']) {
        const value = fields[fieldName] || '';
        assert.ok(value.length <= MAX_TEAM_FIELD, `${fieldName} "${value}" exceeds ${MAX_TEAM_FIELD} (${value.length})`);
        assert.ok(!value.endsWith('§'), `${fieldName} "${value}" ends with a dangling section sign`);
    }
    return fields;
}

// --- stat normalization ---
assert.strictEqual(normalizeNametagStat('FKDR'), 'fkdr');
assert.strictEqual(normalizeNametagStat('stars'), 'star');
assert.strictEqual(normalizeNametagStat('nonsense', 'kdr'), 'kdr');
assert.strictEqual(normalizeNametagStat('ping'), 'ping');
assert.strictEqual(normalizeNametagStat('avgPing'), 'ping');
assert.strictEqual(normalizeNametagStat('latency'), 'ping');
assert.strictEqual(normalizeNametagStat('ms'), 'ping');
assert.strictEqual(normalizeNametagStat('monthlywins'), 'mwins');
assert.strictEqual(nametagStatSource('star'), 'hypixel');

assert.strictEqual(
    composeBedwarsNametagPrefix('§c', 'R', '§b225✫'),
    '§b225✫§r §cR ',
    'the custom prefix renders before Hypixel\'s colored team letter'
);
assert.strictEqual(
    composeBedwarsNametagPrefix('§c', 'R'),
    '§cR ',
    'the vanilla team-letter prefix is unchanged when no custom prefix is configured'
);
assert.strictEqual(
    composeBedwarsNametagPrefix('§c', 'R', '§b[385✫]'),
    '§b[385✫] §cR ',
    'a bracketed star keeps a visible gap before the team letter inside the 16-character BedWars prefix'
);
assert.strictEqual(
    composeBedwarsNametagPrefix('§c', 'R', '§c[§61020✫]'),
    '§c[§61020✫] §cR ',
    'a four-digit star keeps the full level, separator, and team letter instead of abbreviating the level'
);
assert.strictEqual(
    composeBedwarsNametagPrefix('§c', 'R', '§7[§b1385✪§3]'),
    '§7[§b1385✪] §cR ',
    'the closing bracket color is spent - not the team letter - when the prefix would not otherwise fit'
);
assert.strictEqual(nametagStatSource('ping'), 'aurora');
assert.strictEqual(nametagStatSource('wfkdr'), 'coral');
assert.strictEqual(nametagSessionPeriod('mfinals'), 'monthly');
assert.strictEqual(normalizeNametagFallback('fkdr', 'star'), 'none', 'same-source Hypixel fallback must be rejected');
assert.strictEqual(normalizeNametagFallback('tag', 'star'), 'star', 'different-source fallback remains valid');
['finaldeaths', 'bedslost', 'losses', 'kills', 'deaths', 'games', 'dfkdr', 'wfkdr', 'mfkdr'].forEach(stat => {
    assert(NAMETAG_STAT_TYPES.includes(stat), `expanded nametag stat must include ${stat}`);
});

// --- guards ---
assert.deepStrictEqual(build(null), { prefixExtra: '', suffix: '' }, 'null row -> empty');
assert.deepStrictEqual(build(row({ lookupFailed: true })), { prefixExtra: '', suffix: '' }, 'lookup failure -> empty');
assert.deepStrictEqual(
    buildNametagFields(row({ stats: { fkdr: 5 } }), { compactTagName, isLikelyBot }),
    { prefixExtra: '', suffix: '' },
    'no audience -> empty (audience required)'
);

// --- nicked players ---
assert.deepStrictEqual(
    build(row({ isNicked: true })),
    { prefixExtra: '', suffix: ' §c[NICK]' },
    'nick -> fixed light-red [NICK] marker'
);
assert.deepStrictEqual(
    build(row({ isNicked: true, lookupFailed: true })),
    { prefixExtra: '', suffix: ' §c[NICK]' },
    'a transient lookup failure must not hide a confirmed nick marker'
);
assert.strictEqual(formatNametagNick('acronyms'), '§c[NICK]', 'nick marker stays light red in acronym mode');
assert.strictEqual(formatNametagNick('full'), '§c[NICK]', 'nick marker stays fixed in full mode');
assert.deepStrictEqual(build(row({ name: 'a1b2c3d4e5', isNicked: true })), { prefixExtra: '', suffix: '' }, 'likely-bot nick left vanilla');

// --- suffix stat ---
assert.deepStrictEqual(
    build(row({ stats: { fkdr: 1.5 } }), { prefixStat: 'none', suffixStat: 'fkdr' }),
    { prefixExtra: '', suffix: ' §a1.50' },
    'suffix FKDR renders a colored 2-decimal value'
);

// --- prefix + suffix together ---
assert.deepStrictEqual(
    build(row({ stats: { stars: 305, kdr: 2.1 } }), { prefixStat: 'star', suffixStat: 'kdr' }),
    { prefixExtra: '§b[305✫]', suffix: ' §a2.10' },
    'a prefix star wears the same prestige palette /stats gives it, brackets included'
);
assert.strictEqual(
    formatNametagStat('star', row({ stats: { stars: 385 } })),
    '§b[385✫]',
    'BedWars stars are bracketed in their own prestige color, not in gray'
);
assert.strictEqual(
    formatNametagStat('star', row({ stats: { stars: 385 } }), { starBracketsEnabled: false }),
    '§b385✫',
    'the star bracket setting can restore the unwrapped format'
);
assert.deepStrictEqual(
    buildNametagFields(row({ stats: { stars: 385 } }), {
        audience: { prefixStat: 'star', suffixStat: 'none' },
        starBracketsEnabled: true,
        prefixBudget: 9,
        coloredStarPrefixBudget: 14
    }),
    { prefixExtra: '§b[385✫]', suffix: '' },
    'a tight BedWars prefix still carries the whole prestige, palette and all'
);
{
    const fields = buildNametagFields(row({ stats: { stars: 1385 } }), {
        audience: { prefixStat: 'star', suffixStat: 'none' },
        starBracketsEnabled: true,
        prefixBudget: 9,
        coloredStarPrefixBudget: 14
    });
    assert.strictEqual(fields.prefixExtra, '§7[§b1385✪]', 'a four-digit prestige keeps its multi-color palette and its own star icon');
    assert(!fields.prefixExtra.includes('k'), 'star levels are never abbreviated');
}

// --- prestige rendering matches /stats -----------------------------------
// The nametag is the only surface with a 16-character field, so it encodes the
// palette differently (a color code only where the color changes). What the
// player sees must still be what /stats and the tab list show them.
{
    const { formatBedwarsPrestige } = require('../../src/stats/format.js');
    // Expand a legacy string into the color each glyph is actually drawn in.
    const painted = (value) => {
        const out = [];
        let color = '';
        const text = String(value);
        for (let i = 0; i < text.length; i += 1) {
            if (text[i] === '§' && i + 1 < text.length) {
                color = text.slice(i, i + 2);
                i += 1;
                continue;
            }
            out.push(`${color}${text[i]}`);
        }
        return out;
    };
    const starField = (stars) => buildNametagFields(row({ stats: { stars } }), {
        audience: { prefixStat: 'star', suffixStat: 'none' },
        starBracketsEnabled: true,
        prefixBudget: 9,
        coloredStarPrefixBudget: 14
    }).prefixExtra;

    // Every prestige below 1000 has a single-color palette, so the nametag can
    // afford all of it: these must be pixel-identical to /stats.
    [0, 57, 157, 257, 357, 457, 557, 657, 757, 857, 957].forEach(stars => {
        assert.deepStrictEqual(
            painted(starField(stars)),
            painted(formatBedwarsPrestige(stars)),
            `prestige ${stars} must render exactly as /stats does`
        );
    });
    // Higher prestiges retain as many palette bands as the team field can fit.
    [3057, 3157, 4157, 5957, 9657, 10000].forEach(stars => {
        const field = painted(starField(stars));
        const full = painted(formatBedwarsPrestige(stars));
        const colors = new Set(full.map(glyph => glyph.slice(0, 2)));
        assert.ok(field.every(glyph => colors.has(glyph.slice(0, 2))), `prestige ${stars} uses its own palette`);
        assert.strictEqual(field.map(glyph => glyph.slice(2)).join(''), full.map(glyph => glyph.slice(2)).join(''));
    });
    // The team letter is what says which team an enemy is on, so no prestige
    // may cost it - that is the ceiling the palette is spent under.
    for (let stars = 0; stars <= 10100; stars += 7) {
        const composed = composeBedwarsNametagPrefix('§c', 'R', starField(stars));
        assert.ok(composed.includes('R'), `prestige ${stars} must not cost the team letter`);
    }

    // No level may lose a digit, its star icon, or overflow the field - the
    // palette is what gets spent down when the field runs out, never the number.
    for (let stars = 0; stars <= 10100; stars += 1) {
        const field = starField(stars);
        assert.ok(field.length <= MAX_TEAM_FIELD, `star field for ${stars} exceeds the team field`);
        assert.strictEqual(
            cleanNametagText(field),
            cleanNametagText(formatBedwarsPrestige(stars)),
            `star field for ${stars} must carry the same text /stats does`
        );
        assert.ok(
            composeBedwarsNametagPrefix('§c', 'R', field).length <= MAX_TEAM_FIELD,
            `composed BedWars prefix for ${stars} exceeds the team field`
        );
    }
    // The 1000 rainbow is the one palette too wide for the field. It keeps as
    // many of its real bands as fit instead of collapsing to a single color.
    const rainbow = starField(1057);
    assert.strictEqual(rainbow, '§c[§61057✫]', 'the rainbow prestige keeps the leading bands of its real palette');
    const rainbowBands = new Set(rainbow.match(/§[0-9a-f]/g) || []);
    assert.ok(rainbowBands.size > 1, 'the rainbow prestige is never collapsed to one flat color');
    assert.ok(
        [...rainbowBands].every(band => formatBedwarsPrestige(1057).includes(band)),
        'every band a nametag keeps must be one /stats would have drawn'
    );
}

// --- known tags use text styles; resource-pack glyph mappings remain available ---
assert.deepStrictEqual(NAMETAG_TAG_DISPLAY_MODES, ['acronyms', 'full']);
assert.deepStrictEqual(NAMETAG_TAG_SOURCE_COLORS, { urchin: '§d', seraph: '§3' });
assert.strictEqual(nametagTagSourceColor('Urchin'), '§d');
assert.strictEqual(nametagTagSourceColor('S'), '§3');
assert.strictEqual(normalizeNametagTagDisplayMode('icons'), 'acronyms');
assert.strictEqual(normalizeNametagTagDisplayMode('glyph'), 'acronyms');
assert.strictEqual(normalizeNametagTagDisplayMode('acronym'), 'acronyms');
assert.strictEqual(normalizeNametagTagDisplayMode('text'), 'full');
assert.strictEqual(normalizeNametagTagDisplayMode('invalid', 'acronyms'), 'acronyms');
assert.deepStrictEqual(
    build(row({ tags: [{ source: 'Urchin', value: 'Sniper' }, { source: 'Seraph', value: 'Other' }] }), { prefixStat: 'none', suffixStat: 'tag' }),
    { prefixExtra: '', suffix: ' §dSN' },
    'suffix tag uses the pink Urchin acronym'
);

[
    ['Blatant', NAMETAG_TAG_ICONS.blatant_cheater, '§4BC'],
    ['Blatant Cheater', NAMETAG_TAG_ICONS.blatant_cheater, '§4BC'],
    ['Closet', NAMETAG_TAG_ICONS.closet_cheater, '§6CC'],
    ['Closet Cheating', NAMETAG_TAG_ICONS.closet_cheater, '§6CC'],
    ['Confirmed Cheater', NAMETAG_TAG_ICONS.confirmed_cheater, '§dCF'],
    ['Caution', NAMETAG_TAG_ICONS.caution, '§bCA'],
    ['Sniper', NAMETAG_TAG_ICONS.sniper, '§cSN'],
    ['Legit', NAMETAG_TAG_ICONS.legit_sniper, '§aLS'],
    ['Legit Sniper', NAMETAG_TAG_ICONS.legit_sniper, '§aLS'],
    ['Nicked Account', NAMETAG_TAG_ICONS.account, '§7AC'],
    ['Blacklisted', NAMETAG_TAG_ICONS.blacklisted, '§8BL']
].forEach(([tag, icon, categoryAcronym]) => {
    assert.strictEqual(nametagIconForTag(tag), icon, `${tag} maps to its custom glyph`);
    const definition = Object.values(NAMETAG_TAG_DEFINITIONS).find(entry => entry.icon === icon);
    assert.strictEqual(
        formatNametagStat('tag', row({ tags: [{ source: 'Urchin', value: tag }] }), { compactTagName, priority: 'urchin' }),
        `§d${definition.acronym}`,
        `${tag} renders as a pink Urchin acronym`
    );
    assert.strictEqual(formatNametagTagValue(icon), categoryAcronym, `${tag} icon payload is converted to text`);
    assert.strictEqual(formatNametagTagValue(icon, { tagDisplayMode: 'full' }), `§d${definition.label}`, `${tag} icon payload expands to the full label`);
});
assert.strictEqual(nametagIconForTag('Manual Review'), '', 'an unknown tag has no custom glyph');
assert.strictEqual(
    formatNametagStat('tag', row({ tags: [{ source: 'Urchin', value: 'Blatant' }] }), { compactTagName, tagDisplayMode: 'acronyms' }),
    `§d${NAMETAG_TAG_DEFINITIONS.blatant_cheater.acronym}`,
    'acronym mode renders an Urchin category in pink'
);
assert.strictEqual(
    formatNametagStat('tag', row({ tags: [{ source: 'Urchin', value: 'Blatant' }] }), { compactTagName, tagDisplayMode: 'full' }),
    '§dBlatant Cheater',
    'full mode expands an Urchin category in pink'
);
assert.strictEqual(
    formatNametagStat('tag', row({ tags: [{ source: 'Seraph', value: 'Blatant' }] }), { compactTagName, priority: 'seraph', tagDisplayMode: 'acronyms' }),
    '§3BC',
    'acronym mode renders a Seraph category in dark aqua'
);
assert.strictEqual(
    formatNametagStat('tag', row({ tags: [{ source: 'Seraph', value: 'Blatant' }] }), { compactTagName, priority: 'seraph', tagDisplayMode: 'full' }),
    '§3Blatant Cheater',
    'full mode renders a Seraph category in dark aqua'
);
assert.strictEqual(
    formatNametagStat('tag', row({ tags: [{ source: 'Urchin', value: 'Manual Review' }] }), { compactTagName, priority: 'urchin' }),
    '§dManual',
    'an unknown tag retains the existing compact pink text fallback'
);
assert.strictEqual(
    formatNametagStat('tag', row({ tags: [{ source: 'Urchin', value: 'Manual Review' }] }), { compactTagName, tagDisplayMode: 'full' }),
    '§dManual Review',
    'full mode preserves all text for an unknown custom tag'
);
{
    const fields = buildNametagFields(row({ tags: [{ source: 'Urchin', value: 'Confirmed Cheater' }] }), {
        compactTagName,
        audience: { prefixStat: 'tag', suffixStat: 'none' },
        tagDisplayMode: 'full',
        prefixBudget: MAX_TEAM_FIELD
    });
    assert.ok(fields.prefixExtra.length <= MAX_TEAM_FIELD, 'full labels still obey the legacy scoreboard field budget');
}

// --- API-status "tags" are ignored ---
assert.deepStrictEqual(
    build(row({ tags: [{ source: 'Urchin', value: 'API OUTAGE' }] }), { prefixStat: 'none', suffixStat: 'tag' }),
    { prefixExtra: '', suffix: '' },
    'API status rows are not treated as tags'
);
assert.strictEqual(nametagRowHasTag(row({ tags: [{ source: 'Urchin', value: 'API OUTAGE' }] })), false, 'API rows are not a real tag');
assert.strictEqual(nametagRowHasTag(row({ tags: [{ source: 'Urchin', value: 'Cheater' }] })), true, 'a real tag is detected');

// --- guild + level ---
assert.deepStrictEqual(
    build(row({ guildTag: 'ELITE', networkLevel: 142 }), { prefixStat: 'guild', suffixStat: 'level' }),
    { prefixExtra: '§7[ELITE]', suffix: ' §b142' },
    'guild prefix + network level suffix'
);

// --- prefix budget clamps a long prefix stat ---
{
    const fields = build(row({ tags: [{ source: 'Urchin', value: 'VeryLongTag' }] }), { prefixStat: 'tag', suffixStat: 'none' }, 6);
    assert.ok(fields.prefixExtra.length <= 6, `prefix "${fields.prefixExtra}" respects the 6-char budget`);
}

// --- empty when the chosen stat has no data ---
assert.deepStrictEqual(
    build(row({ stats: {} }), { prefixStat: 'none', suffixStat: 'wlr' }),
    { prefixExtra: '', suffix: '' },
    'missing stat data -> empty field'
);

// --- avg ping (top-level row.avgPing, same value /ping reports) ---
assert.deepStrictEqual(
    build(row({ avgPing: 45 }), { prefixStat: 'none', suffixStat: 'ping' }),
    { prefixExtra: '', suffix: ' §a45ms' },
    'low avg ping renders green in the suffix'
);
assert.strictEqual(formatNametagStat('ping', row({ avgPing: 112 })), '§e112ms', 'mid ping is yellow');
assert.strictEqual(formatNametagStat('ping', row({ avgPing: 260 })), '§c260ms', 'high ping is red');
assert.strictEqual(formatNametagStat('ping', row({ avgPing: 45.6 })), '§a46ms', 'fractional avg is rounded');
// Aurora reports -1 for "no data"; that must render nothing rather than "-1ms".
assert.strictEqual(formatNametagStat('ping', row({ avgPing: -1 })), '', 'missing ping data -> empty');
assert.strictEqual(formatNametagStat('ping', row()), '', 'absent ping field -> empty');
assert.deepStrictEqual(
    build(row({ avgPing: -1 }), { prefixStat: 'none', suffixStat: 'ping' }),
    { prefixExtra: '', suffix: '' },
    'no ping data leaves the nametag untouched'
);

// --- primary / fallback resolution ---
assert.deepStrictEqual(
    build(row({ stats: { stars: 325 } }), {
        prefixStat: 'tag',
        prefixFallbackStat: 'star',
        suffixStat: 'none'
    }),
    { prefixExtra: '§b[325✫]', suffix: '' },
    'missing primary tag falls back to BedWars star'
);
assert.deepStrictEqual(
    build(row({ tags: [{ source: 'Urchin', value: 'Sniper' }], stats: { stars: 325 } }), {
        prefixStat: 'tag',
        prefixFallbackStat: 'star',
        suffixStat: 'none'
    }),
    { prefixExtra: '§dSN', suffix: '' },
    'available pink Urchin acronym wins over fallback star'
);
assert.strictEqual(
    formatNametagSlot('ws', 'star', row({ stats: { ws: 0, stars: 325 } })),
    '§70',
    'a real zero winstreak does not trigger fallback'
);
assert.strictEqual(
    formatNametagSlot('none', 'star', row({ stats: { stars: 325 } })),
    '',
    'an intentional None primary never cascades into fallback'
);
assert.strictEqual(
    formatNametagSlot('fkdr', 'star', row({ stats: { stars: 325 } })),
    '',
    'a failed Hypixel primary must not retry another Hypixel field'
);
assert.strictEqual(formatNametagStat('dwins', row({ sessions: { daily: { wins: 7 } } })), '\u00a7a+7', 'daily Coral wins render from the existing session response');
assert.strictEqual(formatNametagStat('wfinals', row({ sessions: { weekly: { finals: 42 } } })), '\u00a7e+42', 'weekly Coral finals render from the existing session response');
assert.strictEqual(formatNametagStat('mfkdr', row({ sessions: { monthly: { fkdr: 4.25 } } })), '\u00a724.25', 'monthly Coral FKDR renders without a new stat source');
// Worst case width: 4-digit ping in a tight Bedwars prefix budget.
{
    const fields = build(row({ avgPing: 4321 }), { prefixStat: 'ping', suffixStat: 'none' }, 8);
    assert.ok(fields.prefixExtra.length <= 8, `ping prefix "${fields.prefixExtra}" respects the 8-char budget`);
}

// --- direct formatter checks ---
assert.strictEqual(formatNametagStat('ws', row({ stats: { ws: 12 } })), '§412', 'winstreak colored');
assert.strictEqual(formatNametagStat('none', row()), '', 'none -> empty');
assert.strictEqual(cleanNametagText('§kStatic §rSniper'), 'Static Sniper', 'obfuscated formatting removed');

{
    const fields = build(row({ tags: [{ source: 'Urchin', value: '§kStatic §rSniper' }] }), { prefixStat: 'none', suffixStat: 'tag' });
    assert.strictEqual(fields.suffix.includes('§k'), false, 'obfuscated tag formatting must not reach the suffix');
    assert.strictEqual(fields.suffix, ' §dSN', 'the sanitized Urchin tag renders its pink acronym');
}

// --- helper functions unchanged ---
assert.strictEqual(
    pickNametagTag(row({ tags: [{ source: 'Urchin', value: 'Legacy: Sniper' }] }), compactTagName),
    'Sniper',
    'pickNametagTag compacts selected tags'
);
assert.strictEqual(clampField('0123456789ABCDE§extra'), '0123456789ABCDE', 'clampField strips a dangling section sign');
assert.ok(clampField('§a§b§c§d§e§f§7§8§9').length <= MAX_TEAM_FIELD, 'clampField respects the 16-char budget');

// --- entity tracker (unchanged behavior) ---
function makeEntityTracker(uuidNames) {
    return createEntityTracker({
        isValidPlayerName: name => /^[A-Za-z0-9_]{1,16}$/.test(String(name || '')),
        normalizeUuid: value => String(value || '').toLowerCase(),
        nickKey: name => String(name || '').toLowerCase(),
        packetEntityId: data => {
            const value = data.entityId ?? data.entityID ?? data.id;
            const number = Number(value);
            return Number.isFinite(number) ? number : null;
        },
        entityPositionFromFixedPacket: data => ({
            x: Number(data.x || 0) / 32,
            y: Number(data.y || 0) / 32,
            z: Number(data.z || 0) / 32
        }),
        getUuidMappedName: uuid => uuidNames.get(uuid) || null,
        woodSkinFromHeldItem: () => null,
        playerEntityPacketNames: new Set(['named_entity_spawn', 'entity_metadata', 'entity_destroy'])
    });
}

assert.strictEqual(
    entityMetadataFlags([{ index: 0, value: ENTITY_FLAG_INVISIBLE }]),
    ENTITY_FLAG_INVISIBLE,
    'metadata flags accept index aliases'
);

{
    const uuidNames = new Map([['uuid-a', 'Steve'], ['uuid-b', 'Alex']]);
    const tracker = makeEntityTracker(uuidNames);

    tracker.observePlayerEntityPacket({ entityId: 42, playerUUID: 'uuid-a', x: 0, y: 64 * 32, z: 0, metadata: [{ key: 0, value: 0 }] }, { name: 'named_entity_spawn' });
    assert.strictEqual(tracker.isPlayerEntityInvisible('Steve'), false, 'spawned visible player is not suppressed');

    const invisibleUpdate = tracker.observePlayerEntityPacket({ entityId: 42, metadata: [{ key: 0, value: ENTITY_FLAG_INVISIBLE }] }, { name: 'entity_metadata' });
    assert.strictEqual(invisibleUpdate.invisibleChanged, true, 'invisibility metadata reports a change');
    assert.strictEqual(tracker.isPlayerEntityInvisible('Steve'), true, 'invisible metadata suppresses overlay');

    tracker.observePlayerEntityPacket({ entityId: 42, metadata: [{ key: 6, value: 20 }] }, { name: 'entity_metadata' });
    assert.strictEqual(tracker.isPlayerEntityInvisible('Steve'), true, 'unrelated metadata does not clear invisibility');

    tracker.observePlayerEntityPacket({ entityId: 42, metadata: [{ key: 0, value: 0x02 }] }, { name: 'entity_metadata' });
    assert.strictEqual(tracker.isPlayerEntityInvisible('Steve'), false, 'clearing the invisible flag restores eligibility');

    tracker.observePlayerEntityPacket({ entityId: 43, playerUUID: 'uuid-b', metadata: [{ key: 0, value: ENTITY_FLAG_INVISIBLE }] }, { name: 'named_entity_spawn' });
    assert.strictEqual(tracker.isPlayerEntityInvisible('Alex'), true, 'spawn metadata can start invisible');
}

// --- Overlay team names keep the tab list grouped by team -----------------
// The 1.8 tab list sorts on the scoreboard team name, then the player name.
// Hypixel names every BedWars player's own team "<Colour><n>" ("Red28",
// "Blue3"), so an overlay team only stays inside its colour block if it is
// built from that name. Reproduce the client's comparator and check it.
{
    const clientTabOrder = (rows) => rows
        .slice()
        .sort((a, b) => (a.team < b.team ? -1 : a.team > b.team ? 1 : (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)))
        .map(entry => entry.name);

    const hypixelTeams = [
        { name: 'Ada', team: 'Red28' },
        { name: 'Bo', team: 'Red3' },
        { name: 'Cy', team: 'Blue16' },
        { name: 'Dee', team: 'Blue7' },
        { name: 'Eli', team: 'Yellow20' }
    ];
    const vanillaOrder = clientTabOrder(hypixelTeams);

    // Annotating some players must not move anybody: every overlay team sorts
    // where the Hypixel team it was named after did.
    const annotated = new Set(['Ada', 'Dee', 'Eli']);
    const assigned = assignNametagTeamNames(
        hypixelTeams.filter(entry => annotated.has(entry.name)).map(entry => ({ name: entry.name, base: entry.team }))
    );
    const overlayByName = new Map(assigned.map(entryRow => [entryRow.name, entryRow.teamName]));
    const mixed = hypixelTeams.map(entry => ({
        name: entry.name,
        team: overlayByName.get(entry.name) || entry.team
    }));
    assert.deepStrictEqual(clientTabOrder(mixed), vanillaOrder, 'annotated players must keep their vanilla tab-list position');
    assert.ok(
        mixed.every(entry => /^(Red|Blue|Yellow)/.test(entry.team)),
        'every overlay team must still start with its Hypixel team name, or the tab list stops grouping by team'
    );

    // Teammates sharing a base are indexed by player name, the same secondary
    // sort the client applies, so they stay in vanilla order among themselves.
    const shared = assignNametagTeamNames([
        { name: 'Zed', base: 'Red28' },
        { name: 'Ada', base: 'Red28' },
        { name: 'Mia', base: 'Red28' }
    ]);
    assert.deepStrictEqual(
        shared.map(entryRow => entryRow.teamName),
        ['Red28!2', 'Red28!0', 'Red28!1'],
        'a shared base indexes teammates by name while preserving input order'
    );

    // '!' is below every character Hypixel uses in a team name, so the overlay
    // team sorts immediately after the real one and before the next team.
    assert.ok(nametagTeamName('Red3', 0) > 'Red3', 'an overlay team sorts after the team it was named for');
    assert.ok(nametagTeamName('Red3', 0) < 'Red30', 'an overlay team sorts before the next Hypixel team');

    // The one base that must never reach here: an empty string sorts the row
    // above every team block in the tab list.
    assert.ok(nametagTeamName('', 0) < 'Aqua1', 'an empty base would sort above every team - callers must never pass one');
}

// Exercise the production sync and packet writer without starting a proxy.
// Model mode 3 as membership-only, as on the client: carrying visibility in
// the writer's input cannot substitute for sending a mode-2 properties update.
{
    const fs = require('fs');
    const vm = require('vm');
    const source = fs.readFileSync(require.resolve('../../proxy.js'), 'utf8');
    const packets = [];
    const clientTeams = new Map();
    const tracker = makeEntityTracker(new Map([['uuid-a', 'Steve']]));
    tracker.observePlayerEntityPacket({ entityId: 42, playerUUID: 'uuid-a', metadata: [{ key: 0, value: 0 }] }, { name: 'named_entity_spawn' });
    const info = { nameTagVisibility: 'never', friendlyFire: 0 };
    let removedByServer = false;
    let rawTeam = 'Red1';
    let annotation = '[50]';
    let color = '§c';
    const context = {
        nametagTeams: new Map(), gameRoster: new Set(['Steve']),
        lobbyPlayers: new Map([['Steve', info]]), MAX_TEAM_FIELD,
        assignNametagTeamNames, composeBedwarsNametagPrefix,
        clampTeamField: value => value, legacyColorToPacketColor: value => value === '§c' ? 12 : 9,
        originalRawTeamNameFor: () => rawTeam,
        isNametagOverlayActiveDuels: () => false, isNametagOverlayActive: () => true,
        isValidPlayerName: () => true, isOwnPlayerName: () => false,
        isDenickAliasDuplicate: () => false, nickKey: value => value.toLowerCase(),
        isPlayerEntityInvisible: name => tracker.isPlayerEntityInvisible(name),
        isPlayerHiddenByTeamRemoval: () => removedByServer,
        resolveBedwarsTeamDef: () => ({ color, letter: 'R' }),
        computeNametagFields: () => ({ prefixExtra: annotation, suffix: '' }),
        findScoreboardTeamForPlayer: () => ({ teamInfo: info }),
        restorePlayerOriginalTeam: () => { throw new Error('hidden player must not be restored'); },
        writeScoreboardTeamPacket: packet => {
            packets.push(packet);
            if (packet.mode === 0 || packet.mode === 2) clientTeams.set(packet.team, { ...packet });
            if (packet.mode === 1) clientTeams.delete(packet.team);
        }
    };
    vm.createContext(context);
    for (const name of ['applyNametagTeamAssignments', 'writeNametagTeam', 'removeNametagTeam', 'syncNametagTeams']) {
        const start = source.indexOf(`        function ${name}(`);
        assert(start >= 0, `production function ${name} exists`);
        const end = source.indexOf('\n        function ', start + 1);
        assert(end > start);
        vm.runInContext(source.slice(start, end), context);
    }
    const sync = () => { packets.length = 0; context.syncNametagTeams(); };
    const modes = () => packets.map(packet => packet.mode);
    const currentTeam = () => clientTeams.get(context.nametagTeams.get('steve').teamName);

    sync();
    assert.strictEqual(currentTeam().nameTagVisibility, 'never');
    for (const visibility of ['always', 'never', 'hideForOtherTeams', 'hideForOwnTeam', 'always']) {
        info.nameTagVisibility = visibility;
        sync();
        assert.deepStrictEqual(modes(), [2, 3], 'visibility-only changes update properties before membership');
        assert.strictEqual(currentTeam().nameTagVisibility, visibility);
    }
    sync();
    assert.deepStrictEqual(modes(), [3], 'unchanged settings only reassert membership');
    info.friendlyFire = 3;
    sync();
    assert.strictEqual(currentTeam().friendlyFire, 3);
    annotation = '[51]';
    sync();
    assert(currentTeam().prefix.includes('[51]'), 'annotation updates still reach the client');
    color = '§9';
    sync();
    assert.strictEqual(currentTeam().color, 9);
    rawTeam = 'Blue1';
    sync();
    assert.deepStrictEqual(modes(), [1, 0], 'team changes delete the old team and create the replacement');

    tracker.observePlayerEntityPacket({ entityId: 42, metadata: [{ key: 0, value: ENTITY_FLAG_INVISIBLE }] }, { name: 'entity_metadata' });
    sync();
    assert.deepStrictEqual(modes(), [1], 'invisible players lose the overlay without restoration');
    info.nameTagVisibility = 'always';
    sync();
    assert.deepStrictEqual(modes(), [], 'server visibility cannot override entity invisibility');
    removedByServer = true;
    tracker.observePlayerEntityPacket({ entityId: 42, metadata: [{ key: 0, value: 0 }] }, { name: 'entity_metadata' });
    sync();
    assert.deepStrictEqual(modes(), [], 'clearing invisibility cannot override server team removal');
    removedByServer = false;
    sync();
    assert.deepStrictEqual(modes(), [0], 'visible, re-teamed players regain the overlay');
    assert.strictEqual(currentTeam().nameTagVisibility, 'always');
    removedByServer = true;
    sync();
    assert.deepStrictEqual(modes(), [1], 'server removal alone suppresses an existing overlay');
}

console.log('nametag overlay tests passed');
