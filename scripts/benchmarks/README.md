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
