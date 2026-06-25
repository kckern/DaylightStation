# Feedback Voice Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline `FeedbackPanel` with a modal, transcript-visible feedback overlay built on a new app-neutral voice-capture core, reused by Piano settings and a new Fitness-menu entry, pausing host music while recording.

**Architecture:** A neutral `modules/VoiceCapture/` provides a one-shot recorder hook + a purely-presentational portal overlay + a mic meter. `modules/Feedback/FeedbackOverlay` drives a record→submit→poll-transcript→review state machine on top of them and binds to the existing `/api/v1/feedback` backend (submit + poll GET + delete). Hosts inject `app`, `context`, and optional `onPauseMusic`/`onResumeMusic`. `VoiceMemoOverlay` is left untouched.

**Tech Stack:** React (hooks, `ReactDOM.createPortal`), Vitest + `@testing-library/react` (config: `vitest.config.mjs`, colocated `*.test.js(x)`), the project `DaylightAPI` client and structured `getLogger` logging.

**Spec:** `docs/superpowers/specs/2026-06-25-feedback-voice-overlay-design.md`

**Test runner (every task):** `./node_modules/.bin/vitest run --config vitest.config.mjs <file>`

---

## Cross-cutting gotchas (read before starting)

- **`DaylightAPI(path, data = {}, method = 'GET')` auto-converts GET→POST when `data` has ≥1 key** (`frontend/src/lib/api.mjs:11-16`). The transcript poll MUST call `DaylightAPI(path)` with **no** second arg, or it becomes a POST. DELETE must pass `DaylightAPI(path, {}, 'DELETE')`.
- **Logging:** use `getLogger().child({ component: '...' })` — never raw `console.*` (project rule).
- **Backend (already in place, no change):** `POST /api/v1/feedback` → `{id, transcriptStatus}`; `GET /api/v1/feedback/:app/:id` → full item incl. `transcript`; `DELETE /api/v1/feedback/:app/:id` → `{ok,id}`. `transcriptStatus`: `pending` → `done` | `failed` | `unavailable`.

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `frontend/src/modules/VoiceCapture/useMediaRecorderCapture.js` | One-shot mic→Blob recorder (level ref, duration, BT-mic pinning) |
| Create | `frontend/src/modules/VoiceCapture/MicMeter.jsx` | Ref-driven VU bar (no re-render) |
| Create | `frontend/src/modules/VoiceCapture/VoiceCaptureOverlay.jsx` | Presentational portal overlay (phase views, close) |
| Create | `frontend/src/modules/VoiceCapture/VoiceCaptureOverlay.scss` | Overlay styles |
| Modify | `frontend/src/modules/Feedback/feedbackApi.js` | add `pollFeedbackTranscript`, `deleteFeedback` |
| Create | `frontend/src/modules/Feedback/FeedbackOverlay.jsx` | State machine binding core ↔ feedback backend |
| Modify | `frontend/src/modules/Piano/PianoKiosk/PianoSettingsSheet.jsx` | open overlay instead of inline panel |
| Modify | `frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx` | "Send feedback" entry, wires music callbacks |
| Remove | `frontend/src/modules/Feedback/FeedbackPanel.jsx`, `FeedbackPanel.scss`, `useFeedbackRecorder.js` | superseded |

---

### Task 1: `useMediaRecorderCapture` (neutral one-shot recorder)

**Files:**
- Create: `frontend/src/modules/VoiceCapture/useMediaRecorderCapture.js`
- Test: `frontend/src/modules/VoiceCapture/useMediaRecorderCapture.test.js`

This is a near-verbatim move of today's `frontend/src/modules/Feedback/useFeedbackRecorder.js` into the neutral module, renamed, with the logger component renamed to `voice-capture-recorder`. Same public API: `{ isRecording, durationMs, levelRef, error, start, stop }`. `stop()` resolves `{ blob, durationMs, mimeType }`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/VoiceCapture/useMediaRecorderCapture.test.js`:

