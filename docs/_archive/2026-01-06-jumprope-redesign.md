# Jumprope Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix jumprope BLE integration to work regardless of device mode (count up or count down).

**Architecture:** Backend detects any counter change as a revolution and sends minimal `{revolutions, timestamp}` payload. Frontend tracks baseline per session and derives RPM from rolling 10-second window.

**Tech Stack:** Node.js (backend decoder), React (frontend state/UI), Jest (unit tests)

---

## Task 1: Backend Revolution Tracker

Replace the broken RPM/jumpCount decoder with direction-agnostic revolution detection.

**Files:**
- Modify: `_extensions/fitness/src/decoders/jumprope.mjs` (full rewrite)
- Test: `tests/unit/fitness/jumprope-decoder.unit.test.mjs` (new)

**Step 1: Write the failing test**

Create `tests/unit/fitness/jumprope-decoder.unit.test.mjs`:

```javascript
import { describe, it, expect, beforeEach } from '@jest/globals';
import { RenphoJumpropeDecoder } from '../../../_extensions/fitness/src/decoders/jumprope.mjs';

describe('RenphoJumpropeDecoder', () => {
  let decoder;

  beforeEach(() => {
    decoder = new RenphoJumpropeDecoder();
  });

  describe('direction-agnostic revolution detection', () => {
    it('counts revolutions when counter increases', () => {
      // First packet establishes baseline
      const result1 = decoder.processPacket(createPacket(0));
      expect(result1.revolutions).toBe(0);

      const result2 = decoder.processPacket(createPacket(5));
      expect(result2.revolutions).toBe(5);

      const result3 = decoder.processPacket(createPacket(8));
      expect(result3.revolutions).toBe(8);
    });

    it('counts revolutions when counter decreases (countdown mode)', () => {
      // Start at 100 (countdown game)
      const result1 = decoder.processPacket(createPacket(100));
      expect(result1.revolutions).toBe(0);

      // Count down
      const result2 = decoder.processPacket(createPacket(98));
      expect(result2.revolutions).toBe(2);

      const result3 = decoder.processPacket(createPacket(95));
      expect(result3.revolutions).toBe(5);
    });

    it('caps large jumps to prevent mode-switch spikes', () => {
      decoder.processPacket(createPacket(10));
      // Simulate mode switch (counter jumps from 10 to 500)
      const result = decoder.processPacket(createPacket(500));
      // Should count as 1, not 490
      expect(result.revolutions).toBe(1);
    });

    it('ignores duplicate values', () => {
      decoder.processPacket(createPacket(5));
      const result1 = decoder.processPacket(createPacket(5));
      const result2 = decoder.processPacket(createPacket(5));
      expect(result1.revolutions).toBe(5);
      expect(result2.revolutions).toBe(5); // No change
    });

    it('resets on disconnect', () => {
      decoder.processPacket(createPacket(50));
      expect(decoder.processPacket(createPacket(55)).revolutions).toBe(5);

      decoder.reset();

      const result = decoder.processPacket(createPacket(10));
      expect(result.revolutions).toBe(0); // Fresh baseline
    });
  });

  describe('formatForWebSocket', () => {
    it('outputs only revolutions and timestamp', () => {
      decoder.processPacket(createPacket(10));
      const ws = decoder.formatForWebSocket({ address: 'AA:BB', name: 'R-Q008' });

      expect(ws.data).toHaveProperty('revolutions');
      expect(ws.data).not.toHaveProperty('rpm');
      expect(ws.data).not.toHaveProperty('avgRPM');
      expect(ws.data).not.toHaveProperty('maxRPM');
      expect(ws.data).not.toHaveProperty('calories');
    });
  });
});

/**
 * Create a mock 0xAD packet with jump count at bytes 14-15
 */
function createPacket(jumpCount) {
  const packet = new Uint8Array(20);
  packet[0] = 0xAD; // Packet type
  packet[1] = 0;    // Sequence
  packet[14] = jumpCount & 0xFF;
  packet[15] = (jumpCount >> 8) & 0xFF;
  return packet;
}
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/fitness/jumprope-decoder.unit.test.mjs`

Expected: FAIL - tests fail because decoder still has old implementation

