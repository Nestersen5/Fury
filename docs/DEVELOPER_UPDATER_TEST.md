# Private developer updater test

This is an opt-in local test, requested for the normal development profile.
It publishes nothing online and changes no official version or release notes.
Automated verification uses temporary synthetic profiles; the manual pilot uses
the existing development profile with the developer's explicit authorization.

The desktop **Fury (Development)** shortcut temporarily opens an installed
developer build. It uses the same `FURY_DATA_DIR` and `launcher_data` as the
source launcher, so accounts, settings, history and appearance stay in place.
The original shortcut is backed up before replacement.

## Try the update

1. In **Dev test 1**, click **Update available** at the bottom left.
2. Click **Download update**. This downloads the actual full Windows installer
   from a server bound only to `127.0.0.1` on this machine.
3. Click **Restart and update** when ready. Fury saves and stops its services,
   the installer replaces the developer program, and Fury opens again.
4. In **Dev test 2**, click **Potato check** in the top bar. The message says
   “Your proxy is officially potato powered.”

The first installer contains no Potato button. The second contains the new
button code. Neither installer nor the test feature enters a normal release.
The versions have explicit `+developer.updater.1` and `+developer.updater.2`
labels and a separate NSIS registration/shortcut identity.

This exercises the real download, checksum, eligibility, process-family,
shutdown and NSIS installation paths. The generated developer bootstrap routes
only these private builds to the loopback feed. Production release URLs and
storage/process guards are unchanged. The test records release-notice choices
in a separate `developer-update-demo.json` file.

## Return to the source launcher

From the repository in PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\output\developer-updater-demo\restore.ps1
```

This requests a normal close of the private launcher, stops its feed, restores
the original **Fury (Development)** shortcut and opens the source version.
It keeps the current profile; it does not overwrite newer settings/history with
the backup.

## Local files and verification

`output/developer-updater-demo/` contains both installers, the local feed
configuration, launch/restore scripts, original shortcut and verification
reports. The `profile-before-demo` snapshot checksum-verifies settings, saved
accounts, history and Chromium preferences. Recordings and packet logs remain
in their original location. The snapshot contains private data: keep it local.

The feed survives the update restart and exits after a normal close/F7 of the
test launcher. The development shortcut starts it again when needed. GUI launch
scripts explicitly remove an inherited `ELECTRON_RUN_AS_NODE` flag.

`scripts/development/windows_update_demo.js prepare <fresh-win-unpacked>` builds
the private installers without publishing. `serve` runs the loopback feed;
`write-launchers` regenerates the private PowerShell helpers. `prepare --rebuild`
is for a closed, stopped, unpublished test only; never rebuild an installer
while a user is downloading or installing it.

Verification confirms that the first installed build offers the update without
the button, and the second build's visible button displays its toast. These UI
checks use synthetic profiles. Live activation confirms the existing profile
path and saved account files; the developer performs the final download and
restart using the controls above.
