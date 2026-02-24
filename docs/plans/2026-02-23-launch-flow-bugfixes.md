# Launch Flow Bugfixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 5 bugs in the RetroArch game launch pipeline that cause immediate crashes and UI deadlocks.

**Architecture:** The launch flow spans backend (AdbLauncher → LaunchService → launch API) and frontend (LaunchCard). The backend crashes because AdbLauncher calls methods that don't exist on DeviceService. The frontend deadlocks because LaunchCard never dismisses, has no keyboard handler, and can't resolve the target device. Fixes are independent per-file — backend and frontend bugs don't depend on each other.

**Tech Stack:** Node.js/Express (backend), React (frontend), ADB CLI (device control)

---

## Bug Summary

| # | Severity | File | Bug |
|---|----------|------|-----|
| 1 | CRITICAL | `AdbLauncher.mjs` | Calls `getDeviceConfig()` / `getAdbAdapter()` which don't exist on `DeviceService` → TypeError crash |
| 2 | HIGH | `LaunchCard.jsx` | Receives `onClose` prop but never calls it → card stays on screen forever |
| 3 | HIGH | `LaunchCard.jsx` | No keyboard handler → can't press Escape to dismiss |
| 4 | HIGH | `LaunchCard.jsx` | Device ID falls to `'default'` → backend rejects unknown device |
| 5 | LOW | `LaunchCard.jsx` | Retry button resets UI state but doesn't re-fire the fetch |

---

### Task 1: Fix AdbLauncher — use ConfigService instead of DeviceService

`AdbLauncher` receives `deviceServices.deviceService` (a `DeviceService` instance) but calls two methods that don't exist on it:
- `getDeviceConfig(deviceId)` — exists on `ConfigService` (line 214), NOT `DeviceService`
- `getAdbAdapter(deviceId)` — doesn't exist anywhere

`DeviceService` has: `get()`, `getOrThrow()`, `has()`, `listDeviceIds()`, `listDevices()`, `initialize()`.

The fix: change `AdbLauncher` to accept `configService` (which has `getDeviceConfig()`) and create `AdbAdapter` instances on-the-fly from the device's ADB config. The ADB config lives at `content_control.fallback` in `devices.yml`:

```yaml
# devices.yml — livingroom-tv
content_control:
  fallback:
    provider: adb
    host: 10.0.0.11
    port: 5555
```

**Files:**
- Modify: `backend/src/1_adapters/devices/AdbLauncher.mjs`
- Modify: `backend/src/app.mjs:1629-1631`

**Step 1: Rewrite AdbLauncher to use configService**

Replace the full file `backend/src/1_adapters/devices/AdbLauncher.mjs`:

```javascript
// backend/src/1_adapters/devices/AdbLauncher.mjs
import { IDeviceLauncher } from '#apps/devices/ports/IDeviceLauncher.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';
import { AdbAdapter } from './AdbAdapter.mjs';

/**
 * IDeviceLauncher implementation using ADB.
 * Translates abstract launch intents into Android activity manager commands.
 */
export class AdbLauncher extends IDeviceLauncher {
  #configService;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.configService - ConfigService for looking up device configs
   * @param {Object} [config.logger]
   */
  constructor(config) {
    super();
    this.#configService = config.configService;
    this.#logger = config.logger || console;
  }

  /**
   * Extract ADB connection config from a device's config.
   * ADB config lives at content_control.fallback where provider === 'adb'.
   * @private
   */
  #getAdbConfig(deviceId) {
    const deviceConfig = this.#configService.getDeviceConfig(deviceId);
    if (!deviceConfig) return null;
    const fallback = deviceConfig.content_control?.fallback;
    if (fallback?.provider === 'adb' && fallback.host) return fallback;
    return null;
  }

  /** @inheritdoc */
  async canLaunch(deviceId) {
    return !!this.#getAdbConfig(deviceId);
  }

  /** @inheritdoc */
  async launch(deviceId, launchIntent) {
    const adbConfig = this.#getAdbConfig(deviceId);
    if (!adbConfig) {
      throw new ValidationError('Device does not have ADB configured', {
        code: 'NO_ADB_CONFIG',
        field: 'deviceId',
        value: deviceId
      });
    }

    const adb = new AdbAdapter(
      { host: adbConfig.host, port: adbConfig.port },
      { logger: this.#logger }
    );
    await adb.connect();

    const args = ['start', '-n', launchIntent.target];
    for (const [key, val] of Object.entries(launchIntent.params)) {
      this.#validateIntentParam(key, val);
      args.push('--es', key, val);
    }

    this.#logger.info?.('launch.adb.executing', { deviceId, target: launchIntent.target, paramCount: Object.keys(launchIntent.params).length });

    const result = await adb.amStart(args);

    if (!result.ok) {
      this.#logger.error?.('launch.adb.failed', { deviceId, error: result.error });
      throw new Error(`ADB launch failed: ${result.error}`);
    }

    this.#logger.info?.('launch.adb.success', { deviceId });
    return result;
  }

  /**
   * Defense-in-depth: reject values with shell metacharacters.
   * Array-form execution doesn't interpret them, but we reject as a safety net.
   * Single quotes and spaces are allowed (common in ROM filenames).
   * @private
   */
  #validateIntentParam(key, val) {
    const shellMeta = /[;|&`${}[\]<>!\\]/;
    if (shellMeta.test(key)) {
      throw new ValidationError('Intent param key contains disallowed characters', { field: key });
    }
    if (shellMeta.test(val)) {
      throw new ValidationError('Intent param value contains disallowed characters', { field: key, value: val });
    }
  }
}

