# Fix Voice Memo Transcription Retry

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two bugs: (1) fitness voice memo transcription fails on transient DNS errors with no backend retry, and (2) the frontend "Retry" button forces re-recording instead of retrying the upload.

**Architecture:** Backend fix adds `retryTransient` (the shared utility already used by Telegram transcription) inside `OpenAIAdapter.transcribe()`, fixing ALL callers at once. Frontend fix stashes the audio payload before the API call (not after success) and wires the error-state Retry button to `handleRetryTranscription` instead of `handleStartRedoRecording`.

**Tech Stack:** Node.js (backend), React (frontend), OpenAI Whisper API

---

## Context for Implementer

### The Bug

When a user records a voice memo during a fitness session and the OpenAI Whisper API is unreachable (DNS blip → `EAI_AGAIN`), two things go wrong:

1. **Backend:** `OpenAIAdapter.transcribe()` has no retry logic. The JSON chat endpoints use `#retryWithBackoff`, but `transcribe()` (multipart form upload) bypasses it entirely. The error propagates immediately as HTTP 500.

2. **Frontend:** When the upload fails, the "Retry" button calls `handleStartRedoRecording()` which starts a fresh recording — discarding the audio. The correct handler `handleRetryTranscription()` exists but is only wired to the review-mode retry button.

### The DRY Fix

A shared `retryTransient()` utility already exists at `backend/src/0_system/utils/retryTransient.mjs`. It was built on 2026-04-03 (commit `0f92318f`) specifically to handle `EAI_AGAIN` and other transient codes. `TelegramVoiceTranscriptionService` already uses it successfully. Rather than wrapping each caller, we add retry inside `OpenAIAdapter.transcribe()` itself — fixing fitness, weekly review, gratitude input, and the generic `/api/ai/transcribe` endpoint all at once.

### Key Files

| File | Role |
|------|------|
| `backend/src/1_adapters/ai/OpenAIAdapter.mjs` | OpenAI API client — `transcribe()` method needs retry |
| `backend/src/0_system/utils/retryTransient.mjs` | Shared retry utility (already handles EAI_AGAIN) |
| `frontend/src/modules/Fitness/player/overlays/VoiceMemoOverlay.jsx` | Overlay UI — Retry button wired to wrong handler |
| `frontend/src/modules/Fitness/player/panels/hooks/useVoiceMemoRecorder.js` | Recorder hook — payload stashed too late |

### What NOT to Touch

- `OpenAIAdapter.#retryWithBackoff` / `#isRetryable` — these serve `callApi()` (JSON endpoints) and have rate-limit + metrics logic specific to that path. Consolidating them with `retryTransient` is a separate refactor.
- `TelegramVoiceTranscriptionService` — already has its own `retryTransient` wrapper around `transcribe()`. Once `transcribe()` itself retries, Telegram gets double retry coverage, which is harmless (inner retry resolves before outer sees an error).

---

## Task 1: Add retry to `OpenAIAdapter.transcribe()`

**Files:**
- Modify: `backend/src/1_adapters/ai/OpenAIAdapter.mjs:488-528`

- [ ] **Step 1: Add import for retryTransient**

At the top of `OpenAIAdapter.mjs`, add the import after the existing imports (after line 2):

```javascript
import { retryTransient } from '#system/utils/retryTransient.mjs';
```

- [ ] **Step 2: Wrap the `_makeFormRequest` call in `transcribe()` with `retryTransient`**

Replace the try/catch body of `transcribe()` (lines 512-527). The current code:

```javascript
    try {
      const response = await this._makeFormRequest(
        `${OPENAI_API_BASE}/audio/transcriptions`,
        form
      );

      this.logger.debug?.('openai.transcribe.response', {
        textLength: response.text?.length
      });

      return response.text;
    } catch (error) {
      this.metrics.errors++;
      this.logger.error?.('openai.transcribe.error', { error: error.message });
      throw error;
    }
```

Replace with:

```javascript
    try {
      const response = await retryTransient(
        () => this._makeFormRequest(
          `${OPENAI_API_BASE}/audio/transcriptions`,
          form
        ),
        {
          maxAttempts: 3,
          baseDelay: 2000,
          onRetry: (attempt, error) => {
            this.metrics.retryCount++;
            this.logger.warn?.('openai.transcribe.retry', {
              attempt,
              error: error.message,
              code: error.code || error.cause?.code,
              audioSize: audioBuffer.length
            });
          }
        }
      );

      this.logger.debug?.('openai.transcribe.response', {
        textLength: response.text?.length
      });

      return response.text;
    } catch (error) {
      this.metrics.errors++;
      this.logger.error?.('openai.transcribe.error', { error: error.message });
      throw error;
    }
```

- [ ] **Step 3: Verify the fix manually**

