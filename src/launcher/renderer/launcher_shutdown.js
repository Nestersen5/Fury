'use strict';
function installRendererShutdown(ipc, flush) {
    let operation;
    ipc.on('shutdown:prepare-renderer', (event, message) => {
        if (message?.version !== 1 || typeof message.requestId !== 'string') return;
        operation ||= Promise.resolve().then(flush).then(() => true, () => false);
        operation.then(clean => ipc.send('shutdown:renderer-complete', { version: 1, requestId: message.requestId, clean }));
    });
}
module.exports = { installRendererShutdown };
