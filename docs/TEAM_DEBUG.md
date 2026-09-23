# Wrong teams in Tab Stats and nametags

Restart the proxy once to load the capture command. When the problem appears,
run `/teamdebug` while still in that game. Recording starts automatically in
memory when Minecraft connects; there is no setup command to remember.

If you know a specific player's correct team, use `/teamdebug PlayerName Red`
(replace the name and team). This adds a note to the report and still captures
the whole roster. It does not change anyone's team or send the command to Hypixel.

The local chat and launcher console print the saved file's full path. Reports
are named `team-debug-<time>-<id>.json` under `diagnostics/teams` in Fury's data
folder. Run the command promptly, before leaving or changing games. The recent
packet history is capped at two minutes, 4,000 events, and 2 MiB of event JSON;
the report states its actual coverage and any dropped events. Current packet
views are tracked separately, so older current assignments can still be inspected.
Files are written only by the command, with a five-second cooldown. The command
stays hidden from the general command list and launcher navigation.

## Investigation so far

Both displays use `resolveBedwarsTeamDef` in `proxy.js`. It checks live raw
scoreboard membership first, then falls back to the cached player record and
the original display name. A shared wrong result can therefore affect both
surfaces without requiring two independent UI bugs.

The code already handles implicit moves between raw teams and keeps multiple
per-player raw teams under a normalized color. Its four-second audit checks
cached teams against live membership, but only for players already in the
game roster. It does not compare the final client packets with the server
packets. Snapshot restores, team resets, membership churn, and display-color
fallbacks are the paths to inspect if that audit does not resolve a mismatch.
These are investigation targets, not a confirmed cause of the reported incident.

The existing August 14 scoreboard recording contains 2,423 team packets,
including rapid create/update/add/remove/delete sequences for the same raw
team. It starts mid-game and its compact tab records omit display names. It
also does not record Fury's client output. It cannot establish which layer
produced the incorrect team in this incident, or establish server lag as the cause.

## What a new report captures

- Incoming server team, tab-identity/display, scoreboard, and world-boundary packets.
- Outgoing team and tab-display packets, including identity renames and restores.
- Independent current packet views for both directions.
- Fury's raw and normalized teams, roster, cached/live/resolved team per player,
  nametag state, identity renames, and relevant feature states.
- Assignment changes, game/reset transitions, snapshot restores, and audit corrections.
- The optional player/correct-team note.

The packet allowlist excludes chat, authentication, API responses/keys, movement,
and skin properties. Capturing does not rescan, repair, reset, or repaint the game;
it preserves the incorrect state for inspection.

## How to use the evidence

For the affected player, compare the incoming server membership with
`state.players[].rawTeam`, `cachedTeam`, `liveTeam`, and `resolvedTeam`. Compare
the rendered nickname/alias with the client packet view and its final tab display
and nametag prefix. Use event sequence numbers and timestamps to find the first
divergence, particularly around resets/restores and raw-team removals.

If incoming membership is correct but Fury's resolved team differs, reproduce
that packet sequence in a regression test and fix the resolver/state transition.
If the resolved team is correct but client output differs, fix the display or
restore path. If both agree but the screen differs, use the report together with
a screenshot and the Minecraft client/version to investigate client rendering.
Avoid adding another timer or guessing team colors before locating the divergence.

## Validation

`node tests/features/test_team_debug.js` checks packet replay, bounded history, capture-only file
writes, field filtering, write-method behavior, and hidden command completion.
`node tests/integration/test_team_debug_integration.js` runs the real proxy with isolated data and
local Minecraft protocol sockets. Authentication is bypassed only in that test
process. It checks the command during a simulated active BedWars game, verifies
both packet directions and the report state, and confirms the command stays local.
