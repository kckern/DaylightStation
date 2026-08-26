# Lesson-level pacing and agenda-aware receipts

Status: design, approved 2026-08-26. Supersedes nothing; extends
[time-sensitive planning](../../reference/school/timing-and-priority.md) and
[agenda and completion](../../reference/school/agenda-and-completion.md).

## Terminology

The code's three levels, and the words this document uses for them:

| Code | Example | Colloquially |
| --- | --- | --- |
| course | `come-follow-me-ot-2026` | course |
| module | `w35-aug24` | the week |
| unit | `cfm-w35-d3-psalms-70-77` | the lesson |

"Lesson" below always means a **unit**.

## 1. The problem

Two complaints from 2026-08-26, with one root: **the lesson layer is
date-blind, and the result receipt is subject-blind.**

**Milo was handed Tuesday's lesson on Wednesday.** Time sensitivity exists
only at the module level. `evaluateDatedModule` answers `upcoming` /
`available` / `catch_up` for a *window*; lessons inside a module carry no dates
at all and are ordered purely by `lessonOrder`, gated as strict prerequisites.
`d1…d5` are the publisher's day labels riding along as text — nothing knows
`d3` means Wednesday. Milo got `d2` because it was the first unpassed entry,
which is the system working as built.

The week is 5 lessons in a 7-day window (`opensOn: 2026-08-24`,
`closesOn: 2026-08-30`), so there is no day-to-lesson mapping to recover.

**The receipt offers "one more of the same course" unconditionally.** On a pass
`CloseSessionOutcome#settle` mints exactly one forward action, always for
`unit.subject`, captioned *"Today is already complete. Scan only if you want
one more."* — printed while other subjects sit untouched. `#projectPlan`
already returns the agenda `sections`; the receipt has the whole day in hand
and ignores it.

## 2. Scope

1. Per-lesson due dates, with a cascade from course and module.
2. A per-course switch between week-level and day-level pacing.
3. Backlog that is recoverable without ever hard-locking a child.
4. A result receipt that offers the day's next work, across subjects.

Out of scope: a timing editor UI; changing how module windows are authored;
any change to issued paper, scan evidence, or frozen report-card history.

## 3. The date model

### 3.1 Where dates live

| Level | Today | After |
| --- | --- | --- |
| course | `assignment.courses[].timing` → `school.timing/v1`, has `target.dueOn` | unchanged |
| module | `enrollment.moduleSchedule[id]` → `opensOn`/`closesOn` | unchanged |
| unit | *nothing* | `enrollment.lessonSchedule[unitId]` → `dueOn` |

`planner.mjs` reads a course unit's timing from the **enrollment**, so every
lesson in a course shares one timing object. There is no per-lesson slot. This
adds one.

### 3.2 `lessonSchedule`

A sibling of `moduleSchedule`, frozen onto the enrollment the same way, flat
and keyed by `unitId`:

```yaml
enrollment:
  schema: school.course-enrollment/v2
  moduleSchedule:
    w35-aug24: { opensOn: '2026-08-24', closesOn: '2026-08-30' }
  lessonSchedule:                          # NEW
    cfm-w35-d1-psalms-49-61: { dueOn: '2026-08-24' }
    cfm-w35-d2-psalms-62-69: { dueOn: '2026-08-25' }
    cfm-w35-d3-psalms-70-77: { dueOn: '2026-08-26' }
    cfm-w35-d4-psalm-78:     { dueOn: '2026-08-27' }
    cfm-w35-d5-psalms-85-86: { dueOn: '2026-08-28' }
```

`dueOn` **only**. No per-lesson `opensOn`/`closesOn`: the module window already
answers "is this offerable", and a second availability source would be a second
answer to drift from. A lesson never opens before its module or outlives it.

Flat rather than nested under the module because every lookup is by `unitId`.

### 3.3 The cascade

Derivation runs downward exactly one step. Validation runs upward.

```
course target.dueOn  ──validates──▶  module windows   (last closesOn <= course dueOn)
module window        ──derives───▶   lesson dueOn     (spread over school days)
```

Spreading N lessons across a module window on a known school calendar is
deterministic. Deriving 17 week-windows from "done by Christmas" is a
scheduling problem with many valid answers, so the course date **checks** the
authored module windows rather than inventing them.

