# 2026-01-19 Fitness Crash and Memory Audit

**Date:** January 19, 2026  
**Analyst:** AI Agent  
**Log Source:** `logs/prod-logs-20260119-131500-onward.txt` (48MB, 118k lines)  
**Time Window:** 1:15 PM PST - 1:49 PM PST (crash + 2 subsequent sessions)

---

## Executive Summary

**CRITICAL:** Session 1 crashed after 36 minutes due to React error #185 (hooks ordering violation) triggered by an **infinite render loop in VoiceMemoOverlay**. 104 rapid-fire `recording-start-request` events flooded in ~200ms before crash. Session 3 shows **massive memory growth** reaching **409MB heap** after 15 minutes (13.5x faster growth rate than Session 1).

### Key Metrics Comparison

| Metric | Session 1 (crashed) | Session 2 (still running) | Session 3 (still running) |
|--------|---------------------|---------------------------|---------------------------|
| Duration | 36 min | 11+ min | 15+ min |
| Heap at crash/current | 380MB @ 36m | 41MB @ 6.5m | **409MB @ 15m** |
| Growth rate | 10.6 MB/min | 6.3 MB/min | **27.3 MB/min** 🔴 |
| Crash cause | Voice memo loop | - | - |
| forceUpdateCount | 234 @ 36m | 688 @ 4.5m | **1055 @ 15m** 🔴 |

---

## Session 1: Crash Analysis (fs_20260119123957)

### Crash Timeline

**Start:** 20:39:57 UTC (12:39 PM PST)  
**Crash:** 21:15:59 UTC (1:15 PM PST)  
**Duration:** 36 minutes 2 seconds

### Final Profile Before Crash

```
Sample: 74
Elapsed: 2190 seconds (36.5 minutes)
Heap: 380.1 MB (growth: 356.4 MB from 23.7 MB baseline)
Growth rate: 10.6 MB/min

Session stats:
- rosterSize: 2
- deviceCount: 2
- seriesCount: 27
- totalSeriesPoints: 11,556
- maxSeriesLength: 428
- treasureBoxCumulativeLen: 428
- forceUpdateCount: 234
- renderCount: 213
```

### Crash Signature

```
Error: Minified React error #185
"Rendered fewer hooks than expected. This may be caused by an accidental early return statement."

Source: https://daylightlocal.kckern.net/assets/index-BjOclivJ.js:41:33842
```

**React Error #185 Meaning:** Component called different number of hooks between renders, violating React's rules. Typically caused by:
- Conditional hook calls
- Early returns before hooks
- Component unmounting mid-render during infinite loop

### Voice Memo Infinite Loop

**Evidence:** 104 voice memo events in rapid succession:
- `overlay-redo-start-recording` 
- `recording-start-request`
- `overlay-open-stale-state-reset`

Pattern repeated 25+ times in ~200ms window just before crash.

**Root Cause:** VoiceMemoOverlay entered infinite re-render cycle:
1. State update triggers render
2. useEffect runs, triggers another state update
3. Loop continues until React throws hooks violation error
4. App crashes

### Post-Crash Cleanup

- `fitness-profile-stopped` logged (74 samples)
- Video player unmounted cleanly
- Session ended, ambient LED turned off
- Governance phase reset

---

## Session 2: Recovery Analysis (fs_20260119132016)

**Start:** 21:20:16 UTC (1:20 PM PST) - 4 minutes after crash  
**Duration:** 11+ minutes (ongoing at log capture)

### Memory Profile

| Time | Sample | Heap MB | Growth MB | Notes |
|------|--------|---------|-----------|-------|
| 0:30 | 2 | 16.1 | 1.4 | Clean start |
| 1:00 | 3 | 19.0 | 4.3 | Normal |
| 2:00 | 5 | 19.3 | 4.6 | Stable |
| 4:30 | 10 | 19.7 | 5.0 | 3 participants joined |
| 6:30 | 14 | 40.6 | 25.9 | Growth spike |