**Step 3: Implement revolution tracker**

Replace `_extensions/fitness/src/decoders/jumprope.mjs`:

```javascript
/**
 * RENPHO Jumprope BLE Decoder
 * Direction-agnostic revolution tracking for RENPHO R-Q008
 *
 * Key insight: The raw counter can count UP or DOWN depending on device mode.
 * We detect ANY change as a revolution event.
 */

export class RenphoJumpropeDecoder {
  constructor() {
    this.lastRawCounter = null;
    this.totalRevolutions = 0;
    this.connectionStartTime = null;
    this.lastPacketTime = null;
  }

  /**
   * Process a raw BLE packet and extract revolution count
   * @param {Uint8Array} data - Raw BLE packet data
   * @returns {{revolutions: number, timestamp: string}|null}
   */
  processPacket(data) {
    const decoded = this.decode(data);
    if (!decoded || decoded.type !== 'main') return null;

    const rawCounter = decoded.jumpCount;
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
      const delta = Math.abs(rawCounter - this.lastRawCounter);

      // Sanity check: if delta is huge, likely a mode switch/reset
      // Count as 1 revolution, not the full delta
      if (delta > 100) {
        this.totalRevolutions += 1;
      } else {
        this.totalRevolutions += delta;
      }

      this.lastRawCounter = rawCounter;
    }

    return this._formatOutput();
  }

  /**
   * Decode raw BLE packet
   * @param {Uint8Array} data
   * @returns {{type: string, sequenceNum: number, jumpCount: number, rawHex: string}|null}
   */
  decode(data) {
    if (!data || data.length === 0) return null;

    const packetType = data[0];

    if (packetType === 0xAD && data.length >= 20) {
      return this._decodeMainPacket(data);
    } else if (packetType === 0xAF && data.length >= 8) {
      return this._decodeSecondaryPacket(data);
    }

    return null;
  }

  _decodeMainPacket(data) {
    // Main data packet (0xAD prefix, 20 bytes)
    // [0]: 0xAD (packet type)
    // [1]: Sequence number
    // [10-11]: Timer (NOT RPM - ignore)
    // [14-15]: Jump counter (little-endian, direction-dependent)
    const sequenceNum = data[1];
    const jumpCount = data[14] | (data[15] << 8);

    return {
      type: 'main',
      sequenceNum,
      jumpCount,
      rawHex: Buffer.from(data).toString('hex')
    };
  }

  _decodeSecondaryPacket(data) {
    return {
      type: 'secondary',
      sequenceNum: data[1],
      rawHex: Buffer.from(data).toString('hex')
    };
  }

  _formatOutput() {
    return {
      revolutions: this.totalRevolutions,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Format for WebSocket broadcast - minimal payload
   * RPM calculation moves to frontend
   */
  formatForWebSocket(deviceConfig) {
    return {
      topic: 'fitness',
      source: 'fitness',
      type: 'ble_jumprope',
      deviceId: deviceConfig.address,
      deviceName: deviceConfig.name,
      timestamp: new Date().toISOString(),
      data: {
        revolutions: this.totalRevolutions
      }
    };
  }

  /**
   * Reset state on BLE disconnect
   */
  reset() {
    this.lastRawCounter = null;
    this.totalRevolutions = 0;
    this.connectionStartTime = null;
    this.lastPacketTime = null;
  }

  /**
   * Get current revolution count
   */
  getRevolutions() {
    return this.totalRevolutions;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/fitness/jumprope-decoder.unit.test.mjs`

Expected: PASS (all tests green)

**Step 5: Commit**

```bash
git add _extensions/fitness/src/decoders/jumprope.mjs tests/unit/fitness/jumprope-decoder.unit.test.mjs
git commit -m "feat(jumprope): direction-agnostic revolution tracking

Replace RPM-based decoder with revolution counter that works regardless
of device mode (count up or count down). Backend now sends minimal
{revolutions, timestamp} payload; RPM calculation moves to frontend."
```

---

## Task 2: Update BLE Manager

Update `ble.mjs` to use the new decoder API.

**Files:**
- Modify: `_extensions/fitness/src/ble.mjs:266-290`

