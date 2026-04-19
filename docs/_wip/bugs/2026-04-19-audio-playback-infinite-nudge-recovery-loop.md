# Bug: Audio Playback Stuck in Infinite Nudge Recovery Loop (Pipeline Never Escalates)

**Date:** 2026-04-19
**Severity:** Critical
**Component:** Frontend / Player Resilience (`useCommonMediaController`)
**Status:** Open
**Device:** livingroom / office client (Linux x86_64 Chrome 145)
**Related:** `2026-02-28-playback-stall-recovery-reuses-broken-session.md` (DASH video; fixed) — this is the audio analogue with a different failure mode

---

## Summary

When an audio track stalls shortly after `playback.started`, the resilience system detects the stall and fires the `nudge` recovery strategy — but the 1 ms `currentTime` rewind performed by `nudge` triggers a `timeupdate` event that `markProgress()` misinterprets as real playback progress. This:

1. Emits a spurious `playback.recovery-resolved` event.
2. Resets `recoveryAttempt = 0` and clears `strategyCounts`.
3. Prevents the pipeline from ever escalating past `nudge` → `seekback` → `reload` → `softReinit`.

The net effect is an infinite `stalled → nudge → "resumed" → stalled → nudge → ...` loop where the reported `currentTime` actually drifts **backward** by ~1 ms per cycle, every ~7 seconds, forever. The user hears silence. Nothing recovers the track short of a manual skip/reload.

---

## Evidence from Production Logs (2026-04-19 18:29 UTC)

### Media

```
Track:     Shining Smile — 이루마 (Oasis & Yiruma)
mediaKey:  plex:545075
mediaType: audio
duration:  180.276333s
Queue:     contentId plex:545064 (209 tracks, source: menu-selection)
Client:    Chrome 145 / Linux x86_64, ip 172.18.0.49
```

### Timeline

| Wall time | Event | currentTime | Note |
|-----------|-------|-------------|------|
| `18:29:09.027` | `playback.intent` | n/a | User selects queue from menu |
| `18:29:09.565` | `playback.started` | 0.0 | Audio element ready, play() called |
| `18:29:11.166` | `playback.stalled` (1.3s dur) | 0.02322 | No progress for 1.3s — **stream never actually began** |
| `18:29:17.967` | `playback.recovery-strategy` (nudge, attempt 1, success) | 0.02222 | `currentTime = t - 0.001` |
| `18:29:17.968` | `playback.seek seeking→seeked` | 0.02222 | Nudge's seek surfaces as seek event |
| `18:29:17.968` | `playback.recovery-resolved` (stallDur 6.8s) | 0.02222 | **False resolve — markProgress fired from seek-induced timeupdate** |
| `18:29:17.968` | `playback.resumed` | 0.02222 | Reported as normal resume |
| `18:29:19.568` | `playback.stalled` (1.6s dur) | 0.02222 | Loop iteration 2 begins |
| `18:29:26.371` | `playback.recovery-strategy` (nudge, **attempt 1 again**) | 0.02122 | Counter reset — nothing escalates |
| `18:29:26.371` | `playback.recovery-resolved` | 0.02122 | " |
| `18:29:34.774` | nudge → "resumed" | 0.02022 | Iteration 3 |
| `18:29:43.175` | nudge → "resumed" | 0.019219 | Iteration 4 |
| `18:29:51.578` | nudge → "resumed" | 0.018219 | Iteration 5 — loop continues indefinitely |

Key indicator: `currentTime` **monotonically decreases** (0.02322 → 0.02222 → 0.02122 → 0.02022 → 0.019219 → 0.018219). Real playback only moves forward. This drift is the 1 ms nudge repeatedly subtracting from a playhead that never actually advances.

### Key Log Entries

```json
{"event":"playback.recovery-strategy","data":{
  "strategy":"nudge","attempt":1,"success":true,
  "currentTime":0.02222,"lastSeekIntent":0,
  "totalAttempts":0,"pipelineLength":2
}}
```

`totalAttempts: 0` and `attempt: 1` on **every** iteration — the recovery pipeline state is being reset between iterations. The pipeline length is 2 (`['nudge', 'reload']`), so after the counter resets, the system can never reach the second strategy.

---

## Root Cause

Two co-located flaws in `frontend/src/modules/Player/hooks/useCommonMediaController.js`:

### 1. `nudge` produces a `timeupdate` that is identical to real progress

