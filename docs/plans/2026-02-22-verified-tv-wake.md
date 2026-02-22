# Verified TV Wake Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace fire-and-forget TV power-on with a verified wake sequence that polls display state, retries CEC commands, and notifies the mobile caller if the TV fails to turn on.

**Architecture:** Add a `verifiedPowerOn()` loop to `HomeAssistantDeviceAdapter` that sends the CEC power-on script, polls the HA state sensor, and retries up to N times. Surface the verification result through the `/load` API response. `CallApp.jsx` reads the result and shows a "TV not responding" error with retry/cancel options instead of silently proceeding.

**Tech Stack:** Node.js backend (Express), Home Assistant REST API, React frontend

---

### Task 1: Add verified power-on to HomeAssistantDeviceAdapter

**Files:**
- Modify: `backend/src/1_adapters/devices/HomeAssistantDeviceAdapter.mjs:195-207`

**Context:** `#powerOnDisplay()` currently runs `gateway.runScript(config.on_script)` and returns immediately. The gateway already has `waitForState(entityId, desiredState, options)` (see `HomeAssistantAdapter.mjs:168-193`) which polls HA until the entity reaches the desired state or times out. The device config already has `state_sensor` (e.g., `sensor.living_room_tv_state`). We need `#powerOnDisplay()` to: run script → poll state sensor → if still off, re-run script → poll again → return actual verification result.

**Step 1: Implement verified power-on logic**

Replace `#powerOnDisplay()` with a retry loop:

```javascript
async #powerOnDisplay(displayId, config, startTime) {
  const maxAttempts = config.powerOnRetries ?? 2;
  const sensor = config.state_sensor;

  this.#logger.info?.('device.ha.powerOn', { displayId, script: config.on_script, sensor, maxAttempts });

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const scriptResult = await this.#gateway.runScript(config.on_script);

    if (!scriptResult.ok) {
      return {
        ok: false,
        displayId,
        action: 'on',
        error: scriptResult.error,
        elapsedMs: Date.now() - startTime
      };
    }

    // If no state sensor configured, trust the script result (legacy behavior)
    if (!sensor) {
      this.#logger.info?.('device.ha.powerOn.noSensor', { displayId, attempt });
      return {
        ok: true,
        displayId,
        action: 'on',
        verified: false,
        verifySkipped: 'no_state_sensor',
        elapsedMs: Date.now() - startTime
      };
    }

    // Poll state sensor to verify display actually turned on
    const waitResult = await this.#gateway.waitForState(sensor, 'on', {
      timeoutMs: this.#waitOptions.timeoutMs,
      pollIntervalMs: this.#waitOptions.pollIntervalMs
    });

    if (waitResult.reached) {
      this.#logger.info?.('device.ha.powerOn.verified', {
        displayId, attempt, elapsedMs: Date.now() - startTime
      });
      return {
        ok: true,
        displayId,
        action: 'on',
        verified: true,
        attempt,
        elapsedMs: Date.now() - startTime
      };
    }

    // State not reached — log and retry (unless last attempt)
    this.#logger.warn?.('device.ha.powerOn.verifyFailed', {
      displayId, attempt, maxAttempts,
      sensorState: waitResult.finalState,
      elapsedMs: Date.now() - startTime
    });
  }

  // All attempts exhausted — display did not turn on
  this.#logger.error?.('device.ha.powerOn.allAttemptsFailed', {
    displayId, maxAttempts, elapsedMs: Date.now() - startTime
  });

  return {
    ok: true,        // script ran successfully (HA accepted it)
    displayId,
    action: 'on',
    verified: false,  // but display state was never confirmed
    verifyFailed: true,
    attempts: maxAttempts,
    elapsedMs: Date.now() - startTime
  };
}
```

**Design decisions:**
- `ok: true` + `verified: false` + `verifyFailed: true` when all attempts fail — the script ran, HA accepted it, but we couldn't confirm the display is on. Callers can decide how to handle this.
- `verified: false` + `verifySkipped: 'no_state_sensor'` when no sensor configured — graceful degradation for devices without state feedback.
- `verified: true` on success — caller can trust the display is on.
- `powerOnRetries` defaults to 2 (configurable per display in `devices.yml`).
- Existing `#waitOptions` (30s timeout, 2s poll) are used. These can be tuned per device.

