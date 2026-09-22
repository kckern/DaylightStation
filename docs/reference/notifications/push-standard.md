# Push notification standard

A push is read on a lock screen by someone who didn't write the code, often
mid-task and at a glance. Every push DaylightStation sends, directly or through a
Home Assistant script, follows the rules below. They came out of an audit of 30
days of real pushes
([`_wip/audits/2026-09-22-ha-push-notification-audit.md`](../../_wip/audits/2026-09-22-ha-push-notification-audit.md)).
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
4. **Every push has a channel chosen by how loud it should be.** `alarm_stream`
   (bypasses Do Not Disturb) is reserved for real safety events.
5. **The text is composed in code and unit-tested.** HA scripts relay it; they
   don't format it. Every composer test runs its output through
   `findPushTextDefects`, which rejects `None`/`null`/`undefined`, `plex:` keys,
   kebab-case slugs, snake_case enums, ISO timestamps, `?.`, and empty text.

## Where it lives

| Module | Role |
|---|---|
| `backend/src/2_domains/notification/push/pushText.mjs` | Shared helpers: `personDisplayName`, `titleCaseId` (last resort only), `formatClockTime`, `formatDuration`, `formatStudyDay`, `pushData`, `findPushTextDefects` |
| `backend/src/2_domains/school/notifications/schoolPush.mjs` | `composeSchoolPush(event)`: every school outcome's copy, or `null` for no push |
| `backend/src/2_domains/shutdown/shutdownPush.mjs` | `composeKioskShutdownPush` |
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

- `tag` is `school-{learnerId}-{sessionId ?? testId}`, so a rescan, or a Partial
  followed by the Pass for the same session, replaces one card.
- `group` is `school-{learnerId}`: one stack per child.
- A piano lesson is tagged `school-{learnerId}-piano-{studyDay}`.
- The piano body shows **unit** progress (`Folk Songs: 3 of 8 lessons`). The
  launcher's `score` is course completion, not a lesson score, and is never shown.

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

## Log events

- `school.push.composed` (debug: `testId`, `kind`, `tag`)
- `school.push.suppressed` (info: `reason`)
- `school.push.compose-failed` (warn). Generic copy was sent instead; grading is
  unaffected.
