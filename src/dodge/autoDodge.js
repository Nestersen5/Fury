'use strict';

const { getFkdrColor } = require('../stats/colors.js');
const { isUrchinDeveloperNotice } = require('../stats/urchinNotice.js');
const { formatBedwarsPrestige } = require('../stats/format.js');
const { createPregameCountdown } = require('./pregameCountdown.js');
const chatController = require('../../features/chat_controller.js');
const { createFeatureStatus } = require('../../features/feature_panel.js');

// Auto-dodger extracted from proxy.js. While in a Bedwars pregame lobby, when a
// chatting player matches a configured dodge condition (tagged, nicked, or a
// separate stat threshold), schedule a /l (leave) so we dodge before the game
// starts.
//
// The delay doubles as a cancel window, but it is also countdown-aware: when the
// game is about to start the leave fires "as late as safely possible" (a small
// buffer before the start) so a tag found late in the countdown still dodges. We
// never send /l once the game has actually started.
//
// All collaborators are injected. Per-connection state (pendingDodge,
// pregameCountdown) lives inside the instance, so create one per connection
// (mirrors createAutoGamblerSession in proxy.js).

const SAFETY_BUFFER_SECONDS = 1; // leave this many seconds before the game starts
const DODGE_INCLUDE_PRESETS = new Set(['all_on', 'custom']);

