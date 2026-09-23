const mc = require('minecraft-protocol');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { dataPath } = require('./src/storage/runtimePaths.js');
const { createTeamDebugRecorder, observeClientWrites } = require('./src/diagnostics/teamDebug.js');
const { TEAM_DEFS: BEDWARS_TEAM_DEFS, resolveTeamEvidence } = require('./src/net/session/bedwarsTeamEvidence.js');
const { BoundedTtlMap } = require('./src/util/bounded_ttl_map.js');
const { FastQueue } = require('./src/util/fast_queue.js');
const { InFlightDeduper } = require('./src/util/in_flight_deduper.js');
const { JsonFileCache } = require('./src/storage/json_file_cache.js');
const { createPregameIdentityLookup, shouldHidePregamePartyMember } = require('./src/stats/pregameIdentity');
const {
    isLobbyChatAnnotationEligible,
    classifySocialOverlayText,
    mentionsOwnName,
    compactOverlayTags,
    buildOverlayTagComponents
} = require('./src/overlay/chat_overlay_annotation.js');
const {
    AUTOGAMBLER_TRIGGER_MESSAGE,
    AUTOGAMBLER_COMMAND,
    normalizeAutoGamblerToggle,
    createAutoGamblerSession,
    shouldHideAutoGamblerDialogue
} = require('./features/auto_gambler.js');
const { createEnderDustReminder } = require('./features/ender_dust_reminder.js');
const { createReminderAccountStore } = require('./src/reminders/rememberedAccount');
const reminderAccounts = createReminderAccountStore(dataPath('launcher_data', 'reminders'));
const { createSlumberDailyRewardsReminder } = require('./features/slumber_daily_rewards_reminder.js');
const { createGamblerGeorgeReminder, formatGeorgeCooldown } = require('./features/gambler_george_reminder.js');
const { createApiKeyCommandHandler } = require('./features/api_key_commands.js');
const { createApiKillSwitchCommandHandler } = require('./features/api_kill_switch_command.js');
const { createChatTriggerManager } = require('./features/chat_triggers.js');
const {
    LF_MODES,
    LF_ACTION_BAR_FRAME_MS,
    formatLfActionBar,
    resolveLfMode,
    createLookingForTriggers
} = require('./features/looking_for_triggers.js');
const { createProxyTabCompleter, ADDTAG_TAG_TYPES, ADDTAG_REASONS } = require('./features/command_completion.js');
const { formatTabTags, tagDetailLines } = require('./src/stats/tagDisplay');
const { createChatTabCompletion } = require('./features/chat_completion.js');
const { handleHelpCommand, getStartupCommandSummary } = require('./features/help_command.js');
const { createFuryMenu, normalizeFuryPage, FURY_HELP_TOPICS } = require('./features/fury_menu.js');
const { createHypixelApiClient, HYPIXEL_API_GAME_MIN_SPACING_MS } = require('./features/hypixel_api_client.js');
const { createUrchinClient } = require('./features/urchin_client.js');
const {
    makeUrchinData,
    classifyUrchinRequestError,
    parseUrchinCubelifyTags,
    titleCaseUrchinTagType,
    formatUrchinBatchDate,
    normalizeUrchinBatchTag,
    parseUrchinBatchTags,
    findUrchinBatchTagsForName,
    isUrchinRequestFailed,
    shortUrchinStatusLabel,
    urchinStatusMessage,
    isUrchinOutageStatus,
    isSyntheticUrchinStatusTag,
    getTabStatsUrchinTag: getTabStatsUrchinTagFromTag,
    mergeUrchinOverride,
    createUrchinOutageNotifier
} = require('./src/stats/urchin.js');
const {
    getOverlayRankNameColor,
    parseOverlayUrchinTag,
    parseOverlaySeraphTag,
    createOverlayTagBuilder
} = require('./src/overlay/tags.js');
const { buildOverlayTags } = createOverlayTagBuilder({ compactTagName: (...args) => compactTagName(...args) });
const {
    buildNametagFields,
    clampField: clampTeamField,
    MAX_TEAM_FIELD,
    nametagRowHasTag,
    isStatThreat: isNametagStatThreat,
    normalizeNametagStat,
    NAMETAG_STAT_TYPES,
    NAMETAG_STAT_LABELS,
    NAMETAG_SESSION_STATS,
    nametagSessionPeriod,
    NAMETAG_AUDIENCE_LABELS,
    NAMETAG_STAT_GROUPS,
    NAMETAG_STAT_SHORT_LABELS,
    NAMETAG_TAG_DISPLAY_MODES,
    normalizeNametagTagDisplayMode,
    cleanNametagText,
    nametagTagCategory,
    nametagTagSourceColor,
    formatNametagTagValue,
    stripNametagIconGlyphs,
    formatNametagNick,
    assignNametagTeamNames,
    composeBedwarsNametagPrefix
} = require('./src/overlay/nametags.js');
const {
    stripAnsi,
    extractText,
    extractFormattedText,
    getRankedName,
    LEGACY_COLOR_NAMES,
    resolveHypixelRank,
    hypixelRankIdFromText,
    isNickCapableRankId,
    displayLooksNickCapable,
    legacyTextToJsonComponent,
    normalizeHexColor,
    setChatPrefixAccent,
    getChatPrefixAccent,
    applyBedwarsEventLabelAccent,
    applyBedwarsSidebarTeamColors,
    getBedwarsSidebarTeamStatus,
    rewriteBedwarsSidebarTeamStatusLine,
    rewriteBedwarsSidebarTeamStatusSuffix,
    sendChat,
    sendActionBar
} = require('./features/minecraft_chat.js');
const { createProxyHealthMonitor } = require('./features/proxy_health.js');
const { createScanModeCommandHandler } = require('./features/scan_mode_command.js');
const chatController = require('./features/chat_controller.js');
const { createFeatureStatus } = require('./features/feature_panel.js');
const {
    DENICK_ISLAND_TOPPER_NAMES,
    DENICK_DEATH_CRY_NAMES,
    DENICK_SHOPKEEPER_SKIN_NAMES,
    DENICK_GLYPH_NAMES,
    DENICK_FIGURINE_NAMES,
    DENICK_PROJECTILE_TRAIL_NAMES
} = require('./src/cosmetics/cosmetic_name_catalog.js');

const { getRealNameFromSkin } = require('./src/denick/skin_denicker.js');
const express = require('express');
const { paths: appConfigPaths, loadKeys, loadKeyMeta, saveKeys, loadScanSettings, saveScanSettings, loadFeatureSettings, saveFeatureSettings, loadChatTriggerSettings, saveChatTriggerSettings, loadServerSettings, normalizeTabStatsModeSetting, normalizeShareDestination, normalizeNametagScope, normalizeNametagSourcePriority } = require('./app_config.js');
const {
    detectLobbyModeScoreboard,
    isBedwarsPregameScoreboard,
    parseBedwarsPregameMap,
    reconstructScoreboardLine,
    parseBedwarsPregameChat,
    isBedwarsPregameIgnoredSender,
    BEDWARS_PREGAME_IGNORED_SENDERS
} = require('./src/net/session/pregame_chat.js');
const {
    printableAsciiPreview,
    extractPrintableStrings,
    readMinecraftVarInt,
    decodeMinecraftString
} = require('./src/util/minecraftBinary.js');
const { titleCaseWords, truncateForLog, tryParseJsonText } = require('./src/util/text.js');
const { formatProfileUuid, normalizeUuidText, hyphenateUuid, decodeJwtPayload } = require('./src/util/uuid.js');
const { createJsonWriter } = require('./src/storage/jsonWriter.js');
const { createHealthServer } = require('./src/health/httpServer.js');
const { createConfigLoader } = require('./src/bootstrap/config.js');
const { createOwnIdentityTracker } = require('./src/net/session/ownIdentity.js');
const { createPartyTracker, isWithinReconnectGrace } = require('./src/net/session/partyTracking.js');
const { createPartyArrivalCheck } = require('./src/party/arrivalCheck.js');
const { createQueueTimeTracker } = require('./src/session/queueTime.js');
const { classifyPartyOverview } = require('./src/party/overview.js');
const { createEntityTracker } = require('./src/net/session/entityTracking.js');
const { createDenickTracker } = require('./src/net/session/denickTracking.js');
const { createScoreboardState } = require('./src/net/session/scoreboard.js');
const { DEFAULT_COMMAND_GAP_MS, createHypixelCommandQueue } = require('./src/net/hypixelCommandQueue.js');
const { state } = require('./src/state/runtimeState.js');
const { installApiKillSwitch } = require('./src/net/apiKillSwitch.js');
installApiKillSwitch(axios, () => state.apiKillSwitchEnabled);
const { createStatsCollector } = require('./src/stats/collect.js');
const {
    MINECRAFT_STAR_SYMBOL,
    BEDWARS_LEVEL_COLOR_PALETTE,
    formatInt,
    formatRatio,
    formatSigned,
    formatDuration,
    getBedwarsStarIcon,
    formatBedwarsPrestige,
    getSkyWarsLevelValue,
    formatSkyWarsLevel
} = require('./src/stats/format.js');
const { buildNickedBedwarsTabColumns, resolveTabPing } = require('./src/stats/tabStats.js');
const { isLikelyBot } = require('./src/denick/botNames.js');
const { isTransientPlayerLookupFailure, isConfirmedPlayerLookupFailure } = require('./src/stats/lookupStatus.js');
const {
    getFkdrColor,
    getWlrColor,
    getKdrColor,
    getWsColor,
    getPingColor
} = require('./src/stats/colors.js');
const { createRenderHelpers } = require('./src/stats/renderHelpers.js');
const { createBedwarsRender } = require('./src/stats/render/bedwars.js');
const { createSkywarsRender } = require('./src/stats/render/skywars.js');
const { createDuelsRender } = require('./src/stats/render/duels.js');
const { createGeneralRender } = require('./src/stats/render/general.js');
const { createSessionRender } = require('./src/stats/render/session.js');
const {
    createProfileStore,
    filterPresetSettings,
    splitByNamespace,
    diffSettings: diffPresetSettings,
    PRESET_SETTING_KEYS
} = require('./src/profiles/profileStore.js');
const {
    renderPresetList,
    renderPresetDiff,
    renderPresetApplied,
    renderPresetStatus
} = require('./src/profiles/presetRender.js');
const { createSessionStore } = require('./src/session/sessionStore.js');
const {
    createClipStore,
    bedwarsElapsedFromSidebar,
    isStandardBedwarsVariant,
    formatClipTime,
    MAX_GAME_MS: MAX_CLIP_GAME_MS,
    MAX_CLIPS_PER_GAME
} = require('./src/session/gameClips.js');
const { createRankBook } = require('./src/stats/rankBook.js');
const { findReplayClips } = require('./src/menu/replayResults.js');
const { createSessionTracker, gameForMode } = require('./src/session/sessionTracker.js');
const {
    SESSION_BOUNDARY_MINUTES,
    SESSION_RETENTION_CHOICES,
    SESSION_RECAP_STYLES,
    normalizeGoal
} = require('./src/session/settings.js');
const { createLauncherSessionHistoryCache } = require('./src/session/launcherSessionHistory.js');
const { normalizeGameEvent, parseGameEvents, parseResultBanner, eventSignature, resolveSessionGameVariant } = require('./src/session/gameEvents.js');
const { isOwnTeamElimination } = require('./src/session/gameResult.js');
const { createStatsLookup } = require('./src/stats/lookup.js');
const { createStatsFetch } = require('./src/stats/fetch.js');
const {
    createStatsSources,
    makePingData,
    parseAuroraPingResponse,
    classifyAuroraPingError,
    localDateKey,
    parseAuroraDayMs,
    validPingNumber,
    summarizePingRows
} = require('./src/stats/sources.js');

const chatTriggerManager = createChatTriggerManager({
    loadSettings: loadChatTriggerSettings,
    saveSettings: saveChatTriggerSettings,
    logger: console
});

const configLoader = createConfigLoader({
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
    clampDodgeDelay: (value) => clampDodgeDelay(value),
    chatTriggerManager,
    state
});

let activeUser = null; // Define this here at the top!
let lastPartyDisconnectAt = 0; // survives across reconnects, unlike the per-connection partyTracker
let applyLiveFeatureSettings = null;
let lastMatchSnapshot = null;
const { notifyUrchinOutageOnce, resetOutageWarning: resetUrchinOutageWarning } = createUrchinOutageNotifier({
    getActiveUser: () => activeUser,
    sendChat
});
const LAST_MATCH_SNAPSHOT_TTL = 20 * 60 * 1000;

const jsonWriter = createJsonWriter({
    workerPath: path.join(__dirname, 'src', 'storage', 'json_writer_worker.js'),
    logger: console
});
const { writeJsonOffThread, ensureJsonWriterWorker } = jsonWriter;
const { installServiceShutdown } = require('./src/bootstrap/shutdown');
const { createWorkDrain, ownListener, createUpstreamOwner } = require('./src/bootstrap/shutdownResources');
const connectionDrains = createWorkDrain();
const commandDrains = createWorkDrain();
const upstreamOwner = createUpstreamOwner(mc);
const shutdownConnections = new Set();
const cancelConnectionWork = new Set();
const ownedListeners = [];
let proxyStopping = false;

const MINECRAFT_CHAT_MESSAGE_MAX_LENGTH = 100;
const AURORA_PING_CACHE_DURATION = 30 * 60 * 1000;
const GLOBAL_PROFILE_CACHE_MAX_ENTRIES = 1000;
const AURORA_PING_CACHE_MAX_ENTRIES = 2000;
const LOCAL_COSMETIC_SEARCH_URL = require('./src/net/cosmeticSearchAddress').localCosmeticSearchUrl();
const COSMETIC_SEARCH_TOKEN = process.env.COSMETIC_SEARCH_TOKEN || '';
const hypixelApiClient = createHypixelApiClient({
    axios,
    getKeys: () => keys,
    getGameState: () => activeUser?.getHypixelUsageGameState ? activeUser.getHypixelUsageGameState() : null,
    logger: console
});
const {
    getHypixelApiUsageSnapshot,
    hasHypixelApiKeyConfigured,
    hypixelApiGet
} = hypixelApiClient;
const urchinClient = createUrchinClient({
    axios,
    getKey: () => keys.urchin,
    getGameState: () => activeUser?.getHypixelUsageGameState ? activeUser.getHypixelUsageGameState() : null,
    playerLookupKey,
    isMinecraftUsername,
    makeUrchinData,
    parseBatchTags: parseUrchinBatchTags,
    findBatchTagsForName: findUrchinBatchTagsForName,
    classifyRequestError: classifyUrchinRequestError,
    notifyOutage: notifyUrchinOutageOnce,
    stripAnsi,
    resolveSessionEndpoint: period => SESSION_PERIODS[period]?.endpoint || 'daily'
});
const {
    fetchUrchinFull,
    fetchUrchinSession,
    getUrchinBatchRaw,
    getUrchinRateLimitSnapshot,
    getUrchinRaw,
    resetUrchinLookupState,
    cachedUrchinBatchData
} = urchinClient;
const handleApiKeyCommand = createApiKeyCommandHandler({
    sendChat,
    getKeys: () => keys,
    saveKeys,
    loadKeyMeta,
    getHypixelApiUsageSnapshot,
    getUrchinRateLimitSnapshot,
    onKeyChanged: (keyField) => {
        if (['hypixel', 'urchin', 'aurora', 'seraph'].includes(keyField)) {
            globalCache.clear();
            resetUrchinLookupState();
            auroraPingCache.clear();
        }
    }
});
const auroraPingCache = new BoundedTtlMap({
    ttlMs: AURORA_PING_CACHE_DURATION,
    maxEntries: AURORA_PING_CACHE_MAX_ENTRIES,
    timestampKey: 'at'
});

const AUTH_PATH = dataPath('auth_tokens');
function loadServerFavicon(filename) {
    const iconPath = path.join(__dirname, 'assets', filename);
    try {
        return `data:image/png;base64,${fs.readFileSync(iconPath).toString('base64')}`;
    } catch (error) {
        console.warn(`[Fury] Server icon unavailable (${filename}): ${error.message}`);
        return '';
    }
}
const FURY_DIRECT_SERVER_FAVICON = loadServerFavicon('fury-server-icon.png');
const FURY_FAILOVER_SERVER_FAVICON = FURY_DIRECT_SERVER_FAVICON;
const DENICKED_HISTORY_FILE = dataPath('denicked.json');
const FRIEND_ALIASES_FILE = dataPath('friend_aliases.json');
const LEGACY_PRESETS_FILE = dataPath('presets.json');
const PRESETS_FILE = dataPath('launcher_data', 'profiles.json');
const SESSION_DATA_FILE = dataPath('session_data.json');
const GAME_CLIPS_FILE = dataPath('game_clips.json');
const RANK_BOOK_FILE = dataPath('rank_book.json');
const COSMETIC_API_NAMES_FILE = dataPath('cosmetic_api_names.json');
const KILL_MESSAGE_PATTERNS_FILE = dataPath('kill_message_patterns.json');
let keys = { hypixel: '', urchin: '', aurora: '', seraph: '' };
const CACHE_DURATION = 5 * 60 * 1000;
const globalCache = new BoundedTtlMap({
    ttlMs: CACHE_DURATION,
    maxEntries: GLOBAL_PROFILE_CACHE_MAX_ENTRIES
});
const guildCache = new BoundedTtlMap({
    ttlMs: CACHE_DURATION,
    maxEntries: 500
});
const playerLookupDeduper = new InFlightDeduper();
const auroraPingDeduper = new InFlightDeduper();
const DENICK_RANGE = 200;

const {
    COSMETIC_CATEGORIES,
    BED_DESTROY_EFFECTS,
    FINAL_KILL_EFFECTS,
    WOOD_SKINS,
    WOOD_SKIN_BY_ITEM,
    COSMETIC_CATALOG,
    normalizeCosmeticKey,
    normalizeCosmeticType,
    cosmeticTypeLabel,
    canonicalCosmeticName,
    cosmeticApiAliasCandidates,
    canonicalCosmeticNameFromApiId,
    canonicalWoodSkinNameFromApiId,
    createCosmeticCommands
} = require('./src/cosmetics/catalog.js');
const { sendCosmeticList } = createCosmeticCommands({ sendChat });
const { createEffectLibrary } = require('./src/cosmetics/effectLibrary.js');
const { createEffectRecorder } = require('./src/cosmetics/effectRecorder.js');
// Shared across connections; loads its JSON synchronously HERE (startup),
// saves are debounced+async so gameplay never touches the disk.
const cosmeticEffectLibrary = createEffectLibrary();

const PLAYER_ENTITY_PACKET_NAMES = new Set([
    'named_entity_spawn',
    'entity_teleport',
    'rel_entity_move',
    'entity_move_look',
    'entity_equipment',
    'entity_metadata',
    'entity_destroy'
]);
const PLAYER_INFO_ACTIONS = Object.freeze({
    0: 'add_player',
    1: 'update_gamemode',
    2: 'update_latency',
    3: 'update_display_name',
    4: 'remove_player'
});
const SCOREBOARD_TEAM_MODES = Object.freeze({
    create_team: 0,
    remove_team: 1,
    update_team: 2,
    add_players: 3,
    remove_players: 4
});
const PLAYER_NAME_TEXT_BLOCKLIST = new Set([
    'VIP',
    'VIP_PLUS',
    'MVP',
    'MVP_PLUS',
    'MVPPLUS',
    'YOUTUBE',
    'YT',
    'ADMIN',
    'MOD',
    'HELPER',
    'OWNER',
    'NICK',
    'NICKED'
]);
// Lowercase; compare with isChatSenderTokenBlocked().
const CHAT_SENDER_TOKEN_BLOCKLIST = new Set([
    'guild',
    'party',
    'officer',
    'from',
    'to',
    'team',
    'shout',
    'coop',
    'vip',
    'mvp',
    'mvp_plus',
    'vip_plus',
    ...BEDWARS_PREGAME_IGNORED_SENDERS
]);
function isChatSenderTokenBlocked(token) {
    return CHAT_SENDER_TOKEN_BLOCKLIST.has(String(token || '').toLowerCase());
}
const HOTKEY_DEBUG_PACKETS = new Set([
    'held_item_slot',
    'block_dig',
    'block_place',
    'entity_action',
    'window_click',
    'creative_inventory_action',
    'custom_payload',
    'arm_animation'
]);


let tabStatsEnabled = false;
let autoScanOnGameStart = true;
let autoGamblerEnabled = false;
let autoSkinDenickEnabled = true;
let autoStatsDenickEnabled = true;
let denickChatAnnouncementsEnabled = true;
let denickPartyAnnounceEnabled = false;
let socialOverlayAddsEnabled = true;
let lobbyChatStatsEnabled = true;
let lobbyChatStatsMentionEnabled = true;
let lobbyChatStatsDmEnabled = true;
let lobbyChatStatsTriggerEnabled = true;
let accentBedwarsEventLabelsEnabled = true;
let bedwarsSidebarTeamColorsEnabled = true;
// Heartbeat from the launcher: auto-adds only run while an overlay view (the
// launcher's overlay tab or the floating overlay window) is actually on screen.
// The launcher refreshes this on every /health poll; if polls stop (launcher
// closed) the flag expires and auto-adds stop with it.
const OVERLAY_UI_ACTIVE_TTL_MS = 15000;
let overlayUiActiveUntil = 0;

function reportOverlayUiVisible(visible) {
    if (visible) overlayUiActiveUntil = Date.now() + OVERLAY_UI_ACTIVE_TTL_MS;
}

function isOverlayUiActive() {
    return Date.now() < overlayUiActiveUntil;
}
let pregameChatStatsEnabled = true;
let queueTimeEnabled = true;
let queueTimePartyChatEnabled = false;
let partySplitWarningsEnabled = true;
let autoDodgeEnabled = false;
let autoDodgeDelaySeconds = 10;
const partyOverviewEnabled = true;
let autoDodgeTaggedPlayers = true;
let autoDodgeNickedPlayers = false;
let autoDodgeStatThreats = false;
let autoDodgeIncludePreset = 'custom';
let autoDodgeMinFkdr = 3;
let autoDodgeMinStars = 1000;
let enderDustReminderEnabled = false;
let enderDustReminderThreshold = 250;
let enderDustReminderLastReading = null;
let slumberDailyRewardsReminderEnabled = false;
let gamblerGeorgeReminderEnabled = true;
let gamblerGeorgeReminderState = null;
let overlayAutoAddOutsideGamesOnly = true;
let overlayAutoClearOnGameStartEnd = true;
let showDenickedRealIgn = true;
let showTagsInTabStats = true;
let nametagOverlayEnabled = false;
let nametagStarBracketsEnabled = true;
let nametagTagDisplayMode = 'acronyms';
let proxyHealthWarningsEnabled = true;
let tabStatsBedwarsMode = 'auto';
let tabStatsSkywarsMode = 'auto';
let tabStatsShowKillRatio = true;
let tabStatsShowWinRatio = true;
let tabStatsBedwarsFields = ['name', 'stars', 'fkdr', 'wlr', 'tags'];
let tabStatsSkywarsFields = ['stars', 'name', 'wlr', 'kdr', 'tags'];
let tabStatsLabelStyle = 'compact';
let nametagScope = 'enemies'; // legacy; migrated to the per-audience flags below
let nametagSourcePriority = 'urchin';
// Per-audience nametag config. Each audience (teammates / enemy threats /
// everyone else) can be enabled independently and shows up to two stats — one
// in the prefix slot, one in the suffix slot.
let nametagTeammatesEnabled = false;
let nametagTeammatesPrefix = 'none';
let nametagTeammatesPrefixFallback = 'none';
let nametagTeammatesSuffix = 'fkdr';
let nametagTeammatesSuffixFallback = 'none';
let nametagThreatsEnabled = true;
let nametagThreatsPrefix = 'tag';
let nametagThreatsPrefixFallback = 'star';
let nametagThreatsSuffix = 'fkdr';
let nametagThreatsSuffixFallback = 'none';
let nametagOthersEnabled = false;
let nametagOthersPrefix = 'none';
let nametagOthersPrefixFallback = 'none';
let nametagOthersSuffix = 'kdr';
let nametagOthersSuffixFallback = 'none';

function getCachedMinecraftProfile(username) {
    if (!username) return null;
    const profileDir = path.join(AUTH_PATH, String(username));
    if (!fs.existsSync(profileDir)) return null;

    let files = [];
    try {
        files = fs.readdirSync(profileDir).filter(file => file.endsWith('_mca-cache.json'));
    } catch (e) {
        return null;
    }

    for (const file of files) {
        try {
            const raw = fs.readFileSync(path.join(profileDir, file), 'utf8');
            const cache = JSON.parse(raw);
            const payload = decodeJwtPayload(cache?.mca?.access_token);
            const profileEntry = Array.isArray(payload?.pfd)
                ? payload.pfd.find(entry => entry?.type === 'mc')
                : null;
            const id = formatProfileUuid(payload?.profiles?.mc || profileEntry?.id);
            const name = profileEntry?.name || username;
            if (id && (!name || String(name).toLowerCase() === String(username).toLowerCase())) {
                return { id, name };
            }
        } catch (e) {}
    }

    return null;
}

function applyCachedLoginProfile(client) {
    const profile = getCachedMinecraftProfile(client.username);
    if (!profile?.id) return;
    client.uuid = profile.id;
    client.profile = {
        id: profile.id.replace(/-/g, ''),
        name: profile.name || client.username
    };
}

function isMinecraftUsername(value) {
    return /^[A-Za-z0-9_]{3,16}$/.test(String(value || '').trim());
}

function playerLookupKey(name) {
    return String(name || '').trim().toLowerCase();
}

const { createDenickDisplayNames } = require('./src/denick/displayNames.js');
const { createRealSkinTextureResolver } = require('./src/denick/skinTextures.js');
const realSkinTextureResolver = createRealSkinTextureResolver({ httpClient: axios });
const { createDenickHistory } = require('./src/denick/history.js');
const {
    loadDenickHistoryStore,
    findKnownDenickByNick,
    appendDenickHistory,
    removeDenickMapping
} = createDenickHistory({
    historyFile: DENICKED_HISTORY_FILE,
    writeJsonOffThread
});

// Custom display names for people you know. Resolved AFTER the denick above and
// keyed on the real IGN, so one entry covers a friend whether Hypixel is showing
// their IGN or a nick. Display-only, same as the denick rename it rides on.
const { createFriendAliasBook } = require('./src/friends/aliasBook.js');
const {
    listAliases: listFriendAliases,
    findAlias: findFriendAlias,
    aliasOwner: friendAliasOwner,
    setAlias: setFriendAlias,
    removeAlias: removeFriendAlias
} = createFriendAliasBook({
    aliasFile: FRIEND_ALIASES_FILE,
    writeJsonOffThread
});

// Local session history is process-wide; the per-connection tracker built
// inside createProxyServer owns the live lifecycle state.
const sessionStore = createSessionStore({
    sessionFile: SESSION_DATA_FILE,
    writeJsonOffThread,
    getMaxSessions: () => state.sessionRetention
});
// The launcher's session page polls every few seconds; rebuild its history
// only when the store or the session settings change.
const launcherSessionHistory = createLauncherSessionHistoryCache();
// /clip moments, kept apart from session_data.json so they are saved the
// moment they are made and survive games whose end is never detected.
const clipStore = createClipStore({
    clipFile: GAME_CLIPS_FILE,
    writeJsonOffThread
});
// Rank displays of looked-up players, for views of past games (the /replay
// menu's teammates) long after the in-memory profile cache has expired.
const rankBook = createRankBook({
    rankFile: RANK_BOOK_FILE,
    writeJsonOffThread
});

function rankedDisplayForPlayer(player, name = player?.displayname) {
    const rank = resolveHypixelRank(player || {});
    return `${rank.prefix ? `${rank.prefix} ` : ''}${rank.nameColor}${name}`;
}
// Profiles moved into the launcher's per-user data directory. Preserve the
// existing presets.json transparently for people upgrading from the first
// implementation.
if (!fs.existsSync(PRESETS_FILE) && fs.existsSync(LEGACY_PRESETS_FILE)) {
    try {
        fs.mkdirSync(path.dirname(PRESETS_FILE), { recursive: true });
        fs.copyFileSync(LEGACY_PRESETS_FILE, PRESETS_FILE);
    } catch (error) {
        console.warn(`[Profiles] Could not migrate legacy presets: ${error.message}`);
    }
}
const presetStore = createProfileStore({
    profileFile: PRESETS_FILE,
    writeJsonOffThread
});

const {
    createDenickApi,
    denickCosmeticSlug,
    DENICK_KILL_MESSAGE_NAMES,
    DENICK_VICTORY_DANCE_NAMES,
    DENICK_SPRAY_NAMES,
    DENICK_COSMETIC_FIELDS,
    DENICK_COSMETIC_FIELD_BY_ALIAS,
    DENICK_STAT_FIELD_BY_ALIAS,
    DENICK_COSMETIC_NAME_LISTS,
    DENICK_COSMETIC_API_EXCEPTIONS
} = require('./src/denick/api.js');
const {
    loadDenickCosmeticApiNames,
    learnedDenickCosmeticApiValue,
    matchDenickCosmeticField,
    matchDenickStatField,
    denickCosmeticApiValue,
    parseDenickCosmeticFilters,
    parseDenickFilters
} = createDenickApi({
    cosmeticApiNamesFile: COSMETIC_API_NAMES_FILE
});

const {
    createDenickCommands,
    parseStatCount,
    denickCandidateKey
} = require('./src/denick/commands.js');

function logMicrosoftLoginCode(data) {
    const url = data?.verification_uri || 'https://www.microsoft.com/link';
    const code = data?.user_code || '';
    console.log('[Microsoft Login] Sign-in required.');
    console.log(`[Microsoft Login] Open: ${url}`);
    if (code) console.log(`[Microsoft Login] Code: ${code}`);
    console.log('[Microsoft Login] Finish the browser sign-in, then reconnect if needed.');
}

function logCustomPayloadPacket(direction, data = {}) {
    const channel = data.channel || data.tag || data.identifier || 'unknown';
    const payload = data.data || data.payload;
    const length = Buffer.isBuffer(payload)
        ? payload.length
        : Array.isArray(payload)
            ? payload.length
            : payload?.length ?? 0;
    console.log(`[Packet] ${direction} The Packet Type: Custom Payload | channel=${channel} | bytes=${length}`);
}

function customPayloadChannel(data = {}) {
    return String(data.channel || data.tag || data.identifier || '').trim();
}

function customPayloadBuffer(data = {}) {
    const payload = data.data || data.payload;
    if (Buffer.isBuffer(payload)) return payload;
    if (Array.isArray(payload)) return Buffer.from(payload);
    if (payload instanceof Uint8Array) return Buffer.from(payload);
    if (typeof payload === 'string') return Buffer.from(payload, 'utf8');
    return Buffer.alloc(0);
}

function decodedCustomPayloadLines(channel, buffer) {
    const lines = [];
    const channelKey = String(channel || '').toLowerCase();
    const directUtf8 = buffer.toString('utf8').replace(/\0/g, '').trim();
    const minecraftString = decodeMinecraftString(buffer);

    if (minecraftString?.value) {
        lines.push(`minecraftString=${truncateForLog(minecraftString.value)}`);
    }

    const preferredText = minecraftString?.value || directUtf8;
    const parsedJson = tryParseJsonText(preferredText);
    if (parsedJson) {
        lines.push(`json=${truncateForLog(JSON.stringify(parsedJson, null, 2), 3000)}`);
        return lines;
    }

    if (channelKey === 'mc|brand' && minecraftString?.value) {
        lines.push(`brand=${minecraftString.value}`);
    } else if (directUtf8 && /[\x20-\x7E]/.test(directUtf8)) {
        lines.push(`utf8=${truncateForLog(directUtf8)}`);
    }

    const strings = extractPrintableStrings(buffer);
    if (strings.length) lines.push(`strings=${strings.map(value => truncateForLog(value, 120)).join(' | ')}`);
    return lines;
}

function logReadableCustomPayload(channel, data = {}) {
    const buffer = customPayloadBuffer(data);
    const hexPreview = buffer.slice(0, 160).toString('hex').replace(/(.{2})/g, '$1 ').trim();
    const decodedLines = decodedCustomPayloadLines(channel, buffer);
    console.log(`[Packet Data] channel=${channel} bytes=${buffer.length}`);
    if (decodedLines.length) {
        decodedLines.forEach(line => console.log(`[Packet Data] decoded ${line}`));
    } else {
        console.log(`[Packet Data] decoded=unrecognized binary payload`);
    }
    console.log(`[Packet Data] asciiPreview=${printableAsciiPreview(buffer)}`);
    console.log(`[Packet Data] hex=${hexPreview}${buffer.length > 160 ? ' ...' : ''}`);
}

const {
    KILL_MESSAGE_PREVIEW_SLOTS,
    KILL_MESSAGE_EXTENDED_PREVIEW_SLOTS,
    KILL_MESSAGE_EXTENDED_KEYS,
    AMBIGUOUS_KILL_MESSAGE_KEYS,
    KILL_MESSAGE_CAPTURE_TIMEOUT_MS,
    DEFAULT_KILL_MESSAGE_PATTERNS,
    killMessagePreviewSlots,
    blankKillMessagePatternStore,
    killMessageSignatureScore,
    killMessageScoreThreshold,
    isAmbiguousKillMessageCandidate,
    detectKillMessageColorHint,
    createKillMessages
} = require('./src/cosmetics/killMessages.js');
const {
    killMessagePatternSignature,
    loadKillMessagePatternStore,
    saveKillMessagePatternStore,
    ensureDefaultKillMessagePatterns,
    canonicalKillMessageName,
    canonicalKillMessageNameFromApiId,
    parseBedDestroyChat,
    detectKillMessageCosmetic,
    detectKillMessageOwner,
    detectKillMessageCosmeticFromChat,
    sendKillMessageRecorderUsage,
    sendKillMessageNameList,
    sendSavedKillMessagePatterns,
    finalizeKillMessageCapture,
    clearKillMessageCaptureForClient,
    observeKillMessagePreviewChat,
    handleKillMessageRecorderCommand
} = createKillMessages({
    sendChat,
    stripAnsi,
    killMessagePatternsFile: KILL_MESSAGE_PATTERNS_FILE,
    getDenickKillMessageNames: () => DENICK_KILL_MESSAGE_NAMES,
    denickCosmeticApiValue: (fieldKey, rawValue) => denickCosmeticApiValue(fieldKey, rawValue)
});

const {
    humanizeApiCosmeticIdentifier,
    stringifyApiCosmeticValue,
    activeBedwarsCosmeticFieldLabel,
    isLikelyActiveBedwarsCosmeticField,
    createActiveCosmetics
} = require('./src/cosmetics/activeCosmetics.js');
const {
    extractActiveBedwarsCosmetics,
    collectActiveBedwarsCosmeticFields
} = createActiveCosmetics({
    canonicalKillMessageNameFromApiId: (value) => canonicalKillMessageNameFromApiId(value)
});

ensureDefaultKillMessagePatterns();




const handleScanModeCommand = createScanModeCommandHandler({
    sendChat,
    getState: () => ({ scanMode: state.scanMode, threatConfig: state.threatConfig }),
    setScanMode: (nextMode) => {
        state.scanMode = nextMode;
    },
    updateThreatConfig: (patch) => {
        state.threatConfig = { ...state.threatConfig, ...patch };
    },
    saveScanConfig: () => saveScanConfig()
});

if (!fs.existsSync(AUTH_PATH)) fs.mkdirSync(AUTH_PATH);

function loadFeatureConfig(options = {}) {
    const features = configLoader.parseFeatureConfig(options);
    setChatPrefixAccent(features.chatPrefixAccentHex);
    tabStatsEnabled = features.tabStatsEnabled;
    autoScanOnGameStart = true;
    autoGamblerEnabled = features.autoGamblerEnabled;
    autoSkinDenickEnabled = features.autoSkinDenickEnabled;
    autoStatsDenickEnabled = features.autoStatsDenickEnabled;
    denickChatAnnouncementsEnabled = features.denickChatAnnouncementsEnabled;
    denickPartyAnnounceEnabled = features.denickPartyAnnounceEnabled;
    socialOverlayAddsEnabled = features.socialOverlayAddsEnabled;
    lobbyChatStatsEnabled = features.lobbyChatStatsEnabled;
    lobbyChatStatsMentionEnabled = features.lobbyChatStatsMentionEnabled;
    lobbyChatStatsDmEnabled = features.lobbyChatStatsDmEnabled;
    lobbyChatStatsTriggerEnabled = features.lobbyChatStatsTriggerEnabled;
    accentBedwarsEventLabelsEnabled = features.accentBedwarsEventLabelsEnabled;
    bedwarsSidebarTeamColorsEnabled = features.bedwarsSidebarTeamColorsEnabled;
    pregameChatStatsEnabled = features.pregameChatStatsEnabled;
    queueTimeEnabled = features.queueTimeEnabled;
    queueTimePartyChatEnabled = features.queueTimePartyChatEnabled;
    partySplitWarningsEnabled = features.partySplitWarningsEnabled;
    autoDodgeEnabled = features.autoDodgeEnabled;
    autoDodgeDelaySeconds = features.autoDodgeDelaySeconds;
    autoDodgeTaggedPlayers = features.autoDodgeTaggedPlayers;
    autoDodgeNickedPlayers = features.autoDodgeNickedPlayers;
    autoDodgeStatThreats = features.autoDodgeStatThreats;
    autoDodgeIncludePreset = features.autoDodgeIncludePreset;
    autoDodgeMinFkdr = features.autoDodgeMinFkdr;
    autoDodgeMinStars = features.autoDodgeMinStars;
    enderDustReminderEnabled = features.enderDustReminderEnabled;
    enderDustReminderThreshold = features.enderDustReminderThreshold;
    enderDustReminderLastReading = features.enderDustReminderLastReading || null;
    slumberDailyRewardsReminderEnabled = features.slumberDailyRewardsReminderEnabled;
    gamblerGeorgeReminderEnabled = features.gamblerGeorgeReminderEnabled;
    gamblerGeorgeReminderState = features.gamblerGeorgeReminderState || null;
    state.partyOverviewEnabled = partyOverviewEnabled;
    overlayAutoAddOutsideGamesOnly = true;
    overlayAutoClearOnGameStartEnd = true;
    showDenickedRealIgn = features.showDenickedRealIgn;
    showTagsInTabStats = features.showTagsInTabStats;
    nametagOverlayEnabled = features.nametagOverlayEnabled;
    nametagStarBracketsEnabled = features.nametagStarBracketsEnabled !== false;
    nametagTagDisplayMode = normalizeNametagTagDisplayMode(features.nametagTagDisplayMode, 'acronyms');
    state.apiKillSwitchEnabled = features.apiKillSwitchEnabled;
    proxyHealthWarningsEnabled = features.proxyHealthWarningsEnabled;
    state.denickRealIgnNametags = features.denickRealIgnNametags;
    state.denickRealSkin = features.denickRealSkin;
    state.denickRealIgnChat = features.denickRealIgnChat;
    state.friendAliasEnabled = features.friendAliasEnabled;
    state.friendAliasNametags = features.friendAliasNametags;
    state.friendAliasChat = features.friendAliasChat;
    state.friendAliasTabStats = features.friendAliasTabStats;
    state.friendAliasShowRealIgn = features.friendAliasShowRealIgn;
    state.sessionTrackingEnabled = features.sessionTrackingEnabled;
    state.gameRecapEnabled = features.gameRecapEnabled;
    state.replayDetailsEnabled = features.replayDetailsEnabled;
    state.sessionBoundaryMinutes = features.sessionBoundaryMinutes;
    state.sessionRetention = features.sessionRetention;
    state.sessionRecapStyle = features.sessionRecapStyle;
    state.sessionRecapFields = features.sessionRecapFields;
    state.sessionBedwarsFields = features.sessionBedwarsFields;
    state.sessionSkywarsFields = features.sessionSkywarsFields;
    state.sessionDuelsFields = features.sessionDuelsFields;
    state.sessionGoalWins = features.sessionGoalWins;
    state.sessionGoalFinals = features.sessionGoalFinals;
    state.sessionGoalGames = features.sessionGoalGames;
    state.sessionGoalMinutes = features.sessionGoalMinutes;
    state.shareTagsAuto = features.shareTagsAuto;
    state.shareTagsFancy = features.shareTagsFancy;
    state.shareTagsColorLocal = features.shareTagsColorLocal;
    state.shareTagsIncludeTagged = features.shareTagsIncludeTagged;
    state.shareTagsIncludeNicks = features.shareTagsIncludeNicks;
    state.shareTagsIncludeThreats = features.shareTagsIncludeThreats;
    state.shareTagsDestination = features.shareTagsDestination || 'party';
    state.shareTagsGroupByTeam = true;
    tabStatsBedwarsMode = features.tabStatsBedwarsMode || 'auto';
    tabStatsSkywarsMode = features.tabStatsSkywarsMode || 'auto';
    tabStatsShowKillRatio = features.tabStatsShowKillRatio !== undefined ? features.tabStatsShowKillRatio : true;
    tabStatsShowWinRatio = features.tabStatsShowWinRatio !== undefined ? features.tabStatsShowWinRatio : true;
    tabStatsBedwarsFields = Array.isArray(features.tabStatsBedwarsFields) ? features.tabStatsBedwarsFields.slice() : ['name', 'stars', 'fkdr', 'wlr', 'tags'];
    tabStatsSkywarsFields = Array.isArray(features.tabStatsSkywarsFields) ? features.tabStatsSkywarsFields.slice() : ['stars', 'name', 'wlr', 'kdr', 'tags'];
    tabStatsLabelStyle = ['compact', 'full', 'value'].includes(features.tabStatsLabelStyle) ? features.tabStatsLabelStyle : 'compact';
    nametagScope = features.nametagScope || 'enemies';
    nametagSourcePriority = features.nametagSourcePriority || 'urchin';
    nametagTeammatesEnabled = Boolean(features.nametagTeammatesEnabled);
    nametagTeammatesPrefix = normalizeNametagStat(features.nametagTeammatesPrefix, 'none');
    nametagTeammatesPrefixFallback = normalizeNametagStat(features.nametagTeammatesPrefixFallback, 'none');
    nametagTeammatesSuffix = normalizeNametagStat(features.nametagTeammatesSuffix, 'fkdr');
    nametagTeammatesSuffixFallback = normalizeNametagStat(features.nametagTeammatesSuffixFallback, 'none');
    nametagThreatsEnabled = Boolean(features.nametagThreatsEnabled);
    nametagThreatsPrefix = normalizeNametagStat(features.nametagThreatsPrefix, 'tag');
    nametagThreatsPrefixFallback = normalizeNametagStat(features.nametagThreatsPrefixFallback, 'star');
    nametagThreatsSuffix = normalizeNametagStat(features.nametagThreatsSuffix, 'fkdr');
    nametagThreatsSuffixFallback = normalizeNametagStat(features.nametagThreatsSuffixFallback, 'none');
    nametagOthersEnabled = Boolean(features.nametagOthersEnabled);
    nametagOthersPrefix = normalizeNametagStat(features.nametagOthersPrefix, 'none');
    nametagOthersPrefixFallback = normalizeNametagStat(features.nametagOthersPrefixFallback, 'none');
    nametagOthersSuffix = normalizeNametagStat(features.nametagOthersSuffix, 'kdr');
    nametagOthersSuffixFallback = normalizeNametagStat(features.nametagOthersSuffixFallback, 'none');
    console.log(`[FEATURES] Tab stats loaded: ${tabStatsEnabled ? 'ON' : 'OFF'}`);
    console.log(`[FEATURES] Auto gambler loaded: ${autoGamblerEnabled ? 'ON' : 'OFF'}`);
}

function currentFeatureConfigSnapshot() {
    return {
        chatPrefixAccentHex: getChatPrefixAccent()?.sourceHex || '#e5b35d',
        tabStatsEnabled,
        autoScanOnGameStart,
        autoGamblerEnabled,
        autoSkinDenickEnabled,
        autoStatsDenickEnabled,
        denickChatAnnouncementsEnabled,
        denickPartyAnnounceEnabled,
        socialOverlayAddsEnabled,
        lobbyChatStatsEnabled,
        lobbyChatStatsMentionEnabled,
        lobbyChatStatsDmEnabled,
        lobbyChatStatsTriggerEnabled,
        accentBedwarsEventLabelsEnabled,
        bedwarsSidebarTeamColorsEnabled,
        pregameChatStatsEnabled,
        queueTimeEnabled,
        queueTimePartyChatEnabled,
        partySplitWarningsEnabled,
        autoDodgeEnabled,
        autoDodgeDelaySeconds,
        autoDodgeTaggedPlayers,
        autoDodgeNickedPlayers,
        autoDodgeStatThreats,
        autoDodgeIncludePreset,
        autoDodgeMinFkdr,
        autoDodgeMinStars,
        enderDustReminderEnabled,
        enderDustReminderThreshold,
        enderDustReminderLastReading,
        slumberDailyRewardsReminderEnabled,
        gamblerGeorgeReminderEnabled,
        gamblerGeorgeReminderState,
        partyOverviewEnabled,
        overlayAutoAddOutsideGamesOnly: true,
        overlayAutoClearOnGameStartEnd: true,
        showDenickedRealIgn,
        showTagsInTabStats,
        nametagOverlayEnabled,
        nametagStarBracketsEnabled,
        nametagTagDisplayMode,
        apiKillSwitchEnabled: state.apiKillSwitchEnabled,
        proxyHealthWarningsEnabled,
        denickRealIgnNametags: state.denickRealIgnNametags,
        denickRealSkin: state.denickRealSkin,
        denickRealIgnChat: state.denickRealIgnChat,
        friendAliasEnabled: state.friendAliasEnabled,
        friendAliasNametags: state.friendAliasNametags,
        friendAliasChat: state.friendAliasChat,
        friendAliasTabStats: state.friendAliasTabStats,
        friendAliasShowRealIgn: state.friendAliasShowRealIgn,
        sessionTrackingEnabled: state.sessionTrackingEnabled,
        gameRecapEnabled: state.gameRecapEnabled,
        replayDetailsEnabled: state.replayDetailsEnabled,
        sessionBoundaryMinutes: state.sessionBoundaryMinutes,
        sessionRetention: state.sessionRetention,
        sessionRecapStyle: state.sessionRecapStyle,
        sessionRecapFields: state.sessionRecapFields,
        sessionBedwarsFields: state.sessionBedwarsFields,
        sessionSkywarsFields: state.sessionSkywarsFields,
        sessionDuelsFields: state.sessionDuelsFields,
        sessionGoalWins: state.sessionGoalWins,
        sessionGoalFinals: state.sessionGoalFinals,
        sessionGoalGames: state.sessionGoalGames,
        sessionGoalMinutes: state.sessionGoalMinutes,
        shareTagsAuto: state.shareTagsAuto,
        shareTagsFancy: state.shareTagsFancy,
        shareTagsColorLocal: state.shareTagsColorLocal,
        shareTagsIncludeTagged: state.shareTagsIncludeTagged,
        shareTagsIncludeNicks: state.shareTagsIncludeNicks,
        shareTagsIncludeThreats: state.shareTagsIncludeThreats,
        shareTagsDestination: state.shareTagsDestination,
        shareTagsGroupByTeam: state.shareTagsGroupByTeam,
        tabStatsBedwarsMode,
        tabStatsSkywarsMode,
        tabStatsShowKillRatio,
        tabStatsShowWinRatio,
        tabStatsBedwarsFields,
        tabStatsSkywarsFields,
        tabStatsLabelStyle,
        nametagScope,
        nametagSourcePriority,
        nametagTeammatesEnabled,
        nametagTeammatesPrefix,
        nametagTeammatesPrefixFallback,
        nametagTeammatesSuffix,
        nametagTeammatesSuffixFallback,
        nametagThreatsEnabled,
        nametagThreatsPrefix,
        nametagThreatsPrefixFallback,
        nametagThreatsSuffix,
        nametagThreatsSuffixFallback,
        nametagOthersEnabled,
        nametagOthersPrefix,
        nametagOthersPrefixFallback,
        nametagOthersSuffix,
        nametagOthersSuffixFallback,
};
}

function preserveLockedFeaturePreferences(snapshot = {}) {
    return { ...snapshot };
}

function saveFeatureConfig() {
    configLoader.saveFeatureConfig(preserveLockedFeaturePreferences(currentFeatureConfigSnapshot()));
}

const packetDebugLoggingEnabled = /^(1|true|yes|on)$/i.test(
    String(process.env.FURY_PACKET_DEBUG || '').trim()
);

const handleApiKillSwitchCommand = createApiKillSwitchCommandHandler({
    sendChat,
    getEnabled: () => state.apiKillSwitchEnabled,
    setEnabled: (enabled) => {
        state.apiKillSwitchEnabled = Boolean(enabled);
        saveFeatureConfig();
    }
});

// --- Setting presets (/preset) --------------------------------------------
//
// A preset is a partial feature/scan config. Applying one merges it into the
    // on-disk settings and then runs the normal load path, so the launcher and
// the launcher's view of the config, and the per-connection live re-apply all
// behave exactly as they do for a hand-typed command. Nothing here pokes the
// ~70 module-level feature bindings directly.

function currentScanConfigSnapshot() {
    return {
        scanMode: state.scanMode,
        minFkdr: state.threatConfig.minFkdr,
        minStars: state.threatConfig.minStars,
        minSkywarsKdr: state.threatConfig.minSkywarsKdr,
        minSkywarsWlr: state.threatConfig.minSkywarsWlr,
        minSkywarsLevel: state.threatConfig.minSkywarsLevel,
        countTags: state.threatConfig.countTags
    };
}

function captureCurrentPresetSettings() {
    return filterPresetSettings({
        ...currentFeatureConfigSnapshot(),
        ...currentScanConfigSnapshot(),
        chatTriggers: loadChatTriggerSettings().triggers
    });
}

function applyPresetSettings(rawSettings) {
    const desired = filterPresetSettings(rawSettings);
    const before = captureCurrentPresetSettings();
    const { features, scan, chatTriggers } = splitByNamespace(desired);
    const skipped = [];
    const allowedFeatures = { ...features };
    try {
        if (Object.keys(allowedFeatures).length > 0) {
            saveFeatureSettings({ ...loadFeatureSettings(), ...allowedFeatures });
            loadFeatureConfig();
        }

        if (Object.keys(scan).length > 0) {
            if (scan.scanMode !== undefined) state.scanMode = scan.scanMode;
            PRESET_SETTING_KEYS.scan
                .filter(key => key !== 'scanMode')
                .forEach((key) => {
                    if (scan[key] !== undefined) state.threatConfig[key] = scan[key];
                });
            saveScanConfig();
        }

        if (Array.isArray(chatTriggers.chatTriggers)) {
            saveChatTriggerSettings({ triggers: chatTriggers.chatTriggers });
            loadChatTriggerConfig();
        }

        // Push the new values into the live connection (nametags, dodge
        // toggles, tab stats) the same way the launcher's settings save does.
        if (typeof applyLiveFeatureSettings === 'function') {
            applyLiveFeatureSettings();
        }
    } catch (error) {
        console.error('[Profiles] Failed to apply profile:', error.message);
        return { ok: false, changes: [], skipped, error: error.message || 'Could not apply profile.' };
    }

    return { ok: true, changes: diffPresetSettings(before, captureCurrentPresetSettings()), skipped };
}

const loadChatTriggerConfig = configLoader.loadChatTriggerConfig;

function loadConfig() {
    keys = configLoader.loadKeysConfig();
}

function saveConfig() {
    configLoader.saveKeysConfig(keys);
}

const loadScanConfig = configLoader.loadScanConfig;
const saveScanConfig = configLoader.saveScanConfig;

loadConfig();
loadScanConfig();
loadFeatureConfig({ resetAutoGamblerSession: true });
loadChatTriggerConfig();
const serverSettings = loadServerSettings();
const serverConfigs = [
    { port: serverSettings.proxyDirectPort, host: serverSettings.proxyDirectHost, name: 'Hypixel (Direct)', route: 'direct', favicon: FURY_DIRECT_SERVER_FAVICON },
    { port: serverSettings.proxyFailoverPort, host: serverSettings.proxyFailoverHost, name: 'Hypixel (Failover)', route: 'failover', favicon: FURY_FAILOVER_SERVER_FAVICON }
];

const proxyStartTime = Date.now();
const proxyHealthMonitor = createProxyHealthMonitor({
    isEnabled: () => proxyHealthWarningsEnabled,
    setEnabled: (enabled) => {
        proxyHealthWarningsEnabled = Boolean(enabled);
    },
    saveSettings: saveFeatureConfig,
    sendNotice: (message) => {
        const client = activeUser?.client;
        if (!client || client.state !== mc.states.PLAY) return;
        sendChat(client, message);
    },
    clearExpensiveQueues: () => {},
    pauseExpensiveFeatures: () => {
        if (typeof activeUser?.pauseExpensiveProxyFeatures === 'function') {
            activeUser.pauseExpensiveProxyFeatures();
        }
    }
});

function isProxyAutoThrottleActive(now = Date.now()) {
    return proxyHealthMonitor.isAutoThrottleActive(now);
}

function proxyHealthSnapshot(now = Date.now()) {
    return proxyHealthMonitor.snapshot(now);
}

function startProxyHealthMonitor() {
    return proxyHealthMonitor.start();
}
let lastScanSummary = { at: null, candidates: 0, results: 0, mode: state.scanMode, message: 'No scans yet' };

function legacyColorCodeToName(code) {
    const colors = {
        '§0': 'black',
        '§1': 'dark-blue',
        '§2': 'dark-green',
        '§3': 'dark-aqua',
        '§4': 'dark-red',
        '§5': 'dark-purple',
        '§6': 'gold',
        '§7': 'gray',
        '§8': 'dark-gray',
        '§9': 'blue',
        '§a': 'green',
        '§b': 'aqua',
        '§c': 'red',
        '§d': 'pink',
        '§e': 'yellow',
        '§f': 'white'
    };
    return colors[String(code || '').toLowerCase()] || 'white';
}

function numberOr(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function optionalNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

// Overlay tag parsing (getOverlayRankNameColor, parseOverlayUrchinTag,
// parseOverlaySeraphTag) plus the deduping buildOverlayTags assembler
// live in src/overlay/tags.js. buildOverlayTags depends on compactTagName
// (still defined in this file), so it's wired via createOverlayTagBuilder
// at module load and the resulting buildOverlayTags is destructured below.

function getOverlayTeamInfo(info = {}, mode = 'BEDWARS') {
    if (mode !== 'BEDWARS') return null;
    const visual = getBedwarsVisualTeamInfo(info, info?.name || '') || getBedwarsTeamInfo(info.team);
    if (visual) {
        return {
            name: visual.name || info.team || 'Unknown',
            letter: visual.letter || info.letter || '?',
            colorCode: visual.color || info.color || '§7',
            colorName: legacyColorCodeToName(visual.color || info.color || '§7')
        };
    }
    return {
        name: info.team || 'Unknown',
        letter: info.letter || '?',
        colorCode: info.color || info.displayColor || '§7',
        colorName: legacyColorCodeToName(info.color || info.displayColor || '§7')
    };
}

function buildOverlayPlayerRow(name, profile, options = {}) {
    // DUELS isn't a tab-stats mode, but the duels nametag overlay builds rows
    // in this mode to carry the current duel mode's WLR/KDR.
    const mode = options.mode === 'DUELS'
        ? 'DUELS'
        : (isSupportedTabStatsMode(options.mode) ? options.mode : 'BEDWARS');
    const data = profile?.data || profile || {};
    const p = data.player || {};
    const info = options.info || {};
    const denickResult = options.denickResult || null;
    const tags = buildOverlayTags(data);

    const ping = numberOr(data.ping?.ping, -1);
    const avgPing = numberOr(data.ping?.avgPing, -1);
    const team = getOverlayTeamInfo({ ...info, name }, mode);
    const nameColorCode = mode === 'BEDWARS'
        ? (team?.colorCode || info.color || info.displayColor || '§f')
        : (info.displayColor || extractDisplayColor(info.originalDisplayName, name) || '§f');

    const networkExp = Number(p.networkExp) || 0;
    const networkLevel = networkExp > 0 ? Math.max(1, Math.floor((Math.sqrt((2 * networkExp) + 30625) / 50) - 2.5)) : 0;

    const row = {
        name,
        realName: showDenickedRealIgn ? (denickResult?.realName || '') : '',
        mode,
        source: options.source || (profile?.fromCache ? 'cache' : 'lookup'),
        fromCache: Boolean(profile?.fromCache),
        updatedAt: Date.now(),
        networkLevel,
        guildTag: '',
        isNicked: Boolean(data.isNicked),
        lookupFailed: Boolean(data.lookupFailed),
        lookupErrorMessage: data.lookupErrorMessage || data.message || '',
        displayName: p.displayname || name,
        rankedName: p.displayname ? stripAnsi(getRankedName(p)) : name,
        rankNameColorCode: getOverlayRankNameColor(p),
        rankNameColorName: legacyColorCodeToName(getOverlayRankNameColor(p)),
        nameColorCode,
        nameColorName: legacyColorCodeToName(nameColorCode),
        team,
        ping,
        avgPing,
        status: stripAnsi(data.status || ''),
        tags,
        stats: {}
    };

    if (row.lookupFailed || row.isNicked || !p.stats) return row;

    if (mode === 'SKYWARS') {
        const sw = p.stats?.SkyWars || {};
        const skyWarsLevelLegacy = formatSkyWarsLevel(sw, p);
        const wins = numberOr(sw.wins, 0);
        const losses = numberOr(sw.losses, 0);
        const kills = numberOr(sw.kills, 0);
        const deaths = numberOr(sw.deaths, 0);
        row.stats = {
            level: numberOr(getSkyWarsLevelValue(sw, p), 0),
            levelText: stripAnsi(skyWarsLevelLegacy).replace(/[\[\]]/g, ''),
            levelLegacy: skyWarsLevelLegacy,
            wlr: ratioValue(wins, losses),
            kdr: ratioValue(kills, deaths),
            wins,
            losses,
            kills,
            deaths,
            assists: numberOr(sw.assists, 0),
            // A missing SkyWars streak is unavailable, not a real zero. Keep
            // that distinction so a configured nametag fallback can render.
            ws: optionalNumber(sw.win_streak),
            games: numberOr(sw.games, 0)
        };
        return row;
    }

    if (mode === 'DUELS') {
        // WLR/KDR for the mode currently being played (falls back to Overall
        // until the sidebar reveals the mode). Reuses the /duels collector so
        // the per-mode stat keys never drift from the stats card.
        const duels = p.stats?.Duels || {};
        const duelsModeDef = options.duelsModeDef || DUELS_MODE_DEFS[0];
        const d = collectDuelsStats(duels, duelsModeDef);
        row.stats = {
            wlr: d.wlr,
            kdr: d.kdr,
            wins: d.wins,
            losses: d.losses,
            kills: d.kills,
            deaths: d.deaths,
            ws: d.currentWs,
            games: d.games,
            duelsMode: duelsModeDef.id
        };
        return row;
    }

    const bw = p.stats?.Bedwars || {};
    const stars = numberOr(p.achievements?.bedwars_level, 0);
    const wins = numberOr(bw.wins_bedwars, 0);
    const losses = numberOr(bw.losses_bedwars, 0);
    const kills = numberOr(bw.kills_bedwars, 0);
    const deaths = numberOr(bw.deaths_bedwars, 0);
    const finals = numberOr(bw.final_kills_bedwars, 0);
    const finalDeaths = numberOr(bw.final_deaths_bedwars, 0);
    const beds = numberOr(bw.beds_broken_bedwars, 0);
    const bedsLost = numberOr(bw.beds_lost_bedwars, 0);
    row.stats = {
        stars,
        starsLegacy: formatBedwarsPrestige(stars),
        fkdr: ratioValue(finals, finalDeaths),
        wlr: ratioValue(wins, losses),
        kdr: ratioValue(kills, deaths),
        bblr: ratioValue(beds, bedsLost),
        wins,
        losses,
        kills,
        deaths,
        finals,
        finalDeaths,
        beds,
        bedsLost,
        // Hypixel omits/nulls this field when a player hides their winstreak.
        // Preserve a real `0`, but leave unavailable data null for fallback.
        ws: optionalNumber(bw.winstreak),
        games: numberOr(bw.games_played_bedwars, 0)
    };
    return row;
}

const healthServer = createHealthServer({
    isClosing: () => proxyStopping,
    trackDurableWork: work => commandDrains.track(work),
    state,
    proxyStartTime,
    chatTriggerManager,
    globalCache,
    auroraPingCache,
    getActiveUser: () => activeUser,
    getKeys: () => keys,
    getServerConfigs: () => serverConfigs,
    getLastScanSummary: () => lastScanSummary,
    getEnderDustReminderStatus: () => activeUser?.getEnderDustReminderStatus
        ? activeUser.getEnderDustReminderStatus()
        : null,
    getSlumberDailyRewardsReminderStatus: () => activeUser?.getSlumberDailyRewardsReminderStatus
        ? activeUser.getSlumberDailyRewardsReminderStatus()
        : null,
    getGamblerGeorgeReminderStatus: () => activeUser?.getGamblerGeorgeReminderStatus
        ? activeUser.getGamblerGeorgeReminderStatus()
        : null,
    getSessionHistory: (account = null, accountScoped = false, knownRevision = null) => {
        sessionStore.closeExpiredSessions(state.sessionBoundaryMinutes * 60 * 1000);
        return launcherSessionHistory.get(sessionStore, {
            limit: state.sessionRetention,
            sessionSettings: state, account, accountScoped, knownRevision
        });
    },
    removeSession: (sessionId, account) => sessionStore.removeSession(sessionId, { account }),
    removeDenickMapping,
    getFeatures: () => ({
        chatPrefixAccentHex: getChatPrefixAccent()?.sourceHex || '#e5b35d',
        tabStatsEnabled,
        autoScanOnGameStart,
        autoGamblerEnabled,
        autoDodgeEnabled,
        autoDodgeDelaySeconds,
        autoDodgeTaggedPlayers,
        autoDodgeNickedPlayers,
        autoDodgeStatThreats,
        autoDodgeIncludePreset,
        autoDodgeMinFkdr,
        autoDodgeMinStars,
        enderDustReminderEnabled,
        enderDustReminderThreshold,
        enderDustReminderLastReading,
        slumberDailyRewardsReminderEnabled,
        gamblerGeorgeReminderEnabled,
        gamblerGeorgeReminderState,
        autoSkinDenickEnabled,
        autoStatsDenickEnabled,
        denickChatAnnouncementsEnabled,
        denickPartyAnnounceEnabled,
        socialOverlayAddsEnabled,
        lobbyChatStatsEnabled,
        lobbyChatStatsMentionEnabled,
        lobbyChatStatsDmEnabled,
        lobbyChatStatsTriggerEnabled,
        accentBedwarsEventLabelsEnabled,
        bedwarsSidebarTeamColorsEnabled,
        pregameChatStatsEnabled,
        queueTimeEnabled,
        queueTimePartyChatEnabled,
        partySplitWarningsEnabled,
        overlayAutoAddOutsideGamesOnly: true,
        overlayAutoClearOnGameStartEnd: true,
        showDenickedRealIgn,
        showTagsInTabStats,
        enderDustReminderEnabled,
        enderDustReminderThreshold,
        enderDustReminderLastReading,
        slumberDailyRewardsReminderEnabled,
        gamblerGeorgeReminderEnabled,
        gamblerGeorgeReminderState,
        nametagOverlayEnabled,
        nametagStarBracketsEnabled,
        nametagTagDisplayMode,
        apiKillSwitchEnabled: state.apiKillSwitchEnabled,
        proxyHealthWarningsEnabled,
        sessionTrackingEnabled: state.sessionTrackingEnabled,
        gameRecapEnabled: state.gameRecapEnabled,
        replayDetailsEnabled: state.replayDetailsEnabled,
        shareTagsAuto: state.shareTagsAuto,
        shareTagsFancy: state.shareTagsFancy,
        shareTagsColorLocal: state.shareTagsColorLocal,
        shareTagsIncludeTagged: state.shareTagsIncludeTagged,
        shareTagsIncludeNicks: state.shareTagsIncludeNicks,
        shareTagsIncludeThreats: state.shareTagsIncludeThreats,
        shareTagsDestination: state.shareTagsDestination,
        shareTagsGroupByTeam: state.shareTagsGroupByTeam,
        tabStatsBedwarsMode,
        tabStatsSkywarsMode,
        tabStatsShowKillRatio,
        tabStatsShowWinRatio,
        tabStatsBedwarsFields,
        tabStatsSkywarsFields,
        tabStatsLabelStyle,
        nametagScope,
        nametagSourcePriority,
        nametagTeammatesEnabled,
        nametagTeammatesPrefix,
        nametagTeammatesPrefixFallback,
        nametagTeammatesSuffix,
        nametagTeammatesSuffixFallback,
        nametagThreatsEnabled,
        nametagThreatsPrefix,
        nametagThreatsPrefixFallback,
        nametagThreatsSuffix,
        nametagThreatsSuffixFallback,
        nametagOthersEnabled,
        nametagOthersPrefix,
        nametagOthersPrefixFallback,
        nametagOthersSuffix,
        nametagOthersSuffixFallback,
    }),
    getFeatureCompareSnapshot: () => ({
        runtimeFeatureRevision: JSON.stringify(currentFeatureConfigSnapshot()),
        runtimeScanRevision: JSON.stringify(currentScanConfigSnapshot()),
        chatPrefixAccentHex: getChatPrefixAccent()?.sourceHex || '#e5b35d',
        scanMode: state.scanMode,
        tabStatsEnabled,
        showDenickedRealIgn,
        showTagsInTabStats,
        nametagOverlayEnabled,
        nametagStarBracketsEnabled,
        nametagTagDisplayMode,
        nametagScope,
        nametagSourcePriority,
        nametagTeammatesEnabled,
        nametagTeammatesPrefix,
        nametagTeammatesPrefixFallback,
        nametagTeammatesSuffix,
        nametagTeammatesSuffixFallback,
        nametagThreatsEnabled,
        nametagThreatsPrefix,
        nametagThreatsPrefixFallback,
        nametagThreatsSuffix,
        nametagThreatsSuffixFallback,
        nametagOthersEnabled,
        nametagOthersPrefix,
        nametagOthersPrefixFallback,
        nametagOthersSuffix,
        nametagOthersSuffixFallback,
        accentBedwarsEventLabelsEnabled,
        bedwarsSidebarTeamColorsEnabled,
        sessionTrackingEnabled: state.sessionTrackingEnabled,
        sessionBoundaryMinutes: state.sessionBoundaryMinutes,
        sessionRetention: state.sessionRetention,
        replayDetailsEnabled: state.replayDetailsEnabled,
        gameRecapEnabled: state.gameRecapEnabled
    }),
    getApplyLiveFeatureSettings: () => applyLiveFeatureSettings,
    reportOverlayUiVisible,
    proxyHealthSnapshot,
    getHypixelApiUsageSnapshot,
    getUrchinRateLimitSnapshot,
    hasHypixelApiKeyConfigured,
    getPlayerDataWithNickDetection: (...args) => getPlayerDataWithNickDetection(...args),
    buildOverlayPlayerRow,
    sendChat,
    sendActionBar,
    reloadConfig: () => {
        loadConfig();
        loadScanConfig();
        loadFeatureConfig();
        loadChatTriggerConfig();
    },
    resetUrchinLookupState
});

const healthTimer = startProxyHealthMonitor();
ownedListeners.push(ownListener(healthServer.start(serverSettings.healthPort)));

// Launcher saves are persisted before the health notification is sent. Watch
// those files as a second delivery path so a brief HTTP timeout can never leave
// the running proxy on stale settings. The revision is based on runtime state,
// not file mtimes, so proxy-owned saves and duplicate fs events are harmless.
let liveSettingsWatcher = null;
let liveSettingsReloadTimer = null;

function runtimeConfigurationRevision() {
    return JSON.stringify({
        features: currentFeatureConfigSnapshot(),
        scan: currentScanConfigSnapshot(),
        keys
    });
}

function reloadRuntimeConfigurationFromDisk() {
    const beforeRevision = runtimeConfigurationRevision();
    const oldKeys = { ...keys };
    loadConfig();
    loadScanConfig();
    loadFeatureConfig();
    loadChatTriggerConfig();

    if (['hypixel', 'urchin', 'aurora', 'seraph'].some(key => oldKeys[key] !== keys[key])) {
        globalCache.clear();
        resetUrchinLookupState();
        auroraPingCache.clear();
    }

    const changed = beforeRevision !== runtimeConfigurationRevision();
    if (changed && typeof applyLiveFeatureSettings === 'function') applyLiveFeatureSettings();
    return changed;
}

function startLiveSettingsWatcher() {
    if (liveSettingsWatcher) return;
    const watchedNames = new Set([
        appConfigPaths.keys,
        appConfigPaths.scan,
        appConfigPaths.features,
        appConfigPaths.chatTriggers
    ].map(file => path.basename(file).toLowerCase()));
    try {
        liveSettingsWatcher = fs.watch(path.dirname(appConfigPaths.features), (eventType, filename) => {
            const changedName = filename ? path.basename(String(filename)).toLowerCase() : '';
            if (changedName && !watchedNames.has(changedName)) return;
            clearTimeout(liveSettingsReloadTimer);
            liveSettingsReloadTimer = setTimeout(() => {
                liveSettingsReloadTimer = null;
                try {
                    reloadRuntimeConfigurationFromDisk();
                } catch (error) {
                    console.error('[FEATURES ERROR] Live settings reload failed:', error.message);
                }
            }, 120);
            if (typeof liveSettingsReloadTimer.unref === 'function') liveSettingsReloadTimer.unref();
        });
        liveSettingsWatcher.on('error', (error) => {
            console.error('[FEATURES ERROR] Live settings watcher stopped:', error.message);
            liveSettingsWatcher = null;
        });
        if (typeof liveSettingsWatcher.unref === 'function') liveSettingsWatcher.unref();
    } catch (error) {
        console.error('[FEATURES ERROR] Live settings watcher unavailable:', error.message);
    }
}

startLiveSettingsWatcher();

serverConfigs.forEach(config => {
    createProxyServer(config.port, config.host, config.name, config);
});
 
function renderAutoGamblerController(client, context = {}) {
    const pending = Math.max(0, Number(context.pendingCommandCount || 0));
    const panel = createFeatureStatus({
        client, sendChat, title: 'Auto Gambler', subtitle: 'AUTOMATION',
        section: 'system', helpTopic: 'autogambler'
    });

    panel.open();
    panel.section('Overview');
    panel.toggleRow('Power', autoGamblerEnabled, '/autogambler on', '/autogambler off',
        `Watch for "${AUTOGAMBLER_TRIGGER_MESSAGE}" and accept automatically.`);
    panel.valueRow('Pending', pending > 0 ? `${pending} command${pending === 1 ? '' : 's'}` : 'none', {
        color: pending > 0 ? panel.colors.value : panel.colors.quiet
    });
    panel.section('Rule');
    panel.valueRow('When seen', AUTOGAMBLER_TRIGGER_MESSAGE, { color: 'white' });
    panel.valueRow('Send', AUTOGAMBLER_COMMAND, { color: 'white' });
    panel.close();
}

function handleAutoGamblerCommand(client, args, context = {}) {
    const mode = normalizeAutoGamblerToggle(args[1]);
    const subCmd = String(args[1] || 'status').toLowerCase();
    const render = () => renderAutoGamblerController(client, {
        pendingCommandCount: typeof context.getPendingCommandCount === 'function' ? context.getPendingCommandCount() : 0
    });
    if (mode === 'on') {
        autoGamblerEnabled = true;
        saveFeatureConfig();
        render();
        return;
    }
    if (mode === 'false') {
        autoGamblerEnabled = false;
        saveFeatureConfig();
        render();
        return;
    }
    if (subCmd === 'info') {
        sendChat(client, `\u00a76[AutoGambler] \u00a77When enabled, the proxy sends \u00a7e${AUTOGAMBLER_COMMAND}\u00a77 after detecting the exact chat prompt.`);
    }
    render();
}

function handleChatTriggerCommand(client, args) {
    chatTriggerManager.handleCommand(client, args, sendChat);
}

function parseLobbyChatStatsToggle(value) {
    const raw = String(value || '').toLowerCase();
    if (['on', 'enable', 'enabled', 'true', 'yes'].includes(raw)) return true;
    if (['off', 'disable', 'disabled', 'false', 'no'].includes(raw)) return false;
    return null;
}

function normalizeLobbyChatStatsSource(value) {
    const raw = String(value || '').toLowerCase().replace(/[_\-\s]+/g, '');
    if (['mention', 'mentions', 'me'].includes(raw)) return 'mention';
    if (['dm', 'dms', 'direct', 'directmessage', 'directmessages', 'pm', 'msg'].includes(raw)) return 'dm';
    if (['trigger', 'triggers', 'chattrigger', 'chattriggers', 'chat'].includes(raw)) return 'trigger';
    return '';
}

function getLobbyChatStatsSourceFlag(source) {
    if (source === 'mention') return lobbyChatStatsMentionEnabled;
    if (source === 'dm') return lobbyChatStatsDmEnabled;
    if (source === 'trigger') return lobbyChatStatsTriggerEnabled;
    return false;
}

function setLobbyChatStatsSourceFlag(source, value) {
    if (source === 'mention') lobbyChatStatsMentionEnabled = value;
    else if (source === 'dm') lobbyChatStatsDmEnabled = value;
    else if (source === 'trigger') lobbyChatStatsTriggerEnabled = value;
    else return false;
    saveFeatureConfig();
    return true;
}

function setOnlyLobbyChatStatsSource(source) {
    lobbyChatStatsEnabled = true;
    lobbyChatStatsMentionEnabled = source === 'mention';
    lobbyChatStatsDmEnabled = source === 'dm';
    lobbyChatStatsTriggerEnabled = source === 'trigger';
    saveFeatureConfig();
}

function canShowLobbyChatStatsForSource(type) {
    const source = normalizeLobbyChatStatsSource(type);
    return lobbyChatStatsEnabled && Boolean(source) && getLobbyChatStatsSourceFlag(source);
}

function sendLobbyChatStatsStatus(client) {
    const panel = createFeatureStatus({
        client, sendChat, title: 'Chat Stats', subtitle: 'LOBBY REPLIES',
        section: 'social', helpTopic: 'chatstats'
    });
    const enabledSources = [lobbyChatStatsMentionEnabled, lobbyChatStatsDmEnabled, lobbyChatStatsTriggerEnabled].filter(Boolean).length;

    panel.open();
    panel.section('Overview');
    panel.toggleRow('Power', lobbyChatStatsEnabled, '/chatstats on', '/chatstats off',
        'Print local stat lines when selected social events request them.');
    panel.valueRow('Active sources', `${enabledSources}/3`, {
        color: enabledSources ? panel.colors.active : panel.colors.quiet
    });
    panel.section('Sources');
    panel.toggleRow('Mentions', lobbyChatStatsMentionEnabled, '/chatstats source mention on', '/chatstats source mention off',
        'Show stats when lobby chat mentions your name.');
    panel.toggleRow('Direct messages', lobbyChatStatsDmEnabled, '/chatstats source dm on', '/chatstats source dm off',
        'Show stats for incoming direct messages.');
    panel.toggleRow('Chat triggers', lobbyChatStatsTriggerEnabled, '/chatstats source trigger on', '/chatstats source trigger off',
        'Show stats when a saved chat trigger matches.');
    panel.section('Presets');
    panel.row([
        ...panel.action('Mentions only', '/chatstats only mention', 'Enable only mention requests.'),
        chatController.text(' ', panel.colors.quiet),
        ...panel.action('DM only', '/chatstats only dm', 'Enable only direct-message requests.'),
        chatController.text(' ', panel.colors.quiet),
        ...panel.action('Triggers only', '/chatstats only trigger', 'Enable only saved chat triggers.'),
        chatController.text(' ', panel.colors.quiet),
        ...panel.action('All', '/chatstats all', 'Enable every source.')
    ]);
    panel.close();
}

function handleLobbyChatStatsCommand(client, args) {
    const subCmd = String(args[1] || 'status').toLowerCase();
    if (subCmd === 'status') {
        sendLobbyChatStatsStatus(client);
        return;
    }

    if (['on', 'enable', 'enabled', 'true'].includes(subCmd)) {
        lobbyChatStatsEnabled = true;
        saveFeatureConfig();
        sendLobbyChatStatsStatus(client);
        return;
    }

    if (['off', 'disable', 'disabled', 'false'].includes(subCmd)) {
        lobbyChatStatsEnabled = false;
        saveFeatureConfig();
        sendLobbyChatStatsStatus(client);
        return;
    }

    if (subCmd === 'source' || subCmd === 'sources') {
        const source = normalizeLobbyChatStatsSource(args[2]);
        if (!source) {
            sendChat(client, '\u00a7cUsage: /chatstats source mention|dm|trigger [on|off]');
            return;
        }
        const hasExplicitValue = args[3] !== undefined && String(args[3] || '').trim() !== '';
        const explicit = hasExplicitValue ? parseLobbyChatStatsToggle(args[3]) : null;
        if (hasExplicitValue && explicit === null) {
            sendChat(client, '\u00a7cUsage: /chatstats source mention|dm|trigger [on|off]');
            return;
        }
        const next = hasExplicitValue ? explicit : !getLobbyChatStatsSourceFlag(source);
        setLobbyChatStatsSourceFlag(source, next);
        sendLobbyChatStatsStatus(client);
        return;
    }

    if (subCmd === 'only') {
        const source = normalizeLobbyChatStatsSource(args[2]);
        if (!source) {
            sendChat(client, '\u00a7cUsage: /chatstats only mention|dm|trigger');
            return;
        }
        setOnlyLobbyChatStatsSource(source);
        sendLobbyChatStatsStatus(client);
        return;
    }

    if (subCmd === 'all' || subCmd === 'reset') {
        lobbyChatStatsEnabled = true;
        lobbyChatStatsMentionEnabled = true;
        lobbyChatStatsDmEnabled = true;
        lobbyChatStatsTriggerEnabled = true;
        saveFeatureConfig();
        sendLobbyChatStatsStatus(client);
        return;
    }

    const directSource = normalizeLobbyChatStatsSource(subCmd);
    if (directSource) {
        const explicit = parseLobbyChatStatsToggle(args[2]);
        if (args[2] !== undefined && explicit === null) {
            sendChat(client, '\u00a7cUsage: /chatstats mention|dm|trigger [on|off]');
            return;
        }
        setLobbyChatStatsSourceFlag(directSource, args[2] === undefined ? !getLobbyChatStatsSourceFlag(directSource) : explicit);
        sendLobbyChatStatsStatus(client);
        return;
    }

    sendChat(client, '\u00a7cUsage: /chatstats on/off/status/source/only/all');
}

function handleProxyHealthCommand(client, args) {
    proxyHealthMonitor.handleCommand(client, args, sendChat);
}

function formatHotkeyDebugData(data) {
    try {
        return JSON.stringify(data, (key, value) => {
            if (Buffer.isBuffer(value)) return `<Buffer ${value.toString('hex').slice(0, 48)}${value.length > 24 ? '...' : ''}>`;
            if (value && value.type === 'Buffer' && Array.isArray(value.data)) {
                return `<Buffer ${Buffer.from(value.data).toString('hex').slice(0, 48)}${value.data.length > 24 ? '...' : ''}>`;
            }
            return value;
        }).replace(/\s+/g, ' ').slice(0, 220);
    } catch (error) {
        return '[unserializable packet data]';
    }
}

function handleHotkeyDebugCommand(client, args, state) {
    const subCmd = String(args[1] || 'status').toLowerCase();
    if (['on', 'enable', 'enabled', 'true'].includes(subCmd)) {
        state.enabled = true;
        console.log(`[HotkeyDebug] Enabled. Watching: ${Array.from(HOTKEY_DEBUG_PACKETS).join(', ')}`);
        return;
    }
    if (['off', 'disable', 'disabled', 'false'].includes(subCmd)) {
        state.enabled = false;
        console.log('[HotkeyDebug] Disabled.');
        return;
    }
    console.log(`[HotkeyDebug] Status: ${state.enabled ? 'ON' : 'OFF'}. Watching: ${Array.from(HOTKEY_DEBUG_PACKETS).join(', ')}`);
}

const connectionAuth = require('./src/accounts/connectionAuth');

function createProxyServer(port, targetHost, serverName, options = {}) {
    const targetPort = Number(options.targetPort) || 25565;
    const serverFavicon = options.favicon || FURY_DIRECT_SERVER_FAVICON;
    const serverMotd = options.route === 'failover'
        ? `§6§lFury Gateway §8• §eFailover route\n§7Your backup when the direct connection is having trouble`
        : `§6§lFury Gateway §8• §bDirect route\n§7Threat checks, denicks, sessions, and overlays on the fastest path`;
    const proxy = mc.createServer({
        'online-mode': true,
        host: '127.0.0.1',
        port: port,
        version: '1.8.9',
        motd: serverMotd,
        ...(serverFavicon ? { favicon: serverFavicon } : {}),
        keepAlive: false,
        beforeLogin: applyCachedLoginProfile
    });

    ownedListeners.push(ownListener(proxy.socketServer));
    ownedListeners.push(require('./src/net/loopback').ownIpv6Loopback(proxy.socketServer));
    proxy.on('login', (client) => {
        if (proxyStopping) { client.end('Fury is stopping.'); return; }
        if (!connectionAuth.hasSavedLogin(AUTH_PATH, client.username)) {
            client.end(connectionAuth.messages.missing);
            return;
        }
        const teamDebug = createTeamDebugRecorder({ directory: dataPath('diagnostics', 'teams') });
        observeClientWrites(client, teamDebug);
        if (activeUser) {
            activeUser.hypixelClient.end();
            activeUser.client.end('§cNew session started.');
        }

        const hypixelClient = upstreamOwner.create({
            host: targetHost,
            port: targetPort,
            username: client.username,
            version: '1.8.9',
            auth: 'microsoft',
            keepAlive: false,
            profilesFolder: path.join(AUTH_PATH, client.username),
            onMsaCode: connectionAuth.requireBrowserSignIn
        });
        connectionAuth.guardConnection(client, hypixelClient, {onExpired:()=>{ if (!proxyStopping) connectionAuth.markSignInRequired(AUTH_PATH,client.username); }});
        const hypixelCommandQueue = createHypixelCommandQueue({
            minIntervalMs: DEFAULT_COMMAND_GAP_MS,
            canSend: () => hypixelClient.state === mc.states.PLAY,
            send: (command) => hypixelClient.write('chat', { message: command }),
            onError: (error, command) => console.warn(`[Fury] Could not send queued command ${command}: ${error.message}`)
        });
        const sendHypixelCommand = (command, queueOptions = {}) => hypixelCommandQueue.enqueue(command, queueOptions);
        activeUser = {
            name: client.username,
            client,
            hypixelClient,
            sendHypixelCommand,
            hypixelCommandQueue
        };
        hypixelClient.once('login',()=>{if(activeUser?.client===client)activeUser.upstreamReady=true;});
        reminderAccounts.remember(client.uuid, client.username);
        const reconnectedWithinPartyGrace = isWithinReconnectGrace(lastPartyDisconnectAt);
        resetUrchinOutageWarning();

        let lobbyPlayers = new Map();
        const scoreboardState = createScoreboardState();
        const {
            scoreboardTeamRegistry,
            scoreboardTeamAliases,
            originalScoreboardTeamsOnClient,
            scoreboardObjectiveTitles,
            rawScoreboardTeams,
            scoreboardEntryTeams,
            scoreboardLines
        } = scoreboardState;
        let defaultTabSnapshot = createDefaultTabSnapshot();
        const sidebarTeamStatusById = new Map();
        let uuidMap = new Map();
        let sidebarScoreboardObjective = '';
        let lastScoreboardTitle = '';
        let gameActive = false;
        // Only true when we witnessed the pregame -> active game transition on
        // this connection. Stays false after a snapshot restore (rejoin) so
        // /share won't fire on games we joined mid-way.
        let presentAtGameStart = false;
        let scanInProgress = false;
        let scanInProgressPromise = null;
        let detectedNickedPlayers = new Map();
        // When each settled nick last had a real lookup run against it. A nick
        // is not re-asked on every tab refresh (see
        // getStatsProfileForRosterPlayer), so this is what keeps a wrong nick
        // call from lasting the whole match.
        const settledNickVerifiedAt = new Map();
        const SETTLED_NICK_RECHECK_MS = 60 * 1000;
        let denickTracker = null; // initialized below once closure deps are reachable
        let autoDenickStats, autoDenickResults, autoDenickNickChecks, autoSkinDenickAttempts;
        let ownIdentity = null; // initialized below once nickKey/isValidPlayerName/normalizeUuid are reachable
        let myTeam = null;
        let gameStartTime = null;
        let activeSessionGameEvents = [];
        let sessionGameFinalized = false;
        let activeSessionGameMetadata = null;
        // Hypixel's server id for the game currently being played, read off the
        // sidebar next to the date. It has to be captured CONTINUOUSLY while the
        // game runs: snapshots are written on match reset, by which point the
        // sidebar has usually already flipped away and reading it there yields
        // nothing at all. See getFreshLastMatchSnapshot for what it is for.
        let activeMatchServerId = null;
        let currentGamemode = null;
        // Duels is tracked separately from currentGamemode so the Bedwars/SkyWars
        // tab-stats / nametag / overlay machinery (all gated on
        // isSupportedTabStatsMode) stays untouched. This holds just what the
        // /scan path needs: whether we're in a duel, which mode def, and the
        // opponent IGNs. sessionId bumps on every enter/leave so stale async
        // scans self-cancel.
        let duelsState = { active: false, modeDef: null, modeName: '', opponents: [], sessionId: 0 };
        let duelsAutoScanTimer = null;
        // Active live /share streaming sink, if a scan is currently feeding one.
        let activeShareStream = null;
        let gameRoster = new Set();
        // Unlike gameRoster, this is append-only for the lifetime of one game.
        // Hypixel removes eliminated/disconnected players from player_info and
        // later roster seeds can drop them, but /denick add must still be able
        // to tab-complete every nick and real IGN observed in the match.
        let currentGamePlayerNames = new Map();
        // BedWars team of every player seen in the current game, kept after
        // they leave the tab list: the game-end roster otherwise loses anyone
        // who requeued before the game was over (usually your own teammates).
        let currentGameTeams = new Map();
        let activePlayerCosmetics = new Map();
        let nickCapablePlayers = new Map();
        let entityTracker = null; // initialized below once closure deps are reachable
        let overlayPlayerStats = new Map();
        let manualOverlayPlayers = new Map();
        let bedwarsPregameActive = false;
        const lookingForTriggers = createLookingForTriggers();
        let bedwarsPregameSessionId = 0;
        let bedwarsPregameLobbyId = null;
        let bedwarsPregameMap = null;
        let bedwarsPregameLocalQueue = null;
        let bedwarsPregameLocalUnsupported = false;
        let pregameChatSeenPlayers = new Set();
        let pregameChatLookupsInFlight = new Set();
        let pregameChatLookupPromises = new Map();
        let pregameChatPlayerProfiles = new Map();
        let partyDenickReview = null;
        const PARTY_DENICK_REVIEW_TTL_MS = 2 * 60 * 1000;
        const PARTY_DENICK_AUTO_REVIEW_DELAYS = [2800, 4200, 6200];
        let partyDenickAutoReviewTimer = null;
        let lobbyChatStatsShownPlayers = new Set();
        let lobbyChatStatsQueue = [];
        let lobbyChatStatsQueuedPlayers = new Set();
        let lobbyChatStatsProcessing = false;
        let lobbyChatStatsQueueTimer = null;
        const LOBBY_CHAT_STATS_QUEUE_MAX = 24;
        const LOBBY_CHAT_STATS_QUEUE_TTL_MS = 8000;
        const LOBBY_CHAT_STATS_QUEUE_RETRY_MS = 400;
        let suppressedOverlayLiveSession = null;
        let overlayStatsTimers = new Map();
        const hotkeyDebugState = { enabled: false };
        let pendingAutoScanTimer = null;
        let delayedRosterSyncTimer = null;
        let matchSnapshotTimer = null;
        let pendingMatchSnapshotReason = '';
        let connectionTimersCleared = false;
        let connectionPersistenceFlushed = false;
        let gameSessionId = 0;
        let gamblerGeorgeTransitionId = 0;
        // The BedWars game a VICTORY!/GAME OVER! banner belongs to, kept alive
        // past resetMatchState so a banner that lands after a fast /leave still
        // scores the Gambler George bet.
        let recentBedwarsSessionId = null;
        let recentBedwarsAt = 0;
        // 1.8's named_sound_effect is positional, so a client-only alert sound
        // is only audible if we fire it where the player actually is. Tracked
        // from both directions: the server's teleports seed it at join and
        // after every warp, the client's own movement keeps it current.
        let ownPosition = null;
        let lastBedwarsGameSessionId = null;
        let autoDenickGraceUntil = 0;
        const PLAYER_SNAPSHOT_TTL = 12 * 60 * 1000;
        const AUTO_DENICK_POST_GAME_GRACE_MS = 60 * 1000;

        const cosmeticEffectRecorder = createEffectRecorder({
            sendChat: message => sendChat(client, message),
            library: cosmeticEffectLibrary,
            resolvePlayerPosition: (name) => {
                const entry = entityTracker?.getEntityByName(name);
                return entry && Number.isFinite(Number(entry.x))
                    ? { x: Number(entry.x), y: Number(entry.y), z: Number(entry.z) }
                    : null;
            }
        });
        function controllerModeText() {
            if (isNametagOverlayActiveDuels()) {
                return `DUELS${duelsState.modeDef ? ` (${duelsState.modeDef.label})` : ''}`;
            }
            return currentGamemode || 'not in game';
        }

        function scanFreshnessParts() {
            const snapshot = state.lastScanResults;
            if (!snapshot?.at || !Array.isArray(snapshot.results)) {
                return [chatController.text('none', 'red')];
            }
            const ageSeconds = Math.max(0, Math.round((Date.now() - snapshot.at) / 1000));
            const freshHere = hasCurrentGameScanSnapshot(snapshot);
            return [
                chatController.text(freshHere ? `${ageSeconds}s ago` : 'not for this game', freshHere ? 'green' : 'red'),
                chatController.text(` (${snapshot.results.length} rows)`, 'gray')
            ];
        }

        function renderTabStatsController() {
            const activeHere = isTabStatsActiveInGame();
            const canClear = activeHere || tabStatsAppliedNames.size > 0;
            const panel = createFeatureStatus({
                client, sendChat, title: 'Tab Stats', subtitle: 'PLAYER LIST',
                section: 'play', helpTopic: 'tabstats'
            });

            function modeChips(currentValue, mode) {
                const bw = mode === 'bedwars';
                const command = value => `/tabstats ${bw ? 'bw' : 'sw'} ${value}`;
                const hoverFor = v => `${bw ? 'BedWars' : 'SkyWars'}: always ${v === 'on' ? 'on' : v === 'off' ? 'off' : 'follow default'}.`;
                return [
                    ...panel.chip('on', currentValue === 'on', command('on'), hoverFor('on'), { selectedColor: panel.colors.active }),
                    chatController.text(' ', panel.colors.quiet),
                    ...panel.chip('off', currentValue === 'off', command('off'), hoverFor('off'), { selectedColor: panel.colors.quiet }),
                    chatController.text(' ', panel.colors.quiet),
                    ...panel.chip('auto', currentValue === 'auto', command('auto'), hoverFor('auto'))
                ];
            }

            function toggleChip(labelText, enabled, command, hoverLines) {
                return panel.chip(labelText, enabled, command, hoverLines, {
                    selectedColor: panel.colors.active,
                    unselectedColor: panel.colors.quiet,
                    clickSelected: true
                });
            }

            panel.open();
            panel.section('Overview');
            panel.toggleRow('Power', tabStatsEnabled, '/tabstats on', '/tabstats off',
                'Render compact player stats inside the tab list.');
            panel.row([
                panel.label('Active here'),
                chatController.component(activeHere ? 'active' : 'inactive', activeHere ? panel.colors.active : panel.colors.muted, { bold: activeHere })
            ]);
            panel.row([
                panel.label('Mode'),
                chatController.component(controllerModeText(), activeHere ? 'white' : panel.colors.muted)
            ]);

            panel.section('Game rules');
            panel.row([
                panel.label('BedWars'),
                ...modeChips(tabStatsBedwarsMode, 'bedwars')
            ]);
            panel.row([
                panel.label('SkyWars'),
                ...modeChips(tabStatsSkywarsMode, 'skywars')
            ]);

            panel.section('Display columns');
            panel.row([
                panel.label('Kill ratio'),
                ...toggleChip('FKDR/KDR', tabStatsShowKillRatio,
                    `/tabstats col kr ${tabStatsShowKillRatio ? 'off' : 'on'}`,
                    tabStatsShowKillRatio ? 'Click to hide the kill-ratio column.' : 'Click to show the kill-ratio column.')
            ]);
            panel.row([
                panel.label('Win ratio'),
                ...toggleChip('WLR', tabStatsShowWinRatio,
                    `/tabstats col wr ${tabStatsShowWinRatio ? 'off' : 'on'}`,
                    tabStatsShowWinRatio ? 'Click to hide the win-ratio column.' : 'Click to show the win-ratio column.')
            ]);
            panel.row([
                panel.label('Tags'),
                ...toggleChip('Urchin/Seraph', showTagsInTabStats,
                    `/tabstats tags ${showTagsInTabStats ? 'off' : 'on'}`,
                    showTagsInTabStats ? 'Click to hide tags.' : 'Click to show tags.')
            ]);

            panel.section('Maintenance');
            panel.row([
                ...panel.action('Clear names', canClear ? '/tabstats clear' : null,
                    canClear ? 'Restore current tab names now.' : 'Tab Stats is not active here.',
                    { locked: !canClear })
            ]);
            panel.close();
        }

        function normalizeNametagAudience(value) {
            const audience = String(value || '').toLowerCase();
            if (['teammate', 'team', 'teammates'].includes(audience)) return 'teammates';
            if (['threat', 'threats'].includes(audience)) return 'threats';
            if (['other', 'others', 'everyone'].includes(audience)) return 'others';
            return null;
        }

        function nametagAudienceValues(audience) {
            if (audience === 'teammates') return {
                enabled: nametagTeammatesEnabled,
                prefix: nametagTeammatesPrefix,
                prefixFallback: nametagTeammatesPrefixFallback,
                suffix: nametagTeammatesSuffix,
                suffixFallback: nametagTeammatesSuffixFallback
            };
            if (audience === 'threats') return {
                enabled: nametagThreatsEnabled,
                prefix: nametagThreatsPrefix,
                prefixFallback: nametagThreatsPrefixFallback,
                suffix: nametagThreatsSuffix,
                suffixFallback: nametagThreatsSuffixFallback
            };
            return {
                enabled: nametagOthersEnabled,
                prefix: nametagOthersPrefix,
                prefixFallback: nametagOthersPrefixFallback,
                suffix: nametagOthersSuffix,
                suffixFallback: nametagOthersSuffixFallback
            };
        }

        function setNametagAudienceEnabled(audience, enabled) {
            if (audience === 'teammates') nametagTeammatesEnabled = enabled;
            else if (audience === 'threats') nametagThreatsEnabled = enabled;
            else nametagOthersEnabled = enabled;
            saveFeatureConfig();
            applyNametagConfigChange();
        }

        function setNametagAudienceStat(audience, slot, value) {
            const stat = normalizeNametagStat(value, null);
            if (!stat) return false;
            const normalizedSlot = String(slot || '').toLowerCase();
            const prefix = normalizedSlot === 'prefix' || normalizedSlot === 'prefixfallback';
            const fallback = normalizedSlot === 'prefixfallback' || normalizedSlot === 'suffixfallback';
            if (audience === 'teammates') {
                if (prefix && fallback) nametagTeammatesPrefixFallback = stat;
                else if (prefix) nametagTeammatesPrefix = stat;
                else if (fallback) nametagTeammatesSuffixFallback = stat;
                else nametagTeammatesSuffix = stat;
            } else if (audience === 'threats') {
                if (prefix && fallback) nametagThreatsPrefixFallback = stat;
                else if (prefix) nametagThreatsPrefix = stat;
                else if (fallback) nametagThreatsSuffixFallback = stat;
                else nametagThreatsSuffix = stat;
            } else {
                if (prefix && fallback) nametagOthersPrefixFallback = stat;
                else if (prefix) nametagOthersPrefix = stat;
                else if (fallback) nametagOthersSuffixFallback = stat;
                else nametagOthersSuffix = stat;
            }
            saveFeatureConfig();
            applyNametagConfigChange();
            return true;
        }

        function renderNametagController() {
            const panel = createFeatureStatus({
                client, sendChat, title: 'Name Tags', subtitle: 'ABOVE PLAYERS',
                section: 'play', helpTopic: 'nametags'
            });
            const label = stat => NAMETAG_STAT_SHORT_LABELS[normalizeNametagStat(stat, 'none')] || 'None';
            panel.open();
            panel.section('Overview');
            panel.toggleRow('Power', nametagOverlayEnabled, '/nametags on', '/nametags off',
                'Add selected stats and tags to player name prefixes and suffixes.');
            panel.row([
                panel.label('Tag source'),
                ...panel.pick('Urchin', nametagSourcePriority === 'urchin', '/nametags source urchin', 'Prefer Urchin tags.'),
                chatController.text(' ', panel.colors.quiet),
                ...panel.pick('Seraph', nametagSourcePriority === 'seraph', '/nametags source seraph', 'Prefer Seraph tags.')
            ]);
            panel.row([
                panel.label('Tag style'),
                ...panel.pick('Acronyms', nametagTagDisplayMode === 'acronyms', '/nametags style acronyms', 'Use BC, CC, CF, CA, SN, LS, AC, and BL.'),
                chatController.text(' ', panel.colors.quiet),
                ...panel.pick('Full', nametagTagDisplayMode === 'full', '/nametags style full', 'Use full classification labels, shortened only by the Minecraft field limit.')
            ]);
            panel.section('Audiences');
            ['teammates', 'threats', 'others'].forEach(audience => {
                const values = nametagAudienceValues(audience);
                const name = NAMETAG_AUDIENCE_LABELS[audience] || audience;
                panel.toggleRow(name, values.enabled, `/nametags ${audience} on`, `/nametags ${audience} off`,
                    `Control name-tag fields for ${name.toLowerCase()}.`);
                panel.row([
                    panel.label('  Prefix'),
                    ...panel.action(label(values.prefix), `/nametags ${audience} prefix `,
                        `Set the ${name.toLowerCase()} prefix. Choose: ${NAMETAG_STAT_TYPES.join(', ')}.`, { action: 'suggest_command' }),
                    chatController.text(' ', panel.colors.quiet),
                    ...panel.action(`fallback ${label(values.prefixFallback)}`, `/nametags ${audience} prefixfallback `,
                        'Set the fallback used when the primary prefix has no value.', { action: 'suggest_command' })
                ]);
                panel.row([
                    panel.label('  Suffix'),
                    ...panel.action(label(values.suffix), `/nametags ${audience} suffix `,
                        `Set the ${name.toLowerCase()} suffix. Choose: ${NAMETAG_STAT_TYPES.join(', ')}.`, { action: 'suggest_command' }),
                    chatController.text(' ', panel.colors.quiet),
                    ...panel.action(`fallback ${label(values.suffixFallback)}`, `/nametags ${audience} suffixfallback `,
                        'Set the fallback used when the primary suffix has no value.', { action: 'suggest_command' })
                ]);
            });
            panel.section('Maintenance');
            panel.row([
                ...panel.action('Refresh names', '/nametags refresh', 'Rebuild name tags from current player data.'),
                chatController.text(' ', panel.colors.quiet),
                ...panel.action('Clear now', '/nametags clear', 'Restore the original names immediately.')
            ]);
            panel.close();
        }

        function handleNametagCommand(mode, fullArgs = []) {
            const action = String(mode || 'status').toLowerCase();
            if (action === 'status') return renderNametagController();
            if (action === 'on' || action === 'off') {
                nametagOverlayEnabled = action === 'on';
                saveFeatureConfig();
                applyNametagConfigChange();
                return renderNametagController();
            }
            if (action === 'refresh') {
                refreshNametagRosterStats();
                return sendChat(client, '§6[NameTags] §aNames refreshed.');
            }
            if (action === 'clear') {
                clearNametagTeams({ restoreOriginalTeams: true });
                return sendChat(client, '§6[NameTags] §aNames restored.');
            }
            if (action === 'source') {
                const source = normalizeNametagSourcePriority(fullArgs[2], '');
                if (!source) return sendChat(client, '§cUsage: /nametags source urchin|seraph');
                nametagSourcePriority = source;
                saveFeatureConfig();
                applyNametagConfigChange();
                return renderNametagController();
            }
            if (action === 'style' || action === 'tagstyle') {
                const requestedStyle = String(fullArgs[2] || '').trim().toLowerCase();
                const tagStyle = NAMETAG_TAG_DISPLAY_MODES.includes(requestedStyle) ? requestedStyle : '';
                if (!tagStyle) return sendChat(client, `§cUsage: /nametags style ${NAMETAG_TAG_DISPLAY_MODES.join('|')}`);
                nametagTagDisplayMode = tagStyle;
                saveFeatureConfig();
                applyNametagConfigChange();
                return renderNametagController();
            }
            const audience = normalizeNametagAudience(action === 'slot' ? fullArgs[2] : action);
            const offset = action === 'slot' ? 3 : 2;
            if (!audience) return sendChat(client, '§cUsage: /nametags on|off|status|refresh|clear|source|style or /nametags <teammates|threats|others> <on|off|prefix|suffix> [stat]');
            const sub = String(fullArgs[offset] || '').toLowerCase();
            if (sub === 'on' || sub === 'off') {
                setNametagAudienceEnabled(audience, sub === 'on');
                return renderNametagController();
            }
            if (['prefix', 'suffix', 'prefixfallback', 'suffixfallback'].includes(sub)) {
                const stat = String(fullArgs[offset + 1] || '').toLowerCase();
                if (!setNametagAudienceStat(audience, sub, stat)) {
                    return sendChat(client, `§cChoose one: ${NAMETAG_STAT_TYPES.join(', ')}`);
                }
                return renderNametagController();
            }
            return renderNametagController();
        }

        function renderShareController() {
            const settings = shareTagsBroadcaster.getSettings();
            const panel = createFeatureStatus({
                client, sendChat, title: 'Share', subtitle: 'SCAN BROADCASTS',
                section: 'social', helpTopic: 'share'
            });

            panel.open();
            panel.section('Overview');
            panel.toggleRow('Automatic', settings.auto, '/share auto on', '/share auto off',
                'Broadcast included results after automatic scans.');
            panel.row([
                panel.label('Scan'),
                ...scanFreshnessParts()
            ]);
            panel.section('Delivery');
            panel.row([
                panel.label('Destination'),
                ...panel.pick('Party', settings.destination === 'party', '/share dest party', 'Send broadcasts via /pc.'),
                chatController.text(' ', panel.colors.quiet),
                ...panel.pick('All', settings.destination === 'all', '/share dest all', 'Send broadcasts via /all (lobby chat).')
            ]);
            panel.row([
                panel.label('Line style'),
                ...panel.pick('Compact', !settings.fancy, '/share style compact', 'Use compact, plain-text-friendly lines.'),
                chatController.text(' ', panel.colors.quiet),
                ...panel.pick('Detailed', settings.fancy, '/share style detailed', 'Include star levels, icons, and separators in your local rendering.')
            ]);
            panel.toggleRow('Local color', settings.colorLocal, '/share color on', '/share color off',
                'Recolor your own echoed share lines locally; recipients still receive plain text.');

            panel.section('Automatic filters');
            panel.row([
                panel.label('Players'),
                ...panel.flag('Tagged', settings.tagged,
                    `/share include tagged ${settings.tagged ? 'off' : 'on'}`,
                    settings.tagged ? 'Click to exclude tagged players.' : 'Click to include tagged players.'),
                chatController.text(' ', panel.colors.quiet),
                ...panel.flag('Nicked', settings.nicks,
                    `/share include nicks ${settings.nicks ? 'off' : 'on'}`,
                    settings.nicks ? 'Click to exclude nicked players.' : 'Click to include nicked players.'),
                chatController.text(' ', panel.colors.quiet),
                ...panel.flag('Threats', settings.threats,
                    `/share include threats ${settings.threats ? 'off' : 'on'}`,
                    settings.threats ? 'Click to exclude stat threats.' : 'Click to include stat threats.')
            ]);

            panel.section('Manual broadcast');
            panel.row([
                panel.label('Send'),
                ...panel.action('All', '/share all', 'Broadcast all share categories.'),
                chatController.text(' ', panel.colors.quiet),
                ...panel.action('Tagged', '/share tag', 'Broadcast tagged players.'),
                chatController.text(' ', panel.colors.quiet),
                ...panel.action('Nicked', '/share nick', 'Broadcast nicked players.'),
                chatController.text(' ', panel.colors.quiet),
                ...panel.action('Threats', '/share threat', 'Broadcast stat threats.')
            ]);
            panel.row([
                panel.label('Preview'),
                ...panel.action('Show samples', '/share preview', 'Show colored sample lines (tags, cheaters, nicks, caution, threats) in your chat. Sends nothing.')
            ]);
            panel.close();
        }

        const furyMenu = createFuryMenu({ sendChat });

        function furyMenuSnapshot() {
            const shareSettings = shareTagsBroadcaster.getSettings();
            const scanSnapshot = state.lastScanResults;
            const scanAge = scanSnapshot?.at
                ? Math.max(0, Math.round((Date.now() - scanSnapshot.at) / 1000))
                : null;
            return {
                context: controllerModeText(),
                gameActive,
                scanMode: state.scanMode,
                scanFreshness: scanAge === null
                    ? ''
                    : hasCurrentGameScanSnapshot()
                        ? `${scanAge}s ago`
                        : 'old scan',
                tabStatsEnabled,
                nametagOverlayEnabled,
                eventLabelsEnabled: accentBedwarsEventLabelsEnabled,
                teamColorsEnabled: bedwarsSidebarTeamColorsEnabled,
                accentHex: getChatPrefixAccent()?.sourceHex || '#a66bea',
                autoDodgeEnabled,
                partySplitWarningsEnabled,
                autoSkinDenickEnabled,
                autoStatsDenickEnabled,
                partyOverviewEnabled,
                dodgeDelaySeconds: autoDodgeDelaySeconds,
                dodgeMinFkdr: autoDodgeMinFkdr,
                dodgeMinStars: autoDodgeMinStars,
                shareAuto: shareSettings.auto,
                chatStatsEnabled: lobbyChatStatsEnabled,
                socialAddsEnabled: socialOverlayAddsEnabled,
                pregameAddsEnabled: pregameChatStatsEnabled,
                sessionTrackingEnabled: state.sessionTrackingEnabled,
                gameRecapEnabled: state.gameRecapEnabled,
                sessionBoundaryMinutes: state.sessionBoundaryMinutes,
                sessionRetention: state.sessionRetention,
                sessionRecapStyle: state.sessionRecapStyle,
                goalWins: state.sessionGoalWins,
                goalFinals: state.sessionGoalFinals,
                goalGames: state.sessionGoalGames,
                goalMinutes: state.sessionGoalMinutes,
                dustReminderEnabled: enderDustReminderEnabled,
                dustThreshold: enderDustReminderThreshold,
                dailyReminderEnabled: slumberDailyRewardsReminderEnabled,
                gamblerGeorgeReminderEnabled,
                proxyHealthEnabled: proxyHealthWarningsEnabled,
                apiKillSwitchEnabled: state.apiKillSwitchEnabled,
                autoGamblerEnabled,
                configuredApiKeys: [keys.hypixel, keys.urchin, keys.aurora, keys.seraph].filter(Boolean).length
            };
        }

        function renderFuryMenu(page = 'home', options = {}) {
            furyMenu.render(client, page, furyMenuSnapshot(), options);
        }

        function parseFuryToggle(value) {
            const normalized = String(value || '').trim().toLowerCase();
            if (['on', 'true', 'yes', 'enable', 'enabled'].includes(normalized)) return true;
            if (['off', 'false', 'no', 'disable', 'disabled'].includes(normalized)) return false;
            return null;
        }

        function finishFurySetting(page, message) {
            saveFeatureConfig();
            if (typeof applyLiveFeatureSettings === 'function') applyLiveFeatureSettings();
            if (message) sendChat(client, `§8[§d§lFury§8] §7${message}`);
            renderFuryMenu(page);
        }

        function handleFurySetting(args) {
            const key = String(args[2] || '').trim().toLowerCase().replace(/[_-]+/g, '');
            const value = String(args[3] || '').trim().toLowerCase();

            if (['eventlabels', 'events', 'chatlabels'].includes(key)) {
                const enabled = parseFuryToggle(value);
                if (enabled === null) return false;
                accentBedwarsEventLabelsEnabled = enabled;
                finishFurySetting('play', `BedWars event labels are now ${enabled ? '§aon' : '§coff'}§7.`);
                return true;
            }
            if (['teamcolors', 'scoreboardcolors', 'teams'].includes(key)) {
                const enabled = parseFuryToggle(value);
                if (enabled === null) return false;
                bedwarsSidebarTeamColorsEnabled = enabled;
                finishFurySetting('play', `BedWars team colors are now ${enabled ? '§aon' : '§coff'}§7.`);
                return true;
            }
            if (['socialadds', 'autoadds', 'social'].includes(key)) {
                const enabled = parseFuryToggle(value);
                if (enabled === null) return false;
                socialOverlayAddsEnabled = enabled;
                finishFurySetting('social', `Automatic social overlay additions are now ${enabled ? '§aon' : '§coff'}§7.`);
                return true;
            }
            if (['boundary', 'sessionboundary'].includes(key)) {
                const minutes = Math.round(Number(value));
                if (!SESSION_BOUNDARY_MINUTES.includes(minutes)) return false;
                state.sessionBoundaryMinutes = minutes;
                finishFurySetting('history', `A new session begins after §f${minutes} inactive minutes§7.`);
                return true;
            }
            if (['retention', 'historyretention', 'keep'].includes(key)) {
                const count = Math.round(Number(value));
                if (!SESSION_RETENTION_CHOICES.includes(count)) return false;
                state.sessionRetention = count;
                finishFurySetting('history', count === 0 ? 'Session history retention is §funlimited§7.' : `Keeping the newest §f${count} sessions§7.`);
                return true;
            }
            if (['recapstyle', 'recaplayout', 'style'].includes(key)) {
                if (!SESSION_RECAP_STYLES.includes(value)) return false;
                state.sessionRecapStyle = value;
                finishFurySetting('history', `Recap layout is now §f${value}§7.`);
                return true;
            }
            if (key === 'goal') {
                const goalKey = String(args[3] || '').trim().toLowerCase();
                const rawTarget = Number(args[4]);
                if (!Number.isFinite(rawTarget) || rawTarget < 0) return false;
                const stateKey = {
                    wins: 'sessionGoalWins',
                    win: 'sessionGoalWins',
                    finals: 'sessionGoalFinals',
                    finalkills: 'sessionGoalFinals',
                    games: 'sessionGoalGames',
                    game: 'sessionGoalGames',
                    minutes: 'sessionGoalMinutes',
                    time: 'sessionGoalMinutes'
                }[goalKey];
                if (!stateKey) return false;
                state[stateKey] = normalizeGoal(rawTarget, stateKey === 'sessionGoalMinutes' ? 10080 : 100000);
                finishFurySetting('history', `${goalKey} goal set to §f${state[stateKey]}§7.`);
                return true;
            }
            return false;
        }

        function handleFuryCommand(args) {
            const sub = String(args[1] || '').trim().toLowerCase();
            if (!sub) {
                renderFuryMenu('home');
                return;
            }

            if (sub === 'accent' || sub === 'color' || sub === 'colour') {
                const requested = String(args[2] || '').trim().toLowerCase();
                if (!/^#[0-9a-f]{6}$/.test(requested)) {
                    sendChat(client, '§8[§d§lFury§8] §7Usage: §f/fury accent #RRGGBB');
                    renderFuryMenu('play');
                    return;
                }
                const accent = normalizeHexColor(requested);
                setChatPrefixAccent(accent);
                finishFurySetting('play', `Chat accent set to §f${accent.toUpperCase()}§7.`);
                return;
            }

            if (sub === 'set') {
                if (!handleFurySetting(args)) {
                    sendChat(client, '§8[§d§lFury§8] §7Unknown value. Open §f/fury help settings §7for valid settings and examples.');
                    renderFuryMenu('help', { topic: 'settings' });
                }
                return;
            }

            if (sub === 'help' || sub === 'guide' || sub === '?') {
                const requestedTopic = String(args[2] || '').trim().toLowerCase();
                const topic = FURY_HELP_TOPICS[requestedTopic]
                    ? requestedTopic
                    : normalizeFuryPage(requestedTopic, '');
                renderFuryMenu('help', { topic: topic === 'help' || topic === 'home' ? '' : topic });
                return;
            }

            const page = normalizeFuryPage(sub, '');
            if (page) {
                renderFuryMenu(page);
                return;
            }

            sendChat(client, `§8[§d§lFury§8] §7Unknown page §f${sub}§7. Try §f/fury help§7.`);
            renderFuryMenu('help');
        }

        function controllerNumber(value, fallback = 0) {
            const number = Number(value);
            return Number.isFinite(number) ? number : fallback;
        }

        function stepNumber(value, delta, min = 0, digits = 2) {
            const next = Math.max(min, controllerNumber(value) + delta);
            return Number(next.toFixed(digits));
        }

        function renderThresholdRow(panel, labelText, valueText, valueColor, downDelta, upDelta, downCommand, upCommand, editCommand, canDown) {
            panel.row([
                panel.label(labelText, 16),
                chatController.component(`${valueColor || ''}${String(valueText).padEnd(8)}`, 'white'),
                ...panel.action('-', canDown ? downCommand : null, canDown ? `Lower by ${downDelta}.` : 'Already at minimum.', { locked: !canDown }),
                chatController.text(' ', panel.colors.quiet),
                ...panel.action('edit', editCommand, `Type a new ${labelText} value.`, { action: 'suggest_command' }),
                chatController.text(' ', panel.colors.quiet),
                ...panel.action('+', upCommand, `Raise by ${upDelta}.`)
            ]);
        }

        function renderOverlayController() {
            const cfg = state.threatConfig || {};
            const fkdr = controllerNumber(cfg.minFkdr, 3);
            const stars = Math.round(controllerNumber(cfg.minStars, 1000));
            const swKdr = controllerNumber(cfg.minSkywarsKdr, 2);
            const swWlr = controllerNumber(cfg.minSkywarsWlr, 1);
            const swLevel = Math.round(controllerNumber(cfg.minSkywarsLevel, 10));
            const panel = createFeatureStatus({
                client, sendChat, title: 'Scan Overlay', subtitle: 'PLAYER FILTER',
                section: 'play', helpTopic: 'overlay', width: 60, labelWidth: 16
            });

            panel.open();
            panel.section('Visibility');
            panel.row([
                panel.label('Mode'),
                ...panel.pick('All', state.scanMode === 'all', '/overlay all', 'Scan and show every player.'),
                chatController.text(' ', panel.colors.quiet),
                ...panel.pick('Threats', state.scanMode === 'threats', '/overlay threats', 'Only show players classified as threats.'),
                chatController.text(' ', panel.colors.quiet),
                ...panel.pick('Off', state.scanMode === 'off', '/overlay off', 'Disable scan overlay.')
            ]);

            panel.section('BedWars rules');
            renderThresholdRow(panel, 'FKDR >=', fkdr.toFixed(2), getFkdrColor(fkdr), '0.5', '0.5',
                `/overlay threat fkdr ${stepNumber(fkdr, -0.5, 0, 2)}`,
                `/overlay threat fkdr ${stepNumber(fkdr, 0.5, 0, 2)}`,
                '/overlay threat fkdr ', fkdr > 0);
            renderThresholdRow(panel, 'Stars >=', formatBedwarsPrestige(stars), '', '50', '50',
                `/overlay threat stars ${Math.max(0, stars - 50)}`,
                `/overlay threat stars ${stars + 50}`,
                '/overlay threat stars ', stars > 0);

            panel.section('SkyWars rules');
            renderThresholdRow(panel, 'KDR >=', swKdr.toFixed(2), '', '0.25', '0.25',
                `/overlay threat kdr ${stepNumber(swKdr, -0.25, 0, 2)}`,
                `/overlay threat kdr ${stepNumber(swKdr, 0.25, 0, 2)}`,
                '/overlay threat kdr ', swKdr > 0);
            renderThresholdRow(panel, 'WLR >=', swWlr.toFixed(2), '', '0.1', '0.1',
                `/overlay threat wlr ${stepNumber(swWlr, -0.1, 0, 2)}`,
                `/overlay threat wlr ${stepNumber(swWlr, 0.1, 0, 2)}`,
                '/overlay threat wlr ', swWlr > 0);
            renderThresholdRow(panel, 'Level >=', String(swLevel), '', '1', '1',
                `/overlay threat swlevel ${Math.max(0, swLevel - 1)}`,
                `/overlay threat swlevel ${swLevel + 1}`,
                '/overlay threat swlevel ', swLevel > 0);

            panel.section('Automatic additions');
            panel.row([
                panel.label('Built-in scope'),
                chatController.text('lobbies only', panel.colors.active),
                chatController.text('  paused in active games', panel.colors.quiet)
            ]);
            panel.row([
                panel.label('Add from'),
                chatController.text('Mentions, DMs, party invites (when Use Overlay is on) ', panel.colors.quiet),
                ...panel.flag('Pregame Chat', pregameChatStatsEnabled, '/overlay source pregame',
                    pregameChatStatsEnabled ? 'Click to disable pregame-chat adds.' : 'Click to enable pregame-chat adds.')
            ]);
            panel.close();
        }

        function renderDenickController() {
            const hypixelConfigured = hasHypixelApiKeyConfigured();
            const cosmeticConfigured = Boolean(keys.aurora);
            const panel = createFeatureStatus({
                client, sendChat, title: 'Denick', subtitle: 'IDENTITY RESOLUTION',
                section: 'safety', helpTopic: 'denick', width: 60, labelWidth: 18
            });

            panel.open();
            panel.section('Automatic lookups');
            panel.toggleRow('Skin matching', autoSkinDenickEnabled, '/denick autoskin on', '/denick autoskin off',
                'Resolve nicked players automatically by skin.');
            panel.toggleRow('Stats matching', autoStatsDenickEnabled, '/denick autostats on', '/denick autostats off',
                'Resolve nicked players automatically by stats.');

            panel.section('Results');
            panel.toggleRow('Chat notices', denickChatAnnouncementsEnabled, '/denick announcements on', '/denick announcements off',
                'Announce automatic denick results locally.');
            panel.toggleRow('Show real IGN', showDenickedRealIgn, '/denick showreal on', '/denick showreal off',
                'Replace known nicks with their real IGN where supported.');
            panel.toggleRow('Name replacement', state.denickRealIgnNametags, '/denick nametags on', '/denick nametags off',
                'Render known nicks under their real IGN in tab and above players.');
            panel.toggleRow('Party broadcast', denickPartyAnnounceEnabled, '/denick partyannounce on', '/denick partyannounce off',
                'Send newly found and saved denicks to party chat.');

            panel.section('Availability');
            panel.row([
                panel.label('Stats Key'),
                ...panel.flag(hypixelConfigured ? 'configured' : 'missing', hypixelConfigured, null,
                    hypixelConfigured ? 'Hypixel API key is set.' : 'Set a Hypixel API key in the launcher.')
            ]);
            panel.row([
                panel.label('Cosmetic'),
                ...panel.flag(cosmeticConfigured ? 'configured' : 'missing', cosmeticConfigured, null,
                    cosmeticConfigured ? 'Aurora API key is set.' : 'Set an Aurora API key in the launcher.')
            ]);
            panel.row([
                panel.label('Mode'),
                chatController.component(controllerModeText(), 'white')
            ]);

            panel.section('Manual tools');
            panel.row([
                panel.label('Add'),
                ...panel.action('Manual Add', '/denick add ', 'Type nick and real IGN.', { action: 'suggest_command' }),
                chatController.text(' ', panel.colors.quiet),
                ...panel.action('Skin Lookup', '/denickskin ', 'Type a nick for skin lookup.', { action: 'suggest_command' })
            ]);
            panel.row([
                panel.label('Party review'),
                ...panel.action('Review', '/denick party', 'Review skin matches or choose a confirmed party-nick variation.', { action: 'run_command' }),
                chatController.text(' ', panel.colors.quiet),
                ...panel.action('Preview', '/denick party test', 'Preview fake 1-, 2-, 3-nick, and no-match scenarios. Nothing is saved.', { action: 'run_command' })
            ]);
            panel.row([
                panel.label('Search'),
                ...panel.action('Stats Lookup', '/denick finals ', 'Type final count filters.', { action: 'suggest_command' }),
                chatController.text(' ', panel.colors.quiet),
                ...panel.action('Cosmetic Lookup', '/denick finalkill ', 'Type cosmetic filters.', { action: 'suggest_command' })
            ]);
            panel.close();
        }

        function parseControllerToggle(value) {
            const raw = String(value || '').toLowerCase();
            if (['on', 'enable', 'enabled', 'true', 'yes'].includes(raw)) return true;
            if (['off', 'disable', 'disabled', 'false', 'no'].includes(raw)) return false;
            return null;
        }

        function normalizeOverlaySource(value) {
            const raw = String(value || '').toLowerCase().replace(/[_-]/g, '');
            if (['pregame', 'pregamechat', 'chat'].includes(raw)) return 'pregame';
            return '';
        }

        function setOverlaySourceFlag(source, value) {
            if (source === 'pregame') pregameChatStatsEnabled = value;
            else return false;
            saveFeatureConfig();
            return true;
        }

        function getOverlaySourceFlag(source) {
            if (source === 'pregame') return pregameChatStatsEnabled;
            return false;
        }

        function updateOverlayThreat(metric, rawValue) {
            const type = String(metric || '').toLowerCase();
            if (type === 'tag') {
                state.threatConfig = { ...state.threatConfig, countTags: true };
                saveScanConfig();
                sendChat(client, '§7Tagged players always count as threats.');
                return true;
            }

            if (type === 'fkdr') {
                const value = parseFloat(rawValue);
                if (!Number.isFinite(value) || value < 0) return false;
                state.threatConfig = { ...state.threatConfig, minFkdr: value };
                saveScanConfig();
                return true;
            }

            if (type === 'star' || type === 'stars') {
                const value = parseInt(rawValue, 10);
                if (!Number.isFinite(value) || value < 0) return false;
                state.threatConfig = { ...state.threatConfig, minStars: value };
                saveScanConfig();
                return true;
            }

            if (type === 'swkdr' || type === 'skywarskdr' || type === 'kdr') {
                const value = parseFloat(rawValue);
                if (!Number.isFinite(value) || value < 0) return false;
                state.threatConfig = { ...state.threatConfig, minSkywarsKdr: value };
                saveScanConfig();
                return true;
            }

            if (type === 'swwlr' || type === 'skywarswlr' || type === 'wlr') {
                const value = parseFloat(rawValue);
                if (!Number.isFinite(value) || value < 0) return false;
                state.threatConfig = { ...state.threatConfig, minSkywarsWlr: value };
                saveScanConfig();
                return true;
            }

            if (type === 'swlevel' || type === 'skywarslevel' || type === 'level') {
                const value = parseInt(rawValue, 10);
                if (!Number.isFinite(value) || value < 0) return false;
                state.threatConfig = { ...state.threatConfig, minSkywarsLevel: value };
                saveScanConfig();
                return true;
            }

            return false;
        }

        function handleOverlayControllerCommand(args) {
            const subCmd = String(args[1] || 'status').toLowerCase();
            if (!subCmd || subCmd === 'status') {
                renderOverlayController();
                return true;
            }

            if (subCmd === 'info') {
                sendChat(client, '\u00a76[Overlay] \u00a77Controls scan mode, threat thresholds, auto scan, and overlay auto-add sources.');
                renderOverlayController();
                return true;
            }

            if (subCmd === 'all' || subCmd === 'a') {
                state.scanMode = 'all';
                saveScanConfig();
                renderOverlayController();
                return true;
            }

            if (subCmd === 'off' || subCmd === 'o') {
                state.scanMode = 'off';
                saveScanConfig();
                renderOverlayController();
                return true;
            }

            if (subCmd === 'threats' || subCmd === 'threat' || subCmd === 't') {
                if (args.length === 2) {
                    state.scanMode = 'threats';
                    saveScanConfig();
                    renderOverlayController();
                    return true;
                }
                if (args.length >= 4 && updateOverlayThreat(args[2], args[3])) {
                    renderOverlayController();
                    return true;
                }
                sendChat(client, '\u00a7cUsage: /overlay threat fkdr|stars|kdr|wlr|swlevel|tag <value>');
                return true;
            }

            if (subCmd === 'autoscan' || subCmd === 'autoscanongamestart') {
                autoScanOnGameStart = true;
                saveFeatureConfig();
                if (isScanActiveInGame() && !hasCurrentGameScanSnapshot()) scheduleAutoScan(250);
                sendChat(client, '§7Automatic game-start scanning is always enabled.');
                renderOverlayController();
                return true;
            }

            if (subCmd === 'scope' || subCmd === 'autoscope' || subCmd === 'autoadscope') {
                overlayAutoAddOutsideGamesOnly = true;
                sendChat(client, '\u00a77Overlay auto-adds are always limited to lobbies and other non-game areas.');
                saveFeatureConfig();
                renderOverlayController();
                return true;
            }

            if (subCmd === 'source' || subCmd === 'sources') {
                const source = normalizeOverlaySource(args[2]);
                if (!source) {
                    sendChat(client, '\u00a7cUsage: /overlay source pregame [on|off]');
                    return true;
                }
                const hasExplicitValue = args[3] !== undefined && String(args[3] || '').trim() !== '';
                const explicit = hasExplicitValue ? parseControllerToggle(args[3]) : null;
                if (hasExplicitValue && explicit === null) {
                    sendChat(client, '\u00a7cUsage: /overlay source pregame [on|off]');
                    return true;
                }
                const next = hasExplicitValue ? explicit : !getOverlaySourceFlag(source);
                setOverlaySourceFlag(source, next);
                renderOverlayController();
                return true;
            }

            return false;
        }

        function handleDenickControllerCommand(args) {
            const subCmd = String(args[1] || 'status').toLowerCase();
            if (!subCmd || subCmd === 'status') {
                renderDenickController();
                return true;
            }
            if (subCmd === 'info') {
                sendChat(client, '\u00a76[Denick] \u00a77Controls automatic denick helpers and suggests manual lookup commands.');
                renderDenickController();
                return true;
            }

            const toggles = {
                autoskin: value => { autoSkinDenickEnabled = value; },
                autostats: value => { autoStatsDenickEnabled = value; },
                announcements: value => { denickChatAnnouncementsEnabled = value; },
                showreal: value => { showDenickedRealIgn = value; },
                partyannounce: value => { denickPartyAnnounceEnabled = value; },
                // Renders known nicks under their real IGN above their head
                // and in tab, including players already on screen.
                nametags: (value) => {
                    state.denickRealIgnNametags = value;
                    denickDisplayNames.refreshNameReplacement();
                }
            };
            if (!Object.prototype.hasOwnProperty.call(toggles, subCmd)) return false;

            const next = parseControllerToggle(args[2]);
            if (next === null) {
                sendChat(client, `\u00a7cUsage: /denick ${subCmd} on|off`);
                return true;
            }
            toggles[subCmd](next);
            saveFeatureConfig();
            renderDenickController();
            return true;
        }

        // /alias - custom display names for people you know.
        //
        // Every write goes through the alias book, and every write that can
        // change what is already on screen calls refreshRenames(): the rename
        // decisions are deliberately sticky, so without it a new alias would
        // not appear until the next match.
        function renderFriendAliasController() {
            const entries = listFriendAliases();
            const panel = createFeatureStatus({ client, sendChat, title: 'Friend aliases', section: 'social' });
            panel.open();
            panel.toggleRow('Custom names', state.friendAliasEnabled, '/alias enabled on', '/alias enabled off');
            panel.toggleRow('Name tags', state.friendAliasNametags, '/alias nametags on', '/alias nametags off');
            panel.toggleRow('Chat', state.friendAliasChat, '/alias chat on', '/alias chat off');
            panel.toggleRow('Tab', state.friendAliasTabStats, '/alias tab on', '/alias tab off');
            panel.toggleRow('Show real IGN', state.friendAliasShowRealIgn, '/alias showreal on', '/alias showreal off');
            if (!entries.length) panel.row([chatController.text('No custom names yet.', 'gray')]);
            entries.slice(0, 40).forEach(entry => {
                panel.row([
                    chatController.text(`${entry.realIGN} > ${entry.color || '\u00a7f'}${entry.alias} `, 'white', {
                        hoverEvent: chatController.hover(entry.note || entry.realIGN)
                    }),
                    ...panel.action('Remove', `/alias remove ${entry.realIGN}`, `Remove the alias for ${entry.realIGN}.`)
                ]);
            });
            if (entries.length > 40) panel.row([chatController.text(`...and ${entries.length - 40} more`)]);
            panel.row(panel.action('Add alias', '/alias add ', 'Type <realIGN> <name> [color].', { action: 'suggest_command' }));
            panel.close();
        }

        function handleFriendAliasCommand(args = []) {
            const sub = String(args[1] || 'list').toLowerCase();

            if (!sub || sub === 'list' || sub === 'status') {
                renderFriendAliasController();
                return;
            }

            const toggles = {
                on: value => { state.friendAliasEnabled = value; },
                off: value => { state.friendAliasEnabled = !value; },
                enabled: value => { state.friendAliasEnabled = value; },
                nametags: value => { state.friendAliasNametags = value; },
                chat: value => { state.friendAliasChat = value; },
                tab: value => { state.friendAliasTabStats = value; },
                showreal: value => { state.friendAliasShowRealIgn = value; }
            };
            if (Object.prototype.hasOwnProperty.call(toggles, sub)) {
                const next = parseControllerToggle(args[2]);
                if (next === null) {
                    sendChat(client, `§cUsage: /alias ${sub} on|off`);
                    return;
                }
                toggles[sub](next);
                saveFeatureConfig();
                // The toggle can flip the engine on or off, and can also change
                // the answer while it stays on, so do both refreshes.
                denickDisplayNames.refreshNameReplacement();
                denickDisplayNames.refreshRenames();
                refreshTabStatsForRoster();
                renderFriendAliasController();
                return;
            }

            if (sub === 'add' || sub === 'set') {
                const target = String(args[2] || '').trim();
                const alias = String(args[3] || '').trim();
                const color = args[4] ? String(args[4]).trim() : null;
                if (!target || !alias) {
                    sendChat(client, '§cUsage: /alias add <realIGN> <name> [color]');
                    return;
                }
                const result = setFriendAlias({ name: target, alias, color });
                if (!result.ok) {
                    const messages = {
                        // The alias becomes the GameProfile name, and teams and
                        // score entries are keyed by it, so it has to look like
                        // a Minecraft name.
                        invalid_alias: '§cA custom name must be 3-16 characters, letters/numbers/underscore only.',
                        invalid_name: '§cThat is not a valid Minecraft name.',
                        same_name: '§cThat custom name is the same as their IGN.',
                        alias_taken: `§cThat name is already used for §f${result.conflict?.realIGN || '?'}§c.`
                    };
                    sendChat(client, messages[result.reason] || '§cCould not save that custom name.');
                    return;
                }
                denickDisplayNames.refreshRenames();
                refreshTabStatsForRoster();
                const entry = result.entry;
                sendChat(client, `§a[Alias] §f${entry.realIGN} §7will show as ${entry.color || '§f'}${entry.alias}§7.`);
                if (!state.friendAliasNametags && !state.friendAliasChat && !state.friendAliasTabStats) {
                    sendChat(client, '  §8Nothing is showing custom names yet — §7/alias nametags on');
                }
                return;
            }

            if (sub === 'remove' || sub === 'delete' || sub === 'del') {
                const target = String(args[2] || '').trim();
                if (!target) {
                    sendChat(client, '§cUsage: /alias remove <realIGN>');
                    return;
                }
                const result = removeFriendAlias(target);
                if (!result.removed) {
                    sendChat(client, `§cNo custom name saved for §f${target}§c.`);
                    return;
                }
                denickDisplayNames.refreshRenames();
                refreshTabStatsForRoster();
                sendChat(client, `§a[Alias] §7Removed the custom name for §f${result.entry.realIGN}§7.`);
                return;
            }

            // Bare "/alias <name>" reads back whatever is stored for them.
            const entry = findFriendAlias(sub) || friendAliasOwner(sub);
            if (entry) {
                sendChat(client, `§7${entry.realIGN} §8→ ${entry.color || '§f'}${entry.alias}${entry.note ? ` §8(${entry.note})` : ''}`);
                return;
            }
            sendChat(client, '§cUsage: /alias add|remove|list, or /alias nametags|chat|tab|showreal on|off');
        }

        function handleTabStatsCommand(mode, fullArgs = []) {
            const subCmd = String(mode || 'status').toLowerCase();
            if (!subCmd || subCmd === 'status') {
                renderTabStatsController();
                return true;
            }

            if (subCmd === 'on' || subCmd === 'enable' || subCmd === 'true') {
                tabStatsEnabled = true;
                saveFeatureConfig();
                refreshTabStatsImmediately();
                renderTabStatsController();
                return true;
            }

            if (subCmd === 'off' || subCmd === 'disable' || subCmd === 'false') {
                tabStatsEnabled = false;
                saveFeatureConfig();
                clearAllTabStatsDisplays({ restoreOriginalTeams: gameActive && currentGamemode === 'BEDWARS' });
                renderTabStatsController();
                return true;
            }

            if (subCmd === 'tags') {
                const value = String(fullArgs[2] || '').toLowerCase();
                if (!['on', 'off', 'true', 'false', 'enable', 'disable'].includes(value)) {
                    sendChat(client, '\u00a7cUsage: /tabstats tags on|off');
                    return false;
                }
                showTagsInTabStats = ['on', 'true', 'enable'].includes(value);
                const toggleTagField = fields => showTagsInTabStats
                    ? (fields.includes('tags') ? fields : [...fields, 'tags'])
                    : fields.filter(field => field !== 'tags');
                tabStatsBedwarsFields = toggleTagField(tabStatsBedwarsFields);
                tabStatsSkywarsFields = toggleTagField(tabStatsSkywarsFields);
                saveFeatureConfig();
                if (isTabStatsActiveInGame()) refreshTabStatsImmediately();
                renderTabStatsController();
                return true;
            }

            if (subCmd === 'clear') {
                clearAllTabStatsDisplays({ restoreOriginalTeams: gameActive && currentGamemode === 'BEDWARS' });
                renderTabStatsController();
                return true;
            }

            if (subCmd === 'bw' || subCmd === 'bedwars' || subCmd === 'sw' || subCmd === 'skywars') {
                const isBw = subCmd === 'bw' || subCmd === 'bedwars';
                const raw = String(fullArgs[2] || '').toLowerCase();
                const value = ['on', 'off', 'auto'].includes(raw) ? raw : null;
                if (!value) {
                    sendChat(client, `\u00a7cUsage: /tabstats ${isBw ? 'bw' : 'sw'} on|off|auto`);
                    return false;
                }
                if (isBw) tabStatsBedwarsMode = value;
                else tabStatsSkywarsMode = value;
                saveFeatureConfig();
                if (isTabStatsActiveInGame()) refreshTabStatsImmediately();
                else clearAllTabStatsDisplays({ restoreOriginalTeams: gameActive && currentGamemode === 'BEDWARS' });
                renderTabStatsController();
                return true;
            }

            if (subCmd === 'col' || subCmd === 'column' || subCmd === 'columns') {
                const which = String(fullArgs[2] || '').toLowerCase();
                const raw = String(fullArgs[3] || '').toLowerCase();
                if (!['kr', 'wr'].includes(which) || !['on', 'off'].includes(raw)) {
                    sendChat(client, '\u00a7cUsage: /tabstats col kr|wr on|off');
                    return false;
                }
                const on = raw === 'on';
                const toggleField = (fields, field) => on
                    ? (fields.includes(field) ? fields : [...fields, field])
                    : fields.filter(item => item !== field);
                if (which === 'kr') {
                    tabStatsShowKillRatio = on;
                    tabStatsBedwarsFields = toggleField(tabStatsBedwarsFields, 'fkdr');
                    tabStatsSkywarsFields = toggleField(tabStatsSkywarsFields, 'kdr');
                } else {
                    tabStatsShowWinRatio = on;
                    tabStatsBedwarsFields = toggleField(tabStatsBedwarsFields, 'wlr');
                    tabStatsSkywarsFields = toggleField(tabStatsSkywarsFields, 'wlr');
                }
                saveFeatureConfig();
                if (isTabStatsActiveInGame()) refreshTabStatsImmediately();
                renderTabStatsController();
                return true;
            }

            if (subCmd === 'info') {
                sendChat(client, '\u00a76[TabStats] \u00a77Renders compact stats in tab during active BedWars and SkyWars games.');
                renderTabStatsController();
                return true;
            }

            sendChat(client, `\u00a7cUsage: /tabstats on|off|tags|bw|sw|col|clear|status`);
            return false;
        }

        function isValidPlayerName(name) {
            return typeof name === 'string' && name.length >= 3 && name.length <= 16 && /^[a-zA-Z0-9_]+$/.test(name);
        }

        function normalizeUuid(value) {
            const raw = String(value || '').replace(/-/g, '').toLowerCase();
            return /^[0-9a-f]{32}$/.test(raw) ? raw : null;
        }

        ownIdentity = createOwnIdentityTracker({
            client,
            hypixelClient,
            isValidPlayerName: (name) => isValidPlayerName(name),
            normalizeUuid: (value) => normalizeUuid(value),
            nickKey: (name) => nickKey(name)
        });
        const {
            rememberOwnUuid,
            rememberOwnName,
            seedOwnIdentity,
            pruneOwnNames,
            resetOwnNickNames,
            isOwnUuid,
            isOwnPlayerName,
            getOwnKnownNames,
            getOwnKnownNameEntries,
            getOwnUuidCandidates,
            restoreOwnIdentitySnapshot
        } = ownIdentity;

        let reminderFetchPending = null;
        let reminderLobbyBoundary = 0;
        let reminderLobbyTimer = null;
        let reminderLobbyTarget = null;
        function scheduleReminderLobby(key) {
            if (key === reminderLobbyTarget) return;
            reminderLobbyTarget = key;
            if (reminderLobbyTimer) clearTimeout(reminderLobbyTimer);
            // Transfers replace the sidebar over several packets. Let it settle
            // so the old lobby and the new pregame cannot each produce an alert.
            reminderLobbyTimer = setTimeout(() => {
                reminderLobbyTimer = null;
                if (client.state === mc.states.PLAY && !gameActive) void enderDustReminder.onLobbyJoin(key);
            }, 750);
            reminderLobbyTimer.unref?.();
        }
        async function fetchOwnReminderPlayer(uuid) {
            if (reminderFetchPending) return reminderFetchPending;
            reminderFetchPending = (async () => {
                const checkedAt = Date.now();
                const response = await hypixelApiGet(`https://api.hypixel.net/v2/player?uuid=${uuid}`, {
                    timeout: 5000, apiPriority: 'background'
                });
                const raw = response?.data;
                if (raw?.success === false || !raw?.player) throw new Error('Hypixel did not return player data.');
                if (raw.player.uuid && normalizeUuid(raw.player.uuid) !== normalizeUuid(uuid)) throw new Error('Hypixel returned a different account.');
                reminderAccounts.observe(uuid, raw, checkedAt);
                enderDustReminder.observePlayerData(raw);
                slumberDailyRewardsReminder.observePlayerData(raw);
                return raw;
            })();
            try { return await reminderFetchPending; }
            finally { reminderFetchPending = null; }
        }
        const enderDustReminder = createEnderDustReminder({
            getEnabled: () => enderDustReminderEnabled,
            getThreshold: () => enderDustReminderThreshold,
            isApiAvailable: () => !state.apiKillSwitchEnabled && hasHypixelApiKeyConfigured(),
            getOwnUuid: async () => {
                const knownUuid = getOwnUuidCandidates()[0] || normalizeUuid(client.uuid);
                if (knownUuid) return knownUuid;
                const profile = await getPlayerData(client.username, {
                    includeErrors: true,
                    preferCache: true,
                    apiPriority: 'background'
                });
                const uuid = normalizeUuid(profile?.data?.player?.uuid);
                if (uuid) rememberOwnUuid(uuid);
                return uuid;
            },
            fetchPlayer: fetchOwnReminderPlayer,
            getSavedReading: () => reminderAccounts.reading(client.uuid)?.enderDust || null,
            saveReading: (reading) => {
                enderDustReminderLastReading = reading;
                saveFeatureConfig();
            },
            sendChat: message => sendChat(client, message),
            logger: console
        });
        const slumberDailyRewardsReminder = createSlumberDailyRewardsReminder({
            getEnabled: () => slumberDailyRewardsReminderEnabled,
            isApiAvailable: () => !state.apiKillSwitchEnabled && hasHypixelApiKeyConfigured(),
            getOwnUuid: async () => {
                const knownUuid = getOwnUuidCandidates()[0] || normalizeUuid(client.uuid);
                if (knownUuid) return knownUuid;
                const profile = await getPlayerData(client.username, {
                    includeErrors: true,
                    preferCache: true,
                    apiPriority: 'background'
                });
                const uuid = normalizeUuid(profile?.data?.player?.uuid);
                if (uuid) rememberOwnUuid(uuid);
                return uuid;
            },
            fetchPlayer: fetchOwnReminderPlayer,
            getSavedReading: () => reminderAccounts.reading(client.uuid)?.slumberDailyRewards || null,
            sendChat: message => sendChat(client, message),
            logger: console
        });
        // The clientbound teleport may send any axis as a delta (1.8 flag bits
        // 0x01/0x02/0x04), which only resolves against a position we already
        // hold; an axis we cannot resolve is dropped rather than guessed.
        // Serverbound movement is always absolute, so it passes no flags.
        function rememberOwnPosition(data, relativeFlags = 0) {
            const flags = Number(relativeFlags) || 0;
            const base = ownPosition || {};
            const resolve = (value, bit, previous) => {
                const number = Number(value);
                if (!Number.isFinite(number)) return null;
                if (!(flags & bit)) return number;
                return Number.isFinite(previous) ? previous + number : null;
            };
            const x = resolve(data?.x, 0x01, base.x);
            const y = resolve(data?.y, 0x02, base.y);
            const z = resolve(data?.z, 0x04, base.z);
            if (x === null || y === null || z === null) return;
            ownPosition = { x, y, z };
        }

        // Plays a sound for this client only - the packet is written straight to
        // the local client and never reaches Hypixel, so nobody else hears it.
        // Coordinates are 1.8 fixed-point (blocks * 8).
        function playSelfSound(sound = {}) {
            const soundName = String(sound?.name || '').trim();
            if (!soundName || !ownPosition) return false;
            try {
                client.write('named_sound_effect', {
                    soundName,
                    x: Math.floor(ownPosition.x * 8),
                    y: Math.floor(ownPosition.y * 8),
                    z: Math.floor(ownPosition.z * 8),
                    volume: Number.isFinite(Number(sound.volume)) ? Number(sound.volume) : 1,
                    pitch: Number.isFinite(Number(sound.pitch)) ? Number(sound.pitch) : 63
                });
                return true;
            } catch (e) {
                return false;
            }
        }

        const gamblerGeorgeReminder = createGamblerGeorgeReminder({
            getEnabled: () => gamblerGeorgeReminderEnabled,
            getSavedState: () => reminderAccounts.george(client.uuid),
            saveState: (nextState) => {
                reminderAccounts.saveGeorge(client.uuid, nextState, client.username);
            },
            sendChat: message => sendChat(client, message),
            playSound: sound => playSelfSound(sound),
            getAutoGamblerEnabled: () => autoGamblerEnabled,
            logger: console
        });

        function markRecentBedwarsSession(sessionId) {
            recentBedwarsSessionId = sessionId;
            recentBedwarsAt = Date.now();
        }

        function gamblerGeorgeGameContext() {
            return {
                gameActive,
                mode: currentGamemode,
                gameSessionId,
                recentBedwarsSessionId,
                recentBedwarsAt
            };
        }
        activeUser.getEnderDustReminderStatus = () => enderDustReminder.getStatus();
        activeUser.checkEnderDustReminder = () => enderDustReminder.checkNow({ force: true, notify: false });
        activeUser.getSlumberDailyRewardsReminderStatus = () => slumberDailyRewardsReminder.getStatus();
        activeUser.getGamblerGeorgeReminderStatus = () => gamblerGeorgeReminder.getStatus();
        activeUser.observeOwnHypixelPlayerData = (uuid, player) => {
            // This is the only normal lookup hook: accept only the connected
            // account's known UUID or anchored account name.
            if (!isOwnUuid(uuid) && !isOwnPlayerName(player?.displayname)) return false;
            rememberOwnUuid(uuid);
            reminderAccounts.observe(uuid, { player });
            enderDustReminder.observePlayerData({ player });
            slumberDailyRewardsReminder.observePlayerData({ player });
            return true;
        };
        enderDustReminder.start();

        const partyTracker = createPartyTracker({
            stripFormatting: (text) => stripAnsi(text),
            getSelfName: () => client.username,
            requestPartyListCommand: () => {
                if (hypixelClient.state !== mc.states.PLAY) return;
                void sendHypixelCommand('/p list', {
                    priority: 70,
                    dedupeKey: 'party-list',
                    dedupeMs: 10_000
                });
            },
            sendChat: message => sendChat(client, message)
        });
        activeUser.isPartyMember = (name) => partyTracker.isTrackedMember(name);
        // true/false when the tracker is confident, null while uncertain -
        // /share only skips party broadcasts on a confident "not in a party".
        activeUser.getPartyStatus = () => (partyTracker.hasUsableState() ? partyTracker.isInParty() : null);
        activeUser.getPresentAtGameStart = () => gameActive && presentAtGameStart;
        partyTracker.start();
        const queueTimeTracker = createQueueTimeTracker({
            announce: message => sendChat(client, message),
            getEnabled: () => queueTimeEnabled,
            getShareEnabled: () => queueTimePartyChatEnabled,
            share: message => {
                if (!queueTimePartyChatEnabled || !partyTracker.hasUsableState() || !partyTracker.isInParty()) return;
                void sendHypixelCommand(`/pc ${message}`, { priority: 70 });
            }
        });
        const partyArrivalTabNames = new Map();
        let partyArrivalWorldStartedAt = Date.now();
        const partyArrivalCheck = createPartyArrivalCheck({
            enabled: partySplitWarningsEnabled,
            getVisibleNames: () => {
                if (!bedwarsPregameActive || gameActive) return [];
                const names = new Set();
                for (const name of partyArrivalTabNames.values()) names.add(name);
                entityTracker?.forEachEntity(entry => {
                    if (entry.spawnPacket && entry.spawnedAt >= partyArrivalWorldStartedAt
                        && !entry.invisible && isValidPlayerName(entry.name)) names.add(entry.name);
                });
                return [...names];
            },
            getMembers: () => partyTracker.hasUsableState() && !partyTracker.isInParty()
                ? [] : getConfirmedPartyMemberNames(),
            getKnownDenick: findKnownDenickByNick,
            isOwnName: isOwnPlayerName,
            sendChat: message => sendChat(client, message),
            playSound: playSelfSound
        });
        // Isolated synthetic roster, using the exact same arrival/timer/output path.
        const partyArrivalPreview = createPartyArrivalCheck({
            getMembers: () => ['MissingMate1', 'MissingMate2'],
            getKnownDenick: () => null,
            isOwnName: () => false,
            dismissCommand: '/partycheck stop',
            sendChat: message => sendChat(client, { text: '', extra: [
                { text: '[TEST] ', color: 'dark_gray' },
                typeof message === 'string' ? { text: message } : message
            ] }),
            playSound: playSelfSound
        });

        function handlePartyCheckCommand(args) {
            const sub = String(args[1] || '').toLowerCase();
            if (sub === 'on' || sub === 'off') {
                partySplitWarningsEnabled = sub === 'on';
                saveFeatureConfig();
                partyArrivalCheck.setEnabled(partySplitWarningsEnabled);
                if (!partySplitWarningsEnabled) partyArrivalPreview.stop();
                sendChat(client, partySplitWarningsEnabled
                    ? '\u00a7aParty split warnings enabled. \u00a77Preference saved.'
                    : '\u00a7aParty split warnings disabled. \u00a77They stay off until /partycheck on.');
                return;
            }
            if (!sub || sub === 'status') {
                const panel = createFeatureStatus({ client, sendChat, title: 'Party split warnings', section: 'safety' });
                panel.open();
                panel.toggleRow('Warnings', partySplitWarningsEnabled, '/partycheck on', '/partycheck off', 'Save your warning preference.');
                panel.row([
                    ...panel.action('Dismiss lobby', '/partycheck dismiss', 'Dismiss warnings for this lobby.', { locked: !bedwarsPregameActive || gameActive }),
                    chatController.text(' '), ...panel.action('Test', '/partycheck test', 'Preview missing teammates.', { locked: !bedwarsPregameActive || gameActive }),
                    chatController.text(' '), ...panel.action('Stop test', '/partycheck stop', 'Stop the preview.')
                ]);
                panel.close();
                return;
            }
            if (sub === 'dismiss') {
                if (!bedwarsPregameActive || gameActive) {
                    sendChat(client, '\u00a77There is no active pregame lobby to dismiss.');
                    return;
                }
                partyArrivalCheck.stop();
                sendChat(client, '\u00a7aParty split warnings dismissed for this lobby. \u00a77Your saved warning preference is unchanged.');
                return;
            }
            if (sub === 'stop') {
                partyArrivalPreview.stop();
                sendChat(client, '\u00a77Party split test stopped.');
                return;
            }
            if (sub !== 'test') {
                sendChat(client, '\u00a77Usage: \u00a7f/partycheck on|off|status\u00a77, \u00a7f/partycheck dismiss \u00a77(current lobby), \u00a7f/partycheck test|stop \u00a77(test only)');
                return;
            }
            if (!bedwarsPregameActive || gameActive) {
                sendChat(client, '\u00a77Join a Bed Wars pregame lobby to run the party split test.');
                return;
            }
            sendChat(client, '\u00a78[TEST] \u00a77Simulating two missing teammates. First alert in 1 second, then every 2.5 seconds. Stop with \u00a7f/partycheck stop\u00a77.');
            partyArrivalPreview.enter();
            partyArrivalPreview.observeChatLine('ArrivalTester has joined (1/16)!');
        }

        function rememberPlayerActiveCosmetics(name, profileData, source = 'stats', options = {}) {
            if (!isValidPlayerName(name) || !profileData?.player) return null;
            if (isNickCapableProfileData(profileData)) rememberNickCapablePlayer(name, source);
            if (profileData.isNicked || profileData.lookupFailed) return null;
            const exact = Boolean(options.exact);
            const cosmetics = extractActiveBedwarsCosmetics(profileData);
            if (!cosmetics.beddestroy && !cosmetics.finalkill && !cosmetics.woodskin && !cosmetics.killmessage) {
                if (exact) clearPlayerActiveCosmetics(name);
                return null;
            }
            const key = nickKey(name);
            const current = activePlayerCosmetics.get(key) || {};
            const next = {
                name,
                beddestroy: exact ? (cosmetics.beddestroy || null) : (cosmetics.beddestroy || current.beddestroy || null),
                finalkill: exact ? (cosmetics.finalkill || null) : (cosmetics.finalkill || current.finalkill || null),
                woodskin: exact ? (cosmetics.woodskin || null) : (cosmetics.woodskin || current.woodskin || null),
                killmessage: exact ? (cosmetics.killmessage || null) : (cosmetics.killmessage || current.killmessage || null),
                raw: { ...(current.raw || {}), ...(cosmetics.raw || {}) },
                source,
                at: Date.now()
            };
            activePlayerCosmetics.set(key, next);
            return next;
        }

        function formatActiveBedwarsCosmeticRow(row = {}) {
            const value = row.value ? `§a${row.value}` : '§8Unknown/None';
            const raw = row.raw || '';
            const rawSuffix = raw && row.value && normalizeCosmeticKey(raw) !== normalizeCosmeticKey(row.value)
                ? ` §8(${raw})`
                : '';
            const fieldSuffix = row.known ? '' : ` §8[${row.field}]`;
            return ` §8- §7${row.label}: ${value}${rawSuffix}${fieldSuffix}`;
        }

        async function handleActiveCosmeticsCommand(args) {
            const target = String(args[1] || '').trim();
            if (!target || !isValidPlayerName(target)) {
                return sendChat(client, '§cUsage: /activecosmetics <player>');
            }

            sendChat(client, `§d[Cosmetics] §7Fetching active BedWars cosmetics for §f${target}§7...`);
            const profile = await getPlayerData(target, {
                includeErrors: true,
                forceRefresh: true
            });
            if (profile?.error) return sendPlayerLookupError(client, target, profile);
            if (!profile?.data?.player) return sendChat(client, `§cNo Hypixel profile data found for §f${target}§c.`);

            const rows = collectActiveBedwarsCosmeticFields(profile.data)
                .filter(row => ['Wood Skin', 'Kill Message'].includes(row.label));

            const displayName = profile.data.player.displayname || target;
            const cacheText = profile.fromCache ? ' §8(cache)' : '';
            sendChat(client, `§d§lActive BedWars Cosmetics §8- §f${displayName}${cacheText}`);

            if (!rows.length) {
                sendChat(client, ' §8- §7No active Wood Skin or Kill Message fields were found in the Hypixel API profile.');
                return;
            }

            rows.forEach(row => sendChat(client, formatActiveBedwarsCosmeticRow(row)));
        }

        function componentTextToPlain(value) {
            if (value === undefined || value === null) return '';
            if (typeof value === 'string') {
                const trimmed = value.trimStart();
                const first = trimmed[0];
                const likelyJson = first === '{'
                    || first === '['
                    || first === '"'
                    || first === '-'
                    || (first >= '0' && first <= '9')
                    || trimmed === 'true'
                    || trimmed === 'false'
                    || trimmed === 'null';
                if (likelyJson) {
                    try {
                        return componentTextToPlain(JSON.parse(value));
                    } catch (e) {}
                }
                return stripAnsi(value);
            }
            if (Array.isArray(value)) return value.map(componentTextToPlain).join('');
            if (typeof value === 'object') {
                let text = typeof value.text === 'string' ? value.text : '';
                if (Array.isArray(value.extra)) text += value.extra.map(componentTextToPlain).join('');
                return stripAnsi(text);
            }
            return stripAnsi(String(value));
        }

        function extractPlayerNameFromText(value, options = {}) {
            const plain = componentTextToPlain(value);
            const tokens = plain.match(/[A-Za-z0-9_]{3,16}/g) || [];
            const names = tokens.filter(token => isValidPlayerName(token) && !/^\d+$/.test(token) && !PLAYER_NAME_TEXT_BLOCKLIST.has(token.toUpperCase()));
            if (!names.length) return null;
            return options.preferFirst ? names[0] : names[names.length - 1];
        }

        function rememberOwnDisplayName(displayName, fallbackName = '', source = 'display') {
            const displayPlayerName = extractPlayerNameFromText(displayName);
            const remembered = rememberOwnName(displayPlayerName, source);
            if (!remembered) rememberOwnName(fallbackName, source);
        }

        function rememberOwnPlayerInfo(player = {}, uuid = null) {
            seedOwnIdentity();
            const playerName = player?.name;
            const ownEntry = isOwnUuid(uuid) || isOwnPlayerName(playerName);
            if (!ownEntry) return false;
            rememberOwnUuid(uuid);
            rememberOwnName(playerName, 'player_info');
            rememberOwnDisplayName(player.displayName, playerName, 'player_info_display');
            return true;
        }

        function observeOwnNickChat(text) {
            const clean = stripAnsi(text || '').replace(/\s+/g, ' ').trim();
            if (!clean) return;

            if (/\byou (?:are|were) (?:no longer|not) (?:nicked|disguised)\b/i.test(clean)
                || /\b(?:nick|nickname) (?:removed|reset|disabled)\b/i.test(clean)) {
                resetOwnNickNames();
                return;
            }

            const nickPatterns = [
                /\b(?:you are|you're|youre)(?: now| currently| already)? (?:nicked|disguised) as (.+?)(?:[.!]|$)/i,
                /\byour (?:current )?nick(?:name)?(?: is|:)\s*(.+?)(?:[.!]|$)/i,
                /\bnick(?:name)? (?:set|changed) to (.+?)(?:[.!]|$)/i
            ];

            for (const pattern of nickPatterns) {
                const match = clean.match(pattern);
                const nick = match ? extractPlayerNameFromText(match[1], { preferFirst: true }) : null;
                if (nick) {
                    resetOwnNickNames();
                    rememberOwnName(nick, 'chat_nick');
                    return;
                }
            }
        }

        function nickKey(name) {
            return String(name || '').toLowerCase();
        }

        function rememberCurrentGameTeam(name) {
            if (!gameActive || currentGamemode !== 'BEDWARS' || !isValidPlayerName(name) || isOwnPlayerName(name)) return;
            const team = resolveBedwarsTeamName(name);
            if (team) currentGameTeams.set(nickKey(name), { name, team });
        }

        function rememberCurrentGamePlayerName(name) {
            if (!gameActive || !isSupportedTabStatsMode(currentGamemode) || !isValidPlayerName(name)) return false;
            const key = nickKey(name);
            if (!key) return false;
            currentGamePlayerNames.set(key, name);
            const knownRealName = autoDenickResults?.get(key)?.realName;
            if (isValidPlayerName(knownRealName)) {
                currentGamePlayerNames.set(nickKey(knownRealName), knownRealName);
            }
            return true;
        }

        function rememberCurrentGameDenickNames(nick, realName) {
            const rememberedNick = rememberCurrentGamePlayerName(nick);
            const rememberedRealName = rememberCurrentGamePlayerName(realName);
            return rememberedNick || rememberedRealName;
        }

        function rememberUuidName(uuid, name) {
            if (!uuid || !isValidPlayerName(name)) return;
            uuidMap.set(uuid, name);
            const normalized = normalizeUuid(uuid);
            if (normalized) uuidMap.set(normalized, name);
            attachNameToPlayerEntities(uuid, name);
        }

        function getUuidMappedName(uuid) {
            if (!uuid) return null;
            return uuidMap.get(uuid) || uuidMap.get(normalizeUuid(uuid));
        }

        function forgetUuidName(uuid) {
            if (!uuid) return;
            uuidMap.delete(uuid);
            const normalized = normalizeUuid(uuid);
            if (normalized) uuidMap.delete(normalized);
        }

        denickTracker = createDenickTracker({
            isValidPlayerName: (name) => isValidPlayerName(name),
            nickKey: (name) => nickKey(name),
            findKnownDenickByNick,
            getDenickChatAnnouncementsEnabled: () => denickChatAnnouncementsEnabled,
            getShowDenickedRealIgn: () => showDenickedRealIgn,
            isOwnPlayerName: (name) => isOwnPlayerName(name),
            isSameTeamAsClient: (name) => isSameTeamAsClient(name),
            sendChat,
            client,
            // proxy.js still owns the tab/overlay coordination because
            // those touch scoreboards and packet writes; we hook it here.
            afterApplyKnownDenick: (name, realName, source, options) => {
                rememberCurrentGameDenickNames(name, realName);
                cleanupDenickAliasDuplicate(realName, `known_denick_${source}`);
                if (options.queueUpdates !== false && gameActive && isSupportedTabStatsMode(currentGamemode)) {
                    queueOverlayStatsUpdate(name, 0);
                    queueTabStatsUpdate(name, 0);
                    saveCurrentMatchSnapshot(`known_denick_${source}`);
                }
            }
        });
        ({ autoDenickStats, autoDenickResults, autoDenickNickChecks, autoSkinDenickAttempts } = denickTracker);
        const { getAutoDenickResult, shouldSuppressDenickAnnouncement, hasAnnouncedDenick, markDenickAnnounced, applyKnownDenickFromHistory, denickSuffix, getDenickAliasForRealName } = denickTracker;

        function refreshVisiblePlayerEntityProfile(profile) {
            const uuid = profile?.uuid || profile?.UUID;
            if (!uuid || !entityTracker?.replayPacketsForUuid) return;
            // The 1.8 client binds a name and skin to a player entity when it
            // spawns. Reissuing player_info changes tab immediately, then this
            // small destroy/spawn replay makes the already-visible body use the
            // same profile without waiting for a death or a feature restart.
            entityTracker.replayPacketsForUuid(uuid).forEach((entry) => {
                try {
                    client.write('entity_destroy', { entityIds: [entry.entityId] });
                    client.write('named_entity_spawn', entry.spawnPacket);
                    entry.equipmentPackets.forEach(packet => client.write('entity_equipment', packet));
                    if (entry.metadataPacket) client.write('entity_metadata', entry.metadataPacket);
                } catch (e) {}
            });
        }

        // Custom names are gated by a master switch plus a per-surface one, so
        // turning the feature off kills every surface at once without losing
        // which surfaces you had chosen.
        function friendAliasesActive(surface) {
            if (!state.friendAliasEnabled) return false;
            if (surface === 'chat') return Boolean(state.friendAliasChat);
            if (surface === 'tab') return Boolean(state.friendAliasTabStats);
            return Boolean(state.friendAliasNametags);
        }

        // Renders known nicked players under their real IGN in-game, and anyone
        // you have given a custom name under that name instead. Consults this
        // session's denicks first, then the saved denick history (which is what
        // /denick add writes to), then your own alias book.
        //
        // The rewrite engine runs when EITHER feature wants it; the resolver
        // below decides which answer each surface actually gets. Gating on the
        // denick toggle alone would leave custom aliases dead whenever real-IGN
        // rendering was off.
        const denickDisplayNames = createDenickDisplayNames({
            isEnabled: () => state.denickRealIgnNametags || friendAliasesActive('world'),
            isSkinReplacementEnabled: () => state.denickRealSkin,
            isChatReplacementEnabled: () => state.denickRealIgnChat || friendAliasesActive('chat'),
            resolveChatRankedName: (nick) => {
                if (!state.denickRealIgnChat || isOwnPlayerName(nick)) return null;
                const real = getAutoDenickResult(nick)?.realName || findKnownDenickByNick(nick)?.realIGN;
                if (!real || nickKey(real) === nickKey(nick)) return null;
                const profile = globalCache.get(nickKey(real));
                if (!profile?.data?.player || profile.data.isNicked || profile.data.lookupFailed) return null;
                const alias = friendAliasesActive('chat') && (findFriendAlias(real) || findFriendAlias(nick));
                const rank = resolveHypixelRank(profile.data.player);
                return `${rank.prefix ? `${rank.prefix} ` : ''}${rank.nameColor}${alias?.alias || real}`;
            },
            resolveSkinProperties: (realName) => realSkinTextureResolver.resolve(realName),
            // Two layers, in this order:
            //   1. denick  - the account behind the name Hypixel is showing
            //   2. alias   - your own name for that account
            // The alias is looked up under the real IGN first so one entry
            // covers a friend nicked or not, then under the rendered name so a
            // nick can be aliased directly before it is ever denicked.
            //
            // The alias wins over the real IGN: naming someone FattyAurora
            // means FattyAurora whether they are _xAurora or GoodRider today.
            // 'skin' is the exception - it must answer with the real account or
            // the skin lookup goes hunting for a name that does not exist.
            resolveRealName: (nick, surface = 'world') => {
                // Never you: there is nothing to denick about your own
                // account, and your own name is better handled client-side.
                if (isOwnPlayerName(nick)) return null;
                const real = getAutoDenickResult(nick)?.realName
                    || findKnownDenickByNick(nick)?.realIGN
                    || null;
                if (surface === 'skin') return real;

                if (friendAliasesActive(surface)) {
                    const entry = (real ? findFriendAlias(real) : null) || findFriendAlias(nick);
                    if (entry?.alias) return entry.alias;
                }

                const denickEnabled = surface === 'chat'
                    ? state.denickRealIgnChat
                    : state.denickRealIgnNametags;
                return denickEnabled ? real : null;
            },
            // Never rename onto a name that is genuinely in the lobby.
            isNameTaken: (name) => lobbyPlayers.has(name),
            // Convergence packets are already final and must NOT be rewritten
            // again — one of each pair deliberately carries the old name, to
            // retire the entry the client is still holding under it.
            resend: (packetName, payload) => {
                try {
                    client.write(packetName, payload);
                } catch (e) {}
            },
            // A retroactive rename re-adds the tab row as Hypixel originally
            // sent it, which drops whatever tab stats had painted over it.
            onRename: ({ nick }) => {
                queueTabStatsUpdate(nick, 0);
                scheduleNametagSync(0);
            },
            onProfileReissued: (profile) => {
                refreshVisiblePlayerEntityProfile(profile);
                if (!isTabStatsActiveInGame()) return;
                const renderedName = nickKey(profile?.name);
                const rename = denickDisplayNames.activeRenames().find(entry => (
                    nickKey(entry.nick) === renderedName || nickKey(entry.real) === renderedName
                ));
                reapplyCachedTabStatsForPlayer(rename?.nick || getLobbyPlayerKey(profile?.name));
            }
        });

        // Single choke point for EVERY scoreboard_team packet this proxy sends.
        //
        // The client keys team membership by name, so once a player is renamed
        // in player_info, every team packet naming them must use the SAME
        // rendered name. The proxy re-sends team membership itself (restoring
        // Hypixel teams, nametag overlay teams), and those writes bypass the
        // forward path — send a nick there and the renamed player belongs to no
        // team at all, which is why they rendered as plain white text with no
        // team prefix.
        function writeScoreboardTeamPacket(payload, { applySidebarTeamColors = false } = {}) {
            const renamedForClient = denickDisplayNames.rewriteTeamPacket(payload);
            const displayedToClient = applySidebarTeamColors
                ? rewriteBedwarsSidebarTeamColorsForClient(renamedForClient)
                : renamedForClient;
            client.write('scoreboard_team', displayedToClient);
        }
        const rememberKnownDenickInSession = (name, realName, source = 'history', options = {}) => {
            if (!denickTracker.rememberKnownDenickInSession(name, realName, source)) return false;
            cleanupDenickAliasDuplicate(realName, `known_denick_${source}`);
            if (options.queueUpdates !== false && gameActive && isSupportedTabStatsMode(currentGamemode)) {
                queueOverlayStatsUpdate(name, 0);
                queueTabStatsUpdate(name, 0);
                saveCurrentMatchSnapshot(`known_denick_${source}`);
            }
            return true;
        };

        function getLobbyPlayerKey(name) {
            if (lobbyPlayers.has(name)) return name;
            const key = nickKey(name);
            for (const currentName of lobbyPlayers.keys()) {
                if (nickKey(currentName) === key) return currentName;
            }
            return name;
        }

        function deletePlayerNameFromSet(set, name) {
            if (!set || !name) return;
            const key = nickKey(name);
            Array.from(set).forEach(currentName => {
                if (nickKey(currentName) === key) set.delete(currentName);
            });
        }

        function isDenickAliasDuplicate(name) {
            const alias = getDenickAliasForRealName(name);
            if (!alias) return false;
            const nickName = getLobbyPlayerKey(alias.nickName);
            const nickInfo = lobbyPlayers.get(nickName);
            // The real IGN is only a duplicate of the nick while the nick is
            // still holding a tab row of its own. A remembered uuid is not
            // presence: lobbyPlayers keeps a player's record - uuid included -
            // after they leave, and pruneStalePlayers is a no-op during a game,
            // so the record of a nick who disconnected mid-match survived to
            // the end of it. That made the nick go on suppressing its own real
            // IGN: a player who unnicked in a Hypixel lobby and rejoined under
            // that IGN had their player_info filtered out on arrival and never
            // appeared in the tab list at all, for the rest of the game.
            if (nickInfo && !nickInfo.inTab && nickInfo.leftTabAt) return false;
            return Boolean(gameRoster.has(nickName) || nickInfo?.uuid || nickInfo?.inTab);
        }

        function cleanupDenickAliasDuplicate(realName, reason = 'denick_alias') {
            if (!isValidPlayerName(realName) || !isDenickAliasDuplicate(realName)) return false;

            const alias = getDenickAliasForRealName(realName);
            const realPlayerName = getLobbyPlayerKey(realName);
            const nickName = getLobbyPlayerKey(alias.nickName);
            const realInfo = lobbyPlayers.get(realPlayerName);
            const nickInfo = lobbyPlayers.get(nickName);
            const realUuid = realInfo?.uuid;
            const nickUuid = nickInfo?.uuid;

            scoreboardTeamRegistry.forEach(teamInfo => {
                if (teamInfo?.players) {
                    deletePlayerNameFromSet(teamInfo.players, realName);
                    deletePlayerNameFromSet(teamInfo.players, realPlayerName);
                }
            });

            deletePlayerNameFromSet(gameRoster, realName);
            deletePlayerNameFromSet(gameRoster, realPlayerName);
            detectedNickedPlayers.delete(nickKey(realPlayerName));
            autoDenickStats.delete(nickKey(realPlayerName));
            autoSkinDenickAttempts.delete(nickKey(realPlayerName));

            if (tabStatsTimers.has(realPlayerName)) {
                clearTimeout(tabStatsTimers.get(realPlayerName));
                tabStatsTimers.delete(realPlayerName);
            }
            tabStatsAppliedNames.delete(realPlayerName);
            tabIdentityWidths.delete(realPlayerName);

            if (realUuid && realUuid !== nickUuid) {
                try {
                    client.write('player_info', {
                        action: 4,
                        data: [{ uuid: realUuid }]
                    });
                } catch (e) {}
                forgetUuidName(realUuid);
                defaultTabSnapshot.displayNames.delete(realUuid);
            }

            lobbyPlayers.delete(realPlayerName);
            scheduleBedwarsClientTeamSync(20);
            saveCurrentMatchSnapshot(reason);
            return true;
        }

        function filterDenickAliasPlayerInfoPacket(packet, action) {
            if (!packet || !Array.isArray(packet.data)) return packet;
            const actionId = typeof packet.action === 'number'
                ? packet.action
                : ({ add_player: 0, update_gamemode: 1, update_latency: 2, update_display_name: 3, remove_player: 4 })[action];
            if (![0, 1, 2, 3].includes(actionId)) return packet;

            const filtered = packet.data.filter(entry => {
                const uuid = entry.UUID || entry.uuid;
                const name = entry.name || getUuidMappedName(uuid);
                if (!name || !isDenickAliasDuplicate(name)) return true;
                cleanupDenickAliasDuplicate(name, `player_info_${action || actionId}`);
                return false;
            });

            if (filtered.length === packet.data.length) return packet;
            if (filtered.length === 0) return null;
            return { ...packet, data: filtered };
        }

        const AUTO_SKIN_DENICK_RETRY_DELAYS = [0, 1000, 3000, 7000, 12000];

        function clearAutoSkinDenickAttempts() {
            autoSkinDenickAttempts.forEach(state => {
                if (state?.timer) clearTimeout(state.timer);
            });
            autoSkinDenickAttempts.clear();
        }

        function isAutoSkinDenickEligible(name) {
            return gameActive
                && isSupportedTabStatsMode(currentGamemode)
                && isValidPlayerName(name)
                && !isOwnPlayerName(name)
                && !isSameTeamAsClient(name);
        }

        function storeDenickResult(name, realName, source = 'skin') {
            if (!isValidPlayerName(name) || !isValidPlayerName(realName)) return false;
            if (nickKey(name) === nickKey(realName)) return false;

            const key = nickKey(name);
            const existing = autoDenickResults.get(key) || {};
            if (existing.realName) return false;

            autoDenickResults.set(key, {
                ...existing,
                nick: name,
                realName,
                source,
                skinDenicked: source === 'skin' || source === 'skin_manual',
                at: Date.now()
            });
            rememberCurrentGameDenickNames(name, realName);
            appendDenickHistory({
                nick: name,
                realIGN: realName,
                method: source,
                stats: source === 'stats' ? {
                    finals: existing.finals ?? existing.observedFinals ?? null,
                    beds: existing.beds ?? existing.observedBeds ?? null
                } : null,
                gameMode: currentGamemode,
                account: client.username
            });
            cleanupDenickAliasDuplicate(realName, `denick_${source}`);
            if (gameActive && isSupportedTabStatsMode(currentGamemode)) {
                queueOverlayStatsUpdate(name, 0);
                queueTabStatsUpdate(name, 0);
            }

            const state = autoSkinDenickAttempts.get(key) || {};
            state.done = true;
            if (state.timer) clearTimeout(state.timer);
            state.timer = null;
            autoSkinDenickAttempts.set(key, state);
            return true;
        }

        async function announceSuccessfulDenick(name, result = {}) {
            const realName = result.realName;
            if (shouldSuppressDenickAnnouncement(name)) return;
            if (hasAnnouncedDenick(name)) return;
            markDenickAnnounced(name);
            if (denickChatAnnouncementsEnabled) {
                sendChat(client, `§b[Denick] §c${name} §a(${realName})`);
            }

            const profile = await getPlayerData(realName, { includeErrors: true });
            if (profile?.error || !profile?.data?.player) {
                if (denickChatAnnouncementsEnabled) {
                    sendChat(client, `§7Could not fetch full stats for §a${realName}§7 right now.`);
                }
                return;
            }
            rememberPlayerActiveCosmetics(name, profile.data, 'denick');
            rememberPlayerActiveCosmetics(realName, profile.data, 'denick');

            if (denickPartyAnnounceEnabled) {
                announceDenickToParty(name, realName, profile.data);
            }

            if (!denickChatAnnouncementsEnabled) return;

            if (currentGamemode === 'SKYWARS') {
                renderSkyWarsDashboard(client, profile.data, profile.fromCache);
            } else {
                renderBedwarsStats(client, profile.data, BEDWARS_MODE_DEFS[0], {
                    detailed: false,
                    isCached: profile.fromCache
                });
            }
        }

        function announceDenickToParty(nick, realName, data) {
            if (!partyTracker.isInParty() || currentGamemode === 'SKYWARS') return;
            const player = data?.player;
            if (!player) return;
            const bedwars = player.stats?.Bedwars || {};
            const stars = numberOr(player.achievements?.bedwars_level, 0);
            const fkdr = ratioValue(bedwars.final_kills_bedwars, bedwars.final_deaths_bedwars);
            const wlr = ratioValue(bedwars.wins_bedwars, bedwars.losses_bedwars);
            const winstreak = numberOr(bedwars.winstreak, 0);
            const message = `[Denick] ${realName} is nicked as ${nick} | ${Math.round(stars)}★ FKDR ${fkdr.toFixed(2)} WLR ${wlr.toFixed(2)} WS ${winstreak}`;
            void sendHypixelCommand(`/pc ${message}`, {
                priority: 85,
                dedupeKey: `denick-party:${nick}:${realName}`,
                dedupeMs: 5_000
            });
        }

        function announceKnownPregameDenickToParty(nick, realName) {
            // Party Announcements covers saved denicks too. Unlike a fresh
            // automatic denick, this identity is already known, so announce it
            // immediately instead of waiting for a second stats lookup.
            if (!denickPartyAnnounceEnabled || !partyTracker.isInParty() || currentGamemode === 'SKYWARS') return;
            // A saved identity may be one of our own teammates. Their nick is
            // useful to Auto Dodge as a no-dodge guard, but repeating their
            // real IGN into party chat reveals them to the whole party.
            if (partyTracker.isTrackedMember(realName)) return;
            const message = `[Denick] ${realName} is nicked as ${nick}`;
            void sendHypixelCommand(`/pc ${message}`, {
                priority: 85,
                dedupeKey: `known-denick-party:${nick}:${realName}`,
                dedupeMs: 5_000
            });
        }

        function queueAutoSkinDenick(name, source = 'unknown') {
            if (!autoSkinDenickEnabled) return;
            if (!isAutoSkinDenickEligible(name) || !isDetectedNickedPlayer(name)) return;
            if (getAutoDenickResult(name)?.realName) return;

            const key = nickKey(name);
            const state = autoSkinDenickAttempts.get(key) || {
                nextAttempt: 0,
                inFlight: false,
                done: false,
                timer: null
            };
            if (state.done || state.inFlight || state.timer) return;
            if (state.nextAttempt >= AUTO_SKIN_DENICK_RETRY_DELAYS.length) {
                state.done = true;
                autoSkinDenickAttempts.set(key, state);
                return;
            }

            const delay = AUTO_SKIN_DENICK_RETRY_DELAYS[state.nextAttempt++];
            state.timer = setTimeout(() => {
                state.timer = null;
                attemptAutoSkinDenick(name, source).catch(() => {});
            }, delay);
            autoSkinDenickAttempts.set(key, state);
        }

        async function attemptAutoSkinDenick(name, source = 'unknown') {
            const key = nickKey(name);
            const state = autoSkinDenickAttempts.get(key) || {
                nextAttempt: 0,
                inFlight: false,
                done: false,
                timer: null
            };

            if (!autoSkinDenickEnabled) {
                state.done = true;
                state.inFlight = false;
                autoSkinDenickAttempts.set(key, state);
                return;
            }

            if (!isAutoSkinDenickEligible(name) || !isDetectedNickedPlayer(name)) {
                state.done = true;
                state.inFlight = false;
                autoSkinDenickAttempts.set(key, state);
                return;
            }

            if (getAutoDenickResult(name)?.realName) {
                state.done = true;
                state.inFlight = false;
                autoSkinDenickAttempts.set(key, state);
                return;
            }

            state.inFlight = true;
            autoSkinDenickAttempts.set(key, state);

            const playerData = lobbyPlayers.get(name);
            if (!playerData?.properties) {
                state.inFlight = false;
                autoSkinDenickAttempts.set(key, state);
                queueAutoSkinDenick(name, source);
                return;
            }

            const realName = getRealNameFromSkin(playerData.properties);
            state.inFlight = false;

            if (realName && storeDenickResult(name, realName, 'skin')) {
                const result = getAutoDenickResult(name);
                announceSuccessfulDenick(name, result).catch(() => {
                    if (denickChatAnnouncementsEnabled) {
                        sendChat(client, `§b[SkinDenick] §7Auto-denicked §c${name} §8(§a${realName}§8)§7.`);
                    }
                });
                if (isTabStatsActiveInGame() && gameRoster.has(name)) {
                    queueTabStatsUpdate(name, 50);
                }
                if (gameActive) saveCurrentMatchSnapshot(`skin_denick_${source}`);
                return;
            }

            state.done = true;
            autoSkinDenickAttempts.set(key, state);
        }

        function markNickedPlayer(name, source = 'unknown') {
            if (!isValidPlayerName(name) || isLikelyBot(name)) return;
            if (isDenickAliasDuplicate(name)) {
                cleanupDenickAliasDuplicate(name, `mark_nicked_${source}`);
                return;
            }
            detectedNickedPlayers.set(nickKey(name), {
                name,
                source,
                at: Date.now()
            });
            if (applyKnownDenickFromHistory(name, source)) return;
            queueAutoSkinDenick(name, source);
        }

        function isDetectedNickedPlayer(name) {
            return detectedNickedPlayers.has(nickKey(name));
        }

        function clientBedwarsTeamName() {
            // myTeam is only written when Hypixel adds us to a BedWars team; fall
            // back to live scoreboard membership so a missed/reset assignment does
            // not silently reclassify every teammate as an enemy.
            return myTeam || resolveBedwarsTeamName(client.username) || null;
        }

        function isSameTeamAsClient(name) {
            const ownTeam = clientBedwarsTeamName();
            const playerTeam = resolveBedwarsTeamName(name);
            return Boolean(currentGamemode === 'BEDWARS' && ownTeam && playerTeam && playerTeam === ownTeam);
        }

        function isAutoDenickEligibleActor(name) {
            return gameActive
                && currentGamemode === 'BEDWARS'
                && isValidPlayerName(name)
                && !isOwnPlayerName(name)
                && !isSameTeamAsClient(name);
        }

        function packetEntityId(data = {}) {
            const id = data.entityId ?? data.entityID;
            return Number.isFinite(Number(id)) ? Number(id) : null;
        }

        function fixedEntityCoord(value) {
            const number = Number(value);
            return Number.isFinite(number) ? number / 32 : null;
        }

        function entityPositionFromFixedPacket(data = {}) {
            const x = fixedEntityCoord(data.x);
            const y = fixedEntityCoord(data.y);
            const z = fixedEntityCoord(data.z);
            if ([x, y, z].some(value => value === null)) return null;
            return { x, y, z };
        }

        entityTracker = createEntityTracker({
            isValidPlayerName: (name) => isValidPlayerName(name),
            normalizeUuid: (value) => normalizeUuid(value),
            nickKey: (name) => nickKey(name),
            packetEntityId: (data) => packetEntityId(data),
            entityPositionFromFixedPacket: (data) => entityPositionFromFixedPacket(data),
            getUuidMappedName: (uuid) => getUuidMappedName(uuid),
            playerEntityPacketNames: PLAYER_ENTITY_PACKET_NAMES
        });
        const {
            rememberRecentPlayerPosition,
            getRecentPlayerPosition,
            setPlayerEntityName,
            attachNameToPlayerEntities,
            forgetPlayerEntity,
            updatePlayerEntityPosition,
            updatePlayerEntityRelativePosition,
            rememberPlayerEntityHeldItem,
            observePlayerEntityPacket,
            isPlayerEntityInvisible
        } = entityTracker;

        // Replay viewer presence, from two signals: the "Playing mm:ss / mm:ss"
        // action bar (repeats every second while watching) and the sidebar
        // titled REPLAY. Losing the REPLAY sidebar means you left, so that is
        // reported at once; the action-bar timeout is only a fallback for when
        // the sidebar was never seen.
        const REPLAY_LEAVE_MS = 5000;
        let inReplayViewer = false;
        let replayLeaveTimer = null;
        let replaySidebarSeen = false;
        function isReplaySidebar() {
            return stripAnsi(getCurrentScoreboardTitle()).trim().toUpperCase() === 'REPLAY';
        }
        function setReplayViewer(active) {
            if (replayLeaveTimer && !active) {
                clearTimeout(replayLeaveTimer);
                replayLeaveTimer = null;
            }
            if (active === inReplayViewer) return;
            inReplayViewer = active;
            if (!active) replaySidebarSeen = false;
            stopReplayClipAnnouncement();
            if (active) replayClipsTimer = setTimeout(() => announceReplayClips(0), REPLAY_CLIPS_RETRY_MS);
        }
        function noteReplayActionBar() {
            setReplayViewer(true);
            if (replayLeaveTimer) clearTimeout(replayLeaveTimer);
            replayLeaveTimer = setTimeout(() => {
                replayLeaveTimer = null;
                // A paused replay may stop the bar; the sidebar still says REPLAY.
                if (!isReplaySidebar()) setReplayViewer(false);
            }, REPLAY_LEAVE_MS);
        }
        function syncReplaySidebar() {
            if (isReplaySidebar()) {
                replaySidebarSeen = true;
                setReplayViewer(true);
            } else if (inReplayViewer && replaySidebarSeen) {
                setReplayViewer(false);
            }
        }

        // What the REPLAY sidebar says about the game being watched.
        function readReplaySidebarInfo() {
            const lines = getScoreboardLineList().map(line => stripAnsi(line).replace(/[\u{10000}-\u{10FFFF}]/gu, '').replace(/\s+/g, ' ').trim());
            const field = label => lines.map(line => line.match(new RegExp(`^${label}:\\s*(.+)$`, 'i'))?.[1]).find(Boolean) || null;
            const game = field('Game');
            const mode = /bed ?wars/i.test(game || '') ? 'BEDWARS' : /sky ?wars/i.test(game || '') ? 'SKYWARS' : null;
            return {
                game,
                mode,
                variant: field('Mode'),
                map: field('Map'),
                serverId: lines.map(line => line.match(/^Replay from\s+([A-Za-z0-9]+)/i)?.[1]).find(Boolean) || null,
                startNaiveMs: replayStartNaiveMs(field('Date'), field('Time'))
            };
        }

        // "09/19/2026" + "04:25 (EST)" -> that wall-clock time read as UTC.
        function replayStartNaiveMs(date, time) {
            const day = String(date || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
            const clock = String(time || '').match(/(\d{1,2}):(\d{2})/);
            if (!day || !clock) return null;
            const year = Number(day[3]) < 100 ? 2000 + Number(day[3]) : Number(day[3]);
            return Date.UTC(year, Number(day[1]) - 1, Number(day[2]), Number(clock[1]), Number(clock[2]));
        }

        // On entering a replay, list the /clip moments saved for that game.
        // The sidebar can still be filling in when you join, so this retries
        // briefly until the server and start time are readable; nothing is
        // printed when the game has no clips.
        const REPLAY_CLIPS_RETRY_MS = 500;
        const REPLAY_CLIPS_ATTEMPTS = 20;
        let replayClipsTimer = null;
        function stopReplayClipAnnouncement() {
            if (replayClipsTimer) clearTimeout(replayClipsTimer);
            replayClipsTimer = null;
        }
        function announceReplayClips(attempt = 0) {
            replayClipsTimer = null;
            if (!inReplayViewer) return;
            const info = readReplaySidebarInfo();
            if (!info.serverId || info.startNaiveMs === null) {
                if (attempt + 1 < REPLAY_CLIPS_ATTEMPTS) {
                    replayClipsTimer = setTimeout(() => announceReplayClips(attempt + 1), REPLAY_CLIPS_RETRY_MS);
                }
                return;
            }
            let clips = [];
            try {
                clips = findReplayClips(clipStore.listGames(), info);
            } catch (error) {
                return;
            }
            if (!clips.length) return;
            sendChat(client, `§6§lFury §8» §7Clips in this replay:`);
            clips.forEach(clip => sendChat(client, `§8- §e${formatClipTime(clip.offsetMs)} §f${clip.label}`));
        }

        // Raw copy of the tab list, taken before any of the proxy's own
        // filtering. A replay's tab list is not a game's: its players are
        // recorded entities the live-game bookkeeping (lobbyPlayers) never
        // keeps, and the viewer is listed as "[Viewer] name". Replay /scan and
        // /who read the players from here instead.
        let replayTabEntries = new Map();
        const REPLAY_TEAM_BY_COLOR = {
            '§c': 'Red', '§9': 'Blue', '§a': 'Green', '§e': 'Yellow',
            '§b': 'Aqua', '§f': 'White', '§d': 'Pink', '§8': 'Gray'
        };

        function observeReplayTabEntries(data, action) {
            for (const entry of data?.data || []) {
                const uuid = normalizeUuid(entry.UUID || entry.uuid);
                if (!uuid) continue;
                if (action === 'remove_player' || data.action === 4) {
                    replayTabEntries.delete(uuid);
                } else if (action === 'add_player' || data.action === 0) {
                    replayTabEntries.set(uuid, { name: entry.name || null, displayName: entry.displayName ?? null });
                } else if ((action === 'update_display_name' || data.action === 3) && replayTabEntries.has(uuid)) {
                    replayTabEntries.set(uuid, { ...replayTabEntries.get(uuid), displayName: entry.displayName ?? null });
                }
            }
        }

        function tabDisplayText(displayName) {
            if (displayName === null || displayName === undefined || displayName === '') return '';
            if (typeof displayName !== 'string') return extractFormattedText(displayName);
            try {
                return extractFormattedText(JSON.parse(displayName));
            } catch (error) {
                return displayName;
            }
        }

        // Players in the replay being watched, as shown in its tab list: the
        // visible name, its colour and the BedWars team that colour stands for.
        // "[Viewer]" rows are you watching; your own row as a player stays.
        //
        // A recorded player's profile name is capped at 16 characters with a
        // colour code in front ("§7astral_v_astra"), and its scoreboard team's
        // suffix draws the rest ("le"). So without a display name the visible
        // name is rebuilt like the client draws it: prefix + name + suffix;
        // the truncated name alone is no account and would look like a nick.
        //
        // A colour only counts as a team while no more players share it than
        // the mode's team size (from the replay sidebar): before the recorded
        // game starts everyone is white, which is not a White team of 16.
        const REPLAY_TEAM_SIZES = { solos: 1, doubles: 2, threes: 3, fours: 4, '4v4': 4 };
        function replayPlayers(variant = null) {
            const byName = new Map();
            replayTabEntries.forEach((entry) => {
                const rawName = String(entry.name || '');
                const teamName = scoreboardEntryTeams.get(rawName);
                const team = teamName ? rawScoreboardTeams.get(teamName) : null;
                const formatted = tabDisplayText(entry.displayName)
                    || `${team?.prefix || ''}${rawName}${team?.suffix || ''}`;
                const visible = stripAnsi(formatted).replace(/\s+/g, ' ').trim();
                if (!visible || /^\[viewer\]/i.test(visible)) return;
                const tokens = visible.split(' ').filter(isValidPlayerName);
                const plainName = stripAnsi(rawName);
                const name = tokens[tokens.length - 1] || (isValidPlayerName(plainName) ? plainName : null);
                if (!name || byName.has(name.toLowerCase())) return;
                const shownColor = extractDisplayColor(formatted, name);
                byName.set(name.toLowerCase(), {
                    name,
                    color: shownColor || '§f',
                    team: (shownColor && REPLAY_TEAM_BY_COLOR[shownColor]) || null
                });
            });
            const players = Array.from(byName.values());
            const teamSize = REPLAY_TEAM_SIZES[String(variant || '').trim().toLowerCase()] || 4;
            const perColor = new Map();
            players.forEach(player => perColor.set(player.color, (perColor.get(player.color) || 0) + 1));
            players.forEach((player) => {
                if (perColor.get(player.color) > teamSize) player.team = null;
            });
            return players;
        }

        function replayPlayerNames() {
            return replayPlayers(readReplaySidebarInfo().variant).map(player => player.name);
        }

        // Hypixel has no /who in replays, so answer it the way it does in a
        // game: "ONLINE: " and every player in their rank colour. Colours come
        // from cached profiles or the rank book only (no API call); unknown
        // players are grey, as a player without a rank is on Hypixel.
        function replayWhoNameColor(name) {
            const profile = globalCache.get(playerLookupKey(name))?.data;
            if (profile?.player && !profile.isNicked && !profile.lookupFailed) {
                return resolveHypixelRank(profile.player).nameColor || '§7';
            }
            const display = rankBook.get(name)?.display || '';
            const beforeName = display.toLowerCase().endsWith(name.toLowerCase())
                ? display.slice(0, display.length - name.length)
                : '';
            return beforeName.match(/(§[0-9a-f])$/i)?.[1] || '§7';
        }

        function handleReplayWho() {
            const names = replayPlayerNames();
            if (!names.length) {
                sendChat(client, '§6§lFury §8» §cNo players detected in this replay yet. Try again in a moment.');
                return;
            }
            sendChat(client, `§bONLINE: ${names.map(name => `${replayWhoNameColor(name)}${name}`).join('§7, ')}`);
        }

        // /scan inside a replay: every player in the replay, stats only. Uses
        // its own fixed settings (all players, default threat thresholds) via
        // performReplayScan, never shares to party, and writes nothing the
        // live /scan, /share or overlay rely on.
        let replayScanInProgress = false;
        async function runReplayScan() {
            if (replayScanInProgress) {
                sendChat(client, '§6§lFury §8» §cReplay scan already in progress!');
                return false;
            }
            const info = readReplaySidebarInfo();
            if (info.game && !info.mode) {
                sendChat(client, `§6§lFury §8» §cReplay scan supports Bed Wars and SkyWars replays (this is ${info.game}).`);
                return false;
            }
            const mode = info.mode || 'BEDWARS';
            const now = Date.now();
            const players = replayPlayers(info.variant);
            const roster = new Set(players.map(player => player.name));
            const replayLobby = new Map(players.map(player => [player.name, {
                color: player.color,
                displayColor: player.color,
                letter: '?',
                uuid: null,
                team: player.team,
                teamAssignedAt: now,
                joinTime: now,
                properties: null,
                originalDisplayName: null,
                inTab: true,
                lastSeen: now,
                leftTabAt: null,
                sources: new Set(['replay'])
            }]));
            if (!roster.size) {
                sendChat(client, '§6§lFury §8» §cNo players detected in this replay yet. Try again in a moment.');
                return false;
            }
            const where = [info.variant, info.map, info.serverId].filter(Boolean).join(' · ');
            const teamNote = players.some(player => player.team) ? '' : ' §8· §7no teams yet at this point of the replay';
            sendChat(client, `§6§lFury §8» §7Scanning §f${roster.size} §7players${where ? ` §8(${where})` : ''}${teamNote}`);
            replayScanInProgress = true;
            const localNicks = new Map();
            try {
                await performReplayScan(client, replayLobby, localNicks, null, {
                    gameActive: true,
                    gameRoster: roster,
                    gameMode: mode,
                    gameSessionId: null,
                    autoDenickResults,
                    markNickedPlayer: (name, source = 'replay_scan') => localNicks.set(String(name).toLowerCase(), { name, source, at: Date.now() }),
                    getKnownDenick: findKnownDenickByNick,
                    isDenickAliasDuplicate,
                    isOwnPlayer: () => false,
                    getCachedPlayerProfile: getCachedOrPendingPregameChatProfile,
                    shareStream: null,
                    isStillActive: () => inReplayViewer
                });
                return true;
            } finally {
                replayScanInProgress = false;
            }
        }
        // Local session tracker + post-game recap. One Hypixel snapshot per
        // finished game (delayed so Hypixel has propagated the result), diffed
        // against the previous boundary snapshot. Entirely separate from the
        // Urchin-backed /daily card, which fetches a remote period delta.
        const sessionTracker = createSessionTracker({
            store: sessionStore,
            getIdentity: () => ({ uuid: client.uuid, name: client.username }),
            getResumeWindowMs: () => state.sessionBoundaryMinutes * 60 * 1000,
            fetchOwnStats: async () => {
                const profile = await getPlayerData(client.username, {
                    forceRefresh: true,
                    preferCache: false,
                    apiPriority: 'background'
                });
                return profile?.data || null;
            },
            isEnabled: () => state.sessionTrackingEnabled,
            isApiAvailable: () => !state.apiKillSwitchEnabled && hasHypixelApiKeyConfigured(),
            onGameRecap: (recap) => {
                if (state.gameRecapEnabled) {
                    try {
                        renderGameRecap(client, recap, {
                            style: state.sessionRecapStyle,
                            fields: state.sessionRecapFields,
                            goals: {
                                wins: state.sessionGoalWins,
                                finals: state.sessionGoalFinals,
                                games: state.sessionGoalGames,
                                minutes: state.sessionGoalMinutes
                            }
                        });
                    } catch (error) {
                        console.error('[Session] Recap render failed:', error.message);
                    }
                }
            }
        });
        sessionTracker.resumePendingRetries();
        activeUser.startNewSession = () => sessionTracker.reset();
        activeUser.endCurrentSession = () => sessionTracker.finish();

        // Own team for result inference. client.username misses a nicked
        // player; myTeam follows the scoreboard through isOwnPlayerName. Last
        // resort: a confirmed party shares one team in team modes, so adopt it
        // when that team holds more than one player (never Solo, where party
        // members are opponents).
        function resolveOwnBedwarsTeam() {
            const direct = resolveBedwarsTeamName(client.username) || myTeam;
            if (direct) return direct;
            const partyTeams = new Set((getConfirmedPartyMemberNames() || [])
                .map(name => resolveBedwarsTeamName(name))
                .filter(Boolean));
            if (partyTeams.size !== 1) return null;
            const [partyTeam] = partyTeams;
            const members = [...lobbyPlayers.keys()].filter(name => resolveBedwarsTeamName(name) === partyTeam);
            return members.length >= 2 ? partyTeam : null;
        }

        function buildSessionGameMetadata(mode = currentGamemode) {
            const ownTeam = mode === 'BEDWARS' ? resolveOwnBedwarsTeam() : null;
            const party = getConfirmedPartyMemberNames();
            const bedwarsQueue = mode === 'BEDWARS'
                ? requeueCommandForScoreboard(getCurrentScoreboardText())
                : null;
            return {
                serverId: activeMatchServerId || pregameLobbyIdForScoreboard(getCurrentScoreboardText()) || null,
                map: activeSessionGameMetadata?.map || null,
                variant: resolveSessionGameVariant(mode, {
                    duelsModeName: duelsState.modeName,
                    bedwarsQueue,
                    previousVariant: activeSessionGameMetadata?.variant
                }),
                team: ownTeam || activeSessionGameMetadata?.team || null,
                party: Array.isArray(party) ? party.slice(0, 16) : [],
                observedFromStart: presentAtGameStart,
                disconnected: Boolean(activeSessionGameMetadata?.disconnected)
            };
        }

        // /clip [name]: mark the current moment of the live game. Standard
        // BedWars reads the time off the sidebar event countdown (Hypixel's own
        // clock); everything else counts from the proxy's game start, which a
        // reconnect restores, so time spent disconnected is still counted.
        function handleClipCommand(client, args = []) {
            const prefix = '§8[§bClip§8] ';
            if (!gameActive || !gameStartTime) {
                sendChat(client, `${prefix}§cYou're not in a game.`);
                return;
            }
            const variant = activeSessionGameMetadata?.variant || buildSessionGameMetadata(currentGamemode).variant;
            const sidebarElapsed = currentGamemode === 'BEDWARS' && isStandardBedwarsVariant(variant)
                ? bedwarsElapsedFromSidebar(getScoreboardLineList())
                : null;
            const elapsedMs = sidebarElapsed ?? Math.max(0, Date.now() - gameStartTime);
            const serverId = activeMatchServerId || pregameLobbyIdForScoreboard(getCurrentScoreboardText()) || null;
            const result = clipStore.addClip({
                serverId,
                mode: currentGamemode || null,
                elapsedMs,
                label: args.join(' ')
            });
            if (!result.ok) {
                const reasons = {
                    too_long: `§cThis game is past ${Math.round(MAX_CLIP_GAME_MS / 60000)} minutes, so its end was missed. Clip not saved.`,
                    cooldown: '§cYou just saved a clip, wait a moment.',
                    full: `§cThis game already has ${MAX_CLIPS_PER_GAME} clips.`
                };
                sendChat(client, `${prefix}${reasons[result.reason] || "§cYou're not in a game."}`);
                return;
            }
            const note = serverId ? '' : " §8(server unknown, won't show in /replay)";
            sendChat(client, `${prefix}§7Saved §f${result.clip.label} §7at §e${formatClipTime(result.clip.offsetMs)}${note}`);
        }

        function appendSessionGameEvent(rawEvent) {
            if (!gameActive || !gameStartTime || !state.sessionTrackingEnabled || sessionGameFinalized) return null;
            const event = normalizeGameEvent(rawEvent, { startedAt: gameStartTime });
            const signature = eventSignature(event);
            const duplicate = activeSessionGameEvents.some(existing => (
                eventSignature(existing) === signature
                || (existing.rawText && event.rawText && existing.rawText === event.rawText
                    && Math.abs(existing.at - event.at) < 1500)
            ));
            if (duplicate) return null;
            event.id = event.id || `live-${gameSessionId}-${activeSessionGameEvents.length + 1}`;
            activeSessionGameEvents.push(event);
            if (activeSessionGameEvents.length > 512) activeSessionGameEvents.splice(0, activeSessionGameEvents.length - 512);
            return event;
        }

        function startSessionGameEventCapture(mode, initialMetadata = {}) {
            sessionGameFinalized = false;
            activeSessionGameEvents = [];
            // A new game must never inherit metadata from the previous record.
            // Pregame-only values, such as a Bed Wars map, are handed in once.
            activeSessionGameMetadata = null;
            activeSessionGameMetadata = {
                ...buildSessionGameMetadata(mode),
                ...(initialMetadata && typeof initialMetadata === 'object' ? initialMetadata : {})
            };
            appendSessionGameEvent({
                type: 'game_start',
                at: gameStartTime || Date.now(),
                offsetMs: 0,
                source: 'system',
                confidence: 'confirmed',
                note: `${mode || 'Game'} started`
            });
        }

        // Which of the player's names is live in this game, e.g. the nick while
        // nicked. A tab entry carrying the player's own UUID is conclusive; a
        // known nick that cannot be placed in the tab leaves identity unknown.
        function localSessionIdentity(){
            const known=getOwnKnownNames(),inTab=known.filter(name=>lobbyPlayers.get(name)?.inTab);
            const byUuid=inTab.filter(name=>isOwnUuid(lobbyPlayers.get(name).uuid));
            const ownNames=byUuid.length?byUuid:inTab;
            if(ownNames.length)return {ownNames,identityKnown:true};
            return {ownNames:[client.username],identityKnown:known.every(name=>name.toLowerCase()===client.username.toLowerCase())};
        }
        let localDuelKey=null,localDuelStartedAt=0;
        function finishLocalDuel(){
            if(!localDuelKey)return;
            sessionTracker.onGameEnd({mode:'DUELS',sessionKey:localDuelKey,force:true,durationMs:Math.max(0,Date.now()-localDuelStartedAt)});
            localDuelKey=null;
        }
        function observeSessionGameChat(text) {
            if(localDuelKey&&state.sessionTrackingEnabled){
                sessionTracker.observeLocalChat(text,{mode:'DUELS',sessionKey:localDuelKey,...localSessionIdentity()});
                if(sessionTracker.observeLocalResult(text)&&sessionTracker.getActiveSession()?.localTracking?.current?.result)finishLocalDuel();
                return;
            }
            if (!gameActive || !gameStartTime || !state.sessionTrackingEnabled || sessionGameFinalized) return;
            const metadata = buildSessionGameMetadata();
            sessionTracker.observeLocalResult(text);
            sessionTracker.observeLocalChat(text, {
                mode: currentGamemode, sessionKey: `${activeMatchServerId || 'game'}:${gameStartTime}`,
                ownTeam: metadata.team,
                ...localSessionIdentity()
            });
            activeSessionGameMetadata = { ...(activeSessionGameMetadata || {}), ...metadata };
            parseGameEvents(text, {
                at: Date.now(),
                startedAt: gameStartTime,
                ownTeam: metadata.team,
                resolveTeam: name => resolveBedwarsTeamName(name),
                resolveKillOwner: line => detectKillMessageOwner(line)
            }).forEach(event => {
                const recorded = appendSessionGameEvent(event);
                if (recorded && isOwnTeamElimination(recorded, currentGamemode, metadata.team)) {
                    finalizeSessionGame(true);
                    saveCurrentMatchSnapshot('team_eliminated');
                }
            });
        }

        function finalizeSessionGame(immediate = false) {
            if (sessionGameFinalized) return;
            const roster = buildSessionRosterSnapshot();
            const durationMs = gameStartTime ? Math.max(0, Date.now() - gameStartTime) : null;
            // Leave short, unconfirmed scoreboard transitions eligible for a
            // later real result. Team elimination is authoritative even early.
            if (immediate || durationMs === null || durationMs >= 30000) sessionGameFinalized = true;
            Promise.resolve(sessionTracker.onGameEnd({
                mode: currentGamemode,
                roster,
                teammates: roster.filter(entry => entry.relation === 'teammate').map(entry => entry.name),
                opponents: roster.filter(entry => entry.relation !== 'teammate').map(entry => entry.name),
                metadata: buildSessionGameMetadata(currentGamemode),
                events: activeSessionGameEvents.slice(),
                durationMs,
                sessionKey: gameSessionId,
                immediate,
                force: immediate
            })).catch(error => console.error('[Session] Game finalization failed:', error?.message || error));
        }

        function rewriteBedwarsEventLabelsForClient(packet) {
            if (!accentBedwarsEventLabelsEnabled
                || (packet?.position || 0) === 2
                || typeof packet?.message !== 'string') {
                return packet;
            }
            try {
                const component = JSON.parse(packet.message);
                const accented = applyBedwarsEventLabelAccent(component);
                return accented === component
                    ? packet
                    : { ...packet, message: JSON.stringify(accented) };
            } catch (error) {
                return packet;
            }
        }

        function scoreboardTeamModeId(mode) {
            const namedMode = typeof mode === 'string' ? SCOREBOARD_TEAM_MODES[mode] : undefined;
            return namedMode ?? Number(mode);
        }

        function rewriteBedwarsSidebarTeamColorsForClient(packet) {
            if (!bedwarsSidebarTeamColorsEnabled || !packet) return packet;

            const mode = scoreboardTeamModeId(packet.mode);
            const teamId = String(packet.team || '');
            if (!teamId) return packet;

            if (mode === 1) {
                sidebarTeamStatusById.delete(teamId);
                return packet;
            }

            if ((mode === 0 || mode === 2) && typeof packet.prefix === 'string') {
                const status = getBedwarsSidebarTeamStatus(packet.prefix, packet.suffix);
                if (status) sidebarTeamStatusById.set(teamId, status);
                else sidebarTeamStatusById.delete(teamId);
            }

            const status = sidebarTeamStatusById.get(teamId);
            if (!status) return packet;

            let rewritten = packet;
            if (mode === 0 || mode === 2) {
                const prefix = rewriteBedwarsSidebarTeamStatusLine(packet.prefix, packet.suffix);
                if (prefix !== packet.prefix) rewritten = { ...rewritten, prefix };
                const suffix = rewriteBedwarsSidebarTeamStatusSuffix(packet.suffix, status);
                if (suffix !== packet.suffix) rewritten = { ...rewritten, suffix };
            }

            return rewritten;
        }

        // Roster snapshot for the recap/encounter log: names currently tracked
        // for this game, with UUIDs resolved from the lookup cache only — this
        // runs on the game-end path and must never trigger an API call.
        // Real IGN behind a name (through a known denick) and its rank-coloured
        // display, from the live profile cache or the saved rank book. Never an
        // API call: `display` is null when neither knows the account. `nicked`
        // marks an undenicked nick, whose name must not be looked up as an IGN;
        // `stale` marks a rank book entry old enough to refresh.
        function resolveRankedPlayer(name) {
            const denicked = getAutoDenickResult(name)?.realName || findKnownDenickByNick(name)?.realName || null;
            const realName = denicked || name;
            const profile = globalCache.get(playerLookupKey(realName))?.data;
            if (profile?.player && !profile.isNicked && !profile.lookupFailed) {
                return { realName, display: rankedDisplayForPlayer(profile.player, realName), nicked: false, stale: false };
            }
            const nicked = !denicked && (Boolean(profile?.isNicked) || isKnownNickedPlayer(name, null));
            if (nicked) return { realName, display: null, nicked: true, stale: false };
            const saved = rankBook.get(realName);
            return { realName, display: saved?.display || null, nicked: false, stale: rankBook.isStale(realName) };
        }

        function buildSessionRosterSnapshot() {
            // Same resolution as the game's metadata.team: the own name alone
            // often resolves to nothing by game end, which left every player
            // 'unknown' and the teammates list empty.
            const ownTeam = currentGamemode === 'BEDWARS'
                ? (resolveOwnBedwarsTeam() || activeSessionGameMetadata?.team || null)
                : null;
            const names = new Set(gameRoster);
            if (currentGamemode === 'BEDWARS') currentGameTeams.forEach(entry => names.add(entry.name));
            return Array.from(names)
                .filter(name => isValidPlayerName(name) && !isOwnPlayerName(name))
                .map((name) => {
                    const team = currentGamemode === 'BEDWARS'
                        ? (resolveBedwarsTeamName(name) || currentGameTeams.get(nickKey(name))?.team || null)
                        : null;
                    const ranked = resolveRankedPlayer(name);
                    return {
                        name,
                        realName: ranked.realName,
                        display: ranked.display,
                        nicked: ranked.nicked,
                        uuid: globalCache.get(playerLookupKey(name))?.data?.player?.uuid || null,
                        team,
                        relation: ownTeam && team
                            ? (ownTeam.toLowerCase() === team.toLowerCase() ? 'teammate' : 'opponent')
                            : 'unknown'
                    };
                });
        }

        // Apply a preset and report it. Shared by /preset load and the
        // gamemode auto-bind so both paths behave identically.
        function loadPresetByName(client, name, { reason = 'command' } = {}) {
            const preset = presetStore.get(name);
            if (!preset) {
                sendChat(client, `§8[§bProfile§8] §cNo profile named §f${name}§c. §7/profile list`);
                return null;
            }
            const result = applyPresetSettings(preset.settings);
            if (!result.ok) {
                sendChat(client, `§8[§bProfile§8] §cCould not apply §f${preset.label}§c: §7${result.error || 'unknown error'}`);
                return null;
            }
            presetStore.setActive(preset.name, { source: reason });
            presetStore.flush();
            renderPresetApplied(client, preset, { ...result, reason });
            return preset;
        }

        function handlePresetCommand(client, args) {
            const sub = String(args[1] || '').toLowerCase();
            const name = args[2];

            if (!sub || sub === 'list') {
                renderPresetList(client, presetStore.listProfiles(), presetStore.getActive(), { commandRoot: '/profile' });
                return;
            }

            if (sub === 'save') {
                if (!name) return sendChat(client, '§8[§bProfile§8] §cUsage: §f/profile save <name>');
                const existing = presetStore.list().find(profile => profile.name === String(name || '').toLowerCase()) || null;
                const saved = presetStore.save(name, captureCurrentPresetSettings(), {
                    label: args.slice(3).join(' ') || existing?.label || null
                });
                if (!saved) {
                    sendChat(client, `§8[§bProfile§8] §cCould not save §f${name}§c — bad name, built-in name, or profile limit reached.`);
                    return;
                }
                presetStore.setActive(saved.name, { source: 'game_save' });
                presetStore.flush();
                sendChat(client, `§8[§bProfile§8] §a${existing ? 'Updated' : 'Saved'} §f${saved.label}§7 with §f${Object.keys(saved.settings).length}§7 settings.`);
                sendChat(client, `§8  Load it later with §f/profile load ${saved.name}`);
                return;
            }

            if (sub === 'load' || sub === 'apply') {
                if (!name) return sendChat(client, '§8[§bProfile§8] §cUsage: §f/profile load <name>');
                loadPresetByName(client, name);
                return;
            }

            if (sub === 'diff') {
                if (!name) return sendChat(client, '§8[§bProfile§8] §cUsage: §f/profile diff <name>');
                const preset = presetStore.get(name);
                if (!preset) return sendChat(client, `§8[§bProfile§8] §cNo profile named §f${name}§c.`);
                renderPresetDiff(client, preset, presetStore.diff(name, captureCurrentPresetSettings()) || [], { commandRoot: '/profile' });
                return;
            }

            if (sub === 'delete' || sub === 'remove') {
                if (!name) return sendChat(client, '§8[§bProfile§8] §cUsage: §f/profile delete <name>');
                const profile = presetStore.get(name);
                const removed = presetStore.remove(name);
                if (removed && profile?.readOnly) {
                    sendChat(client, `§8[§bProfile§8] §7Removed built-in profile §f${profile.label}§7 from this installation.`);
                    return;
                }
                sendChat(client, removed
                    ? `§8[§bProfile§8] §7Deleted §f${name}§7.`
                    : `§8[§bProfile§8] §cNo custom profile named §f${name}§c.`);
                return;
            }

            if (sub === 'bind') {
                const mode = normalizeGame(args[3]) || normalizeGame(args[2]);
                const target = normalizeGame(args[2]) ? null : name;
                if (!target || !mode) {
                    sendChat(client, '§8[§bProfile§8] §cUsage: §f/profile bind <name> <bw|sw|duels>');
                    return;
                }
                const bound = presetStore.bind(target, mode);
                sendChat(client, bound
                    ? `§8[§bProfile§8] §a${bound.label}§7 now auto-applies on §f${mode}§7.`
                    : `§8[§bProfile§8] §cNo profile named §f${target}§c.`);
                return;
            }

            if (sub === 'unbind') {
                if (!name) return sendChat(client, '§8[§bProfile§8] §cUsage: §f/profile unbind <name>');
                const unbound = presetStore.unbind(name);
                sendChat(client, unbound
                    ? `§8[§bProfile§8] §7${unbound.label} no longer auto-applies.`
                    : `§8[§bProfile§8] §cNo profile named §f${name}§c.`);
                return;
            }

            // Bare "/preset <name>" is a shortcut for loading it; anything
            // else falls through to the active-preset status card.
            if (presetStore.get(sub)) {
                loadPresetByName(client, sub);
                return;
            }

            const active = presetStore.get(presetStore.getActive());
            renderPresetStatus(client, active, active
                ? presetStore.diff(active.name, captureCurrentPresetSettings()) || []
                : [], { commandRoot: '/profile' });
        }

        // Gamemode auto-bind: applied on game start when a bound preset is not
        // already the active one.
        function applyBoundPresetForMode(mode) {
            const preset = presetStore.findByMode(mode);
            if (!preset || preset.name === presetStore.getActive()) return;
            loadPresetByName(client, preset.name, { reason: 'mode_bind' });
        }

        function sessionGamesPlayed() {
            return sessionTracker.getActiveSession()?.games?.length || 0;
        }

        const SESSION_FOCUS_BLOCK = { BEDWARS: 'Bedwars', SKYWARS: 'SkyWars', DUELS: 'Duels' };
        const SESSION_FOCUS_TOKEN = { BEDWARS: 'bw', SKYWARS: 'sw', DUELS: 'duels' };

        // "/session bw solo" / "/session sw solo_insane" / "/session duels bridge_1v1".
        // Returns null for the default all-games overall card. The Duels mode
        // list is derived from the session delta itself, so the nav only
        // offers modes you actually played this session.
        function buildSessionFocus(tokens, delta) {
            if (!delta || !tokens.length) return null;

            let game = null;
            const modeTokens = [];
            tokens.forEach((token) => {
                const matched = normalizeGame(token);
                if (matched && !game) {
                    game = matched;
                    return;
                }
                if (token) modeTokens.push(token);
            });
            if (!game && !modeTokens.length) return null;
            game = game || 'BEDWARS';

            const modeToken = modeTokens.join('_');
            if (game === 'DUELS') {
                const duelsDelta = delta.stats?.Duels || {};
                return {
                    game: 'Duels',
                    mode: findDuelsModeDef(modeToken, duelsDelta),
                    modes: visibleDuelsModeDefs(duelsDelta),
                    commandToken: SESSION_FOCUS_TOKEN.DUELS
                };
            }
            return {
                game: SESSION_FOCUS_BLOCK[game],
                mode: findModeDef(game, modeToken),
                modes: visibleModeDefs(game),
                commandToken: SESSION_FOCUS_TOKEN[game]
            };
        }

        async function handleLocalSessionCommand(client, args) {
            const sub = String(args[1] || '').toLowerCase();

            if (sub === 'on' || sub === 'off') {
                state.sessionTrackingEnabled = sub === 'on';
                saveFeatureConfig();
                sessionTracker.refreshSettings();
                sendChat(client, `§8[§bSession§8] §7Tracking §f${state.sessionTrackingEnabled ? '§aenabled' : '§cdisabled'}§7.`);
                return;
            }

            if (sub === 'recap') {
                // Explicit on/off is accepted; a bare /session recap toggles.
                const arg = String(args[2] || '').toLowerCase();
                state.gameRecapEnabled = arg === 'on' ? true
                    : arg === 'off' ? false
                    : !state.gameRecapEnabled;
                saveFeatureConfig();
                sendChat(client, `§8[§bSession§8] §7Post-game recap §f${state.gameRecapEnabled ? '§aon' : '§coff'}§7.`);
                return;
            }

            if (!state.sessionTrackingEnabled) {
                sendChat(client, '§8[§bSession§8] §7Tracking is off — enable it with §f/session on§7.');
                return;
            }

            if (sub === 'reset' || sub === 'start') {
                sendChat(client, '§8[§bSession§8] §7Starting a fresh session...');
                await sessionTracker.reset();
                sendChat(client, sessionTracker.getActiveSession()?.trackingSource === 'local'
                    ? '§8[§bSession§8] §aNew local session started. Counters begin with your next full game.'
                    : '§8[§bSession§8] §aNew session started from your current stats.');
                return;
            }

            if (sub === 'end' || sub === 'finish' || sub === 'stop') {
                if (!sessionTracker.getActiveSession()) {
                    sendChat(client, '§8[§bSession§8] §7There is no active session to end.');
                    return;
                }
                sendChat(client, '§8[§bSession§8] §7Saving the latest stats and ending this session...');
                const sessionId = await sessionTracker.finish();
                sendChat(client, sessionId
                    ? '§8[§bSession§8] §aSession ended.'
                    : '§8[§bSession§8] §cCould not end the current session.');
                return;
            }

            // Raw non-zero delta keys, per game. This is the tool for "why is
            // <game> showing up when I didn't play it" — it names the exact
            // keys that moved.
            if (sub === 'debug' || sub === 'keys') {
                const delta = sessionTracker.getSessionDelta();
                if (!delta) {
                    sendChat(client, '§8[§bSession§8] §7No active session to inspect.');
                    return;
                }
                sendChat(client, `§8[§bSession§8] §7Delta keys over §f${Math.round(delta.spanMs / 1000)}s§7:`);
                ['Bedwars', 'SkyWars', 'Duels'].forEach((game) => {
                    const keys = Object.keys(delta.stats?.[game] || {});
                    if (!keys.length) return;
                    sendChat(client, `§6${game} §8(${keys.length} keys)`);
                    keys.slice(0, 25).forEach((key) => {
                        sendChat(client, `§8  ${key}: §f${delta.stats[game][key]}`);
                    });
                    if (keys.length > 25) sendChat(client, `§8  …and ${keys.length - 25} more`);
                });
                if (delta.unmeasurable?.length) {
                    sendChat(client, `§e  Skipped (incomplete API reading): §f${delta.unmeasurable.join(', ')}`);
                }
                return;
            }

            // /session history            -> list of past sessions
            // /session history 3          -> full card for the 3rd newest
            // /session history 3 bw solo  -> that session, narrowed to a mode
            if (sub === 'history' || sub === 'past' || sub === 'log') {
                await sessionTracker.ensureSession();
                const entries = sessionTracker.getHistory();
                const position = Number(args[2]);

                if (!Number.isFinite(position)) {
                    renderSessionHistory(client, entries);
                    return;
                }
                const entry = entries[Math.max(1, Math.round(position)) - 1];
                if (!entry) {
                    sendChat(client, `§8[§bSession§8] §cNo session §f#${args[2]}§c. §7/session history`);
                    return;
                }
                renderLocalSession(client, entry.delta, {
                    name: client.username,
                    gamesPlayed: entry.session.games?.length || 0,
                    focus: buildSessionFocus(args.slice(3).filter(Boolean), entry.delta),
                    title: formatSessionStamp(entry.session.startedAt),
                    subtitle: entry.active ? '§8Current session' : null
                });
                return;
            }

            // `refresh` may be followed by a game/mode: /session refresh bw solo
            const force = sub === 'refresh';
            const focusTokens = (force ? args.slice(2) : args.slice(1)).filter(Boolean);

            if (force) sendChat(client, state.apiKillSwitchEnabled || !hasHypixelApiKeyConfigured()
                ? '§8[§bSession§8] §7Showing locally observed stats.'
                : '§8[§bSession§8] §7Refreshing from the Hypixel API...');
            const delta = await sessionTracker.refresh({ force, reason: 'command' })
                || sessionTracker.getSessionDelta();
            renderLocalSession(client, delta, {
                name: client.username,
                gamesPlayed: sessionGamesPlayed(),
                focus: buildSessionFocus(focusTokens, delta)
            });
        }

        function handleRecapCommand(client) {
            const uuid = normalizeUuid(client.uuid);
            const record = uuid ? sessionStore.getLastGame(uuid) : null;
            if (!record?.delta && record?.verificationStatus !== 'local') {
                sendChat(client, '§8[§bRecap§8] §7No finished game recorded yet this session.');
                return;
            }
            const delta = record.verificationStatus === 'local' ? {
                local: true, modes: record.localModes || [], spanMs: record.durationMs
            } : {
                stats: record.delta.stats || {},
                achievements: record.delta.achievements || {},
                spanMs: record.durationMs,
                root: { delta: { stats: record.delta.stats || {}, achievements: record.delta.achievements || {} } }
            };
            const shown = renderGameRecap(client, {
                record,
                delta,
                sessionDelta: sessionTracker.getSessionDelta(),
                mode: record.mode,
                game: gameForMode(record.mode)
            }, {
                style: state.sessionRecapStyle,
                fields: state.sessionRecapFields,
                goals: {
                    wins: state.sessionGoalWins,
                    finals: state.sessionGoalFinals,
                    games: state.sessionGoalGames,
                    minutes: state.sessionGoalMinutes
                }
            });
            if (!shown) sendChat(client, '§8[§bRecap§8] §7The last recorded game had nothing to show.');
        }

        // Nester Deck (/deck): experimental redesigned control panel. Reads
        // live state through closures and dispatches only allowlisted
        // commands back through the normal chat pipeline, so the classic
        // menus (/fury, per-feature controllers) are untouched.
        const { createControlDeck } = require('./src/overlay/controlDeck.js');
        const controlDeck = createControlDeck({
            send: (parts) => sendChat(client, parts),
            // Re-enter the proxy's own command handler, exactly as if the
            // user typed the command. Depth is 1 (deck actions can't chain).
            runCommand: (commandText) => client.emit('chat', { message: commandText }),
            registry: {
                session: () => ({
                    game: currentGamemode || null,
                    inGame: Boolean(gameActive),
                    overlayMode: state.scanMode || 'off'
                }),
                modules: () => [
                    {
                        key: 'dodge', tab: 'guard', label: 'Auto Dodge', short: 'dodge',
                        doc: ['Auto-leaves pregame lobbies with configured', 'tagged / nicked / stat-threat players.'],
                        isOn: () => autoDodgeEnabled,
                        hint: () => (autoDodgeEnabled ? `${autoDodgeDelaySeconds}s delay` : ''),
                        onCommand: '/dodge on', offCommand: '/dodge off', openCommand: '/dodge'
                    },
                    {
                        key: 'gambler', tab: 'guard', label: 'Auto Gambler', short: 'gambler',
                        doc: ['Auto-replies to the exact Hypixel', 'gambler chat prompt.'],
                        isOn: () => autoGamblerEnabled,
                        hint: () => {
                            const pending = autoGamblerSession?.timers?.size || 0;
                            return autoGamblerEnabled ? (pending > 0 ? `${pending} pending` : 'armed') : '';
                        },
                        onCommand: '/autogambler on', offCommand: '/autogambler off', openCommand: '/autogambler'
                    },
                    {
                        key: 'tabstats', tab: 'intel', label: 'Tab Stats', short: 'tab',
                        doc: ['Core stats next to names in the tab list', 'during active games.'],
                        isOn: () => tabStatsEnabled,
                        onCommand: '/tabstats on', offCommand: '/tabstats off', openCommand: '/tabstats'
                    },
                    {
                        key: 'nametags', tab: 'intel', label: 'Name Tags', short: 'tags',
                        doc: ['Nick / tag / threat labels above enemy', 'heads in BedWars.'],
                        isOn: () => nametagOverlayEnabled,
                        onCommand: '/nametags on', offCommand: '/nametags off', openCommand: '/nametags'
                    },
                    {
                        key: 'share', tab: 'intel', label: 'Auto Share', short: 'share',
                        doc: ['Broadcasts scan results (tagged / nicked /', 'threats) to party chat automatically.'],
                        isOn: () => shareTagsBroadcaster.getSettings().auto,
                        hint: () => {
                            const settings = shareTagsBroadcaster.getSettings();
                            if (!settings.auto) return '';
                            const included = ['tagged', 'nicks', 'threats'].filter(name => settings[name]);
                            return included.join('+') || 'nothing';
                        },
                        onCommand: '/share auto on', offCommand: '/share auto off', openCommand: '/sharetags'
                    },
                    {
                        key: 'chatstats', tab: 'intel', label: 'Chat Stats', short: 'chat',
                        doc: ['Stat lines for players who talk, mention', 'you, or DM you in lobbies.'],
                        isOn: () => lobbyChatStatsEnabled,
                        onCommand: '/chatstats on', offCommand: '/chatstats off', openCommand: '/chatstats'
                    }
                ],
                chipGroups: [
                    {
                        tab: 'intel', label: 'overlay mode',
                        chips: () => ['all', 'threats', 'off'].map(mode => ({
                            label: mode,
                            on: (state.scanMode || 'off') === mode,
                            color: 'light_purple',
                            title: `Overlay: ${mode}`,
                            doc: mode === 'all' ? 'Show every scanned player.'
                                : mode === 'threats' ? 'Only show stat threats and tags.'
                                : 'Disable the scan overlay.',
                            command: `/overlay ${mode}`
                        }))
                    },
                    {
                        tab: 'intel', label: 'share includes',
                        chips: () => {
                            const settings = shareTagsBroadcaster.getSettings();
                            return [
                                { key: 'tagged', label: 'tagged' },
                                { key: 'nicks', label: 'nicked' },
                                { key: 'threats', label: 'threats' }
                            ].map(entry => ({
                                label: entry.label,
                                on: Boolean(settings[entry.key]),
                                title: `Share ${entry.label} players`,
                                doc: 'Included categories are broadcast by /share.',
                                command: `/share include ${entry.key} ${settings[entry.key] ? 'off' : 'on'}`
                            }));
                        }
                    },
                ],
                actions: [
                    { label: 'scan now', command: '/scan', doc: 'Analyze every player in the current game.' },
                    { label: 'share', command: '/share', doc: 'Broadcast your latest scan to party chat.' },
                    { label: 'dodge cancel', command: '/cancel', doc: 'Cancel a pending auto-dodge.' }
                ],
                presets: [
                    {
                        key: 'tryhard', label: 'tryhard',
                        doc: 'Everything on: full intel and full guard.',
                        commands: ['/dodge on', '/tabstats on', '/nametags on', '/share auto on']
                    },
                    {
                        key: 'chill', label: 'chill',
                        doc: 'Casual games: guards off, keep tab stats.',
                        commands: ['/dodge off', '/share auto off', '/nametags off', '/tabstats on']
                    }
                ],
                lookups: [
                    { group: 'player cards', label: 'stats', command: '/stats ', suggest: true, doc: 'BedWars card with mode click-through.' },
                    { group: 'player cards', label: 'skywars', command: '/sw ', suggest: true, doc: 'SkyWars card.' },
                    { group: 'player cards', label: 'duels', command: '/duels ', suggest: true, doc: 'Duels overview.' },
                    { group: 'player cards', label: 'general', command: '/general ', suggest: true, doc: 'Level, rank, guild, account info.' },
                    { group: 'intel', label: 'info', command: '/info ', suggest: true, doc: 'Ping, tags, current Hypixel status.' },
                    { group: 'intel', label: 'ping', command: '/ping ', suggest: true, doc: 'Aurora ping history.' },
                    { group: 'intel', label: 'urchin', command: '/urchin ', suggest: true, doc: 'Urchin tag lookup.' },
                    { group: 'intel', label: 'seraph', command: '/seraph ', suggest: true, doc: 'Seraph blacklist lookup.' },
                    { group: 'me', label: 'my stats', command: `/stats ${client.username}`, doc: 'Your own BedWars card.' },
                    { group: 'me', label: 'my session', command: `/daily ${client.username}`, doc: 'Your session stats today.' }
                ]
            }
        });

        const { createPacketRecorder } = require('./src/recorder/packetRecorder.js');
        const packetRecorder = createPacketRecorder({
            dir: dataPath('recordings'),
            getUuidMappedName: (uuid) => getUuidMappedName(uuid),
            snapshotEntities: () => {
                const rows = [];
                entityTracker.forEachEntity((entry, entityId) => {
                    rows.push({
                        entityId,
                        name: entry?.name || '',
                        x: entry?.x,
                        y: entry?.y,
                        z: entry?.z
                    });
                });
                return rows;
            },
            log: (line) => console.log(line)
        });

        // /menudebug: inventory-GUI packet monitor and driver. Tracks the
        // window Hypixel has open, reports every menu packet both ways, and can
        // synthesise clicks. Off by default; window tracking is always on so
        // /menudebug dump works the moment you enable it.
        // Recent Games (/replay) menu: append each game's tracked Victory/Defeat
        // (plus BedWars K/F/B, teammates and /clip moments) to its lore. Display-only; menuMonitor still sees Hypixel's items.
        const replayResults = require('./src/menu/replayResults.js').createReplayResultAnnotator({
            getGames: () => sessionStore.getSessions().flatMap(session => session.games || []),
            getClipGames: () => clipStore.listGames(),
            resolvePlayer: resolveRankedPlayer,
            onMissingPlayers: names => lookupReplayTeammateRanks(names),
            isEnabled: () => state.replayDetailsEnabled !== false,
            getSelfName: () => client.username
        });
        // Teammates the /replay menu showed without a rank: look them up in the
        // background (each name at most once per ten minutes), then redraw the
        // menu if it is still open. The lookups fill the rank book, so later
        // opens need no API call.
        const replayRankAttempts = new Map();
        const REPLAY_RANK_RETRY_MS = 10 * 60000;
        const REPLAY_RANK_BATCH = 12;
        function lookupReplayTeammateRanks(names) {
            if (state.apiKillSwitchEnabled || !hasHypixelApiKeyConfigured()) return;
            const now = Date.now();
            const batch = (names || [])
                .filter(name => isValidPlayerName(name))
                .filter(name => now - (replayRankAttempts.get(name.toLowerCase()) || 0) > REPLAY_RANK_RETRY_MS)
                .slice(0, REPLAY_RANK_BATCH);
            if (!batch.length) return;
            batch.forEach(name => replayRankAttempts.set(name.toLowerCase(), now));
            const windowId = menuMonitor.getWindow()?.windowId;
            Promise.allSettled(batch.map(name => getPlayerData(name, { apiPriority: 'background' })))
                .then((results) => {
                    if (!results.some(result => result.value?.data?.player)) return;
                    replayResults.invalidate();
                    const open = menuMonitor.getWindow();
                    if (!open || open.windowId !== windowId || !open.rawSlots) return;
                    open.rawSlots.forEach((raw, slot) => {
                        const item = replayResults.annotate(raw);
                        if (item) client.write('set_slot', { windowId: open.windowId, slot, item });
                    });
                })
                .catch(() => {});
        }
        const { createMenuMonitor } = require('./src/menu/menuMonitor.js');
        const menuMonitor = createMenuMonitor({
            sendChat: (message) => sendChat(client, message),
            sendUpstream: (name, data) => {
                if (hypixelClient.state !== mc.states.PLAY) return;
                try { hypixelClient.write(name, data); } catch (error) { /* connection went away */ }
            },
            dir: dataPath('packet_logs', 'menu'),
            log: (...parts) => console.log(...parts)
        });

        const { createQuickBuyTrace } = require('./src/menu/quickBuyTrace');
        const quickBuyTrace = createQuickBuyTrace({
            dir: dataPath('packet_logs', 'quickbuy_trace'),
            sendChat: message => sendChat(client, message)
        });
        const { createBookTrace } = require('./src/menu/bookTrace');
        const bookTrace = createBookTrace({
            dir: dataPath('packet_logs', 'book_trace'),
            sendChat: message => sendChat(client, message)
        });
        const rawQuickBuyTransport = hypixelClient.write.bind(hypixelClient);
        let layoutPreview = null;
        const quickBuyTransport = (name, data, origin = 'quickbuy-automation') => {
            if (layoutPreview && !layoutPreview.allowOutbound(name, data)) return;
            const result = rawQuickBuyTransport(name, data);
            quickBuyTrace.observe('upstream', name, data, origin);
            bookTrace.observe('upstream', name, data, origin);
            return result;
        };
        const { createQuickBuy } = require('./src/menu/quickBuy');
        const { createQuickBuyPlayerLookup } = require('./src/menu/quickBuyImport');
        const lookupLayoutPlayer = createQuickBuyPlayerLookup({ globalCache, cacheDuration: CACHE_DURATION,
            getPlayerData: (name, options) => getPlayerData(name, options) });
        const quickBuy = createQuickBuy({
            fetchPlayer: lookupLayoutPlayer,
            sendUpstream: (name, data) => {
                if (hypixelClient.state !== mc.states.PLAY) throw new Error('Server connection is not ready');
                quickBuyTransport(name, data);
                if (name === 'close_window') {
                    menuMonitor.setHold(false);
                    menuMonitor.observeClientPacket(data, { name });
                }
            },
            sendClient: (name, data) => client.write(name, data),
            sendChat: message => sendChat(client, message),
            disconnect: reason => { client.end(reason); hypixelClient.end(reason); },
            canStart: () => {
                if (layoutPreview?.isBusy()) return 'Close the layout preview first';
                if (gameActive || bedwarsPregameActive || currentGamemode !== 'BEDWARS') {
                    return 'Quick Buy editing is available only in a Bed Wars lobby';
                }
                if (menuMonitor.getWindow() || menuMonitor.getDebugState().menuNavStep !== 'idle') {
                    return 'Close the current menu and stop menu navigation first';
                }
                return null;
            },
            presetDir: dataPath('quickbuy_presets')
        });
        const killMessageLogger = require('./src/menu/killMessageLogger').createKillMessageLogger({
            automation: quickBuy,
            dir: dataPath('packet_logs', 'kill_messages'),
            sendChat: message => sendChat(client, message),
            account: () => ({ uuid: client.uuid, username: client.username })
        });
        layoutPreview = require('./src/menu/quickBuyPreview').createQuickBuyPreview({
            fetchPlayer: lookupLayoutPlayer,
            sendClient: (name, data) => client.write(name, data),
            sendChat: message => sendChat(client, message),
            disconnect: reason => { client.end(reason); hypixelClient.end(reason); },
            canStart: () => {
                if (quickBuy.isBusy()) return 'Wait for layout editing to finish.';
                if (hypixelClient.state !== mc.states.PLAY || client.state !== mc.states.PLAY) return 'Wait for the server connection to be ready.';
                if (menuMonitor.getWindow() || menuMonitor.getDebugState().menuNavStep !== 'idle') return 'Close your current menu first.';
                return null;
            }
        });
        hypixelClient.write = (name, data) => {
            if (quickBuy.allowOutbound(name, data)) return quickBuyTransport(name, data, 'relay-or-proxy-feature');
        };

        function isAutoDenickTrackablePlayer(name) {
            return isAutoDenickEligibleActor(name) && isDetectedNickedPlayer(name);
        }

        // Who is allowed to /nick. MVP++ is the rank people think of, but
        // Hypixel grants the same perk to YouTube and staff ranks, so gating
        // on MVP++ alone silently excluded those players from every nick
        // candidate pool - their nick could never be attributed to them.
        function isNickCapableProfileData(profileData = {}) {
            const player = profileData.player || profileData;
            return resolveHypixelRank(player || {}).canNick;
        }

        function rememberNickCapablePlayer(name, source = 'unknown', rankId = '') {
            if (!isValidPlayerName(name) || isOwnPlayerName(name)) return false;
            nickCapablePlayers.set(nickKey(name), {
                name,
                source,
                rankId: rankId || '',
                at: Date.now()
            });
            return true;
        }

        function displayLooksNickCapableText(value) {
            return displayLooksNickCapable(componentTextToPlain(value));
        }

        function isNickCapablePlayer(name) {
            if (!isValidPlayerName(name)) return false;
            const key = nickKey(name);
            const entry = nickCapablePlayers.get(key);
            if (entry && Date.now() - (entry.at || 0) <= PLAYER_SNAPSHOT_TTL) return true;
            const info = lobbyPlayers.get(name);
            if (!info) return false;
            const rankId = [info.originalDisplayName, info.displayName]
                .map(value => hypixelRankIdFromText(componentTextToPlain(value), { requireBrackets: true }))
                .find(isNickCapableRankId);
            if (!rankId) return false;
            rememberNickCapablePlayer(name, 'display', rankId);
            return true;
        }

        function getConfirmedPartyMemberNames() {
            const snapshot = partyTracker.getStatusSnapshot();
            if (!snapshot.initialized || snapshot.uncertain || !snapshot.inParty) return null;

            const seen = new Set();
            return [snapshot.leader, ...(snapshot.moderators || []), ...(snapshot.members || [])]
                .filter(name => isValidPlayerName(name) && !isOwnPlayerName(name))
                .filter((name) => {
                    const key = nickKey(name);
                    if (!key || seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
        }

        // /po is deliberately a manual, client-only lookup. It never calls
        // sendHypixelCommand(), /pc, /ac, or /chat; every line below is written
        // directly to this client's chat packet via sendChat(client, ...).
        function partyOverviewStats(data = {}, monthlySession = {}) {
            const player = data.player || {};
            const bedwars = player.stats?.Bedwars || player.stats?.BedWars || {};
            const stars = Number(player.achievements?.bedwars_level);
            const finalKills = Number(bedwars.final_kills_bedwars);
            const finalDeaths = Number(bedwars.final_deaths_bedwars);
            const wins = Number(bedwars.wins_bedwars);
            const losses = Number(bedwars.losses_bedwars);
            const formatRatio = (numerator, denominator) => {
                if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return '?';
                if (denominator <= 0) return numerator > 0 ? '∞' : '0.00';
                return (numerator / denominator).toFixed(2);
            };
            const pingValue = Number(data.ping?.avgPing ?? data.ping?.ping);
            const monthly = compactNametagSession(monthlySession);
            return {
                stars: Number.isFinite(stars) ? Math.max(0, Math.round(stars)) : null,
                fkdr: formatRatio(finalKills, finalDeaths),
                wlr: formatRatio(wins, losses),
                monthlyFkdr: Number.isFinite(monthly.fkdr) ? monthly.fkdr.toFixed(2) : null,
                monthlyWlr: Number.isFinite(monthly.wlr) ? monthly.wlr.toFixed(2) : null,
                ping: Number.isFinite(pingValue) && pingValue >= 0 ? Math.round(pingValue) : null
            };
        }

        function partyOverviewRatioColor(value, colorFor) {
            const number = Number(value);
            if (Number.isFinite(number)) return colorFor(number);
            return value === '∞' ? '§4' : '§7';
        }

        function partyOverviewTagColor(tag = {}) {
            return String(tag.source || '').toLowerCase() === 'seraph'
                ? 'dark_aqua'
                : 'light_purple';
        }

        function partyOverviewTagHover(tag = {}) {
            const kind = tag.kind === 'caution'
                ? 'Caution — this is not a cheating verdict'
                : (tag.kind === 'service_notice' ? 'Tag-service notice — not a player report' : 'Provider report');
            return [
                `§8§l${tag.source || 'Tag'} §7${kind}`,
                `§7Tag: §f${partyOverviewTagText(tag.value || 'Unknown')}`,
                `§7Added by: §f${tag.addedBy || 'Unknown'}`,
                `§7When: §f${tag.when || 'Unknown'}`,
                `§7Exact reason: §e${stripNametagIconGlyphs(tag.exactReason || 'No reason was provided.')}`
            ].join('\n');
        }

        function partyOverviewTagText(value = '') {
            return stripNametagIconGlyphs(stripAnsi(formatNametagTagValue(value, { tagDisplayMode: 'full' }))) || 'Unknown';
        }

        function sendPartyOverviewResult(result) {
            const data = result.profile?.data || {};
            const player = data.player || {};
            const stats = partyOverviewStats(data, result.monthlySession);
            const verdict = result.verdict || classifyPartyOverview(result.profile);
            const hasStats = !data.lookupFailed && !data.isNicked && !result.profile?.error;
            const identityPrefix = hasStats
                ? `${formatBedwarsPrestige(stats.stars ?? 0)} `
                : data.isNicked ? '§c[NICKED] ' : '§6[UNAVAILABLE] ';
            sendChat(client, { text: '', extra: [
                { text: identityPrefix },
                {
                    text: `${getOverlayRankNameColor(player)}${player.displayname || result.name || 'Unknown'}`,
                    bold: true
                },
                { text: hasStats && stats.ping !== null ? ` §8· ${getPingColor(stats.ping)}${stats.ping}ms` : '', bold: false }
            ] });

            if (hasStats) {
                sendChat(client, `  §eOverall   §fFKDR ${partyOverviewRatioColor(stats.fkdr, getFkdrColor)}${stats.fkdr}`
                    + `   §fWLR ${partyOverviewRatioColor(stats.wlr, getWlrColor)}${stats.wlr}`);
                const monthly = [
                    ...(stats.monthlyFkdr === null ? [] : [`§fFKDR ${getFkdrColor(Number(stats.monthlyFkdr))}${stats.monthlyFkdr}`]),
                    ...(stats.monthlyWlr === null ? [] : [`§fWLR ${getWlrColor(Number(stats.monthlyWlr))}${stats.monthlyWlr}`])
                ];
                if (monthly.length) sendChat(client, `  §7Monthly   ${monthly.join('   ')}`);
            }

            const tagRow = [{ text: '  ' }];
            (verdict.tags || []).forEach((tag, index) => {
                const tagLabel = `${tag.source || 'Tag'}: ${partyOverviewTagText(tag.value || 'Unknown')}`;
                if (index) tagRow.push({ text: '  ' });
                tagRow.push(
                    {
                        text: `[${tagLabel}]`,
                        color: partyOverviewTagColor(tag),
                        bold: false,
                        hoverEvent: { action: 'show_text', value: partyOverviewTagHover(tag) }
                    }
                );
            });
            if (tagRow.length > 1) sendChat(client, { text: '', extra: tagRow });

            if (verdict.state === 'nicked' || verdict.state === 'unknown') {
                sendChat(client, `  §7${verdict.reason || 'No reliable result was available.'}`);
            }
        }

        // Uses the same renderer as a real /po result, but the profiles below
        // are entirely in-memory preview data. This deliberately makes no
        // party, player-stat, or provider request.
        function partyOverviewPreviewProfile(overrides = {}) {
            return {
                data: {
                    player: {
                        achievements: { bedwars_level: 250 },
                        stats: {
                            Bedwars: {
                                final_kills_bedwars: 1200,
                                final_deaths_bedwars: 300,
                                wins_bedwars: 160,
                                losses_bedwars: 80
                            }
                        }
                    },
                    ping: { avgPing: 46 },
                    urchin: { ok: true, rawTags: [] },
                    seraph: { tagged: false },
                    ...overrides
                }
            };
        }

        function partyOverviewPreviewScenarios() {
            const scenarios = {
                clear: {
                    label: 'a player with no known reports',
                    results: [{
                        name: 'PreviewClear',
                        profile: partyOverviewPreviewProfile({
                            player: {
                                achievements: { bedwars_level: 183 },
                                stats: { Bedwars: { final_kills_bedwars: 782, final_deaths_bedwars: 201, wins_bedwars: 111, losses_bedwars: 76 } }
                            },
                            ping: { avgPing: 42 }
                        })
                    }]
                },
                report: {
                    label: 'provider reports, including a second provider tag',
                    results: [{
                        name: 'PreviewReport',
                        profile: partyOverviewPreviewProfile({
                            urchin: {
                                ok: true,
                                rawTags: [{ tooltip: 'Cheating (Added by PreviewMod 2026-08-11) - Reach and velocity evidence' }]
                            },
                            seraph: {
                                tagged: true,
                                report_type: 'Velocity',
                                tooltip: 'Velocity: Consistent abnormal knockback (2026-08-11 by PreviewAuditor)'
                            }
                        })
                    }]
                },
                caution: {
                    label: 'a caution tag with its full reason shown in chat',
                    results: [{
                        name: 'PreviewCaution',
                        profile: partyOverviewPreviewProfile({
                            urchin: {
                                ok: true,
                                rawTags: [{ tooltip: 'Caution (Added by PreviewMod 2026-08-10) THIS TAG DOES NOT MEAN THE PLAYER IS CHEATING! - Replay shows unusual bridge timing' }]
                            }
                        })
                    }]
                },
                notice: {
                    label: 'a tag-service notice, not a player report',
                    results: [{
                        name: 'PreviewNotice',
                        profile: partyOverviewPreviewProfile({
                            urchin: {
                                ok: true,
                                rawTags: [{ tooltip: 'Caution (Added by Unknown 2026-07-22) - Notice for the developer of this service: the Urchin API is deprecated and shuts down on July 31. Blacklist tags are no longer being updated. Migrate to the new API - docs: https://api.urchin.gg' }]
                            }
                        })
                    }]
                },
                unavailable: {
                    label: 'a temporarily unavailable tag lookup',
                    results: [{
                        name: 'PreviewUnavailable',
                        profile: partyOverviewPreviewProfile({
                            urchin: { ok: false, requestStatus: 'rate_limited', error: 'Preview: Urchin API is rate limited.' }
                        })
                    }]
                },
                lookup: {
                    label: 'a failed player lookup',
                    results: [{
                        name: 'PreviewLookup',
                        profile: partyOverviewPreviewProfile({
                            lookupFailed: true,
                            lookupErrorMessage: 'Preview: player lookup timed out.'
                        })
                    }]
                }
            };
            scenarios.all = {
                label: 'every Party Overview result style',
                results: Object.values(scenarios).flatMap(scenario => scenario.results)
            };
            return scenarios;
        }

        function sendPartyOverviewResults(results = []) {
            const rule = '§6§m----------------------------------------';
            sendChat(client, '§r ');
            sendChat(client, rule);
            sendChat(client, '§6§lFURY §8/ §6§lPARTY OVERVIEW');
            sendChat(client, `§7${results.length} member${results.length === 1 ? '' : 's'} §8· §7Only visible to you`);
            results.forEach(result => {
                sendChat(client, '§r ');
                sendPartyOverviewResult(result);
            });
            sendChat(client, '§r ');
            sendChat(client, rule);
            if (results.some(result => (result.verdict || classifyPartyOverview(result.profile)).tags?.length)) {
                sendChat(client, '§8Hover a tag for its source, date and reason.');
            }
            sendChat(client, '§r ');
        }

        function runPartyOverviewPreview(scenarioKey = 'all') {
            const scenarios = partyOverviewPreviewScenarios();
            const key = String(scenarioKey || 'all').trim().toLowerCase();
            const scenario = scenarios[key];
            if (!scenario) {
                sendChat(client, '\u00a78[\u00a75\u00a7lParty Overview\u00a78] \u00a77Usage: \u00a7f/po test [all|clear|report|caution|notice|unavailable|lookup]');
                return;
            }
            sendChat(client, `\u00a78[\u00a75\u00a7lParty Overview\u00a78] \u00a7dPreview only: \u00a77showing ${scenario.label}.`);
            sendPartyOverviewResults(scenario.results);
            sendChat(client, '\u00a78[\u00a75\u00a7lParty Overview\u00a78] \u00a78Preview only: no party roster, player-stat, or tag-provider request was made.');
        }

        async function runPartyOverview() {

            const snapshot = partyTracker.getStatusSnapshot();
            if (!snapshot.initialized || snapshot.uncertain) {
                sendChat(client, '§8[§5§lParty Overview§8] §eYour party roster is syncing. §7Wait a moment, then run §f/po §7again.');
                return;
            }
            if (!snapshot.inParty) {
                sendChat(client, '§8[§5§lParty Overview§8] §7You are not currently in a party.');
                return;
            }

            const names = getConfirmedPartyMemberNames() || [];
            if (names.length > 0) sendChat(client, '§r ');
            if (names.length === 0) {
                sendChat(client, '§8[§5§lParty Overview§8] §7No other party members to check.');
                return;
            }

            sendChat(client, `§8[§5§lParty Overview§8] §7Checking §f${names.length} §7party member${names.length === 1 ? '' : 's'} locally…`);
            let urchinBatch = new Map();
            try {
                urchinBatch = await getUrchinBatchRaw(names);
            } catch (error) {
                // The normal profile lookup still returns a clear, explicit
                // unknown result if Urchin cannot be reached. Do not abort the
                // entire overview because a single provider is unavailable.
            }

            const results = await Promise.all(names.map(async (name) => {
                try {
                    const [profile, monthlySession] = await Promise.all([
                        getPlayerDataWithNickDetection(name, {
                            preferCache: true,
                            urchinOverride: urchinBatch.get(playerLookupKey(name)) || null,
                            apiPriority: 'background'
                        }),
                        fetchUrchinSession(name, 'monthly').catch(() => ({}))
                    ]);
                    return { name, profile, monthlySession, verdict: classifyPartyOverview(profile) };
                } catch (error) {
                    const profile = {
                        data: {
                            lookupFailed: true,
                            lookupErrorMessage: error?.message || 'Player lookup failed.'
                        }
                    };
                    return { name, profile, verdict: classifyPartyOverview(profile) };
                }
            }));

            sendPartyOverviewResults(results);
        }

        function renderPartyOverviewController() {
            const snapshot = partyTracker.getStatusSnapshot();
            const memberCount = getConfirmedPartyMemberNames()?.length || 0;
            const rosterState = !snapshot.initialized || snapshot.uncertain
                ? 'syncing'
                : snapshot.inParty
                    ? `${memberCount} other member${memberCount === 1 ? '' : 's'}`
                    : 'not in a party';
            const panel = createFeatureStatus({
                client, sendChat, title: 'Party Overview', subtitle: 'LOCAL CHECK',
                section: 'safety', helpTopic: 'partyoverview'
            });

            panel.open();
            panel.section('Overview');
            panel.valueRow('Availability', 'always enabled', { color: panel.colors.active });
            panel.valueRow('Roster', rosterState, {
                color: snapshot.inParty && !snapshot.uncertain ? panel.colors.value : panel.colors.quiet
            });
            panel.section('Privacy');
            panel.valueRow('Results', 'only visible to you', { color: panel.colors.active });
            panel.row([chatController.component('No report is sent to party or public chat.', panel.colors.muted)]);
            panel.section('Actions');
            panel.row([
                ...panel.action('Check party', '/po', 'Run a local check for current party members.'),
                chatController.text(' ', panel.colors.quiet),
                ...panel.action('Preview styles', '/po test all', 'Preview every possible result without API requests.')
            ]);
            panel.close();
        }

        async function handlePartyOverviewCommand(args) {
            const sub = String(args[1] || '').toLowerCase();
            if (!sub) return runPartyOverview();
            if (sub === 'test' || sub === 'preview') {
                return runPartyOverviewPreview(args[2] || 'all');
            }
            if (sub === 'on' || sub === 'off' || sub === 'toggle') {
                sendChat(client, '\u00a77Party Overview is always enabled. Use \u00a7f/po \u00a77to check your party.');
                renderPartyOverviewController();
                return;
            }
            if (sub === 'status' || sub === 'info') {
                renderPartyOverviewController();
                return;
            }
            sendChat(client, '§8[§5§lParty Overview§8] §7Usage: §f/po §7or §f/po status|test');
        }

        // True when this exact IGN is currently listed in tab. Case-insensitive
        // because the party roster comes from /p list while tab entries come
        // from the player-info packets, and only one of the two is guaranteed
        // to carry Hypixel's own casing.
        function isPartyMemberVisibleInTab(realName) {
            if (!isValidPlayerName(realName)) return false;
            const key = nickKey(realName);
            for (const [name, info] of lobbyPlayers) {
                if (nickKey(name) !== key) continue;
                if (info?.inTab !== false) return true;
            }
            return false;
        }

        async function isConfirmedNickCapablePartyMember(name) {
            if (isNickCapablePlayer(name)) return true;
            const profile = await getPlayerData(name, {
                includeErrors: true,
                preferCache: true,
                apiPriority: 'game'
            });
            if (profile?.error || !profile?.data?.player || !isNickCapableProfileData(profile.data)) return false;
            rememberNickCapablePlayer(name, 'party_denick', resolveHypixelRank(profile.data.player).id);
            return true;
        }

        // legacyColorCodeToName spells colours the way the launcher's CSS
        // classes do ("dark-green", "pink"). Minecraft's chat JSON wants
        // "dark_green" and "light_purple" and silently renders anything else
        // as plain white, so chat components need this spelling instead.
        function legacyColorCodeToChatColor(code) {
            const key = String(code || '').replace(/§/g, '').trim().toLowerCase();
            return LEGACY_COLOR_NAMES[key] || 'gray';
        }

        function partyDenickRealNameColor(realName) {
            const cachedPlayer = globalCache.get(nickKey(realName))?.data?.player;
            if (cachedPlayer) return legacyColorCodeToChatColor(getOverlayRankNameColor(cachedPlayer));

            // No cached profile: reuse the colour Hypixel itself rendered the
            // name in inside tab. That covers every rank without a lookup,
            // including an MVP++ who picked the aqua monthly colour - whose
            // rank text alone would wrongly read as gold.
            const tabPlayer = lobbyPlayers.get(realName) || {};
            const tabColor = extractDisplayColor(tabPlayer.originalDisplayName, realName)
                || extractDisplayColor(tabPlayer.displayName, realName);
            if (tabColor) return legacyColorCodeToChatColor(tabColor);
            return isNickCapablePlayer(realName) ? 'gold' : 'gray';
        }

        function createPartyDenickVariationMessages(variation, index, command, hoverText) {
            const clickEvent = { action: 'run_command', value: command };
            const hoverEvent = { action: 'show_text', value: hoverText };
            const clickable = (text, color, bold = false) => ({ text, color, bold, clickEvent, hoverEvent });
            return [
                {
                    text: '',
                    extra: [
                        clickable('Variation', 'dark_purple'),
                        clickable(' #', 'gray'),
                        clickable(String(index + 1), 'light_purple')
                    ]
                },
                ...variation.map(entry => ({
                    text: '',
                    extra: [
                        clickable(entry.nick, 'white'),
                        clickable(' → ', 'gray'),
                        clickable(entry.realName, partyDenickRealNameColor(entry.realName))
                    ]
                }))
            ];
        }

        function sendPartyDenickReview(review) {
            const proposals = review.proposals || [];
            const unresolved = review.unresolved || [];
            const variations = review.variations || [];
            sendChat(client, '§r ');

            proposals.forEach((entry) => {
                sendChat(client, {
                    text: '',
                    extra: [
                        { text: '§8• ' },
                        { text: entry.nick, color: 'white', bold: false },
                        { text: ' §8→ ' },
                        { text: entry.realName, color: partyDenickRealNameColor(entry.realName), bold: false },
                        {
                            text: ' §a[Save]',
                            color: 'green',
                            bold: true,
                            clickEvent: { action: 'run_command', value: `/denick party confirm ${entry.nick}` },
                            hoverEvent: { action: 'show_text', value: `Save ${entry.nick} -> ${entry.realName} to your denick list.` }
                        }
                    ]
                });
            });

            if (proposals.length) {
                sendChat(client, {
                    text: '',
                    extra: [
                        {
                            text: '§a§l[Save All Confirmed]',
                            color: 'green',
                            bold: true,
                            clickEvent: { action: 'run_command', value: '/denick party confirm' },
                            hoverEvent: { action: 'show_text', value: 'Save every confirmed party nick shown above.' }
                        },
                        { text: ' §8| ' },
                        {
                            text: '§c[Cancel]',
                            color: 'red',
                            clickEvent: { action: 'run_command', value: '/denick party cancel' },
                            hoverEvent: { action: 'show_text', value: 'Discard this review without saving any mappings.' }
                        }
                    ]
                });
            }
            if (variations.length) {
                // One variation means the roster left exactly one way to
                // assign the nicks - forced, but only as sound as the roster
                // it was derived from, so say that rather than letting a lone
                // "Variation #1" read like a verified match.
                if (variations.length === 1) {
                    sendChat(client, '§b§lParty Denick §8» §eOnly one assignment fits your party roster. §7It is not skin-verified - check it before saving.');
                } else {
                    sendChat(client, `§b§lParty Denick §8» §e${variations.length} possible assignments. §7Only one is correct; pick the one you recognize.`);
                }
                variations.forEach((variation, index) => {
                    const label = `Variation #${index + 1}`;
                    createPartyDenickVariationMessages(
                        variation,
                        index,
                        `/denick party choose ${index + 1}`,
                        `Click to save ${label}. Only choose it if you recognize the correct nick assignment.`
                    ).forEach(message => sendChat(client, message));
                    if (index < variations.length - 1) sendChat(client, '');
                });
            }
            // Unresolved nicks used to be dropped whenever variations were
            // shown, so a review that produced both silently hid the nicks it
            // could not place at all.
            if (unresolved.length) sendChat(client, `§b§lParty Denick §8» §eNot saved: §7${unresolved.join('§8, §7')}`);
            sendChat(client, '§r ');
        }

        function partyDenickPermutations(values) {
            if (values.length <= 1) return [values.slice()];
            return values.flatMap((value, index) => partyDenickPermutations([
                ...values.slice(0, index),
                ...values.slice(index + 1)
            ]).map(tail => [value, ...tail]));
        }

        const PARTY_DENICK_TEST_SCENARIOS = {
            one: {
                label: '1 Nick',
                realNames: ['FuryMateA'],
                nicks: ['HiddenOne']
            },
            two: {
                label: '2 Nicks',
                realNames: ['FuryMateA', 'FuryMateB'],
                nicks: ['HiddenOne', 'HiddenTwo']
            },
            three: {
                label: '3 Nicks',
                realNames: ['FuryMateA', 'FuryMateB', 'FuryMateC'],
                nicks: ['HiddenOne', 'HiddenTwo', 'HiddenThree']
            },
            mismatch: {
                label: 'No Match',
                realNames: ['FuryMateA', 'FuryMateB', 'FuryMateC'],
                nicks: ['HiddenOne', 'HiddenTwo']
            }
        };

        function normalizePartyDenickTestScenario(value) {
            const scenario = String(value || '').toLowerCase();
            if (['1', 'one', 'single'].includes(scenario)) return 'one';
            if (['2', 'two', 'double'].includes(scenario)) return 'two';
            if (['3', 'three', 'triple'].includes(scenario)) return 'three';
            if (['mismatch', 'none', 'nomatch'].includes(scenario)) return 'mismatch';
            return null;
        }

        function sendPartyDenickTestMenu() {
            sendChat(client, '§b§lParty Denick Test §8» §7Choose a fake scenario. §cNothing here can save to your denick list.');
            sendChat(client, {
                text: '',
                extra: Object.entries(PARTY_DENICK_TEST_SCENARIOS).flatMap(([key, scenario], index) => [
                    ...(index ? [{ text: ' §8| ' }] : []),
                    {
                        text: `§a[${scenario.label}]`,
                        color: 'green',
                        bold: true,
                        clickEvent: { action: 'run_command', value: `/denick party test ${key}` },
                        hoverEvent: { action: 'show_text', value: `Preview the ${scenario.label.toLowerCase()} party-denick scenario with fake names.` }
                    }
                ])
            });
        }

        function sendPartyDenickTestScenario(scenarioKey) {
            const scenario = PARTY_DENICK_TEST_SCENARIOS[scenarioKey];
            if (!scenario) {
                sendPartyDenickTestMenu();
                return;
            }
            sendChat(client, '§r ');
            if (scenario.realNames.length !== scenario.nicks.length) {
                sendChat(client, `§b§lParty Denick Test §8» §e${scenario.nicks.length} nicked teammate${scenario.nicks.length === 1 ? '' : 's'} but §f${scenario.realNames.length} §eparty members who can /nick were found.`);
                sendChat(client, '§b§lParty Denick Test §8» §7No variations are shown until those counts match exactly. No mappings were saved.');
                sendChat(client, '§r ');
                return;
            }

            const variations = partyDenickPermutations(scenario.realNames);
            sendChat(client, `§b§lParty Denick Test §8» §7Fake ${scenario.label.toLowerCase()} preview — §cno mappings will be saved.`);
            variations.forEach((realNames, index) => {
                const entries = scenario.nicks.map((nick, nickIndex) => ({ nick, realName: realNames[nickIndex] }));
                createPartyDenickVariationMessages(
                    entries,
                    index,
                    `/denick party test choose ${scenarioKey} ${index + 1}`,
                    'Click to test this variation. It never saves fake mappings.'
                ).forEach(message => sendChat(client, message));
                if (index < variations.length - 1) sendChat(client, '');
            });
            sendChat(client, '§r ');
        }

        function confirmPartyDenickTestScenario(scenarioKey, indexValue) {
            const scenario = PARTY_DENICK_TEST_SCENARIOS[scenarioKey];
            const index = Number.parseInt(indexValue, 10) - 1;
            const variationCount = scenario && scenario.realNames.length === scenario.nicks.length
                ? partyDenickPermutations(scenario.realNames).length
                : 0;
            if (!Number.isInteger(index) || index < 0 || index >= variationCount) {
                sendChat(client, '§b§lParty Denick Test §8» §cThat fake variation does not exist. Run §f/denick party test §cto see the menu again.');
                return;
            }
            sendChat(client, `§b§lParty Denick Test §8» §aTested Variation #${index + 1}. §7No mappings were saved.`);
        }

        function activePartyDenickReview() {
            const review = partyDenickReview;
            const expired = !review
                || review.gameSessionId !== gameSessionId
                || Date.now() - review.at > PARTY_DENICK_REVIEW_TTL_MS;
            if (expired) partyDenickReview = null;
            return expired ? null : review;
        }

        async function buildPartyDenickReview() {
            const automatic = Boolean(arguments[0]?.automatic);
            if (!gameActive || currentGamemode !== 'BEDWARS') {
                if (!automatic) sendChat(client, '§b§lParty Denick §8» §cRun this after a BedWars game has started.');
                return { retry: false, review: null };
            }

            const partyMembers = getConfirmedPartyMemberNames();
            if (!partyMembers) {
                if (!automatic) sendChat(client, '§b§lParty Denick §8» §eYour party roster is still loading or unavailable. Wait for /p list, then try again.');
                return { retry: true, review: null };
            }
            if (!partyMembers.length) {
                if (!automatic) sendChat(client, '§b§lParty Denick §8» §7No other party members are currently tracked.');
                return { retry: false, review: null };
            }

            const partyByKey = new Map(partyMembers.map(name => [nickKey(name), name]));
            const teammateNames = Array.from(gameRoster).filter(name => (
                isValidPlayerName(name) && !isOwnPlayerName(name) && isSameTeamAsClient(name)
            ));
            if (!teammateNames.length) {
                if (!automatic) sendChat(client, '§b§lParty Denick §8» §eYour in-game team is not available yet. Try again in a moment.');
                return { retry: true, review: null };
            }

            const inspected = await Promise.all(teammateNames.map(async (nick) => {
                try {
                    // Ask the denick list before the API. It is the stronger
                    // answer and, unlike a lookup, it cannot fail: a teammate
                    // already saved there used to be lost whenever their lookup
                    // was rate limited, which both hid them from the review and
                    // left their real name sitting in the variation candidate
                    // pool - so a single genuinely unknown nick was reported as
                    // "found 2 eligible party members for 1 nick" instead
                    // of getting its variation.
                    applyKnownDenickFromHistory(nick, 'party_review', { queueUpdates: false });
                    const knownBeforeLookup = getAutoDenickResult(nick);
                    if (knownBeforeLookup?.realName) {
                        return { nick, realName: knownBeforeLookup.realName, known: true, isNicked: true };
                    }

                    const profile = await getStatsProfileForRosterPlayer(nick, {
                        denickResult: null,
                        lookup: { preferCache: true, apiPriority: 'game' }
                    });
                    // A failed lookup says nothing about who this player is.
                    // Reading it as "not nicked" quietly dropped them from the
                    // review and from every real-name total it derives.
                    if (profile?.data?.lookupFailed) return { nick, lookupFailed: true };
                    if (!profile?.data?.isNicked) return { nick, isNicked: false };
                    markNickedPlayer(nick, 'party_review');
                    const known = getAutoDenickResult(nick);
                    if (known?.realName) return { nick, realName: known.realName, known: true, isNicked: true };

                    const skinName = getRealNameFromSkin(lobbyPlayers.get(nick)?.properties);
                    if (!isValidPlayerName(skinName) || nickKey(skinName) === nickKey(nick)) {
                        return { nick, isNicked: true, variationEligible: true };
                    }
                    const realName = partyByKey.get(nickKey(skinName));
                    if (!realName) return { nick, isNicked: true, variationEligible: true };
                    return { nick, realName, known: false, isNicked: true };
                } catch (error) {
                    return { nick, lookupFailed: true };
                }
            }));

            const review = {
                at: Date.now(),
                gameSessionId,
                checkedNicks: inspected.filter(entry => entry?.isNicked).length,
                proposals: [],
                known: [],
                unresolved: [],
                variations: []
            };
            const unverifiedByRealName = new Map();
            const variationNickEntries = [];
            const visiblePartyMemberKeys = new Set();
            inspected.filter(Boolean).forEach((entry) => {
                if (entry.lookupFailed) {
                    review.unresolved.push(`${entry.nick} (lookup failed)`);
                } else if (!entry.isNicked) {
                    const partyName = partyByKey.get(nickKey(entry.nick));
                    if (partyName) visiblePartyMemberKeys.add(nickKey(partyName));
                } else if (entry.known) {
                    review.known.push(entry);
                } else if (entry.variationEligible) {
                    variationNickEntries.push(entry);
                } else {
                    const key = nickKey(entry.realName);
                    const matches = unverifiedByRealName.get(key) || [];
                    matches.push(entry);
                    unverifiedByRealName.set(key, matches);
                }
            });

            for (const matches of unverifiedByRealName.values()) {
                if (matches.length > 1) {
                    review.unresolved.push(`${matches.map(entry => entry.nick).join('/')} (ambiguous skin identity)`);
                    continue;
                }
                const entry = matches[0];
                try {
                    if (await isConfirmedNickCapablePartyMember(entry.realName)) {
                        review.proposals.push(entry);
                    } else {
                        review.unresolved.push(`${entry.nick} (${entry.realName} has no rank that can /nick)`);
                    }
                } catch (error) {
                    review.unresolved.push(`${entry.nick} (could not verify ${entry.realName}'s rank)`);
                }
            }

            if (variationNickEntries.length) {
                // Every party member we can already account for is off the
                // table: a candidate pool is only the members with nowhere
                // else to be. getDenickAliasForRealName covers a member whose
                // nick was resolved somewhere other than this review (the tab
                // stats path applies the denick history too), so their real
                // name can neither pad the count nor be offered for a
                // different nick.
                const lockedRealNameKeys = new Set([
                    ...review.known.map(entry => nickKey(entry.realName)),
                    ...review.proposals.map(entry => nickKey(entry.realName)),
                    ...visiblePartyMemberKeys,
                    // A member sitting in tab under their own name cannot be
                    // the person behind a nick. visiblePartyMemberKeys only
                    // covers members whose lookup came back on this client's
                    // team, so a member on another team - or one seen in tab
                    // but never inspected - used to stay in the pool and
                    // either pad the count past a match or, worse, be offered
                    // as the answer for someone else's nick.
                    ...partyMembers
                        .filter(realName => isPartyMemberVisibleInTab(realName))
                        .map(realName => nickKey(realName)),
                    ...partyMembers
                        .filter(realName => getDenickAliasForRealName(realName))
                        .map(realName => nickKey(realName))
                ]);
                const rankChecks = await Promise.all(partyMembers.map(async (realName) => ({
                    realName,
                    canNick: await isConfirmedNickCapablePartyMember(realName).catch(() => false)
                })));
                const candidateRealNames = rankChecks
                    .filter(entry => entry.canNick && !lockedRealNameKeys.has(nickKey(entry.realName)))
                    .map(entry => entry.realName)
                    .sort((left, right) => left.localeCompare(right));
                const variationNicks = variationNickEntries
                    .map(entry => entry.nick)
                    .sort((left, right) => left.localeCompare(right));

                if (variationNicks.length >= 1 && variationNicks.length <= 3 && candidateRealNames.length === variationNicks.length) {
                    review.variations = partyDenickPermutations(candidateRealNames).map(realNames => (
                        variationNicks.map((nick, index) => ({ nick, realName: realNames[index] }))
                    ));
                } else {
                    // Name the candidates. A bare count leaves no way to tell
                    // whether the pool is genuinely ambiguous or is padded by a
                    // teammate the review failed to account for.
                    const candidateList = candidateRealNames.length ? `: ${candidateRealNames.join(', ')}` : '';
                    review.unresolved.push(`${variationNicks.join('/')} (found ${candidateRealNames.length} eligible party member${candidateRealNames.length === 1 ? '' : 's'}${candidateList} for ${variationNicks.length} nick${variationNicks.length === 1 ? '' : 's'})`);
                }
            }

            const shouldAnnounce = review.proposals.length > 0
                || review.variations.length > 0
                || review.unresolved.length > 0;
            if (shouldAnnounce) {
                partyDenickReview = review;
                sendPartyDenickReview(review);
            } else {
                partyDenickReview = null;
            }
            return { retry: review.checkedNicks === 0, review };
        }

        function confirmPartyDenickReview(nick = '') {
            const review = activePartyDenickReview();
            if (!review) {
                sendChat(client, '§b§lParty Denick §8» §eThat review expired. Run §f/denick party §eagain.');
                return;
            }

            const selectedKey = nickKey(nick);
            const selected = selectedKey
                ? review.proposals.filter(entry => nickKey(entry.nick) === selectedKey)
                : review.proposals.slice();
            if (!selected.length) {
                sendChat(client, '§b§lParty Denick §8» §7No confirmed mapping is waiting for that nick.');
                return;
            }

            let saved = 0;
            let alreadySaved = 0;
            selected.forEach((entry) => {
                if (getAutoDenickResult(entry.nick)?.realName) {
                    alreadySaved += 1;
                    return;
                }
                if (storeDenickResult(entry.nick, entry.realName, 'party_skin')) saved += 1;
                else alreadySaved += 1;
            });
            const selectedKeys = new Set(selected.map(entry => nickKey(entry.nick)));
            review.proposals = review.proposals.filter(entry => !selectedKeys.has(nickKey(entry.nick)));
            if (!review.proposals.length && !(review.variations || []).length) partyDenickReview = null;
            sendChat(client, `§b§lParty Denick §8» §aSaved §f${saved} §amapping${saved === 1 ? '' : 's'}${alreadySaved ? ` §7(${alreadySaved} already known)` : ''}§a.`);
        }

        function confirmPartyDenickVariation(indexValue) {
            const review = activePartyDenickReview();
            if (!review) {
                sendChat(client, '§b§lParty Denick §8» §eThat review expired. Run §f/denick party §eagain.');
                return;
            }
            const index = Number.parseInt(indexValue, 10) - 1;
            const selected = Number.isInteger(index) ? review.variations?.[index] : null;
            if (!selected?.length) {
                sendChat(client, '§b§lParty Denick §8» §cThat variation is not available. Run §f/denick party §cto refresh it.');
                return;
            }

            let saved = 0;
            let alreadySaved = 0;
            selected.forEach((entry) => {
                if (getAutoDenickResult(entry.nick)?.realName) {
                    alreadySaved += 1;
                    return;
                }
                if (storeDenickResult(entry.nick, entry.realName, 'party_variation')) saved += 1;
                else alreadySaved += 1;
            });
            partyDenickReview = null;
            sendChat(client, `§b§lParty Denick §8» §aSaved Variation #${index + 1}: §f${saved} §amapping${saved === 1 ? '' : 's'}${alreadySaved ? ` §7(${alreadySaved} already known)` : ''}§a.`);
        }

        async function handlePartyDenickCommand(args) {
            const action = String(args[2] || 'review').toLowerCase();
            if (action === 'test' || action === 'demo') {
                const testAction = String(args[3] || '').toLowerCase();
                if (testAction === 'choose' || testAction === 'select') {
                    confirmPartyDenickTestScenario(normalizePartyDenickTestScenario(args[4]), args[5]);
                    return;
                }
                const scenarioKey = normalizePartyDenickTestScenario(testAction);
                if (scenarioKey) sendPartyDenickTestScenario(scenarioKey);
                else sendPartyDenickTestMenu();
                return;
            }
            if (action === 'review' || action === 'scan' || action === 'status') {
                await buildPartyDenickReview();
                return;
            }
            if (action === 'confirm' || action === 'save') {
                confirmPartyDenickReview(args[3] || '');
                return;
            }
            if (action === 'choose' || action === 'variation' || action === 'select') {
                confirmPartyDenickVariation(args[3]);
                return;
            }
            if (action === 'cancel' || action === 'clear') {
                partyDenickReview = null;
                sendChat(client, '§b§lParty Denick §8» §7Review discarded. No mappings were saved.');
                return;
            }
            sendChat(client, '§cUsage: §e/denick party [review|confirm [nick]|choose <#>|cancel]');
        }

        const ENDER_DUST_REMINDER_TEST_SCENARIOS = Object.freeze({
            below: { label: 'Below Alert', kind: 'below' },
            threshold: { label: 'At Alert', kind: 'threshold' },
            full: { label: 'Full Minion', kind: 'full' },
            waiting: { label: 'Waiting for Data', kind: 'waiting' }
        });

        function sendEnderDustReminderTestMenu() {
            sendChat(client, '§b§lFury Reminder Test §8» §7Choose a fake state. §cNo Player API data or reminder settings will be changed.');
            sendChat(client, {
                text: '',
                extra: Object.entries(ENDER_DUST_REMINDER_TEST_SCENARIOS).flatMap(([key, scenario], index) => [
                    ...(index ? [{ text: ' §8| ' }] : []),
                    {
                        text: `§a[${scenario.label}]`,
                        color: 'green',
                        bold: true,
                        clickEvent: { action: 'run_command', value: `/reminder test ${key}` },
                        hoverEvent: { action: 'show_text', value: `Preview ${scenario.label.toLowerCase()} without changing your reminder.` }
                    }
                ])
            });
        }

        function sendEnderDustReminderTestScenario(value) {
            const key = String(value || '').toLowerCase();
            const scenario = ENDER_DUST_REMINDER_TEST_SCENARIOS[key];
            if (!scenario) {
                sendEnderDustReminderTestMenu();
                return;
            }

            const threshold = Math.max(1, Math.min(300, Math.round(Number(enderDustReminderThreshold) || 250)));
            if (scenario.kind === 'waiting') {
                sendChat(client, '§b§lFury Reminder Test §8» §7No message would be sent yet. Fury waits for the next Player API response for your account.');
                return;
            }

            const amount = scenario.kind === 'below'
                ? Math.max(0, threshold - 1)
                : scenario.kind === 'full'
                    ? 300
                    : threshold;
            if (amount < threshold) {
                sendChat(client, `§b§lFury Reminder Test §8» §7Slumber Minion: §f${amount}§7/§f300 §7Ender Dust. §8(No reminder at your ${threshold} threshold.)`);
                return;
            }
            sendChat(client, `§b§lFury Reminder Test §8» §dSlumber Minion has §f${amount}§d/§f300 §dEnder Dust. §aCollect it soon!`);
        }

        function renderReminderController() {
            const dust = enderDustReminder.getStatus();
            const daily = slumberDailyRewardsReminder.getStatus();
            const george = gamblerGeorgeReminder.getStatus();
            const dustAmount = dust.enderDust !== null && dust.enderDust !== undefined && dust.enderDust !== ''
                ? `${dust.enderDust}/${dust.capacity}`
                : 'not checked';
            const dailyAmount = daily.rewards.length
                ? `${daily.readyCount}/${daily.rewards.length} ready`
                : 'not checked';
            const threshold = Math.max(1, Math.min(300, Math.round(Number(enderDustReminderThreshold) || 250)));
            const panel = createFeatureStatus({
                client, sendChat, title: 'Reminders', subtitle: 'SLUMBER TRACKING',
                section: 'history', helpTopic: 'reminders'
            });

            panel.open();
            panel.section('Ender Dust');
            panel.toggleRow('Alerts', enderDustReminderEnabled, '/reminder on', '/reminder off',
                'Alert when the Slumber Minion reaches your Ender Dust target.');
            panel.valueRow('Last amount', dustAmount, {
                color: dust.enderDust !== null && dust.enderDust !== undefined ? panel.colors.value : panel.colors.quiet
            });
            panel.adjustRow('Alert at', `${threshold}/300`, {
                downCommand: `/reminder threshold ${Math.max(1, threshold - 25)}`,
                editCommand: '/reminder threshold ',
                upCommand: `/reminder threshold ${Math.min(300, threshold + 25)}`,
                canDown: threshold > 1,
                canUp: threshold < 300,
                editHover: 'Type an Ender Dust threshold from 1 to 300.'
            });

            panel.section('Daily NPC rewards');
            panel.toggleRow('Alerts', slumberDailyRewardsReminderEnabled, '/reminder daily on', '/reminder daily off',
                'Alert when Slumber NPC daily rewards become ready.');
            panel.valueRow('Last check', dailyAmount, {
                color: daily.rewards.length ? panel.colors.value : panel.colors.quiet
            });

            panel.section('Gambler George');
            panel.toggleRow('Claim alerts', gamblerGeorgeReminderEnabled, '/reminder george on', '/reminder george off',
                'After two consecutive BedWars wins, remind you when entering a lobby, pregame, or another game.');
            panel.valueRow('Bet progress', george.paused
                ? 'paused'
                : george.claimReady
                    ? 'ready to claim'
                    : george.active
                        ? `${george.wins}/${george.requiredWins} BedWars wins`
                        : george.onCooldown
                            ? 'failed'
                            : 'not active', {
                color: !george.paused && (george.claimReady || george.active)
                    ? panel.colors.value
                    : panel.colors.quiet
            });
            if (george.paused) {
                // Auto Gambler is what accepts the bet, so the tracker rides on
                // its switch. Progress already banked is kept, not discarded.
                panel.valueRow('Needs', 'Auto Gambler on', {
                    color: panel.colors.muted,
                    command: '/autogambler on',
                    actionLabel: 'enable',
                    hover: 'Gambler George tracking only runs while Auto Gambler is on.'
                });
            }
            if (george.onCooldown) {
                panel.valueRow('New bet in', formatGeorgeCooldown(george.cooldownRemainingMs), {
                    color: panel.colors.muted,
                    command: '/reminder george cooldown',
                    actionLabel: 'clear',
                    hover: 'Drop the 24h post-loss cooldown and let Auto Gambler accept again.'
                });
            }

            if (dust.error || daily.error) {
                panel.section('Last error');
                if (dust.error) panel.row([chatController.component(String(dust.error).slice(0, 52), 'red')]);
                if (daily.error) panel.row([chatController.component(String(daily.error).slice(0, 52), 'red')]);
            }

            panel.section('Actions');
            panel.row([
                ...panel.action('Check dust', '/reminder check', 'Refresh Ender Dust from your Hypixel player data.'),
                chatController.text(' ', panel.colors.quiet),
                ...panel.action('Check dailies', '/reminder daily check', 'Refresh Slumber daily reward times.'),
                chatController.text(' ', panel.colors.quiet),
                ...panel.action('George claimed', '/reminder george claimed', 'Clear a completed George reminder manually.'),
                chatController.text(' ', panel.colors.quiet),
                ...panel.action('Preview alert', '/reminder test', 'Preview reminder scenarios without changing data.')
            ]);
            panel.close();
        }

        function isAutoDenickAlreadyResolved(name) {
            const key = nickKey(name);
            return Boolean(getAutoDenickResult(name)?.realName || autoDenickStats.get(key)?.done);
        }

        function formatCount(value) {
            return Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-US') : String(value);
        }

        function queueAutoDenickStatVerification(name, stat, parsed) {
            const key = nickKey(name);
            if (autoDenickStats.get(key)?.notNicked) return;
            const current = autoDenickStats.get(key) || {
                name,
                finals: null,
                beds: null,
                inFlight: false,
                done: false,
                lastAttemptAt: 0,
                notNicked: false,
                announced: {},
                startedAnnounced: false,
                sessionId: gameSessionId
            };

            current.name = name;
            current.sessionId = gameSessionId;
            current[stat] = parsed;
            current.updatedAt = Date.now();
            current.announced[stat] = false;
            current.announced.combined = false;
            autoDenickStats.set(key, current);

            if (autoDenickNickChecks.has(key)) return;
            autoDenickNickChecks.add(key);

            getPlayerDataWithNickDetection(name).then(profile => {
                if (!isAutoDenickEligibleActor(name)) return;
                const latest = autoDenickStats.get(key);
                if (!latest || latest.done) return;

                if (profile?.data?.isNicked) {
                    markNickedPlayer(name, 'auto-chat-verify');
                    const finals = latest.finals;
                    const beds = latest.beds;
                    latest.announced = {};
                    autoDenickStats.set(key, latest);
                    if (finals !== null && beds !== null) recordAutoDenickStat(latest.name, 'finals', finals);
                    else if (finals !== null) recordAutoDenickStat(latest.name, 'finals', finals);
                    else if (beds !== null) recordAutoDenickStat(latest.name, 'beds', beds);
                    return;
                }

                if (profile?.data?.player && !profile?.data?.lookupFailed) {
                    latest.notNicked = true;
                    autoDenickStats.set(key, latest);
                }
            }).catch(() => {}).finally(() => {
                autoDenickNickChecks.delete(key);
            });
        }

        function recordAutoDenickStat(name, stat, value) {
            if (!isAutoDenickEligibleActor(name)) return;
            if (isAutoDenickAlreadyResolved(name)) return;
            const parsed = parseStatCount(value);
            if (parsed === null) return;
            if (!isDetectedNickedPlayer(name)) {
                queueAutoDenickStatVerification(name, stat, parsed);
                return;
            }

            const key = nickKey(name);
            const current = autoDenickStats.get(key) || {
                name,
                finals: null,
                beds: null,
                inFlight: false,
                done: false,
                lastAttemptAt: 0,
                notNicked: false,
                announced: {},
                startedAnnounced: false,
                sessionId: gameSessionId
            };

            const previousValue = current[stat];
            current.name = name;
            current.sessionId = gameSessionId;
            current[stat] = parsed;
            current.updatedAt = Date.now();

            if (previousValue !== parsed) {
                current.announced[stat] = false;
            }

            autoDenickStats.set(key, current);

            if (!current.announced[stat]) {
                const statLabel = stat === 'finals' ? 'finals' : 'beds';
                const missingLabel = stat === 'finals' ? 'bed count' : 'final count';
                const otherStat = stat === 'finals' ? 'beds' : 'finals';
                if (denickChatAnnouncementsEnabled) {
                    if (current[otherStat] === null) {
                        sendChat(client, `§b[AutoDenick] §c${name} §7has §e${formatCount(parsed)} §7${statLabel}, waiting for ${missingLabel}.`);
                    } else {
                        sendChat(client, `§b[AutoDenick] §c${name} §7has §e${formatCount(current.finals)} §7finals and §e${formatCount(current.beds)} §7beds.`);
                    }
                }
                current.announced[stat] = true;
                autoDenickStats.set(key, current);
            }

            if (current.finals !== null && current.beds !== null) {
                runAutoDenickForObservedPlayer(key, gameSessionId).catch(() => {});
            }
        }

        function observeAutoDenickChat(text) {
            if (!autoStatsDenickEnabled) return;
            if (!gameActive || currentGamemode !== 'BEDWARS') return;
            const clean = stripAnsi(text || '');

            const finalMatch = clean.match(/\b([A-Za-z0-9_]{3,16}) was ([A-Za-z0-9_]{3,16})'s final #([\d,]+)\.?(?:\s+FINAL KILL!)?/i);
            if (finalMatch) {
                recordAutoDenickStat(finalMatch[2], 'finals', finalMatch[3]);
            }

            const bedMatch = clean.match(/(?:BED DESTRUCTION >\s*)?(?:Your|Red|Blue|Green|Yellow|Aqua|White|Pink|Gray|Grey) Bed was bed #([\d,]+) destroyed by ([A-Za-z0-9_]{3,16})!/i);
            if (bedMatch) {
                recordAutoDenickStat(bedMatch[2], 'beds', bedMatch[1]);
            }
        }

        async function runAutoDenickForObservedPlayer(key, sessionId) {
            const observed = autoDenickStats.get(key);
            if (!observed || observed.done || observed.inFlight || observed.notNicked) return;
            if (!autoStatsDenickEnabled) return;
            if (getAutoDenickResult(observed.name)?.realName) {
                observed.done = true;
                autoDenickStats.set(key, observed);
                return;
            }
            if (isOwnPlayerName(observed.name) || isSameTeamAsClient(observed.name) || !isDetectedNickedPlayer(observed.name)) {
                observed.notNicked = true;
                autoDenickStats.set(key, observed);
                return;
            }
            if (observed.finals === null || observed.beds === null) return;
            if (Date.now() - (observed.lastAttemptAt || 0) < 30000) return;
            const canRunPostGame = sessionId === lastBedwarsGameSessionId && Date.now() <= autoDenickGraceUntil;
            const canRunInGame = gameActive && currentGamemode === 'BEDWARS' && sessionId === gameSessionId;
            if (!canRunInGame && !canRunPostGame) return;

            observed.inFlight = true;
            observed.lastAttemptAt = Date.now();
            if (!observed.startedAnnounced) {
                observed.startedAnnounced = true;
                if (denickChatAnnouncementsEnabled) {
                    sendChat(client, `§b[AutoDenick] §7Started denicking §c${observed.name} §7(§f${formatCount(observed.finals)} finals§7, §f${formatCount(observed.beds)} beds§7)...`);
                }
            }
            autoDenickStats.set(key, observed);

            try {
                const canContinue = () => {
                    const stillInGame = gameActive && currentGamemode === 'BEDWARS' && sessionId === gameSessionId;
                    const stillInGrace = sessionId === lastBedwarsGameSessionId && Date.now() <= autoDenickGraceUntil;
                    return stillInGame || stillInGrace;
                };
                if (!canContinue()) return;

                const { candidates, error } = await findDenickCandidatesByStats({
                    finals: observed.finals,
                    beds: observed.beds
                });

                if (!canContinue()) return;
                if (error || candidates.length === 0) return;

                const best = candidates[0];
                const result = {
                    nick: observed.name,
                    realName: best.displayName || best.name,
                    source: 'stats',
                    finals: best.finals,
                    beds: best.beds,
                    observedFinals: observed.finals,
                    observedBeds: observed.beds,
                    at: Date.now()
                };

                autoDenickResults.set(key, result);
                rememberCurrentGameDenickNames(observed.name, result.realName);
                appendDenickHistory({
                    nick: observed.name,
                    realIGN: result.realName,
                    method: 'stats',
                    stats: {
                        finals: result.observedFinals ?? result.finals ?? observed.finals,
                        beds: result.observedBeds ?? result.beds ?? observed.beds,
                        matchedFinals: result.finals ?? null,
                        matchedBeds: result.beds ?? null
                    },
                    gameMode: currentGamemode,
                    account: client.username
                });
                cleanupDenickAliasDuplicate(result.realName, 'auto_denick_alias');
                observed.done = true;
                if (gameActive && currentGamemode === 'BEDWARS' && gameRoster.has(observed.name)) {
                    queueOverlayStatsUpdate(observed.name, 0);
                }
                announceSuccessfulDenick(observed.name, result).catch(() => {
                    if (denickChatAnnouncementsEnabled) {
                        sendChat(client, `§b[AutoDenick] §c${observed.name} §a(${result.realName})`);
                    }
                });
                if (isTabStatsActiveInGame() && gameRoster.has(observed.name)) {
                    queueTabStatsUpdate(observed.name, 50);
                }
                if (gameActive) saveCurrentMatchSnapshot('auto_denick');
            } finally {
                const latest = autoDenickStats.get(key);
                if (latest) {
                    latest.inFlight = false;
                    autoDenickStats.set(key, latest);
                }
            }
        }

        function touchLobbyPlayer(name, updates = {}) {
            if (!isValidPlayerName(name)) return null;
            const existing = lobbyPlayers.get(name) || {
                color: "§7",
                displayColor: null,
                letter: "?",
                uuid: null,
                team: null,
                teamAssignedAt: null,
                joinTime: Date.now(),
                properties: null,
                inTab: false,
                lastSeen: Date.now(),
                leftTabAt: null,
                sources: new Set()
            };

            const sources = existing.sources instanceof Set ? existing.sources : new Set(existing.sources || []);
            if (updates.source) sources.add(updates.source);

            if (updates.originalDisplayName !== undefined) {
                updates.displayColor = extractDisplayColor(updates.originalDisplayName, name) || existing.displayColor || null;
            }

            const next = {
                ...existing,
                ...updates,
                lastSeen: Date.now(),
                sources
            };

            if (updates.inTab === true) next.leftTabAt = null;
            lobbyPlayers.set(name, next);
            if (['team', 'rawTeam', 'activeScoreboardTeam', 'color', 'letter'].some(key => existing[key] !== next[key])) {
                teamDebug.mark('assignment', {
                    player: name, source: updates.source || null,
                    before: { team: existing.team, rawTeam: existing.rawTeam, color: existing.color, letter: existing.letter },
                    after: { team: next.team, rawTeam: next.rawTeam, color: next.color, letter: next.letter }
                });
            }
            if (displayLooksNickCapableText(next.originalDisplayName) || displayLooksNickCapableText(next.displayName)) {
                rememberNickCapablePlayer(name, 'display');
            }
            return next;
        }

        function normalizeScoreboardTeamName(teamName) {
            const raw = String(teamName || '');
            const namedTeam = getBedwarsTeamInfo(raw);
            if (namedTeam) return namedTeam.name;
            const teamNameMatch = raw.match(/^([A-Za-z]+)\d*$/);
            return teamNameMatch ? teamNameMatch[1] : raw;
        }

        function getScoreboardTeamInfo(teamName) {
            const raw = String(teamName || '');
            const alias = scoreboardTeamAliases.get(raw);
            return scoreboardTeamRegistry.get(alias || normalizeScoreboardTeamName(raw));
        }

        function findScoreboardTeamForPlayer(playerName) {
            const rawTeamName = scoreboardEntryTeams.get(String(playerName || ''));
            if (rawTeamName) {
                const baseTeamName = scoreboardTeamAliases.get(rawTeamName) || normalizeScoreboardTeamName(rawTeamName);
                const teamInfo = scoreboardTeamRegistry.get(baseTeamName);
                if (teamInfo?.players?.has(playerName)) return { baseTeamName, teamInfo };
            }
            for (const [baseTeamName, teamInfo] of scoreboardTeamRegistry.entries()) {
                if (teamInfo.players?.has(playerName)) {
                    return { baseTeamName, teamInfo };
                }
            }
            return null;
        }

        // The BedWars team a player is in *right now*, read from live scoreboard
        // membership rather than the cached lobbyPlayers record.
        //
        // The cached record is not reliable on its own: seedGameRoster's
        // stale-team reset nulls info.team/rawTeam/colour for anyone whose team
        // predates the game start, and getBedwarsVisualTeamInfo then falls back
        // to the colour of their tab display name. A rank colour is
        // indistinguishable from a team colour there (§b is both MVP and Aqua,
        // §a is both VIP and Green), which is how one or two teammates ended up
        // rendered on a team they were never on. Raw IDs are not color truth:
        // reports show Yellow2 with an explicit green G prefix. Resolve the
        // evidence held by that raw team before using normalized fallbacks.
        function liveBedwarsTeamInfo(name) {
            const rawTeamName = scoreboardEntryTeams.get(String(name || ''));
            if (rawTeamName) {
                const evidence = rawScoreboardTeams.get(rawTeamName)?.bedwarsEvidence;
                return evidence ? exactBedwarsTeamInfo(evidence.name) : null;
            }
            const assignment = rawTeamName ? null : findScoreboardTeamForPlayer(name);
            const named = getBedwarsTeamInfo(rawTeamName || assignment?.baseTeamName || '');
            if (named) return named;

            const teamInfo = rawTeamName ? getScoreboardTeamInfo(rawTeamName) : assignment?.teamInfo;
            if (!teamInfo?.isBedwarsTeam) return null;
            return getBedwarsTeamInfoFromColor(teamInfo.color)
                || getUniqueBedwarsTeamInfoFromLetter(teamInfo.letter);
        }

        function resolveBedwarsTeamDef(info = {}, name = '') {
            return liveBedwarsTeamInfo(name) || getBedwarsVisualTeamInfo(info, name);
        }

        function resolveBedwarsTeamName(name) {
            return resolveBedwarsTeamDef(lobbyPlayers.get(name) || {}, name)?.name
                || getPlayerTeam(lobbyPlayers, name)
                || null;
        }

        function isKnownTabPlayer(playerName) {
            if (isOwnPlayerName(playerName)) return true;
            const playerInfo = lobbyPlayers.get(playerName);
            return Boolean(playerInfo?.uuid || playerInfo?.inTab);
        }

        function hasCurrentBedwarsTeam(playerName) {
            const playerInfo = lobbyPlayers.get(playerName);
            if (!playerInfo) return false;
            const assignedTeam = playerInfo.team ? getBedwarsTeamInfo(playerInfo.team) : null;
            if (assignedTeam) return true;

            const scoreboardTeam = findScoreboardTeamForPlayer(playerName);
            if (!scoreboardTeam) return false;
            return Boolean(scoreboardTeam.teamInfo?.isBedwarsTeam || getBedwarsTeamInfo(scoreboardTeam.baseTeamName));
        }

        function isEligibleForCurrentGameRoster(playerName) {
            if (!isValidPlayerName(playerName) || isDenickAliasDuplicate(playerName)) return false;
            if (!gameActive || currentGamemode !== 'BEDWARS') return true;
            return hasCurrentBedwarsTeam(playerName);
        }

        function setCurrentGamemode(mode) {
            if (!mode || currentGamemode === mode) return;
            currentGamemode = mode;

            if (tabStatsEnabled) {
                if (gameActive && isSupportedTabStatsMode(mode)) refreshTabStatsForRoster();
                else clearAllTabStatsDisplays();
            }
        }

        function getCurrentScoreboardText(extraText = '') {
            const title = scoreboardObjectiveTitles.get(sidebarScoreboardObjective) || lastScoreboardTitle || '';
            const lines = Array.from(scoreboardLines.values()).map(entry => {
                const teamName = scoreboardEntryTeams.get(String(entry || ''));
                const team = teamName ? rawScoreboardTeams.get(teamName) : null;
                return reconstructScoreboardLine(entry, team);
            });
            return `${title} ${extraText || ''} ${lines.join(' ')}`;
        }

        function clearTrackedScoreboard() {
            teamDebug.mark('scoreboard_reset', { gameSessionId, gameActive, currentGamemode });
            scoreboardLines.clear();
            scoreboardObjectiveTitles.clear();
            sidebarScoreboardObjective = '';
            lastScoreboardTitle = '';
            rawScoreboardTeams.clear();
            scoreboardEntryTeams.clear();
            sidebarTeamStatusById.clear();
        }

        function getCurrentScoreboardTitle() {
            return scoreboardObjectiveTitles.get(sidebarScoreboardObjective) || lastScoreboardTitle || '';
        }

        function getScoreboardLineList() {
            return Array.from(scoreboardLines.values()).map(entry => {
                const teamName = scoreboardEntryTeams.get(String(entry || ''));
                const team = teamName ? rawScoreboardTeams.get(teamName) : null;
                return reconstructScoreboardLine(entry, team);
            });
        }

        function clearDuelsState(reason = 'clear') {
            finishLocalDuel();
            if (duelsAutoScanTimer) {
                clearTimeout(duelsAutoScanTimer);
                duelsAutoScanTimer = null;
            }
            if (!duelsState.active && !duelsState.opponents.length && !duelsState.modeDef) return;
            duelsState = { active: false, modeDef: null, modeName: '', opponents: [], sessionId: duelsState.sessionId + 1 };
            if (nametagOverlayEnabled) clearNametagTeams();
        }

        // Keep duelsState in sync with the sidebar every scoreboard tick. Returns
        // true when we're currently looking at a Duels sidebar so the caller can
        // short-circuit the Bedwars/SkyWars detection that follows.
        function updateDuelsStateFromScoreboard() {
            const title = getCurrentScoreboardTitle();
            const lines = getScoreboardLineList();
            if (!isDuelsScoreboard(title, lines)) {
                if (duelsState.active) clearDuelsState('left_duel');
                return false;
            }

            const info = extractDuelsInfoFromScoreboard(lines);
            const modeDef = info.modeName ? matchDuelsMode(info.modeName, DUELS_MODE_DEFS) : duelsState.modeDef;
            const enteringNew = !duelsState.active;
            const modeChanged = modeDef && duelsState.modeDef?.id !== modeDef.id;
            if (enteringNew) duelsState.sessionId += 1;
            duelsState.active = true;
            if (info.modeName) duelsState.modeName = info.modeName;
            if (modeDef) duelsState.modeDef = modeDef;
            // Scoreboard opponents are a fallback; the chat "Opponent(s):" line is
            // the authoritative source and also drives auto-scan.
            if (duelsState.opponents.length === 0 && info.opponents.length > 0) {
                duelsState.opponents = info.opponents;
            }
            // Feed the nametag overlay. Refetch when we first enter a duel, when
            // the mode changes (WLR/KDR are per-mode), or while any roster player
            // still lacks stats (the tab list can populate after the sidebar).
            // Otherwise just resync. The refresh is debounced so scoreboard ticks
            // don't storm the API.
            if (nametagOverlayEnabled && duelsState.active) {
                const missingStats = duelsNametagRosterNames().some(n => !overlayPlayerStats.get(nickKey(n)));
                if (enteringNew || modeChanged || missingStats) {
                    scheduleDuelsNametagRefresh(enteringNew || modeChanged ? 400 : 900);
                } else {
                    scheduleNametagSync();
                }
            }
            return true;
        }

        function scheduleDuelsAutoScan(delay = 2500) {
            if (!autoScanOnGameStart) return;
            if (state.scanMode === 'off') return;
            if (duelsAutoScanTimer) clearTimeout(duelsAutoScanTimer);
            const scanSessionId = duelsState.sessionId;
            duelsAutoScanTimer = setTimeout(() => {
                duelsAutoScanTimer = null;
                if (duelsState.sessionId !== scanSessionId || !duelsState.active) return;
                runDuelsScan({ silent: true }).catch(() => {});
            }, delay);
        }

        async function runDuelsScan({ silent = false } = {}) {
            if (!duelsState.active) {
                if (!silent) sendChat(client, '§cScan for duels is only available while you are in a duel.');
                return false;
            }
            // Late refresh from the sidebar in case chat never carried opponents.
            if (duelsState.opponents.length === 0 || !duelsState.modeDef) {
                updateDuelsStateFromScoreboard();
            }
            if (!duelsState.modeDef) {
                if (!silent) sendChat(client, '§cCould not determine the duel mode yet — try /scan again in a moment.');
                return false;
            }
            if (duelsState.opponents.length === 0) {
                if (!silent) sendChat(client, '§cNo duel opponents detected yet.');
                return false;
            }
            const scanSessionId = duelsState.sessionId;
            return performDuelsScan(client, {
                opponents: duelsState.opponents.slice(),
                modeDef: duelsState.modeDef,
                isStillActive: () => duelsState.sessionId === scanSessionId && duelsState.active
            });
        }

        function updateRawScoreboardTeam(data = {}, modeId) {
            const teamName = String(data.team || '');
            if (!teamName) return;

            const removeMappedPlayers = (team) => {
                Array.from(team?.players || []).forEach(entry => {
                    if (scoreboardEntryTeams.get(entry) === teamName) scoreboardEntryTeams.delete(entry);
                });
            };

            // Vanilla Scoreboard.addPlayerToTeam drops the player out of
            // whatever team they were in before, so Hypixel never has to send a
            // mode-4 removal first - and the captured traffic shows it often
            // does not. Without the same eviction here the team they left keeps
            // holding them, and its next packet re-stamps them onto the colour
            // they already left (Hypixel refreshes a BedWars team's prefix
            // about once a second). That is how a teammate ends up sorted,
            // coloured and lettered on somebody else's team.
            const claimEntryForTeam = (entry) => {
                const previousTeamName = scoreboardEntryTeams.get(entry);
                if (previousTeamName && previousTeamName !== teamName) {
                    rawScoreboardTeams.get(previousTeamName)?.players?.delete(entry);
                }
                scoreboardEntryTeams.set(entry, teamName);
            };

            if (modeId === 1) {
                removeMappedPlayers(rawScoreboardTeams.get(teamName));
                rawScoreboardTeams.delete(teamName);
                return;
            }

            const existing = (modeId === 0 ? null : rawScoreboardTeams.get(teamName)) || {
                prefix: '',
                suffix: '',
                players: new Set()
            };

            if (modeId === 0) {
                removeMappedPlayers(rawScoreboardTeams.get(teamName));
                existing.prefix = displayValueToString(data.prefix || '');
                existing.suffix = displayValueToString(data.suffix || '');
                existing.players = new Set((data.players || []).map(value => String(value || '')));
            } else if (modeId === 2) {
                existing.prefix = displayValueToString(data.prefix ?? existing.prefix);
                existing.suffix = displayValueToString(data.suffix ?? existing.suffix);
            } else if (modeId === 3) {
                (data.players || []).forEach(value => existing.players.add(String(value || '')));
            } else if (modeId === 4) {
                (data.players || []).forEach(value => {
                    const entry = String(value || '');
                    existing.players.delete(entry);
                    if (scoreboardEntryTeams.get(entry) === teamName) scoreboardEntryTeams.delete(entry);
                });
            }

            if (modeId === 0 || modeId === 2) {
                existing.bedwarsEvidence = resolveTeamEvidence(teamName, existing.prefix, existing.bedwarsEvidence);
            }
            rawScoreboardTeams.set(teamName, existing);
            existing.players.forEach(claimEntryForTeam);
        }

        function updateDetectedStateFromScoreboard(extraText = '') {
            const scoreboardText = getCurrentScoreboardText(extraText);
            const reminderServerId = pregameLobbyIdForScoreboard(scoreboardText);
            if (lookingForTriggers.isLobbyChange(reminderServerId)) stopLookingFor('you left the lobby');
            if (/^(?:lobby\d|l\d)/i.test(reminderServerId || '')) {
                scheduleReminderLobby(`lobby:${reminderLobbyBoundary}`);
            }
            autoDodger.noteScoreboard(scoreboardText);
            noteActiveMatchServerId(scoreboardText);
            // Duels first: its sidebar title is "DUELS", and modes like "Bed Wars
            // Duel" would otherwise be misread as a real Bedwars game (the mode
            // line literally contains "BEDWARS"). When we're in a duel we skip
            // all Bedwars/SkyWars detection below.
            if (updateDuelsStateFromScoreboard()) return true;
            const detectedMode = detectGamemodeFromText(scoreboardText);
            if (detectedMode) setCurrentGamemode(detectedMode);
            const lobbyMode = detectLobbyFromScoreboard(scoreboardText);
            if (updateLobbyStateFromScoreboard(scoreboardText, lobbyMode)) return true;
            if (updateBedwarsPregameStateFromScoreboard(scoreboardText)) return true;
            return updateActiveGameStateFromScoreboard(scoreboardText, detectedMode);
        }

        // Keep the live game's server id up to date. Only while a game is
        // actually running: in a lobby the sidebar shows the LOBBY's id, and
        // letting that overwrite the value is exactly how the stamp went wrong
        // (the snapshot is saved on match reset, when the lobby sidebar is often
        // already up).
        function noteActiveMatchServerId(scoreboardText = '') {
            if (!gameActive || !isSupportedTabStatsMode(currentGamemode)) return;
            const serverId = pregameLobbyIdForScoreboard(scoreboardText);
            if (serverId) activeMatchServerId = serverId;
            if (serverId && activeSessionGameMetadata) activeSessionGameMetadata.serverId = serverId;
        }

        function getCompactScoreboardText(text) {
            const compact = stripAnsi(displayValueToString(text)).toUpperCase().replace(/[^A-Z]/g, '');
            return compact;
        }

        function scoreboardHasAll(text, needles) {
            const compact = getCompactScoreboardText(text);
            return needles.every(needle => compact.includes(needle));
        }

        function scoreboardHasAny(text, needles) {
            const compact = getCompactScoreboardText(text);
            return needles.some(needle => compact.includes(needle));
        }

        function detectLobbyFromScoreboard(text) {
            return detectLobbyModeScoreboard(text);
        }

        function detectedGameStateLabel() {
            if (gameActive && isSupportedTabStatsMode(currentGamemode)) return 'ACTIVE_GAME';
            if (bedwarsPregameActive) return 'PREGAME_LOBBY';
            if (isSupportedTabStatsMode(currentGamemode)) return 'LOBBY';
            return 'UNKNOWN';
        }

        function getCachedPregameChatProfile(name) {
            const cached = pregameChatPlayerProfiles.get(nickKey(name));
            if (!cached || Date.now() - cached.timestamp > CACHE_DURATION) {
                if (cached) pregameChatPlayerProfiles.delete(nickKey(name));
                return null;
            }
            return {
                data: cached.profile.data,
                fromCache: true
            };
        }

        async function getCachedOrPendingPregameChatProfile(name) {
            const cached = getCachedPregameChatProfile(name);
            if (cached) return cached;

            const pending = pregameChatLookupPromises.get(nickKey(name));
            if (!pending) return null;
            try {
                const profile = await pending;
                if (!profile?.data?.player || profile.data.lookupFailed || profile.data.isNicked || profile.pregameRealName) return null;
                return {
                    data: profile.data,
                    fromCache: true
                };
            } catch (error) {
                return null;
            }
        }

        // The profile every in-game stats surface (tab row, overlay row,
        // nametags) should look a rostered player up with.
        //
        // A settled nick reuses its known answer instead of re-running the
        // lookup. A nick's name is never cacheable, so re-asking Mojang on
        // every refresh - Hypixel drives about one per player per second -
        // only earned rate-limit errors, and each one re-rendered the row as
        // [FAIL] before the next success flipped it back to [NICK]. The
        // periodic re-check keeps a wrong nick call from lasting the match; a
        // failed re-check changes nothing, since isKnownNickedPlayer holds the
        // nick until real player data arrives. Auto-denick still owns turning
        // the nick into a real IGN.
        async function getStatsProfileForRosterPlayer(name, options = {}) {
            const denickResult = options.denickResult !== undefined
                ? options.denickResult
                : getAutoDenickResult(name);
            if (denickResult?.realName) {
                return makeFallbackPlayerProfile(name, { status: '§cNicked Account' });
            }
            if (isKnownNickedPlayer(name, null, denickResult)) {
                const key = nickKey(name);
                const verifiedAt = settledNickVerifiedAt.get(key);
                if (verifiedAt && Date.now() - verifiedAt < SETTLED_NICK_RECHECK_MS) {
                    return makeFallbackPlayerProfile(name, { isNicked: true, status: '§cNicked Account' });
                }
                settledNickVerifiedAt.set(key, Date.now());
            }
            return await getCachedOrPendingPregameChatProfile(name)
                || await getPlayerDataWithNickDetection(name, options.lookup || {});
        }

        function leaveBedwarsPregame(options = {}) {
            queueTimeTracker.leave();
            partyArrivalCheck.stop();
            partyArrivalPreview.stop();
            const wasActive = bedwarsPregameActive;
            autoDodger.cancel('lobby left', { announce: false });
            if (wasActive) partyArrivalTracker.onPregameLeave(options.reason || 'pregame_end');
            bedwarsPregameActive = false;
            bedwarsPregameLobbyId = null;
            bedwarsPregameMap = null;
            bedwarsPregameLocalQueue = null;
            bedwarsPregameLocalUnsupported = false;
            if (wasActive) bedwarsPregameSessionId += 1;
            pregameChatLookupsInFlight.clear();
            clearManualOverlayPlayersBySource('pregame', 'BEDWARS', options.reason || 'pregame_end');
            if (!options.preserveProfiles) {
                pregameChatSeenPlayers.clear();
                pregameChatLookupPromises.clear();
                pregameChatPlayerProfiles.clear();
            }
        }

        function enterBedwarsPregame(lobbyId = null) {
            if (bedwarsPregameActive) return false;
            stopLookingFor('you joined a game lobby');
            if (gameActive) resetMatchState({ keepMode: true });

            clearManualOverlayPlayersBySource('pregame', 'BEDWARS', 'new_pregame');
            pregameChatSeenPlayers.clear();
            pregameChatLookupsInFlight.clear();
            pregameChatLookupPromises.clear();
            pregameChatPlayerProfiles.clear();
            autoDodger.reset();
            // Each pregame owns its map. Clearing here as well as on leave makes
            // a direct lobby-to-lobby transfer safe even when packets arrive out of order.
            bedwarsPregameMap = null;
            bedwarsPregameLocalQueue = null;
            bedwarsPregameLocalUnsupported = false;
            bedwarsPregameActive = true;
            queueTimeTracker.enter(lobbyId);
            partyArrivalCheck.enter();
            bedwarsPregameLobbyId = lobbyId || null;
            bedwarsPregameSessionId += 1;
            setCurrentGamemode('BEDWARS');
            // This is the first confirmed queue boundary. Starting here keeps
            // launcher/lobby idle time out of the session while including the
            // waiting room before game one. activateGame remains a fallback
            // for modes whose pregame cannot be identified reliably.
            sessionTracker.onQueueStart({ mode: 'BEDWARS' });
            scheduleReminderLobby(`pregame:${bedwarsPregameSessionId}`);
            slumberDailyRewardsReminder.onGameplayMilestone();
            gamblerGeorgeTransitionId += 1;
            gamblerGeorgeReminder.onTransition('pregame', `pregame:${gamblerGeorgeTransitionId}`);
            partyArrivalTracker.onPregameEnter(bedwarsPregameSessionId);
            return true;
        }

        function updateBedwarsPregameStateFromScoreboard(scoreboardText = '') {
            if (!isBedwarsPregameScoreboard(scoreboardText)) return false;
            const lobbyId = pregameLobbyIdForScoreboard(scoreboardText);
            const map = parseBedwarsPregameMap([
                getCurrentScoreboardTitle(),
                ...getScoreboardLineList()
            ]);
            if (bedwarsPregameActive && lobbyId && bedwarsPregameLobbyId && lobbyId !== bedwarsPregameLobbyId) {
                leaveBedwarsPregame({ preserveProfiles: false, reason: 'pregame_server_change' });
            }
            if (!bedwarsPregameActive) {
                enterBedwarsPregame(lobbyId);
            } else if (lobbyId && !bedwarsPregameLobbyId) {
                bedwarsPregameLobbyId = lobbyId;
            }
            // Store only after a possible lobby replacement, so an abandoned
            // pregame's map can never be attached to the lobby we just joined.
            if (map) bedwarsPregameMap = map;
            const localQueue = requeueCommandForScoreboard(scoreboardText);
            if (!localQueue.fallback) bedwarsPregameLocalQueue = localQueue;
            if (/\b(dream|dreams|ultimate|voidless|castle|lucky|armed|rush|swap|underworld|private)\b/i.test(scoreboardText)) {
                bedwarsPregameLocalUnsupported = true;
            }
            return true;
        }

        function updateLobbyStateFromScoreboard(scoreboardText = '', detectedLobbyMode = undefined) {
            const lobbyMode = detectedLobbyMode === undefined
                ? detectLobbyFromScoreboard(scoreboardText)
                : detectedLobbyMode;
            if (!lobbyMode) return false;

            const alreadyInLobby = !gameActive && !bedwarsPregameActive && currentGamemode === lobbyMode;
            if (!alreadyInLobby) {
                leaveBedwarsPregame({ preserveProfiles: false, reason: 'main_lobby' });
                resetMatchState();
            }
            setCurrentGamemode(lobbyMode);
            scheduleReminderLobby(`lobby:${reminderLobbyBoundary}`);
            if (!alreadyInLobby) {
                gamblerGeorgeTransitionId += 1;
                gamblerGeorgeReminder.onTransition('lobby', `lobby:${gamblerGeorgeTransitionId}`);
            }
            return true;
        }

        function detectActiveGameFromScoreboard(text, detectedMode = undefined) {
            const mode = detectedMode === undefined ? detectGamemodeFromText(text) : detectedMode;
            if (!isSupportedTabStatsMode(mode)) return null;

            if (mode === 'SKYWARS' && scoreboardHasAny(text, ['PLAYERSLEFT', 'NEXTEVENT', 'REFILL', 'DOOM', 'DRAGONS'])) {
                return 'SKYWARS';
            }

            if (mode === 'BEDWARS' && scoreboardHasAny(text, ['DIAMOND', 'EMERALD', 'BEDDESTROYED', 'FINALKILL', 'TEAMUPGRADES', 'RED', 'BLUE', 'GREEN', 'YELLOW', 'AQUA', 'PINK', 'GRAY', 'WHITE'])) {
                return 'BEDWARS';
            }

            return null;
        }

        function updateActiveGameStateFromScoreboard(scoreboardText = '', detectedMode = undefined) {
            const activeMode = detectActiveGameFromScoreboard(scoreboardText, detectedMode);
            if (!activeMode) return false;

            if (!gameActive && getFreshLastMatchSnapshot(activeMode) && restoreLastMatchSnapshot('scoreboard_reconnect')) {
                return true;
            }

            activateGame(activeMode, { autoScanDelay: activeMode === 'SKYWARS' ? 3000 : 4000 });
            return true;
        }

        function tabStatsModeOverride(mode) {
            if (mode === 'BEDWARS') return tabStatsBedwarsMode;
            if (mode === 'SKYWARS') return tabStatsSkywarsMode;
            return 'auto';
        }

        function isTabStatsActiveInGame() {
            if (!tabStatsEnabled || isProxyAutoThrottleActive() || !gameActive) return false;
            if (!isSupportedTabStatsMode(currentGamemode)) return false;
            const override = tabStatsModeOverride(currentGamemode);
            // 'off' suppresses, 'on' and 'auto' both allow (auto defers to the
            // built-in supported-mode default which we already checked above).
            return override !== 'off';
        }

        function isScanActiveInGame() {
            return gameActive && isSupportedTabStatsMode(currentGamemode);
        }

        function summarizeDenickResult(result = {}) {
            return {
                nick: result.nick || '',
                realIGN: result.realName || '',
                method: result.source || 'unknown',
                finals: result.observedFinals ?? result.finals ?? null,
                beds: result.observedBeds ?? result.beds ?? null,
                matchedFinals: result.finals ?? null,
                matchedBeds: result.beds ?? null,
                at: result.at || null
            };
        }

        // A lookup that came back with a real Hypixel profile. The nicked and
        // lookup-failed shapes both carry a stub `player` object, so the two
        // flags have to be checked as well.
        function hasRealPlayerLookupData(data) {
            return Boolean(data?.player) && !data.lookupFailed && !data.isNicked;
        }

        // The single "is this player nicked" rule, shared by the tab row and
        // the overlay/nametag row so the two surfaces can never disagree.
        //
        // A confirmed nick is an identity result, not one lookup's outcome, so
        // it outlives every later lookup failure whatever kind it is. Deciding
        // it per lookup is what made a nicked player alternate between [NICK]
        // and [FAIL]: their name is never cacheable, so every tab refresh
        // re-ran the lookup and any miss re-rendered the row as a failure.
        // Only a lookup that returns real player data clears the marker.
        function isKnownNickedPlayer(name, data, denickResult = null, previousRow = undefined) {
            if (denickResult?.realName) return false;
            if (hasRealPlayerLookupData(data)) return false;
            // The last row we rendered is the third witness, next to the live
            // answer and the detected-nick set. It matters for a nick whose
            // name reads like one of Hypixel's entity names, since
            // markNickedPlayer refuses to record those. Both it and
            // detectedNickedPlayers are cleared with the match.
            const remembered = previousRow === undefined
                ? overlayPlayerStats.get(nickKey(name))
                : previousRow;
            return Boolean(data?.isNicked)
                || isDetectedNickedPlayer(name)
                || Boolean(remembered?.isNicked);
        }

        function rememberOverlayPlayer(name, profile, options = {}) {
            if (!isValidPlayerName(name)) return null;
            const info = options.info || lobbyPlayers.get(name) || {};
            const denickResult = options.denickResult || getAutoDenickResult(name);
            const previous = overlayPlayerStats.get(nickKey(name));
            // Keep the row nicked through the failure rather than letting
            // buildNametagFields see `lookupFailed` and drop the whole overlay
            // entry, which is why a known nick kept losing its [NICK] tag.
            const preserveKnownNick = isKnownNickedPlayer(name, profile?.data, denickResult, previous);
            const mode = options.mode || currentGamemode || 'BEDWARS';
            // A momentary API outage is not new information about the player.
            // Overwriting a good row with an empty failed one makes
            // buildNametagFields return nothing, which tears the player's
            // overlay team down and hands them back to Hypixel mid-game -
            // churn that moves their tab-list row for no reason. Keep the last
            // good row until a lookup actually comes back with something.
            if (!preserveKnownNick
                && !denickResult?.realName
                && previous?.mode === mode
                && !previous.lookupFailed
                && isTransientPlayerLookupFailure(profile?.data)) {
                return previous;
            }
            const stableProfile = preserveKnownNick && !profile?.data?.isNicked
                ? {
                    ...profile,
                    data: {
                        ...(profile.data || {}),
                        isNicked: true,
                        lookupFailed: false,
                        lookupErrorMessage: '',
                        status: '\u00a7cNicked Account'
                    }
                }
                : profile;
            const row = buildOverlayPlayerRow(name, stableProfile, {
                mode,
                info,
                denickResult,
                duelsModeDef: options.duelsModeDef,
                source: options.source || 'live'
            });
            overlayPlayerStats.set(nickKey(name), row);
            return row;
        }

        function buildOverlayPlaceholderPlayer(name) {
            const info = lobbyPlayers.get(name) || {};
            return buildOverlayPlayerRow(name, {
                data: {
                    player: {
                        displayname: name,
                        achievements: {},
                        stats: null
                    },
                    urchin: makeUrchinData(),
                    // Displayed ping is Aurora-only; the server's live
                    // latency is unreliable, so placeholders show none.
                    ping: makePingData(),
                    status: ''
                },
                fromCache: false
            }, {
                mode: currentGamemode || 'BEDWARS',
                info,
                denickResult: getAutoDenickResult(name),
                source: 'roster'
            });
        }

        function normalizeOverlayClearSource(source = 'all') {
            const value = String(source || 'all').toLowerCase().replace(/[\s_-]+/g, '');
            if (['all', 'everything'].includes(value)) return 'all';
            if (['manual', 'manually', 'm'].includes(value)) return 'manual';
            if (['trigger', 'triggers', 'chattrigger', 'chattriggers', 'chat'].includes(value)) return 'trigger';
            if (['dm', 'dms', 'directmessage', 'directmessages', 'message', 'messages'].includes(value)) return 'dm';
            if (['party', 'partyinvite', 'partyinvites'].includes(value)) return 'party';
            if (['mention', 'mentions', 'at'].includes(value)) return 'mention';
            if (['pregame', 'pregamechat', 'waitingroom', 'chatters'].includes(value)) return 'pregame';
            if (['live', 'game', 'gamerows', 'gamestart', 'gamestarting', 'roster'].includes(value)) return 'live';
            return null;
        }

        function overlayManualRowKind(row = {}) {
            if (row.chatTrigger) return 'trigger';
            if (row.directMessage) return 'dm';
            if (row.partyInvite) return 'party';
            if (row.mention) return 'mention';
            if (row.pregameChat) return 'pregame';
            return 'manual';
        }

        function overlayManualRowSource(row = {}) {
            const kind = overlayManualRowKind(row);
            return kind === 'manual' ? 'proxyManual' : kind;
        }

        function overlayClearSourceLabel(source) {
            return {
                all: 'all overlay rows',
                manual: 'manual players',
                trigger: 'chat trigger players',
                dm: 'DM players',
                party: 'party invite players',
                mention: 'mention players',
                pregame: 'pregame chat players',
                live: 'game rows'
            }[normalizeOverlayClearSource(source)] || 'overlay players';
        }

        function buildManualOverlayRows(mode = null, rosterKeys = new Set()) {
            return Array.from(manualOverlayPlayers.values())
                .filter(row => row?.manual && (!mode || row.mode === mode) && !rosterKeys.has(nickKey(row.name)))
                .map(row => ({
                    ...row,
                    manual: true,
                    rowSource: overlayManualRowSource(row),
                    inRoster: false,
                    infoFresh: Date.now() - (row.updatedAt || 0) < CACHE_DURATION
                }));
        }

        function clearManualOverlayPlayers(reason = 'lifecycle') {
            if (manualOverlayPlayers.size === 0) return false;
            manualOverlayPlayers.clear();
            console.log(`[Overlay] Cleared manual overlay players (${reason})`);
            return true;
        }

        function clearManualOverlayPlayersBySource(source = 'all', mode = null, reason = 'source_clear') {
            const normalizedSource = normalizeOverlayClearSource(source);
            if (!normalizedSource || normalizedSource === 'live') return 0;
            const normalizedMode = isSupportedTabStatsMode(mode) ? mode : null;
            let removed = 0;

            Array.from(manualOverlayPlayers.entries()).forEach(([key, row]) => {
                if (!row?.manual) return;
                if (normalizedMode && row.mode !== normalizedMode) return;
                if (normalizedSource !== 'all' && overlayManualRowKind(row) !== normalizedSource) return;
                manualOverlayPlayers.delete(key);
                removed += 1;
            });

            if (removed) console.log(`[Overlay] Cleared ${removed} ${overlayClearSourceLabel(normalizedSource)} (${reason})`);
            return removed;
        }

        function suppressLiveOverlayRowsForCurrentGame(mode = currentGamemode) {
            const normalizedMode = isSupportedTabStatsMode(mode) ? mode : currentGamemode;
            if (!gameActive || !isSupportedTabStatsMode(currentGamemode) || currentGamemode !== normalizedMode) return 0;
            seedGameRoster();
            const count = Array.from(gameRoster)
                .filter(name => isValidPlayerName(name) && !isDenickAliasDuplicate(name))
                .length;
            suppressedOverlayLiveSession = gameSessionId || 'active';
            return count;
        }

        function overlayContainsPlayer(name, mode = currentGamemode || 'BEDWARS') {
            const key = nickKey(name);
            if (!key) return false;
            const normalizedMode = isSupportedTabStatsMode(mode) ? mode : 'BEDWARS';
            if (manualOverlayPlayers.has(`${normalizedMode}:${key}`)) return true;
            if (gameActive && isSupportedTabStatsMode(currentGamemode) && currentGamemode === normalizedMode && Array.from(gameRoster).some(player => nickKey(player) === key)) return true;
            return Array.from(overlayPlayerStats.values()).some(row => row?.mode === normalizedMode && nickKey(row.name) === key);
        }

        function buildOverlayRosterSnapshot() {
            if (!gameActive || !isSupportedTabStatsMode(currentGamemode)) {
                return buildManualOverlayRows(null).slice(0, 48);
            }

            seedGameRoster();

            if (suppressedOverlayLiveSession === (gameSessionId || 'active')) {
                return buildManualOverlayRows(currentGamemode, new Set()).slice(0, 48);
            }

            const rosterRows = Array.from(gameRoster)
                .filter(name => isValidPlayerName(name) && !isDenickAliasDuplicate(name))
                .slice(0, 40)
                .map(name => {
                    const cachedRow = overlayPlayerStats.get(nickKey(name));
                    const denickResult = getAutoDenickResult(name);
                    if (cachedRow && cachedRow.mode === currentGamemode) {
                        const desiredRealName = showDenickedRealIgn ? (denickResult?.realName || '') : '';
                        if (denickResult?.realName && cachedRow.realName !== desiredRealName) {
                            const realCachedProfile = globalCache.get(nickKey(denickResult.realName));
                            if (realCachedProfile?.data) {
                                return {
                                    ...rememberOverlayPlayer(name, {
                                        data: realCachedProfile.data,
                                        fromCache: true
                                    }, {
                                        mode: currentGamemode,
                                        source: 'denick_cache',
                                        denickResult
                                    }),
                                    inRoster: true,
                                    infoFresh: Date.now() - (realCachedProfile.timestamp || 0) < CACHE_DURATION
                                };
                            }

                            return {
                                ...cachedRow,
                                realName: desiredRealName,
                                source: denickResult.source || cachedRow.source,
                                inRoster: true,
                                infoFresh: Date.now() - (cachedRow.updatedAt || 0) < CACHE_DURATION
                            };
                        }

                        return {
                            ...cachedRow,
                            realName: denickResult?.realName ? desiredRealName : cachedRow.realName,
                            inRoster: true,
                            infoFresh: Date.now() - (cachedRow.updatedAt || 0) < CACHE_DURATION
                        };
                    }

                    const lookupName = denickResult?.realName || name;
                    const cachedProfile = globalCache.get(nickKey(lookupName));
                    if (cachedProfile?.data) {
                        return {
                            ...rememberOverlayPlayer(name, {
                                data: cachedProfile.data,
                                fromCache: true
                            }, {
                                mode: currentGamemode,
                                source: denickResult?.realName ? 'denick_cache' : 'cache',
                                denickResult
                            }),
                            inRoster: true,
                            infoFresh: Date.now() - (cachedProfile.timestamp || 0) < CACHE_DURATION
                        };
                    }

                    return {
                        ...buildOverlayPlaceholderPlayer(name),
                        inRoster: true,
                        infoFresh: false
                    };
                });

            const rosterKeys = new Set(Array.from(gameRoster).map(name => nickKey(name)));
            const manualRows = buildManualOverlayRows(currentGamemode, rosterKeys);

            return [...rosterRows, ...manualRows].slice(0, 48);
        }

        async function getOverlayPlayerData(name, mode = currentGamemode || 'BEDWARS', source = 'manual', lookupOptions = {}) {
            const manualLookup = String(source || '').toLowerCase().startsWith('manual');
            const profile = await getPlayerDataWithNickDetection(name, { ...lookupOptions, forceRefresh: manualLookup });
            return rememberOverlayPlayer(name, profile, {
                mode,
                source,
                info: lobbyPlayers.get(name) || {},
                denickResult: getAutoDenickResult(name)
            }) || buildOverlayPlayerRow(name, profile, { mode, source });
        }

        async function addManualOverlayPlayerFromCommand(name) {
            const target = String(name || '').trim();
            if (!isValidPlayerName(target)) {
                sendChat(client, '§cUsage: /ol add <player>');
                return;
            }

            const mode = gameActive && isSupportedTabStatsMode(currentGamemode) ? currentGamemode : 'BEDWARS';
            if (overlayContainsPlayer(target, mode)) {
                sendChat(client, `§6[Overlay] §7${target} is already in the overlay.`);
                return;
            }
            sendChat(client, `§6[Overlay] §7Adding §f${target}§7 to ${mode === 'SKYWARS' ? 'SkyWars' : 'Bedwars'} overlay...`);

            try {
                const row = await getOverlayPlayerData(target, mode, 'manual_command');
                if (!row) {
                    sendChat(client, `§6[Overlay] §cCould not add ${target}.`);
                    return;
                }

                const key = `${mode}:${nickKey(target)}`;
                manualOverlayPlayers.set(key, {
                    ...row,
                    name: row.name || target,
                    mode,
                    manual: true,
                    rowSource: 'proxyManual',
                    source: 'manual_command',
                    manualAddedAt: Date.now()
                });
                sendChat(client, `§6[Overlay] §aAdded §f${target}§a to overlay.`);
            } catch (e) {
                sendChat(client, `§6[Overlay] §cCould not add ${target}: §7${e.message || 'lookup failed'}`);
            }
        }

        function handleOverlayClearCommand(sourceArg = 'manual') {
            const normalizedSource = normalizeOverlayClearSource(sourceArg || 'manual');
            if (!normalizedSource) {
                sendChat(client, '§6[Overlay] §7Usage: §e/ol clear <manual|triggers|dm|party|mentions|pregame|game|all>');
                return;
            }

            const mode = gameActive && isSupportedTabStatsMode(currentGamemode) ? currentGamemode : null;
            let removed = 0;

            if (normalizedSource !== 'live') {
                removed += clearManualOverlayPlayersBySource(normalizedSource, normalizedSource === 'all' ? null : mode, 'command');
            }

            if (normalizedSource === 'live' || normalizedSource === 'all') {
                removed += suppressLiveOverlayRowsForCurrentGame(mode || currentGamemode);
            }

            sendChat(client, `§6[Overlay] §aCleared §f${removed}§a ${overlayClearSourceLabel(normalizedSource)}.`);
        }

        function canAutoAddSocialOverlayPlayer(type) {
            if (!socialOverlayAddsEnabled) return false;
            if (overlayAutoAddOutsideGamesOnly && gameActive && isSupportedTabStatsMode(currentGamemode)) return false;
            return true;
        }

        function getSocialOverlayMode() {
            return gameActive && isSupportedTabStatsMode(currentGamemode) ? currentGamemode : 'BEDWARS';
        }

        function socialOverlayDetails(options, added, row = null) {
            return options?.returnDetails ? { added, row } : added;
        }

        function existingSocialOverlayRow(name, mode) {
            const key = `${mode}:${nickKey(name)}`;
            const manual = manualOverlayPlayers.get(key);
            if (manual) return manual;
            const live = overlayPlayerStats.get(nickKey(name));
            return live?.mode === mode ? live : null;
        }

        function parseChatSenderAndMessage(text) {
            const clean = stripAnsi(text || '').replace(/\s+/g, ' ').trim();
            if (!clean || /^From\s+/i.test(clean)) return null;
            const colonIndex = clean.indexOf(':');
            if (colonIndex <= 0) return null;

            const left = clean.slice(0, colonIndex);
            const message = clean.slice(colonIndex + 1).trim();
            if (!message) return null;

            const matches = left.match(/[A-Za-z0-9_]{3,16}/g) || [];
            const sender = matches.reverse().find(name => !isChatSenderTokenBlocked(name));
            if (!isValidPlayerName(sender) || isOwnPlayerName(sender)) return null;
            return { sender, message };
        }

        function hidePregamePartyMember(name) {
            return shouldHidePregamePartyMember(name, {
                isPartyMember: member => {
                    const tracked = partyTracker.isTrackedMember(member);
                    return partyTracker.hasUsableState() && partyTracker.isInParty() && tracked;
                },
                getKnownDenick: findKnownDenickByNick
            });
        }

        function renderPregameChatPlayerStats(name, profile) {
            if (hidePregamePartyMember(name)) return;
            const data = profile?.data || {};
            const player = data.player || {};
            const realName = profile?.pregameRealName || '';
            if (data.isNicked && !realName) {
                sendChat(client, `§b§lPregame §8» §c[NICKED] §f${name}`);
                return;
            }
            if (data.lookupFailed) {
                const identity = realName ? `${realName} §8(${name})` : name;
                sendChat(client, `§b§lPregame §8» §6[FAIL] §f${identity} §7- §c${data.lookupErrorMessage || 'Hypixel API lookup failed'}`);
                return;
            }

            const bedwars = player.stats?.Bedwars || {};
            const stars = numberOr(player.achievements?.bedwars_level, 0);
            const fkdr = ratioValue(bedwars.final_kills_bedwars, bedwars.final_deaths_bedwars);
            const wlr = ratioValue(bedwars.wins_bedwars, bedwars.losses_bedwars);
            const winstreak = numberOr(bedwars.winstreak, 0);
            const averagePing = numberOr(data.ping?.avgPing, -1);
            const latestPing = numberOr(data.ping?.ping, -1);
            const ping = averagePing >= 0 ? averagePing : latestPing;
            const rankedName = `${getRankedName(player)}${realName ? ` §8(${name})` : ''}`;
            const line = {
                text: '§b§lPregame §8» ',
                extra: [{
                    text: `${formatBedwarsPrestige(stars)} ${rankedName} §8(${getPingColor(ping)}${Math.round(ping)}ms§8)`
                        + ` §7| §fFKDR: ${getFkdrColor(fkdr)}${fkdr.toFixed(2)}`
                        + ` §7| §fWLR: ${getWlrColor(wlr)}${wlr.toFixed(2)}`
                        + ` §7| §fWS: ${getWsColor(winstreak)}${winstreak}`
                }]
            };
            line.extra.push(...getInteractiveTags(data.urchin, data.seraph, data.player?.displayname || data.player?.name));
            sendChat(client, line);
        }

        async function resolveKnownPregameDenickForDodge(name, profile) {
            if (profile?.pregameKnownDenick) {
                announceKnownPregameDenickToParty(name, profile.pregameRealName);
                return { knownDenick: profile.pregameKnownDenick, dodgeProfile: profile };
            }
            if (!profile?.data?.isNicked) {
                return { knownDenick: null, dodgeProfile: profile };
            }

            // Saved identities were resolved above. Record newly detected
            // nicks here and allow a mapping found during detection to help Dodge.
            markNickedPlayer(name, 'pregame_chat');
            const knownDenick = getAutoDenickResult(name) || findKnownDenickByNick(name);
            const realName = String(knownDenick?.realName || knownDenick?.realIGN || '').trim();
            if (!realName) return { knownDenick: null, dodgeProfile: profile };

            announceKnownPregameDenickToParty(name, realName);

            // The nickname cannot appear in /p list, but its real IGN can.
            // Let Auto Dodge perform the same guard too; this early return also
            // avoids an unnecessary profile request for a current teammate.
            if (partyTracker.isTrackedMember(realName)) {
                return { knownDenick, dodgeProfile: profile };
            }

            const realProfile = await getPlayerData(realName, {
                includeErrors: true,
                preferCache: true
            });
            if (realProfile?.error || !realProfile?.data?.player) {
                return { knownDenick, dodgeProfile: profile };
            }

            // Retain the visible nick as the dodge target, but evaluate the
            // resolved account's tags and BedWars stats exactly like an
            // unnicked player.
            return {
                knownDenick,
                dodgeProfile: {
                    ...realProfile,
                    data: { ...realProfile.data, isNicked: false }
                }
            };
        }

        const lookupPregameIdentity = createPregameIdentityLookup({
            lookupNick: name => getPlayerDataWithNickDetection(name, { preferCache: true }),
            lookupReal: name => getPlayerData(name, { includeErrors: true, preferCache: true }),
            getKnownDenick: findKnownDenickByNick,
            getRosterUuid: name => {
                const key = nickKey(name);
                for (const [visibleName, info] of lobbyPlayers) {
                    if (nickKey(visibleName) === key && info?.inTab !== false) return info?.uuid;
                }
                return null;
            },
            isDetectedNick: isDetectedNickedPlayer,
            makeFallback: makeFallbackPlayerProfile
        });

        async function addBedwarsPregameChatPlayer(name) {
            const target = String(name || '').trim();
            if (!pregameChatStatsEnabled || !bedwarsPregameActive || gameActive) return false;
            if (!isValidPlayerName(target) || isOwnPlayerName(target) || isBedwarsPregameIgnoredSender(target)) return false;

            const playerKey = nickKey(target);
            if (pregameChatSeenPlayers.has(playerKey) || pregameChatLookupsInFlight.has(playerKey)) return false;
            pregameChatSeenPlayers.add(playerKey);
            pregameChatLookupsInFlight.add(playerKey);
            const sessionId = bedwarsPregameSessionId;
            const overlayKey = `BEDWARS:${playerKey}`;

            if (!overlayContainsPlayer(target, 'BEDWARS')) {
                manualOverlayPlayers.set(overlayKey, {
                    ...buildOverlayPlaceholderPlayer(target),
                    name: target,
                    mode: 'BEDWARS',
                    manual: true,
                    pregameChat: true,
                    rowSource: 'pregame',
                    source: 'pregame_chat',
                    manualAddedAt: Date.now()
                });
            }

            try {
                const lookupPromise = lookupPregameIdentity(target);
                pregameChatLookupPromises.set(playerKey, lookupPromise);
                const profile = await lookupPromise;
                if (sessionId !== bedwarsPregameSessionId || !bedwarsPregameActive || gameActive) return true;
                if (profile?.data?.player && !profile.data.lookupFailed && !profile.data.isNicked && !profile.pregameRealName) {
                    pregameChatPlayerProfiles.set(playerKey, {
                        profile,
                        timestamp: Date.now()
                    });
                }

                const { knownDenick, dodgeProfile } = await resolveKnownPregameDenickForDodge(target, profile);
                if (sessionId !== bedwarsPregameSessionId || !bedwarsPregameActive || gameActive) return true;

                const row = rememberOverlayPlayer(target, profile, {
                    mode: 'BEDWARS',
                    source: 'pregame_chat',
                    info: lobbyPlayers.get(target) || {},
                    denickResult: profile?.pregameKnownDenick
                });

                if (sessionId !== bedwarsPregameSessionId || !bedwarsPregameActive || gameActive) return true;
                manualOverlayPlayers.set(overlayKey, {
                    ...(row || buildOverlayPlayerRow(target, profile, { mode: 'BEDWARS', source: 'pregame_chat' })),
                    name: row?.name || target,
                    mode: 'BEDWARS',
                    manual: true,
                    pregameChat: true,
                    rowSource: 'pregame',
                    source: 'pregame_chat',
                    manualAddedAt: Date.now()
                });
                renderPregameChatPlayerStats(target, profile);
                autoDodger.maybeSchedule(target, dodgeProfile, { knownDenick });
                return true;
            } catch (error) {
                if (sessionId === bedwarsPregameSessionId && bedwarsPregameActive && !gameActive && !hidePregamePartyMember(target)) {
                    sendChat(client, `§b§lPregame §8» §6[FAIL] §f${target} §7- §c${error.message || 'Stats lookup failed'}`);
                }
                return false;
            } finally {
                pregameChatLookupsInFlight.delete(playerKey);
                pregameChatLookupPromises.delete(playerKey);
            }
        }

        function observeBedwarsPregameChat(text) {
            if (!pregameChatStatsEnabled || !bedwarsPregameActive || gameActive) return;
            const parsed = parseBedwarsPregameChat(text);
            if (!parsed || isOwnPlayerName(parsed.sender)) return;
            addBedwarsPregameChatPlayer(parsed.sender).catch(() => {});
        }

        function makeAutoDodgeTestProfile(name) {
            return {
                data: {
                    lookupFailed: false,
                    isNicked: false,
                    player: {
                        displayname: name,
                        uuid: '00000000000000000000000000000000',
                        achievements: { bedwars_level: 999 },
                        stats: { Bedwars: {} }
                    },
                    urchin: { tag: 'AutoDodgeTest' },
                    seraph: { tagged: false }
                }
            };
        }

        function handleAutoDodgeTestCommand(args) {
            const scoreboardText = getCurrentScoreboardText();
            updateDetectedStateFromScoreboard();
            if (bedwarsPregameActive) autoDodger.noteScoreboard(scoreboardText);

            if (!bedwarsPregameActive || gameActive) {
                sendChat(client, '§b§lDodge Test §8» §cRun this in a BedWars pregame lobby.');
                return;
            }
            if (!autoDodgeEnabled) {
                sendChat(client, '§b§lDodge Test §8» §cAuto-dodge is OFF. Use §e/dodge on §cfirst.');
                return;
            }
            if (autoDodger.getDebugState().pendingDodge !== 'none') {
                sendChat(client, '§b§lDodge Test §8» §7A dodge is already pending. Use §e/dodge cancel §7to clear it.');
                return;
            }

            const firstArg = String(args[1] || '').trim();
            const firstArgIsName = isValidPlayerName(firstArg);
            if (firstArgIsName && isOwnPlayerName(firstArg)) {
                sendChat(client, '§b§lDodge Test §8» §cUse a fake or enemy player name, not your own name.');
                return;
            }

            const fakeName = firstArgIsName ? firstArg : 'DodgeTester';
            const message = args.slice(firstArgIsName ? 2 : 1).join(' ').trim() || 'testing auto dodge';
            const fakeLine = `${fakeName}: ${message}`;
            const parsed = parseBedwarsPregameChat(fakeLine);
            if (!parsed) {
                sendChat(client, '§b§lDodge Test §8» §cCould not build a valid fake pregame chat line.');
                return;
            }

            sendChat(client, `§7${fakeLine}`);
            autoDodger.maybeSchedule(parsed.sender, makeAutoDodgeTestProfile(parsed.sender));
        }

        async function addChatTriggerOverlayPlayer(name, trigger, options = {}) {
            const target = String(name || '').trim();
            const triggerText = String(trigger || '').trim();
            if (!isValidPlayerName(target) || isOwnPlayerName(target) || !triggerText) {
                return socialOverlayDetails(options, false);
            }
            // /lf triggers are their own opt-in and do not follow Use Overlay.
            if (!options.lookingFor && !canAutoAddSocialOverlayPlayer('trigger')) return socialOverlayDetails(options, false);
            // Only insert overlay rows while the overlay UI is on screen; a chat
            // annotation caller (returnDetails) still needs the row for the chat line.
            const insertRow = isOverlayUiActive();
            if (!insertRow && !options?.returnDetails) return socialOverlayDetails(options, false);
            const mode = getSocialOverlayMode();
            if (overlayContainsPlayer(target, mode)) {
                return socialOverlayDetails(options, false, existingSocialOverlayRow(target, mode));
            }

            const key = `${mode}:${nickKey(target)}`;
            if (insertRow) manualOverlayPlayers.set(key, {
                ...buildOverlayPlaceholderPlayer(target),
                name: target,
                mode,
                manual: true,
                chatTrigger: true,
                triggerWord: triggerText,
                rowSource: 'chatTrigger',
                source: 'chat_trigger',
                manualAddedAt: Date.now()
            });

            try {
                // /lf shares the scan queue's pacing gate, rather than starting
                // a separate background cadence alongside an active scan.
                const row = await getOverlayPlayerData(target, mode, 'chat_trigger', {
                    apiPriority: options.lookingFor ? 'game' : undefined,
                    preferCache: true
                });
                if (!row) return socialOverlayDetails(options, insertRow);
                if (!insertRow) return socialOverlayDetails(options, false, row);

                manualOverlayPlayers.set(key, {
                    ...row,
                    name: row.name || target,
                    mode,
                    manual: true,
                    chatTrigger: true,
                    triggerWord: triggerText,
                    rowSource: 'chatTrigger',
                    source: 'chat_trigger',
                    manualAddedAt: Date.now()
                });
                return socialOverlayDetails(options, true, manualOverlayPlayers.get(key));
            } catch (e) {
                return socialOverlayDetails(options, insertRow);
            }
        }

        function observeChatTriggersForOverlay(text) {
            const parsed = parseChatSenderAndMessage(text);
            if (!parsed) return;
            // While /lf is on, only its mode words count; saved triggers are muted.
            const lookingFor = lookingForTriggers.isActive();
            const trigger = lookingFor
                ? lookingForTriggers.match(parsed.message)
                : chatTriggerManager.findMatching(parsed.message);
            if (!trigger) return;
            addChatTriggerOverlayPlayer(parsed.sender, trigger, { lookingFor }).catch(() => {});
        }

        function isInBedwarsMainLobby(scoreboardText) {
            return !gameActive
                && !bedwarsPregameActive
                && detectLobbyModeScoreboard(scoreboardText) === 'BEDWARS';
        }

        const LF_CHAT_PREFIX = '§6§lFury §8» ';

        function formatLfLabels(labels) {
            return labels.map(label => `§b${label}`).join('§7, ');
        }

        // While /lf is on, the action bar belongs to /lf: Hypixel's own action
        // bar packets are dropped and this animation is redrawn every frame.
        let lfActionBarTimer = null;
        let lfActionBarFrame = 0;

        function syncLookingForActionBar() {
            const state = lookingForTriggers.getState();
            if (!state) {
                if (!lfActionBarTimer) return;
                clearInterval(lfActionBarTimer);
                lfActionBarTimer = null;
                sendActionBar(client, '');
                return;
            }
            if (lfActionBarTimer) return;
            lfActionBarFrame = 0;
            const draw = () => {
                const current = lookingForTriggers.getState();
                if (!current) return syncLookingForActionBar();
                sendActionBar(client, formatLfActionBar(current.labels, lfActionBarFrame));
                lfActionBarFrame += 1;
            };
            draw();
            lfActionBarTimer = setInterval(draw, LF_ACTION_BAR_FRAME_MS);
        }

        function stopLookingForActionBar() {
            if (lfActionBarTimer) clearInterval(lfActionBarTimer);
            lfActionBarTimer = null;
        }

        // Automatic stops (lobby change, pregame, game) stay silent; only /lf off confirms.
        function stopLookingFor(reason, { announce = false } = {}) {
            const previous = lookingForTriggers.stop();
            syncLookingForActionBar();
            if (!previous || !announce) return;
            sendChat(client, `${LF_CHAT_PREFIX}§7Looking for ${formatLfLabels(previous.labels)} §7is now §coff§7.`);
        }

        function parseLfModes(tokens) {
            const modes = [];
            const unknown = [];
            tokens.join(' ').split(/[\s,]+/).filter(Boolean).forEach((token) => {
                const mode = resolveLfMode(token);
                if (!mode) unknown.push(token);
                else if (!modes.includes(mode)) modes.push(mode);
            });
            return { modes, unknown };
        }

        function handleLookingForCommand(args) {
            const modeList = LF_MODES.map(mode => `§b${mode.short}`).join('§8|');
            const usage = `${LF_CHAT_PREFIX}§7Usage: §e/lf §8<${modeList}§8> §7[more modes] §8· §e/lf off §7[mode]`;
            const sub = String(args[1] || '').toLowerCase();
            if (!sub || sub === 'status') {
                const state = lookingForTriggers.getState();
                sendChat(client, state
                    ? `${LF_CHAT_PREFIX}§7Looking for ${formatLfLabels(state.labels)} §7in lobby §f${state.lobbyId}§7.`
                    : usage);
                return;
            }
            if (['off', 'stop', 'disable', 'remove'].includes(sub)) {
                if (!lookingForTriggers.isActive()) {
                    sendChat(client, `${LF_CHAT_PREFIX}§7Looking for is already §coff§7.`);
                    return;
                }
                if (args.length <= 2) {
                    stopLookingFor('turned off', { announce: true });
                    return;
                }
                const { modes, unknown } = parseLfModes(args.slice(2));
                if (unknown.length || !modes.length) {
                    sendChat(client, usage);
                    return;
                }
                const removed = lookingForTriggers.remove(modes);
                const state = lookingForTriggers.getState();
                syncLookingForActionBar();
                if (!removed.length) {
                    sendChat(client, `${LF_CHAT_PREFIX}§7None of those modes were on.`);
                } else {
                    sendChat(client, `${LF_CHAT_PREFIX}§7Looking for ${formatLfLabels(removed)} §7is now §coff§7.`
                        + (state ? ` Still on: ${formatLfLabels(state.labels)}§7.` : ''));
                }
                return;
            }
            const { modes, unknown } = parseLfModes(args.slice(1));
            if (unknown.length || !modes.length) {
                sendChat(client, usage);
                return;
            }
            const scoreboardText = getCurrentScoreboardText();
            if (!isInBedwarsMainLobby(scoreboardText)) {
                sendChat(client, `${LF_CHAT_PREFIX}§cYou can only use §e/lf §cin a Bed Wars lobby.`);
                return;
            }
            const lobbyId = pregameLobbyIdForScoreboard(scoreboardText);
            if (!lobbyId) {
                sendChat(client, `${LF_CHAT_PREFIX}§cCould not read the lobby ID yet. Try again in a moment.`);
                return;
            }
            const { added } = lookingForTriggers.add(modes, lobbyId);
            const state = lookingForTriggers.getState();
            syncLookingForActionBar();
            sendChat(client, added.length
                ? `${LF_CHAT_PREFIX}§7Started looking for ${formatLfLabels(added)}§7.`
                    + (state.labels.length > added.length ? ` Now on: ${formatLfLabels(state.labels)}§7.` : '')
                : `${LF_CHAT_PREFIX}§7Already looking for ${formatLfLabels(state.labels)}§7.`);
        }

        async function addMentionOverlayPlayer(name, options = {}) {
            const target = String(name || '').trim();
            if (!isValidPlayerName(target) || isOwnPlayerName(target)) {
                return socialOverlayDetails(options, false);
            }
            if (!canAutoAddSocialOverlayPlayer('mention')) return socialOverlayDetails(options, false);
            const insertRow = isOverlayUiActive();
            if (!insertRow && !options?.returnDetails) return socialOverlayDetails(options, false);
            const mode = getSocialOverlayMode();
            if (overlayContainsPlayer(target, mode)) {
                return socialOverlayDetails(options, false, existingSocialOverlayRow(target, mode));
            }

            const key = `${mode}:${nickKey(target)}`;
            if (insertRow) manualOverlayPlayers.set(key, {
                ...buildOverlayPlaceholderPlayer(target),
                name: target,
                mode,
                manual: true,
                mention: true,
                rowSource: 'mention',
                source: 'mention',
                manualAddedAt: Date.now()
            });

            try {
                const row = await getOverlayPlayerData(target, mode, 'mention');
                if (!row) return socialOverlayDetails(options, insertRow);
                if (!insertRow) return socialOverlayDetails(options, false, row);

                manualOverlayPlayers.set(key, {
                    ...row,
                    name: row.name || target,
                    mode,
                    manual: true,
                    mention: true,
                    rowSource: 'mention',
                    source: 'mention',
                    manualAddedAt: Date.now()
                });
                return socialOverlayDetails(options, true, manualOverlayPlayers.get(key));
            } catch (e) {
                return socialOverlayDetails(options, insertRow);
            }
        }

        async function addPartyInviteOverlayPlayer(name) {
            const target = String(name || '').trim();
            if (!isValidPlayerName(target) || isOwnPlayerName(target)) return false;
            if (!canAutoAddSocialOverlayPlayer('party')) return false;
            if (!isOverlayUiActive()) return false;
            const mode = getSocialOverlayMode();
            if (overlayContainsPlayer(target, mode)) return false;

            const key = `${mode}:${nickKey(target)}`;
            manualOverlayPlayers.set(key, {
                ...buildOverlayPlaceholderPlayer(target),
                name: target,
                mode,
                manual: true,
                partyInvite: true,
                rowSource: 'party',
                source: 'party_invite',
                manualAddedAt: Date.now()
            });

            try {
                const row = await getOverlayPlayerData(target, mode, 'party_invite');
                if (!row) return true;

                manualOverlayPlayers.set(key, {
                    ...row,
                    name: row.name || target,
                    mode,
                    manual: true,
                    partyInvite: true,
                    rowSource: 'party',
                    source: 'party_invite',
                    manualAddedAt: Date.now()
                });
                return true;
            } catch (e) {
                return true;
            }
        }

        async function addDirectMessageOverlayPlayer(name, options = {}) {
            const target = String(name || '').trim();
            if (!isValidPlayerName(target) || isOwnPlayerName(target)) {
                return socialOverlayDetails(options, false);
            }
            if (!canAutoAddSocialOverlayPlayer('dm')) return socialOverlayDetails(options, false);
            const insertRow = isOverlayUiActive();
            if (!insertRow && !options?.returnDetails) return socialOverlayDetails(options, false);
            const mode = getSocialOverlayMode();
            if (overlayContainsPlayer(target, mode)) {
                return socialOverlayDetails(options, false, existingSocialOverlayRow(target, mode));
            }

            const key = `${mode}:${nickKey(target)}`;
            if (insertRow) manualOverlayPlayers.set(key, {
                ...buildOverlayPlaceholderPlayer(target),
                name: target,
                mode,
                manual: true,
                directMessage: true,
                rowSource: 'dm',
                source: 'direct_message',
                manualAddedAt: Date.now()
            });

            try {
                const row = await getOverlayPlayerData(target, mode, 'direct_message');
                if (!row) return socialOverlayDetails(options, insertRow);
                if (!insertRow) return socialOverlayDetails(options, false, row);

                manualOverlayPlayers.set(key, {
                    ...row,
                    name: row.name || target,
                    mode,
                    manual: true,
                    directMessage: true,
                    rowSource: 'dm',
                    source: 'direct_message',
                    manualAddedAt: Date.now()
                });
                return socialOverlayDetails(options, true, manualOverlayPlayers.get(key));
            } catch (e) {
                return socialOverlayDetails(options, insertRow);
            }
        }

        function parsePartyInviteSender(text) {
            const clean = stripAnsi(text || '').replace(/\s+/g, ' ').trim();
            const match = clean.match(/(?:^|\s)(?:\[[^\]]+\]\s*)?([A-Za-z0-9_]{3,16})\s+has invited you to join their party!?/i);
            const sender = match?.[1];
            if (!isValidPlayerName(sender) || isOwnPlayerName(sender)) return null;
            return sender;
        }

        function observePartyInviteForOverlay(text) {
            const sender = parsePartyInviteSender(text);
            if (!sender) return;
            addPartyInviteOverlayPlayer(sender).catch(() => {});
        }

        function parseDirectMessageSender(text) {
            const clean = stripAnsi(text || '').replace(/\s+/g, ' ').trim();
            const match = clean.match(/^From\s+(?:\[[^\]]+\]\s*)?([A-Za-z0-9_]{3,16})\s*:/i);
            const sender = match?.[1];
            if (!isValidPlayerName(sender) || isOwnPlayerName(sender)) return null;
            return sender;
        }

        function observeDirectMessageForOverlay(text) {
            const sender = parseDirectMessageSender(text);
            if (!sender) return;
            addDirectMessageOverlayPlayer(sender).catch(() => {});
        }

        function parseChatMentionSender(text) {
            seedOwnIdentity();
            const clean = stripAnsi(text || '').replace(/\s+/g, ' ').trim();
            if (/^From\s+/i.test(clean)) return null;
            if (!clean || clean.startsWith('[') && !clean.includes(':')) return null;
            const colonIndex = clean.indexOf(':');
            if (colonIndex <= 0) return null;

            const left = clean.slice(0, colonIndex);
            const message = clean.slice(colonIndex + 1);
            const ownNames = getOwnKnownNames();
            if (!mentionsOwnName(message, ownNames)) {
                return null;
            }

            const matches = left.match(/[A-Za-z0-9_]{3,16}/g) || [];
            const sender = matches.reverse().find(name => !isChatSenderTokenBlocked(name));
            if (!isValidPlayerName(sender) || isOwnPlayerName(sender)) return null;
            return sender;
        }

        function observeChatMentionForOverlay(text) {
            const sender = parseChatMentionSender(text);
            if (!sender) return;
            addMentionOverlayPlayer(sender).catch(() => {});
        }

        function classifySocialOverlayMessage(text) {
            seedOwnIdentity();
            const lookingFor = lookingForTriggers.isActive();
            let lfDetails = null;
            const match = classifySocialOverlayText(text, {
                triggers: chatTriggerManager.getTriggers(),
                matchTrigger: lookingFor
                    ? (message) => {
                        lfDetails = lookingForTriggers.matchDetails(message);
                        return lfDetails?.trigger || null;
                    }
                    : null,
                ownNames: getOwnKnownNames(),
                blockedSenderTokens: Array.from(CHAT_SENDER_TOKEN_BLOCKLIST)
            });
            if (match?.type === 'trigger' && lookingFor) {
                match.lookingFor = true;
                // Only worth labelling which mode an ad is for when several are on.
                if (lookingForTriggers.getState().modeKeys.length >= 2) match.lfModes = lfDetails?.modes || [];
            }
            return match;
        }

        function addClassifiedSocialOverlayPlayer(match, options = {}) {
            if (!match) return Promise.resolve(socialOverlayDetails(options, false));
            if (match.type === 'dm') return addDirectMessageOverlayPlayer(match.sender, options);
            if (match.type === 'mention') return addMentionOverlayPlayer(match.sender, options);
            if (match.type === 'trigger') {
                return addChatTriggerOverlayPlayer(match.sender, match.trigger, { ...options, lookingFor: Boolean(match.lookingFor) });
            }
            return Promise.resolve(socialOverlayDetails(options, false));
        }

        // A row is "resolved" once it carries a definitive verdict we can print:
        // a lookup failure, a nick, or real stats. A bare placeholder (empty stats,
        // not nicked/failed) is still loading and must not be rendered as-is.
        function isResolvedLobbyChatStatsRow(row) {
            if (!row) return false;
            if (row.lookupFailed || row.isNicked) return true;
            return Number.isFinite(Number(row?.stats?.fkdr));
        }

        // Returns true when a Lobby stat line was actually printed for this player.
        function renderLobbyChatPlayerStats(name, row, { lookingFor = false, lfModes = null } = {}) {
            if (!row || (!lobbyChatStatsEnabled && !lookingFor)) return false;
            const modeTag = lfModes?.length ? ` §8§l[${lfModes.join('/')}]` : '';
            if (row.lookupFailed) {
                sendChat(client, `§e§lLobby §8» §6[FAIL] §f${name} §7- §c${row.lookupErrorMessage || 'Hypixel API lookup failed'}${modeTag}`);
                return true;
            }
            if (row.isNicked) {
                sendChat(client, `§e§lLobby §8» ${formatNametagNick()} §f${name}${modeTag}`);
                return true;
            }

            const stats = row.stats || {};
            const fkdr = Number(stats.fkdr);
            if (!Number.isFinite(fkdr)) {
                sendChat(client, `§e§lLobby §8» §7[NO STATS] §f${row.rankedName || name}${modeTag}`);
                return true;
            }
            const wlr = numberOr(stats.wlr, 0);
            const winstreak = numberOr(stats.ws, 0);
            const averagePing = numberOr(row.avgPing, -1);
            const ping = averagePing >= 0 ? averagePing : numberOr(row.ping, -1);
            const prestige = stats.starsLegacy || formatBedwarsPrestige(numberOr(stats.stars, 0));
            const nameText = `§e§lLobby §8» ${prestige} ${row.rankNameColorCode || '§f'}${row.rankedName || name}`;
            const statsText = ` §8(${getPingColor(ping)}${Math.round(ping)}ms§8)`
                + ` §7| §fFKDR: ${getFkdrColor(fkdr)}${fkdr.toFixed(2)}`
                + ` §7| §fWLR: ${getWlrColor(wlr)}${wlr.toFixed(2)}`
                + ` §7| §fWS: ${getWsColor(winstreak)}${winstreak}`;
            // Tags render as hoverable/clickable components: hover shows the
            // tag details (reasons, who added it, when), click runs the full
            // /urchin or /seraph lookup for the player.
            const tagComponents = buildOverlayTagComponents(row.tags, { clickName: name });
            if (tagComponents.length === 0) {
                sendChat(client, nameText + statsText + modeTag);
                return true;
            }
            const extra = [];
            tagComponents.forEach((comp, index) => {
                extra.push({ text: ' ' });
                extra.push(comp);
            });
            extra.push({ text: statsText + modeTag });
            sendChat(client, { text: nameText, extra });
            return true;
        }

        async function getLobbyChatStatsRow(match) {
            const mode = getSocialOverlayMode();
            const result = await addClassifiedSocialOverlayPlayer(match, { returnDetails: true });
            const row = result?.row || existingSocialOverlayRow(match.sender, mode);
            // Only trust an existing/overlay row if it is already resolved; a bare
            // placeholder still loading would otherwise render as a false [NO STATS].
            if (isResolvedLobbyChatStatsRow(row)) return row;

            const profile = await getPlayerDataWithNickDetection(match.sender, {
                preferCache: true,
                apiPriority: match.lookingFor ? 'game' : undefined
            });
            return buildOverlayPlayerRow(match.sender, profile, {
                mode,
                source: `lobby_chat_${normalizeLobbyChatStatsSource(match.type) || 'chat'}`,
                info: lobbyPlayers.get(match.sender) || {},
                denickResult: getAutoDenickResult(match.sender)
            }) || row;
        }

        function pruneLobbyChatStatsQueue(now = Date.now()) {
            lobbyChatStatsQueue = lobbyChatStatsQueue.filter((item) => {
                const fresh = now - item.at <= LOBBY_CHAT_STATS_QUEUE_TTL_MS;
                if (!fresh) lobbyChatStatsQueuedPlayers.delete(item.playerKey);
                return fresh;
            });
        }

        function scheduleLobbyChatStatsQueue(delayMs = 0) {
            if (lobbyChatStatsQueueTimer) return;
            lobbyChatStatsQueueTimer = setTimeout(() => {
                lobbyChatStatsQueueTimer = null;
                processLobbyChatStatsQueue().catch(() => {});
            }, Math.max(0, delayMs));
        }

        function enqueueLobbyChatStatsMatch(match) {
            const playerKey = nickKey(match.sender);
            if (lobbyChatStatsShownPlayers.has(playerKey) || lobbyChatStatsQueuedPlayers.has(playerKey)) return;
            while (lobbyChatStatsQueue.length >= LOBBY_CHAT_STATS_QUEUE_MAX) {
                const dropped = lobbyChatStatsQueue.shift();
                if (dropped?.playerKey) lobbyChatStatsQueuedPlayers.delete(dropped.playerKey);
            }
            lobbyChatStatsQueue.push({ match, playerKey, at: Date.now() });
            lobbyChatStatsQueuedPlayers.add(playerKey);
            scheduleLobbyChatStatsQueue(0);
        }

        async function processLobbyChatStatsQueue() {
            if (lobbyChatStatsProcessing) return;
            pruneLobbyChatStatsQueue();
            if (!lobbyChatStatsQueue.length) return;
            if (isProxyAutoThrottleActive() || detectedGameStateLabel() !== 'LOBBY') {
                scheduleLobbyChatStatsQueue(LOBBY_CHAT_STATS_QUEUE_RETRY_MS);
                return;
            }

            const item = lobbyChatStatsQueue.shift();
            if (!item) return;
            lobbyChatStatsQueuedPlayers.delete(item.playerKey);
            if (Date.now() - item.at > LOBBY_CHAT_STATS_QUEUE_TTL_MS || lobbyChatStatsShownPlayers.has(item.playerKey)) {
                scheduleLobbyChatStatsQueue(0);
                return;
            }

            lobbyChatStatsProcessing = true;
            lobbyChatStatsShownPlayers.add(item.playerKey);
            try {
                const row = await getLobbyChatStatsRow(item.match);
                if (!renderLobbyChatPlayerStats(item.match.sender, row, {
                    lookingFor: Boolean(item.match.lookingFor),
                    lfModes: item.match.lfModes
                })) {
                    lobbyChatStatsShownPlayers.delete(item.playerKey);
                } else if (item.match.lookingFor && lookingForTriggers.shouldAlert(item.match.sender)) {
                    playSelfSound({ name: 'note.pling', volume: 1, pitch: 90 });
                }
            } catch (error) {
                lobbyChatStatsShownPlayers.delete(item.playerKey);
            } finally {
                lobbyChatStatsProcessing = false;
                if (lobbyChatStatsQueue.length) scheduleLobbyChatStatsQueue(0);
            }
        }

        function observeLobbyChatStatsMessage(packet) {
            let message;
            try {
                message = JSON.parse(packet.message);
            } catch (error) {
                return;
            }
            const match = classifySocialOverlayMessage(extractText(message));
            if (!match || !isLobbyChatAnnotationEligible({
                stateLabel: 'LOBBY',
                position: packet?.position || 0,
                // /lf is an explicit request, so it ignores the Chat Stats toggles.
                annotationEnabled: lobbyChatStatsEnabled || match.lookingFor,
                socialEnabled: true,
                sourceEnabled: match.lookingFor || canShowLobbyChatStatsForSource(match.type)
            })) return;

            enqueueLobbyChatStatsMatch(match);
        }

        function removeManualOverlayPlayer(name, mode = currentGamemode || 'BEDWARS') {
            const normalizedMode = isSupportedTabStatsMode(mode) ? mode : 'BEDWARS';
            const key = `${normalizedMode}:${nickKey(name)}`;
            return manualOverlayPlayers.delete(key);
        }

        function clearOverlayStatsTimers() {
            overlayStatsTimers.forEach(timer => clearTimeout(timer));
            overlayStatsTimers.clear();
        }

        async function updateOverlayStatsForPlayer(name, sessionId = gameSessionId) {
            if (isProxyAutoThrottleActive()) return;
            if (isDenickAliasDuplicate(name)) return cleanupDenickAliasDuplicate(name, 'overlay_stats_alias');
            if (sessionId !== gameSessionId || !gameActive || !isSupportedTabStatsMode(currentGamemode) || !gameRoster.has(name) || !isEligibleForCurrentGameRoster(name)) return;

            const mode = currentGamemode;
            applyKnownDenickFromHistory(name, 'overlay_history', { queueUpdates: false });
            const knownDenickResult = getAutoDenickResult(name);
            const urchinOverride = tabStatsUrchinOverrides.get(playerLookupKey(name)) || cachedUrchinBatchData(name) || null;
            const profile = await getStatsProfileForRosterPlayer(name, {
                denickResult: knownDenickResult,
                lookup: { urchinOverride }
            });
            if (sessionId !== gameSessionId || currentGamemode !== mode || !gameRoster.has(name) || !isEligibleForCurrentGameRoster(name)) return;

            if (profile?.data?.isNicked) markNickedPlayer(name, 'overlay');
            if (profile?.data?.player && !profile.data.isNicked && !profile.data.lookupFailed) {
                rememberPlayerActiveCosmetics(name, profile.data, 'overlay');
            }

            const denickResult = getAutoDenickResult(name);
            let displayProfile = profile;
            if (denickResult?.realName) {
                const realProfile = await getPlayerData(denickResult.realName, { includeErrors: true });
                if (realProfile?.data?.player && !realProfile.error) {
                    displayProfile = realProfile;
                    rememberPlayerActiveCosmetics(name, realProfile.data, 'denick_overlay');
                    rememberPlayerActiveCosmetics(denickResult.realName, realProfile.data, 'denick_overlay');
                }
            }

            if (sessionId !== gameSessionId || currentGamemode !== mode || !gameRoster.has(name) || !isEligibleForCurrentGameRoster(name)) return;
            rememberOverlayPlayer(name, displayProfile, {
                mode,
                source: denickResult?.realName ? 'denick_overlay' : 'overlay',
                info: lobbyPlayers.get(name) || {},
                denickResult
            });
        }

        function queueOverlayStatsUpdate(name, delay = 0) {
            if (!gameActive || !isSupportedTabStatsMode(currentGamemode) || !gameRoster.has(name) || !isEligibleForCurrentGameRoster(name)) return;
            if (overlayStatsTimers.has(name)) clearTimeout(overlayStatsTimers.get(name));
            const sessionId = gameSessionId;
            const timer = setTimeout(() => {
                overlayStatsTimers.delete(name);
                updateOverlayStatsForPlayer(name, sessionId).catch((e) => console.error(`[Overlay] ${name}:`, e.message));
            }, delay);
            overlayStatsTimers.set(name, timer);
        }

        function refreshOverlayStatsForRoster() {
            if (!gameActive || !isSupportedTabStatsMode(currentGamemode)) return;
            seedGameRoster();
            Array.from(gameRoster).slice(0, 40).forEach((name, index) => {
                queueOverlayStatsUpdate(name, index * 220);
            });
        }

        function buildLiveGameState() {
            return {
                connected: true,
                account: client.username,
                gameActive,
                bedwarsPregameActive,
                pregameChatPlayerCount: pregameChatSeenPlayers.size,
                currentGamemode,
                gameStartTime,
                gameSessionId,
                myTeam,
                rosterCount: gameRoster.size,
                lobbyCount: lobbyPlayers.size,
                tabStatsActive: isTabStatsActiveInGame(),
                scanActive: isScanActiveInGame(),
                scanInProgress,
                scanMode: state.scanMode,
                lastScan: lastScanSummary,
                overlayPlayers: buildOverlayRosterSnapshot(),
                detectedNickedPlayers: Array.from(detectedNickedPlayers.values()).map(info => ({
                    name: info.name,
                    source: info.source || '',
                    at: info.at || null
                })).slice(-32),
                denickedPlayers: Array.from(autoDenickResults.values())
                    .filter(result => result?.realName)
                    .map(summarizeDenickResult)
                    .slice(-32),
                pendingAutoDenicks: Array.from(autoDenickStats.values()).map(observed => ({
                    name: observed.name,
                    finals: observed.finals,
                    beds: observed.beds,
                    inFlight: Boolean(observed.inFlight),
                    done: Boolean(observed.done),
                    notNicked: Boolean(observed.notNicked),
                    updatedAt: observed.updatedAt || null
                })).slice(-32)
            };
        }

        if (activeUser?.client === client) activeUser.getLiveGameState = buildLiveGameState;
        if (activeUser?.client === client) {
            activeUser.getHypixelUsageGameState = () => ({
                gameActive,
                currentGamemode,
                gameSessionId,
                gameStartTime
            });
        }
        if (activeUser?.client === client) activeUser.getOverlayPlayerData = getOverlayPlayerData;
        if (activeUser?.client === client) activeUser.getAutoDenickResult = getAutoDenickResult;
        if (activeUser?.client === client) activeUser.removeManualOverlayPlayer = removeManualOverlayPlayer;
        if (activeUser?.client === client) activeUser.clearManualOverlayPlayersBySource = clearManualOverlayPlayersBySource;
        if (activeUser?.client === client) activeUser.suppressLiveOverlayRowsForCurrentGame = suppressLiveOverlayRowsForCurrentGame;

        function isCurrentGameSession(sessionId) {
            return sessionId === gameSessionId && isTabStatsActiveInGame();
        }

        function createDefaultTabSnapshot() {
            return {
                displayNames: new Map(),
                teams: new Map()
            };
        }

        function normalizeScoreboardTeamEntries(players = []) {
            if (!Array.isArray(players)) return [];
            return players
                .map(value => String(value ?? ''))
                .filter(value => value.length > 0);
        }

        function normalizeDefaultTeamPacket(data = {}) {
            const team = String(data.team || '');
            if (!team) return null;
            return {
                team,
                name: data.displayName ?? data.name ?? team,
                prefix: data.prefix || '',
                suffix: data.suffix || '',
                friendlyFire: data.friendlyFire ?? 0,
                nameTagVisibility: data.nameTagVisibility || 'always',
                color: data.color ?? -1,
                players: new Set(normalizeScoreboardTeamEntries(data.players))
            };
        }

        function updateDefaultTabTeamSnapshot(data = {}, modeId) {
            const team = String(data.team || '');
            if (!team) return;

            if (modeId === 1) {
                defaultTabSnapshot.teams.delete(team);
                return;
            }

            if (modeId === 0) {
                const next = normalizeDefaultTeamPacket(data);
                if (next) defaultTabSnapshot.teams.set(team, next);
                return;
            }

            const existing = defaultTabSnapshot.teams.get(team);

            if (modeId === 2) {
                const next = normalizeDefaultTeamPacket({
                    ...data,
                    players: existing ? Array.from(existing.players) : []
                });
                if (next) defaultTabSnapshot.teams.set(team, next);
                return;
            }

            if (!existing) return;

            if (modeId === 3 && Array.isArray(data.players)) {
                normalizeScoreboardTeamEntries(data.players).forEach(entry => existing.players.add(entry));
            }

            if (modeId === 4 && Array.isArray(data.players)) {
                normalizeScoreboardTeamEntries(data.players).forEach(entry => existing.players.delete(entry));
            }
        }

        function setDefaultTabDisplayName(uuid, displayName) {
            if (!uuid) return;
            defaultTabSnapshot.displayNames.set(uuid, displayName ?? null);
        }

        function serializePlayerInfo(player = {}) {
            return {
                ...player,
                sources: Array.from(player.sources instanceof Set ? player.sources : (player.sources || []))
            };
        }

        function hydratePlayerInfo(player = {}) {
            return {
                ...player,
                sources: new Set(player.sources || [])
            };
        }

        function serializeTeamInfo(teamInfo = {}) {
            return {
                ...teamInfo,
                players: Array.from(teamInfo.players instanceof Set ? teamInfo.players : (teamInfo.players || [])),
                rawTeamIds: Array.from(teamInfo.rawTeamIds instanceof Set ? teamInfo.rawTeamIds : (teamInfo.rawTeamIds || []))
            };
        }

        function hydrateTeamInfo(teamInfo = {}) {
            return {
                ...teamInfo,
                players: new Set(teamInfo.players || []),
                rawTeamIds: new Set(teamInfo.rawTeamIds || [])
            };
        }

        function getFreshLastMatchSnapshot(mode = null) {
            if (!lastMatchSnapshot) return null;
            if (lastMatchSnapshot.username !== client.username) return null;
            if (Date.now() - lastMatchSnapshot.at > LAST_MATCH_SNAPSHOT_TTL) return null;
            if (mode && lastMatchSnapshot.mode !== mode) return null;
            if (!isSupportedTabStatsMode(lastMatchSnapshot.mode)) return null;
            // Mode + TTL alone cannot tell "the game I dropped out of" from "a
            // different game of the same type". Restart the proxy and rejoin
            // quickly and the previous game's snapshot is still inside the
            // 20-minute window, so its team assignments get restored over the
            // new game — which is the wrong-team-colour-in-tab bug. When both
            // sides know their server id, they must agree.
            const liveServerId = pregameLobbyIdForScoreboard(getCurrentScoreboardText());
            if (liveServerId && lastMatchSnapshot.serverId && liveServerId !== lastMatchSnapshot.serverId) {
                return null;
            }
            if (!Array.isArray(lastMatchSnapshot.gameRoster) || lastMatchSnapshot.gameRoster.length === 0) return null;
            // Second opinion, for when neither side knows its server id. The
            // scoreboard teams Hypixel has already sent us on THIS connection
            // are the truth about the game in front of us; a snapshot that puts
            // those same players on different teams is from a different game,
            // and restoring it is what paints the wrong colour in tab.
            if (snapshotContradictsLiveTeams(lastMatchSnapshot)) return null;
            return lastMatchSnapshot;
        }

        // Compare only players BOTH sides place; silence is not disagreement,
        // because right after a reconnect the live registry is often still
        // empty and there is nothing to conclude from that. A single odd entry
        // is not enough either — one player can legitimately have moved teams
        // between the snapshot and now — so it takes a majority to reject.
        function snapshotContradictsLiveTeams(snapshot) {
            if (scoreboardTeamRegistry.size === 0) return false;

            let agree = 0;
            let disagree = 0;
            (snapshot.scoreboardTeams || []).forEach(([baseTeamName, teamInfo]) => {
                (teamInfo?.players || []).forEach(playerName => {
                    const live = findScoreboardTeamForPlayer(playerName);
                    if (!live) return;
                    if (live.baseTeamName === baseTeamName) agree += 1;
                    else disagree += 1;
                });
            });

            return disagree > agree;
        }

        function isOwnNameInLastMatchSnapshot(name) {
            if (!isValidPlayerName(name)) return false;
            const snapshot = getFreshLastMatchSnapshot();
            if (!snapshot) return false;
            const key = nickKey(name);
            if (key === nickKey(snapshot.username)) return true;
            return (snapshot.ownKnownNames || []).some(([storedKey, value]) => {
                return String(storedKey || '').toLowerCase() === key
                    || nickKey(value?.name) === key;
            });
        }

        function saveCurrentMatchSnapshot(reason = 'update') {
            if (matchSnapshotTimer) clearTimeout(matchSnapshotTimer);
            matchSnapshotTimer = null;
            pendingMatchSnapshotReason = '';
            if (!gameActive || !isSupportedTabStatsMode(currentGamemode) || gameRoster.size === 0) return;
            seedOwnIdentity();

            lastMatchSnapshot = {
                at: Date.now(),
                reason,
                username: client.username,
                mode: currentGamemode,
                // Hypixel's server id, shown on the sidebar next to the date.
                // This is what makes a snapshot identify ONE game rather than
                // "some game of this mode within the TTL" — see
                // getFreshLastMatchSnapshot.
                //
                // Taken from the value captured DURING the game, not read here:
                // the most important save is the one on match reset, and by then
                // the sidebar has usually moved on, so reading it at save time
                // stamped null and the guard silently did nothing.
                serverId: activeMatchServerId || pregameLobbyIdForScoreboard(getCurrentScoreboardText()) || null,
                myTeam,
                gameStartTime: gameStartTime || Date.now(),
                lobbyPlayers: Array.from(lobbyPlayers.entries()).map(([name, player]) => [name, serializePlayerInfo(player)]),
                scoreboardTeams: Array.from(scoreboardTeamRegistry.entries()).map(([name, teamInfo]) => [name, serializeTeamInfo(teamInfo)]),
                scoreboardAliases: Array.from(scoreboardTeamAliases.entries()),
                uuidMap: Array.from(uuidMap.entries()),
                ownKnownNames: getOwnKnownNameEntries(),
                ownUuidCandidates: getOwnUuidCandidates(),
                gameRoster: Array.from(gameRoster),
                gamePlayerNames: Array.from(currentGamePlayerNames.values()),
                gameTeams: Array.from(currentGameTeams.values()),
                sessionGameEvents: activeSessionGameEvents.slice(),
                sessionGameFinalized,
                sessionGameMetadata: activeSessionGameMetadata ? { ...activeSessionGameMetadata } : null,
                detectedNickedPlayers: Array.from(detectedNickedPlayers.entries()),
                nickCapablePlayers: Array.from(nickCapablePlayers.entries()),
                autoDenickStats: Array.from(autoDenickStats.entries()),
                autoDenickResults: Array.from(autoDenickResults.entries())
            };
        }

        function scheduleCurrentMatchSnapshot(reason = 'update', delay = 75) {
            pendingMatchSnapshotReason = reason;
            if (matchSnapshotTimer) clearTimeout(matchSnapshotTimer);
            matchSnapshotTimer = setTimeout(() => {
                matchSnapshotTimer = null;
                const nextReason = pendingMatchSnapshotReason || reason;
                pendingMatchSnapshotReason = '';
                saveCurrentMatchSnapshot(nextReason);
            }, delay);
        }

        function clearLastMatchSnapshot() {
            if (lastMatchSnapshot?.username === client.username) lastMatchSnapshot = null;
        }

        function restoreLastMatchSnapshot(reason = 'reconnect') {
            const snapshot = getFreshLastMatchSnapshot();
            if (!snapshot) return false;
            teamDebug.mark('snapshot_restore', {
                reason, fromSession: gameSessionId, snapshotAt: snapshot.at,
                snapshotServerId: snapshot.serverId, liveServerId: activeMatchServerId,
                teams: (snapshot.lobbyPlayers || []).slice(0, 128).map(([name, info]) => [name, info.team, info.rawTeam])
            });

            clearPendingAutoScan();
            scanInProgress = false;
            scanInProgressPromise = null;
            gameActive = true;
            presentAtGameStart = false;
            currentGamemode = snapshot.mode;
            // We only got here because the ids agree or one side never learned
            // one, so adopt whichever we know and keep refreshing from there.
            activeMatchServerId = pregameLobbyIdForScoreboard(getCurrentScoreboardText())
                || snapshot.serverId
                || null;
            myTeam = snapshot.myTeam || null;
            gameStartTime = snapshot.gameStartTime || Date.now();
            gameSessionId += 1;
            sessionGameFinalized = Boolean(snapshot.sessionGameFinalized);
            activeSessionGameEvents = Array.isArray(snapshot.sessionGameEvents)
                ? snapshot.sessionGameEvents.map(event => normalizeGameEvent(event, { startedAt: gameStartTime }))
                : [];
            activeSessionGameMetadata = {
                ...(snapshot.sessionGameMetadata || {}),
                serverId: activeMatchServerId,
                observedFromStart: false,
                disconnected: true
            };
            suppressedOverlayLiveSession = null;

            const now = Date.now();
            lobbyPlayers = new Map((snapshot.lobbyPlayers || []).map(([name, player]) => {
                const hydrated = hydratePlayerInfo(player);
                if ((snapshot.gameRoster || []).includes(name)) {
                    hydrated.inTab = true;
                    hydrated.leftTabAt = null;
                    hydrated.lastSeen = now;
                }
                return [name, hydrated];
            }));
            scoreboardTeamRegistry.clear();
            (snapshot.scoreboardTeams || []).forEach(([name, teamInfo]) => {
                scoreboardTeamRegistry.set(name, hydrateTeamInfo(teamInfo));
            });
            scoreboardTeamAliases.clear();
            (snapshot.scoreboardAliases || []).forEach(([alias, target]) => {
                scoreboardTeamAliases.set(alias, target);
            });
            uuidMap = new Map(snapshot.uuidMap || []);
            restoreOwnIdentitySnapshot({
                ownKnownNames: snapshot.ownKnownNames,
                ownUuidCandidates: snapshot.ownUuidCandidates
            });
            seedOwnIdentity();
            detectedNickedPlayers = new Map(snapshot.detectedNickedPlayers || []);
            // mvpPlusPlusPlayers is the pre-rename key: a snapshot written by
            // an older build still restores instead of starting empty.
            nickCapablePlayers = new Map(snapshot.nickCapablePlayers || snapshot.mvpPlusPlusPlayers || []);
            autoDenickStats = new Map(snapshot.autoDenickStats || []);
            // Refill in place: denickTracker (getAutoDenickResult) holds this
            // Map, so a new one would leave the restored denicks unread.
            autoDenickResults.clear();
            (snapshot.autoDenickResults || []).forEach(([key, result]) => autoDenickResults.set(key, result));
            gameRoster = new Set((snapshot.gameRoster || []).filter(name => lobbyPlayers.has(name)));
            currentGamePlayerNames = new Map(
                (snapshot.gamePlayerNames || snapshot.gameRoster || [])
                    .filter(isValidPlayerName)
                    .map(name => [nickKey(name), name])
            );
            currentGameTeams = new Map(
                (Array.isArray(snapshot.gameTeams) ? snapshot.gameTeams : [])
                    .filter(entry => isValidPlayerName(entry?.name) && entry?.team)
                    .map(entry => [nickKey(entry.name), { name: entry.name, team: entry.team }])
            );
            autoDenickResults.forEach(result => {
                if (result?.nick && result?.realName) rememberCurrentGameDenickNames(result.nick, result.realName);
            });

            if (gameRoster.size === 0) return false;

            saveCurrentMatchSnapshot(reason);
            refreshTabStatsForRoster();
            syncBedwarsClientTeams();
            gameRoster.forEach(name => {
                if (isDetectedNickedPlayer(name)) queueAutoSkinDenick(name, 'restore');
            });
            const restoredSessionId = gameSessionId;
            [900, 2200, 4200].forEach(delay => {
                setTimeout(() => {
                    if (restoredSessionId !== gameSessionId || !isScanActiveInGame()) return;
                    seedGameRoster();
                    refreshTabStatsForRoster();
                    syncBedwarsClientTeams();
                }, delay);
            });
            scheduleAutoScan(1200);
            return true;
        }

        function clearPendingAutoScan() {
            if (pendingAutoScanTimer) {
                clearTimeout(pendingAutoScanTimer);
                pendingAutoScanTimer = null;
            }
        }

        function hasCurrentGameScanSnapshot(snapshot = state.lastScanResults) {
            return Boolean(
                snapshot
                && Array.isArray(snapshot.results)
                && snapshot.gameSessionId === gameSessionId
                && snapshot.gameMode === currentGamemode
                && isScanActiveInGame()
            );
        }

        async function runScanForCurrentGame({ silentNoRoster = false, waitForInProgress = false, share = null } = {}) {
            if (!isScanActiveInGame()) {
                if (!silentNoRoster) sendChat(client, '§cScan is only available while you are in an active Bedwars or SkyWars game.');
                return false;
            }

            if (scanInProgress) {
                if (waitForInProgress && scanInProgressPromise) {
                    return scanInProgressPromise;
                }
                if (!silentNoRoster) sendChat(client, '§cScan already in progress!');
                return false;
            }

            seedGameRoster();
            if (gameRoster.size === 0) {
                if (!silentNoRoster) sendChat(client, '§cNo current-game roster detected yet. Try again after players appear.');
                return false;
            }

            scanInProgress = true;
            const scanSessionId = gameSessionId;
            const scanStillActive = () => scanSessionId === gameSessionId && isScanActiveInGame();

            // Open a live /share stream so results broadcast team-by-team (or
            // player-by-player) as they resolve, rather than waiting for the
            // whole scan. Used for auto-share and for a manual /share that has
            // to run its own scan first. Cancel any previous stream.
            const shareRequest = share || (state.shareTagsAuto ? { source: 'auto' } : null);
            let shareStream = null;
            if (shareRequest) {
                if (activeShareStream) { try { activeShareStream.end(); } catch (e) {} }
                shareStream = shareTagsBroadcaster.createStream(client, {
                    gameMode: currentGamemode,
                    includeSet: shareRequest.includeSet || null,
                    source: shareRequest.source || 'auto',
                    isStillActive: scanStillActive
                });
                activeShareStream = shareStream;
            }

            scanInProgressPromise = (async () => {
                await performFullScan(client, lobbyPlayers, detectedNickedPlayers, myTeam, {
                    gameActive,
                    gameRoster,
                    gameMode: currentGamemode,
                    gameSessionId: scanSessionId,
                    autoDenickResults,
                    markNickedPlayer,
                    getKnownDenick: findKnownDenickByNick,
                    isDenickAliasDuplicate,
                    isOwnPlayer: isOwnPlayerName,
                    getCachedPlayerProfile: getCachedOrPendingPregameChatProfile,
                    rememberActiveCosmetics: rememberPlayerActiveCosmetics,
                    rememberOverlayPlayer,
                    shareStream: shareStream ? { onRow: r => shareStream.onRow(r), onTeam: (k, rows) => shareStream.onTeam(k, rows) } : null,
                    isStillActive: scanStillActive
                });
                // Scan refreshed overlayPlayerStats, so refresh the above-head
                // name tags too (works even when Tab Stats is off).
                scheduleNametagSync();
                return true;
            })();
            try {
                return await scanInProgressPromise;
            } finally {
                scanInProgress = false;
                scanInProgressPromise = null;
                if (shareStream) {
                    shareStream.end();
                    if (activeShareStream === shareStream) activeShareStream = null;
                }
            }
        }

        function scheduleAutoScan(delay = 4000, attempts = 0) {
            if (!autoScanOnGameStart) return;
            if (state.scanMode === 'off') return;

            clearPendingAutoScan();
            pendingAutoScanTimer = setTimeout(async () => {
                pendingAutoScanTimer = null;
                const scanned = await runScanForCurrentGame({ silentNoRoster: true });
                if (!scanned && attempts < 2 && isScanActiveInGame() && state.scanMode !== 'off') {
                    scheduleAutoScan(1800, attempts + 1);
                }
            }, delay);
        }

        function clearPartyDenickAutoReview() {
            if (partyDenickAutoReviewTimer) clearTimeout(partyDenickAutoReviewTimer);
            partyDenickAutoReviewTimer = null;
        }

        function schedulePartyDenickAutoReview(attempt = 0) {
            if (attempt === 0) clearPartyDenickAutoReview();
            const delay = PARTY_DENICK_AUTO_REVIEW_DELAYS[attempt];
            if (!Number.isFinite(delay)) return;
            const sessionId = gameSessionId;
            partyDenickAutoReviewTimer = setTimeout(async () => {
                partyDenickAutoReviewTimer = null;
                if (!gameActive || currentGamemode !== 'BEDWARS' || gameSessionId !== sessionId) return;
                if (partyDenickReview?.gameSessionId === sessionId) return;
                const result = await buildPartyDenickReview({ automatic: true });
                if (result?.retry && attempt + 1 < PARTY_DENICK_AUTO_REVIEW_DELAYS.length) {
                    schedulePartyDenickAutoReview(attempt + 1);
                }
            }, delay);
        }

        function activateGame(mode, { autoScanDelay = 4000, observedStart = false } = {}) {
            teamDebug.mark('game_activate', { mode, gameSessionId, gameActive, activeMatchServerId });
            if (!isSupportedTabStatsMode(mode)) return;
            stopLookingFor('you joined a game');
            const startingNewGame = !gameActive;
            if (startingNewGame) queueTimeTracker.gameStart(mode);
            const localObservedFromStart = observedStart || (mode === 'BEDWARS' && bedwarsPregameActive);
            const localQueue = mode === 'BEDWARS' ? bedwarsPregameLocalQueue : null;
            const localStandardBedwars = Boolean(localQueue && !bedwarsPregameLocalUnsupported
                && /^(Solos|Doubles|Threes|Fours|4v4)$/i.test(localQueue.label));

            // The map exists only on the pregame sidebar. Capture it before
            // leaveBedwarsPregame deliberately clears all lobby-scoped state.
            const pregameMap = mode === 'BEDWARS' && bedwarsPregameActive
                ? bedwarsPregameMap
                : null;

            autoDodger.onGameStart();
            if (!gameActive) {
                applyBoundPresetForMode(mode);
            }
            if (mode === 'BEDWARS' || bedwarsPregameActive) {
                leaveBedwarsPregame({
                    preserveProfiles: mode === 'BEDWARS',
                    reason: mode === 'BEDWARS' ? 'game_activate' : 'other_game_activate'
                });
            }
            const alreadyActiveSameMode = gameActive && currentGamemode === mode;
            setCurrentGamemode(mode);

            if (!gameActive) {
                currentGamePlayerNames.clear();
                currentGameTeams.clear();
                gameActive = true;
                presentAtGameStart = true;
                // Re-stamp from the sidebar in front of us — the previous game's
                // id must never survive into this one's snapshots.
                activeMatchServerId = pregameLobbyIdForScoreboard(getCurrentScoreboardText()) || null;
                gameStartTime = Date.now();
                gameSessionId += 1;
                startSessionGameEventCapture(mode, { map: pregameMap });
                if (startingNewGame) sessionTracker.onGameStart({
                    mode, sessionKey: `${activeMatchServerId || 'game'}:${gameStartTime}`,
                    ownTeam: resolveOwnBedwarsTeam(), observedFromStart: localObservedFromStart,
                    standardBedwars: localStandardBedwars,
                    variant:localQueue?.label||buildSessionGameMetadata(mode).variant,
                    ...localSessionIdentity()
                });
                suppressedOverlayLiveSession = null;
                if (overlayAutoClearOnGameStartEnd) clearManualOverlayPlayers('game_start');
                clearAutoSkinDenickAttempts();
                if (mode === 'BEDWARS') lastBedwarsGameSessionId = gameSessionId;
                if (mode === 'BEDWARS') markRecentBedwarsSession(gameSessionId);
            } else if (!gameStartTime) {
                gameStartTime = Date.now();
            }
            if(!sessionGameFinalized&&!startingNewGame&&observedStart&&(state.apiKillSwitchEnabled||!hasHypixelApiKeyConfigured()))sessionTracker.onGameStart({mode,sessionKey:`${activeMatchServerId||'game'}:${gameStartTime}`,
                ownTeam:resolveOwnBedwarsTeam(),observedFromStart:true,standardBedwars:localStandardBedwars,
                variant:localQueue?.label||buildSessionGameMetadata(mode).variant,
                ...localSessionIdentity()});

            seedGameRoster();
            refreshTabStatsForRoster();
            refreshOverlayStatsForRoster();
            refreshNametagRosterStats();
            [1200, 3000].forEach(delay => {
                setTimeout(() => {
                    if (!gameActive || currentGamemode !== mode) return;
                    seedGameRoster();
                    refreshTabStatsForRoster();
                    refreshOverlayStatsForRoster();
                    refreshNametagRosterStats();
                }, delay);
            });

            saveCurrentMatchSnapshot('activate');
            if (!alreadyActiveSameMode) scheduleAutoScan(autoScanDelay);
            if (!alreadyActiveSameMode) {
                gamblerGeorgeTransitionId += 1;
                gamblerGeorgeReminder.onTransition('game', `game:${gamblerGeorgeTransitionId}`);
            }
            if (mode === 'BEDWARS' && !alreadyActiveSameMode) schedulePartyDenickAutoReview();

        }

        function resetMatchState({ keepMode = false, clearPlayers = false, clearSnapshot = false } = {}) {
            queueTimeTracker.leave();
            teamDebug.mark('match_reset', { gameSessionId, gameActive, currentGamemode, activeMatchServerId, keepMode, clearPlayers, clearSnapshot });
            clearDuelsState('match_reset');
            saveCurrentMatchSnapshot('reset');
            if (clearSnapshot) clearLastMatchSnapshot();

            const endingMode = currentGamemode;
            const endingSessionId = gameSessionId;
            const wasActiveSupportedGame = gameActive && isSupportedTabStatsMode(currentGamemode);
            // Snapshot the roster while it is still populated — the recap and
            // encounter log both need it, and gameRoster is cleared below.
            if (wasActiveSupportedGame) {
                finalizeSessionGame();
                if (!gameStartTime || Date.now() - gameStartTime >= 30000) {
                    activeSessionGameEvents = [];
                    activeSessionGameMetadata = null;
                }
            }
            if (wasActiveSupportedGame && endingMode === 'BEDWARS') {
                markRecentBedwarsSession(endingSessionId);
                slumberDailyRewardsReminder.onGameplayMilestone();
            }
            const pendingAutoDenicks = Array.from(autoDenickStats.entries()).filter(([, observed]) => {
                return observed
                    && observed.sessionId === endingSessionId
                    && observed.finals !== null
                    && observed.beds !== null
                    && !observed.done
                    && !observed.notNicked;
            });
            const pendingNickedPlayers = new Map();
            pendingAutoDenicks.forEach(([key, observed]) => {
                const nickInfo = detectedNickedPlayers.get(key) || detectedNickedPlayers.get(nickKey(observed.name));
                if (nickInfo) pendingNickedPlayers.set(key, nickInfo);
            });
            if (endingMode === 'BEDWARS' && pendingAutoDenicks.length > 0) {
                lastBedwarsGameSessionId = endingSessionId;
                autoDenickGraceUntil = Date.now() + AUTO_DENICK_POST_GAME_GRACE_MS;
            }
            gameActive = false;
            presentAtGameStart = false;
            gameStartTime = null;
            // The snapshot above already carries it; keeping it live would let
            // the finished game's id stamp the next one.
            activeMatchServerId = null;
            autoDodger.cancel('match reset', { announce: false });
            if (bedwarsPregameActive) partyArrivalTracker.onPregameLeave('match_reset');
            partyArrivalCheck.stop();
            partyArrivalPreview.stop();
            bedwarsPregameActive = false;
            bedwarsPregameLobbyId = null;
            bedwarsPregameMap = null;
            bedwarsPregameSessionId += 1;
            pregameChatSeenPlayers.clear();
            pregameChatLookupsInFlight.clear();
            pregameChatLookupPromises.clear();
            pregameChatPlayerProfiles.clear();
            clearPartyDenickAutoReview();
            partyDenickReview = null;
            lobbyChatStatsShownPlayers.clear();
            clearManualOverlayPlayersBySource('pregame', 'BEDWARS', 'match_reset');
            suppressedOverlayLiveSession = null;
            myTeam = null;
            scanInProgress = false;
            scanInProgressPromise = null;
            clearPendingAutoScan();
            clearDelayedRosterSync();
            clearBedwarsTeamAudit();
            clearAutoSkinDenickAttempts();
            if (wasActiveSupportedGame && overlayAutoClearOnGameStartEnd) clearManualOverlayPlayers('game_end');
            clearOverlayStatsTimers();
            gameSessionId += 1;
            scoreboardState.reset();
            sidebarScoreboardObjective = '';
            lastScoreboardTitle = '';
            defaultTabSnapshot = createDefaultTabSnapshot();
            detectedNickedPlayers.clear();
            settledNickVerifiedAt.clear();
            nickCapablePlayers.clear();
            entityTracker.clear();
            pendingNickedPlayers.forEach((value, key) => detectedNickedPlayers.set(key, value));
            if (pendingAutoDenicks.length > 0) {
                autoDenickStats = new Map(pendingAutoDenicks);
            } else {
                autoDenickStats.clear();
            }
            gameRoster.clear();
            currentGamePlayerNames.clear();
            currentGameTeams.clear();
            activePlayerCosmetics.clear();
            overlayPlayerStats.clear();
            clearAllTabStatsDisplays();
            clearNametagTeams();

            if (!keepMode) currentGamemode = null;

            if (clearPlayers) {
                lobbyPlayers.clear();
                uuidMap.clear();
            } else {
                lobbyPlayers.forEach((player, name) => {
                    player.team = null;
                    player.rawTeam = null;
                    player.friendlyFire = null;
                    player.nameTagVisibility = null;
                    player.teamAssignedAt = null;
                    player.color = "§7";
                    player.letter = "?";
                    lobbyPlayers.set(name, player);
                });
            }

            if (pendingAutoDenicks.length > 0) {
                pendingAutoDenicks.forEach(([key, observed], index) => {
                    setTimeout(() => {
                        const latest = autoDenickStats.get(key);
                        if (!latest || latest.done || latest.inFlight) return;
                        runAutoDenickForObservedPlayer(key, endingSessionId).catch(() => {});
                    }, 250 + index * 500);
                });
            }
        }

        function saveScoreboardTeamInfo(teamName, updates) {
            const raw = String(teamName || '');
            const baseTeamName = updates.baseTeamName || normalizeScoreboardTeamName(raw);
            const previousBase = scoreboardTeamAliases.get(raw);
            if (previousBase && previousBase !== baseTeamName) {
                const previous = scoreboardTeamRegistry.get(previousBase);
                previous?.rawTeamIds?.delete(raw);
                for (const player of previous?.players || []) {
                    if (scoreboardEntryTeams.get(player) === raw) previous.players.delete(player);
                }
                if (!previous?.rawTeamIds?.size) scoreboardTeamRegistry.delete(previousBase);
            }
            const existing = scoreboardTeamRegistry.get(baseTeamName) || {
                players: new Set(),
                rawTeamIds: new Set()
            };

            const teamInfo = {
                ...existing,
                ...updates,
                players: existing.players instanceof Set ? existing.players : new Set(existing.players || []),
                rawTeamIds: existing.rawTeamIds instanceof Set ? existing.rawTeamIds : new Set(existing.rawTeamIds || [])
            };

            teamInfo.rawTeamIds.add(raw);
            rawScoreboardTeamMembers(raw).forEach(player => teamInfo.players.add(player));
            scoreboardTeamAliases.set(raw, baseTeamName);
            scoreboardTeamRegistry.set(baseTeamName, teamInfo);
            return { baseTeamName, teamInfo };
        }

        // Hypixel gives every BedWars player their own team ("Red28", "Red3",
        // ...) and normalizeScoreboardTeamName folds all of them into one
        // registry entry per colour, so `teamInfo` here is shared by the whole
        // team. Deleting that entry because one per-player team went away wiped
        // the colour for everybody else on it - and Hypixel churns a team
        // through create/update/add/remove/delete about once a second, so the
        // whole team kept losing its identity and its players kept being
        // re-teamed and re-sorted in the tab list. Release just this raw id and
        // keep the colour while any of its other teams are still registered.
        function deleteScoreboardTeamInfo(teamName) {
            const raw = String(teamName || '');
            const baseTeamName = scoreboardTeamAliases.get(raw) || normalizeScoreboardTeamName(raw);
            const teamInfo = scoreboardTeamRegistry.get(baseTeamName);
            scoreboardTeamAliases.delete(raw);
            teamInfo?.rawTeamIds?.delete(raw);
            if (teamInfo?.rawTeamIds?.size) return { baseTeamName, teamInfo };
            scoreboardTeamRegistry.delete(baseTeamName);
            return { baseTeamName, teamInfo };
        }

        // The players Hypixel actually seated in one raw team. rawScoreboardTeams
        // is packet-accurate per raw id, unlike the registry entry it maps to,
        // which is shared by every per-player team of the same colour. Returns
        // nothing for a team we never tracked - guessing there would mean
        // touching teammates this team never held.
        function rawScoreboardTeamMembers(teamName) {
            return Array.from(rawScoreboardTeams.get(String(teamName || ''))?.players || []);
        }

        function buildScoreboardTeamInfo(teamName, displayName, prefix, suffix, color, options = {}) {
            const existing = getScoreboardTeamInfo(teamName);
            const evidence = rawScoreboardTeams.get(String(teamName || ''))?.bedwarsEvidence
                || resolveTeamEvidence(teamName, prefix);
            const resolvedTeam = evidence ? exactBedwarsTeamInfo(evidence.name) : null;
            const teamColor = resolvedTeam?.color || leadingScoreboardColor(prefix) || colorValueToCode(color) || '§7';
            const letter = resolvedTeam?.letter || '?';

            return {
                baseTeamName: resolvedTeam?.name || String(teamName || ''),
                isBedwarsTeam: Boolean(resolvedTeam),
                displayName,
                prefix,
                suffix,
                color: teamColor,
                letter,
                friendlyFire: options.friendlyFire ?? existing?.friendlyFire ?? 0,
                nameTagVisibility: options.nameTagVisibility || existing?.nameTagVisibility || 'always'
            };
        }

        function applyPlayersToScoreboardTeam(teamName, playerNames = [], delayBase = 250, options = {}) {
            const teamInfo = getScoreboardTeamInfo(teamName);
            if (!teamInfo || !Array.isArray(playerNames)) return;

            const baseTeamName = scoreboardTeamAliases.get(String(teamName || '')) || normalizeScoreboardTeamName(teamName);
            playerNames.filter(isValidPlayerName).forEach((playerName, index) => {
                if (isDenickAliasDuplicate(playerName)) {
                    cleanupDenickAliasDuplicate(playerName, 'scoreboard_team_alias');
                    return;
                }
                const isBedwarsTeam = Boolean(teamInfo.isBedwarsTeam || getBedwarsTeamInfo(baseTeamName));
                if (!isBedwarsTeam && gameActive && currentGamemode === 'BEDWARS' && isKnownTabPlayer(playerName)) {
                    // A sidebar line can collide with a live player name. Do
                    // not promote that sidebar entry into the server-team
                    // registry, and remove it from the client's team map so
                    // its sidebar prefix cannot render above the entity.
                    teamInfo.players.delete(playerName);
                    try {
                        writeScoreboardTeamPacket({ team: teamName, mode: 4, players: [playerName] }, { applySidebarTeamColors: true });
                    } catch (e) {}
                    return;
                }
                teamInfo.players.add(playerName);
                if (!isKnownTabPlayer(playerName)) return;

                // teamInfo.players is the whole colour, so a mode-2 refresh of
                // one per-player team arrives here carrying every teammate.
                // Only the players Hypixel actually seated in this raw team may
                // claim it: stamping it on all of them made the entire team
                // answer "Red28" for their team id, and lose it again a second
                // later when Hypixel deleted that one team. scoreboardEntryTeams
                // is rebuilt straight from the packets, so it is the authority.
                const liveRawTeam = scoreboardEntryTeams.get(playerName);

                // The same rule, one level up. Hypixel can move a player to
                // another colour without ever removing them from the old one
                // (the vanilla client evicts them implicitly), so the old
                // colour's member set keeps carrying them - and this whole-set
                // refresh then re-stamped its team, letter and colour over the
                // real assignment. It repeats about once a second, which is why
                // the wrong colour also outlived every later correction, and it
                // is what put teammates on a team they were never on.
                //
                // Evidence, strongest first: live membership decides outright;
                // failing that this raw team must actually hold the player;
                // failing that we only speak for a player who has no BedWars
                // colour of their own yet, because then this packet is the only
                // evidence there is.
                const liveBaseTeamName = liveRawTeam
                    ? (scoreboardTeamAliases.get(String(liveRawTeam)) || normalizeScoreboardTeamName(liveRawTeam))
                    : null;
                const heldByThisRawTeam = Boolean(rawScoreboardTeams.get(String(teamName || ''))?.players?.has(playerName));
                const cachedTeamName = getBedwarsTeamInfo(lobbyPlayers.get(playerName)?.team)?.name || null;
                const seatedHere = liveBaseTeamName
                    ? liveBaseTeamName === baseTeamName
                    : (heldByThisRawTeam || !cachedTeamName || cachedTeamName === baseTeamName);

                if (isBedwarsTeam && !seatedHere) {
                    // Stale membership from a move Hypixel made without a
                    // mode-4. Drop it so this colour stops speaking for a
                    // player it no longer owns, and leave the record alone -
                    // the team they are actually on will refresh them itself.
                    teamInfo.players.delete(playerName);
                    return;
                }

                const updates = {
                    activeScoreboardTeam: baseTeamName,
                    friendlyFire: teamInfo.friendlyFire ?? 0,
                    nameTagVisibility: teamInfo.nameTagVisibility || 'always',
                    source: 'scoreboard_team'
                };

                if (liveRawTeam) updates.rawTeam = String(liveRawTeam);
                else if (heldByThisRawTeam) {
                    updates.rawTeam = String(teamName || '');
                }

                if (isBedwarsTeam) {
                    if (isOwnPlayerName(playerName)) myTeam = baseTeamName;
                    updates.color = teamInfo.color;
                    updates.letter = teamInfo.letter;
                    updates.team = baseTeamName;
                    updates.teamAssignedAt = Date.now();
                }

                touchLobbyPlayer(playerName, updates);

                if (gameActive && isEligibleForCurrentGameRoster(playerName)) {
                    gameRoster.add(playerName);
                    rememberCurrentGamePlayerName(playerName);
                    rememberCurrentGameTeam(playerName);
                    scheduleBedwarsClientTeamSync();
                    queueTabStatsUpdate(playerName, delayBase + index * 75);
                }
            });
            if (options.saveSnapshot !== false) scheduleCurrentMatchSnapshot('team_update');
        }

        function clearPlayersFromScoreboardTeam(teamName, playerNames = []) {
            const teamInfo = getScoreboardTeamInfo(teamName);
            const baseTeamName = scoreboardTeamAliases.get(String(teamName || '')) || normalizeScoreboardTeamName(teamName);
            if (!teamInfo || !Array.isArray(playerNames)) return;

            playerNames.filter(isValidPlayerName).forEach(playerName => {
                if (isDenickAliasDuplicate(playerName)) {
                    cleanupDenickAliasDuplicate(playerName, 'scoreboard_team_remove_alias');
                    return;
                }
                teamInfo.players.delete(playerName);
                const isBedwarsTeam = Boolean(teamInfo.isBedwarsTeam || getBedwarsTeamInfo(baseTeamName));
                if (!gameActive && isBedwarsTeam && isOwnPlayerName(playerName) && myTeam === baseTeamName) myTeam = null;

                if (lobbyPlayers.has(playerName)) {
                    touchLobbyPlayer(playerName, {
                        color: gameActive ? (lobbyPlayers.get(playerName)?.color || "§7") : "§7",
                        letter: gameActive ? (lobbyPlayers.get(playerName)?.letter || "?") : "?",
                        team: gameActive ? (lobbyPlayers.get(playerName)?.team || null) : null,
                        rawTeam: lobbyPlayers.get(playerName)?.rawTeam === String(teamName || '') ? null : lobbyPlayers.get(playerName)?.rawTeam,
                        friendlyFire: lobbyPlayers.get(playerName)?.rawTeam === String(teamName || '') ? null : lobbyPlayers.get(playerName)?.friendlyFire,
                        nameTagVisibility: lobbyPlayers.get(playerName)?.rawTeam === String(teamName || '') ? null : lobbyPlayers.get(playerName)?.nameTagVisibility,
                        teamAssignedAt: gameActive ? (lobbyPlayers.get(playerName)?.teamAssignedAt || null) : null,
                        source: 'scoreboard_team_remove'
                    });
                    scheduleBedwarsClientTeamSync();
                    queueTabStatsUpdate(playerName, 150);
                }
            });
            scheduleCurrentMatchSnapshot('team_remove');
        }

        function seedGameRoster() {
            const now = Date.now();
            gameRoster.clear();
            const teamNames = [];

            lobbyPlayers.forEach((player, name) => {
                if (isDenickAliasDuplicate(name)) {
                    cleanupDenickAliasDuplicate(name, 'roster_seed_alias');
                    return;
                }
                const recentlySeen = now - (player.lastSeen || 0) < 90 * 1000;
                const leftBeforeGame = player.leftTabAt && gameStartTime && player.leftTabAt < gameStartTime - 1000;
                if (player.team && gameStartTime && (player.teamAssignedAt || 0) < gameStartTime - 30000) {
                    teamDebug.mark('roster_team_expired', { player: name, team: player.team, rawTeam: player.rawTeam, teamAssignedAt: player.teamAssignedAt, gameStartTime });
                    player.team = null;
                    player.rawTeam = null;
                    // Clear the normalized name too: leaving it behind kept the
                    // "this player has a scoreboard team" flag set with nothing
                    // to read it from, which sent the team resolver down its
                    // display-colour fallback.
                    player.activeScoreboardTeam = null;
                    player.friendlyFire = null;
                    player.nameTagVisibility = null;
                    player.teamAssignedAt = null;
                    player.color = "§7";
                    player.letter = "?";
                    lobbyPlayers.set(name, player);
                }
                const stillPresent = player.inTab || Boolean(player.team);

                if (isValidPlayerName(name) && recentlySeen && stillPresent && !leftBeforeGame) {
                    const currentTeam = player.team && (!gameStartTime || (player.teamAssignedAt || 0) >= gameStartTime - 30000) && hasCurrentBedwarsTeam(name);
                    if (currentTeam) teamNames.push(name);
                } else if (!player.inTab && !player.team) {
                    lobbyPlayers.delete(name);
                }
            });

            const names = currentGamemode === 'BEDWARS'
                ? teamNames
                : Array.from(lobbyPlayers.entries())
                    .filter(([name, player]) => isValidPlayerName(name) && !isDenickAliasDuplicate(name) && player.inTab && now - (player.lastSeen || 0) < 90 * 1000)
                    .map(([name]) => name);

            names.forEach(name => {
                if (isDenickAliasDuplicate(name)) return;
                const player = lobbyPlayers.get(name);
                if (!player) return;
                player.matchSeenAt = gameStartTime || now;
                player.lastSeen = now;
                lobbyPlayers.set(name, player);
                gameRoster.add(name);
                rememberCurrentGamePlayerName(name);
                rememberCurrentGameTeam(name);
            });

            scheduleBedwarsClientTeamSync();
            scheduleCurrentMatchSnapshot('roster_seed');
        }

        function markPlayerLeftTab(name) {
            const player = lobbyPlayers.get(name);
            if (!player) return;
            player.inTab = false;
            player.leftTabAt = Date.now();
            player.lastSeen = Date.now();
            lobbyPlayers.set(name, player);
        }

        function pruneStalePlayers() {
            if (gameActive) return;
            const now = Date.now();
            lobbyPlayers.forEach((player, name) => {
                if (!player.inTab && !player.team && now - (player.lastSeen || 0) > PLAYER_SNAPSHOT_TTL) {
                    lobbyPlayers.delete(name);
                }
            });
        }

        const tabStatsTimers = new Map();
        const tabIdentityWidths = new Map();
        const tabStatsAppliedNames = new Set();
        // The complete profile last used for each rendered row. Field/layout
        // edits rebuild from this immediately, then the normal background
        // refresh can catch up with anything that was not cached yet.
        const tabStatsProfileCache = new Map();
        // Latency packets arrive for every player on a timer. Tab ping is
        // Aurora-only, so they only nudge rows that still need a lookup, and
        // at most once per TAB_LATENCY_RETRY_MS per player.
        const TAB_LATENCY_RETRY_MS = 30 * 1000;
        const tabLatencyRetriedAt = new Map();
        // Optional Tab List fields reuse the existing Guild and Coral session
        // endpoints, but keep their presentation cache scoped to the visible
        // game name so nick -> real-IGN lookups cannot bleed into another row.
        const tabStatsGuildTags = new Map();
        const tabStatsSessionStats = new Map();
        let tabStatsSupplementalGeneration = 0;
        let tabStatsUrchinOverrides = new Map();
        const syntheticBedwarsTeams = new Map();
        const ENABLE_SYNTHETIC_BEDWARS_TEAMS = false;
        // Name-tag overlay (above-head): client-only teams created ONLY for
        // annotated enemies (nick / tag / threat). Independent of the
        // disabled synthetic-team-for-everyone path above.
        const nametagTeams = new Map();      // nickKey -> { teamName, prefix, suffix, name }
        const nametagGuildTags = new Map();  // nickKey -> guild tag string (lazy)
        const nametagSessionStats = new Map(); // nickKey -> { fkdr, wlr, wins, finals } (lazy)
        let nametagSyncTimer = null;
        let nametagFetchTimers = new Set();
        let nametagConfigRefreshTimer = null;
        let duelsNametagRefreshTimer = null;
        const TAB_IDENTITY_MIN_WIDTH = 138;
        const TAB_FKDR_WIDTH = 42;
        const TAB_WLR_WIDTH = 42;
        const TAB_KDR_WIDTH = 42;
        let tabIdentityColumnWidth = TAB_IDENTITY_MIN_WIDTH;
        let tabIdentityRefreshTimer = null;
        let bedwarsTeamSyncTimer = null;
        let bedwarsTeamAuditTimer = null;

        function minecraftCharWidth(char) {
            if (char === ' ') return 4;
            if ("!.,:;i|".includes(char)) return 2;
            if ("'`l".includes(char)) return 3;
            if ('[](){}tfI'.includes(char)) return 4;
            if ('"*<>'.includes(char)) return 5;
            return 6;
        }

        function minecraftTextWidth(text) {
            return stripAnsi(String(text || '')).split('').reduce((sum, char) => sum + minecraftCharWidth(char), 0);
        }

        function padMinecraftEnd(text, targetWidth) {
            const missing = targetWidth - minecraftTextWidth(text);
            return String(text || '') + ' '.repeat(Math.max(0, Math.ceil(missing / minecraftCharWidth(' '))));
        }

        function padMinecraftStart(text, targetWidth) {
            const missing = targetWidth - minecraftTextWidth(text);
            return ' '.repeat(Math.max(0, Math.ceil(missing / minecraftCharWidth(' ')))) + String(text || '');
        }

        function buildTabStatPart(label, valueText, valueColor, targetWidth) {
            const visibleText = `${label}: ${valueText}`;
            const paddedText = padMinecraftStart(visibleText, targetWidth);
            const leadingSpaces = paddedText.match(/^ */)?.[0] || '';
            return `${leadingSpaces}§f${label}: ${valueColor}${valueText}`;
        }

        function resetTabStatsLayout() {
            tabIdentityWidths.clear();
            tabIdentityColumnWidth = TAB_IDENTITY_MIN_WIDTH;
            if (tabIdentityRefreshTimer) {
                clearTimeout(tabIdentityRefreshTimer);
                tabIdentityRefreshTimer = null;
            }
        }

        function scheduleTabStatsLayoutRefresh() {
            if (tabIdentityRefreshTimer || !isTabStatsActiveInGame()) return;
            tabIdentityRefreshTimer = setTimeout(() => {
                tabIdentityRefreshTimer = null;
                if (isTabStatsActiveInGame()) refreshTabStatsForRoster();
            }, 150);
        }

        function padTabIdentity(name, identityText) {
            const width = minecraftTextWidth(identityText);
            const previous = tabIdentityWidths.get(name);
            if (previous !== width) {
                tabIdentityWidths.set(name, width);
                const widest = Math.max(TAB_IDENTITY_MIN_WIDTH, ...tabIdentityWidths.values());
                if (widest !== tabIdentityColumnWidth) {
                    tabIdentityColumnWidth = widest;
                    scheduleTabStatsLayoutRefresh();
                }
            }

            return padMinecraftEnd(identityText, tabIdentityColumnWidth);
        }

        function writeTabDisplayName(uuid, displayText, raw = false) {
            if (!uuid) return;
            try {
                client.write('player_info', {
                    action: 'update_display_name',
                    data: [{
                        uuid,
                        displayName: displayText ? (raw ? displayText : JSON.stringify(legacyTextToJsonComponent(displayText))) : null
                    }]
                });
            } catch (e) {}
        }

        function syntheticVisibilityCode(value) {
            const text = String(value || 'always');
            if (text === 'never') return 'N';
            if (text === 'hideForOtherTeams') return 'O';
            if (text === 'hideForOwnTeam') return 'S';
            return 'A';
        }

        function buildSyntheticBedwarsTeamState(teamDef, playerInfo = {}, playerName = '') {
            const assignedTeam = playerInfo.team ? getScoreboardTeamInfo(playerInfo.team) : null;
            const rawTeam = playerInfo.rawTeam ? getScoreboardTeamInfo(playerInfo.rawTeam) : null;
            const scoreboardTeam = rawTeam || assignedTeam || findScoreboardTeamForPlayer(playerName)?.teamInfo;

            return {
                name: teamDef.name,
                color: teamDef.color,
                letter: teamDef.letter,
                friendlyFire: playerInfo.friendlyFire ?? scoreboardTeam?.friendlyFire ?? 0,
                nameTagVisibility: playerInfo.nameTagVisibility || scoreboardTeam?.nameTagVisibility || 'always'
            };
        }

        function syntheticBedwarsTeamName(teamState) {
            const shortName = String(teamState.name || 'Team').replace(/[^A-Za-z0-9]/g, '').slice(0, 4) || 'Team';
            const visibility = syntheticVisibilityCode(teamState.nameTagVisibility);
            const flags = Number.isFinite(Number(teamState.friendlyFire)) ? Number(teamState.friendlyFire) : 0;
            return `SMB_${shortName}_${visibility}${flags}`.slice(0, 16);
        }

        function writeSyntheticBedwarsTeam(teamState, mode, players = []) {
            try {
                writeScoreboardTeamPacket({
                    team: syntheticBedwarsTeamName(teamState),
                    mode,
                    name: teamState.name,
                    prefix: `${teamState.color}${teamState.letter} `,
                    suffix: '§r',
                    friendlyFire: teamState.friendlyFire ?? 0,
                    nameTagVisibility: teamState.nameTagVisibility || 'always',
                    color: legacyColorToPacketColor(teamState.color),
                    players
                });
            } catch (e) {}
        }

        function writeOriginalScoreboardTeamUpdate(rawTeamName, teamInfo, players = []) {
            if (!rawTeamName || !teamInfo) return;
            try {
                writeScoreboardTeamPacket({
                    team: rawTeamName,
                    mode: 2,
                    name: teamInfo.displayName || teamInfo.name || rawTeamName,
                    prefix: teamInfo.prefix || '',
                    suffix: teamInfo.suffix || '',
                    friendlyFire: teamInfo.friendlyFire ?? 0,
                    nameTagVisibility: teamInfo.nameTagVisibility || 'always',
                    color: legacyColorToPacketColor(teamInfo.color),
                    players: []
                }, { applySidebarTeamColors: true });

                if (players.length > 0) {
                    writeScoreboardTeamPacket({
                        team: rawTeamName,
                        mode: 3,
                        players
                    }, { applySidebarTeamColors: true });
                }
            } catch (e) {}
        }

        function writeDefaultTeamSnapshot(teamState) {
            if (!teamState?.team) return;
            try {
                writeScoreboardTeamPacket({
                    team: teamState.team,
                    mode: 2,
                    name: teamState.name || teamState.team,
                    prefix: teamState.prefix || '',
                    suffix: teamState.suffix || '',
                    friendlyFire: teamState.friendlyFire ?? 0,
                    nameTagVisibility: teamState.nameTagVisibility || 'always',
                    color: teamState.color ?? -1
                }, { applySidebarTeamColors: true });

                const players = normalizeScoreboardTeamEntries(Array.from(teamState.players || []));
                if (players.length > 0) {
                    writeScoreboardTeamPacket({
                        team: teamState.team,
                        mode: 3,
                        players
                    }, { applySidebarTeamColors: true });
                }
            } catch (e) {}
        }

        // The setting only changes display copies of team packets. Re-send the
        // current team properties after a live settings change so the sidebar
        // repaints immediately without changing score-entry IDs or raw state.
        function refreshScoreboardTeamDisplay() {
            defaultTabSnapshot.teams.forEach(teamState => writeDefaultTeamSnapshot(teamState));
        }

        function restoreDefaultTabSnapshot() {
            lobbyPlayers.forEach(player => {
                if (!player?.uuid) return;
                const displayName = defaultTabSnapshot.displayNames.has(player.uuid)
                    ? defaultTabSnapshot.displayNames.get(player.uuid)
                    : (player.originalDisplayName ?? null);
                writeTabDisplayName(player.uuid, displayName, Boolean(displayName));
            });

            defaultTabSnapshot.teams.forEach(teamState => writeDefaultTeamSnapshot(teamState));
        }

        // Replay each per-player BedWars team the client still holds, with its
        // own members. Seating a whole colour in whichever of its teams we
        // happened to find first left every borrowed player in no team as soon
        // as Hypixel deleted that one - and a player in no team sorts above
        // every team block in the tab list.
        function replayOriginalBedwarsTeams() {
            if (currentGamemode !== 'BEDWARS') return;

            originalScoreboardTeamsOnClient.forEach(rawTeamName => {
                const teamInfo = getScoreboardTeamInfo(rawTeamName);
                if (!teamInfo || !isBedwarsScoreboardTeam(rawTeamName, teamInfo)) return;
                const players = rawScoreboardTeamMembers(rawTeamName).filter(isValidPlayerName);
                writeOriginalScoreboardTeamUpdate(rawTeamName, teamInfo, players);
            });
        }

        function clearSyntheticBedwarsTeams({ restoreOriginalTeams = false } = {}) {
            if (bedwarsTeamSyncTimer) {
                clearTimeout(bedwarsTeamSyncTimer);
                bedwarsTeamSyncTimer = null;
            }
            syntheticBedwarsTeams.forEach((_, teamName) => {
                try {
                    writeScoreboardTeamPacket({ team: teamName, mode: 1 });
                } catch (e) {}
            });
            syntheticBedwarsTeams.clear();

            if (restoreOriginalTeams) {
                restoreDefaultTabSnapshot();
                replayOriginalBedwarsTeams();
                [150, 650].forEach(delay => {
                    setTimeout(() => {
                        if (tabStatsEnabled || !gameActive || currentGamemode !== 'BEDWARS') return;
                        restoreDefaultTabSnapshot();
                        replayOriginalBedwarsTeams();
                    }, delay);
                });
            }
        }

        function syncBedwarsClientTeams() {
            if (!ENABLE_SYNTHETIC_BEDWARS_TEAMS || !isTabStatsActiveInGame() || currentGamemode !== 'BEDWARS') {
                clearSyntheticBedwarsTeams();
                return;
            }

            const groups = new Map();
            Array.from(gameRoster).forEach(name => {
                const info = lobbyPlayers.get(name);
                if (!info || !isValidPlayerName(name)) return;
                if (isDenickAliasDuplicate(name)) {
                    cleanupDenickAliasDuplicate(name, 'team_sync_alias');
                    return;
                }

                const teamDef = resolveBedwarsTeamDef(info, name);
                if (!teamDef) return;

                const teamState = buildSyntheticBedwarsTeamState(teamDef, info, name);
                const teamName = syntheticBedwarsTeamName(teamState);
                if (!groups.has(teamName)) groups.set(teamName, { teamState, players: new Set() });
                groups.get(teamName).players.add(name);
            });

            syntheticBedwarsTeams.forEach((_, teamName) => {
                if (!groups.has(teamName)) {
                    try {
                        writeScoreboardTeamPacket({ team: teamName, mode: 1 });
                    } catch (e) {}
                    syntheticBedwarsTeams.delete(teamName);
                }
            });

            groups.forEach(({ teamState, players }, teamName) => {
                const nextPlayers = Array.from(players);
                const previousPlayers = syntheticBedwarsTeams.get(teamName);

                if (!previousPlayers) {
                    writeSyntheticBedwarsTeam(teamState, 0, nextPlayers);
                    syntheticBedwarsTeams.set(teamName, new Set(nextPlayers));
                    return;
                }

                writeSyntheticBedwarsTeam(teamState, 2, []);

                const removed = Array.from(previousPlayers).filter(name => !players.has(name));
                if (removed.length > 0) writeSyntheticBedwarsTeam(teamState, 4, removed);

                const added = nextPlayers.filter(name => !previousPlayers.has(name));
                if (added.length > 0) writeSyntheticBedwarsTeam(teamState, 3, added);

                syntheticBedwarsTeams.set(teamName, new Set(nextPlayers));
            });
        }

        function scheduleBedwarsClientTeamSync(delay = 60) {
            if (bedwarsTeamSyncTimer) clearTimeout(bedwarsTeamSyncTimer);
            bedwarsTeamSyncTimer = setTimeout(() => {
                bedwarsTeamSyncTimer = null;
                syncBedwarsClientTeams();
            }, delay);
        }

        // --- Name-tag overlay (text above players' heads) -------------------
        function isNametagOverlayActive() {
            return nametagOverlayEnabled && gameActive && currentGamemode === 'BEDWARS';
        }

        // Duels runs a separate, simpler overlay: a single "everyone except me"
        // audience showing the current mode's WLR (prefix) + KDR (suffix).
        // Keyed on duelsState, not gameActive/currentGamemode (those stay unset
        // during duels), so it never touches the Bedwars path above.
        function isNametagOverlayActiveDuels() {
            return nametagOverlayEnabled && duelsState.active;
        }

        function isPlayerHiddenByTeamRemoval(name) {
            // Hypixel hides an invisible player's nametag by removing them
            // from their scoreboard team (the entity keeps its invisible
            // metadata flag, but modded 1.8.9 clients render tags for any
            // teamed player). lobbyPlayers intentionally keeps the team for
            // game logic, so check live scoreboard membership instead.
            //
            // Source of truth is scoreboardEntryTeams (the player->raw-team
            // map): a mode-4 team removal deletes the player from it, so an
            // absent entry means genuinely un-teamed. We deliberately do NOT
            // rely on scoreboardTeamRegistry[base].players here — Hypixel
            // churns team packets after game start and normalized bases (e.g.
            // Pink0/Pink1 -> "Pink") can transiently empty their shared player
            // set, which would false-positive every player as "removed".
            if (!gameActive || currentGamemode !== 'BEDWARS') return false;
            if (scoreboardEntryTeams.has(String(name || ''))) return false;
            return !findScoreboardTeamForPlayer(name);
        }

        function isBedwarsScoreboardTeam(rawTeamName, teamInfo) {
            return Boolean(
                teamInfo?.isBedwarsTeam
                || getBedwarsTeamInfo(rawTeamName)
                || getBedwarsTeamInfo(teamInfo?.baseTeamName)
            );
        }

        // Sidebar teams (team_12, team_13, etc.) are also scoreboard teams,
        // but they are never valid above-head teams for a BedWars player. A
        // nick lookup failure used to make restorePlayerOriginalTeam trust a
        // stale sidebar entry and send its "Diamond II in ..." prefix to the
        // player's nametag, so only a BedWars-coloured team is ever accepted -
        // and only one this player is actually in.
        function trustedOriginalScoreboardTeamForPlayer(name) {
            const player = lobbyPlayers.get(name) || {};
            // Live membership first: scoreboardEntryTeams is rebuilt straight
            // from Hypixel's team packets, so it names the raw team this player
            // is in right now. The lobbyPlayers fields can lag a colour's churn,
            // and the last two are only a colour, not a team.
            const candidates = [
                scoreboardEntryTeams.get(String(name || '')),
                player.rawTeam,
                player.activeScoreboardTeam,
                player.team
            ].filter(Boolean).map(value => String(value));
            const seen = new Set();

            for (const candidate of candidates) {
                if (seen.has(candidate)) continue;
                seen.add(candidate);
                const teamInfo = getScoreboardTeamInfo(candidate);
                if (!isBedwarsScoreboardTeam(candidate, teamInfo)) continue;
                if (originalScoreboardTeamsOnClient.has(candidate)) {
                    return { rawTeamName: candidate, teamInfo };
                }
                // Deliberately no fall back to teamInfo.rawTeamIds here: that
                // set is shared by every per-player team of the colour, so it
                // handed this player a *teammate's* team. The client accepted
                // it until Hypixel deleted that team on its own schedule, and
                // then the player belonged to no team at all - their tab row
                // jumped above every team block and their nametag lost its
                // colour. A candidate we cannot place is no restore target.
                if (teamInfo && rawScoreboardTeams.has(candidate)) {
                    return { rawTeamName: candidate, teamInfo };
                }
            }

            return null;
        }

        // The Hypixel team this player belongs to right now, as the client
        // knows it. scoreboardEntryTeams is the live player -> raw-team map;
        // the registry lookup is the fallback for players we only saw through
        // a team snapshot. assignNametagTeamNames turns these into overlay team
        // names that sort where the real ones did, keeping the tab list in its
        // vanilla team order (see src/overlay/nametags.js).
        function originalRawTeamNameFor(name) {
            const trusted = trustedOriginalScoreboardTeamForPlayer(name);
            if (trusted?.rawTeamName) return trusted.rawTeamName;
            const direct = scoreboardEntryTeams.get(String(name || ''));
            if (direct) return direct;
            // Last resort is the BedWars team name ("Red"), never a teammate's
            // raw team id: both sort inside the same colour block, but the
            // teammate's id makes two players share an index namespace they do
            // not share a team in. An empty base is the one answer that must
            // not happen - "!0" sorts above every team in the tab list.
            return resolveBedwarsTeamName(name) || '';
        }

        // Assign every pending row a team name, then write the diff.
        function applyNametagTeamAssignments(pending) {
            const rows = assignNametagTeamNames(pending.map(entry => ({
                ...entry,
                base: originalRawTeamNameFor(entry.name)
            })));

            const activeKeys = new Set();
            rows.forEach(({ key, name, teamName, teamState, prefix, suffix }) => {
                activeKeys.add(key);
                const previous = nametagTeams.get(key);
                if (previous && previous.teamName !== teamName) {
                    // The player moved (re-teamed by Hypixel, or a teammate
                    // joined their team and shifted the index). Drop the old
                    // overlay team first: leaving it behind would keep the
                    // client's stale sort key alive for that row.
                    try {
                        writeScoreboardTeamPacket({ team: previous.teamName, mode: 1 });
                    } catch (e) {}
                    nametagTeams.delete(key);
                }

                const existing = nametagTeams.get(key);
                const color = legacyColorToPacketColor(teamState.color);
                const friendlyFire = teamState.friendlyFire ?? 0;
                const nameTagVisibility = teamState.nameTagVisibility || 'always';
                if (!existing) {
                    writeNametagTeam(teamName, teamState, 0, [name]);
                } else {
                    // Membership packets do not update team properties. In
                    // particular, a visibility-only change must reach the
                    // client even when the annotation text stays the same.
                    if (existing.prefix !== prefix || existing.suffix !== suffix
                        || existing.color !== color || existing.friendlyFire !== friendlyFire
                        || existing.nameTagVisibility !== nameTagVisibility) {
                        writeNametagTeam(teamName, teamState, 2, []);
                    }
                    // Re-assert membership so our team wins if Hypixel re-grouped the player.
                    writeNametagTeam(teamName, teamState, 3, [name]);
                }
                nametagTeams.set(key, { teamName, prefix, suffix, name, color, friendlyFire, nameTagVisibility });
            });

            Array.from(nametagTeams.keys()).forEach(key => {
                if (activeKeys.has(key)) return;
                const entry = nametagTeams.get(key);
                removeNametagTeam(key, entry?.name);
            });
        }

        // Which of the three nametag audiences a player belongs to. Mutually
        // exclusive: a same-team player is always 'teammates'; an enemy is
        // 'threats' if they are nicked, clear the stat-threat thresholds, or
        // carry a tag, otherwise 'others'.
        //
        // A nick counts because it is at least as strong a signal as an
        // Urchin/Seraph tag - an enemy hiding their identity is exactly what
        // the threats audience is for. It also has no stats to clear a
        // threshold with, so without this a nicked player landed in 'others',
        // which is off by default: their tab row said [NICK] while nothing at
        // all rendered above their head.
        function classifyNametagAudience(name, row) {
            if (isSameTeamAsClient(name)) return 'teammates';
            const threat = Boolean(row?.isNicked)
                || isNametagStatThreat(row, state.threatConfig)
                || nametagRowHasTag(row);
            return threat ? 'threats' : 'others';
        }

        function nametagAudienceConfig(audience) {
            if (audience === 'teammates') {
                return {
                    enabled: nametagTeammatesEnabled,
                    prefix: nametagTeammatesPrefix,
                    prefixFallback: nametagTeammatesPrefixFallback,
                    suffix: nametagTeammatesSuffix,
                    suffixFallback: nametagTeammatesSuffixFallback
                };
            }
            if (audience === 'threats') {
                return {
                    enabled: nametagThreatsEnabled,
                    prefix: nametagThreatsPrefix,
                    prefixFallback: nametagThreatsPrefixFallback,
                    suffix: nametagThreatsSuffix,
                    suffixFallback: nametagThreatsSuffixFallback
                };
            }
            return {
                enabled: nametagOthersEnabled,
                prefix: nametagOthersPrefix,
                prefixFallback: nametagOthersPrefixFallback,
                suffix: nametagOthersSuffix,
                suffixFallback: nametagOthersSuffixFallback
            };
        }

        function anyNametagAudienceEnabled() {
            return nametagTeammatesEnabled || nametagThreatsEnabled || nametagOthersEnabled;
        }

        function anyNametagAudienceUsesGuild() {
            return ['teammates', 'threats', 'others'].some(audience => {
                const cfg = nametagAudienceConfig(audience);
                return cfg.enabled && [cfg.prefix, cfg.prefixFallback, cfg.suffix, cfg.suffixFallback].includes('guild');
            });
        }

        function anyNametagAudienceUsesSession() {
            return ['teammates', 'threats', 'others'].some(audience => {
                const cfg = nametagAudienceConfig(audience);
                return cfg.enabled && [cfg.prefix, cfg.prefixFallback, cfg.suffix, cfg.suffixFallback].some(stat => NAMETAG_SESSION_STATS.includes(stat));
            });
        }

        function nametagSessionPeriodsInUse() {
            const periods = new Set();
            ['teammates', 'threats', 'others'].forEach(audience => {
                const cfg = nametagAudienceConfig(audience);
                if (!cfg.enabled) return;
                [cfg.prefix, cfg.prefixFallback, cfg.suffix, cfg.suffixFallback].forEach(stat => {
                    const period = nametagSessionPeriod(stat);
                    if (period) periods.add(period);
                });
            });
            return Array.from(periods);
        }

        function computeNametagFields(name, prefixBudget = MAX_TEAM_FIELD, coloredStarPrefixBudget = prefixBudget) {
            const key = nickKey(name);
            const row = overlayPlayerStats.get(key);
            if (!row) return { prefixExtra: '', suffix: '' };
            const audience = classifyNametagAudience(name, row);
            const cfg = nametagAudienceConfig(audience);
            if (!cfg.enabled) return { prefixExtra: '', suffix: '' };
            if ([cfg.prefix, cfg.prefixFallback, cfg.suffix, cfg.suffixFallback].includes('guild')) {
                row.guildTag = nametagGuildTags.get(key) || row.guildTag || '';
            }
            if ([cfg.prefix, cfg.prefixFallback, cfg.suffix, cfg.suffixFallback].some(stat => NAMETAG_SESSION_STATS.includes(stat))) {
                row.sessions = nametagSessionStats.get(key) || row.sessions || {};
                row.session = row.sessions.daily || row.session || {};
            }
            return buildNametagFields(row, {
                compactTagName,
                // The name-shape bot filter is there to keep [NICK] off
                // Hypixel's armour-stand and NPC entities. A player with a tab
                // row is neither, whatever their nick happens to read like -
                // applying it to them hid [NICK] above their head while their
                // tab row still showed it.
                isLikelyBot: isKnownTabPlayer(name) ? null : isLikelyBot,
                priority: nametagSourcePriority,
                audience: {
                    prefix: cfg.prefix,
                    prefixFallback: cfg.prefixFallback,
                    suffix: cfg.suffix,
                    suffixFallback: cfg.suffixFallback
                },
                isTeammate: audience === 'teammates',
                starBracketsEnabled: nametagStarBracketsEnabled,
                tagDisplayMode: nametagTagDisplayMode,
                prefixBudget,
                coloredStarPrefixBudget
            });
        }

        function writeNametagTeam(teamName, teamState, mode, players = []) {
            try {
                writeScoreboardTeamPacket({
                    team: teamName,
                    mode,
                    name: teamName,
                    // Hard guard: the 1.8 client caps prefix/suffix at 16 chars
                    // and disconnects on overflow. buildNametagFields already
                    // fits 16; clamp here too so nothing can ever crash the client.
                    prefix: clampTeamField(teamState.prefix || ''),
                    suffix: clampTeamField(teamState.suffix || ''),
                    friendlyFire: teamState.friendlyFire ?? 0,
                    nameTagVisibility: teamState.nameTagVisibility || 'always',
                    color: legacyColorToPacketColor(teamState.color),
                    players
                });
            } catch (e) {}
        }

        function restorePlayerOriginalTeam(name) {
            const trusted = trustedOriginalScoreboardTeamForPlayer(name);
            if (!trusted?.rawTeamName) return false;
            // Both packets below address an existing team: a 1.8 client applies
            // neither to a team it no longer has, and a mode-2 for an unknown
            // team is worse than useless. Say so instead of pretending the
            // player was seated.
            if (!originalScoreboardTeamsOnClient.has(trusted.rawTeamName)) return false;
            if (trusted.teamInfo) {
                writeOriginalScoreboardTeamUpdate(trusted.rawTeamName, trusted.teamInfo, [name]);
                return true;
            }
            try {
                writeScoreboardTeamPacket({ team: trusted.rawTeamName, mode: 3, players: [name] });
            } catch (e) {}
            return true;
        }

        // Seat the player back in their Hypixel team *before* dropping ours:
        // the client moves a player out of their current team as it adds them
        // to the new one, so ours is empty by the time it is deleted and the
        // player is never briefly in no team at all - which would sort their
        // tab row above every team block and strip their nametag colour.
        //
        // When there is nowhere to put them back, keep our team instead. It
        // renders exactly like Hypixel's (colour + team letter, no extras) and
        // sorts in the same place, and the next sync retries the handover.
        function removeNametagTeam(key, name, { restore = true } = {}) {
            const restored = restore && name ? restorePlayerOriginalTeam(name) : false;
            if (restore && name && !restored) return false;

            const existing = nametagTeams.get(key);
            if (existing) {
                try {
                    writeScoreboardTeamPacket({ team: existing.teamName, mode: 1 });
                } catch (e) {}
                nametagTeams.delete(key);
            }
            return true;
        }

        function syncNametagTeams() {
            if (isNametagOverlayActiveDuels()) {
                syncNametagTeamsDuels();
                return;
            }
            if (!isNametagOverlayActive()) {
                clearNametagTeams();
                return;
            }

            const pending = [];
            Array.from(gameRoster).forEach(name => {
                if (!isValidPlayerName(name) || isOwnPlayerName(name)) return;
                if (isDenickAliasDuplicate(name)) return;
                const key = nickKey(name);
                if (isPlayerEntityInvisible(name) || isPlayerHiddenByTeamRemoval(name)) {
                    // No restore: re-adding an invisible player to any team
                    // would force their nametag to render again. Hypixel
                    // re-teams them itself when the invisibility ends.
                    if (nametagTeams.has(key)) removeNametagTeam(key, name, { restore: false });
                    return;
                }
                const info = lobbyPlayers.get(name);
                if (!info) return;
                const teamDef = resolveBedwarsTeamDef(info, name);
                if (!teamDef) return;

                const basePrefix = `${teamDef.color}${teamDef.letter} `;
                // Prefix stat shares the 16-char prefix field with the team
                // letter and the trailing colour reset, so budget what's left.
                const prefixBudget = Math.max(0, MAX_TEAM_FIELD - basePrefix.length - (String(teamDef.color || '').length + 1));
                // A bracketed star may use the cosmetic gap/team-letter space
                // when necessary. The full numeric level always wins; the
                // player's team color is still re-applied before their name.
                const coloredStarPrefixBudget = Math.max(
                    prefixBudget,
                    MAX_TEAM_FIELD - String(teamDef.color || '').length
                );
                const { prefixExtra, suffix } = computeNametagFields(name, prefixBudget, coloredStarPrefixBudget);
                if (!prefixExtra && !suffix) {
                    // Nothing to annotate: hand the player back to Hypixel's
                    // team. If that is not possible right now, fall through and
                    // keep ours rather than leaving the player in no team -
                    // with no extras it renders exactly like Hypixel's own.
                    if (!nametagTeams.has(key)) return;
                    if (removeNametagTeam(key, name)) return;
                }

                const original = findScoreboardTeamForPlayer(name)?.teamInfo;
                // Fury's custom prefix is the first thing the player sees;
                // Hypixel's colored team letter stays immediately before the
                // name (for example: "225✫ R Niels" instead of "R 225✫ Niels").
                const prefix = composeBedwarsNametagPrefix(teamDef.color, teamDef.letter, prefixExtra);
                const teamState = {
                    prefix,
                    suffix,
                    color: teamDef.color,
                    friendlyFire: info.friendlyFire ?? original?.friendlyFire ?? 0,
                    nameTagVisibility: info.nameTagVisibility || original?.nameTagVisibility || 'always'
                };
                pending.push({ key, name, prefix, suffix, teamState });
            });

            applyNametagTeamAssignments(pending);
        }

        function scheduleNametagSync(delay = 80) {
            if (!nametagOverlayEnabled) return;
            if (nametagSyncTimer) clearTimeout(nametagSyncTimer);
            nametagSyncTimer = setTimeout(() => {
                nametagSyncTimer = null;
                syncNametagTeams();
            }, delay);
        }

        function clearNametagFetchTimers() {
            nametagFetchTimers.forEach(timer => clearTimeout(timer));
            nametagFetchTimers.clear();
            if (nametagConfigRefreshTimer) {
                clearTimeout(nametagConfigRefreshTimer);
                nametagConfigRefreshTimer = null;
            }
        }

        async function ensureNametagGuildTag(name) {
            const key = nickKey(name);
            if (nametagGuildTags.has(key)) return;
            const uuid = lobbyPlayers.get(name)?.uuid;
            if (!uuid) return;
            try {
                const guild = await getHypixelGuildRaw(uuid);
                nametagGuildTags.set(key, guild?.tag ? String(guild.tag) : '');
            } catch (e) {
                nametagGuildTags.set(key, '');
            }
        }

        function compactNametagSession(session) {
            const delta = session?.delta || null;
            if (!delta || session?.error) return {};
            const bw = delta?.stats?.Bedwars || {};
            const num = (value) => {
                if (typeof value === 'number') return value;
                if (value && typeof value === 'object') {
                    const next = Number(value.new);
                    const prev = Number(value.old);
                    if (Number.isFinite(next)) return Number.isFinite(prev) ? next - prev : next;
                }
                return 0;
            };
            const finals = num(bw.final_kills_bedwars);
            const finalDeaths = num(bw.final_deaths_bedwars);
            const wins = num(bw.wins_bedwars);
            const losses = num(bw.losses_bedwars);
            return {
                finals,
                wins,
                fkdr: finalDeaths > 0 ? finals / finalDeaths : (finals > 0 ? finals : NaN),
                wlr: losses > 0 ? wins / losses : (wins > 0 ? wins : NaN)
            };
        }

        // Reuse Coral's existing session endpoint only for periods referenced
        // by enabled rules. Empty results are memoised per game and period.
        async function ensureNametagSessionStats(name) {
            const key = nickKey(name);
            const cached = nametagSessionStats.get(key) || {};
            const missingPeriods = nametagSessionPeriodsInUse()
                .filter(period => !Object.prototype.hasOwnProperty.call(cached, period));
            if (!missingPeriods.length) return;
            missingPeriods.forEach(period => { cached[period] = {}; });
            nametagSessionStats.set(key, cached);
            await Promise.all(missingPeriods.map(async period => {
                try {
                    cached[period] = compactNametagSession(await fetchUrchinSession(name, period));
                } catch (e) {
                    cached[period] = {};
                }
            }));
            nametagSessionStats.set(key, cached);
        }

        async function fetchNametagStatsForPlayer(name, sessionId, options = {}) {
            if (!isNametagOverlayActive() || sessionId !== gameSessionId) return;
            if (isDenickAliasDuplicate(name)) return;
            if (!gameRoster.has(name) || !isEligibleForCurrentGameRoster(name)) return;
            const info = lobbyPlayers.get(name);
            if (!info?.uuid) return;
            const knownDenick = getAutoDenickResult(name);
            const profile = await getStatsProfileForRosterPlayer(name, {
                denickResult: knownDenick,
                lookup: { apiPriority: 'game' }
            });
            if (!isNametagOverlayActive() || sessionId !== gameSessionId || !gameRoster.has(name)) return;
            if (profile?.data?.isNicked) markNickedPlayer(name, 'nametags');
            let displayProfile = profile;
            const denickResult = getAutoDenickResult(name);
            if (denickResult?.realName) {
                const realProfile = await getPlayerData(denickResult.realName, { includeErrors: true });
                if (realProfile?.data?.player && !realProfile.error) displayProfile = realProfile;
            }
            rememberOverlayPlayer(name, displayProfile, {
                mode: currentGamemode,
                source: denickResult?.realName ? 'denick_nametags' : 'nametags',
                info: lobbyPlayers.get(name) || info,
                denickResult
            });
            if (anyNametagAudienceUsesGuild()) await ensureNametagGuildTag(name);
            if (anyNametagAudienceUsesSession()) await ensureNametagSessionStats(name);
            scheduleNametagSync();
        }

        // Self-sufficient roster fetch: when nametags are on but Tab Stats isn't
        // already pulling the roster, fetch stats for every roster player
        // (teammates included) so the configured stats can render. Reuses the
        // rate-limited lookup path and writes no tab display names.
        function refreshNametagRosterStats() {
            if (!isNametagOverlayActive() || !anyNametagAudienceEnabled()) return;
            if (isTabStatsActiveInGame()) return;
            seedGameRoster();
            const names = Array.from(gameRoster).slice(0, 32);
            if (names.length === 0) return;
            const sessionId = gameSessionId;
            clearNametagFetchTimers();
            const dispatch = () => {
                if (sessionId !== gameSessionId || !isNametagOverlayActive()) return;
                names.forEach((name, index) => {
                    const timer = setTimeout(() => {
                        nametagFetchTimers.delete(timer);
                        fetchNametagStatsForPlayer(name, sessionId);
                    }, index * HYPIXEL_API_GAME_MIN_SPACING_MS);
                    nametagFetchTimers.add(timer);
                });
            };
            getUrchinBatchRaw(names).then(dispatch).catch(dispatch);
        }

        // Config edits (rule picker clicks, presets, audience toggles) redraw
        // from the rows already in memory, so they are free. Only a coalesced,
        // delayed refresh may touch the API again - clicking through a picker
        // can never turn into a burst of lookups.
        function applyNametagConfigChange() {
            const bedwarsActive = isNametagOverlayActive();
            const duelsActive = isNametagOverlayActiveDuels();
            if (!bedwarsActive && !duelsActive) return;
            syncNametagTeams();
            if (nametagConfigRefreshTimer) clearTimeout(nametagConfigRefreshTimer);
            nametagConfigRefreshTimer = setTimeout(() => {
                nametagConfigRefreshTimer = null;
                const refreshBedwars = isNametagOverlayActive();
                const refreshDuels = isNametagOverlayActiveDuels();
                if (!refreshBedwars && !refreshDuels) return;
                if (refreshBedwars) refreshNametagRosterStats();
                else refreshNametagRosterStatsDuels();
                syncNametagTeams();
            }, 1200);
        }

        // === Duels nametag overlay =========================================
        // Everyone currently in the duel except the client. Sourced from the
        // tab list (lobbyPlayers) since duels has no Bedwars scoreboard teams.
        function duelsNametagRosterNames() {
            const now = Date.now();
            return Array.from(lobbyPlayers.entries())
                .filter(([name, player]) => isValidPlayerName(name)
                    && !isOwnPlayerName(name)
                    && !isDenickAliasDuplicate(name)
                    && player.inTab
                    && now - (player.lastSeen || 0) < 90 * 1000)
                .map(([name]) => name);
        }

        async function fetchNametagStatsForPlayerDuels(name, sessionId, options = {}) {
            if (!isNametagOverlayActiveDuels() || sessionId !== duelsState.sessionId) return;
            if (isDenickAliasDuplicate(name) || isOwnPlayerName(name)) return;
            const info = lobbyPlayers.get(name);
            if (!info?.uuid) return;
            const knownDenick = getAutoDenickResult(name);
            const profile = await getStatsProfileForRosterPlayer(name, {
                denickResult: knownDenick,
                lookup: { apiPriority: 'game' }
            });
            if (!isNametagOverlayActiveDuels() || sessionId !== duelsState.sessionId) return;
            if (profile?.data?.isNicked) markNickedPlayer(name, 'nametags');
            let displayProfile = profile;
            const denickResult = getAutoDenickResult(name);
            if (denickResult?.realName) {
                const realProfile = await getPlayerData(denickResult.realName, { includeErrors: true });
                if (realProfile?.data?.player && !realProfile.error) displayProfile = realProfile;
            }
            rememberOverlayPlayer(name, displayProfile, {
                mode: 'DUELS',
                duelsModeDef: duelsState.modeDef || DUELS_MODE_DEFS[0],
                source: denickResult?.realName ? 'denick_nametags_duels' : 'nametags_duels',
                info: lobbyPlayers.get(name) || info,
                denickResult
            });
            scheduleNametagSync();
        }

        function refreshNametagRosterStatsDuels() {
            if (!isNametagOverlayActiveDuels()) return;
            const names = duelsNametagRosterNames().slice(0, 16);
            if (names.length === 0) return;
            const sessionId = duelsState.sessionId;
            clearNametagFetchTimers();
            const dispatch = () => {
                if (sessionId !== duelsState.sessionId || !isNametagOverlayActiveDuels()) return;
                names.forEach((name, index) => {
                    const timer = setTimeout(() => {
                        nametagFetchTimers.delete(timer);
                        fetchNametagStatsForPlayerDuels(name, sessionId);
                    }, index * HYPIXEL_API_GAME_MIN_SPACING_MS);
                    nametagFetchTimers.add(timer);
                });
            };
            getUrchinBatchRaw(names).then(dispatch).catch(dispatch);
        }

        function scheduleDuelsNametagRefresh(delay = 800) {
            if (!isNametagOverlayActiveDuels()) return;
            if (duelsNametagRefreshTimer) clearTimeout(duelsNametagRefreshTimer);
            const sessionId = duelsState.sessionId;
            duelsNametagRefreshTimer = setTimeout(() => {
                duelsNametagRefreshTimer = null;
                if (sessionId !== duelsState.sessionId || !isNametagOverlayActiveDuels()) return;
                refreshNametagRosterStatsDuels();
                scheduleNametagSync();
            }, delay);
        }

        function syncNametagTeamsDuels() {
            const pending = [];
            duelsNametagRosterNames().forEach(name => {
                if (isOwnPlayerName(name)) return;
                const key = nickKey(name);
                if (isPlayerEntityInvisible(name)) {
                    if (nametagTeams.has(key)) removeNametagTeam(key, name, { restore: false });
                    return;
                }
                const row = overlayPlayerStats.get(nickKey(name));
                if (!row) return;
                // A 1.8 client renders a nametag as team prefix + name + team
                // suffix; the team's colour byte is not applied to it. Hypixel
                // colours a duels opponent by putting the colour code in their
                // team prefix, so once we replace that prefix the colour has to
                // be carried over or the name renders plain white.
                //
                // The raw team's own prefix is the most faithful source - it is
                // literally what the client was rendering - with the parsed
                // team colour and the API rank colour behind it.
                const original = findScoreboardTeamForPlayer(name)?.teamInfo;
                const rawTeamPrefix = rawScoreboardTeams.get(scoreboardEntryTeams.get(String(name || '')) || '')?.prefix;
                const nameColor = leadingScoreboardColor(rawTeamPrefix)
                    || original?.color
                    || row.rankNameColorCode
                    || row.nameColorCode
                    || '§7';
                // Budget the reset, its separating space and the re-applied
                // colour out of the 16-character prefix field, or clamping
                // would cut the colour back off and undo all of this.
                const duelsPrefixBudget = Math.max(0, MAX_TEAM_FIELD - nameColor.length - 3);
                const { prefixExtra, suffix } = buildNametagFields(row, {
                    compactTagName,
                    // See computeNametagFields: a player in the tab list is not
                    // one of Hypixel's name-shaped entities.
                    isLikelyBot: isKnownTabPlayer(name) ? null : isLikelyBot,
                    priority: nametagSourcePriority,
                    audience: { prefixStat: 'wlr', suffixStat: 'kdr' },
                    tagDisplayMode: nametagTagDisplayMode,
                    prefixBudget: duelsPrefixBudget
                });
                if (!prefixExtra && !suffix) {
                    if (nametagTeams.has(key)) removeNametagTeam(key, name);
                    return;
                }
                // No BedWars team letter in duels: the WLR prefix sits directly
                // before the name, then a reset so its colour cannot bleed into
                // the name, then the name's own colour.
                const prefix = prefixExtra ? `${prefixExtra}§r ${nameColor}` : nameColor;
                const teamState = {
                    prefix,
                    suffix,
                    color: nameColor,
                    friendlyFire: 0,
                    nameTagVisibility: 'always'
                };
                pending.push({ key, name, prefix, suffix, teamState });
            });

            applyNametagTeamAssignments(pending);
        }

        function clearNametagTeams({ restoreOriginalTeams = false } = {}) {
            clearNametagFetchTimers();
            nametagGuildTags.clear();
            nametagSessionStats.clear();
            if (nametagSyncTimer) {
                clearTimeout(nametagSyncTimer);
                nametagSyncTimer = null;
            }
            Array.from(nametagTeams.entries()).forEach(([, entry]) => {
                try {
                    writeScoreboardTeamPacket({ team: entry.teamName, mode: 1 });
                } catch (e) {}
                if (restoreOriginalTeams && entry.name) restorePlayerOriginalTeam(entry.name);
            });
            nametagTeams.clear();
        }

        function clearDelayedRosterSync() {
            if (delayedRosterSyncTimer) clearTimeout(delayedRosterSyncTimer);
            delayedRosterSyncTimer = null;
        }

        function scheduleDelayedRosterSync(delay = 500) {
            clearDelayedRosterSync();
            const rosterSessionId = gameSessionId;
            delayedRosterSyncTimer = setTimeout(() => {
                delayedRosterSyncTimer = null;
                if (!gameActive || currentGamemode !== 'BEDWARS' || gameSessionId !== rosterSessionId) return;
                seedGameRoster();
            }, delay);
        }

        // Periodic BedWars team audit.
        //
        // The two ways a player's colour could drift are both closed at the
        // packet level now (updateRawScoreboardTeam evicts a player from the
        // team they left, applyPlayersToScoreboardTeam refuses to let a
        // colour's whole-set refresh speak for someone who lives elsewhere).
        // This is the backstop: a match runs for ten minutes, and any single
        // assignment we get wrong otherwise stays on screen for the rest of it
        // - a teammate rendered, sorted and coloured as an enemy, which also
        // decides their nametag audience and whether auto-denick targets them.
        //
        // Deliberately read-only unless something actually disagrees. A
        // correction re-renders the tab row and re-seats the player in their
        // Hypixel team, and doing that on a timer for everybody would fight the
        // nametag overlay for the client's team map every few seconds.
        const BEDWARS_TEAM_AUDIT_INTERVAL_MS = 4000;

        // Capture evidence without seeding the roster, running an audit, or repainting
        // anything: a diagnostic command must preserve the failure being reported.
        function buildTeamDebugState() {
            const teamView = (name, info = {}) => ({
                name, isBedwarsTeam: info.isBedwarsTeam, prefix: info.prefix, suffix: info.suffix,
                color: info.color, letter: info.letter, friendlyFire: info.friendlyFire,
                bedwarsEvidence: info.bedwarsEvidence || null,
                nameTagVisibility: info.nameTagVisibility,
                players: Array.from(info.players || []).slice(0, 128),
                rawTeamIds: Array.from(info.rawTeamIds || []).slice(0, 128)
            });
            return {
                version: require('./package.json').version, platform: process.platform,
                account: client.username, route: options.route || null,
                currentGamemode, gameActive, gameSessionId, gameStartTime, activeMatchServerId, myTeam,
                features: { tabStatsEnabled, nametagOverlayEnabled, showDenickedRealIgn,
                    denickRealIgnNametags: state.denickRealIgnNametags,
                    friendAliasEnabled: state.friendAliasEnabled },
                teamAuditScheduled: Boolean(bedwarsTeamAuditTimer),
                pendingTabUpdates: Array.from(tabStatsTimers.keys()).slice(0, 128),
                roster: Array.from(gameRoster).slice(0, 128),
                players: Array.from(lobbyPlayers).slice(0, 128).map(([name, info]) => ({
                    name, uuid: info.uuid, inTab: info.inTab, inRoster: gameRoster.has(name),
                    cachedTeam: info.team, cachedRawTeam: info.rawTeam, activeScoreboardTeam: info.activeScoreboardTeam,
                    color: info.color, letter: info.letter, teamAssignedAt: info.teamAssignedAt,
                    originalDisplayName: info.originalDisplayName, displayColor: info.displayColor,
                    rawTeam: scoreboardEntryTeams.get(name) || null,
                    liveTeam: liveBedwarsTeamInfo(name)?.name || null,
                    displayFallbackTeam: getOriginalBedwarsTeamInfo(info, name)?.name || null,
                    resolvedTeam: resolveBedwarsTeamDef(info, name)?.name || null,
                    registryTeam: findScoreboardTeamForPlayer(name)?.baseTeamName || null,
                    nametag: nametagTeams.get(nickKey(name)) || null,
                    lastSeen: info.lastSeen, leftTabAt: info.leftTabAt
                })),
                rawTeams: Array.from(rawScoreboardTeams).slice(0, 512).map(([name, info]) => teamView(name, info)),
                registry: Array.from(scoreboardTeamRegistry).slice(0, 512).map(([name, info]) => teamView(name, info)),
                aliases: Array.from(scoreboardTeamAliases).slice(0, 512),
                originalTeamsOnClient: Array.from(originalScoreboardTeamsOnClient).slice(0, 512),
                renames: denickDisplayNames.activeRenames().slice(0, 128).map(({ nick, real }) => ({ nick, real })),
                lastMatchSnapshot: lastMatchSnapshot ? {
                    at: lastMatchSnapshot.at, serverId: lastMatchSnapshot.serverId, mode: lastMatchSnapshot.mode,
                    gameStartTime: lastMatchSnapshot.gameStartTime,
                    teams: (lastMatchSnapshot.lobbyPlayers || []).slice(0, 128).map(([name, info]) => [name, info.team, info.rawTeam])
                } : null
            };
        }

        async function handleTeamDebugCommand(args) {
            const values = args.slice(1).filter(Boolean);
            const player = values[0] || '';
            const expectedTeam = values[1] ? exactBedwarsTeamInfo(values[1])?.name : null;
            if (values.length > 2 || (player && !isValidPlayerName(player)) || (values[1] && !expectedTeam)) {
                sendChat(client, '§6[Team debug] §7Usage: §f/teamdebug [player] [Red|Blue|Green|Yellow|Aqua|White|Pink|Gray]');
                return;
            }
            try {
                const report = await teamDebug.save(buildTeamDebugState(), { player: player || null, expectedTeam });
                console.log(`[TeamDebug] Saved ${report.events} events: ${report.file}`);
                sendChat(client, '§6[Team debug] §aReport saved. §7It includes recent team packets and the current display state.');
                sendChat(client, `§6[Team debug] §7File: §f${report.file}`);
            } catch (error) {
                sendChat(client, `§6[Team debug] §c${error?.message || 'Could not save the team report.'}`);
            }
        }

        function auditBedwarsTeamAssignments() {
            if (!gameActive || currentGamemode !== 'BEDWARS') return [];

            const corrected = [];
            Array.from(gameRoster).forEach(name => {
                const info = lobbyPlayers.get(name);
                if (!info) return;
                // Audit only against the strongest evidence there is: the
                // player -> raw-team map, rebuilt straight from Hypixel's
                // packets. With no live mapping the cached record is all we
                // have, and overwriting it from a weaker guess is the exact
                // failure this audit exists to catch.
                if (!scoreboardEntryTeams.has(String(name || ''))) return;
                const liveTeam = liveBedwarsTeamInfo(name);
                if (!liveTeam || info.team === liveTeam.name) return;

                teamDebug.mark('team_audit_correction', { player: name, before: info.team, after: liveTeam.name, rawTeam: scoreboardEntryTeams.get(name) });

                info.team = liveTeam.name;
                info.rawTeam = scoreboardEntryTeams.get(String(name || '')) || info.rawTeam || null;
                info.activeScoreboardTeam = liveTeam.name;
                info.color = liveTeam.color;
                info.letter = liveTeam.letter;
                info.teamAssignedAt = Date.now();
                lobbyPlayers.set(name, info);
                if (isOwnPlayerName(name)) myTeam = liveTeam.name;
                corrected.push(name);
            });

            if (corrected.length === 0) return corrected;

            // Repaint only what moved. The nametag sync re-derives each overlay
            // team name from the corrected Hypixel team, which is what puts the
            // row back in its own colour's block in the tab list.
            corrected.forEach((name, index) => queueTabStatsUpdate(name, index * 75));
            scheduleBedwarsClientTeamSync();
            if (isNametagOverlayActive()) scheduleNametagSync();
            scheduleCurrentMatchSnapshot('team_audit');
            return corrected;
        }

        function clearBedwarsTeamAudit() {
            if (bedwarsTeamAuditTimer) clearTimeout(bedwarsTeamAuditTimer);
            bedwarsTeamAuditTimer = null;
        }

        function scheduleBedwarsTeamAudit(delay = BEDWARS_TEAM_AUDIT_INTERVAL_MS) {
            if (bedwarsTeamAuditTimer) return;
            if (!gameActive || currentGamemode !== 'BEDWARS') return;
            const auditSessionId = gameSessionId;
            bedwarsTeamAuditTimer = setTimeout(() => {
                bedwarsTeamAuditTimer = null;
                if (!gameActive || currentGamemode !== 'BEDWARS' || gameSessionId !== auditSessionId) return;
                auditBedwarsTeamAssignments();
                scheduleBedwarsTeamAudit();
            }, delay);
        }

        const TAB_STATS_PERIOD_FKDR_FIELDS = {
            dailyfkdr: 'daily',
            weeklyfkdr: 'weekly',
            monthlyfkdr: 'monthly'
        };

        function tabStatsFieldsForMode(mode = currentGamemode) {
            return (mode === 'SKYWARS' ? tabStatsSkywarsFields : tabStatsBedwarsFields).slice();
        }

        function tabStatsSessionPeriodsInUse(mode = currentGamemode) {
            if (mode !== 'BEDWARS') return [];
            return Array.from(new Set(tabStatsFieldsForMode(mode)
                .map(field => TAB_STATS_PERIOD_FKDR_FIELDS[field])
                .filter(Boolean)));
        }

        async function ensureTabStatsSupplementalData(name, profile, mode, denickResult = null) {
            const fields = tabStatsFieldsForMode(mode);
            const needsGuild = fields.includes('guild');
            const periods = tabStatsSessionPeriodsInUse(mode);
            if (!needsGuild && periods.length === 0) return;

            const key = nickKey(name);
            const generation = tabStatsSupplementalGeneration;
            const player = profile?.data?.player || {};
            if (!player.uuid && !player.displayname) return;
            const lookupName = denickResult?.realName || player.displayname || name;
            const tasks = [];

            if (needsGuild && !tabStatsGuildTags.has(key)) {
                // Claim the cache slot before awaiting so concurrent tab updates
                // for the same player share the one normal Hypixel guild lookup.
                tabStatsGuildTags.set(key, '');
                const uuid = player.uuid || lobbyPlayers.get(name)?.uuid;
                tasks.push((async () => {
                    try {
                        const guild = await getHypixelGuildRaw(uuid);
                        if (generation === tabStatsSupplementalGeneration) {
                            tabStatsGuildTags.set(key, guild?.tag ? String(guild.tag).trim() : '');
                        }
                    } catch (error) {
                        if (generation === tabStatsSupplementalGeneration) tabStatsGuildTags.set(key, '');
                    }
                })());
            }

            if (periods.length) {
                const cached = tabStatsSessionStats.get(key) || {};
                const missingPeriods = periods.filter(period => !Object.prototype.hasOwnProperty.call(cached, period));
                if (missingPeriods.length) {
                    // `null` is an in-flight / unavailable placeholder. It keeps
                    // subsequent name/latency packet updates from duplicating
                    // Coral requests while the first row update is still running.
                    missingPeriods.forEach(period => { cached[period] = null; });
                    tabStatsSessionStats.set(key, cached);
                    tasks.push(Promise.all(missingPeriods.map(async period => {
                        try {
                            cached[period] = compactNametagSession(await fetchUrchinSession(lookupName, period));
                        } catch (error) {
                            cached[period] = {};
                        }
                    })).then(() => {
                        if (generation === tabStatsSupplementalGeneration) tabStatsSessionStats.set(key, cached);
                    }));
                }
            }

            if (tasks.length) await Promise.all(tasks);
        }

        // The alias to print for a tab row, or null. Looked up under the real
        // IGN first so one entry covers a friend nicked or not, then under the
        // rendered name so a nick can be aliased before it is ever denicked -
        // the same order the in-world resolver uses.
        function friendAliasForTab(name, denickResult = null) {
            if (!friendAliasesActive('tab') || isOwnPlayerName(name)) return null;
            const real = denickResult?.realName
                || getAutoDenickResult(name)?.realName
                || findKnownDenickByNick(name)?.realIGN
                || null;
            return (real ? findFriendAlias(real) : null) || findFriendAlias(name) || null;
        }

        // Keep the real IGN visible behind the alias, so renaming a player
        // never leaves you unable to tell who you are actually looking at.
        function friendAliasSuffix(entry) {
            if (!entry || !state.friendAliasShowRealIgn) return '';
            return ` §7(${entry.realIGN})`;
        }

        function buildTabStatsDisplay(name, profile, info = {}, mode = currentGamemode, options = {}) {
            const data = profile?.data;
            const denickResult = options.denickResult || getAutoDenickResult(name);
            const visualBedwarsTeam = mode === 'BEDWARS' ? resolveBedwarsTeamDef(info, name) : null;
            const originalNameColor = extractDisplayColor(info.originalDisplayName, name) || info.displayColor;
            // The tab row is text this proxy composes, so unlike the in-world
            // rename it can carry a colour of its own and needs no separate
            // toggle from the nametag one. `name` stays the roster key
            // throughout - only what gets printed changes.
            const friendAlias = friendAliasForTab(name, denickResult);
            const shownName = friendAlias?.alias || name;
            const nameColor = friendAlias?.color || (mode === 'BEDWARS'
                ? (visualBedwarsTeam?.color || originalNameColor || '§f')
                : getTabNameColor(info, name));
            const teamPrefix = mode === 'BEDWARS' && visualBedwarsTeam
                ? `${visualBedwarsTeam.color}${visualBedwarsTeam.letter} `
                : '';
            const namePart = `${teamPrefix}${nameColor}${shownName}`;
            const autoDenickSuffix = friendAlias
                ? friendAliasSuffix(friendAlias)
                : denickSuffix(name);
            const fields = tabStatsFieldsForMode(mode);
            // Same rule as the overlay row (see isKnownNickedPlayer): once a
            // player is a confirmed nick they stay [NICK] through every later
            // lookup failure, and only real player data takes the marker away.
            const knownNicked = isKnownNickedPlayer(name, data, denickResult);
            if (knownNicked || !data) {
                if (mode === 'BEDWARS') {
                    const nickIdentity = `${namePart}${autoDenickSuffix} ${formatNametagNick()}`;
                    const nickColumns = buildNickedBedwarsTabColumns(
                        fields,
                        formatBedwarsPrestige(0),
                        padTabIdentity(name, nickIdentity)
                    );
                    if (nickColumns.length) return nickColumns.map(column => column.text).join(' §8| ');
                }
                return mode === 'BEDWARS'
                    ? `${namePart}${autoDenickSuffix} ${formatNametagNick()}`
                    : `${formatNametagNick()} ${namePart}${autoDenickSuffix}`;
            }
            if (data.lookupFailed) {
                return mode === 'BEDWARS' ? `${namePart} \u00a76[FAIL]` : `\u00a76[FAIL] ${namePart}`;
            }

            const p = data.player || {};
            const tagText = formatTabTags(buildOverlayTags(data));
            const tags = tagText ? [tagText] : [];
            notifyUrchinOutageOnce(data.urchin);
            if (isUrchinRequestFailed(data.urchin)) tags.push(`§6[U:${shortUrchinStatusLabel(data.urchin)}]`);

            const bw = p.stats?.Bedwars || {};
            const sw = p.stats?.SkyWars || {};
            const isSkyWars = mode === 'SKYWARS';
            const wins = Number(isSkyWars ? sw.wins : bw.wins_bedwars) || 0;
            const losses = Number(isSkyWars ? sw.losses : bw.losses_bedwars) || 0;
            const kills = Number(isSkyWars ? sw.kills : bw.kills_bedwars) || 0;
            const deaths = Number(isSkyWars ? sw.deaths : bw.deaths_bedwars) || 0;
            const finals = Number(bw.final_kills_bedwars) || 0;
            const finalDeaths = Number(bw.final_deaths_bedwars) || 0;
            const fkdr = finals / Math.max(finalDeaths, 1);
            const kdr = kills / Math.max(deaths, 1);
            const wlr = wins / Math.max(losses, 1);
            const winstreak = Number(isSkyWars ? sw.winstreak : bw.winstreak) || 0;
            const ping = resolveTabPing(data.ping);
            // Prestige/level belongs to the identity column only for the exact
            // leading pair `name -> stars`. Any other layout intentionally
            // renders stars as an independent column, so drag order is honoured.
            const starsAttachedToName = fields[0] === 'name' && fields[1] === 'stars';
            const starText = isSkyWars
                ? formatSkyWarsLevel(sw, p)
                : formatBedwarsPrestige(p.achievements?.bedwars_level || 0);
            const identityText = `${namePart}${autoDenickSuffix}${starsAttachedToName && starText ? ` ${starText}` : ''}`;
            const supplementalKey = nickKey(name);
            const sessionStats = tabStatsSessionStats.get(supplementalKey) || {};
            const guildTag = String(tabStatsGuildTags.get(supplementalKey) || '').trim();
            const labelFor = (field, compact, full) => tabStatsLabelStyle === 'value' ? '' : `${tabStatsLabelStyle === 'full' ? full : compact}: `;
            const statPart = (field, compact, full, value, color) => `§f${labelFor(field, compact, full)}${color}${value}`;
            const periodFkdrPart = (field, period, compact, full) => {
                const value = Number(sessionStats?.[period]?.fkdr);
                return Number.isFinite(value) ? statPart(field, compact, full, value.toFixed(2), getFkdrColor(value)) : '';
            };
            const fieldText = field => {
                if (field === 'name') return padTabIdentity(name, identityText);
                if (field === 'stars') return starsAttachedToName ? '' : starText;
                if (field === 'tags') return showTagsInTabStats && tags.length ? tags.join('§8|') : '';
                if (field === 'fkdr') return tabStatsShowKillRatio ? statPart(field, 'F', 'FKDR', fkdr.toFixed(2), getFkdrColor(fkdr)) : '';
                if (field === 'dailyfkdr') return periodFkdrPart(field, 'daily', 'D.F', 'DAILY FKDR');
                if (field === 'weeklyfkdr') return periodFkdrPart(field, 'weekly', 'W.F', 'WEEKLY FKDR');
                if (field === 'monthlyfkdr') return periodFkdrPart(field, 'monthly', 'M.F', 'MONTHLY FKDR');
                if (field === 'kdr') return tabStatsShowKillRatio ? statPart(field, 'K', 'KDR', kdr.toFixed(2), getKdrColor(kdr)) : '';
                if (field === 'wlr') return tabStatsShowWinRatio ? statPart(field, 'W', 'WLR', wlr.toFixed(2), getWlrColor(wlr)) : '';
                if (field === 'finals') return statPart(field, 'FK', 'FINALS', String(finals), '§b');
                if (field === 'wins') return statPart(field, 'WIN', 'WINS', String(wins), '§a');
                if (field === 'ws') return statPart(field, 'WS', 'WS', String(winstreak), getWsColor(winstreak));
                if (field === 'guild') return guildTag ? `§6[${guildTag.slice(0, 10)}]` : '';
                if (field === 'ping') return ping !== null ? statPart(field, 'P', 'PING', `${Math.round(ping)}ms`, '§7') : '';
                return '';
            };
            const columns = fields.map(field => ({ field, text: fieldText(field) })).filter(column => column.text);
            if (!columns.some(column => column.field === 'name')) columns.unshift({ field: 'name', text: padTabIdentity(name, identityText) });
            while (columns.length > 1 && stripAnsi(columns.map(column => column.text).join(' | ')).length > 88) {
                const removable = columns.map(column => column.field).lastIndexOf('name') === columns.length - 1 ? columns.length - 2 : columns.length - 1;
                columns.splice(Math.max(0, removable), 1);
            }
            let baseLine = columns.map(column => column.text).join(' §8| ');
            let line = baseLine;
            if (denickResult?.realName) return line;
            return stripAnsi(line).length > 88 ? baseLine : line;
        }

        async function updateTabStatsForPlayer(name, sessionId = gameSessionId, options = {}) {
            if (!isTabStatsActiveInGame()) return;
            if (isDenickAliasDuplicate(name)) {
                cleanupDenickAliasDuplicate(name, 'tab_update_alias');
                return;
            }
            if (!isCurrentGameSession(sessionId) || !gameRoster.has(name) || !isEligibleForCurrentGameRoster(name)) return;
            const info = lobbyPlayers.get(name);
            if (!info?.uuid) return;
            const mode = currentGamemode;
            const uuid = info.uuid;

            applyKnownDenickFromHistory(name, 'tabstats_history', { queueUpdates: false });
            const knownDenickResult = getAutoDenickResult(name);
            const profile = await getStatsProfileForRosterPlayer(name, {
                denickResult: knownDenickResult,
                lookup: { apiPriority: 'game' }
            });
            if (!isTabStatsActiveInGame() || !isCurrentGameSession(sessionId) || currentGamemode !== mode || !gameRoster.has(name) || !isEligibleForCurrentGameRoster(name)) return;
            if (profile?.data?.isNicked) markNickedPlayer(name, 'tabstats');
            if (profile?.data?.player && !profile.data.isNicked && !profile.data.lookupFailed) {
                rememberPlayerActiveCosmetics(name, profile.data, 'tabstats');
            }
            const latestInfo = lobbyPlayers.get(name) || info;
            const denickResult = getAutoDenickResult(name);
            let displayProfile = profile;
            if (denickResult?.realName) {
                const realProfile = await getPlayerData(denickResult.realName, { includeErrors: true });
                if (realProfile?.data?.player && !realProfile.error) {
                    displayProfile = realProfile;
                    rememberPlayerActiveCosmetics(name, realProfile.data, 'denick_tabstats');
                    rememberPlayerActiveCosmetics(denickResult.realName, realProfile.data, 'denick_tabstats');
                }
            }
            if (!isCurrentGameSession(sessionId) || currentGamemode !== mode || !gameRoster.has(name) || !isEligibleForCurrentGameRoster(name)) return;
            await ensureTabStatsSupplementalData(name, displayProfile, mode, denickResult);
            if (!isCurrentGameSession(sessionId) || currentGamemode !== mode || !gameRoster.has(name) || !isEligibleForCurrentGameRoster(name)) return;
            rememberOverlayPlayer(name, displayProfile, {
                mode,
                source: denickResult?.realName ? 'denick_tabstats' : 'tabstats',
                info: latestInfo,
                denickResult
            });
            tabStatsProfileCache.set(name, {
                profile: displayProfile,
                mode,
                denickRealName: denickResult?.realName || ''
            });
            writeTabDisplayName(uuid, buildTabStatsDisplay(name, displayProfile, latestInfo, mode, { denickResult }));
            tabStatsAppliedNames.add(name);
            scheduleNametagSync();
        }

        function cachedTabStatsProfileForPlayer(name) {
            if (!name || !isSupportedTabStatsMode(currentGamemode)) return null;
            const denickResult = getAutoDenickResult(name);
            const denickRealName = denickResult?.realName || '';
            const remembered = tabStatsProfileCache.get(name);
            if (remembered?.profile && remembered.mode === currentGamemode && remembered.denickRealName === denickRealName) {
                return { profile: remembered.profile, denickResult };
            }

            const lookupName = denickRealName || name;
            const cached = globalCache.get(nickKey(lookupName));
            if (!cached?.data) return null;
            const profile = { data: cached.data, fromCache: true };
            tabStatsProfileCache.set(name, {
                profile,
                mode: currentGamemode,
                denickRealName
            });
            return { profile, denickResult };
        }

        function reapplyCachedTabStatsForPlayer(name) {
            if (!isTabStatsActiveInGame() || !name || isDenickAliasDuplicate(name)) return false;
            const info = lobbyPlayers.get(name);
            if (!info?.uuid) return false;
            const cached = cachedTabStatsProfileForPlayer(name);
            if (!cached) return false;
            writeTabDisplayName(info.uuid, buildTabStatsDisplay(name, cached.profile, info, currentGamemode, {
                denickResult: cached.denickResult
            }));
            tabStatsAppliedNames.add(name);
            return true;
        }

        function reapplyTabStatsFromCache() {
            if (!isTabStatsActiveInGame()) return 0;
            seedGameRoster();
            resetTabStatsLayout();
            let updated = 0;
            Array.from(gameRoster).slice(0, 32).forEach((name) => {
                if (reapplyCachedTabStatsForPlayer(name)) updated += 1;
            });
            return updated;
        }

        function refreshTabStatsImmediately() {
            reapplyTabStatsFromCache();
            refreshTabStatsForRoster();
        }

        function queueTabStatsUpdate(name, delay = 0, options = {}) {
            if (isDenickAliasDuplicate(name)) {
                cleanupDenickAliasDuplicate(name, 'tab_queue_alias');
                return;
            }
            if (!isTabStatsActiveInGame() || !gameRoster.has(name) || !isEligibleForCurrentGameRoster(name)) return;
            if (tabStatsTimers.has(name)) clearTimeout(tabStatsTimers.get(name));
            const sessionId = gameSessionId;

            const timer = setTimeout(() => {
                tabStatsTimers.delete(name);
                if (!isCurrentGameSession(sessionId)) return;
                updateTabStatsForPlayer(name, sessionId, options).catch((e) => console.error(`[TabStats] ${name}:`, e.message));
            }, delay);
            tabStatsTimers.set(name, timer);
        }

        // Latency packets carry nothing the tab row shows, so rendered rows are
        // left alone. Rows not yet rendered, or whose lookup failed, are
        // retried through the normal queue, throttled per player.
        function retryTabStatsFromLatency(name, delay = 0) {
            if (!isTabStatsActiveInGame()) return;
            const cached = tabStatsAppliedNames.has(name) ? tabStatsProfileCache.get(name) : null;
            const cachedData = cached?.profile?.data;
            if (cachedData && !cachedData.lookupFailed) return;
            const now = Date.now();
            if (now - (tabLatencyRetriedAt.get(name) || 0) < TAB_LATENCY_RETRY_MS) return;
            tabLatencyRetriedAt.set(name, now);
            queueTabStatsUpdate(name, delay);
        }

        function refreshTabStatsForRoster() {
            if (!isTabStatsActiveInGame()) {
                clearAllTabStatsDisplays();
                return;
            }
            seedGameRoster();
            const names = Array.from(gameRoster).slice(0, 32);
            const sessionId = gameSessionId;
            getUrchinBatchRaw(names)
                .then(batch => {
                    if (!isCurrentGameSession(sessionId) || !isTabStatsActiveInGame()) return;
                    tabStatsUrchinOverrides = batch;
                    names.forEach((name, index) => {
                        queueTabStatsUpdate(name, index * HYPIXEL_API_GAME_MIN_SPACING_MS);
                    });
                })
                .catch(() => {
                    if (!isCurrentGameSession(sessionId) || !isTabStatsActiveInGame()) return;
                    names.forEach((name, index) => {
                        queueTabStatsUpdate(name, index * HYPIXEL_API_GAME_MIN_SPACING_MS);
                    });
                });
        }

        function clearTabStatsDisplay(name) {
            if (!tabStatsAppliedNames.has(name)) return;
            const info = lobbyPlayers.get(name);
            if (info?.uuid) {
                writeTabDisplayName(info.uuid, info.originalDisplayName || null, Boolean(info.originalDisplayName));
            }
            tabStatsAppliedNames.delete(name);
        }

        function clearAllTabStatsDisplays({ restoreOriginalTeams = false } = {}) {
            tabStatsTimers.forEach(timer => clearTimeout(timer));
            tabStatsTimers.clear();
            tabStatsUrchinOverrides = new Map();
            tabStatsGuildTags.clear();
            tabStatsSessionStats.clear();
            tabStatsSupplementalGeneration += 1;
            resetTabStatsLayout();
            Array.from(tabStatsAppliedNames).forEach(name => clearTabStatsDisplay(name));
            clearSyntheticBedwarsTeams({ restoreOriginalTeams });
        }

        activeUser.pauseExpensiveProxyFeatures = () => {
            clearAllTabStatsDisplays({ restoreOriginalTeams: gameActive && currentGamemode === 'BEDWARS' });
            clearNametagTeams({ restoreOriginalTeams: gameActive && currentGamemode === 'BEDWARS' });
            clearOverlayStatsTimers();
        };

        applyLiveFeatureSettings = () => {
            partyArrivalCheck.setEnabled(partySplitWarningsEnabled);
            if (!partySplitWarningsEnabled) partyArrivalPreview.stop();
            // Name/skin reissues contain a fresh player_info ADD entry, which
            // resets its tab display name. Do them first, then repaint tab
            // stats synchronously from the profiles already in memory.
            denickDisplayNames.refreshNameReplacement();
            // refreshNameReplacement only fires when the on/off state itself
            // flips. Every other kind of change - a different surface, a new or
            // edited alias, including yourself - leaves that flag alone, and the
            // rename decisions are sticky on purpose, so nothing would repaint
            // without this second pass.
            denickDisplayNames.refreshRenames();
            denickDisplayNames.refreshSkinReplacement();
            refreshScoreboardTeamDisplay();

            if (isTabStatsActiveInGame()) {
                refreshTabStatsImmediately();
                syncBedwarsClientTeams();
            }
            else clearAllTabStatsDisplays({ restoreOriginalTeams: gameActive && currentGamemode === 'BEDWARS' });

            if (isNametagOverlayActive() || isNametagOverlayActiveDuels()) applyNametagConfigChange();
            else clearNametagTeams({ restoreOriginalTeams: gameActive && currentGamemode === 'BEDWARS' });

            sessionTracker.refreshSettings();
            enderDustReminder.refreshSettings();
            slumberDailyRewardsReminder.refreshSettings();

            if (isScanActiveInGame() && !hasCurrentGameScanSnapshot()) {
                scheduleAutoScan(250);
            }
        };

        const autoGamblerSession = createAutoGamblerSession({
            isEnabled: () => autoGamblerEnabled,
            isPlayState: () => hypixelClient.state === mc.states.PLAY,
            sendChat: message => sendChat(client, message),
            sendCommand: (command) => void sendHypixelCommand(command, {
                priority: 35,
                dedupeKey: `auto-gambler:${String(command || '').toLowerCase()}`,
                dedupeMs: 1_000
            }),
            onCommandSent: command => gamblerGeorgeReminder.observeCommand(command, 'auto_gambler'),
            canAccept: () => {
                const cooldown = gamblerGeorgeReminder.getCooldownRemainingMs();
                if (cooldown <= 0) return true;
                sendChat(client, '§6§lGambler George §8» §cBet on cooldown after a loss '
                    + `§7(§f${formatGeorgeCooldown(cooldown)} §7left). `
                    + '§8Clear it with /reminder george cooldown.');
                return false;
            },
            logger: console
        });

        const autoDodger = createAutoDodger({
            sendChat: message => sendChat(client, message),
            sendLeaveCommand: () => void sendHypixelCommand('/l', {
                priority: 0,
                dedupeKey: 'auto-dodge-leave',
                dedupeMs: 1_000
            }),
            isPregameActive: () => bedwarsPregameActive,
            isGameActive: () => gameActive,
            getPregameSessionId: () => bedwarsPregameSessionId,
            isEnabled: () => autoDodgeEnabled,
            isPartyMember: (name) => partyTracker.isTrackedMember(name),
            getDelaySeconds: () => autoDodgeDelaySeconds,
            getDodgeSettings: () => ({
                taggedPlayers: autoDodgeTaggedPlayers,
                nickedPlayers: autoDodgeNickedPlayers,
                statThreats: autoDodgeStatThreats,
                includePreset: autoDodgeIncludePreset,
                minFkdr: autoDodgeMinFkdr,
                minStars: autoDodgeMinStars
            }),
            applyConfig: ({ enabled, delaySeconds, taggedPlayers, nickedPlayers, statThreats, includePreset, minFkdr, minStars }) => {
                if (enabled !== undefined) autoDodgeEnabled = Boolean(enabled);
                if (delaySeconds !== undefined) autoDodgeDelaySeconds = clampDodgeDelay(delaySeconds);
                if (taggedPlayers !== undefined) autoDodgeTaggedPlayers = Boolean(taggedPlayers);
                if (nickedPlayers !== undefined) autoDodgeNickedPlayers = Boolean(nickedPlayers);
                if (statThreats !== undefined) autoDodgeStatThreats = Boolean(statThreats);
                if (includePreset !== undefined) autoDodgeIncludePreset = String(includePreset || '').trim().toLowerCase();
                if (minFkdr !== undefined) autoDodgeMinFkdr = clampDodgeThreshold(minFkdr);
                if (minStars !== undefined) autoDodgeMinStars = clampDodgeThreshold(minStars);
                saveFeatureConfig();
            },
            compactTagName
        });

        // Observe-mode party arrival tracker: packet-level co-arrival detection
        // plus self-labeling via the pregame->game entity-id bridge. Writes one
        // JSONL label record per started game for party arrival diagnostics.
        let partyArrivalLabelDirReady = false;
        const partyArrivalTracker = createPartyArrivalTracker({
            isOwnUuid: uuid => isOwnUuid(uuid),
            isOwnName: name => isOwnPlayerName(name),
            getUuidMappedName: uuid => getUuidMappedName(uuid),
            appendLabelLine: record => {
                const labelDir = dataPath('recordings');
                if (!partyArrivalLabelDirReady) {
                    try { fs.mkdirSync(labelDir, { recursive: true }); } catch (error) { /* best effort */ }
                    partyArrivalLabelDirReady = true;
                }
                fs.appendFile(path.join(labelDir, 'party_arrivals.jsonl'), `${JSON.stringify(record)}\n`, () => {});
            }
        });
        partyArrivalTracker.start();

        hypixelClient.on('playerChat', packet => autoGamblerSession.observeChatEvent(packet));
        hypixelClient.on('systemChat', packet => autoGamblerSession.observeChatEvent(packet));

        client.on('packet', (data, meta) => {
            if (proxyStopping) return;
            quickBuyTrace.observe('client', meta.name, data);
            bookTrace.observe('client', meta.name, data);
            if (layoutPreview.observeClient(data, meta)) return;
            if (quickBuy.observeClient(data, meta)) return;
            killMessageLogger.observeClient(data, meta);
            if (packetDebugLoggingEnabled && meta.name === 'custom_payload') {
                logCustomPayloadPacket('Client -> Hypixel', data);
                logReadableCustomPayload(customPayloadChannel(data), data);
            }
            if (hotkeyDebugState.enabled && HOTKEY_DEBUG_PACKETS.has(meta.name)) {
                const detail = formatHotkeyDebugData(data);
                console.log(`[HOTKEY DEBUG] ${meta.name} ${detail}`);
            }
            // Menu monitor tap. Returns true only for a close_window it is
            // deliberately holding back (/menudebug hold), which keeps the
            // server-side GUI open while you type commands.
            const heldByMenuMonitor = menuMonitor.observeClientPacket(data, meta);
            if (meta.name !== 'chat' && meta.name !== 'tab_complete' && hypixelClient.state === mc.states.PLAY) {
                if (meta.name === 'keep_alive') {
                    hypixelClient.write(meta.name, data);
                    return;
                }
                if (!heldByMenuMonitor) hypixelClient.write(meta.name, data);
            }
            if (meta.name === 'position' || meta.name === 'position_look') rememberOwnPosition(data);
            // /recordcheat: own position/look, so recordings carry the observer's
            // viewpoint too. Runs after the serverbound forward above.
            packetRecorder.observeOwn(data, meta);
        });

        const chatTabCompletion = createChatTabCompletion({
            getPartyNames: () => partyTracker.isInParty()
                ? [partyTracker.getLeaderName(), ...partyTracker.getModerators(), ...partyTracker.getMembers()]
                    .filter(name => isValidPlayerName(name) && !isOwnPlayerName(name))
                : null,
            getTeamNames: () => gameActive
                ? Array.from(new Set([...lobbyPlayers.keys(), ...gameRoster]))
                    .filter(name => !isOwnPlayerName(name) && isSameTeamAsClient(name))
                : [],
            displayName: name => {
                if (!state.denickRealIgnChat) return name;
                return getAutoDenickResult(name)?.realName || findKnownDenickByNick(name)?.realIGN || name;
            }
        });

        hypixelClient.on('packet', (data, meta) => {
            if (proxyStopping) return;
            quickBuyTrace.observe('server', meta.name, data);
            killMessageLogger.observeServer(data, meta);
            bookTrace.observe('server', meta.name, data);
            const swallowedByLayoutPreview = layoutPreview.observeServer(data, meta);
            teamDebug.observe('server', meta.name, data);
            if (meta.name === 'login') {
                partyTracker.notifyConnected({ skip: reconnectedWithinPartyGrace });
            }
            if (meta.state !== mc.states.PLAY || client.state !== mc.states.PLAY) return;
            if (meta.name === 'tab_complete') data = chatTabCompletion.serverResponse(data);
            if (meta.name === 'login' || meta.name === 'respawn') {
                replayTabEntries.clear();
                partyArrivalTabNames.clear();
                partyArrivalWorldStartedAt = Date.now();
                reminderLobbyBoundary += 1;
                reminderLobbyTarget = null;
                if (reminderLobbyTimer) clearTimeout(reminderLobbyTimer);
                reminderLobbyTimer = null;
                enderDustReminder.onLobbyLeave();
            }
            if (meta.name === 'position') rememberOwnPosition(data, data?.flags);
            autoGamblerSession.observeRawChatPacket(data, meta);

            if (meta.name === 'keep_alive') {
                client.write(meta.name, data);
                return;
            }

            if (meta.name === 'chat') observeLobbyChatStatsMessage(data);
            if (meta.name === 'chat' && typeof data.message === 'string' && /Playing|Paused/.test(data.message)) {
                const cleanBar = data.message.replace(/§[0-9a-fk-or]/gi, '');
                const viewerBar = cleanBar.match(/\b(?:Playing|Paused)\s+\d{1,2}:\d{2}\s*\/\s*\d{1,2}:\d{2}(?:\s+[\d.]+x)?/);
                if (viewerBar) noteReplayActionBar();
            }
            // Recolor our own /share echoes in place before forwarding, so the
            // player sees one colored line instead of the plain server echo (no
            // doubling). Chat box only (position 0/1); action bar is untouched.
            if (meta.name === 'chat' && (data.position || 0) !== 2 && shareEchoRewriter.hasPending()) {
                try {
                    const rewritten = shareEchoRewriter.rewrite(data);
                    if (rewritten) data = { ...data, message: rewritten };
                } catch (e) {}
            }

            // Menu monitor tap. Must run BEFORE forwarding: it swallows the
            // transaction replies to clicks the proxy synthesised, so the real
            // client never sees an action number it did not send.
            const swallowedByQuickBuy = quickBuy.observeServer(data, meta);
            const swallowedByMenuMonitor = menuMonitor.observeServerPacket(data, meta) || swallowedByQuickBuy || swallowedByLayoutPreview;

            let forwardedToClient = false;
            // /lf owns the action bar while it is on; the packet is still parsed below.
            const hiddenByLookingFor = meta.name === 'chat' && Number(data.position) === 2 && lookingForTriggers.isActive();
            const hiddenGeorgeDialogue = shouldHideAutoGamblerDialogue(data, meta, autoGamblerEnabled) || hiddenByLookingFor;
            if (meta.name !== 'player_info' && !swallowedByMenuMonitor && !hiddenGeorgeDialogue) {
                // Real-IGN rendering is display-only: the client gets a
                // rewritten COPY, while `data` keeps Hypixel's nick for every
                // downstream system (roster, chat parsing, denick tracking).
                // scoreboard_team must be rewritten in step with player_info —
                // Hypixel adds team members by name, so a renamed player would
                // otherwise fall out of their team and lose their colour.
                const renamedForClient = denickDisplayNames.rewriteClientbound(meta.name, data);
                const displayedToClient = meta.name === 'chat'
                    ? rewriteBedwarsEventLabelsForClient(renamedForClient)
                    : meta.name === 'scoreboard_team'
                        ? rewriteBedwarsSidebarTeamColorsForClient(renamedForClient)
                        : replayResults.rewriteClientbound(meta.name, renamedForClient);
                client.write(meta.name, displayedToClient);
                forwardedToClient = true;
            }
            // /recordcheat tap: runs after the packet is already forwarded, so
            // recording adds zero delivery latency. No-op when not recording.
            packetRecorder.observe(data, meta);
            // Scaffold detector: same post-forward position, cheap no-op
            // outside active BedWars/SkyWars games.
            // adds zero delivery latency and no-ops while disabled.

            const entityObservation = observePlayerEntityPacket(data, meta);
            if ((isNametagOverlayActive() || isNametagOverlayActiveDuels())
                && (entityObservation?.type === 'named_entity_spawn'
                    || entityObservation?.invisibleChanged === true)) {
                scheduleNametagSync(0);
            }

            if (meta.name === 'named_entity_spawn') {
                partyArrivalTracker.observeEntitySpawn(data.entityId, data.playerUUID);
            }

            if (meta.name === 'player_info') {
                const action = PLAYER_INFO_ACTIONS[data.action] || data.action;
                for (const player of data.data || []) {
                    const uuid = normalizeUuid(player.UUID || player.uuid);
                    if (!uuid) continue;
                    if (action === 'remove_player' || data.action === 4) partyArrivalTabNames.delete(uuid);
                    else if (action === 'add_player' || data.action === 0) {
                        partyArrivalTabNames.delete(uuid);
                        if (isValidPlayerName(player.name)) partyArrivalTabNames.set(uuid, player.name);
                    }
                }
                partyArrivalTracker.observePlayerInfo(data, action);
                observeReplayTabEntries(data, action);
                const filteredPlayerInfo = filterDenickAliasPlayerInfoPacket(data, action);
                if (!filteredPlayerInfo) return;
                data = filteredPlayerInfo;
                // Display-only rename (see the scoreboard_team note above):
                // `data` below still carries Hypixel's nick for bookkeeping.
                client.write(meta.name, denickDisplayNames.rewritePlayerInfo(data, action));
                forwardedToClient = true;

                if (action === 'add_player' || data.action === 0) {
                    if (data.data && Array.isArray(data.data)) {
                        data.data.forEach((p, index) => {
                            if (p.name) {
                                const uuid = p.UUID || p.uuid;
                                rememberOwnPlayerInfo(p, uuid);
                                if (uuid) rememberUuidName(uuid, p.name);
                                setDefaultTabDisplayName(uuid, p.displayName ?? null);
                                touchLobbyPlayer(p.name, {
                                    uuid: uuid || null,
                                    properties: p.properties || lobbyPlayers.get(p.name)?.properties || null,
                                    originalDisplayName: p.displayName ?? lobbyPlayers.get(p.name)?.originalDisplayName ?? null,
                                    ping: Number.isFinite(Number(p.ping)) ? Number(p.ping) : lobbyPlayers.get(p.name)?.ping,
                                    inTab: true,
                                    source: 'player_info'
                                });
                                const teamAssignment = findScoreboardTeamForPlayer(p.name);
                                if (teamAssignment) {
                                    applyPlayersToScoreboardTeam(
                                        teamAssignment.baseTeamName,
                                        [p.name],
                                        index * 75,
                                        { saveSnapshot: false }
                                    );
                                }
                                if (gameActive && isEligibleForCurrentGameRoster(p.name)) {
                                    gameRoster.add(p.name);
                                    rememberCurrentGamePlayerName(p.name);
                                    if (isDetectedNickedPlayer(p.name)) queueAutoSkinDenick(p.name, 'player_info');
                                    queueTabStatsUpdate(p.name, index * 175);
                                    queueOverlayStatsUpdate(p.name, index * 220);
                                }
                            }
                        });
                        scheduleCurrentMatchSnapshot('player_info_add');
                        pruneStalePlayers();
                    }
                }
                else if (action === 'update_display_name' || data.action === 3) {
                    if (data.data && Array.isArray(data.data)) {
                        data.data.forEach((p, index) => {
                            const uuid = p.UUID || p.uuid;
                            const name = getUuidMappedName(uuid);
                            if (isOwnUuid(uuid)) rememberOwnDisplayName(p.displayName, name || '', 'player_info_display');
                            if (!name || !lobbyPlayers.has(name)) return;
                            rememberOwnPlayerInfo({ name, displayName: p.displayName }, uuid);
                            setDefaultTabDisplayName(uuid, p.displayName ?? null);
                            touchLobbyPlayer(name, {
                                originalDisplayName: p.displayName ?? null,
                                source: 'player_info_display'
                            });
                            queueTabStatsUpdate(name, index * 175);
                            queueOverlayStatsUpdate(name, index * 220);
                        });
                    }
                }
                else if (action === 'update_latency' || data.action === 2) {
                    if (data.data && Array.isArray(data.data)) {
                        data.data.forEach((p, index) => {
                            const uuid = p.UUID || p.uuid;
                            const name = getUuidMappedName(uuid);
                            if (!name || !lobbyPlayers.has(name)) return;
                            touchLobbyPlayer(name, {
                                ping: Number.isFinite(Number(p.ping)) ? Number(p.ping) : lobbyPlayers.get(name)?.ping,
                                source: 'player_info_ping'
                            });
                            retryTabStatsFromLatency(name, index * 100);
                            queueOverlayStatsUpdate(name, index * 140);
                        });
                    }
                }
                else if (action === 'remove_player' || data.action === 4) {
                    if (data.data && Array.isArray(data.data)) {
                        data.data.forEach(p => {
                            const uuid = p.UUID || p.uuid;
                            const name = getUuidMappedName(uuid) || p.name;
                            if (name) {
                                gameRoster.delete(name);
                                if (tabStatsTimers.has(name)) {
                                    clearTimeout(tabStatsTimers.get(name));
                                    tabStatsTimers.delete(name);
                                }
                                if (overlayStatsTimers.has(name)) {
                                    clearTimeout(overlayStatsTimers.get(name));
                                    overlayStatsTimers.delete(name);
                                }
                                tabStatsAppliedNames.delete(name);
                                tabStatsProfileCache.delete(name);
                                tabLatencyRetriedAt.delete(name);
                                tabStatsGuildTags.delete(nickKey(name));
                                tabStatsSessionStats.delete(nickKey(name));
                                markPlayerLeftTab(name);
                                if (uuid) forgetUuidName(uuid);
                                if (uuid) defaultTabSnapshot.displayNames.delete(uuid);
                                scheduleBedwarsClientTeamSync();
                            }
                        });
                        scheduleCurrentMatchSnapshot('player_info_remove');
                    }
                }
            }

            if (meta.name === 'scoreboard_team') {
                const { team, mode, name: teamDisplayName, displayName, prefix, suffix, players, color, friendlyFire, nameTagVisibility } = data;
                const teamNameDisplay = displayName ?? teamDisplayName;
                const modeId = typeof mode === 'string'
                    ? SCOREBOARD_TEAM_MODES[mode]
                    : mode;
                // updateRawScoreboardTeam drops the raw team on a delete, so
                // read its membership before that happens.
                const deletedTeamMembers = modeId === 1 ? rawScoreboardTeamMembers(team) : [];
                updateRawScoreboardTeam(data, modeId);
                updateDefaultTabTeamSnapshot(data, modeId);
                if ((modeId === 0 || modeId === 3) && Array.isArray(players) && players.length) {
                    partyArrivalTracker.observeTeamPlayers(team, players);
                }

                if (modeId === 0 || modeId === 2) {
                    const parsedTeam = buildScoreboardTeamInfo(team, teamNameDisplay, prefix, suffix, color, { friendlyFire, nameTagVisibility });
                    const { teamInfo } = saveScoreboardTeamInfo(team, parsedTeam);
                    if (modeId === 0) originalScoreboardTeamsOnClient.add(String(team || ''));

                    if (modeId === 0 && players && Array.isArray(players)) {
                        applyPlayersToScoreboardTeam(team, players, 350);
                    } else if (modeId === 2 && teamInfo.players.size > 0) {
                        applyPlayersToScoreboardTeam(team, Array.from(teamInfo.players), 150);
                    }
                }

                if (modeId === 3 && players && Array.isArray(players)) {
                    applyPlayersToScoreboardTeam(team, players, 250);
                }

                if (modeId === 4 && players && Array.isArray(players)) {
                    clearPlayersFromScoreboardTeam(team, players);
                }

                if (modeId === 1) {
                    // Only this team's own members leave. The registry entry is
                    // shared by every per-player team of the same colour, so its
                    // `players` set is the entire BedWars team.
                    if (getScoreboardTeamInfo(team)) {
                        clearPlayersFromScoreboardTeam(team, deletedTeamMembers);
                    }
                    originalScoreboardTeamsOnClient.delete(String(team || ''));
                    deleteScoreboardTeamInfo(team);
                }

                updateDetectedStateFromScoreboard();
                if (gameActive && currentGamemode === 'BEDWARS') {
                    if (!delayedRosterSyncTimer) {
                        seedGameRoster();
                    }
                    scheduleDelayedRosterSync();
                    scheduleBedwarsTeamAudit();
                    // Hypixel may re-group a player into their original team,
                    // overriding our above-head annotation — re-assert it.
                    // Runs even with no overlay teams active: a team add is
                    // also how a player comes back from invisibility, and the
                    // sync must re-create their annotation then.
                    if (isNametagOverlayActive()) scheduleNametagSync();
                }
            }

            if (meta.name === 'scoreboard_objective') {
                const objectiveName = String(data.name || '');
                const objectiveTitle = data.displayText || objectiveName;
                if (data.action === 0 || data.action === 2) {
                    scoreboardObjectiveTitles.set(objectiveName, objectiveTitle);
                    if (!sidebarScoreboardObjective || sidebarScoreboardObjective === objectiveName) {
                        lastScoreboardTitle = objectiveTitle;
                    }
                } else if (data.action === 1) {
                    scoreboardObjectiveTitles.delete(objectiveName);
                    if (sidebarScoreboardObjective === objectiveName) {
                        sidebarScoreboardObjective = '';
                        lastScoreboardTitle = '';
                    }
                }

                if (data.action === 0 || data.action === 1) {
                    scoreboardLines.clear();
                    if (data.action === 1 && gameActive && gameStartTime && Date.now() - gameStartTime > 5000) {
                        resetMatchState();
                    }
                }
                updateDetectedStateFromScoreboard(data.displayText || data.name || '');
                syncReplaySidebar();
            }

            if (meta.name === 'scoreboard_display_objective') {
                if (Number(data.position) === 1) {
                    sidebarScoreboardObjective = String(data.name || '');
                    lastScoreboardTitle = scoreboardObjectiveTitles.get(sidebarScoreboardObjective) || '';
                    updateDetectedStateFromScoreboard();
                    syncReplaySidebar();
                }
            }

            if (meta.name === 'scoreboard_score') {
                const scoreName = data.itemName;
                const score = data.value;
                if (data.action === 1) {
                    for (const [lineScore, lineName] of scoreboardLines.entries()) {
                        if (lineName === scoreName) scoreboardLines.delete(lineScore);
                    }
                } else {
                    scoreboardLines.set(score, scoreName);
                }
                updateDetectedStateFromScoreboard(scoreName || '');
            }

            // Hypixel shows VICTORY!/GAME OVER! as a title the moment the game
            // ends, ahead of the end-of-game chat block. Reading it here is what
            // makes the Gambler George bet score even when the player hits
            // /leave immediately afterwards.
            if (meta.name === 'title' && (gameActive||localDuelKey) && (Number(data.action) === 0 || Number(data.action) === 1)) {
                const observed=sessionTracker.observeLocalResult(titlePacketText(data.text));
                if(observed&&localDuelKey&&sessionTracker.getActiveSession()?.localTracking?.current?.result)finishLocalDuel();
                // Also record it on the game itself, so API-tracked games keep
                // a result when the stats delta cannot settle one.
                const banner = gameActive
                    ? parseResultBanner(titlePacketText(data.text), { mode: currentGamemode, startedAt: gameStartTime })
                    : null;
                if (banner) appendSessionGameEvent(banner);
            }
            if (meta.name === 'title'
                && gamblerGeorgeReminder.hasPendingResult()
                && (Number(data.action) === 0 || Number(data.action) === 1)) {
                gamblerGeorgeReminder.observeTitle(titlePacketText(data.text), gamblerGeorgeGameContext());
            }

            if (meta.name === 'chat') {
                try {
                    const message = JSON.parse(data.message);
                    const text = extractText(message);
                    const formattedText = extractFormattedText(message);
                    const position = data.position || 0;
                    const isActionBar = position === 2;
                    if (!isActionBar) autoGamblerSession.maybeSchedule(text, formattedText, message, data.message);
                    const cleanChatText = stripAnsi(text).toLowerCase();
                    if (!isActionBar && !killMessageLogger.isBusy()) observeKillMessagePreviewChat(client, text);
                    if (!isActionBar) observeOwnNickChat(text);
                    if (!isActionBar) observeAutoDenickChat(text);
                    if (!isActionBar) cosmeticEffectRecorder.observeChatLine(text);
                    if (!isActionBar) observeDirectMessageForOverlay(text);
                    if (!isActionBar) observeChatMentionForOverlay(text);
                    if (!isActionBar) observePartyInviteForOverlay(text);
                    if (!isActionBar) partyTracker.handleChatLine(text);
                    if (!isActionBar) observeBedwarsPregameChat(text);
                    if (!isActionBar) partyArrivalTracker.observeChatLine(text);
                    if (!isActionBar) partyArrivalCheck.observeChatLine(text);
                    if (!isActionBar) observeChatTriggersForOverlay(text);
                    if (!isActionBar) observeSessionGameChat(text);
                    if (!isActionBar) {
                        gamblerGeorgeReminder.observeChatLine(text, gamblerGeorgeGameContext());
                    }

                    // Player chat ("Name: i joined the lobby") and rank join
                    // announcements ("[MVP++] Name joined the lobby!") are not
                    // transfers. Treating them as one wiped the tracked sidebar,
                    // and Hypixel never resends the static lobby lines.
                    const isPlayerChatLine = /^[^:]{1,80}:\s/.test(cleanChatText);
                    const isLobbyJoinAnnouncement = /\bjoined the lobby\b/.test(cleanChatText);
                    const lobbyTransferMessage = !isActionBar && !isPlayerChatLine && !isLobbyJoinAnnouncement && (
                        cleanChatText.includes("sending you to")
                        || cleanChatText.includes("you left the game")
                        || cleanChatText.includes("you were spawned in limbo")
                        || (cleanChatText.includes("lobby") && (
                            cleanChatText.includes("you are now in")
                            || cleanChatText.includes("returned to")
                            || cleanChatText.includes("joined")
                            || cleanChatText.includes("warping")
                            || cleanChatText.includes("teleporting")
                        )));
                    if (lobbyTransferMessage) {
                        leaveBedwarsPregame({ preserveProfiles: false, reason: 'lobby_transfer' });
                        resetMatchState({ clearPlayers: true });
                        clearTrackedScoreboard();
                    }

                    const reconnectMatch = cleanChatText.match(/\b([a-z0-9_]{3,16}) reconnected[.!]?$/i);
                    const reconnectedName = reconnectMatch?.[1];
                    const isMyReconnectMessage = reconnectedName
                        && (isOwnPlayerName(reconnectedName) || isOwnNameInLastMatchSnapshot(reconnectedName));
                    if (isMyReconnectMessage) rememberOwnName(reconnectedName, 'chat_reconnected');
                    if (!gameActive && isMyReconnectMessage && restoreLastMatchSnapshot('chat_reconnected')) {
                        sendChat(client, `§6§lFury §8» §aRestored last ${currentGamemode === 'SKYWARS' ? 'SkyWars' : 'Bedwars'} game after reconnect.`);
                    }
                 
                     
                    // Duel game-start info line, e.g. "Opponent: elpabloGG" or
                    // "Opponents: [VIP] dog0223_TW, jeremy0714". This is the clean,
                    // authoritative opponent source and also our auto-scan trigger.
                    // Refresh from the sidebar first so duelsState.active is current
                    // even if the scoreboard packet raced this chat line.
                    if (!isActionBar && /opponents?\s*:/i.test(stripAnsi(text))) {
                        updateDuelsStateFromScoreboard();
                        if (duelsState.active) {
                            const opps = parseOpponentsFromLabeledLine(text);
                            if (opps.length > 0) {
                                duelsState.opponents = opps;
                                scheduleDuelsAutoScan(2500);
                                if(localDuelKey&&/^opponents?\s*:/i.test(stripAnsi(text).trim())&&sessionTracker.getActiveSession()?.localTracking?.current?.endObserved)finishLocalDuel();
                                if(!localDuelKey&&/^opponents?\s*:/i.test(stripAnsi(text).trim())&&(state.apiKillSwitchEnabled||!hasHypixelApiKeyConfigured())&&state.sessionTrackingEnabled){
                                    localDuelStartedAt=Date.now();localDuelKey=`duel:${duelsState.sessionId}:${localDuelStartedAt}`;
                                    sessionTracker.onGameStart({mode:'DUELS',sessionKey:localDuelKey,observedFromStart:true,
                                        variant:duelsState.modeDef?{id:duelsState.modeDef.id,label:duelsState.modeDef.label}:duelsState.modeName,
                                        ...localSessionIdentity()});
                                }
                            }
                        }
                    }

                    // In a duel, "Bed Wars Duel" / "Bed Rush Duel" emit the same
                    // "protect your bed..." start message as real Bedwars. Suppress
                    // the Bedwars/SkyWars game activation while a duel is active.
                    let gameStartMode = null;
                    if (duelsState.active) {
                        gameStartMode = null;
                    } else if (cleanChatText.includes("protect your bed and destroy the enemy beds")) {
                        gameStartMode = 'BEDWARS';
                    } else if (cleanChatText.includes("cages open") || cleanChatText.includes("cages have opened") || cleanChatText.includes("cage opens")) {
                        gameStartMode = 'SKYWARS';
                    } else if (cleanChatText.includes("the game starts in 1 second") && isSupportedTabStatsMode(currentGamemode)) {
                        gameStartMode = currentGamemode;
                    }

                    if (gameStartMode && !isActionBar && !/[:>]/.test(cleanChatText)) {
                        activateGame(gameStartMode, { autoScanDelay: gameStartMode === 'SKYWARS' ? 3000 : 4000, observedStart:true });
                    }
                    // Each packet is already forwarded above; publish only after
                    // the introduction's final divider, not its first instruction.
                    if (!isActionBar && !duelsState.active) {
                        queueTimeTracker.observeStartChat(text);
                    }
                     
                    if ((text.includes("Game Over")
                            || text.includes("GAME OVER")
                            || text.includes("VICTORY!")
                        || text.includes("DEFEAT!"))) {
                        resetMatchState({ clearPlayers: true, clearSnapshot: true });
                        clearTrackedScoreboard();
                    }
                } catch (e) {
                }
            }

            if (!forwardedToClient && !swallowedByMenuMonitor && !hiddenGeorgeDialogue) client.write(meta.name, data);
            // Hot-path cost: one Set lookup for non-effect packets.
            cosmeticEffectRecorder.observeServerPacket(data, meta);
        });

        function clearConnectionTimers() {
            if (connectionTimersCleared) return;
            connectionTimersCleared = true;
            cosmeticEffectRecorder.dispose();
            quickBuy.dispose();
            layoutPreview.dispose();
            quickBuyTrace.dispose();
            bookTrace.dispose();
            menuMonitor.dispose();
            partyTracker.stop();
            queueTimeTracker.reset();
            partyArrivalCheck.stop();
            partyArrivalPreview.stop();
            partyArrivalTracker.stop();
            clearPendingAutoScan();
            clearDelayedRosterSync();
            clearBedwarsTeamAudit();
            if (matchSnapshotTimer) clearTimeout(matchSnapshotTimer);
            matchSnapshotTimer = null;
            pendingMatchSnapshotReason = '';
            clearOverlayStatsTimers();
            tabStatsTimers.forEach(timer => clearTimeout(timer));
            tabStatsTimers.clear();
            autoGamblerSession.clearTimers();
            enderDustReminder.stop();
            if (reminderLobbyTimer) clearTimeout(reminderLobbyTimer);
            slumberDailyRewardsReminder.stop();
            shareEchoRewriter.clear();
            resetTabStatsLayout();
            if (bedwarsTeamSyncTimer) {
                clearTimeout(bedwarsTeamSyncTimer);
                bedwarsTeamSyncTimer = null;
            }
        }

        function flushConnectionPersistence(reason) {
            if (connectionPersistenceFlushed) return;
            connectionPersistenceFlushed = true;
            if (gameActive && activeSessionGameMetadata) {
                activeSessionGameMetadata.disconnected = true;
                appendSessionGameEvent({
                    type: 'disconnect',
                    actor: client.username,
                    at: Date.now(),
                    source: 'system',
                    confidence: 'confirmed',
                    note: 'Proxy connection closed'
                });
            }
            saveCurrentMatchSnapshot(reason);
            clearKillMessageCaptureForClient(client, false);
            // Stops the pending game-end capture and flushes the session store. The
            // session row stays OPEN on disk so reconnecting inside the resume
            // window continues the same session instead of re-baselining.
            if (proxyStopping) connectionDrains.track(sessionTracker.quiesce());
            else sessionTracker.detach();
        }

        let connectionDrain;
        function drainConnection() {
            if (!connectionDrain) {
                shutdownConnections.delete(stopConnection);
                cancelConnectionWork.delete(cancelWork);
                connectionDrain = connectionDrains.track(Promise.all([packetRecorder.drain(), quickBuy.drain()]));
            }
            return connectionDrain;
        }
        function cancelWork() { clearConnectionTimers(); hypixelCommandQueue.close('shutdown'); }
        cancelConnectionWork.add(cancelWork);
        function stopConnection() {
            flushConnectionPersistence('shutdown');
            clearConnectionTimers();
            hypixelCommandQueue.close('shutdown');
            drainConnection();
            client.end('Fury is stopping.');
            hypixelClient.end();
        }
        shutdownConnections.add(stopConnection);

        hypixelClient.on('end', (reason) => {
            hypixelCommandQueue.close('hypixel-disconnected');
            clearConnectionTimers();
            packetRecorder.stopAll('hypixel_disconnect');
            flushConnectionPersistence('hypixel_end');
            drainConnection();
            client.end(reason);
        });

        hypixelClient.on('error', (err) => {
        });

        client.on('end', () => {
            if (replayLeaveTimer) clearTimeout(replayLeaveTimer);
            stopReplayClipAnnouncement();
            stopLookingForActionBar();
            hypixelCommandQueue.close('client-disconnected');
            clearConnectionTimers();
            packetRecorder.stopAll('client_disconnect');
            flushConnectionPersistence('client_end');
            drainConnection();
            hypixelClient.end();
            lastPartyDisconnectAt = Date.now();
            if (activeUser?.client === client) {
                activeUser = null;
                applyLiveFeatureSettings = null;
            }
        });


        const proxyTabMatches = createProxyTabCompleter({
            layoutPresets: command => quickBuy.listPresets(command),
            normalizeCosmeticKey,
            normalizeCosmeticType,
            normalizeGame,
            visibleModeDefs,
            matchDenickCosmeticField,
            matchDenickStatField,
            chatTriggerManager,
            presetNames: () => presetStore.listProfiles().map(preset => preset.name),
            knownPlayerNames: () => {
                const names = new Set();
                Array.from(lobbyPlayers.keys()).forEach(name => names.add(name));
                // Active BedWars/SkyWars game roster.
                Array.from(gameRoster || []).forEach(name => names.add(name));
                // Append-only identity memory for this game. It retains players
                // after Hypixel removes them from tab/team packets and includes
                // real IGNs learned from denick mappings.
                Array.from(currentGamePlayerNames.values()).forEach(name => names.add(name));
                // Current Hypixel party (leader + moderators + members), so party
                // members stay tab-fillable even when they're not in the same lobby
                // or game. Read-only getters — no /p list is triggered here.
                const partyLeader = partyTracker.getLeaderName();
                if (partyLeader) names.add(partyLeader);
                partyTracker.getModerators().forEach(name => names.add(name));
                partyTracker.getMembers().forEach(name => names.add(name));
                if (client.username) names.add(client.username);
                return Array.from(names);
            },
            bedDestroyEffects: BED_DESTROY_EFFECTS,
            finalKillEffects: FINAL_KILL_EFFECTS,
            denickKillMessageNames: DENICK_KILL_MESSAGE_NAMES,
            denickVictoryDanceNames: DENICK_VICTORY_DANCE_NAMES,
            denickSprayNames: DENICK_SPRAY_NAMES,
            denickIslandTopperNames: DENICK_ISLAND_TOPPER_NAMES,
            denickDeathCryNames: DENICK_DEATH_CRY_NAMES,
            denickShopkeeperSkinNames: DENICK_SHOPKEEPER_SKIN_NAMES,
            denickGlyphNames: DENICK_GLYPH_NAMES,
            denickFigurineNames: DENICK_FIGURINE_NAMES,
            denickProjectileTrailNames: DENICK_PROJECTILE_TRAIL_NAMES,
            cosmeticCatalog: COSMETIC_CATALOG,
            denickCosmeticFields: DENICK_COSMETIC_FIELDS,
            denickCosmeticFieldByAlias: DENICK_COSMETIC_FIELD_BY_ALIAS,
            duelsModeDefs: DUELS_MODE_DEFS
        });
        client.on('tab_complete', (packet) => {
            if (layoutPreview.isActive()) { client.write('tab_complete', { matches: [] }); return; }
            const matches = proxyTabMatches(packet.text);
            if (matches) {
                client.write('tab_complete', { matches });
                return;
            }
            chatTabCompletion.forwardedRequest(packet);
            hypixelClient.write('tab_complete', packet);
        });

        async function handleClientChat(packet) {
            const msg = packet.message;
            if (/^\/kmlog(?:\s|$)/i.test(msg)) {
                await killMessageLogger.command(msg.trim().split(/\s+/));
                return;
            }
            if (killMessageLogger.isBusy()) {
                if (/^\/(?:qb|quickbuy)\s+cancel\s*$/i.test(msg)) quickBuy.command(['/quickbuy', 'cancel']);
                else sendChat(client, '§6[KM] §7Recording… §f/kmlog status §7or §f/kmlog cancel§7.');
                return;
            }
            const previewCommand = /^\/(quickbuy|qb|hotbar|hb|quickbuyandhotbar|qbahb)\s+preview(?:\s+(\S+))?\s*$/i.exec(msg);
            if (previewCommand) {
                const mode = /^(hotbar|hb)$/i.test(previewCommand[1]) ? 'hotbar'
                    : /^(quickbuyandhotbar|qbahb)$/i.test(previewCommand[1]) ? 'quickbuyandhotbar' : 'quickbuy';
                await layoutPreview.command(previewCommand[2], mode);
                return;
            }
            if (layoutPreview.isBusy()) {
                if (/^\/(?:quickbuy|qb|hotbar|hb|quickbuyandhotbar|qbahb)\s+cancel\s*$/i.test(msg)) layoutPreview.close();
                else sendChat(client, '§b§lPreview §8» §7Close with §fEsc §7or §f/qb preview close§7.');
                return;
            }
            if (/^\/booktrace(?:\s|$)/i.test(msg)) {
                bookTrace.command(msg.trim().split(/\s+/));
                return;
            }
            if (/^\/(?:quickbuy|qb|hotbar|hb|quickbuyandhotbar|qbahb)(?:\s|$)/i.test(msg)) {
                const quickBuyArgs = msg.trim().split(/\s+/);
                if (['/quickbuy', '/qb'].includes(quickBuyArgs[0].toLowerCase()) && quickBuyArgs[1]?.toLowerCase() === 'trace') {
                    quickBuyTrace.command(quickBuyArgs);
                    return;
                }
                await quickBuy.command(quickBuyArgs);
                return;
            }
            if (quickBuy.isActive()) {
                sendChat(client, '§b§lLayout §8» §eUpdating… §fEsc §eor §f/qb cancel §eto stop.');
                return;
            }
            gamblerGeorgeReminder.observeCommand(msg, 'manual_command');
            if (!msg.startsWith('/')) { 
                hypixelClient.write('chat', { message: msg }); 
                return; 
            }
            
            const args = msg.split(' ');
            const cmd = args[0].toLowerCase();
            if (cmd === '/tagdetails') {
                const target = args[1] || client.username;
                if (!isValidPlayerName(target)) return sendChat(client, '§cUsage: /tagdetails <player>');
                tagDetailLines(target).forEach(line => sendChat(client, line));
                return;
            }

            if (cmd === '/stats' || cmd === '/s') {
                const target = args[1] || client.username;
                const mode = findModeDef('BEDWARS', args[2] || 'overall');
                await runStatsLookupCommand(client, cmd, target, (profile) => {
                    rememberPlayerActiveCosmetics(target, profile.data, 'stats_command');
                    renderBedwarsStats(client, profile.data, mode, { detailed: false, isCached: profile.fromCache });
                });
            }
            else if (cmd === '/duels') {
                const target = args[1] || client.username;
                await runStatsLookupCommand(client, cmd, target, (profile) => {
                    const duels = profile.data.player?.stats?.Duels || {};
                    const mode = findDuelsModeDef(args.slice(2).join('_') || 'overall', duels);
                    renderDuelsStats(client, profile.data, mode, { isCached: profile.fromCache });
                });
            }
            else if (cmd === '/daily' || cmd === '/weekly' || cmd === '/monthly' || cmd === '/yearly') {
                await handlePeriodShortcutCommand(client, args, cmd.slice(1));
            }
            else if (cmd === '/reminder' || cmd === '/reminders') {
                const sub = String(args[1] || 'status').toLowerCase();
                if (sub === 'daily' || sub === 'dailies' || sub === 'npc' || sub === 'rewards') {
                    const action = String(args[2] || 'status').toLowerCase();
                    if (action === 'on' || action === 'off') {
                        slumberDailyRewardsReminderEnabled = action === 'on';
                        saveFeatureConfig();
                        slumberDailyRewardsReminder.refreshSettings();
                        renderReminderController();
                    } else if (action === 'check' || action === 'refresh') {
                        sendChat(client, '§6§lFury Daily §8» §7Checking your Slumber NPC daily rewards...');
                        await slumberDailyRewardsReminder.checkNow({ manual: true });
                        renderReminderController();
                    } else {
                        renderReminderController();
                    }
                } else if (sub === 'george' || sub === 'gambler' || sub === 'bet') {
                    const action = String(args[2] || 'status').toLowerCase();
                    if (action === 'on' || action === 'off') {
                        gamblerGeorgeReminderEnabled = action === 'on';
                        saveFeatureConfig();
                        renderReminderController();
                    } else if (['claimed', 'claim', 'clear', 'reset'].includes(action)) {
                        gamblerGeorgeReminder.clearQuest('manual_claim');
                        renderReminderController();
                    } else if (['accepted', 'accept', 'start'].includes(action)) {
                        gamblerGeorgeReminder.acceptQuest('manual_control', { restart: true });
                        renderReminderController();
                    } else if (['cooldown', 'unfail', 'ready'].includes(action)) {
                        gamblerGeorgeReminder.clearCooldown('manual_control');
                        renderReminderController();
                    } else {
                        renderReminderController();
                    }
                } else if (sub === 'test' || sub === 'demo') {
                    sendEnderDustReminderTestScenario(args[2]);
                } else if (sub === 'on' || sub === 'off') {
                    enderDustReminderEnabled = sub === 'on';
                    saveFeatureConfig();
                    enderDustReminder.refreshSettings();
                    renderReminderController();
                } else if (sub === 'threshold') {
                    const nextThreshold = Math.round(Number(args[2]));
                    if (!Number.isFinite(nextThreshold) || nextThreshold < 1 || nextThreshold > 300) {
                        sendChat(client, '§cUsage: §e/reminder threshold <1-300>');
                        return;
                    }
                    enderDustReminderThreshold = nextThreshold;
                    saveFeatureConfig();
                    enderDustReminder.refreshSettings();
                    renderReminderController();
                } else if (sub === 'check' || sub === 'refresh') {
                    if (!enderDustReminderEnabled) {
                        sendChat(client, '§b§lFury Reminder §8» §eThe Ender Dust reminder is off. Enable it in the launcher or with §f/reminder on§e.');
                        return;
                    }
                    sendChat(client, '§b§lFury Reminder §8» §7Checking your Hypixel player data...');
                    await enderDustReminder.checkNow({ manual: true });
                    renderReminderController();
                } else {
                    renderReminderController();
                }
            }
            else if (cmd === '/session' || cmd === '/ses') {
                await handleLocalSessionCommand(client, args);
            }
            else if (cmd === '/recap') {
                handleRecapCommand(client);
            }
            else if (cmd === '/profile' || cmd === '/profiles' || cmd === '/preset' || cmd === '/presets') {
                handlePresetCommand(client, args);
            }
            else if (cmd === '/info') {
                const target = args[1] || client.username;
                await runStatsLookupCommand(client, cmd, target, (profile) => {
                    rememberPlayerActiveCosmetics(target, profile.data, 'info_command');
                    renderPlayerInfo(client, profile.data, profile.fromCache);
                }, { includeStatus: true });
            }
            else if (cmd === '/general') {
                const target = args[1] || client.username;
                await runStatsLookupCommand(client, cmd, target, async (profile) => {
                    const guild = await getHypixelGuildRaw(profile.data.player?.uuid);
                    renderGeneralStats(client, profile.data, guild, { isCached: profile.fromCache });
                });
            }
            else if (cmd === '/ping') {
                await handlePingCommand(client, args);
            }
            
            else if (cmd === '/urchin') {
                const target = args[1];
                if (!target) return sendChat(client, "§cUsage: /urchin <player>");
                
                sendChat(client, `§b[Urchin] §7Fetching reports for §f${target}§7...`);
                const uuid = await resolveUuid(target);
                if (!uuid) return sendChat(client, "§cInvalid player name.");

                const tags = await fetchUrchinFull(target, uuid);
                if (tags.error) return sendChat(client, `§c${tags.error}`);
                
                // Accept structured reports too, including those with hidden
                // authors, while excluding legacy ping/utility tooltip rows.
                const reportTags = tags.filter(t => t.type || t.tag_type || t.category
                    || (t.tooltip && /added by|THIS TAG DOES NOT MEAN THE PLAYER IS CHEATING/i.test(t.tooltip)));

                if (reportTags.length === 0) {
                    return sendChat(client, `§bUrchin §7» §f${target} §7— No report tags found.`);
                }

                tagDetailLines(target, buildOverlayTags({ urchin: { ok: true, rawTags: reportTags } }), { source: 'Urchin' })
                    .forEach(line => sendChat(client, line));
            }

            else if (cmd === '/seraph') {
                const target = args[1];
                if (!target) return sendChat(client, "§cUsage: /seraph <player>");

                sendChat(client, `§b[Seraph] §7Fetching reports for §f${target}§7...`);
                const uuid = await resolveUuid(target);
                if (!uuid) return sendChat(client, "§cInvalid player name.");

                const data = await fetchSeraphFull(uuid);
                if (data.error) return sendChat(client, `§c${data.error}`);

                if (data.tagged) {
                    tagDetailLines(target, buildOverlayTags({ seraph: data }), { source: 'Seraph' })
                        .forEach(line => sendChat(client, line));
                } else {
                    sendChat(client, `§bSeraph §7» §f${target} §7— No report tags found.`);
                }
            }
            else if (cmd === '/sw') {
                const target = args[1] || client.username;
                const mode = findModeDef('SKYWARS', args.slice(2).join('_') || 'overall');
                await runStatsLookupCommand(client, cmd, target, (profile) => {
                    rememberPlayerActiveCosmetics(target, profile.data, 'sw_command');
                    renderSkyWarsDashboard(client, profile.data, profile.fromCache, mode);
                });
            }
            else if (cmd === '/scan') {
                if (inReplayViewer) await runReplayScan();
                else if (duelsState.active) await runDuelsScan();
                else await runScanForCurrentGame();
            }
            else if (cmd === '/recordcheat' || cmd === '/rc') {
                const sub = (args[1] || '').toLowerCase();
                if (!sub || sub === 'help') {
                    sendChat(client, '§b§lRecorder §8» §7Usage:');
                    sendChat(client, ' §f/rc <player> <cheat> [replay] §7- start recording (label with the suspected cheat)');
                    sendChat(client, ' §f/rc clip <player> <cheat> §7- save the last buffered seconds + keep recording');
                    sendChat(client, ' §f/rc buffer on|off [seconds] §7- rolling pre-capture buffer for clip');
                    sendChat(client, ' §f/rc mark [note] §7- timestamp a cheating moment in active recordings');
                    sendChat(client, ' §f/rc stop [player] §7- stop one or all recordings');
                    sendChat(client, ' §f/rc status §7- list active recordings');
                } else if (sub === 'status') {
                    const active = packetRecorder.status();
                    const buffer = packetRecorder.getBufferInfo();
                    sendChat(client, `§b§lRecorder §8» §7Buffer: ${buffer.buffering ? `§aON §7(${buffer.bufferSeconds}s, ${buffer.bufferedEvents} events)` : '§cOFF'}`);
                    if (active.length === 0) {
                        sendChat(client, '§b§lRecorder §8» §7No active recordings.');
                    } else {
                        active.forEach(s => {
                            const seconds = Math.round((Date.now() - s.startedAt) / 1000);
                            sendChat(client, `§b§lRecorder §8» §c${s.player} §7(${s.label}, ${s.source}) - §f${s.events}§7 events, §f${seconds}s`);
                        });
                    }
                } else if (sub === 'mark') {
                    const note = args.slice(2).join(' ');
                    const result = packetRecorder.mark(note);
                    sendChat(client, result.ok
                        ? `§b§lRecorder §8» §aMarked${note ? `: §f${note}` : ''} §7(${result.sessions} recording(s))`
                        : '§b§lRecorder §8» §cNo active recording to mark.');
                } else if (sub === 'buffer') {
                    const mode = (args[2] || '').toLowerCase();
                    if (mode === 'on' || mode === 'off') {
                        const info = packetRecorder.setBuffering(mode === 'on', args[3]);
                        sendChat(client, info.buffering
                            ? `§b§lRecorder §8» §aBuffer ON §7- keeping the last §f${info.bufferSeconds}s§7 for /rc clip.`
                            : '§b§lRecorder §8» §7Buffer OFF.');
                    } else {
                        const info = packetRecorder.getBufferInfo();
                        sendChat(client, `§b§lRecorder §8» §7Buffer: ${info.buffering ? `§aON §7(${info.bufferSeconds}s, ${info.bufferedEvents} events)` : '§cOFF'} §8- §f/rc buffer on|off [seconds]`);
                    }
                } else if (sub === 'clip') {
                    const targetPlayer = args[2];
                    const cheatLabel = args[3];
                    if (!targetPlayer || !cheatLabel) {
                        sendChat(client, '§b§lRecorder §8» §cUsage: §f/rc clip <player> <cheat>');
                        return;
                    }
                    const result = packetRecorder.clip({
                        player: targetPlayer,
                        label: cheatLabel,
                        source: (args[4] || '').toLowerCase() === 'replay' ? 'replay' : 'live',
                        meta: { account: client.username, gameMode: currentGamemode, clipped: true }
                    });
                    if (result.ok) {
                        sendChat(client, `§b§lRecorder §8» §aClipped §f${result.buffered}§a buffered events for §c${result.player}§a - still recording. §f/rc stop ${result.player}§a when done.`);
                    } else if (result.reason === 'buffer-off') {
                        sendChat(client, '§b§lRecorder §8» §cBuffer is off. Enable it first: §f/rc buffer on');
                    } else if (result.reason === 'already-recording') {
                        sendChat(client, `§b§lRecorder §8» §cAlready recording §f${targetPlayer}§c.`);
                    } else {
                        sendChat(client, `§b§lRecorder §8» §cCould not clip: §7${result.reason}`);
                    }
                } else if (sub === 'stop') {
                    const target = (args[2] || '').trim();
                    if (target) {
                        const result = packetRecorder.stop(target);
                        sendChat(client, result.ok
                            ? `§b§lRecorder §8» §aStopped §c${result.player}§a: §f${result.events}§a events over §f${Math.round(result.durationMs / 1000)}s§a.`
                            : `§b§lRecorder §8» §cNo active recording for §f${target}§c.`);
                    } else {
                        const stopped = packetRecorder.stopAll('manual');
                        sendChat(client, stopped.length > 0
                            ? `§b§lRecorder §8» §aStopped §f${stopped.length}§a recording(s).`
                            : '§b§lRecorder §8» §7No active recordings.');
                    }
                } else {
                    const targetPlayer = args[1];
                    const cheatLabel = args[2];
                    const source = (args[3] || '').toLowerCase() === 'replay' ? 'replay' : 'live';
                    if (!cheatLabel) {
                        sendChat(client, '§b§lRecorder §8» §cUsage: §f/recordcheat <player> <cheat> [replay]');
                        return;
                    }
                    const result = packetRecorder.start({
                        player: targetPlayer,
                        label: cheatLabel,
                        source,
                        meta: { account: client.username, gameMode: currentGamemode }
                    });
                    if (result.ok) {
                        sendChat(client, `§b§lRecorder §8» §aRecording §c${result.player} §7(label: §d${result.label}§7, source: §f${source}§7).`);
                        sendChat(client, `§b§lRecorder §8» §7File: §f${path.basename(result.file)}`);
                    } else if (result.reason === 'already-recording') {
                        sendChat(client, `§b§lRecorder §8» §cAlready recording §f${targetPlayer}§c. Use §f/recordcheat stop ${targetPlayer}§c first.`);
                    } else if (result.reason === 'invalid-player') {
                        sendChat(client, '§b§lRecorder §8» §cInvalid player name.');
                    } else {
                        sendChat(client, `§b§lRecorder §8» §cCould not start: §7${result.reason}`);
                    }
                }
            }
            else if (cmd === '/share' || cmd === '/sharetags' || cmd === '/st') {
                const sub = (args[1] || '').toLowerCase();
                const arg2 = (args[2] || '').toLowerCase();
                if (!sub || sub === 'status' || sub === 'info') {
                    if (sub === 'info') sendChat(client, '\u00a7b\u00a7lShare \u00a78\u00bb \u00a77Broadcasts recent scan results to party chat with configurable include filters.');
                    renderShareController();
                    return;
                }
                if (sub === 'auto') {
                    if (arg2 === 'on' || arg2 === 'off') {
                        shareTagsBroadcaster.setAuto(arg2 === 'on');
                        renderShareController();
                    } else {
                        sendChat(client, '§b§lShare §8» §7Usage: §f/share auto on|off');
                    }
                } else if (sub === 'color' || sub === 'colour') {
                    if (arg2 === 'on' || arg2 === 'off') {
                        shareTagsBroadcaster.setColorLocal(arg2 === 'on');
                        renderShareController();
                    } else {
                        sendChat(client, '§b§lShare §8» §7Usage: §f/share color on|off §7(recolor your own share lines locally)');
                    }
                } else if (sub === 'style' || sub === 'format') {
                    if (['compact', 'plain'].includes(arg2)) {
                        shareTagsBroadcaster.setFancy(false);
                        renderShareController();
                    } else if (['detailed', 'fancy'].includes(arg2)) {
                        shareTagsBroadcaster.setFancy(true);
                        renderShareController();
                    } else {
                        sendChat(client, '§b§lShare §8» §7Usage: §f/share style compact|detailed');
                    }
                } else if (sub === 'preview' || sub === 'test' || sub === 'demo') {
                    const previewSettings = shareTagsBroadcaster.getSettings();
                    const previewName = client.username || 'You';
                    const previewPrefix = previewSettings.destination === 'all'
                        ? `§7${previewName}§f: `
                        : `§9Party §f> §7${previewName}§f: `;
                    sendChat(client, `§b§lShare Preview §8» §7Sample lines in the §f${previewSettings.fancy ? 'fancy' : 'plain'}§7 style (your party still sees plain text).`);
                    if (!previewSettings.colorLocal) {
                        sendChat(client, '§b§lShare Preview §8» §eLocal color is OFF — enable it with §f/share color on§e to see this coloring in real games.');
                    }
                    for (const entry of shareTagsBroadcaster.getPreview()) {
                        sendChat(client, {
                            text: '',
                            extra: [
                                { text: previewPrefix },
                                entry.component,
                                { text: `  §8§o(${entry.note})` }
                            ]
                        });
                    }
                    sendChat(client, '§b§lShare Preview §8» §7Names are §fclickable§7 (→ /urchin). Nothing was sent to chat.');
                    return;
                } else if (sub === 'dest' || sub === 'destination') {
                    if (arg2 === 'party' || arg2 === 'all') {
                        shareTagsBroadcaster.setDestination(arg2);
                        renderShareController();
                    } else {
                        sendChat(client, '§b§lShare §8» §7Usage: §f/share dest party|all');
                    }
                } else if (sub === 'include') {
                    const arg3 = (args[3] || '').toLowerCase();
                    const includeName = shareTagsBroadcaster.normalizeIncludeName(arg2);
                    const includeSetAlias = ['all', 'everything'].includes(arg2);
                    if (!arg2) {
                        renderShareController();
                    } else if (includeName && includeName !== 'all' && (arg3 === 'on' || arg3 === 'off' || arg3 === '')) {
                        if (arg3 === 'on' || arg3 === 'off') {
                            shareTagsBroadcaster.setIncludeFlag(includeName, arg3 === 'on');
                        } else {
                            const cur = shareTagsBroadcaster.getSettings();
                            shareTagsBroadcaster.setIncludeFlag(includeName, !cur[includeName]);
                        }
                        renderShareController();
                    } else if (arg2.includes(',') || includeName || includeSetAlias) {
                        shareTagsBroadcaster.setIncludeSet(arg2.split(','));
                        renderShareController();
                    } else {
                        sendChat(client, '§b§lShare §8» §7Usage: §f/share [tag|tags|nick|nicks|threat|threats|all] §7or §f/share auto on|off');
                    }
                } else if (sub === 'status') {
                    renderShareController();
                } else {
                    const includeName = shareTagsBroadcaster.normalizeIncludeName(sub || 'all');
                    if (!includeName) {
                        sendChat(client, '§b§lShare §8» §7Usage: §f/share [tag|tags|nick|nicks|threat|threats|all] §7or §f/share auto on|off');
                        return;
                    }
                    if (scanInProgress && scanInProgressPromise) {
                        sendChat(client, '§b§lShare §8» §7Waiting for the current scan to finish.');
                        await runScanForCurrentGame({ silentNoRoster: true, waitForInProgress: true });
                        await shareTagsBroadcaster.broadcast(client, { source: 'manual', includeSet: [includeName] });
                    } else if (!hasCurrentGameScanSnapshot()) {
                        // No scan yet: run one that live-streams this share as
                        // players/teams resolve instead of waiting for the whole scan.
                        sendChat(client, '§b§lShare §8» §eNo scan for this game — streaming as players resolve.');
                        await runScanForCurrentGame({ silentNoRoster: true, share: { source: 'manual', includeSet: [includeName] } });
                    } else {
                        await shareTagsBroadcaster.broadcast(client, { source: 'manual', includeSet: [includeName] });
                    }
                }
            }
            else if (cmd === '/ol') {
                const subCmd = args[1]?.toLowerCase();
                if (subCmd === 'add') {
                    await addManualOverlayPlayerFromCommand(args[2]);
                    return;
                }
                if (subCmd === 'clear') {
                    handleOverlayClearCommand(args[2] || 'manual');
                    return;
                }
                sendChat(client, '§6[Overlay] §7Usage: §e/ol add <player> §7or §e/ol clear <manual|triggers|dm|party|mentions|pregame|game|all>');
            }
            else if (cmd === '/deck' || cmd === '/nesterdeck') {
                controlDeck.handle(args);
            }
            else if (cmd === '/fury' || cmd === '/nester' || cmd === '/proxy') {
                handleFuryCommand(args);
            }
            else if (cmd === '/autogambler') {
                handleAutoGamblerCommand(client, args, {
                    getPendingCommandCount: () => autoGamblerSession.timers?.size || 0
                });
            }
            else if (cmd === '/chattrigger' || cmd === '/chattriggers' || cmd === '/ctriggers') {
                handleChatTriggerCommand(client, args);
            }
            else if (cmd === '/lf') {
                handleLookingForCommand(args);
            }
            else if (cmd === '/chatstats' || cmd === '/lobbychatstats') {
                handleLobbyChatStatsCommand(client, args);
            }
            else if (cmd === '/autododge' || cmd === '/dodge') {
                autoDodger.handleCommand(args);
            }
            else if (cmd === '/cancel' || cmd === '/c') {
                const dodgeCancelled = typeof autoDodger.cancel === 'function'
                    ? autoDodger.cancel('manual', { announce: true })
                    : false;
                if (!dodgeCancelled) {
                    sendChat(client, '§7No pending lobby leave to cancel.');
                }
            }
            else if (cmd === '/autododgetest') {
                handleAutoDodgeTestCommand(args);
            }
            else if (cmd === '/scanmode' || cmd === '/scanconfig' || cmd === '/overlay') {
                if (handleOverlayControllerCommand(args)) return;
                handleScanModeCommand(client, args);
            }
            else if (cmd === '/tabstats' || cmd === '/tabliststats') {
                const subCmd = args[1]?.toLowerCase();
                handleTabStatsCommand(subCmd, args);
            }
            else if (cmd === '/nametags' || cmd === '/nametag') {
                handleNametagCommand(args[1]?.toLowerCase(), args);
            }
            else if (cmd === '/a') {
                handleScanModeCommand(client, ['/scanmode', 'all']);
            }
            else if (cmd === '/t' || cmd === '/threat') {
                handleScanModeCommand(client, ['/scanmode', 'threats']);
            }
            else if (cmd === '/o') {
                handleScanModeCommand(client, ['/scanmode', 'off']);
            }
            else if (cmd === '/denick') {
                if (String(args[1] || '').toLowerCase() === 'party') {
                    await handlePartyDenickCommand(args);
                    return;
                }
                if (handleDenickControllerCommand(args)) return;
                await handleDenick(client, args, lobbyPlayers, {
                    storeDenickResult,
                    rememberKnownDenickInSession: (name, realName, source) => {
                        const remembered = rememberKnownDenickInSession(name, realName, source);
                        if (remembered) rememberCurrentGameDenickNames(name, realName);
                        return remembered;
                    },
                    currentGamemode,
                    isCurrentGamePlayer: (name) => gameActive && currentGamePlayerNames.has(nickKey(name))
                });
            }
            else if (cmd === '/alias' || cmd === '/aliases' || cmd === '/customname') {
                handleFriendAliasCommand(args);
            }
            else if (cmd === '/denickskin') {
                await handleDenickSkin(client, args, lobbyPlayers, {
                    storeDenickResult
                });
            }
            else if (cmd === '/apikey') {
                handleApiKeyCommand(client, args);
            }
            else if (cmd === '/apikill' || cmd === '/killapi') {
                handleApiKillSwitchCommand(client, args);
            }
            else if (cmd === '/addtag') {
                await handleAddTagCommand(client, args);
            }
            else if (cmd === '/removetag' || cmd === '/deltag' || cmd === '/untag') {
                await handleRemoveTagCommand(client, args);
            }
            else if (cmd === '/tag') {
                await handleTagCommand(client, args);
            }
            else if (cmd === '/proxyhealth') {
                handleProxyHealthCommand(client, args);
            }
            else if (cmd === '/activecosmetics') {
                await handleActiveCosmeticsCommand(args);
            }
            else if (cmd === '/hotkeydebug') {
                handleHotkeyDebugCommand(client, args, hotkeyDebugState);
            }
            else if (cmd === '/clip') {
                handleClipCommand(client, args.slice(1));
            }
            else if (cmd === '/menudebug' || cmd === '/guidebug' || cmd === '/md') {
                menuMonitor.handleCommand(client, args);
            }
            else if (cmd === '/teamdebug') {
                await handleTeamDebugCommand(args);
            }
            else if (cmd === '/debugstate') {
                console.log('[DebugState]', {
                    players: lobbyPlayers.size,
                    teams: scoreboardTeamRegistry.size,
                    gameRoster: gameRoster.size,
                    myTeam: myTeam || 'None',
                    mode: currentGamemode || 'None',
                    detectedState: detectedGameStateLabel().replace(/_/g, ' '),
                    scanMode: state.scanMode,
                    gameActive,
                    bedwarsPregameActive,
                    ...autoDodger.getDebugState(),
                    ...partyArrivalTracker.getDebugState(),
                    ...menuMonitor.getDebugState(),
                    scoreboard: stripAnsi(getCurrentScoreboardText()).replace(/\s+/g, ' ').trim().slice(0, 220) || 'None',
                    clientBedwarsTeams: syntheticBedwarsTeams.size,
                    lastMatch: getFreshLastMatchSnapshot()?.mode || 'None'
                });
            }
            else if (cmd === '/cosmeticfx' || cmd === '/cfx') {
                cosmeticEffectRecorder.handleCommand(client, args);
            }
            else if (cmd === '/partyy') {
                partyTracker.handleCommand(args);
            }
            else if (cmd === '/partycheck') {
                handlePartyCheckCommand(args);
            }
            else if (cmd === '/po') {
                await handlePartyOverviewCommand(args);
            }
            else if (cmd === '/potest') {
                await handlePartyOverviewCommand(['/po', 'test', args[1] || 'all']);
            }
            else if (cmd === '/help') {
                handleHelpCommand(client, sendChat, args.slice(1));
            }
            else if (cmd === '/who' && inReplayViewer) {
                handleReplayWho();
            }
            else { 
                void sendHypixelCommand(msg, { priority: 20 });
            }
        }
        client.on('chat', packet => {
            if (proxyStopping) return;
            const work = handleClientChat(packet);
            // Durable user commands are accepted before this fence. Optional
            // remote lookups need not hold shutdown open.
            if (/^\/(?:preset|profile|alias|friendalias|clip|session|qb|quickbuy|hb|hotbar|qbahb|quickbuyandhotbar|kmlog|cfx|cosmeticfx|recordcheat|rc)(?:\s|$)/i.test(packet.message)) commandDrains.track(work);
            work.catch(() => console.warn('[Fury] Command did not complete.'));
        });
    });
}

function clampDodgeDelay(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds)) return 10;
    return Math.min(15, Math.max(0, Math.round(seconds)));
}

function clampDodgeThreshold(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, number);
}

function compactTagName(tag) {
    if (!tag || typeof tag !== 'string') return '';
    const clean = stripAnsi(tag).replace(/[\[\]\(\)]/g, '').trim();
    if (!clean) return '';
    const parts = clean.split(/[:\-\s]+/).filter(Boolean);
    if (parts[0]?.toLowerCase() === 'legacy' && parts[1]) return parts[1].slice(0, 10);
    return (parts[0] || clean).slice(0, 10);
}

function colorNameToCode(color) {
    const colors = {
        black: '§0',
        dark_blue: '§1',
        dark_green: '§2',
        dark_aqua: '§3',
        dark_red: '§4',
        dark_purple: '§5',
        gold: '§6',
        gray: '§7',
        grey: '§7',
        dark_gray: '§8',
        dark_grey: '§8',
        blue: '§9',
        green: '§a',
        aqua: '§b',
        red: '§c',
        light_purple: '§d',
        yellow: '§e',
        white: '§f'
    };
    return colors[String(color || '').toLowerCase()] || null;
}

function getBedwarsTeamInfo(value) {
    const text = stripAnsi(String(value || '')).toLowerCase();
    if (!text) return null;
    return BEDWARS_TEAM_DEFS.find(team => team.aliases.some(alias => text.includes(alias))) || null;
}

function getBedwarsTeamInfoFromColor(colorCode) {
    return BEDWARS_TEAM_DEFS.find(team => team.color === String(colorCode || '').toLowerCase()) || null;
}

function getBedwarsTeamInfoFromLetter(letter) {
    const value = String(letter || '').toUpperCase();
    if (!value) return null;
    return BEDWARS_TEAM_DEFS.find(team => team.letter === value) || null;
}

function getUniqueBedwarsTeamInfoFromLetter(letter) {
    const value = String(letter || '').toUpperCase();
    if (!value) return null;
    const matches = BEDWARS_TEAM_DEFS.filter(team => team.letter === value);
    return matches.length === 1 ? matches[0] : null;
}

function legacyColorToPacketColor(colorCode) {
    const values = {
        '§0': 0, '§1': 1, '§2': 2, '§3': 3,
        '§4': 4, '§5': 5, '§6': 6, '§7': 7,
        '§8': 8, '§9': 9, '§a': 10, '§b': 11,
        '§c': 12, '§d': 13, '§e': 14, '§f': 15
    };
    return values[String(colorCode || '').toLowerCase()] ?? -1;
}

function colorValueToCode(color) {
    if (color === undefined || color === null || color === -1) return null;
    const numericColors = ['§0', '§1', '§2', '§3', '§4', '§5', '§6', '§7', '§8', '§9', '§a', '§b', '§c', '§d', '§e', '§f'];
    if (typeof color === 'number') return numericColors[color] || null;

    const text = String(color).trim();
    if (/^§[0-9a-f]$/i.test(text)) return text.toLowerCase();
    if (/^\d+$/.test(text)) return numericColors[Number(text)] || null;
    return colorNameToCode(text);
}

function displayValueToString(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value);
    } catch (e) {
        return String(value);
    }
}

// The title packet carries a chat component as a JSON string, but a bare
// JSON string ("§6§lVICTORY!") is a legal component too, so parse
// before falling back to the raw value.
function titlePacketText(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"')) {
            try {
                return extractText(JSON.parse(trimmed));
            } catch (e) {}
        }
        return value;
    }
    return extractText(value);
}

function scoreboardDisplayText(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
                return extractText(JSON.parse(value));
            } catch (e) {}
        }
        return value;
    }
    return extractText(value);
}

function exactBedwarsTeamInfo(value) {
    const text = stripAnsi(scoreboardDisplayText(value)).trim().toLowerCase();
    if (!text) return null;
    return BEDWARS_TEAM_DEFS.find(team => {
        const names = [team.name, ...team.aliases].map(name => String(name).toLowerCase());
        return names.includes(text) || names.some(name => new RegExp(`^${name}\\d+$`, 'i').test(text));
    }) || null;
}

function leadingScoreboardColor(value) {
    const text = scoreboardDisplayText(value).trimStart();
    const leadingCodes = text.match(/^(?:§[0-9a-fk-or])*/i)?.[0] || '';
    const colors = leadingCodes.match(/§[0-9a-f]/gi);
    return colors?.[colors.length - 1]?.toLowerCase() || null;
}

function extractTeamLetter(...values) {
    for (const value of values) {
        const clean = stripAnsi(scoreboardDisplayText(value)).trim();
        if (!clean) continue;

        const bracketLetter = clean.match(/\[([A-Za-z])\]/);
        if (bracketLetter) return bracketLetter[1].toUpperCase();

        const compact = clean.replace(/\s+/g, ' ');
        const shortLetter = compact.match(/^([A-Za-z])(?:\s|$)/);
        if (shortLetter && compact.length <= 3) return shortLetter[1].toUpperCase();

        const namedTeam = getBedwarsTeamInfo(compact);
        if (namedTeam) return namedTeam.letter;
    }
    return null;
}

// A Hypixel tab display name reads "<rankColour>[RANK] <nameColour>Name". The
// rank colour uses the same codes as the BedWars team colours (§b is MVP and
// Aqua, §a is VIP and Green, §f is default and White), so reading a team out of
// it puts ranked players on whatever team their rank happens to look like -
// which is what made a couple of teammates show up on the wrong team whenever
// the real assignment was missing. A single-letter bracket ("[R]") is a genuine
// team marker and stays trusted; the bare colour only counts when the display
// name carries no rank prefix at all.
function displayNameHasRankPrefix(displayName) {
    const text = stripAnsi(displayValueToString(displayName));
    return /\[[^\]]{2,}\]/.test(text);
}

function getOriginalBedwarsTeamInfo(info = {}, name = '') {
    const text = stripAnsi(displayValueToString(info.originalDisplayName));
    // A one-letter bracket ("[R]") is the only team marker a tab display name
    // carries. Do not fall back to extractTeamLetter's looser matching here:
    // that also reads team names out of free text, and the free text in a
    // display name is the player's own name (RedstoneKid is not on Red).
    const marker = text.match(/\[([A-Za-z])\]/);
    const letterTeam = marker ? getUniqueBedwarsTeamInfoFromLetter(marker[1]) : null;
    if (letterTeam) return letterTeam;
    if (displayNameHasRankPrefix(info.originalDisplayName)) return null;
    return getBedwarsTeamInfoFromColor(extractDisplayColor(info.originalDisplayName, name));
}

function getScoreboardBedwarsTeamInfo(info = {}) {
    // Prefer the resolved team stored by the packet pipeline. Raw identifiers
    // are a legacy fallback only: Yellow2 can carry an explicit Green prefix.
    return getBedwarsTeamInfo(info.team)
        || getBedwarsTeamInfo(info.rawTeam)
        || getBedwarsTeamInfo(info.activeScoreboardTeam)
        || getBedwarsTeamInfoFromColor(info.color)
        || getUniqueBedwarsTeamInfoFromLetter(info.letter);
}

function hasScoreboardBedwarsTeamInfo(info = {}) {
    return Boolean(info.team || info.rawTeam || info.activeScoreboardTeam || info.teamAssignedAt);
}

function getBedwarsVisualTeamInfo(info = {}, name = '') {
    const scoreboardTeam = getScoreboardBedwarsTeamInfo(info);
    if (scoreboardTeam && hasScoreboardBedwarsTeamInfo(info)) return scoreboardTeam;
    return getOriginalBedwarsTeamInfo(info, name)
        || scoreboardTeam;
}

function getTabTeamLetter(info = {}) {
    return getBedwarsVisualTeamInfo(info)?.letter || null;
}

function getTabTeamPrefix(info = {}, nameColor = '§f') {
    const letter = getTabTeamLetter(info);
    if (!letter) return '';

    const teamDef = getBedwarsTeamInfo(info.team)
        || getBedwarsTeamInfoFromColor(info.color)
        || getUniqueBedwarsTeamInfoFromLetter(letter);
    const teamColor = teamDef?.color || (info.color && (info.team || info.letter !== '?') ? info.color : nameColor);
    return `${teamColor}${letter} `;
}

function extractDisplayColor(displayName, targetName = '') {
    if (!displayName) return null;

    const scanString = (value) => {
        const text = String(value);
        if (targetName) {
            const idx = text.indexOf(targetName);
            if (idx >= 0) {
                const before = text.slice(0, idx);
                const matches = before.match(/§[0-9a-f]/gi);
                if (matches?.length) return matches[matches.length - 1].toLowerCase();
            }
        }
        const first = text.match(/§[0-9a-f]/i);
        return first ? first[0].toLowerCase() : null;
    };

    const visit = (node, inheritedColor = null) => {
        if (typeof node === 'string') return scanString(node) || inheritedColor;
        if (!node || typeof node !== 'object') return inheritedColor;

        const ownColor = colorNameToCode(node.color) || inheritedColor;
        if (node.text && (!targetName || String(node.text).includes(targetName))) {
            return scanString(node.text) || ownColor;
        }
        if (Array.isArray(node.extra)) {
            for (const child of node.extra) {
                const found = visit(child, ownColor);
                if (found) return found;
            }
        }
        return ownColor;
    };

    if (typeof displayName === 'string') {
        const direct = scanString(displayName);
        if (direct) return direct;
        try {
            return visit(JSON.parse(displayName));
        } catch (e) {
            return null;
        }
    }

    return visit(displayName);
}

function getTabNameColor(info = {}, name = '') {
    const originalColor = extractDisplayColor(info.originalDisplayName, name);
    const teamDef = getBedwarsVisualTeamInfo(info, name);
    if (teamDef) return teamDef.color;

    const hasTeamColor = info.color && (info.team || getTabTeamLetter(info));
    const teamColor = hasTeamColor ? info.color : null;
    return teamColor || info.displayColor || originalColor || '§f';
}

function inferTeamFromColor(lobbyMap, playerName) {
    const info = lobbyMap.get(playerName);
    if (!info) return null;
    
    if (info.team === null && info.color && info.color !== "§7") {
        const colorToTeam = {
            "§c": "Red",
            "§9": "Blue",
            "§a": "Green",
            "§e": "Yellow",
            "§b": "Aqua",
            "§d": "Pink",
            "§f": "White"
        };
        return colorToTeam[info.color] || null;
    }
    
    return info.team;
}

const { createScanRunner } = require('./src/overlay/scan.js');
const { createTagTracker } = require('./src/overlay/tagTracker.js');
const tagTracker = createTagTracker({ filePath: dataPath('tag_tracker.log') });
const { createDuelsScanRunner } = require('./src/overlay/duelsScan.js');
const {
    matchDuelsMode,
    parseOpponentsFromLabeledLine,
    extractDuelsInfoFromScoreboard,
    isDuelsScoreboard
} = require('./src/net/session/duelsMatch.js');
const { createAutoDodger } = require('./src/dodge/autoDodge.js');
const {
    pregameLobbyIdForScoreboard,
    requeueCommandForScoreboard
} = require('./src/dodge/bedwarsQueue.js');
const { createPartyArrivalTracker } = require('./src/dodge/partyArrival.js');
let performFullScan;
let performReplayScan;
let getScanCandidateNames;
let performDuelsScan;

function formatChatTagLabel(rawTag, label = rawTag, source = 'Urchin') {
    return formatNametagTagValue(rawTag, {
        source,
        tagDisplayMode: nametagTagDisplayMode,
        compactTagName: () => cleanNametagText(label)
    });
}

function getInteractiveTags(urchinData, seraphData, clickName = '') {
    const tags = buildOverlayTags({ urchin: urchinData, seraph: seraphData });
    const components = buildOverlayTagComponents(tags, { clickName })
        .map(component => ({ ...component, text: ` ${component.text}` }));

    if (isUrchinRequestFailed(urchinData)) {
        components.push({
            text: ` §6[U:${shortUrchinStatusLabel(urchinData)}]`,
            hoverEvent: {
                action: "show_text",
                value: `§6§lUrchin API Status\n§fResult: §c${shortUrchinStatusLabel(urchinData)}\n§fMeaning: §7${urchinStatusMessage(urchinData)}\n§8Tags are unknown, not confirmed clean.`
            }
        });
    }

    return components;
}

// renderSkyWarsDashboard lives in src/stats/render/skywars.js.

function getPlayerTeam(lobbyMap, playerName) {
    const playerInfo = lobbyMap.get(playerName);
    return playerInfo ? playerInfo.team : null;
}

// getPlayerData lives in src/stats/fetch.js. The lookup helpers
// (classifyPlayerLookupError, makeFallbackPlayerProfile,
// isNickedLookupMiss, sendPlayerLookupError, profileLookupFailureReason,
// runStatsLookupCommand, getPlayerDataWithNickDetection) live in
// src/stats/lookup.js and are wired after getPlayerData below. The
// per-service raw fetchers (Aurora ping, Hypixel status/guild, Seraph)
// live in src/stats/sources.js.

const {
    getHypixelGuildRaw,
    getHypixelStatusRaw,
    getAuroraPingRaw,
    getSeraphRaw
} = createStatsSources({
    hypixelApiGet,
    hasHypixelApiKeyConfigured,
    getHypixelKey: () => keys.hypixel,
    getAuroraKey: () => keys.aurora,
    getSeraphKey: () => keys.seraph,
    guildCache,
    auroraPingCache,
    auroraPingCacheDuration: AURORA_PING_CACHE_DURATION,
    auroraPingDeduper
});

const { getPlayerData } = createStatsFetch({
    globalCache,
    cacheDuration: CACHE_DURATION,
    getHypixelKey: () => keys.hypixel,
    hasHypixelApiKeyConfigured,
    hypixelApiGet,
    getUrchinRaw: (name, uuid) => getUrchinRaw(name, uuid),
    getSeraphRaw: (uuid) => getSeraphRaw(uuid),
    getAuroraPingRaw: (uuid) => getAuroraPingRaw(uuid),
    getHypixelStatusRaw: (uuid) => getHypixelStatusRaw(uuid),
    makePingData: (overrides) => makePingData(overrides),
    mergeUrchinOverride: (existing, override) => mergeUrchinOverride(existing, override),
    notifyUrchinOutageOnce: (urchin) => notifyUrchinOutageOnce(urchin),
    classifyPlayerLookupError: (e, stage) => classifyPlayerLookupError(e, stage),
    playerLookupDeduper,
    observeHypixelPlayerData: (uuid, player) => {
        try {
            if (player?.displayname) rankBook.record(player.displayname, rankedDisplayForPlayer(player));
        } catch (error) {
            // Remembering a rank must never affect the lookup.
        }
        return activeUser?.observeOwnHypixelPlayerData?.(uuid, player);
    }
});

// getHypixelGuildRaw, getHypixelStatusRaw, getAuroraPingRaw, getSeraphRaw,
// and the ping data shapers (makePingData, parseAuroraPingResponse,
// classifyAuroraPingError, localDateKey, parseAuroraDayMs, validPingNumber,
// summarizePingRows) live in src/stats/sources.js. The fetchers are wired
// above via createStatsSources; the pure helpers are required at the top.

// Urchin data shape, tag parsers, and status helpers (makeUrchinData,
// classifyUrchinRequestError, parseUrchinCubelifyTags, titleCaseUrchinTagType,
// formatUrchinBatchDate, normalizeUrchinBatchTag, parseUrchinBatchTags,
// findUrchinBatchTagsForName, isUrchinRequestFailed, shortUrchinStatusLabel,
// urchinStatusMessage, isUrchinOutageStatus, isSyntheticUrchinStatusTag,
// getTabStatsUrchinTag, mergeUrchinOverride, createUrchinOutageNotifier)
// live in src/stats/urchin.js. The pure helpers are required at the top;
// notifyUrchinOutageOnce + resetUrchinOutageWarning come from the factory
// wired above so the once-per-session flag and chat side-effects stay
// owned by the host.

async function resolveUuid(name) {
    try {
        const res = await axios.get(`https://api.mojang.com/users/profiles/minecraft/${name}`, { timeout: 3000 });
        return res.data.id;
    } catch (e) {
        return null;
    }
}

function parseAddTagBoolean(value) {
    const token = String(value || '').trim().toLowerCase();
    if (['true', 'yes', 'y', '1', 'on'].includes(token)) return true;
    if (['false', 'no', 'n', '0', 'off'].includes(token)) return false;
    return null;
}

// Resolve the tag_type from the tokens after the player name. Known tag types may
// be one or two words (e.g. "Closet Cheater"); we greedily match the longest known
// phrase, falling back to a single free-form token so custom tags still work.
function resolveAddTagType(afterPlayer) {
    const known = (phrase) => ADDTAG_TAG_TYPES.find(t => t.toLowerCase() === String(phrase || '').toLowerCase());
    if (afterPlayer.length >= 2) {
        const two = known(`${afterPlayer[0]} ${afterPlayer[1]}`);
        if (two) return { tagType: two, consumed: 2 };
    }
    const one = known(afterPlayer[0]);
    if (one) return { tagType: one, consumed: 1 };
    return { tagType: afterPlayer[0], consumed: 1 };
}

// ---------- Coral tag write/read helpers (shared by /addtag, /removetag, /tag) ----------

const CORAL_TAGS_URL = 'https://api.urchin.gg/v3/tags';
const CORAL_PLAYER_TAGS_URL = 'https://api.urchin.gg/v3/player/tags';

// Writes prefer the dedicated admin key; reads accept any valid key.
function coralTagKey(forWrite) {
    const key = forWrite ? (keys.urchinadmin || keys.urchin) : (keys.urchin || keys.urchinadmin);
    return String(key || '').trim();
}

function coralTagWriteConfig(uuid) {
    return { timeout: 10000, params: { player: uuid }, headers: { 'X-API-Key': coralTagKey(true) } };
}

function coralAddTag(uuid, type, reason, hideUsername) {
    return axios.post(CORAL_TAGS_URL, { type, reason, hide_username: hideUsername }, coralTagWriteConfig(uuid));
}

function coralPatchTag(uuid, type, reason, hideUsername) {
    return axios.patch(CORAL_TAGS_URL, {
        type, new_type: type, new_reason: reason, hide_username: hideUsername
    }, coralTagWriteConfig(uuid));
}

function coralRemoveTag(uuid, type) {
    return axios.delete(CORAL_TAGS_URL, { ...coralTagWriteConfig(uuid), data: { type } });
}

// Fresh, uncached list of a player's active tags (bypasses the batch cache so
// the /tag controller reflects writes immediately). Returns { tags, displayname }
// or { error }.
async function coralListTags(playerOrUuid) {
    const key = coralTagKey(false);
    if (!key) return { error: 'Urchin API key not set. Use /apikey urchin <key>.' };
    try {
        const res = await axios.get(CORAL_PLAYER_TAGS_URL, {
            timeout: 8000,
            params: { player: playerOrUuid },
            headers: { 'X-API-Key': key }
        });
        return {
            tags: Array.isArray(res.data?.tags) ? res.data.tags : [],
            displayname: res.data?.displayname || ''
        };
    } catch (e) {
        const status = e.response?.status;
        const body = e.response?.data;
        const msg = typeof body === 'string' ? body : (body?.error || body?.message || '');
        return { error: `Urchin tag lookup failed${status ? ` (${status})` : ''}${msg ? ` — ${stripAnsi(String(msg))}` : ''}.` };
    }
}

// /addtag <player> <tag_type> <reason...> [hide_username=true] [overwrite=true]
// Adds a blacklist tag via Coral (POST /v3/tags, or PATCH when overwriting).
// The write key doubles as auth, and the endpoint wants a UUID, so we resolve
// the name via Mojang.
async function handleAddTagCommand(client, args) {
    const tokens = args.slice(1);
    const player = tokens[0];
    const afterPlayer = tokens.slice(1);
    if (!player || afterPlayer.length < 1) {
        sendChat(client, '§6[AddTag] §7Usage: §e/addtag <player> <tag_type> <reason> [hide_username=true] [overwrite=true]');
        sendChat(client, '§8Tag types: §7Closet Cheater, Blatant Cheater, Confirmed Cheater, Caution, Sniper, Legit Sniper, Account.');
        sendChat(client, '§8reason may contain any words; the flags are optional and written as §7hide_username=true §8/ §7overwrite=true §8(default false).');
        return;
    }

    // Prefer the dedicated admin key; fall back to the regular Urchin key for setups
    // where the same key has admin rights.
    const urchinKey = String(keys.urchinadmin || keys.urchin || '').trim();
    if (!urchinKey) {
        sendChat(client, '§6[AddTag] §cNo Urchin admin key set. Use §e/apikey urchinadmin <key>§c.');
        return;
    }

    // Consume the (possibly multi-word) tag_type. Everything after it is the reason,
    // EXCEPT tokens written as named flags (hide_username=... / overwrite=...). This
    // lets the reason contain any number of words — including bare words like "no" or
    // "off" — without being mistaken for the boolean flags.
    const { tagType, consumed } = resolveAddTagType(afterPlayer);
    const rest = afterPlayer.slice(consumed);
    let hideUsername = false;
    let overwrite = false;
    const reasonTokens = [];
    for (const token of rest) {
        const flag = /^([a-z_]+)=(.+)$/i.exec(token);
        if (flag) {
            const key = flag[1].toLowerCase();
            const value = parseAddTagBoolean(flag[2]);
            if (value !== null && ['hide_username', 'hideusername', 'hide', 'hide_name'].includes(key)) {
                hideUsername = value;
                continue;
            }
            if (value !== null && ['overwrite', 'ow', 'replace'].includes(key)) {
                overwrite = value;
                continue;
            }
        }
        reasonTokens.push(token);
    }
    const reason = reasonTokens.join(' ').trim();
    if (!reason) {
        sendChat(client, '§6[AddTag] §cA reason is required.');
        return;
    }

    sendChat(client, `§6[AddTag] §7Resolving §f${player}§7...`);
    const uuid = await resolveUuid(player);
    if (!uuid) {
        sendChat(client, `§6[AddTag] §cCould not resolve a UUID for §f${player}§c. Check the name.`);
        return;
    }

    // Urchin's API accepts only snake_case tag IDs (e.g. closet_cheater), not the
    // friendly display form ("Closet Cheater"). Normalize before sending.
    const apiTagType = tagType.trim().toLowerCase().replace(/\s+/g, '_');

    // Coral (new Urchin API) splits the old "add or overwrite" admin call into
    // POST /v3/tags (add a new tag) and PATCH /v3/tags (overwrite an existing
    // tag's reason/type). Both take ?player= (uuid or username) + X-API-Key.
    try {
        let action = 'Added';
        if (overwrite) {
            // Try to add; if the player already carries this tag type (409),
            // fall back to PATCH to replace its reason.
            try {
                await coralAddTag(uuid, apiTagType, reason, hideUsername);
            } catch (e) {
                if (e.response?.status === 409) {
                    await coralPatchTag(uuid, apiTagType, reason, hideUsername);
                    action = 'Updated';
                } else {
                    throw e;
                }
            }
        } else {
            await coralAddTag(uuid, apiTagType, reason, hideUsername);
        }
        sendChat(client, `§6[AddTag] §a${action} §f${tagType} §atag ${action === 'Updated' ? 'on' : 'to'} §f${player}§a.`);
        sendChat(client, `§7Reason: §f${reason} §8| §7hide_username=§f${hideUsername} §8| §7overwrite=§f${overwrite}`);
    } catch (e) {
        const status = e.response?.status;
        const body = e.response?.data;
        const bodyMessage = typeof body === 'string'
            ? body.slice(0, 160)
            : (body?.error || body?.message || body?.detail || body?.reason || '');
        const suffix = bodyMessage ? ` §8(${stripAnsi(String(bodyMessage))})` : '';
        if (status === 400) sendChat(client, `§6[AddTag] §cBad request — check the tag type/reason.${suffix}`);
        else if (status === 401) sendChat(client, `§6[AddTag] §cUrchin key is missing or invalid.${suffix}`);
        else if (status === 403) sendChat(client, `§6[AddTag] §cYour Urchin rank can't apply this tag type.${suffix}`);
        else if (status === 404) sendChat(client, `§6[AddTag] §cPlayer not found.${suffix}`);
        else if (status === 409) sendChat(client, `§6[AddTag] §e${player} already has a §f${tagType}§e tag. Add §7overwrite=true§e to update its reason.${suffix}`);
        else if (status === 429) sendChat(client, `§6[AddTag] §cRate limited by Urchin. Try again shortly.${suffix}`);
        else if (e.code === 'ECONNABORTED') sendChat(client, '§6[AddTag] §cRequest to Urchin timed out.');
        else sendChat(client, `§6[AddTag] §cRequest failed${status ? ` (${status})` : ''}.${suffix}`);
    }
}

// /removetag <player> <tag_type>
// Removes a blacklist tag from a player via Coral's DELETE /v3/tags. You can
// always remove tags you applied yourself; removing someone else's tag (or an
// older one) needs a higher Urchin rank, which the API enforces (403).
async function handleRemoveTagCommand(client, args) {
    const tokens = args.slice(1);
    const player = tokens[0];
    const afterPlayer = tokens.slice(1);
    if (!player || afterPlayer.length < 1) {
        sendChat(client, '§6[RemoveTag] §7Usage: §e/removetag <player> <tag_type>');
        sendChat(client, '§8Tag types: §7Closet Cheater, Blatant Cheater, Confirmed Cheater, Caution, Sniper, Legit Sniper, Account.');
        return;
    }

    const urchinKey = String(keys.urchinadmin || keys.urchin || '').trim();
    if (!urchinKey) {
        sendChat(client, '§6[RemoveTag] §cNo Urchin admin key set. Use §e/apikey urchinadmin <key>§c.');
        return;
    }

    const { tagType } = resolveAddTagType(afterPlayer);
    if (!tagType) {
        sendChat(client, '§6[RemoveTag] §cA tag type is required.');
        return;
    }
    // Coral tag ids are snake_case (e.g. closet_cheater), matching /addtag.
    const apiTagType = tagType.trim().toLowerCase().replace(/\s+/g, '_');

    sendChat(client, `§6[RemoveTag] §7Resolving §f${player}§7...`);
    const uuid = await resolveUuid(player);
    if (!uuid) {
        sendChat(client, `§6[RemoveTag] §cCould not resolve a UUID for §f${player}§c. Check the name.`);
        return;
    }

    try {
        await coralRemoveTag(uuid, apiTagType);
        sendChat(client, `§6[RemoveTag] §aRemoved §f${tagType} §atag from §f${player}§a.`);
    } catch (e) {
        const status = e.response?.status;
        const body = e.response?.data;
        const bodyMessage = typeof body === 'string'
            ? body.slice(0, 160)
            : (body?.error || body?.message || body?.detail || body?.reason || '');
        const suffix = bodyMessage ? ` §8(${stripAnsi(String(bodyMessage))})` : '';
        if (status === 400) sendChat(client, `§6[RemoveTag] §cBad request — check the tag type.${suffix}`);
        else if (status === 401) sendChat(client, `§6[RemoveTag] §cUrchin key is missing or invalid.${suffix}`);
        else if (status === 403) sendChat(client, `§6[RemoveTag] §cYou can only remove tags you applied — this one needs a higher rank.${suffix}`);
        else if (status === 404) sendChat(client, `§6[RemoveTag] §c${player} has no §f${tagType}§c tag to remove.${suffix}`);
        else if (status === 429) sendChat(client, `§6[RemoveTag] §cRate limited by Urchin. Try again shortly.${suffix}`);
        else if (e.code === 'ECONNABORTED') sendChat(client, '§6[RemoveTag] §cRequest to Urchin timed out.');
        else sendChat(client, `§6[RemoveTag] §cRequest failed${status ? ` (${status})` : ''}.${suffix}`);
    }
}

// ---------- /tag interactive controller ----------
// A clickable panel that lists a player's current tags (with one-click remove)
// and builds a new tag from tag-type + cheat-reason chips + hide/overwrite
// toggles, then applies it. Draft state lives on state.tagDraft (ephemeral).

function tagSlug(label) {
    return String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

// Settable tag types (Confirmed Cheater is review-only, so it's excluded here).
const TAG_ADD_TYPES = ADDTAG_TAG_TYPES
    .filter(label => tagSlug(label) !== 'confirmed_cheater')
    .map(label => ({ label, id: tagSlug(label) }));

// A compact curated set of cheat reasons for the chip builder; any other
// reason can still be typed via /tag reasontext <words>.
const TAG_REASON_CHIPS = ['Scaffold', 'Autoblock', 'Blink', 'Fastbreak', 'Lagrange', 'Nuking', 'Fastplace', 'Aim assist']
    .filter(label => ADDTAG_REASONS.includes(label))
    .map(label => ({ label, id: tagSlug(label) }));

function emptyTagDraft(player = '', uuid = '') {
    return {
        player, uuid,
        typeId: '', reasons: [], reasonText: '',
        // Hide username + overwrite default ON for the /tag builder.
        hideUsername: true, overwrite: true,
        tags: [], listError: '', loading: false
    };
}

function tagTypeLabel(id) {
    return (TAG_ADD_TYPES.find(t => t.id === id) || {}).label
        || String(id || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function composedTagReason(draft) {
    return [...draft.reasons, String(draft.reasonText || '').trim()].filter(Boolean).join(', ');
}

async function refreshTagDraftList(draft) {
    draft.loading = true;
    const result = await coralListTags(draft.uuid || draft.player);
    draft.loading = false;
    if (result.error) {
        draft.listError = result.error;
        draft.tags = [];
        return;
    }
    draft.listError = '';
    draft.displayname = result.displayname || draft.displayname || '';
    draft.tags = (result.tags || []).map(t => ({
        id: String(t.tag_type || '').toLowerCase(),
        label: tagTypeLabel(String(t.tag_type || '').toLowerCase()),
        reason: String(t.reason || '').trim(),
        by: t.hide_username ? 'Hidden' : (t.added_by_username || 'Unknown')
    }));
}

function renderTagController(client) {
    const draft = state.tagDraft;
    if (!draft || !draft.player) {
        sendChat(client, '§6[Tag] §7Usage: §e/tag <player>§7 — opens the tag builder.');
        return;
    }
    const panel = createFeatureStatus({
        client, sendChat, title: 'Player Tag', subtitle: draft.player,
        section: 'safety', helpTopic: 'tag', labelWidth: 9
    });
    panel.open();
    panel.valueRow('Player', draft.player);

    // --- Current tags, each with a one-click remove. The section only appears
    // when the player actually has tags (or while we're loading / on error) —
    // a clean player shows just the "add tag" builder below.
    if (draft.loading) {
        panel.section('Current tags');
        panel.row([chatController.component('loading…', panel.colors.quiet)]);
    } else if (draft.listError) {
        panel.section('Current tags');
        panel.row([chatController.component(draft.listError, 'red')]);
    } else if (draft.tags.length > 0) {
        panel.section('Current tags');
        draft.tags.forEach(t => {
            panel.row([
                ...panel.action('✖', `/tag remove ${t.id}`, `Remove the ${t.label} tag from ${draft.player}.`, { color: 'red' }),
                chatController.text(' ', panel.colors.quiet),
                chatController.component(t.label, 'red'),
                t.reason ? chatController.text(` ${t.reason.slice(0, 26)}`, panel.colors.muted) : null,
                chatController.text(` §8(by ${t.by})`, panel.colors.quiet)
            ]);
        });
    }

    // --- Build a new tag ---
    panel.section('New tag');
    // Tag-type chips, wrapped into rows of 3 so long labels stay in the box.
    let typeRow = [panel.label('Type')];
    TAG_ADD_TYPES.forEach((t, idx) => {
        if (idx > 0 && idx % 3 === 0) { panel.row(typeRow); typeRow = [panel.label('')]; }
        else if (idx > 0) typeRow.push(chatController.text(' ', panel.colors.quiet));
        typeRow.push(...panel.pick(t.label.replace(' Cheater', ''), draft.typeId === t.id, `/tag type ${t.id}`, `Set tag type to ${t.label}.`));
    });
    panel.row(typeRow);

    // Cheat-reason chips, wrapped into rows of 4 so the panel stays compact.
    let reasonRow = [panel.label('Reason')];
    TAG_REASON_CHIPS.forEach((r, idx) => {
        if (idx > 0 && idx % 4 === 0) { panel.row(reasonRow); reasonRow = [panel.label('')]; }
        else if (idx > 0) reasonRow.push(chatController.text(' ', panel.colors.quiet));
        reasonRow.push(...panel.flag(r.label, draft.reasons.includes(r.label), `/tag reason ${r.id}`, `Toggle "${r.label}" in the reason.`));
    });
    panel.row(reasonRow);

    const composed = composedTagReason(draft);
    panel.row([
        panel.label('=>'),
        chatController.component(composed || '/tag text <reason>', composed ? 'white' : panel.colors.quiet),
        chatController.text('  ', panel.colors.quiet),
        ...(draft.reasons.length || draft.reasonText ? panel.action('clear', '/tag clear', 'Clear the reason.', {}) : [])
    ]);

    panel.section('Options');
    panel.row([
        panel.label('Hide'),
        ...panel.toggle(draft.hideUsername, '/tag hide on', '/tag hide off', { onHover: 'Hide your username on this tag.', offHover: 'Show your username.' }),
        chatController.text('   ', panel.colors.quiet),
        panel.label('Owrite'),
        ...panel.toggle(draft.overwrite, '/tag overwrite on', '/tag overwrite off', { onHover: 'Replace the reason if this tag already exists.', offHover: 'Fail if the tag already exists.' })
    ]);

    const canApply = Boolean(draft.typeId && composed);
    const applyHover = canApply
        ? `Apply §f${tagTypeLabel(draft.typeId)}§7 to §f${draft.player}§7\n§7Reason: §f${composed}\n§7hide=§f${draft.hideUsername}§7 overwrite=§f${draft.overwrite}`
        : 'Pick a type and a reason first.';
    panel.section('Apply');
    panel.row([
        panel.label('Apply'),
        ...panel.action(canApply ? 'Apply tag' : 'Apply tag', canApply ? '/tag apply' : null, applyHover, { locked: !canApply, color: 'green' }),
        chatController.text(' ', panel.colors.quiet),
        ...panel.action('Refresh', '/tag refresh', 'Reload this player\'s tags.', {})
    ]);
    panel.close();
}

async function handleTagCommand(client, args) {
    const sub = String(args[1] || '').toLowerCase();
    const draft = state.tagDraft;

    // Subcommands that mutate the active draft, then re-render.
    const draftSubs = new Set(['type', 'reason', 'text', 'clear', 'hide', 'overwrite', 'apply', 'remove', 'refresh']);
    if (draftSubs.has(sub)) {
        if (!draft || !draft.player) {
            sendChat(client, '§6[Tag] §7Open the builder first with §e/tag <player>§7.');
            return;
        }
        if (sub === 'type') {
            const id = tagSlug(args[2]);
            draft.typeId = draft.typeId === id ? '' : id; // click again to unset
            return renderTagController(client);
        }
        if (sub === 'reason') {
            const chip = TAG_REASON_CHIPS.find(r => r.id === tagSlug(args[2]));
            if (chip) {
                const i = draft.reasons.indexOf(chip.label);
                if (i >= 0) draft.reasons.splice(i, 1); else draft.reasons.push(chip.label);
            }
            return renderTagController(client);
        }
        if (sub === 'text') {
            draft.reasonText = args.slice(2).join(' ').trim();
            return renderTagController(client);
        }
        if (sub === 'clear') {
            draft.reasons = [];
            draft.reasonText = '';
            return renderTagController(client);
        }
        if (sub === 'hide') {
            draft.hideUsername = String(args[2] || '').toLowerCase() === 'on';
            return renderTagController(client);
        }
        if (sub === 'overwrite') {
            draft.overwrite = String(args[2] || '').toLowerCase() === 'on';
            return renderTagController(client);
        }
        if (sub === 'remove') {
            const id = tagSlug(args[2]);
            const label = tagTypeLabel(id);
            if (!coralTagKey(true)) return sendChat(client, '§6[Tag] §cNo Urchin admin key set. Use §e/apikey urchinadmin <key>§c.');
            sendChat(client, `§6[Tag] §7Removing §f${label}§7 from §f${draft.player}§7...`);
            try {
                await coralRemoveTag(draft.uuid || draft.player, id);
                sendChat(client, `§6[Tag] §aRemoved §f${label}§a.`);
            } catch (e) {
                const status = e.response?.status;
                if (status === 403) sendChat(client, `§6[Tag] §cYou can only remove tags you applied — §f${label}§c needs a higher rank.`);
                else if (status === 404) sendChat(client, `§6[Tag] §c${draft.player} no longer has a §f${label}§c tag.`);
                else sendChat(client, `§6[Tag] §cRemove failed${status ? ` (${status})` : ''}.`);
            }
            await refreshTagDraftList(draft);
            return renderTagController(client);
        }
        if (sub === 'refresh') {
            await refreshTagDraftList(draft);
            return renderTagController(client);
        }
        if (sub === 'apply') {
            const reason = composedTagReason(draft);
            if (!draft.typeId) return sendChat(client, '§6[Tag] §cPick a tag type first.');
            if (!reason) return sendChat(client, '§6[Tag] §cPick a reason chip or set one with §e/tag text <reason>§c.');
            if (!coralTagKey(true)) return sendChat(client, '§6[Tag] §cNo Urchin admin key set. Use §e/apikey urchinadmin <key>§c.');
            const label = tagTypeLabel(draft.typeId);
            sendChat(client, `§6[Tag] §7Applying §f${label}§7 to §f${draft.player}§7...`);
            try {
                let action = 'Added';
                try {
                    await coralAddTag(draft.uuid || draft.player, draft.typeId, reason, draft.hideUsername);
                } catch (e) {
                    if (e.response?.status === 409 && draft.overwrite) {
                        await coralPatchTag(draft.uuid || draft.player, draft.typeId, reason, draft.hideUsername);
                        action = 'Updated';
                    } else {
                        throw e;
                    }
                }
                sendChat(client, `§6[Tag] §a${action} §f${label}§a — §7${reason}`);
                // Success: keep the player, clear the built reason/type for the next tag.
                draft.typeId = '';
                draft.reasons = [];
                draft.reasonText = '';
            } catch (e) {
                const status = e.response?.status;
                if (status === 409) sendChat(client, `§6[Tag] §e${draft.player} already has a §f${label}§e tag. Turn §7Owrite on§e to replace its reason.`);
                else if (status === 403) sendChat(client, `§6[Tag] §cYour Urchin rank can't apply §f${label}§c.`);
                else if (status === 400) sendChat(client, `§6[Tag] §cBad request — check the type/reason.`);
                else sendChat(client, `§6[Tag] §cApply failed${status ? ` (${status})` : ''}.`);
            }
            await refreshTagDraftList(draft);
            return renderTagController(client);
        }
        return;
    }

    // `/tag` with no player just re-renders the current draft (if any).
    if (!sub) {
        if (draft && draft.player) return renderTagController(client);
        sendChat(client, '§6[Tag] §7Usage: §e/tag <player>§7 — opens the interactive tag builder.');
        return;
    }

    // `/tag <player>` — open (or switch) the builder for that player.
    const player = args[1];
    sendChat(client, `§6[Tag] §7Resolving §f${player}§7...`);
    const uuid = await resolveUuid(player);
    if (!uuid) {
        sendChat(client, `§6[Tag] §cCould not resolve §f${player}§c.`);
        return;
    }
    state.tagDraft = emptyTagDraft(player, uuid);
    await refreshTagDraftList(state.tagDraft);
    renderTagController(client);
}

async function fetchSeraphFull(uuid) {
    if (!keys.seraph) return { error: 'Seraph API key not set.' };
    try {
        const res = await axios.get(`https://api.seraph.si/${uuid}/blacklist?key=${keys.seraph}`, { timeout: 3000 });
        if (res.data && res.data.success) {
            return res.data.data.blacklist;
        }
        return { error: 'No data found for this player.' };
    } catch (e) {
        return { error: 'Seraph API request failed.' };
    }
}

// Denick api surface (lookup tables + cosmetic-name slug + api matcher + the
// /denick filter parsers) lives in src/denick/api.js; see the createDenickApi
// wiring above. The DENICK_KILL_MESSAGE_NAMES/etc constants and the seven
// functions destructured there fill the same slots the in-file definitions
// previously did, so all proxy.js call sites keep their unqualified names.

// /denick + /denickskin command handlers (findDenickCandidatesByCosmetics,
// findDenickCandidatesByStats, handleDenickSkin, handleDenick) live in
// src/denick/commands.js, wired below via createDenickCommands. parseStatCount
// and denickCandidateKey are pure module-level exports from the same file and
// are required at the top so the auto-denick stat parser + combined-search
// keying keep working unqualified.

const {
    findDenickCandidatesByCosmetics,
    findDenickCandidatesByStats,
    handleDenickSkin,
    handleDenick
} = createDenickCommands({
    axios,
    sendChat,
    getKeys: () => keys,
    hasHypixelApiKeyConfigured,
    cosmeticSearchApiUrl: LOCAL_COSMETIC_SEARCH_URL,
    getCosmeticSearchToken: () => COSMETIC_SEARCH_TOKEN,
    denickRange: DENICK_RANGE,
    formatInt,
    getPlayerData,
    getRealNameFromSkin,
    isMinecraftUsername,
    appendDenickHistory,
    parseDenickFilters
});

const SESSION_PERIODS = {
    daily: { label: 'Daily', endpoint: 'daily', aliases: ['daily', 'day', 'd'] },
    weekly: { label: 'Weekly', endpoint: 'weekly', aliases: ['weekly', 'week', 'w'] },
    monthly: { label: 'Monthly', endpoint: 'monthly', aliases: ['monthly', 'month', 'm'] },
    yearly: { label: 'Yearly', endpoint: 'yearly', aliases: ['yearly', 'year', 'y'] }
};

const BEDWARS_MODE_DEFS = [
    { id: 'overall', label: 'Overall', short: 'overall', prefix: '', aliases: ['overall', 'all', 'o'] },
    { id: 'solo', label: 'Solo', short: 'solo', prefix: 'eight_one', aliases: ['solo', 'solos', '1s', 'eight_one'] },
    { id: 'doubles', label: 'Doubles', short: 'doubles', prefix: 'eight_two', aliases: ['double', 'doubles', '2s', 'eight_two'] },
    { id: 'threes', label: 'Threes', short: '3s', prefix: 'four_three', aliases: ['3s', 'threes', 'three', '3v3v3v3', 'four_three'] },
    { id: 'fours', label: 'Fours', short: '4s', prefix: 'four_four', aliases: ['4s', 'fours', 'four', '4v4v4v4', 'four_four'] },
    { id: '4v4', label: '4v4', short: '4v4', prefix: 'two_four', aliases: ['4v4', 'two_four'] }
];

const SKYWARS_MODE_DEFS = [
    { id: 'overall', label: 'Overall', short: 'overall', kind: 'overall', aliases: ['overall', 'all', 'o'] },
    { id: 'solo_normal', label: 'Solo Normal', short: 'solo_normal', kind: 'combo', base: 'solo', variant: 'normal', aliases: ['solo_normal', 'normal_solo', 'solo-normal', 'solonormal', 'sn'] },
    { id: 'solo_insane', label: 'Solo Insane', short: 'solo_insane', kind: 'combo', base: 'solo', variant: 'insane', aliases: ['solo_insane', 'insane_solo', 'solo-insane', 'soloinsane', 'si'] },
    { id: 'doubles_normal', label: 'Doubles Normal', short: 'doubles_normal', kind: 'combo', base: 'team', variant: 'normal', aliases: ['doubles_normal', 'double_normal', 'team_normal', 'normal_doubles', 'normal_team', 'doubles-normal', 'dn'] },
    { id: 'doubles_insane', label: 'Doubles Insane', short: 'doubles_insane', kind: 'combo', base: 'team', variant: 'insane', aliases: ['doubles_insane', 'double_insane', 'team_insane', 'insane_doubles', 'insane_team', 'doubles-insane', 'di'] },
    { id: 'solo', label: 'Solo', short: 'solo', kind: 'base', suffix: 'solo', aliases: ['solo', 'solos'] },
    { id: 'doubles', label: 'Doubles', short: 'doubles', kind: 'base', suffix: 'team', aliases: ['double', 'doubles', 'team', 'teams', '2s'] },
    { id: 'mini', label: 'Mini', short: 'mini', kind: 'base', suffix: 'mini', aliases: ['mini', 'mega'] },
    { id: 'normal', label: 'Normal', short: 'normal', kind: 'variant', suffix: 'normal', aliases: ['normal', 'norm'] },
    { id: 'insane', label: 'Insane', short: 'insane', kind: 'variant', suffix: 'insane', aliases: ['insane', 'ins'] }
];

const DUELS_MODE_DEFS = [
    { id: 'overall', family: 'Overview', label: 'Overall', option: 'Overall', short: 'overall', prefix: '', aliases: ['overall', 'all', 'o'] },
    { id: 'skywars_1v1', family: 'SkyWars', label: 'SkyWars 1v1', option: '1v1', short: 'sw_1v1', prefix: 'sw_duel', aliases: ['skywars', 'skywars_1v1', 'sw', 'sw_1v1', 'sw_duel'] },
    { id: 'skywars_2v2', family: 'SkyWars', label: 'SkyWars 2v2', option: '2v2', short: 'sw_2v2', prefix: 'sw_doubles', aliases: ['skywars_2v2', 'sw_2v2', 'sw_doubles', 'skywars_doubles'] },
    { id: 'bridge_1v1', family: 'The Bridge', label: 'Bridge 1v1', option: '1v1', short: 'bridge_1v1', prefix: 'bridge_duel', aliases: ['bridge', 'bridge_1v1', 'bridge_duel', 'bridge_solo'] },
    { id: 'bridge_2v2', family: 'The Bridge', label: 'Bridge 2v2', option: '2v2', short: 'bridge_2v2', prefix: 'bridge_doubles', aliases: ['bridge_2v2', 'bridge_doubles', 'bridgedoubles', 'bridge_2s'] },
    { id: 'bridge_3v3', family: 'The Bridge', label: 'Bridge 3v3', option: '3v3', short: 'bridge_3v3', prefix: 'bridge_threes', aliases: ['bridge_3v3', 'bridge_threes', 'bridge_3s'] },
    { id: 'bridge_4v4', family: 'The Bridge', label: 'Bridge 4v4', option: '4v4', short: 'bridge_4v4', prefix: 'bridge_four', aliases: ['bridge_4v4', 'bridge_four', 'bridge_4s'] },
    { id: 'bedwars_duel', family: 'BedWars', label: 'Bed Wars Duel', option: 'Duel', short: 'bedwars_duel', prefix: 'bedwars_two_one_duels', aliases: ['bedwars', 'bedwars_duel', 'bw', 'bw_duel', 'bedwars_1v1'] },
    { id: 'bed_rush_duel', family: 'BedWars', label: 'Bed Rush Duel', option: 'Rush', short: 'bed_rush', prefix: 'bedwars_two_one_duels_rush', aliases: ['bedwars_rush', 'bed_rush', 'bwrush', 'rush', 'bedwarsrush'] },
    { id: 'classic_1v1', family: 'Classic', label: 'Classic 1v1', option: '1v1', short: 'classic_1v1', prefix: 'classic_duel', aliases: ['classic', 'classic_1v1', 'classic_duel', 'cd'] },
    { id: 'classic_2v2', family: 'Classic', label: 'Classic 2v2', option: '2v2', short: 'classic_2v2', prefix: 'classic_doubles', aliases: ['classic_2v2', 'classic_doubles', 'classic_2s'] },
    { id: 'uhc_1v1', family: 'UHC', label: 'UHC 1v1', option: '1v1', short: 'uhc_1v1', prefix: 'uhc_duel', aliases: ['uhc', 'uhc_1v1', 'uhc_duel', 'uhcduel'] },
    { id: 'uhc_2v2', family: 'UHC', label: 'UHC 2v2', option: '2v2', short: 'uhc_2v2', prefix: 'uhc_doubles', aliases: ['uhc_2v2', 'uhc_doubles', 'uhc_2s'] },
    { id: 'uhc_4v4', family: 'UHC', label: 'UHC 4v4', option: '4v4', short: 'uhc_4v4', prefix: 'uhc_four', aliases: ['uhc_4v4', 'uhc_four', 'uhc_4s'] },
    { id: 'uhc_ffa', family: 'UHC', label: 'UHC 8 Player FFA', option: '8 FFA', short: 'uhc_ffa', prefix: 'uhc_meetup', aliases: ['uhc_ffa', 'uhc_8_ffa', 'uhc_8_player_ffa', 'uhc_meetup', 'uhc_deathmatch'] },
    { id: 'sumo_1v1', family: 'Sumo', label: 'Sumo 1v1', option: '1v1', short: 'sumo', prefix: 'sumo_duel', aliases: ['sumo', 'sumo_1v1', 'sumo_duel'] },
    { id: 'nodebuff_1v1', family: 'NoDebuff', label: 'NoDebuff 1v1', option: '1v1', short: 'nodebuff', prefix: 'potion_duel', aliases: ['nodebuff', 'nodebuff_1v1', 'no_debuff', 'no_debuff_1v1', 'potion', 'potion_duel'] },
    { id: 'boxing_1v1', family: 'Boxing', label: 'Boxing 1v1', option: '1v1', short: 'boxing', prefix: 'boxing_duel', aliases: ['boxing', 'boxing_1v1', 'boxing_duel'] },
    { id: 'combo_1v1', family: 'Combo', label: 'Combo 1v1', option: '1v1', short: 'combo', prefix: 'combo_duel', aliases: ['combo', 'combo_1v1', 'combo_duel'] },
    { id: 'blitz_1v1', family: 'Blitz', label: 'Blitz 1v1', option: '1v1', short: 'blitz', prefix: 'blitz_duel', aliases: ['blitz', 'blitz_1v1', 'blitz_duel'] },
    { id: 'op_1v1', family: 'OP', label: 'OP 1v1', option: '1v1', short: 'op_1v1', prefix: 'op_duel', aliases: ['op', 'op_1v1', 'op_duel', 'opduel'] },
    { id: 'op_2v2', family: 'OP', label: 'OP 2v2', option: '2v2', short: 'op_2v2', prefix: 'op_doubles', aliases: ['op_2v2', 'op_doubles', 'op_2s'] },
    { id: 'spleef_duel', family: 'Spleef', label: 'Spleef Duel', option: 'Spleef', short: 'spleef', prefix: 'spleef_duel', aliases: ['spleef', 'spleef_duel'] },
    { id: 'bow_spleef_duel', family: 'Spleef', label: 'Bow Spleef Duel', option: 'Bow Spleef', short: 'bow_spleef', prefix: 'bowspleef_duel', aliases: ['bowspleef', 'bow_spleef', 'bow_spleef_duel', 'bowspleef_duel'] },
    { id: 'quake_1v1', family: 'Quakecraft', label: 'Quakecraft 1v1', option: '1v1', short: 'quake', prefix: 'quake_duel', aliases: ['quake', 'quake_1v1', 'quakecraft', 'quake_duel'] },
    { id: 'parkour_ffa', family: 'Parkour', label: 'Parkour 8 Player FFA', option: '8 FFA', short: 'parkour', prefix: 'parkour_eight', aliases: ['parkour', 'parkour_ffa', 'parkour_8_ffa', 'parkour_8_player_ffa', 'parkour_eight'] },
    { id: 'mega_walls_1v1', family: 'Mega Walls', label: 'Mega Walls 1v1', option: '1v1', short: 'mega_walls', prefix: 'mw_duel', aliases: ['mega_walls', 'mega_walls_1v1', 'mw', 'mw_1v1', 'mw_duel'] },
    { id: 'bow_1v1', family: 'Bow', label: 'Bow 1v1', option: '1v1', short: 'bow', prefix: 'bow_duel', aliases: ['bow', 'bow_1v1', 'bow_duel'] }
];

function normalizePeriod(token, fallback = 'daily') {
    const value = String(token || '').toLowerCase();
    return Object.entries(SESSION_PERIODS).find(([, def]) => def.aliases.includes(value))?.[0] || fallback;
}

function normalizeGame(token, fallback = null) {
    const value = String(token || '').toLowerCase();
    if (['bw', 'bedwars', 'bedwar'].includes(value)) return 'BEDWARS';
    if (['sw', 'skywars', 'skywar', 'sky'].includes(value)) return 'SKYWARS';
    if (['duels', 'duel'].includes(value)) return 'DUELS';
    return fallback;
}

function findModeDef(game, token, fallback = 'overall') {
    const value = String(token || '').toLowerCase();
    const defs = game === 'SKYWARS' ? SKYWARS_MODE_DEFS : BEDWARS_MODE_DEFS;
    return defs.find(mode => mode.id === value || mode.aliases.includes(value))
        || defs.find(mode => mode.id === fallback)
        || defs[0];
}

function visibleModeDefs(game) {
    if (game !== 'SKYWARS') return BEDWARS_MODE_DEFS;
    const visibleSkyWarsModes = new Set([
        'overall',
        'solo_normal',
        'solo_insane',
        'doubles_normal',
        'doubles_insane',
        'mini'
    ]);
    return SKYWARS_MODE_DEFS.filter(mode => visibleSkyWarsModes.has(mode.id));
}

function safeStatNumber(value) {
    if (Number.isFinite(Number(value))) return Number(value);
    if (value && typeof value === 'object') {
        const next = Number(value.new);
        const old = Number(value.old);
        if (Number.isFinite(next) && Number.isFinite(old)) return next - old;
        if (Number.isFinite(next) && (value.old === null || value.old === undefined)) return next;
    }
    return 0;
}

function statValue(stats = {}, key) {
    return safeStatNumber(stats[key]);
}

function sumStatValues(stats = {}, keys = []) {
    return keys.reduce((sum, key) => sum + statValue(stats, key), 0);
}

function ratioValue(num, den) {
    return num / Math.max(den, 1);
}

function bwKey(mode, stat) {
    return mode.prefix ? `${mode.prefix}_${stat}_bedwars` : `${stat}_bedwars`;
}


function normalizeModeToken(value = '') {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_')
        .replace(/[^a-z0-9_]/g, '');
}

function duelsKnownModeForPrefix(prefix) {
    return DUELS_MODE_DEFS.find(mode => mode.prefix === prefix);
}

function duelsDetectedModeDefs(duels = {}) {
    return DUELS_MODE_DEFS.filter(mode => !mode.prefix || duelsKnownModeForPrefix(mode.prefix));
}

function visibleDuelsModeDefs(duels = {}) {
    return duelsDetectedModeDefs(duels);
}

function findDuelsModeDef(token, duels = {}, fallback = 'overall') {
    const value = normalizeModeToken(Array.isArray(token) ? token.join('_') : token);
    const defs = duelsDetectedModeDefs(duels);
    return defs.find(mode => mode.id === value
            || normalizeModeToken(mode.short) === value
            || mode.prefix === value
            || (mode.aliases || []).some(alias => normalizeModeToken(alias) === value))
        || defs.find(mode => mode.id === fallback)
        || defs[0];
}

const {
    collectBedwarsStats,
    collectSkyWarsStats,
    collectDuelsStats,
    collectDuelsFamilyStats
} = createStatsCollector({
    statValue,
    sumStatValues,
    ratioValue,
    safeStatNumber,
    bwKey,
    getSkyWarsLevelFromXp,
    getSkyWarsLevelDelta,
    getTopSkyWarsKit,
    BEDWARS_MODE_DEFS,
    SKYWARS_MODE_DEFS,
    DUELS_MODE_DEFS
});

function duelsModeRating(stats = {}) {
    if (!stats.games && !stats.wins) return 0;
    return (stats.winrate * 60)
        + Math.min(stats.wlr, 25) * 3
        + Math.min(stats.kdr, 25) * 3
        + Math.min(stats.bestWs || 0, 100) * 0.35
        + Math.log10((stats.wins || 0) + 1) * 8;
}

function bestDuelsMode(duels = {}, scorer) {
    return duelsDetectedModeDefs(duels)
        .filter(mode => mode.id !== 'overall')
        .map(mode => ({ mode, stats: collectDuelsStats(duels, mode) }))
        .filter(entry => entry.stats.games || entry.stats.wins || entry.stats.kills || entry.stats.goals)
        .sort((a, b) => scorer(b.stats) - scorer(a.stats))[0] || null;
}

function getSkyWarsLevelFromXp(sw = {}) {
    const xp = statValue(sw, 'skywars_experience');
    return xp > 0 ? xp / 10000 : 0;
}

function getSkyWarsLevelDelta(sw = {}) {
    const formatted = sw.levelFormatted || sw.levelFormattedWithBrackets;
    if (!formatted || typeof formatted !== 'object') return 0;
    const oldLevel = Number(stripAnsi(String(formatted.old || '')).match(/(\d+(?:\.\d+)?)/)?.[1]);
    const newLevel = Number(stripAnsi(String(formatted.new || '')).match(/(\d+(?:\.\d+)?)/)?.[1]);
    return Number.isFinite(oldLevel) && Number.isFinite(newLevel) ? newLevel - oldLevel : 0;
}

function getTopSkyWarsKit(sw = {}, mode = SKYWARS_MODE_DEFS[0]) {
    const entries = Object.keys(sw)
        .filter(key => key.startsWith('games_kit_'))
        .map(key => {
            const kitId = key.slice('games_kit_'.length);
            return { kitId, games: statValue(sw, key) };
        })
        .filter(entry => entry.games > 0);

    const filtered = entries.filter(entry => {
        if (mode.kind === 'overall') return !entry.kitId.includes('_mini_') && !entry.kitId.startsWith('mini_');
        if (mode.kind === 'base') return entry.kitId.includes(`_${mode.suffix}_`) || entry.kitId.includes(`${mode.suffix}_`);
        if (mode.kind === 'combo') return entry.kitId.includes(`_${mode.base}_`) || entry.kitId.includes(`${mode.base}_`);
        if (mode.kind === 'variant') return entry.kitId.includes(`_${mode.suffix}_`) || entry.kitId.endsWith(`_${mode.suffix}`);
        return true;
    });

    const best = (filtered.length ? filtered : entries).sort((a, b) => b.games - a.games)[0];
    if (!best) return null;

    return {
        id: best.kitId,
        label: titleCaseWords(best.kitId.replace(/^basic_/, '').replace(/^kit_/, '')),
        games: best.games,
        kills: statValue(sw, `kills_kit_${best.kitId}`),
        wins: statValue(sw, `wins_kit_${best.kitId}`)
    };
}

const {
    STAT_GAP,
    statComponent,
    ratioComponent,
    navButton,
    addComponents,
    sendStatRow,
    chatCharWidth,
    chatTextWidth,
    padChatEnd,
    coloredInt,
    coloredRatio,
    coloredSigned,
    formatDecimalIfNeeded,
    coloredSignedDecimal,
    coloredSignedFixed,
    statText,
    statPair,
    cardDivider,
    sendUrchinSection,
    bedwarsProgressInfo,
    progressBar,
    sendBedwarsProgress,
    bedwarsLevelPrefix,
    avgPingBadge,
    coloredPingValue,
    formatBedwarsMiniCard,
    formatSkyWarsMiniCard,
    formatPercentValue,
    formatDuelsMiniCard
} = createRenderHelpers({ statValue });

const {
    sessionMiniCard,
    renderModeNav,
    renderPeriodNav,
    renderStatsMetaBlock,
    networkLevelExact,
    networkXpForLevel,
    networkLevelProgress,
    formatDateShort,
    ageDaysSince,
    formatDays,
    generalRankLabel,
    guildMemberInfo,
    renderGeneralStats,
    renderPlayerInfo,
    pingRangeText,
    renderPingDetails
} = createGeneralRender({
    helpers: {
        navButton,
        addComponents,
        sendStatRow,
        statComponent,
        STAT_GAP,
        sendUrchinSection,
        coloredInt,
        coloredPingValue,
        avgPingBadge,
        formatDecimalIfNeeded,
        formatPercentValue,
        formatBedwarsMiniCard,
        formatSkyWarsMiniCard
    },
    deps: {
        collectBedwarsStats,
        collectSkyWarsStats,
        buildPlayerInfoTagComponents,
        getPingColor,
        makePingData,
        visibleModeDefs,
        SESSION_PERIODS
    }
});

const {
    renderBedwarsModeStatRows,
    renderBedwarsStats,
    renderBedwarsSession
} = createBedwarsRender({
    helpers: {
        coloredSigned,
        coloredInt,
        coloredRatio,
        coloredSignedFixed,
        sendUrchinSection,
        statPair,
        bedwarsLevelPrefix,
        avgPingBadge,
        formatBedwarsMiniCard
    },
    deps: {
        collectBedwarsStats,
        sessionMiniCard,
        renderStatsMetaBlock,
        renderModeNav,
        renderPeriodNav,
        BEDWARS_MODE_DEFS,
        SESSION_PERIODS
    }
});

const {
    renderSkyWarsModeStatRows,
    renderSkyWarsDashboard,
    renderSkyWarsSession
} = createSkywarsRender({
    helpers: {
        coloredSigned,
        coloredInt,
        coloredRatio,
        coloredSignedFixed,
        formatDecimalIfNeeded,
        sendUrchinSection,
        avgPingBadge,
        formatSkyWarsMiniCard
    },
    deps: {
        collectSkyWarsStats,
        findModeDef,
        sessionMiniCard,
        renderStatsMetaBlock,
        renderModeNav,
        renderPeriodNav,
        SKYWARS_MODE_DEFS,
        SESSION_PERIODS
    }
});

const {
    renderDuelsModeNav,
    renderDuelsModeStatRows,
    renderDuelsStats
} = createDuelsRender({
    helpers: {
        coloredInt,
        coloredRatio,
        navButton,
        sendUrchinSection,
        avgPingBadge,
        formatDuelsMiniCard,
        formatPercentValue
    },
    deps: {
        collectDuelsStats,
        visibleDuelsModeDefs,
        findDuelsModeDef,
        bestDuelsMode,
        duelsModeRating,
        renderStatsMetaBlock,
        DUELS_MODE_DEFS
    }
});

// Local session + post-game recap cards. Shares the collectors with the
// Urchin-backed /daily path, so a locally computed delta and a remote period
// delta render through identical maths.
const {
    renderLocalSession,
    renderGameRecap,
    renderSessionHistory,
    formatSessionStamp
} = createSessionRender({
    helpers: {
        coloredSigned,
        coloredSignedFixed,
        coloredRatio,
        statPair,
        cardDivider,
        navButton,
        sendStatRow
    },
    deps: {
        collectBedwarsStats,
        collectSkyWarsStats,
        collectDuelsStats,
        BEDWARS_MODE_DEFS,
        SKYWARS_MODE_DEFS,
        DUELS_MODE_DEFS
    }
});

const {
    classifyPlayerLookupError,
    makeFallbackPlayerProfile,
    isNickedLookupMiss,
    sendPlayerLookupError,
    profileLookupFailureReason,
    runStatsLookupCommand,
    getPlayerDataWithNickDetection
} = createStatsLookup({
    getPlayerData: (name, options) => getPlayerData(name, options),
    makeUrchinData,
    makePingData
});

({ performFullScan, getScanCandidateNames } = createScanRunner({
    state,
    sendChat,
    isSupportedTabStatsMode,
    getPlayerTeam,
    playerLookupKey,
    getUrchinBatchRaw,
    getPlayerDataWithNickDetection,
    isLikelyBot,
    getSkyWarsLevelValue,
    formatSkyWarsLevel,
    inferTeamFromColor,
    getTabNameColor,
    extractDisplayColor,
    getFkdrColor,
    getKdrColor,
    getWlrColor,
    getWsColor,
    formatBedwarsPrestige,
    getInteractiveTags,
    setLastScanSummary: (summary) => { lastScanSummary = summary; },
    setLastScanResults: (snapshot) => { state.lastScanResults = snapshot; },
    trackTags: tagTracker.track
}));

// Replay /scan: same scanner, but its own fixed settings (every player,
// default threat thresholds) and no writes to the live scan summary, /share's
// last results or the tag log. /scanmode and /scanconfig never reach it.
({ performFullScan: performReplayScan } = createScanRunner({
    state: {
        scanMode: 'all',
        threatConfig: { minFkdr: 3.0, minStars: 1000, minSkywarsKdr: 2.0, minSkywarsWlr: 1.0, minSkywarsLevel: 10, countTags: true }
    },
    sendChat,
    isSupportedTabStatsMode,
    getPlayerTeam,
    playerLookupKey,
    getUrchinBatchRaw,
    getPlayerDataWithNickDetection,
    isLikelyBot,
    getSkyWarsLevelValue,
    formatSkyWarsLevel,
    inferTeamFromColor,
    getTabNameColor,
    extractDisplayColor,
    getFkdrColor,
    getKdrColor,
    getWlrColor,
    getWsColor,
    formatBedwarsPrestige,
    getInteractiveTags,
    setLastScanSummary: () => {},
    setLastScanResults: () => {},
    trackTags: () => {}
}));

({ performDuelsScan } = createDuelsScanRunner({
    state,
    sendChat,
    getPlayerDataWithNickDetection,
    getUrchinBatchRaw,
    playerLookupKey,
    collectDuelsStats,
    collectDuelsFamilyStats,
    formatInt,
    getInteractiveTags,
    isLikelyBot,
    getRankedName,
    setLastScanSummary: (summary) => { lastScanSummary = summary; }
}));

const { createShareEchoRewriter } = require('./src/overlay/shareEchoRewriter.js');
// Repaints our OWN /share echoes locally (colors + click-to-lookup) without
// doubling them. Only lines this proxy just broadcast, echoed under our own
// name, are rewritten; everything else passes through untouched.
const shareEchoRewriter = createShareEchoRewriter({
    getLocalUsername: () => activeUser?.client?.username || ''
});

const { createShareTagsBroadcaster } = require('./src/overlay/shareTags.js');
const shareTagsBroadcaster = createShareTagsBroadcaster({
    state,
    sendChat,
    getHypixelClient: () => activeUser?.hypixelClient || null,
    sendHypixelCommand: (command, options) => activeUser?.sendHypixelCommand
        ? activeUser.sendHypixelCommand(command, options)
        : Promise.resolve({ sent: false, reason: 'not-ready', command }),
    getLocalUsername: () => activeUser?.client?.username || '',
    saveFeatureConfig,
    fetchMonthlySession: (player) => fetchUrchinSession(player, 'monthly'),
    fetchPlayerProfile: (player) => getPlayerData(player, { includeErrors: true }),
    registerLocalEcho: (line, component) => shareEchoRewriter.register(line, component),
    getDenickResult: (name) => (activeUser?.getAutoDenickResult ? activeUser.getAutoDenickResult(name) : null),
    isPartyMember: (name) => (activeUser?.isPartyMember ? activeUser.isPartyMember(name) : false),
    getPartyStatus: () => (activeUser?.getPartyStatus ? activeUser.getPartyStatus() : null),
    // /share is blocked when the client wasn't present for the current
    // game's start (typically a mid-game rejoin). Returns true only when
    // we witnessed the pregame -> active-game transition on this session.
    getPresentAtGameStart: () => (activeUser?.getPresentAtGameStart ? activeUser.getPresentAtGameStart() : true)
});

// sessionMiniCard lives in src/stats/render/general.js.

// renderDuelsModeNav lives in src/stats/render/duels.js.

// renderModeNav + renderPeriodNav + renderStatsMetaBlock live in src/stats/render/general.js.

// renderBedwarsModeStatRows lives in src/stats/render/bedwars.js
// (wired after the helpers + collectors are available).

// renderSkyWarsModeStatRows lives in src/stats/render/skywars.js.

function sessionShortcutHover(game, mode, period) {
    const periodLabel = SESSION_PERIODS[period]?.label || titleCaseWords(period);
    const gameLabel = game === 'SKYWARS' ? 'SkyWars' : 'Bedwars';
    return `§6§l${periodLabel} ${gameLabel} ${mode.label}\n${cardDivider('§8')}\n§7Click to fetch this session.\n§7Stats will be shown in hover tooltips.`;
}

// renderBedwarsStats lives in src/stats/render/bedwars.js.

// renderDuelsModeStatRows + renderDuelsStats live in src/stats/render/duels.js.

// renderGeneralStats + the network/date helpers live in src/stats/render/general.js.

function parseSessionCommandArgs(args, username) {
    const firstToken = args[1] || '';
    const firstLooksLikeOption = Boolean(
        normalizeGame(firstToken)
        || normalizePeriod(firstToken, null)
        || findModeDef('BEDWARS', firstToken, null)?.aliases?.includes(String(firstToken).toLowerCase())
        || findModeDef('SKYWARS', firstToken, null)?.aliases?.includes(String(firstToken).toLowerCase())
    );
    const player = firstToken && !firstLooksLikeOption ? firstToken : username;
    let game = 'BEDWARS';
    let period = 'daily';
    const modeTokens = [];

    args.slice(player === username && firstLooksLikeOption ? 1 : 2).forEach(token => {
        const gameMatch = normalizeGame(token);
        if (gameMatch) {
            game = gameMatch;
            return;
        }

        const periodMatch = normalizePeriod(token, null);
        if (periodMatch) {
            period = periodMatch;
            return;
        }

        modeTokens.push(token);
    });

    let modeToken = modeTokens.join('_') || 'overall';
    if (!findModeDef(game, modeToken, null)?.aliases?.includes(String(modeToken).toLowerCase()) && modeTokens.length > 1) {
        modeToken = modeTokens[modeTokens.length - 1];
    }
    const mode = findModeDef(game, modeToken);
    return { player, game, period, mode };
}

// renderBedwarsSession lives in src/stats/render/bedwars.js.

// renderSkyWarsSession lives in src/stats/render/skywars.js.

async function handleSessionCommand(client, args, options = {}) {
    const parsed = parseSessionCommandArgs(args, client.username);
    sendChat(client, `§8[§bSession§8] §7Fetching §f${parsed.player} §7${SESSION_PERIODS[parsed.period].label.toLowerCase()} data and previews...`);
    const periodKeys = options.showPeriodNav === false ? [parsed.period] : Object.keys(SESSION_PERIODS);
    const [periodPairs, profile] = await Promise.all([
        Promise.all(periodKeys.map(async periodKey => [periodKey, await fetchUrchinSession(parsed.player, periodKey)])),
        getPlayerData(parsed.player).catch(() => null)
    ]);
    const periodData = Object.fromEntries(periodPairs);
    const data = periodData[parsed.period];
    if (data.error) return sendChat(client, `§c${data.error}`);

    const commandPlayer = profile?.data?.player?.displayname || data.username || parsed.player;
    const displayName = profile?.data?.player ? getRankedName(profile.data.player) : `§7${data.username || parsed.player}`;
    if (parsed.game === 'SKYWARS') {
        renderSkyWarsSession(client, commandPlayer, displayName, parsed.period, parsed.mode, data, periodData, profile?.data || null, options);
    } else {
        renderBedwarsSession(client, commandPlayer, displayName, parsed.period, parsed.mode, data, periodData, profile?.data || null, options);
    }
}

async function handlePeriodShortcutCommand(client, args, period) {
    await handleSessionCommand(client, [`/${period}`, ...args.slice(1), period], {
        showStats: true,
        showPeriodNav: false,
        periodShortcut: true
    });
}

function buildPlayerInfoTagComponents(data = {}) {
    const components = getInteractiveTags(data.urchin, data.seraph, data.player?.displayname || data.player?.name);
    if (components.length === 0) components.push({ text: '§7None' });
    return components;
}

// renderPlayerInfo + pingRangeText + renderPingDetails live in src/stats/render/general.js.

async function handlePingCommand(client, args) {
    const target = args[1] || client.username;
    if (!keys.aurora) return sendChat(client, '§cAurora API key is missing. Use §e/apikey aurora <key>§c.');
    sendChat(client, `§8[§bPing§8] §7Fetching Aurora ping for §f${target}§7...`);
    const uuid = await resolveUuid(target);
    if (!uuid) return sendChat(client, `§cPlayer not found: §f${target}`);
    const ping = await getAuroraPingRaw(uuid);
    renderPingDetails(client, target, ping);
}

function renderDashboard(client, data, detailed, isCached) {
    const p = data.player; 
    const bw = p.stats?.Bedwars || {};
    const stars = p.achievements?.bedwars_level || 0; 
    const name = getRankedName(p);
    const line = "§8§m--------------------------------------------------";
    
    // We will build a JSON message structure
    let jsonMsg = { text: "", extra: [] };
    const add = (txt) => jsonMsg.extra.push({ text: txt });

    add(`\n${line}\n`);
    add(`${formatBedwarsPrestige(stars)} ${name}${isCached ? ' §7(Cached)' : ''}\n`);
    
    if (!detailed) {
        const fk = bw.final_kills_bedwars || 0, fd = bw.final_deaths_bedwars || 1;
        const w = bw.wins_bedwars || 0, l = bw.losses_bedwars || 1;
        const fkdr = (fk / fd).toFixed(2);
        const wlr = (w / l).toFixed(2);
        add(`\n§fFKDR: ${getFkdrColor(fkdr)}${fkdr}§r §fWLR: ${getWlrColor(wlr)}${wlr}§r §fWS: ${getWsColor(bw.winstreak)}${bw.winstreak || 0}§r\n`);
    } else {
        const modes = [
            { n: 'Solos', k: 'eight_one' }, { n: 'Doubles', k: 'eight_two' }, 
            { n: '3v3v3v3', k: 'four_three' }, { n: '4v4v4v4', k: 'four_four' }, { n: '4v4', k: 'two_four' }
        ];
        modes.forEach(m => {
            const f = bw[`${m.k}_final_kills_bedwars`] || 0, fd = bw[`${m.k}_final_deaths_bedwars`] || 1;
            const w = bw[`${m.k}_wins_bedwars`] || 0, l = bw[`${m.k}_losses_bedwars`] || 1;
            const b = bw[`${m.k}_beds_broken_bedwars`] || 0, bl = bw[`${m.k}_beds_lost_bedwars`] || 1;
            const fkdrVal = (f / fd).toFixed(2), wlrVal = (w / l).toFixed(2), bwrVal = (b / bl).toFixed(2);
            add(`\n§6§l${m.n.toUpperCase()}\n §fF: §e${f} §fFD: §e${fd} §8(${getFkdrColor(fkdrVal)}${fkdrVal}§8) §fW: §e${w} §fL: §e${l} §8(${getWlrColor(wlrVal)}${wlrVal}§8)\n §fB: §e${b} §fBL: §e${bl} §8(§e${bwrVal}§8) §fWS: §a${bw[m.k+'_winstreak'] || 0}\n`);
        });
    }
    
    // Ping
    add(`\n${coloredPingValue(data.ping?.ping)} §8| §fAvg: ${coloredPingValue(data.ping?.avgPing)}\n`);

    // --- INTERACTIVE TAGS SECTION ---
    add(`§fTags: `);
    const tagComponents = getInteractiveTags(data.urchin, data.seraph, data.player?.displayname || data.player?.name);
    const hasTags = tagComponents.length > 0;
    jsonMsg.extra.push(...tagComponents);

    if (!hasTags) add(`§7None`);

    add(`\n§fStatus: ${data.status}\n${line}\n`);
    
    sendChat(client, jsonMsg);
}

// Stars/prestige/colors live in src/stats/format.js + src/stats/colors.js.
// getStarColor is dead in proxy.js (live copy lives in stats_utils.js for
// the launcher); intentionally not re-imported here.

function detectGamemodeFromText(value) {
    const clean = stripAnsi(displayValueToString(value)).toUpperCase();
    const compact = clean.replace(/[^A-Z]/g, '');
    if (!compact) return null;
    if (compact.includes('BEDWARS')) return 'BEDWARS';
    if (compact.includes('SKYWARS')) return 'SKYWARS';
    return null;
}

function isSupportedTabStatsMode(mode) {
    return mode === 'BEDWARS' || mode === 'SKYWARS';
}

const startupCommandSummary = getStartupCommandSummary();
console.log([
    '============================================================',
    ' Fury Gateway is running',
    ' Smart Hypixel routing, live game tools, and safe command pacing.',
    '',
    ' Connection addresses',
    `   Direct:   localhost:${serverSettings.proxyDirectPort} -> ${serverSettings.proxyDirectHost}`,
    `   Failover: localhost:${serverSettings.proxyFailoverPort} -> ${serverSettings.proxyFailoverHost}`,
    '',
    ' In-game commands',
    ...startupCommandSummary.map(line => `   ${line}`),
    '',
    ' Outgoing Hypixel commands are serialized with a 400 ms safety gap.',
    ' Use /help in Minecraft for clickable commands, examples, and all options.',
    '============================================================'
].join('\n'));

// Install after startup ownership is complete. One deadline is supplied by Main.
installServiceShutdown({
    async quiesce() {
        proxyStopping = true;
        upstreamOwner.quiesce();
        liveSettingsWatcher?.close();
        clearTimeout(liveSettingsReloadTimer);
        clearInterval(healthTimer);
        for (const listener of ownedListeners) listener.quiesce();
        for (const cancel of cancelConnectionWork) cancel();
        const settled = await Promise.allSettled([upstreamOwner.drain(), commandDrains.drain()]);
        for (const stop of [...shutdownConnections]) stop();
        if (settled.some(result => result.status === 'rejected')) throw new Error('Shutdown quiescence did not complete cleanly.');
    },
    async drain() {
        const settled = await Promise.allSettled([connectionDrains.drain(), commandDrains.drain(), cosmeticEffectLibrary.drain()]);
        for (const store of [sessionStore, presetStore]) {
            try { await store.flush({ strict: true, onlyPending: true }); }
            catch { settled.push({ status: 'rejected' }); }
        }
        await jsonWriter.drain();
        sessionStore.verifyPersistence();
        if (settled.some(result => result.status === 'rejected')) throw new Error('Mandatory persistence did not complete.');
    },
    async close() {
        await Promise.all(ownedListeners.map(listener => listener.close()));
            await jsonWriter.close();
    }
});