**Step 1: Update handleDeviceData method**

Edit `_extensions/fitness/src/ble.mjs`, replace lines 266-289:

```javascript
handleDeviceData(deviceAddress, dataArray, decoder) {
  const result = decoder.processPacket(dataArray);

  if (!result) return;

  // Log revolution count (throttled)
  const now = Date.now();
  const lastLog = this._lastJumpLogTime || 0;
  if (now - lastLog > 1000) {
    this._lastJumpLogTime = now;
    const timestamp = new Date().toISOString().split('T')[1].slice(0, -5);
    console.log(`[${timestamp}] Jumprope: ${result.revolutions} revolutions`);
  }

  // Broadcast to WebSocket
  const deviceConfig = this.devices.get(deviceAddress);
  const wsData = decoder.formatForWebSocket(deviceConfig);
  if (this.broadcastCallback) {
    this.broadcastCallback(wsData);
  }
}
```

**Step 2: Add reset on disconnect**

Find the `pythonProcess.on('close'` handler around line 144 and add decoder reset:

```javascript
pythonProcess.on('close', (code) => {
  console.log(`🛑 BLE monitor for ${deviceConfig.name} stopped (code: ${code})`);
  // Reset decoder on disconnect
  const decoder = this.decoders.get(deviceConfig.address);
  if (decoder && typeof decoder.reset === 'function') {
    decoder.reset();
  }
  this.activeMonitors.delete(deviceConfig.address);
  this.decoders.delete(deviceConfig.address);
});
```

**Step 3: Test manually**

Run the simulator briefly to verify backend still works:
```bash
node _extensions/fitness/simulation-jumprope.mjs --duration=10
```

**Step 4: Commit**

```bash
git add _extensions/fitness/src/ble.mjs
git commit -m "fix(ble): use new decoder API, reset on disconnect"
```

---

## Task 3: Frontend JumpropeSessionState

Create session state class for baseline tracking and RPM derivation.

**Files:**
- Create: `frontend/src/hooks/fitness/JumpropeSessionState.js`
- Test: `tests/unit/fitness/jumprope-session-state.unit.test.mjs` (new)

**Step 1: Write the failing test**

Create `tests/unit/fitness/jumprope-session-state.unit.test.mjs`:

```javascript
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { JumpropeSessionState } from '../../../frontend/src/hooks/fitness/JumpropeSessionState.js';

describe('JumpropeSessionState', () => {
  let state;

  beforeEach(() => {
    state = new JumpropeSessionState('test-device');
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('baseline tracking', () => {
    it('establishes baseline on first packet', () => {
      const result = state.ingest(100, Date.now());
      expect(result.sessionJumps).toBe(0);
    });

    it('calculates session jumps relative to baseline', () => {
      state.ingest(100, Date.now());
      const result = state.ingest(150, Date.now() + 1000);
      expect(result.sessionJumps).toBe(50);
    });
  });

  describe('RPM derivation', () => {
    it('returns 0 with insufficient data', () => {
      const result = state.ingest(100, Date.now());
      expect(result.rpm).toBe(0);
    });

    it('calculates RPM from 10-second rolling window', () => {
      const baseTime = Date.now();

      // 100 revolutions over 10 seconds = 600 RPM
      state.ingest(0, baseTime);

      jest.advanceTimersByTime(10000);
      const result = state.ingest(100, baseTime + 10000);

      expect(result.rpm).toBe(600);
    });

    it('ignores old samples outside window', () => {
      const baseTime = Date.now();

      state.ingest(0, baseTime);
      state.ingest(50, baseTime + 5000);

      // Advance past window
      jest.advanceTimersByTime(15000);

      // New sample 15s after baseline - old samples should be ignored
      const result = state.ingest(150, baseTime + 15000);

      // Only counts revolutions in the 10s window (from 50 to 150 = 100 revs in ~10s)
      expect(result.rpm).toBeGreaterThan(0);
    });

    it('returns 0 when stale (no recent data)', () => {
      const baseTime = Date.now();
      state.ingest(0, baseTime);
      state.ingest(50, baseTime + 5000);

      // Derive RPM with current time way beyond window
      jest.advanceTimersByTime(20000);
      const rpm = state.deriveRPM();
      expect(rpm).toBe(0);
    });
  });

  describe('reset', () => {
    it('clears all state', () => {
      state.ingest(100, Date.now());
      state.ingest(150, Date.now() + 1000);

      state.reset();

      const result = state.ingest(200, Date.now() + 2000);
      expect(result.sessionJumps).toBe(0); // Fresh baseline
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/fitness/jumprope-session-state.unit.test.mjs`

