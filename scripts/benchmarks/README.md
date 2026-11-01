**Performance validation — analysis only**

`performance_validation.js` runs existing production functions and isolated,
benchmark-only experiments. It does not rewrite production modules, start the
proxy/Electron UI, make real network requests, or write live application data.
The experimental modules are evaluated in memory. Do not import this harness
from application code or treat its experiments as production implementations.

Run from the repository root:

```powershell
node --expose-gc scripts/benchmarks/performance_validation.js --output=output/performance-validation/results.json
```

Use the installed Electron's Node runtime, without launching the application UI:

```powershell
node -e "const {spawnSync}=require('node:child_process'); const r=spawnSync(require('electron'),['--expose-gc','scripts/benchmarks/performance_validation.js','--output=output/performance-validation/electron-results.json'],{stdio:'inherit',windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}}); process.exit(r.status ?? 1)"
```

Optional arguments:

- `--section=history|launcher|recorder|conditional|tests` selects one section.
- `--fixture=C:/absolute/path/sessions.json` selects an existing session file.
  Paths with spaces need shell quoting. The default is root `session_data.json`.
- `--output=...` saves aggregate JSON results. No player identities, raw session
  records, tokens, or credentials are included in reports.
- `--section=history --baseline-dir=C:/absolute/path/before` compares saved
  pre-change `gameEvents.js` and `launcherSessionHistory.js` against the current
  production implementation, using the same workload, timing and semantic checks.
  Save those two source files before editing; do not use Git HEAD if the working
  tree already contains changes. In this mode `projection.experimental` is the
  current production result, and `baselineSourceHashes` identifies the saved code.
  The baseline files are evaluated in memory, with dependencies resolved from
  this checkout; the production require cache is not replaced.

Fixture-dependent sections use one temporary private snapshot, then remove it.
The source fixture remains read-only. Its hash and aggregate sizes identify the
dataset. The running application may change the source file between runs; do
not compare results with different hashes without acknowledging that difference.
Recorder and conditional sections use synthetic data. Tests use their existing
temporary storage and fakes.

**Benchmark plan and interpretation**

| Finding | Baseline execution | Isolated experiment | Behavior gate |
|---|---|---|---|
| History projection | `buildLauncherSessionHistory`, largest account, complete response | Request-local reuse of repeated event deduplication results | Complete serialized JSON equality; no extra validation skipped; clock/callback fallback |
| Launcher account catalog | Actual extracted `getLauncherAccounts` and `readJsonFile`, fake auth/reminder collaborators | Read contents every time; reuse private session identities only when contents match | Fresh auth/reminder state, malformed/unreadable files, same-length changes, fresh output objects |
| Recorder buffering | Existing recorder at 1,000 synthetic packets/sec; full 5/60/300-second windows | Head index, clearing evicted references, amortized array compaction | Identical JSONL bytes and return values, including idle clipping, exact cutoff and event caps |
| Cosmetic refresh duplication | Eight concurrent cold searches against fake upstream and disk | None approved | Snapshot/failure sharing and forced-refresh contracts must be settled |
| Downstream queue exposure | Stalled fake worker and real Writable with stalled sink | None approved | Normal-load backlog must be measured; no event loss, added upstream pausing, or changed persistence allowed |

History and launcher comparisons have seven warm samples per variant and
alternate execution order. Recorder comparisons have five samples per variant;
each fills its window before timing the next 5,000 packets. Optional forced GC
is outside measured regions. Recorder long-run testing adds 650,000 packets to
the five-minute experimental buffer, covering two compaction cycles, with no GC
between measured chunks. Setup, network, IPC and rendering are not included.

Absolute times depend on V8, GC, system load, and dataset. Back-to-back recorder
replay is CPU cost, not a measured live-game pause or real packet arrival rate.
Short recorder samples do not include every compaction/GC spike; consult the
long-run chunk maximum as well as medians. No overall application speedup is
claimed. The machine was not isolated from other running applications.

**Semantic checks and remaining limits**

- History: 125 comparisons cover actual saved history, limits/account scope,
  malformed timestamps, duplicate events, truncation, the 512-event cap,
  verification changes, local/API behavior through existing tests, advancing
  clocks, and a mutating encounter callback. The experiment bypasses caching
  for callbacks and clock-sensitive inputs. Cache lifetime is one synchronous
  history build; no cross-poll invalidation is introduced.
