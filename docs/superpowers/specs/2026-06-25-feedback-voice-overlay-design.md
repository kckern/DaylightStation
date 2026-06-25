# Feedback Voice Overlay — Design Spec

**Date:** 2026-06-25
**Status:** Approved (brainstorming) → ready for implementation plan

## Goal

Make the app-wide voice **Feedback** capture work like the Fitness **Voice Memo** overlay: a modal record → mic-meter → processing → **transcript-visible** review (Keep / Redo), with **no audio playback**. While recording, any host music (e.g. the Fitness menu music) pauses. Extract the genuinely shared pieces into an app-neutral module so the feedback and voice-memo paths stop duplicating capture/overlay UI.

## Decisions (locked during brainstorming)

1. **Abstraction scope:** Shared core in a new neutral module; keep `VoiceMemoOverlay` stable (no internal rewire this pass — see Out of Scope).
2. **Feedback UI form:** Modal portal overlay (matches voice memo), replacing today's inline `FeedbackPanel`.
3. **Transcript flow:** Submit, then poll `GET /:app/:id` until the transcript is ready (no change to the async transcription pipeline).
4. **Music pause:** Reuse `FitnessContext.pauseMusicPlayer`/`resumeMusicPlayer`, supplied to the overlay as **injected callbacks** (overlay stays decoupled from `FitnessContext`).
5. **Entry points:** Fitness menu (new entry, wires music callbacks) + Piano settings (migrate existing) + host-agnostic for future app surfaces.

## Backend facts (verified, no backend change required)

- `POST /api/v1/feedback` → `{ id, app, created, status, transcriptStatus }`. Transcription runs in the background.
- `transcriptStatus`: `pending` → terminal `done` | `failed` | `unavailable`.
- `GET /api/v1/feedback/:app/:id` → full item incl. `transcript` (single-item GET is NOT truncated; the list view truncates to 240 chars).
- `DELETE /api/v1/feedback/:app/:id` → `{ ok, id }` (used by the Redo path to discard a just-saved item).

## Architecture (3 layers)

### Layer 1 — `frontend/src/modules/VoiceCapture/` (app-neutral core, no app-specific deps)

- **`useMediaRecorderCapture.js`** — the one-shot recorder, generalized from today's `useFeedbackRecorder` (getUserMedia → MediaRecorder → single Blob; ref-driven `levelRef`; `durationMs`; built-in-mic pinning + EC/NS/AGC-off for BT kiosks; `start()`, `stop()→{blob,durationMs,mimeType}`, `error`). Reusable "record → blob" primitive.
- **`VoiceCaptureOverlay.jsx`** — purely presentational portal overlay (renders to `document.body`). Chrome: backdrop + panel + header + close. Shows exactly one phase view: (a) record button + `<MicMeter>`; (b) processing spinner ("Transcribing…"); (c) transcript review — transcript text + **Keep** / **Redo** actions. Escape and backdrop click close. **No recorder logic, no network.**
  - Props: `{ open, phase, title, prompt, durationMs, levelRef, transcript, transcriptStatus, error, onRecordToggle, onKeep, onRedo, onClose }`.
