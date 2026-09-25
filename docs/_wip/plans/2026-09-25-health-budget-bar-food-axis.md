# Health Budget Bar on a Food Axis — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redraw the Today budget ruler so every block and label sits at the value it names: food eaten from 0, and exercise raises the ceiling instead of shifting the floor.

**Architecture:** `budgetGeometry.js` is the pure geometry for the ruler. Today it plots NET calories on an axis that opens below zero on exercise days. It draws the food block from −exercise with a hatch over its first `exercise` kcal, and moves the goal band's left edge to `floor − exercise`. The result is a "558 eaten" label on a block 247 wide and a "Goal 1,200–1,791" label over a band that starts at 889. The rewrite plots FOOD from 0. The floor stays where it is (it already measures food), and the top and break-even shift right by `exercise`. A hatched "+N" block fills `top → top + exercise`. The server's zones and `remaining` are unchanged, and each one maps exactly onto the new axis, so the dotted run's length in kcal equals the headline number.

**Tech Stack:** React (JSX), SCSS, Vitest + Testing Library (jsdom).

---

## Background the engineer needs

### The numbers (all from the server; do not recompute zones client-side)

A day's `budget` object carries:

| Field | Meaning |
|---|---|
| `food` | kcal eaten |
| `exercise` | kcal burned in workouts |
| `net` | `food − exercise` (can be negative) |
| `maintenance` | break-even (TDEE), compared against NET |
| `range.floor` | logging-completeness floor, compared against FOOD |
| `range.top` | the goal ceiling, compared against NET |
| `zone` | `incomplete` / `in-range` / `declared` / `over` / `past-even` |
| `remaining` | the headline number (see zone table in `docs/reference/health/README.md`) |

### The food-axis identities this plan relies on

Moving the net comparisons onto the food scale adds `exercise` to both sides:

```
net ≤ top          ⇔  food ≤ top + exercise          (call top + exercise the CEILING)
net ≤ maintenance  ⇔  food ≤ maintenance + exercise  (break-even on the food scale)
food ≥ floor       (unchanged — the floor already measures food)
```

So on the food axis:

| Zone | `remaining` | Run on the food axis | Length (kcal) |
|---|---|---|---|
| `incomplete`, `in-range` | `top − net` | food → ceiling | `ceiling − food` = `top − net` ✓ |
| `over` | `net − top` | ceiling → food | `food − ceiling` = `net − top` ✓ |
| `past-even` | `net − maintenance` | even → food | `food − even` ✓ |
| `declared` | — | no run | — |

The screenshot day checks out: food 558, exercise 311, top 1,791, maintenance 2,291 gives ceiling 2,102 and even 2,602. The run from 558 to 2,102 is 1,544, which is the headline "1,544 left". Even − food = 2,044, which is the terms-line "2,044 deficit".

### What gets drawn after the change

- Axis from **0** to `max(even, food, ceiling, floor) × 1.12`. No negative region, no zero line.
- **Food block** 0 → food, labelled "N eaten", zone colour. Its right edge is the frontier.
- **Goal band** (green wash + solid edges) from `floor` to `ceiling`, labelled "Goal floor–top" at its left edge.
- **Exercise hatch** from `top` to `ceiling`, labelled "+N" when it fits. It is drawn above the food, so food that eats into the exercise credit shows through the hatch.
- **Break even** line at `maintenance + exercise`, labelled with that value.
- Ticks every 250 kcal, numbered at 1,000s under 600 px of track and at 500s above. No tick sits within 12 px of a named mark (floor, top, ceiling, even).

### Files

- `frontend/src/modules/Health/today/budgetGeometry.js` holds the pure geometry (rewrite).
- `frontend/src/modules/Health/today/budgetGeometry.test.js` holds its tests (rewrite).
- `frontend/src/modules/Health/today/EquationStrip.jsx`: `RulerScale` at lines ~105–149 renders the geometry. The legacy `BudgetBar` path (no `range`) is **not** touched.
- `frontend/src/modules/Health/today/EquationStrip.test.jsx`: the `describe('EquationStrip — the ruler')` block at ~line 109.
- `frontend/src/modules/Health/health.scss`: the ruler block, starting at the comment "The budget as a labelled ruler".
- `docs/reference/health/README.md`: the "**The bar is a labelled ruler**" section (~lines 179–203).

