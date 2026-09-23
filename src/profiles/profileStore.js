'use strict';

// Profiles: named, portable bundles of safe feature/scan/chat preferences you
// can swap in one command ("competitive" vs "playing with friends").
//
// The store deliberately knows nothing about how settings are read or written.
// It owns presets.json, the allowlist, and the diffing; the host passes in a
// `readCurrentSettings()` / `applySettings()` pair. That keeps the whole
// module testable without booting the proxy, and means applying a preset goes
// through proxy.js's existing config pipeline (live
// re-apply, launcher sync) instead of poking 70 module-level bindings.
//
// The original /preset command remains an alias for compatibility; /profile
// is the primary first-class user-facing surface.

const { JsonFileCache } = require('../storage/json_file_cache.js');
const { defaults } = require('../../app_config.js');

const STORE_VERSION = 4;
const DEFAULT_MAX_PRESETS = 25;
const DEFAULT_SAVE_DELAY_MS = 1000;
const MAX_NAME_LENGTH = 24;
const MAX_DESCRIPTION_LENGTH = 180;
const MAX_TAGS = 6;

// Settings a preset is allowed to carry, by the config file they belong to.
// This is an allowlist, not a blanket snapshot: a preset is a *preference*
// bundle and must never be able to smuggle API keys, feature state, or a
// safety switch into a user-editable JSON file.
const PRESET_SETTING_KEYS = {
    features: [
        // General scanning and display
        'tabStatsEnabled', 'autoScanOnGameStart',
        // Auto dodge
        'autoDodgeEnabled', 'autoDodgeDelaySeconds', 'autoDodgeTaggedPlayers',
        'autoDodgeNickedPlayers', 'autoDodgeStatThreats', 'autoDodgeIncludePreset',
        'autoDodgeMinFkdr', 'autoDodgeMinStars',
        // Reminders
        'enderDustReminderEnabled', 'enderDustReminderThreshold',
        'slumberDailyRewardsReminderEnabled', 'gamblerGeorgeReminderEnabled',
        // Share
        'shareTagsAuto', 'shareTagsFancy', 'shareTagsColorLocal', 'shareTagsIncludeTagged',
        'shareTagsIncludeNicks', 'shareTagsIncludeThreats', 'shareTagsDestination',
        'shareTagsGroupByTeam',
        // Tab stats
        'tabStatsEnabled', 'tabStatsBedwarsMode', 'tabStatsSkywarsMode',
        'tabStatsShowKillRatio', 'tabStatsShowWinRatio',
        'tabStatsBedwarsFields', 'tabStatsSkywarsFields', 'tabStatsLabelStyle',
        // Nametags
        'nametagOverlayEnabled', 'nametagStarBracketsEnabled', 'nametagTagDisplayMode', 'nametagScope', 'nametagSourcePriority',
        'nametagTeammatesEnabled', 'nametagThreatsEnabled', 'nametagOthersEnabled',
        'nametagTeammatesPrefix', 'nametagTeammatesPrefixFallback',
        'nametagTeammatesSuffix', 'nametagTeammatesSuffixFallback',
        'nametagThreatsPrefix', 'nametagThreatsPrefixFallback',
        'nametagThreatsSuffix', 'nametagThreatsSuffixFallback',
        'nametagOthersPrefix', 'nametagOthersPrefixFallback',
        'nametagOthersSuffix', 'nametagOthersSuffixFallback',
        // Chat stats
        'lobbyChatStatsEnabled', 'lobbyChatStatsMentionEnabled', 'lobbyChatStatsDmEnabled',
        'lobbyChatStatsTriggerEnabled', 'pregameChatStatsEnabled',
        'accentBedwarsEventLabelsEnabled',
        // Manual party intelligence
        'partyOverviewEnabled',
        // Overlay adds
        'socialOverlayAddsEnabled',
        'overlayAutoAddOutsideGamesOnly',
        'overlayAutoClearOnGameStartEnd',
        // Denick
        'autoSkinDenickEnabled', 'autoStatsDenickEnabled',
        'denickChatAnnouncementsEnabled', 'denickPartyAnnounceEnabled',
        'showDenickedRealIgn', 'showTagsInTabStats', 'denickRealIgnNametags', 'denickRealSkin', 'denickRealIgnChat',
        'friendAliasEnabled', 'friendAliasNametags', 'friendAliasChat', 'friendAliasTabStats', 'friendAliasShowRealIgn',
        // Session tracking
        'sessionTrackingEnabled', 'gameRecapEnabled',
        'sessionBoundaryMinutes', 'sessionRetention', 'sessionRecapStyle', 'sessionRecapFields',
        'sessionBedwarsFields', 'sessionSkywarsFields', 'sessionDuelsFields',
        'sessionGoalWins', 'sessionGoalFinals', 'sessionGoalGames', 'sessionGoalMinutes',
        // Misc client-side settings intentionally stay global.
    ],
    scan: [
        'scanMode', 'minFkdr', 'minStars',
        'minSkywarsKdr', 'minSkywarsWlr', 'minSkywarsLevel'
    ],
    chatTriggers: ['chatTriggers']
};

