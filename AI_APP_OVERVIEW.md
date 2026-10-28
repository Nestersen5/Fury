# Fury — Product Overview and AI UI/UX Design Reference

Analysis date: 14 October 2026. Scope: the current working tree, including unpublished changes.

**Design target specified by the product owner:** Fury is being ported from its proxy/Electron form into a Minecraft Forge mod. All product GUIs and settings must be accessible in-game. The in-game interfaces should be more compact and intuitive than the desktop workspace. Preserve feature coverage while simplifying what users see at each step.

**Evidence and limitations:** This document follows `package.json` → `launcher.js` → `launcher.html` → mounted renderer/style modules, and `proxy.js` → `src/` and `features/`. It also inspects supporting services, persistence, tests, documentation, website and Cloudflare workers. UI findings are based on source code; the application was not rendered or visually inspected, and no Minecraft session, live provider request, build or test suite was run for this documentation task. CSS dimensions describe source rules, not measured screenshots. Existing tests provide behavioral evidence, not newly verified results. Private runtime data, authentication caches and credential values were not used.

“Implemented” below means an active implementation exists in this checkout; it does not establish publication, deployment or live reliability. Migration proposals are explicitly separated from implemented behavior. Historical prototypes, `hud-overlay-demo/`, packaged applications and concept images are not evidence of current production functionality.

## 1. Executive Summary

Fury is a companion for Minecraft Java 1.8.9 players on Hypixel, especially those playing BedWars, SkyWars and Duels. It helps players understand opponents and teammates, recognize disguised accounts where evidence permits, decide whether to stay in a queue, customize game information, and review their own play.

Today, the product consists of a desktop launcher and a local Minecraft proxy. The player signs in with Microsoft through Fury, starts the proxy, and joins a local server address from Minecraft. Fury forwards the connection to Hypixel while interpreting game information and adding local chat output, Tab statistics, nametags and other assistance. Its desktop workspace manages accounts, settings, a player board, nickname history, session cards, reminders and profiles.

Fury brings several otherwise separate activities into one workflow: checking player statistics, interpreting community tags, keeping nickname matches, monitoring party safety, configuring information shown in-game, and reviewing recorded sessions. Its most distinctive capabilities combine live game context with external data and locally saved history.

The owner's next product form is a **Forge mod with every product GUI and setting available inside Minecraft**. This is a complete product migration, not merely a small HUD overlay. The design should translate Fury's established behavior into compact, discoverable screens with quick common actions and separate advanced controls. The inspected repository remains the proxy/desktop implementation; native Forge screens are a target, not a verified deliverable here.

## 2. Product Vision and Purpose

### Current problem and value

Hypixel presents information across chat, the player list, scoreboards, server menus and external services. A player may want to assess a lobby, check a teammate, understand an unfamiliar nickname, keep useful stats visible, or review a session without repeatedly searching several tools.

Fury addresses those needs by:

- Presenting player stats and provider tags in the context of a lobby or match.
- Adding configurable information to Minecraft chat, Tab and nametags.
- Automating selected repetitive actions with context checks and cancellation.
- Saving account-specific sessions and nickname knowledge for later review.
- Offering preferences and named playstyle profiles rather than one fixed information layout.

The code supports a goal of informed play and convenient configuration. It does not establish commercial targets, pricing, acquisition goals or a measured user demographic. Competitive motivation is strongly suggested by FKDR thresholds, threat scans, Auto Dodge and the recommended playstyle profile, but it is an inference rather than a researched audience claim.

### Confirmed migration direction

The owner has explicitly stated that the whole proxy product is being ported to Forge and that all GUIs/settings must be in-game, with a more compact and intuitive presentation. Future designs must therefore cover both everyday gameplay and occasional administration without requiring the Electron window.

`docs/MOD_NATIVE_PLAYBOOK_V2.md` proposes native Minecraft 1.8.9 Forge/Java implementation, shared asynchronous services, a searchable module interface, detail screens and a HUD editor. It explicitly describes planned work. Its proposed sidebar and keybinding are useful starting references, not evidence that those interfaces already exist or a reason to freeze the final navigation.

Desktop-specific mechanisms need translation: proxy start/stop, localhost connection instructions, local ports and Microsoft login belong to today's architecture. In a standalone native mod, Minecraft/the game launcher normally owns the signed-in identity and connection. Preserve relevant feature/status/configuration access in-game; establish which transitional controls remain necessary before designing them as permanent mod settings.

## 3. Target Audience

### Primary users supported by the implementation

- **Hypixel players focused on BedWars:** the deepest feature set includes pregame Auto Dodge, team-aware player boards, final-kill/bed stats, shop-layout tools, Slumber reminders and game-phase information.
- **SkyWars and Duels players:** supported stat lookups and session tracking, with additional mode-specific scanning/presentation. Feature parity across all three modes must not be assumed.
- **Players who want configurable information:** select which stats appear, choose nametag audiences and fallback values, adjust chat behavior, and save different playstyles as profiles.
- **Party players:** inspect party members, receive split warnings, share scan summaries and use nickname-related party workflows.
- **Players reviewing their progress:** browse their own saved sessions and calendar summaries, then copy or download shareable cards.
- **People using multiple Minecraft accounts:** select the account whose history/reminders they are reviewing while preserving the separate live Minecraft identity.

These describe supported needs, not proven market segments. Some features require server permissions, a suitable Hypixel rank, visible public data or optional provider keys; installing Fury does not grant those capabilities.

### Specialist users and permissions

Users with an Urchin administration key can perform community-tag mutations through implemented handlers/commands. This is an external service permission, not a Fury-wide administrator role. Developers have diagnostic recording, tracing and test commands, which should not dominate ordinary player navigation.

No general application role hierarchy, organization/team workspace, billing role or social account system was found. The central identities are Minecraft accounts, party relationships and provider credentials.

## 4. Core Features

### 4.1 Connecting through Fury and managing accounts

The launcher offers Microsoft browser sign-in, a sign-in code, retry/cancel actions, cached login status and guidance for adding a local Minecraft multiplayer server. The dashboard emphasizes the main address, with setup help and alternative connection routes in disclosures. Direct and failover routes are implemented; a custom route is optional.

