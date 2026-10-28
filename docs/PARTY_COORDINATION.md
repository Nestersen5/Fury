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
An optional `nicknames-v1` extension shares the sender's freshly checked current
nickname, game mode, server ID, claim ID and receiving preference. There are no
gameplay packets, statistics, nickname history or account credentials in these
messages. Socket attachments retain only current
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
- `/partycheck off` disables split warnings. Nickname participation has separate
  controls and can keep the authenticated connection open. The API kill switch
  also closes coordination and aborts pending authentication. Dismissal silences
  warnings for this lobby while presence remains available to party members.
- All connection/timer/authentication work is cancelled on disconnect or F7.

## Party nickname exchange

Teammate nickname inference and received nickname saving are always enabled.
Own nickname sharing defaults on and can be changed in launcher Nicknames
settings or with /denick sharenick on|off. A second-line Turn off sharing button
follows the shared notice. The global API kill switch still pauses network sharing.

Own nickname tracking uses fresh upstream tab entries anchored to own UUID or
an explicit own-nickname chat observation. Ambiguous entries are skipped. It
keeps older nicknames in the ordinary local denick history (`own_nick`) and
publishes only the current observed nickname, never an unnicked real IGN.
Private tracking continues while the API kill switch pauses sharing. This task is deferred for eight
seconds after a world/game boundary and waits behind scheduled/running scans;
it does not fetch player profiles or alter scan detection state.

Sharing requires a recognized active BedWars, SkyWars or Duels game and a fresh
server ID. Other modes wait for reliable start detection. Claims are accepted
only from fresh, correlated authenticated party peers in the same mode/server,
with the nick present in the receiver's current upstream tab. BedWars additionally
requires the same team; known Duels opponents are excluded. Duplicate claims,
conflicting saved matches, explicit removals and stale game work cannot save.
Successful mappings use the existing denick history/live update path with source
`party_shared`. Existing BedWars reviews are refreshed to account for newly known
members before computing remaining variations.

The receiver sees a received/saved notice and Undo for a newly saved match.
Only a valid receiver acknowledgement causes the sender's shared notice.
Notices deduplicate per claim/peer. The sender can turn off own nickname sharing from the second-line button.
No party-chat broadcast is added by this exchange.

The relay advertises extension support in `ready`. Older relays receive the
original v1 messages and nickname exchange stays unavailable; existing split
checks continue. Deploy the updated relay separately before expecting this
feature to work outside local verification.

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
node tests/features/test_party_nickname_sharing.js
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
