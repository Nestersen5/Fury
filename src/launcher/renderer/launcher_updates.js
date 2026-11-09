'use strict';
function mount({ document, notifications, invoke, navigate, subscribe = () => () => {}, isClosing = () => false }) {
    const window = document.defaultView;
    let disposed = false, offer = null, toast = null, loading = false, notesPromise, updater = null;
    let pinned = false, closeTimer, suppressFocus = false, dashboardNotice = null;
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
    const automatic = () => updater?.supported && updater.version && !['idle', 'loading', 'unavailable'].includes(updater.status);
    const formatBytes = value => `${(Math.max(0, value || 0) / 1024 / 1024).toFixed(1)} MB`;
    const sections = [['features', 'New features'], ['improvements', 'Improvements'], ['fixes', 'Bug fixes']];
    function fillNotes(target, result) {
        presentation.fillNotes(target, result);
    }
    const notes = () => notesPromise ||= invoke('updates:notes').finally(() => { notesPromise = null; });
    async function acknowledge(version) {
        if (!await invoke('updates:dismiss', version)) throw Error('Dismissal unavailable');
        toast?.querySelector('.notification-close')?.click(); toast = null;
        dashboardNotice?.remove(); dashboardNotice = null;
    }
    async function action() {
        if (disposed || isClosing()) return;
        try {
            if (!automatic()) {
                if (!await invoke('updates:open')) throw Error();
            } else if (updater.status === 'ready') {
                if (!await invoke('updates:install')) throw Error();
            } else if (updater.status === 'downloading') acceptState(await invoke('updates:cancel'));
            else if (updater.status !== 'installing') acceptState(await invoke('updates:download'));
        } catch {
            if (!disposed && !isClosing()) notifications.show({ title: automatic() ? 'Could not update Fury' : 'Could not open the download page', detail: 'Please try again.', kind: 'error' });
        }
    }
    const dialog = node('dialog', null, 'fury-release-dialog');
    dialog.setAttribute('aria-labelledby', 'fury-release-title');
    const head = node('div', null, 'fury-release-head');
    const heading = node('h2'); heading.id = 'fury-release-title';
    const close = button('×', () => dialog.close()); close.setAttribute('aria-label', 'Close changelog');
    head.append(heading, close);
    const subtitle = node('p', null, 'note'), content = node('div', null, 'fury-release-content');
    content.tabIndex = 0; content.setAttribute('role', 'region'); content.setAttribute('aria-label', 'Release notes');
    const footer = node('div', null, 'fury-release-actions');
    const download = button('Download update', action, 'primary');
    const dialogStatus = node('p', null, 'note fury-release-status'); dialogStatus.setAttribute('role', 'status');
    footer.append(download, button('Close', () => dialog.close()));
    dialog.append(head, subtitle, content, dialogStatus, footer); document.body.append(dialog);
    async function openNotes() {
        if (disposed || isClosing() || loading) return;
        hidePreview(false); loading = true;
        try {
            const result = await notes();
            if (disposed || isClosing() || !result) return;
            presentation.show(result);
            download.hidden = result.kind !== 'available'; download.textContent = `Download ${result.version}`;
            if (automatic()) renderState();
            if (!dialog.open) dialog.showModal();
            await acknowledge(result.version);
        } catch {
            if (!disposed && !isClosing()) notifications.show({ title: 'Could not load or save the update notice', detail: 'Please try again.', kind: 'error' });
        } finally { loading = false; }
    }
    const reopen = button(null, () => {
        if (!automatic()) return openNotes();
        if (pinned && !preview.hidden) hidePreview(false);
        else { pinned = true; void showPreview(true); }
    }, 'fury-release-reopen');
    reopen.title = 'What’s new'; reopen.setAttribute('aria-label', 'What’s new');
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const documentIcon = 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M14 2v6h6M8 13h8M8 17h6';
    path.setAttribute('d', documentIcon);
    const label = node('span', 'What’s new'); icon.append(path); reopen.append(icon, label);
    document.querySelector('.app-rail')?.append(reopen);
    dialog.addEventListener('close', () => {
        if (disposed || isClosing()) return;
        suppressFocus = true; reopen.focus({ preventScroll: true }); suppressFocus = false;
    });
    const presentation = require('./launcher_release_notes').mount({ document, invoke, navigate,
        notify: (title, detail) => notifications.show({ title, detail, kind: 'error' }),
        dialog, head, heading, subtitle, content, footer, dialogStatus, reopen });
    const preview = node('section', null, 'fury-update-preview');
    preview.id = 'fury-update-preview'; preview.hidden = true;
    preview.setAttribute('popover', 'manual'); preview.setAttribute('role', 'dialog');
    preview.setAttribute('aria-labelledby', 'fury-update-heading');
    const previewHead = node('div', null, 'fury-release-head');
    const previewTitle = node('h2'); previewTitle.id = 'fury-update-heading';
    const previewClose = button('×', () => hidePreview(true)); previewClose.setAttribute('aria-label', 'Close update preview');
    previewHead.append(previewTitle, previewClose);
    const previewVersion = node('p', null, 'note');
    const previewStatus = node('p', null, 'fury-update-status'); previewStatus.setAttribute('role', 'status');
    const count = node('p', null, 'note fury-update-count');
    const previewNotes = node('div', null, 'fury-release-content fury-update-notes');
    previewNotes.tabIndex = 0; previewNotes.setAttribute('role', 'region'); previewNotes.setAttribute('aria-label', 'Scrollable release notes');
    const progress = node('progress'); progress.max = 100; progress.setAttribute('aria-label', 'Update download'); progress.hidden = true;
    const detail = node('p', null, 'note fury-update-detail');
    const previewActions = node('div', null, 'fury-release-actions');
    const previewAction = button('Download update', action, 'primary');
    previewActions.append(previewAction, button('Full changelog', openNotes), button('Later', () => hidePreview(true)));
    preview.append(previewHead, previewVersion, previewStatus, count, previewNotes, progress, detail, previewActions);
    document.body.append(preview);
    function positionPreview() {
        if (preview.hidden) return;
        const rect = reopen.getBoundingClientRect(), width = Math.min(480, window.innerWidth - 24);
        preview.style.width = `${width}px`;
        preview.style.left = `${Math.max(12, Math.min(rect.right + 12, window.innerWidth - width - 12))}px`;
        preview.style.bottom = `${Math.max(12, Math.min(window.innerHeight - rect.bottom, window.innerHeight - 200))}px`;
        preview.style.maxHeight = `${Math.min(500, Math.max(180, window.innerHeight - parseFloat(preview.style.bottom) - 12))}px`;
    }
    let previewNotesVersion;
    async function showPreview(focus = false) {
        window.clearTimeout(closeTimer);
        if (disposed || isClosing() || !automatic() || dialog.open) return;
        preview.hidden = false; preview.showPopover();
        reopen.setAttribute('aria-expanded', 'true'); positionPreview(); renderState();
        if (focus === true) previewClose.focus({ preventScroll: true });
        try {
            const result = await notes();
            if (disposed || preview.hidden || !result || result.version !== updater.version) return;
            if (previewNotesVersion !== result.version) {
                fillNotes(previewNotes, result); previewNotesVersion = result.version;
                count.textContent = sections.filter(([key]) => result.sections[key]?.length)
                    .map(([key, title]) => {
                        const length = result.sections[key].length;
                        const singular = { features: 'new feature', improvements: 'improvement', fixes: 'bug fix' };
                        return `${length} ${length === 1 ? singular[key] : title.toLowerCase()}`;
                    }).join(' · ');
            }
        } catch { if (!disposed) previewNotes.textContent = 'The latest release notes are unavailable.'; }
    }
    function hidePreview(restoreFocus) {
        pinned = false; window.clearTimeout(closeTimer);
        const hadFocus = preview.contains(document.activeElement);
        if (!preview.hidden) preview.hidePopover();
        preview.hidden = true; reopen.setAttribute('aria-expanded', 'false');
        if (restoreFocus && hadFocus) {
            suppressFocus = true; reopen.focus({ preventScroll: true }); suppressFocus = false;
        }
    }
    function scheduleClose() {
        window.clearTimeout(closeTimer);
        closeTimer = window.setTimeout(() => {
            if (!pinned && !preview.matches(':hover') && !reopen.matches(':hover')
                && !preview.contains(document.activeElement) && document.activeElement !== reopen) hidePreview(false);
        }, 180);
    }
    reopen.addEventListener('pointerenter', showPreview);
    reopen.addEventListener('focus', () => { if (!suppressFocus) void showPreview(); });
    for (const element of [reopen, preview]) {
        element.addEventListener('pointerleave', scheduleClose);
        element.addEventListener('focusout', scheduleClose);
    }
    preview.addEventListener('pointerenter', () => window.clearTimeout(closeTimer));
    function outside(event) { if (!preview.hidden && !preview.contains(event.target) && !reopen.contains(event.target)) hidePreview(false); }
    function escape(event) { if (event.key === 'Escape' && !preview.hidden) { event.preventDefault(); hidePreview(true); } }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    window.addEventListener('resize', positionPreview);
    function renderState() {
        const auto = automatic(), status = updater?.status;
        const buttonLabels = { available: 'Update available', downloading: `Downloading… ${updater?.percent || 0}%`,
            ready: 'Restart to update', installing: 'Updating…', error: 'Retry update' };
        label.textContent = auto ? buttonLabels[status] : 'What’s new';
        reopen.title = label.textContent; reopen.setAttribute('aria-label', label.textContent);
        reopen.classList.toggle('fury-update-available', !!auto);
        path.setAttribute('d', auto ? 'M12 2v13m-5-5 5 5 5-5M3 16v6h18v-6' : documentIcon);
        if (!auto) {
            hidePreview(false); reopen.removeAttribute('aria-controls'); reopen.removeAttribute('aria-haspopup');
            download.disabled = false;
            if (updater?.version) download.textContent = `Download ${updater.version}`;
            dialogStatus.textContent = updater?.message || '';
            return;
        }
        reopen.setAttribute('aria-controls', preview.id); reopen.setAttribute('aria-haspopup', 'dialog');
        previewTitle.textContent = `Fury ${updater.version}`;
        previewVersion.textContent = `Your version: ${updater.installedVersion} → ${updater.version}`;
        const statuses = { available: 'Update ready to download', downloading: `Downloading… ${updater.percent || 0}%`,
            ready: 'Update ready to install', installing: 'Saving your data and closing Fury…', error: 'Could not download update' };
        previewStatus.textContent = statuses[status];
        const date = updater.releasedAt ? new Date(updater.releasedAt).toLocaleDateString() : '';
        detail.textContent = status === 'ready' ? 'Restarting disconnects Minecraft. Update after your game.'
            : status === 'downloading' ? `${formatBytes(updater.transferred)} of ${formatBytes(updater.bytes)} · You can keep playing.`
                : `Windows installer · ${formatBytes(updater.bytes)}${date ? ` · ${date}` : ''}`;
        if (updater.message) detail.textContent += ` ${updater.message}`;
        const text = status === 'ready' ? 'Restart and update' : status === 'downloading' ? 'Cancel download'
            : status === 'error' ? 'Try again' : status === 'installing' ? 'Updating…' : 'Download update';
        for (const control of [download, previewAction]) { control.textContent = text; control.disabled = status === 'installing'; }
        progress.hidden = status !== 'downloading'; progress.value = updater.percent || 0;
        dialogStatus.textContent = `${statuses[status]}${status === 'ready' ? ' · Restarting disconnects Minecraft.' : ''}${updater.message ? ` ${updater.message}` : ''}`;
    }
    function acceptState(value) {
        if (disposed || !value || typeof value.supported !== 'boolean') return;
        if (Number.isSafeInteger(updater?.revision) && Number.isSafeInteger(value.revision) && value.revision < updater.revision) return;
        updater = value; renderState();
    }
    const unsubscribe = subscribe(acceptState);
    const show = async () => {
        if (disposed || isClosing() || document.hidden || !offer) return;
        const result = offer; offer = null; document.removeEventListener('visibilitychange', show);
        const dashboard = document.querySelector('.da-dashboard-notices');
        if (dashboard) {
            dashboardNotice?.remove();
            let data;
            try { data = await notes(); } catch { data = { ...result, releases: [] }; }
            if (disposed || isClosing()) return;
            dashboardNotice = presentation.dashboard(data, openNotes, async event => {
                const dismiss = event.currentTarget; dismiss.disabled = true;
                try { await acknowledge(result.version); }
                catch { notifications.show({ title: 'Could not save your choice', detail: 'Please try again.', kind: 'error' }); }
                finally { dismiss.disabled = false; }
            });
            dashboard.append(dashboardNotice);
            return;
        }
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
            if (disposed || isClosing()) return;
            if (result) {
                offer = result;
                if (document.hidden) document.addEventListener('visibilitychange', show); else show();
            }
            acceptState(await invoke('updates:state'));
            const data = await notes();
            if (!disposed && !isClosing()) presentation.load(data);
        } catch { /* Offline/startup failures stay silent. */ }
    }, 0);
    function dispose() {
        disposed = true; offer = null; window.clearTimeout(timer); window.clearTimeout(closeTimer); unsubscribe();
        document.removeEventListener('visibilitychange', show); document.removeEventListener('pointerdown', outside);
        document.removeEventListener('keydown', escape); window.removeEventListener('resize', positionPreview);
        window.removeEventListener('pagehide', dispose);
        presentation.dispose();
        if (dialog.open) dialog.close(); hidePreview(false); dashboardNotice?.remove(); dialog.remove(); preview.remove(); reopen.remove();
    }
    window.addEventListener('pagehide', dispose, { once: true });
    return { dispose, flush: () => presentation.flush() };
}
module.exports = { mount };
