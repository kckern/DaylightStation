# Piano: the "today's lesson" gate fails open for the whole 11 s cold read, only wraps the home menu anyway, and a lesson from the wrong course completes silently

**Date:** 2026-09-01
**Found by:** field observation — a learner "finished piano" and the agenda board did not turn green, before or after a refresh
**Status:** **fixed** on `fix/sept1-incident-remediation` (`08ad3e34c`, `d1e8b321a`, `197cb07ae`, `3c51a9211`, `d23571360`), awaiting merge and deploy. All three gaps are closed *for the routes named below*; **residual escape vectors remain and are enumerated in their own section** — that section is what `Videos.jsx`'s `NOTE (2026-09-01)` points at. Plan: `docs/_wip/plans/2026-09-01-sept-1-incident-remediation.md`
**Severity:** medium-high. The gate exists to make the assigned lesson the *only* thing on offer until it is done. Today it is not even a speed bump: for the first 11 seconds after a child picks their name the menu is fully open (the gate treats "still loading" as "not gated"), and even when the card does show, one Back from the assigned course lands on the open grid. Work done from either path is neither credited nor visibly rejected. The school side keeps asking for the lesson; the child believes they did it.
**Reference:** `docs/reference/school/teacher.md` (program obligations), `docs/reference/piano/` , `docs/_wip/bugs/2026-08-28-story-time-portal-launch-and-lost-attribution.md` (the last "completed on screen, recorded nowhere")

---

## What happened, from the log store

Learner `learner-c`. Plan (`household/school/plans/learners/learner-c.yml`) enrolls `piano-course` → **`plex:695598` Reading Music** (a season of *My Music Workshop*, 53 lessons; 10 done, last on 2026-08-29).

| Time (UTC) | Event | Meaning |
|---|---|---|
| 15:20:22 → 15:21:00 | `piano.lesson-gate.change gated=true learnerId=learner-c reason=owed`, `piano.lesson-gate.launch courseId=plex:695598 lessonId=plex:695611` ×3 | earlier visit: the gate **did** show for Learner C (lesson *Meet the Eighth Note*) and he launched it — the endpoint and the card work |
| 17:00:59 | `piano.user.select id=learner-c` | picked himself on the kiosk; `usePianoLessonGate` starts a fresh read — status `loading`, which the hook reports as **not gated** |
| 17:01:03 | **`piano.menu-activity.open-course courseId=plex:695598 userId=learner-c`** | this event is logged only by `PianoMenuActivity` — the "recent courses" strip in the **not-gated** branch of `PianoMenu.jsx:70-79`. The full menu was on screen. He tapped his own Reading Music chip, 3.5 s after picking his name |
| — | *no* `piano.lesson-gate.change` for learner-c until **17:16:03** | the verdict from the 17:00:59 read never rendered: by the time it arrived the menu had unmounted (navigated to `/videos`) and the hook's generation guard discarded it |
| 17:01:18 | **`piano.course-open id=plex:694771`** | this event is emitted only by `CourseGridRoute` (`Videos.jsx:69`) — he was on the **course grid** and opened *Piano* (the sibling season of the same show) |
| 17:01:35–36 | `piano.courses.progress courses=10` ×2 | grid re-fetched progress for all ten courses |
| 17:01:50 | `piano.course-open id=plex:694771` | grid again → *Piano* again |
| 17:01:58 | `piano.video-play contentId=plex:694782` | *Lesson 9 · Hot Cross Buns: Part 2* |
| 17:05:41 | `piano.video-progress.record completed=true percent=90 userId=learner-c` | first completion; `completedAt: '2026-09-01T17:05:41.532Z'` stamped in his `video-progress.yml` |
| 17:06:04 | `… percent=100` | finished |
| 17:06:03 | `playback.completion-dispatch assetId=plex:694782 consumerRegistered=false` | no frontend consumer (normal for the piano player) |
| — | *no* `school.piano-ceremony.satisfied`, *no* `school.selfservice.status-board.refresh event=piano-lesson-complete`, *no* evidence row | |

Compare the working case earlier the same morning: learner-a's completion at 16:15:50 was followed within 350 ms by `school.scan.piano-lesson-complete` ("Piano done!") and a board refresh.

---

