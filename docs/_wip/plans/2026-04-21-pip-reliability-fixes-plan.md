# PIP Reliability Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two reliability fixes to the PIP panel-takeover feature so the first-ring doorbell experience is correct on all subscribed screens: (1) panel mode falls back to corner PIP when the target slot is occluded by a fullscreen overlay, and (2) the HLS `stream.m3u8` endpoint deduplicates concurrent first-time requests so the second client doesn't get an ENOENT 502.

**Architecture:** Section 1 is a 1-file frontend change — `PipManager.show()` reads `hasOverlay` from `useScreenOverlay()` and coerces `mode: 'panel'` → `mode: 'corner'` when an overlay is active, using the screen-level `pip:` config already in scope. Section 2 is a 1-file backend change — `HlsStreamManager.ensureStream()` stores its in-flight `#waitForPlaylist` promise on the stream entry, and every caller (first or Nth) awaits it before the adapter resolves.

**Tech Stack:** React (vitest + @testing-library/react for frontend tests), Node.js `.mjs` modules (jest via isolated harness for backend tests), ffmpeg subprocess (injected for testability).

**Spec:** `docs/_wip/plans/2026-04-21-pip-reliability-fixes-design.md`

---

## File Structure

**Frontend — Section 1**
- Modify: `frontend/src/screen-framework/pip/PipManager.jsx` — add `hasOverlay` destructure + fallback branch in `show()`
- Create: `frontend/src/screen-framework/pip/PipManager.test.jsx` — vitest integration test for the fallback and a regression check for panel mode on a non-occluded screen

**Backend — Section 2**
- Modify: `backend/src/1_adapters/camera/HlsStreamManager.mjs` — accept injectable `spawn` in constructor; track `readyPromise` on each stream entry; dedup in the `existing` branch
- Create: `tests/isolated/adapter/camera/HlsStreamManager.test.mjs` — jest test for concurrent `ensureStream` dedup using an injected fake spawn that simulates delayed playlist write

**No changes to:** `PanelRenderer.jsx`, `useScreenSubscriptions.js`, `camera.mjs` router, any YAML, any CSS, `CameraService.mjs` (constructor call `new HlsStreamManager({ logger })` still valid — `spawn` defaults).

---

## Section 1 — PIP Fullscreen Fallback

### Task 1: Write failing integration test for fullscreen fallback

**Files:**
- Create: `frontend/src/screen-framework/pip/PipManager.test.jsx`

- [ ] **Step 1: Write the test file**

```jsx
// frontend/src/screen-framework/pip/PipManager.test.jsx
import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React, { useEffect, useRef } from 'react';
import { ScreenOverlayProvider, useScreenOverlay } from '../overlays/ScreenOverlayProvider.jsx';
import { PipManager, usePip } from './PipManager.jsx';

function MockCameraOverlay() {
  return <div data-testid="camera-overlay">camera</div>;
}

function SlotRegistrar({ slotId }) {
  const { registerSlot, unregisterSlot } = usePip();
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) registerSlot(slotId, ref.current);
    return () => unregisterSlot(slotId);
  }, [slotId, registerSlot, unregisterSlot]);
  return <div ref={ref} data-testid={`slot-${slotId}`} style={{ width: 100, height: 100 }} />;
}

function Handles({ onReady }) {
  const overlay = useScreenOverlay();
  const pip = usePip();
  useEffect(() => { onReady({ overlay, pip }); }, [onReady, overlay, pip]);
  return null;
}

function setup() {
  let handles = null;
  const onReady = (h) => { handles = h; };
  render(
    <ScreenOverlayProvider>
      <PipManager config={{ position: 'bottom-right', size: 25, margin: 16 }}>
        <SlotRegistrar slotId="main-content" />
        <Handles onReady={onReady} />
      </PipManager>
    </ScreenOverlayProvider>
  );
  return () => handles;
}

describe('PipManager — fullscreen-aware fallback', () => {
  it('falls back to corner mode when panel mode is requested while a fullscreen overlay is active', () => {
    const getHandles = setup();

    // Activate a fullscreen overlay → hasOverlay becomes true
    act(() => {
      getHandles().overlay.showOverlay(() => <div data-testid="fullscreen">fs</div>, {}, { mode: 'fullscreen' });
    });

    // Request panel mode — should coerce to corner
    act(() => {
      getHandles().pip.show(MockCameraOverlay, {}, { mode: 'panel', target: 'main-content', timeout: 30 });
    });

    // Corner DOM present, panel DOM absent
    expect(document.querySelector('.pip-container')).toBeTruthy();
    expect(document.querySelector('.pip-panel')).toBeFalsy();
    expect(screen.getByTestId('camera-overlay')).toBeTruthy();
  });

  it('renders panel mode when no fullscreen overlay is active (regression)', () => {
    const getHandles = setup();

    act(() => {
      getHandles().pip.show(MockCameraOverlay, {}, { mode: 'panel', target: 'main-content', timeout: 30 });
    });

    expect(document.querySelector('.pip-panel')).toBeTruthy();
    expect(document.querySelector('.pip-container')).toBeFalsy();
    expect(screen.getByTestId('camera-overlay')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test file**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/pip/PipManager.test.jsx`

