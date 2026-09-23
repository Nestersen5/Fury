const REPOSITORY_ROOT = require('path').resolve(__dirname, '../..');
// Static checks for the last-match snapshot guard.
//
// The logic lives inside proxy.js's per-connection closure and cannot be
// required in isolation, so — as with test_api_pacing_static.js — these pin the
// shape of the code that a regression would have to undo.
//
// The bug being pinned: restoring the PREVIOUS game's snapshot over a new game,
// which repaints the wrong team colour in tab. Mode + a 20-minute TTL cannot
// tell "the game I dropped out of" from "another game of the same type", so the
// snapshot carries Hypixel's server id. The first attempt at that read the id
// while SAVING — but the save that matters happens on match reset, when the
// sidebar has usually already flipped to the lobby and there is no id left to
// read, so every snapshot was stamped null and the guard never engaged.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const proxy = fs.readFileSync(path.join(REPOSITORY_ROOT, 'proxy.js'), 'utf8');

function expect(pattern, message) {
    assert(pattern.test(proxy), message);
}

// The id is captured while the game is running...
expect(
    /function noteActiveMatchServerId\(scoreboardText = ''\) \{[\s\S]*?if \(!gameActive \|\| !isSupportedTabStatsMode\(currentGamemode\)\) return;[\s\S]*?const serverId = pregameLobbyIdForScoreboard\(scoreboardText\);[\s\S]*?if \(serverId\) activeMatchServerId = serverId;[\s\S]*?\}/,
    'The match server id must be captured from the sidebar only while a supported game is active.'
);

