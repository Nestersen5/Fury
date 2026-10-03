# Goal progress

Goal is active. Do not mark complete on infrastructure or simulated traces alone.

## Preserved baseline

- Started from the user's dirty working tree. Existing untracked `src/detect/`
  and detector tests are user work; do not replace them or restore Git HEAD.
- Current detector files and all 27 recordings copied to
  `output/anticheat-lab/baseline/`, with source/corpus hashes in `manifest.json`.
- Both existing detector suites passed; logs saved with the baseline.
- Baseline evaluation: 585,012 records; 12 resolved legitimate-labeled recordings,
  zero target flags; 9 Scaffold-labeled recordings, 4 detected targets; 2 unresolved
  target files excluded. This corpus already informed the detectors, so it is
  not held-out evaluation and is not a population-wide accuracy estimate.
- Seven measured replays after warm-up: sum of per-file median CPU replay time
  367.6012 ms. Raw samples and heap deltas in `baseline/corpus-evaluation.json`.
  No live forwarding/performance improvement has been measured or claimed.

## Source and local server

- Source snapshot complete, inert text only; detailed audit in SOURCE_AUDIT.md.
- Registered Scaffold: Legit, GodBridge, TellyBridge. Registered BlockHit is
  `module/render/Animations.java`: Manual, Predict, Auto, Lag. The class called
  `BlockHit.java` actually registers NoItemRelease and is not a substitute.
- No Stasis module found; Blink movement-only is the explicitly identified
  candidate equivalent. Original runtime equivalence remains unverified.
- Trusted pinned development Mineflayer 4.39.0 installed with npm scripts disabled.
  Its package/lock are separate from Fury's runtime package.
- Official vanilla server 1.8.9 downloaded; SHA-1
  `b58b2ceb36e01bcd8dbf49c8fb66c55a9f0676cd`, 8,320,755 bytes verified.
- Smoke `output/anticheat-lab/runs/smoke-1790409104017/` passed: real server,
  actor/opponent, observer through Fury; actual BEDWARS/gameActive gate checked;
  survival placement accepted and visible; 21 observed actor movement updates;
  empty error list; child processes shut down. Initial failed smoke preserved
  separately: arena fill happened before chunks loaded; fixed command ordering
  and added command-error checks. No failed run is counted as successful.

## Next required work

Implemented since the first smoke:

- Independent Java-compatible Random/SplittableRandom checked against a newly
  authored Java standard-library helper: 3,600 exact comparisons across six seeds.
  Only that trusted helper was compiled, never original client code.
- Independent click cadence (Normal/Extra/Extra+), sampled combat input, Blink
  and BlockHit Lag packet queues. Hand-derived state/ordering tests pass.
- Real clicker pilots in `runs/clicker-pilot-1790409759620`: respectively
  68/63/55 accepted client crosshair attack calls, 33/32/29 observer swings and
  15/16/14 opponent damage statuses. Eight seconds each, no errors. These are
  pilots, not 100-trial calibration evidence or equivalence proof.
- Loopback TCP impairment preserves byte order and records requested/actual
  delivery delays. Real echo/stall test passes. Actor and observer impairment
  are independent; the latter is upstream of Fury, affecting its input.
- Own Java 8 server instrumentation pins the official MinecraftServer class
  SHA-256, logs actual tick intervals/work, and optionally imposes seeded tick
  pacing. Only our instrumentation is compiled; no original client input.
- Independent scaled game clock drives trusted collision physics and sampled
  actions. Movement serialization follows the 1.8 position delta / 20-tick rules.
  Environment pilot `runs/environment-pilot-1790410141464` produced 81/85/8/160
  simulation ticks at speeds 1/1.07/0.1/2 in about four seconds; server mean
  intervals 50.01/52.86/67.67/59.66 ms. Fast case left the original platform:
  it is NOT a flat-ground distance comparison. Arena extended and a height
  assertion added for the next run. All pilots remain excluded from trial counts.

1. Finish dependency/event/mapping audit (see SOURCE_AUDIT.md remaining gates).
2. Independently implement behavior kernels and test hand-derived state transitions.
   Never import, compile, load, inject or execute the original source/binaries.
3. Add ground-truth trial manifests, deterministic seeds, per-trial reconnect or
   verified detector reset, and faithful ordered network impairment. Prevent a
   detector's once-per-entity flags from leaking across repeated trials.