Expected: The **fallback** test FAILS (`.pip-panel` is found, `.pip-container` is not — current code renders the panel even when fullscreen is active). The **regression** test PASSES.

---

### Task 2: Implement the fullscreen fallback in PipManager.show()

**Files:**
- Modify: `frontend/src/screen-framework/pip/PipManager.jsx`

- [ ] **Step 1: Destructure `hasOverlay` from `useScreenOverlay`**

Change line 24 from:

```jsx
  const { showOverlay, dismissOverlay } = useScreenOverlay();
```

to:

```jsx
  const { showOverlay, dismissOverlay, hasOverlay } = useScreenOverlay();
```

- [ ] **Step 2: Coerce panel → corner when an overlay is active**

Inside `show`, replace lines 85–86:

```jsx
    const mode = callConfig.mode === 'panel' ? 'panel' : 'corner';
    const merged = mergeConfig(callConfig);
```

with:

```jsx
    let mode = callConfig.mode === 'panel' ? 'panel' : 'corner';
    const merged = mergeConfig(callConfig);

    // Fall back to corner when panel is requested but the slot is occluded by a fullscreen overlay.
    if (mode === 'panel' && hasOverlay) {
      logger().info('pip.panel-fallback-to-corner', {
        target: callConfig.target,
        reason: 'fullscreen-active',
        timeout: merged.timeout,
      });
      mode = 'corner';
    }
```

- [ ] **Step 3: Add `hasOverlay` to the `show` useCallback deps**

Change the deps array at the end of `show` (currently `[state, mergeConfig, startTimer]`) to:

```jsx
  }, [state, mergeConfig, startTimer, hasOverlay]);
```

- [ ] **Step 4: Re-run the tests**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/pip/PipManager.test.jsx`

Expected: BOTH tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screen-framework/pip/PipManager.jsx frontend/src/screen-framework/pip/PipManager.test.jsx
git commit -m "$(cat <<'EOF'
feat(pip): fall back to corner mode when panel slot is occluded by fullscreen

When a panel-mode subscription fires while a fullscreen overlay is active
(video player, piano, etc.), the slot is visually covered and the panel
takeover is invisible. Detect this at show() time via hasOverlay from
ScreenOverlayProvider and coerce the call to corner mode, using the
screen-level pip: config that already exists.

Missing-slot behavior (warn + no-op) is unchanged — fallback is specific
to occlusion, not absence.

Spec: docs/_wip/plans/2026-04-21-pip-reliability-fixes-design.md (Section 1)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Section 2 — HLS First-Playlist Race Dedup

### Task 3: Make `HlsStreamManager` spawn injectable (refactor-only)

**Files:**
- Modify: `backend/src/1_adapters/camera/HlsStreamManager.mjs`

- [ ] **Step 1: Rename the default spawn import**

Change line 1 from:

```js
import { spawn } from 'child_process';
```

to:

```js
import { spawn as defaultSpawn } from 'child_process';
```

- [ ] **Step 2: Accept `spawn` in the constructor and store it**

Replace the class body near line 22 (`#streams`, `#logger`) and the constructor at lines 28–30 with:

```js
  /** @type {Map<string, { proc: import('child_process').ChildProcess, dir: string, timer: NodeJS.Timeout, readyPromise: Promise<void> }>} */
  #streams = new Map();
  #logger;
  #spawn;

  /**
   * @param {{ logger?: object, spawn?: Function }} options
   */
  constructor({ logger = console, spawn = defaultSpawn } = {}) {
    this.#logger = logger;
    this.#spawn = spawn;
  }
```

- [ ] **Step 3: Use `this.#spawn` inside `ensureStream`**

Replace the `spawn(` call at line 53 with `this.#spawn(`. The rest of the arguments are unchanged:

```js
    const proc = this.#spawn('ffmpeg', [
      '-rtsp_transport', 'tcp',
      '-i', rtspUrl,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-f', 'hls',
      '-hls_time', '2',
      '-hls_list_size', '5',
      '-hls_flags', 'delete_segments+append_list',
      playlistPath
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
```

- [ ] **Step 4: Verify no regressions in existing tests**

Run: `node tests/_infrastructure/harnesses/isolated.harness.mjs --only=adapter`

Expected: All currently-passing adapter tests still pass. No new failures introduced by the refactor.

---

### Task 4: Write failing test for concurrent `ensureStream` dedup

**Files:**
- Create: `tests/isolated/adapter/camera/HlsStreamManager.test.mjs`

- [ ] **Step 1: Create the test directory and write the test**

```js
// tests/isolated/adapter/camera/HlsStreamManager.test.mjs
import { describe, test, expect, afterEach } from '@jest/globals';
import { EventEmitter } from 'events';
import os from 'os';
import path from 'path';
import { mkdir, writeFile, access, rm } from 'fs/promises';
import { HlsStreamManager } from '#adapters/camera/HlsStreamManager.mjs';

function createFakeProc() {
  const proc = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.killed = false;
  proc.kill = () => { proc.killed = true; proc.emit('exit', 0, null); };
  return proc;
}

describe('HlsStreamManager — concurrent ensureStream dedup', () => {
  afterEach(async () => {
    await rm(path.join(os.tmpdir(), 'camera'), { recursive: true, force: true });
  });

  test('every caller sees the playlist on disk at the moment ensureStream resolves', async () => {
    let spawnCount = 0;

    const fakeSpawn = (cmd, args) => {
      spawnCount++;
      const proc = createFakeProc();
      const playlistPath = args[args.length - 1];

      // Simulate ffmpeg producing the playlist after a delay
      setTimeout(async () => {
        await mkdir(path.dirname(playlistPath), { recursive: true });
        await writeFile(playlistPath, '#EXTM3U\n#EXT-X-VERSION:3\n');
      }, 200);

      return proc;
    };

    const manager = new HlsStreamManager({ spawn: fakeSpawn });

    // Each worker checks playlist existence AT THE MOMENT its ensureStream resolves —
    // not after Promise.all, which would mask the race (the slow first caller makes
    // the file exist before the combined await returns, hiding the second caller's bug).
    async function ensureAndCheckPlaylist() {
      const dir = await manager.ensureStream('test-stream', 'rtsp://fake');
      const playlistPath = path.join(dir, 'stream.m3u8');
      try {
        await access(playlistPath);
        return { dir, playlistExists: true };
      } catch {
        return { dir, playlistExists: false };
      }
    }

    const [r1, r2] = await Promise.all([ensureAndCheckPlaylist(), ensureAndCheckPlaylist()]);

    expect(spawnCount).toBe(1);
    expect(r1.dir).toBe(r2.dir);
    expect(r1.playlistExists).toBe(true);  // first caller awaited #waitForPlaylist → always sees file
    expect(r2.playlistExists).toBe(true);  // second caller — fails without the readyPromise dedup

    manager.stopAll();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `node tests/_infrastructure/harnesses/isolated.harness.mjs --only=adapter --pattern=HlsStreamManager`

Expected: FAIL. Specifically `r2.playlistExists` is `false` — the second caller hits the `existing` branch and resolves at ~0 ms, before the fake spawn's `setTimeout` writes the playlist file at ~200 ms. `r1.playlistExists` is `true` because the first caller awaits `#waitForPlaylist` and only resolves after the file is on disk.

