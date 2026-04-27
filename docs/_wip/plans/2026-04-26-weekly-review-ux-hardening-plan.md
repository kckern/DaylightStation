# Weekly Review UX Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the WeeklyReview widget so audio capture is mandatory, no audio can ever be lost, and navigation follows a predictable 4-level hierarchy (TOC → Day → Fullscreen).

**Architecture:** Refactor `WeeklyReview.jsx` around a `viewLevel` state machine with a hard pre-flight mic gate. Add disconnect detection + bounded reconnect to `useAudioRecorder`. Replace Enter-opens-detail with Enter-uploads (recording continues). Remove every Discard affordance. Backend: extend bootstrap to 8 past days (excluding today); patch finalize for repeat calls via atomic rename.

**Tech Stack:** React, Vitest + @testing-library/react for hooks, Playwright for integration, Express on the backend.

**Spec:** [`docs/_wip/plans/2026-04-26-weekly-review-ux-hardening-design.md`](./2026-04-26-weekly-review-ux-hardening-design.md)

---

## File Map

### Backend (modify)
- `backend/src/3_applications/weekly-review/WeeklyReviewService.mjs` — bootstrap day-window logic; finalize atomic-rename for repeat-call safety.

### Frontend (modify)
- `frontend/src/modules/WeeklyReview/WeeklyReview.jsx` — state machine rewrite, pre-flight gate, navigation, Enter-uploads, no-Discard.
- `frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.js` — first-audible-frame, disconnect detection, bounded reconnect.
- `frontend/src/modules/WeeklyReview/components/RecordingBar.jsx` — MIC LIVE/LOST indicator, brief Uploading flash.
- `frontend/src/modules/WeeklyReview/components/DayDetail.jsx` — remove close button + close handler; stop owning keyboard.
- `frontend/src/modules/WeeklyReview/components/DayColumn.jsx` — remove `isToday` highlight (today is no longer in the grid).
- `frontend/src/modules/WeeklyReview/WeeklyReview.scss` — styles for pre-flight overlay, fullscreen image, mic indicator.

### Frontend (create)
- `frontend/src/modules/WeeklyReview/components/PreFlightOverlay.jsx` — pre-flight gating overlay with timeout/Retry/Exit.
- `frontend/src/modules/WeeklyReview/components/FullscreenImage.jsx` — single-image fullscreen view with index indicator.
- `frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.test.js` — vitest unit tests for hook hardening.
- `tests/live/flow/weekly-review/weekly-review-ux.runtime.test.mjs` — Playwright integration test.

---

## Phase 1: Backend

### Task 1: Bootstrap returns 8 past days (excluding today)

**Files:**
- Modify: `backend/src/3_applications/weekly-review/WeeklyReviewService.mjs:32-64`, `:421-428` (`#defaultWeekStart`)

The current bootstrap returns 7 days starting from a "week start" 7 days ago. New behavior: 8 most recent past days, ending yesterday. The session key (`week`) stays as the start date string (used to scope chunk uploads) but now means "the start of the 8-day window".

- [ ] **Step 1: Update `#defaultWeekStart` to return today-minus-8**

Replace the contents of `#defaultWeekStart` (lines ~421-428):

```javascript
#defaultWeekStart() {
  // Past 8 days, excluding today. Window = [today-8, today-1].
  const tz = process.env.TZ || 'UTC';
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - 8);
  const year = start.toLocaleString('en-CA', { year: 'numeric', timeZone: tz });
  const month = start.toLocaleString('en-CA', { month: '2-digit', timeZone: tz });
  const day = start.toLocaleString('en-CA', { day: '2-digit', timeZone: tz });
  return `${year}-${month}-${day}`;
}
```

- [ ] **Step 2: Update bootstrap to use 8-day window**

In `bootstrap` (lines ~32-44), change `const end = this.#addDays(start, 7);` to `const end = this.#addDays(start, 8);`. The date-list loop already handles arbitrary windows correctly. Result: 8 dates from `start` through `start + 7`, which is `today - 8` through `today - 1`.

- [ ] **Step 3: Verify by manual API call**

Run from kckern-server:

```bash
sudo docker exec daylight-station sh -c 'curl -s http://localhost:3111/api/v1/weekly-review/bootstrap' | head -c 400
```

Expected: response JSON has `"days": [...]` with length 8, and the highest `date` is yesterday's date (not today's).

- [ ] **Step 4: Commit**

```bash
git add backend/src/3_applications/weekly-review/WeeklyReviewService.mjs
git commit -m "feat(weekly-review): bootstrap returns past 8 days excluding today"
```

---

### Task 2: Finalize tolerates repeat calls (atomic rename)

**Files:**
- Modify: `backend/src/3_applications/weekly-review/WeeklyReviewService.mjs:297-352`
- Modify: chunk-write path — find with `grep -n "draft" backend/src/3_applications/weekly-review/WeeklyReviewService.mjs` and confirm it appends to `${sessionId}.webm` (creates if missing).

**Why:** `finalizeDraft` reads the draft file then `unlinkSync` deletes it. If chunks arrive between read and unlink, those bytes are lost. Repeat finalize calls also fail because the draft is gone.

**Fix:** Atomically rename the draft to a `.processing-<timestamp>.webm` filename before reading, so concurrent chunk-write calls hit a brand-new draft file. Subsequent finalize calls operate on the fresh draft.

- [ ] **Step 1: Add atomic rename at the start of finalizeDraft**

In `finalizeDraft` (around line 304, immediately after the existence check), replace:

```javascript
if (!fs.existsSync(draftPath)) throw new Error(`draft not found: ${sessionId}`);

this.#logger.info?.('weekly-review.finalize.start', { sessionId, week, duration });
const buffer = fs.readFileSync(draftPath);
```

with:

```javascript
if (!fs.existsSync(draftPath)) throw new Error(`draft not found: ${sessionId}`);

// Atomically rename so concurrent chunk-writes hit a fresh draft.
// This makes repeat-finalize calls within the same session safe — each call
// processes the bytes accumulated since the previous finalize.
const stamp = Date.now();
const processingPath = path.join(draftDir, `${sessionId}.processing-${stamp}.webm`);
fs.renameSync(draftPath, processingPath);

this.#logger.info?.('weekly-review.finalize.start', { sessionId, week, duration, processingPath });
const buffer = fs.readFileSync(processingPath);
```

- [ ] **Step 2: Replace the unlink to point at the renamed file**

Toward the end of `finalizeDraft` (around line 347), replace:

```javascript
// Delete draft
fs.unlinkSync(draftPath);
if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
```

with:

```javascript
// Delete the processing snapshot. The metadata file may be re-created by
// concurrent chunk writes — leave it alone; the next finalize will manage it.
fs.unlinkSync(processingPath);
if (fs.existsSync(metaPath) && !fs.existsSync(draftPath)) fs.unlinkSync(metaPath);
```

The guard `!fs.existsSync(draftPath)` ensures we only nuke the metadata if no fresh draft is in progress (i.e., recording fully stopped).

- [ ] **Step 3: Manual verification — repeat-call returns 200**

After deploying, simulate from a test session using `curl`:

```bash
SESSION="test-$(date +%s)"
WEEK=$(curl -s http://localhost:3111/api/v1/weekly-review/bootstrap | jq -r '.week')

# Send a chunk
echo "fake-audio" | base64 > /tmp/chunk.b64
curl -s -X POST http://localhost:3111/api/v1/weekly-review/recording/chunk \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION\",\"seq\":0,\"week\":\"$WEEK\",\"chunkBase64\":\"$(cat /tmp/chunk.b64)\"}"

# First finalize
curl -s -X POST http://localhost:3111/api/v1/weekly-review/recording/finalize \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION\",\"week\":\"$WEEK\",\"duration\":1}"

# Send another chunk after first finalize
curl -s -X POST http://localhost:3111/api/v1/weekly-review/recording/chunk \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION\",\"seq\":1,\"week\":\"$WEEK\",\"chunkBase64\":\"$(cat /tmp/chunk.b64)\"}"

# Second finalize — must succeed
curl -s -X POST http://localhost:3111/api/v1/weekly-review/recording/finalize \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION\",\"week\":\"$WEEK\",\"duration\":2}"
```

Expected: both finalize calls return `{"ok":true,...}`. Two media files exist for the same session (different timestamps in their filenames).

- [ ] **Step 4: Commit**