// ...on every scoreboard update...
expect(
    /function updateDetectedStateFromScoreboard\(extraText = ''\) \{[\s\S]*?noteActiveMatchServerId\(scoreboardText\);/,
    'Every scoreboard update should refresh the active match server id.'
);

// ...and the stored value is what stamps the snapshot. Reading the sidebar here
// is the fallback, never the primary source.
expect(
    /serverId: activeMatchServerId \|\| pregameLobbyIdForScoreboard\(getCurrentScoreboardText\(\)\) \|\| null,/,
    'Snapshots must be stamped from the id captured during the game, not read at save time.'
);

// A finished game's id must not survive into the next one.
expect(
    /gameActive = true;[\s\S]*?presentAtGameStart = true;[\s\S]*?activeMatchServerId = pregameLobbyIdForScoreboard\(getCurrentScoreboardText\(\)\) \|\| null;/,
    'Starting a game should re-stamp the server id rather than inherit the previous one.'
);
expect(
    /gameActive = false;[\s\S]*?presentAtGameStart = false;[\s\S]*?gameStartTime = null;[\s\S]*?activeMatchServerId = null;/,
    'Ending a game should release the captured server id.'
);

// The guard itself still has to reject on a genuine mismatch.
expect(
    /const liveServerId = pregameLobbyIdForScoreboard\(getCurrentScoreboardText\(\)\);[\s\S]*?if \(liveServerId && lastMatchSnapshot\.serverId && liveServerId !== lastMatchSnapshot\.serverId\) \{[\s\S]*?return null;/,
    'A snapshot whose server id disagrees with the live one must be rejected.'
);

// Second opinion for when neither side learned an id: the teams Hypixel already
// sent us on this connection describe the game actually in front of us.
expect(
    /if \(snapshotContradictsLiveTeams\(lastMatchSnapshot\)\) return null;/,
    'getFreshLastMatchSnapshot should also reject a snapshot that contradicts the live teams.'
);
expect(
    /function snapshotContradictsLiveTeams\(snapshot\) \{[\s\S]*?if \(scoreboardTeamRegistry\.size === 0\) return false;[\s\S]*?const live = findScoreboardTeamForPlayer\(playerName\);[\s\S]*?if \(!live\) return;[\s\S]*?return disagree > agree;[\s\S]*?\}/,
    'Team disagreement should compare only players both sides place, and take a majority to reject.'
);

// Bed Wars exposes the map only in pregame. It must stay scoped to that lobby,
// survive the pregame -> game transition, and remain in reconnect snapshots.
expect(
    /function leaveBedwarsPregame\(options = \{\}\) \{[\s\S]*?bedwarsPregameActive = false;[\s\S]*?bedwarsPregameLobbyId = null;[\s\S]*?bedwarsPregameMap = null;/,
    'Leaving or abandoning a Bed Wars pregame must clear its map.'
);
expect(
    /function enterBedwarsPregame\(lobbyId = null\) \{[\s\S]*?bedwarsPregameMap = null;[\s\S]*?bedwarsPregameActive = true;[\s\S]*?bedwarsPregameLobbyId = lobbyId \|\| null;/,
    'Entering a pregame must begin with no map inherited from another lobby.'
);
expect(
    /function updateBedwarsPregameStateFromScoreboard\(scoreboardText = ''\) \{[\s\S]*?const map = parseBedwarsPregameMap\(\[[\s\S]*?getCurrentScoreboardTitle\(\),[\s\S]*?\.\.\.getScoreboardLineList\(\)[\s\S]*?\]\);[\s\S]*?reason: 'pregame_server_change'[\s\S]*?enterBedwarsPregame\(lobbyId\);[\s\S]*?if \(map\) bedwarsPregameMap = map;/,
    'The new lobby must replace the old lobby state before its parsed map is stored.'
);
expect(
    /function activateGame\(mode,[\s\S]*?const pregameMap = mode === 'BEDWARS' && bedwarsPregameActive[\s\S]*?leaveBedwarsPregame\([\s\S]*?startSessionGameEventCapture\(mode, \{ map: pregameMap \}\);/,
    'Game activation must capture the pregame map before clearing lobby state and hand it to session tracking.'
);
expect(
    /sessionGameMetadata: activeSessionGameMetadata \? \{ \.\.\.activeSessionGameMetadata \} : null,[\s\S]*?activeSessionGameMetadata = \{[\s\S]*?\.\.\.\(snapshot\.sessionGameMetadata \|\| \{\}\),/,
    'Reconnect snapshots must preserve session game metadata, including the map.'
);

// /denick add completion needs an append-only identity list for the active
// game. gameRoster is intentionally mutable and loses eliminated players.
expect(
    /let currentGamePlayerNames = new Map\(\);[\s\S]*?function rememberCurrentGamePlayerName\(name\) \{[\s\S]*?currentGamePlayerNames\.set\(key, name\);[\s\S]*?knownRealName[\s\S]*?currentGamePlayerNames\.set\(nickKey\(knownRealName\), knownRealName\);/,
    'The active game must retain observed nicknames and their resolved real IGNs independently of gameRoster.'
);
expect(
    /gamePlayerNames: Array\.from\(currentGamePlayerNames\.values\(\)\),[\s\S]*?currentGamePlayerNames = new Map\([\s\S]*?snapshot\.gamePlayerNames \|\| snapshot\.gameRoster/,
    'Reconnect snapshots must preserve the active game tab-completion identity memory.'
);
expect(
    /function activateGame\(mode,[\s\S]*?if \(!gameActive\) \{[\s\S]*?currentGamePlayerNames\.clear\(\);[\s\S]*?gameActive = true;[\s\S]*?function resetMatchState[\s\S]*?gameRoster\.clear\(\);[\s\S]*?currentGamePlayerNames\.clear\(\);/,
    'Game identity memory must start empty for each game and clear at match end.'
);
expect(
    /knownPlayerNames: \(\) => \{[\s\S]*?currentGamePlayerNames\.values\(\)/,
    'Proxy player tab completion must include the append-only active-game identity memory.'
);
assert.strictEqual(
    (proxy.match(/gameRoster\.add\([^)]+\);\s*rememberCurrentGamePlayerName\([^)]+\);/g) || []).length,
    3,
    'Every live gameRoster insertion path must also retain the player for game-scoped tab completion.'
);
expect(
    /function storeDenickResult\(name, realName,[\s\S]*?autoDenickResults\.set[\s\S]*?rememberCurrentGameDenickNames\(name, realName\);/,
    'Skin/manual/party denick results must retain both sides of the mapping for completion.'
);
expect(
    /autoDenickResults\.set\(key, result\);\s*rememberCurrentGameDenickNames\(observed\.name, result\.realName\);/,
    'Stat denick results must retain both sides of the mapping for completion.'
);
expect(
    /rememberKnownDenickInSession: \(name, realName, source\) => \{[\s\S]*?rememberCurrentGameDenickNames\(name, realName\);[\s\S]*?isCurrentGamePlayer: \(name\) => gameActive && currentGamePlayerNames\.has\(nickKey\(name\)\)/,
    'Manual mappings must still apply after a player leaves the mutable gameRoster.'
);

console.log('test_match_snapshot_static.js: all assertions passed');
