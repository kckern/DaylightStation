# Bug Report: Voice Memo Cancel Does Not Abort Background Processing

**Date:** 2026-01-15  
**Severity:** Medium  
**Status:** Open  
**Related code:** [useVoiceMemoRecorder.js](frontend/src/modules/Fitness/FitnessSidebar/useVoiceMemoRecorder.js), [VoiceMemoOverlay.jsx](frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.jsx), [FitnessContext.jsx](frontend/src/context/FitnessContext.jsx)

## Summary

When a user clicks the X button to cancel a voice memo recording, the UI closes but the recording continues to process in the background. After processing completes (2-3 seconds), the review overlay unexpectedly reopens with a keep/toss menu, surprising the user. Additionally, subsequent voice memo attempts may get stuck showing a "Transcribing..." spinner with no way to recover.

## Observed Behavior

### Issue 1: Background Processing After Cancel

**Timeline from production logs (session fs_20260115050555):**

```
13:06:24.049 - Recording started
13:06:26.010 - User clicked X (overlay-close-request)
13:06:26.010 - Overlay closed (overlay-reset)
13:06:26.011 - Recording stop requested
13:06:26.021 - Recording stopped (1 chunk captured)

  ← 2.9 second gap - user believes recording was cancelled →

13:06:28.913 - Whisper transcription called (30KB audio, ~7s duration)
13:06:28.921 - overlay-redo-captured (processing completed)
13:06:28.922 - memo-added (memo_1768482388922_6rf3w2z2r)
13:06:28.923 - overlay-open-review (autoAccept: true)
               ↑ OVERLAY REOPENS with keep/toss UI
13:06:31.028 - User deleted the unwanted memo
```

### Issue 2: Stuck "Transcribing..." State

After the above scenario, user attempts to record another memo:

```
13:45:02.768 - Manual capture opened (overlay-open-capture)
13:45:09.664 - User closed (overlay-close-request)
               ↑ No recording-start or recording-stop events
               ↑ Overlay likely showing stale "transcribing" state
```

**User report:** When reopening voice memo, the overlay was stuck on a "Transcribing..." spinner with no way to interact or cancel.

## Root Cause Analysis

### Problem 1: No Abort Mechanism for Upload Pipeline

