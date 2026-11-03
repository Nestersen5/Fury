const assert = require('assert');
const {
    buildLobbyBoard, buildIndentedBoard, buildBedwarsSidebar, isBedwarsLobbyBoard, splitRow, normalizeLobbyScoreboardStyle, fkdrSummary,
    readDailyBedwarsDelta, readOwnBedwarsStats, LOBBY_SCOREBOARD_STYLES, DEFAULT_LOBBY_SCOREBOARD_STYLE, MAX_ROWS, plain,
    normalizeLobbyScoreboardDecimals, DEFAULT_LOBBY_SCOREBOARD_DECIMALS
} = require('../../src/scoreboard/lobbyBoard');
const { createLobbySidebar, OBJECTIVE } = require('../../src/scoreboard/lobbySidebar');

const LOBBY = ['§711/02/26 §8L12A', '', 'Level: §b312✫', '', 'Progress: §b2.7k§7/§a5k', '§8[§b■■■■■§7■■■■■§8]', '',
    'Tokens: §2123,456', 'Slumber Tickets: §b139/100,000', '', 'Total Kills: §a12,345', 'Total Wins: §a1,234', '', '§ewww.hypixel.net'];
const STATS = { finals: 5000, deaths: 1560, winstreak: 7, dailyFinals: 60, dailyDeaths: 5 };