Users can add accounts, select an account to view, refresh a login and remove a saved login. Selection changes the history/reminders displayed; it does not switch the account already connected in Minecraft. Removing an account preserves saved sessions and reminder history, and removal of the currently connected account is disabled.

Sources: `launcher.js`, `src/accounts/`, `src/launcher/renderer/launcher_onboarding.js`, `launcher_redesign.js`, `src/storage/runtimePaths.js`.

### 4.2 Player statistics and game scanning

Players request BedWars, SkyWars, Duels and general Hypixel information with commands such as `/stats`, `/sw`, `/duels`, `/general`, `/info` and `/ping`. Cards provide mode-specific details and interactive links. Time-period stat commands also exist; these provider-backed lookups should not be conflated with the local calendar history.

Scans analyze a context-appropriate player list and can show all players, threats only or no scan output. Threat classification includes configurable stat thresholds and genuine provider tags. Automatic scanning at recognized game starts is available. Nicked/unavailable profiles are handled differently from ordinary known profiles; an unsuccessful lookup is not a zero-stat player.

Sources: `src/overlay/scan.js`, `duelsScan.js`, `src/stats/collect.js`, `fetch.js`, `lookup.js`, `render/`, `features/help_command.js` and registrations in `proxy.js`.

### 4.3 Launcher Overlay player board

The current **Overlay** is a desktop page showing live and manually added players. BedWars supports team cards; a list view and SkyWars presentation also exist. It shows configurable stat columns, nickname/tag indicators, source markers and team/lobby summaries. Ranking derives from the selected primary stat; the board can identify the player's team and summarize opposition strength.

Players can search, add and remove entries, clear rows and adjust the board's presentation. Mentions, direct messages, party events and configured chat phrases can contribute rows. Automatic collection is gated by the owning context, including whether the page is open and relevant preferences.

This is distinct from in-game Tab stats and nametags. A floating overlay control is removed by the active renderer; the separate HUD demo is not the production board. Moving this board into an in-game GUI is part of the requested port.

Sources: `launcher.html`, `src/launcher/renderer/launcher_overlay_board.js`, `launcher_redesign.js`, `src/health/httpServer.js`, `features/chat_triggers.js`.

### 4.4 Nickname detection, lookup and history

Fury can link a disguised nickname to a real account through supported skin/stat evidence, manual mappings and party-specific reasoning. The launcher provides searchable/filterable history with a selected-match detail pane, source method, timestamps and previous names. Users can copy an IGN, remove a mapping or add a known mapping manually.

Denick Lookup accepts finals/beds criteria and optional advanced cosmetic filters. Cosmetic searching uses Aurora-backed resource data; multiple cosmetic criteria use exact combined matching. Results are evidence/candidates, not a promise that every nick can be identified. Automatic stat matching has an Aurora dependency.

Settings independently control detection and where confirmed identities appear: chat, nametags, skins and party announcements. Friend aliases provide another display layer through in-game commands and settings. Display identity must remain separate from actual server/command identity.

Current unpublished source additionally supports conservative automatic teammate nickname saving with Undo, tracking one's own nickname history, and sharing a freshly observed current nickname with eligible Fury party peers. The draft changelog explicitly requires deployment of the updated party relay before advertising online nickname exchange. The supported sharing contexts are recognized BedWars, SkyWars and Duels games, with freshness, same-server/mode and additional relationship checks. It is not a global nickname database or unconditional party broadcast.

Sources: `src/denick/`, `src/launcher/denickHistory.js`, `denickActions.js`, `src/launcher/renderer/launcher_redesign_nicks.js`, `src/friends/aliasBook.js`, `src/party/nicknameSharing.js`, `docs/UNRELEASED_CHANGELOG.md`.

### 4.5 Nick Reroller

Players configure name length, digits/underscores, text rules, word matches, repeated-letter matching, nickname rank and skin preference in the launcher. They start/stop a run using `/nickroll` in a suitable Minecraft lobby.

The implementation waits for server nickname-book responses and respects cancellation, cooldowns, failures and connection/world changes. Matching a candidate stops the run and offers **Use Name** or **Roll Again**. A matching name is never automatically applied. Special word/repeated-letter rules can bypass the normal filter combination. Server permission requirements still apply.

Sources: `src/nick/settings.js`, `reroller.js`, `pacing.js`, `src/launcher/renderer/launcher_nickroll.js`, relevant tests under `tests/features/`. The README's detailed filter description may lag newer controls; current normalization/runtime code is authoritative.

### 4.6 Auto Dodge, party awareness and sharing

Auto Dodge can leave a **BedWars pregame** when an eligible observed player meets configured tag, nickname or stat conditions. It supports immediate or pre-start timing, a reason and cancellation. It must never leave an already active match. Party members, resolved identities, incomplete party knowledge and provider notices require special handling; a generic “Caution” provider notice is not a player report.

Party features include tracked membership/leadership, a manual local `/po` overview, queue-time reporting and warnings when party members may be split. A WebSocket coordination path supplements local observations for compatible Fury peers and falls back when unavailable. Peer presence is authenticated but party membership is based on mutual client observations, not an independent Hypixel attestation.

`/share` sends selected scan information to party or all chat according to settings, with inclusion/grouping controls. This explicit or configured broadcast is separate from private display and from the nickname-exchange protocol.

Sources: `src/dodge/`, `src/party/`, `src/net/session/partyTracking.js`, `src/overlay/shareTags.js`, `shareEchoRewriter.js`, `src/session/queueTime.js`, `docs/PARTY_COORDINATION.md`.

### 4.7 In-game presentation

Configurable Tab stats, nametags and chat output keep selected information visible while playing. Controls include mode-specific Tab visibility/field order, labels/tags, nametag audience groups and prefix/suffix fallback stats. Confirmed real names/skins and optional friend aliases can alter local presentation. BedWars Tab settings include resource totals and phase timers; these are inferred/tracked game information, not unrestricted server data access.

The launcher includes live-style previews, ordered stat controls and separate Tab list, nametag and color panes. Minecraft rank, prestige, team and stat colors have semantic meaning. Fury's configurable accent is not permission to recolor every server message.

