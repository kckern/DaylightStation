# Wake Guardrails & Progressive Feedback Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent silent TV wake failures by gating the call flow on verified display power, and give the phone UI real-time step-by-step feedback during the wake sequence.

**Architecture:** New `DisplayReadinessPolicy` in the domain layer owns the "is display ready?" business rule. A new `WakeAndLoadService` in the application layer replaces inline router orchestration, emitting WebSocket progress events at each step. The phone UI consumes these events to show a live step tracker instead of a static "Waking up TV..." message.

**Tech Stack:** Node.js backend (ES modules), React frontend (hooks), WebSocket event bus (existing), Home Assistant sensor polling (existing)

---

## Task 1: Domain Port — `IDisplayPowerCheck`

**Files:**
- Create: `backend/src/2_domains/home-automation/IDisplayPowerCheck.mjs`
- Modify: `backend/src/2_domains/home-automation/index.mjs`

**Step 1: Create the port interface**

```js
// backend/src/2_domains/home-automation/IDisplayPowerCheck.mjs

/**
 * IDisplayPowerCheck Port — query whether a device's display is on.
 *
 * Adapters (Home Assistant sensor, ADB dumpsys, etc.) implement this.
 * The domain policy consumes it to decide "ready for content?".
 *
 * @module domains/home-automation
 */

/**
 * @typedef {Object} DisplayPowerResult
 * @property {boolean} on - Whether the display is confirmed on
 * @property {string} state - Raw state value from the source ('on', 'off', 'unknown', 'unavailable')
 * @property {string} source - What provided this answer ('ha_sensor', 'adb', 'none')
 */

/**
 * Check if object implements IDisplayPowerCheck
 * @param {any} obj
 * @returns {boolean}
 */
export function isDisplayPowerCheck(obj) {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    typeof obj.isDisplayOn === 'function'
  );
}

/**
 * Create a no-op display power check (no sensor configured)
 * @returns {Object}
 */
export function createNoOpDisplayPowerCheck() {
  return {
    isDisplayOn: async () => ({ on: false, state: 'unknown', source: 'none' })
  };
}

export default { isDisplayPowerCheck, createNoOpDisplayPowerCheck };
```

**Step 2: Update domain index**

Replace the contents of `backend/src/2_domains/home-automation/index.mjs` with:

```js
/**
 * Home Automation Domain
 * @module home-automation
 *
 * Provider-agnostic home automation abstractions.
 */

export { isDisplayPowerCheck, createNoOpDisplayPowerCheck } from './IDisplayPowerCheck.mjs';
export { DisplayReadinessPolicy } from './DisplayReadinessPolicy.mjs';
```

(The `DisplayReadinessPolicy` export will resolve in Task 2.)

**Step 3: Commit**

```bash
git add backend/src/2_domains/home-automation/IDisplayPowerCheck.mjs backend/src/2_domains/home-automation/index.mjs
git commit -m "feat(domain): add IDisplayPowerCheck port for display power verification"
```

---

## Task 2: Domain Policy — `DisplayReadinessPolicy`

**Files:**
- Create: `backend/src/2_domains/home-automation/DisplayReadinessPolicy.mjs`

**Step 1: Create the policy**

```js
// backend/src/2_domains/home-automation/DisplayReadinessPolicy.mjs

/**
 * DisplayReadinessPolicy — domain logic for "is a display ready for content?"
 *
 * Consumes IDisplayPowerCheck port. Encapsulates the business rule so it lives
 * in the domain layer, not scattered across adapters and routers.
 *
 * @module domains/home-automation
 */

export class DisplayReadinessPolicy {
  #powerCheck;
  #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.powerCheck - IDisplayPowerCheck implementation
   * @param {Object} [deps.logger]
   */
  constructor(deps) {
    this.#powerCheck = deps.powerCheck;
    this.#logger = deps.logger || console;
  }

  /**
   * Is the display ready to receive content?
   *
   * @param {string} deviceId - Device identifier (for logging)
   * @returns {Promise<{ready: boolean, reason?: string, detail: Object}>}
   */
  async isReady(deviceId) {
    const result = await this.#powerCheck.isDisplayOn(deviceId);

    this.#logger.debug?.('display-readiness.check', { deviceId, ...result });

    if (result.source === 'none') {
      // No sensor configured — cannot verify, treat as unknown
      return {
        ready: false,
        reason: 'no_sensor',
        detail: result
      };
    }

    if (result.on) {
      return { ready: true, detail: result };
    }

    return {
      ready: false,
      reason: 'display_off',
      detail: result
    };
  }
}
```

