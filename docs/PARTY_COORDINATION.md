# Coordinated party split checks

Fury prioritizes live server-ID comparisons with compatible Fury party members
and uses its existing join/Tab/entity/known-nick arrival checks for each member
who cannot be coordinated. Same server IDs establish the same pregame lobby,
not the same team after the game starts. No automatic leave command is added.

The desktop client connects outbound to `wss://furyproxy.online/party/connect`.
The Cloudflare Worker routes each network/party leader to a separate
hibernatable Durable Object. Other parties work independently of the developer
and of each other. Players only need an updated Fury; no Cloudflare account,
ports, manual party codes or hosting setup is needed.

## Authentication and sharing

After the existing Minecraft upstream login completes, the relay issues a
single-use random Minecraft session challenge. Fury submits it to Mojang using
the already connected account's session. The relay verifies ownership with
Mojang's `hasJoined` endpoint. Access tokens are sent only to Mojang, never to
Cloudflare. Failure leaves the existing checks available and never disconnects
Minecraft or forces sign-in. This extra session join must remain after upstream
login so it cannot race the initial Minecraft server authentication.

Each party member must list the other in their confirmed local roster before
the relay will deliver presence. This is mutual consent from authenticated
clients, not independent verification of party membership by Hypixel. A
modified client can misreport its own observations; these are coordination
signals from peers, not a server-issued attestation.

Shared fields are account name/UUID, confirmed roster, upstream network,
protocol version, phase, server ID, generation, sequence and a settling duration.
There are no gameplay packets, statistics, history, nick mappings or account
credentials in presence messages. Socket attachments retain only current
connection state across hibernation; presence is not persisted into a database.
Worker request logging is disabled.

## Correctness and limits

- A correlated fresh reply establishes each peer's baseline for this local lobby.
  Old probe IDs and non-increasing sequences are rejected.
- World changes invalidate the local ID immediately. A new ID-bearing scoreboard
  packet must release the transfer gate; lingering old sidebar text is insufficient.
- Both observations must settle for 1.5 seconds. A different server additionally
  requires a second stable observation at least 500 ms later.
- Discovery has a 2.5-second grace period once connected. Missing responses,
  unavailable IDs, transferring peers, incompatible clients and outages fall
  back per member. "Unreachable" does not mean "not using Fury."
- One compact heartbeat per connected client every 10 seconds refreshes presence;
  each peer observation expires after 15 seconds without a fresh message. Updates
  are otherwise change-driven, with one adaptive client timer and bounded buffers.
- Roster or leader changes invalidate the query scope. Fury's production Direct
  and Failover hosts share a network key. Other custom hosts are isolated and
  may fall back even if those aliases resolve to the same network.
- `/partycheck off` disables participation and warning sounds. The API kill switch
  also closes coordination and aborts pending authentication. Dismissal silences
  warnings for this lobby while presence remains available to party members.
- All connection/timer/authentication work is cancelled on disconnect or F7.

## Deployment

Requires a Cloudflare account with Workers, SQLite Durable Objects, and permission
to attach a Worker route to the existing `furyproxy.online` zone. The deployment
uses no new secrets or account IDs in checked-in files and does not modify the
website or download tracker routes.

```powershell
npx wrangler login
npx wrangler deploy --config cloudflare/party-coordination/wrangler.json
node scripts/verify_party_relay.js
```

The migration creates the `PartyRoom` Durable Object class. Health is available
at `https://furyproxy.online/party/health`. Deploying new relay code can interrupt
connections; clients retry with capped exponential backoff and use fallback
checks during the interruption. Keep wire version 1 compatible when deploying
relay changes independently of the desktop release.

For another host, set `FURY_PARTY_RELAY_URL` before launching Fury, or change the
public default in `src/party/coordinationProtocol.js` when distributing a build.
An empty environment override disables the relay. Remote addresses require WSS;
unencrypted WS is accepted only on localhost for development.

## Verification

```powershell
node tests/features/test_party_coordination.js
node tests/features/test_party_coordination_relay.js
node tests/integration/test_party_coordination.js
node tests/integration/test_party_coordination_proxy.js
node tests/features/test_party_arrival_check.js
node tests/integration/test_party_split_toggle.js
```

Synthetic tests inject Minecraft identity verification; they do not authenticate
real accounts. Verify with two or more real connected accounts before claiming
live Hypixel accuracy: same lobby, genuine split, nicked teammate, rapid requeue,
late ID, member/leader change, disabled feature, kill switch and relay outage.
Measure live warning latency and proxy event-loop delay with coordination on/off.

`node scripts/benchmarks/party_coordination.js` compares the unchanged pre-feature
checker from Git HEAD with fallback and fully coordinated checks. That baseline
was unmodified in the working tree at feature start. On Node 22.13.1, a synthetic
four-teammate/16-visible-player fixture (30,000 checks, seven alternating samples)
measured median 3.100 microseconds/check before, 3.266 for fallback, and 0.891 for
fully coordinated checks. Fully coordinated checks performed zero visible-name
projections versus 30,000 before. These are CPU-only checks, not network latency,
live frame timing or a claim of overall application speedup. Each client retains
at most 100 peer records and uses bounded message/buffer sizes.
