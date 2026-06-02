# Cycle Game — Plan 2: CycleSpeedometer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the reusable, parameterized `<CycleSpeedometer>` — the dual-gauge widget (outer RPM arc with colored cadence bands + labeled ticks + needle + RPM number; inner `CircularUserAvatar` HR ring; odometer; ×-multiplier badge) the cycle game renders per rider.

**Architecture:** Pure SVG geometry split into a unit-tested helper module (`speedometerGeometry.js`, reusing the existing `rpmToAngle`/`polarToCartesian` from `cycleOverlayVisuals.js`); a thin React component (`CycleSpeedometer.jsx`) composes that geometry + the existing `CircularUserAvatar` + the Plan-1 `formatDistance`. This Plan **does not** modify the live `CycleChallengeOverlay` — adopting `<CycleSpeedometer>` there is a deliberate follow-on so the live challenge feature can't regress here.

**Tech Stack:** React, SVG. Tests: `vitest` (pure geometry: plain `*.test.js`; component render: `*.test.jsx` with `@testing-library/react`, jsdom env via the repo's vitest config).

**Plan 2 of 5.** Depends on Plan 1 (`formatDistance`). Reuses `frontend/src/modules/Fitness/components/CircularUserAvatar.jsx` and `frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.js` (`rpmToAngle`, `polarToCartesian`).

**Spec:** `docs/superpowers/specs/2026-06-02-cycle-game-design.md` §4.

---

## Worktree test commands (no local node_modules)

- vitest: `/opt/Code/DaylightStation/node_modules/.bin/vitest run --config /opt/Code/DaylightStation/vitest.config.mjs <relative-path> --root /opt/Code/DaylightStation/.claude/worktrees/cycle-game`

---

## Geometry reference (constants used throughout)

ViewBox `200×200`, center `100`, gauge radius `80`, default `maxRpm=120`, `tickStep=10`, `labelStep=30`.
From `cycleOverlayVisuals.js`: `rpmToAngle(rpm, max)` returns radians (`π` at 0 → `2π` at max, sweeping the TOP hemisphere); `polarToCartesian(cx, cy, r, angle)` returns `{x,y}`. Known values: `rpmToAngle(0,120)=π`; `polarToCartesian(100,100,80,π)={x:20,y:100}`; `rpmToAngle(60,120)=1.5π`; `polarToCartesian(100,100,80,1.5π)={x:100,y:20}` (top center).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `frontend/src/modules/Fitness/lib/cycleGame/speedometerGeometry.js` (+ test) | pure: ticks, cadence-band arcs, needle angle, band-for-rpm |
| `frontend/src/modules/Fitness/widgets/CycleGame/CycleSpeedometer.jsx` (+ test) | React widget composing geometry + CircularUserAvatar + odometer + badge |
| `frontend/src/modules/Fitness/widgets/CycleGame/CycleSpeedometer.scss` | styles |

---

## Task 1: `speedometerGeometry` (pure)

**Files:**
- Create: `frontend/src/modules/Fitness/lib/cycleGame/speedometerGeometry.js`
- Test: `frontend/src/modules/Fitness/lib/cycleGame/speedometerGeometry.test.js`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Fitness/lib/cycleGame/speedometerGeometry.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { buildTicks, buildBandArcs, needleAngleDeg, bandForRpm } from './speedometerGeometry.js';

const BANDS = [
  { id: 'warmup',   min: 0,  color: '#5b6470' },
  { id: 'cruising', min: 40, color: '#2ecc71' },
  { id: 'pushing',  min: 70, color: '#f1c40f' },
  { id: 'sprint',   min: 90, color: '#e74c3c' }
];

describe('buildTicks', () => {
  it('produces maxRpm/tickStep + 1 ticks, with majors at labelStep', () => {
    const ticks = buildTicks({ maxRpm: 120, tickStep: 10, labelStep: 30, center: 100, gaugeRadius: 80 });
    expect(ticks).toHaveLength(13); // 0..120 step 10
    expect(ticks[0].rpm).toBe(0);
    expect(ticks[0].major).toBe(true);          // 0 % 30 === 0
    expect(ticks[0].label).toBe(0);
    expect(ticks.find(t => t.rpm === 30).major).toBe(true);
    expect(ticks.find(t => t.rpm === 20).major).toBe(false);
    expect(ticks.find(t => t.rpm === 20).label).toBeNull();
  });
  it('places the rpm=0 tick at the left edge', () => {
    const ticks = buildTicks({ maxRpm: 120, tickStep: 10, labelStep: 30, center: 100, gaugeRadius: 80 });
    const t0 = ticks[0];
    expect(t0.inner.x).toBeCloseTo(100 - (80 - 4), 3); // gaugeRadius - innerOffset(4)
    expect(t0.inner.y).toBeCloseTo(100, 3);
  });
});

describe('buildBandArcs', () => {
  it('returns one arc per band that starts below maxRpm, each with color + path', () => {
    const arcs = buildBandArcs({ bands: BANDS, maxRpm: 120, center: 100, gaugeRadius: 80 });
    expect(arcs).toHaveLength(4);
    expect(arcs[0].id).toBe('warmup');
    expect(arcs[0].color).toBe('#5b6470');
    expect(arcs[0].d.startsWith('M ')).toBe(true);
    expect(arcs[0].d).toContain(' A 80 80 ');
  });
  it('drops bands whose min is at/above maxRpm', () => {
    const arcs = buildBandArcs({ bands: [...BANDS, { id: 'over', min: 130, color: '#fff' }], maxRpm: 120, center: 100, gaugeRadius: 80 });
    expect(arcs.map(a => a.id)).not.toContain('over');
  });
});

describe('needleAngleDeg', () => {
  it('maps rpm to a -90..+90 degree sweep (0 → -90, half → 0, max → +90)', () => {
    expect(needleAngleDeg(0, 120)).toBeCloseTo(-90, 3);
    expect(needleAngleDeg(60, 120)).toBeCloseTo(0, 3);
    expect(needleAngleDeg(120, 120)).toBeCloseTo(90, 3);
  });
  it('clamps out-of-range rpm to the endpoints', () => {
    expect(needleAngleDeg(-10, 120)).toBeCloseTo(-90, 3);
    expect(needleAngleDeg(999, 120)).toBeCloseTo(90, 3);
  });
});

describe('bandForRpm', () => {
  it('returns the band whose [min, nextMin) contains the rpm', () => {
    expect(bandForRpm(0, BANDS).id).toBe('warmup');
    expect(bandForRpm(50, BANDS).id).toBe('cruising');
    expect(bandForRpm(70, BANDS).id).toBe('pushing');
    expect(bandForRpm(95, BANDS).id).toBe('sprint');
  });
  it('clamps below the first band to the first band', () => {
    expect(bandForRpm(-5, BANDS).id).toBe('warmup');
  });
  it('returns null for empty bands', () => {
    expect(bandForRpm(50, [])).toBeNull();
  });
});
```

- [ ] **Step 2: Run — must FAIL**

Run: `…/vitest … frontend/src/modules/Fitness/lib/cycleGame/speedometerGeometry.test.js --root …`
Expected: module not found.

- [ ] **Step 3: Implement**

Create `frontend/src/modules/Fitness/lib/cycleGame/speedometerGeometry.js`:

```js
import { rpmToAngle, polarToCartesian } from '@/modules/Fitness/player/overlays/cycleOverlayVisuals.js';

const TICK_INNER_OFFSET = 4;
const TICK_OUTER_OFFSET = 2;

/**
 * Tick marks along the top RPM arc. labelStep marks "major" ticks (labelled).
 * @returns {Array<{rpm:number, major:boolean, label:number|null, inner:{x,y}, outer:{x,y}}>}
 */
export function buildTicks({ maxRpm = 120, tickStep = 10, labelStep = 30, center = 100, gaugeRadius = 80 } = {}) {
  const ticks = [];
  for (let rpm = 0; rpm <= maxRpm; rpm += tickStep) {
    const angle = rpmToAngle(rpm, maxRpm);
    const major = rpm % labelStep === 0;
    ticks.push({
      rpm,
      major,
      label: major ? rpm : null,
      inner: polarToCartesian(center, center, gaugeRadius - TICK_INNER_OFFSET, angle),
      outer: polarToCartesian(center, center, gaugeRadius + TICK_OUTER_OFFSET, angle)
    });
  }
  return ticks;
}

/**
 * Colored cadence-band arc segments along the top RPM arc. Each band spans
 * [band.min, nextBand.min) (last band → maxRpm). Bands at/above maxRpm dropped.
 * @returns {Array<{id:string, color:string, d:string}>}
 */
export function buildBandArcs({ bands, maxRpm = 120, center = 100, gaugeRadius = 80 } = {}) {
  const list = Array.isArray(bands) ? [...bands].sort((a, b) => (a.min ?? 0) - (b.min ?? 0)) : [];
  const arcs = [];
  for (let i = 0; i < list.length; i++) {
    const band = list[i];
    const start = Number.isFinite(band.min) ? band.min : 0;
    if (start >= maxRpm) continue;
    const end = i + 1 < list.length && Number.isFinite(list[i + 1].min)
      ? Math.min(list[i + 1].min, maxRpm)
      : maxRpm;
    const p1 = polarToCartesian(center, center, gaugeRadius, rpmToAngle(start, maxRpm));
    const p2 = polarToCartesian(center, center, gaugeRadius, rpmToAngle(end, maxRpm));
    arcs.push({
      id: band.id || `band-${i}`,
      color: band.color || '#666',
      d: `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${gaugeRadius} ${gaugeRadius} 0 0 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
    });
  }
  return arcs;
}

/**
 * Needle rotation in degrees for a vertical (pointing-up) needle: 0 rpm → -90°,
 * half → 0°, max → +90°.
 */
export function needleAngleDeg(rpm, maxRpm = 120) {
  const angle = rpmToAngle(rpm, maxRpm); // π..2π
  return ((angle - 1.5 * Math.PI) * 180) / Math.PI;
}

/**
 * The band whose [min, nextMin) contains rpm (clamped to the first band below
 * its min). Null when there are no bands.
 * @returns {object|null}
 */
export function bandForRpm(rpm, bands) {
  const list = Array.isArray(bands) ? [...bands].sort((a, b) => (a.min ?? 0) - (b.min ?? 0)) : [];
  if (list.length === 0) return null;
  const value = Number.isFinite(rpm) ? rpm : 0;
  let current = list[0];
  for (const band of list) {
    if (value >= (band.min ?? 0)) current = band;
    else break;
  }
  return current;
}
```

- [ ] **Step 4: Run — must PASS** (counts: buildTicks 2, buildBandArcs 2, needleAngleDeg 2, bandForRpm 3).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/cycleGame/speedometerGeometry.js frontend/src/modules/Fitness/lib/cycleGame/speedometerGeometry.test.js
git commit -m "feat(cycle-game): speedometer gauge geometry (ticks, bands, needle)"
```

---

## Task 2: `<CycleSpeedometer>` component

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/CycleGame/CycleSpeedometer.jsx`
- Create: `frontend/src/modules/Fitness/widgets/CycleGame/CycleSpeedometer.scss`
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/CycleSpeedometer.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Fitness/widgets/CycleGame/CycleSpeedometer.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import CycleSpeedometer from './CycleSpeedometer.jsx';

const BANDS = [
  { id: 'warmup',   name: 'Warm-up',  min: 0,  color: '#5b6470' },
  { id: 'cruising', name: 'Cruising', min: 40, color: '#2ecc71' },
  { id: 'pushing',  name: 'Pushing',  min: 70, color: '#f1c40f' },
  { id: 'sprint',   name: 'Sprint',   min: 90, color: '#e74c3c' }
];

const baseProps = {
  rpm: 92,
  cadenceBands: BANDS,
  distanceMeters: 2340,
  avatar: { name: 'User_3', heartRate: 168, zoneId: 'hot', zoneColor: '#e67e22', progress: 0.5 }
};

describe('CycleSpeedometer', () => {
  it('renders the RPM value and the formatted odometer', () => {
    const { getByTestId } = render(<CycleSpeedometer {...baseProps} />);
    expect(getByTestId('cycle-speedometer-rpm').textContent).toContain('92');
    expect(getByTestId('cycle-speedometer-odometer').textContent).toBe('2.34 km');
  });
  it('renders one band arc per cadence band', () => {
    const { container } = render(<CycleSpeedometer {...baseProps} />);
    expect(container.querySelectorAll('.cycle-speedometer__band').length).toBe(4);
  });
  it('shows the multiplier badge only when multiplier > 1', () => {
    const { queryByTestId, rerender } = render(<CycleSpeedometer {...baseProps} multiplier={2} />);
    expect(queryByTestId('cycle-speedometer-multiplier').textContent).toContain('2');
    rerender(<CycleSpeedometer {...baseProps} multiplier={1} />);
    expect(queryByTestId('cycle-speedometer-multiplier')).toBeNull();
  });
  it('renders the HR value via the embedded avatar', () => {
    const { container } = render(<CycleSpeedometer {...baseProps} />);
    expect(container.querySelector('.hr-value')?.textContent).toBe('168');
  });
});
```

- [ ] **Step 2: Run — must FAIL** (module not found).

- [ ] **Step 3: Implement the component**

Create `frontend/src/modules/Fitness/widgets/CycleGame/CycleSpeedometer.jsx`:

```jsx
import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import CircularUserAvatar from '@/modules/Fitness/components/CircularUserAvatar.jsx';
import { formatDistance } from '@/modules/Fitness/lib/cycleGame/formatDistance.js';
import { buildTicks, buildBandArcs, needleAngleDeg } from '@/modules/Fitness/lib/cycleGame/speedometerGeometry.js';
import './CycleSpeedometer.scss';

const VIEWBOX = 200;
const CENTER = 100;
const GAUGE_RADIUS = 80;

/**
 * Dual-gauge cycle-game speedometer: outer RPM arc (colored cadence bands +
 * labelled ticks + needle + rpm) around an inner CircularUserAvatar (HR zone
 * ring), with an odometer and an optional ×-multiplier badge. Pure presentation.
 */
export default function CycleSpeedometer({
  rpm = 0,
  maxRpm = 120,
  cadenceBands = [],
  tickStep = 10,
  labelStep = 30,
  avatar = {},
  distanceMeters = 0,
  multiplier = 1,
  multiplierColor,
  size = 220,
  className = ''
}) {
  const ticks = useMemo(
    () => buildTicks({ maxRpm, tickStep, labelStep, center: CENTER, gaugeRadius: GAUGE_RADIUS }),
    [maxRpm, tickStep, labelStep]
  );
  const bands = useMemo(
    () => buildBandArcs({ bands: cadenceBands, maxRpm, center: CENTER, gaugeRadius: GAUGE_RADIUS }),
    [cadenceBands, maxRpm]
  );
  const needleDeg = needleAngleDeg(rpm, maxRpm);
  const showBadge = Number.isFinite(multiplier) && multiplier > 1;
  const badgeColor = multiplierColor || avatar.zoneColor || '#e67e22';

  return (
    <div className={`cycle-speedometer ${className}`.trim()} style={{ width: size, height: size }}>
      <svg className="cycle-speedometer__svg" viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`} aria-hidden="true">
        {/* faint outer ring */}
        <circle className="cycle-speedometer__ring" cx={CENTER} cy={CENTER} r={GAUGE_RADIUS + 8} fill="none" />
        {/* colored cadence bands */}
        {bands.map((b) => (
          <path key={b.id} className="cycle-speedometer__band" d={b.d} stroke={b.color} fill="none" strokeWidth="5" />
        ))}
        {/* ticks + major labels */}
        {ticks.map((t) => (
          <line
            key={`t-${t.rpm}`}
            className={`cycle-speedometer__tick${t.major ? ' cycle-speedometer__tick--major' : ''}`}
            x1={t.inner.x} y1={t.inner.y} x2={t.outer.x} y2={t.outer.y}
          />
        ))}
        {ticks.filter((t) => t.major).map((t) => {
          const angle = (t.inner.x === CENTER && t.inner.y < CENTER); // unused; label positioned at outer
          return (
            <text
              key={`l-${t.rpm}`}
              className="cycle-speedometer__tick-label"
              x={t.outer.x} y={t.outer.y - 3}
              textAnchor="middle"
            >{t.label}</text>
          );
        })}
        {/* needle */}
        <g
          className="cycle-speedometer__needle-group"
          style={{ transform: `rotate(${needleDeg}deg)`, transformOrigin: `${CENTER}px ${CENTER}px`, transformBox: 'view-box' }}
        >
          <line className="cycle-speedometer__needle" x1={CENTER} y1={CENTER} x2={CENTER} y2={CENTER - GAUGE_RADIUS} />
        </g>
        <circle className="cycle-speedometer__hub" cx={CENTER} cy={CENTER} r="3" />
      </svg>

      {/* center avatar (HR zone ring) */}
      <div className="cycle-speedometer__avatar">
        <CircularUserAvatar
          name={avatar.name}
          avatarSrc={avatar.src}
          fallbackSrc={avatar.fallbackSrc}
          heartRate={avatar.heartRate}
          zoneId={avatar.zoneId}
          zoneColor={avatar.zoneColor}
          progress={avatar.progress}
          size={Math.round(size * 0.42)}
        />
        {showBadge && (
          <div className="cycle-speedometer__multiplier" data-testid="cycle-speedometer-multiplier" style={{ background: badgeColor }}>
            ×{Number(multiplier).toFixed(multiplier % 1 === 0 ? 0 : 1)}
          </div>
        )}
      </div>

      <div className="cycle-speedometer__readout">
        <div className="cycle-speedometer__rpm" data-testid="cycle-speedometer-rpm">
          {Math.round(Number.isFinite(rpm) ? rpm : 0)}<span className="cycle-speedometer__rpm-unit"> rpm</span>
        </div>
        <div className="cycle-speedometer__odometer" data-testid="cycle-speedometer-odometer">
          {formatDistance(distanceMeters)}
        </div>
      </div>
    </div>
  );
}

CycleSpeedometer.propTypes = {
  rpm: PropTypes.number,
  maxRpm: PropTypes.number,
  cadenceBands: PropTypes.arrayOf(PropTypes.shape({ id: PropTypes.string, min: PropTypes.number, color: PropTypes.string })),
  tickStep: PropTypes.number,
  labelStep: PropTypes.number,
  avatar: PropTypes.shape({
    name: PropTypes.string, src: PropTypes.string, fallbackSrc: PropTypes.string,
    heartRate: PropTypes.number, zoneId: PropTypes.string, zoneColor: PropTypes.string, progress: PropTypes.number
  }),
  distanceMeters: PropTypes.number,
  multiplier: PropTypes.number,
  multiplierColor: PropTypes.string,
  size: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  className: PropTypes.string
};
```

Remove the unused `angle` line if your linter complains; it is illustrative only — prefer deleting it:
```jsx
        {ticks.filter((t) => t.major).map((t) => (
          <text
            key={`l-${t.rpm}`}
            className="cycle-speedometer__tick-label"
            x={t.outer.x} y={t.outer.y - 3}
            textAnchor="middle"
          >{t.label}</text>
        ))}
```

- [ ] **Step 4: Create the stylesheet**

Create `frontend/src/modules/Fitness/widgets/CycleGame/CycleSpeedometer.scss`:

```scss
.cycle-speedometer {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;

  &__svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  &__ring { stroke: #23272f; stroke-width: 3; }
  &__band { stroke-linecap: butt; }
  &__tick { stroke: rgba(255,255,255,0.35); stroke-width: 1; }
  &__tick--major { stroke: rgba(255,255,255,0.7); stroke-width: 1.5; }
  &__tick-label { fill: #8b93a1; font-size: 8px; font-family: inherit; }
  &__needle { stroke: #e2e8f0; stroke-width: 2.5; stroke-linecap: round; transition: none; }
  &__needle-group { transition: transform 0.18s ease; }
  &__hub { fill: #e2e8f0; }

  &__avatar {
    position: relative;
    display: flex; align-items: center; justify-content: center;
  }
  &__multiplier {
    position: absolute; right: -4%; bottom: 6%;
    min-width: 1.6em; padding: 0.1em 0.3em;
    border-radius: 999px; border: 2px solid #15171c;
    color: #1a1205; font-weight: 700; font-size: 0.8rem; text-align: center;
  }

  &__readout {
    position: absolute; bottom: 4%; left: 0; right: 0;
    display: flex; flex-direction: column; align-items: center; gap: 2px;
    pointer-events: none;
  }
  &__rpm { color: #e2e8f0; font-weight: 700; font-size: 0.95rem; }
  &__rpm-unit { color: #8b93a1; font-weight: 400; font-size: 0.65rem; }
  &__odometer {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #7aa2ff; font-size: 0.8rem;
    background: #05060a; border: 1px solid #2a2e36; border-radius: 4px;
    padding: 1px 6px;
  }
}
```

- [ ] **Step 5: Run — must PASS** (4 tests).

Run: `…/vitest … frontend/src/modules/Fitness/widgets/CycleGame/CycleSpeedometer.test.jsx --root …`

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/CycleSpeedometer.jsx frontend/src/modules/Fitness/widgets/CycleGame/CycleSpeedometer.scss frontend/src/modules/Fitness/widgets/CycleGame/CycleSpeedometer.test.jsx
git commit -m "feat(cycle-game): CycleSpeedometer dual-gauge widget"
```

---

## Final Verification

- [ ] Run both Plan-2 suites:
`…/vitest … frontend/src/modules/Fitness/lib/cycleGame/speedometerGeometry.test.js frontend/src/modules/Fitness/widgets/CycleGame/CycleSpeedometer.test.jsx --root …`
Expected: geometry 9 + component 4 = 13 green.

---

## Self-Review Notes

- **Spec §4 coverage:** outer RPM gauge (ring/ticks/bands/needle/number) → Task 1 geometry + Task 2 render; inner CircularUserAvatar HR ring → Task 2 (`avatar` prop); odometer via `formatDistance` → Task 2; ×-multiplier badge (>1, zone-colored) → Task 2; labelled ticks kept alongside colored bands → Task 1 (`major`/`label`) + Task 2 render. Stripped challenge-only chrome (health/hi-lo/phase/boost/lock): not rendered — N/A by construction.
- **Deliberately deferred:** refactoring `CycleChallengeOverlay` to consume `<CycleSpeedometer>` (protects the live challenge feature; follow-on).
- **Type consistency:** geometry fns take `{maxRpm,tickStep,labelStep,center,gaugeRadius}` / `{bands,maxRpm,center,gaugeRadius}` and are called with those exact keys in the component; `cadenceBands` items `{id,min,color}` match Plan 1's `buildCadenceConfig` output; `formatDistance` reused from Plan 1.
