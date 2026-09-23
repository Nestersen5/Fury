'use strict';

const assert = require('assert');
const {
    DEFAULT_PAUSED_FEATURES,
    DEFAULT_PROXY_HEALTH_OPTIONS,
    createProxyHealthMonitor
} = require('../../features/proxy_health.js');

let enabled = true;
let now = 1000;
let perf = 0;
let saved = 0;
let clearedQueues = 0;
let pausedFeatures = 0;
const notices = [];
const chatMessages = [];
const timers = [];

function messageText(value) {
    if (Array.isArray(value)) return value.map(messageText).join('');
    if (!value || typeof value !== 'object') return String(value || '');
    return String(value.text || '') + Object.values(value).map(messageText).join('');
}

const monitor = createProxyHealthMonitor({
    isEnabled: () => enabled,
    setEnabled: value => {
        enabled = Boolean(value);
    },
    saveSettings: () => {
        saved += 1;
    },
    sendNotice: message => notices.push(message),
    clearExpensiveQueues: () => {
        clearedQueues += 1;
    },
    pauseExpensiveFeatures: () => {
        pausedFeatures += 1;
    },
    now: () => now,
    performanceNow: () => perf,
    setInterval: (callback, delayMs) => {
        const timer = { callback, delayMs, unrefCalled: false, unref() { this.unrefCalled = true; } };
        timers.push(timer);
        return timer;
    }
});

assert.strictEqual(DEFAULT_PROXY_HEALTH_OPTIONS.sampleMs, 500, 'Proxy health should sample frequently enough for lag detection');
assert(DEFAULT_PAUSED_FEATURES.includes('cosmetic packet detection'), 'Proxy health should document paused optional features');

assert.strictEqual(monitor.activateAutoThrottle('test delay', 15000), true, 'Manual activation should enable auto-throttle');
assert.strictEqual(clearedQueues, 1, 'First throttle activation should clear expensive queues');
assert.strictEqual(pausedFeatures, 1, 'First throttle activation should pause expensive live features');
assert.strictEqual(notices.length, 1, 'First throttle activation should send a health warning');
assert(notices[0].includes('test delay'), 'Health warning should include the throttle reason');

const activeSnapshot = monitor.snapshot();
assert.strictEqual(activeSnapshot.throttled, true, 'Snapshot should report active throttle');
assert.strictEqual(activeSnapshot.throttleRemainingMs, 15000, 'Snapshot should report remaining throttle time');
assert.deepStrictEqual(activeSnapshot.pausedFeatures, DEFAULT_PAUSED_FEATURES, 'Snapshot should expose paused features while throttled');
assert.strictEqual(activeSnapshot.throttleCount, 1, 'Throttle count should increment only for a new throttle window');

monitor.activateAutoThrottle('same window', 15000);
assert.strictEqual(clearedQueues, 1, 'Repeated activation in the same window should not clear queues again');
assert.strictEqual(pausedFeatures, 1, 'Repeated activation in the same window should not pause features again');
assert.strictEqual(monitor.snapshot().throttleCount, 1, 'Throttle count should not increment for repeated active-window triggers');

now = 2000;
perf = 900;
monitor.sample();
assert.strictEqual(monitor.snapshot().throttled, true, 'Critical event-loop lag sample should keep throttle active');
assert(monitor.snapshot().eventLoopLagMs >= 350, 'Critical sample should record the current lag');

now = 18000;
perf = 1400;
monitor.sample();
assert.strictEqual(monitor.snapshot().throttled, false, 'Throttle should recover after the window expires');
assert(notices.some(message => message.includes('Proxy recovered')), 'Recovery should send a health notice');

monitor.handleCommand(null, ['/proxyhealth', 'off'], (_client, message) => chatMessages.push(message));
assert.strictEqual(enabled, false, '/proxyhealth off should disable health warnings');
assert.strictEqual(saved, 1, '/proxyhealth off should save feature settings');
assert.strictEqual(monitor.snapshot().enabled, false, 'Disabled snapshot should report warnings off');
assert(chatMessages.some(message => messageText(message).includes('disabled')), '/proxyhealth off should render the disabled state');

monitor.handleCommand(null, ['/proxyhealth', 'on'], (_client, message) => chatMessages.push(message));
assert.strictEqual(enabled, true, '/proxyhealth on should enable health warnings');
assert.strictEqual(saved, 2, '/proxyhealth on should save feature settings');
assert(chatMessages.some(message => messageText(message).includes('healthy')), '/proxyhealth on should render the healthy state');

monitor.handleCommand(null, ['/proxyhealth', 'status'], (_client, message) => chatMessages.push(message));
assert(chatMessages.some(message => messageText(message).includes('Proxy Health')), '/proxyhealth status should render a readable controller');

const timer = monitor.start();
assert.strictEqual(timer.delayMs, DEFAULT_PROXY_HEALTH_OPTIONS.sampleMs, 'Proxy health monitor should start at the configured sample interval');
assert.strictEqual(timer.unrefCalled, true, 'Proxy health monitor interval should not keep the process open by itself');

console.log('Proxy health monitor tests passed.');
