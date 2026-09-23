'use strict';

const assert = require('assert');
const {
    componentText,
    collectClickableChatEvents,
    buildClickableChatInfoComponent
} = require('../../chat_click_inspector.js');

const message = {
    text: '',
    extra: [
        { text: 'Click ' },
        {
            text: '[ACCEPT]',
            color: 'green',
            clickEvent: { action: 'run_command', value: '/party accept Player' },
            hoverEvent: { action: 'show_text', value: 'Accept invite' }
        },
        { text: ' or ' },
        {
            text: '[VIEW]',
            color: 'aqua',
            clickEvent: { action: 'open_url', value: 'https://hypixel.net/player/Player' }
        }
    ]
};

assert.strictEqual(componentText(message), 'Click [ACCEPT] or [VIEW]');

const events = collectClickableChatEvents(message);
assert.strictEqual(events.length, 2);
assert.deepStrictEqual(events[0], {
    action: 'run_command',
    value: '/party accept Player',
    label: '[ACCEPT]'
});
assert.deepStrictEqual(events[1], {
    action: 'open_url',
    value: 'https://hypixel.net/player/Player',
    label: '[VIEW]'
});

const info = buildClickableChatInfoComponent(events, componentText(message));
assert.ok(info);
assert.strictEqual(info.clickEvent, undefined);
assert.strictEqual(info.extra.some(part => part.clickEvent), false);
assert.ok(info.extra[1].text.includes('run_command /party accept Player'));
assert.ok(info.extra[1].hoverEvent.value.includes('Passive only: nothing was clicked.'));
assert.ok(info.extra[1].hoverEvent.value.includes('open_url https://hypixel.net/player/Player'));

assert.deepStrictEqual(collectClickableChatEvents({ text: 'plain chat' }), []);

console.log('Chat click inspector tests passed.');