**Step 2: Update constructor wait options to be configurable per intent**

The current `#waitOptions` has a 30s timeout which is too long for a videocall wake (user is waiting). Add a shorter default for power-on verification:

```javascript
// In constructor, after existing #waitOptions:
this.#powerOnWaitOptions = {
  timeoutMs: config.powerOnWaitOptions?.timeoutMs ?? 8000,
  pollIntervalMs: config.powerOnWaitOptions?.pollIntervalMs ?? 1500
};
```

Then use `this.#powerOnWaitOptions` in `#powerOnDisplay()` instead of `this.#waitOptions`.

**Step 3: Commit**

```bash
git add backend/src/1_adapters/devices/HomeAssistantDeviceAdapter.mjs
git commit -m "feat: add verified power-on with retry to HomeAssistantDeviceAdapter"
```

---

### Task 2: Surface display verification in /load response

**Files:**
- Modify: `backend/src/4_api/v1/routers/device.mjs:197-238`

**Context:** The `/load` endpoint chains `powerOn()` → `prepareForContent()` → `loadContent()` and returns `{ ok, power, prepare, load }`. The `power` result now includes `verified`, `verifyFailed`, and `verifySkipped` fields from Task 1. We need to surface a top-level `displayVerified` field so the frontend can check it without digging into nested objects.

**Step 1: Add displayVerified to response**

After the power-on step in the `/load` handler, extract the verification result:

```javascript
// After powerResult (line ~200), add:
const displayVerified = powerResult.verified === true;
const displayVerifyFailed = powerResult.verifyFailed === true;
const displayVerifySkipped = !!powerResult.verifySkipped;

if (displayVerifyFailed) {
  logger.warn?.('device.router.load.displayNotVerified', {
    deviceId,
    attempts: powerResult.attempts,
    elapsedMs: Date.now() - startTime
  });
}
```

Add these to the response object:

```javascript
const response = {
  ok: loadResult.ok,
  deviceId,
  displayVerified,
  displayVerifyFailed,
  power: powerResult,
  prepare: prepResult,
  load: loadResult,
  totalElapsedMs: Date.now() - startTime
};
```

**Key decision:** The `/load` endpoint still returns `ok: true` even when `displayVerifyFailed: true` — the content was loaded successfully on the Shield (which runs independently of the physical display). The caller (CallApp) decides how to use the verification info.

**Step 2: Commit**

```bash
git add backend/src/4_api/v1/routers/device.mjs
git commit -m "feat: surface displayVerified in /load response"
```

---

### Task 3: Handle wake failure in CallApp UI

**Files:**
- Modify: `frontend/src/Apps/CallApp.jsx:159-183`
- Modify: `frontend/src/Apps/CallApp.scss`

**Context:** `dropIn()` calls `DaylightAPI(/api/v1/device/${targetDeviceId}/load?...)` and proceeds to `connect()` on success. With Task 2, the response now includes `displayVerifyFailed`. We need to: (a) show a warning to the user when the TV display didn't turn on, (b) give them retry/cancel options, and (c) add a cooldown to prevent the retry storm (Issue 2 from audit).

**Step 1: Add wake failure state**

Add state for wake error and cooldown:

```javascript
const [wakeError, setWakeError] = useState(null);
const [cooldown, setCooldown] = useState(false);
```

**Step 2: Update dropIn to check displayVerifyFailed and add cooldown**

