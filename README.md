# Fury

Fury is a Minecraft 1.8.9 proxy and Electron launcher for Hypixel.

The source is publicly viewable but proprietary. Running or building from source
requires prior written permission from Hadex. See [LICENSE](LICENSE). For normal
use, get an [official build](https://furyproxy.online/).

## Run from source (with permission)

Use Node.js 22.12+ on the 22.x line (recommended) and npm.

```sh
git clone https://github.com/Nestersen5/Fury.git
cd Fury
npm ci
npm start
```

The launcher manages the proxy and account sign-in. To start only the proxy for
development, run `npm run proxy`. Run `npm test` to check the source.

Development runs store local data in the checkout by default. Set
`FURY_DATA_DIR` to an absolute directory if you want a separate development
profile.

Seraph support has been removed from the launcher and proxy. Existing Seraph API
keys are removed from the active key file when it is loaded; other keys and
Hypixel reminder metadata are preserved. Player report tags now use Urchin.
Historical logs and session records are retained.

## Nick reroller

In a lobby, configure filters and start automatic rolling:

```text
/nickroll filter max 8
/nickroll filter digits exclude
/nickroll start
```

Fury waits for each nick-book response before continuing and hides recognised
setup/candidate book popups. Rolling stops when all enabled filters match,
or a name has three or more identical letters with the same capitalization in a row (such as `Miiia` or
`Hopeeee`), or matches your word lists. The default word group contains both
`fresh` and `head` anywhere in either order.
Word-list matches are case-insensitive; OG repeated-letter runs are case-sensitive.
Both ignore the other filters. Matching stops
rolling and offers **Use Name** and **Roll Again** in chat; names are never
applied automatically. `/nickroll stop` cancels pending work, and
`/nickroll status` shows progress.

Use `/nickroll filters` to view saved preferences. Available filters are
`min`/`max` (3?16), `digits`/`underscores` (`any`, `exclude`, `require`), and
case-insensitive `prefix`/`suffix`/`contains` (`off` clears text). With no filters,
only the repeated-letter and word-pair matches stop rolling.
Configure rank with `/nickroll rank NONE|VIP|VIP_PLUS|MVP|MVP_PLUS`
and skin with `/nickroll skin random|actual|<preset ID>`.

Word lists are saved with your preferences. Stop rolling before editing them:

```text
/nickroll words add cat moon fresh
/nickroll words group blue head
/nickroll words list
/nickroll words remove cat
/nickroll words ungroup blue head
/nickroll words clear
```

`add` stops on **any** listed word. `group` requires **every** word in that
group, anywhere and in any order. Words match substrings, case-insensitively;
spaces or commas separate words. Duplicate words/groups are ignored. `clear`
removes all words and groups, including the default fresh/head group, while
keeping your normal filters and OG rule. Up to 64 words and 32 groups of 2–8
words are supported; each word is 1–16 letters, digits, or underscores.

`/nickroll delay <milliseconds>` selects a fixed pause after each response (default
1500; range 1000-30000). `/nickroll delay auto` enables adaptive pacing, beginning
at the saved fixed delay. After five successful generated-name responses, the
pause decreases by at most 100 ms per response toward the greater of 500 ms or
half the recent p95 response time. Slow responses increase it immediately.
Adaptive mode adds a fresh random 0-200 ms to each scheduled pause, always on top
of that baseline. At the 500 ms floor, the extra post-response wait is therefore
500-700 ms. Fixed numeric delays do not randomize.
`/nickroll timing` shows the last 20 responses' minimum, average and p95 latency,
the last sampled command's queue wait, baseline, last scheduled pause (including
its random addition), and cooldown count.
Measurements start at actual command transmission and end when the matching book
opens. These measure response latency, not a permitted or guaranteed server rate
limit.

A recognised cooldown stops the run and doubles the pacing floor for the next
manual start on that connection (capped at 30 seconds). This backoff also applies
in fixed mode. Server cooldowns and permission errors are not automatically retried. Measurements and
backoff reset on reconnect; the selected pacing mode is saved.
A missing response times out after 15 seconds. An unexpected book response,
timeout, or command-send failure triggers one fresh setup attempt after 10 seconds.
A second failure in the same run stops rolling until you manually start again.
Stop, disconnects, and world/menu changes cancel a pending retry.
Each matching nickname plays a rapid burst of 12 plings, 60 ms apart. Stop,
Use Name, Roll Again, and disconnects cancel any remaining sounds. Server
limits still apply. Runs stop on connection/world changes or conflicting menu
operations and do not resume automatically. Saved preferences are shared like
other Fury feature settings; active candidates belong only to their connection.

## Build (with permission)

Build on the target operating system:

```sh
npm run package:win                 # Windows installer and portable ZIP
npm run package:mac -- --arch arm64 # Apple Silicon ZIP and DMG
npm run package:mac -- --arch x64   # Intel Mac ZIP and DMG
```

Windows output goes to `%LOCALAPPDATA%\Fury\release`; Mac output goes to
`release/mac-portable/`. Local builds are not published automatically and are
not signed or notarized for public distribution. See
[package details](docs/RELEASE_ARTIFACTS.md) and [security reporting](SECURITY.md).
