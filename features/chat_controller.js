'use strict';

const COLORS = {
    label: 'white',
    neutral: 'gray',
    active: 'green',
    inactive: 'red',
    locked: 'dark_gray',
    action: 'aqua',
    value: 'yellow',
    divider: 'dark_gray'
};

function component(text = '', color = COLORS.neutral, options = {}) {
    const out = {
        text: String(text),
        color,
        underlined: false
    };
    if (options.bold !== undefined) out.bold = Boolean(options.bold);
    if (options.italic !== undefined) out.italic = Boolean(options.italic);
    if (options.clickEvent) out.clickEvent = options.clickEvent;
    if (options.hoverEvent) out.hoverEvent = options.hoverEvent;
    if (options.insertion !== undefined) out.insertion = String(options.insertion);
    return out;
}

function hover(lines) {
    const text = Array.isArray(lines) ? lines.filter(Boolean).join('\n') : String(lines || '');
    return text ? { action: 'show_text', value: text } : undefined;
}

function root(parts = []) {
    return { text: '', extra: parts.flat().filter(Boolean) };
}

function text(value = '', color = COLORS.neutral, options = {}) {
    return component(value, color, options);
}

function label(value = '') {
    return text(value, COLORS.label);
}

function gap(size = 3) {
    return text(' '.repeat(Math.max(1, Number(size) || 1)), COLORS.neutral);
}

function line(parts = []) {
    return root(parts);
}

function button(labelText, color, command, hoverLines, options = {}) {
    const clickable = options.clickable !== false && command;
    return component(labelText, clickable ? color : (options.lockedColor || COLORS.locked), {
        bold: Boolean(options.bold),
        clickEvent: clickable
            ? { action: options.action || 'run_command', value: command }
            : undefined,
        hoverEvent: hover(clickable ? hoverLines : (options.lockedHover || hoverLines))
    });
}

function action(labelText, command, hoverLines, options = {}) {
    return button(labelText, options.color || COLORS.action, command, hoverLines, options);
}

function suggest(labelText, command, hoverLines, options = {}) {
    return button(labelText, options.color || COLORS.action, command, hoverLines, {
        ...options,
        action: 'suggest_command'
    });
}

function adjust(labelText, color, command, hoverLines, enabled = true) {
    return button(`[${labelText}]`, color, enabled ? command : null, hoverLines, {
        clickable: enabled,
        lockedHover: hoverLines || 'Unavailable right now.'
    });
}

function choice(labelText, selected, command, hoverLines, options = {}) {
    const locked = options.locked || false;
    const color = locked
        ? COLORS.locked
        : selected
            ? (options.selectedColor || COLORS.active)
            : (options.unselectedColor || COLORS.neutral);
    return button(labelText, color, locked ? null : command, hoverLines, {
        clickable: !locked && Boolean(command),
        lockedHover: options.lockedHover
    });
}

function binary(labelText, enabled, onCommand, offCommand, options = {}) {
    const locked = Boolean(options.locked);
    return [
        label(`${labelText}: `),
        choice('ON', Boolean(enabled), onCommand, options.onHover || `Turn ${labelText} on.`, {
            locked,
            selectedColor: COLORS.active,
            unselectedColor: COLORS.neutral,
            lockedHover: options.lockedHover
        }),
        text(' / ', COLORS.neutral),
        choice('OFF', !enabled, offCommand, options.offHover || `Turn ${labelText} off.`, {
            locked,
            selectedColor: COLORS.inactive,
            unselectedColor: COLORS.neutral,
            lockedHover: options.lockedHover
        })
    ];
}

function option(labelText, selected, command, hoverLines, options = {}) {
    const locked = Boolean(options.locked);
    return choice(labelText, Boolean(selected), command, hoverLines, {
        locked,
        selectedColor: options.selectedColor || COLORS.active,
        unselectedColor: options.unselectedColor || COLORS.inactive,
        lockedHover: options.lockedHover
    });
}

function send(client, sendChat, parts = []) {
    sendChat(client, line(parts));
}

function divider(client, sendChat, titleText = '') {
    const bar = '----------------------------------------';
    if (!titleText) {
        send(client, sendChat, [text(bar, COLORS.divider)]);
        return;
    }
    send(client, sendChat, [
        text('----- ', COLORS.divider),
        text(titleText, COLORS.action, { bold: true }),
        text(' -----', COLORS.divider)
    ]);
}

