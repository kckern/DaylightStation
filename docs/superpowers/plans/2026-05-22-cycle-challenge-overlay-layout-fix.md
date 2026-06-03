# CycleChallengeOverlay Layout Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the cycling challenge overlay so its elements size, center, and stack correctly with no overlap and no stray "floating circles."

**Architecture:** The overlay (`CycleChallengeOverlay.jsx` + `.scss`) layers absolutely-positioned HTML on top of a fixed 220-unit SVG, but the element actually renders at ~160–240px. Today the lower content (rider name, boost badge, phase blocks, current-RPM) is positioned with three different anchoring schemes and collides, the init/ramp countdown is unpositioned (lands top-left), and the booster pips are placed in pixels computed against a hardcoded 220 so they float outside the disc. The fix groups all lower content into one bottom-anchored flex column, moves the countdown into it, converts booster positions to percentages, and cleans up scaling/dead CSS.

**Tech Stack:** React (JSX), SCSS, Vitest + @testing-library/react (jsdom env), Playwright (visual check via `?cycle-demo`).

**Key fact about the test environment:** jsdom does **not** compute layout (`getBoundingClientRect` returns zeros, SCSS is not applied). So overlap/positioning is verified *structurally* (DOM grouping, percentage vs px values) in Vitest, and *visually* via the built-in `?cycle-demo` harness in Task 6.

**Run a single Vitest spec (from repo root `/opt/Code/DaylightStation`):**
```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs <path-to-spec>
```

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.js` | Pure helpers (visuals, geometry, booster slots) | Modify `getBoosterAvatarSlots` to return % positions |
| `frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.test.js` | Vitest specs for helpers | Add booster-position specs |
| `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx` | Overlay markup | Group lower content into `__stack`; needle as rotated group |
| `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx` | Vitest specs for the overlay | Add structural specs |
| `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.scss` | Overlay styling | Stack layout, scaling, cleanup |

---

## Task 1: Booster pips use percentage positions (fixes "floating circles with letters")

**Root cause:** `getBoosterAvatarSlots(boostingUsers, overlaySize=220)` returns `top/left` in **px** derived from `overlaySize` (the component passes `CYCLE_VIEWBOX_SIZE = 220`). The element renders at ~172px on a 1080p TV, so `left: 188px` lands ~16px to the right of the circle — the orange initial pips float around the overlay. Percentages make them scale with the element and sit on the ring's diagonals.

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.js:225-247`
- Test: `frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.test.js`

- [ ] **Step 1: Add the import (if missing) and write failing tests**

At the top of `cycleOverlayVisuals.test.js`, ensure the import line includes `getBoosterAvatarSlots`. If the file imports specific named exports, add it; e.g.:

```js
import { getBoosterAvatarSlots } from './cycleOverlayVisuals.js';
```

Append this `describe` block to the end of `cycleOverlayVisuals.test.js`:

```js
describe('getBoosterAvatarSlots — percentage positioning', () => {
  it('returns percentage-based positions, not pixels', () => {
    const slots = getBoosterAvatarSlots(['kc', 'alan']);
    expect(slots).toHaveLength(2);
    expect(slots[0].style).toEqual({ top: '16%', left: '84%' }); // NE
    expect(slots[1].style).toEqual({ top: '84%', left: '84%' }); // SE
    expect(slots[0].style.left.endsWith('%')).toBe(true);
    expect(slots[0].style.top.endsWith('%')).toBe(true);
  });

  it('is independent of any overlay-size argument', () => {
    const a = getBoosterAvatarSlots(['kc'], 220);
    const b = getBoosterAvatarSlots(['kc'], 160);
    expect(a[0].style).toEqual(b[0].style);
  });

  it('caps at four entries and uppercases the initial', () => {
    const slots = getBoosterAvatarSlots(['a', 'b', 'c', 'd', 'e']);
    expect(slots).toHaveLength(4);
    expect(getBoosterAvatarSlots(['kc'])[0].initial).toBe('K');
  });

  it('returns [] for empty or non-array input', () => {
    expect(getBoosterAvatarSlots([])).toEqual([]);
    expect(getBoosterAvatarSlots(null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.test.js
```
Expected: FAIL — `slots[0].style` is `{ top: '8px', left: '188px' }`, not `{ top: '16%', left: '84%' }`.

- [ ] **Step 3: Implement percentage positions**

