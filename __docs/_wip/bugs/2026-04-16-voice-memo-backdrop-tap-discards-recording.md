# Voice Memo: Backdrop Tap Discards Active Recording Without Transcribing

**Date:** 2026-04-16
**Severity:** Data loss
**Component:** Fitness / VoiceMemoOverlay
**Status:** Open

---

## Summary

When a user taps the overlay backdrop (outside the voice memo panel) while a recording is active, the audio is silently discarded instead of being stopped, transcribed, and saved. The user receives no indication that their recording was lost. This is a data loss bug — 32 seconds of audio were permanently destroyed in the April 16 session.

## Reproduction

1. Start a fitness session
2. Open voice memo overlay (tap record button)
3. Speak for any duration (recording auto-starts)
4. Tap anywhere **outside** the panel (on the dark backdrop)
5. **Expected:** Recording stops, audio is sent to Whisper for transcription, memo is saved
6. **Actual:** Recording is cancelled, audio chunks are discarded, overlay closes, no memo saved

## Evidence from April 16 Session

Session `fs_20260416053658` had three voice memo interactions:

### Memo 1 — 12:44:55 UTC (SUCCESS)
- Overlay opened, recorded ~10s
- User tapped the **record button** (`voice-memo-overlay__record-btn--active`) to stop
- Audio sent to Whisper → transcribed → "I used 30s for the chest presses and 10s for the skull crushers."
- User accepted in review mode

### Memo 2 — 12:51:01 UTC (SUCCESS)
- Overlay opened, recorded ~17s
- User tapped the **record button** to stop
- Audio sent to Whisper → transcribed → "I use 15 lbs for the chest flies and 30 lbs for the tricep presses."
- User accepted in review mode

### Memo 3 — 13:16:56 UTC (DATA LOSS)
- Overlay opened, recorded **32 seconds**
- User tapped the **overlay backdrop** (`voice-memo-overlay voice-memo-overlay--redo`)
- `handleClose()` called `cancelUpload()` → set `cancelledRef = true`, emptied chunks
- `handleClose()` then called `stopRecording()` → `MediaRecorder.onstop` fired, but `cancelledRef` was already true
- `handleRecordingStop` discarded everything: `chunksDiscarded: 1`
- **No Whisper call, no transcription, no memo saved, audio permanently lost**

### Log timeline for the lost recording

```
13:16:56.754  overlay-open-capture         memoId=null, fromFitnessVideoEnd=false
13:16:56.755  voice_memo_overlay_show      mode=capture
13:16:56.760  overlay-redo-start-recording  (stale state reset from 'ready')
13:16:56.762  recording-start-request       preferredMicrophoneId=null
13:16:56.773  recording-started             trackCount=1
              ── 32 seconds of recording ──
13:17:28.201  overlay-pointerdown-received  target="voice-memo-overlay voice-memo-overlay--redo"
13:17:28.577  overlay-close-request         reason=user_cancel, wasRecording=true
13:17:28.577  recording-cancelled           chunksDiscarded=0 (already emptied by cancelUpload)
13:17:28.578  recording-stop-request
13:17:28.578  voice_memo_overlay_close
13:17:28.578  overlay-reset
13:17:28.588  recording-stop-cancelled      chunksDiscarded=1 (async onstop fires, discards remaining)
```

## Root Cause

The cancel-vs-transcribe decision is determined by which code path handles the user's tap:

### Successful path (tap record button)
```
pointerdown on record-btn
  → stopRecording()                   // cancelledRef stays false
  → MediaRecorder.onstop fires
  → handleRecordingStop()             // cancelledRef=false → proceeds
  → builds Blob from chunks
  → base64 encodes
  → POST /api/v1/fitness/voice_memo   // Whisper transcription
  → onMemoCaptured callback
  → overlay transitions to review mode
```

### Destructive path (tap backdrop)
```
pointerdown on overlay backdrop
  → handleBackdropClick()
  → handleClose()
  → cancelUpload()                    // cancelledRef = true, chunks = []
  → stopRecording()
  → MediaRecorder.onstop fires
  → handleRecordingStop()             // cancelledRef=true → DISCARDS, returns
  → no blob, no API call, no memo
  → overlay closes
```

The critical ordering issue is in `handleClose` (VoiceMemoOverlay.jsx:310-344):

```javascript
const handleClose = useCallback(() => {
  // ...
  if (wasRecording || wasProcessing) {
    cancelUpload?.();    // ← sets cancelledRef=true, empties chunks FIRST
  }
  if (wasRecording) {
    stopRecording();     // ← too late, chunks already gone
  }
  // ...
  onClose?.();
}, [/* deps */]);
```

And the guard in `handleRecordingStop` (useVoiceMemoRecorder.js:310-320):

```javascript
const handleRecordingStop = useCallback(async () => {
  if (cancelledRef.current) {        // ← always true when called via handleClose
    chunksRef.current = [];
    cancelledRef.current = false;
    return;                          // ← exits without transcribing
  }
  // ... blob construction, Whisper call, etc.
}, [/* deps */]);
```

## Affected Files

| File | Role |
|------|------|
| `frontend/src/modules/Fitness/player/overlays/VoiceMemoOverlay.jsx:310-344` | `handleClose` — unconditionally cancels before stopping |
| `frontend/src/modules/Fitness/player/overlays/VoiceMemoOverlay.jsx:550-565` | `handleBackdropClick` — delegates to `handleClose` |
| `frontend/src/modules/Fitness/player/panels/hooks/useVoiceMemoRecorder.js:310-320` | `handleRecordingStop` — checks `cancelledRef` gate |
| `frontend/src/modules/Fitness/player/panels/hooks/useVoiceMemoRecorder.js:524-548` | `cancelUpload` — sets the cancel flag and destroys chunks |

## Additional Observations

### Spacebar does the right thing
The keyboard handler (VoiceMemoOverlay.jsx:575-578) calls `stopRecording()` directly when spacebar is pressed during recording — this takes the successful path and transcribes correctly.

### Escape does the wrong thing
The Escape handler (VoiceMemoOverlay.jsx:571-574) calls `handleClose()`, so it also discards active recordings.

### No user feedback
When a recording is discarded via backdrop tap, the overlay simply closes. There is no toast, no confirmation dialog, no indication that audio was lost. The user has no way to know their memo wasn't saved.

### Double-fire on open
The logs show `overlay-redo-start-recording` and `recording-start-request` firing twice on overlay open (stale state reset triggers a second start). The `overlay-open-stale-state-reset-blocked` guard catches the second reset but not the second recording start. This is a separate minor issue but contributes to the confusing log output.

## Proposed Fix

`handleBackdropClick` should **stop and transcribe** when a recording is active, not cancel and discard:

```javascript
const handleBackdropClick = useCallback((e) => {
  if (!hadPointerDownRef.current) return;
  if (e.target === overlayRef.current) {
    if (isRecording) {
      // Stop recording — let it transcribe, then auto-close after review
      stopRecording();
    } else {
      handleClose();
    }
  }
}, [handleClose, isRecording, stopRecording]);
```

Similarly, Escape during active recording should stop-and-transcribe rather than discard:

```javascript
if (e.key === 'Escape') {
  e.preventDefault();
  if (isRecording) {
    stopRecording();   // transcribe, then user can dismiss in review
  } else {
    handleClose();     // no recording active, safe to close
  }
}
```

The existing `handleClose` with `cancelUpload` should only be reachable via an **explicit cancel action** (e.g., a dedicated "Cancel" or "Discard" button), never from backdrop/escape dismissal during active recording.
