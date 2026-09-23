'use strict';

// Per-connection scoreboard/team/tab state container, extracted from
// createProxyServer. Boxes the nine map/set fields that represent the
// proxy's view of Hypixel's scoreboard and team registry into one named
// object with a single reset() entry point. The maps are exposed by
// reference so existing proxy.js orchestration keeps working unchanged —
// what we get from this extraction is the boundary and the single reset,
// not encapsulation.
//
// The two scalar fields (sidebarScoreboardObjective, lastScoreboardTitle)
// stay as plain `let`s in proxy.js because reassigning them across module
// boundaries via mutator getter/setter pairs adds indirection without
// payoff.
//
// Heavy team-management logic (synthetic Bedwars teams, default-tab
// reconciliation, nametag teams, scoreboard text parsing) stays in
// proxy.js for now because it depends on packet-write and pregame chat
// helpers that are still inline.

function createScoreboardState() {
    const scoreboardTeamRegistry = new Map();
    const scoreboardTeamAliases = new Map();
    const originalScoreboardTeamsOnClient = new Set();
    const scoreboardObjectiveTitles = new Map();
    const rawScoreboardTeams = new Map();
    const scoreboardEntryTeams = new Map();
    const scoreboardLines = new Map();

    function reset() {
        scoreboardTeamRegistry.clear();
        scoreboardTeamAliases.clear();
        originalScoreboardTeamsOnClient.clear();
        scoreboardObjectiveTitles.clear();
        rawScoreboardTeams.clear();
        scoreboardEntryTeams.clear();
        scoreboardLines.clear();
    }

    return {
        scoreboardTeamRegistry,
        scoreboardTeamAliases,
        originalScoreboardTeamsOnClient,
        scoreboardObjectiveTitles,
        rawScoreboardTeams,
        scoreboardEntryTeams,
        scoreboardLines,
        reset
    };
}

module.exports = { createScoreboardState };