**Step 2: Commit**

```bash
git add backend/src/2_domains/home-automation/DisplayReadinessPolicy.mjs
git commit -m "feat(domain): add DisplayReadinessPolicy for gating content loading on display state"
```

---

## Task 3: Adapter — HA Sensor Display Power Check

**Files:**
- Create: `backend/src/1_adapters/home-automation/HaSensorDisplayPowerCheck.mjs`

This adapter implements `IDisplayPowerCheck` using the existing HA gateway's `getState()` method.

**Step 1: Create the adapter**

```js
// backend/src/1_adapters/home-automation/HaSensorDisplayPowerCheck.mjs

/**
 * HaSensorDisplayPowerCheck — checks display power via HA state sensor.
 *
 * Implements IDisplayPowerCheck port using the Home Assistant gateway.
 * Reads the binary_sensor/input_boolean configured as state_sensor for
 * the device's display.
 *
 * @module adapters/home-automation
 */

export class HaSensorDisplayPowerCheck {
  #gateway;
  #sensorMap; // deviceId -> sensorEntityId
  #logger;

  /**
   * @param {Object} config
   * @param {Object.<string, string>} config.sensorMap - Map of deviceId to HA sensor entity
   * @param {Object} deps
   * @param {Object} deps.gateway - Home Assistant gateway (getState method)
   * @param {Object} [deps.logger]
   */
  constructor(config, deps) {
    this.#gateway = deps.gateway;
    this.#sensorMap = config.sensorMap || {};
    this.#logger = deps.logger || console;
  }

  /**
   * Check if the device's display is on.
   * @param {string} deviceId
   * @returns {Promise<import('../../2_domains/home-automation/IDisplayPowerCheck.mjs').DisplayPowerResult>}
   */
  async isDisplayOn(deviceId) {
    const sensor = this.#sensorMap[deviceId];

    if (!sensor) {
      this.#logger.debug?.('ha-sensor-power-check.no-sensor', { deviceId });
      return { on: false, state: 'unknown', source: 'none' };
    }

    try {
      const result = await this.#gateway.getState(sensor);
      const state = result?.state || 'unknown';
      const isOn = state === 'on';

      this.#logger.debug?.('ha-sensor-power-check.result', {
        deviceId, sensor, state, isOn
      });

      return { on: isOn, state, source: 'ha_sensor' };
    } catch (err) {
      this.#logger.warn?.('ha-sensor-power-check.error', {
        deviceId, sensor, error: err.message
      });
      return { on: false, state: 'error', source: 'ha_sensor' };
    }
  }
}
```

**Step 2: Commit**

```bash
git add backend/src/1_adapters/home-automation/HaSensorDisplayPowerCheck.mjs
git commit -m "feat(adapter): add HaSensorDisplayPowerCheck implementing IDisplayPowerCheck via HA sensor"
```

---

## Task 4: Fix `HomeAssistantDeviceAdapter.powerOn()` — honest `ok` field

**Files:**
- Modify: `backend/src/1_adapters/devices/HomeAssistantDeviceAdapter.mjs:260-273`

This is the critical bug fix. When all verification attempts fail, `ok` must be `false`.

**Step 1: Fix the return value**

In `backend/src/1_adapters/devices/HomeAssistantDeviceAdapter.mjs`, find lines 264-273 (the "All attempts exhausted" return):

Replace:
```js
    return {
      ok: true,
      displayId,
      action: 'on',
      verified: false,
      verifyFailed: true,
      attempts: maxAttempts,
      elapsedMs: Date.now() - startTime
    };
```

With:
```js
    return {
      ok: false,
      displayId,
      action: 'on',
      verified: false,
      verifyFailed: true,
      attempts: maxAttempts,
      elapsedMs: Date.now() - startTime,
      error: 'Display did not respond after power-on verification'
    };
```

**Step 2: Commit**

```bash
git add backend/src/1_adapters/devices/HomeAssistantDeviceAdapter.mjs
git commit -m "fix(adapter): powerOn returns ok:false when display verification fails"
```

---

## Task 5: Application Service — `WakeAndLoadService`

