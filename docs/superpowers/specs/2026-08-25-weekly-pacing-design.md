# Weekly pacing for dated courses — design

**Date:** 2026-08-25
**Status:** approved in conversation, not yet implemented
**Depends on:** re-materializing learner enrollments (see *Prerequisite*)
**Sibling spec:** Agenda integrity (blocker promotion + receipt next-up) — separate, shippable independently

---

## Problem

Come Follow Me is a weekly curriculum: each module is a calendar week with five lessons. The
content already declares real windows, keyed by module id, in the course-level `_index.yml`:

```yaml
modules:
  - { module: w35-aug24, title: 'Aug 24–30 · Psalms 49–86',
      opensOn: '2026-08-24', closesOn: '2026-08-30' }
```

The system does not use them for pacing. A learner's day is "done" when the agenda has no
remaining offer, regardless of whether they have kept pace with the week. A child can do one
scripture lesson on Monday and be "done," do nothing Tuesday through Thursday and be "done" each
day, and arrive at Saturday four lessons short with no surface ever having said so.

There is also no honest way to answer "where am I in this week?" — which is the question a child
holding a receipt actually has.

## Non-goals

- Pacing non-dated courses. A course with no `modules[].opensOn` is unaffected.
- Rolling unfinished work into the next week (see *Ruling: no rollover*).
- A "behind" banner or any shaming indicator (see *Ruling: positional, not judgmental*).

---

## Prerequisite — enrollments must be re-materialized

`createCourseEnrollment` (`backend/src/2_domains/school/curriculum/enrollment.mjs:37-39, 71`) builds
`moduleSchedule` by filtering modules that are **published at enrollment time**:

```js
.filter((module) => module?.module && published.has(module.module) && module.opensOn && module.closesOn)
...
windowed.map((module) => [module.module, { opensOn: module.opensOn, closesOn: module.closesOn }])
```

Both learners were enrolled at `2026-08-25T01:23:16Z`, while all 85 CFM units were still
`reviewState: draft`. Nothing was published, the filter emptied, and their enrollment records carry
**no `moduleSchedule`** — only `enrollmentId`, `courseId`, `profile`. The code comments describe this
as a deliberately frozen snapshot, so it will not self-heal.

This is the same defect that kept scripture from offering a lesson all day. **One re-enrollment
supplies both the offers and the week windows.** Pacing cannot be built or tested until it lands.

---

## Model

### Position, not titles

Pacing is **positional**: the Nth entry of the module's frozen `lessonOrder` is the Nth lesson of
that week. Never parse a title, and never parse an id — `cfm-w35-d1-psalms-49-61` looks parseable,
but deriving "d1 = Monday" from an identifier is the same brittleness one layer down. Identity
resolves to data: `unit.module` → `moduleSchedule[module]` → `{ opensOn, closesOn }`.

**Shuffle is off for this course (changed 2026-08-25).** All four CFM syllabi carried
`policy.lesson_order: shuffle_once`, which runs `shuffle(remainder, rng)` at enrollment
(`enrollment.mjs:55`). For a calendar-week curriculum that was wrong: it decoupled lesson position
from the weekday the curriculum names, so "Monday · Psalms 49–61" could be served third. They are
now `lesson_order: fixed` — the code treats anything but `shuffle_once` as authored order
(`syllabus.mjs:20-26`).

Consequences:

- Position and weekday now **agree**, so the weekday prefix in a lesson title is accurate and should
  be **kept**, not stripped. "Monday · Psalms 49, 50, 51, 61" served as lesson 1 is correct and
  legible.
- `module_order` was never shuffled for CFM (verified — no key present, so authored order), which is
  essential: shuffled calendar weeks would put December's reading in August.
- **This only takes effect on re-enrollment**, since `lessonOrder` is frozen at enrollment time. It
  sequences naturally with the *Prerequisite* below: fix the syllabi first, then re-enroll, and the
  new enrollment picks up both the fixed order and the module windows.

Pacing must still key off position rather than the title string. The two agreeing today does not
make a title a safe thing to compute from — a course that legitimately wants `shuffle_once` must
keep pacing correctly, and non-CFM courses may have no weekday names at all.

### Expected position

Week 35 has 5 lessons across a 7-day window (Mon 2026-08-24 → Sun 2026-08-30).

| | Mon | Tue | Wed | Thu | Fri | Sat | Sun |
|---|---|---|---|---|---|---|---|
| Expected cumulative | 1 | 2 | 3 | 4 | 5 | 5 | 5 |

Derived, not hardcoded: expected on day *d* is `min(d, lessonCount)` where *d* is 1-indexed from
`opensOn`. A module with 3 lessons or a 5-day window follows the same rule.

- `owedToday = clamp(expected(today) − completedThisModule)`
- `caughtUp = completedThisModule >= expected(today)`

### The cap

