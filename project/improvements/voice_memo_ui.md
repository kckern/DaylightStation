# Voice Memo Overlay Improvements — Functional Requirements

## Suggestions for Architecture Improvements
- **Dedicated VoiceMemoOverlayController**: Create a small controller/service that owns overlay state (`idle|recording|processing|ready|error`), memo metadata, and mic-level stream subscription. UI consumes its DTOs, avoiding direct coupling to recorder internals.
- **Recorder Interface Contract**: Define a clean interface for recording (`start()`, `stop()`, `onLevel`, `onError`, `onStateChange`) so overlay logic is decoupled from any specific recorder implementation and easier to test/mocks.
- **Event Pipeline/Telemetry Hook**: Centralize memo events in a single emitter (e.g., `VoiceMemoEvents`) so `VoiceMemoManager` and the overlay publish structured events without duplicating logging code (DRY, observability).
- **DTOs for Overlay View**: Normalize overlay props into a stable DTO (`status`, `elapsed`, `micLevel`, `title`, `actions`, `message`) to keep React components presentational and reduce prop churn.
- **State Machine**: Model recording lifecycle with a minimal state machine (guards for start/stop/processing/error). This enforces legal transitions and simplifies edge cases (rapid start/stop, permission errors).
- **Mic-Level Adapter**: Provide a thin adapter that throttles/samples mic levels for UI (~10–15 fps) to avoid rendering pressure and to keep the overlay UI independent of raw audio stream cadence.
- **Abort/Timeout Handling**: Add a cancellable processing promise with timeout and retry hooks; surface this through the controller instead of embedding in UI handlers.
- **Single Overlay Instance Guard**: Keep overlay identity in the controller to prevent multiple concurrent overlays; expose explicit `show/hide` intents rather than implicit renders.
- **Error Surface & Retry Policy**: Standardize error payload shape (`code`, `message`, `retryable`) so UI can render consistent error/Retry/Discard controls without bespoke logic.
- **Testable Units**: Split pure logic (state machine, DTO mappers, event emission) from UI; add unit tests for transitions and normalization without needing the DOM or audio APIs.

Functional Requirements
- Immediate overlay on record start
	- When the user presses Record, show the overlay instantly (no wait for processing).
	- Display recording state: visible recording icon, timer, and prominent Stop button/icon.
	- Show a live microphone level bar (VU) that updates at least ~10–15 fps while recording.

- Recording state UI
	- Fields: status label (“Recording”), elapsed timer, memo title (if provided), and microphone device name (if available).
	- Controls: Stop button (primary), optional Cancel/Discard to abort without saving.
	- Accessibility: announce “Recording started” and expose Stop via keyboard/ARIA.

- Processing state UI
	- On Stop, keep the overlay visible and transition to a “Processing” state until memo is stored/ingested.
	- Replace mic bar with a spinner/progress indicator and a “Processing voice memo…” message.
	- Prevent duplicate submissions; disable Stop/Record while processing.
	- If processing fails, show an inline error and allow retry/discard.

- Completion state
	- After processing, either dismiss overlay or show the finalized memo preview per current behavior (transcript/metadata) with a Close action.
	- If transcripts arrive async, allow incremental update without hiding the overlay.

- State and events
	- New overlay states: `idle` → `recording` → `processing` → `ready|error`.
	- Expose callbacks/events: `onRecordingStart`, `onRecordingStop`, `onProcessingComplete`, `onProcessingError` for analytics/telemetry.
	- Ensure state resets on cancel/discard and on session end.

- Data and API hooks
	- Provide mic level samples to the overlay via a lightweight stream (e.g., `onLevel(level)` from the recorder) without blocking UI.
	- Attach memo metadata (author, elapsedSeconds, videoTimeSeconds) at start; attach processing results (transcript, duration) on completion.
	- Guarantee one overlay instance; prevent multiple concurrent overlays for the same user/session.

