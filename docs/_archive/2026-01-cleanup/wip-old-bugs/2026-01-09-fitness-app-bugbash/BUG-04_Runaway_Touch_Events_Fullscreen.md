# BUG-04: Runaway Touch Events (Fullscreen Trigger Sensitivity)

**Date Reported:** 2026-01-09  
**Category:** 👆 Interaction & Core Architecture  
**Priority:** High  
**Status:** Open

---

## Summary

Pressing a thumbnail to open "Fitness Player" from "Fitness Show" immediately triggers a second event on the video screen, inadvertently sending the player into Fullscreen mode.

## Expected Behavior

The UI should not accept an interaction on a new layer until the finger is released and pressed again. One touch = one action.

## Current Behavior

When the finger is still "down" during the UI transition (thumbnail → player), the new UI layer (Video Player) accepts the existing touch input as a new click event, triggering fullscreen mode.

> [!NOTE]
> This behavior has also been observed in the Music Player.

---

## Technical Analysis

### Relevant Components

| File | Line Range | Purpose |
|------|------------|---------|
| [`FitnessPlayer.jsx:1292-1328`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/FitnessPlayer.jsx#L1292-L1328) | Touch handler for fullscreen toggle |
| [`FitnessShow.jsx:475-557`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/FitnessShow.jsx#L475-L557) | Episode play handler |
| [`useTouchGestures.js`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/common/hooks/useTouchGestures.js) | Touch gesture handling hook |

### Root Cause

In `FitnessPlayer.jsx`, the `handleGlobalPointerDown` function (lines 1292-1328) processes touch/pointer events:

```javascript
FitnessPlayer.handleGlobalPointerDown(event) {
  // ... guard checks ...
  logFitnessEvent('fullscreen-pointerdown', {
    targetTag: eventTarget?.tagName,
    targetClass: eventTarget?.className,
    eventType: event?.type,
    // ...
  });
  // ... toggle fullscreen logic
}
```

The problem is that when the view transitions from FitnessShow to FitnessPlayer:
1. User touches thumbnail in FitnessShow
2. FitnessShow handles the touch and initiates playback
3. FitnessPlayer mounts and immediately receives the same ongoing touch
4. FitnessPlayer interprets this as a new fullscreen toggle request

### Evidence of Guard Attempts

There is already a `data-no-fullscreen` guard (line 1221):
```javascript
const guardMatch = eventTarget.closest('[data-no-fullscreen]');
```

However, this only prevents fullscreen on specific elements, not on initial mount during an existing touch.

---

## Recommended Fix

### Option A: Touch Debounce on Mount (Preferred)

Add a brief "cool-down" period when FitnessPlayer mounts to ignore touch events:

```javascript
// In FitnessPlayer.jsx
const mountTimeRef = useRef(Date.now());
const MOUNT_DEBOUNCE_MS = 300;

const handleGlobalPointerDown = useCallback((event) => {
  // Ignore touches for 300ms after mount
  if (Date.now() - mountTimeRef.current < MOUNT_DEBOUNCE_MS) {
    return;
  }
  // ... existing logic
}, []);

useEffect(() => {
  mountTimeRef.current = Date.now();
}, []); // Reset on mount
```

### Option B: Require `touchend` Before New Touch

Implement a "One Event Per Touch" rule:

```javascript
// Global touch state manager
const touchStateRef = useRef({ active: false, touchId: null });

const handleTouchStart = useCallback((event) => {
  if (touchStateRef.current.active) {
    // Touch already in progress, ignore new touches until release
    return;
  }
  touchStateRef.current = { active: true, touchId: event.touches[0]?.identifier };
  // ... handle new touch
}, []);

const handleTouchEnd = useCallback((event) => {
  touchStateRef.current = { active: false, touchId: null };
}, []);
```

### Option C: Global Touch Event Coordinator

Create a centralized touch event manager in `useTouchGestures.js`:

```javascript
// In useTouchGestures.js
export const useSingleTouchEnforcement = () => {
  const [isEngaged, setIsEngaged] = useState(false);
  
  useEffect(() => {
    const handleGlobalTouchStart = () => setIsEngaged(true);
    const handleGlobalTouchEnd = () => {
      // Wait for next frame before allowing new touches
      requestAnimationFrame(() => setIsEngaged(false));
    };
    
    window.addEventListener('touchstart', handleGlobalTouchStart, { capture: true });
    window.addEventListener('touchend', handleGlobalTouchEnd, { capture: true });
    
    return () => {
      window.removeEventListener('touchstart', handleGlobalTouchStart, { capture: true });
      window.removeEventListener('touchend', handleGlobalTouchEnd, { capture: true });
    };
  }, []);
  
  return isEngaged;
};
```

---

## Files to Modify

1. **Primary**: [`FitnessPlayer.jsx`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/FitnessPlayer.jsx) 
   - Add mount-time debounce around line 1292
   - Update `handleGlobalPointerDown` function

2. **Secondary**: [`useTouchGestures.js`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/common/hooks/useTouchGestures.js)
   - Add touch state tracking if implementing global solution

3. **Also affected**: Music Player (mentioned in bug) - apply same fix pattern

---

## Verification Steps

1. Open Fitness App and navigate to any show
2. Tap on an episode thumbnail to start playback
3. Verify player opens in normal mode (NOT fullscreen)
4. Release finger
5. Tap on video area
6. Verify fullscreen toggle now works correctly
7. Repeat test for Music Player

---

## Debug Logging

The existing telemetry can help verify the fix:
- Look for `fullscreen-pointerdown` events in logs
- Check timing between mount and first touch event
- Verify `event.type` is properly distinguished

---

*For testing, assign to: QA Team (Touch interaction testing)*  
*For development, assign to: Frontend Team*