---

### Task 5: Dedup concurrent callers via a shared `readyPromise`

**Files:**
- Modify: `backend/src/1_adapters/camera/HlsStreamManager.mjs`

- [ ] **Step 1: Store the playlist-ready promise on the entry and reuse it**

Replace `ensureStream` (lines 41–86 in the post-Task-3 file) with:

```js
  async ensureStream(streamId, rtspUrl) {
    const existing = this.#streams.get(streamId);
    if (existing) {
      this.#resetTimer(streamId);
      // Dedup: every caller (first or Nth) awaits the same playlist-ready promise
      // before the adapter resolves. This guarantees the router's subsequent
      // readFile of stream.m3u8 will not race with ffmpeg's first write.
      await existing.readyPromise;
      return existing.dir;
    }

    const dir = path.join(os.tmpdir(), 'camera', streamId);
    await mkdir(dir, { recursive: true });

    const playlistPath = path.join(dir, 'stream.m3u8');

    const proc = this.#spawn('ffmpeg', [
      '-rtsp_transport', 'tcp',
      '-i', rtspUrl,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-f', 'hls',
      '-hls_time', '2',
      '-hls_list_size', '5',
      '-hls_flags', 'delete_segments+append_list',
      playlistPath
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    proc.stderr.on('data', (chunk) => {
      this.#logger.debug?.('hls.ffmpeg.stderr', { streamId, message: chunk.toString().trim() });
    });

    proc.on('exit', (code, signal) => {
      this.#logger.debug?.('hls.ffmpeg.exit', { streamId, code, signal });
      this.#cleanup(streamId);
    });

    const readyPromise = this.#waitForPlaylist(playlistPath, PLAYLIST_TIMEOUT_MS);
    const entry = { proc, dir, timer: null, readyPromise };
    this.#streams.set(streamId, entry);
    this.#resetTimer(streamId);

    try {
      await readyPromise;
    } catch (err) {
      this.stop(streamId);
      throw err;
    }

    return dir;
  }
```

- [ ] **Step 2: Run the new test to confirm it passes**

Run: `node tests/_infrastructure/harnesses/isolated.harness.mjs --only=adapter --pattern=HlsStreamManager`

Expected: PASS. `spawnCount === 1`, both callers receive identical `dir`, and the playlist file exists on disk when each resolves.

- [ ] **Step 3: Run the full adapter suite for regressions**

Run: `node tests/_infrastructure/harnesses/isolated.harness.mjs --only=adapter`

Expected: No previously-passing tests have regressed.

- [ ] **Step 4: Commit**

```bash
git add backend/src/1_adapters/camera/HlsStreamManager.mjs tests/isolated/adapter/camera/HlsStreamManager.test.mjs
git commit -m "$(cat <<'EOF'
fix(camera/hls): dedup concurrent ensureStream calls on first playlist

When multiple screens subscribed to the same doorbell broadcast, their
GET /api/v1/camera/:id/live/stream.m3u8 requests race: the first caller
spawns ffmpeg and awaits waitForPlaylist; the second caller hits the
existing-entry branch and returns dir before ffmpeg has written the
.m3u8. The router's readFile then throws ENOENT, the route returns 502,
and hls.js on strict clients (Linux/Chromium) treats manifestLoadError
as fatal and gives up — the user sees only the snapshot warmup.

Store the playlist-ready promise on the entry and await it on every
path. After ensureStream resolves, the playlist is guaranteed to exist.

Also make spawn injectable via the constructor so concurrent behavior
is unit-testable without actually spawning ffmpeg.

Spec: docs/_wip/plans/2026-04-21-pip-reliability-fixes-design.md (Section 2)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Section 3 — Build, Deploy, Verify

### Task 6: Build the Docker image

- [ ] **Step 1: Build**

Run:

```bash
sudo docker build -f docker/Dockerfile \
  -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" \
  .