Replace the body of `getBoosterAvatarSlots` (`cycleOverlayVisuals.js:225-247`) with:

```js
export function getBoosterAvatarSlots(boostingUsers /* , _overlaySize */) {
  if (!Array.isArray(boostingUsers) || boostingUsers.length === 0) return [];
  // Percentage positions relative to the overlay element, so the pips scale
  // with --cycle-overlay-size and sit on the ring's diagonals (NE/SE/SW/NW)
  // instead of floating off a hardcoded 220px frame. The SCSS centers each
  // pip on its point via translate(-50%, -50%).
  const positions = [
    { top: '16%', left: '84%' }, // NE
    { top: '84%', left: '84%' }, // SE
    { top: '84%', left: '16%' }, // SW
    { top: '16%', left: '16%' }  // NW
  ];
  return boostingUsers.slice(0, 4).map((uid, i) => {
    const idStr = typeof uid === 'string' ? uid : String(uid ?? '');
    const firstChar = idStr.length > 0 ? idStr.charAt(0).toUpperCase() : '?';
    return {
      id: idStr,
      initial: firstChar || '?',
      style: { top: positions[i].top, left: positions[i].left }
    };
  });
}
```

Also update the JSDoc above it: change the `@param {number} [overlaySize=220]` line and the contract note to state positions are now percentage-based and size-independent.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.test.js
```
Expected: PASS (all booster specs + pre-existing specs).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.js \
        frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.test.js
git commit -m "fix(fitness): booster pips use % positions so they stop floating off the cycle overlay"
```

---

## Task 2: Group lower content into a bottom-anchored flex stack (fixes overlap + top-left countdown)

