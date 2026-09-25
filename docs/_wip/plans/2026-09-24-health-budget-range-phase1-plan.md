# Health Budget Range — Phase 1 (Budget Contract) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The budget endpoints return a goal *range*, a date-solved daily deficit, a zone, completeness and a zone-based `remaining`, from one shared function. The existing surfaces stay truthful after the deploy.

**Architecture:**
- `BudgetMath` gains a pure deficit solver.
- A new pure `shared/contracts/health/budgetZone.mjs` decides zone, remaining, completeness and headline copy. The backend (`BudgetService`) and the frontend (drag preview, bar headline, strip labels) both use it.
- `BudgetService` adds the new fields and keeps `budget`/`status` as compatibility aliases.
- A one-off CLI reports (and, if asked, fills) the per-user floor from the legacy settings.

**Tech Stack:** Node ESM (`.mjs`), Express, React (`.jsx`), vitest. YAML stores via `DataService`.

**Spec:** `docs/_wip/plans/2026-09-24-health-budget-range-design.md` (revision 2), section "Phase 1 — Budget contract". Read it first.

## Global Constraints

- 3,500 kcal per lb; weekly rate → daily kcal is `× 3500 ÷ 7` (= 500 per lb/week).
- `budgetFloor` default 1200; `maxWeeklyRateLbs` default 2; `weeklyRateLbs` default 1 and must be > 0.
- Floor compares **food eaten**. Top and break-even compare **net** (`food − exercise`, may be negative).
- Zone order: `past-even` → `over` → `in-range` → `declared` → `incomplete`.
- Completeness = `food ≥ floor` OR day declared `done`/`fasting`. Never time of day.
- Goals apply as **current** to every day (`goalBasis: 'current'`).
- Do not touch the exercise-reaction `min_calories` at `backend/src/app.mjs:3751`.
- New structured log events use the existing logger (no `console.*`).
- Tests: `npx vitest run <paths>` from the repo root.
- Commit with a **pathspec** (`git commit -m "…" -- <paths>`); never a bare `git commit`.

## Review Focus

1. **The target date is today (0 days left):** must not divide by zero. The weekly-rate fallback applies (`day < targetDate` is false). Pinned in Task 1.
2. **A computed top below the floor** (a steep deficit on a light body): `range.top` is clamped to the floor, so the band never inverts. Pinned in Task 1.
3. **The closure lookup fails** (a missing or corrupt closures file): the budget still returns, with `declared: null`, logged as a warning. It must never 500 the day view. Pinned in Task 4.
4. **A portion drag crosses the floor or the top** mid-gesture: the preview's zone and `remaining` must change exactly as the server's would. Pinned in Task 5.
5. **Negative net with food ≥ floor** (big workout): zone `in-range`, `remaining` > `range.top`, and never negative. Pinned in Task 2.

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/src/2_domains/health/services/BudgetMath.mjs` (modify) | Energy equation; **new** `solveDailyDeficit`, `daysBetween`; `computeDailyEnergy` accepts a `deficit` |
| `shared/contracts/health/budgetZone.mjs` (create) | `zoneFor`, `statusForZone`, `headlineFor`: the one zone rule, shared |
| `backend/src/3_applications/health/BudgetService.mjs` (modify) | Validation of new goal keys; assembles range/zone/declared per day |
| `backend/src/3_applications/health/HealthOperations.mjs` (modify) | `readDayStatus.minCalories` = the per-user floor |
| `backend/src/5_composition/modules/healthApi.mjs` (modify) | Wires the goals store into `HealthOperations` |
| `frontend/src/modules/Health/today/portionPreview.js` (modify) | Drag preview uses `zoneFor` |
| `frontend/src/modules/Health/today/EquationStrip.jsx` (modify) | Headline copy from `headlineFor` (bar geometry unchanged until Phase 2) |
| `frontend/src/modules/Health/today/dayBars.js` (modify) | Strip cell label from `headlineFor` |
| `backend/src/3_applications/health/budgetSettingsMigration.mjs` (create) | Pure planner: legacy floor/target settings → changes + conflicts |
| `cli/health-budget-settings-migrate.cli.mjs` (create) | Report / apply wrapper around the planner |
| `docs/reference/health/README.md` (modify) | Budget equation section rewritten for Phase 1 |

---

### Task 1: Deficit solver in BudgetMath

**Files:**
- Modify: `backend/src/2_domains/health/services/BudgetMath.mjs`
- Test: `backend/src/2_domains/health/services/BudgetMath.test.mjs`

**Interfaces:**
- Produces:
  - `daysBetween(fromISO: string, toISO: string): number` (whole days, `to − from`)
  - `solveDailyDeficit({ weightLbs, targetWeightLbs?, targetDate?, day, weeklyRateLbs?, maxWeeklyRateLbs? }): { deficit: number, deficitSource: 'at-target'|'target-date'|'weekly-rate' }`
  - `computeDailyEnergy({ …existing, deficit? })`: when `deficit` is a finite number it replaces the weekly-rate deficit. Still returns `{ maintenance, budget }`, where `budget = max(round(tdee − deficit), round(floor))`.

- [ ] **Step 1: Write the failing tests** (append to `BudgetMath.test.mjs`)

```js
import { daysBetween, solveDailyDeficit } from './BudgetMath.mjs';

describe('daysBetween', () => {
  it('counts whole calendar days across a DST change', () => {
    expect(daysBetween('2026-03-01', '2026-03-15')).toBe(14);
    expect(daysBetween('2026-11-01', '2026-11-02')).toBe(1);
    expect(daysBetween('2026-09-24', '2026-09-24')).toBe(0);
  });
});

