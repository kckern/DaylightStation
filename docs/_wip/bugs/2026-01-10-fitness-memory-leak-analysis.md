# FitnessApp Memory Leak Analysis

**Date:** January 10, 2026  
**Symptom:** Browser tab hangs after leaving FitnessApp open overnight  
**Severity:** Critical

---

## Executive Summary

After comprehensive analysis of `FitnessApp.jsx`, `FitnessContext.jsx`, `FitnessSession.js`, and related modules, I've identified **12 memory leak vectors** ranked by severity. The most critical issues are:

1. **Unbounded timeline series growth** (no max length enforcement)
2. **1-second heartbeat interval never stops** (runs indefinitely)
3. **MutationObserver runs on every DOM change** (performance drain)
4. **WebSocket subscription cleanup race condition**
5. **FitnessSession never destroyed** (ref persists across provider lifecycle)

---

## 🔴 CRITICAL: Highest Priority Leaks

### 1. Unbounded Timeline Series Growth (FitnessTimeline.js)

**Location:** [FitnessTimeline.js](frontend/src/hooks/fitness/FitnessTimeline.js#L67-L68)

```javascript
// Current code - NO SIZE LIMIT
tick(metricsSnapshot = {}, options = {}) {
  const tickIndex = this.timebase.tickCount;
  // ...
  providedKeys.forEach((key) => {
    const seriesRef = this._getOrCreateSeries(key, tickIndex);
    seriesRef[tickIndex] = normalizedSnapshot[key];  // Grows forever!
  });
}
```

**Problem:** Each 5-second tick adds data points to every tracked series. With multiple users and metrics (HR, zone, coins, RPM), this creates:
- ~720 ticks/hour × ~20 series keys = **14,400 data points/hour**
- Overnight (8 hours) = **115,200+ data points**

**Note:** `TreasureBox.js` has `MAX_TIMELINE_POINTS = 1000` but `FitnessTimeline.js` has **no such limit**.

**Fix:**
```javascript
const MAX_SERIES_LENGTH = 2000; // ~2.7 hours at 5-second intervals

tick(metricsSnapshot = {}, options = {}) {
  // After tick, prune old data
  Object.values(this.series).forEach(arr => {
    if (arr.length > MAX_SERIES_LENGTH) {
      arr.splice(0, arr.length - MAX_SERIES_LENGTH);
    }
  });
}
```

---

### 2. FitnessContext 1-Second Heartbeat Never Stops

**Location:** [FitnessContext.jsx](frontend/src/context/FitnessContext.jsx#L815-L820)

```javascript
// Lightweight heartbeat to refresh UI
useEffect(() => {
  const interval = setInterval(() => {
    forceUpdate();  // Runs FOREVER while app is open
  }, 1000);
  return () => clearInterval(interval);
}, [forceUpdate]);
```

**Problem:** This interval triggers a React re-render every second, even when:
- No session is active
- No devices are connected  
- The app is idle overnight

**Impact:** 
- 86,400 unnecessary renders per day
- Each render recalculates all memoized values
- Compounds with other listeners creating update cascades

**Fix:**
```javascript
useEffect(() => {
  // Only run heartbeat when session is active
  if (!session?.sessionId) return;
  
  const interval = setInterval(() => {
    forceUpdate();
  }, 1000);
  return () => clearInterval(interval);
}, [forceUpdate, session?.sessionId]);
```

---

### 3. Device Prune Interval (3-second) Runs Without Session

**Location:** [FitnessContext.jsx](frontend/src/context/FitnessContext.jsx#L944-L953)

```javascript
useEffect(() => {
  const interval = setInterval(() => {
    const timeouts = getFitnessTimeouts();
    const session = fitnessSessionRef.current;
    if (session) {  // This is always truthy - ref exists!
      session.deviceManager.pruneStaleDevices(timeouts);
      forceUpdate();
    }
  }, 3000);
  return () => clearInterval(interval);
}, [forceUpdate]);
```

**Problem:** `fitnessSessionRef.current` is always truthy because the ref exists. The check should be `session.sessionId`:

```javascript
if (session?.sessionId) {
  session.deviceManager.pruneStaleDevices(timeouts);
  forceUpdate();
}
```

---

### 4. MutationObserver Hammer

**Location:** [FitnessApp.jsx](frontend/src/Apps/FitnessApp.jsx#L153-L170)

```javascript
observer = new MutationObserver(() => {
  // Debounce the tooltip removal to avoid performance issues
  setTimeout(removeTooltips, 100);  // Creates new timeout on EVERY mutation!
});

observer.observe(document.body, { 
  childList: true, 
  subtree: true, 
  attributes: true, 
  attributeFilter: ['title', 'alt'] 
});
```

**Problem:** 
- Observes ALL DOM changes in the entire document body
- Creates a new `setTimeout` for every mutation
- `removeTooltips()` queries ALL elements with title/alt on every call
- No debounce tracking - can stack hundreds of pending timeouts

**Fix:**
```javascript
let debounceTimer = null;
observer = new MutationObserver(() => {
  if (debounceTimer) return;  // Skip if already pending
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    removeTooltips();
  }, 500);
});

// Cleanup must also clear debounceTimer
return () => {
  if (debounceTimer) clearTimeout(debounceTimer);
  observer?.disconnect();
};
```

---

### 5. FitnessSession Never Destroyed

**Location:** [FitnessContext.jsx](frontend/src/context/FitnessContext.jsx#L194)

```javascript
const fitnessSessionRef = useRef(new FitnessSession());
```

**Problem:** `FitnessSession` is created once and NEVER destroyed. It contains:
- `timeline` object with unbounded series
- `treasureBox` with Maps
- `deviceManager` with device history
- `userManager` with user Maps
- `governanceEngine` with timers
- `eventJournal` with event arrays

When the component unmounts (navigation away), there's no cleanup:

```javascript
// MISSING CLEANUP!
useEffect(() => {
  return () => {
    fitnessSessionRef.current?.reset();
    fitnessSessionRef.current?.governanceEngine?.reset();
    // Clear all timers, Maps, arrays
  };
}, []);
```

---

## 🟠 HIGH: Secondary Leak Vectors

### 6. WebSocket Dynamic Import Creates Closure Leak

**Location:** [FitnessContext.jsx](frontend/src/context/FitnessContext.jsx#L910-L941)

```javascript
useEffect(() => {
  import('../services/WebSocketService').then(({ wsService }) => {
    const unsubscribe = wsService.subscribe(/* ... */);
    const unsubscribeStatus = wsService.onStatusChange(/* ... */);
    
    return () => {  // This cleanup NEVER runs!
      unsubscribe();
      unsubscribeStatus();
    };
  });
}, [/* deps */]);
```

**Problem:** The cleanup function returned inside `.then()` is never executed! The `useEffect` cleanup must be synchronous.

**Fix:**
```javascript
useEffect(() => {
  let unsubscribe = null;
  let unsubscribeStatus = null;
  let mounted = true;
  
  import('../services/WebSocketService').then(({ wsService }) => {
    if (!mounted) return;
    unsubscribe = wsService.subscribe(/* ... */);
    unsubscribeStatus = wsService.onStatusChange(/* ... */);
  });
  
  return () => {
    mounted = false;
    unsubscribe?.();
    unsubscribeStatus?.();
    Object.values(vibrationTimeoutRefs.current || {}).forEach(clearTimeout);
  };
}, [/* deps */]);
```

---

### 7. Vibration Timeout Refs Accumulate

**Location:** [FitnessContext.jsx](frontend/src/context/FitnessContext.jsx#L892-L900)

```javascript
vibrationTimeoutRefs.current[equipmentId] = setTimeout(() => {
  // ...
}, VIBRATION_CONSTANTS.ACTIVE_STATE_MS);
```

**Problem:** `vibrationTimeoutRefs.current` object grows unboundedly as new equipment IDs are seen. Old equipment keys are never cleaned up.

**Fix:** Add periodic cleanup or limit Map size.

---

### 8. Event Log Grows to 500 Entries

**Location:** [FitnessSession.js](frontend/src/hooks/fitness/FitnessSession.js#L488-L491)

```javascript
_log(type, payload = {}) {
  this.eventLog.push({ ts: Date.now(), type, ...payload });
  if (this.eventLog.length > 500) {
    this.eventLog = this.eventLog.slice(-500);  // Creates new array every time!
  }
}
```

**Problem:** `slice()` creates a new array allocation. With frequent logging, this causes memory churn.

**Fix:**
```javascript
if (this.eventLog.length > 500) {
  this.eventLog.splice(0, this.eventLog.length - 500);  // In-place mutation
}
```

---

### 9. Session `_sessionEndedCallbacks` Never Cleared

**Location:** [FitnessSession.js](frontend/src/hooks/fitness/FitnessSession.js#L1845)

```javascript
// Note: Don't clear _sessionEndedCallbacks - they persist across sessions
```

**Problem:** Callbacks registered via `onSessionEnded()` accumulate if components re-register without cleanup.

---

### 10. TreasureBox perUser Map Migration Leak

**Location:** [TreasureBox.js](frontend/src/hooks/fitness/TreasureBox.js#L286-L297)

```javascript
// Migration shim: if legacy entity-key accumulators exist, migrate them
const legacyEntityKeysToDelete = [];
for (const [key, acc] of this.perUser.entries()) {
  if (!key?.startsWith?.('entity-')) continue;
  // ...migration logic...
  legacyEntityKeysToDelete.push(key);
}
// BUG: legacyEntityKeysToDelete is never used to delete keys!
```

**Problem:** Migration identifies keys to delete but never deletes them!

---

## 🟡 MEDIUM: Contributing Factors

### 11. GovernanceEngine Timers

**Location:** [GovernanceEngine.js](frontend/src/hooks/fitness/GovernanceEngine.js#L537-L543)

The `GovernanceEngine` has proper timer cleanup in `_clearTimers()` and `reset()`, but these are only called on explicit session end. If a session is abandoned (tab left open without proper end), timers continue running.

### 12. Cumulative Beat/Rotation Maps Never Shrink

**Location:** [FitnessSession.js](frontend/src/hooks/fitness/FitnessSession.js#L1861-L1862)

```javascript
this._cumulativeBeats = new Map();
this._cumulativeRotations = new Map();
```

These are reset on `reset()` but device keys accumulate during a session.

---

## `fitnessSession` Teardown Analysis

The `fitnessSession` (exposed as `session?.summary`) is a getter that calls `FitnessSession.summary`:

```javascript
// FitnessContext.jsx line 1832
fitnessSession: session?.summary
```

### Summary Getter Issues:

1. **Called on every render** - No memoization, recalculates everything
2. **Creates deep clones** - `deviceAssignments`, `entities`, `roster` all cloned
3. **Timeline summary** - Recomputes series statistics each call

### Reset() Coverage:

```javascript
reset() {
  this.sessionId = null;
  this.startTime = null;
  this.endTime = null;
  this.activeDeviceIds.clear();
  this.eventLog = [];
  this.treasureBox?.stop();
  this.treasureBox = null;
  this.voiceMemoManager.reset();
  this.userManager = new UserManager();  // NEW instance
  this.deviceManager = new DeviceManager();  // NEW instance
  this.entityRegistry.reset();
  this._stopAutosaveTimer();
  this._stopTickTimer();
  this.governanceEngine.reset();
  this.timeline?.reset();
  this.timeline = null;
  // ...
}
```

**Missing from reset():**
- `_sessionEndedCallbacks` (intentionally kept but can leak)
- `_deviceRouter` handlers
- `_persistenceManager` state
- `zoneProfileStore` cache (has separate `clear()`)

---

## Recommended Fix Priority

| Priority | Issue | Effort | Impact |
|----------|-------|--------|--------|
| P0 | Timeline series unbounded growth | Low | Critical |
| P0 | WebSocket cleanup race condition | Low | Critical |
| P1 | 1-second heartbeat conditional | Low | High |
| P1 | MutationObserver debounce fix | Low | High |
| P1 | 3-second prune interval conditional | Low | Medium |
| P2 | FitnessSession unmount cleanup | Medium | High |
| P2 | Vibration timeout ref cleanup | Low | Medium |
| P3 | Event log splice optimization | Low | Low |
| P3 | TreasureBox migration key deletion | Low | Low |

---

## Quick Wins (< 30 min each)

1. **Add `MAX_SERIES_LENGTH` to FitnessTimeline** - Copy pattern from TreasureBox
2. **Fix WebSocket cleanup** - Move cleanup outside `.then()`
3. **Gate heartbeat on session active** - Add `session?.sessionId` check
4. **Fix MutationObserver debounce** - Track pending timer
5. **Add unmount cleanup to FitnessProvider** - Call `session.reset()`

---

## Testing Recommendations

1. **Memory profiling:** Use Chrome DevTools Memory tab
   - Take heap snapshot at start
   - Run for 2 hours idle
   - Take another snapshot
   - Compare retained objects

2. **Timeline growth test:**
   ```javascript
   // In console
   setInterval(() => {
     const session = window.__fitnessSession;
     const series = session?.timeline?.series || {};
     const total = Object.values(series).reduce((sum, arr) => sum + arr.length, 0);
     console.log('Total series points:', total);
   }, 60000);
   ```

3. **Listener leak test:** Use Chrome's `getEventListeners(window)` before/after session

---

## Phased Implementation Plan

### Phase 1: Critical Hotfixes (Day 1)
**Goal:** Stop the bleeding - address issues causing overnight hangs

| Task | File | Change | Risk |
|------|------|--------|------|
| 1.1 | `FitnessTimeline.js` | Add `MAX_SERIES_LENGTH = 2000` with splice pruning in `tick()` | Low |
| 1.2 | `FitnessContext.jsx` | Fix WebSocket cleanup - move unsubscribe refs outside `.then()` | Low |
| 1.3 | `FitnessApp.jsx` | Fix MutationObserver debounce - track pending timer | Low |

**Validation:**
```bash
# Run overnight test
node _extensions/fitness/simulation.mjs --duration=28800  # 8 hours
# Monitor in browser console:
setInterval(() => console.log('Series:', Object.values(__fitnessSession?.timeline?.series || {}).reduce((s,a) => s + a.length, 0)), 60000);
```

---

### Phase 2: Conditional Timers (Day 2)
**Goal:** Stop unnecessary work when idle

| Task | File | Change | Risk |
|------|------|--------|------|
| 2.1 | `FitnessContext.jsx` | Gate 1-second heartbeat on `session?.sessionId` | Low |
| 2.2 | `FitnessContext.jsx` | Gate 3-second prune interval on `session?.sessionId` | Low |
| 2.3 | `FitnessContext.jsx` | Add mounted flag to vibration handler cleanup | Low |

**Validation:**
```javascript
// In idle state (no session), these should not fire:
// - forceUpdate calls
// - pruneStaleDevices calls
```

---

### Phase 3: Session Lifecycle (Day 3-4)
**Goal:** Proper cleanup on unmount and session end

| Task | File | Change | Risk |
|------|------|--------|------|
| 3.1 | `FitnessContext.jsx` | Add unmount cleanup `useEffect` calling `session.reset()` | Medium |
| 3.2 | `FitnessSession.js` | Add `destroy()` method for full teardown (vs `reset()` for reuse) | Medium |
| 3.3 | `FitnessSession.js` | Clear `_sessionEndedCallbacks` in `destroy()` | Low |
| 3.4 | `GovernanceEngine.js` | Ensure `_clearTimers()` called on abandoned sessions | Low |

**New Method:**
```javascript
// FitnessSession.js
destroy() {
  this.reset();
  this._sessionEndedCallbacks = [];
  this._deviceRouter = null;
  this.zoneProfileStore?.clear();
  this._persistenceManager = null;
  // Nullify all references for GC
}
```

---

### Phase 4: Memory Optimization (Day 5)
**Goal:** Reduce allocation churn and object retention

| Task | File | Change | Risk |
|------|------|--------|------|
| 4.1 | `FitnessSession.js` | Change `eventLog.slice()` to `eventLog.splice()` | Low |
| 4.2 | `TreasureBox.js` | Actually delete legacy entity keys after migration | Low |
| 4.3 | `FitnessContext.jsx` | Add periodic cleanup of `vibrationTimeoutRefs` | Low |
| 4.4 | `FitnessSession.js` | Memoize `summary` getter (avoid recalc on every access) | Medium |

---

### Phase 5: Monitoring & Guardrails (Day 6)
**Goal:** Prevent regression, add visibility

| Task | File | Change | Risk |
|------|------|--------|------|
| 5.1 | `FitnessSession.js` | Add memory telemetry logging (series count, total points) | Low |
| 5.2 | `FitnessTimeline.js` | Log warning when pruning occurs | Low |
| 5.3 | Global | Add `window.__fitnessMemoryStats()` debug helper | Low |

**Debug Helper:**
```javascript
window.__fitnessMemoryStats = () => {
  const session = window.__fitnessSession;
  const series = session?.timeline?.series || {};
  const seriesCount = Object.keys(series).length;
  const totalPoints = Object.values(series).reduce((sum, arr) => sum + (arr?.length || 0), 0);
  const perUserCount = session?.treasureBox?.perUser?.size || 0;
  const eventLogSize = session?.eventLog?.length || 0;
  return { seriesCount, totalPoints, perUserCount, eventLogSize };
};
```

---

### Phase 6: Testing & Verification (Day 7)
**Goal:** Confirm fixes, document baseline

| Task | Description |
|------|-------------|
| 6.1 | Run 8-hour simulation, capture heap snapshots at 0h, 2h, 4h, 8h |
| 6.2 | Compare retained object counts pre/post fix |
| 6.3 | Document acceptable memory growth rate (target: <50MB/8hr) |
| 6.4 | Add automated memory regression test to CI (optional) |

---

## Rollout Strategy

```
Day 1: Phase 1 → Deploy to prod (critical fixes)
Day 2: Phase 2 → Deploy to prod
Day 3-4: Phase 3 → Test on garage box overnight
Day 5: Phase 4 + 5 → Deploy to prod
Day 7: Phase 6 → Verify & document
```

**Rollback Plan:** Each phase is independent. If issues arise, revert specific phase commits without affecting others.

---

## Success Criteria

- [ ] Browser tab remains responsive after 8+ hours idle
- [ ] Timeline series capped at ~2000 points per key
- [ ] No WebSocket subscription leaks (verify with `wsService.getStatus().subscriberCount`)
- [ ] Memory growth < 50MB over 8 hours (baseline TBD)
- [ ] Zero `setInterval`/`setTimeout` leaks (verify with Performance tab)

