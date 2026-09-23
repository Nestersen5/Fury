const assert = require('assert');
const {
    createDenickDisplayNames,
    isRenderableName
} = require('../../src/denick/displayNames.js');

function makeRenamer({ enabled = true, map = { nickyboi: 'RealDude' }, resolve = null } = {}) {
    return createDenickDisplayNames({
        isEnabled: () => enabled,
        resolveRealName: resolve || (nick => map[String(nick).toLowerCase()] || null),
        logger: { error: () => {} }
    });
}

// --- name validation -------------------------------------------------------

{
    assert.strictEqual(isRenderableName('RealDude'), true);
    assert.strictEqual(isRenderableName('ab'), false, 'too short for a Minecraft name');
    assert.strictEqual(isRenderableName('a'.repeat(17)), false, 'too long');
    assert.strictEqual(isRenderableName('has space'), false);
    assert.strictEqual(isRenderableName('§cColored'), false, 'formatting codes are not a name');
    assert.strictEqual(isRenderableName(null), false);
}

// --- resolution rules ------------------------------------------------------

{
    const renamer = makeRenamer();
    assert.strictEqual(renamer.displayNameFor('NickyBoi'), 'RealDude', 'lookup is case-insensitive');
    assert.strictEqual(renamer.displayNameFor('Stranger'), null, 'unknown nicks are left alone');
    assert.strictEqual(renamer.displayNameFor(''), null);
    assert.strictEqual(renamer.displayNameFor(null), null);
}

{
    assert.strictEqual(makeRenamer({ enabled: false }).displayNameFor('nickyboi'), null, 'disabled renames nothing');
}

{
    // A "denick" resolving to the same name is not a rename.
    const renamer = makeRenamer({ map: { samename: 'SameName' } });
    assert.strictEqual(renamer.displayNameFor('SameName'), null);
}

{
    // A junk real name must never reach the wire — an invalid profile name
    // would corrupt the tab entry.
    const renamer = makeRenamer({ map: { nick: 'not a name!' } });
    assert.strictEqual(renamer.displayNameFor('nick'), null);
}

{
    // A throwing resolver degrades to "no rename" rather than killing packet
    // forwarding.
    const renamer = makeRenamer({ resolve: () => { throw new Error('boom'); } });
    assert.strictEqual(renamer.displayNameFor('nickyboi'), null);
}

// --- player_info rewriting -------------------------------------------------

{
    const renamer = makeRenamer();
    const packet = {
        action: 0,
        data: [
            { name: 'NickyBoi', UUID: 'u1', ping: 30 },
            { name: 'Someone', UUID: 'u2', ping: 40 }
        ]
    };
    const out = renamer.rewritePlayerInfo(packet, 'add_player');

    assert.notStrictEqual(out, packet, 'a changed packet is a new object');
    assert.strictEqual(out.data[0].name, 'RealDude', 'the known nick is renamed');
    assert.strictEqual(out.data[0].ping, 30, 'other fields survive');
    assert.strictEqual(out.data[1].name, 'Someone', 'unknown players are untouched');

    // Display-only: the packet used for bookkeeping must be unchanged.
    assert.strictEqual(packet.data[0].name, 'NickyBoi', 'the ORIGINAL packet still has the nick');
    assert.strictEqual(renamer.wasRewritten('nickyboi'), true, 'the rename is tracked');
}

{
    // No known nicks -> same object back, no allocation.
    const renamer = makeRenamer();
    const packet = { action: 0, data: [{ name: 'Someone' }] };
    assert.strictEqual(renamer.rewritePlayerInfo(packet, 'add_player'), packet);
}

{
    // Only ADD_PLAYER carries a name; other actions are UUID-keyed.
    const renamer = makeRenamer();
    const packet = { action: 1, data: [{ name: 'NickyBoi', gamemode: 0 }] };
    assert.strictEqual(renamer.rewritePlayerInfo(packet, 'update_gamemode'), packet, 'non-add actions pass through');
    assert.strictEqual(packet.data[0].name, 'NickyBoi');
}

