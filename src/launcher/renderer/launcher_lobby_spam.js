'use strict';

const { sameAccount } = require('../../accounts/launcherAccounts');

function mount({ document, node, button, invoke, getState }) {
    const manage = document.getElementById('lobby-spam-manage');
    const connectionStatus = document.createElement('p');
    connectionStatus.className = 'note'; connectionStatus.setAttribute('role', 'status');
    manage.closest('.fury-overlay-row').after(connectionStatus);
    const dialog = node('dialog', 'fury-dialog fury-chat-triggers');
    dialog.id = 'lobby-spam-dialog';
    dialog.setAttribute('aria-labelledby', 'lobby-spam-dialog-title');
    const header = node('header', '', '<div><h2 id="lobby-spam-dialog-title">Muted players</h2></div>');
    const close = button('Close', () => dialog.close());
    const content = node('div', 'fury-phrase-editor');
    const help = node('p', '');
    help.textContent = 'Only public lobby messages are hidden. All mutes clear when you disconnect.';
    const status = node('p', 'note'); status.setAttribute('role', 'status');
    const list = node('div', 'lobby-spam-player-list');
    const clear = button('Unmute all', () => void request('clear'));
    const retry = button('Refresh list', () => { lastKey = ''; update(getState()); });
    header.append(close); content.append(help, status, list, clear, retry); dialog.append(header, content); document.body.append(dialog);
    let lastKey = '', generation = 0, busy = false, returnFocus = null;

    function context(state = getState()) {
        const account = state?.viewedAccount, health = state?.proxyHealth;
        const matches = sameAccount(account, { uuid: health?.connectedUuid, name: health?.connectedAccount });
        return matches && health?.connectionReady && health.lobbySpam
            ? { ...health.lobbySpam, accountKey: account.key } : null;
    }
    function key(ctx) { return ctx ? `${ctx.accountKey}:${ctx.sessionId}:${ctx.revision}` : ''; }
    function render(players) {
        list.replaceChildren();
        for (const name of players) {
            const row = node('div', 'feature-card'), label = node('span'); label.textContent = name;
            const unmute = button('Unmute', () => void request('unmute', name));
            unmute.setAttribute('aria-label', `Unmute ${name}`); row.append(label, unmute); list.append(row);
        }
        clear.disabled = !players.length || busy;
        status.textContent = players.length ? `${players.length} muted player${players.length === 1 ? '' : 's'}.` : 'No muted players.';
    }
    async function request(action, name) {
        const ctx = context();
        if (!ctx || busy || !dialog.open) return;
        const token = ++generation;
        busy = true; clear.disabled = true; retry.disabled = true;
        list.querySelectorAll('button').forEach(control => { control.disabled = true; });
        status.textContent = action === 'list' ? 'Loading muted players…' : 'Updating muted players…';
        try {
            const result = await invoke('lobby-spam:manage', { action, name, sessionId: ctx.sessionId, accountKey: ctx.accountKey });
            if (token !== generation || !dialog.open || key(context()) !== key(ctx)) return;
            if (!result.ok) throw new Error(result.error || 'Could not load muted players.');
            lastKey = `${ctx.accountKey}:${result.sessionId}:${result.revision}`;
            busy = false; render(result.players);
            // The old Unmute button was removed; keep keyboard focus in the list.
            if (action !== 'list') (list.querySelector('button') || close).focus();
        } catch (error) {
            if (token === generation && dialog.open) {
                list.replaceChildren(); status.textContent = error.message;
            }
        } finally {
            if (token === generation) { busy = false; retry.disabled = false; }
        }
    }
    function update(state) {
        const ctx = context(state);
        manage.disabled = !ctx;
        manage.title = ctx ? '' : 'Connect the selected account in Minecraft to manage its temporary mutes.';
        const connectionMessage = ctx ? '' : manage.title;
        if (connectionStatus.textContent !== connectionMessage) connectionStatus.textContent = connectionMessage;
        if (!dialog.open) return;
        const nextKey = key(ctx);
        if (!ctx) {
            generation++; busy = false; lastKey = '';
            if (list.childNodes.length) list.replaceChildren();
            clear.disabled = true; retry.disabled = true;
            if (status.textContent !== manage.title) status.textContent = manage.title;
            return;
        }
        if (nextKey !== lastKey) {
            generation++; busy = false; lastKey = nextKey; list.replaceChildren(); void request('list');
        }
    }
    manage.addEventListener('click', () => {
        if (dialog.open) return;
        returnFocus = document.activeElement; lastKey = ''; dialog.showModal(); close.focus(); update(getState());
    });
    dialog.addEventListener('close', () => { generation++; busy = false; lastKey = ''; returnFocus?.focus(); });
    dialog.addEventListener('click', event => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
    return { update };
}

module.exports = { mount };