4. Implement actual game integrations; verify real actions occurred before counting
   trials. Timer needs simulation-clock scaling, not coordinate scaling. Legit
   Scaffold only assists sneaking and needs separate ordinary placement input.
5. Freeze independent calibration/evaluation schedules, then run at least 100 varied
   trials per supported scenario and legitimate controls. Report unsupported/source
   gaps explicitly without substituting synthetic success.
6. Compare before/after on same frozen evidence, retain only supported narrow
   detector changes, run relevant regression tests and repeated performance measures.
7. Final per-module report, reproducer commands, recordings/labels and limitations.

No production detector or proxy changes have been made by this goal yet.

## Verified later pilots and campaigns in progress

- Corrected environment pilot `runs/environment-pilot-1790410312221` passed all
  four speeds on flat ground. Explicitly load both arena halves before filling;
  retain failed setup runs as failures.
- BlockHit `runs/blockhit-pilot-1790410755156`: legitimate control and
  Manual/Predict/Auto standalone/Auto+Normal clicker/Lag all passed. Auto standalone
  generated no blocks, as expected from visible callers. Other modes produced
  observer blocking metadata and server damage. Require-mouse was disabled in
  these pilots; that is not coverage of its enabled default.
- Blink `runs/blink-pilot-1790410883055`: all eight type/direction/auto-send
  combinations passed real combat/movement and exact once-only movement delivery.
  Native-boundary equivalence and separately named Stasis remain unverified.
- FastPlace `runs/fastplace-pilot-1790411040785`: nine cases passed; vanilla 20
  placements/4s, delay 0/1 accelerated cases 80, delay 2 produced 40, wrong item
  filter remained 20. Projectiles observed 20 normally and 78/80 accelerated.
  Projectile object spawns are in the raw observer file; existing compact Fury
  recordings do not include these object spawns. Do not infer exact actor ownership
  from projectile packets when the protocol does not convey it.
- Legit Scaffold `runs/scaffold-legit-pilot-1790411151091`: five real bridge
  cases passed (legit steady-sneak control; default, zero and 500ms delays;
  require-sneak). Accepted bridge blocks 10/20/22/19/14, no falls. Other Scaffold
  modes and route geometries remain outstanding.
- Frozen Timer plan: `plans/timer-v1.json`, SHA-256
  `e8d268c0650d95dae3bfc369e9143ae062d7c0f41ff183fce5bee21ee5e1e03d`.
  Both workers in `runs/timer-v1-worker0` and `worker1` completed 100 valid trials:
  100 Timer and 100 legitimate movement overall, 50 calibration and 50 held-out
  per scenario. `timer-v1-evidence.json` validates all 200 specifications, hashes
  and measured network/server tick conditions. Ten Timer speed-1.0 trials are
  no-effect boundary cases. Evaluation flag results remain unused for tuning.
- Frozen Clicker plan: `plans/clicker-v1.json`, SHA-256
  `29b761483813b29415302e6374a8b81e1d8e1dc32778c91a3e14057353cfe18b`.
  100 per Normal/Extra/Extra+/scripted legitimate clicking, each split 50/50;
  includes CPS boundaries, jitter, activation release, trigger/target loss, item
  limits, unseen evaluation network/TPS combinations and 100s long cases.
  Both workers started, in `runs/clicker-v1-worker0` and `worker1`.
- **Clicker worker0 source correction:** it loaded the first `click_jitter.js`,
  which unnecessarily rounded the sum of two promoted float offsets to float.
  Source fields are doubles. The file is corrected now; worker0's frozen source
  snapshot preserves the older implementation. Exclude and rerun its jitter=true
  cases with the corrected source before claiming 100 supported trials/mode.
  Its jitter=false trials do not call that code path. Record exclusions explicitly;
  never overwrite or hide the original recordings. Worker1 must use corrected code.

- Frozen BlockHit plan: `plans/blockhit-v1.json`, SHA-256
  `65853e08bbd019b291f0cc2cee7ee7ca389731d93de702aac57b1c8659879b41`.
  Two running workers, 300 trials each: 100 Manual, Predict, Auto standalone,
  Auto paired with Normal clicker, Lag, and legitimate blockhitting. Each scenario
  is split 50/50. Gate-disabled and chance-zero cases are retained as boundaries
  and must be reported separately from actual cheat effects.

