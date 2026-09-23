'use strict';

// Global API kill switch enforcement. Every feature in the proxy process does
// its HTTP through the shared axios singleton (hypixel client, urchin, seraph,
// aurora, mojang, and stat sources), so one request interceptor
// is the single chokepoint that guarantees nothing reaches an external API
// while the switch is ON. Localhost traffic (launcher,
// health API and cosmetic search) stays allowed. The Minecraft game
// connection itself uses minecraft-protocol TCP, not axios, so gameplay and
// login are unaffected.

const API_KILL_SWITCH_LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function isLocalAxiosRequest(config) {
    try {
        const base = String(config?.baseURL || '');
        const target = new URL(String(config?.url || ''), base || undefined);
        return API_KILL_SWITCH_LOCAL_HOSTS.has(target.hostname);
    } catch (e) {
        return false; // unparseable target -> treat as external and block
    }
}

function apiKillSwitchError() {
    const error = new Error('Blocked by API kill switch (all outbound API requests are paused).');
    error.code = 'API_KILL_SWITCH';
    error.apiKillSwitchBlocked = true;
    return error;
}

// `isEnabled` is a getter (not a boolean) so the switch applies live when
// /settings-changed reloads feature config mid-session.
function installApiKillSwitch(axiosInstance, isEnabled) {
    return axiosInstance.interceptors.request.use((config) => {
        if (isEnabled() && !isLocalAxiosRequest(config)) {
            return Promise.reject(apiKillSwitchError());
        }
        return config;
    });
}

module.exports = { installApiKillSwitch, isLocalAxiosRequest, apiKillSwitchError };
