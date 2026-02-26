# Fitness Session Postmortem: 20260225181217

**Date:** 2026-02-25
**Session:** `fs_20260225181217` (18:12–18:42 PST, 1765 seconds)
**Source:** `media/logs/fitness/2026-02-26T02-12-16.jsonl` (4047 lines) + `history/fitness/2026-02-25/20260225181217.yml`
**Participants:** Milo (28688), Alan (28676), Felix (28812), KC Kern (40475)
**Content:** Mario Kart 8 (plex:606442), then Mario Kart 8 Deluxe (plex:649319)

---

## Voice Memo Transcript (recorded during session)

> "Okay, everyone worked hard. There were three issues. There was a player pause loading overlay that happened after. There was one challenge that ended without all satisfied. There was the user that went into cool without the warning starting. And the elevator music still plays ove[r]"

Each issue below is tagged with the corresponding voice memo complaint where applicable.

---

## Anomaly 1: Playback Stall Storm on Mario Kart 8 Deluxe (66 stalls)

**Voice memo:** *"player pause loading overlay"*

### Evidence

66 `playback.stalled` events — nearly all on "Mario Kart 8 Deluxe" (plex:649319). Stalls began at 02:20:50 with a **12.7-second stall** and then continued at ~8–13 second intervals from 02:26 through 02:39.

| Window | Stall Count | Avg Duration | Trend |
|--------|------------|--------------|-------|
| 02:15 (MK8) | 3 | 1,358ms | Baseline |
| 02:20–02:21 (MK8D) | 1 | **12,727ms** | Initial mega-stall |
| 02:26–02:31 | 16 | 1,417ms | Stable |
| 02:31–02:36 | 16 | 1,565ms | Escalating |
| 02:36–02:39 | 12 | 1,860ms | Worsening |

Three `stall_threshold_exceeded` events had `playheadPosition: null` and `videoFps: null`, meaning the video element was unresponsive during those periods.

The overlay showed "Seeking…" for the initial stall, which is misleading — the video wasn't seeking, it was buffering/stuck.

### Likely Cause

The playhead was only advancing ~10–12 seconds of content per ~12 seconds of wall clock, meaning near-continuous stuttering. Combined with the render thrashing (Anomaly 3), the browser was CPU-starved. The 12.7s mega-stall at 02:20:50 arrived just as the second video loaded, suggesting a Plex transcoding startup delay.

### Impact

Visible loading overlay during active exercise. Breaks immersion.

### Files

| File | Role |
|------|------|
| `frontend/src/modules/Fitness/FitnessPlayer.jsx` | Stall detection, overlay display |
| Overlay loading component | Shows "Seeking…" status for buffering events |

---

## Anomaly 2: Failed Hot Challenge — Alan Never Reached Hot Zone

**Voice memo:** *"one challenge that ended without all satisfied"*

### Evidence

Challenge `default_challenge_0_1772073479837` at 02:31:19:
- Zone: **Hot**, required: **4 participants**, time allowed: 90s
- Result: **failed**
- Met: milo, felix, kckern
- Missing: **alan**

Alan's HR at challenge time (~tick 230–248): 124–138 BPM. Alan's hot threshold is 170 BPM. He was 32+ BPM below the hot zone and never close.

### Root Cause

Alan's zone profile: `hot: 170`. During the challenge window, Alan peaked at ~140 BPM (warm zone), never approaching hot. The challenge required ALL 4 participants at hot, which was impossible given Alan's HR trajectory.

### Cross-Reference: Alan's Session-Wide Zone Distribution

From `alan:zone` series:
- 25 ticks in **cool** (early session — device startup noise)
- 75 ticks in **active** (longest sustained block)
- ~170 ticks in **warm**
- Only 2 ticks in **hot** (brief, around device join)
- 0 ticks in **fire**

Alan spent <1% of session time in hot zone. The challenge system selected hot/4-required while Alan was structurally unable to reach it.

### Recommendation

The challenge selection algorithm should account for participant zone distribution or recent peak zones when setting `requiredCount: all` for high zones.

---

## Anomaly 3: Render Thrashing — Sustained ~1,400 Force Updates Per 30s Window