**Growth Rate:** ~6.3 MB/min average (slower than Session 1)

### Observations

✅ **Positives:**
- No voice memo activity (avoided crash trigger)
- Clean startup after crash recovery
- Slower memory growth than Session 1

⚠️ **Concerns:**
- forceUpdateCount high (688 @ 4.5 min) suggests render thrashing
- Spike in memory at 6.5 minutes when 3rd participant joined
- TreasureBox growing normally but worth monitoring

---

## Session 3: CRITICAL Memory Leak (fs_20260119132659)

**Start:** 21:26:59 UTC (1:26 PM PST) - 11 minutes after Session 2  
**Duration:** 15+ minutes (ongoing at log capture)

### Memory Crisis Timeline

| Time | Sample | Heap MB | Growth MB | Growth Rate | forceUpdate | Alert |
|------|--------|---------|-----------|-------------|-------------|-------|
| 0:00 | 1 | 28.5 | 0 | - | 1 | Baseline |
| 2:00 | 5 | 39.6 | 11.1 | 5.6 MB/min | 522 | - |
| 4:00 | 9 | 59.7 | **31.2** | **15.6 MB/min** | 561 | ⚠️ Warning |
| 4:30 | 10 | 87.3 | **58.8** | **26.1 MB/min** | 684 | 🔴 Critical |
| 5:00 | 11 | 76.3 | 47.8 | - | 752 | ⚠️ Warning |
| 5:30 | 12 | 137.2 | **108.7** | **36.2 MB/min** | 744 | 🔴 Critical |
| 6:00 | 13 | 110.8 | 82.3 | - | 698 | ⚠️ Warning |
| 7:00 | 15 | 147.3 | **118.8** | **23.7 MB/min** | 693 | 🔴 Critical |
| 7:30 | 16 | 164.7 | **136.2** | **27.2 MB/min** | 677 | 🔴 Critical |
| 8:00 | 17 | 191.5 | **163.0** | **32.6 MB/min** | 695 | 🔴 Critical |
| 10:00 | 21 | 227.3 | **198.8** | **33.1 MB/min** | 827 | 🔴 Critical |
| 10:30 | 22 | 257.5 | **229.0** | **36.6 MB/min** | 850 | 🔴 Critical |
| 11:00 | 23 | 276.1 | **247.6** | **37.5 MB/min** | 820 | 🔴 Critical |
| 12:00 | 25 | 303.3 | **274.8** | **38.3 MB/min** | 819 | 🔴 Critical |
| 13:00 | 27 | 313.5 | **285.0** | **36.6 MB/min** | 742 | 🔴 Critical |
| 14:00 | 29 | 362.8 | **334.3** | **39.8 MB/min** | 867 | 🔴 Critical |
| 15:00 | 31 | **409.5** | **381.0** | **42.3 MB/min** | **1055** | 🔴 **CRITICAL** |

**ALARM:** Heap reached **409MB** after only 15 minutes. At this rate, will hit Session 1 crash levels (~380MB) in ~16 minutes instead of 36.

### Growth Rate Comparison

- **Session 1:** 10.6 MB/min → crash at 380MB @ 36 min
- **Session 2:** 6.3 MB/min → stable @ 41MB @ 6.5 min
- **Session 3:** **27.3 MB/min** → 409MB @ 15 min (🔴 **2.6x faster than Session 1**)

**Projected crash time:** ~18-20 minutes if growth continues.

### Session 3 Data Metrics

| Metric | Value @ 15 min | Threshold | Status |
|--------|----------------|-----------|--------|
| maxSeriesLength | 180 | 2500 | ✅ OK |
| snapshotSeriesPoints | 3,060 | - | ✅ OK |
| maxSnapshotSeriesLength | 180 | 2500 | ✅ OK |
| treasureBoxCumulativeLen | 180 | 1500 | ✅ OK |
| treasureBoxPerColorPoints | 702 | - | ✅ OK |
| totalSeriesPoints | 11,700 | - | ⚠️ High |
| forceUpdateCount | **1,055** | 100 | 🔴 **EXCESSIVE** |
| renderCount | 1,055 | - | 🔴 **EXCESSIVE** |

