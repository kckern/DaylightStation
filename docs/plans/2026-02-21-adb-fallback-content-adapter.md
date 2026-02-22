# ADB Fallback Content Adapter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add ADB as a last-resort recovery mechanism when Fully Kiosk Browser's REST API is unreachable on the Shield TV, so videocalls and content loads don't silently fail.

**Architecture:** A `ResilientContentAdapter` wraps the existing `FullyKioskContentAdapter` and holds an `AdbAdapter` for recovery. When FKB's REST API refuses connections, the resilient adapter uses ADB to restart FKB, waits for boot, then retries FKB. `Device.mjs` and the API layer are untouched — the fallback is purely infrastructure resilience in the adapter layer.

**Tech Stack:** Node.js `child_process.execFile`, Android Debug Bridge (ADB) CLI, Alpine `android-tools` package

---

## Task 1: Update devices.yml with fallback config

**Files:**
- Modify: `/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/config/devices.yml`

**Step 1: Add fallback block to livingroom-tv content_control**

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
          state_sensor: sensor.living_room_tv_state
    content_control:
      provider: fully-kiosk
      host: 10.0.0.11
      port: 2323
      auth_ref: fullykiosk
      fallback:
        provider: adb
        host: 10.0.0.11
        port: 5555
        launch_activity: de.ozerov.fully/.TvActivity
```

Only the `fallback:` block under `content_control:` is new. Everything else stays.

**Step 2: Commit**

```bash
git add /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/config/devices.yml
git commit -m "config: add ADB fallback to livingroom-tv content_control"
```

---

## Task 2: Create AdbAdapter

**Files:**
- Create: `backend/src/1_adapters/devices/AdbAdapter.mjs`

**Step 1: Implement AdbAdapter**

Thin wrapper around the `adb` CLI binary. Uses `child_process.exec` with `promisify` (same pattern as `RemoteExecAdapter.mjs` at `backend/src/1_adapters/home-automation/remote-exec/RemoteExecAdapter.mjs:10-16`).

```javascript
/**
 * AdbAdapter - Android Debug Bridge CLI wrapper
 *
 * Provides low-level ADB operations for Android device control.
 * Used as a recovery mechanism when higher-level APIs (e.g., Fully Kiosk REST) are unreachable.
 *
 * @module adapters/devices
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const execAsync = promisify(exec);

export class AdbAdapter {
  #serial;
  #logger;
  #metrics;

  /**
   * @param {Object} config
   * @param {string} config.host - ADB target IP
   * @param {number} [config.port=5555] - ADB port
   * @param {Object} [deps]
   * @param {Object} [deps.logger]
   */
  constructor(config, deps = {}) {
    if (!config.host) {
      throw new InfrastructureError('AdbAdapter requires host', {
        code: 'MISSING_CONFIG',
        field: 'host'
      });
    }

    this.#serial = `${config.host}:${config.port || 5555}`;
    this.#logger = deps.logger || console;

    this.#metrics = {
      startedAt: Date.now(),
      commands: 0,
      errors: 0,
      recoveries: 0
    };
  }

  /**
   * Connect to ADB device
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async connect() {
    return this.#exec(`adb connect ${this.#serial}`);
  }

  /**
   * Run a shell command on the device
   * @param {string} command - Shell command to run
   * @returns {Promise<{ok: boolean, output?: string, error?: string}>}
   */
  async shell(command) {
    return this.#exec(`adb -s ${this.#serial} shell ${JSON.stringify(command)}`);
  }

  /**
   * Launch an Android activity
   * @param {string} activity - Fully qualified activity (e.g. "de.ozerov.fully/.TvActivity")
   * @returns {Promise<{ok: boolean, output?: string, error?: string}>}
   */
  async launchActivity(activity) {
    this.#logger.info?.('adb.launchActivity', { serial: this.#serial, activity });
    const result = await this.shell(`am start -n ${activity}`);

    if (result.ok) {
      this.#metrics.recoveries++;
    }

    return result;
  }

  /**
   * Check if a package's process is running
   * @param {string} packageName - Android package name
   * @returns {Promise<boolean>}
   */
  async isProcessRunning(packageName) {
    const result = await this.shell(`pidof ${packageName}`);
    return result.ok && !!result.output?.trim();
  }

  /**
   * Get adapter metrics
   * @returns {Object}
   */
  getMetrics() {
    return {
      provider: 'adb',
      serial: this.#serial,
      uptime: Date.now() - this.#metrics.startedAt,
      commands: this.#metrics.commands,
      errors: this.#metrics.errors,
      recoveries: this.#metrics.recoveries
    };
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  /**
   * Execute an ADB command
   * @private
   */
  async #exec(command) {
    this.#metrics.commands++;
    const startTime = Date.now();

    this.#logger.debug?.('adb.exec.start', { command, serial: this.#serial });

    try {
      const { stdout, stderr } = await execAsync(command, { timeout: 10_000 });
      const elapsedMs = Date.now() - startTime;

      this.#logger.debug?.('adb.exec.success', { command, elapsedMs, stdout: stdout?.trim() });

      return { ok: true, output: stdout?.trim(), stderr: stderr?.trim() };
    } catch (error) {
      this.#metrics.errors++;
      const elapsedMs = Date.now() - startTime;

      this.#logger.error?.('adb.exec.error', {
        command,
        error: error.message,
        code: error.code,
        elapsedMs
      });

      return { ok: false, error: error.message };
    }
  }
}

