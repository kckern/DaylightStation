# Fitness Debug Voice Memos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a developer-only microphone button in the Fitness app that records a quick audio note and saves the raw `.webm` blob to `data/_debug/voice_memos/` on the backend. Gated behind the existing `FITNESS_DEBUG` frontend flag so it never appears in production. Completely independent of the workout voice memo system — no transcription, no session metadata, no Strava enrichment.

**Architecture:** One new frontend hook (`useDebugVoiceMemo.js`) wraps `MediaRecorder` and base64-encodes the resulting blob. One new presentational component (`DebugMicButton.jsx`) is rendered inside `FitnessSidebarMenu`'s "Quick Actions" section, behind `FITNESS_DEBUG`. One new backend route (`POST /api/v1/fitness/debug/voice-memo`) base64-decodes the payload and calls the canonical `writeBinary(filePath, buffer)` helper to land the file at `<dataDir>/_debug/voice_memos/<iso>.webm`. The existing `/api/v1/fitness/voice_memo` route, `useVoiceMemoRecorder`, `VoiceMemoTranscriptionService`, `enrichmentService.reEnrichDescription`, and `session.voiceMemoManager` are not touched.

**Flag exposure:** `FITNESS_DEBUG` is currently a local `const` inside `FitnessProvider` in `frontend/src/context/FitnessContext.jsx`. Promote it to a module-level `export const FITNESS_DEBUG = false;` at the top of the file; `FitnessProvider` reads the same module constant. Zero behavior change in existing call sites.

**Storage path choice:** `<configService.getDataDir()>/_debug/voice_memos/` — top-level `_debug` directory (developer-only), not mixed with household data.

**Filename:** ISO timestamp with colons replaced by hyphens: `YYYY-MM-DDTHH-mm-ss-sssZ.webm`.

**Cleanup policy:** None — unbounded, manual cleanup. Low-volume developer artifacts.

**Admin gating beyond `FITNESS_DEBUG`:** None. Frontend visibility gate is sufficient; the backend route sits behind the household auth context like the rest of `/api/v1/fitness/*`. A comment in the route annotates it as debug-only.

**Tech Stack:** Node.js (ESM), Express, Jest (backend), Vitest (frontend hook tests), React, MediaRecorder Web API.

---

## File Structure

| File | Role | Change |
|---|---|---|
| `frontend/src/context/FitnessContext.jsx` | Holds `FITNESS_DEBUG` flag | Promote local `const` to module-level `export const` |
| `frontend/src/modules/Fitness/player/panels/hooks/useDebugVoiceMemo.js` | NEW — minimal MediaRecorder hook | New file |
| `frontend/src/modules/Fitness/player/panels/hooks/useDebugVoiceMemo.test.js` | NEW — Vitest spec | New file |
| `frontend/src/modules/Fitness/player/panels/DebugMicButton.jsx` | NEW — tiny icon button | New file |
| `frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx` | Hosts the new button under `FITNESS_DEBUG` gate | Add import + one conditional render |
| `backend/src/4_api/v1/routers/fitness.mjs` | Hosts the new debug-memo route | Add one new route |
| `tests/isolated/api/routers/fitness-debug-voice-memo.test.mjs` | NEW — supertest-style route test | New file |

---

## Background — Canonical Helpers

- `writeBinary(filePath, buffer)` from `#system/utils/FileIO.mjs` — calls `ensureDir(path.dirname(filePath))` then `fs.writeFileSync`. Already imported at `backend/src/4_api/v1/routers/fitness.mjs:34`.
- `configService.getDataDir()` returns the data root. Available on the router's closure.
- `DaylightAPI(path, data, 'POST')` from `@/lib/api.mjs` — canonical frontend POST helper used throughout the app.

---

