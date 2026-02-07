# Fitness Telemetry Gap Remediation Plan
**Date**: 2026-02-06  
**Session Analyzed**: `20260206182302` (Feb 6 session, 18:25–18:50 UTC)  
**Log File**: `logs/2026-02-06-session-18-23-to-18-50.json` (448 entries)  
**Related Report**: `2026-01-30-fitness-session-bugbash-report.md`

---

## Executive Summary

User reports from the Feb 6 session included three complaints:

1. **Trouble seeking video** — erratic playhead positions visible in `play.log` (53% → 50% → 47% → 30% → 37% → 30% in 70 seconds)
2. **Poor FPS quality** — users perceived choppy playback
3. **Zone color lag** — governance warning screen appeared while offender chip still showed green/blue

We could only partially confirm #1 via backend `play.log` inference. We could **not confirm** #2 or #3 because the frontend telemetry has three critical gaps that eliminate the evidence we need.

### Gap Severity Matrix

| Gap | Severity | Impact | Fix Complexity | Priority |
|-----|----------|--------|----------------|----------|
| 1. Seek logging disabled | Critical | Zero seek telemetry in prod | Trivial | P0 |
| 2. FPS sampling fragile | High | Missing FPS data in profiles | Low | P1 |
| 3. No governance→render latency | High | Cannot diagnose zone color lag | Medium | P1 |

---

## Gap 1: `DEBUG_FITNESS_INTERACTIONS = false` Kills All Seek Logging

### Problem

In `frontend/src/modules/Fitness/FitnessPlayer.jsx` line 22:

```js
const DEBUG_FITNESS_INTERACTIONS = false;
```

This gates `logFitnessEvent()` (line 578), which is the **sole logger** for:
- Arrow key seeks (`ArrowLeft`/`ArrowRight` — lines 605–655)
- Touch/pointer seeks (`handleSeek` — line 785)
- Fullscreen toggles
- All video player interaction telemetry

With this `false`, the function early-returns before calling `playbackLog()`, so **zero interaction events** reach the frontend→backend log pipeline. This means:
- We cannot confirm or deny seek issues
- We cannot see how users interact with the player
- We have no evidence of whether seeks failed, were blocked by governance, or succeeded

### Evidence of Damage

The only seek evidence available is from backend `play.log.request_received` events (10-second intervals), where we inferred erratic seeking from position jumps:

| Time (UTC)   | Playhead (s) | Percent | Delta from prev |
|--------------|-------------|---------|-----------------|
| 18:25:16     | 3164        | 53.0%   | —               |
| 18:25:26     | 2993        | 50.1%   | **−171s**       |
| 18:25:36     | 2812        | 47.1%   | **−181s**       |
| 18:25:46     | 1795        | 30.1%   | **−1017s**      |
| 18:26:12     | 2210        | 37.0%   | **+415s**       |
| 18:26:28     | 1792        | 30.0%   | **−418s**       |

This shows chaotic seeking but gives us no insight into *what the user did* — arrow keys? touch? drag? swipe? blocked by governance? failed silently?

### Remediation

**Option A (recommended): Replace boolean gate with sampled production logging.**

Remove the `DEBUG_FITNESS_INTERACTIONS` guard entirely. Replace `logFitnessEvent()` with rate-limited production-safe logging using the existing `logger.sampled()` pattern from GovernanceEngine:

```js
// BEFORE (line 577–593)
const logFitnessEvent = useCallback((event, details = {}, options = {}) => {
    if (!DEBUG_FITNESS_INTERACTIONS) return;
    ...
    playbackLog('fitness-player', { event, ...restDetails }, { ... });
}, [fitnessLogContext]);

// AFTER
const logFitnessEvent = useCallback((event, details = {}, options = {}) => {
    const { level: detailLevel, ...restDetails } = details || {};
    const resolvedOptions = typeof options === 'object' && options !== null ? options : {};
    getLogger().sampled(`fitness.player.${event}`, {
      ...restDetails,
      ...fitnessLogContext
    }, { maxPerMinute: 20 });
}, [fitnessLogContext]);
```

This gives us seek/interaction telemetry capped at 20 events/minute — enough for diagnosis, safe for prod volume.

**Option B (quick fix): Flip to `true`.** Immediate signal, but unthrottled — acceptable short-term since these are debug-level events and the existing `playbackLog` function already does some filtering.

### Files Changed

| File | Change |
|------|--------|
| `frontend/src/modules/Fitness/FitnessPlayer.jsx` | Remove `DEBUG_FITNESS_INTERACTIONS` const, update `logFitnessEvent` to use `logger.sampled()` |