- Error and edge cases
	- If microphone permission is denied or device is unavailable, surface an inline error in the overlay and do not enter recording state.
	- Handle rapid start/stop safely (debounce UI; ensure no duplicate memo creation).
	- On processing timeout, show retry and discard options.

- Telemetry
	- Log events for `voice_memo_overlay_shown`, `voice_memo_record_start`, `voice_memo_record_stop`, `voice_memo_processing_start`, `voice_memo_processing_complete`, `voice_memo_processing_error` with memo id and elapsed time.

Non-Functional
- Overlay should render within 1 frame of Record press; mic bar updates should not noticeably affect main render perf.
- Works across desktop/mobile; keyboard accessible Stop.

## Detailed Design (UI + State + Data Flow)
- **Ownership & Sources of Truth**
	- `FitnessContext` already holds `voiceMemoOverlayState`, `voiceMemos`, and mutators (`openVoiceMemoReview`, `openVoiceMemoList`, `openVoiceMemoRedo`, `closeVoiceMemoOverlay`, `add/remove/replace`). Treat context as the single source of UI state; gate all overlay openings through these helpers to avoid multiple overlays.
	- `FitnessSession.voiceMemoManager` remains the canonical memo store; context methods delegate to it and bump `voiceMemoVersion` for UI refresh.

- **Overlay State Machine**
	- States: `idle` (closed), `list`, `review`, `redo`; within `redo` we represent recorder sub-states (`recording`, `processing`, `error`).
	- Transitions:
		- `idle → list` on explicit open.
		- `idle|list → review` when a memo is captured/selected; when `autoAccept` is set, auto-advance to keep after timeout.
		- `review → redo` on user redo intent; recorder drives `redo.recording → redo.processing → review` via `useVoiceMemoRecorder` callbacks.
		- `review|list|redo → idle` on close or when no memos remain.

- **Recorder Contract (`useVoiceMemoRecorder`)**
	- Inputs: `sessionId`, `playerRef`, `preferredMicrophoneId`, `onMemoCaptured`.
	- Outputs: `isRecording`, `recordingDuration`, `uploading`, `error`, `startRecording`, `stopRecording`.
	- Side-effect: invokes `onMemoCaptured(memo)` once processing completes. Errors are surfaced via `error` and reset via `setError`.

- **Data Flow**
	1) Record start: sidebar or overlay triggers `startRecording`; overlay opened immediately with `overlayState.mode='redo'` (recording substate) and timer begins.
	2) Recording: `recordingDuration` ticks; mic-level stream (future adapter) feeds VU meter at ~10–15 fps; Stop triggers `stopRecording`.
	3) Processing: `uploading` true; overlay switches to processing UI (spinner, disabled controls).
	4) Capture complete: `onMemoCaptured` receives new memo; `replaceVoiceMemoInSession` (for redo) or `addVoiceMemoToSession` (new) persists; overlay moves to `review` with memoId; optional `autoAccept` starts progress bar.
	5) Accept/Keep: `handleAccept` closes overlay; list view remains available via `openVoiceMemoList`.

- **UI Wiring (`VoiceMemoOverlay.jsx`)**
	- Props consumed: `overlayState`, `voiceMemos`, `onClose/onOpenReview/onOpenList/onOpenRedo/onRemoveMemo/onReplaceMemo`, `sessionId`, `playerRef`, `preferredMicrophoneId`.
	- Modes: `list` renders memo list with redo/delete; `review` shows transcript/timestamps and auto-accept progress; `redo` drives recorder UI (record/stop, uploading status, errors).
	- Sorting: memos sorted by `createdAt` or `sessionElapsedSeconds` descending; guards ensure missing memos redirect to list or close.
	- Auto-accept: 4s timer (`VOICE_MEMO_AUTO_ACCEPT_MS`) when `overlayState.autoAccept` is true; uses `startedAt` to compute progress and triggers keep.

- **Error Handling**
	- Recorder errors displayed in redo mode; reset errors when mode changes away from redo.
	- Delete actions fall back to list/close when last memo is removed.
	- Future: standardize errors as `{ code, message, retryable }` and surface retry/abort buttons in redo/processing states.

