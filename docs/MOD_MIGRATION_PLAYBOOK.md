# Fury proxy → client mod: staged migration playbook

> Superseded for new implementation work by [MOD_NATIVE_PLAYBOOK_V2.md](MOD_NATIVE_PLAYBOOK_V2.md). V2 replaces proxy-only mechanisms with native mod capabilities and changes the step order. Reconcile completed work instead of restarting it. This v1 remains as a historical reference.

Prepared from the current working tree on 2026-10-09. This is an implementation plan, not an implemented mod. Existing uncommitted work is part of the reference; do not overwrite it.

## How to use this document

Copy the standing prompt below into your coding session, then paste ONE numbered implementation prompt at a time. Complete its acceptance checks before continuing. Keep this document and a migration ledger in the mod project. The source paths below refer to this Fury repository, not files that already exist in the mod.

Default target: Minecraft 1.8.9, Forge, Java. Fury explicitly uses protocol version 1.8.9 in `proxy.js`. Verify the installed JDK, compatible Gradle/ForgeGradle, mappings and MDK before pinning the build. Do not copy a modern Forge/Fabric tutorial into a legacy build. If you want a different Minecraft version or loader, revise step 1 before implementing later steps.

Recommended route: first a small companion mod consuming Fury data; then native providers and feature logic; finally direct server connection without the proxy. The bridge is NEW work: the existing health endpoint must not be assumed to expose this contract. Minecraft authenticates the player; the final mod does not need Fury's alternate-account login implementation.

Java cannot directly import the CommonJS feature modules. Port their contracts and behavior, using fixtures and existing tests as evidence. Keep pure logic separate from Minecraft hooks. Never run network/file operations from rendering callbacks.

### Standing prompt — paste first

```text
We are incrementally porting Fury from the referenced Node/Electron repository into a Minecraft client mod. Read docs/MOD_MIGRATION_PLAYBOOK.md and the migration ledger first. Implement only the requested numbered step, including its prerequisites if already agreed; report missing prerequisites instead of silently broadening scope.

Treat the CURRENT production working tree as authoritative. Trace package.json → launcher.js → launcher.html and mounted renderer/style layers for desktop references; proxy.js → src/ and features/ for game behavior. Preserve existing changes. Read applicable AGENTS.md and skills. Do not edit releases, prototypes, dependencies or unrelated source.

Preserve defaults, validation, provider identity, semantic colors, account isolation, command aliases, ordering, cancellation, stale-result guards and existing disabled/retired behavior. A new GUI does not authorize changed feature logic. Do not invent API endpoints or claim a mod reveals unavailable server information.

Use the agreed Minecraft/loader/toolchain. Prefer supported events; inspect mappings before selecting exact hooks. Introduce narrowly scoped packet/render hooks only where required and document their compatibility. Keep Minecraft state and rendering on the client thread, bounded HTTP/file work off-thread, and results guarded by connection generation/account identity. Do not add a JavaScript runtime, browser or Node process inside the final mod.

Maintain one owner for each feature in companion mode. A backend feature and native feature must never both mutate chat, issue commands or record the same event. Use explicit capabilities/ownership; reject unsupported contract versions. No polling/render-loop API fetching. No hardcoded 60 Hz; use elapsed time.

GUI: dark, minimal, simple clickable rows, restrained accent, clear toggles and a separate settings button. Preserve Fury terminology and semantic Minecraft colors. Reuse canonical Fury assets if needed; never generate/recreate the logo. Keep secrets out of logs, exports and screenshots.

Port meaningful behavior fixtures into tests, then build and verify the affected feature in-game where possible. Record what was actually tested and any unavailable live/client compatibility checks. Update the migration ledger with source paths, ownership, contract versions, tests and remaining work. End with changed files, results and the next step. Do not implement the next step automatically.
```

## Migration order and feature coverage

Each numbered block is a separate copyable prompt. The first usable release is steps 1–12. The proxy becomes optional only after the native replacements and final ownership checks.

### 1. Inventory, behavior contracts and mod scaffold

**Purpose:** establish a buildable target and a complete feature ledger before translating logic.

**References:** `package.json`, `app_config.js`, `proxy.js`, `features/help_command.js`, `features/fury_menu.js`, `features/command_completion.js`, `tests/`.

```text
Implement step 1: create an isolated Fury mod project for Minecraft 1.8.9/Forge without modifying the existing application's behavior. Verify and pin a compatible MDK, mappings, JDK and build toolchain; document reproducible commands. Inventory every active command, setting and feature by tracing current registrations and callers, including uncommitted production changes. Record defaults, owner, external providers, tests, aliases and migration status in MIGRATION_LEDGER.md. Separate active, compatibility-only, forced-off, retired and desktop-only entries. Add a client-only entry point and disconnect/world-change lifecycle. Build the jar and verify a clean launch and shutdown if a client is available. Do not implement feature logic yet.
```