function spacer(client, sendChat) {
    send(client, sendChat, [text(' ', COLORS.neutral)]);
}

const PANEL_COLORS = Object.freeze({
    border: 'dark_gray',
    heading: 'light_purple',
    action: 'aqua',
    muted: 'gray',
    quiet: 'dark_gray',
    value: 'white',
    label: 'white',
    active: 'green'
});

function stripMinecraftCodes(value = '') {
    return String(value).replace(/(?:\u00C2?\u00A7|\\u00a7|\\u00A7)[0-9A-FK-OR]/gi, '');
}

function visibleLength(parts = []) {
    return parts.flat().filter(Boolean).reduce((total, part) => {
        return total + stripMinecraftCodes(part.text || '').length;
    }, 0);
}

function makeRail(width = 38) {
    const safeWidth = Math.max(18, Number(width) || 38);
    return `+${'-'.repeat(safeWidth)}+`;
}

function createPanel(sendLine, options = {}) {
    const colors = { ...PANEL_COLORS, ...(options.colors || {}) };
    const railText = options.railText || makeRail(options.width);
    const panelWidth = railText.length - 2;
    const framed = options.framed === true;
    const indent = options.indent || '';
    const defaultLabelWidth = Math.max(1, Number(options.labelWidth) || 13);

    function sendParts(parts = []) {
        sendLine(parts.flat().filter(Boolean));
    }

    function rail() {
        if (!framed) return;
        sendParts([
            text(indent, colors.quiet),
            component(railText, colors.border)
        ]);
    }

    function row(parts = []) {
        const flatParts = parts.flat().filter(Boolean);
        if (!framed) {
            sendParts([...(indent ? [text(indent, colors.quiet)] : []), ...flatParts]);
            return;
        }
        const padding = Math.max(0, panelWidth - visibleLength(flatParts) - 2);
        sendParts([
            text(indent, colors.quiet),
            component('| ', colors.border),
            ...flatParts,
            text(' '.repeat(padding), colors.quiet),
            component(' |', colors.border)
        ]);
    }

    function title(titleText, subtitle = 'controller') {
        if (!framed) {
            row([
                component('FURY', colors.heading, { bold: true }),
                component(' \u00bb ', colors.heading),
                component(titleText, colors.label, {
                    hoverEvent: subtitle ? hover(subtitle) : undefined
                })
            ]);
            return;
        }
        row([
            component(titleText, colors.value, { bold: true }),
            subtitle ? text(`  ${subtitle}`, colors.quiet) : null
        ]);
    }

    function section(labelText) {
        row([component(String(labelText).toUpperCase(), colors.muted)]);
    }

    function label(labelText, width = defaultLabelWidth) {
        return component(String(labelText).padEnd(width), colors.label);
    }

    function chip(labelText, selected, command, hoverLines, chipOptions = {}) {
        const locked = Boolean(chipOptions.locked);
        const chipColor = locked && chipOptions.lockedColor
            ? chipOptions.lockedColor
            : selected
            ? (chipOptions.selectedColor || colors.value)
            : (chipOptions.unselectedColor || colors.muted);
        const item = component(labelText, chipColor, { bold: false });
        if (!locked && command && (!selected || chipOptions.clickSelected)) {
            item.clickEvent = { action: chipOptions.action || 'run_command', value: command };
        }
        if (hoverLines || chipOptions.lockedHover) item.hoverEvent = hover(locked ? (chipOptions.lockedHover || hoverLines) : hoverLines);
        return [
            component('[', chipColor),
            item,
            component(']', chipColor)
        ];
    }

    function toggle(enabled, onCommand, offCommand, hoverOptions = {}) {
        return [
            ...chip(enabled ? 'ON' : 'on', Boolean(enabled), onCommand, hoverOptions.onHover || 'Turn on.', {
                selectedColor: colors.active
            }),
            text(' ', colors.quiet),
            ...chip(enabled ? 'off' : 'OFF', !enabled, offCommand, hoverOptions.offHover || 'Turn off.', {
                selectedColor: colors.muted
            })
        ];
    }

    function flag(labelText, enabled, command, hoverLines, chipOptions = {}) {
        return chip(labelText, Boolean(enabled), command, hoverLines, {
            selectedColor: chipOptions.selectedColor || colors.active,
            unselectedColor: chipOptions.unselectedColor || colors.quiet,
            clickSelected: chipOptions.clickSelected !== undefined ? chipOptions.clickSelected : true,
            locked: chipOptions.locked,
            action: chipOptions.action
        });
    }

    function pick(labelText, selected, command, hoverLines, chipOptions = {}) {
        return chip(labelText, Boolean(selected), command, hoverLines, {
            selectedColor: chipOptions.selectedColor || colors.heading,
            unselectedColor: chipOptions.unselectedColor || colors.action,
            clickSelected: chipOptions.clickSelected,
            action: chipOptions.action
        });
    }

    function action(labelText, command, hoverLines, chipOptions = {}) {
        return chip(labelText, !chipOptions.locked, command, hoverLines, {
            selectedColor: chipOptions.color || colors.action,
            unselectedColor: colors.quiet,
            clickSelected: true,
            locked: chipOptions.locked,
            lockedHover: chipOptions.lockedHover,
            action: chipOptions.action
        });
    }

    return {
        colors,
        rail,
        row,
        title,
        section,
        label,
        chip,
        toggle,
        flag,
        pick,
        action
    };
}

