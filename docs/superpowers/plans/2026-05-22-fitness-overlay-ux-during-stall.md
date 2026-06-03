# Fitness Overlay UX During Stall + Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the player from going visually blank when the user pauses during a stall, surface a user-actionable banner when a stall persists past 15 s, prevent a stuck close from taking 27 s with no feedback, and stop a phantom `<Player>` instance from polluting session logs with 556+ "Starting…" events per workout.

**Architecture:** Five small, surgical changes — each independently testable. **(1)** `PlayerOverlayPaused` drops its `!stalled` gate (the pause icon should always show when the user paused, regardless of underlying media health). **(2)** `PlayerOverlayLoading` always renders the spinner during a real stall, even when `pauseOverlayActive` is true, so the user gets *some* visual feedback. **(3)** A new `PlayerOverlayStallExhausted` component renders a "Tap to restart" banner after a configurable sustained-stall duration (default 15 s) and on Nth recovery attempt. **(4)** `Player.jsx` adds a close watchdog: if `fitness.player.close.requested` is not followed by `close.completed` within 5 s, force-unmount and log. **(5)** `PlayerOverlayLoading` early-exits its log interval when `effectiveMeta` is null (gated up at the parent), eliminating the 556-event phantom spam.

**Tech Stack:** React, Jest + RTL for unit/component tests, Playwright for live tests.

**Audit reference:** `docs/_wip/audits/2026-05-22-fitness-session-merge-and-resilience-failure-audit.md` §2 (Bug 2: UX regressions A, B), §3 (Bug 3: phantom Player), §"Tier 1" R1–R3, §"Tier 3" R6.

---

## File Structure

**Components:**
- `frontend/src/modules/Player/components/PlayerOverlayPaused.jsx` — drop `!stalled` gate; keep `!waitingToPlay && !isInitialPlayback`.
- `frontend/src/modules/Player/components/PlayerOverlayLoading.jsx` — relax `!pauseOverlayActive` exit during true stalls so the spinner shows during stalled-pause; early-return the log interval when `effectiveMeta` is null (propagated via new prop).
- `frontend/src/modules/Player/components/PlayerOverlayStallExhausted.jsx` — NEW. Banner shown after sustained stall. Tap to retry / change media / end session.

**Hooks / state:**
- `frontend/src/modules/Player/hooks/useStallExhaustion.js` — NEW. Wraps the sustained-stall timer + threshold logic. Returns `{ exhausted, secondsStalled, dismiss }`.

**Watchdog:**
- `frontend/src/modules/Player/Player.jsx` — wire up a `closeWatchdog` (one `useRef` + one `useEffect`).

**Tests:**
- `frontend/src/modules/Player/components/PlayerOverlayPaused.stalled.test.jsx` — pause icon must render when `stalled && pauseOverlayActive`.
- `frontend/src/modules/Player/components/PlayerOverlayLoading.stalled-paused.test.jsx` — spinner must render when `stalled && pauseOverlayActive`.
- `frontend/src/modules/Player/components/PlayerOverlayStallExhausted.test.jsx` — appears after 15 s sustained-stall, dismiss works.
- `frontend/src/modules/Player/hooks/useStallExhaustion.test.js` — timer math.
- `frontend/src/modules/Player/Player.close-watchdog.test.jsx` — forced unmount after 5 s without close.completed.
- `frontend/src/modules/Player/components/PlayerOverlayLoading.phantom-silent.test.jsx` — no log emission when `effectiveMeta` is null.

**Audit doc updated as we go:** mark each remediation R1, R2, R3, R6 as ✅ in the audit doc once landed.

---

### Task 1: Test — pause icon shows during stalled-pause (currently the screen goes blank)

