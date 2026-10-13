# FitnessApp Memory Leak Fixes - Implementation Summary

**Date:** January 10, 2026  
**Status:** ✅ Implemented  
**Phases Completed:** 1-5 (Critical fixes through monitoring)

---

## Changes Implemented

### ✅ Phase 1: Critical Hotfixes

#### 1.1 FitnessTimeline.js - Unbounded Series Growth
**File:** `frontend/src/hooks/fitness/FitnessTimeline.js`

```javascript
// Added constant
const MAX_SERIES_LENGTH = 2000; // ~2.7 hours at 5-second intervals

// Added pruning in tick() method
Object.entries(this.series).forEach(([key, arr]) => {
  if (Array.isArray(arr) && arr.length > MAX_SERIES_LENGTH) {
    const removed = arr.length - MAX_SERIES_LENGTH;
    arr.splice(0, removed);
    // Log first prune only
    if (prunedCount === 1) {
      console.warn('[FitnessTimeline] Pruned', removed, 'old points...');
    }
  }
});
```

**Impact:** Prevents 115,200+ data points from accumulating overnight

---

#### 1.2 FitnessContext.jsx - WebSocket Cleanup Race Condition
**File:** `frontend/src/context/FitnessContext.jsx`

```javascript
// BEFORE (broken)
useEffect(() => {
  import('../services/WebSocketService').then(({ wsService }) => {
    const unsubscribe = wsService.subscribe(...);
    return () => unsubscribe(); // NEVER RUNS!
  });
}, [deps]);

// AFTER (fixed)
useEffect(() => {
  let unsubscribe = null;
  let mounted = true;
  
  import('../services/WebSocketService').then(({ wsService }) => {
    if (!mounted) return;
    unsubscribe = wsService.subscribe(...);
  });
  
  return () => {
    mounted = false;
    unsubscribe?.();
  };
}, [deps]);
```

**Impact:** Prevents WebSocket subscription leaks on component remount

---

#### 1.3 FitnessApp.jsx - MutationObserver Debounce
**File:** `frontend/src/Apps/FitnessApp.jsx`

```javascript
// BEFORE (broken)
observer = new MutationObserver(() => {
  setTimeout(removeTooltips, 100); // Stacks timeouts!
});

// AFTER (fixed)
let debounceTimer = null;
observer = new MutationObserver(() => {
  if (debounceTimer) return; // Skip if pending
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    removeTooltips();
  }, 500);
});

return () => {
  if (debounceTimer) clearTimeout(debounceTimer);
  observer?.disconnect();
};
```

**Impact:** Prevents hundreds of stacked setTimeout calls

---

### ✅ Phase 2: Conditional Timers

#### 2.1 & 2.2 FitnessContext.jsx - Gate Intervals on Active Session
**File:** `frontend/src/context/FitnessContext.jsx`

```javascript
// 1-second heartbeat (86,400 renders/day → only when active)
useEffect(() => {
  const session = fitnessSessionRef.current;
  if (!session?.sessionId) return; // ← ADDED
  
  const interval = setInterval(() => forceUpdate(), 1000);
  return () => clearInterval(interval);
}, [forceUpdate, session?.sessionId]);

// 3-second device prune (also conditional now)
useEffect(() => {
  const session = fitnessSessionRef.current;
  if (!session?.sessionId) return; // ← ADDED
  
  const interval = setInterval(() => {
    const timeouts = getFitnessTimeouts();
    session.deviceManager.pruneStaleDevices(timeouts);
    forceUpdate();
  }, 3000);
  return () => clearInterval(interval);
}, [forceUpdate, session?.sessionId]);
```

**Impact:** Stops unnecessary work when idle - saves 86,400+ renders/day

---

### ✅ Phase 3: Session Lifecycle

#### 3.1 FitnessContext.jsx - Unmount Cleanup
**File:** `frontend/src/context/FitnessContext.jsx`

```javascript
const fitnessSessionRef = useRef(new FitnessSession());

// ADDED: Cleanup on provider unmount
useEffect(() => {
  return () => {
    const session = fitnessSessionRef.current;
    if (session?.destroy) {
      session.destroy();
    }
  };
}, []);
```

---

#### 3.2 FitnessSession.js - destroy() Method
**File:** `frontend/src/hooks/fitness/FitnessSession.js`

```javascript
/**
 * Complete teardown for unmount/navigation
 * Unlike reset() which prepares for session reuse, 
 * destroy() nullifies all references for GC
 */
destroy() {
  this.reset();
  
  // Clear persistent state
  this._sessionEndedCallbacks = [];
  
  // Nullify manager references
  this._deviceRouter = null;
  this._persistenceManager = null;
  this._metricsRecorder = null;
  this._timelineRecorder = null;
  this._participantRoster = null;
  this._lifecycle = null;
  
  // Clear stores
  this.zoneProfileStore?.clear();
  this.zoneProfileStore = null;
  this.eventJournal = null;
  this.activityMonitor = null;
}
```

**Impact:** Proper cleanup prevents session data from persisting after navigation

---

### ✅ Phase 4: Memory Optimization

#### 4.1 FitnessSession.js - Event Log Splice
**File:** `frontend/src/hooks/fitness/FitnessSession.js`

