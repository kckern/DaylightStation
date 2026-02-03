# HR Simulation Control Panel - Design Document v2

**Date:** 2026-02-03
**Status:** Ready for Implementation
**Supersedes:** 2026-02-03-hr-simulation-panel-design.md (v1)

---

## Overview

A localhost-only testing tool for controlling simulated HR devices during fitness sessions. Replaces the deprecated CLI simulation script with a browser-native solution accessible via popup UI and Playwright tests.

## Goals

1. **Manual testing** - Popup UI to control participant HR zones in real-time
2. **Test automation** - `FitnessSimHelper` class for Playwright tests
3. **Governance testing** - Trigger challenges, override governance on any content
4. **Deprecate CLI** - Remove `_extensions/fitness/simulation.mjs`

## Non-Goals

- Cadence/RPM/Power simulation (HR only)
- Production usage (localhost-gated)
- Backward compatibility with CLI script

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Consumers                                      │
│  ┌──────────────┐  ┌──────────────┐            │
│  │ Popup UI     │  │ Playwright   │            │
│  │ (vanilla JS) │  │ Tests        │            │
│  └──────┬───────┘  └──────┬───────┘            │
│         │                 │                     │
│    window.opener     page.evaluate()           │
│         │                 │                     │
│         ▼                 ▼                     │
│  ┌─────────────────────────────────────────┐   │
│  │  window.__fitnessSimController          │   │
│  │  FitnessSimulationController            │   │
│  └─────────────────────────────────────────┘   │
│         │                                       │
│         │ wsService.send()                      │
│         ▼                                       │
│  ┌─────────────────────────────────────────┐   │
│  │  WebSocket → FitnessContext.ingestData  │   │
│  │  (normal device data pipeline)          │   │
│  └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘

CLI simulation.mjs → DEPRECATED
```

**Data flow:**
1. Consumer calls controller method (popup click or test evaluate)
2. Controller builds ANT+ message with correct format
3. Message sent via WebSocket (same path as real devices)
4. FitnessContext processes via normal pipeline
5. UI updates reactively

---

## Component 1: FitnessSimulationController

**File:** `frontend/src/modules/Fitness/FitnessSimulationController.js`

Plain JS class (not React) that orchestrates all simulation.

### Constructor

```javascript
constructor({ wsService, getSession, zoneConfig })
```

- `wsService` - WebSocket service for sending messages
- `getSession` - Function returning current session (handles recreation)
- `zoneConfig` - Zone thresholds for midpoint calculation

### Manual Control

```javascript
setZone(deviceId, zone)        // Set device to zone's midpoint HR
setHR(deviceId, bpm)           // Set exact HR value
stopDevice(deviceId)           // Trigger dropout (stops sending data)
```

### Automation

```javascript
startAuto(deviceId)            // 3-min waveform cycle (loops forever)
startAutoSession(deviceId, opts)  // Realistic session progression (ends)
stopAuto(deviceId)             // Stop any automation for device
```

**`startAutoSession` options:**
```javascript
{
  duration: 720,        // Total session length in seconds (default 12 min)
  intensity: 'moderate', // 'easy' | 'moderate' | 'hard' - affects peak zones
  phaseOffset: 0        // Seconds to offset phase timing
}
```

**Session phases:**
1. Warmup: cool → active (15% of duration)
2. Build: active → warm → hot (25% of duration)
3. Peak: hot ↔ fire with variation (45% of duration)
4. Cooldown: → active → cool (15% of duration)

### Bulk Operations

```javascript
activateAll(zone = 'active')   // Start all configured devices at zone
startAutoSessionAll(opts)      // All devices with random phase offsets
stopAll()                      // Stop all devices
```

### Governance Simulation

```javascript
triggerChallenge(opts)         // Start a challenge event
completeChallenge(success)     // End challenge with pass/fail
getGovernanceState()           // Current phase, challenge status
```

**`triggerChallenge` options:**
```javascript
{
  type: 'zone_target',    // 'zone_target' | 'hold_zone' | 'group_sync'
  targetZone: 'hot',      // Zone participants must reach
  duration: 30            // Challenge duration in seconds
}
```

**`getGovernanceState` returns:**
```javascript
{
  phase: 'warmup' | 'main' | 'cooldown',
  activeChallenge: {
    type: 'zone_target',
    targetZone: 'hot',
    remainingSeconds: 12,
    participantProgress: { 'device123': true, 'device456': false }
  } | null,
  stats: { challengesWon: 2, challengesFailed: 1 }
}
```

### Governance Override

```javascript
enableGovernance(opts)         // Force-enable on ungoverned content
disableGovernance()            // Revert to content's default state
isGovernanceOverridden()       // Returns true if force-enabled
```

**`enableGovernance` options:**
```javascript
{
  phases: {
    warmup: 120,    // seconds
    main: null,     // null = until video ends
    cooldown: 120
  },
  challenges: {
    enabled: true,
    interval: 120,  // seconds between challenges
    duration: 30    // challenge duration
  },
  targetZones: ['hot', 'fire']  // zones that count for challenges
}
```

### State Queries

```javascript
getDevices()                   // All configured devices with current state
getActiveDevices()             // Only devices currently sending data
```

**Device state shape:**
```javascript
{
  deviceId: '12345',
  name: 'KC',
  currentHR: 142,
  currentZone: 'hot',
  isActive: true,
  autoMode: 'session',  // null | 'waveform' | 'session'
  beatCount: 847
}
```

### Lifecycle

```javascript
destroy()                      // Clear all intervals, cleanup
```

### Return Values

All mutation methods return:
```javascript
{ ok: true, ...data }    // Success
{ ok: false, error: '...' }  // Failure with message
```

### Internal State

Controller tracks per-device:
- `beatCount` - Accumulates, wraps at 255
- `autoInterval` - Reference to setInterval for cleanup
- `autoMode` - Current automation type
- `lastHR` - Most recent HR value sent

### ANT+ Message Format

Messages match the format expected by DeviceManager:

```javascript
{
  topic: 'fitness',
  source: 'fitness-simulator',
  type: 'ant',
  timestamp: new Date().toISOString(),
  profile: 'HR',
  deviceId: '12345',
  dongleIndex: 0,
  data: {
    ManId: 255,
    SerialNumber: 12345,
    HwVersion: 5,
    SwVersion: 1,
    ModelNum: 2,
    BatteryLevel: 100,
    BatteryVoltage: 4.15625,
    BatteryStatus: 'Good',
    DeviceID: 12345,
    Channel: 0,
    BeatTime: 34567,           // (seconds * 1024) % 65536
    BeatCount: 142,            // Accumulated, wraps at 255
    ComputedHeartRate: 145,    // The HR value
    PreviousBeat: 33543,       // BeatTime - 1024
    OperatingTime: 180000      // Elapsed ms
  }
}
```

### Zone Midpoint Calculation

Midpoints computed from `zoneConfig` at runtime:

```javascript
// zoneConfig: [{ id: 'cool', min: 60 }, { id: 'active', min: 100 }, ...]
// Midpoint = (thisZone.min + nextZone.min) / 2
// For fire (last zone): min + 15

cool: (60 + 100) / 2 = 80
active: (100 + 120) / 2 = 110
warm: (120 + 140) / 2 = 130
hot: (140 + 160) / 2 = 150
fire: 160 + 15 = 175
```

---

## Component 2: Popup UI

**File:** `frontend/public/sim-panel.html`

Single HTML file with embedded CSS and JS. No build step required.

### Layout

```
┌─────────────────────────────────────┐
│ HR Simulation Panel            [X] │
├─────────────────────────────────────┤
│ Governance: main | Challenge: none  │
│ [Enable Gov] [Trigger Challenge]    │
├─────────────────────────────────────┤
│ [Activate All ▼] [Auto Session All] │
│ [Stop All]                          │
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │ KC (12345)            142 bpm  │ │
│ │ ○cool ○actv ●warm ○hot ○fire  │ │
│ │ [auto] [session] [stop]        │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ Milo (12346)          -- bpm   │ │
│ │ ○cool ○actv ○warm ○hot ○fire  │ │
│ │ [auto] [session] [stop]        │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

### Behavior

**On load:**
1. Get `window.opener.__fitnessSimController`
2. If missing, show error: "Open from FitnessPlayer"
3. Call `getDevices()` to populate device list
4. Subscribe to state changes via `window.opener.addEventListener('sim-state-change', ...)`