describe('solveDailyDeficit', () => {
  const base = { weightLbs: 200, targetWeightLbs: 180, day: '2026-09-24', weeklyRateLbs: 1, maxWeeklyRateLbs: 2 };

  it('solves pounds-to-go over days-to-go', () => {
    // 20 lb × 3500 / 100 days = 700
    expect(solveDailyDeficit({ ...base, targetDate: '2027-01-02' })).toEqual({ deficit: 700, deficitSource: 'target-date' });
  });

  it('caps the solved deficit at maxWeeklyRateLbs', () => {
    // 20 lb in 10 days = 7000/day → cap 2 lb/wk = 1000
    expect(solveDailyDeficit({ ...base, targetDate: '2026-10-04' })).toEqual({ deficit: 1000, deficitSource: 'target-date' });
  });

  it('is zero at or under the target weight', () => {
    expect(solveDailyDeficit({ ...base, weightLbs: 180, targetDate: '2027-01-02' })).toEqual({ deficit: 0, deficitSource: 'at-target' });
    expect(solveDailyDeficit({ ...base, weightLbs: 175 })).toEqual({ deficit: 0, deficitSource: 'at-target' });
  });

  it('falls back to the weekly rate with no date, a passed date, or the date itself (never divides by zero)', () => {
    for (const targetDate of [null, '2026-09-01', '2026-09-24']) {
      expect(solveDailyDeficit({ ...base, targetDate })).toEqual({ deficit: 500, deficitSource: 'weekly-rate' });
    }
  });

  it('falls back to the weekly rate with no target weight', () => {
    expect(solveDailyDeficit({ ...base, targetWeightLbs: null, targetDate: '2027-01-02' })).toEqual({ deficit: 500, deficitSource: 'weekly-rate' });
  });
});

describe('computeDailyEnergy with a solved deficit', () => {
  it('uses the given deficit instead of the weekly rate', () => {
    const e = computeDailyEnergy({ ...base, deficit: 700 });
    expect(e.budget).toBe(e.maintenance - 700);
  });

  it('never returns a top below the floor', () => {
    const e = computeDailyEnergy({ ...base, deficit: 5000 });
    expect(e.budget).toBe(1200);
  });
});
```

(`base` in the last `describe` is the file's existing top-level `base`. The `solveDailyDeficit` block declares its own.)

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run backend/src/2_domains/health/services/BudgetMath.test.mjs`
Expected: FAIL (`daysBetween is not a function`, `solveDailyDeficit is not a function`).

- [ ] **Step 3: Implement** in `BudgetMath.mjs`

Add below `finite`:

```js
const DAY_MS = 86400000;
const dayNumber = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / DAY_MS;

/** Whole calendar days from `fromISO` to `toISO` (YYYY-MM-DD); DST-proof. */
export function daysBetween(fromISO, toISO) {
  return Math.round(dayNumber(toISO) - dayNumber(fromISO));
}

/**
 * The day's planned deficit. Solved from "lose to targetWeightLbs by targetDate"
 * when that plan is live for `day`, capped at maxWeeklyRateLbs; zero once the
 * target weight is reached; otherwise the fixed weekly rate.
 */
export function solveDailyDeficit({
  weightLbs, targetWeightLbs = null, targetDate = null, day,
  weeklyRateLbs = 1, maxWeeklyRateLbs = 2,
}) {
  finite(weightLbs, 'weightLbs');
  finite(weeklyRateLbs, 'weeklyRateLbs');
  finite(maxWeeklyRateLbs, 'maxWeeklyRateLbs');
  const hasTarget = typeof targetWeightLbs === 'number' && Number.isFinite(targetWeightLbs);
  if (hasTarget && weightLbs <= targetWeightLbs) return { deficit: 0, deficitSource: 'at-target' };
  if (hasTarget && targetDate && day && day < targetDate) {
    const solved = ((weightLbs - targetWeightLbs) * KCAL_PER_LB) / daysBetween(day, targetDate);
    const cap = (maxWeeklyRateLbs * KCAL_PER_LB) / 7;
    return { deficit: Math.round(Math.min(solved, cap)), deficitSource: 'target-date' };
  }
  return { deficit: Math.round((weeklyRateLbs * KCAL_PER_LB) / 7), deficitSource: 'weekly-rate' };
}
```

In `computeDailyEnergy`, add `deficit = null` to the destructured parameters and replace the `budget` line:

```js
  const daily = deficit == null ? (weeklyRateLbs * KCAL_PER_LB) / 7 : finite(deficit, 'deficit');
  const budget = Math.round(tdee - daily);
```

Update the file's header comment: "…minus the day's planned deficit (solved from a target date, or the weekly rate), floored."

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run backend/src/2_domains/health/services/BudgetMath.test.mjs`
Expected: PASS (all old and new).

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/health/services/BudgetMath.mjs backend/src/2_domains/health/services/BudgetMath.test.mjs
git commit -m "feat(health): solve the daily deficit from a target date" -- backend/src/2_domains/health/services/BudgetMath.mjs backend/src/2_domains/health/services/BudgetMath.test.mjs
```

---

### Task 2: The shared zone rule

**Files:**
- Create: `shared/contracts/health/budgetZone.mjs`
- Test: `shared/contracts/health/budgetZone.test.mjs`

**Interfaces:**
- Produces:
  - `zoneFor({ food, exercise?, maintenance, range: { floor, top }, declared? }): { zone: 'incomplete'|'declared'|'in-range'|'over'|'past-even', remaining: number, complete: boolean, net: number }`
  - `statusForZone(zone): 'over'|'under'` (the compatibility alias)
  - `headlineFor({ zone, remaining, declared }): { value: number|null, text: string }`, where `text` is the words after the number ("to floor", "left", "over", "past break even") or the whole phrase for `declared` ("Fasted", "Logging done").

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from 'vitest';
import { zoneFor, statusForZone, headlineFor } from './budgetZone.mjs';

const range = { floor: 1200, top: 1791 };
const z = (food, exercise = 0, declared = null) => zoneFor({ food, exercise, maintenance: 2291, range, declared });

describe('zoneFor', () => {
  it('incomplete: under the floor, undeclared; remaining is food still to log', () => {
    expect(z(700)).toEqual({ zone: 'incomplete', remaining: 500, complete: false, net: 700 });
  });

  it('floor compares FOOD, not net: a big workout does not make a full log incomplete', () => {
    expect(z(1300, 400)).toMatchObject({ zone: 'in-range', complete: true, net: 900, remaining: 891 });
  });

  it('declared: under the floor but closed as done or fasted', () => {
    expect(z(600, 0, 'fasting')).toMatchObject({ zone: 'declared', complete: true, remaining: 1191 });
    expect(z(600, 0, 'done')).toMatchObject({ zone: 'declared', complete: true });
  });

  it('in-range boundary: food exactly at the floor, net exactly at the top', () => {
    expect(z(1200)).toMatchObject({ zone: 'in-range', remaining: 591 });
    expect(z(1791)).toMatchObject({ zone: 'in-range', remaining: 0 });
  });

  it('over: net past the top, remaining is the overrun', () => {
    expect(z(1900)).toMatchObject({ zone: 'over', remaining: 109, complete: true });
  });

  it('past-even: net past break-even', () => {
    expect(z(2400)).toMatchObject({ zone: 'past-even', remaining: 109 });
  });

  it('over wins on an under-logged day only when net truly exceeds the top (impossible below the floor unless top < floor)', () => {
    const tiny = zoneFor({ food: 1000, exercise: 0, maintenance: 900, range: { floor: 1200, top: 1200 } });
    expect(tiny).toMatchObject({ zone: 'past-even', complete: false });
  });

  it('negative net with food ≥ floor: in range, remaining exceeds the top, never negative', () => {
    const r = z(1300, 1600);
    expect(r).toMatchObject({ zone: 'in-range', net: -300, remaining: 2091 });
    expect(r.remaining).toBeGreaterThan(range.top);
  });

  it('rounds remaining (the drag preview passes fractional food)', () => {
    expect(z(1500.4).remaining).toBe(291);
  });
});