**Files:**
- Create: `backend/src/3_applications/devices/services/WakeAndLoadService.mjs`
- Modify: `backend/src/3_applications/devices/services/index.mjs`

**Step 1: Create the service**

```js
// backend/src/3_applications/devices/services/WakeAndLoadService.mjs

/**
 * WakeAndLoadService — orchestrates the full device wake + content load workflow.
 *
 * Replaces inline orchestration from the device router. Emits WebSocket progress
 * events at each step so the phone UI can show real-time feedback.
 *
 * Steps: power_on → verify_display → prepare_content → load_content
 *
 * @module applications/devices/services
 */

const STEPS = ['power', 'verify', 'prepare', 'load'];

export class WakeAndLoadService {
  #deviceService;
  #readinessPolicy;
  #broadcast;
  #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.deviceService - DeviceService for device lookup
   * @param {Object} deps.readinessPolicy - DisplayReadinessPolicy instance
   * @param {Function} deps.broadcast - broadcastEvent(payload) function
   * @param {Object} [deps.logger]
   */
  constructor(deps) {
    this.#deviceService = deps.deviceService;
    this.#readinessPolicy = deps.readinessPolicy;
    this.#broadcast = deps.broadcast;
    this.#logger = deps.logger || console;
  }

  /**
   * Execute the full wake-and-load workflow.
   *
   * @param {string} deviceId - Target device
   * @param {Object} query - Query params for content loading (e.g., { open: 'videocall/id' })
   * @returns {Promise<Object>} - Result with per-step outcomes
   */
  async execute(deviceId, query = {}) {
    const startTime = Date.now();
    const topic = `homeline:${deviceId}`;
    const device = this.#deviceService.get(deviceId);

    if (!device) {
      return { ok: false, error: 'Device not found', deviceId };
    }

    const result = {
      ok: false,
      deviceId,
      steps: {},
      canProceed: false,
      allowOverride: false
    };

    // --- Step 1: Power On ---
    this.#emitProgress(topic, 'power', 'running');
    this.#logger.info?.('wake-and-load.power.start', { deviceId });

    const powerResult = await device.powerOn();
    result.steps.power = powerResult;

    if (!powerResult.ok) {
      this.#emitProgress(topic, 'power', 'failed', { error: powerResult.error });
      this.#logger.error?.('wake-and-load.power.failed', { deviceId, error: powerResult.error });
      result.error = powerResult.error;
      result.failedStep = 'power';
      result.totalElapsedMs = Date.now() - startTime;
      return result;
    }

    this.#emitProgress(topic, 'power', 'done', { verified: powerResult.verified });
    this.#logger.info?.('wake-and-load.power.done', {
      deviceId, verified: powerResult.verified, elapsedMs: powerResult.elapsedMs
    });

    // --- Step 2: Verify Display ---
    this.#emitProgress(topic, 'verify', 'running');
    this.#logger.info?.('wake-and-load.verify.start', { deviceId });

    const readiness = await this.#readinessPolicy.isReady(deviceId);
    result.steps.verify = readiness;

    if (!readiness.ready) {
      this.#emitProgress(topic, 'verify', 'failed', { reason: readiness.reason });
      this.#logger.warn?.('wake-and-load.verify.failed', { deviceId, reason: readiness.reason });
      result.failedStep = 'verify';
      result.error = readiness.reason === 'no_sensor'
        ? 'No display sensor configured — cannot verify'
        : 'Display did not turn on';
      result.allowOverride = true; // Phone can choose "Connect anyway"
      result.totalElapsedMs = Date.now() - startTime;
      return result;
    }

    this.#emitProgress(topic, 'verify', 'done');
    this.#logger.info?.('wake-and-load.verify.done', { deviceId });

    // --- Step 3: Prepare Content ---
    this.#emitProgress(topic, 'prepare', 'running');
    this.#logger.info?.('wake-and-load.prepare.start', { deviceId });

    const prepResult = await device.prepareForContent();
    result.steps.prepare = prepResult;

    if (!prepResult.ok) {
      this.#emitProgress(topic, 'prepare', 'failed', { error: prepResult.error });
      this.#logger.error?.('wake-and-load.prepare.failed', { deviceId, error: prepResult.error });
      result.error = prepResult.error;
      result.failedStep = 'prepare';
      result.totalElapsedMs = Date.now() - startTime;
      return result;
    }

    this.#emitProgress(topic, 'prepare', 'done');
    this.#logger.info?.('wake-and-load.prepare.done', { deviceId });

    // --- Step 4: Load Content ---
    this.#emitProgress(topic, 'load', 'running');
    this.#logger.info?.('wake-and-load.load.start', { deviceId, query });

    const loadResult = await device.loadContent('/tv', query);
    result.steps.load = loadResult;

    if (!loadResult.ok) {
      this.#emitProgress(topic, 'load', 'failed', { error: loadResult.error });
      this.#logger.error?.('wake-and-load.load.failed', { deviceId, error: loadResult.error });
      result.error = loadResult.error;
      result.failedStep = 'load';
      result.totalElapsedMs = Date.now() - startTime;
      return result;
    }

    this.#emitProgress(topic, 'load', 'done');

    // --- All steps passed ---
    result.ok = true;
    result.canProceed = true;
    result.totalElapsedMs = Date.now() - startTime;

    this.#logger.info?.('wake-and-load.complete', {
      deviceId, totalElapsedMs: result.totalElapsedMs
    });

    return result;
  }

  /**
   * Emit a progress event over WebSocket.
   * @private
   */
  #emitProgress(topic, step, status, extra = {}) {
    this.#broadcast({
      topic,
      type: 'wake-progress',
      step,
      status,
      steps: STEPS,
      ...extra
    });
  }
}

export default WakeAndLoadService;
```

