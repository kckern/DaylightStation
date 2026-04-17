# Voice Memo: Backdrop Tap Stops and Transcribes (Instead of Discarding)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user taps the overlay backdrop or presses Escape while recording a voice memo, stop and transcribe the audio instead of silently discarding it.

**Architecture:** Two changes in VoiceMemoOverlay.jsx — `handleBackdropClick` and the Escape key handler check `isRecording` and route to `stopRecording()` (the transcription path) instead of `handleClose()` (the destructive cancel path). The existing `handleClose` is unchanged and remains available for explicit cancel actions (X button, error Discard button). A unit test extracts the routing logic into a pure function and verifies all dismiss-action × recorder-state combinations.

**Tech Stack:** React, Jest

**Bug report:** `docs/_wip/bugs/2026-04-16-voice-memo-backdrop-tap-discards-recording.md`

---

### Task 1: Write the dismiss-routing unit test

The core decision — "should this dismiss action stop-and-transcribe or cancel-and-discard?" — is currently implicit in the control flow. We extract it as a pure function and test it first.

**Files:**
- Create: `tests/isolated/domain/fitness/voice-memo-dismiss-routing.unit.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/domain/fitness/voice-memo-dismiss-routing.unit.test.mjs
import { describe, test, expect } from '@jest/globals';

/**
 * dismissAction: 'backdrop' | 'escape' | 'close_button' | 'discard_button'
 * recorderState: 'recording' | 'processing' | 'idle' | 'ready' | 'errored'
 * returns: 'stop_and_transcribe' | 'cancel_and_close'
 */
import { resolveDismissAction } from '../../../../frontend/src/modules/Fitness/player/overlays/voiceMemoOverlayUtils.js';

describe('Voice memo dismiss routing', () => {
  describe('backdrop tap', () => {
    test('stops and transcribes when recording is active', () => {
      expect(resolveDismissAction('backdrop', 'recording')).toBe('stop_and_transcribe');
    });

    test('cancels and closes when idle', () => {
      expect(resolveDismissAction('backdrop', 'idle')).toBe('cancel_and_close');
    });

    test('cancels and closes when ready', () => {
      expect(resolveDismissAction('backdrop', 'ready')).toBe('cancel_and_close');
    });

    test('waits (no action) when processing', () => {
      expect(resolveDismissAction('backdrop', 'processing')).toBe('cancel_and_close');
    });
  });

  describe('escape key', () => {
    test('stops and transcribes when recording is active', () => {
      expect(resolveDismissAction('escape', 'recording')).toBe('stop_and_transcribe');
    });

    test('cancels and closes when idle', () => {
      expect(resolveDismissAction('escape', 'idle')).toBe('cancel_and_close');
    });
  });

  describe('close button (X)', () => {
    test('always cancels — even when recording', () => {
      expect(resolveDismissAction('close_button', 'recording')).toBe('cancel_and_close');
    });

    test('cancels when idle', () => {
      expect(resolveDismissAction('close_button', 'idle')).toBe('cancel_and_close');
    });
  });

  describe('discard button', () => {
    test('always cancels — even when recording', () => {
      expect(resolveDismissAction('discard_button', 'recording')).toBe('cancel_and_close');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/domain/fitness/voice-memo-dismiss-routing.unit.test.mjs --no-cache`