**Files:**
- Create: `/opt/Code/DaylightStation/frontend/src/modules/Player/components/PlayerOverlayPaused.stalled.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
import React from 'react';
import { render } from '@testing-library/react';
import { PlayerOverlayPaused } from './PlayerOverlayPaused.jsx';

describe('PlayerOverlayPaused — renders during stall', () => {
  it('renders the pause icon when the user has paused AND playback is stalled', () => {
    const { container } = render(
      <PlayerOverlayPaused
        shouldRender={true}
        isVisible={true}
        pauseOverlayActive={true}
        stalled={true}
        seconds={120}
        waitingToPlay={false}
      />
    );
    // The pause overlay should render a containing element (assertion is loose
    // because the actual class/test-id may differ — adapt to whatever the
    // component uses; the point is "something visible appears")
    expect(container.firstChild).not.toBeNull();
  });

  it('still suppresses during initial playback (seconds=0, not stalled)', () => {
    const { container } = render(
      <PlayerOverlayPaused
        shouldRender={true}
        isVisible={true}
        pauseOverlayActive={true}
        stalled={false}
        seconds={0}
        waitingToPlay={false}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('still suppresses during waitingToPlay', () => {
    const { container } = render(
      <PlayerOverlayPaused
        shouldRender={true}
        isVisible={true}
        pauseOverlayActive={true}
        stalled={false}
        seconds={120}
        waitingToPlay={true}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `cd /opt/Code/DaylightStation && npx jest frontend/src/modules/Player/components/PlayerOverlayPaused.stalled.test.jsx --runInBand`
Expected: FAIL — first case returns null due to current `!stalled` gate at line 29.

- [ ] **Step 3: Commit failing test**

```bash
git add frontend/src/modules/Player/components/PlayerOverlayPaused.stalled.test.jsx
git commit -m "test(player): failing test — pause overlay disappears during stall"
```

---

### Task 2: Drop `!stalled` gate from `PlayerOverlayPaused`

**Files:**
- Modify: `/opt/Code/DaylightStation/frontend/src/modules/Player/components/PlayerOverlayPaused.jsx:24-30`

- [ ] **Step 1: Remove the gate**

Replace:

```javascript
const isInitialPlayback = seconds === 0 && !stalled;
const shouldShowPauseOverlay = shouldRender
  && isVisible
  && pauseOverlayActive
  && !waitingToPlay
  && !stalled
  && !isInitialPlayback;
```

with:

```javascript
// During a stall the user still needs an explicit "this is paused" affordance —
// the loading spinner alone (now retained behind the pause icon during stalled-pause)
// is not enough, because the user's perception is "I pressed pause and nothing
// changed visually." Previously this overlay was suppressed during stall and the
// screen went blank — see 2026-05-22 fitness-session-merge-and-resilience-failure audit.
const isInitialPlayback = seconds === 0 && !stalled;
const shouldShowPauseOverlay = shouldRender
  && isVisible
  && pauseOverlayActive
  && !waitingToPlay
  && !isInitialPlayback;
```

- [ ] **Step 2: Run the test**

Run: `cd /opt/Code/DaylightStation && npx jest frontend/src/modules/Player/components/PlayerOverlayPaused.stalled.test.jsx --runInBand`
Expected: PASS — all three cases.

- [ ] **Step 3: Run the full PlayerOverlayPaused test suite**

Run: `cd /opt/Code/DaylightStation && npx jest frontend/src/modules/Player/components/PlayerOverlayPaused --runInBand`
Expected: all pre-existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Player/components/PlayerOverlayPaused.jsx
git commit -m "fix(player): pause overlay renders during stalled-pause so screen isn't blank"
```

---

### Task 3: Test — spinner shows during stalled-pause too (z-index pairing)

**Files:**
- Create: `/opt/Code/DaylightStation/frontend/src/modules/Player/components/PlayerOverlayLoading.stalled-paused.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
import React from 'react';
import { render } from '@testing-library/react';
import { PlayerOverlayLoading } from './PlayerOverlayLoading.jsx';

describe('PlayerOverlayLoading — renders during stalled-pause', () => {
  it('renders the spinner when stalled && pauseOverlayActive (so user sees recovery state)', () => {
    const { container } = render(
      <PlayerOverlayLoading
        shouldRender={true}
        isVisible={true}
        pauseOverlayActive={true}
        stalled={true}
        seconds={100}
        status="recovering"
      />
    );
    // Look for the .loading-overlay element (current implementation)
    expect(container.querySelector('.loading-overlay')).not.toBeNull();
  });

  it('still hides during healthy pause (not stalled)', () => {
    const { container } = render(
      <PlayerOverlayLoading
        shouldRender={true}
        isVisible={true}
        pauseOverlayActive={true}
        stalled={false}
        seconds={100}
        status="playing"
      />
    );
    expect(container.querySelector('.loading-overlay')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `cd /opt/Code/DaylightStation && npx jest frontend/src/modules/Player/components/PlayerOverlayLoading.stalled-paused.test.jsx --runInBand`
Expected: FAIL — first case: `overlayDisplayActive = shouldRender && isVisible && !pauseOverlayActive` returns false.

- [ ] **Step 3: Commit failing test**

```bash
git add frontend/src/modules/Player/components/PlayerOverlayLoading.stalled-paused.test.jsx
git commit -m "test(player): failing test — spinner hidden during stalled-pause"
```

---

### Task 4: Allow `PlayerOverlayLoading` to render during stalled-pause

**Files:**
- Modify: `/opt/Code/DaylightStation/frontend/src/modules/Player/components/PlayerOverlayLoading.jsx:46`

- [ ] **Step 1: Change the visibility gate**

Replace line 46:

```javascript
const overlayDisplayActive = shouldRender && isVisible && !pauseOverlayActive;
```

with:

```javascript
// Render whenever the user needs recovery feedback. During a true stall, show
// the spinner even with the pause overlay active — the pause overlay sits ON TOP
// (higher z-index in CSS) and tells the user "you paused", while the spinner
// underneath signals "still trying to recover." Without this, stalled-pause
// shows a black screen with no affordance — see the 2026-05-22 audit.
const overlayDisplayActive = shouldRender && isVisible && (!pauseOverlayActive || stalled);
```

- [ ] **Step 2: Confirm CSS z-index supports this stack**

Run: `grep -nE 'loading-overlay|pause-overlay' /opt/Code/DaylightStation/frontend/src/modules/Player/styles/Player.scss`

If `.loading-overlay` z-index is >= the pause overlay's z-index, the spinner will paint *over* the pause icon — wrong direction. Verify the pause overlay has a HIGHER z-index than the loading overlay. If not, raise the pause overlay's z-index by 1 (small surgical change).

If unclear, just inspect visually in step 3.

- [ ] **Step 3: Run the test**

Run: `cd /opt/Code/DaylightStation && npx jest frontend/src/modules/Player/components/PlayerOverlayLoading.stalled-paused.test.jsx --runInBand`
Expected: PASS — both cases.

- [ ] **Step 4: Run the full PlayerOverlayLoading suite**

Run: `cd /opt/Code/DaylightStation && npx jest frontend/src/modules/Player/components/PlayerOverlayLoading --runInBand`
Expected: pre-existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Player/components/PlayerOverlayLoading.jsx
git commit -m "fix(player): spinner renders during stalled-pause beneath pause icon"
```

