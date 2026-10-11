# Fury native mod playbook v2

This replaces the v1 implementation sequence for NEW work. Existing completed work should be reconciled, not restarted. Prepared 2026-10-09 from inspected current production source; no mod implementation or live verification performed here.

## Main change

Port Fury's product rules while replacing proxy-only mechanisms. Native providers move early; the temporary bridge is optional. Numbers in this v2 are NOT the v1 numbers. Follow the sequence below one block at a time. Steps 1–4 retain their role. Existing old steps 6/7/14 map approximately to new 5/7/6, old 13/24 to new 8/9, old 8/9 to new 12/13, old 10 to new 10/11/17. Verify actual completion in the ledger rather than assuming number equivalence.

## Capability analysis

The native changes below are design recommendations grounded in local source, not a claim that exact hooks or compatibility have been implemented. Most features still use information originally delivered by packets; the distinction is consuming Minecraft-owned state versus observing raw packets oneself.

| Feature | Native change | Preserve / limitation | Input mechanism |
|---|---|---|---|
| Scanning | Read tab roster + scoreboard snapshots; classify profiles incrementally. | Keep match gates, exclusions, thresholds and bounded provider requests. Tab includes entries beyond loaded entities. | Native state; targeted change hook or bounded diff if needed. |
| Nametags | Native rows/icons, full text measured in pixels; separate display identity. | Remove 16-character transport budgeting and synthetic overlay teams; retain visibility and audience policies. | Render events/narrow label hook. |
| Tabstats | Aligned columns, configurable layout, explicit player interaction mode. | No fake player-info names or synthetic teams. Preserve default order; optional sorting is a separate setting. | Client tab/team state; narrow overlay hook. |
| /stats and lookup | Manual command opens a minimal player popup; cache-backed mode tabs. | Keep chat output selectable; automatic lookups never steal focus. No invented fields. | Local commands + provider model. |
| Chat/aliases | Annotate copied rich components; hover/player-card actions. | Do not replace original click targets, flatten server components or rewrite command identity. | Legacy Forge chat event + targeted rendering if necessary. |
| Overlay board | Progressive rows with loading/error status and scoped roster updates. | Freeze share snapshots/order; refresh changes do not create extra broadcasts or API loops. | Native model subscriptions. |
| Quick Buy/hotbar preview | Local item-grid screen, tooltips, optional local draft editing. | No fake windows/cursor restoration packets. Server apply remains distinct; drafts require explicit apply. | Native GUI/item rendering. |
| Server menu application | Use actual container/controller with validated action plan. | Server authority, acknowledgements, rollback limits and user interruption remain. Do not spoof transaction success. | Container state + necessary acknowledgement hooks. |
| Nickroll | Native run/candidate panel with explicit manual acceptance. | Books still contain server-issued commands; keep entitlement, pacing and cancellation. | Book item/component access; narrow packet hook if otherwise transient. |
| Sessions/recaps | Combine authoritative messages with richer local lifecycle context; native timeline. | Entity unload/player death is not automatically a match result, killer or final kill. | Chat/scoreboard/lifecycle + targeted titles/results. |
| Timers/reminders | Movable widgets/toasts, snooze and clear local actions. | Server time evidence takes precedence; no exact generator-spawn claims from upgrade schedules. | Client state/events + elapsed clock. |
| Party/arrival | Native roster status and evidence-driven arrival badges. | Tab presence is not authoritative party membership or proof of same server; relay remains relevant. | Server chat + tab context + relay. |
| Denick/real skin | Candidate-review GUI and local display/texture overrides. | No entity destruction/re-spawn just for skin refresh; ambiguity and lookup identity remain. | Providers + scoped render/texture hooks. |
| Sharing/tags | Preview explicit actions; preserve streaming/grouped sharing policy. | No automatic actions from progressive row repaint; provider permissions/privacy remain. | Profiles + scheduler + existing APIs. |
| Auto-dodge | Reason HUD with immediate cancel, stable decision revisions. | UI improves but native access does not prove more complete roster/server state; keep authority/deadlines. | Context/profile events + scheduler/relay. |
| Cosmetics | Native local previews/effects and model/item rendering. | Does not grant/unlock server cosmetics or make others see mod-only effects. | Native renderer + optional effect observation. |
| Scaffold detector | Native alert/evidence UI; shared recorded/live normalized events. | Keep calibrated packet timing; tick/render positions can destroy swing/placement correlation. | Targeted network observations + world context. |
| Recorder | Bounded normalized event recording with native status/cancel controls. | No automatic video/replay engine; preserve event ordering and secret redaction. | Targeted evidence hooks + workers. |
| Providers/history | Shared native async services and paged history. | More UI capability does not change provider access, API limits, compact summaries or account isolation. | HTTP/local storage; no game packets. |
| Desktop services | Launcher owns login; mod owns feature lifecycle/status. | Keep relay/APIs external; proxy ports/installers are not mod features. | Native lifecycle; no second authentication flow. |

Scanning deserves particular care: current src/overlay/scan.js selects candidates from lobbyMap/gameRoster, filters stale entries, rejects unsupported/inactive context and guards oversized rosters. Replacing that map with client state must retain those policies. A native tab list still includes non-match/synthetic entries and is not a universal authoritative roster. Incremental classification should not mean more frequent network fetching. Keep a match roster and evidence of departure separately.