// ---- Layout ----------------------------------------------------------------
{
    assert.strictEqual(isBedwarsLobbyBoard('§e§lBED WARS', LOBBY), true);
    assert.strictEqual(isBedwarsLobbyBoard('§e§lBED WARS', ['Map: §aLighthouse', 'Players: §a7/8']), false, 'pregame is not a lobby');
    assert.strictEqual(isBedwarsLobbyBoard('§e§lSKYWARS', LOBBY), false);
    assert.strictEqual(buildLobbyBoard({ title: 'BED WARS', lines: ['§cR §fRed: §a✔'] }), null, 'in-game boards are left alone');

    const board = buildLobbyBoard({ title: '§e§lBED WARS', lines: LOBBY, style: 'grey', stats: STATS });
    assert.strictEqual(board.title, '§e§lBED WARS', 'the title stays yellow');
    assert.strictEqual(board.rows.length, MAX_ROWS);
    const text = board.rows.map(row => plain(row).trim());
    assert.deepStrictEqual(text, ['11/02/26 L12A', '', 'Level: 312✫', '', 'Progress: 2.7k/5k', '■'.repeat(10), '', 'Tokens: 123,456',
        'Slumber: 139/100,000', '', 'Total Kills: 12,345', 'Total Wins: 1,234', 'FKDR: 3.2051 ▲0.0283', 'Winstreak: 7', '']);
    assert.ok(board.rows[2].endsWith('§b312✫'), 'Level keeps its prestige colors');
    assert.ok(board.rows[5].startsWith(' §a■■■■■§8'), 'the bar fills 5 of 10 squares for 2.7k/5k');
    assert.ok(board.rows.filter(row => row && !row.startsWith('    ')).every(row => row.startsWith(' ')), 'rows start one space in from the edge');
    assert.strictEqual(text[1], '', 'the date/server row stays separated from Level with FKDR rows');
    assert.strictEqual(text[text.indexOf('Winstreak: 7') + 1], '', 'an empty row follows Winstreak');
    assert.ok(board.rows[0].startsWith(' '), 'the date row is centered with spaces');
    assert.ok(!text.includes('www.hypixel.net'), 'the footer gives way to the FKDR rows');

    for (const style of LOBBY_SCOREBOARD_STYLES) {
        const rows = buildLobbyBoard({ title: 'BED WARS', lines: LOBBY, style: style.id, stats: STATS }).rows;
        assert.strictEqual(rows.length, MAX_ROWS, `${style.id} fits 15 rows`);
        const visibleRows = rows.map(row => plain(row).trim());
        assert.strictEqual(visibleRows[visibleRows.findIndex(row => row.startsWith('FKDR:')) - 1], 'Total Wins: 1,234', `${style.id} puts FKDR directly after totals`);
        assert.strictEqual(visibleRows[6], '', `${style.id} keeps the gap below the progress bar`);
        assert.strictEqual(visibleRows[9], '', `${style.id} replaces OVERALL with one blank row`);
        for (const row of rows) {
            const { prefix, entry, suffix } = splitRow(row);
            assert.ok(prefix.length <= 16 && entry.length <= 40 && suffix.length <= 16, `${style.id}: "${row}" fits a scoreboard row`);
            assert.strictEqual(plain(prefix + entry + suffix), plain(row), `${style.id}: "${row}" keeps its text when split`);
        }
    }

    const noStats = buildLobbyBoard({ title: 'BED WARS', lines: LOBBY, style: 'classic' });
    assert.deepStrictEqual(noStats.rows.slice(0, 12).map(row => plain(row).trim()), text.slice(0, 12), 'loading FKDR and Winstreak does not remove or move the earlier gaps');
    assert.deepStrictEqual(noStats.rows.slice(0, 5).map(row => plain(row).trim()), ['11/02/26 L12A', '', 'Level: 312✫', '', 'Progress: 2.7k/5k'], 'gaps under the date and Level when there is room');
    const rainbow = splitRow(' §7Level: §6[§e2§a0§b1§d2§5✫§6]');
    assert.strictEqual(plain(rainbow.prefix + rainbow.entry + rainbow.suffix), ' Level: [2012✫]', 'multi-colored prestige levels fit without cutting');
    assert.ok(!noStats.rows.some(row => /FKDR|Winstreak/.test(row)), 'no FKDR rows without stats');
    assert.strictEqual(plain(noStats.rows[noStats.rows.length - 1]).trim(), 'www.hypixel.net', 'the footer returns when there is room');

    const extra = buildLobbyBoard({ title: 'BED WARS', lines: [...LOBBY, 'Loot Chests: §60', 'Event: §dHalloween', 'Unknown: §71'], stats: STATS });
    assert.ok(extra.rows.length <= MAX_ROWS, 'unknown Hypixel rows never exceed 15 rows');
    assert.ok(extra.rows.some(row => row.includes('Loot Chests')), 'unknown rows are kept as sent');
    assert.ok(extra.rows.some(row => plain(row).trim().startsWith('FKDR')), 'gaps are dropped before content');

    const emoji = buildLobbyBoard({ title: 'BED WARS', lines: LOBBY.map(line => `${line}\u{1F600}`), stats: null });
    assert.ok(emoji && emoji.rows.every(row => !/[\u{10000}-\u{10FFFF}]/u.test(row)), 'invisible emoji entries are removed');
}

// Compare the actual legacy colour/style of every visible character, including
// across the entry's reset codes, rather than checking just stripped text.
function styledGlyphs(text) {
    let color = 'f';
    const styles = new Set(), glyphs = [];
    for (let i = 0; i < text.length; i++) {
        if (text[i] !== '§') { glyphs.push([text[i], color, [...styles].sort().join('')]); continue; }
        const code = text[++i].toLowerCase();
        if (/[0-9a-f]/.test(code)) { color = code; styles.clear(); }
        else if (code === 'r') { color = 'f'; styles.clear(); }
        else styles.add(code);
    }
    return glyphs;
}

