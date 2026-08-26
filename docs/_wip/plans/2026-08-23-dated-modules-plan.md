# Dated Modules Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `dated_modules` progression mode so a calendar-driven course (Come Follow Me) offers the module whose window contains today, falls back to unfinished earlier modules newest-first, and never opens a future module.

**Architecture:** Modules stop gating each other; lessons still chain inside a module. Each module carries `opensOn`/`closesOn`, snapshotted onto the enrollment as `moduleSchedule` at enroll time. The planner derives a per-module timing state and stamps every lesson with `timingState` + a new `timingRank`. Sorting becomes `timingPriority → timingRank → position`, and `agenda.mjs` already takes `[0]` per subject, so no new agenda machinery is needed.

**Tech Stack:** Node ES modules (`.mjs`), vitest, js-yaml. Pure domain functions — no clock reads, no I/O below `3_applications`.

**Design:** `docs/_wip/plans/2026-08-23-dated-modules-design.md`

---

## Before you start

Work in the worktree `.worktrees/dated-modules` on branch `feat/school-dated-modules`.

**Run tests with vitest directly.** Do NOT use `npm test -- --only=domain`; that routes vitest files to Jest and 159 of 179 suites fail to load for reasons unrelated to your change.

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation/.worktrees/dated-modules
npx vitest run tests/isolated/domain/school/ --reporter=dot
```

Baseline at branch point: 115 files, 1123 tests, 0 failures (across `2_domains/school` + `3_applications/school`).

**Vocabulary.** A *module* here is a course block (`w35-aug24`, a CFM week), validated in `curriculum/workValidation.mjs`. It is NOT a *learning module* (quiz, lecture_notes) — those live in `catalog/moduleValidation.mjs` and are unrelated. Do not edit that file.

---

## Task 1: `evaluateDatedModule` in the timing domain

A pure function answering, for ONE module window, where today sits relative to it. It knows nothing about siblings — ranking is the planner's job (Task 5), because "newest first" needs `closesOn` ordering across all modules.

**Files:**
- Modify: `backend/src/2_domains/school/timing.mjs`
- Test: `tests/isolated/domain/school/timing.test.mjs`

**Step 1: Write the failing tests**

Append to `tests/isolated/domain/school/timing.test.mjs`:

```javascript
describe('evaluateDatedModule', () => {
  const window = { opensOn: '2026-09-14', closesOn: '2026-09-20' };

  it('is upcoming before the window opens', () => {
    expect(evaluateDatedModule(window, { today: '2026-09-13' }).state).toBe('upcoming');
  });

  it('is available on the first and last day of the window', () => {
    expect(evaluateDatedModule(window, { today: '2026-09-14' }).state).toBe('available');
    expect(evaluateDatedModule(window, { today: '2026-09-20' }).state).toBe('available');
  });

  it('is catch_up after the window closes, however long ago', () => {
    expect(evaluateDatedModule(window, { today: '2026-09-21' }).state).toBe('catch_up');
    expect(evaluateDatedModule(window, { today: '2027-04-01' }).state).toBe('catch_up');
  });

  it('never returns dormant — dated backlog does not expire', () => {
    expect(evaluateDatedModule(window, { today: '2027-04-01' }).state).not.toBe('dormant');
  });

  it('rejects a malformed window rather than guessing', () => {
    expect(() => evaluateDatedModule({ opensOn: 'nope', closesOn: '2026-09-20' }, { today: '2026-09-15' }))
      .toThrow(/window/);
    expect(() => evaluateDatedModule(window, { today: 'nope' })).toThrow(/today/);
  });
});
```

Add `evaluateDatedModule` to the existing import at the top of the file.

**Step 2: Run it and watch it fail**

```bash
npx vitest run tests/isolated/domain/school/timing.test.mjs -t evaluateDatedModule
```
Expected: FAIL — `evaluateDatedModule is not a function`.

**Step 3: Implement**

In `backend/src/2_domains/school/timing.mjs`, after `evaluateTiming`:

```javascript
/**
 * Where today sits relative to ONE dated module's window.
 *
 * Deliberately never returns `dormant`. A closed dated module is `catch_up`:
 * still offerable, just outranked. Backlog in a dated course does not expire
 * and never needs a grown-up to revive it — it sinks by losing the sort
 * (planner.mjs ranks catch_up modules newest-first), not by a rule.
 */