**Zone buttons:**
- Radio-style selection (one active per device)
- Colored backgrounds: blue/green/yellow/orange/red
- Click calls `controller.setZone(deviceId, zone)`

**Auto buttons:**
- "auto" → `startAuto(deviceId)` (looping waveform)
- "session" → `startAutoSession(deviceId)` (realistic progression)
- "stop" → `stopAuto(deviceId)`
- Active automation shows indicator

**Governance section:**
- "Enable Gov" → Opens modal for governance options, calls `enableGovernance(opts)`
- "Trigger Challenge" → Calls `triggerChallenge({ targetZone: 'hot' })`
- Shows current phase and challenge status

**Bulk buttons:**
- "Activate All" dropdown: cool/active/warm/hot/fire
- "Auto Session All" → `startAutoSessionAll()`
- "Stop All" → `stopAll()`

### Dimensions

- Width: 400px
- Height: 500px (resizable)
- Scrollable device list for many devices

---

## Component 3: Trigger Button

**File:** `frontend/src/modules/Fitness/HRSimTrigger.jsx`

Small gear button in FitnessPlayer that opens the popup.

```jsx
export function HRSimTrigger() {
  const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  if (!isLocalhost) return null;

  const openPanel = () => {
    window.open('/sim-panel.html', 'sim-panel', 'width=400,height=500');
  };

  return (
    <button
      className="hr-sim-trigger"
      onClick={openPanel}
      title="Open HR Simulation Panel"
    >
      ⚙
    </button>
  );
}
```

**Styling:**
- Small gray gear icon
- Bottom-left corner of FitnessPlayer
- Unobtrusive, doesn't interfere with player controls

---

## Component 4: Context Integration

**File:** `frontend/src/context/FitnessContext.jsx`

Add effect to expose controller on localhost.

```javascript
// Add near line 1090, with other effects
useEffect(() => {
  const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  if (!isLocalhost) return;

  let controller = null;

  import('../modules/Fitness/FitnessSimulationController.js')
    .then(({ FitnessSimulationController }) => {
      controller = new FitnessSimulationController({
        wsService,
        getSession: () => fitnessSessionRef.current,
        zoneConfig: normalizedBaseZoneConfig
      });

      window.__fitnessSimController = controller;

      // Broadcast state changes for popup
      controller.onStateChange = () => {
        window.dispatchEvent(new CustomEvent('sim-state-change', {
          detail: controller.getDevices()
        }));
      };
    });

  return () => {
    if (controller) {
      controller.destroy();
      delete window.__fitnessSimController;
    }
  };
}, [normalizedBaseZoneConfig]);
```

**Notes:**
- Dynamic import keeps controller out of production bundle
- `getSession` is a getter to handle session recreation
- `onStateChange` callback broadcasts to popup via CustomEvent

---

## Component 5: Playwright Test Helper

**File:** `tests/_lib/FitnessSimHelper.mjs`

Thin wrapper for clean test syntax.

