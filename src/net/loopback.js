'use strict';

const net = require('net');
const { ownListener } = require('../bootstrap/shutdownResources');

// The primary listener binds 127.0.0.1. Deliver IPv6 loopback sockets to its
// existing protocol handler, retaining one Minecraft/HTTP application owner.
// No wildcard bind, TCP relay or separate protocol/authentication implementation.
function ownIpv6Loopback(primary, logger = console) {
    let stopping = false;
    const abort = new AbortController();
    const server = net.createServer(socket => {
        if (stopping) socket.destroy();
        else primary.emit('connection', socket);
    });
    const owner = ownListener(server);
    server.on('error', error => {
        if (stopping) return;
        if (['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) {
            logger.warn('[Network] IPv6 loopback is unavailable; IPv4 loopback remains active.');
        } else {
            // A port conflict must not silently send ::1 clients to another app.
            primary.emit('error', error);
        }
    });
    const start = () => {
        if (stopping) return;
        const address = primary.address();
        if (address && typeof address === 'object') {
            server.listen({ port: address.port, host: '::1', ipv6Only: true, signal: abort.signal });
        }
    };
    function quiesce() {
        stopping = true;
        primary.removeListener('listening', start);
        abort.abort();
        owner.quiesce();
    }
    primary.once('close', quiesce);
    if (primary.listening) start();
    else primary.once('listening', start);
    return {
        quiesce,
        async close() {
            quiesce();
            await owner.close();
            primary.removeListener('close', quiesce);
        }
    };
}

module.exports = { ownIpv6Loopback };
