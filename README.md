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
