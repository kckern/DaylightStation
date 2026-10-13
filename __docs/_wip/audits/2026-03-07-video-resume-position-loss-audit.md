# Video Resume Position Loss — Audit

**Date:** 2026-03-07
**Severity:** Critical (data loss — user lost playback position in a 4.6-hour video)
**Session log:** `media/logs/fitness/2026-03-07T02-49-24.jsonl`
**Video:** Mario Kart 8 Deluxe (`plex:649319`, duration=16725s / ~4.6 hours)
**Saved resume position:** ~4813s (~80 minutes in)

---

## Summary

A fitness session video failed to maintain its resume position through a stall-recovery cycle. The video was supposed to resume at ~80 minutes into a 4.6-hour recording. Instead, stall recovery caused a cascade: nudge → seekback → reload → softReinit, during which `currentTime` reset to 0, `duration` became `null`, and after three full reload cycles, the video briefly played from 0:00 before finally recovering its position ~13 minutes after session start.

**User impact:** 13 minutes of broken playback during an active workout session. The video started from the beginning of a very long recording — effectively losing the user's place in content they'd been watching across multiple sessions.

---

## Timeline (from structured logs)

| Time (UTC) | Event | `currentTime` | `duration` | Analysis |
|---|---|---|---|---|
| 02:49:31.034 | `started` | **0** | 16725 | Video loads at t=0, not at resume position |
| 02:49:31.095 | `paused` | 0.04 | 16725 | Immediately paused (governance lock?) |
| 02:49:32.044 | `resumed` | 0.04 | 16725 | Brief resume |
| 02:49:32.101 | `paused` | 0.09 | 16725 | Paused again after 57ms |
| **02:50:59.768** | `resumed` | **4813.28** | 16725 | **~88s later**, seek to saved position finally completes |
| 02:51:07.910 | `paused` | 4821.35 | 16725 | Normal playback for ~8s, then pause |
| 02:57:09.342 | `resumed` | 4821.35 | 16725 | ~6 min pause (governance lock phase), then resume |
| 02:58:06.781 | **`stalled`** | 4876.9 | 16725 | **Stall detected** — playback stuck at ~81:17 |
| 02:58:13–:45 | pause/resume thrashing | ~4876.9 | 16725 | **6 stall events, 8s apart.** Nudge recovery in action — currentTime decreasing by 0.001s each cycle |
| **02:58:47.850** | `resumed` | **0** | **null** | **POSITION LOST.** currentTime=0, duration gone |
| 02:58:48.037 | `resumed` | 0 | null | Still at zero |
| 02:58:49.051 | `stalled` | 0 | null | Stalled at t=0 with no duration |
| 02:58:55–02:59:35 | thrashing | ~4935–4972 | **null** | Erratic positions, duration still null |
| **03:00:41.140** | `started` | **0** | 16725 | **2nd full reload.** Back at zero but duration recovered |
| 03:00:59.939 | `stalled` | **9533.27** | 16725 | Jumped to wrong position (2h38m — not resume point!) |
| 03:01:32–:50 | thrashing | 4816.8 | 16725 | **10 pause/resume cycles in 18s** (~200ms intervals). Stuck. |
| **03:01:57.992** | `started` | **0** | 16725 | **3rd full reload.** Position lost again |
| 03:01:58–03:02:00 | paused at zero | 0.037–0.079 | 16725 | Playing from the beginning |
| 03:02:34.481 | `resumed` | 0.079 | 16725 | **Playing from start of 4.6-hour video** |
| **03:04:27.508** | `paused` | **4912.97** | 16725 | ~2 min later, finally seeks to ~82 min mark |
| 03:04:49+ | normal play | 4912→6139 | 16725 | **Stable for remainder of session (~27 min)** |

---

## Root Cause Analysis

### Bug 1: Initial load starts at t=0 despite saved resume position (88s delay)

**Code:** `useCommonMediaController.js:865-954`

The start time application logic has a DASH-specific code path (lines 923-948):

