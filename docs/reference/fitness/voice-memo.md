# Fitness Voice Memo System

Voice memos allow users to record audio notes during fitness sessions. Recordings are automatically transcribed and stored with the session for later review.

Capture and transcription are two **separate durable stages**. The audio is written to storage before the transcription provider is called, so a provider outage leaves a retryable recording rather than nothing at all.

## Use Case

During a workout, users often want to capture thoughts, feedback, or notes without interrupting their exercise:

- **Mid-session notes**: "This episode is harder than usual" or "Feeling good today"
- **Post-session reflections**: "How did it go?" prompt after video ends
- **Quick feedback**: Record instead of typing while exercising

Voice memos are transcribed server-side and stored with the fitness session, allowing users to review their notes later.

## User Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           VOICE MEMO USER FLOW                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   TRIGGER    │────▶│    RECORD    │────▶│   PROCESS    │────▶│    REVIEW    │
│              │     │              │     │              │     │              │
│ • Record btn │     │ • Mic active │     │ • Upload     │     │ • Transcript │
│ • Post-video │     │ • Waveform   │     │ • Transcribe │     │ • Auto-accept│
│   prompt     │     │ • Timer      │     │ • Create memo│     │ • Keep/Redo  │
└──────────────┘     └──────┬───────┘     └──────────────┘     └──────┬───────┘
                           │                                          │
                           │ Stop                                     │
                           ▼                                          ▼
                    ┌──────────────┐                           ┌──────────────┐
                    │    CANCEL    │                           │     LIST     │
                    │              │                           │              │
                    │ • Discard    │                           │ • All memos  │
                    │ • Close      │                           │ • Redo/Delete│
                    └──────────────┘                           └──────────────┘
```

### Detailed State Transitions

```
                                    User clicks record
                                           │
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              REDO MODE (Recording)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│  • Mic permission requested                                                 │
│  • Video player paused (if playing)                                         │
│  • Music player paused (if playing)                                         │
│  • Recording auto-starts                                                    │
│  • Shows: waveform indicator, timer, stop button                            │
│  • Prompt: "How is it going?" (mid-session) / "How did it go?" (post-video) │
└─────────────────────────────────────────────────────────────────────────────┘
                           │                    │
              User stops   │                    │ User cancels / ESC
                           ▼                    ▼
┌─────────────────────────────────────────┐   ┌───────────────────────────────┐
│           PROCESSING STATE              │   │         CLOSED                │
├─────────────────────────────────────────┤   │  • Recording discarded        │
│  • Audio uploaded (base64)              │   │  • Video resumes              │
│  • Audio PERSISTED before transcription │   │  • Music resumes              │
│  • Transcription via Whisper            │   └───────────────────────────────┘
│  • Memo object created                  │
│  • Shows: "Transcribing..." spinner     │
│  • On provider failure: error + "your   │
│    recording is saved" notice           │
└─────────────────────────────────────────┘
                           │
                           │ Transcription complete
                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           REVIEW MODE                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  • Shows transcription text                                                 │
│  • Auto-accept countdown (8 seconds) - cancels on user interaction          │
│  • Actions: Keep (✓), Redo (↻), Delete (🗑)                                 │
└─────────────────────────────────────────────────────────────────────────────┘
        │              │              │
   Keep │         Redo │       Delete │
        ▼              ▼              ▼
┌────────────┐  ┌────────────┐  ┌────────────┐
│   SAVED    │  │ REDO MODE  │  │  REMOVED   │
│            │  │            │  │            │
│ Memo kept  │  │ Re-record  │  │ If last:   │
│ Close or   │  │ same slot  │  │ close      │
│ open list  │  │            │  │ Else: list │
└────────────┘  └────────────┘  └────────────┘
```

### List Mode

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              LIST MODE                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│  • Shows all memos for session (sorted by time, newest first)               │
│  • Each memo displays: timestamp, transcript                                │
│  • Per-memo actions: Redo, Delete                                           │
│  • Triggered by: counter badge click, or after delete in review mode        │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Architecture

### Component Hierarchy

```
FitnessContext (state management)
├── VoiceMemoPanel (sidebar trigger)
│   └── FitnessVoiceMemo
│       ├── Record button (●) → opens capture overlay
│       └── Counter badge (N) → opens list overlay
│
└── VoiceMemoOverlayModule (portal to body)
    └── VoiceMemoOverlay
        ├── useVoiceMemoRecorder (hook)
        └── Modes: list | review | redo
