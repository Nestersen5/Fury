'use strict';

// Generic string helpers — title-casing, log-safe truncation, lenient JSON.

// Preserves the runtime behavior of proxy.js, where two `titleCaseWords`
// declarations existed and the later one (underscore→space, capitalize word
// starts, no lowercase) shadowed the earlier one via function hoisting.
function titleCaseWords(value) {
    return String(value || '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

function truncateForLog(value, max = 1200) {
    const text = String(value ?? '');
    return text.length > max ? `${text.slice(0, max)}... [truncated ${text.length - max} chars]` : text;
}

function tryParseJsonText(text) {
    const clean = String(text || '').trim();
    if (!clean) return null;
    try {
        return JSON.parse(clean);
    } catch (e) {
        const start = clean.indexOf('{');
        const end = clean.lastIndexOf('}');
        if (start !== -1 && end > start) {
            try {
                return JSON.parse(clean.slice(start, end + 1));
            } catch {}
        }
    }
    return null;
}

module.exports = { titleCaseWords, truncateForLog, tryParseJsonText };
