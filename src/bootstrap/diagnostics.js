'use strict';

// Hidden diagnostic tooling is opt-in and never part of a normal session.
// Normal startup opens only the configured direct, failover and health ports.
function diagnosticsEnabled(env = process.env) {
    return env.FURY_ENABLE_DIAGNOSTICS === '1';
}

module.exports = { diagnosticsEnabled };