{
    for (const style of LOBBY_SCOREBOARD_STYLES) {
        for (const amount of ['0', '139', '999', '1,000', '2,669', '9,999', '10,000', '99,999', '100,000']) {
            const lines = LOBBY.map(line => line.startsWith('Slumber Tickets:') ? `Slumber Tickets: §b${amount}§7/§b100,000` : line);
            const row = buildLobbyBoard({ title: 'BED WARS', lines, style: style.id }).rows.find(row => plain(row).includes('Slumber:'));
            const split = splitRow(row, 8), drawn = split.prefix + split.entry + split.suffix;
            assert.ok(split.prefix.length <= 16 && split.suffix.length <= 16 && split.entry.length <= 40, `${style.id}, ${amount}: packet limits`);
            assert.strictEqual(plain(drawn), ` Slumber: ${amount}/100,000`, `${style.id}, ${amount}: full ticket count and capacity`);
            assert.deepStrictEqual(styledGlyphs(drawn), styledGlyphs(row), `${style.id}, ${amount}: ticket colours survive the split`);
        }
    }
    const long = ' §b§l' + 'A'.repeat(50);
    const split = splitRow(long);
    assert.ok(split.suffix, 'very long rows use all three text fields');
    assert.deepStrictEqual(styledGlyphs(split.prefix + split.entry + split.suffix), styledGlyphs(long), 'formatting also carries from the middle field into the suffix');
    assert.strictEqual(new Set(Array.from({ length: MAX_ROWS }, (_, i) => splitRow(long, i).entry)).size, MAX_ROWS, 'identical long rows still have distinct entries');
}

// ---- Values and settings ---------------------------------------------------
{
    assert.strictEqual(DEFAULT_LOBBY_SCOREBOARD_DECIMALS, 4, 'four decimal digits by default');
    for (const input of [undefined, null, '', ' ', NaN, Infinity, 'bad', true, [], {}]) {
        assert.strictEqual(normalizeLobbyScoreboardDecimals(input), 4, `invalid precision falls back: ${String(input)}`);
    }
    for (const [input, expected] of [[-1, 0], [5, 4], [2.9, 2], ['0', 0], ['4', 4]]) {
        assert.strictEqual(normalizeLobbyScoreboardDecimals(input), expected);
    }
    const expectedFkdr = ['3', '3.2', '3.21', '3.205', '3.2051'];
    const expectedChange = [null, null, '§a▲0.03', '§a▲0.028', '§a▲0.0283'];
    for (let decimals = 0; decimals <= 4; decimals++) {
        const summary = fkdrSummary(STATS, decimals);
        assert.deepStrictEqual(summary, { value: expectedFkdr[decimals], change: expectedChange[decimals] });
        for (const style of LOBBY_SCOREBOARD_STYLES) {
            const board = buildLobbyBoard({ title: 'BED WARS', lines: LOBBY, stats: STATS, style: style.id, decimals });
            const row = board.rows.find(row => plain(row).trim().startsWith('FKDR:'));
            const split = splitRow(row, 12);
            assert.strictEqual(plain(split.prefix + split.entry + split.suffix).trim(), `FKDR: ${expectedFkdr[decimals]}${expectedChange[decimals] ? ' ' + plain(expectedChange[decimals]) : ''}`);
            assert.deepStrictEqual(styledGlyphs(split.prefix + split.entry + split.suffix), styledGlyphs(row));
            assert.strictEqual(board.rows.length, MAX_ROWS, 'precision does not move or remove rows');
        }
    }
    assert.deepStrictEqual(fkdrSummary({ finals: 5000, deaths: 1560, dailyFinals: 2, dailyDeaths: 10 }, 4), { value: '3.2051', change: '§c▼0.0194' });
    assert.deepStrictEqual(fkdrSummary({ finals: 10, deaths: 0 }, 0), { value: '10', change: null }, 'zero-death FKDR still uses finals');
    assert.deepStrictEqual(buildIndentedBoard({ title: '§e§lBED WARS', lines: ['Map: §aLighthouse', '§7', 'Players: §a7/8'] }),
        { title: '§e§lBED WARS', rows: [' Map: §aLighthouse', '', ' Players: §a7/8'] }, 'pregame lines are kept and indented');
    assert.strictEqual(buildIndentedBoard({ title: 'SKYWARS', lines: ['Kills: 1'] }), null, 'only Bed Wars boards');
    assert.strictEqual(buildIndentedBoard({ title: 'BED WARS', lines: [] }), null, 'nothing to show yet');
    assert.ok(buildBedwarsSidebar({ title: 'BED WARS', lines: LOBBY }).rows.some(row => plain(row).includes('Slumber:')), 'lobbies keep the custom layout');
    assert.strictEqual(normalizeLobbyScoreboardStyle('GOLD'), 'gold');
    assert.strictEqual(normalizeLobbyScoreboardStyle('neon'), DEFAULT_LOBBY_SCOREBOARD_STYLE);
    assert.strictEqual(DEFAULT_LOBBY_SCOREBOARD_STYLE, 'classic');
    assert.deepStrictEqual(fkdrSummary({ finals: 5000, deaths: 1560, dailyFinals: 2, dailyDeaths: 10 }), { value: '3.2051', change: '§c▼0.0194' });
    assert.deepStrictEqual(fkdrSummary({ finals: 5000, deaths: 1560, dailyFinals: 3, dailyDeaths: 1 }, 2), { value: '3.21', change: null }, 'a change rounding to zero is hidden');
    assert.deepStrictEqual(fkdrSummary({ finals: 5, deaths: 1560, dailyFinals: 60, dailyDeaths: 1 }), { value: '0.0032', change: null }, 'inconsistent daily numbers are ignored');
    assert.strictEqual(fkdrSummary({ finals: 10 }), null);
    assert.deepStrictEqual(readDailyBedwarsDelta({ delta: { stats: { Bedwars: { final_kills_bedwars: 12, final_deaths_bedwars: { old: 100, new: 103 } } } } }), { finals: 12, deaths: 3 });
    assert.deepStrictEqual(readDailyBedwarsDelta({ delta: { stats: { Bedwars: {} } } }), { finals: 0, deaths: 0 }, 'no games today');
    assert.strictEqual(readDailyBedwarsDelta({ error: 'Urchin API key not set.' }), null);
    assert.strictEqual(readDailyBedwarsDelta({ delta: { stats: { Bedwars: { final_kills_bedwars: 'x' } } } }), null);
    assert.deepStrictEqual(readOwnBedwarsStats({ stats: { Bedwars: { final_kills_bedwars: 9, final_deaths_bedwars: 3, winstreak: 2 } } }), { finals: 9, deaths: 3, winstreak: 2 });
    assert.strictEqual(readOwnBedwarsStats({ stats: { Bedwars: { final_kills_bedwars: 9 } } }).winstreak, null, 'hidden winstreak stays hidden');
}