// Excluded on purpose, and why:
//   keys/*, apiKillSwitchEnabled  — secrets and a safety switch
//   proxyHealthWarningsEnabled — API plumbing
//   autoGamblerEnabled — deliberately force-reset at startup; a preset would fight that
const EXCLUDED_KEYS = new Set([
    'apiKillSwitchEnabled',
    'proxyHealthWarningsEnabled',
    'autoGamblerEnabled',
    'autoPartyDodgeEnabled', 'autoPartyDodgeWindowMs',
    // Warning preferences stay global when switching playstyle profiles.
    'partySplitWarningsEnabled'
]);

const ALL_PRESET_KEYS = [...new Set([
    ...PRESET_SETTING_KEYS.features,
    ...PRESET_SETTING_KEYS.scan,
    ...PRESET_SETTING_KEYS.chatTriggers
])];

const PROFILE_SETTING_LABELS = {
    tabStatsEnabled: 'Tab stats',
    nametagOverlayEnabled: 'Name tags',
    nametagStarBracketsEnabled: 'Name tag star brackets',
    nametagTagDisplayMode: 'Name tag tag style',
    autoDodgeEnabled: 'Auto Dodge',
    shareTagsAuto: 'Auto Share',
    autoSkinDenickEnabled: 'Skin denick',
    autoStatsDenickEnabled: 'Stats denick',
    socialOverlayAddsEnabled: 'Use Overlay',
    lobbyChatStatsEnabled: 'Lobby chat stats',
    pregameChatStatsEnabled: 'Pregame chat stats',
    accentBedwarsEventLabelsEnabled: 'BedWars event text color',
    partyOverviewEnabled: 'Party overview',
    sessionTrackingEnabled: 'Session tracking',
    gameRecapEnabled: 'Game recap',
    enderDustReminderEnabled: 'Ender Dust reminder',
    slumberDailyRewardsReminderEnabled: 'Slumber reward reminder',
    gamblerGeorgeReminderEnabled: 'Gambler George reminder',
    scanMode: 'Scan mode',
    minFkdr: 'Minimum FKDR',
    minStars: 'Minimum stars',
    minSkywarsKdr: 'Minimum SkyWars KDR',
    minSkywarsWlr: 'Minimum SkyWars WLR',
    minSkywarsLevel: 'Minimum SkyWars level',
    autoDodgeDelaySeconds: 'Dodge delay',
    autoDodgeMinFkdr: 'Dodge FKDR threshold',
    autoDodgeMinStars: 'Dodge stars threshold',
    nametagScope: 'Name tag scope',
    shareTagsDestination: 'Share destination',
    tabStatsBedwarsFields: 'BedWars tab fields',
    tabStatsSkywarsFields: 'SkyWars tab fields',
    chatTriggers: 'Chat triggers'
};

const PROFILE_HIGHLIGHT_KEYS = [
    'tabStatsEnabled', 'nametagOverlayEnabled', 'autoDodgeEnabled',
    'shareTagsAuto', 'autoSkinDenickEnabled',
    'autoStatsDenickEnabled', 'socialOverlayAddsEnabled',
    'lobbyChatStatsEnabled', 'pregameChatStatsEnabled',
    'partyOverviewEnabled',
    'sessionTrackingEnabled', 'gameRecapEnabled',
    'enderDustReminderEnabled', 'slumberDailyRewardsReminderEnabled', 'gamblerGeorgeReminderEnabled'
];

function profileSettingLabel(key) {
    return PROFILE_SETTING_LABELS[key] || String(key || '').replace(/([A-Z])/g, ' $1').replace(/^./, char => char.toUpperCase());
}