describe('statusForZone', () => {
  it('maps over and past-even to over, everything else to under', () => {
    expect(['incomplete', 'declared', 'in-range', 'over', 'past-even'].map(statusForZone))
      .toEqual(['under', 'under', 'under', 'over', 'over']);
  });
});

describe('headlineFor', () => {
  it('names the segment the number measures', () => {
    expect(headlineFor({ zone: 'incomplete', remaining: 500 })).toEqual({ value: 500, text: 'to floor' });
    expect(headlineFor({ zone: 'in-range', remaining: 648 })).toEqual({ value: 648, text: 'left' });
    expect(headlineFor({ zone: 'over', remaining: 109 })).toEqual({ value: 109, text: 'over' });
    expect(headlineFor({ zone: 'past-even', remaining: 109 })).toEqual({ value: 109, text: 'past break even' });
    expect(headlineFor({ zone: 'declared', remaining: 1191, declared: 'fasting' })).toEqual({ value: null, text: 'Fasted' });
    expect(headlineFor({ zone: 'declared', remaining: 1191, declared: 'done' })).toEqual({ value: null, text: 'Logging done' });
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run shared/contracts/health/budgetZone.test.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `shared/contracts/health/budgetZone.mjs`

```js
// The one rule for where a day stands against its goal range. Shared by the
// server (BudgetService) and the client (drag preview, bar headline, strip
// labels) so a live gesture recolours exactly as the server would.
//
//   floor  — a LOGGING-COMPLETENESS check, compared against FOOD eaten.
//   top    — the plan (break-even − daily deficit), compared against NET.
//   even   — break-even (maintenance), compared against NET.
// A day is complete when food ≥ floor or it was declared done/fasted; never
// because of the time of day.

export const ZONES = Object.freeze(['incomplete', 'declared', 'in-range', 'over', 'past-even']);

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function zoneFor({ food, exercise = 0, maintenance, range, declared = null }) {
  const eaten = num(food);
  const net = eaten - Math.max(0, num(exercise));
  const floor = num(range?.floor);
  const top = num(range?.top);
  const even = num(maintenance);
  const isDeclared = declared === 'done' || declared === 'fasting';
  const complete = eaten >= floor || isDeclared;
  const out = (zone, remaining) => ({ zone, remaining: Math.round(remaining), complete, net: Math.round(net) });
  if (even > 0 && net > even) return out('past-even', net - even);
  if (net > top) return out('over', net - top);
  if (eaten >= floor) return out('in-range', top - net);
  if (isDeclared) return out('declared', top - net);
  return out('incomplete', floor - eaten);
}

export const statusForZone = (zone) => (zone === 'over' || zone === 'past-even' ? 'over' : 'under');

const HEADLINE = { incomplete: 'to floor', 'in-range': 'left', over: 'over', 'past-even': 'past break even' };

export function headlineFor({ zone, remaining, declared = null }) {
  if (zone === 'declared') return { value: null, text: declared === 'fasting' ? 'Fasted' : 'Logging done' };
  return { value: Math.round(num(remaining)), text: HEADLINE[zone] || 'left' };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run shared/contracts/health/budgetZone.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/contracts/health/budgetZone.mjs shared/contracts/health/budgetZone.test.mjs
git commit -m "feat(health): shared budget zone rule (floor=food, top/even=net)" -- shared/contracts/health/budgetZone.mjs shared/contracts/health/budgetZone.test.mjs
```

---

### Task 3: Validate the new goal keys

**Files:**
- Modify: `backend/src/3_applications/health/BudgetService.mjs` (`assertGoalsShape`, ~lines 47-62)
- Test: `backend/src/3_applications/health/BudgetService.test.mjs`

**Interfaces:**
- Consumes: none.
- Produces: `setGoals` accepts `targetDate` (a `YYYY-MM-DD` string) and `maxWeeklyRateLbs` (> 0). It rejects `weeklyRateLbs ≤ 0`.

- [ ] **Step 1: Write the failing tests** (new `describe` in `BudgetService.test.mjs`)

```js
describe('BudgetService.setGoals — range settings', () => {
  const save = () => makeService();
  it('accepts targetDate and maxWeeklyRateLbs', async () => {
    const goals = { ...GOALS, targetDate: '2027-03-01', maxWeeklyRateLbs: 2 };
    await expect(save().setGoals('kckern', goals)).resolves.toEqual(goals);
  });
  it('rejects a malformed targetDate', async () => {
    await expect(save().setGoals('kckern', { ...GOALS, targetDate: '03/01/2027' })).rejects.toMatchObject({ code: 'GOALS_INVALID' });
  });
  it('rejects a non-positive maxWeeklyRateLbs or weeklyRateLbs', async () => {
    await expect(save().setGoals('kckern', { ...GOALS, maxWeeklyRateLbs: 0 })).rejects.toMatchObject({ code: 'GOALS_INVALID' });
    await expect(save().setGoals('kckern', { ...GOALS, weeklyRateLbs: 0 })).rejects.toMatchObject({ code: 'GOALS_INVALID' });
    await expect(save().setGoals('kckern', { ...GOALS, weeklyRateLbs: -1 })).rejects.toMatchObject({ code: 'GOALS_INVALID' });
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run backend/src/3_applications/health/BudgetService.test.mjs -t "range settings"`
Expected: FAIL (a malformed date and a zero rate are accepted today).

- [ ] **Step 3: Implement.** In `assertGoalsShape`:
  - Add `'maxWeeklyRateLbs'` to the positive-number key list.
  - Replace the `weeklyRateLbs` check.
  - Add a `targetDate` check.

```js
  for (const key of ['targetWeightLbs', 'activityBaseline', 'budgetFloor', 'targetBodyFatPct', 'maxWeeklyRateLbs']) {
    if (goals[key] !== undefined && (typeof goals[key] !== 'number' || !Number.isFinite(goals[key]) || goals[key] <= 0)) goalsInvalid(`${key} must be positive`);
  }
  // Losing only: a zero or negative rate would make the "deficit" a surplus.
  if (goals.weeklyRateLbs !== undefined && (typeof goals.weeklyRateLbs !== 'number' || !Number.isFinite(goals.weeklyRateLbs) || goals.weeklyRateLbs <= 0)) goalsInvalid('weeklyRateLbs must be positive');
  if (goals.targetDate !== undefined && goals.targetDate !== null && !isISODate(goals.targetDate)) goalsInvalid('targetDate must be YYYY-MM-DD');
```

(`isISODate` is already imported at the top of the file.)

- [ ] **Step 4: Run to see them pass**

Run: `npx vitest run backend/src/3_applications/health/BudgetService.test.mjs`
Expected: PASS (whole file).

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(health): goals accept targetDate and maxWeeklyRateLbs; rate must be positive" -- backend/src/3_applications/health/BudgetService.mjs backend/src/3_applications/health/BudgetService.test.mjs
```

---

### Task 4: BudgetService returns range, deficit, zone, completeness

**Files:**
- Modify: `backend/src/3_applications/health/BudgetService.mjs` (`#budgetForDate` ~207-237, `getBudget` ~283-306, `getBudgetRange` ~321-364, header comment 1-5)
- Test: `backend/src/3_applications/health/BudgetService.test.mjs` (update lines ~56, ~83-84, ~121-130, ~442, ~472; add new tests)
- Test: `backend/src/4_api/v1/routers/health.budgetRange.test.mjs` (fixture line 42 still valid; add a field assertion)

**Interfaces:**
- Consumes: `solveDailyDeficit`, `computeDailyEnergy({ deficit })` (Task 1); `zoneFor`, `statusForZone` (Task 2); `closureStatus` from `#apps/coaching/dayCompleteness.mjs` (existing).
- Produces (each day from `getBudget`, and each non-gap day from `getBudgetRange`):
  `{ date, budget /* = range.top */, maintenance, deficit, deficitSource, range: { floor, top }, food, exercise, net, zone, complete, declared, remaining, status /* alias */, stale, …existing macro fields }`

- [ ] **Step 1: Write the failing tests** (add to `BudgetService.test.mjs`)

```js
describe('BudgetService — range contract', () => {
  const closures = (map) => ({ healthStore: { loadDayClosedData: async () => map } });

  it('returns the range, the deficit and its source', async () => {
    const b = await makeService().getBudget('kckern', '2026-09-02');
    expect(b.range).toEqual({ floor: 1200, top: 1962 });
    expect(b.budget).toBe(b.range.top);
    expect(b).toMatchObject({ deficit: 500, deficitSource: 'weekly-rate' });
  });

  it('solves the deficit from targetDate', async () => {
    const svc = makeService({ goalsStore: { load: async () => ({ ...GOALS, targetDate: '2026-12-11' }) } });
    const b = await svc.getBudget('kckern', '2026-09-02');
    // 200 → 180 lb over 100 days = 700/day
    expect(b).toMatchObject({ deficit: 700, deficitSource: 'target-date' });
    expect(b.range.top).toBe(b.maintenance - 700);
  });

  it('zone in-range: food 1280 ≥ floor, net 960 ≤ top; remaining equals the old value', async () => {
    const b = await makeService().getBudget('kckern', '2026-09-02');
    expect(b).toMatchObject({ zone: 'in-range', complete: true, declared: null, net: 960, status: 'under' });
    expect(b.remaining).toBe(1962 - 960);
  });

  it('zone incomplete under the floor; remaining is food still to log', async () => {
    const svc = makeService({ nutriListStore: nutriListFake([{ date: '2026-09-02', calories: 700 }]) });
    const b = await svc.getBudget('kckern', '2026-09-02');
    expect(b).toMatchObject({ zone: 'incomplete', complete: false, remaining: 500, status: 'under' });
  });

  it('a declared day under the floor is complete', async () => {
    const svc = makeService({
      nutriListStore: nutriListFake([{ date: '2026-09-02', calories: 700 }]),
      ...closures({ '2026-09-02': { status: 'fasting', at: 'x' } }),
    });
    const b = await svc.getBudget('kckern', '2026-09-02');
    expect(b).toMatchObject({ zone: 'declared', complete: true, declared: 'fasting' });
  });

  it('a failing closure read never fails the budget', async () => {
    const svc = makeService({ healthStore: { loadDayClosedData: async () => { throw new Error('corrupt'); } } });
    const b = await svc.getBudget('kckern', '2026-09-02');
    expect(b).toMatchObject({ declared: null, zone: 'in-range' });
  });

  it('range days carry the same fields as the single day', async () => {
    const svc = makeService({ healthStore: { getWorkoutsForRange: async () => ({ '2026-09-02': [{ calories: 320 }] }) } });
    const [day] = await svc.getBudgetRange('kckern', '2026-09-02', '2026-09-02');
    const single = await svc.getBudget('kckern', '2026-09-02');
    for (const key of ['range', 'deficit', 'deficitSource', 'zone', 'complete', 'declared', 'remaining', 'status', 'net']) {
      expect(day[key]).toEqual(single[key]);
    }
  });
});
```

Update existing assertions that encode the old `remaining` or `status`:
- line ~56: keep. In range, `1962 - 1280 + 320` equals `top − net`. Add a comment saying so.
- lines ~83-84, the "over" test: replace `expect(b.remaining).toBeLessThan(0)` with `expect(b.zone).toMatch(/^(over|past-even)$/); expect(b.remaining).toBeGreaterThan(0);`. Keep `status: 'over'`.
- lines ~121-130, the "rounds food once" test: change the assertion to `expect(b.remaining).toBe(b.range.top - b.net)` and rename the test to "…remaining === top − net exactly when in range". Make its fixture's food ≥ 1200 if it isn't already.
- line ~442: recompute to the zone value for that fixture day (food 1300, exercise 300, top 1962 → in range → `1962 − 1000`). This is the same number, so leave it and add a comment.
- line ~472: unchanged (single === range).

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run backend/src/3_applications/health/BudgetService.test.mjs`
Expected: FAIL on the new `range contract` tests (`range` is undefined).

- [ ] **Step 3: Implement**

Imports at the top:

```js
import { computeDailyEnergy, solveDailyDeficit } from '#domains/health/services/BudgetMath.mjs';
import { zoneFor, statusForZone } from '#shared/contracts/health/budgetZone.mjs';
import { closureStatus } from '#apps/coaching/dayCompleteness.mjs';
```

Header comment (lines 1-5):

```js
// The one home of the daily calorie budget. Each day gets a goal RANGE —
// floor (budgetFloor, a logging-completeness check on FOOD) to top
// (break-even − the day's planned deficit, on NET) — and a zone from the
// shared rule in shared/contracts/health/budgetZone.mjs. `budget` (= range.top)
// and `status` are compatibility aliases. Budget math is never computed
// client-side, except through that same shared rule.
```

`#budgetForDate`: replace the `computeDailyEnergy` call and the return.

```js
    const floor = Math.round(Number(goals.budgetFloor ?? 1200));
    const targetWeightLbs = goals.targetWeightLbs == null ? null : Number(goals.targetWeightLbs);
    const { deficit, deficitSource } = solveDailyDeficit({
      weightLbs, targetWeightLbs, targetDate: goals.targetDate ?? null, day: date,
      weeklyRateLbs: Number(goals.weeklyRateLbs ?? 1),
      maxWeeklyRateLbs: Number(goals.maxWeeklyRateLbs ?? 2),
    });
    const { budget, maintenance } = computeDailyEnergy({
      weightLbs,
      heightIn: Number(goals.heightIn),
      ageYears,
      sex: goals.sex,
      activityBaseline: Number(goals.activityBaseline ?? 1.35),
      budgetFloor: floor,
      deficit,
    });
    return { maintenance, deficit, deficitSource, range: { floor, top: budget }, stale: daysOld > STALE_WEIGHT_DAYS };
```

Add two private helpers to the class:

```js
  // Day closures (done / fasting). A read failure is logged and treated as "not
  // declared": it must never take the budget — and the day view — down with it.
  async #loadClosures(userId) {
    try {
      return (await this.#healthStore.loadDayClosedData?.(userId)) || {};
    } catch (err) {
      this.#logger.warn?.('health.budget.closures_unreadable', { userId, error: err.message });
      return {};
    }
  }

  // The per-day contract, assembled ONE way for getBudget and getBudgetRange.
  #dayContract({ date, energy, food, exercise, declared }) {
    const { maintenance, deficit, deficitSource, range, stale } = energy;
    const { zone, remaining, complete, net } = zoneFor({ food, exercise, maintenance, range, declared });
    return {
      date, budget: range.top, maintenance, deficit, deficitSource, range,
      food, exercise, net, zone, complete, declared, remaining, status: statusForZone(zone), stale,
    };
  }
```

`getBudget`:
- Replace `const { budget, maintenance, stale } = this.#budgetForDate(…)` with `const energy = this.#budgetForDate(…)`.
- Load closures in parallel with the workouts: `const closures = await this.#loadClosures(userId);`.
- Replace the `remaining`/return block:

```js
    return {
      ...this.#dayContract({ date, energy, food, exercise, declared: closureStatus(closures[date]) }),
      sessions, goals, macros, microCoverage, loggedEntries, loggingStatus, goalBasis,
    };
```

`getBudgetRange`:
- Add `this.#loadClosures(userId)` to the `Promise.all` (as a 4th element `closures`).
- In the `dates.map` callback, replace `let budget; let maintenance; let stale; … ({ budget, maintenance, stale } = …)` with `let energy; … energy = this.#budgetForDate(…)`.
- Replace the tail:

```js
      return {
        ...this.#dayContract({ date, energy, food, exercise, declared: closureStatus(closures[date]) }),
        macros, loggedEntries, loggingStatus, goalBasis,
      };
```

In `health.budgetRange.test.mjs`, add one assertion to its passing-through test: the route returns whatever the service gives. The fixture on line 42 is a stub, so assert `res.body.days[0].remaining` still passes through unchanged. No new fields are needed there, because the route does not compute anything.

- [ ] **Step 4: Run to see them pass**

Run: `npx vitest run backend/src/3_applications/health/BudgetService.test.mjs backend/src/4_api/v1/routers/health.budgetRange.test.mjs backend/src/2_domains/health/services/BudgetMath.test.mjs shared/contracts/health/budgetZone.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(health): budget returns range, solved deficit, zone and completeness" -- backend/src/3_applications/health/BudgetService.mjs backend/src/3_applications/health/BudgetService.test.mjs backend/src/4_api/v1/routers/health.budgetRange.test.mjs
```

---

### Task 5: Keep today's surfaces truthful (drag preview, headline, strip labels)

`remaining` now means the zone's headline value. The three client readers must say which segment it is, or an incomplete day would read "500 kcal left" when it means "500 to floor". Bar *geometry* is untouched; that's Phase 2.

**Files:**
- Modify: `frontend/src/modules/Health/today/portionPreview.js:17-24`
- Modify: `frontend/src/modules/Health/today/EquationStrip.jsx:41-44,58` (headline and `aria-label` only)
- Modify: `frontend/src/modules/Health/today/dayBars.js:93-95`
- Test: `frontend/src/modules/Health/today/portionPreview.test.js` (create if absent, else extend)
- Test: `frontend/src/modules/Health/today/EquationStrip.test.jsx`, `frontend/src/modules/Health/today/dayBars.test.js`

**Interfaces:**
- Consumes: `zoneFor`, `statusForZone`, `headlineFor` from `@shared-contracts/health/budgetZone.mjs` (Task 2); budget days now carry `range`, `zone`, `declared`, `maintenance` (Task 4).
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests**

`portionPreview.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { projectPortion } from './portionPreview.js';

const row = { uuid: 'a', name: 'Rice', calories: 300, amount: 1, unit: 'cup', grams: 200 };
const budget = { food: 1100, exercise: 0, maintenance: 2291, range: { floor: 1200, top: 1791 },
  declared: null, zone: 'incomplete', remaining: 100, status: 'under', macros: {} };

describe('projectPortion — zone', () => {
  it('a drag that crosses the floor moves the day from incomplete to in range, like the server', () => {
    const draft = { row, portion: { value: 2, unit: 'cup' } }; // +300 kcal
    const { budget: b } = projectPortion([row], budget, draft);
    expect(b).toMatchObject({ food: 1400, zone: 'in-range', remaining: 391, status: 'under' });
  });
  it('a drag past the top turns the day over', () => {
    const draft = { row, portion: { value: 4, unit: 'cup' } }; // +900 kcal → 2000
    const { budget: b } = projectPortion([row], budget, draft);
    expect(b).toMatchObject({ zone: 'over', remaining: 209, status: 'over' });
  });
});
```

`EquationStrip.test.jsx`, new cases:

```js
  it('names the segment the headline measures', () => {
    const base = { budget: 1791, maintenance: 2291, range: { floor: 1200, top: 1791 }, exercise: 0, declared: null };
    strip({ budget: { ...base, food: 700, net: 700, zone: 'incomplete', remaining: 500, status: 'under' } });
    expect(screen.getByTestId('budget-headline').textContent).toMatch(/500\s*kcal to floor/);
  });
  it('a declared day says so instead of a number', () => {
    strip({ budget: { budget: 1791, maintenance: 2291, range: { floor: 1200, top: 1791 }, food: 600, exercise: 0, net: 600,
      zone: 'declared', declared: 'fasting', remaining: 1191, status: 'under' } });
    expect(screen.getByTestId('budget-headline').textContent).toBe('Fasted');
  });
```

`dayBars.test.js`, new case:

```js
  it('the cell label names the zone segment', () => {
    const d = day({ food: 700, zone: 'incomplete', remaining: 500, status: 'under', range: { floor: 1200, top: 2000 } });
    expect(barCellLabel(d, barModel(d), 'Mon')).toMatch(/500 kcal to floor$/);
  });
```

(Import `barCellLabel` alongside `barModel` if the file doesn't already.)

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run frontend/src/modules/Health/today/portionPreview.test.js frontend/src/modules/Health/today/EquationStrip.test.jsx frontend/src/modules/Health/today/dayBars.test.js`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement**

`portionPreview.js`: import the rule and replace the budget projection's `food`/`remaining`/`status` lines.

```js
import { zoneFor, statusForZone } from '@shared-contracts/health/budgetZone.mjs';
```
```js
  const food = budget.food + delta;
  // The same zone rule the server applies, so a live drag recolours exactly as
  // the reloaded day will. A budget from an older server (no range) keeps the
  // old arithmetic.
  const zoned = budget.range
    ? zoneFor({ food, exercise: budget.exercise, maintenance: budget.maintenance, range: budget.range, declared: budget.declared })
    : null;
  return { items: projected, budget: { ...budget,
    food,
    ...(zoned ? { zone: zoned.zone, remaining: zoned.remaining, net: zoned.net, complete: zoned.complete, status: statusForZone(zoned.zone) }
      : { remaining: budget.remaining - delta, status: budget.remaining - delta < 0 ? 'over' : 'under' }),
    macros: { ...budget.macros, ...Object.fromEntries(NUTRIENT_KEYS.filter(key => key !== 'calories').map(key =>
      [key, (budget.macros?.[key] || 0) + sumCounted(projected, key) - sumCounted(items, key)])) },
  } };
```

`EquationStrip.jsx`: import `headlineFor`, and replace the headline `<span>` (lines ~42-44) and the tail of the track `aria-label`.

```js
import { headlineFor } from '@shared-contracts/health/budgetZone.mjs';
```
```jsx
  // Legacy budgets (no zone) keep the old two-way wording.
  const headline = budget.zone
    ? headlineFor(budget)
    : { value: Math.abs(budget.remaining), text: over ? 'over goal' : 'left' };
```
```jsx
        <span className="health-budget__headline" data-testid="budget-headline">
          {headline.value == null ? headline.text : <><strong>{n(headline.value)}</strong> kcal {headline.text}</>}
        </span>
```
In the track's `aria-label`, replace the final `over ? … : …` ternary with:
```js
${headline.value == null ? `, ${headline.text}` : `, ${n(headline.value)} ${headline.text}`}
```

`dayBars.js` (`barCellLabel`):

```js
import { headlineFor } from '@shared-contracts/health/budgetZone.mjs';
```
```js
  const h = day.zone ? headlineFor(day) : { value: Math.abs(int(day.remaining)), text: day.status === 'over' ? 'over goal' : 'left' };
  const outcome = h.value == null ? h.text : `${int(h.value)} kcal ${h.text}`;
```

- [ ] **Step 4: Run to see them pass**

Run: `npx vitest run frontend/src/modules/Health`
Expected: PASS (whole Health module; the legacy fixtures without `zone` still take the old wording).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Health/today/portionPreview.test.js
git commit -m "fix(health): headline, strip labels and drag preview name the zone segment" -- frontend/src/modules/Health/today/portionPreview.js frontend/src/modules/Health/today/portionPreview.test.js frontend/src/modules/Health/today/EquationStrip.jsx frontend/src/modules/Health/today/EquationStrip.test.jsx frontend/src/modules/Health/today/dayBars.js frontend/src/modules/Health/today/dayBars.test.js
```

---

### Task 6: `minCalories` on the day status is the per-user floor

**Files:**
- Modify: `backend/src/3_applications/health/HealthOperations.mjs` (constructor ~46-72, `readDayStatus` ~150-155, `setDayStatus` return)
- Modify: `backend/src/5_composition/modules/healthApi.mjs` (~96-122: build `goalsStore` before `HealthOperations`, pass `budgetFloor`)
- Test: `backend/src/4_api/v1/routers/health.dayStatus.test.mjs`

**Interfaces:**
- Consumes: the goals store's `load(userId)`.
- Produces: the `HealthOperations` constructor option `budgetFloor: (username) => Promise<number|null>`. `readDayStatus`/`setDayStatus` return `minCalories` = that floor when present, else the legacy coaching `min_calories`, else 1200.

- [ ] **Step 1: Write the failing test** (add to `health.dayStatus.test.mjs`; mirror its existing setup at lines 22-23)

```js
  it('minCalories is the per-user budget floor when goals set one', async () => {
    const operations = new HealthOperations({ healthData, nutritionItems, resolveDefaultUsername: () => 'kc',
      today: () => '2026-09-24', completeness: () => ({ min_calories: 1300 }), budgetFloor: async () => 1100 });
    const status = await operations.readDayStatus('kc', '2026-09-24');
    expect(status.minCalories).toBe(1100);
  });
```

(Use the file's existing `healthData`/`nutritionItems` fakes. The existing assertions expecting `1300` stay valid, because those operations pass no `budgetFloor`.)

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run backend/src/4_api/v1/routers/health.dayStatus.test.mjs`
Expected: FAIL (`minCalories` is 1300).

- [ ] **Step 3: Implement**

`HealthOperations` constructor: add `budgetFloor = async () => null,` to the destructured options and `this.budgetFloor = budgetFloor;`. Add a helper and use it in `readDayStatus` (and in `setDayStatus`'s return, which builds the same shape):

```js
  // The completeness threshold is the user's budget floor (the goal range's
  // lower edge). The coaching config's min_calories is the fallback until
  // Phase 3 retires it.
  async minCaloriesFor(username) {
    let floor = null;
    try { floor = await this.budgetFloor(username); } catch { floor = null; }
    return Number.isFinite(floor) && floor > 0 ? floor : resolveMinCalories(this.completeness());
  }
```
```js
    return { status: closureStatus(closures?.[date]), minCalories: await this.minCaloriesFor(username), today: this.today() };
```

`healthApi.mjs`: move `const goalsStore = new YamlHealthGoalsDatastore({ dataService });` above the `HealthOperations` construction and add:

```js
    // The day status's completeness threshold is the per-user budget floor.
    budgetFloor: async (username) => {
      const goals = await goalsStore.load(username);
      const n = Number(goals?.budgetFloor);
      return Number.isFinite(n) && n > 0 ? n : null;
    },
```

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run backend/src/4_api/v1/routers/health.dayStatus.test.mjs backend/src/3_applications/health`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(health): day-status threshold is the per-user budget floor" -- backend/src/3_applications/health/HealthOperations.mjs backend/src/5_composition/modules/healthApi.mjs backend/src/4_api/v1/routers/health.dayStatus.test.mjs
```

---

### Task 7: Settings migration report / apply

Three sources hold the floor today (health goals `budgetFloor`, profile `apps.nutribot.goals.calories_min`, household coaching `logging_completeness.min_calories`). Two hold a target (health goals `targetWeightLbs`, coach `agents/health-coach/goals.yml` `weight.target_lbs`/`target_date`). The CLI **reports every value and every conflict**. With `--apply` it only fills `budgetFloor` when it is unset. It never invents a `targetDate`.

**Files:**
- Create: `backend/src/3_applications/health/budgetSettingsMigration.mjs`
- Test: `backend/src/3_applications/health/budgetSettingsMigration.test.mjs`
- Create: `cli/health-budget-settings-migrate.cli.mjs`

**Interfaces:**
- Produces: `planBudgetSettingsMigration({ healthGoals, profile, coachGoals, coachingConfig, today }): { set: { budgetFloor?: number }, report: Array<{ key, source, value }>, conflicts: string[] }`

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from 'vitest';
import { planBudgetSettingsMigration } from './budgetSettingsMigration.mjs';

const today = '2026-09-24';

describe('planBudgetSettingsMigration', () => {
  it('changes nothing when budgetFloor is set, and reports every source', () => {
    const plan = planBudgetSettingsMigration({
      healthGoals: { budgetFloor: 1200, targetWeightLbs: 180 },
      profile: { apps: { nutribot: { goals: { calories_min: 1200, calories_max: 1600 } } } },
      coachGoals: { weight: { target_lbs: 165, target_date: '2026-03-11' }, nutrition: { calories_min: 1200, calories_max: 1600 } },
      coachingConfig: { logging_completeness: { min_calories: 1200 } },
      today,
    });
    expect(plan.set).toEqual({});
    expect(plan.report).toContainEqual({ key: 'floor', source: 'coaching.logging_completeness.min_calories', value: 1200 });
    expect(plan.conflicts).toEqual(expect.arrayContaining([
      expect.stringMatching(/target weight: health goals 180 vs coach 165/),
      expect.stringMatching(/coach target_date 2026-03-11 has passed/),
    ]));
  });

  it('fills an unset budgetFloor from the profile, then the coaching config', () => {
    expect(planBudgetSettingsMigration({ healthGoals: {}, profile: { apps: { nutribot: { goals: { calories_min: 1100 } } } }, today }).set)
      .toEqual({ budgetFloor: 1100 });
    expect(planBudgetSettingsMigration({ healthGoals: {}, coachingConfig: { logging_completeness: { min_calories: 1300 } }, today }).set)
      .toEqual({ budgetFloor: 1300 });
  });

  it('flags floor sources that disagree', () => {
    const plan = planBudgetSettingsMigration({ healthGoals: { budgetFloor: 1200 }, coachingConfig: { logging_completeness: { min_calories: 1400 } }, today });
    expect(plan.conflicts).toContainEqual(expect.stringMatching(/floor: .*1200.*1400/));
  });

  it('never proposes a targetDate', () => {
    const plan = planBudgetSettingsMigration({ healthGoals: { budgetFloor: 1200 }, coachGoals: { weight: { target_date: '2027-01-01' } }, today });
    expect(plan.set).not.toHaveProperty('targetDate');
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run backend/src/3_applications/health/budgetSettingsMigration.test.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `budgetSettingsMigration.mjs`

```js
// One-off planner for the budget-range migration (Phase 1 of
// docs/_wip/plans/2026-09-24-health-budget-range-design.md). Reads the legacy
// floor/target settings, reports every value and disagreement, and proposes
// only one change: filling an UNSET budgetFloor. It never invents a targetDate
// — that is a personal decision, surfaced as a conflict instead.
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

export function planBudgetSettingsMigration({ healthGoals = {}, profile = {}, coachGoals = {}, coachingConfig = {}, today }) {
  const floors = [
    ['health.budgetFloor', num(healthGoals.budgetFloor)],
    ['profile.apps.nutribot.goals.calories_min', num(profile?.apps?.nutribot?.goals?.calories_min)],
    ['coach.nutrition.calories_min', num(coachGoals?.nutrition?.calories_min)],
    ['coaching.logging_completeness.min_calories', num(coachingConfig?.logging_completeness?.min_calories)],
  ];
  const tops = [
    ['profile.apps.nutribot.goals.calories_max', num(profile?.apps?.nutribot?.goals?.calories_max)],
    ['coach.nutrition.calories_max', num(coachGoals?.nutrition?.calories_max)],
  ];
  const report = [
    ...floors.filter(([, v]) => v != null).map(([source, value]) => ({ key: 'floor', source, value })),
    ...tops.filter(([, v]) => v != null).map(([source, value]) => ({ key: 'top (legacy, replaced by the computed range top)', source, value })),
  ];
  const conflicts = [];
  const floorValues = [...new Set(floors.map(([, v]) => v).filter((v) => v != null))];
  if (floorValues.length > 1) conflicts.push(`floor: sources disagree (${floors.filter(([, v]) => v != null).map(([s, v]) => `${s}=${v}`).join(', ')})`);

  const healthTarget = num(healthGoals.targetWeightLbs);
  const coachTarget = num(coachGoals?.weight?.target_lbs);
  if (healthTarget && coachTarget && healthTarget !== coachTarget) conflicts.push(`target weight: health goals ${healthTarget} vs coach ${coachTarget}`);
  const coachDate = coachGoals?.weight?.target_date;
  if (coachDate && coachDate < today) conflicts.push(`coach target_date ${coachDate} has passed; set health goals targetDate deliberately`);
  if (!healthGoals.targetDate) conflicts.push('health goals has no targetDate: the deficit stays on weeklyRateLbs until one is set');

  const set = {};
  if (num(healthGoals.budgetFloor) == null) {
    const fill = floors.slice(1).find(([, v]) => v != null)?.[1];
    if (fill != null) set.budgetFloor = fill;
  }
  return { set, report, conflicts };
}
```

`cli/health-budget-settings-migrate.cli.mjs`:

```js
#!/usr/bin/env node
/**
 * Report (default) or apply (--apply) the budget-range settings migration.
 * Run inside the app container, from the app root, so data/ is the live tree:
 *
 *   node cli/health-budget-settings-migrate.cli.mjs --user <id>            # report only
 *   node cli/health-budget-settings-migrate.cli.mjs --user <id> --apply    # fill an unset budgetFloor
 *
 * Only ever writes data/users/<id>/apps/health/goals.yml, and only budgetFloor.
 */
import fs from 'node:fs';
import yaml from 'js-yaml';
import { planBudgetSettingsMigration } from '#apps/health/budgetSettingsMigration.mjs';

const args = process.argv.slice(2);
const user = args[args.indexOf('--user') + 1];
const apply = args.includes('--apply');
if (!user || user.startsWith('--')) { process.stderr.write('usage: --user <id> [--apply]\n'); process.exit(2); }

const read = (p) => (fs.existsSync(p) ? yaml.load(fs.readFileSync(p, 'utf8')) || {} : {});
const goalsPath = `data/users/${user}/apps/health/goals.yml`;
const healthGoals = read(goalsPath);
const plan = planBudgetSettingsMigration({
  healthGoals,
  profile: read(`data/users/${user}/profile.yml`),
  coachGoals: read(`data/users/${user}/agents/health-coach/goals.yml`),
  coachingConfig: read('data/household/coaching/config.yml'),
  today: new Date().toLocaleDateString('en-CA'),
});
process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
if (apply && Object.keys(plan.set).length) {
  fs.writeFileSync(goalsPath, yaml.dump({ ...healthGoals, ...plan.set }));
  process.stdout.write(`applied: ${JSON.stringify(plan.set)} → ${goalsPath}\n`);
} else if (apply) {
  process.stdout.write('nothing to apply\n');
}
```

- [ ] **Step 4: Run to see them pass**

Run: `npx vitest run backend/src/3_applications/health/budgetSettingsMigration.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/health/budgetSettingsMigration.mjs backend/src/3_applications/health/budgetSettingsMigration.test.mjs cli/health-budget-settings-migrate.cli.mjs
git commit -m "feat(health): budget settings migration report (fills an unset floor only)" -- backend/src/3_applications/health/budgetSettingsMigration.mjs backend/src/3_applications/health/budgetSettingsMigration.test.mjs cli/health-budget-settings-migrate.cli.mjs
```

---

### Task 8: Docs

**Files:**
- Modify: `docs/reference/health/README.md`: the budget-equation section (currently ~lines 124-178, "## The budget equation — one server-side home").

- [ ] **Step 1: Rewrite the section** so it states:
  - The range: floor = `budgetFloor` compared against **food**, as a logging-completeness check; top = `maintenance − deficit`, floored, compared against **net**.
  - The deficit solver and its three sources (`target-date`, `weekly-rate`, `at-target`), the cap, and `3500 ÷ 7`.
  - The five zones in order, and `remaining` per zone (the table from the spec). `budget` and `status` are aliases.
  - Completeness: floor or declaration, never the clock. `declared` comes from day closures, and a read failure means `null`.
  - History: goals apply as current (`goalBasis: 'current'`), so changing `targetDate` recolours past days.
  - The shared rule's path (`shared/contracts/health/budgetZone.mjs`) and that the drag preview uses it.
  - The migration CLI and what it will and won't write.
  - `minCalories` on the day status is the per-user floor.

- [ ] **Step 2: Check** that there are no instance-specific values (hostnames, paths outside the repo) and that every file path named exists: `grep -o '`[^`]*\.m\?js`' docs/reference/health/README.md | sort -u`, then spot-check.

- [ ] **Step 3: Commit**

```bash
git commit -m "docs(health): budget range, zones and completeness" -- docs/reference/health/README.md
```

---

### Task 9: Verify the whole phase, deploy, confirm live

- [ ] **Step 1: Full relevant suite**

Run: `npx vitest run frontend/src/modules/Health frontend/src/lib/ui backend/src/2_domains/health backend/src/3_applications/health backend/src/3_applications/coaching backend/src/4_api/v1/routers/health shared/contracts/health`
Expected: PASS, with the exit code captured (`echo $?` → 0).

- [ ] **Step 2: Merge to main** (if on a branch) and push, then run the gate, which must be able to halt: `./scripts/deploy-gate.sh` (exit 0 only).

- [ ] **Step 3: Build and deploy**: `./scripts/build-daylight.sh`, re-run the gate, then `sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight`.

- [ ] **Step 4: Confirm live**
  - `curl -s http://localhost:3111/build.txt` matches `git rev-parse origin/main`.
  - `curl -s "http://localhost:3111/api/v1/health/budget?date=$(date +%F)" | python3 -m json.tool | grep -E '"(range|floor|top|deficit|deficitSource|zone|complete|declared|remaining|status)"'` shows every field.
  - Headless phone screenshot of `/health` (the Playwright pattern in the memory note `reference_headless_playwright_screenshot`): the headline reads "N kcal left", "N kcal to floor", "N kcal over" or "Fasted", depending on today.

- [ ] **Step 5: Run the migration report** inside the container (report only; apply only if `set` is non-empty):
  `sudo docker exec daylight-station sh -c 'node cli/health-budget-settings-migrate.cli.mjs --user <head-of-household id>'`. Relay its `conflicts` to the user. The expected ones are: target weight 180 vs 165; the coach target date has passed; no `targetDate` set.