## Task 1: Expose `FITNESS_DEBUG` at module scope (prep, no behavior change)

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx`

- [ ] **Step 1: Add a module-level export at the top of the file**

After the import block and before the first `const`/`export`, insert:

```jsx
// Developer-only flag for the Fitness app. Gates debug-only UI and logging.
// Must remain `false` on main; flip locally when needed.
export const FITNESS_DEBUG = false;
```

- [ ] **Step 2: Remove the local `const` inside `FitnessProvider` (~line 122)**

Delete:

```jsx
  const FITNESS_DEBUG = false;
```

The three existing usages (lines 719, 730, 2087) will close over the module-level constant unchanged.

- [ ] **Step 3: Sanity test**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/context
```

Expected: existing tests pass (or "No test files found").

- [ ] **Step 4: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/context/FitnessContext.jsx
git commit -m "refactor(fitness): promote FITNESS_DEBUG to module-level export"
```

---

## Task 2: Failing test for the debug recorder hook (RED)

**Files:**
- Create: `frontend/src/modules/Fitness/player/panels/hooks/useDebugVoiceMemo.test.js`

- [ ] **Step 1: Create the Vitest spec**

```js
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import useDebugVoiceMemo from './useDebugVoiceMemo.js';

vi.mock('@/lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => Promise.resolve({
    ok: true,
    filename: '2026-04-23T15-22-09-123Z.webm',
    path: 'data/_debug/voice_memos/2026-04-23T15-22-09-123Z.webm',
    size: 5,
    savedAt: 1714000000000
  }))
}));

class MockMediaRecorder {
  constructor(stream) {
    this.state = 'inactive';
    this.ondataavailable = null;
    this.onstop = null;
    this.stream = stream;
    MockMediaRecorder.instances.push(this);
  }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; }
  fireStop() {
    this.ondataavailable?.({ data: new Blob(['chunk'], { type: 'audio/webm' }) });
    this.onstop?.();
  }
}
MockMediaRecorder.instances = [];

function Host({ apiRef }) {
  const api = useDebugVoiceMemo();
  apiRef.current = api;
  return null;
}

