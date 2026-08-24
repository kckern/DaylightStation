# Dated modules — time-sensitive School curriculum

**Status:** Runtime framework built and merged 2026-08-23. Come Follow Me
content, syllabi, and learner enrollments remain pending.

Related: [enrollment and syllabi](../../reference/school/enrollment.md),
[time-sensitive planning](../../reference/school/timing-and-priority.md),
[School overview](../../reference/school/README.md).

---

## 1. The problem

Two curriculum shapes need different cursors.

In a **sequential** course — the atlas, `math-fractions` — position is earned.
The enrollment freezes `moduleOrder` and `lessonOrder`, and the cursor is "the
first thing not yet passed." The calendar is irrelevant: a lesson skipped in
June is the same lesson, equally valuable, in November. Missing a day costs
delay and nothing else. The queue is conserved, so there is never a backlog —
there is only ever one next.

In a **dated** course — Come Follow Me — position is set by the calendar. Each
of the 17 weekly modules (`w35-aug24` … `w51-dec14`) is pinned to a real week,
and most of its value is being in sync: studying Psalms the week the rest of
the household is on Psalms. Miss three days and the world moves on. Next should
mean the module whose window contains today, not the oldest unfinished one.
Earlier weeks do not vanish, but they demote from *the work* to *optional
catch-up*, and they never gate the current week.

> In a sequential course the learner's progress moves the cursor.
> In a dated course the clock moves the cursor, and progress is just what got
> picked up along the way.

### What the runtime does today

`come-follow-me-ot-2026/_index.yml` declares `mode: module_blocks`,
`required_opening_module: w35-aug24`, `one_active_module: true`. `planner.mjs`
(`blockerFor`, lines 159–164) reads that as: for every module earlier in
`moduleOrder`, if it is not passed, redirect the learner to its first unpassed
unit. A learner who skips a week in September is pinned to September for the
rest of the year, and the planner never asks what week it actually is.

### What exists, and the three gaps

Built: `2_domains/school/timing.mjs` (anchors, `materializeTiming`,
`evaluateTiming` → `upcoming | available | urgent | dormant | missed_target`),
deadline urgency, and focus-block budgets in `agenda.mjs`.

Missing:

1. **Timing is course-grained.** `timing-and-priority.md` §1 states it
   outright: timing attaches to an enrollment or standalone work, not to
   modules or lessons. `planner.mjs:234` confirms it — one `timing` per course
   entry. CFM needs 17 windows.
2. **Module dates are not machine-readable.** They live in a directory name
   (`w35-aug24`) and a title string (`Aug 24–30 · Psalms 49–86`). No
   `opensOn`/`closesOn` exists on a module anywhere in the schema.
3. **No "current wins, backlog optional" selection.** The only settings today
   are gate-strictly (`one_active_module`) or do not gate at all. Nothing
   expresses "week 38 is the work; weeks 35–37 stay open at lower rank and
   block nothing."

## 2. Decisions

| Question | Decision |
| --- | --- |
| Missed week | Open catch-up, no expiry. Never deleted, never dormant. |
| Daily pick | Current week first; when complete, the same block falls back to backlog. One block per day, as now. |
| Backlog order | **Newest first**, by `closesOn` descending. Last week outranks a week from September. |
| Week complete | All five day-lessons. Stubs roll into the backlog honestly. |
| Working ahead | Never. Future weeks stay `upcoming` and are not offered. |
| Date source | Authored per-module on the course; snapshotted onto the enrollment at enroll time. |
| Enrolled mid-course | Weeks that closed before the enrollment date are not assigned at all — not backlog. |

A consequence worth stating: with newest-first ordering and no expiry, stale
weeks sink and in practice are never worked. That is the correct outcome for
dated material — nothing is deleted, it just stops winning slots — and it means
no expiry knob and no parent chore are needed to keep the backlog from becoming
a guilt pile.

## 3. The model

A fourth progression mode alongside `sequential`, `module_blocks`, and the
standalone case:

```yaml
progression:
  mode: dated_modules
  module_order: fixed          # required; a dated course's order is its calendar
  lesson_order: shuffle_once   # unchanged: days within a week still freeze
```

`dated_modules` means three things:

1. **Modules never gate each other.** `blockerFor()` returns `null` across
   module boundaries. No `required_opening_module`, no "every earlier module
   must pass first," no `one_active_module`. Week 39 is reachable on Sep 21
   whether or not week 37 ever finished.
2. **Lessons still chain inside a module.** Day 3 of week 38 stays locked
   behind day 2, using the same frozen `lessonOrder` the atlas uses. Each
   module therefore contributes at most one `available` lesson.
3. **Each module carries its own window.**

`school.timing/v1` descends one level. Under `dated_modules` the planner reads
a `moduleSchedule` off the enrollment, evaluates timing per module, and stamps
every lesson in that module with the result:

```yaml
enrollment:
  schema: school.course-enrollment/v1
  moduleSchedule:                      # materialized at enroll from the course
    w35-aug24: { opensOn: '2026-08-24', closesOn: '2026-08-30' }
    w36-aug31: { opensOn: '2026-08-31', closesOn: '2026-09-06' }
```