**Recurring issue from [2026-02-25 zone state audit](2026-02-25-fitness-zone-state-anomalies-audit.md)**

### Evidence

67 `fitness-profile-excessive-renders` warnings across the entire session:
- Sustained **1,200–1,760 forceUpdateCount** per 30-second window
- `FitnessChart` rendering at **175 renders/sec** (5s window)
- `FitnessPlayer`, `FitnessSidebar`, `FitnessPlayerOverlay` at **56–60 renders/sec**
- `fitness.render_thrashing` warnings sustained from 24s elapsed through 1645s elapsed (entire session)

### What Changed Since Last Audit

**Tick timer churn is fixed.** This session shows **1 start, 1 stop** (vs 296/434 in the prior audit). The `_startTickTimer()` guard or removal from `updateSnapshot()` was applied.

**Render thrashing persists** despite the tick timer fix. The remaining driver is the HR ingestion → `batchedForceUpdate()` → React re-render cycle. With 4 devices sending HR at ~4–5 samples/sec, that's ~20 state updates/sec, each triggering a full component tree re-render.

### Impact

CPU contention on the Shield TV, directly contributing to the playback stall storm (Anomaly 1).

### Recommendation

The root cause is `batchedForceUpdate()` being called on every HR sample. Possible fixes:
1. Throttle `batchedForceUpdate()` to max 2–4/sec
2. Move HR ingestion out of React state (use refs for high-frequency data, only setState on tick boundaries)
3. Use `React.memo` with aggressive equality checks on chart/sidebar components

---

## Anomaly 4: `fitness_chart.no_series_data` Log Spam (597 events)

### Evidence

~200 `no_series_data` warnings for alan and felix in a 1.5-second window (02:12:29–02:12:30), firing every ~16ms per user. This is the chart component re-rendering at 60fps and logging a warning on every render for users who just joined but have no data yet.

### Root Cause

`FitnessChart` renders for each roster entry even when that entry has zero data points. The warn log fires unconditionally on every render.

### Recommendation

Use `logger.sampled()` instead of `logger.warn()`, or only log once per user when first seen with empty data.

---

## Anomaly 5: Zone Profile Build Redundancy (Still Present)

**Recurring issue from [2026-02-25 zone state audit](2026-02-25-fitness-zone-state-anomalies-audit.md), Anomaly 1**

### Evidence

150 `build_profile` events logged + aggregated data showing **3,433 skipped** in one 60-second window alone. Estimated ~3,600 total `build_profile` calls in 30 minutes.

All for the same set of users with identical output (same zones, same thresholds).

### Status

**Unfixed.** The per-user input memoization recommended in the prior audit has not been applied.

---

## Anomaly 6: Exit Margin Suppression Volume (Still Present)

**Recurring issue from [2026-02-25 zone state audit](2026-02-25-fitness-zone-state-anomalies-audit.md), Anomaly 3**

### Evidence

230 `exit_margin_suppressed` events logged + aggregated data showing **1,495 skipped** in one 60-second window. Breakdown from aggregated data:
- kckern: 442 suppressions (HR ~116, warm→active boundary, threshold 120, exit at 115)
- alan: 808 suppressions
- milo: 107
- felix: 138

kckern hovered near the warm/active boundary for extended periods, triggering continuous hysteresis.

### Status

**Partially addressed** (events are now rate-limited via `logger.sampled()`), but the underlying TreasureBox/ZoneProfileStore data-source mismatch remains. The LED/roster still reads from TreasureBox's eager zone, bypassing the Schmitt trigger.

---

## Anomaly 7: Alan's Device Startup HR Spike (161 BPM → 90 BPM)

### Evidence

Alan's HR series begins: `[[null,4],[161,3],[90,2],100,104,107,...]`

The first 3 real readings are **161 BPM** (hot zone!), then immediately drops to 90 BPM (cool zone), then gradually climbs from 100 to normal working range.

Alan's zone series confirms: `[[null,4],["w",3],["c",25],...]` — 3 ticks of warm (from the 161 spike), then 25 ticks of cool.

### Impact

