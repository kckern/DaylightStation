# Music Player — Eliminate Silent Failure Paths

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the "Loading… / Music unavailable" stuck-state UI with explicit, surface-specific error reporting from queue init and media element, plus client-side timeouts — so that any future music-player failure produces an actionable error message and a structured log event instead of an indefinite spinner.

**Architecture:** Add an `onError({ kind, ...details })` callback that flows `FitnessMusicPlayer` → `<Player>` → `useQueueController`, plus a media-element `error` listener inside `<Player>`. Wrap the queue-init `DaylightAPI` call and the audio element's `canplay` event in client-side timeouts. Display specific, kind-aware messages in the music player; treat the legacy 15 s stuck detector as a last-resort bug indicator that emits a dedicated log event.

**Tech Stack:** React, vitest, @testing-library/react, structured logging via `frontend/src/lib/logging/Logger.js`.

**Reference docs (read first):**
- The bug this fixes: `docs/_wip/bugs/2026-05-23-music-player-loading-and-unavailable-states-are-bugs.md`
- Prior attempts: `docs/_wip/bugs/2026-02-03-fitness-music-player-not-playable.md`, `docs/_wip/bugs/2026-05-01-fitness-music-player-loading-forever.md`
- Component reference: `docs/reference/fitness/fitness-music-player.md`
- Logging framework: `CLAUDE.md` § Logging

**Scope discipline (YAGNI):**
- DO propagate errors and add timeouts. DO NOT refactor `Player.jsx` resilience loop.
- DO NOT try to fix the upstream Plex/queue API issue — we don't know what it is yet; that's exactly why we need this diagnostic plumbing.
- DO NOT add retry-with-fallback strategies in this plan. A manual retry button is enough; automatic retry strategies wait for evidence.

---

## Pre-flight

Before starting, verify the dev environment is healthy and tests pass at baseline.

**Step 1: Confirm dev server is or can be running**

Run: `lsof -i :3111`