## Standing prompt

Paste this once at session start, followed by the requested step. In a separate project, copy this plan or provide its absolute path.

```text
We are rebuilding Fury as a native Minecraft 1.8.9 Forge Java client mod, incrementally. Read docs/MOD_NATIVE_PLAYBOOK_V2.md in the Fury reference repository and MIGRATION_LEDGER.md in the mod project. Implement only the requested step.

Reference repository: C:\Users\Admin\Desktop\Projects\Minecraft\CustomProxyNodeJS. Preserve its current production working tree and uncommitted changes. Read applicable AGENTS.md and skills. Use the existing FuryMod project if present; never restart or overwrite completed work.

Port product rules and data contracts, but replace proxy-only implementation constraints with native equivalents described in this plan. Keep thresholds, provider provenance, account isolation, command aliases, deadlines, cancellation, uncertain-data handling and retired/forced-off behavior. Record intentional native UI/behavior changes explicitly. Do not revive inactive features.

Prefer Minecraft-owned tab, scoreboard, world, chat-component and container state over duplicate packet-reconstructed mirrors. Read mutable client state on the client thread and publish immutable snapshots. Prefer verified Forge 1.8.9 events; use narrowly scoped hooks where events cannot provide required evidence. Do not assume modern Forge events exist in 1.8.9. Every packet hook needs a documented owner, reason, lifecycle and test.

Raw packet evidence can remain necessary for timing-sensitive detection, title/result events not exposed adequately, and server-container acknowledgements. Render-interpolated positions are not equivalent to network movement observations. Do not remove required evidence in pursuit of a packet-free mod.

Run HTTP/file work on bounded workers. Guard completion by UUID, connection generation, world/match context and request revision as applicable. No network work during rendering; no per-frame full scans; no blanket tick traversal. Use measured change detection and coalescing. Use elapsed time, never fixed frame counts.

Native mode connects directly and needs neither Node nor Electron. An optional temporary bridge has one explicit owner per feature and cannot double-send commands, annotate chat or persist events. Keep one profile cache/model shared across all surfaces.

GUI follows the supplied minimal dark concepts: clear rows, restrained Fury accent, modest corners, semantic Minecraft colors, keyboard/Escape support and correct scaled hitboxes. Use canonical branding. Preserve original server chat actions and server identity; display aliases are never command targets.

Build each step, port meaningful fixtures, verify in-game where possible and state limitations. Update the ledger with source references, deliberate differences, input/evidence type, prerequisites, ownership and results. Do not claim server knowledge or permission the client does not have. End with files changed, checks and next step; do not automatically implement it.
```

## Copyable implementation prompts

### 1. Inventory and existing-project reconciliation

References: All production entry points, app_config.js, command registrations and tests.

```text
Implement native-v2 step 1: Inventory and existing-project reconciliation.

Create or continue an isolated sibling FuryMod project. Verify the Minecraft 1.8.9 Forge MDK/mappings/JDK/Gradle toolchain against official sources and pin reproducible versions. Inventory every active feature/command/setting, effective default, provider, alias and test from the current Fury working tree. Record proxy constraints separately from actual product rules. Add the native input/evidence decision for each feature to MIGRATION_LEDGER.md. Mark forced-off, retired and desktop-only entries. Reconcile any already completed v1 steps instead of redoing them. Build a client-only entry point with clean connection/world/shutdown lifecycle. Do not implement game features.

Follow the standing prompt. Build, run relevant checks, state live verification limits and update MIGRATION_LEDGER.md before stopping.
```

### 2. Settings, ownership and task lifecycle

References: app_config.js; src/profiles/; src/state/runtimeState.js; src/storage/.

```text
Implement native-v2 step 2: Settings, ownership and task lifecycle.

Create typed versioned settings and a registry with stable IDs, category, description, implementation/provider availability, enabled state and descriptors. Port effective normalization and legacy aliases. Separate global appearance from UUID-owned data. Add atomic off-thread persistence, bounded task executors, connection/world/request revisions and cleanup. In native mode the mod owns each feature; optional companion mode must declare ownership explicitly. Preserve forced-off values and exclude secrets from ordinary exports. Test corrupt/invalid config, repeated enable/disable, account changes and cancellation. All later controls share this owner.

Follow the standing prompt. Build, run relevant checks, state live verification limits and update MIGRATION_LEDGER.md before stopping.
```

### 3. Minimal clickable GUI

References: Production launcher settings/controls; docs/fury-mod-gui-concept.png.

```text
Implement native-v2 step 3: Minimal clickable GUI.

Build /fury and configurable Right Shift opening the native screen. Sidebar: Overlay, Chat, Bedwars, Party, History, Settings. Add search, simple module rows, descriptions, toggle and separate settings button. Use supplied dark concept and current Fury accent, canonical assets or text-only branding. No browser runtime. Show unfinished modules as unavailable. Support keyboard focus, scrolling/clipping, GUI scale/resize, Escape/back and keybind conflicts. Match hitboxes to drawn coordinates and restore graphics state. Verify available client sizes and clean screen reopen; do not fake feature success.

Follow the standing prompt. Build, run relevant checks, state live verification limits and update MIGRATION_LEDGER.md before stopping.
```