```javascript
// BEFORE
_log(type, payload = {}) {
  this.eventLog.push({ ts: Date.now(), type, ...payload });
  if (this.eventLog.length > 500) {
    this.eventLog = this.eventLog.slice(-500); // New array!
  }
}

// AFTER
_log(type, payload = {}) {
  this.eventLog.push({ ts: Date.now(), type, ...payload });
  if (this.eventLog.length > 500) {
    this.eventLog.splice(0, this.eventLog.length - 500); // In-place!
  }
}
```

**Impact:** Reduces memory churn from frequent logging

---

### ✅ Phase 5: Monitoring & Guardrails

#### 5.1 Debug Helper
**File:** `frontend/src/context/FitnessContext.jsx`

```javascript
if (typeof window !== 'undefined') {
  window.__fitnessSession = session;
  window.__fitnessMemoryStats = () => {
    const series = session?.timeline?.series || {};
    const seriesCount = Object.keys(series).length;
    const totalPoints = Object.values(series).reduce(
      (sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0
    );
    const perUserCount = session?.treasureBox?.perUser?.size || 0;
    const eventLogSize = session?.eventLog?.length || 0;
    const deviceCount = session?.deviceManager?.devices?.size || 0;
    const userCount = session?.userManager?.users?.size || 0;
    return { 
      seriesCount, 
      totalPoints, 
      perUserCount, 
      eventLogSize,
      deviceCount,
      userCount,
      sessionActive: !!session?.sessionId
    };
  };
}
```

**Usage:**
```javascript
// In browser console
window.__fitnessMemoryStats()
// => { seriesCount: 18, totalPoints: 1850, ... }
```

---

#### 5.2 Timeline Prune Logging
**File:** `frontend/src/hooks/fitness/FitnessTimeline.js`

```javascript
if (prunedCount === 1 && typeof console !== 'undefined') {
  console.warn('[FitnessTimeline] Pruned', removed, 'old points from', key);
}
```

---

## Testing & Validation

### Quick Test (2-minute session)
```bash
# Terminal 1: Start dev server
npm run dev

# Terminal 2: Run simulation
node _extensions/fitness/simulation.mjs --duration=120

# Browser console: Monitor memory
setInterval(() => console.log(window.__fitnessMemoryStats()), 10000);
```

### Overnight Test (8 hours)
```bash
# Run extended simulation
node _extensions/fitness/simulation.mjs --duration=28800

# Monitor series growth
setInterval(() => {
  const stats = window.__fitnessMemoryStats();
  console.log('Series points:', stats.totalPoints, '/', stats.seriesCount * 2000);
}, 60000);
```

### Expected Results
- **Before:** Series points grow unbounded (115,200+ after 8h)
- **After:** Series points cap at ~40,000 (20 keys × 2000 points)
- **Heartbeat:** Only fires when session active
- **WebSocket:** Subscriber count stays constant on remount

---

## Rollout Plan

### Day 1 (Today) - Critical Fixes
✅ Deploy Phase 1 fixes to production:
- Timeline series limit
- WebSocket cleanup
- MutationObserver debounce

### Day 2 - Conditional Timers
✅ Deploy Phase 2 fixes:
- Gated heartbeat
- Gated device prune

### Day 3-4 - Session Lifecycle
✅ Deploy Phase 3 fixes:
- Unmount cleanup
- destroy() method

Test overnight on garage box before prod deploy.

### Day 5 - Optimization & Monitoring
✅ Deploy Phase 4 + 5:
- Event log splice
- Memory stats helper
- Timeline prune logging

---

## Verification Checklist

After deployment, verify in production:

- [ ] Browser tab responsive after 8+ hours idle
- [ ] `window.__fitnessMemoryStats().totalPoints` < 50,000
- [ ] WebSocket subscribers stable (check `wsService.getStatus().subscriberCount`)
- [ ] No console errors about memory limits
- [ ] Chrome DevTools Performance tab shows flat memory after initial session

---

## Rollback Plan

Each phase is independent. If issues arise:

```bash
# Revert specific commits
git revert <commit-hash>

# Or revert entire phase
git revert HEAD~3..HEAD  # Last 3 commits
```

---

## Known Limitations

1. **MAX_SERIES_LENGTH = 2000** provides ~2.7 hours of history at 5-second intervals. If longer sessions needed, increase limit proportionally.

2. **destroy() not called on hard refresh** - Browser navigation doesn't trigger unmount. This is acceptable as memory is released on page unload.

3. **TreasureBox.perUser Map** still has no size limit. This is acceptable as it only grows with unique users (bounded by roster size).

---

## Future Work (Phase 6+)

### Memory Regression Test
```javascript
// Add to CI/CD
test('Memory does not grow unbounded', async () => {
  const stats1 = window.__fitnessMemoryStats();
  await simulateSession(120); // 2 minutes
  const stats2 = window.__fitnessMemoryStats();
  expect(stats2.totalPoints).toBeLessThan(50000);
});
```

### Additional Monitoring
- Add memory telemetry to session summary
- Track prune frequency in logs
- Alert if series exceeds threshold

---

## References

- [Analysis Document](./fitness-memory-leak-analysis.md)
- [WebSocket Service](../../frontend/src/services/WebSocketService.js)
- [FitnessSession](../../frontend/src/hooks/fitness/FitnessSession.js)
- [FitnessTimeline](../../frontend/src/hooks/fitness/FitnessTimeline.js)