```javascript
export class FitnessSimHelper {
  constructor(page) {
    this.page = page;
  }

  async waitForController(timeout = 10000) {
    await this.page.waitForFunction(
      () => window.__fitnessSimController,
      { timeout }
    );
  }

  // Manual control
  async setZone(deviceId, zone) {
    return this.page.evaluate(
      ([id, z]) => window.__fitnessSimController.setZone(id, z),
      [deviceId, zone]
    );
  }

  async setHR(deviceId, bpm) {
    return this.page.evaluate(
      ([id, hr]) => window.__fitnessSimController.setHR(id, hr),
      [deviceId, bpm]
    );
  }

  async stopDevice(deviceId) {
    return this.page.evaluate(
      (id) => window.__fitnessSimController.stopDevice(id),
      deviceId
    );
  }

  // Automation
  async startAuto(deviceId) {
    return this.page.evaluate(
      (id) => window.__fitnessSimController.startAuto(id),
      deviceId
    );
  }

  async startAutoSession(deviceId, opts = {}) {
    return this.page.evaluate(
      ([id, o]) => window.__fitnessSimController.startAutoSession(id, o),
      [deviceId, opts]
    );
  }

  async stopAuto(deviceId) {
    return this.page.evaluate(
      (id) => window.__fitnessSimController.stopAuto(id),
      deviceId
    );
  }

  // Bulk
  async activateAll(zone = 'active') {
    return this.page.evaluate(
      (z) => window.__fitnessSimController.activateAll(z),
      zone
    );
  }

  async startAutoSessionAll(opts = {}) {
    return this.page.evaluate(
      (o) => window.__fitnessSimController.startAutoSessionAll(o),
      opts
    );
  }

  async stopAll() {
    return this.page.evaluate(() => window.__fitnessSimController.stopAll());
  }

  // Governance
  async enableGovernance(opts = {}) {
    return this.page.evaluate(
      (o) => window.__fitnessSimController.enableGovernance(o),
      opts
    );
  }

  async disableGovernance() {
    return this.page.evaluate(() => window.__fitnessSimController.disableGovernance());
  }

  async triggerChallenge(opts = {}) {
    return this.page.evaluate(
      (o) => window.__fitnessSimController.triggerChallenge(o),
      opts
    );
  }

  async completeChallenge(success) {
    return this.page.evaluate(
      (s) => window.__fitnessSimController.completeChallenge(s),
      success
    );
  }

  async getGovernanceState() {
    return this.page.evaluate(() => window.__fitnessSimController.getGovernanceState());
  }

  // Queries
  async getDevices() {
    return this.page.evaluate(() => window.__fitnessSimController.getDevices());
  }

  async getActiveDevices() {
    return this.page.evaluate(() => window.__fitnessSimController.getActiveDevices());
  }

  // Convenience assertions
  async waitForZone(deviceId, zone, timeout = 5000) {
    await this.page.waitForFunction(
      ([id, z]) => {
        const ctrl = window.__fitnessSimController;
        if (!ctrl) return false;
        const device = ctrl.getDevices().find(d => d.deviceId === id);
        return device?.currentZone === z;
      },
      [deviceId, zone],
      { timeout }
    );
  }

  async waitForActiveCount(count, timeout = 5000) {
    await this.page.waitForFunction(
      (c) => {
        const ctrl = window.__fitnessSimController;
        return ctrl && ctrl.getActiveDevices().length === c;
      },
      count,
      { timeout }
    );
  }
}
```

---

## Exit Criteria: Happy Path Tests

**File:** `tests/live/flow/fitness/fitness-happy-path.runtime.test.mjs`

Add these tests after existing tests (8-11):