export default AdbAdapter;
```

**Step 2: Commit**

```bash
git add backend/src/1_adapters/devices/AdbAdapter.mjs
git commit -m "feat: add AdbAdapter for Android device control"
```

---

## Task 3: Create ResilientContentAdapter

**Files:**
- Create: `backend/src/1_adapters/devices/ResilientContentAdapter.mjs`

**Step 1: Implement ResilientContentAdapter**

Implements `IContentControl` (same interface as `FullyKioskContentAdapter`). Wraps a primary adapter with ADB-based recovery.

Reference interface: `backend/src/3_applications/devices/ports/IContentControl.mjs:30-37` — must implement `load()`, `getStatus()`, and `prepareForContent()`.

```javascript
/**
 * ResilientContentAdapter - Content control with ADB fallback recovery
 *
 * Wraps a primary IContentControl adapter (e.g., FullyKiosk) and uses
 * an AdbAdapter to recover when the primary is unreachable. When the
 * primary fails with a connection error, this adapter:
 * 1. Connects via ADB
 * 2. Launches the target app activity
 * 3. Waits for boot
 * 4. Retries the primary adapter
 *
 * @module adapters/devices
 */

const RECOVERY_WAIT_MS = 5000;
const CONNREFUSED = 'ECONNREFUSED';

export class ResilientContentAdapter {
  #primary;
  #adb;
  #launchActivity;
  #logger;
  #metrics;

