# Lesson-level pacing and agenda-aware receipts

Status: design, rev 2 (2026-08-26). Rev 1 was reviewed against the source and
failed on four counts; this rewrite fixes them and records what changed in §10.

Extends [time-sensitive planning](../../reference/school/timing-and-priority.md)
and [agenda and completion](../../reference/school/agenda-and-completion.md).

## Terminology

| Code | Example | Colloquially |
| --- | --- | --- |
| course | `come-follow-me-ot-2026` | course |
| module | `w35-aug24` | the week |
| unit | `cfm-w35-d3-psalms-70-77` | the lesson |

"Lesson" below always means a **unit**.

## 1. The problem

Two complaints from 2026-08-26, one root: **the lesson layer is date-blind and
the result receipt is subject-blind.**

**User_4 was handed Tuesday's lesson on Wednesday.** Time sensitivity exists only
at the module level. `evaluateDatedModule` answers `upcoming` / `available` /
`catch_up` for a *window*; lessons inside a module carry no dates and are gated
as strict prerequisites by `blockerFor`. `d1…d5` are the publisher's day labels
carried as text — nothing knows `d3` means Wednesday. User_4 got `d2` because it
was the first unpassed entry.

The week is 5 lessons in a 7-day window (`opensOn: 2026-08-24`,
`closesOn: 2026-08-30`), so there is no day-to-lesson mapping to recover.

**The receipt offers "one more of the same course" unconditionally.** On a pass,
`CloseSessionOutcome#settle` mints at most one forward action, always for
`unit.subject`, captioned *"Today is already complete. Scan only if you want one
more."* — printed while other subjects sit untouched.

## 2. Scope, in two slices

**Slice 1 — the cross-subject receipt.** Fixes complaint 2. Touches
`CloseSessionOutcome` and receipt copy only; no planner, no timing, no
enrollment. Independently shippable and independently valuable.

**Slice 2 — lesson-level pacing.** Fixes complaint 1. Per-lesson due dates, a
per-course day-level mode, and a backlog ladder.

They are separable and Slice 1 must not wait on Slice 2.

Out of scope: a timing editor UI; changing how module windows are authored; any
change to issued paper, scan evidence, or frozen report-card history.

---

# Slice 1 — the cross-subject receipt

## 3. What it does

`#settle` picks its forward action from the agenda `sections` its own
`#projectPlan` already returns. **Exactly one action, and the tiers are mutually
exclusive** — the first that matches wins and the others are not minted.

| # | Offer | Token | Eyebrow |
| --- | --- | --- | --- |
| 1 | The first unserved **curriculum** subject's next action | that subject, `continueToday: false` | `Next up` |
| 2 | Overdue backlog in this subject | this subject, `continueToday: true` | `Catch up` |
| 3 | The next lesson in this subject | this subject, `continueToday: true` | `One more?` |

Tier 1's rule is **"the first unserved subject in the agenda's fixed shelf
order"** — stated plainly because the agenda has no cross-subject ranking to
borrow authority from (`agenda.mjs` builds sections in fixed subject order, and
the focus pass explicitly disclaims being a child-facing priority sort).

Exclusivity matters: tiers 2 and 3 mint the *same shape* of token
(`subject_next {learnerId, subject, continueToday: true}`), and resolution picks
one winner from `[...inProgress, ...available]`. If both printed, the "One more?"
QR would resolve to the catch-up lesson and the label would be a lie.

## 4. Program subjects are skipped in tier 1

`CloseSessionOutcome` builds its `PlanProjection` **with no launchers**, by
design and by comment, and composition keeps it that way. So program sections in
this projection have no daily status.

Rev 1 proposed flipping `assignedPrograms: true`. That is wrong: with no
launchers, `collectProgramStatuses` throws per program and every program section
reads `programUnavailable` — tier 1 would never offer piano, the opposite of the
intended fix, plus a warn line per program per settle.

**Tier 1 therefore considers curriculum sections only.** A program subject is
never offered by the receipt. This is a deliberate, stated limitation, not an
oversight: the receipt cannot honestly speak about program status without a
launcher-wired projection, and injecting one is a composition change with wider
blast radius than this slice earns.

Also unchanged, and also stated: `attested: false, exceptions: false` remain. The
receipt's projection is therefore *not* identical to the panel's. Rev 1 claimed
"paper and panel cannot disagree"; that claim is withdrawn. What is true is
narrower: tier 1 offers a subject the receipt's own projection shows as
unserved.

## 5. The minting gate must be restructured

Today the forward action is minted only `if (passed && unlocked && ...)`, and
`unlocks` is null on a module's last lesson (pinned by a planner test).

Tier 2 must fire exactly when there *is* backlog and possibly no next lesson —
d5 passed on Friday with d2 unfinished is the case that matters most. So the
gate becomes: `passed && learnerId && unit?.subject`, with the tier ladder
deciding whether an action exists at all.