- Normalization is not generally idempotent: truncation can leave a trailing
  space that the next pass removes. The experiment preserves both original
  normalization stages. A generic "skip normalization" shortcut is not approved.
- Memoization assumes read-only plain JSON data during the synchronous build.
  JSON equality does not establish arbitrary JavaScript object-alias semantics
  for unsupported shared/mutating inputs. A production change should keep
  prepared data private and preserve public helper behavior.
- Launcher: 33 differential cases compare the candidate to the actual extracted
  launcher functions. The experiment retains the previous full file string;
  this has a memory cost. It still performs the file read. Cache misses have no
  established speed advantage. Timestamp-only caching, auth-directory caching,
  offline-history caching and reuse across IPC awaits remain unvalidated.
- Recorder: four paired traces compare JSONL bytes and return values, including
  compaction, write failure, event caps, window changes, own movement and marks.
  Idle clips intentionally keep the existing behavior: expiry happens on packet
  arrival, not eagerly when a clip is requested.
- Final rollout gates: live packet-forwarding tail latency while polling;
  Electron rendering/IPC cost; peak heap and GC; realistic launcher cache-hit
  rate; and no changed packet/evidence/persistence ordering. Existing response
  size and retention limits remain unchanged.

**Existing regression coverage**

The implemented optimization is narrower than the original experiment: its
cache lasts only for one game projection, and only holds the second normalization
of a newly created private event array. Detail/calendar projections and separate
games still create independent outputs. The scope ends in `finally`; no cache
survives the projection. Zero timestamps use the original uncached path. Both
normalization stages, all attribution passes and callback ordering remain intact.
Historical experiment results above describe the earlier, broader benchmark-only
design; the isolated prototype modules that produced them were one-off and have
been removed. Re-running `performance_validation.js` regenerates measured results
and the production regression test run under the ignored `output/` directory.

The harness runs 11 existing history/account-related scripts on the baseline
and the in-memory history experiment, plus the recorder script on the baseline
and the recorder experiment: 24 script runs per runtime.

- `tests/session/test_launcher_session_history.js`: projection shape and counters.
- `tests/session/test_session_game_events.js`: parsing, attribution, deduplication/reconciliation.
- `tests/session/test_calendar_stats.js`: DST, calendar boundaries, coverage and attribution.
- `tests/session/test_session_tracker.js`, `tests/session/test_session_enhancements.js`: lifecycle and late verification.
- `tests/session/test_game_recap.js`, `tests/session/test_local_session_tracking.js`: recap and local-mode behavior.
- `tests/session/test_session_submode_stats.js`, `tests/session/test_session_mode_breakdown.js`: mode/submode semantics.
- `tests/session/test_empty_session_cleanup.js`: pending/late data and retention behavior.
- `tests/accounts/test_launcher_accounts.js`: account identity, selection and scoping.
- `tests/features/test_packet_recorder.js`: scene recording, multi-session behavior and clips.

Launcher cache equivalence is tested by the 33 dedicated harness comparisons;
the full live `launcherState` IPC flow is not replaced in these existing tests.

The harness hashes 204 production source files before and after each run and
fails if they change. Fragment replacements also fail explicitly when expected
source snippets change. Re-run against the intended production revision before
implementing anything.

Baselines, decisions and raw samples are written to the `--output` path under the
ignored `output/` directory and are not tracked in this repository. Runs from
different fixtures use different fixture hashes and are not comparable.

**Saved nickname history**

`node scripts/benchmarks/nicks_performance.js <baseline-directory>` compares
synthetic 1,000/2,000-player histories against a saved working-tree baseline.
The baseline needs `launcher.js`, `src/denick/history.js` and
`src/denick/denick_history_index.js` at their original relative paths. Save
these before editing; do not substitute Git HEAD for an already modified tree.

The harness measures unchanged launcher reads, cold proxy loading and bursts
of twenty detections. It uses the real JSON worker with private temporary
files; batching submission time is reported separately from mutation time.
Disk completion is awaited outside the timing samples. It does not measure
Electron IPC, rendering, live packet latency or peak heap. Results are saved
under `output/nicks-implementation/`. Use the installed Electron Node runtime
as shown above when comparing with production. The extra conflict index uses
memory proportional to saved nickname mappings; it is not an unbounded cache.

