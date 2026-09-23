'use strict';
const REPOSITORY_ROOT = require('path').resolve(__dirname, '../..');

// Custom display names ("friend aliases"): the store, and the way they compose
// with the denick rename engine they ride on.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    createFriendAliasBook,
    normalizeAliasBook,
    normalizeAliasColor,
    isValidAliasName
} = require('../../src/friends/aliasBook.js');
const { createDenickDisplayNames } = require('../../src/denick/displayNames.js');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-alias-'));
const aliasFile = path.join(tmpDir, 'friend_aliases.json');
const writes = [];
const writeJsonOffThread = (file, value) => {
    writes.push(value);
    fs.writeFileSync(file, JSON.stringify(value), 'utf8');
};

// --- validation ------------------------------------------------------------

// The alias becomes the GameProfile name, and the client keys team membership
// and score entries by that string, so it has to look like a Minecraft name.
assert.strictEqual(isValidAliasName('FattyAurora'), true);
assert.strictEqual(isValidAliasName('Fatty Aurora'), false, 'spaces are not legal in a profile name');
assert.strictEqual(isValidAliasName('ab'), false, 'too short');
assert.strictEqual(isValidAliasName('ThisNameIsWayTooLong'), false, 'over 16 characters');
assert.strictEqual(isValidAliasName('§dFatty'), false, 'colour codes belong in the colour field, not the name');

assert.strictEqual(normalizeAliasColor('§d'), '§d');
assert.strictEqual(normalizeAliasColor('d'), '§d', 'a bare colour letter is accepted');
assert.strictEqual(normalizeAliasColor('zz'), null, 'a junk colour is dropped, not fatal');

// --- store -----------------------------------------------------------------

const book = createFriendAliasBook({ aliasFile, writeJsonOffThread });

assert.strictEqual(book.findAlias('_xAurora'), null, 'empty book resolves to nothing');

const added = book.setAlias({ name: '_xAurora', alias: 'FattyAurora', color: 'd' });
assert.strictEqual(added.ok, true);
assert.strictEqual(book.findAlias('_xAurora').alias, 'FattyAurora');
assert.strictEqual(book.findAlias('_XAURORA').alias, 'FattyAurora', 'lookup is case-insensitive');
assert.strictEqual(book.findAlias('_xAurora').color, '§d');

// Two players rendering under one name would put two entries under it, and the
// client keys team membership by name - it would shuffle membership between them.
const clash = book.setAlias({ name: 'SomeoneElse', alias: 'FattyAurora' });
assert.strictEqual(clash.ok, false);
assert.strictEqual(clash.reason, 'alias_taken');
assert.strictEqual(clash.conflict.realIGN, '_xAurora');

assert.strictEqual(book.setAlias({ name: '_xAurora', alias: 'Fatty Aurora' }).ok, false, 'invalid alias refused');
assert.strictEqual(book.setAlias({ name: '_xAurora', alias: '_xAurora' }).reason, 'same_name');

// Re-setting the same player keeps the entry rather than colliding with itself.
assert.strictEqual(book.setAlias({ name: '_xAurora', alias: 'AuroraBorealis' }).ok, true);
assert.strictEqual(book.findAlias('_xAurora').alias, 'AuroraBorealis');
assert.strictEqual(book.setAlias({ name: '_xAurora', alias: 'FattyAurora' }).ok, true);

// Survives a reload from disk.
const reopened = createFriendAliasBook({ aliasFile, writeJsonOffThread });
assert.strictEqual(reopened.findAlias('_xAurora').alias, 'FattyAurora', 'entry persisted');

assert.strictEqual(book.removeAlias('_xAurora').removed, true);
assert.strictEqual(book.findAlias('_xAurora'), null);
assert.strictEqual(book.removeAlias('_xAurora').removed, false, 'removing twice is not an error');

