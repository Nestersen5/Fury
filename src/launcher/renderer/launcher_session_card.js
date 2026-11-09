'use strict';

// The exported image and launcher previews share this renderer. The layout is
// measured in card units and drawn at CARD_SCALE device pixels per unit so the
// shared PNG stays sharp. Bitmap glyph advances size every column and the card
// only grows past CARD_WIDTH when a value would not otherwise fit.
const {MINECRAFT_STAR_SYMBOL}=require('../../stats/format');
const COLORS = { gold: '#ffbf16', pink: '#ef36e9', red: '#ff3636', cyan: '#00e4ed', green: '#36f451', text: '#d1d2d5', white: '#f4f4f4',
    frame: '#22262b', background: '#171c20', panel: '#101113', rule: '#1f242a', dim: '#80868f', faint: '#4b5159', age: '#686b70' };
const {getWlrColor,getFkdrColor,getKdrColor}=require('../../stats/colors');
const RATIO_COLORS={wlr:getWlrColor,fkdr:getFkdrColor,kdr:getKdrColor,bblr:()=> 'e'};
const MINECRAFT_COLORS={'7':'#aaaaaa',a:'#55ff55','2':'#00aa00',e:'#ffff55','6':'#ffaa00','4':'#aa0000'};
const CARD_SCALE = 2, CARD_WIDTH = 780;
const SEGMENT_COLORS = ['#ffaa00', '#55ffff', '#ff55ff', '#55ff55', '#5555ff', '#ffff55', '#ff5555', '#00aaaa'];
const UNKNOWN_COLOR = '#555b63', OTHER_COLOR = '#9aa1ab', MAX_SEGMENTS = 8;
const MODE_LABELS = { eight_one: 'Solos', eight_two: 'Doubles', four_three: 'Threes', four_four: 'Fours', two_four: '4v4', unavailable: 'Unknown' };
// A few headline numbers per game, then the supporting counts in aligned rows.
const LAYOUTS = {
    BEDWARS: { hero: ['record', 'fkdr', 'winRate', 'stars'], rows: [['finals', 'finalDeaths', 'wlr'], ['kills', 'deaths', 'kdr'], ['beds', 'bedsLost', 'bblr']] },
    SKYWARS: { hero: ['record', 'kdr', 'winRate', 'kills'], rows: [['deaths', 'assists', 'wlr']] },
    DUELS: { hero: ['record', 'wlr', 'winRate', 'kdr'], rows: [['kills', 'deaths']] }
};
const DEFAULT_LAYOUT = { hero: ['record', 'winRate'], rows: [] };
function entryColor(mode,key,fallback){
    if(['wins','finals','kills','beds'].includes(key))return '#55ff55';
    if(['losses','finalDeaths','deaths','bedsLost'].includes(key))return '#ff5555';
    if(mode.mode!=='BEDWARS'||!RATIO_COLORS[key])return fallback;
    return MINECRAFT_COLORS[RATIO_COLORS[key](number(mode[key])).slice(-1)]||fallback;
}
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const count = value => number(value).toLocaleString('en-US');
const duration = value => { const min = Math.floor(number(value) / 60000); return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : min ? `${min}m` : `${Math.floor(number(value) / 1000)}s`; };
const date = value => new Date(value).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
const shortDate = value => new Date(value).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const time = value => new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
function relativeDate(value, now = new Date()) {
    const start = new Date(value), today = new Date(now);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(today.getTime())) return '';
    // Compare local calendar dates in UTC so daylight-saving changes don't lose a day.
    const from = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
    const to = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    if (from >= to) return from === to ? '(today)' : '';
    let months = (today.getFullYear() - start.getFullYear()) * 12 + today.getMonth() - start.getMonth();
    const anniversary = offset => {
        const lastDay = new Date(Date.UTC(start.getFullYear(), start.getMonth() + offset + 1, 0)).getUTCDate();
        return Date.UTC(start.getFullYear(), start.getMonth() + offset, Math.min(start.getDate(), lastDay));
    };
    if (anniversary(months) > to) months--;
    const days = Math.round((to - anniversary(months)) / 86400000);
    const parts = [];
    if (months) parts.push(`${months} month${months === 1 ? '' : 's'}`);
    if (days) parts.push(`${days} day${days === 1 ? '' : 's'}`);
    return `(${parts.join(' ')} ago)`;
}
let fontPromise;
const images = new Map();
function loadImage(src) {
    if (!images.has(src)) images.set(src, new Promise(resolve => {
        const img = new Image(); img.crossOrigin = 'anonymous';
        const timer = setTimeout(() => resolve(null), 2200);
        img.onload = () => { clearTimeout(timer); resolve(img); };
        img.onerror = () => { clearTimeout(timer); resolve(null); };
        img.src = src;
    }));
    return images.get(src);
}
async function font() {
    if (!fontPromise) fontPromise = loadImage('assets/session-card-font.png').then(img => {
        if (!img) throw new Error('The session card font could not be loaded.');
        const atlas = document.createElement('canvas'); atlas.width = atlas.height = 128;
        const ctx = atlas.getContext('2d'); ctx.drawImage(img, 0, 0);
        const pixels = ctx.getImageData(0, 0, 128, 128).data;
        const widths = Array.from({ length: 256 }, (_, code) => {
            if (code === 32) return 3;
            let edge = 0;
            for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) {
                if (pixels[(((code >> 4) * 8 + y) * 128 + (code % 16) * 8 + x) * 4 + 3] > 20) edge = Math.max(edge, x + 1);
            }
            return edge || 5;
        });
        return { atlas, widths, tinted: new Map() };
    });
    return fontPromise;
}
function stats(mode, fields) {
    const defs = [
        ['wins','Wins','green'], ['losses','Losses','white'], ['finals','Final kills','pink'], ['finalDeaths','Final deaths','white'],
        ['kills','Kills','pink'], ['deaths','Deaths','white'], ['beds','Beds broken','red'], ['bedsLost','Beds lost','white'], ['assists','Assists','pink'],
        ['wlr','WLR','gold'], ['fkdr','FKDR','gold'], ['kdr','KDR','gold'], ['bblr','BBLR','gold'], ['games','Games','green'], ['stars','Stars gained','cyan'], ['localStreak','Local streak','gold']
    ];
    return defs.filter(([key]) => Array.isArray(fields)
        ? fields.includes(key) || (mode.local && key === 'localStreak' && key in mode)
        : key in mode).map(([key,label,color]) => ({ key, label, color: entryColor(mode,key,COLORS[color]), value: ['wlr','fkdr','kdr','bblr','stars'].includes(key) ? `${key === 'stars' ? '+' : ''}${number(mode[key]).toFixed(2)}` : count(mode[key]) }));
}
// Splits the enabled stats into headline numbers and table rows.
function arrange(mode, entries) {
    const plan = LAYOUTS[mode.mode] || DEFAULT_LAYOUT, byKey = new Map(entries.map(e => [e.key, e])), used = new Set();
    const take = key => { const entry = byKey.get(key); if (entry) used.add(key); return entry; };
    let hero = [];
    for (const key of plan.hero) {
        if (key === 'record') {
            const wins = take('wins'), losses = take('losses');
            if (wins && losses) hero.push({ key: 'record', label: 'Wins - losses', wins, losses });
            else if (wins || losses) hero.push(wins || losses);
        } else if (key === 'winRate') {
            if ('winRate' in mode) { const rate = number(mode.winRate); hero.push({ key: 'winRate', label: 'Win rate', value: `${rate % 1 ? rate.toFixed(1) : rate.toFixed(0)}%`, color: COLORS.white }); }
        } else { const entry = take(key); if (entry) hero.push(entry); }
    }
    let rows = plan.rows.map(row => row.map(take).filter(Boolean)).filter(row => row.length);
    const rest = entries.filter(e => !used.has(e.key));
    if (!hero.length) {
        // Promote the first enabled stats when every headline stat is turned off.
        const promoted = [...rows.flat(), ...rest].slice(0, 4);
        hero = promoted;
        rows = rows.map(row => row.filter(e => !promoted.includes(e))).filter(row => row.length);
        rest.splice(0, rest.length, ...rest.filter(e => !promoted.includes(e)));
    }
    const columns = rows.length ? Math.max(2, ...rows.map(row => row.length)) : 3;
    for (let i = 0; i < rest.length; i += columns) rows.push(rest.slice(i, i + columns));
    return { hero, rows, columns: rows.length ? columns : 0 };
}
// The calendar chart counts games per day; every other card splits games by mode.
function chartFor(mode, overall, selected, calendar) {
    const days = calendar?.chart?.entries;
    if (days) {
        const list = days.map(day => {
            const dayMode = day.modes.find(m => m.mode === mode.mode);
            const value = selected ? (dayMode?.submodes?.find(m => m.id === selected.id) || (dayMode?.submodes?.length ? { games: 0 } : undefined)) : dayMode;
            return { id: day.id, label: day.label, future: day.future, games: Number.isFinite(value?.games) ? value.games : 0, missing: !day.future && (!value || !Number.isFinite(value.games)) };
        });
        const daySum = list.reduce((n, d) => n + d.games, 0);
        return { kind: 'days', title: 'Games by day', days: list, daySum, total: Math.max(daySum, Number.isFinite(mode.games) ? mode.games : 0), recorded: !Number.isFinite(mode.games) };
    }
    const breakdown = mode.breakdown || {};
    const entries = (breakdown.entries || []).filter(e => number(e.games) > 0 && !e.unavailableValue)
        .map(e => ({ id: e.id, label: MODE_LABELS[e.id] || e.label, games: number(e.games), unknown: Boolean(e.unknown) || e.id === 'unavailable' }));
    const known = entries.reduce((n, e) => n + e.games, 0), total = Math.max(known, number(breakdown.total) || number(overall.games));
    if (total > known && !entries.some(e => e.unknown)) entries.push({ id: 'unavailable', label: 'Unknown', games: total - known, unknown: true });
    if (!entries.length) return null;
    entries.sort((a, b) => (a.unknown - b.unknown) || b.games - a.games);
    return { kind: 'modes', title: selected ? `Games by mode (whole ${calendar ? 'period' : 'session'})` : 'Games by mode', entries, total };
}
// Keeps the bar readable: each part needs room for its number, so the
// smallest modes join one "other modes" part. The image description keeps all.
function barSegments(entries, selectedId, width, measure) {
    const known = entries.filter(e => !e.unknown), unknown = entries.filter(e => e.unknown);
    const fits = list => list.length <= MAX_SEGMENTS && list.reduce((n, e) => n + measure(count(e.games)) + 16, 0) + 3 * (list.length - 1) <= width;
    const build = keep => {
        let kept = known.slice(0, keep);
        const chosen = known.find(e => e.id === selectedId);
        if (chosen && keep && !kept.includes(chosen)) kept = [...kept.slice(0, keep - 1), chosen];
        const rest = known.filter(e => !kept.includes(e));
        const other = rest.length ? [{ id: 'other', label: `${rest.length} other modes`, games: rest.reduce((n, e) => n + e.games, 0), other: true }] : [];
        return [...kept, ...other, ...unknown];
    };
    for (let keep = known.length; keep > 0; keep--) {
        if (keep === known.length - 1) continue;
        const list = build(keep);
        if (fits(list)) return list;
    }
    return build(0);
}
// Dark digits on bright segments, white digits on dark ones.
function ink(hex) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.19 ? COLORS.panel : COLORS.white;
}
async function render(session, { mode: requestedMode, submode = 'overall', fields, avatar = true, skinAccount = session } = {}) {
    const f = await font();
    const symbols=await loadImage('assets/session-card-symbols.png');
    const overall = session.modes?.find(item => item.mode === requestedMode) || session.modes?.[0] || { label: 'Session', mode: 'SESSION' };
    const selected = overall.submodes?.find(item => item.id === submode);
    const calendar=session.calendar;
    const periodTitle=calendar?calendar.kind[0].toUpperCase()+calendar.kind.slice(1):'Session';
    const mode = selected ? { ...selected, label: `${overall.label} - ${selected.label}`, breakdown: overall.breakdown, ...('stars' in overall ? {stars: overall.stars} : {}) } : overall;
    const entries = stats(mode, fields);
    if(selected)entries.forEach(entry=>{if(entry.key==='stars')entry.label=calendar?'Full period stars':'Full session stars';if(entry.key==='games')entry.label=`${selected.label} games`;});
    const advance = (text, scale = 2) => [...String(text)].reduce((sum,c) => sum + (c===MINECRAFT_STAR_SYMBOL?8.5:((f.widths[c.charCodeAt(0)] || 5) + 1)) * scale, 0);
    const labelValue = entry => `${entry.label}: ${entry.value}`;
    const title = session.name || 'Unknown account';
    const showChart = !Array.isArray(fields) || !fields.includes('hideGamesByMode');
    const emptyText = entries.length ? '' : mode.local ? 'No stats recorded' : 'Stats unavailable';
    const chart = showChart ? chartFor(mode, overall, selected, calendar) : null;
    const gamesEntry = entries.find(e => e.key === 'games');
    // Games sit beside the chart (or in the subtitle) rather than taking a cell.
    const { hero, rows, columns } = arrange(mode, entries.filter(e => e.key !== 'games' || (!chart && entries.length === 1)));
    const inHero = hero.some(e => e.key === 'games');
    // Switching tabs changes the values, not the space reserved for them.
    // Scope labels such as "Full session stars" fit that space separately.
    const sizingLayouts = [overall, ...(overall.submodes || []).map(sub => ({ ...sub, ...('stars' in overall ? { stars: overall.stars } : {}) }))]
        .map(value => { const list = stats(value, fields); return arrange(value, list.filter(e => e.key !== 'games' || (!chart && list.length === 1))); });

    // Header text. The full timeline stays in the image description.
    const start = session.startedAt, finishedAt = session.endedAt || session.lastSeen, finishedDay = new Date(finishedAt);
    const crossesMidnight=finishedDay.toDateString()!==new Date(start).toDateString();
    const finishedText=`${crossesMidnight?`${finishedDay.toLocaleDateString('en-US',{month:'short',day:'numeric'})}, `:''}${time(finishedAt)}`;
    const timeline = calendar?`${calendar.sessionIds.length} sessions - ${duration(session.durationMs)} tracked - ${calendar.activeDays} active days`:`${selected?'Full session - ':''}Started: ${time(start)}   ${session.active ? 'Live' : `Finished: ${finishedText}`}   Duration: ${duration(session.durationMs)}`;
    const dateText = calendar?`${calendar.label.replace(/–/g,'-')} - ${calendar.timeZone}`:date(start), ageText = calendar?'':relativeDate(start);
    const dateLine = `${dateText}${ageText ? `  ${ageText}` : ''}`;
    const kind = calendar ? ({ daily: 'DAY', weekly: 'WEEK', monthly: 'MONTH' }[calendar.kind] || periodTitle.toUpperCase()) : 'SESSION';
    const live = session.active && !calendar;
    const tag = `${overall.label.toUpperCase()}${selected ? ` - ${selected.label.toUpperCase()}` : ''}`;
    let parts;
    if (calendar) {
        const n = calendar.sessionIds.length;
        parts = [[[calendar.label.replace(/–/g, '-'), COLORS.white]], [[`${count(n)} ${n === 1 ? 'session' : 'sessions'}`]], [[`${duration(session.durationMs)} played`]]];
        if (calendar.kind !== 'daily') parts.push([[`${count(calendar.activeDays)} active ${calendar.activeDays === 1 ? 'day' : 'days'}`]]);
    } else {
        parts = [[[shortDate(start), COLORS.white], ...(ageText ? [[` ${ageText}`, COLORS.age]] : [])]];
        if (session.active) parts.push([[`Started ${time(start)}`]], [[`${duration(session.durationMs)} so far`]]);
        else parts.push([[`${time(start)} - ${time(finishedAt)}`], ...(crossesMidnight ? [[' (next day)', COLORS.dim]] : [])], [[duration(session.durationMs)]]);
    }
    let partsWidth = parts.reduce((n, part, i) => n + (i ? 18 : 0) + part.reduce((w, [value]) => w + advance(value), 0), 0);
    if (gamesEntry && !chart && !inHero) {
        parts.push([[`${gamesEntry.value} ${number(mode.games) === 1 ? 'game' : 'games'}`]]);
        partsWidth += 18 + Math.max(...[overall, ...(overall.submodes || [])]
            .map(value => advance(`${count(value.games)} ${value.games === 1 ? 'game' : 'games'}`)));
    }

    // Geometry in card units.
    const P = 12, IN = 14, GAP = 10, AV = avatar ? 124 : 0, heroLeft = P + (avatar ? AV + GAP : 0);
    const HEAD = 88, HERO = hero.length ? 116 : 64, ROW = 30, GUTTER = 26;
    const valueOf = h => h.key === 'record' ? `${h.wins.value}-${h.losses.value}` : `${h.value}${h.key === 'stars' ? MINECRAFT_STAR_SYMBOL : ''}`;
    const heroReferences = hero.map(h => sizingLayouts.flatMap(layout => layout.hero.filter(entry => entry.key === h.key)));
    const heroNeed = scale => heroReferences.map((list, i) => Math.max(...list
        .map(entry => Math.max(advance(valueOf(entry), scale), advance(entry.label)))) + (i ? GUTTER : 0));
    const sum = list => list.reduce((a, b) => a + b, 0);
    const cellNeed = Math.max(0, ...sizingLayouts.flatMap(layout => layout.rows.flat()).map(e => advance(e.label) + advance(e.value) + 42));
    const width = Math.ceil(Math.max(CARD_WIDTH,
        advance(title, 3) + 32 + advance(`${overall.label.toUpperCase()} ${live ? ' LIVE' : kind}`) + 2 * (P + IN),
        partsWidth + 2 * (P + IN),
        sum(heroNeed(3)) + heroLeft + P + 2 * IN,
        columns * cellNeed + heroLeft + P + 2 * IN,
        emptyText ? advance(emptyText) + heroLeft + P + 2 * IN : 0));
    const heroWidth = width - heroLeft - P, tableH = rows.length ? rows.length * ROW + 16 : 0;
    const bodyY = P + HEAD + GAP, bodyH = HERO + (tableH ? tableH + GAP : 0);
    const barX = P + IN, barW = width - 2 * (P + IN), barH = 24;
    const segments = chart?.kind === 'modes' ? barSegments(chart.entries, selected?.id, barW, value => advance(value)) : [];
    let colorIndex = 0;
    segments.forEach(e => { e.color = e.unknown ? UNKNOWN_COLOR : e.other ? OTHER_COLOR : SEGMENT_COLORS[colorIndex++ % SEGMENT_COLORS.length]; });
    const legend = [];
    if (chart?.kind === 'modes') {
        let x = 0, line = 0;
        for (const e of segments) { const w = 16 + advance(e.label) + 24; if (x + w > barW && x) { line++; x = 0; } legend.push({ entry: e, x, line }); x += w; }
    }
    const legendLines = legend.length ? legend[legend.length - 1].line + 1 : 0;
    const dayTop = chart?.kind === 'days' && chart.days.length <= 7 ? 66 : 46, dayBarH = 44;
    const chartH = !chart ? 0 : chart.kind === 'modes' ? 76 + legendLines * 22 + 12 : dayTop + dayBarH + 38;
    const height = bodyY + bodyH + (chartH ? GAP + chartH : 0) + P;

    const canvas = document.createElement('canvas'); canvas.width = width * CARD_SCALE; canvas.height = height * CARD_SCALE;
    canvas.style.width = `${width}px`;
    const ctx = canvas.getContext('2d'); ctx.setTransform(CARD_SCALE, 0, 0, CARD_SCALE, 0, 0); ctx.imageSmoothingEnabled = false;
    const box = (x,y,w,h,color=COLORS.panel,radius=9) => { ctx.fillStyle=color; ctx.beginPath(); ctx.roundRect(x,y,w,h,radius); ctx.fill(); };
    const rule = (x, y, w, h) => { ctx.fillStyle = COLORS.rule; ctx.fillRect(Math.round(x), Math.round(y), w, h); };
    const text = (value,x,y,color=COLORS.text,scale=2) => {
        x=Math.round(x);y=Math.round(y);
        if (!f.tinted.has(color)) { const tint = document.createElement('canvas'); tint.width=tint.height=128; const tc=tint.getContext('2d');tc.drawImage(f.atlas,0,0);tc.globalCompositeOperation='source-in';tc.fillStyle=color;tc.fillRect(0,0,128,128);f.tinted.set(color,tint); }
        for(const char of String(value)) {
            if(char===MINECRAFT_STAR_SYMBOL&&symbols){
                const key='symbols:'+color;
                if(!f.tinted.has(key)){const tint=document.createElement('canvas');tint.width=tint.height=256;const tc=tint.getContext('2d');tc.drawImage(symbols,0,0);tc.globalCompositeOperation='source-in';tc.fillStyle=color;tc.fillRect(0,0,256,256);f.tinted.set(key,tint);}
                // U+272B from Minecraft's original Unicode atlas; 15px glyph,
                // rendered at half the ASCII scale just like the game font.
                ctx.drawImage(f.tinted.get(key),176,32,15,16,x,y,7.5*scale,8*scale);x+=8.5*scale;continue;
            }
            const raw=char.charCodeAt(0),code=raw<256?raw:63;ctx.drawImage(f.tinted.get(color),(code%16)*8,(code>>4)*8,8,8,x,y,8*scale,8*scale);x+=((f.widths[code]||5)+1)*scale;}
        return x;
    };
    const dot = (x, y) => { ctx.fillStyle = COLORS.faint; ctx.fillRect(Math.round(x), Math.round(y), 4, 4); };

    box(0,0,width,height,COLORS.frame,12);box(2,2,width-4,height-4,COLORS.background,11);
    // Header: who, which game, and when.
    box(P, P, width - 2 * P, HEAD);
    text(title, P + IN, P + 16, COLORS.gold, 3);
    let right = width - P - IN;
    if (live) { right -= advance('LIVE'); text('LIVE', right, P + 20, COLORS.green); right -= advance('  '); }
    else { right -= advance(kind); text(kind, right, P + 20, COLORS.dim); right -= advance(' '); }
    const tagScale = Math.min(2, (right - (P + IN + advance(title, 3) + 32)) / advance(tag, 1));
    text(tag, right - advance(tag, tagScale), P + 20 + (2 - tagScale) * 4, COLORS.text, tagScale);
    let lineX = P + IN;
    parts.forEach((part, i) => { if (i) { dot(lineX + 7, P + 62); lineX += 18; } for (const [value, color] of part) lineX = text(value, lineX, P + 56, color || COLORS.text); });

    if (avatar) {
        box(P, bodyY, AV, bodyH);
        const skins=require('./launcher_account_skin');
        const skin=await skins.body(skinAccount);
        if(skin){const h=Math.min(bodyH-28,210),w=skin.width/skin.height*h;ctx.drawImage(skin,P+(AV-w)/2,bodyY+(bodyH-h)/2,w,h);}
    }
    // Headline numbers share one size, the largest that fits the row.
    box(heroLeft, bodyY, heroWidth, HERO);
    if (hero.length) {
        const available = heroWidth - 2 * IN, scale = [5, 4, 3].find(s => sum(heroNeed(s)) <= available) || 3;
        const widths = heroNeed(scale), spare = (available - sum(widths)) / hero.length;
        let x = heroLeft + IN;
        hero.forEach((h, i) => {
            const vx = x + (i ? GUTTER : 0), vy = bodyY + 22 + (5 - scale) * 4;
            if (i) rule(x + (GUTTER - spare) / 2, bodyY + 22, 1, HERO - 44);
            if (h.key === 'record') { let nx = text(h.wins.value, vx, vy, h.wins.color, scale); nx = text('-', nx, vy, COLORS.faint, scale); text(h.losses.value, nx, vy, h.losses.color, scale); }
            else text(valueOf(h), vx, vy, h.color, scale);
            const labelSpace = widths[i] - (i ? GUTTER : 0), labelScale = Math.min(2, labelSpace / advance(h.label, 1));
            text(h.label, vx, bodyY + HERO - 32 + (2 - labelScale) * 4, COLORS.dim, labelScale);
            x += widths[i] + spare;
        });
    } else text(emptyText, heroLeft + IN, bodyY + 24, COLORS.dim);
    // Supporting numbers in an aligned table.
    if (rows.length) {
        const top = bodyY + HERO + GAP, columnW = (heroWidth - 2 * IN) / columns;
        box(heroLeft, top, heroWidth, tableH);
        rows.forEach((row, r) => {
            const y = top + 8 + r * ROW;
            if (r) rule(heroLeft + IN, y, heroWidth - 2 * IN, 1);
            row.forEach((entry, c) => {
                const x = heroLeft + IN + c * columnW + (c ? 12 : 4), end = heroLeft + IN + (c + 1) * columnW - 14;
                text(entry.label, x, y + 8, COLORS.dim);
                text(entry.value, end - advance(entry.value), y + 8, entry.color);
            });
            for (let c = 1; c < columns; c++) rule(heroLeft + IN + c * columnW, y + 6, 1, ROW - 12);
        });
    }
    let chartDescription = '';
    if (chart) {
        const cy = bodyY + bodyH + GAP;
        box(P, cy, width - 2 * P, chartH);
        const titleEnd = text(chart.title, barX, cy + 14);
        if (chart.kind === 'days' && chart.total > chart.daySum) { dot(titleEnd + 7, cy + 20); text(`${count(chart.total - chart.daySum)} not split by day`, titleEnd + 18, cy + 14, COLORS.dim); }
        const totalText = `${count(chart.total)} ${chart.kind === 'days' && chart.recorded ? 'recorded ' : ''}${chart.total === 1 ? 'game' : 'games'}`;
        text(totalText, barX + barW - advance(totalText), cy + 14);
        if (chart.kind === 'modes') {
            // One thick bar; every part keeps room for its number.
            const by = cy + 40, minimum = segments.map(e => advance(count(e.games)) + 16), shownTotal = sum(segments.map(e => e.games)) || 1;
            const flex = Math.max(0, barW - 3 * (segments.length - 1) - sum(minimum));
            const faded = e => Boolean(selected) && !e.unknown && e.id !== selected.id;
            let x = barX;
            segments.forEach((e, i) => {
                const w = i === segments.length - 1 ? barX + barW - x : Math.round(minimum[i] + flex * e.games / shownTotal);
                ctx.globalAlpha = faded(e) ? 0.3 : 1;
                box(x, by, w, barH, e.color, 5);
                const value = count(e.games);
                ctx.globalAlpha = faded(e) ? 0.6 : 1;
                text(value, x + (w - advance(value)) / 2 + 1, by + 5, faded(e) ? COLORS.text : ink(e.color));
                ctx.globalAlpha = 1; x += w + 3;
            });
            for (const { entry, x: lx, line } of legend) {
                const ly = by + barH + 14 + line * 22;
                ctx.globalAlpha = faded(entry) ? 0.45 : 1;
                box(barX + lx, ly + 2, 10, 10, entry.color, 2);
                text(entry.label, barX + lx + 16, ly, COLORS.text);
                ctx.globalAlpha = 1;
            }
            chartDescription = `${chart.title}: ${chart.entries.map(e => `${e.label}: ${e.games} (${(e.games / chart.total * 100).toFixed(1)}%)`).join(', ')}`;
        } else {
            const n = chart.days.length, cell = barW / n, base = cy + dayTop + dayBarH, max = Math.max(1, ...chart.days.map(d => d.games)), monthly = n > 7;
            chart.days.forEach((d, i) => {
                const w = Math.min(monthly ? 14 : 56, cell - 6), x = barX + i * cell + (cell - w) / 2, h = Math.max(4, Math.round(dayBarH * d.games / max));
                if (!d.future) {
                    if (d.games) box(x, base - h, w, h, COLORS.gold, 3); else box(x, base - 2, w, 2, COLORS.faint, 1);
                    if (!monthly && d.games) text(count(d.games), x + w / 2 - advance(count(d.games)) / 2, base - h - 20, COLORS.white);
                }
                // Monthly cards label each week start, and the last day when it has room.
                if (!monthly || i % 7 === 0 || (i === n - 1 && i % 7 >= 3)) text(d.label, barX + i * cell + cell / 2 - advance(d.label) / 2, base + 10, d.future ? COLORS.faint : COLORS.dim);
            });
            chartDescription = `${chart.title}: ${chart.days.map(d => `${monthly ? d.id : d.label}: ${d.future ? 'Future' : d.missing ? 'No recorded data' : `${d.games} ${d.games === 1 ? 'game' : 'games'}`}`).join(', ')}`;
        }
    }
    const description = [`${title}, ${mode.label} ${periodTitle.toLowerCase()}, ${dateLine}, ${timeline}`];
    if (entries.length) description.push(entries.map(labelValue).join(', '));
    if (emptyText) description.push(emptyText);
    if ('winRate' in mode) description.push(`Win rate: ${number(mode.winRate).toFixed(1)}%`);
    if (chartDescription) description.push(chartDescription);
    if (calendar) description.push(`${session.active ? 'In progress - ' : ''}Stats recorded by Fury`);
    canvas.setAttribute('aria-label', description.join('. '));
    const localDay=new Date(start),fileDate=[localDay.getFullYear(),String(localDay.getMonth()+1).padStart(2,'0'),String(localDay.getDate()).padStart(2,'0')].join('-');
    return { canvas, width, height, scale: CARD_SCALE, mode: mode.mode, filename: `Fury-${title}-${calendar?calendar.start:fileDate}-${mode.mode}${calendar?`-${calendar.kind}`:''}${selected?`-${selected.label}`:''}.png`, entries };
}
module.exports = { render, stats, duration, date, time, relativeDate, loadBitmapFont: font };
