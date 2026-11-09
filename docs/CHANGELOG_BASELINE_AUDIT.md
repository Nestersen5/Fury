# Unreleased changelog audit against Fury 1.1.4

Audited on 2026-11-09. A release note describes the net change from the published
application to the next application. Fixing a regression introduced during the
same development cycle does not establish a bug in the published application.
Earlier Development notes remain historical implementation records, not proof
that a change is new relative to the latest release.

## Verified baseline

- The live `https://furyproxy.online/latest.json` returned version **1.1.4**, released
  at `2026-11-03T12:59:06Z`.
- The live release checksum file matched the local final Windows portable ZIP:
  `b99bbd29ee857473a8c068e0b55aa9883934e76333254d370f3508be890e30de`.
- The published source commit is `db5a567c6bb755a2d38305e5f24d820b1e9dcbb7`;
  the canonical runtime fingerprint is
  `3f4bbe3818759205206f5f2b427cff894479864f19a57bbd03221e2a4932d0e3`.
- All **269 runtime files** in both `tmp/fury-release-1.1.4-source/` and
  `output/release-1.1.4/windows-committed/win-unpacked/resources/app/` matched
  `output/release-1.1.4/RUNTIME-SOURCES.json`. The final source freeze,
  container verification and publication verification agree on that fingerprint.
- The repository's main Git HEAD and `website/latest.json` are older and were
  **not** used as the published baseline. The invalidated CRLF Windows build
  under `output/release-1.1.4/windows/` was also excluded.

The published directories were read only. Application code, user profiles and
published release notes were not changed by this audit.

## Removed or narrowed claims

| Original claim | Finding and disposition |
| --- | --- |
| Reminder previews match Minecraft chat | **Same-cycle correction.** Published 1.1.4 did not mount the new Design A reminder previews. The new preview owner is `launcher_design_a_pages.js`, mounted by the newly added Design A layer in `launcher.html`. Keep the correction in Development notes, not Bug fixes. |
| Preview BedWars event colors live | **Already shipped.** Published `launcher_redesign.js` mounts `launcher_ingame_appearance.js`; its existing Names & colors view creates a live chat preview, reacts to the toggle and listens for `fury:accent-change`. The new work moves/restores that surface and adjusts the arrow coloring. Remove the separate improvement. |
| Deleting a session now asks for confirmation | **Already shipped.** Published `launcher_redesign.js` requires a second click on `Delete session?` within four seconds. The next design uses a dialog, but confirmation itself is not new. Remove the separate improvement; the new dialog belongs to the Sessions redesign. |
| Share your nickname with Fury party members | **Already shipped app support; service activated separately.** 1.1.4 includes the sharing module and switch. The relay deployment on 2026-11-07 enabled it without another app release. Remove it from the next app's New features; retain the deployment history and live-verification limit. It can be announced separately as an online-service activation. |
| Restore nicked teammates sooner after rejoining | **Same-cycle migration correction.** The pending UUID queue and its priority problem were introduced by the new identity migration, absent in 1.1.4. Remove this clause from the saved-denick bullet. The distinct rename/ownership fix remains valid. |
| Weekly/monthly cards now show full game totals across midnight | **No separate published-baseline defect established.** Published calendar aggregation already uses whole-period session totals when the session fits the period, and the old card uses `mode.games` for its calendar total. The new card's partial-day annotation belongs to the card redesign; session-total corrections are covered by their verified entries. Remove this separate bug claim. |
| Unfinished Windows updates show a retry message | **New recovery feedback.** 1.1.4 has no durable install-attempt check. Add this benefit to the Windows-update improvement instead of presenting the newly added warning as a repaired old warning. The reported historical two-attempt incident was not reproduced and is not claimed fixed. |

## Audit of retained New features

