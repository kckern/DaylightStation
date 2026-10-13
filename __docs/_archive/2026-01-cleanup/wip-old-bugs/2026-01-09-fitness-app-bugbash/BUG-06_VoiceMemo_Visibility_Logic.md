# BUG-06: Voice Memo Visibility Logic

**Date Reported:** 2026-01-09  
**Category:** 🎙️ Feature: Voice Memo  
**Priority:** High  
**Status:** Open

---

## Summary

The Voice Memo button exists in "Fitness Show" view, but pressing it does nothing. Voice Memo functionality only works when inside the "Fitness Player" view.

## Expected Behavior

Voice Memo must be globally invocable. It should function immediately when triggered from "Fitness Show" or any other part of the app.

## Current Behavior

Voice Memo button is visible in Fitness Show but non-functional. The modal/recorder may be bound specifically to the Player view hierarchy.

---

## Technical Analysis

### Relevant Components

| File | Purpose |
|------|---------|
| [`FitnessVoiceMemo.jsx`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/FitnessSidebar/FitnessVoiceMemo.jsx) | Voice memo sidebar button component |
| [`VoiceMemoOverlay.jsx`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.jsx) | Voice memo recording overlay |
| [`VoiceMemoManager.js`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/hooks/fitness/VoiceMemoManager.js) | Voice memo state management |
| [`FitnessContext.jsx`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/context/FitnessContext.jsx) | Context providing voice memo functions |

### Root Cause

In `FitnessVoiceMemo.jsx`, the button calls context functions:

```jsx
const handleStartRecording = useCallback(() => {
  fitnessCtx?.openVoiceMemoCapture?.(null);
}, [fitnessCtx]);
```

The `openVoiceMemoCapture` function is provided by `FitnessContext`, but the actual `VoiceMemoOverlay` component is only rendered inside `FitnessPlayer.jsx`.

The overlay has a z-index hierarchy issue (as mentioned in bug report):
- The modal may be rendered within the Player's DOM subtree
- When viewing Fitness Show (without Player mounted), the overlay target doesn't exist

### Evidence

In `VoiceMemoOverlay.jsx`, the component is a standard React component without portal usage:

```jsx
// VoiceMemoOverlay renders directly in its parent's DOM tree
const VoiceMemoOverlay = ({
  overlayState,
  voiceMemos,
  onClose,
  // ...
}) => {
  // No React.createPortal to render at document root
  return (
    <div className="voice-memo-overlay">
      {/* ... */}
    </div>
  );
};
```

---

## Recommended Fix

### Option A: Portal-Based Global Overlay (Preferred)

Render VoiceMemoOverlay using React portal to document body:

```jsx
// In VoiceMemoOverlay.jsx
import ReactDOM from 'react-dom';

const VoiceMemoOverlay = ({ overlayState, ...props }) => {
  if (!overlayState?.open) return null;
  
  return ReactDOM.createPortal(
    <div className="voice-memo-overlay">
      {/* existing overlay content */}
    </div>,
    document.body
  );
};
```

### Option B: Lift Overlay to App Root Level

Move `VoiceMemoOverlay` rendering from `FitnessPlayer.jsx` to `FitnessApp.jsx`:

```jsx
// In FitnessApp.jsx
const FitnessApp = () => {
  const fitnessCtx = useFitnessContext();
  
  return (
    <FitnessProvider>
      <div className="fitness-app">
        {/* Existing app content */}
        {currentView === 'show' && <FitnessShow />}
        {currentView === 'player' && <FitnessPlayer />}
        
        {/* Global overlay - always available */}
        <VoiceMemoOverlay 
          overlayState={fitnessCtx.voiceMemoOverlayState}
          {...voiceMemoProps}
        />
      </div>
    </FitnessProvider>
  );
};
```

### Option C: Lazy Mount with Context-Controlled Visibility

Ensure overlay is always mounted but controlled via context:

```jsx
// In FitnessContext.jsx - ensure overlay state is managed globally
const [voiceMemoOverlayState, setVoiceMemoOverlayState] = useState({
  open: false,
  mode: null,
  memoId: null,
});

const openVoiceMemoCapture = useCallback((options) => {
  setVoiceMemoOverlayState({
    open: true,
    mode: 'capture',
    ...options
  });
}, []);
```

---

## Z-Index Considerations

The Voice Memo overlay needs appropriate z-index to appear above all content:

```scss
.voice-memo-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--fitness-voicememo-overlay-z, 1000); // Above everything
  
  // Ensure clicks don't pass through
  pointer-events: auto;
}
```

---

## Files to Modify

1. **Primary**: [`VoiceMemoOverlay.jsx`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.jsx) - Add portal rendering
2. **Alternative**: [`FitnessApp.jsx`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/Apps/FitnessApp.jsx) - Lift overlay to app root
3. **Maybe**: [`VoiceMemoOverlay.scss`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.scss) - Update z-index if needed

---

## Verification Steps

1. Open Fitness App (Fitness Show view)
2. Tap Voice Memo button
3. Verify overlay appears and recording starts
4. Record a memo
5. Verify transcription completes
6. Navigate to Player view
7. Verify Voice Memo still works in Player context
8. Verify memo count badge updates correctly in both views

---

## Test Matrix

| Entry Point | Should Work | Currently Works |
|-------------|-------------|-----------------|
| Fitness Show | ✓ | ✗ |
| Fitness Player | ✓ | ✓ |
| Plugin View | ✓ | TBD |
| Chart App | ✓ | TBD |

---

*For testing, assign to: QA Team*  
*For development, assign to: Frontend Team*