Run from project root:

```bash
node -e "
import { retryTransient } from './backend/src/0_system/utils/retryTransient.mjs';
let attempts = 0;
const result = await retryTransient(() => {
  attempts++;
  if (attempts < 3) { const e = new Error('DNS fail'); e.code = 'EAI_AGAIN'; throw e; }
  return 'ok';
}, { maxAttempts: 3, baseDelay: 100 });
console.log('result:', result, 'attempts:', attempts);
"
```

Expected: `result: ok attempts: 3`

- [ ] **Step 4: Commit**

```bash
git add backend/src/1_adapters/ai/OpenAIAdapter.mjs
git commit -m "fix(ai): add retryTransient to OpenAIAdapter.transcribe()

Whisper transcription had no retry logic, unlike callApi() which uses
retryWithBackoff. DNS blips (EAI_AGAIN) caused immediate 500 errors.
Wraps _makeFormRequest with retryTransient (3 attempts, 2s base delay),
fixing all callers: fitness voice memos, weekly review, gratitude input,
and the generic /api/ai/transcribe endpoint."
```

---

## Task 2: Stash audio payload before upload (not after success)

**Files:**
- Modify: `frontend/src/modules/Fitness/player/panels/hooks/useVoiceMemoRecorder.js:352-399`

The payload is currently stashed at line 399, AFTER a successful API response. If the upload fails, `lastAudioPayloadRef.current` is never set, so `hasAudioBlob` is false and `retryTranscription()` can't work.

- [ ] **Step 1: Move the payload stash to before the API call**

In `handleRecordingStop`, the payload is built at lines 352-365. Move the stash to right after the payload is built (after line 365), before the API call at line 367.

Find this code (lines 352-367):

```javascript
      const payload = {
        audioBase64: base64,
        mimeType: blob.type,
        sessionId: sessionId || null,
        startedAt: recordingStartTimeRef.current || Date.now(),
        endedAt: Date.now(),
        context: {
          currentShow: fitnessCtx?.currentMedia?.showName || fitnessCtx?.currentMedia?.grandparentTitle,
          currentEpisode: fitnessCtx?.currentMedia?.title,
          recentShows: fitnessCtx?.recentlyPlayed?.map(item => item.showName || item.grandparentTitle),
          activeUsers: fitnessCtx?.fitnessSessionInstance?.roster?.map(p => p.name),
          householdId: fitnessCtx?.householdId
        }
      };

      const resp = await Promise.race([
```

Replace with:

```javascript
      const payload = {
        audioBase64: base64,
        mimeType: blob.type,
        sessionId: sessionId || null,
        startedAt: recordingStartTimeRef.current || Date.now(),
        endedAt: Date.now(),
        context: {
          currentShow: fitnessCtx?.currentMedia?.showName || fitnessCtx?.currentMedia?.grandparentTitle,
          currentEpisode: fitnessCtx?.currentMedia?.title,
          recentShows: fitnessCtx?.recentlyPlayed?.map(item => item.showName || item.grandparentTitle),
          activeUsers: fitnessCtx?.fitnessSessionInstance?.roster?.map(p => p.name),
          householdId: fitnessCtx?.householdId
        }
      };

      // Stash payload immediately so retry works even if upload fails
      lastAudioPayloadRef.current = payload;

      const resp = await Promise.race([
```

- [ ] **Step 2: Remove the old stash location**

Delete line 399 (the old stash after success):

```javascript
      // Stash audio payload for retry transcription
      lastAudioPayloadRef.current = payload;
```

This line is now redundant since we stash before the API call.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/player/panels/hooks/useVoiceMemoRecorder.js
git commit -m "fix(fitness): stash voice memo payload before upload, not after success

The audio payload was only saved to lastAudioPayloadRef after a
successful API response. On upload failure, hasAudioBlob was false
and retryTranscription() couldn't work. Move the stash to immediately
after payload construction so retry always has audio available."
```

---

## Task 3: Wire Retry button to retry transcription (not re-record)

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/VoiceMemoOverlay.jsx:789-796`

- [ ] **Step 1: Change the error-state Retry button handler**

Find the error retry UI (lines 789-796):

```javascript
                  {isRecorderErrored ? (
                    <div className="voice-memo-overlay__retry-row">
                      {recorderErrorRetryable ? (
                        <button type="button" className="voice-memo-overlay__btn" onClick={handleStartRedoRecording}>Retry</button>
                      ) : null}
                      <button type="button" className="voice-memo-overlay__btn voice-memo-overlay__btn--ghost" onClick={handleClose}>Discard</button>
                    </div>
                  ) : null}
```

Replace with:

