# 2026-02-16 Fitness Session Crash Postmortem

## Incident Summary

**Date:** 2026-02-15 ~7:00 PM MST (2026-02-16 03:00 UTC)
**Duration:** ~12 minutes (03:02 - 03:14 UTC)
**Affected client:** Garage TV running Firefox (X11; Linux x86_64; rv:147.0)
**Impact:** Frontend froze before video could play. Render thrashing at 338 renders/sec locked the main thread. Page crashed and reloaded twice, thrashing resumed each time. No workout video ever played.

---

## Root Cause: Tick Timer Runaway + Render Thrashing

The fitness session tick timer was started **repeatedly without stopping the previous one**, creating hundreds of concurrent interval timers. Each timer tick triggered state updates, which triggered React re-renders, which triggered more timer starts — a positive feedback loop that consumed the entire main thread.

### The Numbers

| Time (UTC) | tick_timer starts | Render rate | Status |
|---|---|---|---|
| 03:02:58 | 171 in 60s (~3/sec) | - | Session starts |
| 03:03:32 | - | 142 renders/30s (~4.7/sec) | `excessive-renders` warning |
| 03:04:02 | 247 in 60s (~4/sec) | 133 renders/30s (~4.4/sec) | Still excessive |
| 03:05:00 | - | - | Video mounts but `getMediaEl` missing |
| 03:05:02 | **1,198 in 60s (~20/sec)** | **937 renders/5s (187/sec)** | `render_thrashing` all components |
| 03:05:51 | - | - | **Page crashes, reloads** |
| 03:06:01 | - | - | Video mounts again, `getMediaEl` still missing |
| 03:06:21 | - | **1,692 renders/5s (338/sec)** sustained 19s | `render_thrashing` **worse after reload** |

---

## Timeline

| Time (UTC) | Event |
|---|---|
| 03:02:45 | `fitness-profile` sample=3: `videoFps:0, videoState:"paused", rosterSize:0, deviceCount:1` — video already not playing |
| 03:02:46 | Session `fs_20260215190146` ends after 60s: `empty_roster` |
| 03:02:46 | `endSession() called recursively, skipping` — reentrant session teardown |
| 03:02:49 | `[WebSocketService] Error: {isTrusted:true}` — WebSocket connection drops |
| 03:02:58 | Session `fs_20260215190258` starts. **Tick timer started 10+ times in 2 seconds** (03:02:58.177 through 03:02:59.905) |
| 03:03:02 | **Page reloads** to `/fitness/plugin/pose_demo`. Fresh `error-handlers.initialized`, `fitness-app-mount`, 12 users created. |
| 03:03:02 | New session `fs_20260215190302` starts immediately — tick timer starts repeating again (~250ms apart) |
| 03:03:02 | `VALIDATION_FAIL: session-too-short (1ms)` x3 + `AUTOSAVE` x3 — session started and validated within 32ms |
| 03:03:32 | **`fitness-profile-excessive-renders`**: 135 forceUpdates, 142 renders in 30s |
| 03:04:02 | Tick timer aggregated: **247 starts skipped** in 60s for session fs_20260215190302 |
| 03:04:02 | Still excessive: 141 forceUpdates, 133 renders |
| 03:04:32 | Still excessive: 142 forceUpdates, 136 renders |
| 03:05:00 | `fitness.video.mounted` with `minimal:true`. **`playback.transport-capability-missing: getMediaEl`** — video component mounts but can't find the `<video>` DOM element |
| 03:05:00 | Overlay: `status:Starting... el:t=0.0 r=n/a n=n/a p=false startup:armed attempts=0` — video never initializes |
| 03:05:02 | Tick timer aggregated: **1,198 starts skipped** in 60s = **20 timer starts/second** |
| 03:05:02 | **RENDER THRASHING**: FitnessPlayer 936 renders/5s (187/sec), FitnessChart 937/5s, FitnessPlayerOverlay 937/5s, FitnessSidebar 938/5s. **Sustained 2+ seconds.** |
| 03:05:43 | `playback.transport-capability-missing: getMediaEl` — still can't find video element |
| 03:05:51 | **Page crashes and reloads again** (fresh `error-handlers.initialized`, all state reset) |
| 03:05:51 | Session `fs_20260215190551` starts immediately — fails `session-too-short` (1ms) again |
| 03:06:01 | Video mounts again: same `getMediaEl` missing, same `status:Starting...` |
| 03:06:21 | **RENDER THRASHING WORSE**: All components at **1,692 renders/5s (338/sec), sustained 19 seconds** |
| 03:07:16 | Session `fs_20260215190716`: fails `no-participants`, then `session-too-short` |
| 03:08:19 | Session `fs_20260215190819`: fails `no-participants` |
| 03:08:22 | Governance activates on media 606441 |
| 03:09:19 | Governance challenge triggers: target=hot, need 2 users, 90s |
| 03:10:49 | Challenge fails (0 users in hot, all in active). `governance.lock_triggered: challenge_failed` |