  /**
   * @param {Object} config
   * @param {Object} config.primary - Primary IContentControl adapter (e.g., FullyKioskContentAdapter)
   * @param {Object} config.recovery - AdbAdapter instance
   * @param {string} config.launchActivity - Android activity to launch for recovery
   * @param {Object} [deps]
   * @param {Object} [deps.logger]
   */
  constructor(config, deps = {}) {
    this.#primary = config.primary;
    this.#adb = config.recovery;
    this.#launchActivity = config.launchActivity;
    this.#logger = deps.logger || console;

    this.#metrics = {
      startedAt: Date.now(),
      recoveryAttempts: 0,
      recoverySuccesses: 0
    };
  }

  // ===========================================================================
  // IContentControl Implementation
  // ===========================================================================

  /**
   * Prepare device for content loading, with ADB recovery on failure
   * @returns {Promise<Object>}
   */
  async prepareForContent() {
    const result = await this.#primary.prepareForContent();

    if (result.ok) return result;

    if (!this.#isConnectionError(result.error)) {
      return result;
    }

    // Primary unreachable — attempt ADB recovery
    this.#logger.warn?.('resilient.prepareForContent.primaryFailed', {
      error: result.error,
      attemptingRecovery: true
    });

    const recovered = await this.#attemptRecovery();
    if (!recovered.ok) {
      return {
        ok: false,
        error: result.error,
        recovery: { attempted: true, error: recovered.error }
      };
    }

    // Retry primary after recovery
    this.#logger.info?.('resilient.prepareForContent.retrying');
    const retryResult = await this.#primary.prepareForContent();

    if (retryResult.ok) {
      this.#logger.info?.('resilient.prepareForContent.recoverySuccess');
    } else {
      this.#logger.error?.('resilient.prepareForContent.recoveryFailed', {
        retryError: retryResult.error
      });
    }

    return {
      ...retryResult,
      recovery: { attempted: true, success: retryResult.ok }
    };
  }

  /**
   * Load content on device, with ADB recovery on failure
   * @param {string} path
   * @param {Object} [query]
   * @returns {Promise<Object>}
   */
  async load(path, query = {}) {
    const result = await this.#primary.load(path, query);

    if (result.ok) return result;

    if (!this.#isConnectionError(result.error)) {
      return result;
    }

    this.#logger.warn?.('resilient.load.primaryFailed', {
      path,
      error: result.error,
      attemptingRecovery: true
    });

    const recovered = await this.#attemptRecovery();
    if (!recovered.ok) {
      return {
        ...result,
        recovery: { attempted: true, error: recovered.error }
      };
    }

    // Retry: prepare + load
    this.#logger.info?.('resilient.load.retrying', { path });
    const prepResult = await this.#primary.prepareForContent();
    if (!prepResult.ok) {
      this.#logger.error?.('resilient.load.retryPrepareFailed', { error: prepResult.error });
      return {
        ok: false,
        error: prepResult.error,
        recovery: { attempted: true, success: false, step: 'prepare' }
      };
    }

    const retryResult = await this.#primary.load(path, query);

    if (retryResult.ok) {
      this.#logger.info?.('resilient.load.recoverySuccess', { path });
    } else {
      this.#logger.error?.('resilient.load.recoveryFailed', { path, error: retryResult.error });
    }

    return {
      ...retryResult,
      recovery: { attempted: true, success: retryResult.ok }
    };
  }

  /**
   * Get content control status (delegates to primary)
   * @returns {Promise<Object>}
   */
  async getStatus() {
    const status = await this.#primary.getStatus();
    return {
      ...status,
      resilient: true,
      recoveryAvailable: true,
      recoveryMetrics: {
        attempts: this.#metrics.recoveryAttempts,
        successes: this.#metrics.recoverySuccesses
      }
    };
  }

  /**
   * Get adapter metrics (primary + recovery stats)
   * @returns {Object}
   */
  getMetrics() {
    return {
      ...this.#primary.getMetrics(),
      resilient: true,
      recovery: {
        ...this.#adb.getMetrics(),
        attempts: this.#metrics.recoveryAttempts,
        successes: this.#metrics.recoverySuccesses
      }
    };
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  /**
   * Attempt to recover the primary adapter via ADB
   * @private
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async #attemptRecovery() {
    this.#metrics.recoveryAttempts++;
    const startTime = Date.now();

    this.#logger.info?.('resilient.recovery.start', {
      activity: this.#launchActivity,
      attempt: this.#metrics.recoveryAttempts
    });

    // Step 1: Connect ADB
    const connectResult = await this.#adb.connect();
    if (!connectResult.ok) {
      this.#logger.error?.('resilient.recovery.connectFailed', { error: connectResult.error });
      return { ok: false, error: `ADB connect failed: ${connectResult.error}` };
    }

    // Step 2: Launch the app activity
    const launchResult = await this.#adb.launchActivity(this.#launchActivity);
    if (!launchResult.ok) {
      this.#logger.error?.('resilient.recovery.launchFailed', { error: launchResult.error });
      return { ok: false, error: `ADB launch failed: ${launchResult.error}` };
    }

    // Step 3: Wait for app to boot
    this.#logger.debug?.('resilient.recovery.waitingForBoot', { waitMs: RECOVERY_WAIT_MS });
    await new Promise(r => setTimeout(r, RECOVERY_WAIT_MS));

    this.#metrics.recoverySuccesses++;
    const elapsedMs = Date.now() - startTime;

    this.#logger.info?.('resilient.recovery.complete', {
      elapsedMs,
      totalAttempts: this.#metrics.recoveryAttempts,
      totalSuccesses: this.#metrics.recoverySuccesses
    });

    return { ok: true, elapsedMs };
  }

  /**
   * Check if an error indicates the primary is unreachable
   * @private
   */
  #isConnectionError(errorMessage) {
    if (!errorMessage) return false;
    return errorMessage.includes(CONNREFUSED) ||
           errorMessage.includes('ETIMEDOUT') ||
           errorMessage.includes('EHOSTUNREACH');
  }
}

export default ResilientContentAdapter;
```

**Step 2: Commit**

```bash
git add backend/src/1_adapters/devices/ResilientContentAdapter.mjs
git commit -m "feat: add ResilientContentAdapter with ADB fallback recovery"
```

---

## Task 4: Export new adapters

**Files:**
- Modify: `backend/src/1_adapters/devices/index.mjs`

**Step 1: Add exports for AdbAdapter and ResilientContentAdapter**

Replace full file contents:

```javascript
/**
 * Device Adapters
 * @module adapters/devices
 */

