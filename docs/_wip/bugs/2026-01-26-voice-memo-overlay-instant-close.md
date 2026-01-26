# Bug Report: Voice Memo Overlay Instantly Closes After Opening

**Date:** 2026-01-26
**Severity:** High
**Component:** `VoiceMemoOverlay.jsx`
**Status:** Fixed (2026-01-26)

---

## Summary

When the voice memo overlay opens automatically from the "video end" prompt (15-minute rule), it flashes on screen for ~127ms and then immediately closes without any user interaction. This prevents users from recording voice memos at the end of their fitness sessions.

---

## Reproduction Steps

1. Start a fitness session that exceeds the voice memo prompt threshold (default 8 minutes)
2. Do not record any voice memos during the session
3. Click the close button on the fitness player footer
4. **Expected:** Voice memo overlay opens and stays open for recording
5. **Actual:** Voice memo overlay flashes briefly and closes immediately

---

## Evidence from Production Logs

### Timeline of Events (2026-01-26 13:48:37-38 UTC)

```
13:48:37.971  overlay-open-capture     memoId=null, autoAccept=true, fromFitnessVideoEnd=true
13:48:38.006  paused-visibility        Video paused at 3:23
13:48:38.076  overlay-dimensions       x=0, y=0, width=1382, height=777.7
13:48:38.077  panel-dimensions         x=481, y=198.9, width=420, height=380
13:48:38.098  overlay-close-request    mode=redo, wasRecording=false, recorderState=idle, reason=user_cancel
13:48:38.104  video.unmounted          Component unmounted
13:48:38.105  tick_timer.stopped       Session ended
```

**Key observation:** Only **127ms** elapsed between overlay open and close.

### Raw Log Evidence

**Overlay Open:**
```json
{
  "ts": "2026-01-26T13:48:37.971Z",
  "level": "info",
  "event": "playback.voice-memo",
  "data": {
    "payload": {
      "event": "overlay-open-capture",
      "memoId": null,
      "autoAccept": true,
      "fromFitnessVideoEnd": true
    }
  },
  "context": {
    "source": "FitnessContext",
    "sessionId": "fs_20260126052200"
  }
}
```

**Overlay Close (no user interaction):**
```json
{
  "ts": "2026-01-26T13:48:38.098Z",
  "level": "info",
  "event": "playback.voice-memo",
  "data": {
    "payload": {
      "event": "overlay-close-request",
      "mode": "redo",
      "memoId": null,
      "wasRecording": false,
      "wasProcessing": false,
      "recorderState": "idle",
      "reason": "user_cancel"
    }
  },
  "context": {
    "source": "VoiceMemoOverlay"
  }
}
```

**Critical observation:** The close reason is `user_cancel` but no user action occurred. The `wasRecording: false` and `recorderState: idle` indicate the recording never even started.

---

## Root Cause Analysis

### Primary Cause: Overlay Opens Mid-Click

The close button uses `onPointerDown` for touch responsiveness. When the overlay opens during the pointer-down phase of a click, the subsequent pointer-up and click events land on the newly-rendered overlay backdrop, triggering an immediate close.

**Note:** The commented-out `stopEventPropagation` in commit `a1b3583d` was a red herring—re-enabling it would break intentional backdrop clicks. See "Rejected Approaches" below.

### Contributing Factor: Disabled Event Propagation (Not Root Cause)

In commit `a1b3583d` (2026-01-08), the `stopEventPropagation` handlers were **commented out**:

**File:** `frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.jsx`

```javascript
// Lines 488-491 - Handler is a NO-OP
const stopEventPropagation = useCallback((e) => {
 // e.stopPropagation();
 //   e.nativeEvent?.stopImmediatePropagation?.();
}, []);

// Lines 494-502 - Propagation blocking also commented out
const handleBackdropClick = useCallback((e) => {
  // Stop propagation to prevent triggering fullscreen toggle on player underneath
//  e.stopPropagation();
//  e.nativeEvent?.stopImmediatePropagation?.();
  // Only close if clicking directly on backdrop, not on panel or its children
  if (e.target === overlayRef.current) {
    handleClose();
  }
}, [handleClose]);
```

Despite having these handlers attached to multiple events (lines 557-570), they do nothing:

```jsx
<div
  ref={overlayRef}
  className={`voice-memo-overlay voice-memo-overlay--${mode}`}
  onClick={handleBackdropClick}
  onClickCapture={stopEventPropagation}      // NO-OP
  onMouseDown={stopEventPropagation}          // NO-OP
  onMouseDownCapture={stopEventPropagation}   // NO-OP
  onMouseUp={stopEventPropagation}            // NO-OP
  onPointerDown={stopEventPropagation}        // NO-OP
  onPointerDownCapture={stopEventPropagation} // NO-OP
  onPointerUp={stopEventPropagation}          // NO-OP
  ...
>
```

