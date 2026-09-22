# Home Assistant push notifications — user-facing audit

**Date:** 2026-09-22
**Window:** 2026-08-23 → 2026-09-22 (30 days)
**Source:** HA recorder DB, `call_service` events where `domain = notify` (read-only
query; the recorder retains events back to early July). 305 notifications.
**Lens:** what the recipient actually sees on the lock screen. Every quoted string
below is the rendered text as delivered, with learner names replaced by Learner A–D.

## Volume

| Count | Title | Producer |
|---|---|---|
| 161 | `Worksheet …` | DaylightStation `SchoolGradingHookAdapter` → HA `script.school_worksheet_scan_notification` |
| 44 | `⚠️ Office Intruder Alert` | HA automation |
| 29 | `Print on Cooldown` (to the laptop) | HA automation |
| 25 | *(no title)* `clear_notification` | HA automation (intruder auto-clear) |
| 23 + 2 | `Dryer Done` / `Laundry Done` | HA automation |
| 10 | `Public kiosk shutdown` | DaylightStation |
| 11 | NFC tag, approvals, lamp, TV, story time | mixed |

School is 53% of the stream: 5–6 a day, peaking at 14 (2026-09-21).

---

## Part 1 — Worksheet notifications (161)

Two producers share one HA script and one template:

- **Card scans** (`grading_hook`, 85): `SchoolPrintScanConsumer` → results `passed`,
  `needs_remediation`, `partial`, `review`, `unresolved`.
- **Piano video lessons** (`piano_lesson_hook`, 76): `PianoLessonCeremonyBridge` →
  result `satisfied`.

The template renders
`{student} — {course} / {unit} / {lesson}. Score: {earned}/{total} ({percent}%).`
for every result.

### 1.1 Literal `None` in 97 of 161 (60%)

| Rendered | Count |
|---|---|
| `None — None / None / None. Score: None/None (None%).` | 11 |
| `Learner A — None / None / None. Score: None/None (None%).` | 10 |
| `… Score: None/None (18%).` (every piano lesson) | 76 |
| `… / None.` in the lesson slot (every card scan) | 85 |

