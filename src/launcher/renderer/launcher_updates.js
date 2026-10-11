'use strict';
function mount({ document, notifications, invoke, isClosing = () => false }) {
    const window = document.defaultView;
    let disposed = false, offer = null, toast = null, loading = false;
    const node = (tag, text, css) => {
        const el = document.createElement(tag);
        if (text) el.textContent = text;
        if (css) el.className = css;
        return el;
    };
    const button = (text, action, css) => {
        const el = node('button', text, css); el.type = 'button';
        el.addEventListener('click', action); return el;
    };
    const dialog = node('dialog', null, 'fury-release-dialog');
    dialog.setAttribute('aria-labelledby', 'fury-release-title');
    const head = node('div', null, 'fury-release-head');
    const heading = node('h2'); heading.id = 'fury-release-title';
    const close = button('×', () => dialog.close()); close.setAttribute('aria-label', 'Close changelog');
    head.append(heading, close);
    const subtitle = node('p', null, 'note'), content = node('div', null, 'fury-release-content');
    const footer = node('div', null, 'fury-release-actions');
    const download = button('Download update', async () => {
        download.disabled = true;
        try { if (!await invoke('updates:open')) throw Error(); }
        catch { notifications.show({ title: 'Could not open the download page', detail: 'Please try again.', kind: 'error' }); }
        finally { download.disabled = false; }
    }, 'primary');
    footer.append(download, button('Close', () => dialog.close()));
    dialog.append(head, subtitle, content, footer); document.body.append(dialog);
    async function acknowledge(version) {
        if (!await invoke('updates:dismiss', version)) throw Error('Dismissal unavailable');
        toast?.querySelector('.notification-close')?.click(); toast = null;
    }
    async function openNotes() {
        if (disposed || isClosing() || loading) return;
        loading = true;
        try {
            const result = await invoke('updates:notes');
            if (disposed || isClosing() || !result) return;
            heading.textContent = `What’s new in Fury ${result.version}`;
            subtitle.textContent = result.fromVersion ? `Changes since your version: ${result.fromVersion}` : 'Release highlights';
            content.replaceChildren();
            for (const [key, title] of [['features', 'New features'], ['improvements', 'Improvements'], ['fixes', 'Bug fixes']]) {
                if (!result.sections[key]?.length) continue;
                const section = node('section'), list = node('ul'); section.append(node('h3', title));
                result.sections[key].forEach(line => list.append(node('li', line)));
                section.append(list); content.append(section);
            }
            if (!result.complete) content.append(node('p', 'The latest release notes are unavailable. You can still open the official download page.', 'note'));
            if (!content.children.length) content.append(node('p', 'No additional changes to show.', 'note'));
            download.hidden = result.kind !== 'available'; download.textContent = `Download ${result.version}`;
            if (!dialog.open) dialog.showModal();
            await acknowledge(result.version);
        } catch {
            if (!disposed && !isClosing()) notifications.show({ title: 'Could not load or save the update notice', detail: 'Please try again.', kind: 'error' });
        } finally { loading = false; }
    }
    const reopen = button(null, openNotes, 'fury-release-reopen');
    reopen.title = 'What’s new'; reopen.setAttribute('aria-label', 'What’s new');
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M14 2v6h6M8 13h8M8 17h6');
    icon.append(path); reopen.append(icon, node('span', 'What’s new'));
    document.querySelector('.app-rail')?.append(reopen);
    const show = () => {
        if (disposed || isClosing() || document.hidden || !offer) return;
        const result = offer; offer = null; document.removeEventListener('visibilitychange', show);
        toast = notifications.show({
            title: result.kind === 'welcome' ? `Welcome to Fury ${result.version}` : `Fury ${result.version} is available.`,
            detail: result.fromVersion ? `See what changed since ${result.fromVersion}.` : 'See the release highlights.',
            kind: 'info', kicker: 'Fury update', persistent: true
        });
        if (!toast) return;
        const actions = node('div', null, 'fury-release-actions');
        const see = button('See what’s new', openNotes, 'primary notification-update-action');
        const dismiss = button('Don’t show again', async () => {
            dismiss.disabled = true;
            try { await acknowledge(result.version); }
            catch { notifications.show({ title: 'Could not save your choice', detail: 'Please try again.', kind: 'error' }); }
            finally { dismiss.disabled = false; }
        }, 'notification-update-dismiss');
        actions.append(see, dismiss); toast.querySelector('.notification-copy').append(actions);
    };
    const timer = window.setTimeout(async () => {
        try {
            const result = await invoke('updates:check');
            if (disposed || isClosing() || !result) return;
            offer = result;
            if (document.hidden) document.addEventListener('visibilitychange', show); else show();
        } catch { /* Offline/startup failures stay silent. */ }
    }, 0);
    function dispose() {
        disposed = true; offer = null; window.clearTimeout(timer);
        document.removeEventListener('visibilitychange', show); window.removeEventListener('pagehide', dispose);
        if (dialog.open) dialog.close(); dialog.remove(); reopen.remove();
    }
    window.addEventListener('pagehide', dispose, { once: true });
    return { dispose };
}
module.exports = { mount };
