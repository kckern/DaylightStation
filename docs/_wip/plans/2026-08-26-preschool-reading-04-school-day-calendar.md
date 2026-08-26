# School-Day Calendar on the Enrollment — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let an enrollment declare which days are school days, so a weekend, a holiday or a vacation week stops showing as an unmet obligation on the board — and let a specific date be added back as a makeup day.

**Architecture:** A pure `schoolCalendar.mjs` domain module answers `isSchoolDay(day, schedule)`. A `schedule` block is validated on the syllabus and on a program enrollment, snapshotted onto the enrollment like every other progression field, and consulted at exactly one place: where `agenda.mjs` decides `obligation`. A non-school day resolves to the **existing** `excused` state with a new reason, so `completion.mjs`, the status board and the report card need no change.

**Tech Stack:** Node ESM (`.mjs`), vitest.

**Read first:**
- `backend/src/2_domains/school/agenda.mjs:294-355` — the obligation block; this is the only place that changes
- `backend/src/2_domains/school/completion.mjs` — note `excused` already exists and already carries a reason
- `backend/src/2_domains/school/timing.mjs` — what timing does today (`opensOn`/`closesOn` windows and priorities) and, deliberately, what it does not
- `docs/reference/school/timing-and-priority.md`

**Run one test file with:** `npx vitest run <path> --reporter=dot`

---

## What already works — do not rebuild it

**The daily reset is not part of this plan.** `studyDay.mjs` already rolls the study day at 4am local (`boundaryHour = 4`), DST-aware, and `agenda.mjs` already compares against it. "Green today, blank tomorrow, ask again" costs nothing and is already true.

**What is missing is only the exceptions layer.** Today `timing.mjs` supports one continuous `opensOn`/`closesOn` window plus a priority. There is no day-of-week rule, no holiday list and no makeup concept — so on a Saturday an enrollment is still `obligated` and the board still shows unmet work.

**`excused` already exists.** `resolveDayCompletion` treats an all-excused day as `no_work_today` rather than `incomplete`. That is exactly the target state, which is why this plan is small.

---

## The schedule shape

```yaml
schedule:
  daysOfWeek: [1, 2, 3, 4, 5]        # ISO-8601: 1=Monday .. 7=Sunday. Omitted = every day.
  except:                             # never a school day, whatever daysOfWeek says
    - '2026-11-26'
    - { from: '2026-12-21', to: '2027-01-02' }
  also:                               # always a school day, even if daysOfWeek excludes it
    - '2026-11-28'                    #   -> the makeup day
```

**Precedence, fixed:** `also` beats `except` beats `daysOfWeek`. A makeup day explicitly named must win over the vacation range that contains it, or "make it up on Saturday" is inexpressible.

**Why on the enrollment and not in a household calendar.** Different children have different school years, and the enrollment is already the frozen snapshot a later syllabus edit cannot reach into. A shared household calendar is a reasonable future addition *layered under* this — it is not a substitute, and it is out of scope.

---

### Task 1: `isSchoolDay`

**Files:**
- Create: `backend/src/2_domains/school/schoolCalendar.mjs`
- Test: `tests/isolated/domain/school/schoolCalendar.test.mjs`

**Step 1: Write the failing test**

```js
import { isSchoolDay, validateSchedule } from '#domains/school/schoolCalendar.mjs';

describe('isSchoolDay', () => {
  it('is true for every day when there is no schedule', () => {
    expect(isSchoolDay('2026-08-29', null)).toBe(true);   // a Saturday
  });

  it('honours daysOfWeek — ISO 1=Monday', () => {
    const s = { daysOfWeek: [1, 2, 3, 4, 5] };
    expect(isSchoolDay('2026-08-26', s)).toBe(true);   // Wednesday
    expect(isSchoolDay('2026-08-29', s)).toBe(false);  // Saturday
    expect(isSchoolDay('2026-08-30', s)).toBe(false);  // Sunday
    expect(isSchoolDay('2026-08-31', s)).toBe(true);   // Monday
  });

  it('excludes a single excepted date', () => {
    expect(isSchoolDay('2026-11-26', { daysOfWeek: [1,2,3,4,5], except: ['2026-11-26'] })).toBe(false);
  });

  it('excludes an excepted range, inclusive at both ends', () => {
    const s = { daysOfWeek: [1,2,3,4,5], except: [{ from: '2026-12-21', to: '2027-01-01' }] };
    expect(isSchoolDay('2026-12-21', s)).toBe(false);
    expect(isSchoolDay('2026-12-25', s)).toBe(false);
    expect(isSchoolDay('2027-01-01', s)).toBe(false);
    expect(isSchoolDay('2027-01-04', s)).toBe(true);   // the Monday after
  });

  it('`also` beats `except` — a makeup day inside a vacation range still counts', () => {
    const s = {
      daysOfWeek: [1,2,3,4,5],
      except: [{ from: '2026-12-21', to: '2027-01-01' }],
      also: ['2026-12-23'],
    };
    expect(isSchoolDay('2026-12-23', s)).toBe(true);
    expect(isSchoolDay('2026-12-24', s)).toBe(false);
  });

  it('`also` beats daysOfWeek — a Saturday makeup day counts', () => {
    expect(isSchoolDay('2026-08-29', { daysOfWeek: [1,2,3,4,5], also: ['2026-08-29'] })).toBe(true);
  });

  it('is timezone-free — it compares calendar keys, never Date arithmetic across a boundary', () => {
    // A study-day key is already local. Parsing it as UTC and reading the local
    // weekday would shift a Sunday to a Saturday west of Greenwich.
    expect(isSchoolDay('2026-08-30', { daysOfWeek: [7] })).toBe(true);  // Sunday
  });

  it('fails OPEN on a malformed schedule — never silently excuses a whole term', () => {
    expect(isSchoolDay('2026-08-26', { daysOfWeek: 'weekdays' })).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/domain/school/schoolCalendar.test.mjs --reporter=dot`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Pure, no clock, no timezone. Derive the weekday from the `YYYY-MM-DD` key with `Date.UTC(y, m-1, d)` and read `getUTCDay()`, mapping Sunday `0` to ISO `7` — parsing the key in local time is the bug the timezone test above pins.