**Step 2: Update services index**

In `backend/src/3_applications/devices/services/index.mjs`, add the export:

```js
export { WakeAndLoadService } from './WakeAndLoadService.mjs';
```

(Append this line to the existing exports in the file.)

**Step 3: Commit**

```bash
git add backend/src/3_applications/devices/services/WakeAndLoadService.mjs backend/src/3_applications/devices/services/index.mjs
git commit -m "feat(app): add WakeAndLoadService with gated workflow and WS progress events"
```

---

## Task 6: Bootstrap Wiring

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs` — add `createWakeAndLoadService` factory function
- Modify: `backend/src/app.mjs` — wire the new service and pass it to the device router

This task wires the new domain objects and service into the existing DI graph.

**Step 1: Add factory function to bootstrap.mjs**

Find the `createDeviceServices` function in bootstrap.mjs. After it (or nearby), add a new exported function:

```js
/**
 * Create WakeAndLoadService with its domain dependencies
 * @param {Object} config
 * @param {Object} config.deviceService - DeviceService instance
 * @param {Object} config.haGateway - Home Assistant gateway
 * @param {Object} config.devicesConfig - Raw device config (for sensor map)
 * @param {Function} config.broadcast - broadcastEvent function
 * @param {Object} [config.logger]
 * @returns {Object} { wakeAndLoadService }
 */
export function createWakeAndLoadService(config) {
  const { deviceService, haGateway, devicesConfig, broadcast, logger = console } = config;

  // Build sensor map from device config: deviceId -> state_sensor entity
  const sensorMap = {};
  for (const [deviceId, deviceConfig] of Object.entries(devicesConfig || {})) {
    const displays = deviceConfig.device_control?.displays;
    if (displays) {
      for (const [, displayConfig] of Object.entries(displays)) {
        if (displayConfig.state_sensor) {
          sensorMap[deviceId] = displayConfig.state_sensor;
          break; // Use first display's sensor for the device
        }
      }
    }
  }

  // Adapter: HA sensor check (or no-op if no gateway)
  let powerCheck;
  if (haGateway && Object.keys(sensorMap).length > 0) {
    const { HaSensorDisplayPowerCheck } = require('#adapters/home-automation/HaSensorDisplayPowerCheck.mjs');
    powerCheck = new HaSensorDisplayPowerCheck({ sensorMap }, { gateway: haGateway, logger });
  } else {
    const { createNoOpDisplayPowerCheck } = require('#domains/home-automation');
    powerCheck = createNoOpDisplayPowerCheck();
  }

  // Domain policy
  const { DisplayReadinessPolicy } = require('#domains/home-automation');
  const readinessPolicy = new DisplayReadinessPolicy({ powerCheck, logger });

  // Application service
  const { WakeAndLoadService } = require('#apps/devices/services/WakeAndLoadService.mjs');
  const wakeAndLoadService = new WakeAndLoadService({
    deviceService,
    readinessPolicy,
    broadcast,
    logger
  });

  return { wakeAndLoadService };
}
```

**Note:** The `require` calls above are pseudocode for ES module imports. In practice, these will be static imports at the top of bootstrap.mjs (since the codebase uses ES modules). The implementer should add the imports at the top:

```js
import { HaSensorDisplayPowerCheck } from '#adapters/home-automation/HaSensorDisplayPowerCheck.mjs';
import { DisplayReadinessPolicy, createNoOpDisplayPowerCheck } from '#domains/home-automation';
import { WakeAndLoadService } from '#apps/devices/services/WakeAndLoadService.mjs';
```

And the factory body becomes just the construction logic (no `require` calls).

**Step 2: Wire in app.mjs**

In `app.mjs`, after `deviceServices` is created (around line 1240), add:

```js
const { wakeAndLoadService } = createWakeAndLoadService({
  deviceService: deviceServices.deviceService,
  haGateway: homeAutomationAdapters.haGateway,
  devicesConfig: devicesConfig.devices || {},
  broadcast: broadcastEvent,
  logger: rootLogger.child({ module: 'wake-and-load' })
});
```

Then pass it to the device router creation (around line 1250):

```js
v1Routers.device = createDeviceApiRouter({
  deviceServices,
  wakeAndLoadService,   // <-- add this
  configService,
  logger: rootLogger.child({ module: 'device-api' })
});
```

**Step 3: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs backend/src/app.mjs
git commit -m "feat(bootstrap): wire DisplayReadinessPolicy and WakeAndLoadService into DI graph"
```