function describeProfileSettings(rawSettings = {}) {
    const settings = filterPresetSettings(rawSettings);
    const hasPartyOverview = Object.prototype.hasOwnProperty.call(settings, 'partyOverviewEnabled');
    const enabled = PROFILE_HIGHLIGHT_KEYS
        .filter(key => settings[key] === true)
        .map(profileSettingLabel);
    const disabled = PROFILE_HIGHLIGHT_KEYS
        .filter(key => settings[key] === false)
        .map(profileSettingLabel);
    const configured = [];
    const scanMode = String(settings.scanMode || '').toLowerCase();
    if (scanMode) {
        if (scanMode === 'off') configured.push('Scanning off');
        else {
            const modeLabel = scanMode === 'all' ? 'All-player scanning' : 'Threat scanning';
            const thresholds = [];
            if (Number.isFinite(settings.minFkdr)) thresholds.push(`FKDR ≥ ${settings.minFkdr}`);
            if (Number.isFinite(settings.minStars)) thresholds.push(`stars ≥ ${settings.minStars}`);
            configured.push(`${modeLabel}${thresholds.length ? ` (${thresholds.join(', ')})` : ''}`);
        }
    }
    if (settings.autoDodgeEnabled) {
        const conditions = [
            settings.autoDodgeTaggedPlayers ? 'tagged' : '',
            settings.autoDodgeNickedPlayers ? 'nicked' : '',
            settings.autoDodgeStatThreats ? 'stat threats' : ''
        ].filter(Boolean);
        configured.push(`Dodges ${conditions.length ? conditions.join(', ') : 'configured players'}`);
    }
    if (settings.nametagOverlayEnabled) configured.push(`Name tags: ${settings.nametagScope || 'enemies'}`);
    if (settings.shareTagsAuto) configured.push(`Shares to ${settings.shareTagsDestination || 'party'}`);
    if (Array.isArray(settings.chatTriggers)) configured.push(`${settings.chatTriggers.length} chat trigger${settings.chatTriggers.length === 1 ? '' : 's'}`);
    return {
        enabled,
        disabled,
        configured,
        // Keep this separate from the general highlights. The launcher uses
        // it as an explicit profile-card state, so Party Overview cannot be
        // hidden by the shortened "Uses …" summary.
        partyOverview: hasPartyOverview ? settings.partyOverviewEnabled : null
    };
}

function namespaceForKey(key) {
    if (PRESET_SETTING_KEYS.features.includes(key)) return 'features';
    if (PRESET_SETTING_KEYS.scan.includes(key)) return 'scan';
    if (PRESET_SETTING_KEYS.chatTriggers.includes(key)) return 'chatTriggers';
    return null;
}

function normalizePresetName(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, MAX_NAME_LENGTH);
}

function cleanText(value, maxLength) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function cloneProfileValue(value) {
    return Array.isArray(value) ? value.slice() : value;
}

function isAllowedProfileValue(value) {
    const type = typeof value;
    if (type === 'boolean' || type === 'string' || (type === 'number' && Number.isFinite(value))) return true;
    // Profile settings currently contain simple field lists. Keeping nested
    // objects out means an imported profile can never smuggle unvalidated
    // config through this otherwise deliberately small allowlist.
    return Array.isArray(value) && value.every(item => {
        const itemType = typeof item;
        return itemType === 'string' || itemType === 'boolean' || (itemType === 'number' && Number.isFinite(item));
    });
}

// Keep only allowlisted keys with primitive values. Unknown keys are dropped
// silently rather than thrown on, so a preset written by a newer build still
// loads on an older one.
function filterPresetSettings(raw = {}) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    ALL_PRESET_KEYS.forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(raw, key)) return;
        if (EXCLUDED_KEYS.has(key)) return;
        const value = raw[key];
        if (isAllowedProfileValue(value)) out[key] = cloneProfileValue(value);
    });
    return out;
}

// Missing keys are intentionally left untouched when a profile is applied.
// This lets the launcher warn about older profiles instead of silently
// changing a newly introduced setting to an unsafe guess.
function missingProfileSettingKeys(rawSettings = {}) {
    const settings = rawSettings && typeof rawSettings === 'object' ? rawSettings : {};
    return ALL_PRESET_KEYS.filter(key => !Object.prototype.hasOwnProperty.call(settings, key));
}

function sameProfileValue(left, right) {
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left) && Array.isArray(right)
            && left.length === right.length
            && left.every((value, index) => value === right[index]);
    }
    return left === right;
}

function sameProfileSettings(left = {}, right = {}) {
    const leftSettings = filterPresetSettings(left);
    const rightSettings = filterPresetSettings(right);
    const keys = new Set([...Object.keys(leftSettings), ...Object.keys(rightSettings)]);
    return Array.from(keys).every(key => sameProfileValue(leftSettings[key], rightSettings[key]));
}

// Which allowlisted keys in `raw` were rejected — used to tell the user what
// a stale preset could not restore.
function unknownPresetKeys(raw = {}) {
    if (!raw || typeof raw !== 'object') return [];
    return Object.keys(raw).filter(key => !ALL_PRESET_KEYS.includes(key));
}

