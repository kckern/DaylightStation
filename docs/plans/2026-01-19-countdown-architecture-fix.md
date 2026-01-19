# Countdown Architecture Fix

**Date:** 2026-01-19
**Status:** Ready for implementation
**Problem:** 1-second heartbeat in FitnessContext forces 60 re-renders/min globally just to update countdown displays

## Root Cause

Components read `governanceState.countdownSecondsRemaining` (a computed value) from context. For the countdown to tick, the entire context tree must re-render. The 1-second heartbeat was added as a workaround.

## Solution

Pass the raw `deadline` timestamp instead. Let components manage their own update intervals only when they have an active countdown.

## Implementation Steps

### Step 1: Add deadline to GovernanceEngine state

**File:** `frontend/src/hooks/fitness/GovernanceEngine.js`

In `_composeState()` (~line 776), add `deadline` to the returned object:

```javascript
return {
  // ... existing fields
  deadline: this.meta?.deadline || null,  // ADD THIS
  // ...
};
```

### Step 2: Remove countdown cache update optimization

**File:** `frontend/src/hooks/fitness/GovernanceEngine.js`

In `_getCachedState()` (lines 651-658), remove the in-place countdown update block. This optimization is no longer needed since components will compute remaining time themselves.

```javascript
// DELETE this block (lines 651-658):
if (this._stateCache.countdownSecondsRemaining != null && this.meta?.deadline) {
  const remaining = Math.max(0, Math.round((this.meta.deadline - now) / 1000));
  if (remaining !== this._stateCache.countdownSecondsRemaining) {
    this._stateCache = { ...this._stateCache, countdownSecondsRemaining: remaining };
  }
}
```

### Step 3: Create useCountdown hook

**File:** `frontend/src/modules/Fitness/shared/hooks/useCountdown.js` (new file)

```javascript
import { useState, useEffect } from 'react';

/**
 * Self-updating countdown hook that computes remaining seconds from a deadline.
 * Only runs an interval when deadline is active.
 *
 * @param {number|null} deadline - Unix timestamp (ms) when countdown expires
 * @param {number} totalSeconds - Total duration for progress calculation
 * @returns {{ remaining: number|null, progress: number }}
 */
export const useCountdown = (deadline, totalSeconds = 30) => {
  const [remaining, setRemaining] = useState(() =>
    deadline ? Math.max(0, Math.round((deadline - Date.now()) / 1000)) : null
  );

  useEffect(() => {
    if (!deadline) {
      setRemaining(null);
      return;
    }

    const update = () => {
      const secs = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setRemaining(secs);
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [deadline]);

  const progress = (remaining != null && totalSeconds > 0)
    ? Math.max(0, Math.min(100, (remaining / totalSeconds) * 100))
    : 0;

  return { remaining, progress };
};

export default useCountdown;
```

### Step 4: Update FitnessGovernance.jsx

**File:** `frontend/src/modules/Fitness/FitnessSidebar/FitnessGovernance.jsx`

1. Import the hook:
```javascript
import { useCountdown } from '../shared/hooks/useCountdown';
```

2. Replace the useMemo countdown calculation with the hook:
```javascript
const { progress: graceProgress } = useCountdown(
  governanceState.deadline,
  governanceState.gracePeriodTotal || 30
);
```

3. Update the summary useMemo to remove graceProgress calculation (it's now from the hook).

### Step 5: Update FitnessPlayerOverlay.jsx

**File:** `frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx`

1. Import the hook:
```javascript
import { useCountdown } from './shared/hooks/useCountdown';
```

2. Use the hook for countdown display:
```javascript
const { remaining: countdown } = useCountdown(
  governanceState.deadline,
  governanceState.gracePeriodTotal || 30
);
```

3. Update the warning status section to use `countdown` from the hook instead of `governanceState.countdownSecondsRemaining`.

### Step 6: Remove the heartbeat

**File:** `frontend/src/context/FitnessContext.jsx`

Delete the 1-second heartbeat useEffect (lines 885-890):

```javascript
// DELETE THIS ENTIRE BLOCK:
useEffect(() => {
  if (!sessionId) return;
  const interval = setInterval(() => {
    forceUpdate();
  }, 1000);
  return () => clearInterval(interval);
}, [forceUpdate, sessionId]);
```

## Testing

1. Start a fitness session with governance enabled
2. Trigger warning phase (let HR drop below threshold)
3. Verify countdown displays and ticks correctly in:
   - Sidebar (FitnessGovernance)
   - Player overlay (FitnessPlayerOverlay)
4. Monitor `forceUpdateCount` - should be significantly lower (no 60/min baseline)
5. Verify no regressions in other governance states (unlocked, locked)

## Expected Impact

- **Before:** 60+ forceUpdate/min during active sessions (heartbeat alone)
- **After:** forceUpdate only on actual data changes (WebSocket, coin awards, phase changes)
- Estimated **70-80% reduction** in unnecessary re-renders

## Backwards Compatibility

- `countdownSecondsRemaining` remains in governanceState for any external consumers
- It will still be computed (just not updated in cache every second)
- Can deprecate in future release
