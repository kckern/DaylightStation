# Cycle Game — Experience Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the six cycle-game UX fixes from the 2026-06-06 audit: ghost styling on the POV chart, a live first-place medal on the speedometers, a single-rider ghost-picker skip, POV avatar anti-aliasing, a no-HR avatar state, and a working logarithmic distance-chart scale.

**Architecture:** Pure-frontend changes in `frontend/src/modules/Fitness/widgets/CycleGame/**` and `frontend/src/modules/Fitness/components/**`. The shared `CircularUserAvatar` and the existing global `.cg-ghost` token are reused (no new ghost styling invented). Item 6 extracts a pure scale function into `lib/cycleGame/` for unit testing.

**Tech Stack:** React (`.jsx`), SCSS, vitest + @testing-library/react. Three.js powers the POV grid (mocked in tests).

**Source audit:** `docs/_wip/audits/2026-06-06-cycle-game-experience-improvements-audit.md`

**Test runner (every test step uses this):**
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs <path-to-test-file>
```

**Conventions verified in this codebase:**
- Frontend tests import `{ describe, it, expect }` from `vitest` and `{ render }` from `@testing-library/react`.
- `PovGrid` mocks `three` and `camera-controls` so it mounts in jsdom; its rider markers are plain DOM (`.cg-pov__marker`, testid `pov-marker`) and assertable.
- The single canonical ghost style is the global `.cg-ghost` rule in `_cgTokens.scss` (grayscale/icy filter on the avatar `<img>`). **Do not create a new ghost style — apply this class.**

---

## File structure

| File | Responsibility | Tasks |
|------|----------------|-------|
| `widgets/CycleGame/home/GhostPicker.jsx` | Ghost selection; single-rider skip | 1 |
| `widgets/CycleGame/home/GhostPicker.test.jsx` (new) | Skip-step test | 1 |
| `widgets/CycleGame/panels/PovGrid.jsx` | POV markers: ghost class + AA size | 2, 4 |
| `widgets/CycleGame/panels/PovGrid.scss` | POV avatar size for AA | 4 |
| `widgets/CycleGame/panels/PovGrid.test.jsx` | Ghost-class assertion | 2 |
| `widgets/CycleGame/CycleGameContainer.jsx` | `isLeader` flag; no-HR `zoneColor` | 3, 5 |
| `widgets/CycleGame/panels/SpeedoRow.jsx` | Thread `isLeader` | 3 |
| `widgets/CycleGame/CycleSpeedometer.jsx` | Render leader medal | 3 |
| `widgets/CycleGame/CycleSpeedometer.scss` | Medal styling | 3 |
| `widgets/CycleGame/CycleSpeedometer.test.jsx` | Medal test | 3 |
| `components/CircularUserAvatar.jsx` | No-HR state (hide gauge) | 5 |
| `components/CircularUserAvatar.scss` | No-HR rider-colored border | 5 |
| `components/CircularUserAvatar.test.jsx` | No-HR render test | 5 |
| `lib/cycleGame/chartScale.js` (new) | Pure leader-gap log transform | 6 |
| `lib/cycleGame/chartScale.test.js` (new) | Scale unit tests | 6 |
| `widgets/CycleGame/panels/DistanceChart.jsx` | Wire gap-log into `yFor` | 6 |

**Execution order:** Task 1 → 2 → 3 → 4 → 5 → 6 → 7 (deploy). Quick wins first; the scale (6) last so it can be verified on a live race.

---

## Task 1: Ghost picker — skip the rider step for single-rider races

**Item 3.** When the chosen past race has exactly one live (non-ghost) rider, the second selection step is pointless. Commit directly instead of opening the roster.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/home/GhostPicker.jsx:52-63`
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/home/GhostPicker.test.jsx` (create)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Fitness/widgets/CycleGame/home/GhostPicker.test.jsx`:

```jsx
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { GhostPicker } from './GhostPicker.jsx';

// Two taps on a card: first focuses, second commits. A single-live-rider race
// must commit on the second tap WITHOUT opening the roster step.
const soloRace = {
  raceId: 'R1', day: '2026-06-06', label: 'Solo race',
  participants: [{ id: 'user_1', displayName: 'KC', isGhost: false, avatarSrc: '' }]
};
const multiRace = {
  raceId: 'R2', day: '2026-06-06', label: 'Multi race',
  participants: [
    { id: 'user_1', displayName: 'KC', isGhost: false, avatarSrc: '' },
    { id: 'user_2', displayName: 'User_2', isGhost: false, avatarSrc: '' }
  ]
};

describe('GhostPicker single-rider skip', () => {
  it('commits directly (no roster) when a race has one live rider', () => {
    cleanup();
    const onSelect = vi.fn();
    const { getAllByText } = render(
      <GhostPicker candidates={[soloRace]} onSelect={onSelect} onClear={() => {}} onClose={() => {}} />
    );
    const card = getAllByText(/Solo race/i)[0].closest('[data-raceid], button, div');
    fireEvent.click(card); // focus
    fireEvent.click(card); // commit
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].participants).toHaveLength(1);
    expect(onSelect.mock.calls[0][0].participants[0].id).toBe('user_1');
  });

  it('opens the roster (does not auto-commit) for a multi-rider race', () => {
    cleanup();
    const onSelect = vi.fn();
    const { getAllByText } = render(
      <GhostPicker candidates={[multiRace]} onSelect={onSelect} onClear={() => {}} onClose={() => {}} />
    );
    const card = getAllByText(/Multi race/i)[0].closest('[data-raceid], button, div');
    fireEvent.click(card);
    fireEvent.click(card);
    expect(onSelect).not.toHaveBeenCalled(); // roster step intervenes
  });
});
```

> Note: the card-selection query uses the card's label text then climbs to its clickable ancestor. If `GhostPicker`'s card root differs, adjust the `.closest(...)` selector to match the actual card element (inspect the rendered `cgh-ghost-card` class), but keep the two-click → assert structure.

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/home/GhostPicker.test.jsx`
Expected: FAIL — the first test fails because the solo race opens the roster instead of calling `onSelect`.

- [ ] **Step 3: Implement the skip**

In `GhostPicker.jsx`, replace the commit branch of `handleTap` (currently lines 58-62):

```jsx
    // Default = every LIVE rider in (the 1-tap "race everyone" path). Ghosts from
    // a past race can't be re-raced, so they never seed the selection.
    const live = (c.participants || []).filter((p) => !p.isGhost);
    // Single live rider → nothing to choose; commit straight through, skip the roster.
    if (live.length === 1) {
      uiLog().debug('cycle_game.ui.ghost_skip_roster', { raceId: c.raceId });
      onSelect?.({ ...c, participants: live });
      return;
    }
    setSelected(new Set(live.map((p) => p.id)));
    setRosterFor(c);          // open the roster confirm card
```

(Leave `live.length === 0` to fall through to the roster's existing disabled "No live riders" state.)

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/home/GhostPicker.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/home/GhostPicker.jsx \
        frontend/src/modules/Fitness/widgets/CycleGame/home/GhostPicker.test.jsx
git commit -m "feat(cycle-game): skip ghost-picker roster step for single-rider races"
```

---

## Task 2: POV chart — apply the standard ghost style

**Item 1.** POV ghost markers currently get only `is-ghost` (opacity 0.6), never the canonical `.cg-ghost` tint. Add `cg-ghost` to the marker so the global rule applies.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.jsx:414`
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.test.jsx` (add a case)

- [ ] **Step 1: Write the failing test**