Expected: FAIL - module doesn't exist yet

**Step 3: Implement JumpropeSessionState**

Create `frontend/src/hooks/fitness/JumpropeSessionState.js`:

```javascript
/**
 * JumpropeSessionState - Manages jumprope state for a fitness session
 *
 * Tracks baseline revolutions and derives RPM from rolling window.
 * Frontend-side calculation since backend only sends raw revolution count.
 */

export class JumpropeSessionState {
  constructor(deviceId) {
    this.deviceId = deviceId;
    this.baselineRevolutions = null;
    this.latestRevolutions = 0;
    this.history = [];
    this.maxHistorySize = 100;
    this.rpmWindowMs = 10000; // 10 second window for RPM calc
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

  /**
   * Get jumps since session started
   */
  getSessionJumps() {
    if (this.baselineRevolutions === null) return 0;
    return this.latestRevolutions - this.baselineRevolutions;
  }

  /**
   * Derive RPM from rolling window
   * @returns {number} Calculated RPM (0 if insufficient data or stale)
   */
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

    // Revolutions per millisecond → Revolutions per minute
    return Math.round((revDelta / timeDeltaMs) * 60000);
  }

  /**
   * Reset state (call on session end or device reconnect)
   */
  reset() {
    this.baselineRevolutions = null;
    this.latestRevolutions = 0;
    this.history = [];
  }
}

export default JumpropeSessionState;
```

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/fitness/jumprope-session-state.unit.test.mjs`

Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/JumpropeSessionState.js tests/unit/fitness/jumprope-session-state.unit.test.mjs
git commit -m "feat(fitness): add JumpropeSessionState for frontend RPM derivation

Tracks baseline revolutions per session and derives RPM from
10-second rolling window. Handles both count-up and count-down modes."
```

---

## Task 4: Update DeviceEventRouter

Integrate JumpropeSessionState into the device router.

**Files:**
- Modify: `frontend/src/hooks/fitness/DeviceEventRouter.js:224-244`

**Step 1: Import JumpropeSessionState**

Add import at top of file:

```javascript
import { JumpropeSessionState } from './JumpropeSessionState.js';
```

**Step 2: Add session state storage to constructor**

In the constructor, add:

```javascript
// Jumprope session state per device
this._jumpropeStates = new Map();
```

**Step 3: Update ble_jumprope handler**

Replace the `ble_jumprope` handler registration (lines ~224-244):

```javascript
// BLE Jumprope Handler
this.register('ble_jumprope', (payload, ctx) => {
  if (!ctx.deviceManager) return null;

  const deviceIdStr = String(payload.deviceId);
  const equipment = ctx.getEquipmentByBle(deviceIdStr);
  const equipmentName = equipment?.name || null;

  // Get or create session state for this device
  let sessionState = this._jumpropeStates.get(deviceIdStr);
  if (!sessionState) {
    sessionState = new JumpropeSessionState(deviceIdStr);
    this._jumpropeStates.set(deviceIdStr, sessionState);
  }

  // Process the revolutions through session state
  const timestamp = payload.timestamp ? new Date(payload.timestamp).getTime() : Date.now();
  const revolutions = payload.data.revolutions ?? payload.data.jumps ?? 0;
  const { sessionJumps, rpm } = sessionState.ingest(revolutions, timestamp);

  const normalized = {
    id: deviceIdStr,
    name: equipmentName || payload.deviceName || 'Jumprope',
    type: 'jumprope',
    profile: 'jumprope',
    lastSeen: Date.now(),
    connectionState: 'connected',
    cadence: rpm,
    revolutionCount: sessionJumps,
    timestamp
  };

  return ctx.deviceManager.registerDevice(normalized);
});
```

