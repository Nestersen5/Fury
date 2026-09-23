const fs = require('fs');
const { dataPath } = require('./src/storage/runtimePaths.js');
const {
    NAMETAG_STAT_TYPES,
    normalizeNametagStat: normalizeNametagStatType,
    normalizeNametagFallback,
    normalizeNametagTagDisplayMode
} = require('./src/overlay/nametags.js');
const {
    SESSION_DEFAULTS,
    normalizeSessionFeatureSettings
} = require('./src/session/settings.js');
const { normalizeGamblerGeorgeReminderState } = require('./features/gambler_george_reminder.js');

const paths = {
    keys: dataPath('statmod_key.txt'),
    scan: dataPath('scan_config.json'),
    features: dataPath('features_config.json'),
    chatTriggers: dataPath('chat_triggers.json'),
    server: dataPath('server_config.json')
};

function normalizeChoice(value, allowed, fallback) {
    const clean = String(value || '').trim().toLowerCase();
    return allowed.includes(clean) ? clean : fallback;
}

function normalizeTabStatsModeSetting(value, fallback = 'auto') {
    return normalizeChoice(value, ['on', 'off', 'auto'], fallback);
}

// Release baseline: the settings used by the built-in Normal Sweaty
// (Recommended) profile. Runtime config files may override these per user.
const DEFAULT_CHAT_PREFIX_ACCENT_HEX = '#a66bea';

function normalizeChatPrefixAccentHex(value, fallback = DEFAULT_CHAT_PREFIX_ACCENT_HEX) {
    const clean = String(value || '').trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(clean) ? clean : fallback;
}

const TAB_STATS_FIELDS = ['name', 'stars', 'tags', 'fkdr', 'kdr', 'wlr', 'finals', 'wins', 'ws', 'ping'];
const TAB_STATS_DEFAULT_FIELDS = {
    BEDWARS: ['name', 'stars', 'fkdr', 'tags', 'ws'],
    SKYWARS: ['stars', 'name', 'wlr', 'kdr', 'tags']
};

function normalizeTabStatsFields(value, mode = 'BEDWARS') {
    const normalizedMode = mode === 'SKYWARS' ? 'SKYWARS' : 'BEDWARS';
    const unavailable = normalizedMode === 'BEDWARS' ? ['kdr'] : ['fkdr', 'finals'];
    if (!Array.isArray(value) || value.length === 0) return TAB_STATS_DEFAULT_FIELDS[normalizedMode].slice();
    const clean = value
        .map(field => String(field || '').trim().toLowerCase())
        .filter((field, index, list) => TAB_STATS_FIELDS.includes(field) && !unavailable.includes(field) && list.indexOf(field) === index);
    if (!clean.includes('name')) clean.unshift('name');
    return clean.length ? clean : TAB_STATS_DEFAULT_FIELDS[normalizedMode].slice();
}

function normalizeTabStatsLabelStyle(value, fallback = 'compact') {
    return normalizeChoice(value, ['compact', 'full', 'value'], fallback);
}

function normalizeShareDestination(value, fallback = 'party') {
    return normalizeChoice(value, ['party', 'all'], fallback);
}

function normalizeNametagScope(value, fallback = 'enemies') {
    return normalizeChoice(value, ['enemies', 'teammates', 'everyone'], fallback);
}

function normalizeNametagSourcePriority(value, fallback = 'urchin') {
    return normalizeChoice(value, ['urchin', 'seraph'], fallback);
}

const NAMETAG_STAT_CHOICES = NAMETAG_STAT_TYPES;
function normalizeNametagStat(value, fallback = 'none') {
    return normalizeNametagStatType(value, fallback);
}

function normalizeDodgeDelaySeconds(value, fallback = 10) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds)) return fallback;
    return Math.min(15, Math.max(0, Math.round(seconds)));
}

function normalizeDodgeThreshold(value, fallback = 0) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(0, number);
}

function normalizeEnderDustReminderThreshold(value, fallback = 250) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(300, Math.max(1, Math.round(number)));
}

function normalizeEnderDustReminderLastReading(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const enderDust = Number(value.enderDust);
    if (!Number.isFinite(enderDust) || enderDust < 0 || enderDust > 300) return null;
    const lastCheckedAt = Number(value.lastCheckedAt);
    const profileName = String(value.profileName || '').trim().slice(0, 16);
    return {
        enderDust: Math.round(enderDust),
        capacity: 300,
        profileName: profileName || 'Player data',
        lastCheckedAt: Number.isFinite(lastCheckedAt) && lastCheckedAt > 0 ? Math.round(lastCheckedAt) : 0
    };
}

