const REPOSITORY_ROOT = require('path').resolve(__dirname, '../..');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const proxy = fs.readFileSync(path.join(REPOSITORY_ROOT, 'proxy.js'), 'utf8');
const hypixelApiClient = fs.readFileSync(path.join(REPOSITORY_ROOT, 'features', 'hypixel_api_client.js'), 'utf8');
const urchinClient = fs.readFileSync(path.join(REPOSITORY_ROOT, 'features', 'urchin_client.js'), 'utf8');
const statsLookup = fs.readFileSync(path.join(REPOSITORY_ROOT, 'src', 'stats', 'lookup.js'), 'utf8');
const overlayScan = fs.readFileSync(path.join(REPOSITORY_ROOT, 'src', 'overlay', 'scan.js'), 'utf8');

function expect(pattern, message, source = proxy) {
    assert(pattern.test(source), message);
}

expect(/createHypixelApiClient\(\{[\s\S]*getKeys: \(\) => keys[\s\S]*getGameState: \(\) => activeUser\?\.getHypixelUsageGameState/, 'Proxy should wire the single Hypixel API key and game state to the client.');
expect(/const HYPIXEL_API_BURST_CONCURRENCY = 5;/, 'Active-game Hypixel burst concurrency should be capped to limit Cloudflare burst trips.', hypixelApiClient);
expect(/const HYPIXEL_API_NON_GAME_CONCURRENCY = 3;/, 'Hypixel background concurrency should be capped.', hypixelApiClient);
expect(/const HYPIXEL_API_NON_GAME_MIN_SPACING_MS = 450;/, 'Hypixel background requests should be spaced.', hypixelApiClient);
expect(/function hypixelApiQueuePriority\(meta = \{\}\) \{[\s\S]*return isHypixelApiGameActive\(\) \? 'game' : 'background';[\s\S]*\}/, 'Hypixel queue should infer game/background priority.', hypixelApiClient);
expect(/const HYPIXEL_API_GAME_MIN_SPACING_MS = 200;/, 'Game-priority Hypixel requests need a global spacing floor; the per-IP Cloudflare edge limit is not raised by key rotation.', hypixelApiClient);
expect(/function hypixelGameSpacingMs\(\) \{[\s\S]*hypixelApiWindowRequestCount \/ HYPIXEL_API_LIMIT_MAX[\s\S]*used >= 0\.9[\s\S]*HYPIXEL_API_SPACING_JITTER[\s\S]*\}/, 'Game spacing should stretch as the 5-minute budget drains and carry jitter.', hypixelApiClient);
expect(/function takeNextHypixelApiQueueItem\(\) \{[\s\S]*findIndex\(item => item\?\.meta\?\.priority === 'game'\)[\s\S]*hypixelApiNextGameAt - Date\.now\(\)[\s\S]*scheduleHypixelApiDrain\(gameWaitMs\)[\s\S]*removeAt\(gameIndex\)[\s\S]*HYPIXEL_API_NON_GAME_CONCURRENCY[\s\S]*hypixelApiNextNonGameAt - Date\.now\(\)[\s\S]*hypixelApiQueue\.shift\(\);[\s\S]*\}/, 'Hypixel queue should pace game requests against a global floor before draining them, then pace background requests.', hypixelApiClient);
expect(/hypixelApiNextGameAt = Date\.now\(\) \+ hypixelGameSpacingMs\(\);/, 'Dispatching a game request should arm the next game-spacing slot.', hypixelApiClient);
expect(/function hypixelApiGet\(url, options = \{\}\) \{[\s\S]*const \{ apiPriority, \.\.\.axiosOptions \} = options \|\| \{\};[\s\S]*selectHypixelApiKey\(\)[\s\S]*stripHypixelKeyParam\(url\)[\s\S]*'API-Key': entry\.key[\s\S]*priority: apiPriority[\s\S]*\}/, 'Hypixel API wrapper should use one key while keeping request priority internal.', hypixelApiClient);
assert(/function configuredHypixelApiKeys\(\) \{[\s\S]*keys\.hypixel[\s\S]*return primary \? \[\{ id: 'primary'/.test(hypixelApiClient), 'Hypixel key selection should expose only the configured primary key.');
assert(/function selectHypixelApiKey\(\) \{[\s\S]*healthyHypixelApiKeys\(\)\[0\]/.test(hypixelApiClient), 'Hypixel requests should always select the single configured key.');
assert(!/hypixelSecondary|hypixelDualApiEnabled|activeHypixelBulkKeyPlan|hypixelKeyHint/.test(`${proxy}\n${hypixelApiClient}\n${overlayScan}`), 'The proxy, Hypixel client, and scan runner must not retain dual-key behavior.');
expect(/async function performFullScan\(client, lobbyMap, detectedNickedPlayers, myTeam, context = \{\}\) \{[\s\S]*getPlayerDataWithNickDetection\(target\.lookupName, \{[\s\S]*apiPriority: 'game'[\s\S]*\}\)/, 'Full scans should use the one-key Hypixel request path.', overlayScan);
expect(/getOverlayPlayerData\(target, mode, 'chat_trigger', \{\s*apiPriority: options\.lookingFor \? 'game' : undefined,\s*preferCache: true/, '/lf overlay lookups must share scan pacing and reuse cached profiles.');
expect(/async function getOverlayPlayerData\([^\n]*lookupOptions = \{\}\) \{[\s\S]*getPlayerDataWithNickDetection\(name, \{ \.\.\.lookupOptions, forceRefresh: manualLookup \}\)/, 'Overlay lookups must forward the requested API priority.');
expect(/getPlayerDataWithNickDetection\(match\.sender, \{\s*preferCache: true,\s*apiPriority: match\.lookingFor \? 'game' : undefined/, '/lf chat-only fallback must use the same scan pacing as overlay lookups.');
expect(/function refreshTabStatsForRoster\(\) \{[\s\S]*queueTabStatsUpdate\(name, index \* HYPIXEL_API_GAME_MIN_SPACING_MS\);[\s\S]*\}/, 'Tabstats should use the shared one-key request pacing.');
expect(/gameQueued:[\s\S]*backgroundQueued:[\s\S]*backgroundConcurrency:[\s\S]*nextBackgroundInMs:/, 'Hypixel usage snapshot should expose background queue pacing.', hypixelApiClient);
expect(/const HYPIXEL_API_DIAGNOSTIC_LOG_THROTTLE_MS = 1500;/, 'Hypixel diagnostic logs should be throttled to avoid console spam.', hypixelApiClient);
expect(/function logHypixelApiFailure\(error, meta = \{\}, usageEvent = null\) \{[\s\S]*Reason:[\s\S]*Recent totals:[\s\S]*5m statuses:[\s\S]*5m endpoints:[\s\S]*Queue:/, 'Hypixel failures should log detailed console-only usage diagnostics.', hypixelApiClient);
expect(/function hypixelUsageBreakdown\(windowMs\) \{[\s\S]*statusCounts[\s\S]*endpointCounts[\s\S]*failures[\s\S]*topEndpoints/, 'Hypixel diagnostics should include status and endpoint breakdowns.', hypixelApiClient);
expect(/async function runStatsLookupCommand\(client, commandLabel, target, renderProfile[^)]*\) \{[\s\S]*profileLookupFailureReason[\s\S]*sendChat\(client, `§c\$\{commandLabel\} failed for[\s\S]*render failed[\s\S]*lookup failed/, 'Stats commands should always send a chat reason when lookup or rendering fails.', statsLookup);
expect(/if \(cmd === '\/stats' \|\| cmd === '\/s'\) \{[\s\S]*await runStatsLookupCommand\(client, cmd, target[\s\S]*renderBedwarsStats[\s\S]*else if \(cmd === '\/duels'/, '/stats and /s should route through the guaranteed-response lookup helper.');

expect(/createUrchinClient\(\{[\s\S]*getKey: \(\) => keys\.urchin[\s\S]*getGameState: \(\) => activeUser\?\.getHypixelUsageGameState[\s\S]*parseBatchTags: parseUrchinBatchTags/, 'Proxy should wire Urchin client to live key, game state, and tag parsing.');
expect(/const URCHIN_BATCH_DEBOUNCE_MS = 40;/, 'Active-game Urchin debounce should stay fast.', urchinClient);
expect(/const URCHIN_BATCH_NON_GAME_DEBOUNCE_MS = 650;/, 'Urchin background batches should have a slower debounce.', urchinClient);
expect(/const URCHIN_BATCH_NON_GAME_MIN_SPACING_MS = 900;/, 'Urchin background batches should be spaced.', urchinClient);
expect(/const URCHIN_BATCH_NON_GAME_MAX_NAMES = 12;/, 'Urchin background batches should be smaller than active-game batches.', urchinClient);
expect(/function urchinBatchPriority\(options = \{\}\) \{[\s\S]*return isUrchinBatchGameActive\(\) \? 'game' : 'background';[\s\S]*\}/, 'Urchin batch queue should infer game/background priority.', urchinClient);
expect(/function nextUrchinBatchDelay\(baseDelay = URCHIN_BATCH_DEBOUNCE_MS\) \{[\s\S]*hasGameQueued[\s\S]*return Math\.max\(0, baseDelay\);[\s\S]*URCHIN_BATCH_NON_GAME_DEBOUNCE_MS[\s\S]*\}/, 'Urchin game batches should bypass non-game debounce.', urchinClient);
expect(/function drainUrchinBatchQueue\(\) \{[\s\S]*const gameItem = Array\.from\(urchinBatchLookupQueue\.values\(\)\)\.find\(item => item\.priority === 'game'\);[\s\S]*priority === 'game' \? URCHIN_BATCH_MAX_NAMES : URCHIN_BATCH_NON_GAME_MAX_NAMES[\s\S]*if \(priority !== 'game'\) urchinNextNonGameBatchAt = Date\.now\(\) \+ URCHIN_BATCH_NON_GAME_MIN_SPACING_MS;[\s\S]*\}/, 'Urchin drain should prioritize game batches and pace background batches.', urchinClient);
expect(/async function fetchUrchinSession\(player, period\) \{[\s\S]*await paceUrchinNonGameRequest\(\);[\s\S]*axios\.get\(url,[\s\S]*\}/, 'Urchin session endpoint should use non-game pacing.', urchinClient);
expect(/gameQueuedPlayers:[\s\S]*backgroundQueuedPlayers:[\s\S]*nextBackgroundBatchInMs:/, 'Urchin usage snapshot should expose background pacing.', urchinClient);

console.log('API pacing static checks passed.');