{
    const renamer = makeRenamer();
    assert.strictEqual(renamer.rewritePlayerInfo(null, 'add_player'), null, 'malformed packets pass through');
    const noList = { action: 0 };
    assert.strictEqual(renamer.rewritePlayerInfo(noList, 'add_player'), noList);
}

// --- scoreboard_team rewriting ---------------------------------------------

{
    // The critical one: Hypixel adds team members BY NAME. If the rename is
    // not mirrored here the player drops out of their team and loses their
    // colour.
    const renamer = makeRenamer();
    const packet = { team: 'RED', mode: 3, players: ['NickyBoi', 'Someone'] };
    const out = renamer.rewriteTeamPacket(packet);

    assert.notStrictEqual(out, packet);
    assert.deepStrictEqual(out.players, ['RealDude', 'Someone'], 'team membership follows the rename');
    assert.strictEqual(out.team, 'RED', 'other team fields survive');
    assert.deepStrictEqual(packet.players, ['NickyBoi', 'Someone'], 'the original is untouched');
}

{
    const renamer = makeRenamer();
    const untouched = { team: 'RED', mode: 3, players: ['Someone'] };
    assert.strictEqual(renamer.rewriteTeamPacket(untouched), untouched, 'no known nicks, same object');
    assert.strictEqual(renamer.rewriteTeamPacket({ team: 'RED', mode: 1 }).players, undefined, 'no player list is fine');
    assert.strictEqual(renamer.rewriteTeamPacket(null), null);
}

{
    // player_info and scoreboard_team MUST agree, or the client puts a
    // differently-named player in the team and the colour is lost.
    const renamer = makeRenamer();
    const info = renamer.rewritePlayerInfo({ action: 0, data: [{ name: 'NickyBoi' }] }, 'add_player');
    const team = renamer.rewriteTeamPacket({ team: 'RED', mode: 3, players: ['NickyBoi'] });
    assert.strictEqual(info.data[0].name, team.players[0], 'both packets use the same rendered name');
}

// --- safety on the packet path ---------------------------------------------

{
    // Never rename onto a name that is genuinely present: two tab entries
    // under one name would make the client shuffle scoreboard-team membership
    // between them and render the wrong colours.
    const renamer = createDenickDisplayNames({
        isEnabled: () => true,
        resolveRealName: () => 'RealDude',
        isNameTaken: name => name === 'RealDude',
        logger: { error: () => {} }
    });
    assert.strictEqual(renamer.displayNameFor('NickyBoi'), null, 'collision blocks the rename');

    const packet = { action: 0, data: [{ name: 'NickyBoi' }] };
    assert.strictEqual(renamer.rewritePlayerInfo(packet, 'add_player'), packet, 'and the packet passes through');
}

{
    // A throw anywhere in the rewrite must forward the ORIGINAL packet, never
    // propagate — an exception on the clientbound path kills the connection.
    const exploding = createDenickDisplayNames({
        isEnabled: () => { throw new Error('boom'); },
        logger: { error: () => {} }
    });

    const info = { action: 0, data: [{ name: 'NickyBoi' }] };
    assert.strictEqual(exploding.rewritePlayerInfo(info, 'add_player'), info, 'player_info falls back to the original');

    const team = { team: 'RED', mode: 3, players: ['NickyBoi'] };
    assert.strictEqual(exploding.rewriteTeamPacket(team), team, 'scoreboard_team falls back to the original');

    // And the fallback packets are still intact, not partially rewritten.
    assert.strictEqual(info.data[0].name, 'NickyBoi');
    assert.deepStrictEqual(team.players, ['NickyBoi']);
}

{
    // A throwing collision check is treated as "do not rename".
    const renamer = createDenickDisplayNames({
        isEnabled: () => true,
        resolveRealName: () => 'RealDude',
        isNameTaken: () => { throw new Error('boom'); },
        logger: { error: () => {} }
    });
    assert.strictEqual(renamer.displayNameFor('NickyBoi'), null);
}

// --- bookkeeping -----------------------------------------------------------