**File:** `frontend/src/modules/Player/hooks/useCommonMediaController.js`
**Lines:** 400–432 (`nudgeRecovery`)

```javascript
const nudgeRecovery = useCallback(() => {
  const mediaEl = getMediaEl();
  // ...buffered-range check...
  mediaEl.pause();
  mediaEl.currentTime = Math.max(0, t - 0.001);  // ← seek mutation
  mediaEl.play().catch(() => {});
  return true;
}, [getMediaEl]);
```

Setting `currentTime` issues a seek, which — after `seeking` and `seeked` events — fires a `timeupdate`. That `timeupdate` is indistinguishable from real playback progress.

### 2. `markProgress` treats *any* `timeupdate` as recovery success

**File:** `frontend/src/modules/Player/hooks/useCommonMediaController.js`
**Lines:** 903–941 (`markProgress`), 962–970 (`onTimeUpdate`)

```javascript
const markProgress = useCallback(() => {
  const s = stallStateRef.current;
  if (s.hasEnded) return;

  const wasStalled = s.isStalled;
  s.lastProgressTs = Date.now();

  if (wasStalled) {
    mcLog().info('playback.recovery-resolved', { ... });
    s.isStalled = false;
    s.recoveryAttempt = 0;            // ← resets pipeline position
    s.strategyCounts = Object.create(null);  // ← resets per-strategy attempts
    s.activeStrategy = null;
    // ...
  }
}, [...]);

const onTimeUpdate = () => {
  // ...
  markProgress();  // ← called on EVERY timeupdate, including seek-induced ones
  // ...
};
```

The hook never compares the new `currentTime` to the position when the stall began. It accepts any `timeupdate` as "we resumed". Because the nudge produces a `timeupdate` at the same instant it attempts recovery, the pipeline resets before it has a chance to advance.

### Why `nudge`'s buffered-range guard doesn't save us

`nudgeRecovery` (line 419) *does* return false and log `outside-buffered-range` when the playhead isn't in a buffered range. In this incident the playhead **is** within a buffered range (the small header bytes that arrived with the HTML5 audio element) — the stream simply isn't progressing past those initial bytes. So the guard passes, and nudge "succeeds" cosmetically.

---

## Why the stream was stuck in the first place

Not fully confirmed from logs, but probable causes:

- Plex transcode session returned opening header bytes and then stalled (no audio MP3/Opus frames following).
- Network path between Plex and the client stalled after metadata probe.
- Audio element decoded 20 ms of silence from the header and had no further decodable frames.

This is a **legitimate** external failure that the recovery pipeline should handle. The bug is not that the stream stalled — it's that the pipeline cannot escalate past `nudge`, so the stream never gets a chance to be reloaded with a fresh URL (which is exactly what fixes the DASH case in the 2026-02-28 bug).

---

## Why the 2026-02-28 Fix Doesn't Help Here

The 2026-02-28 fix addressed a different layer: **when the player remounts for recovery, don't take the direct-play bypass — call `/play` to mint a fresh transcode session.**

That fix only runs if the pipeline reaches a `reload` or `softReinit` strategy that causes a remount. In this incident the pipeline never escalates past `nudge`, so no remount, so the fix's entry condition never fires. The audio Plex session may or may not still be valid — we never find out.

---

## Proposed Fix

### Minimum: `markProgress` must verify *actual* playhead advancement

Change `markProgress` to require monotonic forward progress past the position at which the stall began, not just any `timeupdate`:

```javascript
const markProgress = useCallback(() => {
  const s = stallStateRef.current;
  if (s.hasEnded) return;

  const mediaEl = getMediaEl();
  const currentTime = mediaEl?.currentTime;

  const wasStalled = s.isStalled;
  s.lastProgressTs = Date.now();

  if (wasStalled) {
    // Require meaningful forward progress past the position where we stalled.
    // A seek-induced timeupdate from a nudge will have currentTime <= stallStartPlayhead,
    // so it won't count as recovery.
    const stallStart = s.stallStartPlayhead;
    if (
      stallStart == null ||
      (Number.isFinite(currentTime) && currentTime > stallStart + 0.05)
    ) {
      mcLog().info('playback.recovery-resolved', { ... });
      s.isStalled = false;
      s.recoveryAttempt = 0;
      s.strategyCounts = Object.create(null);
      // ... rest of reset
    }
    // else: not real progress, keep counters so the pipeline can escalate
  }
}, [...]);
```