Missing major work: GodBridge/Telly movement/rotation dependency implementations,
full varied BlockHit/Blink/FastPlace/Scaffold campaigns and controls, calibration,
held-out evaluation, justified production changes/regressions and final report.

## Later checkpoint: automatic Scaffold and expanded campaigns

- Added independent `scaffold_core.js`, `scaffold_rotation.js`,
  `scaffold_godbridge.js`, `scaffold_tellybridge.js`, and vanilla `sprint_state.js`.
  Unit numerical/state checks in `test_anticheat_lab_scaffold.js` pass. These are
  not sufficient evidence of gameplay equivalence.
- `runs/scaffold-auto-pilot-1790412381103` originally passed GodBridge and Telly,
  but its sprint-key/actual-sprint distinction and event order were incomplete.
  Retain it as an excluded development artifact, not supported Telly coverage.
  Later source audit resolved LOWEST-before-NORMAL event ordering, prevPos fields,
  direct pressTime assignment, and vanilla sprint-state gates. Corrected pilots
  are the relevant evidence.
- `runs/scaffold-varied-pilot-v1`: 11 GodBridge cases passed (cardinal -X/+Z/-Z
  and eight press/release turn cases across all four cardinal directions). Each
  accepted 32–33 placements, traversed real bridges, and stayed at Y=80. The
  activation-one case failed because the manual fixture stopped aiming after a
  tentative activation/reset; fixture correction is being retested.
- The same varied pilot tested Telly Y increase 0/1/2/3 across four directions.
  Real automatic placements occurred (5/20/3/18 after activation), but all four
  eventually fell. Telly fidelity remains unresolved. Do not fix its behavior
  merely to make a pilot pass or claim 100 supported Telly trials yet.
- `runs/scaffold-telly-order-pilot` was a setup failure (actor fell before the
  platform existed); `...pilot2` fixed setup but Telly still fell. Both retained.
  `runs/scaffold-fidelity-pilot-v2` explores render frequency/sensitivity and
  corrected activation-one behavior with monotonic rotation timing.
- Timer calibration only: `timer-v1-baseline-calibration.json` replayed 50 Timer
  and 50 legit movement recordings. Existing detectors flagged zero in both.
  Five calibration Timer speed-one cases have no effect. Evaluation verdicts
  remain unopened. Single-pass CPU samples are exploratory, not final performance.
- BlockHit worker1 cleanly checkpointed after 51 valid trials, no errors, to free
  a pilot slot. Selection `plans/blockhit-worker1-remaining.json` retains the same
  frozen plan and selects 249 remaining IDs; `runs/blockhit-v1-worker1-resumed`
  is running. Include both directories in final validation. Worker0 continues.
- FastPlace plan `plans/fastplace-v1.json`, SHA-256
  `4597f63022a041f5141e89781dfa2143383e0018c2449623444baa02a9cb6d8a`:
  100 each All, Blocks, Projectiles, legit held use, legit manual presses. Modes
  include wrong-item filters, delays 0..4, no-input and claimed-use boundaries,
  use-release windows, stone/snowballs, varied network/TPS. Both workers running.
- Blink plan `plans/blink-v1.json`, SHA-256
  `725dea0be75946c287b65dacea010ac6fdeaf1ad5f329e96112ff43393d5c858`:
  100 for each of eight type/direction/auto-send combinations plus 100 legit
  jump/combat controls. Thresholds 0/1/20/50/100, different jump phases/hold times,
  network/TPS profiles. Both workers running; check outcomes before claiming any
  completion. Explicit source identity remains Blink, not verified Stasis naming.
- Expanded to eight campaign labs after measuring about 4% of 12 logical CPUs
  for four labs and about 17GB available RAM. Short pilots may run additionally;
  keep monitoring scheduler overruns, errors, and host headroom. Do not infer
  production processing-cost gains while these background labs run.
- Added immutable selection/retry support (`select_campaign.js`) and validation
  of combined checkpoint directories. Diagnosed exclusions can be supplied to
  validation via `--exclusions=selection.json`; original evidence is preserved.
  Clicker worker0 jitter exclusions/reruns are still required when it completes.
- `pilot_legit_ladder.js` compares real ladder pauses with empty swings for
  ladders present before observer login versus block updates received later.
  First attempt failed due unloaded setup chunks; the setup now uses a temporary
  local fixture to load chunks before the observer connects. No detector change
  has been made based on this hypothesis yet.

