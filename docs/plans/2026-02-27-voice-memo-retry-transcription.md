# Voice Memo: Retry Transcription Button

**Date:** 2026-02-27
**Status:** Approved

## Problem

When Whisper garbles a voice memo transcription (e.g. "www.kert.zoe.ca" from valid audio), the only option is Redo — which requires re-recording. The audio was fine; only the transcription failed. A Retry Transcription button re-sends the same audio for a fresh transcription without re-recording.

Additionally, the existing `replaceMemo()` flow has a bug where redo transcripts don't persist to the session YAML. This must be fixed for both Redo and Retry to work correctly.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Button visibility | Always visible in review mode | Simple, user decides if transcript looks wrong |
| Audio blob storage | Frontend memory (ref) | Zero backend changes, blob discarded on accept/delete |
| Retry UX | Inline in review mode | Replace transcript with spinner, disable buttons, no mode switching |
| Auto-accept after retry | Disabled | User explicitly chose retry — they should review the result |

## UI Changes

### Review Mode Button Layout

```
[ Keep (green) ] [ Retry (blue) ] [ Redo (orange) ] [ Delete (red) ]
```

- Retry button: blue (`#3b82f6`), circular refresh arrow icon
- Disabled when: retrying in progress, or audio blob unavailable
- New CSS class: `.voice-memo-btn--retry`

### Retry Processing State (inline in review mode)

- Transcript area replaced with "Transcribing..." spinner (existing processing spinner component)
- All 4 buttons disabled
- On success: new transcript appears, no auto-accept
- On error: inline error message where transcript was, Retry re-enables

## Implementation

### 1. Fix replaceMemo persistence bug

**Files:** `VoiceMemoManager.js`, `PersistenceManager.js`

Investigate and fix why `VoiceMemoManager.replaceMemo()` updates don't make it into the persisted session YAML. Both Redo and Retry depend on this working.

### 2. useVoiceMemoRecorder.js — retain audio blob

- Add `lastAudioPayloadRef` (ref holding `{ audioBase64, mimeType, context }`)
- After successful upload in `handleRecordingStop()`, stash payload in ref
- Expose `retryTranscription()` async function:
  - Re-POSTs same payload to `POST /api/v1/fitness/voice_memo`
  - Sets recorder state to `processing` during request
  - Returns new memo on success, throws on error
- Expose `hasAudioBlob` boolean (ref is populated)
- Clear ref on: `cancelUpload()`, new recording started, hook unmount

### 3. VoiceMemoOverlay.jsx — retry button and inline processing

- Add `retrying` local state (boolean)
- Retry button click: set `retrying=true`, call `retryTranscription()`
- On success: `onReplaceMemo(memoId, newMemo)`, `retrying=false`, cancel auto-accept
- On error: show inline error, `retrying=false`, re-enable Retry button
- While retrying: show spinner in transcript area, disable all buttons
- Retry button disabled when `!hasAudioBlob`

### 4. VoiceMemoOverlay.scss — blue button style

- `.voice-memo-btn--retry`: `#3b82f6` icon color, `rgba(59,130,246,0.15)` background
- Same 56x56px icon button pattern as existing buttons

## Data Flow

```
User taps Retry
  → retrying = true, buttons disabled
  → transcript area → "Transcribing..." spinner
  → retryTranscription() → POST /api/v1/fitness/voice_memo (same audio)
  → Backend: Whisper → GPT-4o cleanup → return new memo
  → onReplaceMemo(memoId, newMemo) → VoiceMemoManager updates in memory
  → retrying = false, autoAccept disabled
  → New transcript displayed in review mode
```

No backend changes required. The existing endpoint is stateless.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Retry while offline | POST fails → inline error, Retry re-enables |
| Retry returns `[No Memo]` | Show as-is, user decides (no auto-retry) |
| Multiple retries | Each replaces previous, no limit |
| Redo after failed retry | Starts new recording, stashes new blob |
| Overlay closed during retry | Abort request, clear blob |
| Session ends during retry | Same as overlay close |
| Blob missing | Retry button disabled |

## Out of Scope

- Smart garbled-text detection / auto-retry
- Backend audio file storage
- Retry count limits
- Different Whisper model/settings on retry

## Files Modified

| File | Change |
|------|--------|
| `frontend/src/hooks/fitness/VoiceMemoManager.js` | Fix replaceMemo persistence bug |
| `frontend/src/hooks/fitness/PersistenceManager.js` | Fix replaceMemo persistence bug |
| `frontend/src/modules/Fitness/FitnessSidebar/useVoiceMemoRecorder.js` | Add lastAudioPayloadRef, retryTranscription(), hasAudioBlob |
| `frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.jsx` | Add Retry button, inline retrying state |
| `frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.scss` | Add .voice-memo-btn--retry blue style |
