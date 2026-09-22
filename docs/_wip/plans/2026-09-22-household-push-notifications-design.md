# Household push notifications — design

**Date:** 2026-09-22
**Status:** design agreed, not implemented
**Evidence:** [`_wip/audits/2026-09-22-ha-push-notification-audit.md`](../audits/2026-09-22-ha-push-notification-audit.md)
(305 real pushes over 30 days, with every defect traced to its cause)

## Decisions

| Question | Decision |
|---|---|
| What a school push is for | **Every event pushes**, and each one is clean, named, grouped and on a channel you can mute |
| Who writes the text | **The backend composes it; HA relays it.** HA keeps the siren. |
| Scope | School in full; one household standard; the DaylightStation-owned producers brought up to it; HA automations as a follow-up list |
| Layout | Emoji status title: `{emoji} {Child} — {Course}: {Lesson}` |
| Channels | "School progress" (low, silent) and "School needs you" (high, audible), grouped per child |
| Unmarked old record alongside graded work | No push (logged; the siren is unchanged) |
| Architecture | Pure domain composer plus a thin relay (approach A below) |

Rejected approaches:
- **Composing inside `SchoolGradingHookAdapter`:** the adapter has no curriculum
  context, and this would put presentation logic in the adapter layer.
- **A separate notification service subscribed to school events:** it creates a
  second path per outcome, and that kind of duplication is what caused the Partial
  double-fire.
- **Backend pushing directly through `PushNotificationAdapter`:** declined, to keep
  push delivery in HA.

---

## 1. Message catalog

The title is always `{emoji} {Child} — {Course}: {Lesson}`:

- Child: the display name.
- Course: the course short title.
- Lesson: the lesson display title.

The body is one or two plain lines. It has no percentages or ids, and no trailing
period after a title.

| Outcome | Emoji | Body | Channel |
|---|---|---|---|
| Passed, perfect | ✅ | `6 of 6 correct` | Progress |
| Passed, not perfect | ✅ | `5 of 6 correct` | Progress |
| Retake cleared | ✅ | `Retake: 3 of 3 correct` | Progress |
| Needs remediation | 🔁 | `2 of 6 correct — retake is on the receipt` | Needs you |
| Piano lesson done | 🎹 | `Lesson 24 of 130 · Piano Basics` | Progress |
| Rows blank / double-marked (`partial_scan`) | ⚠️ | `Rows 4, 6 blank — fill in and rescan` / `Row 3 has two marks` | Needs you |
| Awaiting review | 👀 | `2 answers need a grown-up's check`, plus the first reason | Needs you |
| Unresolved / refused | ⚠️ | A plain sentence from a `code` → text map. Unknown codes read `Card couldn't be graded — check the School teacher view` | Needs you |
| Unmarked old record, nothing else graded | ⚠️ | `Nothing new was marked on this card` | Needs you |
| Unmarked old record, other work graded | — | no push; logged as `school.push.suppressed` | — |

**Fallbacks:**
- With no child, the title becomes `⚠️ Unknown card — {Course}: {Lesson}`.
- With no labels, it becomes `⚠️ School card`.
- A missing clause is left out rather than rendered.

**Checked in code before being built** (each is dropped if the data isn't there;
nothing is guessed):
- **Late work.** Append ` · from Mon Sep 14` when the lesson's scheduled day is
  before today. This needs the scheduled date in the curriculum context.
- **Retake detection.** This needs the scan session to mark remediation retakes.
  If it doesn't, a retake reads as a normal ✅.

**Siren test.** Test calls pass `notification: null`, so a test never pushes.

## 2. Architecture and data flow

```
SchoolPrintScanConsumer / PianoLessonCeremonyBridge   (3_applications)
   │  1. resolve labels → { child, course, lesson, lessonIndex, lessonCount, scheduledDate }
   │     via courseDisplay / moduleDisplay (2_domains/school/curriculum/display.mjs)
   │     and resolveStudentName
   │  2. notification = composeSchoolPush(outcome, labels)   (2_domains/school/notifications, pure)
   ▼
SchoolGradingHookAdapter.fire({ ...outcome, notification })   (1_adapters, still a dumb pipe)
   │  toVariables() gains one key: notification (object | null)
   ▼
HA script.school_worksheet_scan_notification
   ├─ siren: branches on `result` (unchanged)
   └─ if notification: notify.<recipient> with title / message / data verbatim
```

**Components**

1. **`composeSchoolPush(outcome, labels)`** is pure. It returns
   `{ title, message, data: { tag, group, channel, importance, ttl } }` or `null`,
   and owns the emoji, the wording and the code → sentence map.
2. **`resolveStudentName(id)`** reads `display_name`, then `name`, then a title-cased
   id. It replaces the three copies of `getUserProfile(id)?.name` (in `app.mjs`, at
   both hook constructions, and in `schoolLifecycle.mjs`). Profiles have no `name`
   key, so those copies always fell back to the id.
3. **Label resolution** happens in the two callers, which already hold the
   curriculum context.
   - **Scans:** today the day's lesson slug arrives in the `unit` slot and `lesson`
     is always null. Resolve the real unit and lesson display titles instead.
   - **Piano:** the course title and "lesson N of M" come from the launcher's
     `status()`. The Plex rating key is never shown. The course-completion
     percentage is no longer presented as a score.