The course-level `timing` field is unchanged and still serves Advent-style
courses. `moduleSchedule` is additive and consulted only in the new mode, so
no existing enrollment changes behavior.

## 4. The selection ladder

Everything lands on one new per-entry field, `timingRank` (integer, lower
wins), and one new timing state. No priority inflation, no focus blocks, no
displacement machinery: `agenda.mjs` groups by subject and takes `[0]` within
scripture, so ordering *inside* the subject is the only thing that matters.

A sibling of `evaluateTiming` — `evaluateDatedModule`, deliberately NOT
shape-compatible with it — decides one module's state:

| Module window vs. today | `timingState` | `status` | `timingRank` |
| --- | --- | --- | --- |
| Opens later | `upcoming` | `upcoming` | — |
| Contains today | `available` | `available` | `0` |
| Closed, lessons unfinished | `catch_up` (reason `window_closed`) | `available` | rank by `closesOn` desc (`1`, `2`, …) |
| Closed, all five passed | `available` | `completed` | — |

`catch_up` deliberately keeps `status: 'available'`. That is what keeps backlog
offerable, unlike `dormant`, which means a grown-up must intervene.

Sorting becomes `timingPriority → timingRank → position`. Base priority stays
`medium` for every CFM entry, so rank does all the work. The existing tiebreak
(`positionFor`, course sequence ascending) yields oldest-first, which is why
newest-first needs its own key rather than reusing position.

Scripture's candidate list on a Thursday:

```
w38 day 4   rank 0   <- picked
w37 day 3   rank 1
w35 day 2   rank 3
w39 day 1   upcoming — not a candidate
```

Worked through a fortnight:

```
Wed w38, 2/5 done          -> w38 day 3
Thu w38, 5/5 done          -> w37 day 3   (catch-up, newest backlog)
Fri w38, w37 also done     -> w36 day 1   (older backlog)
Mon w39                    -> w39 day 1   (new week wins outright)
```

When the current week is done and the backlog is empty, scripture has no
candidate. `agenda.mjs:158` then finds the next `upcoming` entry and already
prints `Starts 2026-09-21`. The caught-up state falls out for free.

## 5. Authoring and enrollment

### Course

`content/school/scripture/come-follow-me-ot-2026/_index.yml`:

```yaml
progression:
  mode: dated_modules        # was module_blocks
  module_order: fixed        # kept: still required, and still read at enrollment
  lesson_order: shuffle_once
  # required_opening_module and one_active_module drop out —
  # they are the strict-serial rules being removed
modules:
  - { module: w35-aug24, title: 'Aug 24–30 · Psalms 49–86',
      opensOn: '2026-08-24', closesOn: '2026-08-30' }
  # … 16 more
```

`curriculum/workValidation.mjs` gains: `dated_modules` requires a valid,
non-overlapping window on every module. A typo'd date fails the manifest rather
than silently stranding a week. (`catalog/moduleValidation.mjs` validates
*learning* modules — quizzes, lecture notes — and is not this.)

### Materialization

`createCourseEnrollment` copies those windows into `moduleSchedule` alongside
the `moduleOrder`/`lessonOrder` it already freezes — same snapshot discipline,
so editing the course later never moves a live plan. Modules closing before the
enrollment date are omitted entirely.

### Enrolling Milo and Felix

`EnrollLearner` requires a `syllabusId`, and `plans/syllabi/` does not exist —
no syllabus has ever been authored, and there is still no console UI to create
one. Author `plans/syllabi/come-follow-me-ot-2026.yml` by hand once, then enroll
both learners through
`POST /api/v1/school/lifecycle/enrollments/:learnerId` with teacher
credentials.

The syllabus route is preferred over hand-editing both learner plans because:

- the 17 date pairs are authored once and materialized twice, instead of being
  duplicated per learner and kept in sync by hand;
- `teacherGate`, the stale-save guard, and the history append to
  `records/plans/learners/{id}.yml` exist only on the use-case path;
- `rematerialize: true` handles the 2027 roll-over and refuses while a learner
  is mid-worksheet — a hand-edit has no equivalent check;
- it avoids repeating the pattern `enrollment.md` records, where
  `createCourseEnrollment` sat tested and uncalled while every production
  enrollment was hand-typed.

Profiles follow their atlas enrollments: **Milo `lower`, Felix `upper`**,
matching the 6-question/3–4-choice and 10-question/5-choice splits the course
already declares.

## 6. Tests

1. A dated course offers the module whose window contains today, while an
   earlier module has unfinished lessons.
2. Backlog is offered newest-first once the current week is complete.
3. An unfinished earlier module never blocks a later one (`blockerFor` returns
   null across module boundaries) while lessons still chain within a module.
4. A future module stays `upcoming` and is never offered, even with an empty
   backlog; the agenda shows its opening date.
5. Backlog does not expire: a module closed eight weeks ago is still
   `catch_up`, not `dormant`.
6. An in-progress worksheet on a closed module remains resumable.
7. Enrolling after a module has closed omits it from `moduleSchedule` rather
   than creating backlog.
8. `workValidation` rejects `dated_modules` with a missing or malformed window,
   and rejects overlapping windows.
9. Existing `module_blocks` and `sequential` courses are unaffected —
   the atlas keeps its strict serial chain.
