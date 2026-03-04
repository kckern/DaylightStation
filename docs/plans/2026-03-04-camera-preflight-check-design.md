# Camera Pre-flight Check Design

**Date:** 2026-03-04
**Status:** Design approved

## Problem

After a cold wake (FKB force-stop/relaunch) or Shield power cycle, the USB camera ("Angetube Live Camera") may be physically connected but not expose `/dev/video*` nodes. The UVC driver binds (`/sys/bus/usb/drivers/uvcvideo/1-1:1.0`) but video device nodes don't appear. Without root access, sysfs USB reset is not possible. The TV-side `getUserMedia` silently fails, causing `replaceTrack` errors and a black screen for the caller with no explanation.

## Solution

Add a camera pre-flight check during `prepareForContent()` that detects missing video devices, retries with delays, and reports availability to the caller. If all retries fail, the caller can choose to proceed audio-only or trigger a full ADB reboot.

## Architecture

### 1. Camera Check in `FullyKioskContentAdapter.prepareForContent()`

**Placement:** After companion apps launch, before the success return.

**Logic:**
```
MAX_CAMERA_ATTEMPTS = 3
CAMERA_RETRY_MS = 2000

for attempt 1..MAX_CAMERA_ATTEMPTS:
  result = adb shell "ls /dev/video* 2>/dev/null | wc -l"
  if parseInt(result) > 0:
    log cameraCheckPassed, return cameraAvailable: true
  else:
    log cameraCheckFailed, attempt N
    if attempt < MAX_CAMERA_ATTEMPTS: wait CAMERA_RETRY_MS

return cameraAvailable: false (all attempts exhausted)
```

**Timing impact:**
- Camera present: ~1s (single ADB shell command)
- Camera missing: ~6s (3 attempts × 2s delay)

**Non-blocking:** `cameraAvailable: false` does NOT fail `prepareForContent()`. The method still returns `ok: true`. The camera status is advisory — the caller decides whether to proceed.

**Return value change:**
```javascript
return { ok: true, coldRestart, cameraAvailable, elapsedMs };
```

### 2. WakeAndLoadService Propagation

Same pattern as `coldWake`:
- Read `prepResult.cameraAvailable` after prepare succeeds
- Default `cameraAvailable: true` in result (assume available if adapter doesn't report)
- Include in final result: `result.cameraAvailable = cameraAvailable`

### 3. Reboot Endpoint

**Route:** `POST /api/v1/device/:deviceId/reboot`

**Implementation:**
```javascript
router.post('/:deviceId/reboot', asyncHandler(async (req, res) => {
  const device = deviceService.get(deviceId);
  // Use existing ADB adapter
  const result = await device.reboot();
  res.json(result);
}));
```

**ADB adapter method:**
```javascript
async reboot() {
  await this.shell('reboot');
  return { ok: true, hint: 'Device is rebooting. Allow ~60s before reconnecting.' };
}
```

The reboot is fire-and-forget — the ADB connection drops immediately. The frontend handles the wait.

### 4. Frontend — CallApp Camera Warning

**When:** `result.cameraAvailable === false` from wake API.

**UI flow:**
1. Wake stepper completes (all 4 steps show green checks)
2. Warning banner appears below stepper:
   - Text: "Camera not detected on TV — video may be unavailable"
   - Button: **"Connect anyway"** — proceeds with call (audio-only from TV)
   - Button: **"Reboot TV"** — calls reboot endpoint, shows "Rebooting..." with countdown
3. After reboot button pressed:
   - Show "Rebooting TV... try again in ~60 seconds"
   - After 60s, show "Retry Call" button
   - Retry calls `dropIn()` again from scratch

**State management:**
- New state: `cameraWarning` (boolean) — set from `result.cameraAvailable === false`
- New state: `rebooting` (boolean) — set when reboot button pressed

## Data Flow

```
FullyKioskContentAdapter.prepareForContent()
  → { ok: true, coldRestart: true, cameraAvailable: false }
    → WakeAndLoadService.execute()
      → { ok: true, coldWake: true, cameraAvailable: false }
        → GET /api/v1/device/:id/load response
          → CallApp reads result.cameraAvailable
            → Shows warning banner with Connect Anyway / Reboot TV
              → User clicks Reboot TV
                → POST /api/v1/device/:id/reboot
                  → ADB shell "reboot"
```

## Files to Change

| File | Change |
|------|--------|
| `backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs` | Camera check loop after companion apps |
| `backend/src/1_adapters/devices/AdbAdapter.mjs` | Add `reboot()` method |
| `backend/src/3_applications/devices/services/WakeAndLoadService.mjs` | Propagate `cameraAvailable` |
| `backend/src/4_api/v1/routers/device.mjs` | Add `POST /:deviceId/reboot` route |
| `frontend/src/Apps/CallApp.jsx` | Camera warning UI, reboot button, rebooting state |

## Edge Cases

- **No ADB adapter:** Skip camera check entirely, return `cameraAvailable: undefined`. Frontend treats undefined as "unknown" (no warning).
- **ADB command timeout:** If `ls /dev/video*` hangs, the ADB adapter's existing timeout will catch it. Treat as "unknown".
- **Camera appears on retry 2 or 3:** Works fine — we stop checking and return `cameraAvailable: true`.
- **Reboot during active call from another device:** The reboot endpoint should check if any other call is active on the device. If so, warn.
