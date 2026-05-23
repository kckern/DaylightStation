# Fitness Stall Noise + Transcode Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the false-positive `playback.stalled` rate from 91% to ~0% by checking `mediaEl.currentTime` directly before declaring a stall; auto-recover from a dead Plex transcode session by escalating `dash.error 27/28` into `hardReset({ refreshUrl: true })`; and tag `playback.paused`/`playback.resumed` with their source so the next "play didn't work" report is debuggable from the log alone.

**Architecture:** Three independent surgical changes. **(1)** New pure helper `lib/stallVerdict.js` returns `{ verdict: 'stalled' | 'progressing' | 'within-window', stallDurationMs }` from `(now, lastProgressTs, softMs, currentTime, lastObservedCurrentTime, epsilon)`. The soft-timer callback in `useCommonMediaController.scheduleStallDetection` consults this helper before logging `playback.stalled`; if the verdict is `'progressing'`, `lastProgressTs` is fast-forwarded to `now` and the stall is not declared. **(2)** New pure helper `lib/dashErrorRecovery.js` returns `{ action: 'refresh-url' | 'ignore', reason }` from `(errorCode, attemptsThisMount, maxAttempts)`. The `api.on('error', ...)` handler in `VideoPlayer.jsx` consults this; on `action: 'refresh-url'`, it invokes the existing `hardReset({ refreshUrl: true, seekToSeconds })` with the current position. A per-mount attempt counter prevents an infinite refresh loop if the source is permanently dead. **(3)** Mirror the existing `__seekSource` pattern: app code that intentionally pauses/plays the element tags `mediaEl.__pauseSource` / `__playSource` immediately before the call; the existing `onPause`/`onResume` listeners read and clear the tag, appending `source` to the log payload. Defaults to `'dom-event'` (which captures dash.js-internal retries and browser auto-pause). Recovery strategies in `useCommonMediaController` and the keyboard handler tag their calls explicitly.

**Tech Stack:** React, vitest + RTL for unit/component tests, vi.useFakeTimers for time-sensitive paths.

**Bug reference:** `docs/_wip/bugs/2026-05-23-fitness-stall-watchdog-noise-and-play-fails-during-real-stall.md` — §1 (false-positive watchdog), §2 (transcode session timeout, missing URL refresh), §3 (pause/play retry-loop telemetry gap).

---

## File Structure

**New files:**
- `frontend/src/modules/Player/lib/stallVerdict.js` — pure decision function `decideStallVerdict({ now, lastProgressTs, softMs, currentTime, lastObservedCurrentTime, progressEpsilon })`.
- `frontend/src/modules/Player/lib/stallVerdict.test.js` — vitest unit tests.
- `frontend/src/modules/Player/lib/dashErrorRecovery.js` — pure decision function `decideDashErrorRecovery({ errorCode, attemptsThisMount, maxAttempts })`.
- `frontend/src/modules/Player/lib/dashErrorRecovery.test.js` — vitest unit tests.
- `frontend/src/modules/Player/lib/playbackToggleSource.js` — helpers `tagPauseSource(el, source)`, `tagPlaySource(el, source)`, `readAndClearPauseSource(el)`, `readAndClearPlaySource(el)`.
- `frontend/src/modules/Player/lib/playbackToggleSource.test.js` — vitest unit tests.

**Modified files:**
- `frontend/src/modules/Player/hooks/useCommonMediaController.js`:
  - softTimer callback (lines ~860-948): consult `decideStallVerdict` before `logger.warn('playback.stalled', …)`. Maintain `lastObservedCurrentTime` on `stallStateRef`.
  - Pause/resume event handlers (lines ~1395-1430): include `source` in payloads via `readAndClearPauseSource` / `readAndClearPlaySource`.
  - Pause/play call sites in recovery strategies (lines ~459, 461, 489, 521, 531, 565): tag the element before calling.
- `frontend/src/modules/Player/renderers/VideoPlayer.jsx`:
  - `api.on('error', ...)` handler (line 473): consult `decideDashErrorRecovery`; on `refresh-url`, invoke `hardReset({ refreshUrl: true, seekToSeconds: <currentPosition> })`. Maintain `dashErrorAttemptsRef`.

---

## Background invariants the engineer must understand before writing code

1. **`timeupdate` is throttled and can skip.** HTML5 spec only guarantees the event fires at least 4Hz during playback. Under heavy event-loop load (this fitness session has 46 `fitness.render_thrashing` events), `timeupdate` can pause for 1.5-2.5s while playback is fine. The stall verdict must check `currentTime` directly — not just `lastProgressTs`.

2. **`mediaEl.currentTime` is authoritative for "is the media progressing."** Even when `timeupdate` is silent, `currentTime` advances. The video pipeline can decode and present frames without firing `timeupdate` every time.

3. **`hardReset({ refreshUrl: true })` already works.** It is registered with the resilience bridge in `VideoPlayer.jsx:234`, has its own test file `useMediaResilience.refreshUrl.test.js`, and mutates the `<dash-video>` `src` attribute to mint a fresh Plex transcode session. The gap is that nothing on the `api.on('error')` path calls it.

4. **dash.js error codes:**
   - `27` = `SEGMENT_BASE_INVALID` / segment unavailable
   - `28` = `MANIFEST_LOADER_PARSING_FAILURE` or `MANIFEST_LOADER_LOADING_FAILURE` — init segment / header unavailable
   - Both are the signature of a dead/expired Plex transcode session. Other dash error codes (decode errors, network mid-stream errors) should NOT trigger a URL refresh — the existing nudge/seekback/reload pipeline handles those.

5. **`__seekSource` pattern is the precedent.** `useCommonMediaController.js:382` sets `mediaEl.__seekSource = 'click'` before a programmatic seek; `handleSeeking` at line 1313 reads `mediaEl.__seekSource || 'programmatic'` and then `delete mediaEl.__seekSource` (line 1315). The pause/play tagging mirrors this exactly — same property-on-element convention, same read-then-delete handler, same default-when-untagged behavior.

