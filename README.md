# Fury

Fury is a Minecraft 1.8.9 proxy and launcher for Hypixel, distributed as
compiled Electron builds. Its sanitized source may be publicly viewable, but
it remains proprietary under [LICENSE](LICENSE).

This README is for collaborators. End-user instructions live in the
release notes on each published build.

## Stack

- Electron launcher (`launcher.js`, `launcher.html`)
- Node.js proxy (`proxy.js`) using `minecraft-protocol` + prismarine libs
- Cosmetic search HTTP service (`cosmetic_search_api.js`)
- Node-based test suite (`tests/*/test_*.js`)

## Local dev setup

Maintainer requirements: maintained Node.js 22.x (minimum 22.12) or Node.js 24.x and npm. Release-build CI pins Node 22.23.2; compatibility CI tests both supported major lines. Node 20 is unsupported. Packaged Fury uses Electron's embedded Node runtime and requires no system Node/npm. See [desktop compatibility policy](docs/DESKTOP_COMPATIBILITY.md).

```bash
npm install
cp .env.example .env       # edit values
npm test                   # sanity check
```

Run the launcher (Electron):
```bash
npm start
```

Run only the proxy:
```bash
npm run proxy
```

See [`.env.example`](.env.example) for every environment variable.

## Docs

- [COSMETIC_SEARCH_API.md](docs/COSMETIC_SEARCH_API.md) — cosmetic search service.
- [MINECRAFT_1_8_9_PACKETS.md](docs/MINECRAFT_1_8_9_PACKETS.md) — packet notes.
- [PUBLIC_RELEASE_CHECKLIST.md](docs/PUBLIC_RELEASE_CHECKLIST.md) — release prep.
- [docs/HISTORY_ARCHITECTURE.md](docs/HISTORY_ARCHITECTURE.md) — session-history concurrency decision and the compact `HistoryResponse` contract.
- [docs/PUBLIC_EXPORT.md](docs/PUBLIC_EXPORT.md) — sanitized public-source export policy.
- [SECURITY.md](SECURITY.md) — responsible disclosure (public).

## Project layout

```
proxy.js, launcher.js      — Proxy and Electron Main entry points
launcher.html              — Launcher renderer document
cosmetic_search_api.js     — Local Cosmetic Search service entry point
app_config.js              — Shared application configuration
src/launcher/renderer/     — Mounted launcher JavaScript
src/launcher/styles/       — Launcher stylesheets
src/                       — Shared proxy, session and storage modules
features/                  — Feature-specific proxy helpers
tests/                     — Permanent tests grouped by owning area
scripts/                   — Build, packaging, release and verification tooling
scripts/assets/            — Icon and resource-pack development tools
scripts/development/       — Offline recording analysis tools
scripts/benchmarks/        — Performance measurements
scripts/test_support/      — Shared test harness support
docs/                      — Architecture and verification documentation
```

## Release

For no-install Apple Silicon Mac downloads, see
[Portable Mac instructions](docs/PORTABLE_MAC.md). The `Portable macOS`
workflow builds and tests the ARM64 version on a Mac runner. `npm run package:mac`
does the same packaging on a development Mac. Windows and Mac use the same
launcher, settings, account manager, session cards, and proxy feature source.
Each Mac download is compared byte-for-byte with that source, then its packaged
UI is tested at both supported window sizes on Apple Silicon.

See [PUBLIC_RELEASE_CHECKLIST.md](docs/PUBLIC_RELEASE_CHECKLIST.md) before
publishing a build.

## Developer diagnostics

For intermittent wrong teams in Tab Stats or nametags, run `/teamdebug` while the
problem is visible. It saves a local report without changing the game. An optional
`/teamdebug PlayerName Red` records that player's expected team. See
[Team capture instructions](docs/TEAM_DEBUG.md) for the report location and details.

Diagnostic pages stay out of normal navigation and search. Normal startup opens
only the configured direct, failover, and health ports.

## License

Proprietary, all rights reserved. Public visibility of the sanitized source
does not grant permission to use, copy, modify, or redistribute it. See
[LICENSE](LICENSE).
