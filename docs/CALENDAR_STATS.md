# Calendar session stats

Sessions has four views: Sessions, Daily, Weekly and Monthly. Calendar summaries
expand into the same bitmap card renderer used for session images, with copy and
PNG export. Daily cards show game modes, weekly cards show daily bars, and monthly
cards show an activity calendar. All bar charts have gaps between columns.

The timezone is detected automatically from the computer on refresh. Old manual
timezone preferences are ignored. Days run midnight to midnight; weeks start Monday; months start
on the first. Calendar arithmetic handles daylight-saving changes.

Calendar input contains all retained account history, independent of the session
list's 250-row projection limit. Summary counters are used when a session fits
entirely inside a period. Cross-boundary sessions use timestamped match results.
Missing matches, uncertain results and multi-match API samples that span a
boundary hide counters that cannot be assigned reliably. Ratios are recalculated
from totals. Tracked time is split at midnight and overlapping intervals are
counted once. No recorded data is distinct from recorded zero activity.

## Empty history

A session or game-mode section needs a positive performance counter (wins,
losses, kills, deaths, finals, beds, assists, including mode variants), or BedWars
XP alongside gameplay evidence. Internal game/round counts, streak changes,
coins, hit counters and other telemetry alone do not create a card. Fully
observed local sessions with all tracked counters at zero are discarded. A locally
confirmed completed game is meaningful activity even with no combat stats.
Pending API verification remains recoverable and hidden until stats arrive.
Unknown local coverage is preserved but does not create empty completed cards.

`node scripts/cleanup_empty_sessions.js` audits the active data directory.
Add `--apply` to back up the original, remove empty completed sessions, and remove
empty mode stats from retained summaries and match deltas. Active sessions and
pending verification are preserved. The script aborts if the file changes before
replacement.

Validation: `npm run test:calendar`, plus the existing session tracker, local
tracking, history projection, mode breakdown and submode tests. UI checks use an
isolated Electron profile, offline fixtures, 1440/1024px layouts, actual PNG
downloads and intercepted clipboard image writes. Screenshots are saved under
`output/calendar-stats/`.