{
    const renamer = makeRenamer();
    renamer.rewritePlayerInfo({ action: 0, data: [{ name: 'NickyBoi' }] }, 'add_player');

    const active = renamer.activeRenames();
    assert.strictEqual(active.length, 1);
    assert.strictEqual(active[0].nick, 'NickyBoi');
    assert.strictEqual(active[0].real, 'RealDude');

    assert.strictEqual(renamer.forget('NICKYBOI'), true, 'forget is case-insensitive');
    assert.strictEqual(renamer.wasRewritten('nickyboi'), false);

    renamer.rewritePlayerInfo({ action: 0, data: [{ name: 'NickyBoi' }] }, 'add_player');
    renamer.clear();
    assert.deepStrictEqual(renamer.activeRenames(), []);
}

// --- the proxy's OWN team writes must be renamed too ------------------------

{
    // The bug this guards: Hypixel's team packet was rewritten, but the proxy
    // re-sends team membership itself (restoring teams, nametag overlay). Those
    // writes carried the NICK, so the client's team contained a name that no
    // longer existed and the renamed player belonged to no team — rendering as
    // plain white text with no team prefix.
    const renamer = makeRenamer();

    // Whatever path builds it, the same rendered name must come out.
    const fromServer = renamer.rewriteTeamPacket({ team: 'RED', mode: 3, players: ['NickyBoi'] });
    const proxyRestore = renamer.rewriteTeamPacket({ team: 'RED', mode: 0, players: ['NickyBoi'], prefix: '§cRed ' });
    const proxyNametag = renamer.rewriteTeamPacket({ team: 'nt_1', mode: 3, players: ['NickyBoi'] });

    assert.strictEqual(fromServer.players[0], 'RealDude');
    assert.strictEqual(proxyRestore.players[0], 'RealDude', 'a proxy team restore uses the rendered name');
    assert.strictEqual(proxyNametag.players[0], 'RealDude', 'so does a nametag-overlay team');
    assert.strictEqual(proxyRestore.prefix, '§cRed ', 'the team prefix is preserved untouched');

    // Removal must rename too, or the client keeps a stale membership entry.
    const removal = renamer.rewriteTeamPacket({ team: 'RED', mode: 4, players: ['NickyBoi'] });
    assert.strictEqual(removal.players[0], 'RealDude', 'removals rename as well');
}

// --- scoreboard scores (teammate health) ------------------------------------

{
    // Scores are keyed by NAME and Hypixel drives the teammate health readout
    // with them. A renamed player whose score still points at the nick shows 0.
    const renamer = makeRenamer();
    const health = { itemName: 'NickyBoi', scoreName: 'health', value: 18, action: 0 };
    const out = renamer.rewriteScorePacket(health);

    assert.strictEqual(out.itemName, 'RealDude', 'the score follows the rename');
    assert.strictEqual(out.value, 18, 'the value is untouched');
    assert.strictEqual(health.itemName, 'NickyBoi', 'the original packet is untouched');

    // Removals must rename too, or a stale entry lingers under the old name.
    const removal = renamer.rewriteScorePacket({ itemName: 'NickyBoi', action: 1, scoreName: 'health' });
    assert.strictEqual(removal.itemName, 'RealDude');

    const other = { itemName: 'Someone', value: 20 };
    assert.strictEqual(renamer.rewriteScorePacket(other), other, 'unknown players pass through');
    assert.strictEqual(renamer.rewriteScorePacket(null), null);
    const sidebarLine = { itemName: '§aSome sidebar text', value: 3 };
    assert.strictEqual(renamer.rewriteScorePacket(sidebarLine), sidebarLine, 'sidebar lines are not names');
}

{
    // All three name-carrying packets must agree, or some part of the UI still
    // refers to a name the client no longer knows.
    const renamer = makeRenamer();
    const info = renamer.rewriteClientbound('player_info', { action: 0, data: [{ name: 'NickyBoi' }] }, 'add_player');
    const team = renamer.rewriteClientbound('scoreboard_team', { team: 'RED', mode: 3, players: ['NickyBoi'] });
    const score = renamer.rewriteClientbound('scoreboard_score', { itemName: 'NickyBoi', value: 20 });

    assert.strictEqual(info.data[0].name, 'RealDude');
    assert.strictEqual(team.players[0], 'RealDude');
    assert.strictEqual(score.itemName, 'RealDude');

    // Anything else is forwarded untouched.
    const chat = { message: 'hi' };
    assert.strictEqual(renamer.rewriteClientbound('chat', chat), chat);
}