- The 161 spike would have briefly registered Alan as "hot zone" on the dashboard
- When it dropped to 90, Alan fell to cool zone for 25 ticks (125 seconds)
- This is the **"user went into cool without the warning starting"** from the voice memo — the governance engine didn't trigger a warning because Alan's zone dropped *before* the governance had fully activated for the session

### Likely Cause

BLE heart rate monitors often send stale/cached readings when first connected. Device 28676 may have been transmitting a cached value from a prior session.

### Recommendation

Consider a "startup discard" window where the first N readings from a newly connected device are treated as provisional and not used for governance or zone assignment.

---

## Anomaly 8: Governance Phase Cycling (22 transitions)

### Evidence

| Time | Transition | Participants | Notes |
|------|-----------|-------------|-------|
| 02:12:21 | null→pending | 1 | Initial — only Milo connected |
| 02:14:47 | pending→unlocked | 4 | All 4 participants met active zone |
| 02:14:55 | unlocked→null→unlocked | 4/0/4 | **Double transition in 21ms** — media change |
| 02:15:33 | unlocked→null→unlocked | 4/0/4 | Same pattern — second seek? |
| 02:17:19 | unlocked→locked | 4 | First governance lock |
| 02:19:27 | warning→locked | 4 | 30s grace period expired |
| 02:20:37 | warning→locked | 4 | 30s grace period expired |
| 02:27:36 | warning→locked | 4 | 30s grace period expired |
| 02:39:29 | unlocked→locked | 4 | Direct lock (challenge?) |
| 02:40:18 | locked→unlocked | 1 | Only 1 participant remaining |
| 02:41:21 | unlocked→pending | 0 | Empty roster → pending |

The `unlocked → null → unlocked` double transitions at 02:14:55 and 02:15:33 happen within 18–21ms. These occur when media changes cause the governance engine to reset and re-evaluate. The zero-participant intermediate state (`activeParticipantCount: 0`) suggests the participant list is briefly empty during media transitions.

### Impact

Each phase change triggers UI updates (lock overlay, LED changes, playback pause/resume). The double transitions are too fast for the user to see, but they cause unnecessary state churn.

---

## Anomaly 9: Session End Timing — Empty Roster Lingers 84s

### Evidence

| Time | Event | Roster Size |
|------|-------|-------------|
| 02:40:18 | locked→unlocked | 1 (only kckern) |
| 02:40:29 | kckern zone → active | 1 |
| 02:41:21 | unlocked→pending | 0 |
| 02:42:45 | tick_timer.stopped | 0 |

The roster hit zero at 02:41:21. The session ended at 02:42:45 — **84 seconds** later. The `FITNESS_TIMEOUTS.emptySession` is set to 60000ms (60s). The 24-second overshoot is within tick interval tolerance (5s tick + processing).

Post-session, all 17 users are re-initialized via `usermanager.user_created` (standard cleanup).

---

## Anomaly 10: Voice Memo Event Spam (33 events in 34 seconds)

### Evidence

33 `playback.voice-memo` events from 02:39:43 to 02:40:18, firing in rapid bursts:
- 19 events in 277ms at 02:39:43–02:39:44 (~68/sec)
- 3 events in 60ms at 02:40:08
- 7 events in 1ms at 02:40:11
- 4 events in 0ms at 02:40:18

### Likely Cause

The voice memo overlay or recording component is re-rendering with each audio frame and emitting a log event per render. The per-session YAML shows `voiceMemoCount: 1` and the consolidated event has `duration_seconds: 96`, so only 1 actual memo was recorded.

### Recommendation

Use `logger.sampled()` for voice memo render events.

---

## Anomaly 11: FitnessChart "Participant Count Mismatch" Spam (756 events, prod only)

**Source:** Prod Docker logs (`console.warn`, not in JSONL session log)

### Evidence

756 `[FitnessChart] Participant count mismatch!` events in prod logs. These are raw `console.warn` calls that bypass the structured logger, which is why they appear in Docker logs but NOT in the JSONL session log.

Sample:
```json
{
  "rosterCount": 2,
  "chartPresentCount": 0,
  "chartTotalCount": 0,
  "rosterIds": ["kckern", "global"],
  "chartPresentIds": [],
  "missingFromChart": ["kckern", "global"]
}
```

