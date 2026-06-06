# Cycle-Game Bug Bash Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 10 cycle-game issues from a live bug bash — chart goal line + scaling, layout order + early-laps content, rider color palette + speedometer tint, lap length, sidebar clipping, results exit button, history winner avatar, and a ghost-selection submenu.

**Architecture:** Mostly targeted edits to existing CycleGame components. Tasks are independent; order is low-risk → higher. Run a single vitest file with `npx vitest run --config vitest.config.mjs <path>` (from the repo root `/opt/Code/DaylightStation`). Build with `cd frontend && npm run build`. Runtime/visual checks via the existing Playwright harness (`tests/live/flow/fitness/cycle-game-autostart-drive.runtime.test.mjs` shows the boot+drive pattern). Deploy on this host: `sudo docker build … && sudo deploy-daylight` (the local runbook).

**Tech Stack:** React (.jsx), SCSS, Vitest + Testing Library. Reference (verbatim current code + line numbers) is inline per task.

---

## File structure / what each task touches

- **T1** `panels/DistanceChart.jsx` — goal line at `yFor(goalM)`.
- **T2** `panels/DistanceChart.jsx` — invert the log curve (expand top).
- **T3** `lib/cycleGame/lineColors.js` — synthwave rider palette.
- **T4** `CycleSpeedometer.jsx` (+scss), `panels/SpeedoRow.jsx` — tinted gauge background from rider color.
- **T5** `CycleGameContainer.jsx`, `lib/cycleGame/effectiveLapLength.js` (new) — lap length 400 + whole-race-if-shorter; config edit.
- **T6** `RaceLayoutManager.jsx` — laps left / chart one-in-from-left (both modes).
- **T7** `RaceLayoutManager.scss` — fix sidebar speedometer clipping.
- **T8** `panels/SplitsChart.jsx` (+scss) — live-order view before laps exist.
- **T9** `RaceResults.jsx`, `RaceResults.scss` — manual exit button.
- **T10** `CycleGameHome.jsx` (+scss) — history winner avatar + crescents (drop crown).
- **T11** `CycleGameHome.jsx` (+scss) — ghost-selection submenu (toggle which ghosts).

---

## Task 1: Distance-chart goal line honors zoom

The dotted goal line is hardcoded at the top (`y1={PAD_T}`), so finishing never meets it. Place it at `yFor(goalM)` so it tracks the current zoom window `D` and the finisher reaches it.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.jsx`

Current (`DistanceChart.jsx:298-299`):
```jsx
        {winCondition === 'distance' && (
          <line className="cycle-race-screen__goal" x1={PAD_L} y1={PAD_T} x2={W - PAD_R} y2={PAD_T} vectorEffect="non-scaling-stroke" />
        )}
```
`yFor` (lines 122-127) maps a distance to a y using the live window `D` — using it makes the line move with the zoom.

- [ ] **Step 1 — Implement:** replace the goal line with one positioned at `yFor(goalM)`, guarded so it only draws when `goalM` is a finite positive number:
```jsx
        {winCondition === 'distance' && Number.isFinite(goalM) && goalM > 0 && (
          <line className="cycle-race-screen__goal"
            x1={PAD_L} y1={yFor(goalM).toFixed(1)} x2={W - PAD_R} y2={yFor(goalM).toFixed(1)}
            vectorEffect="non-scaling-stroke" />
        )}
```
Ensure this `<line>` sits in the **same SVG group as the lanes** (the zoomable `<g>`), so it pans/zooms identically. If it's currently a sibling outside that group, move it inside next to the lane lines.

- [ ] **Step 2 — Verify (runtime/visual):** `cd frontend && npm run build` → `✓ built`. Then run a distance race (e.g. via `tests/live/flow/fitness/cycle-game-autostart-drive.runtime.test.mjs` with `winCondition:'distance', value:300`), screenshot near the finish, and confirm the dotted line sits at the goal and the finishing rider's line meets it. (No unit test — this is an SVG coordinate change best verified visually.)

- [ ] **Step 3 — Commit:**
```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.jsx
git commit -m "fix(cycle-game): distance-chart goal line tracks the zoom (yFor(goalM))"
```

---

## Task 2: Invert the chart log scaling (expand the top)

The current log curve `log(1+d)/log(1+D)` expands the bottom (stragglers) and compresses the top (leaders). Invert it so the **top expands** — close gaps between leaders read clearly.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.jsx`

Current (`DistanceChart.jsx:122-127`):
```js
  const yFor = (d) => {
    const frac = useLog
      ? (Math.log1p(Math.max(0, d || 0)) / Math.log1p(Math.max(1, D)))
      : Math.min(1, (d || 0) / D);
    return (H - PAD_B) - Math.max(0, Math.min(1, frac)) * PLOT_H;
  };
```

