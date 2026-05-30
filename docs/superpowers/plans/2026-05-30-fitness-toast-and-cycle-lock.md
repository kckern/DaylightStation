# Fitness Toast Tweaks + Cycle Health-Lock Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the fitness toasts (countdown direction, tap-to-dismiss, "people" wording), declutter the cycle overlay (float the boost badge, remove the countdown text + booster pips), and redesign the cycle health-lock so the cycle overlay itself becomes a promoted, centered, dimmed, music-playing real lock screen.

**Architecture:** A/B/C are contained UI edits with unit/component tests. D introduces one pure resolver (`resolveLockScreen.js`) that becomes the single source of truth for "which lock UI shows, promoted or not, with what audio" — eliminating the three independent booleans + state-cache race that caused the blank screen / vanishing overlay / no-music bugs. `FitnessPlayerOverlay` renders from that one descriptor.

**Tech Stack:** React, vitest + @testing-library/react, SCSS, project structured logging (`getLogger`). Cycle health-lock behavior is **not automatable** — it has a dedicated manual simulator test (Task D5).

**Spec:** `docs/superpowers/specs/2026-05-30-fitness-toast-and-cycle-lock-design.md`
**Audit:** `docs/_wip/audits/2026-05-30-fitness-toast-and-cycle-lock-audit.md`

---

## File Structure

| File | Responsibility | Tasks |
|------|----------------|-------|
| `frontend/src/modules/Fitness/player/overlays/FitnessToast.scss` | countdown direction (A1), tappable cursor (A2) | A1, A2 |
| `frontend/src/modules/Fitness/player/overlays/FitnessToast.jsx` | tap-to-dismiss handler (A2) | A2 |
| `frontend/src/modules/Fitness/player/overlays/FitnessToast.test.jsx` | tap-dismiss test (A2) | A2 |
| `frontend/src/modules/Fitness/player/overlays/buildChallengeToast.js` | "riders"→"people" (B) | B |
| `frontend/src/modules/Fitness/player/overlays/buildChallengeToast.test.js` | copy tests (B) | B |
| `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx` | float boost badge, remove countdown + boosters (C1-C3) | C1, C2, C3 |
| `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.scss` | boost-badge float CSS, drop countdown/booster CSS | C1, C2, C3 |
| `frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.js` | delete dead `getBoosterAvatarSlots` (C3) | C3 |
| `frontend/src/modules/Fitness/player/overlays/resolveLockScreen.js` (new) | pure lock-screen-variety resolver (D1) | D1 |
| `frontend/src/modules/Fitness/player/overlays/resolveLockScreen.test.js` (new) | resolver tests (D1) | D1 |
| `frontend/src/modules/Fitness/player/FitnessPlayerOverlay.jsx` | render from descriptor; promote wrapper; mount lock audio (D2/D3) | D2, D3 |
| `frontend/src/modules/Fitness/player/overlays/CycleLockScreen.scss` (new) | center + 2x + dim scrim (D2) | D2 |
| `frontend/src/modules/Fitness/hooks/useGovernanceDisplay.js` | (no change needed — resolver takes authority; verify only) | D2 |

---

## Task A1: Toast countdown bar runs left → right

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/FitnessToast.scss` (the `&__countdown-bar` rule, ~line 57-66)

- [ ] **Step 1: Make the change**

In `FitnessToast.scss`, find the `&__countdown-bar` block. It currently reads:

```scss
  &__countdown-bar {
    height: 100%;
    width: 100%;
    transform-origin: left center;
    background: currentColor;
    opacity: 0.6;
    animation-name: fitness-toast-countdown;
    animation-timing-function: linear;
    animation-fill-mode: forwards;
  }
```

Change `transform-origin: left center;` to `transform-origin: right center;`.

Rationale: the keyframe `fitness-toast-countdown` scales X from 1→0. With `right center` origin, the bar collapses toward the right, so the depleting edge travels left→right (the fill drains from the left). Leave the keyframe untouched.

- [ ] **Step 2: Verify build parses**

Run: `cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Fitness/player/overlays/FitnessToast.test.jsx`
Expected: PASS (this is a CSS-only change; existing tests still green — they don't assert on direction).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/FitnessToast.scss
git commit -m "fix(fitness): toast countdown bar depletes left to right

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task A2: Tap / click to dismiss the toast

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/FitnessToast.jsx`
- Modify: `frontend/src/modules/Fitness/player/overlays/FitnessToast.scss` (root `pointer-events`, cursor)
- Test: `frontend/src/modules/Fitness/player/overlays/FitnessToast.test.jsx`

- [ ] **Step 1: Write the failing test**

Add this test inside the `describe('FitnessToast', ...)` block in `FitnessToast.test.jsx` (after the existing tests, before the closing `});`):

```jsx
  it('dismisses on click: fires onDone(id) once after the exit animation', () => {
    const onDone = vi.fn();
    const { container } = render(<FitnessToast toast={{ id: 9, title: 'Tap me', durationMs: 4000 }} onDone={onDone} />);
    const root = container.querySelector('.fitness-toast');
    expect(root).not.toBeNull();
    act(() => { root.click(); });
    // Not immediate — exit animation plays first.
    expect(onDone).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(320 + 5); });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(9);
    // The original duration timer must NOT also fire onDone again.
    act(() => { vi.advanceTimersByTime(4000 + 320 + 5); });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Fitness/player/overlays/FitnessToast.test.jsx -t "dismisses on click"`
Expected: FAIL — `onDone` is called 0 times (no click handler yet), so `toHaveBeenCalledTimes(1)` fails.

- [ ] **Step 3: Implement the click handler**

In `FitnessToast.jsx`, the effect currently stores its two timers in local consts and clears them on cleanup. To allow a manual dismiss to cancel the pending timers, hoist them into a ref and add a dismiss callback.

Add a ref near the existing state (after `const [imgFailed, setImgFailed] = useState(false);`):

```jsx
  const timersRef = React.useRef({ hide: null, done: null });
```

