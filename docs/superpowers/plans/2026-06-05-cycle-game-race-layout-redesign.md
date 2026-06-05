# Cycle-Game Race Layout Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cycle-game race screen's dynamic, director-driven layout with two fixed layouts chosen by field size, add a vertical Tron/Cruising-USA "POV grid" (the piston chart rotated into a perspective road), fold the race timer into the chart panel, replace rankings with a compact splits chart, and re-couple the oval to laps.

**Architecture:** `RaceLayoutManager` becomes a static template selector (sidebar mode ≤3 riders, wide mode ≥4) instead of running the per-tick `raceDirector`. New presentational panels (`PovGrid`, `SplitsChart`) join existing ones (`DistanceChart`, `SpeedoRow`, `OvalTrack`). `CycleRaceScreen` stops building the director `decision`, passes `fieldSize` + panel factories, and the standalone clock header moves into `DistanceChart`. The leader-anchored zoom (`useLeaderAnchoredZoom`) is reused unchanged — the POV grid maps its `[0,1]` positions to the vertical axis (`topFrac = 1 − pos`) and layers a CSS perspective skew on top.

**Tech Stack:** React (.jsx), SCSS, Vitest + Testing Library (unit), Playwright (`*.runtime.test.mjs`, live). Reference spec: `docs/superpowers/specs/2026-06-05-cycle-game-race-layout-redesign-design.md`.

---

## File structure

**Create**
- `frontend/src/modules/Fitness/widgets/CycleGame/panels/SplitsChart.jsx` (+ `.scss`) — laps×riders splits table with live current-lap count-up + best-lap highlight (extends the existing `LapTable` idea).
- `frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.jsx` (+ `.scss`) — vertical leader-anchored spatial road, 2-D perspective-skewed grid, animated.

**Modify**
- `panels/OvalTrack.jsx` (+ `.scss`) — add a centered lap counter; keep lap-mode progress.
- `panels/DistanceChart.jsx` (+ `.scss`) — render a timer/header strip as the top ~30%.
- `RaceLayoutManager.jsx` (+ `.scss`) — two fixed CSS-grid templates keyed on `fieldSize`.
- `CycleRaceScreen.jsx` — drop director + standalone clock header; pass `fieldSize`, `lapLengthM`, `elapsedS`, `timeCapS` into panels; wire new panels.

**Remove (after the new layout is live)**
- `panels/Rankings.jsx`, `panels/CameraZoom.jsx`, `panels/RacePistons.jsx`, `panels/LapPanel.jsx`, `panels/LapTable.jsx`.
- `lib/cycleGame/raceDirector.js`, `lib/cycleGame/racePanels.js`.
- Their tests; update `CycleRaceScreen`/layout tests.

**Key existing interfaces (already verified)**
- `riders[id].cumulativeDistanceM` (number), `riders[id].lapSplits` (array of cumulative crossing times in seconds; element `i` = time crossing end of lap `i+1`), `riders[id].displayName`, `riders[id].finishTimeS`, `riders[id].isGhost`.
- `riderLive[id]` = `{ avatarSrc, heartRate, zoneId, zoneColor, penalized }`.
- `useLeaderAnchoredZoom(distances)` → `{ kFrac, gridMeters, leaderDist, rightPct, xForDist(d)→[0,1], lines:[{m,x}] }` (`lib/cycleGame/useLeaderAnchoredZoom.js`).
- `lapCount(distanceM, lapLengthM)`, `lapProgress(distanceM, lapLengthM)` (`lib/cycleGame/lapModel.js`).
- `ovalProgressFor({winCondition, distanceM, goalM, ovalCircuitM, lapLengthM})` → fraction around the loop; already wraps per lap when `lapLengthM > 0` (`lib/cycleGame/ovalTrackModel.js`).
- `LINE_COLORS` (`lib/cycleGame/lineColors.js`), `formatClock` (`lib/cycleGame/cycleGameLobby.js`), `formatDistance` (`lib/cycleGame/formatDistance.js`).
- Run a single vitest file: `npx vitest run --config vitest.config.mjs <path>`. Build: `cd frontend && npm run build`. Runtime: `npx playwright test <path> --reporter=line`.

---

## Task 1: SplitsChart panel

A laps×riders table: completed laps show per-lap split times, a final **current-lap row** shows a live count-up per rider (`elapsedS − lastCrossing`), each rider's **best** completed lap is highlighted. Compact; newest completed laps stay visible.

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/CycleGame/panels/SplitsChart.jsx`
- Create: `frontend/src/modules/Fitness/widgets/CycleGame/panels/SplitsChart.scss`
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/panels/SplitsChart.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// SplitsChart.test.jsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import SplitsChart from './SplitsChart.jsx';

const riders = {
  felix: { displayName: 'Felix', cumulativeDistanceM: 250, lapSplits: [41, 79] }, // laps: 41, 38
  milo:  { displayName: 'Milo',  cumulativeDistanceM: 250, lapSplits: [43, 85] }  // laps: 43, 42
};

describe('SplitsChart', () => {
  it('renders one column per rider and one row per completed lap', () => {
    const { getAllByTestId } = render(
      <SplitsChart riderIds={['felix','milo']} riders={riders}
        lapLengthM={100} elapsedS={120} />
    );
    expect(getAllByTestId('splits-rider').length).toBe(2);
    expect(getAllByTestId('splits-lap-row').length).toBe(2); // 2 completed laps
  });

  it('shows the per-lap delta (not cumulative) for completed laps', () => {
    const { getAllByTestId } = render(
      <SplitsChart riderIds={['felix']} riders={{ felix: riders.felix }}
        lapLengthM={100} elapsedS={120} />
    );
    const cells = getAllByTestId('splits-cell').map((c) => c.textContent);
    // lap1 = 41-0 = 0:41 ; lap2 = 79-41 = 0:38
    expect(cells[0]).toContain('0:41');
    expect(cells[1]).toContain('0:38');
  });

  it('renders a current-lap row counting up from the last crossing', () => {
    const { getByTestId } = render(
      <SplitsChart riderIds={['felix']} riders={{ felix: riders.felix }}
        lapLengthM={100} elapsedS={100} />
    );
    // current lap (lap 3, dist 250 → 2 full laps done, last crossing 79s)
    // running = 100 - 79 = 21s
    const cur = getByTestId('splits-current');
    expect(cur.textContent).toContain('0:21');
  });

  it('marks each rider\'s best completed lap', () => {
    const { container } = render(
      <SplitsChart riderIds={['felix']} riders={{ felix: riders.felix }}
        lapLengthM={100} elapsedS={120} />
    );
    // felix laps 41,38 → best = lap 2 (38)
    const best = container.querySelectorAll('.cg-splits__cell--best');
    expect(best.length).toBe(1);
    expect(best[0].textContent).toContain('0:38');
  });

  it('shows an empty state when laps are disabled', () => {
    const { getByTestId } = render(
      <SplitsChart riderIds={['felix']} riders={{ felix: { displayName: 'Felix', cumulativeDistanceM: 50 } }}
        lapLengthM={0} elapsedS={10} />
    );
    expect(getByTestId('splits-empty')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/panels/SplitsChart.test.jsx`
