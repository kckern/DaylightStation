# Audit: FitnessChart Render Thrashing + Mid-Stream DASH Stall

**Date:** 2026-03-13
**Severity:** High — sustained performance degradation during active fitness session
**Session:** prod, ~02:24–02:50 UTC
**Video:** Mario Kart 8 Deluxe (`plex:649319`, duration=16725s / ~4.6 hours, resumed at offset 7397s)
**Browser:** Firefox 148.0 (Linux x86_64, kiosk TV)

---

## Summary

Two independent issues collided during a fitness session:

1. **FitnessChart render thrashing** — 15 renders/sec sustained for 25+ minutes, starting from session boot. Caused by a `removed → idle` status oscillation loop in the participant cache.
2. **Mid-stream DASH stall** — 65-second video freeze at position ~8161s caused by Plex transcode buffer exhaustion. Recovery pipeline correctly avoided destructive actions but offered no user feedback.

Neither issue is a regression from the 03-07/03-10/03-11 video player fixes. Those fixes addressed startup/resume position loss. These are new failure modes.

---

## Issue 1: FitnessChart Render Thrashing (Primary)

### Symptoms

| Metric | Value | Source |
|--------|-------|--------|
| Render rate | 12.8–15.4 renders/sec | `fitness.render_thrashing` logs |
| Sustained duration | 152+ seconds (still going at last log) | `sustainedMs` field |
| forceUpdateCount | 115–124 per 30s profiling window | `fitness-profile` samples |
| Status correction log | `[FitnessChart] Status corrected: kckern (removed → idle)` | Every 5s (throttled) |
| Session impact | Continuous from first 30s of session onward | Profile sample #2 at 02:24:38 |

### Timeline

| Time (UTC) | Event |
|------------|-------|
| 02:24:08 | Session starts; profile sample 1: `forceUpdateCount: 1` |
| 02:24:38 | Profile sample 2 (30s in): `forceUpdateCount: 124, renderCount: 145` — **already thrashing** |
| 02:25:08 | Sample 3: `forceUpdateCount: 120` — sustained |
| 02:47:47 | `fitness.render_thrashing`: `sustainedMs: 2110, renderRate: 12.8` |
| 02:48:17 | `sustainedMs: 32233, renderRate: 15.4` |
| 02:49:17 | `sustainedMs: 92348, renderRate: 15.2` |
| 02:50:17 | `sustainedMs: 152399, renderRate: 14.8` — still going |

**Key observation:** The thrashing started 30 seconds into the session — NOT triggered by the DASH stall (which happened at 02:46). The `render_thrashing` detector only reported it at 02:47:47 because the 2-second sustained threshold + 30-second report cooldown delayed the first log.

### Root Cause

**The participant cache `useEffect` creates new objects on every `presentEntries` change, which triggers `validatedEntries` to detect a status mismatch and create yet another new object.**

The chain:

```
1. useFitnessModule('fitness_chart') provides `participants` (roster)
   → Roster rebuilds on every session tick (every 3-5s when HR data arrives)
   → Each rebuild creates NEW roster entry objects (new references)

2. useRaceChartData(roster, ...) [FitnessChart.jsx:69]
   → useMemo depends on [roster, getSeries, timebase, ...]
   → New roster reference → useMemo recomputes → new presentEntries array

3. useEffect([presentEntries]) [FitnessChart.jsx:356]
   → Calls setParticipantCache(prev => { ... })
   → For users IN presentIds: copies entry with { ...prevEntry, ...entry }
   → For users NOT in presentIds: sets status = REMOVED, isActive = false

4. validatedEntries useMemo [FitnessChart.jsx:442]
   → Checks entry.isActive !== false → correctStatus = ACTIVE or IDLE
   → If entry.status !== correctStatus → creates NEW object { ...entry, status: corrected }
   → This triggers the "Status corrected: kckern (removed → idle)" log
```

