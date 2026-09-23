const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { spawn, fork } = require('child_process');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { GRACE_MS, FORCE_MS, within } = require('./src/bootstrap/shutdown');
const { superviseChild } = require('./src/bootstrap/childShutdown');
let quitting = false, quitAllowed = false, quitOperation = null, relaunchRequested = false;
let rendererFlushing = false, acceptedSaveFailure = false;
const acceptedSaves = new Set();
const durableChannels = /^(settings:save|profiles:(apply|save|duplicate|update|delete|import)|session:action|account:(select|remove)|denick:(add|remove))/;
function handleLauncherRequest(channel, handler) {
    ipcMain.handle(channel, (event, ...args) => {
        if (quitting && !(rendererFlushing && channel.startsWith('settings:save'))) throw new Error('Fury is stopping.');
        const result = handler(event, ...args);
        if (durableChannels.test(channel)) {
            const pending = Promise.resolve(result);
            acceptedSaves.add(pending);
            pending.then(() => acceptedSaves.delete(pending), () => { acceptedSaves.delete(pending); if (quitting) acceptedSaveFailure = true; });
        }
        return result;
    });
}

const { diagnosticsEnabled } = require('./src/bootstrap/diagnostics');
const { initializeDataDir, getDataDir, dataPath, defaultDataDir } = require('./src/storage/runtimePaths.js');

app.setName('Fury');
// Preservation must precede Chromium and every module that opens mutable data.
// The maintenance helper exits here without starting Fury services or a window.
if (!require('./src/storage/windowsMigrationBootstrap').run({ app, dialog, projectRoot: __dirname })) return;
initializeDataDir(defaultDataDir({ isPackaged: app.isPackaged,
    platform: process.platform, appData: app.getPath('appData'), projectRoot: __dirname }));
fs.mkdirSync(dataPath('launcher_data'), { recursive: true });
app.setPath('userData', dataPath('launcher_data'));
if (!require('./src/bootstrap/launcherInstance').acquireLauncherInstance({
    app, getWindow: () => win, isQuitting: () => quitting
})) return;

const net = require('net');
const axios = require('axios');
const { Authflow, Titles } = require('prismarine-auth');
const {
    DENICK_ISLAND_TOPPER_NAMES,
    DENICK_DEATH_CRY_NAMES,
    DENICK_SHOPKEEPER_SKIN_NAMES,
    DENICK_GLYPH_NAMES,
    DENICK_FIGURINE_NAMES,
    DENICK_PROJECTILE_TRAIL_NAMES
} = require('./src/cosmetics/cosmetic_name_catalog.js');
const {
    paths: appConfigPaths,
    loadAllSettings,
    saveAllSettings,
    saveScanSettings,
    saveFeatureSettings,
    saveChatTriggerSettings,
    loadKeys
} = require('./app_config.js');
const {
    createProfileStore,
    filterPresetSettings,
    splitByNamespace,
    diffSettings,
    profileSettingLabel,
    describeProfileSettings
} = require('./src/profiles/profileStore.js');
const {
    normalizeStore,
    sessionDeltaFor,
    DEFAULT_MAX_SESSIONS,
    DEFAULT_MAX_GAMES_PER_SESSION
} = require('./src/session/sessionStore.js');
const { buildLauncherSessionHistory, createLauncherSessionHistoryReceiver } = require('./src/session/launcherSessionHistory.js');
const { VERSION: HISTORY_VERSION, HistoryResponses } = require('./src/session/historyResponse');
const historyResponses = new HistoryResponses();
// Last session history the running proxy sent, reused while it reports no change.
const proxySessionHistory = createLauncherSessionHistoryReceiver();
app.on('web-contents-created', (event, contents) => {
    contents.once('destroyed', () => historyResponses.release(contents.id));
});
const { createReminderAccountStore, createRememberedReminders } = require('./src/reminders/rememberedAccount');
const { createHypixelApiClient } = require('./features/hypixel_api_client');
const { normalizeAccount, sameAccount, sessionBelongsToAccount, buildAccountCatalog, createViewedAccountStore } = require('./src/accounts/launcherAccounts');
const { promoteAuthCache } = require('./src/accounts/authCache');
const { createRemovedAccountStore, removeAuthCaches } = require('./src/accounts/accountRemoval');
const removedAccounts = createRemovedAccountStore(dataPath('launcher_data', 'removed-accounts.json'));
const accountSkins = require('./src/accounts/skinCache').createAccountSkinCache({directory:dataPath('launcher_data','skins'),axios});
const viewedAccounts = createViewedAccountStore(dataPath('launcher_data', 'viewed-account.json'));
const reminderAccounts = createReminderAccountStore(dataPath('launcher_data', 'reminders'));
const reminderApi = createHypixelApiClient({ axios, getKeys: () => loadAllSettings().keys });
const rememberedReminders = createRememberedReminders({
    store: reminderAccounts,
    getAccount: () => selectedLauncherAccount(),
    getSettings: loadAllSettings,
    fetchPlayer: async uuid => (await reminderApi.hypixelApiGet(`https://api.hypixel.net/v2/player?uuid=${uuid}`, {
        timeout: 5000, apiPriority: 'background'
    })).data
});
let reminderRefreshTimer = null;
// Each request captures its identity. The reminder service coalesces by UUID.
async function refreshRememberedReminders({ force = false } = {}) {
    const account = selectedLauncherAccount();
    return rememberedReminders.refresh({ force, account });
}

function getLauncherAccounts() {
    const raw = readJsonFile(SESSION_DATA_FILE);
    return removedAccounts.filter(buildAccountCatalog({ authAccounts: getAuthAccounts().filter(account => account.folderExists || account.uuid),
        sessions: Array.isArray(raw?.sessions) ? raw.sessions : Array.isArray(raw) ? raw : [],
        remembered: reminderAccounts.selected() }));
}

function selectedLauncherAccount() {
    return viewedAccounts.resolve(getLauncherAccounts(), reminderAccounts.selected());
}

const AUTH_PATH = dataPath('auth_tokens');
const APP_ICON_PATH = path.join(__dirname, 'assets', 'fury-icon.ico');
const LEGACY_PRESETS_FILE = dataPath('presets.json');
const PROFILES_FILE = dataPath('launcher_data', 'profiles.json');
const PROFILE_EXPORT_EXTENSION = 'furyprofile';
const MAX_PROFILE_IMPORT_BYTES = 256 * 1024;
const DENICKED_HISTORY_FILE = dataPath('denicked.json');
const COSMETIC_API_NAMES_FILE = dataPath('cosmetic_api_names.json');
// Development-only pinned accounts; packaged builds never pin. Add local test
// accounts with FURY_DEV_PINNED_ACCOUNTS=Name1,Name2 rather than committing them.
const PINNED_AUTH_USERS = app.isPackaged ? []
    : (process.env.FURY_DEV_PINNED_ACCOUNTS || 'Nestersen').split(',').map(name => name.trim()).filter(Boolean);
const COSMETIC_SEARCH_API_URL = (process.env.COSMETIC_SEARCH_API_URL || 'http://127.0.0.1:3210').replace(/\/+$/, '');
const COSMETIC_SEARCH_TOKEN = process.env.COSMETIC_SEARCH_TOKEN || '';
const SESSION_DATA_FILE = dataPath('session_data.json');
const LAUNCHER_DENICK_LOOKUP_RANGE = 800;
const LAUNCHER_DENICK_MAX_RESULTS = 100;

const services = {
    proxy: { label: 'Proxy', script: 'proxy.js', child: null, logs: [] },
    cosmeticSearch: { label: 'Cosmetic Search API', script: 'cosmetic_search_api.js', child: null, logs: [] }
};

// The cosmetic reverse-search backend that /denick talks to. We only manage a
// local copy when COSMETIC_SEARCH_API_URL still points at this machine; if the
// operator repointed it at a remote backend, leave that one alone.
function cosmeticSearchIsLocal() {
    try {
        const host = new URL(COSMETIC_SEARCH_API_URL).hostname.replace(/^\[|\]$/g, '');
        return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '0.0.0.0';
    } catch (e) {
        return false;
    }
}

function cosmeticSearchEnvironment() {
    const env = {};
    try {
        const aurora = String(loadAllSettings().keys?.aurora || '').trim();
        if (aurora) env.AURORA_API_KEY = aurora;
    } catch (e) { /* settings unreadable; service will report a missing key per-query */ }
    if (COSMETIC_SEARCH_TOKEN) env.COSMETIC_SEARCH_TOKEN = COSMETIC_SEARCH_TOKEN;
    try {
        env.COSMETIC_SEARCH_PORT = String(new URL(COSMETIC_SEARCH_API_URL).port || 3210);
    } catch (e) {
        env.COSMETIC_SEARCH_PORT = '3210';
    }
    return env;
}

let win = null;
let apiStatusCache = { at: 0, data: null };
let settingsWatcher = null;
let settingsWatchTimer = null;
let profileWatcher = null;
const logUpdateTimers = new Map();

// Hardware compositing is dramatically cheaper for the launcher's gradients,
// shadows, blur and WebGL preview. Keep a compatibility escape hatch for
// machines with broken GPU drivers instead of forcing software rendering for
// every user.
const forceSoftwareRendering = /^(1|true|yes|on)$/i.test(
    String(process.env.FURY_DISABLE_HARDWARE_ACCELERATION || '').trim()
);
if (forceSoftwareRendering) app.disableHardwareAcceleration();

