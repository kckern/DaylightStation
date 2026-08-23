# Student Completion State Machine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the School lifecycle a learner-level "done for today" fact —
`incomplete | complete | no_work_today`, purely derived from the daily
agenda — plus a push notification when it changes, so other subsystems
(piano-kiosk unlocks, coins) can gate on it without re-deriving the agenda.

**Architecture:** `planDailyAgenda` (`agenda.mjs`) gains one new field per
section, `obligation`. A new pure domain module, `completion.mjs`, folds
those fields into the three-state roll-up. A new application use case,
`GetLearnerDayCompletion`, assembles the same inputs `BuildAgenda` already
reads and calls the fold. `CloseSessionOutcome` gains one new optional
`eventBus` publish so a new `SchoolCompletionBridge` (same shape as
`DoNowSchoolBridge`) can react to every settled session — curriculum and
language both, since `CloseLanguageDay` already funnels through the same
`#settle` — and push `school.completion.changed` only on an actual state
transition.

**Tech Stack:** Node ESM (`.mjs`), Vitest, the existing DDD layering
(`2_domains/school`, `3_applications/school`, `5_composition/modules`).

**Spec:** `docs/_wip/plans/2026-08-23-student-completion-state-machine-design.md`

## Global Constraints

- Domain modules (`agenda.mjs`, `completion.mjs`) stay pure: no I/O, no clock
  reads, no persistence. `now` is injected where needed.
- Every new/changed dependency is optional and additive (`eventBus = null`,
  etc.) — no existing constructor call site may need to change to keep
  working.
- Test runner is **Vitest**, not `node:test` or bare Jest — `tests/isolated/**`
  requires it. Run a single file with
  `npx vitest run <path> --config vitest.isolated.config.mjs` if a bare
  `npx vitest run <path>` doesn't pick up the right config; check
  `package.json`'s `test:*` scripts if unsure which config applies to a
  `tests/isolated/**` path.
- Import aliases: `#domains/*` → `backend/src/2_domains/*`, `#apps/*` →
  `backend/src/3_applications/*`, `#composition/*` →
  `backend/src/5_composition/*`, `#testlib/*` → `tests/_lib/*`.
- Follow existing bridge lifecycle convention exactly (`DoNowSchoolBridge`):
  constructor validates and stores deps without subscribing; `start()`
  subscribes (safe to call twice); `stop()` unsubscribes (safe to call before
  `start()` or twice).
- No new coins/games consumer code — the design's §6 consumer contract is
  documented for other subsystems to implement independently. This plan
  builds only the fact and the event, not any consumer of it.

---

### Task 1: `agenda.mjs` — scope `programUnavailable`, add `obligation`

**Files:**
- Modify: `backend/src/2_domains/school/agenda.mjs:134-207`
- Test: `tests/isolated/domain/school/agenda.test.mjs`

**Interfaces:**
- Consumes: nothing new — same `plan`, `sessions`, `programStatuses`, `now`,
  `timezone`, `boundaryHour` args `planDailyAgenda` already takes.
- Produces: each section in `planDailyAgenda(...).sections` gains
  `obligation: { state: 'served'|'excused'|'obligated', reason: string|null }`.
  `reason` is one of `null` (state is `served` or `obligated`),
  `elective_only`, `program_unavailable`, `blocked_no_offer`,
  `awaiting_grown_up`, `opens_later`, `caught_up`, `optional_backlog`,
  `not_due_yet` (state is `excused`), or `suppressed_by_focus` (state is
  `excused`, set only by the suppression pass, §1.4 below).

Read `backend/src/2_domains/school/agenda.mjs` fully before editing — the
exact current text of the `sections` map and the suppression loop is quoted
below from that file as it stands before this task.

- [ ] **Step 1: Write the failing tests — `programUnavailable` scoping**

Add to `tests/isolated/domain/school/agenda.test.mjs`, after the existing
`'a launcher error marks the section unavailable without touching others'`
test (currently around line 63-75):

```js
  it('a launcher error blanks only the erroring program entry, not a live curriculum sibling in the same subject', () => {
    const { sections } = planDailyAgenda(args({
      plan: plan([
        entry({ unitId: 'language-daily', subject: 'language', courseId: null, sequence: null, program: 'language', cadence: 'daily' }),
        entry({ unitId: 'lang-writing', subject: 'language', courseId: null, sequence: null }),
      ]),
      programStatuses: { language: { error: true } },
    }));
    const lang = sections.find((s) => s.subject === 'language');
    expect(lang.programUnavailable).toBe(true);
    expect(lang.next.unitId).toBe('lang-writing');
  });
```

- [ ] **Step 2: Run the tests to verify the new one fails**

Run: `npx vitest run tests/isolated/domain/school/agenda.test.mjs -t "blanks only the erroring program entry"`
Expected: FAIL — `lang.next` is currently `null` (the whole section blanks).

- [ ] **Step 3: Implement the `programUnavailable` scoping fix**

In `backend/src/2_domains/school/agenda.mjs`, inside the `sections = ...map(...)`
callback, replace:

```js
    const programUnavailable = statuses.some((s) => s.error === true);
    const programDone = statuses.some((s) => !s.error && s.doneToday === true);
    const candidate = [...list.filter((e) => e.status === 'in_progress'), ...list.filter((e) => e.status === 'available')]
      .sort(byEntryPriority)[0] ?? null;
```

with:

```js
    const programUnavailable = statuses.some((s) => s.error === true);
    const programDone = statuses.some((s) => !s.error && s.doneToday === true);
    // Only entries belonging to an UNAVAILABLE program are excluded from
    // candidacy — not the whole section. Gating the whole section on the
    // subject-level `programUnavailable` flag (the old behaviour) blanked a
    // live curriculum sibling whenever ANY program in the subject errored,
    // and was order-dependent besides (whichever entry won priority).
    const unavailablePrograms = new Set(
      programs.filter((e) => programStatuses[e.program]?.error === true).map((e) => e.program),
    );
    const eligible = list.filter((e) => !(e.program && unavailablePrograms.has(e.program)));
    const candidate = [...eligible.filter((e) => e.status === 'in_progress'), ...eligible.filter((e) => e.status === 'available')]
      .sort(byEntryPriority)[0] ?? null;
```

Then replace:

```js
    const next = !servedToday && !programUnavailable ? candidate : null;
```

with:

```js
    const next = !servedToday ? candidate : null;
```

- [ ] **Step 4: Run all agenda tests to verify Step 3 passes and nothing broke**

