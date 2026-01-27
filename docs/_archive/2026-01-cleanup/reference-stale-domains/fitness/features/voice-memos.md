# Voice Memos Feature

> **Related code:** `frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.jsx`, `frontend/src/modules/Fitness/FitnessSidebar/useVoiceMemoRecorder.js`, `frontend/src/hooks/fitness/VoiceMemoManager.js`, `backend/routers/fitness.mjs`

Complete specification for voice memo capture, transcription, and lifecycle during fitness sessions.

---

## Overview

Voice memos allow users to record spoken notes during workouts. The feature captures audio via the browser's MediaRecorder API, transcribes it using OpenAI Whisper, cleans the transcript with GPT-4o, and stores memos in the session for later review.

**Key behaviors:**
- Video automatically pauses during recording and resumes after
- Real-time mic level visualization provides recording feedback
- Auto-accept timer (8 seconds) saves memo if user doesn't act
- Duplicate prevention catches same memoId or same transcript within 5 seconds

---

## Core Components

| Component | File | Responsibility |
|-----------|------|----------------|
| `VoiceMemoOverlay` | `FitnessPlayerOverlay/VoiceMemoOverlay.jsx` | Main UI overlay with modes |
| `useVoiceMemoRecorder` | `FitnessSidebar/useVoiceMemoRecorder.js` | Recording hook, MediaRecorder, metering |
| `MicLevelIndicator` | `shared/primitives/MicLevelIndicator/` | Audio level visualization |
| `VoiceMemoManager` | `hooks/fitness/VoiceMemoManager.js` | In-memory memo storage |
| `FitnessVoiceMemo` | `FitnessSidebar/FitnessVoiceMemo.jsx` | Sidebar trigger button |
| Backend endpoint | `backend/routers/fitness.mjs:493-554` | Whisper + GPT-4o transcription |

---

## User Stories

### Primary Flow

1. **As a user mid-workout**, I want to record a quick voice note so I can capture thoughts without stopping my exercise.

2. **As a user**, I want the video to automatically pause when I start recording so my voice isn't drowned out by workout audio.

3. **As a user**, I want to see my recording is working via a mic level indicator so I know the system is capturing my voice.

4. **As a user**, I want my speech transcribed automatically so I can read my notes later without listening to audio.

5. **As a user**, I want to review and approve the transcript before saving so I can redo if transcription was poor.

6. **As a user**, I want an auto-accept timer so if I walk away, my memo is saved rather than lost.

### Secondary Flows

7. **As a user**, I want to redo a recording if the transcription was wrong so I can get an accurate note.

8. **As a user**, I want to delete a recording if I changed my mind so unwanted memos aren't saved.

9. **As a user**, I want to view all my session memos in a list so I can see what I've recorded.

10. **As a user**, I want my video to resume automatically after recording so I can continue my workout seamlessly.

---

## State Machine

### Recorder States

```
                         ┌────────────────────────────────────────┐
                         │                                        │
                         ▼                                        │
┌─────────┐         ┌───────────┐         ┌───────────┐    ┌──────┴─────┐
│  IDLE   │────────▶│ REQUESTING│────────▶│ RECORDING │───▶│ PROCESSING │
└─────────┘         └───────────┘         └───────────┘    └────────────┘
     ▲                   │                      │                 │
     │                   │ (permission          │ (user           │
     │                   │  denied)             │  cancels)       │
     │                   ▼                      ▼                 ▼
     │              ┌─────────┐           ┌─────────┐       ┌─────────┐
     └──────────────│  ERROR  │◀──────────│  IDLE   │       │  READY  │
                    └─────────┘           └─────────┘       └─────────┘
                         │                                        │
                         │ (user retries)                         │
                         └────────────────────────────────────────┘
```

### Overlay Modes

| Mode | Purpose | Entry Condition |
|------|---------|-----------------|
| `list` | View all memos | Default when overlay opens |
| `redo` | Recording interface | User clicks Record or Redo |
| `review` | Approve/redo/delete transcript | Recording complete, transcript ready |