- [ ] **Step 1 — Implement:** flip the log expression to compress the bottom / expand the top:
```js
  const yFor = (d) => {
    const frac = useLog
      ? 1 - (Math.log1p(Math.max(0, D - (d || 0))) / Math.log1p(Math.max(1, D)))
      : Math.min(1, (d || 0) / D);
    return (H - PAD_B) - Math.max(0, Math.min(1, frac)) * PLOT_H;
  };
```
This keeps `frac=0→bottom`, `frac=1→top`, but now the curve's resolution is densest near `d≈D` (the top/leaders).

- [ ] **Step 2 — Verify:** `cd frontend && npm run build` → `✓ built`. Run a race where two leaders are close; screenshot mid-race and confirm the near-leader lines are visibly separated near the top (not bunched). Also re-confirm Task 1's goal line still lands correctly (it uses the same `yFor`).

- [ ] **Step 3 — Commit:**
```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.jsx
git commit -m "fix(cycle-game): invert chart log scaling — expand the top (leaders) not the bottom"
```

---

## Task 3: Synthwave rider color palette (no HR-zone clash)

Replace `LINE_COLORS` so rider colors don't read as heart-rate zones. HR zones (`shared/constants/fitness.js`): cool `#6ab8ff`, active `#51cf66`, warm `#ffd43b`, hot `#ff922b`, fire `#ff6b6b`. Reserved chrome: cyan `#21e6ff`, magenta `#ff2d95`. The new palette uses cyan/magenta/teal/maroon/sand/gray *shades distinct from those*, and avoids blue/green/yellow/orange/red.

**Files:**
- Modify: `frontend/src/modules/Fitness/lib/cycleGame/lineColors.js`
- Test: `frontend/src/modules/Fitness/lib/cycleGame/lineColors.test.js` (create)

Current (`lineColors.js:9-16`):
```js
export const LINE_COLORS = [
  '#5dff9b', // green
  '#ffb13d', // orange
  '#b072ff', // purple
  '#ffe14d', // yellow
  '#3da5ff', // blue (clearly bluer than the reserved cyan)
  '#ff7eb6'  // pink (lighter than the reserved hot magenta)
];
```

- [ ] **Step 1 — Write the failing test** `lineColors.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { LINE_COLORS } from './lineColors.js';

// HR-zone + reserved-chrome colors the rider palette must NOT collide with.
const FORBIDDEN = ['#6ab8ff', '#51cf66', '#ffd43b', '#ff922b', '#ff6b6b', '#21e6ff', '#ff2d95'];

describe('LINE_COLORS (synthwave rider palette)', () => {
  it('has at least 6 distinct colors', () => {
    expect(LINE_COLORS.length).toBeGreaterThanOrEqual(6);
    expect(new Set(LINE_COLORS.map((c) => c.toLowerCase())).size).toBe(LINE_COLORS.length);
  });
  it('does not reuse any HR-zone or reserved-chrome color', () => {
    const lc = LINE_COLORS.map((c) => c.toLowerCase());
    FORBIDDEN.forEach((f) => expect(lc).not.toContain(f.toLowerCase()));
  });
});
```