Run: `npx vitest run tests/isolated/domain/school/agenda.test.mjs`
Expected: PASS — every existing test still passes (including the
program-only-error test at line ~63-75, which still yields
`lang.next === null` since that subject has no eligible entries once its
only program is excluded), plus the new mixed-section test.

- [ ] **Step 5: Write the failing tests — `obligation`, rules 1/2/6 (served, suppressed, obligated)**

Add a new `describe('obligation', ...)` block to
`tests/isolated/domain/school/agenda.test.mjs`:

```js
describe('obligation', () => {
  it('rule 1: a non-elective pass today serves, ignoring the focus multi-block term', () => {
    const { sections } = planDailyAgenda(args({
      plan: plan([entry({ unitId: 'u1', subject: 'math', status: 'completed' })]),
      sessions: [{ sessionId: 's1', unitId: 'u1', state: 'closed', terminal: true,
        outcome: { result: 'passed', at: '2026-07-29T15:00:00Z' }, gradedPercent: 90, updatedAt: '2026-07-29T15:00:00Z' }],
    }));
    expect(sections[0].obligation).toEqual({ state: 'served', reason: null });
  });

  it('rule 1: an elective pass today does NOT serve a subject whose required entry is untouched', () => {
    const { sections } = planDailyAgenda(args({
      plan: plan([
        entry({ unitId: 'required', subject: 'math', sequence: 1 }),
        entry({ unitId: 'elective', subject: 'math', sequence: 2, courseId: null, elective: true, status: 'completed' }),
      ]),
      sessions: [{ sessionId: 's1', unitId: 'elective', state: 'closed', terminal: true,
        outcome: { result: 'passed', at: '2026-07-29T15:00:00Z' }, gradedPercent: 100, updatedAt: '2026-07-29T15:00:00Z' }],
    }));
    expect(sections[0].obligation).toEqual({ state: 'obligated', reason: null });
  });

  it('rule 2: a section suppressed by a focus day excuses as suppressed_by_focus, not obligated', () => {
    const urgentTiming = {
      schema: 'school.timing/v1', availability: {}, target: { dueOn: '2026-07-31', strength: 'firm' },
      basePriority: 'high', flexibility: 'protected', agenda: { normalBlocks: 1, urgentBlocks: 3 }, urgencyLeadDays: 7,
    };
    const flexibleTiming = {
      schema: 'school.timing/v1', availability: {}, basePriority: 'low', flexibility: 'flexible',
      agenda: { normalBlocks: 1, urgentBlocks: 1 }, urgencyLeadDays: 7,
    };
    const { sections } = planDailyAgenda(args({
      plan: plan([
        entry({ unitId: 'focus1', subject: 'math', timing: urgentTiming, timingState: 'urgent', timingPriority: 1, timingReasons: ['due_on_2026-07-31'] }),
        entry({ unitId: 'flex1', subject: 'science', timing: flexibleTiming, timingState: 'available', timingPriority: 4 }),
      ]),
    }));
    const science = sections.find((s) => s.subject === 'science');
    expect(science.suppressed).not.toBeNull();
    expect(science.obligation).toEqual({ state: 'excused', reason: 'suppressed_by_focus' });
    const math = sections.find((s) => s.subject === 'math');
    expect(math.obligation).toEqual({ state: 'obligated', reason: null });
  });
});
```

Note: `entry()`'s default fixture (top of the file) does not set `timing`/
`timingState`/`timingPriority`/`timingReasons` — confirm those pass through
`planDailyAgenda` unchanged (it reads them straight off each plan entry; it
never recomputes timing itself) before relying on this shape. If the fixture
helper's defaults don't include these keys, add them to the `entry()`
default object at the top of the file (`timing: null, timingState:
'available', timingPriority: 3, timingReasons: ['default_priority']`) rather
than repeating them in every call — every other test in the file benefits
from the more complete fixture.

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npx vitest run tests/isolated/domain/school/agenda.test.mjs -t "obligation"`
Expected: FAIL — `obligation` does not exist on a section yet (`undefined`).

- [ ] **Step 7: Implement `obligation` (rules 1, 2, 6 first — the skeleton)**

Still inside the `sections.map(...)` callback in `agenda.mjs`, after the
existing `servedToday`/`next`/`lockedRemedy`/`timingNotice` block, add:

```js
    // --- obligation (student-completion-state-machine design, 2026-08-23) --
    const nonElectiveList = list.filter((e) => !e.elective);
    const actionable = eligible.filter((e) => !e.elective && (e.status === 'in_progress' || e.status === 'available'));
    const obligationServed = nonElectiveList.some((e) => passedTodayIds.has(e.unitId)) || programDone;
    const isBacklog = (e) => e.timing?.mode === 'catch_up' || e.timingState === 'catch_up';
    const hasNonElective = (pred) => nonElectiveList.some(pred);
    let obligation;
    if (obligationServed) {
      obligation = { state: 'served', reason: null };
    } else if (actionable.length === 0) {
      let reason;
      if (nonElectiveList.length === 0) reason = 'elective_only';
      else if (hasNonElective((e) => e.program && unavailablePrograms.has(e.program))) reason = 'program_unavailable';
      else if (hasNonElective((e) => e.status === 'locked')) reason = 'blocked_no_offer';
      else if (hasNonElective((e) => e.status === 'dormant')) reason = 'awaiting_grown_up';
      else if (hasNonElective((e) => e.status === 'upcoming')) reason = 'opens_later';
      else reason = 'caught_up';
      obligation = { state: 'excused', reason };
    } else if (actionable.every(isBacklog)) {
      obligation = { state: 'excused', reason: 'optional_backlog' };
    } else if (actionable.every((e) => e.timingState === 'available' && e.timing?.target?.dueOn)) {
      obligation = { state: 'excused', reason: 'not_due_yet' };
    } else {
      obligation = { state: 'obligated', reason: null };
    }
```

Then add `obligation,` to the returned section object (after `suppressed:
null,` and before `_subjectPosition: subjectPosition,`).

- [ ] **Step 8: Wire `obligation` into the suppression pass**

Rule 1 outranks rule 2: a suppressed section that already `served` must
stay `served`, not flip to `excused`. In the `focusSections.forEach(...)`
loop, replace:

```js
      candidate.suppressed = {
        bySubject: focus.subject,
        byUnitId: focus.next.unitId,
        reasons: focus.next.timingReasons ?? ['urgent_focus'],
      };
      candidate.next = null;
      remaining -= 1;
```

with:

```js
      candidate.suppressed = {
        bySubject: focus.subject,
        byUnitId: focus.next.unitId,
        reasons: focus.next.timingReasons ?? ['urgent_focus'],
      };
      candidate.next = null;
      if (candidate.obligation.state !== 'served') {
        candidate.obligation = { state: 'excused', reason: 'suppressed_by_focus' };
      }
      remaining -= 1;