---

## Bug Analysis

### BUG 1: Tick Timer Started Without Stopping Previous (CRITICAL — root cause)

`fitness.tick_timer.started` was logged **166 times** on this client. The aggregated log shows **1,198 starts in a single 60-second window**. Each call to start the tick timer creates a new `setInterval(5000ms)`. Without clearing the previous interval, this creates hundreds of concurrent timers.

Each timer fires every 5 seconds, triggering:
- `_collectTimelineTick()` → state update → re-render
- `_maybeAutosave()` → more state updates → more re-renders
- Each re-render potentially triggers the timer start again (effect re-runs)

This creates a runaway feedback loop: timers → state changes → renders → more timers.

The `tick_timer.started.aggregated` events confirm this is not just logging noise — the timer was actually started that many times, with the aggregator sampling 10 and skipping the rest.

### BUG 2: Render Thrashing (CRITICAL — direct cause of freeze)

The thrashing detector logged:
- **187 renders/sec** at 03:05:02 (2s sustained)
- **338 renders/sec** at 03:06:21 (19s sustained)

At 338 renders/sec on a Linux Firefox instance, the main thread is completely consumed by React reconciliation. No time left for:
- Video element initialization (`getMediaEl` always missing)
- User input processing (UI frozen)
- WebSocket message handling
- Any useful work

The `forceUpdateCount` being near `renderCount` confirms these are forced re-renders (imperative `forceUpdate()` or rapid state mutations), not normal React re-renders from prop changes.

### BUG 3: Video Never Loaded (CRITICAL — user-visible symptom)

The video component mounted with `minimal:true` and immediately reported `playback.transport-capability-missing: getMediaEl`. This means the `<video>` DOM element was never found by the playback transport.

Root cause: the render thrashing prevented the video element from mounting and stabilizing in the DOM. React was re-rendering the tree so fast that the video element was being created and destroyed on every render cycle, never persisting long enough for the transport to find it.

Evidence:
- `videoState: null` in fitness-profile (no video state ever established)
- `videoFps: 0` (no frames ever rendered)
- Overlay stuck at `status:Starting... el:t=0.0 r=n/a` (never progressed past "Starting")
- `startup:armed attempts=0` (never even attempted startup)

### BUG 4: Session Start Creates Tick Timer on Every WebSocket Message (HIGH)

The pattern shows tick_timer starts happening every ~250ms, synchronized with WebSocket heartbeat messages arriving. The call stack confirms:

```
recordDeviceActivity → ingestData → _dispatch (WebSocketService)
```

Each incoming HR reading triggers `recordDeviceActivity`, which somehow triggers a tick timer start. The timer should only start once per session, but it's starting on every data ingestion.

### BUG 5: Session Rapid-Cycling (HIGH)

Sessions started and immediately failed validation:
- `session-too-short` (duration: 1ms) — session created and validated in the same event loop tick
- `no-participants` — session started but no users enrolled
- Buffer threshold met by same device 3 times: `firstIds:[28688,28688,28688]`

The validation runs as part of autosave, which fires immediately on session start. The session has no time to accumulate data before being validated and rejected.

### BUG 6: Recursive endSession Call (MEDIUM)

At 03:02:46: `[FitnessSession] endSession() called recursively, skipping`. The session teardown is triggering itself, which suggests endSession triggers a state change that re-enters endSession. While the recursion guard catches it, this indicates the session lifecycle has reentrancy issues.

### BUG 7: Governance Challenge Unwinnable (MEDIUM)

Challenge required 2 users in "hot" zone (HR > 160-170 depending on user overrides). All users were in "active" zone (HR 108-139). The challenge was auto-triggered by the governance engine without checking feasibility.

Participant HRs at challenge failure:
- Felix: 130 bpm (hot threshold: 160)
- Alan: 139 bpm (hot threshold: 170)
- KC: 108 bpm (no overrides)
- Milo: 129 bpm (hot threshold: 165)

Nobody was within 20 bpm of their hot threshold.

---

## Blame Analysis

### Contributing Commits

The crash was caused by the **first deploy** containing governance engine state change callbacks combined with pre-existing render amplification code. The previous container image was from ~Feb 12-13. The failing deploy at 03:02:48 UTC Feb 16 included ALL commits from Feb 13-15.

