# HR Simulation Control Panel - Design Document

**Date:** 2026-02-03
**Status:** Draft - Pending Review

## Overview

A manual testing tool for real-time fitness session features. Provides a popup control panel to simulate HR device behavior (zone changes, dropouts, challenges) with a shared programmatic interface for both manual testing and automated Playwright tests.

## Goals

1. **Manual testing** - Visually control participant HR zones in real-time
2. **Session lifecycle testing** - Test join/leave/dropout flows
3. **Governance testing** - Trigger challenges on demand
4. **Test automation** - Expose same interface for Playwright tests
5. **Code quality** - Centralize scattered ANT+ message format

## Non-Goals

- Cadence/RPM/Power simulation (HR only for v1)
- Production usage (localhost only)
- Replacing existing CLI simulation script (refactor to share code)

---

## Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  Consumers                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ HRSimPanel   │  │ Playwright   │  │ simulation   │      │
│  │ (popup)      │  │ Tests        │  │ .mjs (CLI)   │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                 │                 │               │
│         ▼                 ▼                 ▼               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  SimulationProtocol (shared message format)         │   │
│  └─────────────────────────────────────────────────────┘   │
│         │                 │                                 │
│         ▼                 ▼                                 │
│  ┌─────────────────────────────────┐                       │
│  │  FitnessSimulationController    │                       │
│  │  (browser-side orchestration)   │                       │
│  └──────────────┬──────────────────┘                       │
│                 │                                           │
│                 ▼                                           │
│  ┌─────────────────────────────────┐                       │
│  │  WebSocket → FitnessContext     │                       │
│  │  (normal data pipeline)         │                       │
│  └─────────────────────────────────┘                       │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. User clicks zone button in popup (or test calls controller method)
2. Controller builds ANT+ message via `SimulationProtocol`
3. Message sent over WebSocket (same path as real devices)
4. `FitnessContext.ingestData()` processes message normally
5. UI updates via normal reactive flow

---

## Implementation Plan

### Phase 1: Shared Protocol Layer

Create centralized message format used by all simulation sources.

#### Task 1.1: Create SimulationProtocol.js

**File:** `frontend/src/lib/fitness/SimulationProtocol.js`

```javascript
export const SimulationProtocol = {
  // Build ANT+ HR message matching DeviceManager expectations
  buildHRMessage(deviceId, heartRate, beatCount = 0) { ... },

  // Zone-to-HR midpoint mapping
  zoneToHR: { cool: 80, active: 110, warm: 130, hot: 150, fire: 170 },

  // HR-to-zone reverse mapping
  hrToZone(hr) { ... },

  // Auto-mode waveform generator (4-phase cycle)
  getAutoHR(elapsedSeconds, phaseOffset = 0) { ... }
};
```

**Acceptance Criteria:**
- [ ] Pure functions, no browser/Node dependencies
- [ ] Works in both browser and Node.js environments
- [ ] Message format matches existing `simulation.mjs` output
- [ ] Auto-mode replicates existing waveform algorithm

---

### Phase 2: Controller Implementation

Create the core controller class that orchestrates simulation.

#### Task 2.1: Create FitnessSimulationController.js

**File:** `frontend/src/lib/fitness/FitnessSimulationController.js`

```javascript
export class FitnessSimulationController {
  constructor(wsService, session) { ... }

  // Participant control
  setParticipantZone(deviceId, zone) { ... }
  setParticipantHR(deviceId, bpm) { ... }
  triggerDropout(deviceId) { ... }
  startAuto(deviceId, phaseOffset) { ... }
  stopAuto(deviceId) { ... }

  // Governance
  triggerChallenge() { ... }

  // State queries
  getParticipants() { ... }
  getConfiguredDevices() { ... }
  getGovernanceState() { ... }

  // Cleanup
  destroy() { ... }
}
```

**Acceptance Criteria:**
- [ ] All methods return `{ success, ...data }` for consistency
- [ ] Auto-mode intervals properly tracked and cleaned up
- [ ] Dropout stops auto-mode for that device
- [ ] Beat counts accumulate correctly per device

#### Task 2.2: Expose Controller in FitnessContext

**File:** `frontend/src/context/FitnessContext.jsx`

Add effect to expose controller on localhost:

```javascript
useEffect(() => {
  const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  if (isLocalhost && session && wsService) {
    const controller = new FitnessSimulationController(wsService, session);
    window.__fitnessSimController = controller;
    return () => {
      controller.destroy();
      delete window.__fitnessSimController;
    };
  }
}, [session, wsService]);
```

