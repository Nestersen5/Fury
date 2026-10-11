export { PartyRoom } from './core.mjs';

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname === '/party/health') return Response.json({ ok: true, version: 1 });
        if (url.pathname !== '/party/connect' || request.method !== 'GET') return new Response('Not found', { status: 404 });
        const leader = url.searchParams.get('leader'), network = url.searchParams.get('network');
        if (!/^[A-Za-z0-9_]{1,16}$/.test(leader || '')
            || !/^[a-z0-9.-]{1,100}:\d{1,5}$/.test(network || '')
            || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Invalid connection', { status: 400 });
        const room = env.PARTIES.idFromName(`${network}:${leader.toLowerCase()}`);
        return env.PARTIES.get(room).fetch(request);
    }
};