`#nextUnlocked` stops being the gate and becomes tier 3's input only.

## 6. Copy

*"Today is already complete"* is printed today while other subjects sit
untouched. It becomes true only in tier 3. Tiers 1 and 2 get their own lines.

When every subject is served and no backlog exists there is no action: the
receipt prints the day's tally and no QR — the honest end of a finished day.

A test currently pins the old string; it is updated as part of this slice.

---

# Slice 2 — lesson-level pacing

## 7. The date model

### 7.1 Where dates live

| Level | Today | After |
| --- | --- | --- |
| course | `assignment.courses[].timing`, has `target.dueOn` | unchanged |
| module | `enrollment.moduleSchedule[id]` → `opensOn`/`closesOn` | unchanged |
| unit | *nothing* | `enrollment.lessonSchedule[unitId]` → `dueOn` |

`planner.mjs` reads a course unit's timing from the **enrollment**, so every
lesson in a course shares one timing object. This adds a per-lesson slot.

### 7.2 `lessonSchedule`

A sibling of `moduleSchedule`, frozen onto the enrollment the same way, flat and
keyed by `unitId`:

```yaml
enrollment:
  moduleSchedule:
    w35-aug24: { opensOn: '2026-08-24', closesOn: '2026-08-30' }
  lessonSchedule:                          # NEW
    cfm-w35-d1-psalms-49-61: { dueOn: '2026-08-24' }
    cfm-w35-d2-psalms-62-69: { dueOn: '2026-08-25' }
    cfm-w35-d3-psalms-70-77: { dueOn: '2026-08-26' }
    cfm-w35-d4-psalm-78:     { dueOn: '2026-08-27' }
    cfm-w35-d5-psalms-85-86: { dueOn: '2026-08-28' }
```

`dueOn` **only**. The module window already answers "is this offerable", and a
second availability source would be a second answer to drift from.

### 7.3 The cascade

```
module window  ──derives──▶  lesson dueOn   (spread over the enrollment's school days)
```

One direction, one step. Spreading N lessons across a window on a known school
calendar is deterministic.

**Cut from rev 1:** the `explicit` strategy (no motivating course exists) and
upward validation of a course-level `dueOn` against module windows (it would
validate a mutable field exactly once, so it does not deliver the guarantee it
names). Both are YAGNI until something needs them.

### 7.4 The policy

```yaml
policy:
  mode: dated_modules
  lesson_order: dated      # NEW value; today fixed | shuffle_once
```

`lesson_order: dated` means **lessons are peers, not prerequisites**: each is
independently available inside its open module, ordered by date. Correct for a
calendar-shaped course (Psalms 70–77 does not require Psalms 62–69); wrong for a
cumulative one, which opts out by doing nothing.

No `lesson_pacing` schema wrapper — a single enum value does not need one.

**`ORDERING` must not simply gain `dated`.** `workValidation.mjs` uses one
`ORDERING` list for *both* `module_order` and `lesson_order`, so adding `dated`
there would legalize `module_order: dated`. A separate `LESSON_ORDERING` list is
introduced, and `syllabus.mjs` — which carries its own orderings list through
which a syllabus can override `lesson_order` — is updated to match. `dated`
additionally requires `mode: dated_modules`.

### 7.5 Spreading

Walk the module window's school days (from the enrollment's existing `schedule`,
via `schoolCalendar.mjs`) and assign `lessonOrder[n]` to school-day *n*.

- **More lessons than school days:** the tail doubles up on the last school day.
  Two lessons sharing a `dueOn` is well-defined; the tiebreak is `lessonOrder`
  position, which is total.
