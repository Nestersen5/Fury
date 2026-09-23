'use strict';

// Shared mutable runtime state for proxy.js.
//
// Per the split plan, feature flags and API keys are reassigned from many
// places (for example, feature settings toggling multiple flags, the
// /apikey command replacing the whole keys object). Exporting bare `let`s
// would silently break: each importer would keep the original binding.
// All shared mutable state therefore lives on this single object, and every
// consumer reads/writes `state.X`.

const state = {
    // API keys (whole object is replaced by loadKeys()).
    keys: {
        hypixel: '',
        urchin: '',
        aurora: '',
        seraph: ''
    },

    // Global API kill switch: when true, the axios interceptor installed in
    // proxy.js rejects every outbound (non-localhost) HTTP request so the
    // proxy stops hitting rate-limited external APIs entirely. Lives here
    // (not a proxy.js `let`) so hypixel_api_client and tests can read it.
    apiKillSwitchEnabled: false,

    // Feature flags driven by features_config.json.
    tabStatsEnabled: false,
    autoScanOnGameStart: true,
    autoGamblerEnabled: false,
    autoSkinDenickEnabled: true,
    autoStatsDenickEnabled: true,
    denickChatAnnouncementsEnabled: true,
    socialOverlayAddsEnabled: true,
    lobbyChatStatsEnabled: true,
    lobbyChatStatsMentionEnabled: true,
    lobbyChatStatsDmEnabled: true,
    lobbyChatStatsTriggerEnabled: true,
    pregameChatStatsEnabled: true,
    overlayAutoAddOutsideGamesOnly: true,
    overlayAutoClearOnGameStartEnd: true,
    showDenickedRealIgn: true,
    showTagsInTabStats: true,
    partyOverviewEnabled: true,
    proxyHealthWarningsEnabled: true,

    // Local session tracking (/session) and its post-game recap card. Session
    // tracking is the parent switch for the end-of-game snapshot.
    sessionTrackingEnabled: true,
    gameRecapEnabled: true,
    replayDetailsEnabled: true,
    sessionBoundaryMinutes: 30,
    sessionRetention: 0,
    sessionRecapStyle: 'detailed',
    sessionRecapFields: ['result', 'duration', 'game_stats', 'session_totals', 'goals'],
    sessionBedwarsFields: ['wins', 'losses', 'finals', 'finalDeaths', 'beds', 'bedsLost', 'kills', 'deaths', 'wlr', 'fkdr', 'kdr', 'bblr', 'games', 'stars'],
    sessionSkywarsFields: ['wins', 'losses', 'kills', 'deaths', 'wlr', 'kdr', 'games', 'assists'],
    sessionDuelsFields: ['wins', 'losses', 'kills', 'deaths', 'wlr', 'kdr'],
    sessionGoalWins: 0,
    sessionGoalFinals: 0,
    sessionGoalGames: 0,
    sessionGoalMinutes: 0,

    // Render known nicked players under their real IGN above their head and in
    // tab. Display-only: the rewrite happens on the copy sent to the client,
    // never in internal state (see src/denick/displayNames.js).
    denickRealIgnNametags: false,
    // When a known nick is rendered under its real IGN, replace only the
    // clientbound signed texture property while retaining Hypixel's entity UUID.
    denickRealSkin: false,
    // Replace known nicknames in incoming chat messages with their real IGN.
    // The original server message remains unchanged for internal parsing.
    denickRealIgnChat: false,

    // Custom display names for people you know (see src/friends/aliasBook.js).
    // Keyed on the real IGN, so one entry covers a friend nicked or not, and
    // resolved after the denick so it wins over the real IGN. Display-only,
    // on the same rewrite path as the denick rename above.
    // The master switch. Off kills every custom-name surface at once while
    // leaving the per-surface choices and the alias book untouched.
    friendAliasEnabled: true,
    friendAliasNametags: false,
    friendAliasChat: false,
    friendAliasTabStats: false,
    // Append the real IGN after a custom alias in the tab row, so an alias
    // never leaves you unable to tell who you are actually looking at.
    friendAliasShowRealIgn: true,

    // /share: broadcasts tag/nick/threat info from the latest scan to party chat.
    shareTagsAuto: false,
    shareTagsFancy: false, // fancy = star level + icons in broadcast lines
    shareTagsColorLocal: true, // recolor our own share echoes locally (no doubling)
    shareTagsIncludeTagged: true,
    shareTagsIncludeNicks: true,
    shareTagsIncludeThreats: true,
    shareTagsDestination: 'party',
    // Live sharing always keeps each team together, in completion order.
    shareTagsGroupByTeam: true,

    // Scan configuration (mutated by /scanmode + /scanconfig).
    scanMode: 'threats',
    threatConfig: {
        minFkdr: 3.0,
        minStars: 1000,
        minSkywarsKdr: 2.0,
        minSkywarsWlr: 1.0,
        minSkywarsLevel: 10,
        countTags: true
    },

    // Most recent /scan results — kept so /share can broadcast without re-scanning.
    lastScanResults: null
};

module.exports = { state };
