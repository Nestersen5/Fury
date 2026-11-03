'use strict';

const { randomUUID } = require('crypto');
const chat = require('../../features/chat_controller');
const { extractText } = require('../../features/minecraft_chat');
const { pregameLobbyIdForScoreboard } = require('../dodge/bedwarsQueue');
const { parseBedwarsPregameChat, stripMinecraftFormatting } = require('../net/session/pregame_chat');
const { normalizeLobbySpamSettings } = require('./lobbySpamSettings');

const MAX_PLAYERS = 256;
const OFFER_COOLDOWN_MS = 60000;
const RULES = {
    low: { count: 5, window: 15000, similarity: 1 },
    balanced: { count: 3, window: 15000, similarity: 0.9 },
    high: { count: 3, window: 25000, similarity: 0.82 }
};

// Positive server-ID evidence is required; a remembered game mode is not enough.
function lobbyKeyForSidebar(lines, { gameActive = false, pregame = false, replay = false } = {}) {
    if (gameActive || pregame || replay || !Array.isArray(lines)) return null;
    const text = lines.map(stripMinecraftFormatting).join(' ');
    if (/\b(?:Waiting|Starting in|Spectating|Game Over)\b|\bPlayers\s*:\s*\d+\s*\/\s*\d+/i.test(text)) return null;
    const id = pregameLobbyIdForScoreboard(text);
    return /^(?:lobby|l)\d+[a-z]?$/i.test(id || '') ? id.toLowerCase() : null;
}

function publicMessage(root) {
    const text = stripMinecraftFormatting(extractText(root));
    const parsed = parseBedwarsPregameChat(text);
    if (!parsed) return null;
    const header = text.slice(0, text.indexOf(':')).trim();
    // Only rank/level badges followed by a Minecraft name, never system labels,
    // private messages or channel prefixes that happen to contain a colon.
    if (!/^(?:\[[^\]\r\n]{1,40}\]\s*)*[A-Za-z0-9_]{3,16}$/.test(header)) return null;
    return parsed;
}

function normalizeMessage(value) {
    return value.toLowerCase().replace(/[\u200b-\u200f\ufeff]/g, '').replace(/\s+/g, ' ').trim().slice(0, 256);
}

function grams(value) {
    const result = new Set();
    for (let i = 1; i < value.length; i++) result.add(value.slice(i - 1, i + 1));
    return result;
}

function similar(a, b, threshold) {
    if (a === b) return true;
    if (threshold === 1 || Math.min(a.length, b.length) < 12
        || Math.min(a.length, b.length) / Math.max(a.length, b.length) < threshold) return false;
    const left = grams(a), right = grams(b);
    let shared = 0;
    for (const gram of left) if (right.has(gram)) shared++;
    return 2 * shared / (left.size + right.size) >= threshold;
}

