'use strict';

// Team Lobby player board for the Overlay tab. The model builders are pure so
// they can be tested without a DOM; launcher.html supplies the stat text and
// prestige formatting it already owns.

const TEAM_ORDER = ['Red', 'Blue', 'Green', 'Yellow', 'Aqua', 'White', 'Pink', 'Gray'];
const TEAM_COLORS = { Red: 'red', Blue: 'blue', Green: 'green', Yellow: 'yellow', Aqua: 'aqua', White: 'white', Pink: 'pink', Gray: 'gray' };
const UNKNOWN_GROUP = 'Unknown';
const ADDED_GROUP = 'Added';
const LIST_GROUP = 'Players';
const NON_RANKING_STATS = new Set(['ping', 'tags']);
const MIN_ROW_HEIGHT = 34;
const MAX_ROW_HEIGHT = 58;
// Room for a star level and name before tags ellipsize; many columns scroll sideways instead.
const NAME_MIN_WIDTH = 160;
// Widest expected value per stat at the board's 12px Minecraft font.
const STAT_VALUE_WIDTHS = { fkdr: 46, wlr: 42, kdr: 42, bblr: 42, ws: 30, ping: 48, wins: 54, losses: 54, finals: 54, finalDeaths: 54, kills: 54, deaths: 54, beds: 54, bedsLost: 54, games: 54, assists: 54, level: 46 };

// Minecraft colors used for tag text; order matters (first match wins).
const TAG_TONES = [
    [/replay/i, 'yellow'],
    [/closet/i, 'dark-aqua'],
    [/blatant/i, 'dark-red'],
    [/sniper/i, 'red'],
    [/blacklist/i, 'red'],
    [/cheat/i, 'dark-aqua']
];

const SOURCE_MARKERS = {
    trigger: row => String(row.triggerWord || 'TRIGGER').trim().slice(0, 10).toUpperCase(),
    pregame: () => 'CHAT',
    dm: () => 'DM',
    party: () => 'INVITE',
    mention: () => '@',
    manual: () => 'ADDED',
    proxyManual: () => 'ADDED'
};

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function canonicalTeam(value) {
    const text = String(value || '').trim().toLowerCase();
    if (text === 'cyan') return 'Aqua';
    if (text === 'grey') return 'Gray';
    return TEAM_ORDER.find(team => team.toLowerCase() === text) || null;
}