Expected: FAIL — `Failed to resolve import "./SplitsChart.jsx"`.

- [ ] **Step 3: Implement `SplitsChart.jsx`**

```jsx
import React from 'react';
import PropTypes from 'prop-types';
import { LINE_COLORS } from '@/modules/Fitness/lib/cycleGame/lineColors.js';
import { formatClock } from '@/modules/Fitness/lib/cycleGame/cycleGameLobby.js';
import { lapCount } from '@/modules/Fitness/lib/cycleGame/lapModel.js';
import './SplitsChart.scss';

/**
 * Compact lap-splits table — laps down the rows (newest completed at the bottom),
 * one column per rider. Completed laps show the per-lap delta; a final row shows the
 * current lap counting up live (elapsedS − last crossing). Each rider's best lap is
 * highlighted. Order is read from the POV grid, so there is no ranking here.
 *
 * `riders[id].lapSplits` = cumulative crossing times (s); element i = end of lap i+1.
 */
export default function SplitsChart({ riderIds, riders, lapLengthM = 0, elapsedS = 0 }) {
  const lapsOn = Number.isFinite(lapLengthM) && lapLengthM > 0;
  if (!lapsOn) {
    return (
      <div className="cg-splits" data-testid="race-splits">
        <div className="cg-splits__empty" data-testid="splits-empty">No laps</div>
      </div>
    );
  }

  const splitsOf = (id) => riders[id]?.lapSplits || [];
  const completed = Math.max(0, ...riderIds.map((id) => splitsOf(id).length));
  const lapDelta = (id, i) => { const s = splitsOf(id); return i < s.length ? s[i] - (s[i - 1] || 0) : null; };
  const bestLapIdx = (id) => {
    const s = splitsOf(id); let best = -1, bestT = Infinity;
    for (let i = 0; i < s.length; i++) { const d = s[i] - (s[i - 1] || 0); if (d < bestT) { bestT = d; best = i; } }
    return best;
  };
  const currentLapRunning = (id) => {
    const s = splitsOf(id);
    return Math.max(0, elapsedS - (s[s.length - 1] || 0));
  };
  const curLapNo = (id) => lapCount(riders[id]?.cumulativeDistanceM || 0, lapLengthM) + 1;
  const best = Object.fromEntries(riderIds.map((id) => [id, bestLapIdx(id)]));

  return (
    <div className="cg-splits" data-testid="race-splits">
      <table className="cg-splits__table">
        <thead>
          <tr>
            <th className="cg-splits__corner" aria-hidden="true">Lap</th>
            {riderIds.map((id, idx) => (
              <th key={id} className="cg-splits__rider" data-testid="splits-rider">
                <span className="cg-splits__dot" style={{ background: LINE_COLORS[idx % LINE_COLORS.length] }} />
                {riders[id]?.displayName || id}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: completed }, (_, i) => (
            <tr key={`lap-${i}`} className="cg-splits__row" data-testid="splits-lap-row">
              <th scope="row" className="cg-splits__lap">{i + 1}</th>
              {riderIds.map((id) => {
                const d = lapDelta(id, i);
                const isBest = best[id] === i;
                return (
                  <td key={id} data-testid="splits-cell"
                    className={`cg-splits__cell${isBest ? ' cg-splits__cell--best' : ''}`}>
                    {d == null ? '—' : formatClock(d)}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr className="cg-splits__row cg-splits__row--current">
            <th scope="row" className="cg-splits__lap">{Math.max(...riderIds.map(curLapNo))}•</th>
            {riderIds.map((id) => (
              <td key={id} className="cg-splits__cell cg-splits__cell--current" data-testid="splits-current">
                {formatClock(currentLapRunning(id))}…
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

SplitsChart.propTypes = {
  riderIds: PropTypes.array.isRequired,
  riders: PropTypes.object.isRequired,
  lapLengthM: PropTypes.number,
  elapsedS: PropTypes.number
};
```

- [ ] **Step 4: Implement `SplitsChart.scss`**