Expected: FAIL — module not found (`voiceMemoOverlayUtils.js` doesn't exist yet)

- [ ] **Step 3: Commit**

```bash
git add tests/isolated/domain/fitness/voice-memo-dismiss-routing.unit.test.mjs
git commit -m "test: add failing test for voice memo dismiss routing logic"
```

---

### Task 2: Implement the dismiss-routing function

**Files:**
- Create: `frontend/src/modules/Fitness/player/overlays/voiceMemoOverlayUtils.js`

- [ ] **Step 1: Create the utility**

```javascript
// frontend/src/modules/Fitness/player/overlays/voiceMemoOverlayUtils.js

/**
 * Determines what action a dismiss gesture should take based on the
 * source of the dismiss and the current recorder state.
 *
 * @param {'backdrop' | 'escape' | 'close_button' | 'discard_button'} dismissSource
 * @param {'recording' | 'processing' | 'idle' | 'ready' | 'errored'} recorderState
 * @returns {'stop_and_transcribe' | 'cancel_and_close'}
 */
export function resolveDismissAction(dismissSource, recorderState) {
  // Backdrop and Escape should preserve the recording when one is active.
  // Close button and Discard button are explicit cancel actions.
  if (
    (dismissSource === 'backdrop' || dismissSource === 'escape') &&
    recorderState === 'recording'
  ) {
    return 'stop_and_transcribe';
  }
  return 'cancel_and_close';
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx jest tests/isolated/domain/fitness/voice-memo-dismiss-routing.unit.test.mjs --no-cache`
Expected: All 7 tests PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/voiceMemoOverlayUtils.js
git commit -m "feat: add resolveDismissAction utility for voice memo dismiss routing"
```

---

### Task 3: Wire backdrop tap to stop-and-transcribe

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/VoiceMemoOverlay.jsx:549-565` (handleBackdropClick)

- [ ] **Step 1: Add the import**

At the top of `VoiceMemoOverlay.jsx`, after the existing imports (around line 10), add:

```javascript
import { resolveDismissAction } from './voiceMemoOverlayUtils.js';
```

- [ ] **Step 2: Update handleBackdropClick**

Replace the `handleBackdropClick` function (lines 550–565):

```javascript
  // Handle backdrop click (click outside panel to close)
  const handleBackdropClick = useCallback((e) => {
    // Bug fix 2026-01-26: Ignore clicks if no pointerdown occurred on the overlay
    // This prevents instant close when overlay opens mid-click (e.g., triggered by
    // pointerdown on close button, overlay opens, pointerup/click lands on backdrop)
    if (!hadPointerDownRef.current) {
      logVoiceMemo('backdrop-click-ignored', {
        reason: 'no_pointerdown_on_overlay',
        clickTarget: e.target?.className || 'unknown'
      });
      return;
    }
    // Only close if clicking directly on backdrop, not on panel or its children
    if (e.target === overlayRef.current) {
      const action = resolveDismissAction('backdrop', recorderState);
      if (action === 'stop_and_transcribe') {
        logVoiceMemo('backdrop-stop-and-transcribe', { recorderState });
        stopRecording();
      } else {
        handleClose();
      }
    }
  }, [handleClose, logVoiceMemo, recorderState, stopRecording]);
```

- [ ] **Step 3: Verify no syntax errors**

Run: `npx -y acorn --ecma2020 --module --allow-import-assertions frontend/src/modules/Fitness/player/overlays/VoiceMemoOverlay.jsx 2>&1 | tail -5`

If acorn is not available, use the existing build:
Run: `cd /opt/Code/DaylightStation && npx vite build --mode development 2>&1 | tail -10`
Expected: No errors referencing VoiceMemoOverlay

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/VoiceMemoOverlay.jsx
git commit -m "fix: backdrop tap stops and transcribes active voice memo recording

Previously, tapping the overlay backdrop while recording would silently
discard the audio. Now it stops the recording and sends it to Whisper
for transcription, matching the behavior of tapping the stop button.

Bug: docs/_wip/bugs/2026-04-16-voice-memo-backdrop-tap-discards-recording.md"
```

---

### Task 4: Wire Escape key to stop-and-transcribe

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/VoiceMemoOverlay.jsx:567-582` (keyboard handler)

- [ ] **Step 1: Update the Escape handler**

Replace the keyboard effect (lines 568–582):

```javascript
  // Keyboard shortcuts
  useEffect(() => {
    if (!overlayState?.open) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        const action = resolveDismissAction('escape', recorderState);
        if (action === 'stop_and_transcribe') {
          logVoiceMemo('escape-stop-and-transcribe', { recorderState });
          stopRecording();
        } else {
          handleClose();
        }
      }
      if (overlayState.mode === 'redo' && isRecording && (e.key === ' ' || e.key === 'Spacebar')) {
        e.preventDefault();
        stopRecording();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [overlayState?.open, overlayState?.mode, isRecording, handleClose, stopRecording, recorderState, logVoiceMemo]);
```

Note: `recorderState` and `logVoiceMemo` are added to the dependency array.

- [ ] **Step 2: Verify no syntax errors**

Run: `cd /opt/Code/DaylightStation && npx vite build --mode development 2>&1 | tail -10`
Expected: No errors referencing VoiceMemoOverlay

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/VoiceMemoOverlay.jsx
git commit -m "fix: Escape key stops and transcribes active voice memo recording

Same fix as the backdrop tap — Escape during active recording now
stops and transcribes instead of silently discarding the audio."
```

---

### Task 5: Manual smoke test

**Files:** None (verification only)

- [ ] **Step 1: Start the dev server**

Check if already running:
```bash
ss -tlnp | grep 3112
```

If not running:
```bash
cd /opt/Code/DaylightStation && nohup node backend/index.js > /tmp/backend-dev.log 2>&1 &
```

- [ ] **Step 2: Test backdrop tap during recording**

1. Open fitness app in browser at the configured dev port
2. Start a fitness session (or navigate to one that allows voice memos)
3. Open the voice memo overlay (tap record button)
4. Wait for recording to auto-start (mic level indicator should be active)
5. Speak a short phrase
6. Tap the dark backdrop area outside the panel
7. **Verify:** Recording stops, "Transcribing..." spinner appears, transcript shows, overlay transitions to review mode
8. Accept or dismiss the review

- [ ] **Step 3: Test Escape during recording**

1. Open the voice memo overlay again
2. Wait for recording to auto-start
3. Speak a short phrase
4. Press Escape
5. **Verify:** Same behavior as backdrop tap — stops, transcribes, shows review

- [ ] **Step 4: Test X button still cancels**

1. Open the voice memo overlay
2. Wait for recording to auto-start
3. Click the X (close) button in the overlay header
4. **Verify:** Recording is cancelled, overlay closes immediately, no transcription

- [ ] **Step 5: Test Discard button still cancels**

1. Open the voice memo overlay
2. Wait for recording
3. If an error occurs (or simulate one), the "Discard" button appears
4. Click Discard
5. **Verify:** Recording is discarded, overlay closes

- [ ] **Step 6: Check logs for new events**

```bash
sudo docker logs daylight-station --since 5m 2>&1 | grep -E 'backdrop-stop|escape-stop' | head -10
```

Expected: See `backdrop-stop-and-transcribe` or `escape-stop-and-transcribe` events when you used those dismiss paths.

- [ ] **Step 7: Commit (if any adjustments were needed)**

If no changes were needed, skip this step.

---

### Task 6: Run existing tests

**Files:** None (verification only)

- [ ] **Step 1: Run the voice memo unit tests**

```bash
npx jest tests/isolated/domain/fitness/ --no-cache
```

Expected: All tests pass, including the new dismiss routing test and the existing stale state cooldown test.

- [ ] **Step 2: Run the full isolated test suite**

```bash
npx jest tests/isolated/ --no-cache 2>&1 | tail -20
```

Expected: No regressions.
