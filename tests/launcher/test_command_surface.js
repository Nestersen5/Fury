const REPOSITORY_ROOT = require('path').resolve(__dirname, '../..');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = REPOSITORY_ROOT;
const proxy = fs.readFileSync(path.join(root, 'proxy.js'), 'utf8');
const launcherHtml = fs.readFileSync(path.join(root, 'launcher.html'), 'utf8');
const launcherJs = fs.readFileSync(path.join(root, 'launcher.js'), 'utf8');
const launcherThemeCss = fs.readFileSync(path.join(root, 'src/launcher/styles/launcher_theme.css'), 'utf8');
const launcherThemeJs = fs.readFileSync(path.join(root, 'src/launcher/renderer/launcher_theme.js'), 'utf8');
const appConfig = fs.readFileSync(path.join(root, 'app_config.js'), 'utf8');
const apiKeyCommandModule = fs.readFileSync(path.join(root, 'features', 'api_key_commands.js'), 'utf8');
const autoGamblerModule = fs.readFileSync(path.join(root, 'features', 'auto_gambler.js'), 'utf8');
const chatTriggerModule = fs.readFileSync(path.join(root, 'features', 'chat_triggers.js'), 'utf8');
const commandCompletionModule = fs.readFileSync(path.join(root, 'features', 'command_completion.js'), 'utf8');
const helpCommandModule = fs.readFileSync(path.join(root, 'features', 'help_command.js'), 'utf8');
const minecraftChatModule = fs.readFileSync(path.join(root, 'features', 'minecraft_chat.js'), 'utf8');
const proxyHealthModule = fs.readFileSync(path.join(root, 'features', 'proxy_health.js'), 'utf8');
const statsCollectModule = fs.readFileSync(path.join(root, 'src', 'stats', 'collect.js'), 'utf8');
const statsFormatModule = fs.readFileSync(path.join(root, 'src', 'stats', 'format.js'), 'utf8');
const statsRenderHelpersModule = fs.readFileSync(path.join(root, 'src', 'stats', 'renderHelpers.js'), 'utf8');
const bedwarsRenderModule = fs.readFileSync(path.join(root, 'src', 'stats', 'render', 'bedwars.js'), 'utf8');
const skywarsRenderModule = fs.readFileSync(path.join(root, 'src', 'stats', 'render', 'skywars.js'), 'utf8');
const duelsRenderModule = fs.readFileSync(path.join(root, 'src', 'stats', 'render', 'duels.js'), 'utf8');
const generalRenderModule = fs.readFileSync(path.join(root, 'src', 'stats', 'render', 'general.js'), 'utf8');
const statsLookupModule = fs.readFileSync(path.join(root, 'src', 'stats', 'lookup.js'), 'utf8');
const denickHistoryModule = fs.readFileSync(path.join(root, 'src', 'denick', 'history.js'), 'utf8');
const denickApiModule = fs.readFileSync(path.join(root, 'src', 'denick', 'api.js'), 'utf8');
const denickCommandsModule = fs.readFileSync(path.join(root, 'src', 'denick', 'commands.js'), 'utf8');
const bootstrapConfigModule = fs.readFileSync(path.join(root, 'src', 'bootstrap', 'config.js'), 'utf8');