```javascript
import { FitnessSimHelper } from '#testlib/FitnessSimHelper.mjs';

// ═══════════════════════════════════════════════════════════════
// TEST 8: Simulation controller initializes
// ═══════════════════════════════════════════════════════════════
test('simulation controller available on localhost', async () => {
  // Navigate to player if not already there
  if (!sharedPage.url().includes('/fitness/play/')) {
    // Use any content - governance will be overridden
    await sharedPage.goto(`${BASE_URL}/fitness`);
    await sharedPage.waitForTimeout(2000);
  }

  const sim = new FitnessSimHelper(sharedPage);
  await sim.waitForController();

  const devices = await sim.getDevices();
  console.log(`Controller ready with ${devices.length} configured devices`);
  expect(devices.length).toBeGreaterThan(0);
});

// ═══════════════════════════════════════════════════════════════
// TEST 9: Zone changes update participant state
// ═══════════════════════════════════════════════════════════════
test('setting zone updates participant state', async () => {
  const sim = new FitnessSimHelper(sharedPage);
  await sim.waitForController();

  const devices = await sim.getDevices();
  const device = devices[0];

  // Set to hot zone
  const result = await sim.setZone(device.deviceId, 'hot');
  expect(result.ok).toBe(true);

  // Wait for zone to register
  await sim.waitForZone(device.deviceId, 'hot');

  // Verify device state
  const updated = await sim.getDevices();
  const updatedDevice = updated.find(d => d.deviceId === device.deviceId);
  expect(updatedDevice.currentZone).toBe('hot');
  expect(updatedDevice.currentHR).toBeGreaterThan(140);

  console.log(`Device ${device.deviceId} now at ${updatedDevice.currentHR} bpm (${updatedDevice.currentZone})`);
});

// ═══════════════════════════════════════════════════════════════
// TEST 10: Auto session progresses through zones
// ═══════════════════════════════════════════════════════════════
test('auto session progresses through zones', async () => {
  const sim = new FitnessSimHelper(sharedPage);
  await sim.waitForController();

  const devices = await sim.getDevices();
  const device = devices[0];

  // Start short auto session (30 seconds)
  await sim.startAutoSession(device.deviceId, { duration: 30 });

  // Should start in warmup (cool → active)
  await sim.waitForZone(device.deviceId, 'active', 10000);
  console.log('Device reached active zone (warmup phase)');

  // Should progress to higher zones
  await sim.waitForZone(device.deviceId, 'warm', 15000);
  console.log('Device reached warm zone (build phase)');

  await sim.stopAuto(device.deviceId);
});

// ═══════════════════════════════════════════════════════════════
// TEST 11: Governance override enables challenges
// ═══════════════════════════════════════════════════════════════
test('governance override enables challenges on any content', async () => {
  const sim = new FitnessSimHelper(sharedPage);
  await sim.waitForController();

  // Enable governance with short phases for testing
  await sim.enableGovernance({
    phases: { warmup: 3, main: 60, cooldown: 3 },
    challenges: { enabled: true, interval: 10, duration: 15 }
  });

  // Activate all participants
  await sim.activateAll('active');
  await sim.waitForActiveCount((await sim.getDevices()).length, 5000);
  console.log('All devices activated');

  // Wait for warmup, then trigger challenge
  await sharedPage.waitForTimeout(4000);

  const challengeResult = await sim.triggerChallenge({ targetZone: 'hot' });
  expect(challengeResult.ok).toBe(true);
  console.log('Challenge triggered');

  // Verify governance state shows active challenge
  const state = await sim.getGovernanceState();
  expect(state.activeChallenge).not.toBeNull();
  expect(state.activeChallenge.targetZone).toBe('hot');

  // Move all devices to target zone
  const devices = await sim.getDevices();
  for (const d of devices) {
    await sim.setZone(d.deviceId, 'hot');
  }

  // Complete challenge successfully
  await sim.completeChallenge(true);

  // Verify win recorded
  const finalState = await sim.getGovernanceState();
  expect(finalState.stats.challengesWon).toBeGreaterThan(0);
  console.log(`Challenge completed. Wins: ${finalState.stats.challengesWon}`);

  // Cleanup
  await sim.disableGovernance();
  await sim.stopAll();
});
```

---

## File Summary

### New Files (5)

| File | Purpose | Lines (est) |
|------|---------|-------------|
| `frontend/src/modules/Fitness/FitnessSimulationController.js` | Core controller | ~250 |
| `frontend/public/sim-panel.html` | Vanilla JS popup | ~300 |
| `frontend/src/modules/Fitness/HRSimTrigger.jsx` | Gear button | ~25 |
| `tests/_lib/FitnessSimHelper.mjs` | Playwright wrapper | ~120 |
| `tests/live/flow/fitness/fitness-governance-simulation.runtime.test.mjs` | Exit criteria tests | ~400 |

### Modified Files (3)

| File | Changes |
|------|---------|
| `frontend/src/context/FitnessContext.jsx` | +25 lines (controller exposure) |
| `frontend/src/modules/Fitness/FitnessPlayer.jsx` | +3 lines (trigger import/render) |
| `tests/live/flow/fitness/fitness-happy-path.runtime.test.mjs` | +80 lines (tests 8-11) |

### Deprecated (1)

| File | Action |
|------|--------|
| `_extensions/fitness/simulation.mjs` | Add deprecation notice at top |

---

## Implementation Order

1. **FitnessSimulationController.js** - Core logic, testable in isolation
2. **FitnessContext integration** - Expose on `window.__fitnessSimController`
3. **FitnessSimHelper.mjs** - Test helper
4. **Happy path tests (8-11)** - Validates controller works E2E
5. **Governance simulation tests (1-11)** - Full exit criteria suite
6. **sim-panel.html + HRSimTrigger.jsx** - UI layer
7. **Deprecate CLI script** - Add notice, update docs

---

## Error Handling

### Controller Errors