Nothing else imports `budgetGeometry` (verified: `grep -rln budgetGeometry frontend/src`). The week strip and month block use `dayBars.js` and stay on net. Leave them alone.

### Running tests

```bash
npx vitest run frontend/src/modules/Health/today/budgetGeometry.test.js frontend/src/modules/Health/today/EquationStrip.test.jsx
```

Baseline before any change: 2 files, 33 tests, all passing.

---

### Task 0: Worktree and sync

**Step 1: Confirm local is not behind the deployed tree** (per `CLAUDE.local.md`)

```bash
git fetch origin && git log --oneline HEAD..origin/main | head
ssh homeserver.local 'cd /opt/Code/DaylightStation && git branch --show-current && git log --oneline origin/main..HEAD | head'
```

Expected: nothing ahead that touches `frontend/src/modules/Health/today/`. If something is, integrate it first.

**Step 2: Create the worktree** (@superpowers:using-git-worktrees)

```bash
git worktree add ../DaylightStation-budget-food-axis -b feature/health-budget-food-axis
cd ../DaylightStation-budget-food-axis
```

**Step 3: Baseline**

Run the test command above. Expected: 33 passed.

---

### Task 1: Rewrite the geometry tests for the food axis

**Files:**
- Test: `frontend/src/modules/Health/today/budgetGeometry.test.js` (replace the whole file)

**Step 1: Write the failing tests**

Replace the file with:

```js
import { describe, it, expect } from 'vitest';
import { budgetGeometry } from './budgetGeometry.js';

// food 1390 − exercise 247 = net 1143; ceiling = 1791 + 247 = 2038; even = 2291 + 247 = 2538.
const day = (over = {}) => ({
  food: 1390, exercise: 247, net: 1143, maintenance: 2291, range: { floor: 1200, top: 1791 },
  zone: 'in-range', remaining: 648, declared: null, ...over,
});
const close = (a, b) => expect(a).toBeCloseTo(b, 1);
// A segment's length back in kcal, so a run can be checked against `remaining`.
const kcal = (g, seg) => (seg.widthPct / 100) * g.right;

describe('budgetGeometry — the ruler is food, from 0', () => {
  it('starts at 0 even on an exercise day, with 12% headroom past the furthest mark', () => {
    const g = budgetGeometry(day(), { widthPx: 360 });
    close(g.pct(0), 0);
    close(g.right, 2538 * 1.12);
  });

  it('with no exercise there is no hatch, and the ceiling is the top', () => {
    const g = budgetGeometry(day({ exercise: 0, net: 1390, remaining: 401 }), { widthPx: 360 });
    expect(g.earned).toBeNull();
    expect(g.ceiling).toBe(1791);
    close(g.right, 2291 * 1.12);
  });
});

describe('budgetGeometry — segments sit at the values they name', () => {
  it('food runs 0 → food eaten', () => {
    const g = budgetGeometry(day(), { widthPx: 360 });
    close(g.food.fromPct, 0);
    close(g.food.fromPct + g.food.widthPct, g.pct(1390));
    expect(g.food.value).toBe(1390);
    expect(g.zone).toBe('in-range');
  });

  it('the exercise hatch runs top → top + exercise', () => {
    const g = budgetGeometry(day(), { widthPx: 360 });
    close(g.earned.fromPct, g.pct(1791));
    close(g.earned.fromPct + g.earned.widthPct, g.pct(2038));
    expect(g.earned.value).toBe(247);
    expect(g.ceiling).toBe(2038);
  });

  it('negative net: nothing goes below 0 and no width is negative', () => {
    const g = budgetGeometry(day({ food: 100, exercise: 400, net: -300, zone: 'incomplete', remaining: 2091 }), { widthPx: 360 });
    close(g.food.fromPct, 0);
    expect(g.food.widthPct).toBeGreaterThan(0);
    expect(g.earned.widthPct).toBeGreaterThan(0);
    expect(g.run.widthPct).toBeGreaterThan(0);
    close(kcal(g, g.run), 2091);
  });
});

describe('budgetGeometry — band and marks', () => {
  it('the band runs from the floor to the ceiling, labelled with the configured goal', () => {
    const g = budgetGeometry(day(), { widthPx: 360 });
    close(g.band.fromPct, g.pct(1200));
    close(g.band.toPct, g.pct(2038));
    expect(g.band.label).toBe('Goal 1,200–1,791');
  });

  it('floor = top with no exercise: a band with no width, labelled with one number', () => {
    const g = budgetGeometry(day({ exercise: 0, net: 1000, food: 1000, range: { floor: 1200, top: 1200 }, zone: 'incomplete', remaining: 200 }), { widthPx: 360 });
    close(g.band.fromPct, g.band.toPct);
    close(g.band.toPct, g.pct(1200));
    expect(g.band.label).toBe('Goal 1,200');
  });

  it('floor = top with exercise: the band is the hatch, top → ceiling', () => {
    const g = budgetGeometry(day({ range: { floor: 1200, top: 1200 } }), { widthPx: 360 });
    close(g.band.fromPct, g.pct(1200));
    close(g.band.toPct, g.pct(1447));
    expect(g.band.label).toBe('Goal 1,200');
  });

  it('break-even sits at maintenance + exercise and is labelled with that value', () => {
    const g = budgetGeometry(day(), { widthPx: 360 });
    expect(g.even.value).toBe(2538);
    close(g.even.pct, g.pct(2538));
  });

  it('break-even keeps only its number when it crowds the ceiling', () => {
    expect(budgetGeometry(day(), { widthPx: 360 }).even.wordless).toBe(false);
    // even 1850 + 247 = 2097, 59 kcal from the 2038 ceiling ≈ 9 px.
    expect(budgetGeometry(day({ maintenance: 1850 }), { widthPx: 360 }).even.wordless).toBe(true);
  });

  it('no maintenance, no break-even mark', () => {
    expect(budgetGeometry(day({ maintenance: 0 }), { widthPx: 360 }).even).toBeNull();
  });
});

describe('budgetGeometry — ticks', () => {
  it('every 250, numbered at 1,000s on a phone, none within 12px of a named mark', () => {
    const g = budgetGeometry(day(), { widthPx: 360 });
    const values = g.ticks.map(t => t.value);
    expect(values).toContain(250);
    expect(values).toContain(1000);
    // 1,250 crowds the floor (1,200); 1,750 the top (1,791); 2,000 the ceiling (2,038); 2,500 break-even (2,538).
    expect(values).not.toContain(1250);
    expect(values).not.toContain(1750);
    expect(values).not.toContain(2000);
    expect(values).not.toContain(2500);
    expect(g.ticks.find(t => t.value === 1000).label).toBe('1,000');
    expect(g.ticks.find(t => t.value === 500).label).toBeNull();
  });

  it('numbered at 500s from 600px', () => {
    const g = budgetGeometry(day(), { widthPx: 640 });
    expect(g.ticks.find(t => t.value === 500).label).toBe('500');
  });

  it('never ticks 0 or anything below it', () => {
    expect(budgetGeometry(day(), { widthPx: 360 }).ticks.some(t => t.value <= 0)).toBe(false);
  });
});

describe('budgetGeometry — labels fit or drop', () => {
  it('food is labelled at ≥70px, the hatch at ≥36px', () => {
    const g = budgetGeometry(day(), { widthPx: 360 });
    expect(g.food.labelled).toBe(true);
    expect(g.earned.labelled).toBe(false); // 247 kcal ≈ 31px
    expect(budgetGeometry(day({ exercise: 0, food: 400, net: 400, zone: 'incomplete', remaining: 800 }), { widthPx: 280 }).food.labelled).toBe(false);
  });
});

describe('budgetGeometry — the run is the headline number, drawn', () => {
  const run = (over) => budgetGeometry(day(over), { widthPx: 360 });

  it('in range: food → ceiling, as long as remaining', () => {
    const g = run({});
    close(g.run.fromPct, g.pct(1390));
    close(g.run.fromPct + g.run.widthPct, g.pct(2038));
    close(kcal(g, g.run), 648);
    expect(g.run.value).toBe(648);
  });

  it('incomplete: food → ceiling, like in range', () => {
    const g = run({ food: 700, net: 453, zone: 'incomplete', remaining: 1338 });
    close(g.run.fromPct + g.run.widthPct, g.pct(2038));
    close(kcal(g, g.run), 1338);
  });

  it('over: ceiling → food; past break-even: break-even → food', () => {
    const over = run({ food: 2147, net: 1900, zone: 'over', remaining: 109 });
    close(over.run.fromPct, over.pct(2038));
    close(kcal(over, over.run), 109);
    const past = run({ food: 2647, net: 2400, zone: 'past-even', remaining: 109 });
    close(past.run.fromPct, past.pct(2538));
    close(kcal(past, past.run), 109);
  });

  it('declared: no run', () => {
    expect(run({ food: 600, net: 353, zone: 'declared', declared: 'fasting' }).run).toBeNull();
  });

  it('the 2026-09-25 screenshot day: 558 eaten, 311 burned reads 1,544 left and a 2,602 break-even', () => {
    const g = budgetGeometry({ food: 558, exercise: 311, net: 247, maintenance: 2291, range: { floor: 1200, top: 1791 },
      zone: 'incomplete', remaining: 1544, declared: null }, { widthPx: 1888 });
    close(g.food.fromPct + g.food.widthPct, g.pct(558));
    close(g.band.fromPct, g.pct(1200));
    expect(g.ceiling).toBe(2102);
    close(kcal(g, g.run), 1544);
    expect(g.even.value).toBe(2602);
  });
});
```