**Fail open.** A malformed schedule returns `true` (a school day). The failure mode of this module must be "the child is asked to do their work", never "a typo excused the entire term and nobody noticed until June".

**Step 4 / 5: Run and commit**

```bash
npx vitest run tests/isolated/domain/school/schoolCalendar.test.mjs --reporter=dot
git add backend/src/2_domains/school/schoolCalendar.mjs tests/isolated/domain/school/schoolCalendar.test.mjs
git commit -m "feat(school): isSchoolDay — day-of-week rules, exceptions and makeup days"
```

---

### Task 2: Validate a schedule

**Files:**
- Modify: `backend/src/2_domains/school/schoolCalendar.mjs` (add `validateSchedule`)
- Test: same file as Task 1

**Step 1: Write the failing test**

```js
describe('validateSchedule', () => {
  it('accepts an absent schedule', () => {
    expect(validateSchedule(undefined)).toEqual({ errors: [], schedule: null });
  });
  it('refuses a weekday outside 1..7', () => {
    expect(validateSchedule({ daysOfWeek: [0] }).errors[0]).toMatch(/daysOfWeek/);
    expect(validateSchedule({ daysOfWeek: [8] }).errors[0]).toMatch(/daysOfWeek/);
  });
  it('refuses an empty daysOfWeek — that is a term with no school days at all', () => {
    expect(validateSchedule({ daysOfWeek: [] }).errors[0]).toMatch(/daysOfWeek/);
  });
  it('refuses a malformed date', () => {
    expect(validateSchedule({ except: ['Christmas'] }).errors[0]).toMatch(/except/);
  });
  it('refuses a range that ends before it starts', () => {
    expect(validateSchedule({ except: [{ from: '2026-12-25', to: '2026-12-01' }] }).errors[0]).toMatch(/before/);
  });
  it('normalizes and dedupes, sorting daysOfWeek', () => {
    expect(validateSchedule({ daysOfWeek: [3, 1, 3] }).schedule.daysOfWeek).toEqual([1, 3]);
  });
});
```

**Steps 2-5:** implement returning the `{ errors, schedule }` shape the other School validators use, run, commit.

---

### Task 3: Accept `schedule` on a syllabus

**Files:**
- Modify: `backend/src/2_domains/school/curriculum/syllabus.mjs`
- Test: `tests/isolated/domain/school/syllabus.test.mjs`

Add `schedule` alongside `timingTemplate`: validate with `validateSchedule`, push its errors into the syllabus's own error list, and include it in the returned syllabus when present. Note that `syllabus.mjs` currently **refuses** unknown keys only inside `policy` — confirm whether an unknown top-level key is accepted or rejected before assuming `schedule` needs no other change.

Commit.

---

### Task 4: Snapshot `schedule` onto the enrollment

**Files:**
- Modify: `backend/src/2_domains/school/curriculum/enrollment.mjs` (`createCourseEnrollment`)
- Modify: `backend/src/3_applications/school/usecases/EnrollLearner.mjs` (pass `syllabus.schedule` through)
- Test: `tests/isolated/domain/school/enrollment.test.mjs`

The enrollment already snapshots `progression`, `display`, `moduleSchedule` for the same reason — a later syllabus edit must not move a plan a learner is already living in. `schedule` is one more field of that snapshot. A vacation added mid-year is therefore an explicit re-materialize, which is the correct and already-documented semantics.

**Test that the snapshot is a deep copy** (`structuredClone`, as `progression` already is), so mutating the syllabus afterwards does not reach into a live enrollment.

Commit.

---

### Task 5: A non-school day is `excused`

This is the only behavioural change, and it is one branch.