### 2. Settings, module registry and lifecycle

**Purpose:** one settings model for GUI, commands and features.

**References:** `app_config.js`, `src/profiles/`, `src/state/runtimeState.js`, `src/storage/`.

```text
Implement step 2: create typed settings and a module registry with stable IDs, categories, enabled state, availability and settings descriptors. Port current normalization/defaults and historical aliases; distinguish effective forced-off values from raw saved values. Persist a versioned mod-owned config using atomic replacement and debounced writes off the render thread. Store global preferences separately from UUID-owned account data. Add connection-generation invalidation and deterministic listener/task cleanup. Verify corrupted config recovery, unknown-field policy, normalization, account changes and repeated enable/disable cycles. Exclude credentials from ordinary config exports. No feature may create a second settings store.
```

### 3. Custom clickable GUI shell

**Purpose:** the requested simple dark menu, usable before the migration is complete.

**References:** production `src/launcher/renderer/launcher_windows_settings.js`, `launcher_ingame_appearance.js`, shared controls/styles; generated concept is visual guidance only.

```text
Implement step 3: build the native Fury screen opened by a configurable keybind (default Right Shift) and /fury. Use a compact sidebar: Overlay, Chat, Bedwars, Party, History, Settings. Add search and simple module rows with name, short description, availability, toggle and a distinct settings button. Use near-black surfaces, thin borders, restrained Fury accent and modest rounded corners. Render via Minecraft GUI primitives; do not embed a browser. Preserve canonical branding; use text-only Fury until a suitable production asset is integrated. Support scrolling, clipping, GUI scaling, small windows, keyboard focus, Enter/Space, Escape/back and keybind conflicts. Unimplemented modules must say unavailable and remain non-interactive. Verify hitboxes match scaled rendering.
```

### 4. Feature settings and HUD editor

**Purpose:** reusable controls and movable widgets without duplicate feature state.

```text
Implement step 4: add reusable settings screens driven by the module registry: boolean, bounded number, slider, enum, color, field ordering and keybind capture. Match Fury validation. Add a HUD editor with drag, keyboard movement, optional snapping, per-widget scale, visibility and reset. Save positions in scaled/normalized coordinates with anchors and clamp them when resolution changes. Use fixture data for previews, clearly labeled. Restore focus on back; persist only changes. Keep normal gameplay click-through and capture input only while editing. Cache static layout/text; do not remeasure every label each frame. Verify different GUI scales, resize, hidden widgets, cancelled edits and reset.
```

### 5. Companion bridge and feature ownership

**Purpose:** supply existing Fury intelligence while native rendering is built.

**References:** `src/health/httpServer.js`, `src/net/loopback.js`, existing launcher projections and proxy-owned feature state.

```text
Implement step 5: define a NEW versioned loopback companion protocol with a capability handshake, authenticated local pairing, bounded initial projections and revisioned changes. Reuse existing transport capabilities only where compatible. Bind locally; validate messages, sizes and action allowlists. Include connected UUID, connection generation and feature owner in state; never send credentials or the complete internal history graph. Add reconnect/backoff, stale message rejection and visible offline status. Route permitted settings/actions to existing owners. Explicitly disable the proxy's corresponding display/command side effects when the mod owns them, restoring ownership safely on disconnect. Verify mismatched versions, stale reconnects, account mismatch and duplicate side-effect prevention. Document endpoints rather than assuming the health API supplies them.
```

### 6. Player identity and game context adapter

**Purpose:** shared player/team/mode evidence for all later features.

**References:** `src/net/session/{ownIdentity,entityTracking,scoreboard,bedwarsTeamEvidence,duelsMatch,pregame_chat,partyTracking}.js`.

```text
Implement step 6: adapt client-visible tab entries, scoreboard teams, chat, world/entity lifecycle and required incoming packets into normalized immutable events. Preserve UUID/name/nick distinctions, own identity, team evidence precedence, lobby/pregame/game/spectator states and mode/submode boundaries. Keep observed facts separate from inferred or provider-derived fields. Do not equate missing entities with eliminated players. Use Forge events where sufficient; document any narrow packet hook after verifying 1.8.9 mappings. Clear world state on disconnect and guard asynchronous updates by generation. Replay relevant identity/team/game fixtures and verify lobby → match → spectator → lobby plus server/account changes.
```