**Step 2: Run to verify they fail**

Run: `npx vitest run frontend/src/modules/Health/today/budgetGeometry.test.js`
Expected: FAIL. The existing geometry has no `ceiling`, the food block starts at `pct(-exercise)`, and so on. Several tests fail; none should error on import.

---

### Task 2: Rewrite the geometry

**Files:**
- Modify: `frontend/src/modules/Health/today/budgetGeometry.js` (replace the whole file)

**Step 1: Write the implementation**

```js
//
// The Today budget bar as a labelled ruler — pure geometry, so the numbers the
// bar paints can be pinned in a test (jsdom cannot measure a rendered bar).
//
// The ruler is FOOD eaten, from 0. Every block and label sits at the value it
// names: the food block runs 0 → food, the goal band starts at the floor (which
// already measures food). The server compares the top and break-even against
// NET; on a food scale that is the same comparison with exercise added to both
// sides, so exercise RAISES the ceiling (top + exercise) and break-even
// (maintenance + exercise). A hatched block from top to the ceiling shows the
// credit exercise earned. The server's zones and `remaining` carry over
// unchanged: the dotted run's length in kcal is the headline number.

export const TICK_STEP = 250;
const HEADROOM = 1.12;
const TICK_CLEARANCE_PX = 12;
const EVEN_CROWD_PX = 40;
const FOOD_LABEL_PX = 70;
const EARNED_LABEL_PX = 36;
const WIDE_PX = 600;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
export const fmt = (v) => Math.round(v).toLocaleString('en-US');

/**
 * @param {object} budget - a day from the budget contract (range, zone, food, exercise, maintenance, remaining)
 * @param {{ widthPx?: number }} [opts] - the track's rendered width, for label fit and tick density
 */
export function budgetGeometry(budget, { widthPx = 360 } = {}) {
  const food = Math.max(0, num(budget.food));
  const exercise = Math.max(0, num(budget.exercise));
  const floor = num(budget.range?.floor);
  const top = num(budget.range?.top);
  const maintenance = num(budget.maintenance);
  const zone = budget.zone;

  const ceiling = top + exercise;
  const even = maintenance > 0 ? maintenance + exercise : 0;

  const right = Math.max(even, food, ceiling, floor, 1) * HEADROOM;
  const pxPerKcal = widthPx / right;
  const pct = (v) => (Math.min(Math.max(v, 0), right) / right) * 100;
  const segment = (from, to) => ({ fromPct: pct(Math.min(from, to)), widthPct: Math.abs(pct(to) - pct(from)) });

  // The server guarantees top ≥ floor; floor = top means one goal number.
  const single = floor >= top;
  const band = {
    fromPct: pct(single ? top : floor),
    toPct: pct(ceiling),
    label: single ? `Goal ${fmt(top)}` : `Goal ${fmt(floor)}–${fmt(top)}`,
  };

  const evenMark = even > 0 ? { pct: pct(even), value: even, wordless: Math.abs(even - ceiling) * pxPerKcal < EVEN_CROWD_PX } : null;

  const named = [...(single ? [] : [floor]), top, ...(exercise > 0 ? [ceiling] : []), ...(even > 0 ? [even] : [])];
  const labelEvery = widthPx >= WIDE_PX ? 500 : 1000;
  const ticks = [];
  for (let v = TICK_STEP; v < right; v += TICK_STEP) {
    if (named.some((m) => Math.abs(m - v) * pxPerKcal < TICK_CLEARANCE_PX)) continue;
    ticks.push({ value: v, pct: pct(v), label: v % labelEvery === 0 ? fmt(v) : null });
  }

  const earned = exercise > 0
    ? { ...segment(top, ceiling), value: exercise, labelled: exercise * pxPerKcal >= EARNED_LABEL_PX }
    : null;
  const foodSeg = { ...segment(0, food), value: food, labelled: food * pxPerKcal >= FOOD_LABEL_PX };

  const runEnds = {
    incomplete: [food, ceiling],
    'in-range': [food, ceiling],
    over: [ceiling, food],
    'past-even': [even, food],
  }[zone];
  const run = runEnds ? { ...segment(runEnds[0], runEnds[1]), value: Math.round(num(budget.remaining)) } : null;

  return { right, pct, ticks, band, ceiling, even: evenMark, earned, food: foodSeg, run, zone };
}

export default budgetGeometry;
```