| Original entry | Published-to-current evidence |
| --- | --- |
| New/Updated settings tags | New `releaseDestinations.js` and settings-discovery/read-marker paths in `releaseExperience.js`, with renderer discovery controls; these are absent in 1.1.4. Retain. |
| Add Fury servers to Minecraft | New `minecraftSetup.js`, `minecraftClientDetection.js` and owning IPC path; 1.1.4 provides address copying and manual setup. Retain. |
| `/wdr <team>` with pauses | 1.1.4 advertises and implements one-player reporting. Current team selection and movement/inventory waiting extend it. Retain as a feature, without claiming the unreleased report refinements were separate published bugs. Live team reliability remains a release prerequisite. |
| Sessions keyboard navigation, full size and hiding the list | Published Sessions uses independent expandable rows. Current `launcher_redesign.js` adds list/detail navigation, `handleSessionKeys`, list hiding and full-size viewing. Retain. |

## Audit of retained Improvements

| Original entry | Published-to-current evidence |
| --- | --- |
| Faster/smaller Windows updates | Published Windows payload is loose files and the adapter disables differential downloads. Current Windows ASAR packaging, differential provider and recovery record are new. Retain; see `WINDOWS_UPDATE_PERFORMANCE.md` for measured scope. Existing clients download their first compact release in full; later compatible releases can use smaller downloads. |
| Version browser, larger What's new text, Dashboard highlights and settings links | Current release browser/discovery renderer and Main read markers extend the published flat notes experience. Retain. |
| Compact sortable Nicks table and match details | Current `launcher_redesign_nicks.js` replaces the published card layout with the table and detail dialog. Retain. |
| Launcher navigation/settings redesign and Dashboard Start/Stop | Current mounted Design A layer reorganizes the published launcher and adds Dashboard actions. Existing Start/Stop capability itself is not new. Retain as a redesign. |
| Recorded session/mode counts and late Hypixel updates | Published-source regression cases fail for incomplete observations, combined late corrections and mode totals; current cases pass. Retain the final reliability outcome, without announcing each intermediate correction. |
| Bed Wars recap colors | Actual `recapScoreboard.js` changes from published label/stat colors to the approved gold/green palette. Retain as presentation. |
| Session card redesign and matching copied/saved images | Published card and current `launcher_session_card.js` differ in layout, headline values and mode chart. Retain as presentation. |
| Minecraft item icons in the session list | Published list uses the old session presentation; current list selects the new per-game item assets. Retain. Asset distribution review remains in the existing Development notes. |
| Simpler Connection rows and Dashboard address copying | Current connection composer changes the published multi-card form to rows with inline status. Dashboard copying already existed and is retained as guidance, not claimed as a new copy feature. Retain the combined layout improvement. |
| Scanning/Auto Dodge sliders | Published page uses the previous range implementation. Current `launcher_range_slider.js` adds the curve, pointer interaction and Shift precision to the existing saved values. Retain. |

## Audit of retained Bug fixes