**Acceptance Criteria:**
- [ ] Controller only exposed when hostname is localhost/127.0.0.1
- [ ] Controller destroyed on unmount
- [ ] No console errors in production (controller simply not created)

---

### Phase 3: Popup UI

Create the visual control panel.

#### Task 3.1: Create HRSimTrigger Button

**File:** `frontend/src/modules/Fitness/SimPanel/HRSimTrigger.jsx`

Small gray gear button, localhost-only, opens popup window.

**Acceptance Criteria:**
- [ ] Only renders on localhost
- [ ] Opens popup via `window.open()` with specific dimensions
- [ ] Styled as small gray button (unobtrusive)
- [ ] Positioned in corner of FitnessPlayer

#### Task 3.2: Create Popup Entry Point

**File:** `frontend/public/sim-panel.html`

Standalone HTML that mounts HRSimPanel React component.

**Acceptance Criteria:**
- [ ] Loads React and renders HRSimPanel
- [ ] Connects to opener window's controller
- [ ] Graceful error if opener not available

#### Task 3.3: Create HRSimPanel Component

**File:** `frontend/src/modules/Fitness/SimPanel/HRSimPanel.jsx`

Main popup UI with:
- Governance section (phase display, trigger challenge button)
- Participant list (from configured devices)
- Per-participant zone buttons: off, cool, active, warm, hot, fire, auto
- Real-time HR display synced from main window

**Acceptance Criteria:**
- [ ] Polls main window controller every 500ms for state
- [ ] Zone buttons styled in colored row (like VolumeControl)
- [ ] Active zone highlighted
- [ ] Auto button shows cycling indicator when active
- [ ] Inactive participants grayed out with "-- bpm"
- [ ] "Add All" / "Clear All" convenience buttons

#### Task 3.4: Create HRSimPanel Styles

**File:** `frontend/src/modules/Fitness/SimPanel/HRSimPanel.scss`

**Acceptance Criteria:**
- [ ] Compact layout for 420x650 popup
- [ ] Zone buttons in tight row with color coding
- [ ] Clear visual distinction for active vs inactive participants
- [ ] Scrollable participant list if many devices

#### Task 3.5: Add Trigger to FitnessPlayer

**File:** `frontend/src/modules/Fitness/FitnessPlayer.jsx`

Import and render `<HRSimTrigger />` in player UI.

**Acceptance Criteria:**
- [ ] Button positioned unobtrusively (bottom-left corner suggested)
- [ ] Does not interfere with player controls
- [ ] Only visible on localhost

---

### Phase 4: Test Integration

Create helper utilities for Playwright tests.

#### Task 4.1: Create fitnessSimHelper.mjs

**File:** `tests/_lib/fitnessSimHelper.mjs`

```javascript
export class FitnessSimHelper {
  constructor(page) { ... }

  async waitForController(timeout = 10000) { ... }
  async setParticipantZone(deviceId, zone) { ... }
  async setParticipantHR(deviceId, bpm) { ... }
  async triggerDropout(deviceId) { ... }
  async startAuto(deviceId, phaseOffset) { ... }
  async stopAuto(deviceId) { ... }
  async triggerChallenge() { ... }
  async getParticipants() { ... }
  async getConfiguredDevices() { ... }
  async getGovernanceState() { ... }

  // Convenience methods
  async waitForZone(deviceId, targetZone, timeout) { ... }
  async addAllParticipants(zone = 'active') { ... }
}
```

**Acceptance Criteria:**
- [ ] All methods use `page.evaluate()` to call controller
- [ ] `waitForController()` has configurable timeout
- [ ] Convenience methods simplify common test patterns

#### Task 4.2: Update Existing Simulation Tests

**File:** `tests/isolated/domain/fitness/legacy/fitness-simulate-api.unit.test.mjs`

- Remove `.skip()` from tests
- Update to use new `FitnessSimHelper` where applicable
- Add new tests for controller methods

**Acceptance Criteria:**
- [ ] Existing tests unskipped and passing
- [ ] New tests cover zone transitions, dropouts, challenges

---

### Phase 5: Refactor CLI Simulation

Update existing script to use shared protocol.

#### Task 5.1: Refactor simulation.mjs

**File:** `_extensions/fitness/simulation.mjs`

- Import `SimulationProtocol` from frontend
- Replace inline message construction with protocol calls
- Replace waveform generation with `SimulationProtocol.getAutoHR()`

**Acceptance Criteria:**
- [ ] CLI simulation still works: `node _extensions/fitness/simulation.mjs`
- [ ] Output messages match previous format exactly
- [ ] Waveform behavior unchanged
- [ ] No duplicate code between CLI and controller

---

## File Summary

### New Files (7)

