'use strict';

const { BEDWARS_TAB_PHASES, normalizeBedwarsTabSettings } = require('./bedwarsTabSettings.js');

const FORMAT_CODES = /(?:\u00c2)?\u00a7[0-9a-fk-or]/gi;
const STYLE_KEYS = new Set([
    'color', 'bold', 'italic', 'underlined', 'strikethrough', 'obfuscated', 'font',
    'insertion', 'clickEvent', 'hoverEvent'
]);

function decodeComponent(value) {
    if (typeof value !== 'string') return value;
    const text = value.trim();
    if (!text.startsWith('{') && !text.startsWith('[')) return value;
    try { return JSON.parse(text); } catch { return value; }
}

function componentText(value) {
    const component = decodeComponent(value);
    if (typeof component === 'string') return component;
    if (Array.isArray(component)) return component.map(componentText).join('');
    if (!component || typeof component !== 'object') return '';
    const own = typeof component.text === 'string' ? component.text
        : typeof component.translate === 'string' ? component.translate : '';
    return own + (Array.isArray(component.extra) ? component.extra.map(componentText).join('') : '');
}

function flattenRichText(value, inherited = {}, output = []) {
    const component = decodeComponent(value);
    if (typeof component === 'string') {
        output.push({ ...inherited, text: component });
        return output;
    }
    if (Array.isArray(component)) {
        component.forEach(child => flattenRichText(child, inherited, output));
        return output;
    }
    if (!component || typeof component !== 'object') return output;

    const style = { ...inherited };
    Object.keys(component).forEach(key => {
        if (STYLE_KEYS.has(key)) style[key] = component[key];
    });
    if (typeof component.text === 'string' && component.text) {
        output.push({ ...style, text: component.text });
    } else if (typeof component.translate === 'string') {
        output.push({ ...style, text: component.translate });
    }
    if (Array.isArray(component.extra)) {
        component.extra.forEach(child => flattenRichText(child, style, output));
    }
    return output;
}

function visibleLength(text) {
    return String(text || '').replace(FORMAT_CODES, '').length;
}

function rawIndexAtVisible(text, visibleOffset) {
    const source = String(text || '');
    let visible = 0;
    for (let index = 0; index < source.length;) {
        FORMAT_CODES.lastIndex = index;
        const code = FORMAT_CODES.exec(source);
        if (code && code.index === index) {
            index += code[0].length;
            continue;
        }
        if (visible >= visibleOffset) return index;
        visible++;
        index++;
    }
    return source.length;
}

function splitRichTextAtVisibleOffset(components, offset) {
    const before = [], after = [];
    let remaining = Math.max(0, Number(offset) || 0);
    for (const component of components) {
        const text = String(component.text || '');
        const length = visibleLength(text);
        if (remaining >= length) {
            before.push(component);
            remaining -= length;
            continue;
        }
        if (remaining <= 0) {
            after.push(component);
            continue;
        }
        const rawIndex = rawIndexAtVisible(text, remaining);
        if (rawIndex > 0) before.push({ ...component, text: text.slice(0, rawIndex) });
        if (rawIndex < text.length) after.push({ ...component, text: text.slice(rawIndex) });
        remaining = 0;
    }
    return { before, after };
}

function appendGeneratorRowToFooter(footer, stats, { settings = {}, elapsedMs = 0 } = {}) {
    if (footer === null || footer === undefined) return footer;
    const rows = buildBedwarsTabRows(stats, elapsedMs, settings);
    if (!rows.length) return footer;
    const components = flattenRichText(decodeComponent(footer));
    const text = components.map(part => part.text || '').join('').replace(FORMAT_CODES, '');
    const marker = text.toLowerCase().indexOf('beds broken');
    if (marker < 0) return footer;
    const lineEnd = text.indexOf('\n', marker);
    const insertionOffset = lineEnd < 0 ? text.length : lineEnd + 1;
    const { before, after } = splitRichTextAtVisibleOffset(components, insertionOffset);
    const row = [
        { text: lineEnd < 0 ? '\n\n' : '\n' }, ...rows,
        ...(after.length ? [{ text: '\n' }] : [])
    ];
    const result = { text: '', extra: [...before, ...row, ...after] };
    return typeof footer === 'string' ? JSON.stringify(result) : result;
}