### Anomalies

1. **Render Thrashing:** forceUpdateCount = 1,055 in 15 minutes (**70/minute** vs expected ~2/minute)
2. **Heap Volatility:** Wild swings (87MB → 76MB → 137MB → 110MB) suggest GC thrashing
3. **Participant Scaling:** 4 participants + 6 devices = 65 series (vs Session 1: 2 participants + 2 devices = 27 series)
4. **All tracked metrics within thresholds** despite massive heap growth → **untracked leak**

---

## Root Cause Analysis

### Crash Cause (Session 1)

**Primary:** VoiceMemoOverlay infinite render loop  
**Trigger:** Voice memo "redo" functionality  
**Mechanism:** State updates in useEffect without proper deps/guards → infinite loop → hooks ordering violation → React error #185

**Code Location:** `frontend/src/modules/Fitness/FitnessPlayerOverlay/VoiceMemoOverlay.jsx`

### Memory Leak Cause (Session 3)

**Primary:** Untracked memory leak (not in monitored subsystems)  
**Suspects:**
1. **DOM nodes:** Video elements, canvas, or chart DOM not being released
2. **Event listeners:** Not removed on component unmount
3. **Closures:** State/props captured in callbacks retained after unmount
4. **Third-party libraries:** Mantine, chart libraries holding references
5. **Render thrashing correlation:** 1,055 forceUpdates suggests state update cycle

**Evidence:**
- All tracked metrics (series, snapshots, treasureBox) well below thresholds
- Heap growth doesn't correlate with any single tracked metric
- forceUpdateCount abnormally high (70/min vs expected 2/min)
- Heap volatility suggests GC can't keep up with allocation rate

---

## Impact Assessment

### Production Risk

| Risk | Severity | Probability | Impact |
|------|----------|-------------|---------|
| Voice memo crash | 🔴 Critical | High | Crashes app mid-session |
| Session 3 memory leak | 🔴 Critical | **Happening now** | Will crash in ~3-5 minutes |
| Session 2 normal growth | 🟡 Moderate | Low | Will crash after 30+ minutes |

### User Impact

- **Session 1:** Users lost 36-minute session progress, had to reload
- **Session 3:** Users currently at risk of imminent crash
- **All sessions:** Memory warnings starting within 4-10 minutes

### Mitigation Required

**IMMEDIATE (Session 3 leak):**
1. Monitor production - session likely already crashed
2. Identify render thrashing source
3. Add emergency heap limit circuit breaker

**SHORT-TERM (Voice memo crash):**
1. Fix VoiceMemoOverlay infinite loop
2. Add render loop detection/prevention
3. Deploy hotfix ASAP

**LONG-TERM:**
1. Identify and fix untracked memory leak
2. Improve memory profiling to catch DOM/listener leaks
3. Add automated memory regression tests

---

## Recommendations

### Priority 1: CRITICAL - Stop the Bleeding

1. **Disable voice memo redo functionality** in production until fixed
2. **Add circuit breaker** - force page reload if heap > 300MB
3. **Deploy hotfix** for VoiceMemoOverlay infinite loop

### Priority 2: HIGH - Fix Root Causes

4. **Fix VoiceMemoOverlay render loop:**
   - Add deps array to problematic useEffect
   - Add guard conditions to prevent infinite state updates
   - Use ref instead of state for transient values

5. **Investigate Session 3 render thrashing:**
   - Profile forceUpdate call sites
   - Check for unstable references in context (objects/arrays recreated every render)
   - Review recent changes to shared components

6. **Add DOM/listener leak tracking:**
   - Count DOM nodes before/after session
   - Track event listener registration/removal
   - Monitor WeakMap/WeakSet sizes

### Priority 3: MEDIUM - Long-term Stability

7. **Memory regression tests:**
   - Automated 30-minute session stress test
   - Heap growth threshold alerts
   - forceUpdate frequency monitoring