// ---- Sidebar swap against a strict 1.8.9 client model ----------------------
function createClientModel() {
    const objectives = new Map(), teams = new Map(), entryTeam = new Map(), scores = new Map();
    let slot = '';
    const fail = message => { throw new Error(`client would disconnect: ${message}`); };
    return {
        apply(name, data) {
            if (name === 'scoreboard_objective') {
                if (data.action === 0) { if (objectives.has(data.name)) fail(`duplicate objective ${data.name}`); objectives.set(data.name, data.displayText); }
                else if (data.action === 2) { if (!objectives.has(data.name)) fail(`update missing objective ${data.name}`); objectives.set(data.name, data.displayText); }
                else if (data.action === 1) { if (!objectives.has(data.name)) fail(`remove missing objective ${data.name}`); objectives.delete(data.name); scores.delete(data.name); if (slot === data.name) slot = ''; }
            } else if (name === 'scoreboard_display_objective') {
                if (data.position === 1) { if (data.name && !objectives.has(data.name)) fail(`display missing objective ${data.name}`); slot = data.name; }
            } else if (name === 'scoreboard_team') {
                if (data.mode === 0 || data.mode === 2) {
                    assert.ok(data.prefix.length <= 16 && data.suffix.length <= 16, 'team text respects the real client limits');
                }
                if (data.players) assert.ok(data.players.every(entry => entry.length <= 40), 'team entries respect the real client limit');
                const team = teams.get(data.team);
                if (data.mode === 0) { if (team) fail(`duplicate team ${data.team}`); teams.set(data.team, { prefix: data.prefix, suffix: data.suffix }); (data.players || []).forEach(p => entryTeam.set(p, data.team)); }
                else if (!team) fail(`team ${data.team} missing for mode ${data.mode}`);
                else if (data.mode === 1) { teams.delete(data.team); [...entryTeam].forEach(([p, t]) => t === data.team && entryTeam.delete(p)); }
                else if (data.mode === 2) Object.assign(team, { prefix: data.prefix, suffix: data.suffix });
                else if (data.mode === 3) data.players.forEach(p => entryTeam.set(p, data.team));
                else if (data.mode === 4) data.players.forEach(p => entryTeam.delete(p));
            } else if (name === 'scoreboard_score') {
                assert.ok(data.itemName.length <= 40, 'score entries respect the real client limit');
                if (data.action === 1) { scores.get(data.scoreName)?.delete(data.itemName); return; }
                if (!objectives.has(data.scoreName)) fail(`score for missing objective ${data.scoreName}`);
                if (!scores.has(data.scoreName)) scores.set(data.scoreName, new Map());
                scores.get(data.scoreName).set(data.itemName, data.value);
            }
        },
        // What the player sees: title and rows top first.
        sidebar() {
            if (!slot) return null;
            const rows = [...(scores.get(slot) || new Map())].sort((a, b) => b[1] - a[1]).map(([entry]) => {
                const team = teams.get(entryTeam.get(entry));
                return team ? team.prefix + entry + team.suffix : entry;
            });
            return { objective: slot, title: objectives.get(slot), raw: rows, rows: rows.map(row => plain(row).trim()), numbers: [...(scores.get(slot) || new Map()).values()].sort((a, b) => b - a) };
        },
        teamNames: () => [...teams.keys()]
    };
}

