# FamilySelector Spin Animation Broken

**Date:** 2026-02-15
**Status:** Investigating
**Component:** `frontend/src/modules/AppContainer/Apps/FamilySelector/FamilySelector.jsx`

## Symptom

Pressing SPACE to spin the roulette wheel causes the wheel to **snap instantly** to its final position. No smooth spin animation occurs. The winner modal appears 8 seconds later (after the `setTimeout` fires), making it look like the app hangs.

## Root Cause

CSS transitions require the browser to paint the element with the transition property applied **before** the transitioned property changes. React batches state updates, so `setWheelState(SPINNING)` (which sets `transition: transform 8000ms...`) and `setRotation(newAngle)` (which sets `transform: rotate(1830deg)`) originally happened in the same render frame. The browser saw both changes atomically — there was no "before" state to animate from.

### Fix Attempt 1: Single `requestAnimationFrame` (FAILED)

Separated the two state updates: set `SPINNING` synchronously, then `setRotation` inside a single `requestAnimationFrame`.

**Result:** RAF fired only 4ms later — before the browser actually painted. Both changes still landed before first paint. Animation still instant.

**Evidence (console logs):**
```
[8185] setState → SPINNING (transition applied, rotation unchanged)
[8185] RENDER RouletteWheel — rotation: 0, isSpinning: true, transition: transform 8000ms...
[8189] setRotation: 0 → 1110          ← only 4ms later, before paint
[8189] RENDER RouletteWheel — rotation: 1110, isSpinning: true, transition: transform 8000ms...
```

### Fix Attempt 2: Double `requestAnimationFrame` (TESTING)

Uses two nested RAFs: the first RAF fires when the browser is ready to paint (but hasn't yet), the second RAF fires after the paint actually commits. This guarantees the transition property is painted before the transform changes.

```js
setWheelState(WHEEL_STATE.SPINNING);     // render 1: transition applied, rotation unchanged
requestAnimationFrame(() => {             // browser about to paint render 1
  requestAnimationFrame(() => {           // browser HAS painted render 1
    setRotation(prev => prev + angle);    // render 2: rotation changes, transition animates
  });
});
```

## Additional Issues Found During Audit

### 1. No Re-spin (State Machine Bug)
State goes `IDLE → SPINNING → RESULT` with no path back to `IDLE`. The keyboard handler only fires when `wheelState === IDLE`. After one spin, the wheel is permanently stuck.

**Location:** `FamilySelector.jsx:283-297`

### 2. Dead CSS / Inline Style Conflict
SCSS lines 80-89 define `.avatar-wrapper` transform/transition rules, but these are **entirely overridden** by inline styles in JSX. The CSS uses `4000ms` while inline uses `8000ms` — if CSS ever won, avatars would desync from the wheel.

**Location:** `FamilySelector.scss:80-89` vs `FamilySelector.jsx:134-139`

### 3. Pointer Flick Duration Math Error
```js
// Current (wrong — produces ~180,000ms for typical values):
const segmentPassDuration = (SPIN_CONFIG.durationMs / ((rotation || 1) / 360)) * (360 / members.length);

// Correct:
const segmentPassDuration = (SPIN_CONFIG.durationMs * 360) / (rotation * members.length);
```

**Location:** `FamilySelector.jsx:204`

### 4. Dead Code: `getInstructionText()`
Function defined (lines 331-339) but never called in JSX. The `.wheel-instructions` CSS class is also unused.

### 5. SVG `transform-origin` Fragility
`.wheel-segments` uses `transform-origin: center center`, resolved from `<g>` bounding box. Should be explicit `200px 200px` (half the 400px viewBox).

**Location:** `FamilySelector.scss:77`

### 6. `setTimeout` vs `transitionend`
Uses `setTimeout(fn, 8000)` to detect spin end. If timeout fires slightly before CSS transition finishes, setting `transition: none` mid-animation causes a visual snap. Should use `transitionend` event.

**Location:** `FamilySelector.jsx:294-296`

## Test Route

```
http://localhost:3111/tv/app/family-selector
```

The FHE list Spotlight item (`app:family-selector/soren`) also loads this component via the TV app's menu navigation.
