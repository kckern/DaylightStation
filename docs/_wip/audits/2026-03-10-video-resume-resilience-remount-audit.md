# Video Resume Position Loss via Resilience Remount — Audit

**Date:** 2026-03-10
**Severity:** High (user saw ~2 min of wrong content + spinner on startup)
**Session log:** `media/logs/fitness/2026-03-10T02-52-01.jsonl`
**Video:** Mario Kart 8 Deluxe (`plex:649319`, duration=16725s / ~4.6 hours)
**Saved resume position:** 6746s (~1:52:26)
**Prior fix reference:** `docs/_wip/audits/2026-03-07-video-resume-position-loss-audit.md`

---

## Summary

The six fixes from the 2026-03-07 position-loss incident prevented the catastrophic failure chain (nudge death loops, DASH state destruction, 13-minute recovery). However, the P0 fix for `__appliedStartByKey` (commit `52862fe8`) only clears the guard in the `softReinit` recovery path — not in the **resilience recovery remount** path. The resilience system's `player-remount` triggers the same React remount but doesn't clear the guard, causing `effectiveStart=0` on the new instance.

**User impact:** ~4 minutes of startup spinner (DASH stream failing to start, 3 resilience retries, exhaustion), followed by ~2 minutes of playing from t=0 before the deferred DASH seek landed at the correct position.

**User report:** "On governance unlock, the video just stayed spinning. Had to exit and restart, and then it appeared to go back to zero, but then finally did resume from the correct location." The user conflated the startup spinner with a governance event — the governance lock/unlock cycle at 02:59 actually worked correctly.

---

## Timeline (from structured logs)

### Phase 1: Startup spinner (02:52 – 02:57)

| Time (UTC) | Event | Analysis |
|---|---|---|
| 02:52:01 | `fitness-app-mount` | App loads |
| 02:52:09 | `fitness.session.started` | Session begins (HR buffer threshold met) |
| 02:53:10 | `governance.phase_change` → locked | Governance locks (no participants yet) |
| 02:53:11 | `dash.playback-started` + `dash.waiting` | DASH player initializes but doesn't produce frames |
| 02:53:11 | `start-time-decision`: req=6746, eff=6746, initial=true, applied=false | **Correct** — resume position accepted |
| 02:53:25 | `resilience-recovery`: startup-deadline-exceeded, attempt=1 | **15s with no video-ready** → resilience remounts player |
| 02:53:25 | `player-remount` | Player component remounted |
| 02:53:25 | `stall_threshold_exceeded`: dur=15101ms, status=recovering | Spinner shown to user |
| 02:53:40 | `resilience-recovery`: attempt=2 | 2nd remount — still no video |
| 02:53:55 | `resilience-recovery`: attempt=3 | 3rd remount — still no video |
| 02:54:10 | `resilience-recovery-exhausted` | All 3 attempts used up |
| 02:55:27 | `dash.playback-started` | DASH finally initializes (~2.5 min after first attempt) |
| 02:55:27 | `start-time-decision`: req=6746, **eff=0**, initial=false, **applied=true** | **BUG: `__appliedStartByKey` blocks resume position** |
| 02:55:27 | `start-time-applied`: method=direct, intent=0, actual=0 | Video starts at t=0 |
| 02:55:42 | `resilience-recovery-exhausted` (2nd) | Another exhaustion (from the remounted instance) |

### Phase 2: Deferred seek recovery (02:55 – 02:57)

| Time (UTC) | Event | Analysis |
|---|---|---|
| 02:57:12 | `playback.paused`: t=0 | Video still at t=0 after ~2 minutes |
| 02:57:14 | `playback.stalled`: t=0, stallMs=1311 | Brief stall at t=0 |
| 02:57:16 | `playback.seek`: intent=6690 | Deferred DASH seek finally fires |
| 02:57:17 | `recovery-resolved`: t=6690, stallMs=3184, strats=0 | Position restored — no recovery strategies needed |
| 02:57:17 | `playback.video-ready` | Video element reports ready |
| 02:57:17 | `playback.started`: t=6690, dur=16725 | **Stable playback begins** |

### Phase 3: Governance lock/unlock — works correctly (02:59)