function clientPanel(client, sendChat, options = {}) {
    return createPanel(parts => send(client, sendChat, parts), options);
}

// ---------- minimalist-style primitives (used by /autododge, /share, /fury) ----------
// These are intentionally independent of the COLORS palette above: they fix
// their own gold/green/red/gray scheme so the rendered controllers look the
// same regardless of which feature renders them.

function toggle(activeOn, onCommand, offCommand, options = {}) {
    const locked = Boolean(options.locked);
    const onPart = component('ON', activeOn ? 'green' : 'gray', { bold: activeOn });
    if (!locked && !activeOn && onCommand) {
        onPart.clickEvent = { action: 'run_command', value: onCommand };
    }
    if (options.onHover) onPart.hoverEvent = hover(options.onHover);
    const offPart = component('OFF', !activeOn ? 'red' : 'gray', { bold: !activeOn });
    if (!locked && activeOn && offCommand) {
        offPart.clickEvent = { action: 'run_command', value: offCommand };
    }
    if (options.offHover) offPart.hoverEvent = hover(options.offHover);
    return [onPart, component(' · ', 'dark_gray'), offPart];
}

function pick(labelText, selected, command, hoverLines) {
    const item = component(labelText, selected ? 'white' : 'gold', { bold: selected });
    if (!selected && command) {
        item.clickEvent = { action: 'run_command', value: command };
    }
    if (hoverLines) item.hoverEvent = hover(hoverLines);
    return item;
}

function flag(labelText, included, command, hoverLines, options = {}) {
    const locked = Boolean(options.locked);
    const item = component(labelText, included ? 'green' : 'red');
    if (!locked && command) {
        item.clickEvent = { action: 'run_command', value: command };
    }
    if (hoverLines) item.hoverEvent = hover(hoverLines);
    return item;
}

function wideButton(labelText, command, hoverLines, options = {}) {
    const locked = Boolean(options.locked);
    const item = component(`[ ${labelText} ]`, locked ? 'dark_gray' : 'gold');
    if (!locked && command) {
        item.clickEvent = { action: options.action || 'run_command', value: command };
    }
    if (hoverLines) item.hoverEvent = hover(hoverLines);
    return item;
}

function actionButton(labelText, command, hoverLines, options = {}) {
    const locked = Boolean(options.locked);
    const item = component(`[${labelText}]`, locked ? 'dark_gray' : 'gold');
    if (!locked && command) {
        item.clickEvent = { action: options.action || 'run_command', value: command };
    }
    if (hoverLines) item.hoverEvent = hover(hoverLines);
    return item;
}

function title(text) {
    return component(text, 'gold', { bold: true });
}

function rule(width = 13) {
    return component('─'.repeat(Math.max(1, Number(width) || 1)), 'dark_gray');
}

module.exports = {
    COLORS,
    PANEL_COLORS,
    action,
    actionButton,
    adjust,
    binary,
    button,
    choice,
    clientPanel,
    component,
    createPanel,
    divider,
    flag,
    gap,
    hover,
    label,
    line,
    option,
    pick,
    root,
    rule,
    send,
    spacer,
    suggest,
    text,
    title,
    toggle,
    wideButton
};