export function evaluateDatedModule(window, { today } = {}) {
  if (!isDay(today)) throw new Error('evaluateDatedModule requires today YYYY-MM-DD');
  if (!isObject(window) || !isDay(window.opensOn) || !isDay(window.closesOn)) {
    throw new Error('evaluateDatedModule requires a window with opensOn and closesOn as YYYY-MM-DD');
  }
  if (compareDay(window.opensOn, window.closesOn) > 0) {
    throw new Error('evaluateDatedModule window closes before it opens');
  }
  if (compareDay(today, window.opensOn) < 0) return { state: 'upcoming', reasons: ['opens_later'] };
  if (compareDay(today, window.closesOn) > 0) return { state: 'catch_up', reasons: ['catch_up'] };
  return { state: 'available', reasons: ['current_module'] };
}
```

**Step 4: Run and verify green**

```bash
npx vitest run tests/isolated/domain/school/timing.test.mjs
```
Expected: PASS, and every pre-existing test in the file still passes.

**Step 5: Commit**

```bash
git add backend/src/2_domains/school/timing.mjs tests/isolated/domain/school/timing.test.mjs
git commit -m "feat(school): a dated module knows where today sits in its own window"
```

---

## Task 1b: `isDay` must reject a date that does not exist

Found during Task 1 review. `isDay` validates with `!Number.isNaN(Date.parse(...))`, but V8 rolls an out-of-range day over instead of rejecting it:

```
2026-02-30 -> 2026-03-02
2026-11-31 -> 2026-12-01
2026-13-01 -> NaN (correctly rejected — month is out of range, day is not)
```

So `normalizeTiming`, `evaluateTiming`, `resolveTimingAnchor`, `materializeTiming`, and the new `evaluateDatedModule` all accept a window ending `2026-11-31` and silently treat it as Dec 1.

This is pre-existing, but it lands squarely on this feature: Task 7 hand-authors 17 date pairs (including November, which has 30 days), and Task 2's whole purpose is that a typo'd date fails the manifest rather than silently stranding a week. Fix it before Task 2 clones the same predicate.

**Files:**
- Modify: `backend/src/2_domains/school/timing.mjs` (the `isDay` const)
- Test: `tests/isolated/domain/school/timing.test.mjs`

**Step 1: Write the failing tests**

```javascript
describe('isDay rejects dates that do not exist', () => {
  it('rejects a rolled-over day through evaluateDatedModule', () => {
    expect(() => evaluateDatedModule({ opensOn: '2026-11-01', closesOn: '2026-11-31' }, { today: '2026-11-15' }))
      .toThrow(/opensOn and closesOn/);
    expect(() => evaluateDatedModule({ opensOn: '2026-02-30', closesOn: '2026-03-05' }, { today: '2026-03-01' }))
      .toThrow(/opensOn and closesOn/);
  });

  it('rejects a rolled-over day through normalizeTiming', () => {
    const { errors } = normalizeTiming({
      schema: 'school.timing/v1',
      availability: { opensOn: '2026-01-01', closesOn: '2026-06-31' },
    });
    expect(errors.join()).toMatch(/closesOn/);
  });

  it('still accepts a real leap day', () => {
    expect(evaluateDatedModule({ opensOn: '2028-02-29', closesOn: '2028-03-01' }, { today: '2028-02-29' }).state)
      .toBe('available');
  });

  it('rejects Feb 29 in a non-leap year', () => {
    expect(() => evaluateDatedModule({ opensOn: '2026-02-29', closesOn: '2026-03-05' }, { today: '2026-03-01' }))
      .toThrow(/opensOn and closesOn/);
  });
});
```

**Step 2: Run and watch them fail**

```bash
npx vitest run tests/isolated/domain/school/timing.test.mjs -t "do not exist"
```
Expected: the rollover cases FAIL (no throw), the leap-day case passes already.

**Step 3: Implement**

Replace the `isDay` const in `backend/src/2_domains/school/timing.mjs`:

```javascript
// Round-trip rather than Date.parse: V8 rolls an out-of-range day OVER
// ('2026-11-31' parses fine, as Dec 1) instead of rejecting it, which would
// let a typo'd course window silently shift a week. Comparing the formatted
// result back to the input is what actually rejects a date that never existed.
const isDay = (value) => typeof value === 'string' && DAY.test(value)
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
```

**Step 4: Run the FULL suite**

```bash
npx vitest run backend/src/2_domains/school backend/src/3_applications/school tests/isolated/domain/school --reporter=dot
```

This tightens validation for every timing consumer, so a pre-existing test or fixture carrying an impossible date will now fail. If one does, that is the bug being caught — report it rather than loosening the check.

**Step 5: Commit**

```bash
git add backend/src/2_domains/school/timing.mjs tests/isolated/domain/school/timing.test.mjs
git commit -m "fix(school): a window ending November 31st is a typo, not December 1st"
```

---

## Task 2: `workValidation` accepts and polices `dated_modules`

**Files:**
- Modify: `backend/src/2_domains/school/curriculum/workValidation.mjs:183-229`
- Test: `tests/isolated/domain/school/curriculum/workValidation.test.mjs`

**Step 1: Write the failing tests**

```javascript
describe('dated_modules progression', () => {
  const dated = (over = {}) => ({
    schema: 'school.course/v2', work: 'cfm', title: 'CFM', subject: 'scripture',
    category: 'course', medium: 'paper',
    structure: { shape: 'modules', module: 'week', items: { from: 'units', order: 'sequence' } },
    progression: { mode: 'dated_modules', lesson_order: 'shuffle_once' },
    modules: [
      { module: 'w35', title: 'Week 35', opensOn: '2026-08-24', closesOn: '2026-08-30' },
      { module: 'w36', title: 'Week 36', opensOn: '2026-08-31', closesOn: '2026-09-06' },
    ],
    ...over,
  });

  it('accepts a well-formed dated course', () => {
    expect(validateWork(dated()).errors).toEqual([]);
  });

  it('does not require one_active_module (that is a module_blocks rule)', () => {
    expect(validateWork(dated()).errors.join()).not.toMatch(/one_active_module/);
  });

  it('rejects a module with no window', () => {
    const raw = dated();
    delete raw.modules[1].opensOn;
    expect(validateWork(raw).errors.join()).toMatch(/opensOn/);
  });

  it('rejects a malformed date', () => {
    const raw = dated();
    raw.modules[0].closesOn = 'Aug 30';
    expect(validateWork(raw).errors.join()).toMatch(/closesOn/);
  });

  it('rejects a window that closes before it opens', () => {
    const raw = dated();
    raw.modules[0].closesOn = '2026-08-20';
    expect(validateWork(raw).errors.join()).toMatch(/closes before/);
  });

  it('rejects overlapping windows — two modules cannot both be current', () => {
    const raw = dated();
    raw.modules[1].opensOn = '2026-08-29';
    expect(validateWork(raw).errors.join()).toMatch(/overlap/);
  });

  it('rejects windows on a course that is not dated_modules', () => {
    const raw = dated({ progression: { mode: 'module_blocks', one_active_module: true } });
    expect(validateWork(raw).errors.join()).toMatch(/only meaningful/);
  });

  it('leaves module_blocks and sequential courses alone', () => {
    const raw = dated({
      progression: { mode: 'module_blocks', one_active_module: true },
      modules: [{ module: 'w35', title: 'Week 35' }, { module: 'w36', title: 'Week 36' }],
    });
    expect(validateWork(raw).errors).toEqual([]);
  });
});
```

**Step 2: Run and watch it fail**

```bash
npx vitest run tests/isolated/domain/school/curriculum/workValidation.test.mjs -t dated_modules
```
Expected: FAIL — `progression.mode must be sequential|module_blocks`.

**Step 3: Implement**

**Do not write a second date predicate.** Task 1b established that this check has two traps — V8 rolls an out-of-range day over (`2026-11-31` → Dec 1), and `toISOString()` on an invalid month *throws* rather than returning something comparable. A duplicated copy will drift from the hardened one.

Instead, promote `timing.mjs`'s module-private `isDay` to a named export and import it here. Both files live in `2_domains/school/`, so this crosses no layer boundary.

In `backend/src/2_domains/school/timing.mjs`, change the const to an export and give it a name that says what it means in this domain:

```javascript
/**
 * A household-local study date, `YYYY-MM-DD`. Shared with workValidation so a
 * course manifest and a materialized plan agree on what a date even is.
 */