Sources: `src/stats/tabStats.js`, `src/overlay/nametags.js`, `src/denick/displayNames.js`, `src/session/bedwarsTabSettings.js`, `bedwarsGeneratorSchedule.js`, `src/launcher/renderer/launcher_ingame_appearance.js`, `features/minecraft_chat.js`.

### 4.8 Sessions, calendar summaries, recaps and replay annotations

Fury saves sessions for the account playing through it, covering BedWars, SkyWars and Duels. Tracking can use API snapshots and verification or locally observed game information when the API is unavailable. It records supported results, mode totals, game context and events; unavailable or incomplete evidence must remain explicit.

The effective desktop Sessions page is a list of expandable session cards, with mode/submode and date filtering, start/end controls, PNG copying/downloading and deletion of ended sessions. Daily, weekly and monthly summaries aggregate locally recorded history, use the local timezone and Monday-start weeks, and can mark partial periods. These summaries are not a complete lifetime account history.

Optional post-game recaps appear in Minecraft chat and `/recap` re-shows the latest recap. Expanded `/replay` menu details add recorded results, teammates and named `/clip` moments. A clip is a timestamp/bookmark, not a recorded video. Packet-evidence recording is a separate specialist feature.

Older per-game desktop dashboard/drawer code remains in `launcher.html`, but the active renderer hides/replaces the old session presentation. Do not inventory that legacy drawer as a normal current screen.

Sources: `src/session/`, especially `sessionTracker.js`, `localTracking.js`, `localStats.js`, `sessionStore.js`, `gameResult.js`, `gameRecap.js`, `calendarStats.js`, `gameClips.js`; `src/menu/replayResults.js`; `launcher_redesign.js`, `launcher_calendar_stats.js`, `launcher_session_card.js`.

### 4.9 Reminders and small game tools

The Reminders page tracks account-specific Ender Dust/Slumber progress and Gambler George bet/claim progress. It supports manual checks, thresholds and reminder preferences; saved knowledge can remain available without an active game connection. A separate Hypixel API-key reminder offers update/snooze interactions.

Quick Maths provides optional automatic responses to recognized game prompts. Other command-driven utilities exist; their mere presence in code does not justify adding prominent GUI modules. In particular, Auto Gambler is deliberately reset off at startup and is excluded from playstyle profiles.

Sources: `features/ender_dust_reminder.js`, `gambler_george_reminder.js`, `quick_maths.js`, `auto_gambler.js`, `src/reminders/`, `src/bootstrap/config.js`.

### 4.10 Profiles and BedWars layouts

Profiles bundle safe scan, chat, display and gameplay preferences. Users can inspect built-in playstyles, review changes, apply a profile, save the current setup, duplicate/edit/delete custom profiles and import/export `.furyprofile` files. Keys and certain global safety settings are excluded. A profile is a preference bundle, not an account or a complete backup.

Quick Buy and hotbar tools copy another player's publicly available layout or save/load named local layouts, individually or together. Preview commands exist. Applying a layout drives actual Hypixel menus and checks responses; it requires a suitable lobby/standing state and can be cancelled. Cancellation may leave already applied changes. There is no dedicated current desktop layout editor page.

Sources: `src/profiles/profileStore.js`, `presetRender.js`, `launcher.html` profile handlers, `src/menu/quickBuy.js`, `quickBuyImport.js`, `quickBuyPreview.js`, `hotbarLayout.js`, and `proxy.js` command registration. See also `docs/QUICKBUY.md` and `docs/HOTBAR.md`.

### 4.11 AntiCheat, diagnostics and updates

The current AntiCheat screen exposes a master control, **Scaffold** detection, teammate alert inclusion and party broadcasts. Detection uses information available to the client/proxy; a flag is not conclusive proof of cheating. Autoblock/Stasis detector modules and research artifacts exist, but effective configuration forces these checks off; they are not active user features to restore in a redesign.

Console Logs supports service log viewing/search and management. Specialist commands record labeled packet evidence and trace menus. These do not constitute a video capture or replay engine.

Update code checks a trusted manifest, offers a download-page action and presents release notes/What's new. It does not silently install a new application. Availability depends on packaged mode and published metadata.

Sources: `launcher.html` AntiCheat page, `src/bootstrap/config.js`, `proxy.js`, `src/detect/scaffoldDetector.js`, `src/recorder/`, `src/updates/`, `src/launcher/renderer/launcher_updates.js`.

## 5. Application Structure

### Current desktop navigation

There are no web-router URLs for launcher pages. Electron loads `launcher.html`; JavaScript toggles panels using `data-page` and subpage attributes.

The persistent shell has a brand/proxy control area, global search, account menu and custom window controls above a collapsible left rail. The rail exposes:

1. Dashboard — onboarding, connection guidance, selected account, provider configuration links and recent session.
2. Overlay — live/manual player board.
3. Sessions — session cards and daily/weekly/monthly summaries.
4. Nicks — History and Denick Lookup.
5. Nick Reroller — matching preferences; the run starts in-game.
6. Reminders — Ender Dust and Gambler George.
7. Profiles — built-in/custom preference bundles and change review.
8. AntiCheat — active detection and chat/broadcast controls.
9. Settings — searchable categories and detail controls.
10. Console Logs — operational logs.

Settings category keys are `launcher`, `scan`, `gameplay`, `sessions`, `denick`, `overlay`, `display`, `api` and `network`. Displayed labels are refined by mounted modules, including Appearance, Scanning, Automation, Sessions, Nicknames, Overlay & chat, In-game appearance, API keys and Connection settings. In-game appearance has Tab list, nametag and color panes. Settings navigation can collapse the outer rail to make space.

The account manager, manual nickname mapping, profile editing/review and update notices are dialogs or contextual overlays rather than separate routes. Global search reaches pages, settings and actions; local search/filter controls serve larger collections.

### Other product surfaces

- Minecraft local commands, clickable/hoverable rich chat, Tab, nametags, scoreboards and modified server menus form a second interaction surface.
- The current `/fury` command presents a settings guide and command actions, and `/help` browses command categories. These are implemented chat interfaces, distinct from the proposed native `/fury` screen.
- `website/` is a static download/supporting presentation site with platform choices, gallery and release information; it is not the launcher frontend.
- `cloudflare/download-stats/` supports download redirects/aggregate metrics and a protected operational dashboard.
- `cloudflare/party-coordination/` supports party presence/nickname coordination. It is infrastructure, not a conventional user dashboard.