**The specific oscillation pattern (`removed → idle`):**

When the user `kckern` has two devices (rosterSize: 2, deviceCount: 2 from profile data), one of the participant IDs may appear in `presentEntries` on some ticks but not others, depending on whether the HR device sent data in that tick window. When the ID is NOT in `presentIds`, line 414-416 sets `status: REMOVED, isActive: false`. Then `validatedEntries` at line 447 sees `isActive === false` and corrects to `IDLE`.

But the deeper issue is **every recomputation creates new object references**, which cascades through the dependency chain:
- New `participantCache` → new `allEntries` (line 427, `useMemo([participantCache])`)
- New `allEntries` → new `validatedEntries` (line 442, `useMemo([allEntries])`)
- New `validatedEntries` → new `present`/`absent` arrays (lines 462-463)
- New `present`/`absent` → new SVG elements in render

This means **every session tick that changes the roster triggers a full chart re-render**, even if the visual output is identical.

### Files Involved

| File | Lines | Role |
|------|-------|------|
| `frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx` | 356-425 | `useEffect([presentEntries])` — updates cache, sets REMOVED status |
| Same | 442-459 | `validatedEntries` useMemo — corrects REMOVED → IDLE, creates new objects |
| Same | 427 | `allEntries` useMemo — filters cache, new array on every cache change |
| Same | 462-463 | `present`/`absent` split — new arrays on every validatedEntries change |
| `frontend/src/hooks/fitness/ParticipantRoster.js` | 108-148 | `getRoster()` — builds new array on every call |
| Same | 437 | `isActive = !device.inactiveSince` — single source of truth |
| `frontend/src/hooks/fitness/useRenderProfiler.js` | 102-125 | Detects and reports thrashing (>10/sec sustained 2s) |

### Related Prior Audit

`2026-02-16-governance-ghost-participant-oscillation.md` documented a similar oscillation pattern where governance phase flipped between `pending` and `unlocked` due to competing evaluate paths. That bug was in GovernanceEngine, not FitnessChart, but the symptom pattern (rapid state flip → cascade of re-renders → video pause/resume cycling) is structurally identical.

---

## Issue 2: Mid-Stream DASH Stall (65 seconds)

### Symptoms

| Metric | Value | Source |
|--------|-------|--------|
| Stall duration | 65,004ms | `playback.recovery-resolved` |
| Video position at stall | ~8161s (2h16m into 4.6h video) | `playback.stalled` |
| Buffer state | Both audio+video stalled | `dash.buffer-stalled` events |
| Recovery strategies attempted | 0 (self-resolved) | `strategiesAttempted: 0` |
| Transcode warming | 6 consecutive empty fragments | `dash.transcode-warming` |

### Timeline

| Time (UTC) | Event | Details |
|------------|-------|---------|
| 02:46:12 | `playback.seek` | Programmatic seek to 8161s |
| 02:46:14 | `playback.stalled` | stallDurationMs: 1500, position: 8161s |
| 02:46:21 | `recovery-strategy: nudge` | `success: false` — correctly detected position outside buffered range |
| 02:47:00 | `playback.seek` | Seek to 8195s (another attempt) |
| 02:47:10 | `playback.seek` | Seek to 8362s |
| 02:47:19 | `playback.recovery-resolved` | stallDurationMs: 65004, strategiesAttempted: 0 |
| 02:47:34 | `dash.transcode-warming` | 6 consecutive empty fragments (video index 5, startTime 25) |
| 02:47:35 | `dash.buffer-stalled` × 2 | Both audio and video buffers stalled |
| 02:47:35 | `dash.fragment-abandoned` × 2 | Video (index 11) and audio (index 0) abandoned |
| 02:47:36 | `stall_threshold_exceeded` | 4,079ms, status: seeking, playheadPosition: null |
| 02:47:55 | `dash.waiting` + `dash.buffer-stalled` | Continued buffer starvation |
| 02:47:57 | `playback.stalled` | stallDurationMs: 1,350ms (brief second stall) |
| 02:47:58 | `fitness.video_fps_degraded` | **fps: -658.9** (negative — see Issue 3) |
| 02:48:07–15 | `dash.waiting` × 3 | Ongoing buffer starvation |
| ~02:48:30 | Playback resumes | Fragments returning real data, buffer fills |

