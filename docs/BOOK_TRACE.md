# Book packet tracker (Minecraft 1.8.9)

Restart the proxy, then run:

```
/booktrace start
```

Open the book you want to inspect. Try page buttons and clickable links,
then close it. For an editable book, try editing or signing it as well.
Finish with `/booktrace stop`. Use `/booktrace status` for the full log path,
or `/booktrace mark <description>` to insert a manual timeline marker.

The tracker is passive: it does not open books, click links, submit edits,
or change the normal packet flow. Recording stops after three minutes,
16 MiB, or disconnection. No network request or link is executed by analysis.

## Captured information

- Server `MC|BOpen` requests, linked to the held book when its item data was
  observed. Inventory state is tracked before capture starts so cached book
  contents can still be included. A book opened before recording cannot
  have its original open request recovered.
- Book item contents from inventory packets and item use: title, author,
  pages, readable text, and clickable actions such as `run_command`,
  `suggest_command`, `open_url`, and `change_page` where present.
- `MC|BEdit` and `MC|BSign` payloads, decoded using the 1.8 slot layout
  (item ID, count, damage, then uncompressed NBT). Malformed or oversized
  payloads retain their bounded raw capture with an explicit decode error.
- Other custom payloads in both directions, with base64, hex and UTF-8 views.
- Inventory open/close/click/content packets and nearby chat commands. A
  command matching a book link is labelled a **possible** link click;
  manually typing the same command produces indistinguishable packets.

`client` means received from the client, including locally intercepted
commands. `upstream` means submitted to the server transport. `server` means
received from Hypixel before proxy rewriting. A server open request is not
an acknowledgement that the client displayed it.

## Events that may have no packet

In vanilla 1.8.9, changing book pages and closing the book screen are local
client actions. They do not have dedicated book-click or book-close packets.
The tracker saves page/link definitions but cannot claim those controls were
clicked without a corresponding observable action. An inventory
`close_window` is explicitly labelled as an inventory close, not a book close.
A client mod may send additional custom payloads; those are captured too.

## Files and limits

`packet_logs/book_trace/book-trace-<id>.jsonl` stores the packet timeline and
deduplicated book contents. The adjacent `.summary.json` lists book versions,
observed opening requests, payload channels, and possible link commands.
Limits are marked explicitly: binary values and edit/sign decoding use a
64 KiB limit, raw encoded packets use 256 KiB, decoded pages use 16,384
characters per page and 128 pages per book. Full raw item NBT is retained
within the independent packet-capture limits.

Run `node tests/features/test_book_trace.js` for offline coverage of cached book opening,
temporary held-item restoration, clickable page contents, binary payload
decoding, signing, malformed packets, correlation labels and capture limits.