export const isStudyDay = (value) => { … the Task 1b body, unchanged … };
```

Keep a module-private `const isDay = isStudyDay;` alias if that keeps the existing call sites in `timing.mjs` untouched, or rename them — either is fine, but do NOT change the behavior.

Then in `workValidation.mjs`:

```javascript
import { isStudyDay as isDay } from '../timing.mjs';
```

In the `modules` block (currently ending `if (isPresent(m.media) …)`), add window checks. The mode is read from `raw.progression` which is validated below — read it directly, it is only a string comparison:

```javascript
        const isDated = raw.progression?.mode === 'dated_modules';
        if (isDated) {
          if (!isDay(m.opensOn)) errors.push(`${at}.opensOn must be YYYY-MM-DD for dated_modules`);
          if (!isDay(m.closesOn)) errors.push(`${at}.closesOn must be YYYY-MM-DD for dated_modules`);
          if (isDay(m.opensOn) && isDay(m.closesOn) && m.opensOn > m.closesOn) {
            errors.push(`${at}: window closes before it opens`);
          }
        } else if (isPresent(m.opensOn) || isPresent(m.closesOn)) {
          errors.push(`${at}: opensOn/closesOn are only meaningful when progression.mode is dated_modules`);
        }
```

After the `forEach`, still inside the `else` branch, check overlap. Compare in `closesOn` order so the message names a real pair:

```javascript
      if (raw.progression?.mode === 'dated_modules') {
        const windows = raw.modules
          .filter((m) => isObj(m) && isDay(m.opensOn) && isDay(m.closesOn))
          .sort((a, b) => a.opensOn.localeCompare(b.opensOn));
        windows.forEach((m, i) => {
          const prev = windows[i - 1];
          if (prev && m.opensOn <= prev.closesOn) {
            errors.push(`modules: "${prev.module}" and "${m.module}" have overlapping windows`);
          }
        });
      }
```

In the `progression` block, widen the mode check and scope the `one_active_module` rule:

```javascript
      if (!['sequential', 'module_blocks', 'dated_modules'].includes(p.mode)) {
        errors.push('progression.mode must be sequential|module_blocks|dated_modules');
      }
      if (p.mode === 'module_blocks' && p.one_active_module !== true) {
        errors.push('progression.one_active_module must be true for module_blocks');
      }
      // Dated modules never gate each other, so the serial-chain knobs are a
      // contradiction rather than a redundancy — refuse them by name.
      if (p.mode === 'dated_modules') {
        if (isPresent(p.one_active_module)) errors.push('progression.one_active_module is meaningless for dated_modules');
        if (isPresent(p.required_opening_module)) errors.push('progression.required_opening_module is meaningless for dated_modules');
      }
