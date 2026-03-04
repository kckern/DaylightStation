# Fitness Session Mar 04 Audit — Three User-Reported Bugs

**Date:** 2026-03-04
**Session Under Review:** `fs_20260303185652` (prod, Mar 3 ~6:56 PM local / Mar 4 02:56 UTC)
**Media:** Mario Kart 8 Deluxe (Game Cycling - Mario Kart), `plex:649319`
**Log Source:** `media/logs/fitness/2026-03-04T02-56-51.jsonl` (2,154 lines, ~1MB)
**Duration:** 02:56:51 – 03:17:17 UTC (~20 minutes active)
**Prior Audit:** `2026-02-17-governance-feb17-session-audit.md`

---

## Purpose

Investigate three user-reported issues from the Mar 4 session:

1. **Video stall during seek** — Had to exit and restart (BAD!)
2. **Zone color not updating** — HR visibly below threshold but zone color didn't change
3. **Chart behind lock overlay** — During governance lock, chart appeared instead of paused video

### Participants

| User | Device | Active Threshold | Warm Threshold | Hot Threshold | Status |
|------|--------|-----------------|----------------|---------------|--------|
| Felix | 28812 | 120 | 140 | 160 | Active (auto-assigned) |
| KC Kern | — | 100 (default) | 120 (default) | 140 (default) | Active (superuser) |
| Milo | — | 120 | 140 | 165 | Active |
| Alan | — | 125 | 150 | 170 | Active |
| Soren | — | 125 | 150 | 170 | Intermittent (exempt) |

---

## Verdict Summary

| Issue | Severity | Status | Root Cause |
|-------|----------|--------|------------|
| Video stall on seek to 55:45 | **P1** | **CONFIRMED** | DASH seek + pause/resume thrashing (10 cycles in 9s) during buffering |
| Zone color not updating below threshold | **P2** | **CONFIRMED** | ZoneProfileStore exit margin suppresses visual zone, not just governance |
| Chart behind lock overlay | **P2** | **CONFIRMED** | `showChart` state never toggled on governance lock |

### Session Health (non-bug)

| Metric | Value | Assessment |
|--------|-------|------------|
| Ghost oscillation | 0 incidents | HEALTHY |
| Phase changes | 7 total | HEALTHY |
| Challenges issued | 9, all completed | HEALTHY |
| FPS | 60 constant, 0 dropped frames | HEALTHY |
| Governance locks | 1 (legitimate, Alan HR drop) | HEALTHY |
| Exit margin suppressions | 164 raw + 386 in final 60s aggregation | EXCESSIVE (see Bug 2) |

---

## Bug 1: Video Stall on Seek to 55:45

### Severity: P1 (data loss — user had to exit and restart)

### Timeline

```
03:02:17.311  Seek to 52:57 initiated (el:t=2110.3)
03:02:22.317  Seek to 55:45 initiated (el:t=3181.1)
03:02:22.792  playback.stalled — stallDurationMs: 1484ms, stuck at t=3345
03:02:22–29   Overlay: "Seeking… 55:45", el frozen at t=3181.1 for 7 seconds
03:02:29.203  el jumps to t=3345.0 but video paused
03:02:29.599  PAUSE/RESUME THRASHING BEGINS:
  03:02:29.599  paused  → 03:02:29.599  resumed (0ms gap!)
  03:02:29.919  paused  → 03:02:30.421  resumed
  03:02:30.325  governance.challenge.started ("all hot" → downgraded to warm)
  03:02:31.222  playback.stalled — stallDurationMs: 1304ms (SECOND STALL)
  03:02:31.737  paused  → 03:02:35.171  resumed (3.4s gap)
  03:02:35.535  paused  → 03:02:35.783  resumed
  03:02:35.964  paused  → 03:02:36.106  resumed
  03:02:36.583  paused  → 03:02:36.783  resumed
  03:02:36.953  paused  → 03:02:37.616  resumed
  03:02:37.973  paused  → 03:02:38.154  resumed
  03:02:38.318  paused
  (10 pause/resume cycles in 9 seconds, all at t=3345.006)
03:02:40.642  USER EXITS — governance resets (unlocked → null)
03:02:40.670  Immediate re-entry — chart re-warmup, governance null → unlocked
03:02:44.514  playback.started (FRESH start, not resume) at t=3344 — recovered
```