6. **`__pauseSource` / `__playSource` default to `'dom-event'`, not `'unknown'`.** "dom-event" is accurate: when nothing tagged it, the source IS the DOM event firing — whether from dash.js's internal retry, the browser's auto-pause on `waiting`, or a true user input that didn't go through any tagged path. Operators can grep for `source: "dom-event"` to find paths still untagged.

7. **An `epsilon` for currentTime progress is needed.** Floating-point currentTime can wobble by a few microseconds even when paused (`currentTime` getter may return a recomputed value). Set `progressEpsilon = 0.05` seconds — well below the smallest real frame advance (~16ms = 0.016s at 60fps), well above floating-point noise.

---

### Task 1: Test — `decideStallVerdict` helper (failing test, no implementation)

**Files:**
- Create: `/opt/Code/DaylightStation/frontend/src/modules/Player/lib/stallVerdict.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { decideStallVerdict } from './stallVerdict.js';

describe('decideStallVerdict', () => {
  const base = {
    now: 10_000,
    lastProgressTs: 8_700,    // 1300ms since last timeupdate (just past softMs)
    softMs: 1200,
    currentTime: 100.0,
    lastObservedCurrentTime: 100.0,
    progressEpsilon: 0.05
  };

  it('returns "stalled" when both the timer gap exceeds softMs AND currentTime has not advanced', () => {
    const v = decideStallVerdict(base);
    expect(v.verdict).toBe('stalled');
    expect(v.stallDurationMs).toBe(1300);
  });

  it('returns "progressing" when currentTime has advanced past epsilon despite a long timeupdate gap', () => {
    // Audit 2026-05-23 §1: the canonical false-positive shape.
    // timeupdate was throttled; currentTime advanced anyway.
    const v = decideStallVerdict({ ...base, currentTime: 101.2 });
    expect(v.verdict).toBe('progressing');
    expect(v.stallDurationMs).toBeNull();
  });

  it('treats sub-epsilon currentTime drift as not progressing', () => {
    const v = decideStallVerdict({ ...base, currentTime: 100.01 }); // 10ms drift
    expect(v.verdict).toBe('stalled');
  });

  it('respects exactly-at-epsilon (boundary)', () => {
    // currentTime advanced by exactly 0.05 — counts as progressing
    const v = decideStallVerdict({ ...base, currentTime: 100.05 });
    expect(v.verdict).toBe('progressing');
  });

  it('returns "within-window" when the timer gap is below softMs (no decision yet)', () => {
    const v = decideStallVerdict({ ...base, lastProgressTs: 9_500 }); // 500ms gap
    expect(v.verdict).toBe('within-window');
    expect(v.stallDurationMs).toBeNull();
  });

  it('returns "within-window" when lastProgressTs is 0 (no progress yet ever)', () => {
    const v = decideStallVerdict({ ...base, lastProgressTs: 0 });
    expect(v.verdict).toBe('within-window');
  });

  it('handles invalid currentTime / lastObservedCurrentTime by falling back to time-gap only', () => {
    // No currentTime evidence available — must decide on timer alone (legacy behavior).
    const v = decideStallVerdict({ ...base, currentTime: NaN });
    expect(v.verdict).toBe('stalled');
    const v2 = decideStallVerdict({ ...base, lastObservedCurrentTime: NaN });
    expect(v2.verdict).toBe('stalled');
  });

  it('handles backwards currentTime drift (negative delta) as not-progressing', () => {
    // Browser may report a slightly-lower currentTime briefly during a seek.
    const v = decideStallVerdict({ ...base, currentTime: 99.5 });
    expect(v.verdict).toBe('stalled');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /opt/Code/DaylightStation && \
  /opt/Code/DaylightStation/node_modules/.bin/vitest run \
    /opt/Code/DaylightStation/.claude/worktrees/end-of-video-recovery/frontend/src/modules/Player/lib/stallVerdict.test.js
```

Expected: FAIL with `Failed to resolve import "./stallVerdict.js"`.

---

### Task 2: Implement `decideStallVerdict`

**Files:**
- Create: `/opt/Code/DaylightStation/frontend/src/modules/Player/lib/stallVerdict.js`

- [ ] **Step 1: Write the implementation**

```javascript
/**
 * Pure decision function for the soft-stall verdict.
 *
 * The 2026-05-23 fitness session (`fs_20260523132554`) had 53 of 58
 * `playback.stalled` warns resolve within 10ms (median 3ms) — false
 * positives caused by `timeupdate` being throttled past `softMs` during
 * heavy event-loop load while `mediaEl.currentTime` was advancing
 * normally. The verdict consults `currentTime` directly so a starved
 * `timeupdate` cannot trip the soft stall.
 *
 * Returns one of:
 *  - `{ verdict: 'within-window', stallDurationMs: null }` — `lastProgressTs`
 *    has not aged past `softMs`; soft timer should reschedule.
 *  - `{ verdict: 'progressing',   stallDurationMs: null }` — timer gap is
 *    past `softMs` BUT `currentTime` advanced past `progressEpsilon`. Caller
 *    should fast-forward `lastProgressTs = now` and reschedule (no stall).
 *  - `{ verdict: 'stalled',       stallDurationMs: <gap> }` — timer gap is
 *    past `softMs` AND `currentTime` has not advanced. Caller should declare
 *    the stall.
 *
 * Bug ref: docs/_wip/bugs/2026-05-23-fitness-stall-watchdog-noise-and-play-fails-during-real-stall.md §1
 */
export function decideStallVerdict({
  now,
  lastProgressTs,
  softMs,
  currentTime,
  lastObservedCurrentTime,
  progressEpsilon = 0.05
}) {
  if (!Number.isFinite(lastProgressTs) || lastProgressTs <= 0) {
    return { verdict: 'within-window', stallDurationMs: null };
  }
  const gap = now - lastProgressTs;
  if (gap < softMs) {
    return { verdict: 'within-window', stallDurationMs: null };
  }
  // Timer gap exceeded — check currentTime as second opinion.
  if (Number.isFinite(currentTime) && Number.isFinite(lastObservedCurrentTime)) {
    if ((currentTime - lastObservedCurrentTime) >= progressEpsilon) {
      return { verdict: 'progressing', stallDurationMs: null };
    }
  }
  return { verdict: 'stalled', stallDurationMs: gap };
}
```