```

### Key Files

| File | Purpose |
|------|---------|
| `frontend/src/modules/Fitness/player/overlays/VoiceMemoOverlay.jsx` | Main overlay: 3 modes (list, review, redo), UI rendering |
| `frontend/src/modules/Fitness/player/panels/hooks/useVoiceMemoRecorder.js` | Recording hook: MediaRecorder, audio levels, upload |
| `frontend/src/modules/Fitness/player/panels/FitnessVoiceMemo.jsx` | Sidebar component with record/counter buttons |
| `frontend/src/hooks/fitness/VoiceMemoManager.js` | In-session memo list, duplicate prevention, auto-prompt gate |
| `frontend/src/context/FitnessContext.jsx` | State: memos array, overlay state, CRUD operations |
| `backend/src/4_api/v1/routers/fitness.mjs` | API endpoints under `/api/v1/fitness/voice_memo` |
| `backend/src/1_adapters/fitness/FilesystemVoiceMemoArtifactStore.mjs` | Durable capture store: audio + lifecycle record |
| `backend/src/2_domains/fitness/services/voiceMemoArtifactLifecycle.mjs` | Failure classification, backoff, retention policy |
| `backend/src/3_applications/fitness/services/FitnessVoiceMemoService.mjs` | Capture → transcribe → attach pipeline |
| `backend/src/3_applications/fitness/services/VoiceMemoRetryWorker.mjs` | Retry queue, crash recovery, retention sweep |

### Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              RECORDING FLOW                                 │
└─────────────────────────────────────────────────────────────────────────────┘

1. User triggers recording
   └── FitnessContext.openVoiceMemoCapture()
       └── Sets overlayState { open: true, mode: 'redo', memoId: null }

2. Overlay renders in redo mode
   └── useVoiceMemoRecorder.startRecording()
       ├── navigator.mediaDevices.getUserMedia({ audio: constraints })
       ├── new MediaRecorder(stream, { mimeType: 'audio/webm' })
       ├── startLevelMonitor() → onLevel callback for waveform
       └── Pauses video/music players

3. User stops recording
   └── useVoiceMemoRecorder.stopRecording()
       ├── mediaRecorder.stop() → triggers ondataavailable
       ├── Blob chunks → base64
       └── POST /api/v1/fitness/voice_memo { audioBase64, sessionId, context }

4. Backend: capture first
   ├── Decode + size check (12MB ceiling)
   ├── Write audio 0600 + open a `pending` lifecycle record
   └── ONLY THEN call the transcription provider

5. Backend: transcription outcome
   ├── success  → transcript on the record, raw audio purged, memo returned (200)
   ├── retryable failure → record moves to `retryable`, audio kept (502 + artifact)
   └── permanent failure → record moves to `permanently_failed`, audio kept (502 + artifact)

6. Frontend receives memo
   └── onMemoCaptured callback
       ├── addVoiceMemoToSession(memo)
       └── openVoiceMemoReview(memo, { autoAccept: true })

   On a 502 the overlay shows the transcription error AND a notice that the
   recording is saved; the retry worker takes it from there.

7. Review mode with auto-accept
   └── 8-second countdown (VOICE_MEMO_AUTO_ACCEPT_MS)
       ├── User interaction cancels countdown
       └── Countdown complete → handleAccept() → closes overlay
```

## Overlay State

Managed in `FitnessContext`:

```javascript
const VOICE_MEMO_OVERLAY_INITIAL = {
  open: false,
  mode: null,        // 'list' | 'review' | 'redo'
  memoId: null,      // target memo for review/redo
  autoAccept: false, // enable 8s countdown in review mode
  startedAt: null,   // countdown start time
  fromFitnessVideoEnd: false, // triggered by video end
  onComplete: null   // callback when overlay closes
};
```

### Mode Behaviors

| Mode | Purpose | Auto-starts Recording | Shows Memo |
|------|---------|----------------------|------------|
| `redo` | New recording or re-record existing | Yes | No |
| `review` | View/approve transcription | No | Yes |
| `list` | Browse all session memos | No | All |

## Memo Object Structure

```javascript
{
  memoId: 'vm_9fKq2mZx7Lp0Ab3T', // the artifact ref; one id for memo + recording
  artifactRef: 'vm_9fKq2mZx7Lp0Ab3T',
  transcriptRaw: 'raw whisper output',
  transcriptClean: 'cleaned/formatted text',
  sessionElapsedSeconds: 145,  // seconds into session
  videoTimeSeconds: 89,        // video timestamp
  createdAt: 1706123456789,    // unix ms
  title: null,                 // optional title
  context: {
    currentShow: 'Show Name',
    currentEpisode: 'Episode Title',
    activeUsers: ['User1', 'User2']
  }
}
```

