# Fury 1.1.0

Changes since the published 1.0.8 source.

## Gameplay and launcher

- Add nick rerolling with saved name, rank and skin filters, word groups,
  response-aware pacing, cooldown handling and explicit candidate acceptance.
  Manage the same preferences through chat commands and the launcher.
- Add Scaffold, Autoblock and Stasis detection with individual controls,
  possible-alert and team-alert settings, and world-change cleanup. Scaffold
  is enabled by default; Autoblock and Stasis are opt-in. These are observer
  detections, not authoritative proof that another player is cheating.
- Add optional Quick Maths answers with delayed scheduling and cancellation
  on manual answers, world changes and disconnects.
- Add Hypixel API key age reminders, snoozing and delivery tracking while
  preserving unrelated keys and account state.
- Improve denick history persistence, manual nick handling and launcher
  updates, including acknowledged writes before starting the proxy.
- Refine launcher navigation, feature settings, nick controls, overlay chat
  settings and recap previews using the existing Fury components.

## Recaps and statistics

- Add automatic per-game recaps using observed local events, with later API
  verification kept separate from immediate local results.
- Track Bed Wars bed-break messages and queue results; exclude private Bed
  Wars matches from public statistics.
- Preserve unavailable counters rather than presenting missing observations
  as zero. Reject ambiguous API windows covering multiple games instead of
  assigning their totals to a single match.
- Improve session result handling, duplicate-verification protection and
  account ownership checks. Retain the compact history response contract.

## Retired features and compatibility

- Remove active Seraph integration and its saved API key while retaining other
  keys, reminder metadata and historical records. Player report tags use Urchin.
- Remove the Slumber daily-rewards reminder and retired tag-tracker path.
- Preserve local Cosmetic Search, notification-only updates, shared installed
  and portable profiles, and the six Windows/macOS distribution slots.

## Release engineering

- Export the reviewed detector and nick-book test fixtures with application
  source. Keep private data, deployment infrastructure and generated output
  outside the public repository.
- Generate public npm scripts from the export policy so the public test suite
  does not reference private deployment tools.
- The separately maintained download site adds a screenshot gallery and
  updated presentation. The production download selection changes only during
  the approved release publication workflow.

Signing and notarization policy is unchanged. Artifact verification and native
platform acceptance are recorded separately from these source release notes.