```javascript
/**
 * useMediaRecorderCapture — neutral one-shot mic→Blob recorder.
 * MediaRecorder + getUserMedia are mocked (jsdom has neither).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMediaRecorderCapture } from './useMediaRecorderCapture.js';

class FakeMediaRecorder {
  static isTypeSupported() { return true; }
  constructor(stream, opts) { this.stream = stream; this.mimeType = opts?.mimeType || 'audio/webm'; this.state = 'inactive'; this.ondataavailable = null; this.onstop = null; this.onerror = null; }
  start() { this.state = 'recording'; }
  requestData() { this.ondataavailable?.({ data: new Blob(['x'], { type: this.mimeType }) }); }
  stop() { this.state = 'inactive'; this.onstop?.(); }
}

const fakeStream = { getTracks: () => [{ stop: vi.fn() }] };

beforeEach(() => {
  global.MediaRecorder = FakeMediaRecorder;
  global.AudioContext = class { createAnalyser() { return { fftSize: 0, frequencyBinCount: 8, getByteTimeDomainData: () => {} }; } createMediaStreamSource() { return { connect() {} }; } close() { return Promise.resolve(); } };
  Object.defineProperty(global.navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue(fakeStream),
      enumerateDevices: vi.fn().mockResolvedValue([]),
    },
  });
});

describe('useMediaRecorderCapture', () => {
  it('starts recording then stops and resolves a blob with duration', async () => {
    const { result } = renderHook(() => useMediaRecorderCapture());
    await act(async () => { await result.current.start(); });
    expect(result.current.isRecording).toBe(true);

    let take;
    await act(async () => { take = await result.current.stop(); });
    expect(take.blob).toBeInstanceOf(Blob);
    expect(typeof take.durationMs).toBe('number');
    expect(result.current.isRecording).toBe(false);
  });

  it('surfaces a permission error and stays not-recording', async () => {
    navigator.mediaDevices.getUserMedia = vi.fn().mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    const { result } = renderHook(() => useMediaRecorderCapture());
    await act(async () => { await result.current.start(); });
    expect(result.current.isRecording).toBe(false);
    expect(result.current.error).toMatch(/permission/i);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/VoiceCapture/useMediaRecorderCapture.test.js`
Expected: FAIL — module `./useMediaRecorderCapture.js` does not exist.

- [ ] **Step 3: Create the hook**

Copy `frontend/src/modules/Feedback/useFeedbackRecorder.js` verbatim to `frontend/src/modules/VoiceCapture/useMediaRecorderCapture.js`, then make exactly these edits:
- Fix the logger import path (now two levels up to `lib`): change `import getLogger from '../../lib/logging/Logger.js';` to `import getLogger from '../../lib/logging/Logger.js';` (path is unchanged — both modules are at `modules/<X>/`, so `../../lib` still resolves; keep as-is).
- Rename the child logger component: `getLogger().child({ component: 'feedback-recorder' })` → `getLogger().child({ component: 'voice-capture-recorder' })`.
- Rename the export: `export function useFeedbackRecorder()` → `export function useMediaRecorderCapture()`, and `export default useFeedbackRecorder;` → `export default useMediaRecorderCapture;`.
- Leave all logging event names as `feedback.*`? No — rename the event prefixes from `feedback.` to `voice.capture.` (e.g. `feedback.record-start` → `voice.capture.record-start`) so the neutral hook isn't feedback-branded. There are 7 such event strings; rename each `feedback.` prefix to `voice.capture.`.

- [ ] **Step 4: Run the test, verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/VoiceCapture/useMediaRecorderCapture.test.js`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/VoiceCapture/useMediaRecorderCapture.js frontend/src/modules/VoiceCapture/useMediaRecorderCapture.test.js
git commit -m "feat(voice-capture): neutral one-shot mic recorder hook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `MicMeter` + `VoiceCaptureOverlay` (presentational)

**Files:**
- Create: `frontend/src/modules/VoiceCapture/MicMeter.jsx`
- Create: `frontend/src/modules/VoiceCapture/VoiceCaptureOverlay.jsx`
- Create: `frontend/src/modules/VoiceCapture/VoiceCaptureOverlay.scss`
- Test: `frontend/src/modules/VoiceCapture/VoiceCaptureOverlay.test.jsx`

`VoiceCaptureOverlay` is dumb: it renders one of four phase views from props and emits callbacks. No recorder, no network. `phase ∈ 'idle' | 'recording' | 'processing' | 'review'`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/VoiceCapture/VoiceCaptureOverlay.test.jsx`:

```javascript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VoiceCaptureOverlay } from './VoiceCaptureOverlay.jsx';

const baseProps = {
  open: true, title: 'Feedback', prompt: 'Tell us what is up.',
  phase: 'idle', durationMs: 0, levelRef: { current: 0 },
  transcript: '', transcriptStatus: null, error: null,
  onRecordToggle: vi.fn(), onKeep: vi.fn(), onRedo: vi.fn(), onClose: vi.fn(),
};

describe('VoiceCaptureOverlay', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<VoiceCaptureOverlay {...baseProps} open={false} />);
    expect(container.querySelector('.voice-capture-overlay')).toBeNull();
  });

  it('idle phase shows a Record control that calls onRecordToggle', () => {
    const onRecordToggle = vi.fn();
    render(<VoiceCaptureOverlay {...baseProps} onRecordToggle={onRecordToggle} />);
    fireEvent.click(screen.getByRole('button', { name: /record/i }));
    expect(onRecordToggle).toHaveBeenCalled();
  });

  it('review phase shows the transcript and Keep/Redo', () => {
    const onKeep = vi.fn(); const onRedo = vi.fn();
    render(<VoiceCaptureOverlay {...baseProps} phase="review" transcript="It froze on lap 2." onKeep={onKeep} onRedo={onRedo} />);
    expect(screen.getByText('It froze on lap 2.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /keep/i }));
    fireEvent.click(screen.getByRole('button', { name: /redo/i }));
    expect(onKeep).toHaveBeenCalled();
    expect(onRedo).toHaveBeenCalled();
  });

  it('Escape calls onClose', () => {
    const onClose = vi.fn();
    render(<VoiceCaptureOverlay {...baseProps} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/VoiceCapture/VoiceCaptureOverlay.test.jsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `MicMeter.jsx`**

```jsx
import { useEffect, useRef } from 'react';

/**
 * Ref-driven mic level bar. Reads `levelRef.current` (0..1) on a rAF loop and
 * writes it to a transform — never re-renders the React tree. Lifted from the
 * original FeedbackPanel VU meter.
 */
