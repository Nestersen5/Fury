'use strict';

// Authenticate only after upstream login. Credentials never go to the relay;
// Mojang confirms ownership of the relay's single-use random challenge.
async function joinCoordinationChallenge(session, challenge, signal) {
    const { uuidKey, nameKey } = require('./coordinationProtocol');
    if (!session?.accessToken || !uuidKey(session.selectedProfile?.id)
        || !nameKey(session.selectedProfile?.name) || !/^[0-7][a-f0-9]{39}$/.test(challenge)) {
        throw new Error('Coordination identity unavailable');
    }
    const response = await fetch('https://sessionserver.mojang.com/session/minecraft/join', {
        method: 'POST', redirect: 'error', signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: session.accessToken,
            selectedProfile: uuidKey(session.selectedProfile.id), serverId: challenge })
    });
    if (response.status !== 204) throw new Error('Coordination authentication unavailable');
}
module.exports = { joinCoordinationChallenge };
