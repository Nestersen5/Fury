(() => {
    const STORAGE_KEY = 'nester-theme-v1';
    const ACCENT_STORAGE_KEY = 'nester-accent-v2';
    const CUSTOM_ACCENT_STORAGE_KEY = 'nester-custom-accent-v2';
    const MOTION_STORAGE_KEY = 'nester-motion-v1';
    const SIDEBAR_STORAGE_KEY = 'fury-sidebar-v1';
    const THEMES = new Set(['graphite', 'midnight', 'forest', 'light', 'obsidian', 'frost']);
    const ACCENTS = {
        iris: '#8b7cff',
        cobalt: '#4385f5',
        aqua: '#16b8c8',
        mint: '#38ba83',
        lime: '#91bc39',
        sun: '#f3c64e',
        ember: '#e46f45',
        rose: '#dd5f8d',
        violet: '#a66bea'
    };
    const SETTINGS_CATEGORY_LABELS = {
        launcher: 'Appearance',
        scan: 'Scanning',
        gameplay: 'Automation',
        denick: 'Nicknames',
        overlay: 'Overlay & chat',
        display: 'In-game appearance',
        api: 'API keys',
        network: 'Proxy & network'
    };

    function isHexColor(value) {
        return /^#[0-9a-f]{6}$/i.test(String(value || '').trim());
    }

    function applyTheme(theme, persist = true) {
        const selected = THEMES.has(theme) ? theme : 'graphite';
        document.documentElement.dataset.theme = selected;
        if (persist) localStorage.setItem(STORAGE_KEY, selected);
        ['theme-select', 'settings-theme-select'].forEach((id) => {
            const select = document.getElementById(id);
            if (select && select.value !== selected) select.value = selected;
        });
        document.querySelectorAll('[data-theme-choice]').forEach((button) => {
            const active = button.dataset.themeChoice === selected;
            button.classList.toggle('active', active);
            button.setAttribute('aria-checked', active ? 'true' : 'false');
        });
        return selected;
    }

    function applyAccent(accent, persist = true, customValue = '') {
        const requested = String(accent || '').toLowerCase();
        const selected = requested === 'custom' || Object.prototype.hasOwnProperty.call(ACCENTS, requested)
            ? requested
            : 'sun';
        const customColor = isHexColor(customValue)
            ? customValue
            : (isHexColor(localStorage.getItem(CUSTOM_ACCENT_STORAGE_KEY)) ? localStorage.getItem(CUSTOM_ACCENT_STORAGE_KEY) : '#e5b35d');

        document.documentElement.dataset.accent = selected;
        if (selected === 'custom') {
            document.documentElement.style.setProperty('--accent', customColor);
            localStorage.setItem(CUSTOM_ACCENT_STORAGE_KEY, customColor);
        } else {
            document.documentElement.style.removeProperty('--accent');
        }
        if (persist) localStorage.setItem(ACCENT_STORAGE_KEY, selected);

        document.querySelectorAll('[data-accent-preset]').forEach((button) => {
            const active = button.dataset.accentPreset === selected;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        const input = document.getElementById('settings-accent-custom');
        if (input && isHexColor(selected === 'custom' ? customColor : ACCENTS[selected])) {
            input.value = selected === 'custom' ? customColor : ACCENTS[selected];
        }
        window.dispatchEvent(new CustomEvent('fury:accent-change', {
            detail: {
                accent: selected,
                color: selected === 'custom' ? customColor : ACCENTS[selected],
                persist: Boolean(persist)
            }
        }));
        return selected;
    }

    function applyMotion(reduced, persist = true) {
        const selected = reduced ? 'reduced' : 'full';
        const enabling = selected === 'full' && document.documentElement.dataset.motion === 'reduced';
        const existing = enabling ? new Set(document.getAnimations()) : null;
        document.documentElement.dataset.motion = selected;
        // Enabling motion must not replay entrance effects on content already visible.
        if (enabling) document.getAnimations().forEach(animation => {
            if (!existing.has(animation) && animation instanceof CSSAnimation
                && animation.effect.getTiming().iterations !== Infinity) animation.finish();
        });
        if (persist) localStorage.setItem(MOTION_STORAGE_KEY, selected);
        const input = document.getElementById('settings-animations-enabled');
        if (input) {
            input.checked = selected === 'full';
            const label = input.closest('.switch')?.querySelector('.switch-label');
            if (label) label.textContent = input.checked ? 'ON' : 'OFF';
        }
        return selected;
    }

    function applySidebar(sidebar, persist = true) {
        const selected = sidebar === 'collapsed' ? 'collapsed' : 'expanded';
        const settingsFocused = document.documentElement.dataset.workspacePage === 'settings';
        const collapsed = settingsFocused || selected === 'collapsed';
        document.documentElement.dataset.sidebarPreference = selected;
        document.documentElement.dataset.sidebar = collapsed ? 'collapsed' : 'expanded';
        document.querySelectorAll('[data-sidebar-choice]').forEach(button => {
            const active = button.dataset.sidebarChoice === selected;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
        });
        if (persist) localStorage.setItem(SIDEBAR_STORAGE_KEY, selected);

        const toggle = document.getElementById('sidebar-toggle');
        if (toggle) {
            toggle.hidden = settingsFocused;
            toggle.setAttribute('aria-pressed', String(collapsed));
            toggle.setAttribute('title', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
            toggle.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
        }

        document.querySelectorAll('.nav-tab').forEach((button) => {
            const label = button.dataset.pageLabel || button.title || 'Open page';
            button.setAttribute('aria-label', `Open ${label}`);
        });
        return selected;
    }

    const NOTIFICATION_ICONS = {
        success: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4.5 10.2 3.3 3.3 7.7-7.8"></path></svg>',
        error: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8"></path></svg>',
        warning: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 5.2v5.7M10 14.5v.2"></path></svg>',
        info: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 9v5M10 5.5v.2"></path></svg>'
    };
    const notificationTimers = new WeakMap();
    let pendingLegacyNotification = null;
    let notificationSequence = 0;

    function notificationKind(message, requestedKind = '') {
        if (['success', 'error', 'warning', 'info'].includes(requestedKind)) return requestedKind;
        const text = String(message || '').toLowerCase();
        if (/failed|failure|could not|error|invalid|unreachable/.test(text)) return 'error';
        if (/missing|must |no key|choose |required|warning|cannot|give the/.test(text)) return 'warning';
        if (/saved|updated|copied|refreshed|applied|created|imported|exported|restored|retrained|enabled|disabled|started|stopped|opened|closed|ready/.test(text)) return 'success';
        return 'info';
    }

    function statusIsPending(message) {
        return /(?:\.{3}|…)$/.test(message)
            || /^(saving|updating|refreshing|applying|restarting|training|testing|checking|loading|starting|stopping|opening|connecting|signing)/i.test(message);
    }

    function removeNotification(notification) {
        if (!notification?.isConnected || notification.classList.contains('is-leaving')) return;
        clearTimeout(notificationTimers.get(notification));
        notificationTimers.delete(notification);
        notification.classList.remove('is-visible');
        notification.classList.add('is-leaving');
        const remove = () => notification.remove();
        if (document.documentElement.dataset.motion === 'reduced') remove();
        else {
            notification.addEventListener('transitionend', event => {
                if (event.target === notification && event.propertyName === 'opacity') remove();
            });
            setTimeout(remove, 300);
        }
        if (pendingLegacyNotification === notification) pendingLegacyNotification = null;
    }

    function scheduleNotificationRemoval(notification, duration, persistent = false) {
        clearTimeout(notificationTimers.get(notification));
        notificationTimers.delete(notification);
        notification.classList.toggle('is-persistent', persistent);
        const progress = notification.querySelector('.notification-progress > i');
        if (progress) {
            progress.style.setProperty('--notification-duration', `${duration}ms`);
            progress.style.animation = 'none';
            void progress.offsetWidth;
            progress.style.animation = '';
        }
        if (!persistent) {
            notificationTimers.set(notification, setTimeout(() => removeNotification(notification), duration));
        }
    }

    function updateNotification(notification, options = {}) {
        const title = String(options.title || options.message || 'Updated').trim();
        const detail = String(options.detail || '').trim();
        const kind = notificationKind(`${title} ${detail}`, options.kind);
        const duration = Math.min(9000, Math.max(1800, Number(options.duration) || (kind === 'error' ? 6200 : 4200)));

        notification.className = `fury-notification fury-notification-${kind} is-visible`;
        notification.dataset.kind = kind;
        notification.dataset.updatedAt = String(Date.now());
        notification.setAttribute('role', kind === 'error' ? 'alert' : 'status');
        notification.setAttribute('aria-label', `${title}${detail ? `. ${detail}` : ''}`);
        notification.title = `${title}${detail ? `\n${detail}` : ''}`;
        notification.querySelector('.notification-icon').innerHTML = NOTIFICATION_ICONS[kind];
        notification.querySelector('.notification-kicker').textContent = options.kicker || (kind === 'success' ? 'Change applied' : kind === 'error' ? 'Action failed' : kind === 'warning' ? 'Needs attention' : 'In progress');
        notification.querySelector('.notification-title').textContent = title;
        const detailElement = notification.querySelector('.notification-detail');
        detailElement.textContent = detail;
        detailElement.hidden = !detail;
        scheduleNotificationRemoval(notification, duration, Boolean(options.persistent));
        return notification;
    }

    function createNotification(options = {}) {
        const stack = document.getElementById('notification-stack');
        if (!stack) return null;
        const notification = document.createElement('article');
        notification.dataset.notificationId = String(++notificationSequence);
        notification.innerHTML = `
            <span class="notification-edge" aria-hidden="true"></span>
            <span class="notification-icon"></span>
            <span class="notification-copy">
                <span class="notification-kicker"></span>
                <strong class="notification-title"></strong>
                <span class="notification-detail"></span>
            </span>
            <button type="button" class="notification-close" aria-label="Dismiss notification">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"></path></svg>
            </button>
            <span class="notification-progress" aria-hidden="true"><i></i></span>
        `;
        notification.querySelector('.notification-close').addEventListener('click', () => removeNotification(notification));
        updateNotification(notification, options);
        notification.classList.remove('is-visible');
        stack.prepend(notification);
        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (notification.isConnected && !notification.classList.contains('is-leaving')) notification.classList.add('is-visible');
        }));

        Array.from(stack.children).slice(4).forEach(removeNotification);
        return notification;
    }

    function showNotification(options) {
        const normalized = typeof options === 'string' ? { title: options } : { ...(options || {}) };
        const same = [...document.querySelectorAll('.fury-notification:not(.is-leaving)')].find(item =>
            Date.now() - Number(item.dataset.updatedAt || 0) < 1200
            && item.querySelector('.notification-title')?.textContent === String(normalized.title || normalized.message || 'Updated').trim()
            && item.querySelector('.notification-detail')?.textContent === String(normalized.detail || '').trim());
        if (same) return updateNotification(same, normalized);
        if (normalized.replacePending && pendingLegacyNotification?.isConnected) {
            const notification = updateNotification(pendingLegacyNotification, normalized);
            pendingLegacyNotification = null;
            return notification;
        }
        return createNotification(normalized);
    }

    function notifyFromLegacyStatus(status) {
        const message = String(status?.textContent || '').replace(/\s+/g, ' ').trim();
        if (!message || message.toLowerCase() === 'ready') {
            if (pendingLegacyNotification) removeNotification(pendingLegacyNotification);
            return;
        }

        const options = {
            title: status.dataset.notificationTitle || message,
            detail: status.dataset.notificationDetail || '',
            kind: status.dataset.notificationKind || '',
            kicker: status.dataset.notificationKicker || ''
        };
        delete status.dataset.notificationTitle;
        delete status.dataset.notificationDetail;
        delete status.dataset.notificationKind;
        delete status.dataset.notificationKicker;

        if (statusIsPending(message)) {
            options.persistent = true;
            options.kind = options.kind || 'info';
            options.kicker = options.kicker || 'Working';
            pendingLegacyNotification = pendingLegacyNotification?.isConnected
                ? updateNotification(pendingLegacyNotification, options)
                : createNotification(options);
            return;
        }

        options.replacePending = true;
        showNotification(options);
    }

    function initializeNotificationCenter() {
        const status = document.getElementById('save-status');
        if (!status) return;
        new MutationObserver(() => notifyFromLegacyStatus(status)).observe(status, {
            childList: true,
            characterData: true,
            subtree: true
        });
    }

    function showSavedStatus(message, detail = '', kind = '') {
        const status = document.getElementById('save-status');
        if (!status) return;
        if (detail) status.dataset.notificationDetail = detail;
        if (kind) status.dataset.notificationKind = kind;
        status.textContent = message;
        setTimeout(() => {
            if (status.textContent === message) status.textContent = 'Ready';
        }, 1200);
    }

    function initializeSettingDescriptions() {
        document.querySelectorAll('.feature-card, .feature-section-title, .appearance-option').forEach((card) => {
            const note = card.querySelector('.note');
            const text = note?.textContent?.replace(/\s+/g, ' ').trim();
            if (!text) return;
            card.dataset.settingDescription = text;
            note.classList.add('setting-description');
        });
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[char]));
    }

    function showSettingsPane(name) {
        document.querySelectorAll('[data-settings-subpage-button]').forEach((button) => {
            button.classList.toggle('active', button.dataset.settingsSubpageButton === name);
        });
        let activePane = null;
        document.querySelectorAll('[data-settings-subpage]').forEach((pane) => {
            const active = pane.dataset.settingsSubpage === name;
            pane.classList.toggle('active', active);
            if (active) activePane = pane;
        });
        const currentCategory = document.getElementById('settings-current-category');
        if (currentCategory) currentCategory.textContent = SETTINGS_CATEGORY_LABELS[name] || 'Appearance';
        return activePane;
    }

    function initializeSettingsSearch() {
        const input = document.getElementById('settings-search');
        const results = document.getElementById('settings-search-results');
        if (!input || !results) return;

        // The settings DOM is static after startup. Build the searchable text
        // once instead of walking the complete tree on every keypress.
        const entries = Array.from(document.querySelectorAll(
            '.feature-card, .appearance-option, .settings-search-item'
        )).map((element, index) => {
            const pane = element.closest('[data-settings-subpage]');
            const category = pane?.dataset.settingsSubpage || '';
            const label = element.dataset.settingsLabel || element.querySelector('h3, label')?.textContent?.replace('?', '').trim() || `Setting ${index + 1}`;
            const description = element.dataset.settingDescription || element.querySelector('.note')?.textContent?.trim() || '';
            return {
                element,
                category,
                label,
                description,
                searchText: `${label} ${description} ${category}`.toLowerCase()
            };
        });

        const render = () => {
            const query = input.value.trim().toLowerCase();
            if (!query) {
                results.classList.add('hidden');
                results.innerHTML = '';
                return;
            }
            const matches = entries
                .filter(entry => entry.searchText.includes(query))
                .slice(0, 8);
            results.innerHTML = matches.length
                ? matches.map((entry, index) => `
                    <button type="button" data-settings-result="${index}">
                        <strong>${escapeHtml(entry.label)}</strong>
                        <span>${escapeHtml(SETTINGS_CATEGORY_LABELS[entry.category] || entry.category.replace(/^\w/, value => value.toUpperCase()))}</span>
                    </button>
                `).join('')
                : '<div class="settings-search-empty">No matching settings</div>';
            results.classList.remove('hidden');
            results.querySelectorAll('[data-settings-result]').forEach((button) => {
                button.addEventListener('click', () => {
                    const entry = matches[Number(button.dataset.settingsResult)];
                    if (!entry) return;
                    const pane = showSettingsPane(entry.category);
                    input.value = '';
                    render();
                    document.querySelector('.settings-directory')?.classList.add('is-collapsed', 'is-lock-collapsed');
                    pane?.scrollIntoView({
                        behavior: document.documentElement.dataset.motion === 'reduced' ? 'auto' : 'smooth',
                        block: 'start'
                    });
                    entry.element.classList.add('settings-highlight');
                    setTimeout(() => entry.element.classList.remove('settings-highlight'), 1500);
                    entry.element.querySelector('input, select, button:not(.setting-help)')?.focus();
                });
            });
        };

        let renderFrame = null;
        const scheduleRender = () => {
            if (renderFrame !== null) return;
            renderFrame = requestAnimationFrame(() => {
                renderFrame = null;
                render();
            });
        };

        input.addEventListener('input', scheduleRender);
        input.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            input.value = '';
            render();
        });
    }

    function initialize() {
        applyTheme(localStorage.getItem(STORAGE_KEY) || document.documentElement.dataset.theme || 'graphite', false);
        applyAccent(localStorage.getItem(ACCENT_STORAGE_KEY) || document.documentElement.dataset.accent || 'sun', false);
        document.documentElement.dataset.density = 'comfortable';
        applySidebar(localStorage.getItem(SIDEBAR_STORAGE_KEY) || document.documentElement.dataset.sidebar || 'expanded', false);
        const storedMotion = localStorage.getItem(MOTION_STORAGE_KEY);
        applyMotion(storedMotion ? storedMotion === 'reduced' : true, false);
        initializeNotificationCenter();

        ['theme-select', 'settings-theme-select'].forEach((id) => {
            document.getElementById(id)?.addEventListener('change', (event) => {
                const selected = applyTheme(event.target.value);
                showSavedStatus('Theme updated', `Switched to the ${selected} theme.`, 'success');
            });
        });
        document.querySelectorAll('[data-theme-choice]').forEach((button) => {
            button.addEventListener('click', () => {
                const selected = applyTheme(button.dataset.themeChoice);
                showSavedStatus('Theme updated', `Switched to the ${selected} theme.`, 'success');
            });
        });
        document.getElementById('settings-animations-enabled')?.addEventListener('change', (event) => {
            const animationsEnabled = event.target.checked;
            applyMotion(!animationsEnabled);
            showSavedStatus(
                animationsEnabled ? 'Animations enabled' : 'Animations disabled',
                animationsEnabled ? 'Smooth page, control, and notification motion is on.' : 'Interface changes now appear immediately.',
                'success'
            );
        });
        document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
            const collapsed = document.documentElement.dataset.sidebar === 'collapsed';
            applySidebar(collapsed ? 'expanded' : 'collapsed');
            showSavedStatus(collapsed ? 'Sidebar expanded' : 'Sidebar collapsed');
        });
        document.querySelectorAll('[data-accent-preset]').forEach((button) => {
            button.addEventListener('click', () => {
                const selected = applyAccent(button.dataset.accentPreset);
                showSavedStatus('Accent updated', `${selected.replace(/^./, value => value.toUpperCase())} is now the interface accent.`, 'success');
            });
        });
        document.getElementById('settings-accent-custom')?.addEventListener('change', (event) => {
            if (!isHexColor(event.target.value)) return;
            applyAccent('custom', true, event.target.value);
            showSavedStatus('Custom accent updated', `${event.target.value.toUpperCase()} is now the interface accent.`, 'success');
        });
        initializeSettingDescriptions();
        initializeSettingsSearch();

        if (typeof window.require !== 'function') {
            document.querySelectorAll('[data-page-tab]').forEach((button) => {
                button.addEventListener('click', () => {
                    const page = button.dataset.pageTab;
                    document.querySelectorAll('[data-page-tab]').forEach(item => item.classList.toggle('active', item === button));
                    document.querySelectorAll('[data-page]').forEach(item => item.classList.toggle('active', item.dataset.page === page));
                    document.title = `Fury - ${button.textContent.trim()}`;
                });
            });
            document.querySelectorAll('[data-open-page]').forEach((button) => {
                button.addEventListener('click', () => {
                    const target = document.querySelector(`[data-page-tab="${button.dataset.openPage}"]`);
                    target?.click();
                });
            });
            document.querySelectorAll('[data-settings-subpage-button]').forEach((button) => {
                button.addEventListener('click', () => {
                    const page = button.dataset.settingsSubpageButton;
                    document.querySelectorAll('[data-settings-subpage-button]').forEach(item => item.classList.toggle('active', item === button));
                    document.querySelectorAll('[data-settings-subpage]').forEach(item => item.classList.toggle('active', item.dataset.settingsSubpage === page));
                });
            });
            document.querySelectorAll('[data-denick-subpage-button]').forEach((button) => {
                button.addEventListener('click', () => {
                    const page = button.dataset.denickSubpageButton;
                    document.querySelectorAll('[data-denick-subpage-button]').forEach(item => item.classList.toggle('active', item === button));
                    document.querySelectorAll('[data-denick-subpage]').forEach(item => item.classList.toggle('active', item.dataset.denickSubpage === page));
                });
            });
            document.getElementById('account-open')?.addEventListener('click', () => {
                document.getElementById('account-modal')?.classList.remove('hidden');
            });
            document.getElementById('account-close')?.addEventListener('click', () => {
                document.getElementById('account-modal')?.classList.add('hidden');
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize, { once: true });
    } else {
        initialize();
    }

    window.NesterTheme = {
        apply: applyTheme,
        applyAccent,
        applyMotion,
        applySidebar
    };
    window.FuryNotifications = {
        show: showNotification,
        dismissAll: () => document.querySelectorAll('.fury-notification').forEach(removeNotification)
    };
})();
