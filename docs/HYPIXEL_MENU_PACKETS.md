# Driving Hypixel menus with packets (1.8.9)

Every Hypixel GUI — `/settings`, the cosmetics shop, the BedWars shop, a
compass selector, an auction sign-less menu — is a plain vanilla **chest
container**. Hypixel opens a fake inventory, fills it with named items, and
cancels every click so nothing actually moves. The proxy only needs six
packet types to read and drive all of it.

The `/menudebug` monitor in [src/menu/menuMonitor.js](../src/menu/menuMonitor.js)
watches exactly this slice of the stream and can synthesise clicks.

## The packets

| Direction | Packet | Meaning |
|---|---|---|
| S→C | `open_window` | A GUI opened. `windowId` (1–100), `inventoryType` (`minecraft:chest`), `windowTitle` (JSON chat), `slotCount`. |
| S→C | `window_items` | Full contents of a window: `windowId`, `items[]` indexed by slot. |
| S→C | `set_slot` | One slot changed: `windowId`, `slot`, `item`. Also used with `windowId: -1, slot: -1` for the cursor. |
| S→C | `craft_progress_bar` | A window property (furnace progress, enchant levels). Rare in Hypixel menus. |
| S→C | `close_window` | The server forced the GUI shut. |
| S→C | `transaction` | Accept/reject of a client action number. |
| C→S | `window_click` | The click itself: `windowId`, `slot`, `mouseButton`, `action`, `mode`, `item`. |
| C→S | `close_window` | The player closed the GUI. **Hypixel treats this as "menu dismissed".** |
| C→S | `transaction` | Confirmation of a rejected server transaction. |

`windowId: 0` is the player's own inventory and is always open — it never gets
an `open_window`.

## Slot numbering

For a chest window of `slotCount` N:

```
slot 0 .. N-1          the GUI grid, row = floor(slot/9)+1, col = slot%9+1
slot N .. N+26         the player's main inventory
slot N+27 .. N+35      the player's hotbar
slot -999              "outside the window" (drop)
```

A 54-slot Hypixel menu is 6 rows of 9. Slot 11 is row 2, column 3 — which is
where most Hypixel menus put their first real option.

## Reading a menu

Item names and lore live in the slot's NBT under `display`:

```
item.blockId    numeric item id
item.itemCount  stack size (Hypixel often uses this as a counter)
item.itemDamage damage/metadata — this is the wool/dye colour
item.nbtData.display.Name   e.g. "§aAuto Respawn"
item.nbtData.display.Lore   e.g. ["§7Currently: §aENABLED", "", "§eClick to toggle!"]
```

The current value of a Hypixel setting is almost always in the **lore**, not
the name: `§7Currently: §aENABLED`. Green wool (`blockId 35, itemDamage 5`) vs
red wool (`itemDamage 14`) is the other common on/off signal.

## `window_click` field by field

```js
hypixelClient.write('window_click', {
    windowId: 3,      // from the open_window that opened this menu
    slot: 11,         // which slot you are clicking
    mouseButton: 0,   // 0 = left, 1 = right (meaning depends on mode)
    action: 42,       // a number unique per window, increasing
    mode: 0,          // click type, see below
    item: <the item the server last said is in that slot>
});
```

### `mode` / `mouseButton` combinations

| mode | button | What the client is doing |
|---|---|---|
| 0 | 0 / 1 | left click / right click |
| 0 | 0 / 1 with `slot: -999` | drop the cursor stack / drop one |
| 1 | 0 / 1 | shift + left / shift + right |
| 2 | 0–8 | number key — swap with that hotbar slot |
| 3 | 2 | middle click (creative clone) |
| 4 | 0 / 1 | drop one (Q) / drop stack (Ctrl+Q) |
| 5 | 0,1,2 / 4,5,6 | drag: start, add slot, end (left / right) |
| 6 | 0 | double click (collect to cursor) |

Hypixel menus overwhelmingly care about **mode 0 button 0** (left click) and
**mode 0 button 1** (right click); a handful use shift-click as a secondary
action.

### `item` matters

