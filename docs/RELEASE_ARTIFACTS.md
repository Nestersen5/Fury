# Fury release artifacts

Packaging produces these six versioned downloads. It does not publish them or
establish public distribution trust.

| Platform | Distribution | Filename |
| --- | --- | --- |
| Windows x64 | NSIS installer | `Fury-Setup-<version>-win-x64.exe` |
| Windows x64 | Extract-once portable ZIP | `Fury-Portable-<version>-win-x64.zip` |
| macOS Intel | Drag-to-Applications DMG | `Fury-<version>-mac-x64.dmg` |
| macOS Intel | Portable ZIP | `Fury-Portable-<version>-mac-x64.zip` |
| macOS Apple Silicon | Drag-to-Applications DMG | `Fury-<version>-mac-arm64.dmg` |
| macOS Apple Silicon | Portable ZIP | `Fury-Portable-<version>-mac-arm64.zip` |

Windows ZIP users extract the entire archive once and run `Fury.exe`. Keep the
included files and directories together. This is not a self-extracting portable
EXE. Portable describes application installation, not portable user data.

All Windows distributions use `%APPDATA%\Fury`, resolved through Electron, with
Electron's profile in `launcher_data`. All packaged Mac distributions use
`~/Library/Application Support/Fury`. Existing absolute `FURY_DATA_DIR` overrides
remain supported. No packaging target changes storage or migration behavior.

## Build the shared application and its containers

Use the locked development dependencies and the native target OS:

```text
npm run package:win
npm run package:mac -- --arch x64
npm run package:mac -- --arch arm64
```

`package:mac -- --all` builds the two architectures separately. It does not build
a universal app or establish native runtime coverage of a different CPU.
`FURY_RELEASE_DIR` overrides the output directory. Existing defaults remain
`%LOCALAPPDATA%\Fury\release` on Windows and `release/mac-portable` on Mac.

Windows builds NSIS and `win-unpacked`, then
creates the ZIP with electron-builder's `--prepackaged` pointing to that same
directory. The order allows NSIS to add its application helper before the ZIP
reads the payload. No installer hook runs when launching the extracted ZIP.

Mac requests ZIP and DMG in one
electron-builder invocation for each architecture. Both containers use the same
`Fury.app`. The DMG contains the app and an Applications link. Production icons
remain `assets/fury-icon.ico` and `assets/fury-icon.png`.

Use the wrapper commands above for verified releases, rather than invoking
electron-builder directly. They always disable publication and fail on a
source, architecture, hygiene or paired-payload verification failure.

## Content and native verification

After container creation, `scripts/verify_release_pair.js` extracts NSIS without
installing it, extracts ZIPs, and mounts DMGs read-only. It compares every
application file by path, size and SHA-256. On Mac it also compares executable
bits and contained symbolic links, checks Mach-O architectures and bundle ID,
and verifies the existing code signatures. It checks the source allowlist and
absence of removed browser/Puppeteer payloads in both copies. Reports are `PAIR-<os>-<arch>.json`.

```text
npm run test:packaging
node scripts/verify_windows_portable.js <portable.zip> <runtime-report.json>
node scripts/verify_packaged_runtime.js <extracted-Fury.app> <runtime-report.json>
node scripts/verify_macos_dmg.js <release-directory> <x64|arm64>
```

These native runtime harnesses use temporary synthetic profiles, a different
working directory, and test-only authentication/navigation seams installed
before Main executes. They never initiate Microsoft login. They exercise the
real packaged launcher, proxy, persistence, recording and service processes.
The Windows ZIP harness denies writes to the extracted application tree and
restores the test directory's original ACL afterward. Resource hashes must
remain unchanged. No installed Fury instance or real user profile is used.

The `Fury macOS distributions` workflow uses separate native Intel and ARM
runners. It verifies both containers, executes the extracted ZIP and a copy
from the mounted DMG, and preserves reports. Its launcher UI verification
explicitly skips the old real-auth subtest; mocked onboarding coverage remains.
Native acceptance is established only by a successful run on the stated CPU.

## Local metadata and trust boundary

`release-metadata.json` always describes all six slots with version, OS,
architecture, distribution, format and filename. Available files also have byte
size and SHA-256; missing files have `available: false` and null size/hash.
No public URLs are invented. After collecting outputs from separate machines,
regenerate one manifest with:

```text
node scripts/release_artifacts.js <combined-artifact-directory>
```

Metadata records local file presence, not passing runtime verification. Pair and
runtime reports are separate evidence. Do not combine different source builds
merely because their version strings match; compare the source digest in the
pair reports. The later publishing workflow must validate completeness and
assign URLs. Existing website staging scripts are not the publishing contract
for these new filenames.

Publication tooling is maintained separately from the public application source.
It validates this metadata and the three pair reports before publishing.

The launcher's update check does not read this metadata. It reads a separate
one-object manifest describing only the latest public version and the download
page, published after these artifacts exist and are verified. That contract is
`docs/UPDATE_NOTIFICATIONS.md`; per-distribution records stay here.

Production signing/notarization is a separate release step. Preserve the
existing settings until that work is approved. Windows application and installer
signatures, nested Mac code (including Electron helpers), Developer ID trust,
notarization/stapling, Gatekeeper and antivirus acceptance still require their
own verification. A successful package or local signature-consistency check
does not establish public distribution trust.

## Automation dependency ownership

NameMC lookup/history is no longer a Fury feature. No separate Chrome/Chromium
browser is prepared or distributed. Puppeteer is development-only for existing
launcher/UI verification; it and its browser downloads must not enter any
application payload. `scripts/verify_no_browser.js` enforces that boundary after
packaging and during paired-artifact verification. Electron still includes its
own Chromium runtime and required notices. No existing user caches are deleted.
