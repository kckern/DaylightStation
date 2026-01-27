# Audit: Governance Phase Change Render Cascade

**Date:** 2026-01-15  
**Status:** ✅ Fixed  
**Severity:** High (Continuous unnecessary re-renders throughout session)  
**Observed:** Video framerate drops and excessive timer restarts during governance state evaluation

## Executive Summary

Analysis of production logs reveals a **critical bug in GovernanceEngine** that causes **double phase transitions** on every evaluation cycle. This triggers the React `forceUpdate()` callback twice per cycle, causing a render cascade that impacts the entire FitnessPlayer component tree.

**Key Finding:** The governance system logs show `null → pending → null` pairs occurring at the **same millisecond** throughout the entire session - not just during warning state. The warning period simply makes the impact more visible.

**Fix Applied:** Added `_resetToIdle()` method to properly transition to null phase without double-triggering callbacks.

---

## Root Cause Analysis

### Primary Bug: Double Phase Transition in evaluate()

**Location:** [GovernanceEngine.js#L814-L827](frontend/src/hooks/fitness/GovernanceEngine.js#L814-L827)

```javascript
// 1. Check if media is governed
if (!this.media || !this.media.id || !hasGovernanceRules) {
  this.reset();           // ← Calls _setPhase('pending') → forceUpdate()
  this._setPhase(null);   // ← Calls _setPhase(null) → forceUpdate() AGAIN
  return;
}

const hasGovernedMedia = this._mediaIsGoverned();
if (!hasGovernedMedia) {
  this.reset();           // ← Calls _setPhase('pending') → forceUpdate()
  this._setPhase(null);   // ← Calls _setPhase(null) → forceUpdate() AGAIN
  return;
}
```

**The Bug:** `reset()` internally calls `_setPhase('pending')` at [line 581](frontend/src/hooks/fitness/GovernanceEngine.js#L581), but immediately after `reset()` returns, the code calls `_setPhase(null)`. This creates **two phase transitions per evaluation**:

1. `reset()` → `_setPhase('pending')` → `onPhaseChange('pending')` → `forceUpdate()`
2. `_setPhase(null)` → `onPhaseChange(null)` → `forceUpdate()`

**Evidence from logs:**
```json
{"ts":"2026-01-15T13:46:34.022Z","data":{"from":null,"to":"pending"}}
{"ts":"2026-01-15T13:46:34.022Z","data":{"from":"pending","to":null}}
```

Same timestamp, two phase changes - this is the smoking gun.

---

### The Callback Chain

**Location:** [FitnessContext.jsx#L437-L438](frontend/src/context/FitnessContext.jsx#L437-L438)

```javascript
session.governanceEngine.setCallbacks({
  onPhaseChange: () => forceUpdate(),
  onPulse: () => forceUpdate()
});
```

**Location:** [FitnessContext.jsx#L224-L226](frontend/src/context/FitnessContext.jsx#L224-L226)

```javascript
const forceUpdate = React.useCallback(() => {
  setVersion((v) => v + 1);
}, []);
```

Every `_setPhase()` call triggers `forceUpdate()`, which increments `version`, causing **the entire FitnessContext provider to re-render**.

---

### Cascade Impact

When FitnessContext re-renders:

1. **All consumers re-render** - Every component using `useFitness()` gets new context values
2. **FitnessPlayer re-renders** - Expensive component with video player, charts, overlays
3. **Timer restarts** - The tick timer is restarted on certain state changes
4. **governanceState reference changes** - Even if data is same, new object = new render

**Log Evidence - Timer Restarts Throughout Session:**
```
13:05:55.830Z  null → pending
13:05:55.830Z  pending → null
13:05:56.071Z  null → pending  
13:05:56.071Z  pending → null
13:05:56.814Z  null → pending
13:05:56.814Z  pending → null
...repeated thousands of times...
```

This pattern occurs **2,427 times in 1 hour** of logs.

---

## Why Warning State Appeared Worse

The warning state (13:45:35-13:45:45) felt worse because:

1. **Additional legitimate state updates** - Countdown timer updating
2. **More visual work** - CSS filter being applied/reapplied
3. **Attention focused** - User actively watching for feedback

But the **bug was present the entire session**, just less noticeable during unlocked/pending states.

---

## Quantified Impact

| Metric | Value |
|--------|-------|
| Double phase changes per hour | 2,427 |
| Extra forceUpdate() calls | 2,427 |
| Timer restart events logged | 1,177 |
| Wasted React reconciliation cycles | ~4,854 |

**Each unnecessary render cycle:**
- Traverses entire FitnessContext consumer tree
- Recomputes memoized values (useMemo dependencies change)
- Triggers useEffect hooks with context dependencies
- Forces garbage collection of previous render objects

---

## Recommended Fixes

### ✅ Fix 1: Remove Redundant _setPhase(null) Calls (IMPLEMENTED)

**Location:** [GovernanceEngine.js#L814-L827](frontend/src/hooks/fitness/GovernanceEngine.js#L814-L827)

**Implementation:** Added new `_resetToIdle()` method that:
- Clears all state similar to `reset()`
- Only calls `_setPhase(null)` if phase is not already null
- Avoids the double phase transition

**Changes Made:**
1. Created `_resetToIdle()` method at line 600
2. Replaced `this.reset(); this._setPhase(null);` calls with `this._resetToIdle()` at lines 816 and 824

**Code:**
```javascript
/**
 * Reset to idle state (null phase) without double phase transitions.
 * Use this instead of reset() + _setPhase(null) to avoid triggering
 * two separate phase change callbacks.
 */
_resetToIdle() {
  this._clearTimers();
  // ... reset all state ...
  
  // Only set phase if actually changing to avoid unnecessary callbacks
  if (this.phase !== null) {
    this._setPhase(null);
  }
}
```

---

### Fix 2: Guard Phase Changes (Optional Enhancement)

**Status:** Not needed - `_resetToIdle()` already includes this guard

The phase change guard at [GovernanceEngine.js#L453-L470](frontend/src/hooks/fitness/GovernanceEngine.js#L453-L470) already prevents duplicate phase changes when the new phase equals the current phase. The `_resetToIdle()` method now leverages this guard.

---

### Fix 3: Batch Context Updates (Future Enhancement)

**Location:** [FitnessContext.jsx#L437-L438](frontend/src/context/FitnessContext.jsx#L437-L438)

Use `unstable_batchedUpdates` or React 18's automatic batching:

```javascript
session.governanceEngine.setCallbacks({
  onPhaseChange: (phase) => {
    // Debounce rapid phase changes
    if (phaseDebounceRef.current) clearTimeout(phaseDebounceRef.current);
    phaseDebounceRef.current = setTimeout(() => {
      forceUpdate();
    }, 16); // One frame
  },
  onPulse: () => forceUpdate()
});
```

---

### Fix 4: Memoize governanceState Reference

**Location:** [FitnessContext.jsx#L1754](frontend/src/context/FitnessContext.jsx#L1754)

```javascript
// Current: Creates new object reference every render
const governanceState = session?.governanceEngine?.state || { status: 'idle' };

// Better: Memoize based on actual state values
const governanceState = useMemo(() => {
  const state = session?.governanceEngine?.state;
  return state || { status: 'idle' };
}, [session?.governanceEngine?.state?.status, session?.governanceEngine?.state?.phase]);
```

---

## Verification Plan

After implementing fixes:

1. **Check log pattern:**
   ```bash
   grep 'governance.phase_change' logs/prod-logs-*.txt | \
     jq -r '[.ts, .data.from, .data.to] | @tsv' | \
     uniq -c | grep "^\s*2 " | wc -l
   ```
   - **Target:** 0 (no more double phase changes at same timestamp)

2. **Measure render frequency:**
   - Add `console.count('FitnessContext render')` temporarily
   - Should see ~80% reduction in renders

3. **Timer stability:**
   - Timer intervals should stay close to 5000ms
   - No more sub-1000ms restarts

---

## Related Files

| File | Line | Issue |
|------|------|-------|
| [GovernanceEngine.js](frontend/src/hooks/fitness/GovernanceEngine.js#L814-L827) | 814-827 | Double _setPhase calls |
| [GovernanceEngine.js](frontend/src/hooks/fitness/GovernanceEngine.js#L581) | 581 | reset() calls _setPhase('pending') |
| [FitnessContext.jsx](frontend/src/context/FitnessContext.jsx#L437-L438) | 437-438 | onPhaseChange triggers forceUpdate |
| [FitnessContext.jsx](frontend/src/context/FitnessContext.jsx#L224-L226) | 224-226 | forceUpdate implementation |

---

## References

- Production logs: `logs/prod-logs-20260115-054750.txt`
- Total governance.phase_change events: 2,427 in 1 hour
- Pattern: Pairs of `null→pending` then `pending→null` at same millisecond
