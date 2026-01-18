# Voice Memo Cancel Abort Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When a user cancels a voice memo recording, abort all background processing and prevent the review overlay from reopening.

**Architecture:** Add AbortController to the upload pipeline in useVoiceMemoRecorder, expose a cancelUpload function, and guard onMemoCaptured callback to check overlay state before triggering. Reset stale state on overlay open.

**Tech Stack:** React hooks, AbortController API, existing logging infrastructure

---

## Task 1: Add AbortController to useVoiceMemoRecorder

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessSidebar/useVoiceMemoRecorder.js:156-170` (add ref)
- Modify: `frontend/src/modules/Fitness/FitnessSidebar/useVoiceMemoRecorder.js:306-373` (handleRecordingStop)

**Step 1: Add abortControllerRef and cancelledRef**

In useVoiceMemoRecorder.js, add refs after line 167 (after `lastStateRef`):

```javascript
const abortControllerRef = useRef(null);
const cancelledRef = useRef(false);
```

**Step 2: Run tests to verify nothing breaks**

Run: `npm run lint -- frontend/src/modules/Fitness/FitnessSidebar/useVoiceMemoRecorder.js`
Expected: No errors (refs are unused so far)

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessSidebar/useVoiceMemoRecorder.js
git commit -m "$(cat <<'EOF'
feat(voice-memo): add abortController and cancelled refs

Preparation for cancel-abort feature. Refs will be used to abort
in-flight uploads when user cancels recording.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Wire AbortController into handleRecordingStop

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessSidebar/useVoiceMemoRecorder.js:306-373`

**Step 1: Modify handleRecordingStop to check cancelledRef and create AbortController**

Replace the handleRecordingStop callback (lines 306-373) with:

```javascript
const handleRecordingStop = useCallback(async () => {
  // Guard: If already cancelled, discard chunks and exit
  if (cancelledRef.current) {
    logVoiceMemo('recording-stop-cancelled', {
      chunksDiscarded: chunksRef.current.length,
      reason: 'user_cancel'
    });
    chunksRef.current = [];
    cancelledRef.current = false;
    return;
  }

  if (!chunksRef.current.length) return;

  logVoiceMemo('recording-stop', { chunks: chunksRef.current.length });

  const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
  chunksRef.current = [];

  // Create abort controller for this upload
  abortControllerRef.current = new AbortController();
  const { signal } = abortControllerRef.current;

  let timedOut = false;
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      timedOut = true;
      reject(new Error('Processing timed out'));
    }, UPLOAD_TIMEOUT_MS);
  });

  try {
    setUploading(true);
    emitState('processing');
    const base64 = await blobToBase64(blob);

    // Check if aborted during base64 conversion
    if (signal.aborted) {
      logVoiceMemo('recording-upload-aborted', { reason: 'user_cancel', phase: 'base64' });
      return;
    }

    const payload = {
      audioBase64: base64,
      mimeType: blob.type,
      sessionId: sessionId || null,
      startedAt: recordingStartTimeRef.current || Date.now(),
      endedAt: Date.now(),
      context: {
        currentShow: fitnessCtx?.currentMedia?.showName || fitnessCtx?.currentMedia?.show,
        currentEpisode: fitnessCtx?.currentMedia?.title,
        recentShows: fitnessCtx?.recentlyPlayed?.map(item => item.showName || item.show),
        activeUsers: fitnessCtx?.fitnessSessionInstance?.roster?.map(p => p.name),
        householdId: fitnessCtx?.householdId
      }
    };

    const resp = await Promise.race([
      DaylightAPI('api/fitness/voice_memo', payload, 'POST'),
      timeoutPromise
    ]);

    // Check if aborted during API call
    if (signal.aborted) {
      logVoiceMemo('recording-upload-aborted', { reason: 'user_cancel', phase: 'api' });
      return;
    }

    if (!resp?.ok) {
      emitError(resp?.error || 'Transcription failed', 'Transcription failed', 'transcription_failed', true);
      return;
    }
    if (timedOut) {
      emitError(new Error('Processing timed out'), 'Processing timed out', 'processing_timeout', true);
      return;
    }

    const memo = resp.memo || null;

    // Final abort check before triggering callback
    if (signal.aborted) {
      logVoiceMemo('recording-callback-suppressed', {
        reason: 'overlay_closed',
        memoId: memo?.memoId
      });
      return;
    }

    if (memo && onMemoCaptured) {
      onMemoCaptured(memo);
    }
    if (memo) {
      logVoiceMemo('recording-upload-complete', { memoId: memo.memoId || null, durationMs: payload?.endedAt - payload?.startedAt });
    } else {
      logVoiceMemo('recording-upload-complete', { memoId: null, durationMs: payload?.endedAt - payload?.startedAt });
    }
    emitState('ready');
  } catch (err) {
    // Don't emit error if aborted
    if (signal.aborted) {
      logVoiceMemo('recording-upload-aborted', { reason: 'user_cancel', phase: 'error' });
      return;
    }
    emitError(err, timedOut ? 'Processing timed out' : 'Upload failed', timedOut ? 'processing_timeout' : 'upload_failed', true);
    logVoiceMemo('recording-upload-error', {
      error: err?.message || String(err),
      timedOut
    }, { level: 'warn' });
  } finally {
    setUploading(false);
    abortControllerRef.current = null;
  }
}, [emitError, emitState, logVoiceMemo, onMemoCaptured, sessionId]);
```