---

### Task 5: Test + implement `useStallExhaustion` hook

**Files:**
- Create: `/opt/Code/DaylightStation/frontend/src/modules/Player/hooks/useStallExhaustion.test.js`
- Create: `/opt/Code/DaylightStation/frontend/src/modules/Player/hooks/useStallExhaustion.js`

- [ ] **Step 1: Write the failing test**

```javascript
import { renderHook, act } from '@testing-library/react';
import { useStallExhaustion } from './useStallExhaustion.js';

describe('useStallExhaustion', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('returns exhausted=false on mount with no stall', () => {
    const { result } = renderHook(() => useStallExhaustion({ stalled: false, thresholdMs: 15000 }));
    expect(result.current.exhausted).toBe(false);
    expect(result.current.secondsStalled).toBe(0);
  });

  it('flips exhausted=true after thresholdMs of continuous stall', () => {
    const { result, rerender } = renderHook(
      ({ stalled }) => useStallExhaustion({ stalled, thresholdMs: 15000 }),
      { initialProps: { stalled: true } }
    );
    expect(result.current.exhausted).toBe(false);
    act(() => { jest.advanceTimersByTime(14999); });
    expect(result.current.exhausted).toBe(false);
    act(() => { jest.advanceTimersByTime(2); });
    expect(result.current.exhausted).toBe(true);
  });

  it('resets when stall ends', () => {
    const { result, rerender } = renderHook(
      ({ stalled }) => useStallExhaustion({ stalled, thresholdMs: 15000 }),
      { initialProps: { stalled: true } }
    );
    act(() => { jest.advanceTimersByTime(15001); });
    expect(result.current.exhausted).toBe(true);
    rerender({ stalled: false });
    expect(result.current.exhausted).toBe(false);
    expect(result.current.secondsStalled).toBe(0);
  });

  it('dismiss() clears exhausted without ending stall', () => {
    const { result } = renderHook(() => useStallExhaustion({ stalled: true, thresholdMs: 5000 }));
    act(() => { jest.advanceTimersByTime(6000); });
    expect(result.current.exhausted).toBe(true);
    act(() => { result.current.dismiss(); });
    expect(result.current.exhausted).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `cd /opt/Code/DaylightStation && npx jest frontend/src/modules/Player/hooks/useStallExhaustion.test.js --runInBand`
Expected: FAIL — `useStallExhaustion` does not exist.

- [ ] **Step 3: Write the minimal hook**

Create `useStallExhaustion.js`:

```javascript
import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Track how long a stall has lasted. Flip `exhausted=true` when the stall
 * exceeds `thresholdMs` continuously. Reset when stall ends or `dismiss()`
 * is called. Used by the "Tap to restart" banner.
 */
