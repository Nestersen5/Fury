'use strict';

const AUTOGAMBLER_TRIGGER_MESSAGE = '[I bet I can] - [Nah not right now]';
const AUTOGAMBLER_COMMAND = '/wanttobet true';
const AUTOGAMBLER_TRIGGER_PATTERN = /\[I\s+bet\s+I\s+can\]\s*-\s*\[Nah\s+not\s+right\s+now\]/i;
const AUTOGAMBLER_TRIGGER_SIGNATURE = 'ibeticannahnotrightnow';
const MUTED_GEORGE_DIALOGUE = new Set([
    "That's the spirit! [1/4]",
    "No worries, come talk to me later if you change your mind.",
    "I'd rather not do that. [4/4]",
    "If you fail, I'll have to go to work on Saturday to get those Tickets back. [3/4]",
    "Win 2 Bed Wars matches in a row, and I'll give you 200 Slumber Tickets. [2/4]",
    "I knew you could, so I bet a lot of Slumber Tickets on your success. [3/4]",
    "That's pretty cool! [2/4]",
    "Well what do you know, you did it. [1/4]",
    "Here, have some of my earnings, I think you deserve it. [4/4]",
    "I think you can do it again. [1/3]",
    "I'll bet big Tickets on your success, and we'll both win a lot. [2/3]",
    "I bet you can't win 2 Bed Wars matches in a row. [3/3]"
].map(line => `[NPC] Gambler George: ${line}`));

function shouldHideAutoGamblerDialogue(data = {}, meta = {}, enabled = false) {
    if (!enabled || meta.name !== 'chat' || Number(data.position) === 2) return false;
    // Match the whole visible line, never a fragment inside player chat/hover text.
    const visible = flattenAutoGamblerChatPayload(data.message)[0] || '';
    return MUTED_GEORGE_DIALOGUE.has(normalizeAutoGamblerChatText(visible).replace(/\s+/g, ' ').trim());
}
const AUTOGAMBLER_RAW_CHAT_PACKET_NAMES = new Set([
    'chat',
    'player_chat',
    'system_chat',
    'profileless_chat',
    'disguised_chat',
    'chat_message'
]);

function randomAutoGamblerDelaySeconds(random = Math.random) {
    return Number((0.5 + random() * 0.5).toFixed(2));
}

function flattenAutoGamblerChatPayload(value, seen = new Set()) {
    if (value === null || value === undefined) return [];
    if (Buffer.isBuffer(value)) return flattenAutoGamblerChatPayload(value.toString('utf8'), seen);

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length < 50000) {
            try {
                return flattenAutoGamblerChatPayload(JSON.parse(trimmed), seen);
            } catch (e) {
                return [value];
            }
        }
        return [value];
    }

    if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
    if (Array.isArray(value)) {
        const parts = value.flatMap(item => flattenAutoGamblerChatPayload(item, seen));
        const joined = parts.join('');
        return joined ? [joined, ...parts] : parts;
    }
    if (typeof value !== 'object') return [];
    if (seen.has(value)) return [];
    seen.add(value);

    const direct = [];
    ['text', 'selector', 'keybind'].forEach((key) => {
        if (value[key] !== undefined) direct.push(String(value[key]));
    });
    if (value.score?.value !== undefined) direct.push(String(value.score.value));
    if (Array.isArray(value.with)) direct.push(...value.with.flatMap(item => flattenAutoGamblerChatPayload(item, seen)));
    if (Array.isArray(value.extra)) direct.push(...value.extra.flatMap(item => flattenAutoGamblerChatPayload(item, seen)));

    return direct.length ? [direct.join('')] : [];
}

function normalizeAutoGamblerChatText(text = '') {
    return String(text || '')
        .normalize('NFKC')
        .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
        .replace(/(?:\u00C2?\u00A7|\\u00a7|\\u00A7|&)[0-9A-FK-OR]/gi, '')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\u00A0/g, ' ');
}

function compactAutoGamblerChatText(text = '') {
    return normalizeAutoGamblerChatText(text).replace(/[^a-z0-9]+/gi, '').toLowerCase();
}

function isAutoGamblerTriggerText(...texts) {
    const values = texts.length ? texts.flat(Infinity) : [''];
    return values
        .flatMap(text => flattenAutoGamblerChatPayload(text))
        .some((text) => {
            const normalized = normalizeAutoGamblerChatText(text);
            return AUTOGAMBLER_TRIGGER_PATTERN.test(normalized)
                || compactAutoGamblerChatText(normalized).includes(AUTOGAMBLER_TRIGGER_SIGNATURE);
        });
}

function normalizeAutoGamblerToggle(value = '') {
    const subCmd = String(value || 'status').toLowerCase();
    if (['on', 'enable', 'enabled', 'true'].includes(subCmd)) return 'on';
    if (['false', 'off', 'disable', 'disabled', 'no'].includes(subCmd)) return 'false';
    return 'status';
}