The checkpoint above is historical. The following section supersedes its
statements about pending pilots and production edits.

## Ladder correction and later campaign checkpoint

- Real pilot `runs/legit-ladder-pilot-1790413231763` reproduced two live Stasis
  false positives: ordinary ladder climbing, sneak pauses, and empty swings.
  The observer connected before ladder placement in one case and after placement
  in the other. Both received 40 swings. No cheat behavior was enabled.
- Narrow production changes in `src/detect/detectorShared.js` and
  `src/detect/stasisDetector.js`: consume existing multi-block-change packets for
  the bounded climbable cache, remove replaced climbables, and suppress a gap
  containing sneaking. Compact recordings lack initial chunk collision context;
  sneaking ladder pauses and movement-buffering cheats can be indistinguishable.
  The suppression deliberately accepts missed sneaking Blink cases.
- `runs/legit-ladder-after-multiblock` removed the block-update case's live false
  positive but retained the preexisting-ladder false positive. The second change
  removed both in `runs/legit-ladder-after-sneak-guard`, verified in actual Fury
  logs. Permanent observer-recording fixtures and regression tests preserve this
  evidence. Existing combat, Scaffold and historical legitimate checks pass.
  Two pilot cases are not a population accuracy estimate; CPU replay samples
  collected while other labs run are not final performance comparisons.
- Frozen ladder plan `plans/ladder-v1.json`, SHA-256
  `0496e9aa41cf86163b0493ce653d02cb2733b9a4dbf0fdb7924ccaf84ccf7b13`:
  100 preexisting-ladder and 100 updated-ladder controls, each split 50/50.
  Separate workers prevent known-world cache contamination across these contexts.
  Both workers are running. Height, hold duration, click rate, aim, network and
  server timing vary; actual ladder contact/climbing and observer swings are checked.
- GodBridge activation-one fixture correction passed; render/sensitivity Telly
  pilots still fall. `scaffold-fidelity-pilot-v2` retains those results. Trusted
  vanilla source additionally shows previous-tick movement factors whereas the
  headless physics dependency uses current sprint state. Further investigation
  must remain isolated from frozen campaigns; no full vanilla-equivalence claim.
- Frozen Scaffold plan `plans/scaffold-v1.json`, SHA-256
  `3e21122fd4265ae3d553d233e94000729ff60b9d79c27919e4d9ba478af51379`:
  100 Legit, 100 GodBridge cardinal, 100 GodBridge turn and 100 ordinary sneak
  bridge controls. Each is split 50/50. Telly is excluded while fidelity remains
  unresolved. First workers completed 48 and 30 valid trials before a recovered
  source exception boundary omitted by the adapter terminated the processes.
  `campaign-interruption.json` records each partial trial and hashes its evidence.
  The original Java EventBus catches listener exceptions; an explicitly typed
  null-pending-turn exception now follows that boundary and is logged in ground
  truth. Untraced adapter errors invalidate the trial. Retest and resume are pending.
- Both original clicker workers completed 200 valid trials. Worker0's 40 jitter
  cases are explicitly excluded by `plans/clicker-worker0-jitter-correction.json`
  and are being rerun with corrected double arithmetic. Preserve all originals.
- Early BlockHit calibration-only subset: 17/20 effect-expected Lag trials
  detected, zero flags in 25 legitimate blockhit controls; other supported modes
  remain undetected in this subset. This provisional sample is not final coverage.
- Up to twelve labs were observed at about 20% aggregate CPU and 8GB available
  RAM on this 12-logical-CPU/32GB host. Continue monitoring actual overruns and
  resources. Do not use concurrent exploratory timing samples as final benchmarks.
- New lab starts snapshot production detector/recorder/proxy source hashes.
  Earlier workers lack that startup snapshot; immutable baseline versus candidate
  replay remains the authoritative comparison. Running processes do not reload edits.

Outstanding: complete campaigns and evidence validation; correct remaining
client fidelity gaps or explicitly bound unsupported behavior; finish calibration;
freeze candidate detectors, run held-out evaluation and matched processing-cost
measurements; deliver per-module report and reproducible artifacts.

## Completed Clicker/ladder evidence and defensive blockhitting