function harness() {
    const client = createClientModel();
    let queued = [];
    let enabled = true, stats = null, shows = 0, rewrite = data => data;
    const sidebar = createLobbySidebar({
        write: (name, data) => client.apply(name, data),
        buildBoard: input => (enabled ? buildBedwarsSidebar({ ...input, style: 'classic', stats }) : null),
        onShow: () => { shows += 1; },
        schedule: callback => { queued.push(callback); return callback; },
        cancel: handle => { queued = queued.filter(cb => cb !== handle); }
    });
    // A server packet: Fury observes it first, then it is forwarded unless held back.
    const server = (name, data) => {
        const held = sidebar.observeServer(name, data);
        if (!held) client.apply(name, data);
        // Team text is mirrored from what the client is sent; `rewrite` stands in for Fury's own sidebar rewrites.
        if (name === 'scoreboard_team') sidebar.observeClientTeam(rewrite(data));
        return held;
    };
    const flush = () => { const run = queued; queued = []; run.forEach(cb => cb()); };
    const sendBoard = (objective, title, lines) => {
        server('scoreboard_objective', { name: objective, action: 0, displayText: title, type: 'integer' });
        server('scoreboard_display_objective', { position: 1, name: objective });
        lines.forEach((line, i) => {
            const entry = `\u{1F600}${String.fromCodePoint(0x1F601 + i)}`;
            server('scoreboard_team', { team: `team_${objective}_${i}`, mode: 0, name: '', prefix: line.slice(0, 16), suffix: line.slice(16), friendlyFire: 0, nameTagVisibility: 'always', color: -1, players: [entry] });
            server('scoreboard_score', { itemName: entry, action: 0, scoreName: objective, value: lines.length - i });
        });
    };
    return { client, sidebar, server, flush, sendBoard, setEnabled: v => { enabled = v; }, setStats: v => { stats = v; }, setRewrite: fn => { rewrite = fn; }, shows: () => shows };
}

