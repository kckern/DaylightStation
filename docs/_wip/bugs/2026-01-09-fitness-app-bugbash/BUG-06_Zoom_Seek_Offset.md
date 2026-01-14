# BUG-06: Zoom-Seek Offset Bug

**Date:** 2026-01-10  
**Component:** `FitnessPlayerFooterSeekThumbnails.jsx`, `useCommonMediaController.js`  
**Severity:** 🔴 Critical - Seek goes to wrong time  
**Status:** ✅ FIXED

## Symptoms

After zooming into a thumbnail segment and then zooming back out:
1. User clicks a thumbnail to seek
2. Video seeks to the **wrong time** with a cumulative offset
3. Each zoom-seek cycle adds more offset

**Example:**
- Click 10:19 (619s) → jumps to 11:57 (717s) = 98s offset
- After another zoom cycle, click 10:19 → jumps to 13:15 (795s) = 176s offset

## Root Cause

The media controller's `pendingAutoSeekRef` stored seek positions from zoomed states and was **not cleared** when unzooming. This caused:

1. User zooms and seeks to position X within zoom
2. `pendingAutoSeekRef.current = X` 
3. User zooms out and seeks to position Y
4. Both X and Y intents are active, causing cumulative offset

The `pendingAutoSeekRef` is used by the media controller to restore seek positions after video loading/buffering. When zoom changed, this stale reference persisted and interfered with new seeks.

## The Fix

**Added in [FitnessPlayerFooterSeekThumbnails.jsx](../../../frontend/src/modules/Fitness/FitnessPlayerFooter/FitnessPlayerFooterSeekThumbnails.jsx#L138-L155):**

```javascript
// Clear stale seek intents when zoom range changes to prevent offset bug
useEffect(() => {
  if (!playerRef?.current) return;
  const controller = playerRef.current;
  
  // Clear any pending auto-seek from previous zoom
  if (typeof controller.clearPendingAutoSeek === 'function') {
    controller.clearPendingAutoSeek();
  }
  
  // Clear resilience system's seek intent when unzooming
  if (typeof controller.recordSeekIntentMs === 'function' && !zoomRange) {
    controller.recordSeekIntentMs(null, 'zoom-range-reset');
  }
}, [zoomRange, playerRef]);
```

**Added to [useCommonMediaController.js](../../../frontend/src/modules/Player/hooks/useCommonMediaController.js#L813-L815):**

```javascript
clearPendingAutoSeek: () => {
  pendingAutoSeekRef.current = null;
}
```

## Verification

✅ Runtime test created: [zoom-seek-offset.runtime.test.mjs](../../../tests/runtime/fitness-session/zoom-seek-offset.runtime.test.mjs)
✅ Manual testing confirmed fix
✅ No offset after zoom → unzoom → seek cycle

## Related Files

- [FitnessPlayerFooterSeekThumbnails.jsx](../../../frontend/src/modules/Fitness/FitnessPlayerFooter/FitnessPlayerFooterSeekThumbnails.jsx)
- [useCommonMediaController.js](../../../frontend/src/modules/Player/hooks/useCommonMediaController.js)
- [zoom-seek-offset.runtime.test.mjs](../../../tests/runtime/fitness-session/zoom-seek-offset.runtime.test.mjs)