Notes:
- `left` and `zero` are gone from the return value. `RulerScale` is the only consumer, and Task 4 updates it.
- `band.collapsed` is gone. A band "collapses" when `fromPct === toPct` (floor = top with no exercise), and the renderer checks the width directly.

**Step 2: Run the geometry tests**

Run: `npx vitest run frontend/src/modules/Health/today/budgetGeometry.test.js`
Expected: PASS, all tests.

If a tick assertion fails, print `g.ticks.map(t => t.value)` and check it against the clearance arithmetic. At 360 px, `right = 2842.56` and 12 px ≈ 94.7 kcal. Fix the test only if your arithmetic shows the test was wrong. Do not loosen the rule.

**Step 3: Commit**

```bash
git add frontend/src/modules/Health/today/budgetGeometry.js frontend/src/modules/Health/today/budgetGeometry.test.js
git commit -m "fix(health): budget ruler plots food from 0; exercise raises the ceiling

The ruler plotted net on an axis that opened below zero, drew food from
-exercise under a hatch, and moved the goal band's left edge to
floor - exercise. A '558 eaten' label sat on a block 247 wide and the
'Goal 1,200-1,791' band started at 889.

On a food axis the floor stays put, top and break-even shift by exercise,
and the dotted run's length equals the headline's remaining.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Pin the rendered ruler in the component test

**Files:**
- Test: `frontend/src/modules/Health/today/EquationStrip.test.jsx`, inside `describe('EquationStrip — the ruler', …)` (~line 109)

**Step 1: Add the failing tests**

At the end of that `describe` block (after "a budget without a range keeps the legacy bar"), add:

```jsx
  it('labels sit at their values: +N on the hatch, break even at maintenance + exercise, no zero line', () => {
    const { container } = strip({ budget: { ...ranged, food: 558, exercise: 311, net: 247, zone: 'incomplete', remaining: 1544, status: 'under' } });
    expect(screen.getByTestId('budget-earned').textContent).toBe('+311');
    expect(container.querySelector('.health-budget__even-label').textContent).toBe('Break even 2,602');
    expect(screen.getByText('Goal 1,200–1,791')).toBeTruthy();
    expect(container.querySelector('.health-budget__zero')).toBeNull();
    expect(screen.getByTestId('budget-ruler').getAttribute('aria-label')).toMatch(/^558 kcal eaten; goal 1,200–1,791, plus 311 burned; break even 2,602; 1,544 left$/);
  });

  it('floor = top with no exercise draws one goal line, not a band', () => {
    const { container } = strip({ budget: { ...ranged, range: { floor: 1791, top: 1791 }, food: 900, exercise: 0, net: 900, zone: 'incomplete', remaining: 891, status: 'under' } });
    expect(container.querySelector('.health-budget__goal-line')).toBeTruthy();
    expect(container.querySelector('.health-budget__band')).toBeNull();
  });
