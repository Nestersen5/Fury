# Fury anticheat lab

Development-only local gameplay testing. The completed campaign contains 3,500
validated trials across 35 supported scenarios, with separate calibration and
held-out evaluation. See [the final report](REPORT.md), [per-scenario results](SCENARIO_RESULTS.md),
[source audit](SOURCE_AUDIT.md) and [development history](PROGRESS.md). Telly and
the other unsupported paths listed in the report are excluded from that coverage.

The original untrusted client is never compiled or run. Independent scripts use
the existing Fury proxy, a separate Mineflayer development dependency, and Mojang's
hash-verified vanilla 1.8.9 server. All Minecraft clients and listeners use
127.0.0.1. A test-process-only preload redirects Fury's upstream and disables
authentication in an isolated data profile, following existing integration tests.
It rejects external TCP connections from that proxy process. Production auth,
settings, application dependencies and launcher code are unchanged.

Requirements: Node >=22, Python 3.11+, trusted Java 8. On this machine the lab uses
`C:/Program Files/Eclipse Adoptium/jdk-8.0.462.8-hotspot/bin/java.exe`.
Set `FURY_LAB_JAVA` to an alternative trusted Java 8 executable if necessary.

From repository root, initial setup:

```powershell
python scripts/development/anticheat_lab/read_source.py 'C:\Users\Admin\Desktop\vape\VapeV4.21-main source code.zip' output/anticheat-lab/source-text
node scripts/development/anticheat_lab/baseline.js
npm.cmd ci --prefix scripts/development/anticheat_lab/runtime --ignore-scripts --no-audit --no-fund
node scripts/development/anticheat_lab/setup_server.js
node scripts/development/anticheat_lab/evaluate_corpus.js
node scripts/development/anticheat_lab/smoke.js
node scripts/development/anticheat_lab/verify_rng.js
node tests/features/test_anticheat_lab_behaviors.js
node tests/features/test_anticheat_lab_environment.js
node scripts/development/anticheat_lab/pilot_clicker.js
node scripts/development/anticheat_lab/pilot_environment.js
node scripts/development/anticheat_lab/pilot_blockhit.js
node scripts/development/anticheat_lab/pilot_blink.js
node scripts/development/anticheat_lab/pilot_fastplace.js
node scripts/development/anticheat_lab/pilot_scaffold_legit.js
```

Source and baseline snapshot commands reject existing destinations. Keep the
original baseline; use a new explicitly named directory for another snapshot.
The server download is cached and checked against Mojang's published SHA-1 and
size before use. No tools or dependencies from the untrusted archive are run.

Smoke creates a fresh run directory, world and Fury profile under ignored
`output/anticheat-lab/runs/`. Server console creates a stone arena after chunks
load, supplies ordinary inventory items, and configures a minimal Bed Wars
sidebar to activate Fury's existing game gate. The sidebar does not emulate
Hypixel gameplay or synthesize cheat evidence. A `/teamdebug` report verifies
the live game gate. Three local players participate: actor, opponent and observer.
The observer connects through the actual Fury process. The actor places a real
block in survival mode and walks with Mineflayer's physics. Assertions require
server-originated placement and movement updates at the observer.

Each smoke directory contains server/proxy logs, environment metadata, raw
selected observer packets, Fury's normal `/recordcheat` JSONL recording under
`fury-profile/recordings`, an error list, and a smoke-result file on success.
The lab shuts down its own clients and children afterward.

`evaluate_corpus.js [detectorDir] [recordingDir] [outputFile]` replays immutable
recordings against a chosen detector snapshot. It honors live-only Stasis and
Scaffold's replay gate. Labels apply only to the labeled target; unresolved
targets and unknown labels do not enter detection/false-positive denominators.
Seven measured passes follow one warm-up per recording. CPU replay timing
excludes network, file loading, live scheduling and renderer/IPC; heap deltas
include GC noise and do not measure peak memory.

The lab compiles its own small Java tick agent using the trusted JDK. It instruments
only the SHA-256-pinned official server tick method, provides loopback configuration,
and logs actual tick durations. This is server-only experimental instrumentation,
not an original client component. It uses Java 8's bundled ASM; other JDK major
versions are unsupported. Per-trial minimum tick intervals are seeded constraints;
the measured intervals, rather than nominal settings, describe the actual test.