function createLobbySpam({ getSettings, getLobbyKey, isOwnName = () => false, isKnownPlayer = () => false, sendChat = () => {}, now = Date.now } = {}) {
    const sessionId = randomUUID();
    const recent = new Map(), muted = new Map();
    let revision = 0, lobby = null, disposed = false;
    let settings = normalizeLobbySpamSettings(getSettings());

    function resetWorld() { recent.clear(); lobby = null; }
    function syncSettings() {
        const next = normalizeLobbySpamSettings(getSettings());
        if (next.lobbySpamEnabled !== settings.lobbySpamEnabled || next.lobbySpamSensitivity !== settings.lobbySpamSensitivity) resetWorld();
        settings = next;
    }
    function snapshot(includePlayers = false) {
        return { sessionId, revision, mutedCount: muted.size, ...(includePlayers ? { players: [...muted.values()] } : {}) };
    }
    function manage(action, name) {
        if (disposed) return { ok: false, error: 'This Minecraft connection has ended.' };
        if (action === 'list') return { ok: true, ...snapshot(true) };
        if (action === 'clear') {
            if (muted.size) { muted.clear(); revision++; }
            recent.clear();
        } else if (action === 'mute' || action === 'unmute') {
            if (typeof name !== 'string' || !/^[A-Za-z0-9_]{3,16}$/.test(name) || isOwnName(name)) return { ok: false, error: 'Choose another player by their Minecraft name.' };
            const key = name.toLowerCase();
            if (action === 'mute' && !muted.has(key)) {
                if (muted.size >= MAX_PLAYERS) return { ok: false, error: 'Your temporary mute list is full. Unmute someone first.' };
                muted.set(key, name); revision++;
            } else if (action === 'unmute' && muted.delete(key)) revision++;
            recent.delete(key);
        } else return { ok: false, error: 'Unknown lobby mute action.' };
        return { ok: true, ...snapshot(true) };
    }
    function command(args) {
        const [rawAction = 'list', name, ...extra] = args;
        const action = rawAction.toLowerCase();
        if (extra.length || ((action === 'list' || action === 'clear') && name)) {
            sendChat('§cUsage: /lobbyspam mute|unmute <player>, list or clear'); return;
        }
        const result = manage(action.toLowerCase(), name);
        if (!result.ok) { sendChat(`§c${result.error}`); return; }
        if (action.toLowerCase() === 'mute') sendChat(chat.line([
            chat.text(`Muted ${name}'s lobby messages until disconnect. `),
            chat.action('[Undo]', `/lobbyspam unmute ${name}`, 'Show this player’s lobby messages again.')
        ]));
        else if (action.toLowerCase() === 'unmute') sendChat(`§7Unmuted ${name}'s lobby messages.`);
        else if (action.toLowerCase() === 'clear') sendChat('§7Your temporary lobby mute list is now empty.');
        else {
            sendChat('§bLobby mutes §7— cleared when you disconnect.');
            if (!muted.size) sendChat('§7No muted players.');
            for (const player of muted.values()) sendChat(chat.line([
                chat.text(`${player} `), chat.action('[Unmute]', `/lobbyspam unmute ${player}`, 'Show this player’s lobby messages again.')
            ]));
        }
    }
    // Returns null only for a locally muted public lobby message. The upstream
    // packet stays untouched for party/game tracking and other observers.
    function rewriteClientbound(packet, original = packet) {
        if (disposed || !settings.lobbySpamEnabled || Number(original.position || 0) !== 0) return packet;
        const current = getLobbyKey();
        if (current !== lobby) { recent.clear(); lobby = current; }
        if (!current || typeof original.message !== 'string' || original.message.length > 8192) return packet;
        let root, parsed;
        try { root = JSON.parse(original.message); parsed = publicMessage(root); } catch { return packet; }
        if (!parsed || isOwnName(parsed.sender) || !isKnownPlayer(parsed.sender)) return packet;
        const key = parsed.sender.toLowerCase();
        if (muted.has(key)) return null;
        if (parsed.message.length > 256) return packet;
        const text = normalizeMessage(parsed.message);
        if (text.length < 4) return packet;
        const rule = RULES[settings.lobbySpamSensitivity], at = now();
        let entry = recent.get(key);
        if (!entry) {
            if (recent.size >= MAX_PLAYERS) recent.delete(recent.keys().next().value);
            entry = { messages: [], offeredAt: -Infinity };
            recent.set(key, entry);
        }
        entry.messages = entry.messages.filter(row => at >= row.at && at - row.at <= rule.window);
        entry.messages.push({ text, at });
        if (entry.messages.length > 6) entry.messages.shift();
        const repeats = entry.messages.filter(row => similar(row.text, text, rule.similarity)).length;
        if (repeats < rule.count || at - entry.offeredAt < OFFER_COOLDOWN_MS) return packet;
        // Decorate the already-rendered copy so existing colors and actions survive.
        try { root = JSON.parse(packet.message); } catch { return packet; }
        entry.offeredAt = at;
        return { ...packet, message: JSON.stringify(chat.line([
            typeof root === 'string' ? { text: root } : root,
            chat.action(' [Mute]', `/lobbyspam mute ${parsed.sender}`,
                `${parsed.sender} sent ${repeats} repeated or very similar messages in ${rule.window / 1000} seconds.\nHide their lobby messages until disconnect.`)
        ])) };
    }
    return { command, manage, snapshot, rewriteClientbound, syncSettings, resetWorld,
        dispose() { disposed = true; resetWorld(); muted.clear(); revision++; } };
}

module.exports = { createLobbySpam, lobbyKeyForSidebar, publicMessage, normalizeMessage, MAX_PLAYERS, RULES };