export function MicMeter({ levelRef, active }) {
  const fillRef = useRef(null);
  const rafRef = useRef(null);
  useEffect(() => {
    if (!active) { if (rafRef.current) cancelAnimationFrame(rafRef.current); return undefined; }
    const tick = () => {
      const lvl = Math.max(0.02, Math.min(1, levelRef?.current || 0));
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${lvl.toFixed(3)})`;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [active, levelRef]);
  return (
    <div className="voice-capture-overlay__meter" aria-hidden="true">
      <span ref={fillRef} className="voice-capture-overlay__meter-fill" />
    </div>
  );
}

export default MicMeter;
```

- [ ] **Step 4: Create `VoiceCaptureOverlay.jsx`**

```jsx
import { useEffect } from 'react';
import ReactDOM from 'react-dom';
import { MicMeter } from './MicMeter.jsx';
import './VoiceCaptureOverlay.scss';

function mmss(ms) {
  const total = Math.floor((ms || 0) / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Presentational voice-capture overlay. Renders one phase view from props and
 * emits callbacks; it owns no recorder or network logic. Rendered via a portal
 * to document.body so it works from any host.
 *
 * phase: 'idle' | 'recording' | 'processing' | 'review'
 */
export function VoiceCaptureOverlay({
  open, title = 'Voice note', prompt = '',
  phase = 'idle', durationMs = 0, levelRef,
  transcript = '', transcriptStatus = null, error = null,
  onRecordToggle, onKeep, onRedo, onClose,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose?.(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const portalTarget = typeof document !== 'undefined' ? document.body : null;
  const isRecording = phase === 'recording';

  const content = (
    <div
      className="voice-capture-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className="voice-capture-overlay__panel" role="dialog" aria-label={title}>
        <div className="voice-capture-overlay__header">
          <div className="voice-capture-overlay__title">{title}</div>
          <button type="button" className="voice-capture-overlay__close" aria-label="Close" onClick={onClose}>✕</button>
        </div>

        {(phase === 'idle' || isRecording) && (
          <div className="voice-capture-overlay__content voice-capture-overlay__content--centered">
            {prompt && <p className="voice-capture-overlay__prompt">{prompt}</p>}
            <button
              type="button"
              className={`voice-capture-overlay__record${isRecording ? ' is-recording' : ''}`}
              onClick={onRecordToggle}
            >
              <span className="voice-capture-overlay__dot" />
              <span className="voice-capture-overlay__record-label">
                {isRecording ? `Stop · ${mmss(durationMs)}` : 'Record'}
              </span>
            </button>
            {isRecording && <MicMeter levelRef={levelRef} active />}
            {error && <p className="voice-capture-overlay__error">{error}</p>}
          </div>
        )}

        {phase === 'processing' && (
          <div className="voice-capture-overlay__content voice-capture-overlay__content--centered">
            <div className="voice-capture-overlay__processing">Transcribing…</div>
          </div>
        )}

        {phase === 'review' && (
          <div className="voice-capture-overlay__content voice-capture-overlay__content--review">
            <div className="voice-capture-overlay__transcript">
              {transcript || (transcriptStatus === 'failed'
                ? 'Transcription failed — your note was still saved.'
                : 'Saved — your note will appear in the inbox shortly.')}
            </div>
            {error && <p className="voice-capture-overlay__error">{error}</p>}
            <div className="voice-capture-overlay__actions">
              <button type="button" className="voice-capture-overlay__keep" onClick={onKeep}>Keep</button>
              <button type="button" className="voice-capture-overlay__redo" onClick={onRedo}>Redo</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return portalTarget ? ReactDOM.createPortal(content, portalTarget) : content;
}

export default VoiceCaptureOverlay;
```

- [ ] **Step 5: Create `VoiceCaptureOverlay.scss`**

```scss
.voice-capture-overlay {
  position: fixed; inset: 0; z-index: 1000;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.62);

  &__panel {
    width: min(92vw, 460px); max-height: 80vh; overflow: hidden;
    display: flex; flex-direction: column;
    background: #15181d; color: #f2f4f7; border-radius: 16px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }
  &__header { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid rgba(255,255,255,0.08); }
  &__title { font-size: 1.05rem; font-weight: 600; }
  &__close { background: none; border: none; color: inherit; font-size: 1.1rem; cursor: pointer; opacity: 0.7; &:hover { opacity: 1; } }

  &__content { padding: 22px 20px; }
  &__content--centered { display: flex; flex-direction: column; align-items: center; gap: 16px; }
  &__content--review { display: flex; flex-direction: column; gap: 16px; }

  &__prompt { margin: 0; text-align: center; opacity: 0.82; }

  &__record {
    display: inline-flex; align-items: center; gap: 10px;
    padding: 12px 22px; border-radius: 999px; border: none; cursor: pointer;
    background: #e23b3b; color: #fff; font-size: 1rem; font-weight: 600;
    &.is-recording { background: #2b2f36; }
  }
  &__dot { width: 12px; height: 12px; border-radius: 50%; background: #fff; }
  &__record.is-recording &__dot { background: #e23b3b; animation: vc-pulse 1s infinite; }
  @keyframes vc-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }

  &__meter { width: 80%; height: 8px; border-radius: 4px; background: rgba(255,255,255,0.1); overflow: hidden; }
  &__meter-fill { display: block; height: 100%; width: 100%; transform-origin: left center; transform: scaleX(0.02); background: #4ade80; }

  &__processing { font-size: 1.05rem; opacity: 0.85; }
  &__transcript { font-size: 1.1rem; line-height: 1.5; white-space: pre-wrap; }
  &__error { color: #ff8585; margin: 0; }

  &__actions { display: flex; gap: 12px; justify-content: flex-end; }
  &__keep, &__redo { padding: 10px 20px; border-radius: 10px; border: none; cursor: pointer; font-weight: 600; }
  &__keep { background: #2f9e57; color: #fff; }
  &__redo { background: #2b2f36; color: #f2f4f7; }
}
```

- [ ] **Step 6: Run the test, verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/VoiceCapture/VoiceCaptureOverlay.test.jsx`
Expected: PASS (4 passed).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/VoiceCapture/MicMeter.jsx frontend/src/modules/VoiceCapture/VoiceCaptureOverlay.jsx frontend/src/modules/VoiceCapture/VoiceCaptureOverlay.scss frontend/src/modules/VoiceCapture/VoiceCaptureOverlay.test.jsx
git commit -m "feat(voice-capture): presentational overlay + mic meter

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `feedbackApi` — transcript poll + delete

**Files:**
- Modify: `frontend/src/modules/Feedback/feedbackApi.js`
- Test: `frontend/src/modules/Feedback/feedbackApi.test.js`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Feedback/feedbackApi.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));
import { DaylightAPI } from '../../lib/api.mjs';
import { pollFeedbackTranscript, deleteFeedback } from './feedbackApi.js';

beforeEach(() => { DaylightAPI.mockReset(); });

describe('pollFeedbackTranscript', () => {
  it('resolves the item once transcriptStatus is done', async () => {
    DaylightAPI
      .mockResolvedValueOnce({ id: '1', transcriptStatus: 'pending' })
      .mockResolvedValueOnce({ id: '1', transcriptStatus: 'done', transcript: 'hi there' });
    const item = await pollFeedbackTranscript({ app: 'piano', id: '1', intervalMs: 1, timeoutMs: 1000 });
    expect(item.transcript).toBe('hi there');
    // GET must not carry a body (else DaylightAPI converts to POST)
    expect(DaylightAPI).toHaveBeenLastCalledWith('api/v1/feedback/piano/1');
  });

  it('resolves a timeout marker if it never finishes', async () => {
    DaylightAPI.mockResolvedValue({ id: '1', transcriptStatus: 'pending' });
    const item = await pollFeedbackTranscript({ app: 'piano', id: '1', intervalMs: 1, timeoutMs: 8 });
    expect(item.transcriptStatus).toBe('timeout');
  });
});

describe('deleteFeedback', () => {
  it('issues a DELETE for the item', async () => {
    DaylightAPI.mockResolvedValue({ ok: true, id: '1' });
    await deleteFeedback({ app: 'piano', id: '1' });
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/feedback/piano/1', {}, 'DELETE');
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Feedback/feedbackApi.test.js`
Expected: FAIL — `pollFeedbackTranscript`/`deleteFeedback` are not exported.

- [ ] **Step 3: Implement**

Append to `frontend/src/modules/Feedback/feedbackApi.js` (keep existing `submitFeedback` / default export):

```javascript
const TERMINAL_TRANSCRIPT = new Set(['done', 'failed', 'unavailable']);

/**
 * Poll the feedback item until its transcript reaches a terminal status or we
 * hit the timeout. Resolves the full item; on timeout resolves a marker with
 * transcriptStatus:'timeout' (the item is saved regardless). NOTE: the GET must
 * be called with NO body — DaylightAPI promotes any GET with a body to POST.
 */
export async function pollFeedbackTranscript({ app, id, timeoutMs = 20000, intervalMs = 1500 } = {}) {
  const path = `api/v1/feedback/${app}/${id}`;
  const deadline = Date.now() + timeoutMs;
  let last = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    last = await DaylightAPI(path);
    if (last && TERMINAL_TRANSCRIPT.has(last.transcriptStatus)) return last;
    if (Date.now() >= deadline) return { ...(last || { id, app }), transcriptStatus: 'timeout' };
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Discard a saved feedback item (used by the overlay's Redo path). */
export async function deleteFeedback({ app, id } = {}) {
  return DaylightAPI(`api/v1/feedback/${app}/${id}`, {}, 'DELETE');
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Feedback/feedbackApi.test.js`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Feedback/feedbackApi.js frontend/src/modules/Feedback/feedbackApi.test.js
git commit -m "feat(feedback): transcript poll + delete api helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `FeedbackOverlay` (state machine)

**Files:**
- Create: `frontend/src/modules/Feedback/FeedbackOverlay.jsx`
- Test: `frontend/src/modules/Feedback/FeedbackOverlay.test.jsx`

State machine: `idle → recording → submitting → transcribing → review → done|error`. The overlay's `phase` prop maps: `submitting`/`transcribing` → `'processing'`; `review` → `'review'`; otherwise `'idle'`/`'recording'`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Feedback/FeedbackOverlay.test.jsx`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('../VoiceCapture/useMediaRecorderCapture.js', () => {
  const state = { isRecording: false };
  return {
    useMediaRecorderCapture: () => ({
      isRecording: state.isRecording,
      durationMs: 1200,
      levelRef: { current: 0 },
      error: null,
      start: vi.fn(async () => { state.isRecording = true; }),
      stop: vi.fn(async () => { state.isRecording = false; return { blob: new Blob(['x']), durationMs: 1200, mimeType: 'audio/webm' }; }),
    }),
  };
});
vi.mock('./feedbackApi.js', () => ({
  submitFeedback: vi.fn(async () => ({ id: 'f1', transcriptStatus: 'pending' })),
  pollFeedbackTranscript: vi.fn(async () => ({ id: 'f1', transcriptStatus: 'done', transcript: 'It stutters.' })),
  deleteFeedback: vi.fn(async () => ({ ok: true })),
}));

import { submitFeedback, pollFeedbackTranscript, deleteFeedback } from './feedbackApi.js';
import FeedbackOverlay from './FeedbackOverlay.jsx';

beforeEach(() => { submitFeedback.mockClear(); pollFeedbackTranscript.mockClear(); deleteFeedback.mockClear(); });

describe('FeedbackOverlay', () => {
  it('records, submits, polls, and shows the transcript; pauses/resumes music', async () => {
    const onPauseMusic = vi.fn(); const onResumeMusic = vi.fn(); const onClose = vi.fn();
    render(<FeedbackOverlay open app="piano" onClose={onClose} onPauseMusic={onPauseMusic} onResumeMusic={onResumeMusic} />);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /record/i })); });
    expect(onPauseMusic).toHaveBeenCalledTimes(1);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /stop/i })); });
    await waitFor(() => expect(screen.getByText('It stutters.')).toBeInTheDocument());
    expect(submitFeedback).toHaveBeenCalledWith(expect.objectContaining({ app: 'piano' }));
    expect(pollFeedbackTranscript).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /keep/i }));
    expect(onResumeMusic).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it('Redo deletes the saved item and returns to recording', async () => {
    render(<FeedbackOverlay open app="piano" onClose={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /record/i })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /stop/i })); });
    await waitFor(() => expect(screen.getByText('It stutters.')).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /redo/i })); });
    expect(deleteFeedback).toHaveBeenCalledWith({ app: 'piano', id: 'f1' });
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Feedback/FeedbackOverlay.test.jsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `FeedbackOverlay.jsx`**

```jsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMediaRecorderCapture } from '../VoiceCapture/useMediaRecorderCapture.js';
import { VoiceCaptureOverlay } from '../VoiceCapture/VoiceCaptureOverlay.jsx';
import { submitFeedback, pollFeedbackTranscript, deleteFeedback } from './feedbackApi.js';
import getLogger from '../../lib/logging/Logger.js';

const log = () => getLogger().child({ component: 'feedback-overlay' });

/**
 * Modal feedback capture: record → submit → poll transcript → review (Keep/Redo).
 * No audio playback. Host injects `app`, optional `context`, and optional
 * onPauseMusic/onResumeMusic (fired on record-start / close). Built on the
 * neutral VoiceCapture core.
 *
 * @param {boolean} open
 * @param {string}  app
 * @param {object}  [context]
 * @param {string}  [prompt]
 * @param {() => void} onClose
 * @param {() => void} [onPauseMusic]
 * @param {() => void} [onResumeMusic]
 */
export default function FeedbackOverlay({
  open, app, context = {}, prompt = 'Found a bug or rough edge? Record a quick note.',
  onClose, onPauseMusic, onResumeMusic,
}) {
  const { isRecording, durationMs, levelRef, error: recError, start, stop } = useMediaRecorderCapture();
  // 'idle' | 'recording' | 'submitting' | 'transcribing' | 'review' | 'error'
  const [machine, setMachine] = useState('idle');
  const [item, setItem] = useState(null); // { id, transcript, transcriptStatus }
  const [saveError, setSaveError] = useState(null);
  const musicPausedRef = useRef(false);

  const pauseMusic = useCallback(() => {
    if (!musicPausedRef.current) { musicPausedRef.current = true; onPauseMusic?.(); }
  }, [onPauseMusic]);
  const resumeMusic = useCallback(() => {
    if (musicPausedRef.current) { musicPausedRef.current = false; onResumeMusic?.(); }
  }, [onResumeMusic]);

  // Resume music if the overlay unmounts mid-recording.
  useEffect(() => () => { resumeMusic(); }, [resumeMusic]);

  const runSubmit = useCallback(async (blob, dur) => {
    setMachine('submitting');
    setSaveError(null);
    try {
      const created = await submitFeedback({ app, blob, durationMs: dur, context });
      setItem(created);
      setMachine('transcribing');
      const finished = await pollFeedbackTranscript({ app, id: created.id });
      setItem(finished);
      setMachine('review');
      log().info('feedback.transcript-ready', { id: created.id, status: finished.transcriptStatus });
    } catch (err) {
      setSaveError(err.message || 'Save failed');
      setMachine('error');
      log().error('feedback.submit-failed', { error: err.message });
    }
  }, [app, context]);

  const onRecordToggle = useCallback(async () => {
    if (isRecording) {
      const take = await stop();
      if (take?.blob?.size) { runSubmit(take.blob, take.durationMs); }
      else { setMachine('idle'); }
    } else {
      setSaveError(null);
      pauseMusic();
      setMachine('recording');
      await start();
    }
  }, [isRecording, start, stop, runSubmit, pauseMusic]);

  const handleClose = useCallback(() => {
    if (isRecording) { stop().catch(() => {}); }
    resumeMusic();
    setMachine('idle');
    setItem(null);
    onClose?.();
  }, [isRecording, stop, resumeMusic, onClose]);

  const onKeep = useCallback(() => { handleClose(); }, [handleClose]);

  const onRedo = useCallback(async () => {
    if (item?.id) { deleteFeedback({ app, id: item.id }).catch((err) => log().warn('feedback.redo-delete-failed', { error: err.message })); }
    setItem(null);
    setSaveError(null);
    setMachine('recording');
    await start();
  }, [item, app, start]);

  // Map the machine to the presentational phase.
  const phase = machine === 'submitting' || machine === 'transcribing' ? 'processing'
    : machine === 'review' || machine === 'error' ? 'review'
    : isRecording ? 'recording' : 'idle';

  return (
    <VoiceCaptureOverlay
      open={open}
      title="Feedback"
      prompt={prompt}
      phase={phase}
      durationMs={durationMs}
      levelRef={levelRef}
      transcript={item?.transcript || ''}
      transcriptStatus={item?.transcriptStatus || null}
      error={saveError || recError || null}
      onRecordToggle={onRecordToggle}
      onKeep={onKeep}
      onRedo={onRedo}
      onClose={handleClose}
    />
  );
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Feedback/FeedbackOverlay.test.jsx`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Feedback/FeedbackOverlay.jsx frontend/src/modules/Feedback/FeedbackOverlay.test.jsx
git commit -m "feat(feedback): transcript-visible modal overlay with music pause

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Host wiring — Piano migrate + Fitness menu entry

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/PianoSettingsSheet.jsx`
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx`