### Target organization for Forge

All player-facing functionality currently split between launcher and game must be reachable in-game. The v2 plan proposes Overlay, Chat, Bedwars, Party, History and Settings, opened through `/fury` and a configurable shortcut. This is a proposal, not an implemented route map. It needs to accommodate Nicks, reroller preferences, reminders, profiles, provider setup, status and advanced diagnostics without burying them.

The owner's compact/intuitive requirement calls for progressive disclosure: a small searchable feature index, obvious enable controls, a distinct settings action per feature, and focused detail screens. Preserve functional coverage rather than copying every desktop panel into a smaller rectangle.

## 6. Key User Journeys

### A. First connection today

1. Open Fury and use the dashboard's Microsoft sign-in action.
2. Complete sign-in in the browser; use the displayed code, reopen-browser or cancel actions if needed.
3. Start the proxy or use the onboarding address-copy action, which can start it.
4. Add the copied local address to Minecraft Multiplayer and join using the matching account.
5. See connected status and start using Fury's in-game features.
6. Add optional provider keys and choose relevant preferences. Missing providers should explain unavailable capabilities without preventing unrelated configuration.

In the native target, this becomes opening the mod's in-game interface while Minecraft owns the connection/login, then configuring available services and features. A second launcher-authentication flow is not an established mod requirement.

### B. Assess a queue and respond

1. Enter a supported lobby/match context through Fury.
2. Let an eligible automatic scan run or request `/scan`.
3. Review stats, genuine tags and nickname uncertainty in chat, the board, Tab or nametags as configured.
4. Inspect an individual player or explicitly share selected scan information.
5. If Auto Dodge schedules a BedWars pregame exit, review its reason/timing and cancel if desired.
6. Continue into the game; no pregame dodge may carry over into active play.

### C. Find and manage a nickname match

1. Receive an automatic supported match or open Nicks → Denick Lookup.
2. Enter observed finals/beds and, where useful, advanced cosmetic criteria.
3. Review evidence and candidates; keep ambiguity visible.
4. Save a known mapping manually or use the relevant supported confirmation flow.
5. Find it later in History, inspect its source/previous nicknames, copy the real IGN or remove a mistaken match.
6. Use Undo when offered for new automatic teammate/shared matches. Online exchange still depends on its relay deployment.

### D. Customize information shown while playing

1. Open Settings → In-game appearance.
2. Select Tab list, nametags or colors.
3. Choose mode-specific fields, order, labels, audiences and fallback values while checking the preview.
4. Save through the existing automatic flow and inspect actual in-game output.
5. Adjust chat/Overlay settings separately when those surfaces need different behavior.

The Forge equivalent should offer the same decisions in focused in-game detail screens, with HUD editing/interaction explicitly separated from normal gameplay input.

### E. Review play and export a card

1. Play supported games with session tracking enabled.
2. Select the account whose records should be shown.
3. Open Sessions, filter by game/date or choose Daily, Weekly or Monthly.
4. Expand a card and choose its game mode/submode.
5. Copy the rendered image or download a PNG; distinguish local/partial information from API-confirmed totals.
6. Start/end the live session only when the selected account matches the connected account; confirm before deleting an ended session.

### F. Change playstyle or game layout

1. Open Profiles and choose a built-in or custom preference bundle.
2. Review its changes and requirements, then apply it.
3. Save a personal variant or import/export one without credentials.
4. For a BedWars shop/hotbar layout, use the appropriate preview/copy/load command in a suitable lobby.
5. Allow server-menu verification to complete or cancel, understanding that completed edits may remain.

### G. Roll a nickname

1. Configure matching rules, word groups, rank and skin in Nick Reroller.
2. Start `/nickroll` in an eligible lobby.
3. Wait for a candidate or stop the run; cooldowns/errors can terminate it.
4. Choose Use Name or Roll Again when a match is found.

The future GUI should make configuration and run controls easy to reach in-game while preserving deliberate candidate acceptance and server constraints.

## 7. Current UI/UX Overview

### Visual language and effective style layers

The current launcher is a dense desktop control workspace. It uses dark neutral surfaces, outlined controls, restrained borders, a configurable accent, outlined SVG icons and a collapsible sidebar. `launcher_redesign.js` is active production code on desktop, despite its name. It rearranges existing DOM/controls and dynamically appends `launcher_redesign.css`; subsequent refinement/onboarding/appearance styles also participate. Reading only the original inline CSS or `launcher_theme.css` gives an incomplete picture.

Representative active rules in `launcher_redesign.css` define a background near `#101316`, panel `#191d21`, inset `#121619`, border `#303840`, primary text `#f1f3f5` and secondary text `#a1aab5`. The Sun accent is `#f3c64e`. Theme code supports Graphite, Midnight, Forest, Light, Obsidian and Frost; accent presets include Iris, Cobalt, Aqua, Mint, Lime, Sun, Ember, Rose and Violet, plus a custom color.

Desktop body typography is approximately 14px/1.45 Segoe UI/sans-serif; headings use roughly 21px and 16px, with 12px secondary text common. Typical controls have 36px minimum height and 7px corners. Source spacing commonly uses 8–24px gaps/padding, with tighter data rows. The active shell defines a 64px topbar and 210px rail, collapsing to 68px. These are descriptive desktop measurements, not requirements for native screens.

Minecraft-facing previews, player statistics and exported session art intentionally use pixel typography and semantic colors. Provider identity, Hypixel rank/prestige, team colors and stat severity are distinct from the selected launcher accent. The current launcher brand mark is `assets/fury-icon.png`, referenced directly by the active renderer; packaged app icons use corresponding PNG/ICO assets. Reuse canonical assets in their intended proportions.

### Reusable interaction patterns