| Time (UTC) | Event | Analysis |
|---|---|---|
| 02:59:01 | `governance.challenge.failed` (hot zone) | Challenge timed out → lock triggered |
| 02:59:01 | `governance.lock_triggered` → `playback.paused` at t=6794 | Video paused correctly |
| 02:59:12 | `governance.challenge.recovered` → unlock | Challenge recovered 11s later |
| 02:59:12 | `playback.resumed` at t=6794 | **Resume works correctly** |
| 02:59:22+ | `playback.fps_stats` flowing | Stable 60fps playback for ~10 minutes |

### Phase 4: User exits (03:09)

| Time (UTC) | Event | Analysis |
|---|---|---|
| 03:09:14 | `fullscreen-pointerdown` × 3 | User taps screen |
| 03:09:16 | Voice memo capture starts, `playback.paused` at t=7397 | Auto voice memo on session wind-down |
| 03:09:22 | Voice memo accepted, `playback.resumed` at t=7397 | Resume works correctly |
| 03:09:25 | `fitness-navigate` → users view | User navigates away from video |
| 03:10:21 | `governance.evaluate.no_participants` | All participants left |
| 03:10:48 | Session effectively ends | Log ends at 03:10:49 |

### Phase 5: Restart sessions (03:10 – 03:12)

| Session | Lines | Content |
|---|---|---|
| `2026-03-10T03-10-56.jsonl` | 36 | Mount only, no playback |
| `2026-03-10T03-12-27.jsonl` | 98 | Mount + user creation, no playback events |

The restart sessions show the app remounting but no video playback was attempted — the user was likely on the chart/users view, not the video player.

---

## Root Cause Analysis

### Bug 1: `__appliedStartByKey` not cleared on resilience remount (P0)

**File:** `frontend/src/modules/Player/hooks/useCommonMediaController.js`

The P0 fix from commit `52862fe8` added `delete __appliedStartByKey[assetId]` inside `softReinitRecovery`. But there are **two** remount paths:

1. **`softReinit`** (stall recovery escalation) — calls `setElementKey(prev + 1)` and clears `__appliedStartByKey`. **Fixed.**
2. **Resilience recovery** (`player-remount` via startup-deadline-exceeded) — also remounts the component, but does **not** clear `__appliedStartByKey`. **Not fixed.**

When the resilience system remounts the player after startup failure:
- The new instance checks `__appliedStartByKey[assetId]` → finds `true` from the first mount
- `isEffectiveInitial` evaluates to `false`
- `effectiveStart` falls to 0
- The sticky-resume / deferred-DASH-seek path eventually fires, but not for ~2 minutes

**Evidence:**
```
02:53:11 start-time-decision: req=6746 eff=6746 initial=True applied=False   ← correct on first mount
02:55:27 start-time-decision: req=6746 eff=0   initial=False applied=True    ← BLOCKED on remount
```

### Bug 2: DASH startup takes 2.5 minutes with no video-ready (P1)

The DASH player initialized at 02:53:11 (`dash.playback-started`) but never produced a `video-ready` event. The resilience system's 15-second deadline fired 3 times, each remounting the player — which likely made things worse by tearing down partially-initialized DASH state.

From 02:53:11 to 02:55:27 (2m 16s), DASH was loading fragments (`dash.fragment-loading` events streaming continuously) but couldn't achieve playback. This suggests either:
- The seek to position 6746s requires loading distant segments, and the server was slow
- Each resilience remount restarted the fragment loading from scratch

The video only started playing after `resilience-recovery-exhausted` at 02:54:10 — suggesting the resilience remounts were counterproductive. The player needed to be left alone to finish loading.

### Bug 3: Seek event spam (P2 — logging)

The `playback.seek` events with `phase=seeked` fire ~30 duplicate times per seek event (all within 1ms at 02:57:17 and 02:59:12). The `maxPerMinute: 30` sampled limit is ineffective because all events arrive in the same millisecond burst.

**Evidence:** 30+ identical `playback.seek` entries at 02:57:17.381-382 and 02:59:12.473-476.

### Bug 4: Stale `lastSeekIntentRef` after playback progresses (P2 — logging)

After the initial seek to 6690s lands, `lastSeekIntentRef` is never updated as playback advances. By 02:59:12, the video is at t=6794 but the seek events report `intent=6690, drift=104s`. By 03:09:22, the video is at t=7397 but logs show `intent=6690, drift=707s`. This is stale state, not real drift.

