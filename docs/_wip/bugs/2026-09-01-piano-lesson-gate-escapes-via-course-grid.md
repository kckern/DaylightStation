# Piano: the "today's lesson" gate fails open for the whole 11 s cold read, only wraps the home menu anyway, and a lesson from the wrong course completes silently

**Date:** 2026-09-01
**Found by:** field observation — a learner "finished piano" and the agenda board did not turn green, before or after a refresh
**Status:** wiring traced end to end; three gaps identified; not fixed. Plan: `docs/_wip/plans/2026-09-01-sept-1-incident-remediation.md`
**Severity:** medium-high. The gate exists to make the assigned lesson the *only* thing on offer until it is done. Today it is not even a speed bump: for the first 11 seconds after a child picks their name the menu is fully open (the gate treats "still loading" as "not gated"), and even when the card does show, one Back from the assigned course lands on the open grid. Work done from either path is neither credited nor visibly rejected. The school side keeps asking for the lesson; the child believes they did it.
**Reference:** `docs/reference/school/teacher.md` (program obligations), `docs/reference/piano/` , `docs/_wip/bugs/2026-08-28-story-time-portal-launch-and-lost-attribution.md` (the last "completed on screen, recorded nowhere")

---

## What happened, from the log store

Learner `alan`. Plan (`household/school/plans/learners/alan.yml`) enrolls `piano-course` → **`plex:695598` Reading Music** (a season of *My Music Workshop*, 53 lessons; 10 done, last on 2026-08-29).

| Time (UTC) | Event | Meaning |
|---|---|---|
| 15:20:22 → 15:21:00 | `piano.lesson-gate.change gated=true learnerId=alan reason=owed`, `piano.lesson-gate.launch courseId=plex:695598 lessonId=plex:695611` ×3 | earlier visit: the gate **did** show for Alan (lesson *Meet the Eighth Note*) and he launched it — the endpoint and the card work |
| 17:00:59 | `piano.user.select id=alan` | picked himself on the kiosk; `usePianoLessonGate` starts a fresh read — status `loading`, which the hook reports as **not gated** |
| 17:01:03 | **`piano.menu-activity.open-course courseId=plex:695598 userId=alan`** | this event is logged only by `PianoMenuActivity` — the "recent courses" strip in the **not-gated** branch of `PianoMenu.jsx:70-79`. The full menu was on screen. He tapped his own Reading Music chip, 3.5 s after picking his name |
| — | *no* `piano.lesson-gate.change` for alan until **17:16:03** | the verdict from the 17:00:59 read never rendered: by the time it arrived the menu had unmounted (navigated to `/videos`) and the hook's generation guard discarded it |
| 17:01:18 | **`piano.course-open id=plex:694771`** | this event is emitted only by `CourseGridRoute` (`Videos.jsx:69`) — he was on the **course grid** and opened *Piano* (the sibling season of the same show) |
| 17:01:35–36 | `piano.courses.progress courses=10` ×2 | grid re-fetched progress for all ten courses |
| 17:01:50 | `piano.course-open id=plex:694771` | grid again → *Piano* again |
| 17:01:58 | `piano.video-play contentId=plex:694782` | *Lesson 9 · Hot Cross Buns: Part 2* |
| 17:05:41 | `piano.video-progress.record completed=true percent=90 userId=alan` | first completion; `completedAt: '2026-09-01T17:05:41.532Z'` stamped in his `video-progress.yml` |
| 17:06:04 | `… percent=100` | finished |
| 17:06:03 | `playback.completion-dispatch assetId=plex:694782 consumerRegistered=false` | no frontend consumer (normal for the piano player) |
| — | *no* `school.piano-ceremony.satisfied`, *no* `school.selfservice.status-board.refresh event=piano-lesson-complete`, *no* evidence row | |

Compare the working case earlier the same morning: milo's completion at 16:15:50 was followed within 350 ms by `school.scan.piano-lesson-complete` ("Piano done!") and a board refresh.

---

## Gap 0 — "still loading" is rendered as "not gated", and loading takes 11 seconds cold

`usePianoLessonGate.js` fails open by design for *failed* reads (documented in its header: a wrong `true` locks a child out of every mode). But it also fails open for an *in-flight* read: the initial snapshot is `open(learnerId, 'loading')`, and after a learner switch `current` is again `open(learnerId, 'loading')` until the fetch lands. `PianoMenu.jsx:50` reads `lessonGate.gated` alone — `status` is ignored — so the whole tile grid and the Activity strip render immediately.

How long is the window? Measured from this machine against prod at 17:12 UTC:

```
GET /api/v1/school/lifecycle/learners/alan/piano-lesson-gate   → 200 in 11.145 s   (cold)
GET …/piano-lesson-gate                                          → 200 in  0.352 s   (warm)
{"gated":true,"reason":"owed","course":"plex:695598","lesson":"plex:695611","lessonTitle":"Meet the Eighth Note"}
```

`GetPianoLessonGate` → `PianoCourseProgramLauncher.status()` → `GetPlayableUnits` → `fitnessPlayableService.getPlayableEpisodes(courseId)`, a Plex read of the whole course. Warm it is fine; cold it is eleven seconds of open menu. The hook then polls every 15 s, and a learner switch discards the in-flight answer (generation guard), so a child who taps anything within those seconds is through before the gate exists. The 15:20 visit worked because the kiosk had been sitting on Alan's name long enough for a warm answer.