```

- [ ] **Step 9: Run the tests to verify Steps 7-8 pass**

Run: `npx vitest run tests/isolated/domain/school/agenda.test.mjs`
Expected: PASS — all tests, including the three new `obligation` ones.

- [ ] **Step 10: Write the failing tests — remaining reasons**

Add to the `describe('obligation', ...)` block:

```js
  it('rule 3: elective_only when a subject holds only elective work', () => {
    const { sections } = planDailyAgenda(args({
      plan: plan([entry({ unitId: 'e1', subject: 'art', courseId: null, elective: true })]),
    }));
    expect(sections[0].obligation).toEqual({ state: 'excused', reason: 'elective_only' });
  });

  it('rule 3: awaiting_grown_up when the only non-elective entry is dormant', () => {
    const { sections } = planDailyAgenda(args({
      plan: plan([entry({ unitId: 'd1', subject: 'math', status: 'dormant' })]),
    }));
    expect(sections[0].obligation).toEqual({ state: 'excused', reason: 'awaiting_grown_up' });
  });

  it('rule 3: opens_later when the only non-elective entry is upcoming', () => {
    const { sections } = planDailyAgenda(args({
      plan: plan([entry({ unitId: 'u1', subject: 'math', status: 'upcoming' })]),
    }));
    expect(sections[0].obligation).toEqual({ state: 'excused', reason: 'opens_later' });
  });

  it('rule 3: caught_up when the only non-elective entry is already completed and nothing new is offered', () => {
    const { sections } = planDailyAgenda(args({
      plan: plan([entry({ unitId: 'done1', subject: 'math', status: 'completed' })]),
    }));
    expect(sections[0].obligation).toEqual({ state: 'excused', reason: 'caught_up' });
  });

  it('rule 4: optional_backlog when every actionable non-elective entry is catch-up backlog', () => {
    const { sections } = planDailyAgenda(args({
      plan: plan([entry({ unitId: 'w1', subject: 'scripture', timingState: 'catch_up' })]),
    }));
    expect(sections[0].obligation).toEqual({ state: 'excused', reason: 'optional_backlog' });
  });

  it('rule 5: not_due_yet when an available entry carries a future target and is not yet urgent', () => {
    const quietTiming = {
      schema: 'school.timing/v1', availability: { opensOn: '2026-07-27' }, target: { dueOn: '2026-08-07', strength: 'firm' },
      basePriority: 'medium', flexibility: 'protected', agenda: { normalBlocks: 1, urgentBlocks: 1 }, urgencyLeadDays: 1,
    };
    const { sections } = planDailyAgenda(args({
      plan: plan([entry({ unitId: 'w1', subject: 'writing', timing: quietTiming, timingState: 'available', timingPriority: 3 })]),
    }));
    expect(sections[0].obligation).toEqual({ state: 'excused', reason: 'not_due_yet' });
  });

  it('rule 6: obligated once an urgent entry (inside its lead window) is the only actionable work', () => {
    const urgentTiming = {
      schema: 'school.timing/v1', availability: { opensOn: '2026-07-27' }, target: { dueOn: '2026-07-31', strength: 'firm' },
      basePriority: 'medium', flexibility: 'protected', agenda: { normalBlocks: 1, urgentBlocks: 1 }, urgencyLeadDays: 7,
    };
    const { sections } = planDailyAgenda(args({
      plan: plan([entry({ unitId: 'w1', subject: 'writing', timing: urgentTiming, timingState: 'urgent', timingPriority: 1 })]),
    }));
    expect(sections[0].obligation).toEqual({ state: 'obligated', reason: null });
  });
```

- [ ] **Step 11: Run the tests to verify they fail, then pass**

Run: `npx vitest run tests/isolated/domain/school/agenda.test.mjs -t "obligation"`
Expected: the six new tests FAIL first (`caught_up`/`optional_backlog`/
`not_due_yet` reasons especially — verify each against the Step 7
implementation; if any fails for a reason OTHER than "obligation doesn't
exist", the implementation logic (not the test) is wrong and must be fixed
before proceeding — do not adjust a test to match incorrect behavior).
Then, with no further implementation changes expected (Step 7's logic
already covers all six), re-run and confirm PASS. If any genuinely fails,
fix `agenda.mjs`'s obligation block, not the test.

- [ ] **Step 12: Run the full domain test suite**

Run: `npx vitest run tests/isolated/domain/school/`
Expected: PASS, all files.

- [ ] **Step 13: Commit**

```bash
git add backend/src/2_domains/school/agenda.mjs tests/isolated/domain/school/agenda.test.mjs
git commit -m "feat(school): scope programUnavailable to its own entries; add section obligation"
```

---

### Task 2: `completion.mjs` — pure roll-up

**Files:**
- Create: `backend/src/2_domains/school/completion.mjs`
- Test: `tests/isolated/domain/school/completion.test.mjs`

**Interfaces:**
- Consumes: `sections` — the array `planDailyAgenda(...).sections` produces,
  specifically each section's `subject` and `obligation` fields (Task 1).
  `planErrors` — the array `planLearnerWork(...).errors` produces (strings).
- Produces: `resolveDayCompletion({ sections, planErrors })` →
  `{ state: 'incomplete'|'complete'|'no_work_today', excused: Array<{subject: string|null, reason: string}> }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/isolated/domain/school/completion.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { resolveDayCompletion } from '#domains/school/completion.mjs';

const served = (subject) => ({ subject, obligation: { state: 'served', reason: null } });
const obligated = (subject) => ({ subject, obligation: { state: 'obligated', reason: null } });
const excused = (subject, reason) => ({ subject, obligation: { state: 'excused', reason } });

