# BUG-06: Zoom-Seek Offset Bug

**Date:** 2026-01-10  
**Component:** `FitnessPlayerFooterSeekThumbnails.jsx`  
**Severity:** 🔴 Critical - Seek goes to wrong time  
**Status:** 🔴 Diagnosed

## Symptoms

After zooming into a thumbnail segment and then zooming back out:
1. User clicks a thumbnail to seek
2. Video seeks to the **wrong time** with an offset equal to the previous zoom range start
3. The progress bar jumps to the wrong position

## Root Cause

The `handleThumbnailSeek` callback in [FitnessPlayerFooterSeekThumbnails.jsx](../../../frontend/src/modules/Fitness/FitnessPlayerFooter/FitnessPlayerFooterSeekThumbnails.jsx#L618-646) uses `rangeStart` in its dependency array, but this value becomes **stale** after unzooming.

### Test Evidence

From runtime test logs:

**During zoom (range start = 309.58s):**
```javascript
[handleThumbnailSeek] {
  footerRangeStart: 309.5826,  // Correct - zoomed range start
  currentTime: 5.369168
}
```

**After unzoom (range start should = 0s):**
```javascript
[handleThumbnailSeek] {
  seekTarget: 170.27043,
  resolvedTarget: 170.27043,
  footerRangeStart: 154.7913,  // ❌ WRONG! Stale value from previous zoom
  currentTime: 309.5826
}
```

**Expected:** `footerRangeStart: 0` (base level)  
**Actual:** `footerRangeStart: 154.7913` (leftover from zoom)

## Timeline

```
T+0: Base level, rangeStart = 0
     User sees thumbnails [0:00, 2:34, 5:09, 7:44, 10:19, ...]
     
T+1: User clicks thumbnail #3 time label → ZOOM
     rangeStart = 309.58s
     User sees zoomed thumbnails [5:09, 5:24, 5:40, ...]
     
T+2: User clicks first zoomed thumbnail → SEEK to 309.58s ✅
     
T+3: User clicks zoom-back button → UNZOOM
     rangeStart should = 0
     User sees thumbnails [0:00, 2:34, 5:09, ...]
     
T+4: User clicks thumbnail #2 → SEEK
     Expected: seek to 170.27s (2:50)
     Actual: seek uses footerRangeStart = 154.79s
     Result: Wrong time!
```

## The Code Bug

In [FitnessPlayerFooterSeekThumbnails.jsx](../../../frontend/src/modules/Fitness/FitnessPlayerFooter/FitnessPlayerFooterSeekThumbnails.jsx#L618-646):

```javascript
const handleThumbnailSeek = useCallback((seekTarget, rangeAnchor, meta = null) => {
  if (disabled) return;
  const resolvedTarget = Number.isFinite(rangeAnchor)
    ? rangeAnchor
    : (Number.isFinite(seekTarget) ? seekTarget : rangeStart);  // ← Uses rangeStart
  
  commit(resolvedTarget);
  if (zoomRange) {
    resetZoomOnPlayingRef.current = true;
  }
}, [commit, zoomRange, rangeStart, disabled, currentTime, displayTime]);
//                      ^^^^^^^^^^
//                      This is in the dependency array BUT
//                      the callback doesn't update properly after unzoom
```

The issue: When `rangeStart` changes (from 309.58 → 0 after unzoom), `useCallback` should recreate the function with the new value. But something is preventing the callback from updating with the fresh `rangeStart`.

Actually, looking closer - the callback DOES have `rangeStart` in the dependency array, so it should update. The real issue might be that the **thumbnails themselves** are passing stale `rangeStart` values as the `anchor` parameter!

Let me check how thumbnails are rendered and what they pass as `seekTime`/`rangeAnchor`:

Looking at line 674 in the `renderedSeekButtons` memo:
```javascript
const seekTime = segmentStart;
```

And `SingleThumbnailButton` resolves:
```javascript
const resolveSeekTime = () => {
  if (Number.isFinite(seekTime)) return seekTime;
  if (btnRange) return btnRange[0];
  if (Number.isFinite(rangeStart)) return rangeStart;
  return pos;
};
```

The thumbnail passes `rangeAnchor = segmentStart` which is computed from `rangePositions` which comes from the **current** `rangeStart/rangeEnd`. So after unzoom, `rangePositions` should be recalculated with the new range.

But the log shows thumbnail #2 has `data-pos: 170.27043` which is CORRECT for the unzoomed state. So why is `footerRangeStart` showing as 154.79 in the log?

Wait - the log says `footerRangeStart: 154.7913` but the thumbnail's `rangeStart` is `170.27043`. Let me look at the rangePositions calculation...

Actually, `rangeStart` for the FOOTER at base level should be **0**, not 154.79 or 170.27. Let me check the effectiveRange calculation.

## The Actual Bug

The `rangeStart` logged as `footerRangeStart: 154.7913` suggests the **effectiveRange** is not resetting to `[0, duration]` after unzoom. The zoom state might be lingering.

Need to check:
1. How `zoomRange` is cleared
2. How `effectiveRange` is computed from `zoomRange`
3. Whether there's a timing issue where `rangeStart` updates before thumbnails re-render

## Fix Required

Investigate the `effectiveRange` useMemo and `zoomRange` state management in [FitnessPlayerFooterSeekThumbnails.jsx](../../../frontend/src/modules/Fitness/FitnessPlayerFooter/FitnessPlayerFooterSeekThumbnails.jsx#L95-122) around line 95-122.
