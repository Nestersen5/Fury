'use strict';

const assert = require('assert');
const {
    MAX_CHAT_TRIGGER_LENGTH,
    normalizeChatTriggerList,
    formatChatTriggerList,
    findMatchingChatTrigger,
    createChatTriggerManager
} = require('../../features/chat_triggers.js');

assert.deepStrictEqual(
    normalizeChatTriggerList([' 3/4 ', '3/4', 'Two   Words', '', 'x'.repeat(MAX_CHAT_TRIGGER_LENGTH + 1), 12]),
    ['3/4', 'Two Words', '12'],
    'Chat trigger normalization should trim, dedupe, collapse spaces, and enforce max length'
);

assert.strictEqual(
    formatChatTriggerList(['3/4', '2/4']),
    '\u00a7f3/4\u00a77, \u00a7f2/4',
    'Chat trigger formatting should use Minecraft color codes'
);

assert.strictEqual(
    findMatchingChatTrigger('Party count is 3/4 right now', ['3', '3/4']),
    '3/4',
    'Chat trigger matching should prefer the longest matching trigger'
);

let savedTriggers = null;
const messages = [];
const manager = createChatTriggerManager({
    loadSettings: () => ({ triggers: [' 3/4 ', '2/4', '3/4'] }),
    saveSettings: (settings) => {
        savedTriggers = settings.triggers.slice();
        return settings;
    },
    logger: { log() {}, error() {} }
});

assert.deepStrictEqual(manager.load(), ['3/4', '2/4'], 'Manager load should normalize persisted settings');

const sendChat = (_client, message) => messages.push(message);
assert.deepStrictEqual(
    manager.handleCommand(null, ['/chattrigger', 'add', '1/4'], sendChat),
    { ok: true, action: 'add', trigger: '1/4', triggers: ['3/4', '2/4', '1/4'] },
    'Add command should append and save a new trigger'
);
assert.deepStrictEqual(savedTriggers, ['3/4', '2/4', '1/4']);
assert(messages.at(-1).includes('Added'), 'Add command should confirm the new trigger in chat');

assert.strictEqual(
    manager.handleCommand(null, ['/chattrigger', 'add', '1/4'], sendChat).reason,
    'duplicate',
    'Add command should reject duplicate triggers case-insensitively'
);

assert.deepStrictEqual(
    manager.handleCommand(null, ['/chattrigger', 'remove', '2/4'], sendChat),
    { ok: true, action: 'remove', trigger: '2/4', triggers: ['3/4', '1/4'] },
    'Remove command should delete matching triggers'
);

manager.handleCommand(null, ['/chattrigger', 'list'], sendChat);
assert(messages.some(message => message.extra?.some(part => part.text.includes('3/4'))), 'List command should display saved triggers');

assert.deepStrictEqual(
    manager.handleCommand(null, ['/chattrigger', 'clear'], sendChat),
    { ok: true, action: 'clear', triggers: [] },
    'Clear command should remove every trigger'
);

console.log('Chat trigger manager tests passed.');