describe('resolveDayCompletion', () => {
  it('any obligated section -> incomplete, even alongside served and excused ones', () => {
    const result = resolveDayCompletion({
      sections: [served('math'), obligated('writing'), excused('art', 'elective_only')],
    });
    expect(result.state).toBe('incomplete');
  });

  it('no obligated, at least one served -> complete', () => {
    const result = resolveDayCompletion({
      sections: [served('math'), excused('art', 'elective_only')],
    });
    expect(result.state).toBe('complete');
  });

  it('nothing obligated, nothing served -> no_work_today', () => {
    const result = resolveDayCompletion({
      sections: [excused('math', 'awaiting_grown_up'), excused('art', 'elective_only')],
    });
    expect(result.state).toBe('no_work_today');
  });

  it('no sections at all -> no_work_today', () => {
    expect(resolveDayCompletion({ sections: [] }).state).toBe('no_work_today');
  });

  it('excused list is always returned, even on a complete day, for teacher-console visibility', () => {
    const result = resolveDayCompletion({
      sections: [served('math'), excused('science', 'awaiting_grown_up')],
    });
    expect(result.state).toBe('complete');
    expect(result.excused).toEqual([{ subject: 'science', reason: 'awaiting_grown_up' }]);
  });

  it('a non-empty planErrors list adds a plan_error pseudo-section to excused, and does not by itself force incomplete', () => {
    const result = resolveDayCompletion({
      sections: [served('math')],
      planErrors: ["orphan-course: assigned but no published units belong to it"],
    });
    expect(result.state).toBe('complete');
    expect(result.excused).toContainEqual({ subject: null, reason: 'plan_error' });
  });

  it('the cram-day case: an obligated urgent focus section plus a suppressed sibling still yields incomplete overall', () => {
    // Regression for the compound bug the design doc's §1 rejects: obligation
    // must not silently drop to zero on a focus day.
    const result = resolveDayCompletion({
      sections: [obligated('math'), excused('science', 'suppressed_by_focus')],
    });
    expect(result.state).toBe('incomplete');
  });

  it('all subjects caught_up -> no_work_today, not complete (the caught-up-forever case)', () => {
    const result = resolveDayCompletion({
      sections: [excused('math', 'caught_up'), excused('writing', 'caught_up')],
    });
    expect(result.state).toBe('no_work_today');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/isolated/domain/school/completion.test.mjs`
Expected: FAIL — the module does not exist yet (import error).

- [ ] **Step 3: Implement `completion.mjs`**

Create `backend/src/2_domains/school/completion.mjs`:

```js
/**
 * The learner-level "done for today" fact (design:
 * 2026-08-23-student-completion-state-machine-design). Pure fold over the
 * `obligation` field `planDailyAgenda` (agenda.mjs) computes per section —
 * no I/O, no clock, no persistence, purely derived so it can never strand an
 * earned unlock behind stale state.
 *
 * Three states, not a boolean, so an empty/broken plan cannot read as
 * "complete" (`no_work_today`), and a consumer can tell "finished real work"
 * apart from "had nothing to do".
 */

/**
 * @param {object} args
 * @param {Array<{subject: string|null, obligation: {state: string, reason: string|null}}>} args.sections
 * @param {string[]} [args.planErrors] - `planLearnerWork(...).errors`
 * @returns {{ state: 'incomplete'|'complete'|'no_work_today',
 *             excused: Array<{subject: string|null, reason: string}> }}
 */
export function resolveDayCompletion({ sections = [], planErrors = [] } = {}) {
  const pseudo = planErrors.length
    ? [{ subject: null, obligation: { state: 'excused', reason: 'plan_error' } }]
    : [];
  const all = [...sections, ...pseudo];
  const excused = all
    .filter((s) => s.obligation.state === 'excused')
    .map((s) => ({ subject: s.subject, reason: s.obligation.reason }));

  if (all.some((s) => s.obligation.state === 'obligated')) return { state: 'incomplete', excused };
  if (all.some((s) => s.obligation.state === 'served')) return { state: 'complete', excused };
  return { state: 'no_work_today', excused };
}

export default resolveDayCompletion;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/isolated/domain/school/completion.test.mjs`
Expected: PASS, all 8 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/school/completion.mjs tests/isolated/domain/school/completion.test.mjs
git commit -m "feat(school): add resolveDayCompletion — the pure agenda completion roll-up"
```

---

### Task 3: `CloseSessionOutcome` — publish `school.session.outcome-recorded`

**Files:**
- Modify: `backend/src/3_applications/school/usecases/CloseSessionOutcome.mjs`
- Test: `tests/isolated/application/school/closeOutcome.test.mjs`

**Interfaces:**
- Consumes: an optional `eventBus` constructor dep with a `publish(topic,
  payload)` method (matches `IEventBus`, `backend/src/0_system/eventbus/IEventBus.mjs`).
- Produces: on every `#settle` call (pass or fail, fresh or resettling),
  when `eventBus` is present: `eventBus.publish('school.session.outcome-recorded',
  { learnerId, sessionId, unitId, result, at })`.

**Verified against the real file** (`tests/isolated/application/school/closeOutcome.test.mjs`,
read in full): its `build({...})` helper (lines 23-53) constructs `close =
new CloseSessionOutcome({...})` from module-level options with defaults
(`economyEnabled = true, throwOn = null, receiptPrinter = undefined,
wireReviewQueue = true, passOverrides = null, teacherGate = null`), and
`close`/`sessions`/`clock` are module-level `let` bindings set inside
`build()`. Its `launched({ unitId, sessionId, passedEarlier })` helper
(lines 79-91) drives a session to `launch_dispatched` — the state
`execute({ sessionId, honorClose: true })` settles from, exactly the
pattern `describe('the honor-close door', ...)` (line 167) already uses:
`await launched(); const result = await close.execute({ sessionId: SID,
honorClose: true });`.

- [ ] **Step 1: Write the failing test**

Add `eventBus = null,` to `build`'s destructured options object (line
23-26) and `eventBus,` to the `new CloseSessionOutcome({...})` call (line
41-49, anywhere in the object — e.g. next to `clock: clock.now, rng:
seededRng(5), logger: silentLogger,`). Then add a new `describe` block
after `describe('the honor-close door', ...)` closes (after line 226,
before `describe('the result receipt', ...)` at line 228):

```js
describe('school.session.outcome-recorded publish', () => {
  it('publishes on a passing honor-close, with learnerId/sessionId/unitId/result/at', async () => {
    const published = [];
    build({ eventBus: { publish: (topic, payload) => published.push({ topic, payload }) } });
    await launched();
    await close.execute({ sessionId: SID, honorClose: true });
    expect(published).toHaveLength(1);
    expect(published[0].topic).toBe('school.session.outcome-recorded');
    expect(published[0].payload).toMatchObject({ sessionId: SID, unitId: WORKSHEET_UNIT, result: 'passed', learnerId: 'kid1' });
    expect(typeof published[0].payload.at).toBe('string');
  });

  it('does not throw when no eventBus is supplied (the default)', async () => {
    await launched();
    await expect(close.execute({ sessionId: SID, honorClose: true })).resolves.toMatchObject({ status: 'settled' });
  });
});
```

The second test needs no `build({...})` call of its own — `beforeEach(() =>
build())` (line 93) already ran with the default `eventBus: null` before
each `it`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/isolated/application/school/closeOutcome.test.mjs -t "outcome-recorded"`
Expected: FAIL — `CloseSessionOutcome` does not accept/use `eventBus` yet.

- [ ] **Step 3: Implement the constructor change**

In `backend/src/3_applications/school/usecases/CloseSessionOutcome.mjs`,
add `#eventBus;` to the private-fields declaration line (alongside
`#reviewQueue; #passOverrides; #worksheetInstances; #timezone;`), then in
the constructor parameter list add `eventBus = null,` (next to `reviewQueue
= null,`), and inside the constructor body add `this.#eventBus = eventBus;`
alongside the other simple assignments.

- [ ] **Step 4: Implement the publish inside `#settle`**

In `#settle` (the method starting `async #settle({ sessionId, state, unit,
outcome, signedOff, rewardOverride = null, nowIso, resettling })`), add as
its first statement, before `const passed = outcome.result === 'passed';`:

```js
    this.#eventBus?.publish?.('school.session.outcome-recorded', {
      learnerId: state.learnerId, sessionId, unitId: state.unitId, result: outcome.result, at: nowIso,
    });
```

Unconditional on pass/fail and on `resettling` — a fail settle changes no
section's `obligation`, and a resettle republishing an unchanged fact is
harmless, since the eventual `SchoolCompletionBridge` (Task 5) only acts on
an actual state transition.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/isolated/application/school/closeOutcome.test.mjs`
Expected: PASS, all tests including the two new ones and every pre-existing
test in the file (the new dep is optional and additive).

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/school/usecases/CloseSessionOutcome.mjs tests/isolated/application/school/closeOutcome.test.mjs
git commit -m "feat(school): CloseSessionOutcome publishes school.session.outcome-recorded"
```

---

### Task 4: `GetLearnerDayCompletion` — application use case

**Files:**
- Create: `backend/src/3_applications/school/GetLearnerDayCompletion.mjs`
- Test: `tests/isolated/application/school/getLearnerDayCompletion.test.mjs`

**Interfaces:**
- Consumes: `planLearnerWork` (`#domains/school/planner.mjs`),
  `planDailyAgenda` (`#domains/school/agenda.mjs`),
  `resolveDayCompletion` (`#domains/school/completion.mjs`, Task 2). Same
  constructor dependency shape `BuildAgenda` uses for its read side:
  `curriculum` (`ICurriculumCatalog`-shaped, via `CurriculumAccess`),
  `assignments` (`IAssignmentStore`), `sessions` (`IWorkSessionRepository`),
  `launchers` (`Map<string, IProgramLauncher>`), `timezone`, `clock`.
- Produces: `execute({ learnerId }) : Promise<{ learnerId: string,
  state: 'incomplete'|'complete'|'no_work_today', excused: Array<{subject:
  string|null, reason: string}> }>`. Read-only — never calls
  `sessions.appendEvent`, never mints a token.

- [ ] **Step 1: Read `BuildAgenda.mjs` once more for the exact read-path shape to mirror**

Re-read `backend/src/3_applications/school/usecases/BuildAgenda.mjs`,
specifically `execute()` (lines ~157-196, up to and including the
`planDailyAgenda` call) and `#collectProgramStatuses` (~443-459). This new
use case reuses that exact sequence — assignment/units/history reads,
`planLearnerWork`, `#collectProgramStatuses`-equivalent, `planDailyAgenda`
— minus every write-path concern (no `#offerFor`, no token minting, no
`agendaDocument`).

- [ ] **Step 2: Write the failing test**

Create `tests/isolated/application/school/getLearnerDayCompletion.test.mjs`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { GetLearnerDayCompletion } from '#apps/school/GetLearnerDayCompletion.mjs';
import { CurriculumAccess } from '#apps/school/CurriculumAccess.mjs';
import {
  FakeCatalog, FakeSessionRepository, FakeAssignmentStore, fakeClock, silentLogger,
} from '#testlib/school/lifecycleFakes.mjs';
import { rawUnits, BANK_IDS } from '#testlib/school/lifecycleFixtures.mjs';

let clock, catalog, curriculum, sessions, assignments, useCase;

const build = ({ assignment = { learnerId: 'kid1', courses: [] }, units, launchers = new Map() } = {}) => {
  clock = fakeClock();
  catalog = new FakeCatalog({ units: units ?? rawUnits() });
  curriculum = new CurriculumAccess({
    catalog, bankIds: () => BANK_IDS, programIds: () => [], clock: clock.epoch, logger: silentLogger,
  });
  sessions = new FakeSessionRepository();
  assignments = new FakeAssignmentStore(assignment ? [assignment] : []);
  useCase = new GetLearnerDayCompletion({
    curriculum, assignments, sessions, launchers, timezone: null, clock: clock.now, logger: silentLogger,
  });
};

beforeEach(() => build());

describe('GetLearnerDayCompletion', () => {
  it('no assignment at all -> no_work_today', async () => {
    const result = await useCase.execute({ learnerId: 'kid1' });
    expect(result).toMatchObject({ learnerId: 'kid1', state: 'no_work_today' });
  });

  it('an assigned, untouched required unit -> incomplete', async () => {
    build({ assignment: { learnerId: 'kid1', courses: ['math-fractions'] } });
    const result = await useCase.execute({ learnerId: 'kid1' });
    expect(result.state).toBe('incomplete');
  });

  it('does not create a session or mutate anything (read-only)', async () => {
    build({ assignment: { learnerId: 'kid1', courses: ['math-fractions'] } });
    await useCase.execute({ learnerId: 'kid1' });
    expect(sessions.ids()).toHaveLength(0);
  });

  it('matches the obligation-derived state BuildAgenda would compute for the same inputs — no drift between print and read paths', async () => {
    build({ assignment: { learnerId: 'kid1', courses: ['math-fractions'] } });
    const completion = await useCase.execute({ learnerId: 'kid1' });

    // Independently derive the same answer via the exact BuildAgenda path
    // (planLearnerWork -> planDailyAgenda -> resolveDayCompletion), reusing
    // this test's own catalog/assignments/sessions fakes, to prove the two
    // use cases cannot silently diverge.
    const { planLearnerWork } = await import('#domains/school/planner.mjs');
    const { planDailyAgenda } = await import('#domains/school/agenda.mjs');
    const { resolveDayCompletion } = await import('#domains/school/completion.mjs');
    const nowIso = clock.now().toISOString();
    const assignment = await assignments.get('kid1');
    const units = await curriculum.listUnits();
    const history = await sessions.listForLearner('kid1');
    const plan = planLearnerWork({ learnerId: 'kid1', assignment, units, sessions: history, now: nowIso, timezone: null });
    const { sections } = planDailyAgenda({ plan, sessions: history, programStatuses: {}, now: nowIso, timezone: null });
    const expected = resolveDayCompletion({ sections, planErrors: plan.errors });

    expect(completion.state).toBe(expected.state);
    expect(completion.excused).toEqual(expected.excused);
  });
});
```

Verified fixture shape against `tests/_lib/school/lifecycleFixtures.mjs`
(read in full): `rawUnits()` seeds `math-fractions.01`-`.04` under
`COURSE_ID = 'math-fractions'`, and `BANK_IDS` is exported directly —
matches the sketch above exactly, and matches `buildAgenda.test.mjs`'s own
`build()` usage of `{ learnerId: 'kid1', courses: ['math-fractions'] }`
against the same fixture.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/isolated/application/school/getLearnerDayCompletion.test.mjs`
Expected: FAIL — the module does not exist.

- [ ] **Step 4: Implement `GetLearnerDayCompletion.mjs`**

Create `backend/src/3_applications/school/GetLearnerDayCompletion.mjs`:

```js
/**
 * GetLearnerDayCompletion — the read-only twin of `BuildAgenda`'s planning
 * path (design: 2026-08-23-student-completion-state-machine). Reuses the
 * exact same assignment/units/session/program-status reads and the exact
 * same `planLearnerWork` -> `planDailyAgenda` sequence, but stops there:
 * no session is created, no token is minted, no document is built. A status
 * read must never carry `BuildAgenda`'s paper-issuing side effects, because
 * it is read far more often than paper is printed.
 */
import { planLearnerWork } from '#domains/school/planner.mjs';
import { planDailyAgenda } from '#domains/school/agenda.mjs';
import { resolveDayCompletion } from '#domains/school/completion.mjs';

export class GetLearnerDayCompletion {
  #curriculum; #assignments; #sessions; #launchers; #timezone; #clock; #logger;

  constructor({
    curriculum, assignments, sessions, launchers = new Map(),
    timezone = null, clock = () => new Date(), logger = console,
  } = {}) {
    if (!curriculum || !assignments || !sessions) {
      throw new Error('GetLearnerDayCompletion requires curriculum, assignments and sessions');
    }
    this.#curriculum = curriculum;
    this.#assignments = assignments;
    this.#sessions = sessions;
    this.#launchers = launchers;
    this.#timezone = timezone;
    this.#clock = clock;
    this.#logger = logger;
  }

  /**
   * @param {object} args
   * @param {string} args.learnerId
   * @returns {Promise<{ learnerId: string, state: 'incomplete'|'complete'|'no_work_today',
   *                      excused: Array<{subject: string|null, reason: string}> }>}
   */
  async execute({ learnerId } = {}) {
    if (typeof learnerId !== 'string' || !learnerId.trim()) {
      throw new Error('GetLearnerDayCompletion requires learnerId');
    }
    const nowIso = this.#clock().toISOString();
    const [assignment, units, works, history] = await Promise.all([
      this.#assignments.get(learnerId),
      this.#curriculum.listUnits(),
      this.#curriculum.listWorks?.() ?? [],
      this.#sessions.listForLearner(learnerId),
    ]);
    const coursePolicies = Object.fromEntries((works ?? []).map((work) => [work.work, work.progression]).filter(([, p]) => p));
    const plan = planLearnerWork({ learnerId, assignment, units, sessions: history, now: nowIso, timezone: this.#timezone, coursePolicies });
    const programStatuses = await this.#collectProgramStatuses(plan, learnerId);
    const { sections } = planDailyAgenda({ plan, sessions: history, programStatuses, now: nowIso, timezone: this.#timezone });
    const { state, excused } = resolveDayCompletion({ sections, planErrors: plan.errors });
    return { learnerId, state, excused };
  }

  /** Mirrors `BuildAgenda#collectProgramStatuses` exactly: one read-only
   * `status()` per distinct program id, degrading to `{ error: true }` on
   * any failure so a broken launcher never blanks the whole read. */
  async #collectProgramStatuses(plan, learnerId) {
    const programIds = [...new Set((plan.entries ?? []).filter((e) => e.program).map((e) => e.program))];
    const statuses = {};
    await Promise.all(programIds.map(async (programId) => {
      try {
        const launcher = this.#launchers.get(programId);
        if (!launcher) throw new Error(`no launcher registered for program "${programId}"`);
        statuses[programId] = await launcher.status({ userId: learnerId });
      } catch (err) {
        this.#logger.warn?.('school.completion.launcher-failed', {
          learnerId, program: programId, error: err?.message ?? String(err),
        });
        statuses[programId] = { error: true };
      }
    }));
    return statuses;
  }
}

