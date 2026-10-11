'use strict';

// Join announcements plus live Tab/visible-player evidence confirm arrivals.
// The caller supplies lobby-scoped presence and optional coordinated evidence.
// Unreachable/incompatible peers retain the existing local arrival checks.
function createPartyArrivalCheck({ getMembers, getKnownDenick, isOwnName, sendChat, playSound,
    enabled = true,
    getVisibleNames = () => [],
    getCoordination = () => null,
    hasCoordination = () => false,
    dismissCommand = '/partycheck dismiss',
    setTimer = setTimeout, clearTimer = clearTimeout }) {
    let active = false, timer = null, started = false, warned = false, unavailable = false;
    let initialChecked = false;
    const joined = new Set();
    const key = name => String(name || '').toLowerCase();
    function stop() {
        active = false;
        if (timer !== null) clearTimer(timer);
        timer = null;
        joined.clear();
        started = warned = unavailable = false;
        initialChecked = false;
    }
    function enter() { stop(); active = true; }
    function setEnabled(value) {
        const next = Boolean(value);
        if (next === enabled) return;
        enabled = next;
        if (timer !== null) clearTimer(timer);
        timer = null;
        warned = unavailable = false;
        // Keep this lobby's arrival evidence while muted. Re-enabling cannot
        // forget teammates who joined while the preference was off.
        if (enabled && active && started) timer = setTimer(check, 1000);
    }
    function memberEvidence() {
        const members = getMembers();
        if (members === null) return null;
        const result = { missing: [], different: [], pending: [] };
        const fallback = [];
        for (const name of new Map(members.filter(name => !isOwnName(name)).map(name => [key(name), name])).values()) {
            const coordinated = getCoordination(name);
            if (coordinated?.status === 'same') continue;
            if (coordinated?.status === 'different') result.different.push(name);
            else if (coordinated?.status === 'pending') result.pending.push(name);
            else fallback.push(name);
        }
        // Coordinated members do not need a Tab/entity traversal or denick
        // resolution. Collect local evidence only for the fallback subset.
        if (fallback.length) {
            const observed = new Set([...joined, ...getVisibleNames().map(key)]);
            const arrived = new Set(observed);
            for (const name of observed) {
                const known = getKnownDenick(name);
                if (known) arrived.add(key(known.realName || known.realIGN));
            }
            result.missing = fallback.filter(name => !arrived.has(key(name)));
        }
        return result;
    }
    function check() {
        timer = null;
        if (!active || !enabled) return;
        initialChecked = true;
        const evidence = memberEvidence();
        if (evidence === null) {
            if (!unavailable) sendChat('\u00a76Party check unavailable: waiting for a confirmed party roster.');
            unavailable = true;
        } else if (evidence.missing.length || evidence.different.length) {
            sendChat(evidence.different.length
                ? '\u00a7c\u00a7lLEAVE THIS LOBBY \u00a78- \u00a7cPARTY SPLIT DETECTED'
                : '\u00a7c\u00a7lLEAVE THIS LOBBY \u00a78- \u00a7cPOSSIBLE PARTY SPLIT');
            if (evidence.different.length) sendChat(`\u00a7eDifferent pregame server: \u00a7f${evidence.different.join(', ')}`);
            if (evidence.missing.length) sendChat(`\u00a7eArrival unconfirmed: \u00a7f${evidence.missing.join(', ')}`);
            sendChat({ text: '', extra: [
                { text: 'Everyone is here? ', color: 'gray' },
                {
                    text: '[Stop warnings]', color: 'yellow', underlined: true,
                    clickEvent: { action: 'run_command', value: dismissCommand },
                    hoverEvent: { action: 'show_text', value: 'Silence warnings and sounds for this lobby only.' }
                }
            ] });
            playSound({ name: 'note.pling', volume: 1, pitch: 63 });
            warned = true;
        } else if (!evidence.pending.length) {
            if (warned) sendChat('\u00a7aParty check: all current party members have joined.');
            warned = false;
            return;
        }
        timer = setTimer(check, 2500);
    }
    function observeChatLine(text) {
        if (!active) return;
        const line = String(text || '').replace(/\u00a7[0-9a-fk-or]/gi, '').trim();
        const match = line.match(/^([A-Za-z0-9_]{1,16}) has joined \((\d+)\/(\d+)\)!$/);
        if (!match || Number(match[2]) < 1 || Number(match[2]) > Number(match[3])) return;
        joined.add(key(match[1]));
        if (!started) {
            started = true;
            if (enabled) timer = setTimer(check, 1000);
        } else if (enabled && warned) {
            const evidence = memberEvidence();
            if (evidence && !evidence.missing.length && !evidence.different.length && !evidence.pending.length) {
                if (timer !== null) clearTimer(timer);
                check();
            }
        }
    }
    function refresh() {
        if (!active || !enabled) return;
        if (!started) {
            if (!hasCoordination()) return;
            started = true;
            if (timer === null) timer = setTimer(check, 1000);
        } else if (initialChecked) {
            if (timer !== null) clearTimer(timer);
            timer = setTimer(check, 0);
        }
        // Keep the initial join grace. Later evidence changes wake an idle or
        // pending check immediately; unchanged heartbeats do not call refresh.
    }
    return { enter, stop, setEnabled, observeChatLine, refresh };
}

module.exports = { createPartyArrivalCheck };
