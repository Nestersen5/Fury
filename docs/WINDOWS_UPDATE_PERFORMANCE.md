# Windows update performance and recovery

Measured on 2026-11-09 from the accepted working tree, including its existing
uncommitted changes. Git HEAD was not used as the baseline. This work changes
future Windows packages; no version was bumped or published.

## Results

Three successful pre-change native trials and two final-source post-change
trials used the same Windows x64 Electron/NSIS workload. Values are medians.
Seconds measure actual wall-clock time, not a network-speed estimate.

| Measurement | Before | After |
| --- | ---: | ---: |
| Download and verification, local feed | 2.57 s | 3.78 s |
| Restart and update to replacement launcher ready | 69.91 s | 14.01 s |
| Combined processing time, excluding time between player actions | 72.63 s | 17.79 s |
| Installer/map response bytes for the small fixture release | 128.41 MB | 3.04 MB |
| Staged runtime physical files before NSIS adds updater helpers | 4,377 | 75 |

Restart/install time fell by **80.0%** (55.90 seconds). Combined processing time
fell by **75.5%** (54.84 seconds). Transferred bytes fell by **97.6%** for this
small fixture release. MB in this report means 1,000,000 bytes.

Individual restart-to-ready observations:

- Before: 58.500, 69.905, 75.065 seconds.
- Final after: 14.424, 13.593 seconds.

The local differential download itself was slower than the local full download:
range requests and copying/hashing cached bytes have costs. This is not hidden
by the much smaller network transfer. No internet download-time saving is claimed
from this loopback measurement. The measured main improvement is installation.

Two additional successful native cases:

| Case | Download and verify | Restart to ready | Transferred |
| --- | ---: | ---: | ---: |
| First loose-file client to compact release | 2.474 s | 17.108 s | 124.38 MB |
| Blockmaps unavailable; verified full-download fallback | 1.845 s | 17.564 s | 124.38 MB |

Existing clients still download the first compact release in full. Later
compatible releases can reuse the old installer. Larger code changes, dependency
changes and Electron updates can require substantially more download data.

## Workload and interpretation

- Windows 10.0.26300, AMD Ryzen 5 5600, Electron 42.1.0, driver Node 22.13.1,
  installed electron-builder 26.15.3 and pinned electron-updater 6.8.12.
- Real installed NSIS fixtures, normal production compression, version
  `1.1.4 -> 1.1.5`. These version labels identify private test installers only.
- Both versions contain the current application and dependencies, with the small
  fixture version/package-metadata change between them. Each fixture has a random
  registry/cache identity and a directory containing spaces.
- A loopback HTTP server serves the real installers and blockmaps. It records
  actual single-range responses; checksums verify the reconstructed installer.
  There is no simulated internet rate or claimed CDN throughput in the timings.
- Download time begins with the UI's download action and ends at ready-to-install.
  Restart time begins with the guarded install action and ends after the new
  renderer is ready and IPC reports the target version. It includes preflight,
  hashing, clean shutdown, preservation, removal/extraction and launcher startup.
- Each final repeated trial starts with a fresh synthetic profile and old
  installation. Prior fixture profiles are retained in their own sandbox for
  inspection. Pending downloads/maps are reset between trials. Production data
  is never used or reset.
- The replacement window must become visible through production code. The
  driver's old workaround that explicitly showed it is disabled for these final
  trials. The old fixture is shown explicitly so test process-launch flags do
  not affect initial UI automation.
- The machine was not otherwise isolated, and some artifact builds ran during
  trials. These are warm local measurements with visible variation, not cold-disk
  results or an estimate for every player's machine. No gameplay, FPS or peak
  memory improvement is claimed. The archive has header/integrity metadata and
  does not materially reduce installed bytes (staged totals approximately
  789.1 MB before and 790.2 MB after).

## Implemented changes

Windows installer and ZIP use `app.asar`, retaining the same application payload
and separate service ownership. Only the PowerShell storage guard is explicitly
unpacked; Electron's bundled Node mode reads service/worker code from the archive.
This eliminates thousands of individual extraction/removal operations without
skipping data-preservation checks. Mac packaging is unchanged.

The custom updater provider uses fixed per-version blockmap URLs and single
byte-range requests. Missing maps or a failed differential reconstruction fall
back to the existing full download and final size/SHA-512 checks. PREPARE/PUBLISH
include the map in immutable, approval-bound supporting files, without adding a
distribution slot or changing schema-1 installer metadata. A read-only live CDN
probe against the existing 1.1.4 installer also returned HTTP 206 and exactly
1,024 bytes for `Range: bytes=0-1023`. No new release was uploaded.