- Searchable navigation and settings; category lists beside a selected detail area.
- Toggle rows, chip/segmented choices, enhanced selects, bounded number controls and ordered stat palettes.
- Expandable session/profile rows, two-pane nickname history and contextual detail dialogs.
- Previews beside configuration, with generation/loading/error feedback.
- Inline dependency/status labels such as Proxy stopped, Waiting for Minecraft and Needs Aurora.
- Automatic saves with pending/saved/failure feedback; explicit apply/review for profiles and confirmation for destructive actions.
- Contextual copy actions and notifications, including masked provider-key controls with reveal/test/copy/save behavior.

Most feature settings can be configured even when the proxy is stopped. Dependencies explain current availability; they do not universally disable preference editing. Connection settings save automatically but may require a proxy restart to take effect.

### Loading, empty, error and success states

Source contains distinct no-account/onboarding, preparing sign-in, waiting-for-browser, connection-failure and retry states. Sessions distinguish no sessions from no filter matches; cards show generation/error states and account-scoped empty copy. Nick history distinguishes absent history and filtered results. Provider-backed features expose missing keys, errors and unavailable data. Logs, toasts/inline statuses, copy confirmations and profile review provide feedback.

Do not interpret a configured provider key as proof that a provider is healthy: the redesigned dashboard service summary uses key presence for its Configured label. Detailed tests/requests have separate outcomes. Likewise, cached reminder knowledge is not necessarily a fresh reading.

### Responsive behavior and mobile support

The current Electron window starts at 1440×900 with a 1024×680 minimum. CSS includes breakpoints for stacking/reducing layouts, collapsible navigation and horizontal scrolling for wide stat data. This is desktop adaptation, not evidence of a mobile application. The public website has its own responsive design.

Forge must instead handle Minecraft GUI scale, scaled coordinates, smaller effective viewports, resize, clipping and matching visual/click hitboxes. Simply scaling down the desktop layout would leave too many controls visible and make text/actions difficult to use.

### Accessibility evidence and limits

Implemented patterns include native buttons/inputs/dialogs, labels and ARIA descriptions, visible focus outlines, live statuses, selected/expanded states, Escape dismissal and keyboard support for tabs, radio groups, custom selects and virtualized nick rows. Some controls include non-drag ordering alternatives. Theme code supports reduced motion. Account dialogs explicitly restore focus in their owning paths.

These patterns do not establish complete screen-reader compatibility, audited contrast, consistent focus restoration in every dialog or full keyboard parity. Native Forge accessibility will need its own verification; DOM semantics cannot simply transfer to Minecraft rendering.

### Source-visible UX tensions and opportunities

1. **Fragmented control locations:** a desktop preference may affect a command-only game workflow. The requested port should place setup and execution close together where safe.
2. **Overlapping terms:** Overlay, scan output, Tab stats, nametags and chat stats are related but independent. Explain their different destinations and share common detail models.
3. **Account ambiguity:** viewed and connected identities can differ. Any session-changing action needs clear ownership/context.
4. **Dense settings:** many toggles, thresholds and exceptions compete for attention. Use a compact default view and reveal advanced details only when requested.
5. **Uneven game-mode coverage:** BedWars-specific tools must not appear universally available in SkyWars/Duels.
6. **Mixed feedback and save semantics:** inline status, notification popups, automatic saving, profile application and restart requirements coexist. Make the relevant outcome obvious at the action.
7. **Legacy markup and naming:** removed/hidden screens and historical aliases remain in source. Inventory active mounted behavior rather than copying every old element.
8. **Potential readability/interaction gaps:** small secondary text, color-heavy stat meaning, icon-only actions and virtualized/canvas content warrant targeted accessibility checks. This is a source-based concern, not a measured usability finding.

## 8. Technical Context

### Current architecture

- **Desktop frontend:** Electron, plain HTML/CSS and DOM JavaScript with CommonJS modules. No React/Vue/router or general component framework. `launcher.html` retains substantial event/state code; mounted modules extend it. `skinview3d` supports Minecraft skin-related presentation.
- **Application owner:** Electron Main in `launcher.js` owns child services, sign-in, settings/account operations, IPC, dialogs and update actions. The renderer requests actions through IPC; it is not the persistence authority.
- **Game path:** separate Node `proxy.js` process using `minecraft-protocol` for Minecraft 1.8.9. Local Minecraft listeners bind to loopback; the upstream uses Microsoft authentication. Feature modules interpret and modify supported packet/chat/menu flows.
- **Services:** Express status/control service and separate cosmetic reverse-search service. Desktop-owned listeners stay local. Optional remote dependencies include Hypixel, Urchin, Aurora, Microsoft/Mojang identity/skin sources and the party relay.
- **State:** per-connection runtime owners, shared configuration helpers, bounded caches, IPC snapshots/events, localStorage appearance preferences and account-scoped stores. No Redux-style store or application database server is used for the core desktop product.

### Data ownership and relationships

The core data model is file-based, not a relational ORM schema:

- Account UUID/name → cached login, selected viewing identity and remembered reminder progress. UUID is authoritative; legacy name matching is constrained.
- Account → sessions → games, events, context, supported mode/submode totals and verification/source metadata. Named clip bookmarks are stored separately and associated with game context/time.
- Real account → nickname mappings/history events with observed nickname, method and timestamps. This knowledge is shared product data rather than a separate login.
- Profile → allowlisted preferences; global settings, keys and selected safety behavior are not arbitrary profile content.
- Quick Buy/hotbar preset → saved layout; friend alias book → display mappings; caches/diagnostic recordings have separate owners.

`src/storage/runtimePaths.js` uses a shared data root for launcher/services: development defaults to the checkout; packaged Windows/macOS defaults to an app-data Fury directory. An absolute `FURY_DATA_DIR` can isolate data. Settings use JSON/text files, with atomic/coalesced writers where implemented. Do not assume every file or datum is account-specific or encrypted.

The separate download-statistics worker has an aggregate SQL table grouped by date, platform, package type, version and test flag. It is not a player-account/session database. Party relay attachments retain current presence rather than a persistent gameplay-history database.

### Relevant API boundaries

