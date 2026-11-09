# Windows installer updates

Installed Windows x64 copies can download and install an update from the existing
What's new sidebar control. Downloads and installation both require a player
action. Closing Fury normally never installs a cached update. Portable Windows,
macOS and development copies retain the official website download action.

## Runtime ownership

`windowsInstallation.js` compares the resolved running executable with the
current-user or machine NSIS InstallLocation for the existing Fury installation
GUID. A ZIP beside an installation does not qualify. Failed or ambiguous reads
fall back to manual downloads. No app-directory marker or separate payload is
added; installer and ZIP continue sharing one application payload.
An absolute data-directory override remains supported. An override inside the
application installation itself cannot qualify for in-app updating, since NSIS
would remove that directory. Fury leaves its files and location untouched.

The existing deferred schema-1 latest.json check remains the announcement source.
An eligible copy with a newer offer reads one bounded, versioned
`https://downloads.furyproxy.online/releases/<version>/windows-update.json`.
`windowsUpdateMetadata.js` allowlists its exact installer filename, version,
size (at most 2 GiB), SHA-256, SHA-512 and publication date. Remote data cannot
choose an arbitrary executable URL, path or command. Missing metadata leaves the
website action available and does not interrupt startup.

`windowsInstallerUpdates.js` owns state, cancellation, revisions and installation.
Only the launcher main frame can use its IPC. The renderer receives a compact
projection without local paths. Progress publishes only changed whole
percentages; there is no update polling loop or history/state refresh hook.

`windowsUpdaterAdapter.js` lazily loads the pinned electron-updater 6.8.12 NSIS
implementation with its public custom-provider API. The provider returns only
Fury's validated metadata. Automatic download, install-on-quit, prereleases,
downgrades and web installers are disabled. Differential downloads reuse the
previous installer's bytes and fetch changed ranges using the two versions'
fixed installer blockmap URLs. R2 requests use single ranges, not multipart
ranges. Missing maps, an unavailable old installer or failed reconstruction
fall back to the full installer; final size and SHA-512 verification still apply.
The standard
per-user updater cache is separate from accounts and settings. Clicking Download
after a later launch revalidates and reuses a valid cached installer; it does not
automatically start a download during startup. Cache handling belongs to the
updater, including removing mismatched pending files.

Fury verifies actual file size and a streamed SHA-512 after download and again
before installation. A changed or damaged cached installer offers a fresh
download without starting shutdown. Installation also rechecks the registered
executable and the current announcement without using a cached response. A withdrawn version
loses its in-app install action. Network errors retain the downloaded update for
an explicit retry. Checksums and HTTPS establish consistency with the hosted
release; current unsigned Windows releases do not gain publisher authentication
or guaranteed warning-free installation from this feature. Existing/future
packaged publisher configuration remains enforced by electron-updater.

## Shutdown and user data

An explicit Restart and update invokes the existing requestQuit owner.
Before shutdown, a read-only process-family check keeps Fury open if another
Fury copy is running or its absence cannot be verified. It never stops another
process. The current launcher's own renderer and service children are allowed.
Accepted renderer saves, persistence, authentication cancellation, recordings and owned
services drain before the installer handoff. A forced/unclean shutdown cannot
invoke it. Normal relaunch and update installation are mutually exclusive.
The instance lock remains held until the old launcher exits.

The NSIS preservation section waits up to 30 seconds for the old launcher PID
before taking its existing executable leases and running the storage guard.
It does not kill the parent. Failure stops before old-version removal.

Updates retain `%APPDATA%/Fury`, Electron's launcher_data, auth_tokens and an
absolute FURY_DATA_DIR override. They do not clear logins, preferences or history.
Microsoft can independently require renewed authorization. Restarting disconnects
Minecraft; reopening Fury does not reconnect the Minecraft client automatically.

Windows NSIS and ZIP now share an archived `resources/app.asar` application
payload, reducing the individual files the installer extracts and removes. Mac
packaging remains unchanged. Electron's bundled Node mode reads service and
worker code directly from the archive; the PowerShell storage guard alone stays
outside it in `app.asar.unpacked`. Preservation still runs from the new embedded
runtime before old-version removal. Package verification checks both archive
contents and unpacked files, including source parity and private-file exclusions.

Before handoff, Main atomically records only the old and intended versions in
`launcher_data/windows-update-attempt.json`. On the next eligible launch it
compares that intent with the actual running version, clears a completed attempt
and explains an update that did not apply. This never automatically downloads or
installs anything. Shutdown that never invokes its handoff is not reported as a
successful installation. Adapter errors are retained as sanitized diagnostic
codes, and synchronous installer errors propagate. NSIS launches the executable
just installed directly instead of a potentially stale shortcut; Windows update
launches explicitly show/focus the completed replacement window.

## Presentation

The existing button shows availability, download progress, retry and restart
states using Fury's theme/accent. Hover/focus reveals the preview; activation
pins it and moves keyboard focus into it. It remains open while being read.
Escape, outside click, Close and Later dismiss it. A window-bounded top-layer
popover avoids clipping by the sidebar. Only notes scroll; controls stay visible.
Full changelog uses the existing dialog with the same notes and fixed actions.
Reading or dismissing a release notice does not revoke update eligibility.

## Publication and first activation

PREPARE computes the Windows metadata from the actual installer bytes, binds it
to the approval token and includes it in the review bundle. PUBLISH checks its
immutability, uploads it with the six containers, verifies its size/hash and
public JSON response, and advances latest.json only after every download is
available. Rollback can still restore older manifests without updater metadata.
No extra user distribution is introduced, and build commands never publish.

**Deployment prerequisite:** publish the updater-capable release and versioned
metadata through the reviewed release workflow. Existing users must manually
install their first updater-capable version. Source changes alone activate no
online update and do not choose or bump a release version.

New Windows builds must also carry `Fury-Setup-<version>-win-x64.exe.blockmap`.
PREPARE binds this supporting file's bytes and SHA-256 to the approval token and
checksum list; PUBLISH checks immutability, uploads it and verifies its public
size before advancing latest.json. It is not another distribution slot. The
schema-1 installer metadata remains compatible with existing clients. Historical
releases without blockmaps retain full-download fallback. Existing full-download
clients still download the first compact release in full; later updates can use
differential downloads. The amount saved depends on the actual release changes.

## Verification

- `npm run test:updates`: unit/network/publication contracts and isolated real
  Electron presentation (including the manual-download fallback).
- `node tests/integration/test_shutdown_launcher.js --updates-only`: real Main
  clean/forced shutdown with installer handoff observation.
- `node scripts/verify_windows_installer_updates.js <fresh-win-unpacked>`:
  real electron-updater download and real NSIS old-to-new installation using a
  random registry GUID, temporary appData/cache, synthetic credentials and a
  loopback feed. Shortcut names also use the random fixture identity, and no
  desktop or Start menu shortcut is created. Fixture uninstallers disable
  process-name killing; the controller only stops its own processes. Never run
  against an actual profile.
  The copied fixture's Fury process guard is limited to its temporary tree so
  an unrelated real Fury can keep running. Selected-installation writer, file
  lease, owner and data-preservation checks remain. Production's conservative
  global Fury-process guard is unchanged and blocks updates while another copy
  is running.

The native fixture verifies exact settings, cached sign-in bytes, history,
recordings and Chromium preferences, without contacting Microsoft. It does not
prove acceptance of a real Microsoft token, public CDN behavior or an elevated
per-machine upgrade. It explicitly shows its own launcher and refreshes once so
silent-installer visibility does not gate test readiness.
