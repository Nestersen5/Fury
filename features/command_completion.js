'use strict';

const { NAMETAG_STAT_TYPES } = require('../src/overlay/nametags.js');
const { FURY_HELP_TOPICS } = require('./fury_menu.js');
const { HELP_CATEGORIES, HELP_SECTIONS, HELP_PAGE_SIZE } = require('./help_command.js');

const PROXY_COMMANDS = [
    '/quickbuy', '/qb', '/hotbar', '/hb', '/quickbuyandhotbar', '/qbahb',
    '/stats', '/s', '/daily', '/weekly', '/monthly', '/yearly', '/reminder', '/reminders',
    '/session', '/ses', '/recap', '/clip',
    '/profile', '/profiles', '/preset', '/presets',
    '/info', '/general', '/ping', '/urchin', '/seraph', '/sw', '/duels',
    '/scan', '/share',
    '/ol', '/autogambler', '/chattrigger', '/chattriggers', '/ctriggers',
    '/chatstats', '/lobbychatstats', '/lf',
    '/autododge', '/dodge', '/cancel', '/c', '/autododgetest',
    '/partycheck',
    '/scanmode', '/scanconfig', '/overlay',
    '/tabstats', '/tabliststats',
    '/nametags', '/nametag',
    '/a', '/t', '/threat', '/o',
    '/denick', '/denickskin', '/alias',
    '/apikey', '/apikill', '/addtag', '/removetag', '/tag', '/proxyhealth', '/partyy', '/po', '/fury', '/help'
];

const HIDDEN_PROXY_COMMANDS = [
    '/tagdetails',
    '/deck', '/nesterdeck',
    '/cosmeticfx', '/cfx',
    '/activecosmetics',
    '/hotkeydebug',
    '/menudebug', '/guidebug', '/md', '/booktrace', '/kmlog',
    '/sharetags', '/st',
    '/deltag', '/untag',
    '/debugstate',
    '/teamdebug',
    '/potest',
    '/killapi',
    '/nester', '/proxy'
];

const SPECIAL_COSMETIC_VALUES = ['null', 'random', 'random cosmetic', 'random favorite cosmetic'];

// Canonical tag types accepted by /addtag, and reason phrases we tab-suggest.
// Reasons are free-form; these are just conveniences for tab completion.
const ADDTAG_TAG_TYPES = [
    'Closet Cheater',
    'Blatant Cheater',
    'Confirmed Cheater',
    'Caution',
    'Sniper',
    'Legit Sniper',
    'Account'
];
const ADDTAG_REASONS = [
    'Blink',
    'Autoblock',
    'Legit Scaffold',
    'Scaffold',
    'Scaffold (Double shifting)',
    'Fastmine',
    'Fastbreak',
    'Lagrange',
    'Auto bed defence',
    'Auto blockin',
    'Nuking',
    'Boosting',
    'Auto Clutch',
    'Auto fb deflect',
    'Fastplace',
    'Timer',
    'Aim assist',
    'Kb displacement'
];

// How many of the already-typed tokens (after the player name) form a COMPLETE
// tag_type. Returns null while the user is still mid-way through a multi-word tag.
function addTagTypeConsumed(committed) {
    if (committed.length === 0) return null;
    const isKnown = (phrase) => ADDTAG_TAG_TYPES.some(t => t.toLowerCase() === String(phrase || '').toLowerCase());
    if (committed.length >= 2 && isKnown(`${committed[0]} ${committed[1]}`)) return 2;
    if (isKnown(committed[0])) return 1;
    const isFirstWordOfTwoWordTag = committed.length === 1 && ADDTAG_TAG_TYPES.some((t) => {
        const words = t.split(' ');
        return words.length === 2 && words[0].toLowerCase() === String(committed[0] || '').toLowerCase();
    });
    if (isFirstWordOfTwoWordTag) return null;
    return 1;
}