export default GetLearnerDayCompletion;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/isolated/application/school/getLearnerDayCompletion.test.mjs`
Expected: PASS, all 4 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/school/GetLearnerDayCompletion.mjs tests/isolated/application/school/getLearnerDayCompletion.test.mjs
git commit -m "feat(school): add GetLearnerDayCompletion, the read-only completion use case"
```

---

### Task 5: `SchoolCompletionBridge` — push on transition

**Files:**
- Create: `backend/src/3_applications/school/SchoolCompletionBridge.mjs`
- Test: `tests/isolated/application/school/schoolCompletionBridge.test.mjs`

**Interfaces:**
- Consumes: `eventBus` (`{subscribe, publish}`), `getLearnerDayCompletion`
  (Task 4's use case instance, called as `.execute({ learnerId })`), `clock`,
  `logger`. Subscribes to `school.session.outcome-recorded` (Task 3).
- Produces: `start()`, `stop()` lifecycle (same as `DoNowSchoolBridge`).
  Publishes `school.completion.changed` with payload `{ learnerId, state,
  previousState, at }` — only when `state !== previousState` for that
  learner since the bridge started (in-memory `Map<learnerId, state>`, reset
  on process restart — acceptable, since completion is purely derived and a
  fresh read after restart establishes the current state correctly; the
  first observed state for a learner after startup never counts as a
  transition, since there is no prior state to compare against).

- [ ] **Step 1: Write the failing tests**

Create `tests/isolated/application/school/schoolCompletionBridge.test.mjs`,
modeled directly on `tests/isolated/application/school/doNowSchoolBridge.test.mjs`
(reuse its `FakeEventBus` class verbatim — copy it in, this file has no
existing shared fake for it):

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { SchoolCompletionBridge } from '#apps/school/SchoolCompletionBridge.mjs';
import { fakeClock, silentLogger } from '#testlib/school/lifecycleFakes.mjs';

class FakeEventBus {
  constructor() { this.handlers = new Map(); }
  subscribe(topic, handler) {
    const list = this.handlers.get(topic) ?? [];
    list.push(handler);
    this.handlers.set(topic, list);
    return () => {
      const idx = list.indexOf(handler);
      if (idx >= 0) list.splice(idx, 1);
    };
  }
  async emit(topic, payload) {
    await Promise.all((this.handlers.get(topic) ?? []).map((h) => h(payload)));
  }
  subscriberCount(topic) { return (this.handlers.get(topic) ?? []).length; }
  publish(topic, payload) {
    this.published = this.published ?? [];
    this.published.push({ topic, payload });
  }
}

let clock, eventBus, getCompletion, bridge, nextState;

const build = () => {
  clock = fakeClock();
  eventBus = new FakeEventBus();
  nextState = 'incomplete';
  getCompletion = { execute: async ({ learnerId }) => ({ learnerId, state: nextState, excused: [] }) };
  bridge = new SchoolCompletionBridge({ eventBus, getLearnerDayCompletion: getCompletion, clock: clock.now, logger: silentLogger });
};

beforeEach(() => build());

describe('construction', () => {
  it('requires eventBus and getLearnerDayCompletion', () => {
    expect(() => new SchoolCompletionBridge({})).toThrow();
    expect(() => new SchoolCompletionBridge({ eventBus })).toThrow();
  });
});

describe('start/stop', () => {
  it('start() subscribes to school.session.outcome-recorded', () => {
    bridge.start();
    expect(eventBus.subscriberCount('school.session.outcome-recorded')).toBe(1);
  });
  it('start() twice does not double-subscribe', () => {
    bridge.start(); bridge.start();
    expect(eventBus.subscriberCount('school.session.outcome-recorded')).toBe(1);
  });
  it('stop() unsubscribes and is safe to call again', () => {
    bridge.start(); bridge.stop();
    expect(eventBus.subscriberCount('school.session.outcome-recorded')).toBe(0);
    expect(() => bridge.stop()).not.toThrow();
  });
});

describe('transition-only publish', () => {
  it('the FIRST observed state for a learner is never published (no prior state to compare)', async () => {
    bridge.start();
    await eventBus.emit('school.session.outcome-recorded', { learnerId: 'kid1', sessionId: 's1', unitId: 'u1', result: 'passed', at: clock.iso() });
    expect(eventBus.published ?? []).toHaveLength(0);
  });

  it('publishes school.completion.changed on an actual transition', async () => {
    bridge.start();
    await eventBus.emit('school.session.outcome-recorded', { learnerId: 'kid1', sessionId: 's1', unitId: 'u1', result: 'passed', at: clock.iso() });
    nextState = 'complete';
    await eventBus.emit('school.session.outcome-recorded', { learnerId: 'kid1', sessionId: 's2', unitId: 'u2', result: 'passed', at: clock.iso() });
    expect(eventBus.published).toHaveLength(1);
    expect(eventBus.published[0]).toMatchObject({
      topic: 'school.completion.changed',
      payload: { learnerId: 'kid1', state: 'complete', previousState: 'incomplete' },
    });
  });

  it('does NOT publish when the recomputed state is unchanged', async () => {
    bridge.start();
    await eventBus.emit('school.session.outcome-recorded', { learnerId: 'kid1', sessionId: 's1', unitId: 'u1', result: 'passed', at: clock.iso() });
    await eventBus.emit('school.session.outcome-recorded', { learnerId: 'kid1', sessionId: 's2', unitId: 'u2', result: 'failed', at: clock.iso() });
    expect(eventBus.published ?? []).toHaveLength(0);
  });

  it('a getLearnerDayCompletion failure is swallowed, never thrown out of the handler', async () => {
    getCompletion.execute = async () => { throw new Error('store unavailable'); };
    bridge.start();
    await expect(eventBus.emit('school.session.outcome-recorded', { learnerId: 'kid1', sessionId: 's1', unitId: 'u1', result: 'passed', at: clock.iso() })).resolves.not.toThrow();
    expect(eventBus.published ?? []).toHaveLength(0);
  });

  it('ignores a malformed payload with no learnerId', async () => {
    bridge.start();
    await eventBus.emit('school.session.outcome-recorded', { sessionId: 's1' });
    expect(eventBus.published ?? []).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/isolated/application/school/schoolCompletionBridge.test.mjs`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement `SchoolCompletionBridge.mjs`**

Create `backend/src/3_applications/school/SchoolCompletionBridge.mjs`:

```js
/**
 * SchoolCompletionBridge (design: 2026-08-23-student-completion-state-machine,
 * §5) — subscribes to every settled session (`school.session.outcome-recorded`,
 * published by `CloseSessionOutcome#settle`, which covers curriculum AND
 * language days since `CloseLanguageDay` routes through the same `#settle`),
 * recomputes the learner's day completion, and publishes
 * `school.completion.changed` ONLY on an actual state transition — never on
 * every recompute, so a rapid sequence of passes or a flapping launcher does
 * not spam the bus.
 *
 * Completion truth never depends on this bridge having fired: any consumer
 * can call `GetLearnerDayCompletion` directly at any time and get the same
 * answer. This bridge is a push convenience for subscribers that would
 * otherwise have to poll, never the source of truth — so a getLearnerDayCompletion
 * failure here is swallowed and logged, exactly like `DoNowSchoolBridge`'s
 * own handler-threw guard.
 *
 * In-memory last-seen-state per learner, reset on process restart: the
 * first state observed for a learner after startup is never treated as a
 * transition (there is no prior state to compare against) — acceptable,
 * since completion is purely derived and any consumer's own direct read
 * after restart already reflects the current state correctly.
 */
export class SchoolCompletionBridge {
  #eventBus; #getCompletion; #clock; #logger; #unsubscribe; #lastState;

  constructor({
    eventBus, getLearnerDayCompletion, clock = () => new Date(), logger = console,
  } = {}) {
    if (!eventBus || typeof eventBus.subscribe !== 'function' || !getLearnerDayCompletion) {
      throw new Error('SchoolCompletionBridge requires eventBus and getLearnerDayCompletion');
    }
    this.#eventBus = eventBus;
    this.#getCompletion = getLearnerDayCompletion;
    this.#clock = clock;
    this.#logger = logger;
    this.#unsubscribe = null;
    this.#lastState = new Map();
  }

  /** Subscribe to `school.session.outcome-recorded`. Safe to call more than once. */
  start() {
    if (this.#unsubscribe) return;
    this.#unsubscribe = this.#eventBus.subscribe('school.session.outcome-recorded', (payload) => (
      this.#handle(payload).catch((err) => {
        this.#logger.warn?.('school.completion-bridge.handler-threw', { error: err?.message ?? String(err) });
      })
    ));
  }

  /** Unsubscribe. Safe to call more than once, and safe to call before `start()`. */
  stop() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  async #handle(payload) {
    const learnerId = payload?.learnerId;
    if (typeof learnerId !== 'string' || !learnerId.trim()) return;
    const { state } = await this.#getCompletion.execute({ learnerId });
    const previousState = this.#lastState.get(learnerId);
    this.#lastState.set(learnerId, state);
    if (previousState === undefined || previousState === state) return;
    this.#eventBus.publish('school.completion.changed', {
      learnerId, state, previousState, at: this.#clock().toISOString(),
    });
  }
}