TCP relays delay actor traffic and server-to-Fury observer traffic independently,
preserving stream order. Transport logs record realized delays, including jitter
coalescing and operating-system scheduling. These are lab network conditions,
not a complete internet/Hypixel traffic model. Ground truth is never detector input.

Gameplay campaigns and narrow detector corrections are tracked in PROGRESS.md.
The authoritative final artifacts are under `output/anticheat-lab/final-analysis-v2/`.
Earlier exploratory scores and failed pilots remain available. Pilots and infrastructure
smoke tests do not count toward the 100 trials per supported scenario.

Freeze a new plan, then run its workers (use fresh output paths; existing plans
and run directories are intentionally never overwritten):

```powershell
node scripts/development/anticheat_lab/plan_timer.js output/anticheat-lab/plans/my-timer-plan.json
node scripts/development/anticheat_lab/run_campaign.js output/anticheat-lab/plans/my-timer-plan.json 0 2 output/anticheat-lab/runs/my-timer-worker0
node scripts/development/anticheat_lab/run_campaign.js output/anticheat-lab/plans/my-timer-plan.json 1 2 output/anticheat-lab/runs/my-timer-worker1
node scripts/development/anticheat_lab/plan_clicker.js output/anticheat-lab/plans/my-clicker-plan.json
node scripts/development/anticheat_lab/run_campaign.js output/anticheat-lab/plans/my-clicker-plan.json 0 2 output/anticheat-lab/runs/my-clicker-worker0
node scripts/development/anticheat_lab/run_campaign.js output/anticheat-lab/plans/my-clicker-plan.json 1 2 output/anticheat-lab/runs/my-clicker-worker1
```

Workers can run sequentially or in separate shells. Each owns its localhost ports,
world, Java server, proxy profile and clients. Two workers divide the same frozen
plan by array index; they do not generate a new random plan. `campaign.json` stores
the plan hash, implementation snapshot hashes and runtime lock hash. Every completed
trial writes raw observer packets, a normal Fury recording, ground truth and an
append-only outcome with artifact hashes. Invalid trials stop that worker and retain
their evidence for diagnosis. Server tick and transport logs are independent ground
truth, never detector input. Existing evaluation recordings must not be used for
threshold tuning. See PROGRESS.md for any known exclusions that require reruns.

Additional frozen-plan generators are `plan_blockhit.js`, `plan_fastplace.js`,
`plan_blink.js`, `plan_blink_sneak.js`, `plan_scaffold.js` and `plan_ladder.js`,
using the same runner arguments. Ladder requires exactly two workers to keep
initial-chunk and later-update contexts in different worlds. A worker can finish its
current trial and close cleanly when a `stop-after-current` file exists in its
run directory. To resume in a fresh directory without repeating completed IDs:

```powershell
node scripts/development/anticheat_lab/select_campaign.js PLAN.json SELECTION.json remaining 1 2 OLD_RUN
node scripts/development/anticheat_lab/run_campaign.js PLAN.json 1 2 NEW_RUN SELECTION.json
node scripts/development/anticheat_lab/validate_campaign.js PLAN.json EVIDENCE.json WORKER0 OLD_RUN NEW_RUN
node scripts/development/anticheat_lab/evaluate_campaign.js EVIDENCE.json output/anticheat-lab/baseline/detectors calibration CALIBRATION.json
```

`replace-jitter` selection mode creates explicit diagnosed exclusions and rerun
IDs for the first Clicker worker's known rounding bug. Pass that selection to
the rerun, then pass `--exclusions=SELECTION.json` to evidence validation along
with original and corrected run directories. It never selects by detector flags.

An uncaught worker failure is not a clean checkpoint. The diagnosed Scaffold
interruptions additionally retain `campaign-interruption.json`, hashing the
partial artifacts and describing the omitted source exception boundary. The
status helper accepts only completed, independently valid outcomes from those
directories; the interrupted trial must be performed again. Do not manufacture
a successful campaign-result file for an interrupted run.

`plan_defensive_blockhit.js` adds ordinary long-block/release/attack controls.
`node scripts/development/anticheat_lab/status.js` reports campaign progress
without opening detector verdicts. Completed counts in interrupted runs are
not final suite coverage until their frozen plan passes evidence validation.