```

`strip(...)` (line 13) returns the Testing Library `render` result, so `container` is available. The aria label's tail is `spoken`, which is `"${value} ${text}"` from `headlineFor` (`shared/contracts/health/budgetZone.mjs`). For `incomplete` that is "1,544 left", with no "kcal".

The jsdom track width is `useWidth`'s 360 px fallback. At that width 311 kcal ≈ 38 px, which clears the 36 px label threshold, so "+311" renders.

**Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/Health/today/EquationStrip.test.jsx`
Expected: FAIL. Right after Task 2, `RulerScale` still reads `band.collapsed` and `g.zero`, and it renders the hatch label without "+".

---

### Task 4: Update `RulerScale`

**Files:**
- Modify: `frontend/src/modules/Health/today/EquationStrip.jsx`: the `RulerScale` doc comment and function (~lines 105–149)

**Step 1: Replace the doc comment and function**

```jsx
/**
 * The budget as a labelled ruler of FOOD eaten (budgetGeometry.js): the goal
 * band from the floor to the ceiling (top + exercise), a hatched exercise
 * credit from top to the ceiling, break-even, ticks, and the food block from 0
 * whose right edge is the one frontier, coloured by zone. A dotted run carries
 * the headline's number to the mark it measures against.
 */
function RulerScale({ budget, spoken }) {
  const ref = useRef(null);
  const g = budgetGeometry(budget, { widthPx: useWidth(ref) });
  const { band, even, earned, food, run, zone } = g;
  const hasWidth = band.toPct > band.fromPct;
  return (
    <div className="health-budget__ruler" ref={ref}>
      <div className="health-budget__rail health-budget__rail--above">
        <span className={`health-budget__band-label${endAnchored(band.fromPct)}`} style={{ left: at(band.fromPct) }}>{band.label}</span>
      </div>
      <div className="health-budget__track health-budget__track--ruler" role="img" data-testid="budget-ruler"
        aria-label={`${n(food.value)} kcal eaten; ${band.label.toLowerCase()}${earned ? `, plus ${n(earned.value)} burned` : ''}${even ? `; break even ${n(even.value)}` : ''}; ${spoken}`}>
        {hasWidth ? <span className="health-budget__band" style={{ left: at(band.fromPct), width: at(band.toPct - band.fromPct) }} /> : null}
        <span className={`health-budget__food health-budget__food--${zone}`} data-testid="budget-food" style={{ left: at(food.fromPct), width: at(food.widthPct) }}>
          {food.labelled ? <span className="health-budget__seg-label">{n(food.value)} eaten</span> : null}</span>
        {earned ? <span className="health-budget__earned" data-testid="budget-earned" style={{ left: at(earned.fromPct), width: at(earned.widthPct) }}>
          {earned.labelled ? <span className="health-budget__seg-label">+{n(earned.value)}</span> : null}</span> : null}
        {run ? <span className={`health-budget__run health-budget__run--${zone}`} data-testid="budget-run" style={{ left: at(run.fromPct), width: at(run.widthPct) }} /> : null}
        {hasWidth
          ? <span className="health-budget__band-edges" style={{ left: at(band.fromPct), width: at(band.toPct - band.fromPct) }} />
          : <span className="health-budget__goal-line" style={{ left: at(band.toPct) }} />}
        {even ? <span className="health-budget__even" style={{ left: at(even.pct) }} /> : null}
      </div>
      <div className="health-budget__rail health-budget__ticks" aria-hidden="true">
        {g.ticks.map(t => <span key={t.value} className="health-budget__tick" style={{ left: at(t.pct) }}>
          {t.label ? <span className="health-budget__tick-label">{t.label}</span> : null}</span>)}
      </div>
      {even ? <div className="health-budget__rail health-budget__rail--below">
        <span className={`health-budget__even-label${endAnchored(even.pct)}`} style={{ left: at(even.pct) }}>
          {even.wordless ? null : 'Break even '}<b>{n(even.value)}</b></span>
      </div> : null}
    </div>
  );
}
```

