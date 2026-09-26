# Health Budget Card by Jobs-to-be-Done — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the Today budget card so its headline answers whichever job the person has at that moment (trust the log, afford a snack, contain an overrun, judge a finished day) and its bar shows what is left as a price list: free, workout, deficit.

**Architecture:** A new pure shared module, `shared/contracts/health/budgetTiers.mjs`, turns a day's budget into three food-scale tiers plus a "spend" region, and splits a kcal delta across those tiers. The server's `zoneFor` / `ZONES` contract is **not changed**: nutribot, coaching, the week strip, the month block and the health-coach agent all read it. A new frontend module, `today/budgetStory.js`, picks the leading job and writes the headline and sub-line. `budgetGeometry.js` stops drawing the goal band, the exercise hatch and the dotted run, and draws the tiers plus a goal mark and a ceiling mark instead. `EquationStrip.jsx` renders the story and the tiers.

**Tech Stack:** React (JSX), SCSS, Vitest + Testing Library (jsdom), shared ES modules imported as `@shared-contracts/...` on the client and `#shared/...` on the server.

**Review:** This plan was reviewed by a Fable agent on 2026-09-25, which re-ran every expectation by hand. Its fixes are folded in; see [Review changes](#review-changes-2026-09-25) at the end.

---

## Background the engineer needs

### Why this exists (the design, in one page)

The card is read in four situations. Each one is a separate **job**, and exactly one leads at a time:

| Job | Situation | What the card must say |
|---|---|---|
| **Trust** | Live day, under the logging floor, not closed | The free number, dimmed, with a sub-line saying it assumes the log is complete |
| **Afford** | Live day, still within the plan | How much is free, then what the rest costs (the workout, then the deficit) |
| **Contain** | Live day, past the plan | How much is left before the day becomes a weight **gain** |
| **Judge** | Finished day (a past date, or closed as Done/Fasted) | A verdict: on plan, workout banked or eaten back, missed plan, surplus, fasted |

The old card answered only Afford, with one number ("632 kcal left") that silently assumed you eat your workout calories back. It showed the planned-deficit gap nowhere and gave past days a "left" headline.

**One vocabulary.** The bar, the sub-line and the drag price all use the same nouns: **free**, **workout**, **deficit**, **to break even**, **over plan**. Don't introduce synonyms.

### The numbers

A day's `budget` object (from `BudgetService.#dayContract`, `backend/src/3_applications/health/BudgetService.mjs:277-288`):

| Field | Meaning |
|---|---|
| `food` | kcal eaten |
| `exercise` | kcal burned in workouts |
| `net` | `food − exercise` |
| `maintenance` | break-even (TDEE), compared against NET |
| `range.floor` | logging-completeness floor, compared against FOOD |
| `range.top` | the plan, compared against NET |
| `zone` | `incomplete` / `declared` / `in-range` / `over` / `past-even` (`shared/contracts/health/budgetZone.mjs`) |
| `remaining` | the old headline number |
| `declared` | `'done'` / `'fasting'` / `null` (day closed) |
| `fastedMeals` | meals declared skipped |

### Food-scale lines (all tiers are measured in FOOD eaten)

```
top      = range.top                        ← end of "free"          (the Goal mark)
ceiling  = top + exercise                   ← end of "workout"       (the ceiling mark; "over plan" counts from here)
even     = maintenance + exercise           ← end of "deficit"       (the Break even mark)
```

These agree with `zoneFor` exactly: `net > top ⇔ food > ceiling`, `net > maintenance ⇔ food > even`.

**Edge case:** when the floor exceeds maintenance, the server's `top = max(floor, maintenance − deficit)` puts `top` past break-even. `zoneFor` tests break-even first, so the tiers must be **capped at `even`**. Task 1 pins this.

### Worked example: the 2026-09-25 screenshot day

`food 1470, exercise 311, maintenance 2291, range {floor 1200, top 1791}` →
`ceiling 2102, even 2602`. Tiers left: **free 321, workout 311, deficit 500** (total **1,132 to break even**, the old header's "deficit").

### Region names (`spend`)

| `spend` | Food range | Old zone |
|---|---|---|
| `free` | ≤ top | `incomplete` / `declared` / `in-range` |
| `workout` | top < food ≤ ceiling (only with exercise) | `in-range` |
| `over` | ceiling < food ≤ even | `over` |
| `gain` | food > even | `past-even` |

### Running tests

From the repo root:

```bash
npx vitest run <path> [<path>…]
```

The root `vitest.config.mjs` aliases `@shared-contracts` and already runs `shared/**/*.test.mjs`. The relevant suites currently pass (55 tests):
`shared/contracts/health/budgetZone.test.mjs frontend/src/modules/Health/today/budgetGeometry.test.js frontend/src/modules/Health/today/EquationStrip.test.jsx`.

### House rules that apply

- Run this in a worktree (`superpowers:using-git-worktrees`). Before branching, sync with the deployed tree per `CLAUDE.local.md`.
- **Never start a second backend** to test this. Every task here is a pure-function test or a jsdom test. Visual verification (Task 8) uses the running dev server, or the static harness if none is running.
- Match the surrounding style: short `//` comments that explain *why*, and no `console.*` calls.
- Docs update is part of the work (Task 7).

---

### Task 1: `priceLadder` — tiers and spend region

**Files:**
- Create: `shared/contracts/health/budgetTiers.mjs`
- Test: `shared/contracts/health/budgetTiers.test.mjs`

**Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { priceLadder } from './budgetTiers.mjs';
import { zoneFor } from './budgetZone.mjs';

const range = { floor: 1200, top: 1791 };
const day = (food, exercise = 311, over = {}) => ({ food, exercise, maintenance: 2291, range, ...over });
const lefts = (l) => Object.fromEntries(l.tiers.map(t => [t.key, t.left]));

describe('priceLadder — the food-scale lines', () => {
  it('the 2026-09-25 day: top 1791, ceiling 2102, break even 2602', () => {
    expect(priceLadder(day(1470)).lines).toEqual({ food: 1470, exercise: 311, floor: 1200, top: 1791, ceiling: 2102, even: 2602, capped: false });
  });

  it('no maintenance: no break even', () => {
    expect(priceLadder(day(1470, 311, { maintenance: 0 })).lines.even).toBeNull();
  });

  it('a floor above maintenance caps the plan at break even, and says so', () => {
    const l = priceLadder({ food: 1000, exercise: 0, maintenance: 1100, range: { floor: 1200, top: 1200 } });
    expect(l.lines).toMatchObject({ top: 1100, ceiling: 1100, even: 1100, capped: true });
    expect(l.tiers.map(t => t.key)).toEqual(['free']);
  });

  it('missing or negative inputs read as 0', () => {
    expect(priceLadder({ food: null, exercise: -50, maintenance: 2291, range }).lines).toMatchObject({ food: 0, exercise: 0 });
  });
});

describe('priceLadder — tiers left', () => {
  it('in the free tier: 321 free, 311 workout, 500 deficit', () => {
    const l = priceLadder(day(1470));
    expect(l.spend).toBe('free');
    expect(lefts(l)).toEqual({ free: 321, workout: 311, deficit: 500 });
  });

  it('eating into the workout: free is gone, 109 of 311 used', () => {
    const l = priceLadder(day(1900));
    expect(l.spend).toBe('workout');
    expect(lefts(l)).toEqual({ free: 0, workout: 202, deficit: 500 });
    expect(l.tiers.find(t => t.key === 'workout').used).toBe(109);
  });

  it('over plan: 198 over, 302 to break even', () => {
    const l = priceLadder(day(2300));
    expect(l).toMatchObject({ spend: 'over', over: 198, gain: 0 });
    expect(lefts(l).deficit).toBe(302);
  });

  it('past break even: 198 gained, 698 over plan, nothing left', () => {
    const l = priceLadder(day(2800));
    expect(l).toMatchObject({ spend: 'gain', over: 698, gain: 198 });
    expect(Object.values(lefts(l))).toEqual([0, 0, 0]);
  });

  it('no exercise: no workout tier, the ceiling is the top', () => {
    const l = priceLadder(day(1470, 0));
    expect(l.tiers.map(t => t.key)).toEqual(['free', 'deficit']);
    expect(l.lines.ceiling).toBe(1791);
  });

  it('no maintenance: no deficit tier; past the ceiling is "over", never "gain"', () => {
    const l = priceLadder(day(2300, 311, { maintenance: 0 }));
    expect(l.tiers.map(t => t.key)).toEqual(['free', 'workout']);
    expect(l.spend).toBe('over');
  });
});

describe('priceLadder — agrees with the server zone rule', () => {
  const family = { free: ['incomplete', 'declared', 'in-range'], workout: ['in-range'], over: ['over'], gain: ['past-even'] };
  for (const exercise of [0, 311, 1600]) {
    it(`every food 0–4000 with ${exercise} burned lands in the zone family zoneFor picks`, () => {
      for (let food = 0; food <= 4000; food += 1) {
        const { spend } = priceLadder(day(food, exercise));
        const { zone } = zoneFor({ food, exercise, maintenance: 2291, range });
        expect(family[spend], `food ${food}`).toContain(zone);
      }
    });
  }

  it('the capped case (floor above maintenance) agrees too', () => {
    const capped = { floor: 1200, top: 1200 };
    for (let food = 0; food <= 2000; food += 1) {
      const { spend } = priceLadder({ food, exercise: 0, maintenance: 1100, range: capped });
      const { zone } = zoneFor({ food, exercise: 0, maintenance: 1100, range: capped });
      expect(family[spend], `food ${food}`).toContain(zone);
    }
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `npx vitest run shared/contracts/health/budgetTiers.test.mjs`
Expected: FAIL, `Failed to resolve import "./budgetTiers.mjs"`.

**Step 3: Write the implementation**

```js
// The budget as a price list, on the FOOD scale. What is left today falls into
// tiers, each named by what eating into it costs:
//
//   free     0 → top                 costs nothing: the plan holds
//   workout  top → top + exercise    costs the workout's benefit
//   deficit  ceiling → break even    costs the day's progress
//   (beyond break even the day is a gain)
//
// Derived from the same fields zoneFor reads, and agreeing with it
// (budgetTiers.test.mjs sweeps both). The zone contract is unchanged: the coach,
// nutribot and the week strip keep reading zones; the Today card reads tiers.

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function budgetLines({ food, exercise, maintenance, range }) {
  const ex = Math.max(0, num(exercise));
  const even = num(maintenance) > 0 ? num(maintenance) + ex : null;
  // A floor above maintenance puts the plan past break even; zoneFor tests
  // break even first, so no tier may run past it.
  const cap = (v) => (even == null ? v : Math.min(v, even));
  const top = num(range?.top);
  return {
    food: Math.max(0, num(food)), exercise: ex, floor: num(range?.floor),
    top: cap(top), ceiling: cap(top + ex), even, capped: cap(top) < top,
  };
}

export function priceLadder(budget) {
  const L = budgetLines(budget);
  const bounds = [
    { key: 'free', from: 0, to: L.top },
    ...(L.exercise > 0 ? [{ key: 'workout', from: L.top, to: L.ceiling }] : []),
    ...(L.even != null ? [{ key: 'deficit', from: L.ceiling, to: L.even }] : []),
  ];
  const tiers = bounds.filter(t => t.to > t.from).map(t => ({
    ...t,
    used: Math.round(Math.min(Math.max(L.food - t.from, 0), t.to - t.from)),
    left: Math.round(Math.max(0, t.to - Math.max(t.from, L.food))),
  }));
  const spend = L.even != null && L.food > L.even ? 'gain'
    : L.food > L.ceiling ? 'over'
      : L.food > L.top ? 'workout' : 'free';
  return {
    lines: L, tiers, spend,
    over: Math.round(Math.max(0, L.food - L.ceiling)),
    gain: L.even == null ? 0 : Math.round(Math.max(0, L.food - L.even)),
  };
}
```

Note: `food > top` with no exercise means `food > ceiling`, so the `over` branch catches it first. `workout` is only reachable with exercise.

**Step 4: Run the test to verify it passes**

Run: `npx vitest run shared/contracts/health/budgetTiers.test.mjs`
Expected: PASS (14 tests).

**Step 5: Commit**

```bash
git add shared/contracts/health/budgetTiers.mjs shared/contracts/health/budgetTiers.test.mjs
git commit -m "feat(health): budget tiers — what is left, priced as free, workout, deficit"
```

---

### Task 2: `priceOf` — what a food would cost

**Files:**
- Modify: `shared/contracts/health/budgetTiers.mjs`
- Test: `shared/contracts/health/budgetTiers.test.mjs`

**Step 1: Write the failing test** (append to the test file; add `priceOf` to the import)

```js
describe('priceOf — a portion split across the tiers it lands in', () => {
  it('200 kcal on the 2026-09-25 day is all free', () => {
    expect(priceOf(day(1470), 200)).toEqual([{ key: 'free', kcal: 200 }]);
  });

  it('430 kcal spends the free tier, then 109 of the workout', () => {
    expect(priceOf(day(1470), 430)).toEqual([{ key: 'free', kcal: 321 }, { key: 'workout', kcal: 109 }]);
  });

  it('1,500 kcal runs through every tier into a gain', () => {
    expect(priceOf(day(1470), 1500)).toEqual([
      { key: 'free', kcal: 321 }, { key: 'workout', kcal: 311 }, { key: 'deficit', kcal: 500 }, { key: 'gain', kcal: 368 },
    ]);
  });

  it('no maintenance: past the ceiling is "over", not "gain"', () => {
    expect(priceOf(day(1470, 311, { maintenance: 0 }), 1000).at(-1)).toEqual({ key: 'over', kcal: 368 });
  });

  it('nothing added costs nothing', () => {
    expect(priceOf(day(1470), 0)).toEqual([]);
    expect(priceOf(day(1470), -200)).toEqual([]);
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `npx vitest run shared/contracts/health/budgetTiers.test.mjs`
Expected: FAIL, `priceOf is not a function` (or not exported).

**Step 3: Write the implementation** (append to `budgetTiers.mjs`)

```js
/**
 * What `delta` more kcal would cost, split across the tiers it lands in, in
 * order. Past the last tier it is a `gain` (or `over`, when break even is
 * unknown). A zero or negative delta costs nothing.
 */
export function priceOf(budget, delta) {
  const { lines: L, tiers } = priceLadder(budget);
  const start = L.food;
  const end = start + num(delta);
  if (end <= start) return [];
  const spans = [
    ...tiers.map(({ key, from, to }) => ({ key, from, to })),
    { key: L.even == null ? 'over' : 'gain', from: L.even ?? L.ceiling, to: Infinity },
  ];
  return spans
    .map(({ key, from, to }) => ({ key, kcal: Math.round(Math.max(0, Math.min(end, to) - Math.max(start, from))) }))
    .filter(p => p.kcal > 0);
}
```

**Step 4: Run the test to verify it passes**

Run: `npx vitest run shared/contracts/health/budgetTiers.test.mjs`
Expected: PASS (19 tests).

**Step 5: Commit**

```bash
git add shared/contracts/health/budgetTiers.mjs shared/contracts/health/budgetTiers.test.mjs
git commit -m "feat(health): priceOf — what a portion costs, by tier"
```

---

### Task 3: `budgetStory` — which job leads, and what the headline says

**Files:**
- Create: `frontend/src/modules/Health/today/budgetStory.js`
- Test: `frontend/src/modules/Health/today/budgetStory.test.js`

**Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { budgetStory, isFinishedDay } from './budgetStory.js';

const range = { floor: 1200, top: 1791 };
const day = (food, exercise = 311, over = {}) => ({ food, exercise, maintenance: 2291, range, zone: 'in-range', declared: null, ...over });
const live = { date: '2026-09-25', today: '2026-09-25' };
const past = { date: '2026-09-24', today: '2026-09-25' };
const say = (s) => ({ job: s.job, value: s.value, text: s.text, sub: s.sub });

describe('isFinishedDay', () => {
  it('a past date, or a day closed as done or fasted', () => {
    expect(isFinishedDay({ ...past, declared: null })).toBe(true);
    expect(isFinishedDay({ ...live, declared: 'done' })).toBe(true);
    expect(isFinishedDay({ ...live, declared: 'fasting' })).toBe(true);
    expect(isFinishedDay({ ...live, declared: null })).toBe(false);
    expect(isFinishedDay({ date: null, today: null, declared: null })).toBe(false);
  });
});

describe('budgetStory — live day', () => {
  it('Afford, free tier: the 2026-09-25 day reads 321 free, then the other prices and the total', () => {
    expect(say(budgetStory(day(1470), live))).toEqual({
      job: 'afford', value: 321, text: 'free', sub: 'then 311 workout · 500 deficit · 1,132 to break even',
    });
  });

  it('Afford with no workout: no workout price', () => {
    expect(budgetStory(day(1470, 0), live).sub).toBe('then 500 deficit · 821 to break even');
  });

  it('Afford with no break even known: only the workout price', () => {
    expect(budgetStory(day(1470, 311, { maintenance: 0 }), live).sub).toBe('then 311 workout');
  });

  it('Afford, workout tier: what is left of the workout leads', () => {
    expect(say(budgetStory(day(1900), live))).toEqual({
      job: 'afford', value: 202, text: 'of workout left', sub: 'used 109 of 311 · 500 deficit · 702 to break even',
    });
  });

  it('Contain, over plan: the distance to break even leads', () => {
    expect(say(budgetStory(day(2300, 311, { zone: 'over' }), live))).toEqual({
      job: 'contain', value: 302, text: 'to break even', sub: '198 over plan',
    });
  });

  it('Contain with no break even known: the overrun leads', () => {
    expect(say(budgetStory(day(2300, 311, { zone: 'over', maintenance: 0 }), live))).toEqual({
      job: 'contain', value: 198, text: 'over plan', sub: null,
    });
  });

  it('Contain, past break even', () => {
    expect(say(budgetStory(day(2800, 311, { zone: 'past-even' }), live))).toEqual({
      job: 'contain', value: 198, text: 'past break even', sub: '698 over plan',
    });
  });

  it('Trust (7 am, breakfast logged): the free number still leads, dimmed, and the sub-line says why', () => {
    const s = budgetStory(day(800, 0, { zone: 'incomplete' }), live);
    expect(say(s)).toEqual({ job: 'trust', value: 991, text: 'free', sub: '400 under the 1,200 floor · prices assume the log is complete' });
    expect(s.tentative).toBe(true);
  });

  it('a skipped meal makes an under-floor day trustworthy: Afford, not Trust', () => {
    expect(budgetStory(day(800, 0, { zone: 'declared', fastedMeals: ['morning'] }), live).job).toBe('afford');
  });
});

describe('budgetStory — finished day (Judge)', () => {
  it('free tier: on plan, workout banked', () => {
    expect(say(budgetStory(day(1470), past))).toEqual({
      job: 'judge', value: null, text: 'On plan', sub: 'workout banked (311) · ended 1,132 under break even',
    });
  });

  it('workout tier: on plan, part of the workout eaten back', () => {
    expect(budgetStory(day(1900), past).sub).toBe('ate back 109 of 311 workout · ended 702 under break even');
  });

  it('over plan: missed, with where the day ended against break even', () => {
    expect(say(budgetStory(day(2300, 311, { zone: 'over' }), past))).toEqual({
      job: 'judge', value: null, text: 'Missed plan by 198', sub: 'ended 302 under break even',
    });
  });

  it('past break even: a surplus', () => {
    expect(say(budgetStory(day(2800, 311, { zone: 'past-even' }), past))).toEqual({
      job: 'judge', value: null, text: 'Surplus of 198', sub: 'missed plan by 698',
    });
  });

  it('an unclosed past day under the floor has no verdict', () => {
    expect(say(budgetStory(day(700, 0, { zone: 'incomplete' }), past))).toEqual({
      job: 'judge', value: null, text: 'Incomplete log', sub: '700 logged, under the 1,200 floor · no verdict',
    });
  });

  it('a fasted day says so', () => {
    expect(say(budgetStory(day(0, 0, { zone: 'declared', declared: 'fasting' }), live))).toEqual({
      job: 'judge', value: null, text: 'Fasted', sub: 'ended 2,291 under break even',
    });
  });

  it('closing today as done judges it', () => {
    expect(budgetStory(day(1470, 311, { declared: 'done' }), live).job).toBe('judge');
  });
});

describe('budgetStory — pricing a portion while it is dragged', () => {
  it('the sub-line becomes what the change costs, in the bar\'s nouns', () => {
    expect(budgetStory(day(1900), { ...live, baseline: day(1470) }).sub).toBe('this costs 321 free + 109 workout');
  });

  it('a smaller portion gives kcal back', () => {
    expect(budgetStory(day(1270), { ...live, baseline: day(1470) }).sub).toBe('gives back 200');
  });

  it('an unchanged day keeps its own sub-line', () => {
    expect(budgetStory(day(1470), { ...live, baseline: day(1470) }).sub).toBe('then 311 workout · 500 deficit · 1,132 to break even');
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `npx vitest run frontend/src/modules/Health/today/budgetStory.test.js`
Expected: FAIL, `Failed to resolve import "./budgetStory.js"`.

**Step 3: Write the implementation**

```js
//
// The Today budget card, told as the job the person has right now
// (docs/_wip/plans/2026-09-25-health-budget-card-jobs.md):
//
//   trust    live, under the floor, not closed — the free number, dimmed
//   afford   live, within the plan — what is free, then what the rest costs
//   contain  live, past the plan — how far to break even
//   judge    finished (past date, or closed done/fasted) — the verdict
//
// One vocabulary everywhere: free, workout, deficit, to break even, over plan.
// Pure: the card, its tests and the drag preview all read the same sentence.
import { priceLadder, priceOf } from '@shared-contracts/health/budgetTiers.mjs';

const n = (v) => Math.round(Number(v || 0)).toLocaleString('en-US');
const join = (parts) => parts.filter(Boolean).join(' · ') || null;
const PRICE_WORDS = { free: 'free', workout: 'workout', deficit: 'deficit', over: 'over plan', gain: 'past break even' };

/** A past date, or a day declared done or fasted. A skipped meal does not finish a day. */
export function isFinishedDay({ date, today, declared }) {
  return Boolean(date && today && date < today) || declared === 'done' || declared === 'fasting';
}

// While a portion is being dragged, the sub-line prices the change.
function priceLine(budget, baseline) {
  const delta = Number(budget.food) - Number(baseline.food);
  if (!Number.isFinite(delta) || Math.round(delta) === 0) return null;
  if (delta < 0) return `gives back ${n(-delta)}`;
  return `this costs ${priceOf(baseline, delta).map(p => `${n(p.kcal)} ${PRICE_WORDS[p.key]}`).join(' + ')}`;
}

function judge({ lines: L, spend, over, gain, tiers }, budget) {
  const ended = L.even == null ? null : `ended ${n(L.even - L.food)} under break even`;
  if (budget.zone === 'incomplete') {
    return { value: null, text: 'Incomplete log', sub: `${n(L.food)} logged, under the ${n(L.floor)} floor · no verdict` };
  }
  if (spend === 'gain') return { value: null, text: `Surplus of ${n(gain)}`, sub: `missed plan by ${n(over)}` };
  if (spend === 'over') return { value: null, text: `Missed plan by ${n(over)}`, sub: ended };
  if (budget.declared === 'fasting') return { value: null, text: 'Fasted', sub: ended };
  const workout = tiers.find(t => t.key === 'workout');
  const spent = spend === 'workout'
    ? `ate back ${n(workout.used)} of ${n(L.exercise)} workout`
    : L.exercise > 0 ? `workout banked (${n(L.exercise)})` : null;
  return { value: null, text: 'On plan', sub: join([spent, ended]) };
}

function live({ lines: L, spend, over, gain, tiers }) {
  const tier = (key) => tiers.find(t => t.key === key);
  const deficit = tier('deficit');
  const workout = tier('workout');
  const toEven = L.even == null ? null : `${n(L.even - L.food)} to break even`;
  const deficitPrice = deficit ? `${n(deficit.left)} deficit` : null;
  if (spend === 'gain') return { value: gain, text: 'past break even', sub: `${n(over)} over plan` };
  if (spend === 'over') {
    return deficit
      ? { value: deficit.left, text: 'to break even', sub: `${n(over)} over plan` }
      : { value: over, text: 'over plan', sub: null };
  }
  if (spend === 'workout') {
    return { value: workout.left, text: 'of workout left', sub: join([`used ${n(workout.used)} of ${n(L.exercise)}`, deficitPrice, toEven]) };
  }
  const rest = join([workout && `${n(workout.left)} workout`, deficitPrice, toEven]);
  return { value: tier('free').left, text: 'free', sub: rest && `then ${rest}` };
}

/**
 * @param {object} budget - a day from the budget contract (range + zone required)
 * @param {{ date?: string, today?: string, baseline?: object|null }} [ctx]
 * @returns {{ job: 'trust'|'afford'|'contain'|'judge', value: number|null, text: string, sub: string|null,
 *   finished: boolean, tentative: boolean, ladder: object }}
 */
export function budgetStory(budget, { date = null, today = null, baseline = null } = {}) {
  const ladder = priceLadder(budget);
  const finished = isFinishedDay({ date, today, declared: budget.declared });
  // An unverified log still leads with the free number (the morning's Afford
  // job); the dimmed bar and the sub-line say it rests on a complete log.
  const tentative = !finished && budget.zone === 'incomplete';
  let job;
  let told;
  if (finished) { job = 'judge'; told = judge(ladder, budget); }
  else if (tentative) {
    const { lines: L, tiers } = ladder;
    job = 'trust';
    told = { value: tiers.find(t => t.key === 'free')?.left ?? 0, text: 'free',
      sub: `${n(L.floor - L.food)} under the ${n(L.floor)} floor · prices assume the log is complete` };
  } else {
    job = ladder.spend === 'over' || ladder.spend === 'gain' ? 'contain' : 'afford';
    told = live(ladder);
  }
  const priced = !finished && baseline ? priceLine(budget, baseline) : null;
  return { job, ...told, sub: priced ?? told.sub, finished, tentative, ladder };
}

export default budgetStory;
```

A check on the Afford sub-line: "then 311 workout · 500 deficit · 1,132 to break even". 311 + 500 = 811 is the priced tiers; 1,132 includes the 321 free. The total is what the old header called "deficit", so a reader can check the parts against it.

**Step 4: Run the test to verify it passes**

Run: `npx vitest run frontend/src/modules/Health/today/budgetStory.test.js`
Expected: PASS (20 tests).

**Step 5: Commit**

```bash
git add frontend/src/modules/Health/today/budgetStory.js frontend/src/modules/Health/today/budgetStory.test.js
git commit -m "feat(health): budgetStory — the budget card's headline follows the job at hand"
```

---

### Task 4: `budgetGeometry` draws tiers and the two plan marks

**Files:**
- Modify: `frontend/src/modules/Health/today/budgetGeometry.js` (whole file)
- Test: `frontend/src/modules/Health/today/budgetGeometry.test.js` (whole file)

**Step 1: Replace the test file**

This drops the band, hatch, run and "wordless break even" tests. Those elements no longer exist.

```js
import { describe, it, expect } from 'vitest';
import { budgetGeometry } from './budgetGeometry.js';

// The 2026-09-25 day: ceiling 1791 + 311 = 2102, break even 2291 + 311 = 2602.
const day = (over = {}) => ({
  food: 1470, exercise: 311, net: 1159, maintenance: 2291, range: { floor: 1200, top: 1791 },
  zone: 'in-range', remaining: 632, declared: null, ...over,
});
const close = (a, b) => expect(a).toBeCloseTo(b, 1);
const tier = (g, key) => g.tiers.find(t => t.key === key);

describe('budgetGeometry — the ruler is food, from 0', () => {
  it('12% headroom past the furthest line', () => {
    close(budgetGeometry(day(), { widthPx: 360 }).right, 2602 * 1.12);
  });

  it('food runs 0 → food eaten', () => {
    const g = budgetGeometry(day(), { widthPx: 360 });
    close(g.food.fromPct, 0);
    close(g.food.fromPct + g.food.widthPct, g.pct(1470));
  });

  it('the goal mark sits at the top and names the workout it grows by', () => {
    const g = budgetGeometry(day(), { widthPx: 360 });
    close(g.goal.pct, g.pct(1791));
    expect(g.goal.label).toBe('Goal 1,791 + 311');
    expect(budgetGeometry(day({ exercise: 0 }), { widthPx: 360 }).goal.label).toBe('Goal 1,791');
  });

  it('the ceiling is marked on exercise days, even once the workout tier is spent', () => {
    const g = budgetGeometry(day({ food: 2300, zone: 'over' }), { widthPx: 360 });
    expect(g.ceiling.value).toBe(2102);
    close(g.ceiling.pct, g.pct(2102));
    expect(budgetGeometry(day({ exercise: 0 }), { widthPx: 360 }).ceiling).toBeNull();
  });

  it('a plan capped at break even says so on the goal mark', () => {
    const g = budgetGeometry(day({ exercise: 0, maintenance: 1100, range: { floor: 1200, top: 1200 }, food: 900 }), { widthPx: 360 });
    expect(g.goal.label).toBe('Goal · break even 1,100');
  });

  it('break even at maintenance + exercise; none without maintenance', () => {
    const g = budgetGeometry(day(), { widthPx: 360 });
    expect(g.even.value).toBe(2602);
    close(g.even.pct, g.pct(2602));
    expect(budgetGeometry(day({ maintenance: 0 }), { widthPx: 360 }).even).toBeNull();
  });
});

describe('budgetGeometry — tiers are what is left, from the frontier on', () => {
  it('the 2026-09-25 day: free 1470→1791, workout 1791→2102, deficit 2102→2602', () => {
    const g = budgetGeometry(day(), { widthPx: 1700 });
    expect(g.tiers.map(t => t.key)).toEqual(['free', 'workout', 'deficit']);
    close(tier(g, 'free').fromPct, g.pct(1470));
    close(tier(g, 'free').fromPct + tier(g, 'free').widthPct, g.pct(1791));
    close(tier(g, 'workout').fromPct + tier(g, 'workout').widthPct, g.pct(2102));
    close(tier(g, 'deficit').fromPct + tier(g, 'deficit').widthPct, g.pct(2602));
    expect(g.tiers.map(t => t.label)).toEqual(['321 free', '311 workout', '500 deficit']);
    expect(g.tiers.map(t => t.shown)).toEqual(['321 free', '311 workout', '500 deficit']);
  });

  it('a spent tier is not drawn; a part-spent one starts at the frontier', () => {
    const g = budgetGeometry(day({ food: 1900 }), { widthPx: 1700 });
    expect(g.tiers.map(t => t.key)).toEqual(['workout', 'deficit']);
    close(tier(g, 'workout').fromPct, g.pct(1900));
    expect(tier(g, 'workout').label).toBe('202 workout');
  });

  it('a finished day names tiers as outcomes', () => {
    const g = budgetGeometry(day(), { widthPx: 1700, finished: true });
    expect(g.tiers.map(t => t.label)).toEqual(['321 unused', '311 banked', '500 deficit']);
  });

  it('past break even: no tiers', () => {
    expect(budgetGeometry(day({ food: 2800, zone: 'past-even' }), { widthPx: 360 }).tiers).toEqual([]);
  });

  it('on a phone, a tier too narrow for its words shows its number', () => {
    // 360px: free 321 kcal ≈ 39.7px, workout ≈ 38.4px, deficit ≈ 61.8px — all under 64, all over 30.
    const g = budgetGeometry(day(), { widthPx: 360 });
    expect(g.tiers.map(t => t.shown)).toEqual(['321', '311', '500']);
  });

  it('a tier too narrow even for its number shows nothing', () => {
    const g = budgetGeometry(day({ food: 1770 }), { widthPx: 360 }); // 21 kcal of free ≈ 2.6px
    expect(tier(g, 'free').shown).toBeNull();
  });
});

describe('budgetGeometry — ticks', () => {
  it('every 250, numbered at 1,000s on a phone, none within 12px of a named line', () => {
    // 360px, right = 2914.24: 1,750 is 5.1px from the top (dropped); 2,000 and 2,500
    // are 12.6px from the ceiling and break even (kept).
    const values = budgetGeometry(day(), { widthPx: 360 }).ticks.map(t => t.value);
    expect(values).toContain(1000);
    expect(values).not.toContain(1750);
    expect(values).toContain(2000);
    expect(values).toContain(2500);
  });

  it('never ticks 0', () => {
    expect(budgetGeometry(day(), { widthPx: 360 }).ticks.some(t => t.value <= 0)).toBe(false);
  });
});

describe('budgetGeometry — the eaten label fits or moves out', () => {
  it('inside at ≥70px', () => {
    const g = budgetGeometry(day(), { widthPx: 360 });
    expect(g.food).toMatchObject({ labelled: true, outside: false, value: 1470 });
  });

  it('a short block carries it just past the frontier', () => {
    const g = budgetGeometry(day({ exercise: 0, food: 400, zone: 'incomplete' }), { widthPx: 280 });
    expect(g.food.outside).toBe(true);
  });

  it('nothing eaten, no label', () => {
    expect(budgetGeometry(day({ food: 0, zone: 'incomplete' }), { widthPx: 360 }).food.labelled).toBe(false);
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `npx vitest run frontend/src/modules/Health/today/budgetGeometry.test.js`
Expected: FAIL. `g.goal`, `g.ceiling` and `g.tiers` are undefined.

**Step 3: Replace `budgetGeometry.js`**

```js
//
// The Today budget bar as a labelled ruler — pure geometry, so the numbers the
// bar paints can be pinned in a test (jsdom cannot measure a rendered bar).
//
// The ruler is FOOD eaten, from 0. The food block runs 0 → food; what is left
// is drawn ahead of it as the price tiers from budgetTiers.mjs (free, workout,
// deficit), each starting at the frontier or its own start, whichever is
// later, so a spent tier disappears and a part-spent one shrinks. Two plan
// marks stay put: the goal at the top, and on exercise days the ceiling
// (top + exercise) that "over plan" counts from. Break even sits below.

import { priceLadder } from '@shared-contracts/health/budgetTiers.mjs';

export const TICK_STEP = 250;
const HEADROOM = 1.12;
const TICK_CLEARANCE_PX = 12;
const FOOD_LABEL_PX = 70;
const TIER_WORDS_PX = 64;
const TIER_NUMBER_PX = 30;
const WIDE_PX = 600;

const LIVE_WORDS = { free: 'free', workout: 'workout', deficit: 'deficit' };
const FINISHED_WORDS = { free: 'unused', workout: 'banked', deficit: 'deficit' };

export const fmt = (v) => Math.round(v).toLocaleString('en-US');

/**
 * @param {object} budget - a day from the budget contract (range, zone, food, exercise, maintenance)
 * @param {{ widthPx?: number, finished?: boolean }} [opts] - track width for label fit; finished names tiers as outcomes
 */
export function budgetGeometry(budget, { widthPx = 360, finished = false } = {}) {
  const { lines, tiers: ladder } = priceLadder(budget);
  const { food, exercise, top, ceiling, even, capped } = lines;

  const right = Math.max(even ?? 0, food, ceiling, 1) * HEADROOM;
  const pxPerKcal = widthPx / right;
  const pct = (v) => (Math.min(Math.max(v, 0), right) / right) * 100;
  const segment = (from, to) => ({ fromPct: pct(Math.min(from, to)), widthPct: Math.abs(pct(to) - pct(from)) });

  const named = [top, ...(exercise > 0 ? [ceiling] : []), ...(even != null ? [even] : [])];
  const labelEvery = widthPx >= WIDE_PX ? 500 : 1000;
  const ticks = [];
  for (let v = TICK_STEP; v < right; v += TICK_STEP) {
    if (named.some((m) => Math.abs(m - v) * pxPerKcal < TICK_CLEARANCE_PX)) continue;
    ticks.push({ value: v, pct: pct(v), label: v % labelEvery === 0 ? fmt(v) : null });
  }

  // "N eaten" ends at the frontier; a block too short for it carries the label
  // just past the frontier instead of dropping it.
  const foodPx = food * pxPerKcal;
  const outside = foodPx < FOOD_LABEL_PX;
  const foodSeg = { ...segment(0, food), value: food, labelled: food > 0, outside };
  const foodLabel = outside ? [foodPx, foodPx + FOOD_LABEL_PX] : [foodPx - FOOD_LABEL_PX, foodPx];

  // A tier shows "321 free" where it fits, "321" where only the number fits,
  // and nothing below that or where the eaten label (drawn above) covers it.
  const words = finished ? FINISHED_WORDS : LIVE_WORDS;
  const tiers = ladder.filter(t => t.left > 0).map((t) => {
    const from = Math.max(t.from, food);
    const widthOfTier = (t.to - from) * pxPerKcal;
    const midPx = ((from + t.to) / 2) * pxPerKcal;
    const label = `${fmt(t.left)} ${words[t.key]}`;
    const fits = (px) => widthOfTier >= px
      && !(foodSeg.labelled && midPx - px / 2 < foodLabel[1] && foodLabel[0] < midPx + px / 2);
    const shown = fits(TIER_WORDS_PX) ? label : fits(TIER_NUMBER_PX) ? fmt(t.left) : null;
    return { ...segment(from, t.to), key: t.key, left: t.left, label, shown };
  });

  const goalLabel = capped ? `Goal · break even ${fmt(top)}`
    : exercise > 0 ? `Goal ${fmt(top)} + ${fmt(exercise)}` : `Goal ${fmt(top)}`;

  return {
    right, pct, ticks, tiers, zone: budget.zone,
    goal: { pct: pct(top), value: top, label: goalLabel },
    ceiling: exercise > 0 && ceiling > top ? { pct: pct(ceiling), value: ceiling } : null,
    even: even != null ? { pct: pct(even), value: even } : null,
    food: foodSeg,
  };
}

export default budgetGeometry;
```

**Step 4: Run the test to verify it passes**

Run: `npx vitest run frontend/src/modules/Health/today/budgetGeometry.test.js`
Expected: PASS.

`EquationStrip.test.jsx` **will now fail** (it still reads `band`, `earned` and `run`). Task 5 fixes it. Do not commit yet.

---

### Task 5: `EquationStrip` renders the story and the tiers

**Files:**
- Modify: `frontend/src/modules/Health/today/EquationStrip.jsx` (`BudgetBar`, `RulerScale`, `EquationStrip` props)
- Modify: `frontend/src/modules/Health/health.scss` (the two `.health-budget` blocks, lines ~20-140)
- Modify: `frontend/src/modules/Health/today/TodayView.jsx:446-449` (pass `baseline`)
- Test: `frontend/src/modules/Health/today/EquationStrip.test.jsx` (replace the describe blocks `'EquationStrip — the ruler'` and `'EquationStrip — the headline names its segment'`)
- Test: `frontend/src/modules/Health/today/EquationStrip.geometry.test.js` (fixture HTML)

**Step 1: Replace the two ruler/headline describe blocks in `EquationStrip.test.jsx`**

Leave `'EquationStrip — budget bar'` (legacy, no `range`) and `'EquationStrip — macros'` untouched. They pin the older-server fallback. The dropped `'a negative net is stated with a minus'` test goes on purpose: the ranged terms line no longer prints net.

```jsx
describe('EquationStrip — the card follows the job', () => {
  const ranged = { budget: 1791, maintenance: 2291, range: { floor: 1200, top: 1791 }, declared: null, status: 'under' };
  const live = { date: '2026-09-25', today: '2026-09-25' };
  const sept25 = { ...ranged, food: 1470, exercise: 311, net: 1159, zone: 'in-range', remaining: 632 };

  it('Afford: the 2026-09-25 day reads 321 free and prices the rest', () => {
    strip({ ...live, budget: sept25 });
    expect(screen.getByTestId('budget-headline').textContent).toMatch(/321\s*kcal free/);
    expect(screen.getByTestId('budget-sub').textContent).toBe('then 311 workout · 500 deficit · 1,132 to break even');
    for (const key of ['free', 'workout', 'deficit']) expect(screen.getByTestId(`budget-tier-${key}`)).toBeTruthy();
    expect(screen.getByTestId('budget-ruler').getAttribute('aria-label'))
      .toBe('1,470 kcal eaten; 321 free, 311 workout, 500 deficit; break even 2,602; 321 kcal free');
  });

  it('the terms line is only what was eaten and burned', () => {
    strip({ ...live, budget: sept25 });
    const terms = screen.getByTestId('budget-terms').textContent;
    expect(terms).toContain('1,470 eaten');
    expect(terms).toContain('311 burned');
    expect(terms).not.toMatch(/net|deficit|surplus/);
  });

  it('the goal, ceiling and break even are marked at their values', () => {
    const { container } = strip({ ...live, budget: sept25 });
    expect(container.querySelector('.health-budget__goal-label').textContent).toBe('Goal 1,791 + 311');
    expect(container.querySelector('.health-budget__ceiling-line')).toBeTruthy();
    expect(container.querySelector('.health-budget__even-label').textContent).toBe('Break even 2,602');
  });

  it('Trust: under the floor, the free number leads and the ruler is dimmed', () => {
    const { container } = strip({ ...live, budget: { ...ranged, food: 800, exercise: 0, net: 800, zone: 'incomplete', remaining: 991 } });
    expect(screen.getByTestId('budget-headline').textContent).toMatch(/991\s*kcal free/);
    expect(screen.getByTestId('budget-sub').textContent).toBe('400 under the 1,200 floor · prices assume the log is complete');
    expect(container.querySelector('.health-budget__ruler--tentative')).toBeTruthy();
  });

  it('Contain: past the plan, the headline counts down to break even and the ceiling stays marked', () => {
    const { container } = strip({ ...live, budget: { ...sept25, food: 2300, net: 1989, zone: 'over', remaining: 198, status: 'over' } });
    expect(screen.getByTestId('budget-headline').textContent).toMatch(/302\s*kcal to break even/);
    expect(screen.getByTestId('budget-sub').textContent).toBe('198 over plan');
    expect(container.querySelector('.health-budget__ceiling-line')).toBeTruthy();
  });

  it('Judge: a past day gives a verdict and names tiers as outcomes', () => {
    const { container } = strip({ budget: sept25 }); // strip() defaults to a past date
    expect(screen.getByTestId('budget-headline').textContent).toBe('On plan');
    expect(screen.getByTestId('budget-ruler').getAttribute('aria-label')).toContain('321 unused, 311 banked, 500 deficit');
    expect(container.querySelector('.health-budget__ruler--finished')).toBeTruthy();
  });

  it('while a portion is dragged, the sub-line prices it', () => {
    strip({ ...live, baseline: sept25, budget: { ...sept25, food: 1900, net: 1589, remaining: 202 } });
    expect(screen.getByTestId('budget-sub').textContent).toBe('this costs 321 free + 109 workout');
  });

  it('the eaten label rides above every tier, its right edge on the frontier', () => {
    strip({ ...live, budget: sept25 });
    const label = screen.getByTestId('budget-food-label');
    expect(label.textContent).toBe('1,470 eaten');
    const food = screen.getByTestId('budget-food');
    expect(parseFloat(label.style.right)).toBeCloseTo(100 - (parseFloat(food.style.left) + parseFloat(food.style.width)), 1);
  });

  it('no exercise: no workout tier and no ceiling mark', () => {
    const { container } = strip({ ...live, budget: { ...ranged, food: 1470, exercise: 0, net: 1470, zone: 'in-range', remaining: 321 } });
    expect(screen.queryByTestId('budget-tier-workout')).toBeNull();
    expect(container.querySelector('.health-budget__ceiling-line')).toBeNull();
  });

  it('a budget without a range keeps the legacy bar', () => {
    strip({ ...live, budget: { budget: 1791, maintenance: 2291, food: 1000, exercise: 0, remaining: 791, status: 'under' } });
    expect(screen.queryByTestId('budget-ruler')).toBeNull();
    expect(screen.queryByTestId('budget-sub')).toBeNull();
  });
});
```

**Step 2: Run to see it fail**

Run: `npx vitest run frontend/src/modules/Health/today/EquationStrip.test.jsx`
Expected: FAIL on the new block (no `budget-sub`, no tiers). The legacy and macro blocks still pass.

**Step 3: Rewrite `BudgetBar` and `RulerScale` in `EquationStrip.jsx`**

Replace the `headlineFor` import with:

```js
import { budgetStory } from './budgetStory.js';
```

After this change nothing in the file uses `headlineFor`. Other modules still use it (`dayBars.js`, `reportCaption.mjs`, `CoachingMessageBuilder.mjs`), so it stays exported from `budgetZone.mjs`.

Replace `BudgetBar` (and its doc comment) with the following. The legacy scale block is inlined verbatim from the current file:

```jsx
/**
 * The day's calories. A budget with a range and zone is told as the job at
 * hand (budgetStory.js) over a ruler of what is left, priced by tier
 * (RulerScale). A budget from an older server keeps the two-mark bar of NET
 * calories: green to the goal, amber to break even, red past it, with the
 * terms line stating net and the deficit.
 * Nothing here is shown as a negative except the legacy net term.
 */
// Room past the furthest mark, so the break-even label and a small surplus fit.
const HEADROOM = 1.12;
function BudgetBar({ budget, baseline = null, date = null, today = null, dayClose = null }) {
  const goal = Number(budget.budget) || 0;
  const breakEven = Number(budget.maintenance) || 0;
  const exercise = Math.max(0, Number(budget.exercise) || 0);
  const food = Math.max(0, Number(budget.food) || 0);
  // The legacy bar paints from 0; its terms line states the real net, which a
  // big workout can take below zero.
  const net = Math.max(0, food - exercise);
  const realNet = food - exercise;
  const over = budget.status === 'over';
  const story = budget.range && budget.zone ? budgetStory(budget, { date, today, baseline }) : null;
  const job = story?.job ?? null;
  useEffect(() => {
    if (job) logger.debug('budget-card.job', { job, date, spend: story.ladder.spend, finished: story.finished });
    // Once per job change, not per render or per drag frame.
  }, [job, date]); // eslint-disable-line react-hooks/exhaustive-deps
  const headline = story || { value: Math.abs(budget.remaining), text: over ? 'over goal' : 'left', sub: null };
  const spoken = headline.value == null ? headline.text : `${n(headline.value)} kcal ${headline.text}`;
  const scale = Math.max(goal, breakEven, food) * HEADROOM;
  const band = (from, to) => ({ left: pct(from, scale), width: pct(Math.max(0, to - from), scale) });
  // A mark's label hangs off the side of its line with more room.
  const mark = (value, cls, label) => <span className={`health-budget__mark health-budget__mark--${cls}${value / scale > 0.5 ? ' health-budget__mark--end' : ''}`}
    style={{ left: pct(value, scale) }}><span className="health-budget__mark-label">{label} <b>{n(value)}</b></span></span>;
  const sameMark = breakEven > 0 && Math.round(breakEven) === Math.round(goal);
  const balance = breakEven > 0 ? breakEven - realNet : null;
  const headlineClass = ['health-budget__headline',
    budget.zone && `health-budget__headline--${budget.zone}`,
    job && `health-budget__headline--job-${job}`].filter(Boolean).join(' ');
  return (
    <div className="health-budget">
      <div className="health-budget__head">
        <span className="health-budget__lead">
          <span className={headlineClass} data-testid="budget-headline">
            {headline.value == null ? headline.text : <><strong>{n(headline.value)}</strong> kcal {headline.text}</>}
          </span>
          {story?.sub ? <span className="health-budget__sub" data-testid="budget-sub">{story.sub}</span> : null}
        </span>
        <span className="health-budget__terms" data-testid="budget-terms">
          <span>{n(food)} eaten</span>
          {exercise > 0 ? <><span className="health-budget__sep" aria-hidden="true">·</span>
            <span className="health-budget__exercise-term">{n(exercise)} burned</span></> : null}
          {/* Net and the deficit are the ruler's tiers now; only the legacy bar states them. */}
          {!story && exercise > 0 ? <><span className="health-budget__sep" aria-hidden="true">·</span>
            <span>{realNet < 0 ? `−${n(-realNet)}` : n(realNet)} net</span></> : null}
          {!story && balance != null ? <><span className="health-budget__sep" aria-hidden="true">·</span>
            <span className={balance >= 0 ? 'health-budget__deficit' : 'health-budget__surplus'}>{balance >= 0 ? `${n(balance)} deficit` : `${n(-balance)} surplus`}</span></> : null}
          {budget.stale ? <span className="health-equation__stale" title="Latest weigh-in is over a week old">stale wt</span> : null}
        </span>
        {dayClose}
      </div>
      {story ? <RulerScale budget={budget} spoken={spoken} finished={story.finished} tentative={story.tentative} /> : (
      <div className="health-budget__scale">
        <div className="health-budget__track" role="img"
          aria-label={`${n(net)} net kcal of ${n(goal)} goal${breakEven ? `, break even ${n(breakEven)}` : ''}, ${spoken}`}>
          {exercise > 0 ? <span className="health-budget__burned" style={band(net, food)} /> : null}
          <span className="health-budget__net" style={band(0, Math.min(net, goal))} />
          {net > goal ? <span className="health-budget__over-goal" style={band(goal, breakEven > goal ? Math.min(net, breakEven) : net)} /> : null}
          {breakEven > goal && net > breakEven ? <span className="health-budget__surplus-fill" style={band(breakEven, net)} /> : null}
        </div>
        {mark(goal, 'goal', sameMark ? 'Goal · break even' : 'Goal')}
        {breakEven > 0 && !sameMark ? mark(breakEven, 'even', 'Break even') : null}
      </div>
      )}
    </div>
  );
}
```

Add the logger at module scope, below the imports (same path `usePortionDraft.js` uses):

```js
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';

const logger = createAppLogger('health').child('budget-card');
```

`useEffect` is already imported. `BudgetBar` has no early return, so the hook is unconditional.

The legacy aria-label's `spoken` now includes "kcal" ("419 kcal left"). The legacy test regex `/1,372 net kcal of 1,791 goal, break even 2,291/` has no end anchor, so it still matches. The legacy headline still reads "419 kcal left" and "700 kcal over goal", because those tests go through `headline.value`/`headline.text`, not `spoken`.

Replace `RulerScale` with:

```jsx
/**
 * The budget as a labelled ruler of FOOD eaten (budgetGeometry.js): the food
 * block from 0, whose right edge is the frontier, coloured by zone; ahead of it
 * the price tiers of what is left (free, workout, deficit); the goal mark at
 * the top, a ceiling mark at top + exercise, and break even below. Tentative
 * (an unverified log) dims the tiers; finished recolours the deficit as won.
 */
function RulerScale({ budget, spoken, finished, tentative }) {
  const ref = useRef(null);
  const g = budgetGeometry(budget, { widthPx: useWidth(ref), finished });
  const { goal, ceiling, even, food, tiers, zone } = g;
  const priced = tiers.map(t => t.label).join(', ') || 'nothing left on plan';
  const rulerClass = ['health-budget__ruler', tentative && 'health-budget__ruler--tentative', finished && 'health-budget__ruler--finished']
    .filter(Boolean).join(' ');
  return (
    <div className={rulerClass} ref={ref}>
      <div className="health-budget__rail health-budget__rail--above">
        <span className={`health-budget__goal-label${endAnchored(goal.pct)}`} style={{ left: at(goal.pct) }}>{goal.label}</span>
      </div>
      <div className="health-budget__track health-budget__track--ruler" role="img" data-testid="budget-ruler"
        aria-label={`${n(food.value)} kcal eaten; ${priced}${even ? `; break even ${n(even.value)}` : ''}; ${spoken}`}>
        <span className={`health-budget__food health-budget__food--${zone}`} data-testid="budget-food" style={{ left: at(food.fromPct), width: at(food.widthPct) }} />
        {tiers.map(t => <span key={t.key} className={`health-budget__tier health-budget__tier--${t.key}`} data-testid={`budget-tier-${t.key}`}
          style={{ left: at(t.fromPct), width: at(t.widthPct) }}>
          {t.shown ? <span className="health-budget__seg-label">{t.shown}</span> : null}</span>)}
        <span className="health-budget__goal-line" style={{ left: at(goal.pct) }} />
        {ceiling ? <span className="health-budget__ceiling-line" style={{ left: at(ceiling.pct) }} /> : null}
        {/* Its own top layer, not a child of the food block: the plan marks and
            break even stack above the food and would cut through it. */}
        {food.labelled ? <span className={`health-budget__food-label health-budget__food-label--${food.outside ? 'outside' : zone}`} data-testid="budget-food-label"
          style={food.outside ? { left: at(food.fromPct + food.widthPct) } : { right: at(100 - (food.fromPct + food.widthPct)) }}>{n(food.value)} eaten</span> : null}
        {even ? <span className="health-budget__even" style={{ left: at(even.pct) }} /> : null}
      </div>
      <div className="health-budget__rail health-budget__ticks" aria-hidden="true">
        {g.ticks.map(t => <span key={t.value} className="health-budget__tick" style={{ left: at(t.pct) }}>
          {t.label ? <span className="health-budget__tick-label">{t.label}</span> : null}</span>)}
      </div>
      {even ? <div className="health-budget__rail health-budget__rail--below">
        <span className={`health-budget__even-label${endAnchored(even.pct)}`} style={{ left: at(even.pct) }}>Break even <b>{n(even.value)}</b></span>
      </div> : null}
    </div>
  );
}
```

Update the `EquationStrip` export signature and its `BudgetBar` call:

```jsx
export function EquationStrip({ budget, baseline = null, budgetError, macroCoverage, goals, date, today, onDateChange, onSetupGoals, dayClose = null }) {
  // …
          <BudgetBar budget={budget} baseline={baseline} date={date} today={today} dayClose={dayClose} />
```

**Step 4: Pass the pre-drag budget from TodayView**

`frontend/src/modules/Health/today/TodayView.jsx:446`: add `baseline={day.budget}` to `<EquationStrip …>`. `day.budget` is the read model before the portion overlay (`usePortionDraft` projects `preview.budget` from it). With no draft, both have the same `food`, so no price line appears.

**Step 5: SCSS**

In `frontend/src/modules/Health/health.scss`:

*First `.health-budget` block (line ~21, the head row):*

```scss
  &__lead { display: flex; flex-direction: column; min-width: 0; }
  &__sub { font-size: 0.78rem; line-height: 1.2; color: var(--ds-text-mid); font-variant-numeric: tabular-nums; }
  // A verdict has no number to colour; the text itself carries the zone.
  &__headline--job-judge { font-size: 1.05rem; font-weight: 600; color: var(--ds-text-high); }
```

After the existing `@media (max-width: 760px)` block (line ~159), add a wide-screen rule that puts the sub-line beside the headline. This keeps the card within the geometry harness's 140px height at the 800px case:

```scss
@media (min-width: 761px) {
  .health-budget__lead { flex-direction: row; align-items: baseline; gap: 0 0.6rem; flex-wrap: wrap; }
}
```

*Second `.health-budget` block (the ruler, line ~65):*

- Judge colours: next to the existing `&__headline--… strong` rules, add
  ```scss
  &__headline--job-judge.health-budget__headline--over { color: var(--health-zone-over); }
  &__headline--job-judge.health-budget__headline--past-even { color: var(--health-zone-past); }
  &__headline--job-judge.health-budget__headline--incomplete { color: var(--health-zone-incomplete); }
  ```
- In the label selector group, rename `&__band-label` to `&__goal-label`:
  ```scss
  &__goal-label, &__even-label, &__tick-label { …unchanged… }
  &__goal-label { bottom: 3px; text-transform: uppercase; transform: translateX(-50%); }
  &__goal-label.health-budget__label--end { transform: translateX(-100%); }
  ```
- Change the absolute-position group to `&__tier, &__food, &__even, &__goal-line, &__ceiling-line { position: absolute; top: 0; bottom: 0; }`.
- **Delete** `&__band`, `&__band-edges`, `&__earned` (and `&__earned &__seg-label`), `&__run`, `&__run--over, &__run--past-even`, and their comments.
- **Add**:
  ```scss
  // The ceiling (top + exercise): where "over plan" counts from. Dashed, so it
  // reads as the goal moved by the workout rather than a second goal.
  &__ceiling-line { width: 0; margin-left: -1px; border-left: 2px dashed var(--ds-text-high); z-index: 3; opacity: 0.8; }
  // What is left, priced. Free is a success wash; the workout keeps the old
  // credit hatch (allowance, not intake); the live deficit is a warning wash —
  // eating into it costs the day's progress.
  &__tier {
    z-index: 1; display: flex; align-items: center; justify-content: center; overflow: hidden;
    &--free { background: color-mix(in srgb, var(--ds-success) 18%, transparent); }
    &--workout {
      outline: 1px solid color-mix(in srgb, var(--ds-success) 60%, transparent); outline-offset: -1px;
      background: repeating-linear-gradient(135deg,
        color-mix(in srgb, var(--ds-background) 55%, transparent) 0 3px,
        color-mix(in srgb, var(--ds-success) 35%, transparent) 3px 6px);
    }
    &--deficit { background: color-mix(in srgb, var(--ds-warning) 14%, transparent); }
  }
  &__tier &__seg-label { color: var(--ds-text-high); background: var(--ds-surface-alt); border-radius: 3px; padding: 2px 0.3rem; }
  // An unverified log: the prices are only right if the log is complete.
  &__ruler--tentative &__tier { opacity: 0.45; }
  // A finished day's unspent deficit is the win, green like the legacy
  // "N deficit" term (&__deficit) — not a warning.
  &__ruler--finished &__tier--deficit { background: color-mix(in srgb, var(--ds-success) 14%, transparent); }
  ```
- Reword the comment block above the ruler's `.health-budget` to describe tiers and the two plan marks instead of the band, hatch and run.

**Step 6: Update the static layout harness fixture**

In `EquationStrip.geometry.test.js`, replace the fixture's `health-budget__headline` span with the new lead structure, so the overflow and height checks cover the extra line:

```html
<span class="health-budget__lead"><span class="health-budget__headline"><strong>10,000</strong> kcal free</span>
  <span class="health-budget__sub">then 2,345 workout · 12,345 deficit · 22,345 to break even</span></span>
```

and drop the `net` and `deficit` terms from the fixture's terms span. Keep the `height` limits unchanged.

**The case at risk is 800px (limit 140).** A stacked sub-line measured 148.2px there in review, against 134.2 before. The `min-width: 761px` rule above puts the sub beside the headline to fix that. If 800 still exceeds 140, tighten the CSS (the sub's line-height, the head's row gap); don't loosen the number. At 390px the stacked layout measured 186.6 against a 220 limit, so that case has room.

**Step 7: Run all the budget suites**

Run:
```bash
npx vitest run shared/contracts/health frontend/src/modules/Health/today/budgetStory.test.js frontend/src/modules/Health/today/budgetGeometry.test.js frontend/src/modules/Health/today/EquationStrip.test.jsx frontend/src/modules/Health/today/EquationStrip.geometry.test.js frontend/src/modules/Health/today/TodayView.test.jsx
```
Expected: all PASS. `TodayView.test.jsx` uses a budget without `range`, so it stays on the legacy path. Its `'1,840 kcal left'` assertion must still pass.

**Step 8: Commit**

```bash
git add frontend/src/modules/Health/today/budgetGeometry.js frontend/src/modules/Health/today/budgetGeometry.test.js \
  frontend/src/modules/Health/today/EquationStrip.jsx frontend/src/modules/Health/today/EquationStrip.test.jsx \
  frontend/src/modules/Health/today/EquationStrip.geometry.test.js frontend/src/modules/Health/today/TodayView.jsx \
  frontend/src/modules/Health/health.scss
git commit -m "feat(health): the budget bar prices what is left — free, workout, deficit — and its headline follows the job"
```

---

### Task 6: Check the full Health suite

The logging event landed in Task 5 (`budget-card.job`, debug level, once per job change). This task makes sure nothing else in Health depended on what was removed.

**Step 1:** Run: `npx vitest run frontend/src/modules/Health shared/contracts/health`
Expected: all PASS.

**Step 2:** Grep for leftovers. Both must print nothing:
```bash
grep -rn "budget-earned\|budget-run\|__band\b\|__band-\|__earned\|__run\b\|__run--" frontend/src/modules/Health
grep -rn "wordless" frontend/src/modules/Health
```

**Step 3:** Commit only if Step 2 required fixes.

---

### Task 7: Docs

**Files:**
- Modify: `docs/reference/health/README.md`. Replace the **"The bar is a labelled ruler"** bullet list and the headline paragraph that follows it (approx. lines 179-215).

**Step 1: Rewrite that section.** It must state:

- The card's four jobs (trust / afford / contain / judge), when each leads (`budgetStory.js`), that Trust still leads with the free number, and that a skipped meal makes a day trustworthy but does **not** finish it.
- The tiers (`shared/contracts/health/budgetTiers.mjs`): free (0 → top), workout (top → top + exercise), deficit (ceiling → maintenance + exercise). Tiers are capped at break even, and `priceLadder` agrees with `zoneFor` (pinned by a 1-kcal sweep test).
- The single vocabulary (free, workout, deficit, to break even, over plan) and that the Afford sub-line always ends with the total to break even.
- The marks: goal at the top labelled "Goal 1,791 + 311" on exercise days, a dashed ceiling mark "over plan" counts from, break even below.
- Colour: the deficit tier is a warning wash while live (spending it costs progress) and green once the day is finished (the unspent deficit is the win, matching the legacy green "N deficit").
- The zones contract is unchanged, and which consumers still read it (nutribot `reportCaption`, `CoachingMessageBuilder`, week strip, month block, health-coach tool).
- The terms line is now only eaten · burned. Net and the deficit are tiers, and only the legacy bar still prints them.
- The finished-day wording (including "Fasted"), and the drag price line.
- The `budget-card.job` debug event.

Also fix the stale sentence in that section that claims `EquationStrip.jsx` "destructures `budget.budget` … `budget.status`". Say that the ranged path reads `range`, `zone`, `food`, `exercise`, `maintenance` and `declared`, and that the legacy path reads the aliases.

**Step 2: Link the plan from the README section** ("Design: `docs/_wip/plans/2026-09-25-health-budget-card-jobs.md`").

**Step 3: Commit**

```bash
git add docs/reference/health/README.md
git commit -m "docs(health): the budget card by job — tiers, verdicts, drag price"
```

---

### Task 8: See it

Tests pin the numbers; they cannot show crowding or colour. Use `superpowers:verification-before-completion`.

**Step 1:** Check for a running dev server: `lsof -i :3111`. **Do not start a second backend** (see `CLAUDE.local.md`). If none is running, skip to Step 3.

**Step 2:** In the browser at `http://localhost:3111/health`, screenshot the Today card at 390px and 1440px width, **in both light and dark mode**, for:
- today (Afford, or Trust if little has been logged: check the dimmed tiers are still visible)
- a past day with a workout (`?date=YYYY-MM-DD`): Judge, tiers reading unused / banked, deficit tier green
- a portion drag on today: the sub-line changes to "this costs …"

In dark mode, check specifically that the solid green food block is distinguishable from the 18% green free wash, and that the 0.45-opacity tentative tiers don't disappear.

**Step 3 (no dev server):** Run the static harness with screenshots on:
```bash
HEALTH_SUMMARY_SCREENSHOTS=1 npx vitest run frontend/src/modules/Health/today/EquationStrip.geometry.test.js
```
and inspect `/tmp/health-summary-*.png`. This covers layout only, not tier colours or dark mode. Say so in the handoff.

**Step 4:** Report what was seen, not what was expected. Include which tiers showed words vs numbers at 390px.

---

## Not in this plan (and why)

- **Week strip / month block wording.** `dayBars.barCellLabel` still says "N kcal left" (via `headlineFor`) in each cell's accessible label. That chart plots **net** against the goal, so its wording matches its picture. Moving it to tiers means redesigning the week chart, which is a separate piece of work.
- **Coach and nutribot copy** (`CoachingMessageBuilder`, `reportCaption`) keep `headlineFor`. They are text channels with their own voice. Changing them is a product decision, not something that follows from this card.
- **Exercise-estimate confidence** (source, partial syncs) and **maintenance confidence**. These came out of the jobs analysis as real gaps. They need data the budget contract does not carry, so they need their own plan.

---

## Review changes (2026-09-25)

A Fable agent reviewed the first draft. It re-ran every expectation by hand, confirming the `zoneFor` sweep at 1-kcal steps (exercise 0/311/1600 and the capped case), the tick claims, the aliases, the hook placement and the legacy path. Changes folded in:

| Finding | Change |
|---|---|
| The ceiling (2,102), which "over plan" measures from, had no mark once the workout tier was spent | Dashed ceiling mark on exercise days; goal label reads "Goal 1,791 + 311" |
| The deficit tier was warning-coloured, contradicting the legacy green "N deficit" | Warning while live; green on a finished day (`--finished`) |
| The geometry harness would fail at 800px (148 vs 140) with a stacked sub-line | Sub-line sits beside the headline from 761px; Step 6 names the 800 case |
| Trust led every morning ("Log looks light" at breakfast), hiding the Afford number | Trust keeps the free number as the headline, dimmed; the sub-line explains |
| Three nouns for one tier, and "500 more before you gain" read as absolute | One vocabulary; the Afford sub-line ends with the total to break even |
| Every tier label dropped at phone width | Bare numbers when words don't fit (≥30px) |
| "202 kcal left on plan" switched nouns | "202 kcal of workout left" |
| A fasted day read "On plan" | "Fasted" verdict |
| Judge headlines had no colour | Verdict styling, with over / past-even / incomplete colours |
| A capped plan read "Goal 1,100" against a configured 1,200 | "Goal · break even 1,100" |
| Dark mode was unchecked | Task 8 screenshots both modes |
| Legacy JSX was left as a "keep verbatim" placeholder | Inlined |