### 4. Module details and HUD editor

References: Current appearance/defaults; docs/fury-mod-gui-concept.png.

```text
Implement native-v2 step 4: Module details and HUD editor.

Add registry-driven bounded numbers, toggles, dropdowns, sliders, colors, ordered fields and keybind capture. Build anchored/normalized HUD placement with drag and keyboard move, scale, visibility, optional snap, Reset and Done. Clarify apply/cancel semantics and persist changes only. Show clearly labeled fixture previews until live owners exist. Keep gameplay click-through; edit/interaction mode alone captures input. Restore focus, clamp on resize and cache layout by changed inputs. Verify GUI scales, reset, cancelled edits and reload.

Follow the standing prompt. Build, run relevant checks, state live verification limits and update MIGRATION_LEDGER.md before stopping.
```

### 5. Native context and roster adapter

References: src/net/session/{ownIdentity,entityTracking,scoreboard,bedwarsTeamEvidence,duelsMatch,pregame_chat,partyTracking}.js.

```text
Implement native-v2 step 5: Native context and roster adapter.

Read Minecraft-owned tab and scoreboard state on the client thread; publish immutable context and roster snapshots with UUID/display/profile distinctions, team evidence, mode/submode and lobby/match/spectator state. Tab is the primary roster, not loaded entities. Keep a match-scoped retained roster when active players leave tab; absence alone does not prove elimination. Prefer change hooks; if no adequate 1.8.9 event exists, use one bounded diff while relevant, never render-loop scanning. Preserve context inference and evidence precedence. Remove duplicate raw-packet tab/entity mirrors unless a consumer demonstrably needs history. Test transitions, large rosters, unknown teams, unloads and reconnects.

Follow the standing prompt. Build, run relevant checks, state live verification limits and update MIGRATION_LEDGER.md before stopping.
```

### 6. Native API/profile service

References: src/stats/{fetch,lookup,collect,sources,urchin}.js; features/{hypixel_api_client,urchin_client}.js; src/net/apiKillSwitch.js.

```text
Implement native-v2 step 6: Native API/profile service.

Implement native adapters for actually registered Hypixel/Urchin/Aurora/other providers, verifying endpoint/auth contracts from source and official docs. Add bounded shared profile cache, in-flight deduplication, batching where supported, request pacing, deadlines, cancellation and kill switch. Store provenance, freshness and unavailable/private/error states. Capture request identity and reject invalid context completion. No network work in rendering. Reuse loaded data between scan/card/tab/nametag; do not create per-surface caches. Test rate limits/errors, parallel duplicate requests, stale accounts and kill switch. Optional bridge profiles may plug into this interface without becoming required.

Follow the standing prompt. Build, run relevant checks, state live verification limits and update MIGRATION_LEDGER.md before stopping.
```

### 7. Shared stats and native layout formatting

References: src/stats/{format,colors,tagDisplay,tagReasonLabels,pregameIdentity,lookupStatus,renderHelpers}.js; src/stats/render/.

```text
Implement native-v2 step 7: Shared stats and native layout formatting.

Port semantic stat calculations, rounding, rank/prestige colors and provider ping semantics. Separate raw/profile values, semantic text and layout. Native rendering must not reuse scoreboard 16-character clamps or fake-name formatting; truncate only by measured screen width and expose full details on hover. Preserve unavailable versus zero and nicked-profile limitations. Format optional extra rows from already available fields only; do not invent accuracy or provider data. Add golden tests for calculations and semantic colors, plus narrow-screen layout checks. All feature surfaces consume this shared model.

Follow the standing prompt. Build, run relevant checks, state live verification limits and update MIGRATION_LEDGER.md before stopping.
```

### 8. Local commands and user-intent routing

References: features/{command_completion,help_command,fury_menu}.js; registrations in proxy.js.

```text
Implement native-v2 step 8: Local commands and user-intent routing.

Port recognized local commands and aliases with validation and cached completions. /fury opens GUI. Manual /stats opens player details; provide a saved chat/popup preference and explicit chat route. Automatic chat-trigger lookups add annotations/cards without opening screens or taking focus. Consume only Fury commands and pass other server commands unchanged. Translate GUI actions into typed local intents, not simulated chat strings. Defer feature-specific routes until their owner exists and show availability accurately. Keep /deck a compatibility route. Test collisions, aliases, cancellation, completions and exactly-once dispatch.

Follow the standing prompt. Build, run relevant checks, state live verification limits and update MIGRATION_LEDGER.md before stopping.
```

### 9. Native outbound action scheduler

References: src/net/hypixelCommandQueue.js; src/dodge/{bedwarsQueue,pregameCountdown}.js.

```text
Implement native-v2 step 9: Native outbound action scheduler.

Port priority/order, deduplication, deadlines, pacing, cancellations and generation/leader gates into one shared scheduler. Local UI changes bypass the server scheduler; actual commands and container actions use validated transports. Use the normal client command/controller paths, with separate container execution where appropriate, rather than hand-building routine outbound packets. Preserve queue selection/result handling. Show pending/running/cancelled state. Test busy queues, stale contexts, rejected commands, deadline expiry and cancellation with fake clocks. Do not implement automatic dodge or menu workflows yet.

Follow the standing prompt. Build, run relevant checks, state live verification limits and update MIGRATION_LEDGER.md before stopping.
```