The state ref needs a new field `stallStartPlayhead` set when `isStalled` first becomes true (in `scheduleStallDetection`'s soft-timer callback, around line 844).

### Belt-and-braces: let `nudge` suppress its own `timeupdate`

Track a short-lived "synthetic seek" flag that `onTimeUpdate` checks:

```javascript
const suppressProgressUntilRef = useRef(0);

// In nudgeRecovery, right before mutating currentTime:
suppressProgressUntilRef.current = Date.now() + 250;

// In onTimeUpdate:
if (Date.now() < suppressProgressUntilRef.current) {
  // skip markProgress — this timeupdate was caused by our own seek
  return;
}
```

Either approach alone fixes the loop. Both together are defensive.

### Pipeline length fix (secondary)

`DEFAULT_STRATEGY_PIPELINE` in the hook (line 14) has 4 entries, but the destructured default for the actual config (line 150) is `['nudge', 'reload']` — only 2. So even with the progress fix, audio would only ever try nudge once and reload once. Consider:

- Either make the destructured default match `DEFAULT_STRATEGY_PIPELINE`.
- Or pass `stallConfig.recoveryStrategies: DEFAULT_STRATEGY_PIPELINE` at call sites that need the full pipeline.

This isn't the root cause of the loop (the loop exists even with a 2-step pipeline) but fixing it makes recovery more robust once progress detection is correct.

---

## Affected Code

| File | Lines | Role |
|------|-------|------|
| `frontend/src/modules/Player/hooks/useCommonMediaController.js` | 14–19 | `DEFAULT_STRATEGY_PIPELINE` (4 steps — unused by default) |
| `frontend/src/modules/Player/hooks/useCommonMediaController.js` | 150 | Destructure default `['nudge', 'reload']` (actual default) |
| `frontend/src/modules/Player/hooks/useCommonMediaController.js` | 400–432 | `nudgeRecovery` — sets currentTime, triggers timeupdate |
| `frontend/src/modules/Player/hooks/useCommonMediaController.js` | 833–847 | Stall detection — sets `isStalled`, needs to record `stallStartPlayhead` |
| `frontend/src/modules/Player/hooks/useCommonMediaController.js` | 903–941 | `markProgress` — **treats any timeupdate as recovery** (bug) |
| `frontend/src/modules/Player/hooks/useCommonMediaController.js` | 962–970 | `onTimeUpdate` — unconditionally calls `markProgress` |
| `frontend/src/modules/Player/hooks/useCommonMediaController.js` | 744–755 | `recovery-strategy` log emission (evidence) |
| `frontend/src/modules/Player/hooks/useCommonMediaController.js` | 915–923 | `recovery-resolved` log emission (false positive) |

---

## Repro Steps

1. Queue any Plex audio track on a screen-player client.
2. Simulate upstream stall after the first few bytes (e.g. `tc` rule to drop traffic to Plex transcoder mid-stream, or kill the Plex transcode session server-side immediately after `/play` returns).
3. Observe logs: expect `playback.stalled` → escalating strategies (`nudge` → `reload` → `softReinit`) → terminal failure or genuine recovery.
4. **Actual:** `playback.stalled` → `nudge (attempt 1) → recovery-resolved` forever. `currentTime` drifts backward by ~1 ms per cycle. No audio.

---

## Verification After Fix

- `playback.recovery-resolved` must only fire when `currentTime` has advanced meaningfully past `stallStartPlayhead` (e.g., +50 ms).
- `playback.recovery-strategy` `attempt` value must increment across successive iterations of an unresolved stall.
- After nudge fails twice (`attempt` 1 and 2), the pipeline must escalate to `reload` (and, if configured, `softReinit`).
- For audio specifically, `reload` must mint a fresh Plex session — verify via a new `X-Plex-Session-Identifier` query param in the network tab after recovery.
- Manual test: kill Plex stream mid-play; pipeline should reach terminal failure or recover within ~45 s, not loop forever.

---

## Impact

- **Severity: Critical.** Affects every audio queue started on a client with a flaky Plex transcode start — which happens several times a week based on history.
- **User experience:** silent playback, queue appears active, no visible error, no auto-advance. User must manually press skip or reload.
- **Diagnostic noise:** logs are flooded with `playback.recovery-resolved` / `playback.resumed` events that are lies. Hard to triage other issues around audio.
- **Cross-device:** applies to any surface using `useCommonMediaController` for audio (livingroom-tv, office-tv, FitnessApp music, kiosk music). Not specific to livingroom-tv.