export default SchoolCompletionBridge;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/isolated/application/school/schoolCompletionBridge.test.mjs`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/school/SchoolCompletionBridge.mjs tests/isolated/application/school/schoolCompletionBridge.test.mjs
git commit -m "feat(school): add SchoolCompletionBridge — publishes school.completion.changed on transition"
```

---

### Task 6: Composition wiring

**Files:**
- Modify: `backend/src/5_composition/modules/schoolLifecycle.mjs`
- Modify: `backend/src/app.mjs` (shutdown, mirroring `donowSchoolBridge.stop()`)

**Interfaces:**
- Consumes: `GetLearnerDayCompletion` (Task 4), `SchoolCompletionBridge`
  (Task 5), the existing `eventBus`, `curriculum`, `stores.assignments`,
  `stores.sessions`, `launchers`, `timezone`, `clock`, `logger` already
  constructed in `schoolLifecycle.mjs`.
- Produces: `schoolLifecycle.mjs`'s returned object gains
  `getLearnerDayCompletion` (usable by a future API route — none added by
  this plan, per the design's scope) and `schoolCompletionBridge` (so
  `app.mjs` can `.stop()` it on shutdown, matching `donowSchoolBridge`).

- [ ] **Step 1: Wire `CloseSessionOutcome`'s new `eventBus` dependency**