| File | Lines (est) |
|------|-------------|
| `frontend/src/lib/fitness/SimulationProtocol.js` | ~80 |
| `frontend/src/lib/fitness/FitnessSimulationController.js` | ~120 |
| `frontend/src/modules/Fitness/SimPanel/HRSimTrigger.jsx` | ~30 |
| `frontend/src/modules/Fitness/SimPanel/HRSimPanel.jsx` | ~150 |
| `frontend/src/modules/Fitness/SimPanel/HRSimPanel.scss` | ~100 |
| `frontend/public/sim-panel.html` | ~30 |
| `tests/_lib/fitnessSimHelper.mjs` | ~80 |

### Modified Files (4)

| File | Changes |
|------|---------|
| `frontend/src/context/FitnessContext.jsx` | +15 lines (controller exposure) |
| `frontend/src/modules/Fitness/FitnessPlayer.jsx` | +5 lines (trigger import/render) |
| `_extensions/fitness/simulation.mjs` | Refactor ~50 lines |
| `tests/.../fitness-simulate-api.unit.test.mjs` | Unskip + updates |

---

## Testing Strategy

### Manual Testing Checklist

- [ ] Open FitnessPlayer on localhost, verify gear button visible
- [ ] Click gear, verify popup opens at correct size
- [ ] Verify configured devices appear in popup
- [ ] Click zone buttons, verify HR changes in main window
- [ ] Click "off", verify dropout flow triggers
- [ ] Click "auto", verify HR cycles through zones
- [ ] Click "Trigger Challenge", verify challenge UI appears
- [ ] Close popup, verify no console errors
- [ ] Visit on non-localhost, verify gear button hidden

### Automated Tests

```javascript
// Example test structure
test('zone transitions update UI', async ({ page }) => {
  const sim = new FitnessSimHelper(page);
  await sim.waitForController();

  const devices = await sim.getConfiguredDevices();
  await sim.setParticipantZone(devices[0].deviceId, 'hot');

  await expect(page.locator('.participant-card').first())
    .toHaveAttribute('data-zone', 'hot');
});
```

---

## Security Considerations

1. **Localhost-only** - All simulation code gated by hostname check
2. **No production bundle bloat** - Popup HTML is separate entry point
3. **Same data path** - Simulated data flows through normal pipeline (no backdoors)
4. **No secrets exposed** - Controller only reads public session state

---

## Open Questions

1. **Popup bundling** - Should `sim-panel.html` use Vite's multi-page setup or be fully standalone?
   - *Recommendation:* Vite multi-page for HMR during development

2. **WebSocket reconnection** - If main window reconnects WS, does popup need to handle?
   - *Recommendation:* Popup polls controller; if controller missing, show "Reconnecting..." state

3. **Multiple popups** - Should we prevent opening multiple panels?
   - *Recommendation:* Use window name to reuse existing popup

---

## Appendix: Zone Configuration

Default zones from `types.js`:

| Zone | Min HR | Midpoint (simulated) | Color |
|------|--------|----------------------|-------|
| cool | 60 | 80 | blue |
| active | 100 | 110 | green |
| warm | 120 | 130 | yellow |
| hot | 140 | 150 | orange |
| fire | 160 | 170 | red |

Auto-mode waveform phases (45s each, 3min cycle):
1. **Warm-up:** 95 → 125 bpm
2. **Build:** 125 → 155 bpm
3. **Peak:** 160 ± 20 bpm (sine wave)
4. **Cooldown:** 150 → 110 bpm

---

## Senior Architect Review - REVISION REQUIRED

**Reviewer:** Distinguished Architect
**Date:** 2026-02-03
**Verdict:** NOT READY FOR IMPLEMENTATION

This document demonstrates surface-level familiarity with the codebase but fails basic due diligence. Before this plan can proceed, the following issues must be addressed.

---

### CRITICAL ERRORS (Blocking)

#### 1. File Path Does Not Exist

**Line 75, 107:** You propose creating files at `frontend/src/lib/fitness/SimulationProtocol.js` and `frontend/src/lib/fitness/FitnessSimulationController.js`.

**Problem:** The directory `frontend/src/lib/fitness/` does not exist. There is no `fitness/` subfolder in `frontend/src/lib/`. Did you actually run `ls frontend/src/lib/` before writing this?

**Actual lib structure:**
```
frontend/src/lib/
├── api.mjs
├── logging/
├── Player/
└── OfficeApp/
```

**Fix:** Propose a location that exists, or explicitly state you're creating a new directory and justify why.

---

#### 2. wsService Is NOT In FitnessContext

**Lines 146-157:** Your example code assumes `wsService` is available as a dependency:

```javascript
if (isLocalhost && session && wsService) {
```

**Problem:** `wsService` is NOT exposed by FitnessContext. It is a module-level singleton imported separately:

```javascript
import { wsService } from '../services/WebSocketService';
```

If you had read `FitnessContext.jsx` (all 2000+ lines of it), you would have seen this pattern at line 1033-1091 where the existing WebSocket subscription is set up.

**Fix:** Correct the code example to use dynamic import or direct import.

---

#### 3. types.js Path Is Wrong

**Appendix, line 383:** "Default zones from `types.js`"

**Problem:** You don't specify the path. The actual location is:
```
frontend/src/hooks/fitness/types.js
```

NOT `frontend/src/lib/fitness/types.js` (which you seem to think exists based on your proposed file locations).

**Fix:** Provide the actual file path. Verify files exist before referencing them.

---

#### 4. Test File Does NOT Test What You Claim

**Lines 270-279:** You reference updating `tests/isolated/domain/fitness/legacy/fitness-simulate-api.unit.test.mjs` to "use new FitnessSimHelper."

**Problem:** That test file tests the **CLI simulation HTTP API** (`POST /api/fitness/simulate`). It has nothing to do with browser-side controllers. It tests a completely different interface:

```javascript
// What the file actually tests:
await fetch(`${BACKEND_URL}/api/fitness/simulate`, {
  method: 'POST',
  body: JSON.stringify({ duration: 10, users: 1, rpm: 0 })
});
```

This is not the same as `FitnessSimHelper.setParticipantZone()`. You cannot "update" these tests to use your new controller—they test different systems.

**Additionally:** That file hardcodes `http://localhost:3112`, violating the project standard (see CLAUDE.md: "Test URLs come from system config - NOT hardcoded").

**Fix:** Remove the claim about updating this file. Create a NEW test file for controller tests.

---

#### 5. Cross-Environment Import Is Not Trivial

**Lines 290-292, Phase 5:**
> Import `SimulationProtocol` from frontend

**Problem:** `_extensions/fitness/simulation.mjs` is a **Node.js CLI script**. `frontend/src/lib/...` is browser code bundled by Vite. You cannot simply `import` browser code into Node.js without:

1. Ensuring the module uses only universal JavaScript (no DOM, no browser globals)
2. Setting up proper ESM resolution paths
3. Potentially using a build step or symlinks

You've listed "Works in both browser and Node.js environments" as an acceptance criterion but provided zero implementation guidance.

**Fix:** Specify exactly HOW this cross-environment sharing will work. Options:
- Place SimulationProtocol in a shared location (e.g., `common/` or `lib/`)
- Use package.json exports field
- Duplicate with a comment explaining why

---

#### 6. Vite Multi-Page Configuration Does Not Exist

**Lines 370-371, Open Question 1:**
> *Recommendation:* Vite multi-page for HMR during development

**Problem:** The current `vite.config.js` is a standard SPA configuration. There is no multi-page setup. Adding one requires modifying `build.rollupOptions.input` and potentially breaking the existing build.

If you had inspected `vite.config.js`, you would know this. Your "recommendation" assumes infrastructure that doesn't exist.