// A hand-edited file with a bad row keeps the good ones instead of failing shut.
const normalized = normalizeAliasBook([
    { realIGN: '_xAurora', alias: 'FattyAurora' },
    { realIGN: 'Broken', alias: 'no spaces allowed' },
    { alias: 'Orphan' }
]);
assert.strictEqual(normalized.size, 1);
assert.strictEqual(normalized.get('_xaurora').alias, 'FattyAurora');

// --- settings plumbing -----------------------------------------------------

// A toggle can exist in every config layer and still do nothing, because the
// live connection reads `state`, not the parsed config. loadFeatureConfig is
// the only thing that bridges the two, and a key missing from it leaves the
// launcher switch inert forever - which is exactly what happened here.
{
    const proxySrc = fs.readFileSync(path.join(REPOSITORY_ROOT, 'proxy.js'), 'utf8');
    const bootstrapSrc = fs.readFileSync(path.join(REPOSITORY_ROOT, 'src', 'bootstrap', 'config.js'), 'utf8');
    const parsed = [...bootstrapSrc.matchAll(/(friendAlias\w+):\s*bool\(/g)].map(m => m[1]);
    assert.deepStrictEqual(
        parsed.sort(),
        ['friendAliasChat', 'friendAliasEnabled', 'friendAliasNametags', 'friendAliasShowRealIgn', 'friendAliasTabStats'],
        'the friendAlias toggle set changed - every layer below has to be checked with it'
    );
    const snapshot = proxySrc.slice(
        proxySrc.indexOf('function currentFeatureConfigSnapshot()'),
        proxySrc.indexOf('function ', proxySrc.indexOf('function currentFeatureConfigSnapshot()') + 10)
    );
    parsed.forEach(key => {
        // Layer 1: the parsed config has to reach the live state...
        assert.ok(
            proxySrc.includes(`state.${key} = features.${key};`),
            `loadFeatureConfig must push ${key} into state, or the launcher toggle does nothing`
        );
        // ...and layer 2: the live-settings watcher only re-applies when this
        // snapshot changes, so a key missing here saves fine and silently
        // never repaints anything in game.
        assert.ok(
            snapshot.includes(`${key}: state.${key},`),
            `currentFeatureConfigSnapshot must include ${key}, or changing it never triggers applyLiveFeatureSettings`
        );
    });

    // The rename decisions are sticky, so flipping a toggle is not enough on
    // its own - the live-apply path has to re-derive them too.
    const applyBlock = proxySrc.slice(proxySrc.indexOf('applyLiveFeatureSettings = () => {'));
    assert.ok(
        /denickDisplayNames\.refreshNameReplacement\(\);[\s\S]{0,600}denickDisplayNames\.refreshRenames\(\);/.test(applyBlock),
        'applyLiveFeatureSettings must re-derive renames, not just react to the on/off flag'
    );
}

// --- composition with the rename engine ------------------------------------

function makeEngine({ aliases = {}, denicks = {}, own = 'Nestersen', flags = {} } = {}) {
    const sent = [];
    const state = {
        master: flags.master ?? true,
        nametags: flags.nametags ?? true,
        chat: flags.chat ?? true,
        denickNametags: flags.denickNametags ?? true,
        denickChat: flags.denickChat ?? true,
        skin: flags.skin ?? false
    };
    const skinLookups = [];
    const engine = createDenickDisplayNames({
        isEnabled: () => state.denickNametags || (state.master && state.nametags),
        isChatReplacementEnabled: () => state.denickChat || (state.master && state.chat),
        isSkinReplacementEnabled: () => state.skin,
        resolveSkinProperties: async (name) => { skinLookups.push(name); return null; },
        isNameTaken: () => false,
        resend: (packetName, payload) => sent.push({ packetName, payload }),
        logger: { error: () => {} },
        // The same two-layer resolver proxy.js installs.
        resolveRealName: (nick, surface = 'world') => {
            if (String(nick).toLowerCase() === own.toLowerCase()) return null;
            const real = denicks[nick] || null;
            if (surface === 'skin') return real;
            const aliasOn = state.master && (surface === 'chat' ? state.chat : state.nametags);
            if (aliasOn) {
                const entry = (real ? aliases[real] : null) || aliases[nick];
                if (entry) return entry;
            }
            const denickOn = surface === 'chat' ? state.denickChat : state.denickNametags;
            return denickOn ? real : null;
        }
    });
    return { engine, sent, state, skinLookups };
}

const addPlayer = (name) => ({ action: 0, data: [{ name, UUID: `uuid-${name}` }] });
const renderedName = (result) => result.data[0].name;

// An unnicked friend: the alias applies with no denick involved at all.
{
    const { engine } = makeEngine({ aliases: { _xAurora: 'FattyAurora' } });
    assert.strictEqual(renderedName(engine.rewritePlayerInfo(addPlayer('_xAurora'), 'add_player')), 'FattyAurora');
}

// A nicked friend: denick to the account, then the alias for that account.
{
    const { engine } = makeEngine({
        aliases: { _xAurora: 'FattyAurora' },
        denicks: { GoodRider: '_xAurora' }
    });
    assert.strictEqual(renderedName(engine.rewritePlayerInfo(addPlayer('GoodRider'), 'add_player')), 'FattyAurora');
}

// The alias beats the real IGN: naming someone means seeing that name.
{
    const { engine } = makeEngine({
        aliases: { _xAurora: 'FattyAurora' },
        denicks: { GoodRider: '_xAurora' },
        flags: { denickNametags: true }
    });
    assert.strictEqual(renderedName(engine.rewritePlayerInfo(addPlayer('GoodRider'), 'add_player')), 'FattyAurora');
}

// Aliases work with real-IGN rendering fully off - that is the whole point of
// isEnabled() being an OR of the two features.
{
    const { engine } = makeEngine({
        aliases: { _xAurora: 'FattyAurora' },
        flags: { denickNametags: false, denickChat: false }
    });
    assert.strictEqual(renderedName(engine.rewritePlayerInfo(addPlayer('_xAurora'), 'add_player')), 'FattyAurora');
}

// With aliases off, a known nick still renders under its real IGN.
{
    const { engine } = makeEngine({
        aliases: { _xAurora: 'FattyAurora' },
        denicks: { GoodRider: '_xAurora' },
        flags: { nametags: false, chat: false }
    });
    assert.strictEqual(renderedName(engine.rewritePlayerInfo(addPlayer('GoodRider'), 'add_player')), '_xAurora');
}

// The master switch kills every surface at once, without the per-surface
// choices having to change - flipping it back restores exactly what was set.
{
    const { engine, state } = makeEngine({
        aliases: { _xAurora: 'FattyAurora' },
        denicks: { GoodRider: '_xAurora' },
        flags: { master: false, denickNametags: false, denickChat: false }
    });
    assert.strictEqual(renderedName(engine.rewritePlayerInfo(addPlayer('GoodRider'), 'add_player')), 'GoodRider',
        'master off leaves the name alone');
    assert.strictEqual(state.nametags, true, 'the per-surface choice is untouched');
    state.master = true;
    engine.refreshRenames();
    assert.ok(engine.activeRenames().some(entry => entry.real === 'FattyAurora'),
        'master back on restores the custom name');
}

// Master on but a known nick still denicks when custom names are off for that surface.
{
    const { engine } = makeEngine({
        aliases: { _xAurora: 'FattyAurora' },
        denicks: { GoodRider: '_xAurora' },
        flags: { master: true, nametags: false }
    });
    assert.strictEqual(renderedName(engine.rewritePlayerInfo(addPlayer('GoodRider'), 'add_player')), '_xAurora');
}

// Never rename yourself. This feature is for other people only - your own name
// is a client-side concern (Lunar has a mod for it) and renaming the client's
// own player reaches into own-identity tracking for no benefit.
{
    const { engine } = makeEngine({ aliases: { Nestersen: 'TheBoss' } });
    assert.strictEqual(renderedName(engine.rewritePlayerInfo(addPlayer('Nestersen'), 'add_player')), 'Nestersen');
    assert.ok(!engine.rewriteChatPacket({ message: JSON.stringify({ text: '<Nestersen> hi' }) }).message.includes('TheBoss'),
        'and not in chat either');
}

// Chat and nametags toggle independently, which is why the resolver takes a surface.
{
    const chatPacket = () => ({ message: JSON.stringify({ text: '_xAurora: hello' }) });
    const worldOnly = makeEngine({ aliases: { _xAurora: 'FattyAurora' }, flags: { chat: false, denickChat: false } });
    assert.ok(!worldOnly.engine.rewriteChatPacket(chatPacket()).message.includes('FattyAurora'), 'chat left alone when its toggle is off');

    const chatOnly = makeEngine({ aliases: { _xAurora: 'FattyAurora' }, flags: { nametags: false, denickNametags: false } });
    assert.ok(chatOnly.engine.rewriteChatPacket(chatPacket()).message.includes('FattyAurora'), 'chat rewritten when its toggle is on');
    assert.strictEqual(renderedName(chatOnly.engine.rewritePlayerInfo(addPlayer('_xAurora'), 'add_player')), '_xAurora', 'world left alone');
}

// A renamed player must be dragged into their team under the new name, or the
// client drops them out of it and they render with no team colour.
{
    const { engine, sent } = makeEngine({ aliases: { _xAurora: 'FattyAurora' } });
    engine.rewriteTeamPacket({ team: 'Aqua5', mode: 3, players: ['_xAurora'] });
    const renamedTeam = engine.rewriteTeamPacket({ team: 'Aqua5', mode: 3, players: ['_xAurora'] });
    assert.deepStrictEqual(renamedTeam.players, ['FattyAurora']);
    assert.ok(sent.every(entry => entry.packetName !== 'scoreboard_team' || entry.payload.team === 'Aqua5'));
}

// An alias added mid-game has to reach players already on screen: the rename
// decision is sticky, so only refreshRenames() picks it up.
{
    const aliases = {};
    const { engine } = makeEngine({ aliases });
    assert.strictEqual(renderedName(engine.rewritePlayerInfo(addPlayer('_xAurora'), 'add_player')), '_xAurora');
    aliases._xAurora = 'FattyAurora';
    engine.refreshRenames();
    const renames = engine.activeRenames();
    assert.ok(renames.some(entry => entry.real === 'FattyAurora'), 'refreshRenames re-derives the frozen decision');
}

// Removing an alias mid-game hands the player back to their original name.
{
    const aliases = { _xAurora: 'FattyAurora' };
    const { engine } = makeEngine({ aliases });
    engine.rewritePlayerInfo(addPlayer('_xAurora'), 'add_player');
    delete aliases._xAurora;
    engine.refreshRenames();
    assert.strictEqual(engine.activeRenames().length, 0, 'no rename survives once the alias is gone');
}

// A skin lookup must ask for the ACCOUNT, never the invented name - FattyAurora
// is not a Mojang account and the request would find nothing. The lookup is
// scheduled on a microtask, so this one has to wait for it.
(async () => {
    const { engine, skinLookups } = makeEngine({
        aliases: { _xAurora: 'FattyAurora' },
        denicks: { GoodRider: '_xAurora' },
        flags: { skin: true }
    });
    engine.rewritePlayerInfo(addPlayer('GoodRider'), 'add_player');
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(skinLookups.includes('_xAurora'), 'skin resolved from the real account');
    assert.ok(!skinLookups.includes('FattyAurora'), 'the alias is never used as an account name');

    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log('Friend alias tests passed.');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