**Step 2: Run lint to verify syntax**

Run: `npm run lint -- frontend/src/modules/Fitness/FitnessSidebar/useVoiceMemoRecorder.js`
Expected: PASS (or only unrelated warnings)

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessSidebar/useVoiceMemoRecorder.js
git commit -m "$(cat <<'EOF'
feat(voice-memo): wire AbortController into handleRecordingStop

Upload pipeline now checks for abort signal at multiple points:
- Before processing (cancelledRef guard)
- After base64 conversion
- After API call
- Before triggering onMemoCaptured callback

This prevents orphaned uploads from reopening the review overlay.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add cancelUpload function to useVoiceMemoRecorder

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessSidebar/useVoiceMemoRecorder.js:469-490` (after stopRecording, before cleanup effect)

**Step 1: Add cancelUpload callback**

Add this after the `stopRecording` callback (around line 469):

```javascript
const cancelUpload = useCallback(() => {
  // Set cancelled flag to prevent handleRecordingStop from processing
  cancelledRef.current = true;

  // Abort any in-flight API request
  if (abortControllerRef.current) {
    abortControllerRef.current.abort();
    abortControllerRef.current = null;
  }

  // Discard any pending chunks
  const chunksDiscarded = chunksRef.current.length;
  chunksRef.current = [];

  // Reset state
  setUploading(false);
  emitState('idle');

  logVoiceMemo('recording-cancelled', {
    reason: 'user_cancel',
    chunksDiscarded,
    wasUploading: uploading
  });
}, [emitState, logVoiceMemo, uploading]);
```

**Step 2: Export cancelUpload in the return object**

Update the return statement (around line 482) to include cancelUpload:

```javascript
return {
  isRecording,
  recordingDuration,
  uploading,
  error,
  setError,
  startRecording,
  stopRecording,
  cancelUpload
};
```

**Step 3: Run lint to verify syntax**

Run: `npm run lint -- frontend/src/modules/Fitness/FitnessSidebar/useVoiceMemoRecorder.js`
Expected: PASS

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessSidebar/useVoiceMemoRecorder.js
git commit -m "$(cat <<'EOF'
feat(voice-memo): add cancelUpload function

New function exposed by useVoiceMemoRecorder:
- Sets cancelledRef to prevent handleRecordingStop from processing
- Aborts any in-flight API request via AbortController
- Discards pending audio chunks
- Resets uploading state to idle
- Logs cancellation with context

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Update VoiceMemoOverlay to use cancelUpload on close

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.jsx:241-265` (useVoiceMemoRecorder destructure)
- Modify: `frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.jsx:148-156` (handleClose)

**Step 1: Destructure cancelUpload from useVoiceMemoRecorder**

Update the destructuring (around line 241) to include cancelUpload:

```javascript
const {
  isRecording,
  recordingDuration,
  uploading,
  error: recorderError,
  setError: setRecorderError,
  startRecording,
  stopRecording,
  cancelUpload
} = useVoiceMemoRecorder({
  sessionId,
  playerRef,
  preferredMicrophoneId,
  onMemoCaptured: handleRedoCaptured,
  onStateChange: setRecorderState,
  onLevel: useCallback((level) => {
    if (micLevelRafRef.current) {
      cancelAnimationFrame(micLevelRafRef.current);
    }
    micLevelRafRef.current = requestAnimationFrame(() => {
      setMicLevel(Number.isFinite(level) ? level : 0);
    });
  }, []),
  onPauseMusic: pauseMusicPlayer,
  onResumeMusic: resumeMusicPlayer
});
```

**Step 2: Run lint to verify syntax**

Run: `npm run lint -- frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.jsx`
Expected: PASS (cancelUpload defined but unused warning is ok)

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.jsx
git commit -m "$(cat <<'EOF'
feat(voice-memo): destructure cancelUpload in VoiceMemoOverlay

