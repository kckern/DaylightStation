# Bug 05: Full-Screen Spinner Exit Stall

**Date:** 2026-02-04
**Status:** Investigation Needed
**Area:** Video Player - Fullscreen Mode

## Summary

If a video stalls (spinner appears) while in full-screen mode, the tap-to-exit toggle stops working, trapping the user.

## Investigation Findings

### Initial Analysis

This bug requires additional investigation. The exploration agents focused on other areas. Key questions to answer:

1. How does the fullscreen toggle work?
2. What element handles tap-to-exit?
3. Where does the spinner overlay render?
4. What z-index values are involved?

### Expected Behavior

- User enters fullscreen mode
- Video stalls (network issue, buffering)
- Spinner overlay appears
- User taps to exit fullscreen
- Fullscreen should exit, returning to normal view

### Actual Behavior

- Spinner overlay blocks tap events
- Fullscreen toggle becomes unresponsive
- User is trapped in fullscreen with spinning indicator
- Only escape: browser back button or hardware back gesture

## Hypothesis

### H1: Z-Index Stacking Issue
The spinner overlay likely has a higher z-index than the fullscreen toggle listener, preventing tap events from reaching the toggle handler.

```
Expected:
  Fullscreen toggle listener (z-index: 1000) ← receives taps
  Spinner overlay (z-index: 999)

Actual:
  Spinner overlay (z-index: 1000) ← blocks taps
  Fullscreen toggle listener (z-index: 999)
```

### H2: Event Listener Disabled During Loading
The fullscreen toggle event listener may be conditionally disabled when the video is in "loading" or "buffering" state:
```javascript
// Problematic pattern
if (!isLoading) {
  element.addEventListener('click', toggleFullscreen);
}
```

### H3: Pointer-Events CSS
The spinner overlay may have `pointer-events: auto` which captures all click/tap events, while the underlying toggle has `pointer-events: none` during loading state.

### H4: Overlay Covers Entire Screen
The spinner may render as a full-screen overlay without a click-through handler, completely blocking interaction with underlying elements.

## Files to Investigate

| File | Purpose |
|------|---------|
| `frontend/src/modules/Player/VideoPlayer.jsx` | Video player component |
| `frontend/src/modules/Player/SinglePlayer.jsx` | Single video wrapper |
| `frontend/src/modules/Player/Player.jsx` | Main player container |
| `frontend/src/modules/Player/*.scss` | Player styling (z-index, pointer-events) |

## Proposed Test Strategy

1. **Plex Proxy Toggle**: Create test harness that can simulate network stall
   - Intercept Plex stream requests
   - Delay or block responses to trigger spinner
2. **Test Flow**:
   - Start video playback
   - Enter fullscreen mode
   - Trigger network stall (enable proxy block)
   - Verify spinner appears
   - Tap video area
3. **Assertion**: Video should exit fullscreen mode despite spinner presence

## Proposed Fix Direction

### Option A: Z-Index Fix
Ensure fullscreen toggle listener has higher z-index than spinner:
```scss
.fullscreen-toggle-area {
  z-index: 10000;  // Above spinner
  position: absolute;
  inset: 0;
  pointer-events: auto;
}

.loading-spinner {
  z-index: 9999;  // Below toggle
  pointer-events: none;  // Allow click-through
}
```

### Option B: Event Propagation
Add click handler to spinner that propagates to toggle:
```javascript
<div className="spinner" onClick={(e) => {
  // Allow event to bubble to fullscreen toggle
  e.stopPropagation = () => {};  // Prevent stopping
}}>
```

### Option C: Dedicated Exit Button
Add a visible "Exit Fullscreen" button on the spinner overlay:
```jsx
{isLoading && isFullscreen && (
  <button className="exit-fullscreen-btn" onClick={exitFullscreen}>
    Exit Fullscreen
  </button>
)}
```

### Option D: Separate Click Zones
Render the fullscreen toggle as a sibling (not child) of the spinner, ensuring both can receive events:
```jsx
<div className="player-container">
  <div className="video-element" />
  <div className="fullscreen-toggle-layer" onClick={toggleFullscreen} />
  <div className="spinner-layer">{isLoading && <Spinner />}</div>
</div>
```

**Recommendation**: Option A (z-index + pointer-events fix) is the simplest solution. The toggle should always be responsive regardless of loading state.