export default AdbLauncher;
```

**Step 2: Update app.mjs bootstrap to pass configService**

In `backend/src/app.mjs`, change lines 1629-1631 from:

```javascript
const adbLauncher = new AdbLauncher({
  deviceService: deviceServices.deviceService,
  logger: rootLogger.child({ module: 'adb-launcher' })
});
```

To:

```javascript
const adbLauncher = new AdbLauncher({
  configService,
  logger: rootLogger.child({ module: 'adb-launcher' })
});
```

**Verification:** Start the backend (`node backend/index.js`), then:
```bash
curl -X POST http://localhost:3112/api/v1/launch \
  -H 'Content-Type: application/json' \
  -d '{"contentId":"retroarch:n64/mario-kart-64-usa","targetDeviceId":"livingroom-tv"}'
```
Expected: `{ "success": true, ... }` (if Shield TV is reachable) or a clean error message (not a TypeError crash).

---

### Task 2: Fix LaunchCard — add auto-dismiss after success

`LaunchCard.jsx` receives `onClose` but never calls it. After launch succeeds (status='success') the card stays on screen forever.

**Files:**
- Modify: `frontend/src/modules/Menu/LaunchCard.jsx`

**Step 1: Add auto-dismiss timeout after success**

After `setStatus('success')` on line 28, add a timeout that calls `onClose()`:

```javascript
.then(data => {
  logger.info('launch.success', { contentId: launch.contentId, title: data.title });
  setStatus('success');
  setTimeout(() => onClose?.(), 1500);
})
```

This gives the user 1.5 seconds to see "Launched" before popping back to the menu.

---

### Task 3: Fix LaunchCard — add Escape key handler and error dismiss

No keyboard handler means users can't press Escape to close the card. Also, after an error, there's no way to dismiss without a mouse click.

**Files:**
- Modify: `frontend/src/modules/Menu/LaunchCard.jsx`

**Step 1: Add useEffect for keydown listener**

Add after the existing `useEffect` (after line 35):

```javascript
useEffect(() => {
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose?.();
    }
  };
  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [onClose]);