## Gap 0 — "still loading" is rendered as "not gated", and loading takes 11 seconds cold

`usePianoLessonGate.js` fails open by design for *failed* reads (documented in its header: a wrong `true` locks a child out of every mode). But it also fails open for an *in-flight* read: the initial snapshot is `open(learnerId, 'loading')`, and after a learner switch `current` is again `open(learnerId, 'loading')` until the fetch lands. `PianoMenu.jsx:50` reads `lessonGate.gated` alone — `status` is ignored — so the whole tile grid and the Activity strip render immediately.

How long is the window? Measured from this machine against prod at 17:12 UTC:

```
GET /api/v1/school/lifecycle/learners/learner-c/piano-lesson-gate   → 200 in 11.145 s   (cold)
GET …/piano-lesson-gate                                          → 200 in  0.352 s   (warm)
{"gated":true,"reason":"owed","course":"plex:695598","lesson":"plex:695611","lessonTitle":"Meet the Eighth Note"}
```

`GetPianoLessonGate` → `PianoCourseProgramLauncher.status()` → `GetPlayableUnits` → `fitnessPlayableService.getPlayableEpisodes(courseId)`, a Plex read of the whole course. Warm it is fine; cold it is eleven seconds of open menu. The hook then polls every 15 s, and a learner switch discards the in-flight answer (generation guard), so a child who taps anything within those seconds is through before the gate exists. The 15:20 visit worked because the kiosk had been sitting on Learner C's name long enough for a warm answer.

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

So even when the gate *does* show, it says "you may only do Reading Music" and then hands the child a door into a room where Reading Music is one tile among ten. Today Learner C reached the grid without the card; on the 15:20 visit he had the card and the same grid was one Back away.

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

## As built (what actually shipped, and where it differs)

**Gap 0, client (`08ad3e34c`, then `d23571360`).** `usePianoLessonGate` gained `LOADING_CEILING_MS` and a `pending` flag; `PianoMenu` disables every tile and the activity strip while pending, under one caption. Three differences from the proposal:

- The ceiling is armed **once per learner**, not per request. The 15 s poll fires inside the window, so the plan's literal snippet — a request-generation guard inside the ceiling callback — never fires at all: the poll bumps the generation 5 s before each ceiling is due and the callback returns early. Measured against three readings of the snippet (`9b72f8a6a`; that commit also **retracts** the mechanism given in `08ad3e34c`, whose ablation was mislabelled — deleting the generation guard reaches the same behaviour, so the restructure was not forced, it was chosen for one timer per learner, an unmount that clears it, and correctness that does not rest on two guards interacting).
- `LOADING_CEILING_MS` is `REFRESH_MS + 5000` rather than a bare `20000`, so the stated coupling to the poll is executable rather than a comment.
- **A read that *fails* is pending too** (`d23571360`). The first cut shut the window where the read *hangs* and left open the one where it *answers with a failure*: a 500 at t=0.2 s put the menu in `status: 'error'`, `pending` false, every door open before a finger could land — the same escape with no pending window at all. A network error or 5xx now holds the learner pending and lets the 15 s poll be the retry; the ceiling still bounds the wait. A **4xx is exempt**: a School-less install answers 404 to every read, and making those learners wait out the ceiling on every pick is the fault the fail-open rule exists to prevent.
- `pending` and the caption live in the **hook**, not in each screen. Both the menu and the Videos grid had independently re-derived the guest rule and retyped the caption.

**Gap 0, server (`d1e8b321a`, `3c0f1c0ce`).** `GetPianoLessonGate` memoises per learner for 60 s, bounded at 64 entries (its key is an unvalidated URL param), handing out copies. Freshness comes from invalidation on `onCompletionInputChanged` — the one gateway seam that already fans out over completions, passed challenges, assignment edits and bypass grants — not from the TTL; the TTL only backstops what no event announces. `unavailable` is never memoised. **What this does not fix:** the 11.1 s. That is best explained as a cold miss in `FitnessPlayableService`'s own 5-minute structure cache (an *inference from the two timings, not a measurement* — nobody instrumented which layer spent the time), and the first caller after a container restart or five idle minutes still pays it in full. The client's pending state is what covers that; a boot-time warm or a longer structure TTL is the only thing that would remove it.