### 7. Shared stats and formatting model

**Purpose:** consistent values across nametags, tab, chat and player cards.

**References:** `src/stats/{collect,format,colors,sources,lookupStatus,pregameIdentity,tagDisplay,tagReasonLabels,renderHelpers}.js`, `src/stats/render/`.

```text
Implement step 7: define compact player profiles and shared formatting functions for Bedwars, Skywars, Duels, general and session values. Initially consume bridge profiles. Preserve selected mode, zero/missing/private/unavailable distinctions, nicked profiles, provider provenance, star/prestige/rank/team/stat colors, ratios and current ping semantics. Never substitute server tab latency for provider average ping where Fury deliberately uses the latter. Model loading and errors explicitly. Translate meaningful formatting fixtures into golden tests. Rendering must consume cached formatted views and never fetch profiles itself. Verify the same player/value is consistent across every surface.
```

### 8. Nametag overlays

**Purpose:** first major visible improvement from native rendering.

**References:** `src/overlay/nametags.js`, `src/net/session/entityTracking.js`, nametag settings and rendering path in `proxy.js`.

```text
Implement step 8: render native nametag additions using bridge profiles and the shared formatter. Preserve per-audience teammate/threat/other settings, prefix/suffix choices and fallback fields, star brackets, tags, aliases and denicked-name options. Keep vanilla name/team presentation intact unless the corresponding replacement is enabled. Respect normal visibility, sneaking, invisibility, spectator and distance behavior; do not expose hidden players. Use camera-relative positioning and the client's render interpolation; restore graphics state after rendering. Disable equivalent proxy-generated additions through ownership. Verify no duplicate labels, semantic colors, first/third person, moving entities, world changes and common rendering-mod compatibility where available.
```

### 9. Native tab stats

**Purpose:** aligned columns with game-specific layouts.

**References:** `src/stats/tabStats.js`, `src/session/bedwarsTabSettings.js`, tab rendering in `proxy.js`.

```text
Implement step 9: replace only the Fury-owned tab presentation with a native table. Preserve server ordering/team/rank identity and Fury's selected Bedwars/Skywars fields, auto/manual modes, compact labels, tags, ratios and nicked-star placement rules. Add aligned optional stat columns, width clamping and scaled overflow handling without changing sorting semantics. Preserve original server header/footer and unrelated scoreboard-team properties. Cache per-profile rows and recalculate layout only on content/size/settings changes. Disable proxy tab rewrites when native tab owns rendering. Verify short and full tab lists, unavailable profiles, long names, semantic colors and toggling back to vanilla.
```

### 10. Overlay board, scans and player cards

**Purpose:** bring Fury's lookup/scan workflow into the game.

**References:** `src/overlay/{scan,duelsScan,tags}.js`, `src/launcher/renderer/launcher_overlay_board.js`, `src/stats/lookup.js`, `features/scan_mode_command.js`.

```text
Implement step 10: create a clickable overlay board and player detail screen consuming existing scan results. Support Bedwars/Skywars/Duels, all/threats/off shortcuts, thresholds, auto-scan, manual add/remove, outside-game auto-add gates and game-boundary clearing. Preserve scan grouping/order, threat rules, own-account exclusions, tags/nicks and source attribution. Keep asynchronous results tied to the scan generation. Player cards expose existing stats/info/ping/profile/Urchin fields with loading/unavailable states and only authorized actions. Do not add new automatic lookups on each render. Verify cancellation, mode changes, clear-on-boundary behavior and board/profile consistency.
```

### 11. Chat annotations, chat stats and aliases

**Purpose:** richer interaction while preserving original messages.

**References:** `features/{minecraft_chat,chat_controller,chat_completion,chat_triggers,looking_for_triggers}.js`, `src/overlay/chat_overlay_annotation.js`, `src/friends/aliasBook.js`, `src/denick/displayNames.js`.

```text
Implement step 11: add native Fury chat annotations, hover details and player-card links while preserving original JSON components, server click/hover actions, formatting resets and rank/team colors. Port lobby mentions, DMs, configured pregame triggers and looking-for detection with existing deduplication/visibility gates. Port friend aliases independently for chat/tab/nametags, including show-real-name options and UUID ownership. Keep display identities separate from command targets. Ensure bridge/proxy annotations cannot double-apply. Test nested components, signed-looking plain text, links, aliases, nicked identities, repeated messages and toggles. Do not globally recolor server chat with the GUI accent.
```

### 12. Queue/session HUD and reminders

**Purpose:** first useful HUD release without rewriting tracking yet.