### Mode Transitions

```
list ──(Record clicked)──▶ redo
redo ──(Recording done)──▶ review
review ──(Accept)──▶ list
review ──(Redo)──▶ redo
review ──(Delete)──▶ list
review ──(Auto-accept timer)──▶ list
```

---

## Recording Flow

### 1. Initiation

**Trigger:** User taps Voice Memo FAB or Record button

**Pre-conditions checked:**
- Microphone permission (prompt if not granted)
- Microphone hardware availability
- Preferred microphone device (falls back to default)

**Actions on start:**
1. Clear previous errors
2. Set recorder state to `requesting`
3. Pause video if currently playing (save playback state)
4. Request microphone access via `getUserMedia()`
5. Initialize MediaRecorder with `audio/webm` MIME type
6. Start audio level metering via Web Audio API
7. Begin recording, start duration timer
8. Set recorder state to `recording`

**Location:** `useVoiceMemoRecorder.js:291-340`

### 2. During Recording

**Active processes:**
- MediaRecorder captures audio chunks
- Web Audio analyser samples amplitude at ~14fps
- Duration timer updates every 100ms
- Mic level indicator reflects audio input

**Audio level metering:**
```javascript
// Web Audio setup
const audioContext = new AudioContext();
const analyser = audioContext.createAnalyser();
analyser.fftSize = 256;
const source = audioContext.createMediaStreamSource(stream);
source.connect(analyser);

// Sampling loop (every ~70ms)
const buf = new Uint8Array(analyser.fftSize);
analyser.getByteTimeDomainData(buf);
const sumSquares = buf.reduce((acc, v) => acc + (v - 128) ** 2, 0);
const rms = Math.sqrt(sumSquares / buf.length);
const level = Math.min(1, rms * 1.8);  // Normalize 0-1
```

**Location:** `useVoiceMemoRecorder.js:186-227`

### 3. Stop Recording

**Trigger:** User taps Stop button

**Actions:**
1. Stop MediaRecorder
2. Set recorder state to `processing`
3. Clean up duration timer
4. Stop audio level metering
5. Resume video if we paused it earlier
6. Clear level indicator

**Location:** `useVoiceMemoRecorder.js:342-356`

### 4. Transcription

**Client-side:**
1. Combine audio chunks into Blob
2. Convert Blob to base64
3. Build payload: `{ audioBase64, mimeType, sessionId, startedAt, endedAt }`
4. POST to `/api/fitness/voice_memo` with 15s timeout

**Server-side (fitness.mjs:493-554):**
1. Decode base64 to temporary file
2. Transcribe with Whisper-1:
   ```javascript
   const transcription = await openai.audio.transcriptions.create({
     file: fs.createReadStream(filePath),
     model: 'whisper-1'
   });
   ```
3. Clean with GPT-4o:
   ```javascript
   const cleanResp = await openai.chat.completions.create({
     model: 'gpt-4o',
     messages: [
       { role: 'system', content: 'You clean short workout voice memos. Remove duplicates, filler words, and transcription glitches. Preserve numeric data and user intent. Return only cleaned text.' },
       { role: 'user', content: transcriptRaw }
     ],
     temperature: 0.2,
     max_tokens: 400
   });
   ```
4. Return memo object with both transcripts

**Response payload:**
```javascript
{
  memoId: 'memo_1735689600000_abc123',
  transcriptRaw: 'uh like 15 reps of squats I think',
  transcriptClean: '15 reps of squats',
  sessionId: 'fs_20260108120000',
  durationSeconds: 8.5,
  videoTimeSeconds: 245,
  sessionElapsedSeconds: 600
}
```

### 5. Review Phase

**UI elements:**
- Transcript display (large, readable)
- Timestamp showing video position
- Three action buttons: Keep, Redo, Delete
- Auto-accept progress bar (8 seconds)

**Auto-accept timer:**
- Starts when review mode enters
- Progress bar fills over 8 seconds
- If timer expires without user action, memo is saved
- User clicking Keep/Redo/Delete cancels timer