```javascript
const dropIn = useCallback(async (targetDeviceId) => {
  if (waking || status !== 'idle' || cooldown) return;
  if (!stream) {
    logger.warn('drop-in-blocked-no-stream', { targetDeviceId, error: error?.message });
    return;
  }
  logger.info('drop-in-start', { targetDeviceId });
  setWaking(true);
  setWakeError(null);
  connectedDeviceRef.current = targetDeviceId;
  setActiveDeviceId(targetDeviceId);
  try {
    const result = await DaylightAPI(`/api/v1/device/${targetDeviceId}/load?open=videocall/${targetDeviceId}`);
    logger.info('wake-success', { targetDeviceId, displayVerified: result.displayVerified });

    if (result.displayVerifyFailed) {
      logger.warn('wake-display-not-verified', { targetDeviceId, attempts: result.power?.attempts });
      setWaking(false);
      setWakeError('TV display did not respond. The screen may be off.');
      // Don't proceed to signaling — let user decide
      return;
    }
  } catch (err) {
    logger.warn('wake-failed', { targetDeviceId, error: err.message });
    setWaking(false);
    setWakeError('Could not reach server — try again');
    // Add cooldown to prevent retry storm
    setCooldown(true);
    setTimeout(() => setCooldown(false), 3000);
    return;
  }
  setWaking(false);
  connect(targetDeviceId);
}, [logger, connect, waking, status, stream, error, cooldown]);
```

**Step 3: Add wake error UI**

In the connecting/idle overlay section, show the wake error with retry and cancel buttons. Add after the existing `isIdle` overlay block:

```jsx
{/* Wake error overlay */}
{wakeError && !isConnecting && !isConnected && (
  <div className="call-app__overlay-bottom">
    <p className="call-app__status-text call-app__status-text--error">
      {wakeError}
    </p>
    <button
      className="call-app__retry-btn"
      disabled={cooldown}
      onClick={() => {
        setWakeError(null);
        const devId = connectedDeviceRef.current;
        if (devId) dropIn(devId);
      }}
    >
      {cooldown ? 'Wait...' : 'Try Again'}
    </button>
    <button className="call-app__cancel" onClick={() => {
      setWakeError(null);
      connectedDeviceRef.current = null;
      setActiveDeviceId(null);
    }}>
      Cancel
    </button>
  </div>
)}
```

**Step 4: Update isIdle to exclude wake error state**

The lobby should not show when there's a wake error:

```javascript
const isIdle = (status === 'idle' || status === 'occupied') && !wakeError;
```

**Step 5: Add CSS for error status text**

```scss
&__status-text {
  // ... existing styles ...

  &--error {
    color: #ff9f43;
  }
}
```

**Step 6: Commit**

```bash
git add frontend/src/Apps/CallApp.jsx frontend/src/Apps/CallApp.scss
git commit -m "feat: show TV wake failure to caller with retry/cancel options"
```

---

### Task 4: Add "proceed anyway" option for unverified wake

**Files:**
- Modify: `frontend/src/Apps/CallApp.jsx` (wake error UI from Task 3)

**Context:** The TV display verification may fail because: (a) the sensor doesn't exist in HA ("unknown"), (b) CEC is flaky but the TV actually turned on, or (c) the TV genuinely didn't turn on. Since we can't be 100% sure, give the user a "Connect anyway" option alongside "Try Again" and "Cancel".

**Step 1: Add "Connect anyway" button to wake error overlay**

Between the retry and cancel buttons:

```jsx
<button
  className="call-app__device-btn"
  onClick={() => {
    setWakeError(null);
    const devId = connectedDeviceRef.current;
    if (devId) {
      setWaking(false);
      connect(devId);
    }
  }}
>
  Connect anyway
</button>
```

**Step 2: Commit**

```bash
git add frontend/src/Apps/CallApp.jsx
git commit -m "feat: add 'connect anyway' option for unverified TV wake"
```

---

### Task 5: Investigate and fix the state sensor

**Files:**
- Modify: `data/household/config/devices.yml` (if sensor entity ID is wrong)

**Context:** `sensor.living_room_tv_state` returns "unknown" from the HA API. This could mean: (a) the sensor doesn't exist (wrong entity ID), (b) the sensor exists but HA doesn't know the state. We need to find the correct entity in HA that reports the TV's power state.

**Step 1: Query HA for all TV-related entities**

Use the existing HA adapter to search for entities. From the dev server or via API:

```bash
# List all entities with "living_room_tv" in the ID
curl -s -H "Authorization: Bearer $HA_TOKEN" \
  http://homeassistant.local:8123/api/states \
  | jq '[.[] | select(.entity_id | contains("living_room_tv"))] | .[].entity_id'
```

Or via the DaylightStation API if there's a passthrough, or SSH to prod and run from there.

**Step 2: Identify the correct entity**

Common HA entities for TVs:
- `media_player.living_room_tv` — state is "on"/"off"/"playing"/"idle"
- `binary_sensor.living_room_tv` — state is "on"/"off"
- `sensor.living_room_tv_state` — custom sensor

The `media_player` entity is the most likely correct one. Its state is typically "on" when the TV is powered on and "off" when powered off (via CEC).

**Step 3: Update devices.yml if needed**

If the correct entity is `media_player.living_room_tv`:

```yaml
livingroom-tv:
  type: shield-tv
  device_control:
    displays:
      tv:
        provider: homeassistant
        on_script: script.living_room_tv_on
        off_script: script.living_room_tv_off
        volume_script: script.living_room_tv_volume
        state_sensor: media_player.living_room_tv  # was: sensor.living_room_tv_state
```

**Step 4: Handle `media_player` "on" states**

`media_player` entities can have states: `on`, `off`, `playing`, `idle`, `paused`, `standby`, `unavailable`. For power verification, any state that is not `off`, `standby`, or `unavailable` should be considered "on".

Update the `waitForState` call in `#powerOnDisplay()` to handle this. Instead of waiting for exact state `'on'`, we need a predicate approach. However, `HomeAssistantAdapter.waitForState()` only supports exact string matching.

**Option A (simpler):** Add a `#isDisplayOn()` helper to `HomeAssistantDeviceAdapter` that polls `getState()` and checks for any "on-like" state:

```javascript
async #waitForDisplayOn(sensor) {
  const startTime = Date.now();
  const { timeoutMs, pollIntervalMs } = this.#powerOnWaitOptions;
  const onStates = new Set(['on', 'playing', 'idle', 'paused']);

  while (Date.now() - startTime < timeoutMs) {
    const state = await this.#gateway.getState(sensor);
    const currentState = state?.state;

    if (onStates.has(currentState)) {
      return { reached: true, elapsedMs: Date.now() - startTime, finalState: currentState };
    }

    await new Promise(r => setTimeout(r, pollIntervalMs));
  }

  const state = await this.#gateway.getState(sensor);
  return { reached: false, elapsedMs: Date.now() - startTime, finalState: state?.state ?? 'unknown' };
}
```

Then use `this.#waitForDisplayOn(sensor)` in `#powerOnDisplay()` instead of `this.#gateway.waitForState(sensor, 'on', ...)`.

**Step 5: Commit**

```bash
git add backend/src/1_adapters/devices/HomeAssistantDeviceAdapter.mjs
# If devices.yml was changed:
# git add data/household/config/devices.yml
git commit -m "fix: use correct HA entity for TV state verification"
```

---

## Summary

| Task | What | Files | Effort |
|------|------|-------|--------|
| 1 | Verified power-on with retry loop | `HomeAssistantDeviceAdapter.mjs` | Medium |
| 2 | Surface `displayVerified` in `/load` response | `device.mjs` (router) | Small |
| 3 | Wake failure UI in CallApp (+ retry storm fix) | `CallApp.jsx`, `CallApp.scss` | Medium |
| 4 | "Connect anyway" option | `CallApp.jsx` | Small |
| 5 | Find/fix correct HA state sensor entity | `devices.yml`, `HomeAssistantDeviceAdapter.mjs` | Medium |

**Dependency order:** Task 5 should be done first (or in parallel with Task 1) since it determines which entity to poll. Tasks 1-2 are backend, Task 3-4 are frontend. Tasks 1→2 are sequential. Tasks 3-4 depend on Task 2. Task 5 can inform Task 1.

**Recommended execution order:** 5 → 1 → 2 → 3 → 4