### Secondary Cause: Close Button Uses `onPointerDown`

The fitness player footer close button uses `onPointerDown` instead of `onClick`:

**File:** `frontend/src/modules/Fitness/FitnessPlayerFooter/FitnessPlayerFooterControls.jsx`

```javascript
// Lines 77-81
const handleClosePointerDown = useCallback((e) => {
  if (closeInvokedRef.current) return;
  closeInvokedRef.current = true;
  onClose?.(e);  // Opens voice memo overlay immediately
}, [onClose]);

// Line 253 - Uses pointerdown, not click
<button
  type="button"
  onPointerDown={handleClosePointerDown}
  className="control-button close-button"
  aria-label="Close"
>
```

### Event Flow Leading to Bug

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. User presses close button (pointerdown at ~37.850)                   │
│    └─> handleClosePointerDown fires                                     │
│        └─> onClose() called                                             │
│            └─> openVoiceMemoCapture() in FitnessPlayer                  │
│                └─> Voice memo overlay renders via portal to body        │
├─────────────────────────────────────────────────────────────────────────┤
│ 2. Overlay now covers entire viewport (logged at 37.971)                │
│    └─> position: fixed; inset: 0; z-index: 2000                         │
│    └─> Panel centered at (481, 199) with size 420x380                   │
├─────────────────────────────────────────────────────────────────────────┤
│ 3. User releases (pointerup at ~38.098)                                 │
│    └─> Pointer is at footer position (y > 700)                          │
│    └─> Footer position is OUTSIDE panel but INSIDE overlay backdrop     │
│    └─> Event dispatched to overlay backdrop element                     │
├─────────────────────────────────────────────────────────────────────────┤
│ 4. handleBackdropClick fires                                            │
│    └─> e.target === overlayRef.current (TRUE - clicked on backdrop)     │
│    └─> handleClose() called                                             │
│    └─> Overlay closes (logged at 38.098)                                │
├─────────────────────────────────────────────────────────────────────────┤
│ 5. Cascade effect                                                       │
│    └─> FitnessPlayer effect detects overlay close                       │
│    └─> pendingCloseRef.current is true                                  │
│    └─> executeClose() runs                                              │
│    └─> Video unmounts (logged at 38.104)                                │
└─────────────────────────────────────────────────────────────────────────┘
```

### Visual Representation of Click Position

```
┌────────────────────────────────────────────────────────────┐
│                    OVERLAY BACKDROP                         │
│                    (z-index: 2000)                          │
│                                                             │
│         ┌─────────────────────────────────┐                │
│         │                                 │                │
│         │          PANEL                  │                │
│         │     (481, 199) to (901, 579)    │                │
│         │                                 │                │
│         │     "How did it go?"            │                │
│         │                                 │                │
│         └─────────────────────────────────┘                │
│                                                             │
│                                                             │
│  ───────────────────────────────────────────────────────── │
│  FOOTER CONTROLS (underneath, but click starts here)       │
│                          [X] <-- Close button clicked       │
│                               at y ≈ 700+                   │
└────────────────────────────────────────────────────────────┘

When overlay appears, the click release position (y > 700) is:
- OUTSIDE the panel (ends at y = 579)
- INSIDE the overlay backdrop (covers full viewport)
- Results in handleBackdropClick firing with e.target === overlay
```

---

## Code References

| File | Line | Description |
|------|------|-------------|
| `VoiceMemoOverlay.jsx` | ~150 | `hadPointerDownRef` - tracks pointerdown on overlay |
| `VoiceMemoOverlay.jsx` | ~358 | Effect to reset ref on open/close |
| `VoiceMemoOverlay.jsx` | ~505 | `handleOverlayPointerDown` - sets ref and logs |
| `VoiceMemoOverlay.jsx` | ~519 | `handleBackdropClick` - checks ref before closing |
| `VoiceMemoOverlay.jsx` | ~590 | `onPointerDown={handleOverlayPointerDown}` binding |
| `FitnessPlayerFooterControls.jsx` | 77-81 | Close button uses `onPointerDown` (unchanged) |
| `FitnessPlayerFooterControls.jsx` | 253 | Close button binding (unchanged) |
| `FitnessPlayer.jsx` | 883-893 | 15-minute rule triggers overlay on close |
| `FitnessPlayer.jsx` | 903-915 | Effect that closes player when overlay closes |
| `VoiceMemoOverlay.scss` | 5-8 | Full viewport coverage with `position: fixed; inset: 0` |

---

## Related Context: Previous Session Error

The logs show an earlier error that may have contributed to state issues:

```
13:47:42.755  overlay-close-request    User manually closed overlay while recording
13:47:43.895  recorder-error           code=upload_failed, HTTP 400
```

The recorder error state from the previous attempt may not have been properly cleared, though the close log shows `recorderState: idle` indicating this was reset.

---

## Implemented Fix

### Approach: Pointerdown Tracking

The fix tracks whether a `pointerdown` event occurred on the overlay since it opened. A valid backdrop click must have its `pointerdown` inside the overlay—the problematic click has its `pointerdown` on the close button (outside the overlay).

**Why this approach:**
- More robust than time-based guards (no magic numbers, works on all devices)
- Directly addresses the root cause: the click's `pointerdown` originated outside the overlay
- Preserves `onPointerDown` on close button for touch responsiveness

### Code Changes

**File:** `frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.jsx`

```javascript
// 1. Add ref to track pointerdown (line ~150)
const hadPointerDownRef = React.useRef(false);