// --- chat replacement -------------------------------------------------------

{
    let chatEnabled = true;
    const renamer = createDenickDisplayNames({
        isChatReplacementEnabled: () => chatEnabled,
        resolveRealName: nick => String(nick).toLowerCase() === 'nickyboi' ? 'RealDude' : null,
        logger: { error: () => {} }
    });
    const packet = {
        message: JSON.stringify({
            text: 'NickyBoi: ',
            clickEvent: { action: 'suggest_command', value: '/msg NickyBoi ' },
            extra: [
                { text: 'NickyBoi joined.' },
                { translate: 'chat.type.text', with: ['NickyBoi', { text: 'Hello NickyBoi' }] },
                { text: 'NickyBoi2 stays unchanged' }
            ]
        }),
        position: 0
    };
    const out = renamer.rewriteChatPacket(packet);
    const message = JSON.parse(out.message);

    assert.notStrictEqual(out, packet, 'a changed chat packet is copied for the client');
    assert.strictEqual(message.text, 'RealDude: ');
    assert.strictEqual(message.extra[0].text, 'RealDude joined.');
    assert.strictEqual(message.extra[1].with[0], 'RealDude', 'translation arguments are visible chat text');
    assert.strictEqual(message.extra[1].with[1].text, 'Hello RealDude');
    assert.strictEqual(message.extra[2].text, 'NickyBoi2 stays unchanged', 'only whole player-name tokens are replaced');
    assert.strictEqual(message.clickEvent.value, '/msg NickyBoi ', 'chat interaction metadata remains untouched');
    assert.strictEqual(JSON.parse(packet.message).text, 'NickyBoi: ', 'internal chat processing keeps the original server message');

    chatEnabled = false;
    assert.strictEqual(renamer.rewriteClientbound('chat', packet), packet, 'the chat setting controls the rewrite independently');
    assert.strictEqual(renamer.rewriteChatPacket({ message: 'not json' }).message, 'not json', 'malformed chat packets pass through');
}

// --- the rename is sticky ---------------------------------------------------

