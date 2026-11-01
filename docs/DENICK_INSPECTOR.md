# Denick Inspector

A separate local desktop app for understanding and experimenting with Fury's stats-denick lookup.

Double-click **Launch Denick Inspector.cmd** in the project folder, or run:

```powershell
npm run denick:inspect
```

The tool uses this project's existing Electron and Node dependencies. It does not start the proxy or change its settings, accounts, nickname history or running session. It reads the existing `statmod_key.txt` without rewriting it; use **Choose Fury data folder** if your keys are in another Fury data folder. Keys stay in Electron Main and are never sent to the UI or exported reports.

For in-game `/denick test`, run `/denick test clear` before checking a different player. It clears both entered counts and discards pending test results, so your next test starts with only the stats you enter. `/denick test reset` remains an alias.

Run **`/denick test messages`** in Minecraft to showcase the current chat messages without API requests. It displays example groups of one, two and three possible matches, confirmed and unavailable-stats results with interactive tags, the both-stats failure notice and API errors. It preserves entered test counts and pending searches and saves or shares nothing. Real and simulated lookups share one possible-matches heading and compact rows without finals/beds comparisons; search-start, too-many-matches and single-stat no-match notices are hidden in both real searches and the showcase. The inspector keeps the detailed comparisons for analysis.

## Basic workflow

1. Enter a player name and click **Load Hypixel counts**, or enter finals, beds, or both directly. Loading a name uses one Minecraft name lookup and one Hypixel request unless cached.
2. Click **Fetch Aurora lists**. This sends one Aurora request per entered stat, requests up to 50 players using Aurora's `max=50` parameter, and sends no Hypixel requests. The app shows every returned player, including those the proxy excludes before checking stats. The expandable responses include API list positions, stored counts and update dates where provided. **Aurora candidates per stat** changes this count from 1 to 50 for experiments; changing it requires a new fetch and uses a separate cache entry. The 800 search range is measured in finals or beds, rather than players; matching uses the tighter allowances below.
3. Select individual candidates, or use **Select first unchecked proxy candidates**, then click **Verify selected with Hypixel**. The default budget is five fresh profiles. The UI reports Minecraft, Aurora and Hypixel requests separately; one fresh profile normally needs two HTTP calls. There are no automatic retries, Urchin requests or ping requests. A provider failure stops the batch. **Stop** cancels the active action.
4. Change tolerances and click **Re-analyze cached data**. This costs no requests. Current proxy rules consider players present in either stat list, use a discovery range of 800, up to 50 Aurora candidates per stat, a verification limit of 25 profiles per search, finals from 100 below to four above, and beds from 100 below up to the entered count, with nothing above. Single-stat searches widen the lower allowance to 200 only when the primary range yields at most two verified matches; three primary matches prevent widening. Combined searches retain their primary allowances. Each stat's upper/lower tolerance and the single-stat fallback are adjustable independently; a fallback of zero disables widening. **Both lists (overlap only)** compares the previous selection rule. Changes from current defaults are labeled experiments and do not affect the live proxy.
5. **Export report** saves lists, decisions, cached stats, settings, request counts and the exact production lookup trace as JSON.

Aurora responses are cached for one minute; verified player profiles for five minutes. **Use fresh API responses** bypasses the relevant cache for an explicit fetch/verification. Each cached profile's fetch time remains visible. Changing the saved keys clears the inspector's caches. Editing inputs alone never sends a request.

## Reading decisions

The **Decision and reason** column explains whether the player was excluded by an experimental overlap-only selection, skipped by the verification limit, accepted/rejected by stats checks, or not reached because an earlier required profile has not been verified. It also states whether a successful lookup would show that player in chat. In the default either-list mode, a player missing from one stat list remains eligible and must pass both entered stats during verification.

Verification priority is separate from Aurora's original list position. Candidates with both stored stats inside the current matching limits go first, ordered by the sum of their absolute finals and beds differences. Candidates with just one known stat in range follow, ordered by that known difference. Older stored totals outside the primary range go later, and missing counts stay unknown. Equal priorities preserve discovery order. The table and trace show this priority and verification position. Only the first 25 ranked profiles are checked per search; a correct player ranked below that budget can still be missed. Appearing 50th in an API list does not prevent a player with strong matching evidence from ranking first.

For one stat, the outcome shows the primary match count and whether the lower allowance widened. Expanded comparisons reuse profiles already checked, with no additional requests. At most three matches in the selected range can be suggested; four or more mean waiting for the other stat without suggesting names. Finding four primary matches stops further profile checks. Limited provider coverage and verification limits remain visible; these counts describe the checked candidates, not every possible player. Manual `/denick` keeps its separate 200-count lower allowance.

With both detected stats, the absolute beds difference must be at most the absolute finals difference plus **25%** by default. A 50-finals difference permits up to 62.5 beds difference: 62 passes, 63 fails. Exact finals require exact beds. **Beds gap allowance (%)** changes that percentage for experiments; 0 means the beds gap cannot exceed the finals gap. Existing per-stat upper/lower limits still apply. When both stored Aurora counts are available, failing candidates are excluded before a profile request, with a reason in the table and trace. Missing Aurora counts remain unknown and do not cause this exclusion. Hypixel-verified totals must also pass the same rule; changing this setting replays cached data without requests.

**Compare Aurora counts with** selects either your entered counts or any returned candidate. The **Aurora Δ finals / beds** column shows each row minus that reference, with explicit positive, negative and zero differences. A missing stat on either side stays unknown (`—`). Hypixel differences remain relative to your entered counts. These comparisons send no requests and are included in exported reports.

The lookup and its stat evaluator come from `src/denick/commands.js`. Inspection traces are optional; they cannot change production lookup results. Live data is fetched using a separate, paced Hypixel API client and the configured key. The tool has its own caches and request totals rather than accessing the running launcher's process/cache. Its profile fetches omit auxiliary tag/ping requests and do not automatically retry. This app inspects the stats lookup stage, not nick detection, teammate eligibility, live chat tracking or game/session guards.

**Important:** A successful lookup is finished after its configured checks. Aurora list length and players beyond the verification limit do not mark it incomplete or block confirmation of one checked player matching both stats. Uniqueness applies to the checked profiles; unreturned players and unchecked profiles remain unknown. Errors and cancelled or unfinished requests still cannot confirm. The overlap-only experiment changes candidate selection rather than this completion rule. Changing counts/search range while replaying old discovery lists marks them stale; fetch again to get lists for the new query. A missing second list remains unknown rather than becoming a complete empty result.

## Verification

For repeatable examples without API requests, run `npm run denick:examples`. The [scenario report](DENICK_TEST_EXAMPLES.md) includes concrete player stats, inputs, decisions and actual chat from the automatic and `/denick test` paths. Use `node scripts/denick_examples.js --list` to list IDs, or pass one ID to print that example. These fixtures supply fake API replies only inside the offline runner; entering the shown commands normally in Minecraft still uses live APIs.

```powershell
npm run test:denick-inspector
npm run test:denicks
node scripts/verify_denick_inspector.js
```

The UI verification uses an explicitly labeled offline fixture. No external requests or saved user files are used by that fixture.