{
    const h = harness();
    h.sendBoard('lobbySB', '§e§lBED WARS', LOBBY);
    assert.strictEqual(h.client.sidebar().objective, 'lobbySB', 'nothing changes before the coalesced refresh');
    h.flush();
    let view = h.client.sidebar();
    assert.strictEqual(view.objective, OBJECTIVE, 'the Fury board is displayed');
    assert.strictEqual(view.title, '§e§lBED WARS');
    assert.deepStrictEqual(view.rows.map(r => r.trim()), buildLobbyBoard({ title: 'BED WARS', lines: LOBBY, style: 'classic' }).rows.map(r => plain(r).trim()));
    assert.strictEqual(view.numbers[view.numbers.length - 1], 1, 'red numbers count down to 1');
    assert.strictEqual(h.shows(), 1);

    // Hypixel re-sending its display slot is held back while the board is up.
    assert.strictEqual(h.server('scoreboard_display_objective', { position: 1, name: 'lobbySB' }), true);
    h.flush();
    assert.strictEqual(h.client.sidebar().objective, OBJECTIVE);

    // A line update and stats arriving update rows in place.
    h.server('scoreboard_team', { team: 'team_lobbySB_10', mode: 2, name: '', prefix: 'Total Kills: §a1', suffix: '2,400', friendlyFire: 0, nameTagVisibility: 'always', color: -1 });
    h.flush();
    assert.ok(h.client.sidebar().rows.includes('Total Kills: 12,400'));
    h.setStats(STATS);
    h.sidebar.refresh();
    view = h.client.sidebar();
    assert.strictEqual(view.rows.length, 15);
    assert.ok(view.rows.includes('FKDR: 3.2051 ▲0.0283') && view.rows.includes('Winstreak: 7'));
    assert.strictEqual(view.numbers[0], 15);

    // The screenshot's ticket count overflows the team fields. Updates across
    // that boundary must replace the score entry without leaving duplicate rows.
    for (const amount of ['2,669', '10,000', '100,000', '139', '2,669']) {
        const line = `Slumber Tickets: ${amount}/100,000`;
        h.server('scoreboard_team', { team: 'team_lobbySB_8', mode: 2, name: '', prefix: line.slice(0, 16), suffix: line.slice(16), friendlyFire: 0, nameTagVisibility: 'always', color: -1 });
        h.flush();
        view = h.client.sidebar();
        assert.strictEqual(view.rows.length, 15, 'ticket entry updates leave no stale rows');
        assert.deepStrictEqual(view.rows.filter(row => row.startsWith('Slumber:')), [`Slumber: ${amount}/100,000`]);
        assert.deepStrictEqual(view.numbers, Array.from({ length: 15 }, (_, i) => 15 - i), 'row order is preserved');
    }

    // Stats going away shrinks the board and removes exactly the extra teams.
    h.setStats(null);
    h.sidebar.refresh();
    assert.ok(!h.client.sidebar().rows.some(row => row.startsWith('FKDR')));

    // A Bed Wars game: Hypixel's lines, one space in, with the team text the
    // client was sent (an Enhanced scoreboard style rewrite here).
    h.setRewrite(data => (data.mode === 0 || data.mode === 2) && /Blue/.test(data.prefix || '') ? { ...data, prefix: '§8§mBlue' } : data);
    h.sendBoard('gameSB', '§e§lBED WARS', ['§711/02/26 §8m45K', '', 'Red: §a✔', 'Blue: §c✗']);
    h.flush();
    view = h.client.sidebar();
    assert.strictEqual(view.objective, OBJECTIVE, 'the in-game board is shown indented');
    assert.deepStrictEqual(view.rows, ['11/02/26 m45K', '', 'Red: ✔', 'Blue'], "Hypixel's lines with Fury's rewrites");
    assert.ok(view.raw[3].startsWith(' §8§mBlue'), 'the crossed-out team the client was sent');
    assert.ok(view.raw.filter((row, i) => view.rows[i]).every(row => row.startsWith(' ')), 'each line starts one space in');
    h.setRewrite(data => data);

    // Another game's board: Hypixel's board returns and every Fury team goes.
    h.sendBoard('skySB', '§e§lSKYWARS', ['Players left: §a12', 'Kills: §a0']);
    h.flush();
    view = h.client.sidebar();
    assert.strictEqual(view.objective, 'skySB', 'Hypixel board restored outside Bed Wars');
    assert.ok(!h.client.teamNames().some(name => name.startsWith('fury_lobby_')), 'every Fury team is removed');
    assert.strictEqual(h.client.teamNames().length, LOBBY.length + 4 + 2, "Hypixel's own teams are untouched");

    // Back to a lobby, then the feature is switched off live.
    h.sendBoard('lobby2', '§e§lBED WARS', LOBBY);
    h.flush();
    assert.strictEqual(h.client.sidebar().objective, OBJECTIVE);
    assert.strictEqual(h.shows(), 2);
    h.setEnabled(false);
    h.sidebar.refresh();
    assert.strictEqual(h.client.sidebar().objective, 'lobby2', 'switching off restores Hypixel at once');
    h.setEnabled(true);
    h.sidebar.refresh();
    assert.strictEqual(h.client.sidebar().objective, OBJECTIVE, 'switching on works without a new lobby');

    // Hypixel removing its lobby objective clears the Fury board too.
    h.server('scoreboard_objective', { name: 'lobby2', action: 1 });
    h.flush();
    assert.strictEqual(h.client.sidebar(), null);

    // A new world (login) resets client state without sending removals.
    h.sendBoard('lobby3', '§e§lBED WARS', LOBBY);
    h.flush();
    assert.strictEqual(h.client.sidebar().objective, OBJECTIVE);
}

