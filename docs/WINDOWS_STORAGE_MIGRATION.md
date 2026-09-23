# Windows storage migration (F1/F2)

Packaged Windows Fury resolves `app.getPath('appData')/Fury`. With the normal
Windows roaming profile this is `%APPDATA%\Fury`. Electron's `userData` and its
default `sessionData` remain inside `Fury/launcher_data`. The installed version
and a future portable version use the same resolver; artifact type is not an
input. Application removal/replacement never owns this directory.

Packaged macOS still resolves `app.getPath('appData')/Fury`, normally
`~/Library/Application Support/Fury`. Development retains the project root.
Absolute `FURY_DATA_DIR` overrides retain their behavior. An override equal to
the canonical Windows location still honors pending maintenance. Windows
discovery never runs on macOS or in development.

## Inventory and profile policy

`src/storage/migrationInventory.js` is the explicit version 1 allowlist. It
preserves settings/API keys; presets; session history; clips; aliases/denicks;
ranks; cosmetic signatures, profiles, datasets, models and their named backup;
own cosmetics and kill-message patterns; anticheat history; the selected logs;
`auth_tokens`; `recordings`; `packet_logs`; `diagnostics/teams`; Quick Buy
presets; the mutable cosmetic effect library and population baseline.

The durable `launcher_data` subtree includes profiles, viewed and removed
accounts, reminders, inactive `auth_backup_*` directories, Chromium Local State,
localStorage/LevelDB journals and cookies. Backups are not promoted into live
authentication. Copied file modification times preserve auth-cache recency.

Excluded: `auth-staging`, skin cache, disposable Chromium caches/Crashpad,
Chromium singleton/LOCK files, atomic `.tmp`/`.partial` files, application code,
dependencies and everything outside the allowlist. Durable LevelDB `.log` files
are included. Selected optional caches/logs are copied conservatively; a read
failure in any selected file aborts preservation.

An absent or empty canonical directory receives the complete selected profile.
A nonempty canonical directory is authoritative. Identical contents are
recognized; different or partial profiles are never merged. The full legacy
snapshot is retained separately, so an old token cannot resurrect an account
deleted from the canonical profile. Multiple different legacy profiles are all
preserved without choosing an arbitrary account/profile to activate.

## Transaction and recovery

Maintenance uses `%APPDATA%\.Fury-migration-v1`; it is a recovery area, not an
alternative active data root. Each deterministic transaction ID binds the
inventory, source path, version and owning Windows SID. A transaction contains:

- `payload/`: selected file bytes, copied through partial files and verified;
- `ready.json`: versioned manifest published only after source recheck and
  snapshot verification;
- `activation/`: an interrupted publication may leave a retryable second copy;
- `receipt.json`: completed outcome; an applied transaction is never replayed
  over subsequent account deletions or profile changes.

Publication uses a verified second copy and a same-volume directory rename.
Existing canonical data is never overwritten. Conflicts remain in `payload/`
with a `preserved-conflict` receipt. Recovery is a deliberate whole-profile
operation; do not combine authentication or profile JSON files manually.

`pending.json` takes precedence over completion. `complete.json` also records
the no-legacy result, so normal startup does not keep scanning old installs.
A held `busy` file coordinates maintenance only. A crashed holder releases its
Windows handle; the next maintenance attempt can recover it. Ready snapshots
without a receipt are recovered before completion. Source directories are
never deleted by the migration engine.

Files are SHA-256 verified, and file/manifest writes are flushed before rename.
This covers process interruption/retry; it is not a claim of power-loss atomicity
for every Windows filesystem. Limits are 100,000 files/64 GiB per selected
inventory, bounded traversal depth, 250,000 entries in an install-tree reparse
check, 64 retained transactions and a 30-minute maintenance worker budget.
Exceeding a limit aborts the upgrade for manual preservation; it never prunes
valuable snapshots automatically.

Free-space admission requires approximately `2 × selected bytes + margin`, with
margin `max(64 MiB, 5% of selected bytes)`. This covers snapshot plus publication
while the old data still exists. The installer separately needs space in its
temporary extraction area and new installation directory. Retained recovery
copies consume approximately one extra selected payload after success.

## Installer ordering and writer exclusion

`build/installer.nsh` uses electron-builder's supported `customHeader` hook to
declare a mandatory hidden section **before** the template's install section.
The locked builder calls `uninstallOldVersion` inside that later section;
`customInstall` alone would be too late to preserve legacy data.

The gate resolves HKCU/HKLM `InstallLocation`, with the previous uninstaller's
quoted path as fallback, and checks the chosen new directory as well. NSIS
holds existing Fury executable handles without read sharing, but with delete
sharing, through replacement. This blocks legacy relaunch while permitting
the old uninstaller's rename/removal. Handles close after installation or on
installer process exit. A silent parent that must elevate delegates this gate
to the elevated inner instance, before that instance can remove anything.

The new embedded application archive supplies the trusted Electron runtime and
helper. It runs before old removal, without relying on system Node, the old
application's code or installer-created environment variables. RunAsNode must
be deleted (not set to an empty string) when starting the Electron host. The
host subsequently uses its own runtime in Node mode for the transaction worker.
Archive embedding matches the builder's existing compression setting so NSIS
can reuse the embedded payload.