| Method | Error Conditions |
|--------|------------------|
| `setZone(deviceId, zone)` | Invalid zone name, unknown deviceId |
| `setHR(deviceId, bpm)` | bpm out of range (40-220), unknown deviceId |
| `triggerChallenge()` | No active session, governance not enabled |
| `completeChallenge()` | No active challenge |
| `enableGovernance()` | Already overridden (call disable first) |

All errors return `{ ok: false, error: 'Human-readable message' }`.

### Popup Errors

- No opener: "Open this panel from FitnessPlayer"
- No controller: "Simulation not available - reload FitnessPlayer"
- Controller lost (navigation): "Connection lost - reopen panel"

---

## Security

1. **Localhost-only** - All code gated by hostname check
2. **Dynamic import** - Controller not bundled in production
3. **Same data path** - Simulated data flows through normal pipeline
4. **No secrets** - Controller only accesses public session state

---

## Manual Testing Checklist

- [ ] Open FitnessPlayer on localhost, gear button visible
- [ ] Click gear, popup opens at correct size
- [ ] Configured devices appear in popup
- [ ] Zone buttons change device HR in main window
- [ ] "stop" triggers dropout
- [ ] "auto" cycles through zones
- [ ] "session" progresses realistically
- [ ] "Enable Gov" enables governance on ungoverned content
- [ ] "Trigger Challenge" shows challenge UI
- [ ] Close popup, no console errors
- [ ] Visit on non-localhost, gear button hidden

---

## Acceptance Criteria

**The feature is complete when:**

1. [ ] All existing happy path tests pass (1-7)
2. [ ] Happy path simulation tests pass (8-11)
3. [ ] **All governance simulation tests pass (see below)**
4. [ ] Popup UI functional for manual testing
5. [ ] CLI script marked deprecated

---

## Governance Simulation Test Suite (Exit Criteria)

**File:** `tests/live/flow/fitness/fitness-governance-simulation.runtime.test.mjs`

This is the definitive exit criteria. All 11 tests must pass with strict assertions.

### Test 1: Challenge Win - All Participants Reach Target

**Setup:**
- Enable governance
- Activate 2 devices in 'active' zone

**Actions:**
1. Trigger challenge: `{ targetZone: 'hot', duration: 30 }`
2. Move device 1 to 'hot'
3. Move device 2 to 'hot'
4. Wait for auto-completion or call `completeChallenge(true)`

**Pass Criteria:**
```javascript
// Before challenge
expect(stateBefore.activeChallenge).toBeNull();
expect(stateBefore.stats.challengesWon).toBe(0);

// During challenge
expect(activeChal.targetZone).toBe('hot');
expect(activeChal.participantProgress[device1.deviceId]).toBe(false); // not yet

// After moving to hot
expect(activeChal.participantProgress[device1.deviceId]).toBe(true);
expect(activeChal.participantProgress[device2.deviceId]).toBe(true);

// After completion
expect(stateAfter.activeChallenge).toBeNull();
expect(stateAfter.stats.challengesWon).toBe(1);
expect(stateAfter.stats.challengesFailed).toBe(0);
```

---

### Test 2: Challenge Fail - Timeout Expires

**Setup:**
- Enable governance
- Activate 2 devices in 'active' zone

**Actions:**
1. Trigger challenge: `{ targetZone: 'fire', duration: 5 }` (short timeout)
2. Move device 1 to 'warm' only (not target)
3. Leave device 2 in 'active'
4. Wait for timeout

**Pass Criteria:**
```javascript
// During challenge - neither at target
expect(activeChal.participantProgress[device1.deviceId]).toBe(false);
expect(activeChal.participantProgress[device2.deviceId]).toBe(false);

// After timeout
expect(stateAfter.activeChallenge).toBeNull();
expect(stateAfter.stats.challengesWon).toBe(0);
expect(stateAfter.stats.challengesFailed).toBe(1);
```

---

### Test 3: Multi-Hurdle Sequential Challenges

**Setup:**
- Enable governance with `{ challenges: { interval: 2 } }` (fast interval)
- Activate 2 devices in 'cool' zone