function matchBlock(source, startPattern, endPattern) {
    const start = source.search(startPattern);
    assert.notStrictEqual(start, -1, `Missing block start ${startPattern}`);
    const rest = source.slice(start);
    const end = rest.search(endPattern);
    assert.notStrictEqual(end, -1, `Missing block end ${endPattern}`);
    return rest.slice(0, end);
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchCssRule(selector) {
    const match = launcherThemeCss.match(new RegExp(`${escapeRegExp(selector)}\\s*\\{([\\s\\S]*?)\\n\\}`));
    assert(match, `Missing CSS rule ${selector}`);
    return match[1];
}

const commandBlock = matchBlock(commandCompletionModule, /const PROXY_COMMANDS = \[/, /\];/);
const tabRouterBlock = matchBlock(commandCompletionModule, /function proxyTabMatches\(rawText\)/, /return proxyTabMatches;/);
['/duels', '/general', '/tabstats', '/denick', '/denickskin', '/profile', '/profiles'].forEach(command => {
    assert(commandBlock.includes(`'${command}'`), `Expected ${command} in proxy command surface`);
});
[
    '/duel',
    '/cosmetics',
    '/cosmetic',
    '/activecosmetics',
    '/woodskin',
    '/woodskins',
    '/km',
    '/killmessage',
    '/hotkeydebug',
    '/debugstate'
].forEach(command => {
    assert(!commandBlock.includes(`'${command}'`), `Unexpected ${command} in proxy command surface`);
});

Array.from(commandBlock.matchAll(/'([^']+)'/g)).map(match => match[1]).forEach(command => {
    assert(tabRouterBlock.includes(`'${command}'`), `Expected ${command} to have tab-completion routing`);
});