**Location:** `VoiceMemoOverlay.jsx:485-526`

### 6. Save & Persist

**On accept (manual or auto):**
1. Call `addVoiceMemoToSession(memo)` from context
2. VoiceMemoManager adds to in-memory array
3. Duplicate check: reject if same memoId exists
4. Duplicate check: reject if same transcript within 5 seconds
5. Trigger mutation callback for UI re-render
6. Close overlay or return to list mode

**Location:** `VoiceMemoManager.js:19-71`

---

## Media Pause/Resume

### Pause on Record Start

**Location:** `useVoiceMemoRecorder.js:36-50`

```javascript
const pauseMediaIfNeeded = (playerRef, wasPlayingBeforeRecordingRef) => {
  const api = playerRef?.current;
  if (!api) { wasPlayingBeforeRecordingRef.current = false; return; }

  const playbackState = resolvePlaybackState(api);
  if (playbackState && playbackState.isPaused === false) {
    wasPlayingBeforeRecordingRef.current = true;
    api.pause?.();
    return;
  }
  wasPlayingBeforeRecordingRef.current = false;
};
```

**Behavior:**
- Checks if video is currently playing
- If playing, pauses it and sets flag to remember
- If already paused, does nothing (no spurious resume later)

### Resume on Record Stop

**Location:** `useVoiceMemoRecorder.js:52-61`

```javascript
const resumeMediaIfNeeded = (playerRef, wasPlayingBeforeRecordingRef) => {
  if (!wasPlayingBeforeRecordingRef.current) return;
  const api = playerRef?.current;
  if (!api) { wasPlayingBeforeRecordingRef.current = false; return; }
  api.play?.();
  wasPlayingBeforeRecordingRef.current = false;
};
```

**Behavior:**
- Only resumes if we actually paused it
- Resets flag after resuming
- Handles missing player ref gracefully

---

## Mic Level Indicator

### Component

**Location:** `shared/primitives/MicLevelIndicator/MicLevelIndicator.jsx`

**Props:**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `level` | number | 0 | Normalized 0-100 value |
| `bars` | number | 5 | Number of level segments |
| `orientation` | string | `horizontal` | `horizontal` or `vertical` |
| `size` | string | `md` | `sm`, `md`, `lg` |
| `variant` | string | `bars` | `bars`, `waveform`, `arc` |
| `activeColor` | string | `#ff6b6b` | Bar fill color |

**Variants:**
- `bars`: Static level segments that fill based on level
- `waveform`: Animated bars with staggered animation
- `arc`: Circular arc indicator

### Metering Implementation

**Sampling rate:** ~14fps (requestAnimationFrame with 70ms throttle)

**Algorithm:**
1. Get time-domain data from Web Audio analyser
2. Calculate RMS (root mean square) of samples
3. Apply gain multiplier (1.8x) to scale sensitivity
4. Clamp to 0-1 range
5. Emit via `onLevel` callback

**Failure handling:**
- If AudioContext creation fails, metering fails silently
- Recording continues without visual feedback
- No error shown to user (potential UX issue)

---

## Duplicate Prevention

### Location

`VoiceMemoManager.js:29-48`

### Check 1: Same memoId

```javascript
const existingById = this.memos.find(m =>
  String(m.memoId) === String(newMemo.memoId)
);
if (existingById) {
  return existingById;  // Already exists, reject
}
```

**Purpose:** Prevents exact duplicate from network retry or double-submit.

### Check 2: Same transcript within time window

```javascript
const DUPLICATE_WINDOW_MS = 5000;
const transcriptToMatch = newMemo.transcriptRaw || newMemo.transcriptClean || '';

if (transcriptToMatch) {
  const existingByContent = this.memos.find(m => {
    const existingTranscript = m.transcriptRaw || m.transcriptClean || '';
    if (!existingTranscript || existingTranscript !== transcriptToMatch) return false;
    const timeDiff = Math.abs((m.createdAt || 0) - (newMemo.createdAt || 0));
    return timeDiff < DUPLICATE_WINDOW_MS;
  });
  if (existingByContent) {
    return existingByContent;  // Duplicate content, reject
  }
}
```