4. **Partial handling.** The scan consumer decides once per scan whether the
   unmarked-record case stands alone, and passes one composed notification or
   `null`. That ends the double-fire where one scan sent a push with no learner and
   another with a name.

**Delivery metadata**

- `tag: school-{learnerId}-{testId}`: a rescan replaces the earlier push.
- `group: school-{learnerId}`: one stack per child.
- `channel`: `School progress` (importance low) or `School needs you` (importance
  high).
- Android fixes a channel's importance the first time the phone sees that channel
  name. The new names start clean.
- The recipient stays hard-coded in the HA script, as it is today.

## 3. Household standard

This becomes `docs/reference/notifications/push-standard.md`, with a small shared
helper used by every producer.

1. **Names:** people via `resolveStudentName`; rooms and devices by their
   configured display names. Never a slug, id, UID or key in the title or body.
2. **Times:** local, and spoken-style (`until 6:13 PM`, `for 30 min`). Never ISO or
   UTC.
3. **Every push has a `tag`** keyed to its subject, so repeats replace instead of
   stacking. Repeats of the same state set `alert_once: true`.
4. **Every push has a `channel`** chosen by how loud it should be. `alarm_stream` is
   reserved for real safety events.
5. **Text is composed in code and unit-tested.** HA scripts relay it.

### DaylightStation producers brought up to the standard

| Push | Source | After |
|---|---|---|
| Kiosk shutdown | HA `public_kiosk_shutdown_cue.yaml` composes today | Backend composes `🔒 Kiosks locked — 30 min, until 6:13 PM`, with the trigger in plain words. `tag: kiosk-shutdown` + `alert_once`. The HA script relays. |
| Unknown NFC tag | `3_applications/trigger/TriggerDispatchService.mjs` | `🏷️ New tag tapped in the Living Room`. `tag: nfc-{uid}` + `alert_once`. The UID is only in the action payload. |
| TV failed | `3_applications/devices/services/WakeAndLoadService.mjs` | `📺 Living Room TV didn't turn on`. `tag: tv-{deviceId}` |
| Story time | `3_applications/school/workflows/NotifyReadingSessionFailure.mjs`, `app.mjs` | `📖 {Child}'s story time — the Living Room screen didn't respond` |
| Approval | `1_adapters/home-automation/donow/HaApprovalNotifier.mjs` | `tag: donow-{requestId}` + `alert_once`, so a re-send doesn't ring twice |

### HA automation follow-ups (edited in HA YAML, same standard)

| Automation | Defect (from the audit) | Change |
|---|---|---|
| Office Intruder Alert | `alarm_stream` bypasses DND on about 1.5 alerts a day; bursts of 6 re-alerts in 74 s | High-importance normal channel. `alert_once` on the shared tag. Re-alert only after the door closes and reopens past a cooldown. Say how long the door stayed open. |
| Print on Cooldown | Per-second countdown pushed to the laptop; each press fires twice | Remove the push. The cooldown is feedback for the button's own cue. If one is kept: one push per press window, with a tag. |
| Bedroom lamp unreachable | `1789881477 seconds` (age measured from 1970 because the bulb's last-reported time is empty); sent twice | Guard the empty timestamp (`never reported` / minutes). Tag it and plain-word the ending. |
| Dryer / Laundry Done | False "done after 6 minutes" right after a real finish; washer titled "Laundry" | Minimum cycle length and a restart debounce. Title it `Washer done`. |

## 4. Errors, testing and rollout

**Error handling**
- If composing or label resolution fails, the hook still fires with a fallback
  notification (`⚠️ School card` plus the child if known) and logs
  `school.push.compose-failed`. Grading and the siren are never affected (the
  fire-and-forget contract is unchanged).
- When the HA script receives no `notification` key (an old backend mid-deploy), it
  plays the siren only. Either deploy order is safe.
- Log events:
  - `school.push.composed` (debug: `outcome`, `channel`, `tag`)
  - `school.push.suppressed` (info: `reason`)
  - `school.push.compose-failed` (warn)

**Testing**
- **Composer:** a table test over every catalog row and fallback. A guard runs over
  all outputs and rejects `None`, `null`, `undefined`, `plex:`, kebab-case slugs, ISO
  timestamps and `?.`.
- **Replay:** the 161 real payloads from the audit, anonymised to learner ids like
  `user_4`. Every one composes to clean text or `null`, and the 8 "Partial then
  Passed" pairs yield exactly one push each.
- **`resolveStudentName`:** covers `display_name`, `name`, and a title-cased id.
- **Adapter:** `notification` passes through untouched, and the key set is stable.
- **Kiosk / NFC / TV / story time / approval composers:** the same guard, plus tag
  assertions.

**Rollout**
1. Sync local with the deployed homeserver tree, which is ahead of origin as of
   2026-09-22.
2. Ship the backend. The new `notification` variable is ignored by the old HA
   script.
3. Switch both HA scripts to relay mode, keeping a backup of the old YAML next to
   them.
4. Verify against real traffic: read the next school morning's pushes back from the
   HA recorder with the audit's query.
5. Update `docs/runbooks/school/home-assistant-grading-hook.md`. Its variable table
   lists `graded`, but the real results are `passed`, `needs_remediation`, `partial`,
   `review`, `unresolved`, `refused` and `satisfied`. It also needs the new
   `notification` key and the HA script's location.