- Launcher IPC groups cover state/history detail, service lifecycle, settings, accounts/sign-in, profiles, denick lookup/mappings, tags, reminders, network validation and updates.
- Local status/control HTTP includes `GET /health`, `POST /session/start`, `POST /session/end`, `DELETE /session/:id`, denick add/delete, Overlay player add/lookup/delete/clear, reminder checking and `POST /settings-changed`.
- Cosmetic service exposes health, fields, refresh and GET/POST search under `/api/cosmetics/`; search/refresh apply the configured access guard.
- Cloudflare party coordination uses a WebSocket route; download infrastructure has redirects and protected operational statistics endpoints. These are separate from launcher routes.

Exact request/permission contracts live in `src/health/httpServer.js`, `cosmetic_search_api.js`, `launcher.js` and the respective worker modules. These interfaces are internal/current architecture, not proposed native UI requirements.

### Constraints useful to designers

History transport is compact and revisioned (`src/session/historyResponse.js`); account changes and mutations invalidate stale work. Detail retrieval is tied to the correct revision, and history graphs are not repeatedly copied in full into the renderer. The active desktop card UI need not expose every detail the backend can retain.

Provider pacing, cache reuse, request deduplication, visibility gates and bounded work are product constraints. No network/file work should be added to render callbacks during the mod port. Native rendering can replace proxy-only formatting limitations, but cannot reveal private/unobserved server facts or remove API limitations.

Useful regression references include `tests/launcher/test_command_surface.js` for active/removed surfaces and command contracts, `tests/features/test_anticheat_controls.js` for forced-off checks, `tests/accounts/test_launcher_accounts.js` for account ownership, and `tests/session/test_history_response.js` for compact/revisioned history. These suites were inspected as supporting evidence or located for follow-up; they were not run for this document.

The repository supports Windows and macOS packaging. A tested Forge toolchain, native settings/storage migration and compatibility matrix are not established by this analysis; consult the separate mod project's implementation evidence.

## 9. Design Considerations

### Confirmed owner requirements

1. **Port the complete product to Forge.** Cover the product workflows and settings currently distributed across the proxy and launcher.
2. **Provide every relevant GUI and setting in-game.** Command shortcuts may remain, but the redesign must not depend on opening Electron for product configuration.
3. **Make the interfaces more compact and intuitive.** Reduce simultaneous choices; keep common actions obvious and advanced settings one clear step away. Compactness must preserve readable text and usable targets.

### Product behavior to preserve

- Put live player identity, match context, status and the main action above secondary statistics.
- Keep unknown/private/stale/pending/local data distinct from zero or verified values. A tag, suspected threat or candidate match must retain its source and uncertainty.
- Expose Auto Dodge reasons and cancellation promptly; never schedule a stale pregame action into an active match.
- Keep local output, party output and all-chat broadcasts visibly distinct. Avoid making private review accidentally send a message.
- Separate real/lookup/command identities from nicknames and friend aliases. Preserve original server chat actions and rank/team/stat meaning.
- Preserve account ownership in history/reminders, including when viewing another account's saved information.
- Keep nickname candidate acceptance and profile review deliberate. Preserve Undo/removal protections where present.
- Explain optional providers and server requirements without locking users out of unrelated preferences. Keys need masking and must stay out of normal exports/logs/previews.
- Keep save state, required restart, provider availability and actual feature enablement distinct.
- Preserve retired/forced-off behavior; do not restore features because unused controls/modules are found.

### Recommended native interaction approach

Use a small searchable feature/menu screen with concise labels, current state, a quick toggle where meaningful and a separate detail/settings action. Favor focused screens over a desktop-style wall of cards. Group advanced thresholds, per-audience settings and provider options behind clear disclosure. The v2 plan's category proposal can be evaluated against this inventory rather than copied blindly.

Normal gameplay should remain click-through. Open details/edit mode deliberately, give Escape/back a predictable path, and prevent automatic scans/notifications from stealing focus. If HUD placement is offered, distinguish editing from play, support keyboard adjustments and clamp elements to the scaled viewport. Native HUD editing is planned, not a verified current feature.

Use bounded, scrollable lists and concise row summaries; show detailed player/profile/history information only after selection. Preserve keyboard navigation, visible focus, semantic colors with supplementary labels, and reduced-motion choices. Check low resolutions and several GUI scales instead of assuming a desktop-sized canvas.

Retain Fury's canonical branding and recognizable vocabulary. Native screens may use game-appropriate text/layout, but should feel like Fury rather than an unrelated dashboard theme. Do not force the website's promotional styling or concept art onto every product surface.

Design access paths for provider configuration, profiles, reminders, nickname history/lookup, reroller, layout tools and diagnostics as well as the obvious combat/gameplay modules. Clarify the replacement for desktop-only service/login/network controls during migration. Proposed grouping, keybindings and native popup behavior require validation; they are not current functionality.

## 10. Feature and Screen Inventory

Route notation: `page:` and `settings:` identify DOM panels, not URLs. Commands describe the current in-game entry point. “Forge planned” follows the owner's requirement; it does not imply a native implementation exists in this checkout.

