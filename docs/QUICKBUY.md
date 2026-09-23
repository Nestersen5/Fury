# Packet-driven Quick Buy editing

Run these commands while standing still on the ground in a Bed Wars lobby:

```
/quickbuy save rush
/quickbuy load rush
/quickbuy Goatinio2001
/quickbuy list
/quickbuy set 1 wool
/quickbuy set 21 golden apple
/quickbuy clear 2
/quickbuy test
/quickbuy cancel
```

Positions are numbered 1–21, left to right across each of the three rows.
Item matching ignores colors, case, underscores and trailing stack counts
such as `x16`. Include enchantments or potion durations when they appear in
the item's name. Presets are stored under the runtime data directory in
`quickbuy_presets/<name>.json`. Saving an existing name replaces that preset.

The proxy sends `/settings`, navigates to Bed Wars Settings and Edit Quick
Buy, and reads the current 21 slots. For replacements it opens the picker,
searches its pages, and sends the exact item payload last supplied by the
server. It waits for menu updates to settle between clicks, checks the
result after each replacement, and checks the entire layout after loading.
Unchanged slots are skipped. Clearing uses the editor's right-click action.
`/quickbuy <player name>` copies `player.stats.Bedwars.favourites_2` from
the player's Hypixel profile. Use `/quickbuy copy <player>` for a player
whose name conflicts with a subcommand such as `help` or `test`.

The lookup first reads the existing five-minute stats cache, which retains
the complete Bed Wars section. A recent in-game stats lookup can therefore
satisfy Quick Buy copying without another API request. A cache miss uses the
normal shared stats-fetch pipeline and its request deduplication/rate limits;
copying does not force a refresh. A missing `favourites_2` in a fresh cached
profile is reported as unavailable (possibly private), not retried immediately.
The five-minute period is the proxy's cache lifetime, not a claim about a
Hypixel per-player request prohibition.

The comma-separated field must contain exactly 21 positions. Literal `null`
entries become empty slots. Item identifiers are matched against the live
item NBT's `ExtraAttributes.databaseName`, so identifiers such as `shears`
and `wooden_pickaxe` do not have to match the displayed menu names. The loader
checks availability across the picker pages, reports unavailable identifiers
and their positions, then skips those positions while applying and verifying
the remaining items. Literal `null` positions are still cleared. Skipped
positions receive no direct edits; Hypixel can still empty one if its current
item is moved to another requested position. Completion reports the number
of skipped slots. The existing interaction lock stays active. The loader
rechecks lobby/standing state after fetching the profile. `/quickbuy cancel`
also works while the lookup is pending. A mid-load interruption can still
leave already-applied changes, as with loading a local preset.

## Faster loading

The loader sends the next click immediately after the expected replacement
menu and its complete `window_items` snapshot arrive. Hypixel sometimes omits
the old window's click acknowledgement when replacing it, so a validated new
menu confirms the transition. Updates inside the same window still wait for
the click acknowledgement. Late acknowledgements are handled separately.
There is no artificial snapshot delay or minimum click interval. It finishes
processing the current packet batch and rechecks the live menu before sending.
If relevant `set_slot` updates change the menu, it retains a 75 ms quiet
period for that incremental update path. Titles alone are insufficient:
settings must contain the navigation entry, the editor must contain all 21
positions, and a picker must contain choices and its Back control. Missing
or incomplete snapshots never trigger a click. Identical resends and changes
to the player's inventory do not restart the menu timer.

Item pages are cached for the connection and refreshed from live picker
contents. Where the menu advertises right-click to reach the first or last
page, the loader can use that shortcut for a known item. Live item names and
raw payloads are still checked before clicking; cached slot numbers are not
replayed. With the currently recorded two pages, a last-page shortcut still
takes one page click. Unchanged Quick Buy positions continue to be skipped.

Completion messages show elapsed time; test reports also include click counts.
Chat uses an aqua Quick Buy heading, green for success, yellow for skipped
items/cancellation, and red for errors. Skipped-item previews show up to three
items, followed by the remaining count, to avoid flooding chat.
Actual speed depends on server responses; a full layout has no guaranteed
1–2 second completion time. The interaction lock, cancellation and timeout
handling remain active at the faster speed.

## Tracking manual menu openings and edits

