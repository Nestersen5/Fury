# Hotbar and combined layouts

Restart the proxy to register the commands. Stand still on the ground and close
any open menu before starting. Commands, player names and existing preset names
have tab completion.

| Action | Hotbar | Quick Buy and hotbar |
| --- | --- | --- |
| Copy player | `/hotbar <player>` | `/quickbuyandhotbar <player>` |
| Save own layout | `/hotbar save <preset>` | `/quickbuyandhotbar save <preset>` |
| Load preset | `/hotbar load <preset>` | `/quickbuyandhotbar load <preset>` |
| List presets | `/hotbar list` | `/quickbuyandhotbar list` |
| Cancel | `/hotbar cancel` | `/quickbuyandhotbar cancel` |

Aliases: `/qb` = `/quickbuy`, `/hb` = `/hotbar`, `/qbahb` = `/quickbuyandhotbar`.

Hotbar copies read `player.stats.Bedwars.favorite_slots`, a comma-separated
list of nine categories. Literal `null` clears that position. Repeated categories
are allowed. The existing shared player cache retains both this field and
`favourites_2`; copying uses the cached profile without another API request while
fresh. Missing/private data does not force a refresh. Combined copies fetch one
profile and validate both fields before opening any menus.

Presets are independent: Quick Buy uses `quickbuy_presets/<name>.json`, hotbar
uses `quickbuy_presets/hotbar/<name>.json`, and combined presets use
`quickbuy_presets/quickbuyandhotbar/<name>.json`. Combined files contain both
layouts and are written atomically after both editors have been read.

Combined editing completes Quick Buy, returns to Bed Wars Settings, then opens
Hotbar Manager without releasing the interaction lock or restarting `/settings`.
Unavailable Quick Buy items retain the existing skip behavior. Hotbar skips
already-correct positions. Each changed nonempty position takes a category click
and a destination click; occupied positions are replaced directly. Clearing uses
one destination click with an empty cursor.

Hotbar progression uses the server's cursor and destination updates, with no
artificial delay and no dependency on absent transaction acknowledgements.
Pickup requires the expected category on the cursor. Placement requires a fresh
destination update and an empty cursor. Closing waits for an empty-cursor response
before releasing the lock. Esc cancels after the outstanding response; completed
changes remain applied. Timeouts and relocation retain the existing disconnect
fallback. Cancellation does not roll back either layout.

Offline verification: `node tests/features/test_hotbar.js`, using the recorded Hotbar Manager
fixture. Covers cache reads, aliases/completion, save/load, combined ordering,
replacement, clearing, skipping, cancellation and missing responses. Live Hypixel
automation still needs verification by running the commands.
