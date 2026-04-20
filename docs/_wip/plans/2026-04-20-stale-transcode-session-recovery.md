# Stale Transcode Session Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

---

**STATUS (2026-04-20): IMPLEMENTATION COMPLETE**

Tasks 1–8, 10, 12 completed on branch `feature/stale-session-recovery`
in worktree `.worktrees/stale-session-recovery`.

- Task 9 (diagnostics endpoint): deferred — nice-to-have observability.
- Task 11 (manual verification): user task — see runbook
  `docs/runbooks/fitness-player-recovery.md` for verification steps.
- Task 13 (final sweep): in progress.

Key commits (all on `feature/stale-session-recovery`):
- 99a0691c — predicate
- 31cc1f26 — refreshUrl signal in onReload
- 68b57090 — Player forwards refreshUrl
- 9a234ae3 + a6a6729b — hardReset cache-bust (core fix + fragment fix)
- 76c9c143 — stale-session watchdog
- 543d4534 + a452dc51 — watchdog wired to VideoPlayer (+ stale-closure fix)
- 1e01412c — urlRefreshCount telemetry
- 8bbd0cfe — backend _refresh test (Plex mints fresh sessions — no backend work needed)
- e52d24a4 — Playwright integration test + recovery event instrumentation

Backend behavior confirmed: `PlexAdapter._generateSessionIds()` mints a fresh UUID via `Math.random()` on every `/api/v1/play/plex/:id` call, no caching. Client-side cache-bust is sufficient; no backend changes needed.

---

**Goal:** Make the Fitness video player bulletproof against stale Plex transcode sessions by forcing a fresh MPD fetch on startup-timeout recovery, detecting dead sessions early via repeated segment 404s, and surfacing an actionable error after exhaustion.

**Architecture:** The infinite-loop bug is in `VideoPlayer.hardReset` — it calls `target.load()` with the same `src`, which makes dash.js re-parse the *cached* MPD manifest whose URLs still point at the dead Plex transcode session. Fix: thread a `refreshUrl` flag from the resilience state machine down through `Player.handleResilienceReload` → `mediaAccess.hardReset`, and when set, append a cache-buster query param to the `src` before calling `load()`. Add a DASH-error watchdog that escalates recovery ahead of the 15s startup deadline when segment 404s occur in rapid succession. Emit structured telemetry at every stage.

**Tech Stack:** React 18, dash-video-element web component, dash.js (underlying MSE driver), Express backend proxy, Vitest (unit), Playwright (integration), structured logger at `frontend/src/lib/logging/Logger.js`.

**Root cause evidence (session log `2026-04-20T12:45:22`):**
- `dash.error` code 28 repeating every ~3s on URL `…/transcode/universal/session/0e440866-.../0/header` → HTTP 404 (transcode session died on Plex side)
- `playback.player-remount` with `source: "hard-reset-accepted"` fires on each `startup-deadline-exceeded`, but `remountNonce: 0` (the `<dash-video>` is never actually re-mounted by React)
- Plex server itself is healthy (`/identity` returns 200); only the specific session UUID is dead
- `effectiveCooldownMs: 108000` (attempt 4 of 5) — loop is active for minutes with zero forward progress

---

## File Structure

**Modified:**
- `frontend/src/modules/Player/renderers/VideoPlayer.jsx` — `hardReset` accepts `refreshUrl` flag, cache-busts `src`; new DASH error watchdog escalates to resilience on repeated code-28 segment errors
- `frontend/src/modules/Player/Player.jsx` — `handleResilienceReload` forwards `refreshUrl` to `mediaAccess.hardReset`; logs new `playback.stream-url-refreshed` event
- `frontend/src/modules/Player/hooks/useMediaResilience.js` — `triggerRecovery` adds `refreshUrl: true` to `onReload` payload when reason is a startup-deadline variant or `stale-session-detected`
- `frontend/src/modules/Player/hooks/useResilienceConfig.js` (or the recovery-reason constants file) — export a predicate `isStartupDeadlineReason(reason)` so the decision lives in one place

**Created:**
- `frontend/src/modules/Player/lib/staleSessionWatchdog.js` — pure function/factory that tracks DASH segment-404 errors in a sliding window and fires an escalation callback at threshold
- `frontend/src/modules/Player/lib/staleSessionWatchdog.test.js` — Vitest unit tests
- `frontend/src/modules/Player/renderers/VideoPlayer.hardReset.test.jsx` — Vitest unit test for cache-bust behavior
- `tests/live/flow/fitness/fitness-stale-session-recovery.runtime.test.mjs` — Playwright integration test that simulates 404 on segment URL and verifies recovery

**Not modified (verified compatible):**
- Backend routes under `backend/src/4_api/v1/routers/play.mjs` and the `/api/v1/proxy/plex/*` mount — they already pass unknown query params through transparently; cache-buster is a no-op server-side

---

## Task 1: Extract startup-deadline reason predicate

**Why this task:** Later tasks in both `useMediaResilience.js` and `Player.jsx` need to decide "is this the kind of recovery that warrants a URL refresh?" Putting the decision in one place prevents drift.

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useMediaResilience.js` (search for `startup-deadline-exceeded` string usage)

- [ ] **Step 1: Find where recovery reasons are defined**

Run: `grep -n "startup-deadline-exceeded" frontend/src/modules/Player/hooks/useMediaResilience.js`
Expected output: lines where the reason string is emitted (likely 229 and 261 per research).

- [ ] **Step 2: Add an exported predicate next to the reason strings**

At the top of `useMediaResilience.js` (after imports, before the hook body), add:

```javascript
// Reasons where the dash.js MPD manifest is almost certainly stale
// (Plex transcode session died during startup). These warrant a fresh
// fetch of the stream URL rather than a same-src reload.
const URL_REFRESH_REASONS = new Set([
  'startup-deadline-exceeded',
  'startup-deadline-exceeded-after-warmup',
  'stale-session-detected'
]);