- **Zero school days in the window** (a module sitting entirely inside an
  `except` vacation span — a real case; the planner's own tests use one): fall
  back to spreading across the window's calendar days. Rev 1 would have rejected
  the enrollment, meaning one vacation week refuses a 52-week course.

### 7.6 Migration — how a live enrollment gets paced

Enrollment policy is snapshotted at materialization and `policyFor` prefers the
snapshot, so an existing enrollment never acquires `lessonSchedule` on its own.
Rev 1's "no migration needed" meant the fix reached nobody, including User_4.

Re-enrolling is **not** an acceptable migration: `createCourseEnrollment` drops
modules already closed at enrollment time, which would erase exactly the backlog
this design exists to surface.

**A re-pacing operation** is therefore part of this slice: for an existing
enrollment it computes `lessonSchedule` from the enrollment's *existing*
`moduleSchedule` and `lessonOrder`, and sets `progression.lesson_order: dated`
on the snapshot. Membership, module order and lesson order are untouched. It is
idempotent and it is the only supported way to pace a live course.

## 8. Selection

### 8.1 A dedicated evaluator

Rev 1 said "stop skipping `evaluateTiming` and merge". That cannot work:
`evaluateTiming`'s default `urgencyLeadDays` is **7**, so every lesson in a
7-day module is inside the urgency lead and returns state `urgent`, priority 1 —
flattening the whole ladder and violating §8.2 for every lesson. Three of the
four rows are unreachable through it besides (priority 2 needs
`basePriority: high`, priority 4 needs `low`, and an overdue aspirational target
returns `basePriority` with no path to 1).

So a **pure `evaluateDatedLesson()`** is added to `timing.mjs` alongside
`evaluateDatedModule`, and it sets state, priority and rank explicitly:

| Situation | `timingState` | `timingPriority` | `timingRank` |
| --- | --- | --- | --- |
| session past `created` | `in_progress` | 0 | 0 |
| open module, overdue, **≥2 behind** | `missed_target` | 1 | index in overdue (0 = oldest) |
| open module, due today | `available` | 2 | 0 |
| open module, overdue, 1 behind | `missed_target` | 3 | index in overdue |
| open module, due later | `available` | 4 | days until due |
| **closed** module | `catch_up` | 6 | module recency (1 = newest) |

Every row has a state, because `timingState` is load-bearing in four places.
Note `due today` is `available`: §8.4's obligation fix depends on it.

Closed-module lessons get their own priority band (**6**) rather than today's
medium. Two reasons: it keeps `timingRank`'s three incommensurable scales
(overdue index / days-until-due / module recency) from ever being compared
across bands, and backlog from a closed week should yield to the current week.
Relative order *among* closed modules is unchanged, so the pinned newest-first
test still holds. **This is a deliberate behavioural change and is called out
because it is one.**

### 8.2 Backlog raises priority, never state

`focusExtras` and `focusBudget` key off `timingState === 'urgent'`, not off
`timingPriority` — verified by grepping every consumer; nothing branches on the
priority number, it is only ever sorted.

So backlog pressure lifts the **priority number** to 1 while leaving
`timingState` at `missed_target`. `focusExtras` returns 0 structurally, so a
behind subject can never displace another subject, and `focusBudget` stays 1, so
a subject is still served after one pass. The backlog lesson is reachable only
through the receipt's tier 2.

### 8.3 A pre-created session is not work in hand

**This is what defeated rev 1's acceptance test.** `BuildAgenda` calls
`ensureSession` for every entry it prints, which appends a `created` event.
`openByUnit` filters only on `!terminal`, so that bare session makes the entry
`in_progress` at priority 0 — and Wednesday's panel offers Tuesday's lesson
again, which is the original complaint.

The rule's own justification is *"a child holding a printed sheet must be able
to finish it"*. A `created` session is not a printed sheet; nothing was issued,
dispatched or answered.

**For dated lessons, priority 0 requires the session to have progressed past
`created`.** A bare `created` session is an agenda placeholder and does not
preempt the ladder. Non-dated courses keep today's behaviour exactly — this is
scoped deliberately, because the same argument probably applies globally and
that is a larger change than this design should make.

### 8.4 Obligation

`agenda.mjs` excuses a subject as `not_due_yet` when its actionable work is
`available` and has a `target.dueOn`. The predicate tests whether a due date
**exists**, not whether it has **arrived**.

Rev 1 called that branch "effectively dead". It is not: for non-dated entries it
is currently *sound*, because `evaluateTiming` only returns `available` beside a
target when today is more than `urgencyLeadDays` before it — so "exists" already
entails "hasn't arrived". The live hazard is narrower and exists today: a dated
entry whose course-level timing carries `target.dueOn` is spread onto
`entry.timing` with `timingState` from the module, hitting the branch already.

Fix either way: compare the date.

```js
e.timing?.target?.dueOn > today     // "isn't due yet", not "has a due date"
```

Obligation then follows **`dueOn <= today`**.

Rev 1 also claimed `noSchoolToday` "is checked earlier and short-circuits". It
does not — it is applied as an override *after* the ladder, and the code
documents at length why it deliberately does not short-circuit. The verdict is
unchanged; the mechanism claim was wrong and is corrected here.

Two neighbouring flags:

- `isBacklog` stays **module**-level, so only a closed week excuses as
  `optional_backlog`; an overdue lesson inside the open week still obligates.
- `catchUp` widens to include an overdue lesson in the open module.

These two are currently derived from one predicate precisely so paper and policy
cannot disagree. Splitting them breaks that invariant, so `catchUp` gains its
own explicit definition and a test pins both.

### 8.5 Sequence dissolution must not swallow a fault

Today a dated unit in a module with **no window** produces: locked entry →
blocker `upcoming` with reason `not_scheduled` → `isTimeHeld` false → chain
unreachable → **`faulted`**. The code's own words: *"waiting for a date that will
never exist."*

With `blockerFor` returning null for dated lessons, nothing is ever locked, so
that fault path is unreachable and the section falls through to `opens_later` →
**excused**. A broken course would silently read as a legitimate day off.

So: **a dated lesson whose module carries no window is `faulted`
(`not_scheduled`) directly**, without needing a locked entry to carry it. A test
pins it.

### 8.6 Planner changes, summarised

1. `blockerFor` returns null for within-module ordering when
   `lesson_order: dated`. Module-level gating is untouched (it never went
   through `blockerFor`).
2. Each dated lesson's entry is built from `evaluateDatedLesson`, using its own
   `lessonSchedule[unitId].dueOn`.
3. The pre-pass that computes `datedRankByModule` gains an `overdue` list and
   `backlogPressure` flag per dated course.
4. The `in_progress` short-circuit consults session state, per §8.3.

## 9. Validation and failure

- `LESSON_ORDERING` gains `dated` (separate from `module_order`'s list);
  `syllabus.mjs` updated to match; `dated` requires `mode: dated_modules`.
- Re-pacing (§7.6) rejects only on an unusable module window.
- **Runtime failures fail toward offerable.** A lesson with a missing or
  unparseable `dueOn` loses its date, sorts last at priority 4, stays available,
  and logs. The ordinary `evaluateTiming` path would make it `dormant`, which
  requires a parent to revive — wrong for one lesson.
- **No silent migration.** `lesson_order` defaults to `fixed`, so every existing
  enrollment behaves exactly as today until §7.6 is run against it.

## 10. Tests

Slice 1:
- one test per tier, including exclusivity (tier 1 firing means no tier 2/3 QR)
- tier 2 fires when `unlocks` is null (the Friday-d5 case)
- a program subject is never offered by tier 1
- updated copy assertion (replaces the pinned "Today is already complete")

Slice 2, pure domain:
- `evaluateDatedLesson`, one case per row of §8.1, open and closed modules
- the spread reproduces §7.2 from User_4's real `w35-aug24` window
- spread with zero school days falls back to calendar days
- spread with more lessons than school days doubles up on the last

Guards:
- a lesson due **today** still obligates (§8.4)
- a 2-behind subject suppresses no other subject (§8.2)
- a bare `created` session does not preempt today's lesson (§8.3)
- a window-less dated module still faults (§8.5)
- `catchUp` and `isBacklog` agree where they still should (§8.4)

Regression:
- a `fixed` course picks the identical lesson before and after
- the pinned newest-first closed-module order still holds (§8.1)

**Acceptance — 2026-08-26 replayed.** User_4, Wednesday, `d1` passed, `d2` printed
Tuesday (so it carries a bare `created` session):

| | Today | After |
| --- | --- | --- |
| Panel offers | `d2` (Tuesday's) | **`d3`** — the `created` session does not preempt, and due-today outranks 1-behind |
| After he passes it | "One more?" → `d4` | **"Catch up" → `d2`** |

## 11. What changed from rev 1

| Rev 1 claim | Reality | Now |
| --- | --- | --- |
| acceptance test yields `d3` | `BuildAgenda` pre-creates a session → `d2` wins at priority 0 | §8.3 |
| "merge `evaluateTiming`" produces the table | 7-day urgency lead makes every lesson `urgent`; 3 of 4 rows unreachable | §8.1, dedicated evaluator |
| "no migration" | frozen policy = fix reaches nobody, including User_4 | §7.6 re-pacing |
| flip `assignedPrograms: true` | projection has no launchers by design → every program faults | §4, skip programs |
| `not_due_yet` is "effectively dead" | sound for non-dated; the real hazard is narrower | §8.4 |
| `noSchoolToday` "checked earlier, short-circuits" | applied last as an override, deliberately | §8.4 |
| tiers implicitly stackable | same token shape → mislabelled QR | §3 exclusivity |
| no closed-module row | rank scales collide | §8.1 priority band 6 |
| sequence dissolution harmless | kills the `blocked_unreachable` fault | §8.5 |
| `ORDERING` gains `dated` | shared enum legalizes `module_order: dated` | §7.4 |
| cascade validates course `dueOn`; `explicit` strategy | speculative; validates a mutable field once | cut (§7.3) |
| reject enrollment on zero school days | one vacation week refuses a 52-week course | §7.5 fallback |

## 12. Deferred

- A timing editor UI; anchors, windows and pacing stay hand-authored YAML.
- Deriving module windows from a course due date.
- Per-lesson availability, if a course ever needs a lesson to open later than
  its module.
- Applying §8.3's "a `created` session is not work in hand" rule globally rather
  than only to dated lessons.
- A launcher-wired projection for the receipt, which would let tier 1 speak
  about program subjects.
