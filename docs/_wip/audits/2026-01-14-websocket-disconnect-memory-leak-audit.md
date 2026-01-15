# WebSocket Disconnect Memory Leak / Freeze Audit

**Date:** 2026-01-14  
**Issue:** Users report frontend eventually freezes when WebSocket server goes down  
**Symptoms:** Unresponsive UI, potential memory growth, browser tab becomes unresponsive  

## Executive Summary

When the WebSocket server becomes unavailable, the FitnessApp does not properly handle the disconnected state. Several cascading issues compound to cause memory growth and eventual UI freeze:

1. **Reconnection loops continue spawning timers** even after max attempts reached
2. **forceUpdate() calls accumulate** from WebSocket callbacks that fire during reconnect attempts
3. **Logger WebSocket has its own reconnect loop** that runs independently
4. **Session timers keep running** without fresh data, potentially causing tight render loops
5. **MutationObserver tooltip remover** creates timeouts that can stack during DOM churn

## Detailed Findings

### 1. WebSocketService Reconnection Logic (CRITICAL)

**File:** [frontend/src/services/WebSocketService.js](frontend/src/services/WebSocketService.js#L119-L142)

```javascript
_scheduleReconnect() {
  if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error('[WebSocketService] Max reconnection attempts reached');
    return;  // ⚠️ Stops scheduling, but doesn't notify subscribers
  }
  // ... schedules reconnect
}
```

**Problem:** When max reconnect attempts (10) are reached:
- No callback notifies the application that reconnection has permanently failed
- `connected` state remains `false`, but application continues to operate
- Status listeners are NOT notified of the terminal failure state
- FitnessContext continues to call `forceUpdate()` on each WebSocket callback during reconnect attempts

**Impact:** The application enters a zombie state where it thinks a connection might still be possible.

---

### 2. FitnessContext forceUpdate() on Disconnected WebSocket (HIGH)

**File:** [frontend/src/context/FitnessContext.jsx](frontend/src/context/FitnessContext.jsx#L962-L976)

```javascript
unsubscribe = wsService.subscribe(
  ['fitness', 'vibration'],
  (data) => {
    // ... processes data
    const session = fitnessSessionRef.current;
    if (session) {
      session.ingestData(data);
      forceUpdate();  // ⚠️ Called on every message during reconnect attempts
    }
  }
);
```

**Problem:** During reconnection attempts, any partial messages or error events could trigger callbacks. The `forceUpdate()` causes a React re-render on every callback.

**Impact:** If WebSocket is rapidly reconnecting/failing (e.g., in a bad network state), this creates a render storm.

---

### 3. Heartbeat Interval Runs Without Session Guard (MEDIUM)

**File:** [frontend/src/context/FitnessContext.jsx](frontend/src/context/FitnessContext.jsx#L855-L862)

```javascript
const sessionId = fitnessSessionRef.current?.sessionId;
useEffect(() => {
  if (!sessionId) return;  // ✓ Guarded by sessionId
  
  const interval = setInterval(() => {
    forceUpdate();  // Runs every 1000ms
  }, 1000);
  return () => clearInterval(interval);
}, [forceUpdate, sessionId]);
```

**Assessment:** This is correctly guarded - the interval only runs when a session is active. However, when combined with other timers, it contributes to baseline CPU usage.

---

### 4. Logger WebSocket Has Independent Reconnect Loop (MEDIUM)

**File:** [frontend/src/lib/logging/Logger.js](frontend/src/lib/logging/Logger.js#L102-L112)

```javascript
const scheduleReconnect = () => {
  if (wsState.reconnectTimer) return;
  const delay = Math.min(wsState.reconnectDelay, config.reconnectMaxDelay);
  wsState.reconnectTimer = setTimeout(() => {
    wsState.reconnectTimer = null;
    wsState.reconnectDelay = Math.min(delay * 2, config.reconnectMaxDelay);
    ensureWebSocket();  // ⚠️ No max attempts limit
  }, delay);
};
```

**Problem:** The Logger's WebSocket reconnection has **no maximum attempt limit**. It will continue trying to reconnect indefinitely with exponential backoff capped at 6 seconds.

**Impact:** 
- Creates a persistent timer every 6 seconds when server is down
- Allocates new WebSocket objects on each attempt
- Old WebSocket objects may not be GC'd immediately

---

### 5. MutationObserver Tooltip Remover Creates Stacking Timeouts (MEDIUM)

**File:** [frontend/src/Apps/FitnessApp.jsx](frontend/src/Apps/FitnessApp.jsx#L250-L275)

```javascript
let debounceTimer = null;
observer = new MutationObserver(() => {
  // Skip if already pending to prevent timeout stacking
  if (debounceTimer) return;  // ✓ Guard added
  
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    removeTooltips();
  }, 500);
});
```

**Assessment:** The guard was added to prevent timeout stacking. However, the observer itself processes every DOM mutation, which could be expensive during rapid UI updates.

---

### 6. SessionLifecycle Timers Continue After Disconnect (LOW-MEDIUM)

**File:** [frontend/src/hooks/fitness/SessionLifecycle.js](frontend/src/hooks/fitness/SessionLifecycle.js#L284-L316)

```javascript
_startTickTimer() {
  this._stopTickTimer();
  this._tickTimer = setInterval(() => {
    if (this._onTick && this.isActive()) {
      this._onTick(Date.now());  // ⚠️ Continues calling even with no fresh data
    }
  }, this._config.tickIntervalMs);  // Default 5000ms
}
```

**Problem:** The tick timer continues running even when WebSocket is disconnected. Each tick:
- Calls `_collectTimelineTick()` which processes empty/stale data
- May trigger `forceUpdate()` via callbacks
- Accumulates entries in timeline series with null values

**Impact:** Memory grows from timeline entries; CPU wasted on processing stale data.

---

### 7. Device Prune Interval Continues Regardless of Connection (LOW)

**File:** [frontend/src/context/FitnessContext.jsx](frontend/src/context/FitnessContext.jsx#L993-L1002)

```javascript
useEffect(() => {
  const session = fitnessSessionRef.current;
  if (!currentSessionId) return;
  
  const interval = setInterval(() => {
    const timeouts = getFitnessTimeouts();
    session.deviceManager.pruneStaleDevices(timeouts);
    forceUpdate();  // ⚠️ Called every 3 seconds even when disconnected
  }, 3000);
  return () => clearInterval(interval);
}, [forceUpdate, currentSessionId]);
```

**Problem:** Prune interval runs every 3 seconds while session is active, calling `forceUpdate()` regardless of whether there's any fresh data.

---

## Memory Leak Vectors

### Identified Leaks

| Source | Growth Pattern | Severity |
|--------|---------------|----------|
| Logger queue overflow | Linear (capped at 500) | Low |
| Timeline series with null values | Linear over session duration | Medium |
| WebSocket object allocation during reconnect | Intermittent | Low |
| EventLog in FitnessSession | Capped at 500 entries | Low |

### Render Storm Conditions

When WebSocket is disconnecting/reconnecting rapidly:
1. WebSocketService fires status callbacks → FitnessContext updates `connected` state
2. Logger tries to reconnect → allocates WebSocket
3. forceUpdate() from multiple intervals compounds
4. React reconciliation overwhelmed → UI freezes

---

## Remediation Plan

### Phase 1: Stop the Bleeding (P0 - Immediate)

#### 1.1 Implement Adaptive Throttling for WebSocketService

**File:** `frontend/src/services/WebSocketService.js`

Replace hard max attempts with progressive throttle that slows to hourly attempts:

```javascript
// Throttle tiers (ms): 1s, 2s, 4s, 8s, 15s, 30s, 1min, 5min, 15min, 1hr
const RECONNECT_DELAYS = [
  1000,      // Tier 0: 1 second (initial fast retry)
  2000,      // Tier 1: 2 seconds
  4000,      // Tier 2: 4 seconds
  8000,      // Tier 3: 8 seconds
  15000,     // Tier 4: 15 seconds
  30000,     // Tier 5: 30 seconds
  60000,     // Tier 6: 1 minute
  300000,    // Tier 7: 5 minutes
  900000,    // Tier 8: 15 minutes
  3600000    // Tier 9: 1 hour (terminal - stays here)
];

// In constructor:
this.reconnectTier = 0;
this.degradedMode = false;  // True when tier >= 6 (1min+)

_scheduleReconnect() {
  const delay = RECONNECT_DELAYS[Math.min(this.reconnectTier, RECONNECT_DELAYS.length - 1)];
  const wasDegraded = this.degradedMode;
  this.degradedMode = this.reconnectTier >= 6;
  
  // Notify subscribers when entering/exiting degraded mode
  if (this.degradedMode !== wasDegraded) {
    this._notifyStatusListeners();
  }
  
  console.log(`[WebSocketService] Reconnect tier ${this.reconnectTier}, delay ${delay}ms`);
  
  this.reconnectTimeout = setTimeout(() => {
    this.reconnectTier++;
    this.connect();
  }, delay);
}

// On successful connect, reset tier:
ws.onopen = () => {
  this.reconnectTier = 0;
  this.degradedMode = false;
  // ...
};

// Update status to include degraded state:
_notifyStatusListeners() {
  const status = { 
    connected: this.connected, 
    connecting: this.connecting,
    degraded: this.degradedMode,
    reconnectTier: this.reconnectTier
  };
  // ...
}
```

**Rationale:** Never gives up, but backs off to 1 attempt/hour to minimize resource usage. Can still recover if server returns.

---

#### 1.2 Apply Same Throttling to Logger WebSocket

**File:** `frontend/src/lib/logging/Logger.js`

```javascript
const LOGGER_RECONNECT_DELAYS = [1000, 2000, 5000, 15000, 60000, 300000, 900000];
let loggerReconnectTier = 0;

const scheduleReconnect = () => {
  if (wsState.reconnectTimer) return;
  
  const delay = LOGGER_RECONNECT_DELAYS[
    Math.min(loggerReconnectTier, LOGGER_RECONNECT_DELAYS.length - 1)
  ];
  
  wsState.reconnectTimer = setTimeout(() => {
    wsState.reconnectTimer = null;
    loggerReconnectTier++;
    ensureWebSocket();
  }, delay);
};

// Reset on successful connect:
wsState.socket.onopen = () => {
  loggerReconnectTier = 0;
  wsState.reconnectDelay = config.reconnectBaseDelay;
  // ...
};
```

---

#### 1.3 Guard forceUpdate() Calls in WebSocket Callback

**File:** `frontend/src/context/FitnessContext.jsx`

```javascript
unsubscribe = wsService.subscribe(
  ['fitness', 'vibration'],
  (data) => {
    // Ignore malformed or empty data during reconnect churn
    if (!data || typeof data !== 'object') return;
    if (data.topic === undefined && data.type === undefined) return;
    
    if (data?.topic === 'vibration') {
      handleVibrationEvent(data);
      return;
    }
    const session = fitnessSessionRef.current;
    if (session) {
      session.ingestData(data);
      forceUpdate();
    }
  }
);
```

---

### Phase 2: Reduce Render Pressure (P1 - This Week)

#### 2.1 Pause Session Timers in Degraded Mode

**File:** `frontend/src/context/FitnessContext.jsx`

```javascript
const [connectionDegraded, setConnectionDegraded] = useState(false);

// In WebSocket status subscription:
unsubscribeStatus = wsService.onStatusChange(({ connected: isConnected, degraded }) => {
  setConnected(isConnected);
  setConnectionDegraded(degraded || false);
  
  if (degraded) {
    // Pause expensive timers when connection is severely degraded
    fitnessSessionRef.current?.lifecycle?.pauseTimers?.();
  } else if (isConnected) {
    fitnessSessionRef.current?.lifecycle?.resumeTimers?.();
  }
});
```

**File:** `frontend/src/hooks/fitness/SessionLifecycle.js`

```javascript
pauseTimers() {
  this._paused = true;
  this._log('timers-paused', { reason: 'connection-degraded' });
}

resumeTimers() {
  this._paused = false;
  this._log('timers-resumed');
}

_startTickTimer() {
  this._stopTickTimer();
  this._tickTimer = setInterval(() => {
    if (this._onTick && this.isActive() && !this._paused) {
      this._onTick(Date.now());
    }
  }, this._config.tickIntervalMs);
}
```

---

#### 2.2 Throttle Device Prune forceUpdate

**File:** `frontend/src/context/FitnessContext.jsx`

```javascript
// Replace immediate forceUpdate with connection-aware version
useEffect(() => {
  const session = fitnessSessionRef.current;
  if (!currentSessionId) return;
  
  const interval = setInterval(() => {
    const timeouts = getFitnessTimeouts();
    const pruned = session.deviceManager.pruneStaleDevices(timeouts);
    // Only trigger re-render if something actually changed
    if (pruned > 0) {
      forceUpdate();
    }
  }, 3000);
  return () => clearInterval(interval);
}, [forceUpdate, currentSessionId]);
```

---

#### 2.3 Conditional Heartbeat Based on Connection State

**File:** `frontend/src/context/FitnessContext.jsx`

```javascript
useEffect(() => {
  if (!sessionId) return;
  // Skip heartbeat entirely when connection is degraded
  if (connectionDegraded) return;
  
  const interval = setInterval(() => {
    forceUpdate();
  }, 1000);
  return () => clearInterval(interval);
}, [forceUpdate, sessionId, connectionDegraded]);
```

---

### Phase 3: Structural Improvements (P2 - Next Sprint)

#### 3.1 Consolidate WebSocket Connections

Create a shared WebSocket manager that both `WebSocketService` and `Logger` use:

```
frontend/src/services/
├── WebSocketManager.js      # Singleton connection manager
├── WebSocketService.js      # Fitness/app subscriptions (uses manager)
└── logging/
    └── LoggerTransport.js   # Logger transport (uses manager)
```

**Benefits:**
- Single reconnection loop
- Shared connection status
- Coordinated backoff

---

#### 3.2 Add Visual Degraded Mode Indicator

**File:** `frontend/src/Apps/FitnessApp.jsx`

```jsx
{connectionDegraded && (
  <div className="connection-degraded-banner">
    <Icon name="wifi-off" />
    <span>Connection lost. Retrying...</span>
    <button onClick={reconnectFitnessWebSocket}>Retry Now</button>
  </div>
)}
```

---

#### 3.3 Implement Render Batching for Multiple Updates

Use React 18's `startTransition` or `useDeferredValue` for non-critical updates:

```javascript
const forceUpdate = React.useCallback(() => {
  React.startTransition(() => {
    setVersion((v) => v + 1);
  });
}, []);
```

---

## Implementation Checklist

### Phase 1 (P0) - ✅ COMPLETED 2026-01-14
- [x] Add `RECONNECT_DELAYS` array to WebSocketService
- [x] Implement `reconnectTier` tracking
- [x] Add `degraded` flag to status notifications
- [x] Apply same throttling to Logger
- [x] Guard WebSocket callback against malformed data
- [x] Fix logging/index.js transports (createWebSocketTransport, createBufferingWebSocketTransport)

**Changes Made:**
- [WebSocketService.js](frontend/src/services/WebSocketService.js): Added 10-tier throttling (1s→1hr), `reconnectTier` state, `degradedMode` flag
- [Logger.js](frontend/src/lib/logging/Logger.js): Added 7-tier throttling (1s→15min), removed unlimited reconnect loop
- [logging/index.js](frontend/src/lib/logging/index.js): Added 7-tier throttling to both WebSocket transports
- [FitnessContext.jsx](frontend/src/context/FitnessContext.jsx): Added data validation guard before `forceUpdate()` calls

### Phase 2 (P1) - Complete by End of Week
- [ ] Add `pauseTimers()`/`resumeTimers()` to SessionLifecycle
- [ ] Wire degraded state to timer pausing in FitnessContext
- [ ] Make device prune forceUpdate conditional
- [ ] Add `connectionDegraded` to heartbeat effect dependency

### Phase 3 (P2) - Next Sprint
- [ ] Design shared WebSocketManager
- [ ] Migrate Logger to use shared manager
- [ ] Add degraded mode UI indicator
- [ ] Evaluate React 18 transitions for render batching

---

## Rollback Plan

If throttling changes cause issues:
1. Revert `RECONNECT_DELAYS` to simple exponential backoff
2. Keep existing timer guards (they're safe additions)
3. Remove `degraded` state propagation

All changes are additive and backward-compatible.

---

## Testing Recommendations

1. **Reproduce the freeze:**
   - Start FitnessApp with active session
   - Kill backend server
   - Monitor browser DevTools Memory tab
   - Check Performance tab for timer accumulation

2. **Verify fixes:**
   - Confirm max reconnect attempts stop timer allocation
   - Confirm session timers pause when connection fails
   - Confirm memory growth flattens after connection failure

---

## Related Code Paths

- [WebSocketService.js](frontend/src/services/WebSocketService.js) - Main WebSocket manager
- [FitnessContext.jsx](frontend/src/context/FitnessContext.jsx) - WebSocket subscription and forceUpdate
- [Logger.js](frontend/src/lib/logging/Logger.js) - Independent WebSocket for logging
- [SessionLifecycle.js](frontend/src/hooks/fitness/SessionLifecycle.js) - Tick and autosave timers
- [FitnessSession.js](frontend/src/hooks/fitness/FitnessSession.js) - Session state management

---

## References

- [2025-12-23-fitness-architecture-review.md](2025-12-23-fitness-architecture-review.md)
- [2025-12-27-fitness-session-restart-bug-analysis.md](2025-12-27-fitness-session-restart-bug-analysis.md)