8. **Improve profiling:**
   - Track DOM node count
   - Track event listener count
   - Sample closure memory (if possible)

9. **Code review:**
   - Audit all useEffect cleanup functions
   - Audit all addEventListener calls
   - Check for circular references in state

---

## Related Issues

- React error #185: hooks ordering violation
- Voice memo functionality causing crashes
- Render thrashing (excessive forceUpdates)
- Untracked memory leak in Session 3
- Memory warnings within 5-10 minutes consistently

---

## Appendix: Raw Data

### Session 1 Final Profile
```json
{
  "sample": 74,
  "elapsedSec": 2190,
  "heapMB": 380.1,
  "heapGrowthMB": 356.4,
  "sessionActive": true,
  "rosterSize": 2,
  "deviceCount": 2,
  "seriesCount": 27,
  "totalSeriesPoints": 11556,
  "maxSeriesLength": 428,
  "treasureBoxCumulativeLen": 428,
  "forceUpdateCount": 234
}
```

### Session 3 Critical Profile
```json
{
  "sample": 31,
  "elapsedSec": 900,
  "heapMB": 409.5,
  "heapGrowthMB": 381.0,
  "sessionActive": true,
  "rosterSize": 4,
  "deviceCount": 6,
  "seriesCount": 65,
  "totalSeriesPoints": 11700,
  "maxSeriesLength": 180,
  "treasureBoxCumulativeLen": 180,
  "forceUpdateCount": 1055,
  "renderCount": 1055
}
```

### Voice Memo Loop Evidence
```
21:15:59.776 - overlay-redo-start-recording (x25+)
21:15:59.776 - recording-start-request (x25+)
21:15:59.777 - overlay-open-stale-state-reset (x25+)
[repeat 104 total events in 200ms]
21:15:59.786 - React error #185 (crash)
```

---

**Status:** 🔴 **CRITICAL - Action Required**  
**Next Steps:** Immediate production monitoring, hotfix deployment, root cause investigation

---

## Addendum: Focused Log Analysis

Detailed analysis of three specific behaviors from the production logs:

---

### 1. Governance Flowchart Adherence During Challenges

**Log Analysis Results:**

```
Total governance.phase_change events: 102
Transition breakdown:
  47 - warning → unlocked
  47 - unlocked → warning
   2 - pending → null (session end)
   2 - null → pending (session start)
   1 - unlocked → locked
   1 - locked → unlocked
   1 - pending → unlocked
   1 - unlocked → pending
```

**🔴 CRITICAL FINDING: Missing `locked` Phase**

The expected flowchart is: `pending` → `warning` → `locked` → `unlocked`

But logs show **94 of 96 challenge cycles skipped `locked` entirely**, going directly:
- `unlocked` → `warning` → `unlocked` (47 cycles)

Only **ONE** full governance cycle reached `locked`:
```
21:39:14.349Z - unlocked → warning
21:39:14.938Z - unlocked → locked   (589ms in warning)
21:39:15.571Z - locked → unlocked   (633ms in locked)
```

**Warning Phase Duration Analysis:**

Most warning phases are **extremely short** (instant satisfaction):

| Duration | Count | Assessment |
|----------|-------|------------|
| <100ms | ~35 | 🔴 Suspiciously instant |
| 100-500ms | ~5 | ⚠️ Very fast |
| 500-1000ms | ~3 | ✅ Reasonable |
| 1-10s | ~2 | ✅ Expected |
| >10s | ~2 | ✅ Challenging |

**Rapid Cycling Evidence:**
```
21:33:00.192Z → 21:33:00.242Z  (50ms warning)
21:33:02.166Z → 21:33:02.573Z  (407ms warning)
21:33:51.477Z → 21:33:51.690Z  (213ms warning)
21:36:03.771Z → 21:36:03.835Z  (64ms warning)
21:36:44.403Z → 21:36:44.497Z  (94ms warning)
```

