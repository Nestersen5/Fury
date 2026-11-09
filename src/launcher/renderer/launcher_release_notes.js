'use strict';

const { destinations, destinationFor } = require('../../updates/releaseDestinations');
const { compareVersions, stableVersion } = require('../../updates/updateNotifications');
const sections = [['features', 'New features'], ['improvements', 'Improvements'], ['fixes', 'Bug fixes']];
const art = {
    features: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
    improvements: '<path d="m5 16 7-8 7 8M12 8v13M5 3h14"/>',
    fixes: '<path d="m5 12 4 4L19 6"/>'
};

function mount({ document, invoke, navigate, notify, dialog, head, heading, subtitle, content, footer, dialogStatus, reopen }) {
    const window = document.defaultView;
    let disposed = false, stopping = false, result, discovery, readVersions = new Set(), unreadVersions = new Set(), visit = '', observer, queued = false;
    let writeChain = Promise.resolve(), failed = false, highlightTimer, highlighted, focusAfterClose;
    const badges = new Map(), dots = new Map(), seenInFlight = new Set();
    const node = (tag, text, cls) => { const el = document.createElement(tag); if (text) el.textContent = text; if (cls) el.className = cls; return el; };
    const button = (text, action, cls) => { const el = node('button', text, cls); el.type = 'button'; el.addEventListener('click', action); return el; };
    const icon = key => { const el = node('span', null, `fury-change-icon ${key}`); el.setAttribute('aria-hidden', 'true'); el.innerHTML = `<svg viewBox="0 0 24 24">${art[key]}</svg>`; return el; };
    const style = node('link'); style.rel = 'stylesheet'; style.href = 'src/launcher/styles/launcher_release_notes.css'; document.head.append(style);
    const versions = node('nav', null, 'fury-release-versions'); versions.setAttribute('aria-label', 'Release versions');
    versions.append(node('h2', 'What’s new'));
    const versionList = node('div', null, 'fury-release-version-list'); versions.append(versionList);
    const main = node('div', null, 'fury-release-main'); main.append(head, subtitle, content, dialogStatus, footer);
    dialog.replaceChildren(versions, main); dialog.classList.add('fury-release-browser');
    subtitle.hidden = true;

    function unread(version) {
        if (result?.unreadVersions) return unreadVersions.has(version) && !readVersions.has(version);
        const from = result?.unreadFromVersion || result?.fromVersion;
        return stableVersion(from) && compareVersions(version, from) > 0 && !readVersions.has(version);
    }
    function dot(owner, key, show) {
        if (!owner) return;
        let el = dots.get(key);
        if (!el) { el = node('i', null, 'fury-release-dot'); el.setAttribute('aria-hidden', 'true'); owner.append(el); dots.set(key, el); }
        el.hidden = !show;
        owner.classList.toggle('fury-has-unread', !!show);
        if (show) owner.setAttribute('data-release-unread', 'true'); else owner.removeAttribute('data-release-unread');
        if (show) owner.setAttribute('aria-description', 'Unread changes'); else owner.removeAttribute('aria-description');
    }
    function updateDots() {
        if (!result) return;
        dot(reopen, 'reopen', result.releases.some(entry => unread(entry.version)));
        for (const b of versionList.children) dot(b, b.dataset.version, unread(b.dataset.version));
        const categories = new Set((discovery?.pending || []).map(id => destinations.find(item => item.id === id)?.category).filter(Boolean));
        const unvisited = [...categories].filter(category => !discovery.visited.includes(category));
        for (const category of categories) dot(document.querySelector(`[data-ds-category="${category}"]`), `category:${category}`, unvisited.includes(category));
        dot(document.querySelector('[data-page-tab="settings"]'), 'settings', unvisited.length > 0);
    }
    function save(payload) {
        // A single owner serializes small, change-based acknowledgements. Keep
        // badges on screen for this visit even after the acknowledgement saves.
        writeChain = writeChain.catch(() => {}).then(async () => {
            const value = await invoke('updates:seen', { version: result.installedVersion, ...payload });
            if (!value) throw Error('Could not save read markers');
            if (disposed) return;
            discovery = value.discovery; readVersions = new Set(value.readVersions); unreadVersions = new Set(value.unreadVersions); failed = false; updateDots();
        }).catch(() => {
            if (!disposed && !failed) notify('Could not save what you’ve seen', 'Please try again.');
            failed = true;
            if (payload.readVersion) readVersions.delete(payload.readVersion);
            if (payload.category) discovery.visited = discovery.visited.filter(category => category !== payload.category);
            updateDots();
            for (const id of payload.settings || []) seenInFlight.delete(id);
        });
        return writeChain;
    }
    function openDestination(destination) {
        if (disposed || !navigate) return;
        const focused = navigate(destination);
        if (dialog.open) { focusAfterClose = focused; dialog.close(); }
        else focused?.focus({ preventScroll: true });
        if (highlighted) highlighted.classList.remove('fury-release-target');
        window.clearTimeout(highlightTimer);
        highlighted = focused?.closest('.ia-setting-row,.share-option-row,.fury-overlay-row,.fury-nickname-row,.feature-card,.fc-module,.auto-dodge-number') || focused;
        if (highlighted) {
            highlighted.scrollIntoView({ block: 'center', behavior: 'instant' });
            highlighted.classList.add('fury-release-target');
            highlightTimer = window.setTimeout(() => { highlighted?.classList.remove('fury-release-target'); highlighted = null; }, 2800);
        }
    }
    function fillNotes(target, data, version, links = false) {
        target.replaceChildren();
        for (const [key, title] of sections) {
            if (!data.sections[key]?.length) continue;
            const section = node('section', null, `fury-change-section ${key}`), list = node('ul'), h = node('h3');
            h.append(icon(key), node('span', title), node('span', String(data.sections[key].length), 'fury-change-count')); section.append(h);
            data.sections[key].forEach((line, index) => {
                const li = node('li'), marker = node('i'); marker.setAttribute('aria-hidden', 'true');
                li.append(marker, node('p', line));
                const destination = links && destinationFor(version, key, index);
                if (destination && navigate && compareVersions(version, result.installedVersion) <= 0) {
                    const link = button(`${destination.label} ›`, () => openDestination(destination), 'fury-release-link');
                    link.setAttribute('aria-label', `Open ${destination.label}: ${line}`); li.append(link);
                }
                list.append(li);
            });
            section.append(list); target.append(section);
        }
        if (data.complete === false) target.append(node('p', 'The latest release notes are unavailable.', 'note'));
        if (!target.children.length) target.append(node('p', 'No additional changes to show.', 'note'));
    }
    function selectVersion(version) {
        const release = result.releases.find(entry => entry.version === version);
        heading.textContent = `Fury ${version}`;
        fillNotes(content, { sections: release || { features: [], improvements: [], fixes: [] }, complete: !!release && release.complete !== false }, version, true);
        content.scrollTop = 0;
        for (const b of versionList.children) {
            const selected = b.dataset.version === version;
            b.setAttribute('aria-current', String(selected));
        }
        // The target's download action never changes when browsing older notes.
        if (!readVersions.has(version) && release && release.complete !== false) { readVersions.add(version); updateDots(); void save({ readVersion: version }); }
    }
    function labelFor(item) {
        const control = document.getElementById(item.control);
        if (!control) return null;
        const ownLabel = control.closest('label:not(.switch):not(.auto-dodge-number)');
        if (ownLabel) return ownLabel;
        const row = control.closest('.ia-setting-row,.share-option-row,.fury-overlay-row,.fury-nickname-row,.feature-card,.fc-module,.auto-dodge-number');
        return row?.querySelector('h3,h4,.fc-title,strong') || document.querySelector(`label[for="${item.control}"]`)?.querySelector('span')
            || control.closest('label:not(.switch)') || row?.querySelector('label:not(.switch)');
    }
    function currentVisit() {
        const page = document.documentElement.dataset.workspacePage;
        if (page === 'anticheat') return 'anticheat:';
        if (page !== 'settings') return '';
        const category = document.querySelector('[data-settings-subpage].active')?.dataset.settingsSubpage;
        return category ? `${category}:${category === 'display' ? document.querySelector('.fury-ingame-tabs [aria-selected="true"]')?.dataset.ingame : ''}` : '';
    }
    function observe() {
        observer?.disconnect();
        if (stopping || !visit || document.hidden || document.querySelector('dialog[open]')) return;
        const category = visit.split(':')[0];
        if (discovery.pending.some(id => destinations.find(item => item.id === id)?.category === category) && !discovery.visited.includes(category)) {
            discovery.visited.push(category); updateDots(); void save({ category });
        }
        for (const badge of badges.values()) observer.observe(badge);
    }
    function clearBadges() {
        for (const badge of badges.values()) { badge.parentElement?.classList.remove('fury-release-tag-label'); badge.remove(); }
        badges.clear();
    }
    function onView() {
        if (disposed || stopping || !result) return;
        const next = currentVisit();
        if (next === visit) return;
        observer?.disconnect();
        clearBadges(); visit = next;
        if (!visit) return;
        const category = visit.split(':')[0];
        for (const id of discovery?.pending || []) {
            const item = destinations.find(entry => entry.id === id);
            if (!item || item.category !== category || discovery.seen.includes(id) || seenInFlight.has(id)) continue;
            const label = labelFor(item); if (!label) continue;
            const badge = node('span', item.kind === 'new' ? 'New' : 'Updated', `fury-setting-release-tag ${item.kind}`);
            badge.dataset.releaseSetting = id; label.classList.add('fury-release-tag-label'); label.append(badge); badges.set(id, badge);
        }
        observe();
    }
    function scheduleView() {
        if (queued) return; queued = true;
        window.queueMicrotask(() => { queued = false; onView(); });
    }
    observer = new window.IntersectionObserver(entries => {
        if (disposed || stopping || document.hidden || !visit || document.querySelector('dialog[open]')) return;
        const settings = [];
        for (const entry of entries) {
            const id = entry.target.dataset.releaseSetting;
            if (badges.get(id) !== entry.target || !entry.isIntersecting || entry.intersectionRatio < .5 || discovery.seen.includes(id) || seenInFlight.has(id)) continue;
            seenInFlight.add(id); settings.push(id); observer.unobserve(entry.target);
        }
        if (settings.length) void save({ settings });
    }, { threshold: .5 });
    const visibility = () => { if (document.hidden) observer.disconnect(); else observe(); };
    function onChange(event) {
        if (disposed || stopping || document.hidden || !visit) return;
        const item = destinations.find(entry => entry.control === event.target.id);
        const badge = item && badges.get(item.id);
        if (!badge || !badge.getClientRects().length || discovery.seen.includes(item.id) || seenInFlight.has(item.id)) return;
        seenInFlight.add(item.id); observer.unobserve(badge); void save({ settings: [item.id] });
    }
    document.addEventListener('fury-settings-view-changed', scheduleView);
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('change', onChange);
    document.addEventListener('close', visibility, true);
    function onClose() { if (focusAfterClose) { focusAfterClose.focus({ preventScroll: true }); focusAfterClose = null; } observe(); }
    dialog.addEventListener('close', onClose);

    function load(data) {
        if (disposed) return;
        result = data; discovery = data.discovery; readVersions = new Set(data.readVersions || []); unreadVersions = new Set(data.unreadVersions || []);
        if (!data.releases.some(entry => entry.version === data.version)) data.releases = [{ version: data.version, features: [], improvements: [], fixes: [], complete: false }, ...data.releases];
        versionList.replaceChildren();
        for (const entry of data.releases) {
            const b = button(entry.version, () => selectVersion(entry.version), 'fury-release-version'); b.dataset.version = entry.version; versionList.append(b);
        }
        // Removed buttons must not retain their old dot nodes.
        for (const [key, el] of dots) if (!el.isConnected) dots.delete(key);
        updateDots(); onView();
    }
    function show(data) { load(data); selectVersion(data.version); footer.hidden = data.kind !== 'available'; }
    function dashboard(data, openNotes, dismiss) {
        const card = node('section', null, 'da-update-notice fury-release-card'); card.setAttribute('aria-label', 'Fury update'); card.setAttribute('role', 'status');
        const header = node('div', null, 'fury-release-card-head');
        header.append(icon('features'), node('strong', data.kind === 'available' ? 'A Fury update is available' : `What’s new in Fury ${data.version}`), button('All changes ›', openNotes, 'fury-release-link'));
        const close = button('×', dismiss, 'fury-release-card-close'); close.setAttribute('aria-label', 'Dismiss update notice'); header.append(close); card.append(header);
        const highlights = node('div', null, 'fury-release-highlights');
        const release = data.releases.find(entry => entry.version === data.version);
        const selected = release?.features?.length ? (data.version === '1.1.4' ? [0, 3, 1] : [0, 1, 2]).filter(i => release.features[i]) : [];
        for (const i of selected) {
            const tile = node('div', null, 'fury-release-highlight'); tile.append(node('p', release.features[i]));
            const destination = destinationFor(data.version, 'features', i);
            if (destination && data.kind !== 'available') tile.append(button(`${destination.label} ›`, () => openDestination(destination), 'fury-release-link'));
            else tile.append(button('See changes ›', openNotes, 'fury-release-link'));
            highlights.append(tile);
        }
        if (selected.length) card.append(highlights);
        return card;
    }
    function dispose() {
        disposed = true; observer.disconnect(); window.clearTimeout(highlightTimer); highlighted?.classList.remove('fury-release-target');
        clearBadges(); for (const el of dots.values()) el.remove();
        dots.clear(); document.removeEventListener('fury-settings-view-changed', scheduleView);
        document.removeEventListener('visibilitychange', visibility); dialog.removeEventListener('close', onClose); style.remove();
        document.removeEventListener('change', onChange);
        document.removeEventListener('close', visibility, true);
    }
    return { load, show, fillNotes, dashboard, dispose, flush: () => { stopping = true; observer.disconnect(); return writeChain; } };
}
module.exports = { mount };