function createAutoDodger(deps) {
    const {
        sendChat,
        sendLeaveCommand,
        isPregameActive,
        isGameActive,
        getPregameSessionId,
        isEnabled,
        getDelaySeconds,
        getDodgeSettings,
        applyConfig,
        compactTagName,
        isPartyMember = () => false,
        // Injectable clock so tests can pin the countdown math; live use
        // always runs on Date.now.
        now = Date.now
    } = deps;

    let pendingDodge = null;
    const pregameCountdown = createPregameCountdown({ isPregameActive, now });
    // Snapshot of the user's Custom include selection, captured the moment they
    // switch to All. Switching back to Custom restores from this snapshot so
    // their original choices come back. In-memory only — if the proxy restarts
    // while All is active, switching back to Custom leaves the booleans where
    // they were persisted (all true).
    let customIncludeSnapshot = null;

    function numberOr(value, fallback) {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function normalizeIncludePreset(value) {
        const clean = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
        return DODGE_INCLUDE_PRESETS.has(clean) ? clean : 'custom';
    }

    function getSettings() {
        const raw = typeof getDodgeSettings === 'function' ? (getDodgeSettings() || {}) : {};
        const includePreset = normalizeIncludePreset(raw.includePreset);
        const customSettings = {
            taggedPlayers: raw.taggedPlayers !== undefined ? Boolean(raw.taggedPlayers) : true,
            nickedPlayers: raw.nickedPlayers !== undefined ? Boolean(raw.nickedPlayers) : false,
            statThreats: raw.statThreats !== undefined ? Boolean(raw.statThreats) : false
        };
        const presetSettings = includePreset === 'all_on'
            ? { taggedPlayers: true, nickedPlayers: true, statThreats: true }
            : customSettings;
        return {
            includePreset,
            ...presetSettings,
            minFkdr: Math.max(0, numberOr(raw.minFkdr, 3)),
            minStars: Math.max(0, numberOr(raw.minStars, 1000))
        };
    }

    // The Urchin API attaches a developer/deprecation "Caution" notice to
    // lookups. It is not a report against the player, so it must never trigger
    // a dodge. Derive the dodge-worthy tag from the genuine report tags,
    // ignoring the notice; fall back to the pre-derived tag for shapes that
    // carry no rawTags (and only when that tag isn't the notice itself).
    function getUrchinDodgeTag(urchin) {
        if (!urchin) return '';
        const rawTags = Array.isArray(urchin.rawTags) ? urchin.rawTags : [];
        const genuine = rawTags.filter((tag) => {
            const tooltip = String(tag?.tooltip || '');
            if (!tooltip.toLowerCase().includes('added by')) return false;
            return !isUrchinDeveloperNotice(tooltip);
        });
        if (genuine.length > 0) {
            const tooltip = String(genuine[genuine.length - 1].tooltip || '');
            const derived = tooltip.split('(')[0].trim().replace(/[\[\]]/g, '');
            return compactTagName(derived) || compactTagName(genuine[genuine.length - 1].text) || '';
        }
        // No genuine report tags. If the notice is present among rawTags (or is
        // what the pre-derived tag came from), there is nothing to dodge.
        if (rawTags.some((tag) => isUrchinDeveloperNotice(String(tag?.tooltip || '')))) return '';
        if (isUrchinDeveloperNotice(String(urchin.tag || ''))) return '';
        return compactTagName(urchin.tag);
    }

    function hasKnownDenick(knownDenick) {
        return Boolean(String(knownDenick?.realName || knownDenick?.realIGN || '').trim());
    }

    function getDodgeTagReason(data, knownDenick = null) {
        // A nick we have already resolved in the denick list is evaluated with
        // its real profile. Do not discard that profile's tag merely because
        // the chat-facing alias is still marked as nicked.
        if (!data || data.lookupFailed || (data.isNicked && !hasKnownDenick(knownDenick))) return null;
        const urchinTag = getUrchinDodgeTag(data.urchin);
        if (urchinTag) return `§cUrchin §f${urchinTag}`;
        if (data.seraph?.tagged) {
            const seraphTag = compactTagName(data.seraph.report_type) || 'Blacklisted';
            return `§4Seraph §f${seraphTag}`;
        }
        return null;
    }

    function getBedwarsStats(data) {
        const player = data?.player || {};
        const bw = player.stats?.Bedwars || {};
        const stars = numberOr(player.achievements?.bedwars_level, 0);
        const finalKills = numberOr(bw.final_kills_bedwars, 0);
        const finalDeaths = numberOr(bw.final_deaths_bedwars, 0);
        return {
            stars,
            fkdr: finalKills / Math.max(finalDeaths, 1)
        };
    }

    function getDodgeStatThreatReason(data, knownDenick = null) {
        if (!data || data.lookupFailed || (data.isNicked && !hasKnownDenick(knownDenick)) || !data.player) return null;
        const settings = getSettings();
        const stats = getBedwarsStats(data);
        const matches = [];
        if (stats.fkdr >= settings.minFkdr) matches.push(`FKDR ${stats.fkdr.toFixed(2)}`);
        if (stats.stars >= settings.minStars) matches.push(`${Math.round(stats.stars)}★`);
        return matches.length ? `§6Stats §f${matches.join(' / ')}` : null;
    }

    function getDodgeReason(data, knownDenick = null) {
        const settings = getSettings();
        if (settings.taggedPlayers) {
            const tagReason = getDodgeTagReason(data, knownDenick);
            if (tagReason) return tagReason;
        }
        // Known denicks are treated as their real account, not as an
        // automatically-dodgeable unknown nick. This means they can still
        // trigger the enabled tag/stat filters after their real profile loads.
        if (settings.nickedPlayers && data && !data.lookupFailed && data.isNicked && !hasKnownDenick(knownDenick)) {
            return '§cNicked player';
        }
        if (settings.statThreats) {
            const statReason = getDodgeStatThreatReason(data, knownDenick);
            if (statReason) return statReason;
        }
        return null;
    }

    function noteScoreboard(scoreboardText) {
        pregameCountdown.note(scoreboardText);
        if (!pendingDodge) return;
        const delaySeconds = effectiveDelaySeconds();
        const nextDueAt = now() + delaySeconds * 1000;
        // A countdown can appear after the player match was evaluated. Pull an
        // existing decision window forward so the configured delay can never
        // carry the leave past the safe pre-start boundary.
        if (!Number.isFinite(pendingDodge.dueAt) || nextDueAt + 25 < pendingDodge.dueAt) {
            const plan = pendingDodge;
            clearTimeout(plan.timer);
            plan.dueAt = nextDueAt;
            plan.timer = setTimeout(() => executeDodge(plan), delaySeconds * 1000);
        }
    }

    function estimateSecondsRemaining() {
        return pregameCountdown.estimateSecondsRemaining();
    }

    function effectiveDelaySeconds() {
        const configured = getDelaySeconds();
        const remaining = estimateSecondsRemaining();
        if (remaining === null) return configured;
        const latest = Math.floor(remaining) - SAFETY_BUFFER_SECONDS;
        return Math.max(0, Math.min(configured, latest));
    }

    function executeDodge(plan) {
        pendingDodge = null;
        if (plan.sessionId !== getPregameSessionId() || !isPregameActive() || isGameActive()) return;
        sendChat(`§b§lDodge §8» §cLeaving lobby §7— §f${plan.player} §7matched auto-dodge (${plan.reason}§7).`);
        try {
            sendLeaveCommand();
        } catch (error) {
            sendChat(`§b§lDodge §8» §cFailed to send leave command: §f${error.message || 'unknown error'}`);
        }
    }

    function cancel(reason, { announce = true } = {}) {
        if (!pendingDodge) return false;
        clearTimeout(pendingDodge.timer);
        const cancelled = pendingDodge;
        pendingDodge = null;
        if (announce) {
            sendChat(`§b§lDodge §8» §7Cancelled dodge of §f${cancelled.player}§7${reason ? ` §8(${reason})` : ''}.`);
        }
        return true;
    }

    function reset() {
        cancel('reset', { announce: false });
        pregameCountdown.reset();
    }

    function maybeSchedule(name, profile, options = {}) {
        if (!isEnabled() || !isPregameActive() || isGameActive()) return;
        if (pendingDodge) return; // first matching player wins; later triggers are ignored
        if (isPartyMember(name)) return; // never dodge over your own party member
        const knownDenick = options.knownDenick || null;
        const realName = String(knownDenick?.realName || knownDenick?.realIGN || '').trim();
        // Party tracking sees the real IGN, while pregame chat sees the nick.
        // Resolve that mismatch before deciding whether this is an opponent.
        if (realName && isPartyMember(realName)) return;
        const reason = getDodgeReason(profile?.data, knownDenick);
        if (!reason) return;

        const delaySeconds = effectiveDelaySeconds();
        const plan = {
            player: name,
            reason,
            sessionId: getPregameSessionId(),
            timer: null,
            dueAt: now() + delaySeconds * 1000
        };
        plan.timer = setTimeout(() => executeDodge(plan), delaySeconds * 1000);
        pendingDodge = plan;

        if (delaySeconds <= 0) return; // executeDodge will announce on the next tick

        const shortened = delaySeconds < getDelaySeconds();
        if (shortened) {
            sendChat(`§b§lDodge §8» §e${name} §7matched auto-dodge (${reason}§7). §6Game starting §7— leaving in §f${delaySeconds}s§7.`);
        } else {
            sendChat(`§b§lDodge §8» §e${name} §7matched auto-dodge (${reason}§7). Leaving in §f${delaySeconds}s§7.`);
        }
        sendChat({
            text: '',
            extra: [
                { text: 'Dodge ', color: 'aqua', bold: true },
                { text: '» ', color: 'gray' },
                { text: 'Click ', color: 'white' },
                {
                    text: '[Cancel]',
                    color: 'red',
                    bold: true,
                    clickEvent: { action: 'run_command', value: '/dodge cancel' },
                    hoverEvent: {
                        action: 'show_text',
                        value: `Cancel auto-dodge of ${name}.`
                    }
                },
                { text: ' to stay in this lobby.', color: 'white' }
            ]
        });
    }

    function onGameStart() {
        if (!pendingDodge) return;
        sendChat(`§b§lDodge §8» §cGame started before dodge fired §7(§f${pendingDodge.player}§7). Consider a shorter §e/dodge delay§7.`);
        cancel('game started', { announce: false });
    }

    function normalizeDodgeIncludeName(name) {
        const clean = String(name || '').toLowerCase().trim();
        if (['tag', 'tags', 'tagged'].includes(clean)) return 'taggedPlayers';
        if (['nick', 'nicks', 'nicked'].includes(clean)) return 'nickedPlayers';
        if (['threat', 'threats', 'stat', 'stats'].includes(clean)) return 'statThreats';
        if (['all', 'everything'].includes(clean)) return 'all';
        return '';
    }

    function onOffValue(value) {
        const clean = String(value || '').toLowerCase().trim();
        if (['on', 'enable', 'enabled', 'true', 'yes'].includes(clean)) return true;
        if (['off', 'disable', 'disabled', 'false', 'no'].includes(clean)) return false;
        return null;
    }

    function applyPresetTransition(targetPreset, options = {}) {
        const current = getSettings();
        if (targetPreset === 'all_on') {
            if (current.includePreset !== 'all_on') {
                // Save the user's current Custom selection so we can restore it
                // when they switch back. Take the snapshot from the *stored*
                // booleans (not getSettings' override) so we don't snapshot
                // all-true derived values.
                const raw = typeof getDodgeSettings === 'function' ? (getDodgeSettings() || {}) : {};
                customIncludeSnapshot = {
                    taggedPlayers: Boolean(raw.taggedPlayers),
                    nickedPlayers: Boolean(raw.nickedPlayers),
                    statThreats: Boolean(raw.statThreats)
                };
            }
            applyConfig({
                includePreset: 'all_on',
                taggedPlayers: true,
                nickedPlayers: true,
                statThreats: true
            });
            return;
        }
        if (targetPreset === 'custom') {
            const patch = { includePreset: 'custom' };
            if (options.allOff) {
                patch.taggedPlayers = false;
                patch.nickedPlayers = false;
                patch.statThreats = false;
                customIncludeSnapshot = { taggedPlayers: false, nickedPlayers: false, statThreats: false };
            } else if (customIncludeSnapshot) {
                patch.taggedPlayers = customIncludeSnapshot.taggedPlayers;
                patch.nickedPlayers = customIncludeSnapshot.nickedPlayers;
                patch.statThreats = customIncludeSnapshot.statThreats;
            }
            applyConfig(patch);
            return;
        }
        applyConfig({ includePreset: targetPreset });
    }

    function normalizePresetCommand(value) {
        const clean = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
        if (['all', 'all_on', 'on', 'enabled'].includes(clean)) return 'all_on';
        if (['custom', 'manual'].includes(clean)) return 'custom';
        return '';
    }

    function createControllerPanel() {
        return createFeatureStatus({
            sendLine: sendChat,
            title: 'Auto Dodge',
            subtitle: 'PREGAME SAFETY',
            section: 'safety',
            helpTopic: 'dodge'
        });
    }

    function renderAdjustRow(panel, labelText, valueText, downCommand, upCommand, editCommand, canDown, canUp, hoverBase) {
        panel.row([
            panel.label(labelText),
            chatController.component(String(valueText).padEnd(8), 'white'),
            ...panel.action('-', canDown ? downCommand : null, canDown ? `Lower ${hoverBase}.` : 'Already at minimum.', { locked: !canDown }),
            chatController.text(' ', panel.colors.quiet),
            ...panel.action('edit', editCommand, `Type a new ${hoverBase}.`, { action: 'suggest_command' }),
            chatController.text(' ', panel.colors.quiet),
            ...panel.action('+', canUp ? upCommand : null, canUp ? `Raise ${hoverBase}.` : 'Already at maximum.', { locked: !canUp })
        ]);
    }

    function sendController() {
        const settings = getSettings();
        const enabled = isEnabled();
        const delaySeconds = getDelaySeconds();
        const includeLocked = settings.includePreset !== 'custom';
        const pending = pendingDodge ? pendingDodge.player : null;
        const lockedHover = includeLocked
            ? ['Preset "All" locks this option.', 'Switch to Custom to edit.']
            : null;
        const panel = createControllerPanel();

        const fkdr = settings.minFkdr;
        const stars = Math.round(settings.minStars);
        const fkdrDown = Math.max(0, Number((fkdr - 0.5).toFixed(2)));
        const fkdrUp = Number((fkdr + 0.5).toFixed(2));
        const starsDown = Math.max(0, stars - 50);
        const starsUp = stars + 50;
        const delayDown = Math.max(0, delaySeconds - 1);
        const delayUp = Math.min(15, delaySeconds + 1);

        panel.open();
        panel.section('Overview');
        panel.toggleRow('Power', enabled, '/dodge on', '/dodge off',
            'Leave a risky BedWars pregame when an included threat is found.');
        panel.valueRow('Pending leave', pending || 'none', {
            color: pending ? panel.colors.value : panel.colors.quiet
        });

        panel.section('Players to dodge');
        panel.row([
            panel.label('Preset'),
            ...panel.pick('All', settings.includePreset === 'all_on', '/dodge preset all', 'Include tagged, nicked, and stat threats.'),
            chatController.text(' ', panel.colors.quiet),
            ...panel.pick('Custom', settings.includePreset === 'custom', '/dodge preset custom', 'Pick include options yourself.')
        ]);
        panel.row([
            panel.label('Include'),
            ...panel.flag('Tagged', settings.taggedPlayers,
                includeLocked ? null : `/dodge include tagged ${settings.taggedPlayers ? 'off' : 'on'}`,
                lockedHover || (settings.taggedPlayers ? 'Click to exclude tagged players.' : 'Click to include tagged players.'),
                { locked: includeLocked }),
            chatController.text(' ', panel.colors.quiet),
            ...panel.flag('Nicked', settings.nickedPlayers,
                includeLocked ? null : `/dodge include nicks ${settings.nickedPlayers ? 'off' : 'on'}`,
                lockedHover || (settings.nickedPlayers ? 'Click to exclude nicked players.' : 'Click to include nicked players.'),
                { locked: includeLocked }),
            chatController.text(' ', panel.colors.quiet),
            ...panel.flag('Stat Threats', settings.statThreats,
                includeLocked ? null : `/dodge include threats ${settings.statThreats ? 'off' : 'on'}`,
                lockedHover || (settings.statThreats ? 'Click to ignore stat thresholds.' : 'Click to dodge players above stat thresholds.'),
                { locked: includeLocked })
        ]);

        panel.section('Timing');
        renderAdjustRow(panel, 'Delay', `${delaySeconds}s`,
            `/dodge delay ${delayDown}`, `/dodge delay ${delayUp}`, '/dodge delay ',
            delaySeconds > 0, delaySeconds < 15, 'delay');

        panel.section('Threat rules');
        renderAdjustRow(panel, 'FKDR >=', `${getFkdrColor(fkdr)}${fkdr.toFixed(2)}`,
            `/dodge threat fkdr ${fkdrDown}`, `/dodge threat fkdr ${fkdrUp}`, '/dodge threat fkdr ',
            fkdr > 0, true, 'FKDR threshold');
        renderAdjustRow(panel, 'Stars >=', formatBedwarsPrestige(stars),
            `/dodge threat stars ${starsDown}`, `/dodge threat stars ${starsUp}`, '/dodge threat stars ',
            stars > 0, true, 'star threshold');

        if (pending) {
            panel.section('Current action');
            panel.row([
                ...panel.action(`Cancel ${pending}`, '/dodge cancel', `Cancel auto-dodge of ${pending}.`, { color: 'red' })
            ]);
        }
        panel.close();
    }

    function settingsLine() {
        sendController();
    }

    function handleCommand(args) {
        const subCmd = String(args[1] || 'status').toLowerCase();
        if (subCmd === 'cancel' || subCmd === 'stay') {
            if (!cancel('manual', { announce: true })) {
                sendChat('§b§lDodge §8» §7No dodge is pending.');
            }
        }
        else if (['on', 'enable', 'enabled', 'true'].includes(subCmd)) {
            applyConfig({ enabled: true });
            settingsLine();
        }
        else if (['off', 'disable', 'disabled', 'false'].includes(subCmd)) {
            applyConfig({ enabled: false });
            cancel('disabled', { announce: false });
            settingsLine();
        }
        else if (subCmd === 'delay') {
            if (args[2] === undefined) {
                settingsLine();
                sendChat('§7Tip: click §e[ Edit ]§7 or type §e/dodge delay <0-15>§7.');
            } else {
                applyConfig({ delaySeconds: args[2] });
                settingsLine();
            }
        }
        else if (subCmd === 'include') {
            const includeName = normalizeDodgeIncludeName(args[2]);
            const desired = onOffValue(args[3]);
            if (!includeName || desired === null) {
                sendChat('§b§lDodge §8» §7Usage: §e/dodge include <tagged|nicks|threats|all> on|off');
                return;
            }
            if (includeName === 'all') {
                applyPresetTransition(desired ? 'all_on' : 'custom', { allOff: !desired });
            } else {
                // Individual flag edit always lands in Custom mode. If we were
                // in All, restore the snapshot first so the unrelated flags
                // come back to their pre-All values, then overlay the change.
                const current = getSettings();
                const patch = { includePreset: 'custom', [includeName]: desired };
                if (current.includePreset === 'all_on' && customIncludeSnapshot) {
                    patch.taggedPlayers = customIncludeSnapshot.taggedPlayers;
                    patch.nickedPlayers = customIncludeSnapshot.nickedPlayers;
                    patch.statThreats = customIncludeSnapshot.statThreats;
                    patch[includeName] = desired;
                }
                applyConfig(patch);
                // Refresh the snapshot to mirror the new Custom state.
                const next = getSettings();
                customIncludeSnapshot = {
                    taggedPlayers: next.taggedPlayers,
                    nickedPlayers: next.nickedPlayers,
                    statThreats: next.statThreats
                };
            }
            settingsLine();
        }
        else if (subCmd === 'preset') {
            const preset = normalizePresetCommand(args[2]);
            if (!preset) {
                sendChat('§b§lDodge §8» §7Usage: §e/dodge preset <all|custom>');
                return;
            }
            applyPresetTransition(preset);
            settingsLine();
        }
        else if (subCmd === 'threat') {
            const metric = String(args[2] || '').toLowerCase();
            const value = Number(args[3]);
            if (!['fkdr', 'star', 'stars'].includes(metric) || !Number.isFinite(value) || value < 0) {
                sendChat('§b§lDodge §8» §7Usage: §e/dodge threat fkdr <number> §7or §e/dodge threat stars <number>');
                return;
            }
            if (metric === 'fkdr') {
                applyConfig({ minFkdr: value });
            } else {
                applyConfig({ minStars: value });
            }
            settingsLine();
        }
        else if (subCmd === 'info') {
            sendChat('§b§lDodge §8» §7Preset §aAll§7 locks the include row. Use §eCustom§7 to edit individual include options.');
            sendChat('§b§lDodge §8» §7Yellow controls edit values or perform actions. Stat threats use the FKDR/stars thresholds shown in the controller.');
        }
        else if (subCmd === 'status') {
            settingsLine();
        }
        else {
            sendChat('§cUsage: /dodge on|off|preset <all|custom>|delay <s>|include <tagged|nicks|threats|all> on|off|threat fkdr/stars <n>|cancel|status');
        }
    }

    function getDebugState() {
        const remaining = estimateSecondsRemaining();
        const settings = getSettings();
        return {
            autoDodge: isEnabled() ? `on/${getDelaySeconds()}s` : 'off',
            autoDodgeFilters: [
                settings.taggedPlayers && 'tagged',
                settings.nickedPlayers && 'nicks',
                settings.statThreats && `stats(fkdr>=${settings.minFkdr.toFixed(2)},stars>=${Math.round(settings.minStars)})`
            ].filter(Boolean).join(',') || 'none',
            autoDodgePreset: settings.includePreset,
            pendingDodge: pendingDodge ? pendingDodge.player : 'none',
            pregameSecondsLeft: remaining === null ? 'unknown' : Math.max(0, Math.round(remaining))
        };
    }

    return {
        maybeSchedule,
        cancel,
        reset,
        noteScoreboard,
        onGameStart,
        handleCommand,
        getDebugState
    };
}

module.exports = { createAutoDodger };