// [{ key, from, to }] for every setting the preset would change.
function diffSettings(current = {}, target = {}) {
    return Object.keys(target)
        .filter(key => {
            const from = current[key];
            const to = target[key];
            if (Array.isArray(from) || Array.isArray(to)) {
                return !Array.isArray(from) || !Array.isArray(to)
                    || from.length !== to.length
                    || from.some((value, index) => value !== to[index]);
            }
            return from !== to;
        })
        .map(key => ({ key, from: current[key], to: target[key] }))
        .sort((a, b) => a.key.localeCompare(b.key));
}

function splitByNamespace(settings = {}) {
    const out = { features: {}, scan: {}, chatTriggers: {} };
    Object.keys(settings).forEach((key) => {
        const namespace = namespaceForKey(key);
        if (namespace) out[namespace][key] = settings[key];
    });
    return out;
}

function normalizePreset(raw = {}, name = null) {
    const presetName = normalizePresetName(raw.name || name);
    if (!presetName) return null;
    return {
        id: cleanText(raw.id, 64) || presetName,
        name: presetName,
        label: typeof raw.label === 'string' && raw.label ? raw.label : presetName,
        description: cleanText(raw.description, MAX_DESCRIPTION_LENGTH),
        icon: cleanText(raw.icon, 12),
        tags: (Array.isArray(raw.tags) ? raw.tags : [])
            .map(tag => cleanText(tag, 20).toLowerCase())
            .filter((tag, index, items) => tag && items.indexOf(tag) === index)
            .slice(0, MAX_TAGS),
        source: raw.source === 'builtin' ? 'builtin' : 'user',
        readOnly: Boolean(raw.readOnly || raw.source === 'builtin'),
        boundModes: (Array.isArray(raw.boundModes) ? raw.boundModes : [])
            .map(mode => String(mode || '').toUpperCase())
            .filter(Boolean)
            .slice(0, 8),
        createdAt: Number(raw.createdAt) || 0,
        updatedAt: Number(raw.updatedAt) || 0,
        settings: filterPresetSettings(raw.settings)
    };
}

function defaultProfileSettings() {
    return filterPresetSettings({
        ...(defaults?.features || {}),
        ...(defaults?.scan || {}),
        chatTriggers: Array.isArray(defaults?.chatTriggers?.triggers) ? defaults.chatTriggers.triggers : []
    });
}

function completeProfileSettings(overrides = {}) {
    return filterPresetSettings({ ...defaultProfileSettings(), ...overrides });
}