The vanilla server compares the `item` you claim is in the slot against its own
copy. Send back exactly what the last `window_items` / `set_slot` put there,
NBT included. The monitor keeps the raw wire item per slot for this reason —
see `rebuildSlotItem` in `menuMonitor.js`.

### `action` and the transaction handshake

`action` is a per-window counter the client increments on every click. The
server replies with a `transaction` carrying the same `windowId` + `action` and
an `accepted` flag.

**Hypixel menus normally reply `accepted: false`.** That is not an error — the
plugin cancelled the inventory event, so from vanilla's point of view the click
"failed". The menu action still happened.

When a transaction is rejected, the vanilla client **must** answer with a
serverbound `transaction` confirming it. If nobody does, the server marks the
player's container as desynced and silently ignores every later click in that
window. The monitor sends this confirmation itself for clicks it synthesised,
and swallows the server's `transaction` so the real client never sees an action
number it never sent.

## The hard part: you cannot type while a GUI is open

Minecraft will not let you open chat while an inventory screen is up, and
closing the screen sends `close_window`, which tells Hypixel to throw the menu
away. So "open the menu, then type a command to click it" does not work by
default.

The fix is at the proxy: **swallow the client's `close_window`**. The client
closes its screen locally, but Hypixel never hears about it and keeps the
container open server-side. You can then type commands and keep clicking slots
in a menu that, as far as you are concerned, is no longer on screen.

That is `/menudebug hold on`. Everything else follows from it:

```
/menudebug on            start reporting menu packets both ways
/menudebug hold on       keep menus open server-side when you close them
/settings                (Hypixel opens the menu — open_window + window_items)
ESC                      close it locally; the proxy holds it open
/menudebug dump          list every filled slot with its name and first lore line
/menudebug dump 11       one slot with full lore, plus the raw NBT on the console
/menudebug find respawn  locate a slot by name or lore text
/menudebug click 11      send the window_click
/menudebug dump          re-read the menu to confirm the setting flipped
/menudebug close         actually close it when you are done
```

`/menudebug nav "General" > "Auto Respawn"` walks a chain: it clicks the first
entry by display name, waits for the replacement `window_items` to settle
(~350 ms), then clicks the next. Steps can also be `#<slot>` to force an index.

## Gotchas

- **The window id changes.** A submenu usually arrives as a fresh
  `open_window` with a new id. Always click against the id from the most recent
  `open_window`; the monitor tracks this for you.
- **Menus repaint asynchronously.** Hypixel sends `window_items` and then a
  burst of `set_slot` packets. Re-read the window a few hundred ms after a
  click, not immediately.
- **Clicking from the proxy desyncs the real client's view** if the GUI is
  actually on screen — the client never saw the click. Hypixel's repaint
  usually fixes it; using `hold` (screen closed locally) avoids it entirely.
- **Do not fire clicks faster than a human could.** Hypixel rate-limits and
  flags inventory spam. The monitor's manual commands and `nav` step delay keep
  this in human range; automating anything tighter is on you.
- **Some menus are sign or anvil input, not chests.** Those arrive as
  `open_sign_entity` / `open_window` with `inventoryType: "minecraft:anvil"`
  and need a different flow (`update_sign`, or a `set_slot` on the rename
  field). They are outside what `/menudebug` drives.

## The JSONL log

While logging is on, every observed menu packet is appended to
`packet_logs/menu/menu_<timestamp>.jsonl` (`/menudebug path` prints the file).
One JSON object per line:

```json
{"t":1758000000000,"dir":"s2c","p":"open_window","win":3,"type":"minecraft:chest","title":"Settings","slots":54}
{"t":1758000000010,"dir":"s2c","p":"window_items","win":3,"count":54,"items":[{"slot":11,"id":35,"type":"wool","dmg":5,"n":1,"name":"§aAuto Respawn","lore":["§7Currently: §aON"]}]}
{"t":1758000001000,"dir":"c2s","p":"window_click","win":3,"slot":11,"button":0,"mode":0,"action":1001,"click":"left click","synthetic":true,"source":"manual"}
{"t":1758000001040,"dir":"s2c","p":"transaction","win":3,"action":1001,"accepted":false,"synthetic":true,"rtt":40}
```

`packet_logs/` is gitignored, and `/menudebug log off` stops the file without
stopping the monitor.