### Root Cause

**Plex transcode fell behind during a long video playback.** At position ~8161s (2h16m) in a 4.6h video, the transcode session either lost its cache or hit a complex encoding section that required re-transcoding. This caused:

1. Fragment requests returning 0-byte responses (transcoder preparing)
2. Both audio and video buffers draining to zero
3. A 65-second wait while the transcoder caught up

### What the Prior Fixes Prevented

The 14 player commits from 03-07 through 03-11 **correctly handled this scenario**:
- Nudge recovery detected position was outside buffered ranges → skipped (commit `8b911470`)
- No destructive remount was triggered (unlike 03-07/03-10 incidents)
- No position loss occurred — playback resumed at the correct position
- The `recovery-resolved` event shows `strategiesAttempted: 0` — the recovery pipeline correctly stood back and let the transcode catch up

**The 65-second stall is fundamentally a Plex transcoding latency issue**, not a player bug. However, there was no user-visible feedback that the player was waiting for the transcoder (no loading spinner, no "buffering" indicator).

### Files Involved

| File | Lines | Role |
|------|-------|------|
| `frontend/src/modules/Player/hooks/usePlayheadStallDetection.js` | — | Stall detection (500ms poll) |
| `frontend/src/modules/Player/hooks/useCommonMediaController.js` | 400-432 | Nudge recovery (correctly skipped) |
| `frontend/src/modules/Player/renderers/VideoPlayer.jsx` | 295-303 | `dash.transcode-warming` (0-byte detection) |
| Same | 339, 346 | `dash.buffer-stalled`, `dash.waiting` events |

---

## Issue 3: Negative FPS Metric (-658.9)

### Symptom

At 02:47:58, `fitness.video_fps_degraded` reported `fps: -658.9`.

### Root Cause

**File:** `FitnessApp.jsx:145-182`

The FPS calculation in the profiling effect uses `getVideoPlaybackQuality()` API:

```javascript
const framesDelta = quality.totalVideoFrames - lastFpsCheck.totalFrames;
fps = Math.round(framesDelta / elapsed * 10) / 10;
```

When a recovery strategy reloads the video element (`mediaEl.load()` or DASH `reset()`), the browser resets `totalVideoFrames` to 0. But `lastFpsCheck.totalFrames` retains the previous value (e.g., ~658,000 frames for a 2h+ video at ~24fps). This produces a large negative delta.

The `lastFpsCheck` state is closure-scoped to the profiling effect and is never reset when the video element is replaced or reloaded.

### Files Involved

| File | Lines | Role |
|------|-------|------|
| `frontend/src/Apps/FitnessApp.jsx` | 145-182 | FPS calculation with stale `lastFpsCheck` |

---

## Relationship Between Issues

```
Issue 1 (render thrashing)          Issue 2 (DASH stall)
        ↓                                  ↓
Started at 02:24:08               Started at 02:46:12
(from session boot)               (mid-stream buffer exhaustion)
        ↓                                  ↓
Running continuously              65s stall, self-resolved
        ↓                                  ↓
Still running at 02:50            Triggers Issue 3 (negative FPS)
        ↓                                  ↓
    INDEPENDENT                      INDEPENDENT
```

The render thrashing was **already happening for 22 minutes** before the DASH stall occurred. They share no causal link. The render thrashing may have contributed to the browser's ability to buffer DASH fragments efficiently (Firefox on a kiosk TV, 15 renders/sec = constant layout/paint work), but this is speculative.

---

## Recommendations