What changed and why:
- The aria label leads with food eaten, which is what the bar now measures, instead of net.
- The earned hatch renders after the food block, so DOM order matches stacking (it sits above food on z-index anyway). Its label reads "+N" because it is added allowance.
- The zero line is gone, since the axis starts at 0.
- `band.collapsed` is replaced by a width check. The band label always anchors at `band.fromPct` (the floor, or the top when floor = top).

The legacy `BudgetBar` path above it (no `range`) stays as it is.

**Step 2: Run the component tests**

Run: `npx vitest run frontend/src/modules/Health/today/EquationStrip.test.jsx frontend/src/modules/Health/today/budgetGeometry.test.js`
Expected: PASS, all tests, including the existing "draws the band…" test. Its `/648 left$/` still holds because `spoken` is unchanged.

---

### Task 5: Styles — centre the hatch label, drop the zero line

**Files:**
- Modify: `frontend/src/modules/Health/health.scss`, in the ruler block (search for `&__earned {`)

**Step 1: Replace the `&__earned` rule and its comment**

Current:

```scss
  // Exercise credit: hatched, not a second fill colour — it is allowance, not
  // intake. It sits OVER the first `exercise` kcal of the food block (the food
  // those calories cancelled), so it is drawn above the food; on a negative-net
  // day the part of it past the food is unused credit, hence the outline.
  &__earned {
    z-index: 3;
    outline: 1px solid color-mix(in srgb, var(--ds-success) 60%, transparent); outline-offset: -1px;
```

New:

```scss
  // Exercise credit: hatched, not a second fill colour — it is allowance, not
  // intake. It extends the goal band from the top to the ceiling (top +
  // exercise), drawn above the food so eating into the credit shows through
  // the hatch. The label is centred: the 18px track clips anything that is not.
  &__earned {
    z-index: 3; display: flex; align-items: center; justify-content: center; overflow: hidden;
    outline: 1px solid color-mix(in srgb, var(--ds-success) 60%, transparent); outline-offset: -1px;
```

Keep the `background: repeating-linear-gradient(...)` lines that follow as they are.

**Step 2: Remove the zero line**

Delete these two parts:
- `&__zero` from the shared absolute-position selector list. The line reads `&__band, &__band-edges, &__earned, &__food, &__run, &__zero, &__even, &__goal-line { … }`; remove `&__zero, ` from it.
- the whole rule `&__zero { width: 1px; background: var(--ds-text-low); z-index: 3; }`.

**Step 3: Confirm nothing else uses it**

Run: `grep -rn "budget__zero" frontend/src`
Expected: no output.

**Step 4: Run the tests again**

Run: `npx vitest run frontend/src/modules/Health/today/`
Expected: PASS, every file in the folder (this covers `layout.contract.test.js` too).

**Step 5: Commit**

```bash
git add frontend/src/modules/Health/today/EquationStrip.jsx frontend/src/modules/Health/today/EquationStrip.test.jsx frontend/src/modules/Health/health.scss
git commit -m "fix(health): ruler renders the food axis; hatch label centred, zero line gone

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Update the reference doc

**Files:**
- Modify: `docs/reference/health/README.md`: the bullet list under "**The bar is a labelled ruler**" (~lines 179–203)

**Step 1: Replace the bullets** (from "- **Ruler.**" through the end of the "- **Remaining run.**" bullet) with:

```markdown
- **Ruler of food eaten, from 0.** `right = max(maintenance + exercise, food,
  top + exercise, floor) × 1.12`. Every block and label sits at the value it
  names. The server compares the top and break-even against NET; on a food scale
  that is the same comparison with exercise added to both sides, so exercise
  **raises the ceiling** (`top + exercise`) and break-even
  (`maintenance + exercise`) instead of moving anything left of zero.