For a verification pilot, set `FURY_LAB_TRACE_DETECTORS=1` in that shell before
running the pilot. The isolated preload then logs actual Fury flag callbacks
and compact combat-detector inputs, including detector resets, to
`fury-profile/lab-detector-trace.jsonl`. This optional probe changes no verdicts
and is disabled in normal campaign workers and production. It allows checking
live state lifetime against continuous observer-input replay.

Automatic Scaffold development pilots (failures are retained, excluded from
campaign counts, and do not establish supported behavior):

```powershell
node tests/features/test_anticheat_lab_scaffold.js
node scripts/development/anticheat_lab/pilot_scaffold_automatic.js FRESH_RUN scripts/development/anticheat_lab/pilot_scaffold_cases.json
node scripts/development/anticheat_lab/pilot_legit_ladder.js
```

Use `evaluation` in `evaluate_campaign.js` only after detector changes are frozen.
Ground-truth labels are read for scoring; detector callbacks receive only actual
Fury observer records. CPU replay samples exclude parsing and live forwarding;
repeat final matched cost measurements after background labs have stopped.

```powershell
node --expose-gc scripts/development/anticheat_lab/compare_performance.js BASELINE_DETECTORS CANDIDATE_DETECTORS PERFORMANCE.json EVIDENCE.json --corpus=output/anticheat-lab/baseline/recordings
node --expose-gc scripts/development/anticheat_lab/compare_performance.js BASELINE_DETECTORS CANDIDATE_DETECTORS RAW_COMBAT_PERFORMANCE.json EVIDENCE.json --raw-combat
```

The matched comparison accepts multiple evidence files. It uses three warm-ups
and nine alternating-order measured passes over the same pre-parsed records.
The second command includes shared packet conversion and both combat detectors
using selected raw observer packets; it excludes Scaffold and has no historical
corpus option. Neither benchmark measures end-to-end proxy or renderer latency.
Rate/time-to-flag evaluation from individual recordings starts each detector
with the context in that recording. An ongoing live session can already have
clock/context history; report that cold-start distinction rather than equating
offline clip timings with the first live alert.

To reproduce every supported campaign, generate fresh plans with the nine
`plan_*.js` programs below, and run workers 0 and 1 against each same plan.
These commands run sequentially and take substantial time; workers may instead
run concurrently in separate shells. Existing artifacts are never overwritten.

```powershell
$labCampaigns = 'timer', 'clicker', 'blockhit', 'fastplace', 'blink', 'scaffold', 'ladder', 'blink_sneak', 'defensive_blockhit'
foreach ($labCampaign in $labCampaigns) {
    $labPlan = "output/anticheat-lab/plans/repeat-$labCampaign.json"
    node "scripts/development/anticheat_lab/plan_$labCampaign.js" $labPlan
    if ($LASTEXITCODE) { throw "Plan failed: $labCampaign" }
    $labWorker0 = "output/anticheat-lab/runs/repeat-$labCampaign-worker0"
    $labWorker1 = "output/anticheat-lab/runs/repeat-$labCampaign-worker1"
    node scripts/development/anticheat_lab/run_campaign.js $labPlan 0 2 $labWorker0
    if ($LASTEXITCODE) { throw "Worker 0 failed: $labCampaign" }
    node scripts/development/anticheat_lab/run_campaign.js $labPlan 1 2 $labWorker1
    if ($LASTEXITCODE) { throw "Worker 1 failed: $labCampaign" }
    node scripts/development/anticheat_lab/validate_campaign.js $labPlan "output/anticheat-lab/repeat-$labCampaign-evidence.json" $labWorker0 $labWorker1
    if ($LASTEXITCODE) { throw "Evidence failed: $labCampaign" }
}
```

Seeds reproduce requested settings, input decisions and random streams. Operating
system scheduling and real server/network delivery are measured outcomes, not
promised byte-identical timings. An invalid trial remains an invalid artifact;
diagnose and resume in a new directory using the documented selection mechanism.

After reviewing only calibration records, score the final working-tree candidate
into `*-current-calibration.json` beside each validated `*-evidence.json`.
`freeze_candidate.js NEW_DIRECTORY EVIDENCE...` verifies those hashes and freezes
the detector files before held-out scoring. Evaluate both the immutable baseline
and frozen candidate with split `evaluation`, then run the matched benchmark.
`summarize_results.js ANALYSIS_DIRECTORY NEW_SUMMARY.json` consolidates the nine
`*-v1-*` evidence/score files used in this delivery. Keep older exploratory scores;
the final report identifies the authoritative analysis directory.