- **Extensibility Hooks**
	- Mic level adapter: add `onLevel` support in `useVoiceMemoRecorder` and store throttled level in context; pass level into overlay for VU rendering without extra re-renders.
	- Telemetry: fire structured events from context handlers (`voice_memo_overlay_shown`, `record_start/stop`, `processing_*`) with memoId/sessionId and elapsed; keep UI dumb.
	- Abort/timeout: wrap recorder processing in a cancellable promise; on timeout surface `retry/discard` CTA while keeping overlay mounted.

- **Testing Focus**
	- Pure units: state machine transitions, memo sorting, auto-accept timing, delete/redirect behavior when memos are missing.
	- Hooks: `useVoiceMemoRecorder` mocked media/Upload to verify state flags; context helpers ensure single overlay instance and correct memo wiring.

### Interface Contracts (JS, no TS)
- Recorder interface (implementation-agnostic):
	- `start()` -> begins capture; rejects/throws if mic unavailable or permissions denied.
	- `stop()` -> stops capture; resolves when local blob is ready and upload is triggered.
	- Event hooks (callbacks injected at construction): `onLevel(level0to1)`, `onStateChange(state)`, `onError({ code, message, retryable })`, `onMemoCaptured(memo)`, where `memo` carries ids, timestamps, transcript fields.

- Overlay controller / state machine API:
	- Inputs: `showList()`, `showReview(memoId, { autoAccept, startedAt })`, `showRedo(memoId)`, `close()`.
	- Derived state exposed to UI: `{ open, mode, memoId, autoAccept, startedAt, micLevel, recorderState: 'idle|recording|processing|error', error }`.
	- Controller invokes context mutators: `openVoiceMemoReview`, `openVoiceMemoRedo`, `openVoiceMemoList`, `closeVoiceMemoOverlay`, `add/remove/replace`.

- Memo DTO shape (normalized before UI):
	- `{ memoId, createdAt, sessionElapsedSeconds, videoTimeSeconds, transcriptClean, transcriptRaw, author, deviceLabel, status }`.
	- Sorting key: `createdAt` or `sessionElapsedSeconds` fallback; status guards: `recording|processing|ready|error`.

- Telemetry emitter (thin wrapper):
	- `emit(eventName, payload)`; expected events: `voice_memo_overlay_shown`, `voice_memo_record_start`, `voice_memo_record_stop`, `voice_memo_processing_start`, `voice_memo_processing_complete`, `voice_memo_processing_error`.
	- Payload always includes `{ memoId, sessionId, elapsedMs, device: preferredMicrophoneId }` where available.

## Multi-Phase Implementation Plan
- **Phase 1: Hardening & Wiring**
	- Add recorder contract enforcement in `useVoiceMemoRecorder` (explicit error surface, `onStateChange`, `onLevel` stubbed) without changing UI.
	- Ensure context mutators are the only overlay entry points; guard against multiple overlays; add null guards when memo missing.
	- Add telemetry emitter stub and log key events from context handlers.

- **Phase 2: UI State Machine + Processing Guardrails**
	- Introduce lightweight state machine inside an overlay controller hook: track `recording|processing|ready|error` sub-states for `redo` mode.
	- Keep overlay open through processing; disable Record/Stop while uploading; show processing spinner and retry/discard on failure.
	- Implement auto-accept timer in review mode using `startedAt` and `VOICE_MEMO_AUTO_ACCEPT_MS` (already present) with explicit controller ownership.

- **Phase 3: Mic Level Adapter + Performance**
	- Add mic-level adapter to `useVoiceMemoRecorder` (`onLevel`) with throttling to ~10–15 fps; store latest level in context/controller; render VU meter in overlay.
	- Validate render cost (profiling) and ensure updates do not trigger full overlay rerenders (only VU subcomponent updates).