export { HomeAssistantDeviceAdapter } from './HomeAssistantDeviceAdapter.mjs';
export { FullyKioskContentAdapter } from './FullyKioskContentAdapter.mjs';
export { WebSocketContentAdapter } from './WebSocketContentAdapter.mjs';
export { SshOsAdapter } from './SshOsAdapter.mjs';
export { AdbAdapter } from './AdbAdapter.mjs';
export { ResilientContentAdapter } from './ResilientContentAdapter.mjs';
```

**Step 2: Commit**

```bash
git add backend/src/1_adapters/devices/index.mjs
git commit -m "feat: export AdbAdapter and ResilientContentAdapter"
```

---

## Task 5: Wire fallback into DeviceFactory

**Files:**
- Modify: `backend/src/3_applications/devices/services/DeviceFactory.mjs`

**Step 1: Add imports**

At `DeviceFactory.mjs:5`, add after the existing FullyKiosk import:

```javascript
import { AdbAdapter } from '#adapters/devices/AdbAdapter.mjs';
import { ResilientContentAdapter } from '#adapters/devices/ResilientContentAdapter.mjs';
```

**Step 2: Wrap FKB in ResilientContentAdapter when fallback is configured**

In `#buildContentControl()` (lines 139-186), the `fully-kiosk` branch currently ends at line 166 with `return new FullyKioskContentAdapter(...)`. Replace lines 158-166 with:

```javascript
      const fkbAdapter = new FullyKioskContentAdapter(
        {
          host: config.host,
          port: config.port,
          password: password || '',
          daylightHost: this.#daylightHost
        },
        { httpClient: this.#httpClient, logger: this.#logger }
      );

      // Wrap with ADB recovery if fallback is configured
      if (config.fallback?.provider === 'adb') {
        const adbAdapter = new AdbAdapter(
          { host: config.fallback.host, port: config.fallback.port },
          { logger: this.#logger }
        );

        this.#logger.info?.('deviceFactory.resilientContentControl', {
          primary: 'fully-kiosk',
          fallback: 'adb',
          adbSerial: `${config.fallback.host}:${config.fallback.port}`
        });

        return new ResilientContentAdapter(
          {
            primary: fkbAdapter,
            recovery: adbAdapter,
            launchActivity: config.fallback.launch_activity
          },
          { logger: this.#logger }
        );
      }

      return fkbAdapter;
```

**Step 3: Commit**

```bash
git add backend/src/3_applications/devices/services/DeviceFactory.mjs
git commit -m "feat: wire ADB fallback into DeviceFactory for fully-kiosk devices"
```

---

## Task 6: Add android-tools to Dockerfile

**Files:**
- Modify: `docker/Dockerfile:8`

**Step 1: Add android-tools to system deps**

Change line 8 from:
```dockerfile
RUN apk add --no-cache openssh-client git curl ffmpeg tzdata yq
```
To:
```dockerfile
RUN apk add --no-cache openssh-client git curl ffmpeg tzdata yq android-tools
```

**Step 2: Commit**

```bash
git add docker/Dockerfile
git commit -m "build: add android-tools to Docker image for ADB fallback"
```

---

## Verification

### Local dev (Mac — ADB already installed and connected)

1. Start dev server: `npm run dev`
2. Confirm device registers with resilient adapter in logs:
   ```
   deviceFactory.resilientContentControl { primary: 'fully-kiosk', fallback: 'adb', adbSerial: '10.0.0.11:5555' }
   ```
3. Kill FKB on Shield: `adb -s 10.0.0.11:5555 shell am force-stop de.ozerov.fully`
4. Trigger a content load (e.g., initiate a videocall from phone)
5. Watch logs for the recovery sequence:
   ```
   resilient.load.primaryFailed → resilient.recovery.start → adb.launchActivity → resilient.recovery.complete → resilient.load.recoverySuccess
   ```
6. Confirm FKB reopens on the Shield and loads the content URL

### Docker (after rebuild)

1. Rebuild: `docker compose -f docker/docker-compose.yml build`
2. Verify `adb` is available: `docker exec daylight-station adb version`
3. Verify ADB can reach Shield from container: `docker exec daylight-station adb connect 10.0.0.11:5555`
4. Deploy and repeat the FKB-kill test above against prod