function normalizeDodgeIncludePreset(value, fallback = 'custom') {
    const preset = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
    if (preset === 'all_off') return 'custom';
    if (['all_on', 'custom'].includes(preset)) return preset;
    return fallback;
}

const defaults = {
    keys: { hypixel: '', urchin: '', urchinadmin: '', aurora: '', seraph: '' },
    keyMeta: { hypixelUpdatedAt: '' },
    scan: { scanMode: 'threats', minFkdr: 2, minStars: 400, minSkywarsKdr: 1, minSkywarsWlr: 0.4, minSkywarsLevel: 15, countTags: true },
    features: {
        chatPrefixAccentHex: DEFAULT_CHAT_PREFIX_ACCENT_HEX,
        accentBedwarsEventLabelsEnabled: true,
        bedwarsSidebarTeamColorsEnabled: true,
        tabStatsEnabled: true,
        autoScanOnGameStart: true,
        autoGamblerEnabled: false,
        autoSkinDenickEnabled: true,
        autoStatsDenickEnabled: true,
        denickChatAnnouncementsEnabled: true,
        denickPartyAnnounceEnabled: true,
        socialOverlayAddsEnabled: false,
        lobbyChatStatsEnabled: true,
        lobbyChatStatsMentionEnabled: true,
        lobbyChatStatsDmEnabled: true,
        lobbyChatStatsTriggerEnabled: false,
        pregameChatStatsEnabled: true,
        queueTimeEnabled: true,
        queueTimePartyChatEnabled: false,
        partySplitWarningsEnabled: true,
        autoDodgeEnabled: true,
        autoDodgeDelaySeconds: 10,
        autoDodgeTaggedPlayers: true,
        autoDodgeNickedPlayers: false,
        autoDodgeStatThreats: false,
        autoDodgeIncludePreset: 'custom',
        autoDodgeMinFkdr: 3,
        autoDodgeMinStars: 700,
        enderDustReminderEnabled: true,
        enderDustReminderThreshold: 250,
        enderDustReminderLastReading: null,
        slumberDailyRewardsReminderEnabled: true,
        gamblerGeorgeReminderEnabled: true,
        gamblerGeorgeReminderState: null,
        partyOverviewEnabled: true,
        overlayAutoAddOutsideGamesOnly: true,
        overlayAutoClearOnGameStartEnd: true,
        showDenickedRealIgn: true,
        showTagsInTabStats: true,
        nametagOverlayEnabled: true,
        nametagStarBracketsEnabled: true,
        nametagTagDisplayMode: 'acronyms',
        apiKillSwitchEnabled: false,
        proxyHealthWarningsEnabled: false,
        denickRealIgnNametags: true,
        denickRealSkin: true,
        denickRealIgnChat: true,
        friendAliasEnabled: true,
        friendAliasNametags: false,
        friendAliasChat: false,
        friendAliasTabStats: false,
        friendAliasShowRealIgn: true,
        sessionTrackingEnabled: true,
        gameRecapEnabled: false,
        replayDetailsEnabled: true,
        ...SESSION_DEFAULTS,
        sessionBoundaryMinutes: 30,
        sessionRetention: 0,
        sessionBedwarsFields: SESSION_DEFAULTS.sessionBedwarsFields.slice(),
        sessionSkywarsFields: SESSION_DEFAULTS.sessionSkywarsFields.slice(),
        sessionDuelsFields: SESSION_DEFAULTS.sessionDuelsFields.slice(),
        sessionGoalGames: 2,
        shareTagsAuto: true,
        shareTagsFancy: false,
        shareTagsColorLocal: true,
        shareTagsIncludeTagged: true,
        shareTagsIncludeNicks: true,
        shareTagsIncludeThreats: false,
        shareTagsDestination: 'party',
        shareTagsGroupByTeam: true,
        tabStatsBedwarsMode: 'auto',
        tabStatsSkywarsMode: 'auto',
        tabStatsShowKillRatio: true,
        tabStatsShowWinRatio: true,
        tabStatsBedwarsFields: TAB_STATS_DEFAULT_FIELDS.BEDWARS,
        tabStatsSkywarsFields: TAB_STATS_DEFAULT_FIELDS.SKYWARS,
        tabStatsLabelStyle: 'compact',
        nametagScope: 'enemies',
        nametagSourcePriority: 'urchin',
        nametagTeammatesEnabled: true,
        nametagTeammatesPrefix: 'none',
        nametagTeammatesPrefixFallback: 'none',
        nametagTeammatesSuffix: 'ping',
        nametagTeammatesSuffixFallback: 'fkdr',
        nametagThreatsEnabled: true,
        nametagThreatsPrefix: 'tag',
        nametagThreatsPrefixFallback: 'star',
        nametagThreatsSuffix: 'fkdr',
        nametagThreatsSuffixFallback: 'mfkdr',
        nametagOthersEnabled: true,
        nametagOthersPrefix: 'none',
        nametagOthersPrefixFallback: 'none',
        nametagOthersSuffix: 'ping',
        nametagOthersSuffixFallback: 'fkdr'
    },
    chatTriggers: { triggers: ['3/4', '2/4', '1/4', '1/2', '1/3', '2/3'] },
    server: {
        proxyDirectPort: 25565,
        proxyFailoverPort: 25568,
        proxyDirectHost: 'mc.hypixel.net',
        proxyFailoverHost: 'hypixel.fast',
        healthPort: 3100
    }
};