---

## Task 7: Slim Down the Device Router

**Files:**
- Modify: `backend/src/4_api/v1/routers/device.mjs:28-31,175-253`

Replace the inline orchestration in the `/load` endpoint with a call to `WakeAndLoadService`.

**Step 1: Accept wakeAndLoadService in the router factory**

In `createDeviceRouter`, update the destructuring (line 30):

```js
const { deviceService, wakeAndLoadService, configService, logger = console } = config;
```

**Step 2: Replace the `/load` handler body**

Replace the entire `router.get('/:deviceId/load', ...)` handler (lines 180-253) with:

```js
  /**
   * GET /device/:deviceId/load
   * Power on + verify display + load content
   * Query params passed to content (e.g., ?play=12345, ?open=videocall/id)
   * Emits wake-progress events over WebSocket for real-time phone UI feedback.
   */
  router.get('/:deviceId/load', asyncHandler(async (req, res) => {
    const { deviceId } = req.params;
    const query = { ...req.query };

    logger.info?.('device.router.load.start', { deviceId, query });

    if (!wakeAndLoadService) {
      // Fallback: no service wired (shouldn't happen in production)
      return res.status(500).json({ ok: false, error: 'WakeAndLoadService not configured' });
    }

    const result = await wakeAndLoadService.execute(deviceId, query);
    const status = result.ok ? 200 : (result.failedStep === 'verify' ? 200 : (result.error === 'Device not found' ? 404 : 200));

    logger.info?.('device.router.load.complete', {
      deviceId, ok: result.ok, failedStep: result.failedStep, totalElapsedMs: result.totalElapsedMs
    });

    res.status(status).json(result);
  }));
```

**Note:** We return 200 even for verify failures because the phone UI handles `allowOverride` to offer "Connect anyway". A 404 is reserved for missing devices.

**Step 3: Commit**

```bash
git add backend/src/4_api/v1/routers/device.mjs
git commit -m "refactor(api): replace inline load orchestration with WakeAndLoadService"
```

---

## Task 8: Frontend — `useWakeProgress` Hook

**Files:**
- Create: `frontend/src/modules/Input/hooks/useWakeProgress.js`

This hook listens for `wake-progress` WebSocket events and exposes step state.

**Step 1: Create the hook**

