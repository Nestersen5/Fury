# Launcher redesign

Run `npm start` from the project to open the updated Electron launcher. `npm run test:launcher-redesign` regenerates real app captures and their review gallery under the ignored `output/` directory; the gallery is built by `scripts/launcher_review_gallery.js`.

The renderer keeps the existing settings, validation and action handlers. The modules below live in `src/launcher/renderer/`, and their stylesheets live in `src/launcher/styles/`. `launcher_redesign.js` mounts the shared shell; `launcher_redesign_pages.js` arranges settings and account reminders; `launcher_redesign_nicks.js` renders saved matches. `launcher_settings_refinement.js` and its stylesheet extend `launcher_redesign.css` with roomier settings groups and a shared control style. `launcher_session_card.js` measures bitmap glyphs to generate the same canvas used for preview, clipboard and PNG download.

Settings use the available window width, a compact category directory, and consistent spacing between related groups. Master switches have explicit Off/On segments; named choices have centered labels and SVG checks. Numeric steppers retain the original inputs, validation and persistence. Scanning and session options use wider sections, with responsive columns on narrower windows. Profile summaries show green checks and red crosses derived from the saved feature state. Compact notifications include a colored edge, status icon, message, dismiss button and duration bar; reduced motion keeps that bar static.

The settings-search icon shares the input's vertical centerline. Start/Stop content is centered as a group; the Stop square and running dot have equal visible dimensions, keeping its label centered too.

## Account behavior

- The viewed account is persisted separately from the account connected to Minecraft. Selecting it immediately clears old sessions, reminder readings and card previews. Responses from a previous selection are discarded.
- UUID is the account key. Session history is filtered before limits; retention and deletion are scoped to the owner. Legacy records without UUIDs can match by name, but a recorded UUID always wins.
- Dust, daily rewards and Gambler George progress are stored by UUID. Viewing another account never changes the proxy's connected identity. Profile presets are shared feature configurations, not account progress.
- Microsoft login runs in a cancellable worker and a temporary cache. Only a successful Minecraft profile is promoted; cache filenames are mapped to the returned IGN. Cancelling leaves existing accounts intact.
- Account heads, nametag previews and generated session avatars use Mojang's official texture and a UUID-specific disk cache. A failed skin refresh retains the cached real skin instead of treating a third-party Steve fallback as that account.

The desktop HUD and its standalone demo project have been removed; packaging rejects the retired HUD payload. The floating and fullscreen overlay windows remain part of the launcher.

## Performance evidence

A native Electron audit on Windows in September 2026 found that Fury can present
smooth animation at a 240 Hz display cadence. Intermittent stalls were observed
while switching calendar views, dragging tab-list controls, resizing the native
window, and receiving periodic history updates. Ordinary hover and steady skin
preview rendering did not justify visual simplification. The compact history
response reduced transfer and renderer retention, but did not remove calendar
aggregation or layout work. Diagnose those paths on current source before
optimizing them; a fixed FPS cap, blanket list virtualization, or moving DOM
work to a worker is unsupported by that audit. The history contract and its
measurement limits are recorded in [HISTORY_ARCHITECTURE.md](HISTORY_ARCHITECTURE.md).

The native profile dialogs were accepted after a focused Windows/Electron
comparison. They restored focus to the invoking control on every measured
close, while the former custom modal did not. Opening and closing added roughly
12–14 ms of presentation latency in the reduced-motion comparison. No task
exceeded 50 ms in that workload. This is a measured interaction cost, so future
changes should preserve native modality and remeasure rather than assume the
dialog is free of renderer work.

## Verification

- `npm test` — existing regression suite, including account ownership and HTTP boundary tests.
- `npm run test:accounts` — account switching, UUID ownership, retention, late responses and login cache promotion.
- `npm run test:portable` — runtime paths, kill-message seeding and packaged runtime assets.
- `npm run test:launcher-redesign` — actual Electron UI with isolated data and blocked external traffic. Exercises account switches, PNG generation/copy/download, setting persistence, mouse/keyboard selections, Off/On segments, bounded steppers, notification layout/dismissal, dialogs, network Apply, sign-in cancellation, 16-player board sizing and proxy Start/Stop. Captures normal and minimum-window layouts and checks control centerlines.

The UI test uses synthetic accounts and no real credentials. Live Microsoft authorization and a live Minecraft connection require signing in normally; the tests do not impersonate that flow.