| Screen / Feature | Purpose | Main User Actions | Related Route | Implementation Status |
| --- | --- | --- | --- | --- |
| Desktop shell/search | Reach features and manage runtime | Search, navigate, collapse rail, start/stop proxy | `launcher.html`; global shell | Implemented desktop; native shell planned |
| In-game Fury guide/help | Discover existing commands and settings actions | Browse categories, suggest/run supported actions | `/fury`, `/help` | Implemented rich chat; a native feature screen is planned |
| Dashboard/onboarding | Sign in and connect through Fury | Browser sign-in, copy code/address, retry/cancel, view status | `page:dashboard` | Implemented; connection/login flow needs native translation |
| Account menu/manager | Choose viewing identity and saved login | Add/select/refresh/remove account | Account dialog; `account:*` IPC | Implemented; not a live account switcher |
| Overlay board | Compare live and added players | Search/add/remove/clear, change columns/view | `page:overlay`; `/ol` | Implemented desktop board; in-game GUI planned |
| Player stat cards | Inspect supported player/mode data | Lookup, follow mode/detail actions | `/stats`, `/sw`, `/duels`, `/general`, `/info`, `/ping` | Implemented in-game chat; native player screen proposed |
| Scan output | Classify current players | Scan; choose all/threats/off | `/scan`, `/overlay`; `settings:scan` | Implemented with mode/context gates |
| Share results | Send selected scan information | Select categories/destination, send, toggle automatic sharing | `/share`; `settings:scan` | Implemented; private/public distinction required |
| Sessions | Review and export recorded play | Filter, expand, choose mode/submode, copy/download, start/end/delete | `page:sessions`; `/session` | Implemented; current desktop presentation is card-based |
| Daily/weekly/monthly history | Review local period totals | Choose period/mode, expand card, inspect contributing sessions, export | Sessions period tabs | Implemented; local timezone and partial-data handling |
| Post-game recap | Summarize a finished game | Enable/configure; re-show latest | `/recap`; `settings:sessions` | Implemented, optional |
| Replay details/bookmarks | Add locally known information to recent games | Open recent games, mark a named moment | `/replay`, `/clip` | Implemented annotations/bookmarks; no video engine |
| Nick history | Review saved real-name/nick relationships | Filter/select/copy/remove, add mapping | `page:denicks/history`; `/denick` | Implemented |
| Denick Lookup | Search account candidates from evidence | Enter finals/beds, add cosmetic filters, run/clear lookup | `page:denicks/lookup`; `/denick` | Implemented; provider/data dependent |
| Automatic teammate nick saving | Retain a sufficiently constrained party match | Review notice, Undo | In-game; `src/denick/teammateAutoSave.js` | Implemented unpublished source; live verification not established here |
| Own nick and Fury party exchange | Track self and exchange current observed nickname | `/denick self`, sharing on/off, Undo received match | `/denick sharenick`; `settings:denick` | Source implemented; updated relay deployment prerequisite |
| Nick Reroller | Find an acceptable nickname | Edit filters/words/rank/skin; start/stop; accept/reroll | `page:nickroll`; `/nickroll` | Implemented; launcher config plus game run; server permissions apply |
| Reminders | Track Slumber and Gambler George progress | Check, configure threshold/preferences, change viewed account | `page:reminders`; `/reminder` | Implemented; account-scoped cached/live readings |
| Profiles | Reuse playstyle preferences | Review/apply/save/duplicate/edit/delete/import/export | `page:profiles`; `/profile` and aliases | Implemented; allowlisted settings only |
| AntiCheat | Configure supported local detection/alerts | Toggle master/Scaffold/team alerts/party broadcasts | `page:anticheat`; `/anticheat` | Scaffold active; Autoblock/Stasis forced off |
| Appearance | Configure launcher theme/accent/motion/navigation | Choose theme/accent, motion, sidebar | `settings:launcher` | Implemented desktop; native equivalent planned |
| Scanning/settings | Tune classifications and sharing | Change scan mode, thresholds and inclusion | `settings:scan` | Implemented |
| Automation | Configure pregame/game assistance | Set Auto Dodge conditions/timing; Quick Maths; party warnings | `settings:gameplay`; `/dodge`, `/cancel`, `/partycheck` | Implemented with context/safety gates |
| Party overview/coordination | Inspect party and identify possible separation | `/po`, inspect warnings, dismiss/toggle | `/po`, `/partyy`, `/partycheck` | Implemented local/relay paths; deployment/live state not verified |
| Session settings | Control tracking, recaps and card fields | Toggle, select fields/style, inspect preview | `settings:sessions` | Implemented |
| Nickname settings | Select matching and display destinations | Change methods/announcements/sharing | `settings:denick` | Implemented; online sharing prerequisite above |
| Overlay & chat settings | Control sources and chat information | Edit triggers, mentions/DM behavior, queue reporting | `settings:overlay`; `/chatstats`, `/chattrigger`, `/lf` | Implemented |
| Tab list | Configure visible in-game stats/timers | Select mode, reorder/add fields, preview | `settings:display/Tab`; `/tabstats` | Implemented proxy presentation; native rendering planned |
| Nametags and identity | Configure labels above players | Choose audiences/stats/fallbacks, real name/skin behavior | `settings:display/Nametags`; `/nametags` | Implemented; native layout planned |
| Chat/scoreboard colors | Adjust Fury-owned game presentation | Toggle relevant labels/team presentation, preview | `settings:display/Colors` | Implemented with semantic-color constraints |
| Friend aliases | Add personal display names | Manage mappings and display destinations | `/friendalias`; nickname/display settings | Implemented command/display path |
| API keys and reminders | Configure optional providers | Paste/reveal/test/copy/save; Hypixel reminder/snooze | `settings:api`; `/apikey`, `/apikill` | Implemented; some copy behavior is unpublished source |
| Community tags | Read and mutate external player tags | Lookup/add/remove with type/reason/privacy options | `/urchin`, `/tag`, `/addtag`, `/removetag`; `tags:*` IPC | Implemented; mutation requires external admin credential |
| Connection settings | Manage current proxy routes | Validate/edit/reset/copy settings, restart proxy | `settings:network` | Implemented desktop architecture; native relevance to decide |
| Quick Buy/hotbar layouts | Reuse BedWars shop arrangement | Preview/copy/save/load/cancel, combined layout operations | `/quickbuy`, `/hotbar`, `/quickbuyandhotbar` | Implemented game commands; native editor proposal |
| Console/diagnostics | Investigate runtime issues | Switch/search/clear logs; record labeled evidence | `page:console`; `/rc` and specialist commands | Implemented; packet evidence is not video |
| Updates/What's new | Explain releases and offer downloads | Inspect/dismiss/reopen notes, open trusted download page | `src/updates/`; update UI | Source implemented; depends on packaged/public release state |
| Download website | Obtain correct desktop package | Choose platform/processor, download, view gallery/notes | `website/index.html` | Implemented static site; online state not checked |
| Native Forge feature menu | Central compact in-game access | Search/navigate/toggle, open feature settings | Proposed `/fury` and configurable shortcut | Planned in migration documents; owner-confirmed direction |
| Native HUD editor/detail screens | Configure placement and advanced behavior in-game | Move/scale/reset, configure focused details | Migration plan steps 3–4 and feature steps | Planned; not verified native functionality |

## 11. Assumptions and Unknowns

### Established versus inferred