```javascript
if (Number.isFinite(startTime) && startTime > 0 && isDash) {
  const streamSrc = containerRef.current?.getAttribute?.('src') || meta.mediaUrl || '';
  const hasServerOffset = /[?&]offset=/.test(streamSrc);
  if (hasServerOffset) {
    // Server-side offset — skip client seek
  } else {
    // Deferred seek: wait for first timeupdate with currentTime > 0.5
    const onTimeUpdate = () => {
      if (mediaEl.currentTime < 0.5) return;
      mediaEl.removeEventListener('timeupdate', onTimeUpdate);
      try {
        if (container?.api?.seek) {
          container.api.seek(startTime);
        } else {
          mediaEl.currentTime = startTime;
        }
      } catch (_) {}
    };
    mediaEl.addEventListener('timeupdate', onTimeUpdate);
  }
}
```

**Problem:** For DASH streams without a server-side `?offset=` parameter, the seek is deferred until `currentTime > 0.5`. This means:
1. Video starts playing from t=0
2. User sees wrong content for up to 88 seconds
3. The `playback.started` event logs `currentTime: 0` — misleading

**Evidence:** The log shows `playback.started` at t=0 (02:49:31), then the first resume at 4813s doesn't occur until 02:50:59 — an **88-second gap** where the video played from the beginning.

### Bug 2: Nudge recovery creates a stall-nudge death loop

**Code:** `useCommonMediaController.js:380-393` (nudge strategy)

```javascript
const nudgeRecovery = useCallback((_options = {}) => {
  const mediaEl = getMediaEl();
  try {
    const t = mediaEl.currentTime;
    mediaEl.pause();
    mediaEl.currentTime = Math.max(0, t - 0.001);
    mediaEl.play().catch(() => {});
    return true;
  } catch (_) {
    return false;
  }
}, [getMediaEl]);
```

**Problem:** Nudge moves currentTime back by 0.001s, then calls `play()`. If the underlying buffer is exhausted (the reason for the stall), this doesn't help — it just triggers another pause/resume cycle. The stall detector sees the pause event, re-checks, finds no progress, and nudges again.

**Evidence:** Six stall events between 02:58:06 and 02:58:46, each with currentTime decreasing by exactly 0.001s:
```
4876.909041 → 4876.908041 → 4876.907041 → 4876.906041 → 4876.905041 → 4876.904041
```

This is the `nudge` strategy being applied repeatedly (maxAttempts=2, but it fires more via rescheduling).

### Bug 3: Reload recovery drops position to zero and loses duration

**Code:** `useCommonMediaController.js:396-443` (reload strategy)

```javascript
const reloadRecovery = useCallback((options = {}) => {
  const priorTime = lastSeekIntentRef.current !== null
    ? lastSeekIntentRef.current
    : (mediaEl.currentTime || 0);

  isRecoveringRef.current = true;

  mediaEl.pause();
  mediaEl.removeAttribute('src');
  mediaEl.load();

  setTimeout(() => {
    if (src) mediaEl.setAttribute('src', src);
    mediaEl.load();
    mediaEl.addEventListener('loadedmetadata', function handleOnce() {
      const target = Math.max(0, priorTime - seekBackSeconds);
      mediaEl.currentTime = target;
      mediaEl.play().catch(() => {});
      isRecoveringRef.current = false;
      lastSeekIntentRef.current = null;  // ← CLEARS THE SAFETY NET
    }, { once: true });
  }, 50);
}, [getMediaEl, seekBackOnReload]);
```

**Problems:**
1. **`removeAttribute('src')` + `load()`** tears down the media pipeline entirely. For DASH streams, this destroys the SourceBuffer and manifest state. The 50ms `setTimeout` before re-attaching the src is a race condition — if the DASH player hasn't fully torn down, re-initialization may fail.

2. **`lastSeekIntentRef.current = null`** is cleared after the `loadedmetadata` handler fires. But if the seek to `target` fails silently (DASH SourceBuffer not ready), there's no position safety net left. The next `loadedmetadata` event (from a subsequent recovery) finds no seek intent and falls through to the sticky-resume logic (line 900-916), which may also fail if `lastPlaybackPosRef` was corrupted.

