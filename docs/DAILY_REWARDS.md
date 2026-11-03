# Daily Reward in chat

Click **Daily Reward** at Hypixel's Delivery Man. Fury loads the official reward
page in the background, closes the menu/book, and lists the cards in Minecraft
chat. Each card shows its rarity, name and amount, with a description on hover.
Click **[CLAIM]** beside the card you want. Manual selection is the default.

The account must be allowed to skip the ad. If the page says the ad cannot be
skipped, Fury offers the original browser link instead. Fury never plays an ad,
pretends an ad was watched, or opens a browser automatically.

Ranked players' reward links in chat get a **[CLAIM REWARD]** button. Clicking it
loads that player's cards; selecting a card gives the reward to **that player**.
Shared links always require manual selection, including in auto mode.

| Command | Action |
| --- | --- |
| `/dailyreward` or `/dailyreward open` | Show your waiting cards again, without reloading the page. |
| `/dailyreward status` | Show settings and the last reward outcome. |
| `/dailyreward on` / `off` | Enable or disable the feature. |
| `/dailyreward others on` / `off` | Enable or disable buttons on other players' links. |
| `/dailyreward mode manual` | Require a [CLAIM] click for every card. |
| `/dailyreward mode auto` | Use the ported preference model for your own future offers. |

Auto mode uses the same preference model as the desktop injectable. It chooses
only a card that strictly beats the other cards through recorded preferences.
Ties, unknown cards and conflicting preferences fall back to the chat picker.
It does not invent rarity scores or extrapolate reward amounts. The mode is
saved globally; it does not apply to a card list already waiting for a choice.

## Implementation and provenance

The reference is the readable source in `Lunar Client Deobf/injectable/java/dev/fury/rewards/`:
`DailyRewards.java`, `RewardPage.java`, `RewardTransport.java`, `RewardText.java`,
`SharedLinks.java`, `DeliveryMenu.java` and `AutoPick.java`, plus its bundled
`auto-pick-model.json`. No decompilation or Lunar runtime hooks were needed for
this port. The native picker and artwork are replaced by the source feature's
chat fallback, using Fury's existing JSON chat sender. Lunar-specific rendering,
reflection, worker threads and compatibility bindings do not apply to the proxy.

The original `analysis/findings/DAILY_REWARD_PROTOCOL.md` records the observed
2026-10-28 HTTP protocol. A read-only fetch of Hypixel's public
`https://rewards.hypixel.net/claim-reward/app.js?v=NF38qnd9` returned HTTP 200 and
267,929 bytes during this port, retaining the claim endpoint, CSRF and skippable
fields. This is static protocol evidence, not a live claim verification.

`src/rewards/page.js` parses only the page's `window.appData` and
`window.securityToken`; it does not execute downloaded JavaScript. Requests use
the shared axios instance and API kill switch, HTTPS on `rewards.hypixel.net`, no
redirects, a 15-second request timeout and a 1 MiB response bound. A claim sends
the original zero-based card index, active ad, CSRF token, per-offer cookie,
Origin and Referer. Only HTTP 200 with the exact `reward claimed` response counts
as success. A failed or uncertain POST is never retried automatically.

The controller is owned by one account connection. Its own-link path requires
the exact server line within ten seconds of a Delivery Man click, with matching
official click URLs. Only clicking the matching Daily Reward item, or Hypixel's
empty "Loading..." placeholder shown before that item finishes loading, arms the
single-use, three-second book suppression. Normal books and unrelated menus
pass through. Shared cards load only after a locally observed player's button
is clicked; arbitrary unobserved IDs cannot start a shared request.

Own and shared offers have separate cookies and state. Their HTTP operations
are serialized, each claim is attempted at most once, and the two bounded
64-entry maps remember shared senders and completed links for this connection.
Cookies and CSRF tokens stay in memory and are cleared after completion,
disconnect, disable or an API pause. Turning off shared links cancels only the
shared offer. Settings use the existing normalized `features_config.json`
`dailyReward` field (`enabled`, `others`, `mode`); they are not playstyle-profile
settings. There are no new runtime dependencies or background polling timers.

## Verification

`npm run test:daily-rewards` runs the permanent unit and isolated production
proxy tests. They cover strict parsing, text, requests, menu ownership, one-use
book suppression, manual choices, shared links, duplicate prevention, rejected
and uncertain claims, serialized offers, cookie isolation, cancellation, settings
round trips, commands and auto/manual fallback. The real 1.8.9 socket fixture
checks both book-before-link and link-before-book orders, actual chat click
commands, upstream/client menu closing, shared claims, saved settings, disabled
passthrough and unskippable-ad browser fallback. All external rewards are
synthetic, and all mutable data belongs to temporary test directories.

A separate local parity check compared all 198,485 three-card draws (including
duplicates, catalogue order) against the original quiz's JavaScript model;
every decision matched. Related menu, book trace, Quick Buy, nickroll, report,
help, completion, command-surface and API kill-switch tests passed, as did source
syntax and public-export/runtime-resource checks.

Live Hypixel claiming and visual inspection in a real Minecraft client remain
unverified. No real reward was claimed, no running user app was restarted, and
no build or release was made. Restart Fury to load the feature.