The PowerShell guard rejects active Fury processes and matching Node/Electron
writers, holds selected source files against writes/replacement, and verifies
the NSIS executable leases. It never force-kills product processes. Normal
startup honors the maintenance marker before loading persistent modules or
creating Chromium state. These checks do not change Fury shutdown or its
ordinary multiple-instance behavior.

Any ownership, sharing, link, read, write, space, mutation or verification failure
returns a failed gate. NSIS exits with code 70 **before invoking the previous
uninstaller**. The error includes a fixed safety code and tells the user to
retain the old installation, close writers, check space/permissions and retry
under the profile owner. Verification/ownership failures may require manual
recovery; repeated retries do not authorize deleting the original data.

## Ownership and credentials

The guard uses the current Windows token SID and the interactive desktop's
Explorer owner SID. Legacy selected files must belong to that SID. Different
UAC credentials, shared profiles, group-owned legacy data or an unavailable
desktop identity are ambiguous and fail closed. An elevated process does not
infer ownership from `%USERPROFILE%` or silently copy another user's credentials.

The recovery directory is created with a private inheritable current-user/SYSTEM
ACL. Files are copied as data; no legacy executable is run. An existing recovery directory
with grants to other users/groups is rejected rather than inheriting public
permissions onto preserved credentials. Windows administrators and SYSTEM
remain within the OS administrative trust boundary. Selected hard links are
rejected. The entire installation is checked for junctions/reparse points
before destructive upgrade participation, including
excluded application/cache subtrees. Tokens are never parsed, merged or logged.
DPAPI-bound Chromium state remains with the same Windows SID; credential storage
itself is unchanged.

Normal uninstall retains the canonical directory. No remove-my-data option,
portable packaging, DMG target, updater or signing change is part of this work.

## Verification commands and limits

Run `npm run test:storage-migration` for isolated transactions, Windows ACL/process
checks and the hidden Electron localStorage/cookie relocation fixture. Existing
runtime-path tests cover absolute overrides and child-service inheritance.

`node scripts/verify_windows_storage_installer.js <win-unpacked>` builds and runs
real NSIS fixtures with a separate random registry GUID and synthetic AppData.
The fixture entry point runs the production maintenance bootstrap and storage
loaders without starting proxy/network services. It records entry into the old
uninstaller, verifies pre-removal preservation, exercises changed paths with
spaces, failed mandatory reads, reinstall and normal uninstall. A supplied
third argument can repeat a validated synthetic sandbox. Generated artifacts
and synthetic recovery data stay outside the repository for inspection.

This is not a test against a real user's production identity. UAC under another
account, actual HKLM/all-users installs, Program Files installation, redirected
roaming profiles, another installation volume, antivirus interference and abrupt
machine power loss still require controlled manual verification. Read-only ACL
tests establish source-read/destination-write behavior, not every UAC scenario.
Mac path tests establish unchanged resolution; they are not native Mac runtime
verification. The Electron storage probe does not measure full launcher UI
startup.

## Verification record (2026-09-19)

- 32 transaction/path cases passed, including actual worker exit after
  publication, auth-cache timestamps, conflicts, source mutation, staging
  tampering, space admission, links and account-removal preservation.
- 13 Windows guard cases passed using Electron's Node runtime, including
  read-only source ACLs, unreadable required data, unwritable destinations,
  unsafe recovery ACLs, active writers, Unicode paths, both uninstaller mode
  flags in registry fallback, and private credential-copy permissions.
  Changing a fixture to an alternate Windows owner was skipped because the
  non-elevated test token lacked the necessary privilege. This does not certify
  actual HKLM or alternate-user UAC behavior.
- Electron 42.1.0 retained synthetic localStorage, a persistent cookie and the
  correct `sessionData` after relocating the profile and initializing through
  a temporary maintenance profile.
- Real NSIS fixtures with a separate registry identity passed a required-read
  failure gate, retry, changed-directory upgrade with spaces, production
  settings/session reads, reinstall with an account deletion, and normal
  uninstall. The old uninstaller recorded canonical data already present on
  entry. A separate normal-uninstall check confirmed the entire application
  directory was removed while canonical bytes were unchanged.
- Runtime paths, launcher accounts, connection authentication, reminders,
  atomic files, launcher dependencies, portable-package checks and release
  hygiene checks passed. Windows targets, Mac configuration and dependencies
  remained equal to the starting working-tree configuration.
- The final unsigned NSIS verification artifact is 135,792,088 bytes; its
  packaged tree matches all 226 current production runtime files. It was not
  installed against the real production registry identity or real user data.

The synthetic 8 MiB/128-file transaction took approximately 4.3–6.7 seconds
across runs (some concurrent with packaging). The completed-maintenance check
was approximately 0.6–0.7 ms median, under 0.85 ms at the 95th percentile. Its
space admission was 80 MiB: two payload copies plus the 64 MiB minimum margin.
The native upgrade took approximately 102 seconds including extraction,
preservation and application replacement. The subsequent Electron storage
probe took approximately 380 ms; this is not a full launcher UI startup result.

Recommendation: **PARTIAL KEEP**. Retain the implementation and tests; perform
the controlled UAC/HKLM, protected installation, dedicated-account sign-in and
full launcher smoke checks before treating the Windows release as certified.