```

---

### Task 4: Fix LaunchCard — resolve device ID from backend

The frontend hardcodes device resolution as `launch.targetDeviceId || window.__DAYLIGHT_DEVICE_ID || 'default'`. On non-Shield browsers, this always sends `'default'` which doesn't exist in `devices.yml`.

The cleanest fix: make `targetDeviceId` optional in the API, and have `LaunchService` auto-resolve the device using the item's `deviceConstraint`. The `LaunchableItem` already has `deviceConstraint: 'android'` — the backend should use it to find a matching device.

**Files:**
- Modify: `backend/src/3_applications/content/services/LaunchService.mjs`
- Modify: `backend/src/4_api/v1/routers/launch.mjs:33`
- Modify: `frontend/src/modules/Menu/LaunchCard.jsx:15`

**Step 1: Make targetDeviceId optional in launch router**

In `backend/src/4_api/v1/routers/launch.mjs`, change the validation at line 33 from:

```javascript
if (!contentId || !targetDeviceId) {
  return res.status(400).json({
    error: 'Missing required fields: contentId, targetDeviceId'
  });
}
```

To:

```javascript
if (!contentId) {
  return res.status(400).json({
    error: 'Missing required field: contentId'
  });
}
```

**Step 2: Auto-resolve device in LaunchService**

In `backend/src/3_applications/content/services/LaunchService.mjs`, update the constructor and `launch()` method:

Constructor — add `configService` dependency:

```javascript
constructor(config) {
  this.#contentRegistry = config.contentRegistry;
  this.#deviceLauncher = config.deviceLauncher;
  this.#configService = config.configService;
  this.#logger = config.logger || console;
}
```

Add `#configService` to the private fields:

```javascript
#contentRegistry;
#deviceLauncher;
#configService;
#logger;
```

In `launch()`, after resolving the item (after line 51), add device auto-resolution:

```javascript
// 2. Resolve target device
let resolvedDeviceId = targetDeviceId;
if (!resolvedDeviceId && item.deviceConstraint) {
  resolvedDeviceId = this.#findDeviceByConstraint(item.deviceConstraint);
  if (!resolvedDeviceId) {
    throw new ValidationError('No device matches constraint', {
      code: 'NO_MATCHING_DEVICE',
      field: 'deviceConstraint',
      value: item.deviceConstraint
    });
  }
  this.#logger.info?.('launch.service.deviceAutoResolved', { constraint: item.deviceConstraint, deviceId: resolvedDeviceId });
}

if (!resolvedDeviceId) {
  throw new ValidationError('No target device specified and content has no device constraint', {
    code: 'NO_TARGET_DEVICE'
  });
}
```

Add the helper method to the class:

```javascript
/**
 * Find first device that matches a platform constraint (e.g., 'android').
 * Matches against device type containing the constraint string.
 * Shield TV type is 'shield-tv' which doesn't contain 'android',
 * so we also check for ADB capability (ADB = Android).
 * @private
 */
#findDeviceByConstraint(constraint) {
  if (!this.#configService) return null;
  const devices = this.#configService.getHouseholdDevices();
  if (!devices?.devices) return null;
  for (const [id, config] of Object.entries(devices.devices)) {
    const fallback = config.content_control?.fallback;
    if (constraint === 'android' && fallback?.provider === 'adb') return id;
    if (config.type?.includes(constraint)) return id;
  }
  return null;
}
```

**Step 3: Update LaunchService bootstrap in app.mjs**

In `backend/src/app.mjs`, update the `LaunchService` constructor (around line 1634) to pass `configService`:

```javascript
const launchService = new LaunchService({
  contentRegistry: contentRegistry,
  deviceLauncher: adbLauncher,
  configService,
  logger: rootLogger.child({ module: 'launch-service' })
});
```

**Step 4: Simplify LaunchCard device ID logic**

In `frontend/src/modules/Menu/LaunchCard.jsx`, simplify line 15 — let the backend handle device resolution:

```javascript
const deviceId = launch.targetDeviceId || window.__DAYLIGHT_DEVICE_ID || undefined;
```

And update the fetch body to omit `targetDeviceId` when undefined:

```javascript
body: JSON.stringify({
  contentId: launch.contentId,
  ...(deviceId && { targetDeviceId: deviceId })
})
```

**Verification:**
```bash
# Without targetDeviceId — should auto-resolve to livingroom-tv
curl -X POST http://localhost:3112/api/v1/launch \
  -H 'Content-Type: application/json' \
  -d '{"contentId":"retroarch:n64/mario-kart-64-usa"}'
```
Expected: Backend logs `launch.service.deviceAutoResolved { constraint: 'android', deviceId: 'livingroom-tv' }` and proceeds with ADB launch.

---

### Task 5: Fix LaunchCard — retry button actually retries

