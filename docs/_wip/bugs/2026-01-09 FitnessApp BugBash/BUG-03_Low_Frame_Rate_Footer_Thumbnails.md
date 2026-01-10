# BUG-03: Low Frame Rate Animation on Footer Thumbnails

**Date Reported:** 2026-01-09  
**Category:** 🎨 UI, Styling, & Animation  
**Priority:** Medium  
**Status:** ✅ Fixed

---

## Summary

The footer thumbnails (perimeter frame and spark) update discretely on a tick rate (approximately 1 second), causing a "choppy" visual effect instead of fluid movement.

## Expected Behavior

The movement should be fluid with smooth transitions between position updates.

## Current Behavior

Perimeter frame and spark indicators jump discretely at ~1 second intervals, creating visible "steps" instead of smooth animation.

---

## Technical Analysis

### Relevant Components

| File | Purpose |
|------|---------|
| [`FitnessPlayerFooterSeekThumbnails.jsx`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/FitnessPlayerFooter/FitnessPlayerFooterSeekThumbnails.jsx) | Main seek thumbnails container |
| [`FitnessPlayerFooterSeekThumbnail.jsx`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/FitnessPlayerFooter/FitnessPlayerFooterSeekThumbnail.jsx) | Individual thumbnail component |
| [`FitnessPlayerFooterSeekThumbnail.scss`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/FitnessPlayerFooter/FitnessPlayerFooterSeekThumbnail.scss) | Thumbnail styling |
| [`ProgressFrame.jsx`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/FitnessPlayerFooter/ProgressFrame.jsx) | Progress frame component |

### Root Cause Analysis

The thumbnail progress is driven by `progressRatio` (line 695-706 in `FitnessPlayerFooterSeekThumbnails.jsx`):

```javascript
let thumbnailProgress = 0;
let isActivelyPlaying = false;
if (isActive) {
  const endTime = segmentEnd;
  const durationWindow = endTime - segmentStart;
  const BOUNDARY_TOLERANCE = 0.1;
  const effectiveEnd = endTime - BOUNDARY_TOLERANCE;
  if (durationWindow > 0 && currentTime >= segmentStart && currentTime < effectiveEnd) {
    const progressInSegment = currentTime - segmentStart;
    thumbnailProgress = clamp01(progressInSegment / durationWindow);
    isActivelyPlaying = true;
  }
}
```

The issue is that `currentTime` updates come from the video playback at its native rate, but the visual representation doesn't interpolate between these discrete updates.

### Existing Animation Reference

The codebase has smooth pan-scan animations in `FitnessPlayerFooterSeekThumbnail.scss`:

```scss
@keyframes pan-scan {
  0% { object-position: 0% 50%; }
  100% { object-position: 100% 50%; }
}

.seek-button-container.active .seek-thumbnail-layer {
  animation-name: pan-scan;
  animation-duration: var(--pan-duration, 5s);
  animation-timing-function: cubic-bezier(0.15, 0.45, 0.85, 0.55);
}
```

This pattern should be applied to the progress frame and spark elements.

---

## Recommended Fix

### Step 1: Add CSS Transition to Progress Frame

In `ProgressFrame.jsx` or its associated SCSS, add smooth transitions:

```scss
.progress-frame {
  // Existing positioning
  
  // Add smooth transition for position changes
  transition: 
    left 0.3s ease-out,
    width 0.3s ease-out;
}

.progress-frame__spark {
  transition: transform 0.3s ease-out;
}
```

### Step 2: Use CSS Keyframe Animation for Spark

Create a continuous animation that moves the spark along the progress arc:

```scss
@keyframes spark-travel {
  0% { transform: translateX(0%); }
  100% { transform: translateX(var(--spark-travel-distance, 100%)); }
}

.progress-frame__spark.animating {
  animation: spark-travel var(--spark-duration, 10s) linear;
}
```

### Step 3: Calculate Animation Duration Dynamically

In the component, set CSS custom properties based on segment duration:

```jsx
const sparkStyle = useMemo(() => ({
  '--spark-duration': `${segmentDuration}s`,
  '--spark-travel-distance': '100%',
}), [segmentDuration]);
```

### Step 4: Implement Interpolation in Component (Advanced)

For maximum smoothness, interpolate between known time points:

```javascript
// In FitnessPlayerFooterSeekThumbnail.jsx
const animatedProgress = useSpring({
  progress: progressRatio,
  config: { duration: 200, easing: easings.easeOutQuad }
});
```

> [!TIP]
> Reference the implementation used for User Avatars/Gauges (mentioned in bug report) for similar smoothness patterns.

---

## Files to Modify

1. [`FitnessPlayerFooterSeekThumbnail.scss`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/FitnessPlayerFooter/FitnessPlayerFooterSeekThumbnail.scss) - Add transition properties
2. [`ProgressFrame.jsx`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/FitnessPlayerFooter/ProgressFrame.jsx) and its SCSS - Add animation keyframes
3. [`FitnessPlayerFooterSeekThumbnail.jsx`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/FitnessPlayerFooter/FitnessPlayerFooterSeekThumbnail.jsx) - Update to use CSS custom properties for timing

---

## Verification Steps

1. Launch Fitness App and start playing a video
2. Observe footer thumbnail progress frame movement
3. Progress should move smoothly rather than jumping at 1-second intervals
4. Spark indicator should glide smoothly along the frame perimeter
5. Test with videos of various durations (short clips vs long episodes)

---

## Performance Considerations

- CSS animations are GPU-accelerated and performant
- Avoid JavaScript-driven animation loops that could impact video playback
- Use `will-change: transform` sparingly to hint browser optimization

---

*For testing, assign to: QA Team*  
*For development, assign to: Frontend Team (Animation specialist)*