**Urchin concurrency comparison (analysis only)**

`node scripts/benchmarks/urchin_concurrency.js` compares limits 1, 2, 3, 4,
6, 8 and 16 by changing only the concurrency constant in an isolated VM. It does
not modify production source/settings, load real API keys or send network
requests. The current 500 ms spacing, rolling budget, cache and deduplication
paths remain active.

The injected-time workloads cover 16 and 40 uncached names, eight fixed/mixed
response patterns and five trials per combination. Mixed trials shuffle the
slow players with repeatable seeds. A separate 16-player fixture runs the
production stats lookup and Hypixel queue to measure primary-profile readiness.
The default output is `output/urchin-concurrency-study/node.json`;
`--output=<path>` selects another JSON destination. The output records runtime,
source hashes, first/median/final tag completion, success/failure counts, peak
concurrency and unchanged provider request counts. Run under Electron's Node
runtime as shown above to compare engines.

These are scheduling measurements. The synthetic provider does not become
slower or reject more requests as concurrency rises. The results therefore
cannot establish the fastest or safest live Urchin limit, provider burst
allowances, Minecraft rendering latency or heap/FPS performance. A finished
timeout is an unavailable tag result, not a successful tag retrieval.

**Hypixel concurrency comparison (analysis only)**

`node scripts/benchmarks/hypixel_concurrency.js` compares limits 1, 2, 3, 4,
5 (the current policy), 6, 8 and 16. Only the concurrency constant changes in
memory; production files/settings, real providers, API keys and player data are
not used. The production 200 ms base spacing, seeded +/-15% jitter, rolling
budget, adaptive spacing and request deduplication remain active.

The 720 raw queue trials cover 16/40 uncached players, nine response patterns
and five repeatable seeds per combination. Patterns include uniform, mixed,
slow-first, timed-out replies and a budget already used by 225 prior requests.
A further 40 cases run the actual stats lookup and local Scan runner with the
unchanged two-slot Urchin client: sixteen simultaneous player lookups, twelve
scan opponents, and one request per provider/player. They report first/all
primary-profile readiness and complete local Scan output separately. Local
Scan rows must follow the last opponent's completed lookup.

The default output is `output/hypixel-concurrency-study/node.json`;
`--output=<path>` selects another destination. JSON includes raw samples,
first/median/final request settlement, five-trial completion ranges, peak
concurrency, success/failure counts, runtime and production source hashes.
Run in Electron's Node runtime as shown above to compare engines. Byte-equality
guards reject any production source change during a run.

These fixtures measure scheduling with fixed provider delays and injected
time. They do not model additional slowdown or errors at higher concurrency,
live provider quotas/latency, the full timeout-recovery workflow, renderer/IPC
latency or heap/FPS. Completed timeouts count as failures. A faster queue does
not establish a faster complete Scan or a safe live concurrency allowance.

**Live Hypixel concurrency comparison (explicit network experiment)**

`node scripts/benchmarks/hypixel_live_concurrency.js` performs preflight only.
Add `--live` to make real authenticated `/v2/player` HTTPS requests. Use the
installed Electron Node runtime shown above to match the proxy runtime.
The running local Fury health endpoint and a configured Hypixel key are
required. The key is read privately from Fury's data directory and never
written to reports or logs; no production files or settings are changed.

The bounded experiment compares 1/2/3/4/5/6/8/16 slots in three rotated rounds
of sixteen players each, with four separate warm-up players. Groups are
randomly assigned from saved non-nicked UUIDs last seen at least ten minutes
ago. Every player is used only once per run; a hashed request ledger also
excludes recent players across interrupted/restarted runs. This avoids
repeated-player requests while comparing different concurrency limits.
Different profile sizes remain a source of variance; each response's JSON
size and exposed cache headers are recorded. No cache-busting is attempted,
and a fresh upstream cache miss cannot be guaranteed.
Only the initial warm-up is fixed; connection reuse after quota pauses also
varies, so first-result differences do not isolate the concurrency limit.

