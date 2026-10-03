'use strict';
const crypto = require('crypto');
const { simplifyNbt } = require('./menuMonitor');
const BOOK_IDS = new Set([386, 387]);

function describeBook(item) {
    if (!item || !BOOK_IDS.has(item.blockId)) return null;
    const data = simplifyNbt(item.nbtData) || {};
    const source = Array.isArray(data.pages) ? data.pages : [];
    const actions = [];
    const pages = source.slice(0, 128).map((value, index) => {
        const original = typeof value === 'string' ? value : JSON.stringify(value);
        const raw = original.slice(0, 16384);
        let component;
        try { component = JSON.parse(raw); } catch { component = raw; }
        function walk(node, depth = 0) {
            if (depth > 20 || node == null) return '';
            if (typeof node === 'string') return node;
            if (Array.isArray(node)) return node.map(v => walk(v, depth + 1)).join('');
            if (typeof node !== 'object') return '';
            if (node.clickEvent && typeof node.clickEvent.action === 'string') {
                actions.push({ page: index + 1, action: node.clickEvent.action, value: node.clickEvent.value });
            }
            return String(node.text || node.translate || '') + (node.extra ? walk(node.extra, depth + 1) : '');
        }
        return { page: index + 1, raw, text: walk(component), truncated: raw.length !== original.length };
    });
    const book = { itemId: item.blockId, title: data.title || null, author: data.author || null,
        generation: data.generation, pageCount: source.length, pages, actions,
        truncated: source.length > pages.length || pages.some(p => p.truncated) };
    return { id: crypto.createHash('sha256').update(JSON.stringify(book)).digest('hex').slice(0, 20), ...book };
}

module.exports = { describeBook };