### Log Evidence

Seek overlay stuck for 18+ seconds:
```
Line 410: status:Seeking… | seek:55:45 | el:t=3181.1 (03:02:22)
Line 453: status:Seeking… | seek:55:45 | el:t=3345.0 (03:02:39) — 17 seconds later
```

Two stall events:
```
Line 411: playback.stalled — stallDurationMs: 1484, currentTime: 3345.007
Line 429: playback.stalled — stallDurationMs: 1304, currentTime: 3345.006
```

Pause/resume thrashing (10 cycles, all stuck at same currentTime):
```
Lines 422-451: 10 paired paused/resumed events, all at currentTime: 3345.006
```

Critical coincidence — governance challenge started during the stall:
```
Line 425-426: governance.challenge.started at 03:02:30.188
  zone: warm, selectionLabel: "all hot", requiredCount: 4
```

### Root Cause Analysis

The stall has two contributing factors:

**Factor 1: DASH buffering failure on large seek.** The seek jumped from t=2110 to t=3345 (a ~20 minute forward seek in content). The DASH stream needed to fetch new segments. During buffering, the video element's `readyState` dropped below `HAVE_ENOUGH_DATA`, causing the browser to fire `waiting` events.

**Factor 2: Governance challenge triggered a state update cascade during buffering.** At 03:02:30 — while the video was still stuck buffering from the seek — a governance challenge started. This triggered:
1. `governance.challenge.started` → state change callback → `batchedForceUpdate()`
2. FitnessPlayer re-render → `resolvePause()` re-evaluates
3. `pauseDecision` alternates based on governance state vs video buffering state
4. Each pause/resume toggle fires browser media events → more re-renders → more `resolvePause()` calls

The video element was caught in a feedback loop: it couldn't buffer because it kept getting paused, and it kept getting paused because the re-renders kept calling `resolvePause()` which toggled based on transient state.

**The 0ms gap** between paused→resumed at 03:02:29.599 is the smoking gun — both events fire in the same millisecond, meaning `resolvePause()` is being called synchronously during a render and immediately contradicting itself.

### Remediation

1. **Guard `resolvePause()` during active seeks.** If the player is in a seeking state (overlay showing "Seeking…"), `resolvePause()` should not toggle video pause/play. The seek must complete before governance can pause.

2. **Add seek-in-progress state.** Track `isSeeking` between the seek initiation and the first `canplay`/`seeked` event. While `isSeeking`, suppress governance pause/resume.

3. **Debounce pause/resume toggles.** If `pause()` and `play()` are called within 100ms of each other, coalesce to the last call only.

### Files to Modify

- `frontend/src/modules/Fitness/player/FitnessPlayer.jsx` — `resolvePause()` logic
- Possibly `frontend/src/modules/Fitness/player/hooks/` — if pause decision is in a hook

---

## Bug 2: Zone Color Not Updating When HR Below Threshold

### Severity: P2 (confusing UX, undermines trust in HR display)

### The Problem

Users reported seeing their HR value displayed below the zone threshold, but the zone color (on LEDs, badges, chart) didn't change. For example: HR shows "118 BPM" but zone color is still green (active, min: 120).

### Log Evidence

**164 `exit_margin_suppressed` events** in this session (sampled — true count much higher given aggregation).

Example suppressions for Felix:

```
Line 103 (02:59:05): userId:felix, HR:118, committedZone:active, rawZone:cool
                      committedMin:120, exitThreshold:115, exitMarginBpm:5
  → Felix at 118 BPM. Raw zone = cool (below 120). But displayed as "active"
    because 118 > exitThreshold (115).

Line 160 (03:00:12): userId:felix, HR:139, committedZone:warm, rawZone:active
                      committedMin:140, exitThreshold:135, exitMarginBpm:5
  → Felix at 139 BPM. Raw zone = active (below 140). But displayed as "warm"
    because 139 > exitThreshold (135).

Line 1999 (03:15:37): userId:felix, HR:119, committedZone:active, rawZone:cool
                       committedMin:120, exitThreshold:115, exitMarginBpm:5
  → Felix at 119 BPM. 1 BPM below threshold, still shown as "active".
```

