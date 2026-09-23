'use strict';


const FURY_PAGES = Object.freeze([
    { key: 'home', label: 'Home' },
    { key: 'play', label: 'Play' },
    { key: 'safety', label: 'Safety' },
    { key: 'social', label: 'Social' },
    { key: 'history', label: 'History' },
    { key: 'system', label: 'System' },
    { key: 'help', label: '?' }
]);

const FURY_PAGE_ALIASES = Object.freeze({
    '': 'home',
    home: 'home',
    main: 'home',
    overview: 'home',
    status: 'home',
    play: 'play',
    game: 'play',
    gameplay: 'play',
    hud: 'play',
    display: 'play',
    safety: 'safety',
    guard: 'safety',
    protect: 'safety',
    protection: 'safety',
    social: 'social',
    chat: 'social',
    sharing: 'social',
    history: 'history',
    track: 'history',
    tracking: 'history',
    session: 'history',
    sessions: 'history',
    system: 'system',
    tools: 'system',
    advanced: 'system',
    help: 'help',
    commands: 'help',
    guide: 'help',
    '?': 'help'
});

const FURY_HELP_TOPICS = Object.freeze({
    play: {
        title: 'Play & display',
        description: 'Player information, scan output, and BedWars appearance.',
        entries: [
            { label: 'Tab stats', command: '/tabstats', description: 'Stats inside the multiplayer tab list.', examples: ['/tabstats on', '/tabstats tags off'] },
            { label: 'Nametags', command: '/nametags', description: 'Configurable stats above players.', examples: ['/nametags on', '/nametags threats prefix tag'] },
            { label: 'Scan overlay', command: '/overlay', description: 'Choose who appears and tune threat thresholds.', examples: ['/overlay threats', '/overlay threat fkdr 3'] },
            { label: 'Appearance', command: '/fury play', description: 'Accent, event labels, and scoreboard team colors.', examples: ['/fury accent #a66bea', '/fury set eventlabels off'] }
        ]
    },
    safety: {
        title: 'Safety',
        description: 'Pregame protection, nick resolution, and party checks.',
        entries: [
            { label: 'Auto Dodge', command: '/dodge', description: 'Leave risky BedWars pregames using your selected rules.', examples: ['/dodge delay 10', '/dodge include tagged on'] },
            { label: 'Denick', command: '/denick', description: 'Automatic and manual nickname resolution.', examples: ['/denick autoskin on', '/denick party'] },
            { label: 'Party overview', command: '/po status', description: 'Run local-only checks for current party members.', examples: ['/po', '/po status'] }
        ]
    },
    social: {
        title: 'Social',
        description: 'Sharing, lobby stat replies, and automatic overlay additions.',
        entries: [
            { label: 'Share', command: '/share', description: 'Broadcast selected scan findings to party chat.', examples: ['/share auto on', '/share include tagged,nicks'] },
            { label: 'Chat stats', command: '/chatstats status', description: 'Show local stats for mentions, DMs, and triggers.', examples: ['/chatstats only mention', '/chatstats source dm off'] },
            { label: 'Use Overlay', command: '/overlay', description: 'Mentions, DMs, and party invites follow Use Overlay.', examples: ['/fury set socialadds on', '/fury set socialadds off'] },
            { label: 'Chat triggers', command: '/chattrigger list', description: 'Maintain custom phrases that request stats.', examples: ['/chattrigger list', '/chattrigger add <phrase>'] },
            { label: 'Looking for', command: '/lf', description: 'Mode-specific party triggers for this lobby only.', examples: ['/lf threes fours', '/lf off fours', '/lf off'] }
        ]
    },
    history: {
        title: 'History',
        description: 'Sessions, recaps, goals, retention, and Slumber reminders.',
        entries: [
            { label: 'Sessions', command: '/session', description: 'Track local stat changes and browse saved sessions.', examples: ['/session start', '/session history'] },
            { label: 'Recaps', command: '/recap', description: 'Show the most recent game recap.', examples: ['/session recap on', '/recap'] },
            { label: 'Session setup', command: '/fury history', description: 'Set inactivity boundary, retention, layout, and goals.', examples: ['/fury set boundary 180', '/fury set goal wins 10'] },
            { label: 'Reminders', command: '/reminder status', description: 'Ender Dust, daily NPC, and Gambler George alerts.', examples: ['/reminder threshold 250', '/reminder daily on', '/reminder george on'] }
        ]
    },
    system: {
        title: 'System',
        description: 'Proxy safeguards, external APIs, profiles, and client identity.',
        entries: [
            { label: 'Health guard', command: '/proxyhealth status', description: 'Watch for lag and pause expensive work when needed.', examples: ['/proxyhealth on', '/proxyhealth status'] },
            { label: 'API access', command: '/apikill status', description: 'Temporarily pause outbound API requests.', examples: ['/apikill on', '/apikill off'] },
            { label: 'Profiles', command: '/profile', description: 'Save or swap complete playstyle configurations.', examples: ['/profile list', '/profile save friends'] },
            { label: 'Client identity', command: '/vanilla', description: 'Choose Hypixel integrations or restricted Lunar mods.', examples: ['/vanilla off', '/vanilla on'] },
            { label: 'API keys', command: '/apikey view', description: 'Check and manage provider credentials.', examples: ['/apikey view', '/apikey usage'] }
        ]
    },
    settings: {
        title: 'Direct settings',
        description: 'Values owned by the Fury menu itself.',
        entries: [
            { label: 'Accent', command: '/fury accent ', description: 'Set the in-game Fury prefix accent using #RRGGBB.', examples: ['/fury accent #a66bea'] },
            { label: 'Visual flags', command: '/fury play', description: 'Toggle event labels and scoreboard team colors.', examples: ['/fury set eventlabels on', '/fury set teamcolors off'] },
            { label: 'Social master', command: '/fury social', description: 'Enable or pause all automatic social overlay additions.', examples: ['/fury set socialadds on'] },
            { label: 'Session storage', command: '/fury history', description: 'Set boundary, retention, recap style, and goals.', examples: ['/fury set retention 100', '/fury set recapstyle detailed'] }
        ]
    },
    tabstats: {
        hidden: true,
        title: 'Tab Stats',
        description: 'Compact player data inside the multiplayer player list.',
        entries: [
            { label: 'Power', command: '/tabstats', description: 'Enable the feature or restore original player names.', examples: ['/tabstats on', '/tabstats off'] },
            { label: 'Game rules', command: '/tabstats', description: 'Set BedWars and SkyWars independently to on, off, or auto.', examples: ['/tabstats bw auto', '/tabstats sw off'] },
            { label: 'Columns', command: '/tabstats', description: 'Toggle kill ratio, win ratio, and Urchin/Seraph tags.', examples: ['/tabstats col kr on', '/tabstats col wr off', '/tabstats tags on'] },
            { label: 'Restore names', command: '/tabstats clear', description: 'Remove applied stat text without disabling your saved setup.', examples: ['/tabstats clear'] }
        ]
    },
    nametags: {
        hidden: true,
        title: 'Name Tags',
        description: 'Put selected stats before or after player names.',
        entries: [
            { label: 'Power', command: '/nametags', description: 'Enable the master name-tag overlay.', examples: ['/nametags on', '/nametags off'] },
            { label: 'Audiences', command: '/nametags', description: 'Configure teammates, threats, and everyone else separately.', examples: ['/nametags teammates on', '/nametags threats off'] },
            { label: 'Fields', command: '/nametags', description: 'Choose primary and fallback prefix/suffix stats for each audience.', examples: ['/nametags threats prefix tag', '/nametags others suffixfallback fkdr'] },
            { label: 'Data source', command: '/nametags', description: 'Prefer Urchin or Seraph when both provide tags.', examples: ['/nametags source urchin'] },
            { label: 'Maintenance', command: '/nametags refresh', description: 'Refresh data or restore original names immediately.', examples: ['/nametags refresh', '/nametags clear'] }
        ]
    },
    overlay: {
        hidden: true,
        title: 'Scan Overlay',
        description: 'Choose visible scan results, threat rules, and social additions.',
        entries: [
            { label: 'Visibility', command: '/overlay', description: 'Show everyone, threats only, or no automatic scan output.', examples: ['/overlay all', '/overlay threats', '/overlay off'] },
            { label: 'BedWars rules', command: '/overlay', description: 'Tune FKDR and star threat thresholds.', examples: ['/overlay threat fkdr 3.5', '/overlay threat stars 500'] },
            { label: 'SkyWars rules', command: '/overlay', description: 'Tune KDR, WLR, and level threat thresholds.', examples: ['/overlay threat kdr 2', '/overlay threat wlr 1', '/overlay threat swlevel 10'] },
            { label: 'Pregame chat', command: '/overlay', description: 'Toggle the separate pregame chat output.', examples: ['/overlay source pregame on', '/overlay source pregame off'] }
        ]
    },
    share: {
        hidden: true,
        title: 'Share',
        description: 'Broadcast selected scan findings with precise delivery rules.',
        entries: [
            { label: 'Automatic', command: '/share', description: 'Broadcast selected results after automatic scans.', examples: ['/share auto on'] },
            { label: 'Delivery', command: '/share', description: 'Choose chat, line style, and local recoloring.', examples: ['/share dest party', '/share style detailed', '/share color on'] },
            { label: 'Filters', command: '/share', description: 'Include tagged, nicked, and stat-threat players independently.', examples: ['/share include tagged off', '/share include tagged,nicks'] },
            { label: 'Manual send', command: '/share', description: 'Broadcast one category or preview locally.', examples: ['/share all', '/share threat', '/share preview'] }
        ]
    },
    dodge: {
        hidden: true,
        title: 'Auto Dodge',
        description: 'Leave risky BedWars pregames using configurable player rules.',
        entries: [
            { label: 'Power', command: '/dodge', description: 'Enable or disable automatic pregame leaving.', examples: ['/dodge on', '/dodge off'] },
            { label: 'Players', command: '/dodge', description: 'Use the All preset or independently include tags, nicks, and stat threats.', examples: ['/dodge preset custom', '/dodge include nicks on'] },
            { label: 'Delay', command: '/dodge', description: 'Wait 0-15 seconds before leaving so you can cancel.', examples: ['/dodge delay 8', '/dodge cancel'] },
            { label: 'Threat rules', command: '/dodge', description: 'Set the FKDR and star thresholds for stat threats.', examples: ['/dodge threat fkdr 5', '/dodge threat stars 700'] }
        ]
    },
    partyoverview: {
        hidden: true,
        title: 'Party Overview',
        description: 'Check your current party locally without sending a report to chat.',
        entries: [
            { label: 'Status', command: '/po status', description: 'View party roster status. Party checks are always enabled.', examples: ['/po status'] },
            { label: 'Run check', command: '/po', description: 'Inspect current members using stats and tag providers.', examples: ['/po'] },
            { label: 'Preview', command: '/po test all', description: 'Preview every result style without roster or API requests.', examples: ['/po test all'] },
            { label: 'Privacy', command: '/po status', description: 'Results stay local and are never sent to party or public chat.', examples: ['/po status'] }
        ]
    },
    denick: {
        hidden: true,
        title: 'Denick',
        description: 'Resolve nicked players and control how known identities appear.',
        entries: [
            { label: 'Automatic', command: '/denick', description: 'Toggle skin and stats matching independently.', examples: ['/denick autoskin on', '/denick autostats off'] },
            { label: 'Results', command: '/denick', description: 'Choose local notices, real-IGN replacement, name tags, and party broadcasts.', examples: ['/denick announcements on', '/denick nametags on', '/denick partyannounce off'] },
            { label: 'Manual mapping', command: '/denick add ', description: 'Save a nickname to real-IGN mapping yourself.', examples: ['/denick add <nick> <realIGN>', '/denickskin <nick>'] },
            { label: 'Search/review', command: '/denick party', description: 'Review party nicks or search by stats and cosmetics.', examples: ['/denick party', '/denick finals 100000'] }
        ]
    },
    chatstats: {
        hidden: true,
        title: 'Chat Stats',
        description: 'Print local stats when selected lobby conversations request them.',
        entries: [
            { label: 'Power', command: '/chatstats', description: 'Enable or pause all lobby stat replies.', examples: ['/chatstats on', '/chatstats off'] },
            { label: 'Sources', command: '/chatstats', description: 'Toggle mentions, direct messages, and saved chat triggers.', examples: ['/chatstats source dm off', '/chatstats source trigger on'] },
            { label: 'Presets', command: '/chatstats', description: 'Use only one source or restore all sources.', examples: ['/chatstats only mention', '/chatstats all'] }
        ]
    },
    reminders: {
        hidden: true,
        title: 'Reminders',
        description: 'Track Ender Dust, daily rewards, and Gambler George claim readiness.',
        entries: [
            { label: 'Ender Dust', command: '/reminder', description: 'Toggle alerts and choose a target from 1 to 300.', examples: ['/reminder on', '/reminder threshold 250'] },
            { label: 'Daily rewards', command: '/reminder', description: 'Toggle automatic alerts for ready NPC rewards.', examples: ['/reminder daily on'] },
            { label: 'Gambler George', command: '/reminder', description: 'Track the two-win bet and remind you to claim it.', examples: ['/reminder george on', '/reminder george claimed'] },
            { label: 'Refresh', command: '/reminder check', description: 'Refresh dust or daily rewards now.', examples: ['/reminder check', '/reminder daily check'] },
            { label: 'Preview', command: '/reminder test', description: 'Preview fake alert states without changing settings.', examples: ['/reminder test full'] }
        ]
    },
    proxyhealth: {
        hidden: true,
        title: 'Proxy Health',
        description: 'Detect event-loop lag and pause optional work while the proxy recovers.',
        entries: [
            { label: 'Protection', command: '/proxyhealth', description: 'Enable warnings and automatic throttling.', examples: ['/proxyhealth on', '/proxyhealth off'] },
            { label: 'Metrics', command: '/proxyhealth', description: 'Review current, smoothed, and peak event-loop delay.', examples: ['/proxyhealth status'] },
            { label: 'Response', command: '/proxyhealth', description: 'Critical lag temporarily pauses cosmetics, Tab Stats, and chat stats.', examples: ['/proxyhealth status'] }
        ]
    },
    vanilla: {
        hidden: true,
        title: 'Client Identity',
        description: 'Trade Hypixel-aware integrations for mods that require a vanilla brand.',
        entries: [
            { label: 'Hypixel mode', command: '/vanilla off', description: 'Keep Hypixel-aware Lunar integrations.', examples: ['/vanilla off'] },
            { label: 'Vanilla mode', command: '/vanilla on', description: 'Report a vanilla brand so restricted mods can work.', examples: ['/vanilla on'] },
            { label: 'Reconnect', command: '/vanilla', description: 'Reconnect after changing modes so the new brand is sent.', examples: ['/vanilla status'] }
        ]
    },
    autogambler: {
        hidden: true,
        title: 'Auto Gambler',
        description: 'Accept George the Gambler automatically after his exact prompt.',
        entries: [
            { label: 'Power', command: '/autogambler', description: 'Enable or disable automatic acceptance for this proxy session.', examples: ['/autogambler on', '/autogambler off'] },
            { label: 'Rule', command: '/autogambler', description: 'The watched prompt and sent command are fixed for safety.', examples: ['/autogambler status'] }
        ]
    },
    tag: {
        hidden: true,
        title: 'Player Tag',
        description: 'Build, review, and apply community tags for one player.',
        entries: [
            { label: 'Open', command: '/tag ', description: 'Open the builder for a player and load their current tags.', examples: ['/tag <player>'] },
            { label: 'Build', command: '/tag ', description: 'Pick a type, combine reason chips, and optionally type a custom reason.', examples: ['/tag type cheater', '/tag text <reason>'] },
            { label: 'Privacy', command: '/tag ', description: 'Choose whether your username is hidden and duplicate tags are overwritten.', examples: ['/tag hide on', '/tag overwrite on'] },
            { label: 'Apply/remove', command: '/tag ', description: 'Review before applying, or remove an existing tag with one click.', examples: ['/tag apply', '/tag remove <type>'] }
        ]
    }
});