### 10. Native scan engine and progressive board

References: src/overlay/{scan,duelsScan,tags}.js; src/launcher/renderer/launcher_overlay_board.js; tests/features/test_scan_threats.js.

```text
Implement native-v2 step 10: Native scan engine and progressive board.

Split scanning into roster snapshot, shared profile requests, pure classification and presentation. Use tab/scoreboard/game context from step 5, provider cache from step 6 and existing Bedwars/Skywars/Duels gates and exclusions. Preserve own/team/bot/denick-duplicate rules, thresholds, bounded candidates, default grouping/order and missing-data handling. Current full-scan code has active-game and oversized-roster gates: do not drop them merely because tab state is easier to read. Show cached/progressive rows with pending/error status. Coalesce relevant roster/config/profile changes, reevaluate only affected rows, and do not increase automatic API refresh cadence. Manual /scan forces the existing permitted refresh policy. Freeze completed result snapshots for sharing/actions. Test roster changes mid-request, out-of-range entities, large lobbies and stale game results.

Follow the standing prompt. Build, run relevant checks, state live verification limits and update MIGRATION_LEDGER.md before stopping.
```

### 11. Player stats popup and lookup screens

References: src/stats/lookup.js; src/stats/render/; docs/fury-stats-popup-concept.png.

```text
Implement native-v2 step 11: Player stats popup and lookup screens.

Build the minimal /stats player modal with avatar, rank/display identity, provider/freshness, actual supported mode/submode tabs, shared stat grid and explicit Add to overlay/View profile/Done. Extend existing Skywars/Duels/general/info/ping routes with their real fields. Manual invocation opens it; automatic triggers never steal focus. Preserve a chat-output option and server command compatibility. Read the shared profile service, reuse cache and show loading/private/missing/errors. Ignore stale player/mode/account requests; mode changes must not blindly refetch unchanged provider data. Verify rapid lookups, missing nick identity, closing during loading, keyboard input and GUI scaling.

Follow the standing prompt. Build, run relevant checks, state live verification limits and update MIGRATION_LEDGER.md before stopping.
```

### 12. Native nametag rendering

References: src/overlay/nametags.js; nametag path in proxy.js; docs/fury-nametags-concept.png.

```text
Implement native-v2 step 12: Native nametag rendering.

Render direct client labels with per-audience prefixes/suffixes/fallbacks, stars, tags, aliases and denick display options. Remove proxy-only 16-character field budgeting, synthetic scoreboard overlay teams and fake profile renames. Permit a compact second row and small tag chips using existing data; default remains restrained. Preserve team/rank colors, original server identity and normal distance/sneak/invisibility/spectator/depth visibility. Inspect Forge 1.8.9 render events and use a narrow label hook if needed; do not cancel whole player rendering just to replace a label. Camera interpolation is for drawing only. Cache label content and restore graphics state. Verify duplicate vanilla/native labels and toggling. Companion ownership, if used, suppresses proxy additions.

Follow the standing prompt. Build, run relevant checks, state live verification limits and update MIGRATION_LEDGER.md before stopping.
```

### 13. Native Tabstats layout

References: src/stats/tabStats.js; src/session/bedwarsTabSettings.js; tab path in proxy.js; docs/fury-tabstats-concept.png.

```text
Implement native-v2 step 13: Native Tabstats layout.

Draw aligned native columns from the shared profile/context model. Preserve vanilla/server default ordering, team/rank identity, header/footer, selected mode/fields and nick handling. Remove synthetic team ordering and player-info text rewrites. Add width-aware overflow/tooltips, field controls and optional user-selected sorting without changing default order. Holding TAB stays a passive overlay. A separate keybind/explicit interaction mode enables mouse selection and opens player details; do not consume ordinary combat clicks. Cache changed rows/layout, handle full lists and verify scales, header/footer, unavailable fields and restoration on disable.

Follow the standing prompt. Build, run relevant checks, state live verification limits and update MIGRATION_LEDGER.md before stopping.
```

### 14. Native chat annotations, triggers and aliases

References: features/{minecraft_chat,chat_controller,chat_triggers,looking_for_triggers}.js; src/overlay/chat_overlay_annotation.js; src/friends/aliasBook.js; src/denick/displayNames.js.

```text
Implement native-v2 step 14: Native chat annotations, triggers and aliases.

Use Forge 1.8.9 rich chat components rather than raw JSON packet rewrites for ordinary received chat. Copy before modification and preserve original nested styles/click/hover actions, translations and channel type. Add Fury annotations with separate action targets; existing server actions must remain accessible. Port mentions, DMs, pregame/LF triggers, dedupe and configured gates. Resolve sender evidence carefully rather than treating any text name as an authenticated sender. Add cached hover/player-card intents; async results must not attach to recycled/changed messages. Keep aliases as display-only mappings and never alter server command targets. Test nested components, action-bar messages, links and no-popup automatic triggers.

Follow the standing prompt. Build, run relevant checks, state live verification limits and update MIGRATION_LEDGER.md before stopping.
```

### 15. Native HUD, queue time and reminders