In [useVoiceMemoRecorder.js](frontend/src/modules/Fitness/FitnessSidebar/useVoiceMemoRecorder.js#L300-L365):

```javascript
const handleRecordingStop = useCallback(async () => {
  if (!chunksRef.current.length) return;

  // This fires REGARDLESS of whether user cancelled
  logVoiceMemo('recording-stop', { chunks: chunksRef.current.length });

  const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
  // ...
  
  try {
    setUploading(true);
    emitState('processing');
    const base64 = await blobToBase64(blob);
    // ...
    
    // API call with NO abort controller
    const resp = await Promise.race([
      DaylightAPI('api/fitness/voice_memo', payload, 'POST'),
      timeoutPromise  // Only timeout, no cancellation
    ]);
    
    // ...
    
    // This callback triggers overlay-open-review even after close
    if (memo && onMemoCaptured) {
      onMemoCaptured(memo);  // ← Opens review overlay
    }
```

The `recorder.onstop = handleRecordingStop` callback fires unconditionally when `stopRecording()` is called, regardless of whether the stop was from user cancel vs natural completion.

### Problem 2: onMemoCaptured Always Fires

In [VoiceMemoOverlay.jsx](frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.jsx#L210-L236):

```javascript
const handleRedoCaptured = useCallback((memo) => {
  // ...
  const stored = targetId ? (onReplaceMemo?.(targetId, memo) || memo) : (onAddMemo?.(memo) || memo);
  const nextTarget = stored || memo;
  if (nextTarget) {
    // This ALWAYS opens review, even if user cancelled
    onOpenReview?.(nextTarget, { autoAccept: true, fromRecording: true });
  }
}, [...]);
```

### Problem 3: Stale State Between Sessions

The `VoiceMemoOverlay` component manages internal state (`recorderState`) that can become stale:

```javascript
const [recorderState, setRecorderState] = useState('idle'); // idle|recording|processing|ready|error
```

When the overlay closes, this state is not forcibly reset if there's pending async work. On subsequent opens, the component may render based on stale `processing` state.

## Missing Logging

The current logging has gaps that made diagnosis difficult:

### Gap 1: No "cancelled by user" vs "completed naturally" distinction

**Current log:**
```json
{"event": "overlay-close-request", "mode": "redo", "memoId": null}
```

**Needed:**
```json
{"event": "overlay-close-request", "mode": "redo", "memoId": null, "reason": "user_cancel", "wasRecording": true, "hadChunks": true}
```

### Gap 2: No cancellation attempt logged

When user cancels, we should log:
```json
{"event": "recording-cancel-requested", "chunksWillBeDiscarded": 1, "uploadAborted": false}
```

### Gap 3: No stale state detection

When overlay opens with pre-existing processing state:
```json
{"event": "overlay-open", "staleState": "processing", "expectedState": "idle"}
```

### Gap 4: No background completion warning

When upload completes after overlay was closed:
```json
{"event": "recording-upload-complete-orphaned", "memoId": "...", "overlayClosed": true, "elapsedSinceClose": 2913}
```

## Proposed Fix

### 1. Add AbortController to Upload Pipeline

```javascript
// In useVoiceMemoRecorder
const abortControllerRef = useRef(null);

const handleRecordingStop = useCallback(async () => {
  // Create new abort controller for this upload
  abortControllerRef.current = new AbortController();
  const signal = abortControllerRef.current.signal;
  
  // ...
  
  const resp = await DaylightAPI('api/fitness/voice_memo', payload, 'POST', { signal });
  
  // Check if aborted before triggering callback
  if (signal.aborted) {
    logVoiceMemo('recording-upload-aborted');
    return;
  }
  
  if (memo && onMemoCaptured) {
    onMemoCaptured(memo);
  }
}, [...]);

const cancelUpload = useCallback(() => {
  abortControllerRef.current?.abort();
  abortControllerRef.current = null;
  chunksRef.current = [];
  setUploading(false);
  emitState('idle');
  logVoiceMemo('recording-cancelled', { reason: 'user_cancel' });
}, [...]);
```

### 2. Add Cancellation Path to Close Handler

In VoiceMemoOverlay's handleClose:

```javascript
const handleClose = useCallback(() => {
  const wasProcessing = isProcessing || recorderState === 'processing';
  const wasRecording = isRecording;
  
  logVoiceMemo('overlay-close-request', {
    mode: overlayState?.mode,
    memoId: overlayState?.memoId,
    wasRecording,
    wasProcessing,
    reason: 'user_cancel'
  });
  
  // Cancel any in-flight upload
  if (wasProcessing) {
    cancelUpload?.();
  }
  
  // Stop recording if active
  if (wasRecording) {
    stopRecording();
  }
  
  // Force reset recorder state
  setRecorderState('idle');
  
  // Discard pending memo in review mode
  if (overlayState?.mode === 'review' && overlayState?.memoId) {
    onRemoveMemo?.(overlayState.memoId);
  }
  
  onClose?.();
}, [...]);
```

### 3. Guard onMemoCaptured Callback

Check if overlay is still open before triggering:

```javascript
const handleRedoCaptured = useCallback((memo) => {
  // Guard: Don't open review if overlay was already closed
  if (!overlayState?.open) {
    logVoiceMemo('overlay-redo-captured-orphaned', { memoId: memo?.memoId });
    return;
  }
  // ... rest of handler
}, [overlayState?.open, ...]);
```

### 4. Reset State on Overlay Open

```javascript
useLayoutEffect(() => {
  if (overlayState?.open) {
    // Force clean state on open
    if (recorderState !== 'idle' && overlayState?.mode === 'redo') {
      logVoiceMemo('overlay-open-stale-state-reset', {
        previousState: recorderState,
        mode: overlayState?.mode
      });
      setRecorderState('idle');
      autoStartRef.current = false;
    }
  }
}, [overlayState?.open, overlayState?.mode, recorderState]);
```

## Logging Improvements

Add these log points to improve future diagnosis:

### In useVoiceMemoRecorder.js

```javascript
// When chunks are discarded
logVoiceMemo('recording-chunks-discarded', {
  count: chunksRef.current.length,
  reason: 'user_cancel'
});

// When upload is aborted
logVoiceMemo('recording-upload-aborted', {
  reason: 'user_cancel',
  uploadElapsedMs: Date.now() - uploadStartTime
});

// When callback would fire after close
logVoiceMemo('recording-callback-suppressed', {
  reason: 'overlay_closed',
  memoId: memo?.memoId
});
```

### In VoiceMemoOverlay.jsx

```javascript
// Enhanced close logging
logVoiceMemo('overlay-close-request', {
  mode: overlayState?.mode,
  memoId: overlayState?.memoId,
  wasRecording: isRecording,
  wasProcessing: isProcessing,
  recorderState,
  reason: 'user_cancel'
});

// Stale state detection
logVoiceMemo('overlay-open-stale-state', {
  expectedState: 'idle',
  actualState: recorderState,
  mode: overlayState?.mode
});
```

### In FitnessContext.jsx

```javascript
// Track orphaned completions
logVoiceMemo('memo-added-after-close', {
  memoId,
  overlayClosed: !voiceMemoOverlayState.open,
  timeSinceClose: Date.now() - lastCloseTimestamp
});
```

## Test Cases

1. **Cancel during recording** - Click X while recording, verify no review popup
2. **Cancel during processing** - Click X while "Processing..." shown, verify upload aborted
3. **Rapid cancel/reopen** - Cancel then immediately reopen, verify clean state
4. **Background completion after close** - Verify memo is discarded, not shown
5. **Multiple rapid recordings** - Start/cancel several times quickly, verify no state corruption

## Related Issues

- [2026-01-10-bug-voice-memo-resume.md](2026-01-10-bug-voice-memo-resume.md) - Video resume after voice memo
- [2026-01-07-fitness-app-bugbash/09-voice-memo-audit.md](2026-01-07-fitness-app-bugbash/09-voice-memo-audit.md) - Voice memo audit

## Impact

- **User confusion:** Unexpected popup after cancel
- **Wasted resources:** Transcription API calls for discarded memos
- **Blocked workflow:** Stuck "Transcribing..." state requires page refresh
- **Trust:** Users lose confidence that cancel actually cancels