## Special Behaviors

### Auto-Start Recording
When opening in `redo` mode, recording starts automatically via `useLayoutEffect`. This creates a seamless "tap to record" experience.

### Auto-Accept Countdown
After recording completes, review mode shows an 8-second countdown. The memo is automatically accepted unless the user interacts (mouse move, key press, touch). This prevents memos from getting stuck awaiting confirmation.

### "[No memo]" Detection
If transcription returns "[no memo]" or similar, the recording is automatically discarded and the user is prompted to re-record. This handles cases where the user spoke too quietly or there was no meaningful audio.

### Max Recording Duration
Recordings are capped at 5 minutes (`MAX_RECORDING_MS = 5 * 60 * 1000`). The recording automatically stops when this limit is reached.

### Cancel During Recording
When user cancels during active recording, `cancelUpload()` is called BEFORE `stopRecording()` to set `cancelledRef.current = true`. This ensures the MediaRecorder's `onstop` handler discards audio chunks instead of uploading them for transcription.

Cancellation belongs to one capture. A fresh `startRecording()` clears the
previous cancellation, including cancellation after a failed upload whose
recorder has already stopped. Queued data/stop events from an older recorder
are ignored after a replacement capture starts. Otherwise closing a failed
upload silently cancels the next recording when its stop event arrives.

### Durable capture

The audio is persisted before transcription is attempted, and every attempt is
a state transition on that stored record. A record is in exactly one state:

| State | Meaning |
|-------|---------|
| `pending` | Audio stored; no transcription attempt has started |
| `processing` | An attempt holds a lease (5 min); a stale lease is reclaimed |
| `retryable` | Last attempt failed for a retryable reason; `nextAttemptAt` is set |
| `transcribed` | Transcript stored and linked to the memo; raw audio purged |
| `permanently_failed` | Non-retryable failure, or the retry budget ran out |
| `expired` | Retention elapsed before success; audio purged, record kept |

**Storage.** `data/household[-{id}]/fitness/voice-memos/{ref}.{ext}` for the
audio (mode 0600) and `{ref}.json` for the record. The ref is opaque
(`vm_` + 16 chars) and doubles as the memo's `memoId`, so a memo, its
recording, and its retry history share one id — which is also what makes a
re-appended memo idempotent. The record holds only what recovery needs: ref,
session correlation, timestamps, media type/size, sha256 checksum, attempt
counter, next-attempt time, and a sanitized failure classification.

**Retry worker.** `fitness:voice-memo-retry` runs every minute (agents
Scheduler, production-gated). Each tick reclaims stale leases, runs up to five
due artifacts, applies retention, and removes orphan audio left by a crash
between the two writes.

### Failure classification

An HTTP status alone cannot say whether waiting will help, so every provider
failure is reduced to one class. Only the retryable classes are scheduled
automatically; the rest keep their audio so a human can retry once the cause
is fixed.

| Class | Trigger | Auto-retried |
|-------|---------|--------------|
| `network_timeout` | socket codes (ECONNRESET, ETIMEDOUT, …), "socket hang up" | yes |
| `provider_unavailable` | HTTP 5xx | yes |
| `rate_limited` | HTTP 429 with no quota marker | yes |
| `quota_exhausted` | `insufficient_quota` / `credit_balance_exhausted`, HTTP 402 | yes, slowly |
| `auth_failed` | HTTP 401/403 | no |
| `invalid_audio` | HTTP 400/413/415/422 | no |
| `unknown` | anything else | yes |

Backoff is 1m → 5m → 15m → 1h → 3h, six attempts total. `quota_exhausted` uses
a much slower ladder (30m → 1h → 2h → 6h → 12h) because it does not clear on
its own — someone has to restore credit, and retrying every minute would burn
the whole budget before anyone noticed.

### Retention and privacy

Raw voice is personal data. It exists only under the artifact directory, never
in the repo, the log store, an analytics event, or a debug directory.

| Policy | Value |
|--------|-------|
| Max capture | 12 MB (a 5-minute Opus memo is ≈1.2 MB) |
| Audio after a successful transcript | purged immediately |
| Audio for an untranscribed capture | 7 days, then the record `expires` |
| Audio for a permanent failure | 7 days, so a human retry is still possible |
| Lifecycle record after it settles | 30 days, then deleted |
| Encryption at rest | none beyond host filesystem permissions (0600) |

