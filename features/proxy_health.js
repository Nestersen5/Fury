'use strict';

const { performance } = require('perf_hooks');
const chatController = require('./chat_controller.js');
const { createFeatureStatus } = require('./feature_panel.js');

const DEFAULT_PAUSED_FEATURES = [
    'cosmetic packet detection',
    'tabstats refresh',
    'lobby chat stat annotation'
];

const DEFAULT_PROXY_HEALTH_OPTIONS = Object.freeze({
    sampleMs: 500,
    lagWarnMs: 160,
    lagCriticalMs: 350,
    lagEmaWarnMs: 90,
    throttleMs: 15000,
    warnCooldownMs: 20000,
    sleepDriftMs: 5000
});

function blankProxyHealthState(performanceNow = () => 0) {
    return {
        lastSampleAt: performanceNow(),
        eventLoopLagMs: 0,
        eventLoopLagEmaMs: 0,
        maxEventLoopLagMs: 0,
        badSamples: 0,
        throttledUntil: 0,
        throttleReason: '',
        throttleCount: 0,
        lastWarningAt: 0,
        wasThrottled: false
    };
}

class ProxyHealthMonitor {
    constructor(options = {}) {
        this.options = {
            ...DEFAULT_PROXY_HEALTH_OPTIONS,
            ...(options.healthOptions || {})
        };
        this.pausedFeatures = Array.isArray(options.pausedFeatures)
            ? options.pausedFeatures.slice()
            : DEFAULT_PAUSED_FEATURES.slice();
        this.now = typeof options.now === 'function' ? options.now : Date.now;
        this.performanceNow = typeof options.performanceNow === 'function' ? options.performanceNow : () => performance.now();
        this.setInterval = typeof options.setInterval === 'function' ? options.setInterval : setInterval;
        this.isEnabled = typeof options.isEnabled === 'function' ? options.isEnabled : () => true;
        this.setEnabled = typeof options.setEnabled === 'function' ? options.setEnabled : () => {};
        this.saveSettings = typeof options.saveSettings === 'function' ? options.saveSettings : () => {};
        this.sendNotice = typeof options.sendNotice === 'function' ? options.sendNotice : () => {};
        this.clearExpensiveQueues = typeof options.clearExpensiveQueues === 'function' ? options.clearExpensiveQueues : () => {};
        this.pauseExpensiveFeatures = typeof options.pauseExpensiveFeatures === 'function' ? options.pauseExpensiveFeatures : () => {};
        this.state = blankProxyHealthState(this.performanceNow);
    }

    enabled() {
        return Boolean(this.isEnabled());
    }

    resetThrottle() {
        this.state.throttledUntil = 0;
        this.state.throttleReason = '';
        this.state.wasThrottled = false;
        this.state.badSamples = 0;
    }

    isAutoThrottleActive(now = this.now()) {
        return this.enabled() && now < this.state.throttledUntil;
    }

    autoThrottleRemainingMs(now = this.now()) {
        return Math.max(0, this.state.throttledUntil - now);
    }

    snapshot(now = this.now()) {
        return {
            enabled: this.enabled(),
            throttled: this.isAutoThrottleActive(now),
            throttledUntil: this.state.throttledUntil || null,
            throttleRemainingMs: this.autoThrottleRemainingMs(now),
            throttleReason: this.state.throttleReason,
            throttleCount: this.state.throttleCount,
            eventLoopLagMs: Math.round(this.state.eventLoopLagMs),
            eventLoopLagEmaMs: Math.round(this.state.eventLoopLagEmaMs),
            maxEventLoopLagMs: Math.round(this.state.maxEventLoopLagMs),
            badSamples: this.state.badSamples,
            pausedFeatures: this.isAutoThrottleActive(now) ? this.pausedFeatures.slice() : []
        };
    }

    activateAutoThrottle(reason, durationMs = this.options.throttleMs) {
        if (!this.enabled()) return false;
        const now = this.now();
        const wasActive = this.isAutoThrottleActive(now);
        this.state.throttledUntil = Math.max(this.state.throttledUntil, now + durationMs);
        this.state.throttleReason = reason;
        this.state.throttleCount += wasActive ? 0 : 1;
        this.state.wasThrottled = true;

        if (!wasActive) {
            this.clearExpensiveQueues();
            this.pauseExpensiveFeatures();
        }

        if (!wasActive || now - this.state.lastWarningAt >= this.options.warnCooldownMs) {
            this.state.lastWarningAt = now;
            this.sendNotice(
                `\u00a76[Fury Health] \u00a7cProxy lag detected \u00a78(${reason})\u00a7c. `
                + `\u00a77Temporarily pausing cosmetics, tabstats, and lobby chat stat annotations for \u00a7e${Math.ceil(durationMs / 1000)}s\u00a77.`
            );
        }
        return true;
    }

