'use strict';

// Minecraft-protocol binary helpers (VarInt + length-prefixed strings) and
// generic printable-string utilities used for packet logging.

function printableAsciiPreview(buffer, max = 180) {
    return buffer
        .slice(0, max)
        .toString('latin1')
        .replace(/[^\x20-\x7E]/g, '.');
}

function extractPrintableStrings(buffer, minLength = 4, limit = 24) {
    const strings = [];
    let current = '';
    for (const byte of buffer) {
        if (byte >= 32 && byte <= 126) {
            current += String.fromCharCode(byte);
            continue;
        }
        if (current.length >= minLength) strings.push(current);
        current = '';
        if (strings.length >= limit) break;
    }
    if (current.length >= minLength && strings.length < limit) strings.push(current);
    return strings;
}

function readMinecraftVarInt(buffer, offset = 0) {
    let value = 0;
    let shift = 0;
    let cursor = offset;
    while (cursor < buffer.length && shift < 35) {
        const byte = buffer[cursor++];
        value |= (byte & 0x7F) << shift;
        if ((byte & 0x80) === 0) {
            return { value, bytesRead: cursor - offset, nextOffset: cursor };
        }
        shift += 7;
    }
    return null;
}

function decodeMinecraftString(buffer, offset = 0) {
    const lengthInfo = readMinecraftVarInt(buffer, offset);
    if (!lengthInfo) return null;
    const end = lengthInfo.nextOffset + lengthInfo.value;
    if (lengthInfo.value < 0 || end > buffer.length) return null;
    return {
        value: buffer.slice(lengthInfo.nextOffset, end).toString('utf8'),
        length: lengthInfo.value,
        bytesRead: end - offset,
        nextOffset: end
    };
}

module.exports = {
    printableAsciiPreview,
    extractPrintableStrings,
    readMinecraftVarInt,
    decodeMinecraftString
};
