'use strict';

const chatController = require('./chat_controller.js');

const FEATURE_PANEL_COLORS = Object.freeze({
    border: 'dark_gray',
    heading: 'light_purple',
    action: 'aqua',
    value: 'white',
    active: 'green',
    muted: 'gray',
    quiet: 'dark_gray',
    label: 'white'
});

const FEATURE_PANEL_SECTIONS = Object.freeze({
    play: 'Play',
    safety: 'Safety',
    social: 'Social',
    history: 'History',
    system: 'System'
});

// Read-only command output. Settings controls live exclusively in the launcher.
// Keep the small rendering API so command handlers retain their status values.
function createFeatureStatus(options = {}) {
    const { client, sendChat, sendLine, title = 'Feature' } = options;
    const send = typeof sendLine === 'function' ? sendLine : message => sendChat(client, message);
    if (typeof sendLine !== 'function' && typeof sendChat !== 'function') {
        throw new Error('createFeatureStatus requires sendChat or sendLine');
    }
    const labels = new WeakSet();
    const colors = FEATURE_PANEL_COLORS;
    const clean = part => ({
        text: String(part.text || ''), color: part.color || 'gray',
        ...(part.bold ? { bold: true } : {}),
        ...(part.extra ? { extra: part.extra.map(clean) } : {})
    });
    const row = (parts = []) => {
        const items = parts.flat().filter(Boolean);
        if (!items.some(part => !labels.has(part) && String(part.text || '').trim())) return;
        send(chatController.line(items.map(clean)));
    };
    const label = value => {
        const part = chatController.text(`${value}: `, 'gray');
        labels.add(part);
        return part;
    };
    const valueRow = (name, value, settings = {}) => row([
        label(name), chatController.text(String(value), settings.color || 'white')
    ]);
    const status = {
        colors, row, label,
        open() {
            send(chatController.line([
                chatController.text('FURY \u00bb ', 'light_purple'),
                chatController.text(`${title} status. `, 'white'),
                chatController.text('Settings: launcher. Commands: /help.', 'gray')
            ]));
            return status;
        },
        close() { return status; },
        rail() {}, section() {},
        // Never expose clickable actions, editable values, or toggle widgets.
        action() { return []; },
        chip(name, selected) { return selected ? [chatController.text(name, 'white')] : []; },
        toggle(enabled) { return [chatController.text(enabled ? 'ON' : 'OFF', enabled ? 'green' : 'gray')]; },
        pick(name, selected) { return selected ? [chatController.text(name, 'white')] : []; },
        flag(name, enabled) { return [chatController.text(`${name}: ${enabled ? 'ON' : 'OFF'}`, enabled ? 'green' : 'gray')]; },
        toggleRow(name, enabled) { row([label(name), ...status.toggle(enabled)]); },
        valueRow,
        adjustRow: valueRow
    };
    return status;
}

module.exports = { FEATURE_PANEL_COLORS, FEATURE_PANEL_SECTIONS, createFeatureStatus };
