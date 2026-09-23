'use strict';

const assert = require('assert');
const {
    FURY_PAGES,
    FURY_HELP_TOPICS,
    normalizeFuryPage,
    createFuryMenu
} = require('../../features/fury_menu.js');

function walk(value, visitor) {
    if (Array.isArray(value)) {
        value.forEach(item => walk(item, visitor));
        return;
    }
    if (!value || typeof value !== 'object') return;
    visitor(value);
    Object.values(value).forEach(item => walk(item, visitor));
}

function render(page, options = {}) {
    const messages = [];
    const menu = createFuryMenu({ sendChat: (client, message) => messages.push(message) });
    menu.render({}, page, {
        context: 'BEDWARS',
        gameActive: true,
        scanMode: 'threats',
        scanFreshness: '4s ago',
        tabStatsEnabled: true,
        nametagOverlayEnabled: true,
        eventLabelsEnabled: true,
        teamColorsEnabled: true,
        accentHex: '#a66bea',
        autoDodgeEnabled: true,
        partySplitWarningsEnabled: true,
        autoSkinDenickEnabled: true,
        autoStatsDenickEnabled: true,
        partyOverviewEnabled: true,
        dodgeDelaySeconds: 10,
        dodgeMinFkdr: 3,
        dodgeMinStars: 700,
        shareAuto: false,
        chatStatsEnabled: true,
        socialAddsEnabled: true,
        overlayMentionAddsEnabled: true,
        overlayDmAddsEnabled: false,
        overlayPartyAddsEnabled: true,
        pregameAddsEnabled: true,
        sessionTrackingEnabled: true,
        gameRecapEnabled: true,
        sessionBoundaryMinutes: 180,
        sessionRetention: 100,
        sessionRecapStyle: 'detailed',
        goalWins: 10,
        goalFinals: 50,
        goalGames: 5,
        goalMinutes: 60,
        dustReminderEnabled: true,
        dustThreshold: 250,
        dailyReminderEnabled: true,
        proxyHealthEnabled: true,
        apiKillSwitchEnabled: false,
        autoGamblerEnabled: false,
        configuredApiKeys: 3
    }, options);

    let text = '';
    const commands = [];
    walk(messages, (item) => {
        if (typeof item.text === 'string') text += item.text;
        if (item.clickEvent?.value) commands.push(item.clickEvent.value);
    });
    return { messages, text, commands };
}

assert.strictEqual(normalizeFuryPage('guard'), 'safety');
assert.strictEqual(normalizeFuryPage('sessions'), 'history');
assert.strictEqual(normalizeFuryPage('does-not-exist', ''), '');
assert.deepStrictEqual(FURY_PAGES.map(page => page.key), ['home', 'play', 'safety', 'social', 'history', 'system', 'help']);
assert.deepStrictEqual(
    Object.entries(FURY_HELP_TOPICS).filter(([, topic]) => !topic.hidden).map(([key]) => key),
    ['play', 'safety', 'social', 'history', 'system', 'settings']
);
['tabstats', 'nametags', 'overlay', 'share', 'dodge', 'partyoverview', 'denick', 'chatstats', 'reminders', 'proxyhealth', 'vanilla', 'autogambler', 'tag']
    .forEach(topic => assert(FURY_HELP_TOPICS[topic]?.hidden, `${topic} should have a focused feature guide`));

for (const page of FURY_PAGES) {
    const messages = [];
    createFuryMenu({ sendChat: (_client, message) => messages.push(message) }).render({}, page.key);
    assert(messages.some(message => message.includes('launcher')));
    assert(messages.every(message => typeof message === 'string'), 'Removed menus cannot contain clickable controls');
}
const commands = [];
createFuryMenu({ sendChat: (_client, message) => commands.push(message) }).renderHelp({}, 'dodge');
assert(commands.some(message => message.includes('/dodge on')), 'Direct command examples stay available');
assert(commands.every(message => typeof message === 'string'));
console.log('Fury menu removal and command guide tests passed.');
