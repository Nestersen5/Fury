'use strict';

function mount({ document, notifications, invoke, isClosing = () => false }) {
    const window = document.defaultView;
    let disposed = false, offer = null;
    const show = () => {
        if (disposed || isClosing() || document.hidden || !offer) return;
        const result = offer; offer = null;
        document.removeEventListener('visibilitychange', show);
        const toast = notifications.show({
            title: `Fury ${result.version} is available.`,
            detail: result.summary || 'View the release and choose a download on Fury\u2019s website.',
            kind: 'info', kicker: 'Fury update', persistent: true
        });
        if (!toast) return;
        const action = document.createElement('button');
        action.type = 'button'; action.className = 'primary notification-update-action';
        action.textContent = 'View update';
        action.setAttribute('aria-label', 'View Fury update (opens your browser)');
        action.addEventListener('click', async () => {
            if (disposed || isClosing() || action.disabled) return;
            action.disabled = true;
            try {
                if (!await invoke('updates:open')) throw new Error('Unavailable');
            } catch {
                if (!disposed && !isClosing()) notifications.show({
                    title: 'Could not open the download page', detail: 'Please try again.', kind: 'error', kicker: 'Fury update'
                });
            } finally { action.disabled = false; }
        });
        toast.querySelector('.notification-copy').append(action);
    };
    // A single deferred task: no startup await, refresh hook or polling timer.
    const timer = window.setTimeout(async () => {
        if (disposed || isClosing()) return;
        try {
            const result = await invoke('updates:check');
            if (disposed || isClosing() || !result) return;
            offer = result;
            if (document.hidden) document.addEventListener('visibilitychange', show);
            else show();
        } catch { /* Startup/offline failures are intentionally silent. */ }
    }, 0);
    function dispose() {
        disposed = true; offer = null;
        window.clearTimeout(timer);
        document.removeEventListener('visibilitychange', show);
        window.removeEventListener('pagehide', dispose);
    }
    window.addEventListener('pagehide', dispose, { once: true });
    return { dispose };
}

module.exports = { mount };