- [ ] **Step 2: Run test to verify it passes**

```bash
cd /opt/Code/DaylightStation && \
  /opt/Code/DaylightStation/node_modules/.bin/vitest run \
    /opt/Code/DaylightStation/.claude/worktrees/end-of-video-recovery/frontend/src/modules/Player/lib/stallVerdict.test.js
```

Expected: 8/8 pass.

- [ ] **Step 3: Commit**

```bash
cd /opt/Code/DaylightStation/.claude/worktrees/end-of-video-recovery && \
git add frontend/src/modules/Player/lib/stallVerdict.js \
        frontend/src/modules/Player/lib/stallVerdict.test.js && \
git commit -m "feat(player): add decideStallVerdict pure helper for soft-stall decision

Bug 2026-05-23 §1: 53 of 58 playback.stalled events in fitness session
fs_20260523132554 resolved within <=10ms because the soft-stall check
only looked at lastProgressTs (advanced by timeupdate, which is
browser-throttled). The new helper takes currentTime as a second
opinion: if currentTime advanced past progressEpsilon during the
timer-gap window, return verdict 'progressing' and let the caller
fast-forward lastProgressTs instead of declaring a stall.

Pure function, no React, mirrors the lib/atDurationStuck.js +
lib/seekTrace.js + lib/fpsStatsPayload.js pattern.

Wiring into useCommonMediaController.scheduleStallDetection comes
in the next commit.

Bug: docs/_wip/bugs/2026-05-23-fitness-stall-watchdog-noise-and-play-fails-during-real-stall.md"
```

---

### Task 3: Wire `decideStallVerdict` into `useCommonMediaController.scheduleStallDetection`

**Files:**
- Modify: `/opt/Code/DaylightStation/frontend/src/modules/Player/hooks/useCommonMediaController.js`

- [ ] **Step 1: Add `lastObservedCurrentTime` to `stallStateRef` initial shape**

Find the `stallStateRef = useRef({...})` block around line 102. Add `lastObservedCurrentTime: null,` to the object literal — adjacent to `lastProgressTs: 0,`.

```javascript
const stallStateRef = useRef({
  lastProgressTs: 0,
  lastObservedCurrentTime: null,  // NEW — tracks currentTime at last markProgress for stall verdict
  softTimer: null,
  hardTimer: null,
  // … remaining fields unchanged
});
```

- [ ] **Step 2: Update `markProgress` to record `lastObservedCurrentTime`**

Find `markProgress` around line 951. Add the `currentTime` capture:

```javascript
const markProgress = useCallback(() => {
  const s = stallStateRef.current;
  if (s.hasEnded) {
    return;
  }

  const wasStalled = s.isStalled;
  const mediaEl = getMediaEl();
  s.lastProgressTs = Date.now();
  if (mediaEl && Number.isFinite(mediaEl.currentTime)) {
    s.lastObservedCurrentTime = mediaEl.currentTime;
  }

  if (wasStalled) {
    // … existing recovery-resolved log
  }
  // … rest unchanged
});
```

- [ ] **Step 3: Reset `lastObservedCurrentTime` on asset change**

Find the asset-change reset around line 1283 (`stallStateRef.current.hasEnded = false; …`). Add the reset:

```javascript
// Reset ended flag for new media
stallStateRef.current.hasEnded = false;
stallStateRef.current.recoveryAttempt = 0;
stallStateRef.current.atDurationStuckLogged = false;
stallStateRef.current.lastObservedCurrentTime = null;  // NEW
```

- [ ] **Step 4: Import the helper**

At the top of `useCommonMediaController.js`, alongside the existing `lib/` imports:

```javascript
import { decideStallVerdict } from '../lib/stallVerdict.js';
```

- [ ] **Step 5: Consult the verdict in the soft-timer callback**

Find the soft-timer body around line 875:

```javascript
const diff = Date.now() - s.lastProgressTs;

if (diff >= softMs) {
  if (DEBUG_MEDIA) console.log('[Stall] DETECTED (soft)', { diff, softMs, hardMs, mode, currentTime: mediaEl.currentTime, duration: mediaEl.duration, droppedFramePct, quality });
  // Prod telemetry: stall detected
  const logger = getLogger();
  logger.warn('playback.stalled', {
    // …
    stallDurationMs: diff
  });
  s.isStalled = true;
  // …
}
```

Replace it with:

```javascript
const verdict = decideStallVerdict({
  now: Date.now(),
  lastProgressTs: s.lastProgressTs,
  softMs,
  currentTime: mediaEl.currentTime,
  lastObservedCurrentTime: s.lastObservedCurrentTime
});

if (verdict.verdict === 'progressing') {
  // Bug 2026-05-23 §1: timeupdate was starved but currentTime advanced.
  // Fast-forward lastProgressTs so the next soft-timer cycle has a fresh
  // baseline; do NOT log playback.stalled.
  s.lastProgressTs = Date.now();
  s.lastObservedCurrentTime = mediaEl.currentTime;
  s.softTimer = null;
  if (DEBUG_MEDIA) console.log('[Stall] softTimer: progressing (currentTime advanced); fast-forward', { currentTime: mediaEl.currentTime });
  scheduleStallDetection();
  return;
}

if (verdict.verdict === 'stalled') {
  if (DEBUG_MEDIA) console.log('[Stall] DETECTED (soft)', { diff: verdict.stallDurationMs, softMs, hardMs, mode, currentTime: mediaEl.currentTime, duration: mediaEl.duration, droppedFramePct, quality });
  // Prod telemetry: stall detected
  const logger = getLogger();
  logger.warn('playback.stalled', {
    title: meta?.title || meta?.name,
    artist: meta?.artist,
    album: meta?.album,
    grandparentTitle: meta?.grandparentTitle,
    parentTitle: meta?.parentTitle,
    mediaKey: assetId,
    currentTime: mediaEl.currentTime,
    duration: mediaEl.duration,
    stallDurationMs: verdict.stallDurationMs
  });
  s.isStalled = true;
  if (!s.sinceTs) s.sinceTs = Date.now();
  s.status = 'stalled';
  publishStallSnapshot();
  setIsStalled(true);

  if (mode === 'auto') {
    // … existing hardTimer scheduling unchanged
  }
} else {
  // verdict 'within-window' — reschedule
  s.softTimer = null;
  if (DEBUG_MEDIA) console.log('[Stall] softTimer: no stall yet; diff < softMs; reschedule', { diff, softMs });
  scheduleStallDetection();
}
```

