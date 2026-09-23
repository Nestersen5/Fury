const REPOSITORY_ROOT = require('path').resolve(__dirname, '../..');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Guards the persistence path for the session-tracking toggles.
//
// These settings live in features_config.json, which is written by an EXPLICIT
// WHITELIST in app_config.js's saveFeatureSettings. A key missing from that
// whitelist is silently dropped on every save and then springs back to its
// default on the next reloadConfig() — which is what made "/session recap off"
// turn itself back on. A static check is the cheap way to keep the four layers
// (defaults, writer whitelist, parser, proxy load/snapshot) in step.

const root = REPOSITORY_ROOT;
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const appConfig = read('app_config.js');
const bootstrapConfig = path.join('src', 'bootstrap', 'config.js');
const parser = read(bootstrapConfig);
const proxy = read('proxy.js');
const runtimeState = read(path.join('src', 'state', 'runtimeState.js'));

const SESSION_FEATURE_KEYS = [
    'sessionTrackingEnabled',
    'gameRecapEnabled',
    'replayDetailsEnabled'
];

const SESSION_SETTING_KEYS = [
    'sessionBoundaryMinutes',
    'sessionRetention',
    'sessionRecapStyle',
    'sessionRecapFields',
    'sessionBedwarsFields',
    'sessionSkywarsFields',
    'sessionDuelsFields',
    'sessionGoalWins',
    'sessionGoalFinals',
    'sessionGoalGames',
    'sessionGoalMinutes'
];

function matchBlock(source, startPattern, endPattern, label) {
    const start = source.search(startPattern);
    assert.notStrictEqual(start, -1, `Missing block start for ${label}`);
    const rest = source.slice(start);
    const end = rest.search(endPattern);
    assert.notStrictEqual(end, -1, `Missing block end for ${label}`);
    return rest.slice(0, end);
}

// 1. Defaults — so a fresh install has a defined value.
const defaultsBlock = matchBlock(appConfig, /features: \{/, /\n {4}\},/, 'app_config defaults.features');
SESSION_FEATURE_KEYS.forEach((key) => {
    assert(
        defaultsBlock.includes(`${key}:`),
        `app_config defaults.features must define ${key}`
    );
});
assert(defaultsBlock.includes('...SESSION_DEFAULTS'), 'session module defaults must be included in fresh-install feature defaults');

// 2. The writer whitelist — the one that actually bit us.
const writerBlock = matchBlock(
    appConfig,
    /function saveFeatureSettings\(features\)/,
    /\nfunction /,
    'saveFeatureSettings'
);
SESSION_FEATURE_KEYS.forEach((key) => {
    assert(
        writerBlock.includes(`${key}:`),
        `saveFeatureSettings must persist ${key} — it is an explicit whitelist, `
        + 'so an omitted key is dropped on every save and reverts to its default'
    );
});
assert(
    writerBlock.includes('...normalizeSessionFeatureSettings(next)'),
    'saveFeatureSettings must normalize and persist the connected session settings module'
);

// 3. The parser — reads it back off disk.
SESSION_FEATURE_KEYS.forEach((key) => {
    assert(
        parser.includes(`${key}: bool('${key}'`),
        `${bootstrapConfig} must parse ${key}`
    );
});
SESSION_SETTING_KEYS.forEach((key) => {
    assert(parser.includes(`${key}:`), `${bootstrapConfig} must parse ${key}`);
});

// 4. proxy.js must both apply it on load and report it in the snapshot that
//    gets written back. Missing the snapshot half would silently reset it.
SESSION_FEATURE_KEYS.forEach((key) => {
    assert(
        proxy.includes(`state.${key} = features.${key};`),
        `proxy.js loadFeatureConfig must apply ${key}`
    );
    assert(
        proxy.includes(`${key}: state.${key},`),
        `proxy.js must include ${key} in its feature snapshot`
    );
});
SESSION_SETTING_KEYS.forEach((key) => {
    assert(
        proxy.includes(`state.${key} = features.${key};`),
        `proxy.js loadFeatureConfig must apply ${key}`
    );
    assert(
        proxy.includes(`${key}: state.${key},`),
        `proxy.js must include ${key} in its feature snapshot`
    );
});