- [ ] **Step 2 — Run, expect FAIL** (current palette would pass the FORBIDDEN check but document the intent; if it passes, that's fine — the real change is the values):
`npx vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/lineColors.test.js`

- [ ] **Step 3 — Implement the new palette:**
```js
export const LINE_COLORS = [
  '#4dd0e1', // cyan (softer than the reserved chrome cyan #21e6ff)
  '#d472c0', // magenta (softer than the reserved hot magenta #ff2d95)
  '#2dd4bf', // teal
  '#a14d6b', // maroon / rose
  '#cbb285', // sand / tan
  '#9aa3c0'  // slate gray
];
```
Keep the file's existing header comment about reserved chrome; update it to note the palette avoids HR-zone hues (no blue/green/yellow/orange/red).

- [ ] **Step 4 — Run, expect PASS.** `npx vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/lineColors.test.js`

- [ ] **Step 5 — Commit:**
```bash
git add frontend/src/modules/Fitness/lib/cycleGame/lineColors.js frontend/src/modules/Fitness/lib/cycleGame/lineColors.test.js
git commit -m "feat(cycle-game): synthwave rider palette that doesn't clash with HR-zone colors"
```

---

## Task 4: Tint the speedometer background with the rider's color

Give each gauge a dark tint of its rider's lane color (~0.2 opacity over black). `CycleSpeedometer` has no color prop today; add `riderColor` and apply it; `SpeedoRow` passes `LINE_COLORS[idx]`.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleSpeedometer.jsx`
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleSpeedometer.scss`
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/panels/SpeedoRow.jsx`

- [ ] **Step 1 — Add the prop + tinted background** in `CycleSpeedometer.jsx`. Add `riderColor = null` to the destructured props (after `multiplierColor`), to `propTypes` (`riderColor: PropTypes.string`), and apply it as a CSS variable on the gauge so the SCSS can tint:
```jsx
      <div className="cycle-speedometer__gauge" style={{ width: px, height: px, '--cg-rider-tint': riderColor || 'transparent' }}>
```

- [ ] **Step 2 — SCSS tint** in `CycleSpeedometer.scss`, under `&__gauge`, layer the tint over the dark background (≈0.2 opacity of the rider color on black). Use `color-mix` (Chromium kiosk supports it):
```scss
  &__gauge {
    position: relative; display: flex; align-items: center; justify-content: center;
    border-radius: 50%;
    background:
      radial-gradient(circle at 50% 50%,
        color-mix(in srgb, var(--cg-rider-tint, transparent) 20%, #0a0a14) 0%,
        #0a0a14 78%);
  }
```

- [ ] **Step 3 — Pass the color** in `SpeedoRow.jsx`. It already imports `LINE_COLORS` (line 4) and maps `idx`. Add the prop on the `<CycleSpeedometer>` (alongside the existing `avatar={…}`):
```jsx
            riderColor={LINE_COLORS[idx % LINE_COLORS.length]}
```

- [ ] **Step 4 — Verify:** `cd frontend && npm run build` → `✓ built`. Run a race, screenshot the speedometers, confirm each gauge face carries a *subtle dark tint* of its rider's color (not a bright fill). Existing `CycleSpeedometer` tests must still pass: `npx vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/CycleSpeedometer.test.jsx` (if absent, skip).

- [ ] **Step 5 — Commit:**
```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/CycleSpeedometer.jsx \
        frontend/src/modules/Fitness/widgets/CycleGame/CycleSpeedometer.scss \
        frontend/src/modules/Fitness/widgets/CycleGame/panels/SpeedoRow.jsx
git commit -m "feat(cycle-game): tint each speedometer with a dark wash of the rider's color"
```

---

## Task 5: Lap length 400 m, or the whole race if shorter

Set `lap_length_m` to 400 in config, and compute an **effective** lap length: for a distance race whose goal is shorter than the lap, one lap = the whole race.

**Files:**
- Create: `frontend/src/modules/Fitness/lib/cycleGame/effectiveLapLength.js`
- Create: `frontend/src/modules/Fitness/lib/cycleGame/effectiveLapLength.test.js`
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx` (3 read sites)
- Config: `data/household/config/finance.yml`… (actually `data/household/config/fitness.yml`, `lap_length_m`)

- [ ] **Step 1 — Write the failing test** `effectiveLapLength.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { effectiveLapLength } from './effectiveLapLength.js';

describe('effectiveLapLength', () => {
  it('uses the configured lap for a long distance race', () => {
    expect(effectiveLapLength({ lapLengthM: 400, winCondition: 'distance', goalM: 3000 })).toBe(400);
  });
  it('makes one lap the whole race when the goal is shorter than the lap', () => {
    expect(effectiveLapLength({ lapLengthM: 400, winCondition: 'distance', goalM: 250 })).toBe(250);
    expect(effectiveLapLength({ lapLengthM: 400, winCondition: 'distance', goalM: 100 })).toBe(100);
  });
  it('uses the configured lap for time races (no distance goal)', () => {
    expect(effectiveLapLength({ lapLengthM: 400, winCondition: 'time', goalM: null })).toBe(400);
  });
  it('returns 0 when laps are disabled', () => {
    expect(effectiveLapLength({ lapLengthM: 0, winCondition: 'distance', goalM: 100 })).toBe(0);
  });
});
```

- [ ] **Step 2 — Run, expect FAIL** (unresolved import): `npx vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/effectiveLapLength.test.js`

- [ ] **Step 3 — Implement** `effectiveLapLength.js`:
```js
/**
 * The lap length actually used for a race. Normally the configured lap (e.g. 400m),
 * but for a DISTANCE race whose goal is shorter than the lap, one lap = the whole
 * race (so a 100/200/250m race isn't sliced into sub-laps). 0 = laps disabled.
 */
export function effectiveLapLength({ lapLengthM = 0, winCondition = 'distance', goalM = null } = {}) {
  const lap = Number.isFinite(lapLengthM) && lapLengthM > 0 ? lapLengthM : 0;
  if (lap === 0) return 0;
  if (winCondition === 'distance' && Number.isFinite(goalM) && goalM > 0 && goalM < lap) return goalM;
  return lap;
}

export default effectiveLapLength;
```

- [ ] **Step 4 — Run, expect PASS.**

- [ ] **Step 5 — Thread it in `CycleGameContainer.jsx`.** Import it at the top:
```jsx
import { effectiveLapLength } from '@/modules/Fitness/lib/cycleGame/effectiveLapLength.js';
```
There are three sites reading `cycleGameConfig.lap_length_m` directly. Replace each with the effective value computed from the *same* win-condition/goal available at that point.

(a) In `startRace` (currently `CycleGameContainer.jsx:617`, inside the race-config object) — the local `winCondition`/`goalM` for this race are in scope (the config build uses `raceType`/`raceValueM`). Compute once just above the config object:
```jsx
      const cfgLap = Number.isFinite(cycleGameConfig?.lap_length_m) ? cycleGameConfig.lap_length_m : 0;
      const lapLengthM = effectiveLapLength({ lapLengthM: cfgLap, winCondition, goalM });
```
and use `lapLengthM,` in place of the inline `Number.isFinite(...) ? ... : 0` at line 617.

(b) The CycleRaceScreen render (line 1320) and (c) the RaceResults render (line 1345): the active race's `winCondition`/`goalM` come from the engine snapshot (`engineState.winCondition`, `engineState.goalM`) or `raceMetaRef.current`. Replace the inline reads with:
```jsx
        lapLengthM={effectiveLapLength({
          lapLengthM: Number.isFinite(cycleGameConfig?.lap_length_m) ? cycleGameConfig.lap_length_m : 0,
          winCondition: engineState.winCondition || raceMetaRef.current?.winCondition || 'distance',
          goalM: engineState.goalM ?? raceMetaRef.current?.goalM ?? null
        })}
```
(Use the variable name already in scope for the snapshot — `engineState` exists in both render blocks per the existing code.)

- [ ] **Step 6 — Run the cycle-game suite + build:**
`npx vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame frontend/src/modules/Fitness/lib/cycleGame` → all pass. `cd frontend && npm run build` → `✓ built`.

- [ ] **Step 7 — Config edit (data volume, on this host):** set `lap_length_m` to 400 in the container config (heredoc-via-node, never `sed -i` on YAML):
```bash
sudo docker exec daylight-station sh -c "cat > /tmp/lap.js << 'JS'
const fs=require('fs'); const p='data/household/config/fitness.yml'; const src=fs.readFileSync(p,'utf8');
const out=src.replace(/^(\s*lap_length_m:\s*)\d+/m,'\$1400');
if(out===src){console.error('FAIL: lap_length_m not found/changed');process.exit(1);}
fs.writeFileSync(p+'.bak-laplen',src); fs.writeFileSync(p,out); console.log('lap_length_m -> 400 (backup .bak-laplen)');
JS
node /tmp/lap.js"
```

- [ ] **Step 8 — Commit + deploy:**
```bash
git add frontend/src/modules/Fitness/lib/cycleGame/effectiveLapLength.js \
        frontend/src/modules/Fitness/lib/cycleGame/effectiveLapLength.test.js \
        frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx
git commit -m "feat(cycle-game): lap length 400m, whole-race lap when the goal is shorter"
```
(Config reload happens on the deploy/restart at the end of the plan.)

---

## Task 6: Layout — laps left, chart one-in-from-left (both modes)

`RaceLayoutManager` currently renders, sidebar: `[chart | splits]`; wide: `[chart | splits | POV]`. Reorder so the chart is never far-left: sidebar `[splits | chart]`; wide `[splits | chart | POV]`.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/RaceLayoutManager.jsx`
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/RaceLayoutManager.test.jsx`

- [ ] **Step 1 — Update the test** to assert DOM order (splits before chart). Add to `RaceLayoutManager.test.jsx`:
```jsx
it('puts splits before the chart (chart is never far-left)', () => {
  const { getByTestId } = render(<RaceLayoutManager panels={panels} fieldSize={2} />);
  const order = [...getByTestId('race-layout').querySelectorAll('[data-testid^="zone-"]')].map((z) => z.dataset.testid);
  expect(order.indexOf('zone-splits')).toBeLessThan(order.indexOf('zone-chart'));
});
```
(`panels` fixture already exists in that test file.)

- [ ] **Step 2 — Run, expect FAIL** (current order is chart-then-splits): `npx vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/RaceLayoutManager.test.jsx`

- [ ] **Step 3 — Reorder the JSX.** In the **wide** branch, swap so splits is first:
```jsx
        <div className="race-layout__top3">
          {p('splitsChart', 'zone-splits', 'race-layout__zone--splits')}
          {p('distanceChart', 'zone-chart', 'race-layout__zone--chart')}
          {p('povGrid', 'zone-pov', 'race-layout__zone--pov')}
        </div>
```
In the **sidebar** branch's `race-layout__main-top`, swap so splits is first:
```jsx
        <div className="race-layout__main-top">
          {p('splitsChart', 'zone-splits', 'race-layout__zone--splits')}
          {p('distanceChart', 'zone-chart', 'race-layout__zone--chart')}
        </div>
```

- [ ] **Step 4 — Run, expect PASS** (plus the existing mode tests). Build: `cd frontend && npm run build`.

- [ ] **Step 5 — Commit:**
```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/RaceLayoutManager.jsx \
        frontend/src/modules/Fitness/widgets/CycleGame/RaceLayoutManager.test.jsx
git commit -m "feat(cycle-game): layout — splits left, chart one-in-from-left (both modes)"
```

---

## Task 7: Fix sidebar-mode speedometer clipping

In sidebar mode the bottom speedo band is clipping the gauges. The band row is `minmax(240px, 48%)` and zones have `overflow: hidden`. Give the speedo zone breathing room and let it not clip.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/RaceLayoutManager.scss`

- [ ] **Step 1 — Implement.** In `RaceLayoutManager.scss`, raise the sidebar band floor and add internal padding so gauges fit; allow the speedo zone to show content (the gauges overflow the 10px-tall design intentionally). Change the sidebar main rows + speedo zone:
```scss
  .race-layout__main { display: grid; grid-template-rows: 1fr minmax(260px, 46%); gap: 8px; min-height: 0; }
  .race-layout__zone--speedo { overflow: visible; padding: 6px 8px 10px; box-sizing: border-box; }
```
(Keep the wide-mode band as-is unless it also clips; if it does, apply the same `--speedo` rule — it's shared.)

- [ ] **Step 2 — Verify (visual):** `cd frontend && npm run build`; run a 2-rider race, screenshot, confirm the bottom gauges + their `0 m` labels are fully visible (not cut off).

- [ ] **Step 3 — Commit:**
```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/RaceLayoutManager.scss
git commit -m "fix(cycle-game): sidebar speedometer band no longer clips the gauges"
```

---

## Task 8: Splits panel — useful "live order" before laps exist

Before any lap completes, the splits panel is empty/useless. When `completed === 0` (and laps are enabled), show a compact **live order**: riders sorted by distance, each with distance + gap to the leader. It transitions to the splits table as laps complete.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/panels/SplitsChart.jsx`
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/panels/SplitsChart.scss`
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/panels/SplitsChart.test.jsx`

- [ ] **Step 1 — Write the failing test:**
```jsx
it('shows a live order (distance + gap) before any lap completes', () => {
  const riders = {
    a: { displayName: 'A', cumulativeDistanceM: 120, lapSplits: [] },
    b: { displayName: 'B', cumulativeDistanceM: 90, lapSplits: [] }
  };
  const { getByTestId, getAllByTestId } = render(
    <SplitsChart riderIds={['a','b']} riders={riders} lapLengthM={400} elapsedS={30} />
  );
  expect(getByTestId('splits-live')).toBeInTheDocument();
  const rows = getAllByTestId('splits-live-row');
  expect(rows[0].textContent).toContain('A');           // leader first
  expect(rows[1].textContent).toContain('-30');         // B is 30 m back
});
```

- [ ] **Step 2 — Run, expect FAIL** (`splits-live` not found): `npx vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/panels/SplitsChart.test.jsx`

- [ ] **Step 3 — Implement.** In `SplitsChart.jsx`, after the existing `completed` computation and the `!lapsOn` early-return, add a branch when `completed === 0`:
```jsx
  if (completed === 0) {
    const order = [...riderIds]
      .map((id) => ({ id, name: riders[id]?.displayName || id, d: Math.max(0, riders[id]?.cumulativeDistanceM || 0) }))
      .sort((a, b) => b.d - a.d);
    const lead = order[0]?.d || 0;
    return (
      <div className="cg-splits" data-testid="race-splits">
        <div className="cg-splits__livehdr">Live order</div>
        <ol className="cg-splits__live" data-testid="splits-live">
          {order.map((r, i) => (
            <li key={r.id} className="cg-splits__live-row" data-testid="splits-live-row">
              <span className="cg-splits__live-pos">{i + 1}</span>
              <span className="cg-splits__live-name">{r.name}</span>
              <span className="cg-splits__live-gap">{i === 0 ? `${Math.round(r.d)} m` : `-${Math.round(lead - r.d)} m`}</span>
            </li>
          ))}
        </ol>
      </div>
    );
  }
```
Keep the existing table render for `completed > 0`.

- [ ] **Step 4 — SCSS** (append to `SplitsChart.scss`):
```scss
.cg-splits {
  &__livehdr { font-family: cg.$cg-mono; font-size: 0.62rem; color: cg.$cg-faint; text-transform: uppercase; padding: 4px 4px 2px; }
  &__live { list-style: none; margin: 0; padding: 0 4px; }
  &__live-row { display: flex; align-items: center; gap: 8px; padding: 3px 4px; font-family: cg.$cg-mono; font-size: 0.85rem; border-bottom: 1px solid cg.$cg-border-soft; }
  &__live-pos { color: cg.$cg-faint; font-weight: 700; min-width: 1.2em; }
  &__live-name { flex: 1; color: cg.$cg-text; }
  &__live-gap { color: cg.$cg-cyan; font-weight: 700; }
}
```

- [ ] **Step 5 — Run, expect PASS** (and the existing SplitsChart tests still pass — they use `lapSplits` with entries so `completed > 0`). Build.

- [ ] **Step 6 — Commit:**
```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/panels/SplitsChart.jsx \
        frontend/src/modules/Fitness/widgets/CycleGame/panels/SplitsChart.scss \
        frontend/src/modules/Fitness/widgets/CycleGame/panels/SplitsChart.test.jsx
git commit -m "feat(cycle-game): splits panel shows live order + gaps before laps complete"
```

---

## Task 9: Results screen — manual exit button

Add a manual exit button alongside the 20 s auto-return. The container already renders a "Back to home" button at the results phase (`CycleGameContainer.jsx`, the `<RaceResults>` block) wired to `backToHome` — but it's a plain button below the board. Put an always-visible **Exit** button *inside* the results board so it's reachable without waiting.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/RaceResults.jsx`
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/RaceResults.scss`
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx` (pass `onExit`)
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/RaceResults.test.jsx`

- [ ] **Step 1 — Write the failing test** (add to `RaceResults.test.jsx`):
```jsx
import { fireEvent } from '@testing-library/react';
it('renders an exit button that calls onExit', () => {
  const onExit = vi.fn();
  const { getByTestId } = render(
    <RaceResults standings={standings} riders={riders} winCondition="distance" dnf={[]} animate={false} onExit={onExit} />
  );
  fireEvent.click(getByTestId('race-results-exit'));
  expect(onExit).toHaveBeenCalledTimes(1);
});
```
(Add `import { vi } from 'vitest';` if not present.)

- [ ] **Step 2 — Run, expect FAIL** (`race-results-exit` not found).

- [ ] **Step 3 — Implement** in `RaceResults.jsx`: add `onExit = null` to the destructured props + `onExit: PropTypes.func` to propTypes, and render an exit button near the countdown (replace the countdown block's wrapper so both live together):
```jsx
      <div className="race-results__exit-row">
        {Number.isFinite(secondsLeft) && secondsLeft <= 5 && secondsLeft > 0 && (
          <span className="race-results__countdown" data-testid="race-results-countdown" aria-live="polite">
            Back to lobby in {secondsLeft}…
          </span>
        )}
        {onExit && (
          <button type="button" className="race-results__exit" data-testid="race-results-exit" onClick={onExit}>
            Exit
          </button>
        )}
      </div>
```
(Remove the old standalone countdown `<div>` you're replacing.)

- [ ] **Step 4 — SCSS** (append to `RaceResults.scss`):
```scss
.race-results {
  &__exit-row { margin-top: 16px; flex: 0 0 auto; display: flex; gap: 14px; align-items: center; justify-content: center; }
  &__exit {
    background: cg.$cg-panel; border: 1px solid cg.$cg-border; color: cg.$cg-text;
    font-family: cg.$cg-display; font-weight: 700; font-size: 1rem;
    padding: 8px 22px; border-radius: 10px; cursor: pointer;
  }
  &__exit:hover { border-color: cg.$cg-cyan; }
}
```

- [ ] **Step 5 — Wire `onExit` in the container.** In `CycleGameContainer.jsx`, on the `<RaceResults … />` element, add `onExit={backToHome}` (the same handler the standalone button uses). The standalone "Back to home" button below can stay or be removed — leave it for now.

- [ ] **Step 6 — Run, expect PASS** + build.

- [ ] **Step 7 — Commit:**
```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/RaceResults.jsx \
        frontend/src/modules/Fitness/widgets/CycleGame/RaceResults.scss \
        frontend/src/modules/Fitness/widgets/CycleGame/RaceResults.test.jsx \
        frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx
git commit -m "feat(cycle-game): manual Exit button on the results board"
```

---

## Task 10: History list — winner avatar + crescents (drop the crown)

Replace the 👑 with the winner's avatar; show the other participants as small overlapping crescents/`+N` to the right. `recordRow.js` already supplies `rec.winnerAvatar` and `rec.others[{ id, displayName, avatarSrc }]` — only the JSX/SCSS change.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.jsx`
- Modify: the records-rail SCSS (the file holding `.cgh-record__crown` — likely `CycleGameHome.scss`)

Current (`CycleGameHome.jsx:697-705`):
```jsx
                  <span className="cgh-record__riders">
                    <span className="cgh-record__crown" aria-hidden="true">👑</span>
                    <span className="cgh-record__winner-name">{rec.winnerName}</span>
                    {(rec.others || []).length > 0 && (
                      <span className="cgh-record__more" title={(rec.others || []).map((o) => o.displayName).join(', ')}>+{rec.others.length}</span>
                    )}
                  </span>
```

- [ ] **Step 1 — Implement** — replace the crown with the winner avatar + up to two crescent avatars + `+N`:
```jsx
                  <span className="cgh-record__riders">
                    <span className="cgh-record__avatars">
                      {rec.winnerAvatar && (
                        <img className="cgh-record__winner-avatar" src={rec.winnerAvatar} alt={rec.winnerName}
                          onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                      )}
                      {(rec.others || []).slice(0, 2).map((o, i) => (
                        <img key={o.id || i} className="cgh-record__crescent" src={o.avatarSrc} alt={o.displayName}
                          style={{ zIndex: -1 - i }} title={o.displayName}
                          onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                      ))}
                      {(rec.others || []).length > 2 && (
                        <span className="cgh-record__more" title={(rec.others || []).map((o) => o.displayName).join(', ')}>+{rec.others.length - 2}</span>
                      )}
                    </span>
                    <span className="cgh-record__winner-name">{rec.winnerName}</span>
                  </span>
```

- [ ] **Step 2 — SCSS** (add to the records-rail stylesheet; keep `.cgh-record__more`). The crescents sit *behind* the winner avatar, peeking from the right:
```scss
.cgh-record {
  &__avatars { display: inline-flex; align-items: center; position: relative; }
  &__winner-avatar { width: 26px; height: 26px; border-radius: 50%; object-fit: cover; border: 1px solid rgba(255,255,255,0.85); position: relative; z-index: 1; }
  &__crescent { width: 22px; height: 22px; border-radius: 50%; object-fit: cover; margin-left: -12px; border: 1px solid rgba(0,0,0,0.6); opacity: 0.9; }
  &__more { margin-left: 4px; font-size: 0.7rem; font-weight: 700; opacity: 0.85; }
}
```
Delete the now-unused `.cgh-record__crown` rule if present.

- [ ] **Step 3 — Verify (visual):** `cd frontend && npm run build`; open the cycle-game home/records rail, confirm the winner's face shows with the runners-up crescents peeking to the right (and `+N` when >2 others). No unit test (presentational; `recordRow.js` data is unchanged and already tested).

- [ ] **Step 4 — Commit:**
```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.jsx frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.scss
git commit -m "feat(cycle-game): history shows winner avatar + runner-up crescents (drop crown)"
```

---

## Task 11: Ghost-selection submenu (toggle which ghosts)

When committing a ghost race, first show a roster step listing that race's participants (all on by default, tap to toggle, Select-all), then start with only the selected ghosts. `onSelectGhost` (container) already maps `candidate.participants` → `ghost.riders`, so we just hand it a candidate whose `participants` are pre-filtered.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.jsx` (the `GhostPicker` component)
- Modify: the records-rail/ghost SCSS

Current commit path (`CycleGameHome.jsx:477-484`): second tap calls `onSelect?.(c)` immediately. We insert a roster step between focus and commit.

- [ ] **Step 1 — Add roster state + render to `GhostPicker`.** Add state for the roster step and the excluded set:
```jsx
  const [rosterFor, setRosterFor] = useState(null);        // candidate awaiting roster confirm
  const [excluded, setExcluded] = useState(() => new Set()); // participant ids toggled OFF
```
Change `handleTap` so the second tap opens the roster instead of committing:
```jsx
  const handleTap = (c) => {
    if (focusedId !== c.raceId) { setFocusedId(c.raceId); return; }
    setExcluded(new Set());          // default: all ghosts in
    setRosterFor(c);                 // open the roster submenu
  };
```
Render the roster overlay (inside the picker's JSX, near the candidate list). It lists `rosterFor.participants`, each tappable to toggle, with Select-all and Start:
```jsx
  {rosterFor && (
    <div className="cgh-ghost-roster" data-testid="ghost-roster">
      <div className="cgh-ghost-roster__title">Race against…</div>
      <ul className="cgh-ghost-roster__list">
        {(rosterFor.participants || []).map((p) => {
          const off = excluded.has(p.id);
          return (
            <li key={p.id}
              className={`cgh-ghost-roster__item${off ? ' is-off' : ''}`}
              data-testid="ghost-roster-item"
              onClick={() => setExcluded((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })}>
              <img className="cgh-ghost-roster__avatar" src={p.avatarSrc} alt={p.displayName}
                onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              <span className="cgh-ghost-roster__name">{p.displayName}</span>
              <span className="cgh-ghost-roster__check">{off ? '○' : '●'}</span>
            </li>
          );
        })}
      </ul>
      <div className="cgh-ghost-roster__actions">
        <button type="button" data-testid="ghost-roster-all" onClick={() => setExcluded(new Set())}>Select all</button>
        <button type="button" data-testid="ghost-roster-start"
          disabled={(rosterFor.participants || []).every((p) => excluded.has(p.id))}
          onClick={() => {
            const kept = (rosterFor.participants || []).filter((p) => !excluded.has(p.id));
            onSelect?.({ ...rosterFor, participants: kept });   // commit with the chosen ghosts only
            setRosterFor(null);
          }}>Start</button>
        <button type="button" data-testid="ghost-roster-cancel" onClick={() => setRosterFor(null)}>Back</button>
      </div>
    </div>
  )}
```
`onSelect` is the existing prop (wired to `onSelectGhost` in the container) — it already turns `candidate.participants` into the ghost field, so the pre-filtered list flows straight through with **no container change**.

- [ ] **Step 2 — SCSS** for the roster overlay (add to the ghost/records stylesheet):
```scss
.cgh-ghost-roster {
  position: absolute; inset: 0; z-index: 5; display: flex; flex-direction: column;
  background: rgba(10,10,20,0.96); padding: 16px; gap: 10px; border-radius: 10px;
  &__title { font-family: cg.$cg-display; font-weight: 800; font-size: 1.2rem; color: cg.$cg-text; }
  &__list { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1 1 auto; }
  &__item { display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 8px; cursor: pointer; }
  &__item.is-off { opacity: 0.4; }
  &__avatar { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; }
  &__name { flex: 1; color: cg.$cg-text; }
  &__check { font-size: 1.1rem; color: cg.$cg-cyan; }
  &__actions { display: flex; gap: 8px; justify-content: flex-end; }
  &__actions button { padding: 8px 16px; border-radius: 8px; border: 1px solid cg.$cg-border; background: cg.$cg-panel; color: cg.$cg-text; cursor: pointer; }
  &__actions button:disabled { opacity: 0.4; cursor: default; }
}
```
(Ensure the `GhostPicker` root is `position: relative` so the overlay covers it.)

- [ ] **Step 3 — Test (component).** If `GhostPicker` is exported testably, add a test; otherwise verify via runtime. Minimal unit (only if `GhostPicker` is exported):
```jsx
// in a new CycleGameHome.ghostRoster.test.jsx, importing GhostPicker if exported
// render with candidates=[{raceId:'r1', participants:[{id:'a',displayName:'A',avatarSrc:''},{id:'b',displayName:'B',avatarSrc:''}]}]
// tap the candidate twice → ghost-roster appears; toggle one item off; click Start;
// assert onSelect called with participants length 1
```
If `GhostPicker` is not exported, skip the unit test and verify at runtime (Step 4) — do **not** force an un-exported import.

- [ ] **Step 4 — Verify (runtime/visual):** build; on the cycle-game home, open the ghost picker, tap a race twice → the roster appears; toggle a ghost off; Start → the race begins with only the chosen ghosts (confirm in `cycle_game.config` log that the ghost rider count dropped).

- [ ] **Step 5 — Commit:**
```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.jsx frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.scss
git commit -m "feat(cycle-game): ghost-selection submenu — pick which ghosts to race"
```

---

## Final verification + deploy

- [ ] Full cycle-game unit suite: `npx vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame frontend/src/modules/Fitness/lib/cycleGame frontend/src/modules/Fitness/components` → all pass.
- [ ] Build: `cd frontend && npm run build` → `✓ built`.
- [ ] Deploy (picks up the lap-length config edit on restart): `sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .` then `sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight`.
- [ ] Reload the kiosk; run a distance race + a time race + a 4-rider race and walk the 10 fixes.

## Notes for the implementer

- `cgTokens` import alias varies per file — `@use '../cgTokens' as cg;` in panels, `as t;` in some widget scss. Match the file you're editing. Tokens: `$cg-bg/$cg-panel/$cg-text/$cg-mono/$cg-cyan/$cg-faint/$cg-muted/$cg-border/$cg-border-soft`.
- `effectiveLapLength` is the single source of truth — never read `cycleGameConfig.lap_length_m` raw after Task 5.
- The ghost roster pre-filters `candidate.participants`; `onSelectGhost` is unchanged because it already maps participants → `ghost.riders`.
- Tasks 1, 2 share `yFor` — do Task 1 then Task 2 and re-check the goal line after Task 2.
