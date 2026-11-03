'use strict';

const { splitRow, entryName, MAX_ROWS } = require('./lobbyBoard');

// Shows a Fury-owned sidebar in place of Hypixel's while `buildBoard` returns
// rows for what Hypixel is currently showing, and puts Hypixel's sidebar back
// otherwise. Hypixel's objective, scores and teams keep reaching the client
// unchanged; only its sidebar display-slot packets are held back while the
// Fury board is up, so restoring needs a single display packet.
//
// Hypixel's lines are read from a mirror of what the client holds (objective
// titles, scores and team prefixes/suffixes), which only a new world clears.
// The proxy's own scoreboard tracking resets with its game tracking, which can
// happen while a lobby board is still arriving. Team text comes from the
// packets the client actually receives (`observeClientTeam`), so Fury's own
// sidebar rewrites, such as Enhanced scoreboard team colors, are kept.
//
// The 1.8.9 client disconnects on a duplicate objective/team create or on
// removing one it does not have, so every packet is sent from exact state.

const OBJECTIVE = 'fury_lobby';
const TEAM_PREFIX = 'fury_lobby_';
const SIDEBAR_SLOT = 1;

function createLobbySidebar({
    write,
    writeTeam = payload => write('scoreboard_team', payload),
    buildBoard,
    onShow = () => {},
    schedule = callback => setImmediate(callback),
    cancel = handle => clearImmediate(handle)
} = {}) {
    if (typeof write !== 'function' || typeof buildBoard !== 'function') throw new TypeError('write and buildBoard are required');

    const objectiveTitles = new Map();
    const scores = new Map(); // objective -> Map(entry -> score)
    const teamText = new Map(); // team -> { prefix, suffix }
    const entryTeam = new Map(); // entry -> team
    let sidebar = '';
    let shown = null; // { title, rows: [{ prefix, entry, suffix }] } while the Fury board is on the client
    let pending = null;
    let disposed = false;

    function resetMirror() {
        objectiveTitles.clear();
        scores.clear();
        teamText.clear();
        entryTeam.clear();
        sidebar = '';
    }

    function queueRefresh() {
        if (pending || disposed) return;
        pending = schedule(() => { pending = null; refresh(); });
    }

    // Hypixel's visible lines, top first: highest score first, hidden '#'
    // entries skipped and capped at 15, as the 1.8.9 sidebar does.
    function sidebarLines() {
        const entries = [...(scores.get(sidebar) || new Map()).entries()]
            .filter(([entry]) => !String(entry).startsWith('#'))
            .sort((a, b) => b[1] - a[1] || String(b[0]).localeCompare(String(a[0])))
            .slice(0, MAX_ROWS);
        return entries.map(([entry]) => {
            const team = teamText.get(entryTeam.get(entry));
            return team ? team.prefix + entry + team.suffix : entry;
        });
    }

    function writeScores(rows) {
        for (let i = 0; i < rows.length; i++) {
            write('scoreboard_score', { itemName: rows[i].entry, action: 0, scoreName: OBJECTIVE, value: rows.length - i });
        }
    }

    function teamPayload(index, row, mode) {
        return {
            team: `${TEAM_PREFIX}${index}`,
            mode,
            name: `${TEAM_PREFIX}${index}`,
            prefix: row.prefix,
            suffix: row.suffix,
            friendlyFire: 0,
            nameTagVisibility: 'always',
            color: -1,
            ...(mode === 0 ? { players: [row.entry] } : {})
        };
    }

    function show(board) {
        const rows = board.rows.map(splitRow);
        write('scoreboard_objective', { name: OBJECTIVE, action: 0, displayText: board.title, type: 'integer' });
        rows.forEach((row, index) => writeTeam(teamPayload(index, row, 0)));
        writeScores(rows);
        write('scoreboard_display_objective', { position: SIDEBAR_SLOT, name: OBJECTIVE });
        shown = { title: board.title, rows };
        onShow();
    }

    function update(board) {
        const rows = board.rows.map(splitRow);
        if (board.title !== shown.title) {
            write('scoreboard_objective', { name: OBJECTIVE, action: 2, displayText: board.title, type: 'integer' });
        }
        const before = shown.rows;
        for (let i = 0; i < rows.length; i++) {
            if (i >= before.length) writeTeam(teamPayload(i, rows[i], 0));
            else if (rows[i].entry !== before[i].entry) {
                write('scoreboard_score', { itemName: before[i].entry, action: 1, scoreName: OBJECTIVE });
                writeTeam({ team: `${TEAM_PREFIX}${i}`, mode: 1 });
                writeTeam(teamPayload(i, rows[i], 0));
                if (rows.length === before.length) {
                    write('scoreboard_score', { itemName: rows[i].entry, action: 0, scoreName: OBJECTIVE, value: rows.length - i });
                }
            }
            else if (rows[i].prefix !== before[i].prefix || rows[i].suffix !== before[i].suffix) writeTeam(teamPayload(i, rows[i], 2));
        }
        for (let i = rows.length; i < before.length; i++) {
            write('scoreboard_score', { itemName: before[i].entry, action: 1, scoreName: OBJECTIVE });
            writeTeam({ team: `${TEAM_PREFIX}${i}`, mode: 1 });
        }
        // Numbers count down to 1, so existing entries only need new scores
        // when the row count changes. Replaced entries get their score above.
        if (rows.length !== before.length) writeScores(rows);
        shown = { title: board.title, rows };
    }

    function hide() {
        if (!shown) return;
        const restore = sidebar && objectiveTitles.has(sidebar) ? sidebar : '';
        write('scoreboard_display_objective', { position: SIDEBAR_SLOT, name: restore });
        shown.rows.forEach((_, index) => writeTeam({ team: `${TEAM_PREFIX}${index}`, mode: 1 }));
        write('scoreboard_objective', { name: OBJECTIVE, action: 1 });
        shown = null;
    }

    function refresh() {
        if (disposed) return;
        if (pending) { cancel(pending); pending = null; }
        let board = null;
        if (sidebar && objectiveTitles.has(sidebar)) {
            try {
                board = buildBoard({ title: objectiveTitles.get(sidebar), lines: sidebarLines() });
            } catch (_) {
                board = null;
            }
        }
        if (!board || !Array.isArray(board.rows) || !board.rows.length) { hide(); return; }
        const limited = { title: board.title, rows: board.rows.slice(0, MAX_ROWS) };
        if (shown) update(limited);
        else show(limited);
    }

    // Mirrors a server packet. Returns true when the packet must not reach the
    // client: Hypixel's sidebar display packet while the Fury board is up.
    function observeServer(name, data = {}) {
        if (disposed) return false;
        if (name === 'login') {
            // A new world starts with an empty client scoreboard.
            if (pending) { cancel(pending); pending = null; }
            resetMirror();
            shown = null;
            return false;
        }
        if (name === 'scoreboard_objective') {
            const objective = String(data.name || '');
            const action = Number(data.action);
            if (action === 0 || action === 2) objectiveTitles.set(objective, String(data.displayText ?? objective));
            else if (action === 1) { objectiveTitles.delete(objective); scores.delete(objective); }
            if (objective === sidebar) queueRefresh();
            return false;
        }
        if (name === 'scoreboard_display_objective') {
            if (Number(data.position) !== SIDEBAR_SLOT) return false;
            sidebar = String(data.name || '');
            queueRefresh();
            return Boolean(shown);
        }
        if (name === 'scoreboard_score') {
            const objective = String(data.scoreName || '');
            const entry = String(data.itemName || '');
            if (Number(data.action) === 1) {
                // An empty objective name removes the entry from every objective.
                if (objective) scores.get(objective)?.delete(entry);
                else scores.forEach(map => map.delete(entry));
                if (!objective || objective === sidebar) queueRefresh();
            } else {
                if (!scores.has(objective)) scores.set(objective, new Map());
                scores.get(objective).set(entry, Number(data.value) || 0);
                if (objective === sidebar) queueRefresh();
            }
            return false;
        }
        return false;
    }

    // A scoreboard_team packet as sent to the client (forwarded or written by
    // the proxy). Line text lives in team prefixes/suffixes, mirrored the way
    // the client applies it; only teams holding one of the sidebar's lines
    // trigger a refresh (most in-game team packets are nametags).
    function observeClientTeam(data = {}) {
        if (disposed) return;
        const team = String(data.team || '');
        if (team.startsWith(TEAM_PREFIX)) return;
        const mode = Number(data.mode);
        const players = Array.isArray(data.players) ? data.players.map(String) : [];
        const lines = scores.get(sidebar);
        const holdsLine = Boolean(lines && lines.size) && (players.some(player => lines.has(player))
            || [...lines.keys()].some(entry => entryTeam.get(entry) === team));
        if (mode === 0 || mode === 2) teamText.set(team, { prefix: String(data.prefix || ''), suffix: String(data.suffix || '') });
        if (mode === 0 || mode === 3) players.forEach(player => entryTeam.set(player, team));
        if (mode === 4) players.forEach(player => { if (entryTeam.get(player) === team) entryTeam.delete(player); });
        if (mode === 1) {
            teamText.delete(team);
            for (const [entry, owner] of entryTeam) if (owner === team) entryTeam.delete(entry);
        }
        if (holdsLine) queueRefresh();
    }

    function dispose() {
        disposed = true;
        if (pending) { cancel(pending); pending = null; }
    }

    return {
        observeServer,
        observeClientTeam,
        refresh,
        dispose,
        getSidebarLines: () => sidebar ? [objectiveTitles.get(sidebar) || '', ...sidebarLines()] : [],
        isShowing: () => Boolean(shown)
    };
}

module.exports = { createLobbySidebar, OBJECTIVE, TEAM_PREFIX, entryName };