// Curated, read-only profiles shipped with the proxy. Each is defined as an
// override of the current safe defaults so adding a newly allowlisted setting
// with a default keeps these profiles complete automatically.
function builtInProfiles() {
    const create = (name, label, description, tags, settings) => normalizePreset({
        id: `builtin:${name}`,
        name,
        label,
        description,
        tags,
        source: 'builtin',
        readOnly: true,
        settings: completeProfileSettings(settings)
    });
    return [
        create('super-sweaty', 'Super Sweaty', 'Perfect for winstreaking.', ['competitive', 'winstreak'], {
            autoDodgeEnabled: true,
            autoDodgeNickedPlayers: true,
            autoDodgeMinStars: 700,
            enderDustReminderEnabled: true,
            slumberDailyRewardsReminderEnabled: true,
            shareTagsAuto: true,
            tabStatsBedwarsFields: ['name', 'stars', 'fkdr', 'wlr', 'tags', 'ws'],
            nametagOverlayEnabled: true,
            nametagTeammatesEnabled: true,
            nametagOthersEnabled: true,
            nametagTeammatesSuffix: 'ping',
            nametagTeammatesSuffixFallback: 'fkdr',
            nametagThreatsSuffixFallback: 'mfkdr',
            nametagOthersSuffix: 'ping',
            nametagOthersSuffixFallback: 'fkdr',
            lobbyChatStatsTriggerEnabled: false,
            denickPartyAnnounceEnabled: true,
            denickRealIgnNametags: true,
            denickRealSkin: true,
            gameRecapEnabled: false,
            sessionBoundaryMinutes: 30,
            sessionRetention: 0,
            minStars: 400
        }),
        create('normal-sweaty', 'Normal Sweaty (Recommended)', 'A bit more chill than Super Sweaty; good for regular playing and winning.', ['competitive', 'everyday'], {
            autoDodgeEnabled: true,
            autoDodgeMinStars: 700,
            enderDustReminderEnabled: true,
            slumberDailyRewardsReminderEnabled: true,
            shareTagsAuto: true,
            shareTagsIncludeThreats: false,
            tabStatsBedwarsFields: ['name', 'stars', 'fkdr', 'tags', 'ws'],
            nametagOverlayEnabled: true,
            nametagTeammatesEnabled: true,
            nametagOthersEnabled: true,
            nametagTeammatesSuffix: 'ping',
            nametagTeammatesSuffixFallback: 'fkdr',
            nametagThreatsSuffixFallback: 'mfkdr',
            nametagOthersSuffix: 'ping',
            nametagOthersSuffixFallback: 'fkdr',
            lobbyChatStatsTriggerEnabled: false,
            denickPartyAnnounceEnabled: true,
            denickRealIgnNametags: true,
            denickRealSkin: true,
            denickRealIgnChat: true,
            gameRecapEnabled: false,
            sessionBoundaryMinutes: 30,
            sessionRetention: 0,
            sessionBedwarsFields: defaults.features.sessionBedwarsFields.slice(),
            sessionSkywarsFields: defaults.features.sessionSkywarsFields.slice(),
            sessionDuelsFields: defaults.features.sessionDuelsFields.slice(),
            sessionGoalGames: 2,
            socialOverlayAddsEnabled: false,
            minStars: 400
        }),
        create('chill', 'Chill & Friends', 'Good for casual matches with friends and minimal player information.', ['casual', 'friends'], {
            tabStatsEnabled: false,
            autoDodgeMinStars: 700,
            enderDustReminderEnabled: true,
            slumberDailyRewardsReminderEnabled: true,
            shareTagsIncludeTagged: false,
            shareTagsIncludeNicks: false,
            shareTagsIncludeThreats: false,
            tabStatsBedwarsFields: ['name', 'stars', 'fkdr', 'tags', 'ws'],
            nametagOverlayEnabled: true,
            nametagTeammatesEnabled: true,
            nametagOthersEnabled: true,
            nametagTeammatesSuffix: 'ping',
            nametagThreatsPrefix: 'none',
            nametagThreatsPrefixFallback: 'none',
            nametagThreatsSuffix: 'ping',
            nametagOthersSuffix: 'ping',
            lobbyChatStatsTriggerEnabled: false,
            autoSkinDenickEnabled: false,
            autoStatsDenickEnabled: false,
            denickChatAnnouncementsEnabled: false,
            denickPartyAnnounceEnabled: true,
            denickRealIgnNametags: true,
            denickRealSkin: true,
            gameRecapEnabled: false,
            sessionBoundaryMinutes: 30,
            sessionRetention: 0,
            scanMode: 'off',
            minStars: 400
        }),
        create('4v4-tickets-grinding', '4v4 Tickets Grinding', '4v4 ticket grinding with sniper and strong-player intel. Auto Gambler stays a separate global control.', ['4v4', 'tickets', 'quests'], {
            autoDodgeEnabled: true,
            autoDodgeNickedPlayers: true,
            autoDodgeMinFkdr: 2,
            autoDodgeMinStars: 500,
            enderDustReminderEnabled: true,
            slumberDailyRewardsReminderEnabled: true,
            shareTagsAuto: true,
            tabStatsBedwarsFields: ['name', 'stars', 'fkdr', 'tags', 'ws'],
            nametagOverlayEnabled: true,
            nametagTeammatesEnabled: true,
            nametagOthersEnabled: true,
            nametagTeammatesSuffixFallback: 'ping',
            nametagThreatsSuffixFallback: 'mfkdr',
            nametagOthersSuffix: 'ping',
            nametagOthersSuffixFallback: 'fkdr',
            lobbyChatStatsTriggerEnabled: false,
            denickPartyAnnounceEnabled: true,
            denickRealIgnNametags: true,
            denickRealSkin: true,
            sessionBoundaryMinutes: 30,
            sessionRetention: 0,
            minStars: 400
        })
    ].filter(Boolean);
}

