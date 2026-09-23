'use strict';
const REPOSITORY_ROOT = require('path').resolve(__dirname, '../..');
// Replay /scan must stay separate from the live /scan: its own fixed settings,
// no party sharing, and nothing written that the live scan, /share or the
// overlay read. Also covers the replay presence signals it depends on.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const proxy = fs.readFileSync(path.join(REPOSITORY_ROOT, 'proxy.js'), 'utf8').replace(/\r\n/g, '\n');

function block(start, end) {
    const from = proxy.indexOf(start);
    assert.notStrictEqual(from, -1, `missing ${start}`);
    const to = proxy.indexOf(end, from + start.length);
    assert.notStrictEqual(to, -1, `missing end of ${start}`);
    return proxy.slice(from, to);
}

// A second runner with its own state object - /scanmode and /scanconfig
// mutate the global `state`, which this one never sees.
const runner = block('({ performFullScan: performReplayScan } = createScanRunner({', '}));');
assert(/state: \{\s*scanMode: 'all',/.test(runner), 'replay scan always lists every player');
assert(/threatConfig: \{ minFkdr: 3\.0, minStars: 1000,/.test(runner), 'replay scan uses fixed default thresholds');
assert(!/\n\s+state,\n/.test(runner), 'replay scan must not share the global state object');
assert(runner.includes('setLastScanSummary: () => {}'), 'replay scan must not overwrite the live scan summary');
assert(runner.includes('setLastScanResults: () => {}'), 'replay scan must not feed /share');
assert(runner.includes('trackTags: () => {}'), 'replay scan must not write the tag log');

const run = block('async function runReplayScan()', '\n        }\n');
assert(run.includes('shareStream: null'), 'replay scan never broadcasts to party');
assert(!run.includes('state.shareTagsAuto'), 'auto-share setting must not apply to replays');
assert(!run.includes('rememberOverlayPlayer'), 'replay scan must not add launcher overlay rows');
assert(!run.includes('rememberActiveCosmetics'), 'replay scan must not record cosmetics');
assert(run.includes('markNickedPlayer: (name') && run.includes('localNicks'), 'nicks found in a replay stay local to that scan');
assert(!run.includes('scanInProgress = true') || run.includes('replayScanInProgress = true'), 'uses its own in-progress flag');
assert(!/[^.]scanInProgress\b/.test(run.replace(/replayScanInProgress/g, '')), 'must not touch the live scan in-progress flag');

// /scan routes to the replay scan only while watching one.
assert(/else if \(cmd === '\/scan'\) \{\s*if \(inReplayViewer\) await runReplayScan\(\);\s*else if \(duelsState\.active\) await runDuelsScan\(\);\s*else await runScanForCurrentGame\(\);/.test(proxy),
    '/scan must route to the replay scan while in a replay, otherwise unchanged');

// Presence: the REPLAY sidebar is checked on every sidebar change, and
// losing it leaves at once.
assert.strictEqual((proxy.match(/syncReplaySidebar\(\);/g) || []).length, 2, 'sidebar objective + display changes both resync replay presence');
const sync = block('function syncReplaySidebar()', '\n        }\n');
assert(/else if \(inReplayViewer && replaySidebarSeen\) \{\s*setReplayViewer\(false\);/.test(sync), 'losing the REPLAY sidebar leaves immediately');
assert(/if \(!isReplaySidebar\(\)\) setReplayViewer\(false\);/.test(proxy), 'the action-bar timeout never ends a replay whose sidebar still says REPLAY');

// /who: answered by the proxy only in a replay (Hypixel has none there);
// everywhere else it must still reach Hypixel.
assert(/else if \(cmd === '\/who' && inReplayViewer\) \{\s*handleReplayWho\(\);\s*\}\s*else \{\s*void sendHypixelCommand\(msg, \{ priority: 20 \}\);/.test(proxy),
    '/who is handled locally only in replays and otherwise forwarded to Hypixel');
assert.strictEqual((proxy.match(/cmd === '\/who'/g) || []).length, 1, 'no other /who handler may swallow the command');
const who = block('function handleReplayWho()', '\n        }\n');
assert(who.includes('§bONLINE: ') && who.includes(".join('§7, ')"), '/who matches Hypixel\'s "ONLINE: a, b" layout');
assert(block('function replayWhoNameColor(name)', '\n        }\n').includes("|| '§7'"), 'players with no known rank are grey');
const players = block('function replayPlayers(variant = null)', '\n            return players;\n');
assert(players.includes("|| `${team?.prefix || ''}${rawName}${team?.suffix || ''}`"), 'names cut at 16 characters are rebuilt from the team prefix + suffix, as drawn');
assert(players.includes('if (perColor.get(player.color) > teamSize) player.team = null;'), 'a colour shared by more players than a team holds is not a team');
assert(proxy.includes('const players = replayPlayers(info.variant);') && proxy.includes('replayPlayers(readReplaySidebarInfo().variant)'), 'both /scan and /who pass the replay mode for the team size');
assert(players.includes('/^\\[viewer\\]/i.test(visible)'), 'the "[Viewer]" row (you watching) is not a player');
assert(players.includes('(shownColor && REPLAY_TEAM_BY_COLOR[shownColor]) || null'), 'a row without a colour gets no guessed team');
assert(block('function replayPlayerNames()', '\n        }\n').includes('replayPlayers('), '/who lists the replay tab players');
assert(proxy.includes('const roster = new Set(players.map(player => player.name));'), 'replay /scan lists the same players as /who');
assert(proxy.includes('await performReplayScan(client, replayLobby, localNicks, null, {'), 'replay /scan uses its own player map, not the live one');
assert(/isOwnPlayer: \(\) => false,\s*getCachedPlayerProfile/.test(run), 'your own row is scanned when you played in that game');
assert(/partyArrivalTracker\.observePlayerInfo\(data, action\);\s*observeReplayTabEntries\(data, action\);\s*const filteredPlayerInfo/.test(proxy), 'the tab copy sees every entry before any filtering');
assert(/if \(meta\.name === 'login' \|\| meta\.name === 'respawn'\) \{\s*replayTabEntries\.clear\(\);/.test(proxy), 'the tab copy starts afresh on each world change');

// Clips are listed once on entering a replay, and only when there are any.
const announce = block('function announceReplayClips(attempt = 0)', '\n        }\n');
assert(announce.includes('if (!clips.length) return;'), 'nothing is printed for a replay without clips');
assert(announce.includes('findReplayClips(clipStore.listGames(), info)'), 'clips are matched by the replay sidebar server and start time');
assert(/stopReplayClipAnnouncement\(\);\s*if \(active\) replayClipsTimer = setTimeout/.test(proxy), 'the listing starts on entering and is cancelled on leaving');

console.log('Replay scan static tests passed.');