No new test file (integration is exercised by Tasks 2/4 + the existing suites of these hosts). This task is wiring; verify by the regression sweep in Task 6 and a manual build.

- [ ] **Step 1: Migrate Piano settings**

In `frontend/src/modules/Piano/PianoKiosk/PianoSettingsSheet.jsx`:
- Replace the import `import FeedbackPanel from '...FeedbackPanel...'` (find the existing import line) with `import FeedbackOverlay from '@/modules/Feedback/FeedbackOverlay.jsx';` and add `import { useState } from 'react';` if `useState` isn't already imported (it likely is).
- Add local state near the top of the component body: `const [feedbackOpen, setFeedbackOpen] = useState(false);`
- Replace the feedback tab body (currently `<FeedbackPanel app="piano" context={{ pianoId, surface: 'settings' }} />`, around line 144) with a trigger button + the overlay:

```jsx
        {tab === 'feedback' && (
          <section className="piano-settings__section piano-settings__section--grow">
            <h3 className="piano-settings__eyebrow">Feedback</h3>
            <button type="button" className="piano-settings__feedback-open" onClick={() => setFeedbackOpen(true)}>
              Record feedback
            </button>
            <FeedbackOverlay
              open={feedbackOpen}
              app="piano"
              context={{ pianoId, surface: 'settings' }}
              onClose={() => setFeedbackOpen(false)}
            />
          </section>
        )}
```