function normalizeStore(raw, maxPresets, builtIns = []) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const builtinProfiles = (Array.isArray(builtIns) ? builtIns : [])
        .filter(profile => profile && typeof profile === 'object');
    const builtInNames = (Array.isArray(builtIns) ? builtIns : [])
        .map(profile => typeof profile === 'string' ? profile : profile?.name)
        .map(normalizePresetName)
        .filter(Boolean);
    const builtinsByName = new Map(builtinProfiles.map(profile => [profile.name, profile]));
    // A built-in can be removed from the user's profile list without touching
    // the packaged definition. Tombstones survive upgrades and keep deletion
    // local to this installation.
    const deletedBuiltins = Array.from(new Set((Array.isArray(source.deletedBuiltins) ? source.deletedBuiltins : [])
        .map(normalizePresetName)
        .filter(name => name && builtinsByName.has(name))));
    const deletedBuiltinNames = new Set(deletedBuiltins);
    // Accept both the array form and the legacy name-keyed object form. The
    // object branch must reject non-objects explicitly: Object.entries('nope')
    // happily enumerates the string's characters into junk presets.
    let rows = [];
    if (Array.isArray(source.presets)) {
        rows = source.presets;
    } else if (source.presets && typeof source.presets === 'object') {
        rows = Object.entries(source.presets).map(([name, value]) => ({
            ...(value && typeof value === 'object' ? value : {}),
            name
        }));
    }

    const reserved = new Set(builtInNames);
    const used = new Set();
    const renamed = new Map();
    const presets = [];
    rows.map(row => normalizePreset(row)).filter(Boolean).some((preset) => {
        // A pre-profile custom preset may have the same name as a newly added
        // built-in. Keep the player's work and make the collision explicit.
        let name = preset.name;
        if (reserved.has(name) || used.has(name)) {
            const builtin = builtinsByName.get(name);
            // A packaged profile may have started as a user-created profile.
            // Once the settings match exactly, the persisted copy is redundant
            // and the built-in takes over without showing a duplicate card.
            if (builtin && sameProfileSettings(preset.settings, builtin.settings)) return false;
            const originalName = name;
            const base = `${name}-custom`;
            name = base;
            let suffix = 2;
            while (reserved.has(name) || used.has(name)) name = `${base}-${suffix++}`;
            preset.name = name.slice(0, MAX_NAME_LENGTH);
            preset.id = preset.name;
            renamed.set(originalName, preset.name);
        }
        used.add(preset.name);
        presets.push(preset);
        return presets.length >= maxPresets;
    });

    const byName = new Map(presets.map(preset => [preset.name, preset]));
    const requestedActive = normalizePresetName(source.active);
    const active = renamed.get(requestedActive) || requestedActive;
    const visibleBuiltinNames = builtInNames.filter(name => !deletedBuiltinNames.has(name));
    const knownNames = new Set([...byName.keys(), ...visibleBuiltinNames]);
    const rawApplied = source.lastApplied && typeof source.lastApplied === 'object' ? source.lastApplied : {};
    const requestedLastAppliedName = normalizePresetName(rawApplied.name || active);
    const lastAppliedName = renamed.get(requestedLastAppliedName) || requestedLastAppliedName;
    return {
        version: STORE_VERSION,
        active: knownNames.has(active) ? active : null,
        lastApplied: knownNames.has(lastAppliedName) && Number(rawApplied.at) > 0
            ? {
                name: lastAppliedName,
                at: Math.round(Number(rawApplied.at)),
                source: cleanText(rawApplied.source, 24) || 'unknown'
            }
            : null,
        presets,
        deletedBuiltins,
        byName
    };
}

