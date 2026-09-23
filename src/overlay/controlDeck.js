'use strict';

// Legacy /deck command routing is retained; its interactive UI is removed.
const { component, root } = require('../../features/chat_controller.js');
const MUTED = 'gray';
const QUIET = 'dark_gray';

const TABS = [
    { key: 'home', label: 'home', accent: 'aqua', hint: 'Overview of every module, quick actions, presets.' },
    { key: 'guard', label: 'guard', accent: 'gold', hint: 'Auto-dodge, party dodge, gambler, lag guard.' },
    { key: 'intel', label: 'intel', accent: 'light_purple', hint: 'Scans, overlays, tags, sharing, chat stats.' },
    { key: 'lookup', label: 'lookup', accent: 'yellow', hint: 'Player cards and intel lookups.' }
];

function createControlDeck(deps = {}) {
    const {
        send = () => {},
        runCommand = () => {},
        registry = {},
        setTimer = (fn, ms) => setTimeout(fn, ms)
    } = deps;

    let currentTab = 'home';

    const modules = () => (typeof registry.modules === 'function' ? registry.modules() : registry.modules) || [];
    const presets = () => registry.presets || [];
    const lookups = () => registry.lookups || [];

    // ---- routing safety: the deck may only dispatch commands it rendered ----
    function allowedCommands() {
        const allowed = new Set();
        for (const mod of modules()) {
            if (mod.onCommand) allowed.add(mod.onCommand);
            if (mod.offCommand) allowed.add(mod.offCommand);
            if (mod.openCommand) allowed.add(mod.openCommand);
            (mod.extraCommands || []).forEach(cmd => allowed.add(cmd));
        }
        for (const preset of presets()) {
            (preset.commands || []).forEach(cmd => allowed.add(cmd));
        }
        for (const entry of lookups()) {
            if (entry.command && !entry.suggest) allowed.add(entry.command);
            (entry.extraCommands || []).forEach(cmd => allowed.add(cmd));
        }
        (registry.actions || []).forEach(action => action.command && allowed.add(action.command));
        return allowed;
    }

    function accentOf() { return 'light_purple'; }
    function line(accent, parts) { send(root(parts)); }
    function renderTab(tabKey) {
        currentTab = TABS.some(tab => tab.key === tabKey) ? tabKey : 'home';
        send(root([component('FURY \u00bb ', 'light_purple'), component('Settings are in the launcher. Commands still work; use /help.', 'gray')]));
    }
    function refresh() { renderTab(currentTab); }
    function renderAbout() { refresh(); }

    // ---- command handling: /deck [tab|run|preset|about] ----
    function handle(args = []) {
        const sub = String(args[1] || '').toLowerCase();

        if (!sub) {
            renderTab(currentTab);
            return;
        }
        if (sub === 'about') {
            renderAbout();
            return;
        }
        if (sub === 'run') {
            const commandText = args.slice(2).join(' ').trim();
            if (!commandText.startsWith('/') || !allowedCommands().has(commandText)) {
                line(accentOf(currentTab), [component(`deck: unknown action "${commandText}"`, 'red')]);
                return;
            }
            runCommand(commandText);
            setTimer(() => { try { refresh(); } catch (e) {} }, 350);
            return;
        }
        if (sub === 'preset') {
            const preset = presets().find(entry => entry.key === String(args[2] || '').toLowerCase());
            if (!preset) {
                line(accentOf(currentTab), [component('deck: unknown preset', 'red')]);
                return;
            }
            const commands = (preset.commands || []).slice();
            line(accentOf(currentTab), [
                component(`applying loadout `, MUTED),
                component(preset.label, 'gold', { bold: true }),
                component(` (${commands.length} steps)`, QUIET)
            ]);
            commands.forEach((commandText, index) => {
                setTimer(() => { try { runCommand(commandText); } catch (e) {} }, index * 200);
            });
            setTimer(() => { try { refresh(); } catch (e) {} }, commands.length * 200 + 350);
            return;
        }
        if (sub === 'refresh') {
            refresh();
            return;
        }
        renderTab(sub);
    }

    return { handle, refresh, renderTab, allowedCommands, TABS };
}

module.exports = { createControlDeck, TABS };