function numeric(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function rowSource(row = {}) {
    return String(row.rowSource || (row.manual ? 'proxyManual' : 'live'));
}

function isStatusTag(tag = {}) {
    return /api status/i.test(String(tag.title || '')) || /^api\b/i.test(String(tag.value || ''));
}

function playerTags(row = {}) {
    return (Array.isArray(row.tags) ? row.tags : []).filter(tag => tag && (tag.value || typeof tag === 'string'));
}

function isFlagged(row = {}) {
    return playerTags(row).some(tag => !isStatusTag(tag));
}

function hasHiddenStats(row = {}) {
    return Boolean(row.lookupFailed || (row.isNicked && !row.realName));
}

function statValue(row, key) {
    if (!key || hasHiddenStats(row)) return null;
    return numeric(row.stats?.[key]);
}

function primaryStat(order = []) {
    return order.find(key => !NON_RANKING_STATS.has(key)) || null;
}

function average(rows, key) {
    const values = rows.map(row => statValue(row, key)).filter(value => value !== null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function sameName(a, b) {
    return Boolean(a && b) && String(a).toLowerCase() === String(b).toLowerCase();
}

function groupKey(row, teamsView) {
    if (!teamsView) return LIST_GROUP;
    if (rowSource(row) !== 'live') return ADDED_GROUP;
    return canonicalTeam(row.team?.name) || UNKNOWN_GROUP;
}

function groupRank(key) {
    const index = TEAM_ORDER.indexOf(key);
    if (index >= 0) return index;
    return key === UNKNOWN_GROUP ? TEAM_ORDER.length : TEAM_ORDER.length + 1;
}

function sortPlayers(rows, primary) {
    return rows.slice().sort((a, b) => {
        const av = statValue(a, primary);
        const bv = statValue(b, primary);
        if (av === null && bv !== null) return 1;
        if (bv === null && av !== null) return -1;
        if (av !== null && bv !== null && av !== bv) return bv - av;
        return String(a.name || '').localeCompare(String(b.name || ''));
    });
}

// Groups rows into team cards (or one list card), ranks the real teams by the
// primary stat, and works out which card belongs to the viewer.
function buildBoardModel(rows = [], options = {}) {
    const mode = String(options.mode || 'BEDWARS').toUpperCase();
    const order = Array.isArray(options.order) ? options.order : [];
    const columns = order.filter(key => key !== 'tags');
    const primary = primaryStat(order);
    const teamsView = mode === 'BEDWARS' && options.view !== 'list';
    const account = String(options.account || '');
    const myTeamName = canonicalTeam(options.myTeam);

    const byKey = new Map();
    for (const row of rows) {
        const key = groupKey(row, teamsView);
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(row);
    }

    const groups = Array.from(byKey, ([key, members]) => {
        const team = TEAM_ORDER.includes(key) ? key : null;
        return {
            key,
            team,
            rows: sortPlayers(members, primary),
            strength: team ? average(members, primary) : null,
            flagged: members.filter(isFlagged).length,
            isMine: Boolean(team) && (team === myTeamName || members.some(row => sameName(row.name, account))),
            rank: null
        };
    }).sort((a, b) => groupRank(a.key) - groupRank(b.key));

    const ranked = groups.filter(group => group.team && group.strength !== null)
        .sort((a, b) => b.strength - a.strength);
    if (ranked.length >= 2) ranked.forEach((group, index) => { group.rank = index + 1; });

    const teamGroups = groups.filter(group => group.team);
    const mine = groups.find(group => group.isMine) || null;
    const opponents = mine ? rows.filter(row => !mine.rows.includes(row)) : rows;
    const lobbyAverage = average(rows, primary);
    const dangerAverage = primary === 'fkdr' ? average(opponents, 'fkdr') : null;

    return {
        mode,
        view: teamsView ? 'teams' : 'list',
        columns,
        primary,
        account,
        groups,
        summary: {
            players: rows.length,
            flagged: rows.filter(isFlagged).length,
            nicked: rows.filter(row => row.isNicked).length,
            teamCount: teamGroups.length,
            teamSize: teamGroups.reduce((size, group) => Math.max(size, group.rows.length), 0),
            lobbyAverage,
            danger: dangerAverage === null ? null : dangerLevel(dangerAverage),
            strongest: ranked.length >= 2 ? ranked[0] : null,
            rankedCount: ranked.length,
            mine
        }
    };
}

// Lobby danger follows opponents' average FKDR: one block per FKDR point.
function dangerLevel(fkdr) {
    const blocks = Math.max(fkdr > 0 ? 1 : 0, Math.min(10, Math.round(fkdr)));
    if (fkdr >= 10) return { blocks, label: 'EXTREME', tone: 'red' };
    if (fkdr >= 6) return { blocks, label: 'HIGH', tone: 'gold' };
    if (fkdr >= 3) return { blocks, label: 'MEDIUM', tone: 'yellow' };
    return { blocks, label: 'LOW', tone: 'green' };
}

function describeLobby(model, { gameActive = false } = {}) {
    const { summary } = model;
    const parts = [gameActive ? 'Live' : 'Waiting for a game', model.mode === 'SKYWARS' ? 'SkyWars' : 'BedWars'];
    if (summary.teamCount >= 2) parts.push(`${summary.teamCount} teams of ${summary.teamSize}`);
    parts.push(`${summary.players} player${summary.players === 1 ? '' : 's'}`);
    return parts.join(' · ');
}

// Same thresholds as the launcher's overlay FKDR colors.
function fkdrTone(value) {
    if (value === null) return 'gray';
    if (value >= 100) return 'dark-purple';
    if (value >= 50) return 'pink';
    if (value >= 30) return 'dark-red';
    if (value >= 20) return 'red';
    if (value >= 10) return 'gold';
    if (value >= 7) return 'yellow';
    if (value >= 5) return 'dark-green';
    if (value >= 1) return 'green';
    return 'gray';
}

function ratioTone(value) {
    if (value === null) return 'gray';
    if (value >= 5) return 'gold';
    if (value >= 3) return 'yellow';
    if (value >= 1) return 'green';
    return 'white';
}

function pingTone(value) {
    if (value === null || value <= 0) return 'gray';
    if (value < 80) return 'green';
    if (value < 140) return 'yellow';
    return 'red';
}

function statTone(row, key) {
    const value = key === 'ping' ? numeric(row.ping) : statValue(row, key);
    if (key === 'ping') return pingTone(value);
    if (value === null) return 'gray';
    if (key === 'fkdr') return fkdrTone(value);
    if (['wlr', 'kdr', 'bblr'].includes(key)) return ratioTone(value);
    if (key === 'ws') return value >= 10 ? 'gold' : 'white';
    return 'white';
}

function strengthTone(model, value) {
    return model.primary === 'fkdr' ? fkdrTone(value) : ratioTone(value);
}

function tagTone(tag = {}) {
    if (isStatusTag(tag)) return 'dark-gray';
    const text = `${tag.value || tag} ${tag.reasons || ''}`;
    return (TAG_TONES.find(([pattern]) => pattern.test(text)) || [null, 'gold'])[1];
}

function tagTitle(tag = {}) {
    const lines = [`${tag.source || 'Tag'}: ${tag.value || tag}`];
    if (tag.reasons && !/no detailed tooltip/i.test(tag.reasons)) lines.push(tag.reasons);
    if (tag.addedBy && tag.addedBy !== 'Unknown') lines.push(`Added by ${tag.addedBy}${tag.when && tag.when !== 'Unknown' ? ` · ${tag.when}` : ''}`);
    return lines.join('\n');
}

function mc(tone, text, extra = '') {
    return `<span class="fury-mc-${tone}"${extra}>${text}</span>`;
}

function bracket(tone, label, title = '') {
    return mc(tone, `[${escapeHtml(label)}]`, title ? ` title="${escapeHtml(title)}"` : '');
}

function nameTone(row, model, group) {
    if (group.team) return TEAM_COLORS[group.team];
    const team = canonicalTeam(row.team?.name);
    if (rowSource(row) === 'live' && team) return TEAM_COLORS[team];
    return String(row.rankNameColorName || row.nameColorName || 'gray').replace(/_/g, '-').toLowerCase();
}

function suffixHtml(row, model) {
    const parts = [];
    if (sameName(row.name, model.account)) parts.push(bracket('gold', 'YOU'));
    const marker = SOURCE_MARKERS[rowSource(row)];
    if (marker) parts.push(bracket('gray', marker(row)));
    if (row.lookupFailed) parts.push(bracket('dark-gray', 'LOOKUP FAILED', row.lookupErrorMessage || ''));
    else if (row.isNicked && !row.realName) parts.push(bracket('aqua', 'NICK'));

    const tags = playerTags(row).slice().sort((a, b) => Number(isStatusTag(a)) - Number(isStatusTag(b)));
    if (tags.length) {
        parts.push(bracket(tagTone(tags[0]), String(tags[0].value || tags[0]).toUpperCase(), tagTitle(tags[0])));
        if (tags.length > 1) {
            parts.push(mc('dark-gray', `+${tags.length - 1}`, ` title="${escapeHtml(tags.slice(1).map(tagTitle).join('\n\n'))}"`));
        }
    }
    return parts.join(' ');
}

function headHtml(row) {
    const identity = row.realName || (row.isNicked ? '' : row.name);
    const image = identity
        ? `<img src="https://mc-heads.net/avatar/${encodeURIComponent(identity)}/32" alt="" width="32" height="32" loading="lazy" onerror="this.hidden=true">`
        : '';
    return `<span class="fury-board-head" aria-hidden="true">${image}</span>`;
}

function statCellHtml(row, key, helpers) {
    let text;
    if (key === 'ping') {
        const ping = numeric(row.ping);
        text = ping !== null && ping > 0 ? `${Math.round(ping)}ms` : '?';
    } else {
        text = helpers.statText(row, key);
    }
    const tone = statTone(row, key);
    const className = tone ? `fury-mc-${tone}` : helpers.statClass(row, key);
    return `<span class="fury-board-stat ${className}">${escapeHtml(text)}</span>`;
}

function removeButtonHtml(row, model) {
    if (!row?.name) return '<span></span>';
    return `<button type="button" class="fury-board-remove" title="Remove ${escapeHtml(row.name)} from overlay" aria-label="Remove ${escapeHtml(row.name)} from overlay"
        data-overlay-remove="${escapeHtml(row.name)}"
        data-overlay-remove-source="${escapeHtml(rowSource(row))}"
        data-overlay-remove-mode="${escapeHtml(String(row.mode || model.mode).toUpperCase() === 'SKYWARS' ? 'SKYWARS' : 'BEDWARS')}">×</button>`;
}

function playerRowHtml(row, model, group, helpers) {
    const level = helpers.levelHtml(row);
    const real = row.realName ? ` ${mc('dark-gray', '→')} ${mc('aqua', escapeHtml(row.realName))}` : '';
    const suffix = suffixHtml(row, model);
    return `<div class="fury-board-row" data-player="${escapeHtml(row.name || '')}">
        ${headHtml(row)}
        <span class="fury-board-player">${level ? `<span class="fury-board-level">${level}</span> ` : ''}${mc(nameTone(row, model, group), escapeHtml(row.name || 'Unknown'))}${real}${suffix ? ` ${suffix}` : ''}</span>
        ${model.columns.map(key => statCellHtml(row, key, helpers)).join('')}
        ${removeButtonHtml(row, model)}
    </div>`;
}

function meterHtml(blocks, tone) {
    return `<span class="fury-board-meter" aria-hidden="true">${Array.from({ length: 10 }, (_, index) => `<i${index < blocks ? ` class="fury-mc-bg-${tone}"` : ''}></i>`).join('')}</span>`;
}

const DANGER_BLOCK_TONES = ['green', 'green', 'green', 'yellow', 'yellow', 'gold', 'gold', 'red', 'red', 'dark-red'];

function dangerMeterHtml(blocks) {
    return `<span class="fury-board-meter" aria-hidden="true">${DANGER_BLOCK_TONES.map((tone, index) => `<i${index < blocks ? ` class="fury-mc-bg-${tone}"` : ''}></i>`).join('')}</span>`;
}

function groupHeading(group) {
    if (group.team) return mc(TEAM_COLORS[group.team], group.team.toUpperCase(), ' data-bold');
    if (group.key === ADDED_GROUP) return mc('gray', 'ADDED PLAYERS', ' data-bold');
    if (group.key === LIST_GROUP) return mc('white', 'ALL PLAYERS', ' data-bold');
    return mc('gray', 'NO TEAM YET', ' data-bold');
}

function cardHtml(group, model, helpers, statLabel) {
    const top = model.summary.strongest?.strength || 0;
    const left = [
        groupHeading(group),
        group.isMine ? bracket('gold', 'YOUR TEAM') : '',
        group.flagged ? mc('red', `${group.flagged} flagged`) : ''
    ].filter(Boolean).join(' ');
    const right = group.team && group.strength !== null
        ? [
            group.rank ? mc(group.rank === 1 ? 'gold' : 'gray', `#${group.rank}`) : '',
            top > 0 ? meterHtml(Math.max(1, Math.round(group.strength / top * 10)), strengthTone(model, group.strength)) : '',
            mc(strengthTone(model, group.strength), group.strength.toFixed(2)),
            mc('dark-gray', escapeHtml(statLabel))
        ].filter(Boolean).join(' ')
        : mc('dark-gray', `${group.rows.length} player${group.rows.length === 1 ? '' : 's'}`);
    return `<section class="fury-board-card${group.isMine ? ' is-mine' : ''}" data-group="${escapeHtml(group.key)}">
        <header class="fury-board-card-head"><span>${left}</span><span>${right}</span></header>
        <div class="fury-board-row fury-board-labels" aria-hidden="true">
            <span></span><span>Player</span>${model.columns.map(key => `<span>${escapeHtml(helpers.statLabel(key))}</span>`).join('')}<span></span>
        </div>
        ${group.rows.map(row => playerRowHtml(row, model, group, helpers)).join('')}
    </section>`;
}

function summaryHtml(model, helpers) {
    const { summary } = model;
    const label = model.primary ? helpers.statLabel(model.primary) : '';
    const items = [];
    if (summary.danger) {
        items.push(`${mc('muted', 'Lobby danger')} ${dangerMeterHtml(summary.danger.blocks)} ${mc(summary.danger.tone, summary.danger.label)}`);
    }
    items.push(`${mc('muted', 'Flagged')} ${mc(summary.flagged ? 'red' : 'green', String(summary.flagged))} ${mc('dark-gray', `/ ${summary.players}`)}`);
    items.push(`${mc('muted', 'Nicked')} ${mc(summary.nicked ? 'aqua' : 'green', String(summary.nicked))}`);
    if (summary.lobbyAverage !== null) {
        items.push(`${mc('muted', `Lobby ${escapeHtml(label)}`)} ${mc(strengthTone(model, summary.lobbyAverage), summary.lobbyAverage.toFixed(2))}`);
    }
    if (summary.strongest) {
        const strongest = summary.strongest;
        items.push(`${mc('muted', 'Strongest')} ${mc(TEAM_COLORS[strongest.team], strongest.team)} ${mc(strengthTone(model, strongest.strength), strongest.strength.toFixed(2))}`);
    }
    if (summary.mine?.rank) {
        items.push(`${mc('muted', 'Your team')} ${mc('gold', `#${summary.mine.rank}`)} ${mc('dark-gray', `of ${summary.rankedCount}`)}`);
    }
    return `<div class="fury-board-summary">${items.map(item => `<span>${item}</span>`).join('')}</div>`;
}

// Every row in every card shares one track list, so columns line up across cards.
function statColumnWidth(key, label) {
    const valueWidth = STAT_VALUE_WIDTHS[key] || 52;
    // Uppercase Minecraft glyphs plus word spacing run about 9px each at 12px.
    return Math.max(valueWidth, Math.ceil(String(label).length * 9));
}

function renderBoard(rows, options, helpers) {
    const model = buildBoardModel(rows, options);
    const statLabel = model.primary ? helpers.statLabel(model.primary) : '';
    const widths = model.columns.map(key => statColumnWidth(key, helpers.statLabel(key)));
    const template = ['24px', `minmax(${NAME_MIN_WIDTH}px,1fr)`, ...widths.map(width => `${width}px`), '16px'].join(' ');
    const minCard = 90 + NAME_MIN_WIDTH + widths.reduce((sum, width) => sum + width + 10, 0);
    return {
        model,
        html: `<div class="fury-board" data-view="${model.view}" style="--board-template:${template};--board-card-min:${minCard}px">
            ${summaryHtml(model, helpers)}
            <div class="fury-board-cards">${model.groups.map(group => cardHtml(group, model, helpers, statLabel)).join('')}</div>
        </div>`
    };
}

// Grow rows so the cards fill the visible board before it starts scrolling.
function fitBoard(container) {
    const board = container?.querySelector('.fury-board');
    const cardsElement = board?.querySelector('.fury-board-cards');
    if (!board || !cardsElement) return;
    board.style.setProperty('--board-row-height', `${MIN_ROW_HEIGHT}px`);
    const cards = Array.from(cardsElement.children).filter(card => card.offsetParent !== null);
    if (!cards.length) return;
    const spare = container.clientHeight - board.scrollHeight;
    if (spare <= 0) return;
    const perLine = Math.max(1, getComputedStyle(cardsElement).gridTemplateColumns.split(' ').filter(Boolean).length);
    let rowsToGrow = 0;
    for (let index = 0; index < cards.length; index += perLine) {
        rowsToGrow += Math.max(...cards.slice(index, index + perLine)
            .map(card => card.querySelectorAll('.fury-board-row[data-player]:not(.fury-filtered)').length));
    }
    if (!rowsToGrow) return;
    const height = Math.min(MAX_ROW_HEIGHT, MIN_ROW_HEIGHT + Math.floor(spare / rowsToGrow));
    board.style.setProperty('--board-row-height', `${height}px`);
}

module.exports = {
    TEAM_ORDER,
    canonicalTeam,
    primaryStat,
    buildBoardModel,
    dangerLevel,
    describeLobby,
    fkdrTone,
    tagTone,
    renderBoard,
    fitBoard
};
