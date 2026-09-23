'use strict';

// Chat rendering for setting presets. Self-contained like the encounters
// card: no collectors, no shared render helpers, so tests drive it with a
// fake client.

const { sendChat, sendActionBar } = require('../../features/minecraft_chat.js');
const { createFeatureStatus } = require('../../features/feature_panel.js');
const chat = require('../../features/chat_controller.js');

function profilePanel(client, title) {
    const panel = createFeatureStatus({ client, sendChat, title, section: 'system' });
    panel.open();
    return panel;
}

// Friendly names for the settings a preset carries, so a diff reads as
// "Auto Dodge: on -> off" rather than "autoDodgeEnabled: true -> false".
const SETTING_LABELS = {
    autoDodgeEnabled: 'Auto Dodge',
    autoDodgeDelaySeconds: 'Dodge Delay',
    autoDodgeTaggedPlayers: 'Dodge Tagged',
    autoDodgeNickedPlayers: 'Dodge Nicked',
    autoDodgeStatThreats: 'Dodge Stat Threats',
    autoDodgeIncludePreset: 'Dodge Preset',
    autoDodgeMinFkdr: 'Dodge Min FKDR',
    autoDodgeMinStars: 'Dodge Min Stars',
    shareTagsAuto: 'Auto Share',
    shareTagsFancy: 'Fancy Share',
    shareTagsIncludeTagged: 'Share Tagged',
    shareTagsIncludeNicks: 'Share Nicks',
    shareTagsIncludeThreats: 'Share Threats',
    shareTagsDestination: 'Share To',
    shareTagsGroupByTeam: 'Share By Team',
    tabStatsEnabled: 'Tab Stats',
    tabStatsBedwarsMode: 'Tab BW Mode',
    tabStatsSkywarsMode: 'Tab SW Mode',
    tabStatsShowKillRatio: 'Tab Kill Ratio',
    tabStatsShowWinRatio: 'Tab Win Ratio',
    nametagOverlayEnabled: 'Nametags',
    nametagStarBracketsEnabled: 'Nametag Star Brackets',
    nametagTagDisplayMode: 'Nametag Tag Style',
    nametagScope: 'Nametag Scope',
    nametagSourcePriority: 'Nametag Source',
    nametagTeammatesEnabled: 'Nametags: Teammates',
    nametagThreatsEnabled: 'Nametags: Threats',
    nametagOthersEnabled: 'Nametags: Others',
    lobbyChatStatsEnabled: 'Lobby Chat Stats',
    lobbyChatStatsMentionEnabled: 'Chat Stats on Mention',
    lobbyChatStatsDmEnabled: 'Chat Stats on DM',
    lobbyChatStatsTriggerEnabled: 'Chat Stats Triggers',
    chatTriggers: 'Chat Trigger List',
    pregameChatStatsEnabled: 'Pregame Chat Stats',
    partyOverviewEnabled: 'Party Overview',
    socialOverlayAddsEnabled: 'Use Overlay',
    overlayAutoAddOutsideGamesOnly: 'Overlay Adds Outside Games',
    overlayAutoClearOnGameStartEnd: 'Overlay Auto Clear',
    autoScanOnGameStart: 'Auto Scan',
    autoSkinDenickEnabled: 'Skin Denick',
    autoStatsDenickEnabled: 'Stats Denick',
    denickChatAnnouncementsEnabled: 'Denick Announcements',
    denickPartyAnnounceEnabled: 'Denick Party Announce',
    showDenickedRealIgn: 'Show Real IGN',
    denickRealIgnNametags: 'Real IGN Nametags',
    denickRealSkin: 'Real Skin for Known Nicks',
    denickRealIgnChat: 'Real IGN in Chat',
    friendAliasEnabled: 'Custom Names',
    friendAliasNametags: 'Custom Names in Nametags',
    friendAliasChat: 'Custom Names in Chat',
    friendAliasTabStats: 'Custom Names in Tab Stats',
    friendAliasShowRealIgn: 'Show Real IGN After Custom Name',
    showTagsInTabStats: 'Tags in Tab',
    sessionTrackingEnabled: 'Session Tracking',
    gameRecapEnabled: 'Game Recap',
    sessionBoundaryMinutes: 'Session Inactivity Boundary',
    sessionRetention: 'Session History Retention',
    sessionRecapStyle: 'Session Recap Style',
    sessionRecapFields: 'Session Recap Fields',
    sessionBedwarsFields: 'BedWars Session Fields',
    sessionSkywarsFields: 'SkyWars Session Fields',
    sessionDuelsFields: 'Duels Session Fields',
    sessionGoalWins: 'Session Win Goal',
    sessionGoalFinals: 'Session Finals Goal',
    sessionGoalGames: 'Session Game Goal',
    sessionGoalMinutes: 'Session Time Goal',
    scanMode: 'Scan Mode',
    minFkdr: 'Threat Min FKDR',
    minStars: 'Threat Min Stars',
    minSkywarsKdr: 'Threat Min SW KDR',
    minSkywarsWlr: 'Threat Min SW WLR',
    minSkywarsLevel: 'Threat Min SW Level',
    countTags: 'Threats Count Tags'
};

function settingLabel(key) {
    return SETTING_LABELS[key] || key;
}

function formatValue(value) {
    if (value === true) return '§aon';
    if (value === false) return '§coff';
    if (value === undefined || value === null) return '§8unset';
    return `§f${value}`;
}

function modeSuffix(preset) {
    return preset.boundModes.length ? ` §8(${preset.boundModes.join(', ')})` : '';
}