```bash
git add backend/src/3_applications/weekly-review/WeeklyReviewService.mjs
git commit -m "fix(weekly-review): finalize uses atomic rename for safe repeat calls"
```

---

## Phase 2: useAudioRecorder hardening

### Task 3: Track first-audible-frame

**Files:**
- Modify: `frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.js`
- Create: `frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.test.js`

**Why:** The pre-flight gate needs a programmatic signal that the mic has produced at least one audible frame. The level-monitor RAF already computes this implicitly; we expose it as a state flag.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAudioRecorder } from './useAudioRecorder.js';

// Minimal mocks for the WebAudio + MediaRecorder surface.
class FakeMediaRecorder {
  static instances = [];
  state = 'inactive';
  ondataavailable = null;
  onerror = null;
  onstop = null;
  constructor(stream) { this.stream = stream; FakeMediaRecorder.instances.push(this); }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; if (this.onstop) this.onstop(); }
  requestData() {}
}

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  global.MediaRecorder = FakeMediaRecorder;
  global.crypto = { randomUUID: () => 'test-uuid' };
  // Stub navigator.mediaDevices.getUserMedia to return a fake track-bearing stream.
  global.navigator.mediaDevices = {
    getUserMedia: vi.fn(async () => {
      const track = { kind: 'audio', readyState: 'live', stop: vi.fn(), addEventListener: vi.fn() };
      return { getTracks: () => [track], getAudioTracks: () => [track] };
    }),
  };
  // Stub WebSocket so getBridgeStream rejects fast and falls back.
  global.WebSocket = class { constructor() { setTimeout(() => this.onerror?.(), 0); } close() {} };
  // Stub AudioContext minimally — startLevelMonitor will fail silently and that's OK for this test.
  global.AudioContext = class {
    state = 'running';
    createAnalyser() { return { fftSize: 256, frequencyBinCount: 128, getByteTimeDomainData: () => {} }; }
    createMediaStreamSource() { return { connect: () => {} }; }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  };
  global.requestAnimationFrame = (cb) => setTimeout(cb, 16);
  global.cancelAnimationFrame = (id) => clearTimeout(id);
});

afterEach(() => { vi.restoreAllMocks(); });

