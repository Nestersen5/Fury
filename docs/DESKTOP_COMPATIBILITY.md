# Desktop compatibility policy

Fury owns one launcher instance per normal shared data profile. Windows NSIS
and extracted portable ZIP use the same profile; macOS DMG and ZIP copies use
the same profile. Safe storage/migration initialization precedes Electron's
instance lock, which precedes mutable owners and service startup. Secondary
launches restore/show/focus the existing window and exit without starting
services. During bounded shutdown, the primary retains ownership until exit;
a secondary launch does not cancel shutdown or queue a replacement launch.
Launch again after exit. Absolute `FURY_DATA_DIR` overrides remain isolated
test/development profiles, not a supported multi-instance product mode (ports
still need to be distinct for independent tests).

## Local services

Minecraft direct/failover listeners and local Cosmetic Search bind explicitly
to `127.0.0.1` and `::1`. Both use the same protocol/application handler.
`localhost` works with either address order. If IPv6 is unavailable, IPv4
remains available with a diagnostic; other bind failures are surfaced. Health
retains its existing `127.0.0.1` binding. No wildcard desktop listener is
intended. Other LAN devices cannot connect directly. Firewall prompts or
outbound permissions remain OS/security-software concerns.

`COSMETIC_SEARCH_API_URL` still selects the outbound local/cloud API; tokens,
request paths and parameters are unchanged. Standalone defaults to loopback;
`COSMETIC_SEARCH_BIND_HOST` explicitly opts standalone deployments into another
IP bind (for example `0.0.0.0`). Launcher-owned instances ignore that opt-in
and always bind loopback. Public server deployments need their own firewall,
access token and TLS/reverse-proxy policy; enabling a remote bind is deliberate.

## Maintainer runtime

Use maintained Node 22.x (>=22.12) or 24.x. Release-build workflows pin
22.23.2; compatibility CI covers 22.x and 24.x. Refresh the release pin for
security patches deliberately and reverify builds. Use `npm ci` against the
lockfile. These versions are build/test tools; Electron and its embedded Node
remain independently versioned. Do not change Electron to match host Node.

## Intentional macOS lifecycle

Closing Fury means stopping Fury/proxy and quitting, including closing the
last window. This deliberately differs from applications that stay running
after their last window closes. Minimize or Hide keeps Fury running. This
policy documents the existing lifecycle; it does not change F7 or menu/Dock
behavior.

Native acceptance on both Intel and Apple Silicon must verify close button,
Cmd+W, Cmd+Q, minimize, Hide, Dock interaction, proxy exit on actual Quit,
bounded persistence completion, and relaunch after exit. Also verify paired
ZIP/DMG copies contend for one profile. Building or inspecting an architecture
does not establish native runtime acceptance. Windows acceptance must cover
installer/ZIP contention, minimized focus, shutdown contention and protected
install locations. No signing, notarization or distribution-trust claim is
implied by these source/tests.