| Commit | Date | Change | Role in Crash |
|--------|------|--------|---------------|
| `7519510c` | Dec 2, 2025 | Put `_startTickTimer()` inside `updateSnapshot()` | **Precondition**: tick timer restarted on every render |
| `8c72d84c` | Feb 3, 2026 | Added `version` to `useEffect` deps for `updateSnapshot()` | **Precondition**: every `forceUpdate()` → `updateSnapshot()` → timer restart |
| **`c885e79c`** | **Feb 14, 2026 08:00** | **Added `onStateChange: () => forceUpdate()` to governance callbacks** | **Trigger**: governance now fires unbatched `forceUpdate()` on every `_invalidateStateCache()` |
| `449bdf45` | Feb 14, 2026 20:59 | Debounced `_invalidateStateCache` with `queueMicrotask` | Mitigation attempt (insufficient — microtask still fires `forceUpdate`) |

### The Cascade

1. **Governance `onStateChange`** calls `forceUpdate()` directly (not `batchedForceUpdate()`) — bypasses rAF batching
2. **Governance `onPulse`** also calls `forceUpdate()` directly — another unbatched render trigger
3. **TreasureBox mutation callback** (`FitnessContext.jsx:583-588`) calls both `_triggerPulse()` AND `forceUpdate()` — two unbatched render triggers per mutation
4. Each `forceUpdate()` increments `version` → useEffect re-runs → `updateSnapshot()` → `_startTickTimer()` (timer restart)
5. On a low-power Firefox/Linux client, the combined render load from multiple unbatched `forceUpdate()` sources saturated the main thread

### Why it Worked Before

The previous deploy (~Feb 12-13) did NOT include `c885e79c`. Without `onStateChange: () => forceUpdate()`, the governance engine had no way to trigger React re-renders on state evaluation. Only `onPhaseChange` and `onPulse` were active, and phase changes are infrequent. The `onPulse` callback was the only source of unbatched renders, producing ~4-5/sec — tolerable even on low-power hardware.

---

## Fixes Needed

### P0 — Session tick timer runaway

1. **Guard tick timer start against duplicate starts**
   - Check if timer is already running before creating a new interval
   - `if (this._tickTimer) return;` before `setInterval()`
   - Clear previous timer before starting new one: `clearInterval(this._tickTimer)`

2. **Don't start tick timer from `recordDeviceActivity`**
   - Tick timer should start exactly once when a session starts
   - WebSocket data ingestion should NOT trigger timer creation
   - Move timer start to `startSession()` only, remove from data path

### P1 — Render thrashing

3. **Throttle `forceUpdate` calls**
   - `forceUpdateCount` was 135-142 per 30s interval — something is calling forceUpdate on every WebSocket message
   - Batch state updates: collect HR readings and apply once per animation frame
   - Use `requestAnimationFrame` or a 100ms debounce for state updates from WebSocket data

4. **Add render thrashing circuit breaker**
   - When `fitness.render_thrashing` detects sustained thrashing (>100 renders/sec for >5s), take corrective action:
     - Stop all tick timers
     - Pause WebSocket data processing
     - Show error state to user
   - Currently the detector logs the problem but takes no action

### P2 — Session lifecycle

5. **Require distinct devices for buffer threshold**
   - Buffer currently fires on `[28688, 28688, 28688]` — same device 3 times
   - Require N distinct device IDs before triggering session start

6. **Don't validate session on first autosave**
   - Autosave fires immediately on session start, validates, finds 1ms duration, fails
   - Add minimum session age before validation runs (e.g., 30 seconds)

7. **Fix recursive endSession reentrancy**
   - endSession triggers state change → re-enters endSession
   - Set a flag before state changes, not after

### P3 — Governance

8. **Challenge feasibility check**
   - Before triggering a challenge, verify target zone is achievable
   - If no participant is within 20 bpm of the target zone, skip or downgrade the challenge

---

## Key Telemetry Evidence

```
# The tick timer runaway
fitness.tick_timer.started.aggregated: skippedCount=1198, window=60s

# The render thrashing
fitness.render_thrashing: component=FitnessPlayer, rendersInWindow=1692, renderRate=338.4/sec, sustainedMs=19193

# The video that never loaded
playback.transport-capability-missing: capability=getMediaEl
playback.overlay-summary: status=Starting... el:t=0.0 r=n/a startup:armed attempts=0

# The excessive renders (per 30s profile interval)
fitness-profile-excessive-renders: forceUpdateCount=142, renderCount=136
```
