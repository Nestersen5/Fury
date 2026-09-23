'use strict';

const DEFAULT_VALUE_LIMIT = 96;

function stripFormatting(value = '') {
    return String(value || '')
        .replace(/\u00a7[0-9a-fk-or]/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function componentText(component) {
    if (typeof component === 'string') return component;
    if (Array.isArray(component)) return component.map(componentText).join('');
    if (!component || typeof component !== 'object') return '';

    let text = component.text === undefined ? '' : String(component.text);
    if (!text && component.translate) text = String(component.translate);
    if (Array.isArray(component.with)) text += component.with.map(componentText).join('');
    if (Array.isArray(component.extra)) text += component.extra.map(componentText).join('');
    return text;
}

function compactValue(value = '', limit = DEFAULT_VALUE_LIMIT) {
    const clean = String(value || '').replace(/\s+/g, ' ').trim();
    const max = Math.max(12, Number(limit) || DEFAULT_VALUE_LIMIT);
    return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
}

function collectClickableChatEvents(component, options = {}) {
    const limit = Math.max(1, Number(options.limit || 32) || 32);
    const events = [];
    const seen = new Set();

    const addEvent = (clickEvent, owner) => {
        if (!clickEvent || typeof clickEvent !== 'object') return;
        const action = String(clickEvent.action || '').trim();
        const value = String(clickEvent.value || '').trim();
        if (!action || !value) return;
        const label = stripFormatting(componentText(owner)) || 'clickable text';
        const key = `${action}\n${value}\n${label}`;
        if (seen.has(key)) return;
        seen.add(key);
        events.push({ action, value, label });
    };

    const walk = (node) => {
        if (!node || events.length >= limit) return;
        if (typeof node === 'string') return;
        if (Array.isArray(node)) {
            node.forEach(walk);
            return;
        }
        if (typeof node !== 'object') return;

        if (node.clickEvent) addEvent(node.clickEvent, node);
        if (Array.isArray(node.with)) node.with.forEach(walk);
        if (Array.isArray(node.extra)) node.extra.forEach(walk);
    };

    walk(component);
    return events;
}

function describeClickableEvent(event = {}, index = 0, options = {}) {
    const label = compactValue(event.label || 'clickable text', options.labelLimit || 34);
    const value = compactValue(event.value || '', options.valueLimit || DEFAULT_VALUE_LIMIT);
    return `${index + 1}. ${label} -> ${event.action} ${value}`;
}

function buildClickableChatInfoComponent(events = [], originalText = '', options = {}) {
    const list = (Array.isArray(events) ? events : []).filter(Boolean);
    if (!list.length) return null;

    const shown = list.slice(0, Math.max(1, Number(options.summaryLimit || 3) || 3));
    const summary = shown
        .map(event => `${event.action} ${compactValue(event.value, 40)}`)
        .join(' | ');
    const extraCount = list.length - shown.length;
    const summaryText = `${list.length} clickable${list.length === 1 ? '' : 's'}: ${summary}${extraCount > 0 ? ` | +${extraCount} more` : ''}`;
    const cleanOriginal = compactValue(stripFormatting(originalText), 160);
    const hover = [
        'Clickable chat inspector',
        'Passive only: nothing was clicked.',
        cleanOriginal ? `Message: ${cleanOriginal}` : '',
        '',
        ...list.map((event, index) => describeClickableEvent(event, index, {
            labelLimit: 80,
            valueLimit: 140
        }))
    ].filter(line => line !== '').join('\n');

    const hoverEvent = { action: 'show_text', value: hover };
    return {
        text: '',
        extra: [
            { text: '[ClickInfo] ', color: 'dark_gray', hoverEvent },
            { text: summaryText, color: 'gray', hoverEvent }
        ]
    };
}

module.exports = {
    stripFormatting,
    componentText,
    compactValue,
    collectClickableChatEvents,
    describeClickableEvent,
    buildClickableChatInfoComponent
};