**Step 4: Add reset method**

Add a method to reset jumprope state (for session end):

```javascript
/**
 * Reset jumprope session state for a device
 * @param {string} deviceId
 */
resetJumpropeState(deviceId) {
  const state = this._jumpropeStates.get(deviceId);
  if (state) {
    state.reset();
  }
}

/**
 * Reset all jumprope states (for new session)
 */
resetAllJumpropeStates() {
  this._jumpropeStates.forEach(state => state.reset());
}
```

**Step 5: Test manually**

Start dev server and run simulator to verify data flows correctly.

**Step 6: Commit**

```bash
git add frontend/src/hooks/fitness/DeviceEventRouter.js
git commit -m "feat(router): integrate JumpropeSessionState for RPM derivation

- Maps revolutions to session jumps via baseline tracking
- Derives RPM from 10-second rolling window
- Backward compatible with old payload format (jumps field)"
```

---

## Task 5: Update Simulator

Update simulator to output minimal payload and support countdown mode.

**Files:**
- Modify: `_extensions/fitness/simulation-jumprope.mjs`

**Step 1: Simplify data payload**

Find the `sendJumpropeData` method and update the message object:

```javascript
sendJumpropeData() {
  if (!this.connected || !this.ws) return;

  const elapsedSeconds = Math.floor((Date.now() - this.startTime) / 1000);
  const rpm = this.generateRPM(elapsedSeconds);

  // Calculate jumps added this interval
  const jumpsThisInterval = Math.round(rpm / (60 / (UPDATE_INTERVAL / 1000)));

  // Handle countdown mode
  if (this.countdownMode) {
    this.rawCounter -= jumpsThisInterval;
    if (this.rawCounter < 0) this.rawCounter = 0;
  } else {
    this.rawCounter += jumpsThisInterval;
  }

  this.totalRevolutions += jumpsThisInterval;

  const message = {
    topic: 'fitness',
    source: 'fitness-simulator',
    type: 'ble_jumprope',
    deviceId: DEVICE_ID,
    deviceName: DEVICE_NAME,
    timestamp: new Date().toISOString(),
    data: {
      revolutions: this.totalRevolutions
    }
  };

  this.ws.send(JSON.stringify(message));

  // Log every 2 seconds
  if (elapsedSeconds % 2 === 0 && this.lastLoggedSecond !== elapsedSeconds) {
    this.lastLoggedSecond = elapsedSeconds;
    const phase = this.getCurrentPhase(elapsedSeconds);
    const mode = this.countdownMode ? '(countdown)' : '(count up)';
    console.log(`🦘 [${elapsedSeconds}s] ${phase.name} ${mode}: ${this.totalRevolutions} revs @ ~${rpm} RPM`);
  }
}
```

**Step 2: Add countdown mode support**

Add argument parsing and mode switching:

```javascript
// At top with other arg parsing
const countdownArg = process.argv.includes('--countdown');
const switchModeArg = process.argv.includes('--switch-mode');

// In constructor
this.countdownMode = countdownArg;
this.rawCounter = countdownArg ? 500 : 0; // Start at 500 for countdown
this.totalRevolutions = 0;
this.shouldSwitchMode = switchModeArg;
this.modeSwitched = false;

// In generateRPM or sendJumpropeData, add mode switch logic
if (this.shouldSwitchMode && !this.modeSwitched && elapsedSeconds > 30) {
  this.countdownMode = !this.countdownMode;
  this.rawCounter = this.countdownMode ? 500 : 0;
  this.modeSwitched = true;
  console.log(`🔄 Mode switched to ${this.countdownMode ? 'countdown' : 'count up'}`);
}
```

**Step 3: Update usage docs**

Update the comment at top:

```javascript
/**
 * Jump Rope Simulator - Generates realistic jump rope BLE data
 *
 * Usage:
 *   node simulation-jumprope.mjs [options]
 *
 * Options:
 *   --duration=SECONDS  Simulation duration (default: 120)
 *   --device=DEVICE_ID  Custom device ID
 *   --countdown         Start in countdown mode (counter decreases)
 *   --switch-mode       Switch between modes mid-simulation
 */
```

