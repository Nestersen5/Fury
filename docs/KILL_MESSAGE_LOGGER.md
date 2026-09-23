# Kill-message preview logger

Restart the proxy after updating, join a Bed Wars lobby, turn Rainbow Kill
Messages off, close any open menu, and stand still on the ground. Keep the
Bed Wars Menu emerald in your hotbar.

```text
/kmlog start
/kmlog status
/kmlog cancel
```

The logger opens the Bed Wars Menu using its actual hotbar item, navigates
through My Cosmetics to Kill Messages, and right-clicks each entry advertising
a preview. It visits subsequent pages using their live navigation controls.
Locked cosmetics with previews are included. DEFAULT and random-selection
entries that offer no preview are listed as skipped. It never buys, selects,
or favorites a cosmetic. The Rainbow setting is not changed automatically.

Each click waits for the Chat Messages block to end, the return teleport to the
original location to be acknowledged, and a complete returned menu before
proceeding. The recorded menu return takes about four seconds, but the
logger follows server responses rather than a fixed delay. The existing menu
automation lock blocks movement, manual clicks and competing menu operations.
Esc or `/kmlog cancel` stops after the pending server response is resolved.
The preview's teleport to its viewing location and back is allowed while that
preview is pending. The movement lock follows the server's destination, including
relative position packets, and lets the client's teleport acknowledgements through.
The recorded preview also makes a two-block horizontal camera adjustment and
repeats it. Those corrections are accepted within two blocks of the initial
preview destination, at the same height; the boundary does not move with each
correction.
The logger also lets a returned menu settle for one second before advancing.
If Hypixel explicitly says it is already in a menu before a preview starts,
the logger waits one second and retries, at most twice. Continued explicit
refusals stop the run and save progress without disconnecting. These refusals
are included in the report's `previewRejections` list. Missing responses still
use the existing timeout guard.
Cancellation also waits for the return. An unresolved response timeout, world
change, or unrelated relocation ends the connection instead of releasing an
uncertain menu operation into gameplay. QuickBuy's relocation guard is unchanged.

Each run writes a separate JSON file under the runtime data directory:

```text
packet_logs/kill_messages/kill-messages-<timestamp>-<id>.json
```

The exact path is printed in chat. The report includes the connected account,
pages visited, attempted and skipped cosmetics, and each successfully recorded
cosmetic's preview lines in their original order. Each line has a one-based
position, plain text, legacy formatted text, and the original chat JSON string.
Preview positions are not assigned guessed event labels. These captures are
separate from the manual `/km` detection-pattern store and do not change the
cosmetic detection engine.

Progress is atomically saved after each cosmetic and again at the end. Partial
runs are marked cancelled or failed and identify the unfinished cosmetic.
Previously saved runs are not overwritten. The active run's file is also
available through `/kmlog status`.
The report retains the last 16 relocation decisions, including packet fields,
the previous anchor and preview state. Failed or cancelled runs also retain
the interrupted preview's lines separately from successfully recorded cosmetics.

The final chat summary and JSON summary contain:

- Successfully recorded cosmetics and total preview lines.
- Unique wording and duplicate occurrences beyond the first occurrence.
- Every duplicated wording, with all cosmetic names and preview positions.
- Entries with no preview, and unfinished captures when interrupted.

Duplicate comparison ignores formatting and normalizes whitespace. It otherwise
compares the actual text, including player names and counters. Three occurrences
of one wording count as one unique message and two duplicate occurrences. Shared
wording and consecutive identical lines are always retained; only a cosmetic
already successfully captured during the same run is skipped on re-encounter.

Validation: `node tests/features/test_kill_message_logger.js` uses sanitized menus and previews
from the recorded trace, including locked cosmetics, six/seven-line previews,
pagination, duplicates, delayed contents/chat, absolute and relative preview
teleports, return acknowledgements, cancellation, timeouts, unrelated relocations,
disconnects, and write failures. Future `/quickbuy trace` captures include server
teleport packets; the original menu trace omitted them. Live full-catalog validation is still needed
after changes to Hypixel's menu or preview format.