This makes the seek logs misleading and would confuse future debugging — large drift values look like position-loss bugs when they're just stale intent.

---

## What the 2026-03-07 Fixes Prevented

The six fixes from the prior audit were effective at preventing the catastrophic failure chain:

| Fix | Triggered? | Outcome |
|-----|-----------|---------|
| P0: `__appliedStartByKey` clear on softReinit | No (resilience remount, not softReinit) | **Gap identified** — same bug via different remount path |
| P0: Seek intent deferred clearing | Not tested — no reload recovery | N/A |
| P1: Buffer-aware nudge | Not tested — no nudge attempted | N/A |
| P1: DASH-aware reload | Not tested — no reload attempted | N/A |
| P2: Position watchdog | Not tested — no recovery drift | N/A |
| P2: Duration loss escalation | Not tested — duration stayed valid | N/A |

The fact that no stall recovery was needed (the stall at 02:57:14 self-resolved in 3s with zero strategies) suggests the DASH buffering is healthier overall.

---

## Failure Chain Summary

```
DASH player initializes, begins loading fragments at position 6746s
        ↓
Fragments loading slowly — no video-ready within 15s
        ↓
Resilience: startup-deadline-exceeded → player-remount (× 3)
        ↓
Each remount restarts DASH from scratch (counterproductive)
        ↓
Resilience exhausted at 02:54:10 — player left alone
        ↓
DASH finally achieves playback at 02:55:27
        ↓
New instance checks __appliedStartByKey[assetId] → TRUE (from first mount)
        ↓
isEffectiveInitial = false → effectiveStart = 0
        ↓
Video plays from t=0 for ~2 minutes
        ↓
Deferred DASH seek fires at 02:57:16 → lands at t=6690
        ↓
Stable playback from 02:57:17 onward (no further issues)
```

---

## Recommendations

### P0: Clear `__appliedStartByKey` on all remount paths

**File:** `frontend/src/modules/Player/hooks/useCommonMediaController.js`

The resilience recovery's `player-remount` event path must clear `__appliedStartByKey[assetId]` just like `softReinit` does. Find every code path that increments `elementKey` or causes a React remount and ensure the guard is cleared.

Alternatively, **centralize the guard clearing** into the `onLoadedMetadata` handler: instead of checking `__appliedStartByKey` as a blocker, check a per-mount-instance flag (e.g., `mountIdRef`) so each mount always gets one chance to apply start time regardless of which path created it.

### P1: Resilience remount is counterproductive for slow DASH startup

**File:** The resilience recovery system (likely in the player or a resilience hook)

When a DASH stream is actively loading fragments (dash.fragment-loading events flowing), remounting the player resets all progress. The resilience system should distinguish between:
- **Truly stuck** (no fragment loading, no buffer growth) → remount appropriate
- **Slow but progressing** (fragments loading, buffer growing) → extend deadline, don't remount

Consider checking `mediaEl.buffered` length growth or dash fragment-loaded count before deciding to remount. If the buffer is growing, the stream is making progress and should be given more time.

### P2: Fix seek event spam

**File:** `frontend/src/modules/Player/hooks/useCommonMediaController.js` — `clearSeeking` / seeked handler

The `playback.seek` (phase=seeked) events fire once per buffered `seeked` event listener, producing 30+ duplicates. Either:
- Deduplicate at the source: use a single `seeked` listener instead of multiple
- Or debounce the log: track last-logged-seek-ts and skip if within 100ms

### P2: Clear `lastSeekIntentRef` after start-time application

**File:** `frontend/src/modules/Player/hooks/useCommonMediaController.js`

After the deferred DASH seek successfully lands (in the `onTimeUpdate` handler that applies start time), clear `lastSeekIntentRef` or update it to the current `mediaEl.currentTime`. This prevents stale intent values from polluting all subsequent seek logs for the rest of the session.

---

## Related Audits

| Audit | Relevance |
|-------|-----------|
| `2026-03-07-video-resume-position-loss-audit.md` | Original incident — same `__appliedStartByKey` bug, different trigger path |
| `2026-02-27-video-playback-failure-audit.md` | DASH recovery and SourceBuffer state issues |
| `2026-03-05-media-player-ux-design-audit.md` | Resilience retry loops and UX during recovery |
| `docs/reference/fitness/video-resume-position.md` | Reference doc for the recovery pipeline |