- `clicker-v1-evidence.json` validates 400 unique trials after 40 explicitly
  excluded jitter cases were rerun. Each Normal/Extra/Extra+/ordinary-clicking
  scenario has 100 valid trials (50 calibration, 50 held out). Calibration:
  zero flags in all four groups. Evaluation verdicts remain unopened.
- `ladder-v1-evidence.json` validates 200 unique trials. On the full calibration
  half, baseline Stasis flags 33/50 preexisting-ladder and 36/50 updated-ladder
  legitimate controls; current changes flag zero in both groups. Held-out
  verdicts remain unopened. These rates describe the scripted fixtures only.
- Resumed Scaffold workers use the original frozen specifications. Their
  interruption diagnostics preserve 48+30 prior valid outcomes and the two
  incomplete artifacts; no failed artifact is called a successful trial.
- Additional Telly pilots `telly-vanilla-factors-pilot` and
  `telly-sprint-state-pilot` investigate previous-tick factors and actual sprint
  state. One -X/Y-increase-1 case in the latter stayed at/above Y80 with 35
  automatic placements. The other seven fell or had insufficient automatic
  placements. Telly remains unsupported; these are excluded fidelity pilots.
- `defensive-blockhit-pilot` failed during setup because a missing optional
  actor condition was dereferenced; fixed the optional access and preserved it.
  `defensive-blockhit-pilot-v2` ran six ordinary-input cases. With ~90ms server
  ticks, one legal 250ms block/50ms release case received live Autoblock possible
  and confirmed flags. Its exact recording is a permanent regression fixture.
- Narrow additional production change: `autoblockDetector.js` now requires two
  fresh, valid world-age intervals indicating 40..60ms/tick before swings count.
  Invalid/slow/stale timing clears the pending evidence. Shared packet conversion
  forwards the already-recorded time shape; no recorder format or proxy ownership
  change. This uses observer packets only. Existing detector tests now supply
  ordinary clock packets to their normal-timing fixtures; historical gates pass.
- The early BlockHit calibration subset changes from 17/20 effect-expected Lag
  detections to 12/20. This explicit miss/delay tradeoff removes evidence when
  server timing makes legitimate release/re-block intervals ambiguous. It is a
  provisional sample, not final calibration or held-out performance.
- Frozen `defensive-blockhit-v1.json`, SHA-256
  `b824c639fc9430629d81cd4565f018008a58fd9bcd710d0ad60933110e01be87`,
  adds 100 ordinary defensive blockhit trials (50/50), varying long holds,
  release duration, network stalls and server tick aliasing. Two workers running.
- Frozen `blink-sneak-v1.json`, SHA-256
  `aa9ede3fb2d392b3dc0ad9a4f9d76d204f1bfa3756b591bbcecd9a1900373f1c`,
  adds 100 sneaking movement-Blink trials and 100 corresponding ordinary
  jump/combat controls to quantify the explicit ladder/sneak tradeoff. Two
  workers running. Primary Blink specifications are unchanged.
- `compare_performance.js` prepares a matched, alternating-order, warmed CPU
  comparison over immutable observer records. Run it only after owned live labs
  stop. No benchmark result or improvement is claimed yet.

## Live timing verification and sustained-pattern correction

- FastPlace full evidence passed: `fastplace-v1-evidence.json`, 500 trials,
  five scenarios of 100 each. Full calibration half has zero flags, including
  both legitimate controls and mode/filter/delay/no-input boundaries. Evaluation
  verdicts remain unopened.
- Primary Blink workers checkpointed cleanly at 195 and 196 valid trials.
  `blink-part0..3-remaining.json` repartitions the same 509 remaining frozen IDs
  into four workers (127/127/128/127). Preserve both original directories and all
  four `blink-v1-workerN-of4` directories for final validation. No flags selected
  the partition; this uses freed CPU/RAM capacity only.
- Optional isolated detector probes log actual Fury callbacks and compact combat
  inputs/resets. `defensive-blockhit-live-verification.json` confirms 3,114
  captured combat-detector inputs and two resets reproduce live verdicts exactly.
  Lag at normal timing remained confirmed (6,286ms from the probe start).
- That probe also found a remaining legal jitter case: a possible Autoblock flag
  at 6,391ms, with eight blocked-looking swings among 38 total. No tick slowdown
  was required. Preserve `defensive-blockhit-timing-probe` and the exact jitter
  regression fixture. This disproves a claim that the timing guard alone removes
  all false positives.
