# Fitness Session Restart Bug Analysis

**Date:** December 27, 2024  
**Status:** Investigation Complete  
**Priority:** High - Affects user experience after session transitions

## Bug Summary

When `FitnessSession.js` starts up after a previously successful session has ended (transitioning from passive back to active state), the following symptoms occur:

1. **SidebarFooter.jsx**: Shows `CircularUserAvatar` with resolved user name but displays "No Zone" badge with a black ring
2. **FitnessUsers.jsx**: Devices appear but user mapping is broken - users appear as unregistered devices
3. **WebSocket Disconnection**: Sometimes coincides with the WebSocket connection dying, making users appear offline while `server.mjs` continues broadcasting ANT+ data
4. **Hard refresh resolves** the issue, indicating stale state is the root cause

---

## Architecture Overview

### Data Flow Chain

```
ANT+ Hardware (server.mjs)
    ↓ WebSocket broadcast
FitnessContext.jsx (connectWebSocket → ws.onmessage)
    ↓ session.ingestData(data)
FitnessSession.js (ingestData → deviceManager.updateDevice → recordDeviceActivity)
    ↓ version state update triggers re-render
UI Components (SidebarFooter, FitnessUsers)
    ↓ Pull from participantRoster, userVitalsMap, etc.
CircularUserAvatar (receives zoneId, zoneColor, heartRate)
```

### Key State Dependencies

| Component | Dependencies | Expected Source of Truth |
|-----------|--------------|--------------------------|
| `CircularUserAvatar` | `zoneId`, `zoneColor`, `heartRate` | Passed from parent via `participantRoster` |
| `SidebarFooter` | `participantRoster`, `userCurrentZones`, `zones` | `FitnessContext.participantRoster` |
| `FitnessUsers` | `participantRoster`, `deviceOwnership`, `userCollections` | `FitnessContext` + direct session access |
| `participantRoster` | `FitnessSession.roster` getter | `ParticipantRoster` class or legacy logic |

---

## Root Cause Analysis

### 1. Session State Not Fully Reset on Session End