Logs carry lengths and classifications, never transcript text, audio bytes,
API keys, request headers, or provider response bodies.

### Diagnosing failed transcription

Distinguish `recording-stop-cancelled` (audio discarded in the browser, before
any upload) from `fitness.voice_memo.attempt.failed` (the provider received the
request). The latter records the classification, HTTP status, provider
error code/type, provider request ID, and whether a retry is scheduled.

Lifecycle events, all keyed by the opaque ref:

| Event | Meaning |
|-------|---------|
| `fitness.voice_memo.artifact.captured` | Bytes on disk; size and checksum recorded |
| `fitness.voice_memo.attempt.started` / `.succeeded` / `.failed` | One transcription attempt |
| `fitness.voice_memo.artifact.transcribed` | Transcript linked; whether it reached the session |
| `fitness.voice_memo.artifact.persist_deferred` | Transcript held until the session can accept it |
| `fitness.voice_memo.artifact.audio_purged` | Raw audio removed, with the reason |
| `fitness.voice_memo.artifact.lease_reclaimed` | An attempt died mid-flight and was recovered |
| `fitness.voice_memo.artifact.permanently_failed` | Gave up, with `givenUpReason` |
| `fitness.voice_memo.artifact.expired` | Aged out before it ever became a memo (logged at error) |
| `fitness.voice_memo.worker.tick` | Per-sweep counters |

`fitness.voice_memo.artifact.capture_failed` is the one event that means a
recording is genuinely at risk: the store could not write, so the request falls
back to transcribing from memory and nothing survives a provider failure.

### Portal Rendering
The overlay renders via `ReactDOM.createPortal` to `document.body`, ensuring it appears above all other content regardless of where it's triggered from.

## API Reference

### POST /api/v1/fitness/voice_memo

Transcribe audio and create a memo object.

**Request:**
```json
{
  "audioBase64": "data:audio/webm;base64,...",
  "mimeType": "audio/webm",
  "sessionId": "20260204-abc123",
  "startedAt": 1706123456789,
  "endedAt": 1706123466789,
  "context": {
    "currentShow": "Show Name",
    "currentEpisode": "Episode Title",
    "activeUsers": ["User1"],
    "householdId": "default"
  }
}
```

**200 — transcribed:**
```json
{
  "ok": true,
  "memo": {
    "memoId": "vm_9fKq2mZx7Lp0Ab3T",
    "artifactRef": "vm_9fKq2mZx7Lp0Ab3T",
    "transcriptRaw": "...",
    "transcriptClean": "...",
    "createdAt": 1706123466789
  },
  "artifact": { "ref": "vm_9fKq2mZx7Lp0Ab3T", "state": "transcribed", "audioAvailable": false }
}
```

**502 — the provider failed, the recording did not:**
```json
{
  "ok": false,
  "error": "Transcription failed; the recording is saved and will be retried",
  "retryScheduled": true,
  "artifact": {
    "ref": "vm_9fKq2mZx7Lp0Ab3T",
    "state": "retryable",
    "attempts": 1,
    "maxAttempts": 6,
    "nextAttemptAt": 1706125266789,
    "audioAvailable": true,
    "lastFailure": { "classification": "quota_exhausted", "retryable": true, "providerStatus": 429 }
  }
}
```

Other statuses: `400` undecodable payload, `413` past the 12MB ceiling,
`503` transcription not configured.

### GET /api/v1/fitness/voice_memo/artifacts

Staff view of capture lifecycle — which memos are recorded, awaiting
transcription, transcribed, or unavailable. Query: `sessionId`, `state`
(comma-separated), `householdId`, `limit`. Returns state and diagnostics only;
never the audio or the transcript.

### POST /api/v1/fitness/voice_memo/artifacts/:ref/retry

Runs an attempt immediately, ignoring the record's backoff, and resets the
retry budget. This is the recovery path for the classes the worker will not
schedule on its own — a replaced API key, restored credit. `404` for an unknown
ref, `409` while an attempt already holds the lease, `502` if it fails again.

## Keyboard Shortcuts

| Key | Context | Action |
|-----|---------|--------|
| `Escape` | Any mode | Close overlay, discard if recording |
| `Space` | Recording | Stop recording |

## Related Documentation

- [Governance Engine](./governance-engine.md) - Content selection rules
- [Assign Guest](./assign-guest.md) - User assignment during sessions