```scss
@use '../cgTokens' as cg;

.cg-splits {
  width: 100%; height: 100%; min-height: 0; overflow: hidden;
  display: flex; flex-direction: column; box-sizing: border-box; padding: 4px 6px;

  &__empty { margin: auto; color: cg.$cg-faint; font-size: 0.9rem; }

  &__table { width: 100%; border-collapse: collapse; font-family: cg.$cg-mono; font-size: 0.78rem; }
  &__corner { text-align: left; color: cg.$cg-faint; font-size: 0.62rem; padding: 2px 4px; }
  &__rider { text-align: right; color: cg.$cg-muted; font-weight: 600; padding: 2px 4px;
             border-bottom: 1px solid cg.$cg-border-soft; white-space: nowrap; }
  &__dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
  &__lap { text-align: left; color: cg.$cg-faint; font-weight: 700; padding: 1px 4px; }
  &__cell { text-align: right; color: cg.$cg-text; padding: 1px 4px; }
  &__row:nth-child(even) .cg-splits__cell { background: rgba(255, 255, 255, 0.02); }
  &__cell--best { color: cg.$cg-lane-1; font-weight: 700; }
  &__row--current .cg-splits__cell--current { color: cg.$cg-gold; }
}
```

- [ ] **Step 5: Run tests, expect PASS**

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/panels/SplitsChart.test.jsx`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/panels/SplitsChart.jsx \
        frontend/src/modules/Fitness/widgets/CycleGame/panels/SplitsChart.scss \
        frontend/src/modules/Fitness/widgets/CycleGame/panels/SplitsChart.test.jsx
git commit -m "feat(cycle-game): SplitsChart panel (laps×riders, live current lap, best highlight)"
```

---

## Task 2: PovGrid panel