In `backend/src/5_composition/modules/schoolLifecycle.mjs`, in the existing
`const closeSessionOutcome = new CloseSessionOutcome({ ... })` call
(currently ~line 648-671), add `eventBus,` to the argument object (any
position — matching the file's existing style of grouping related args,
e.g. next to `clock, rng: draw, logger,` at the end).

- [ ] **Step 2: Construct `GetLearnerDayCompletion`**

Immediately after the existing `const resolveSubjectNext = new
ResolveSubjectNext({...})` block (~line 524-528), add:

```js
  const getLearnerDayCompletion = new GetLearnerDayCompletion({
    curriculum, assignments: stores.assignments, sessions: stores.sessions,
    launchers, timezone, clock, logger,
  });
```

- [ ] **Step 3: Construct and start `SchoolCompletionBridge`**

Immediately after the existing `donowSchoolBridge` block (~line 738-746),
following the exact same eventBus-presence guard:

```js
  let schoolCompletionBridge = null;
  if (eventBus && typeof eventBus.subscribe === 'function') {
    schoolCompletionBridge = new SchoolCompletionBridge({
      eventBus, getLearnerDayCompletion, clock, logger,
    });
    schoolCompletionBridge.start();
  } else {
    logger.warn?.('school.lifecycle.completion-bridge-unwired', { reason: 'no eventBus' });
  }
```