function readJson(file, fallback) {
    try {
        if (!fs.existsSync(file)) return fallback;
        return { ...fallback, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch (e) {
        return fallback;
    }
}

function writeJson(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function formatKeyTimestamp(date = new Date()) {
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function valueAfterColon(line = '') {
    const index = line.indexOf(':');
    return index === -1 ? '' : line.slice(index + 1).trim();
}

function loadKeyState() {
    if (!fs.existsSync(paths.keys)) {
        return { keys: { ...defaults.keys }, keyMeta: { ...defaults.keyMeta } };
    }

    const raw = fs.readFileSync(paths.keys, 'utf8');
    const lines = raw.split(/\r?\n/);
    const byLabel = {};
    lines.forEach((line) => {
        const cleaned = line.trim();
        if (!cleaned || cleaned.startsWith('#') || !cleaned.includes(':')) return;
        const [label] = cleaned.split(':', 1);
        byLabel[label.trim().toLowerCase()] = valueAfterColon(cleaned);
    });

    if (Object.keys(byLabel).length > 0) {
        return {
            keys: {
                hypixel: byLabel['hypixel api key']
                    || byLabel.hypixel
                    || byLabel['hypixel reserve api key']
                    || byLabel['hypixel secondary api key']
                    || byLabel['hypixel api key 2']
                    || byLabel.hypixelsecondary
                    || byLabel.hypixel2
                    || '',
                urchin: byLabel['urchin api key'] || byLabel.urchin || '',
                urchinadmin: byLabel['urchin admin api key'] || byLabel.urchinadmin || '',
                aurora: byLabel['aurora api key'] || byLabel.aurora || '',
                seraph: byLabel['seraph api key'] || byLabel.seraph || ''
            },
            keyMeta: {
                hypixelUpdatedAt: (byLabel['hypixel api key updated'] || byLabel['hypixel updated at']) === 'Never'
                    ? ''
                    : (byLabel['hypixel api key updated'] || byLabel['hypixel updated at'] || '')
            }
        };
    }

    return {
        keys: {
            hypixel: lines[0]?.trim() || '',
            urchin: lines[1]?.trim() || '',
            urchinadmin: '',
            aurora: lines[2]?.trim() || '',
            seraph: lines[3]?.trim() || ''
        },
        keyMeta: { ...defaults.keyMeta }
    };
}

function loadKeys() {
    return loadKeyState().keys;
}

function loadKeyMeta() {
    return loadKeyState().keyMeta;
}

function saveKeys(keys) {
    const current = loadKeyState();
    // Merge over the currently saved keys so callers that omit a field preserve
    // it instead of resetting it to the default. Passing an explicit '' still
    // clears a key.
    const next = { ...defaults.keys, ...current.keys, ...(keys || {}) };
    const keyMeta = { ...defaults.keyMeta, ...current.keyMeta };
    if (next.hypixel !== current.keys.hypixel || (next.hypixel && !keyMeta.hypixelUpdatedAt)) {
        keyMeta.hypixelUpdatedAt = formatKeyTimestamp();
    }
    if (!next.hypixel) keyMeta.hypixelUpdatedAt = '';

    fs.writeFileSync(
        paths.keys,
        [
            '# Fury API keys',
            '# Edit values after the colon. Keep the labels in place.',
            `Hypixel API key: ${next.hypixel}`,
            `Hypixel API key updated: ${keyMeta.hypixelUpdatedAt || 'Never'}`,
            `Urchin API key: ${next.urchin}`,
            `Urchin admin API key: ${next.urchinadmin}`,
            `Aurora API key: ${next.aurora}`,
            `Seraph API key: ${next.seraph}`,
            ''
        ].join('\n'),
        'utf8'
    );
}

function loadScanSettings() {
    const loaded = readJson(paths.scan, defaults.scan);
    const mode = loaded.scanMode || defaults.scan.scanMode;
    return {
        scanMode: ['all', 'threats', 'off'].includes(mode) ? mode : defaults.scan.scanMode,
        minFkdr: Number.isFinite(Number(loaded.minFkdr)) ? Number(loaded.minFkdr) : defaults.scan.minFkdr,
        minStars: Number.isFinite(Number(loaded.minStars)) ? Number(loaded.minStars) : defaults.scan.minStars,
        minSkywarsKdr: Number.isFinite(Number(loaded.minSkywarsKdr)) ? Number(loaded.minSkywarsKdr) : defaults.scan.minSkywarsKdr,
        minSkywarsWlr: Number.isFinite(Number(loaded.minSkywarsWlr)) ? Number(loaded.minSkywarsWlr) : defaults.scan.minSkywarsWlr,
        minSkywarsLevel: Number.isFinite(Number(loaded.minSkywarsLevel)) ? Number(loaded.minSkywarsLevel) : defaults.scan.minSkywarsLevel,
        countTags: true
    };
}

function saveScanSettings(scan) {
    const next = { ...defaults.scan, ...(scan || {}) };
    if (!['all', 'threats', 'off'].includes(next.scanMode)) next.scanMode = defaults.scan.scanMode;
    writeJson(paths.scan, {
        scanMode: next.scanMode,
        minFkdr: Number(next.minFkdr),
        minStars: Number(next.minStars),
        minSkywarsKdr: Number(next.minSkywarsKdr),
        minSkywarsWlr: Number(next.minSkywarsWlr),
        minSkywarsLevel: Number(next.minSkywarsLevel),
        countTags: true
    });
}

function loadFeatureSettings() {
    const savedFeatures = readJson(paths.features, defaults.features);
    const features = {
        ...defaults.features,
        ...savedFeatures
    };
    // Social event sources now follow the single Use Overlay switch.
    delete features.overlayMentionAddsEnabled;
    delete features.overlayDmAddsEnabled;
    delete features.overlayPartyInviteAddsEnabled;
    // Ignore retired party-arrival dodge settings in existing installations.
    delete features.autoPartyDodgeEnabled;
    delete features.autoPartyDodgeDebugEnabled;
    delete features.autoPartyDodgeWindowMs;
    // The former single BedWars appearance switch controlled both options.
    // Preserve that choice for existing installs until each new control is
    // explicitly saved on its own.
    if (savedFeatures.bedwarsSidebarTeamColorsEnabled === undefined) {
        features.bedwarsSidebarTeamColorsEnabled = Boolean(features.accentBedwarsEventLabelsEnabled);
    }
    features.autoDodgeDelaySeconds = normalizeDodgeDelaySeconds(
        features.autoDodgeDelaySeconds,
        defaults.features.autoDodgeDelaySeconds
    );
    features.autoDodgeMinFkdr = normalizeDodgeThreshold(
        features.autoDodgeMinFkdr,
        defaults.features.autoDodgeMinFkdr
    );
    features.autoDodgeMinStars = normalizeDodgeThreshold(
        features.autoDodgeMinStars,
        defaults.features.autoDodgeMinStars
    );
    features.enderDustReminderThreshold = normalizeEnderDustReminderThreshold(
        features.enderDustReminderThreshold,
        defaults.features.enderDustReminderThreshold
    );
    features.enderDustReminderLastReading = normalizeEnderDustReminderLastReading(features.enderDustReminderLastReading);
    features.gamblerGeorgeReminderState = normalizeGamblerGeorgeReminderState(features.gamblerGeorgeReminderState);
    features.autoDodgeIncludePreset = normalizeDodgeIncludePreset(
        features.autoDodgeIncludePreset,
        defaults.features.autoDodgeIncludePreset
    );
    features.tabStatsBedwarsFields = normalizeTabStatsFields(features.tabStatsBedwarsFields, 'BEDWARS');
    features.tabStatsSkywarsFields = normalizeTabStatsFields(features.tabStatsSkywarsFields, 'SKYWARS');
    features.tabStatsLabelStyle = normalizeTabStatsLabelStyle(features.tabStatsLabelStyle, defaults.features.tabStatsLabelStyle);
    features.chatPrefixAccentHex = normalizeChatPrefixAccentHex(
        features.chatPrefixAccentHex,
        defaults.features.chatPrefixAccentHex
    );
    Object.assign(features, normalizeSessionFeatureSettings(features));
    [
        ['nametagTeammatesPrefix', 'nametagTeammatesPrefixFallback'],
        ['nametagTeammatesSuffix', 'nametagTeammatesSuffixFallback'],
        ['nametagThreatsPrefix', 'nametagThreatsPrefixFallback'],
        ['nametagThreatsSuffix', 'nametagThreatsSuffixFallback'],
        ['nametagOthersPrefix', 'nametagOthersPrefixFallback'],
        ['nametagOthersSuffix', 'nametagOthersSuffixFallback']
    ].forEach(([primaryKey, fallbackKey]) => {
        features[primaryKey] = normalizeNametagStat(features[primaryKey], defaults.features[primaryKey]);
        features[fallbackKey] = normalizeNametagFallback(
            features[primaryKey],
            normalizeNametagStat(features[fallbackKey], defaults.features[fallbackKey])
        );
    });
    features.autoScanOnGameStart = true;
    return features;
}

function saveFeatureSettings(features) {
    const current = readJson(paths.features, defaults.features);
    const next = { ...defaults.features, ...current, ...(features || {}) };
    const hasIncomingSidebarSetting = Object.prototype.hasOwnProperty.call(features || {}, 'bedwarsSidebarTeamColorsEnabled');
    const hasStoredSidebarSetting = Object.prototype.hasOwnProperty.call(current || {}, 'bedwarsSidebarTeamColorsEnabled');
    const bedwarsSidebarTeamColorsEnabled = hasIncomingSidebarSetting
        ? Boolean(features.bedwarsSidebarTeamColorsEnabled)
        : hasStoredSidebarSetting
            ? Boolean(current.bedwarsSidebarTeamColorsEnabled)
            : Boolean(next.accentBedwarsEventLabelsEnabled);
    writeJson(paths.features, {
        chatPrefixAccentHex: normalizeChatPrefixAccentHex(
            next.chatPrefixAccentHex,
            defaults.features.chatPrefixAccentHex
        ),
        accentBedwarsEventLabelsEnabled: next.accentBedwarsEventLabelsEnabled !== undefined
            ? Boolean(next.accentBedwarsEventLabelsEnabled)
            : defaults.features.accentBedwarsEventLabelsEnabled,
        bedwarsSidebarTeamColorsEnabled,
        tabStatsEnabled: Boolean(next.tabStatsEnabled),
        autoScanOnGameStart: true,
        autoGamblerEnabled: next.autoGamblerEnabled !== undefined
            ? Boolean(next.autoGamblerEnabled)
            : defaults.features.autoGamblerEnabled,
        autoSkinDenickEnabled: Boolean(next.autoSkinDenickEnabled),
        autoStatsDenickEnabled: Boolean(next.autoStatsDenickEnabled),
        denickChatAnnouncementsEnabled: Boolean(next.denickChatAnnouncementsEnabled),
        denickPartyAnnounceEnabled: Boolean(next.denickPartyAnnounceEnabled),
        socialOverlayAddsEnabled: Boolean(next.socialOverlayAddsEnabled),
        lobbyChatStatsEnabled: Boolean(next.lobbyChatStatsEnabled),
        lobbyChatStatsMentionEnabled: Boolean(next.lobbyChatStatsMentionEnabled),
        lobbyChatStatsDmEnabled: Boolean(next.lobbyChatStatsDmEnabled),
        lobbyChatStatsTriggerEnabled: Boolean(next.lobbyChatStatsTriggerEnabled),
        pregameChatStatsEnabled: Boolean(next.pregameChatStatsEnabled),
        queueTimeEnabled: next.queueTimeEnabled !== undefined ? Boolean(next.queueTimeEnabled) : defaults.features.queueTimeEnabled,
        queueTimePartyChatEnabled: Boolean(next.queueTimePartyChatEnabled),
        partySplitWarningsEnabled: next.partySplitWarningsEnabled !== undefined
            ? Boolean(next.partySplitWarningsEnabled)
            : defaults.features.partySplitWarningsEnabled,
        autoDodgeEnabled: next.autoDodgeEnabled !== undefined
            ? Boolean(next.autoDodgeEnabled)
            : defaults.features.autoDodgeEnabled,
        autoDodgeDelaySeconds: normalizeDodgeDelaySeconds(
            next.autoDodgeDelaySeconds,
            defaults.features.autoDodgeDelaySeconds
        ),
        autoDodgeTaggedPlayers: next.autoDodgeTaggedPlayers !== undefined
            ? Boolean(next.autoDodgeTaggedPlayers)
            : defaults.features.autoDodgeTaggedPlayers,
        autoDodgeNickedPlayers: next.autoDodgeNickedPlayers !== undefined
            ? Boolean(next.autoDodgeNickedPlayers)
            : defaults.features.autoDodgeNickedPlayers,
        autoDodgeStatThreats: next.autoDodgeStatThreats !== undefined
            ? Boolean(next.autoDodgeStatThreats)
            : defaults.features.autoDodgeStatThreats,
        autoDodgeIncludePreset: normalizeDodgeIncludePreset(
            next.autoDodgeIncludePreset,
            defaults.features.autoDodgeIncludePreset
        ),
        autoDodgeMinFkdr: normalizeDodgeThreshold(
            next.autoDodgeMinFkdr,
            defaults.features.autoDodgeMinFkdr
        ),
        autoDodgeMinStars: normalizeDodgeThreshold(
            next.autoDodgeMinStars,
            defaults.features.autoDodgeMinStars
        ),
        enderDustReminderEnabled: next.enderDustReminderEnabled !== undefined
            ? Boolean(next.enderDustReminderEnabled)
            : defaults.features.enderDustReminderEnabled,
        enderDustReminderThreshold: normalizeEnderDustReminderThreshold(
            next.enderDustReminderThreshold,
            defaults.features.enderDustReminderThreshold
        ),
        enderDustReminderLastReading: normalizeEnderDustReminderLastReading(next.enderDustReminderLastReading),
        slumberDailyRewardsReminderEnabled: next.slumberDailyRewardsReminderEnabled !== undefined
            ? Boolean(next.slumberDailyRewardsReminderEnabled)
            : defaults.features.slumberDailyRewardsReminderEnabled,
        gamblerGeorgeReminderEnabled: next.gamblerGeorgeReminderEnabled !== undefined
            ? Boolean(next.gamblerGeorgeReminderEnabled)
            : defaults.features.gamblerGeorgeReminderEnabled,
        gamblerGeorgeReminderState: normalizeGamblerGeorgeReminderState(next.gamblerGeorgeReminderState),
        partyOverviewEnabled: next.partyOverviewEnabled !== undefined
            ? Boolean(next.partyOverviewEnabled)
            : defaults.features.partyOverviewEnabled,
        overlayAutoAddOutsideGamesOnly: true,
        overlayAutoClearOnGameStartEnd: true,
        showDenickedRealIgn: Boolean(next.showDenickedRealIgn),
        showTagsInTabStats: Boolean(next.showTagsInTabStats),
        nametagOverlayEnabled: next.nametagOverlayEnabled !== undefined
            ? Boolean(next.nametagOverlayEnabled)
            : defaults.features.nametagOverlayEnabled,
        nametagStarBracketsEnabled: next.nametagStarBracketsEnabled !== undefined
            ? Boolean(next.nametagStarBracketsEnabled)
            : defaults.features.nametagStarBracketsEnabled,
        nametagTagDisplayMode: normalizeNametagTagDisplayMode(
            next.nametagTagDisplayMode,
            defaults.features.nametagTagDisplayMode
        ),
        apiKillSwitchEnabled: next.apiKillSwitchEnabled !== undefined
            ? Boolean(next.apiKillSwitchEnabled)
            : defaults.features.apiKillSwitchEnabled,
        proxyHealthWarningsEnabled: next.proxyHealthWarningsEnabled !== undefined
            ? Boolean(next.proxyHealthWarningsEnabled)
            : defaults.features.proxyHealthWarningsEnabled,
        // Local session tracking. These MUST be listed here: this writer is an
        // explicit whitelist, so a key missing from it is silently dropped on
        // every save and then springs back to its default on the next
        // reloadConfig() — which is exactly what made /session recap off
        // revert by itself.
        denickRealIgnNametags: next.denickRealIgnNametags !== undefined
            ? Boolean(next.denickRealIgnNametags)
            : defaults.features.denickRealIgnNametags,
        denickRealSkin: next.denickRealSkin !== undefined
            ? Boolean(next.denickRealSkin)
            : defaults.features.denickRealSkin,
        denickRealIgnChat: next.denickRealIgnChat !== undefined
            ? Boolean(next.denickRealIgnChat)
            : defaults.features.denickRealIgnChat,
        friendAliasEnabled: next.friendAliasEnabled !== undefined
            ? Boolean(next.friendAliasEnabled)
            : defaults.features.friendAliasEnabled,
        friendAliasNametags: next.friendAliasNametags !== undefined
            ? Boolean(next.friendAliasNametags)
            : defaults.features.friendAliasNametags,
        friendAliasChat: next.friendAliasChat !== undefined
            ? Boolean(next.friendAliasChat)
            : defaults.features.friendAliasChat,
        friendAliasTabStats: next.friendAliasTabStats !== undefined
            ? Boolean(next.friendAliasTabStats)
            : defaults.features.friendAliasTabStats,
        friendAliasShowRealIgn: next.friendAliasShowRealIgn !== undefined
            ? Boolean(next.friendAliasShowRealIgn)
            : defaults.features.friendAliasShowRealIgn,
        sessionTrackingEnabled: next.sessionTrackingEnabled !== undefined
            ? Boolean(next.sessionTrackingEnabled)
            : defaults.features.sessionTrackingEnabled,
        gameRecapEnabled: next.gameRecapEnabled !== undefined
            ? Boolean(next.gameRecapEnabled)
            : defaults.features.gameRecapEnabled,
        replayDetailsEnabled: next.replayDetailsEnabled !== undefined
            ? Boolean(next.replayDetailsEnabled)
            : defaults.features.replayDetailsEnabled,
        ...normalizeSessionFeatureSettings(next),
        shareTagsAuto: next.shareTagsAuto !== undefined
            ? Boolean(next.shareTagsAuto)
            : defaults.features.shareTagsAuto,
        shareTagsFancy: next.shareTagsFancy !== undefined
            ? Boolean(next.shareTagsFancy)
            : defaults.features.shareTagsFancy,
        shareTagsColorLocal: next.shareTagsColorLocal !== undefined
            ? Boolean(next.shareTagsColorLocal)
            : defaults.features.shareTagsColorLocal,
        shareTagsIncludeTagged: next.shareTagsIncludeTagged !== undefined
            ? Boolean(next.shareTagsIncludeTagged)
            : defaults.features.shareTagsIncludeTagged,
        shareTagsIncludeNicks: next.shareTagsIncludeNicks !== undefined
            ? Boolean(next.shareTagsIncludeNicks)
            : defaults.features.shareTagsIncludeNicks,
        shareTagsIncludeThreats: next.shareTagsIncludeThreats !== undefined
            ? Boolean(next.shareTagsIncludeThreats)
            : defaults.features.shareTagsIncludeThreats,
        shareTagsGroupByTeam: true,
        shareTagsDestination: normalizeShareDestination(
            next.shareTagsDestination,
            defaults.features.shareTagsDestination
        ),
        tabStatsBedwarsMode: normalizeTabStatsModeSetting(
            next.tabStatsBedwarsMode,
            defaults.features.tabStatsBedwarsMode
        ),
        tabStatsSkywarsMode: normalizeTabStatsModeSetting(
            next.tabStatsSkywarsMode,
            defaults.features.tabStatsSkywarsMode
        ),
        tabStatsShowKillRatio: next.tabStatsShowKillRatio !== undefined
            ? Boolean(next.tabStatsShowKillRatio)
            : defaults.features.tabStatsShowKillRatio,
        tabStatsShowWinRatio: next.tabStatsShowWinRatio !== undefined
            ? Boolean(next.tabStatsShowWinRatio)
            : defaults.features.tabStatsShowWinRatio,
        tabStatsBedwarsFields: normalizeTabStatsFields(next.tabStatsBedwarsFields, 'BEDWARS'),
        tabStatsSkywarsFields: normalizeTabStatsFields(next.tabStatsSkywarsFields, 'SKYWARS'),
        tabStatsLabelStyle: normalizeTabStatsLabelStyle(next.tabStatsLabelStyle, defaults.features.tabStatsLabelStyle),
        nametagScope: normalizeNametagScope(
            next.nametagScope,
            defaults.features.nametagScope
        ),
        nametagSourcePriority: normalizeNametagSourcePriority(
            next.nametagSourcePriority,
            defaults.features.nametagSourcePriority
        ),
        // Per-audience nametag config. Each audience (teammates / enemy threats
        // / everyone else) toggles independently and picks a prefix + suffix stat,
        // with an optional fallback for each slot when the primary has no data.
        nametagTeammatesEnabled: next.nametagTeammatesEnabled !== undefined
            ? Boolean(next.nametagTeammatesEnabled)
            : defaults.features.nametagTeammatesEnabled,
        nametagTeammatesPrefix: normalizeNametagStat(next.nametagTeammatesPrefix, defaults.features.nametagTeammatesPrefix),
        nametagTeammatesPrefixFallback: normalizeNametagFallback(next.nametagTeammatesPrefix, next.nametagTeammatesPrefixFallback),
        nametagTeammatesSuffix: normalizeNametagStat(next.nametagTeammatesSuffix, defaults.features.nametagTeammatesSuffix),
        nametagTeammatesSuffixFallback: normalizeNametagFallback(next.nametagTeammatesSuffix, next.nametagTeammatesSuffixFallback),
        nametagThreatsEnabled: next.nametagThreatsEnabled !== undefined
            ? Boolean(next.nametagThreatsEnabled)
            : defaults.features.nametagThreatsEnabled,
        nametagThreatsPrefix: normalizeNametagStat(next.nametagThreatsPrefix, defaults.features.nametagThreatsPrefix),
        nametagThreatsPrefixFallback: normalizeNametagFallback(next.nametagThreatsPrefix, next.nametagThreatsPrefixFallback),
        nametagThreatsSuffix: normalizeNametagStat(next.nametagThreatsSuffix, defaults.features.nametagThreatsSuffix),
        nametagThreatsSuffixFallback: normalizeNametagFallback(next.nametagThreatsSuffix, next.nametagThreatsSuffixFallback),
        nametagOthersEnabled: next.nametagOthersEnabled !== undefined
            ? Boolean(next.nametagOthersEnabled)
            : defaults.features.nametagOthersEnabled,
        nametagOthersPrefix: normalizeNametagStat(next.nametagOthersPrefix, defaults.features.nametagOthersPrefix),
        nametagOthersPrefixFallback: normalizeNametagFallback(next.nametagOthersPrefix, next.nametagOthersPrefixFallback),
        nametagOthersSuffix: normalizeNametagStat(next.nametagOthersSuffix, defaults.features.nametagOthersSuffix),
        nametagOthersSuffixFallback: normalizeNametagFallback(next.nametagOthersSuffix, next.nametagOthersSuffixFallback)
    });
}

function normalizeChatTriggers(triggers) {
    const raw = Array.isArray(triggers)
        ? triggers
        : Array.isArray(triggers?.triggers)
            ? triggers.triggers
            : [];
    const seen = new Set();
    return raw
        .map(value => String(value || '').replace(/\s+/g, ' ').trim())
        .filter(value => value.length > 0 && value.length <= 24)
        .filter(value => {
            const key = value.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function loadChatTriggerSettings() {
    const loaded = readJson(paths.chatTriggers, defaults.chatTriggers);
    const triggers = normalizeChatTriggers(loaded.triggers);
    return {
        triggers: triggers.length ? triggers : defaults.chatTriggers.triggers.slice()
    };
}

function saveChatTriggerSettings(settings) {
    const triggers = normalizeChatTriggers(settings?.triggers ?? settings);
    writeJson(paths.chatTriggers, { triggers });
    return loadChatTriggerSettings();
}

function loadServerSettings() {
    const loaded = readJson(paths.server, defaults.server);
    return {
        proxyDirectPort: Number(loaded.proxyDirectPort) || defaults.server.proxyDirectPort,
        proxyFailoverPort: Number(loaded.proxyFailoverPort) || defaults.server.proxyFailoverPort,
        proxyDirectHost: loaded.proxyDirectHost || defaults.server.proxyDirectHost,
        proxyFailoverHost: loaded.proxyFailoverHost || defaults.server.proxyFailoverHost,
        healthPort: Number(loaded.healthPort) || defaults.server.healthPort
    };
}

function saveServerSettings(server) {
    const input = server || {};
    const next = {
        proxyDirectPort: input.proxyDirectPort,
        proxyFailoverPort: input.proxyFailoverPort,
        proxyDirectHost: input.proxyDirectHost,
        proxyFailoverHost: input.proxyFailoverHost,
        healthPort: input.healthPort
    };
    writeJson(paths.server, { ...defaults.server, ...next });
}

function loadAllSettings() {
    return {
        keys: loadKeys(),
        keyMeta: loadKeyMeta(),
        scan: loadScanSettings(),
        features: loadFeatureSettings(),
        chatTriggers: loadChatTriggerSettings(),
        server: loadServerSettings()
    };
}

function saveAllSettings(settings) {
    if (settings.keys) saveKeys(settings.keys);
    if (settings.scan) saveScanSettings(settings.scan);
    if (settings.features) saveFeatureSettings(settings.features);
    if (settings.chatTriggers) saveChatTriggerSettings(settings.chatTriggers);
    if (settings.server) saveServerSettings(settings.server);
    return loadAllSettings();
}

module.exports = {
    paths,
    defaults,
    DEFAULT_CHAT_PREFIX_ACCENT_HEX,
    normalizeChatPrefixAccentHex,
    normalizeTabStatsModeSetting,
    normalizeTabStatsFields,
    normalizeTabStatsLabelStyle,
    normalizeShareDestination,
    normalizeNametagScope,
    normalizeNametagStat,
    normalizeNametagSourcePriority,
    normalizeNametagTagDisplayMode,
    normalizeSessionFeatureSettings,
    NAMETAG_STAT_CHOICES,
    formatKeyTimestamp,
    loadKeys,
    loadKeyMeta,
    saveKeys,
    loadScanSettings,
    saveScanSettings,
    loadFeatureSettings,
    saveFeatureSettings,
    loadChatTriggerSettings,
    saveChatTriggerSettings,
    loadServerSettings,
    saveServerSettings,
    loadAllSettings,
    saveAllSettings
};
