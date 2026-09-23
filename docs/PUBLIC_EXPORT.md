# Fury public export

The repository that holds Fury's full history stays **private**. It is the
archive. Its Git graph carries identity metadata, a removed account-server
endpoint, historical player data and two orphaned commits that GitHub retains
server-side. None of that can be reliably removed by rewriting history, so it is
never published.

The public repository is created instead from a **sanitized current tree with
fresh pseudonymous history**. `scripts/export_public.js` owns that step.

## Identity policy

`Hadex`, `Nestersen` and `Nestersen5` are the intended public identity. They are
deliberate pseudonyms and are preserved everywhere they appear: the `LICENSE`
copyright holder, the `SECURITY.md` contact address, the default development
sign-in name, product strings and test fixtures.

These must never reach the public repository:

- the maintainer's real legal name
- personal email addresses other than the published Hadex contact
- the previous GitHub account, wherever it links the pseudonym to the real identity
- personal location
- personal or home-hosted infrastructure, including the retired DDNS endpoint
- live credentials or account identifiers
- private user data, including real third-party Minecraft accounts

`furyproxy.online`, `downloads.furyproxy.online` and the production Cloudflare
infrastructure are legitimate public Fury endpoints and stay.

## What the exporter does

```text
node scripts/export_public.js --check     privacy and runtime completeness gates, no writing
node scripts/export_public.js --list      the resolved export manifest
node scripts/export_public.js <target>    write the export
```

It contacts nothing, writes no Git state and never touches the private archive.

**Source of truth.** The candidate set is everything Git would commit from this
working tree: `git ls-files --cached --others --exclude-standard`. Ignored and
local-only files therefore cannot be exported, whether or not they have been
committed yet.

**Runtime completeness.** The exporter requires every file selected by
`build.files`, local runtime imports and the launcher's local HTML assets.
It also requires `.gitattributes` and the application entry points. A privacy
pass cannot hide an omitted runtime module such as
`src/launcher/renderer/launcher_updates.js`.

**Allowlist, not a filter.** Every candidate must match an `INCLUDE` category.
A path that matches nothing is excluded and reported by name, so a new
top-level directory stays out of the public repository until somebody classifies
it. This is the point: `.gitignore` is a safety net, not a publication policy.

| Included | Contents |
| --- | --- |
| production source | root `*.js` entry/support files, `launcher.html`, `src/launcher/`, other `src/`, `features/` |
| assets | `assets/` |
| package metadata | `package.json`, `package-lock.json`, `.gitignore`, `.gitattributes`, `.env.example`, `cosmetic_search_package.json`, `build/installer.nsh` |
| tests | permanent `tests/` suites grouped by owner |
| scripts | `scripts/` |
| docs | `README.md`, `SECURITY.md`, application `docs/` |
| workflows | `.github/workflows/` |
| legal | `LICENSE`, `SECURITY.md` |

`EXCLUDE` runs first and wins over any include: the private archive's Git
directory, agent-local settings, local runtime data, generated output,
unrelated sibling projects, private deployment overrides, credential and signing
material, logs and crash dumps, and private player data files.
The website, download tracker, deployment scripts, and private agent guidance
are also excluded from the public source.

**Privacy gate.** Every exported text file is scanned for forbidden content
before anything is written, and the export is refused if any file matches. The
gate reports `file:line: label` and never prints the offending value. It covers
the identity classes above plus AWS keys, GitHub tokens, Google API keys,
OpenAI-style keys, JSON web tokens, private-key blocks, credentialed connection
URIs and a committed Cloudflare account identifier. Binary payloads are copied
byte for byte and are not content-scanned.

The gate runs as part of `npm test`, `npm run test:packaging` and
`npm run test:export`, so a regression fails the suite rather than surfacing
after publication.

## What the exporter does not do

It does not create a repository, initialise Git history, add a remote, push, or
publish anything. Those remain separate, approved steps.
