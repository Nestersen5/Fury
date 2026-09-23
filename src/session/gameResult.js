'use strict';

// Win/loss from what the proxy watched, for games the API delta cannot settle
// (left early, API slow or off, two games in one snapshot window).
//
// Evidence, strongest first:
//   title       — VICTORY!/DEFEAT! banner, or BedWars GAME OVER! (a weak
//                 loss: any VICTORY! for the same game overrides it)
//   elimination — BedWars "TEAM ELIMINATED > <own team>"
//   last_team   — BedWars: every other team on the roster was eliminated
//                 while the own team never was

const RESULT_SOURCES = ['api', 'title', 'elimination', 'last_team'];

function isOwnTeamElimination(event, mode, ownTeam) {
    const normalize = value => String(value || '').toLowerCase().replace(/^grey$/, 'gray');
    return mode === 'BEDWARS' && Boolean(ownTeam)
        && event?.type === 'team_eliminated'
        && normalize(event.targetTeam) === normalize(ownTeam);
}

function sameTeam(a, b) {
    return Boolean(a && b) && String(a).toLowerCase() === String(b).toLowerCase();
}

function titleResult(events) {
    const victory = events.some(event => event.type === 'victory');
    const defeat = events.some(event => event.type === 'defeat' && event.cause !== 'game_over');
    if (victory && defeat) return null;
    if (victory) return 'win';
    if (defeat || events.some(event => event.type === 'defeat')) return 'loss';
    return null;
}

function inferGameResult({ mode = null, events = [], ownTeam = null, roster = [] } = {}) {
    const list = Array.isArray(events) ? events.filter(Boolean) : [];
    const fromTitle = titleResult(list);
    if (fromTitle) return { result: fromTitle, source: 'title' };
    if (mode !== 'BEDWARS' || !ownTeam) return null;

    const eliminated = list
        .filter(event => event.type === 'team_eliminated' && event.targetTeam)
        .map(event => String(event.targetTeam).toLowerCase());
    if (eliminated.includes(String(ownTeam).toLowerCase())) return { result: 'loss', source: 'elimination' };

    const opponentTeams = new Set((Array.isArray(roster) ? roster : [])
        .map(player => player?.team)
        .filter(team => team && !sameTeam(team, ownTeam))
        .map(team => String(team).toLowerCase()));
    if (opponentTeams.size && [...opponentTeams].every(team => eliminated.includes(team))) {
        return { result: 'win', source: 'last_team' };
    }
    return null;
}

// The API delta is authoritative; watched evidence only fills its gaps.
function resolveGameResult(apiResult, context = {}) {
    if (apiResult === 'win' || apiResult === 'loss') return { result: apiResult, source: 'api' };
    return inferGameResult({
        mode: context.mode,
        events: context.events,
        ownTeam: context.metadata?.team || null,
        roster: context.roster
    }) || { result: null, source: null };
}

module.exports = { inferGameResult, resolveGameResult, isOwnTeamElimination, RESULT_SOURCES };