**Actions:**
1. Trigger challenge 1: `{ targetZone: 'active' }` → complete successfully
2. Trigger challenge 2: `{ targetZone: 'warm' }` → complete successfully
3. Trigger challenge 3: `{ targetZone: 'hot' }` → complete successfully
4. Trigger challenge 4: `{ targetZone: 'fire' }` → fail (don't move devices)

**Pass Criteria:**
```javascript
// After each hurdle, stats accumulate
expect(stateAfterHurdle1.stats.challengesWon).toBe(1);
expect(stateAfterHurdle2.stats.challengesWon).toBe(2);
expect(stateAfterHurdle3.stats.challengesWon).toBe(3);
expect(stateAfterHurdle4.stats.challengesWon).toBe(3);
expect(stateAfterHurdle4.stats.challengesFailed).toBe(1);

// Devices should be at their last successful zone
const finalDevices = await sim.getDevices();
expect(finalDevices[0].currentZone).toBe('hot');
expect(finalDevices[1].currentZone).toBe('hot');
```

---

### Test 4: Partial Completion - Mixed Results

**Setup:**
- Enable governance
- Activate 3 devices in 'active' zone

**Actions:**
1. Trigger challenge: `{ targetZone: 'hot', duration: 10 }`
2. Move device 1 to 'hot'
3. Move device 2 to 'hot'
4. Leave device 3 in 'active'
5. Wait for completion

**Pass Criteria:**
```javascript
// During challenge
expect(activeChal.participantProgress[device1.deviceId]).toBe(true);
expect(activeChal.participantProgress[device2.deviceId]).toBe(true);
expect(activeChal.participantProgress[device3.deviceId]).toBe(false);

// Count participants who reached target
const reachedTarget = Object.values(activeChal.participantProgress).filter(Boolean).length;
expect(reachedTarget).toBe(2);
const totalParticipants = Object.keys(activeChal.participantProgress).length;
expect(totalParticipants).toBe(3);
```

---

### Test 5: Participant Dropout Mid-Challenge

**Setup:**
- Enable governance
- Activate 2 devices in 'active' zone

**Actions:**
1. Trigger challenge: `{ targetZone: 'hot', duration: 15 }`
2. Move device 1 to 'hot' (reaches target)
3. Call `stopDevice(device2.deviceId)` (dropout)
4. Wait for completion

**Pass Criteria:**
```javascript
// Device 1 reached target
expect(activeChal.participantProgress[device1.deviceId]).toBe(true);

// Device 2 dropped out - should be excluded from progress tracking
const activeDevices = await sim.getActiveDevices();
expect(activeDevices.length).toBe(1);
expect(activeDevices[0].deviceId).toBe(device1.deviceId);

// Challenge can still complete with remaining participant
expect(stateAfter.activeChallenge).toBeNull();
```

---

### Test 6: Zone Overshoot - Fire When Target Is Hot

**Setup:**
- Enable governance
- Activate 1 device in 'active' zone

**Actions:**
1. Trigger challenge: `{ targetZone: 'hot', duration: 10 }`
2. Move device directly to 'fire' (overshoots 'hot')

**Pass Criteria:**
```javascript
// Fire >= hot, so target should be considered reached
expect(activeChal.participantProgress[device.deviceId]).toBe(true);

// Device is actually in fire
const devices = await sim.getDevices();
expect(devices[0].currentZone).toBe('fire');
expect(devices[0].currentHR).toBeGreaterThanOrEqual(160);
```

---

### Test 7: Zone Oscillation Around Boundary

**Setup:**
- Enable governance
- Activate 1 device at HR 138 (just below 'hot' threshold of 140)

**Actions:**
1. Trigger challenge: `{ targetZone: 'hot', duration: 15 }`
2. Set HR to 139 (still 'warm')
3. Verify not reached
4. Set HR to 141 (now 'hot')
5. Verify reached
6. Set HR to 138 (back to 'warm')
7. Verify still counted as reached (once reached = reached)

**Pass Criteria:**
```javascript
// At 139 bpm
expect((await sim.getDevices())[0].currentZone).toBe('warm');
expect(activeChal.participantProgress[device.deviceId]).toBe(false);

// At 141 bpm
expect((await sim.getDevices())[0].currentZone).toBe('hot');
expect(activeChal.participantProgress[device.deviceId]).toBe(true);

// Back at 138 bpm - still counts as reached (sticky)
expect((await sim.getDevices())[0].currentZone).toBe('warm');
expect(activeChal.participantProgress[device.deviceId]).toBe(true);
```

---

### Test 8: Challenge During Phase Transitions

**Setup:**
- Enable governance: `{ phases: { warmup: 5, main: 30, cooldown: 5 } }`
- Activate 1 device in 'active' zone

**Actions:**
1. Verify phase is 'warmup'
2. Wait 6 seconds
3. Verify phase transitioned to 'main'
4. Trigger challenge during 'main'
5. Complete challenge

**Pass Criteria:**
```javascript
// Initial phase
expect(initialState.phase).toBe('warmup');

// After transition
expect(stateAfterWait.phase).toBe('main');

// Challenge in main phase
expect(activeChal).not.toBeNull();
const stateWithChallenge = await sim.getGovernanceState();
expect(stateWithChallenge.phase).toBe('main');
```

---

### Test 9: Governance Override On/Off

**Setup:**
- Start with ungoverned content (no governance active)
- Activate 1 device

**Actions:**
1. Verify `getGovernanceState()` returns null or no-governance indicator
2. Call `enableGovernance(opts)`
3. Verify governance active
4. Trigger and complete a challenge
5. Call `disableGovernance()`
6. Verify governance inactive
7. Attempt to trigger challenge - should fail

**Pass Criteria:**
```javascript
// Before enable
expect(initialState.phase).toBeUndefined(); // or null

// After enable
expect(enabledState.phase).toBe('warmup');

// After disable
expect(disabledState.phase).toBeUndefined();

// Trigger should fail when disabled
const failedTrigger = await sim.triggerChallenge({ targetZone: 'hot' });
expect(failedTrigger.ok).toBe(false);
expect(failedTrigger.error).toContain('governance');
```

---

### Test 10: Rapid Challenge Succession

**Setup:**
- Enable governance
- Activate 2 devices in 'active' zone

**Actions:**
1. Trigger challenge 1, complete immediately with `completeChallenge(true)`
2. Immediately trigger challenge 2, complete with `completeChallenge(true)`
3. Immediately trigger challenge 3, complete with `completeChallenge(false)`

**Pass Criteria:**
```javascript
// No lingering state between challenges
expect(stateAfter1.activeChallenge).toBeNull();
expect(stateAfter2.activeChallenge).toBeNull();
expect(stateAfter3.activeChallenge).toBeNull();

// Stats accumulate correctly
expect(stateAfter3.stats.challengesWon).toBe(2);
expect(stateAfter3.stats.challengesFailed).toBe(1);

// Total challenges = 3
const total = stateAfter3.stats.challengesWon + stateAfter3.stats.challengesFailed;
expect(total).toBe(3);
```

---

### Test 11: Already In Target Zone When Challenge Starts

**Setup:**
- Enable governance
- Activate 2 devices already in 'hot' zone

**Actions:**
1. Trigger challenge: `{ targetZone: 'hot' }`
2. Check progress immediately

**Pass Criteria:**
```javascript
// Both should immediately show as reached
expect(activeChal.participantProgress[device1.deviceId]).toBe(true);
expect(activeChal.participantProgress[device2.deviceId]).toBe(true);

// Can complete immediately
await sim.completeChallenge(true);
expect((await sim.getGovernanceState()).stats.challengesWon).toBe(1);
```

---

## Exit Criteria Summary

| Test | Description | Key Assertion |
|------|-------------|---------------|
| 1 | Challenge win | `stats.challengesWon === 1` |
| 2 | Challenge fail (timeout) | `stats.challengesFailed === 1` |
| 3 | Multi-hurdle sequence | `challengesWon === 3, challengesFailed === 1` |
| 4 | Partial completion | `reachedTarget === 2, total === 3` |
| 5 | Dropout mid-challenge | `activeDevices.length === 1` after dropout |
| 6 | Zone overshoot | Fire counts as reaching Hot |
| 7 | Zone oscillation | Once reached = permanently reached |
| 8 | Phase transitions | Phase changes warmup → main |
| 9 | Governance on/off | Trigger fails when disabled |
| 10 | Rapid succession | 3 challenges, stats sum to 3 |
| 11 | Pre-positioned | Immediate progress when at target |

**All 11 tests must pass. No exceptions.**