**Gap 1 (`3c51a9211`).** `CourseGridRoute` reads the gate: a gated named learner gets `<Navigate to={basePath} replace />` (logged as `piano.videos.grid-redirected` from an effect, so render stays pure), and a pending one gets the shared caption rather than a blank pane. `replace` so the grid leaves no history entry to bounce off. The **route the learner actually used** was PianoChrome's mode crumb, which navigates to `${basePath}/videos` — the grid — not a Back gesture from the course detail; the report's Back-from-detail path reaches the same place.

**Gap 2 (`197cb07ae`).** `school.piano-ceremony.ignored` at **info**, carrying `plexId`, `title`, `reason` and `enrolledCourseIds`. Info rather than warn: nothing is wrong, but it must be visible without turning debug on mid-incident. Volume stays low because the cheap "no piano enrollment at all" exit above it stays silent — a parent noodling never reaches this line.

---

## Residual escape vectors (open)

`3c51a9211` closes the **grid**. `CourseDetailRoute` and `LecturePlayerRoute` take `:courseId` straight from the URL with no gate read, so a gated learner who reaches a non-assigned course *without passing the grid* still plays it. Known routes there, strongest first:

1. **The exercise checkpoint `return` param — first-order, in-app, and the one the implementation missed.** `LecturePlayerRoute` builds `returnPath = ${pianoBase}/videos/${courseId}/${lectureId}` and persists it through `pianoLearningApi.rememberCheckpoint` as `returnTo`, and also passes it as the `return` query param. `Exercises.jsx:438,460` reads `query.get('return')` and, on a pass, calls `navigate(returnTo)` — a live deep link into an arbitrary course that never touches the grid. The exercises dashboard's Continue reads the same stored `returnTo`, so it survives a session.
2. **A verdict that flips to `gated`** while a non-assigned course is already on screen. The grid redirect never runs because the learner is not on the grid.
3. **History back/forward** onto a stale `/videos/<other-course>` entry.
4. **A reload or a watchdog remount** on a stale URL.
5. **A DoNow push** that dispatches a lesson to the kiosk.

**Why this is deferred, corrected.** The implementer gave two blockers. Review falsified the first:

- ~~"`course.id`'s shape is asserted nowhere, so comparing it to `:courseId` could eject a learner from the correct lesson."~~ **False.** `course.id` is the same value `pianoCourseLessonPath` already turns into the URL, and the transformation is pinned on both sides: `TodaysLessonGate.test.jsx:85` (`course.id = 'plex:1'` → `/piano/videos/1`) and `pianoContentOpen.test.js:102-103` (`pianoCourseLessonPath('/piano', 'plex:675689', 'plex:9001')` → `/piano/videos/675689/plex:9001`). `Videos.jsx` already normalises with `idOf()`.
- **Real blocker: the gate response carries one course, not the owed set.** `GetPianoLessonGate.mjs:153` documents *"More than one piano course is unusual but legal: gated while ANY is owed, showing the first owed lesson found"*. Strict equality against the single course the response names would evict a learner legitimately working a **second** owed course. Closing routes 1–5 needs an owed-*set* comparison, which needs the gate API to return the set — an API change, not a route guard.

---

## Non-findings

- The gate's API read did not *fail* (no `piano.lesson-gate.read-failed` at 17:01) — it was slow, and slow reads open the menu. Earlier in the day there were two runs of `read-failed … HTTP 502` (12:16–12:27, 16:07–16:08) while the container was restarting; those also open the menu, by design.
- `piano.school-access.verdict … learnerId=learner-c unlocked=false` is the separate **games** reward gate (`useSchoolGameAccess`); it was correctly closed and is unrelated.
- The completion pipeline itself is healthy: `completedAt` was stamped today, `newlyCompleted` was true, the bus event reached the bridge. It was rejected on policy, not lost.
- Refreshing the agenda can't help: Reading Music is still `pending` because it is still owed.
- The `piano.lesson-gate.read-failed … HTTP 502` runs at 12:16–12:27 and 16:07–16:08 opened the menu **by design at the time**. As of `d23571360` a 5xx no longer opens it — it holds the learner pending and lets the poll retry. A 404 still opens immediately.