(Piano has no menu music, so no music callbacks are passed.)

- [ ] **Step 2: Add the Fitness menu entry**

In `frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx`:
- Add imports at the top: `import FeedbackOverlay from '@/modules/Feedback/FeedbackOverlay.jsx';` and ensure `useState` is imported from react (it is used heavily here already).
- Read the music controls from context. This file already consumes fitness context/props; locate where `useFitnessContext()` is called (or where `pauseMusicPlayer`/`resumeMusicPlayer` are obtainable). Add: `const { pauseMusicPlayer, resumeMusicPlayer } = useFitnessContext();` if not already destructured. If the file does not already import `useFitnessContext`, add `import { useFitnessContext } from '@/context/FitnessContext.jsx';`.
- Add state: `const [feedbackOpen, setFeedbackOpen] = useState(false);`
- Add a menu item button in the menu list (place it near the other full-width menu items, e.g. just before the "End current fitness session" control around line 333). Use the existing `menu-item` styling pattern:

```jsx
        <button
          type="button"
          className="menu-item"
          aria-label="Send feedback"
          onClick={() => setFeedbackOpen(true)}
        >
          💬 Send feedback
        </button>
        <FeedbackOverlay
          open={feedbackOpen}
          app="fitness"
          onClose={() => setFeedbackOpen(false)}
          onPauseMusic={pauseMusicPlayer}
          onResumeMusic={resumeMusicPlayer}
        />
```

