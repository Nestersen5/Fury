# Client-only layout previews

Restart the proxy and close other menus. Previews work anywhere while connected,
including other games and while airborne. Actual layout editing remains limited
to Bed Wars lobbies.

- `/quickbuy preview <player>` or `/qb preview <player>`
- `/hotbar preview <player>` or `/hb preview <player>`
- `/quickbuyandhotbar preview <player>` or `/qbahb preview <player>`

The combined chest shows Quick Buy in the upper three item rows, an empty
separator row, and hotbar positions 1–9 in the bottom row. Its close button is
in the upper-right corner. Gray panes represent empty positions.
Unknown Quick Buy item IDs show a labeled barrier instead of a guessed icon.
Items are display-only; they cannot be taken or applied from this menu.

Close with Escape, the Close preview button, `/qb preview close`, or `/qb cancel`.
Previews also close automatically after one minute. Existing short usage messages
are unchanged; `preview` and player names are available through tab completion.

All previews use the existing shared player lookup/cache. Combined previews need
both API fields and use a single profile lookup. No inventory is opened on the
server, and the preview module has no upstream transport.

## Isolation and lifecycle

- A client-packet interceptor and the central upstream transport both block fake
  inventory clicks, closes and acknowledgements. All click modes are local,
  including shift click, number-key swaps, dragging, double click and dropping.
- While open, other gameplay actions, creative inventory changes, held-item
  changes, custom payloads and outbound chat/completions are blocked. Necessary
  keep-alives, settings, resource-pack responses, recorded server transactions
  and normal position/look updates (including airborne movement) remain allowed.
  Previews do not freeze your position or move you back when closing.
- Predicted client inventory changes are repainted from preview and server
  inventory snapshots. Closing restores inventory, cursor and selected hotbar
  slot. Server inventory updates during preview update the cached snapshot and
  only changed visible player-inventory slots are sent to the client. Identical
  updates do not repaint the chest or reset the cursor/selection.
- Fake window IDs are never reused during the connection. Late packets for
  them remain blocked after closing. IDs already used by the server are avoided.
  A later server collision with a retired fake ID disconnects rather than risking
  forwarding a stale fake click as a real inventory click. Exhausting available
  IDs requires reconnecting.
- Real server menu openings, teleports, world changes,
  death and book-opening requests dismiss the preview. Movement, knockback,
  explosions and server-selected hotbar changes keep it
  open. Automatic closing displays a short reason in chat. Teleports never receive
  an old-position correction. Changing game modes alone does not close it.
- Lookup cancellation, disconnect and server state changes are rechecked before
  opening; cancelled requests cannot open a late preview. Lookups time out after
  15 seconds. Editing and previews cannot run concurrently.

Tests: `node tests/launcher/test_layout_preview.js` checks packet isolation and lifecycle and
serializes generated packets using the installed Minecraft 1.8.9 protocol codec.
These are offline simulations, not a guarantee about server enforcement or every
third-party client's behavior. Live verification is still required.
