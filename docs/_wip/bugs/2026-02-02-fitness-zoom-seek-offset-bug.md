# Bug Report: Zoom-Seek Offset Bug (BUG-06)

**Date:** 2026-02-02  
**Status:** Fixed  
**Severity:** High (P1)  
**Component:** FitnessPlayerFooter zoom/seek system

---

## Resolution (2026-02-02)

**Root cause was misdiagnosed.** The original analysis about missing API methods was incorrect - both `clearPendingAutoSeek` and `clearSeekIntent` exist on `playerRef.current` (added in Player.jsx lines 691-697).

**Actual issue:** Zoom reset was triggered by `isSeekPending` becoming false, which happens when `intentTime` clears. But `intentTime` can clear before playback actually resumes (tolerance-based clearing).

**Fix:** Changed zoom reset trigger from `isSeekPending` to `lifecycle === 'playing'`. The useSeekState hook already tracks the full seek lifecycle (idle → seeking → buffering → playing → idle). Now zoom only resets when video actually starts playing at the target position.

---

## Summary

After zooming into the fitness player timeline and then zooming out, seeking to a thumbnail results in the video jumping to the **wrong position** with a cumulative offset that worsens with each zoom-seek cycle.

---

## Environment

- **Component**: `FitnessPlayerFooterSeekThumbnails.jsx`
- **Related Hooks**: `useZoomState.js`, `useSeekState.js`
- **Platform**: All (Web/Electron)

---

## Steps to Reproduce

1. Start playing a fitness video
2. Double-click a thumbnail to **zoom into** that segment
3. Click a different thumbnail within the zoomed view (optional)
4. Double-click again or use zoom-out to **zoom back to full timeline**
5. Click any thumbnail to seek
6. **Observe**: Video seeks to wrong position (offset from expected)
7. Repeat steps 2-5 - offset becomes worse each cycle

---

## Expected Behavior

Clicking a thumbnail at position X should seek the video to exactly position X, regardless of prior zoom operations.

---

## Actual Behavior

After zoom cycles, the video seeks to position X + offset, where offset accumulates from stale seek intents stored during zoomed states.

---

## Root Cause Analysis

### Primary Issue: Stale Seek Intent Persistence

The fix in `useZoomState.js` (lines 139-155) attempts to clear seek intents on zoom changes but **fails silently**:

```javascript
// useZoomState.js - THE FIX DOESN'T WORK
useEffect(() => {
  if (!playerRef?.current) return;
  
  // ❌ clearPendingAutoSeek doesn't exist on playerRef.current
  if (typeof playerRef.current.clearPendingAutoSeek === 'function') {
    playerRef.current.clearPendingAutoSeek();
  }
  
  // ❌ clearSeekIntent doesn't exist on playerRef.current
  if (!zoomRange && typeof playerRef.current.clearSeekIntent === 'function') {
    playerRef.current.clearSeekIntent('zoom-range-reset');
  }
}, [zoomRange, playerRef]);
```

### Why It Fails

1. **Wrong API Layer**: `playerRef.current` is the Player imperative handle, which exposes:
   - `getMediaResilienceController()` - the **correct** path to resilience methods
   - `getMediaController()` → `transport` - where `clearPendingAutoSeek` lives
   
   But the fix calls methods directly on `playerRef.current` which don't exist there.

2. **typeof Guards Hide Failure**: The `typeof === 'function'` checks return `false`, so the code silently skips without any error or effect.

3. **Multiple Stale State Sources**:
   - `lastKnownSeekIntentMsRef` in resilience system
   - `sessionTargetTimeSeconds` persisted for recovery
   - `pendingAutoSeekRef` in transport layer

---

## Partial Mitigation in Place

`FitnessPlayerFooterSeekThumbnails.jsx` has a separate mitigation (lines 109-118):

