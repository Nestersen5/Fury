'use strict';

const { loadBitmapFont } = require('./launcher_session_card');
const { CHAT_WIDTH, chatCharWidth } = require('../../stats/recapScoreboard');
const { stripAnsi, MINECRAFT_LEGACY_PALETTE } = require('../../../features/minecraft_chat');
const previews = new WeakMap();
const COLORS = MINECRAFT_LEGACY_PALETTE.map(color => color.hex.slice(1));

function clear(container) { previews.delete(container); }

async function render(container, messages) {
    const lines = messages.map(message => typeof message === 'string' ? message : message.text);
    const signature = JSON.stringify(lines);
    if (previews.get(container)?.signature === signature) return;
    const pending = { signature };
    previews.set(container, pending);
    let font;
    try { font = await loadBitmapFont(); }
    catch (error) {
        if (previews.get(container) !== pending) return;
        previews.delete(container);
        throw error;
    }
    if (previews.get(container) !== pending || !container.isConnected) return;
    const canvas = container.ownerDocument.createElement('canvas');
    const scale = 2;
    canvas.width = (CHAT_WIDTH + 4) * scale;
    canvas.height = (lines.length * 9 + 4) * scale;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', lines.map(line => stripAnsi(line).trim()).join('. '));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const atlas = color => {
        const key = `#${color}`;
        if (!font.tinted.has(key)) {
            const tint = container.ownerDocument.createElement('canvas');
            tint.width = tint.height = 128;
            const tc = tint.getContext('2d');
            tc.drawImage(font.atlas, 0, 0);
            tc.globalCompositeOperation = 'source-in';
            tc.fillStyle = key;
            tc.fillRect(0, 0, 128, 128);
            font.tinted.set(key, tint);
        }
        return font.tinted.get(key);
    };
    function draw(line, row, shadow) {
        let color = 'ffffff', x = 2;
        for (let i = 0; i < line.length; i++) {
            if (line[i] === '§') {
                const code = line[++i]?.toLowerCase();
                if (/^[0-9a-f]$/.test(code)) color = COLORS[parseInt(code, 16)];
                else if (code === 'r') color = 'ffffff';
                continue;
            }
            const char = line[i], code = char.charCodeAt(0) < 256 ? char.charCodeAt(0) : 63;
            const tint = shadow ? color.match(/../g).map(hex => (parseInt(hex, 16) >> 2).toString(16).padStart(2, '0')).join('') : color;
            ctx.drawImage(atlas(tint), (code % 16) * 8, (code >> 4) * 8, 8, 8,
                (x + Number(shadow)) * scale, (2 + row * 9 + Number(shadow)) * scale, 8 * scale, 8 * scale);
            x += chatCharWidth(char);
        }
    }
    lines.forEach((line, row) => { draw(line, row, true); draw(line, row, false); });
    container.replaceChildren(canvas);
}

module.exports = { render, clear };