Aggregated suppression counts (final 60s window, line 1998):
```
Users suppressed: kckern:86, felix:124, milo:96, alan:80
Total: 386 suppressions in 60 seconds
```

### Root Cause Analysis

The Era 11 Schmitt trigger exit margin (Feb 18) was added to `ZoneProfileStore.#applyHysteresis()` to prevent governance warning spam from HR oscillating around zone boundaries. It works correctly for its intended purpose: **governance evaluation stability**.

**The bug is architectural:** `ZoneProfileStore` is the **single source of truth** for zone state for BOTH governance and UI. When the exit margin suppresses a zone downgrade:

1. `ZoneProfileStore.getProfile(userId).currentZoneId` returns the committed (old) zone
2. GovernanceEngine reads from ZoneProfileStore → stable governance decisions ✓
3. Zone LED colors read from ZoneProfileStore → **stale zone display** ✗
4. User badges/chart read from ZoneProfileStore → **stale zone display** ✗
5. `zone_led.activated` event reports committed zones → **stale LED colors** ✗

The user sees "HR: 118" (real-time from device) but zone color says "Active" (min: 120). The numbers contradict the colors. This undermines trust in the system.

### Architectural Principle Violated

The exit margin was designed for **governance stability** (Era 11, governance-history.md). It should never have been applied to the visual display layer. Per the governance docs: "Governance is about zone requirements, not raw heart rate values." The same principle applies in reverse: **visual display is about current state, not stabilized state.**

### Remediation

**Option A (Preferred): Expose dual zone IDs from ZoneProfileStore**

```javascript
// ZoneProfileStore.js — getProfile() returns both:
return {
  currentZoneId: this.committedZoneId,   // for governance (with exit margin)
  displayZoneId: this.rawZoneId,         // for UI (without exit margin)
  heartRate: this.heartRate,
  // ... existing fields
};
```

Consumers:
- GovernanceEngine reads `currentZoneId` (existing behavior, no change)
- Zone LEDs, user badges, chart colors read `displayZoneId` (new)
- `zone_led.activated` event uses `displayZoneId`

**Option B (Simpler but less clean): Pass raw zone to UI components separately**

Have `DeviceManager` or `UserManager` expose `rawZoneId` alongside the profile zone. UI components read raw; governance reads committed.

### Files to Modify

- `frontend/src/hooks/fitness/ZoneProfileStore.js` — expose `displayZoneId`
- `frontend/src/hooks/fitness/FitnessSession.js` — pass `displayZoneId` to snapshot
- `frontend/src/modules/Fitness/FitnessChart*.jsx` — read `displayZoneId` for colors
- `frontend/src/modules/Fitness/FitnessUserBadge.jsx` (or equivalent) — read `displayZoneId`
- Zone LED emission logic — use `displayZoneId`

---

## Bug 3: Chart Visible Behind Lock Overlay

### Severity: P2 (confusing UX during governance lock)

### The Problem

When governance locked the video (03:04:25), users saw the HR chart behind the lock overlay instead of the paused video frame. Expected: lock overlay over paused/greyed video. Actual: lock overlay over chart over greyed video.

### Log Evidence

The lock occurred at 03:04:25 (governance `warning → locked`). The chart was actively rendering throughout:

```
Line 720 (03:04:48): fitness_chart.participant_mismatch — rosterCount:5,
                      chartPresentCount:4 — chart actively rendering during lock
Line 721 (03:04:48): same event repeated — confirms chart component mounted
```

The lock overlay appeared correctly (overlay summaries show `status:paused` from 03:04:25 onward), but the chart overlay was rendered between the video and the lock panel.

### Root Cause Analysis

In `FitnessPlayer.jsx`:

```javascript
// Line 249 — showChart defaults to true
const [showChart, setShowChart] = useState(true);

// Line 1448-1452 — chart rendered unconditionally when showChart is true
{showChart && (
  <div className="fitness-chart-overlay">
    <FitnessChartApp mode="sidebar" onClose={() => {}} />
  </div>
)}
```

There is **no code** that sets `showChart(false)` when governance locks. The z-index layering is:

| Layer | z-index | Content |
|-------|---------|---------|
| Back | — | `<Player>` video element (paused, greyed via `governance-filter-critical`) |
| Middle | 15 | `.fitness-chart-overlay` (FitnessChartApp) |
| Front | 60 | `.governance-overlay` (GovernanceStateOverlay) |

The lock panel correctly covers the chart, but the chart covers the video. Users see chart data peeking through the semi-transparent lock overlay instead of the paused video frame.

### Remediation

**Option A (Minimal):** Suppress chart during locked/pending phases:

```javascript
// FitnessPlayer.jsx, line 1448
{showChart && govStatus !== 'locked' && govStatus !== 'pending' && (
  <div className="fitness-chart-overlay">
    <FitnessChartApp mode="sidebar" onClose={() => {}} />
  </div>
)}
```

**Option B (Reactive):** Add a `useEffect` that hides the chart on lock:

```javascript
useEffect(() => {
  if (govStatus === 'locked' || govStatus === 'pending') {
    setShowChart(false);
  }
}, [govStatus]);
```

Option A is preferred — it's declarative and doesn't require state management. Option B has the downside that the chart won't re-appear after unlock unless explicitly toggled back.

### Files to Modify

- `frontend/src/modules/Fitness/player/FitnessPlayer.jsx` — chart render condition

---

## Appendix A: Session Timeline

```
02:56:51  App mounted (kiosk mode)
02:56:52  Session started — Felix auto-assigned (HR 76, cool)
02:59:23  KC Kern joins (2 devices)
02:59:48  Milo joins (3 devices)
03:00:05  Navigate to Game Cycling → Mario Kart 8 Deluxe
03:00:16  Governance: null → pending (video locked, 3 participants)
03:00:17  Playback started at t=2093, immediately paused (governance)
03:00:18  Seek to 34:53 (resume point)
03:00:58  Alan joins (4 devices)
03:01:59  Governance: pending → unlocked (1m43s warmup). Playback resumed.
03:02:04  Render FPS: 60
03:02:17  Seek to 52:57
03:02:22  *** BUG 1: Seek to 55:45 → STALL + pause/resume thrashing ***
03:02:30  Challenge #1: "all hot" → downgraded to warm (during stall)
03:02:40  User exits and re-enters — video restarts at t=3344
03:03:31  Challenge #2: "1 warm" — completed in 224ms
03:03:55  Governance: unlocked → warning (Alan HR 90, delta -35)
03:04:25  Governance: warning → locked (grace expired)
          *** BUG 3: Chart visible behind lock overlay ***
03:04:50  Governance: locked → unlocked (Alan recovered, HR 126)
03:05:18  Challenge #3: "some warm" 2 req — completed 28s
03:06:39  Challenge #4: "some warm" 2 req — completed 99ms
03:07:29  Challenge #5: "1 hot" 90s — completed 34.7s (Felix HR 160)
03:09:16  Challenge #6: "1 warm" — completed 215ms
03:10:47  Challenge #7: "some warm" 2 req, 45s
03:12:15  Challenge #8: "most hot" → downgraded to warm, 2 req, 90s
03:13:54  Challenge #9: "all hot" → downgraded to warm, 4 req — completed 37s
03:15:00  Voice memo recorded (4s)
03:15:04  Navigate to users view (cool-down)
03:15:53  Governance: unlocked → pending (no participants)
03:17:17  Session ended
```

---

## Appendix B: Governance Phase Changes

| # | Time | From | To | Trigger | Participants | Video |
|---|------|------|----|---------|-------------|-------|
| 1 | 03:00:16 | null | pending | Media loaded | 3 | Locked |
| 2 | 03:01:59 | pending | unlocked | All active | 4 | Playing |
| 3 | 03:02:40 | unlocked | null | User exit/re-enter | 0 | — |
| 4 | 03:02:40 | null | unlocked | Immediate re-eval | 4 | Playing |
| 5 | 03:03:55 | unlocked | warning | Alan HR drop (90) | 4 | Playing (warning) |
| 6 | 03:04:25 | warning | locked | Grace expired (30s) | 4 | **Locked** |
| 7 | 03:04:50 | locked | unlocked | Alan recovered (126) | 5 | Playing |
| 8 | 03:15:53 | unlocked | pending | No participants | 0 | Locked |

