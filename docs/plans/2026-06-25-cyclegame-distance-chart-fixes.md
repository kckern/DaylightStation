# CycleGame Distance Chart — Finish Freeze + Zero-Anchored Scale

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix two correctness bugs in the cycle-race distance chart: (1) a rider who reaches the goal keeps crawling rightward in time instead of freezing at the finish, and (2) the slowest rider is pinned flat to the bottom axis instead of showing their true progress.

**Architecture:** Both fixes live entirely in the frontend chart component `DistanceChart.jsx` (plus its test file). The race engine already exposes everything we need — `riders[id].finishTimeS` (set when a rider crosses the goal) and each rider's `distanceSeries`. Fix #1 truncates a finished rider's plotted lane at the goal-crossing sample. Fix #2 changes the vertical log scale to anchor at the **start line (0 m)** instead of the **trailing rider**, with the log compression constant scaled to the leader so the curve shape is race-length-invariant.

**Tech Stack:** React (`.jsx`), SVG, Vitest + @testing-library/react (jsdom).

---

## Background — how the chart works today

`frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.jsx`:

- **X axis = time.** `xFor(i)` maps a sample index → elapsed seconds → px.
- **Y axis = distance toward the goal.** `yFor(d)` maps metres → px (top = goal).
- When riders bunch, `yFor` switches from linear (`d / D`) to a **leader-anchored log** via `gapFrac(d, leaderM, trailM, K_GAP)` in `frontend/src/modules/Fitness/lib/cycleGame/chartScale.js`. That function pins the **leader to frac 1 (top)** and the **trailing rider to frac 0 (bottom)** — which is why the slowest rider is glued to the axis regardless of how far they've actually gone.
- A rider's whole `distanceSeries` is plotted. The engine (`CycleRaceEngine.js:137`) keeps pushing goal-clamped samples every tick after a rider finishes (until *all* riders finish), so a finished rider's lane keeps extending right at the top.

**Engine facts to rely on (do not change the engine):**
- `CycleRaceEngine.js:122-124` — on crossing, sets `rider.finishTimeS = elapsedS` and clamps `cumulativeDistanceM = goalM`.
- `CycleRaceEngine.js:189` / `getState()` — `finishTimeS` is included in each rider object the chart receives. It is `null` for unfinished riders and for all riders in a `time` race.
- After finishing, every subsequent `distanceSeries` sample equals `goalM` (rounded).

**Why `stepS` keeps the frozen tip stable:** `xFor(i) = xForTime(i * stepS)` with `stepS = elapsedS / (maxSeriesLen - 1)`. Samples are 1 Hz and `elapsedS` grows in lockstep with series length, so `stepS ≈ 1` and `xFor(fixedIndex)` keeps mapping to the same wall-clock second (the finish time) even as the field plays on. No drift handling needed.

---

### Task 1: Zero-anchor the vertical scale (slowest rider shows real progress)

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.jsx`
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.test.jsx`

We keep `gapFrac` (and its existing tests) untouched — it's a general pure function. We change **how the chart calls it**: pass `trailM = 0` so the bottom of the scale is the start line, and pass a leader-scaled `k` so the log curve keeps the same shape whether the leader is at 100 m or 5000 m. (A fixed `k = 4 m` crushes everyone but the leader's last few metres once distances grow large — that is the actual cause of the flat-bottom slowest rider, compounded by the trailing-rider anchor.)

**Step 1: Write the failing test**

Add to `DistanceChart.test.jsx` inside the top-level `describe('DistanceChart panel', ...)`:

```jsx
it('anchors the vertical scale at the start line so the slowest rider is not pinned to the floor', () => {
  // Two riders bunched near the front (triggers log mode) + one far-back rider.
  // Old behaviour anchored the bottom of the scale to the trailing rider, so the
  // slowest rider mapped to frac 0 (the bottom axis). Zero-anchored, they sit well
  // above the floor, reflecting their true ~20% progress.
  const riders = {
    lead:   { displayName: 'L', cumulativeDistanceM: 2500, distanceSeries: [2500] },
    second: { displayName: 'S', cumulativeDistanceM: 2480, distanceSeries: [2480] },
    slow:   { displayName: 'W', cumulativeDistanceM: 500,  distanceSeries: [500]  },
  };
  const { container } = render(
    <DistanceChart riderIds={['lead', 'second', 'slow']} riders={riders}
      riderLive={{ lead: {}, second: {}, slow: {} }}
      winCondition="distance" goalM={5000} elapsedS={1} />
  );
  const lines = container.querySelectorAll('[data-testid="race-line"]');
  const slowY = parseFloat(lines[2].getAttribute('points').trim().split(',')[1]);
  const floorY = 200 - 22; // H - PAD_B = the bottom axis
  expect(slowY).toBeLessThan(floorY - 12); // clearly off the bottom, not flat-lined
});
```

**Step 2: Run the test to verify it fails**