- **Ticks** every 250 kcal, numbered at 1,000s under 600 px of track and at 500s
  above; none within 12 px of a named mark (floor, top, ceiling, break-even).
- **Goal band** from `floor` to the ceiling, labelled "Goal 1,200–1,791" (the
  configured floor and top) above the track at its left edge. With floor = top
  and no exercise it is one Goal line. **Break even** is a line labelled below
  with its food-scale value (`maintenance + exercise`); it keeps only its number
  when it sits within 40 px of the ceiling.
- **Exercise credit** is a hatched block from `top` to the ceiling, labelled
  "+N" when ≥ 36 px. It is drawn above the food, so food eaten into the credit
  shows through the hatch.
- **Food block** from 0, length = food, labelled "N eaten" at its right end when
  ≥ 70 px. Its right edge is **the one frontier**, and its colour is the zone:
  info (incomplete, still working toward the floor), success (in range or
  declared), warning (past the ceiling), danger (past break-even).
- **Remaining run.** A dotted run from the frontier to the mark the headline
  measures against: to the ceiling while under or in range, from the ceiling
  when over, from break-even when past it. None when the day is declared. Its
  length in kcal **is** `remaining`: `ceiling − food = top − net`.
```

Leave the paragraph after it ("A budget without `range`/`zone`…") as it is. The terms line and the legacy bar did not change.

**Step 2: Check the doc for stale references**

Run: `grep -n "−exercise\|floor − exercise\|zero line\|left = " docs/reference/health/README.md`
Expected: no hits that describe the ruler. Update any that remain.

**Step 3: Commit**

```bash
git add docs/reference/health/README.md
git commit -m "docs(health): budget ruler is a food axis

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: See it rendered

Unit tests cannot measure the bar. Look at it before calling the work done (@superpowers:verification-before-completion).

**Step 1: Check for a running dev server; do not start a second backend** (see `CLAUDE.local.md`, "NEVER start a second backend")

```bash
lsof -i :3111 -i :3112 | head
```

If one is already running from `main`, stop it before starting one from the worktree (see the memory note "Worktrees: Playwright port trap"). Run ONE stack.

**Step 2: Screenshot `/health` at desktop and phone widths**

Use a short Playwright script in the scratchpad (not committed) that loads `http://localhost:{app port}/health`, waits for `[data-testid="budget-ruler"]`, and screenshots `.health-budget` at 1280 px and 390 px wide.

Check each of these against the day's numbers in the terms line:
- The "N eaten" block ends at N on the ticks.
- The goal band's left edge lines up with the floor in its label.
- The hatch ends where the dotted run ends, at `top + exercise`.
- The "+N" label is fully visible (not clipped).
- There is no empty region left of the food block.
- The Break-even label value equals eaten + the "deficit" term.

If the laptop backend won't boot (Dropbox dataless files, see memory), say so plainly and do this check after deploy instead of skipping it.

---

### Task 8: Merge and clean up

**Step 1: Full folder test run on the branch**

Run: `npx vitest run frontend/src/modules/Health/`
Expected: PASS.

**Step 2: Merge into main** (no PR, per `CLAUDE.md`)

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
git merge --no-ff feature/health-budget-food-axis
```

Merge first; do not squash (see memory "squash reverts others' work"). The main checkout has unrelated uncommitted work in progress. Leave it alone.

**Step 3: Record and delete the branch and worktree**

Add a row to `docs/_archive/deleted-branches.md`:
`| 2026-09-25 | feature/health-budget-food-axis | <branch tip hash> | Health budget ruler on a food axis |`

```bash
git worktree remove ../DaylightStation-budget-food-axis
git branch -d feature/health-budget-food-axis
```

Deploying stays with the user unless `CLAUDE.local.md` grants it.