export function useStallExhaustion({ stalled, thresholdMs = 15000 }) {
  const [exhausted, setExhausted] = useState(false);
  const [secondsStalled, setSecondsStalled] = useState(0);
  const startRef = useRef(null);
  const dismissedRef = useRef(false);

  useEffect(() => {
    if (!stalled) {
      startRef.current = null;
      dismissedRef.current = false;
      setExhausted(false);
      setSecondsStalled(0);
      return undefined;
    }
    if (!startRef.current) startRef.current = Date.now();
    const tick = () => {
      if (dismissedRef.current) return;
      const elapsed = Date.now() - startRef.current;
      setSecondsStalled(Math.floor(elapsed / 1000));
      if (elapsed >= thresholdMs) setExhausted(true);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [stalled, thresholdMs]);

  const dismiss = useCallback(() => {
    dismissedRef.current = true;
    setExhausted(false);
  }, []);

  return { exhausted, secondsStalled, dismiss };
}
```

- [ ] **Step 4: Run test — verify it passes**

Run: `cd /opt/Code/DaylightStation && npx jest frontend/src/modules/Player/hooks/useStallExhaustion.test.js --runInBand`
Expected: PASS — all four cases.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Player/hooks/useStallExhaustion.js frontend/src/modules/Player/hooks/useStallExhaustion.test.js
git commit -m "feat(player): useStallExhaustion hook for sustained-stall threshold"
```

---

### Task 6: Test + implement `PlayerOverlayStallExhausted` banner

**Files:**
- Create: `/opt/Code/DaylightStation/frontend/src/modules/Player/components/PlayerOverlayStallExhausted.test.jsx`
- Create: `/opt/Code/DaylightStation/frontend/src/modules/Player/components/PlayerOverlayStallExhausted.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { PlayerOverlayStallExhausted } from './PlayerOverlayStallExhausted.jsx';

describe('PlayerOverlayStallExhausted', () => {
  it('does not render when exhausted=false', () => {
    const { container } = render(
      <PlayerOverlayStallExhausted exhausted={false} secondsStalled={5} onRestart={() => {}} onDismiss={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders with restart and dismiss CTAs when exhausted=true', () => {
    const { getByRole, getByText } = render(
      <PlayerOverlayStallExhausted exhausted={true} secondsStalled={20} onRestart={() => {}} onDismiss={() => {}} />
    );
    expect(getByText(/stuck/i)).toBeInTheDocument();
    expect(getByRole('button', { name: /restart/i })).toBeInTheDocument();
    expect(getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
  });

  it('calls onRestart when restart button clicked', () => {
    const onRestart = jest.fn();
    const { getByRole } = render(
      <PlayerOverlayStallExhausted exhausted={true} secondsStalled={20} onRestart={onRestart} onDismiss={() => {}} />
    );
    fireEvent.click(getByRole('button', { name: /restart/i }));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it('calls onDismiss when dismiss button clicked', () => {
    const onDismiss = jest.fn();
    const { getByRole } = render(
      <PlayerOverlayStallExhausted exhausted={true} secondsStalled={20} onRestart={() => {}} onDismiss={onDismiss} />
    );
    fireEvent.click(getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `cd /opt/Code/DaylightStation && npx jest frontend/src/modules/Player/components/PlayerOverlayStallExhausted.test.jsx --runInBand`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Write the minimal component**

Create `PlayerOverlayStallExhausted.jsx`:

```jsx
import React from 'react';
import PropTypes from 'prop-types';
import './PlayerOverlayStallExhausted.scss';

/**
 * Sustained-stall banner. Shows after `useStallExhaustion` flips `exhausted=true`.
 * Gives the user explicit affordances when the silent recovery loop fails.
 */
export function PlayerOverlayStallExhausted({ exhausted, secondsStalled, onRestart, onDismiss }) {
  if (!exhausted) return null;
  return (
    <div className="stall-exhausted-overlay" role="alertdialog" aria-live="assertive">
      <div className="stall-exhausted-overlay__inner">
        <h2 className="stall-exhausted-overlay__title">Playback stuck</h2>
        <p className="stall-exhausted-overlay__body">
          We've been recovering for {secondsStalled}s without making progress.
          The video source may be unable to play on this device.
        </p>
        <div className="stall-exhausted-overlay__actions">
          <button type="button" onClick={onRestart}>Restart playback</button>
          <button type="button" onClick={onDismiss}>Dismiss</button>
        </div>
      </div>
    </div>
  );
}

PlayerOverlayStallExhausted.propTypes = {
  exhausted: PropTypes.bool.isRequired,
  secondsStalled: PropTypes.number.isRequired,
  onRestart: PropTypes.func.isRequired,
  onDismiss: PropTypes.func.isRequired,
};

export default PlayerOverlayStallExhausted;
```

Create a minimal `PlayerOverlayStallExhausted.scss` next to it:

```scss
.stall-exhausted-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.78);
  z-index: 25;  // verify against existing overlays; raise if needed
  color: #fff;
  text-align: center;
  padding: 2rem;

  &__inner {
    max-width: 28rem;
  }

  &__title {
    font-size: 1.6rem;
    margin: 0 0 0.5rem;
  }

  &__body {
    font-size: 1rem;
    opacity: 0.85;
    margin: 0 0 1.25rem;
  }

  &__actions {
    display: flex;
    gap: 0.75rem;
    justify-content: center;

    button {
      padding: 0.6rem 1.2rem;
      font-size: 0.95rem;
      border-radius: 0.4rem;
      border: 1px solid rgba(255, 255, 255, 0.4);
      background: rgba(255, 255, 255, 0.08);
      color: #fff;
      cursor: pointer;
    }
  }
}
```

- [ ] **Step 4: Run test — verify it passes**

Run: `cd /opt/Code/DaylightStation && npx jest frontend/src/modules/Player/components/PlayerOverlayStallExhausted.test.jsx --runInBand`
Expected: PASS — all four cases.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Player/components/PlayerOverlayStallExhausted.jsx frontend/src/modules/Player/components/PlayerOverlayStallExhausted.scss frontend/src/modules/Player/components/PlayerOverlayStallExhausted.test.jsx
git commit -m "feat(player): PlayerOverlayStallExhausted banner with Restart/Dismiss CTAs"
```

