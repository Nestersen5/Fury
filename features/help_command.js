'use strict';

const chat = require('./chat_controller.js');

const HELP_SECTIONS = [
    {
        title: 'Stats & Sessions',
        entries: [
            {
                label: '/stats',
                command: '/stats ',
                description: 'BedWars card with mode click-through.',
                variations: ['/stats <player>', '/stats <player> solo', '/s <player> doubles'],
                startup: 'Player stat cards'
            },
            {
                label: '/sw',
                command: '/sw ',
                description: 'SkyWars card with mode click-through.',
                variations: ['/sw <player>', '/sw <player> solo_insane', '/sw <player> doubles_normal']
            },
            {
                label: '/duels',
                command: '/duels ',
                description: 'Duels overview and per-mode cards.',
                variations: ['/duels <player>', '/duels <player> classic_1v1', '/duels <player> bridge_2v2', '/duels <player> nodebuff']
            },
            {
                label: '/general',
                command: '/general ',
                description: 'Network level, XP pace, rank, guild, and account info.',
                variations: ['/general <player>']
            },
            {
                label: '/daily /weekly /monthly /yearly',
                command: '/daily ',
                description: 'Session stats with BedWars/SkyWars mode previews.',
                variations: ['/daily <player> bw solo', '/weekly <player> sw solo_insane', '/monthly <player>']
            },
            {
                label: '/session',
                command: '/session',
                description: 'Your local session deltas, overall or per mode.',
                variations: ['/session', '/session start', '/session end', '/session bw solo', '/session history', '/session history 3', '/ses refresh'],
                startup: 'Session tracking and history'
            },
            {
                label: '/recap',
                command: '/recap',
                description: 'Re-show the recap card for your last finished game.',
                variations: ['/recap']
            },
            {
                label: '/clip',
                command: '/clip ',
                description: 'Mark the current moment of your game; shown in the /replay menu.',
                variations: ['/clip', '/clip <name>']
            },
            {
                label: '/reminder',
                command: '/reminder status',
                description: 'Monitor Slumber dust, NPC rewards, and Gambler George claim progress.',
                variations: ['/reminder on', '/reminder check', '/reminder test', '/reminder threshold 250', '/reminder daily', '/reminder daily on', '/reminder daily check', '/reminder george', '/reminder george on', '/reminder george claimed', '/reminder george cooldown'],
                startup: 'Slumber reminders'
            }
        ]
    },
    {
        title: 'Player Lookup',
        entries: [
            {
                label: '/info',
                command: '/info ',
                description: 'Ping, tags, and current Hypixel status.',
                variations: ['/info <player>']
            },
            {
                label: '/ping',
                command: '/ping ',
                description: 'Detailed Aurora ping history.',
                variations: ['/ping <player>']
            },
            {
                label: '/profile',
                command: '/profile',
                description: 'Browse built-in playstyle setups or save and swap your own.',
                variations: ['/profile list', '/profile competitive', '/profile save friends', '/profile diff competitive', '/profile bind friends bw']
            },
            {
                label: '/urchin /seraph',
                command: '/urchin ',
                description: 'External tag lookups.',
                variations: ['/urchin <player>', '/seraph <player>']
            },
            {
                label: '/partycheck',
                command: '/partycheck status',
                description: 'Save party split warnings on/off, or dismiss them for the current lobby. Test previews use test/stop.',
                variations: ['/partycheck on', '/partycheck off', '/partycheck status', '/partycheck dismiss', '/partycheck test', '/partycheck stop']
            },
            {
                label: '/po',
                command: '/po',
                description: 'Manually check every current party member locally; never broadcasts. Preview result styles with /po test.',
                variations: ['/po', '/po status', '/po test', '/po test caution', '/po test report']
            },
        ]
    },
    {
        title: 'Game & Overlay',
        entries: [
            {
                label: '/scan',
                command: '/scan',
                description: 'Analyze current game players.',
                variations: ['/scan'],
                startup: 'Current-game analysis'
            },
            {
                label: '/share',
                command: '/share',
                description: 'Broadcast tagged/nicked/threat players from your latest scan to party chat.',
                variations: [
                    '/share',
                    '/share tags',
                    '/share threats',
                    '/share nicks',
                    '/share all',
                    '/share auto on',
                    '/share auto off'
                ]
            },
            {
                label: '/overlay',
                command: '/overlay ',
                description: 'Switch scan output and threat thresholds.',
                variations: ['/overlay all', '/overlay threats', '/overlay off', '/overlay threat fkdr 2']
            },
            {
                label: '/ol',
                command: '/ol ',
                description: 'Manual launcher overlay rows.',
                variations: ['/ol add <player>', '/ol clear manual', '/ol clear all']
            },
            {
                label: '/tabstats',
                command: '/tabstats ',
                description: 'Core tab list stats inside active games.',
                variations: ['/tabstats on', '/tabstats off', '/tabstats status']
            },
            {
                label: '/nametags',
                command: '/nametags ',
                description: 'Show nick/tag/threat tags above enemy heads (Bedwars).',
                variations: ['/nametags on', '/nametags style acronyms|full', '/nametags status']
            },
            {
                label: '/chatstats /chattrigger',
                command: '/chatstats ',
                description: 'Lobby chat stat lines and social overlay triggers.',
                variations: ['/chatstats only mention', '/chatstats source trigger off', '/chattrigger list']
            },
            {
                label: '/lf',
                command: '/lf ',
                description: 'Mode-specific party-ad triggers for the Bed Wars lobby you are in.',
                variations: ['/lf fours', '/lf threes fours 4v4', '/lf off fours', '/lf off', '/lf status']
            },
            {
                label: '/autogambler',
                command: '/autogambler status',
                description: 'Automatically accepts the quest from gambler George.',
                variations: ['/autogambler on', '/autogambler false', '/autogambler status']
            },
            {
                label: '/dodge',
                command: '/dodge status',
                description: 'Auto-leave a pregame Bedwars lobby for configured tagged, nicked, or stat-threat players.',
                variations: ['/dodge on', '/dodge include nicks on', '/dodge threat fkdr 4', '/dodge cancel', '/cancel', '/c'],
                startup: 'Pregame threat dodge'
            },
            {
                label: '/autododgetest',
                command: '/autododgetest',
                description: 'Inject a fake tagged pregame chat line to test auto-dodge timing.',
                variations: ['/autododgetest', '/autododgetest FakePlayer', '/autododgetest FakePlayer anyone got party?']
            }
        ]
    },
    {
        title: 'Denicks & Settings',
        entries: [
            {
                label: '/denick',
                command: '/denick ',
                description: 'Manual, automatic party, stat, and exact-match denick lookup. Party choices appear after a BedWars game starts.',
                variations: ['/denick party', '/denick party test', '/denick party confirm', '/denick party choose <#>', '/denick add <nick> <realIGN>', '/denick finals <#> beds <#>', '/denick finalkill <name> beddestroy <name>'],
                startup: 'Nick mappings and party denick'
            },
            {
                label: '/alias',
                command: '/alias ',
                description: 'Custom display names for people you know. Keyed on the real IGN, so one entry covers them nicked or not.',
                variations: ['/alias add <realIGN> <name> [color]', '/alias remove <realIGN>', '/alias list', '/alias nametags on|off', '/alias chat on|off', '/alias tab on|off', '/alias showreal on|off'],
                startup: 'Custom names for friends'
            },
            {
                label: '/denickskin',
                command: '/denickskin ',
                description: 'Skin-owner denick lookup.',
                variations: ['/denickskin <player>']
            },
            {
                label: '/apikey',
                command: '/apikey ',
                description: 'Manage API keys and usage.',
                variations: ['/apikey hypixel <key>', '/apikey view', '/apikey usage'],
                startup: 'API key setup'
            },
            {
                label: '/apikill',
                command: '/apikill ',
                description: 'Pause external API requests while keeping local launcher traffic available.',
                variations: ['/apikill on', '/apikill off', '/apikill toggle', '/apikill status']
            },
            {
                label: '/proxyhealth',
                command: '/proxyhealth status',
                description: 'Proxy lag guard status and toggles.',
                variations: ['/proxyhealth status', '/proxyhealth on', '/proxyhealth off'],
                startup: 'Proxy diagnostics'
            },
            {
                label: '/fury',
                command: '/fury',
                description: 'Fury settings commands and guide. Visual controls are in the launcher.',
                variations: [
                    '/fury',
                    '/fury play',
                    '/fury safety',
                    '/fury social',
                    '/fury history',
                    '/fury system',
                    '/fury help',
                    '/fury help settings',
                    '/fury accent #a66bea'
                ]
            }
        ]
    }
];