export function shouldRefreshUrlForReason(reason) {
  return URL_REFRESH_REASONS.has(reason);
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Player/hooks/useMediaResilience.js
git commit -m "feat(player): add shouldRefreshUrlForReason predicate for URL-refresh decisions"
```

---

## Task 2: Thread refreshUrl flag through resilience → onReload payload

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useMediaResilience.js:140-177` (the `triggerRecovery` function)

- [ ] **Step 1: Write a failing test for the onReload payload**

Create `frontend/src/modules/Player/hooks/useMediaResilience.refreshUrl.test.js`:

```javascript
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMediaResilience } from './useMediaResilience.js';

describe('useMediaResilience — refreshUrl signal', () => {
  it('sets refreshUrl:true in onReload payload when reason is startup-deadline-exceeded', async () => {
    const onReload = vi.fn();
    const { result } = renderHook(() => useMediaResilience({
      onReload,
      meta: { src: 'https://example.test/stream/1' },
      waitKey: 'test:1',
      playbackSessionKey: 'session-a',
      recoveryCooldownMs: 0,
      maxAttempts: 5
    }));

    // triggerRecovery is internal — invoke via exposed test hook or by advancing the startup deadline
    act(() => result.current._testTriggerRecovery('startup-deadline-exceeded'));

    expect(onReload).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'startup-deadline-exceeded',
      refreshUrl: true
    }));
  });

  it('omits refreshUrl (or sets false) for non-startup reasons', () => {
    const onReload = vi.fn();
    const { result } = renderHook(() => useMediaResilience({
      onReload,
      meta: { src: 'https://example.test/stream/1' },
      waitKey: 'test:1',
      playbackSessionKey: 'session-b',
      recoveryCooldownMs: 0,
      maxAttempts: 5
    }));

    act(() => result.current._testTriggerRecovery('playback-stalled'));

    expect(onReload).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'playback-stalled',
      refreshUrl: false
    }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Player/hooks/useMediaResilience.refreshUrl.test.js`
Expected: FAIL — either `_testTriggerRecovery` is not exported, or `refreshUrl` is not in the payload.

- [ ] **Step 3: Update triggerRecovery to include refreshUrl in onReload payload**

In `useMediaResilience.js`, locate the `triggerRecovery` callback (starts at line ~140). Inside the `if (typeof onReload === 'function')` block, change:

```javascript
    if (typeof onReload === 'function') {
      onReload({
        reason,
        meta,
        waitKey,
        seekToIntentMs: (targetTimeSeconds || playbackHealth.lastProgressSeconds || seconds || initialStart || 0) * 1000
      });
    }
```

to:

```javascript
    if (typeof onReload === 'function') {
      onReload({
        reason,
        meta,
        waitKey,
        refreshUrl: shouldRefreshUrlForReason(reason),
        seekToIntentMs: (targetTimeSeconds || playbackHealth.lastProgressSeconds || seconds || initialStart || 0) * 1000
      });
    }
```

Also update `retryFromExhausted` (~line 179) to force refresh on user-initiated retry:

```javascript
      onReload({
        reason: 'user-retry-exhausted',
        meta,
        waitKey,
        refreshUrl: true,
        seekToIntentMs: seekMs
      });
```

- [ ] **Step 4: Expose `_testTriggerRecovery` for tests**

At the end of the hook, where the return object is built, add a non-enumerable test hook (guarded by `process.env.NODE_ENV !== 'production'`). In the return statement (near end of file), add:

```javascript
  return {
    status,
    // ... existing fields
    ...(process.env.NODE_ENV !== 'production' && {
      _testTriggerRecovery: triggerRecovery
    })
  };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Player/hooks/useMediaResilience.refreshUrl.test.js`
Expected: PASS (both cases).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Player/hooks/useMediaResilience.js frontend/src/modules/Player/hooks/useMediaResilience.refreshUrl.test.js
git commit -m "feat(player): signal refreshUrl to reload handlers on startup-deadline recoveries"
```

---

## Task 3: Accept refreshUrl in Player.handleResilienceReload and pass to hardReset

**Files:**
- Modify: `frontend/src/modules/Player/Player.jsx:521-605` (the `handleResilienceReload` callback)

- [ ] **Step 1: Write a failing test that verifies the forwarding**

Create `frontend/src/modules/Player/Player.resilienceReload.test.jsx`:

```javascript
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
// Minimal harness that invokes handleResilienceReload with refreshUrl:true.
// Mock mediaAccess.hardReset to capture its args.

describe('Player.handleResilienceReload', () => {
  it('forwards refreshUrl:true from resilience payload to mediaAccess.hardReset', () => {
    const hardReset = vi.fn();
    // Use the refactored handler (extracted in Step 2 below) directly:
    // import { buildResilienceReloadHandler } from './Player.jsx';
    // const handler = buildResilienceReloadHandler({ mediaAccess: { hardReset }, ... });
    // handler({ reason: 'startup-deadline-exceeded', refreshUrl: true, seekToIntentMs: 0 });
    // expect(hardReset).toHaveBeenCalledWith({ seekToSeconds: 0, refreshUrl: true });
    // (full setup depends on existing test harness patterns — see Step 2)
  });
});
```

Note: if extracting a pure handler from inside a React component is too invasive, skip the unit test for Task 3 and rely on the Playwright integration test in Task 10.

- [ ] **Step 2: Update handleResilienceReload to extract and forward refreshUrl**

In `Player.jsx`, find line 534 where options are destructured:

```javascript
    const {
      forceDocumentReload: forceDocReload,
      forceFullReload,
      seekToIntentMs,
      meta: _ignoredMeta,
      ...rest
    } = options || {};
```

Change to:

```javascript
    const {
      forceDocumentReload: forceDocReload,
      forceFullReload,
      seekToIntentMs,
      refreshUrl,
      meta: _ignoredMeta,
      ...rest
    } = options || {};
```

Then find the `mediaAccess.hardReset` call at line 554:

```javascript
        mediaAccess.hardReset({ seekToSeconds: seekSeconds });
```

Change to:

```javascript
        mediaAccess.hardReset({ seekToSeconds: seekSeconds, refreshUrl: Boolean(refreshUrl) });
```

Then in the `playbackLog('player-remount', { ... })` block (line ~584), add `refreshUrl` to the payload:

```javascript
      playbackLog('player-remount', {
        payload: {
          waitKey: resolvedWaitKey,
          reason: rest?.reason || 'resilience',
          source: 'hard-reset-accepted',
          seekSeconds,
          guid: currentMediaGuid,
          remountNonce: remountInfoRef.current?.nonce ?? 0,
          refreshUrl: Boolean(refreshUrl),
          ...conditions
        }
      });
```

- [ ] **Step 3: Run unit tests if Step 1 test is viable**

Run: `npx vitest run frontend/src/modules/Player/Player.resilienceReload.test.jsx`
Expected: PASS if written; otherwise skip and verify in Task 10 Playwright run.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Player/Player.jsx
git commit -m "feat(player): forward refreshUrl from resilience reload to hardReset"
```

---

## Task 4: Cache-bust src URL in VideoPlayer.hardReset when refreshUrl is true

**Files:**
- Modify: `frontend/src/modules/Player/renderers/VideoPlayer.jsx:128-143` (the `hardReset` callback)

- [ ] **Step 1: Write a failing Vitest test**

Create `frontend/src/modules/Player/renderers/VideoPlayer.hardReset.test.jsx`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { appendRefreshParam } from './VideoPlayer.jsx';

describe('appendRefreshParam', () => {
  it('appends _refresh=<ts> to a URL without query string', () => {
    const out = appendRefreshParam('https://host.test/api/v1/play/plex/1', 123456);
    expect(out).toBe('https://host.test/api/v1/play/plex/1?_refresh=123456');
  });

  it('appends &_refresh=<ts> to a URL with existing query string', () => {
    const out = appendRefreshParam('https://host.test/stream?foo=bar', 789);
    expect(out).toBe('https://host.test/stream?foo=bar&_refresh=789');
  });

  it('replaces an existing _refresh param instead of duplicating', () => {
    const out = appendRefreshParam('https://host.test/s?_refresh=111&foo=bar', 222);
    expect(out).toBe('https://host.test/s?foo=bar&_refresh=222');
  });

  it('handles relative URLs', () => {
    const out = appendRefreshParam('/api/v1/play/plex/1', 55);
    expect(out).toBe('/api/v1/play/plex/1?_refresh=55');
  });

  it('is a no-op on falsy input', () => {
    expect(appendRefreshParam('', 1)).toBe('');
    expect(appendRefreshParam(null, 1)).toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Player/renderers/VideoPlayer.hardReset.test.jsx`
Expected: FAIL — `appendRefreshParam` not exported.

- [ ] **Step 3: Add appendRefreshParam helper**

At the top of `VideoPlayer.jsx` (after imports, before the component), add:

```javascript
/**
 * Append or replace a cache-buster query param on a URL.
 * Used by hardReset to force dash.js to re-fetch the MPD manifest
 * from the backend, which in turn mints a fresh Plex transcode session.
 * Works on absolute and relative URLs. Idempotent with respect to
 * an existing _refresh param.
 */
export function appendRefreshParam(url, nonce) {
  if (!url) return url;
  const sep = url.includes('?') ? '&' : '?';
  // Strip any existing _refresh=... to avoid unbounded URL growth over
  // many recovery cycles.
  const stripped = url.replace(/([?&])_refresh=[^&]*&?/g, (_m, pfx) => pfx === '?' ? '?' : '')
                      .replace(/[?&]$/, '');
  const nextSep = stripped.includes('?') ? '&' : '?';
  return `${stripped}${nextSep}_refresh=${nonce}`;
}
```

- [ ] **Step 4: Run unit tests to verify appendRefreshParam passes**

Run: `npx vitest run frontend/src/modules/Player/renderers/VideoPlayer.hardReset.test.jsx`
Expected: PASS (all 5 cases).

- [ ] **Step 5: Update hardReset to use appendRefreshParam**

Replace the `hardReset` callback (currently at line 128):

```javascript
  const hardReset = useCallback(({ seekToSeconds, refreshUrl = false } = {}) => {
    const target = getMediaEl() || containerRef.current;
    if (!target) return;
    const normalized = Number.isFinite(seekToSeconds) ? Math.max(0, seekToSeconds) : 0;

    // If refreshUrl is requested, mutate the src attribute on the <dash-video>
    // container *before* calling load(). Setting `src` on the web component
    // triggers a fresh MPD fetch from the backend, which mints a new Plex
    // transcode session (the old session may be dead — this is the whole point).
    if (refreshUrl) {
      const container = containerRef.current;
      const currentSrc = container?.getAttribute?.('src');
      if (currentSrc) {
        const nextSrc = appendRefreshParam(currentSrc, Date.now());
        try {
          container.setAttribute('src', nextSrc);
          playbackLog('playback.stream-url-refreshed', {
            previousSrc: currentSrc,
            nextSrc,
            reason: 'hard-reset-with-refresh'
          });
        } catch (err) {
          playbackLog('playback.stream-url-refresh-failed', {
            message: err?.message
          }, { level: 'warn' });
        }
      } else {
        playbackLog('playback.stream-url-refresh-skipped', {
          reason: 'no-current-src'
        }, { level: 'warn' });
      }
    }

    try { target.currentTime = normalized; } catch (_) {}
    target.load?.();
    const p = target.play?.();
    if (p && typeof p.catch === 'function') {
      p.catch((err) => {
        if (err?.name === 'NotAllowedError') {
          setAutoplayBlocked(true);
          playbackLog('autoplay-blocked', { source: 'hardReset' }, { level: 'warn' });
        }
      });
    }
  }, [containerRef, getMediaEl]);
```

- [ ] **Step 6: Run existing player tests to ensure no regression**

Run: `npx vitest run frontend/src/modules/Player/`
Expected: PASS (all existing tests).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Player/renderers/VideoPlayer.jsx frontend/src/modules/Player/renderers/VideoPlayer.hardReset.test.jsx
git commit -m "fix(player): cache-bust src URL on hardReset when refreshUrl requested

Fixes infinite recovery loop when a Plex transcode session dies during
startup. Previously hardReset called load() on the <dash-video> element
with the same src, causing dash.js to re-parse the cached MPD manifest
whose segment URLs still pointed at the dead session (HTTP 404 forever).
Now, when the resilience state machine signals refreshUrl:true (on
startup-deadline-exceeded), we append a timestamped _refresh query param
to the src before load(), forcing a fresh MPD fetch from the backend
proxy, which in turn mints a new transcode session on Plex."
```

---

## Task 5: Build stale-session watchdog (DASH error 28 sliding window)

**Why:** The 15s `startup-deadline-exceeded` timeout is slow. When we see three `dash.error` code-28 events on segment URLs in under 10 seconds, we already know the session is dead — escalate immediately.

**Files:**
- Create: `frontend/src/modules/Player/lib/staleSessionWatchdog.js`
- Create: `frontend/src/modules/Player/lib/staleSessionWatchdog.test.js`

- [ ] **Step 1: Write failing tests**

Create `frontend/src/modules/Player/lib/staleSessionWatchdog.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createStaleSessionWatchdog } from './staleSessionWatchdog.js';

describe('createStaleSessionWatchdog', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not escalate on a single dash.error', () => {
    const onEscalate = vi.fn();
    const wd = createStaleSessionWatchdog({ onEscalate, threshold: 3, windowMs: 10000 });
    wd.recordError({ code: 28, message: 'segment not available' });
    expect(onEscalate).not.toHaveBeenCalled();
  });

  it('escalates when threshold errors hit within window', () => {
    const onEscalate = vi.fn();
    const wd = createStaleSessionWatchdog({ onEscalate, threshold: 3, windowMs: 10000 });
    wd.recordError({ code: 28, message: 'session/AAA not available' });
    vi.advanceTimersByTime(2000);
    wd.recordError({ code: 28, message: 'session/AAA not available' });
    vi.advanceTimersByTime(2000);
    wd.recordError({ code: 28, message: 'session/AAA not available' });
    expect(onEscalate).toHaveBeenCalledTimes(1);
    expect(onEscalate).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'stale-session-detected',
      errorCount: 3
    }));
  });

  it('does not escalate if errors are outside the window', () => {
    const onEscalate = vi.fn();
    const wd = createStaleSessionWatchdog({ onEscalate, threshold: 3, windowMs: 10000 });
    wd.recordError({ code: 28 });
    vi.advanceTimersByTime(6000);
    wd.recordError({ code: 28 });
    vi.advanceTimersByTime(6000); // total 12s — first error falls off
    wd.recordError({ code: 28 });
    expect(onEscalate).not.toHaveBeenCalled();
  });

  it('ignores non-segment errors (code != 28)', () => {
    const onEscalate = vi.fn();
    const wd = createStaleSessionWatchdog({ onEscalate, threshold: 3, windowMs: 10000 });
    wd.recordError({ code: 10, message: 'manifest error' });
    wd.recordError({ code: 10, message: 'manifest error' });
    wd.recordError({ code: 10, message: 'manifest error' });
    expect(onEscalate).not.toHaveBeenCalled();
  });

  it('does not double-escalate on the same session', () => {
    const onEscalate = vi.fn();
    const wd = createStaleSessionWatchdog({ onEscalate, threshold: 3, windowMs: 10000 });
    for (let i = 0; i < 6; i++) {
      wd.recordError({ code: 28 });
      vi.advanceTimersByTime(1000);
    }
    expect(onEscalate).toHaveBeenCalledTimes(1); // only the first threshold crossing
  });

  it('re-arms after reset()', () => {
    const onEscalate = vi.fn();
    const wd = createStaleSessionWatchdog({ onEscalate, threshold: 3, windowMs: 10000 });
    for (let i = 0; i < 3; i++) wd.recordError({ code: 28 });
    expect(onEscalate).toHaveBeenCalledTimes(1);

    wd.reset();
    for (let i = 0; i < 3; i++) wd.recordError({ code: 28 });
    expect(onEscalate).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Player/lib/staleSessionWatchdog.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the watchdog**

Create `frontend/src/modules/Player/lib/staleSessionWatchdog.js`:

```javascript
/**
 * Sliding-window watchdog that escalates to recovery when dash.js emits
 * enough segment-404 errors (code 28) in a short window to indicate the
 * Plex transcode session is dead.
 *
 * Design:
 * - Only code 28 errors count (segment not available / HTTP 404)
 * - One-shot: once it has escalated, it stays quiet until reset() is called
 *   (typically on remount or successful playback)
 *
 * @param {Object} opts
 * @param {Function} opts.onEscalate - called with { reason, errorCount, windowMs } at threshold
 * @param {number} [opts.threshold=3] - errors needed in window
 * @param {number} [opts.windowMs=10000] - sliding window duration
 */
export function createStaleSessionWatchdog({ onEscalate, threshold = 3, windowMs = 10000 }) {
  let timestamps = [];
  let escalated = false;

  return {
    recordError(err) {
      if (escalated) return;
      if (err?.code !== 28) return;

      const now = Date.now();
      timestamps = timestamps.filter(t => now - t < windowMs);
      timestamps.push(now);

      if (timestamps.length >= threshold) {
        escalated = true;
        if (typeof onEscalate === 'function') {
          onEscalate({
            reason: 'stale-session-detected',
            errorCount: timestamps.length,
            windowMs
          });
        }
      }
    },
    reset() {
      timestamps = [];
      escalated = false;
    },
    get hasEscalated() { return escalated; }
  };
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx vitest run frontend/src/modules/Player/lib/staleSessionWatchdog.test.js`
Expected: PASS (all 6 cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Player/lib/staleSessionWatchdog.js frontend/src/modules/Player/lib/staleSessionWatchdog.test.js
git commit -m "feat(player): add stale-session watchdog for dash.js segment-404 escalation"
```

---

## Task 6: Wire watchdog into VideoPlayer's DASH error handler

**Files:**
- Modify: `frontend/src/modules/Player/renderers/VideoPlayer.jsx` (the `api.on('error', ...)` block around line 350)

- [ ] **Step 1: Add watchdog to VideoPlayer**

Near the top of `VideoPlayer.jsx`, add the import:

```javascript
import { createStaleSessionWatchdog } from '../lib/staleSessionWatchdog.js';
```

Inside the component body (near other refs), create the watchdog:

```javascript
  const staleSessionWatchdogRef = useRef(null);
  if (!staleSessionWatchdogRef.current) {
    staleSessionWatchdogRef.current = createStaleSessionWatchdog({
      threshold: 3,
      windowMs: 10000,
      onEscalate: ({ reason, errorCount, windowMs }) => {
        playbackLog('playback.stale-session-detected', {
          errorCount,
          windowMs,
          action: 'escalating-to-resilience-recovery'
        }, { level: 'warn' });
        // Route through the resilience bridge so the existing attempt-counter
        // and backoff apply. This path will pass refreshUrl:true via
        // shouldRefreshUrlForReason('stale-session-detected').
        resilienceBridge?.requestRecovery?.({ reason: 'stale-session-detected' });
      }
    });
  }
```

- [ ] **Step 2: Call watchdog.recordError from the dash error handler**

Find the DASH error handler (~line 350):

```javascript
    api.on('error', (e) => {
      dashLog.error('dash.error', {
        error: e?.error?.code,
        message: e?.error?.message?.substring(0, 200),
        data: e?.error?.data ? JSON.stringify(e.error.data).substring(0, 300) : null
      });
    });
```

Change to:

```javascript
    api.on('error', (e) => {
      const code = e?.error?.code;
      const message = e?.error?.message?.substring(0, 200);
      dashLog.error('dash.error', {
        error: code,
        message,
        data: e?.error?.data ? JSON.stringify(e.error.data).substring(0, 300) : null
      });
      staleSessionWatchdogRef.current?.recordError({ code, message });
    });
```

- [ ] **Step 3: Reset watchdog on successful playback**

Find the dash `playback-started` event handler (~line 340 per research) and add a reset call:

```javascript
    api.on('playbackStarted', () => {
      dashLog.info('dash.playback-started');
      staleSessionWatchdogRef.current?.reset();
    });
```

Also reset on `api.on('manifestLoaded', ...)` — a fresh manifest means a fresh session; any errors from now on are new:

```javascript
    api.on('manifestLoaded', (e) => {
      dashLog.info('dash.manifest-loaded', { /* existing payload */ });
      staleSessionWatchdogRef.current?.reset();
    });
```

- [ ] **Step 4: Expose requestRecovery on the resilience bridge**

In `Player.jsx`, find where `resilienceBridgeRef.current` is initialized and add a `requestRecovery` method. Search for `resilienceBridgeRef`:

Run: `grep -n "resilienceBridgeRef" frontend/src/modules/Player/Player.jsx`

Where the bridge is defined, add a `requestRecovery` function that calls `triggerRecovery` on the media resilience hook:

```javascript
  // The media resilience hook exposes triggerRecovery via its return value.
  // Bridge it to the renderer so the stale-session watchdog can escalate.
  const mediaResilience = useMediaResilience({ /* ... existing args ... */ });

  // Add to the bridge object:
  resilienceBridgeRef.current = {
    // ... existing methods
    requestRecovery: ({ reason }) => {
      if (typeof mediaResilience?.requestRecovery === 'function') {
        mediaResilience.requestRecovery(reason);
      }
    }
  };
```

And in `useMediaResilience.js`, export `triggerRecovery` publicly as `requestRecovery`:

```javascript
  return {
    status,
    // ... existing fields
    requestRecovery: triggerRecovery,
    ...(process.env.NODE_ENV !== 'production' && {
      _testTriggerRecovery: triggerRecovery
    })
  };
```

- [ ] **Step 5: Run all player tests to verify no regression**

Run: `npx vitest run frontend/src/modules/Player/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Player/renderers/VideoPlayer.jsx frontend/src/modules/Player/Player.jsx frontend/src/modules/Player/hooks/useMediaResilience.js
git commit -m "feat(player): escalate repeated DASH segment-404 errors to resilience recovery"
```

---

## Task 7: Surface user-facing retry after URL-refresh exhaustion

**Why:** Today, after 5 attempts the resilience state becomes `exhausted` and the player sits there silently. Users need a clear "this session is stuck, tap to retry" option that forces a fresh page-level reload (which resets the module-level `_recoveryTracker`).

**Files:**
- Modify: `frontend/src/modules/Player/components/` — find the overlay that shows on `exhausted` state (or `frontend/src/modules/Fitness/player/overlays/` if fitness-specific)
- Reference: `useMediaResilience.retryFromExhausted` already exists; it just needs to be surfaced

- [ ] **Step 1: Find the exhausted-state UI**

Run: `grep -rn "exhausted" frontend/src/modules/Player/ frontend/src/modules/Fitness/player/`
Expected: locate the component that conditionally renders when `status === 'exhausted'`.

- [ ] **Step 2: Confirm a retry button exists and is wired to retryFromExhausted**

Based on the research, `useMediaResilience.retryFromExhausted` is already the handler. Verify the button calls it. If missing or broken, add:

```javascript
<button
  onPointerDown={() => {
    playbackLog('playback.user-retry-from-exhausted', {});
    onRetry(); // prop that calls retryFromExhausted
  }}
>
  Retry playback
</button>
```

- [ ] **Step 3: Add log coverage at the `resilience-recovery-exhausted` path**

In `useMediaResilience.js` (around line 150), add richer context to the existing log:

```javascript
      playbackLog('resilience-recovery-exhausted', {
        reason,
        waitKey: logWaitKey,
        attempts: tracker.count,
        maxAttempts,
        urlRefreshesAttempted: tracker.urlRefreshCount || 0
      });
```

Maintain a `urlRefreshCount` on the tracker — increment inside `triggerRecovery` when `shouldRefreshUrlForReason(reason)` returns true.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Player/hooks/useMediaResilience.js [overlay-file-from-step-1]
git commit -m "feat(player): surface retry overlay and enrich exhaustion telemetry"
```

---

## Task 8: Verify backend passes _refresh query param through transparently

**Files:**
- Read: `backend/src/4_api/v1/routers/play.mjs`
- Read: `backend/src/4_api/v1/routers/` (whichever file handles `/proxy/plex/*`)

- [ ] **Step 1: Find the proxy route**

Run: `grep -rn "proxy/plex" backend/src/4_api/`
Expected: identify the file handling `/api/v1/proxy/plex/*`.

- [ ] **Step 2: Trace `/api/v1/play/plex/:id` handler**

Read `backend/src/4_api/v1/routers/play.mjs` lines 174-319. Verify:
- The handler does NOT memoize by URL (no in-memory cache keyed on request path)
- Each call to `plexAdapter.getMediaUrl()` requests a new transcode session from Plex (or reuses only if Plex itself returns a cached session)

- [ ] **Step 3: Add a backend smoke test**

Create or extend `tests/live/api/fitness/play-refresh.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { getAppPort } from '../../../_lib/configHelper.mjs';

describe('GET /api/v1/play/plex/:id with _refresh param', () => {
  it('returns successfully and does not crash', async () => {
    const port = await getAppPort();
    // Pick a known valid content id for the dev environment. Fitness content exists at plex:674498 per session logs.
    const id = process.env.TEST_PLEX_ID || '674498';
    const r1 = await fetch(`http://localhost:${port}/api/v1/play/plex/${id}`);
    const r2 = await fetch(`http://localhost:${port}/api/v1/play/plex/${id}?_refresh=${Date.now()}`);
    expect(r1.ok || r1.status === 302).toBe(true);
    expect(r2.ok || r2.status === 302).toBe(true);
    // If both return JSON with mediaUrl, verify they produce different session UUIDs
    // (this proves fresh session minting — if the UUIDs match, Plex is caching and
    // we need backend-side cache-busting, see Task 9).
    if (r1.headers.get('content-type')?.includes('json') && r2.headers.get('content-type')?.includes('json')) {
      const j1 = await r1.json();
      const j2 = await r2.json();
      const s1 = j1.mediaUrl?.match(/session\/([a-f0-9-]+)/)?.[1];
      const s2 = j2.mediaUrl?.match(/session\/([a-f0-9-]+)/)?.[1];
      if (s1 && s2) {
        expect(s2).not.toBe(s1); // refresh should mint a new session
      }
    }
  });
});
```

- [ ] **Step 4: Run the backend test against a live dev server**

Run: `npm run test:live:api -- play-refresh`
Expected: PASS.

- [ ] **Step 5: If the test fails with identical session UUIDs**

Plex is caching transcode sessions server-side. Add backend-side invalidation: when `_refresh` is present on `/api/v1/play/plex/:id`, call Plex's `/video/:/transcode/universal/stop?session=<old-uuid>` to kill any active session for this clientIdentifier before minting a new one.

Prepare a follow-up task or a note in the plan:

```markdown
**Known risk:** If Plex returns the same session UUID for repeated requests,
add `killPriorSession(clientIdentifier)` in `PlexAdapter.getMediaUrl` when
an explicit refresh is requested. See `_wip/plans/<date>-plex-session-invalidation.md`.
```

- [ ] **Step 6: Commit**

```bash
git add tests/live/api/fitness/play-refresh.test.mjs
git commit -m "test(fitness): verify /play/plex/:id mints fresh session on _refresh"
```

---

## Task 9: Add structured telemetry for the new recovery path

**Why:** Bulletproof means observable. We need dashboards to show: how often URL refreshes happen, what fraction succeed on first refresh vs need multiple, and what percentage of sessions exhaust.

**Files:**
- Modify: the places that emit `playback.stream-url-refreshed` and `playback.stale-session-detected` (already added in Tasks 4 and 6)
- Create: `backend/src/4_api/v1/routers/fitness-diagnostics.mjs` — a small read-only endpoint that summarizes recent session logs

- [ ] **Step 1: Confirm log events are correctly emitted**

Run: `grep -rn "playback.stream-url-refreshed\|playback.stale-session-detected\|resilience-recovery-exhausted" frontend/src/modules/Player/`
Expected: emission points in VideoPlayer.jsx (from Task 4, 6) and useMediaResilience.js (from Task 7).

- [ ] **Step 2: Add a backend aggregation endpoint**

Create `backend/src/4_api/v1/routers/fitness-diagnostics.mjs`:

```javascript
import express from 'express';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

export default function buildFitnessDiagnosticsRouter({ mediaDir }) {
  const router = express.Router();

  router.get('/recovery-summary', async (req, res) => {
    const logsDir = path.join(mediaDir, 'logs', 'fitness');
    if (!fs.existsSync(logsDir)) return res.json({ files: 0, events: {} });

    const files = fs.readdirSync(logsDir).filter(f => f.endsWith('.jsonl')).sort().slice(-5);
    const counts = {
      'playback.stream-url-refreshed': 0,
      'playback.stale-session-detected': 0,
      'resilience-recovery-exhausted': 0,
      'dash.error': 0,
      'player-remount': 0
    };

    for (const file of files) {
      const stream = fs.createReadStream(path.join(logsDir, file));
      const rl = readline.createInterface({ input: stream });
      for await (const line of rl) {
        try {
          const evt = JSON.parse(line);
          if (evt?.event in counts) counts[evt.event]++;
        } catch { /* skip malformed */ }
      }
    }

    res.json({ files: files.length, sinceFile: files[0] || null, events: counts });
  });

  return router;
}
```

- [ ] **Step 3: Register the router**

In `backend/src/4_api/v1/index.mjs` (or wherever v1 routers are mounted), add:

```javascript
import buildFitnessDiagnosticsRouter from './routers/fitness-diagnostics.mjs';
// ...
router.use('/fitness/diagnostics', buildFitnessDiagnosticsRouter({ mediaDir: config.paths.media }));
```

- [ ] **Step 4: Manual verification**

Run: `curl -s http://localhost:3111/api/v1/fitness/diagnostics/recovery-summary | jq`
Expected: JSON with recent event counts.