// 5. The runtime state object owns the live values.
SESSION_FEATURE_KEYS.forEach((key) => {
    assert(
        runtimeState.includes(`${key}:`),
        `runtimeState must declare ${key}`
    );
});
SESSION_SETTING_KEYS.forEach((key) => {
    assert(runtimeState.includes(`${key}:`), `runtimeState must declare ${key}`);
});
assert(!appConfig.includes('encounterTrackingEnabled') && !parser.includes('encounterTrackingEnabled') && !proxy.includes('encounterTrackingEnabled'), 'Removed encounter tracking must not remain in live configuration');
assert(parser.includes('sessionRetention: 0'), 'The config parser uses unlimited retention');
assert(parser.includes('sessionBoundaryMinutes: 30'), 'The config parser uses 30 minutes of inactivity');

// 6. The toggles must persist when changed, not just mutate memory.
const sessionHandler = matchBlock(
    proxy,
    /async function handleLocalSessionCommand\(client, args\)/,
    /\n {8}function handleRecapCommand/,
    'handleLocalSessionCommand'
);
assert(
    /state\.sessionTrackingEnabled = sub === 'on';\s*\n\s*saveFeatureConfig\(\);/.test(sessionHandler),
    '/session on|off must call saveFeatureConfig()'
);
assert(
    /state\.gameRecapEnabled = arg === 'on'[\s\S]{0,200}?saveFeatureConfig\(\);/.test(sessionHandler),
    '/session recap must call saveFeatureConfig()'
);
assert(
    sessionHandler.includes("arg === 'on' ? true"),
    '/session recap should accept an explicit on/off, not only a blind toggle'
);

// 7. The spurious-game-end guard must stay wired: proxy passes its own
//    authoritative duration and a per-game key.
const gameEndCall = matchBlock(
    proxy,
    /function finalizeSessionGame\(/,
    /function rewriteBedwarsEventLabelsForClient\(/,
    'sessionTracker.onGameEnd call'
);
assert(
    /function enterBedwarsPregame\([\s\S]*?sessionTracker\.onQueueStart\(\{ mode: 'BEDWARS' \}\)/.test(proxy),
    'the automatic session baseline must begin at the first confirmed BedWars queue'
);
assert(
    gameEndCall.includes('const durationMs = gameStartTime') && gameEndCall.includes('durationMs,'),
    'proxy must pass its authoritative gameStartTime-derived duration to onGameEnd'
);
assert(
    gameEndCall.includes('sessionKey: gameSessionId'),
    'proxy must pass a per-game sessionKey so a repeated end is ignored'
);

// 8. Exercise the real writer against an isolated file. This catches scope and
// shorthand mistakes that static whitelist checks cannot detect (for example,
// writing a property whose local variable was declared under another name).
const configRuntime = require('../../app_config.js');
const originalFeaturesPath = configRuntime.paths.features;
const tempConfigDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'fury-feature-save-'));
const tempFeaturesPath = path.join(tempConfigDirectory, 'features.json');
try {
    configRuntime.paths.features = tempFeaturesPath;
    const initial = configRuntime.loadFeatureSettings();
    configRuntime.saveFeatureSettings({
        ...initial,
        autoGamblerEnabled: !initial.autoGamblerEnabled,
        bedwarsSidebarTeamColorsEnabled: false
    });
    const saved = configRuntime.loadFeatureSettings();
    assert.notStrictEqual(
        saved.autoGamblerEnabled,
        initial.autoGamblerEnabled,
        'saveFeatureSettings must persist an ordinary feature toggle'
    );
    assert.strictEqual(
        saved.bedwarsSidebarTeamColorsEnabled,
        false,
        'saveFeatureSettings must persist the BedWars sidebar toggle without throwing'
    );
} finally {
    configRuntime.paths.features = originalFeaturesPath;
    if (fs.existsSync(tempFeaturesPath)) fs.unlinkSync(tempFeaturesPath);
    fs.rmdirSync(tempConfigDirectory);
}

console.log('test_session_config.js: all assertions passed');
