# Fitness Voice Memo System

Voice memos allow users to record audio notes during fitness sessions. Recordings are automatically transcribed and stored with the session for later review.

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
│  • Transcription via Whisper            │   │  • Music resumes              │
│  • Memo object created                  │   └───────────────────────────────┘
│  • Shows: "Transcribing..." spinner     │
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
| `frontend/src/modules/Fitness/modules/overlays/VoiceMemoOverlayModule.jsx` | Entry point wrapper, passes props to implementation |
| `frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.jsx` | Main overlay: 3 modes (list, review, redo), UI rendering |
| `frontend/src/modules/Fitness/FitnessSidebar/useVoiceMemoRecorder.js` | Recording hook: MediaRecorder, audio levels, upload |
| `frontend/src/modules/Fitness/FitnessSidebar/FitnessVoiceMemo.jsx` | Sidebar component with record/counter buttons |
| `frontend/src/modules/Fitness/modules/sidebar/VoiceMemoPanel.jsx` | Panel wrapper for sidebar integration |
| `frontend/src/context/FitnessContext.jsx` | State: memos array, overlay state, CRUD operations |
| `backend/src/4_api/v1/routers/fitness.mjs` | API endpoint `/api/v1/fitness/voice_memo` |

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

4. Backend processing
   └── transcriptionService.transcribeVoiceMemo()
       ├── Audio decoding
       ├── Whisper transcription
       └── Returns memo { memoId, transcriptRaw, transcriptClean, ... }

5. Frontend receives memo
   └── onMemoCaptured callback
       ├── addVoiceMemoToSession(memo)
       └── openVoiceMemoReview(memo, { autoAccept: true })

6. Review mode with auto-accept
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
  memoId: 'uuid',
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

**Response:**
```json
{
  "ok": true,
  "memo": {
    "memoId": "uuid",
    "transcriptRaw": "...",
    "transcriptClean": "...",
    "sessionElapsedSeconds": 145,
    "createdAt": 1706123466789
  }
}
```

## Keyboard Shortcuts

| Key | Context | Action |
|-----|---------|--------|
| `Escape` | Any mode | Close overlay, discard if recording |
| `Space` | Recording | Stop recording |

## Related Documentation

- [Governance Engine](./governance-engine.md) - Content selection rules
- [Assign Guest](./assign-guest.md) - User assignment during sessions