Two fixes, both needed: treat non-guest `loading` as **pending** on the menu (tiles and strip disabled, "Checking today's lesson…", the same treatment curfew already uses), with a client-side ceiling after which it fails open with a warn; and make the cold read fast (memoise the gate verdict per learner on the server, invalidated by the same two School events the hook already listens for: `piano-lesson-complete`, `program-day-bypass-changed`).

## Gap 1 — the gate is a menu decoration, not a mode policy

`frontend/src/modules/Piano/PianoKiosk/PianoMenu.jsx:49-67`:

```jsx
const lessonGate = usePianoLessonGate(currentUser);
const gated = !curfew && lessonGate.gated;
…
{gated ? <TodaysLessonGate … /> : <> <PianoMenuActivity …/> <ul className="piano-menu__tiles">… </>}
```

That is the entire enforcement. `TodaysLessonGate` launches with `navigate(`${basePath}/videos/${courseId}`)` (`TodaysLessonGate.jsx:40`) — straight into the **Videos mode**, which is an ordinary routed flow (`Videos.jsx:30-60`):

```
index                → course grid   (CourseGridRoute — every course in every tab)
:courseId            → course detail
:courseId/:lectureId → player
```

with all navigation relative and Back = `navigate('..')` = "up". From the assigned course's detail page, one Back is the grid. Nothing under `/videos` — not `CourseGrid`, not `CourseDetail`, not `SubcourseNavigator` — reads the gate. `grep -n "gated\|lessonGate" modes/Videos/*.jsx` returns nothing.

So even when the gate *does* show, it says "you may only do Reading Music" and then hands the child a door into a room where Reading Music is one tile among ten. Today Alan reached the grid without the card; on the 15:20 visit he had the card and the same grid was one Back away.

(*Reading Music* and *Piano* are two seasons of one show, `My Music Workshop`, but the grid lists **seasons as course tiles** — `plex:694771` and `plex:695598` are both season ids — so `CourseDetail` for one season does not expose the other. The sibling escape is the grid, not season switching; `SubcourseNavigator`'s `SeasonList` only applies to shows labelled `subcourses`, where every season belongs to the same enrolled course and any lesson counts.)

## Gap 2 — the wrong-course completion is dropped without a trace

`backend/src/3_applications/school/PianoLessonCeremonyBridge.mjs:156-186`, `#handle`:

```js
for (const candidate of enrollments) {
  const candidateStatus = await this.#launcher.status({ userId, programInstance: candidateCourseId });
  const candidateCompletion = (candidateStatus?.completedLessonsToday ?? [])
    .find((row) => row?.lesson?.id === payload?.plexId);
  if (!candidateCompletion) continue;
  …
}
// The completed episode was not part of an enrolled Hoffman course.
if (!enrollment || !completion) return;          // ← silent
```

Correct policy — a Hot Cross Buns lesson must not discharge a Reading Music obligation — but the branch logs nothing at any level. The only trace of this event anywhere is the `completed=true` row in `piano.video-progress.record`, which looks identical to a successful one. Diagnosing today's case meant reading the plan file, the Plex metadata, and the bridge source by hand.

---

## Fix (proposed)

**Gap 0:** `PianoMenu` renders a *pending* state while `lessonGate.status === 'loading'` for a non-guest learner (tiles + strip disabled, "Checking today's lesson…"); the hook fails open only after a ceiling (`piano.lesson-gate.loading-timeout`, warn). Server side, `GetPianoLessonGate` memoises per learner and invalidates on `piano.lesson.completed` and bypass changes, so a warm read is the normal case.

**Gap 1:** `CourseGridRoute` calls the same `usePianoLessonGate(currentUser)`; while `gated`, it renders `<Navigate to={basePath} replace />` — a gated learner never sees the grid and Back from the assigned course lands on the lesson card, which is the only launcher they should have. Fail-open semantics are preserved: a School-less install or a failed read still gets the full grid.

Test shape (`Videos.policy.test.jsx` already exists for course policy): render the grid route with `gated=true` → assert no tiles and a navigation to `basePath`; with `gated=false` → tiles render.

**Gap 2:** in `#handle`, before the silent return, `this.#logger.info?.('school.piano-ceremony.ignored', { learnerId, plexId, reason: 'not-in-enrolled-course', enrolledCourseIds })`. One line; it would have made today's diagnosis a single log query.

Optional, worth discussing: should a completed lesson from a *non-enrolled* course be surfaced to the adult at all (Teacher Console note, receipt line)? Today the household has no record that the work happened except a `completedAt` in a per-user YAML.

---

## Non-findings

- The gate's API read did not *fail* (no `piano.lesson-gate.read-failed` at 17:01) — it was slow, and slow reads open the menu. Earlier in the day there were two runs of `read-failed … HTTP 502` (12:16–12:27, 16:07–16:08) while the container was restarting; those also open the menu, by design.
- `piano.school-access.verdict … learnerId=alan unlocked=false` is the separate **games** reward gate (`useSchoolGameAccess`); it was correctly closed and is unrelated.
- The completion pipeline itself is healthy: `completedAt` was stamped today, `newlyCompleted` was true, the bus event reached the bridge. It was rejected on policy, not lost.
- Refreshing the agenda can't help: Reading Music is still `pending` because it is still owed.
