# FamilySelector Spin Animation Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the broken roulette wheel spin animation and clean up 6 additional issues found during audit.

**Architecture:** The FamilySelector is a React component rendering an SVG roulette wheel. Spinning relies on CSS transitions triggered by React state updates. The core bug is a race between setting the transition property and the transform property in the same render frame. Secondary fixes address the state machine, dead CSS, math errors, and dead code.

**Tech Stack:** React (hooks), CSS transitions on SVG, Playwright for integration testing.

---

### Task 1: Fix spin animation — replace setTimeout with transitionend

The double-RAF approach (already in code) correctly separates the transition-apply render from the rotation-change render. But the `setTimeout(fn, 8000)` that detects spin completion can fire early/late relative to the actual CSS transition, causing visual snaps. Replace with `transitionend` event.

**Files:**
- Modify: `frontend/src/modules/AppContainer/Apps/FamilySelector/FamilySelector.jsx:195-248` (RouletteWheel component)
- Modify: `frontend/src/modules/AppContainer/Apps/FamilySelector/FamilySelector.jsx:293-322` (spin function)

**Step 1: Add a ref to the wheel `<g>` element for transitionend**

In `RouletteWheel`, add a ref and fire a callback when the transition ends:

```jsx
function RouletteWheel({ members, rotation, isSpinning, winnerIndex, showResult, onSpinEnd }) {
  const size = 400;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 10;
  const wheelRef = useRef(null);

  useEffect(() => {
    const el = wheelRef.current;
    if (!el || !isSpinning) return;
    const handler = (e) => {
      if (e.propertyName === 'transform') onSpinEnd?.();
    };
    el.addEventListener('transitionend', handler);
    return () => el.removeEventListener('transitionend', handler);
  }, [isSpinning, onSpinEnd]);
```

Add the ref to the `<g>`:
```jsx
<g className="wheel-segments" style={wheelStyle} ref={wheelRef}>
```

**Step 2: Replace setTimeout in spin() with onSpinEnd callback**

In `FamilySelectorInner`, replace the setTimeout block:

```jsx
// DELETE this block:
setTimeout(() => {
  const elapsed = performance.now() - t0;
  console.log(`[FamilySelector ${performance.now().toFixed(0)}] setTimeout fired — elapsed: ${elapsed.toFixed(0)}ms, setState → RESULT`);
  setWheelState(WHEEL_STATE.RESULT);
}, SPIN_CONFIG.durationMs);
```

Add a stable `handleSpinEnd` callback:
```jsx
const handleSpinEnd = useCallback(() => {
  setWheelState(WHEEL_STATE.RESULT);
}, []);
```

Pass it to RouletteWheel:
```jsx
<RouletteWheel
  members={activeMembers}
  rotation={rotation}
  isSpinning={wheelState === WHEEL_STATE.SPINNING}
  winnerIndex={winnerIndex}
  showResult={wheelState === WHEEL_STATE.RESULT}
  onSpinEnd={handleSpinEnd}
/>
```

**Step 3: Add `useRef` to the import**

Update the import at line 1:
```jsx
import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
```

**Step 4: Remove debug console.log statements**

Remove all `console.log` lines containing `[FamilySelector` — these were diagnostic for the bug investigation.

Lines to remove: 145-146, 211, 299, 305, 311, 319.

**Step 5: Test manually**

Open `http://localhost:3111/tv/app/family-selector`, press SPACE. Verify:
- Wheel spins smoothly for ~8 seconds with easing
- Winner modal appears immediately when wheel stops (no delay, no snap)
- Avatars counter-rotate to stay upright during spin

**Step 6: Commit**

```bash
git add frontend/src/modules/AppContainer/Apps/FamilySelector/FamilySelector.jsx
git commit -m "fix(family-selector): replace setTimeout with transitionend for spin completion"
```

---

### Task 2: Fix re-spin — allow RESULT → IDLE transition

After one spin the wheel is stuck in RESULT state forever. The keyboard handler only fires when `wheelState === IDLE`. Need a path back to IDLE.

**Files:**
- Modify: `frontend/src/modules/AppContainer/Apps/FamilySelector/FamilySelector.jsx:293-342`

**Step 1: Update spin() to reset from RESULT state**

Change the guard at the top of `spin()`:

```jsx
const spin = useCallback(() => {
  if (wheelState === WHEEL_STATE.SPINNING) return;
  // ... rest of spin logic
```

**Step 2: Update keyboard handler to allow re-spin from RESULT**

Change line 334:
```jsx
if ((isPlayButton || isArrowKey) && wheelState !== WHEEL_STATE.SPINNING) {
```

**Step 3: Reset wheel state at start of spin**

At the beginning of spin(), before selecting winner, set transition to none so the wheel doesn't animate back:

```jsx
const spin = useCallback(() => {
  if (wheelState === WHEEL_STATE.SPINNING) return;

  setWheelState(WHEEL_STATE.IDLE);
  // The double-RAF below ensures IDLE renders (transition: none) before SPINNING
```

Actually, this needs care — we need IDLE to render first (so `transition: none` is painted), then proceed to SPINNING + rotation. Simplest approach: if currently in RESULT, reset to IDLE and use a timeout/RAF to trigger spin on next frame.

Better approach — handle it in one flow by tracking a "preparing" micro-state:

```jsx
const spin = useCallback(() => {
  if (wheelState === WHEEL_STATE.SPINNING) return;

  const { index, member } = selectWinner();
  const angle = calculateSpinAngle(index, activeMembers.length, rotation);

  setWinnerIndex(index);
  setSelectedMember(member);
  setWheelState(WHEEL_STATE.SPINNING);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      setRotation(prev => prev + angle);
    });
  });
}, [wheelState, selectWinner, activeMembers.length, rotation]);
```

This works because when going from RESULT → SPINNING, the transition property changes from `none` to the 8s transition. The double-RAF ensures the SPINNING state (with transition applied) paints before the rotation updates. The key insight: RESULT already has `transition: none` and the old rotation value — so going RESULT → SPINNING re-applies the transition property, then the next RAF changes rotation, and CSS animates.

**Step 4: Test manually**

1. Press SPACE — wheel spins, winner modal appears
2. Press SPACE again — modal disappears, wheel spins again to a new winner
3. Repeat 3+ times to verify no stuck state

**Step 5: Commit**

```bash
git add frontend/src/modules/AppContainer/Apps/FamilySelector/FamilySelector.jsx
git commit -m "fix(family-selector): allow re-spin from result state"
```

---

### Task 3: Remove dead CSS and resolve inline/SCSS conflict

SCSS lines 80-89 define `.avatar-wrapper` transform/transition rules that are entirely overridden by inline styles. The CSS uses `4000ms` while inline uses `8000ms`. Remove the dead CSS since inline styles are the source of truth.

**Files:**
- Modify: `frontend/src/modules/AppContainer/Apps/FamilySelector/FamilySelector.scss:75-89`

**Step 1: Remove dead avatar-wrapper CSS rules**

Replace lines 75-89 with just the transform-origin fix (Task 5 will handle the value):

```scss
.wheel-segments {
  transform-origin: 200px 200px;
}
```

Delete entirely:
```scss
/* Avatar wrapper for counter-rotation (ferris wheel effect) */
.avatar-wrapper {
  transform: rotate(calc(-1 * var(--wheel-rotation)));
  transform-origin: center center;
}

/* When spinning, sync the counter-rotation with wheel animation */
.roulette-wheel.spinning .avatar-wrapper {
  transition: transform 4000ms cubic-bezier(0.17, 0.67, 0.12, 0.99);
}
```

These are dead — the `<g class="avatar-wrapper" style={avatarStyle}>` inline styles in JSX control the actual transform and transition.

**Step 2: Also remove the `--wheel-rotation` CSS custom property from JSX**

In `RouletteWheel` (around line 207), remove the `--wheel-rotation` line from `wheelStyle` since it was only used by the now-deleted CSS:

```jsx
const wheelStyle = {
  transform: `rotate(${rotation}deg)`,
  transition: wheelTransition,
};
```

**Step 3: Test manually**

Verify wheel still spins correctly and avatars still counter-rotate to stay upright.

**Step 4: Commit**

```bash
git add frontend/src/modules/AppContainer/Apps/FamilySelector/FamilySelector.jsx
git add frontend/src/modules/AppContainer/Apps/FamilySelector/FamilySelector.scss
git commit -m "fix(family-selector): remove dead CSS conflicting with inline avatar styles"
```

---

### Task 4: Fix pointer flick duration math

