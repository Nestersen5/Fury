'use strict';

// Per-connection cosmetic effect recorder/classifier (/cosmeticfx).
//
// Two modes:
//  - Detection (default): when a FINAL KILL / bed-destruction chat line
//    lands, the surrounding effect packets are fingerprinted and matched
//    READ-ONLY against the exemplar library. Nothing is ever auto-recorded
//    from live games; unrecognized effects are reported and discarded.
//    Chat output is controlled by /cosmeticfx notify on|off.
//  - Recording: /cosmeticfx record <name> arms a one-shot clean-sample
//    recording. The NEXT capture (ideally triggered by you in a private
//    game) is stored in the library under that name, then recording disarms.
//
// Performance contract (this sits on the proxy's hot packet-relay path):
//  - per packet while idle: one boolean check. While detection/recording is
//    active: one Set lookup and, on the rare hit, one small object push into a
//    preallocated ring slot (overwrite, never splice/shift/filter).
//  - per chat line: two substring checks before any regex runs.
//  - fingerprinting/matching: runs a few times per game inside a timer
//    callback over at most RING_SIZE compact records - never inline with a
//    packet, so it cannot stall the relay loop.
//  - persistence lives in effectLibrary.js (sync load at startup only,
//    debounced async saves).

const {
    EFFECT_PACKET_NAMES,
    CAPTURE_LEAD_MS,
    CAPTURE_WINDOW_MS,
    BACKGROUND_WINDOW_MS,
    normalizeEffectPacket,
    withinRadius,
    buildFingerprint
} = require('./effectFingerprint.js');

const RING_SIZE = 4_096;
// Ignore captures whose fingerprint is nearly empty - a player with the
// default (no) cosmetic produces no distinctive packets.
const MIN_EFFECT_SIGNAL = 5;
const BED_BREAK_ANCHOR_TTL_MS = 3_000;

const KIND_LABELS = {
    final_kill: 'final kill',
    bed_break: 'bed destroy'
};

