# rAF Countdown Hook Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the 1s `setInterval` in `useDeadlineCountdown` with a `requestAnimationFrame` loop that only re-renders when a notch boundary is crossed, giving precise single-notch removal in the Mega Man life meter.

**Architecture:** The hook uses rAF to poll `Date.now()` vs `deadline` on every frame, computes `visibleNotches`, and only calls `setState` when the notch count changes. A `notchCount` parameter tells the hook how many discrete steps to gate on. Consumers that don't need notch-gating (sidebar `StripedProgressBar`) pass no `notchCount` and get 1s-granularity updates as before.

**Tech Stack:** React hooks, `requestAnimationFrame`/`cancelAnimationFrame`

---

### Task 1: Add notchCount parameter and rAF loop to useDeadlineCountdown

**Files:**
- Modify: `frontend/src/modules/Fitness/shared/hooks/useDeadlineCountdown.js`

**Context:** This hook is consumed in two places:
1. `GovernanceStateOverlay.jsx:327` — uses `remaining` (seconds), needs notch-gated updates
2. `FitnessGovernance.jsx:21` — uses `progress` (0-100), does NOT need notch-gating

The hook must remain backward-compatible: when `notchCount` is not passed, behavior stays the same (1s interval ticks).

**Step 1: Rewrite the hook**

Replace the entire contents of `useDeadlineCountdown.js` with:

```js
import { useState, useEffect, useRef } from 'react';

/**
 * Self-updating countdown hook that computes remaining seconds from a deadline timestamp.
 *
 * When notchCount is provided, uses requestAnimationFrame and only triggers re-renders
 * when the visible notch count changes — ideal for discrete step displays (life meters).
 *
 * When notchCount is omitted, uses a 1s setInterval for simple countdown displays.
 *
 * @param {number|null} deadline - Unix timestamp (ms) when countdown expires
 * @param {number} totalSeconds - Total duration for progress calculation (default: 30)
 * @param {number} [notchCount] - If provided, gate re-renders to notch boundary crossings
 * @returns {{ remaining: number|null, progress: number, isExpired: boolean }}
 */
const useDeadlineCountdown = (deadline, totalSeconds = 30, notchCount) => {
  const [remaining, setRemaining] = useState(() =>
    deadline ? Math.max(0, (deadline - Date.now()) / 1000) : null
  );
  const lastNotchRef = useRef(-1);

  useEffect(() => {
    if (!deadline) {
      setRemaining(null);
      lastNotchRef.current = -1;
      return;
    }

    // Notch-gated mode: use rAF, only setState on notch boundary change
    if (notchCount != null && notchCount > 0) {
      let rafId;
      const tick = () => {
        const secs = Math.max(0, (deadline - Date.now()) / 1000);
        const notches = Math.round((secs / totalSeconds) * notchCount);
        if (notches !== lastNotchRef.current) {
          lastNotchRef.current = notches;
          setRemaining(secs);
        }
        if (secs > 0) {
          rafId = requestAnimationFrame(tick);
        }
      };
      // Reset so first frame always triggers
      lastNotchRef.current = -1;
      rafId = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(rafId);
    }

    // Legacy mode: 1s interval for simple countdown displays
    const update = () => {
      const secs = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setRemaining(secs);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [deadline, totalSeconds, notchCount]);

  const progress = (remaining != null && totalSeconds > 0)
    ? Math.max(0, Math.min(100, (remaining / totalSeconds) * 100))
    : 0;

  const isExpired = remaining != null && remaining <= 0;

  return { remaining, progress, isExpired };
};

export default useDeadlineCountdown;
```

**Step 2: Verify no syntax errors**

Run: `node -e "require('fs').readFileSync('frontend/src/modules/Fitness/shared/hooks/useDeadlineCountdown.js','utf8')" && echo "OK"`
Expected: `OK`

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/shared/hooks/useDeadlineCountdown.js
git commit -m "refactor(fitness): add rAF notch-gated mode to useDeadlineCountdown"
```

---

### Task 2: Pass TOTAL_NOTCHES to the hook from GovernanceStateOverlay

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayerOverlay/GovernanceStateOverlay.jsx`

**Context:** `GovernanceStateOverlay` calls `useDeadlineCountdown` at line 327. It needs to pass `TOTAL_NOTCHES` (56) as the third argument so the hook uses rAF mode. The `GovernanceWarningOverlay` child already computes `visibleNotches` from `progress` — this stays the same.

**Step 1: Update the hook call**

In `GovernanceStateOverlay.jsx`, find the hook call at ~line 327:

```js
  const { remaining: countdown } = useDeadlineCountdown(
    useNewPath ? display.deadline : overlay?.deadline,
    useNewPath ? (display.gracePeriodTotal || 30) : (overlay?.countdownTotal || 30)
  );
```

Replace with:

```js
  const { remaining: countdown } = useDeadlineCountdown(
    useNewPath ? display.deadline : overlay?.deadline,
    useNewPath ? (display.gracePeriodTotal || 30) : (overlay?.countdownTotal || 30),
    TOTAL_NOTCHES
  );
```

**Step 2: Verify no syntax errors**

Run: `node -e "require('fs').readFileSync('frontend/src/modules/Fitness/FitnessPlayerOverlay/GovernanceStateOverlay.jsx','utf8')" && echo "OK"`
Expected: `OK`

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayerOverlay/GovernanceStateOverlay.jsx
git commit -m "feat(fitness): pass TOTAL_NOTCHES to useDeadlineCountdown for rAF gating"
```

---

### Task 3: Verify sidebar consumer is unaffected

**Files:**
- Read only: `frontend/src/modules/Fitness/FitnessSidebar/FitnessGovernance.jsx`

**Context:** `FitnessGovernance.jsx:21` calls `useDeadlineCountdown(deadline, totalSeconds)` with only 2 args. Since `notchCount` is `undefined`, the hook falls through to the legacy 1s interval path. No changes needed — just verify.

**Step 1: Confirm no third argument is passed**

Read `FitnessGovernance.jsx` lines 20-24 and verify the call is:
```js
const { progress: graceProgress } = useDeadlineCountdown(
  governanceState?.deadline,
  governanceState?.gracePeriodTotal || 30
);
```

No third arg = legacy mode. No action needed.

**Step 2: Commit (no-op, just verification)**

No commit needed for this task.