The vertical leader-anchored road. Reuses `useLeaderAnchoredZoom` (positions in `[0,1]`, leader high) and maps each position to the vertical axis with `topFrac = 1 − pos` (leader near top/far, trailer near bottom/near). Renders a 2-D grid (the zoom's metre lines as horizontal rules + lane verticals) inside a CSS-perspective plane that animates toward the camera. One lane column per rider; a tip avatar per rider at its `topFrac`.

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.jsx`
- Create: `frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.scss`
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// PovGrid.test.jsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import PovGrid from './PovGrid.jsx';

const riders = {
  a: { displayName: 'A', cumulativeDistanceM: 1000 }, // leader
  b: { displayName: 'B', cumulativeDistanceM: 940 }   // trailer
};
const topPct = (el) => parseFloat(el.style.top);

describe('PovGrid', () => {
  it('renders the road, a lane marker per rider, and metre gridlines', () => {
    const { getAllByTestId, getByTestId } = render(
      <PovGrid riderIds={['a','b']} riders={riders} riderLive={{ a:{}, b:{} }} />
    );
    expect(getByTestId('pov-road')).toBeInTheDocument();
    expect(getAllByTestId('pov-marker').length).toBe(2);
    expect(getByTestId('pov-grid').querySelectorAll('.cg-pov__hline').length).toBeGreaterThan(0);
  });

  it('places the leader nearer the top (far) than the trailer', () => {
    const { getAllByTestId } = render(
      <PovGrid riderIds={['a','b']} riders={riders} riderLive={{ a:{}, b:{} }} />
    );
    const [a, b] = getAllByTestId('pov-marker'); // DOM order follows riderIds [a,b]
    expect(topPct(a)).toBeLessThan(topPct(b)); // leader 'a' higher up
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** (`Failed to resolve import "./PovGrid.jsx"`)

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.test.jsx`

- [ ] **Step 3: Implement `PovGrid.jsx`**

```jsx
import React from 'react';
import PropTypes from 'prop-types';
import CircularUserAvatar from '@/modules/Fitness/components/CircularUserAvatar.jsx';
import { LINE_COLORS } from '@/modules/Fitness/lib/cycleGame/lineColors.js';
import { formatDistance } from '@/modules/Fitness/lib/cycleGame/formatDistance.js';
import { useLeaderAnchoredZoom } from '@/modules/Fitness/lib/cycleGame/useLeaderAnchoredZoom.js';
import './PovGrid.scss';

/**
 * POV piston grid — the leader-anchored spatial standings as a vertical Tron road.
 * Reuses the horizontal piston math: useLeaderAnchoredZoom returns positions in
 * [0,1] (leader high). We map each to the vertical axis with topFrac = 1 − pos, so
 * the leader sits near the top (far, toward the vanishing point) and the trailer
 * near the bottom (near the camera). Same zoom/pan/rezoom rules — only the axis
 * changes. A CSS perspective skew (.cg-pov__plane) turns it into a 3-D road; the
 * metre gridlines double as the road's depth lines and pan/glide as the leader
 * advances. One lane column per rider; the tip avatar rides each lane at its depth.
 */
export default function PovGrid({ riderIds, riders, riderLive = {} }) {
  const distOf = (id) => Math.max(0, riders[id]?.cumulativeDistanceM || 0);
  const zoom = useLeaderAnchoredZoom(riderIds.map(distOf));
  const topOf = (id) => 1 - zoom.xForDist(distOf(id)); // leader pos high → small top
  const laneX = (idx) => riderIds.length <= 1 ? 50 : 12 + (idx * (76 / (riderIds.length - 1)));

  return (
    <div className="cg-pov" data-testid="race-pov">
      <div className="cg-pov__plane" data-testid="pov-road">
        {/* depth gridlines (metre marks) — horizontal rules that pan + re-space */}
        <div className="cg-pov__grid" data-testid="pov-grid" aria-hidden="true">
          {zoom.lines.map((l) => (
            <div key={l.m} className="cg-pov__hline" style={{ top: `${((1 - l.x) * 100).toFixed(2)}%` }} />
          ))}
          {/* lane verticals converging toward the vanishing point */}
          {riderIds.map((id, idx) => (
            <div key={`v-${id}`} className="cg-pov__vline" style={{ left: `${laneX(idx)}%` }} />
          ))}
        </div>

        {riderIds.map((id, idx) => {
          const color = LINE_COLORS[idx % LINE_COLORS.length];
          const isGhost = !!riders[id]?.isGhost;
          const live = riderLive[id] || {};
          return (
            <div key={id} className={`cg-pov__marker${isGhost ? ' is-ghost' : ''}`}
              data-testid="pov-marker"
              style={{ top: `${(topOf(id) * 100).toFixed(2)}%`, left: `${laneX(idx)}%`, '--cg-pov-color': color }}>
              {(() => {
                const avatar = (
                  <CircularUserAvatar name={riders[id]?.displayName} avatarSrc={live.avatarSrc}
                    heartRate={live.heartRate} zoneId={live.zoneId} zoneColor={live.zoneColor || color}
                    size={34} showGauge={false} showIndicator={false} />
                );
                return isGhost ? <span className="cg-ghost">{avatar}</span> : avatar;
              })()}
              <span className="cg-pov__dist">{formatDistance(distOf(id))}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

PovGrid.propTypes = {
  riderIds: PropTypes.array.isRequired,
  riders: PropTypes.object.isRequired,
  riderLive: PropTypes.object
};
```

- [ ] **Step 4: Implement `PovGrid.scss`** (perspective road + animated grid; markers glide via `top`/`left`)

```scss
@use '../cgTokens' as cg;

.cg-pov {
  position: relative; width: 100%; height: 100%; min-height: 0; overflow: hidden;
  background: radial-gradient(130% 80% at 50% 6%, #2a0a3a 0%, #0a0118 70%);
  perspective: 520px; perspective-origin: 50% 18%;

  // The road plane, tilted back so the top recedes to a vanishing point.
  &__plane {
    position: absolute; inset: 0;
    transform-style: preserve-3d;
    transform: rotateX(38deg) scale(1.05);
    transform-origin: 50% 100%;
  }

  &__grid { position: absolute; inset: 0; pointer-events: none; }
  // Depth lines (metre marks). top is driven by the zoom; glides on pan/rezoom.
  &__hline {
    position: absolute; left: 0; right: 0; height: 1px;
    background: rgba(cg.$cg-cyan, 0.35);
    transition: top 0.9s linear;
  }
  // Lane lines converging toward the vanishing point.
  &__vline {
    position: absolute; top: 0; bottom: 0; width: 1px;
    background: rgba(cg.$cg-magenta, 0.30);
  }

  // Rider tip riding the road; glides on top/left.
  &__marker {
    position: absolute; transform: translate(-50%, -50%);
    display: flex; flex-direction: column; align-items: center; gap: 2px;
    transition: top 0.9s linear, left 0.9s linear;
    z-index: 2;
    .circular-user-avatar { width: 34px !important; height: 34px !important; --vital-avatar-size: 34px; }
    &.is-ghost { opacity: 0.6; }
  }
  &__dist {
    font-family: cg.$cg-mono; font-weight: 800; font-size: 0.62rem; color: cg.$cg-cyan;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.85); white-space: nowrap;
  }
}
```

- [ ] **Step 5: Run tests, expect PASS**

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.jsx \
        frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.scss \
        frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.test.jsx
git commit -m "feat(cycle-game): PovGrid panel (vertical leader-anchored Tron road)"
```

---

## Task 3: OvalTrack lap counter

`OvalTrack` already receives `progress` (lap-mode when `lapLengthM > 0`, via `ovalProgressFor`). Add a centered **lap counter** showing the leader's current lap, and accept a `lapLabel` prop so the screen can pass it.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/panels/OvalTrack.jsx`
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/panels/OvalTrack.scss`
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/panels/OvalTrack.test.jsx` (extend if exists, else create)

- [ ] **Step 1: Write/extend the failing test**

```jsx
// add to OvalTrack.test.jsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import OvalTrack from './OvalTrack.jsx';

describe('OvalTrack lap counter', () => {
  it('renders the lap label in the center when provided', () => {
    const { getByTestId } = render(
      <OvalTrack riderIds={['a']} riders={{ a: { displayName: 'A' } }}
        progress={{ a: 0.4 }} lapLabel="Lap 3" />
    );
    expect(getByTestId('oval-lap-label').textContent).toBe('Lap 3');
  });
  it('omits the lap label when not provided', () => {
    const { queryByTestId } = render(
      <OvalTrack riderIds={['a']} riders={{ a: { displayName: 'A' } }} progress={{ a: 0.4 }} />
    );
    expect(queryByTestId('oval-lap-label')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** (`oval-lap-label` not found)

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/panels/OvalTrack.test.jsx`

- [ ] **Step 3: Implement** — add a `lapLabel` prop and render it centered.

In `OvalTrack.jsx`: add `lapLabel = null` to the destructured props, add to `propTypes` (`lapLabel: PropTypes.string`), and inside the oval's centered area render:

```jsx
{lapLabel ? (
  <div className="cg-oval__lap-label" data-testid="oval-lap-label">{lapLabel}</div>
) : null}
```

In `OvalTrack.scss` add:

```scss
.cg-oval__lap-label {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  font-family: cg.$cg-mono; font-weight: 800; font-size: 1.1rem; color: cg.$cg-text;
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.8); pointer-events: none; z-index: 3;
}
```
(Confirm the oval root is `position: relative`; if not, add it.)

- [ ] **Step 4: Run tests, expect PASS**

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/panels/OvalTrack.test.jsx`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/panels/OvalTrack.jsx \
        frontend/src/modules/Fitness/widgets/CycleGame/panels/OvalTrack.scss \
        frontend/src/modules/Fitness/widgets/CycleGame/panels/OvalTrack.test.jsx
git commit -m "feat(cycle-game): OvalTrack centered lap counter"
```

---

## Task 4: DistanceChart timer/header strip

Fold the race clock into the top ~30% of the chart panel. `DistanceChart` gains `winCondition`, `clockSeconds`, `goalM`, `maxDistanceM` props for the header; the SVG/plot occupies the remaining ~70%.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.jsx`
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.scss`
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// add to DistanceChart.test.jsx
it('renders a header strip with the clock and goal label', () => {
  const { getByTestId } = render(
    <DistanceChart riderIds={['a']} riders={{ a: { userId:'a', displayName:'A', cumulativeDistanceM: 50, distanceSeries:[50] } }}
      riderLive={{ a:{} }} winCondition="time" goalM={3000} elapsedS={5}
      clockSeconds={55} maxDistanceM={50} />
  );
  const hdr = getByTestId('chart-header');
  expect(hdr.textContent).toContain('0:55');     // formatClock(55)
  expect(hdr.textContent.toLowerCase()).toContain('time left');
});
```

- [ ] **Step 2: Run it, expect FAIL** (`chart-header` not found)

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.test.jsx`

- [ ] **Step 3: Implement** — add props + a header strip wrapping the existing chart.

In `DistanceChart.jsx`:
- Add to destructured props: `clockSeconds = 0, maxDistanceM = 0` (keep existing `winCondition`, `goalM`).
- Import `formatClock` from `cycleGameLobby.js` and `formatDistance` from `formatDistance.js` (if not already).
- Wrap the returned chart in a column container with a header strip on top:

```jsx
return (
  <div className="cg-chart" data-testid="distance-chart">
    <div className="cg-chart__header" data-testid="chart-header">
      <span className="cg-chart__clock-label">{winCondition === 'time' ? 'Time left' : 'Elapsed'}</span>
      <span className="cg-chart__clock">{formatClock(clockSeconds)}</span>
      <span className="cg-chart__goal">
        {winCondition === 'distance' ? `to ${formatDistance(goalM)}` : `${formatDistance(maxDistanceM)} led`}
      </span>
    </div>
    <div className="cg-chart__plot">
      {/* existing chart SVG/markup unchanged, moved inside this wrapper */}
    </div>
  </div>
);
```
Move the current returned chart markup into `.cg-chart__plot` verbatim. Keep `zoneBox`-based sizing: the plot should size from `zoneBox.height * 0.7` (subtract the header). If the chart reads `zoneBox` for height, multiply the usable height by ~0.7, or let CSS flex handle it (see scss).

In `DistanceChart.scss` add:

```scss
.cg-chart {
  width: 100%; height: 100%; min-height: 0; display: flex; flex-direction: column; box-sizing: border-box;
  &__header {
    flex: 0 0 30%; min-height: 0; display: flex; align-items: center; justify-content: center; gap: 10px;
    border-bottom: 1px solid cg.$cg-border-soft;
    .cg-chart__clock-label { font-size: 0.7rem; text-transform: uppercase; color: cg.$cg-faint; }
    .cg-chart__clock { font-family: cg.$cg-mono; font-weight: 800; font-size: 1.6rem; color: cg.$cg-text; }
    .cg-chart__goal { font-size: 0.7rem; color: cg.$cg-muted; }
  }
  &__plot { flex: 1 1 auto; min-height: 0; position: relative; }
}
```
Update `DistanceChart.test.jsx` existing tests if they query the old root — the chart SVG now lives under `.cg-chart__plot` but `data-testid="race-line"` etc. are unchanged.

- [ ] **Step 4: Run the full DistanceChart suite, expect PASS**

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.test.jsx`
Expected: PASS (existing tests + the new header test). Fix any selector drift inline.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.jsx \
        frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.scss \
        frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.test.jsx
git commit -m "feat(cycle-game): fold race clock into DistanceChart header (top 30%)"
```

---

## Task 5: RaceLayoutManager — two fixed templates

Replace the director-driven zone layout with two static CSS-grid templates selected by `fieldSize`. The component takes named panel factories and a `fieldSize`; no `decision`, no `solo` branch.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/RaceLayoutManager.jsx` (rewrite)
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/RaceLayoutManager.scss` (rewrite)
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/RaceLayoutManager.test.jsx` (replace)

- [ ] **Step 1: Write the failing test**

```jsx
// RaceLayoutManager.test.jsx (replace contents)
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import RaceLayoutManager from './RaceLayoutManager.jsx';

const panels = {
  distanceChart: () => <div data-testid="p-chart" />,
  splitsChart:   () => <div data-testid="p-splits" />,
  povGrid:       () => <div data-testid="p-pov" />,
  ovalTrack:     () => <div data-testid="p-oval" />,
  speedoRow:     () => <div data-testid="p-speedo" />
};

describe('RaceLayoutManager', () => {
  it('sidebar mode (≤3): chart, splits, pov, oval, speedo all present', () => {
    const { getByTestId } = render(<RaceLayoutManager panels={panels} fieldSize={2} />);
    ['p-chart','p-splits','p-pov','p-oval','p-speedo'].forEach((t) => expect(getByTestId(t)).toBeInTheDocument());
    expect(getByTestId('race-layout').dataset.mode).toBe('sidebar');
  });
  it('wide mode (≥4): no oval; chart, splits, pov, speedo present', () => {
    const { getByTestId, queryByTestId } = render(<RaceLayoutManager panels={panels} fieldSize={4} />);
    ['p-chart','p-splits','p-pov','p-speedo'].forEach((t) => expect(getByTestId(t)).toBeInTheDocument());
    expect(queryByTestId('p-oval')).toBeNull();
    expect(getByTestId('race-layout').dataset.mode).toBe('wide');
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** (old component renders the director layout, no `data-mode`)

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/RaceLayoutManager.test.jsx`

- [ ] **Step 3: Rewrite `RaceLayoutManager.jsx`**

```jsx
import React from 'react';
import PropTypes from 'prop-types';
import PanelSlot from './panels/PanelSlot.jsx';
import './RaceLayoutManager.scss';

// Render one named panel into a slot, or nothing if the factory is absent.
function Slot({ id, panels, testid, cls }) {
  const factory = id ? panels[id] : null;
  return (
    <div className={`race-layout__zone ${cls}${factory ? '' : ' race-layout__zone--empty'}`} data-testid={testid}>
      {factory ? <PanelSlot key={id} panelId={id} render={factory} /> : null}
    </div>
  );
}
Slot.propTypes = { id: PropTypes.string, panels: PropTypes.object, testid: PropTypes.string, cls: PropTypes.string };

/**
 * Fixed race layout, chosen by field size:
 *  - sidebar (≤3 riders): main panel (chart top-left, splits top-right, speedos band)
 *    + right sidebar (POV grid top ~70%, oval bottom ~30%).
 *  - wide (≥4 riders): top row of three equal columns (chart | splits | POV),
 *    speedometers full-width below; no oval.
 */
export default function RaceLayoutManager({ panels = {}, fieldSize = 0 }) {
  const wide = fieldSize >= 4;
  const p = (id, testid, cls) => <Slot id={id} panels={panels} testid={testid} cls={cls} />;

  if (wide) {
    return (
      <div className="race-layout race-layout--wide" data-testid="race-layout" data-mode="wide">
        <div className="race-layout__top3">
          {p('distanceChart', 'zone-chart', 'race-layout__zone--chart')}
          {p('splitsChart', 'zone-splits', 'race-layout__zone--splits')}
          {p('povGrid', 'zone-pov', 'race-layout__zone--pov')}
        </div>
        {p('speedoRow', 'zone-speedo', 'race-layout__zone--speedo')}
      </div>
    );
  }

  return (
    <div className="race-layout race-layout--sidebar" data-testid="race-layout" data-mode="sidebar">
      <div className="race-layout__main">
        <div className="race-layout__main-top">
          {p('distanceChart', 'zone-chart', 'race-layout__zone--chart')}
          {p('splitsChart', 'zone-splits', 'race-layout__zone--splits')}
        </div>
        {p('speedoRow', 'zone-speedo', 'race-layout__zone--speedo')}
      </div>
      <div className="race-layout__sidebar">
        {p('povGrid', 'zone-pov', 'race-layout__zone--pov')}
        {p('ovalTrack', 'zone-oval', 'race-layout__zone--oval')}
      </div>
    </div>
  );
}
RaceLayoutManager.propTypes = { panels: PropTypes.object, fieldSize: PropTypes.number };
```

- [ ] **Step 4: Rewrite `RaceLayoutManager.scss`**

```scss
.race-layout {
  width: 100%; height: 100%; min-height: 0; box-sizing: border-box;
  &__zone { min-width: 0; min-height: 0; overflow: hidden; }
  &__zone--empty { display: none; }

  // ── sidebar mode ──────────────────────────────────────────────
  &--sidebar { display: grid; grid-template-columns: 68% 32%; gap: 8px; }
  .race-layout__main { display: grid; grid-template-rows: 1fr minmax(240px, 48%); gap: 8px; min-height: 0; }
  .race-layout__main-top { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; min-height: 0; }
  .race-layout__sidebar { display: grid; grid-template-rows: 70% 30%; gap: 8px; min-height: 0; }

  // ── wide mode ─────────────────────────────────────────────────
  &--wide { display: grid; grid-template-rows: 1fr minmax(240px, 42%); gap: 8px; }
  .race-layout__top3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; min-height: 0; }
}
```

- [ ] **Step 5: Run tests, expect PASS**

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/RaceLayoutManager.test.jsx`

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/RaceLayoutManager.jsx \
        frontend/src/modules/Fitness/widgets/CycleGame/RaceLayoutManager.scss \
        frontend/src/modules/Fitness/widgets/CycleGame/RaceLayoutManager.test.jsx
git commit -m "feat(cycle-game): RaceLayoutManager two fixed templates by field size"
```

---

## Task 6: Rewire CycleRaceScreen

Drop the director + standalone clock header; build the new panel set; pass `fieldSize` to the layout. Clock now lives in `DistanceChart`; lap label feeds the oval.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.jsx`
- Test: existing `CycleRaceScreen.test.jsx` (update assertions)

- [ ] **Step 1: Update the failing test**

Replace any director/`decision` assertions. Add:

```jsx
it('renders sidebar mode for ≤3 riders with chart, splits, pov, oval, speedo', () => {
  const { getByTestId, queryByTestId } = render(<CycleRaceScreen {...base2RiderProps} />);
  expect(getByTestId('race-layout').dataset.mode).toBe('sidebar');
  expect(getByTestId('distance-chart')).toBeInTheDocument();
  expect(getByTestId('race-splits')).toBeInTheDocument();
  expect(getByTestId('race-pov')).toBeInTheDocument();
});
it('renders wide mode (no oval) for 4+ riders', () => {
  const { getByTestId, queryByTestId } = render(<CycleRaceScreen {...base4RiderProps} />);
  expect(getByTestId('race-layout').dataset.mode).toBe('wide');
  expect(queryByTestId('zone-oval')).toBeNull();
});
```
(Define `base2RiderProps`/`base4RiderProps` from the existing test's fixtures with 2 and 4 `riders` entries.)

- [ ] **Step 2: Run it, expect FAIL**

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.test.jsx`

- [ ] **Step 3: Implement the rewire**

In `CycleRaceScreen.jsx`:
- Remove imports: `raceDirector`, `Rankings`, `LapPanel`, `RacePistons`, `CameraZoom`. Remove the `deriveRaceSnapshot`/`prevSnapRef`/`prevDecisionRef`/`decision` block.
- Add imports: `SplitsChart from './panels/SplitsChart.jsx'`, `PovGrid from './panels/PovGrid.jsx'`, `OvalTrack from './panels/OvalTrack.jsx'`, and keep `ovalProgressFor`, `lapCount` (`from '@/modules/Fitness/lib/cycleGame/lapModel.js'`).
- Remove the `cycle-race-screen__clock-frame` block (the clock moves into the chart). Keep the penalty banner.
- Compute `fieldSize = riderIds.length`, `clockSeconds` (existing), `maxDistance` (existing), and the leader lap label:

```jsx
const fieldSize = riderIds.length;
const leaderLap = lapLengthM > 0
  ? lapCount(Math.max(0, ...riderIds.map((id) => riders[id]?.cumulativeDistanceM || 0)), lapLengthM) + 1
  : 0;
const ovalProgress = Object.fromEntries(riderIds.map((id) => [
  id, ovalProgressFor({ winCondition, distanceM: riders[id]?.cumulativeDistanceM || 0, goalM, ovalCircuitM, lapLengthM })
]));
```
- Replace the `panels` object:

```jsx
const panels = {
  distanceChart: (slot) => (
    <DistanceChart riderIds={riderIds} riders={riders} riderLive={riderLive}
      winCondition={winCondition} goalM={goalM} events={events} elapsedS={elapsedS}
      clockSeconds={clockSeconds} maxDistanceM={maxDistance} zoneBox={slot?.zoneBox} />
  ),
  splitsChart: () => (
    <SplitsChart riderIds={riderIds} riders={riders} lapLengthM={lapLengthM} elapsedS={elapsedS} />
  ),
  povGrid: () => (
    <PovGrid riderIds={riderIds} riders={riders} riderLive={riderLive} />
  ),
  ovalTrack: () => (
    <OvalTrack riderIds={riderIds} riders={riders} riderLive={riderLive}
      progress={ovalProgress} lapLabel={leaderLap > 0 ? `Lap ${leaderLap}` : null} />
  ),
  ...(showSpeedos ? {
    speedoRow: (slot) => (
      <SpeedoRow riderIds={riderIds} riders={riders} riderLive={riderLive}
        cadenceBands={cadenceBands} zoneBox={slot?.zoneBox}
        maxGauge={fieldSize <= 3 ? 360 : 280} minGauge={fieldSize <= 3 ? 220 : 96} />
    )
  } : {})
};
```
- Replace the layout render:

```jsx
<RaceLayoutManager panels={panels} fieldSize={fieldSize} />
```
- Remove the now-unused `solo` const and the `formatClock`/`formatDistance` imports only if no longer used (the clock label moved into DistanceChart; `formatDistance` may still be used for `maxDistance` — keep what's referenced).

- [ ] **Step 4: Run tests + build, expect PASS / clean**

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.test.jsx`
Run: `cd frontend && npm run build` → Expected: `✓ built`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.jsx \
        frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.test.jsx
git commit -m "feat(cycle-game): rewire CycleRaceScreen to fixed layouts + new panels"
```

---

## Task 7: Retire the director and old panels

Delete the now-unused components, registry, and director; remove their tests; record deletions.

**Files:**
- Delete: `panels/Rankings.jsx` (+scss/test), `panels/CameraZoom.jsx` (+scss/test), `panels/RacePistons.jsx` (+scss/test), `panels/LapPanel.jsx` (+test), `panels/LapTable.jsx` (+scss/test), `lib/cycleGame/raceDirector.js` (+test), `lib/cycleGame/racePanels.js` (+test).
- Check: `lib/cycleGame/layoutSizing.js`, `lib/cycleGame/layoutMonitor.js` (+tests) — only delete if no remaining importer (the new `RaceLayoutManager` doesn't use them). Grep first.

- [ ] **Step 1: Find remaining importers before deleting**

```bash
cd /opt/Code/DaylightStation
for f in Rankings CameraZoom RacePistons LapPanel LapTable raceDirector racePanels layoutSizing layoutMonitor; do
  echo "== $f =="; grep -rln "$f" frontend/src --include=*.jsx --include=*.js | grep -v "$f\.\(test\.\)\?\(jsx\|js\)$"
done
```
Expected: no non-test importers for Rankings/CameraZoom/RacePistons/LapPanel/LapTable/raceDirector/racePanels after Task 6. If `layoutSizing`/`layoutMonitor` still have importers, leave them.

- [ ] **Step 2: Delete the files (only those with no remaining importer)**

```bash
cd /opt/Code/DaylightStation/frontend/src/modules/Fitness/widgets/CycleGame
git rm panels/Rankings.jsx panels/Rankings.scss panels/Rankings.test.jsx 2>/dev/null
git rm panels/CameraZoom.jsx panels/CameraZoom.scss panels/CameraZoom.test.jsx 2>/dev/null
git rm panels/RacePistons.jsx panels/RacePistons.scss panels/RacePistons.test.jsx 2>/dev/null
git rm panels/LapPanel.jsx panels/LapPanel.test.jsx 2>/dev/null
git rm panels/LapTable.jsx panels/LapTable.scss panels/LapTable.test.jsx 2>/dev/null
cd /opt/Code/DaylightStation/frontend/src/modules/Fitness/lib/cycleGame
git rm raceDirector.js raceDirector.test.js racePanels.js racePanels.test.js 2>/dev/null
```
(Adjust to the actual `.scss`/`.test` files that exist; `git rm` errors for missing files are fine to ignore.)

- [ ] **Step 3: Run the full cycle-game unit suite, expect PASS (no broken imports)**

Run: `npx vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame frontend/src/modules/Fitness/lib/cycleGame`
Expected: PASS. If a deleted module is still imported by a surviving test (e.g. `deriveRaceSnapshot.test`), fix or remove the stale reference inline.

- [ ] **Step 4: Build, expect clean**

Run: `cd frontend && npm run build` → Expected: `✓ built`.

- [ ] **Step 5: Record deletions + commit**

Append the deleted branches/components note to `docs/_archive/deleted-branches.md` is not needed (no branches); instead just commit:

```bash
cd /opt/Code/DaylightStation
git add -A frontend/src/modules/Fitness/widgets/CycleGame frontend/src/modules/Fitness/lib/cycleGame
git commit -m "refactor(cycle-game): retire raceDirector + Rankings/CameraZoom/RacePistons/LapPanel/LapTable"
```

---

## Task 8: Runtime verification (both modes)

A live Playwright test proving both layouts render the right panels, plus screenshots for the POV skew.

**Files:**
- Create: `tests/live/flow/fitness/cycle-game-layout-modes.runtime.test.mjs`
- Update: existing cycle-game runtime tests that reference removed panels (`cycle-game-piston-avatar`, `cycle-game-transition-proof`, `cycle-game-flash-ui`) — repoint `.cg-pistons__*` selectors to `.cg-pov__*`, or retire the piston-specific ones.

- [ ] **Step 1: Write the runtime test** (mirror the existing flash-ui harness — boot `/fitness`, `autoAssignRiders(N)`, `__cycleGameControl.startRace`, drive RPM via the corrected hold→drive pattern from `cycle-game-autostart-drive.runtime.test.mjs`).

```js
import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';
import { setRpm, launchCycleGame } from '#testlib/FitnessSimHelper.mjs';
import fs from 'node:fs';
const SHOT='/opt/Code/DaylightStation/tmp/cycle-layout-shots';
// helper: boot + green-light (corrected wait) + drive — copy from cycle-game-autostart-drive.runtime.test.mjs

test.describe('Cycle Game — layout modes', () => {
  test.use({ viewport:{width:1280,height:720}, deviceScaleFactor:2 }); test.setTimeout(180000);
  test('2 riders → sidebar mode with POV + oval; screenshot', async ({ page }) => {
    fs.mkdirSync(SHOT,{recursive:true});
    // ...boot, autoAssignRiders(2), start, hold-then-drive until distance advances...
    await expect(page.getByTestId('race-layout')).toHaveAttribute('data-mode','sidebar');
    await expect(page.getByTestId('race-pov')).toBeVisible();
    await expect(page.getByTestId('zone-oval')).toBeVisible();
    await page.screenshot({ path:`${SHOT}/sidebar.png` });
  });
  test('4 riders → wide mode, no oval; screenshot', async ({ page }) => {
    // ...autoAssignRiders(4)...
    await expect(page.getByTestId('race-layout')).toHaveAttribute('data-mode','wide');
    await expect(page.getByTestId('zone-oval')).toHaveCount(0);
    await page.screenshot({ path:`${SHOT}/wide.png` });
  });
});
```
Fill the boot/drive bodies by copying the verified flow from `tests/live/flow/fitness/cycle-game-autostart-drive.runtime.test.mjs` (hold 0 → corrected green-light wait → hold across first tick → drive boxed?stopEquipment:rpm).

- [ ] **Step 2: Run it, expect PASS + inspect screenshots**

Run: `npx playwright test tests/live/flow/fitness/cycle-game-layout-modes.runtime.test.mjs --reporter=line`
Then `Read` `tmp/cycle-layout-shots/sidebar.png` and `wide.png` to confirm the POV skew, avatar aspect, splits chart, and (sidebar) oval lap counter.

- [ ] **Step 3: Repoint/retire piston-specific runtime tests**

Update `cycle-game-piston-avatar.runtime.test.mjs` selectors `.cg-pistons__head .circular-user-avatar` → `.cg-pov__marker .circular-user-avatar`; `cycle-game-transition-proof` head/gridline selectors → `.cg-pov__marker`/`.cg-pov__hline`. Run each; fix or delete if no longer meaningful.

- [ ] **Step 4: Commit**

```bash
git add tests/live/flow/fitness/cycle-game-layout-modes.runtime.test.mjs \
        tests/live/flow/fitness/cycle-game-piston-avatar.runtime.test.mjs \
        tests/live/flow/fitness/cycle-game-transition-proof.runtime.test.mjs
git commit -m "test(cycle-game): runtime coverage for sidebar/wide layout modes"
```

---

## Final verification

- [ ] Full cycle-game unit suite green: `npx vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame frontend/src/modules/Fitness/lib/cycleGame frontend/src/modules/Fitness/components`
- [ ] Build clean: `cd frontend && npm run build`
- [ ] Runtime sidebar + wide tests pass; screenshots reviewed.
- [ ] Deploy per the local runbook (build image + `deploy-daylight`), then reload the kiosk and watch a 2-rider and a 4-rider race.

---

## Notes for the implementer

- **PanelSlot remount fix:** every panel goes through `<PanelSlot render={factory} />` (the `render` prop, NOT `<Factory/>`) — this is the stable-type fix that keeps avatars/transitions from remounting each tick. The new `RaceLayoutManager` already does this in `Slot`.
- **POV vertical mapping:** `topFrac = 1 − zoom.xForDist(dist)`. Leader's `xForDist ≈ rightPct (0.88)` → `topFrac ≈ 0.12` (near top). Do not change `leaderAnchoredZoom.js`.
- **Splits format:** `lapSplits[id]` are cumulative crossing seconds; per-lap = `s[i] − s[i-1]`; current-lap running = `elapsedS − s[last]`.
- **lap label:** leader's lap = `lapCount(maxDistance, lapLengthM) + 1`.
- **cgTokens:** SCSS uses `@use '../cgTokens' as cg;` (panels) — tokens `$cg-bg/$cg-text/$cg-mono/$cg-cyan/$cg-magenta/$cg-faint/$cg-muted/$cg-gold/$cg-lane-1/$cg-border-soft` exist.