function createEffectRecorder({
    sendChat,
    library,
    resolvePlayerPosition,
    captureWindowMs = CAPTURE_WINDOW_MS,
    now = Date.now
} = {}) {
    const ring = new Array(RING_SIZE).fill(null);
    let ringIndex = 0;
    let lastAirBreak = null; // { x, y, z, t } - most recent block-to-air change (bed anchor)
    const pendingTimers = new Set();
    let armedLabel = null; // set by /cosmeticfx record <name>; one-shot
    // Detection chat is OPT-IN and the choice persists across restarts
    // (stored in the library file alongside the exemplars).
    let notifyEnabled = Boolean(library.getSetting?.('notify', false));
    let lastDetectionText = 'none yet';

    function ringPush(record) {
        ring[ringIndex] = record;
        ringIndex = (ringIndex + 1) % RING_SIZE;
    }

    function observeServerPacket(data, meta) {
        // With notifications off and no armed recording, no future capture can
        // consume these records. Particle and sound packets are common in busy
        // games, so avoid normalizing/allocating thousands of dead records.
        if (!notifyEnabled && !armedLabel) return;
        const name = meta?.name;
        if (name === 'block_change') {
            const state = Number(data?.type ?? data?.blockId);
            if (state === 0 && data?.location) {
                lastAirBreak = {
                    x: Number(data.location.x) + 0.5,
                    y: Number(data.location.y) + 0.5,
                    z: Number(data.location.z) + 0.5,
                    t: now()
                };
            }
            return;
        }
        if (!EFFECT_PACKET_NAMES.has(name)) return;
        const record = normalizeEffectPacket(name, data, now());
        if (record) ringPush(record);
    }

    function collectRecords(anchor, fromT, toT) {
        const collected = [];
        for (let i = 0; i < RING_SIZE; i += 1) {
            const record = ring[i];
            if (!record || record.t < fromT || record.t > toT) continue;
            if (!withinRadius(record, anchor)) continue;
            collected.push(record);
        }
        return collected;
    }

    function finalizeCapture(capture) {
        const captureRecords = collectRecords(
            capture.anchor,
            capture.at - CAPTURE_LEAD_MS,
            capture.at + captureWindowMs
        );
        const backgroundRecords = collectRecords(
            capture.anchor,
            capture.at - CAPTURE_LEAD_MS - BACKGROUND_WINDOW_MS,
            capture.at - CAPTURE_LEAD_MS
        );
        const fingerprint = buildFingerprint(captureRecords, backgroundRecords, capture.at);
        const kindLabel = KIND_LABELS[capture.kind] || capture.kind;

        // Armed clean-sample recording takes priority over detection and
        // always reports, regardless of the notify toggle.
        if (armedLabel) {
            if (fingerprint.total < MIN_EFFECT_SIGNAL) {
                sendChat(`§d[CosmeticFX] §7Recording §e${armedLabel}§7: no effect packets captured on that ${kindLabel} - still armed, trigger it again.`);
                return;
            }
            const entry = library.addExemplar(fingerprint, capture.kind, armedLabel);
            sendChat(`§d[CosmeticFX] §aRecorded §e${entry.label} §7as a ${kindLabel} effect (sample #${entry.samples}). Recording disarmed.`);
            lastDetectionText = `recorded ${entry.label} (${kindLabel})`;
            armedLabel = null;
            return;
        }

        if (!notifyEnabled) return;

        if (fingerprint.total < MIN_EFFECT_SIGNAL) {
            lastDetectionText = `${capture.owner} — ${kindLabel}: default/none`;
            sendChat(`§d[CosmeticFX] §f${capture.owner}§7's ${kindLabel} effect: §8none detected (default)`);
            return;
        }

        const result = library.classify(fingerprint, capture.kind);
        if (result && result.matched) {
            library.recordSighting(result.entry);
            const name = library.displayName(result.entry);
            lastDetectionText = `${capture.owner} — ${kindLabel}: ${name}`;
            sendChat(`§d[CosmeticFX] §f${capture.owner}§7's ${kindLabel} effect: §e${name} §8(${Math.round(result.score * 100)}% match, seen ${result.entry.seen}x)`);
            return;
        }

        lastDetectionText = `${capture.owner} — ${kindLabel}: unrecognized`;
        const closest = result ? ` §8(closest: ${library.displayName(result.entry)} at ${Math.round(result.score * 100)}%)` : '';
        sendChat(`§d[CosmeticFX] §f${capture.owner}§7's ${kindLabel} effect: §funrecognized${closest} §7— record it with §f/cosmeticfx record <name> §7in a private game.`);
    }

    function scheduleCapture(kind, owner, anchor) {
        if (!anchor) return;
        // Skip the work entirely when nothing would be reported or stored.
        if (!notifyEnabled && !armedLabel) return;
        const capture = { kind, owner: owner || 'unknown', anchor, at: now() };
        const timer = setTimeout(() => {
            pendingTimers.delete(timer);
            try {
                finalizeCapture(capture);
            } catch (error) {
                console.error('[CosmeticFX] capture failed:', error.message);
            }
        }, captureWindowMs + 100);
        timer.unref?.();
        pendingTimers.add(timer);
    }

    function observeChatLine(text) {
        const line = String(text || '');

        if (line.includes('FINAL KILL')) {
            const victimMatch = line.match(/^\s*([A-Za-z0-9_]{2,16})\b/);
            if (!victimMatch) return;
            const victim = victimMatch[1];
            const killer = line.match(/^\s*[A-Za-z0-9_]{2,16} was ([A-Za-z0-9_]{2,16})'s final/)?.[1]
                || line.match(/\bby ([A-Za-z0-9_]{2,16})[.!']*\s*FINAL KILL/)?.[1]
                || null;
            const anchor = resolvePlayerPosition?.(victim) || null;
            if (anchor) scheduleCapture('final_kill', killer || victim, anchor);
            return;
        }

        if (line.includes('destroyed by')) {
            const bedMatch = line.match(/Bed was (?:bed #[\d,]+ )?destroyed by ([A-Za-z0-9_]{2,16})/i);
            if (!bedMatch) return;
            if (!lastAirBreak || now() - lastAirBreak.t > BED_BREAK_ANCHOR_TTL_MS) return;
            scheduleCapture('bed_break', bedMatch[1], { x: lastAirBreak.x, y: lastAirBreak.y, z: lastAirBreak.z });
        }
    }

    function sendStatus() {
        const { total, byKind } = library.stats();
        const parts = Object.entries(byKind)
            .map(([kind, counts]) => `${KIND_LABELS[kind] || kind}: §f${counts.labeled}§7 named${counts.unknown ? ` + §f${counts.unknown}§7 unnamed` : ''}`);
        sendChat(`§d[CosmeticFX] §7Notifications: ${notifyEnabled ? '§aon' : '§coff'}§7. Recording: ${armedLabel ? `§earmed for "${armedLabel}"` : '§8off'}§7. Library: §f${total}§7 effects${parts.length ? ` (${parts.join('§7, ')}§7)` : ''}. Last: §f${lastDetectionText}`);
    }

    function sendList() {
        const entries = library.list();
        if (!entries.length) {
            sendChat('§d[CosmeticFX] §7Library is empty. Arm a recording with §f/cosmeticfx record <name>§7, then trigger the effect in a private game.');
            return;
        }
        sendChat('§d[CosmeticFX] §7Known effects:');
        entries.slice(0, 20).forEach((entry) => {
            const kindLabel = KIND_LABELS[entry.kind] || entry.kind;
            const name = entry.label ? `§e${entry.label}` : `§funknown-${entry.id}`;
            sendChat(`${name} §8— ${kindLabel}, ${entry.samples || 1} sample${(entry.samples || 1) === 1 ? '' : 's'}, seen ${entry.seen || 0}x`);
        });
        if (entries.length > 20) sendChat(`§8...and ${entries.length - 20} more.`);
    }

    function sendInfo() {
        sendChat('§d[CosmeticFX] §7Classifies final kill / bed destroy cosmetics by their packet signature. Live games are match-only - nothing is auto-recorded. To add a cosmetic: §f/cosmeticfx record <name>§7, then trigger it in a private game for a clean sample (re-recording a name replaces its sample). Commands: §fstatus§7, §flist§7, §frecord <name|cancel>§7, §fnotify [on|off]§7, §flabel§7, §fremove§7, §finfo§7.');
    }

    function handleCommand(client, args = []) {
        const subCmd = String(args[1] || 'status').toLowerCase();
        if (subCmd === 'list') return sendList();
        if (subCmd === 'info') return sendInfo();
        if (subCmd === 'record') {
            const first = String(args[2] || '').toLowerCase();
            if (!args[2]) {
                sendChat(armedLabel
                    ? `§d[CosmeticFX] §7Recording armed for §e${armedLabel}§7. Cancel with §f/cosmeticfx record cancel§7.`
                    : '§d[CosmeticFX] §7Usage: §f/cosmeticfx record <name> §7— the next final kill / bed destroy you trigger is stored under that name.');
                return;
            }
            if (first === 'cancel' || first === 'off') {
                armedLabel = null;
                sendChat('§d[CosmeticFX] §7Recording disarmed.');
                return;
            }
            armedLabel = args.slice(2).join(' ').trim();
            sendChat(`§d[CosmeticFX] §aArmed§7: the next final kill / bed destroy effect captured will be recorded as §e${armedLabel}§7. Best done in a private game for a clean sample.`);
            return;
        }
        if (subCmd === 'notify') {
            const mode = String(args[2] || '').toLowerCase();
            if (mode === 'on') notifyEnabled = true;
            else if (mode === 'off') notifyEnabled = false;
            else notifyEnabled = !notifyEnabled;
            library.setSetting?.('notify', notifyEnabled);
            sendChat(`§d[CosmeticFX] §7Detection notifications ${notifyEnabled ? '§aenabled' : '§cdisabled'}§7 (saved).`);
            return;
        }
        if (subCmd === 'label') {
            const target = String(args[2] || '');
            const label = args.slice(3).join(' ').trim();
            if (!target || !label) {
                sendChat('§d[CosmeticFX] §7Usage: §f/cosmeticfx label <unknown-N|id> <name>');
                return;
            }
            const entry = library.labelEntry(target, label);
            if (entry) sendChat(`§d[CosmeticFX] §7Labeled entry §f${entry.id} §7as §e${entry.label}§7.`);
            else sendChat(`§d[CosmeticFX] §cNo stored effect matches "${args[2]}".`);
            return;
        }
        if (subCmd === 'remove') {
            const removed = library.removeEntry(args.slice(2).join(' ').trim());
            if (removed) sendChat(`§d[CosmeticFX] §7Removed §e${library.displayName(removed)}§7 from the library.`);
            else sendChat(`§d[CosmeticFX] §cNo stored effect matches "${args.slice(2).join(' ')}".`);
            return;
        }
        sendStatus();
    }

    function dispose() {
        pendingTimers.forEach(clearTimeout);
        pendingTimers.clear();
    }

    return {
        observeServerPacket,
        observeChatLine,
        handleCommand,
        dispose
    };
}

module.exports = { createEffectRecorder };