**Root cause:** `__rider-name` and `__phase-blocks` anchor with `top: calc(50% + …)`, `__current-rpm` anchors with `bottom:`, `__boost-badge` uses a fixed `top: calc(50% + 62px)`, and `__countdown` has **no positioning at all** (so it renders at the container's top-left over the gauge). They collide in the lower third. Grouping them in one `position: absolute` flex column with `gap` guarantees they stack without overlap and centers them, and the countdown joins the column instead of escaping to the corner.

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx:386-490` (return markup)
- Modify: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.scss` (multiple rules)
- Test: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx`

- [ ] **Step 1: Write failing structural tests**

Append to the `describe('CycleChallengeOverlay — extended UI', …)` block in `CycleChallengeOverlay.test.jsx`:

```js
  it('groups lower content inside a single __stack container', () => {
    const ch = {
      ...baseChallenge,
      cycleState: 'init',
      initRemainingMs: 5000,
      totalPhases: 3,
      currentPhaseIndex: 1
    };
    const { container } = render(<CycleChallengeOverlay challenge={ch} />);
    const stack = container.querySelector('.cycle-challenge-overlay__stack');
    expect(stack).toBeTruthy();
    expect(stack.querySelector('.cycle-challenge-overlay__rider-name')).toBeTruthy();
    expect(stack.querySelector('.cycle-challenge-overlay__phase-blocks')).toBeTruthy();
    expect(stack.querySelector('.cycle-challenge-overlay__countdown')).toBeTruthy();
    expect(stack.querySelector('.cycle-challenge-overlay__current-rpm')).toBeTruthy();
  });

  it('does not render the countdown as a direct child of the overlay root', () => {
    const ch = { ...baseChallenge, cycleState: 'init', initRemainingMs: 5000 };
    const { container } = render(<CycleChallengeOverlay challenge={ch} />);
    const root = container.querySelector('.cycle-challenge-overlay');
    const strayCountdown = Array.from(root.children).some((el) =>
      el.classList?.contains('cycle-challenge-overlay__countdown'));
    expect(strayCountdown).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx
```
Expected: FAIL — `.cycle-challenge-overlay__stack` does not exist; the countdown is currently a direct child of the root.

- [ ] **Step 3: Restructure the JSX**

In `CycleChallengeOverlay.jsx`, replace everything from the `{targetRpm !== null && (` block (line 386) through the end of the boost-badge block (line 490, i.e. the last child before the closing `</div>` at line 491) with the following. This keeps the target sign, avatar, and corner boosters where they are, wraps the name text in a span (so ellipsis works), and moves rider-name, boost-badge, phase-blocks, countdown, and current-rpm into `__stack`:

```jsx
      {targetRpm !== null && (
        <div
          className="cycle-challenge-overlay__target"
          aria-label={`Target RPM ${targetRpm}`}
          style={{ left: `${targetLeftPct}%`, top: `${targetTopPct}%` }}
        >
          <span className="cycle-challenge-overlay__target-value">{targetRpm}</span>
        </div>
      )}

      <button
        type="button"
        className={`cycle-challenge-overlay__avatar${swapAllowed ? ' is-clickable' : ''}`}
        onClick={handleAvatarClick}
        disabled={!swapAllowed}
        aria-label={`Rider: ${riderName || 'unknown'}${swapAllowed ? ' — tap to swap' : ''}`}
      >
        <img
          className="cycle-challenge-overlay__avatar-img"
          src={riderAvatarUrl}
          alt=""
          onError={(e) => {
            e.currentTarget.style.display = 'none';
            const fallback = e.currentTarget.nextSibling;
            if (fallback) fallback.style.display = 'flex';
          }}
        />
        <span
          className="cycle-challenge-overlay__avatar-initials"
          style={{ display: 'none' }}
        >
          {riderInitial}
        </span>
      </button>

      {/* Lower content as one bottom-anchored flex column — guarantees the
          name, boost badge, phase blocks, countdown, and RPM readout stack
          without overlap and stay centered regardless of overlay diameter. */}
      <div className="cycle-challenge-overlay__stack">
        {riderName && (
          <div className="cycle-challenge-overlay__rider-name">
            <span className="cycle-challenge-overlay__rider-name-text">{riderName}</span>
            <CycleBaseReqIndicator
              baseReqSatisfied={Boolean(challenge.baseReqSatisfiedForRider)}
              waitingForBaseReq={waitingForBaseReq}
            />
          </div>
        )}

        {showBoostBadge && (
          <div
            className="cycle-challenge-overlay__boost-badge"
            aria-label={`Boost multiplier ${boostText}`}
          >
            {boostText}
          </div>
        )}

        {totalPhases > 0 && (
          <CompletionCountBlocks
            targetCount={totalPhases}
            actualCount={Math.max(0, currentPhaseIndex)}
            metUsers={[]}
            containerClassName="cycle-challenge-overlay__phase-blocks"
            blockClassName="cycle-challenge-overlay__phase-block"
            completeBlockClassName="cycle-challenge-overlay__phase-block--complete"
            ariaLabel={`Phase ${Math.min(totalPhases, currentPhaseIndex + 1)} of ${totalPhases}`}
          />
        )}

        {(challenge.cycleState === 'init' || challenge.cycleState === 'ramp') && (
          <div className="cycle-challenge-overlay__countdown">
            {challenge.cycleState === 'init' && Number.isFinite(initRemainingMs) && (
              <span>
                {clockPaused ? 'Paused — start in ' : 'Start in '}
                {Math.ceil(initRemainingMs / 1000)}s
              </span>
            )}
            {challenge.cycleState === 'ramp' && Number.isFinite(rampRemainingMs) && (
              <span>
                {clockPaused ? 'Paused — reach target in ' : 'Reach target in '}
                {Math.ceil(rampRemainingMs / 1000)}s
              </span>
            )}
          </div>
        )}

        <div
          className="cycle-challenge-overlay__current-rpm"
          aria-label={`Current RPM ${Math.round(currentRpm)}`}
        >
          <span className="cycle-challenge-overlay__current-rpm-value">{Math.round(currentRpm)}</span>
          <span className="cycle-challenge-overlay__current-rpm-unit">RPM</span>
        </div>
      </div>

      {boosters.map((b) => (
        <div
          key={`booster-${b.id}`}
          className="cycle-challenge-overlay__booster"
          style={b.style}
          aria-label={`Booster: ${b.id}`}
        >
          {b.initial}
        </div>
      ))}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx
```
Expected: PASS — both new structural specs pass and all pre-existing specs (countdown text, phase blocks, danger arc, etc.) still pass because the text and class names are unchanged.

- [ ] **Step 5: Add the `__stack` SCSS and strip per-child positioning**

In `CycleChallengeOverlay.scss`:

(a) Add the stack rule inside the `.cycle-challenge-overlay { … }` block (e.g. just before `&__rider-name`):

```scss
  // --- Lower content stack ------------------------------------------------
  // One bottom-anchored flex column holding rider name, boost badge, phase
  // blocks, init/ramp countdown, and the current-RPM readout. Replaces the
  // old per-element absolute anchors that overlapped in the lower third.
  &__stack {
    position: absolute;
    left: 50%;
    bottom: clamp(8px, calc(var(--cycle-overlay-diameter) * 0.05), 16px);
    transform: translateX(-50%);
    width: clamp(110px, calc(var(--cycle-overlay-diameter) * 0.82), 220px);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: clamp(2px, calc(var(--cycle-overlay-diameter) * 0.02), 6px);
    pointer-events: none;
    z-index: 1;
  }
```

(b) Replace the `&__rider-name` rule (`:165-179`) with a flow version (text span + base-req indicator on one centered row, ellipsis on the text span):

```scss
  &__rider-name {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    max-width: 100%;
    font-size: clamp(0.65rem, calc(var(--cycle-overlay-diameter) * 0.05), 0.8rem);
    color: #cbd5e1;
    text-align: center;
    pointer-events: none;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
  }

  &__rider-name-text {
    max-width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
```

(c) Replace the `&__phase-blocks` rule (`:185-194`) with a flow version (drop absolute/top/left/transform):

```scss
  &__phase-blocks {
    display: flex;
    justify-content: center;
    gap: 4px;
    pointer-events: none;
  }
```

(d) Replace the `&__current-rpm` rule (`:70-86`) with a flow version (drop position/bottom/left/transform):

```scss
  &__current-rpm {
    display: flex;
    align-items: baseline;
    gap: 4px;
    padding: 2px clamp(8px, calc(var(--cycle-overlay-diameter) * 0.06), 14px);
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.82);
    border: 1px solid rgba(255, 255, 255, 0.1);
    line-height: 1;
    pointer-events: none;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
    font-variant-numeric: tabular-nums;
  }
```

(e) Replace the `&__boost-badge` rule (`:312-328`) with a flow version (drop position/top/left/transform; scale font):

```scss
  &__boost-badge {
    padding: 2px clamp(6px, calc(var(--cycle-overlay-diameter) * 0.04), 10px);
    border-radius: 8px;
    background: rgba(249, 115, 22, 0.9);
    color: #1e293b;
    font-size: clamp(0.6rem, calc(var(--cycle-overlay-diameter) * 0.06), 0.85rem);
    font-weight: 800;
    letter-spacing: 0.04em;
    text-shadow: none;
    white-space: nowrap;
    pointer-events: none;
    animation: cycle-boost-pulse 1.2s ease-in-out infinite;
  }
```

(f) Update the `cycle-boost-pulse` keyframe (`:331-339`) to drop the now-wrong `translateX(-50%)` (the badge is no longer absolutely centered):

```scss
@keyframes cycle-boost-pulse {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.08);
  }
}
```

(g) Move the countdown styling into the BEM block as a flow element and **delete** the old top-level rule at `:373-378`. Add inside `.cycle-challenge-overlay { … }`:

```scss
  &__countdown {
    font-size: clamp(0.6rem, calc(var(--cycle-overlay-diameter) * 0.05), 0.75rem);
    color: #94a3b8;
    text-align: center;
    line-height: 1.15;
    pointer-events: none;
  }
```

(h) Center each booster pip on its percentage point and scale its size. Replace the `&__booster` rule (`:292-308`) with:

```scss
  &__booster {
    position: absolute;
    transform: translate(-50%, -50%);
    width: clamp(16px, calc(var(--cycle-overlay-diameter) * 0.12), 26px);
    height: clamp(16px, calc(var(--cycle-overlay-diameter) * 0.12), 26px);
    border-radius: 50%;
    background: rgba(249, 115, 22, 0.25);
    border: 1.5px solid #f97316;
    color: #fed7aa;
    font-size: clamp(9px, calc(var(--cycle-overlay-diameter) * 0.06), 13px);
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 0 6px rgba(249, 115, 22, 0.6);
    pointer-events: none;
    line-height: 1;
  }
```

(i) Bump the overlay's minimum size so the stacked content fits the lower hemisphere on landscape TVs (the `16vh` cap made it ~172px). Replace `--cycle-overlay-size` (`:3`) and tighten the avatar:

```scss
  --cycle-overlay-size: clamp(190px, min(24vw, 22vh), 280px);
```

In `&__avatar` (`:104-147`), change the width/height lines from `* 0.32 … 80px` to:

```scss
    width: clamp(48px, calc(var(--cycle-overlay-diameter) * 0.28), 72px);
    height: clamp(48px, calc(var(--cycle-overlay-diameter) * 0.28), 72px);
```

- [ ] **Step 6: Re-run the overlay specs (regression after SCSS edits)**

```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx
```
Expected: PASS (SCSS is not evaluated by jsdom, so this just confirms the JSX still renders the same DOM — the structural and pre-existing specs all pass).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx \
        frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx \
        frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.scss
git commit -m "fix(fitness): group cycle overlay lower content into a flex stack (no overlap, countdown centered)"
```

---

## Task 3: SCSS cleanup + target-sign containment

**Root cause:** dead variable, empty rule bodies, and the target-RPM value can spill above the ring at small diameters. Pure SCSS, no behavior change.

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.scss`

- [ ] **Step 1: Remove the dead `--cycle-overlay-edge` variable**

Delete `:2`:

```scss
  --cycle-overlay-edge: clamp(12px, min(4vw, 4%), 40px);
```
(Confirm it is unused: `grep -n "cycle-overlay-edge" frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.scss` should return only the declaration.)

- [ ] **Step 2: Remove the empty rule bodies**

Delete the empty `&__gauge-arc { … }` (`:258-261`) and `&__gauge-tick { … }` (`:263-265`) rules (they contain only comments, no declarations).

- [ ] **Step 3: Keep the target value inside the ring at small sizes**

In `&__target-value` (`:59-64`), lower the max so the label doesn't extend past the ring; replace the `font-size` line with:

```scss
    font-size: clamp(1.2rem, calc(var(--cycle-overlay-diameter) * 0.13), 1.7rem);
```

- [ ] **Step 4: Verify the file still compiles (build the frontend bundle for SCSS errors)**

```bash
grep -n "cycle-overlay-edge\|&__gauge-arc\|&__gauge-tick" frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.scss
```
Expected: no matches (all removed). A full `vite build` is not required for this step; SCSS syntax is validated visually in Task 6.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.scss
git commit -m "chore(fitness): drop dead var + empty rules and contain target-RPM label in cycle overlay"
```

---

## Task 4 (optional polish): Animate the RPM needle via rotation

**Root cause:** `.cycle-needle { transition: x2 …, y2 … }` (`:273-275`) tries to transition SVG geometry attributes, which Chromium/the Shield WebView do not animate — so the needle jumps between readings. Rotating a `<g>` via a CSS `transform` (which *is* animatable) gives the intended sweep. Skip this task if you only want layout fixes.

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx` (needle markup + a `needleDeg` calc)
- Modify: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.scss` (`.cycle-needle` transition)
- Test: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx`

- [ ] **Step 1: Write the failing test**

Append to the `describe('CycleChallengeOverlay — extended UI', …)` block:

```js
  it('renders the needle as a rotated group, not via animated x2/y2', () => {
    const { container } = render(<CycleChallengeOverlay challenge={baseChallenge} />);
    const group = container.querySelector('.cycle-needle-group');
    expect(group).toBeTruthy();
    expect(group.getAttribute('style') || '').toMatch(/rotate\(/);
  });
```

- [ ] **Step 2: Run it to verify it fails**

```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx
```
Expected: FAIL — `.cycle-needle-group` does not exist.

- [ ] **Step 3: Replace the needle markup**

In `CycleChallengeOverlay.jsx`, after the `needleTip` calc (around `:211-217`), add the rotation degrees (base needle points up at 12 o'clock = angle `1.5π`):

```jsx
  const needleDeg = ((needleAngle - 1.5 * Math.PI) * 180) / Math.PI;
```

Replace the needle `<line>` and hub `<circle>` (`:350-366`) with a rotated group plus the hub:

```jsx
          <g
            className={`cycle-needle-group${atHi ? ' cycle-needle-group--at-hi' : ''}`}
            style={{
              transform: `rotate(${needleDeg}deg)`,
              transformBox: 'view-box',
              transformOrigin: `${CYCLE_RING_CENTER}px ${CYCLE_RING_CENTER}px`,
              transition: 'transform 0.18s ease'
            }}
          >
            <line
              className={`cycle-needle${atHi ? ' cycle-needle--at-hi' : ''}`}
              x1={CYCLE_RING_CENTER}
              y1={CYCLE_RING_CENTER}
              x2={CYCLE_RING_CENTER}
              y2={CYCLE_RING_CENTER - CYCLE_GAUGE_RADIUS}
              stroke={atHi ? '#22c55e' : '#e2e8f0'}
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </g>
          <circle
            className="cycle-needle-hub"
            cx={CYCLE_RING_CENTER}
            cy={CYCLE_RING_CENTER}
            r={3}
            fill={atHi ? '#22c55e' : '#e2e8f0'}
          />
```

- [ ] **Step 4: Update the SCSS transition**

In `CycleChallengeOverlay.scss`, replace the `.cycle-needle` rule (`:273-275`) — the transform transition now lives inline on the group, so the line only transitions color:

```scss
  .cycle-needle {
    transition: stroke 0.2s ease;
  }
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx
```
Expected: PASS (needle-group spec + all prior specs).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx \
        frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx \
        frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.scss
git commit -m "polish(fitness): sweep the cycle RPM needle via rotate transform instead of x2/y2"
```

---

## Task 5: Full overlay regression run

**Files:** none (verification only).

- [ ] **Step 1: Run both overlay spec files together**

```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx \
  frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.test.js
```
Expected: PASS — all specs green.

- [ ] **Step 2: Run the isolated harness for any related fallout**

```bash
npm run test:isolated
```
Expected: PASS, or only pre-existing unrelated failures (note any in the commit/PR description; do not "fix" by skipping).

---

## Task 6: Visual verification via the cycle-demo harness

jsdom can't confirm pixels, so confirm the real layout with the built-in self-running demo, which walks the cycle state machine through init → ramp → maintain → locked and shows boosters.

**Files:** none (manual/visual verification).

- [ ] **Step 1: Ensure the dev server is running**

```bash
ss -tlnp | grep 3112 || node backend/index.js
```
(On `kckern-server` the dev app port is 3111 / backend 3112 per `CLAUDE.local.md`.)

- [ ] **Step 2: Open the fitness player with the demo flag**

Navigate a browser to the fitness play route with `?cycle-demo=1`, e.g. `http://localhost:3111/fitness/play/<any-session-id>?cycle-demo=1` (the `CycleChallengeDemo` mounts on top of `FitnessPlayer` and drives the overlay automatically). If unsure of the route id, use the `run` skill to launch the app and the `verify` skill to drive/screenshot it.

- [ ] **Step 3: Inspect each state and confirm the audit findings are resolved**

Check, at the small (~190px) end of the size range (narrow the window height to force the `22vh` clamp low):
- [ ] **Booster pips** sit on the ring's diagonals, *inside/attached to* the circle — not floating to the right/around it.
- [ ] **No overlap** between phase blocks, current-RPM pill, boost badge, and rider name — they read as a clean vertical stack.
- [ ] **Countdown** ("Start in …s" / "Reach target in …s") appears centered in the stack during init/ramp, **not** in the top-left corner.
- [ ] **Target-RPM number** stays within the ring (doesn't clip above the disc).
- [ ] **Needle** (if Task 4 done) sweeps smoothly between RPM values instead of jumping.

- [ ] **Step 4: If a residual is found**, treat it as a follow-up tweak to the relevant clamp/coefficient in `CycleChallengeOverlay.scss` (e.g. tighten `&__stack` `gap`, `&__avatar` size, or `--cycle-overlay-size`), re-run Task 5, and amend the last commit.

---

## Self-Review Notes

- **Spec coverage:** Booster float (Task 1), bottom-stack overlap + countdown centering + boost-badge scaling + size (Task 2), dead CSS + target containment (Task 3), needle animation (Task 4, optional), regression (Task 5), visual confirmation (Task 6). All audit findings mapped.
- **No placeholders:** every code step shows full code; commands are exact with expected output.
- **Type/name consistency:** new classes `__stack`, `__rider-name-text`, `cycle-needle-group` are introduced in JSX (Task 2/4) and styled/asserted under the same names. `getBoosterAvatarSlots` keeps its return shape `{ id, initial, style: { top, left } }`; only the values change from px to %.
- **Out of scope (noted, not changed):** the zone-based `ChallengeOverlay.jsx`/`.scss` and `ChallengeOverlayDeck` positioning — this plan touches only the cycle overlay and its direct helper/tests.