function renderPresetList(client, presets, activeName, { commandRoot = '/preset' } = {}) {
    const panel = profilePanel(client, 'Profiles');

    if (!presets.length) {
        sendChat(client, '§7No presets yet. Set your options how you like, then:');
        sendChat(client, '§8  §f/preset save friends');
        panel.close();
        return false;
    }

    presets.forEach((preset) => {
        const active = preset.name === activeName;
        const missing = Array.isArray(preset.missingSettingKeys) ? preset.missingSettingKeys : [];
        sendChat(client, {
            text: `${active ? '§a▶ ' : '§8  '}§f${preset.label}${modeSuffix(preset)} §8— ${Object.keys(preset.settings).length} settings`,
            hoverEvent: {
                action: 'show_text',
                value: `${preset.description ? `§7${preset.description}\n` : ''}§7${commandRoot} load ${preset.name}\n§8${commandRoot} diff ${preset.name} §7to preview.`
            }
        });
        if (missing.length) {
            sendChat(client, `! ${preset.label} needs configuration: ${missing.map(settingLabel).join(', ')}. Applying it leaves those settings unchanged.`);
        }
    });

    panel.rail();
    panel.row([
        ...panel.action('Save current', `${commandRoot} save `, 'Type a profile name.', { action: 'suggest_command' }),
        chat.text(' '), ...panel.action('Compare', `${commandRoot} diff `, 'Type a profile to compare.', { action: 'suggest_command' }),
        chat.text(' '), ...panel.action('Bind', `${commandRoot} bind `, 'Type a profile and game mode.', { action: 'suggest_command' })
    ]);
    panel.close();
    return true;
}

// Shared by /preset diff and the post-apply summary.
function renderDiffRows(client, changes, { limit = 20 } = {}) {
    changes.slice(0, limit).forEach((change) => {
        sendChat(client, `§7${settingLabel(change.key)}§8: ${formatValue(change.from)} §8→ ${formatValue(change.to)}`);
    });
    if (changes.length > limit) {
        sendChat(client, `§8…and ${changes.length - limit} more`);
    }
}

function renderPresetDiff(client, preset, changes, { commandRoot = '/preset' } = {}) {
    const panel = profilePanel(client, `Profile Diff: ${preset.label}`);

    if (!changes.length) {
        sendChat(client, '§7Nothing would change — this preset is already applied.');
        panel.close();
        return false;
    }

    renderDiffRows(client, changes);
    const missing = Array.isArray(preset?.missingSettingKeys) ? preset.missingSettingKeys : [];
    if (missing.length) {
        sendChat(client, `§eNeeds configuration: §f${missing.map(settingLabel).join(', ')}§7. These stay unchanged when applied.`);
    }
    panel.rail();
    sendChat(client, {
        text: `§7Apply ${changes.length} change${changes.length === 1 ? '' : 's'}: §f${commandRoot} load ${preset.name}`
    });
    panel.close();
    return true;
}

function renderPresetApplied(client, preset, { changes = [], skipped = [], reason = null } = {}) {
    const via = reason === 'mode_bind' ? ' §8(auto)' : '';
    sendActionBar(client, `§a✓ §fProfile: §b${preset.label} §8• §f${changes.length} updated`);
    sendChat(client, `§8[§bProfile§8] §aApplied §f${preset.label}${via}§7 — §f${changes.length}§7 setting${changes.length === 1 ? '' : 's'} changed.`);
    renderDiffRows(client, changes, { limit: 6 });
    if (skipped.length) {
        sendChat(client, `§8[§bPreset§8] §e${skipped.length} setting${skipped.length === 1 ? '' : 's'} skipped §7— locked on your plan.`);
    }
    const missing = Array.isArray(preset?.missingSettingKeys) ? preset.missingSettingKeys : [];
    if (missing.length) {
        sendChat(client, `§8[§bProfile§8] §eNeeds configuration: §f${missing.map(settingLabel).join(', ')}§7. Left unchanged.`);
    }
}

// `/preset` with no arguments: what is active and whether it has drifted.
function renderPresetStatus(client, preset, changes, { commandRoot = '/preset' } = {}) {
    if (!preset) {
        sendChat(client, `§8[§bProfile§8] §7No profile active. §f${commandRoot} list§7 to see available profiles.`);
        return false;
    }
    const panel = profilePanel(client, `Profile: ${preset.label}`);
    if (preset.boundModes.length) panel.row([chat.text(`Bound: ${preset.boundModes.join(', ')}`)]);

    if (!changes.length) {
        sendChat(client, '§7Your current settings match this preset.');
    } else {
        sendChat(client, `§e${changes.length} unsaved change${changes.length === 1 ? '' : 's'} since it was applied:`);
        renderDiffRows(client, changes, { limit: 8 });
        panel.rail();
        sendChat(client, {
            text: `§7Save current settings: §f${commandRoot} save ${preset.name}`
        });
    }
    const missing = Array.isArray(preset?.missingSettingKeys) ? preset.missingSettingKeys : [];
    if (missing.length) {
        sendChat(client, `§eNeeds configuration: §f${missing.map(settingLabel).join(', ')}§7. These settings are not managed by this profile.`);
    }
    panel.close();
    return true;
}

module.exports = {
    renderPresetList,
    renderPresetDiff,
    renderPresetApplied,
    renderPresetStatus,
    renderDiffRows,
    settingLabel,
    formatValue,
    SETTING_LABELS
};
