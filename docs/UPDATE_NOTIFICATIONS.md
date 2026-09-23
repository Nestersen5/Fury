# Fury update notifications

Fury tells a player that a newer public release exists and offers to open the
official download page. It is not an updater. Fury never downloads, installs,
replaces, restarts into or executes a release on the player's behalf, and the
remote manifest cannot make it do so.

## Where checking runs

Main owns the check. `src/updates/updateNotifications.js` builds one service per
launcher session through `createUpdateNotifications`, and `launcher.js` creates
it lazily behind the `updates:check` and `updates:open` launcher requests. Both
requests are rejected unless they come from the launcher window's main frame.
The renderer side is `src/launcher/renderer/launcher_updates.js`, mounted from
`launcher.html` after `DOMContentLoaded` alongside the other launcher renderer modules.

Nothing in launcher startup, proxy startup, account loading, history loading or
renderer readiness awaits the check. The renderer schedules a single deferred
task once it is already interactive, sends one `updates:check`, and forgets it if
it fails. There is no refresh hook, no visibility-driven recheck and no polling
timer; a launcher session performs at most one manifest request.

The installed version is always `app.getVersion()`, which is the packaged
application's version from `package.json`. No other runtime file carries it.

## Manifest contract

The service reads one small static JSON document. Schema version 1:

```json
{
  "schemaVersion": 1,
  "latestVersion": "1.0.8",
  "releasePageUrl": "https://furyproxy.online/",
  "releasedAt": "2026-09-20T12:00:00Z",
  "summary": "Optional one-line plain-text release note.",
  "minimumSupportedVersion": "1.0.0"
}
```

| Field | Required | Rules |
| --- | --- | --- |
| `schemaVersion` | yes | Number, exactly `1`. Anything else is unsupported and ignored. |
| `latestVersion` | yes | Stable `MAJOR.MINOR.PATCH`, no leading zeros, optional `+build` metadata. |
| `releasePageUrl` | yes | Must equal the configured Fury download page exactly. |
| `releasedAt` | no | Strict `YYYY-MM-DDTHH:MM:SSZ` that round-trips as a real UTC instant. |
| `summary` | no | Plain text, 280 characters maximum, no control characters. |
| `minimumSupportedVersion` | no | Stable version, not newer than `latestVersion`. Reserved for later use. |

Unknown top-level fields are rejected rather than ignored, which keeps the
six-artifact release metadata out of this document. Per-distribution records stay
a separate release concern in `release-metadata.json` and the website's own
`downloads-config.js`; the launcher never needs them.

## Manifest location

`src/updates/releaseConfig.js` holds the two release URLs. `downloadPageUrl` is
the established Fury download site, `https://furyproxy.online/`, the page the
website already serves the six downloads from.

`manifestUrl` is `https://furyproxy.online/latest.json`, published by
by the separate release publisher as the last step of a release. A packaged build only
accepts a manifest URL that is HTTPS and shares an origin with `downloadPageUrl`;
environment variables cannot repoint a packaged build.

Until the first release publishes that file, the request returns 404 and the
check stays silent like any other failure, so shipping this configuration ahead
of the manifest is safe. Publication ordering is what guarantees a client is
never told about a release before its downloads exist.

## Version comparison

`stableVersion` parses only stable SemVer: three non-negative integers without
leading zeros, optionally followed by `+build` metadata, within the safe integer
range and at most 64 characters. Comparison is numeric, field by field, so
`1.0.8 > 1.0.7`, `1.1.0 > 1.0.99`, `2.0.0 > 1.99.99` and `1.0.10 > 1.0.9`. Build
metadata carries no ordering weight.

Fury has no prerelease channel, so a prerelease string such as `1.0.8-beta.1` is
not a version here at all. A prerelease `latestVersion` fails validation, and a
prerelease installed version stops the check before any request, so a stable user
can never be notified about a prerelease build. Malformed versions on either side
behave the same way: the session produces no offer.

## User experience

When `latestVersion` is newer than the installed version, the renderer shows one
notification through the existing launcher notification centre
(`window.FuryNotifications`), the same surface every other launcher message uses.
It is a persistent `info` toast the player dismisses themselves, titled
`Fury <version> is available.`, with kicker `Fury update` and the manifest
summary as its detail. The only new presentation is
`.notification-update-action`, a standard `primary` button laid out inside the
existing `.notification-copy` grid.

The current redesign styling renders `info` toasts as a single title line: the
kicker is hidden, and the detail line is shown only for error and warning
notifications. The update toast follows that rule rather than carving out an
exception, so a player sees the title and the action button. The summary still
reaches the toast's accessible name and hover tooltip, exactly as it does for
every other launcher notification that carries a detail.

`View update` calls `updates:open`, and Main opens the configured download page
with `shell.openExternal`. No URL from the manifest or the renderer reaches the
system browser. Nothing downloads, and the launcher does not choose between the
six artifacts; the website presents those choices.

If the window is hidden when the offer arrives, the notification waits for the
next `visibilitychange` rather than appearing behind the player's game.

There is no manual "Check for updates" control. The launcher has no About or
version surface today, so adding one would mean inventing a settings area this
feature does not need; the automatic check already covers the approved behavior.

## Failure behavior