Restart the proxy, then run `/quickbuy trace start`. Manually open the Bed Wars
menu through the lobby item/NPC or `/settings`, navigate to Edit Quick Buy,
replace an item, change picker pages, and optionally remove an item. Close
the menu and run `/quickbuy trace stop`. This is a passive capture; it does
not click, replay payloads, lock controls, or restore your manual edits.
`/quickbuy trace mark <label>` adds a timeline marker, and `status` prints
the recording state and path. Capture stops automatically after 3 minutes
or 16 MiB, or on disconnect.

Files appear in `packet_logs/quickbuy_trace/` under the runtime data directory:

- `.jsonl`: timestamps, directions, menu context and packet data. Includes
  chat/commands, custom payloads, item/NPC interactions, inventory clicks,
  menu contents/NBT, tab completion and sign packets. Movement and keep-alive
  noise is omitted. Server chat components preserve clickable command hints.
- `.summary.json`: commands actually sent, custom-payload channels, menu
  openings and nearby outbound events. Proximity is not proof of causation.

`client` means received from the Minecraft client, even if later intercepted.
`upstream` means submitted to the server transport, with automation vs normal
relay/proxy origin labelled. `server` means received from Hypixel before
rewriting. Comparing these prevents local `/quickbuy` commands from being
mistaken for hidden server commands.

Binary payloads include base64, hex and UTF-8 views, with explicit truncation
markers beyond capture limits (64 KiB per binary value, 256 KiB per encoded
packet). Nothing captured is executed. This can reveal commands or payloads
sent across the connection; it cannot reveal internal server methods that
never appear on the wire.

## Live all-items test

After restarting the proxy, stand still in a Bed Wars lobby and run
`/quickbuy test`. No manual menu navigation is needed. Allow a few minutes.

The test saves your entire layout to a uniquely named `test-backup-...`
preset before changing anything. It discovers the available choices from
every live picker page, then attempts each item in position 1, including a
real click when that item is already selected. Progress appears in chat.
Each result is checked against the editor returned by the server. A failed
verification is logged, and testing continues only if the server has returned
to a recognized editor. Missing responses still trigger the interaction
lock's disconnect safeguard.

Selecting an item can remove it from another Quick Buy position, so the test
restores and verifies **all 21 positions**, not just position 1. Esc or
`/quickbuy cancel` stops testing and attempts restoration; cancel again to
stop restoration. If disconnected or restoration fails, reconnect and use
`/quickbuy load test-backup-...` with the backup name printed in chat (also
shown by `/quickbuy list`). Restoration cannot run after a disconnect.

Reports are written incrementally to
`quickbuy_presets/test-reports/test-<id>.jsonl` under the runtime data folder.
The filename is printed at test start. Reports include the backup name,
discovered catalog, per-item attempts/results, menu snapshots, outgoing
clicks, timeout step, and restoration result. They remain available even if
the connection is lost halfway through the test.

## Interaction lock

Menus open automatically and remain visible so Minecraft's own inventory
screen also blocks normal keyboard controls. The proxy blocks manual clicks,
movement, attacks, item use, drops, hotbar changes, chat, unrelated commands,
and other outgoing gameplay packets for the entire operation. The guard is
installed on the upstream write method, so other proxy features cannot send
gameplay commands during editing either. Blocked actions are discarded,
never queued for later. Keep-alives, transaction confirmations, client
settings, resource-pack status and stationary ground updates can pass.
Local movement is corrected to the starting position.

Esc requests cancellation. When a request is pending, the lock stays active
until its response arrives, then the proxy closes the server window before
unlocking. Changes already made remain applied. On a missing response,
operation timeout or server relocation, the connection is closed: the proxy
cannot safely assume an outstanding menu request has gone away. Reconnect
to resume. This is an interaction safeguard, not a guarantee about server
automation enforcement.

## Verification

`node tests/features/test_quickbuy.js` exercises the loader using menu fixtures extracted
from the September 15 recordings, including the actual second-page title
`(2/2) Adding to Quick Buy...` and `Empty slot!` placeholder. It covers
saving/loading, pagination, clearing, packet blocking, cancellation, timeout,
all 36 recorded choices, failure reporting, backup persistence, and restoring
items displaced from other positions. Server responses are simulated in
these offline tests; `/quickbuy test` performs the live verification.