The formula for `segmentPassDuration` produces ~180,000ms for typical values. Fix to correct formula.

**Files:**
- Modify: `frontend/src/modules/AppContainer/Apps/FamilySelector/FamilySelector.jsx:214`

**Step 1: Fix the formula**

Replace:
```jsx
const segmentPassDuration = (SPIN_CONFIG.durationMs / ((rotation || 1) / 360)) * (360 / members.length);
```

With:
```jsx
const segmentPassDuration = rotation > 0
  ? (SPIN_CONFIG.durationMs * 360) / (rotation * members.length)
  : 1000;
```

For typical values (rotation=1830, members=5): `(8000 * 360) / (1830 * 5)` = ~315ms per segment, which is a reasonable flick rate.

**Step 2: Test manually**

During a spin, verify the pointer triangle flicks at a visually sensible rate (roughly matching segments passing).

**Step 3: Commit**

```bash
git add frontend/src/modules/AppContainer/Apps/FamilySelector/FamilySelector.jsx
git commit -m "fix(family-selector): correct pointer flick duration formula"
```

---

### Task 5: Fix SVG transform-origin fragility

`.wheel-segments` uses `transform-origin: center center`, which resolves from the `<g>` bounding box. Should be explicit `200px 200px` (half the 400px viewBox).

**Files:**
- Modify: `frontend/src/modules/AppContainer/Apps/FamilySelector/FamilySelector.scss:75-78`

**Step 1: Update transform-origin**

This was already handled in Task 3 — the `.wheel-segments` rule was updated to:
```scss
.wheel-segments {
  transform-origin: 200px 200px;
}
```

If Task 3 was completed, this task is already done. Verify the value is `200px 200px`.

**Step 2: Commit (if not already committed with Task 3)**

```bash
git add frontend/src/modules/AppContainer/Apps/FamilySelector/FamilySelector.scss
git commit -m "fix(family-selector): use explicit SVG transform-origin"
```

---

### Task 6: Remove dead code

`getInstructionText()` (lines 356-365) is defined but never called. The `.wheel-instructions` CSS class is also unused in JSX.

**Files:**
- Modify: `frontend/src/modules/AppContainer/Apps/FamilySelector/FamilySelector.jsx:356-365`
- Modify: `frontend/src/modules/AppContainer/Apps/FamilySelector/FamilySelector.scss:142-167`

**Step 1: Delete `getInstructionText()` from JSX**

Remove the entire function (lines 356-365):
```jsx
// DELETE:
const getInstructionText = () => {
  switch (wheelState) {
    case WHEEL_STATE.SPINNING:
      return 'Spinning...';
    case WHEEL_STATE.RESULT:
      return 'Press SPACE to spin again!';
    default:
      return 'Press SPACE to spin!';
  }
};
```

**Step 2: Delete `.wheel-instructions` CSS rules**

Remove from SCSS (lines 142-167):
```scss
// DELETE the entire .wheel-instructions block and the
// .family-selector[data-state="spinning"] .wheel-instructions block
```

**Step 3: Commit**

```bash
git add frontend/src/modules/AppContainer/Apps/FamilySelector/FamilySelector.jsx
git add frontend/src/modules/AppContainer/Apps/FamilySelector/FamilySelector.scss
git commit -m "chore(family-selector): remove unused getInstructionText and wheel-instructions CSS"
```

---

### Task 7: Final integration test

**Step 1: Manual verification checklist**

Open `http://localhost:3111/tv/app/family-selector` and verify:

- [ ] Press SPACE — wheel spins smoothly with easing curve (~8s)
- [ ] Avatars stay upright during spin (counter-rotation works)
- [ ] Pointer flicks at a reasonable rate during spin
- [ ] Winner modal appears immediately when wheel stops (no delay)
- [ ] Press SPACE again — modal disappears, wheel re-spins
- [ ] Repeat 3+ times — no stuck states
- [ ] No console errors or debug logs
- [ ] Works on TV route via menu navigation

**Step 2: Commit all remaining changes (if any)**

```bash
git status
# Stage any remaining unstaged fixes
git add frontend/src/modules/AppContainer/Apps/FamilySelector/FamilySelector.jsx
git add frontend/src/modules/AppContainer/Apps/FamilySelector/FamilySelector.scss
git commit -m "fix(family-selector): complete spin animation and state machine fixes"
```