**References:** `src/session/{queueTime,bedwarsGeneratorSchedule,sessionSnapshot}.js`, `features/{ender_dust_reminder,gambler_george_reminder}.js`, `src/reminders/`, `src/health/settingsAnnouncements.js`.

```text
Implement step 12: add separately movable queue time, compact session stats, Bedwars generator-upgrade schedule and reminder widgets backed by current Fury state. Preserve queue reset boundaries, optional party sharing, observed/inferred timer provenance, Ender Dust thresholds, Gambler George state, remembered-account snoozes and API-key reminders. A schedule is not an exact live resource-spawn countdown; label unavailable/estimated state correctly. Never display key values. Use elapsed time, coalesced updates and visibility gates. Keep game/rank/team/stat colors intact. Verify disconnect, spectator, missed start, settings changes, duplicate reminder suppression and no network requests from HUD rendering.
```

### 13. Local commands, help and completion

**Purpose:** preserve existing shortcuts while supporting the clickable GUI.

**References:** `features/{help_command,command_completion,fury_menu,api_key_commands,api_kill_switch_command,proxy_health}.js`, command registrations in `proxy.js`.

```text
Implement step 13: register client-side commands from the active command ledger and preserve compatibility aliases. /fury opens the GUI; provide distinct settings/help routes without stealing server commands unnecessarily. Consume only recognized Fury invocations; pass unrelated commands through unchanged. Route companion-owned commands once to the backend and native-owned commands once locally. Completion uses bounded cached player/preset/enum data and never requests APIs per keystroke. Keep disabled/unsupported commands informative. Verify alias collisions, argument validation, completion, local interception and no duplicate server sends. Preserve /deck compatibility as a redirect/help route rather than reviving its removed interactive UI.
```

## Native data and business logic

### 14. Native API providers, cache and kill switch

**References:** `src/stats/{fetch,lookup,collect,urchin}.js`, `features/{hypixel_api_client,urchin_client}.js`, `src/net/apiKillSwitch.js`, `src/util/{in_flight_deduper,bounded_ttl_map}.js`.

```text
Implement step 14: port current Hypixel, Urchin, Aurora and other actually registered provider adapters into Java behind the same profile contract. Verify real endpoints/authentication from current source and official documentation; do not invent access. Preserve pacing, in-flight deduplication, bounded caches, error semantics, private/missing data handling and explicit kill-switch behavior. Use a bounded executor with timeouts/cancellation and marshal accepted results to the client thread. Separate secrets from exportable settings. Gate by UUID/generation and report source provenance. Switch provider ownership per capability; do not double-fetch through bridge and native paths. Verify with recorded responses and controlled mocked rate limits, errors, cancellation and cross-account requests.
```

### 15. Native identity enrichment and denicking

**References:** `src/denick/`, `src/net/session/denickTracking.js`, `src/stats/denickLookupPlayer.js`, launcher denick actions/history.

```text
Implement step 15: port skin-based and stats-based denick lookups, candidate review, bot-name handling, confidence/evidence, display-name selection and per-account history. Preserve unavailable/ambiguous results rather than asserting a real identity. Port automatic lookup gates and configured chat/party announcements without increasing request frequency. Preserve real-IGN/chat/nametag and real-skin options separately. Native skin replacement must remain local, use bounded texture caching and avoid entity respawn churn. Do not gain or infer identity from nonexistent privileged server access. Verify candidate ordering, repeated nick changes, stale responses, manual review, texture failure and account-scoped persistence using existing denick fixtures.
```

### 16. Native scanning, threat rules and overlay maintenance

```text
Implement step 16: move scan evaluation and overlay maintenance from the bridge into native logic using steps 6, 7, 14 and 15. Port exact Bedwars/Skywars/Duels thresholds, include/exclude rules, tag provenance, nick treatment, mode selection, game-start triggers and share-ready result snapshots. Preserve scan order, grouping, deduplication and stale-work rejection. Adopt native ownership only after fixture parity; the proxy then supplies neither scan commands nor duplicate profile requests for this feature. Verify existing scan-threat and Duels scenarios, party/own-player exclusions, changing tabs mid-scan, API kill switch and missing stats. Do not redesign threat semantics.
```

### 17. Native local match tracking

**References:** `src/session/{sessionTracker,localTracking,localStats,gameEvents,gameResult,observedStats,modeDefinitions,submodeStats,modeBreakdown}.js`, `src/net/session/`.