function normalizeFuryPage(value, fallback = '') {
    const key = String(value || '').trim().toLowerCase().replace(/[_-]+/g, '');
    return FURY_PAGE_ALIASES[key] || fallback;
}

function onOff(enabled) {
    return enabled ? 'on' : 'off';
}

function createFuryMenu(options = {}) {
    const sendChat = options.sendChat;
    if (typeof sendChat !== 'function') throw new Error('createFuryMenu requires sendChat');
    function renderHelp(client, topic = '') {
        const selected = FURY_HELP_TOPICS[String(topic).toLowerCase()];
        sendChat(client, '\u00a7dFURY \u00bb \u00a77Settings are in the launcher. Use /help for commands.');
        if (selected) {
            sendChat(client, `\u00a7f${selected.title}`);
            selected.entries.forEach(entry => {
                sendChat(client, `\u00a7b${entry.command.trim()} \u00a77- ${entry.description}`);
                (entry.examples || []).forEach(example => sendChat(client, `\u00a77${example}`));
            });
        }
    }
    function render(client, page = 'home', snapshot = {}, details = {}) {
        if (normalizeFuryPage(page) === 'help') return renderHelp(client, details.topic);
        sendChat(client, '\u00a7dFURY \u00bb \u00a77In-game control panels have moved to the launcher. Commands still work; use /help.');
    }
    return { render, renderHelp };
}

module.exports = {
    FURY_PAGES,
    FURY_PAGE_ALIASES,
    FURY_HELP_TOPICS,
    normalizeFuryPage,
    createFuryMenu,
    onOff
};
