# Cycle Challenge Overlay — Polish & Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the cycle-challenge overlay (segmented health bar, flashing active phase block, HR-driven multiplier badges) and fix three behavioral bugs (lock/fail routing showing a blank governance panel, missing success toast, missing per-tile multipliers).

**Architecture:** The cycle challenge already exists end-to-end. This plan reshapes a few overlay elements, surfaces boost data already computed by the engine, and fixes two routing/lifecycle bugs: `resolveLockScreen` only promotes the cycle overlay for `lockReason==='health'` (other locks fall through to the blank generic panel), and `GovernanceEngine` nulls the cycle challenge the same tick it reaches `success` (so the 200ms-sampled snapshot never carries `status:'success'`, suppressing the toast). Each change is isolated to one file with a focused test.

**Tech Stack:** React + SVG/SCSS overlays, Jest (unit, colocated `.test.jsx` + `tests/unit/**`), the structured logging framework (`frontend/src/lib/logging/`). No new dependencies.

**Spec:** `docs/_wip/plans/2026-06-02-cycle-challenge-overlay-polish-design.md`

**Conventions for this plan — TWO test runners:**
This repo splits tests across jest and vitest. Use the right one or the test won't run:
- **Component / colocated tests** (`.test.jsx` and `.test.js` next to source under `frontend/src/...`): **vitest** (jest's `testMatch` only covers `tests/**/*.test.mjs`, so it silently matches nothing for these — "Run with --passWithNoTests"). Run one file with:
  `./node_modules/.bin/vitest run --config vitest.config.mjs <path/to/file.test.jsx>`
  (vitest supplies the React JSX runtime + `@testing-library` + jsdom env via `vitest.config.mjs`; no `import React` needed in tests.)
  **Wherever a task step below says `npx jest --testPathPattern "<Name>"`, substitute the vitest command above against the colocated test file** — those are all component/colocated tests.
- **Engine tests** (`tests/unit/governance/**/*.test.mjs`, using `@jest/globals` + `jest.unstable_mockModule`): **jest**. Run with `npx jest tests/unit/governance/<file>`. (Tasks 7 and 12 only.)
- New component tests in this plan are colocated `.test.jsx`/`.test.js` next to the source (matches the existing redesign tests, e.g. `CycleChallengeOverlay.test.jsx`).
- Never use raw `console.*` — use `getLogger()` per CLAUDE.md.
- Do NOT commit automatically beyond the per-task commits in this plan; the user reviews before merge.

---

## Phase 0: Cleanup

### Task 1: Delete the stale overlay test

The redesign removed the `getBoosterAvatarSlots` helper; `tests/unit/fitness/CycleChallengeOverlay.test.mjs` still imports it and produces 12 failures. The redesigned overlay is covered by the colocated `CycleChallengeOverlay.test.jsx`.

**Files:**
- Delete: `tests/unit/fitness/CycleChallengeOverlay.test.mjs`

- [ ] **Step 1: Confirm the colocated test exists and the helper is gone**

Run: `ls frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx && grep -rn "getBoosterAvatarSlots" frontend/src || echo "helper gone"`
Expected: the `.test.jsx` path prints; `helper gone` prints.

- [ ] **Step 2: Delete the stale test**

```bash
git rm tests/unit/fitness/CycleChallengeOverlay.test.mjs
```

- [ ] **Step 3: Verify the cycle overlay suite is green**

Run: `npx jest --testPathPattern "CycleChallengeOverlay" --testPathIgnorePatterns worktrees`
Expected: PASS, 0 failures.

- [ ] **Step 4: Commit**

```bash
git commit -m "test(cycle): remove stale CycleChallengeOverlay.test.mjs (getBoosterAvatarSlots dropped in redesign)"
```

---

## Phase 1: Segmented health bar (Mega-Man style, relocated below the widget)

### Task 2: Create the `CycleHealthBar` component

A pure presentational segmented bar: N discrete segments, lit count = `ceil(pct × N)`, depleting right→left, color trending green→red. `0` lit = locked.

**Files:**
- Create: `frontend/src/modules/Fitness/player/overlays/CycleHealthBar.jsx`
- Test: `frontend/src/modules/Fitness/player/overlays/CycleHealthBar.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Fitness/player/overlays/CycleHealthBar.test.jsx
import React from 'react';
import { render } from '@testing-library/react';
import CycleHealthBar from './CycleHealthBar.jsx';

const litCount = (container) =>
  container.querySelectorAll('.cycle-health-bar__seg--lit').length;

describe('CycleHealthBar', () => {
  it('renders the requested number of segments (default 10)', () => {
    const { container } = render(<CycleHealthBar pct={1} />);
    expect(container.querySelectorAll('.cycle-health-bar__seg')).toHaveLength(10);
  });

  it('lights ceil(pct * segments)', () => {
    const { container } = render(<CycleHealthBar pct={0.62} segments={10} />);
    expect(litCount(container)).toBe(7); // ceil(6.2)
  });

  it('full health lights every segment', () => {
    const { container } = render(<CycleHealthBar pct={1} segments={10} />);
    expect(litCount(container)).toBe(10);
  });

  it('zero health lights nothing and flags locked', () => {
    const { container } = render(<CycleHealthBar pct={0} segments={10} />);
    expect(litCount(container)).toBe(0);
    expect(container.querySelector('.cycle-health-bar--locked')).not.toBeNull();
  });

  it('depletes right-to-left: the rightmost segment goes dark before the leftmost', () => {
    const { container } = render(<CycleHealthBar pct={0.5} segments={10} />);
    const segs = [...container.querySelectorAll('.cycle-health-bar__seg')];
    expect(segs[0].classList.contains('cycle-health-bar__seg--lit')).toBe(true);   // leftmost lit
    expect(segs[9].classList.contains('cycle-health-bar__seg--lit')).toBe(false);  // rightmost dark
  });

  it('exposes a meter role with aria values', () => {
    const { container } = render(<CycleHealthBar pct={0.5} />);
    const meter = container.querySelector('[role="meter"]');
    expect(meter).not.toBeNull();
    expect(meter.getAttribute('aria-valuenow')).toBe('50');
  });

  it('clamps out-of-range pct', () => {
    const { container } = render(<CycleHealthBar pct={1.7} segments={10} />);
    expect(litCount(container)).toBe(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --testPathPattern "CycleHealthBar" --testPathIgnorePatterns worktrees`
Expected: FAIL — cannot resolve `./CycleHealthBar.jsx`.

- [ ] **Step 3: Write the component**

```jsx
// frontend/src/modules/Fitness/player/overlays/CycleHealthBar.jsx
import React, { useMemo } from 'react';
import PropTypes from 'prop-types';

const clamp01 = (v) => {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
};

/**
 * CycleHealthBar — horizontal segmented health meter (Mega-Man pip style).
 * Lit count = ceil(pct * segments); depletes right -> left. Zero lit segments
 * signals a health lock (empty bar = video paused). Pure presentational.
 */
export function CycleHealthBar({ pct, segments = 10, className = '' }) {
  const safePct = clamp01(pct);
  const lit = Math.ceil(safePct * segments);
  const cells = useMemo(
    () =>
      // index 0 is leftmost; the LEFT-most `lit` segments stay lit so the
      // RIGHT-most empty as health drains (right -> left depletion).
      Array.from({ length: segments }, (_, i) => i < lit),
    [segments, lit]
  );
  const locked = lit <= 0;
  const rootClass = [
    'cycle-health-bar',
    locked ? 'cycle-health-bar--locked' : '',
    className
  ].filter(Boolean).join(' ');

  return (
    <div
      className={rootClass}
      role="meter"
      aria-label={`Cycle health ${Math.round(safePct * 100)} percent`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(safePct * 100)}
      style={{ '--cycle-health-pct': safePct }}
    >
      {cells.map((isLit, i) => (
        <span
          key={i}
          className={`cycle-health-bar__seg${isLit ? ' cycle-health-bar__seg--lit' : ''}`}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

CycleHealthBar.propTypes = {
  pct: PropTypes.number,
  segments: PropTypes.number,
  className: PropTypes.string
};

export default CycleHealthBar;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --testPathPattern "CycleHealthBar" --testPathIgnorePatterns worktrees`
Expected: PASS (7 cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/CycleHealthBar.jsx frontend/src/modules/Fitness/player/overlays/CycleHealthBar.test.jsx
git commit -m "feat(cycle): segmented CycleHealthBar component (Mega-Man pips, right-to-left)"
```

---

### Task 3: Style the segmented health bar; remove the old smooth meter styles

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.scss:228-242` (remove `&__health-meter` / `&__health-fill`)
- Modify: same file (append `.cycle-health-bar` styles at end of the `.cycle-challenge-overlay` root block, before the closing brace / state variants — place right after the deleted block at line ~228)

- [ ] **Step 1: Remove the old smooth-meter rules**

Delete this exact block (currently `CycleChallengeOverlay.scss:228-242`):

```scss
  // Health meter — depletes below the red line; empty == video paused.
  &__health-meter {
    width: clamp(80px, calc(var(--cycle-overlay-diameter) * 0.55), 150px);
    height: clamp(5px, calc(var(--cycle-overlay-diameter) * 0.035), 9px);
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.7);
    border: 1px solid rgba(255, 255, 255, 0.15);
    overflow: hidden;
  }
  &__health-fill {
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, #ef4444 0%, #f59e0b 45%, #22c55e 100%);
    transition: width 0.2s linear;
  }
```

- [ ] **Step 2: Add the segmented bar styles**

Insert in its place (still inside the `.cycle-challenge-overlay { ... }` root block so the `&` BEM nesting and `--cycle-overlay-diameter` var are in scope):

```scss
  // Segmented health bar — Mega-Man style pips beneath the widget. Lit segments
  // deplete right -> left; empty bar (locked) flashes to signal video paused.
  .cycle-health-bar {
    display: flex;
    gap: clamp(2px, calc(var(--cycle-overlay-diameter) * 0.012), 4px);
    width: clamp(110px, calc(var(--cycle-overlay-diameter) * 0.85), 230px);
    margin: clamp(4px, calc(var(--cycle-overlay-diameter) * 0.03), 10px) auto 0;
    padding: 3px;
    border-radius: 4px;
    background: rgba(15, 23, 42, 0.7);
    border: 1px solid rgba(255, 255, 255, 0.15);
    pointer-events: none;
  }

  .cycle-health-bar__seg {
    flex: 1 1 0;
    height: clamp(7px, calc(var(--cycle-overlay-diameter) * 0.05), 13px);
    border-radius: 2px;
    background: rgba(148, 163, 184, 0.25);
    transition: background 0.18s linear;
  }

  // Color trend green -> amber -> red as the bar empties, driven by --cycle-health-pct.
  .cycle-health-bar__seg--lit {
    background: hsl(calc(var(--cycle-health-pct, 1) * 120) 80% 50%);
    box-shadow: 0 0 4px hsla(calc(var(--cycle-health-pct, 1) * 120) 80% 50% / 0.7);
  }

  .cycle-health-bar--locked {
    border-color: #ef4444;
    animation: cycle-health-empty-flash 0.9s steps(1, end) infinite;
  }
```

- [ ] **Step 3: Add the locked-flash keyframes**

At the very end of `CycleChallengeOverlay.scss` (top level, outside the root block — alongside the other `@keyframes`):

```scss
@keyframes cycle-health-empty-flash {
  0%, 100% { background: rgba(15, 23, 42, 0.7); }
  50%      { background: rgba(239, 68, 68, 0.4); }
}
```

- [ ] **Step 4: Verify SCSS still compiles (overlay test renders styles via import)**

Run: `npx jest --testPathPattern "CycleChallengeOverlay" --testPathIgnorePatterns worktrees`
Expected: PASS (existing overlay test still green after Task 4 wiring; for now it may fail on the missing markup — that is fixed in Task 4. If running this task standalone, expect the import to resolve without SCSS errors).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.scss
git commit -m "style(cycle): segmented health bar styles; drop smooth meter"
```

---

### Task 4: Wire `CycleHealthBar` into the overlay; remove the inline meter

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx:405-437` (the `__stack` block — remove `__health-meter`/`__health-fill`, add `CycleHealthBar` below the widget)
- Modify: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx` (import)
- Test: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx` (add a health-bar assertion)

- [ ] **Step 1: Add a failing assertion to the overlay test**

Append inside the existing top-level `describe` in `CycleChallengeOverlay.test.jsx`:

```jsx
  it('renders the segmented health bar (not the old smooth meter)', () => {
    const challenge = {
      type: 'cycle', cycleState: 'maintain', status: 'pending',
      rider: { id: 'felix', name: 'Felix' },
      currentPhaseIndex: 1, totalPhases: 4,
      currentPhase: { hiRpm: 70, loRpm: 52 },
      currentRpm: 68, phaseProgressPct: 0.4, cycleHealthPct: 0.5
    };
    const { container } = render(<CycleChallengeOverlay challenge={challenge} />);
    expect(container.querySelector('.cycle-health-bar')).not.toBeNull();
    expect(container.querySelectorAll('.cycle-health-bar__seg--lit')).toHaveLength(5);
    expect(container.querySelector('.cycle-challenge-overlay__health-meter')).toBeNull();
  });
```

(If the test file uses a shared `baseChallenge` factory, reuse it and override `cycleHealthPct: 0.5`; the inline object above is self-sufficient otherwise.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest --testPathPattern "CycleChallengeOverlay" --testPathIgnorePatterns worktrees`
Expected: FAIL — `.cycle-health-bar` not found / `.cycle-challenge-overlay__health-meter` still present.

- [ ] **Step 3: Add the import**

At the top of `CycleChallengeOverlay.jsx`, after the `CompletionCountBlocks` import (line 9):

```jsx
import CycleHealthBar from './CycleHealthBar.jsx';
```

- [ ] **Step 4: Replace the inline meter with the segmented bar**

In `CycleChallengeOverlay.jsx`, delete this block (currently lines 406-418):

```jsx
        <div
          className="cycle-challenge-overlay__health-meter"
          role="meter"
          aria-label={`Health ${Math.round((cycleHealthPct ?? 1) * 100)} percent`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round((cycleHealthPct ?? 1) * 100)}
        >
          <div
            className="cycle-challenge-overlay__health-fill"
            style={{ width: `${Math.round((cycleHealthPct ?? 1) * 100)}%` }}
          />
        </div>
```

Then, immediately AFTER the closing `</div>` of `cycle-challenge-overlay__stack` (currently line 437), add the bar as the lowest element of the overlay:

```jsx
      <CycleHealthBar pct={cycleHealthPct ?? 1} />
```

(The `__stack` keeps the phase blocks + RPM readout; the health bar now sits below the whole widget as its own row.)

- [ ] **Step 5: Run to verify it passes**

Run: `npx jest --testPathPattern "CycleChallengeOverlay" --testPathIgnorePatterns worktrees`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx
git commit -m "feat(cycle): relocate health to segmented bar below the widget"
```

---

## Phase 2: Flashing active phase block

### Task 5: Add `activeIndex` to `CompletionCountBlocks`

The block at `activeIndex` gets an `--active` modifier. HR challenge omits the prop, so its rendering is unchanged.

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/CompletionCountBlocks.jsx`
- Test: `frontend/src/modules/Fitness/player/overlays/CompletionCountBlocks.test.jsx` (create if absent)

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Fitness/player/overlays/CompletionCountBlocks.test.jsx
import React from 'react';
import { render } from '@testing-library/react';
import CompletionCountBlocks from './CompletionCountBlocks.jsx';

const base = {
  containerClassName: 'c',
  blockClassName: 'blk',
  completeBlockClassName: 'blk--done',
  activeBlockClassName: 'blk--active'
};

describe('CompletionCountBlocks activeIndex', () => {
  it('marks the block at activeIndex with the active class', () => {
    const { container } = render(
      <CompletionCountBlocks targetCount={4} actualCount={1} activeIndex={1} {...base} />
    );
    const blocks = container.querySelectorAll('.blk');
    expect(blocks[1].classList.contains('blk--active')).toBe(true);
    expect(blocks[0].classList.contains('blk--active')).toBe(false);
  });

  it('does not mark any block active when activeIndex is omitted (HR behavior unchanged)', () => {
    const { container } = render(
      <CompletionCountBlocks targetCount={4} actualCount={2} {...base} />
    );
    expect(container.querySelectorAll('.blk--active')).toHaveLength(0);
  });

  it('a completed block is not also active', () => {
    const { container } = render(
      <CompletionCountBlocks targetCount={4} actualCount={2} activeIndex={0} {...base} />
    );
    const blocks = container.querySelectorAll('.blk');
    // index 0 is complete -> active class suppressed
    expect(blocks[0].classList.contains('blk--active')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest --testPathPattern "CompletionCountBlocks" --testPathIgnorePatterns worktrees`
Expected: FAIL — no `blk--active` applied.

- [ ] **Step 3: Implement**

In `CompletionCountBlocks.jsx`:

Add two props to the destructured signature (after `completeBlockClassName`):

```jsx
  completeBlockClassName,
  activeBlockClassName,
  activeIndex,
```

In the `useMemo`, change the block factory (lines 46-55) to record `active`:

```jsx
    const safeActiveIndex = Number.isFinite(activeIndex) ? Math.round(activeIndex) : -1;
    const nextBlocks = Array.from({ length: safeTarget }, (_, index) => {
      const complete = index < safeCompleted;
      const user = complete ? safeMetUsers[index] : null;
      const initial = complete ? getInitial(resolveUserLabel(user, resolveMetUserLabel, index)) : '';
      return {
        id: index + 1,
        complete,
        active: !complete && index === safeActiveIndex,
        initial
      };
    });
```

Add `activeIndex` to the `useMemo` dependency array (line 62):

```jsx
  }, [targetCount, actualCount, metUsers, resolveMetUserLabel, activeIndex]);
```

In the render map (lines 75-84), compose the class with the active modifier:

```jsx
      {blocks.map((block) => {
        const className = [
          blockClassName,
          block.complete ? completeBlockClassName : null,
          block.active && activeBlockClassName ? activeBlockClassName : null
        ].filter(Boolean).join(' ');
        return (
          <span key={block.id} className={className} aria-hidden="true">
            {block.complete && block.initial ? block.initial : null}
          </span>
        );
      })}
```

Add the propTypes (after `completeBlockClassName`):

```jsx
  completeBlockClassName: PropTypes.string.isRequired,
  activeBlockClassName: PropTypes.string,
  activeIndex: PropTypes.number,
```

- [ ] **Step 4: Run to verify it passes (and HR overlay test still green)**

Run: `npx jest --testPathPattern "CompletionCountBlocks|ChallengeOverlay" --testPathIgnorePatterns worktrees`
Expected: PASS (new active tests + existing HR `ChallengeOverlay` tests unaffected — HR never passes `activeIndex`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/CompletionCountBlocks.jsx frontend/src/modules/Fitness/player/overlays/CompletionCountBlocks.test.jsx
git commit -m "feat(cycle): optional activeIndex flashing block in CompletionCountBlocks"
```

---

### Task 6: Pass `activeIndex` from the cycle overlay + flashing keyframes

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx:419-428` (the `CompletionCountBlocks` usage)
- Modify: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.scss` (add `&__phase-block--active` + keyframes)
- Test: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx`

- [ ] **Step 1: Add a failing assertion**

Append to `CycleChallengeOverlay.test.jsx`:

```jsx
  it('flashes the in-progress phase block (active = currentPhaseIndex)', () => {
    const challenge = {
      type: 'cycle', cycleState: 'maintain', status: 'pending',
      rider: { id: 'felix', name: 'Felix' },
      currentPhaseIndex: 2, totalPhases: 4,
      currentPhase: { hiRpm: 70, loRpm: 52 },
      currentRpm: 68, phaseProgressPct: 0.3, cycleHealthPct: 1
    };
    const { container } = render(<CycleChallengeOverlay challenge={challenge} />);
    const blocks = container.querySelectorAll('.cycle-challenge-overlay__phase-block');
    expect(blocks[2].classList.contains('cycle-challenge-overlay__phase-block--active')).toBe(true);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest --testPathPattern "CycleChallengeOverlay" --testPathIgnorePatterns worktrees`
Expected: FAIL — no `--active` block.

- [ ] **Step 3: Pass `activeIndex` in the overlay**

In `CycleChallengeOverlay.jsx`, extend the existing `CompletionCountBlocks` usage (lines 419-428) with two props:

```jsx
        {totalPhases > 0 && (
          <CompletionCountBlocks
            targetCount={totalPhases}
            actualCount={Math.max(0, currentPhaseIndex)}
            activeIndex={Math.max(0, currentPhaseIndex)}
            containerClassName="cycle-challenge-overlay__phase-blocks"
            blockClassName="cycle-challenge-overlay__phase-block"
            completeBlockClassName="cycle-challenge-overlay__phase-block--complete"
            activeBlockClassName="cycle-challenge-overlay__phase-block--active"
            ariaLabel={`Phase ${Math.min(totalPhases, currentPhaseIndex + 1)} of ${totalPhases}`}
          />
        )}
```

- [ ] **Step 4: Add the flashing styles**

In `CycleChallengeOverlay.scss`, after `&__phase-block--complete` (line 217):

```scss
  &__phase-block--active {
    animation: cycle-phase-block-flash 0.7s steps(1, end) infinite;
  }
```

And at the end of the file (top level, with the other keyframes):

```scss
@keyframes cycle-phase-block-flash {
  0%, 100% { background: #000; border-color: #000; }
  50%      { background: #fff; border-color: #fff; }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx jest --testPathPattern "CycleChallengeOverlay" --testPathIgnorePatterns worktrees`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.scss
git commit -m "feat(cycle): flash the in-progress phase block (black/white)"
```

---

## Phase 3: Multiplier surfacing (rider + others, on HR tiles + cycle total)

### Task 7: Add `boostContributions` map to the engine snapshot

The engine already computes `boostMultiplier` (total, rider+others) and `boostingUsers` (contributor ids). Add a per-user contribution map so the vitals tiles can show each share without recomputing.

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js` — `_computeBoostMultiplier` (line 2871) to also return `contributions`; snapshot builder (line ~727) to publish `boostContributions`.
- Test: `tests/unit/governance/GovernanceEngine-boostContributions.test.mjs` (new)

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/governance/GovernanceEngine-boostContributions.test.mjs
import { describe, it, expect, jest } from '@jest/globals';
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));
const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('GovernanceEngine boost contributions', () => {
  it('_computeBoostMultiplier returns a per-user contributions map', () => {
    const engine = new GovernanceEngine(null);
    const active = { selection: { boost: { zoneMultipliers: { hot: 0.5, fire: 1.0 }, maxTotalMultiplier: 3.0 } } };
    const ctx = {
      activeParticipants: ['felix', 'mom', 'milo'],
      userZoneMap: { felix: 'fire', mom: 'warm', milo: 'hot' }
    };
    const { multiplier, contributors, contributions } = engine._computeBoostMultiplier(active, ctx);
    expect(multiplier).toBeCloseTo(2.5); // 1.0 + 1.0(fire) + 0.5(hot)
    expect(contributors).toEqual(['felix', 'milo']);
    expect(contributions).toEqual({ felix: 1.0, milo: 0.5 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/unit/governance/GovernanceEngine-boostContributions.test.mjs`
Expected: FAIL — `contributions` is undefined.

- [ ] **Step 3: Implement — extend `_computeBoostMultiplier`**

Replace the body of `_computeBoostMultiplier` (lines 2871-2884) with:

```javascript
  _computeBoostMultiplier(active, ctx) {
    const mults = active.selection?.boost?.zoneMultipliers || {};
    const cap = active.selection?.boost?.maxTotalMultiplier || 3.0;
    const participants = ctx.activeParticipants || [];
    let sum = 0;
    const contributors = [];
    const contributions = {};
    participants.forEach(uid => {
      const z = ctx.userZoneMap?.[uid];
      const m = z && mults[z];
      if (m) { sum += m; contributors.push(uid); contributions[uid] = m; }
    });
    const total = Math.min(1.0 + sum, cap);
    return { multiplier: Math.max(1.0, total), contributors, contributions };
  }
```

- [ ] **Step 4: Publish it in the snapshot**

The snapshot builder destructures `{ multiplier, contributors }` from `_computeBoostMultiplier` near line 577. Update that destructure to also capture `contributions`:

```javascript
      const { multiplier, contributors, contributions } = this._computeBoostMultiplier(activeChallenge, {
```

(keep the rest of that call's argument object unchanged).

Then in the returned snapshot object (after `boostingUsers: contributors,` at line 728) add:

```javascript
        boostContributions: contributions || {},
```

- [ ] **Step 5: Run to verify it passes (+ no engine regressions)**

Run: `npx jest tests/unit/governance/GovernanceEngine-boostContributions.test.mjs && npx jest tests/unit/governance/`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js tests/unit/governance/GovernanceEngine-boostContributions.test.mjs
git commit -m "feat(governance): publish per-user boostContributions in cycle snapshot"
```

---

### Task 8: Add a `boostBadge` element to `CircularUserAvatar`

**Files:**
- Modify: `frontend/src/modules/Fitness/components/CircularUserAvatar.jsx`
- Modify: `frontend/src/modules/Fitness/components/CircularUserAvatar.scss` (badge styles)
- Test: `frontend/src/modules/Fitness/components/CircularUserAvatar.test.jsx` (create if absent)

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Fitness/components/CircularUserAvatar.test.jsx
import React from 'react';
import { render } from '@testing-library/react';
import CircularUserAvatar from './CircularUserAvatar.jsx';

describe('CircularUserAvatar boostBadge', () => {
  it('renders a boost badge when boostBadge is provided', () => {
    const { container } = render(<CircularUserAvatar name="Felix" boostBadge="×1.5" />);
    const badge = container.querySelector('.vital-boost-badge');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe('×1.5');
  });

  it('renders no badge when boostBadge is absent', () => {
    const { container } = render(<CircularUserAvatar name="Felix" />);
    expect(container.querySelector('.vital-boost-badge')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest --testPathPattern "CircularUserAvatar" --testPathIgnorePatterns worktrees`
Expected: FAIL — `.vital-boost-badge` not found.

- [ ] **Step 3: Implement**

In `CircularUserAvatar.jsx`, add `boostBadge` to the destructured props (after `role` on line 43):

```jsx
  onClick,
  role,
  boostBadge
}) => {
```

Render the badge as a direct child of the root `.circular-user-avatar` div — insert immediately after the opening `<div ...>` block (after line 105, before the `{/* Fire sunbeams effect */}` comment):

```jsx
      {boostBadge ? (
        <div className="vital-boost-badge" aria-hidden="true">{boostBadge}</div>
      ) : null}
```

Add to propTypes (after `role: PropTypes.string`):

```jsx
  role: PropTypes.string,
  boostBadge: PropTypes.string
```

- [ ] **Step 4: Add badge styles**

Append to `CircularUserAvatar.scss`:

```scss
.circular-user-avatar {
  position: relative; // anchor for the boost badge (no-op if already set)

  .vital-boost-badge {
    position: absolute;
    bottom: -4px;
    right: -4px;
    z-index: 3;
    padding: 1px 6px;
    border-radius: 8px;
    background: rgba(249, 115, 22, 0.95);
    color: #1e293b;
    font-size: 0.7rem;
    font-weight: 800;
    line-height: 1.2;
    letter-spacing: 0.02em;
    pointer-events: none;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx jest --testPathPattern "CircularUserAvatar" --testPathIgnorePatterns worktrees`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/components/CircularUserAvatar.jsx frontend/src/modules/Fitness/components/CircularUserAvatar.scss frontend/src/modules/Fitness/components/CircularUserAvatar.test.jsx
git commit -m "feat(fitness): boostBadge slot on CircularUserAvatar"
```

---

### Task 9: Show per-tile multipliers in `FullscreenVitalsOverlay`

When a cycle challenge is active, each HR tile shows its contribution; the rider's own tile is included.

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.jsx` (read the active cycle challenge from context, compute per-item badge, pass to `CircularUserAvatar`)
- Test: `frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.test.jsx` (add or extend)

- [ ] **Step 1: Confirm the contributions key matches the tile identity**

Run: `grep -n "userCurrentZones\|getUserByDevice\|item.name\|activeParticipants" frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.jsx | head`
Expected: confirm `hrItems` carry `name` (the user slug). `boostContributions` is keyed by the same participant id used in `userZoneMap` (the slug). The badge lookup uses `item.name`.
> If the key is NOT the slug (e.g., a device id), map it in Step 3 via the same resolver `userCurrentZones` uses. Do not guess — verify before wiring.

- [ ] **Step 2: Write the failing test**

```jsx
// add to frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.test.jsx
// Mock useFitnessContext to return one HR device for 'felix' plus an active cycle
// challenge whose boostContributions includes felix: 0.5. Assert a ×1.5 badge.
// (Follow the existing mock pattern already used in this test file for context.)
import React from 'react';
import { render } from '@testing-library/react';

jest.mock('@/context/FitnessContext.jsx', () => ({
  useFitnessContext: () => ({
    heartRateDevices: [{ deviceId: 'd1', heartRate: 150, connectionState: 'connected' }],
    rpmDevices: [],
    getUserByDevice: () => ({ name: 'felix' }),
    allUsers: [{ name: 'felix' }],
    userCurrentZones: { felix: { id: 'fire', color: '#ef4444' } },
    zones: [{ id: 'fire', color: '#ef4444', min: 170 }],
    usersConfigRaw: {},
    equipment: [],
    deviceConfiguration: {},
    governanceState: {
      challenge: { type: 'cycle', boostContributions: { felix: 0.5 } }
    }
  })
}));

import FullscreenVitalsOverlay from './FullscreenVitalsOverlay.jsx';

it('shows a per-tile boost badge for a contributing HR user', () => {
  const { container } = render(<FullscreenVitalsOverlay visible />);
  const badge = container.querySelector('.vital-boost-badge');
  expect(badge).not.toBeNull();
  expect(badge.textContent).toBe('×1.5'); // 1.0 + 0.5
});
```

> Note: match the real context field names this component consumes (read its `useFitnessContext()` destructure at the top of the file and mirror exactly). Adjust the mock keys to whatever the component actually reads (`visible` may be a prop or context-derived). The assertion on `.vital-boost-badge` is the invariant.

- [ ] **Step 3: Run to verify it fails**

Run: `npx jest --testPathPattern "FullscreenVitalsOverlay" --testPathIgnorePatterns worktrees`
Expected: FAIL — no badge rendered.

- [ ] **Step 4: Implement**

In `FullscreenVitalsOverlay.jsx`, read the active cycle contributions from context (near where `governanceState`/context is destructured at the top of the component):

```jsx
  const cycleChallenge = context?.governanceState?.challenge || null;
  const boostContributions = (cycleChallenge?.type === 'cycle' && cycleChallenge.boostContributions)
    ? cycleChallenge.boostContributions
    : null;
```

In the `hrItems` `.map(...)` return object (after `progressValue` at line 169), add:

```jsx
          boostBadge: boostContributions && Number.isFinite(boostContributions[user?.name])
            ? `×${(1 + boostContributions[user.name]).toFixed(1)}`
            : null,
```

Add `boostContributions` to the `hrItems` `useMemo` dependency array (line 172).

In the HR tile render (line 233), pass the prop:

```jsx
            <CircularUserAvatar
              key={`hr-${item.deviceId}`}
              name={item.name}
              avatarSrc={item.avatarSrc}
              fallbackSrc={DaylightMediaPath('/static/img/users/user')}
              heartRate={item.heartRate}
              zoneId={item.zoneId}
              zoneColor={item.zoneColor}
              progress={item.progressValue}
              className={item.isInactive ? 'inactive' : ''}
              showIndicator={item.progressValue !== null}
              boostBadge={item.boostBadge}
            />
```

- [ ] **Step 5: Run to verify it passes (+ existing vitals tests green)**

Run: `npx jest --testPathPattern "FullscreenVitalsOverlay" --testPathIgnorePatterns worktrees`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.jsx frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.test.jsx
git commit -m "feat(fitness): per-tile HR boost multiplier badges during cycle challenge"
```

---

## Phase 4: Lock/fail routing — always the cycle overlay, never the generic panel

### Task 10: Promote the cycle overlay for ALL lock reasons + fail in `resolveLockScreen`

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/resolveLockScreen.js`
- Test: `frontend/src/modules/Fitness/player/overlays/resolveLockScreen.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `resolveLockScreen.test.js`:

```javascript
import resolveLockScreen from './resolveLockScreen.js';

describe('resolveLockScreen — cycle owns all lock/fail presentation', () => {
  const govShown = { show: true, videoLocked: true };

  it('promotes cycle overlay for a ramp lock (not just health)', () => {
    const r = resolveLockScreen({
      activeChallenge: { type: 'cycle', cycleState: 'locked', lockReason: 'ramp' },
      governanceDisplay: govShown
    });
    expect(r.promoteCycle).toBe(true);
    expect(r.showCycleOverlay).toBe(true);
    expect(r.showGovernanceOverlay).toBe(false);
    expect(r.videoLocked).toBe(true);
  });

  it('promotes cycle overlay for an init lock', () => {
    const r = resolveLockScreen({
      activeChallenge: { type: 'cycle', cycleState: 'locked', lockReason: 'init' },
      governanceDisplay: govShown
    });
    expect(r.promoteCycle).toBe(true);
    expect(r.showGovernanceOverlay).toBe(false);
  });

  it('promotes cycle overlay on terminal fail', () => {
    const r = resolveLockScreen({
      activeChallenge: { type: 'cycle', status: 'failed' },
      governanceDisplay: govShown
    });
    expect(r.promoteCycle).toBe(true);
    expect(r.showGovernanceOverlay).toBe(false);
  });

  it('never shows the generic governance panel for ANY cycle challenge, even unlocked', () => {
    const r = resolveLockScreen({
      activeChallenge: { type: 'cycle', cycleState: 'maintain' },
      governanceDisplay: govShown
    });
    expect(r.showGovernanceOverlay).toBe(false);
    expect(r.promoteCycle).toBe(false); // not locked -> in-deck overlay, no lock promotion
  });

  it('non-cycle governance lock still uses the governance panel', () => {
    const r = resolveLockScreen({ activeChallenge: null, governanceDisplay: govShown });
    expect(r.showGovernanceOverlay).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest --testPathPattern "resolveLockScreen" --testPathIgnorePatterns worktrees`
Expected: FAIL — ramp/init locks currently return `showGovernanceOverlay:true`.

- [ ] **Step 3: Rewrite `resolveLockScreen.js`**

Replace the function body with:

```javascript
export function resolveLockScreen({ activeChallenge = null, governanceDisplay = null } = {}) {
  const isCycle = activeChallenge?.type === 'cycle';
  const cycleLocked = isCycle && activeChallenge?.cycleState === 'locked';
  const cycleFailed = isCycle && (activeChallenge?.status === 'failed' || activeChallenge?.status === 'abandoned');

  // A cycle challenge owns its own presentation in EVERY state. The generic
  // governance panel is never shown while a cycle challenge is active — that
  // panel has no cycle-aware content and previously rendered as a blank box for
  // non-health locks (and lingered after recovery).
  if (isCycle) {
    const promote = cycleLocked || cycleFailed;
    return {
      variety: promote ? (cycleFailed ? 'cycle-fail' : 'cycle-health') : 'none',
      showGovernanceOverlay: false,
      showCycleOverlay: true,
      promoteCycle: promote,
      audioTrack: promote ? 'locked' : null,
      videoLocked: promote
    };
  }

  // Non-cycle governance lock/pending/warning: defer to governanceDisplay.
  if (governanceDisplay?.show) {
    return {
      variety: 'governance',
      showGovernanceOverlay: true,
      showCycleOverlay: false,
      promoteCycle: false,
      audioTrack: null,
      videoLocked: Boolean(governanceDisplay?.videoLocked)
    };
  }

  return {
    variety: 'none',
    showGovernanceOverlay: false,
    showCycleOverlay: false,
    promoteCycle: false,
    audioTrack: null,
    videoLocked: Boolean(governanceDisplay?.videoLocked)
  };
}
```

> Keep the existing JSDoc above the function; update the `@returns` `variety` enum to `'none'|'governance'|'cycle-health'|'cycle-fail'`.

- [ ] **Step 4: Run to verify it passes (+ existing resolveLockScreen tests)**

Run: `npx jest --testPathPattern "resolveLockScreen" --testPathIgnorePatterns worktrees`
Expected: PASS. If a prior test asserted ramp/init locks went to governance, update it to the new contract (cycle owns all states).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/resolveLockScreen.js frontend/src/modules/Fitness/player/overlays/resolveLockScreen.test.js
git commit -m "fix(cycle): cycle challenge owns all lock/fail presentation; never blank governance panel"
```

---

### Task 11: Update `FitnessPlayerOverlay` gating so the cycle overlay renders in every lock/fail state

**Files:**
- Modify: `frontend/src/modules/Fitness/player/FitnessPlayerOverlay.jsx:204-245`
- Test: covered by Task 14 live flow + the `resolveLockScreen` unit test; add a focused render test if a `FitnessPlayerOverlay.test.jsx` exists (optional).

- [ ] **Step 1: Broaden `cycleOverlayActive` to include all locks**

Currently (lines 204-207):

```jsx
  const cycleOverlayActive = isCycleChallenge
    && activeChallenge?.status !== 'success'
    && activeChallenge?.status !== 'failed'
    && (activeChallenge?.cycleState !== 'locked' || lockScreen.variety === 'cycle-health');
```

Replace with (locked promotes; only `success` keeps it out of the live node, since the success hold owns that):

```jsx
  // The cycle overlay node renders for every non-success cycle state. When the
  // challenge is locked or failed, resolveLockScreen promotes it (rendered as the
  // centered lock stage below); otherwise it renders in-deck. Success is handled
  // by the success-hold (cycleDoneOverlay).
  const cycleOverlayActive = isCycleChallenge
    && activeChallenge?.status !== 'success';
```

- [ ] **Step 2: Generalize the promoted-lock wrapper for fail**

The promoted wrapper (lines 235-245) currently hard-labels "locked". Update the `aria-label` to reflect fail vs lock, and keep promoting for both varieties (no logic change needed since `promoteCycle` already covers both):

```jsx
  const promotedCycleLock = (lockScreen.promoteCycle && cycleOverlayNode) ? (
    <div
      className={`cycle-lock-screen${lockScreen.variety === 'cycle-fail' ? ' cycle-lock-screen--fail' : ''}`}
      role="dialog"
      aria-label={lockScreen.variety === 'cycle-fail' ? 'Cycle challenge failed' : 'Cycle challenge locked'}
    >
      <div className="cycle-lock-screen__scrim" />
      <div className="cycle-lock-screen__stage">
        {cycleOverlayNode}
      </div>
      {lockScreen.audioTrack ? (
        <GovernanceAudioPlayer trackKey={lockScreen.audioTrack} paused={voiceMemoOverlayOpen} />
      ) : null}
    </div>
  ) : null;
```

- [ ] **Step 3: Verify the suite is green**

Run: `npx jest --testPathPattern "FitnessPlayerOverlay|resolveLockScreen|CycleChallengeOverlay" --testPathIgnorePatterns worktrees`
Expected: PASS (no regressions; new behavior validated at the resolver layer + live flow in Task 14).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/player/FitnessPlayerOverlay.jsx
git commit -m "fix(cycle): render promoted cycle overlay for every lock reason + fail"
```

---

## Phase 5: Success (and fail) snapshot publishing + toast

### Task 12: Keep the cycle challenge published in `success` for a hold window

Root cause of the missing toast/celebration: `GovernanceEngine.js:3371` sets `activeChallenge = null` the same tick `status` becomes `success`, so the 200ms-sampled snapshot never carries `status:'success'`. The HR path (line ~3435) keeps the challenge published. Mirror that: defer the clear.

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js` (cycle success branch, lines ~3306-3378)
- Test: `tests/unit/governance/GovernanceEngine-cycleSuccessPublish.test.mjs` (new)

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/governance/GovernanceEngine-cycleSuccessPublish.test.mjs
import { describe, it, expect, jest } from '@jest/globals';
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));
const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('cycle success stays published for a hold window', () => {
  it('keeps activeChallenge in success for >= one sampled tick, then clears', () => {
    let now = 100000;
    const engine = new GovernanceEngine(null, { now: () => now });
    // Minimal active cycle challenge already at success.
    engine.challengeState.activeChallenge = {
      id: 'c1', type: 'cycle', status: 'success', cycleState: 'maintain',
      rider: 'felix', ridersUsed: ['felix'], totalPhases: 2, currentPhaseIndex: 2,
      generatedPhases: [{ hiRpm: 60, loRpm: 45, rampSeconds: 5, maintainSeconds: 10 }],
      completedAt: now, historyRecorded: false, boostContributors: new Set(),
      totalBoostedMs: 0, totalLockEventsCount: 0, startedAt: now - 5000,
      selection: { userCooldownSeconds: 600, boost: { zoneMultipliers: {}, maxTotalMultiplier: 3 } }
    };
    const policy = { challenges: [{ intervalRangeSeconds: [30, 60] }] };
    const ctx = { activeParticipants: ['felix'], userZoneMap: { felix: 'active' } };

    // First post-success tick: history recorded, challenge STILL published in success.
    engine._evaluateCycleSuccessForTest?.(); // see note
    // Drive via the real path: call the cycle branch handler used in _evaluateChallenges.
    // Easiest: assert the deferred-clear contract directly.
    expect(engine.challengeState.activeChallenge).not.toBeNull();
    expect(engine.challengeState.activeChallenge.status).toBe('success');

    // After the publish window elapses, a subsequent evaluation clears it.
    now += 800;
    // Re-run the success handler tick (the engine clears once window passes).
    // (Use whichever internal entrypoint the implementation exposes — see Step 3.)
  });
});
```

> Implementation note: the cycle success handling lives inline in `_evaluateChallenges`. To make it unit-testable without standing up a full evaluate cycle, extract the success handling into a small private method `_finishCycleSuccess(challenge, challengeConfig, now, queueNextChallenge)` and call it from both the inline site and the test. If extraction is undesirable, drive the full `engine.evaluate(...)` twice with a seeded RNG and assert the same contract (published at t0, cleared at t0+window). Pick one and make the test concrete before Step 3.

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/unit/governance/GovernanceEngine-cycleSuccessPublish.test.mjs`
Expected: FAIL — challenge is nulled immediately (or the helper doesn't exist).

- [ ] **Step 3: Implement the deferred clear**

In the cycle success branch (`if (challenge.status === 'success') {`), the body currently records history then unconditionally runs (line 3371-3377):

```javascript
            this.challengeState.activeChallenge = null;
            this.challengeState.videoLocked = false;

            const nextDelay = this._pickIntervalMs(challengeConfig.intervalRangeSeconds);
            queueNextChallenge(nextDelay);
            this._schedulePulse(50);
            return;
```

Replace those lines with a hold-then-clear gate. After the `if (!challenge.historyRecorded) { ... challenge.historyRecorded = true; ... }` block closes (line 3369) and before the clear, stamp the publish time on first success, then only clear after the window:

```javascript
            // Keep the success snapshot published for at least one sampled tick
            // (the governance state is sampled at ~200ms) so the success toast +
            // ✅ hold can observe status:'success' — mirrors the HR challenge path,
            // which does NOT null the challenge on success.
            this.challengeState.videoLocked = false;
            if (!Number.isFinite(challenge.successPublishedAt)) {
              challenge.successPublishedAt = now;
            }
            const CYCLE_SUCCESS_PUBLISH_MS = 600;
            if (now - challenge.successPublishedAt < CYCLE_SUCCESS_PUBLISH_MS) {
              this._schedulePulse(100);
              return;
            }

            this.challengeState.activeChallenge = null;
            const nextDelay = this._pickIntervalMs(challengeConfig.intervalRangeSeconds);
            queueNextChallenge(nextDelay);
            this._schedulePulse(50);
            return;
```

(The history/cooldown record stays guarded by `historyRecorded`, so it runs exactly once even though the branch now re-enters across the hold window.)

- [ ] **Step 4: Run to verify it passes (+ cycle engine regressions)**

Run: `npx jest tests/unit/governance/GovernanceEngine-cycleSuccessPublish.test.mjs && npx jest tests/unit/governance/`
Expected: PASS. In particular `GovernanceEngine-cycleHistory` and `GovernanceEngine-cycleMaintain` still pass (history recorded once, success reached).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js tests/unit/governance/GovernanceEngine-cycleSuccessPublish.test.mjs
git commit -m "fix(governance): hold cycle success snapshot one window before clearing (enables toast + ✅)"
```

---

### Task 13: Cycle-specific success toast subtitle

`buildChallengeToast` currently builds an HR-shaped subtitle ("X of Y people reached zone"), meaningless for a cycle.

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/buildChallengeToast.js`
- Test: `frontend/src/modules/Fitness/player/overlays/buildChallengeToast.test.js`

- [ ] **Step 1: Write the failing test**

Append to `buildChallengeToast.test.js`:

```javascript
import { buildChallengeToast } from './buildChallengeToast.js';

describe('buildChallengeToast — cycle success', () => {
  it('uses a phase-count subtitle and the rider as contributor', () => {
    const toast = buildChallengeToast('end', {
      type: 'cycle',
      rider: { id: 'felix', name: 'Felix' },
      totalPhases: 4
    }, { resolveUserName: (id) => (id === 'felix' ? 'Felix' : id) });
    expect(toast.variant).toBe('success');
    expect(toast.title).toBe('Challenge complete!');
    expect(toast.subtitle).toBe('Felix completed 4 phases');
    expect(toast.contributors).toEqual([
      { id: 'felix', name: 'Felix', avatarUrl: '/api/v1/static/img/users/felix' }
    ]);
  });

  it('singular phase wording', () => {
    const toast = buildChallengeToast('end', {
      type: 'cycle', rider: { id: 'felix', name: 'Felix' }, totalPhases: 1
    });
    expect(toast.subtitle).toBe('Felix completed 1 phase');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest --testPathPattern "buildChallengeToast" --testPathIgnorePatterns worktrees`
Expected: FAIL — subtitle is the HR string or undefined.

- [ ] **Step 3: Implement**

In `buildChallengeToast.js`, in the `event === 'end'` section (before building the generic HR subtitle), add a cycle branch:

```javascript
  // event === 'end' (success)
  if (c.type === 'cycle') {
    const riderName = (c.rider && (c.rider.name || c.rider.id))
      || (typeof resolveUserName === 'function' && c.rider?.id && resolveUserName(c.rider.id))
      || 'Rider';
    const phases = Number.isFinite(c.totalPhases) ? c.totalPhases : null;
    const cycleSubtitle = phases != null
      ? `${riderName} completed ${phases} phase${phases === 1 ? '' : 's'}`
      : undefined;
    const cycleToast = { icon: '🏆', title: 'Challenge complete!', subtitle: cycleSubtitle, variant: 'success' };
    const cycleContributors = buildContributors(c, resolveUserName);
    if (cycleContributors.length) cycleToast.contributors = cycleContributors;
    return cycleToast;
  }

  const subtitle = (actualCount != null && requiredCount != null && zoneLabel)
```

(Leaves the existing HR `const subtitle = ...` and the rest of the function unchanged below it.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest --testPathPattern "buildChallengeToast" --testPathIgnorePatterns worktrees`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/buildChallengeToast.js frontend/src/modules/Fitness/player/overlays/buildChallengeToast.test.js
git commit -m "feat(cycle): phase-count success toast subtitle for cycle challenges"
```

---

## Phase 6: Verification

### Task 14: Full suite + live flow + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Full unit suite (no worktree duplicates)**

Run: `npx jest --testPathIgnorePatterns worktrees 2>&1 | tail -20`
Expected: All cycle + governance + overlay suites green. Capture the final `Tests:` line — confirm 0 failures (don't trust a piped exit code; read the summary line).

- [ ] **Step 2: Live flow — lock routing + success toast**

Ensure the dev server is up (`ss -tlnp | grep 3112` on kckern-server; start with `node backend/index.js` if needed), then:

Run: `npx playwright test tests/live/flow/fitness/cycle-challenge-lifecycle.runtime.test.mjs --reporter=line`
Expected: PASS — the run drives init→ramp→maintain→lock→recover→success. Grep the captured session log to confirm the lock screen rendered the speedometer overlay (never a blank governance panel) and that a success toast event fired.

- [ ] **Step 3: Inspect a fresh session log for the fixes**

After a live run:

```bash
LOGDIR=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/media/logs/fitness
ls -t "$LOGDIR" | head -1
# Confirm: governance.cycle.completed status:success present, AND
# fitness.challenge.toast event:end with the cycle id present.
grep -E "cycle.completed|challenge.toast" "$LOGDIR/$(ls -t "$LOGDIR" | head -1)"
```

Expected: both a `governance.cycle.completed status:success` line AND a `fitness.challenge.toast … event":"end"` line for the same cycle id (the toast bug is fixed when the `end` toast appears).

- [ ] **Step 4: Manual smoke checklist (against the real player)**

Trigger a cycle challenge (admin trigger or natural selection) and verify:
- [ ] Segmented health bar sits below the widget; depletes right→left; empties on health lock (and flashes).
- [ ] The in-progress phase square flashes black↔white; completed squares stay lit.
- [ ] During a multi-participant session, each HR tile shows a `×N` badge; cycle overlay shows the `×total` when > 1.
- [ ] A ramp/init lock shows the promoted speedometer overlay (NOT a blank box); returning to green clears it with no lingering box.
- [ ] On completion, the 🏆 "Challenge complete!" toast appears with the rider, and the ✅ green-ring hold plays.

- [ ] **Step 5: Commit any doc updates**

Update `frontend/src/hooks/fitness/GovernanceEngine.Readme.md` cycle section if the success-hold behavior or boost-contribution snapshot field warrants a note, then:

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.Readme.md
git commit -m "docs(governance): note cycle success-hold + boostContributions snapshot field"
```

---

## Notes & open items carried from the spec

- **Terminal `failed`/`abandoned` for cycle:** today's engine only produces recoverable locks + `success` for cycle (line 3454's `status='failed'` is the HR path). Task 10/11 already route a cycle `failed`/`abandoned` snapshot to the promoted overlay if/when the engine produces one, and `resolveLockScreen` handles it (`variety:'cycle-fail'`). If a deliberate terminal-fail condition is later added to `_evaluateCycleChallenge`, no overlay/routing change is needed — only the `cycle-lock-screen--fail` styling (Task 11 adds the class hook) and an optional fail subtitle.
- **Badge glyph:** per-tile and total badges use `×{n}` to match the existing `__boost-badge`. If the user prefers additive notation (`+0.5`), change the two `toFixed(1)` template strings (Task 9, Task 13's contributor path is unaffected).
- **Out of scope:** the cycle *game* (racing) and the never-created `tests/integrated/governance/cycle-challenge.*` integration tests.

---

## Self-review

- **Spec coverage:** (1) segmented health bar → Tasks 2-4; (2) flashing active block → Tasks 5-6; (3) multiplier on HR tiles + cycle total → Tasks 7-9 (engine map, avatar slot, vitals wiring; cycle total badge already renders when >1); (4) lock/fail routing → Tasks 10-11; (5) success toast → Tasks 12-13; (6) stale test cleanup → Task 1. All six spec items map to tasks.
- **Placeholder scan:** the one judgment call (Task 9 mock keys, Task 12 test entrypoint) is explicitly flagged with a "verify before wiring" / "pick one and make it concrete" instruction rather than left vague, because both depend on exact local shapes the implementer must read first; the invariant assertion is given in each.
- **Type consistency:** `boostContributions` (map) is produced in Task 7 and consumed by the same name in Task 9; `boostBadge` prop is defined in Task 8 and passed in Task 9; `activeBlockClassName`/`activeIndex` defined in Task 5 and passed in Task 6; `variety:'cycle-fail'` produced in Task 10 and consumed in Task 11.
