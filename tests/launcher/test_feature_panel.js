'use strict';

const assert = require('assert');
const { FEATURE_PANEL_COLORS, createFeatureStatus } = require('../../features/feature_panel.js');

function walk(value, visitor) {
    if (Array.isArray(value)) return value.forEach(item => walk(item, visitor));
    if (!value || typeof value !== 'object') return;
    visitor(value);
    Object.values(value).forEach(item => walk(item, visitor));
}

const messages = [];
const panel = createFeatureStatus({
    sendLine: message => messages.push(message),
    title: 'Example',
    subtitle: 'TEST',
    section: 'safety',
    helpTopic: 'dodge'
});
panel.open();
panel.section('Overview');
panel.toggleRow('Power', true, '/example on', '/example off', 'Example feature.');
panel.valueRow('Value', '42', { command: '/example value ', action: 'suggest_command' });
panel.adjustRow('Limit', '5', {
    downCommand: '/example limit 4',
    editCommand: '/example limit ',
    upCommand: '/example limit 6'
});
panel.close();

let text = '';
const components = [];
walk(messages, item => {
    if (typeof item.text === 'string') text += item.text;
    if (item.clickEvent) components.push(item);
});

assert.strictEqual(FEATURE_PANEL_COLORS.border, 'dark_gray');
assert.strictEqual(FEATURE_PANEL_COLORS.heading, 'light_purple');
assert.strictEqual(FEATURE_PANEL_COLORS.action, 'aqua');
assert.strictEqual(FEATURE_PANEL_COLORS.value, 'white');
assert(text.startsWith('FURY \u00bb Example'));
assert(!messages.some(message => (message.extra || []).some(part => /^\+[-]+\+$/.test(part.text) || part.text === '| ')));
assert(text.includes('Power: ON') && text.includes('Value: 42') && text.includes('Limit: 5'));
assert.strictEqual(components.length, 0, 'Status output must contain no interactive controls');
assert(!text.includes('OVERVIEW') && !text.includes('[edit]'), 'No panel sections or edit widgets remain');
console.log('Read-only feature status tests passed.');