```text
Implement step 17: port event-driven match/session tracking for Bedwars, Skywars and Duels, including private variants, submodes, kills/finals/beds/deaths, eliminations, outcomes and reconnect behavior. Reuse the normalized client event adapter, preserving evidence precedence and uncertain/incomplete results. Port event deduplication and local-versus-API provenance; do not inflate counters from repeated chat/tab updates. Use a deterministic clock in logic tests. Compare normalized fixture event sequences against current expected results, including team elimination, replay observations, disconnects and missed result messages. Disable proxy tracking for sessions owned by the mod before persisting native data.
```

### 18. Native storage, import and reconciliation

**References:** `src/session/{sessionStore,sessionSnapshot,settings,historyResponse,historyReconciliation}.js` where present, `src/storage/`, current reconciliation callers/tests.

```text
Implement step 18: persist native session/game data with account UUID ownership, atomic writes, retention and session-boundary settings. Add an explicit read-only preview/import of Fury exports or supported existing data, creating backups and a versioned migration report; never mutate original stores or import authentication tokens. Preserve stable IDs, provenance and deduplication so importing twice cannot duplicate games. Port reconciliation behavior from its current owning path and tests. Keep bounded compact history summaries and revision-aware detail queries; do not load/send the full graph to every screen. Verify interrupted writes, corrupt data, account switches, repeated import, retention and stale detail requests.
```

### 19. History, calendar and session drilldown GUI

**References:** launcher calendar/session card/recap renderers, `src/session/{calendarStats,cardStatsPolicy,modeBreakdown,submodeStats,historyResponse}.js`.

```text
Implement step 19: add minimal History screens for sessions, dates/calendar, mode/submode breakdown and individual games. Preserve date/timezone, incomplete-game policies, account selection, grouping and aggregate calculations. Query paged compact summaries and request game details only when opened; reject stale revisions/account changes. Maintain loading, empty, filtered-empty and error states. Cache layouts and render only visible list rows. Do not migrate desktop chart decoration into the simple in-game menu. Verify calendar boundaries, long history, filtering, back navigation, detail invalidation and no cross-account content.
```

### 20. Recaps, replay details and clip bookmarks

**References:** `src/session/{gameRecap,gameClips}.js`, `src/menu/replayResults.js`, `src/stats/recapScoreboard.js`.

```text
Implement step 20: port /recap, automatic recap gates, replay-result enrichment and /clip bookmarks into native services and a compact game detail screen. Preserve last-game ownership, replay ID availability, offset calculation, labels, incomplete data and local/API reconciliation. /clip remains a named replay moment; do not claim it records video. Offer copy/open/suggest actions only when their underlying replay information exists. Persist bookmarks separately where current ownership requires it. Verify replay-less games, late replay data, manual labels, duplicate results, clock offsets and changing accounts during enrichment. No packet replay engine or video capture in this step.
```

### 21. Native party tracking, overview and arrival checks

**References:** `src/net/session/partyTracking.js`, `src/party/{overview,arrivalCheck}.js`, `src/dodge/partyArrival.js`.

```text
Implement step 21: port party leader/member tracking, /po overview, /partyy status, /partycheck and split/arrival warnings. Preserve evidence sources, expected membership, timeout policy, leader authority and intentional distinction between party membership and visible lobby players. Render a compact Party screen with arrival state and profile links. Reuse cached profiles and cancel stale checks on party/queue/server changes. Do not manufacture certainty from missing tab entries. Verify joins/leaves, leader transfer, disconnected members, mixed nick identities, split lobbies, cancellation and the existing party-arrival fixtures. Keep command sending behind the shared command scheduler.
```

### 22. Party coordination relay

**References:** `src/party/coordination{Protocol,Client,Auth}.js`, `docs/PARTY_COORDINATION.md`, `cloudflare/party-coordination/`, current relay tests.

```text
Implement step 22: port the existing authenticated party-coordination protocol into a native client without changing the deployed relay contract. Verify current protocol version, signing/authentication requirements, sequence/generation guards, room ownership, expiry, bounded messages and reconnect behavior from source. Preserve leader/member authority and exactly-once coordination effects. Never send provider credentials to the relay. Keep the relay service external; a standalone mod can still depend on this service. Verify spoofed/stale/replayed messages, leader changes, offline mode and bridge/native mixed-party compatibility with current fixtures. Do not deploy or alter the relay as part of this client port.
```

### 23. Tag sharing and community-tag actions

**References:** `src/overlay/{shareTags,shareEchoRewriter}.js`, `src/stats/{urchin,tagDisplay,tagReasonLabels}.js`, `/tag`, `/addtag`, `/removetag` registration paths.