- [ ] **Step 6: Run targeted test suite to verify no regressions**

```bash
cd /opt/Code/DaylightStation && \
  /opt/Code/DaylightStation/node_modules/.bin/vitest run \
    /opt/Code/DaylightStation/.claude/worktrees/end-of-video-recovery/frontend/src/modules/Player/lib/ \
    /opt/Code/DaylightStation/.claude/worktrees/end-of-video-recovery/frontend/src/modules/Player/hooks/useMediaResilience.refreshUrl.test.js \
    /opt/Code/DaylightStation/.claude/worktrees/end-of-video-recovery/frontend/src/modules/Player/hooks/useEndOfContentWatchdog.test.jsx
```

Expected: all previously-passing tests still pass.

- [ ] **Step 7: Commit**

```bash
cd /opt/Code/DaylightStation/.claude/worktrees/end-of-video-recovery && \
git add frontend/src/modules/Player/hooks/useCommonMediaController.js && \
git commit -m "fix(player): stall watchdog reads currentTime directly to skip false positives

Bug 2026-05-23 §1: scheduleStallDetection's soft timer consults
decideStallVerdict, which checks if mediaEl.currentTime advanced
during the timer-gap window. If yes (verdict='progressing'),
lastProgressTs is fast-forwarded and no stall is declared — closes
the 91% false-positive rate (53/58 stalls in fs_20260523132554
resolved within <=10ms).

If currentTime did not advance (verdict='stalled'), the existing
playback.stalled log + hardTimer escalation paths run unchanged.
The behavior is conservative: only suppresses the warn when there
is positive evidence of progress; otherwise behaves exactly as
before.

stallStateRef.lastObservedCurrentTime is captured by markProgress
on each timeupdate and reset on asset change alongside hasEnded
and atDurationStuckLogged."
```

---

### Task 4: Test — `decideDashErrorRecovery` helper

**Files:**
- Create: `/opt/Code/DaylightStation/frontend/src/modules/Player/lib/dashErrorRecovery.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { decideDashErrorRecovery } from './dashErrorRecovery.js';

describe('decideDashErrorRecovery', () => {
  it('returns refresh-url for error 27 (segment unavailable) on first attempt', () => {
    const r = decideDashErrorRecovery({ errorCode: 27, attemptsThisMount: 0, maxAttempts: 3 });
    expect(r.action).toBe('refresh-url');
    expect(r.reason).toMatch(/segment/i);
  });

  it('returns refresh-url for error 28 (init segment / manifest unavailable)', () => {
    const r = decideDashErrorRecovery({ errorCode: 28, attemptsThisMount: 0, maxAttempts: 3 });
    expect(r.action).toBe('refresh-url');
    expect(r.reason).toMatch(/init|manifest|header/i);
  });

  it('returns refresh-url at attempt = maxAttempts - 1 (still within budget)', () => {
    const r = decideDashErrorRecovery({ errorCode: 27, attemptsThisMount: 2, maxAttempts: 3 });
    expect(r.action).toBe('refresh-url');
  });

  it('returns ignore at attempt >= maxAttempts (budget exhausted)', () => {
    const r = decideDashErrorRecovery({ errorCode: 27, attemptsThisMount: 3, maxAttempts: 3 });
    expect(r.action).toBe('ignore');
    expect(r.reason).toMatch(/budget|exhaust|max/i);
  });

  it('returns ignore for unrelated dash error codes (decode, network mid-stream)', () => {
    const r = decideDashErrorRecovery({ errorCode: 25, attemptsThisMount: 0, maxAttempts: 3 });
    expect(r.action).toBe('ignore');
    const r2 = decideDashErrorRecovery({ errorCode: 1001, attemptsThisMount: 0, maxAttempts: 3 });
    expect(r2.action).toBe('ignore');
    const r3 = decideDashErrorRecovery({ errorCode: null, attemptsThisMount: 0, maxAttempts: 3 });
    expect(r3.action).toBe('ignore');
  });

  it('default maxAttempts is 3 when omitted', () => {
    const r = decideDashErrorRecovery({ errorCode: 27, attemptsThisMount: 3 });
    expect(r.action).toBe('ignore');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /opt/Code/DaylightStation && \
  /opt/Code/DaylightStation/node_modules/.bin/vitest run \
    /opt/Code/DaylightStation/.claude/worktrees/end-of-video-recovery/frontend/src/modules/Player/lib/dashErrorRecovery.test.js
```

Expected: FAIL with `Failed to resolve import "./dashErrorRecovery.js"`.

---

### Task 5: Implement `decideDashErrorRecovery`

**Files:**
- Create: `/opt/Code/DaylightStation/frontend/src/modules/Player/lib/dashErrorRecovery.js`

- [ ] **Step 1: Write the implementation**

