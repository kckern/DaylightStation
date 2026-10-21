# Push notification standard

A push is read on a lock screen by someone who didn't write the code, often
mid-task and at a glance. Every push DaylightStation sends, directly or through a
Home Assistant script, follows the rules below. They came out of an audit of 30
days of real pushes
(`ops:docs/_wip/audits/2026-09-22-ha-push-notification-audit.md`).
That audit found `None` in 60% of school pushes, raw ids in almost every
producer, UTC timestamps, and the same event ringing two to six times.

## The rules

1. **Names, never ids.** People go through `personDisplayName` (profile
   `display_name`). Rooms and devices use their configured `name`/`location` from
   the devices config. Slugs, learner ids, device ids, NFC UIDs and Plex keys
   never appear in a title or body. An id may ride in an action payload, where no
   one reads it.
2. **Local, spoken times.** `until 6:13 PM`, `for 30 min`, `from Mon Sep 14`.
   Never ISO, never UTC.
3. **Every push has a `tag`** keyed to the thing it's about, so a repeat replaces
   the earlier card instead of stacking. If the repeat is the *same* state (a
   second tap, a re-sent approval), also set `alert_once` so it updates without
   ringing.
4. **Choose the channel deliberately.** A family of pushes that someone may want
   to hear or silence separately gets its own named channel: School progress,
   School needs you, Household alerts, DoNow approvals. One-off device notices
   (NFC tag, TV, story time) stay on the default channel. `alarm_stream`
   (bypasses Do Not Disturb) is reserved for real safety events.
5. **The text is composed in code and unit-tested.** HA scripts relay it; they
   don't format it. Every composer test runs its output through
   `findPushTextDefects`, which rejects `None`/`null`/`undefined`, `plex:` keys,
   kebab-case slugs, snake_case enums, ISO timestamps, `?.`, and empty text.

## Where it lives

| Module | Role |
|---|---|
| `__backend/src/2_domains/notification/push/pushText.mjs` | Shared helpers: `personDisplayName`, `titleCaseId` (last resort only), `formatClockTime`, `formatDuration`, `formatStudyDay`, `pushData`, `findPushTextDefects` |
| `__app_modules/learning/school/server/domain/notifications/schoolPush.mjs` | `composeSchoolPush(event)`: every school outcome's copy, or `null` for no push |
| `__backend/src/2_domains/shutdown/shutdownPush.mjs` | `composeKioskShutdownPush` |
| `__backend/src/2_domains/notification/push/harvesterHealthPush.mjs` | `composeHarvesterHealthPush`: a data source failing, stale or recovered (`__docs/reference/harvesters/health-and-reconnect.md`) |
| Producers that call `pushData` directly | NFC unknown tag (`TriggerDispatchService`), TV power failure (`WakeAndLoadService`), story time (`NotifyReadingSessionFailure`), DoNow approval (`HaApprovalNotifier`) |

## School pushes

The title is `{emoji} {Child} — {Course}: {Lesson}`:

- **Child:** display name.
- **Course:** the course `_index.yml` `short_title`, falling back to `title`.
- **Lesson:** the published sheet title.

The body is one plain line with no percentages. A missing label drops its
clause; it never renders an id.

| Outcome | Emoji | Channel |
|---|---|---|
| Passed / retake cleared | ✅ | School progress (low) |
| Piano lesson done | 🎹 | School progress (low) |
| Needs remediation | 🔁 | School needs you (high) |
| Awaiting review | 👀 | School needs you (high) |
| Rows blank or double-marked, unreadable/refused card, nothing marked | ⚠️ | School needs you (high) |
| Unmarked old record on a card whose other work graded | none (logged `school.push.suppressed`) | — |
| Card ladder: the tuning agent read a day as a concern | 🔤 | School needs you (high) |
| Parent digest: the day for every child (`digest`) | none | School progress (low) |
| Two study days in a row with nothing done (`zero-days`) | 📭 | School needs you (high) |

- `tag` is `school-{learnerId}-{sessionId ?? testId}`, so a rescan, or a Partial
  followed by the Pass for the same session, replaces one card. With no learner
  it is `school-card-{sessionId ?? testId}`.
- `group` is `school-{learnerId}`: one stack per child.
- A piano lesson is tagged `school-{learnerId}-piano-{studyDay}`.
- A card-ladder concern is tagged `school-{learnerId}-card-ladder-{package}`, so
  the next day's concern replaces the card. Its title is `🔤 {Child} — {Deck}`.
  The body is the tuner's first note only when `findPushTextDefects` passes it,
  else a fixed line, then the study day (`Mon Sep 21`). Setting ids in a note
  become plain words first. A push held by quiet hours is retried every 15
  minutes for up to 48 hours, never dropped silently. It is sent to each
  teacher through `NotificationService`. `PushNotificationAdapter` relays an
  intent's `metadata.pushData` block (from `pushData`) as the HA `data:`, so the
  tag and channel reach the phone.
- The piano body shows **unit** progress (`Folk Songs: 3 of 8 lessons`). The
  launcher's `score` is course completion, not a lesson score, and is never shown.

## The parent digest and the zero-days alert

`SchoolParentDigest` (`__app_modules/learning/school/server/application/`)
sends both, composed in `composition/parentDigest.mjs`.

