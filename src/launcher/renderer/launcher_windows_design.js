'use strict';

// Shared desktop design. The historical filename is retained by both packages.
function mount({ document, clipboard }) {
    document.documentElement.classList.add('windows-simple-design');
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = 'src/launcher/styles/launcher_windows_design.css';
    document.head.appendChild(stylesheet);

    const wordmark = document.querySelector('.proxy-wordmark');
    if (wordmark) wordmark.textContent = 'fury';

    const guide = document.querySelector('.dashboard-server-guide');
    if (!guide) return null;
    guide.setAttribute('aria-labelledby', 'join-proxy-title');
    guide.innerHTML = `
        <h2 id="join-proxy-title">How to join the proxy</h2>
        <ol class="join-steps">
            <li>Start the proxy using the play button next to the Fury logo.</li>
            <li>In Minecraft <strong>1.8.9</strong>, open <strong>Multiplayer &rarr; Add Server</strong>.</li>
            <li>Paste the direct address into <strong>Server Address</strong>, save, and join.</li>
        </ol>
        <div class="join-addresses">
            <div class="join-route">
                <label for="join-direct-address">Direct</label>
                <p id="join-direct-help">Use this for normal play.</p>
                <div class="join-address-field">
                    <input id="join-direct-address" type="text" readonly spellcheck="false"
                        aria-describedby="join-direct-help" value="" placeholder="Loading address&hellip;">
                    <button type="button" data-copy-route="direct" aria-label="Copy direct address" disabled>Copy</button>
                </div>
                <p class="join-destination">Connects to <span id="server-preview-direct-host">mc.hypixel.net</span></p>
            </div>
            <div class="join-route">
                <label for="join-failover-address">Proxy</label>
                <p id="join-failover-help">Try this if direct won't connect.</p>
                <div class="join-address-field">
                    <input id="join-failover-address" type="text" readonly spellcheck="false"
                        aria-describedby="join-failover-help" value="" placeholder="Loading address&hellip;">
                    <button type="button" data-copy-route="failover" aria-label="Copy proxy address" disabled>Copy</button>
                </div>
                <p class="join-destination">Connects to <span id="server-preview-failover-host">hypixel.fast</span></p>
            </div>
        </div>
        <div class="join-footer">
            <p>Keep Fury open while you play.</p>
            <span class="join-copy-status" role="status" aria-live="polite" aria-atomic="true"></span>
        </div>`;

    const status = guide.querySelector('.join-copy-status');
    const routes = ['direct', 'failover'].map(name => {
        const input = guide.querySelector(`#join-${name}-address`);
        const button = guide.querySelector(`[data-copy-route="${name}"]`);
        let feedbackTimer;
        const resetFeedback = () => {
            clearTimeout(feedbackTimer);
            button.textContent = button.dataset.copyLabel || 'Copy';
            button.classList.remove('is-copied');
        };
        input.addEventListener('focus', () => input.select());
        input.addEventListener('click', () => input.select());
        button.addEventListener('click', () => {
            if (!input.value) return;
            resetFeedback();
            try {
                clipboard.writeText(input.value);
                button.textContent = 'Copied';
                button.classList.add('is-copied');
                status.textContent = `${name === 'direct' ? 'Direct' : 'Proxy'} address copied.`;
                feedbackTimer = setTimeout(resetFeedback, 1800);
            } catch {
                input.focus();
                input.select();
                status.textContent = `Press ${process.platform === 'darwin' ? 'Cmd' : 'Ctrl'}+C to copy the selected address.`;
            }
        });
        return { name, input, button, resetFeedback };
    });

    return {
        renderAddresses(values) {
            for (const route of routes) {
                const address = `localhost:${values[`${route.name}Port`]}`;
                if (route.input.value !== address) {
                    route.input.value = address;
                    route.resetFeedback();
                    status.textContent = '';
                }
                route.button.disabled = false;
            }
        }
    };
}

module.exports = { mount };
