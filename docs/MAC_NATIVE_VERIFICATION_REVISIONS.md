# Native Mac verification revisions — 2026-09-20

**Decision: PARTIAL KEEP.** The corrected verification and requested native
functional acceptance passed on Intel and Apple Silicon. All four containers
were generated and verified, but **none were retained**: GitHub still rejected
uploads for exhausted artifact quota after the account owner freed storage.
Public release acceptance is therefore incomplete.

## Source snapshot and evidence

- Tested private snapshot: `9b9e58979dc734f48a43ee13306b153c9cac76de`.
- Completed focused native run: private-archive Actions run `35507558717`.
- Intel: native `macos-15-intel`, x64 Node/Electron, native Intel kernel checked,
  ARM hardware flag 0, translated flag 0. No Rosetta evidence was used.
- ARM: native `macos-15`, arm64 Node/Electron, ARM hardware flag 1,
  translated flag 0.
- Locked dependency installation passed using Node 22.23.2. Electron and
  application dependencies were not changed by this task.
- Both payloads contain 233 verified current application/resource files with
  source digest `6ae0840ac1412cdac3edf2346fd75728a2bb0789722aceacd8383b6f477642a2`.
- Local reports and downloaded private job logs:
  `output/mac-native-verification-revisions/`. `generated-artifacts.json`
  explicitly records `retained: false`; the original CI metadata's
  `available: true` describes files on the now-finished runner, not local downloads.

A concurrent edit was detected after the snapshot: in
`features/gambler_george_reminder.js`, `GAMBLER_GEORGE_WIN_ALERT_DELAY_MS`
changed from 2750 to 2250. This task did not make or revert that change.
The native results apply to the recorded snapshot containing 2750, not that
later working-tree edit. Future retained artifacts must identify their actual
source snapshot again.

## Verifier fix

`scripts/release_artifacts.js` previously compared a lexical temporary root
under `/var` with canonical framework-link targets under `/private/var`.
`payloadInventory()` now rejects a directly symlinked payload root first,
then canonicalizes the trusted root with `fs.realpathSync()` before walking it.
Containment still uses `path.relative()` and rejects parent traversal,
absolute targets and actual out-of-root links. It does not use a string-prefix
containment test.

`tests/release/test_release_artifacts.js` now exercises a trusted aliased parent, rejects
a redirected root, and tests escaping children through that alias. Windows
junction tests passed locally; POSIX relative-link and real macOS temporary
path/framework cases passed on both native Macs without overriding `TMPDIR`.
Linux was not separately executed in this task; no Linux-specific path logic
was added or removed.

## Persistence fixture

`scripts/test_support/publication_writer.js` uses the existing
`writeFileAtomic(..., { publication: true })` receipt and passes it to the
SessionStore acknowledgement only after successful atomic publication.
Failures call the error acknowledgement without a success receipt.

`scripts/verify_launcher_redesign.js` now uses that test writer, awaits strict
SessionStore flush after finishing the synthetic local session, and calls
`verifyPersistence()` before expecting Main to load it. Production writers,
receipts, cache invalidation and persisted formats were not changed.

`tests/launcher/test_ui_publication_fixture.js` passed all three cases locally and on both
native Macs: exact successful publication receipt, failed publication without
a receipt, and a newer accepted mutation surviving an older in-flight write
and being persisted by the final drain.

## History fixture

The local session card fixture now selects the known synthetic session ID,
checks its compact `modes[].local` data, and explicitly rejects leaked
`trackingSource`, `baseline`, `latest` and `localTracking` fields.
`trackingSource` was not restored to production responses.

Native UI assertions passed for complete and partial local cards, supported
counters, field filtering, PNG rendering and account isolation. Protected
HistoryResponse tests passed for compact schemas, filters, calendar data,
cards, detail responses, stale guards, mutation invalidation and bounded
retention. Packaged ZIP and DMG account scenarios both reported compact
contract 1, account isolation PASS and detail stale guard PASS.

## Intel save timing

This was a fixture observation problem. In `launcher.html`, the ordinary save
chain awaits `settings:save-patch`, then clears `settingsSaveInFlight` before
awaiting the subsequent `refresh()`. The old assertion could inspect stale
renderer state during that refresh.

The fixture now follows the existing `verify_settings_autosave.js` pattern:
await `ordinarySaveChain`, observe save and refresh completion, then await a
fresh refresh before asserting the saved value. No arbitrary sleep was added
and no production save behavior was changed. The held-response/newer-draft
case, later save, and clearing the synthetic value passed on native Intel and
ARM. Both complete UI runs passed 29 checks and 36 layout inspections.

## Native instance observation correction

The first ARM run exposed another verification race in
`tests/platform/test_launcher_instance_native.js`: it waited for an immutable window-state
snapshot, captured inside the `second-instance` event, to show a later Cocoa
restore. The helper now requests the actual window state after the event.
It still requires the focus event and a visible, non-minimized primary.
The bounded existing polling helper is retained. Production instance ownership
was not changed. The corrected helper passed on both native architectures.

