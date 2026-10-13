# Zoom Reset After Seek + Spark Glow Fix

## Overview

Two small UX improvements to the fitness player footer thumbnails:
1. Auto-reset zoom to base level after a seek completes
2. Fix spark glow getting clipped by parent container

## Feature 1: Auto-Reset Zoom After Seek

### Behavior
- User clicks thumbnail to seek while zoomed in
- Playback resumes at new position
- After 800ms delay, zoom resets to full timeline view
- Cancel reset if user interacts during delay (zoom, seek, pan left/right)

### Implementation

**useZoomState.js changes:**

1. Add `pendingResetRef` to track timeout
2. Add `scheduleZoomReset(delayMs)` function - schedules zoomOut after delay
3. Add `cancelZoomReset()` function - clears pending timeout
4. Call `cancelZoomReset()` in `zoomIn`, `stepBackward`, `stepForward`
5. Export both new functions

**FitnessPlayerFooterSeekThumbnails.jsx changes:**

1. Get `scheduleZoomReset` and `cancelZoomReset` from zoom state
2. Detect "playing after seek" condition
3. Call `scheduleZoomReset()` when detected
4. Call `cancelZoomReset()` on new seek

## Feature 2: Spark Glow Fix

### Problem
The spark's `drop-shadow` glow gets clipped by parent's `overflow: hidden`.

### Solution
Replace `overflow: hidden` with `clip-path: inset(0)` in `.thumbnail-wrapper`.

`clip-path` clips element content but allows filter effects (like drop-shadow) to render outside the clip boundary.

**FitnessPlayerFooterSeekThumbnail.scss line 17:**
```scss
// Before
overflow: hidden;

// After
clip-path: inset(0);
```

## Files to Modify

1. `frontend/src/modules/Fitness/FitnessPlayerFooter/hooks/useZoomState.js`
2. `frontend/src/modules/Fitness/FitnessPlayerFooter/FitnessPlayerFooterSeekThumbnails.jsx`
3. `frontend/src/modules/Fitness/FitnessPlayerFooter/FitnessPlayerFooterSeekThumbnail.scss`
