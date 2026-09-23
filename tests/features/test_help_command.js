const assert = require('assert');
const {
    HELP_SECTIONS,
    createHelpRow,
    handleHelpCommand,
    getStartupCommandSummary
} = require('../../features/help_command.js');

assert(HELP_SECTIONS.some(section => section.title === 'Stats & Sessions'), 'Help should include the current stats and sessions section');
assert(HELP_SECTIONS.some(section => section.entries.some(entry => entry.label === '/tabstats')), 'Help should include /tabstats');
assert(HELP_SECTIONS.some(section => section.entries.some(entry => entry.label === '/autogambler')), 'Help should include /autogambler');
assert(HELP_SECTIONS.some(section => section.entries.some(entry => entry.label === '/apikill')), 'Help should include /apikill');
assert(HELP_SECTIONS.some(section => section.entries.some(entry => entry.label === '/po' && entry.variations.includes('/po test'))), 'Help should document the Party Overview preview command');
assert(HELP_SECTIONS.some(section => section.entries.some(entry => entry.label === '/fury'
    && entry.variations.includes('/fury help')
    && entry.variations.includes('/fury history'))), 'Help should document Fury pages and the focused guide');
assert(!HELP_SECTIONS.some(section => section.entries.some(entry => String(entry.label).includes('/cosmetics'))), 'Help should not show hidden cosmetic commands');
assert(!HELP_SECTIONS.some(section => section.entries.some(entry => String(entry.label).includes('/woodskin'))), 'Help should not show hidden woodskin commands');
assert(!HELP_SECTIONS.some(section => section.entries.some(entry => String(entry.label).includes('/partydodge'))), 'Help should not advertise the unfinished party dodge controls');
const startupSummary = getStartupCommandSummary();
assert(startupSummary.includes('/help - Full in-game command guide'), 'Startup summary should direct players to the in-game command guide');
assert(startupSummary.includes('/reminder - Slumber reminders'), 'Startup summary should stay in sync with the Slumber reminder commands');
assert(startupSummary.includes('/denick - Nick mappings and party denick'), 'Startup summary should stay in sync with denick support');

const row = createHelpRow({
    label: '/stats',
    command: '/stats ',
    description: 'BedWars card with mode click-through.',
    variations: ['/stats <player>']
});
assert.strictEqual(row.extra[0].clickEvent.action, 'suggest_command');
assert.strictEqual(row.extra[0].clickEvent.value, '/stats ');
assert(row.extra[0].hoverEvent.value.includes('/stats <player>'), 'Help hover should include variations');

const sent = [];
handleHelpCommand({}, (client, message) => sent.push(message));
const visible = message => typeof message === 'string' ? message : (message.text || '') + (message.extra || []).map(visible).join('');
assert(sent.some(message => visible(message).includes('FURY \u00bb Help')), 'Rendered help should include the Fury title');
assert(sent.length <= 10, 'Default help should fit a short chat page');
const allParts = messages => messages.flatMap(message => message.extra || []);
assert(allParts(sent).some(part => part.clickEvent?.value === '/help stats 2'), 'Next page should work');
assert(!allParts(sent).some(part => part.clickEvent?.value === '/help stats 0'), 'First page has no previous action');
const firstRows = allParts(sent).filter(part => part.clickEvent?.action === 'suggest_command').map(part => part.clickEvent.value);
const next = [];
handleHelpCommand({}, (_client, message) => next.push(message), ['stats', '2']);
assert(allParts(next).some(part => part.clickEvent?.value === '/reminder status'), 'Remaining commands must be reachable');
assert(!allParts(next).some(part => part.clickEvent?.action === 'suggest_command' && firstRows.includes(part.clickEvent.value)), 'Pages must not repeat commands');
const clamped = [];
handleHelpCommand({}, (_client, message) => clamped.push(message), ['stats', '999']);
assert.deepStrictEqual(clamped, next, 'Out-of-range page should clamp to last page');
sent.length = 0;
handleHelpCommand({}, (_client, message) => sent.push(message), ['all']);
assert(sent.some(message => typeof message === 'object' && message.extra?.[0]?.clickEvent?.value === '/tabstats '), 'Rendered help should include clickable /tabstats row');
assert(sent.some(message => typeof message === 'object' && message.extra?.[0]?.clickEvent?.value === '/apikey '), 'Rendered help should include clickable /apikey row');
assert(sent.some(message => typeof message === 'object' && message.extra?.[0]?.clickEvent?.value === '/apikill '), 'Rendered help should include clickable /apikill row');
for (const section of HELP_SECTIONS) {
    for (const entry of section.entries) {
        assert(allParts(sent).some(part => part.clickEvent?.action === 'suggest_command' && part.clickEvent.value === entry.command), `${entry.command} should remain accessible`);
    }
}

console.log('Help command tests passed.');
