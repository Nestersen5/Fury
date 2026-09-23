'use strict';

// /lf <mode>: temporary, mode-specific chat triggers for one Bed Wars lobby.
// While active they replace the saved /chattrigger list, and they switch off
// as soon as the player leaves the lobby the command was run in.

const FOUR_PLAYER_WORDS = Object.freeze([
    '1/4', '2/4', '3/4', '4/4',
    'one out of four', 'two out of four', 'three out of four', 'four out of four',
    '1/four', '2/four', '3/four', '4/four',
    'one/4', 'two/4', 'three/4', 'four/4',
    'one/four', 'two/four', 'three/four', 'four/four'
]);

const LF_MODES = Object.freeze([
    {
        key: 'doubles',
        label: 'Doubles',
        short: '2s',
        aliases: ['doubles', 'double', 'duos', 'duo', '2s'],
        words: [
            '1/2', '2/2',
            'one out of two', 'two out of two',
            '1/two', '2/two',
            'one/2', 'two/2',
            '2s', 'doubles', 'duos',
            'one/two', 'two/two'
        ]
    },
    {
        key: 'threes',
        label: 'Threes',
        short: '3s',
        aliases: ['threes', 'three', '3s', '3v3v3v3'],
        words: [
            '1/3', '2/3', '3/3',
            'one out of three', 'two out of three', 'three out of three',
            '1/three', '2/three', '3/three',
            'one/3', 'two/3', 'three/3',
            '3s', '3v3v3v3', 'threes',
            'one/three', 'two/three', 'three/three'
        ]
    },
    {
        key: 'fours',
        label: 'Fours',
        short: '4s',
        aliases: ['fours', 'four', '4s', '4v4v4v4'],
        words: [...FOUR_PLAYER_WORDS, '4s', '4v4v4v4', 'fours'],
        rejectWord: '4v4'
    },
    {
        key: '4v4',
        label: '4v4',
        short: '4v4',
        aliases: ['4v4'],
        words: [...FOUR_PLAYER_WORDS, '4v4'],
        requiredWord: '4v4'
    }
]);