### 3.4 The pacing policy

On the syllabus, beside the existing `lesson_order`:

```yaml
policy:
  mode: dated_modules
  lesson_order: dated              # NEW value; today: fixed | shuffle_once
  lesson_pacing:
    schema: school.lesson-pacing/v1
    strategy: spread               # spread | explicit
```

- **`spread`** — walk the module window's school days and assign
  `lessonOrder[n]` to school-day *n*. The calendar is the enrollment's existing
  `schedule` (`daysOfWeek` / `except` / `also`), read through
  `schoolCalendar.mjs`. No authoring. For Milo's `w35-aug24` this yields §3.2
  exactly.
- **`explicit`** — the course authored its own per-lesson `dueOn`. The cascade
  validates instead of deriving: inside the module window, monotonic with
  `lessonOrder`, landing on school days.

**More lessons than school days is not an error.** The overflow doubles up on
the last school day rather than spilling past `closesOn`. Two lessons sharing a
`dueOn` is well-defined downstream: the tiebreak is `lessonOrder` position,
which is already total.

### 3.5 When the cascade runs

At enrollment materialization (`enrollment.mjs`), where `moduleSchedule` and
`lessonOrder` are already frozen. Cascade errors **reject the enrollment**,
matching the rule already in force for timing anchors: School never silently
creates a plan whose dates it could not resolve. Editing a syllabus later never
moves an active plan.

## 4. Selection

### 4.1 The priority table

The ladder is expressed as a priority assignment, not a new comparator.
`byEntryPriority` sorts on `timingPriority` then `timingRank` and does not
change.

Pre-pass per dated course, a sibling of the existing `datedRankByModule` loop:

```
overdue = unpassed lessons in the OPEN module with dueOn < today, oldest first
backlogPressure = overdue.length >= 2
```

Per entry:

| Lesson | `timingPriority` | `timingRank` |
| --- | --- | --- |
| in progress | `0` in_progress | — (existing rule) |
| `dueOn < today` | `1` when `backlogPressure`, else `3` | index in `overdue` (0 = oldest) |
| `dueOn == today` | `2` | 0 |
| `dueOn > today` | `4` | days until due |

Which produces:

- 2+ overdue → oldest backlog beats today's lesson (**threshold 2**)
- 1 overdue → today's lesson leads; backlog falls to the receipt's second slot
- nothing due today → 1 overdue beats working ahead
- module closes → the existing `catch_up` path takes over, ranked newest-first

### 4.2 Backlog raises priority, never state

`focusExtras` and `focusBudget` key off `timingState === 'urgent'`, not off
`timingPriority`. Backlog therefore lifts the **priority number** to 1 while
leaving `timingState` as `missed_target` — which is what `evaluateTiming`
already returns for an overdue aspirational target.

Two consequences, both wanted:

- `focusExtras` returns 0 structurally, so a behind subject can never displace
  another subject. Focus-day displacement remains reserved for work that
  declares a block budget.
- `focusBudget` stays 1, so a subject is still served after one pass. The
  backlog lesson is reachable only through the receipt's continue slot, not by
  the subject quietly serving itself twice.

**Rule: backlog raises priority, never state.** A test pins it.

### 4.3 Planner changes

1. `blockerFor` returns `null` for within-module ordering when
   `lesson_order: dated`. Lessons are peers, not prerequisites. Module-level
   gating is untouched — a future module is still `upcoming` via
   `datedStateByModule`, which never went through `blockerFor`.
2. `rawTiming` gains the lesson's own
   `target: { dueOn, strength: 'aspirational' }` from `lessonSchedule`.
3. The `datedKey` branch currently **skips `evaluateTiming` entirely**. It must
   stop doing that and merge module state with lesson timing.

**`aspirational`, not `firm`.** A passed firm target becomes `dormant` and
needs a grown-up to revive it. An overdue lesson must stay offerable, which is
the entire point; `aspirational` gives `missed_target` — still eligible at base
priority.

### 4.4 Obligation

`agenda.mjs` excuses a subject as `not_due_yet` when its actionable work is
`available` and has a `target.dueOn`. The predicate tests whether a due date
**exists**, not whether it has **arrived**. It is harmless today only because
nothing populates a per-lesson `dueOn`; the moment §3.2 does, a lesson due
*today* matches it, the subject stops obligating, and the day reports
`complete` with the lesson undone.