Preparation for wiring cancel functionality into handleClose.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Wire cancelUpload into handleClose

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.jsx:148-156` (handleClose)

**Step 1: Update handleClose to cancel upload and stop recording**

Replace the handleClose callback with:

```javascript
const handleClose = useCallback(() => {
  const wasRecording = isRecording;
  const wasProcessing = isProcessing || recorderState === 'processing';

  logVoiceMemo('overlay-close-request', {
    mode: overlayState?.mode,
    memoId: overlayState?.memoId,
    wasRecording,
    wasProcessing,
    recorderState,
    reason: 'user_cancel'
  });

  // Cancel any in-flight upload first
  if (wasProcessing) {
    cancelUpload?.();
  }

  // Stop recording if active (this will NOT trigger handleRecordingStop
  // because cancelledRef is now set)
  if (wasRecording) {
    stopRecording();
  }

  // Force reset recorder state to idle
  setRecorderState('idle');

  // If closing during review mode, discard the pending memo
  if (overlayState?.mode === 'review' && overlayState?.memoId) {
    logVoiceMemo('overlay-close-discard', { memoId: overlayState.memoId });
    onRemoveMemo?.(overlayState.memoId);
  }

  onClose?.();
}, [cancelUpload, isProcessing, isRecording, logVoiceMemo, onClose, onRemoveMemo, overlayState?.mode, overlayState?.memoId, recorderState, stopRecording]);
```

**Step 2: Run lint to verify syntax**

Run: `npm run lint -- frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.jsx`
Expected: PASS

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.jsx
git commit -m "$(cat <<'EOF'
feat(voice-memo): wire cancelUpload into handleClose

When user clicks X to close voice memo overlay:
1. Cancel any in-flight upload (aborts API call)
2. Stop recording if active
3. Force reset recorder state to idle
4. Discard memo if in review mode
5. Close overlay

Enhanced logging captures wasRecording, wasProcessing, recorderState.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Guard handleRedoCaptured against closed overlay

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.jsx:209-238` (handleRedoCaptured)

**Step 1: Add guard at start of handleRedoCaptured**

Update handleRedoCaptured to check if overlay is still open:

```javascript
const handleRedoCaptured = useCallback((memo) => {
  // Guard: Don't process if overlay was already closed
  if (!overlayState?.open) {
    logVoiceMemo('overlay-redo-captured-orphaned', {
      memoId: memo?.memoId,
      reason: 'overlay_closed'
    });
    return;
  }

  if (!memo) {
    logVoiceMemo('overlay-redo-cancel');
    onClose?.();
    return;
  }

  // Check if transcript indicates no meaningful content - auto-redo
  const transcript = (memo.transcriptClean || memo.transcriptRaw || '').trim().toLowerCase();
  const isNoMemo = transcript === '[no memo]' || transcript === 'no memo' || transcript === 'no memo.' || transcript.includes('[no memo]');
  if (isNoMemo) {
    logVoiceMemo('overlay-redo-auto-retry', { reason: 'no-memo-transcript', transcript, memoId: memo.memoId || null });
    // Reset state so recording auto-starts again
    autoStartRef.current = false;
    setRecorderState('idle');
    // Stay in redo mode - recording will auto-start via useLayoutEffect
    return;
  }

  const targetId = overlayState?.memoId;
  logVoiceMemo('overlay-redo-captured', { memoId: targetId || memo.memoId || null });
  const stored = targetId ? (onReplaceMemo?.(targetId, memo) || memo) : (onAddMemo?.(memo) || memo);
  const nextTarget = stored || memo;
  if (nextTarget) {
    // 4C: Pass fromRecording: true to enable auto-accept for post-recording review
    onOpenReview?.(nextTarget, { autoAccept: true, fromRecording: true });
  } else {
    onClose?.();
  }
}, [logVoiceMemo, onAddMemo, onClose, onOpenReview, onReplaceMemo, overlayState?.memoId, overlayState?.open]);
```

**Step 2: Run lint to verify syntax**

Run: `npm run lint -- frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.jsx`
Expected: PASS

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.jsx
git commit -m "$(cat <<'EOF'
feat(voice-memo): guard handleRedoCaptured against closed overlay

If upload completes after overlay was closed, the callback now:
1. Logs an orphaned capture event
2. Returns early without opening review