```javascript
                  {isRecorderErrored ? (
                    <div className="voice-memo-overlay__retry-row">
                      {recorderErrorRetryable && hasAudioBlob ? (
                        <button type="button" className="voice-memo-overlay__btn" onClick={handleRetryTranscription}>Retry</button>
                      ) : recorderErrorRetryable ? (
                        <button type="button" className="voice-memo-overlay__btn" onClick={handleStartRedoRecording}>Re-record</button>
                      ) : null}
                      <button type="button" className="voice-memo-overlay__btn voice-memo-overlay__btn--ghost" onClick={handleClose}>Discard</button>
                    </div>
                  ) : null}
```

This gives three behaviors:
- **Has audio blob + retryable error** → "Retry" button retries the transcription upload
- **No audio blob + retryable error** → "Re-record" button (fallback, shouldn't happen after Task 2)
- **Non-retryable error** → Only "Discard" shown

- [ ] **Step 2: Verify `hasAudioBlob` is available in the overlay component**

Check that `hasAudioBlob` is destructured from the recorder hook in the overlay. Search the overlay file for `hasAudioBlob` — it should already be available since `handleRetryTranscription` uses it at line 287.

If not available, add it to the destructuring of the recorder hook props.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/VoiceMemoOverlay.jsx
git commit -m "fix(fitness): wire error-state Retry button to retryTranscription

The Retry button on voice memo upload errors called
handleStartRedoRecording, forcing users to re-record. Now calls
handleRetryTranscription which re-sends the cached audio payload.
Falls back to Re-record if no audio blob is available."
```

---

## Task 4: Verify `handleRetryTranscription` resets error state on retry

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/VoiceMemoOverlay.jsx:286-306` (if needed)

- [ ] **Step 1: Check that `handleRetryTranscription` clears the recorder error state**

Read `handleRetryTranscription` (lines 286-306). It calls `retryTranscription()` which calls `emitState('processing')` (line 558 of the hook), but it does NOT clear `recorderError`. This means after calling retry, the overlay might still show the error state because `isRecorderErrored` checks `Boolean(recorderError)` at line 284.

- [ ] **Step 2: Add error state reset at the start of handleRetryTranscription**

Find (lines 286-293):

```javascript
  const handleRetryTranscription = useCallback(async () => {
    if (!retryTranscription || !hasAudioBlob) return;
    const memoId = currentMemo?.memoId || overlayState?.memoId;
    setRetrying(true);
    setRetryError(null);
    setAutoAcceptCancelled(true);
    setAutoAcceptProgress(0);
    logVoiceMemo('retry-transcription-start', { memoId });
```

Replace with:

```javascript
  const handleRetryTranscription = useCallback(async () => {
    if (!retryTranscription || !hasAudioBlob) return;
    const memoId = currentMemo?.memoId || overlayState?.memoId;
    setRecorderError(null);
    setRetrying(true);
    setRetryError(null);
    setAutoAcceptCancelled(true);
    setAutoAcceptProgress(0);
    logVoiceMemo('retry-transcription-start', { memoId });
```

This clears the recorder error so `isRecorderErrored` becomes false and the overlay transitions to the processing state.

- [ ] **Step 3: Verify `setRecorderError` is in the dependency array or available in scope**

Check that `setRecorderError` is accessible. It should already be available since `handleStartRedoRecording` (line 344) uses it. If it's not in `handleRetryTranscription`'s dependency array, add it.

Find the dependency array (line 306):

```javascript
  }, [retryTranscription, hasAudioBlob, currentMemo?.memoId, overlayState?.memoId, logVoiceMemo, onReplaceMemo]);
```

Add `setRecorderError`:

```javascript
  }, [retryTranscription, hasAudioBlob, currentMemo?.memoId, overlayState?.memoId, logVoiceMemo, onReplaceMemo, setRecorderError]);
```

- [ ] **Step 4: Handle retry failure — re-set recorder error so Retry button reappears**

In the catch block (lines 300-302), set the recorder error so the user can retry again:

Find:

```javascript
    } catch (err) {
      setRetryError(err?.message || 'Retry failed');
      logVoiceMemo('retry-transcription-failed', { memoId, error: err?.message }, { level: 'warn' });
```

Replace with:

```javascript
    } catch (err) {
      setRetryError(err?.message || 'Retry failed');
      setRecorderError({ message: err?.message || 'Retry failed', retryable: true });
      logVoiceMemo('retry-transcription-failed', { memoId, error: err?.message }, { level: 'warn' });
```

This ensures if the retry also fails (e.g., DNS still down), the error state shows again with the Retry button.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/VoiceMemoOverlay.jsx
git commit -m "fix(fitness): clear/restore error state during transcription retry

handleRetryTranscription now clears recorderError before retrying
so the overlay transitions to processing state. On retry failure,
re-sets recorderError so the Retry button reappears."
```