The actual production queue retains its 200 ms base spacing, seeded +/-15%
jitter, quota gates and adaptive throttling; only concurrency varies in memory.
Each measured batch has a fresh queue, representing a fresh game with quota
headroom. A shared ledger limits this experiment to at most 200 requests per
rolling five minutes (or two-thirds of a smaller observed limit) and 80 per
rolling minute, with extra allowance reserved for Fury. Batches wait for
gameplay, proxy queues and cooldowns to clear. Requests have five-second
timeouts and no automatic retries. Authentication/rate-limit failures stop
queued work; failures or overlapping proxy activity are flagged rather than
presented as fast successful trials.

Results and the private hashed-start ledger are under ignored
`output/hypixel-live-concurrency/`. Reports contain real monotonic timings,
success/failure counts, observed overlap, response sizes, quota/cache headers,
runtime and a production-source hash, but no API key, UUID or player name.
This measures the Hypixel queue plus HTTPS/JSON response time. It excludes
Mojang, Urchin, full lookup recovery, Scan's initial delay and Minecraft
rendering. Three samples per limit are a preliminary comparison, not proof
of a universal optimum or a provider-approved burst limit.

**Live Urchin concurrency comparison (explicit network experiment)**

Production pacing is now adjustable with the chat-only `/urchinrate` command,
defaulting to 200 ms and two reads. Recorded studies below used 500 ms. The live
study harnesses retain their explicit 500 ms experiment floor and fresh module
settings; they do not automatically benchmark the user's saved pacing values.

Hypixel has matching chat-only `/hypixelrate` controls for the game-priority
base delay and shared concurrency cap, defaulting to 200 ms and five reads.
Its isolated client benchmarks also use their explicit/default experiment
settings rather than inheriting saved user values. Runtime changes retain
jitter, quota slowdown, cooldowns and separate background limits.

`node scripts/benchmarks/urchin_live_concurrency.js` performs preflight only;
add `--live` for real `/v3/player/tags` requests using the private configured
Urchin key. Use Electron's Node runtime as above. This exercises Fury's actual
username tag lookup, queue and parser with only concurrency replaced in memory.
Production spacing stays at 500 ms, with ten-second HTTP timeouts and the
existing local/provider quota behavior. Production files/settings are unchanged.

The experiment uses three rotated rounds at 1/2/3/4/5/6/8/16 slots, sixteen
different players per batch and four separate warm-up players. Saved players
must be non-nicked, have an online UUID and have been last seen at least ten
minutes ago. Name and UUID hashes prevent repeat lookups within or across
recent interrupted runs. Each response must be HTTP 200 with a tags array and
the expected UUID; an empty tags array is a successful check. Profile/tag
contents, player identities and API keys are not written into reports.

One shared experiment ledger retains 500 ms spacing across batch boundaries,
at most 200 starts per rolling five minutes (or two-thirds of a smaller observed
limit), at most 80 per minute, and extra headroom for Fury's own reads. Missing
headers do not disable this local budget. Batches wait during gameplay, queued
proxy work or cooldowns; overlapping proxy usage is flagged. Authentication or
429 errors cancel queued work; Retry-After is retained across restarts. A
single transport/service failure pauses further batches for thirty seconds;
four physical service failures in one batch, or at least two in consecutive
batches, stop the experiment. Local cooldown results are recorded separately
from actual HTTP failures. There are no automatic retries or cache-busting parameters.
`--resume --live` continues untested batches in a stopped experiment after
checking the production source hashes; earlier timings and failures stay in
the report, and every earlier experiment player is excluded from selection.
`--budget=16..200` lowers the experiment's rolling five-minute budget;
`--first-pass-only` collects only the first snapshot for each limit and marks
the result partial. A resumed 429 enforces a full five-minute quiet window.
`--standalone` permits an absent health server only after the caller verifies
that Fury is stopped; this phase is marked separately in the report. No Fury
process is started by the harness. These local budgets are client choices,
not verified allowances for a key when the provider omits its quota headers.