{
    const { resolveHypixelRank, extractText } = require('../../features/minecraft_chat');
    const rank = resolveHypixelRank({ monthlyPackageRank: 'SUPERSTAR', rankPlusColor: 'DARK_RED', monthlyRankColor: 'AQUA' });
    let enabled = true;
    const renamer = createDenickDisplayNames({
        isChatReplacementEnabled: () => enabled,
        resolveRealName: name => name === 'FunnyKid' ? 'Nestersen' : null,
        resolveChatRankedName: name => name === 'FunnyKid' ? `${rank.prefix} ${rank.nameColor}Nestersen` : null
    });
    const cases = [
        { text: '\u00a79Party > \u00a7a[VIP\u00a76+\u00a7a] FunnyKid\u00a7f: hello FunnyKid' },
        { text: 'Party > ', color: 'blue', extra: [
            { text: '[VIP', color: 'green' }, { text: '+', color: 'gold' },
            { text: '] ', color: 'green' },
            { text: 'FunnyKid', color: 'green', clickEvent: { action: 'suggest_command', value: '/msg FunnyKid ' }, hoverEvent: { action: 'show_text', value: 'FunnyKid' } },
            { text: ': hello FunnyKid', color: 'white' }
        ] },
        { text: 'Party > FunnyKid: hello FunnyKid' }
    ];
    for (const input of cases) {
        const packet = { message: JSON.stringify(input), position: 0 };
        const output = JSON.parse(renamer.rewriteChatPacket(packet).message);
        assert.strictEqual(extractText(output), 'Party > [MVP++] Nestersen: hello Nestersen');
        const runs = [];
        function collect(node) {
            if (Array.isArray(node)) return node.forEach(collect);
            if (node && typeof node === 'object') { runs.push(node); collect(node.extra); }
        }
        collect(output);
        assert(runs.some(run => run.text === '++' && run.color === 'dark_red'), 'real plus color survives');
        assert(runs.some(run => run.text.includes('Nestersen') && run.color === 'aqua'), 'monthly rank/name color survives');
        assert.strictEqual(packet.message, JSON.stringify(input), 'server packet is untouched');
        if (input.extra) {
            assert(runs.some(run => run.clickEvent?.value === '/msg FunnyKid ' && run.hoverEvent?.value === 'FunnyKid'), 'original server interaction targets survive');
            assert(runs.some(run => run.text === ': hello Nestersen' && run.color === 'white'), 'message body retains its color');
        }
        enabled = false;
        assert.strictEqual(renamer.rewriteChatPacket(packet), packet);
        enabled = true;
    }
    const mentions = { message: JSON.stringify({ text: 'FunnyKid and FunnyKid2 joined' }) };
    assert.strictEqual(extractText(JSON.parse(renamer.rewriteChatPacket(mentions).message)), 'Nestersen and FunnyKid2 joined');
    const repeated = { message: JSON.stringify({ text: '[VIP+] FunnyKid: hi [MVP+] FunnyKid: bye' }) };
    assert.strictEqual(extractText(JSON.parse(renamer.rewriteChatPacket(repeated).message)), '[MVP++] Nestersen: hi [MVP++] Nestersen: bye');
    const unranked = createDenickDisplayNames({
        isChatReplacementEnabled: () => true,
        resolveChatRankedName: name => name === 'FunnyKid' ? '\u00a77Nestersen' : null
    });
    assert.strictEqual(extractText(JSON.parse(unranked.rewriteChatPacket(repeated).message)), 'Nestersen: hi Nestersen: bye', 'a real default rank removes the fake badge');
    for (const grey of [
        { text: '§7FunnyKid§7: hello there' },
        { text: '', extra: [{ text: 'FunnyKid', color: 'gray' }, { text: ': hello there', color: 'gray' }] },
        { text: 'FunnyKid: hello there', color: 'gray' }
    ]) {
        const output = JSON.parse(renamer.rewriteChatPacket({ message: JSON.stringify(grey) }).message);
        assert.strictEqual(extractText(output), '[MVP++] Nestersen: hello there');
        const runs = [];
        (function collect(node) {
            if (Array.isArray(node)) return node.forEach(collect);
            if (node && typeof node === 'object') { runs.push(node); collect(node.extra); }
        })(output);
        assert(runs.filter(run => /hello/.test(run.text)).every(run => run.color === 'white'), 'a ranked real name whitens the grey unranked message body');
        const keptGrey = JSON.parse(unranked.rewriteChatPacket({ message: JSON.stringify(grey) }).message);
        const greyRuns = [];
        (function collect(node) {
            if (Array.isArray(node)) return node.forEach(collect);
            if (node && typeof node === 'object') { greyRuns.push(node); collect(node.extra); }
        })(keptGrey);
        assert(greyRuns.filter(run => /hello/.test(run.text)).every(run => run.color === 'gray'), 'an unranked real name keeps the grey body');
    }
    const translated = { message: JSON.stringify({ translate: 'chat.type.text', with: [
        { text: '[VIP+] FunnyKid' }, { text: 'hello' }
    ] }) };
    const result = JSON.parse(renamer.rewriteChatPacket(translated).message);
    assert.strictEqual(result.translate, 'chat.type.text');
    assert.strictEqual(extractText(result.with[0]), '[MVP++] Nestersen');
    assert.strictEqual(extractText(result.with[1]), 'hello');
}