**Step 4: Test simulator modes**

```bash
# Count up mode (default)
node _extensions/fitness/simulation-jumprope.mjs --duration=15

# Countdown mode
node _extensions/fitness/simulation-jumprope.mjs --duration=15 --countdown

# Mode switch
node _extensions/fitness/simulation-jumprope.mjs --duration=45 --switch-mode
```

**Step 5: Commit**

```bash
git add _extensions/fitness/simulation-jumprope.mjs
git commit -m "feat(simulator): minimal payload, countdown mode support

- Output only revolutions field (not rpm/avgRPM/etc)
- Add --countdown flag for countdown mode testing
- Add --switch-mode flag for mode switch testing"
```

---

## Task 6: Add Staleness Indicator to UI

Add visual feedback when jumprope data is stale.

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/JumpropeCard.jsx`
- Modify: `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/JumpropeCard.scss`

**Step 1: Add staleness check to JumpropeCard**

Update `JumpropeCard.jsx`:

```javascript
// Add staleness detection (5 seconds)
const STALENESS_THRESHOLD_MS = 5000;
const isStale = device.timestamp && (Date.now() - device.timestamp > STALENESS_THRESHOLD_MS);

// Update card classes
const cardClasses = [
  'jumprope-card',
  'fitness-device',
  layoutMode === 'vert' ? 'card-vertical' : 'card-horizontal',
  isInactive ? 'inactive' : 'active',
  isCountdownActive ? 'countdown-active' : '',
  isStale ? 'stale' : '',
  zoneClass
].filter(Boolean).join(' ');

// Update RPM display to show -- when stale
const rpmValue = isStale ? '--' : (Number.isFinite(rpm) && rpm > 0 ? `${Math.round(rpm)}` : '--');
```

**Step 2: Add stale styles**

Add to `JumpropeCard.scss`:

```scss
.jumprope-card.stale {
  opacity: 0.6;

  .device-stats .device-value {
    color: var(--color-text-muted, #888);
  }
}
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/JumpropeCard.jsx frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/JumpropeCard.scss
git commit -m "feat(ui): add staleness indicator to JumpropeCard

Shows muted styling and '--' for RPM when no data received in 5 seconds."
```

---

## Task 7: Integration Test

Verify full data flow works end-to-end.

**Files:**
- Create: `tests/integration/jumprope-flow.integration.test.mjs` (optional manual test script)

**Step 1: Manual integration test**

Create a test checklist (no code needed):

1. Start dev server: `npm run dev`
2. Open fitness app in browser
3. Run simulator in count-up mode: `node _extensions/fitness/simulation-jumprope.mjs --duration=30`
4. Verify: Jump count increases, RPM displays correctly
5. Stop simulator, wait 5 seconds
6. Verify: Card shows stale state (muted, -- RPM)
7. Run simulator in countdown mode: `node _extensions/fitness/simulation-jumprope.mjs --duration=30 --countdown`
8. Verify: Jump count still increases (session-relative)
9. Run simulator with mode switch: `node _extensions/fitness/simulation-jumprope.mjs --duration=60 --switch-mode`
10. Verify: No spike in jump count when mode switches

**Step 2: Document test results**

Add results to the design doc or create a test report.

**Step 3: Final commit**

```bash
git add -A
git commit -m "docs: jumprope redesign complete

All phases implemented:
- Backend: direction-agnostic revolution tracking
- Frontend: session state with baseline + RPM derivation
- UI: staleness indicator
- Simulator: countdown mode support"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Backend revolution tracker | `_extensions/fitness/src/decoders/jumprope.mjs` |
| 2 | BLE manager update | `_extensions/fitness/src/ble.mjs` |
| 3 | JumpropeSessionState | `frontend/src/hooks/fitness/JumpropeSessionState.js` |
| 4 | DeviceEventRouter integration | `frontend/src/hooks/fitness/DeviceEventRouter.js` |
| 5 | Simulator updates | `_extensions/fitness/simulation-jumprope.mjs` |
| 6 | UI staleness indicator | `JumpropeCard.jsx`, `JumpropeCard.scss` |
| 7 | Integration test | Manual verification |

**Estimated commits:** 7