### Issue 1: FitnessChart Render Thrashing

#### P0: Stabilize participantCache references when data hasn't meaningfully changed

**File:** `FitnessChart.jsx:356-425`

The `useEffect([presentEntries])` creates new cache objects on every tick even when the visual data is identical. Add a shallow comparison before `setParticipantCache`:

- Compare incoming entry values (beats length, lastIndex, status, isActive) against cached entry
- Only create new object if meaningful data changed
- Return `prev` from the state updater if no changes detected

This eliminates the cascade: stable cache → stable `allEntries` → stable `validatedEntries` → no re-render.

#### P1: Remove the `removed → idle` correction loop

**File:** `FitnessChart.jsx:408-422` and `442-459`

The code at line 416 sets `status: REMOVED` for users not in `presentIds`, then `validatedEntries` at line 447 "corrects" REMOVED to IDLE. This is a contradiction in the same component — one path sets a status that another path immediately overrides.

Fix: When a user is not in `presentIds`, set their status based on `isActive` directly (IDLE if inactive, preserve previous status if active), rather than forcing REMOVED and letting `validatedEntries` fix it.

#### P2: Memoize roster entry objects in ParticipantRoster

**File:** `ParticipantRoster.js:108-148`

`getRoster()` creates brand new objects on every call. If the underlying device state hasn't changed, the same roster entry objects should be returned. This prevents unnecessary useMemo invalidation in all consumers.

### Issue 2: Mid-Stream DASH Stall

#### P1: Show loading indicator during extended stalls

When `playback.stalled` fires and `stallDurationMs > 5000`, the player overlay should show a buffering spinner. Currently, the video just freezes with no feedback. The `PlayerOverlayLoading` component has this capability but it may not be triggered during mid-stream stalls (only during startup).

#### P2: Pre-buffer ahead for long videos

For videos >2 hours with active transcode sessions, consider increasing the DASH buffer target from the default to prevent the transcode from falling behind. This is a dash.js configuration change (`streaming.buffer.bufferTimeAtTopQualityLongForm`).

### Issue 3: Negative FPS

#### P2: Reset FPS tracking on video element lifecycle changes

**File:** `FitnessApp.jsx:145-182`

Add a guard in `getVideoFps()`: if `quality.totalVideoFrames < lastFpsCheck.totalFrames`, reset `lastFpsCheck` to current values and skip FPS calculation for this sample. This handles element reloads/resets gracefully.

---

## Priority Summary

| Priority | Issue | Fix | Impact |
|----------|-------|-----|--------|
| **P0** | Render thrashing | Stabilize participantCache references | Eliminates 15/s renders, reduces CPU on kiosk TV |
| **P1** | Render thrashing | Remove removed→idle correction contradiction | Eliminates status oscillation log spam |
| **P1** | DASH stall UX | Show buffering spinner during extended stalls | User feedback during 65s freeze |
| **P2** | Render thrashing | Memoize ParticipantRoster entries | Prevents unnecessary downstream invalidation |
| **P2** | DASH buffering | Increase buffer target for long videos | Reduces likelihood of mid-stream stalls |
| **P2** | Negative FPS | Guard against frame counter reset | Accurate diagnostics after recovery |

---

## Related Audits

| Audit | Relevance |
|-------|-----------|
| `2026-02-16-governance-ghost-participant-oscillation.md` | Same oscillation pattern (state flip → cascade), different component |
| `2026-03-11-fitness-video-dash-playback-failure-audit.md` | DASH 0-byte fragments during transcode warmup — same root cause as Issue 2 |
| `2026-03-10-video-resume-resilience-remount-audit.md` | Player recovery fixes that PREVENTED worse outcome in Issue 2 |
| `2026-03-07-video-resume-position-loss-audit.md` | Original position loss cascade — fully fixed, not triggered here |
| `2026-02-15-session-chart-historical-rendering-audit.md` | FitnessChart rendering performance concerns |
