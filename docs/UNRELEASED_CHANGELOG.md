# Unreleased changes

Running draft for changes selected for 1.1.3, awaiting verified publication.
Keep player-facing bullets short; release prerequisites and verification
details belong in Development notes below.

## New features

- AutoDenick can suggest a possible match from a final or bed count before checking both to confirm.

- Automatically save a teammate's nickname when only one party member can match, with Undo.
- Share your current nickname only while nicked with Fury players in the same party, and automatically save nicknames they share with you.
- Use /denick self to see your checked nickname and saved nickname history.

## Improvements

- AutoDenick uses a tighter stats match and shows confirmed players with their stats on one line.

- Choose whether Auto Dodge leaves instantly or just before the game starts instead of setting a leave delay.

- Copy any API key with a Copy button and a confirmation popup.

- Teammate nicknames save automatically with Undo, and you can turn off sharing your own nickname.

- Keep your older nicknames saved while checking your current nickname each game.

## Bug fixes

- AutoDenick stops repeating count messages and retries failed searches only when an error occurs.

- Auto Dodge no longer cancels a planned leave during the final Bed Wars countdown warning.

- Automatic skin and stats denicks no longer reveal party members in party chat.

## Development notes

- Staged stats denicks: `proxy.js`, `src/denick/commands.js`, `src/stats/scanLine.js`, `src/overlay/scan.js`; automatic verification uses ±100 per observed stat while manual lookup defaults remain unchanged. One-stat results are tentative and never saved or broadcast; only one verified candidate from an untruncated combined search can confirm. Completed searches stop for that stage; gathering the second stat unlocks a combined search, while temporary errors retry at 30-second intervals with deduplicated notices. API failures remain distinct from no-match results. Search limits remain 100 discovery results per stat and 15 profile verifications. Retry cleanup, mapping/session invalidation, captured query counts, and reconnect attempt state are preserved. The denick suite (including 15 staged-lookup cases and 9 persistence cases), party-announcement, scan, command-surface and snapshot checks passed locally. Live Hypixel and launcher visual verification remain outstanding.

- API key copying: `launcher.html`, `src/launcher/renderer/launcher_redesign_pages.js`; replaced all four Replace buttons with Copy and reused the launcher notification style. Isolated Electron checks passed for all providers, keyboard activation, masked values, empty keys, clipboard failures and existing Hypixel reminder behavior; rendered popup inspected. Clipboard calls were stubbed during the interaction check.