```javascript
/**
 * Pure decision function for dash.js error recovery.
 *
 * In the 2026-05-23 fitness session (`fs_20260523132554`), a Plex
 * transcode session that had been alive 10 minutes pre-workout got
 * reaped by Plex's idle timer. dash.js fired error 27 (segment
 * unavailable) then 28 (init segment / header unavailable) repeatedly.
 * The existing `useMediaResilience.hardReset({ refreshUrl: true })`
 * mechanism — which mutates the <dash-video> `src` so the backend
 * mints a fresh Plex transcode session — exists and is tested, but
 * the dash error handler did not call it. User had to manually close
 * + restart the player.
 *
 * Returns `{ action: 'refresh-url', reason }` for the two specific
 * error codes that signal "the source URL is dead, please re-fetch",
 * up to `maxAttempts` times per mount. All other error codes return
 * `{ action: 'ignore' }` so the existing nudge/seekback/reload pipeline
 * still owns them (those are mid-stream decode/network errors, not
 * source-URL errors).
 *
 * Bug ref: docs/_wip/bugs/2026-05-23-fitness-stall-watchdog-noise-and-play-fails-during-real-stall.md §2
 */

const SEGMENT_UNAVAILABLE = 27;          // dash.js MEDIA_ERR_DECODE or fragment 404
const INIT_OR_MANIFEST_UNAVAILABLE = 28; // dash.js manifest loader / init segment loader

export function decideDashErrorRecovery({ errorCode, attemptsThisMount, maxAttempts = 3 }) {
  if (errorCode !== SEGMENT_UNAVAILABLE && errorCode !== INIT_OR_MANIFEST_UNAVAILABLE) {
    return { action: 'ignore', reason: 'not-a-source-url-error' };
  }
  if (attemptsThisMount >= maxAttempts) {
    return { action: 'ignore', reason: 'refresh-budget-exhausted' };
  }
  const reasonByCode = {
    [SEGMENT_UNAVAILABLE]: 'segment-unavailable',
    [INIT_OR_MANIFEST_UNAVAILABLE]: 'init-or-manifest-unavailable'
  };
  return { action: 'refresh-url', reason: reasonByCode[errorCode] };
}
```

- [ ] **Step 2: Run test to verify it passes**

```bash
cd /opt/Code/DaylightStation && \
  /opt/Code/DaylightStation/node_modules/.bin/vitest run \
    /opt/Code/DaylightStation/.claude/worktrees/end-of-video-recovery/frontend/src/modules/Player/lib/dashErrorRecovery.test.js
```

Expected: 6/6 pass.

- [ ] **Step 3: Commit**

```bash
cd /opt/Code/DaylightStation/.claude/worktrees/end-of-video-recovery && \
git add frontend/src/modules/Player/lib/dashErrorRecovery.js \
        frontend/src/modules/Player/lib/dashErrorRecovery.test.js && \
git commit -m "feat(player): add decideDashErrorRecovery pure helper for source-URL refresh

Bug 2026-05-23 §2: a Plex transcode session aged out 10 minutes
before the fitness workout began. dash.error 27 (segment unavailable)
and 28 (init / manifest unavailable) fired repeatedly; the
hardReset({ refreshUrl: true }) path exists but the dash error
handler never invoked it.

This helper decides: error codes 27 or 28 -> 'refresh-url' (up to
maxAttempts=3 per mount); all other codes -> 'ignore' (the existing
nudge/seekback/reload pipeline owns those).

Wiring into VideoPlayer.jsx api.on('error', ...) comes in the next
commit."
```

---

### Task 6: Wire `decideDashErrorRecovery` into VideoPlayer

**Files:**
- Modify: `/opt/Code/DaylightStation/frontend/src/modules/Player/renderers/VideoPlayer.jsx`

- [ ] **Step 1: Add import alongside existing lib imports**

Find the import block near the top (around line 12). Add:

```javascript
import { decideDashErrorRecovery } from '../lib/dashErrorRecovery.js';
```

- [ ] **Step 2: Add a per-mount attempt counter via useRef**

Near the existing `staleSessionWatchdogRef` declaration (search for `staleSessionWatchdogRef` to find the right block), add:

```javascript
const dashErrorRefreshAttemptsRef = useRef(0);
```

- [ ] **Step 3: Update the dash error handler**

Find `api.on('error', (e) => { ... })` at line 473. Replace the existing handler body with:

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

  // Bug 2026-05-23 §2: source-URL errors (code 27 segment unavailable,
  // 28 manifest/init unavailable) signal a dead Plex transcode session.
  // Escalate to hardReset with refreshUrl so the backend mints a fresh
  // transcode. Capped at 3 attempts per mount.
  const decision = decideDashErrorRecovery({
    errorCode: code,
    attemptsThisMount: dashErrorRefreshAttemptsRef.current,
    maxAttempts: 3
  });
  if (decision.action === 'refresh-url') {
    dashErrorRefreshAttemptsRef.current += 1;
    const innerEl = getMediaEl();
    const seekToSeconds = (innerEl && Number.isFinite(innerEl.currentTime)) ? innerEl.currentTime : 0;
    dashLog.warn('dash.error-recovery', {
      action: 'refresh-url',
      reason: decision.reason,
      attempt: dashErrorRefreshAttemptsRef.current,
      seekToSeconds
    });
    hardReset({ seekToSeconds, refreshUrl: true });
  }
});
```

- [ ] **Step 4: Reset the attempt counter on `src` change**

Find the existing effect that observes `src` changes (search for `containerRef.current?.getAttribute('src')` or similar). Add to the cleanup or in a separate effect:

```javascript
useEffect(() => {
  // New source URL -> reset dash error refresh budget for this mount.
  dashErrorRefreshAttemptsRef.current = 0;
}, [mediaUrl]);
```

(Use whatever the actual `src` prop variable is named — confirm by reading the surrounding code; the import block lists what's accepted as props. If the variable name differs, use the actual prop name. Likely `mediaUrl` based on the file's existing patterns.)

- [ ] **Step 5: Run the dash error helper test plus a broad regression sweep**

```bash
cd /opt/Code/DaylightStation && \
  /opt/Code/DaylightStation/node_modules/.bin/vitest run \
    /opt/Code/DaylightStation/.claude/worktrees/end-of-video-recovery/frontend/src/modules/Player/lib/ \
    /opt/Code/DaylightStation/.claude/worktrees/end-of-video-recovery/frontend/src/modules/Player/hooks/useMediaResilience.refreshUrl.test.js
```

Expected: all green. VideoPlayer.hardReset.test.jsx is a pre-existing baseline failure (dash-video-element unresolvable under jsdom) — confirm it is still the only failure, not a new one from this change.

- [ ] **Step 6: Commit**

```bash
cd /opt/Code/DaylightStation/.claude/worktrees/end-of-video-recovery && \
git add frontend/src/modules/Player/renderers/VideoPlayer.jsx && \
git commit -m "fix(player): escalate dash.error 27/28 into hardReset with refreshUrl

Bug 2026-05-23 §2: when Plex's idle reaper killed the transcode
session the user was about to play, dash.js fired error 27 then
repeatedly error 28. The existing useMediaResilience.hardReset({
refreshUrl: true }) path — which mutates the <dash-video> src so
the backend mints a fresh Plex transcode session — was never reached
from the dash error handler. User had to close + restart.

