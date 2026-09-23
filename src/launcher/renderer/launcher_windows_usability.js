'use strict';

// Dependency labels describe saved/runtime state; they never disable configuration.
function dependencyStatus(state, { aurora = false } = {}) {
    if (aurora && !String(state?.settings?.keys?.aurora || '').trim()) return 'Needs Aurora';
    if (!state?.services?.proxy?.running) return 'Proxy stopped';
    if (!state?.proxyHealth?.connectedAccount) return 'Waiting for Minecraft';
    return '';
}

function mount({ document, navigate, invoke }) {
    const el = (tag, className, text) => {
        const node = document.createElement(tag);
        node.className = className || '';
        if (text) node.textContent = text;
        return node;
    };
    const button = (id, text, action) => {
        const node = el('button', '', text);
        node.type = 'button';
        node.id = id;
        node.addEventListener('click', action);
        return node;
    };
    const link = (host, id, text, category, target) => {
        host.append(button(id, text, () => navigate(category, document.querySelector(target))));
    };
    const identity = document.getElementById('real-identity-options');
    const identityLinks = el('div', 'fc-related-settings');
    link(identityLinks, 'identity-open-detection', 'Nickname detection', 'denick', '.denick-method-grid');
    identity.querySelector('.fc-group-copy').append(identityLinks);
    const detectionLinks = el('div', 'fc-related-settings fc-related-settings-footer');
    detectionLinks.append(el('span', 'note', 'Change in-game names and skins.'));
    link(detectionLinks, 'detection-open-identity', 'Identity display', 'display', '#real-identity-options');
    document.querySelector('.denick-settings-module').append(detectionLinks);

    document.getElementById('topbar-preferences').textContent = 'Settings';
    document.querySelector('[data-page="settings"] .page-title .note').textContent = 'Feature settings save automatically as you change them.';
    const profileCopy = document.querySelector('[data-page="profiles"] .page-title .note');
    if (profileCopy) profileCopy.textContent = profileCopy.textContent.replace('proxy preferences', 'proxy settings');
    document.querySelector('[data-settings-subpage-button="display"] strong').textContent = 'In-game appearance';
    document.querySelector('[data-settings-subpage-button="display"] small').textContent = 'Tab, nametags and colors';
    const display = document.querySelector('[data-settings-subpage="display"]');
    display.querySelector('.feature-section-title h2').textContent = 'In-game appearance';
    display.querySelector('.feature-section-title .note').textContent = 'Choose how names, stats and colors appear in Minecraft.';
    const colors = el('div', 'settings-subgroup');
    const colorsHead = el('div', 'settings-subgroup-head');
    colorsHead.append(el('h3', '', 'Chat & scoreboard'));
    colors.append(colorsHead, document.querySelector('.bedwars-event-accent-card'));
    display.append(colors);

    const dependencies = [];
    const badge = (host, id, options, clickable = false) => {
        const node = clickable
            ? button(id, '', () => navigate('api', document.querySelector('[data-api-card="aurora"]')))
            : el('span');
        node.id = id;
        node.classList.add('fc-dependency');
        node.setAttribute('role', clickable ? 'button' : 'status');
        node.hidden = true;
        host.append(node);
        dependencies.push({ node, options });
    };
    for (const category of ['scan', 'gameplay', 'sessions', 'denick', 'overlay', 'display']) {
        badge(document.querySelector(`[data-settings-subpage="${category}"] .feature-section-title`), `dependency-${category}`, {});
    }
    badge(document.getElementById('auto-stats-denick-enabled').closest('.denick-method-card')
        || document.getElementById('auto-stats-denick-enabled').closest('.fc-choice-card'), 'dependency-aurora', { aurora: true }, true);
    return {
        syncState(state) {
            for (const { node, options } of dependencies) {
                const text = dependencyStatus(state, options);
                // Page headers already carry connection dependencies; local labels add only specific requirements.
                const specific = node.id === 'dependency-aurora' ? text === 'Needs Aurora' : true;
                node.textContent = specific ? text : '';
                node.hidden = !specific || !text;
            }
        }
    };
}

module.exports = { mount, dependencyStatus };