function createHelpRow(entry) {
    const row = { text: '', extra: [] };
    row.extra.push({
        text: entry.label.split(' ')[0],
        color: 'aqua',
        underlined: false,
        clickEvent: { action: 'suggest_command', value: entry.command },
        hoverEvent: {
            action: 'show_text',
            value: [
                `\u00a7d\u00a7l${entry.label}`,
                `\u00a77${entry.description}`,
                '',
                ...(entry.variations || []).map(item => `\u00a78- \u00a7f${item}`),
                '',
                `\u00a7aClick to suggest: \u00a7e${entry.command}`
            ].join('\n')
        }
    });
    const summary = entry.summary || HELP_SUMMARIES[entry.command.trim()] || entry.description;
    row.extra.push(chat.text(`  ${summary}`, 'gray', {
        hoverEvent: chat.hover(entry.description)
    }));
    return row;
}

const HELP_CATEGORIES = ['stats', 'lookup', 'overlay', 'settings'];
const HELP_PAGE_SIZE = 6;
const HELP_SUMMARIES = {
    '/stats': 'BedWars stats', '/sw': 'SkyWars stats', '/duels': 'Duels stats',
    '/general': 'Network & account info', '/daily': 'Daily / weekly / monthly / yearly',
    '/session': 'Session tracking', '/recap': 'Last game recap', '/clip': 'Mark a replay moment',
    '/reminder status': 'Slumber reminders', '/info': 'Player status & tags',
    '/ping': 'Ping history', '/profile': 'Playstyle profiles',
    '/urchin': 'Urchin / Seraph tags', '/partycheck status': 'Party split warnings',
    '/po': 'Local party check', '/scan': 'Scan current players', '/share': 'Scan broadcasts',
    '/overlay': 'Visibility & threat rules', '/ol': 'Manual overlay players',
    '/tabstats': 'Tab list stats', '/nametags': 'Above-player stats',
    '/chatstats': 'Chat stats & triggers', '/autogambler status': 'Accept George quest',
    '/dodge status': 'Pregame auto dodge', '/autododgetest': 'Dodge timing preview',
    '/denick': 'Resolve nicked players', '/alias': 'Custom friend names',
    '/denickskin': 'Skin-owner lookup', '/apikey': 'API keys & usage',
    '/apikill': 'Pause API requests', '/proxyhealth status': 'Proxy lag guard',
    '/fury': 'Settings commands & guide'
};