- [ ] **Step 4: Add the two new imports**

Near the top of `schoolLifecycle.mjs`, alongside the existing `import {
DoNowSchoolBridge } from '#apps/school/DoNowSchoolBridge.mjs';` and `import
{ CloseLanguageDay } from '#apps/school/CloseLanguageDay.mjs';` (lines
58-59), add:

```js
import { GetLearnerDayCompletion } from '#apps/school/GetLearnerDayCompletion.mjs';
import { SchoolCompletionBridge } from '#apps/school/SchoolCompletionBridge.mjs';
```

- [ ] **Step 5: Add both to the module's returned object**

Find the object `schoolLifecycle.mjs` returns (contains `buildAgenda,
receipts,` per the earlier grep at ~line 685, and `closeLanguageDay,` at
~line 973). Add `getLearnerDayCompletion, schoolCompletionBridge,` to that
same returned object, near `closeLanguageDay` and `donowSchoolBridge`.

- [ ] **Step 6: Wire shutdown in `app.mjs`**

In `backend/src/app.mjs`, find the existing shutdown block at ~line 5103
(`if (schoolLifecycle.donowSchoolBridge) { ... schoolLifecycle.donowSchoolBridge.stop(); ... }`).
Read the surrounding ~10 lines to see its exact try/catch and logging shape,
then add an equivalent block immediately after it for
`schoolLifecycle.schoolCompletionBridge`, following the same structure
(same log-on-error style, same placement relative to other shutdown steps).

- [ ] **Step 7: Run the full School test suite to confirm nothing broke**

Run: `npx vitest run tests/isolated/domain/school/ tests/isolated/application/school/`
Expected: PASS, every file — this task adds no new test file (wiring-only,
matching the codebase's own convention of not unit-testing composition
wiring directly; correctness here is "the app still boots and every
existing behavior-level test still passes").

- [ ] **Step 8: Start the dev server and confirm it boots clean**

Run (per `CLAUDE.md`'s documented dev workflow): check
`ss -tlnp | grep 3112` first; if nothing is listening, run `node
backend/index.js` and check the log for `school.lifecycle.completion-bridge-unwired`
(should NOT appear, since `eventBus` is wired in the real composition root)
and for any uncaught construction error naming `GetLearnerDayCompletion` or
`SchoolCompletionBridge`.

- [ ] **Step 9: Commit**

```bash
git add backend/src/5_composition/modules/schoolLifecycle.mjs backend/src/app.mjs
git commit -m "feat(school): wire GetLearnerDayCompletion and SchoolCompletionBridge into composition"
```

---

## Final verification

- [ ] Run the full isolated suite once more:
  `npx vitest run tests/isolated/domain/school/ tests/isolated/application/school/`
  Expected: PASS, zero failures, zero skips.
- [ ] Grep the diff for any leftover `TODO`/`FIXME`/placeholder text:
  `git diff main --stat` then spot-check each changed file.
- [ ] Confirm the design doc's own deferrals (§8: course-internal windowed
  throttling, `missed_target`/`dueOn` rendering) were NOT accidentally
  attempted — this plan implements exactly the six tasks above and nothing
  else.
