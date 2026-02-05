# Bug 03: Voice Memo Cursor Visibility

**Date:** 2026-02-04
**Status:** Investigation Complete
**Area:** Fitness App - Voice Memo UX

## Summary

The browser cursor appears on-screen after hitting "Stop" on a recording, which breaks the touch-screen UX.

## Investigation Findings

### VoiceMemoOverlay Component

**Location:** `frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.jsx`

**Cursor Styling in SCSS** (`VoiceMemoOverlay.scss`):
- Line 55: `.voice-memo-overlay__close { cursor: pointer; }`
- Line 245: `.voice-memo-overlay__icon-btn { cursor: pointer; }`
- Line 331: `.voice-memo-overlay__btn { cursor: pointer; }`
- Line 548: `.voice-memo-overlay__record-btn { cursor: pointer; }`

**Critical Finding**: No `cursor: none` styling exists in VoiceMemoOverlay.scss. The overlay explicitly sets `cursor: pointer` on interactive elements.

### Recording Stop Flow

1. User clicks Stop button → `stopRecording()` called (line 727)
2. `useVoiceMemoRecorder` hook processes audio
3. When complete, `onMemoCaptured` callback fires → `handleRedoCaptured()` (line 257)
4. Transitions to review mode with `autoAccept: true`
5. Review countdown (8 seconds) before auto-accept
6. On accept: `onClose?.()` → overlay unmounts

### Parent Component Context

The VoiceMemoOverlay is rendered via `ReactDOM.createPortal()` to `document.body` (line 753). This means cursor styling must come from:

1. **Parent components**: FitnessPlayer or FitnessPlayerOverlay
2. **Global app styling**: Body-level cursor rules
3. **JavaScript-based cursor hiding**: Programmatic style manipulation

### Expected Behavior for Touch-Screen

The Fitness app is designed for touch-screen use. Cursor should be hidden (`cursor: none`) throughout the entire fitness session, not just during recording.

## Hypothesis

### H1: Parent Component Manages Cursor (Most Likely)
The FitnessPlayer or FitnessPlayerOverlay component likely has `cursor: none` on the container. When VoiceMemoOverlay renders to `document.body` via portal, it escapes this styling context.

**Post-recording issue**: When transitioning from recording to review mode, a re-render or state change may cause the parent's cursor hiding to be temporarily removed or overridden.

### H2: Focus Change Triggers Cursor
When recording stops, focus shifts to a new element (review UI). The browser may show the cursor on focus change, and no code re-hides it.

### H3: Portal Renders Outside Cursor-Hidden Context
Since the overlay portals to `document.body`, it's outside any `cursor: none` parent. The explicit `cursor: pointer` on buttons makes the cursor visible.

### H4: Event Listener Cleanup Issue
There may be an event listener that hides cursor during recording, which gets removed on stop. The listener isn't re-attached for the review phase.

## Files to Investigate Further

| File | Purpose |
|------|---------|
| `frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.jsx` | Overlay component |
| `frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.scss` | Overlay styling |
| `frontend/src/modules/Fitness/FitnessPlayer.jsx` | Parent player component |
| `frontend/src/modules/Fitness/FitnessPlayerOverlay/FitnessPlayerOverlay.jsx` | Overlay container |
| `frontend/src/Apps/Fitness/Fitness.scss` | Global fitness app styling |

## Proposed Test Strategy

1. **Trigger recording and stop** in test environment
2. **Computed style check**: After stop event, verify `cursor` computed style on:
   - `document.body`
   - `.voice-memo-overlay` container
   - Any focused element
3. **Assertion**: `cursor` should be `none` on all elements, not `pointer` or `auto`

## Proposed Fix Direction

1. **Add global cursor hiding**: Add `cursor: none` to the VoiceMemoOverlay root container
2. **Override button cursors**: Change `cursor: pointer` to `cursor: none` for touch-screen mode
3. **Conditional styling**: If app supports both mouse and touch modes, use a CSS class or media query:
   ```scss
   .touch-mode .voice-memo-overlay,
   .touch-mode .voice-memo-overlay * {
     cursor: none !important;
   }
   ```
4. **Portal styling**: Since portal renders to body, may need to add cursor hiding to body during overlay display