function handleHelpCommand(client, sendChat, args = []) {
    const tokens = Array.isArray(args) ? args : String(args).trim().split(/\s+/);
    const requested = String(tokens[0] || 'stats').toLowerCase();
    const all = requested === 'all';
    let category = HELP_CATEGORIES.indexOf(requested);
    if (/^[1-4]$/.test(requested)) category = Number(requested) - 1;
    if (category < 0) category = 0;
    const section = HELP_SECTIONS[category];
    const pages = Math.max(1, Math.ceil(section.entries.length / HELP_PAGE_SIZE));
    const page = Math.min(pages, Math.max(1, Number.parseInt(tokens[1], 10) || 1));
    const panel = chat.clientPanel(client, sendChat);
    panel.title(all ? 'Help - all commands' : `Help  ${category + 1}/4`, section.title);
    panel.row(HELP_CATEGORIES.flatMap((name, index) => [
        ...(index ? [chat.text(' ')] : []),
        ...panel.pick(name[0].toUpperCase() + name.slice(1), !all && index === category,
            `/help ${name}`, HELP_SECTIONS[index].title)
    ]));
    if (all) {
        HELP_SECTIONS.forEach(group => {
            panel.section(group.title);
            group.entries.forEach(entry => sendChat(client, createHelpRow(entry)));
        });
    } else {
        section.entries.slice((page - 1) * HELP_PAGE_SIZE, page * HELP_PAGE_SIZE)
            .forEach(entry => sendChat(client, createHelpRow(entry)));
        panel.row([
            ...panel.action('Previous', `/help ${HELP_CATEGORIES[category]} ${page - 1}`,
                'Previous commands in this category.', { locked: page === 1 }),
            chat.text(`  ${page}/${pages}  `),
            ...panel.action('Next', `/help ${HELP_CATEGORIES[category]} ${page + 1}`,
                'More commands in this category.', { locked: page === pages }),
            chat.text(' '), ...panel.action('All', '/help all', 'Show the complete command list.')
        ]);
    }
    panel.row([chat.text('Hover: examples \u00b7 Click: fill chat', 'gray')]);
}

function getStartupCommandSummary() {
    const entries = HELP_SECTIONS
        .flatMap(section => section.entries)
        .filter(entry => entry.startup)
        .map(entry => `${entry.label} - ${entry.startup}`);
    return ['/help - Full in-game command guide', ...entries];
}

module.exports = {
    HELP_SECTIONS,
    HELP_CATEGORIES,
    HELP_PAGE_SIZE,
    createHelpRow,
    handleHelpCommand,
    getStartupCommandSummary
};