Fix: compare the date.

```js
e.timing?.target?.dueOn > today     // "isn't due yet", not "has a due date"
```

Obligation then follows **`dueOn <= today`**: due today or overdue is owed,
future-dated is available but optional. Working ahead stays voluntary, which
was the original intent of the branch.

Non-school days need no special case — `noSchoolToday` is checked earlier and
short-circuits, so the school calendar stays authoritative for whether today
obligates at all.

Two neighbouring flags keep their current meanings deliberately:

- `isBacklog` stays **module**-level, so only a closed week excuses as
  `optional_backlog`. An overdue lesson inside the open week still obligates.
- `catchUp` widens to include an overdue lesson in the open module, so paper
  can say the child is backfilling Tuesday rather than showing it as today's
  work.

## 5. The result receipt

`CloseSessionOutcome#settle` picks its forward action from the agenda
`sections` its own `#projectPlan` already returns.

| # | Offer | Token | Eyebrow |
| --- | --- | --- | --- |
| 1 | An unserved subject's next action | that subject, `continueToday: false` | `Next up` |
| 2 | Overdue backlog in this subject | this subject, `continueToday: true` | `Catch up` |
| 3 | Next in sequence in this subject | this subject, `continueToday: true` | `One more?` |

Tier 1 takes the unserved subject the agenda already ranks first, so paper and
panel cannot disagree about what is next.

**No new token class.** `subject_next` already names a learner and a subject. A
cross-subject offer names a *different* subject and drops the `continueToday`
override, because that subject is not served and resolves normally.

**The copy is a correctness fix.** *"Today is already complete"* is printed
today while other subjects sit untouched. It becomes true only in tier 3.

**`#projectPlan` must stop passing `assignedPrograms: false, programStatuses:
[]`.** Program subjects otherwise have no daily status and tier 1 would offer
piano to a child who already did piano. The receipt prints a handful of times a
day, so the launcher fan-out is cheap and a wrong offer is not.

Two smaller consequences:

- `#nextUnlocked` stops meaning "next in `lessonOrder`". With
  `lesson_order: dated` nothing is locked, so tier 3 means the earliest
  future-dated lesson.
- When every subject is served and no backlog exists there is no action. The
  receipt prints the day's tally and no QR — the honest end of a finished day.

## 6. Validation and failure

**Authoring time** (`workValidation.mjs`)

- `ORDERING` gains `dated`.
- `lesson_order: dated` requires `mode: dated_modules`; there are no module
  windows to spread across otherwise.
- `lesson_pacing` validated as its own schema.

**Enrollment time** — the cascade rejects the enrollment on:

- a course `dueOn` earlier than the last module's `closesOn`
- `explicit` dates outside their module window, out of order with
  `lessonOrder`, or off the school calendar

**Runtime failures fail toward offerable, not dormant.** A lesson with a
missing or unparseable `dueOn` loses its date, sorts last at priority 4, stays
available, and logs. The ordinary `evaluateTiming` path would make it
`dormant`, which requires a parent to revive — the wrong outcome for one
lesson.

**No migration.** `lesson_order` defaults to `fixed`, so every existing
enrollment behaves exactly as today until a course opts in.

## 7. Tests

Pure domain:

- cascade `spread` reproduces §3.2 from Milo's real `w35-aug24` window
- cascade `explicit` accepts a valid set and rejects each invalid kind
- the §4.1 priority table, one case per row

Guards:

- a lesson due **today** still obligates (§4.4 regression)
- a 2-behind subject suppresses no other subject (§4.2)

Receipt: one test per tier in §5.

Regression: a `fixed` course picks the identical lesson before and after.

**Acceptance — 2026-08-26 replayed.** Milo, Wednesday, `d1` passed:

| | Today | After |
| --- | --- | --- |
| Panel offers | `d2` (Tuesday's) | **`d3` (Wednesday's)** — due today beats 1-behind |
| After he passes it | "One more?" → `d4` | **"Catch up" → `d2`** |

## 8. Open to a later slice

- A timing editor UI. Anchors, windows and pacing stay hand-authored YAML.
- Deriving module windows from a course due date, rather than validating them.
- Per-lesson availability, should a course ever genuinely need a lesson to open
  later than its module.
