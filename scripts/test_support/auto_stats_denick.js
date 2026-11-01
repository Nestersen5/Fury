'use strict';

// Offline test support: executes the actual proxy functions in an isolated VM.
// All lookups, storage writes, game state and timers are supplied by the fixture.

const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const { createDenickCommands, parseStatCount } = require('../../src/denick/commands');
const { createDenickTracker } = require('../../src/net/session/denickTracking');
const { getBedwarsScanStats, formatAutoDenickMatch, formatAutoDenickPossibleMatches, formatAutoDenickNotice } = require('../../src/stats/scanLine');
const { stripAnsi, extractText } = require('../../features/minecraft_chat');
const { createOverlayTagBuilder } = require('../../src/overlay/tags');
const { buildOverlayTagComponents } = require('../../src/overlay/chat_overlay_annotation');
const { isUrchinRequestFailed, shortUrchinStatusLabel, urchinStatusMessage } = require('../../src/stats/urchin');
const { buildOverlayTags } = createOverlayTagBuilder({ compactTagName: String });

const source = fs.readFileSync(require.resolve('../../proxy.js'), 'utf8');
const start = source.indexOf('        function isAutoDenickAlreadyResolved(');
const end = source.indexOf('        function touchLobbyPlayer(', start);
assert(start >= 0 && end > start);
const announcementStart = source.indexOf('        async function announceSuccessfulDenick(');
const announcementEnd = source.indexOf('        function announceDenickToParty(', announcementStart);
const tagStart = source.indexOf('function getInteractiveTags(');
const tagEnd = source.indexOf('// renderSkyWarsDashboard lives', tagStart);
assert(announcementStart >= 0 && announcementEnd > announcementStart && tagStart >= 0 && tagEnd > tagStart);
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const player = (finals = 1000, beds = 500) => ({ data: { player: {
    displayname: 'RealPlayer', achievements: { bedwars_level: 250 },
    stats: { Bedwars: { final_kills_bedwars: finals, beds_broken_bedwars: beds, final_deaths_bedwars: 100, wins_bedwars: 90, losses_bedwars: 30, winstreak: 4 } }
} } });
const candidate = (name = 'RealPlayer') => ({ name, displayName: name, finals: 1000, beds: 500, scanStats: getBedwarsScanStats(player().data.player) });
const match = () => ({ complete: true, candidates: [candidate()] });

function lookupHarness({ lists = { finals: ['realplayer'], beds: ['realplayer'] }, profiles = {}, response, lookup, parsed, cosmetics = [] } = {}) {
    const requests = [], verified = [], messages = [];
    const commands = createDenickCommands({
        axios: { get: async (url, options) => {
            requests.push({ url, options });
            if (response) return response;
            if (url.includes('/api/cosmetics/search')) return { data: { success: true, data: cosmetics } };
            const stat = url.includes('/finals?') ? 'finals' : 'beds';
            return { data: { success: true, data: (lists[stat] || []).map(entry => typeof entry === 'string' ? { name: entry } : entry) } };
        } },
        sendChat: (_, message) => messages.push(extractText(message)), getKeys: () => ({ aurora: 'fixture' }), hasHypixelApiKeyConfigured: () => true,
        cosmeticSearchApiUrl: 'http://fixture.invalid', getCosmeticSearchToken: () => '',
        denickRange: 200, formatInt: String,
        getPlayerData: async (name, options) => {
            verified.push({ name, options });
            return lookup ? lookup(name) : (Object.hasOwn(profiles, name) ? profiles[name] : player());
        },
        getRealNameFromSkin: () => null, isMinecraftUsername: () => true,
        appendDenickHistory: () => {}, parseDenickFilters: () => parsed || ({})
    });
    return { find: commands.findDenickCandidatesByStats, handle: commands.handleDenick, requests, verified, messages };
}

function harness({ find = async () => match(), local = true, detected = true, realAnnouncements = false, profileLookup = async () => player() } = {}) {
    let now = 1000000, nextTimer = 0;
    const timers = new Map(), messages = [], rawMessages = [], queries = [], saved = [], announced = [], updates = [], cosmetics = [], partyAnnounced = [];
    const tracker = createDenickTracker({ isValidPlayerName: () => true, nickKey: n => n.toLowerCase() });
    const detectedNames = new Set(detected ? ['hiddennick'] : []), teammates = new Set();
    const context = {
        ...tracker, denickTracker: tracker, autoDenickRetryTimers: new Map(),
        gameActive: true, currentGamemode: 'BEDWARS', gameSessionId: 1,
        lastBedwarsGameSessionId: 1, autoDenickGraceUntil: 0,
        autoStatsDenickEnabled: true, denickChatAnnouncementsEnabled: local, connectionTimersCleared: false,
        Date: { now: () => now }, client: { username: 'Self' }, gameRoster: new Set(['HiddenNick']),
        setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, at: now + delay }); return id; },
        clearTimeout: id => timers.delete(id),
        nickKey: name => name.toLowerCase(), parseStatCount, stripAnsi, getBedwarsScanStats, formatAutoDenickMatch,
        formatAutoDenickPossibleMatches, formatAutoDenickNotice,
        buildOverlayTags, buildOverlayTagComponents, isUrchinRequestFailed, shortUrchinStatusLabel, urchinStatusMessage,
        isOwnPlayerName: name => name === 'Self', isSameTeamAsClient: name => teammates.has(name),
        isDetectedNickedPlayer: name => detectedNames.has(name.toLowerCase()),
        isAutoDenickEligibleActor: name => context.gameActive && context.currentGamemode === 'BEDWARS' && name !== 'Self' && !teammates.has(name),
        markNickedPlayer: name => detectedNames.add(name.toLowerCase()),
        getPlayerDataWithNickDetection: async () => ({ data: { isNicked: true } }),
        sendChat: (_, message) => { rawMessages.push(message); messages.push(extractText(message)); },
        findDenickCandidatesByStats: async (targets, options) => { queries.push({ targets, options }); return find(targets, options); },
        appendDenickHistory: entry => saved.push(entry), rememberCurrentGameDenickNames: () => {},
        cleanupDenickAliasDuplicate: () => {}, queueOverlayStatsUpdate: name => updates.push(name),
        isTabStatsActiveInGame: () => true, queueTabStatsUpdate: () => {}, saveCurrentMatchSnapshot: () => {},
        getPlayerData: profileLookup, shouldSuppressDenickAnnouncement: () => false,
        rememberPlayerActiveCosmetics: name => cosmetics.push(name), denickPartyAnnounceEnabled: true,
        announceDenickToParty: (...args) => partyAnnounced.push(args)
    };
    vm.createContext(context);
    vm.runInContext(source.slice(tagStart, tagEnd), context);
    vm.runInContext(source.slice(announcementStart, announcementEnd), context);
    const productionAnnouncement = context.announceSuccessfulDenick;
    context.announceSuccessfulDenick = async (name, result, options) => {
        if (!options.preview && options.isCurrent()) announced.push({ name, result });
        if (options.preview || realAnnouncements) return productionAnnouncement(name, result, options);
    };
    vm.runInContext(source.slice(start, end), context);
    const record = async (stat, value, name = 'HiddenNick') => { context.recordAutoDenickStat(name, stat, value); await flush(); };
    const advance = async ms => {
        now += ms;
        for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
        await flush();
    };
    return { context, tracker, teammates, timers, messages, rawMessages, queries, saved, announced, updates, cosmetics, partyAnnounced, record, advance };
}

module.exports = { flush, deferred, player, candidate, match, lookupHarness, harness };