{
    // The bug: the rename decision was re-derived on every packet, so it
    // changed as denick data arrived. Hypixel sends the team packet early
    // (nick unresolved -> keeps the nick) and player_info lands later (denick
    // resolved -> real IGN). The two disagreed, the renamed player belonged to
    // no team, and rendered as plain white text with no team prefix.
    let resolved = false;
    const renamer = createDenickDisplayNames({
        isEnabled: () => true,
        resolveRealName: nick => (resolved && String(nick).toLowerCase() === 'nickyboi' ? 'RealDude' : null),
        logger: { error: () => {} }
    });

    const early = renamer.rewriteTeamPacket({ team: 'RED', mode: 3, players: ['NickyBoi'] });
    assert.deepStrictEqual(early.players, ['NickyBoi'], 'before the denick lands nothing is renamed');

    resolved = true;
    assert.strictEqual(renamer.displayNameFor('NickyBoi'), 'RealDude');

    // ...and now the decision must never swing back, whatever the resolver says.
    resolved = false;
    assert.strictEqual(renamer.displayNameFor('NickyBoi'), 'RealDude', 'the rename is frozen for the session');
    assert.strictEqual(
        renamer.rewriteTeamPacket({ team: 'RED', mode: 3, players: ['NickyBoi'] }).players[0],
        'RealDude',
        'later team packets follow the frozen name'
    );
}

{
    // A collision that appears AFTER the rename must not unpick it either: the
    // client already has a tab row and a team membership under the real IGN.
    let taken = false;
    const renamer = createDenickDisplayNames({
        isEnabled: () => true,
        resolveRealName: () => 'RealDude',
        isNameTaken: () => taken,
        logger: { error: () => {} }
    });
    assert.strictEqual(renamer.displayNameFor('NickyBoi'), 'RealDude');
    taken = true;
    assert.strictEqual(renamer.displayNameFor('NickyBoi'), 'RealDude', 'a late collision does not undo a live rename');
}

{
    // Turning the feature off drops the freeze, so nothing is stuck renamed.
    let enabled = true;
    const renamer = createDenickDisplayNames({
        isEnabled: () => enabled,
        resolveRealName: () => 'RealDude',
        logger: { error: () => {} }
    });
    assert.strictEqual(renamer.displayNameFor('NickyBoi'), 'RealDude');
    enabled = false;
    assert.strictEqual(renamer.displayNameFor('NickyBoi'), null, 'the toggle still wins over the freeze');
    renamer.clear();
    enabled = true;
    assert.strictEqual(renamer.wasRewritten('NickyBoi'), false, 'clear() releases the freeze');
}

// --- the rename is retroactive ----------------------------------------------

function makeConverging({ map = { nickyboi: 'RealDude' } } = {}) {
    const sent = [];
    let resolves = false;
    const renamer = createDenickDisplayNames({
        isEnabled: () => true,
        resolveRealName: nick => (resolves ? map[String(nick).toLowerCase()] || null : null),
        resend: (packetName, payload) => sent.push({ packetName, payload }),
        logger: { error: () => {} }
    });
    return { renamer, sent, resolve: () => { resolves = true; } };
}

{
    // Freezing alone only stops FUTURE packets disagreeing. What the client was
    // already told under the nick still points at a name that no longer exists,
    // so it has to be re-issued or the player stays half-renamed.
    const { renamer, sent, resolve } = makeConverging();

    renamer.rewriteTeamPacket({ team: 'RED', mode: 3, players: ['NickyBoi', 'Someone'] });
    renamer.rewriteScorePacket({ itemName: 'NickyBoi', scoreName: 'health', value: 18, action: 0 });
    assert.deepStrictEqual(sent, [], 'nothing is re-issued while the nick is all the client knows');

    resolve();
    const info = renamer.rewritePlayerInfo({ action: 0, data: [{ name: 'NickyBoi', uuid: 'u1' }] }, 'add_player');
    assert.strictEqual(info.data[0].name, 'RealDude');

    const teamWrites = sent.filter(p => p.packetName === 'scoreboard_team').map(p => p.payload);
    assert.deepStrictEqual(
        teamWrites,
        [
            { team: 'RED', mode: 4, players: ['NickyBoi'] },
            { team: 'RED', mode: 3, players: ['RealDude'] }
        ],
        'the stale membership is retired and the team re-adds the real IGN'
    );

    const scoreWrites = sent.filter(p => p.packetName === 'scoreboard_score').map(p => p.payload);
    assert.deepStrictEqual(
        scoreWrites,
        [
            { itemName: 'NickyBoi', scoreName: 'health', action: 1 },
            { itemName: 'RealDude', scoreName: 'health', value: 18, action: 0 }
        ],
        'the health score moves across, so the teammate readout is not 0'
    );

    // Convergence is once-only: the client is already in step.
    const before = sent.length;
    renamer.rewriteTeamPacket({ team: 'RED', mode: 3, players: ['NickyBoi'] });
    assert.strictEqual(sent.length, before, 'a settled rename re-issues nothing');
}