**Fix:** Either:
- Document the vite.config.js changes required, OR
- Use the `window.opener` pattern (standalone HTML accessing parent window's controller) which requires no Vite changes

---

### DATA ACCURACY ERRORS

#### 7. Zone "Midpoint" Values Are Fabricated

**Appendix table:**

| Zone | Min HR | Midpoint (simulated) |
|------|--------|----------------------|
| cool | 60 | 80 |

**Problem:** Where does "80" come from? The types.js `DEFAULT_ZONE_CONFIG` only defines `min` values, not max values:

```javascript
{ id: 'cool', name: 'Cool', min: 60, color: 'blue' },
{ id: 'active', name: 'Active', min: 100, color: 'green' },
```

To calculate a midpoint, you need both min and max. The "max" for cool would be 99 (one below active's min of 100), making the midpoint ~80. But you don't show this derivation, and the actual config in `config.yml` has DIFFERENT values:

```yaml
# From test fixtures config.yml:
cool:
  min: 0
  max: 100
active:
  min: 100
  max: 130
```

Which source of truth are you using? The runtime config? The types.js defaults? The test fixtures? Your document doesn't say.

**Fix:**
1. Show the derivation formula: `midpoint = (min + nextZoneMin) / 2` or `(min + max) / 2`
2. State which config source is authoritative
3. Make SimulationProtocol compute midpoints dynamically from zoneConfig, not hardcode magic numbers

---

#### 8. ANT+ Message Format Is Incomplete

**Lines 77-80:**
```javascript
buildHRMessage(deviceId, heartRate, beatCount = 0) { ... }
```

**Problem:** The actual ANT+ HR message in `simulation.mjs` has 15+ fields:

```javascript
{
  topic: 'fitness',
  source: 'fitness-simulator',
  type: 'ant',
  timestamp: new Date().toISOString(),
  profile: 'HR',
  deviceId,
  dongleIndex: 0,
  data: {
    ManId: 255,
    SerialNumber: Number(deviceId),
    HwVersion: 5,
    SwVersion: 1,
    ModelNum: 2,
    BatteryLevel: 100,
    BatteryVoltage: 4.15625,
    BatteryStatus: "Good",
    DeviceID: device.deviceId,
    Channel: 0,
    BeatTime: (seconds * 1024) % 65536,  // ANT+ timing format!
    BeatCount: accumulatedBeatCount,
    ComputedHeartRate: heartRate,
    PreviousBeat: beatTime - 1024,
    OperatingTime: elapsedSeconds * 1000
  }
}
```

Your 3-parameter function signature cannot produce this. Where do `SerialNumber`, `BeatTime`, `BatteryLevel`, etc. come from?

**Fix:** Show the complete message structure in the design. Document which fields are required vs optional.

---

### DESIGN WEAKNESSES

#### 9. 500ms Polling Is Wasteful

**Line 204:**
> Polls main window controller every 500ms for state

**Problem:** Polling is the wrong pattern for cross-window communication. The popup and main window share the same JavaScript origin—use `window.postMessage()` or a shared observable/event bus.

500ms polling means:
- Delayed UI updates (up to 500ms lag)
- Unnecessary CPU cycles
- 120 function calls per minute doing nothing useful

**Fix:** Use event-driven updates:
```javascript
// Main window: broadcast state changes
window.dispatchEvent(new CustomEvent('sim-state-change', { detail: state }));

// Popup: listen
window.opener.addEventListener('sim-state-change', (e) => setState(e.detail));
```

---

#### 10. No Session Lifecycle Handling

**Problem:** What happens when:
- The main window's session is destroyed and recreated?
- The user navigates away from FitnessPlayer and back?
- WebSocket disconnects and reconnects?

Your controller holds a reference to `session` in its constructor. If that session object becomes stale, all methods will fail silently or throw.

**Fix:** Either:
- Document that controller must be recreated on session change, OR
- Pass a session getter function instead of the session object, OR
- Subscribe to session lifecycle events

---

#### 11. Beat Count Accumulation Is Underspecified

**Line 137:**
> Beat counts accumulate correctly per device

**Problem:** Who owns beat count state? Your `buildHRMessage(deviceId, heartRate, beatCount = 0)` takes beatCount as a parameter, implying the caller tracks it. But:

- Does SimulationProtocol track per-device beat counts?
- Does FitnessSimulationController track them?
- What's the initial value for a new device?
- How do you handle beat count wrap-around at 255?

The existing `simulation.mjs` tracks this in a device state object. Your design doesn't show equivalent state management.

**Fix:** Explicitly state where beat count state lives and how it's managed.

---

### MISSING INFORMATION

#### 12. How Does Controller Access Zone Config?

**Problem:** Your controller needs zone thresholds for `setParticipantZone()`. Where does it get them?

- FitnessContext exposes `zoneConfig` but your controller only receives `wsService` and `session`
- Session doesn't directly expose zone config
- Are you expecting the controller to hardcode zones (violating DRY)?

**Fix:** Either pass zoneConfig to constructor, or document how to retrieve it from session/context.

---

#### 13. No Error Handling Strategy

**Problem:** What happens when:
- `wsService.send()` fails?
- An invalid zone name is passed to `setParticipantZone()`?
- The device ID doesn't exist?

Your acceptance criteria say "All methods return `{ success, ...data }`" but you don't specify error cases or error messages.

**Fix:** Document error responses for each method.

---

### SUMMARY

| Category | Issues |
|----------|--------|
| **Critical (blocking)** | 6 |
| **Data accuracy** | 2 |
| **Design weakness** | 3 |
| **Missing info** | 2 |

**Before resubmitting:**

1. Actually READ the files you're modifying (`FitnessContext.jsx`, `types.js`, `simulation.mjs`)
2. Run `ls` and `grep` to verify paths exist
3. Show your work on derived values (zone midpoints)
4. Specify cross-environment module sharing strategy
5. Replace polling with event-driven communication
6. Document error handling

This is a testing tool, not a production feature, but that's no excuse for sloppy design work. The implementation will inevitably diverge from this document, creating confusion for future maintainers.

Revise and resubmit.