Expected: either a vite process is listed (reuse existing), or nothing (you'll need `npm run dev` later). Either is fine — Playwright will start it if needed.

**Step 2: Run the existing useQueueController unit tests to confirm baseline green**

Run: `npx vitest run frontend/src/modules/Player/hooks/useQueueController.test.js`

Expected: all tests pass. If they don't, stop and report — the plan assumes a green baseline.

**Step 3: Create a feature branch (or work in a worktree)**

Run: `git checkout -b fix/music-player-silent-failures`

Expected: branch created from main.

---

## Phase 1 — Surface queue-init errors via callback

The catch block in `useQueueController.initQueue()` currently logs and silently restores state. Add an `onError` callback so callers can react.

### Task 1: Add `onError` contract — test the API rejection path

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useQueueController.js` (around line 222 `.catch` handler)
- Test: `frontend/src/modules/Player/hooks/useQueueController.test.js` (append a new `describe` block)

**Step 1: Write the failing test**

Append to `frontend/src/modules/Player/hooks/useQueueController.test.js`:

```js
describe('useQueueController error propagation', () => {
  it('calls onError with kind=fetch-failed when the queue API rejects', async () => {
    const { DaylightAPI } = await import('../../../lib/api.mjs');
    DaylightAPI.mockRejectedValueOnce(new Error('HTTP 502: Bad Gateway - {"error":"upstream"}'));
    const onError = vi.fn();
    renderHook(() =>
      useQueueController({
        play: null,
        queue: { plex: 12345, shuffle: true },
        contentRef: 'plex:12345',
        clear: vi.fn(),
        onError,
      })
    );
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    const call = onError.mock.calls[0][0];
    expect(call.kind).toBe('fetch-failed');
    expect(call.httpStatus).toBe('502');
    expect(call.contentRef).toBe('plex:12345');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Player/hooks/useQueueController.test.js -t "fetch-failed"`

Expected: FAIL — `onError` is never called because the hook does not yet accept or invoke it.

**Step 3: Implement — accept `onError` in hook options, invoke from `.catch`**

In `useQueueController.js`:

1. Destructure `onError` from the hook's argument object near the top of the hook.
2. In the existing `.catch` handler (around line 222), after the `playbackLog('queue-init-failed', ...)` call, add:

```js
if (typeof onError === 'function' && !isCancelled) {
  onError({
    kind: 'fetch-failed',
    contentRef,
    message: error?.message,
    httpStatus: error?.message?.match(/^HTTP (\d+)/)?.[1] || null,
    apiDetail: apiError?.error || null,
  });
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Player/hooks/useQueueController.test.js -t "fetch-failed"`

Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/modules/Player/hooks/useQueueController.js \
        frontend/src/modules/Player/hooks/useQueueController.test.js
git commit -m "feat(player): surface queue API fetch failures via onError callback"
```

---

### Task 2: Surface empty-queue case

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useQueueController.js` (around line 204-212)
- Test: `frontend/src/modules/Player/hooks/useQueueController.test.js`

**Step 1: Write the failing test**

Append inside the existing error-propagation `describe`:

```js
it('calls onError with kind=empty-queue when API returns items:[]', async () => {
  const { DaylightAPI } = await import('../../../lib/api.mjs');
  DaylightAPI.mockResolvedValueOnce({ items: [], audio: null });
  const onError = vi.fn();
  renderHook(() =>
    useQueueController({
      play: null,
      queue: { plex: 99, shuffle: true },
      contentRef: 'plex:99',
      clear: vi.fn(),
      onError,
    })
  );
  await vi.waitFor(() => expect(onError).toHaveBeenCalled());
  expect(onError.mock.calls[0][0]).toMatchObject({ kind: 'empty-queue', contentRef: 'plex:99' });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Player/hooks/useQueueController.test.js -t "empty-queue"`

Expected: FAIL — no empty-queue branch yet calls onError.

**Step 3: Implement**

In `useQueueController.js`, inside `initQueue()`, after the existing valid-queue filter (line 183) and before the `setQueue(validQueue)` block, add:

```js
if (validQueue.length === 0 && newQueue.length === 0 && contentRef) {
  playbackLog('queue-init-empty', { contentRef }, { level: 'warn' });
  if (typeof onError === 'function' && !isCancelled) {
    onError({ kind: 'empty-queue', contentRef });
  }
  if (!isCancelled && clear) clear();
  return;
}
```

Place this BEFORE the existing `newQueue.length > 0 && validQueue.length === 0` invalid check so empty and invalid cases stay distinguishable.

**Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Player/hooks/useQueueController.test.js -t "empty-queue"`

Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/modules/Player/hooks/useQueueController.js \
        frontend/src/modules/Player/hooks/useQueueController.test.js
git commit -m "feat(player): surface empty-queue API responses via onError"
```

---

### Task 3: Surface invalid-queue case

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useQueueController.js` (around line 204-212, the existing `queue-init-invalid` block)
- Test: `frontend/src/modules/Player/hooks/useQueueController.test.js`

**Step 1: Write the failing test**

Append inside the error-propagation `describe`:

```js
it('calls onError with kind=invalid-queue when items exist but all fail validation', async () => {
  const { DaylightAPI } = await import('../../../lib/api.mjs');
  // Items with no usable identifying fields → all rejected by validQueue filter
  DaylightAPI.mockResolvedValueOnce({ items: [{ junk: true }, { other: 1 }], audio: null });
  const onError = vi.fn();
  renderHook(() =>
    useQueueController({
      play: null,
      queue: { plex: 7, shuffle: true },
      contentRef: 'plex:7',
      clear: vi.fn(),
      onError,
    })
  );
  await vi.waitFor(() => expect(onError).toHaveBeenCalled());
  expect(onError.mock.calls[0][0]).toMatchObject({ kind: 'invalid-queue', contentRef: 'plex:7' });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Player/hooks/useQueueController.test.js -t "invalid-queue"`

Expected: FAIL.

**Step 3: Implement**

In the existing `newQueue.length > 0 && validQueue.length === 0` block (line 204-212 area), add the onError call alongside the existing log:

```js
if (newQueue.length > 0 && validQueue.length === 0) {
  playbackLog('queue-init-invalid', {
    contentRef,
    itemCount: newQueue.length,
    sampleKeys: Object.keys(newQueue[0] || {}).slice(0, 5),
  }, { level: 'error' });
  if (typeof onError === 'function' && !isCancelled) {
    onError({
      kind: 'invalid-queue',
      contentRef,
      itemCount: newQueue.length,
    });
  }
  if (!isCancelled && clear) clear();
  return;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Player/hooks/useQueueController.test.js -t "invalid-queue"`

Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/modules/Player/hooks/useQueueController.js \
        frontend/src/modules/Player/hooks/useQueueController.test.js
git commit -m "feat(player): surface invalid-queue API responses via onError"
```

---

### Task 4: Add queue API timeout

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useQueueController.js` (around line 144 `DaylightAPI` call)
- Test: `frontend/src/modules/Player/hooks/useQueueController.test.js`

**Step 1: Write the failing test**

Append:

```js
it('calls onError with kind=fetch-timeout when queue API does not resolve within threshold', async () => {
  vi.useFakeTimers();
  const { DaylightAPI } = await import('../../../lib/api.mjs');
  // Never resolves
  DaylightAPI.mockReturnValueOnce(new Promise(() => {}));
  const onError = vi.fn();
  renderHook(() =>
    useQueueController({
      play: null,
      queue: { plex: 5, shuffle: true },
      contentRef: 'plex:5',
      clear: vi.fn(),
      onError,
      queueFetchTimeoutMs: 10_000,
    })
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_001);
  });
  expect(onError).toHaveBeenCalled();
  expect(onError.mock.calls[0][0]).toMatchObject({ kind: 'fetch-timeout', contentRef: 'plex:5', timeoutMs: 10_000 });
  vi.useRealTimers();
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Player/hooks/useQueueController.test.js -t "fetch-timeout"`

Expected: FAIL.

**Step 3: Implement timeout wrapper**

At the top of `useQueueController.js` (after imports), add:

```js
function withTimeout(promise, timeoutMs, kind, ctx) {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`TIMEOUT ${kind} after ${timeoutMs}ms`);
      err.isTimeout = true;
      err.kind = kind;
      err.timeoutMs = timeoutMs;
      err.ctx = ctx;
      reject(err);
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
```

In the hook signature, destructure `queueFetchTimeoutMs` (default `null` for no change in existing call sites that don't want timeouts) from the options.

Wrap the queue `DaylightAPI` call (line 144):

```js
const response = await withTimeout(
  DaylightAPI(`api/v1/queue/${contentRef}${shuffleParam}`),
  queueFetchTimeoutMs,
  'fetch-timeout',
  { contentRef }
);
```

In the existing `.catch` handler, branch on `error.isTimeout`:

```js
if (error?.isTimeout) {
  playbackLog('queue-init-timeout', { contentRef, timeoutMs: error.timeoutMs }, { level: 'error' });
  if (typeof onError === 'function' && !isCancelled) {
    onError({ kind: 'fetch-timeout', contentRef, timeoutMs: error.timeoutMs });
  }
  return;
}
```

Keep the existing fetch-failed branch for non-timeout errors.

**Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Player/hooks/useQueueController.test.js -t "fetch-timeout"`

Expected: PASS.

**Step 5: Run the full test file to confirm no regression**

Run: `npx vitest run frontend/src/modules/Player/hooks/useQueueController.test.js`

Expected: all tests pass (existing + 4 new).

**Step 6: Commit**

```bash
git add frontend/src/modules/Player/hooks/useQueueController.js \
        frontend/src/modules/Player/hooks/useQueueController.test.js
git commit -m "feat(player): client-side timeout on queue API with kind=fetch-timeout"
```

---

## Phase 2 — Surface media element errors from Player

`Player.jsx` owns the media element. Currently media `error` events vanish into resilience logic. Surface them via the same `onError` channel.

### Task 5: Forward `onError` prop through Player to useQueueController

**Files:**
- Modify: `frontend/src/modules/Player/Player.jsx` (props destructure + useQueueController call site)

**Step 1: Identify the props destructure and useQueueController call**

Read `frontend/src/modules/Player/Player.jsx` and locate (use grep):
- The `Player` component's destructured props (top of function)
- The `useQueueController({...})` invocation

Run: `grep -n "useQueueController\|forwardRef\|function Player\|const Player" frontend/src/modules/Player/Player.jsx | head -10`

**Step 2: Add `onError` to the destructured props**

Add `onError` to the destructured prop list. If the component uses a sole `props` parameter, add `const { onError } = props;`.

**Step 3: Pass `onError` and a default timeout into useQueueController**

In the `useQueueController({...})` call, add:

```js
onError,
queueFetchTimeoutMs: 10_000,
```

**Step 4: Sanity check — run the existing Player tests if any**

Run: `npx vitest run frontend/src/modules/Player/ --testPathPattern test`

If there is no Player.test.js, that's fine — proceed.

**Step 5: Commit**

```bash
git add frontend/src/modules/Player/Player.jsx
git commit -m "feat(player): forward onError prop and default 10s queue timeout"
```

---

### Task 6: Surface media element `error` event via onError

**Files:**
- Modify: `frontend/src/modules/Player/Player.jsx` (find the `<audio>` / `<video>` element render or the ref attachment point)
- Test: create `frontend/src/modules/Player/Player.mediaError.test.jsx`

**Step 1: Write the failing test**

Create `frontend/src/modules/Player/Player.mediaError.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import Player from './Player.jsx';

vi.mock('../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn().mockResolvedValue({ items: [{ contentId: 'plex:1', plex: 1, title: 'X' }], audio: null }),
}));

describe('Player media error propagation', () => {
  it('calls onError with kind=media-error when the media element emits an error event', async () => {
    const onError = vi.fn();
    const { container } = render(
      <Player
        playerType="audio"
        queue={{ plex: 1, shuffle: false }}
        play={{ volume: 0.5 }}
        onError={onError}
      />
    );
    // Wait for the audio element to mount
    await vi.waitFor(() => {
      const el = container.querySelector('audio, video');
      expect(el).toBeTruthy();
    });
    const el = container.querySelector('audio, video');
    // Simulate a media error
    Object.defineProperty(el, 'error', { value: { code: 4, message: 'MEDIA_ERR_SRC_NOT_SUPPORTED' }, configurable: true });
    await act(async () => { el.dispatchEvent(new Event('error')); });
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    const call = onError.mock.calls.find((c) => c[0]?.kind === 'media-error');
    expect(call).toBeTruthy();
    expect(call[0]).toMatchObject({ kind: 'media-error', code: 4 });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Player/Player.mediaError.test.jsx`

Expected: FAIL — `onError` is not called for media errors yet.

**Step 3: Implement**

In `Player.jsx`, find where the media element's events are attached. Look for existing handlers via:

Run: `grep -n "addEventListener\|onError\|onEnded\|onCanPlay" frontend/src/modules/Player/Player.jsx | head -20`

Add a `useEffect` near the existing media-element-related effects (or extend one) that attaches an `error` listener:

```js
useEffect(() => {
  const el = mediaElementRef.current; // adjust to actual ref name
  if (!el || typeof onError !== 'function') return undefined;
  const handleMediaError = () => {
    onError({
      kind: 'media-error',
      code: el.error?.code ?? null,
      message: el.error?.message ?? 'media element error',
      networkState: el.networkState,
      readyState: el.readyState,
      src: el.currentSrc || null,
    });
  };
  el.addEventListener('error', handleMediaError);
  return () => el.removeEventListener('error', handleMediaError);
}, [onError]);
```

Use whatever the actual media element ref is — `videoElementRef`, `mediaRef`, etc. Determine via grep.

**Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Player/Player.mediaError.test.jsx`

Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/modules/Player/Player.jsx \
        frontend/src/modules/Player/Player.mediaError.test.jsx
git commit -m "feat(player): surface media element error events via onError"
```

---

### Task 7: Add canplay timeout in Player

**Files:**
- Modify: `frontend/src/modules/Player/Player.jsx`
- Test: extend `frontend/src/modules/Player/Player.mediaError.test.jsx`

**Step 1: Write the failing test**

Append to `Player.mediaError.test.jsx`:

```jsx
it('calls onError with kind=media-load-timeout when canplay does not fire within threshold', async () => {
  vi.useFakeTimers();
  const onError = vi.fn();
  render(
    <Player
      playerType="audio"
      queue={{ plex: 1, shuffle: false }}
      play={{ volume: 0.5 }}
      onError={onError}
      mediaLoadTimeoutMs={15_000}
    />
  );
  await act(async () => { await vi.advanceTimersByTimeAsync(15_001); });
  const call = onError.mock.calls.find((c) => c[0]?.kind === 'media-load-timeout');
  expect(call).toBeTruthy();
  vi.useRealTimers();
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Player/Player.mediaError.test.jsx -t "media-load-timeout"`

Expected: FAIL.

**Step 3: Implement**

In `Player.jsx`, destructure `mediaLoadTimeoutMs` from props (default `null`). Add a `useEffect` keyed on the current queue item's identifier that:

1. If `mediaLoadTimeoutMs` is truthy and the media element exists, starts a timer.
2. On `canplay` (or `playing`) event from the media element, clears the timer.
3. On timeout, calls `onError({ kind: 'media-load-timeout', timeoutMs })` and clears.

Implementation sketch (place near existing media-element effects):

```js
useEffect(() => {
  const el = mediaElementRef.current;
  if (!el || !mediaLoadTimeoutMs || typeof onError !== 'function') return undefined;
  let fired = false;
  const clearAll = () => {
    clearTimeout(timer);
    el.removeEventListener('canplay', clear);
    el.removeEventListener('playing', clear);
  };
  const clear = () => { fired = true; clearAll(); };
  const timer = setTimeout(() => {
    if (fired) return;
    onError({
      kind: 'media-load-timeout',
      timeoutMs: mediaLoadTimeoutMs,
      networkState: el.networkState,
      readyState: el.readyState,
      src: el.currentSrc || null,
    });
    clearAll();
  }, mediaLoadTimeoutMs);
  el.addEventListener('canplay', clear);
  el.addEventListener('playing', clear);
  return clearAll;
}, [onError, mediaLoadTimeoutMs, /* currentTrackKey or equivalent */]);
```

The key dependency must change when a new track loads so the timer re-arms per track.

**Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Player/Player.mediaError.test.jsx`

Expected: both tests pass.

**Step 5: Commit**

```bash
git add frontend/src/modules/Player/Player.jsx \
        frontend/src/modules/Player/Player.mediaError.test.jsx
git commit -m "feat(player): canplay timeout surfaces media-load-timeout via onError"
```

---

## Phase 3 — Replace stuck-loading UI with explicit error states in FitnessMusicPlayer

### Task 8: Add `playerError` state and wire `onError` prop

**Files:**
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessMusicPlayer.jsx`

**Step 1: Add state, prop wiring, and reset logic**

In `FitnessMusicPlayer.jsx`:

1. After the existing `useState` declarations near the top of the component, add:

```js
const [playerError, setPlayerError] = useState(null);
```

2. Just before `playerQueueProp` (around line 199), add a stable error handler:

```js
const handlePlayerError = useCallback((err) => {
  setPlayerError(err);
  getLogger().warn('fitness.music.player_error', {
    kind: err?.kind,
    contentRef: err?.contentRef,
    httpStatus: err?.httpStatus,
    timeoutMs: err?.timeoutMs,
    code: err?.code,
    playlistId: selectedPlaylistId || null,
  });
}, [selectedPlaylistId]);
```

3. Add a useEffect that clears `playerError` whenever the selected playlist changes (a new playlist deserves a fresh chance), placed near the existing playlist-change effect:

```js
useEffect(() => { setPlayerError(null); }, [selectedPlaylistId]);
```

4. In the `<Player>` JSX (around line 687), pass:

```jsx
onError={handlePlayerError}
mediaLoadTimeoutMs={15_000}
```

5. Add `useCallback` to the existing React import if not already present.

**Step 2: Commit (no test yet — UI test in next task)**

```bash
git add frontend/src/modules/Fitness/player/panels/FitnessMusicPlayer.jsx
git commit -m "feat(fitness): add playerError state and wire onError to Player"
```

---

### Task 9: Render kind-specific error messages — TDD

**Files:**
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessMusicPlayer.jsx` (the title-area JSX, around line 563-577)
- Test: create `frontend/src/modules/Fitness/player/panels/FitnessMusicPlayer.errorUI.test.jsx`

**Step 1: Write the failing test**

Create the test file:

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import FitnessMusicPlayer from './FitnessMusicPlayer.jsx';

// Minimal context mock — adjust based on actual FitnessContext shape if needed.
vi.mock('@/context/FitnessContext.jsx', () => ({
  useFitnessContext: () => ({
    videoPlayerPaused: false,
    voiceMemoOverlayState: { open: false },
    plexConfig: { music_playlists: [{ id: 'pl-1', name: 'Test' }] },
    setSelectedPlaylistId: vi.fn(),
    setMusicOverride: vi.fn(),
    musicEnabled: true,
    fitnessSessionInstance: null,
  }),
}));

// Mock Player — capture the onError prop so the test can drive errors.
let capturedOnError = null;
vi.mock('@/modules/Player/Player.jsx', () => ({
  default: React.forwardRef(({ onError }, ref) => {
    capturedOnError = onError;
    return <div data-testid="mock-player" />;
  }),
}));

function renderWith(props = {}) {
  return render(
    <FitnessMusicPlayer
      selectedPlaylistId="pl-1"
      videoPlayerRef={{ current: null }}
      videoVolume={{ volume: 0.5, setVolume: vi.fn(), applyToPlayer: vi.fn() }}
      {...props}
    />
  );
}

describe('FitnessMusicPlayer error UI', () => {
  it('shows HTTP status when queue fetch fails with kind=fetch-failed', async () => {
    renderWith();
    await act(async () => {
      capturedOnError({ kind: 'fetch-failed', httpStatus: '502', contentRef: 'plex:1' });
    });
    expect(screen.getByText(/Music API error.*502/i)).toBeInTheDocument();
  });

  it('shows "Playlist empty" when kind=empty-queue', async () => {
    renderWith();
    await act(async () => {
      capturedOnError({ kind: 'empty-queue', contentRef: 'plex:1' });
    });
    expect(screen.getByText(/Playlist empty/i)).toBeInTheDocument();
  });

  it('shows "Music load timed out" when kind=fetch-timeout', async () => {
    renderWith();
    await act(async () => {
      capturedOnError({ kind: 'fetch-timeout', timeoutMs: 10000 });
    });
    expect(screen.getByText(/timed out/i)).toBeInTheDocument();
  });

  it('shows media error message when kind=media-error', async () => {
    renderWith();
    await act(async () => {
      capturedOnError({ kind: 'media-error', code: 4, message: 'MEDIA_ERR_SRC_NOT_SUPPORTED' });
    });
    expect(screen.getByText(/Media error/i)).toBeInTheDocument();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run frontend/src/modules/Fitness/player/panels/FitnessMusicPlayer.errorUI.test.jsx`

Expected: FAIL — error UI not yet rendered.

**Step 3: Implement the error UI**

In `FitnessMusicPlayer.jsx`, define a helper above the return statement:

```js
const renderErrorMessage = (err, retry) => {
  if (!err) return null;
  const text = (() => {
    switch (err.kind) {
      case 'fetch-failed':       return `Music API error${err.httpStatus ? ` (HTTP ${err.httpStatus})` : ''}`;
      case 'fetch-timeout':      return `Music load timed out`;
      case 'empty-queue':        return `Playlist empty`;
      case 'invalid-queue':      return `Playlist contains no playable items`;
      case 'media-error':        return `Media error${err.code != null ? ` (code ${err.code})` : ''}`;
      case 'media-load-timeout': return `Music load timed out`;
      default:                   return `Music unavailable`;
    }
  })();
  return (
    <span
      className="music-player-retry"
      role="button"
      tabIndex={0}
      onPointerDown={(e) => { e.stopPropagation(); retry(); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); retry(); } }}
    >
      {text} — tap to retry
    </span>
  );
};
```

Add a retry function that clears the error and bumps the stuck attempt counter (to remount Player):

```js
const handleRetry = useCallback(() => {
  setPlayerError(null);
  stuck.retry(); // existing — bumps attempt and re-keys Player
}, [stuck]);
```

Replace the existing title-area placeholder (around line 563-577) with:

```jsx
{currentTrack?.title || currentTrack?.label || (
  playerError
    ? renderErrorMessage(playerError, handleRetry)
    : (stuck.isStuck
        ? renderErrorMessage({ kind: 'unknown' }, handleRetry)
        : 'Loading…')
)}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run frontend/src/modules/Fitness/player/panels/FitnessMusicPlayer.errorUI.test.jsx`

Expected: all 4 tests pass.

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/panels/FitnessMusicPlayer.jsx \
        frontend/src/modules/Fitness/player/panels/FitnessMusicPlayer.errorUI.test.jsx
git commit -m "feat(fitness): render kind-specific music error messages with retry"
```

---

### Task 10: Treat stuck-loading as a bug indicator (silent failure)

The 15 s stuck detector still exists as a safety net. After this plan, if it ever fires WITHOUT a matching `playerError`, we missed an upstream surface — log it loudly so we know.

**Files:**
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessMusicPlayer.jsx` (the existing `stuckLoggedRef` effect around line 78-92)

**Step 1: Strengthen the log payload**

Replace the existing stuck-logging effect with:

```js
const stuckLoggedRef = useRef(false);
useEffect(() => {
  if (!stuck.isStuck) {
    stuckLoggedRef.current = false;
    return;
  }
  if (stuckLoggedRef.current) return;
  stuckLoggedRef.current = true;
  const hasExplicitError = Boolean(playerError);
  getLogger().warn('fitness.music.stuck_loading', {
    playlistId: selectedPlaylistId || null,
    attempt: stuck.attempt,
    thresholdMs: 15_000,
    musicEnabled: Boolean(musicEnabled),
    hasExplicitError,
    // If hasExplicitError is FALSE, we hit the stuck timer without any
    // upstream onError firing — that means a silent failure path still exists
    // and we need to instrument the next surface upstream of this hook.
    silentFailure: !hasExplicitError,
  });
}, [stuck.isStuck, stuck.attempt, selectedPlaylistId, musicEnabled, playerError]);
```

**Step 2: No new test (this is a log payload tweak)** — but verify the existing FitnessMusicPlayer tests still pass

Run: `npx vitest run frontend/src/modules/Fitness/player/panels/`

Expected: all tests in the directory pass.

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/player/panels/FitnessMusicPlayer.jsx
git commit -m "feat(fitness): flag stuck_loading without explicit error as silent-failure"
```

---

## Phase 4 — Verification

### Task 11: Run full unit test suite

Run: `npx vitest run frontend/src/modules/Player/ frontend/src/modules/Fitness/player/panels/`

Expected: all tests pass.

If any test fails, stop and investigate — do not commit further.

### Task 12: Manual verification in dev

**Step 1: Start dev server if not running**

Run: `lsof -i :3111` — if nothing, run `npm run dev` (will tee to `dev.log`).

**Step 2: Open the Fitness app in browser**

Navigate to the fitness route (check `frontend/src/Apps/` and recent commits for the path).

**Step 3: Trigger and observe each failure surface**

In browser DevTools console:

```js
window.DAYLIGHT_LOG_LEVEL = 'debug';
```

For each scenario, confirm the UI shows the expected message and the structured log fires:

| Scenario | How to trigger | Expected UI |
|----------|---------------|-------------|
| Happy path | Select a known-good playlist | Track loads in ≤ 2 s, no error UI |
| Fetch failure | Use DevTools Network "block request URL" on `/api/v1/queue/plex:*` | "Music API error" appears within ~1 s |
| Fetch timeout | Block requests with throttling so request hangs | "Music load timed out" after 10 s |
| Media error | Block `/api/v1/play/plex/...` | "Media error" within seconds of queue success |

**Step 4: Confirm logs**

In the console or via `dev.log`, look for `fitness.music.player_error` events with the right `kind`. Confirm `fitness.music.stuck_loading` does NOT fire (since explicit errors are reaching the user well before 15 s).

### Task 13: Update component reference doc

**Files:**
- Modify: `docs/reference/fitness/fitness-music-player.md`

Update the **"Stuck-loading detector"** subsection to reflect:
- The detector is now a backstop, not the primary error UI.
- Primary errors are surfaced via the new `onError` channel.
- A `silent_failure` log indicates instrumentation gap.

Update the **"Component API"** section to mention the new error UI states.

Also update **`docs/_wip/bugs/2026-05-23-music-player-loading-and-unavailable-states-are-bugs.md`** with a "Resolution" section linking to this plan.

**Step 1: Commit doc updates**

```bash
git add docs/reference/fitness/fitness-music-player.md \
        docs/_wip/bugs/2026-05-23-music-player-loading-and-unavailable-states-are-bugs.md
git commit -m "docs: update music-player reference for explicit error surfacing"
```

### Task 14: Final review

**Step 1: Diff review**

Run: `git diff main...HEAD --stat`

Expected: roughly these files modified —
- `frontend/src/modules/Player/hooks/useQueueController.js` + test
- `frontend/src/modules/Player/Player.jsx` + new test
- `frontend/src/modules/Fitness/player/panels/FitnessMusicPlayer.jsx` + new test
- 2 docs

**Step 2: Confirm no out-of-scope changes**

Re-read the diff. If you touched `useMediaResilience`, `usePlaybackHealth`, or the `<Player>` resilience loop — back those out. The plan is **scoped to error propagation and timeouts**, not resilience.

**Step 3: Hand back to user for review and merge**

Per `CLAUDE.md`: do NOT commit-and-push automatically, and do NOT run `deploy.sh`. Report what's done and let the user merge.

---

## Success criteria (from the bug report)

After this plan, these must all hold:

- [ ] `Loading…` visible only during the actual queue+media load round-trip (≤ ~2 s on a healthy environment)
- [ ] Real API failures surface as specific UI errors within ≤ 5 s
- [ ] No silent empty-queue / invalid-queue / fetch-rejected path in `useQueueController`
- [ ] No silent media-element-error path in `Player.jsx`
- [ ] If `fitness.music.stuck_loading` ever fires, a paired `fitness.music.player_error` event in the same time window names the actual upstream failure
- [ ] If `stuck_loading` fires with `silentFailure: true`, that is treated as a bug indicator for a missed instrumentation point

## Out of scope (deliberately)

- Fixing the underlying upstream Plex / queue API issue. We don't know what it is. This plan installs the diagnostic plumbing that will let us identify it on the next occurrence.
- Refactoring `Player.jsx` resilience loop.
- Auto-retry strategies (manual retry is enough until we have evidence).
- Removing the `useStuckLoadingDetector` hook entirely — kept as a backstop. Reconsider after a week of production data shows it never fires under healthy API.