```text
Implement step 23: port manual/automatic scan sharing, destination selection, grouping by team, tag/nick/threat inclusion, fancy/plain format and local echo rewriting. Use immutable completed scan snapshots and the scheduler; avoid duplicate broadcast ownership. Add existing community tag review/create/remove flows with validation, permission checks, privacy and overwrite options. Preserve source identity and error behavior. Destructive tag changes need a clear user action; no implicit apply from opening a player card. Verify grouping/order, echo matching, rapid rescans, missing permissions, invalid reasons, API kill switch and duplicate relay/chat events.
```

### 24. Command scheduling and queue actions

**References:** `src/net/hypixelCommandQueue.js`, `src/dodge/{bedwarsQueue,pregameCountdown}.js`.

```text
Implement step 24: port the shared outbound command scheduler before migrating automation. Preserve ordering, priority, pacing, deduplication, deadlines, cancellation, leader gates and connection generation. All features must use this owner instead of sending chat packets directly. Port current Bedwars queue selection/result handling and pregame countdown evidence without hardcoding unverified commands. Expose manual queue actions and queued/running/cancelled feedback. Test with a fake clock and fake transport: busy queues, expired commands, disconnects, party changes, cancellation and late completion. No automatic dodge, nick rolling or menu clicking until their separate steps.
```

### 25. Auto-dodge and party-safe cancellation

**References:** `src/dodge/autoDodge.js`, party coordination/arrival logic, `tests/features/test_auto_dodge.js`, current integration tests.

```text
Implement step 25: port current auto-dodge predicates, include presets, tag/nick/stat thresholds, delay, queue ownership, arrival gates and party coordination. Preserve when a dodge may start, who may issue it, exactly-once execution and /cancel aliases. Show the reason and elapsed-time countdown in a small dismissible HUD; cancellation must invalidate pending scheduler work immediately. Keep detection separate from the action transport so advisory/manual mode is available. Review current server modification rules before deciding the distributable action mode; do not label automation universally allowed. Verify countdown races, leader transfer, changing threats, queue transitions, manual cancellation and mixed companion/native parties.
```

### 26. Quick Buy and hotbar previews/presets

**References:** `src/menu/{quickBuyPreview,quickBuyImport,quickBuy,quickBuyMessages,hotbarLayout}.js`, menu fixtures.

```text
Implement step 26: port Quick Buy/hotbar import, named presets, save/list/load selection and combined layouts into dedicated native screens. Preserve current item/category mapping, slot validation and preset ownership. Native preview uses a local screen with item icons/tooltips; it must not open fake server windows or modify the real cursor/inventory. Keep preview and server apply as distinct actions. Handle unknown/unavailable items without inventing mappings. Port aliases /qb, /hb and combined commands. Verify fixture layouts, empty slots, unknown IDs, account changes, failed provider reads and preview exit while a real container is open. Applying on the server belongs to step 27.
```

### 27. Server menu application and monitoring

**References:** `src/menu/{menuMonitor,quickBuyTrace,bookTrace,bookContent,quickBuy,hotbarLayout}.js`, transaction/window paths in `proxy.js`.

```text
Implement step 27: port permitted layout application using the actual server container and verified 1.8.9 controller/window transaction semantics. Keep menu fingerprints, expected slot/content checks, cursor safety, window generation, pacing, acknowledgement, timeout and cancellation. Never replay fake preview actions against a server window. Cancel when a user changes windows or inventory state invalidates the plan; do not steal normal clicks. Preserve trace tools as opt-in diagnostics with bounded output. Validate in a controlled environment before live use and keep a manual workflow where automated clicks are not appropriate. Test rejected transactions, unexpected contents, close/reopen, partial completion and disconnect.
```

### 28. Nick reroller and book handling

**References:** `src/nick/`, `src/menu/{bookTrace,bookContent}.js`, current nickroll tests.

```text
Implement step 28: port the active nickroll configuration, filters/word lists, book parsing, pacing, status and start/stop workflow. Preserve supported rank/provider eligibility and MANUAL acceptance of a matching result. Reuse menu generation guards and the command scheduler; stop on unexpected books/windows, disconnect or explicit cancellation. Keep bridge and native reroll ownership mutually exclusive. Surface unavailable capability rather than simulating entitlement. Verify matching/rejected names, malformed books, stale book responses, interruption, repeated start, queue congestion and manual acceptance. Review automation distribution behavior separately; do not enable retired gambler functionality as part of nickroll.
```

### 29. Cosmetic catalog, search and local presentation

**References:** `src/cosmetics/`, `cosmetic_search_api.js`, launcher cosmetic picker, `src/menu/killMessageLogger.js`.

