# BUG-05: Seek Thumbnail Time Mismatch

**Date:** 2026-01-10  
**Component:** `FitnessPlayerFooterSeekThumbnails.jsx`, `FitnessPlayerFooterSeekThumbnail.jsx`  
**Severity:** 🟠 High - Confusing user experience  
**Status:** 🔴 Diagnosed, fix pending

## Symptoms

When user taps a seek thumbnail:
1. ✅ Progress bar immediately jumps to the expected position
2. ✅ Video seeks to a new time
3. ❌ BUT the time label in the thumbnail doesn't update
4. ❌ A few seconds later, the progress bar "catches up" to where the video actually is

The visual effect: It looks like the seek "worked" but the time label is frozen, then suddenly the progress bar snaps to a different position.

## Root Cause Analysis

### Two Competing Time Sources

The component has two time concepts that become desynchronized:

| Variable | Source | Updates When |
|----------|--------|--------------|
| `displayTime` | `pendingTime ?? currentTime` | Immediately on seek (via `setPendingTime`) |
| `currentTime` | Video element | After video actually seeks |

### The Bug Location

In [FitnessPlayerFooterSeekThumbnails.jsx](../../frontend/src/modules/Fitness/FitnessPlayerFooter/FitnessPlayerFooterSeekThumbnails.jsx#L663-L702):

```jsx
// Line 663: isActive uses displayTime (correct - updates immediately)
const isActive = segmentDuration > 0
  ? (displayTime >= segmentStart && displayTime < activeUpperBound)
  : Math.abs(displayTime - segmentStart) < TIME_TOLERANCE;

// Line 673: labelTime correctly uses displayTime
const labelTime = isActive ? displayTime : segmentStart;

// Line 694-702: BUT thumbnailProgress uses currentTime (BUG!)
let thumbnailProgress = 0;
if (isActive) {
  const endTime = segmentEnd;
  const durationWindow = endTime - segmentStart;
  // ❌ currentTime hasn't updated yet - still at OLD position
  if (durationWindow > 0 && currentTime >= segmentStart && currentTime < effectiveEnd) {
    const progressInSegment = currentTime - segmentStart;
    thumbnailProgress = clamp01(progressInSegment / durationWindow);
    isActivelyPlaying = true;
  }
}
```

### Timeline of the Bug

```
T+0ms:   User taps thumbnail for time 300s
         - commit(300) called
         - setPendingTime(300)
         - displayTime = 300 (via pendingTime)
         - currentTime = 100 (old value, video hasn't seeked yet)
         
T+0ms:   Rendering:
         - isActive = true (displayTime=300 is in segment [275, 325])
         - labelTime = 300 (correct!)
         - BUT: currentTime=100 is NOT in segment [275, 325]
         - So: thumbnailProgress = 0 (condition fails!)
         
T+0ms:   What user sees:
         - Progress bar at 300 (displayTime) ✅
         - Thumbnail is "active" ✅  
         - Time label shows 0:00 or old time ❌
         - Progress frame at 0% ❌

T+500ms: Video finishes seeking
         - currentTime = 300
         - thumbnailProgress now calculates correctly
         - Visual "catches up"
```

## The Fix

The `thumbnailProgress` calculation should use `displayTime` instead of `currentTime` when the thumbnail is active:

```jsx
// BEFORE (buggy):
if (durationWindow > 0 && currentTime >= segmentStart && currentTime < effectiveEnd) {
  const progressInSegment = currentTime - segmentStart;
  thumbnailProgress = clamp01(progressInSegment / durationWindow);
  isActivelyPlaying = true;
}

// AFTER (fixed):
// For active thumbnail, use displayTime which reflects pending seeks
const effectiveTime = isActive ? displayTime : currentTime;
if (durationWindow > 0 && effectiveTime >= segmentStart && effectiveTime < effectiveEnd) {
  const progressInSegment = effectiveTime - segmentStart;
  thumbnailProgress = clamp01(progressInSegment / durationWindow);
  isActivelyPlaying = true;
}
```

## Impact

- **User perception:** Seek feels "broken" or laggy even though it works
- **Confusion:** Time label mismatch creates cognitive dissonance
- **Trust:** Users may doubt if their seek action was registered

## Related Issues

- The `labelTime` assignment on line 673 is correct (uses `displayTime`)
- The `seekTime` assignment on line 674 is correct (uses `segmentStart`)
- Only the progress calculation is wrong

## Files to Modify

1. [FitnessPlayerFooterSeekThumbnails.jsx](../../frontend/src/modules/Fitness/FitnessPlayerFooter/FitnessPlayerFooterSeekThumbnails.jsx) - Lines 694-702