```javascript
// --- CLEAR SEEK INTENT ON ZOOM CHANGES ---
// This prevents the stale seek intent bug (BUG-02, BUG-03)
const prevZoomRangeRef = useRef(zoomRange);
useEffect(() => {
  if (prevZoomRangeRef.current !== zoomRange) {
    prevZoomRangeRef.current = zoomRange;
    clearIntent('zoom-change');  // ✅ This clears useSeekState's local intent
  }
}, [zoomRange, clearIntent]);
```

This clears the **local** `intentTime` state but does NOT clear:
- The resilience system's persisted seek intent
- The transport layer's `pendingAutoSeekRef`

---

## Recommended Fix

### Option 1: Correct the API Path in useZoomState.js

```javascript
useEffect(() => {
  if (!playerRef?.current) return;
  
  // Access transport layer correctly
  const mediaController = playerRef.current.getMediaController?.();
  const transport = mediaController?.transport;
  if (typeof transport?.clearPendingAutoSeek === 'function') {
    transport.clearPendingAutoSeek();
    logger.info('cleared-pending-autoseek-on-zoom-change', { zoomRange });
  }
  
  // Access resilience controller correctly
  const resilienceController = playerRef.current.getMediaResilienceController?.();
  if (!zoomRange && typeof resilienceController?.clearSeekIntent === 'function') {
    resilienceController.clearSeekIntent('zoom-range-reset');
    logger.info('cleared-seek-intent-on-unzoom');
  }
}, [zoomRange, playerRef]);
```

### Option 2: Add clearSeekIntent to Player Imperative Handle

In `FitnessPlayer.jsx`, add to `useImperativeHandle`:

```javascript
clearSeekIntent: (reason) => {
  const controller = getMediaResilienceController();
  controller?.clearSeekIntent?.(reason);
  // Also clear transport
  mediaControllerRef.current?.transport?.clearPendingAutoSeek?.();
}
```

### Option 3: Add clearSeekIntent to Resilience Controller

In `useMediaResilience.js`, add a method that:
- Sets `lastKnownSeekIntentMsRef.current = null`
- Calls `updateSessionTargetTimeSeconds(null)`

---

## Related Code

| File | Purpose |
|------|---------|
| `frontend/src/modules/Fitness/FitnessPlayerFooter/FitnessPlayerFooterSeekThumbnails.jsx` | Main seek/zoom UI component |
| `frontend/src/modules/Fitness/FitnessPlayerFooter/hooks/useZoomState.js` | Zoom state management |
| `frontend/src/modules/Fitness/FitnessPlayerFooter/hooks/useSeekState.js` | Seek state management |
| `frontend/src/modules/Fitness/FitnessPlayer/hooks/useMediaResilience.js` | Media recovery/resilience |
| `frontend/src/modules/Fitness/FitnessPlayer/hooks/useCommonMediaController.js` | Transport layer with pendingAutoSeekRef |

---

## Related Bugs

| Bug ID | Title | Status |
|--------|-------|--------|
| BUG-01 | Zoom Triggers Seek | Fixed via separation |
| BUG-02 | pendingTime Persists Through Zoom | Mitigated by clearIntent |
| BUG-03 | Stale Seek Intent After Unzoom | **Still Present** |
| BUG-04 | Zoom Nav Index Mismatch | Fixed |

---

## Test Cases

1. **Zoom-Seek-Unzoom-Seek**: Verify seek targets remain accurate
2. **Multi-Zoom Cycles**: Verify no cumulative offset
3. **Zoom + Stall Recovery**: Verify resilience doesn't restore stale intent
4. **Zoom + Track Change**: Verify zoom resets properly

---

## References

- [BUG-06_FINDINGS.md](../../_archive/2026-01-cleanup/wip-old-bugs/2026-01-09-fitness-app-bugbash/BUG-06_FINDINGS.md) - Original deep dive analysis
- [BUG-06_Zoom_Seek_Offset.md](../../_archive/2026-01-cleanup/wip-old-bugs/2026-01-09-fitness-app-bugbash/BUG-06_Zoom_Seek_Offset.md) - Initial bug report
