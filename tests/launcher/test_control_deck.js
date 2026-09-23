'use strict';

// Tests for the experimental Fury Deck control panel (/deck).

const assert = require('assert');
const { createControlDeck, TABS } = require('../../src/overlay/controlDeck.js');

function flatten(componentRoot, out = []) {
    if (!componentRoot || typeof componentRoot !== 'object') return out;
    out.push(componentRoot);
    (componentRoot.extra || []).forEach(part => flatten(part, out));
    return out;
}

function harness(registryOverrides = {}) {
    const lines = [];
    const dispatched = [];
    const timers = [];
    const state = {
        dodge: false,
        tabstats: true
    };
    const registry = {
        session: () => ({ game: 'BEDWARS', inGame: true, overlayMode: 'threats' }),
        modules: () => [
            {
                key: 'dodge', tab: 'guard', label: 'Auto Dodge', short: 'dodge',
                doc: ['Dodges bad lobbies.'],
                isOn: () => state.dodge,
                hint: () => (state.dodge ? '3s delay' : ''),
                onCommand: '/dodge on', offCommand: '/dodge off', openCommand: '/dodge'
            },
            {
                key: 'tabstats', tab: 'intel', label: 'Tab Stats', short: 'tab',
                doc: ['Stats in the tab list.'],
                isOn: () => state.tabstats,
                onCommand: '/tabstats on', offCommand: '/tabstats off', openCommand: '/tabstats',
                extraCommands: ['/tabstats fields bedwars', '/tabstats fields skywars']
            }
        ],
        chipGroups: [
            {
                tab: 'intel', label: 'tab stat fields',
                chips: () => [
                    { label: 'bedwars', on: true, command: '/tabstats fields bedwars', doc: 'BedWars fields.' }
                ]
            }
        ],
        actions: [
            { label: 'scan now', command: '/scan', doc: 'Scan the game.' }
        ],
        presets: [
            { key: 'tryhard', label: 'tryhard', doc: 'All on.', commands: ['/dodge on', '/tabstats on'] }
        ],
        lookups: [
            { group: 'player cards', label: 'stats', command: '/stats ', suggest: true, doc: 'BedWars card.' },
            { group: 'me', label: 'my stats', command: '/stats Tester', doc: 'Own card.' }
        ],
        ...registryOverrides
    };
    const deck = createControlDeck({
        send: (lineRoot) => lines.push(lineRoot),
        runCommand: (commandText) => {
            dispatched.push(commandText);
            if (commandText === '/dodge on') state.dodge = true;
            if (commandText === '/dodge off') state.dodge = false;
        },
        registry,
        setTimer: (fn, ms) => { timers.push({ fn, ms }); }
    });
    const flushTimers = () => {
        while (timers.length > 0) timers.shift().fn();
    };
    const allText = () => lines
        .flatMap(lineRoot => flatten(lineRoot))
        .map(part => part.text || '')
        .join('');
    const allParts = () => lines.flatMap(lineRoot => flatten(lineRoot));
    return { deck, lines, dispatched, timers, flushTimers, allText, allParts, state };
}

// Menu commands only point to the launcher; explicit actions still work.
{
    const h = harness();
    for (const tab of TABS) h.deck.handle(['/deck', tab.key]);
    assert(h.allText().includes('launcher'));
    assert(!h.allParts().some(part => part.clickEvent));
    h.deck.handle(['/deck', 'run', '/dodge', 'on']);
    h.flushTimers();
    assert.deepStrictEqual(h.dispatched, ['/dodge on']);
    assert(!h.allParts().some(part => part.clickEvent));
}

// --- The allowlist blocks anything the deck did not render ---
{
    const h = harness();
    h.deck.handle(['/deck']);
    h.deck.handle(['/deck', 'run', '/pc', 'hello', 'everyone']);
    assert.strictEqual(h.dispatched.length, 0, 'non-allowlisted commands must never dispatch');
    assert(h.allText().includes('unknown action'), 'blocked actions must say so');

    h.deck.handle(['/deck', 'run', 'dodge', 'on']);
    assert.strictEqual(h.dispatched.length, 0, 'commands must start with a slash');

    h.deck.handle(['/deck', 'run', '/tabstats', 'fields', 'bedwars']);
    assert.deepStrictEqual(h.dispatched, ['/tabstats fields bedwars'], 'extraCommands must be allowlisted');
}

// --- Presets sequence their commands and refresh once at the end ---
{
    const h = harness();
    h.deck.handle(['/deck', 'preset', 'tryhard']);
    assert.strictEqual(h.timers.length, 3, 'two command steps plus one refresh');
    h.flushTimers();
    assert.deepStrictEqual(h.dispatched, ['/dodge on', '/tabstats on']);
    assert(h.state.dodge === true, 'preset must actually apply');

    h.dispatched.length = 0;
    h.deck.handle(['/deck', 'preset', 'nope']);
    assert.strictEqual(h.dispatched.length, 0);
    assert(h.allText().includes('unknown preset'));
}

{
    const h = harness();
    h.deck.handle(['/deck', 'run', '/stats', 'Tester']);
    assert(h.dispatched.includes('/stats Tester'));
    h.deck.handle(['/deck', 'about']);
    h.deck.handle(['/deck', 'bogus']);
    assert(h.allText().includes('launcher'));
}

// --- Empty registry renders without throwing ---
{
    const deck = createControlDeck({ send: () => {}, runCommand: () => {}, registry: {} });
    deck.handle(['/deck']);
    deck.handle(['/deck', 'guard']);
    deck.handle(['/deck', 'lookup']);
    deck.handle(['/deck', 'about']);
}

console.log('Control deck tests passed.');