Append this `it` block inside the existing top-level `describe` in `PovGrid.test.jsx` (reuse the file's existing three.js mocks and `render`):

```jsx
  it('applies the canonical cg-ghost class to ghost markers on the POV', () => {
    cleanup();
    const riders = {
      a: { displayName: 'Ada', cumulativeDistanceM: 120, isGhost: false },
      g: { displayName: 'Ghost', cumulativeDistanceM: 90, isGhost: true }
    };
    const riderLive = { a: { avatarSrc: '' }, g: { avatarSrc: '' } };
    const { container } = render(
      <PovGrid riderIds={['a', 'g']} riders={riders} riderLive={riderLive} />
    );
    const markers = container.querySelectorAll('.cg-pov__marker');
    const ghost = [...markers].find((m) => m.className.includes('is-ghost'));
    expect(ghost).toBeTruthy();
    expect(ghost.className).toContain('cg-ghost');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.test.jsx`
Expected: FAIL — ghost marker has `is-ghost` but not `cg-ghost`.

- [ ] **Step 3: Implement the class change**

In `PovGrid.jsx:414`, change the marker className:

```jsx
            <div key={id} className={`cg-pov__marker${isGhost ? ' is-ghost cg-ghost' : ''}`} data-testid="pov-marker"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.jsx \
        frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.test.jsx
git commit -m "fix(cycle-game): apply canonical cg-ghost tint to POV chart ghost markers"
```

> **Live-verify note (from audit):** if ghosts appear *absent* (not just untinted) on the POV during a real race, that's a separate broken-avatar bug (ghost-of-a-ghost → `id.split(':')[2] === 'ghost'` → 404). Flag it for a follow-up; do not expand this task.

---

## Task 3: Speedometer — 🥇 medal on the current live leader

**Item 2.** Show 🥇 at the top-left of the odometer for whoever is rank-1 right now (updates live; naturally lands on the winner). The leader is already computed in `engineState.standings`; the container just doesn't pass it for non-finishers.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx:1347` (add `isLeader`)
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/panels/SpeedoRow.jsx:30-55` (thread prop)
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleSpeedometer.jsx` (prop + render)
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleSpeedometer.scss:89` (medal style)
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/CycleSpeedometer.test.jsx`

- [ ] **Step 1: Write the failing test**

Append to `CycleSpeedometer.test.jsx` inside the existing `describe('CycleSpeedometer', …)`:

```jsx
  it('renders the leader medal in the odometer only when isLeader is true', () => {
    const { getByTestId, rerender } = render(<CycleSpeedometer {...baseProps} isLeader={false} />);
    expect(getByTestId('cycle-speedometer-odometer').textContent).not.toContain('🥇');
    rerender(<CycleSpeedometer {...baseProps} isLeader={true} />);
    expect(getByTestId('cycle-speedometer-odometer').textContent).toContain('🥇');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/CycleSpeedometer.test.jsx`
Expected: FAIL — `isLeader` not handled; no medal rendered.

- [ ] **Step 3a: Add the prop + render in CycleSpeedometer.jsx**

Add `isLeader = false` to the destructured props (`CycleSpeedometer.jsx:20-25` param list), e.g. extend line 23:

```jsx
  isGhost = false, finished = false, placement = null, penalized = false, isLeader = false,
```

Replace the odometer block (`CycleSpeedometer.jsx:162-164`):

```jsx
      <div className="cycle-speedometer__odometer" data-testid="cycle-speedometer-odometer">
        {isLeader && <span className="cycle-speedometer__leader-medal" aria-label="Current leader">🥇</span>}
        {formatDistance(distanceMeters)}
      </div>
```

Add to `CycleSpeedometer.propTypes` (near the other bool props):

```jsx
  isLeader: PropTypes.bool,
```

- [ ] **Step 3b: Add the medal style in CycleSpeedometer.scss**

In the `&__odometer` block (`CycleSpeedometer.scss:89`), add `position: relative;` as the first declaration, then add a sibling rule after the block closes:

```scss
  &__odometer { position: relative; /* …existing declarations unchanged… */ }

  &__leader-medal {
    position: absolute; top: -0.6em; left: -0.4em;
    font-size: 1.6rem; line-height: 1; pointer-events: none;
    filter: drop-shadow(0 0 6px rgba(255, 213, 74, 0.6));
  }
```

(Reuses the same gold glow `rgba(255, 213, 74, 0.6)` as `&__finished-place` at line 109.)

- [ ] **Step 3c: Thread the prop through SpeedoRow.jsx**

In `SpeedoRow.jsx`, add to the `<CycleSpeedometer … />` props (after line 49 `placement={live.placement}`):

```jsx
            isLeader={!!live.isLeader}
```

- [ ] **Step 3d: Populate `isLeader` in the container**

In `CycleGameContainer.jsx`, in the `riderLive[userId] = { … }` object (the `placement:` line is ~1347), add directly after the `placement:` line:

```jsx
        // Live leader (rank-1 in standings) once the race is underway. standings()
        // ranks un-finished riders by distance every tick, so this hops on each
        // lead change and lands on the eventual winner.
        isLeader: engineState.elapsedS > 0 && placementByUser[userId] === 1,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/CycleSpeedometer.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/CycleSpeedometer.jsx \
        frontend/src/modules/Fitness/widgets/CycleGame/CycleSpeedometer.scss \
        frontend/src/modules/Fitness/widgets/CycleGame/CycleSpeedometer.test.jsx \
        frontend/src/modules/Fitness/widgets/CycleGame/panels/SpeedoRow.jsx \
        frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx
git commit -m "feat(cycle-game): show first-place medal on the current leader's odometer"
```

---

## Task 4: POV chart — anti-alias the avatars

**Item 4.** POV avatars are a 44px raster CSS-upscaled to 1.5× (jagged). Render at a larger intrinsic size and only ever downscale, keeping the same on-screen size. The SCSS pins the avatar to `44px !important`, so JS and SCSS must move together; halving the scale constants keeps apparent size identical (88 × 0.75 = 66 = old 44 × 1.5; 88 × 0.225 = 19.8 = old 44 × 0.45).

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.jsx:34-36` (scale constants) and `:418` (avatar `size`)
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.scss:26-27` (avatar size + ring)

- [ ] **Step 1: Change the avatar size + scale constants in PovGrid.jsx**

Replace `PovGrid.jsx:34-36`:

```jsx
// Avatar card scale: clamp(MIN..MAX, CARD_FOCAL / distanceToCamera). The avatar is
// rendered at 88px intrinsic and only ever DOWN-scaled (max 0.75) so the bitmap is
// downsampled, never upscaled — keeps it crisp against the shader grid. On-screen
// size is unchanged from the old 44px/1.5 setup (88*0.75 = 66 = 44*1.5).
const CARD_FOCAL = 13;
const CARD_MIN_SCALE = 0.225;
const CARD_MAX_SCALE = 0.75;
```

Change the POV avatar `size` (`PovGrid.jsx:418`) from `size={44}` to:

```jsx
                size={88} showGauge={false} showIndicator={false} />
```

- [ ] **Step 2: Update the avatar size + ring in PovGrid.scss**

Replace `PovGrid.scss:26-27`:

```scss
    .circular-user-avatar {
      width: 88px !important; height: 88px !important; --vital-avatar-size: 88px;
      box-shadow: 0 0 0 4px var(--cg-pov-color, #{cg.$cg-cyan}), 0 0 24px -4px var(--cg-pov-color, #{cg.$cg-cyan});
      border-radius: 50%;
    }
```

(Ring `4px` × 0.75 max-scale = 3px on screen = old `2px` × 1.5 — visually unchanged.)

- [ ] **Step 3: Run the POV test to verify no regression**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.test.jsx`
Expected: PASS (markers still render; the ghost-class test from Task 2 still passes).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.jsx \
        frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.scss
git commit -m "fix(cycle-game): anti-alias POV avatars by rendering at 88px and downscaling"
```

> **Live-verify note:** confirm on a real race that near-rider avatars look smooth and apparent sizes are unchanged. If source avatar images are <88px the win is smaller (still no upscaling artifacts).

---

## Task 5: Avatar — no-HR state (hide gauge, rider-colored border) at every site

**Item 5.** When a rider has no active HR, hide the zone gauge ring entirely and show a plain border in the rider's own color (not the idle blue). Implemented in the shared `CircularUserAvatar` so it applies to **every** render site; the container stops passing the idle blue `zoneColor` for live no-HR riders so the panels' rider-color fallback wins.

**Files:**
- Modify: `frontend/src/modules/Fitness/components/CircularUserAvatar.jsx` (gate gauge on HR + `no-hr` class)
- Modify: `frontend/src/modules/Fitness/components/CircularUserAvatar.scss:39-47` (no-hr border color)
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx:1343` (null `zoneColor` when no live HR)
- Test: `frontend/src/modules/Fitness/components/CircularUserAvatar.test.jsx`

- [ ] **Step 1: Write the failing tests**

Append to `CircularUserAvatar.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';

describe('CircularUserAvatar no-HR state', () => {
  it('hides the zone gauge and adds .no-hr when there is no active HR', () => {
    const { container } = render(
      <CircularUserAvatar name="KC" zoneColor="#22d3ee" heartRate={0} showGauge={true} />
    );
    expect(container.querySelector('.zone-progress-gauge')).toBeNull();
    expect(container.querySelector('.circular-user-avatar.no-hr')).not.toBeNull();
  });

  it('shows the zone gauge when there is active HR', () => {
    const { container } = render(
      <CircularUserAvatar name="KC" zoneColor="#e67e22" heartRate={150} zoneId="hot" showGauge={true} />
    );
    expect(container.querySelector('.zone-progress-gauge')).not.toBeNull();
    expect(container.querySelector('.circular-user-avatar.no-hr')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/components/CircularUserAvatar.test.jsx`
Expected: FAIL — gauge renders regardless of HR; no `no-hr` class exists.

- [ ] **Step 3a: Gate the gauge + add the class in CircularUserAvatar.jsx**

Add a derived flag after the `isFireZone` block (after `CircularUserAvatar.jsx:50`):

```jsx
  const hasActiveHr = Number.isFinite(heartRate) && heartRate > 0;
```

Add `no-hr` to `combinedClassName` (`CircularUserAvatar.jsx:76-81`):

```jsx
  const combinedClassName = [
    'circular-user-avatar',
    'vital-avatar',
    zoneId ? `zone-${zoneId}` : null,
    !hasActiveHr ? 'no-hr' : null,
    className
  ].filter(Boolean).join(' ');
```

Gate the gauge render on active HR (`CircularUserAvatar.jsx:123`):

```jsx
      {showGauge && hasActiveHr && (
```

- [ ] **Step 3b: Color the no-HR border in CircularUserAvatar.scss**

The always-present border is the `&::after` rule (`CircularUserAvatar.scss:39-47`, `border: 1px solid rgba(255,255,255,0.9)`). Add a sibling override so the no-HR avatar gets a rider-colored border (`--vital-ring-color` is already set from `zoneColor`). Add after the `&::after` block:

```scss
  &.no-hr::after {
    border-color: var(--vital-ring-color, rgba(255, 255, 255, 0.9));
    border-width: 2px;
  }
```

- [ ] **Step 3c: Stop passing idle blue for live no-HR riders (container)**

In `CycleGameContainer.jsx`, the `zoneColor` line is currently (`:1343`):

```jsx
        zoneColor: isGhostRider ? zoneColorFor(zoneId, zones) : (vitals.zoneColor || null),
```

Replace with (null out the idle zone color when the live rider has no active HR, so SpeedoRow/PovGrid fall back to the rider's lane color):

```jsx
        zoneColor: isGhostRider
          ? zoneColorFor(zoneId, zones)
          : ((Number.isFinite(vitals.heartRate) && vitals.heartRate > 0) ? (vitals.zoneColor || null) : null),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/components/CircularUserAvatar.test.jsx`
Expected: PASS. Also re-run the speedometer + POV tests to confirm no regressions:
`./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/CycleSpeedometer.test.jsx frontend/src/modules/Fitness/widgets/CycleGame/panels/PovGrid.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/components/CircularUserAvatar.jsx \
        frontend/src/modules/Fitness/components/CircularUserAvatar.scss \
        frontend/src/modules/Fitness/components/CircularUserAvatar.test.jsx \
        frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx
git commit -m "feat(cycle-game): no-HR avatar state — hide gauge, use rider color border"
```

---

## Task 6: Distance chart — leader-gap-anchored logarithmic scale

**Item 6.** The current log branch logs `D − d` (distance below the far window top), so its steep region sits in the empty top of the window, not at the bunched leaders — near-zero separation, so the tag de-overlap pass does the work. Replace it with a leader-anchored gap log: leader pinned at the top, small gaps behind the leader magnified. Extract the transform into a pure, tested function. The existing de-overlap pass (`DistanceChart.jsx:210-247`) already only displaces tags closer than `minSepPct` (`Math.max(rawTopPct, prev+minSepPct)`), so once the scale separates riders it stops firing — no change needed there.

**Files:**
- Create: `frontend/src/modules/Fitness/lib/cycleGame/chartScale.js`
- Create: `frontend/src/modules/Fitness/lib/cycleGame/chartScale.test.js`
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.jsx:121-146`

- [ ] **Step 1: Write the failing unit test**

Create `frontend/src/modules/Fitness/lib/cycleGame/chartScale.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { gapFrac } from './chartScale.js';

describe('gapFrac (leader-anchored log scale)', () => {
  it('pins the leader at the top (frac = 1) and trailing rider at the bottom (frac = 0)', () => {
    expect(gapFrac(1500, 1500, 1000)).toBeCloseTo(1, 5); // leader
    expect(gapFrac(1000, 1500, 1000)).toBeCloseTo(0, 5); // trailing
  });

  it('separates two near-leaders 3 m apart far more than a linear window would', () => {
    const leader = 1500, trail = 1000, k = 4;
    const sep = gapFrac(1500, leader, trail, k) - gapFrac(1497, leader, trail, k);
    // Linear over a 500 m visible span would give 3/500 = 0.006. The log must do
    // dramatically better near the front.
    expect(sep).toBeGreaterThan(0.05);
  });

  it('compresses the back: an equal 3 m gap far behind the leader maps to less separation than at the front', () => {
    const leader = 1500, trail = 1000, k = 4;
    const front = gapFrac(1500, leader, trail, k) - gapFrac(1497, leader, trail, k);
    const back = gapFrac(1100, leader, trail, k) - gapFrac(1097, leader, trail, k);
    expect(front).toBeGreaterThan(back);
  });

  it('is monotonic and clamped to [0,1] (no NaN when all riders are tied)', () => {
    expect(gapFrac(1200, 1200, 1200)).toBeCloseTo(1, 5); // span 0 → no divide-by-zero
    expect(gapFrac(0, 1500, 1000)).toBeGreaterThanOrEqual(0);
    expect(gapFrac(0, 1500, 1000)).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/chartScale.test.js`
Expected: FAIL — `gapFrac` not defined.

- [ ] **Step 3a: Implement the pure scale**

Create `frontend/src/modules/Fitness/lib/cycleGame/chartScale.js`:

```js
/**
 * Leader-anchored logarithmic vertical scale for the distance chart.
 *
 * The old scale logged `D - d` (distance below the far window top), so its steep
 * region sat in the empty top of the window — bunched leaders barely separated.
 * This anchors the expansion at the LEADER: gap behind the leader `g = leaderM - d`
 * is log-compressed with a small metre-scale `k`, so the first few metres behind
 * the leader get the most vertical pixels (expand the front, compress the back).
 *
 * @param {number} d        rider's absolute distance (m)
 * @param {number} leaderM  furthest rider's distance (m) — pinned to frac 1 (top)
 * @param {number} trailM   trailing rider's distance (m) — maps to frac 0 (bottom)
 * @param {number} [k=4]    metres at which compression sets in (smaller = more front expansion)
 * @returns {number} fraction in [0,1]; 1 = top (leader), 0 = bottom (trailing)
 */
export function gapFrac(d, leaderM, trailM, k = 4) {
  const span = Math.max(1, (leaderM || 0) - (trailM || 0));
  const g = Math.max(0, (leaderM || 0) - (d || 0));
  const depth = Math.log1p(g / k) / Math.log1p(span / k);
  const frac = 1 - depth;
  return Math.max(0, Math.min(1, frac));
}
```

- [ ] **Step 3b: Run the unit test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/lib/cycleGame/chartScale.test.js`
Expected: PASS (4 tests).

- [ ] **Step 3c: Wire it into DistanceChart.jsx**

Add the import near the other `lib/cycleGame` imports at the top of `DistanceChart.jsx`:

```jsx
import { gapFrac } from '@/modules/Fitness/lib/cycleGame/chartScale.js';
```

In `DistanceChart.jsx`, after `lastDists` is computed (`:121`), add the leader/trail extents:

```jsx
  const lastDists = riderIds.map((id) => (riders[id].distanceSeries || []).slice(-1)[0] || 0);
  const leaderM = lastDists.length ? Math.max(...lastDists) : 0;
  const trailM = lastDists.length ? Math.min(...lastDists) : 0;
  const K_GAP = 4; // metres at which front-cluster expansion sets in
```

Replace the `LOG_BLEND` + `yFor` block (`DistanceChart.jsx:133-146`) with the leader-gap version (drop the blend — with the leader as a fixed top reference there is no hockey-stick):

```jsx
  // When leaders bunch (useLog), switch the vertical mapping to a leader-anchored
  // gap log: the leader is pinned at the top and the first few metres behind it are
  // magnified, so neck-and-neck riders separate on their own. When not crowded, the
  // plain linear absolute-distance mapping is used.
  const yFor = (d) => {
    const frac = useLog
      ? gapFrac(d, leaderM, trailM, K_GAP)
      : Math.min(1, (d || 0) / D);
    return (H - PAD_B) - Math.max(0, Math.min(1, frac)) * PLOT_H;
  };
```

- [ ] **Step 4: Run the distance-chart tests to verify no regression**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.test.jsx frontend/src/modules/Fitness/lib/cycleGame/chartScale.test.js`
Expected: PASS. If an existing `DistanceChart.test.jsx` assertion pinned the old `D − d` log output numerically, update that assertion to the new mapping (the chart's contract is "leaders separate when bunched," not a specific y value).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/cycleGame/chartScale.js \
        frontend/src/modules/Fitness/lib/cycleGame/chartScale.test.js \
        frontend/src/modules/Fitness/widgets/CycleGame/panels/DistanceChart.jsx
git commit -m "fix(cycle-game): leader-anchored log scale so neck-and-neck riders separate"
```

---

## Task 7: Full test sweep, build, deploy, reload garage

**Files:** none (verification + deploy)

- [ ] **Step 1: Run the full cycle-game frontend test set**

Run:
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/Fitness/widgets/CycleGame \
  frontend/src/modules/Fitness/components/CircularUserAvatar.test.jsx \
  frontend/src/modules/Fitness/lib/cycleGame/chartScale.test.js
```
Expected: all PASS. Grep the final summary line for `failed` — there must be `0 failed`. (Per project rule: capture the real runner exit, don't trust a piped tail.)

- [ ] **Step 2: Build the image**

```bash
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
```
Expected: build succeeds (includes `vite build`).

- [ ] **Step 3: Deploy**

```bash
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```
Expected: `Container daylight-station started.`

- [ ] **Step 4: Reload the garage fitness display**

```bash
ssh garage 'DISPLAY=:0 XAUTHORITY=/home/kckern/.Xauthority \
  xdotool search --onlyvisible --class firefox windowactivate --sync key ctrl+shift+r'
```
Expected: `garage Firefox hard-reloaded` (the `_NET_WM_DESKTOP` warning is benign).

- [ ] **Step 5: Live verification (manual, on a real race)**

Confirm on the garage display:
1. Ghost rider shows the icy `.cg-ghost` tint on the POV chart (Item 1).
2. 🥇 sits on the current leader's odometer and moves on lead changes (Item 2).
3. Picking a single-rider past race goes straight to the race, no roster step (Item 3).
4. POV avatars look smooth, not blocky (Item 4).
5. A rider with no HR strap shows a rider-colored border, no empty gauge, no blue (Item 5).
6. Neck-and-neck riders visibly separate on the distance chart without relying on the de-overlap nudge (Item 6).

---

## Self-review

- **Spec coverage:** Item 1 → Task 2; Item 2 → Task 3; Item 3 → Task 1; Item 4 → Task 4; Item 5 → Task 5; Item 6 → Task 6. Deploy → Task 7. All six covered.
- **Type/name consistency:** `isLeader` prop name used consistently across container → SpeedoRow → CycleSpeedometer; `gapFrac` signature `(d, leaderM, trailM, k)` matches between `chartScale.js`, its test, and the DistanceChart call site; `hasActiveHr` used only within `CircularUserAvatar.jsx`.
- **No placeholders:** every code step shows the full code or exact edit.
- **Known risk:** Task 6 may require updating one existing numeric assertion in `DistanceChart.test.jsx` (called out in Task 6 Step 4). Task 1/2 DOM queries may need a selector tweak to match the actual card/marker element (called out inline).
```