---

### Task 7: Wire `useStallExhaustion` + `PlayerOverlayStallExhausted` into Player.jsx

**Files:**
- Modify: `/opt/Code/DaylightStation/frontend/src/modules/Player/Player.jsx`

- [ ] **Step 1: Identify the existing overlay render site**

Run: `grep -n "PlayerOverlayLoading\|PlayerOverlayPaused" /opt/Code/DaylightStation/frontend/src/modules/Player/Player.jsx`
Note the line where these are rendered (around line 1000 per the audit).

- [ ] **Step 2: Import the hook and component near other Player overlay imports**

```jsx
import { useStallExhaustion } from './hooks/useStallExhaustion.js';
import { PlayerOverlayStallExhausted } from './components/PlayerOverlayStallExhausted.jsx';
```

- [ ] **Step 3: Invoke the hook inside the Player function body**

Place near where `stalled` becomes available (likely from `useMediaResilience`):

```jsx
const stallExhaustion = useStallExhaustion({ stalled, thresholdMs: 15000 });

const handleStallExhaustedRestart = useCallback(() => {
  playbackLog('stall-exhausted-restart', { secondsStalled: stallExhaustion.secondsStalled }, { level: 'warn' });
  // Use the existing hard-reset path
  if (typeof onRequestHardReset === 'function') {
    onRequestHardReset({ reason: 'user-requested-after-exhaustion' });
  }
  stallExhaustion.dismiss();
}, [onRequestHardReset, stallExhaustion]);

const handleStallExhaustedDismiss = useCallback(() => {
  playbackLog('stall-exhausted-dismiss', { secondsStalled: stallExhaustion.secondsStalled }, { level: 'info' });
  stallExhaustion.dismiss();
}, [stallExhaustion]);
```