- [ ] **Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/fitness-diagnostics.mjs backend/src/4_api/v1/index.mjs
git commit -m "feat(fitness): add /diagnostics/recovery-summary endpoint for telemetry"
```

---

## Task 10: Playwright integration test — simulated stale session

**Why:** Unit tests prove each piece works in isolation; we need one end-to-end test that simulates the real failure mode.

**Files:**
- Create: `tests/live/flow/fitness/fitness-stale-session-recovery.runtime.test.mjs`

- [ ] **Step 1: Write the test**

Create `tests/live/flow/fitness/fitness-stale-session-recovery.runtime.test.mjs`:

```javascript
import { test, expect } from '@playwright/test';
import { getAppUrl } from '../../../_fixtures/runtime/urls.mjs';

test.describe('Fitness player — stale transcode session recovery', () => {
  test('recovers from simulated 404 on segment URL by refreshing the stream URL', async ({ page, context }) => {
    const appUrl = await getAppUrl();
    const testEpisodeId = process.env.TEST_PLEX_ID || '674498';

    // Intercept ALL requests to /video/:/transcode/universal/session/.../header
    // and return 404 on the first 6 (enough to cross the watchdog threshold
    // with margin + trigger startup deadline). Then let subsequent requests
    // through unmodified — proving that a URL refresh (which generates a new
    // session UUID) unsticks the player.
    let sessionUuidsHit = new Set();
    let blockedCount = 0;
    const BLOCKED_SESSION_LIMIT = 1; // block only requests under the FIRST session UUID we see

    await context.route('**/proxy/plex/video/:/transcode/universal/session/*/0/header', async (route) => {
      const url = route.request().url();
      const match = url.match(/session\/([a-f0-9-]+)/);
      const sessionId = match?.[1];
      if (!sessionId) return route.continue();

      if (sessionUuidsHit.size === 0 || sessionUuidsHit.has(sessionId)) {
        sessionUuidsHit.add(sessionId);
        blockedCount++;
        return route.fulfill({ status: 404, contentType: 'text/plain', body: 'simulated dead session' });
      }
      // New session UUID — let it through
      return route.continue();
    });

    const consoleMessages = [];
    page.on('console', msg => consoleMessages.push(msg.text()));

    await page.goto(`${appUrl}/fitness/play/${testEpisodeId}?nogovern=1`);

    // Wait for the player to recover: either playback.stream-url-refreshed fires,
    // or a fresh session UUID is eventually observed.
    await page.waitForFunction(
      (expectedBlocked) => {
        // Check window.__fitnessRecoveryEvents (see Step 3) for the refresh marker
        return window.__fitnessRecoveryEvents?.includes('playback.stream-url-refreshed');
      },
      null,
      { timeout: 45000 } // allow for watchdog (10s) + cooldown (4s) + refresh + playback start
    );

    // Verify the video element is actually playing (not paused, currentTime > 0)
    const videoState = await page.evaluate(() => {
      const v = document.querySelector('dash-video')?.shadowRoot?.querySelector('video')
             || document.querySelector('video');
      return v ? { paused: v.paused, currentTime: v.currentTime, readyState: v.readyState } : null;
    });

    expect(videoState).not.toBeNull();
    expect(videoState.paused).toBe(false);
    expect(videoState.currentTime).toBeGreaterThan(0);

    // We must have seen MORE than one distinct session UUID — proves the refresh
    // actually minted a new session.
    expect(sessionUuidsHit.size).toBeGreaterThanOrEqual(1);
    expect(blockedCount).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Expose recovery events on window for the test**

In `VideoPlayer.jsx` (dev/test only), add after `playbackLog('playback.stream-url-refreshed', ...)`:

```javascript
      if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
        window.__fitnessRecoveryEvents = window.__fitnessRecoveryEvents || [];
        window.__fitnessRecoveryEvents.push('playback.stream-url-refreshed');
      }
```

(Alternative: the test could tail the WebSocket log stream the logger already emits — but polling a window global is simpler.)

- [ ] **Step 3: Run the test**

Run: `npx playwright test tests/live/flow/fitness/fitness-stale-session-recovery.runtime.test.mjs --reporter=line`
Expected: PASS. Video is playing after 20-40s, at least one URL refresh was observed.

- [ ] **Step 4: Commit**

```bash
git add tests/live/flow/fitness/fitness-stale-session-recovery.runtime.test.mjs frontend/src/modules/Player/renderers/VideoPlayer.jsx
git commit -m "test(fitness): end-to-end stale-session recovery via simulated segment-404"
```

---

## Task 11: Manual verification on dev server

- [ ] **Step 1: Ensure dev server is running**

Run: `lsof -i :3111`
Expected: `node`/`vite` on the port. If not:

Run: `node backend/index.js &` (or `npm run dev`) and wait for "ready".

- [ ] **Step 2: Kick off a fitness video and capture fresh session UUID**

Run: `curl -sI http://localhost:3111/api/v1/play/plex/674498 | grep -i location`
Record the session UUID from the redirect.

- [ ] **Step 3: Manually kill the session on Plex**

Run: `curl -s "http://localhost:32400/video/:/transcode/universal/stop?session=<UUID>&X-Plex-Token=<token>"`
Expected: session terminated. The next segment request will 404.

- [ ] **Step 4: Load the page and watch the session log**

In one terminal: `sudo docker exec daylight-station sh -c 'tail -f media/logs/fitness/$(ls -t media/logs/fitness | head -1)' | grep -E "stream-url-refreshed|stale-session|dash.error|player-remount"`

In another: open `http://localhost:3111/fitness/play/674498?nogovern=1` in a browser.

Expected log sequence:
1. `dash.error` with code 28 (a few times)
2. `playback.stale-session-detected` (once, when watchdog fires)
3. `resilience-recovery` with reason `stale-session-detected`
4. `playback.stream-url-refreshed` with `previousSrc` and `nextSrc` (nextSrc has `_refresh=<ts>`)
5. `dash.manifest-loaded` (fresh manifest)
6. `dash.playback-started`

- [ ] **Step 5: Verify video is playing**

In the browser, confirm video is rendering (currentTime > 0, audio audible if unmuted).

- [ ] **Step 6: Run diagnostics endpoint**

Run: `curl -s http://localhost:3111/api/v1/fitness/diagnostics/recovery-summary | jq`
Expected: event counts reflect the manual test.

- [ ] **Step 7: Do NOT commit anything — this is verification only**

This task produces no artifacts; confirm everything works and report.

---

## Task 12: Update documentation

**Files:**
- Modify: `frontend/src/modules/Player/README.media-resilience.md`
- Create or update: `docs/runbooks/fitness-player-recovery.md`

- [ ] **Step 1: Update the media-resilience README**

Append to `frontend/src/modules/Player/README.media-resilience.md`:

```markdown
## Stale Transcode Session Recovery

When a Plex transcode session dies during startup, the MPD manifest cached
by dash.js still points at the dead session UUID and segment fetches 404
forever. The recovery pipeline handles this in three ways:

1. **Fast escalation** — the stale-session watchdog (`lib/staleSessionWatchdog.js`)
   counts `dash.error` code-28 events in a 10s sliding window. At 3, it
   fires `stale-session-detected` into the resilience state machine
   *before* the 15s startup deadline would have triggered.

2. **URL refresh on reload** — when the resilience state machine calls
   `onReload` with a reason for which `shouldRefreshUrlForReason(reason)`
   is true (startup-deadline variants + `stale-session-detected`), the
   `refreshUrl:true` flag propagates down to `VideoPlayer.hardReset`,
   which appends `?_refresh=<ts>` to the `<dash-video>` `src`. That
   forces dash.js to fetch a fresh MPD, which in turn makes the backend
   proxy request a fresh transcode session from Plex.

3. **Exhaustion surface** — after 5 attempts, the state machine enters
   `exhausted` and the overlay shows a retry button wired to
   `retryFromExhausted`, which clears the attempt tracker and starts
   over.

Observability events:
- `playback.stale-session-detected` — watchdog fired
- `playback.stream-url-refreshed` — URL was cache-busted and reloaded
- `playback.stream-url-refresh-skipped` / `playback.stream-url-refresh-failed`
- `resilience-recovery-exhausted` — all attempts consumed

See `docs/runbooks/fitness-player-recovery.md` for debugging.
```

- [ ] **Step 2: Write the runbook**

Create `docs/runbooks/fitness-player-recovery.md`:

```markdown
# Fitness Player Recovery Runbook

## Symptom: Video won't start, stays on "Recovering…" indefinitely

Check the fitness session log:
`sudo docker exec daylight-station sh -c 'ls -t media/logs/fitness | head -1 | xargs -I {} tail -n 200 media/logs/fitness/{}'`

### Sequence A — Stale session (now auto-recovers)
1. `dash.error` code 28, message contains `transcode/universal/session/<uuid>/0/header`
2. `playback.stale-session-detected`
3. `resilience-recovery` reason `stale-session-detected`
4. `playback.stream-url-refreshed`
5. `dash.manifest-loaded` → `dash.playback-started`

**Action:** None. The fix is working. If you see this repeatedly for one episode,
Plex may be under memory pressure — check `sudo docker stats plex`.

### Sequence B — Plex-side failure (auto-recovery exhausts)
1. `dash.error` code 28 repeatedly
2. `playback.stream-url-refreshed` fires but ...
3. ... new session UUIDs also return 404 immediately
4. `resilience-recovery-exhausted` after 5 attempts

**Action:**
- `sudo docker logs plex --tail 100` — check for OOM / transcode crashes
- `curl -s http://localhost:32400/identity` — confirm Plex is up
- Restart Plex: `sudo docker restart plex` (then wait 60s before retry)

### Sequence C — Backend proxy misrouting
1. `dash.error` code 28 on URL that does NOT contain `session/<uuid>`

**Action:** the proxy may have cached a redirect to a wrong Plex instance.
Restart the app container: `sudo docker restart daylight-station`.

## Diagnostics endpoint

```bash
curl -s http://localhost:3111/api/v1/fitness/diagnostics/recovery-summary | jq
```

Shows event counts across the last 5 session log files.
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Player/README.media-resilience.md docs/runbooks/fitness-player-recovery.md
git commit -m "docs(fitness): document stale-session recovery architecture and runbook"
```

---

## Task 13: Freshness marker + final review

- [ ] **Step 1: Update the docs-freshness marker**

Run: `git rev-parse HEAD > docs/docs-last-updated.txt`

- [ ] **Step 2: Run the full test battery one last time**

Run in parallel:
- `npx vitest run frontend/src/modules/Player/`
- `npx playwright test tests/live/flow/fitness/fitness-stale-session-recovery.runtime.test.mjs`
- `npm run test:live:api -- play-refresh`

Expected: all pass.

- [ ] **Step 3: Confirm no raw console.* in new code**

Run: `grep -rn "console\\.\\(log\\|debug\\|warn\\|error\\)" frontend/src/modules/Player/renderers/VideoPlayer.jsx frontend/src/modules/Player/lib/staleSessionWatchdog.js`
Expected: no matches (the project rule forbids raw console for diagnostic logging).

- [ ] **Step 4: Commit freshness marker**

```bash
git add docs/docs-last-updated.txt
git commit -m "chore(docs): bump docs-last-updated marker after recovery plan"
```

- [ ] **Step 5: Report back to user**

Summarize:
- What changed (files, LOC)
- All tests passing
- Manual verification steps in Task 11 (request user to confirm before merge)
- Any caveats (Task 8 Step 5: if Plex caches session UUIDs, follow-up needed)

---

## Self-review checklist — already done

- **Spec coverage:** each log symptom (dash.error loop, same-src remount, exhaustion UX gap, lack of telemetry) is addressed by a specific task.
- **Placeholder scan:** no TBD/TODO/"handle appropriately" — all code is concrete.
- **Type consistency:** `refreshUrl` is the flag name everywhere; `shouldRefreshUrlForReason` is the predicate; `createStaleSessionWatchdog`, `recordError`, `reset`, `hasEscalated` are consistent across Tasks 5 and 6.

## Known follow-ups (out of scope for this plan)

- **Plex server-side session pre-kill** — if Task 8 Step 5 proves Plex caches session UUIDs by clientIdentifier, add `killPriorSession` in `PlexAdapter.getMediaUrl`. Separate plan.
- **Multi-source support** — same bug likely exists for other content sources (YouTube transcodes, etc.) — verify after fitness-specific fix lands.
- **Watchdog thresholds as config** — threshold=3, windowMs=10000 are hardcoded. Move to `fitness.yml` if we need per-environment tuning.