```text
Implement step 29: port cosmetic catalog/search, active-cosmetic display, kill/bed-message formatting, local selection and effect previews. Preserve canonical cosmetic IDs, aliases, provider-derived active fields and existing availability. Distinguish observed server cosmetics from a local preview; do not claim other players see mod-only changes. Prefer native rendering/audio where it replaces proxy-injected presentation, with bounded effect lifetimes, correct world cleanup and no server identity changes. Preserve semantic message formatting. Keep recordings/fingerprints opt-in. Verify catalog matching, unknown cosmetics, repeated effects, disabled effects, resource changes and reconnect. Do not recreate or modify the Fury logo.
```

### 30. Scaffold detector and alert presentation

**References:** `src/detect/{scaffoldDetector,detectorShared}.js`, entity adapter, detector tests and effective anticheat normalization.

```text
Implement step 30: port the active scaffold detector and alert policies from current source, preserving thresholds, observation windows, confidence wording, team filters, deduplication and false-positive suppression. Normalize client-visible packet/world evidence carefully; changed coordinate representations must be covered by fixtures. No extra hidden-player observations, automatic reports or new enforcement. Keep autoblock/stasis disabled because effective configuration currently forces them off; do not revive them merely because modules exist. Alert UI should link to available evidence and explicitly represent uncertainty. Verify benign movement/building, missing packets, world changes, repeated alerts and existing detector fixtures before enabling native ownership.
```

### 31. Diagnostic recorder and evidence analysis

**References:** `src/recorder/`, `src/cosmetics/{effectRecorder,effectFingerprint,effectLibrary}.js`, `/recordcheat` and `/rc` paths.

```text
Implement step 31: port opt-in diagnostic recording, bounded pre/post-event buffers, feature extraction, analysis and scaffold clip labels. Preserve original purpose and command behavior; this is not an automatic video recorder. Define a versioned file format, account/world metadata, retention and redaction so authentication/provider secrets never enter recordings. Serialize bounded batches off-thread; never keep the whole session packet stream in memory by default. Record only the evidence required by the current analysis. Verify start/stop, buffer bounds, malformed files, disconnect, dropped events and deterministic extraction against existing fixtures. Add progress/cancel feedback for analysis.
```

### 32. Quick Maths and remaining small features

**References:** `features/quick_maths.js`, active command/settings ledger, `src/health/settingsAnnouncements.js`.

```text
Implement step 32: reconcile the inventory for active small features not yet migrated, including Quick Maths, settings announcements and remaining reminder/help routes. Port each as a separately owned module with current default and exact cancellation/deadline/spectator/respawn behavior. Quick Maths currently can submit an answer automatically: keep advisory/manual and automatic modes distinct, and evaluate the distributable mode against current server rules. Reuse the scheduler and avoid duplicate answers. Do not revive autoGambler, removed social-overlay toggles, legacy deck UI or forced-off detectors. Add focused fixture tests for each genuinely active leftover; report any new inventory gap rather than silently inventing behavior.
```

### 33. Profiles, presets and configuration import/export

**References:** `src/profiles/{profileStore,presetRender}.js`, `app_config.js`, account-owned alias/denick/reminder stores.

```text
Implement step 33: port active profile/preset save/load/list/reset behavior using the exact current allowlists and normalization. Expose simple profile controls in Settings. Support a versioned Fury settings import with preview of applied, skipped and incompatible fields; keep backup/rollback and do not overwrite existing account data. Preserve excluded secret/identity/server-specific fields and forced-off features. Distinguish a display preset from credentials and history. Validate bounds, names and malformed imports; applying a profile triggers one change-based refresh per affected owner. Verify round-trip export without secrets, historical aliases, unknown fields and repeated profile changes.
```

### 34. Standalone services and desktop responsibilities

**References:** accounts/auth, update notifications, proxy health/status, bootstrap/shutdown and storage owners.

```text
Implement step 34: make the remaining feature services native and classify desktop-only responsibilities explicitly. Minecraft/its launcher owns Microsoft login and account switching; do not port refresh tokens or run a second authentication flow. Replace proxy connection/port/failover/health controls with relevant mod/provider/relay status and remove inapplicable controls only from the mod UI. Preserve useful update notifications using a verified metadata contract; require normal jar replacement, not live class injection. Keep Electron optional for richer history/account management only if agreed. Ensure no runtime dependency on Node, Electron, localhost bridge or proxy remains in standalone mode, apart from intentionally external APIs/relay. Verify direct connection and degraded offline-provider behavior.
```

### 35. Final parity, compatibility and proxy retirement