- **Phase 4: Error/Timeout + Retry Semantics**
	- Standardize recorder/processing errors to `{ code, message, retryable }`; surface in overlay with Retry/Discard actions.
	- Wrap processing/upload in cancellable/timeout promise; on timeout, keep overlay mounted and offer retry/discard.

- **Phase 5: Telemetry + Tests**
	- Emit structured telemetry for overlay show/record start/stop/processing start/complete/error with `{ memoId, sessionId, elapsedMs, device }`.
	- Unit tests: state machine transitions, auto-accept timing, memo sorting, delete/redirect behavior, error retry flow. Hook tests: recorder flags (mocked media/upload), mic-level throttling.

- **Phase 6: Polish & Accessibility**
	- Add ARIA announcements for recording start/stop, ensure keyboard shortcuts/labels for Stop/Close.
	- Final UI/UX tweaks: focus management on mode switches, rN o need for mobile or responsive changes unless specifically requested.

## Current UI Flow (wireframe-level)

### Entry points
- Sidebar "Record" → immediately opens overlay in **redo/recording** mode (even for new memo).
- List view → tap a memo → **review** mode.
- List view → tap redo icon → **redo/recording** mode for that memo.

### Overlay modes (single instance)
1) **Redo / Recording**
```
┌────────────────────────────────────┐
│ Title: Record Voice Memo             │  [X]
│                                    │
│ [Transcript placeholder text]      │  (shows "Recording…" while recording,
│                                    │   "Processing voice memo…" while uploading)
│                                    │
│  Mic bar (live level)              │
│                                    │
│  Recording status + timer          │
│                                    │
│  [ Stop ◼ ]                        │ (primary, large)
│  [ Retry ] [ Discard ]             │ (shown only on error)
└────────────────────────────────────┘
```
	- Keyboard: Esc closes, Space stops while recording.
	- Live mic level updates ~10–15 fps.
	- Auto-start when opened without memoId.

2) **Redo / Processing** (same surface, Stop disabled)
```
┌────────────────────────────────────┐
│ Title: Record Voice Memo             │  [X]
│                                    │
│ Processing voice memo…             │
│ [spinner/progress text]            │
│                                    │
│  Mic bar hidden                    │
│                                    │
│  Recording stopped status          │
│                                    │
│  [ Stop ◼ ] (disabled)             │
└────────────────────────────────────┘
```

3) **Review** (after processing completes)
```
┌────────────────────────────────────┐
│ Title: Voice Memo Review           │  [X]
│                                    │
│ Transcript text (clean/raw)        │
│ Timestamp + optional video time    │
│                                    │
│ [ Keep ✓ ] [ Redo ↻ ] [ Delete 🗑 ]│
│ Auto-accept bar (if autoAccept)    │
└────────────────────────────────────┘
```

4) **List**
```
┌────────────────────────────────────┐
│ Title: Voice Memos                 │  [X]
│                                    │
│ List items: timestamp + transcript │
│ [Redo] [Delete] per row            │
│ Empty state when none              │
└────────────────────────────────────┘
```

### State transitions (happy path)
- Sidebar Record → `redo.recording` (auto start) → Stop → `redo.processing` → on capture → `review` (memoId set).
- From Review: Keep → close overlay; Redo → `redo.recording`; Delete → go to List (or close if none).
- From List: Redo row → `redo.recording`; Row tap → `review`; Delete last → close overlay.

### Error/timeouts
- Mic denied/start failure → show inline error in redo mode; offer Retry/Discard; stay mounted.
- Processing timeout → show error with Retry/Discard; stay in redo surface.

### Copy to fix
- Title should read **"Voice Memo"** for new captures; **"Record Voice Memo"** only when re-recording an existing memoId.
- Transcript placeholder should reflect phase: `Recording…` (recording), `Processing voice memo…` (uploading), real transcript only when ready.

### Open issues to align
- Ensure overlay does not auto-close when memoId is null and processing finishes; keep mounted until user keeps/discards.
- Route new captures to the generic **Voice Memo** title; reserve "Redo" for edits.