const hiddenCommandBlock = matchBlock(commandCompletionModule, /const HIDDEN_PROXY_COMMANDS = \[/, /\];/);
['/activecosmetics', '/hotkeydebug', '/debugstate'].forEach(command => {
    assert(hiddenCommandBlock.includes(`'${command}'`), `Expected ${command} to be tab-routed as a hidden command`);
    assert(tabRouterBlock.includes(`'${command}'`), `Expected ${command} to have exact-command tab completion`);
});
assert(/if \(!visibleProxyCommand && !hiddenProxyCommand\) return null;/.test(tabRouterBlock), 'Unknown slash commands should still pass through to Hypixel tab completion');
assert(/cmd === '\/activecosmetics'[\s\S]*completePlayers\(args\[1\]/.test(tabRouterBlock), 'Active cosmetics command should tab-complete player names');
assert(/cmd === '\/hotkeydebug'[\s\S]*completeFromList\(\['on', 'off', 'status', 'enable', 'disable'\]/.test(tabRouterBlock), 'Hotkey debug command should tab-complete its subcommands');
assert(/cmd === '\/chattrigger' \|\| cmd === '\/chattriggers' \|\| cmd === '\/ctriggers'[\s\S]*completeFromList\(chatTriggerManager\.getTriggers\(\), args\.slice\(2\)\.join\(' '\)\)/.test(tabRouterBlock), '/chattrigger remove should tab-complete saved trigger names');
assert(proxy.includes("require('./src/denick/history.js')"), 'Proxy should import the denick history module');
assert(/createDenickHistory\(\{[\s\S]*historyFile: DENICKED_HISTORY_FILE[\s\S]*writeJsonOffThread[\s\S]*\}\)/.test(proxy), 'Proxy should wire createDenickHistory with the history file and off-thread writer');
assert(!/function appendDenickHistory\(entry = \{\}\)/.test(proxy), 'appendDenickHistory should live in src/denick/history.js, not proxy.js');
assert(!/function normalizeDenickHistory\(raw\)/.test(proxy), 'normalizeDenickHistory should live in src/denick/history.js, not proxy.js');
assert(/writeJsonOffThread\(historyFile, players, 'DenickHistory',/.test(denickHistoryModule), 'Denick history module should write off-thread with an acknowledgement');
assert(/function normalizeDenickHistory\(raw\)[\s\S]*finalizeDenickPlayerEvents\(current\)/.test(denickHistoryModule), 'Denick history normalization should finalize player events with dedupe + cap');
assert(proxy.includes("require('./src/denick/api.js')"), 'Proxy should import the denick api module');
assert(/createDenickApi\(\{[\s\S]*cosmeticApiNamesFile: COSMETIC_API_NAMES_FILE[\s\S]*\}\)/.test(proxy), 'Proxy should wire createDenickApi with the cosmetic api-names file');
assert(!/createDenickApi\(\{[^}]*parseStatCount[^}]*\}\)/.test(proxy), 'createDenickApi should no longer take parseStatCount as DI — api.js requires it directly from commands.js');
assert(/require\('\.\/commands\.js'\)/.test(denickApiModule) && /const \{ parseStatCount \} = require\('\.\/commands\.js'\);/.test(denickApiModule), 'src/denick/api.js should source parseStatCount directly from src/denick/commands.js');
assert(proxy.includes("require('./src/denick/commands.js')"), 'Proxy should import the denick commands module');
assert(/createDenickCommands\(\{[\s\S]*axios[\s\S]*sendChat[\s\S]*getKeys: \(\) => keys[\s\S]*hasHypixelApiKeyConfigured[\s\S]*cosmeticSearchApiUrl: LOCAL_COSMETIC_SEARCH_URL[\s\S]*getCosmeticSearchToken: \(\) => COSMETIC_SEARCH_TOKEN[\s\S]*denickRange: DENICK_RANGE[\s\S]*formatInt[\s\S]*getPlayerData[\s\S]*getRealNameFromSkin[\s\S]*isMinecraftUsername[\s\S]*appendDenickHistory[\s\S]*parseDenickFilters[\s\S]*\}\)/.test(proxy), 'Proxy should wire createDenickCommands with the local Cosmetic Search URL and its existing dependencies');
assert(!/async function findDenickCandidatesByCosmetics\(filters = \{\}\)/.test(proxy), 'findDenickCandidatesByCosmetics should live in src/denick/commands.js, not proxy.js');
assert(!/async function findDenickCandidatesByStats\(targets = \{\}/.test(proxy), 'findDenickCandidatesByStats should live in src/denick/commands.js, not proxy.js');
assert(!/async function handleDenick\(client, args, lobbyPlayers, context = \{\}\)/.test(proxy), 'handleDenick should live in src/denick/commands.js, not proxy.js');
assert(!/async function handleDenickSkin\(client, args, lobbyPlayers, context = \{\}\)/.test(proxy), 'handleDenickSkin should live in src/denick/commands.js, not proxy.js');
assert(!/function parseStatCount\(value\) \{/.test(proxy), 'parseStatCount should live in src/denick/commands.js, not proxy.js');
assert(!/function denickCandidateKey\(candidate = \{\}\)/.test(proxy), 'denickCandidateKey should live in src/denick/commands.js, not proxy.js');
assert(!/const DENICK_COSMETIC_FIELDS = \{/.test(proxy), 'DENICK_COSMETIC_FIELDS should live in src/denick/api.js, not proxy.js');
assert(!/function parseDenickFilters\(args\) \{/.test(proxy), 'parseDenickFilters should live in src/denick/api.js, not proxy.js');
assert(/const DENICK_STAT_FIELD_BY_ALIAS = new Map\(\[[\s\S]*\['finals', 'finals'\][\s\S]*\['beds', 'beds'\][\s\S]*\]\);/.test(denickApiModule), '/denick should recognize finals and beds as stats filters');
assert(/function parseDenickFilters\(args\) \{[\s\S]*const statField = matchDenickStatField\(args, index\);[\s\S]*const nextStatField = valueTokens\.length > 0 \? matchDenickStatField\(args, index\) : null;[\s\S]*if \(nextStatField \|\| nextCosmeticField\) break;[\s\S]*hasCosmetics:[\s\S]*hasStats:/.test(denickApiModule), '/denick parser should allow finals/beds filters mixed after cosmetic values');
assert(/function denickCosmeticApiValue\(fieldKey, rawValue\) \{[\s\S]*DENICK_COSMETIC_API_EXCEPTIONS\[fieldKey\][\s\S]*canonicalCosmeticName\(def\.type, raw\)/.test(denickApiModule), 'denickCosmeticApiValue should consult api exceptions, learned overrides, and the canonical-name catalog');
assert(/const parsed = parseDenickFilters\(args\);[\s\S]*parsed\.hasStats && !parsed\.hasCosmetics[\s\S]*parsed\.hasCosmetics && !parsed\.hasStats[\s\S]*Searching combined match[\s\S]*findDenickCandidatesByCosmetics\(parsed\.filters\),[\s\S]*findDenickCandidatesByStats\(parsed\.stats\)[\s\S]*statsByKey/.test(denickCommandsModule), '/denick should support stats-only, cosmetics-only, and combined stats+cosmetic searches');
assert(/function denickFilterFieldSuggestions\(\) \{[\s\S]*'finals', 'beds'[\s\S]*denickCosmeticFieldSuggestions/.test(commandCompletionModule), '/denick tab completion should suggest finals/beds alongside cosmetic fields');
assert(/function completeDenickCommand\(args\)[\s\S]*completeDenickFilterSequence\(args, 1\)/.test(commandCompletionModule), '/denick tab completion should use the mixed filter completer');

const helpBlock = helpCommandModule;
['/duels', '/general', '/tabstats', 'Core tab list stats'].forEach(text => {
    assert(helpBlock.includes(text), `Expected help to mention ${text}`);
});
['/cosmetics', '/activecosmetics', '/woodskin', '/km', '/hotkeydebug', '/debugstate', 'Experimental tab stats'].forEach(text => {
    assert(!helpBlock.includes(text), `Unexpected help text: ${text}`);
});

assert(statsFormatModule.includes("const MINECRAFT_STAR_SYMBOL = '✫';"), 'Stats format module must define the real Minecraft star symbol');
assert(/function getBedwarsStarIcon\(level\) \{[\s\S]*safeLevel >= 3100[\s\S]*return '✥';[\s\S]*safeLevel >= 2100[\s\S]*return '⚝';[\s\S]*safeLevel >= 1100[\s\S]*return '✪';[\s\S]*return MINECRAFT_STAR_SYMBOL;[\s\S]*\}/.test(statsFormatModule), 'BedWars star helper must preserve high-prestige icon tiers');
assert(/formatSkyWarsLevel[\s\S]*replace\(\/\\\*\/g, MINECRAFT_STAR_SYMBOL\)/.test(statsFormatModule), 'SkyWars formatted levels must replace API asterisks');
assert(statsFormatModule.includes('MINECRAFT_STAR_SYMBOL}]`'), 'SkyWars fallback levels must include the real star symbol');
assert(proxy.includes("require('./src/stats/format.js')"), 'Proxy should import the stats format module');
assert(proxy.includes("require('./src/stats/colors.js')"), 'Proxy should import the stats colors module');
assert(proxy.includes("require('./src/stats/renderHelpers.js')"), 'Proxy should import the stats render helpers module');
assert(/createRenderHelpers\(\{ statValue \}\)/.test(proxy), 'Proxy should wire createRenderHelpers with statValue');
assert(proxy.includes("require('./src/stats/render/bedwars.js')"), 'Proxy should import the BedWars render module');
assert(/function renderBedwarsStats\(client, data, mode = BEDWARS_MODE_DEFS\[0\][\s\S]*collectBedwarsStats\(bw, mode, data\)/.test(bedwarsRenderModule), 'BedWars renderer should collect stats for the requested mode');
assert(proxy.includes("require('./src/stats/render/skywars.js')"), 'Proxy should import the SkyWars render module');
assert(/function renderSkyWarsDashboard\(client, data, isCached, mode = SKYWARS_MODE_DEFS\[0\][\s\S]*collectSkyWarsStats\(sw, activeMode, data\)/.test(skywarsRenderModule), 'SkyWars dashboard should collect stats for the active mode');
assert(proxy.includes("require('./src/stats/render/duels.js')"), 'Proxy should import the Duels render module');
assert(/function renderDuelsStats\(client, data, mode = DUELS_MODE_DEFS\[0\][\s\S]*collectDuelsStats\(duels, activeMode\)/.test(duelsRenderModule), 'Duels renderer should collect stats for the active mode');
assert(proxy.includes("require('./src/stats/render/general.js')"), 'Proxy should import the general render module');
assert(/function renderGeneralStats\(client, data, guild = null[\s\S]*networkLevelProgress\(exp\)/.test(generalRenderModule), 'General renderer should compute network level progress');
assert(/function renderPlayerInfo\(client, data, isCached = false\)[\s\S]*buildPlayerInfoTagComponents\(data\)/.test(generalRenderModule), 'Player info should render the tags built by buildPlayerInfoTagComponents');
assert(proxy.includes("require('./src/stats/lookup.js')"), 'Proxy should import the stats lookup module');
assert(/async function runStatsLookupCommand\(client, commandLabel, target, renderProfile, options = \{\}\)[\s\S]*getPlayerData\(target, \{ includeErrors: true, includeStatus: Boolean\(options\.includeStatus\) \}\)/.test(statsLookupModule), 'Stats lookup command should fetch status only when explicitly requested (one request per player by default)');
assert(/function skyOverallNonMiniValue\(sw = \{\}, stat\) \{[\s\S]*statValue\(sw, stat\) - statValue\(sw, `\$\{stat\}_mini`\)/.test(statsCollectModule), 'SkyWars overall must subtract Mini stats from total stats');
assert(/function collectSkyWarsStats[\s\S]*const miniMode = mode\.kind === 'base' && mode\.suffix === 'mini';[\s\S]*const losses = miniMode && games > 0 \? Math\.max\(0, games - wins\) : rawLosses;[\s\S]*const deaths = miniMode && games > 0 \? Math\.max\(0, games - wins\) : rawDeaths;/.test(statsCollectModule), 'Only SkyWars Mini may derive losses/deaths from games minus wins');
assert(proxy.includes("require('./src/stats/collect.js')"), 'Proxy should import the stats collector module');
assert(/function getTopSkyWarsKit[\s\S]*if \(mode\.kind === 'overall'\) return !entry\.kitId\.includes\('_mini_'\) && !entry\.kitId\.startsWith\('mini_'\);/.test(proxy), 'SkyWars overall top kit must exclude Mini kits');

assert(launcherHtml.includes("const MINECRAFT_STAR_SYMBOL = '✫';"), 'Launcher must define the real Minecraft star symbol');
assert(launcherHtml.includes("char === '*' ? MINECRAFT_STAR_SYMBOL : char"), 'Launcher legacy renderer must repair asterisk stars');
assert(/function getOverlayStarIcon\(level\) \{[\s\S]*safeLevel >= 3100[\s\S]*return '✥';[\s\S]*safeLevel >= 2100[\s\S]*return '⚝';[\s\S]*safeLevel >= 1100[\s\S]*return '✪';[\s\S]*return MINECRAFT_STAR_SYMBOL;[\s\S]*\}/.test(launcherHtml), 'Overlay star helper must preserve high-prestige icon tiers');
assert(/function overlayBoardLevelHtml\(row = \{\}\)[\s\S]*?row\.stats\?\.levelLegacy[\s\S]*?renderLegacyMinecraftText\(legacy\)/.test(launcherHtml), 'Overlay SkyWars levels must use the legacy renderer that repairs asterisk stars');

const duelsBlock = matchBlock(proxy, /const DUELS_MODE_DEFS = \[/, /\];/);
['sw_duel', 'sw_doubles', 'bridge_duel', 'bridge_doubles', 'bridge_threes', 'bridge_four',
    'bedwars_two_one_duels', 'bedwars_two_one_duels_rush', 'classic_duel', 'classic_doubles',
    'uhc_duel', 'uhc_doubles', 'uhc_four', 'uhc_meetup', 'sumo_duel', 'potion_duel',
    'boxing_duel', 'combo_duel', 'blitz_duel', 'op_duel', 'op_doubles', 'spleef_duel',
    'bowspleef_duel', 'quake_duel', 'parkour_eight', 'mw_duel', 'bow_duel'].forEach(prefix => {
    assert(duelsBlock.includes(`prefix: '${prefix}'`), `Missing canonical Duels prefix ${prefix}`);
});
assert(!duelsBlock.toLowerCase().includes('_kit'), 'Duels mode definitions must not include kit prefixes');

assert(/data-page-tab="anticheat"/.test(launcherHtml), 'AntiCheat launcher tab should be visible');
assert(!/data-page-tab="cosmetics"/.test(launcherHtml), 'Cosmetics launcher tab must stay hidden');
assert(!/data-settings-subpage-button="(?:anticheat|cosmetics)"/.test(launcherHtml), 'Anti-cheat/cosmetics settings buttons must stay hidden');
assert(/data-page="anticheat"/.test(launcherHtml), 'AntiCheat page should be available');
assert(!/data-page="cosmetics"/.test(launcherHtml), 'The removed cosmetic-model page must not come back');
assert(!/data-settings-subpage="anticheat"/.test(launcherHtml), 'Anti-cheat settings panel should not be exposed');
assert(!/data-settings-subpage="cosmetics"/.test(launcherHtml), 'Cosmetics settings panel should not be exposed');
assert(!launcherHtml.includes('cosmetic tools'), 'Visible account copy must not advertise hidden cosmetics UI');

['graphite', 'midnight', 'forest', 'light', 'obsidian', 'frost'].forEach(theme => {
    assert(launcherThemeJs.includes(`'${theme}'`), `Theme script must register ${theme}`);
    assert(new RegExp(`:root\\[data-theme="${theme}"\\]\\s*\\{`, 'i').test(launcherThemeCss), `Theme CSS must define ${theme}`);
});
assert(!matchCssRule('body::before').includes('var(--accent-soft)'), 'Launcher backdrop must not tint the main background with the active accent color');
assert(/:root\[data-density="compact"\]\s+header\s*\{[\s\S]*height:\s*58px;/.test(launcherThemeCss), 'Compact density must noticeably shorten the launcher header');
assert(/:root\[data-density="compact"\]\s+\.layout\s*\{[\s\S]*grid-template-columns:\s*226px minmax\(0, 1fr\);/.test(launcherThemeCss), 'Compact density must shrink the launcher sidebar');
assert(/:root\[data-density="compact"\]\s+\.nav-tab\s*\{[\s\S]*min-height:\s*32px;/.test(launcherThemeCss), 'Compact density must shrink navigation rows');
assert(/:root\[data-density="compact"\]\s+\.metric\s*\{[\s\S]*min-height:\s*60px;/.test(launcherThemeCss), 'Compact density must shrink metric cards');
assert(/:root\[data-density="compact"\]\s+\.settings-content \.feature-card,[\s\S]*min-height:\s*42px;/.test(launcherThemeCss), 'Compact density must shrink settings cards');

const bedwarsOrder = matchBlock(launcherHtml, /BEDWARS: \[/, /\]/);
assert(!bedwarsOrder.includes('anticheat'), 'Anti-cheat must not be in the default BedWars overlay order');
assert(launcherHtml.includes('.overlay-stat-cell.overlay-color-green'), 'Overlay stat color classes must override base stat cell color');
assert(launcherHtml.includes("if (number >= 1) return 'overlay-color-green';"), 'Low positive FKDR should be colored, not plain white');

assert(!/sendChat\(client,[^\n]*(?:HotkeyDebug|Current State)/.test(proxy), 'Debug commands must not emit proxy-generated in-game chat');
assert(!launcherJs.includes('Experimental tab stats'), 'Launcher change log must not call tabstats experimental');

assert(proxy.includes("require('./features/chat_triggers.js')"), 'Proxy should import the Chat Trigger feature module');
assert(/const chatTriggerManager = createChatTriggerManager\(\{[\s\S]*loadSettings: loadChatTriggerSettings[\s\S]*saveSettings: saveChatTriggerSettings/.test(proxy), 'Proxy should create a chat trigger manager with persisted launcher settings');
assert(/class ChatTriggerManager[\s\S]*handleCommand\(client, args = \[\], sendChat = \(\) => \{\}\)/.test(chatTriggerModule), 'Chat Trigger command handling should live in the feature module');
assert(/function normalizeChatTriggerList\(values\)[\s\S]*value\.length > 0 && value\.length <= MAX_CHAT_TRIGGER_LENGTH/.test(chatTriggerModule), 'Chat Trigger normalization should live in the feature module');
assert(/function findMatchingChatTrigger\(message = '', triggers = \[\]\)[\s\S]*sort\(\(a, b\) => String\(b\)\.length - String\(a\)\.length\)/.test(chatTriggerModule), 'Chat Trigger matching should prefer longer trigger phrases');
assert(/chatTriggerManager\.handleCommand\(client, args, sendChat\)/.test(proxy), 'Proxy should delegate /chattrigger commands to the feature module');
assert(/chatTriggerManager\.findMatching\(parsed\.message\)/.test(proxy), 'Overlay chat trigger matching should use the feature module');
assert(/triggers: chatTriggerManager\.getTriggers\(\)/.test(proxy), 'Social overlay classification should read triggers from the feature module');
assert(!proxy.includes('function normalizeChatTriggerList'), 'Chat Trigger normalization should not remain inline in proxy.js');
assert(!proxy.includes('function formatChatTriggerList'), 'Chat Trigger formatting should not remain inline in proxy.js');
assert(!proxy.includes('function findMatchingChatTrigger'), 'Chat Trigger matching should not remain inline in proxy.js');
assert(proxy.includes("require('./features/proxy_health.js')"), 'Proxy should import the Proxy Health feature module');
assert(/const proxyHealthMonitor = createProxyHealthMonitor\(\{[\s\S]*isEnabled: \(\) => proxyHealthWarningsEnabled[\s\S]*setEnabled: \(enabled\)[\s\S]*saveSettings: saveFeatureConfig[\s\S]*clearExpensiveQueues:[\s\S]*pauseExpensiveFeatures:/.test(proxy), 'Proxy should configure proxy health through explicit runtime callbacks');
assert(/class ProxyHealthMonitor[\s\S]*activateAutoThrottle\(reason, durationMs = this\.options\.throttleMs\)[\s\S]*this\.clearExpensiveQueues\(\)[\s\S]*this\.pauseExpensiveFeatures\(\)/.test(proxyHealthModule), 'Proxy Health throttle activation should live in the feature module');
assert(/sample\(\) \{[\s\S]*lag >= this\.options\.lagCriticalMs[\s\S]*this\.activateAutoThrottle\(`\$\{Math\.round\(lag\)\}ms event-loop delay`\)/.test(proxyHealthModule), 'Proxy Health event-loop sampling should live in the feature module');
assert(/renderStatus\(client, sendChat = \(\) => \{\}\)[\s\S]*panel\.toggleRow\('Protection', snapshot\.enabled, '\/proxyhealth on', '\/proxyhealth off'/.test(proxyHealthModule), '/proxyhealth command rendering should live in the feature module');
assert(/function isProxyAutoThrottleActive\(now = Date\.now\(\)\) \{[\s\S]*proxyHealthMonitor\.isAutoThrottleActive\(now\)/.test(proxy), 'Proxy auto-throttle checks should delegate to the feature module');
assert(/function proxyHealthSnapshot\(now = Date\.now\(\)\) \{[\s\S]*proxyHealthMonitor\.snapshot\(now\)/.test(proxy), 'Health endpoint snapshots should delegate to the feature module');
assert(/function handleProxyHealthCommand\(client, args\) \{[\s\S]*proxyHealthMonitor\.handleCommand\(client, args, sendChat\)/.test(proxy), '/proxyhealth should delegate to the feature module');
assert(!proxy.includes('const PROXY_HEALTH_SAMPLE_MS'), 'Proxy Health constants should not remain inline in proxy.js');
assert(!proxy.includes('const proxyHealthState'), 'Proxy Health state should not remain inline in proxy.js');
assert(!proxy.includes('function activateProxyAutoThrottle'), 'Proxy Health throttle activation should not remain inline in proxy.js');
assert(!proxy.includes("const { performance } = require('perf_hooks');"), 'Proxy Health performance timing should live in the feature module');
assert(!launcherHtml.includes('auto-gambler-enabled'), 'Retired Auto Gambler has no launcher control');
assert(!proxy.includes('createAutoGamblerSession'), 'Retired automation has no runtime packet hooks');
assert(proxy.includes('createGamblerGeorgeReminder'), 'George reminder remains available');
assert(proxy.includes("require('./features/minecraft_chat.js')"), 'Proxy should import shared Minecraft chat utilities');
assert(/function stripAnsi\(text\) \{[\s\S]*replace\(\/\\x1B\\\[\[0-\?\]\*\[ -\/\]\*\[@-~\]\/g, ''\)[\s\S]*replace\(\/\(\?:\\u00C2\?\\u00A7\|\\\\u00a7\|\\\\u00A7\)\[0-9A-FK-OR\]\/gi, ''\)/.test(minecraftChatModule), 'Shared stripAnsi should remove ANSI and Minecraft formatting codes');
assert(/function extractText\(jsonMsg\)[\s\S]*component\.with[\s\S]*component\.extra[\s\S]*stripAnsi\(read\(jsonMsg\)\)/.test(minecraftChatModule), 'Minecraft chat utility module should flatten visible JSON chat text');
assert(/function extractFormattedText\(jsonMsg\)[\s\S]*MINECRAFT_COLOR_NAME_TO_CODE[\s\S]*inheritedColor/.test(minecraftChatModule), 'Minecraft chat utility module should preserve formatted chat colors');
assert(/function resolveHypixelRank\([\s\S]*?getHypixelColor\(player\.rankPlusColor \|\| 'RED'\)[\s\S]*monthlyRankColor[\s\S]*MVP/.test(minecraftChatModule), 'Rank resolution should live in the Minecraft chat utility module and honour both rank colour fields');
assert(/function getRankedName\(player = \{\}\)[\s\S]*resolveHypixelRank\(player\)/.test(minecraftChatModule), 'Rank name formatting should go through the shared rank resolver');
assert(/YOUTUBER:[\s\S]*YOUTUBE/.test(minecraftChatModule), 'The rank table should cover the YouTube rank');
assert(!proxy.includes('function isMvpPlusPlusProfileData'), 'Nick-capability gating should not be MVP++-only in proxy.js');
assert(/function normalizeLegacyJsonComponent\(component\)[\s\S]*legacyTextToJsonComponent\(component\)[\s\S]*legacyComponentToSegments\(component\)/.test(minecraftChatModule), 'Legacy chat JSON normalization should live in the Minecraft chat utility module');
assert(/function sendChat\(client, message\)[\s\S]*client\.write\('chat', \{ message: msg, position: 0 \}\)/.test(minecraftChatModule), 'sendChat should live in the Minecraft chat utility module');
assert(/function sendActionBar\(client, message\)[\s\S]*client\.write\('chat', \{ message: msg, position: 2 \}\)/.test(minecraftChatModule), 'sendActionBar should live in the Minecraft chat utility module');
assert(!proxy.includes('function stripAnsi'), 'Minecraft formatting stripping should not remain inline in proxy.js');
assert(!proxy.includes('function extractText'), 'Minecraft text extraction should not remain inline in proxy.js');
assert(!proxy.includes('function getRankedName'), 'Ranked-name formatting should not remain inline in proxy.js');
assert(!proxy.includes('function sendChat'), 'Minecraft chat sending should not remain inline in proxy.js');
assert(!proxy.includes('showClickableChatInfo'), 'Proxy should not display clickable-message debug info in chat');
assert(!proxy.includes('collectClickableChatEvents'), 'Proxy should not scan clickable chat events for debug display');
assert(!proxy.includes('buildClickableChatInfoComponent'), 'Proxy should not build clickable debug chat components');

console.log('command surface/static UI checks passed');