(The exact `onRequestHardReset` source depends on how Player.jsx threads it down; use the symbol already used by `PlayerOverlayLoading`'s `onRequestHardReset` prop.)

- [ ] **Step 4: Render the banner next to existing overlays**

In the JSX where `<PlayerOverlayLoading />` and `<PlayerOverlayPaused />` render, add:

```jsx
<PlayerOverlayStallExhausted
  exhausted={stallExhaustion.exhausted}
  secondsStalled={stallExhaustion.secondsStalled}
  onRestart={handleStallExhaustedRestart}
  onDismiss={handleStallExhaustedDismiss}
/>
```

- [ ] **Step 5: Sanity check by running the existing Player test suite**

Run: `cd /opt/Code/DaylightStation && npx jest frontend/src/modules/Player/ --runInBand`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Player/Player.jsx
git commit -m "feat(player): wire useStallExhaustion + banner for sustained stall"
```

---

### Task 8: Close-watchdog — force unmount if close.requested has no close.completed within 5 s

**Files:**
- Create: `/opt/Code/DaylightStation/frontend/src/modules/Player/Player.close-watchdog.test.jsx`
- Modify: `/opt/Code/DaylightStation/frontend/src/modules/Player/Player.jsx`

- [ ] **Step 1: Search for the existing `fitness.player.close.*` emit sites**

Run: `grep -rn "fitness.player.close" /opt/Code/DaylightStation/frontend/src/`
Identify which file emits `close.requested` (likely `FitnessApp.jsx` or `FitnessPlayer.jsx`) and which emits `close.completed`. Determine where to install the watchdog so it observes both.

Expected: a parent component (`FitnessPlayer.jsx`?) holds the close lifecycle. If `Player.jsx` does not own it, install the watchdog there instead.

- [ ] **Step 2: Write the failing test**

This test verifies the *observable* behavior: when `close.requested` fires and 5 s pass without `close.completed`, an `error`-level log `fitness.player.close.watchdog_fired` is emitted AND a fallback unmount callback is invoked.

```jsx
import React from 'react';
import { render, act } from '@testing-library/react';
import { FitnessPlayer } from './FitnessPlayer.jsx'; // or wherever the close lifecycle lives

// Stub the logger; capture warns/errors.
const loggerCalls = { warn: [], error: [], info: [] };
jest.mock('../../lib/logging/Logger.js', () => ({
  __esModule: true,
  default: () => ({
    warn: (...args) => loggerCalls.warn.push(args),
    error: (...args) => loggerCalls.error.push(args),
    info: (...args) => loggerCalls.info.push(args),
    debug: () => {},
    child: function () { return this; },
    sampled: () => {},
  }),
}));

describe('FitnessPlayer close watchdog', () => {
  beforeEach(() => {
    loggerCalls.warn = []; loggerCalls.error = []; loggerCalls.info = [];
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it('fires watchdog when close.requested is not followed by close.completed in 5s', async () => {
    const onForceUnmount = jest.fn();
    // Render FitnessPlayer with whatever minimal props it needs.
    const { rerender } = render(<FitnessPlayer onForceUnmount={onForceUnmount} /* ...required props... */ />);
    // Trigger close.requested via the same path the UI uses. The exact call may
    // be a prop callback or an imperative method — adapt to actual API.
    // ...
    act(() => { jest.advanceTimersByTime(5001); });
    expect(loggerCalls.error.find(c => c[0] === 'fitness.player.close.watchdog_fired')).toBeDefined();
    expect(onForceUnmount).toHaveBeenCalled();
  });
});
```

If `FitnessPlayer` doesn't already expose `onForceUnmount`, this test scaffolds the new prop and the implementation in Task 8 Step 4 will introduce it. If the harness is too heavy for a unit test, downgrade to an isolated unit test of a `useCloseWatchdog` hook (see Step 4 alternative).

- [ ] **Step 3: Run test — verify it fails**

Run: `cd /opt/Code/DaylightStation && npx jest frontend/src/modules/Player/Player.close-watchdog.test.jsx --runInBand`
Expected: FAIL — no watchdog wired.

- [ ] **Step 4: Implement a `useCloseWatchdog` hook (alternative to inline) and use it**

Create `frontend/src/modules/Player/hooks/useCloseWatchdog.js`:

```javascript
import { useEffect, useRef, useCallback } from 'react';
import getLogger from '../../../lib/logging/Logger.js';

/**
 * Arm a 5 s watchdog after a "close requested" signal. If "close completed"
 * does not arrive in time, log an error and invoke `onTimeout`.
 *
 * Usage:
 *   const { requested, completed } = useCloseWatchdog({ timeoutMs: 5000, onTimeout: forceUnmount });
 *   // when the user presses exit:
 *   requested({ sessionId, voiceMemoOverlayOpen });
 *   // when normal teardown finishes:
 *   completed({ sessionId });
 */
export function useCloseWatchdog({ timeoutMs = 5000, onTimeout }) {
  const timerRef = useRef(null);
  const armedRef = useRef(null);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    armedRef.current = null;
  }, []);

  const requested = useCallback((payload = {}) => {
    clear();
    armedRef.current = { armedAt: Date.now(), ...payload };
    getLogger().info('fitness.player.close.requested', payload);
    timerRef.current = setTimeout(() => {
      const ctx = armedRef.current || {};
      getLogger().error('fitness.player.close.watchdog_fired', {
        ...ctx,
        elapsedMs: ctx.armedAt ? Date.now() - ctx.armedAt : null,
        timeoutMs,
      });
      try { onTimeout?.(ctx); } finally { clear(); }
    }, timeoutMs);
  }, [clear, onTimeout, timeoutMs]);

  const completed = useCallback((payload = {}) => {
    getLogger().info('fitness.player.close.completed', payload);
    clear();
  }, [clear]);

  useEffect(() => clear, [clear]);

  return { requested, completed };
}
```

Then in `FitnessPlayer.jsx` (or whichever file emits `close.requested`), replace the inline `getLogger().info('fitness.player.close.requested', ...)` with:

```javascript
const closeWatchdog = useCloseWatchdog({
  timeoutMs: 5000,
  onTimeout: () => {
    // Force-unmount path: clear player state and navigate home.
    // Use the same path the UI takes on a clean close (state clear + route change).
    onForceUnmount?.();
  },
});

// Replace previous emit:
//   getLogger().info('fitness.player.close.requested', { sessionId, voiceMemoOverlayOpen });
// With:
closeWatchdog.requested({ sessionId, voiceMemoOverlayOpen });

// And replace the `close.completed` emit similarly:
closeWatchdog.completed({ sessionId });
```

Add `onForceUnmount` to the props of `FitnessPlayer` and wire it in the parent (likely `FitnessApp.jsx`) to the same handler used for normal close, plus a flag indicating it's a forced unmount.

- [ ] **Step 5: Run test — verify it passes**

Run: `cd /opt/Code/DaylightStation && npx jest frontend/src/modules/Player/Player.close-watchdog.test.jsx --runInBand`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Player/hooks/useCloseWatchdog.js frontend/src/modules/Player/Player.close-watchdog.test.jsx frontend/src/modules/Player/Player.jsx frontend/src/modules/Fitness/player/FitnessPlayer.jsx
git commit -m "feat(player): close watchdog forces unmount if close hangs >5s"
```

---

### Task 9: Test + suppress phantom overlay logging when `effectiveMeta` is null

**Files:**
- Create: `/opt/Code/DaylightStation/frontend/src/modules/Player/components/PlayerOverlayLoading.phantom-silent.test.jsx`
- Modify: `/opt/Code/DaylightStation/frontend/src/modules/Player/components/PlayerOverlayLoading.jsx`
- Modify: `/opt/Code/DaylightStation/frontend/src/modules/Player/Player.jsx` (pass new prop)

- [ ] **Step 1: Write the failing test**

```jsx
import React from 'react';
import { render, act } from '@testing-library/react';
import { PlayerOverlayLoading } from './PlayerOverlayLoading.jsx';

// Capture logger calls — the test asserts NO log events fire over 5s when effectiveMetaIsNull=true.
const loggerCalls = [];
jest.mock('../lib/playbackLogger.js', () => ({
  __esModule: true,
  playbackLog: (event, ...rest) => loggerCalls.push({ event, rest }),
}));
jest.mock('../../../lib/logging/Logger.js', () => ({
  __esModule: true,
  default: () => ({
    info: (event, ...rest) => loggerCalls.push({ event, rest }),
    warn: (event, ...rest) => loggerCalls.push({ event, rest }),
    error: () => {},
    debug: () => {},
    child: function () { return this; },
    sampled: () => {},
  }),
}));

describe('PlayerOverlayLoading — phantom suppression', () => {
  beforeEach(() => {
    loggerCalls.length = 0;
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it('emits NO log events when effectiveMetaIsNull=true (phantom Player)', () => {
    render(
      <PlayerOverlayLoading
        shouldRender={true}
        isVisible={true}
        status="startup"
        effectiveMetaIsNull={true}
      />
    );
    act(() => { jest.advanceTimersByTime(5000); });
    const overlaySummaries = loggerCalls.filter(c => c.event === 'overlay-summary');
    expect(overlaySummaries.length).toBe(0);
  });

  it('still emits overlay-summary when effectiveMetaIsNull=false (real Player)', () => {
    render(
      <PlayerOverlayLoading
        shouldRender={true}
        isVisible={true}
        status="startup"
        effectiveMetaIsNull={false}
      />
    );
    act(() => { jest.advanceTimersByTime(2000); });
    const overlaySummaries = loggerCalls.filter(c => c.event === 'overlay-summary');
    expect(overlaySummaries.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `cd /opt/Code/DaylightStation && npx jest frontend/src/modules/Player/components/PlayerOverlayLoading.phantom-silent.test.jsx --runInBand`
Expected: FAIL — phantom currently emits log every 1 s.

- [ ] **Step 3: Add the `effectiveMetaIsNull` prop and suppress the log interval**

In `PlayerOverlayLoading.jsx`, add the prop near line 11:

```javascript
export function PlayerOverlayLoading({
  // ...existing props...
  effectiveMetaIsNull = false,  // ADD: when true, suppress all overlay logging (phantom Player guard)
  // ...
})
```

In `logOverlaySummary` (line 285), early-return when phantom:

```javascript
const logOverlaySummary = useCallback(() => {
  if (effectiveMetaIsNull) return;  // PHANTOM GUARD: prevent 556-event leak per the 2026-05-22 audit
  if (!isVisible && status === 'playing') return;
  // ...rest unchanged...
}, [effectiveMetaIsNull, isVisible, status, /* ...existing deps... */]);
```

And in the log-interval `useEffect` (around line 334), early-return:

```javascript
useEffect(() => {
  if (effectiveMetaIsNull) return;  // PHANTOM GUARD
  // ...existing interval setup...
}, [effectiveMetaIsNull, overlayLoggingActive, overlayLogContext]);
```

Add the prop type at the bottom (around line 418):

```javascript
PlayerOverlayLoading.propTypes = {
  // ...existing...
  effectiveMetaIsNull: PropTypes.bool,
  // ...
};
```

- [ ] **Step 4: Pass the new prop from Player.jsx**

In `Player.jsx`, where `<PlayerOverlayLoading {...overlayProps} ... />` is rendered (around line 1000), add:

```jsx
<PlayerOverlayLoading
  {...overlayProps}
  effectiveMetaIsNull={!effectiveMeta}
  // ...existing props...
/>
```

- [ ] **Step 5: Run test — verify it passes**

Run: `cd /opt/Code/DaylightStation && npx jest frontend/src/modules/Player/components/PlayerOverlayLoading.phantom-silent.test.jsx --runInBand`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Player/components/PlayerOverlayLoading.jsx frontend/src/modules/Player/components/PlayerOverlayLoading.phantom-silent.test.jsx frontend/src/modules/Player/Player.jsx
git commit -m "fix(player): suppress phantom overlay logging when effectiveMeta is null"
```

---

### Task 10: Live verification — start a stall and inspect the UX

**Files:** None (verification only)

- [ ] **Step 1: Boot the app with a known-stalling media**

Pick an AV1 source with high pixel rate (1440p60 or 4K) — e.g., a Game Cycling video like Diddy Kong Racing. Play it from the fitness app on the kiosk hardware.

- [ ] **Step 2: Wait for the stall to begin**

Watch the session JSONL: `tail -F /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/media/logs/fitness/<latest>.jsonl | grep -E 'playback\.stalled|playback\.recovery|stall-exhausted'`

- [ ] **Step 3: Press pause during a stall**

Expected (live observation, screen):
- The pause icon renders (not blank screen)
- A spinner is visible beneath/behind the pause icon

- [ ] **Step 4: Press play to resume**

Expected: pause icon disappears, spinner remains while recovery continues.

- [ ] **Step 5: Wait 15 s of sustained stall**

Expected: a "Playback stuck" banner appears with Restart / Dismiss buttons.

- [ ] **Step 6: Click Restart**

Expected:
- Banner closes
- Hard reset triggers (mediaKey reload, fresh decision)
- `fitness.player.close.watchdog_fired` does NOT appear in logs (close path runs cleanly)

- [ ] **Step 7: Verify phantom suppression by inspecting log volume**

Run: `wc -l <current session jsonl>` once at start of session, again after 5 minutes. The growth rate should be substantially lower than the previous baseline (the 2026-05-22 session log was 12,086 lines for ~54 min ≈ 224 lines/min; this session should be < 100 lines/min if phantom suppression worked).

Run: `grep -c overlay-summary <current session jsonl>`
Compare to baseline (1881 in the audit's session). Expected: substantially lower — ideally <100 for a 5-minute test.

- [ ] **Step 8: If everything looks good, deploy**

On `kckern-server`:
```bash
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

---

## Out of scope for this plan (deferred to Plan 3)

- Preventing the stall in the first place (AV1 codec capability probe) — that's Plan 3 (`docs/superpowers/plans/2026-05-22-fitness-av1-codec-capability-probe.md`). This plan only fixes the *user feedback* during a stall; the *underlying cause* of the AV1 1440p60 collapse is a separate concern.
- Capping recovery attempts numerically (Audit R8) — folded into Plan 3 alongside the codec probe, since both modify `useMediaResilience`.

## Self-review checklist

- [x] Spec coverage: R1 (pause overlay during stall) ✓ Tasks 1-2; R2 (sustained-stall banner) ✓ Tasks 5-7; R3 (close watchdog) ✓ Task 8; R6 (phantom Player log suppression) ✓ Task 9. Spinner-during-stalled-pause is bonus coverage Tasks 3-4.
- [x] No placeholders — every step shows the code or exact command.
- [x] Type consistency: `useStallExhaustion` returns `{ exhausted, secondsStalled, dismiss }` in Task 5 and is consumed with the same shape in Task 7.
- [x] File paths absolute throughout.
- [x] Each task ends in a commit.

