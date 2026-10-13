# Position Display Logic Audit

**Date:** 2024-12-29  
**Components:** [LoadingOverlay.jsx](../../frontend/src/modules/Player/components/LoadingOverlay.jsx), [PlayerOverlayLoading.jsx](../../frontend/src/modules/Player/components/PlayerOverlayLoading.jsx)  
**Issue:** Users reporting incorrect position values during loading states

---

## Summary

The `positionDisplay` value shown on loading overlays is derived from two props—`intentPositionDisplay` and `playerPositionDisplay`—using a simple fallback pattern. Several issues in the data flow can cause incorrect or stale values to appear.

---

## Data Flow

```
Player.jsx
    ↓
useMediaResilience() → intentMsForDisplay
    ↓
useResiliencePresentation() → formats both values
    ↓
createOverlayProps() → playerPositionDisplay, intentPositionDisplay
    ↓
LoadingOverlay / PlayerOverlayLoading
    ↓
positionDisplay = intentPositionDisplay || playerPositionDisplay || null
```

---

## Root Cause Analysis

### 1. Priority Inversion Between Intent and Actual Position

**Location:** Both overlay components, line ~351 in [LoadingOverlay.jsx](../../frontend/src/modules/Player/components/LoadingOverlay.jsx#L351), line ~107 in [PlayerOverlayLoading.jsx](../../frontend/src/modules/Player/components/PlayerOverlayLoading.jsx#L107)

```javascript
const positionDisplay = intentPositionDisplay || playerPositionDisplay || null;
```

**Problem:**  
`intentPositionDisplay` always takes priority over `playerPositionDisplay`. During certain loading states:

- **Stale intent:** The seek intent may be outdated (e.g., user sought to 5:00, but playback has progressed to 5:30 before a stall).
- **Missing intent:** If `intentPositionDisplay` is `null` but `playerPositionDisplay` is `"0:00"`, users see nothing (the `"0:00"` validation discards it).

**Impact:** Users see the _target_ position rather than the _actual_ position when the overlay appears during mid-playback stalls.

---

### 2. `resolveSeekIntentMs()` Fallback Chain is Complex

**Location:** [useMediaResilience.js#L1182-L1203](../../frontend/src/modules/Player/hooks/useMediaResilience.js#L1182)

```javascript
const resolveSeekIntentMs = useCallback((overrideMs = null) => {
  if (explicitStartMs != null) return explicitStartMs;              // 1. Explicit start from props
  if (Number.isFinite(overrideMs)) return Math.max(0, overrideMs);  // 2. Override param
  if (Number.isFinite(sessionTargetTimeSeconds)) return sessionTargetTimeSeconds * 1000; // 3. Session state
  if (Number.isFinite(lastKnownSeekIntentMsRef.current)) return lastKnownSeekIntentMsRef.current; // 4. Last known intent
  if (Number.isFinite(lastProgressSecondsRef.current)) return lastProgressSecondsRef.current * 1000; // 5. Last progress
  if (Number.isFinite(lastSecondsRef.current)) return lastSecondsRef.current * 1000; // 6. Last seconds
  return null;
}, [explicitStartMs, sessionTargetTimeSeconds]);
```

**Problems:**

| Priority | Source | Issue |
|----------|--------|-------|
| 1 | `explicitStartMs` | Persists even after playback has moved past the explicit start. |
| 3 | `sessionTargetTimeSeconds` | May lag behind actual playback if session updates are throttled. |
| 4 | `lastKnownSeekIntentMsRef` | Never cleared after seek completes; can show stale intent. |
| 5–6 | `lastProgressSecondsRef` / `lastSecondsRef` | Only used as fallback; correct value but rarely reached. |

**Impact:** `intentMsForDisplay` often reflects old seek targets rather than current progress.

---

### 3. `playerPositionDisplay` Derived from `seconds` Prop

**Location:** [useResiliencePresentation.js#L153](../../frontend/src/modules/Player/hooks/presentation/useResiliencePresentation.js#L153)

```javascript
const playerPositionDisplay = formatTime(Math.max(0, seconds));
```

**Problem:**  
`seconds` comes from `playbackMetrics.seconds` in `Player.jsx`, which is updated via `setPlaybackMetrics` from the child `SinglePlayer`. During loading/buffering:

- The media element's `currentTime` may not update (frozen).
- The `seconds` prop may be `0` at component mount before the first `timeupdate` fires.

**Impact:** `playerPositionDisplay` shows `"0:00"` or a stale value during initial load or after a recovery.

---

### 4. Validation Discards `"0:00"` Unconditionally

**Location:** [PlayerOverlayLoading.jsx#L108](../../frontend/src/modules/Player/components/PlayerOverlayLoading.jsx#L108)

```javascript
const hasValidPosition = positionDisplay && positionDisplay !== '0:00';
```

**Problem:**  
A literal position of `"0:00"` is treated as invalid. This is correct for _initial_ load (no real position yet) but incorrect if:

- User actually seeks to 0:00.
- Media legitimately starts at 0:00 and stalls immediately.

**Impact:** Overlay shows empty position when `0:00` is the actual correct value.

---

### 5. No Freshness Indicator

Neither overlay tracks _when_ the position was last updated. A stale `intentPositionDisplay` from 10 seconds ago is indistinguishable from a fresh one.

---

## Recommended Fixes

### Fix 1: Prefer Actual Position Over Intent During Mid-Playback Stalls

```javascript
// Current (problematic)
const positionDisplay = intentPositionDisplay || playerPositionDisplay || null;

// Proposed
const isSeekInProgress = status === 'seeking' || isSeeking;
const positionDisplay = isSeekInProgress
  ? (intentPositionDisplay || playerPositionDisplay || null)
  : (playerPositionDisplay || intentPositionDisplay || null);
```

**Rationale:** Only show intent position when actively seeking; otherwise show actual playback position.

---

### Fix 2: Clear Stale Seek Intent After Successful Seek

In `useMediaResilience.js`, add logic to clear `lastKnownSeekIntentMsRef` once the media element reaches the target:

```javascript
useEffect(() => {
  const targetMs = lastKnownSeekIntentMsRef.current;
  if (!Number.isFinite(targetMs)) return;
  const currentMs = seconds * 1000;
  const epsilonMs = epsilonSeconds * 1000;
  if (Math.abs(currentMs - targetMs) < epsilonMs && !isSeeking) {
    lastKnownSeekIntentMsRef.current = null;
  }
}, [seconds, isSeeking, epsilonSeconds]);
```

---

### Fix 3: Add Timestamp to Position Sources

Track when each position source was last updated:

```javascript
const [intentPositionMeta, setIntentPositionMeta] = useState({
  value: null,
  updatedAt: null
});
```

In overlays, prefer the more recent source if both are available:

```javascript
const intentAge = Date.now() - (intentMeta?.updatedAt || 0);
const playerAge = Date.now() - (playerMeta?.updatedAt || 0);
const preferIntent = intentAge < playerAge && intentAge < STALE_THRESHOLD_MS;
```

---

### Fix 4: Allow `"0:00"` When Explicitly Valid

```javascript
// Current
const hasValidPosition = positionDisplay && positionDisplay !== '0:00';

// Proposed
const isExplicitZeroStart = explicitStartProvided && initialStart === 0;
const hasValidPosition = positionDisplay && (positionDisplay !== '0:00' || isExplicitZeroStart);
```

---

## Testing Checklist

- [ ] Seek to arbitrary position → stall → overlay shows seek target
- [ ] Mid-playback stall (no seek) → overlay shows actual position
- [ ] Seek to 0:00 explicitly → overlay shows `"0:00"`
- [ ] Initial load with `initialStart > 0` → overlay shows initial start
- [ ] Recovery after stall → overlay updates to post-recovery position
- [ ] Rapid seek during buffering → overlay shows latest intent

---

## Files to Modify

1. [LoadingOverlay.jsx](../../frontend/src/modules/Player/components/LoadingOverlay.jsx) — position priority logic
2. [PlayerOverlayLoading.jsx](../../frontend/src/modules/Player/components/PlayerOverlayLoading.jsx) — position priority logic
3. [useMediaResilience.js](../../frontend/src/modules/Player/hooks/useMediaResilience.js) — stale intent cleanup
4. [useResiliencePresentation.js](../../frontend/src/modules/Player/hooks/presentation/useResiliencePresentation.js) — add freshness metadata

---

## Severity

**Medium** — Incorrect position display is confusing but does not block playback. Users may lose trust in the UI or attempt unnecessary recoveries.
