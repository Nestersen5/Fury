'use strict';

const TEAM_DEFS = [
    { name: 'Red', aliases: ['red'], color: '§c', letter: 'R' },
    { name: 'Blue', aliases: ['blue'], color: '§9', letter: 'B' },
    { name: 'Green', aliases: ['green'], color: '§a', letter: 'G' },
    { name: 'Yellow', aliases: ['yellow'], color: '§e', letter: 'Y' },
    { name: 'Aqua', aliases: ['aqua', 'cyan'], color: '§b', letter: 'A' },
    { name: 'White', aliases: ['white'], color: '§f', letter: 'W' },
    { name: 'Pink', aliases: ['pink'], color: '§d', letter: 'P' },
    { name: 'Gray', aliases: ['gray', 'grey'], color: '§8', letter: 'G' }
];
const plain = value => String(value || '').replace(/§[0-9a-fk-or]/gi, '').trim();

function teamFromId(value) {
    const id = plain(value).toLowerCase();
    return TEAM_DEFS.find(team => team.aliases.some(alias => new RegExp(`^${alias}\\d*$`).test(id))) || null;
}

function teamFromPrefix(prefix) {
    const text = plain(prefix);
    // Only explicit markers qualify. Rank colors, gray invisibility updates,
    // sidebar timers and player names are not team evidence.
    const fullName = TEAM_DEFS.find(team => team.aliases.includes(text.toLowerCase()));
    if (fullName) return fullName;
    const marker = text.match(/^(?:\[([A-Z])\]|([A-Z]))$/i);
    if (!marker) return null;
    const letter = (marker[1] || marker[2]).toUpperCase();
    const candidates = TEAM_DEFS.filter(team => team.letter === letter || (letter === 'S' && team.name === 'Gray'));
    if (candidates.length === 1) return candidates[0];
    // The marker's color wins over a trailing reset used for the player name.
    const leading = String(prefix).match(/^(?:\s|§[0-9a-fk-or])*/i)?.[0] || '';
    const colors = leading.match(/§[0-9a-f]/gi) || String(prefix).match(/§[0-9a-f]/gi) || [];
    const color = colors.at(-1)?.toLowerCase();
    return candidates.find(team => team.color === color) || null;
}

function resolveTeamEvidence(rawName, prefix, previous = null) {
    const explicit = teamFromPrefix(prefix);
    if (explicit) return { name: explicit.name, source: 'prefix' };
    // Evidence belongs to one raw team instance. Callers discard it on
    // delete/recreate and world reset, but retain it through mode-2 updates.
    if (previous?.source === 'prefix' && TEAM_DEFS.some(team => team.name === previous.name)) return previous;
    const named = teamFromId(rawName);
    return named ? { name: named.name, source: 'id' } : null;
}

module.exports = { TEAM_DEFS, teamFromId, teamFromPrefix, resolveTeamEvidence };