3. **`isRecoveringRef.current = false`** is set immediately after the seek attempt, not after confirming the seek succeeded. If `mediaEl.currentTime = target` throws or is ignored by the DASH player, the system thinks recovery is complete but the video is at t=0.

**Evidence:** At 02:58:47, after reload recovery completes, `currentTime=0` and `duration=null`. The reload destroyed the DASH manifest state, and the re-initialization failed to restore it. Duration being `null` proves the media element has no loaded source.

### Bug 4: softReinit triggers full remount but `__appliedStartByKey` blocks re-application of start time

**Code:** `useCommonMediaController.js:460-521` (softReinit) and `867-868` (guard)

```javascript
// softReinit increments elementKey, causing React remount:
setElementKey((prev) => prev + 1);
lastSeekIntentRef.current = targetTime;

// But on the new mount, the guard blocks start time:
const hasAppliedForKey = !!useCommonMediaController.__appliedStartByKey[assetId];
const isEffectiveInitial = isInitialLoadRef.current && !isRecoveringRef.current && !hasAppliedForKey;
// hasAppliedForKey is TRUE (set during original load)
// isEffectiveInitial is FALSE → startTime = 0
```

**Problem:** `softReinit` sets `lastSeekIntentRef.current = targetTime` and `__lastSeekByKey[assetId] = targetTime` as its position preservation mechanism. But these are stored on the old hook instance. When `setElementKey` triggers a React remount, a **new** hook instance is created. The `__lastSeekByKey` survives (it's on the function object), but:

1. `isRecoveringRef.current` is `false` on the new instance (fresh `useRef(false)`)
2. `isInitialLoadRef.current` is `true` on the new instance (fresh `useRef(true)`)
3. `__appliedStartByKey[assetId]` is `true` from the first load

So the guard at line 868 evaluates: `isEffectiveInitial = true && !false && !true = false`. Start time is skipped. The code falls through to the sticky-resume block (lines 899-916), which checks `__lastSeekByKey[assetId]`. This *should* work, but only if `lastProgressTs` is recent enough (within 15s) or the sticky value is > 5.

**Evidence:** The 3rd `playback.started` at 03:01:57 shows `currentTime=0`. The video plays from the beginning for ~2 minutes before finally seeking to 4912s at 03:04:27. The sticky-resume did eventually fire, but not until 2 minutes of playing wrong content.

### Bug 5: Position jump to wrong location during recovery

**Evidence:** At 03:00:59, a stall is detected at `currentTime=9533.27` (2h38m). This is **not** the resume position (~4813s / 80m) and not where playback was last seen (~4876s / 81m). This suggests the DASH player's internal position tracking diverged from the HTML5 media element's `currentTime` during the recovery cycle.

**Likely cause:** After reload recovery re-attaches the src and calls `mediaEl.currentTime = target`, the DASH player may seek to the segment boundary nearest to the target, not the exact target. If the DASH manifest segments are large, the actual position could be significantly different. The `9533s` value suggests the DASH player seeked to a segment ~2.6 hours in — completely wrong.

---

## Failure Chain Summary

```
Normal playback at ~4876s
        ↓
Stall detected (buffer exhaustion at segment boundary?)
        ↓
Nudge recovery × 6 (0.001s backward each time — ineffective)
        ↓
Seekback recovery (5s backward — still in empty buffer zone)
        ↓
Reload recovery (src removal + reattach)
        ↓
DASH player state destroyed, duration → null, currentTime → 0
        ↓
softReinit (React remount via elementKey++)
        ↓
__appliedStartByKey blocks start time → starts at t=0
        ↓
Sticky resume eventually fires → seeks to ~4935s (stale/wrong value)
        ↓
Another stall at wrong position → 2nd reload cycle
        ↓
playback.started at t=0 AGAIN → plays wrong content for 2 minutes
        ↓
3rd reload → eventually recovers to ~4912s after 13 min total
```

---

## Bugs to Fix (Priority Order)

### P0: Reload recovery must not clear position safety net before confirming seek

**File:** `useCommonMediaController.js:396-443`

`lastSeekIntentRef.current = null` (line 427) is cleared immediately after `mediaEl.currentTime = target`, but this assignment may silently fail for DASH streams. The seek intent should only be cleared after a `seeked` event confirms the position change.

### P0: `__appliedStartByKey` must be cleared on softReinit

**File:** `useCommonMediaController.js:513-516`

`softReinit` increments `elementKey` to force remount but doesn't clear `__appliedStartByKey[assetId]`. The new instance treats the recovery remount as a non-initial load and skips start time application. Add:
```javascript
delete useCommonMediaController.__appliedStartByKey[assetId];
```

### P1: Reload recovery is unsafe for DASH streams

**File:** `useCommonMediaController.js:409-412`

`removeAttribute('src')` + `load()` destroys the DASH SourceBuffer and manifest state. For DASH streams, reload should use the DASH player's own reset/reinit API (similar to how `softReinit` calls `dashjsPlayer.reset()`), not raw DOM manipulation that bypasses the DASH player entirely.

### P1: Nudge recovery is counterproductive for buffer exhaustion stalls

**File:** `useCommonMediaController.js:380-393`

Moving backward by 0.001s when the buffer is empty at that position will never help. The nudge strategy should check `mediaEl.buffered` ranges and skip to the nearest buffered boundary instead of blindly nudging backward.

### P2: Initial DASH load should not play from t=0 while waiting for deferred seek

**File:** `useCommonMediaController.js:935-947`

The deferred seek waits for `currentTime > 0.5` before seeking. During this time, the video plays audibly/visibly from t=0. The video should be muted and hidden (or paused) until the deferred seek completes, or better: request the stream with `?offset=` server-side to avoid client-side seeking entirely.

### P2: Recovery position should be validated against known-good range

No code validates that a recovery seek target is plausible. The jump to `9533s` (2h38m) went undetected. After recovery, `currentTime` should be checked against `lastPlaybackPosRef.current ± tolerance` and flagged/rejected if wildly off.

---

## Systemic Issues

### 1. Recovery strategies are browser-centric, not DASH-aware

The entire stall recovery pipeline (`nudge`, `seekback`, `reload`, `softReinit`) operates on the raw `<video>` element. DASH streaming has its own player instance (`dashjsPlayer` / Shaka) that manages SourceBuffers, manifest fetching, and segment loading. Operating on the `<video>` element directly bypasses the DASH player's internal state machine, causing state divergence (video element says one thing, DASH player thinks another).

### 2. No position checkpoint / watchdog

There's no mechanism that periodically verifies `currentTime` is near the expected position. The system trusts that recovery succeeded based on the *attempt*, not the *outcome*. A simple watchdog that checks `|currentTime - expectedTime| < threshold` after each recovery would catch position corruption immediately.

### 3. Duration loss is not treated as a critical signal

`duration` becoming `null`/`NaN` means the media source is in a broken state. The recovery system should treat this as an immediate escalation signal (skip nudge/seekback, go straight to softReinit), not continue with strategies designed for buffering stalls.

---

## Related Prior Audits

| Audit | Relevance |
|-------|-----------|
| `2026-02-27-video-playback-failure-audit.md` | Same DASH recovery code path; documented `seeked` at t=0 terminal state and SourceBuffer orphan accumulation |
| `2026-03-02-fitness-media-title-loss-audit.md` | Metadata loss during recovery cycles; same pattern of `media_start` being dropped |
| `2026-03-05-media-player-ux-design-audit.md` | Documented infinite seek-retry loop (200+ retries); same nudge death loop pattern |
| `2026-03-06-fitness-session-data-loss.md` | Session data loss from silent save failures; related observability gap |

---

## Recommendations

1. **Immediate:** Add `delete __appliedStartByKey[assetId]` to `softReinit` recovery path
2. **Immediate:** Don't clear `lastSeekIntentRef` until `seeked` event confirms position
3. **Short-term:** Make reload recovery DASH-aware (use player API, not DOM manipulation)
4. **Short-term:** Add position watchdog that fires 2s after each recovery to verify outcome
5. **Medium-term:** Request DASH streams with `?offset=` to avoid client-side seeking on initial load
6. **Medium-term:** Treat `duration=null` as critical signal requiring immediate escalation to softReinit