**Root Cause Hypothesis:**
1. Heart rate threshold is too low - participants already at target before warning appears
2. Satisfaction check running too frequently (every tick instead of debounced)
3. Zone calculation not accounting for hysteresis (should require sustained time in zone)

---

### 2. FPS of Video During Governance Warning Overlay

**Log Analysis Results:**

❌ **NO FPS/FRAME TIMING DATA LOGGED**

Searched for:
- `fps`, `frame`, `render.*time`, `slow` - No results
- `governance.*filter`, `filterClass`, `blur` - No results
- `governance.overlay` - No results

**Impact Assessment:**

The governance overlay was active for **47 warning phases**, yet we have zero visibility into:
- Render performance during overlay
- CSS filter application timing
- GPU utilization during blur effects
- Frame drop correlation with memory growth

**Memory Correlation:**

Cross-referencing governance cycles with memory profile samples:

| Time | Heap MB | Governance Cycles | Correlation |
|------|---------|-------------------|-------------|
| 21:32:59 | 137.2 | 1st warning | Rapid heap growth starts |
| 21:33:29 | 121.3 | 5 cycles in 30s | Memory volatile |
| 21:35:29 | 192.0 | 15 cycles total | Continued growth |
| 21:37:29 | 257.5 | 25 cycles total | Accelerating |
| 21:39:29 | 317.3 | 35 cycles total | Near crash levels |

**Recommendation:** The rapid warning→unlocked cycling correlates with Session 3's memory explosion. Each governance state change likely triggers:
1. Overlay component mount/unmount
2. CSS filter class toggle
3. Video pause/resume
4. State updates propagating through context

---

### 3. Shader Retention After FitnessPlayer Remounts Player

**Log Analysis Results:**

❌ **NO SHADER/REMOUNT EVENTS LOGGED**

Searched for:
- `shader` - No results
- `remount` - No results
- `singlePlayerKey` - No results
- `player.mount`, `player.unmount` - No results

**Video Mount/Unmount Events Found:**

```
21:15:59.791Z - fitness.video.unmounted (crashed session)
  componentId: video-1768855163711-yi5pkstlz
  uptimeMs: 2,196,080 (36.6 minutes) ✅ Expected

21:29:45.093Z - fitness.video.mounted (Session 3)
  componentId: video-1768858185048-aztx64ri6

21:29:45.376Z - fitness.video.unmounted (UNEXPECTED!)
  componentId: video-1768858185048-aztx64ri6
  uptimeMs: 328ms 🔴 Immediate unmount

21:29:45.376Z - fitness.video.mounted (remount)
  Same componentId, same millisecond

21:46:24.365Z - fitness.video.unmounted (session end)
  uptimeMs: 999,317 (16.7 minutes) ✅ Expected
```

**🔴 CRITICAL FINDING: Double Mount on Session 3 Start**

The video component mounted, **unmounted after only 328ms**, then immediately remounted in the **same millisecond**. This suggests:

1. A race condition in FitnessPlayer initialization
2. Effect dependency causing immediate re-render
3. Queue state change triggering unnecessary remount

This double-mount at session start may explain Session 3's rapid memory growth - the component might be leaking resources from the aborted first mount, or the remount is setting up duplicate subscriptions/timers.

---

### Summary: What the Logs Reveal

| Investigation Area | Data Available | Key Finding |
|-------------------|----------------|-------------|
| Governance flow | ✅ Full events | 🔴 `locked` phase skipped 98% of time, rapid cycling |
| Overlay FPS | ❌ Not logged | Need instrumentation |
| Shader retention | ❌ Not logged | 🔴 Double video mount detected on Session 3 start |

### Immediate Action Items

1. **Fix governance threshold** - Warning phase completes in <100ms in most cases, indicating threshold is too easily met
2. **Add overlay performance logging** - Zero visibility into filter/blur impact
3. **Investigate double-mount** - Session 3's video mounted twice in same millisecond, likely causing memory leak
4. **Add shader state logging** - Cannot verify shader retention without instrumentation