describe('useDebugVoiceMemo', () => {
  beforeEach(() => {
    MockMediaRecorder.instances = [];
    global.MediaRecorder = MockMediaRecorder;
    global.navigator.mediaDevices = {
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: () => [{ stop: vi.fn() }]
      })
    };
    global.FileReader = class {
      constructor() { this.result = null; this.onloadend = null; this.onerror = null; }
      readAsDataURL(blob) {
        this.result = `data:${blob.type};base64,Y2h1bms=`;
        queueMicrotask(() => this.onloadend?.());
      }
    };
  });

  it('posts base64 audio to the debug endpoint after stopRecording', async () => {
    const { DaylightAPI } = await import('@/lib/api.mjs');
    DaylightAPI.mockClear();

    const apiRef = { current: null };
    render(React.createElement(Host, { apiRef }));

    await act(async () => { await apiRef.current.startRecording(); });
    expect(MockMediaRecorder.instances.length).toBe(1);
    const recorder = MockMediaRecorder.instances[0];

    act(() => { apiRef.current.stopRecording(); });

    await act(async () => {
      recorder.fireStop();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(DaylightAPI).toHaveBeenCalledTimes(1);
    const [pathArg, payloadArg, methodArg] = DaylightAPI.mock.calls[0];
    expect(pathArg).toBe('api/v1/fitness/debug/voice-memo');
    expect(methodArg).toBe('POST');
    expect(payloadArg).toHaveProperty('audioBase64');
    expect(payloadArg).toHaveProperty('mimeType', 'audio/webm');
    // Scope guarantee: no session metadata / context attached.
    expect(payloadArg).not.toHaveProperty('sessionId');
    expect(payloadArg).not.toHaveProperty('context');
    expect(payloadArg).not.toHaveProperty('startedAt');
    expect(payloadArg).not.toHaveProperty('endedAt');
  });

  it('exposes isRecording state that flips true during recording and false after stop', async () => {
    const apiRef = { current: null };
    render(React.createElement(Host, { apiRef }));

    expect(apiRef.current.isRecording).toBe(false);
    await act(async () => { await apiRef.current.startRecording(); });
    expect(apiRef.current.isRecording).toBe(true);
    act(() => { apiRef.current.stopRecording(); });
    expect(apiRef.current.isRecording).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module not yet created)

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Fitness/player/panels/hooks/useDebugVoiceMemo.test.js
```

- [ ] **Step 3: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Fitness/player/panels/hooks/useDebugVoiceMemo.test.js
git commit -m "test(fitness-debug): failing spec for useDebugVoiceMemo hook"
```

---

## Task 3: Implement `useDebugVoiceMemo` (GREEN)

**Files:**
- Create: `frontend/src/modules/Fitness/player/panels/hooks/useDebugVoiceMemo.js`

- [ ] **Step 1: Create the hook**

```js
import { useCallback, useEffect, useRef, useState } from 'react';
import { DaylightAPI } from '@/lib/api.mjs';

const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onloadend = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

const MAX_RECORDING_MS = 5 * 60 * 1000;

/**
 * Minimal debug voice-memo recorder. DEVELOPER-ONLY.
 * Intentionally independent of the workout voice-memo system.
 */
const useDebugVoiceMemo = () => {
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const maxDurationTimerRef = useRef(null);

  const [isRecording, setIsRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const cleanupStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try { track.stop(); } catch (_) { /* ignore */ }
      });
      streamRef.current = null;
    }
    if (maxDurationTimerRef.current) {
      clearTimeout(maxDurationTimerRef.current);
      maxDurationTimerRef.current = null;
    }
  }, []);

  const handleRecordingStop = useCallback(async () => {
    if (!chunksRef.current.length) return;
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
    chunksRef.current = [];
    try {
      setUploading(true);
      const base64 = await blobToBase64(blob);
      const payload = { audioBase64: base64, mimeType: blob.type };
      const resp = await DaylightAPI('api/v1/fitness/debug/voice-memo', payload, 'POST');
      if (!resp?.ok) {
        throw new Error(resp?.error || 'Upload failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setUploading(false);
    }
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = handleRecordingStop;
      recorder.start();
      setIsRecording(true);
      maxDurationTimerRef.current = setTimeout(() => {
        try { mediaRecorderRef.current?.stop(); } catch (_) { /* ignore */ }
        setIsRecording(false);
        cleanupStream();
      }, MAX_RECORDING_MS);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [cleanupStream, handleRecordingStop]);

  const stopRecording = useCallback(() => {
    try { mediaRecorderRef.current?.stop(); } catch (_) { /* ignore */ }
    setIsRecording(false);
    cleanupStream();
  }, [cleanupStream]);

  useEffect(() => () => {
    cleanupStream();
    try { mediaRecorderRef.current?.stop(); } catch (_) { /* ignore */ }
    mediaRecorderRef.current = null;
  }, [cleanupStream]);

  return { isRecording, uploading, error, startRecording, stopRecording };
};

export default useDebugVoiceMemo;
```

- [ ] **Step 2: Run hook spec — expect PASS**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Fitness/player/panels/hooks/useDebugVoiceMemo.test.js
```

- [ ] **Step 3: Run existing workout voice-memo spec to confirm no contamination**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Fitness/player/panels/hooks/useVoiceMemoRecorder.test.js
```

- [ ] **Step 4: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Fitness/player/panels/hooks/useDebugVoiceMemo.js
git commit -m "feat(fitness-debug): add useDebugVoiceMemo hook"
```

---

## Task 4: DebugMicButton component + Sidebar integration

**Files:**
- Create: `frontend/src/modules/Fitness/player/panels/DebugMicButton.jsx`
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx`

- [ ] **Step 1: Create `DebugMicButton.jsx`**

```jsx
import React from 'react';
import useDebugVoiceMemo from './hooks/useDebugVoiceMemo.js';

/**
 * Developer-only microphone button. Rendered inside the Fitness sidebar's
 * Quick Actions section, behind FITNESS_DEBUG.
 */
const DebugMicButton = () => {
  const { isRecording, uploading, error, startRecording, stopRecording } = useDebugVoiceMemo();

  const handleClick = () => {
    if (isRecording) stopRecording();
    else startRecording();
  };

  const label = isRecording
    ? '⏺ Stop Debug Memo'
    : uploading
      ? '⏳ Saving…'
      : '🎙️ Debug Memo';

  return (
    <button
      type="button"
      className={`menu-item action-item${isRecording ? ' is-ack-flash' : ''}`}
      onClick={handleClick}
      disabled={uploading && !isRecording}
      title={error ? `Error: ${error.message}` : 'Record a quick developer audio note'}
      data-testid="debug-mic-button"
    >
      <span>{label}</span>
    </button>
  );
};

export default DebugMicButton;
```

- [ ] **Step 2: Wire into `FitnessSidebarMenu.jsx`**

After the existing imports (~line 5), add:

```jsx
import { FITNESS_DEBUG } from '@/context/FitnessContext.jsx';
import DebugMicButton from './DebugMicButton.jsx';
```

Find the "Quick Actions" section (~lines 303-309) and replace with:

```jsx
      <div className="menu-section">
        <h4>Quick Actions</h4>
        <button type="button" className="menu-item action-item" onClick={handleReloadPage}>
          <span>🔄 Reload App</span>
        </button>
        {FITNESS_DEBUG && <DebugMicButton />}
      </div>
```

- [ ] **Step 3: Sanity check**

```bash
cd /opt/Code/DaylightStation && grep -n "DebugMicButton\|FITNESS_DEBUG" frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx
```

Expected: 3 matches (2 imports + 1 render).

- [ ] **Step 4: Run frontend test suite**

```bash
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Fitness
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Fitness/player/panels/DebugMicButton.jsx \
        frontend/src/modules/Fitness/player/panels/FitnessSidebarMenu.jsx
git commit -m "feat(fitness-debug): add DebugMicButton to sidebar Quick Actions"
```

---

## Task 5: Failing backend route test (RED)

**Files:**
- Create: `tests/isolated/api/routers/fitness-debug-voice-memo.test.mjs`

- [ ] **Step 1: Create the test file**

```js
// tests/isolated/api/routers/fitness-debug-voice-memo.test.mjs
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createFitnessRouter } from '../../../../backend/src/4_api/v1/routers/fitness.mjs';

describe('POST /api/v1/fitness/debug/voice-memo', () => {
  let app;
  let tmpDataDir;

  beforeEach(() => {
    tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'debug-memo-test-'));
    const configService = {
      getDefaultHouseholdId: () => 'default',
      getDataDir: () => tmpDataDir,
    };
    const router = createFitnessRouter({
      sessionService: { getStoragePaths: jest.fn() },
      zoneLedController: null,
      userService: { hydrateFitnessConfig: (d) => d },
      configService,
      contentRegistry: null,
      transcriptionService: null,
      logger: { debug: () => {}, warn: () => {}, error: () => {} },
    });
    app = express();
    app.use(express.json({ limit: '50mb' }));
    app.use((req, res, next) => { req.householdId = 'default'; next(); });
    app.use('/api/v1/fitness', router);
  });

  afterEach(() => {
    try { fs.rmSync(tmpDataDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  });

  it('writes a .webm file under data/_debug/voice_memos/ and returns metadata', async () => {
    const audioBase64 = 'data:audio/webm;base64,dGVzdA=='; // "test"
    const res = await request(app)
      .post('/api/v1/fitness/debug/voice-memo')
      .send({ audioBase64, mimeType: 'audio/webm' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.filename).toBe('string');
    expect(res.body.filename.endsWith('.webm')).toBe(true);
    expect(res.body.filename).not.toMatch(/:/);
    expect(res.body.size).toBe(4);
    expect(typeof res.body.savedAt).toBe('number');

    const writtenDir = path.join(tmpDataDir, '_debug', 'voice_memos');
    expect(fs.existsSync(writtenDir)).toBe(true);
    const files = fs.readdirSync(writtenDir);
    expect(files.length).toBe(1);
    expect(files[0]).toBe(res.body.filename);

    const buf = fs.readFileSync(path.join(writtenDir, files[0]));
    expect(buf.toString('utf8')).toBe('test');
  });

  it('accepts raw base64 without the data URI prefix', async () => {
    const res = await request(app)
      .post('/api/v1/fitness/debug/voice-memo')
      .send({ audioBase64: 'dGVzdA==', mimeType: 'audio/webm' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.size).toBe(4);
  });

  it('returns 400 when audioBase64 is missing', async () => {
    const res = await request(app)
      .post('/api/v1/fitness/debug/voice-memo')
      .send({ mimeType: 'audio/webm' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/audioBase64/);
  });

  it('does NOT attach sessionId or trigger Strava enrichment', async () => {
    const enrichmentService = { reEnrichDescription: jest.fn() };
    const configService = {
      getDefaultHouseholdId: () => 'default',
      getDataDir: () => tmpDataDir,
    };
    const router = createFitnessRouter({
      sessionService: { getStoragePaths: jest.fn() },
      zoneLedController: null,
      userService: { hydrateFitnessConfig: (d) => d },
      configService,
      contentRegistry: null,
      transcriptionService: null,
      enrichmentService,
      logger: { debug: () => {}, warn: () => {}, error: () => {} },
    });
    const local = express();
    local.use(express.json({ limit: '50mb' }));
    local.use((req, res, next) => { req.householdId = 'default'; next(); });
    local.use('/api/v1/fitness', router);

    const res = await request(local)
      .post('/api/v1/fitness/debug/voice-memo')
      .send({
        audioBase64: 'dGVzdA==',
        mimeType: 'audio/webm',
        sessionId: '20260423T000000',
        context: { householdId: 'default' }
      });

    expect(res.status).toBe(200);
    expect(enrichmentService.reEnrichDescription).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect 4 failures (404, route not registered)**

```bash
cd /opt/Code/DaylightStation && npx jest tests/isolated/api/routers/fitness-debug-voice-memo.test.mjs
```

- [ ] **Step 3: Commit**

```bash
cd /opt/Code/DaylightStation
git add tests/isolated/api/routers/fitness-debug-voice-memo.test.mjs
git commit -m "test(fitness-debug): failing spec for debug voice-memo route"
```

---

## Task 6: Implement the backend route (GREEN)

**Files:**
- Modify: `backend/src/4_api/v1/routers/fitness.mjs`

- [ ] **Step 1: Add the route just below the existing `/voice_memo` handler (~line 699)**

```js
  /**
   * POST /api/fitness/debug/voice-memo — Developer-only raw audio memo dump.
   *
   * DEBUG ONLY. Saves the raw webm blob under <dataDir>/_debug/voice_memos/
   * using an ISO timestamp as the filename. Intentionally independent of
   * the workout voice-memo system: NO transcription, NO sessionId linkage,
   * NO Strava enrichment, NO session context capture.
   */
  router.post('/debug/voice-memo', async (req, res) => {
    try {
      const { audioBase64 } = req.body || {};
      if (!audioBase64 || typeof audioBase64 !== 'string') {
        return res.status(400).json({ ok: false, error: 'audioBase64 required' });
      }

      const base64Data = audioBase64.replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      if (!buffer.length) {
        return res.status(400).json({ ok: false, error: 'Failed to decode audio data' });
      }

      const savedAt = Date.now();
      const iso = new Date(savedAt).toISOString().replace(/:/g, '-');
      const filename = `${iso}.webm`;

      const dataDir = configService.getDataDir();
      const debugDir = path.join(dataDir, '_debug', 'voice_memos');
      const filePath = path.join(debugDir, filename);

      // writeBinary handles mkdirSync({ recursive: true }) internally.
      writeBinary(filePath, buffer);

      logger.debug?.('fitness.debug_voice_memo.saved', { filename, size: buffer.length });

      return res.json({
        ok: true,
        path: filePath,
        filename,
        size: buffer.length,
        savedAt,
      });
    } catch (e) {
      logger.error?.('fitness.debug_voice_memo.error', { error: e.message });
      return res.status(500).json({ ok: false, error: e.message || 'debug voice memo failure' });
    }
  });
```

- [ ] **Step 2: Update the router header comment**

In the header block at line 1, after the line `* - POST /api/fitness/voice_memo - Transcribe voice memo` (~line 17), add:

```js
 * - POST /api/fitness/debug/voice-memo - Debug: save raw audio to data/_debug/
```

- [ ] **Step 3: Run backend tests — expect 4/4 PASS**

```bash
cd /opt/Code/DaylightStation && npx jest tests/isolated/api/routers/fitness-debug-voice-memo.test.mjs
```

- [ ] **Step 4: Run surrounding fitness router suite**

```bash
cd /opt/Code/DaylightStation && npx jest tests/isolated/api/routers/
```

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation
git add backend/src/4_api/v1/routers/fitness.mjs
git commit -m "feat(fitness-debug): add POST /api/v1/fitness/debug/voice-memo"
```

---

## Task 7: End-to-end smoke check

- [ ] **Step 1: Temporarily flip flag** — edit `FitnessContext.jsx`, set `FITNESS_DEBUG = true`. Reload frontend (Vite HMR).

- [ ] **Step 2: Open Settings menu, confirm 🎙️ Debug Memo button appears in Quick Actions** under 🔄 Reload App.

- [ ] **Step 3: Click, speak ~2s, click again** — expect "⏳ Saving…" flicker, then idle.

- [ ] **Step 4: Verify file landed**

```bash
sudo docker exec daylight-station sh -c 'ls -la data/_debug/voice_memos/'
```

Expected: one `.webm` file named like `2026-04-23T15-22-09-123Z.webm`, size > 0.

- [ ] **Step 5: Confirm no Strava re-enrichment fired**

```bash
sudo docker logs daylight-station 2>&1 | tail -40 | grep -iE "strava|voice_memo_backfill"
```

Expected: No backfill entries tied to this recording.

- [ ] **Step 6: Confirm no session YAML modified** — recent session dir mtime should predate the smoke test.

- [ ] **Step 7: Revert flag** — restore `FITNESS_DEBUG = false`. **DO NOT commit `true`.**

- [ ] **Step 8: Full sweep**

```bash
cd /opt/Code/DaylightStation && npx jest tests/isolated/api/routers/fitness-debug-voice-memo.test.mjs
cd /opt/Code/DaylightStation && npx vitest run frontend/src/modules/Fitness/player/panels/hooks/
```

---

## Done

- **New frontend hook** `useDebugVoiceMemo.js` — minimal MediaRecorder wrapper. No session context, no transcription.
- **New frontend component** `DebugMicButton.jsx` — toggles the hook; rendered in `FitnessSidebarMenu` Quick Actions behind `FITNESS_DEBUG`.
- **Flag promotion** — `FITNESS_DEBUG` moved from local `const` to module-level `export const` in `FitnessContext.jsx`.
- **New backend route** `POST /api/v1/fitness/debug/voice-memo` — base64 decode + `writeBinary` to `<dataDir>/_debug/voice_memos/<iso>.webm`. No transcription, no session linkage, no Strava enrichment.
- **Tests** — 1 Vitest spec + 1 Jest spec covering happy path + scope guarantees.
- **Out of scope** — retention/cleanup, admin gating beyond `FITNESS_DEBUG`, sidebar header CSS tweaks.
