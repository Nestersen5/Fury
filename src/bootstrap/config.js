'use strict';

// Bootstrap config loaders extracted from proxy.js. Owns parsing + defaults
// for keys, scan thresholds, chat triggers, and feature flags from disk.
//
// Feature-flag assignment intentionally stays in proxy.js because the live
// proxy holds ~26 module-level `let` bindings that cannot be reassigned from
// another module (see PROXY_SPLIT_PLAN.md Danger #2). This module is the
// pure-parsing half: it normalizes settings and returns a fully-defaulted
// snapshot object that proxy.js then applies to its locals. The defaults
// here are the single source of truth for what each feature flag falls back
// to when the JSON is missing the field.

function createConfigLoader(deps) {
    const {
        loadKeys,
        saveKeys,
        loadScanSettings,
        saveScanSettings,
        loadFeatureSettings,
        saveFeatureSettings,
        normalizeTabStatsModeSetting,
        normalizeShareDestination,
        normalizeNametagScope,
        normalizeNametagSourcePriority,
        normalizeNametagTagDisplayMode,
        normalizeNametagStat,
        clampDodgeDelay,
        chatTriggerManager,
        state,
        logger = console
    } = deps;

    function loadKeysConfig() {
        return loadKeys();
    }

    function saveKeysConfig(keys) {
        saveKeys(keys);
    }

    function loadScanConfig() {
        try {
            const loaded = loadScanSettings();
            state.scanMode = loaded.scanMode || 'threats';
            state.threatConfig.minFkdr = loaded.minFkdr ?? 3.0;
            state.threatConfig.minStars = loaded.minStars ?? 1000;
            state.threatConfig.minSkywarsKdr = loaded.minSkywarsKdr ?? 2.0;
            state.threatConfig.minSkywarsWlr = loaded.minSkywarsWlr ?? 1.0;
            state.threatConfig.minSkywarsLevel = loaded.minSkywarsLevel ?? 10;
            state.threatConfig.countTags = true;
        } catch (e) {
        }
    }

    function saveScanConfig() {
        try {
            saveScanSettings({
                scanMode: state.scanMode,
                minFkdr: state.threatConfig.minFkdr,
                minStars: state.threatConfig.minStars,
                minSkywarsKdr: state.threatConfig.minSkywarsKdr,
                minSkywarsWlr: state.threatConfig.minSkywarsWlr,
                minSkywarsLevel: state.threatConfig.minSkywarsLevel,
                countTags: state.threatConfig.countTags
            });
        } catch (e) {
        }
    }

    function loadChatTriggerConfig() {
        chatTriggerManager.load();
    }

    // Parses + normalizes the on-disk feature config into a fully-defaulted
    // snapshot. The caller is responsible for assigning into its own state.
    // Side effect: if `options.resetAutoGamblerSession` is set and Auto Gambler
    // was persisted as enabled, this rewrites the stored config to disable it
    // (so a crash mid-game doesn't have the bot auto-resume on next launch).
    function parseFeatureConfig(options = {}) {
        const features = loadFeatureSettings();
        const bool = (key, fallback) => features[key] !== undefined ? Boolean(features[key]) : fallback;
        const nametagStat = (value, fallback) => typeof normalizeNametagStat === 'function' ? normalizeNametagStat(value, fallback) : fallback;
        let autoGamblerEnabled;
        if (options.resetAutoGamblerSession) {
            autoGamblerEnabled = false;
            if (features.autoGamblerEnabled) {
                try {
                    saveFeatureSettings({ ...features, autoGamblerEnabled: false });
                } catch (e) {
                    logger.error('[FEATURES ERROR] Failed to reset Auto Gambler on startup:', e.message);
                }
            }
        } else {
            autoGamblerEnabled = bool('autoGamblerEnabled', false);
        }

        const dodgeThreshold = (key, fallback) => {
            const number = Number(features[key]);
            return Number.isFinite(number) ? Math.max(0, number) : fallback;
        };
        const enderDustThreshold = (value, fallback = 250) => {
            const number = Number(value);
            return Number.isFinite(number) ? Math.min(300, Math.max(1, Math.round(number))) : fallback;
        };
        const dodgePreset = String(features.autoDodgeIncludePreset || '').trim().toLowerCase();

        return {
            chatPrefixAccentHex: String(features.chatPrefixAccentHex || '#e5b35d'),
            accentBedwarsEventLabelsEnabled: bool('accentBedwarsEventLabelsEnabled', true),
            bedwarsSidebarTeamColorsEnabled: bool('bedwarsSidebarTeamColorsEnabled', true),
            tabStatsEnabled: Boolean(features.tabStatsEnabled),
            autoScanOnGameStart: true,
            autoGamblerEnabled,
            autoSkinDenickEnabled: bool('autoSkinDenickEnabled', true),
            autoStatsDenickEnabled: bool('autoStatsDenickEnabled', true),
            denickChatAnnouncementsEnabled: bool('denickChatAnnouncementsEnabled', true),
            denickPartyAnnounceEnabled: bool('denickPartyAnnounceEnabled', false),
            socialOverlayAddsEnabled: bool('socialOverlayAddsEnabled', true),
            lobbyChatStatsEnabled: bool('lobbyChatStatsEnabled', true),
            lobbyChatStatsMentionEnabled: bool('lobbyChatStatsMentionEnabled', true),
            lobbyChatStatsDmEnabled: bool('lobbyChatStatsDmEnabled', true),
            lobbyChatStatsTriggerEnabled: bool('lobbyChatStatsTriggerEnabled', true),
            pregameChatStatsEnabled: bool('pregameChatStatsEnabled', true),
            queueTimeEnabled: bool('queueTimeEnabled', true),
            queueTimePartyChatEnabled: bool('queueTimePartyChatEnabled', false),
            partySplitWarningsEnabled: bool('partySplitWarningsEnabled', true),
            autoDodgeEnabled: bool('autoDodgeEnabled', false),
            autoDodgeDelaySeconds: clampDodgeDelay(features.autoDodgeDelaySeconds),
            autoDodgeTaggedPlayers: bool('autoDodgeTaggedPlayers', true),
            autoDodgeNickedPlayers: bool('autoDodgeNickedPlayers', false),
            autoDodgeStatThreats: bool('autoDodgeStatThreats', false),
            autoDodgeIncludePreset: ['all_on', 'custom'].includes(dodgePreset)
                ? dodgePreset
                : 'custom',
            autoDodgeMinFkdr: dodgeThreshold('autoDodgeMinFkdr', 3),
            autoDodgeMinStars: dodgeThreshold('autoDodgeMinStars', 1000),
            enderDustReminderEnabled: bool('enderDustReminderEnabled', false),
            enderDustReminderThreshold: enderDustThreshold(features.enderDustReminderThreshold),
            enderDustReminderLastReading: features.enderDustReminderLastReading || null,
            slumberDailyRewardsReminderEnabled: bool('slumberDailyRewardsReminderEnabled', false),
            gamblerGeorgeReminderEnabled: bool('gamblerGeorgeReminderEnabled', true),
            gamblerGeorgeReminderState: features.gamblerGeorgeReminderState || null,
            partyOverviewEnabled: true,
            overlayAutoAddOutsideGamesOnly: true,
            overlayAutoClearOnGameStartEnd: true,
            showDenickedRealIgn: bool('showDenickedRealIgn', true),
            showTagsInTabStats: bool('showTagsInTabStats', true),
            nametagOverlayEnabled: bool('nametagOverlayEnabled', false),
            nametagStarBracketsEnabled: bool('nametagStarBracketsEnabled', true),
            nametagTagDisplayMode: typeof normalizeNametagTagDisplayMode === 'function'
                ? normalizeNametagTagDisplayMode(features.nametagTagDisplayMode, 'acronyms')
                : 'acronyms',
            apiKillSwitchEnabled: bool('apiKillSwitchEnabled', false),
            proxyHealthWarningsEnabled: bool('proxyHealthWarningsEnabled', true),
            denickRealIgnNametags: bool('denickRealIgnNametags', false),
            denickRealSkin: bool('denickRealSkin', false),
            denickRealIgnChat: bool('denickRealIgnChat', false),
            friendAliasEnabled: bool('friendAliasEnabled', true),
            friendAliasNametags: bool('friendAliasNametags', false),
            friendAliasChat: bool('friendAliasChat', false),
            friendAliasTabStats: bool('friendAliasTabStats', false),
            friendAliasShowRealIgn: bool('friendAliasShowRealIgn', true),
            sessionTrackingEnabled: bool('sessionTrackingEnabled', true),
            gameRecapEnabled: bool('gameRecapEnabled', true),
            replayDetailsEnabled: bool('replayDetailsEnabled', true),
            sessionBoundaryMinutes: 30,
            sessionRetention: 0,
            sessionRecapStyle: features.sessionRecapStyle || 'detailed',
            sessionRecapFields: Array.isArray(features.sessionRecapFields) ? features.sessionRecapFields.slice() : ['result', 'duration', 'game_stats', 'session_totals', 'goals'],
            sessionBedwarsFields: Array.isArray(features.sessionBedwarsFields) ? features.sessionBedwarsFields.slice() : ['wins', 'losses', 'finals', 'finalDeaths', 'beds', 'bedsLost', 'kills', 'deaths', 'wlr', 'fkdr', 'kdr', 'bblr', 'games', 'stars'],
            sessionSkywarsFields: Array.isArray(features.sessionSkywarsFields) ? features.sessionSkywarsFields.slice() : ['wins', 'losses', 'kills', 'deaths', 'wlr', 'kdr', 'games', 'assists'],
            sessionDuelsFields: Array.isArray(features.sessionDuelsFields) ? features.sessionDuelsFields.slice() : ['wins', 'losses', 'kills', 'deaths', 'wlr', 'kdr'],
            sessionGoalWins: Math.max(0, Number(features.sessionGoalWins) || 0),
            sessionGoalFinals: Math.max(0, Number(features.sessionGoalFinals) || 0),
            sessionGoalGames: Math.max(0, Number(features.sessionGoalGames) || 0),
            sessionGoalMinutes: Math.max(0, Number(features.sessionGoalMinutes) || 0),
            shareTagsAuto: bool('shareTagsAuto', false),
            shareTagsFancy: bool('shareTagsFancy', false),
            shareTagsColorLocal: bool('shareTagsColorLocal', true),
            shareTagsGroupByTeam: true,
            shareTagsIncludeTagged: bool('shareTagsIncludeTagged', true),
            shareTagsIncludeNicks: bool('shareTagsIncludeNicks', true),
            shareTagsIncludeThreats: bool('shareTagsIncludeThreats', true),
            shareTagsDestination: typeof normalizeShareDestination === 'function'
                ? normalizeShareDestination(features.shareTagsDestination, 'party')
                : 'party',
            tabStatsBedwarsMode: typeof normalizeTabStatsModeSetting === 'function'
                ? normalizeTabStatsModeSetting(features.tabStatsBedwarsMode, 'auto')
                : 'auto',
            tabStatsSkywarsMode: typeof normalizeTabStatsModeSetting === 'function'
                ? normalizeTabStatsModeSetting(features.tabStatsSkywarsMode, 'auto')
                : 'auto',
            tabStatsShowKillRatio: bool('tabStatsShowKillRatio', true),
            tabStatsShowWinRatio: bool('tabStatsShowWinRatio', true),
            tabStatsBedwarsFields: Array.isArray(features.tabStatsBedwarsFields)
                ? features.tabStatsBedwarsFields.slice()
                : ['name', 'stars', 'fkdr', 'wlr', 'tags'],
            tabStatsSkywarsFields: Array.isArray(features.tabStatsSkywarsFields)
                ? features.tabStatsSkywarsFields.slice()
                : ['stars', 'name', 'wlr', 'kdr', 'tags'],
            tabStatsLabelStyle: ['compact', 'full', 'value'].includes(features.tabStatsLabelStyle)
                ? features.tabStatsLabelStyle
                : 'compact',
            nametagScope: typeof normalizeNametagScope === 'function'
                ? normalizeNametagScope(features.nametagScope, 'enemies')
                : 'enemies',
            nametagSourcePriority: typeof normalizeNametagSourcePriority === 'function'
                ? normalizeNametagSourcePriority(features.nametagSourcePriority, 'urchin')
                : 'urchin',
            nametagTeammatesEnabled: bool('nametagTeammatesEnabled', false),
            nametagTeammatesPrefix: nametagStat(features.nametagTeammatesPrefix, 'none'),
            nametagTeammatesPrefixFallback: nametagStat(features.nametagTeammatesPrefixFallback, 'none'),
            nametagTeammatesSuffix: nametagStat(features.nametagTeammatesSuffix, 'fkdr'),
            nametagTeammatesSuffixFallback: nametagStat(features.nametagTeammatesSuffixFallback, 'none'),
            nametagThreatsEnabled: bool('nametagThreatsEnabled', true),
            nametagThreatsPrefix: nametagStat(features.nametagThreatsPrefix, 'tag'),
            nametagThreatsPrefixFallback: nametagStat(features.nametagThreatsPrefixFallback, 'star'),
            nametagThreatsSuffix: nametagStat(features.nametagThreatsSuffix, 'fkdr'),
            nametagThreatsSuffixFallback: nametagStat(features.nametagThreatsSuffixFallback, 'none'),
            nametagOthersEnabled: bool('nametagOthersEnabled', false),
            nametagOthersPrefix: nametagStat(features.nametagOthersPrefix, 'none'),
            nametagOthersPrefixFallback: nametagStat(features.nametagOthersPrefixFallback, 'none'),
            nametagOthersSuffix: nametagStat(features.nametagOthersSuffix, 'kdr'),
            nametagOthersSuffixFallback: nametagStat(features.nametagOthersSuffixFallback, 'none')
        };
    }

    function saveFeatureConfig(snapshot) {
        try {
            saveFeatureSettings(snapshot);
        } catch (e) {
            logger.error('[FEATURES ERROR] Failed to save feature config:', e.message);
        }
    }

    return {
        loadKeysConfig,
        saveKeysConfig,
        loadScanConfig,
        saveScanConfig,
        loadChatTriggerConfig,
        parseFeatureConfig,
        saveFeatureConfig
    };
}

module.exports = { createConfigLoader };