function normalizeLfMessage(message = '') {
    return String(message || '')
        .replace(/§[0-9a-fk-or]/gi, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Whole-token match: "1/4" must not fire inside "11/40", and "4v4" must not
// fire inside "4v4v4v4".
function containsLfWord(normalizedMessage, word) {
    const pattern = escapeRegExp(String(word).toLowerCase()).replace(/ /g, '\\s+');
    return new RegExp(`(?<![a-z0-9])${pattern}(?![a-z0-9])`).test(normalizedMessage);
}

function resolveLfMode(value = '') {
    const key = String(value || '').trim().toLowerCase();
    if (!key) return null;
    return LF_MODES.find(mode => mode.aliases.includes(key)) || null;
}

function findLfTrigger(message = '', modeOrKey) {
    const mode = typeof modeOrKey === 'string' ? resolveLfMode(modeOrKey) : modeOrKey;
    if (!mode) return null;
    const normalized = normalizeLfMessage(message);
    if (!normalized) return null;
    if (mode.requiredWord && !containsLfWord(normalized, mode.requiredWord)) return null;
    // A 4v4 party ad uses the same fractions as Fours; keep it out of Fours.
    if (mode.rejectWord && containsLfWord(normalized, mode.rejectWord)) return null;
    return mode.words
        .slice()
        .sort((a, b) => b.length - a.length)
        .find(word => containsLfWord(normalized, word)) || null;
}

const LF_ACTION_BAR_FRAME_MS = 60;
const LF_HOLD_FRAMES = 25;
const LF_ERASE_STEP = 2;
const LF_EMPTY_FRAMES = 4;
// Each typing cycle switches to the next colour scheme, like an animated MOTD.
const LF_PALETTES = Object.freeze([
    { label: '§6', modes: '§e', frame: '§6' },
    { label: '§3', modes: '§b', frame: '§3' },
    { label: '§5', modes: '§d', frame: '§5' },
    { label: '§2', modes: '§a', frame: '§2' }
]);

// "» Looking for: … «" stays put while the mode names type out letter by
// letter, hold, erase, then start over in the next colour scheme.
function formatLfActionBar(labels = [], frame = 0) {
    const chars = [];
    const push = (text, role) => [...text].forEach(char => chars.push({ char, role }));
    labels.forEach((label, index) => {
        if (index) push(', ', 'separator');
        push(label, 'modes');
    });

    const length = chars.length;
    const eraseFrames = Math.ceil(length / LF_ERASE_STEP);
    const cycle = length + LF_HOLD_FRAMES + eraseFrames + LF_EMPTY_FRAMES;
    const tick = Math.max(0, Math.floor(frame));
    const palette = LF_PALETTES[Math.floor(tick / cycle) % LF_PALETTES.length];
    const step = tick % cycle;

    let visible;
    let phase;
    if (step < length) {
        visible = step + 1;
        phase = 'type';
    } else if (step < length + LF_HOLD_FRAMES) {
        visible = length;
        phase = 'hold';
    } else if (step < length + LF_HOLD_FRAMES + eraseFrames) {
        visible = Math.max(0, length - (step - length - LF_HOLD_FRAMES + 1) * LF_ERASE_STEP);
        phase = 'erase';
    } else {
        visible = 0;
        phase = 'empty';
    }

    let body = '';
    let lastColor = null;
    chars.slice(0, visible).forEach(({ char, role }) => {
        const color = role === 'separator' ? '§7' : palette.modes;
        if (color !== lastColor) body += color;
        body += char;
        lastColor = color;
    });
    const cursor = phase === 'hold' ? '' : '§f_';
    return `${palette.frame}» ${palette.label}Looking for: ${body}${cursor} ${palette.frame}«`;
}

function createLookingForTriggers() {
    // Several modes can be on at once, all tied to the same lobby.
    let active = null;
    // Players who already got the match sound. Kept per lobby, so turning /lf
    // off and on again in the same lobby does not replay it.
    let alertedLobbyId = null;
    const alertedPlayers = new Set();

    const orderedModes = keys => LF_MODES.filter(mode => keys.has(mode.key));
    const snapshot = () => (active
        ? {
            modeKeys: orderedModes(active.modeKeys).map(mode => mode.key),
            labels: orderedModes(active.modeKeys).map(mode => mode.label),
            lobbyId: active.lobbyId,
            startedAt: active.startedAt
        }
        : null);

    return {
        isActive: () => Boolean(active),
        getState: snapshot,
        // Returns { added, already } mode labels.
        add(modes, lobbyId) {
            if (!active || active.lobbyId !== lobbyId) {
                active = { modeKeys: new Set(), lobbyId, startedAt: Date.now() };
            }
            const added = [];
            const already = [];
            modes.forEach((mode) => {
                if (active.modeKeys.has(mode.key)) already.push(mode.label);
                else {
                    active.modeKeys.add(mode.key);
                    added.push(mode.label);
                }
            });
            return { added, already };
        },
        // Returns the labels actually removed; turns /lf off when none remain.
        remove(modes) {
            if (!active) return [];
            const removed = modes.filter(mode => active.modeKeys.delete(mode.key)).map(mode => mode.label);
            if (!active.modeKeys.size) active = null;
            return removed;
        },
        stop() {
            const previous = snapshot();
            active = null;
            return previous;
        },
        // { trigger, modes } for every active mode the message matches, or null.
        matchDetails(message) {
            if (!active) return null;
            const hits = orderedModes(active.modeKeys)
                .map(mode => ({ mode, trigger: findLfTrigger(message, mode) }))
                .filter(hit => hit.trigger);
            if (!hits.length) return null;
            return {
                trigger: hits.map(hit => hit.trigger).sort((a, b) => b.length - a.length)[0],
                modes: hits.map(hit => hit.mode.short)
            };
        },
        match(message) {
            return this.matchDetails(message)?.trigger || null;
        },
        // True the first time a player is seen in the current /lf lobby.
        shouldAlert(playerName) {
            const key = String(playerName || '').trim().toLowerCase();
            if (!active || !key) return false;
            if (alertedLobbyId !== active.lobbyId) {
                alertedLobbyId = active.lobbyId;
                alertedPlayers.clear();
            }
            if (alertedPlayers.has(key)) return false;
            alertedPlayers.add(key);
            return true;
        },
        // Returns true when the observed lobby id means we left the lobby
        // /lf was started in. A missing id (sidebar mid-rebuild) is not a change.
        isLobbyChange(lobbyId) {
            return Boolean(active && lobbyId && lobbyId !== active.lobbyId);
        }
    };
}

module.exports = {
    LF_MODES,
    LF_ACTION_BAR_FRAME_MS,
    formatLfActionBar,
    resolveLfMode,
    findLfTrigger,
    createLookingForTriggers
};