References: src/session/{queueTime,bedwarsGeneratorSchedule,sessionSnapshot}.js; features/{ender_dust_reminder,gambler_george_reminder}.js; src/reminders/.

```text
Implement native-v2 step 15: Native HUD, queue time and reminders.

Build queue/session/generator-upgrade widgets, small reminder toasts and snooze/dismiss actions in the existing HUD system. Port thresholds, remembered-account state, API-key reminder metadata and party-chat options. Widgets update by context/model changes; clocks use elapsed time with authoritative schedule corrections. A generator upgrade schedule does not establish exact item-spawn times. No automatic provider request every timer tick. Until tracking is ported, show session fields unavailable or clearly labeled preview, not fake live totals. Preserve game/rank/team colors and update when step 18 adds tracking. Test missed starts, server transition, account switch, snooze and duplicate suppression.

Follow the standing prompt. Build, run relevant checks, state live verification limits and update MIGRATION_LEDGER.md before stopping.
```

### 16. Denick review, display identities and local skins

References: src/denick/; src/net/session/denickTracking.js; src/stats/denickLookupPlayer.js; launcher denick actions.

```text
Implement native-v2 step 16: Denick review, display identities and local skins.

Port existing skin/stats lookup evidence and bounded automatic gates. Add native candidate-review screen showing confidence/provenance and ambiguity; preserve history ownership, manual review and configured announcements. Separate real lookup UUID, server identity, alias and displayed name. Apply confirmed optional local name/texture overrides through scoped rendering/texture resolution; do not destroy/re-spawn entities or forge player_info just to refresh display. Preserve original UUID and server teams. Cache texture loads off-thread and invalidate on resource/account/world changes. No assumption a mod discovers real identities absent provider evidence. Test ambiguous candidates, rapid nick changes, failed textures and removal of overrides.

Follow the standing prompt. Build, run relevant checks, state live verification limits and update MIGRATION_LEDGER.md before stopping.
```

### 17. Identity-aware scan refinement

References: src/overlay/scan.js; src/overlay/duelsScan.js; denick integration and current scan/share tests.

```text
Implement native-v2 step 17: Identity-aware scan refinement.

Integrate native denick results into existing scan lookup targets without duplicating nick/real-name rows. Keep stable roster identity even when display identity changes. Reclassify affected players only; preserve own/team/bot exclusions and original ordering. Keep known-identity/profile provenance, mismatch handling and current request budgets. A displayed real name is not a new server roster entry. Completed share/action snapshots remain revisioned, so late identity results do not trigger unintended rebroadcast/dodge. Verify aliases, ambiguous candidates, known history, scan cancellation, account changes and stale profile responses.

Follow the standing prompt. Build, run relevant checks, state live verification limits and update MIGRATION_LEDGER.md before stopping.
```

### 18. Native match/session tracking

References: src/session/{sessionTracker,localTracking,localStats,gameEvents,gameResult,observedStats,modeDefinitions,submodeStats,modeBreakdown}.js.

```text
Implement native-v2 step 18: Native match/session tracking.

Use normalized chat, scoreboard, title/result and client lifecycle evidence to port Bedwars/Skywars/Duels/private/submode tracking. Keep authoritative server event/outcome precedence, deduplication, incomplete games, reconnect/resume and local-versus-API provenance. Client death/respawn can corroborate local lifecycle but cannot prove killer, final death or team elimination; entity unloading does not mean elimination. Inspect available 1.8.9 hooks; retain a narrow title hook where required by current result logic. Store evidence source/confidence. Feed real session HUD state from step 15. Test title-only results, repeated chat, reconnects and API/local reconciliation against existing fixtures.

Follow the standing prompt. Build, run relevant checks, state live verification limits and update MIGRATION_LEDGER.md before stopping.
```

### 19. Native storage and safe import

References: src/session/{sessionStore,sessionSnapshot,settings,historyResponse}.js; current reconciliation callers/tests; src/storage/.

```text
Implement native-v2 step 19: Native storage and safe import.

Persist UUID-owned native sessions/games and bookmarks atomically off-thread with current retention/session boundaries. Add explicit import preview, versioned report and backups for supported existing Fury data; never modify original stores or import auth tokens. Preserve stable IDs, provenance and idempotent merge/reconciliation from current source. Use paged compact summary projections and revision-aware details, even within one process; lazy queries avoid loading full history for each view. Test interrupted writes, corruption, repeated import, retention, account changes and stale detail revisions.

Follow the standing prompt. Build, run relevant checks, state live verification limits and update MIGRATION_LEDGER.md before stopping.
```

### 20. Native history/calendar/timeline

References: src/session/{calendarStats,cardStatsPolicy,modeBreakdown,submodeStats,historyResponse}.js; launcher history/calendar/card renderers.

```text
Implement native-v2 step 20: Native history/calendar/timeline.

Build minimal session/date/game screens with filters, mode breakdown and an on-demand evidence timeline. Preserve timezone/date grouping, aggregate policies, viewed versus connected UUID and incomplete-game handling. Read compact paged summaries and lazy details, render visible rows and cancel stale selections. Evidence timeline may reveal already tracked events without inventing exact timings or new stats. Distinguish loading/empty/filtered-empty/error. Verify long history, calendar boundaries, rapid account navigation, detail mutation and keyboard back.

Follow the standing prompt. Build, run relevant checks, state live verification limits and update MIGRATION_LEDGER.md before stopping.
```

