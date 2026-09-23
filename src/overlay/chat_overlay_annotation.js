'use strict';

const { buildTagComponents, reportHover, formatTagBadges } = require('../stats/tagDisplay');

const {
    formatNametagTagValue,
    nametagTagCategory,
    nametagTagSourceColor,
    stripNametagIconGlyphs
} = require('./nametags.js');

const DEFAULT_CHAT_ANNOTATION_TIMEOUT_MS = 800;

function isLobbyChatAnnotationEligible({
    stateLabel,
    position = 0,
    annotationEnabled = true,
    socialEnabled = true,
    sourceEnabled = true
} = {}) {
    return stateLabel === 'LOBBY'
        && Number(position) !== 2
        && Boolean(annotationEnabled)
        && Boolean(socialEnabled)
        && Boolean(sourceEnabled);
}

function cleanChatText(value) {
    return String(value || '')
        .replace(/§[0-9a-fk-or]/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function isMinecraftName(value) {
    return /^[A-Za-z0-9_]{3,16}$/.test(String(value || ''));
}

function normalizeOwnName(value) {
    const clean = String(value || '').trim();
    return isMinecraftName(clean) ? clean.toLowerCase() : '';
}

function mentionsOwnName(message, ownNames = []) {
    const rawMessage = String(message || '');
    const normalizedMessage = rawMessage.toLowerCase();
    return ownNames
        .map(normalizeOwnName)
        .filter(Boolean)
        .some((name) => {
            const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`, 'i').test(rawMessage)) {
                return true;
            }
            // Long Minecraft names are specific enough that a fallback substring
            // catches common "nestersen??" / "@nestersen" / pasted-name cases
            // without making short names like "Ace" trigger constantly.
            return name.length >= 5 && normalizedMessage.includes(name);
        });
}

function classifySocialOverlayText(text, {
    triggers = [],
    matchTrigger = null,
    ownNames = [],
    blockedSenderTokens = []
} = {}) {
    const clean = cleanChatText(text);
    if (!clean) return null;
    const own = new Set(ownNames.map(normalizeOwnName).filter(Boolean));
    const blocked = new Set([
        'guild',
        'party',
        'officer',
        'from',
        'to',
        'team',
        'shout',
        'coop',
        ...blockedSenderTokens.map(value => String(value || '').toLowerCase())
    ]);
    const isOwn = name => own.has(String(name || '').toLowerCase());

    const directMessage = clean.match(
        /^From\s+(?:\[[^\]]+\]\s*)?([A-Za-z0-9_]{3,16})\s*:/i
    );
    if (directMessage && isMinecraftName(directMessage[1]) && !isOwn(directMessage[1])) {
        return { type: 'dm', sender: directMessage[1] };
    }

    const colonIndex = clean.indexOf(':');
    if (colonIndex <= 0) return null;
    const left = clean.slice(0, colonIndex);
    const message = clean.slice(colonIndex + 1).trim();
    if (!message) return null;
    const sender = (left.match(/[A-Za-z0-9_]{3,16}/g) || [])
        .reverse()
        .find(name => !blocked.has(name.toLowerCase()));
    if (!isMinecraftName(sender) || isOwn(sender)) return null;

    const mentioned = mentionsOwnName(message, [...own]);
    if (mentioned) return { type: 'mention', sender };

    if (typeof matchTrigger === 'function') {
        const custom = matchTrigger(message);
        return custom ? { type: 'trigger', sender, trigger: custom } : null;
    }

    const normalizedMessage = message.toLowerCase();
    const trigger = triggers
        .map(value => String(value || '').trim())
        .filter(Boolean)
        .sort((a, b) => b.length - a.length)
        .find(value => normalizedMessage.includes(value.toLowerCase()));
    return trigger ? { type: 'trigger', sender, trigger } : null;
}

function displayTagValue(value, source = '') {
    const category = nametagTagCategory(value);
    const displayValue = category
        ? formatNametagTagValue(value, { source })
        : stripNametagIconGlyphs(value);
    return String(displayValue || '')
        .replace(/§[0-9a-fk-or]/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function shortTagValue(value, maximumLength = 10, source = '') {
    const clean = displayTagValue(value, source)
        .replace(/[\[\]\(\)]/g, '')
        .trim();
    if (!clean) return '';
    const parts = clean.split(/[:\-\s]+/).filter(Boolean);
    const selected = parts[0]?.toLowerCase() === 'legacy' && parts[1]
        ? parts[1]
        : (parts[0] || clean);
    return selected.slice(0, maximumLength);
}

function compactOverlayTags(tags = []) {
    const result = [];
    const seen = new Set();
    (Array.isArray(tags) ? tags : []).forEach((tag) => {
        const source = String(tag?.source || '').toLowerCase();
        if (tag?.title === 'Urchin API Status') return;
        const prefix = source === 'urchin' ? 'U' : source === 'seraph' ? 'S' : '';
        const value = shortTagValue(tag?.value, 10, source);
        if (!prefix || !value) return;
        const key = `${prefix}:${value}`.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        result.push(`${prefix}:${value}`);
    });
    return result.slice(0, 2);
}

function formatLobbyChatAnnotation(row = {}, { fkdrColor = '§f' } = {}) {
    if (row.lookupFailed || row.isNicked) return '';
    const fkdr = Number(row?.stats?.fkdr);
    if (!Number.isFinite(fkdr)) return '';
    const tags = formatTagBadges(row.tags);
    const tagText = tags ? ` §8| ${tags}` : '';
    return ` §8[§fFKDR: ${fkdrColor}${fkdr.toFixed(2)}${tagText}§8]`;
}

function buildTagHoverText(tag = {}) {
    return reportHover(tag);
}

function buildOverlayTagComponents(tags = [], options = {}) {
    return buildTagComponents(tags, options);
}

function buildLobbyChatAnnotationComponent(row = {}, { fkdrColor = '§f', clickName = '' } = {}) {
    if (row.lookupFailed || row.isNicked) return null;
    const fkdr = Number(row?.stats?.fkdr);
    if (!Number.isFinite(fkdr)) return null;
    const tagComponents = buildOverlayTagComponents(row.tags, { clickName: clickName || row.name });
    const extras = [{ text: ` §8[§fFKDR: ${fkdrColor}${fkdr.toFixed(2)}` }];
    tagComponents.forEach((comp, idx) => {
        extras.push({ text: idx === 0 ? ' §8| ' : '§8|' });
        extras.push(comp);
    });
    extras.push({ text: '§8]' });
    return { text: '', extra: extras };
}

function appendChatComponent(component, suffix) {
    if (!suffix) return component;
    const suffixNode = typeof suffix === 'string' ? { text: suffix } : suffix;
    return {
        text: '',
        extra: [component, suffixNode]
    };
}

function annotateChatPacket(packet = {}, row = {}, options = {}) {
    let component;
    try {
        component = JSON.parse(packet.message);
    } catch (error) {
        return null;
    }
    const suffix = buildLobbyChatAnnotationComponent(row, options);
    if (!suffix) return null;
    return {
        ...packet,
        message: JSON.stringify(appendChatComponent(component, suffix))
    };
}

module.exports = {
    DEFAULT_CHAT_ANNOTATION_TIMEOUT_MS,
    isLobbyChatAnnotationEligible,
    classifySocialOverlayText,
    mentionsOwnName,
    shortTagValue,
    compactOverlayTags,
    formatLobbyChatAnnotation,
    buildTagHoverText,
    buildOverlayTagComponents,
    buildLobbyChatAnnotationComponent,
    appendChatComponent,
    annotateChatPacket
};