- [ ] **Step 3: Build-check the frontend compiles**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/ frontend/src/modules/Fitness/player/panels/ --exclude '**/.claire/**'`
Expected: existing host tests still pass (no import/render errors from the new wiring). If a host test renders these sheets without a FitnessContext provider, the `useFitnessContext()` call must tolerate being outside the provider — verify `useFitnessContext` returns a value (it does; it reads a default context). If any test fails due to a missing provider, wrap the new `useFitnessContext()` read defensively: `const ctx = useFitnessContext() || {}; const { pauseMusicPlayer, resumeMusicPlayer } = ctx;`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/PianoSettingsSheet.jsx frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx
git commit -m "feat(feedback): wire overlay into piano settings + fitness menu

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Remove the superseded panel + full sweep

**Files:**
- Remove: `frontend/src/modules/Feedback/FeedbackPanel.jsx`, `frontend/src/modules/Feedback/FeedbackPanel.scss`, `frontend/src/modules/Feedback/useFeedbackRecorder.js`

- [ ] **Step 1: Confirm no remaining importers**

Run: `grep -rn "FeedbackPanel\|useFeedbackRecorder" frontend/src --include=*.jsx --include=*.js | grep -v node_modules`
Expected: ZERO matches outside the files being deleted. If any remain, fix the importer first (it should have been migrated in Task 5).

- [ ] **Step 2: Delete the files**

```bash
git rm frontend/src/modules/Feedback/FeedbackPanel.jsx frontend/src/modules/Feedback/FeedbackPanel.scss frontend/src/modules/Feedback/useFeedbackRecorder.js
```

If `git rm` is permission-blocked, instead `mkdir -p _deleteme/Feedback && git mv` the three files there.

- [ ] **Step 3: Full regression sweep**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/VoiceCapture/ frontend/src/modules/Feedback/ frontend/src/modules/Piano/ frontend/src/modules/Fitness/player/panels/ --exclude '**/.claire/**'`
Expected: all green; the new VoiceCapture (6) + Feedback (5) tests present and passing; no host regressions.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(feedback): remove superseded FeedbackPanel + useFeedbackRecorder

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** neutral core (Task 1+2) ✓; transcript poll + delete (Task 3) ✓; transcript-visible state machine + music pause/resume-once (Task 4) ✓; Piano migrate + Fitness entry with injected music callbacks (Task 5) ✓; remove duplication (Task 6) ✓; VoiceMemoOverlay untouched ✓ (no task modifies it). No backend change ✓.
- **Placeholder scan:** all steps carry concrete code/commands; no TBD/TODO.
- **Type/name consistency:** `useMediaRecorderCapture` returns `{ isRecording, durationMs, levelRef, error, start, stop }` (Task 1), consumed identically in Task 4. `VoiceCaptureOverlay` props (`phase/levelRef/transcript/transcriptStatus/onRecordToggle/onKeep/onRedo/onClose`) defined in Task 2 and passed identically in Task 4. `pollFeedbackTranscript({app,id})` / `deleteFeedback({app,id})` signatures defined in Task 3 and called identically in Task 4. `phase` values (`idle|recording|processing|review`) consistent across Task 2 view and Task 4 mapping.