### 21. Recaps, replay links and clip bookmarks

References: src/session/{gameRecap,gameClips}.js; src/menu/replayResults.js; src/stats/recapScoreboard.js.

```text
Implement native-v2 step 21: Recaps, replay links and clip bookmarks.

Replace chat-heavy recap presentation with a compact native recap/game screen while preserving optional chat output and automatic recap gates. Expose replay link/suggest actions and bookmark timeline only when real IDs/offsets exist. /clip records a named moment; add an explicit bookmark keybind using the same owner, not video capture. Preserve last-game/account selection, incomplete/replay-less states, late enrichment and deduplication. No auto-popup mid-combat. Test replay offsets, changed accounts, manual labels and late API reconciliation.

Follow the standing prompt. Build, run relevant checks, state live verification limits and update MIGRATION_LEDGER.md before stopping.
```

### 22. Party tracking, overview and arrival UI

References: src/net/session/partyTracking.js; src/party/{overview,arrivalCheck}.js; src/dodge/partyArrival.js.

```text
Implement native-v2 step 22: Party tracking, overview and arrival UI.

Port server-chat-based party membership/leader logic and existing status/check commands; native tab alone is not a party API. Add simple Party screen with membership, leader, expected arrival and observed/confirmed/pending status. Use client tab/roster context for presence and existing join/relay evidence for arrival; absence remains unknown until current policy determines a warning. Keep party versus lobby identity separate and cancel stale checks. Use shared cache and scheduler. Verify leader transfers, nick identities, split lobbies and tabs that cannot show every party member.

Follow the standing prompt. Build, run relevant checks, state live verification limits and update MIGRATION_LEDGER.md before stopping.
```

### 23. Native relay coordination

References: src/party/coordination{Protocol,Client,Auth}.js; docs/PARTY_COORDINATION.md; cloudflare/party-coordination/.

```text
Implement native-v2 step 23: Native relay coordination.

Port the current authenticated relay client unchanged at the protocol boundary. Preserve room/leader authority, sequence/revision guards, freshness, bounded payloads, expiry and reconnect. Publish only currently supported evidence; a local client state change does not authorize new relay fields or protocol behavior. Keep mixed proxy/mod parties compatible and local fallback when peers are unavailable. No provider keys in messages. Test replay/spoof/stale messages, role changes and exactly-once effects. Do not deploy or modify relay infrastructure in this step.

Follow the standing prompt. Build, run relevant checks, state live verification limits and update MIGRATION_LEDGER.md before stopping.
```

### 24. Sharing and community-tag GUI

References: src/overlay/{shareTags,shareEchoRewriter}.js; src/stats/{urchin,tagDisplay,tagReasonLabels}.js; current tag command paths.

```text
Implement native-v2 step 24: Sharing and community-tag GUI.

Add explicit native share preview/edit controls and existing tag-review/create/remove forms. Preserve destinations, grouping/order, streaming behavior where supported, inclusion rules, privacy/overwrite options, permissions and error handling. If automatic sharing streams by team, preserve its scheduler/snapshot semantics; progressive UI repaint is not a send trigger. Keep local echo annotations separate from original messages. Tag mutation occurs only on explicit Apply/Remove, never card opening. Route through shared provider/scheduler ownership. Test partial scans, stale revisions, duplicates, permission errors and masked exports.

Follow the standing prompt. Build, run relevant checks, state live verification limits and update MIGRATION_LEDGER.md before stopping.
```

### 25. Auto-dodge native decision/HUD

References: src/dodge/autoDodge.js; coordination/arrival logic; current dodge tests.

```text
Implement native-v2 step 25: Auto-dodge native decision/HUD.

Port current predicates, thresholds/include presets, delay, arrival/leader gates and exactly-once action policy. Show compact reason/countdown HUD with explicit Cancel and optional manual Queue action. Tie the decision to match/party/roster revisions so coalesced profile changes cannot repeatedly arm it. Preserve existing deadline and cancellation semantics; do not change default automation mode just because UI is richer. Native roster access does not prove complete enemy identity. Keep advisory/automatic transports distinct and record server-compatibility limitations. Verify leader changes, threats changing during delay, manual cancel, rejected queue result and disconnect.

Follow the standing prompt. Build, run relevant checks, state live verification limits and update MIGRATION_LEDGER.md before stopping.
```

### 26. Local Quick Buy/hotbar preview and drafts

References: src/menu/{quickBuyPreview,quickBuyImport,quickBuyMessages,quickBuy,hotbarLayout}.js; menu fixtures.

```text
Implement native-v2 step 26: Local Quick Buy/hotbar preview and drafts.

Replace fake inventory previews with native item-grid screens, real item tooltips and named preset controls. Keep current category/slot mapping, validation and /qb,/hb/combined aliases. Add local draft rearrangement, undo/reset and original-versus-draft differences; changes never affect the server until explicit Apply. Do not create fake window IDs, restore client inventory packets or touch the real cursor. Define safe behavior when a real server container is open: prefer a reversible in-container overlay or defer the preview; opening an ordinary screen can itself close a container, so do not claim it is always non-invasive. Test unknown items, editing/cancel, window changes and account ownership.

Follow the standing prompt. Build, run relevant checks, state live verification limits and update MIGRATION_LEDGER.md before stopping.
```