## Intel acceptance and ARM regression

The same assertions passed independently on each native architecture:

| Check | Intel/x64 | ARM/arm64 |
| --- | --- | --- |
| Fresh ZIP and DMG built from one architecture-specific app | PASS | PASS |
| Mach-O architecture, bundle ID, strict existing signature verification | PASS | PASS |
| Actual ZIP/DMG application payload parity | PASS | PASS |
| ZIP extracted to a path with spaces, alternate working directory | PASS | PASS |
| DMG mounted read-only, app copied, DMG ejected before launch | PASS | PASS |
| Packaged restart, busy persistence/recording, account scenarios | PASS | PASS |
| Default Application Support root and launcher profile | PASS | PASS |
| ZIP -> DMG and DMG -> ZIP preference/profile interoperability | PASS | PASS |
| Paired-copy collision and rapid double launch | PASS | PASS |
| Minimize/Hide preserve proxy; secondary restores/reveals primary | PASS | PASS |
| LaunchServices activation of hidden primary | PASS | PASS |
| Native window Close and Cocoa Close/Quit actions | PASS | PASS |
| Relaunch after exit, child cleanup, unchanged app bundles | PASS | PASS |
| Full UI: 29 checks / 36 layout cases | PASS | PASS |
| Six focused UI suites | PASS | PASS |
| Retained downloadable containers | FAIL: quota | FAIL: quota |

Each default-profile desktop report contains 29 passing checks. Tests used
fresh ephemeral CI users and refused an existing default Fury profile.
Packaged apps ran without `FURY_DATA_DIR` in the default-profile scenarios and
resolved `/Users/runner/Library/Application Support/Fury`, with Electron
`userData` at its `launcher_data` child. Interoperability checked a persisted
synthetic preference in both directions. Additional account/history scenarios
used isolated explicit profiles. No real account credentials were used.

`verify_macos_desktop.js` is test-only: inspector-injected observation and
native Cocoa actions do not add application IPC. External navigation and real
authentication are blocked in the fixture. Its checks propagate failure and
its watchdog stops its owned process groups.

## F7 and protected regressions

Both native hosts passed runtime paths, local listener policy, outbound
Cosmetic Search fixture contracts, explicit standalone bind behavior, accounts,
history contracts/cache, publication reconciliation, package/no-browser hygiene,
single-instance ownership and the new publication fixture checks.

F7 checks covered pending session/history, delayed writes, write failures,
unexpected writer exit, recording footer/closure, staged-auth cancellation,
Stop -> immediate Start, Quit during restart and hung/forced shutdown.
Reconciliation integration checked newer memory, external publication around
shutdown and failure classification. Exact synthetic durable outputs were
asserted; normal and forced outcomes remained distinct.

Representative native launcher test timings, milliseconds:

| Scenario | Intel | ARM |
| --- | ---: | ---: |
| Idle Quit | 400 | 3192 |
| Pending-history Quit | 784 | 406 |
| Recording Quit | 810 | 560 |
| Staged-auth cancellation/Quit | 369 | 209 |
| Stop -> immediate Start | 281 | 79 |
| Deliberately forced Quit | 3276 | 3204 |

The ARM idle sample was slower than the other healthy samples but passed the
existing clean-exit assertions. No timing optimization or F7 change was made.

Local Windows verification passed 19 distinct focused scripts, including the
three new publication cases. No Windows application or installer was rebuilt.

The first broad run
(private-archive Actions run `35507378614`) failed
on Intel at `tests/features/test_quickbuy.js:222` (`disconnected.length` was 1, expected 0).
That test uses real timers, a 150 ms operation budget and 3000 ms total budget.
Its exact failure cause was not established. It subsequently passed unchanged
in isolation on both native hosts. This is an unresolved broad-suite stability
observation, not a production defect fixed by this task. The focused acceptance
run did not claim the original broad suite was wholly green.

## Package parity, hygiene and branding

Payload identity includes relative file paths, SHA-256 content, executable
mode bits and relative symlink targets; container timestamps are not confused
with app-content differences.

| Architecture | Entries | App payload bytes | App payload SHA-256 |
| --- | ---: | ---: | --- |
| x64 | 4424 | 712012548 | `ec0f498cc50b3e766ac8959e54376cb001ce4b0917c1e193bedbb176be400b15` |
| arm64 | 4424 | 704328818 | `67f808d2582efd0d8194c98d0fd7b961e632c6b1c1dd4adcb6259fc758da3f63` |

Both pairs passed current-source/resource allowlists and the negative browser
gate: no NameMC implementation, separate browser, Widevine, or production
Puppeteer/stealth payload. Private accounts/history/settings, auth data,
temporary and development outputs were excluded by the existing gates.
Canonical `assets/fury-icon.png` and production branding resources are included
in source verification; icon/build settings were unchanged. Native screenshot
generation passed, but those screenshots could not be retained either.
No separate Google browser redistribution blocker returns in these payloads.