| Original entry | Published-baseline defect and current evidence |
| --- | --- |
| Players/Share preview follows settings | **Reproduced.** Published `renderPartySharePreview()` hardcodes two individual examples and does not apply the include filters to them. With all three filters off, the published function still renders two rows; current renders zero. Published examples also differ from the production formatter. This predates Design A, unlike reminder previews. |
| Shared threats show the triggering stat | **Reproduced.** For a stars-only threat, 1.1.4 formats `[RED] [1200✫] StarOnly: FKDR: 1.20`; current omits the unrelated FKDR. Current Share and scan regression scripts fail against published source and pass against current source. The current combined-threshold case prefers FKDR. |
| Scaffold alerts use a known real IGN | **Reproduced.** The same alert test reads the published `announceAnticheatFlag()` and gets `[AC] NickName » Scaffold` despite a saved match. Current returns `[AC] SavedIGN » Scaffold`. |
| Saved denicks retain the correct account after a rename | **Reproduced.** With saved account A and its old name reassigned to B, the published stats path ignores `realUuid`, resolves the old name and returns B. Current requests A directly and returns A. The current identity suite also covers persistence, caches and name refresh. Retain only this part of the original compound bullet. |
| Saved opponent party broadcasts at game start, with available stats | **Source difference verified; current tests passed.** Published saved announcements are a name-only pregame path; `seedGameRoster()` does not announce silent saved opponents. Current adds the game-start path and shares the production stats formatter. Existing current announcement tests pass. This is an extension/fix to existing Party Broadcast, not a claim that the whole feature is new. |
| Detected game modes no longer appear as Unspecified | **Reproduced in supported old paths.** Published source fails the API-enabled save/reload mode case and API-off late-mode evidence cases; current passes. Some simple old mode cases already pass and are not claimed new. |
| Missed counts after reconnects, requeues, slow starts or late messages | **Reproduced.** Published source fails same-match disconnect/leave retention, late-joined quick requeue, initial-lookup disconnect and late identity-credit cases. Current passes. Merge the saved-detail/late-kill outcome into this entry rather than listing each development-stage correction. |
| Missing or incorrect wins | **Reproduced.** Published source fails the API-off late-join victory case and correction of a weak `GAME OVER!` result by an isolated API win. Current passes. Merge the distinct manual-confirmation edge cases below into this result entry. |
| Game total/win rate after older details are cleared | **Reproduced.** Published source fails `overview uses full game totals after old match details are pruned`; current passes. The old launcher uses retained `games.length` for those overview totals. |
| Daily stats across midnight | **Reproduced.** Published calendar aggregation drops located counts when an undated remainder exists. The current calendar test fails against 1.1.4 at the mixed daily-count assertion, and the cross-midnight reliability case also fails. Current passes both. This is distinct from the unproven separate weekly/monthly-card claim. |
| Manual BedWars result counts once | **Reproduced for specific edge cases.** The basic manual-mode update already passes on 1.1.4. However, the same late-join, conflicting-title and provisional-result replacement tests fail against 1.1.4, as do manual-result detail-count cases; current passes. Merge under missing/incorrect wins, not a claim that basic manual confirmation was newly fixed. |
| Saved game details retain late kills | **Partial direct reproduction plus source evidence.** The published game-detail projection fails the existing pending/combined-sample selection tests. Current passes those and trailing-combat tests. The latter call a new method absent from 1.1.4, so their old-method errors are not counted as standalone reproductions. The new proxy/trailing-stat path is source-verified; merge its outcome with retained counts. |
| API requests on/off preserve session counting | **Reproduced.** Published source starts another session in both toggle directions in the same fixture; current preserves one session and its three kills. Retain. |
| Draws count as games, without a win/loss | **Reproduced.** Published source fails both API-on/off draw fixtures. Its result parser does not recognize a draw title; current counts the game and stores `draw`. Retain. |

## Verification and limits

- Ran the current 105-case session counting suite against current source: all passed.
- Ran those cases individually against the verified published source to prevent
  one intentionally unresolved async fixture from cancelling later cases.
  Assertion failures listed above are real behavior differences. Tests requiring
  new internal methods, new saved fields or an async completion absent in the old
  implementation are not, by themselves, proof of published player bugs.
- Existing safeguards that also pass on the published baseline include short
  Duels counting, independent delayed captures, preserving a completed capture
  on finish/reset/quiesce, waiting for observed kills before accepting API stats,
  account rejection and the simple manual-result mode update. Do not announce
  these again merely because current development re-tested them.
- Current calendar, Share formatter and scan-threat scripts passed; each also
  produced an assertion failure on published source relevant to its retained entry.
- Current alert, party-announcement, denick-identity and Windows-updater checks
  passed (30 test-runner entries, including script-level entries).
- Read-only/mocked probes exercised the actual published/current preview and
  stats-fetch functions. Saved identities and external responses were synthetic;
  no real API requests, report commands, updates or profile migrations ran.
- Detailed local output is under `output/changelog-baseline-audit/`, including
  `probes.json`, `published-counting-isolated.json` and current TAP reports.
- This was a changelog/source audit, not fresh native visual, macOS or live
  Hypixel acceptance. Existing live-verification/deployment prerequisites remain.
  No version was chosen, built or published.