(If `React` default import isn't present, use the existing `useRef` import — the file already imports `useEffect, useMemo, useState`; add `useRef, useCallback` to that import line: `import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';`.)

Replace the existing effect body's timer assignment + cleanup so the timers live in the ref:

```jsx
  useEffect(() => {
    if (id == null) return undefined;
    setExiting(false);
    setImgFailed(false);
    const durationMs = Number.isFinite(toast?.durationMs) ? toast.durationMs : DEFAULT_TOAST_DURATION_MS;
    logger.info('fitness.toast.shown', { id, variant: toast?.variant, durationMs });
    timersRef.current.hide = setTimeout(() => setExiting(true), durationMs);
    timersRef.current.done = setTimeout(() => {
      logger.info('fitness.toast.dismissed', { id, reason: 'timeout' });
      if (typeof onDone === 'function') onDone(id);
    }, durationMs + TOAST_EXIT_MS);
    return () => {
      clearTimeout(timersRef.current.hide);
      clearTimeout(timersRef.current.done);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
```

Add the manual-dismiss handler below the effect:

```jsx
  const handleDismiss = useCallback(() => {
    if (id == null) return;
    // Cancel the scheduled timers so onDone only fires once.
    clearTimeout(timersRef.current.hide);
    clearTimeout(timersRef.current.done);
    setExiting(true);
    timersRef.current.done = setTimeout(() => {
      logger.info('fitness.toast.dismissed', { id, reason: 'tap' });
      if (typeof onDone === 'function') onDone(id);
    }, TOAST_EXIT_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, onDone]);
```

Wire it onto the root element. Change the opening container div:

```jsx
    <div className={className} role="status" aria-live="polite">
```

to:

```jsx
    <div className={className} role="status" aria-live="polite" onClick={handleDismiss}>
```

- [ ] **Step 4: Make the root tappable (SCSS)**

In `FitnessToast.scss`, the root `.fitness-toast` rule has `pointer-events: none; // non-blocking`. Change it to allow taps on the toast itself:

```scss
  pointer-events: auto; // tappable to dismiss; the toast is small + centered
  cursor: pointer;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Fitness/player/overlays/FitnessToast.test.jsx`
Expected: PASS (all tests, including the new "dismisses on click" and the existing timeout tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/FitnessToast.jsx frontend/src/modules/Fitness/player/overlays/FitnessToast.scss frontend/src/modules/Fitness/player/overlays/FitnessToast.test.jsx
git commit -m "feat(fitness): tap/click to dismiss toast

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task B: Challenge toast wording "riders" → "people"

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/buildChallengeToast.js`
- Test: `frontend/src/modules/Fitness/player/overlays/buildChallengeToast.test.js`

- [ ] **Step 1: Update the tests first (red)**

In `buildChallengeToast.test.js`, replace every occurrence of "riders"/"rider" with "people"/"person". The expected strings become:
- start, count 3, zone Active: `Get 3 people to Active`
- end, 3 of 3, Active: `3 of 3 people reached Active`
- start, count 1, zone Active: `Get 1 person to Active`
- end, 1 of 1, Active: `1 of 1 person reached Active`

Concretely, find the assertions referencing rider text and update them. For example, change:

```js
    expect(buildChallengeToast('start', { requiredCount: 3, zoneLabel: 'Active' }).subtitle)
      .toBe('Get 3 riders to Active');
```

to:

```js
    expect(buildChallengeToast('start', { requiredCount: 3, zoneLabel: 'Active' }).subtitle)
      .toBe('Get 3 people to Active');
```

Apply the same substitution to the singular case (`'Get 1 person to Active'`) and the end-event cases (`'3 of 3 people reached Active'`, `'1 of 1 person reached Active'`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Fitness/player/overlays/buildChallengeToast.test.js`
Expected: FAIL — current code emits "riders"/"rider", tests now expect "people"/"person".

- [ ] **Step 3: Update the implementation**

In `buildChallengeToast.js`, rename the word helper and its uses. Change:

```js
  const riderWord = (n) => (n === 1 ? 'rider' : 'riders');
```

to:

```js
  const peopleWord = (n) => (n === 1 ? 'person' : 'people');
```

Then update the two subtitle template lines to call `peopleWord`:

```js
    const subtitle = (requiredCount != null && zoneLabel)
      ? `Get ${requiredCount} ${peopleWord(requiredCount)} to ${zoneLabel}`
      : undefined;
```

and:

```js
  const subtitle = (actualCount != null && requiredCount != null && zoneLabel)
    ? `${actualCount} of ${requiredCount} ${peopleWord(requiredCount)} reached ${zoneLabel}`
    : undefined;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Fitness/player/overlays/buildChallengeToast.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/buildChallengeToast.js frontend/src/modules/Fitness/player/overlays/buildChallengeToast.test.js
git commit -m "fix(fitness): challenge toast says 'people' not 'riders'

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task C1: Float the boost multiplier badge underneath the overlay

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx` (boost badge JSX ~411-418)
- Modify: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.scss` (`&__boost-badge` ~330-342)

- [ ] **Step 1: Move the badge JSX out of `__stack`**

In `CycleChallengeOverlay.jsx`, the boost badge currently sits inside the `<div className="cycle-challenge-overlay__stack">…</div>` flex column. Remove this block from inside `__stack`:

```jsx
        {showBoostBadge && (
          <div
            className="cycle-challenge-overlay__boost-badge"
            aria-label={`Boost multiplier ${boostText}`}
          >
            {boostText}
          </div>
        )}
```

Re-add it as a **sibling of `__stack`** (a direct child of the root `.cycle-challenge-overlay` div), placed just after the closing `</div>` of `__stack` (and before the `{boosters.map(...)}` block, which Task C3 will delete):

```jsx
      {showBoostBadge && (
        <div
          className="cycle-challenge-overlay__boost-badge"
          aria-label={`Boost multiplier ${boostText}`}
        >
          {boostText}
        </div>
      )}
```

- [ ] **Step 2: Make the badge float underneath (SCSS)**

In `CycleChallengeOverlay.scss`, replace the `&__boost-badge` rule. It currently reads:

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

Replace it with a floating, absolutely-positioned version anchored just below the circle so it never reflows the stack:

```scss
  // Boost multiplier pill — floats just BELOW the overlay circle, absolutely
  // positioned so its appearance never reflows the bottom stack. Only rendered
  // when boostMultiplier > 1.0.
  &__boost-badge {
    position: absolute;
    top: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
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

(Keep the `@keyframes cycle-boost-pulse` block as-is; note the `transform` is now overridden each pulse frame — the pulse keyframe animates `transform: scale(...)`, which would drop the `translateX`. To preserve centering, change the keyframe to include the translate. Update `@keyframes cycle-boost-pulse` to:)

```scss
@keyframes cycle-boost-pulse {
  0%,
  100% {
    transform: translateX(-50%) scale(1);
  }
  50% {
    transform: translateX(-50%) scale(1.08);
  }
}
```

- [ ] **Step 2b: Run the overlay suite to confirm no break**

Run: `cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Fitness/player/overlays`
Expected: PASS (no test asserts badge position yet; Task C adds the render test in C3's step). This step just confirms nothing regressed.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.scss
git commit -m "fix(fitness): float cycle boost badge below overlay (no stack reflow)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task C2: Remove the init/ramp countdown status text

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx` (countdown JSX ~431-447)
- Modify: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.scss` (`&__countdown` ~220-226)

- [ ] **Step 1: Delete the countdown JSX**

In `CycleChallengeOverlay.jsx`, delete this entire block from inside `__stack`:

```jsx
        {((challenge.cycleState === 'init' && Number.isFinite(initRemainingMs)) ||
          (challenge.cycleState === 'ramp' && Number.isFinite(rampRemainingMs))) && (
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
```

- [ ] **Step 2: Delete the countdown SCSS**

In `CycleChallengeOverlay.scss`, delete the `&__countdown` rule:

```scss
  // --- Init/ramp countdown (inside __stack) --------------------------------
  &__countdown {
    font-size: clamp(0.6rem, calc(var(--cycle-overlay-diameter) * 0.05), 0.75rem);
    color: #94a3b8;
    text-align: center;
    line-height: 1.15;
    pointer-events: none;
  }
```

- [ ] **Step 3: Clean up now-unused destructured vars**

`initRemainingMs`, `rampRemainingMs`, and `clockPaused` are destructured from `visuals` (around line 162-165) solely for the countdown. After removing the countdown, check whether they are still referenced anywhere in the file:

Run: `cd /opt/Code/DaylightStation && grep -n "initRemainingMs\|rampRemainingMs\|clockPaused" frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx`

For each variable that now appears ONLY on its destructuring line, remove it from the destructure to avoid an unused-var lint error. (If a variable is still used elsewhere, leave it.) Edit the destructuring block:

```jsx
  const {
    ringColor,
    ringOpacity,
    dimPulse,
    phaseProgress,
    lostSignal,
    stale,
    waitingForBaseReq,
    cycleHealthPct
  } = visuals;
```

(i.e. drop `initRemainingMs`, `rampRemainingMs`, `clockPaused` from this destructure only if the grep confirms they are otherwise unused.)

- [ ] **Step 4: Run the overlay suite**

Run: `cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Fitness/player/overlays`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.scss
git commit -m "fix(fitness): remove cycle overlay init/ramp countdown status text

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task C3: Remove the booster avatar pips + dead helper, add overlay render test

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx` (booster map ~458-467; import; `boosters` const ~220-223)
- Modify: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.scss` (`&__booster` ~309-326)
- Modify: `frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.js` (delete `getBoosterAvatarSlots` ~199-239)
- Modify: `frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.test.js` (remove the `getBoosterAvatarSlots` describe block — it exercises the function we're deleting)
- Modify (EXISTING, do NOT create): `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx` (243 lines already present — ADD the new cases below)

> ⚠️ Both test files already exist. `cycleOverlayVisuals.test.js` has a
> `describe('getBoosterAvatarSlots — percentage positioning', …)` block (~lines 76-100)
> that imports and tests `getBoosterAvatarSlots`; that block MUST be removed in this task
> or the suite fails to import after the function is deleted. `CycleChallengeOverlay.test.jsx`
> already exists — append the new cases, don't recreate the file.

- [ ] **Step 1: Add the new render cases to the EXISTING `CycleChallengeOverlay.test.jsx` (red)**

Open `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx`. It already
imports `{ CycleChallengeOverlay }`, `render`, and vitest helpers. Add a new `describe` block
at the end of the file (before the final newline), reusing the file's existing import style
(do not duplicate imports already present at the top):

```jsx
describe('CycleChallengeOverlay — C3 cleanup (badge float, no boosters, no countdown)', () => {
  const c3Challenge = {
    type: 'cycle',
    cycleState: 'maintain',
    phaseProgressPct: 50,
    currentPhaseIndex: 1,
    totalPhases: 4,
    currentRpm: 72,
    currentPhase: { hiRpm: 80, loRpm: 60 },
    cycleHealthPct: 100,
    boostMultiplier: 2.5,
    boostingUsers: ['kckern', 'milo'],
    rider: { id: 'felix', name: 'Felix' }
  };

  it('renders the boost badge when multiplier > 1', () => {
    const { container } = render(<CycleChallengeOverlay challenge={c3Challenge} />);
    const badge = container.querySelector('.cycle-challenge-overlay__boost-badge');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toContain('2.5');
  });

  it('renders the boost badge OUTSIDE the bottom stack (no reflow)', () => {
    const { container } = render(<CycleChallengeOverlay challenge={c3Challenge} />);
    const stack = container.querySelector('.cycle-challenge-overlay__stack');
    expect(stack).not.toBeNull();
    expect(stack.querySelector('.cycle-challenge-overlay__boost-badge')).toBeNull();
  });

  it('does not render booster avatar pips', () => {
    const { container } = render(<CycleChallengeOverlay challenge={c3Challenge} />);
    expect(container.querySelector('.cycle-challenge-overlay__booster')).toBeNull();
  });

  it('does not render the init/ramp countdown text', () => {
    const { container } = render(
      <CycleChallengeOverlay challenge={{ ...c3Challenge, cycleState: 'init', initRemainingMs: 20000 }} />
    );
    expect(container.querySelector('.cycle-challenge-overlay__countdown')).toBeNull();
  });
});
```

> If the existing file does not already import `render` from `@testing-library/react` or the
> vitest globals, add them — but it almost certainly does (it's a 243-line component test).
> Confirm the top-of-file imports before running; do not add duplicates.

- [ ] **Step 2: Run to verify it fails**

Run: `cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx -t "C3 cleanup"`
Expected: FAIL — "does not render booster avatar pips" fails (boosters still render). (The badge-outside-stack case already passes if Task C1 landed; the countdown case already passes if Task C2 landed.)

- [ ] **Step 3: Remove the booster JSX + `boosters` const + import**

In `CycleChallengeOverlay.jsx`:

(a) Delete the booster render block (the last children before the root closing `</div>`):

```jsx
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

(b) Delete the `boosters` computation (~line 220-223):

```jsx
  const boosters = getBoosterAvatarSlots(
    Array.isArray(challenge.boostingUsers) ? challenge.boostingUsers : [],
    CYCLE_VIEWBOX_SIZE
  );
```

(c) Remove `getBoosterAvatarSlots` from the import at the top of the file. Change:

```jsx
import {
  getCycleOverlayVisuals,
  polarToCartesian,
  rpmToAngle,
  getBoosterAvatarSlots
} from './cycleOverlayVisuals.js';
```

to:

```jsx
import {
  getCycleOverlayVisuals,
  polarToCartesian,
  rpmToAngle
} from './cycleOverlayVisuals.js';
```

- [ ] **Step 4: Delete the booster SCSS**

In `CycleChallengeOverlay.scss`, delete the `&__booster` rule and its comment header (~304-326):

```scss
  // --- Booster avatars + boost multiplier badge (Task 23) -----------------
  // Booster avatars: small pips at the four outer corners (NE, SE, SW, NW)
  // ...
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

- [ ] **Step 5: Delete the dead `getBoosterAvatarSlots` helper**

In `cycleOverlayVisuals.js`, delete the entire `getBoosterAvatarSlots` export (~203-224):

```js
/**
 * Booster avatar slot positions around the ring (NE, SE, SW, NW).
 * Returns up to 4 slots with {id, initial, style} for absolute positioning.
 */
export function getBoosterAvatarSlots(boostingUsers) {
  if (!Array.isArray(boostingUsers) || boostingUsers.length === 0) return [];
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

- [ ] **Step 5b: Remove the `getBoosterAvatarSlots` tests from `cycleOverlayVisuals.test.js`**

`cycleOverlayVisuals.test.js` imports `getBoosterAvatarSlots` and has a dedicated describe
block for it. With the function deleted, that import resolves to `undefined` and the block
throws. Remove both:

(a) In the import at the top of `cycleOverlayVisuals.test.js`, change:

```js
import { getCycleOverlayVisuals, getBoosterAvatarSlots } from './cycleOverlayVisuals.js';
```

to:

```js
import { getCycleOverlayVisuals } from './cycleOverlayVisuals.js';
```

(b) Delete the entire `describe('getBoosterAvatarSlots — percentage positioning', () => { … });`
block (~lines 76-100, through its closing `});`). Leave the `getCycleOverlayVisuals` tests intact.

Confirm no other importers remain:

Run: `cd /opt/Code/DaylightStation && grep -rn "getBoosterAvatarSlots" frontend/src`
Expected: no matches.

- [ ] **Step 6: Run the new test + full overlay suite**

Run: `cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Fitness/player/overlays`
Expected: PASS (all overlay tests including the new `CycleChallengeOverlay.test.jsx`).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.scss frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.js frontend/src/modules/Fitness/player/overlays/cycleOverlayVisuals.test.js frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.test.jsx
git commit -m "fix(fitness): remove cycle overlay booster pips + dead helper; add overlay test

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task D1: Pure lock-screen-variety resolver

**Files:**
- Create: `frontend/src/modules/Fitness/player/overlays/resolveLockScreen.js`
- Test: `frontend/src/modules/Fitness/player/overlays/resolveLockScreen.test.js`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Fitness/player/overlays/resolveLockScreen.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { resolveLockScreen } from './resolveLockScreen.js';

const cycleHealthLockChallenge = {
  type: 'cycle',
  cycleState: 'locked',
  lockReason: 'health',
  status: 'pending'
};

describe('resolveLockScreen', () => {
  it('cycle health-lock takes precedence even when governance shows a panel', () => {
    const d = resolveLockScreen({
      activeChallenge: cycleHealthLockChallenge,
      governanceDisplay: { show: true, status: 'pending', rows: [] }
    });
    expect(d.variety).toBe('cycle-health');
    expect(d.showCycleOverlay).toBe(true);
    expect(d.showGovernanceOverlay).toBe(false);
    expect(d.promoteCycle).toBe(true);
    expect(d.audioTrack).toBe('locked');
    expect(d.videoLocked).toBe(true);
  });

  it('cycle health-lock is detected when governance status is unlocked (the normal case)', () => {
    const d = resolveLockScreen({
      activeChallenge: cycleHealthLockChallenge,
      governanceDisplay: { show: false, status: 'unlocked', rows: [] }
    });
    expect(d.variety).toBe('cycle-health');
    expect(d.showGovernanceOverlay).toBe(false);
    expect(d.promoteCycle).toBe(true);
  });

  it('governance lock renders the governance overlay (no cycle promotion)', () => {
    const d = resolveLockScreen({
      activeChallenge: null,
      governanceDisplay: { show: true, status: 'locked', rows: [{ key: 'a' }], videoLocked: true }
    });
    expect(d.variety).toBe('governance');
    expect(d.showGovernanceOverlay).toBe(true);
    expect(d.showCycleOverlay).toBe(false);
    expect(d.promoteCycle).toBe(false);
    expect(d.videoLocked).toBe(true);
  });

  it('non-health cycle lock (init/ramp) is NOT a cycle-health lock', () => {
    const d = resolveLockScreen({
      activeChallenge: { type: 'cycle', cycleState: 'locked', lockReason: 'init', status: 'pending' },
      governanceDisplay: { show: false, status: 'unlocked' }
    });
    expect(d.variety).not.toBe('cycle-health');
    expect(d.promoteCycle).toBe(false);
  });

  it('no lock: defaults, governance overlay follows its own show flag', () => {
    const d = resolveLockScreen({
      activeChallenge: { type: 'cycle', cycleState: 'maintain', status: 'pending' },
      governanceDisplay: { show: false, status: 'unlocked' }
    });
    expect(d.variety).toBe('none');
    expect(d.showGovernanceOverlay).toBe(false);
    expect(d.promoteCycle).toBe(false);
    expect(d.audioTrack).toBeNull();
  });

  it('handles null/empty inputs without throwing', () => {
    const d = resolveLockScreen({});
    expect(d.variety).toBe('none');
    expect(d.showGovernanceOverlay).toBe(false);
    expect(d.showCycleOverlay).toBe(false);
    expect(d.promoteCycle).toBe(false);
    expect(d.audioTrack).toBeNull();
    expect(d.videoLocked).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Fitness/player/overlays/resolveLockScreen.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the resolver**

Create `frontend/src/modules/Fitness/player/overlays/resolveLockScreen.js`:

```js
/**
 * Single source of truth for which fitness lock UI is active and how it presents.
 * Pure — no React. Replaces the three independent booleans (cycle overlay visibility,
 * governance overlay visibility, audio host) that previously raced via the engine's
 * 200ms state cache + microtask render, producing blank/vanishing lock screens.
 *
 * @param {Object} args
 * @param {Object|null} args.activeChallenge - governanceState.challenge snapshot
 * @param {Object|null} args.governanceDisplay - result of useGovernanceDisplay
 * @returns {{
 *   variety: 'none'|'governance'|'cycle-health',
 *   showGovernanceOverlay: boolean,
 *   showCycleOverlay: boolean,
 *   promoteCycle: boolean,
 *   audioTrack: null|'init'|'locked',
 *   videoLocked: boolean
 * }}
 */
export function resolveLockScreen({ activeChallenge = null, governanceDisplay = null } = {}) {
  const isCycle = activeChallenge?.type === 'cycle';
  const isCycleHealthLock = isCycle
    && activeChallenge?.cycleState === 'locked'
    && activeChallenge?.lockReason === 'health';

  // Cycle health-lock wins outright: the cycle overlay becomes the promoted lock,
  // the generic governance panel is suppressed, lock music plays. This precedence
  // holds even if governance momentarily reports a non-unlocked status (the race
  // that previously produced a blank panel).
  if (isCycleHealthLock) {
    return {
      variety: 'cycle-health',
      showGovernanceOverlay: false,
      showCycleOverlay: true,
      promoteCycle: true,
      audioTrack: 'locked',
      videoLocked: true
    };
  }

  // Governance lock/pending/warning: defer to the existing governanceDisplay decision.
  if (governanceDisplay?.show) {
    return {
      variety: 'governance',
      showGovernanceOverlay: true,
      showCycleOverlay: false,
      promoteCycle: false,
      audioTrack: null, // GovernanceStateOverlay owns its own audio track selection
      videoLocked: Boolean(governanceDisplay?.videoLocked)
    };
  }

  // No lock screen active.
  return {
    variety: 'none',
    showGovernanceOverlay: false,
    showCycleOverlay: false,
    promoteCycle: false,
    audioTrack: null,
    videoLocked: Boolean(governanceDisplay?.videoLocked)
  };
}

export default resolveLockScreen;
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Fitness/player/overlays/resolveLockScreen.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/resolveLockScreen.js frontend/src/modules/Fitness/player/overlays/resolveLockScreen.test.js
git commit -m "feat(fitness): pure lock-screen-variety resolver (single source of truth)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task D2: Render from the descriptor + promote presentation (center/2x/dim)

**Files:**
- Modify: `frontend/src/modules/Fitness/player/FitnessPlayerOverlay.jsx`
- Create: `frontend/src/modules/Fitness/player/overlays/CycleLockScreen.scss`

**Context:** Today (`FitnessPlayerOverlay.jsx`):
- `isHealthLock` is computed at lines 196-198.
- `cycleOverlay` (199-209) uses the double-negative guard `!(cycleState==='locked' && !isHealthLock)`.
- `primaryOverlay` (211-216) renders `GovernanceStateOverlay` when `governanceDisplay?.show`.
- the deck wraps the visible challenge content (237-244); render output is the `<>...</>` at 246-283.

We replace the ad-hoc booleans with the resolver and add a promoted wrapper for cycle-health.

- [ ] **Step 1: Import the resolver + the new SCSS**

At the top of `FitnessPlayerOverlay.jsx`, add to the import group (near the other overlay imports):

```jsx
import { resolveLockScreen } from './overlays/resolveLockScreen.js';
import './overlays/CycleLockScreen.scss';
```

- [ ] **Step 2: Compute the descriptor**

After the line `const activeChallenge = governanceState?.challenge || null;` (line 72) and the `isCycleChallenge` line (73), add:

```jsx
  const lockScreen = resolveLockScreen({ activeChallenge, governanceDisplay });
```

- [ ] **Step 3: Drive overlay visibility from the descriptor**

Replace the `isHealthLock` + `cycleOverlay` block (lines ~196-209) with descriptor-driven logic. Remove:

```jsx
  const isHealthLock = isCycleChallenge
    && activeChallenge?.cycleState === 'locked'
    && activeChallenge?.lockReason === 'health';
  const cycleOverlay = isCycleChallenge
    && !(activeChallenge?.cycleState === 'locked' && !isHealthLock)
    && activeChallenge?.status !== 'success'
    && activeChallenge?.status !== 'failed'
    ? (
      <CycleChallengeOverlay
        challenge={activeChallenge}
        onRequestSwap={handleRequestSwap}
      />
    )
    : null;
```

Replace with:

```jsx
  // Cycle overlay shows for any active, non-terminal cycle challenge. When the
  // resolver promotes it (cycle health-lock), it renders as a centered, scaled,
  // dimmed lock screen instead of inside the deck (see promotedCycleLock below).
  const cycleOverlayActive = isCycleChallenge
    && activeChallenge?.status !== 'success'
    && activeChallenge?.status !== 'failed'
    && (activeChallenge?.cycleState !== 'locked' || lockScreen.variety === 'cycle-health');
  const cycleOverlayNode = cycleOverlayActive ? (
    <CycleChallengeOverlay
      challenge={activeChallenge}
      onRequestSwap={handleRequestSwap}
    />
  ) : null;
  // In-deck cycle overlay only when NOT promoted.
  const cycleOverlay = (cycleOverlayActive && !lockScreen.promoteCycle) ? cycleOverlayNode : null;
```

- [ ] **Step 4: Drive the governance overlay from the descriptor**

Replace the `primaryOverlay` definition (lines ~211-216):

```jsx
  const primaryOverlay = governanceDisplay?.show ? (
    <GovernanceStateOverlay
      voiceMemoOpen={voiceMemoOverlayOpen}
      display={governanceDisplay}
    />
  ) : null;
```

with:

```jsx
  const primaryOverlay = lockScreen.showGovernanceOverlay ? (
    <GovernanceStateOverlay
      voiceMemoOpen={voiceMemoOverlayOpen}
      display={governanceDisplay}
    />
  ) : null;
```

- [ ] **Step 5: Build the promoted cycle-lock node**

After the `primaryOverlay` definition, add the promoted wrapper (audio is added in Task D3):

```jsx
  // Promoted cycle health-lock: the cycle overlay becomes a centered, ~2x, dimmed
  // lock screen covering everything else. Single owner via resolveLockScreen.
  const promotedCycleLock = (lockScreen.promoteCycle && cycleOverlayNode) ? (
    <div className="cycle-lock-screen" role="dialog" aria-label="Cycle challenge locked">
      <div className="cycle-lock-screen__scrim" />
      <div className="cycle-lock-screen__stage">
        {cycleOverlayNode}
      </div>
    </div>
  ) : null;
```

- [ ] **Step 6: Include the promoted lock in render + `hasAnyOverlay`**

In the `hasAnyOverlay` boolean (lines ~218-227), add `promotedCycleLock` to the OR list:

```jsx
  const hasAnyOverlay = Boolean(
    primaryOverlay ||
    voiceMemoOverlayOpen ||
    challengeOverlay ||
    (!challengeOverlay && nextChallengeOverlay) ||
    cycleOverlay ||
    promotedCycleLock ||
    isSwapModalOpen ||
    showFullscreenVitals ||
    showCycleDemo
  );
```

In the returned JSX (the `<>...</>` starting ~246), add `{promotedCycleLock}` immediately after `{primaryOverlay}`:

```jsx
    <>
      {challengeDeck}
      {primaryOverlay}
      {promotedCycleLock}
      {showFullscreenVitals ? (
```

- [ ] **Step 7: Create the promoted lock SCSS**

Create `frontend/src/modules/Fitness/player/overlays/CycleLockScreen.scss`:

```scss
// Promoted cycle health-lock screen: full-viewport dim scrim with the
// CycleChallengeOverlay centered and scaled up ~2x. Sits above the challenge
// deck and governance overlays. Distinct from the generic governance lock.
.cycle-lock-screen {
  position: fixed;
  inset: 0;
  z-index: 2300; // above challenge deck / governance overlays / toast deck
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto; // block interaction behind it (real lock)

  &__scrim {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(2px);
  }

  &__stage {
    position: relative;
    transform: scale(2);
    transform-origin: center center;
    // The overlay's own transform-origin is top-left; center it within the stage.
    display: flex;
    align-items: center;
    justify-content: center;
  }
}
```

> Note: `CycleChallengeOverlay` root sets `transform: scale(var(--fitness-overlay-scale, 1)); transform-origin: top left;`. The `__stage` scale(2) multiplies the rendered size; centering is handled by the fl/flex stage. If the overlay drifts off-center on-device, the manual test (D5) will catch it and the fix is to set `--fitness-overlay-scale: 2` on the stage instead of `transform: scale(2)`.

- [ ] **Step 8: Verify the file parses + overlay suite**

Run: `cd /opt/Code/DaylightStation && npx esbuild frontend/src/modules/Fitness/player/FitnessPlayerOverlay.jsx --bundle=false --format=esm > /dev/null && echo PARSE_OK`
Expected: `PARSE_OK`.

Run: `cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Fitness/player/overlays`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/modules/Fitness/player/FitnessPlayerOverlay.jsx frontend/src/modules/Fitness/player/overlays/CycleLockScreen.scss
git commit -m "feat(fitness): promote cycle health-lock overlay to centered dimmed lock screen

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task D3: Lock-screen music on the cycle health-lock

**Files:**
- Modify: `frontend/src/modules/Fitness/player/FitnessPlayerOverlay.jsx`

**Context:** `GovernanceAudioPlayer` (`./overlays/GovernanceAudioPlayer.jsx`) plays a track by key (`'locked'` = `audio/sfx/bgmusic/fitness/locked`). Today it's only mounted inside `GovernanceStateOverlay`, which is suppressed on cycle health-lock — so no music plays. Mount it from the descriptor instead.

- [ ] **Step 1: Import GovernanceAudioPlayer**

At the top of `FitnessPlayerOverlay.jsx`, add:

```jsx
import GovernanceAudioPlayer from './overlays/GovernanceAudioPlayer.jsx';
```

- [ ] **Step 2: Mount the lock audio for the cycle-health variety**

Inside the `promotedCycleLock` JSX (from Task D2 Step 5), add the audio player so it mounts/unmounts with the promoted lock. Update the node to:

```jsx
  const promotedCycleLock = (lockScreen.promoteCycle && cycleOverlayNode) ? (
    <div className="cycle-lock-screen" role="dialog" aria-label="Cycle challenge locked">
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

(Track is `'locked'` for the cycle-health variety. Mounting/unmounting with `promotedCycleLock` gives the correct lifecycle: music starts when the lock appears and stops when the rider recovers and the overlay un-promotes.)

- [ ] **Step 3: Add a log line for observability**

Add an effect (near the other effects in the component, after the `lockScreen` const is in scope) so the next live occurrence is debuggable:

```jsx
  useEffect(() => {
    if (lockScreen.variety === 'cycle-health') {
      cycleLogger.info('health-lock-shown', {
        challengeId: activeChallenge?.id || null,
        audioTrack: lockScreen.audioTrack
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockScreen.variety]);
```

(`cycleLogger` already exists in this component, created via `getLogger().child({ component: 'fitness-player-overlay.cycle' })`.)

- [ ] **Step 4: Verify parse + suite**

Run: `cd /opt/Code/DaylightStation && npx esbuild frontend/src/modules/Fitness/player/FitnessPlayerOverlay.jsx --bundle=false --format=esm > /dev/null && echo PARSE_OK`
Expected: `PARSE_OK`.

Run: `cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Fitness/player/overlays`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/FitnessPlayerOverlay.jsx
git commit -m "feat(fitness): play lock music on cycle health-lock; add observability log

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task D4: Verify the real-lock invariant (pause arbiter re-pauses while videoLocked)

**Files:**
- Test: `frontend/src/modules/Player/utils/pauseArbiter.test.js` (create if missing; otherwise add a case)

**Context:** `resolvePause` in `pauseArbiter.js` returns a pause decision; governance lock is keyed off `governance.videoLocked`. The lock is "real" only if a play attempt while locked still resolves to paused. This pins that invariant so a future refactor can't quietly break it.

- [ ] **Step 1: Check whether a test file already exists**

Run: `cd /opt/Code/DaylightStation && ls frontend/src/modules/Player/utils/pauseArbiter.test.js 2>/dev/null && echo EXISTS || echo MISSING`

- [ ] **Step 2: Write the failing/invariant test**

If MISSING, create `frontend/src/modules/Player/utils/pauseArbiter.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { resolvePause, PAUSE_REASON } from './pauseArbiter.js';

describe('pauseArbiter — governance lock is a real lock', () => {
  it('resolves to paused (reason GOVERNANCE) while videoLocked, even if the user is trying to play', () => {
    const decision = resolvePause({
      seeking: { active: false },
      governance: { locked: true },
      resilience: { stalled: false, waitingToPlay: false },
      user: { paused: false } // user wants to play
    });
    expect(decision.paused).toBe(true);
    expect(decision.reason).toBe(PAUSE_REASON.GOVERNANCE);
  });

  it('does not pause for governance once the lock clears and the user wants to play', () => {
    const decision = resolvePause({
      seeking: { active: false },
      governance: { locked: false },
      resilience: { stalled: false, waitingToPlay: false },
      user: { paused: false }
    });
    expect(decision.reason).not.toBe(PAUSE_REASON.GOVERNANCE);
  });
});
```

If a test file already EXISTS, add only the two `it(...)` cases above into its existing top-level `describe` (adapt the import if `PAUSE_REASON`/`resolvePause` are imported differently — match the existing file's import style).

> The exact argument shape must match `resolvePause`'s real signature in `pauseArbiter.js` (the audit/earlier read confirmed `governance.videoLocked`/`governance.locked` is consulted via `governance.videoLocked ?? ...`). If the property is `videoLocked` rather than `locked`, use `governance: { videoLocked: true }` to match the source. **Before running, open `pauseArbiter.js` and use the exact property name it reads.**

- [ ] **Step 3: Run the test**

Run: `cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Player/utils/pauseArbiter.test.js`
Expected: PASS (the invariant already holds in code; this test pins it). If it FAILS, the property name is wrong — fix the test's `governance` shape to match the source, do not change `pauseArbiter.js`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Player/utils/pauseArbiter.test.js
git commit -m "test(fitness): pin governance-lock-is-real-lock invariant in pause arbiter

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task D5: MANUAL simulator test for the cycle health-lock (cannot be automated)

The cycle health-lock requires the live `GovernanceEngine` + a real video + RPM driven below `loRpm` to deplete health. This is **not automatable**; verify by hand. There are two complementary harnesses.

**Part 1 — Visual-only overlay check via `?cycle-demo` (verifies Task C + the promoted overlay's look in isolation):**

The `CycleChallengeDemo` (`frontend/src/modules/Fitness/widgets/CycleChallengeDemo/CycleChallengeDemo.jsx`) mounts when the fitness route has `?cycle-demo`. It renders `CycleChallengeOverlay` against hand-driven local state (decoupled from the engine), with controls for `cycleState`, `cycleHealthPct`, `boostMultiplier`, `boostingUsers`, `currentRpm`, etc.

- [ ] **Step 1: Build + deploy, then open the demo**

```bash
cd /opt/Code/DaylightStation
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```

Open `http://localhost:3111/fitness?cycle-demo` in a browser.

- [ ] **Step 2: Verify the C changes in the demo**
  - Set `boostMultiplier > 1`: the `×N.N` badge appears **floating below** the circle and does NOT shove the health meter / RPM readout upward (compare layout at multiplier 1 vs 2.5 — the bottom stack must not move).
  - Add `boostingUsers`: confirm **no** circular letter pips appear at the corners.
  - Set `cycleState = init` or `ramp`: confirm **no** "Start in Ns" / "Reach target in Ns" text appears.

**Part 2 — Real health-lock behavior (verifies Task D end-to-end):**

This needs a real cycle challenge with RPM driven below `loRpm` during `maintain` until
`cycleHealthMs` hits 0. The in-app simulator exposes a controller on `window`:
`window.__fitnessSimController` with `setRpm(equipmentId, rpm)`, `getEquipment()`,
`getDevices()`, `setHR(...)`, `listCycleSelections()`. The self-running demo
(`CycleChallengeDemo`, mounted via `?cycle-demo`) drives equipment id **`cycle_ace`** through
`init → ramp → maintain → locked → recover` using `ctl.setRpm('cycle_ace', rpm)` re-sent every
second (so cadence freshness doesn't decay). Use the same controller from the browser console
to reach a health-lock deterministically.

- [ ] **Step 3: Start a real fitness session with a cycle challenge**
  - Open the fitness app **without** `?cycle-demo` (you want the real overlay path, not the
    demo widget). Confirm `window.__fitnessSimController` exists in the console
    (`!!window.__fitnessSimController`). If it's absent in this build, fall back to the actual
    garage hardware ride on `niceday`, or use `?cycle-demo` to at least confirm the promoted
    lock visuals (the demo drives `cycle_ace` through `locked`).
  - Get HR going for ≥1 device so base reqs are satisfied:
    `const d = window.__fitnessSimController.getDevices().slice(0,1); d.forEach(x => window.__fitnessSimController.setHR(x.deviceId ?? x.id, 145));`
    (match the arg shape `setHR` expects in this build — inspect one device object first).
  - Trigger / wait for the cycle challenge, then hold RPM at/above `hiRpm` to pass
    `init → ramp → maintain`:
    `const sustain = setInterval(() => window.__fitnessSimController.setRpm('cycle_ace', 90), 1000);`
    Watch the overlay reach `maintain` with a full health meter. (Use the real equipment id
    from `window.__fitnessSimController.getEquipment()` if it's not `cycle_ace` in your config —
    the live bug was on `niceday`; drive whichever id the active cycle challenge uses.)

- [ ] **Step 4: Drive RPM below `loRpm` to deplete health and trigger the lock**
  - Stop the high-RPM sustain and hold RPM below `loRpm`:
    `clearInterval(sustain); const drop = setInterval(() => window.__fitnessSimController.setRpm('cycle_ace', 20), 1000);`
  - Watch the health meter deplete to empty. At empty, confirm ALL of:
    1. **Video pauses.**
    2. The **cycle overlay moves to center and scales up (~2×)** with a **dimmed background**
       hiding the rest of the UI — it does NOT vanish, and there is NO blank governance panel.
    3. The **lock-screen music plays** (the `locked` track), same as the governance lock.
    4. Pressing **play does NOT resume** the video (it re-pauses) — it's a real lock.

- [ ] **Step 5: Verify recovery**
  - Raise RPM back above `loRpm`:
    `clearInterval(drop); const recover = setInterval(() => window.__fitnessSimController.setRpm('cycle_ace', 90), 1000);`
  - Confirm: health refills / lock clears, the overlay **returns to its normal in-deck size**,
    the lock music **stops**, and the **video resumes**. Then `clearInterval(recover);`.

- [ ] **Step 6: Confirm via logs**

```bash
cd /opt/Code/DaylightStation
LATEST=$(sudo docker exec daylight-station sh -c 'ls -t media/logs/fitness/ | head -1')
sudo docker exec daylight-station sh -c "grep -iE 'health-lock-shown|cycle.locked|cycle.state_transition' media/logs/fitness/$LATEST | tail -20"
```

Expected: `governance.cycle.locked` with `lockReason:'health'`, and the new `health-lock-shown` log from the overlay (with `audioTrack:'locked'`). If `health-lock-shown` is absent when you saw the lock, the descriptor wiring (Task D2/D3) is not firing — investigate before declaring done.

- [ ] **Step 7: Record the manual result**

Append a short PASS/FAIL note (with the date and what was observed for each of D5 steps 4-5) to the audit file `docs/_wip/audits/2026-05-30-fitness-toast-and-cycle-lock-audit.md` under a new "## Manual verification (2026-05-30)" heading, and commit it:

```bash
git add docs/_wip/audits/2026-05-30-fitness-toast-and-cycle-lock-audit.md
git commit -m "docs(fitness): record manual cycle health-lock verification

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final integration check (after all tasks)

- [ ] **Run the full fitness overlay + player suites**

Run: `cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Fitness/player frontend/src/modules/Fitness/player/overlays frontend/src/modules/Player/utils`
Expected: all PASS.

- [ ] **Parse-check the two big touched files**

Run:
```bash
cd /opt/Code/DaylightStation
npx esbuild frontend/src/modules/Fitness/player/FitnessPlayerOverlay.jsx --bundle=false --format=esm > /dev/null && echo OVERLAY_OK
npx esbuild frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx --bundle=false --format=esm > /dev/null && echo CYCLE_OK
```
Expected: `OVERLAY_OK` and `CYCLE_OK`.

- [ ] **Deploy + manual sweep**

Build + deploy (commands in D5 Step 1), then:
- Trigger a rider assignment → toast bar drains left→right (A1), tapping it dismisses immediately (A2).
- Trigger a zone challenge → toast reads "Get N people to {zone}" / "N of N people reached {zone}" (B).
- Run the cycle simulator health-lock sequence (D5 Parts 1 & 2).

---

## Self-Review Notes

- **Spec coverage:** A1 (Task A1), A2 (Task A2), B (Task B), C1 (Task C1), C2 (Task C2), C3 (Task C3), D1 resolver (Task D1), D2 promote + render-from-descriptor + useGovernanceDisplay authority (Task D2 — note: no code change needed in `useGovernanceDisplay.js` because the resolver now gates `showGovernanceOverlay`; its existing `show:false` health-lock branch remains correct and is verified, not modified), D3 audio (Task D3), D4 real-lock (Task D4), D5 manual cycle test (Task D5). All spec sections mapped.
- **Type consistency:** `resolveLockScreen({ activeChallenge, governanceDisplay })` → `{ variety, showGovernanceOverlay, showCycleOverlay, promoteCycle, audioTrack, videoLocked }` used identically in D1 (defn/tests) and D2/D3 (consumer). `GovernanceAudioPlayer trackKey=...` matches its existing prop. `peopleWord` naming consistent across B.
- **Placeholder scan:** none — every code step shows full code. Two spots intentionally instruct the engineer to confirm a real value before running (C2 Step 3 unused-var grep; D4 `governance` prop name) rather than guessing — these are verification steps, not placeholders.
- **Known soft spot:** the promoted-lock exact scale/centering (D2 Step 7) and the audio ducking parity (D3) are visual/behavioral and only fully verifiable in D5's manual test — flagged in-line.