The retry button at line 50 resets `status` and `errorMsg` but the `useEffect` depends on `launch?.contentId` which hasn't changed, so the fetch never re-fires.

**Files:**
- Modify: `frontend/src/modules/Menu/LaunchCard.jsx`

**Step 1: Add retry counter to useEffect dependency**

Add a `retryCount` state:

```javascript
const [retryCount, setRetryCount] = useState(0);
```

Add `retryCount` to the useEffect dependency array (line 35):

```javascript
}, [launch?.contentId, retryCount]);
```

Update the retry button onClick (line 50):

```javascript
<button onClick={() => { setStatus('launching'); setErrorMsg(null); setRetryCount(c => c + 1); }}>Retry</button>
```

---

### Task 6: Verify complete LaunchCard file

After all fixes, the complete `frontend/src/modules/Menu/LaunchCard.jsx` should be:

```jsx
import { useState, useEffect, useMemo } from 'react';
import getLogger from '../../lib/logging/Logger.js';
import './LaunchCard.scss';

const LaunchCard = ({ launch, title, thumbnail, metadata, onClose }) => {
  const logger = useMemo(() => getLogger().child({ component: 'LaunchCard' }), []);
  const [status, setStatus] = useState('launching');
  const [errorMsg, setErrorMsg] = useState(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!launch?.contentId) return;

    logger.info('launch.initiated', { contentId: launch.contentId });

    const deviceId = launch.targetDeviceId || window.__DAYLIGHT_DEVICE_ID || undefined;

    fetch('/api/v1/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentId: launch.contentId,
        ...(deviceId && { targetDeviceId: deviceId })
      })
    })
      .then(res => {
        if (!res.ok) return res.json().then(d => Promise.reject(new Error(d.error || 'Launch failed')));
        return res.json();
      })
      .then(data => {
        logger.info('launch.success', { contentId: launch.contentId, title: data.title });
        setStatus('success');
        setTimeout(() => onClose?.(), 1500);
      })
      .catch(err => {
        logger.error('launch.failed', { contentId: launch.contentId, error: err.message });
        setStatus('error');
        setErrorMsg(err.message);
      });
  }, [launch?.contentId, retryCount]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="launch-card">
      {thumbnail && <img className="launch-card__art" src={thumbnail} alt={title} />}
      <div className="launch-card__info">
        <h2 className="launch-card__title">{title}</h2>
        {metadata?.parentTitle && <p className="launch-card__console">{metadata.parentTitle}</p>}
      </div>
      <div className="launch-card__status">
        {status === 'launching' && <span className="launch-card__spinner">Launching...</span>}
        {status === 'success' && <span className="launch-card__success">Launched</span>}
        {status === 'error' && (
          <div className="launch-card__error">
            <span>{errorMsg}</span>
            <button onClick={() => { setStatus('launching'); setErrorMsg(null); setRetryCount(c => c + 1); }}>Retry</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default LaunchCard;
```

**End-to-end verification:**
1. Navigate to `http://localhost:3111/tv`, select "Games" → pick a console → select a game → press Enter
2. LaunchCard appears with game art, title, console name, "Launching..."
3. If Shield TV reachable: shows "Launched" for 1.5s → auto-pops back to game list
4. If Shield TV unreachable: shows error message with Retry button
5. Press Escape at any point → pops back to game list
6. Click Retry → re-attempts the launch

---

## Files Changed Summary

| File | Change |
|------|--------|
| `backend/src/1_adapters/devices/AdbLauncher.mjs` | Rewrite to use `configService` + create `AdbAdapter` on-the-fly |
| `backend/src/app.mjs:1629-1631` | Pass `configService` instead of `deviceService` to AdbLauncher |
| `backend/src/app.mjs:1634-1638` | Pass `configService` to LaunchService |
| `backend/src/3_applications/content/services/LaunchService.mjs` | Add `configService` dep, auto-resolve device from `deviceConstraint` |
| `backend/src/4_api/v1/routers/launch.mjs:33` | Make `targetDeviceId` optional |
| `frontend/src/modules/Menu/LaunchCard.jsx` | Auto-dismiss, Escape handler, optional deviceId, working retry |