- **`MicMeter.jsx`** — ref-driven level bar (lifted from `FeedbackPanel`'s VU meter; rAF reads `levelRef`, no tree re-render).
- **`VoiceCaptureOverlay.scss`** — overlay styling (mirrors the voice-memo overlay look).

### Layer 2 — `frontend/src/modules/Feedback/`

- **`FeedbackOverlay.jsx`** — owns the state machine and binds the core to the feedback backend. Renders `<VoiceCaptureOverlay/>`.
  - Phases: `idle → recording → submitting → transcribing → review → done | error`.
  - `useMediaRecorderCapture` for record/stop→blob.
  - On stop → `submitFeedback` (POST) → `pollFeedbackTranscript` → show transcript in review.
  - **Keep:** item already saved → close. **Redo:** `deleteFeedback(id)` then back to `recording`.
  - Calls injected `onPauseMusic` on record-start, `onResumeMusic` on close/unmount.
  - Props: `{ open, app, context, prompt, onClose, onPauseMusic, onResumeMusic }`.
- **`feedbackApi.js`** (extend):
  - keep `submitFeedback({app,blob,durationMs,context})` (already returns `{id, transcriptStatus}`).
  - add `pollFeedbackTranscript({app, id, signal, timeoutMs=20000, intervalMs=1500})` — GET until `transcriptStatus ∈ {done, failed, unavailable}` or timeout; resolves the item (or `{transcriptStatus:'timeout'}` on timeout).
  - add `deleteFeedback({app, id})` — DELETE for the Redo path.
- **Remove** `FeedbackPanel.jsx` + `FeedbackPanel.scss` and `useFeedbackRecorder.js` once piano is migrated (→ `_deleteme/` if `rm` is permission-blocked). `useFeedbackRecorder` is superseded by `useMediaRecorderCapture`.

### Layer 3 — Host wiring (injected, host-agnostic)

- **Fitness menu:** add a "Send feedback" entry (in `FitnessSidebarMenu.jsx`) that opens `<FeedbackOverlay app="fitness" onPauseMusic={pauseMusicPlayer} onResumeMusic={resumeMusicPlayer}/>` (both from `useFitnessContext`). This is the host where menu music pauses.
- **Piano settings:** in `PianoSettingsSheet.jsx`, replace the inline `<FeedbackPanel app="piano" .../>` with a trigger that opens `<FeedbackOverlay app="piano" context={{pianoId, surface:'settings'}}/>` — no music callbacks (piano has no menu music).

## Transcript-visible flow (no playback)

```
idle ──Record──▶ recording ──Stop──▶ submitting (POST)
                                         │
                                         ▼
                                   transcribing (poll GET) ──▶ review
                                                                 │  transcript shown
                                              Keep (close) ◀─────┤
                                              Redo (DELETE + ──▶ recording)
```

- Poll **timeout** → review shows "Saved — it'll appear in the inbox shortly." + Keep (no Redo-delete needed; it's a valid item).
- `transcriptStatus: failed` → review shows the failure note + Keep / Redo.
- Music: `onPauseMusic()` fires when recording starts; `onResumeMusic()` fires on overlay close (any phase) and on unmount (guard against double-resume).

## Data flow

`VoiceCaptureOverlay` (dumb view) ← `FeedbackOverlay` (state machine) ↔ `useMediaRecorderCapture` (mic→blob) + `feedbackApi` (POST / poll / delete). Host supplies `app`, `context`, music callbacks, `open`/`onClose`.

## Error handling

- **Mic permission denied / mic error:** surfaced from `useMediaRecorderCapture.error`; overlay shows it in the record phase with a Retry (re-`start`).
- **Submit failure (POST):** review/error phase shows "Couldn't save" + Retry (re-POST same blob) / Discard (close).
- **Poll timeout:** terminal-friendly message + Keep (item is saved).
- **Transcript failed:** show note + Keep / Redo.
- **Double-resume music:** `FeedbackOverlay` tracks a `musicPausedRef` so `onResumeMusic` runs at most once per pause.

## Testing

- **`useMediaRecorderCapture`** (vitest, mock `MediaRecorder`/`getUserMedia`): start→recording, stop→`{blob,durationMs}`, mic-denied → `error` set, teardown stops tracks.
- **`feedbackApi`** (mock `DaylightAPI`): `pollFeedbackTranscript` resolves on `done`, resolves on `failed`, resolves `timeout` after `timeoutMs`; `deleteFeedback` issues DELETE.
- **`FeedbackOverlay`** (RTL): record→stop→submitting→transcribing→transcript shown→Keep closes; Redo calls `deleteFeedback` and returns to recording; `onPauseMusic` fired on record-start and `onResumeMusic` on close (once); submit-error path shows Retry.
- **`VoiceCaptureOverlay`** (RTL): each `phase` renders its view; Escape and backdrop click call `onClose`; Keep/Redo/RecordToggle invoke their callbacks.

## Out of scope (deliberate)

- **No `VoiceMemoOverlay` internal rewire.** It carries heavy fitness-specific logic (redo/list/retroactive/auto-accept). The `VoiceCapture` pieces are designed to *match* its shapes so a later migration is mechanical; that migration is a separate fast-follow, not this effort.
- No change to the backend transcription pipeline or feedback storage.
- No audio playback in the feedback overlay (explicitly dropped).

## File summary

| Action | Path |
|--------|------|
| Create | `frontend/src/modules/VoiceCapture/useMediaRecorderCapture.js` |
| Create | `frontend/src/modules/VoiceCapture/VoiceCaptureOverlay.jsx` |
| Create | `frontend/src/modules/VoiceCapture/MicMeter.jsx` |
| Create | `frontend/src/modules/VoiceCapture/VoiceCaptureOverlay.scss` |
| Create | `frontend/src/modules/Feedback/FeedbackOverlay.jsx` |
| Modify | `frontend/src/modules/Feedback/feedbackApi.js` (poll + delete) |
| Modify | `frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx` (entry) |
| Modify | `frontend/src/modules/Piano/PianoKiosk/PianoSettingsSheet.jsx` (migrate) |
| Remove | `frontend/src/modules/Feedback/FeedbackPanel.jsx`, `FeedbackPanel.scss`, `useFeedbackRecorder.js` |
| Tests  | colocated `*.test.js(x)` for each created/modified unit |
