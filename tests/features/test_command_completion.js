const assert = require('assert');
const { createChatTabCompletion } = require('../../features/chat_completion');

{
    let party = ['Nestersen', 'Nestor', 'RemoteFriend'];
    let team = ['TeamMate'];
    let realNames = false;
    const chat = createChatTabCompletion({
        getPartyNames: () => party,
        getTeamNames: () => team,
        displayName: name => realNames && name === 'FunnyKid' ? 'Nestersen' : name
    });
    const complete = (text, matches = []) => {
        chat.forwardedRequest({ text });
        return chat.serverResponse({ matches }).matches;
    };
    assert.deepStrictEqual(complete('hey ne', ['NearbyPlayer', 'nestersen']), ['NearbyPlayer', 'nestersen', 'Nestor'], 'merge with server names, deduplicating case-insensitively');
    assert.deepStrictEqual(complete('hey Rem'), ['RemoteFriend'], 'party members outside the lobby are available');
    assert.deepStrictEqual(complete('Team'), [], 'party takes priority over additional team context');
    assert.deepStrictEqual(complete('hey ', ['LobbyPlayer']), ['LobbyPlayer', 'Nestersen', 'Nestor', 'RemoteFriend'], 'empty word offers names without losing server results');
    assert.deepStrictEqual(complete('/msg Rem', ['ServerResult']), ['ServerResult'], 'commands remain server-controlled');
    assert.deepStrictEqual(complete('hey @Rem'), [], 'do not replace punctuation inside the current word');
    party = null;
    assert.deepStrictEqual(complete('hey Te', ['Teammate', 'Ted']), ['Teammate', 'Ted'], 'solo teammate additions merge without duplicates');
    assert.deepStrictEqual(complete('Te'), ['TeamMate'], 'solo uses game teammates');
    party = [];
    assert.deepStrictEqual(complete('Te'), [], 'an empty known party does not include unrelated teammates');
    party = ['FunnyKid'];
    realNames = true;
    assert.deepStrictEqual(complete('Ne'), ['Nestersen'], 'real-name setting applies to added names');
    realNames = false;
    assert.deepStrictEqual(complete('Fu'), ['FunnyKid']);
    party = ['RemoteFriend'];
    chat.forwardedRequest({ text: '/unknown Rem' });
    chat.forwardedRequest({ text: 'hi Rem' });
    assert.deepStrictEqual(chat.serverResponse({ matches: ['CommandResult'] }).matches, ['CommandResult']);
    assert.deepStrictEqual(chat.serverResponse({ matches: [] }).matches, ['RemoteFriend'], 'queued replies use the corresponding request');
    const unsolicited = { matches: ['NormalName'] };
    assert.strictEqual(chat.serverResponse(unsolicited), unsolicited);
    const many = Array.from({ length: 100 }, (_, index) => `Remote${index}`);
    assert.strictEqual(complete('Rem', many).length, 101, 'normal server suggestions are never truncated');
    party = null;
    team = [];
    assert.deepStrictEqual(complete('Rem', ['RemoteServer']), ['RemoteServer'], 'leaving a party or game clears supplemental context');
}
const {
    PROXY_COMMANDS,
    HIDDEN_PROXY_COMMANDS,
    splitTabText,
    uniqueTabMatches,
    createProxyTabCompleter
} = require('../../features/command_completion.js');