{
    // The mirror case: the tab row went out under the nick and the denick lands
    // afterwards. The row itself is what the entity name and every by-name
    // lookup are built from, so it is re-added under the real IGN.
    const { renamer, sent, resolve } = makeConverging();
    renamer.rewritePlayerInfo({ action: 0, data: [{ name: 'NickyBoi', uuid: 'u1', ping: 30 }] }, 'add_player');
    assert.deepStrictEqual(sent, [], 'an unresolved nick is left alone');

    resolve();
    renamer.rewriteScorePacket({ itemName: 'NickyBoi', scoreName: 'health', value: 20, action: 0 });

    const infoWrites = sent.filter(p => p.packetName === 'player_info').map(p => p.payload);
    assert.strictEqual(infoWrites.length, 2, 'the row is retired and re-added');
    assert.deepStrictEqual(infoWrites[0], { action: 'remove_player', data: [{ uuid: 'u1' }] });
    assert.strictEqual(infoWrites[1].action, 'add_player');
    assert.deepStrictEqual(infoWrites[1].data[0], { name: 'RealDude', uuid: 'u1', ping: 30 }, 'the profile survives intact');
}

{
    // A player who left takes their tab row with them — re-adding it later
    // would resurrect a ghost in the tab list.
    const { renamer, sent, resolve } = makeConverging();
    renamer.rewritePlayerInfo({ action: 0, data: [{ name: 'NickyBoi', uuid: 'u1' }] }, 'add_player');
    renamer.rewritePlayerInfo({ action: 4, data: [{ uuid: 'u1' }] }, 'remove_player');

    resolve();
    renamer.rewriteScorePacket({ itemName: 'NickyBoi', scoreName: 'health', value: 20, action: 0 });
    assert.deepStrictEqual(sent.filter(p => p.packetName === 'player_info'), [], 'a departed player is not re-added');
}

{
    // Entries the client no longer holds must not be re-issued: a removed team
    // member, a removed score, a disbanded team.
    const { renamer, sent, resolve } = makeConverging();
    renamer.rewriteTeamPacket({ team: 'RED', mode: 3, players: ['NickyBoi'] });
    renamer.rewriteTeamPacket({ team: 'BLUE', mode: 0, players: ['NickyBoi'] });
    renamer.rewriteTeamPacket({ team: 'RED', mode: 4, players: ['NickyBoi'] });
    renamer.rewriteTeamPacket({ team: 'BLUE', mode: 1 });
    renamer.rewriteScorePacket({ itemName: 'NickyBoi', scoreName: 'health', value: 18, action: 0 });
    renamer.rewriteScorePacket({ itemName: 'NickyBoi', scoreName: 'health', action: 1 });

    resolve();
    renamer.rewritePlayerInfo({ action: 0, data: [{ name: 'NickyBoi', uuid: 'u1' }] }, 'add_player');
    assert.deepStrictEqual(sent, [], 'nothing stale is left to re-issue');
}

{
    // The host is told once per player, so it can re-apply whatever it had
    // layered on the old tab row (tab stats overwrite the display name).
    const seen = [];
    const renamer = createDenickDisplayNames({
        isEnabled: () => true,
        resolveRealName: () => 'RealDude',
        onRename: entry => seen.push(entry),
        logger: { error: () => {} }
    });
    renamer.displayNameFor('NickyBoi');
    renamer.displayNameFor('NickyBoi');
    renamer.rewriteTeamPacket({ team: 'RED', mode: 3, players: ['NickyBoi'] });
    assert.deepStrictEqual(seen, [{ nick: 'NickyBoi', real: 'RealDude' }], 'exactly one notification per player');
}

