# Camera Pre-flight Check Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Detect missing USB camera on Shield TV during wake-and-load, retry with delays, warn the caller, and offer ADB reboot as last resort.

**Architecture:** Add a camera availability check to `FullyKioskContentAdapter.prepareForContent()` that runs `ls /dev/video*` via ADB with retries. Propagate `cameraAvailable` through `WakeAndLoadService` to the API response. Frontend shows a warning with "Connect anyway" and "Reboot TV" options. Reboot uses a new `POST /api/v1/device/:id/reboot` endpoint.

**Tech Stack:** ADB shell commands, Express REST API, React state/UI

---

### Task 1: Add `reboot()` to `AdbAdapter`

**Files:**
- Modify: `backend/src/1_adapters/devices/AdbAdapter.mjs:103-118`

**Step 1: Add the reboot method**

After `isProcessRunning()` (line 103) and before `getMetrics()` (line 109), add:

```javascript
/**
 * Reboot the device
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async reboot() {
  this.#logger.info?.('adb.reboot', { serial: this.#serial });
  return this.#exec(`adb -s ${this.#serial} reboot`);
}
```

**Step 2: Commit**

```bash
git add backend/src/1_adapters/devices/AdbAdapter.mjs
git commit -m "feat(adb): add reboot method"
```

---

### Task 2: Add camera check to `FullyKioskContentAdapter.prepareForContent()`

**Files:**
- Modify: `backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs:164-166`

**Step 1: Add camera check after companion apps, before the success return**

After the companion apps loop ends (line 164) and before `return { ok: true, coldRestart, elapsedMs }` (line 166), insert the camera check:

```javascript
          // Check if USB camera is available via /dev/video* nodes.
          // After cold restart, the UVC driver may need time to re-enumerate.
          let cameraAvailable = false;
          if (this.#adbAdapter) {
            const MAX_CAMERA_ATTEMPTS = 3;
            const CAMERA_RETRY_MS = 2000;

            for (let camAttempt = 1; camAttempt <= MAX_CAMERA_ATTEMPTS; camAttempt++) {
              const camResult = await this.#adbAdapter.shell('ls /dev/video* 2>/dev/null | wc -l');
              const count = parseInt(camResult.output?.trim(), 10) || 0;

              if (count > 0) {
                this.#logger.info?.('fullykiosk.prepareForContent.cameraCheck.passed', {
                  attempt: camAttempt, videoDevices: count
                });
                cameraAvailable = true;
                break;
              }

              this.#logger.warn?.('fullykiosk.prepareForContent.cameraCheck.failed', {
                attempt: camAttempt, maxAttempts: MAX_CAMERA_ATTEMPTS
              });

              if (camAttempt < MAX_CAMERA_ATTEMPTS) {
                await new Promise(r => setTimeout(r, CAMERA_RETRY_MS));
              }
            }
          } else {
            // No ADB adapter — can't check, assume available
            cameraAvailable = true;
          }

          return { ok: true, coldRestart, cameraAvailable, elapsedMs: Date.now() - startTime };
```

This replaces the existing return at line 166.

**Step 2: Commit**

```bash
git add backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs
git commit -m "feat(fullykiosk): add camera pre-flight check with retries in prepareForContent"
```

---

### Task 3: Propagate `cameraAvailable` through `WakeAndLoadService`

**Files:**
- Modify: `backend/src/3_applications/devices/services/WakeAndLoadService.mjs:50-56,132,155`

**Step 1: Add default to initial result**

In the result object (line 50-57), add `cameraAvailable: true`:

```javascript
const result = {
  ok: false,
  deviceId,
  steps: {},
  canProceed: false,
  allowOverride: false,
  coldWake: false,
  cameraAvailable: true
};
```

**Step 2: Read from prepare result**

After `const coldWake = !!prepResult.coldRestart;` (line 132), add:

```javascript
const cameraAvailable = prepResult.cameraAvailable !== false;
```

**Step 3: Set on success result**

After `result.coldWake = coldWake;` (line 155), add:

```javascript
result.cameraAvailable = cameraAvailable;
```

**Step 4: Commit**

```bash
git add backend/src/3_applications/devices/services/WakeAndLoadService.mjs
git commit -m "feat(wake-and-load): propagate cameraAvailable in result"
```

---

### Task 4: Add reboot endpoint to device router

**Files:**
- Modify: `backend/src/4_api/v1/routers/device.mjs` (after the load endpoint, around line 198)

**Step 1: Add the reboot route**

After the load endpoint (line 198), add:

```javascript
  /**
   * POST /device/:deviceId/reboot
   * Reboot the device via ADB. Fire-and-forget — device disconnects during reboot.
   */
  router.post('/:deviceId/reboot', asyncHandler(async (req, res) => {
    const { deviceId } = req.params;

    logger.info?.('device.router.reboot.start', { deviceId });

    const device = deviceService.get(deviceId);
    if (!device) {
      return res.status(404).json({ ok: false, error: 'Device not found' });
    }

    const result = await device.reboot();

    logger.info?.('device.router.reboot.complete', { deviceId, ok: result.ok });

    res.json(result);
  }));