**Cause:** Jinja `default('?')` fills only *undefined* variables. The adapter sends
every key, with `null` when it does not apply (a documented contract, so templates
don't need `is defined` guards). So `null` renders as `None`. The fix is
`default('?', true)`, or better, a template that leaves the clause out entirely.

### 1.2 Names are ids, not display names

Every notification reads `user_1 —`, `user_2 —` and so on, in lowercase.

**Cause:** both hooks resolve the student with
`configService.getUserProfile(id)?.name ?? id` (`backend/src/app.mjs:4036`, `:4269`,
and `schoolLifecycle.mjs:1204`). Profiles store `display_name` and have no `name`
key, so the lookup always falls back to the id. The same bug reaches the
story-time notification (`user_3 started story time…`).

### 1.3 Course, unit and lesson are raw ids, in the wrong slots

| Rendered | What it should say |
|---|---|
| `come-follow-me-ot-2026 / cfm-w35-d2-psalms-62-69 / None` | *Come, Follow Me — Psalms 62–69* |
| `young-peoples-atlas-us / atlas-us-p100-south-dakota / None` | *U.S. Atlas — South Dakota* |
| `elementary-math-2-3 / em23-01-01-place-value-to-1-000 / None` | *Math 2–3 · Unit 1 — Place value to 1,000* |
| `national-geographic-book-of-mammals / mammals-felines-bobcat / None` | *Mammals — Bobcat* |
| `plex:675689 / None / How to Play "Dinah" on Piano` | *Piano — How to Play "Dinah"* |

- **Card scans:** `unit` carries the day's lesson slug (`curriculum.unitId`), and
  `lesson` (`curriculum.lessonId`) is `null` on all 85. The real lesson name lands in
  the unit slot as a slug, and the lesson slot is always `None`.
- **Piano:** `course` is a Plex rating key (`plex:675689`) and `unit` is always
  `None`. Only the lesson title is human-readable.
- Slugs mangle numbers: `place-value-to-1-000` is "1,000", and `psalms-62-69` is a
  range.
- Display helpers already exist (`2_domains/school/curriculum/display.mjs`:
  `courseDisplay`, `moduleDisplay`, `compactCourseModuleLabel`), but the hook payload
  doesn't use them.

### 1.4 The piano "percent" is course progress, presented as a score

`Score: None/None (18%)` reads as "scored 18%". The value is
`PianoCourseProgramLauncher.status().score = completed / total lessons in the
course`, so it is **course completion**, not performance on today's lesson. As a
result:

- Learner A's number climbs 10% → 19% over the month, one point every few lessons.
  That looks like a failing streak.
- Learner D moved to a different course on 2026-09-16, and the "score" fell from
  97% to 2% overnight.
- A completed lesson (the thing being announced) shows under 20% for the older
  learners.

### 1.5 The result vocabulary mixes three kinds of thing

| Title | What it is |
|---|---|
| `Worksheet Passed`, `Worksheet Needs_remediation` | a grade |
| `Worksheet Partial`, `Worksheet Review`, `Worksheet Unresolved` | a processing state (the scan did not finish grading) |
| `Worksheet Satisfied` | a completion of a *video lesson*, which is not a worksheet |

- `Needs_remediation` is a snake_case enum run through `| title`.
- "Satisfied" is internal gradebook jargon.
- 76 of the 161 "Worksheet" notifications are about piano videos.
- Any ordinary outcome, like a clean pass, looks the same as one that needs a
  parent, like a card that could not be read. The title never says what, if
  anything, the reader should do.

### 1.6 "Partial" is noise, and it contradicts the notification after it

- All 19 carry no content (see 1.1). `code` (`partial_scan` /
  `live_record_unmarked`) and `test_id` are sent but not rendered.
- 8 of 19 are followed **within a minute** by `Passed` for the same learner
  (09-03 17:43, 09-04 19:12, 09-06 19:21, 09-15 08:19, 09-18 14:42, 09-21 08:19,
  09-21 08:28, 09-22 07:58). This is the `live_record_unmarked` path: a cumulative
  card carrying an older, already-satisfied record with no marks. The child did
  nothing wrong, but the parent sees an alarm and then a pass.
- A single scan can fire two Partials at once, one with no learner and one with a
  name (09-18 15:11:53 ×2), because both call sites fire for the same card.
- Re-feeds stack up: four Partials for Learner A between 08:19 and 08:34 on 09-21.

### 1.7 Unresolved and Review can't be acted on

- `Worksheet Unresolved` ×2, 39 s apart (08-28): no learner, no worksheet, no
  reason. `code` is sent but not rendered.
- `Worksheet Review` (09-07): names the worksheet, but not what needs reviewing.
  `pending_review`, `reasons` and `items` are sent but not rendered, and there's no
  tap action to the teacher view.

### 1.8 Retakes read as clean passes

09-20 11:46 `Needs_remediation … round-numbers … 3/6 (50%)` is followed at 11:52 by
`Passed … round-numbers … 3/3 (100%)`. The second is a retake of the missed items,
but nothing says so. "3/3 (100%)" overstates it; "cleared remediation" is the true
statement.

### 1.9 Number formatting

- `16.67%`, `33.33%`, `83.33%`: two decimals on a 6-question sheet.
- `Score: 9/10 (90%)` repeats the same fact twice.
- Double punctuation: `What Are Flats in Music?.`, `Which Staff is the Real one?.`,
  because the template appends `.` after a title that already ends in `?`.
- Raw Plex titles with pipes: `Solfege Sing-Along | Lesson 2 | Do Re Mi Fa Sol`.

### 1.10 Delivery metadata

- No `data:` block on any school notification. That means:
  - no `tag`, so each one stacks instead of replacing the last;
  - no `group`;
  - no `channel`, so school shares the default Android channel and can't be muted
    or prioritised on its own;
  - no tap action.
- Late work isn't flagged. A 09-20 scan was for week 37 day 2 (a week behind), and
  it looks like any other pass.
- A siren test fired a real `Worksheet Passed` with fake data
  (`Siren test — Manual test / Tone 2 / Pass sound. Score: 9/10`), because the script
  couples the tone and the push.
- One push per event, with no daily summary. The parent-useful signal (who
  finished, who needs help) is spread across about 5 pushes a day. Most of those are
  "nothing to do".

---

## Part 2 — Everything else (144)

### 2.1 Office Intruder Alert (44 + 25 clears)

- Uses the `alarm_stream` channel, so it bypasses Do Not Disturb. The volume shows
  this is not an alarm-grade signal: 44 in 30 days, usually on weekday daytimes.
- Bursts of re-alerts: 6 in 74 s (08-24 08:15–08:16) and 6 in 6 min (08-27
  14:44–14:50). The shared `tag` replaces the card, but every re-send alerts again.
- `Office door opened while you're away.` doesn't say who was home or how long the
  door stayed open. *Unverified:* whether "away" is correct at these times. The
  frequency suggests household members are tripping it.
- 25 bare `clear_notification` service calls (the auto-clear 10 minutes later). They
  are harmless on the device, but they make up 8% of the notify log.

### 2.2 Print on Cooldown (29, to the laptop)

- A countdown sent as push: `Please wait 175 more seconds`, `174`, `168`, `167`… up
  to 7 within 17 s.
- They arrive in pairs 1 s apart, so each press fires twice.
- The message doesn't say which printer or what was refused.
- This belongs in the UI that triggered the print, not in push.

### 2.3 Bedroom lamp unreachable (2)

`bulb has not reported for 1789881477 seconds` is 56 years. The bulb's
last-reported time is empty or zero, so the age is measured from 1970. It fired twice,
63 s apart. It also ends in jargon: "automation aborted without recovery attempts".

### 2.4 Public kiosk shutdown (10)

`Lockdown started from nfc-shutdown. Kiosks stay unavailable until 2026-08-28T01:13:29.185Z.`

- The end time is raw UTC ISO with milliseconds. Here, 01:13Z means 6:13 PM local,
  which is a 30-minute lockdown. The reader has to do timezone arithmetic to find
  that out.
- `nfc-shutdown` is an internal trigger id.
- Duplicated 3 s apart (09-17 08:43:40 / :42), and the two show different end
  times.
- No tap action to end the lockdown early.

### 2.5 Dryer / Laundry Done (25)

- There are implausible cycles: `after 6 minutes` twice, each 6–10 min after a
  previous "done" (09-17 14:30, 09-18 11:05), and `Wash cycle complete after
  6/8 minutes`. These look like power-sensor restarts reported as completions.
- "Laundry Done" for the washer against "Dryer Done" is inconsistent naming. The
  washer title should say washer.

### 2.6 Smaller ones

- `Unknown NFC tag at livingroom — Tap "Add note" to name tag 04aa660fcb2a81`: a room
  slug and raw hex UID. It was sent twice 31 s apart for the same tag.
- `TV failed to turn on — livingroom-tv did not respond after retry`: a device slug,
  with no action (retry / open remote).
- `Story time screen needs help — user_3 started story time at livingroom…`: an id
  name and a room slug (1.2 applies).
- `Approval needed` was re-sent for the same request id (13:02:46 and 13:03:54,
  `dnr_BxU63PtA`), so it rang twice. The approve/deny actions themselves are the
  best-built notification in the set.

---

## Cross-cutting

1. **ids leak everywhere:** learner ids, room slugs (`livingroom`), device slugs
   (`livingroom-tv`), trigger ids (`nfc-shutdown`), curriculum slugs, Plex keys and
   NFC UIDs. Every producer has a display name available; none of them uses it.
2. **Nothing is de-duplicated** (NFC, kiosk shutdown, approval, lamp, print
   cooldown, partial). The grading hook's "no dedup by design" makes sense for the
   room siren, but not for the phone.
3. **Timestamps:** only one producer includes a time, and it is UTC.
4. **Priority is inverted:** the loudest channel (alarm stream, bypasses DND) carries
   the most false-positive-looking alert, while school and appliance pushes have no
   channel at all.
5. **Push is doing UI's job:** cooldown countdowns and piano progress toasts would
   be better as in-app feedback or a daily digest.