### 27. Real server-container application

References: src/menu/{quickBuy,hotbarLayout,menuMonitor,quickBuyTrace,bookTrace}.js; window/transaction tests.

```text
Implement native-v2 step 27: Real server-container application.

Use verified actual container/controller state to apply validated preset differences with normal client actions. Preserve menu fingerprints, current window/generation, cursor conditions, pacing, acknowledgements, timeouts and interruption. Do not hand-forge success or replay local draft clicks against arbitrary slots. User interaction/window changes cancel stale plans. Avoid importing proxy-only hold/swallow-transaction behavior into the normal client path. Diagnose server acknowledgements with a narrow hook where needed. Show partial-completion status accurately and allow manual workflow. Test rejected transactions, mismatched menus, cursor changes and disconnect in a controlled environment.

Follow the standing prompt. Build, run relevant checks, state live verification limits and update MIGRATION_LEDGER.md before stopping.
```

### 28. Nickroll native workflow

References: src/nick/; src/menu/{bookContent,bookTrace}.js; current nickroll tests.

```text
Implement native-v2 step 28: Nickroll native workflow.

Build native start/stop/status, filters, word lists and candidate review using existing server book/component commands and pacing. Read actual ItemStack/NBT/chat components rather than rebuilding a separate full proxy inventory model. If candidate books are transient and not exposed by events, retain a scoped observation hook. Preserve eligibility, allowed command validation and explicit MANUAL acceptance. Display matching evidence and support copy without accidental acceptance. Reuse scheduler/context cleanup; opening status UI must not corrupt a server book workflow. Test malformed/late books, unexpected menus, interrupted runs and repeated start.

Follow the standing prompt. Build, run relevant checks, state live verification limits and update MIGRATION_LEDGER.md before stopping.
```

### 29. Native cosmetic search and local preview

References: src/cosmetics/; cosmetic_search_api.js; launcher cosmetic picker; src/menu/killMessageLogger.js.

```text
Implement native-v2 step 29: Native cosmetic search and local preview.

Port catalog/aliases/search/active-provider fields and local kill/bed-message presentation. Replace injected visual/audio effects with scoped native previews where feasible, using actual item/model/particle systems and bounded lifetimes. Preserve server-observed versus locally selected provenance; no server entitlement, global visibility or cosmetic unlock claims. Cache assets and clean effects on world/resource changes. Keep effect recording opt-in and preserve semantic message formatting. Test unknown catalog entries, repeated effects, disabled settings and resource reload. Do not change Fury branding.

Follow the standing prompt. Build, run relevant checks, state live verification limits and update MIGRATION_LEDGER.md before stopping.
```

### 30. Scaffold evidence and native alerts

References: src/detect/{scaffoldDetector,detectorShared}.js; src/recorder/featureExtraction.js; detector tests.

```text
Implement native-v2 step 30: Scaffold evidence and native alerts.

Port the active scaffold detector with its normalized event schema and existing calibrated timing/thresholds. Keep targeted raw movement/look/swing/block-change observations wherever required: render interpolation and tick sampling are not substitutes for packet timing. Use native world state only to contextualize evidence, not invent placement attribution. Handle thread ordering, batched events, coordinate units and packet observation timestamps explicitly. Build a native uncertain-evidence alert/card with dedupe/team policies. Keep autoblock/stasis forced off. Test live-versus-recorded parity, benign bridges, missing/batched events and world reset before enabling alerts.

Follow the standing prompt. Build, run relevant checks, state live verification limits and update MIGRATION_LEDGER.md before stopping.
```

### 31. Bounded native recorder/analysis

References: src/recorder/; src/cosmetics/{effectRecorder,effectFingerprint,effectLibrary}.js; /recordcheat,/rc routes.

```text
Implement native-v2 step 31: Bounded native recorder/analysis.

Port opt-in recording with normalized timestamped events, bounded pre/post buffers, stop/cancel/status and versioned metadata. Capture evidence in consistent order using shared hooks, avoiding duplicate subscriptions. Keep analysis off-thread and redact secrets/session tokens. Preserve units/timebase and offline feature-extraction fixtures so recordings remain useful for detector parity. Resource reload/world/account changes close the correct recording scope. This is diagnostic evidence, not video or a full replay engine. Test size/retention bounds, malformed files, dropped events and cancellation.

Follow the standing prompt. Build, run relevant checks, state live verification limits and update MIGRATION_LEDGER.md before stopping.
```

### 32. Quick Maths and remaining active small modules

References: features/quick_maths.js; src/health/settingsAnnouncements.js; inventory of active command/reminder paths.

```text
Implement native-v2 step 32: Quick Maths and remaining active small modules.

Port remaining active small modules individually and reconcile missing ledger entries. For Quick Maths, use actual rich chat choice actions and native compact status/answer controls; preserve configured automatic-answer behavior separately, deadlines, spectator/respawn pause, expiry and cancellation. Never fabricate server answer commands from arbitrary text. Reuse scheduler and avoid focus stealing. Do not enable autoGambler, removed deck/social toggles or inactive detectors. Test current fixtures plus mode transitions; document any intentional manual/advisory option without silently changing imported defaults.

Follow the standing prompt. Build, run relevant checks, state live verification limits and update MIGRATION_LEDGER.md before stopping.
```