// 2. Reset ref when overlay opens/closes (line ~358)
useEffect(() => {
  hadPointerDownRef.current = false;
}, [overlayState?.open]);

// 3. Handler to set ref on pointerdown (line ~505)
const handleOverlayPointerDown = useCallback((e) => {
  if (!hadPointerDownRef.current) {
    logVoiceMemo('overlay-pointerdown-received', {
      target: e.target?.className || 'unknown'
    });
  }
  hadPointerDownRef.current = true;
  stopEventPropagation(e);
}, [logVoiceMemo, stopEventPropagation]);

// 4. Guard in handleBackdropClick (line ~519)
const handleBackdropClick = useCallback((e) => {
  if (!hadPointerDownRef.current) {
    logVoiceMemo('backdrop-click-ignored', {
      reason: 'no_pointerdown_on_overlay',
      clickTarget: e.target?.className || 'unknown'
    });
    return;
  }
  if (e.target === overlayRef.current) {
    handleClose();
  }
}, [handleClose, logVoiceMemo]);

// 5. Use handler on overlay div (line ~590)
onPointerDown={handleOverlayPointerDown}
```

### Event Flow After Fix

```
BEFORE (bug):
1. pointerdown on close button → overlay opens
2. pointerup on backdrop
3. click on backdrop → handleBackdropClick → closes ❌

AFTER (fix):
1. pointerdown on close button → overlay opens, hadPointerDownRef = false
2. pointerup on backdrop
3. click on backdrop → handleBackdropClick checks ref → false → ignored ✅

Normal backdrop click:
1. pointerdown on backdrop → hadPointerDownRef = true
2. pointerup on backdrop
3. click on backdrop → ref is true → closes ✅
```

### New Telemetry Events

| Event | When | Purpose |
|-------|------|---------|
| `backdrop-click-ignored` | Click blocked by fix | Confirms fix is working |
| `overlay-pointerdown-received` | First valid pointerdown after open | Shows when backdrop dismissal becomes enabled |

**Expected logs when fix blocks instant close:**
```
13:48:37.971  overlay-open-capture       fromFitnessVideoEnd=true
13:48:38.098  backdrop-click-ignored     reason=no_pointerdown_on_overlay
```

---

## Rejected Approaches

### Option A: Re-enable stopPropagation (REJECTED)

The original proposal to uncomment `stopPropagation()` and `stopImmediatePropagation()` would have **broken intentional backdrop clicks**.

**Why it fails:** The `onClickCapture` handler fires during capture phase, before `onClick` (bubble phase). Calling `stopImmediatePropagation()` in capture would prevent ALL click handlers on that element—including the `handleBackdropClick` that handles intentional dismissal.

**Investigation:** Commit `a1b3583d` added the handlers but with calls already commented out. The commit message says "added comprehensive event propagation blocking" but the code was disabled from the start—likely because testing revealed it broke backdrop clicks.

### Option B: Timestamp Guard (VIABLE BUT NOT CHOSEN)

A 200ms delay would work but:
- Magic numbers are fragile
- Could fail on slow devices
- Doesn't directly address root cause

### Option C: Change to onClick (REJECTED)

Changing close button from `onPointerDown` to `onClick` would add ~300ms latency on touch devices, degrading UX.

---

## Testing Checklist

- [ ] Overlay stays open when triggered by 15-minute rule
- [ ] Overlay still closes when clicking backdrop intentionally
- [ ] Overlay still closes on Escape key
- [ ] Close button (X) in overlay header still works
- [ ] Recording starts automatically in redo mode
- [ ] No regressions in manual voice memo capture flow
- [ ] Verify `backdrop-click-ignored` appears in logs when fix blocks instant close
- [ ] Verify `overlay-pointerdown-received` appears on first valid pointerdown

---

## Commit History

| Commit | Date | Description |
|--------|------|-------------|
| `a1b3583d` | 2026-01-08 | Commented out stopEventPropagation (introduced bug) |
| `361cdf69` | Recent | Added cooldown to stale state reset |
| `fd57998d` | Recent | Added guard for closed overlay in handleRedoCaptured |
| pending | 2026-01-26 | Fix: pointerdown tracking to prevent instant close |