- **Mon–Fri:** at most **2** lessons offered per day — today's plus one catch-up.
- **Sat:** uncapped. The window's spare days are the deliberate catch-up room.
- **Sun:** offers nothing. Expected stays at 5; the week closes.

Rationale: an uncapped Friday after a lost week means five lessons in one sitting, which converts a
pacing feature into a punishment. The cap bounds any single day at double a normal one while still
recovering a three-day hole in three days.

### Ruling: no rollover

At `closesOn`, the module closes and the count resets. Unfinished lessons are **not** carried into
the next week.

Rationale: CFM is tied to calendar weeks — week 36 *is* next week's reading whether or not week 35
finished. Carrying backlog forward puts a child permanently out of sync with what the family is
actually studying, and against a 2/day cap with 5 new lessons arriving weekly it never converges.

**Cost, stated plainly: content is genuinely skipped.** Missed lessons surface on the teacher
console, never on the child's paper. This is the ruling most worth revisiting if it feels wrong in
practice.

### Ruling: positional, not judgmental

The indicator is **`Scripture · 2 of 5 this week`** — a position, not a verdict. No "BEHIND"
banner, no red flag. A child already knows what day it is; the number is orientation, and it is
equally informative when they are ahead.

Excusals must reduce what is expected rather than accumulate against a child.
`milestones.mjs:66-74` already models this (`overdueDays` offset by `excusedDays`, yielding
`effectiveStatus: 'excused' | 'behind'`) — reuse that pattern rather than inventing one.

---

## What this changes

### Completion semantics — the consequential part

"Done for the day" stops meaning *the agenda has no offer left* and starts meaning *caught up
through today's expected position*. This ripples:

- `GetLearnerDayCompletion` — a paced course contributes `caughtUp`, not merely "no offer".
- The piano games unlock (`useSchoolGameAccess.js:6` unlocks on `complete` / `no_work_today`)
  now requires being on pace, not just having done something.
- The done-for-the-day card on the result receipt.

This is deliberate and is the point of the feature, but it is a real behavioral change to the thing
that gates a child's games. It must not ship on the same day it is written without the household
knowing.

### Agenda

A paced subject offers up to `min(owedToday, cap)` entries instead of one. When `owedToday` is 0,
the subject is done for the day and shows as such.

### Unaffected

Non-dated courses (no `modules[].opensOn`) keep today's behavior exactly. The pacing path is
entered only when a resolved `moduleSchedule` entry exists for the unit's module.

---

## Components and boundaries

| Unit | Responsibility | Depends on |
|---|---|---|
| `modulePacing` (new, domain, pure) | `expected(day)`, `owedToday`, `caughtUp`, cap application. Data in, data out. | nothing |
| `planLearnerWork` / `planDailyAgenda` | Consume pacing to size a subject's offers | `modulePacing` |
| `GetLearnerDayCompletion` | Treat a paced subject as complete only when `caughtUp` | `modulePacing` |
| Receipt / agenda renderers | Display `N of M this week`. Render only. | nothing |

The math is a pure domain function with no I/O, so every rule above is unit-testable against plain
data — no fixtures, no clock injection beyond an explicit `today`.

---

## Error handling

- **No `moduleSchedule` for the unit's module:** not a paced course. Fall back to today's behavior.
  This is the state both learners are in right now, so the fallback is load-bearing, not theoretical.
- **`today` outside `[opensOn, closesOn]`:** the module is not active; contributes nothing.
- **`lessonOrder` missing or shorter than the module's unit count:** pace against the units actually
  present and log at `warn`. Never throw — a malformed enrollment must not break a child's day.
- **Clock/timezone:** all comparisons are date-only (`YYYY-MM-DD`) in the household timezone, against
  the same study-day boundary the agenda already uses. Never `Date.now()` inside the domain.

---

## Testing

Pure functions, so all of this is plain-data unit testing:

1. `expected(day)` across the window, including both edges and a day outside it.
2. `owedToday` at 0, 1, and 3 behind.
3. Cap: Friday with 5 owed offers 2; Saturday with 5 owed offers 5; Sunday offers 0.
4. No rollover: a module past `closesOn` contributes nothing to the next module's expectation.
5. Excusals reduce expectation rather than accumulating.
6. Non-dated course is byte-identical to current behavior (regression guard).
7. Completion: a learner who did 1 of 2 owed is **not** `caughtUp`; games stay locked.
8. With `lesson_order: fixed`, a fresh enrollment's `lessonOrder` is authored order — lesson 1 is
   the unit with `sequence: 1`. This is the regression guard for the shuffle change; it fails if a
   syllabus silently reverts to `shuffle_once`.

---

## Open, deliberately deferred

- **Sunday** currently offers nothing. If it should be a second catch-up day, that is a one-line
  change to the expected/cap table.
- **"Unit 1 of 85"** is honest but daunting for an eight-year-old on day one. Per-week framing
  (`2 of 5 this week`) is what this spec adopts; whether the 85-count should appear anywhere
  child-facing is a separate copy decision.