**Purpose:** Catches accidental double-recordings of same phrase.

**Window:** 5 seconds (may be too aggressive for intentional repeats)

---

## Error Handling

### Error Sources

| Error | Location | Retryable | User Message |
|-------|----------|-----------|--------------|
| Missing API key | fitness.mjs:495 | No | "OPENAI_API_KEY not configured" |
| Invalid audio payload | fitness.mjs:498 | No | "audioBase64 required" |
| Mic access denied | useVoiceMemoRecorder:337 | No | "Failed to access microphone" |
| Transcription timeout | useVoiceMemoRecorder:266 | Yes | "Processing timed out" |
| Upload failed | useVoiceMemoRecorder:281 | Yes | "Upload failed" |
| Metering failure | useVoiceMemoRecorder:224 | N/A | None (silent) |

### Error Object Structure

```javascript
{
  code: 'recorder_error',      // Error category
  message: 'Human-readable message',
  retryable: true,             // Can user retry?
  error: Error                 // Original error object
}
```

### Error Display

**Location:** `VoiceMemoOverlay.jsx:550, 587-593`

- Error message shown in red box
- Retry button shown only if `retryable === true`
- Discard button always available

---

## Data Model

### Memo Object

```javascript
{
  memoId: 'memo_1735689600000_abc123',  // Unique ID
  transcriptRaw: 'Original Whisper output',
  transcriptClean: 'Cleaned GPT-4o output',
  sessionId: 'fs_20260108120000',
  durationSeconds: 8.5,
  videoTimeSeconds: 245,                 // Video timestamp when recorded
  sessionElapsedSeconds: 600,            // Session time when recorded
  createdAt: 1735689600000,              // Unix timestamp
  author: 'kckern'                       // User who recorded
}
```

### Saved Format (in session YAML)

```yaml
events:
  voice_memos:
    - at: '2026-01-08 12:30:45'
      id: memo_1735689600000_abc123
      duration_seconds: 8.5
      transcript: 15 reps of squats
```

---

## Edge Cases

### Recording Phase

| Scenario | Current Behavior | Status |
|----------|------------------|--------|
| Mic permission denied | Error with instructions | OK |
| Mic hardware unavailable | Falls back to default, then errors | OK |
| Cancel mid-recording | Stops recorder, discards, resets | OK |
| Close overlay mid-recording | Stops recording first, then closes | OK |
| Very long recording (>2min) | No limit, may timeout on upload | RISK |
| Very short recording (<1s) | Proceeds normally | OK |
| Silence / no speech | Empty transcript returned | OK |
| Browser tab hidden | MediaRecorder continues | OK |

### Transcription Phase

| Scenario | Current Behavior | Status |
|----------|------------------|--------|
| Transcription fails | Falls back to raw transcript | OK |
| Transcription timeout | 15s limit, retryable error | OK |
| Network fails during upload | Error with retry option | OK |
| GPT-4o cleaning fails | Falls back to raw (silent) | OK |

### Review Phase

| Scenario | Current Behavior | Status |
|----------|------------------|--------|
| User accepts | Save memo, close/return to list | OK |
| User redoes | Discard current, go to redo mode | OK |
| User deletes | Discard, close/return to list | OK |
| User closes overlay | Unclear behavior | UNCLEAR |
| Auto-accept timer expires | Save memo, return to list | OK |

### Persistence

| Scenario | Current Behavior | Status |
|----------|------------------|--------|
| Duplicate memoId | Rejected | OK |
| Duplicate transcript <5s | Rejected | OK |
| Session ends | Memos saved in session YAML | OK |
| Page refresh | Memos in memory lost | EXPECTED |

---

## Known Issues & Gaps

### 1. Fitness Vocabulary Seeding - FIXED

**Solution implemented:** Whisper prompt now includes fitness context:
```javascript
const transcription = await openai.audio.transcriptions.create({
  file: fs.createReadStream(filePath),
  model: 'whisper-1',
  prompt: 'Transcribe this description of a fitness workout. Common terms: reps, sets, squats, lunges, burpees, HIIT, intervals, warmup, cooldown, rest, cardio, weights, dumbbells, kettlebell, pushups, pullups, planks, crunches.'
});
```

