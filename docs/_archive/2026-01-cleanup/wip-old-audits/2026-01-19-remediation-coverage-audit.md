# Remediation Coverage Audit

**Date:** 2026-01-19
**Purpose:** Evaluate which issues from the comprehensive crash/memory audit were addressed by the remediation plan, and which remain open.

---

## Source Audits

- `docs/_wip/audits/2026-01-19-fitness-memory-audit.md` - Initial audit (simpler)
- `docs/_wip/audits/2026-01-19-fitness-crash-and-memory-audit.md` - Comprehensive audit (3 sessions)

## Remediation Completed

**Plan:** `docs/plans/2026-01-19-fitness-memory-remediation.md`

| Commit | Fix |
|--------|-----|
| `361cdf69` | VoiceMemoOverlay stale state cooldown (500ms) |
| `05423b37` | FitnessTimeline pruning tests |
| `4ca06b57` | TreasureBox pruning tests |
| `90f2bf6d` | Snapshot series pruning tests |
| `c5d7b8b4` | Lower warning thresholds (20MB, 1500, 800) |
| `a53bbd63` | Memory profiling runbook |

---

## Coverage Analysis

### ADDRESSED

| Issue | Severity | Fix Applied | Effectiveness |
|-------|----------|-------------|---------------|
| VoiceMemoOverlay infinite loop (104 events in 200ms) | Critical | 500ms cooldown between stale resets | Prevents rapid-fire loops |
| Warning thresholds too high | Medium | Lowered to 20MB/1500/800 | Earlier detection |
| Pruning behavior undocumented | Low | Added test coverage | Regression prevention |
| No operational runbook | Low | Created `fitness-memory-profiling.md` | Investigation procedures |

### NOT ADDRESSED

| Issue | Severity | Status | Notes |
|-------|----------|--------|-------|
| **Session 3 untracked memory leak** | Critical | Open | 409MB in 15 min, 27.3 MB/min growth. All tracked metrics within thresholds - leak is NOT in series/treasurebox/snapshot data |
| **Render thrashing (forceUpdateCount)** | Critical | Open | 1055 forceUpdates in 15 min (70/min vs expected 2/min). Root cause unknown |
| **Governance rapid cycling** | High | Open | `locked` phase skipped 98% of time. Warning phases completing in <100ms |
| **Double video mount on session start** | High | Open | Video mounted, unmounted after 328ms, remounted in same millisecond |
| **Missing FPS/frame timing logging** | Medium | Open | Zero visibility into overlay render performance |
| **Missing shader/remount logging** | Medium | Open | Cannot verify shader state retention |
| **DOM/event listener leak tracking** | Medium | Open | No instrumentation for these leak sources |
| **Circuit breaker (heap > 300MB)** | Medium | Open | No automatic protection against crashes |

---

## Critical Gap: Session 3's Memory Explosion

The comprehensive audit reveals Session 3 had **2.6x faster** memory growth than Session 1:

| Session | Growth Rate | Crash/Current Heap |
|---------|-------------|-------------------|
| Session 1 | 10.6 MB/min | 380MB @ 36 min (crashed) |
| Session 3 | **27.3 MB/min** | 409MB @ 15 min |

**Key insight:** All tracked metrics (series, snapshots, treasureBox) were **within thresholds** in Session 3, yet heap exploded. This means:

1. The leak is NOT in the data structures we're monitoring
2. Likely candidates: DOM nodes, event listeners, closures, or third-party libraries
3. The `forceUpdateCount = 1055` correlation suggests render thrashing is related

### Suspects Not Yet Investigated

1. **Governance state cycling** - 47 rapid warning→unlocked transitions may cause:
   - Overlay component mount/unmount cycles
   - CSS filter class toggles
   - Video pause/resume cycles
   - Context state propagation

2. **Double video mount** - Session 3's video mounted twice in same millisecond:
   ```
   21:29:45.093Z - fitness.video.mounted
   21:29:45.376Z - fitness.video.unmounted (328ms later!)
   21:29:45.376Z - fitness.video.mounted (same ms as unmount)
   ```
   Could cause duplicate subscriptions/timers

3. **Untracked memory sources:**
   - Chart library (Highcharts) DOM retention
   - Video element buffer memory
   - Canvas rendering contexts
   - WebSocket message queues

---

## Recommendations: Next Phase

### Priority 1: Critical - Session 3 Leak

1. **Profile forceUpdate call sites**
   - Add logging to `_notifyMutation()` in FitnessSession
   - Track what triggers each forceUpdate
   - Goal: Understand why 70/min instead of 2/min

2. **Investigate governance cycling**
   - Why is `locked` phase being skipped?
   - Why are warning phases completing in <100ms?
   - Add hysteresis to prevent rapid state oscillation

3. **Fix double video mount**
   - Find the race condition in FitnessPlayer initialization
   - Ensure single mount per session

### Priority 2: High - Instrumentation

4. **Add DOM node counting**
   - Track `document.querySelectorAll('*').length` in profile
   - Compare before/after session

5. **Add event listener tracking**
   - Instrument addEventListener/removeEventListener
   - Detect orphaned listeners

6. **Add circuit breaker**
   - Force page reload if heap > 350MB
   - Log crash prevention event

### Priority 3: Medium - Observability

7. **Add FPS logging during governance overlay**
8. **Add shader state logging**
9. **Profile third-party library memory (Highcharts, video.js)**

---

## Summary

| Category | Issues | Addressed | Open |
|----------|--------|-----------|------|
| Crash prevention | 2 | 1 (50%) | 1 |
| Memory monitoring | 3 | 2 (67%) | 1 |
| Root cause fixes | 4 | 0 (0%) | 4 |
| Instrumentation | 4 | 0 (0%) | 4 |

**Bottom line:** The remediation plan addressed the **immediate crash vector** (VoiceMemoOverlay loop) and improved **early warning detection**, but the **root cause of Session 3's memory explosion** remains unidentified and unfixed. The render thrashing (1055 forceUpdates) and governance rapid cycling are strong correlates that need investigation.