function createProfileStore({
    profileFile,
    writeJsonOffThread,
    now = Date.now,
    maxPresets = DEFAULT_MAX_PRESETS,
    saveDelayMs = DEFAULT_SAVE_DELAY_MS,
    logger = console
} = {}) {
    if (!profileFile) throw new Error('createProfileStore requires profileFile');
    if (typeof writeJsonOffThread !== 'function') {
        throw new Error('createProfileStore requires writeJsonOffThread');
    }

    const builtins = builtInProfiles();
    const builtinsByName = new Map(builtins.map(profile => [profile.name, profile]));
    const cache = new JsonFileCache(profileFile, {
        // Fresh installs begin on the shipped Recommended profile. Existing
        // profile files retain their own active selection unchanged.
        fallback: () => ({ version: STORE_VERSION, active: 'normal-sweaty', lastApplied: null, presets: [], deletedBuiltins: [], byName: new Map() }),
        checkIntervalMs: 1000,
        transform: raw => normalizeStore(raw, maxPresets, builtins)
    });

    let saveTimer = null;
    let dirty = false;

    function load() {
        return cache.get();
    }

    function flush({ strict = false, onlyPending = false } = {}) {
        if (onlyPending && !dirty) return;
        if (saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
        }
        const store = load();
        try {
            // byName is a runtime index; only version/active/presets persist.
            writeJsonOffThread(profileFile, {
                version: STORE_VERSION,
                active: store.active,
                lastApplied: store.lastApplied,
                presets: store.presets,
                deletedBuiltins: store.deletedBuiltins || []
            }, 'PresetStore');
            dirty = false;
        } catch (error) {
            logger.error?.('[Presets] Failed to queue save:', error?.message || error);
            if (strict) throw error;
        }
    }

    function scheduleSave() {
        if (saveDelayMs <= 0) return flush();
        if (saveTimer) return;
        saveTimer = setTimeout(() => {
            saveTimer = null;
            flush();
        }, saveDelayMs);
        if (typeof saveTimer.unref === 'function') saveTimer.unref();
    }

    function commit(store) {
        dirty = true;
        store.byName = new Map(store.presets.map(preset => [preset.name, preset]));
        cache.set(store);
        scheduleSave();
        return store;
    }

    function list() {
        return load().presets.slice();
    }

    // The legacy `list()` intentionally remains custom-only so old callers and
    // migrations retain their meaning. New UI/command surfaces use this union.
    function listProfiles() {
        const deleted = new Set(load().deletedBuiltins || []);
        return builtins.filter(profile => !deleted.has(profile.name)).concat(list()).map(profile => ({
            ...profile,
            missingSettingKeys: missingProfileSettingKeys(profile.settings)
        }));
    }

    function get(name) {
        const key = normalizePresetName(name);
        const store = load();
        const profile = store.byName.get(key)
            || ((store.deletedBuiltins || []).includes(key) ? null : builtinsByName.get(key));
        if (profile) {
            // Callers of get() power the in-game /profile surface. Give them
            // the same missing-setting information as listProfiles(), rather
            // than only warning in the launcher list.
            return {
                ...profile,
                missingSettingKeys: missingProfileSettingKeys(profile.settings)
            };
        }
        return null;
    }

    function getActive() {
        return load().active;
    }

    function getLastApplied() {
        return load().lastApplied || null;
    }

    function setActive(name, { source = 'unknown' } = {}) {
        const store = load();
        const key = normalizePresetName(name);
        const visibleBuiltin = builtinsByName.has(key) && !(store.deletedBuiltins || []).includes(key);
        store.active = key && (store.byName.has(key) || visibleBuiltin) ? key : null;
        store.lastApplied = store.active ? {
            name: store.active,
            at: now(),
            source: cleanText(source, 24) || 'unknown'
        } : null;
        commit(store);
        return store.active;
    }

    // Create or overwrite. Returns null when the name is unusable or the cap
    // is hit by a NEW preset (overwrites always allowed).
    function save(name, settings, { label = null } = {}) {
        const key = normalizePresetName(name);
        if (!key) return null;

        const store = load();
        const existing = store.byName.get(key);
        if (!existing && builtinsByName.has(key)) return null;
        if (!existing && store.presets.length >= maxPresets) return null;

        const stamp = now();
        const preset = {
            name: key,
            label: label || existing?.label || key,
            description: existing?.description || '',
            icon: existing?.icon || '',
            tags: existing?.tags || [],
            source: 'user',
            readOnly: false,
            boundModes: existing?.boundModes || [],
            createdAt: existing?.createdAt || stamp,
            updatedAt: stamp,
            settings: filterPresetSettings(settings)
        };

        store.presets = store.presets.filter(item => item.name !== key).concat(preset);
        commit(store);
        return preset;
    }

    function remove(name) {
        const key = normalizePresetName(name);
        const store = load();
        if (store.byName.has(key)) {
            store.presets = store.presets.filter(item => item.name !== key);
        } else if (builtinsByName.has(key) && !(store.deletedBuiltins || []).includes(key)) {
            store.deletedBuiltins = Array.from(new Set([...(store.deletedBuiltins || []), key]));
        } else {
            return false;
        }
        if (store.active === key) store.active = null;
        commit(store);
        return true;
    }

    // Bind a preset to a gamemode so it auto-applies on game start. A mode
    // belongs to at most one preset — binding steals it from any other.
    function bind(name, mode) {
        const key = normalizePresetName(name);
        const modeKey = String(mode || '').toUpperCase();
        if (!key || !modeKey) return null;

        const store = load();
        const preset = store.byName.get(key);
        if (!preset) return null;

        store.presets.forEach((item) => {
            item.boundModes = item.boundModes.filter(bound => bound !== modeKey);
        });
        if (!preset.boundModes.includes(modeKey)) preset.boundModes.push(modeKey);
        commit(store);
        return preset;
    }

    function unbind(name, mode = null) {
        const key = normalizePresetName(name);
        const store = load();
        const preset = store.byName.get(key);
        if (!preset) return null;
        const modeKey = mode ? String(mode).toUpperCase() : null;
        preset.boundModes = modeKey ? preset.boundModes.filter(bound => bound !== modeKey) : [];
        commit(store);
        return preset;
    }

    function findByMode(mode) {
        const modeKey = String(mode || '').toUpperCase();
        if (!modeKey) return null;
        return listProfiles().find(preset => preset.boundModes.includes(modeKey)) || null;
    }

    // What `name` would change, given the caller's current settings.
    function diff(name, currentSettings = {}) {
        const preset = get(name);
        if (!preset) return null;
        return diffSettings(currentSettings, preset.settings);
    }

    function size() {
        return load().presets.length;
    }

    function duplicate(name, copyName, options = {}) {
        const source = get(name);
        const key = normalizePresetName(copyName || `${source?.name || ''}-copy`);
        if (!source || !key || builtinsByName.has(key)) return null;
        const store = load();
        if (!store.byName.has(key) && store.presets.length >= maxPresets) return null;
        const stamp = now();
        const profile = {
            ...source,
            id: key,
            name: key,
            label: cleanText(options.label, MAX_NAME_LENGTH) || `${source.label} Copy`,
            description: options.description === undefined ? source.description : cleanText(options.description, MAX_DESCRIPTION_LENGTH),
            source: 'user',
            readOnly: false,
            boundModes: [],
            createdAt: store.byName.get(key)?.createdAt || stamp,
            updatedAt: stamp,
            settings: filterPresetSettings(source.settings)
        };
        store.presets = store.presets.filter(item => item.name !== key).concat(profile);
        commit(store);
        return profile;
    }

    function updateMetadata(name, fields = {}) {
        const key = normalizePresetName(name);
        const store = load();
        const profile = store.byName.get(key);
        if (!profile) return null;
        if (fields.label !== undefined) profile.label = cleanText(fields.label, MAX_NAME_LENGTH) || profile.label;
        if (fields.description !== undefined) profile.description = cleanText(fields.description, MAX_DESCRIPTION_LENGTH);
        if (fields.icon !== undefined) profile.icon = cleanText(fields.icon, 12);
        if (fields.tags !== undefined) {
            profile.tags = (Array.isArray(fields.tags) ? fields.tags : [])
                .map(tag => cleanText(tag, 20).toLowerCase())
                .filter((tag, index, items) => tag && items.indexOf(tag) === index)
                .slice(0, MAX_TAGS);
        }
        profile.updatedAt = now();
        commit(store);
        return profile;
    }

    function exportProfile(name) {
        const profile = get(name);
        if (!profile) return null;
        // Never export the active selection or mode binds: they are local
        // machine preferences, while the profile itself is safely portable.
        return {
            format: 'fury-profile',
            schemaVersion: STORE_VERSION,
            exportedAt: now(),
            profile: {
                ...profile,
                id: undefined,
                source: 'user',
                readOnly: false,
                boundModes: [],
                settings: filterPresetSettings(profile.settings)
            }
        };
    }

    function importProfile(payload, { name = null, overwrite = false } = {}) {
        const source = payload && typeof payload === 'object' ? (payload.profile || payload) : null;
        const imported = normalizePreset({ ...(source || {}), source: 'user', readOnly: false }, name || source?.name);
        if (!imported) return { ok: false, error: 'The profile has no valid name.' };
        if (Object.keys(imported.settings).length === 0) {
            return { ok: false, error: 'The profile has no supported settings.' };
        }
        const key = imported.name;
        const store = load();
        if (builtinsByName.has(key)) {
            return { ok: false, error: 'Choose a different name from the built-in profile.' };
        }
        const existing = store.byName.get(key);
        if (existing && !overwrite) return { ok: false, conflict: true, profile: existing };
        if (!existing && store.presets.length >= maxPresets) {
            return { ok: false, error: 'Profile limit reached.' };
        }
        const stamp = now();
        const profile = {
            ...imported,
            id: key,
            source: 'user',
            readOnly: false,
            createdAt: existing?.createdAt || stamp,
            updatedAt: stamp
        };
        store.presets = store.presets.filter(item => item.name !== key).concat(profile);
        commit(store);
        return { ok: true, profile };
    }

    return {
        load,
        flush,
        list,
        listProfiles,
        get,
        getActive,
        getLastApplied,
        setActive,
        save,
        remove,
        bind,
        unbind,
        findByMode,
        diff,
        size,
        duplicate,
        updateMetadata,
        exportProfile,
        importProfile,
        cache
    };
}

module.exports = {
    createProfileStore,
    normalizeStore,
    normalizePreset,
    normalizePresetName,
    cleanText,
    filterPresetSettings,
    unknownPresetKeys,
    diffSettings,
    splitByNamespace,
    namespaceForKey,
    PRESET_SETTING_KEYS,
    ALL_PRESET_KEYS,
    EXCLUDED_KEYS,
    PROFILE_SETTING_LABELS,
    PROFILE_HIGHLIGHT_KEYS,
    profileSettingLabel,
    describeProfileSettings,
    missingProfileSettingKeys,
    defaultProfileSettings,
    completeProfileSettings,
    builtInProfiles,
    STORE_VERSION,
    DEFAULT_MAX_PRESETS,
    MAX_NAME_LENGTH
};