**Assessment:** 8 phase changes in 20 minutes. All legitimate. No ghost oscillation. No rapid flipping. Governance engine is healthy.

---

## Appendix C: Challenge Summary

| # | Time | Type | Required | Time Limit | Duration | Result |
|---|------|------|----------|------------|----------|--------|
| 1 | 03:02:30 | all hot→warm | 4 | 90s | — | Interrupted by exit/restart |
| 2 | 03:03:31 | 1 warm | 1 | 45s | 224ms | Completed (Alan at hot) |
| 3 | 03:05:18 | some warm | 2 | 45s | 28s | Completed |
| 4 | 03:06:39 | some warm | 2 | 45s | 99ms | Completed (already met) |
| 5 | 03:07:29 | 1 hot | 1 | 90s | 34.7s | Completed (Felix HR 160) |
| 6 | 03:09:16 | 1 warm | 1 | 45s | 215ms | Completed (already met) |
| 7 | 03:10:47 | some warm | 2 | 45s | — | Completed |
| 8 | 03:12:15 | most hot→warm | 2 | 90s | — | Completed |
| 9 | 03:13:54 | all hot→warm | 4 | 90s | 37s | Completed |

**Assessment:** 9 challenges, all completed. 3 "hot" challenges auto-downgraded to "warm" (correct — no sustained hot zone activity). Several completed instantly (<300ms) because participants were already above the requirement.

---

## Appendix D: Exit Margin Suppression Evidence (Bug 2)

### Individual Events (sampled)

| Time | User | HR | Committed Zone | Raw Zone | Threshold | Exit Threshold |
|------|------|----|----------------|----------|-----------|----------------|
| 02:59:05 | Felix | 118 | active | cool | 120 | 115 |
| 03:00:12 | Felix | 139 | warm | active | 140 | 135 |
| 03:00:12 | Felix | 138 | warm | active | 140 | 135 |
| 03:15:37 | Felix | 119 | active | cool | 120 | 115 |

### Aggregated Events

| Time | Window | Users | Total Suppressions |
|------|--------|-------|--------------------|
| 03:00:12 | 60s | felix:15 | 25 (15 sampled+skipped) |
| 03:15:37 | 60s | kckern:86, felix:124, milo:96, alan:80 | 396 (386 skipped + 10 sampled) |

**Assessment:** 396 suppressions in a single 60-second window means zone display is wrong ~6.6 times per second across all users. This is not occasional noise — it's the steady-state behavior whenever HR hovers near a zone boundary, which is most of the session.

---

## Appendix E: Render Thrashing (Pre-existing, Non-blocking)

Persistent `fitness.render_thrashing` warnings throughout the session:

| Time | Component | Renders/5s | Rate | Sustained |
|------|-----------|-----------|------|-----------|
| 02:57:21 | FitnessChart | 58 | 11.6/s | 11.7s |
| 02:57:51 | FitnessChart | 58 | 11.6/s | 5.2s |
| 02:58:21 | FitnessChart | 58 | 11.6/s | 11.9s |
| 02:58:51 | FitnessChart | 58 | 11.6/s | 42.0s |
| 03:15:25 | FitnessChart | 61 | 12.2/s | 17.0s |

Not causing FPS degradation (video stays at 60 FPS) but represents wasted CPU. Tracked separately — not a new issue.

---

## Appendix F: Autoplay Race Condition (Pre-existing, Low Priority)

At 03:00:16, two events fire at the same millisecond with contradictory data:

```
governance.phase_change:      to:"pending", videoLocked:true
fitness.media_start.autoplay: videoLocked:false, isGoverned:false, governancePhase:"idle"
```

The autoplay decision runs before governance evaluates, so the log shows `isGoverned:false` even though governance immediately locks the content. The end result is correct (video does get locked), but the log is misleading for debugging.

---

## See Also

- `docs/reference/fitness/governance-engine.md` — GovernanceEngine API reference
- `docs/reference/fitness/governance-history.md` — Era 11 (exit margin) context
- `docs/_wip/audits/2026-02-17-governance-feb17-session-audit.md` — Previous session audit
- `docs/_wip/audits/2026-02-25-fitness-zone-state-anomalies-audit.md` — Zone state issues