function writeProfileJson(file, data) {
    const directory = path.dirname(file);
    const temporary = path.join(directory, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
    fs.mkdirSync(directory, { recursive: true });
    try {
        fs.writeFileSync(temporary, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(temporary, file);
    } catch (error) {
        try { fs.unlinkSync(temporary); } catch (ignored) {}
        throw error;
    }
}

// Profile storage is user-owned and survives application upgrades. Copy the
// old presets file once so existing setups become custom profiles seamlessly.
if (!fs.existsSync(PROFILES_FILE) && fs.existsSync(LEGACY_PRESETS_FILE)) {
    try {
        fs.mkdirSync(path.dirname(PROFILES_FILE), { recursive: true });
        fs.copyFileSync(LEGACY_PRESETS_FILE, PROFILES_FILE);
    } catch (error) {
        // The proxy performs the same best-effort migration for standalone
        // use; keep the launcher usable even if a stale file is locked.
    }
}

const profileStore = createProfileStore({
    profileFile: PROFILES_FILE,
    writeJsonOffThread: writeProfileJson,
    saveDelayMs: 0,
    logger: console
});

function nodeBinary() {
    // A packaged Electron app does not have a system Node.js dependency. Its
    // own executable can run normal Node entrypoints when this environment
    // flag is set on the child process (see startService below).
    if (app.isPackaged) return process.execPath;
    return process.env.npm_node_execpath || process.env.NODE_BINARY || 'node';
}

function isRunning(name) {
    const child = services[name]?.child;
    return Boolean(child && child.exitCode === null && child.signalCode === null);
}

function pushLog(name, line) {
    const service = services[name];
    if (!service) return;
    const clean = String(line).replace(/\x1b\[[0-9;]*m/g, '').trimEnd();
    if (!clean) return;
    service.logs.push(clean);
    if (service.logs.length > 160) service.logs.shift();
    scheduleLogUpdate(name);
}

function scheduleLogUpdate(name) {
    if (logUpdateTimers.has(name)) return;
    const timer = setTimeout(() => {
        logUpdateTimers.delete(name);
        const service = services[name];
        if (!service || !win || win.isDestroyed()) return;
        // Send the compact log projection directly. The renderer can update
        // the console without rebuilding the complete launcher state.
        win.webContents.send('logs:update', name, service.logs.slice(-80));
    }, 50);
    if (typeof timer.unref === 'function') timer.unref();
    logUpdateTimers.set(name, timer);
}

function sendToLauncherWindows(channel, payload) {
    [win].forEach((target) => {
        if (target && !target.isDestroyed()) target.webContents.send(channel, payload);
    });
}

function notifySettingsUpdated(reason = 'features') {
    invalidateHistory();
    sendToLauncherWindows('settings:update', { reason });
}

function notifyHistoryInvalidated(revision) {
    sendToLauncherWindows('history:invalidate', revision);
}

function invalidateHistory() {
    notifyHistoryInvalidated(historyResponses.invalidate());
}

function historyMutation(action) {
    return historyResponses.mutate(action, notifyHistoryInvalidated);
}

function startSettingsWatcher() {
    if (settingsWatcher) return;
    // Commands such as `/preset load` update more than just features_config:
    // a preset can also change scan mode and thresholds. Watch every file that
    // contributes to state:get so the launcher never keeps showing the old
    // value after an in-game command changes the config on disk.
    const watchedFiles = new Map(Object.entries(appConfigPaths).map(([reason, file]) => [
        path.basename(file).toLowerCase(),
        reason
    ]));
    const watchDir = path.dirname(appConfigPaths.features);
    try {
        settingsWatcher = fs.watch(watchDir, (eventType, filename) => {
            const changed = filename ? path.basename(String(filename)).toLowerCase() : '';
            if (changed === path.basename(SESSION_DATA_FILE).toLowerCase()) {
                invalidateHistory();
                return;
            }
            if (changed && !watchedFiles.has(changed)) return;
            const reason = watchedFiles.get(changed) || 'external';
            clearTimeout(settingsWatchTimer);
            settingsWatchTimer = setTimeout(() => notifySettingsUpdated(reason), 120);
            if (settingsWatchTimer.unref) settingsWatchTimer.unref();
        });
        settingsWatcher.on('error', (error) => {
            pushLog('proxy', `[Launcher] Settings live-sync watcher stopped: ${error.message}`);
            settingsWatcher = null;
        });
    } catch (error) {
        pushLog('proxy', `[Launcher] Settings live-sync unavailable: ${error.message}`);
    }

    if (profileWatcher) return;
    try {
        const profileName = path.basename(PROFILES_FILE).toLowerCase();
        profileWatcher = fs.watch(path.dirname(PROFILES_FILE), (eventType, filename) => {
            const changed = filename ? path.basename(String(filename)).toLowerCase() : '';
            if (changed && changed !== profileName) return;
            profileStore.cache.invalidate();
            notifySettingsUpdated('profiles');
        });
        profileWatcher.on('error', () => { profileWatcher = null; });
    } catch (error) {
        profileWatcher = null;
    }
}

async function startService(name) {
    const service = services[name];
    if (!service) throw new Error(`Unknown service: ${name}`);
    if (quitting) throw new Error('Fury is stopping.');
    if (service.stopping) {
        const result = await service.stopping;
        if (!result.clean || !result.exited) throw new Error('Previous shutdown was not clean. Check the service log before starting again.');
    }
    if (quitting) throw new Error('Fury is stopping.');
    if (isRunning(name)) return serviceState(name);
    const instanceId = randomUUID();
    const child = spawn(nodeBinary(), [path.join(__dirname, service.script)], {
        cwd: getDataDir(),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: {
            ...process.env,
            FURY_SERVICE_INSTANCE: instanceId,
            FORCE_COLOR: '0',
            STATMOD_LAUNCHER: '1',
            // Electron's executable doubles as the bundled Node runtime.
            // This makes a fresh Nester installation self-contained instead
            // of requiring the player to install Node.js separately.
            ...(app.isPackaged ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
            ...(app.isPackaged ? { FURY_RESOURCES_PATH: process.resourcesPath } : {}),
            ...(name === 'cosmeticSearch' ? cosmeticSearchEnvironment() : {})
        }
    });

    service.child = child;
    service.supervisor = superviseChild(child, instanceId, { log: message => pushLog(name, `[Launcher] ${message}`) });
    if (name === 'proxy') service.startedServerSettings = JSON.stringify(loadAllSettings().server);
    pushLog(name, `[Launcher] Started ${service.label} (pid ${child.pid})`);

    child.stdout.on('data', (chunk) => {
        chunk.toString().split(/\r?\n/).forEach((line) => pushLog(name, line));
    });
    child.stderr.on('data', (chunk) => {
        chunk.toString().split(/\r?\n/).forEach((line) => pushLog(name, line));
    });
    child.on('exit', (code, signal) => {
        pushLog(name, `[Launcher] ${service.label} stopped (${signal || (code ?? 'unknown')})`);
        if (service.child === child) service.child = null;
        if (win && !win.isDestroyed()) win.webContents.send('service:update', name);
    });
    child.on('error', (err) => {
        pushLog(name, `[Launcher] Failed to start: ${err.message}`);
        if (!child.pid && service.child === child) service.child = null;
    });

    // /denick's cosmetic reverse-search needs the local search backend up, so
    // bring it along whenever the proxy starts (best-effort; failure here must
    // not block the proxy itself).
    if (name === 'proxy' && cosmeticSearchIsLocal()) {
        startService('cosmeticSearch').catch((e) => {
            pushLog('cosmeticSearch', `[Launcher] Could not start Cosmetic Search API: ${e.message}`);
        });
    }

    return serviceState(name);
}

function stopService(name, { deadline = Date.now() + GRACE_MS, reason = 'stop' } = {}) {
    const service = services[name];
    if (!service) throw new Error(`Unknown service: ${name}`);
    if (service.stopping) return service.stopping;
    const supervisor = service.supervisor;
    const stopping = (async () => {
        const results = await Promise.all([
            supervisor ? supervisor.stop({ deadline, reason }) : { clean: true, exited: true },
            ...(name === 'proxy' ? [stopService('cosmeticSearch', { deadline, reason })] : [])
        ]);
        const clean = results.every(result => result.clean);
        const exited = results.every(result => result.exited);
        return { ...serviceState(name), clean, exited, outcome: clean ? 'EXITED' : 'FORCED' };
    })();
    service.stopping = stopping;
    stopping.finally(() => { if (service.stopping === stopping) service.stopping = null; });
    return stopping;
}

function serviceState(name) {
    const service = services[name];
    return {
        name,
        label: service.label,
        running: isRunning(name),
        pid: isRunning(name) ? service.child.pid : null,
        restartRequired: name === 'proxy' && isRunning(name) && service.startedServerSettings !== JSON.stringify(loadAllSettings().server),
        logs: service.logs.slice(-80)
    };
}

function listAuthUsers() {
    try {
        const users = fs.existsSync(AUTH_PATH)
            ? fs.readdirSync(AUTH_PATH, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name)
            : [];
        return Array.from(new Set([...PINNED_AUTH_USERS, ...users]))
            .sort((a, b) => {
                const pinnedA = PINNED_AUTH_USERS.findIndex(name => name.toLowerCase() === a.toLowerCase());
                const pinnedB = PINNED_AUTH_USERS.findIndex(name => name.toLowerCase() === b.toLowerCase());
                if (pinnedA !== -1 || pinnedB !== -1) return (pinnedA === -1 ? 999 : pinnedA) - (pinnedB === -1 ? 999 : pinnedB);
                return a.localeCompare(b);
            });
    } catch (e) {
        return PINNED_AUTH_USERS.slice();
    }
}

function readJsonFile(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        return null;
    }
}

// History remains useful after the proxy has stopped. Read the persisted store
// as a fallback, while a running proxy supplies its fresher in-memory view.
function readPersistedSessionHistory(account = selectedLauncherAccount()) {
    const features = loadAllSettings().features || {};
    const retentionValue = Number(features.sessionRetention);
    const retention = retentionValue === 0 ? 0 : (retentionValue || DEFAULT_MAX_SESSIONS);
    const boundaryMs = (Number(features.sessionBoundaryMinutes) || 180) * 60 * 1000;
    const raw = readJsonFile(SESSION_DATA_FILE);
    const sessions = normalizeStore(raw, retention, DEFAULT_MAX_GAMES_PER_SESSION).sessions;
    const entries = sessions
        .slice()
        .sort((a, b) => b.startedAt - a.startedAt)
        .map(session => ({
            session,
            delta: sessionDeltaFor(session),
            active: !session.endedAt && Date.now() - session.lastSeen < boundaryMs
        }))
        .filter(entry => Boolean(entry.delta));
    return buildLauncherSessionHistory(entries, { limit: retention, sessionSettings: features, account, accountScoped: true });
}

function uniquePushCaseInsensitive(items, value) {
    const clean = String(value || '').trim();
    if (!clean) return;
    if (!items.some(item => String(item).toLowerCase() === clean.toLowerCase())) {
        items.push(clean);
    }
}

function isMinecraftUsername(value) {
    return /^[A-Za-z0-9_]{3,16}$/.test(String(value || '').trim());
}

function denickEventTimestamp(event = {}) {
    const parsed = Date.parse(event.at || '');
    return Number.isFinite(parsed) ? parsed : 0;
}

function dedupeDenickEventsByNick(events = []) {
    const byNick = new Map();
    events.filter(Boolean).forEach((event) => {
        const key = String(event.nick || '').trim().toLowerCase();
        if (!key) return;
        const current = byNick.get(key);
        if (!current || denickEventTimestamp(event) >= denickEventTimestamp(current)) {
            byNick.set(key, event);
        }
    });
    return Array.from(byNick.values());
}

function finalizeDenickPlayerEvents(player = {}) {
    player.events = dedupeDenickEventsByNick(Array.isArray(player.events) ? player.events : [])
        .sort((a, b) => denickEventTimestamp(b) - denickEventTimestamp(a))
        .slice(0, 100);
    if (player.events.length > 0) {
        const sortedAscending = player.events.slice().sort((a, b) => denickEventTimestamp(a) - denickEventTimestamp(b));
        player.firstSeen = sortedAscending[0].at || player.firstSeen;
        player.lastSeen = sortedAscending[sortedAscending.length - 1].at || player.lastSeen;
    }
    return player;
}

function normalizeDenickHistory(raw) {
    const rows = Array.isArray(raw)
        ? raw
        : (raw && typeof raw === 'object' && Array.isArray(raw.players) ? raw.players : []);
    const byRealName = new Map();

    rows.forEach((item) => {
        const realIGN = String(item.realIGN || item.realName || '').trim();
        if (!realIGN) return;
        const key = realIGN.toLowerCase();
        const current = byRealName.get(key) || {
            realIGN,
            nicks: [],
            methods: [],
            firstSeen: item.firstSeen || item.at || '',
            lastSeen: item.lastSeen || item.at || '',
            events: []
        };

        const nicks = Array.isArray(item.nicks) ? item.nicks : (item.nick ? [item.nick] : []);
        nicks.forEach(nick => uniquePushCaseInsensitive(current.nicks, nick));

        const methods = Array.isArray(item.methods) ? item.methods : (item.method ? [item.method] : []);
        methods.forEach(method => uniquePushCaseInsensitive(current.methods, method));

        const events = Array.isArray(item.events) ? item.events : (item.nick ? [item] : []);
        events.forEach((event) => {
            const nick = String(event.nick || item.nick || '').trim();
            const at = event.at || item.lastSeen || item.firstSeen || '';
            const method = String(event.method || item.method || 'unknown').trim() || 'unknown';
            const normalized = {
                at,
                nick,
                realIGN,
                method,
                stats: event.stats || null,
                gameMode: event.gameMode || null,
                account: event.account || null
            };
            if (nick) uniquePushCaseInsensitive(current.nicks, nick);
            uniquePushCaseInsensitive(current.methods, method);
            current.events.push(normalized);
            if (at && (!current.firstSeen || String(at) < String(current.firstSeen))) current.firstSeen = at;
            if (at && (!current.lastSeen || String(at) > String(current.lastSeen))) current.lastSeen = at;
        });

        finalizeDenickPlayerEvents(current);
        byRealName.set(key, current);
    });

    return Array.from(byRealName.values())
        .sort((a, b) => String(b.lastSeen || '').localeCompare(String(a.lastSeen || '')));
}

function getDenickHistory() {
    const raw = fs.existsSync(DENICKED_HISTORY_FILE) ? readJsonFile(DENICKED_HISTORY_FILE) : [];
    const players = normalizeDenickHistory(raw);
    const methods = {};
    let totalNicks = 0;
    let totalEvents = 0;

    players.forEach((player) => {
        const events = Array.isArray(player.events) ? player.events : [];
        totalNicks += Array.isArray(player.nicks) ? player.nicks.length : 0;
        totalEvents += events.length;
        const countedMethods = events.length ? events.map(event => event.method) : (player.methods || []);
        countedMethods.forEach((method) => {
            const key = String(method || 'unknown');
            methods[key] = (methods[key] || 0) + 1;
        });
    });

    return {
        players,
        totalPlayers: players.length,
        totalNicks,
        totalEvents,
        methods,
        fileExists: fs.existsSync(DENICKED_HISTORY_FILE)
    };
}

function addManualDenickMapping(nickRaw, realRaw, account = 'launcher') {
    const nick = String(nickRaw || '').trim();
    const realIGN = String(realRaw || '').trim();
    if (!isMinecraftUsername(nick) || !isMinecraftUsername(realIGN)) {
        throw new Error('Use valid Minecraft names, 3-16 characters.');
    }
    if (nick.toLowerCase() === realIGN.toLowerCase()) {
        throw new Error('Nick and real IGN must be different.');
    }

    const now = new Date().toISOString();
    const raw = fs.existsSync(DENICKED_HISTORY_FILE) ? readJsonFile(DENICKED_HISTORY_FILE) : [];
    const players = normalizeDenickHistory(raw);
    const realKey = realIGN.toLowerCase();
    let player = players.find(item => String(item.realIGN || '').toLowerCase() === realKey);

    if (!player) {
        player = {
            realIGN,
            nicks: [],
            methods: [],
            firstSeen: now,
            lastSeen: now,
            events: []
        };
        players.push(player);
    }

    player.realIGN = player.realIGN || realIGN;
    uniquePushCaseInsensitive(player.nicks, nick);
    uniquePushCaseInsensitive(player.methods, 'manual');
    if (!Array.isArray(player.events)) player.events = [];
    player.events.push({
        at: now,
        nick,
        realIGN: player.realIGN,
        method: 'manual',
        stats: null,
        gameMode: null,
        account
    });
    finalizeDenickPlayerEvents(player);

    players.sort((a, b) => String(b.lastSeen || '').localeCompare(String(a.lastSeen || '')));
    fs.writeFileSync(DENICKED_HISTORY_FILE, JSON.stringify(players, null, 2), 'utf8');
    return { ok: true, nick, realIGN: player.realIGN };
}

function removePersistedDenickMapping(realRaw, nickRaw) {
    const realIGN = String(realRaw || '').trim();
    const nick = String(nickRaw || '').trim();
    if (!isMinecraftUsername(realIGN) || !isMinecraftUsername(nick)) {
        return { ok: false, error: 'Invalid saved nickname mapping.' };
    }

    const raw = fs.existsSync(DENICKED_HISTORY_FILE) ? readJsonFile(DENICKED_HISTORY_FILE) : [];
    const players = normalizeDenickHistory(raw);
    const playerIndex = players.findIndex(item => String(item.realIGN || '').toLowerCase() === realIGN.toLowerCase());
    if (playerIndex < 0) return { ok: false, error: 'That saved nickname mapping no longer exists.' };

    const player = players[playerIndex];
    const previousNickCount = player.nicks.length;
    player.nicks = player.nicks.filter(savedNick => String(savedNick).toLowerCase() !== nick.toLowerCase());
    player.events = player.events.filter(event => String(event.nick || '').toLowerCase() !== nick.toLowerCase());
    if (player.nicks.length === previousNickCount) {
        return { ok: false, error: 'That saved nickname mapping no longer exists.' };
    }

    if (!player.nicks.length) {
        players.splice(playerIndex, 1);
    } else {
        player.methods = [...new Set(player.events.map(event => String(event.method || 'unknown')))].filter(Boolean);
        finalizeDenickPlayerEvents(player);
    }
    fs.writeFileSync(DENICKED_HISTORY_FILE, JSON.stringify(players, null, 2), 'utf8');
    return { ok: true, realIGN: player.realIGN, nick, removedPlayer: !player.nicks.length };
}

async function runDenickRemoveAction(entry = {}) {
    const realIGN = String(entry.realIGN || '').trim();
    const nick = String(entry.nick || '').trim();
    if (!isMinecraftUsername(realIGN) || !isMinecraftUsername(nick)) {
        return { ok: false, error: 'Invalid saved nickname mapping.' };
    }
    const settings = loadAllSettings();
    try {
        const response = await axios.delete(
            `http://127.0.0.1:${settings.server.healthPort}/denick/${encodeURIComponent(realIGN)}/${encodeURIComponent(nick)}`,
            { timeout: 8000 }
        );
        // The proxy store writes off-thread. Mirror the same exact removal in
        // the persisted file so the launcher's immediate refresh cannot flash
        // the deleted mapping back into view while that write is still queued.
        if (response.data?.ok) removePersistedDenickMapping(realIGN, nick);
        return response.data;
    } catch (error) {
        if (error?.response) {
            return { ok: false, error: error.response.data?.error || 'Could not remove the saved nickname mapping.' };
        }
        return removePersistedDenickMapping(realIGN, nick);
    }
}

function fileStamp(filePath) {
    try {
        const stat = fs.statSync(filePath);
        return `${stat.mtimeMs}:${stat.size}`;
    } catch (e) {
        return 'missing';
    }
}

function cosmeticTypeLabel(type) {
    const labels = {
        beddestroy: 'Bed Destroys',
        finalkill: 'Final Kill Effects',
        woodskin: 'Wood Skins'
    };
    if (labels[type]) return labels[type];
    return String(type || 'Unknown')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, char => char.toUpperCase());
}

function cosmeticKey(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const LAUNCHER_DENICK_COSMETIC_FIELDS = {
    finalkill: {
        query: 'finalKill',
        label: 'Final Kill',
        prefix: 'killeffect',
        aliases: ['finalkill', 'final', 'killeffect', 'finalkilleffect']
    },
    beddestroy: {
        query: 'bedDestroy',
        label: 'Bed Destroy',
        prefix: 'beddestroy',
        aliases: ['beddestroy', 'bed', 'bedbreak', 'bedbreakeffect']
    },
    killmessage: {
        query: 'killMessage',
        label: 'Kill Message',
        prefix: 'killmessages',
        aliases: ['killmessage', 'killmessages', 'killmsg', 'message']
    },
    victorydance: {
        query: 'victoryDance',
        label: 'Victory Dance',
        prefix: 'victorydance',
        aliases: ['victorydance', 'victory', 'dance']
    },
    woodskin: {
        query: 'woodSkin',
        label: 'Wood Skin',
        prefix: 'woodskin',
        aliases: ['woodskin', 'woodtype', 'wood']
    },
    deathcry: {
        query: 'deathCry',
        label: 'Death Cry',
        prefix: 'deathcry',
        aliases: ['deathcry', 'death']
    },
    projectiletrail: {
        query: 'projectileTrail',
        label: 'Projectile Trail',
        prefix: 'projectiletrail',
        aliases: ['projectiletrail', 'projectile', 'trail']
    },
    glyph: {
        query: 'glyph',
        label: 'Glyph',
        prefix: 'glyph',
        aliases: ['glyph']
    },
    islandtopper: {
        query: 'islandTopper',
        label: 'Island Topper',
        prefix: 'islandtopper',
        aliases: ['islandtopper', 'topper']
    },
    npcskin: {
        query: 'npcSkin',
        label: 'Shopkeeper Skin',
        prefix: 'npcskin',
        aliases: ['npcskin', 'shopkeeper', 'shopkeeperskin']
    },
    sprays: {
        query: 'sprays',
        label: 'Spray',
        prefix: 'sprays',
        aliases: ['sprays', 'spray']
    },
    figurine: {
        query: 'figurine',
        label: 'Figurine',
        prefix: 'figurine',
        aliases: ['figurine']
    }
};

const LAUNCHER_DENICK_STATIC_NAMES = {
    islandtopper: DENICK_ISLAND_TOPPER_NAMES,
    deathcry: DENICK_DEATH_CRY_NAMES,
    npcskin: DENICK_SHOPKEEPER_SKIN_NAMES,
    glyph: DENICK_GLYPH_NAMES,
    figurine: DENICK_FIGURINE_NAMES,
    projectiletrail: DENICK_PROJECTILE_TRAIL_NAMES
};

function denickCosmeticSlug(name) {
    return String(name || '')
        .trim()
        .toLowerCase()
        .replace(/['’]/g, '')
        .replace(/#/g, 'number')
        .replace(/\+/g, 'plus')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function loadCosmeticApiNames() {
    const data = readJsonFile(COSMETIC_API_NAMES_FILE);
    return data && typeof data === 'object' ? data : {};
}

function launcherCosmeticMatches() {
    const data = loadCosmeticApiNames();
    return data.matches && typeof data.matches === 'object' ? data.matches : {};
}

function launcherCosmeticApiValue(type, value) {
    const field = LAUNCHER_DENICK_COSMETIC_FIELDS[type];
    const raw = String(value || '').trim();
    const normalized = cosmeticKey(raw);
    if (!field || !raw) return null;
    if (normalized === 'null') return 'null';
    if (normalized === 'random') return 'random';
    if (normalized === 'randomcosmetic') return 'random_cosmetic';
    if (normalized === 'randomfavoritecosmetic') return 'random_favorite_cosmetic';

    const learned = launcherCosmeticMatches()[type] || {};
    const learnedEntry = Object.entries(learned).find(([name, apiValue]) => {
        return cosmeticKey(name) === normalized || String(apiValue || '').toLowerCase() === raw.toLowerCase();
    });
    if (learnedEntry) return learnedEntry[1];

    const staticName = (LAUNCHER_DENICK_STATIC_NAMES[type] || []).find(name => cosmeticKey(name) === normalized);
    if (staticName) return `${field.prefix}_${denickCosmeticSlug(staticName)}`;

    const lower = raw.toLowerCase();
    if (lower.startsWith(`${field.prefix}_`)) return lower;
    if (type === 'finalkill' && lower.startsWith('killeffect_')) return lower;
    if (type === 'woodskin') {
        const woodMap = {
            oakplank: 'woodskin_oak',
            darkoakplank: 'woodskin_dark_oak',
            acaciaplank: 'woodskin_acacia',
            jungleplank: 'woodskin_jungle',
            birchplank: 'woodskin_birch',
            spruceplank: 'woodskin_spruce',
            oaklog: 'woodskin_oak_log',
            darkoaklog: 'woodskin_dark_oak_log',
            acacialog: 'woodskin_acacia_log',
            junglelog: 'woodskin_jungle_log',
            birchlog: 'woodskin_birch_log',
            sprucelog: 'woodskin_spruce_log'
        };
        return woodMap[normalized] || `woodskin_${denickCosmeticSlug(raw)}`;
    }
    if (type === 'finalkill' && normalized === 'shockwave') return 'killeffect_shockwave';
    if (type === 'beddestroy' && normalized === 'ghost') return 'beddestroy_ghosts';
    return `${field.prefix}_${denickCosmeticSlug(raw)}`;
}

function denickLookupCatalog() {
    const matches = launcherCosmeticMatches();
    return {
        fields: Object.entries(LAUNCHER_DENICK_COSMETIC_FIELDS).map(([type, field]) => {
            const learned = Object.entries(matches[type] || {}).map(([name, apiValue]) => ({ name, apiValue }));
            const learnedKeys = new Set(learned.map(item => cosmeticKey(item.name)));
            const staticOnly = (LAUNCHER_DENICK_STATIC_NAMES[type] || [])
                .filter(name => !learnedKeys.has(cosmeticKey(name)))
                .map(name => ({ name, apiValue: launcherCosmeticApiValue(type, name) }));
            return {
                type,
                label: field.label,
                query: field.query,
                options: (() => {
                    const ordinary = [...learned, ...staticOnly];
                    const none = ordinary.find(item => cosmeticKey(item.name) === 'none');
                    const common = [
                        { name: 'None', apiValue: none?.apiValue || `${field.prefix}_none`, description: 'No cosmetic selected' },
                        { name: 'Random', apiValue: 'random_cosmetic', description: 'Random cosmetic' },
                        { name: 'Random Favorite', apiValue: 'random_favorite_cosmetic', description: 'Random favorite cosmetic' },
                        { name: 'Not set', apiValue: 'null', description: 'No saved cosmetic value' }
                    ];
                    const seen = new Set(common.map(item => String(item.apiValue).toLowerCase()));
                    const options = ordinary.sort((a,b) => String(a.name).localeCompare(String(b.name))).filter(item => {
                        const key = String(item.apiValue).toLowerCase();
                        if (seen.has(key) || ['none','null','random','randomcosmetic','randomfavorite','randomfavoritecosmetic'].includes(cosmeticKey(item.name))) return false;
                        seen.add(key); return true;
                    });
                    return [...common.map(item => ({...item, common:true})), ...options];
                })()
            };
        })
    };
}

function parseDenickLookupCount(value) {
    if (value == null || String(value).trim() === '') return null;
    const parsed = Number(String(value).replace(/,/g, '').trim());
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function denickLookupCandidateKey(candidate = {}) {
    return String(candidate.name || candidate.displayName || candidate.uuid || '').trim().toLowerCase();
}

async function searchDenickCosmetics(cosmetics = [], limit = 100) {
    const params = {
        limit: Math.max(1, Math.min(Number(limit) || 100, LAUNCHER_DENICK_MAX_RESULTS))
    };
    const labels = [];
    cosmetics.forEach((item = {}) => {
        const type = String(item.type || '').toLowerCase();
        const field = LAUNCHER_DENICK_COSMETIC_FIELDS[type];
        if (!field) throw new Error(`Unknown cosmetic type: ${type || '(missing)'}`);
        const apiValue = launcherCosmeticApiValue(type, item.value);
        if (!apiValue) throw new Error(`Missing ${field.label} value.`);
        params[field.query] = apiValue;
        labels.push(`${field.label}: ${item.value}`);
    });
    if (COSMETIC_SEARCH_TOKEN) params.token = COSMETIC_SEARCH_TOKEN;
    const res = await axios.get(`${COSMETIC_SEARCH_API_URL}/api/cosmetics/search`, {
        timeout: 12000,
        params
    });
    if (res.data?.success === false) {
        throw new Error(res.data?.error || 'Cosmetic search failed.');
    }
    return {
        labels,
        filters: res.data?.filters || {},
        cache: res.data?.cache || null,
        totalMatches: Number(res.data?.totalMatches || 0) || 0,
        candidates: (Array.isArray(res.data?.data) ? res.data.data : []).map((row) => ({
            source: 'cosmetics',
            uuid: row.uuid || '',
            name: row.name || '',
            displayName: row.name || '',
            rank: row.rank || '',
            star: row.star,
            finals: row.finals,
            beds: row.beds,
            wins: row.wins, losses: row.losses, fkdr: row.fkdr, wlr: row.wlr, winstreak: row.winstreak,
            cosmetics: row.cosmetics || {},
            lastUpdated: row.lastUpdated || null
        }))
    };
}

async function auroraStatLookup(settings, type, value) {
    if (!settings.keys?.aurora) throw new Error('Set an Aurora API key first.');
    const res = await axios.get(`https://bordic.xyz/api/v2/resources/lookup/${type}`, {
        timeout: 12000,
        params: {
            value,
            range: LAUNCHER_DENICK_LOOKUP_RANGE,
            max: LAUNCHER_DENICK_MAX_RESULTS,
            key: settings.keys.aurora
        }
    });
    if (res.data?.success === false) throw new Error(res.data?.error || `Aurora ${type} lookup failed.`);
    return Array.isArray(res.data?.data) ? res.data.data : [];
}

async function searchDenickStats(settings, stats = {}) {
    const targets = {};
    const finals = parseDenickLookupCount(stats.finals);
    const beds = parseDenickLookupCount(stats.beds);
    if (finals !== null) targets.finals = finals;
    if (beds !== null) targets.beds = beds;
    const targetEntries = Object.entries(targets);
    if (!targetEntries.length) return { labels: [], candidates: [], totalMatches: 0 };

    const buckets = [];
    for (const [type, value] of targetEntries) {
        const rows = await auroraStatLookup(settings, type, value);
        const map = new Map();
        rows.forEach((row = {}) => {
            const key = denickLookupCandidateKey(row);
            if (!key) return;
            map.set(key, {
                source: 'stats',
                uuid: row.uuid || '',
                name: row.name || row.displayName || '',
                displayName: row.name || row.displayName || '',
                matchedStats: { [type]: value },
                aurora: row
            });
        });
        buckets.push(map);
    }

    if (!buckets.length) return { labels: [], candidates: [], totalMatches: 0 };
    let keys = Array.from(buckets[0].keys());
    for (let i = 1; i < buckets.length; i += 1) {
        keys = keys.filter(key => buckets[i].has(key));
    }

    const candidates = keys.map((key) => {
        const merged = {
            source: 'stats',
            name: '',
            displayName: '',
            uuid: '',
            matchedStats: { ...targets },
            auroraMatches: []
        };
        buckets.forEach((bucket) => {
            const row = bucket.get(key);
            if (!row) return;
            merged.name ||= row.name;
            merged.displayName ||= row.displayName;
            merged.uuid ||= row.uuid;
            // Preserve returned totals separately from the requested match targets.
            for (const field of ['finals', 'beds', 'star', 'rank', 'wins', 'losses', 'fkdr', 'wlr', 'winstreak']) {
                if (merged[field] == null && row.aurora[field] != null) merged[field] = row.aurora[field];
            }
            merged.auroraMatches.push(row.aurora);
        });
        return merged;
    });

    return {
        labels: targetEntries.map(([type, value]) => `${type}: ${value.toLocaleString()}`),
        candidates,
        totalMatches: candidates.length
    };
}

const denickPlayerStatsCache = new Map();
async function enrichDenickLookupPlayers(candidates, settings) {
    if (settings.features?.apiKillSwitchEnabled || !settings.keys?.hypixel) return;
    let next = 0;
    const worker = async () => {
        while (next < candidates.length) {
            const row = candidates[next++];
            const identity = row.uuid || row.name;
            if (!identity) continue;
            const cached = denickPlayerStatsCache.get(identity);
            if (cached && Date.now() - cached.at < 300000) { Object.assign(row, cached.stats); continue; }
            try {
                const query = row.uuid ? `uuid=${encodeURIComponent(row.uuid)}` : `name=${encodeURIComponent(row.name)}`;
                const response = await reminderApi.hypixelApiGet(`https://api.hypixel.net/v2/player?${query}`, { timeout: 5000, apiPriority: 'background' });
                const player = response.data?.player;
                if (!player || response.data?.success === false) continue;
                const stats = require('./src/stats/denickLookupPlayer').lookupPlayerStats(player);
                Object.assign(row, stats);
                denickPlayerStatsCache.set(identity, { at: Date.now(), stats });
                if (denickPlayerStatsCache.size > 500) denickPlayerStatsCache.delete(denickPlayerStatsCache.keys().next().value);
            } catch (_) { /* Keep search totals when profile details are unavailable. */ }
        }
    };
    await Promise.all(Array.from({ length: Math.min(3, candidates.length) }, worker));
}

async function runDenickLookup(payload = {}) {
    const settings = loadAllSettings();
    const cosmetics = Array.isArray(payload.cosmetics) ? payload.cosmetics : [];
    const stats = payload.stats || {};
    const hasCosmetics = cosmetics.some(item => item?.type && String(item.value || '').trim());
    const hasStats = parseDenickLookupCount(stats.finals) !== null || parseDenickLookupCount(stats.beds) !== null;
    if (!hasCosmetics && !hasStats) throw new Error('Add at least one cosmetic filter or finals/beds count.');

    const errors = [];
    let cosmeticResult = null;
    let statResult = null;

    if (hasCosmetics) {
        try {
            cosmeticResult = await searchDenickCosmetics(cosmetics, payload.limit);
        } catch (e) {
            errors.push(e.message || 'Cosmetic lookup failed.');
        }
    }
    if (hasStats) {
        try {
            statResult = await searchDenickStats(settings, stats);
        } catch (e) {
            errors.push(e.message || 'Stat lookup failed.');
        }
    }
    if (!cosmeticResult && !statResult && errors.length) throw new Error(errors.join(' | '));

    let candidates = [];
    if (cosmeticResult && statResult) {
        const statsByKey = new Map(statResult.candidates.map(candidate => [denickLookupCandidateKey(candidate), candidate]));
        candidates = cosmeticResult.candidates
            .filter(candidate => statsByKey.has(denickLookupCandidateKey(candidate)))
            .map(candidate => ({
                ...candidate,
                source: 'combined',
                matchedStats: statsByKey.get(denickLookupCandidateKey(candidate))?.matchedStats || {}
            }));
    } else {
        candidates = (cosmeticResult?.candidates || statResult?.candidates || []).slice();
    }

    const shown = candidates.slice(0, Math.max(1, Math.min(Number(payload.limit) || 100, LAUNCHER_DENICK_MAX_RESULTS)));
    await enrichDenickLookupPlayers(shown, settings);

    return {
        ok: true,
        errors,
        labels: [
            ...(cosmeticResult?.labels || []),
            ...(statResult?.labels || [])
        ],
        cache: cosmeticResult?.cache || null,
        totalMatches: cosmeticResult && !statResult ? cosmeticResult.totalMatches : candidates.length,
        candidates: shown
    };
}

function findAuthCacheFile(username, suffix) {
    const dir = path.join(AUTH_PATH, username);
    try {
        if (!fs.existsSync(dir)) return null;
        const files = fs.readdirSync(dir)
            .filter(file => file.endsWith(suffix))
            .map(file => path.join(dir, file))
            .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
        return files[0] || null;
    } catch (e) {
        return null;
    }
}

function decodeJwtPayload(token) {
    if (!token || typeof token !== 'string') return null;
    const payload = token.split('.')[1];
    if (!payload) return null;
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
    try {
        return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    } catch (e) {
        return null;
    }
}

function tokenTimeStatus(expiresAt) {
    if (!expiresAt) return { state: 'missing', label: 'missing', expiresAt: null, hoursLeft: null };
    const remaining = expiresAt - Date.now();
    const hoursLeft = Math.floor(remaining / 3600000);
    if (remaining <= 0) return { state: 'expired', label: 'expired', expiresAt, hoursLeft };
    if (remaining < 60 * 60 * 1000) return { state: 'soon', label: '<1h left', expiresAt, hoursLeft: 0 };
    return { state: 'valid', label: `${hoursLeft}h left`, expiresAt, hoursLeft };
}

function readMicrosoftTokenStatus(username) {
    const file = findAuthCacheFile(username, '_live-cache.json');
    const data = file ? readJsonFile(file) : null;
    const token = data?.token;
    const expiresAt = token?.obtainedOn && token?.expires_in
        ? Number(token.obtainedOn) + Number(token.expires_in) * 1000
        : null;
    return {
        exists: Boolean(token),
        ...tokenTimeStatus(expiresAt)
    };
}

function readMinecraftTokenStatus(username) {
    const file = findAuthCacheFile(username, '_mca-cache.json');
    const data = file ? readJsonFile(file) : null;
    const token = data?.mca;
    const payload = decodeJwtPayload(token?.access_token);
    const profile = Array.isArray(payload?.pfd) ? payload.pfd.find(entry => entry?.type === 'mc') : null;
    const profileId = payload?.profiles?.mc || profile?.id || '';
    const profileName = profile?.name || username;
    const expiresAt = token?.obtainedOn && token?.expires_in
        ? Number(token.obtainedOn) + Number(token.expires_in) * 1000
        : (payload?.exp ? Number(payload.exp) * 1000 : null);
    return {
        exists: Boolean(token),
        profileName,
        uuid: profileId,
        ...tokenTimeStatus(expiresAt)
    };
}

function readXboxTokenStatus(username) {
    const file = findAuthCacheFile(username, '_xbl-cache.json');
    const data = file ? readJsonFile(file) : null;
    const expiresAtText = data?.['30f115']?.expiresOn || data?.userToken?.NotAfter || null;
    const expiresAt = expiresAtText ? Date.parse(expiresAtText) : null;
    return {
        exists: Boolean(data),
        ...tokenTimeStatus(expiresAt)
    };
}

function authStatusKind(status) {
    if (status.state === 'valid') return 'good';
    if (status.state === 'soon') return 'warn';
    return 'bad';
}

function getAuthAccountStatus(username) {
    const minecraft = readMinecraftTokenStatus(username);
    const microsoft = readMicrosoftTokenStatus(username);
    const xbox = readXboxTokenStatus(username);
    const folderExists = fs.existsSync(path.join(AUTH_PATH, username));

    let state = 'missing';
    let label = 'Not logged in';
    if (minecraft.state === 'valid') {
        state = 'valid';
        label = 'Ready';
    } else if (minecraft.state === 'soon') {
        state = 'soon';
        label = 'Expires soon';
    } else if (minecraft.exists) {
        state = 'expired';
        label = 'Expired';
    } else if (microsoft.exists || xbox.exists) {
        state = 'partial';
        label = 'Needs Minecraft token';
    }

    const signInRequired = fs.existsSync(path.join(AUTH_PATH,username,'fury-signin-required.json'));
    if(signInRequired){state='expired';label='Sign-in required';}
    return {
        username,
        signInRequired,
        pinned: PINNED_AUTH_USERS.some(name => name.toLowerCase() === username.toLowerCase()),
        folderExists,
        state,
        label,
        kind: state === 'valid' ? 'good' : (state === 'soon' || state === 'partial' ? 'warn' : 'bad'),
        profileName: minecraft.profileName || username,
        uuid: minecraft.uuid || '',
        minecraft: { ...minecraft, kind: authStatusKind(minecraft) },
        microsoft: { ...microsoft, kind: authStatusKind(microsoft) },
        xbox: { ...xbox, kind: authStatusKind(xbox) }
    };
}

function getAuthAccounts() {
    return listAuthUsers().map(getAuthAccountStatus);
}

function pushMicrosoftCode(data) {
    const url = data?.verification_uri || 'https://www.microsoft.com/link';
    const code = data?.user_code || '';
    const directUrl = code ? `https://www.microsoft.com/link?otc=${encodeURIComponent(code)}` : url;
    pushLog('proxy', '[Microsoft Login] Sign-in required.');
    pushLog('proxy', `[Microsoft Login] Open: ${url}`);
    pushLog('proxy', '[Microsoft Login] Finish the browser sign-in, then come back here.');
    if (win && !win.isDestroyed()) {
        win.webContents.send('auth:microsoft-code', {
            url,
            directUrl,
            code,
            message: data?.message || '',
            expiresIn: data?.expires_in || null
        });
        scheduleLogUpdate('proxy');
    }
    shell.openExternal(directUrl).catch(() => {});
}

function copyAuthCacheAlias(fromUser, toUser) {
    if (!fromUser || !toUser || fromUser.toLowerCase() === toUser.toLowerCase()) return;
    const fromDir = path.join(AUTH_PATH, fromUser);
    const toDir = path.join(AUTH_PATH, toUser);
    try {
        if (fs.existsSync(fromDir)) {
            fs.cpSync(fromDir, toDir, { recursive: true, force: true });
        }
    } catch (e) {
        pushLog('proxy', `[Launcher] Could not copy auth cache to ${toUser}: ${e.message}`);
    }
}

function backupAuthCache(username) {
    const sourceDir = path.join(AUTH_PATH, username);
    if (!fs.existsSync(sourceDir)) return null;
    const backupDir = dataPath('launcher_data', `auth_backup_${username}_${Date.now()}`);
    try {
        fs.mkdirSync(path.dirname(backupDir), { recursive: true });
        fs.cpSync(sourceDir, backupDir, { recursive: true, force: true });
        return backupDir;
    } catch (e) {
        pushLog('proxy', `[Launcher] Could not back up auth cache: ${e.message}`);
        return null;
    }
}

function restoreAuthCache(username, backupDir) {
    if (!backupDir || !fs.existsSync(backupDir)) return false;
    const targetDir = path.join(AUTH_PATH, username);
    try {
        fs.rmSync(targetDir, { recursive: true, force: true });
        fs.cpSync(backupDir, targetDir, { recursive: true, force: true });
        return true;
    } catch (e) {
        pushLog('proxy', `[Launcher] Could not restore auth cache: ${e.message}`);
        return false;
    }
}

function removeBackupAuthCache(backupDir) {
    if (!backupDir) return;
    try {
        fs.rmSync(backupDir, { recursive: true, force: true });
    } catch (e) {}
}

function isMinecraftAuthServiceUnavailable(error) {
    const text = String(error?.message || error || '').toLowerCase();
    return text.includes('503')
        || text.includes('service unavailable')
        || text.includes('/authentication/login_with_xbox');
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getMinecraftJavaTokenWithRetry(auth, attempts = 4) {
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            if (attempt > 1) pushLog('proxy', `[Launcher] Retrying Minecraft auth (${attempt}/${attempts})...`);
            return await auth.getMinecraftJavaToken({ fetchProfile: true, fetchCertificates: false });
        } catch (e) {
            lastError = e;
            if (!isMinecraftAuthServiceUnavailable(e) || attempt === attempts) break;
            await wait(Math.min(3000 * attempt, 10000));
        }
    }
    throw lastError;
}

let microsoftLogin = null;
function clearLoginStage(directory) {
    const parent = path.resolve(dataPath('launcher_data', 'auth-staging'));
    const target = path.resolve(directory);
    const relative = path.relative(parent, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid sign-in staging directory.');
    fs.rmSync(target, { recursive: true, force: true });
}

async function refreshMicrosoftLogin(username) {
    const cleanUsername = String(username || '').trim() || 'FuryLogin';
    if (!/^[A-Za-z0-9_]{3,16}$/.test(cleanUsername)) throw new Error('Enter your Minecraft username first.');
    if (microsoftLogin) throw new Error('A Microsoft sign-in is already in progress. Finish or cancel it first.');
    const parent = dataPath('launcher_data', 'auth-staging');
    fs.mkdirSync(parent, { recursive: true });
    const directory = fs.mkdtempSync(path.join(parent, 'login-'));
    const worker = fork(path.join(__dirname, 'src', 'launcher', 'launcher_auth_worker.js'), [], {
        execPath: process.execPath, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc']
    });
    let finishOperation;
    const operation = { worker, directory, cancelled: false, done: new Promise(resolve => { finishOperation = resolve; }) };
    microsoftLogin = operation;
    pushLog('proxy', `[Launcher] Signing in ${cleanUsername} with Microsoft.`);
    try {
        const profile = await new Promise((resolve, reject) => {
            let completed = false;
            worker.on('message', message => {
                if (operation.cancelled) return;
                if (message.type === 'code') pushMicrosoftCode(message.data);
                if (message.type === 'success') { completed = true; resolve(message.profile); }
                if (message.type === 'error') { completed = true; reject(new Error(message.error)); }
            });
            worker.on('error', reject);
            worker.on('exit', () => { if (!completed) reject(new Error(operation.cancelled ? 'Microsoft sign-in cancelled.' : 'The sign-in window closed. Try again.')); });
            worker.send({ username: cleanUsername, cachePath: directory });
        });
        if (operation.cancelled) throw new Error('Microsoft sign-in cancelled.');
        const identity = normalizeAccount({ uuid: profile.id, name: profile.name });
        if (!identity?.uuid || !isMinecraftUsername(profile.name)) throw new Error('Microsoft returned an invalid Minecraft profile.');
        promoteAuthCache(directory, AUTH_PATH, cleanUsername, identity.name);
        removedAccounts.restore(identity);
        const catalog = getLauncherAccounts();
        const account = catalog.find(item => item.uuid === identity.uuid);
        if (account) viewedAccounts.select(account.key, catalog);
        pushLog('proxy', `[Launcher] ${identity.name} signed in successfully.`);
        return { ok: true, username: identity.name, account, stoppedProxy: false };
    } finally {
        if (worker.exitCode === null && worker.signalCode === null) {
            await new Promise(resolve => { worker.once('exit', resolve); worker.kill(); });
        }
        try { clearLoginStage(directory); } catch (error) { operation.cleanupFailed = true; throw error; } finally {
            if (microsoftLogin === operation) microsoftLogin = null;
            finishOperation();
        }
    }
}

function checkPort(port) {
    return new Promise((resolve) => {
        const socket = net.createConnection({ host: '127.0.0.1', port, timeout: 700 }, () => {
            socket.destroy();
            resolve(true);
        });
        socket.on('error', () => resolve(false));
        socket.on('timeout', () => {
            socket.destroy();
            resolve(false);
        });
    });
}

async function getProxyHealth(settings, { overlayVisible = false, includeSessions = false, account = null } = {}) {
    const owner = services.proxy.child;
    try {
        const query = new URLSearchParams();
        if (overlayVisible) query.set('overlayVisible', '1');
        // Keyed like the proxy scopes it, so sign-in state changes do not count.
        const sessionScope = includeSessions ? JSON.stringify(normalizeAccount(account)) : null;
        const sessionBase = sessionScope ? proxySessionHistory.base(sessionScope) : null;
        if (includeSessions) {
            query.set('includeSessions', '1');
            query.set('sessionAccount', JSON.stringify(account || {}));
            // Lets the proxy answer "unchanged" instead of rebuilding the history.
            if (sessionBase) query.set('sessionRevision', sessionBase.revision);
        }
        const suffix = query.size ? `?${query.toString()}` : '';
        const res = await axios.get(`http://127.0.0.1:${settings.server.healthPort}/health${suffix}`, { timeout: 800 });
        // F7 owns child identity. A health response from a replaced/exited child
        // must not publish into the current receiver, even without a newer UI
        // request ticket. Standalone-proxy polling retains its existing path.
        if (services.proxy.child !== owner || (owner && (owner.exitCode !== null || owner.signalCode !== null))) return null;
        const health = res.data;
        if (sessionScope && health && typeof health === 'object') {
            health.sessionHistory = proxySessionHistory.accept(sessionScope, sessionBase, health);
            delete health.sessionHistoryRevision;
            delete health.sessionHistoryUnchanged;
        }
        return health;
    } catch (e) {
        return null;
    }
}

function describeSecretChange(before, after) {
    if (!before && after) return { from: 'not set', to: 'set' };
    if (before && !after) return { from: 'set', to: 'cleared' };
    if (before !== after) return { from: 'set', to: 'changed' };
    return null;
}

function settingChanges(before, after) {
    const changes = [];
    const add = (label, from, to) => {
        if (String(from) !== String(to)) changes.push({ label, from: String(from), to: String(to) });
    };
    const addList = (label, from, to) => {
        const fromText = Array.isArray(from) && from.length ? from.join(', ') : 'none';
        const toText = Array.isArray(to) && to.length ? to.join(', ') : 'none';
        add(label, fromText, toText);
    };
    const addSecret = (label, from, to) => {
        const change = describeSecretChange(from, to);
        if (change) changes.push({ label, from: change.from, to: change.to });
    };

    addSecret('Hypixel API key', before.keys.hypixel, after.keys.hypixel);
    addSecret('Urchin API key', before.keys.urchin, after.keys.urchin);
    addSecret('Urchin admin API key', before.keys.urchinadmin, after.keys.urchinadmin);
    addSecret('Aurora API key', before.keys.aurora, after.keys.aurora);
    addSecret('Seraph API key', before.keys.seraph, after.keys.seraph);
    add('Scan mode', before.scan.scanMode, after.scan.scanMode);
    add('Minimum FKDR', before.scan.minFkdr, after.scan.minFkdr);
    add('Minimum stars', before.scan.minStars, after.scan.minStars);
    add('Minimum SkyWars KDR', before.scan.minSkywarsKdr, after.scan.minSkywarsKdr);
    add('Minimum SkyWars WLR', before.scan.minSkywarsWlr, after.scan.minSkywarsWlr);
    add('Minimum SkyWars level', before.scan.minSkywarsLevel, after.scan.minSkywarsLevel);
    add(
        'In-game chat prefix accent',
        before.features?.chatPrefixAccentHex || '#e5b35d',
        after.features?.chatPrefixAccentHex || '#e5b35d'
    );
    add('Ender Dust reminder threshold', before.features?.enderDustReminderThreshold, after.features?.enderDustReminderThreshold);
    addList('Chat triggers', before.chatTriggers?.triggers || [], after.chatTriggers?.triggers || []);
    [
        ['Tab stats', 'tabStatsEnabled'],
        ['Auto share tags to party', 'shareTagsAuto'],
        ['Fancy share lines', 'shareTagsFancy'],
        ['Recolor own share lines', 'shareTagsColorLocal'],
        ['Live share keeps team order', 'shareTagsGroupByTeam'],
        ['Share tagged players', 'shareTagsIncludeTagged'],
        ['Share nicked players', 'shareTagsIncludeNicks'],
        ['Share stat threats', 'shareTagsIncludeThreats'],
        ['Auto gambler', 'autoGamblerEnabled'],
        ['Auto dodge', 'autoDodgeEnabled'],
        ['Dodge tagged players', 'autoDodgeTaggedPlayers'],
        ['Dodge nicked players', 'autoDodgeNickedPlayers'],
        ['Dodge stat threats', 'autoDodgeStatThreats'],
        ['Ender Dust reminder', 'enderDustReminderEnabled'],
        ['Slumber NPC daily rewards reminder', 'slumberDailyRewardsReminderEnabled'],
        ['Gambler George reminder', 'gamblerGeorgeReminderEnabled'],
        ['Auto skin denick', 'autoSkinDenickEnabled'],
        ['Auto stats denick', 'autoStatsDenickEnabled'],
        ['Denick chat announcements', 'denickChatAnnouncementsEnabled'],
        ['Use Overlay', 'socialOverlayAddsEnabled'],
        ['Lobby message stats', 'lobbyChatStatsEnabled'],
        ['Lobby stats mentions', 'lobbyChatStatsMentionEnabled'],
        ['Lobby stats DMs', 'lobbyChatStatsDmEnabled'],
        ['Lobby stats triggers', 'lobbyChatStatsTriggerEnabled'],
        ['BedWars chat event labels', 'accentBedwarsEventLabelsEnabled'],
        ['BedWars scoreboard team colors', 'bedwarsSidebarTeamColorsEnabled'],
        ['Pregame chat stats', 'pregameChatStatsEnabled'],
        ['Queue time messages', 'queueTimeEnabled'],
        ['Queue time to party chat', 'queueTimePartyChatEnabled'],
        ['Party split warnings', 'partySplitWarningsEnabled'],
        ['Show denicked real IGN', 'showDenickedRealIgn'],
        ['Replace known nicks in game', 'denickRealIgnNametags'],
        ['Custom names for friends', 'friendAliasNametags'],
        ['Replace known nick skins in game', 'denickRealSkin'],
        ['Replace known nicks in chat', 'denickRealIgnChat'],
        ['Session tracking', 'sessionTrackingEnabled'],
        ['Post-game session recap', 'gameRecapEnabled'],
        ['Expanded replay details', 'replayDetailsEnabled'],
        ['Show tags in tabstats', 'showTagsInTabStats'],
        ['Name tags above heads', 'nametagOverlayEnabled'],
        ['Dark gray BedWars star brackets', 'nametagStarBracketsEnabled'],
        ['Name tags for teammates', 'nametagTeammatesEnabled'],
        ['Name tags for threats', 'nametagThreatsEnabled'],
        ['Name tags for everyone else', 'nametagOthersEnabled'],
        ['API kill switch', 'apiKillSwitchEnabled'],
        ['Proxy health warnings', 'proxyHealthWarningsEnabled']
    ].forEach(([label, key]) => {
        add(label, before.features?.[key] ? 'on' : 'off', after.features?.[key] ? 'on' : 'off');
    });
    addList('BedWars tab fields', before.features?.tabStatsBedwarsFields || [], after.features?.tabStatsBedwarsFields || []);
    addList('SkyWars tab fields', before.features?.tabStatsSkywarsFields || [], after.features?.tabStatsSkywarsFields || []);
    add('Tab stat label style', before.features?.tabStatsLabelStyle || 'compact', after.features?.tabStatsLabelStyle || 'compact');
    add('Nametag tag style', before.features?.nametagTagDisplayMode || 'acronyms', after.features?.nametagTagDisplayMode || 'acronyms');
    [
        ['Teammate prefix', 'nametagTeammatesPrefix'],
        ['Teammate prefix fallback', 'nametagTeammatesPrefixFallback'],
        ['Teammate suffix', 'nametagTeammatesSuffix'],
        ['Teammate suffix fallback', 'nametagTeammatesSuffixFallback'],
        ['Threat prefix', 'nametagThreatsPrefix'],
        ['Threat prefix fallback', 'nametagThreatsPrefixFallback'],
        ['Threat suffix', 'nametagThreatsSuffix'],
        ['Threat suffix fallback', 'nametagThreatsSuffixFallback'],
        ['Other prefix', 'nametagOthersPrefix'],
        ['Other prefix fallback', 'nametagOthersPrefixFallback'],
        ['Other suffix', 'nametagOthersSuffix'],
        ['Other suffix fallback', 'nametagOthersSuffixFallback']
    ].forEach(([label, key]) => add(label, before.features?.[key] || 'none', after.features?.[key] || 'none'));
    add('Session inactivity boundary', before.features?.sessionBoundaryMinutes ?? 180, after.features?.sessionBoundaryMinutes ?? 180);
    add('Session history retention', before.features?.sessionRetention ?? 100, after.features?.sessionRetention ?? 100);
    add('Session recap style', before.features?.sessionRecapStyle || 'detailed', after.features?.sessionRecapStyle || 'detailed');
    addList('Session recap fields', before.features?.sessionRecapFields || [], after.features?.sessionRecapFields || []);
    addList('BedWars session fields', before.features?.sessionBedwarsFields || [], after.features?.sessionBedwarsFields || []);
    addList('SkyWars session fields', before.features?.sessionSkywarsFields || [], after.features?.sessionSkywarsFields || []);
    addList('Duels session fields', before.features?.sessionDuelsFields || [], after.features?.sessionDuelsFields || []);
    add('Session wins goal', before.features?.sessionGoalWins ?? 0, after.features?.sessionGoalWins ?? 0);
    add('Session final kills goal', before.features?.sessionGoalFinals ?? 0, after.features?.sessionGoalFinals ?? 0);
    add('Session games goal', before.features?.sessionGoalGames ?? 0, after.features?.sessionGoalGames ?? 0);
    add('Session minutes goal', before.features?.sessionGoalMinutes ?? 0, after.features?.sessionGoalMinutes ?? 0);
    add(
        'Auto dodge delay',
        before.features?.autoDodgeDelaySeconds ?? 10,
        after.features?.autoDodgeDelaySeconds ?? 10
    );
    add(
        'Dodge threat FKDR',
        before.features?.autoDodgeMinFkdr ?? 3,
        after.features?.autoDodgeMinFkdr ?? 3
    );
    add(
        'Dodge threat stars',
        before.features?.autoDodgeMinStars ?? 1000,
        after.features?.autoDodgeMinStars ?? 1000
    );
    add(
        'Dodge include preset',
        before.features?.autoDodgeIncludePreset || 'custom',
        after.features?.autoDodgeIncludePreset || 'custom'
    );
    add('Direct proxy port (restart proxy)', before.server.proxyDirectPort, after.server.proxyDirectPort);
    add('Failover proxy port (restart proxy)', before.server.proxyFailoverPort, after.server.proxyFailoverPort);
    add('Health port (restart proxy)', before.server.healthPort, after.server.healthPort);
    add('Direct host (restart proxy)', before.server.proxyDirectHost, after.server.proxyDirectHost);
    add('Failover host (restart proxy)', before.server.proxyFailoverHost, after.server.proxyFailoverHost);

    return changes;
}

async function notifyProxySettingsChanged(settings, changes, profile = null) {
    invalidateHistory();
    const changeList = Array.isArray(changes) ? changes : [];
    const endpoint = `http://127.0.0.1:${settings.server.healthPort}/settings-changed`;
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 120));
        try {
            const response = await axios.post(endpoint, {
                changes: changeList,
                profile,
                silent: changeList.length === 0 && !profile
            }, { timeout: attempt === 0 ? 800 : 1200 });
            if (response?.data?.ok) return response.data;
            lastError = new Error('Proxy did not acknowledge the settings update.');
        } catch (error) {
            lastError = error;
        }
    }
    pushLog('proxy', `[Launcher] Settings saved; live acknowledgement failed${lastError?.message ? `: ${lastError.message}` : '.'}`);
    return { ok: false, persisted: true };
}

async function getApiStatus(settings) {
    if (apiStatusCache.data && Date.now() - apiStatusCache.at < 30000) return apiStatusCache.data;

    const primaryHypixelKey = String(settings.keys.hypixel || '').trim();
    const status = {
        mojang: { label: 'Mojang', state: 'checking', detail: 'Minecraft profiles' },
        hypixel: primaryHypixelKey
            ? { label: 'Hypixel', state: 'checking', detail: 'Validating API key' }
            : { label: 'Hypixel', state: 'missing key', detail: 'Add a key in Settings' },
        urchin: settings.keys.urchin
            ? { label: 'Urchin', state: 'configured', detail: 'Key configured' }
            : { label: 'Urchin', state: 'missing key', detail: 'Add a key in Settings' },
        urchinadmin: settings.keys.urchinadmin
            ? { label: 'Urchin Admin', state: 'configured', detail: 'Tag-management key configured' }
            : { label: 'Urchin Admin', state: 'optional', detail: 'Needed only to add or remove tags' },
        aurora: settings.keys.aurora
            ? { label: 'Aurora', state: 'configured', detail: 'Key configured' }
            : { label: 'Aurora', state: 'missing key', detail: 'Add a key in Settings' },
        seraph: settings.keys.seraph
            ? { label: 'Seraph', state: 'configured', detail: 'Key configured' }
            : { label: 'Seraph', state: 'missing key', detail: 'Add a key in Settings' }
    };

    const validateHypixelEntry = async (field, key, acceptedDetail) => {
        try {
            const response = await axios.get('https://api.hypixel.net/v2/player', {
                headers: { 'API-Key': key },
                timeout: 3500,
                validateStatus: () => true
            });
            if (response.status === 200 || response.status === 400 || response.status === 422) {
                status[field].state = 'available';
                status[field].detail = acceptedDetail;
            } else if (response.status === 403) {
                status[field].state = 'invalid key';
                status[field].detail = 'Replace this key in Settings';
            } else if (response.status === 429) {
                status[field].state = 'rate limited';
                status[field].detail = 'Key accepted; retry after reset';
            } else {
                status[field].state = 'unavailable';
                status[field].detail = `Hypixel returned HTTP ${response.status}`;
            }
        } catch (e) {
            status[field].state = 'unreachable';
            status[field].detail = e?.code === 'ECONNABORTED' ? 'Validation timed out' : 'Could not reach Hypixel';
        }
    };

    try {
        await axios.get('https://api.mojang.com/users/profiles/minecraft/Notch', { timeout: 2500 });
        status.mojang.state = 'available';
        status.mojang.detail = 'Profile service reachable';
    } catch (e) {
        status.mojang.state = 'unreachable';
        status.mojang.detail = 'Could not reach Mojang';
    }

    if (primaryHypixelKey) {
        await validateHypixelEntry('hypixel', primaryHypixelKey, 'API key accepted');
    }

    apiStatusCache = { at: Date.now(), data: status };
    return status;
}

async function launcherState(event, options = {}) {
    const compact = options?.historyContract === HISTORY_VERSION && Boolean(event?.sender);
    const ticket = compact ? historyResponses.begin(event.sender.id) : null;
    const activePage = String(options?.activePage || 'dashboard').toLowerCase();
    const includeDenicks = activePage === 'denicks';
    const includeSessions = activePage === 'sessions' || activePage === 'dashboard';
    const accountCatalog = getLauncherAccounts();
    const viewedAccount = viewedAccounts.resolve(accountCatalog, reminderAccounts.selected());
    const settings = loadAllSettings();
    const senderWin = event?.sender ? BrowserWindow.fromWebContents(event.sender) : null;
    const overlayVisible = activePage === 'overlay'
        && Boolean(senderWin && !senderWin.isDestroyed() && senderWin.isVisible() && !senderWin.isMinimized());
    const [proxyHealth, portStates, apiStatus] = await Promise.all([
        getProxyHealth(settings, { overlayVisible, includeSessions, account: viewedAccount }),
        Promise.all([
            checkPort(settings.server.proxyDirectPort),
            checkPort(settings.server.proxyFailoverPort),
            checkPort(settings.server.healthPort)
        ]),
        getApiStatus(settings)
    ]);
    const ports = {
        proxyDirect: portStates[0],
        proxyFailover: portStates[1],
        health: portStates[2]
    };

    const result = {
        settings,
        profiles: profileState(settings),
        services: {
            proxy: serviceState('proxy')
        },
        ports,
        proxyHealth,
        viewedAccount,
        accountCatalog,
        accountKey: viewedAccount?.key || null,
        reminders: rememberedReminders.getStatus(viewedAccount),
        authUsers: listAuthUsers(),
        authAccounts: getAuthAccounts(),
        denickHistory: includeDenicks ? getDenickHistory() : null,
        sessionHistory: includeSessions
            ? (proxyHealth?.sessionHistory || readPersistedSessionHistory(viewedAccount))
            : null,
        apiStatus
    };
    return compact ? historyResponses.respond(event.sender.id, ticket, result, options.historyContract) : result;
}

function createWindow() {
    win = new BrowserWindow({
        width: 1440,
        height: 900,
        frame: false,
        icon: process.platform === 'darwin' ? path.join(__dirname, 'assets', 'fury-icon.png') : APP_ICON_PATH,
        minWidth: 1024,
        minHeight: 680,
        title: 'Fury — Control Workspace',
        backgroundColor: '#101215',
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            // Chromium pauses animation/timer work while the launcher is
            // minimized or fully occluded, leaving more CPU/GPU time for the
            // game. Visible windows remain full-rate.
            backgroundThrottling: true
        }
    });

    win.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
        callback(permission === 'media');
    });

    win.loadFile(path.join(__dirname, 'launcher.html'));
    win.on('close', event => { if (!quitAllowed) { event.preventDefault(); void requestQuit('window-close'); } });
    win.on('query-session-end', event => { if (!quitAllowed) { event.preventDefault(); void requestQuit('system-shutdown'); } });
    win.on('closed', () => {
        win = null;
    });
}

function captureProfileSettings(settings = loadAllSettings()) {
    return filterPresetSettings({
        ...(settings?.features || {}),
        ...(settings?.scan || {}),
        chatTriggers: Array.isArray(settings?.chatTriggers?.triggers) ? settings.chatTriggers.triggers : []
    });
}

function profileState(settings = loadAllSettings()) {
    const current = captureProfileSettings(settings);
    const active = profileStore.getActive();
    return {
        active,
        lastApplied: profileStore.getLastApplied(),
        profiles: profileStore.listProfiles().map(profile => {
            const changes = profile.name === active ? (profileStore.diff(profile.name, current) || []) : [];
            const applyChanges = profileStore.diff(profile.name, current) || [];
            const missingSettingKeys = Array.isArray(profile.missingSettingKeys) ? profile.missingSettingKeys : [];
            return {
                name: profile.name,
                label: profile.label,
                description: profile.description,
                icon: profile.icon,
                tags: profile.tags,
                source: profile.source,
                readOnly: profile.readOnly,
                settingCount: Object.keys(profile.settings || {}).length,
                boundModes: profile.boundModes || [],
                active: profile.name === active,
                modified: changes.length > 0,
                changedSettings: changes.length,
                missingSettingKeys,
                missingSettings: missingSettingKeys.map(profileSettingLabel),
                preview: describeProfileSettings(profile.settings),
                applyChanges: applyChanges.map(change => ({
                    ...change,
                    label: profileSettingLabel(change.key)
                }))
            };
        })
    };
}

async function applyProfile(name, { source = 'launcher' } = {}) {
    const profile = profileStore.get(name);
    if (!profile) throw new Error('Profile not found.');

    const before = loadAllSettings();
    const desired = filterPresetSettings(profile.settings);
    const { features, scan, chatTriggers } = splitByNamespace(desired);
    try {
        // Profiles are complete snapshots of the safe, live-changeable
        // preference surface. Non-profile settings (keys, ports, auth) stay
        // intact because they are deliberately omitted here.
        saveFeatureSettings({ ...before.features, ...features });
        saveScanSettings({ ...before.scan, ...scan });
        if (Array.isArray(chatTriggers.chatTriggers)) {
            saveChatTriggerSettings({ triggers: chatTriggers.chatTriggers });
        }
    } catch (error) {
        throw new Error(`Could not save profile settings: ${error.message}`);
    }

    const saved = loadAllSettings();
    const changes = settingChanges(before, saved);
    profileStore.setActive(profile.name, { source });
    await notifyProxySettingsChanged(before, changes, { name: profile.name, label: profile.label });
    notifySettingsUpdated('profiles');
    return {
        ok: true,
        profile: profileState(saved).profiles.find(item => item.name === profile.name),
        changes,
        settings: saved
    };
}

function saveCurrentProfile(name, metadata = {}) {
    const existing = profileStore.list().find(profile => profile.name === String(name || '').trim().toLowerCase()) || null;
    const profile = profileStore.save(name, captureProfileSettings(), { label: metadata.label || existing?.label || null });
    if (!profile) throw new Error('Use a unique profile name, or free a custom-profile slot.');
    if (metadata.description !== undefined || metadata.icon !== undefined || metadata.tags !== undefined) {
        profileStore.updateMetadata(profile.name, metadata);
    }
    profileStore.setActive(profile.name, { source: 'launcher_save' });
    notifySettingsUpdated('profiles');
    return profileState();
}

function profileExportFilename(profile) {
    const safe = String(profile?.name || 'profile').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'profile';
    return `${safe}.${PROFILE_EXPORT_EXTENSION}`;
}

function shouldAutoStart(name) {
    const configured = String(process.env[`STATMOD_AUTO_START_${name.toUpperCase()}`] || '').toLowerCase();
    if (configured) return configured === '1' || configured === 'true';

    // The Windows installer launches Fury after setup. In a packaged build,
    // start the core proxy automatically so players can begin immediately.
    return app.isPackaged && name === 'proxy';
}

function removePersistedSession(sessionId, account) {
    const id = String(sessionId || '').trim();
    if (!id) return { ok: false, error: 'Invalid saved session.' };
    const settings = loadAllSettings();
    const retentionValue = Number(settings.features?.sessionRetention);
    const retention = retentionValue === 0 ? 0 : (retentionValue || DEFAULT_MAX_SESSIONS);
    const store = normalizeStore(readJsonFile(SESSION_DATA_FILE), retention, DEFAULT_MAX_GAMES_PER_SESSION);
    const index = store.sessions.findIndex(session => session.id === id);
    if (index < 0) return { ok: false, error: 'That saved session no longer exists.' };

    const session = store.sessions[index];
    if (!account || !sessionBelongsToAccount(session, account)) return { ok: false, error: 'That session belongs to another account.' };
    const boundaryMs = (Number(settings.features?.sessionBoundaryMinutes) || 180) * 60 * 1000;
    const stillActive = !session.endedAt && Date.now() - Number(session.lastSeen || session.startedAt || 0) < boundaryMs;
    if (stillActive) return { ok: false, error: 'End the active session before removing it.' };
    store.sessions.splice(index, 1);
    fs.writeFileSync(SESSION_DATA_FILE, JSON.stringify(store, null, 2), 'utf8');
    return { ok: true, sessionId: id };
}

async function runSessionAction(action) {
    const request = typeof action === 'string' ? { type: action } : (action || {});
    const account = selectedLauncherAccount();
    if (!account || (request.accountKey && request.accountKey !== account.key)) return { ok: false, error: 'The selected account changed. Try again.' };
    const clean = request.type === 'end' ? 'end' : (request.type === 'delete' ? 'delete' : 'start');
    const settings = loadAllSettings();
    if (clean === 'delete') {
        const sessionId = String(request.sessionId || '').trim();
        if (!sessionId) return { ok: false, error: 'Invalid saved session.' };
        try {
            const response = await axios.delete(
                `http://127.0.0.1:${settings.server.healthPort}/session/${encodeURIComponent(sessionId)}`,
                { timeout: 8000, data: { account } }
            );
            return response.data;
        } catch (error) {
            if (error?.response) {
                return { ok: false, error: error.response.data?.error || 'Could not remove the saved session.' };
            }
            return removePersistedSession(sessionId, account);
        }
    }
    try {
        const response = await axios.post(
            `http://127.0.0.1:${settings.server.healthPort}/session/${clean}`,
            { account },
            { timeout: 8000 }
        );
        return response.data;
    } catch (error) {
        return {
            ok: false,
            error: error?.response?.data?.error || (clean === 'start'
                ? 'Start the proxy and connect Minecraft before creating a session.'
                : 'No live proxy session could be ended.')
        };
    }
}

function validNetworkHost(value) {
    const host = String(value || '').trim();
    if (!host || host.length > 253 || /[\s/:]/.test(host)) return false;
    if (host === 'localhost' || net.isIP(host)) return true;
    return host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}

async function validateNetworkConfiguration(payload = {}) {
    const settings = loadAllSettings();
    const requested = {
        direct: Number(payload.proxyDirectPort),
        failover: Number(payload.proxyFailoverPort),
        health: Number(payload.healthPort)
    };
    const configured = {
        direct: Number(settings.server.proxyDirectPort),
        failover: Number(settings.server.proxyFailoverPort),
        health: Number(settings.server.healthPort)
    };
    const duplicatePorts = new Set(Object.values(requested).filter((port, index, all) => all.indexOf(port) !== index));
    const ports = {};
    await Promise.all(Object.entries(requested).map(async ([name, port]) => {
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            ports[name] = { state: 'invalid', detail: 'Use a port from 1 to 65535.' };
            return;
        }
        if (duplicatePorts.has(port)) {
            ports[name] = { state: 'duplicate', detail: 'Each Fury endpoint needs a different port.' };
            return;
        }
        const open = await checkPort(port);
        const ownedByFury = isRunning('proxy') && configured[name] === port;
        ports[name] = ownedByFury
            ? { state: 'active', detail: `Port ${port} is currently used by Fury.` }
            : open
                ? { state: 'conflict', detail: `Port ${port} is already in use.` }
                : { state: 'available', detail: `Port ${port} is available.` };
    }));
    const hosts = {
        direct: validNetworkHost(payload.proxyDirectHost)
            ? { state: 'valid', detail: 'Valid destination hostname.' }
            : { state: 'invalid', detail: 'Enter a hostname without a protocol or port.' },
        failover: validNetworkHost(payload.proxyFailoverHost)
            ? { state: 'valid', detail: 'Valid destination hostname.' }
            : { state: 'invalid', detail: 'Enter a hostname without a protocol or port.' }
    };
    const restartRequired = requested.direct !== configured.direct
        || requested.failover !== configured.failover
        || requested.health !== configured.health
        || String(payload.proxyDirectHost || '').trim() !== String(settings.server.proxyDirectHost || '').trim()
        || String(payload.proxyFailoverHost || '').trim() !== String(settings.server.proxyFailoverHost || '').trim();
    const valid = Object.values(ports).every(item => ['active', 'available'].includes(item.state))
        && Object.values(hosts).every(item => item.state === 'valid');
    return { ports, hosts, restartRequired, valid, proxyRunning: isRunning('proxy') };
}

async function testApiKey(provider, rawKey) {
    const key = String(rawKey || '').trim();
    const name = String(provider || '').trim();
    if (!key) return { ok: false, state: 'missing key', detail: 'Enter a key before testing.' };
    const request = async (url, config = {}) => axios.get(url, {
        timeout: 6000,
        validateStatus: () => true,
        ...config
    });
    try {
        let response;
        if (name === 'hypixel') {
            response = await request('https://api.hypixel.net/v2/player', { headers: { 'API-Key': key } });
            if ([200, 400, 422].includes(response.status)) return { ok: true, state: 'available', detail: 'Hypixel accepted this API key.' };
        } else if (name === 'urchin' || name === 'urchinadmin') {
            response = await request('https://api.urchin.gg/v3/player/tags', { params: { player: 'Notch' }, headers: { 'X-API-Key': key } });
            if (response.status >= 200 && response.status < 300) return { ok: true, state: 'available', detail: `Urchin accepted this${name === 'urchinadmin' ? ' admin' : ''} API key.` };
        } else if (name === 'aurora') {
            response = await request('https://bordic.xyz/api/v2/resources/lookup/finals', { params: { value: 0, range: 1, max: 1, key } });
            if (response.status >= 200 && response.status < 300 && response.data?.success !== false) return { ok: true, state: 'available', detail: 'Aurora accepted this API key.' };
        } else if (name === 'seraph') {
            response = await request(`https://api.seraph.si/069a79f444e94726a5befca90e38aaf5/blacklist?key=${encodeURIComponent(key)}`);
            if (response.status >= 200 && response.status < 300 && response.data?.success !== false) return { ok: true, state: 'available', detail: 'Seraph accepted this API key.' };
        } else {
            return { ok: false, state: 'unsupported', detail: 'This legacy provider does not require a connection test.' };
        }
        if (response?.status === 429) return { ok: true, state: 'rate limited', detail: 'The key was accepted, but the provider is rate limited.' };
        if ([401, 403].includes(response?.status)) return { ok: false, state: 'invalid key', detail: 'The provider rejected this API key.' };
        return { ok: false, state: 'unavailable', detail: `Provider returned HTTP ${response?.status || 'unknown'}.` };
    } catch (error) {
        return {
            ok: false,
            state: 'unreachable',
            detail: error?.code === 'ECONNABORTED' ? 'Connection test timed out.' : 'Could not reach the provider.'
        };
    }
}

async function autoStartRequestedServices() {
    for (const name of ['proxy']) {
        if (!shouldAutoStart(name)) continue;
        try {
            await startService(name);
        } catch (e) {
            pushLog(name, `[Launcher] Auto-start failed: ${e.message}`);
        }
    }
}

handleLauncherRequest('state:get', launcherState);
handleLauncherRequest('history:detail', (event, request) => historyResponses.detail(event.sender.id, request));
handleLauncherRequest('account:skin', (event, uuid) => accountSkins.get(uuid));
handleLauncherRequest('profiles:apply', async (event, name) => applyProfile(name, { source: 'launcher' }));
handleLauncherRequest('profiles:save-current', (event, payload = {}) => {
    const profiles = saveCurrentProfile(payload.name, payload);
    return { ok: true, profiles };
});
handleLauncherRequest('profiles:duplicate', (event, payload = {}) => {
    const copy = profileStore.duplicate(payload.source, payload.name, payload);
    if (!copy) throw new Error('Could not duplicate this profile. Choose a unique name.');
    notifySettingsUpdated('profiles');
    return { ok: true, profiles: profileState() };
});
handleLauncherRequest('profiles:update', (event, payload = {}) => {
    const profile = profileStore.updateMetadata(payload.name, payload);
    if (!profile) throw new Error('Built-in profiles cannot be edited. Duplicate one first.');
    notifySettingsUpdated('profiles');
    return { ok: true, profiles: profileState() };
});
handleLauncherRequest('profiles:delete', (event, name) => {
    if (!profileStore.remove(name)) throw new Error('Profile not found or already deleted.');
    notifySettingsUpdated('profiles');
    return { ok: true, profiles: profileState() };
});
handleLauncherRequest('profiles:export', async (event, name) => {
    const profile = profileStore.get(name);
    const payload = profileStore.exportProfile(name);
    if (!profile || !payload) throw new Error('Profile not found.');
    const owner = event?.sender ? BrowserWindow.fromWebContents(event.sender) : win;
    const result = await dialog.showSaveDialog(owner || undefined, {
        title: 'Export Fury profile',
        defaultPath: profileExportFilename(profile),
        filters: [{ name: 'Fury profile', extensions: [PROFILE_EXPORT_EXTENSION] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    writeProfileJson(result.filePath, payload);
    return { ok: true, filePath: result.filePath };
});
handleLauncherRequest('profiles:import', async (event) => {
    const owner = event?.sender ? BrowserWindow.fromWebContents(event.sender) : win;
    const result = await dialog.showOpenDialog(owner || undefined, {
        title: 'Import Fury profile',
        properties: ['openFile'],
        filters: [{ name: 'Fury profile', extensions: [PROFILE_EXPORT_EXTENSION, 'json'] }]
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    const file = result.filePaths[0];
    const stat = fs.statSync(file);
    if (stat.size > MAX_PROFILE_IMPORT_BYTES) throw new Error('That profile file is too large.');
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        throw new Error('This is not a valid Fury profile file.');
    }
    if (parsed?.format && parsed.format !== 'fury-profile') {
        throw new Error('This file is not a Fury profile export.');
    }
    let imported = profileStore.importProfile(parsed);
    if (imported.conflict) {
        const choice = await dialog.showMessageBox(owner || undefined, {
            type: 'question',
            title: 'Profile already exists',
            message: `A custom profile named “${imported.profile.label}” already exists.`,
            detail: 'Replace it, add the import as a copy, or cancel.',
            buttons: ['Replace', 'Add copy', 'Cancel'],
            defaultId: 1,
            cancelId: 2
        });
        if (choice.response === 2) return { ok: false, canceled: true };
        if (choice.response === 0) imported = profileStore.importProfile(parsed, { overwrite: true });
        else {
            const base = String(parsed?.profile?.name || parsed?.name || 'imported-profile');
            let suffix = 1;
            let candidate = `${base}-imported`;
            while (profileStore.get(candidate)) candidate = `${base}-imported-${++suffix}`;
            imported = profileStore.importProfile(parsed, { name: candidate });
        }
    }
    if (!imported.ok) throw new Error(imported.error || 'Could not import profile.');
    notifySettingsUpdated('profiles');
    return { ok: true, profile: imported.profile, profiles: profileState() };
});
handleLauncherRequest('session:action', (event, action) => historyMutation(() => runSessionAction(action)));
handleLauncherRequest('denick:add-manual', (event, entry = {}) => {
    return addManualDenickMapping(entry.nick, entry.realIGN, 'launcher');
});
handleLauncherRequest('denick:remove', (event, entry = {}) => {
    return runDenickRemoveAction(entry);
});
handleLauncherRequest('denick:catalog', () => {
    return denickLookupCatalog();
});
handleLauncherRequest('denick:lookup', (event, payload = {}) => {
    return runDenickLookup(payload);
});
// Patch only the committed fields; another page may contain unfinished edits.
handleLauncherRequest('settings:save-patch', async (event, patch) => {
    const before = loadAllSettings();
    const merged = {};
    for (const group of ['keys', 'scan', 'server']) {
        if (!patch?.[group]) continue;
        merged[group] = { ...before[group] };
        for (const [key, value] of Object.entries(patch[group])) {
            if (!Object.hasOwn(before[group], key)) throw new Error('Unknown setting');
            merged[group][key] = value;
        }
    }
    if (merged.scan) for (const key of ['minFkdr','minStars','minSkywarsKdr','minSkywarsWlr','minSkywarsLevel']) {
        if (!Number.isFinite(merged.scan[key]) || merged.scan[key] < 0) throw new Error('Enter a valid threshold');
    }
    if (merged.server) {
        const ports = ['proxyDirectPort','proxyFailoverPort','healthPort'].map(key => merged.server[key]);
        if (ports.some(port => !Number.isInteger(port) || port < 1 || port > 65535) || new Set(ports).size !== ports.length)
            throw new Error('Use different ports between 1 and 65535');
        if (!validNetworkHost(merged.server.proxyDirectHost) || !validNetworkHost(merged.server.proxyFailoverHost))
            throw new Error('Enter a valid server hostname');
    }
    const saved = saveAllSettings(merged);
    apiStatusCache = { at: 0, data: null };
    await notifyProxySettingsChanged(before, settingChanges(before, saved));
    return saved;
});
handleLauncherRequest('service:restart', async (event, name) => {
    if (name !== 'proxy') throw new Error('Unknown service');
    const result = await stopService('proxy', { reason: 'restart' });
    if (!result.clean || !result.exited) throw new Error('Proxy shutdown was not clean. Check its log before restarting.');
    return startService('proxy');
});
handleLauncherRequest('settings:save', async (event, settings) => {
    const before = loadAllSettings();
    apiStatusCache = { at: 0, data: null };
    const saved = saveAllSettings(settings);
    await notifyProxySettingsChanged(before, settingChanges(before, saved));
    return saved;
});
handleLauncherRequest('settings:save-chat-prefix-accent', async (event, accentHex) => {
    const before = loadAllSettings();
    saveFeatureSettings({
        ...before.features,
        chatPrefixAccentHex: accentHex
    });
    const saved = loadAllSettings();
    await notifyProxySettingsChanged(before, settingChanges(before, saved));
    return saved.features.chatPrefixAccentHex;
});
handleLauncherRequest('settings:save-features', async (event, settings) => {
    const before = loadAllSettings();
    const scan = {
        ...before.scan,
        scanMode: settings?.scan?.scanMode ?? before.scan.scanMode,
        countTags: true
    };
    const features = {
        ...before.features,
        tabStatsEnabled: settings?.features?.tabStatsEnabled ?? before.features?.tabStatsEnabled,
        autoScanOnGameStart: true,
        shareTagsAuto: settings?.features?.shareTagsAuto ?? before.features?.shareTagsAuto,
        shareTagsFancy: settings?.features?.shareTagsFancy ?? before.features?.shareTagsFancy,
        shareTagsColorLocal: settings?.features?.shareTagsColorLocal ?? before.features?.shareTagsColorLocal,
        shareTagsGroupByTeam: settings?.features?.shareTagsGroupByTeam ?? before.features?.shareTagsGroupByTeam,
        shareTagsIncludeTagged: settings?.features?.shareTagsIncludeTagged ?? before.features?.shareTagsIncludeTagged,
        shareTagsIncludeNicks: settings?.features?.shareTagsIncludeNicks ?? before.features?.shareTagsIncludeNicks,
        shareTagsIncludeThreats: settings?.features?.shareTagsIncludeThreats ?? before.features?.shareTagsIncludeThreats,
        autoGamblerEnabled: settings?.features?.autoGamblerEnabled ?? before.features?.autoGamblerEnabled,
        autoDodgeEnabled: settings?.features?.autoDodgeEnabled ?? before.features?.autoDodgeEnabled,
        autoDodgeDelaySeconds: settings?.features?.autoDodgeDelaySeconds ?? before.features?.autoDodgeDelaySeconds,
        autoDodgeTaggedPlayers: settings?.features?.autoDodgeTaggedPlayers ?? before.features?.autoDodgeTaggedPlayers,
        autoDodgeNickedPlayers: settings?.features?.autoDodgeNickedPlayers ?? before.features?.autoDodgeNickedPlayers,
        autoDodgeStatThreats: settings?.features?.autoDodgeStatThreats ?? before.features?.autoDodgeStatThreats,
        autoDodgeIncludePreset: settings?.features?.autoDodgeIncludePreset ?? before.features?.autoDodgeIncludePreset,
        autoDodgeMinFkdr: settings?.features?.autoDodgeMinFkdr ?? before.features?.autoDodgeMinFkdr,
        autoDodgeMinStars: settings?.features?.autoDodgeMinStars ?? before.features?.autoDodgeMinStars,
        partyOverviewEnabled: true,
        enderDustReminderEnabled: settings?.features?.enderDustReminderEnabled ?? before.features?.enderDustReminderEnabled,
        enderDustReminderThreshold: settings?.features?.enderDustReminderThreshold ?? before.features?.enderDustReminderThreshold,
        slumberDailyRewardsReminderEnabled: settings?.features?.slumberDailyRewardsReminderEnabled ?? before.features?.slumberDailyRewardsReminderEnabled,
        gamblerGeorgeReminderEnabled: settings?.features?.gamblerGeorgeReminderEnabled ?? before.features?.gamblerGeorgeReminderEnabled,
        // Progress is owned by the live proxy. Never let a launcher form save
        // overwrite a win that arrived after its last health poll.
        gamblerGeorgeReminderState: before.features?.gamblerGeorgeReminderState,
        autoSkinDenickEnabled: settings?.features?.autoSkinDenickEnabled ?? before.features?.autoSkinDenickEnabled,
        autoStatsDenickEnabled: settings?.features?.autoStatsDenickEnabled ?? before.features?.autoStatsDenickEnabled,
        denickChatAnnouncementsEnabled: settings?.features?.denickChatAnnouncementsEnabled ?? before.features?.denickChatAnnouncementsEnabled,
        denickPartyAnnounceEnabled: settings?.features?.denickPartyAnnounceEnabled ?? before.features?.denickPartyAnnounceEnabled,
        socialOverlayAddsEnabled: settings?.features?.socialOverlayAddsEnabled ?? before.features?.socialOverlayAddsEnabled,
        lobbyChatStatsEnabled: settings?.features?.lobbyChatStatsEnabled ?? before.features?.lobbyChatStatsEnabled,
        lobbyChatStatsMentionEnabled: settings?.features?.lobbyChatStatsMentionEnabled ?? before.features?.lobbyChatStatsMentionEnabled,
        lobbyChatStatsDmEnabled: settings?.features?.lobbyChatStatsDmEnabled ?? before.features?.lobbyChatStatsDmEnabled,
        lobbyChatStatsTriggerEnabled: settings?.features?.lobbyChatStatsTriggerEnabled ?? before.features?.lobbyChatStatsTriggerEnabled,
        accentBedwarsEventLabelsEnabled: settings?.features?.accentBedwarsEventLabelsEnabled ?? before.features?.accentBedwarsEventLabelsEnabled,
        bedwarsSidebarTeamColorsEnabled: settings?.features?.bedwarsSidebarTeamColorsEnabled ?? before.features?.bedwarsSidebarTeamColorsEnabled,
        pregameChatStatsEnabled: settings?.features?.pregameChatStatsEnabled ?? before.features?.pregameChatStatsEnabled,
        queueTimeEnabled: settings?.features?.queueTimeEnabled ?? before.features?.queueTimeEnabled ?? true,
        queueTimePartyChatEnabled: settings?.features?.queueTimePartyChatEnabled ?? before.features?.queueTimePartyChatEnabled ?? false,
        partySplitWarningsEnabled: settings?.features?.partySplitWarningsEnabled ?? before.features?.partySplitWarningsEnabled ?? true,
        overlayAutoAddOutsideGamesOnly: true,
        overlayAutoClearOnGameStartEnd: true,
        showDenickedRealIgn: settings?.features?.showDenickedRealIgn ?? before.features?.showDenickedRealIgn,
        denickRealIgnNametags: settings?.features?.denickRealIgnNametags ?? before.features?.denickRealIgnNametags,
        friendAliasEnabled: settings?.features?.friendAliasEnabled ?? before.features?.friendAliasEnabled,
        friendAliasNametags: settings?.features?.friendAliasNametags ?? before.features?.friendAliasNametags,
        friendAliasChat: settings?.features?.friendAliasChat ?? before.features?.friendAliasChat,
        friendAliasTabStats: settings?.features?.friendAliasTabStats ?? before.features?.friendAliasTabStats,
        friendAliasShowRealIgn: settings?.features?.friendAliasShowRealIgn ?? before.features?.friendAliasShowRealIgn,
        denickRealSkin: settings?.features?.denickRealSkin ?? before.features?.denickRealSkin,
        denickRealIgnChat: settings?.features?.denickRealIgnChat ?? before.features?.denickRealIgnChat,
        sessionTrackingEnabled: settings?.features?.sessionTrackingEnabled ?? before.features?.sessionTrackingEnabled,
        gameRecapEnabled: settings?.features?.gameRecapEnabled ?? before.features?.gameRecapEnabled,
        replayDetailsEnabled: settings?.features?.replayDetailsEnabled ?? before.features?.replayDetailsEnabled,
        sessionBoundaryMinutes: settings?.features?.sessionBoundaryMinutes ?? before.features?.sessionBoundaryMinutes,
        sessionRetention: settings?.features?.sessionRetention ?? before.features?.sessionRetention,
        sessionRecapStyle: settings?.features?.sessionRecapStyle ?? before.features?.sessionRecapStyle,
        sessionRecapFields: settings?.features?.sessionRecapFields ?? before.features?.sessionRecapFields,
        sessionBedwarsFields: settings?.features?.sessionBedwarsFields ?? before.features?.sessionBedwarsFields,
        sessionSkywarsFields: settings?.features?.sessionSkywarsFields ?? before.features?.sessionSkywarsFields,
        sessionDuelsFields: settings?.features?.sessionDuelsFields ?? before.features?.sessionDuelsFields,
        sessionGoalWins: settings?.features?.sessionGoalWins ?? before.features?.sessionGoalWins,
        sessionGoalFinals: settings?.features?.sessionGoalFinals ?? before.features?.sessionGoalFinals,
        sessionGoalGames: settings?.features?.sessionGoalGames ?? before.features?.sessionGoalGames,
        sessionGoalMinutes: settings?.features?.sessionGoalMinutes ?? before.features?.sessionGoalMinutes,
        showTagsInTabStats: settings?.features?.showTagsInTabStats ?? before.features?.showTagsInTabStats,
        tabStatsBedwarsFields: settings?.features?.tabStatsBedwarsFields ?? before.features?.tabStatsBedwarsFields,
        tabStatsSkywarsFields: settings?.features?.tabStatsSkywarsFields ?? before.features?.tabStatsSkywarsFields,
        tabStatsLabelStyle: settings?.features?.tabStatsLabelStyle ?? before.features?.tabStatsLabelStyle,
        tabStatsShowKillRatio: settings?.features?.tabStatsShowKillRatio ?? before.features?.tabStatsShowKillRatio,
        tabStatsShowWinRatio: settings?.features?.tabStatsShowWinRatio ?? before.features?.tabStatsShowWinRatio,
        nametagOverlayEnabled: settings?.features?.nametagOverlayEnabled ?? before.features?.nametagOverlayEnabled,
        nametagStarBracketsEnabled: settings?.features?.nametagStarBracketsEnabled ?? before.features?.nametagStarBracketsEnabled,
        nametagTagDisplayMode: settings?.features?.nametagTagDisplayMode ?? before.features?.nametagTagDisplayMode,
        nametagTeammatesEnabled: settings?.features?.nametagTeammatesEnabled ?? before.features?.nametagTeammatesEnabled,
        nametagTeammatesPrefix: settings?.features?.nametagTeammatesPrefix ?? before.features?.nametagTeammatesPrefix,
        nametagTeammatesPrefixFallback: settings?.features?.nametagTeammatesPrefixFallback ?? before.features?.nametagTeammatesPrefixFallback,
        nametagTeammatesSuffix: settings?.features?.nametagTeammatesSuffix ?? before.features?.nametagTeammatesSuffix,
        nametagTeammatesSuffixFallback: settings?.features?.nametagTeammatesSuffixFallback ?? before.features?.nametagTeammatesSuffixFallback,
        nametagThreatsEnabled: settings?.features?.nametagThreatsEnabled ?? before.features?.nametagThreatsEnabled,
        nametagThreatsPrefix: settings?.features?.nametagThreatsPrefix ?? before.features?.nametagThreatsPrefix,
        nametagThreatsPrefixFallback: settings?.features?.nametagThreatsPrefixFallback ?? before.features?.nametagThreatsPrefixFallback,
        nametagThreatsSuffix: settings?.features?.nametagThreatsSuffix ?? before.features?.nametagThreatsSuffix,
        nametagThreatsSuffixFallback: settings?.features?.nametagThreatsSuffixFallback ?? before.features?.nametagThreatsSuffixFallback,
        nametagOthersEnabled: settings?.features?.nametagOthersEnabled ?? before.features?.nametagOthersEnabled,
        nametagOthersPrefix: settings?.features?.nametagOthersPrefix ?? before.features?.nametagOthersPrefix,
        nametagOthersPrefixFallback: settings?.features?.nametagOthersPrefixFallback ?? before.features?.nametagOthersPrefixFallback,
        nametagOthersSuffix: settings?.features?.nametagOthersSuffix ?? before.features?.nametagOthersSuffix,
        nametagOthersSuffixFallback: settings?.features?.nametagOthersSuffixFallback ?? before.features?.nametagOthersSuffixFallback,
        apiKillSwitchEnabled: settings?.features?.apiKillSwitchEnabled ?? before.features?.apiKillSwitchEnabled,
        proxyHealthWarningsEnabled: settings?.features?.proxyHealthWarningsEnabled ?? before.features?.proxyHealthWarningsEnabled
    };

    saveScanSettings(scan);
    saveFeatureSettings(features);

    const saved = loadAllSettings();
    await notifyProxySettingsChanged(before, settingChanges(before, saved));
    return saved;
});
handleLauncherRequest('settings:save-chat-triggers', async (event, triggers) => {
    const before = loadAllSettings();
    saveChatTriggerSettings({ triggers });
    const saved = loadAllSettings();
    await notifyProxySettingsChanged(before, settingChanges(before, saved));
    return saved.chatTriggers;
});
handleLauncherRequest('service:start', (event, name) => startService(name));
handleLauncherRequest('service:stop', (event, name) => stopService(name));
handleLauncherRequest('auth:microsoft-login', (event, username) => refreshMicrosoftLogin(username));
handleLauncherRequest('auth:microsoft-cancel', () => {
    if (!microsoftLogin) return false;
    microsoftLogin.cancelled = true;
    microsoftLogin.worker.kill();
    return true;
});
handleLauncherRequest('window:control', (event, action) => {
    const target = BrowserWindow.fromWebContents(event.sender);
    if (!target) return false;
    if (action === 'minimize') target.minimize();
    if (action === 'maximize') target.isMaximized() ? target.unmaximize() : target.maximize();
    if (action === 'close') target.close();
    return true;
});
handleLauncherRequest('account:select', (event, key) => historyMutation(async () => {
    const account = viewedAccounts.select(key, getLauncherAccounts());
    void rememberedReminders.refresh({ account }).catch(() => {});
    return account;
}));
handleLauncherRequest('account:remove', (event, key) => historyMutation(async () => {
    const account = getLauncherAccounts().find(item => item.key === key);
    if (!account) throw new Error('That account is no longer available.');
    if (microsoftLogin) throw new Error('Finish or cancel Microsoft sign-in before removing an account.');
    if (isRunning('proxy')) {
        const health = await getProxyHealth(loadAllSettings());
        if (!health) throw new Error('Stop the proxy before removing an account while its connection status is unavailable.');
        if (String(health.connectedAccount || '').toLowerCase() === account.name.toLowerCase()) {
            throw new Error('Disconnect this account from Minecraft before removing it.');
        }
    }
    if (microsoftLogin) throw new Error('Finish or cancel Microsoft sign-in before removing an account.');
    const authAccounts = getAuthAccounts();
    removeAuthCaches(AUTH_PATH, authAccounts, account);
    removedAccounts.remove(account, authAccounts);
    if (sameAccount(viewedAccounts.read(), account)) viewedAccounts.clear();
    const selected = selectedLauncherAccount();
    return { ok: true, account: selected };
}));
handleLauncherRequest('launcher:restart', () => {
    relaunchRequested = true;
    app.quit();
    return true;
});
handleLauncherRequest('logs:clear', (event, name) => {
    if (services[name]) services[name].logs = [];
    return true;
});

// ---------- Coral (Urchin) tag management for the Tags tab ----------
// Reads accept any valid key; writes prefer the dedicated admin key. Coral's
// `player` param accepts a username directly, so no UUID resolution is needed.
const CORAL_TAGS_ENDPOINT = 'https://api.urchin.gg/v3/tags';
const CORAL_PLAYER_TAGS_ENDPOINT = 'https://api.urchin.gg/v3/player/tags';

function coralTagKey(forWrite) {
    const keys = loadKeys() || {};
    const key = forWrite ? (keys.urchinadmin || keys.urchin) : (keys.urchin || keys.urchinadmin);
    return String(key || '').trim();
}

function coralTagError(error) {
    const status = error?.response?.status;
    const body = error?.response?.data;
    const detail = typeof body === 'string' ? body : (body?.error || body?.message || '');
    if (status === 400) return `Bad request${detail ? ` — ${detail}` : ' — check the tag type/reason.'}`;
    if (status === 401) return 'Urchin key is missing or invalid.';
    if (status === 403) return 'Your Urchin rank cannot do this (you can only remove tags you applied).';
    if (status === 404) return 'Player or tag not found.';
    if (status === 409) return 'That tag already exists — enable Overwrite to replace its reason.';
    if (status === 429) return 'Rate limited by Urchin. Try again shortly.';
    if (error?.code === 'ECONNABORTED') return 'Request to Urchin timed out.';
    return `Request failed${status ? ` (${status})` : ''}${detail ? ` — ${detail}` : ''}.`;
}

handleLauncherRequest('tags:list', async (event, payload = {}) => {
    const player = String(payload.player || '').trim();
    if (!player) return { error: 'Enter a player name.' };
    const key = coralTagKey(false);
    if (!key) return { error: 'No Urchin API key set (Settings → Urchin API key).' };
    try {
        const res = await axios.get(CORAL_PLAYER_TAGS_ENDPOINT, {
            timeout: 8000,
            params: { player },
            headers: { 'X-API-Key': key }
        });
        return {
            tags: Array.isArray(res.data?.tags) ? res.data.tags : [],
            displayname: res.data?.displayname || ''
        };
    } catch (e) {
        return { error: coralTagError(e), status: e?.response?.status };
    }
});

handleLauncherRequest('tags:add', async (event, payload = {}) => {
    const player = String(payload.player || '').trim();
    const type = String(payload.type || '').trim().toLowerCase().replace(/\s+/g, '_');
    const reason = String(payload.reason || '').trim();
    const hideUsername = Boolean(payload.hideUsername);
    const overwrite = Boolean(payload.overwrite);
    if (!player || !type || !reason) return { error: 'Player, tag type and reason are all required.' };
    const key = coralTagKey(true);
    if (!key) return { error: 'No Urchin admin key set (Settings → Urchin admin API key).' };
    const config = { timeout: 10000, params: { player }, headers: { 'X-API-Key': key } };
    try {
        try {
            await axios.post(CORAL_TAGS_ENDPOINT, { type, reason, hide_username: hideUsername }, config);
            return { ok: true, action: 'added' };
        } catch (e) {
            if (e?.response?.status === 409 && overwrite) {
                await axios.patch(CORAL_TAGS_ENDPOINT, { type, new_type: type, new_reason: reason, hide_username: hideUsername }, config);
                return { ok: true, action: 'updated' };
            }
            throw e;
        }
    } catch (e) {
        return { error: coralTagError(e), status: e?.response?.status };
    }
});

handleLauncherRequest('tags:remove', async (event, payload = {}) => {
    const player = String(payload.player || '').trim();
    const type = String(payload.type || '').trim().toLowerCase().replace(/\s+/g, '_');
    if (!player || !type) return { error: 'Player and tag type are required.' };
    const key = coralTagKey(true);
    if (!key) return { error: 'No Urchin admin key set (Settings → Urchin admin API key).' };
    try {
        await axios.delete(CORAL_TAGS_ENDPOINT, {
            timeout: 10000,
            params: { player },
            headers: { 'X-API-Key': key },
            data: { type }
        });
        return { ok: true };
    } catch (e) {
        return { error: coralTagError(e), status: e?.response?.status };
    }
});

app.whenReady().then(() => {
    if (!reminderAccounts.selected()) {
        // Upgrade existing installations using their most recently used cached
        // Minecraft account; no new Microsoft login is needed for public stats.
        const savedName = loadAllSettings().features.enderDustReminderLastReading?.profileName;
        const accounts = getAuthAccounts().filter(account => account.uuid).map(account => {
            const file = findAuthCacheFile(account.username, '_mca-cache.json');
            return { ...account, usedAt: file ? fs.statSync(file).mtimeMs : 0 };
        }).sort((a, b) => Number(b.profileName === savedName) - Number(a.profileName === savedName) || b.usedAt - a.usedAt);
        if (accounts[0]) reminderAccounts.remember(accounts[0].uuid, accounts[0].profileName);
    }
    void refreshRememberedReminders().catch(error => pushLog('proxy', `[Reminders] ${error.message}`));
    reminderRefreshTimer = setInterval(() => {
        void refreshRememberedReminders().catch(error => pushLog('proxy', `[Reminders] ${error.message}`));
    }, 60 * 1000);
    reminderRefreshTimer.unref();
    createWindow();
    startSettingsWatcher();
    autoStartRequestedServices();

});
handleLauncherRequest('api-key:test', (event, payload = {}) => testApiKey(payload.provider, payload.key));
handleLauncherRequest('reminders:check', () => refreshRememberedReminders({ force: true }));
handleLauncherRequest('network:validate', (event, payload = {}) => validateNetworkConfiguration(payload));

// Renderer readiness triggers one optional, anonymous check. This is outside
// launcher state/history refresh and never participates in persistence drains.
let updateNotifications = null;
function updateSender(event) {
    return win && !win.isDestroyed() && event.sender === win.webContents
        && event.senderFrame === win.webContents.mainFrame;
}
handleLauncherRequest('updates:check', event => {
    if (!updateSender(event)) return null;
    updateNotifications ||= require('./src/updates/updateNotifications').createUpdateNotifications({
        installedVersion: app.getVersion(), isPackaged: app.isPackaged,
        openExternal: url => shell.openExternal(url)
    });
    return updateNotifications.check();
});
handleLauncherRequest('updates:open', event => updateSender(event) && updateNotifications
    ? updateNotifications.open() : false);
app.on('before-quit', () => updateNotifications?.dispose());

async function prepareRenderer(deadline) {
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
    const contents = win.webContents, requestId = randomUUID();
    let listener;
    rendererFlushing = true;
    try {
        await within(new Promise((resolve, reject) => {
            listener = (event, message) => {
                if (event.sender !== contents || message?.requestId !== requestId || message.version !== 1) return;
                message.clean ? resolve() : reject(new Error('Accepted launcher saves did not complete.'));
            };
            ipcMain.on('shutdown:renderer-complete', listener);
            contents.send('shutdown:prepare-renderer', { version: 1, requestId, deadline });
        }), deadline, 'renderer');
    } finally { rendererFlushing = false; ipcMain.removeListener('shutdown:renderer-complete', listener); }
}
function requestQuit(reason) {
    if (quitOperation) return quitOperation;
    quitting = true;
    const deadline = Date.now() + GRACE_MS;
    quitOperation = (async () => {
        let clean = true, phase = 'renderer';
        const auth = microsoftLogin;
        if (auth) { auth.cancelled = true; auth.worker.kill(); }
        try {
            await prepareRenderer(deadline);
            phase = 'persistence';
            while (acceptedSaves.size) await within(Promise.allSettled([...acceptedSaves]), deadline, phase);
            if (acceptedSaveFailure) throw new Error('Accepted launcher saves failed.');
            profileStore.flush({ strict: true, onlyPending: true });
            phase = 'authentication';
            if (auth) {
                await within(auth.done, deadline, phase);
                if (auth.cleanupFailed) throw new Error('Sign-in staging cleanup failed.');
            }
        } catch { clean = false; pushLog('proxy', `[Launcher] Shutdown did not drain ${phase}.`); }
        const results = await Promise.all(Object.keys(services).map(name => stopService(name, { deadline, reason })));
        clean = clean && results.every(result => result.clean);
        if (reminderRefreshTimer) clearInterval(reminderRefreshTimer);
        if (settingsWatchTimer) clearTimeout(settingsWatchTimer);
        logUpdateTimers.forEach(timer => clearTimeout(timer)); logUpdateTimers.clear();
        settingsWatcher?.close(); profileWatcher?.close();
        quitAllowed = true;
        if (relaunchRequested && clean) app.relaunch();
        if (clean) app.quit();
        else app.exit(1);
        return { clean, outcome: clean ? 'EXITED' : 'FORCED' };
    })();
    // A single absolute fallback also covers a blocked renderer/auth worker.
    const fallback = setTimeout(() => app.exit(1), Math.max(0, deadline + FORCE_MS - Date.now()));
    fallback.unref?.();
    return quitOperation;
}
app.on('before-quit', event => { if (!quitAllowed) { event.preventDefault(); void requestQuit('quit'); } });

app.on('window-all-closed', () => {
    app.quit();
});