api.on('error') now consults decideDashErrorRecovery; on
action: 'refresh-url' (codes 27 or 28), invokes hardReset({
seekToSeconds: currentTime, refreshUrl: true }). Capped at 3
attempts per mount via dashErrorRefreshAttemptsRef so a permanently
dead URL cannot infinite-loop. Counter resets on src change."
```

---

### Task 7: Test — `playbackToggleSource` helpers

**Files:**
- Create: `/opt/Code/DaylightStation/frontend/src/modules/Player/lib/playbackToggleSource.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import {
  tagPauseSource,
  tagPlaySource,
  readAndClearPauseSource,
  readAndClearPlaySource
} from './playbackToggleSource.js';

describe('playbackToggleSource helpers', () => {
  it('writes and reads pause source from the media element', () => {
    const el = {};
    tagPauseSource(el, 'recovery-nudge');
    expect(readAndClearPauseSource(el)).toBe('recovery-nudge');
  });

  it('writes and reads play source from the media element', () => {
    const el = {};
    tagPlaySource(el, 'user-keyboard');
    expect(readAndClearPlaySource(el)).toBe('user-keyboard');
  });

  it('returns "dom-event" when no source has been tagged', () => {
    const el = {};
    expect(readAndClearPauseSource(el)).toBe('dom-event');
    expect(readAndClearPlaySource(el)).toBe('dom-event');
  });

  it('clears the tag after read so the next event sees default', () => {
    const el = {};
    tagPauseSource(el, 'controller');
    expect(readAndClearPauseSource(el)).toBe('controller');
    expect(readAndClearPauseSource(el)).toBe('dom-event');
  });

  it('does not throw on null/undefined element', () => {
    expect(() => tagPauseSource(null, 'x')).not.toThrow();
    expect(() => tagPauseSource(undefined, 'x')).not.toThrow();
    expect(readAndClearPauseSource(null)).toBe('dom-event');
    expect(readAndClearPauseSource(undefined)).toBe('dom-event');
  });

  it('coerces non-string source to string', () => {
    const el = {};
    tagPauseSource(el, 42);
    expect(readAndClearPauseSource(el)).toBe('42');
  });

  it('ignores empty string and falls back to default', () => {
    const el = {};
    tagPauseSource(el, '');
    expect(readAndClearPauseSource(el)).toBe('dom-event');
  });

  it('pause and play sources are independent', () => {
    const el = {};
    tagPauseSource(el, 'P');
    tagPlaySource(el, 'Q');
    expect(readAndClearPauseSource(el)).toBe('P');
    expect(readAndClearPlaySource(el)).toBe('Q');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /opt/Code/DaylightStation && \
  /opt/Code/DaylightStation/node_modules/.bin/vitest run \
    /opt/Code/DaylightStation/.claude/worktrees/end-of-video-recovery/frontend/src/modules/Player/lib/playbackToggleSource.test.js
```

Expected: FAIL — module not found.

---

### Task 8: Implement `playbackToggleSource` helpers

**Files:**
- Create: `/opt/Code/DaylightStation/frontend/src/modules/Player/lib/playbackToggleSource.js`

- [ ] **Step 1: Write the implementation**

```javascript
/**
 * Source tagging for `playback.paused` / `playback.resumed` telemetry.
 *
 * In the 2026-05-23 fitness session (`fs_20260523132554`), the media
 * element emitted 8 alternating pause/resume events in 3.4 seconds at
 * the same currentTime. dash.js's internal retry loop and the user's
 * play press were indistinguishable in the log because the controller
 * only listened to the DOM `pause` and `play` events.
 *
 * These helpers mirror the existing `__seekSource` pattern (see
 * `useCommonMediaController.js:382, 1313`): app code that intentionally
 * pauses/plays the element tags the source immediately before the call;
 * the pause/play event handler reads-and-clears the tag and includes the
 * source in the log payload. Untagged calls (dash.js internal retries,
 * browser auto-pause on `waiting`) read as `'dom-event'`.
 *
 * Bug ref: docs/_wip/bugs/2026-05-23-fitness-stall-watchdog-noise-and-play-fails-during-real-stall.md §3
 */

const PAUSE_KEY = '__pauseSource';
const PLAY_KEY = '__playSource';
const DEFAULT_SOURCE = 'dom-event';

const normalize = (value) => {
  if (value === undefined || value === null) return null;
  const str = String(value);
  return str.length > 0 ? str : null;
};

const tag = (el, key, source) => {
  if (!el) return;
  const normalized = normalize(source);
  if (normalized === null) return;
  try {
    el[key] = normalized;
  } catch (_) { /* element rejected the property; swallow */ }
};

const readAndClear = (el, key) => {
  if (!el) return DEFAULT_SOURCE;
  const raw = el[key];
  const normalized = normalize(raw);
  if (normalized === null) return DEFAULT_SOURCE;
  try { delete el[key]; } catch (_) { /* ignore */ }
  return normalized;
};

export function tagPauseSource(el, source) { tag(el, PAUSE_KEY, source); }
export function tagPlaySource(el, source) { tag(el, PLAY_KEY, source); }
export function readAndClearPauseSource(el) { return readAndClear(el, PAUSE_KEY); }
export function readAndClearPlaySource(el) { return readAndClear(el, PLAY_KEY); }
```

- [ ] **Step 2: Run test to verify it passes**

```bash
cd /opt/Code/DaylightStation && \
  /opt/Code/DaylightStation/node_modules/.bin/vitest run \
    /opt/Code/DaylightStation/.claude/worktrees/end-of-video-recovery/frontend/src/modules/Player/lib/playbackToggleSource.test.js
```

Expected: 8/8 pass.

- [ ] **Step 3: Commit**

```bash
cd /opt/Code/DaylightStation/.claude/worktrees/end-of-video-recovery && \
git add frontend/src/modules/Player/lib/playbackToggleSource.js \
        frontend/src/modules/Player/lib/playbackToggleSource.test.js && \
git commit -m "feat(player): add playbackToggleSource helpers for pause/play telemetry

Bug 2026-05-23 §3: pause/play events fired 8 times in 3.4s during the
stuck-transcode incident; could not distinguish user input from
dash.js retry loop because the controller only saw the DOM events.

Mirrors the existing __seekSource pattern from useCommonMediaController.
tagPauseSource/tagPlaySource set a property on the element immediately
before app code calls pause()/play(). readAndClearPauseSource/
readAndClearPlaySource are called by the pause/play event handlers to
consume the tag and default to 'dom-event' (covering dash.js auto-
retries and browser auto-pause)."
```

---

### Task 9: Wire pause/play source into `useCommonMediaController` log handlers + recovery sites

**Files:**
- Modify: `/opt/Code/DaylightStation/frontend/src/modules/Player/hooks/useCommonMediaController.js`

- [ ] **Step 1: Add the import**

Add to the import block at the top:

```javascript
import {
  tagPauseSource,
  tagPlaySource,
  readAndClearPauseSource,
  readAndClearPlaySource
} from '../lib/playbackToggleSource.js';
```

- [ ] **Step 2: Update `onPause` and `onResume` to include source**

Find `onPause` at line 1396. Replace:

```javascript
const onPause = () => {
  const el = getMediaEl();
  if (el && !el.ended) {
    const logger = getLogger();
    logger.info('playback.paused', {
      title: meta?.title || meta?.name,
      artist: meta?.artist,
      album: meta?.album,
      grandparentTitle: meta?.grandparentTitle,
      parentTitle: meta?.parentTitle,
      mediaKey: assetId,
      currentTime: el.currentTime,
      duration: el.duration
    });
  }
};
```

With:

```javascript
const onPause = () => {
  const el = getMediaEl();
  if (el && !el.ended) {
    const source = readAndClearPauseSource(el);
    const logger = getLogger();
    logger.info('playback.paused', {
      title: meta?.title || meta?.name,
      artist: meta?.artist,
      album: meta?.album,
      grandparentTitle: meta?.grandparentTitle,
      parentTitle: meta?.parentTitle,
      mediaKey: assetId,
      currentTime: el.currentTime,
      duration: el.duration,
      source
    });
  }
};
```

Find `onResume` at line 1412. Apply the same pattern: declare `const source = readAndClearPlaySource(el);` before the logger call, and append `source` to the payload.

- [ ] **Step 3: Tag recovery-strategy pause/play call sites**

Find `nudgeRecovery` around line 459. Replace the pause/play block:

```javascript
mediaEl.pause();
mediaEl.currentTime = Math.max(0, t - 0.001);
mediaEl.play().catch(() => {});
```

With:

```javascript
tagPauseSource(mediaEl, 'recovery-nudge');
mediaEl.pause();
mediaEl.currentTime = Math.max(0, t - 0.001);
tagPlaySource(mediaEl, 'recovery-nudge');
mediaEl.play().catch(() => {});
```

Find `reloadRecovery` DASH-path around line 489. Replace:

```javascript
mediaEl.pause();
dashPlayer.reset();
```

With:

```javascript
tagPauseSource(mediaEl, 'recovery-reload-dash');
mediaEl.pause();
dashPlayer.reset();
```

And in the same function, the `mediaEl.play()` at line 521:

```javascript
tagPlaySource(mediaEl, 'recovery-reload-dash');
mediaEl.play().catch(() => {});
```

Find the DOM-path of `reloadRecovery` around line 531:

```javascript
mediaEl.pause();
mediaEl.removeAttribute('src');
mediaEl.load();
```

Replace with:

```javascript
tagPauseSource(mediaEl, 'recovery-reload-dom');
mediaEl.pause();
mediaEl.removeAttribute('src');
mediaEl.load();
```

And the `mediaEl.play()` at line 565:

```javascript
tagPlaySource(mediaEl, 'recovery-reload-dom');
mediaEl.play().catch(() => {});
```

- [ ] **Step 4: Tag the `pause` / `play` methods exposed via the controller API**

Find the `controller` object exported via `onController({ … pause, play, toggle, … })` around line 1669-1683. Update:

```javascript
play: () => {
  const mediaEl = getMediaEl();
  if (mediaEl) {
    tagPlaySource(mediaEl, 'controller');
    mediaEl.play?.();
  }
},
pause: () => {
  const mediaEl = getMediaEl();
  if (mediaEl) {
    tagPauseSource(mediaEl, 'controller');
    mediaEl.pause?.();
  }
},
toggle: () => {
  const mediaEl = getMediaEl();
  if (mediaEl) {
    if (mediaEl.paused) {
      tagPlaySource(mediaEl, 'controller-toggle');
      mediaEl.play?.();
    } else {
      tagPauseSource(mediaEl, 'controller-toggle');
      mediaEl.pause?.();
    }
  }
},
```

- [ ] **Step 5: Run regression sweep**

```bash
cd /opt/Code/DaylightStation && \
  /opt/Code/DaylightStation/node_modules/.bin/vitest run \
    /opt/Code/DaylightStation/.claude/worktrees/end-of-video-recovery/frontend/src/modules/Player/
```

Expected: only VideoPlayer.hardReset.test.jsx fails (pre-existing baseline); all others green.

- [ ] **Step 6: Commit**

```bash
cd /opt/Code/DaylightStation/.claude/worktrees/end-of-video-recovery && \
git add frontend/src/modules/Player/hooks/useCommonMediaController.js && \
git commit -m "feat(player): tag playback.paused/resumed with source for diagnostic clarity

Bug 2026-05-23 §3: log payloads now carry source field, defaulting
to 'dom-event' when nothing tagged the call. Sites that tag explicitly:

  - controller.play / .pause / .toggle  -> 'controller' / 'controller-toggle'
  - nudgeRecovery                       -> 'recovery-nudge'
  - reloadRecovery (DASH path)          -> 'recovery-reload-dash'
  - reloadRecovery (DOM path)           -> 'recovery-reload-dom'

Untagged calls (dash.js internal retries, browser auto-pause on
buffer underrun, native user clicks that bypass the controller)
remain 'dom-event'. Operators can now grep prod logs for
source: 'dom-event' to find the dash.js retry storm signature
seen in fs_20260523132554 between 20:39:14 and 20:39:18."
```

---

### Task 10: Live verification + bug status footer

**Files:**
- Modify: `/opt/Code/DaylightStation/.claude/worktrees/end-of-video-recovery/docs/_wip/bugs/2026-05-23-fitness-stall-watchdog-noise-and-play-fails-during-real-stall.md`

- [ ] **Step 1: Confirm dev server is reachable**

```bash
lsof -i :3112 || echo "dev server NOT running — start with: cd /opt/Code/DaylightStation && nohup node backend/index.js > /tmp/backend-dev.log 2>&1 &"
```

If not running, start it and wait 5 seconds before proceeding.

- [ ] **Step 2: Run the full Player module test sweep one more time**

```bash
cd /opt/Code/DaylightStation && \
  /opt/Code/DaylightStation/node_modules/.bin/vitest run \
    /opt/Code/DaylightStation/.claude/worktrees/end-of-video-recovery/frontend/src/modules/Player/ 2>&1 | tail -8
```

Expected: count + `1 failed` (the pre-existing VideoPlayer.hardReset.test.jsx baseline). Record the total count for the commit message.

- [ ] **Step 3: Live verify the stall-noise reduction**

After deploy, on the next fitness session, run:

```bash
sudo docker exec daylight-station sh -c '
ls -t media/logs/fitness/2026-05-23T*.jsonl | head -1' | xargs -I{} sudo docker exec daylight-station sh -c '
echo "=== {} ==="
grep -c "\"event\":\"playback\\.stalled\"" {}
grep -c "\"event\":\"playback\\.recovery-resolved\"" {}
'
```

Expected: `playback.stalled` count drops from the pre-fix typical 50+/session toward zero (only real stalls remain). `recovery-resolved` count matches the actually-recovered stalls.

- [ ] **Step 4: Live verify the dash-error refresh path**

If a stall caused by transcode-session timeout occurs (or can be reproduced by ssh'ing to Plex and killing the active transcode session for the active fitness item), confirm:

```bash
sudo docker logs daylight-station --since 5m 2>&1 | grep -E "dash\\.error-recovery|playback\\.stream-url-refreshed"
```

Expected: `dash.error-recovery action=refresh-url reason=…` and `playback.stream-url-refreshed` both appear; playback resumes without a manual close+restart.

- [ ] **Step 5: Update the bug doc's status footer**

Append to `docs/_wip/bugs/2026-05-23-fitness-stall-watchdog-noise-and-play-fails-during-real-stall.md`:

```markdown
---

## Status

- **2026-05-23 (filed)** — Bug report and three remediations identified.
- **[date] (landed on `worktree-end-of-video-recovery`)** —
  - **§1 watchdog false positives:** `decideStallVerdict` helper consulted before `playback.stalled` log fires; if `mediaEl.currentTime` advanced past `progressEpsilon` (0.05s) during the timer-gap window, the stall is suppressed and `lastProgressTs` fast-forwards. Expected ~0 false positives in subsequent sessions.
  - **§2 transcode-session timeout:** `decideDashErrorRecovery` routes `dash.error 27` and `dash.error 28` to `hardReset({ refreshUrl: true })`, capped at 3 attempts per mount.
  - **§3 pause/play telemetry gap:** `playback.paused` / `playback.resumed` payloads now carry `source` (defaults to `'dom-event'` for dash.js auto-retries and browser auto-pause; tagged explicitly by `controller.play/pause/toggle`, `nudgeRecovery`, and `reloadRecovery` paths).
- **[date] (verified live)** — first fitness session after deploy: stall count = X, recovery-resolved count = Y, no manual restart needed.

Items intentionally NOT addressed in this fix:
- **§5 — Phantom overlay leak.** Requires deploying `9de00c9b5` to garage container; non-code.
- **§4 — `player-no-source-timeout` race.** Needs a separate reproducer; out of scope.
- **§5 — `fitness.render_thrashing`.** Background contributor to `timeupdate` starvation; root cause needs separate investigation.
```

- [ ] **Step 6: Commit doc update**

```bash
cd /opt/Code/DaylightStation/.claude/worktrees/end-of-video-recovery && \
git add docs/_wip/bugs/2026-05-23-fitness-stall-watchdog-noise-and-play-fails-during-real-stall.md && \
git commit -m "docs(bugs): mark fitness stall + transcode recovery fixes as landed"
```

---

## Self-review

- **Spec coverage:**
  - Bug §1 (watchdog false positives) → Tasks 1-3 (helper + wiring + integration).
  - Bug §2 (transcode session timeout / missing URL refresh) → Tasks 4-6 (helper + wiring + counter reset).
  - Bug §3 (pause/play source diagnostic gap) → Tasks 7-9 (helpers + log wiring + tag known call sites).
  - Bug §4 (`player-no-source-timeout` race) — explicitly deferred in Task 10's status footer; needs separate reproducer.
  - Bug §5.1 (phantom overlay on garage) — explicitly deferred; deploy-only, no code.
  - Bug §5.2 (render thrashing) — explicitly deferred; separate root-cause investigation.

- **Placeholder scan:** No TBDs. Every code step shows actual code. Test stubs match the existing vitest pattern in the same directory (`lib/atDurationStuck.test.js`, `lib/seekTrace.test.js`, etc.).

- **Type consistency:**
  - `decideStallVerdict` return shape `{ verdict, stallDurationMs }` consistent across Tasks 1 and 3.
  - `decideDashErrorRecovery` return shape `{ action, reason }` consistent across Tasks 4 and 6.
  - `playbackToggleSource` exports the same four function names in Tasks 7, 8, 9.
  - `stallStateRef.lastObservedCurrentTime` declared in Task 3 Step 1 and consumed in Task 3 Step 5; reset in Task 3 Step 3.

- **Independence:** Tasks 1-3 (watchdog), Tasks 4-6 (dash error), Tasks 7-9 (telemetry) are independent — they can land in any order without conflicting. The bug doc footer (Task 10) depends on all three.

---

Plan complete and saved to `docs/superpowers/plans/2026-05-23-fitness-stall-noise-and-transcode-recovery.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
