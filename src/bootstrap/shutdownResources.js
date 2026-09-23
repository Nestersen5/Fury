'use strict';

// Retain accepted work even after its connection has left the active slot.
function createWorkDrain() {
    const pending = new Set();
    let failure = null;
    return {
        track(promise) {
            const work = Promise.resolve(promise);
            pending.add(work);
            work.then(() => pending.delete(work), () => {
                failure ||= new Error('Accepted persistence did not complete.');
                pending.delete(work);
            });
            return work;
        },
        async drain() {
            while (pending.size) await Promise.allSettled([...pending]);
            if (failure) throw failure;
        }
    };
}

function ownListener(server) {
    const sockets = new Set();
    let closing;
    server.on('connection', socket => {
        sockets.add(socket);
        socket.once('close', () => sockets.delete(socket));
        if (closing) socket.destroy();
    });
    return {
        quiesce() {
            if (!closing) closing = new Promise((resolve, reject) => {
                server.close(error => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve());
            });
            // The coordinator consumes errors in close(); attach a rejection
            // handler now because persistence drains before listener closure.
            closing.catch(() => {});
        },
        async close() {
            this.quiesce();
            for (const socket of sockets) socket.destroy();
            await closing;
        }
    };
}

// Use minecraft-protocol's existing Client seam, preserving its Authflow and
// credential/cache implementation. A completed refresh may never reconnect a
// client which has already ended or whose service is quiescing.
function createUpstreamOwner(mc) {
    const pending = new Set();
    let stopping = false;
    return {
        create(options) {
            let ended = false;
            class OwnedClient extends mc.Client {
                constructor(...args) {
                    super(...args);
                    let flow;
                    Object.defineProperty(this, 'authflow', {
                        get: () => flow,
                        set: value => {
                            flow = value;
                            const getToken = value.getMinecraftJavaToken.bind(value);
                            value.getMinecraftJavaToken = (...args) => {
                                const work = Promise.resolve(getToken(...args));
                                pending.add(work);
                                work.then(() => pending.delete(work), () => pending.delete(work));
                                return work;
                            };
                        }
                    });
                }
                end(...args) { ended = true; return super.end(...args); }
                setSocket(socket) {
                    if (ended || stopping) { socket.destroy(); return; }
                    return super.setSocket(socket);
                }
            }
            const ownedOptions = { ...options, Client: OwnedClient };
            const client = mc.createClient(ownedOptions);
            const connect = ownedOptions.connect;
            ownedOptions.connect = target => {
                if (!ended && !stopping) return connect(target);
            };
            // createClient mutates its options with the default TCP/DNS connector.
            // setSocket above also protects DNS callbacks already in flight.
            return client;
        },
        quiesce() { stopping = true; },
        async drain() { while (pending.size) await Promise.allSettled([...pending]); }
    };
}

module.exports = { createWorkDrain, ownListener, createUpstreamOwner };