{
    // A host that throws on the re-issue path must not take the connection
    // down with it, and the packet in hand still has to be rewritten.
    const renamer = createDenickDisplayNames({
        isEnabled: () => true,
        resolveRealName: () => 'RealDude',
        resend: () => { throw new Error('boom'); },
        onRename: () => { throw new Error('boom'); },
        logger: { error: () => {} }
    });
    renamer.rewriteTeamPacket({ team: 'RED', mode: 3, players: ['NickyBoi'] });
    const out = renamer.rewritePlayerInfo({ action: 0, data: [{ name: 'NickyBoi', uuid: 'u1' }] }, 'add_player');
    assert.strictEqual(out.data[0].name, 'RealDude', 'a throwing host does not block the rename');
}

// --- live name toggle ------------------------------------------------------

{
    // The launcher may flip the setting while both the player entity and its
    // tab/team/health entries are already live. Keep enough state to move all
    // three immediately in either direction; the host handles the entity
    // respawn through onProfileReissued.
    let enabled = true;
    const sent = [];
    const reissued = [];
    const renamer = createDenickDisplayNames({
        isEnabled: () => enabled,
        resolveRealName: () => 'RealDude',
        resend: (packetName, payload) => sent.push({ packetName, payload }),
        onProfileReissued: profile => reissued.push(profile.name),
        logger: { error: () => {} }
    });

    renamer.rewritePlayerInfo({ action: 0, data: [{ name: 'NickyBoi', uuid: 'u1' }] }, 'add_player');
    renamer.rewriteTeamPacket({ team: 'RED', mode: 3, players: ['NickyBoi'] });
    renamer.rewriteScorePacket({ itemName: 'NickyBoi', scoreName: 'health', value: 18, action: 0 });
    sent.length = 0;

    enabled = false;
    assert.strictEqual(renamer.refreshNameReplacement(), true, 'turning names off triggers a live reapply');
    const offProfiles = sent.filter(entry => entry.packetName === 'player_info').map(entry => entry.payload);
    assert.deepStrictEqual(offProfiles, [
        { action: 'remove_player', data: [{ uuid: 'u1' }] },
        { action: 'add_player', data: [{ name: 'NickyBoi', uuid: 'u1' }] }
    ], 'the original nick profile is restored immediately');
    assert.deepStrictEqual(
        sent.filter(entry => entry.packetName === 'scoreboard_team').map(entry => entry.payload),
        [{ team: 'RED', mode: 4, players: ['RealDude'] }, { team: 'RED', mode: 3, players: ['NickyBoi'] }],
        'team membership follows the restored nick'
    );
    assert.deepStrictEqual(
        sent.filter(entry => entry.packetName === 'scoreboard_score').map(entry => entry.payload),
        [{ itemName: 'RealDude', scoreName: 'health', action: 1 }, { itemName: 'NickyBoi', scoreName: 'health', value: 18, action: 0 }],
        'health follows the restored nick'
    );
    assert.deepStrictEqual(reissued, ['NickyBoi'], 'the host is asked to refresh the visible entity too');

    sent.length = 0;
    enabled = true;
    assert.strictEqual(renamer.refreshNameReplacement(), true, 'turning names back on triggers a live reapply');
    const onProfiles = sent.filter(entry => entry.packetName === 'player_info').map(entry => entry.payload);
    assert.deepStrictEqual(onProfiles, [
        { action: 'remove_player', data: [{ uuid: 'u1' }] },
        { action: 'add_player', data: [{ name: 'RealDude', uuid: 'u1' }] }
    ], 'the real profile is restored without a new server packet');
    assert.deepStrictEqual(reissued, ['NickyBoi', 'RealDude']);
}

console.log('test_denick_display_names.js: all assertions passed');