```js
// frontend/src/modules/Input/hooks/useWakeProgress.js

import { useState, useEffect, useCallback, useRef } from 'react';
import wsService from '../../../services/WebSocketService.js';

/**
 * Tracks wake-and-load progress for a device via WebSocket events.
 *
 * @param {string|null} deviceId - Active device being woken, or null when idle
 * @returns {{ progress: Object|null, reset: Function }}
 *
 * progress shape:
 *   { power: 'running'|'done'|'failed', verify: null|'running'|..., ... , failReason: string|null }
 */
export function useWakeProgress(deviceId) {
  const [progress, setProgress] = useState(null);
  const deviceIdRef = useRef(deviceId);
  deviceIdRef.current = deviceId;

  useEffect(() => {
    if (!deviceId) {
      setProgress(null);
      return;
    }

    // Initialize with all steps pending
    setProgress({ power: null, verify: null, prepare: null, load: null, failReason: null });

    const topic = `homeline:${deviceId}`;
    const unsub = wsService.subscribe(
      (data) => data.topic === topic && data.type === 'wake-progress',
      (message) => {
        if (deviceIdRef.current !== deviceId) return; // stale
        setProgress(prev => {
          if (!prev) return prev;
          const next = { ...prev, [message.step]: message.status };
          if (message.status === 'failed') {
            next.failReason = message.error || message.reason || 'Unknown error';
          }
          return next;
        });
      }
    );

    return unsub;
  }, [deviceId]);

  const reset = useCallback(() => setProgress(null), []);

  return { progress, reset };
}
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Input/hooks/useWakeProgress.js
git commit -m "feat(frontend): add useWakeProgress hook for real-time wake step tracking"
```

---

## Task 9: Frontend — Update CallApp UI with Step Tracker

**Files:**
- Modify: `frontend/src/Apps/CallApp.jsx:1-10,22-30,238-270,288-293,438-465`
- Modify: `frontend/src/Apps/CallApp.scss` (add step tracker styles)

**Step 1: Import the hook and wire it in**

At the top of `CallApp.jsx`, add the import:

```js
import { useWakeProgress } from '../modules/Input/hooks/useWakeProgress';
```

Inside the component, after the other hook calls (around line 33), add:

```js
const { progress: wakeProgress, reset: resetWakeProgress } = useWakeProgress(
  (waking || status === 'connecting') ? activeDeviceId : null
);
```

**Step 2: Update `dropIn` to handle the new response shape**

Replace the try/catch body inside `dropIn` (lines 249-269) with:

```js
    try {
      const result = await DaylightAPI(`/api/v1/device/${targetDeviceId}/load?open=videocall/${targetDeviceId}`);
      logger.info('wake-result', { targetDeviceId, ok: result.ok, failedStep: result.failedStep });

      if (!result.ok) {
        setWaking(false);
        if (result.allowOverride) {
          // Display didn't verify but user can override
          setWakeError(result.error || 'Display did not respond');
        } else {
          setWakeError(result.error || 'Could not wake device');
        }
        return;
      }
    } catch (err) {
      logger.warn('wake-failed', { targetDeviceId, error: err.message });
      setWaking(false);
      setWakeError('Could not reach server — try again');
      setCooldown(true);
      setTimeout(() => setCooldown(false), 3000);
      return;
    }
    setWaking(false);
    connect(targetDeviceId);
```

**Step 3: Update endCall to reset wake progress**

In the `endCall` callback, add `resetWakeProgress()` alongside the existing `reset()` call:

```js
  const endCall = useCallback(() => {
    reset();
    resetWakeProgress();
    // ... rest unchanged
```

And add `resetWakeProgress` to the dependency array.

**Step 4: Replace the connecting overlay with a step tracker**

Replace the connecting overlay section (lines 439-465) with:

```jsx
      {/* Connecting overlay — step tracker with real-time progress */}
      {isConnecting && (
        <div className="call-app__connecting-overlay">
          {wakeProgress ? (
            <div className="call-app__step-tracker">
              <StepRow label="Powering on TV" status={wakeProgress.power} />
              <StepRow label="Verifying display" status={wakeProgress.verify} />
              <StepRow label="Preparing kiosk" status={wakeProgress.prepare} />
              <StepRow label="Loading video call" status={wakeProgress.load} />
            </div>
          ) : (
            <p className="call-app__status-text">
              {waking ? 'Waking up TV...' : 'Establishing call...'}
            </p>
          )}
          {wakeProgress?.failReason && (
            <div className="call-app__timeout-msg">
              {wakeProgress.failReason}
            </div>
          )}
          {connectingTooLong && !wakeProgress?.failReason && (
            <div className="call-app__timeout-msg">
              TV is not responding. You can retry or cancel.
            </div>
          )}
          {(connectingTooLong || wakeProgress?.failReason) && (
            <button
              className="call-app__retry-btn"
              onClick={() => {
                const devId = connectedDeviceRef.current;
                if (devId) setPendingRetry(devId);
                endCall();
              }}
            >
              Retry
            </button>
          )}
          <button className="call-app__cancel" onClick={endCall}>
            Cancel
          </button>
        </div>
      )}
```