function normalizeCosmeticKey(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const denickCosmeticFields = {
    finalkill: { aliases: ['final kill', 'kill effect'] },
    beddestroy: { aliases: ['bed destroy', 'bed break'] },
    killmessage: { aliases: ['kill message'] }
};

const denickCosmeticFieldByAlias = new Map();
Object.entries(denickCosmeticFields).forEach(([key, def]) => {
    denickCosmeticFieldByAlias.set(normalizeCosmeticKey(key), key);
    (def.aliases || []).forEach(alias => denickCosmeticFieldByAlias.set(normalizeCosmeticKey(alias), key));
});

function matchField(args, index, map) {
    const one = normalizeCosmeticKey(args[index]);
    if (map.has(one)) return { key: map.get(one), length: 1 };
    const two = normalizeCosmeticKey(`${args[index] || ''} ${args[index + 1] || ''}`);
    if (map.has(two)) return { key: map.get(two), length: 2 };
    return null;
}

function matchDenickStatField(args, index) {
    const key = normalizeCosmeticKey(args[index]);
    if (key === 'finals') return { key: 'finals', length: 1 };
    if (key === 'beds') return { key: 'beds', length: 1 };
    return null;
}

const completer = createProxyTabCompleter({
    normalizeCosmeticKey,
    normalizeCosmeticType: value => {
        const key = normalizeCosmeticKey(value);
        if (key === 'beddestroy') return 'beddestroy';
        if (key === 'finalkill') return 'finalkill';
        return null;
    },
    normalizeGame: (value, fallback = null) => {
        const key = String(value || '').toLowerCase();
        if (key === 'bw' || key === 'bedwars') return 'BEDWARS';
        if (key === 'sw' || key === 'skywars') return 'SKYWARS';
        return fallback;
    },
    visibleModeDefs: game => game === 'SKYWARS'
        ? [{ id: 'solo_insane', short: 'solo_insane' }]
        : [{ id: 'eight_one', short: 'solo' }, { id: 'eight_two', short: 'doubles' }],
    matchDenickCosmeticField: (args, index) => matchField(args, index, denickCosmeticFieldByAlias),
    matchDenickStatField,
    chatTriggerManager: { getTriggers: () => ['3/4', 'perm party'] },
    knownPlayerNames: () => ['DemoPlayer_', 'Nestersen', 'OtherPlayer'],
    bedDestroyEffects: ['Ghosts', 'Lightning Strike'],
    finalKillEffects: ['Blood Explosion', 'Head Rocket'],
    woodSkins: ['Oak', 'Jungle'],
    denickKillMessageNames: ['Counter'],
    denickCosmeticFields,
    denickCosmeticFieldByAlias,
    cosmeticCatalog: {
        beddestroy: ['Ghosts', 'Lightning Strike'],
        finalkill: ['Blood Explosion', 'Head Rocket']
    },
    duelsModeDefs: [{ id: 'classic_duel', short: 'classic' }, { id: 'bridge_duel', short: 'bridge' }]
});

assert(PROXY_COMMANDS.includes('/autogambler'), 'Visible command list should include /autogambler');
assert(PROXY_COMMANDS.includes('/apikill'), 'Visible command list should include /apikill');
assert(PROXY_COMMANDS.includes('/share'), 'Visible command list should include /share');
assert(!PROXY_COMMANDS.includes('/sharetags'), 'Legacy /sharetags should not be in visible command list');
assert(PROXY_COMMANDS.includes('/autododgetest'), 'Visible command list should include /autododgetest');
assert(PROXY_COMMANDS.includes('/cancel'), 'Visible command list should include /cancel');
assert(PROXY_COMMANDS.includes('/c'), 'Visible command list should include /c');
assert(PROXY_COMMANDS.includes('/fury'), 'Visible command list should include the Fury control center');
assert(HIDDEN_PROXY_COMMANDS.includes('/sharetags'), 'Legacy /sharetags should remain as a hidden alias');
assert.deepStrictEqual(splitTabText('/stats Dream '), ['/stats', 'Dream', '']);
assert.deepStrictEqual(uniqueTabMatches(['Alpha', 'alpha', 'Beta'], 10), ['Alpha', 'Beta']);

assert.strictEqual(completer('hello'), null, 'Non-command tab text should pass through');
assert.deepStrictEqual(completer('/help '), ['stats', 'lookup', 'overlay', 'settings', 'all']);
assert.deepStrictEqual(completer('/help stats '), ['1', '2']);
assert.deepStrictEqual(completer('/help overlay 2'), ['2']);
assert.strictEqual(completer('/unknown thing'), null, 'Unknown slash commands should pass through to Hypixel');
assert(completer('/de').includes('/denick'), 'Every command should be available in top-level completion');
assert(completer('/st').includes('/stats'), 'Top-level command completion should include matching visible commands');
assert.deepStrictEqual(completer('/stats De'), ['DemoPlayer_']);
assert.deepStrictEqual(completer('/stats DemoPlayer_ d'), ['doubles']);
assert.deepStrictEqual(completer('/sw DemoPlayer_ solo'), ['solo_insane']);
assert.deepStrictEqual(completer('/duels DemoPlayer_ b'), ['bridge']);
assert.deepStrictEqual(completer('/autogambler '), ['on', 'off', 'status', 'info']);
assert(completer('/share t').includes('threats'), '/share should tab-complete share categories');
assert.deepStrictEqual(completer('/share auto '), ['on', 'off']);
assert(completer('/share i').includes('include'), '/share should tab-complete include controller command');
assert.deepStrictEqual(completer('/share style '), ['compact', 'detailed']);
assert.deepStrictEqual(completer('/share dest '), ['party', 'all']);
assert.deepStrictEqual(completer('/overlay a'), ['all']);
assert.deepStrictEqual(completer('/overlay source d'), []);
assert.deepStrictEqual(completer('/overlay source p'), ['pregame']);
assert.deepStrictEqual(completer('/tabstats tags '), ['on', 'off']);
assert.deepStrictEqual(completer('/tabstats bw '), ['on', 'off', 'auto']);
assert.deepStrictEqual(completer('/tabstats col '), ['kr', 'wr']);
assert(completer('/tabstats c').includes('clear'), '/tabstats should complete clear controller command');
assert(completer('/nametags r').includes('refresh'), '/nametags should complete refresh controller command');
assert.deepStrictEqual(completer('/nametags style '), ['acronyms', 'full']);
assert.deepStrictEqual(completer('/nametags threats prefixfallback f'), ['fkdr', 'finals', 'finaldeaths']);
assert(completer('/dodge i').includes('include'), '/dodge should complete include subcommand');
assert(completer('/dodge p').includes('preset'), '/dodge should complete preset subcommand');
assert.deepStrictEqual(completer('/dodge preset all_'), ['all_on']);
assert.deepStrictEqual(completer('/dodge include n'), ['nicks']);
assert.deepStrictEqual(completer('/dodge include nicks '), ['on', 'off']);
assert.deepStrictEqual(completer('/dodge threat f'), ['fkdr']);
assert.deepStrictEqual(completer('/session st'), ['start']);
assert.deepStrictEqual(completer('/session en'), ['end']);
assert.deepStrictEqual(completer('/autododgetest De'), ['DemoPlayer_']);
assert.deepStrictEqual(completer('/cancel '), []);
assert.deepStrictEqual(completer('/kmlog '), ['start', 'status', 'cancel', 'stop', 'help']);
assert.deepStrictEqual(completer('/kmlog c'), ['cancel']);
assert.deepStrictEqual(completer('/c '), []);
assert.deepStrictEqual(completer('/fury h'), ['home', 'history', 'help']);
assert.deepStrictEqual(completer('/fury help s'), ['safety', 'social', 'system', 'settings', 'share']);
assert.deepStrictEqual(completer('/fury set eventlabels '), ['on', 'off']);
assert.deepStrictEqual(completer('/fury set boundary '), ['30', '60', '180', '360']);
assert.deepStrictEqual(completer('/fury set recapstyle '), ['compact', 'detailed', 'custom']);
assert.deepStrictEqual(completer('/fury set goal '), ['wins', 'finals', 'games', 'minutes']);
assert.deepStrictEqual(completer('/chattrigger remove p'), ['perm party']);
assert(completer('/chatstats s').includes('source'), '/chatstats should complete source controls');
assert.deepStrictEqual(completer('/chatstats source m'), ['mention']);
assert.deepStrictEqual(completer('/chatstats source mention '), ['on', 'off']);
assert.deepStrictEqual(completer('/chatstats only d'), ['dm']);
assert.deepStrictEqual(completer('/denick autoskin '), ['on', 'off']);
assert.deepStrictEqual(completer('/denick nametags '), ['on', 'off']);
assert(completer('/denick ann').includes('announcements'), '/denick should complete automation toggles');
assert.deepStrictEqual(completer('/denick party '), ['review', 'confirm', 'choose', 'test', 'cancel']);
assert.deepStrictEqual(completer('/denick party test '), ['one', 'two', 'three', 'mismatch']);
assert.deepStrictEqual(completer('/denick add Dem'), ['DemoPlayer_']);
assert.deepStrictEqual(completer('/denick add DemoPlayer_ Ne'), ['Nestersen']);

const fullGameNames = Array.from({ length: 96 }, (_, index) => `Player${String(index).padStart(2, '0')}`);
const fullGameCompleter = createProxyTabCompleter({ knownPlayerNames: () => fullGameNames });
assert.strictEqual(fullGameCompleter('/denick add ').length, 96, '/denick add nick completion must not truncate a full nick+real-IGN game identity set');
assert.strictEqual(fullGameCompleter('/denick add Player00 ').length, 96, '/denick add real-IGN completion must not truncate a full nick+real-IGN game identity set');
assert.strictEqual(fullGameCompleter('/stats ').length, 15, 'other player completion surfaces should retain their compact result limit');
assert.deepStrictEqual(completer('/reminder '), ['status', 'check', 'test', 'on', 'off', 'threshold', 'daily', 'george']);
assert.deepStrictEqual(completer('/reminder threshold '), ['250', '275', '300']);
assert.deepStrictEqual(completer('/reminder test '), ['below', 'threshold', 'full', 'waiting']);
assert.deepStrictEqual(completer('/reminder daily '), ['on', 'off', 'check', 'status']);
assert.deepStrictEqual(completer('/reminder george '), ['status', 'on', 'off', 'claimed', 'accepted', 'cooldown']);
assert.deepStrictEqual(completer('/denick finalkill Blo'), ['Blood Explosion']);
assert(completer('/denick finals 102000 beddestroy ').includes('Ghosts'), 'Denick should suggest cosmetic names after stat filters');
assert(!completer('/apikey h').includes('hypixel2'), '/apikey completion should not offer a second Hypixel key');
assert.deepStrictEqual(completer('/apikill '), ['on', 'off', 'toggle', 'status']);
assert(completer('/po ').includes('test'), '/po should tab-complete its local preview command');
assert.deepStrictEqual(completer('/po test '), ['all', 'clear', 'report', 'caution', 'notice', 'unavailable', 'lookup']);
assert.deepStrictEqual(completer('/potest '), ['all', 'clear', 'report', 'caution', 'notice', 'unavailable', 'lookup']);

console.log('Command completion tests passed.');
assert.deepStrictEqual(completer('/partycheck '), ['on', 'off', 'status', 'test', 'stop', 'dismiss']);
assert.deepStrictEqual(completer('/partycheck o'), ['on', 'off']);