### 33. Profiles and migration-aware import/export

References: src/profiles/{profileStore,presetRender}.js; app_config.js; account-owned stores.

```text
Implement native-v2 step 33: Profiles and migration-aware import/export.

Port exact profile allowlists/defaults and add native save/load/list/reset UI. Import supported Fury settings with field-level preview: preserved rules, replaced proxy-only limits, ignored desktop settings and new native presentation choices. Keep original data/backups; export no credentials. Do not normalize native label widths back to scoreboard character caps. Apply changes through one shared owner with coalesced notifications. Test historical aliases, corrupt files, round-trip, forced-off values and repeated apply.

Follow the standing prompt. Build, run relevant checks, state live verification limits and update MIGRATION_LEDGER.md before stopping.
```

### 34. Standalone status and desktop-service retirement

References: Accounts/auth, updates, proxy health/status, bootstrap/shutdown/storage owners.

```text
Implement native-v2 step 34: Standalone status and desktop-service retirement.

Audit runtime dependencies and make native status/provider/relay/settings services complete. Minecraft launcher owns login/account switching; do not port refresh tokens, alternate authentication or proxy port controls. Translate useful health/status into native provider/task diagnostics without inventing ping semantics. Preserve verified update metadata/notifications with normal jar replacement. External APIs/relay may remain; Node/Electron/localhost bridge must not be required. If an optional bridge was used, disable it cleanly and verify direct server connection. Keep original proxy and user stores untouched.

Follow the standing prompt. Build, run relevant checks, state live verification limits and update MIGRATION_LEDGER.md before stopping.
```

### 35. Native parity and deliberate-difference acceptance

References: Completed ledger, original fixtures, supplied GUI concepts and performance measurements.

```text
Implement native-v2 step 35: Native parity and deliberate-difference acceptance.

Audit every active command/setting/feature against its native implementation and explicitly documented changes. Verify direct connection with proxy stopped, all normal flows, account isolation, reconnects, repeated toggles, GUI scales and supported co-installed mods. Confirm native labels/table/previews do not mutate server teams/identities/inventory and detector evidence retains timing parity. Measure representative frame times/allocations/startup/API counts/history memory; compare to a baseline of the same scenario and retain complexity only for measured benefit. Produce installable jar, setup guide, completed ledger and non-destructive import/rollback instructions. Report unsupported/live-unverified behavior; do not delete the proxy.

Follow the standing prompt. Build, run relevant checks, state live verification limits and update MIGRATION_LEDGER.md before stopping.
```

## Optional B1 — temporary bridge, only if useful to existing work

Do not build this as a prerequisite for a native-first project. If an existing companion bridge is working, retain it temporarily behind the same model interfaces and explicit ownership.

```text
Implement optional native-v2 B1 only for features explicitly listed in the migration ledger as companion-owned. Define a versioned authenticated loopback protocol with capability/UUID/generation handshake, compact allowlisted projections, revisions, bounded messages and reconnect/backoff. The health endpoint is not assumed to supply this contract. Reject incompatible/stale/account-mismatched data and allowlist actions. Each feature has one owner; suppress corresponding proxy presentation/commands/tracking while native-owned and avoid unsafe automatic replay on reconnect. Native service interfaces must also work without the bridge. Test duplicates, stale reconnection and disconnect; do not transfer credentials or full history graphs. Update the ledger and migration-off criteria.
```

## Packet-hook decision checklist

For each consumer: identify the fact it requires; locate client-owned state or a verified 1.8.9 event; determine whether event timing/history survives that representation; add a targeted observation hook only for missing evidence. Document sampling/thread/timebase and cleanup. A render event is for drawing, not detector measurement. If an adequate tab/scoreboard-change event does not exist, one gated/coalesced snapshot diff is acceptable; repeated full scans in rendering are not.

## Sources and verification limits

- Local source anchors are attached to every prompt. Relevant current files include active uncommitted changes; preserve them.
- Legacy chat event source confirms rich IChatComponent access and message channel type: https://raw.githubusercontent.com/MinecraftForge/MinecraftForge/1.8.9/src/main/java/net/minecraftforge/client/event/ClientChatReceivedEvent.java
- Legacy living-render event source establishes available Pre/Post/Specials event shapes; exact label behavior still needs pinned-runtime inspection: https://raw.githubusercontent.com/MinecraftForge/MinecraftForge/1.8.9/src/main/java/net/minecraftforge/client/event/RenderLivingEvent.java
- Forge 1.8.9 distribution: https://files.minecraftforge.net/net/minecraftforge/forge/index_1.8.9.html
- Server compatibility reference, not approval of the proposed feature set: https://support.hypixel.net/hc/en-us/articles/6472550754962-Hypixel-Allowed-Modifications

No Java mod project, new game hook, performance claim or in-game behavior was verified during this planning revision. The generated GUI concepts remain illustrative; literal health lines/tags in images do not authorize new fields absent existing data.