The `global` entry (combined score) is included in the roster passed to the chart, but the chart doesn't know how to render it. This fires on **every render** — combined with the 1,400+/30s render rate, it produces massive log output.

Additionally, 493 `[FitnessChart] Avatar mismatch` events fire when roster/chart participant counts diverge (e.g., when participants leave but chart entries persist).

### Root Cause

The roster includes a `global` synthetic entry for combined scores, but the chart component expects only real participant IDs. The chart fails to find `global` in its entries, logs a mismatch, and continues.

### Impact

- **756 + 493 = 1,249 console.warn calls** from the chart alone in one session
- These are raw `console.warn`, not `logger.warn()`, so they bypass rate limiting and flood Docker logs
- Combined with the render thrashing, this is the single largest source of prod log volume

### Recommendation

1. Filter `global` from the roster before passing to chart, OR handle it as a known synthetic entry
2. Convert these to `logger.sampled()` instead of raw `console.warn`

---

## Anomaly 12: Pre-Session Chart Gap Warnings (02:10, before session start)

**Source:** Prod Docker logs

### Evidence

6 `[FitnessChart] Segment shows gap but roster says active` events at 02:10:35–02:10:42, which is **~2 minutes before** the session log started at 02:12:16.

```
02:10:35 kckern - endsWithGap: true, isActive: true, lastSegment: {isGap: true, status: 'idle'}
02:10:41 alan   - same
02:10:41 milo   - same
02:10:41 felix  - same
```

### Likely Cause

A prior session or pre-session state where devices were connected but no active session was recording. The chart rendered gap segments for users who were "active" in the roster but had no recent data points. This is a warm-up/initialization artifact.

### Impact

Low — only 6 events, cosmetic.

---

## Anomaly 13: YAML vs Log Metadata Discrepancy

### Evidence

| Field | YAML Event | Log Event |
|-------|-----------|-----------|
| `grandparentTitle` | Fitness | Game Cycling |
| `parentTitle` | Workout | Mario Kart |

The YAML persistence layer appears to use a different metadata source (possibly a resolved/canonical mapping) than the real-time log (which uses raw Plex metadata).

### Impact

Low — purely cosmetic. The `mediaId` is consistent (606442).

---

## Summary Table

| # | Anomaly | Severity | Voice Memo | Status |
|---|---------|----------|------------|--------|
| 1 | Playback stall storm / phantom overlay flashes (66 stalls on MK8D) | **High** | "player pause loading overlay" | New — needs investigation |
| 2 | Failed Hot challenge (alan unreachable) | **Medium** | "challenge ended without all satisfied" | New |
| 3 | Render thrashing (1,400+/30s sustained) | **High** | — | Recurring (tick fix helped, root persists) |
| 4 | Chart no_series_data log spam (597) | **Low** | — | New |
| 5 | Zone profile build redundancy (~3,600) | **Low** | — | Recurring, unfixed |
| 6 | Exit margin suppression volume (~1,700) | **Low** | — | Recurring, partially addressed |
| 7 | Alan device startup HR spike (161→90) | **Medium** | "user went into cool without warning" | New |
| 8 | Governance double-transitions (21ms null gap) | **Low** | — | New |
| 9 | Empty roster lingers 84s (60s timeout + drift) | **Low** | — | Expected behavior |
| 10 | Voice memo event spam (33 in 34s) | **Low** | — | New |
| 11 | FitnessChart participant mismatch spam (756+493, prod only) | **Medium** | — | New |
| 12 | Pre-session chart gap warnings | **Low** | — | Cosmetic |
| 13 | YAML vs log metadata discrepancy | **Info** | — | Cosmetic |

### Priority for Fixes

1. **Render thrashing (#3)** — Root cause of #1. Throttling `batchedForceUpdate()` would reduce CPU pressure on Shield TV, likely eliminating the stall storm.
2. **Playback stall handling (#1)** — Even with CPU relief, the overlay should show "Buffering" not "Seeking" and should auto-recover gracefully from 12s stalls.
3. **Device startup HR discard (#7)** — Prevents false zone assignments and user confusion.
4. **Challenge selection (#2)** — Challenge algorithm should not target zones participants can't reach.
5. **Log spam (#4, #10)** — Easy `logger.sampled()` fixes.