**Step 5: Add the StepRow helper component**

Add this above the `export default function CallApp()` line (or below the imports):

```jsx
const STEP_ICONS = { done: '\u2713', running: '\u2022', failed: '\u2717' };

function StepRow({ label, status }) {
  const icon = STEP_ICONS[status] || '\u25CB';
  const className = `call-app__step call-app__step--${status || 'pending'}`;
  return (
    <div className={className}>
      <span className="call-app__step-icon">{icon}</span>
      <span className="call-app__step-label">{label}</span>
      {status === 'running' && <span className="call-app__step-spinner" />}
    </div>
  );
}
```

**Step 6: Commit**

```bash
git add frontend/src/Apps/CallApp.jsx
git commit -m "feat(frontend): replace static connecting overlay with real-time step tracker"
```

---

## Task 10: Frontend — Step Tracker Styles

**Files:**
- Modify: `frontend/src/Apps/CallApp.scss`

**Step 1: Add step tracker styles**

Append the following inside the `.call-app { ... }` block (before the closing `}`):

```scss
  // Step tracker — connecting overlay progress
  &__step-tracker {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: 80%;
    max-width: 280px;
    margin-bottom: 1rem;
  }

  &__step {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.95rem;
    color: #666;
    transition: color 0.2s;

    &--running {
      color: #fff;
    }

    &--done {
      color: #4caf50;
    }

    &--failed {
      color: #ff5252;
    }
  }

  &__step-icon {
    width: 1.2em;
    text-align: center;
    font-weight: bold;
  }

  &__step-label {
    flex: 1;
  }

  &__step-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: call-spin 0.8s linear infinite;
  }

  @keyframes call-spin {
    to { transform: rotate(360deg); }
  }
```

**Step 2: Commit**

```bash
git add frontend/src/Apps/CallApp.scss
git commit -m "style(frontend): add step tracker styles for wake progress UI"
```

---

## Task 11: Integration Smoke Test

**Files:** None (manual testing)

**Step 1: Start the dev server**

```bash
lsof -i :3111  # Check if already running
npm run dev     # Start if needed
```

**Step 2: Test the happy path**

1. Open `/call` on a phone (or browser)
2. Tap a device to start a call
3. Verify the step tracker appears with steps transitioning in order
4. Verify the call connects after all steps complete

**Step 3: Test the failure path**

1. Power off the TV via HA (so sensor reads 'off')
2. Tap the device in the call app
3. Verify the step tracker shows "Powering on TV" → done, "Verifying display" → failed (red)
4. Verify "Connect anyway" button appears in the wake error overlay
5. Tap "Connect anyway" and verify the signaling flow proceeds

**Step 4: Test no-sensor device**

If testing with a device that has no `state_sensor` configured, verify:
- The verify step shows as failed with "No display sensor configured"
- "Connect anyway" is available

**Step 5: Commit any fixes from testing**

```bash
git add -A
git commit -m "fix: integration fixes from wake guardrails smoke test"
```

---

## Summary of Changes

| Layer | File | Change |
|-------|------|--------|
| Domain (2) | `home-automation/IDisplayPowerCheck.mjs` | New port interface |
| Domain (2) | `home-automation/DisplayReadinessPolicy.mjs` | New readiness policy |
| Domain (2) | `home-automation/index.mjs` | Export new domain objects |
| Adapter (1) | `home-automation/HaSensorDisplayPowerCheck.mjs` | New adapter implementing port |
| Adapter (1) | `devices/HomeAssistantDeviceAdapter.mjs` | Fix: `ok: false` on verify failure |
| Application (3) | `devices/services/WakeAndLoadService.mjs` | New orchestration service |
| Application (3) | `devices/services/index.mjs` | Export new service |
| System (0) | `bootstrap.mjs` | Factory for new service + DI wiring |
| System (0) | `app.mjs` | Wire service to router |
| API (4) | `routers/device.mjs` | Slim load handler, delegate to service |
| Frontend | `hooks/useWakeProgress.js` | New hook for WS progress events |
| Frontend | `Apps/CallApp.jsx` | Step tracker UI, updated wake handling |
| Frontend | `Apps/CallApp.scss` | Step tracker styles |
