'use strict';

const { createFeatureStatus } = require('./feature_panel.js');
const chat = require('./chat_controller.js');

const DEFAULT_CHAT_TRIGGERS = ['3/4', '2/4', '1/4', '1/2', '1/3', '2/3'];
const MAX_CHAT_TRIGGER_LENGTH = 24;

function normalizeChatTriggerList(values) {
    const raw = Array.isArray(values)
        ? values
        : Array.isArray(values?.triggers)
            ? values.triggers
            : [];
    const seen = new Set();
    return raw
        .map(value => String(value || '').replace(/\s+/g, ' ').trim())
        .filter(value => value.length > 0 && value.length <= MAX_CHAT_TRIGGER_LENGTH)
        .filter((value) => {
            const key = value.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function formatChatTriggerList(triggers = []) {
    const clean = normalizeChatTriggerList(triggers);
    return clean.length ? clean.map(trigger => `\u00a7f${trigger}`).join('\u00a77, ') : '\u00a78None';
}

function findMatchingChatTrigger(message = '', triggers = []) {
    const normalizedMessage = String(message || '').toLowerCase();
    return normalizeChatTriggerList(triggers)
        .sort((a, b) => String(b).length - String(a).length)
        .find(trigger => normalizedMessage.includes(String(trigger || '').toLowerCase())) || null;
}

class ChatTriggerManager {
    constructor(options = {}) {
        this.loadSettings = typeof options.loadSettings === 'function'
            ? options.loadSettings
            : () => ({ triggers: DEFAULT_CHAT_TRIGGERS.slice() });
        this.saveSettings = typeof options.saveSettings === 'function'
            ? options.saveSettings
            : settings => ({ triggers: normalizeChatTriggerList(settings?.triggers) });
        this.logger = options.logger || console;
        this.triggers = normalizeChatTriggerList(options.triggers || []);
    }

    getTriggers() {
        return this.triggers.slice();
    }

    setTriggers(values) {
        this.triggers = normalizeChatTriggerList(values);
        return this.getTriggers();
    }

    load() {
        const settings = this.loadSettings();
        this.setTriggers(settings?.triggers);
        this.logger?.log?.(`[CHAT TRIGGERS] Loaded ${this.triggers.length} trigger(s).`);
        return this.getTriggers();
    }

    save() {
        try {
            const saved = this.saveSettings({ triggers: this.triggers });
            this.setTriggers(saved?.triggers);
        } catch (e) {
            this.logger?.error?.('[CHAT TRIGGERS ERROR] Failed to save trigger config:', e.message);
        }
        return this.getTriggers();
    }

    formatList() {
        return formatChatTriggerList(this.triggers);
    }

    findMatching(message = '') {
        return findMatchingChatTrigger(message, this.triggers);
    }

    handleCommand(client, args = [], sendChat = () => {}) {
        const subCmd = String(args[1] || 'list').toLowerCase();
        const trigger = args.slice(2).join(' ').replace(/\s+/g, ' ').trim();

        if (subCmd === 'list' || subCmd === 'status') {
            const panel = createFeatureStatus({ client, sendChat, title: 'Chat triggers', section: 'social' });
            panel.open();
            if (!this.triggers.length) panel.row([chat.text('No saved phrases.', 'gray')]);
            this.triggers.forEach(phrase => panel.row([
                chat.text(`${phrase} `, 'white'),
                ...panel.action('Remove', `/chattrigger remove ${phrase}`, `Remove "${phrase}".`)
            ]));
            panel.row([
                ...panel.action('Add phrase', '/chattrigger add ', 'Type a phrase (up to 24 characters).', { action: 'suggest_command' }),
                chat.text(' '),
                ...panel.action('Chat Stats', '/chatstats status', 'Configure chat stat sources.')
            ]);
            panel.close();
            return { ok: true, action: 'list', triggers: this.getTriggers() };
        }

        if (subCmd === 'add') {
            if (!trigger || trigger.length > MAX_CHAT_TRIGGER_LENGTH) {
                sendChat(client, '\u00a7cUsage: /chattrigger add <text up to 24 chars>');
                return { ok: false, action: 'add', reason: 'invalid-trigger' };
            }
            if (this.triggers.some(item => item.toLowerCase() === trigger.toLowerCase())) {
                sendChat(client, `\u00a76[ChatTriggers] \u00a77Trigger \u00a7f${trigger} \u00a77already exists.`);
                return { ok: false, action: 'add', reason: 'duplicate' };
            }
            this.triggers.push(trigger);
            this.setTriggers(this.triggers);
            this.save();
            sendChat(client, `\u00a76[ChatTriggers] \u00a7aAdded \u00a7f${trigger}\u00a7a.`);
            return { ok: true, action: 'add', trigger, triggers: this.getTriggers() };
        }

        if (subCmd === 'remove' || subCmd === 'delete' || subCmd === 'del') {
            if (!trigger) {
                sendChat(client, '\u00a7cUsage: /chattrigger remove <text>');
                return { ok: false, action: 'remove', reason: 'missing-trigger' };
            }
            const before = this.triggers.length;
            this.setTriggers(this.triggers.filter(item => item.toLowerCase() !== trigger.toLowerCase()));
            this.save();
            const removed = before !== this.triggers.length;
            sendChat(client, removed
                ? `\u00a76[ChatTriggers] \u00a7cRemoved \u00a7f${trigger}\u00a7c.`
                : `\u00a76[ChatTriggers] \u00a77No trigger matched \u00a7f${trigger}\u00a77.`);
            return { ok: removed, action: 'remove', trigger, triggers: this.getTriggers() };
        }

        if (subCmd === 'clear') {
            this.setTriggers([]);
            this.save();
            sendChat(client, '\u00a76[ChatTriggers] \u00a7cCleared all chat triggers.');
            return { ok: true, action: 'clear', triggers: [] };
        }

        sendChat(client, '\u00a7cUsage: /chattrigger add/remove/list/clear <text>');
        return { ok: false, action: 'usage', reason: 'unknown-subcommand' };
    }
}

function createChatTriggerManager(options = {}) {
    return new ChatTriggerManager(options);
}

module.exports = {
    DEFAULT_CHAT_TRIGGERS,
    MAX_CHAT_TRIGGER_LENGTH,
    normalizeChatTriggerList,
    formatChatTriggerList,
    findMatchingChatTrigger,
    ChatTriggerManager,
    createChatTriggerManager
};