**Location:** `backend/routers/fitness.mjs:509-514`

### 2. Mic Level Indicator - FIXED

**Solution implemented:**
- Waveform now reflects actual mic level (was using random heights)
- Bar heights calculated based on normalized level value
- Active state animation only when level > 5%
- Container has explicit height (3rem) for percentage-based child sizing

**Location:** `MicLevelIndicator.jsx:33-63`, `MicLevelIndicator.scss:26-44`

### 3. Max Recording Duration - FIXED

**Solution implemented:** 5-minute maximum recording duration.

```javascript
const MAX_RECORDING_MS = 5 * 60 * 1000;  // 5 minutes

// In duration interval, auto-stop when limit reached
if (elapsed >= MAX_RECORDING_MS) {
  mediaRecorderRef.current?.stop();
  // cleanup...
}
```

**Location:** `useVoiceMemoRecorder.js:37-38, 337-349`

### 4. Close During Review = Discard - FIXED

**Solution implemented:** Closing overlay during review mode discards the pending memo.

```javascript
const handleClose = useCallback(() => {
  if (overlayState?.mode === 'review' && overlayState?.memoId) {
    onRemoveMemo?.(overlayState.memoId);
  }
  onClose?.();
}, [...]);
```

**Location:** `VoiceMemoOverlay.jsx:134-142`

### 5. Memos Persisted via Session Save - VERIFIED

**Already working:** Voice memos ARE persisted to YAML via session save mechanism.

Flow:
1. `FitnessSession.summary` includes `voiceMemos: this.voiceMemoManager.summary`
2. `PersistenceManager` converts them to events with type `'voice_memo'`
3. `SessionSerializerV3` serializes them to `events.voice_memos` in YAML

**Locations:** `FitnessSession.js:2178`, `PersistenceManager.js:492-506`, `SessionSerializerV3.js:147-148, 207-215`

---

## Configuration

### Timeouts

| Constant | Value | Location |
|----------|-------|----------|
| Max recording duration | 300000ms (5 min) | useVoiceMemoRecorder:37-38 |
| Transcription timeout | 15000ms | useVoiceMemoRecorder:184 |
| Auto-accept duration | 8000ms | VoiceMemoOverlay.jsx |
| Duplicate window | 5000ms | VoiceMemoManager:36 |

### Audio Settings

| Setting | Value | Location |
|---------|-------|----------|
| MIME type | `audio/webm` | useVoiceMemoRecorder:309 |
| FFT size | 256 | useVoiceMemoRecorder:193 |
| Level gain | 1.8x | useVoiceMemoRecorder:216 |
| Sample rate | ~14fps | useVoiceMemoRecorder:202 |

---

## API Reference

### POST /api/fitness/voice_memo

**Request:**
```javascript
{
  audioBase64: 'base64-encoded-audio-data',
  mimeType: 'audio/webm',
  sessionId: 'fs_20260108120000',
  startedAt: 1735689600000,
  endedAt: 1735689608500
}
```

**Response (success):**
```javascript
{
  ok: true,
  memoId: 'memo_1735689600000_abc123',
  transcriptRaw: 'Original Whisper output',
  transcriptClean: 'Cleaned GPT-4o output',
  durationSeconds: 8.5
}
```

**Response (error):**
```javascript
{
  ok: false,
  error: 'Error message',
  code: 'ERROR_CODE'
}
```

---

## Future Considerations

1. **Audio playback** - Allow user to listen to recording before accepting
2. **Edit transcript** - Allow manual corrections before saving
3. **Fitness vocabulary training** - Learn user's exercise vocabulary over time
4. **Offline support** - Queue recordings for upload when connection restored
5. **Persistent audio storage** - Save raw audio alongside transcript
6. **Multi-language support** - Detect and transcribe non-English speech

---

**Last updated:** 2026-01-08
