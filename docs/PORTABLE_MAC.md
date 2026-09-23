# Fury for Mac — no runtime installation

Choose the download matching your Mac: `mac-arm64` for Apple Silicon (M-series), or `mac-x64` for Intel. The packaging workflow produces a portable ZIP and a DMG for each architecture. Availability and native test results belong to the accompanying release reports; configuration alone does not establish native compatibility.

Requires macOS 12 Monterey or later and an existing Minecraft Java Edition client/account. The proxy does not install or include Minecraft. Electron, its embedded Node.js runtime, and the proxy dependencies are included. Apple Silicon runs natively without Rosetta.

1. For the portable ZIP, extract it in Finder. For the DMG, open it and drag `Fury.app` to Applications, then eject the disk image.
2. Open your extracted or copied `Fury.app`. The ZIP copy can stay in a normal folder; there is no Terminal setup.
3. Packaging success does not establish Apple distribution trust. The current configuration uses ad-hoc signing, not Developer ID notarization. Public signing, notarization and Gatekeeper acceptance remain separate release work. See Apple's guidance: https://support.apple.com/en-us/102445
4. Add your own Microsoft/Minecraft account, enter API keys for the services you use, and start the proxy. Use the connection address shown in Fury in Minecraft.

The Mac app uses the same current UI and feature source as Windows: the gold launcher, redesigned settings, account manager, account-specific reminders, session history and PNG cards, local session tracking, nicknames, profiles, and player board. The current onboarding, cosmetic picker, session mode cards, Quick Buy, hotbar layouts, and book previews are included. Search uses Cmd+K on Mac. The retired desktop HUD and floating/fullscreen overlay are no longer part of Fury on either platform.

Version 1.0.7 also includes Daily, Weekly, and Monthly session summaries with image export, the latest local stat tracking, session-card display changes, and Auto Gambler updates. Calendar periods follow the computer's timezone, with weeks starting Monday.

All proxy feature code is included, along with 32 anonymous kill-message template groups for cosmetic recognition. Online lookups still require internet access and valid keys where the provider requires them. No account tokens, personal API keys, player history, or local cosmetic training data from the sender are included. First-time installations start with a fresh user profile; updates use the existing profile.

Settings, accounts, profiles, and history save in `~/Library/Application Support/Fury/`, outside the app so replacing or moving the app preserves them. For transferring your own settings between your own computers, quit Fury and copy that folder separately. It contains credentials; do not include it when sharing Fury with someone else. Advanced users can set `FURY_DATA_DIR` to an absolute writable folder.

The build workflow has separate native Intel and Apple Silicon jobs. It checks paired ZIP/DMG content, signatures, clean storage, local services, then exercises extracted/copied applications with synthetic data. It compares packaged runtime files with the checkout and retains native runtime and UI reports. Packaging CI does not initiate real Microsoft login; mocked onboarding tests cover sign-in presentation. Real Microsoft login, paid API calls, and a live Minecraft play session still require a separate interactive check. Only a successful native run establishes coverage for that architecture.

To update an existing Mac installation, quit Fury and replace the old `Fury.app` with the app from the new ZIP or DMG. Both distributions use the same existing settings and accounts in the application support folder described above.

Party split warnings have a permanent On/Off setting under Settings → Automation → Party split warnings. You can also use `/partycheck off` or `/partycheck on` in Minecraft. The choice applies immediately and survives new queues, app restarts, profile switches, and app updates. `/partycheck status` shows the saved choice; `/partycheck dismiss` only silences the current lobby.

## Rebuilding (maintainer only)

The repository's **Fury macOS distributions** GitHub Actions workflow builds x64 and ARM64 on separate native runners and retains ZIP/DMG downloads and verification reports. It does not publish a public release. Each container contains the complete app. `PAIR-mac-<arch>.json` records payload/source parity; `SOURCE-VERIFICATION-<arch>.json` records detailed runtime file hashes. The optional **macOS screenshots** workflow accepts a successful build run ID instead of using a pinned historical download.

On a development Mac with Node.js installed: run `npm ci`, `npm test`, `npm run test:portable`, `npm run test:packaging`, then `npm run package:mac`. The default is Apple Silicon; `-- --arch arm64` or `-- --arch x64` selects an architecture explicitly, and `-- --all` builds each separately. Every architecture produces both ZIP and DMG from one app payload. Output goes to `release/mac-portable/`, or `FURY_RELEASE_DIR` when set. Packaging needs macOS to preserve framework symlinks, executable permissions, and code signatures. Users do not run these build commands. See [release artifact verification](RELEASE_ARTIFACTS.md) for the complete workflow.

For distribution without the unverified-developer prompt, configure Developer ID signing and Apple notarization; an ad-hoc signature cannot supply Apple's trust approval.