For update reliability, Main records intent before handoff and checks the actual
running version on the next launch. A shutdown that never calls its handoff is
not counted as a successful install. Synchronous installer errors propagate, and
the adapter retains an instance-local error listener for errors arriving after
disposal instead of allowing an unhandled EventEmitter error during shutdown.
NSIS starts the executable it just installed directly, and Windows replacement
launches explicitly show/focus their completed window.

The reported historical incident requiring two download/restart attempts was
**not reproduced**. Baseline native trials also succeeded on their first attempt.
The late-error/disposal race and discarded-error behavior are confirmed by
regression tests, but are not asserted to be the cause of that incident. The new
attempt record makes a version that did not apply detectable on the next launch.

## Verification

Completed checks:

- 37 focused updater, publication and archive tests, including delayed errors,
  unchanged-version recovery, shutdown without handoff, cache corruption,
  cancellation, immutable blockmap publication and private files inside archives.
- `npm run test:updates`, including real Electron release/update presentation.
- `npm run test:packaging`, including source-completeness and privacy export.
- `node tests/storage/test_windows_migration.js`: 32 migration cases.
- `node tests/storage/test_windows_migration_integration.js`: native ACL/writer
  checks and real Electron localStorage/cookie relocation. Actual alternate-owner
  ACL coverage is skipped when the required privilege is unavailable.
- `node tests/integration/test_shutdown_launcher.js --updates-only`: clean
  shutdown hands off; forced shutdown does not invoke the installer.
- Final-source `scripts/package_windows.js` build: real installer and ZIP share
  one verified payload, 77 entries including NSIS's updater helpers, source digest
  `43f42173478c3ee1e0c620b22f67e38c6273429df618bdd213b9adcb5ee0668a`.
- Final packaged-runtime restart, busy recording and account scenarios: proxy and
  Cosmetic Search service execution from the archive, Stop/Start, persisted
  history/recording drain, account isolation and compact-history stale guards.
- Native upgrade trials preserve exact synthetic settings, cached sign-in bytes,
  saved history, recording bytes and Chromium preferences. Every successful
  trial checks the replacement process's actual target version.

- `scripts/verify_windows_storage_installer.js` completed real legacy loose-file
  to archive upgrades with a changed install directory, unreadable-data failure
  before old removal, exact credential/settings/history preservation, reinstall
  after account deletion and normal uninstall retaining canonical data. The
  changed-directory migration took 15.984 seconds in this separate correctness
  fixture; it is not mixed into the updater medians above.

Per-machine elevated upgrades, native Mac execution and a real Microsoft login
were not exercised. Platform eligibility, explicit download/install actions,
unsigned-release trust state and manual updates on portable/Mac remain unchanged.

Intermediate fixture-authoring/repetition failures were excluded from final
timings. Archive authoring now uses a separate ASAR CLI process so the sync
builder cannot race its output stream; repeat trials scope the request log and
start fresh instead of downgrading a completed fixture. An intermediate source-
drift build was rejected by the existing parity check and rebuilt. No such
intermediate artifact was published. Native writer tests were rerun without
other live fixture launchers after a concurrent run correctly refused a writer.

## Reproduction and reports

`scripts/verify_windows_installer_updates.js` accepts `--output`,
`--production-visibility`, `--repetitions=1..5`, `--missing-blockmap`, and
`--transition-from=<saved-source-directory>`. Use `--loose --frozen-input` and
`--include=<saved-installer.nsh>` for the saved baseline payload. Preserve the
accepted working-source baseline before editing; a packaged historical release
is not an equivalent baseline.

`scripts/benchmarks/windows_updates_report.js` aggregates passing native reports
using repeated `--before=<report.json>` / `--after=<report.json>` arguments,
optional `--transition` / `--fallback`, and `--output=<directory>`. It writes JSON
with raw measured samples and a self-contained HTML comparison.

Local evidence for this run is under `output/updater-performance/`: saved source
hashes in `before/hashes.json`, baseline reports in `baseline-1`, `baseline-2` and
`baseline-visibility`, final repeated reports in `post-confirmed`, extra cases in
`transition` and `post-fallback`, final shared payload reports in `final-pair`,
legacy preservation results in `legacy-storage-native.json`, and aggregate
JSON/HTML in `comparison`. Fixture copies, generated installers and
these private outputs are not production release candidates.