### Validation

After deploy, trigger a seek during a fitness session and confirm logs appear:
```bash
ssh homeserver.local 'docker logs -f daylight-station' | grep 'fitness.player.keyboard-seek'
```

---

## Gap 2: FPS Data Missing from `fitness-profile` Samples

### Problem

The `fitness-profile` logger in `FitnessApp.jsx` (line 123) queries FPS via:

```js
const getVideoFps = () => {
    const video = document.querySelector('video, dash-video');
    if (!video) return null;
    const quality = video.getVideoPlaybackQuality?.();
    if (!quality) return null;
    ...
};
```

This has two fragility issues:

1. **DOM query miss**: If the `<video>` element doesn't exist at sample time (player transitioning, seeking, remounting after stall recovery), `getVideoFps()` returns `null` and that sample's FPS data is completely lost. In the Feb 6 session, the profiler was running but FPS fields were `null`.

2. **30-second sample interval**: FPS is sampled every 30s (5s during warning phase). A 10-second FPS dip between samples is invisible. The users reported poor FPS, but if the dip happened between samples, we'd never see it.

### Evidence of Damage

The Feb 6 prod logs show `fitness-profile` events with `sessionActive: false` and FPS fields absent — the profiler was running but the video element wasn't queryable at sample times. We have **zero FPS data** for the entire session.

### Remediation

**A. Use a ref instead of DOM query.** FitnessPlayer already tracks `mediaElement` state and registers it via `registerVideoPlayer`. Wire this ref into the profiler:

```js
// In FitnessApp.jsx profiler setup, use a registered ref instead of querySelector
const getVideoFps = () => {
    const video = window.__fitnessVideoElement; // Set by FitnessPlayer
    if (!video) return null;
    ...
};
```

In FitnessPlayer, set the global on mount:
```js
useEffect(() => {
    if (mediaElement) window.__fitnessVideoElement = mediaElement;
    return () => { window.__fitnessVideoElement = null; };
}, [mediaElement]);
```

**B. Add standalone FPS degradation events.** Don't rely solely on the 30s profiler. Add a dedicated FPS monitor that emits events on degradation:

```js
// In FitnessPlayer or a new useFpsMonitor hook
useEffect(() => {
    if (!mediaElement) return;
    let lastFrames = 0;
    let lastTime = performance.now();

    const checkFps = () => {
        const quality = mediaElement.getVideoPlaybackQuality?.();
        if (!quality) return;
        const now = performance.now();
        const elapsed = (now - lastTime) / 1000;
        if (elapsed < 2) return; // Min 2s between checks
        const fps = (quality.totalVideoFrames - lastFrames) / elapsed;
        lastFrames = quality.totalVideoFrames;
        lastTime = now;

        if (fps < 20 && fps > 0) {
            getLogger().sampled('fitness.video_fps_low', {
                fps: Math.round(fps * 10) / 10,
                droppedFrames: quality.droppedVideoFrames,
                currentTime: mediaElement.currentTime,
                readyState: mediaElement.readyState
            }, { maxPerMinute: 6 });
        }
    };

    const interval = setInterval(checkFps, 3000);
    return () => clearInterval(interval);
}, [mediaElement]);
```

### Files Changed

| File | Change |
|------|--------|
| `frontend/src/modules/Fitness/FitnessPlayer.jsx` | Expose `mediaElement` to `window.__fitnessVideoElement` |
| `frontend/src/Apps/FitnessApp.jsx` | Update `getVideoFps()` to use ref instead of `querySelector` |
| `frontend/src/hooks/fitness/useFpsMonitor.js` (new) | Dedicated FPS degradation logger |

### Validation

```bash
ssh homeserver.local 'docker logs -f daylight-station' | grep 'fitness.video_fps'
```

During a session, confirm `fitness-profile` events now contain non-null `videoFps` values, and `fitness.video_fps_low` fires when FPS dips.

---

## Gap 3: No Governance→Render Latency Logging

### Problem

Users reported: "warning screen appeared and offender chip was still green, shortly turned to blue after." This means there's a visible lag between:

1. GovernanceEngine decides phase = `warning` (logged as `governance.phase_change`)
2. GovernanceEngine detects a zone change (logged as `governance.user_zone_change`)
3. The UI **renders** the updated chip color and overlay

We log steps 1 and 2, but **never log step 3**. The total unmeasured pipeline:

```
Zone change detected by GovernanceEngine
  → 100ms debounce (notifyZoneChange, line 753)
  → evaluate() runs
  → state cache throttle up to 200ms (_stateCacheThrottleMs, line 914)
  → React state update + reconciliation
  → DOM paint
  = UNKNOWN total latency
```