- **Confirmed by the owner:** the full proxy product is being ported to Forge; all relevant GUIs/settings must be in-game; the interfaces should be more compact and intuitive.
- **Established by current source:** Minecraft 1.8.9 proxy/Electron architecture, implemented desktop/game surfaces and the behavior boundaries described above.
- **Inferred audience:** competitive/stat-aware Hypixel players and party users. No user research, usage distribution or validated personas were available.
- **Planned in documents:** native Forge screens, HUD editor, player popups, native state/rendering adapters and proposed category/keybind structure. Their existence in plans/concepts is not implementation evidence.

### Open questions for the port/design work

1. Where is the active Forge project and migration ledger, and which features are actually complete there? This checkout does not establish its progress.
2. Is Minecraft 1.8.9 the final mod target, and which Forge/JDK/Gradle versions and client combinations are supported? The playbook proposes 1.8.9 but toolchain verification was outside this task.
3. Will there be a transitional companion mode, or only a standalone mod? This affects which service/connection controls remain visible.
4. Which navigation proposal has the owner approved beyond compact/intuitive in-game access? The v2 sidebar/keybinding remain proposals.
5. Which exact GUI sizes, scales, fonts and HUD defaults should be supported? No rendered native measurements or usability tests were performed.
6. What are the actual most-used features and acceptable default density? The repository provides capability evidence, not behavioral analytics for players.
7. Which source changes have shipped? The working tree contains extensive edits/new files; a version string is insufficient to determine release availability.
8. Has the updated nickname-sharing relay been deployed elsewhere? The draft explicitly flags deployment as outstanding; this analysis did not check the live service.
9. What is each provider's current availability, access policy and returned data coverage? No live APIs were queried; UI must handle missing/private/rate-limited data.
10. What migration/import behavior is needed for desktop history, nickname mappings, profiles and layouts? Existing file ownership is known, but a completed Java migration is not demonstrated.
11. Which specialist commands need a visible GUI, and which should remain in an advanced diagnostics area? Complete in-game access should not make research tools prominent by default.
12. Which accessibility guarantees can native Forge provide, including keyboard-only use and assistive technology? Existing browser accessibility is not proof of native parity.
13. Are there additional business, distribution, support or server-policy requirements? None should be invented from feature names or competitive terminology.

No existing application source or release-note draft was changed for this analysis. This overview is documentation, not a completed player-facing feature or release announcement.

## 12. AI Design Brief

Design Fury as a compact, intuitive in-game companion for Hypixel players. The owner is porting the entire existing Minecraft proxy and Electron product into a Forge mod. Every product GUI and setting must be accessible inside Minecraft. Your job is to translate a broad, established feature set into a coherent native experience, preserving what players can do while reducing the amount they must process at once. The reference implementation targets Minecraft Java 1.8.9; native mod implementation progress and final toolchain must be confirmed separately.

Fury helps players assess opponents and teammates, recognize nicknamed accounts when evidence supports a match, keep useful stats visible, avoid selected risky pregame queues and review their own play. Its likely audience includes competitive and stat-aware BedWars players, SkyWars and Duels players, party users and people who want configurable game information. These are code-supported use cases, not validated demographic personas. BedWars has the deepest coverage; do not imply every feature works in every mode.

The main capabilities are player stat lookups, context-aware scans, a team/list player board, community tags, nickname detection and saved history, nickname rolling, configurable Tab stats and nametags, chat information, party checks and sharing, pregame Auto Dodge, account-specific session history, calendar summaries, exportable stat cards, post-game recaps, reminders, playstyle profiles and BedWars Quick Buy/hotbar tools. Specialist diagnostics exist but should be secondary. Scaffold detection is active; other detector modules found in source are forced off and must not be revived simply because files exist.

The current desktop navigation contains Dashboard, Overlay, Sessions, Nicks, Nick Reroller, Reminders, Profiles, AntiCheat, Settings and Console Logs. Settings separates appearance, scanning, automation, sessions, nicknames, Overlay/chat, in-game appearance, providers and connections. The Forge plan proposes a smaller feature-oriented sidebar, but that proposal is not an implemented or final navigation contract. Build an inventory-complete information architecture: players must still find nickname history, provider setup, reminders, profiles and advanced options. Avoid copying ten desktop panels into a tiny game window.

Prefer a small searchable feature index with concise module rows, obvious state, quick enable controls and a separate action for detailed settings. Show the few decisions needed for the current task; reveal thresholds, audience rules, field ordering and provider options in focused detail screens. Keep primary actions readable and easy to hit. Compactness means less simultaneous information, not smaller text everywhere. Support Minecraft GUI scaling, smaller effective resolutions, clipping, scrolling, keyboard focus and predictable Escape/back navigation. Ordinary gameplay remains click-through; only deliberate GUI/edit interaction should capture input. Automatic lookups must not interrupt play by opening screens.

Fury's current design uses dark neutral surfaces, modest corners, thin borders, outlined icons and a restrained configurable accent, commonly gold. It also offers alternate dark/light themes. Minecraft-facing text intentionally retains rank, prestige, team and stat colors and pixel-oriented presentation. Reuse the canonical Fury logo without recreating or distorting it. Preserve familiar names and intentional differences between general settings and game information.

Trust and context are essential. Distinguish unavailable, private, pending, stale and locally observed data from verified values or zero. Preserve provider provenance and uncertain nickname candidates. Keep real command identity separate from nicknames/aliases. Separate local notices from party/all-chat broadcasts. Auto Dodge applies only before a BedWars match starts and needs a visible reason and immediate cancellation. Nickname rolling requires deliberate acceptance. Layout changes depend on server confirmation and may remain partly applied after cancellation. Online party nickname exchange has source support but a documented relay deployment prerequisite.

Prioritize fast access, understandable feature grouping, safe actions, clear saving/error feedback and low distraction. Account history remains isolated, while the current launcher’s viewed account can differ from the live connected player. Translate that distinction carefully to native Minecraft ownership. Replace obsolete desktop connection mechanics where appropriate; do not invent another login system. Native rendering allows better layouts, but does not provide hidden server facts, unlimited API access or permission to change product rules. The result should feel like Fury made natural inside Minecraft.