Run: `npx vitest run frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.test.jsx`
Expected: FAIL — the new test reports `slowY` ≈ 178 (the floor), `expect(178).toBeLessThan(166)` fails. (Existing tests still pass.)

**Step 3: Make the change**

In `DistanceChart.jsx`:

3a. Add a constant near the other module constants (after `const K_GAP = 4;` is fine, or beside the top block):

```jsx
const K_GAP_FRAC = 0.5;  // log compression metre-scale as a fraction of the leader's
                         // distance — keeps the scale's SHAPE constant across race
                         // lengths (a fixed small k crushes the field as distances grow)
```

3b. Remove the now-unused `trailM` and rewrite `yFor` to anchor at 0 with the scaled `k`. Find this block:

```jsx
  const lastDists = riderIds.map((id) => (riders[id].distanceSeries || []).slice(-1)[0] || 0);
  const leaderM = lastDists.length ? Math.max(...lastDists) : 0;
  const trailM = lastDists.length ? Math.min(...lastDists) : 0;
```

Replace with (drop `trailM`; it's only used by `yFor`):

```jsx
  const lastDists = riderIds.map((id) => (riders[id].distanceSeries || []).slice(-1)[0] || 0);
  const leaderM = lastDists.length ? Math.max(...lastDists) : 0;
```

Then find `yFor`:

```jsx
  const yFor = (d) => {
    const frac = useLog
      ? gapFrac(d, leaderM, trailM, K_GAP)
      : Math.min(1, (d || 0) / D);
    return (H - PAD_B) - Math.max(0, Math.min(1, frac)) * PLOT_H;
  };
```

Replace with:

```jsx
  // Zero-anchored log: the bottom of the scale is the START LINE (0 m), never the
  // trailing rider — so the slowest rider shows their true progress up from zero
  // instead of being pinned to the axis. k scales with the leader so the curve keeps
  // its shape regardless of race length.
  const kGap = Math.max(K_GAP, leaderM * K_GAP_FRAC);
  const yFor = (d) => {
    const frac = useLog
      ? gapFrac(d, leaderM, 0, kGap)
      : Math.min(1, (d || 0) / D);
    return (H - PAD_B) - Math.max(0, Math.min(1, frac)) * PLOT_H;
  };
```

> Note: update the comment block immediately above `yFor` (the "leader-anchored gap log" paragraph, ~lines 137-140) to say the bottom anchors at the start line, not the trailing rider.

**Step 4: Run the test to verify it passes**

Run: `npx vitest run frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.test.jsx`
Expected: PASS — all tests in the file pass (`slowY` ≈ 158 < 166).

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.jsx \
        frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.test.jsx
git commit -m "fix(cyclegame): zero-anchor distance-chart Y scale so slowest rider shows real progress"
```

---

### Task 2: Freeze a finished rider's lane at the goal-crossing time

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.jsx`
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.test.jsx`

A finished rider (`finishTimeS != null`) should plot only up to the sample where they crossed the goal. We compute a per-rider `plottedLen` and apply it everywhere a lane's last sample is read: the line/area coords, the smooth-tip computation, and the terminus tag.

**Step 1: Write the failing test**

Add to `DistanceChart.test.jsx`:

```jsx
it('freezes a finished rider’s lane at the goal-crossing time (does not crawl right)', () => {
  // Rider A crosses the 1000 m goal at sample index 3, then the engine keeps pushing
  // goal-clamped samples while rider B (still racing) plays on. A's lane must stop at
  // index 3's x; B's lane extends to the latest sample.
  const aSeries = [400, 700, 950, 1000, 1000, 1000, 1000];
  const bSeries = [200, 350, 480, 540, 580, 600, 600];
  const riders = {
    a: { displayName: 'A', cumulativeDistanceM: 1000, finishTimeS: 3, distanceSeries: aSeries },
    b: { displayName: 'B', cumulativeDistanceM: 600, distanceSeries: bSeries },
  };
  const { container } = render(
    <DistanceChart riderIds={['a', 'b']} riders={riders}
      riderLive={{ a: {}, b: {} }} winCondition="distance" goalM={1000} elapsedS={6} />
  );
  const lines = container.querySelectorAll('[data-testid="race-line"]');
  const aXs = lines[0].getAttribute('points').trim().split(' ').map((p) => parseFloat(p.split(',')[0]));
  const bXs = lines[1].getAttribute('points').trim().split(' ').map((p) => parseFloat(p.split(',')[0]));
  // A plots exactly 4 points (indices 0..3) and stops left of still-racing B.
  expect(aXs.length).toBe(4);
  expect(Math.max(...aXs)).toBeLessThan(Math.max(...bXs));
});
```

**Step 2: Run the test to verify it fails**

Run: `npx vitest run frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.test.jsx`
Expected: FAIL — without the fix A plots all 7 samples (`aXs.length` is 7, and A's max x reaches the same right edge as B).

**Step 3: Make the change**

In `DistanceChart.jsx`:

3a. Add the `plottedLen` helper. Put it just **before** the `// ── Smooth leading edge ──` block (i.e. before `const tickKey = ...`), so it's in scope for `curTips`, `lineCoordsFor`, and `tagLayout`:

```jsx
  // A finished rider's lane freezes at the sample where they crossed the goal: the
  // race is over for them, so their terminus stops advancing along the time axis (it
  // would otherwise crawl right at the goal line every tick until the last rider
  // finishes). Unfinished riders — and every rider in a time race (finishTimeS null) —
  // plot their whole series.
  const plottedLen = (id) => {
    const series = riders[id].distanceSeries || [];
    if (riders[id].finishTimeS == null) return series.length;
    const fin = series.findIndex((d) => d >= goalM);
    return fin >= 0 ? fin + 1 : series.length;
  };
```

3b. In the `curTips` loop, use the frozen last index. Find:

```jsx
  riderIds.forEach((id) => {
    const series = riders[id].distanceSeries || [];
    const last = series.length - 1;
    if (last < 0) return;
    curTips[id] = { x: xFor(last), y: yFor(series[last]) };
  });
```

Replace with:

```jsx
  riderIds.forEach((id) => {
    const series = riders[id].distanceSeries || [];
    const last = plottedLen(id) - 1;
    if (last < 0) return;
    curTips[id] = { x: xFor(last), y: yFor(series[last]) };
  });
```

3c. In `lineCoordsFor`, slice to the frozen end. Find:

```jsx
  const lineCoordsFor = (id) => {
    const series = riders[id].distanceSeries || [];
    const start = plotStartIndex(series);
    if (start < 0) return null;
    const coords = series.slice(start).map((d, i) => ({ x: xFor(start + i), y: yFor(d) }));
    const tip = tipFor(id);
    if (tip && coords.length) coords[coords.length - 1] = tip;
    return { coords, start };
  };
```

Replace with:

```jsx
  const lineCoordsFor = (id) => {
    const series = riders[id].distanceSeries || [];
    const start = plotStartIndex(series);
    const end = plottedLen(id);
    if (start < 0 || start >= end) return null;
    const coords = series.slice(start, end).map((d, i) => ({ x: xFor(start + i), y: yFor(d) }));
    const tip = tipFor(id);
    if (tip && coords.length) coords[coords.length - 1] = tip;
    return { coords, start };
  };
```

3d. In `tagLayout`, anchor the terminus tag at the frozen last sample. Find:

```jsx
    const raw = riderIds.map((id, idx) => {
      const series = riders[id].distanceSeries || [];
      if (!series.length) return null;
      return {
        id,
        idx,
        leftPct: (xFor(series.length - 1) / W) * 100,
        rawTopPct: (yFor(series[series.length - 1]) / H) * 100,
```

Replace the first lines with a frozen-index version:

```jsx
    const raw = riderIds.map((id, idx) => {
      const series = riders[id].distanceSeries || [];
      const last = plottedLen(id) - 1;
      if (last < 0) return null;
      return {
        id,
        idx,
        leftPct: (xFor(last) / W) * 100,
        rawTopPct: (yFor(series[last]) / H) * 100,
```

(Leave the rest of the object — `color`, `isGhost`, `live`, `distanceM`, `displayName`, `isLeader` — unchanged.)

**Step 4: Run the test to verify it passes**

Run: `npx vitest run frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.test.jsx`
Expected: PASS — `aXs.length` is 4 and A's max x is left of B's.

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.jsx \
        frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.test.jsx
git commit -m "fix(cyclegame): freeze finished rider's lane at goal-crossing time"
```

---

### Task 3: Full regression run

**Step 1: Run the whole CycleGame suite**

Run:
```bash
npx vitest run frontend/src/modules/Fitness/widgets/CycleGame frontend/src/modules/Fitness/lib/cycleGame
```
Expected: PASS — all CycleGame component + lib tests green (including the untouched `chartScale.test.js` and `DistanceChart` window/goal-line tests).

**Step 2: If anything failed, debug before proceeding**

REQUIRED SUB-SKILL: Use superpowers:systematic-debugging. Do not paper over a regression — the most likely suspects are the window/zoom tests (they assert specific y-pixels) if the `yFor` comment edit accidentally touched logic, or a tag-collision test if `tagLayout` lost a field.

---

## Out of scope / deferred

- **"Finished" visual treatment on the terminus** (e.g. a ✓ ring or checkered flag on a finished rider's node). The user asked whether to add this; this plan freezes the lane only. If desired, add a follow-up task that reads `riders[id].finishTimeS != null` in `tagLayout` and toggles an `is-finished` class on `.cycle-race-screen__tag`, styled in `DistanceChart.scss`.
- **`K_GAP_FRAC` tuning.** `0.5` gives the slowest rider visible credit while still separating the front pack across the top ~10% of height. If the front pack needs more separation (at the cost of crushing the back a little), lower it toward `0.25`. Verify visually on the garage Firefox kiosk before changing.