Without render-timing telemetry, we cannot:
- Confirm the user's report of stale chip colors
- Measure how much lag exists between engine decision and UI paint
- Determine if the issue is debounce, cache, React render, or all three

### Remediation

**A. Add render-complete logging to the governance overlay component.**

In the overlay component (`FitnessPlayerOverlay` or equivalent), log when the overlay actually renders with the current phase and participant data:

```js
useEffect(() => {
    if (!overlay?.status) return;
    const renderTs = performance.now();
    getLogger().sampled('fitness.governance_overlay.rendered', {
        phase: overlay.status,
        lockRowCount: overlay.lockRows?.length || 0,
        participantZones: overlay.lockRows?.map(r => ({
            name: r.participantKey,
            zone: r.targetZoneId
        })),
        renderTs
    }, { maxPerMinute: 10 });
}, [overlay?.status, overlay?.lockRows]);
```

**B. Add zone-change-to-render correlation ID.**

When GovernanceEngine detects a zone change, stamp it with a monotonic ID. When the overlay renders that change, log the same ID so we can compute the delta:

```js
// In GovernanceEngine._logZoneChanges:
const changeId = ++this._zoneChangeSeq;
logger.sampled('governance.user_zone_change', {
    changeId,
    ...existingPayload
}, { maxPerMinute: 30 });

// In overlay render effect:
getLogger().sampled('fitness.governance_overlay.zone_rendered', {
    changeId: window.__fitnessGovernance?.lastZoneChangeId,
    renderLatencyMs: performance.now() - (window.__fitnessGovernance?.lastZoneChangeTs || 0)
}, { maxPerMinute: 10 });
```

**C. Reduce unnecessary latency sources.**

The 100ms debounce + 200ms state cache throttle means up to 300ms of *intentional* delay before a zone change reaches the UI. Consider:
- Reducing `_stateCacheThrottleMs` from 200ms → 100ms (still prevents thrashing)
- Reducing debounce from 100ms → 50ms for zone changes that occur during warning phase (when visual accuracy matters most)

### Files Changed

| File | Change |
|------|--------|
| `frontend/src/hooks/fitness/GovernanceEngine.js` | Add `_zoneChangeSeq` counter, stamp zone change events, expose via `_updateGlobalState()` |
| `frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx` | Add render-timing log in `useEffect` |
| `frontend/src/hooks/fitness/GovernanceEngine.js` | (Optional) Reduce `_stateCacheThrottleMs` and debounce during warning phase |

### Validation

During a governance warning:
```bash
ssh homeserver.local 'docker logs -f daylight-station' | grep -E 'governance.user_zone_change|governance_overlay.rendered'
```

Compare timestamps between zone change and overlay render to measure actual latency.

---

## Implementation Priority

| Phase | Gap | Effort | Impact | Deploy |
|-------|-----|--------|--------|--------|
| **Phase 1** (immediate) | Gap 1: Enable seek logging | 15 min | Unblocks all seek diagnostics | Next deploy |
| **Phase 1** (immediate) | Gap 2A: Video ref instead of querySelector | 15 min | FPS data in profiler | Next deploy |
| **Phase 2** (this week) | Gap 2B: Standalone FPS monitor hook | 1 hr | Real-time FPS degradation events | |
| **Phase 2** (this week) | Gap 3A: Overlay render logging | 30 min | Governance→render latency visible | |
| **Phase 3** (next week) | Gap 3B: Correlation IDs | 1 hr | Precise change→render delta | |
| **Phase 3** (next week) | Gap 3C: Reduce debounce/cache during warning | 30 min | Faster visual response | Needs testing |

---

## Risk Assessment

- **Phase 1 changes are zero-risk.** They only add logging — no behavioral changes.
- **Phase 2 FPS hook** is additive; worst case is a stale interval if mediaElement unmounts (mitigated by cleanup).
- **Phase 3C debounce/cache reduction** could increase CPU from more frequent state recomputation during warning phase. Should be tested with 4+ participants to verify no render thrashing.

---

## Related Code

- `frontend/src/modules/Fitness/FitnessPlayer.jsx` — Player component, seek handlers, `DEBUG_FITNESS_INTERACTIONS`
- `frontend/src/hooks/fitness/GovernanceEngine.js` — Phase evaluation, zone change logging, debounce/cache
- `frontend/src/Apps/FitnessApp.jsx` — `fitness-profile` profiler, FPS sampling
- `frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx` — Governance overlay render