```

**Step 4: Run and verify green**

```bash
npx vitest run tests/isolated/domain/school/curriculum/ --reporter=dot
```

**Step 5: Commit**

```bash
git add backend/src/2_domains/school/curriculum/workValidation.mjs tests/isolated/domain/school/curriculum/workValidation.test.mjs
git commit -m "feat(school): a course may declare dated modules, and must date all of them"
```

---

## Task 3: `createCourseEnrollment` materializes `moduleSchedule`

**Files:**
- Modify: `backend/src/2_domains/school/curriculum/enrollment.mjs`
- Test: `backend/src/2_domains/school/curriculum/enrollment.test.mjs`

`createCourseEnrollment` currently takes `{ courseId, profile, units, policy, rng }`. It gains `modules` (the course's authored `modules[]`) and `today`.

**Step 1: Write the failing tests**

```javascript
describe('dated module schedules', () => {
  const modules = [
    { module: 'w35', title: 'Week 35', opensOn: '2026-08-24', closesOn: '2026-08-30' },
    { module: 'w36', title: 'Week 36', opensOn: '2026-08-31', closesOn: '2026-09-06' },
    { module: 'w37', title: 'Week 37', opensOn: '2026-09-07', closesOn: '2026-09-13' },
  ];
  const units = [
    { unitId: 'w35.d1', courseId: 'cfm', module: 'w35', sequence: 1 },
    { unitId: 'w36.d1', courseId: 'cfm', module: 'w36', sequence: 2 },
    { unitId: 'w37.d1', courseId: 'cfm', module: 'w37', sequence: 3 },
  ];
  const policy = { mode: 'dated_modules', lesson_order: 'sequence' };

  it('copies each module window onto the enrollment', () => {
    const e = createCourseEnrollment({ courseId: 'cfm', units, modules, policy, today: '2026-08-23' });
    expect(e.moduleSchedule).toEqual({
      w35: { opensOn: '2026-08-24', closesOn: '2026-08-30' },
      w36: { opensOn: '2026-08-31', closesOn: '2026-09-06' },
      w37: { opensOn: '2026-09-07', closesOn: '2026-09-13' },
    });
  });

  it('omits modules that closed before the enrollment date — they were never assigned', () => {
    const e = createCourseEnrollment({ courseId: 'cfm', units, modules, policy, today: '2026-09-08' });
    expect(Object.keys(e.moduleSchedule)).toEqual(['w37']);
    expect(e.moduleOrder).toEqual(['w37']);
  });

  it('keeps a module whose window closes today', () => {
    const e = createCourseEnrollment({ courseId: 'cfm', units, modules, policy, today: '2026-08-30' });
    expect(Object.keys(e.moduleSchedule)).toContain('w35');
  });

  it('orders dated modules by calendar, never shuffled', () => {
    const e = createCourseEnrollment({
      courseId: 'cfm', units, modules,
      policy: { mode: 'dated_modules', module_order: 'shuffle_once', lesson_order: 'sequence' },
      today: '2026-08-23', rng: () => 0,
    });
    expect(e.moduleOrder).toEqual(['w35', 'w36', 'w37']);
  });

  it('adds no moduleSchedule to a course that is not dated', () => {
    const e = createCourseEnrollment({ courseId: 'atlas', units: [
      { unitId: 'a.1', courseId: 'atlas', module: 'midwest', sequence: 1 },
    ], policy: { mode: 'module_blocks' } });
    expect(e.moduleSchedule).toBeUndefined();
  });
});
```

**Step 2: Run and watch it fail**

```bash
npx vitest run backend/src/2_domains/school/curriculum/enrollment.test.mjs -t "dated module schedules"
```
Expected: FAIL — `moduleSchedule` is undefined.

**Step 3: Implement**

Read the whole existing function first. It currently declares a local `const modules = [...]` (the module ids derived from the units), which **collides with the new `modules` parameter**. Rename that local to `publishedModules` and update its two uses (`optionalModules`, `otherModules`). That rename is the riskiest part of this task — the atlas tests will catch it if you get it wrong.

Signature:

```javascript
export function createCourseEnrollment({
  enrollmentId = null, courseId, profile, units,
  modules = [], policy = {}, today = null, rng = Math.random,
} = {}) {
```

After `otherModules`, add the dated branch:

```javascript
  // A dated course's calendar IS its order, so it never shuffles and never
  // takes an opening module. Windows are copied onto the enrollment for the
  // same reason lessonOrder is: a later course edit must not move a plan a
  // learner is already living in.
  const dated = policy.mode === 'dated_modules';
  const published = new Set(publishedModules);
  const windowed = dated
    ? (Array.isArray(modules) ? modules : [])
      // Only modules that actually publish units, and only those still open:
      // a week that closed before this learner enrolled was never theirs.
      .filter((m) => m?.module && published.has(m.module) && m.opensOn && m.closesOn)
      .filter((m) => !today || m.closesOn >= today)
      .sort((a, b) => a.opensOn.localeCompare(b.opensOn))
    : [];
```

Replace the `moduleOrder` assignment:

```javascript
  const moduleOrder = dated
    ? windowed.map((m) => m.module)
    : [
      ...(opening ? [opening] : []),
      ...(policy.module_order === 'shuffle_once' ? shuffle(otherModules, rng) : otherModules),
    ];
```

Leave the `lessonOrder` loop alone. It iterates `[...moduleOrder, ...optionalModules]`, so dropping a closed module from `moduleOrder` drops it from `lessonOrder` too — which is what we want.

Add one key to the returned object, after `lessonOrder`:

```javascript
    ...(dated ? {
      moduleSchedule: Object.fromEntries(
        windowed.map((m) => [m.module, { opensOn: m.opensOn, closesOn: m.closesOn }]),
      ),
    } : {}),
```

**Do not add `moduleSchedule` for a non-dated course.** The key must be absent, not empty — Task 5 branches on the policy, and an empty object on an atlas enrollment would be a lie in the stored YAML.

**Step 4: Run and verify green**

```bash
npx vitest run backend/src/2_domains/school/curriculum/enrollment.test.mjs
```
All pre-existing atlas/shuffle tests must still pass — the rename is the risky part.

**Step 5: Commit**

```bash
git add backend/src/2_domains/school/curriculum/enrollment.mjs backend/src/2_domains/school/curriculum/enrollment.test.mjs
git commit -m "feat(school): enrolling in a dated course freezes its calendar onto the plan"
```

---

## Task 4: `EnrollLearner` passes the course modules and today

**Files:**
- Modify: `backend/src/3_applications/school/usecases/EnrollLearner.mjs`
- Test: `backend/src/3_applications/school/usecases/EnrollLearner.test.mjs`

**Step 1: Write the failing test**

```javascript
it('materializes a dated course schedule from the catalog work', async () => {
  const record = await enrollLearner.execute({
    learnerId: 'learner3', syllabusId: 'cfm', enrolledBy: 'kckern', pin: '0000',
  });
  const entry = record.courses.find((c) => c.courseId === 'cfm');
  expect(entry.enrollment.moduleSchedule).toEqual({
    w35: { opensOn: '2026-08-24', closesOn: '2026-08-30' },
  });
});
```

The test's curriculum stub needs a `getWork`-style read for the authored modules. Follow whatever the existing fixture uses for `listUnits()`; add the matching accessor for works and stub it.

**Step 2: Run and watch it fail**

```bash
npx vitest run backend/src/3_applications/school/usecases/EnrollLearner.test.mjs -t dated
```

**Step 3: Implement**

`EnrollLearner` already computes a study day for `materializeTiming` via `studyDate(this.#clock(), this.#timezone)`. Reuse it.

**The port accessor already exists** — `ICurriculumCatalog.getWork(id)` (`backend/src/3_applications/school/ports/ICurriculumCatalog.mjs:89`), and `schoolLifecycle.mjs:794` already injects that catalog as `curriculum`. No port change, no adapter change:

```javascript
const work = await this.#curriculum.getWork(courseId);
```

Guard it: `getWork` may answer `null` for a course with no authored work record, and a non-dated course has no `modules[]` at all. `modules: work?.modules ?? []` covers both, and Task 3 already ignores `modules` unless the policy is `dated_modules`.

Pass both through:

```javascript
const enrollment = createCourseEnrollment({
  enrollmentId,
  courseId,
  profile,
  units: courseUnits,
  modules: work?.modules ?? [],
  policy,
  today,
  rng: this.#rng,
});
```

**Step 4: Run and verify green**

```bash
npx vitest run backend/src/3_applications/school/ --reporter=dot
```

**Step 5: Commit**

```bash
git add backend/src/3_applications/school/
git commit -m "feat(school): EnrollLearner hands the course calendar to the materializer"
```

---

## Task 5: The planner stops gating across dated modules

**Files:**
- Modify: `backend/src/2_domains/school/planner.mjs:143-178` (`blockerFor`), `:193-210` (`unlockedBy`)
- Test: `tests/isolated/domain/school/planner.test.mjs`

**Step 1: Write the failing tests**

Build a CFM-shaped fixture: three modules, three lessons each, `mode: dated_modules`, and an enrollment carrying `moduleSchedule`.

```javascript
describe('dated_modules gating', () => {
  const datedCourse = () => ([1, 2, 3].flatMap((w) => [1, 2, 3].map((d) => unit({
    unitId: `cfm.w${w}.d${d}`, title: `W${w}D${d}`, subject: 'scripture',
    courseId: 'cfm', module: `w${w}`, sequence: w * 10 + d,
  }))));
  const schedule = {
    w1: { opensOn: '2026-08-24', closesOn: '2026-08-30' },
    w2: { opensOn: '2026-08-31', closesOn: '2026-09-06' },
    w3: { opensOn: '2026-09-07', closesOn: '2026-09-13' },
  };
  const assignment = () => ({ courses: [{ courseId: 'cfm', enrollment: {
    schema: 'school.course-enrollment/v1', courseId: 'cfm',
    moduleOrder: ['w1', 'w2', 'w3'], optionalModules: [], moduleSchedule,
    lessonOrder: { w1: ['cfm.w1.d1','cfm.w1.d2','cfm.w1.d3'], w2: [...], w3: [...] },
  } }] });
  const policies = { cfm: { mode: 'dated_modules', lesson_order: 'sequence' } };
  const plan = (now, sessions = []) => planLearnerWork({
    learnerId: 'learner3', assignment: assignment(), units: datedCourse(),
    sessions, now, coursePolicies: policies,
  });

  it('offers the current week even though an earlier week is unfinished', () => {
    const p = plan('2026-09-01T09:00:00.000Z'); // inside w2, w1 untouched
    expect(p.next.unitId).toBe('cfm.w2.d1');
  });

  it('still chains lessons inside a week', () => {
    const p = plan('2026-09-01T09:00:00.000Z');
    const d2 = p.entries.find((e) => e.unitId === 'cfm.w2.d2');
    expect(d2.status).toBe('locked');
  });

  it('falls back to the newest unfinished week once the current one is done', () => {
    const done = ['cfm.w2.d1','cfm.w2.d2','cfm.w2.d3'].map((u) => passed(u));
    const p = plan('2026-09-01T09:00:00.000Z', done);
    expect(p.next.unitId).toBe('cfm.w1.d1');
    expect(p.next.timingState).toBe('catch_up');
  });

  it('ranks backlog newest-first', () => {
    const done = ['cfm.w3.d1','cfm.w3.d2','cfm.w3.d3'].map((u) => passed(u));
    const p = plan('2026-09-08T09:00:00.000Z', done); // in w3, w1 and w2 both stale
    expect(p.next.unitId).toBe('cfm.w2.d1');          // w2 is newer than w1
  });

  it('never offers a future week', () => {
    const p = plan('2026-08-25T09:00:00.000Z');
    const w2 = p.entries.find((e) => e.unitId === 'cfm.w2.d1');
    expect(w2.status).toBe('upcoming');
  });

  it('leaves nothing available when the week is done and the backlog is empty', () => {
    const done = [1,2,3].flatMap((w) => [1,2,3].map((d) => passed(`cfm.w${w}.d${d}`)));
    const p = plan('2026-09-08T09:00:00.000Z', done);
    expect(p.available).toEqual([]);
  });

  it('does not turn stale backlog dormant, however old', () => {
    const p = plan('2027-01-05T09:00:00.000Z');
    expect(p.entries.every((e) => e.status !== 'dormant')).toBe(true);
  });

  it('keeps an in-progress worksheet on a closed week resumable', () => {
    const p = plan('2026-09-08T09:00:00.000Z', [session({ unitId: 'cfm.w1.d1' })]);
    expect(p.entries.find((e) => e.unitId === 'cfm.w1.d1').status).toBe('in_progress');
    expect(p.next.unitId).toBe('cfm.w1.d1');
  });
});
```

Also add a regression guard in the existing atlas describe block:

```javascript
it('module_blocks still redirects to the unfinished earlier module', () => { /* existing behavior */ });
```

**Step 2: Run and watch them fail**

```bash
npx vitest run tests/isolated/domain/school/planner.test.mjs -t dated_modules
```

**Step 3: Implement**

**3a — `blockerFor`.** Add a dated branch BEFORE the `module_blocks` branch:

```javascript
    if (policy?.mode === 'dated_modules' && unit.module) {
      // Modules never gate each other in a dated course; the calendar chooses
      // which one is offered (see the timing pass below). Lessons still chain
      // within their own module, using the frozen enrollment order.
      const ordered = enrollment?.lessonOrder?.[unit.module]
        ? enrollment.lessonOrder[unit.module].map((id) => byUnitId.get(id)).filter(Boolean)
        : siblings.filter((u) => u.module === unit.module).sort(bySequence);
      const at = ordered.findIndex((u) => u.unitId === unit.unitId);
      for (let i = at - 1; i >= 0; i -= 1) if (!passedUnits.has(ordered[i].unitId)) return ordered[i];
      return null;
    }
```

**3b — `unlockedBy`.** Add the matching branch, returning `null` at a module boundary so a result receipt never promises next week early:

```javascript
    if (policy?.mode === 'dated_modules' && unit.module && enrollment) {
      const inModule = enrollment.lessonOrder?.[unit.module]?.map((id) => byUnitId.get(id)).filter(Boolean) ?? [];
      const at = inModule.findIndex((entry) => entry.unitId === unit.unitId);
      return at >= 0 && at + 1 < inModule.length ? inModule[at + 1].unitId : null;
    }
```

**3c — per-module timing and rank.** Before the `entries` map, compute the ranks. This is where "newest first" lives:

```javascript
  // Dated courses rank by calendar, not by course order: the module holding
  // today is rank 0, and unfinished closed modules follow newest-first. Rank
  // is derived from closesOn rather than a week count so an irregular gap
  // (a skipped conference week) orders correctly.
  const datedRankByModule = new Map();
  const datedStateByModule = new Map();
  if (today) {
    enrollmentByCourse.forEach(({ enrollment }, courseId) => {
      if (coursePolicies?.[courseId]?.mode !== 'dated_modules') return;
      const schedule = isPlainObject(enrollment?.moduleSchedule) ? enrollment.moduleSchedule : {};
      const closed = [];
      Object.entries(schedule).forEach(([moduleId, window]) => {
        let decided;
        try {
          decided = evaluateDatedModule(window, { today });
        } catch {
          errors.push(`${courseId}: module '${moduleId}' has an unusable window`);
          return;
        }
        datedStateByModule.set(`${courseId}/${moduleId}`, decided.state);
        if (decided.state === 'available') datedRankByModule.set(`${courseId}/${moduleId}`, 0);
        if (decided.state === 'catch_up') closed.push({ moduleId, closesOn: window.closesOn });
      });
      closed
        .sort((a, b) => b.closesOn.localeCompare(a.closesOn))
        .forEach(({ moduleId }, i) => datedRankByModule.set(`${courseId}/${moduleId}`, i + 1));
    });
  }
```

Import `evaluateDatedModule` alongside `evaluateTiming` at the top of the file.

**3d — stamp the entries.** Inside the `entries` map, after the existing `blocker` / `rawTiming` lines, add a dated branch that runs INSTEAD of `evaluateTiming` for these units:

```javascript
    const datedKey = unit.courseId && coursePolicies?.[unit.courseId]?.mode === 'dated_modules' && unit.module
      ? `${unit.courseId}/${unit.module}` : null;
    const datedState = datedKey ? datedStateByModule.get(datedKey) ?? null : null;
```

Then in the status ladder, replace the trailing `else if (today)` branch with:

```javascript
    } else if (datedKey) {
      // A dated module past its window stays offerable (`catch_up`), unlike a
      // closed course-level window, which goes dormant and needs a grown-up.
      if (datedState === 'upcoming') status = 'upcoming';
      if (datedState === null) status = 'upcoming'; // not in this enrollment's schedule
    } else if (today) {
      timingDecision = evaluateTiming(rawTiming, { today });
      …unchanged…
    }
```

And in the returned entry object:

```javascript
      timingState: datedKey ? (datedState ?? 'upcoming') : (timingDecision?.state ?? 'available'),
      timingPriority: datedKey ? TIMING_PRIORITY.medium : (timingDecision?.priority ?? 3),
      timingRank: datedKey ? (datedRankByModule.get(datedKey) ?? Number.MAX_SAFE_INTEGER) : 0,
      timingReasons: datedKey ? [datedState ?? 'not_scheduled'] : (timingDecision?.reasons ?? ['default_priority']),
```

Import `TIMING_PRIORITY` too.

**3e — sort by rank.** Change `byEffectivePriority`:

```javascript
  const byEffectivePriority = (left, right) => left.timingPriority - right.timingPriority
    || (left.timingRank ?? 0) - (right.timingRank ?? 0)
    || positionFor(left) - positionFor(right);
```

**Step 4: Run and verify green**

```bash
npx vitest run tests/isolated/domain/school/planner.test.mjs --reporter=dot
npx vitest run tests/isolated/domain/school/ --reporter=dot
```

**Step 5: Commit**

```bash
git add backend/src/2_domains/school/planner.mjs tests/isolated/domain/school/planner.test.mjs
git commit -m "feat(school): the clock picks the week, and backlog follows newest-first"
```

---

## Task 6: The agenda honors rank

**Files:**
- Modify: `backend/src/2_domains/school/agenda.mjs:87`
- Test: `tests/isolated/domain/school/agenda.test.mjs`

**Step 1: Write the failing test**

```javascript
it('picks the current dated module over an older one at equal priority', () => {
  const entries = [
    { unitId: 'cfm.w1.d1', subject: 'scripture', courseId: 'cfm', status: 'available', timingPriority: 3, timingRank: 1, timingState: 'catch_up' },
    { unitId: 'cfm.w2.d1', subject: 'scripture', courseId: 'cfm', status: 'available', timingPriority: 3, timingRank: 0, timingState: 'available' },
  ];
  const { sections } = planDailyAgenda({ plan: { entries }, now: '2026-09-01T09:00:00.000Z' });
  expect(sections.find((s) => s.subject === 'scripture').next.unitId).toBe('cfm.w2.d1');
});
```

Note the array is deliberately in the wrong order so a stable sort cannot pass it by accident.

**Step 2: Run and watch it fail**

```bash
npx vitest run tests/isolated/domain/school/agenda.test.mjs -t "current dated module"
```

**Step 3: Implement**

```javascript
const byEntryPriority = (left, right) => (left.timingPriority ?? 3) - (right.timingPriority ?? 3)
  || (left.timingRank ?? 0) - (right.timingRank ?? 0);
```

**Step 4: Run and verify green**

```bash
npx vitest run tests/isolated/domain/school/agenda.test.mjs
```

**Step 5: Commit**

```bash
git add backend/src/2_domains/school/agenda.mjs tests/isolated/domain/school/agenda.test.mjs
git commit -m "feat(school): the agenda's one block goes to this week, not the oldest week"
```

---

## Task 7: Full-stack green, then the course content

**Step 1: Run everything**

```bash
npx vitest run backend/src/2_domains/school backend/src/3_applications/school tests/isolated/domain/school --reporter=dot
```
Expected: the 1123 baseline tests plus the new ones, 0 failures. Investigate any pre-existing test that now fails — that is a real regression, not noise.

**Step 2: Edit the course**

`data/content/school/scripture/come-follow-me-ot-2026/_index.yml` — this file is in the DATA tree (`$DAYLIGHT_BASE_PATH/data`), not the repo. Change `progression`:

```yaml
progression:
  # Weeks are dated: the calendar picks the current one, and unfinished
  # earlier weeks stay available as catch-up, newest first. Days inside a
  # week shuffle once, the way the atlas shuffles lessons.
  mode: dated_modules
  module_order: fixed
  lesson_order: shuffle_once
```

Delete `required_opening_module` and `one_active_module` — Task 2 rejects both by name for a dated course.

**Keep `module_order: fixed`.** `workValidation.mjs:71-73` checks it unconditionally via `oneOf`, so omitting it fails with `progression.module_order must be one of fixed|shuffle_once, got: undefined`. It is also still load-bearing: `enrollment.mjs` reads `policy.module_order` when freezing `moduleOrder`, which Task 5 keeps using alongside `moduleSchedule`. `fixed` is the honest value for a calendar-ordered course.

Add a window to each of the 17 modules. Weeks run Monday–Sunday:

```yaml
modules:
  - { module: w35-aug24, title: 'Aug 24–30 · Psalms 49–86', opensOn: '2026-08-24', closesOn: '2026-08-30' }
  - { module: w36-aug31, title: 'Aug 31–Sep 6 · Psalms 102–150', opensOn: '2026-08-31', closesOn: '2026-09-06' }
  - { module: w37-sep07, title: 'Sep 7–13 · Proverbs; Ecclesiastes', opensOn: '2026-09-07', closesOn: '2026-09-13' }
  - { module: w38-sep14, title: 'Sep 14–20 · Isaiah 1–12', opensOn: '2026-09-14', closesOn: '2026-09-20' }
  - { module: w39-sep21, title: 'Sep 21–27 · Isaiah 13–35', opensOn: '2026-09-21', closesOn: '2026-09-27' }
  - { module: w40-sep28, title: 'Sep 28–Oct 4 · Isaiah 40–49', opensOn: '2026-09-28', closesOn: '2026-10-04' }
  - { module: w41-oct05, title: 'Oct 5–11 · Isaiah 50–57', opensOn: '2026-10-05', closesOn: '2026-10-11' }
  - { module: w42-oct12, title: 'Oct 12–18 · Isaiah 58–66', opensOn: '2026-10-12', closesOn: '2026-10-18' }
  - { module: w43-oct19, title: 'Oct 19–25 · Jeremiah 1–3; 7; 16–18; 20', opensOn: '2026-10-19', closesOn: '2026-10-25' }
  - { module: w44-oct26, title: 'Oct 26–Nov 1 · Jeremiah 31–33; 36–38; Lamentations 1, 3', opensOn: '2026-10-26', closesOn: '2026-11-01' }
  - { module: w45-nov02, title: 'Nov 2–8 · Ezekiel 1–3; 33–34; 36–37; 47', opensOn: '2026-11-02', closesOn: '2026-11-08' }
  - { module: w46-nov09, title: 'Nov 9–15 · Daniel 1–7', opensOn: '2026-11-09', closesOn: '2026-11-15' }
  - { module: w47-nov16, title: 'Nov 16–22 · Hosea 1–6; 10–14; Joel 1–3', opensOn: '2026-11-16', closesOn: '2026-11-22' }
  - { module: w48-nov23, title: 'Nov 23–29 · Amos 1–9; Obadiah 1; Jonah 1–4', opensOn: '2026-11-23', closesOn: '2026-11-29' }
  - { module: w49-nov30, title: 'Nov 30–Dec 6 · Micah 1–7; Nahum 1–3; Habakkuk 1–3; Zephaniah 1–3', opensOn: '2026-11-30', closesOn: '2026-12-06' }
  - { module: w50-dec07, title: 'Dec 7–13 · Haggai 1–2; Zechariah 1–4; 7–14', opensOn: '2026-12-07', closesOn: '2026-12-13' }
  - { module: w51-dec14, title: 'Dec 14–20 · Malachi 1–4', opensOn: '2026-12-14', closesOn: '2026-12-20' }
```

**Verify the dates against the titles before saving** — the titles are the authored truth and a mismatch would silently reschedule a week.

**Step 3: Validate the edited course**

```bash
node -e "
const yaml=require('js-yaml'),fs=require('fs');
const p=process.env.DAYLIGHT_BASE_PATH+'/data/content/school/scripture/come-follow-me-ot-2026/_index.yml';
const raw=yaml.load(fs.readFileSync(p,'utf8'));
import('./backend/src/2_domains/school/curriculum/workValidation.mjs').then(m=>{
  const r=m.validateWork(raw); console.log(r.errors.length?r.errors:'VALID');
});"
```
Expected: `VALID`.

**Step 4: Commit**

The data tree is not this repo — note the edit in the commit message but commit only repo files. If the course file is tracked here, commit it; otherwise record it in the PR/branch notes.

---

## Task 8: Author the syllabus and enroll Learner3 and Learner4

**Step 1: Create the syllabus**

`$DAYLIGHT_BASE_PATH/data/household/school/plans/syllabi/come-follow-me-ot-2026.yml` — this directory does not exist yet; create it.

Do NOT add a `modules:` key — `syllabus.mjs` refuses it (scope subsetting is not built). Do NOT add a `timingTemplate` — that is course-level anchor timing, a different mechanism from `moduleSchedule`.

**A syllabus carries `profile`** (`syllabus.mjs:64-69`, validated against the course's own `work.profiles`), and `EnrollLearner` takes no profile override. So Learner3 and Learner4 need **two syllabus files**, identical but for id, title, and profile:

`come-follow-me-ot-2026-lower.yml`
```yaml
schema: school.syllabus/v1
syllabusId: come-follow-me-ot-2026-lower
title: Come Follow Me — Old Testament 2026 (lower)
courseId: come-follow-me-ot-2026
profile: lower
policy:
  lesson_order: shuffle_once
```

`come-follow-me-ot-2026-upper.yml` is the same with `-upper`, `(upper)`, and `profile: upper`. Both profiles are declared by the course, so validation will accept them.

**Step 2: Restart the backend**

Household config is boot-cached. Touch a watched backend file so nodemon reloads, or restart the dev server. **Do not start a second backend** — it makes real Home Assistant calls and fights the running one for device authority.

**Step 3: Enroll both learners**

```bash
curl -X POST http://localhost:3112/api/v1/school/lifecycle/enrollments/learner3 \
  -H 'Content-Type: application/json' \
  -d '{"syllabusId":"come-follow-me-ot-2026-lower","enrolledBy":"kckern","pin":"<pin>"}'

curl -X POST http://localhost:3112/api/v1/school/lifecycle/enrollments/learner4 \
  -H 'Content-Type: application/json' \
  -d '{"syllabusId":"come-follow-me-ot-2026-upper","enrolledBy":"kckern","pin":"<pin>"}'
```

**Step 4: Verify the materialized plans**

```bash
grep -A4 moduleSchedule "$DAYLIGHT_BASE_PATH/data/household/school/plans/learners/learner3.yml" | head -20
```
Expected: all 17 windows (enrolling on or before Aug 24 keeps every week), `moduleOrder` in calendar order, `lessonOrder` shuffled within each week.

**Step 5: Verify the agenda offers the right week**

Pull the agenda for each learner and confirm scripture's next entry is a `w35-aug24` lesson with `timingState: 'available'` and `timingRank: 0`, and that no `w36` entry is available.

---

## Task 9: Documentation

**Files:**
- Modify: `docs/reference/school/timing-and-priority.md`
- Modify: `docs/reference/school/enrollment.md`
- Modify: `docs/reference/school/README.md`

`timing-and-priority.md` §1 currently states timing does not attach to modules. That is now false for `dated_modules`. Rewrite that paragraph to name both mechanisms and say when each applies: anchor timing for an occasion-shaped course (Advent, Fourth of July), `moduleSchedule` for a calendar-shaped one (Come Follow Me).

`enrollment.md` gains `moduleSchedule` in its `school.course-enrollment/v1` example, and its example still shows the retired `courses:` key where the live files use `enrollments:` — fix that too.

`README.md`: a short parent-facing paragraph on what a dated course does when a week is missed.

**Commit**

```bash
git add docs/
git commit -m "docs(school): timing reaches modules now, not just whole enrollments"
```

---

## Notes for the implementer

- **`PLAN_STATUSES` does not change.** `catch_up` is a `timingState`, not a `status`; the status stays `available` so `agenda.mjs` keeps offering it.
- **The `dormant` distinction is the point.** `dormant` means a grown-up must intervene. Dated backlog must never reach it.
- **Do not add focus blocks or urgency.** Every CFM entry sits at `medium` base priority; `timingRank` orders within the subject and nothing crosses subject boundaries. Adding `urgentBlocks` here would let scripture displace other subjects, which was explicitly ruled out.
- **Watch the rename in Task 3.** `createCourseEnrollment` already has a local `modules`; the new parameter collides with it. Rename the local to `publishedModules` and check all three uses.
