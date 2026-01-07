# Jumprope Integration Redesign: Analysis & Recommendations

**Document Status:** Analysis Phase (No code changes)  
**Created:** 2026-01-06  
**Author:** Engineering Team  

---

## Executive Summary

The current jumprope BLE integration was built on incorrect assumptions about the RENPHO R-Q008 data format. We mistakenly interpreted:
1. **Jump count field** as a reliable cumulative counter (it's mode-dependent, can count up OR down)
2. **Bytes 10-11** as RPM (it's actually a timer, also mode-dependent)

This document outlines a complete redesign to create a robust, mode-agnostic revolution tracking system with derived RPM calculations.

---

## Part 1: Problem Statement

### 1.1 Current Implementation Flaws

#### Incorrect Data Interpretation

| Field | Current Assumption | Actual Behavior |
|-------|-------------------|-----------------|
| Bytes 14-15 | Total jumps (cumulative, always increasing) | Mode-dependent counter (can count UP or DOWN) |
| Bytes 10-11 | RPM (rope rotations per minute) | Timer value (mode-dependent, game-dependent) |

#### Impact

1. **Jump counts can go backwards**: If the jumprope is in countdown mode (e.g., "jump 100 times" game), our current code would report decreasing `revolutionCount`, breaking session statistics.

2. **RPM is meaningless**: The value we've been reporting as RPM is actually a timer, making all RPM-based metrics (avgRPM, maxRPM, zone colors) incorrect.

3. **Session data corruption**: Any persisted session data with jumprope activity contains invalid metrics.

### 1.2 Files Affected by Current Design

| File | Purpose | Issue |
|------|---------|-------|
| [_extensions/fitness/src/decoders/jumprope.mjs](../../_extensions/fitness/src/decoders/jumprope.mjs) | BLE packet decoder | Misinterprets both fields |
| [_extensions/fitness/src/ble.mjs](../../_extensions/fitness/src/ble.mjs#L266-L290) | Broadcasts decoded data | Passes through bad data |
| [_extensions/fitness/simulation-jumprope.mjs](../../_extensions/fitness/simulation-jumprope.mjs) | Test simulator | Simulates wrong data model |
| [frontend/src/hooks/fitness/DeviceEventRouter.js](../../frontend/src/hooks/fitness/DeviceEventRouter.js#L220-L240) | Ingests WS data | Maps rpm→cadence (invalid) |
| [frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/JumpropeCard.jsx](../../frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/JumpropeCard.jsx) | UI display | Shows both rpm and jumps |
| [frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/JumpropeAvatar.jsx](../../frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/JumpropeAvatar.jsx) | Animated avatar | RPM-based gauge coloring |

---

## Part 2: Proposed Solution Architecture

### 2.1 Core Principle: Direction-Agnostic Revolution Detection

Instead of trusting the raw counter value, we detect **any change** in the counter as a revolution event:

```
Raw counter: 50 → 51 → 52 → 51 → 50 → 49  (mixed direction)
                  ↓     ↓     ↓     ↓     ↓
Revolutions:      +1    +1    +1    +1    +1  (always positive)
```

The absolute value from the device becomes irrelevant; we only care that it **changed**.

### 2.2 New Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           BLE DECODER (garage)                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌──────────────┐    ┌───────────────────┐    ┌────────────────────────────┐   │
│  │ Raw BLE Data │───►│ Direction Detector │───►│ Monotonic Revolution       │   │
│  │ counter: N   │    │ prev: P            │    │ Counter (since connect)    │   │
│  └──────────────┘    │ if N ≠ P: rev++    │    │ revolutions: R             │   │
│                      └───────────────────┘    │ timestamp: T               │   │
│                                               └────────────────────────────┘   │
│                                                             │                    │
│                                                             ▼                    │
│                                               ┌────────────────────────────┐   │
│                                               │ WebSocket Payload          │   │
│                                               │ {                          │   │
│                                               │   revolutions: 1234,       │   │
│                                               │   timestamp: ISO8601       │   │
│                                               │ }                          │   │
│                                               └────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ WebSocket
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (FitnessSession)                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌───────────────────────┐    ┌─────────────────────────────────────────────┐  │
│  │ DeviceEventRouter     │───►│ JumpropeSessionState                         │  │
│  │ receives WS payload   │    │                                              │  │
│  └───────────────────────┘    │ baselineRevolutions: 1200 (first received)   │  │
│                               │ latestRevolutions:   1234                    │  │
│                               │ sessionJumps: 34 (latest - baseline)         │  │
│                               │                                              │  │
│                               │ timestampHistory: [(T1, R1), (T2, R2), ...]  │  │
│                               │ derivedRPM: calculated from history          │  │
│                               └─────────────────────────────────────────────┘  │
│                                                             │                    │
│                                                             ▼                    │
│                               ┌─────────────────────────────────────────────┐  │
│                               │ Device State (for UI)                        │  │
│                               │ revolutionCount: 34 (session jumps)          │  │
│                               │ cadence: 95 (derived RPM)                    │  │
│                               └─────────────────────────────────────────────┘  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 New WebSocket Message Format

**Current (Broken):**
```json
{
  "topic": "fitness",
  "type": "ble_jumprope",
  "deviceId": "12:34:5B:E1:DD:85",
  "timestamp": "2026-01-06T17:01:00.000Z",
  "data": {
    "jumps": 150,
    "rpm": 120,
    "avgRPM": 115,
    "maxRPM": 135,
    "duration": 180,
    "calories": 15
  }
}
```

**Proposed (Minimal):**
```json
{
  "topic": "fitness",
  "type": "ble_jumprope",
  "deviceId": "12:34:5B:E1:DD:85",
  "timestamp": "2026-01-06T17:01:00.123Z",
  "data": {
    "revolutions": 1234
  }
}
```

**Changes:**
- **REMOVED**: `rpm`, `avgRPM`, `maxRPM`, `duration`, `calories` (all unreliable or derivative)
- **RENAMED**: `jumps` → `revolutions` (clarifies it's a monotonic counter, not raw device count)
- **ADDED**: Nothing from device; all calculations move to frontend

### 2.4 RPM Derivation Algorithm

RPM will be calculated on the frontend using a rolling window of recent revolution events:

```javascript
/**
 * Calculate RPM from revolution timestamps using rolling window
 * 
 * @param {Array<{revolutions: number, timestamp: number}>} history - Recent samples
 * @param {number} windowMs - Rolling window size (default: 10000ms = 10 seconds)
 * @returns {number} Calculated RPM (0 if insufficient data)
 */
function deriveRPM(history, windowMs = 10000) {
  const now = Date.now();
  const cutoff = now - windowMs;
  
  // Filter to samples within window
  const windowSamples = history.filter(s => s.timestamp >= cutoff);
  
  if (windowSamples.length < 2) {
    return 0; // Not enough data
  }
  
  // Sort by timestamp
  windowSamples.sort((a, b) => a.timestamp - b.timestamp);
  
  const oldest = windowSamples[0];
  const newest = windowSamples[windowSamples.length - 1];
  
  const revDelta = newest.revolutions - oldest.revolutions;
  const timeDeltaMs = newest.timestamp - oldest.timestamp;
  
  if (timeDeltaMs <= 0 || revDelta <= 0) {
    return 0;
  }
  
  // Revolutions per millisecond → Revolutions per minute
  const rpm = (revDelta / timeDeltaMs) * 60000;
  
  return Math.round(rpm);
}
```

**Advantages:**
1. Smooths out irregular BLE transmission intervals
2. Self-correcting if packets are dropped
3. No dependency on device-reported values
4. Works identically regardless of device mode

---

## Part 3: Detailed Code Audit

### 3.1 Backend/BLE Extension (`_extensions/fitness/`)

#### 3.1.1 `src/decoders/jumprope.mjs`

**Current Issues:**

```javascript
// Lines 19-43 - PROBLEM: Misinterprets packet structure
decodeMainPacket(data) {
  // WRONG: bytes 10-11 are timer, not RPM
  const rpm = data[10] | (data[11] << 8);
  
  // PARTIAL: bytes 14-15 ARE jump count, but direction-dependent
  const jumpCount = data[14] | (data[15] << 8);
  
  return {
    type: 'main',
    sequenceNum,
    rpm,           // ❌ INVALID - remove
    jumpCount,     // ⚠️ Needs direction detection
    estimatedCalories, // ❌ INVALID - derived from wrong data
    ...
  };
}

// Lines 67-93 - PROBLEM: Accumulates invalid RPM readings
updateSession(decodedData) {
  // WRONG: Directly uses jumpCount without direction detection
  this.sessionData.totalJumps = jumpCount;
  
  // WRONG: Stores invalid RPM values
  if (rpm > 0 && rpm < 300) {
    this.sessionData.rpmReadings.push(rpm);
    this.sessionData.maxRPM = Math.max(...);
  }
}

// Lines 96-118 - PROBLEM: Broadcasts invalid aggregated stats
formatForWebSocket(deviceConfig) {
  return {
    data: {
      jumps: this.sessionData.totalJumps,  // ⚠️ Could be wrong if mode changed
      rpm: this.sessionData.rpmReadings.slice(-1)[0] || 0,  // ❌ Invalid
      avgRPM: this.sessionData.avgRPM,  // ❌ Invalid
      maxRPM: this.sessionData.maxRPM,  // ❌ Invalid
      duration: this.sessionData.duration,  // ⚠️ Unreliable
      calories: Math.round(this.sessionData.totalJumps * 0.1)  // ❌ Based on wrong data
    }
  };
}
```

**Required Changes:**
1. Remove all RPM extraction from raw packets
2. Implement direction-agnostic revolution counter
3. Simplify WebSocket payload to just `revolutions` + `timestamp`
4. Remove session-level aggregation (move to frontend)

#### 3.1.2 `src/ble.mjs`

**Current Code (Lines 266-290):**
```javascript
handleDeviceData(deviceAddress, dataArray, decoder) {
  const decoded = decoder.decode(dataArray);
  if (!decoded || decoded.type !== 'main') return;
  
  decoder.updateSession(decoded);  // ⚠️ Accumulates bad data
  
  // Log includes invalid RPM
  console.log(`Jumprope: Jumps:${session.totalJumps} RPM:${decoded.rpm} Avg:${session.avgRPM}`);
  
  const wsData = decoder.formatForWebSocket(deviceConfig);
  this.broadcastCallback(wsData);  // Broadcasts invalid data
}
```

**Required Changes:**
1. Decoder should handle revolution counting
2. Logging should only show revolution count
3. Broadcast simplified payload

#### 3.1.3 `simulation-jumprope.mjs`

**Current Issues:**
- Simulates fake RPM values
- Generates `jumps` as cumulative (always increasing)
- Doesn't simulate countdown mode scenarios

**Required Changes:**
1. Remove RPM simulation
2. Add mode simulation (count up AND count down scenarios)
3. Output only `revolutions` field

### 3.2 Frontend (`frontend/src/`)

#### 3.2.1 `hooks/fitness/DeviceEventRouter.js`

**Current Code (Lines 220-240):**
```javascript
this.register('ble_jumprope', (payload, ctx) => {
  const normalized = {
    ...
    cadence: payload.data.rpm || 0,           // ❌ Invalid - maps fake RPM
    revolutionCount: payload.data.jumps || 0, // ⚠️ No baseline handling
    timestamp: payload.timestamp ? ...
  };
  return ctx.deviceManager.registerDevice(normalized);
});
```

**Required Changes:**
1. Track baseline `revolutions` per device (first value received in session)
2. Calculate `revolutionCount` as `(latest - baseline)` for session-relative count
3. Implement RPM derivation from timestamp history
4. Map derived RPM to `cadence` field

#### 3.2.2 `hooks/fitness/DeviceManager.js`

**Current Implementation:**
- `Device` class stores `revolutionCount` and `cadence` as raw values
- No special handling for jumprope devices
- `getMetricsSnapshot()` returns both fields

**Required Changes:**
1. No changes needed to `Device` class (it's a data container)
2. Changes happen in the router/session layer

#### 3.2.3 `hooks/fitness/UserManager.js`

**Current Code (Lines 111-127):**
```javascript
#updateCadenceData(cadence, revolutionCount = 0) {
  ...
  if (revolutionCount > cadData.totalRevolutions) {
    cadData.totalRevolutions = revolutionCount;
  }
}
```

**Current Issue:**
- Assumes `revolutionCount` always increases
- Would break if raw device counter went backwards (countdown mode)

**Required Changes:**
- No changes needed IF we fix the data at ingestion (DeviceEventRouter)
- The session-relative `revolutionCount` will always increase

#### 3.2.4 `modules/Fitness/FitnessSidebar/RealtimeCards/JumpropeCard.jsx`

**Current Code:**
```jsx
const jumps = device.revolutionCount ?? null;
const rpm = device.cadence ?? null;

const jumpsValue = Number.isFinite(jumps) ? `${Math.round(jumps)}` : '--';
const rpmValue = Number.isFinite(rpm) && rpm > 0 ? `${Math.round(rpm)}` : '--';
```

**Required Changes:**
1. UI code can remain largely the same
2. Values will be correct once ingestion layer is fixed
3. Consider adding visual indicator when RPM is "derived" vs "live"

#### 3.2.5 `modules/Fitness/FitnessSidebar/RealtimeCards/JumpropeAvatar.jsx`

**Current Implementation:**
- Uses RPM for gauge progress and zone coloring
- Pulses on jump count changes

**Required Changes:**
1. Gauge will work correctly once RPM is properly derived
2. May want to adjust thresholds for derived vs device-reported RPM
3. Consider adding staleness indicator if no recent data

---

## Part 4: New Component Design

### 4.1 JumpropeRevolutionTracker (Backend - New)

```javascript
/**
 * Tracks jumprope revolutions with direction-agnostic detection
 * Lives in: _extensions/fitness/src/decoders/jumprope.mjs
 */
class JumpropeRevolutionTracker {
  constructor() {
    this.lastRawCounter = null;      // Last raw value from device
    this.totalRevolutions = 0;       // Monotonically increasing counter
    this.connectionStartTime = null; // When BLE connected
    this.lastPacketTime = null;      // For staleness detection
  }

  /**
   * Process a new raw counter value from the device
   * @param {number} rawCounter - The counter value from BLE packet
   * @returns {{revolutions: number, timestamp: string}|null}
   */
  processPacket(rawCounter) {
    const now = Date.now();
    this.lastPacketTime = now;
    
    if (this.connectionStartTime === null) {
      this.connectionStartTime = now;
    }
    
    if (this.lastRawCounter === null) {
      // First packet - establish baseline
      this.lastRawCounter = rawCounter;
      return this._formatOutput();
    }
    
    // Detect change (regardless of direction)
    if (rawCounter !== this.lastRawCounter) {
      // Count each change as one revolution
      const delta = Math.abs(rawCounter - this.lastRawCounter);
      
      // Sanity check: if delta is huge, likely a mode switch/reset
      // In that case, count as 1 revolution, not the full delta
      if (delta > 100) {
        this.totalRevolutions += 1;
      } else {
        this.totalRevolutions += delta;
      }
      
      this.lastRawCounter = rawCounter;
    }
    
    return this._formatOutput();
  }

  _formatOutput() {
    return {
      revolutions: this.totalRevolutions,
      timestamp: new Date().toISOString()
    };
  }

  reset() {
    this.lastRawCounter = null;
    this.totalRevolutions = 0;
    this.connectionStartTime = null;
    this.lastPacketTime = null;
  }
}
```

### 4.2 JumpropeSessionState (Frontend - New)

```javascript
/**
 * Manages jumprope state for a session with baseline tracking
 * Lives in: frontend/src/hooks/fitness/ (new file or extend DeviceEventRouter)
 */
class JumpropeSessionState {
  constructor(deviceId) {
    this.deviceId = deviceId;
    this.baselineRevolutions = null;  // First value received
    this.latestRevolutions = 0;
    this.history = [];                // For RPM derivation
    this.maxHistorySize = 100;        // Keep last 100 samples
    this.rpmWindowMs = 10000;         // 10 second window for RPM calc
  }

  /**
   * Process incoming revolution data
   * @param {number} revolutions - Monotonic counter from backend
   * @param {number} timestamp - Packet timestamp (ms)
   * @returns {{sessionJumps: number, rpm: number}}
   */
  ingest(revolutions, timestamp) {
    // Establish baseline on first packet
    if (this.baselineRevolutions === null) {
      this.baselineRevolutions = revolutions;
    }
    
    this.latestRevolutions = revolutions;
    
    // Add to history for RPM calculation
    this.history.push({ revolutions, timestamp });
    
    // Trim old history
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(-this.maxHistorySize);
    }
    
    return {
      sessionJumps: this.getSessionJumps(),
      rpm: this.deriveRPM()
    };
  }

  getSessionJumps() {
    if (this.baselineRevolutions === null) return 0;
    return this.latestRevolutions - this.baselineRevolutions;
  }

  deriveRPM() {
    const now = Date.now();
    const cutoff = now - this.rpmWindowMs;
    
    const windowSamples = this.history.filter(s => s.timestamp >= cutoff);
    
    if (windowSamples.length < 2) return 0;
    
    windowSamples.sort((a, b) => a.timestamp - b.timestamp);
    
    const oldest = windowSamples[0];
    const newest = windowSamples[windowSamples.length - 1];
    
    const revDelta = newest.revolutions - oldest.revolutions;
    const timeDeltaMs = newest.timestamp - oldest.timestamp;
    
    if (timeDeltaMs <= 0 || revDelta <= 0) return 0;
    
    return Math.round((revDelta / timeDeltaMs) * 60000);
  }

  reset() {
    this.baselineRevolutions = null;
    this.latestRevolutions = 0;
    this.history = [];
  }
}
```

---

## Part 5: Migration Strategy

### 5.1 Phase 1: Backend Data Layer Fix

**Files to modify:**
1. `_extensions/fitness/src/decoders/jumprope.mjs` - Replace decoder with revolution tracker
2. `_extensions/fitness/src/ble.mjs` - Simplify broadcast payload
3. `_extensions/fitness/config/ble-devices.json` - No changes needed

**Backward compatibility:**
- Old clients will receive different payload structure
- Should bump a version field or use different `type` value initially

### 5.2 Phase 2: Frontend Ingestion Layer

**Files to modify:**
1. `frontend/src/hooks/fitness/DeviceEventRouter.js` - Add JumpropeSessionState
2. Create new file: `frontend/src/hooks/fitness/JumpropeSessionState.js`

**Backward compatibility:**
- Frontend should handle both old and new payload formats during transition

### 5.3 Phase 3: UI Updates

**Files to modify:**
1. `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/JumpropeCard.jsx`
2. `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/JumpropeAvatar.jsx`

**Changes:**
- Update RPM thresholds for derived values (may differ from device-reported)
- Add visual staleness indicator

### 5.4 Phase 4: Simulator Update

**Files to modify:**
1. `_extensions/fitness/simulation-jumprope.mjs`

**Changes:**
- Simulate both count-up and count-down scenarios
- Output only `revolutions` field

### 5.5 Phase 5: Testing & Validation

**Test scenarios:**
1. Normal jumping (counter increases)
2. Countdown mode (counter decreases)
3. Mode switch mid-session
4. BLE disconnection and reconnection
5. Rapid jumping (high RPM)
6. Slow jumping (low RPM, should still register)
7. Session persistence with jumprope data

---

## Part 6: Open Questions

### 6.1 Revolution Counter Reset Policy

**Question:** When should the backend revolution counter reset?

**Options:**
| Policy | Pros | Cons |
|--------|------|------|
| Reset on BLE disconnect | Clean separation between usage sessions | May lose data during brief disconnects |
| Reset daily (midnight) | Predictable, prevents overflow | Arbitrary; session logic already handles baseline |
| Never reset (mod 2^32) | Simplest | Eventually wraps; large numbers |
| Reset on explicit command | Most control | Requires coordination |

**Recommendation:** Reset on BLE disconnect. The frontend session state handles baseline tracking, so the backend counter is only meaningful within a single BLE connection.

### 6.2 RPM Derivation Window Size

**Question:** What rolling window size for RPM calculation?

**Analysis:**
| Window | Responsiveness | Smoothness | Use Case |
|--------|----------------|------------|----------|
| 3 sec | High | Low (jumpy) | Real-time feedback |
| 10 sec | Medium | Medium | Good default |
| 30 sec | Low | High | Averaged metrics |

**Recommendation:** 10 seconds default, configurable per-device in equipment config.

### 6.3 Handling BLE Packet Drops

**Question:** How to handle gaps in BLE data?

**Scenarios:**
1. **Occasional drop (1-2 packets):** RPM derivation handles naturally
2. **Extended drop (>5 seconds):** Revolution count may jump
3. **Reconnection:** Counter may reset or continue

**Recommendation:** 
- If `delta > 100` revolutions in single packet, treat as mode switch (count as 1)
- If staleness >30 seconds, consider device inactive
- On reconnection, let frontend re-establish baseline

### 6.4 Calorie Estimation

**Question:** Should we keep calorie estimation?

**Current formula:** `calories = jumps * 0.1`

**Analysis:**
- This is a rough estimate (10 calories per 100 jumps)
- More accurate would consider: weight, duration, intensity
- We don't have user weight in fitness context

**Recommendation:** Remove calorie estimation from backend. If needed, frontend can calculate with user-specific factors.

---

## Part 7: Acceptance Criteria

### For Phase 1-2 (Data Layer):

- [ ] Backend sends only `{revolutions, timestamp}` in WS payload
- [ ] Backend counter increases regardless of device mode
- [ ] Frontend establishes baseline on first packet per session
- [ ] Frontend calculates session jumps as `(latest - baseline)`
- [ ] Frontend derives RPM from 10-second rolling window
- [ ] RPM shows 0 when no recent data (staleness >10s)

### For Phase 3 (UI):

- [ ] JumpropeCard displays correct jump count
- [ ] JumpropeCard displays derived RPM
- [ ] JumpropeAvatar gauge reflects derived RPM
- [ ] Visual indicator when data is stale (no packets in >5s)

### For Phase 4 (Simulator):

- [ ] Simulator can run in "count up" mode
- [ ] Simulator can run in "count down" mode
- [ ] Simulator can switch modes mid-run
- [ ] Frontend handles all simulator scenarios correctly

### For Phase 5 (Testing):

- [ ] Unit tests for JumpropeRevolutionTracker
- [ ] Unit tests for JumpropeSessionState
- [ ] Integration test: full data flow from BLE to UI
- [ ] Manual test with physical RENPHO device in both modes

---

## Part 8: Appendix

### A. Packet Structure Reference

**0xAD Main Packet (20 bytes):**
```
Byte  | Description          | Notes
------|---------------------|-------
0     | Packet type (0xAD)  | 
1     | Sequence number     | Increments 0-255
2-9   | Unknown/flags       | 
10-11 | Timer (LE uint16)   | Mode-dependent, NOT RPM
12-13 | Unknown             |
14-15 | Jump counter (LE)   | Mode-dependent (up/down)
16-17 | Unknown             |
18-19 | Unknown/checksum    |
```

**0xAF Secondary Packet (8 bytes):**
```
Byte  | Description          | Notes
------|---------------------|-------
0     | Packet type (0xAF)  |
1     | Sequence number     |
2-7   | Unknown             | Possibly checksums/timing
```

### B. Example Scenarios

**Scenario 1: Count Up Mode**
```
Time  | Raw Counter | Backend revolutions | Frontend sessionJumps
0s    | 0           | 0 (baseline)        | 0
1s    | 2           | 2                   | 2
2s    | 5           | 5                   | 5
3s    | 8           | 8                   | 8
```

**Scenario 2: Count Down Mode (100 jump game)**
```
Time  | Raw Counter | Backend revolutions | Frontend sessionJumps
0s    | 100         | 0 (baseline)        | 0
1s    | 98          | 2 (+2 detected)     | 2
2s    | 95          | 5 (+3 detected)     | 5
3s    | 90          | 10 (+5 detected)    | 10
```

**Scenario 3: Mode Switch Mid-Session**
```
Time  | Raw Counter | Backend revolutions | Frontend sessionJumps
0s    | 0           | 0                   | 0
1s    | 5           | 5                   | 5
2s    | 100 (switch)| 6 (capped +1)       | 6
3s    | 98          | 8 (+2)              | 8
```

### C. Related Documentation

- [Current Jumprope Integration Doc](./jumprope-integration.md) (to be superseded)
- [Fitness Session Architecture](./fitness-session-architecture.md)
- [BLE Device Configuration](../../_extensions/fitness/config/README.md)

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2026-01-06 | Engineering | Initial analysis document |