This is a secondary safeguard - the primary fix is AbortController.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Reset stale state on overlay open

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.jsx:362-372` (auto-start useLayoutEffect)

**Step 1: Add stale state reset in the auto-start effect**

Update the useLayoutEffect (around line 362) to detect and reset stale state:

```javascript
// Auto-start recording for fresh redo captures (no memo id yet)
useLayoutEffect(() => {
  if (!overlayState?.open || overlayState.mode !== 'redo') {
    autoStartRef.current = false;
    return;
  }

  // Detect and reset stale state (e.g., stuck in 'processing' from previous session)
  if (recorderState !== 'idle' && recorderState !== 'recording' && !isProcessing) {
    logVoiceMemo('overlay-open-stale-state-reset', {
      previousState: recorderState,
      mode: overlayState?.mode
    });
    setRecorderState('idle');
    autoStartRef.current = false;
    return; // Let next render handle auto-start
  }

  // Auto-start recording in redo mode (whether new capture or redoing existing memo)
  if (!isRecording && !isProcessing && !isRecorderErrored && !autoStartRef.current) {
    autoStartRef.current = true;
    handleStartRedoRecording();
  }
}, [overlayState?.open, overlayState?.mode, isRecording, isProcessing, isRecorderErrored, handleStartRedoRecording, logVoiceMemo, recorderState]);
```

**Step 2: Run lint to verify syntax**

Run: `npm run lint -- frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.jsx`
Expected: PASS

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.jsx
git commit -m "$(cat <<'EOF'
feat(voice-memo): reset stale state on overlay open

When overlay opens in redo mode with unexpected recorderState
(e.g., 'processing' left over from a cancelled session):
1. Log stale state detection
2. Reset to 'idle'
3. Let next render handle auto-start

Fixes "stuck Transcribing..." spinner issue.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Add cleanup for cancelledRef on unmount

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessSidebar/useVoiceMemoRecorder.js:471-480` (cleanup effect)

**Step 1: Update cleanup effect to reset cancelledRef and abortControllerRef**

Update the cleanup useEffect:

```javascript
useEffect(() => () => {
  clearDurationTimer();
  cleanupStream();

  // Abort any in-flight upload on unmount
  if (abortControllerRef.current) {
    abortControllerRef.current.abort();
    abortControllerRef.current = null;
  }
  cancelledRef.current = false;

  try {
    mediaRecorderRef.current?.stop();
  } catch (_) {
    // ignore
  }
  mediaRecorderRef.current = null;
}, [cleanupStream, clearDurationTimer]);
```

**Step 2: Run lint to verify syntax**

Run: `npm run lint -- frontend/src/modules/Fitness/FitnessSidebar/useVoiceMemoRecorder.js`
Expected: PASS

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessSidebar/useVoiceMemoRecorder.js
git commit -m "$(cat <<'EOF'
feat(voice-memo): cleanup abortController on unmount

When useVoiceMemoRecorder unmounts:
1. Abort any in-flight upload
2. Reset cancelledRef
3. Clean up media recorder

Prevents memory leaks and orphaned API calls.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Manual Integration Test

**Files:** None (manual testing)

**Step 1: Start dev server**

Run: `npm run dev`
Expected: Server starts on configured port

**Step 2: Test cancel during recording**

1. Open fitness app
2. Start voice memo recording
3. Click X to cancel while recording
4. Verify: Overlay closes, no review popup appears

**Step 3: Test cancel during processing**

1. Start voice memo recording
2. Say something, then click stop
3. While "Transcribing..." is shown, click X
4. Verify: Overlay closes, no review popup appears

**Step 4: Test rapid cancel/reopen**

1. Start recording, cancel immediately
2. Reopen voice memo overlay
3. Verify: Clean state, recording auto-starts normally

**Step 5: Test normal flow still works**

1. Start recording
2. Say something, click stop
3. Wait for transcription
4. Verify: Keep/Toss review appears correctly
5. Click Keep or Toss
6. Verify: Works as expected

**Step 6: Document test results**

Update the bug file with test results and mark status as "Fixed" or "Needs more work".

**Step 7: Commit test documentation if needed**

```bash
git add docs/_wip/bugs/2026-01-15-voice-memo-cancel-background-processing.md
git commit -m "$(cat <<'EOF'
docs: update voice memo cancel bug with fix verification

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add abortControllerRef and cancelledRef | useVoiceMemoRecorder.js |
| 2 | Wire AbortController into handleRecordingStop | useVoiceMemoRecorder.js |
| 3 | Add cancelUpload function | useVoiceMemoRecorder.js |
| 4 | Destructure cancelUpload in VoiceMemoOverlay | VoiceMemoOverlay.jsx |
| 5 | Wire cancelUpload into handleClose | VoiceMemoOverlay.jsx |
| 6 | Guard handleRedoCaptured against closed overlay | VoiceMemoOverlay.jsx |
| 7 | Reset stale state on overlay open | VoiceMemoOverlay.jsx |
| 8 | Add cleanup for abortController on unmount | useVoiceMemoRecorder.js |
| 9 | Manual integration test | - |

**Total commits:** 8 code commits + 1 documentation commit