```

**Step 2: Add `reboot()` method to `Device.mjs`**

In `backend/src/3_applications/devices/services/Device.mjs`, after `toggle()` (line 117), add:

```javascript
  /**
   * Reboot device via ADB
   * @returns {Promise<Object>}
   */
  async reboot() {
    if (!this.#contentControl?.reboot) {
      return { ok: false, error: 'Reboot not supported for this device' };
    }

    this.#logger.info?.('device.reboot', { id: this.#id });
    return this.#contentControl.reboot();
  }
```

**Step 3: Add `reboot()` method to `FullyKioskContentAdapter`**

In `backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs`, after `prepareForContent()` (after line 184), add:

```javascript
  /**
   * Reboot the device via ADB
   * @returns {Promise<Object>}
   */
  async reboot() {
    if (!this.#adbAdapter) {
      return { ok: false, error: 'No ADB adapter configured' };
    }

    this.#logger.info?.('fullykiosk.reboot', { host: this.#host });
    const result = await this.#adbAdapter.reboot();

    return {
      ok: result.ok,
      error: result.error,
      hint: result.ok ? 'Device is rebooting. Allow ~60s before reconnecting.' : undefined
    };
  }
```

**Step 4: Commit**

```bash
git add backend/src/1_adapters/devices/AdbAdapter.mjs backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs backend/src/3_applications/devices/services/Device.mjs backend/src/4_api/v1/routers/device.mjs
git commit -m "feat(device): add ADB reboot endpoint"
```

---

### Task 5: Frontend — camera warning UI in CallApp

**Files:**
- Modify: `frontend/src/Apps/CallApp.jsx`

**Step 1: Add state for camera warning and rebooting**

Near the other state declarations (around line 98-105), add:

```javascript
const [cameraWarning, setCameraWarning] = useState(false);
const [rebooting, setRebooting] = useState(false);
```

**Step 2: Read `cameraAvailable` from wake result**

In the `dropIn` callback, after the `cold-wake-detected` log (line 576) and before the `if (!result.ok)` check (line 578), add:

```javascript
      if (result.cameraAvailable === false) {
        logger.warn('camera-not-detected', { targetDeviceId });
        setWaking(false);
        setCameraWarning(true);
        return;
      }
```

This stops the flow and shows the warning instead of auto-proceeding.

**Step 3: Add camera warning overlay**

After the wake error overlay (around line 800), add the camera warning overlay:

```jsx
      {/* Camera warning overlay */}
      {cameraWarning && !rebooting && (
        <div className="call-app__overlay-bottom">
          <p className="call-app__status-text">
            Camera not detected on TV — video may be unavailable
          </p>
          <button
            className="call-app__retry-btn"
            onClick={() => {
              setCameraWarning(false);
              const devId = connectedDeviceRef.current;
              if (devId) {
                coldWakeRef.current = true;
                connect(devId, { coldWake: true });
              }
            }}
          >
            Connect anyway
          </button>
          <button
            className="call-app__device-btn"
            onClick={async () => {
              const devId = connectedDeviceRef.current;
              if (!devId) return;
              setRebooting(true);
              logger.info('reboot-requested', { targetDeviceId: devId });
              try {
                await DaylightAPI(`/api/v1/device/${devId}/reboot`, { method: 'POST' });
              } catch (err) {
                logger.warn('reboot-failed', { error: err.message });
              }
              // Wait 60s then prompt retry
              setTimeout(() => setRebooting(false), 60_000);
            }}
          >
            Reboot TV
          </button>
          <button className="call-app__cancel" onClick={() => {
            setCameraWarning(false);
            connectedDeviceRef.current = null;
            setActiveDeviceId(null);
          }}>
            Cancel
          </button>
        </div>
      )}

      {/* Rebooting overlay */}
      {rebooting && (
        <div className="call-app__overlay-bottom">
          <p className="call-app__status-text">
            Rebooting TV... try again in ~60 seconds
          </p>
          <button
            className="call-app__retry-btn"
            onClick={() => {
              setRebooting(false);
              setCameraWarning(false);
              const devId = connectedDeviceRef.current;
              if (devId) dropIn(devId);
            }}
          >
            Retry Call
          </button>
          <button className="call-app__cancel" onClick={() => {
            setRebooting(false);
            setCameraWarning(false);
            connectedDeviceRef.current = null;
            setActiveDeviceId(null);
          }}>
            Cancel
          </button>
        </div>
      )}
```

**Step 4: Reset camera states in endCall**

In the `endCall` callback (around line 498), add:

```javascript
    setCameraWarning(false);
    setRebooting(false);
```

**Step 5: Commit**

```bash
git add frontend/src/Apps/CallApp.jsx
git commit -m "feat(callapp): camera warning UI with Connect Anyway and Reboot TV options"
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `backend/src/1_adapters/devices/AdbAdapter.mjs` | Add `reboot()` method |
| `backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs` | Camera check loop + `reboot()` method |
| `backend/src/3_applications/devices/services/WakeAndLoadService.mjs` | Propagate `cameraAvailable` |
| `backend/src/3_applications/devices/services/Device.mjs` | Add `reboot()` delegation |
| `backend/src/4_api/v1/routers/device.mjs` | `POST /:deviceId/reboot` endpoint |
| `frontend/src/Apps/CallApp.jsx` | Camera warning overlay + reboot UI |