describe('useAudioRecorder', () => {
  it('exposes firstAudibleFrameSeen=false until a level above threshold is observed', async () => {
    const { result } = renderHook(() => useAudioRecorder({ onChunk: () => {} }));
    expect(result.current.firstAudibleFrameSeen).toBe(false);
    await act(async () => { await result.current.startRecording(); });
    expect(result.current.firstAudibleFrameSeen).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /opt/Code/DaylightStation
npx vitest run frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.test.js
```

Expected: FAIL — `firstAudibleFrameSeen` is undefined.

- [ ] **Step 3: Add `firstAudibleFrameSeen` state and update on audible frame**

In `useAudioRecorder.js`:

After `const [silenceWarning, setSilenceWarning] = useState(false);`, add:

```javascript
const [firstAudibleFrameSeen, setFirstAudibleFrameSeen] = useState(false);
const firstAudibleFrameSeenRef = useRef(false);
```

Inside the level-monitor `sample` function, after the `normalized` value is computed and before the silence-warning logic, add:

```javascript
if (normalized > 0.02 && !firstAudibleFrameSeenRef.current) {
  firstAudibleFrameSeenRef.current = true;
  setFirstAudibleFrameSeen(true);
  logger().info('recorder.first-audible-frame', { normalized });
}
```

In `startRecording` (just after `setSilenceWarning(false);`), reset:

```javascript
firstAudibleFrameSeenRef.current = false;
setFirstAudibleFrameSeen(false);
```

In the return object, add `firstAudibleFrameSeen` alongside the other returned values.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.js \
        frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.test.js
git commit -m "feat(weekly-review): expose firstAudibleFrameSeen on useAudioRecorder"
```

---

### Task 4: Detect mic disconnect

**Files:**
- Modify: `frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.js`
- Modify: `frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.test.js`

- [ ] **Step 1: Write the failing test**

Append to `useAudioRecorder.test.js`:

```javascript
it('exposes disconnected=true when audio track ends', async () => {
  const trackHandlers = {};
  global.navigator.mediaDevices.getUserMedia = vi.fn(async () => {
    const track = {
      kind: 'audio', readyState: 'live', stop: vi.fn(),
      addEventListener: (ev, fn) => { trackHandlers[ev] = fn; },
    };
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  });
  const { result } = renderHook(() => useAudioRecorder({ onChunk: () => {} }));
  expect(result.current.disconnected).toBe(false);
  await act(async () => { await result.current.startRecording(); });
  expect(result.current.disconnected).toBe(false);
  await act(async () => { trackHandlers.ended?.(); });
  expect(result.current.disconnected).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.test.js
```

Expected: FAIL — `disconnected` undefined.

- [ ] **Step 3: Add disconnect detection**

In `useAudioRecorder.js`:

After the `firstAudibleFrameSeen` state, add:

```javascript
const [disconnected, setDisconnected] = useState(false);
```

In `startRecording`, after `streamRef.current = stream;`, add:

```javascript
// Wire disconnect detection: track ended (mic removed/permission revoked)
// or AudioBridge WS closing with non-1000 code mid-recording.
const tracks = stream.getAudioTracks?.() || [];
for (const track of tracks) {
  if (track.addEventListener) {
    track.addEventListener('ended', () => {
      logger().warn('recorder.track-ended');
      setDisconnected(true);
    });
  }
}
if (stream._bridgeWs) {
  const ws = stream._bridgeWs;
  const prevOnClose = ws.onclose;
  ws.onclose = (e) => {
    if (typeof prevOnClose === 'function') prevOnClose(e);
    if (e.code !== 1000) {
      logger().warn('recorder.bridge-ws-disconnect', { code: e.code });
      setDisconnected(true);
    }
  };
}
```

In `startRecording` near the top, also reset `setDisconnected(false);`. In the return object, add `disconnected`.

- [ ] **Step 4: Run to verify pass**

```bash
npx vitest run frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.js \
        frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.test.js
git commit -m "feat(weekly-review): detect mic disconnect via track-ended and bridge-ws-close"
```

---

### Task 5: Bounded reconnect

**Files:**
- Modify: `frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.js`
- Modify: `frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.test.js`

**Behavior:** Add a `reconnect()` method on the hook. It re-runs the bridge → getUserMedia acquisition flow. If success, `disconnected` clears, recording resumes (chunks continue with incremented `seq`). If it fails or doesn't acquire within ~3s, `disconnected` stays true and a `reconnectFailed` flag is set.

- [ ] **Step 1: Write the failing test**

Append:

```javascript
it('reconnect resolves to true on success and clears disconnected', async () => {
  const trackHandlers = {};
  global.navigator.mediaDevices.getUserMedia = vi.fn(async () => {
    const track = {
      kind: 'audio', readyState: 'live', stop: vi.fn(),
      addEventListener: (ev, fn) => { trackHandlers[ev] = fn; },
    };
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  });
  const { result } = renderHook(() => useAudioRecorder({ onChunk: () => {} }));
  await act(async () => { await result.current.startRecording(); });
  await act(async () => { trackHandlers.ended?.(); });
  expect(result.current.disconnected).toBe(true);
  let ok;
  await act(async () => { ok = await result.current.reconnect(); });
  expect(ok).toBe(true);
  expect(result.current.disconnected).toBe(false);
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.test.js
```

Expected: FAIL — `reconnect` is undefined.

- [ ] **Step 3: Implement `reconnect`**

In `useAudioRecorder.js`, define `reconnect` after `stopRecording`:

```javascript
const reconnect = useCallback(async () => {
  logger().info('recorder.reconnect-requested');
  try {
    // Tear down only the stream side; keep timer/duration/seq intact so the
    // recording continues from where it left off.
    if (streamRef.current) {
      if (streamRef.current._bridgeWs) {
        try { streamRef.current._bridgeWs.close(); } catch {}
      }
      try { streamRef.current.getTracks().forEach(t => t.stop()); } catch {}
      streamRef.current = null;
    }
    let stream;
    try {
      stream = await Promise.race([
        getBridgeStream(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('reconnect timeout')), 3000)),
      ]);
    } catch {
      stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({ audio: true }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('reconnect timeout')), 3000)),
      ]);
    }
    streamRef.current = stream;
    // Re-wire disconnect detection on new tracks.
    const tracks = stream.getAudioTracks?.() || [];
    for (const track of tracks) {
      if (track.addEventListener) {
        track.addEventListener('ended', () => {
          logger().warn('recorder.track-ended-after-reconnect');
          setDisconnected(true);
        });
      }
    }
    // Re-attach a fresh MediaRecorder. seqRef continues incrementing.
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    mediaRecorderRef.current = recorder;
    recorder.ondataavailable = (e) => {
      if (!e.data || e.data.size === 0) return;
      const seq = seqRef.current++;
      logger().info('recorder.chunk-emitted-after-reconnect', { seq, bytes: e.data.size });
      onChunk?.({ seq, blob: e.data });
    };
    recorder.start(5000);
    setDisconnected(false);
    logger().info('recorder.reconnect-success');
    return true;
  } catch (err) {
    logger().error('recorder.reconnect-failed', { error: err.message });
    return false;
  }
}, [onChunk]);
```

Add `reconnect` to the return object.

- [ ] **Step 4: Run to verify pass**

```bash
npx vitest run frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.test.js
```

Expected: PASS (all three tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.js \
        frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.test.js
git commit -m "feat(weekly-review): bounded reconnect on useAudioRecorder"
```

---

## Phase 3: New components

### Task 6: PreFlightOverlay component

**Files:**
- Create: `frontend/src/modules/WeeklyReview/components/PreFlightOverlay.jsx`

- [ ] **Step 1: Create the component**

```jsx
import React, { useEffect, useState } from 'react';

/**
 * Blocks the WeeklyReview UI until the mic is verified.
 * Props:
 *   - status: 'acquiring' | 'failed' | 'ok'
 *   - onRetry: () => void   (called when user picks Retry on failure)
 *   - onExit: () => void    (called when user picks Exit, or presses Back)
 */
export default function PreFlightOverlay({ status, onRetry, onExit }) {
  if (status === 'ok') return null;

  return (
    <div className="weekly-review-preflight-overlay">
      <div className="preflight-content">
        {status === 'acquiring' && (
          <>
            <div className="preflight-mic-pulse">🎤</div>
            <div className="preflight-title">Listening for your microphone…</div>
            <div className="preflight-subtitle">Speak to begin.</div>
          </>
        )}
        {status === 'failed' && (
          <>
            <div className="preflight-mic-error">🎤❌</div>
            <div className="preflight-title">Microphone unavailable</div>
            <div className="preflight-subtitle">Please check the device and try again.</div>
            <div className="preflight-actions">
              <button className="preflight-btn preflight-btn--primary" onClick={onRetry}>Retry</button>
              <button className="preflight-btn" onClick={onExit}>Exit</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/modules/WeeklyReview/components/PreFlightOverlay.jsx
git commit -m "feat(weekly-review): add PreFlightOverlay component"
```

---

### Task 7: FullscreenImage component

**Files:**
- Create: `frontend/src/modules/WeeklyReview/components/FullscreenImage.jsx`

- [ ] **Step 1: Create the component**

```jsx
import React from 'react';

/**
 * Single-image fullscreen view with index indicator.
 * Props:
 *   - photo: { id, original, thumbnail, takenAt, people, type } (one entry from day.photos)
 *   - index: number  (0-based)
 *   - total: number  (count of photos in the day)
 *   - dayLabel: string  (e.g., "Tuesday, April 22")
 */
export default function FullscreenImage({ photo, index, total, dayLabel }) {
  if (!photo) return null;
  return (
    <div className="weekly-review-fullscreen-image">
      <img className="fullscreen-image-img" src={photo.original} alt="" />
      <div className="fullscreen-image-overlay">
        <div className="fullscreen-image-day">{dayLabel}</div>
        <div className="fullscreen-image-index">{index + 1} / {total}</div>
        {photo.people?.length > 0 && (
          <div className="fullscreen-image-people">{photo.people.join(', ')}</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/modules/WeeklyReview/components/FullscreenImage.jsx
git commit -m "feat(weekly-review): add FullscreenImage component"
```

---

## Phase 4: WeeklyReview rewrite

These tasks rewrite `WeeklyReview.jsx` incrementally. After each task, the widget should still render and behave coherently.

### Task 8: Replace selectedDay/focusedDay with viewLevel state machine

**Files:**
- Modify: `frontend/src/modules/WeeklyReview/WeeklyReview.jsx`

**Why:** A single `viewLevel: 'toc' | 'day' | 'fullscreen'` plus a single `dayIndex` (always set, defaults to last day) plus `imageIndex` (set when at fullscreen) replaces the tangled `focusedDay`/`selectedDay`/`focusRow`/`barFocus` state.

- [ ] **Step 1: Add new state, keep old state in parallel temporarily**

At the top of the component, after the existing state declarations and before `containerRef`, add:

```javascript
const [viewLevel, setViewLevel] = useState('toc');           // 'toc' | 'day' | 'fullscreen'
const [dayIndex, setDayIndex] = useState(0);                 // always valid once data loads
const [imageIndex, setImageIndex] = useState(0);             // valid when viewLevel === 'fullscreen'
```

Initialize `dayIndex` to point at the last day in the bootstrap response. In the `fetchBootstrap` `setData(result)` line, follow it with:

```javascript
setDayIndex(Math.max(0, (result.days?.length || 1) - 1));
```

- [ ] **Step 2: Remove stale state — `focusedDay`, `selectedDay`, `focusRow`, `barFocus`, `confirmFocus` (kept), `resumeFocus` (kept), `errorFocus` (kept), `hasRecorded`, `showStopConfirm` (kept)**

Delete:
- `const [focusedDay, setFocusedDay] = useState(0);`
- `const [selectedDay, setSelectedDay] = useState(null);`
- `const [focusRow, setFocusRow] = useState('grid');`
- `const [barFocus, setBarFocus] = useState(0);`
- `const [hasRecorded, setHasRecorded] = useState(false);`

Also delete the `useEffect` that watches `focusedDay`, `selectedDay`, and the `selectedDayRef` / `showStopConfirmRef` / `hasRecordedRef` refs — they will be re-introduced as needed below.

- [ ] **Step 3: Update render JSX to drive off `viewLevel`/`dayIndex`/`imageIndex`**

Replace the existing `selectedDay !== null ? <DayDetail .../> : <div className="weekly-review-grid">...</div>` block with a `viewLevel` switch. Also add the import for `FullscreenImage`:

At the top of the file, add:

```javascript
import FullscreenImage from './components/FullscreenImage.jsx';
import PreFlightOverlay from './components/PreFlightOverlay.jsx';
```

Replace the render block:

```jsx
{viewLevel === 'fullscreen' && data?.days?.[dayIndex] && (() => {
  const photos = data.days[dayIndex].photos || [];
  const safeIdx = Math.min(imageIndex, Math.max(0, photos.length - 1));
  const dt = new Date(`${data.days[dayIndex].date}T12:00:00Z`);
  const dayLabel = dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  return <FullscreenImage photo={photos[safeIdx]} index={safeIdx} total={photos.length} dayLabel={dayLabel} />;
})()}

{viewLevel === 'day' && data?.days?.[dayIndex] && (
  <DayDetail
    day={data.days[dayIndex]}
    onClose={() => setViewLevel('toc')}
  />
)}

{viewLevel === 'toc' && (
  <div className="weekly-review-grid">
    {data.days.map((day, i) => (
      <DayColumn
        key={day.date}
        day={day}
        isFocused={i === dayIndex}
        onClick={() => {
          setDayIndex(i);
          setViewLevel('day');
        }}
      />
    ))}
  </div>
)}
```

Note `isToday` is removed from the `DayColumn` call — Task 15 will remove the prop on the component side.

- [ ] **Step 4: Remove the init overlay**

Delete the entire `{!isRecording && !hasRecorded && (...)}` JSX block (the "Press to start recording" overlay). Pre-flight (Task 10) will replace it. Recording is now started automatically on mount.

- [ ] **Step 5: Verify the widget still renders**

Start dev server (or rely on the existing one), navigate to a screen that mounts WeeklyReview. The grid view should appear with the most recent day focused. Click a day cell — it should open `DayDetail`. Press the close button on `DayDetail` — it should return to grid.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/WeeklyReview/WeeklyReview.jsx
git commit -m "refactor(weekly-review): replace selectedDay/focusedDay with viewLevel state machine"
```

---

### Task 9: Rewrite keyboard handler around 4-level hierarchy

**Files:**
- Modify: `frontend/src/modules/WeeklyReview/WeeklyReview.jsx`

- [ ] **Step 1: Replace the existing keydown handler**

Find the `useEffect` that registers `handleKeyDown`. Replace its body with:

```javascript
useEffect(() => {
  const handleKeyDown = (e) => {
    if (!data?.days) return;
    const total = data.days.length;
    const isEnter = e.key === 'Enter' || e.key === ' ';
    const isBack  = e.key === 'Escape' || e.key === 'Backspace';

    // ---- Overlay-specific handling. These modals override "Enter = upload" ----

    // Pre-flight: only Back works (to bail). Other keys ignored.
    if (preflightStatus !== 'ok') {
      if (isBack) {
        e.preventDefault();
        if (typeof dispatch === 'function') dispatch('escape');
        else if (typeof dismiss === 'function') dismiss();
      }
      // Pre-flight failed has its own Retry/Exit buttons; route L/R + Enter:
      if (preflightStatus === 'failed') {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          setPreflightFocus(prev => prev === 0 ? 1 : 0);
        } else if (isEnter) {
          e.preventDefault();
          if (preflightFocus === 0) onPreflightRetry(); else onPreflightExit();
        }
      }
      return;
    }

    // Disconnect modal: informational while reconnecting/finalizing — swallow all keys.
    if (disconnectModal) {
      e.preventDefault();
      return;
    }

    // Stop-confirm modal: existing behavior (L/R toggles focus, Enter activates).
    if (showStopConfirm) {
      e.preventDefault();
      if (isBack) { setShowStopConfirm(false); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        setConfirmFocus(prev => prev === 0 ? 1 : 0); return;
      }
      if (isEnter) {
        if (confirmFocus === 0) { setShowStopConfirm(false); }
        else { setShowStopConfirm(false); onSaveAndExit(); }
        return;
      }
      return;
    }

    // Finalize-error modal: L/R toggles focus, Enter activates Retry / Exit-save-later.
    if (finalizeError) {
      e.preventDefault();
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        setErrorFocus(prev => prev === 0 ? 1 : 0); return;
      }
      if (isEnter) {
        if (errorFocus === 0) { setFinalizeError(null); onEnterUpload(); }
        else {
          setFinalizeError(null);
          if (typeof dispatch === 'function') dispatch('escape');
          else if (typeof dismiss === 'function') dismiss();
        }
        return;
      }
      return;
    }

    // Resume-draft overlay (single-button after Task 13): Enter activates Finalize.
    if (resumeDraft) {
      e.preventDefault();
      if (isEnter) finalizePriorDraft();
      // No Discard option, no L/R toggle. Back is intentionally a no-op (must explicitly finalize).
      return;
    }

    // ---- Bottom recording bar focus ----
    // focusRow === 'bar' means the user has tabbed down onto the bar. Enter activates Save.
    if (focusRow === 'bar') {
      e.preventDefault();
      if (isEnter) { onSaveAndExit(); return; }
      if (e.key === 'ArrowUp')   { setFocusRow('main'); return; }
      if (e.key === 'ArrowDown') { onExitWidget(); return; }
      if (isBack) { setFocusRow('main'); return; }
      return;
    }

    // ---- Main hierarchy: Enter = upload, Back = climb ----
    if (isEnter) {
      e.preventDefault();
      e.stopPropagation();
      onEnterUpload();
      return;
    }

    if (isBack) {
      e.preventDefault();
      e.stopPropagation();
      onBackPressed();
      return;
    }

    if (viewLevel === 'fullscreen') {
      const photos = data.days[dayIndex]?.photos || [];
      if (photos.length === 0) {
        // No images — drop straight to day view
        setViewLevel('day');
        return;
      }
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          setImageIndex(prev => (prev + 1) % photos.length);
          return;
        case 'ArrowDown':
          e.preventDefault();
          setImageIndex(prev => (prev - 1 + photos.length) % photos.length);
          return;
        case 'ArrowLeft':
          e.preventDefault();
          if (dayIndex > 0) {
            setDayIndex(dayIndex - 1);
            setImageIndex(0);
            setViewLevel('day');
          }
          return;
        case 'ArrowRight':
          e.preventDefault();
          if (dayIndex < total - 1) {
            setDayIndex(dayIndex + 1);
            setImageIndex(0);
            setViewLevel('day');
          }
          return;
        default: return;
      }
    }

    if (viewLevel === 'day') {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setViewLevel('toc');
          return;
        case 'ArrowUp':
          e.preventDefault();
          if ((data.days[dayIndex]?.photos?.length || 0) > 0) {
            setImageIndex(0);
            setViewLevel('fullscreen');
          }
          return;
        case 'ArrowLeft':
          e.preventDefault();
          if (dayIndex > 0) setDayIndex(dayIndex - 1);
          return;
        case 'ArrowRight':
          e.preventDefault();
          if (dayIndex < total - 1) setDayIndex(dayIndex + 1);
          return;
        default: return;
      }
    }

    // viewLevel === 'toc'
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        onExitWidget();
        return;
      case 'ArrowDown':
        e.preventDefault();
        // First Down at TOC focuses the recording bar; only the next Down exits.
        // This keeps the bar reachable from the keyboard.
        setFocusRow('bar');
        return;
      case 'ArrowLeft':
        e.preventDefault();
        if (dayIndex > 0) {
          setDayIndex(dayIndex - 1);
          setViewLevel('day');
        }
        return;
      case 'ArrowRight':
        e.preventDefault();
        if (dayIndex < total - 1) {
          setDayIndex(dayIndex + 1);
          setViewLevel('day');
        }
        return;
      default: return;
    }
  };

  const container = containerRef.current;
  if (container) {
    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }
}, [data, viewLevel, dayIndex, imageIndex, focusRow, resumeDraft, finalizeError, showStopConfirm, preflightStatus, preflightFocus, confirmFocus, errorFocus, disconnectModal, finalizePriorDraft, dispatch, dismiss]);
```

This handler references `onEnterUpload`, `onBackPressed`, `onSaveAndExit`, `onExitWidget`, `onPreflightRetry`, `onPreflightExit`, `preflightStatus`, `preflightFocus`, `disconnectModal`, and `focusRow`. Add the new state/callbacks at the top of the component (Tasks 10–12 will refine some of these):

```javascript
const [focusRow, setFocusRow] = useState('main');                    // 'main' | 'bar'
const [preflightFailed, setPreflightFailed] = useState(false);
const [preflightFocus, setPreflightFocus] = useState(0);             // 0=Retry, 1=Exit
const preflightStatus = preflightFailed
  ? 'failed'
  : 'acquiring'; // Task 10 will update this to factor in firstAudibleFrameSeen
const [disconnectModal, setDisconnectModal] = useState(null);

const onExitWidget = useCallback(() => {
  if (typeof dispatch === 'function') dispatch('escape');
  else if (typeof dismiss === 'function') dismiss();
}, [dispatch, dismiss]);

const onSaveAndExit = useCallback(() => {
  // Stops the recorder; the existing onstop chain (rebuilt in Task 12 path) finalizes.
  // We invoke the same finalize that Enter-upload uses.
  stopRecording();
  // Don't await — finalize is driven by the existing isRecording → !isRecording effect.
}, [stopRecording]);

const onEnterUpload = useCallback(() => { /* defined fully in Task 11 */ }, []);
const onPreflightRetry = useCallback(() => { /* defined fully in Task 10 */ }, []);
const onPreflightExit  = useCallback(() => onExitWidget(), [onExitWidget]);

const onBackPressed = useCallback(() => {
  // Climb hierarchy at L2/L3; save-confirm modal at L1 TOC.
  if (focusRow === 'bar') { setFocusRow('main'); return; }
  if (viewLevel === 'fullscreen') { setViewLevel('day'); return; }
  if (viewLevel === 'day')        { setViewLevel('toc'); return; }
  setConfirmFocus(0);
  setShowStopConfirm(true);
}, [viewLevel, focusRow]);
```

- [ ] **Step 2: Update the pop-guard to use the new state machine**

The existing pop-guard `useEffect` (currently around lines 510-547 of `WeeklyReview.jsx`) references the deleted `selectedDayRef` / `showStopConfirmRef`. Replace its body so it drives off `viewLevel`. Also remove the stale refs `selectedDayRef` / `selectedDay` references and the corresponding `useRef` lines.

Replace the pop-guard `useEffect` with:

```javascript
const viewLevelRef = useRef(viewLevel);
viewLevelRef.current = viewLevel;
const showStopConfirmRef = useRef(showStopConfirm);
showStopConfirmRef.current = showStopConfirm;

useEffect(() => {
  if (!menuNav?.setPopGuard) return;
  if (!isRecording && !uploadInFlight) {
    menuNav.clearPopGuard();
    return;
  }

  menuNav.setPopGuard(() => {
    logger.info('nav.pop-guard', {
      isRecording: isRecordingRef.current,
      uploadInFlight,
      viewLevel: viewLevelRef.current,
      showStopConfirm: showStopConfirmRef.current,
    });

    if (uploadInFlight) return false;
    if (showStopConfirmRef.current) { setShowStopConfirm(false); return false; }
    if (viewLevelRef.current === 'fullscreen') { setViewLevel('day'); return false; }
    if (viewLevelRef.current === 'day')        { setViewLevel('toc'); return false; }
    setConfirmFocus(0);
    setShowStopConfirm(true);
    return false;
  });

  return () => menuNav.clearPopGuard();
}, [isRecording, uploadInFlight, menuNav]);
```

Note: `uploadInFlight` is introduced in Task 11. Until that task lands, replace `uploadInFlight` here with the legacy `uploading` variable, then swap when Task 11 introduces it. Same for the `setShowStopConfirm` / `setViewLevel` etc.

- [ ] **Step 3: Manual verification**

Start dev server, mount WeeklyReview. Test:
- Right arrow at TOC → opens next day's detail (or no-op if already at last).
- Right arrow at last day → no-op.
- Down at day → returns to TOC.
- Up at day with photos → opens fullscreen image #1.
- Up at fullscreen → cycles to next image (wraps).
- Down at fullscreen → cycles to previous image (wraps).
- Left at fullscreen → drops to previous day's detail.
- Right at fullscreen on last day → no-op.
- Up at TOC → exits the widget.
- **Down at TOC → focuses the recording bar (focusRow='bar').** Down again → exits widget. Up at bar → returns to TOC. Enter at bar → triggers Save & exit (modal flow). Esc at bar → returns to TOC.
- Esc at fullscreen → drops to day. Esc at day → drops to TOC. Esc at TOC → opens save-confirm modal.
- **Inside stop-confirm modal: L/R toggles focus between Continue/Save&Close, Enter activates the focused button.**
- **Inside finalize-error modal: L/R toggles focus, Enter activates Retry/Exit.**
- **Inside resume-draft overlay: Enter activates Finalize Previous (only button).**
- **Inside pre-flight failed overlay: L/R toggles Retry/Exit, Enter activates focused button. Back exits the widget.**
- Remote/system back (popstate) follows the same per-level hierarchy.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/WeeklyReview/WeeklyReview.jsx
git commit -m "feat(weekly-review): 4-level keyboard navigation hierarchy + pop-guard"
```

---

### Task 10: Wire pre-flight gate

**Files:**
- Modify: `frontend/src/modules/WeeklyReview/WeeklyReview.jsx`

**Behavior:** On mount, after bootstrap loads, automatically start recording. Show `PreFlightOverlay status="acquiring"` until `firstAudibleFrameSeen` becomes true OR a 10s timeout elapses (then `status="failed"`). On Retry, restart recording and re-run the gate. On Exit (or Back during pre-flight), dismiss the widget cleanly.

- [ ] **Step 1: Replace the stub `preflightStatus` with a real state machine**

Remove the stub `useState('acquiring')` and `setPreflightStatus` declarations from Task 9 if you placed them. Instead, derive:

```javascript
const [preflightFailed, setPreflightFailed] = useState(false);
const preflightStatus = preflightFailed
  ? 'failed'
  : (firstAudibleFrameSeen ? 'ok' : 'acquiring');
```

Pull `firstAudibleFrameSeen` from the recorder destructure:

```javascript
const {
  isRecording, duration: recordingDuration, micLevel, silenceWarning,
  error: recorderError, startRecording, stopRecording,
  firstAudibleFrameSeen, disconnected, reconnect,
} = useAudioRecorder({ onChunk: handleChunk });
```

- [ ] **Step 2: Auto-start recording after bootstrap**

After the existing `fetchBootstrap` effect, add a new effect that starts recording exactly once:

```javascript
const autoStartRef = useRef(false);
useEffect(() => {
  if (!data || autoStartRef.current) return;
  autoStartRef.current = true;
  logger.info('recording.auto-start');
  startRecording();
}, [data, startRecording]);
```

- [ ] **Step 3: Add the 10-second pre-flight timeout**

```javascript
useEffect(() => {
  if (firstAudibleFrameSeen) {
    setPreflightFailed(false);
    return;
  }
  if (!isRecording) return;
  const timer = setTimeout(() => {
    if (!firstAudibleFrameSeen) {
      logger.warn('recording.preflight-timeout');
      setPreflightFailed(true);
    }
  }, 10000);
  return () => clearTimeout(timer);
}, [firstAudibleFrameSeen, isRecording]);
```

- [ ] **Step 4: Render the overlay**

In the JSX (anywhere alongside the other overlays), add:

```jsx
<PreFlightOverlay
  status={preflightStatus}
  onRetry={() => {
    setPreflightFailed(false);
    autoStartRef.current = false;
    stopRecording();
    setTimeout(() => { autoStartRef.current = true; startRecording(); }, 100);
  }}
  onExit={() => { if (typeof dispatch === 'function') dispatch('escape'); else if (typeof dismiss === 'function') dismiss(); }}
/>
```

- [ ] **Step 5: Allow Back during pre-flight**

In the keyboard handler from Task 9, the early-return guard `if (resumeDraft || finalizeError || showStopConfirm || preflightStatus !== 'ok' || disconnectModal)` swallows all keys during pre-flight. Add an exception so Back works:

```javascript
if (resumeDraft || finalizeError || showStopConfirm || preflightStatus !== 'ok' || disconnectModal) {
  if (preflightStatus !== 'ok' && (e.key === 'Escape' || e.key === 'Backspace')) {
    e.preventDefault();
    if (typeof dispatch === 'function') dispatch('escape');
    else if (typeof dismiss === 'function') dismiss();
    return;
  }
  return;
}
```

- [ ] **Step 6: Manual verification**

Mount the widget. The pre-flight overlay should appear immediately. Speaking into the mic should clear it within ~1 second. With mic muted/unplugged, after 10 seconds the failure UI should appear with Retry/Exit buttons.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/WeeklyReview/WeeklyReview.jsx
git commit -m "feat(weekly-review): pre-flight mic gate blocks UI until audible frame"
```

---

### Task 11: Wire Enter = upload (recording continues, debounced)

**Files:**
- Modify: `frontend/src/modules/WeeklyReview/WeeklyReview.jsx`

**Behavior:** Each Enter press triggers a `finalize` call against the current `sessionId`. Recording does NOT stop — chunks keep flowing. While a finalize is in flight, additional Enter presses are ignored. A 1-second debounce window absorbs remote double-fires.

- [ ] **Step 1: Add upload-in-flight state and timestamp**

Near the other state, add:

```javascript
const [uploadInFlight, setUploadInFlight] = useState(false);
const lastUploadAtRef = useRef(0);
```

- [ ] **Step 2: Replace the stub `onEnterUpload` from Task 9**

Replace the stub with:

```javascript
const onEnterUpload = useCallback(async () => {
  if (uploadInFlight) {
    logger.info('upload.skip-in-flight');
    return;
  }
  if (Date.now() - lastUploadAtRef.current < 1000) {
    logger.info('upload.skip-debounced');
    return;
  }
  if (!data?.week) return;
  lastUploadAtRef.current = Date.now();
  setUploadInFlight(true);
  try {
    logger.info('upload.finalize-request', { sessionId: sessionIdRef.current, week: data.week });
    uploaderFlushNow();
    // Wait briefly for in-memory queue to drain before finalize. Don't block forever — server tolerates partial.
    const drainDeadline = Date.now() + 3000;
    while (uploaderPendingCountRef.current > 0 && Date.now() < drainDeadline) {
      await new Promise(r => setTimeout(r, 200));
      uploaderFlushNow();
    }
    await DaylightAPI('/api/v1/weekly-review/recording/finalize', {
      sessionId: sessionIdRef.current,
      week: data.week,
      duration: recordingDuration,
    }, 'POST');
    logger.info('upload.finalize-complete');
  } catch (err) {
    logger.warn('upload.finalize-failed', { error: err.message });
    // Non-blocking — just toast on the bar; pipeline continues.
  } finally {
    setUploadInFlight(false);
  }
}, [data?.week, recordingDuration, uploaderFlushNow, uploaderPendingCountRef, uploadInFlight]);
```

- [ ] **Step 3: Remove the old finalize-on-stop flow**

The old `finalizeRecording` was driven by `hasRecorded` going true and the recorder stopping. We no longer wire `Enter → stopRecording`, and we no longer auto-finalize on stop. Remove:

- The `useEffect` that calls `finalizeRecording` when `!isRecording && hasRecorded`.
- The `finalizeRecording` `useCallback` itself (its body is replaced by the new `onEnterUpload` plus the disconnect-driven finalize from Task 12).

Keep `finalizeError`-related state (it's still used by Task 12's flow).

- [ ] **Step 4: Pass `uploadInFlight` to the recording bar**

In the existing `<RecordingBar ... />` JSX, add `uploadInFlight={uploadInFlight}`. (Task 14 will use this.)

- [ ] **Step 5: Manual verification**

Mount the widget, complete pre-flight. Press Enter — the bar shows a brief "Uploading…" flash (after Task 14 lands), recording continues, chunks keep flowing. Press Enter twice quickly — only one finalize call goes out. Press Enter again 5 seconds later — a second finalize call goes out.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/WeeklyReview/WeeklyReview.jsx
git commit -m "feat(weekly-review): Enter triggers finalize while recording continues"
```

---

### Task 12: Wire mic disconnect modal + auto-reconnect

**Files:**
- Modify: `frontend/src/modules/WeeklyReview/WeeklyReview.jsx`

**Behavior:** When `disconnected` becomes true, immediately attempt one bounded reconnect via the hook's `reconnect()`. If it returns true, dismiss any reconnect banner. If it returns false, show a blocking modal: "Microphone disconnected. Saving your recording…" and immediately fire a finalize call. Once finalize succeeds, exit the widget. If finalize itself fails, fall through to the existing `finalizeError` flow (Retry / Exit-save-later).

- [ ] **Step 1: Add disconnect-driven effect**

Near the other effects:

```javascript
const disconnectFiredRef = useRef(false);
useEffect(() => {
  if (!disconnected) {
    disconnectFiredRef.current = false;
    return;
  }
  if (disconnectFiredRef.current) return;
  disconnectFiredRef.current = true;
  (async () => {
    logger.warn('disconnect.detected');
    setDisconnectModal({ phase: 'reconnecting' });
    const ok = await reconnect();
    if (ok) {
      logger.info('disconnect.recovered');
      setDisconnectModal(null);
      return;
    }
    logger.warn('disconnect.reconnect-failed-finalizing');
    setDisconnectModal({ phase: 'finalizing' });
    try {
      uploaderFlushNow();
      await DaylightAPI('/api/v1/weekly-review/recording/finalize', {
        sessionId: sessionIdRef.current, week: data?.week, duration: recordingDuration,
      }, 'POST');
      await deleteLocalSession(sessionIdRef.current).catch(() => {});
      setDisconnectModal(null);
      if (typeof dispatch === 'function') dispatch('escape');
      else if (typeof dismiss === 'function') dismiss();
    } catch (err) {
      logger.error('disconnect.finalize-failed', { error: err.message });
      setDisconnectModal(null);
      setFinalizeError(err.message);
    }
  })();
}, [disconnected, reconnect, uploaderFlushNow, data?.week, recordingDuration, dispatch, dismiss]);
```

- [ ] **Step 2: Render the disconnect modal**

Add JSX (alongside other overlays):

```jsx
{disconnectModal && (
  <div className="weekly-review-confirm-overlay">
    <div className="confirm-dialog">
      <div className="confirm-message">
        {disconnectModal.phase === 'reconnecting' && (
          <>Microphone dropped — reconnecting…<br/><small>Please hold tight.</small></>
        )}
        {disconnectModal.phase === 'finalizing' && (
          <>Microphone disconnected.<br/><small>Saving your recording…</small></>
        )}
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 3: Manual verification**

Mount the widget. From a browser devtools console, simulate disconnect by stopping the audio track:

```javascript
// In devtools while widget is recording:
document.querySelector('.weekly-review')  // get container
// then on the underlying stream — easier in real testing on Shield TV.
```

Cleaner verification: deploy and verify on Shield TV by power-cycling the mic source and confirming the modal appears + finalize fires.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/WeeklyReview/WeeklyReview.jsx
git commit -m "feat(weekly-review): disconnect modal with auto-reconnect and forced finalize"
```

---

### Task 13: Remove all Discard affordances

**Files:**
- Modify: `frontend/src/modules/WeeklyReview/WeeklyReview.jsx`

**Why:** The single rule is "no audio loss, ever." Discard buttons violate it.

- [ ] **Step 1: Remove Discard from resume-draft overlay**

Find the resume-draft JSX block. Replace the two buttons with a single button:

```jsx
{resumeDraft && preflightStatus === 'ok' && (
  <div className="weekly-review-confirm-overlay">
    <div className="confirm-dialog">
      <div className="confirm-message">
        A previous recording was not finalized.<br/>
        <small>{resumeDraft.source === 'server' ? `Server draft · ${Math.round((resumeDraft.totalBytes || 0) / 1024)} KB` : `Local-only draft · ${resumeDraft.chunkCount || 0} chunks`}</small>
      </div>
      <div className="confirm-actions">
        <button className="confirm-btn confirm-btn--save focused" onClick={finalizePriorDraft}>Finalize Previous</button>
      </div>
    </div>
  </div>
)}
```

Delete the `discardPriorDraft` callback (and its definition higher up). Delete `resumeFocus` state and any keyboard logic that toggled between Finalize and Discard.

- [ ] **Step 2: Remove "Exit (save later)" from finalize-error dialog?**

Re-read: the spec keeps "Exit (save later)" because it does NOT discard — chunks remain in IndexedDB and on the server for next-mount draft recovery. **Keep this button.** Confirm the existing labels are clear (text says "Exit (save later)" not "Discard"). No change required.

- [ ] **Step 3: Remove the Discard option from stop-confirm modal**

Inspect the existing stop-confirm modal — its two buttons are "Continue Recording" and "Save & Close." Neither discards, so no change required. Confirm the labels match the spec.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/WeeklyReview/WeeklyReview.jsx
git commit -m "feat(weekly-review): remove Discard from resume-draft overlay"
```

---

## Phase 5: Component touch-ups

### Task 14: RecordingBar — mic status + Uploading flash

**Files:**
- Modify: `frontend/src/modules/WeeklyReview/components/RecordingBar.jsx`
- Modify: `frontend/src/modules/WeeklyReview/WeeklyReview.jsx` (pass new props)

- [ ] **Step 1: Add new props to RecordingBar**

In `RecordingBar.jsx`, add `micConnected` and `uploadInFlight` to the props destructure. Add an indicator pill before the existing left/right blocks:

```jsx
<div className="recording-bar-left">
  <span className="week-label">{weekLabel}</span>
  <span className={`mic-indicator ${micConnected ? 'mic-indicator--live' : 'mic-indicator--lost'}`}>
    {micConnected ? '🎤 LIVE' : '🎤 LOST'}
  </span>
  {!isRecording && existingRecording?.exists && (
    <span className="existing-badge">{formatTime(existingRecording.duration)} recorded</span>
  )}
</div>
```

In the right block, replace `{uploading ? <span>Transcribing...</span> : ...}` with a transient flash. Add at the end of the right-block JSX (after the existing buttons):

```jsx
{uploadInFlight && <span className="upload-flash">Uploading…</span>}
```

- [ ] **Step 2: Pass props from WeeklyReview**

In `WeeklyReview.jsx`'s `<RecordingBar ... />` call, add:

```jsx
micConnected={isRecording && !disconnected}
uploadInFlight={uploadInFlight}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/WeeklyReview/components/RecordingBar.jsx \
        frontend/src/modules/WeeklyReview/WeeklyReview.jsx
git commit -m "feat(weekly-review): MIC LIVE/LOST indicator and upload flash on recording bar"
```

---

### Task 15: DayDetail — remove close button, drop isToday

**Files:**
- Modify: `frontend/src/modules/WeeklyReview/components/DayDetail.jsx`
- Modify: `frontend/src/modules/WeeklyReview/components/DayColumn.jsx`

**Why:** Back/Down keys handle exit from L2; the close button is redundant. `isToday` no longer applies because today is excluded from the grid.

- [ ] **Step 1: Remove the close button from DayDetail**

In `DayDetail.jsx`, delete:

```jsx
<button className="day-detail-close" onClick={() => { logger.info('day-detail.close-button', { date: day.date }); onClose(); }}>✕</button>
```

The `onClose` prop becomes unused; you can leave it on the signature for backward-compat (still passed by `WeeklyReview.jsx` as a programmatic exit hook from Task 8). Either: (a) remove `onClose` from the prop list and from the parent's call, OR (b) keep it for any non-keyboard escape paths. Choose (a) for clarity.

Update parent `<DayDetail day={...} />` call: drop `onClose={() => setViewLevel('toc')}`.

Also remove the `isToday` prop from the `DayDetail` signature and any `day-detail--today` className usage. Also remove the `isToday` argument from the parent call.

- [ ] **Step 2: Remove `isToday` from DayColumn**

In `DayColumn.jsx`, remove the `isToday` prop from the signature and remove `isToday && 'day-column--today'` from the `columnClass` array. Optionally remove the `.day-column--today` SCSS rule (Task 17 covers SCSS).

The parent `WeeklyReview.jsx` already stopped passing `isToday` after Task 8.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/WeeklyReview/components/DayDetail.jsx \
        frontend/src/modules/WeeklyReview/components/DayColumn.jsx
git commit -m "refactor(weekly-review): remove DayDetail close button and isToday prop"
```

---

## Phase 6: Styles + Integration testing

### Task 16: SCSS for new overlays / fullscreen / mic indicator

**Files:**
- Modify: `frontend/src/modules/WeeklyReview/WeeklyReview.scss`

- [ ] **Step 1: Add styles**

Append to the existing SCSS:

```scss
.weekly-review-preflight-overlay {
  position: absolute;
  inset: 0;
  background: rgba(10, 12, 18, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;

  .preflight-content {
    text-align: center;
    color: #f0f4f8;
    padding: 2rem 3rem;
    max-width: 32rem;
  }

  .preflight-mic-pulse {
    font-size: 4rem;
    animation: mic-pulse 1.2s ease-in-out infinite;
  }

  .preflight-mic-error { font-size: 4rem; }

  .preflight-title { font-size: 1.5rem; font-weight: 600; margin: 1rem 0 0.5rem; }
  .preflight-subtitle { color: #aab2c0; }
  .preflight-actions { display: flex; gap: 1rem; justify-content: center; margin-top: 1.5rem; }
  .preflight-btn {
    padding: 0.6rem 1.5rem;
    border-radius: 0.4rem;
    border: 1px solid #4a5060;
    background: transparent;
    color: #f0f4f8;
    cursor: pointer;
    &--primary { background: #2a7a8a; border-color: #2a7a8a; }
  }
}

@keyframes mic-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.15); opacity: 0.6; }
}

.weekly-review-fullscreen-image {
  position: absolute;
  inset: 0;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 30;

  .fullscreen-image-img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
  .fullscreen-image-overlay {
    position: absolute;
    bottom: 1rem;
    left: 1rem;
    right: 1rem;
    color: #f0f4f8;
    background: linear-gradient(transparent, rgba(0,0,0,0.7));
    padding: 1rem;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .fullscreen-image-day { font-size: 1.2rem; font-weight: 600; }
  .fullscreen-image-index { font-size: 0.95rem; color: #c0c8d0; }
  .fullscreen-image-people { font-size: 0.9rem; color: #8aa0b8; }
}

.mic-indicator {
  display: inline-block;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.2rem 0.5rem;
  border-radius: 0.3rem;
  margin-left: 0.5rem;
  &--live { background: #1f5d36; color: #c0e8d0; }
  &--lost { background: #6d1f1f; color: #ffc0c0; animation: mic-lost-flash 0.6s ease-in-out infinite; }
}
@keyframes mic-lost-flash {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.upload-flash {
  font-size: 0.85rem;
  color: #c0e8d0;
  margin-left: 0.5rem;
  animation: upload-flash-fade 1.2s ease-out;
}
@keyframes upload-flash-fade {
  0% { opacity: 0; }
  20% { opacity: 1; }
  100% { opacity: 0.6; }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/modules/WeeklyReview/WeeklyReview.scss
git commit -m "style(weekly-review): add styles for pre-flight, fullscreen, mic indicator"
```

---

### Task 17: Playwright integration test

**Files:**
- Create: `tests/live/flow/weekly-review/weekly-review-ux.runtime.test.mjs`

**Approach:** Mount a screen that includes the WeeklyReview widget. Mock the AudioBridge WS to deliver fake audio so pre-flight clears. Drive the keyboard. Assert DOM state transitions.

- [ ] **Step 1: Find a screen that mounts WeeklyReview**

```bash
grep -rn "weekly-review" /opt/Code/DaylightStation/data --include="*.yml" 2>/dev/null
sudo docker exec daylight-station sh -c 'grep -rn "weekly-review" data --include="*.yml"' 2>/dev/null
```

Use the result as the test target URL. If no screen mounts it directly, create a one-off test screen YAML in `data/household/screens/test-weekly-review.yml` referencing the widget. (Engineer note: the Playwright test should not modify production screen configs.)

- [ ] **Step 2: Create the test file**

```javascript
import { test, expect } from '@playwright/test';
import { getAppPort } from '#testlib/configHelper.mjs';

const APP_URL = `http://localhost:${getAppPort()}`;

test.describe('WeeklyReview UX', () => {
  test.beforeEach(async ({ page }) => {
    // Stub AudioBridge WS so pre-flight clears immediately.
    await page.addInitScript(() => {
      const FakeWS = class {
        constructor() {
          setTimeout(() => {
            this.binaryType = 'arraybuffer';
            this.onmessage?.({ data: JSON.stringify({ sampleRate: 48000 }) });
            // Push a buffer of audible audio (non-zero samples).
            const buf = new ArrayBuffer(2048);
            const view = new Int16Array(buf);
            for (let i = 0; i < view.length; i++) view[i] = (i % 2) ? 8000 : -8000;
            this.onmessage?.({ data: buf });
          }, 50);
        }
        send() {}
        close() {}
      };
      window.WebSocket = FakeWS;
    });
  });

  test('pre-flight clears, navigation follows hierarchy, no Discard buttons', async ({ page }) => {
    await page.goto(`${APP_URL}/screen/test-weekly-review`);
    // Wait for pre-flight overlay to disappear.
    await expect(page.locator('.weekly-review-preflight-overlay')).toBeHidden({ timeout: 8000 });

    // Default landing: TOC (grid)
    await expect(page.locator('.weekly-review-grid')).toBeVisible();

    // Right arrow → opens day detail for next day
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.day-detail')).toBeVisible();

    // Up arrow at day → fullscreen image (if photos exist)
    const photoCount = await page.locator('.day-detail-photo').count();
    if (photoCount > 0) {
      await page.keyboard.press('ArrowUp');
      await expect(page.locator('.weekly-review-fullscreen-image')).toBeVisible();
      await page.keyboard.press('ArrowDown'); // cycles within fullscreen
      await expect(page.locator('.weekly-review-fullscreen-image')).toBeVisible();
      await page.keyboard.press('ArrowLeft'); // drops to prev day
      await expect(page.locator('.weekly-review-fullscreen-image')).toBeHidden();
      await expect(page.locator('.day-detail')).toBeVisible();
    }

    // Down at day → TOC
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.weekly-review-grid')).toBeVisible();

    // Esc at TOC → save-confirm modal (no Discard button)
    await page.keyboard.press('Escape');
    await expect(page.locator('.weekly-review-confirm-overlay')).toBeVisible();
    const buttons = await page.locator('.weekly-review-confirm-overlay .confirm-btn').allTextContents();
    expect(buttons.some(b => /discard/i.test(b))).toBe(false);
    expect(buttons.some(b => /continue/i.test(b))).toBe(true);
    expect(buttons.some(b => /save/i.test(b))).toBe(true);
  });

  test('Right at last day is no-op', async ({ page }) => {
    await page.goto(`${APP_URL}/screen/test-weekly-review`);
    await expect(page.locator('.weekly-review-preflight-overlay')).toBeHidden({ timeout: 8000 });
    // The default landing focuses the last day. Press Right — nothing should happen.
    const initialClass = await page.locator('.day-column--focused').first().getAttribute('class');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);
    const afterClass = await page.locator('.day-column--focused').first().getAttribute('class');
    expect(afterClass).toBe(initialClass);
  });
});
```

- [ ] **Step 3: Run the tests**

```bash
cd /opt/Code/DaylightStation
npx playwright test tests/live/flow/weekly-review/ --reporter=line
```

Expected: both tests pass. If a screen YAML is needed, create `data/household/screens/test-weekly-review.yml` first (consult `data/household/screens/` in the docker volume for the expected schema).

- [ ] **Step 4: Commit**

```bash
git add tests/live/flow/weekly-review/
git commit -m "test(weekly-review): integration tests for hardened UX"
```

---

### Task 18: Fixed-width treatment for dynamic text

**Files:**
- Modify: `frontend/src/modules/WeeklyReview/WeeklyReview.scss`
- Modify: `frontend/src/modules/WeeklyReview/components/RecordingBar.jsx`
- Modify: `frontend/src/modules/WeeklyReview/components/FullscreenImage.jsx`

**Why:** The recording bar's timer (`m:ss`), pending-chunk count, sync badge, MIC LIVE/LOST pill, mic level, and any other element whose text changes per second/per-frame must use tabular numerals and reserved-width containers, or the layout shifts every tick. Same goes for the image-index counter on `FullscreenImage`.

- [ ] **Step 1: Add a tabular-numerals utility class**

Append to `WeeklyReview.scss`:

```scss
.weekly-review,
.weekly-review * {
  // Lock all numeric glyphs to equal width across the widget.
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum' 1;
}

.recording-timer,
.fullscreen-image-index,
.upload-flash,
.sync-badge {
  font-variant-numeric: tabular-nums;
}

.recording-timer {
  display: inline-block;
  min-width: 4ch;       // m:ss with 2-digit minute (locked width)
  text-align: right;
}

.fullscreen-image-index {
  display: inline-block;
  min-width: 6ch;       // "NN / NN" with up to 2-digit counts
  text-align: right;
}

.mic-indicator {
  display: inline-block;
  min-width: 5.5ch;     // "🎤 LIVE" vs "🎤 LOST" → reserve max
  text-align: center;
}

.sync-badge {
  display: inline-block;
  min-width: 16ch;      // "Syncing… (NN pending)" max-likely width
  text-align: left;
}

.upload-flash {
  display: inline-block;
  min-width: 9ch;       // "Uploading…"
  text-align: left;
}

.vu-meter {
  // VU is already fixed-width by bar count, but lock the container too.
  display: inline-block;
  width: 8rem;
  flex-shrink: 0;
}

// Existing-recording badge
.existing-badge {
  display: inline-block;
  min-width: 12ch;
  text-align: left;
}
```

If any of the above classes don't exist yet (e.g., `.upload-flash` was added in Task 14), this is fine — the rules just become inert until the elements appear.

- [ ] **Step 2: Audit RecordingBar and FullscreenImage for un-classed dynamic spans**

Open both files. Any `<span>` or `<div>` whose contents change at runtime should either use one of the classes above or get a fixed `min-width` inline. Specifically check:
- `recording-timer` (already covered).
- `vu-bar` filled-count rendering (already fixed-width per bar — confirm wrapper has fixed width).
- `existing-badge`, `sync-badge`, `recording-error`.
- `fullscreen-image-index`, `fullscreen-image-people` (people list grows; OK to wrap to next line, but its container should not push other elements around).

If `recording-error` displays variable-length error messages, wrap it in a container with `max-width: 16rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;` so a long error doesn't blow out the bar.

- [ ] **Step 3: Manual verification**

Start dev server. Watch the recording bar for one minute while recording. The timer should not jitter. The MIC indicator and pending-count text should not shift surrounding elements. The fullscreen image index should not shift the day-label as you cycle through images of different counts.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/WeeklyReview/WeeklyReview.scss \
        frontend/src/modules/WeeklyReview/components/RecordingBar.jsx \
        frontend/src/modules/WeeklyReview/components/FullscreenImage.jsx
git commit -m "style(weekly-review): tabular-nums + reserved widths to stop layout jitter"
```

---

### Task 19: Final interaction-button audit

**Files:**
- Read-only audit pass; modifications only as needed.

**Why:** Earlier modal flows (resume-draft, finalize-error, stop-confirm) were keyboard-driven via custom logic that didn't always activate buttons on Enter. After the keyboard rewrite, every interactive button must be both keyboard-activatable and pointer-activatable. This task catches anything missed.

- [ ] **Step 1: Enumerate every interactive control**

Run from the project root:

```bash
grep -nE "<button|onClick" /opt/Code/DaylightStation/frontend/src/modules/WeeklyReview/**/*.jsx
```

Expected control list:
- Pre-flight failed overlay: Retry, Exit.
- Resume-draft overlay: Finalize Previous (Discard removed in Task 13).
- Stop-confirm modal: Continue Recording, Save & Close.
- Finalize-error modal: Retry, Exit (save later).
- RecordingBar: Save Recording (focused via focusRow='bar').
- DayDetail: photo/video click handlers (mouse-only is fine — no keyboard equivalent needed beyond viewing the photo in fullscreen via Up at L2).
- DayDetail: MiniVideoPlayer close button (mouse-only is fine — Esc/Back at L2 already exits).

- [ ] **Step 2: Verify each control responds to both Enter (when focused) and click**

Manually test each in the dev server. Each control's `onClick` must be invokable via the keyboard handler's Enter branch when that control is the focused element. Confirm:
- Pre-flight failed: arrow toggles focus, Enter activates.
- Resume-draft: Enter triggers `finalizePriorDraft`.
- Stop-confirm: arrow toggles, Enter activates focused.
- Finalize-error: arrow toggles, Enter activates focused.
- RecordingBar Save: Down at TOC → focusRow='bar', Enter triggers save flow.

- [ ] **Step 3: Add visible focus styles for any control missing one**

Inspect each focusable button in dev tools. Any button with no visible focus indicator gets a SCSS rule:

```scss
.confirm-btn:focus-visible,
.preflight-btn:focus-visible,
.recording-bar__save:focus-visible {
  outline: 2px solid #4dc3d6;
  outline-offset: 2px;
}
```

Append to `WeeklyReview.scss` if not already present.

- [ ] **Step 4: Commit (if any changes)**

```bash
git add frontend/src/modules/WeeklyReview/
git commit -m "fix(weekly-review): consistent Enter activation and focus styles across controls"
```

If no changes were needed (audit passed clean), skip this commit and note "audit passed" in the PR description.

---

## Self-Review Checklist (run before handing the plan to an executor)

- [ ] Spec coverage:
  - Audio is mandatory: Tasks 3 (first-frame), 10 (pre-flight gate), 4+12 (disconnect modal). ✅
  - No audio loss: Task 13 (no Discard), Task 12 (forced finalize on disconnect), existing pagehide flush untouched. ✅
  - Navigation hierarchy: Task 8 (state machine), Task 9 (keys). ✅
  - Enter = upload, recording continues: Task 11 + Task 2 (atomic rename so repeat finalize is safe). ✅
  - 8 past days excluding today: Task 1. ✅
  - Today removed from grid: Task 15 (`isToday` removal). ✅
  - Modal Enter exception: Task 9 (per-modal handler — pre-flight failed, stop-confirm, finalize-error, resume-draft). ✅
  - Bottom-bar focus exception: Task 9 (focusRow='bar' branch — Enter activates Save). ✅
  - Fixed-width dynamic text: Task 18. ✅
  - Final interaction-button audit: Task 19. ✅

- [ ] No placeholders. Every step has the exact code or commands.

- [ ] Type/name consistency:
  - `viewLevel: 'toc' | 'day' | 'fullscreen'` — used in Tasks 8, 9, 12.
  - `firstAudibleFrameSeen`, `disconnected`, `reconnect` — defined in Tasks 3-5, consumed in 10-12.
  - `preflightStatus` — derived in Task 10, gated in Task 9.
  - `disconnectModal` — defined in Task 12, gated in Task 9.
  - `onEnterUpload` / `onBackPressed` — stubbed in Task 9, finalized in Tasks 11 / 9 (back logic).

---

## Execution Handoff

Plan complete and saved to `docs/_wip/plans/2026-04-26-weekly-review-ux-hardening-plan.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session via executing-plans, batch checkpoints for review.

Which approach?