**Location:** [FitnessSession.js#L1190-L1225](frontend/src/hooks/fitness/FitnessSession.js#L1190-L1225)

When `reset()` is called (after session ends), it creates **new instances** of `UserManager` and `DeviceManager`:

```javascript
reset() {
  this.sessionId = null;
  // ...
  this.userManager = new UserManager(); // NEW INSTANCE
  this.deviceManager = new DeviceManager(); // NEW INSTANCE
  // ...
}
```

**Problem:** The new `UserManager` and `DeviceManager` are **not configured** with the user/device configuration from `fitnessConfiguration`. This configuration happens in `FitnessContext.jsx` via the `configurationSignature` effect, but:

1. The configuration effect checks `configuredSignatureRef.current === configurationSignature` 
2. Since the configuration hasn't changed (same YAML config), the effect **doesn't re-run**
3. The new managers remain unconfigured

### 2. ParticipantRoster Module Loses Configuration

**Location:** [FitnessSession.js#L489-L499](frontend/src/hooks/fitness/FitnessSession.js#L489-L499)

The `ParticipantRoster` module gets configured during `ensureStarted()`:

```javascript
this._participantRoster.configure({
  deviceManager: this.deviceManager,
  userManager: this.userManager,
  treasureBox: this.treasureBox,
  activityMonitor: this.activityMonitor,
  timeline: this.timeline
});
```

**Problem:** When `reset()` is called:
1. `ParticipantRoster.reset()` clears `_historicalParticipants` but does **NOT** clear the module references
2. The roster's `_deviceManager` and `_userManager` still point to the **old instances**
3. When the new session starts, the roster is working with stale references

**Evidence:** The roster getter has a fallback check:
```javascript
get roster() {
  // Delegate to ParticipantRoster but maintain backward compatibility
  if (this._participantRoster && this._participantRoster._deviceManager) {
    return this._participantRoster.getRoster();
  }
  // Original roster implementation (backward compatibility during migration)
```

If `_participantRoster._deviceManager` is the old (empty) instance, it returns an empty roster.

### 3. TreasureBox Zone Snapshot Stale

**Location:** [ParticipantRoster.js#L215-L235](frontend/src/hooks/fitness/ParticipantRoster.js#L215-L235)

Zone information comes from `TreasureBox.getUserZoneSnapshot()`:

```javascript
_buildZoneLookup() {
  const zoneLookup = new Map();
  if (!this._treasureBox) return zoneLookup;
  
  const zoneSnapshot = typeof this._treasureBox.getUserZoneSnapshot === 'function'
    ? this._treasureBox.getUserZoneSnapshot()
    : [];
  // ...
}
```

**Problem:** 
- `TreasureBox` is set to `null` in `reset()` but re-created in `ensureStarted()`
- The `ParticipantRoster._treasureBox` reference is updated **after** treasure box creation
- However, during the gap between reset and session start, queries return empty zone data
- This manifests as "No Zone" with black rings

### 4. UserManager Device Resolution Fails

**Location:** [UserManager.js#L263-L268](frontend/src/hooks/fitness/UserManager.js#L263-L268)

When resolving users for devices:

```javascript
resolveUserForDevice(deviceId) {
  // Check assignment ledger first
  const entry = this.assignmentLedger?.get?.(deviceId);
  // ...
  // Then check configured users by hrDeviceId
  for (const user of this.users.values()) {
    if (user.hrDeviceId === deviceId) return user;
  }
  // ...
}
```

**Problem:** After `reset()` creates a new `UserManager`:
1. `this.users` Map is empty (no configured users)
2. `this.assignmentLedger` is `null` until re-attached
3. All device-to-user resolutions fail
4. Devices appear as "unregistered"

### 5. WebSocket Reconnection Race Condition

**Location:** [FitnessContext.jsx#L753-L830](frontend/src/context/FitnessContext.jsx#L753-L830)

The WebSocket reconnection logic:

```javascript
ws.onclose = () => {
  setConnected(false);
  wsRef.current = null;
  if (reconnectAttemptsRef.current < maxReconnectAttempts) {
    const delay = Math.min(baseReconnectDelay * Math.pow(2, reconnectAttemptsRef.current), 30000);
    reconnectTimeoutRef.current = setTimeout(() => {
      reconnectAttemptsRef.current++;
      connectWebSocket();
    }, delay);
  }
};
```

**Problem:**
- When reconnecting after connection loss, data may arrive **before** the session is properly initialized
- `session.ingestData(data)` calls `ensureStarted()` which triggers session creation
- But the UI components may have already rendered with stale/empty state
- The `forceUpdate()` in `ws.onmessage` doesn't guarantee proper state propagation

### 6. Recent Changes That May Have Introduced/Exposed This Bug

Based on git history analysis (last 3-5 days):

#### Commit `86f46ae` - "Add shared FitnessApps components and hooks"
- **Added:** `ActivityMonitor`, `SessionLifecycle`, `MetricsRecorder`, `ParticipantRoster` modules
- **Impact:** Introduced the Phase 4 extracted modules which added new layers of state management
- **Risk:** Multiple sources of truth for participant status (`ActivityMonitor` vs `ParticipantRoster` vs legacy `roster`)

#### Commit `c2894ae` - "Add ambient LED zone sync with Home Assistant"
- **Added:** `useZoneLedSync` hook consuming `participantRoster`
- **Impact:** Added new consumer of roster data with `isActive` field dependency
- **Risk:** If roster entries lack `isActive`, this could cause cascading issues

#### Commit `c6aa664` - "Implement voice memo overlay callbacks and chart history fixes"
- **Modified:** `closeVoiceMemoOverlay` callback dependencies
- **Added:** `isActive` field to roster signature calculation
- **Risk:** Changes to roster signature calculation could affect cache invalidation

---

## Detailed Bug Scenarios

### Scenario A: Session Restart After Clean End

```
1. Session active with users (roster populated, zones working)
2. All users leave → empty_roster timeout triggers
3. endSession('empty_roster') called
4. reset() creates new UserManager/DeviceManager (empty)
5. User returns and starts broadcasting
6. ingestData() calls ensureStarted()
7. New session starts BUT:
   - UserManager not configured (no user->device mappings)
   - ParticipantRoster._userManager points to old instance
   - Zone lookup returns empty (no TreasureBox zone data yet)
8. UI shows: devices present but users unregistered, no zones
```

### Scenario B: WebSocket Reconnection During Passive State

```
1. Session ends, enters passive state
2. WebSocket disconnects (server restart, network issue)
3. User starts exercising (ANT+ broadcasting)
4. WebSocket reconnects
5. Messages arrive but session not initialized
6. ingestData() starts new session
7. Race condition: UI renders before state fully propagated
8. Partial data displayed: resolved names but missing zones
```

---

## Affected Files Summary

| File | Issue |
|------|-------|
| [FitnessSession.js](frontend/src/hooks/fitness/FitnessSession.js) | `reset()` doesn't reconfigure managers; `ensureStarted()` configuration timing |
| [FitnessContext.jsx](frontend/src/context/FitnessContext.jsx) | Configuration effect doesn't re-run after reset; WebSocket race conditions |
| [ParticipantRoster.js](frontend/src/hooks/fitness/ParticipantRoster.js) | Stale references after session reset |
| [UserManager.js](frontend/src/hooks/fitness/UserManager.js) | Empty after reset, not reconfigured |
| [SidebarFooter.jsx](frontend/src/modules/Fitness/SidebarFooter.jsx) | Consumes potentially stale roster data |
| [FitnessUsers.jsx](frontend/src/modules/Fitness/FitnessSidebar/FitnessUsers.jsx) | Complex user mapping that fails when source data incomplete |

---

## Proposed Solutions

### Solution 1: Reconfigure Managers on Reset (Quick Fix)

Instead of creating new instances in `reset()`, reconfigure the existing managers or ensure reconfiguration happens:

```javascript
reset() {
  // ...existing reset logic...
  
  // Mark that reconfiguration is needed
  this._needsReconfigure = true;
}

// In configureFromExternal() or equivalent:
configureSession(usersConfig, zoneConfig, ant_devices) {
  this.userManager.configure(usersConfig, zoneConfig);
  this.deviceManager.configure(ant_devices);
  this._participantRoster.configure({
    deviceManager: this.deviceManager,
    userManager: this.userManager
  });
  this._needsReconfigure = false;
}
```

### Solution 2: Force Configuration Effect Re-run

In `FitnessContext.jsx`, include a session version in the configuration signature:

```javascript
const configurationSignature = React.useMemo(() => 
  JSON.stringify({
    ...configurationInputs,
    sessionVersion: session?.sessionId || 'none'
  }), 
  [configurationInputs, session?.sessionId]
);
```

### Solution 3: Improve ParticipantRoster.reset()

Clear all external references to force reconfiguration:

```javascript
reset() {
  this._historicalParticipants.clear();
  this._invalidateCache();
  // Also clear references so configure() must be called again
  this._deviceManager = null;
  this._userManager = null;
  this._treasureBox = null;
  this._activityMonitor = null;
  this._timeline = null;
}
```

### Solution 4: Add Session Lifecycle Hook

Expose a hook for external configuration after session transitions:

```javascript
// In FitnessContext.jsx
useEffect(() => {
  const unsubscribe = session.onSessionEnded(() => {
    // Force reconfiguration on next session start
    configuredSignatureRef.current = null;
  });
  return unsubscribe;
}, [session]);
```

---

## Recommended Testing Approach

1. **Manual Test:**
   - Start session with 2+ users
   - Wait for session to auto-end (60s after all users leave)
   - Have users return immediately
   - Verify zones display correctly without hard refresh

2. **Automated Test Cases:**
   - Session restart after `empty_roster` end
   - Session restart after `inactivity` end  
   - WebSocket reconnection during passive state
   - Multiple session start/end cycles

3. **Debug Logging Points:**
   ```javascript
   // In FitnessSession.reset()
   console.log('[FitnessSession] reset() called, creating new managers');
   
   // In UserManager.configure()
   console.log('[UserManager] configure() called, users:', this.users.size);
   
   // In ParticipantRoster.getRoster()
   console.log('[ParticipantRoster] getRoster(), deviceManager users:', 
     this._deviceManager?.getAllDevices()?.length);
   ```

---

## Conclusion

The bug is caused by a **state synchronization issue** during session restart. The Phase 4 refactoring (commit `86f46ae`) introduced extracted modules (`ParticipantRoster`, `ActivityMonitor`, etc.) that require proper reconfiguration after session reset. The current implementation creates new `UserManager`/`DeviceManager` instances but doesn't trigger reconfiguration of dependent modules.

The most robust fix would be **Solution 2 + Solution 3**: forcing the configuration effect to re-run when sessionId changes, and ensuring `ParticipantRoster.reset()` clears its external references to require proper reconfiguration.

---

## References

- [FitnessSession.js](frontend/src/hooks/fitness/FitnessSession.js)
- [FitnessContext.jsx](frontend/src/context/FitnessContext.jsx)
- [ParticipantRoster.js](frontend/src/hooks/fitness/ParticipantRoster.js)
- [UserManager.js](frontend/src/hooks/fitness/UserManager.js)
- [server.mjs](/_extentions/fitness/src/server.mjs)
- [fitness-architecture-review.md](docs/notes/fitness-architecture-review.md) (if exists)