## Generated artifacts — not retained

These sizes/hashes were generated on native CI from snapshot
`9b9e58979dc734f48a43ee13306b153c9cac76de`. They are **not download links** or
claims of local availability.

| Filename | Exact bytes | SHA-256 |
| --- | ---: | --- |
| Fury-1.0.7-mac-x64.dmg | 159420270 | `7f06fd3a3bf96c5c04db64c64ed6391dd0969e90ce9d68751856a2ba47bf17e6` |
| Fury-Portable-1.0.7-mac-x64.zip | 160469776 | `9ecc4c7e89b9b3330804eb5c1abb17b188b46aba26ac025d0fb23aaf083369da` |
| Fury-1.0.7-mac-arm64.dmg | 152431791 | `d021024cdcfee51d720d3328ead7aef9f018ab103c7ec4b27217914d63d80e4d` |
| Fury-Portable-1.0.7-mac-arm64.zip | 153443101 | `4fab6849b0f9ab988f9087824e8c772480d6acee4a4c0b88271ce7c9f5829709` |

GitHub's final artifact listing for the focused run contains zero artifacts.
All upload attempts reported: "Artifact storage quota has been hit. Unable
to upload any new artifacts. Usage is recalculated every 6-12 hours."
The account owner's cleanup reduced listed repository artifacts from about
2.73 GB to 0.70 GB during the task, but the upload service still refused them.
No unrelated artifacts were deleted or billing settings changed by this task.

The workflow now uploads containers immediately after verified packaging,
before UI checks; retains new containers/reports for 7 days and UI outputs for
3 days; records source SHA; and explicitly fails its final retention gate if
container upload failed. The early upload allows acceptance to continue for
diagnosis, but cannot make the job green without successful retention.

**Required next action:** wait for GitHub's quota recalculation and confirm
sufficient account-wide capacity (the four containers total 625764938 bytes,
plus reports), then rerun native verification from an agreed current snapshot.
Confirm actual artifact creation and download/hash verification. Do not repeat
builds immediately while the upload service still rejects storage.

## Files changed by this task

| File | Responsibility |
| --- | --- |
| `scripts/release_artifacts.js` | Canonical trusted inventory root; containment retained |
| `tests/release/test_release_artifacts.js` | Aliased-parent, root-link and escape regression checks |
| `scripts/test_support/publication_writer.js` | Test-only atomic writer/receipt adapter |
| `tests/launcher/test_ui_publication_fixture.js` | Success, failure and concurrent accepted-state cases |
| `scripts/verify_launcher_redesign.js` | Receipt-aware local fixture, compact selection, actual save completion |
| `tests/platform/test_launcher_instance_native.js` | Observe completed Cocoa restoration instead of a frozen event snapshot |
| `scripts/verify_macos_desktop.js` | Fresh CI default-profile, paired-copy and native lifecycle verification |
| `scripts/verify_macos_dmg.js` | Eject before launch; run paired native desktop checks against actual containers |
| `.github/workflows/portable-macos.yml` | Protected tests, default-profile acceptance and explicit private retention gate |
| `docs/MAC_NATIVE_VERIFICATION_REVISIONS.md` | Results, source boundary and unresolved retention |

The isolated diagnostic branch additionally contains
`.github/workflows/macos-verification-revisions.yml`: the same builders and
acceptance gates, focused prerequisite tests, and a separately reported
unchanged Quick Buy recheck. It was not installed as a second production
packaging architecture or merged into the main branch.

## Protected architecture

This task changed no production application code, dependency lockfile,
persistence schema, compact payload, storage/migration, F7 coordinator,
listener binding, outbound backend behavior, browser-removal policy, branding,
release targets or signing configuration. The concurrent Gambler George edit
described above is preserved and separately attributed. Native payload source
digests match the accepted post-NameMC application snapshot.

## Remaining manual Mac checks and release blockers

- Physical Cmd+W/Cmd+Q and literal Dock clicking remain final manual checks;
  underlying native window, Cocoa menu and LaunchServices actions passed.
- Physical display/GPU and security-software behavior remain hardware checks.
  Broad UI CI used the existing SwiftShader test setup; default-profile tests
  used normal packaged launch behavior.
- Developer ID signing, hardened-runtime acceptance, notarization, quarantine
  and Gatekeeper/public-download trust remain untested. Existing ad-hoc strict
  signature checks do not establish public distribution trust. No security
  controls were removed to run these diagnostic builds.
- Artifact retention remains an external release-engineering blocker, not a
  manual Mac lifecycle failure. A fresh retained build must also include or
  explicitly exclude the concurrent source change in its recorded snapshot.
- The unrelated Quick Buy full-suite failure needs separate stability review;
  unchanged isolated native rechecks passed.
- Deferred Windows UAC/elevation, alternate-admin ownership, protected/Program
  Files installation, default AppData, installer/portable interoperability and
  security-software acceptance remain outstanding.

No signing, notarization, update, website or publishing work was performed.