```

Expected: Build succeeds. Last lines include `naming to docker.io/kckern/daylight-station:latest`.

---

### Task 7: Redeploy the container

- [ ] **Step 1: Stop & remove the current container**

```bash
sudo docker stop daylight-station && sudo docker rm daylight-station
```

- [ ] **Step 2: Deploy the new image**

```bash
sudo deploy-daylight
```

- [ ] **Step 3: Verify the container is up**

```bash
sleep 3 && curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3111/ && sudo docker exec daylight-station cat /build.txt
```

Expected: `HTTP 200` plus the new `Commit:` line matching `git rev-parse --short HEAD`.

---

### Task 8: End-to-end verification — doorbell ring

- [ ] **Step 1: Baseline ring (no fullscreen active) → panel mode, both clients see live video**

While the office screen is showing its default dashboard and the Shield TV is on its default screen, fire the webhook:

```bash
curl -sS -X POST http://localhost:3111/api/v1/camera/doorbell/event \
  -H "Content-Type: application/json" -d '{"event":"ring"}'
```

Expected — backend logs (tail `sudo docker logs -f daylight-station`):
- `hls.ffmpeg.spawn` (or equivalent start line for ffmpeg) fires once
- No `camera.live.playlistError` entries
- Two successful m3u8 request completions (one per subscribing screen)

Expected — visual:
- Office: main-content slot takes over with camera; after HLS ready, live video plays
- Shield TV: corner pip fades in with live video (Shield only subscribes to corner mode on its screen config)

- [ ] **Step 2: Occluded ring (fullscreen active) → corner fallback**

With the office screen fullscreen-active (start a video via the menu, or let the piano go fullscreen), fire the webhook again:

```bash
curl -sS -X POST http://localhost:3111/api/v1/camera/doorbell/event \
  -H "Content-Type: application/json" -d '{"event":"ring"}'
```

Expected — office client console logs (accessible via DevTools on the office TV, or mirrored through the WS log transport):
- `subscription.show-panel` (topic=doorbell, target=main-content) — from useScreenSubscriptions
- `pip.panel-fallback-to-corner` (target=main-content, reason=fullscreen-active, timeout=30) — NEW
- `pip.show` (mode=corner, position=bottom-right, size=25, timeout=30)
- `cameraOverlay.direct` (cameraId=doorbell)
- `hls.start` → `hls.playing`

Expected — visual:
- Bottom-right corner of office screen: camera pip slides in above the fullscreen overlay, plays live video for 30s, slides out

- [ ] **Step 3: Dismiss fullscreen while corner pip is still up (option A behavior)**

While the corner pip is still visible from Step 2, dismiss the fullscreen overlay (escape / back button).

Expected:
- Corner pip remains in the corner until its own 30s timeout — no re-animation to panel mode
- Main-content widgets reappear underneath (or alongside) the corner pip, since the slot was never claimed

---

## Self-Review Notes

- Spec Section 1 (`hasOverlay` detection + corner coercion + log event) → covered by Tasks 1–2.
- Spec Section 1 (missing-slot behavior unchanged) → implicitly covered: Task 2 Step 2 does not touch the `!slotNode` branch.
- Spec Section 1 (option A: corner stays in corner when fullscreen dismisses) → covered by Task 8 Step 3 in validation; no code change needed because corner lifecycle is independent of overlay state.
- Spec Section 2 (readyPromise on entry, dedup in existing branch) → covered by Tasks 3–5.
- Spec Section 2 (postcondition: playlist exists when ensureStream resolves) → directly asserted by Task 4 Step 1's `access(stream.m3u8)` check.
- Spec Section 2 (no router changes, no frontend changes) → confirmed: only HlsStreamManager.mjs is modified.
- Types/names consistent: `readyPromise` used identically in spec, test, implementation. `hasOverlay` matches the existing `ScreenOverlayContext` export.