- Candidate now requires >=80% blocked-looking sword swings in addition to the
  existing score, sample/span requirements and validated timing. Occasional
  correlated metadata losses are insufficient. Verdicts wait for the next
  world-age update to validate the interval containing the swings. Binomial
  thresholds are documented as heuristic tier scores, not innocence probabilities.
- In the later 292-trial calibration subset, 17/40 effect-expected Lag cases
  remain detected; the timing-only candidate detected 20/40. Other module modes
  and 48 legitimate ordinary blockhit cases had zero flags. These are still
  provisional denominators; final full-calibration/held-out results are pending.
- Sneaking Blink calibration subset: baseline detected 3/30, current 0/30;
  all 36 corresponding legitimate controls remain unflagged. This explicitly
  measures the conservative ladder/sneak tradeoff rather than claiming free gains.
- A fresh `defensive-blockhit-pattern-probe` is running with the sustained-pattern
  requirement. New callback verification must match its own startup source snapshot.
- Individual recording evaluations start with that recording's available context;
  live processes may already have clock history. The continuous probe verifies
  actual live behavior. Do not present cold-start clip alert times as identical
  to ongoing-session live alert times.

## Completed calibration checks before final freeze

- BlockHit's full 600-trial evidence validates across original worker 0 and the
  cleanly checkpointed/resumed worker 1. Calibration Lag: baseline 32/40
  effect-expected cases detected, candidate 17/40. Ten enabled no-op boundaries
  and the other mode/control groups remain unflagged. No held-out verdict used.
- Defensive blockhitting validates 100 trials. Calibration false flags change
  from 7/50 (including two confirmed) to 0/50.
- Sneaking Blink and its controls validate 200 trials. Calibration positive
  detection changes from 7/50 to 0/50; the 50 legitimate controls stay unflagged.
  This is the measured cost of the conservative sneak guard.
- `defensive-blockhit-pattern-live-verification.json` verifies 3,090 actual
  combat inputs and two resets against continuous replay. All six ordinary
  cases have zero flags; the Lag positive is confirmed at 5,498ms.
- `ladder-final-live-verification.json` verifies 506 actual combat inputs and
  two resets. Both the preexisting and later-update ladder cases have zero
  live flags. Their real climbing/40-swing ground truth remains in the run.
- All six relevant behavior/environment/Scaffold/observer/combat test programs
  and the independent Java RNG reference check pass. Logs are retained under
  `output/anticheat-lab/final-checks/`. These checks do not replace gameplay trials.

## Final calibration correction and held-out evaluation

- All nine campaigns now pass full evidence validation: 3,500 unique trials,
  35 scenarios, exactly 50 calibration and 50 evaluation trials per scenario.
- Full Blink calibration revealed two ordinary jump/combat Stasis false flags
  (`legit_jumpcombat_c022`, `c028`). The actor never enabled its queue. Explicit
  observer `onGround=true` conflicted with an off-grid reconstructed Y. The
  candidate now vetoes gaps with positive grounded state; unknown remains null.
  A real negative fixture plus grounded-field ablation and real airborne Blink
  positive cover the change. Calibration Blink sensitivity decreases by five
  additional cases; that cost is retained in the final results.
- The final candidate was frozen after all calibration checks and before opening
  held-out verdicts. Its manifest and the full authoritative analysis live under
  `output/anticheat-lab/final-analysis-v2/`. Earlier `final-analysis/` scores are
  preserved pre-grounded-guard calibration artifacts, not the delivered candidate.
- Held out: 76/550 legitimate trials flagged by baseline, 0/550 by candidate.
  Effect-expected trials: 59/999 detected before, 29/999 after. The 201 enabled
  no-op cases stay unflagged. No post-evaluation detector tuning was performed.
- Fresh `grounded-blink-final-live-probe`: two legal cases unflagged, airborne
  movement Blink possible at 6,253ms. All 928 combat inputs and two resets match
  continuous replay from that process's exact source snapshot.
- Updated observer regression, original combat tests and original Scaffold
  tests pass after the grounded change (`final-checks-v2/`). Earlier independent
  behavior/environment/Scaffold and RNG tests remain applicable; their code did
  not change. Final numeric results and limits are in REPORT.md.