Every failure is silent. Offline, DNS failure, connection refused, timeout,
non-200 status, wrong content type, oversized body, malformed JSON, unsupported
schema, bad field types and unexpected fields all resolve to "no offer", and the
launcher continues normally. There is no retry, no backoff loop and no
user-facing startup error; a session whose single check fails stays quiet until
Fury is restarted.

Renderer failures are equally contained: a rejected `updates:check`, including
the `Fury is stopping.` rejection raised during shutdown, is swallowed.

## Session deduplication

The service memoizes its single check and marks the first successful offer as
claimed. Repeat `updates:check` calls, including calls after a renderer reload,
return nothing, so one launcher session shows the notification at most once. A
dismissed notification stays dismissed for that session. There is no persistent
"ignore this version" state, because Fury has no existing pattern for one.

`dispose()` aborts any in-flight request and suppresses late offers when the
application quits.

## Security

The manifest is untrusted input.

- The response must be HTTP 200 with an `application/json` content type.
- The body is capped at 8192 bytes, enforced both from `Content-Length` and while
  streaming.
- Redirects are never followed.
- The document must be a plain object with schema version 1 and only allowlisted
  fields, each type-, format- and length-checked.
- `releasePageUrl` must parse, be HTTPS, carry no credentials, query or fragment,
  contain no whitespace or control characters, and match the configured download
  page exactly. That rejects `javascript:`, `file:`, plain HTTP and lookalike
  hosts.
- The action opens the fixed configured page, not the manifest's value, so even a
  fully attacker-controlled manifest cannot choose a destination.
- Nothing in the manifest is executed, written to disk, used as a path, or used
  to alter Fury's configuration. The only observable effects are one notification
  title, one plain-text detail line and one fixed URL.

Fury's first public releases may be unsigned. The notification makes no claim
about signing, notarization or trust, and the application contains no guidance
for bypassing operating-system security warnings.

## Privacy

The check is an anonymous GET for a static document. The request carries only
`Host`, `Connection` and `Accept: application/json`. It does not use Electron's
session or cookie jar, sends no cookies, credentials, authorization headers,
query parameters or request body, and reports no account identity, Minecraft
identity, token, history, machine or hardware identifier, operating system,
architecture or Fury version. Version comparison happens entirely on the client.

## Cross-platform behavior

There is one implementation. The Windows installer, Windows portable ZIP, macOS
Intel DMG and ZIP, and macOS ARM DMG and ZIP all run the same Main service, read
the same manifest, compare the same `app.getVersion()` and open the same download
page. Nothing branches on platform, architecture or distribution format, and no
artifact filename appears in the launcher.

## Development behavior

Unpackaged development runs never contact production. `isPackaged === false`
requires both `FURY_UPDATE_TEST_MODE=1` and a `FURY_UPDATE_TEST_URL` pointing at
loopback HTTP (`127.0.0.1` or `[::1]`); anything else is refused, and without the
override no request is made at all. Packaged builds ignore both variables.

`scripts/verify_update_notifications.js` uses that override to exercise update
available, up to date, malformed manifest, timeout and development-disabled
against a local fixture server, with real Electron, real IPC and the real
renderer, and with external opening and downloads blocked.

## Performance

One deferred renderer task, one IPC round trip and at most one HTTP GET per
launcher session. The request uses a 3000 ms deadline, an unreferenced socket and
no keep-alive agent, so it can never hold the event loop or delay quitting.
Retained state is one small object holding a resolved promise, three booleans and
an `AbortController`. No timers, observers or refresh hooks are added, and the
existing launcher refresh cadence is untouched.

## Publishing contract

The later Cloudflare/website task publishes one document:

- **Path:** `https://furyproxy.online/latest.json`, served from the same static
  site and origin as the download page.
- **Schema:** exactly the schema version 1 document above. `latestVersion` must be
  the stable version the six artifacts were built from, and `releasePageUrl` must
  be `https://furyproxy.online/` character for character.
- **Content type:** `application/json`. The response must stay well under 8192
  bytes and must not redirect.
- **Cache:** short and revalidating, on the order of five to fifteen minutes, so a
  rollback takes effect quickly. It must not be cached for the lifetime of a
  release and must not be immutable.
- **Ordering:** the manifest is published **last**.

  ```text
  upload artifacts
  -> verify artifacts
  -> update website/download destinations
  -> verify downloads
  -> publish latest.json
  ```

  Clients must never learn about a release before its downloads exist. Bumping
  `latestVersion` before the website serves that version is the one failure this
  ordering exists to prevent.
- **Rollback:** republish the previous `latest.json` body. Because the launcher
  only compares versions and never stores the manifest, lowering `latestVersion`
  immediately stops new notifications; sessions that already saw the old offer
  keep their dismissible notification and nothing else changes. Do not delete
  downloads a published manifest still points at until the lowered manifest has
  outlived its cache lifetime.

Nothing in this feature deploys Cloudflare, modifies the live website or
publishes a release.

## Verification

```text
node tests/release/test_update_notifications.js
npm run test:updates
```

The first is the unit and network contract suite and runs inside `npm test`. The
second adds `scripts/verify_update_notifications.js`, which needs Electron and a
display and therefore stays out of the default suite, like the other launcher UI
verifications.