function defaultNormalizeCosmeticKey(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function splitTabText(rawText) {
    const text = String(rawText || '').replace(/^\s+/, '');
    if (!text) return [];
    const trailing = /\s$/.test(text);
    const parts = text.trimEnd().split(/\s+/);
    if (trailing) parts.push('');
    return parts;
}

function uniqueTabMatches(values, limit = 15) {
    const seen = new Set();
    const matches = [];
    values.forEach((value) => {
        const text = String(value || '').trim();
        if (!text) return;
        const key = text.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        matches.push(text);
    });
    return matches.slice(0, limit);
}

function mapGet(mapLike, key) {
    if (!mapLike) return undefined;
    if (typeof mapLike.get === 'function') return mapLike.get(key);
    return mapLike[key];
}

function createProxyTabCompleter(options = {}) {
    const normalizeCosmeticKey = typeof options.normalizeCosmeticKey === 'function'
        ? options.normalizeCosmeticKey
        : defaultNormalizeCosmeticKey;
    const knownPlayerNames = typeof options.knownPlayerNames === 'function' ? options.knownPlayerNames : () => [];
    const visibleModeDefs = typeof options.visibleModeDefs === 'function' ? options.visibleModeDefs : () => [];
    const normalizeGame = typeof options.normalizeGame === 'function' ? options.normalizeGame : (value, fallback = null) => fallback;
    const normalizeCosmeticType = typeof options.normalizeCosmeticType === 'function' ? options.normalizeCosmeticType : () => null;
    const matchDenickCosmeticField = typeof options.matchDenickCosmeticField === 'function' ? options.matchDenickCosmeticField : () => null;
    const matchDenickStatField = typeof options.matchDenickStatField === 'function' ? options.matchDenickStatField : () => null;
    const chatTriggerManager = options.chatTriggerManager || { getTriggers: () => [] };

    function completeFromList(values, search = '', limit = 15) {
        const rawSearch = String(search || '').toLowerCase();
        const normalizedSearch = normalizeCosmeticKey(search);
        const matches = (values || []).filter((value) => {
            const text = String(value || '');
            if (!rawSearch && !normalizedSearch) return true;
            return text.toLowerCase().startsWith(rawSearch)
                || normalizeCosmeticKey(text).startsWith(normalizedSearch);
        });
        return uniqueTabMatches(matches, limit);
    }

    function completePlayers(search = '', limit = 15) {
        const query = String(search || '').toLowerCase();
        return uniqueTabMatches(
            knownPlayerNames()
                .filter(name => !query || String(name).toLowerCase().startsWith(query))
                .sort((a, b) => String(a).localeCompare(String(b))),
            limit
        );
    }

    function modeSuggestions(game) {
        return visibleModeDefs(game).map(mode => mode.short || mode.id);
    }

    function completeModes(game, search = '') {
        return completeFromList(modeSuggestions(game), search);
    }

    function completeGameModes(search = '') {
        return completeFromList(['bw', 'bedwars', 'sw', 'skywars'], search);
    }

    function cosmeticNamesForField(fieldKey) {
        if (fieldKey === 'beddestroy') return options.bedDestroyEffects || [];
        if (fieldKey === 'finalkill') return options.finalKillEffects || [];
        if (fieldKey === 'woodskin') return options.woodSkins || [];
        if (fieldKey === 'killmessage') return options.denickKillMessageNames || [];
        if (fieldKey === 'victorydance') return options.denickVictoryDanceNames || [];
        if (fieldKey === 'sprays') return options.denickSprayNames || [];
        if (fieldKey === 'islandtopper') return options.denickIslandTopperNames || [];
        if (fieldKey === 'deathcry') return options.denickDeathCryNames || [];
        if (fieldKey === 'npcskin') return options.denickShopkeeperSkinNames || [];
        if (fieldKey === 'glyph') return options.denickGlyphNames || [];
        if (fieldKey === 'figurine') return options.denickFigurineNames || [];
        if (fieldKey === 'projectiletrail') return options.denickProjectileTrailNames || [];
        return SPECIAL_COSMETIC_VALUES;
    }

    function denickCosmeticFieldSuggestions() {
        return uniqueTabMatches(
            Object.entries(options.denickCosmeticFields || {})
                .flatMap(([key, def]) => [key, ...((def && def.aliases) || [])]),
            50
        );
    }

    function denickFilterFieldSuggestions() {
        return uniqueTabMatches(['finals', 'beds', ...denickCosmeticFieldSuggestions()], 60);
    }

    function completeCosmeticNameList(fieldKey, search = '') {
        return completeFromList([...cosmeticNamesForField(fieldKey), ...SPECIAL_COSMETIC_VALUES], search);
    }

    function completeCosmeticSequence(args, startIndex = 1, allowedFields = null) {
        const current = args[args.length - 1] || '';
        const fields = denickCosmeticFieldSuggestions()
            .filter((field) => {
                if (!allowedFields) return true;
                const normalized = normalizeCosmeticKey(field);
                return allowedFields.includes(mapGet(options.denickCosmeticFieldByAlias, normalized) || normalized);
            });
        const fieldMatches = current ? completeFromList(fields, current) : [];

        let index = startIndex;
        let lastField = null;
        let valueTokensAfterLastField = 0;
        const currentIndex = Math.max(startIndex, args.length - 1);
        while (index < args.length) {
            const field = matchDenickCosmeticField(args, index);
            const fieldAllowed = field && (!allowedFields || allowedFields.includes(field.key));
            if (fieldAllowed && (!lastField || valueTokensAfterLastField > 0)) {
                lastField = { key: field.key, end: index + field.length };
                index += field.length;
                valueTokensAfterLastField = 0;
            } else {
                if (lastField) valueTokensAfterLastField += 1;
                index += 1;
            }
        }

        if (!lastField) return completeFromList(fields, current);

        const completeValueTokensBeforeCurrent = Math.max(0, currentIndex - lastField.end);
        if (fieldMatches.length && completeValueTokensBeforeCurrent > 0) return fieldMatches;
        if (!current && completeValueTokensBeforeCurrent > 0) return completeFromList(fields, current);

        const search = args.slice(lastField.end).join(' ').trim();
        return completeCosmeticNameList(lastField.key, search);
    }

    function completeDenickFilterSequence(args, startIndex = 1) {
        const current = args[args.length - 1] || '';
        const fields = denickFilterFieldSuggestions();
        const fieldMatches = current ? completeFromList(fields, current) : [];

        let index = startIndex;
        let lastField = null;
        let valueTokensAfterLastField = 0;
        const currentIndex = Math.max(startIndex, args.length - 1);
        while (index < args.length) {
            const stat = matchDenickStatField(args, index);
            const cosmetic = stat ? null : matchDenickCosmeticField(args, index);
            const field = stat
                ? { kind: 'stat', key: stat.key, length: stat.length }
                : (cosmetic ? { kind: 'cosmetic', key: cosmetic.key, length: cosmetic.length } : null);
            if (field && (!lastField || valueTokensAfterLastField > 0 || lastField.kind === 'stat')) {
                lastField = { kind: field.kind, key: field.key, end: index + field.length };
                index += field.length;
                valueTokensAfterLastField = 0;
            } else {
                if (lastField) valueTokensAfterLastField += 1;
                index += 1;
            }
        }

        if (!lastField) return completeFromList(fields, current);

        const completeValueTokensBeforeCurrent = Math.max(0, currentIndex - lastField.end);
        if (fieldMatches.length && completeValueTokensBeforeCurrent > 0) return fieldMatches;
        if (!current && completeValueTokensBeforeCurrent > 0) return completeFromList(fields, current);
        if (lastField.kind === 'stat') return [];

        const search = args.slice(lastField.end).join(' ').trim();
        return completeCosmeticNameList(lastField.key, search);
    }

    function completeDenickCommand(args) {
        const sub = (args[1] || '').toLowerCase();
        const toggleCommands = ['autoskin', 'autostats', 'announcements', 'showreal', 'nametags'];
        const controllerCommands = [...toggleCommands, 'partyannounce'];
        if (args.length === 2) {
            return completeFromList(['add', 'party', 'status', 'info', ...controllerCommands, ...denickFilterFieldSuggestions()], args[1]);
        }
        if (controllerCommands.includes(sub)) {
            return args.length === 3 ? completeFromList(['on', 'off'], args[2] || '') : [];
        }
        if (sub === 'party') {
            const partyAction = (args[2] || '').toLowerCase();
            if (args.length === 3) return completeFromList(['review', 'confirm', 'choose', 'test', 'cancel'], args[2] || '');
            if (partyAction === 'test' && args.length === 4) return completeFromList(['one', 'two', 'three', 'mismatch'], args[3] || '');
            return [];
        }
        if (sub === 'add') {
            // A BedWars roster can produce both an observed nickname and a
            // resolved real IGN for multiple players. Do not apply the generic
            // 15-result UI cap here: every identity remembered for this game
            // must remain reachable from both /denick add arguments.
            if (args.length === 3) return completePlayers(args[2] || '', Number.MAX_SAFE_INTEGER);
            if (args.length === 4) return completePlayers(args[3] || '', Number.MAX_SAFE_INTEGER);
            return [];
        }
        return completeDenickFilterSequence(args, 1);
    }

    // Complete a phrase region word-by-word. On the first word we return the full
    // phrase (the client cleanly replaces the single partial token); once a word is
    // committed we return only the next word so multi-word phrases don't double-insert.
    // Note: because full phrases contain spaces, Tab-cycling through multiple matches
    // appends rather than replaces on the vanilla client — type a few more letters to
    // narrow to one match instead.
    function completePhraseRegion(phrases, committedWords, current) {
        if (committedWords.length === 0) return completeFromList(phrases, current);
        const prefix = committedWords.map(word => String(word || '').toLowerCase());
        const cur = String(current || '').toLowerCase();
        const suffixes = [];
        phrases.forEach((phrase) => {
            const words = String(phrase).split(' ');
            if (words.length <= prefix.length) return;
            for (let i = 0; i < prefix.length; i++) {
                if (words[i].toLowerCase() !== prefix[i]) return;
            }
            const nextWord = words[prefix.length];
            if (!cur || nextWord.toLowerCase().startsWith(cur)) suffixes.push(nextWord);
        });
        return uniqueTabMatches(suffixes);
    }

    function completeAddTagCommand(args) {
        if (args.length <= 2) return completePlayers(args[1] || '');
        const afterPlayer = args.slice(2);
        const current = afterPlayer[afterPlayer.length - 1] || '';
        const committed = afterPlayer.slice(0, -1);
        const consumed = addTagTypeConsumed(committed);
        if (consumed === null) return completePhraseRegion(ADDTAG_TAG_TYPES, committed, current);
        return completePhraseRegion(ADDTAG_REASONS, committed.slice(consumed), current);
    }

    function completeRemoveTagCommand(args) {
        if (args.length <= 2) return completePlayers(args[1] || '');
        const afterPlayer = args.slice(2);
        const current = afterPlayer[afterPlayer.length - 1] || '';
        const committed = afterPlayer.slice(0, -1);
        // Only a tag type follows the player (no reason). Suggest tag-type
        // words until a full type is committed, then nothing more.
        if (addTagTypeConsumed(committed) === null) {
            return completePhraseRegion(ADDTAG_TAG_TYPES, committed, current);
        }
        return [];
    }

    function completeSessionCommand(args) {
        if (args.length === 2) {
            return uniqueTabMatches([
                ...completePlayers(args[1] || '', 12),
                ...completeGameModes(args[1] || '')
            ]);
        }
        const game = normalizeGame(args[2], null) || normalizeGame(args[1], null) || 'BEDWARS';
        if (args.length === 3 && !normalizeGame(args[1], null)) return completeGameModes(args[2] || '');
        return completeModes(game, args[args.length - 1] || '');
    }

    function proxyTabMatches(rawText) {
        const raw = String(rawText || '');
        if (!raw.startsWith('/')) return null;
        const args = splitTabText(raw);
        if (!args.length) return null;
        const cmd = String(args[0] || '').toLowerCase();

        if (cmd === '/help' && args.length > 1) {
            if (args.length === 2) return completeFromList([...HELP_CATEGORIES, 'all'], args[1]);
            const category = HELP_CATEGORIES.indexOf(args[1].toLowerCase());
            if (category >= 0 && args.length === 3) {
                const pages = Math.ceil(HELP_SECTIONS[category].entries.length / HELP_PAGE_SIZE);
                return completeFromList(Array.from({ length: pages }, (_, index) => String(index + 1)), args[2]);
            }
            return [];
        }

        if (args.length === 1) {
            return completeFromList(
                PROXY_COMMANDS,
                cmd,
                40
            );
        }
        const visibleProxyCommand = PROXY_COMMANDS.includes(cmd);
        const hiddenProxyCommand = HIDDEN_PROXY_COMMANDS.includes(cmd);
        if (!visibleProxyCommand && !hiddenProxyCommand) return null;

        if (cmd === '/activecosmetics') return args.length === 2 ? completePlayers(args[1] || '') : [];
        if (cmd === '/hotkeydebug') {
            return args.length === 2
                ? completeFromList(['on', 'off', 'status', 'enable', 'disable'], args[1] || '')
                : [];
        }
        if (cmd === '/booktrace') {
            return args.length === 2 ? completeFromList(['start', 'stop', 'status', 'mark'], args[1] || '') : [];
        }
        if (cmd === '/kmlog') {
            return args.length === 2 ? completeFromList(['start', 'status', 'cancel', 'stop', 'help'], args[1] || '') : [];
        }
        if (['/hotbar', '/hb', '/quickbuyandhotbar', '/qbahb'].includes(cmd)) {
            if (args[1]?.toLowerCase() === 'preview' && args.length === 3) return [...completePlayers(args[2] || ''), ...completeFromList(['close'], args[2] || '')];
            if (['load', 'save'].includes(args[1]?.toLowerCase()) && args.length === 3) return completeFromList(options.layoutPresets?.(cmd) || [], args[2] || '');
            if (args[1]?.toLowerCase() === 'copy' && args.length === 3) return completePlayers(args[2] || '');
            return args.length === 2 ? [...new Set([...completeFromList(['save', 'load', 'list', 'cancel', 'help', 'copy', 'preview'], args[1] || ''), ...completePlayers(args[1] || '')])] : [];
        }
        if (cmd === '/quickbuy' || cmd === '/qb') {
            if (args[1]?.toLowerCase() === 'preview' && args.length === 3) return [...completePlayers(args[2] || ''), ...completeFromList(['close'], args[2] || '')];
            if (['load', 'save'].includes(args[1]?.toLowerCase()) && args.length === 3) return completeFromList(options.layoutPresets?.(cmd) || [], args[2] || '');
            if (args[1]?.toLowerCase() === 'copy' && args.length === 3) return completePlayers(args[2] || '');
            if (args[1]?.toLowerCase() === 'trace' && args.length === 3) {
                return completeFromList(['start', 'stop', 'status', 'mark'], args[2] || '');
            }
            return args.length === 2
                ? [...new Set([...completeFromList(['save', 'load', 'list', 'set', 'clear', 'test', 'trace', 'cancel', 'help', 'copy', 'preview'], args[1] || ''), ...completePlayers(args[1] || '')])]
                : [];
        }
        if (cmd === '/menudebug' || cmd === '/guidebug' || cmd === '/md') {
            if (args.length === 2) {
                return completeFromList(
                    ['on', 'off', 'status', 'chat', 'verbose', 'log', 'hold', 'dump', 'find', 'click', 'nav', 'close', 'clear', 'path', 'help'],
                    args[1] || ''
                );
            }
            const sub = String(args[1] || '').toLowerCase();
            if (args.length === 3 && ['chat', 'verbose', 'log', 'hold'].includes(sub)) {
                return completeFromList(['on', 'off'], args[2] || '');
            }
            if (args.length === 4 && sub === 'click') {
                return completeFromList(
                    ['left', 'right', 'shift', 'shiftright', 'middle', 'drop', 'dropstack', 'double', 'hotbar'],
                    args[3] || ''
                );
            }
            return [];
        }
        if (cmd === '/debugstate') return [];
        if (cmd === '/teamdebug') {
            if (args.length === 2) return completePlayers(args[1] || '');
            return args.length === 3
                ? completeFromList(['Red', 'Blue', 'Green', 'Yellow', 'Aqua', 'White', 'Pink', 'Gray'], args[2] || '')
                : [];
        }
        if (cmd === '/fury' || cmd === '/nester' || cmd === '/proxy') {
            const sub = String(args[1] || '').toLowerCase();
            if (args.length === 2) {
                return completeFromList(['home', 'play', 'safety', 'social', 'history', 'system', 'help', 'accent', 'set'], args[1] || '');
            }
            if ((sub === 'help' || sub === 'guide') && args.length === 3) {
                return completeFromList(Object.keys(FURY_HELP_TOPICS), args[2] || '');
            }
            if ((sub === 'accent' || sub === 'color' || sub === 'colour') && args.length === 3) {
                return completeFromList(['#a66bea', '#4385f5', '#16b8c8', '#38ba83', '#e5b35d', '#e46f45'], args[2] || '');
            }
            if (sub === 'set') {
                const setting = String(args[2] || '').toLowerCase().replace(/[_-]+/g, '');
                if (args.length === 3) {
                    return completeFromList(['eventlabels', 'teamcolors', 'socialadds', 'boundary', 'retention', 'recapstyle', 'goal'], args[2] || '');
                }
                if (['eventlabels', 'teamcolors', 'socialadds'].includes(setting) && args.length === 4) {
                    return completeFromList(['on', 'off'], args[3] || '');
                }
                if (setting === 'boundary' && args.length === 4) return completeFromList(['30', '60', '180', '360'], args[3] || '');
                if (setting === 'retention' && args.length === 4) return completeFromList(['0', '50', '100', '250', '1000'], args[3] || '');
                if (setting === 'recapstyle' && args.length === 4) return completeFromList(['compact', 'detailed', 'custom'], args[3] || '');
                if (setting === 'goal' && args.length === 4) return completeFromList(['wins', 'finals', 'games', 'minutes'], args[3] || '');
            }
            return [];
        }

        if (cmd === '/stats' || cmd === '/s') {
            if (args.length === 2) return completePlayers(args[1] || '');
            return completeModes('BEDWARS', args[2] || '');
        }
        if (cmd === '/duels') {
            if (args.length === 2) return completePlayers(args[1] || '');
            return completeFromList((options.duelsModeDefs || []).map(mode => mode.short || mode.id), args.slice(2).join('_'));
        }
        if (cmd === '/sw') {
            if (args.length === 2) return completePlayers(args[1] || '');
            return completeModes('SKYWARS', args.slice(2).join('_'));
        }
        if (cmd === '/daily' || cmd === '/weekly' || cmd === '/monthly' || cmd === '/yearly') return completeSessionCommand(args);
        if (cmd === '/session' || cmd === '/ses') {
            // /session [refresh] [bw|sw|duels] [mode]
            const tokens = args.slice(1);
            const leadingRefresh = String(tokens[0] || '').toLowerCase() === 'refresh';
            const scoped = leadingRefresh ? tokens.slice(1) : tokens;
            const search = args[args.length - 1] || '';

            if (scoped.length <= 1) {
                const controls = leadingRefresh ? [] : ['refresh', 'history', 'start', 'end', 'reset', 'recap', 'debug', 'on', 'off'];
                return uniqueTabMatches([
                    ...completeFromList(controls, search),
                    ...completeFromList(['bw', 'sw', 'duels'], search)
                ]);
            }
            const game = normalizeGame(scoped[0], null);
            if (!game) return [];
            if (game === 'DUELS') {
                return completeFromList((options.duelsModeDefs || []).map(mode => mode.short || mode.id), search);
            }
            return completeModes(game, search);
        }
        if (cmd === '/recap') return [];
        if (cmd === '/clip') return [];
        if (cmd === '/partycheck') return args.length === 2 ? completeFromList(['on', 'off', 'status', 'test', 'stop', 'dismiss'], args[1] || '') : [];
        if (cmd === '/po') {
            const sub = String(args[1] || '').toLowerCase();
            if (args.length === 2) return completeFromList(['status', 'test'], args[1] || '');
            if (args.length === 3 && (sub === 'test' || sub === 'preview')) {
                return completeFromList(['all', 'clear', 'report', 'caution', 'notice', 'unavailable', 'lookup'], args[2] || '');
            }
            return [];
        }
        if (cmd === '/potest') {
            return args.length === 2
                ? completeFromList(['all', 'clear', 'report', 'caution', 'notice', 'unavailable', 'lookup'], args[1] || '')
                : [];
        }
        if (cmd === '/profile' || cmd === '/profiles' || cmd === '/preset' || cmd === '/presets') {
            const sub = String(args[1] || '').toLowerCase();
            const presetNames = (options.presetNames ? options.presetNames() : []);
            if (args.length === 2) {
                return uniqueTabMatches([
                    ...completeFromList(['list', 'save', 'load', 'diff', 'delete', 'bind', 'unbind'], args[1] || ''),
                    ...completeFromList(presetNames, args[1] || '')
                ]);
            }
            if (args.length === 3 && ['load', 'apply', 'diff', 'delete', 'remove', 'bind', 'unbind', 'save'].includes(sub)) {
                return completeFromList(presetNames, args[2] || '');
            }
            if (args.length === 4 && sub === 'bind') {
                return completeFromList(['bw', 'sw', 'duels'], args[3] || '');
            }
            return [];
        }
        if (['/info', '/general', '/ping', '/urchin', '/seraph', '/denickskin'].includes(cmd)) {
            return args.length === 2 ? completePlayers(args[1] || '') : [];
        }
        if (cmd === '/ol') {
            if (args.length === 2) return completeFromList(['add', 'clear'], args[1] || '');
            if ((args[1] || '').toLowerCase() === 'add') return completePlayers(args[2] || '');
            if ((args[1] || '').toLowerCase() === 'clear') return completeFromList(['manual', 'triggers', 'dm', 'party', 'mentions', 'pregame', 'game', 'all'], args[2] || '');
            return [];
        }
        if (cmd === '/autogambler') {
            return args.length === 2 ? completeFromList(['on', 'off', 'status', 'info'], args[1] || '') : [];
        }
        if (cmd === '/chattrigger' || cmd === '/chattriggers' || cmd === '/ctriggers') {
            const sub = (args[1] || '').toLowerCase();
            if (args.length === 2) return completeFromList(['add', 'remove', 'list', 'clear'], args[1] || '');
            if (sub === 'remove' || sub === 'delete' || sub === 'del') return completeFromList(chatTriggerManager.getTriggers(), args.slice(2).join(' '));
            return [];
        }
        if (cmd === '/lf') {
            const lfModes = ['doubles', 'threes', 'fours', '4v4'];
            if (args.length === 2) return completeFromList([...lfModes, 'off', 'status'], args[1] || '');
            if ((args[1] || '').toLowerCase() === 'status') return [];
            const chosen = args.slice(1, -1).map(value => String(value || '').toLowerCase());
            return completeFromList(lfModes.filter(mode => !chosen.includes(mode)), args[args.length - 1] || '');
        }
        if (cmd === '/chatstats' || cmd === '/lobbychatstats') {
            const sub = (args[1] || '').toLowerCase();
            if (args.length === 2) return completeFromList(['on', 'off', 'status', 'source', 'only', 'all', 'mention', 'dm', 'trigger'], args[1] || '');
            if (sub === 'source' || sub === 'sources') {
                if (args.length === 3) return completeFromList(['mention', 'dm', 'trigger'], args[2] || '');
                if (args.length === 4) return completeFromList(['on', 'off'], args[3] || '');
            }
            if (sub === 'only') return args.length === 3 ? completeFromList(['mention', 'dm', 'trigger'], args[2] || '') : [];
            if (['mention', 'mentions', 'dm', 'dms', 'trigger', 'triggers'].includes(sub)) {
                return args.length === 3 ? completeFromList(['on', 'off'], args[2] || '') : [];
            }
            return [];
        }
        if (cmd === '/autododge' || cmd === '/dodge') {
            const sub = (args[1] || '').toLowerCase();
            if (args.length === 2) return completeFromList(['on', 'off', 'preset', 'delay', 'include', 'threat', 'cancel', 'status', 'info'], args[1] || '');
            if (sub === 'preset') {
                if (args.length === 3) return completeFromList(['all_on', 'custom'], args[2] || '');
            }
            if (sub === 'include') {
                if (args.length === 3) return completeFromList(['tagged', 'nicks', 'threats', 'all'], args[2] || '');
                if (args.length === 4) return completeFromList(['on', 'off'], args[3] || '');
            }
            if (sub === 'threat') {
                if (args.length === 3) return completeFromList(['fkdr', 'stars'], args[2] || '');
            }
            return [];
        }
        if (cmd === '/reminder' || cmd === '/reminders') {
            const sub = (args[1] || '').toLowerCase();
            if (args.length === 2) return completeFromList(['status', 'check', 'test', 'on', 'off', 'threshold', 'daily', 'george'], args[1] || '');
            if (sub === 'threshold' && args.length === 3) return completeFromList(['250', '275', '300'], args[2] || '');
            if ((sub === 'test' || sub === 'demo') && args.length === 3) return completeFromList(['below', 'threshold', 'full', 'waiting'], args[2] || '');
            if (['george', 'gambler', 'bet'].includes(sub) && args.length === 3) {
                return completeFromList(['status', 'on', 'off', 'claimed', 'accepted', 'cooldown'], args[2] || '');
            }
            if (sub === 'daily' && args.length === 3) return completeFromList(['on', 'off', 'check', 'status'], args[2] || '');
            return [];
        }
        if (cmd === '/cancel' || cmd === '/c') return [];
        if (cmd === '/autododgetest') return args.length === 2 ? completePlayers(args[1] || '') : [];
        if (cmd === '/scanmode' || cmd === '/scanconfig' || cmd === '/overlay') {
            const sub = (args[1] || '').toLowerCase();
            if (args.length === 2) return completeFromList(['all', 'threats', 'threat', 'off', 'status', 'info', 'source'], args[1] || '');
            if (sub === 'threat' || sub === 'threats') {
                if (args.length === 3) return completeFromList(['fkdr', 'star', 'stars', 'kdr', 'swkdr', 'wlr', 'swwlr', 'swlevel', 'tag'], args[2] || '');
                if ((args[2] || '').toLowerCase() === 'tag') return completeFromList(['yes', 'no', 'true', 'false', 'on', 'off'], args[3] || '');
            }
            if (sub === 'source') {
                if (args.length === 3) return completeFromList(['pregame'], args[2] || '');
                if (args.length === 4) return completeFromList(['on', 'off'], args[3] || '');
            }
            return [];
        }
        if (cmd === '/tabstats' || cmd === '/tabliststats') {
            const sub = (args[1] || '').toLowerCase();
            if (args.length === 2) return completeFromList(['on', 'off', 'status', 'info', 'bw', 'sw', 'tags', 'col', 'clear'], args[1] || '');
            if ((sub === 'bw' || sub === 'bedwars' || sub === 'sw' || sub === 'skywars') && args.length === 3) {
                return completeFromList(['on', 'off', 'auto'], args[2] || '');
            }
            if (sub === 'tags' && args.length === 3) return completeFromList(['on', 'off'], args[2] || '');
            if ((sub === 'col' || sub === 'column' || sub === 'columns')) {
                if (args.length === 3) return completeFromList(['kr', 'wr'], args[2] || '');
                if (args.length === 4) return completeFromList(['on', 'off'], args[3] || '');
            }
            return [];
        }
        if (cmd === '/nametags' || cmd === '/nametag') {
            const sub = (args[1] || '').toLowerCase();
            const audiences = ['teammates', 'threats', 'others'];
            const slots = ['prefix', 'suffix'];
            if (args.length === 2) {
                return completeFromList(
                    ['on', 'off', 'status', 'refresh', 'clear', 'source', 'style', 'slot', ...audiences],
                    args[1] || ''
                );
            }
            if (sub === 'source' && args.length === 3) return completeFromList(['urchin', 'seraph'], args[2] || '');
            if (sub === 'style' && args.length === 3) return completeFromList(['acronyms', 'full'], args[2] || '');
            if (sub === 'slot') {
                if (args.length === 3) return completeFromList(audiences, args[2] || '');
                if (args.length === 4) return completeFromList([...slots, 'prefixfallback', 'suffixfallback'], args[3] || '');
                if (args.length === 5) return completeFromList(NAMETAG_STAT_TYPES, args[4] || '');
                return [];
            }
            if (audiences.includes(sub)) {
                if (args.length === 3) return completeFromList(['on', 'off', 'prefix', 'suffix', 'prefixfallback', 'suffixfallback'], args[2] || '');
                const action = (args[2] || '').toLowerCase();
                if (['prefix', 'suffix', 'prefixfallback', 'suffixfallback'].includes(action) && args.length === 4) {
                    return completeFromList(NAMETAG_STAT_TYPES, args[3] || '');
                }
            }
            return [];
        }
        if (cmd === '/proxyhealth') return args.length === 2 ? completeFromList(['on', 'off', 'status', 'enable', 'disable'], args[1] || '') : [];
        if (cmd === '/partyy') return args.length === 2 ? completeFromList(['status'], args[1] || '') : [];
        if (cmd === '/cosmeticfx' || cmd === '/cfx') {
            if (args.length === 2) return completeFromList(['status', 'list', 'record', 'notify', 'label', 'remove', 'info'], args[1] || '');
            const sub = String(args[1] || '').toLowerCase();
            if (args.length === 3 && sub === 'notify') return completeFromList(['on', 'off'], args[2] || '');
            if (args.length === 3 && sub === 'record') return completeFromList(['cancel'], args[2] || '');
            return [];
        }
        if (cmd === '/share' || cmd === '/sharetags' || cmd === '/st') {
            if (args.length === 2) return completeFromList(['tag', 'tags', 'threat', 'threats', 'nick', 'nicks', 'all', 'auto', 'include', 'dest', 'style', 'color', 'preview', 'status', 'info'], args[1] || '');
            const sub = (args[1] || '').toLowerCase();
            if (sub === 'auto' && args.length === 3) return completeFromList(['on', 'off'], args[2] || '');
            if ((sub === 'color' || sub === 'colour') && args.length === 3) return completeFromList(['on', 'off'], args[2] || '');
            if ((sub === 'dest' || sub === 'destination') && args.length === 3) return completeFromList(['party', 'all'], args[2] || '');
            if ((sub === 'style' || sub === 'format') && args.length === 3) return completeFromList(['compact', 'detailed'], args[2] || '');
            if (sub === 'include') {
                if (args.length === 3) return completeFromList(['tagged', 'nicks', 'threats', 'tagged,nicks', 'tagged,nicks,threats', 'all'], args[2] || '');
                if (args.length === 4) return completeFromList(['on', 'off'], args[3] || '');
            }
            return [];
        }
        if (cmd === '/denick') return completeDenickCommand(args);
        if (cmd === '/alias' || cmd === '/aliases' || cmd === '/customname') {
            if (args.length === 2) return completeFromList(['add', 'remove', 'list', 'nametags', 'chat', 'tab', 'showreal'], args[1] || '');
            const sub = String(args[1] || '').toLowerCase();
            if (['nametags', 'chat', 'tab', 'showreal'].includes(sub)) {
                return args.length === 3 ? completeFromList(['on', 'off'], args[2] || '') : [];
            }
            // add/remove take a real IGN, so complete against who is in the lobby.
            if (['add', 'set', 'remove', 'delete', 'del'].includes(sub)) {
                return args.length === 3 ? completePlayers(args[2] || '') : [];
            }
            return [];
        }
        if (cmd === '/apikey') return args.length === 2 ? completeFromList(['hypixel', 'urchin', 'urchinadmin', 'aurora', 'seraph', 'view', 'usage'], args[1] || '') : [];
        if (cmd === '/apikill' || cmd === '/killapi') return args.length === 2 ? completeFromList(['on', 'off', 'toggle', 'status'], args[1] || '') : [];
        if (cmd === '/addtag') return completeAddTagCommand(args);
        if (cmd === '/removetag' || cmd === '/deltag' || cmd === '/untag') return completeRemoveTagCommand(args);
        // /tag is a click-driven controller; only the player argument is typed.
        if (cmd === '/tag') return args.length <= 2 ? completePlayers(args[1] || '') : [];
        if (['/scan', '/a', '/t', '/threat', '/o', '/help'].includes(cmd)) return [];
        return [];
    }

    return proxyTabMatches;
}

module.exports = {
    PROXY_COMMANDS,
    HIDDEN_PROXY_COMMANDS,
    ADDTAG_TAG_TYPES,
    ADDTAG_REASONS,
    addTagTypeConsumed,
    splitTabText,
    uniqueTabMatches,
    createProxyTabCompleter
};
