'use strict';

// Local recolor for /share echoes.
//
// /share sends PLAIN text lines to party (/pc) or lobby (/ac) chat so
// teammates without the proxy can read them. The server then echoes those
// lines back to us as ordinary chat. This module repaints ONLY our own share
// echoes with colored, hover/click-enabled components before they reach our
// client - one message in, one colored message out, so nothing is doubled.
//
// The broadcaster registers each line it sends together with the rich
// component that should replace it. rewrite() looks at an incoming chat
// packet and, when the stripped text is one of our registered lines echoed
// under our own name, swaps the shared portion for the stored component while
// keeping the server's "Party > [rank] You:" prefix intact.

const { extractText, extractFormattedText } = require('../../features/minecraft_chat.js');

const DEFAULT_TTL_MS = 8000;
const SECTION = '§';

// Return the formatted (legacy §-coded) prefix covering exactly the first
// `plainCount` visible characters of `formatted`. § color/format codes are
// copied through without counting toward the visible total, so the cut lands
// on a visible-character boundary regardless of embedded formatting.
function sliceFormattedByVisible(formatted, plainCount) {
    let out = '';
    let count = 0;
    let i = 0;
    while (i < formatted.length && count < plainCount) {
        const ch = formatted[i];
        if (ch === SECTION && i + 1 < formatted.length) {
            out += formatted.slice(i, i + 2);
            i += 2;
            continue;
        }
        out += ch;
        count += 1;
        i += 1;
    }
    return out;
}

function createShareEchoRewriter(deps = {}) {
    const {
        getLocalUsername = () => '',
        ttlMs = DEFAULT_TTL_MS,
        now = () => Date.now()
    } = deps;

    // Newest-last list of { line, component, at }. Small and short-lived, so a
    // plain array scan is cheaper than any map bookkeeping.
    let entries = [];

    function prune() {
        const cutoff = now() - ttlMs;
        if (entries.length && entries[0].at < cutoff) {
            entries = entries.filter(entry => entry.at >= cutoff);
        }
    }

    function register(line, component) {
        const clean = String(line || '');
        if (!clean || !component) return;
        entries.push({ line: clean, component, at: now() });
        prune();
    }

    function clear() {
        entries = [];
    }

    function hasPending() {
        prune();
        return entries.length > 0;
    }

    // Given a chat packet's parsed component, find the freshest registered
    // line whose text is the suffix of the echoed line under our own name.
    function matchEntry(plain) {
        const localName = String(getLocalUsername() || '').toLowerCase();
        const cutoff = now() - ttlMs;
        // Newest first so repeated identical lines resolve to the latest send.
        for (let i = entries.length - 1; i >= 0; i -= 1) {
            const entry = entries[i];
            if (entry.at < cutoff) continue;
            if (!plain.endsWith(entry.line)) continue;
            const prefix = plain.slice(0, plain.length - entry.line.length);
            // Must be an echo under our own name (the "Party > [rank] You:" /
            // "[rank] You:" head), never a bare line or someone else's message.
            if (!prefix.includes(':')) continue;
            if (localName && !prefix.toLowerCase().includes(localName)) continue;
            return { entry, prefixLength: prefix.length };
        }
        return null;
    }

    // Returns a new message JSON string to forward, or null to leave the
    // packet untouched. Only chat position 0/1 (chat box) should be passed in.
    function rewrite(packet = {}) {
        prune();
        if (entries.length === 0) return null;
        if (typeof packet.message !== 'string') return null;

        let component;
        try {
            component = JSON.parse(packet.message);
        } catch (e) {
            return null;
        }

        const plain = extractText(component);
        if (!plain) return null;

        const match = matchEntry(plain);
        if (!match) return null;

        const formatted = extractFormattedText(component);
        const prefixFormatted = sliceFormattedByVisible(formatted, match.prefixLength);
        const rebuilt = {
            text: '',
            // `§r` resets any color the prefix left open so the stored
            // component's explicit colors always render as authored.
            extra: [{ text: `${prefixFormatted}${SECTION}r` }, match.entry.component]
        };
        try {
            return JSON.stringify(rebuilt);
        } catch (e) {
            return null;
        }
    }

    return { register, rewrite, clear, hasPending };
}

module.exports = {
    createShareEchoRewriter,
    sliceFormattedByVisible,
    DEFAULT_TTL_MS
};