**Files:**
- Modify: `backend/src/2_domains/school/agenda.mjs` — the obligation block around `:294-355`
- Test: `tests/isolated/domain/school/agenda.test.mjs` (or `backend/src/2_domains/school/agenda.test.mjs` — use whichever the repo already has)

**Step 1: Write the failing test**

```js
it('excuses an obligated section on a non-school day', () => {
  const result = planDailyAgenda({
    entries: [{ unitId: 'u1', subject: 'math', status: 'available', elective: false, courseId: 'c1' }],
    enrollmentsByCourse: { c1: { schedule: { daysOfWeek: [1,2,3,4,5] } } },
    today: '2026-08-29',  // Saturday
    sessions: [], now: new Date('2026-08-29T18:00:00Z'),
  });
  const math = result.sections.find((s) => s.subject === 'math');
  expect(math.obligation).toEqual({ state: 'excused', reason: 'not_a_school_day' });
});

it('still obligates on a school day', () => { /* same, today: '2026-08-26' */ });

it('a whole day of non-school sections rolls up to no_work_today, not incomplete', () => {
  // resolveDayCompletion over the sections above
});

it('a non-school day never HIDES completed work — a child who read anyway still shows served', () => {
  // a section with a same-day pass stays `served`, not `excused`
});
```

That last test is the one that matters most. **`served` must outrank `not_a_school_day`.** A child who does their reading on a Saturday has served the obligation, and downgrading that to "excused" would erase work they actually did.

**Step 2: Run test to verify it fails**

Run: `npx vitest run <the agenda test path> --reporter=dot`

**Step 3: Write the implementation**

In the obligation block, **after** the `obligationServed` check and before the remaining excuse branches:

```js
    // A non-school day excuses what is left, but never un-serves what was
    // already done: `obligationServed` is checked first, deliberately. A child
    // who reads on a Saturday has read.
    if (!isSchoolDay(today, enrollmentSchedule)) {
      obligation = { state: 'excused', reason: 'not_a_school_day' };
    } else if (...)
```

Thread the enrollment's `schedule` in the same way the block already reaches `enrollment.progression` via `policyFor(courseId)` — do **not** add a new parameter to `planDailyAgenda` if the enrollment is already reachable.

**Step 4 / 5: Run the whole School domain suite and commit**

```bash
npx vitest run tests/isolated/domain/school/ --reporter=dot
git add backend/src/2_domains/school/agenda.mjs tests/isolated/
git commit -m "feat(school): a non-school day excuses the obligation"
```

---

### Task 6: Schedules on program enrollments

Story time (plan 02) is a program, not a course, so it takes its schedule from the program enrollment rather than a syllabus.

**Files:**
- Modify: `backend/src/2_domains/school/storyTime.mjs` — accept and validate `schedule`
- Modify: `backend/src/3_applications/school/assignedProgramPlan.mjs` — carry `schedule` onto the projected entry
- Modify: `backend/src/2_domains/school/agenda.mjs` — read the schedule off a program entry too
- Test: extend the plan-02 suites

Commit.

---

### Task 7: Surface it to a teacher

A schedule nobody can see is a schedule nobody trusts. At minimum, the agenda's section output should carry `notASchoolDay: true` so the status board can say *"No school today"* rather than rendering an empty card that reads as broken.

**Files:**
- Modify: `frontend/src/modules/School/status/AgendaStatusBoard.jsx`
- Test: `frontend/src/modules/School/status/AgendaStatusBoard.test.jsx`

**Ask KC for a screenshot** rather than inferring that it paints correctly.

Commit.

---

### Task 8: Author the real schedules and document

**Files (outside the repo):**
- `$DAYLIGHT_BASE_PATH/data/household/school/plans/syllabi/*.yml` — add `schedule` to the live syllabi
- `$DAYLIGHT_BASE_PATH/data/household/school/plans/learners/*.yml` — add `schedule` to the story-time program enrollments

**Re-materialize is required for existing course enrollments** — the schedule is a snapshot, so an already-enrolled learner does not pick it up from a syllabus edit:

```bash
SCHOOL_PIN=... node cli/school.mjs ops rematerialize <learner> --syllabus <id> --teacher <teacher> --pin-env SCHOOL_PIN --apply
```

Note that re-materialize is **refused while any session on that course is open**, and it **re-shuffles a `shuffle_once` order**. Do this when nobody is mid-worksheet.

**Docs:**
- `docs/reference/school/timing-and-priority.md` — a new section on the schedule block, its precedence, and why it lives on the enrollment
- `docs/reference/school/enrollment.md` — add `schedule` to the snapshot list; **remove the "no day calendar" line from the Known limitations section**
- `docs/docs-last-updated.txt`

---

## Acceptance

- A weekday shows the obligation as it does today
- A Saturday shows `excused / not_a_school_day` and the day rolls up to `no_work_today`, not `incomplete`
- A child who does the work on a Saturday still shows `served`
- A date in `except` is excused on a weekday
- A date in `also` is a school day even inside an `except` range and even on a weekend
- A malformed schedule leaves the obligation intact and logs — it never excuses a term