```text
Implement step 35: audit every active inventory entry and command against native behavior and fixture parity. Verify direct server connection with the proxy stopped: identities, stats, scans, nametags/tab/chat, HUD, history, party/relay, sharing, reminders, layouts, nickroll, cosmetics and diagnostic tools. Mark unsupported or policy-adjusted behavior explicitly; do not claim parity if a feature still calls the bridge. Test disconnect/reconnect, account isolation, repeated module toggles, resolution/GUI scale and supported co-installed mods. Measure frame time, allocations, startup, API request counts and large-history behavior against a representative baseline; optimize only measured regressions. Produce an installable jar, setup guide, versioned data migration/rollback instructions and a completed ledger. Do not delete the proxy repository or user data. Retire the bridge only after standalone acceptance.
```

## GUI implementation specification

The concept image is a visual target, not functional code or a promise of pixel-perfect generated text. The real implementation must derive interaction labels and availability from the registry.

- **Modules:** category sidebar, search, compact rows, toggle, separate settings button. Avoid a wall of brightly colored cards.
- **Module details:** back button, description, only relevant controls, a small live/fixture preview. Advanced controls collapsed.
- **HUD editor:** dim game view, widget outlines only during editing, drag and keyboard move, reset and Done. No normal gameplay input capture.
- **Player card:** name/identity provenance, selected mode stats, tags/evidence and limited explicit actions.
- **Party:** leader/members, arrival state, split warning and manual controls.
- **History:** session list, filters, compact summaries and on-demand game details.
- **Settings:** API/provider status, masked credential controls, keybinds, profiles, appearance, data import/export and diagnostics.

Concept palette: background #101114, surface #181A20, border #282B33, text #F2F3F5, muted text #9B9EA8. Use the current Fury accent setting instead of forcing a new brand accent. Colors are proposed mod-screen tokens, not edits to launcher tokens. Use semantic Minecraft colors for teams/ranks/stats. GUI font can be clean and compact; preserve intentional Minecraft typography in game-facing content. Verify font licensing and legacy rendering compatibility before shipping any bundled font.

Suggested hierarchy: one main screen, one module detail screen and small focused dialogs. Left-click activates an explicitly labeled target; toggles do not unexpectedly navigate. Tooltips explain disabled/provider-unavailable states. Escape closes the topmost dialog, then returns, then exits. Normal gameplay has no clickable HUD unless a dedicated interaction mode is active.

Use one logical coordinate system for rendering and hit testing. Restore scissor, blend, depth, texture and matrix state after custom rendering. Load assets once, cache text/layout by inputs, and use bounded row virtualization for long lists. Do not introduce blur shaders or continuous animations merely for appearance.

## Known exclusions and behavior differences to track

| Existing responsibility | Migration decision |
|---|---|
| AutoGambler | Retired/effectively forced off; do not port as active. |
| Autoblock and stasis detectors | Source exists, effective settings force off; preserve disabled state. |
| Legacy /deck interactive interface | Removed; preserve useful compatibility routing only. |
| Historical social-overlay auto-add flags | Deleted in normalization; not active feature requirements. |
| Electron account authentication | Minecraft launcher owns authentication in native mode. |
| Proxy port/server routing/failover | Proxy architecture controls; not equivalent to a normal mod feature. |
| Electron installers, portable packaging, instance locks | Replace with mod jar distribution/lifecycle; do not port literally. |
| Windows/macOS app-data migration | Retain originals; implement explicit mod import, not destructive directory relocation. |
| Bridge | Temporary integration dependency, not proof of a completed standalone port. |
| Party relay and providers | External service dependencies may remain after proxy retirement. |
| Clip bookmarks | Replay moments; video recording is a separate future feature. |
| Server cosmetics | Native local preview does not change what other clients see. |
| Automation/server menu actions | Track exact retained or adjusted behavior and server compatibility separately. |

The list covers the feature families visible in current source. Step 1 must exhaustively reconcile individual registrations and settings, especially current uncommitted additions. This is a staged plan rather than an assertion that every class has already been audited line by line.

## Sources and verification limits

- Forge provides a Minecraft 1.8.9 distribution/MDK: https://files.minecraftforge.net/net/minecraftforge/forge/index_1.8.9.html
- Hypixel's current modification policy is the compatibility reference, not approval of this proposed mod: https://support.hypixel.net/hc/en-us/articles/6472550754962-Hypixel-Allowed-Modifications
- Local production paths and existing tests listed above are the behavioral reference. The inspected working tree contains extensive existing changes; this plan does not revert them.
- No mod build, live in-game tests or compatibility benchmarks were run for this planning task. Generated GUI artwork is a concept and is not clickable.
