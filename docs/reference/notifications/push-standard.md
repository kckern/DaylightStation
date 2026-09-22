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
  followed by the Pass for the same session, replaces one card. With no learner
  it is `school-card-{sessionId ?? testId}`.
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