class AutoGamblerSession {
    constructor(options = {}) {
        this.isEnabled = typeof options.isEnabled === 'function' ? options.isEnabled : () => false;
        this.isPlayState = typeof options.isPlayState === 'function' ? options.isPlayState : () => true;
        this.sendChat = typeof options.sendChat === 'function' ? options.sendChat : () => {};
        this.sendCommand = typeof options.sendCommand === 'function' ? options.sendCommand : () => {};
        this.onCommandSent = typeof options.onCommandSent === 'function' ? options.onCommandSent : () => {};
        // Last gate before the command goes out. Returning false parks the
        // attempt (George is on a post-loss cooldown, say) without cancelling
        // detection for the next prompt.
        this.canAccept = typeof options.canAccept === 'function' ? options.canAccept : () => true;
        this.random = typeof options.random === 'function' ? options.random : Math.random;
        this.now = typeof options.now === 'function' ? options.now : Date.now;
        this.setTimeout = typeof options.setTimeout === 'function' ? options.setTimeout : setTimeout;
        this.clearTimeout = typeof options.clearTimeout === 'function' ? options.clearTimeout : clearTimeout;
        this.logger = options.logger || console;
        this.dedupeMs = Number(options.dedupeMs || 1000);
        this.timers = new Set();
        this.lastTriggerAt = 0;
    }

    maybeSchedule(...texts) {
        if (!this.isEnabled()) return false;
        if (!isAutoGamblerTriggerText(...texts)) return false;

        const now = this.now();
        if (now - this.lastTriggerAt < this.dedupeMs) return false;
        this.lastTriggerAt = now;

        const delaySeconds = randomAutoGamblerDelaySeconds(this.random);
        const delayMs = Math.round(delaySeconds * 1000);

        const timer = this.setTimeout(() => {
            this.timers.delete(timer);
            if (!this.isEnabled()) return;
            if (!this.isPlayState()) return;
            if (this.canAccept() === false) {
                this.logger?.log?.(`[AutoGambler] Skipped ${AUTOGAMBLER_COMMAND}; acceptance is currently blocked.`);
                return;
            }
            this.sendCommand(AUTOGAMBLER_COMMAND);
            this.onCommandSent(AUTOGAMBLER_COMMAND);
            // Keep the in-game line short and clean; command/timing details
            // stay in the console log only.
            this.sendChat('\u00a76\u00a7lFury \u00a78\u00bb \u00a7aQuest accepted!');
            this.logger?.log?.(`[AutoGambler] Sent ${AUTOGAMBLER_COMMAND} after ${delaySeconds.toFixed(2)}s.`);
        }, delayMs);

        if (typeof timer?.unref === 'function') timer.unref();
        this.timers.add(timer);
        this.logger?.log?.(`[AutoGambler] Exact prompt detected; scheduled ${AUTOGAMBLER_COMMAND} in ${delaySeconds.toFixed(2)}s.`);
        return true;
    }

    observeChatEvent(packet = {}) {
        const isActionBar = Number(packet.positionId) === 2
            || Number(packet.position) === 2
            || packet.isActionBar === true;
        if (isActionBar) return false;
        return this.maybeSchedule(
            packet.plainMessage,
            packet.formattedMessage,
            packet.unsignedContent,
            packet.unsignedChatContent,
            packet.signedChatContent,
            packet.content,
            packet.senderName,
            packet.targetName,
            packet
        );
    }

    observeRawChatPacket(data = {}, meta = {}) {
        if (!AUTOGAMBLER_RAW_CHAT_PACKET_NAMES.has(meta.name)) return false;
        const isActionBar = Number(data.position) === 2
            || Number(data.positionId) === 2
            || data.isActionBar === true;
        if (isActionBar) return false;
        return this.maybeSchedule(
            data.message,
            data.formattedMessage,
            data.plainMessage,
            data.unsignedChatContent,
            data.signedChatContent,
            data.content,
            data.networkName,
            data.senderName,
            data.name,
            data.target,
            data.targetName,
            data
        );
    }

    clearTimers() {
        this.timers.forEach(timer => this.clearTimeout(timer));
        this.timers.clear();
    }
}

function createAutoGamblerSession(options = {}) {
    return new AutoGamblerSession(options);
}

module.exports = {
    AUTOGAMBLER_TRIGGER_MESSAGE,
    AUTOGAMBLER_COMMAND,
    AUTOGAMBLER_RAW_CHAT_PACKET_NAMES,
    randomAutoGamblerDelaySeconds,
    flattenAutoGamblerChatPayload,
    normalizeAutoGamblerChatText,
    compactAutoGamblerChatText,
    isAutoGamblerTriggerText,
    shouldHideAutoGamblerDialogue,
    normalizeAutoGamblerToggle,
    AutoGamblerSession,
    createAutoGamblerSession
};