- **When.** On the economy catalog's `digest.cron`. It is
  read once at boot, so a change needs a restart; a null cron registers
  nothing. The job runs only where the scheduler runs (production or
  `ENABLE_CRON`).
- **`digest`.** Title `School today` (`School · Tue Oct 20` for a replayed
  day or one resent after its day). One line per child:
  `{Child}: {served} of {asked} done`, then `{n} silver`, `{n} pass(es) used`
  and the day's most actionable failure, each only when there is something
  to say. Excused sections are not asked. A day with nothing asked reads
  `nothing asked`; a day that could not be judged reads `couldn't be
  checked`. A child with no name reads `A learner (1)`, `A learner (2)`.
  Tag `school-digest`, group `school`.
- **Silver** is the ledger's: positive silver payout deltas inside the study
  day. With the catalog mode `dry-run` nothing is minted, so no figure is
  shown and the body ends `Coins not live yet`; with `off` coins are not
  mentioned. Passes used are the day's purchases less refunds.
- **Failures** come from the school ledger (`media/logs/school/*.jsonl`).
  One is shown per child, ranked print, then sheet, then code, the earliest
  within the top rank:
  - `a print failed`: any `status: print_failed`, `school.issue.failed` or
    `school.selfservice.action.failed` at stage `print`, and
    `school.card.print-failed`.
  - `a sheet couldn't be made`: `school.issue.failed` at any other stage.
  - `an old code was typed`: `school.selfservice.code.rejected` for an
    expired code; `a code was turned away` for other rejections that name a
    learner. A used-up code is left out: retyping one is normal.

  An event is a child's when its `learnerId` names them or its `sessionId`
  is theirs; one naming neither is left out. A code nobody issued has no
  learner and is never attributed to anyone.
- **Length.** A line over 100 characters (counted in code points, so an
  emoji is never split) drops its clauses from the end: failure, then
  passes, then silver. A body over 600 characters keeps the first children,
  then the `Coins not live yet` footer if any, then `+N more in the teacher
  view`.
- **`zero-days`.** Title `📭 {Child} — School`, body `Nothing done for the
  second study day in a row`. Sent when today asked for work and none was
  done, and so did the previous study day (`digest.zero_days_alert` days in
  all, today included). The previous study day is the last earlier day that
  asked for something: weekends and days off are skipped. The copy counts
  the whole run (`third`, `fourth`, then `N study days in a row`): the
  look-back goes on to a day with work done, a day that cannot be judged, or
  14 days, reading earlier days from the term-verdict cache. A stop at a day
  that cannot be judged still fires on the days counted before it. Tag
  `school-{learnerId}-zero-days`.
- **Delivery.** Each teacher through `NotificationService` (`category:
  school`), dedupe keys `digest:{day}` and `zero:{learnerId}:{day}`. A send
  held by quiet hours (`reason: quiet_hours`) is resent hourly (the
  scheduler runs a job at most once per clock hour) until it is delivered or
  the next evening's run drops it. A `cooldown` suppression means that
  teacher already has it: it counts as sent and is never resent. A push
  resent after its day names that day (`School · Tue Oct 20`, `… · from Tue
  Oct 20`). The day, the ledger window and the silver window all use the
  economy's study calendar (household zone, 4 am). The hold lives in memory;
  a restart drops it.
- **Logs.** `school.parent-digest.sent|skipped|failed|dropped`,
  `school.zero-days.sent`, and warnings `school.parent-digest.name-failed`,
  `learner-failed`, `economy-failed`, `ledger-failed`, `verdict-failed`.

## The `notification` script variable

`SchoolGradingHookAdapter` sends a `notification` variable with every call. The
kiosk-shutdown cue sends it too. The HA script branches on it:

| Value | HA script does |
|---|---|
| object `{title, message, data}` | relays it verbatim to the phone |
| `null` | no push. The siren still plays. Use this for siren tests. |
| undefined | an older backend is still deployed: a minimal legacy message |

The siren tone always branches on `result`, independent of the push.

## Android channel caveat

The companion app creates a channel the first time it sees the channel name, and
Android fixes that channel's importance from then on. Changing `importance` in
code later has no effect on an existing channel. Rename the channel, or retune it
in the phone's notification settings.

## Composition can never withhold a cue

A push is optional; the siren, chime and lockdown cue are not.

- In the scan consumer, the notification is composed on its own promise chain.
  Label lookups (catalog, name, sheet title) are capped at 2 s by the injected
  scheduler (`pushLabelTimeoutMs`).
- A failure or timeout recomposes the **same outcome without labels**, so a pass
  still reads as a pass and a suppressed push stays `null`. Generic "couldn't be
  graded" copy is only the last resort.
- The piano bridge, the shutdown service and the story-time alert compose inside
  their own guards, so a composer throw falls back to `notification: null` or to
  unlabelled copy and the cue still fires.
- Hook fires on one card can reach HA in either order, because each waits on its
  own lookups.

## Log events

- `school.push.composed` (debug: `testId`, `kind`, `tag`)
- `school.push.suppressed` (info: `reason`)
- `school.push.compose-failed` (warn): a lookup threw; the unlabelled copy of the
  same outcome was sent.
- `school.push.compose-timeout` (warn): a lookup exceeded the deadline; same
  fallback.
- `trigger.notify.label_failed` (warn): the NFC room-label lookup threw; the
  title uses the title-cased location id.