{
    // Login: the real client drops its scoreboard, so Fury must not remove or
    // duplicate anything afterwards.
    const h = harness();
    h.sendBoard('lobbySB', 'BED WARS', LOBBY);
    h.flush();
    const fresh = createClientModel();
    h.client.apply = fresh.apply; h.client.sidebar = fresh.sidebar;
    h.server('login', {});
    h.sendBoard('lobbySB', 'BED WARS', LOBBY);
    h.flush();
    assert.strictEqual(fresh.sidebar().objective, OBJECTIVE, 'the board is recreated cleanly after a new world');
}

{
    // A failing layout never leaves a half-built board.
    const writes = [];
    const sidebar = createLobbySidebar({
        write: (name, data) => writes.push([name, data]),
        buildBoard: () => { throw new Error('bad'); },
        schedule: cb => cb, cancel: () => {}
    });
    sidebar.observeServer('scoreboard_objective', { name: 'x', action: 0, displayText: 'BED WARS' });
    sidebar.observeServer('scoreboard_display_objective', { position: 1, name: 'x' });
    sidebar.refresh();
    assert.strictEqual(writes.length, 0);
    assert.strictEqual(sidebar.observeServer('scoreboard_display_objective', { position: 0, name: 'x' }), false, 'other slots always pass through');
}