    sample() {
        if (!this.enabled()) {
            this.state.lastSampleAt = this.performanceNow();
            this.resetThrottle();
            return this.snapshot();
        }

        const nowPerf = this.performanceNow();
        const expected = this.state.lastSampleAt + this.options.sampleMs;
        const lag = Math.max(0, nowPerf - expected);
        this.state.lastSampleAt = nowPerf;

        if (lag > this.options.sleepDriftMs) {
            this.state.badSamples = 0;
            return this.snapshot();
        }

        this.state.eventLoopLagMs = lag;
        this.state.eventLoopLagEmaMs = this.state.eventLoopLagEmaMs
            ? (this.state.eventLoopLagEmaMs * 0.82) + (lag * 0.18)
            : lag;
        this.state.maxEventLoopLagMs = Math.max(this.state.maxEventLoopLagMs, lag);

        const bad = lag >= this.options.lagWarnMs
            || this.state.eventLoopLagEmaMs >= this.options.lagEmaWarnMs;
        this.state.badSamples = bad
            ? Math.min(10, this.state.badSamples + 1)
            : Math.max(0, this.state.badSamples - 1);

        if (lag >= this.options.lagCriticalMs) {
            this.activateAutoThrottle(`${Math.round(lag)}ms event-loop delay`);
        } else if (this.state.badSamples >= 3) {
            this.activateAutoThrottle(`${Math.round(this.state.eventLoopLagEmaMs)}ms sustained event-loop delay`);
        }

        const now = this.now();
        if (this.state.wasThrottled && !this.isAutoThrottleActive(now)) {
            this.state.wasThrottled = false;
            this.state.throttleReason = '';
            this.state.badSamples = 0;
            this.sendNotice('\u00a76[Fury Health] \u00a7aProxy recovered. \u00a77Optional packet features resumed.');
        }
        return this.snapshot(now);
    }

    start() {
        const timer = this.setInterval(() => this.sample(), this.options.sampleMs);
        if (typeof timer?.unref === 'function') timer.unref();
        return timer;
    }

    renderStatus(client, sendChat = () => {}) {
        const snapshot = this.snapshot();
        const panel = createFeatureStatus({
            client, sendChat, title: 'Proxy Health', subtitle: 'LAG SAFEGUARD',
            section: 'system', helpTopic: 'proxyhealth'
        });
        const stateLabel = !snapshot.enabled
            ? 'disabled'
            : snapshot.throttled
                ? `${Math.ceil(snapshot.throttleRemainingMs / 1000)}s throttle`
                : 'healthy';

        panel.open();
        panel.section('Overview');
        panel.toggleRow('Protection', snapshot.enabled, '/proxyhealth on', '/proxyhealth off',
            'Warn about proxy lag and temporarily pause optional packet work.');
        panel.valueRow('State', stateLabel, {
            color: snapshot.throttled ? 'red' : snapshot.enabled ? panel.colors.active : panel.colors.quiet
        });
        if (snapshot.throttled && snapshot.throttleReason) {
            panel.valueRow('Reason', snapshot.throttleReason, { color: 'red' });
        }

        panel.section('Event loop');
        panel.valueRow('Current', `${snapshot.eventLoopLagMs}ms`);
        panel.valueRow('Smoothed', `${snapshot.eventLoopLagEmaMs}ms`, { color: 'white' });
        panel.valueRow('Peak', `${snapshot.maxEventLoopLagMs}ms`, { color: 'white' });

        panel.section('Automatic response');
        panel.valueRow('Triggers', `lag ${this.options.lagCriticalMs}ms / avg ${this.options.lagEmaWarnMs}ms`, { color: 'white' });
        panel.valueRow('Pause length', `${Math.ceil(this.options.throttleMs / 1000)}s`, { color: 'white' });
        panel.row([chatController.component('Pauses cosmetics, Tab Stats, and chat stats.', panel.colors.muted)]);
        panel.close();
        return snapshot;
    }

    handleCommand(client, args = [], sendChat = () => {}) {
        const subCmd = String(args[1] || 'status').toLowerCase();
        if (['on', 'enable', 'enabled'].includes(subCmd)) {
            this.setEnabled(true);
            this.saveSettings();
            return { ok: true, action: 'enable', snapshot: this.renderStatus(client, sendChat) };
        }
        if (['off', 'disable', 'disabled'].includes(subCmd)) {
            this.setEnabled(false);
            this.resetThrottle();
            this.saveSettings();
            return { ok: true, action: 'disable', snapshot: this.renderStatus(client, sendChat) };
        }

        const snapshot = this.renderStatus(client, sendChat);
        return { ok: true, action: 'status', snapshot };
    }
}

function createProxyHealthMonitor(options = {}) {
    return new ProxyHealthMonitor(options);
}

module.exports = {
    DEFAULT_PAUSED_FEATURES,
    DEFAULT_PROXY_HEALTH_OPTIONS,
    blankProxyHealthState,
    ProxyHealthMonitor,
    createProxyHealthMonitor
};