Outputs are under ignored `output/urchin-live-concurrency/`: request/lookup
timings, success/failure counts, observed concurrency, exposed cache/quota
headers, response sizes, runtime and source hashes, plus a private hashed-start
ledger. Failed/incomplete or overlapping batches are excluded from the
successful-batch summary; all settled attempts and failure counts are also
reported separately, so failed lookups cannot appear as fast successful tags.
`outcomeSummary` includes every batch: available checks, actual HTTP 429s,
checks cancelled after 429, other failures and unstarted checks. Full-tag
completion is null when no complete successful batch exists. Recovery time
after 429 is unmeasured; an imposed quiet period is not the provider's observed
reset time. Compare availability and throttling before interpreting latency;
shared quota and test order prevent assigning a 429 to the concurrency ceiling
alone.
Different player payloads, hidden upstream caches,
connection reuse after pauses and changing server/network conditions remain
limitations; first-result times do not isolate concurrency. Three samples per
limit cannot establish a universal optimum or a safe provider burst allowance.
This test excludes Hypixel primary stats, full Scan timing, rendering and IPC.

**Isolated live provider and full-Scan study**

`prepare_live_players.js` prepares a private current-name fixture from a live
Aurora `superstar` database snapshot saved in
`output/isolated-live-scan/aurora-pool.private.json`. It validates UUID/name
mappings with Mojang session profiles, excludes earlier experiment identities,
balances four Bed Wars star ranges, and writes only aggregate preparation
statistics outside the private fixture. No Hypixel or Urchin calls occur in
this preparation stage.

`node scripts/benchmarks/isolated_live_scan.js` is preflight only; `--live`
starts the opt-in study. Run in Electron's Node runtime as above. Fury must
remain stopped: detection of a running app delays admission, and a running app
at completion marks the trial contaminated. Production source/key changes stop
the study without overwriting those changes.

The study screens Hypixel 2/5/8 and Urchin 1/2/3/4/8 separately, with at least
310 seconds after the last provider response before another trial group.
Each group has fresh queues, caches, dedupers and an HTTPS connection pool,
two distinct health players and sixteen distinct measured players. HTTP/schema,
identity, latency and available Hypixel quota checks gate measured admission.
Rate limits and provider errors fail a trial and remain in the results;
they are never filtered away to manufacture a healthy result. Failed health
gates can retry once with new identities after another isolated quiet window.
Two rejected admissions leave the candidate unmeasured; other healthy candidates
can continue without discarding the rejected checks. Any admission 429 also
counts against that candidate's zero-throttling assessment.

Healthy current/alternative candidates then enter a two-by-two combination
screening. A healthy current-policy combination is retained as the repeated
control against the strongest clean different-Urchin alternative; if the
control fails, two clean alternatives are used. Both receive two additional
isolated repeats, alternating order. If fewer than two clean full-Scan
candidates exist, the study stops with its failed outcomes retained; it cannot
claim a healthy-finalist comparison or a qualified winner. The combination workload runs the real
stats sources, lookup/retry guards, nick-detection wrapper and Scan formatter:
sixteen real Tab Stats lookups staggered by 200 ms, live Mojang/Hypixel/Urchin/
Aurora requests, and the twelve-opponent Bed Wars Scan after its four-second
automatic delay. It measures the dispatch of the complete chat batch, not
Minecraft painting or network/gameplay events. The roster/team assignments
are fixtures; every provider response in the live study is real.

The original Hypixel pacing/jitter, Urchin 500 ms spacing and timeouts remain.
Provider faults cancel further work in that trial; recovery to full success
is not claimed. Recommended candidates require at least three admitted full
Scan successes, no admitted failures and no 429s, and report both median and
worst observed completion. A clean small sample cannot guarantee future
service health, undisclosed/shared key/IP quotas, or safety at a faster game
cadence. No rate-limit-free usage beyond the measured workload is established.

Reports, private identity/start fixtures and source baselines stay under ignored
`output/isolated-live-scan/`. Reports contain aggregate/per-request timing and
health evidence, not provider keys or player profiles. This study changes no
production policy, setting or persisted application cache. A private
`control.json` containing `{"stop":true}` requests a stop at the next admission
check; ongoing trial cancellation also responds to SIGINT.
`--resume --live` continues a stopped checkpoint after verifying source hashes
and the key-file timestamp, retains all prior outcomes and quiet time, and
excludes every previously requested identity from the remaining player pool.