function buildBedwarsTabRows(stats, elapsedMs, settings = {}) {
    const config = normalizeBedwarsTabSettings(settings);
    const output = [];
    if (config.tabResourcesEnabled) {
        for (const type of ['emerald', 'diamond']) {
            if (!config.tabResourceTypes.includes(type)) continue;
            if (output.length) output.push({ text: '  ', color: 'white' });
            output.push(
                { text: `${type === 'diamond' ? 'Diamonds' : 'Emeralds'} (`, color: type === 'diamond' ? 'aqua' : 'green' },
                { text: String(Math.max(0, Number(stats?.[`${type}s`]) || 0)), color: 'white' },
                { text: ')', color: type === 'diamond' ? 'aqua' : 'green' },
                { text: ': ', color: type === 'diamond' ? 'aqua' : 'green' },
                { text: String(Math.max(0, Number(stats?.[`${type}Seconds`]) || 0)), color: 'gray' }
            );
        }
    }
    if (config.tabPhasesEnabled) {
        const phases = BEDWARS_TAB_PHASES.filter(phase => config.tabPhaseTypes.includes(phase.id) && phase.atMs > elapsedMs);
        if (phases.length && output.length) output.push({ text: '\n\n' });
        phases.forEach((phase, index) => {
            if (index) output.push({ text: index % 2 ? '  |  ' : '\n', color: 'dark_gray' });
            const seconds = Math.ceil((phase.atMs - elapsedMs) / 1000);
            output.push(
                { text: `${phase.label}: `, color: phase.color },
                { text: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`, color: index === 0 ? 'yellow' : 'gray' }
            );
        });
    }
    return output;
}

// Production per generator. Each tier boundary spawns immediately and replaces
// the previous tier's next spawn; no entity, inventory or pickup state is used.
const DIAMOND_PHASES = [
    { first: 2000, interval: 30000, end: BEDWARS_TAB_PHASES[0].atMs },
    { first: BEDWARS_TAB_PHASES[0].atMs, interval: 23000, end: BEDWARS_TAB_PHASES[2].atMs },
    { first: BEDWARS_TAB_PHASES[2].atMs, interval: 12000, end: Infinity }
];
const EMERALD_PHASES = [
    { first: 32000, interval: 65000, end: BEDWARS_TAB_PHASES[1].atMs },
    { first: BEDWARS_TAB_PHASES[1].atMs, interval: 50000, end: BEDWARS_TAB_PHASES[3].atMs },
    { first: BEDWARS_TAB_PHASES[3].atMs, interval: 35000, end: Infinity }
];
const DIAMOND_SPAWN_DELAY_MS = 1000;

function productionAt(phases, elapsedMs) {
    let amount = 0;
    for (const phase of phases) {
        if (elapsedMs >= phase.end) {
            // The old phase excludes its end: the upgrade owns that instant.
            amount += Math.ceil((phase.end - phase.first) / phase.interval);
            continue;
        }
        if (elapsedMs < phase.first) {
            return { amount, seconds: Math.ceil((phase.first - elapsedMs) / 1000) };
        }
        const produced = Math.floor((elapsedMs - phase.first) / phase.interval) + 1;
        amount += produced;
        const next = Math.min(phase.first + produced * phase.interval, phase.end);
        return { amount, seconds: Math.ceil((next - elapsedMs) / 1000) };
    }
}

function getBedwarsGeneratorStats(elapsedMs) {
    const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
    const diamond = productionAt(DIAMOND_PHASES, elapsed - DIAMOND_SPAWN_DELAY_MS);
    const emerald = productionAt(EMERALD_PHASES, elapsed);
    return {
        diamonds: diamond.amount, emeralds: emerald.amount,
        diamondSeconds: diamond.seconds, emeraldSeconds: emerald.seconds
    };
}

module.exports = { getBedwarsGeneratorStats, appendGeneratorRowToFooter, buildBedwarsTabRows, componentText };