// ---- Settings persistence and launcher choices -----------------------------
{
    const fs = require('fs'), os = require('os'), path = require('path');
    const root = path.resolve(__dirname, '../..');
    const html = fs.readFileSync(path.join(root, 'launcher.html'), 'utf8');
    const select = html.match(/<select id="bedwars-lobby-scoreboard-style"[^>]*>([\s\S]*?)<\/select>/);
    assert.ok(select, 'the launcher has the lobby scoreboard color choice');
    const options = [...select[1].matchAll(/<option value="([^"]+)"(?: selected)?>([^<]+)<\/option>/g)].map(match => [match[1], match[2]]);
    assert.deepStrictEqual(options, LOBBY_SCOREBOARD_STYLES.map(style => [style.id, style.name]), 'launcher choices match the layout styles');

    const config = require('../../app_config.js');
    const originalPath = config.paths.features;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-lobby-scoreboard-'));
    try {
        config.paths.features = path.join(dir, 'features.json');
        const initial = config.loadFeatureSettings();
        assert.strictEqual(initial.bedwarsLobbyScoreboardEnabled, true, 'on by default');
        assert.strictEqual(initial.bedwarsLobbyScoreboardStyle, 'classic', 'Classic by default');
        assert.strictEqual(initial.bedwarsLobbyScoreboardDecimals, 4);
        fs.writeFileSync(config.paths.features, '{}');
        assert.deepStrictEqual(config.loadFeatureSettings(), initial, 'existing settings without scoreboard choices use the defaults');
        config.saveFeatureSettings({ bedwarsLobbyScoreboardEnabled: false, bedwarsLobbyScoreboardStyle: 'grey', bedwarsLobbyScoreboardDecimals: 0 });
        config.saveFeatureSettings({});
        const existing = config.loadFeatureSettings();
        assert.strictEqual(existing.bedwarsLobbyScoreboardEnabled, false, 'saved off is preserved');
        assert.strictEqual(existing.bedwarsLobbyScoreboardStyle, 'grey', 'saved colors are preserved');
        assert.strictEqual(existing.bedwarsLobbyScoreboardDecimals, 0, 'saved zero digits is preserved');
        for (let decimals = 0; decimals <= 4; decimals++) {
            config.saveFeatureSettings({ ...initial, bedwarsLobbyScoreboardDecimals: decimals });
            assert.strictEqual(config.loadFeatureSettings().bedwarsLobbyScoreboardDecimals, decimals, 'precision survives saving/reloading, including zero');
        }
        config.saveFeatureSettings({ ...initial, bedwarsLobbyScoreboardDecimals: 20 });
        assert.strictEqual(config.loadFeatureSettings().bedwarsLobbyScoreboardDecimals, 4, 'saved precision is bounded');
        config.saveFeatureSettings({ ...initial, bedwarsLobbyScoreboardEnabled: true, bedwarsLobbyScoreboardStyle: 'aqua' });
        let saved = config.loadFeatureSettings();
        assert.strictEqual(saved.bedwarsLobbyScoreboardEnabled, true);
        assert.strictEqual(saved.bedwarsLobbyScoreboardStyle, 'aqua');
        config.saveFeatureSettings({ ...saved, bedwarsLobbyScoreboardStyle: 'rainbow' });
        saved = config.loadFeatureSettings();
        assert.strictEqual(saved.bedwarsLobbyScoreboardStyle, 'classic', 'unknown colors fall back to the default');
        assert.strictEqual(saved.bedwarsLobbyScoreboardEnabled, true, 'other saves keep the switch');
    } finally {
        config.paths.features = originalPath;
        fs.rmSync(dir, { recursive: true, force: true });
    }

    const bootstrap = fs.readFileSync(path.join(root, 'src', 'bootstrap', 'config.js'), 'utf8');
    const proxy = fs.readFileSync(path.join(root, 'proxy.js'), 'utf8');
    for (const key of ['bedwarsLobbyScoreboardEnabled', 'bedwarsLobbyScoreboardStyle', 'bedwarsLobbyScoreboardDecimals']) {
        assert.ok(bootstrap.includes(`${key}:`), `the proxy settings parser keeps ${key}`);
        assert.ok(proxy.includes(`${key} = `) && (proxy.match(new RegExp(`\\b${key},`, 'g')) || []).length >= 3, `the proxy loads and saves ${key}`);
    }
}

console.log('lobby scoreboard tests passed');
