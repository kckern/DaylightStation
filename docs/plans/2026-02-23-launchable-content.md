# Launchable Content Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `launch` action type that lets the TV interface launch native apps (RetroArch games) on Android devices via ADB, with a synced game catalog from X-plore.

**Architecture:** New `LaunchableItem` entity extends `Item`. Two ports (`IDeviceLauncher` for device execution, `ISyncSource` for catalog sync) keep infrastructure details in adapters. `RetroArchAdapter` implements `IContentSource` for browsing/search; `RetroArchSyncAdapter` implements `ISyncSource` for pulling playlists from X-plore; `AdbLauncher` implements `IDeviceLauncher` for executing launches via ADB. Config and catalog are split files.

**Tech Stack:** Node.js/ESM backend, React frontend, YAML data files, Jest for tests, ADB CLI for device control

**Design doc:** `docs/_wip/plans/2026-02-23-launchable-content-design.md`

---

## Task 1: Domain — LaunchableItem Entity

**Files:**
- Create: `backend/src/2_domains/content/entities/LaunchableItem.mjs`
- Test: `tests/unit/suite/domains/LaunchableItem.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/suite/domains/LaunchableItem.test.mjs
import { describe, it, expect } from '@jest/globals';
import { LaunchableItem } from '#domains/content/entities/LaunchableItem.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

describe('LaunchableItem', () => {
  const validProps = {
    id: 'retroarch:n64/mario-kart-64',
    source: 'retroarch',
    localId: 'n64/mario-kart-64',
    title: 'Mario Kart 64',
    type: 'game',
    launchIntent: {
      target: 'com.example/ActivityFuture',
      params: { ROM: '/path/to/rom.n64', LIBRETRO: '/path/to/core.so' }
    },
    deviceConstraint: 'android',
    console: 'n64'
  };

  describe('constructor', () => {
    it('creates a LaunchableItem with all fields', () => {
      const item = new LaunchableItem(validProps);
      expect(item.id).toBe('retroarch:n64/mario-kart-64');
      expect(item.source).toBe('retroarch');
      expect(item.title).toBe('Mario Kart 64');
      expect(item.type).toBe('game');
      expect(item.launchIntent).toEqual(validProps.launchIntent);
      expect(item.deviceConstraint).toBe('android');
      expect(item.console).toBe('n64');
    });

    it('inherits Item behavior (requires title)', () => {
      expect(() => new LaunchableItem({ ...validProps, title: undefined }))
        .toThrow(ValidationError);
    });

    it('defaults deviceConstraint and console to null', () => {
      const item = new LaunchableItem({
        ...validProps,
        deviceConstraint: undefined,
        console: undefined
      });
      expect(item.deviceConstraint).toBeNull();
      expect(item.console).toBeNull();
    });

    it('isPlayable returns false', () => {
      const item = new LaunchableItem(validProps);
      expect(item.isPlayable()).toBe(false);
    });

    it('isLaunchable returns true', () => {
      const item = new LaunchableItem(validProps);
      expect(item.isLaunchable()).toBe(true);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/suite/domains/LaunchableItem.test.mjs --no-coverage`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```javascript
// backend/src/2_domains/content/entities/LaunchableItem.mjs
import { Item } from './Item.mjs';

/**
 * A content item that can be launched on a target device.
 * The launchIntent is opaque to the domain — adapters interpret it.
 */
export class LaunchableItem extends Item {
  /**
   * @param {Object} props - Item props plus launch-specific fields
   * @param {Object} props.launchIntent - { target: string, params: Object }
   * @param {string|null} [props.deviceConstraint] - e.g. 'android'
   * @param {string|null} [props.console] - e.g. 'n64', 'snes'
   */
  constructor(props) {
    super(props);
    this.launchIntent = props.launchIntent ?? null;
    this.deviceConstraint = props.deviceConstraint ?? null;
    this.console = props.console ?? null;
  }

  /** @returns {boolean} */
  isLaunchable() {
    return true;
  }
}

export default LaunchableItem;
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/suite/domains/LaunchableItem.test.mjs --no-coverage`
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add backend/src/2_domains/content/entities/LaunchableItem.mjs tests/unit/suite/domains/LaunchableItem.test.mjs
git commit -m "feat(domain): add LaunchableItem entity"
```

---

## Task 2: Port — IDeviceLauncher

**Files:**
- Create: `backend/src/3_applications/devices/ports/IDeviceLauncher.mjs`
- Modify: `backend/src/3_applications/devices/ports/index.mjs` — add export
- Test: `tests/unit/suite/applications/IDeviceLauncher.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/suite/applications/IDeviceLauncher.test.mjs
import { describe, it, expect } from '@jest/globals';
import { IDeviceLauncher, isDeviceLauncher } from '#apps/devices/ports/IDeviceLauncher.mjs';

describe('IDeviceLauncher', () => {
  it('throws on direct method calls', async () => {
    const port = new IDeviceLauncher();
    await expect(port.launch('dev1', { target: 'x', params: {} }))
      .rejects.toThrow('IDeviceLauncher.launch must be implemented');
    await expect(port.canLaunch('dev1'))
      .rejects.toThrow('IDeviceLauncher.canLaunch must be implemented');
  });

  describe('isDeviceLauncher', () => {
    it('returns true for valid implementation', () => {
      const impl = { launch: async () => {}, canLaunch: async () => {} };
      expect(isDeviceLauncher(impl)).toBe(true);
    });

    it('returns false for incomplete implementation', () => {
      expect(isDeviceLauncher({})).toBe(false);
      expect(isDeviceLauncher({ launch: async () => {} })).toBe(false);
      expect(isDeviceLauncher(null)).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/suite/applications/IDeviceLauncher.test.mjs --no-coverage`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```javascript
// backend/src/3_applications/devices/ports/IDeviceLauncher.mjs

/**
 * Port for launching content on a target device.
 * Implemented by device-specific adapters (AdbLauncher, SshLauncher, etc.)
 */
export class IDeviceLauncher {
  /**
   * Execute a launch intent on a device
   * @param {string} deviceId
   * @param {{ target: string, params: Object }} launchIntent
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  async launch(deviceId, launchIntent) {
    throw new Error('IDeviceLauncher.launch must be implemented');
  }

  /**
   * Check if a device supports launching
   * @param {string} deviceId
   * @returns {Promise<boolean>}
   */
  async canLaunch(deviceId) {
    throw new Error('IDeviceLauncher.canLaunch must be implemented');
  }
}

/**
 * Duck-type check for IDeviceLauncher compliance
 * @param {any} obj
 * @returns {boolean}
 */
export function isDeviceLauncher(obj) {
  return obj != null &&
    typeof obj.launch === 'function' &&
    typeof obj.canLaunch === 'function';
}
```

Then add the export to `backend/src/3_applications/devices/ports/index.mjs`:

```javascript
// Append to existing exports:
export { IDeviceLauncher, isDeviceLauncher } from './IDeviceLauncher.mjs';
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/suite/applications/IDeviceLauncher.test.mjs --no-coverage`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/devices/ports/IDeviceLauncher.mjs backend/src/3_applications/devices/ports/index.mjs tests/unit/suite/applications/IDeviceLauncher.test.mjs
git commit -m "feat(port): add IDeviceLauncher device capability port"
```

---

## Task 3: Port — ISyncSource

**Files:**
- Create: `backend/src/3_applications/content/ports/ISyncSource.mjs`
- Test: `tests/unit/suite/applications/ISyncSource.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/suite/applications/ISyncSource.test.mjs
import { describe, it, expect } from '@jest/globals';
import { ISyncSource, isSyncSource } from '#apps/content/ports/ISyncSource.mjs';

describe('ISyncSource', () => {
  it('throws on direct method calls', async () => {
    const port = new ISyncSource();
    await expect(port.sync()).rejects.toThrow('ISyncSource.sync must be implemented');
    await expect(port.getStatus()).rejects.toThrow('ISyncSource.getStatus must be implemented');
  });

  describe('isSyncSource', () => {
    it('returns true for valid implementation', () => {
      const impl = { sync: async () => {}, getStatus: async () => {} };
      expect(isSyncSource(impl)).toBe(true);
    });

    it('returns false for incomplete implementation', () => {
      expect(isSyncSource({})).toBe(false);
      expect(isSyncSource({ sync: async () => {} })).toBe(false);
      expect(isSyncSource(null)).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/suite/applications/ISyncSource.test.mjs --no-coverage`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```javascript
// backend/src/3_applications/content/ports/ISyncSource.mjs

/**
 * Port for syncable content sources.
 * Implemented by adapters that pull catalogs from external systems.
 */
export class ISyncSource {
  /**
   * Perform a full sync from the external source.
   * @returns {Promise<{ synced: number, errors: number }>}
   */
  async sync() {
    throw new Error('ISyncSource.sync must be implemented');
  }

  /**
   * Return current sync status.
   * @returns {Promise<{ lastSynced: string|null, itemCount: number }>}
   */
  async getStatus() {
    throw new Error('ISyncSource.getStatus must be implemented');
  }
}

/**
 * Duck-type check for ISyncSource compliance
 * @param {any} obj
 * @returns {boolean}
 */
export function isSyncSource(obj) {
  return obj != null &&
    typeof obj.sync === 'function' &&
    typeof obj.getStatus === 'function';
}
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/suite/applications/ISyncSource.test.mjs --no-coverage`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/content/ports/ISyncSource.mjs tests/unit/suite/applications/ISyncSource.test.mjs
git commit -m "feat(port): add ISyncSource sync capability port"
```

---

## Task 4: Adapter — AdbLauncher

**Files:**
- Create: `backend/src/1_adapters/devices/AdbLauncher.mjs`
- Modify: `backend/src/1_adapters/devices/AdbAdapter.mjs` — add `amStart(args)` method
- Test: `tests/unit/suite/adapters/AdbLauncher.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/suite/adapters/AdbLauncher.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { AdbLauncher } from '#adapters/devices/AdbLauncher.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

describe('AdbLauncher', () => {
  let launcher;
  let mockDeviceService;
  let mockAdb;

  beforeEach(() => {
    mockAdb = {
      connect: jest.fn().mockResolvedValue({ ok: true }),
      amStart: jest.fn().mockResolvedValue({ ok: true, output: 'Starting: Intent' })
    };

    mockDeviceService = {
      getDeviceConfig: jest.fn().mockReturnValue({ adb: { host: '10.0.0.11', port: 5555 } }),
      getAdbAdapter: jest.fn().mockReturnValue(mockAdb)
    };

    launcher = new AdbLauncher({
      deviceService: mockDeviceService,
      logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() }
    });
  });

  describe('canLaunch', () => {
    it('returns true when device has adb config', async () => {
      expect(await launcher.canLaunch('shield-tv')).toBe(true);
    });

    it('returns false when device has no adb config', async () => {
      mockDeviceService.getDeviceConfig.mockReturnValue({});
      expect(await launcher.canLaunch('phone')).toBe(false);
    });

    it('returns false when device not found', async () => {
      mockDeviceService.getDeviceConfig.mockReturnValue(null);
      expect(await launcher.canLaunch('unknown')).toBe(false);
    });
  });

  describe('launch', () => {
    const intent = {
      target: 'com.retroarch.aarch64/com.retroarch.browser.retroactivity.RetroActivityFuture',
      params: {
        ROM: '/storage/emulated/0/Games/N64/Mario Kart 64 (USA).n64',
        LIBRETRO: '/data/local/tmp/mupen64plus_next_gles3_libretro_android.so'
      }
    };

    it('connects and executes amStart with array args', async () => {
      await launcher.launch('shield-tv', intent);

      expect(mockAdb.connect).toHaveBeenCalled();
      expect(mockAdb.amStart).toHaveBeenCalledWith([
        'start', '-n', intent.target,
        '--es', 'ROM', intent.params.ROM,
        '--es', 'LIBRETRO', intent.params.LIBRETRO
      ]);
    });

    it('rejects intent params with shell metacharacters', async () => {
      const maliciousIntent = {
        target: 'com.example/Activity',
        params: { ROM: '/path/to/rom; rm -rf /' }
      };

      await expect(launcher.launch('shield-tv', maliciousIntent))
        .rejects.toThrow(ValidationError);
    });

    it('allows single quotes in params (e.g., Kirby\'s Adventure)', async () => {
      const quoteIntent = {
        target: 'com.example/Activity',
        params: { ROM: "/path/to/Kirby's Adventure.nes" }
      };

      await launcher.launch('shield-tv', quoteIntent);
      expect(mockAdb.amStart).toHaveBeenCalledWith(
        expect.arrayContaining(["--es", "ROM", "/path/to/Kirby's Adventure.nes"])
      );
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/suite/adapters/AdbLauncher.test.mjs --no-coverage`
Expected: FAIL — module not found

**Step 3: Add `amStart(args)` to AdbAdapter**

Read `backend/src/1_adapters/devices/AdbAdapter.mjs` and add after the `launchActivity` method (line 78):

```javascript
  /**
   * Launch an activity with array-form arguments (injection-safe).
   * @param {string[]} args - Arguments for 'am' command, e.g. ['start', '-n', 'pkg/Activity', '--es', 'key', 'val']
   * @returns {Promise<{ok: boolean, output?: string, error?: string}>}
   */
  async amStart(args) {
    this.#logger.info?.('adb.amStart', { serial: this.#serial, args });
    const result = await this.#execArgs(['shell', 'am', ...args]);
    if (result.ok) {
      this.#metrics.recoveries++;
    }
    return result;
  }
```

Also add a new private `#execArgs` method that uses `execFile` instead of `exec` (after `#exec`, around line 139):

```javascript
  /**
   * Execute ADB with array arguments (no shell interpolation)
   * @private
   */
  async #execArgs(args) {
    this.#metrics.commands++;
    const startTime = Date.now();
    const fullArgs = ['-s', this.#serial, ...args];

    this.#logger.debug?.('adb.execArgs.start', { args: fullArgs });

    try {
      const { stdout, stderr } = await execFileAsync('adb', fullArgs, { timeout: 10_000 });
      const elapsedMs = Date.now() - startTime;
      this.#logger.debug?.('adb.execArgs.success', { elapsedMs, stdout: stdout?.trim() });
      return { ok: true, output: stdout?.trim(), stderr: stderr?.trim() };
    } catch (error) {
      this.#metrics.errors++;
      const elapsedMs = Date.now() - startTime;
      this.#logger.error?.('adb.execArgs.error', { args: fullArgs, error: error.message, elapsedMs });
      return { ok: false, error: error.message };
    }
  }
```

And update the imports at the top of AdbAdapter.mjs:

```javascript
import { exec, execFile } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
```

**Step 4: Write AdbLauncher implementation**

```javascript
// backend/src/1_adapters/devices/AdbLauncher.mjs
import { IDeviceLauncher } from '#apps/devices/ports/IDeviceLauncher.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

/**
 * IDeviceLauncher implementation using ADB.
 * Translates abstract launch intents into Android activity manager commands.
 */
export class AdbLauncher extends IDeviceLauncher {
  #deviceService;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.deviceService - DeviceService for looking up device configs and ADB adapters
   * @param {Object} [config.logger]
   */
  constructor(config) {
    super();
    this.#deviceService = config.deviceService;
    this.#logger = config.logger || console;
  }

  /** @inheritdoc */
  async canLaunch(deviceId) {
    const deviceConfig = this.#deviceService.getDeviceConfig(deviceId);
    return !!deviceConfig?.adb;
  }

  /** @inheritdoc */
  async launch(deviceId, launchIntent) {
    const adb = this.#deviceService.getAdbAdapter(deviceId);
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
    const shellMeta = /[;|&`$(){}[\]<>!\\]/;
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

**Step 5: Run test to verify it passes**

Run: `npx jest tests/unit/suite/adapters/AdbLauncher.test.mjs --no-coverage`
Expected: PASS

**Step 6: Commit**

```bash
git add backend/src/1_adapters/devices/AdbLauncher.mjs backend/src/1_adapters/devices/AdbAdapter.mjs tests/unit/suite/adapters/AdbLauncher.test.mjs
git commit -m "feat(adapter): add AdbLauncher with injection-safe intent execution"
```

---

## Task 5: Application — LaunchService

**Files:**
- Create: `backend/src/3_applications/content/services/LaunchService.mjs`
- Test: `tests/unit/suite/applications/LaunchService.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/suite/applications/LaunchService.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { LaunchService } from '#apps/content/services/LaunchService.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

describe('LaunchService', () => {
  let service;
  let mockRegistry;
  let mockLauncher;
  let mockAdapter;

  beforeEach(() => {
    mockAdapter = {
      getItem: jest.fn().mockResolvedValue({
        id: 'retroarch:n64/mario-kart-64',
        title: 'Mario Kart 64',
        launchIntent: {
          target: 'com.retroarch/Activity',
          params: { ROM: '/path/rom.n64' }
        }
      })
    };

    mockRegistry = {
      resolve: jest.fn().mockReturnValue({
        adapter: mockAdapter,
        source: 'retroarch',
        localId: 'n64/mario-kart-64'
      })
    };

    mockLauncher = {
      canLaunch: jest.fn().mockResolvedValue(true),
      launch: jest.fn().mockResolvedValue({ ok: true })
    };

    service = new LaunchService({
      contentRegistry: mockRegistry,
      deviceLauncher: mockLauncher,
      logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() }
    });
  });

  it('resolves content, validates device, and launches', async () => {
    const result = await service.launch({
      contentId: 'retroarch:n64/mario-kart-64',
      targetDeviceId: 'shield-tv'
    });

    expect(mockRegistry.resolve).toHaveBeenCalledWith('retroarch:n64/mario-kart-64');
    expect(mockAdapter.getItem).toHaveBeenCalledWith('n64/mario-kart-64');
    expect(mockLauncher.canLaunch).toHaveBeenCalledWith('shield-tv');
    expect(mockLauncher.launch).toHaveBeenCalledWith('shield-tv', {
      target: 'com.retroarch/Activity',
      params: { ROM: '/path/rom.n64' }
    });
    expect(result).toEqual(expect.objectContaining({
      success: true,
      contentId: 'retroarch:n64/mario-kart-64',
      targetDeviceId: 'shield-tv',
      title: 'Mario Kart 64'
    }));
  });

  it('throws ValidationError when content has no launchIntent', async () => {
    mockAdapter.getItem.mockResolvedValue({ id: 'plex:123', title: 'Movie', launchIntent: null });

    await expect(service.launch({ contentId: 'plex:123', targetDeviceId: 'shield-tv' }))
      .rejects.toThrow(ValidationError);
  });

  it('throws ValidationError when device cannot launch', async () => {
    mockLauncher.canLaunch.mockResolvedValue(false);

    await expect(service.launch({ contentId: 'retroarch:n64/mario-kart-64', targetDeviceId: 'phone' }))
      .rejects.toThrow(ValidationError);
  });

  it('throws when content not found', async () => {
    mockAdapter.getItem.mockResolvedValue(null);

    await expect(service.launch({ contentId: 'retroarch:n64/missing', targetDeviceId: 'shield-tv' }))
      .rejects.toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/suite/applications/LaunchService.test.mjs --no-coverage`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```javascript
// backend/src/3_applications/content/services/LaunchService.mjs
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';

/**
 * Orchestrates content launch on target devices.
 * Resolves content → validates device → executes launch.
 */
export class LaunchService {
  #contentRegistry;
  #deviceLauncher;
  #logger;

  /**
   * @param {Object} config
   * @param {import('#domains/content/services/ContentSourceRegistry.mjs').ContentSourceRegistry} config.contentRegistry
   * @param {import('#apps/devices/ports/IDeviceLauncher.mjs').IDeviceLauncher} config.deviceLauncher
   * @param {Object} [config.logger]
   */
  constructor(config) {
    this.#contentRegistry = config.contentRegistry;
    this.#deviceLauncher = config.deviceLauncher;
    this.#logger = config.logger || console;
  }

  /**
   * Launch content on a target device
   * @param {Object} input
   * @param {string} input.contentId - Compound ID (e.g. 'retroarch:n64/mario-kart-64')
   * @param {string} input.targetDeviceId - Device to launch on
   * @returns {Promise<{ success: boolean, contentId: string, targetDeviceId: string, title: string }>}
   */
  async launch({ contentId, targetDeviceId }) {
    this.#logger.info?.('launch.service.requested', { contentId, targetDeviceId });

    // 1. Resolve content
    const resolved = this.#contentRegistry.resolve(contentId);
    if (!resolved?.adapter) {
      throw new EntityNotFoundError('ContentSource', contentId);
    }

    const item = await resolved.adapter.getItem(resolved.localId);
    if (!item) {
      throw new EntityNotFoundError('Content', contentId);
    }

    if (!item.launchIntent) {
      throw new ValidationError('Content is not launchable', {
        code: 'NOT_LAUNCHABLE',
        field: 'launchIntent',
        value: contentId
      });
    }

    this.#logger.debug?.('launch.service.contentResolved', { contentId, title: item.title });

    // 2. Validate device
    const canLaunch = await this.#deviceLauncher.canLaunch(targetDeviceId);
    if (!canLaunch) {
      throw new ValidationError('Target device does not support launch', {
        code: 'DEVICE_NOT_CAPABLE',
        field: 'targetDeviceId',
        value: targetDeviceId
      });
    }

    // 3. Execute
    await this.#deviceLauncher.launch(targetDeviceId, item.launchIntent);

    this.#logger.info?.('launch.service.success', { contentId, targetDeviceId, title: item.title });

    return { success: true, contentId, targetDeviceId, title: item.title };
  }
}

export default LaunchService;
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/suite/applications/LaunchService.test.mjs --no-coverage`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/content/services/LaunchService.mjs tests/unit/suite/applications/LaunchService.test.mjs
git commit -m "feat(app): add LaunchService orchestration"
```

---

## Task 6: Application — SyncService

**Files:**
- Create: `backend/src/3_applications/content/services/SyncService.mjs`
- Test: `tests/unit/suite/applications/SyncService.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/suite/applications/SyncService.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { SyncService } from '#apps/content/services/SyncService.mjs';
import { EntityNotFoundError, ValidationError } from '#domains/core/errors/index.mjs';

describe('SyncService', () => {
  let service;
  let mockSyncSource;

  beforeEach(() => {
    mockSyncSource = {
      sync: jest.fn().mockResolvedValue({ synced: 30, errors: 0 }),
      getStatus: jest.fn().mockResolvedValue({ lastSynced: '2026-02-23T10:00:00Z', itemCount: 30 })
    };

    service = new SyncService({
      logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() }
    });
  });

  describe('registerSyncSource', () => {
    it('registers a valid sync source', () => {
      expect(() => service.registerSyncSource('retroarch', mockSyncSource)).not.toThrow();
    });

    it('rejects non-ISyncSource objects', () => {
      expect(() => service.registerSyncSource('bad', {})).toThrow(ValidationError);
      expect(() => service.registerSyncSource('bad', { sync: 'notfn' })).toThrow(ValidationError);
    });
  });

  describe('sync', () => {
    it('delegates to registered sync source', async () => {
      service.registerSyncSource('retroarch', mockSyncSource);
      const result = await service.sync('retroarch');
      expect(mockSyncSource.sync).toHaveBeenCalled();
      expect(result).toEqual({ synced: 30, errors: 0 });
    });

    it('throws EntityNotFoundError for unregistered source', async () => {
      await expect(service.sync('unknown')).rejects.toThrow(EntityNotFoundError);
    });
  });

  describe('getStatus', () => {
    it('delegates to registered sync source', async () => {
      service.registerSyncSource('retroarch', mockSyncSource);
      const result = await service.getStatus('retroarch');
      expect(result).toEqual({ lastSynced: '2026-02-23T10:00:00Z', itemCount: 30 });
    });

    it('throws EntityNotFoundError for unregistered source', async () => {
      await expect(service.getStatus('unknown')).rejects.toThrow(EntityNotFoundError);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/suite/applications/SyncService.test.mjs --no-coverage`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```javascript
// backend/src/3_applications/content/services/SyncService.mjs
import { isSyncSource } from '../ports/ISyncSource.mjs';
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';

/**
 * Generic sync orchestration service.
 * Any ISyncSource can register; the service delegates sync and status calls.
 */
export class SyncService {
  #syncSources;
  #logger;

  /**
   * @param {Object} [config]
   * @param {Object} [config.logger]
   */
  constructor(config = {}) {
    this.#syncSources = new Map();
    this.#logger = config.logger || console;
  }

  /**
   * Register a sync source
   * @param {string} source - Source identifier (e.g. 'retroarch')
   * @param {import('../ports/ISyncSource.mjs').ISyncSource} adapter
   */
  registerSyncSource(source, adapter) {
    if (!isSyncSource(adapter)) {
      throw new ValidationError(`Adapter for '${source}' does not implement ISyncSource`, {
        code: 'INVALID_SYNC_SOURCE',
        field: 'adapter'
      });
    }
    this.#syncSources.set(source, adapter);
    this.#logger.debug?.('syncService.registered', { source });
  }

  /**
   * Trigger sync for a source
   * @param {string} source
   * @returns {Promise<{ synced: number, errors: number }>}
   */
  async sync(source) {
    const adapter = this.#syncSources.get(source);
    if (!adapter) {
      throw new EntityNotFoundError('SyncSource', source);
    }
    this.#logger.info?.('syncService.syncStart', { source });
    const result = await adapter.sync();
    this.#logger.info?.('syncService.syncComplete', { source, ...result });
    return result;
  }

  /**
   * Get status for a source
   * @param {string} source
   * @returns {Promise<{ lastSynced: string|null, itemCount: number }>}
   */
  async getStatus(source) {
    const adapter = this.#syncSources.get(source);
    if (!adapter) {
      throw new EntityNotFoundError('SyncSource', source);
    }
    return adapter.getStatus();
  }
}

export default SyncService;
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/suite/applications/SyncService.test.mjs --no-coverage`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/content/services/SyncService.mjs backend/src/3_applications/content/ports/ISyncSource.mjs tests/unit/suite/applications/SyncService.test.mjs
git commit -m "feat(app): add SyncService with ISyncSource port validation"
```

---

## Task 7: Adapter — RetroArchAdapter (IContentSource)

**Files:**
- Create: `backend/src/1_adapters/content/retroarch/RetroArchAdapter.mjs`
- Create: `backend/src/1_adapters/content/retroarch/manifest.mjs`
- Test: `tests/unit/suite/adapters/RetroArchAdapter.test.mjs`

This is the largest adapter. It reads config.yml + catalog.yml and serves content.

**Step 1: Write the failing test**

```javascript
// tests/unit/suite/adapters/RetroArchAdapter.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { RetroArchAdapter } from '#adapters/content/retroarch/RetroArchAdapter.mjs';

// Minimal fixture data matching catalog.yml + config.yml shapes
const mockConfig = {
  launch: {
    package: 'com.retroarch.aarch64',
    activity: 'com.retroarch.browser.retroactivity.RetroActivityFuture',
    device_constraint: 'android'
  },
  consoles: {
    n64: { label: 'Nintendo 64', core: '/data/local/tmp/mupen64plus.so', menuStyle: 'arcade' },
    snes: { label: 'Super Nintendo', core: '/data/local/tmp/snes9x.so', menuStyle: 'arcade' }
  },
  thumbnails: { base_path: '/data/retroarch/thumbnails' }
};

const mockCatalog = {
  sync: { last_synced: '2026-02-23T10:00:00Z', game_count: 3 },
  games: {
    n64: [
      { id: 'mario-kart-64', title: 'Mario Kart 64', rom: '/Games/N64/Mario Kart 64.n64', thumbnail: 'n64/mario-kart-64.png' },
      { id: 'star-fox-64', title: 'Star Fox 64', rom: '/Games/N64/Star Fox 64.n64', thumbnail: 'n64/star-fox-64.png' }
    ],
    snes: [
      { id: 'zelda-alttp', title: 'Zelda: A Link to the Past', rom: '/Games/SNES/Zelda.smc', thumbnail: 'snes/zelda-alttp.png' }
    ]
  },
  overrides: {
    'n64/mario-kart-64': { title: 'MK64 Custom' }
  }
};

describe('RetroArchAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new RetroArchAdapter({
      config: mockConfig,
      catalog: mockCatalog,
      logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() }
    });
  });

  it('has source "retroarch" and correct prefix', () => {
    expect(adapter.source).toBe('retroarch');
    expect(adapter.prefixes).toEqual([{ prefix: 'retroarch' }]);
  });

  describe('getList', () => {
    it('returns consoles at root level', async () => {
      const list = await adapter.getList();
      expect(list).toHaveLength(2);
      expect(list[0]).toEqual(expect.objectContaining({
        id: 'retroarch:n64',
        title: 'Nintendo 64',
        type: 'console'
      }));
    });

    it('returns games for a console', async () => {
      const list = await adapter.getList('n64');
      expect(list).toHaveLength(2);
      expect(list[0]).toEqual(expect.objectContaining({
        id: 'retroarch:n64/mario-kart-64',
        title: 'MK64 Custom', // override applied
        type: 'game'
      }));
    });
  });

  describe('getItem', () => {
    it('returns LaunchableItem with launchIntent', async () => {
      const item = await adapter.getItem('n64/mario-kart-64');
      expect(item).not.toBeNull();
      expect(item.title).toBe('MK64 Custom'); // override
      expect(item.launchIntent).toEqual({
        target: 'com.retroarch.aarch64/com.retroarch.browser.retroactivity.RetroActivityFuture',
        params: {
          ROM: '/Games/N64/Mario Kart 64.n64',
          LIBRETRO: '/data/local/tmp/mupen64plus.so'
        }
      });
      expect(item.deviceConstraint).toBe('android');
      expect(item.console).toBe('n64');
    });

    it('returns null for unknown game', async () => {
      const item = await adapter.getItem('n64/nonexistent');
      expect(item).toBeNull();
    });
  });

  describe('resolvePlayables', () => {
    it('returns empty array (games are not playable)', async () => {
      const result = await adapter.resolvePlayables('n64/mario-kart-64');
      expect(result).toEqual([]);
    });
  });

  describe('resolveSiblings', () => {
    it('returns parent console and sibling games', async () => {
      const result = await adapter.resolveSiblings('retroarch:n64/mario-kart-64');
      expect(result.parent).toEqual(expect.objectContaining({
        id: 'retroarch:n64',
        title: 'Nintendo 64'
      }));
      expect(result.items).toHaveLength(2);
    });
  });

  describe('search', () => {
    it('finds games by text', async () => {
      const result = await adapter.search({ text: 'mario' });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].title).toBe('MK64 Custom');
    });

    it('finds games by console filter', async () => {
      const result = await adapter.search({ text: '', console: 'snes' });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].title).toBe('Zelda: A Link to the Past');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/suite/adapters/RetroArchAdapter.test.mjs --no-coverage`
Expected: FAIL — module not found

**Step 3: Write implementation**

```javascript
// backend/src/1_adapters/content/retroarch/RetroArchAdapter.mjs
import { LaunchableItem } from '#domains/content/entities/LaunchableItem.mjs';
import { Item } from '#domains/content/entities/Item.mjs';

/**
 * Content adapter for RetroArch games.
 * Reads from in-memory config + catalog (loaded at startup from YAML).
 * Never talks to X-plore or ADB directly.
 *
 * @implements {IContentSource}
 */
export class RetroArchAdapter {
  #config;
  #catalog;
  #logger;

  /**
   * @param {Object} options
   * @param {Object} options.config - Parsed config.yml (launch, consoles, thumbnails)
   * @param {Object} options.catalog - Parsed catalog.yml (sync, games, overrides)
   * @param {Object} [options.logger]
   */
  constructor({ config, catalog, logger }) {
    this.#config = config;
    this.#catalog = catalog || { games: {}, overrides: {}, sync: {} };
    this.#logger = logger || console;
  }

  get source() { return 'retroarch'; }
  get prefixes() { return [{ prefix: 'retroarch' }]; }

  /**
   * List consoles (root) or games (by consoleId)
   */
  async getList(id) {
    if (!id) return this.#listConsoles();
    return this.#listGames(id);
  }

  /**
   * Get a single game as LaunchableItem
   * @param {string} localId - 'n64/mario-kart-64' or 'mario-kart-64'
   */
  async getItem(localId) {
    const { consoleId, gameId } = this.#parseLocalId(localId);
    if (!consoleId || !gameId) return null;

    const consoleConfig = this.#config.consoles?.[consoleId];
    const games = this.#catalog.games?.[consoleId] || [];
    const game = games.find(g => g.id === gameId);
    if (!game || !consoleConfig) return null;

    const overrides = this.#catalog.overrides?.[`${consoleId}/${gameId}`] || {};
    if (overrides.hidden) return null;

    const title = overrides.title || game.title;
    const launchTarget = `${this.#config.launch.package}/${this.#config.launch.activity}`;

    this.#logger.debug?.('retroarch.item.resolved', { consoleId, gameId });

    return new LaunchableItem({
      id: `retroarch:${consoleId}/${gameId}`,
      source: 'retroarch',
      localId: `${consoleId}/${gameId}`,
      title,
      type: 'game',
      thumbnail: game.thumbnail ? `/api/v1/proxy/retroarch/thumbnail/${game.thumbnail}` : null,
      metadata: { type: 'game', console: consoleId, parentTitle: consoleConfig.label, menuStyle: consoleConfig.menuStyle },
      launchIntent: {
        target: launchTarget,
        params: { ROM: game.rom, LIBRETRO: consoleConfig.core }
      },
      deviceConstraint: this.#config.launch.device_constraint || null,
      console: consoleId
    });
  }

  async resolvePlayables() { return []; }

  async resolveSiblings(compoundId) {
    const localId = compoundId.replace(/^retroarch:/, '');
    const { consoleId } = this.#parseLocalId(localId);
    if (!consoleId) return null;

    const consoleConfig = this.#config.consoles?.[consoleId];
    if (!consoleConfig) return null;

    const games = await this.#listGames(consoleId);
    return {
      parent: {
        id: `retroarch:${consoleId}`,
        title: consoleConfig.label,
        source: 'retroarch',
        thumbnail: null
      },
      items: games
    };
  }

  getSearchCapabilities() {
    return { canonical: ['text'], specific: ['console'] };
  }

  async search(query) {
    const { text = '', console: consoleFilter, take = 50 } = query;
    const searchText = text.toLowerCase();
    const items = [];

    const consolesToSearch = consoleFilter
      ? [consoleFilter]
      : Object.keys(this.#catalog.games || {});

    for (const consoleId of consolesToSearch) {
      const games = this.#catalog.games?.[consoleId] || [];
      for (const game of games) {
        const overrides = this.#catalog.overrides?.[`${consoleId}/${game.id}`] || {};
        if (overrides.hidden) continue;
        const title = overrides.title || game.title;
        if (searchText && !title.toLowerCase().includes(searchText)) continue;

        items.push(new Item({
          id: `retroarch:${consoleId}/${game.id}`,
          source: 'retroarch',
          localId: `${consoleId}/${game.id}`,
          title,
          type: 'game',
          thumbnail: game.thumbnail ? `/api/v1/proxy/retroarch/thumbnail/${game.thumbnail}` : null,
          metadata: { type: 'game', console: consoleId }
        }));

        if (items.length >= take) break;
      }
      if (items.length >= take) break;
    }

    return { items, total: items.length };
  }

  // ── Private ──────────────────────────────────────────

  #listConsoles() {
    const consoles = this.#config.consoles || {};
    return Object.entries(consoles).map(([id, cfg]) => {
      const gameCount = (this.#catalog.games?.[id] || []).length;
      return new Item({
        id: `retroarch:${id}`,
        source: 'retroarch',
        localId: id,
        title: cfg.label,
        type: 'console',
        metadata: { type: 'console', gameCount, menuStyle: cfg.menuStyle }
      });
    });
  }

  #listGames(consoleId) {
    const games = this.#catalog.games?.[consoleId] || [];
    const consoleConfig = this.#config.consoles?.[consoleId];
    if (!consoleConfig) return [];

    return games
      .filter(game => {
        const overrides = this.#catalog.overrides?.[`${consoleId}/${game.id}`] || {};
        return !overrides.hidden;
      })
      .map(game => {
        const overrides = this.#catalog.overrides?.[`${consoleId}/${game.id}`] || {};
        return new Item({
          id: `retroarch:${consoleId}/${game.id}`,
          source: 'retroarch',
          localId: `${consoleId}/${game.id}`,
          title: overrides.title || game.title,
          type: 'game',
          thumbnail: game.thumbnail ? `/api/v1/proxy/retroarch/thumbnail/${game.thumbnail}` : null,
          metadata: { type: 'game', console: consoleId, parentTitle: consoleConfig.label }
        });
      });
  }

  /**
   * Parse localId into consoleId + gameId
   * Supports 'n64/mario-kart-64' and flat 'mario-kart-64' (scans all consoles)
   */
  #parseLocalId(localId) {
    if (!localId) return { consoleId: null, gameId: null };

    const slashIdx = localId.indexOf('/');
    if (slashIdx >= 0) {
      return { consoleId: localId.slice(0, slashIdx), gameId: localId.slice(slashIdx + 1) };
    }

    // Flat alias — scan all consoles
    for (const [consoleId, games] of Object.entries(this.#catalog.games || {})) {
      if (games.some(g => g.id === localId)) {
        return { consoleId, gameId: localId };
      }
    }

    this.#logger.warn?.('retroarch.item.notFound', { localId });
    return { consoleId: null, gameId: null };
  }
}

export default RetroArchAdapter;
```

Also create the manifest:

```javascript
// backend/src/1_adapters/content/retroarch/manifest.mjs
export default {
  provider: 'retroarch',
  capability: 'game',
  displayName: 'RetroArch Games (N64, SNES, Genesis, etc.)',
  mediaTypes: [],
  playableType: 'game',
  implicit: true,
  adapter: () => import('./RetroArchAdapter.mjs'),
  configSchema: {
    config: { type: 'object', required: true },
    catalog: { type: 'object', required: true }
  }
};
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/suite/adapters/RetroArchAdapter.test.mjs --no-coverage`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/content/retroarch/RetroArchAdapter.mjs backend/src/1_adapters/content/retroarch/manifest.mjs tests/unit/suite/adapters/RetroArchAdapter.test.mjs
git commit -m "feat(adapter): add RetroArchAdapter content source"
```

---

## Task 8: Adapter — RetroArchSyncAdapter

**Files:**
- Create: `backend/src/1_adapters/content/retroarch/RetroArchSyncAdapter.mjs`
- Test: `tests/unit/suite/adapters/RetroArchSyncAdapter.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/suite/adapters/RetroArchSyncAdapter.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { RetroArchSyncAdapter } from '#adapters/content/retroarch/RetroArchSyncAdapter.mjs';

const MOCK_PLAYLIST = {
  items: [
    {
      path: '/storage/emulated/0/Games/N64/Mario Kart 64 (USA).n64',
      label: 'Mario Kart 64 (USA)',
      core_path: '/data/local/tmp/mupen64plus_next_gles3_libretro_android.so',
      crc32: 'DEADBEEF'
    },
    {
      path: '/storage/emulated/0/Games/N64/Star Fox 64 (USA).n64',
      label: 'Star Fox 64 (USA)',
      core_path: '/data/local/tmp/mupen64plus_next_gles3_libretro_android.so',
      crc32: '12345678'
    }
  ]
};

describe('RetroArchSyncAdapter', () => {
  let adapter;
  let mockHttpClient;
  let mockWriteCatalog;
  let mockReadCatalog;

  beforeEach(() => {
    mockHttpClient = {
      get: jest.fn()
        // First call: directory listing
        .mockResolvedValueOnce({
          data: [{ name: 'Nintendo 64.lpl', type: 'file' }]
        })
        // Second call: playlist content
        .mockResolvedValueOnce({ data: MOCK_PLAYLIST })
    };

    mockReadCatalog = jest.fn().mockReturnValue({
      sync: {},
      games: {},
      overrides: { 'n64/mario-kart-64': { title: 'MK64 Custom' } }
    });

    mockWriteCatalog = jest.fn();

    adapter = new RetroArchSyncAdapter({
      sourceConfig: { host: '10.0.0.11', port: 1111, playlists_path: '/storage/emulated/0/RetroArch/playlists' },
      consoleConfig: {
        n64: { label: 'Nintendo 64', core: '/data/local/tmp/mupen64plus_next_gles3_libretro_android.so' }
      },
      thumbnailBasePath: '/data/retroarch/thumbnails',
      httpClient: mockHttpClient,
      readCatalog: mockReadCatalog,
      writeCatalog: mockWriteCatalog,
      downloadThumbnail: jest.fn().mockResolvedValue(true),
      logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() }
    });
  });

  describe('sync', () => {
    it('fetches playlists, parses games, preserves overrides, and writes catalog', async () => {
      const result = await adapter.sync();

      expect(mockHttpClient.get).toHaveBeenCalledTimes(2);
      expect(mockWriteCatalog).toHaveBeenCalledTimes(1);

      const writtenCatalog = mockWriteCatalog.mock.calls[0][0];
      expect(writtenCatalog.games.n64).toHaveLength(2);
      expect(writtenCatalog.games.n64[0].id).toBe('mario-kart-64-usa');
      expect(writtenCatalog.overrides).toEqual({ 'n64/mario-kart-64': { title: 'MK64 Custom' } });
      expect(writtenCatalog.sync.game_count).toBe(2);
      expect(result.synced).toBe(2);
    });
  });

  describe('getStatus', () => {
    it('returns sync status from catalog', async () => {
      mockReadCatalog.mockReturnValue({
        sync: { last_synced: '2026-02-23T10:00:00Z', game_count: 30 },
        games: {}, overrides: {}
      });

      const status = await adapter.getStatus();
      expect(status).toEqual({ lastSynced: '2026-02-23T10:00:00Z', itemCount: 30 });
    });

    it('returns null/zero when no catalog exists', async () => {
      mockReadCatalog.mockReturnValue(null);
      const status = await adapter.getStatus();
      expect(status).toEqual({ lastSynced: null, itemCount: 0 });
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/suite/adapters/RetroArchSyncAdapter.test.mjs --no-coverage`
Expected: FAIL — module not found

**Step 3: Write implementation**

```javascript
// backend/src/1_adapters/content/retroarch/RetroArchSyncAdapter.mjs

/**
 * Syncs RetroArch game catalog from X-plore WiFi File Manager.
 * Implements ISyncSource.
 */
export class RetroArchSyncAdapter {
  #sourceConfig;
  #consoleConfig;
  #thumbnailBasePath;
  #httpClient;
  #readCatalog;
  #writeCatalog;
  #downloadThumbnail;
  #logger;

  /**
   * @param {Object} options
   * @param {Object} options.sourceConfig - { host, port, playlists_path }
   * @param {Object} options.consoleConfig - Console-to-core mappings from config.yml
   * @param {string} options.thumbnailBasePath - Where to save thumbnails
   * @param {Object} options.httpClient - HTTP client for X-plore requests
   * @param {Function} options.readCatalog - () => catalog object or null
   * @param {Function} options.writeCatalog - (catalog) => void
   * @param {Function} options.downloadThumbnail - (url, destPath) => boolean
   * @param {Object} [options.logger]
   */
  constructor(options) {
    this.#sourceConfig = options.sourceConfig;
    this.#consoleConfig = options.consoleConfig;
    this.#thumbnailBasePath = options.thumbnailBasePath;
    this.#httpClient = options.httpClient;
    this.#readCatalog = options.readCatalog;
    this.#writeCatalog = options.writeCatalog;
    this.#downloadThumbnail = options.downloadThumbnail;
    this.#logger = options.logger || console;
  }

  /** ISyncSource.sync() */
  async sync() {
    this.#logger.info?.('retroarch.sync.start');
    const baseUrl = `http://${this.#sourceConfig.host}:${this.#sourceConfig.port}`;

    // 1. Fetch playlist directory listing
    const playlistDir = `${baseUrl}${this.#sourceConfig.playlists_path}?cmd=list`;
    const dirResponse = await this.#httpClient.get(playlistDir);
    const playlists = (dirResponse.data || []).filter(f => f.name?.endsWith('.lpl'));

    this.#logger.info?.('retroarch.sync.playlistsFetched', { count: playlists.length });

    // 2. Fetch and parse each playlist
    const games = {};
    let totalGames = 0;

    for (const playlist of playlists) {
      const playlistUrl = `${baseUrl}${this.#sourceConfig.playlists_path}/${playlist.name}`;
      const response = await this.#httpClient.get(playlistUrl);
      const data = response.data;
      const items = data?.items || [];

      // Map core path → console ID
      const consoleId = this.#resolveConsoleId(items[0]?.core_path);
      if (!consoleId) {
        this.#logger.warn?.('retroarch.sync.unknownCore', { playlist: playlist.name });
        continue;
      }

      games[consoleId] = items.map(item => ({
        id: this.#slugify(item.label),
        title: item.label,
        rom: item.path,
        thumbnail: `${consoleId}/${this.#slugify(item.label)}.png`,
        crc32: item.crc32
      }));

      totalGames += items.length;
      this.#logger.debug?.('retroarch.sync.playlistParsed', { consoleId, games: items.length });
    }

    // 3. Preserve existing overrides
    const existingCatalog = this.#readCatalog() || {};
    const overrides = existingCatalog.overrides || {};

    // 4. Write catalog
    const catalog = {
      sync: {
        last_synced: new Date().toISOString(),
        game_count: totalGames
      },
      games,
      overrides
    };

    this.#writeCatalog(catalog);
    this.#logger.info?.('retroarch.sync.complete', { totalGames });

    return { synced: totalGames, errors: 0 };
  }

  /** ISyncSource.getStatus() */
  async getStatus() {
    const catalog = this.#readCatalog();
    if (!catalog) return { lastSynced: null, itemCount: 0 };
    return {
      lastSynced: catalog.sync?.last_synced || null,
      itemCount: catalog.sync?.game_count || 0
    };
  }

  /**
   * Map a core library path to a console ID by matching against config
   * @private
   */
  #resolveConsoleId(corePath) {
    if (!corePath) return null;
    for (const [consoleId, cfg] of Object.entries(this.#consoleConfig)) {
      if (cfg.core === corePath) return consoleId;
    }
    return null;
  }

  /**
   * Generate URL-safe slug from title
   * @private
   */
  #slugify(title) {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }
}

export default RetroArchSyncAdapter;
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/suite/adapters/RetroArchSyncAdapter.test.mjs --no-coverage`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/content/retroarch/RetroArchSyncAdapter.mjs tests/unit/suite/adapters/RetroArchSyncAdapter.test.mjs
git commit -m "feat(adapter): add RetroArchSyncAdapter for X-plore catalog sync"
```

---

## Task 9: API — Launch and Sync Routes

**Files:**
- Create: `backend/src/4_api/v1/routers/launch.mjs`
- Create: `backend/src/4_api/v1/routers/sync.mjs`
- Test: `tests/unit/suite/api/launch.test.mjs`
- Test: `tests/unit/suite/api/sync.test.mjs`

**Step 1: Write failing tests**

```javascript
// tests/unit/suite/api/launch.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createLaunchRouter } from '#api/v1/routers/launch.mjs';

describe('POST /api/v1/launch', () => {
  let app;
  let mockLaunchService;

  beforeEach(() => {
    mockLaunchService = {
      launch: jest.fn().mockResolvedValue({
        success: true,
        contentId: 'retroarch:n64/mario-kart-64',
        targetDeviceId: 'shield-tv',
        title: 'Mario Kart 64'
      })
    };

    app = express();
    app.use(express.json());
    app.use('/api/v1/launch', createLaunchRouter({
      launchService: mockLaunchService,
      logger: { info: jest.fn(), error: jest.fn() }
    }));
  });

  it('returns 200 on successful launch', async () => {
    const res = await request(app)
      .post('/api/v1/launch')
      .send({ contentId: 'retroarch:n64/mario-kart-64', targetDeviceId: 'shield-tv' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.title).toBe('Mario Kart 64');
    expect(mockLaunchService.launch).toHaveBeenCalledWith({
      contentId: 'retroarch:n64/mario-kart-64',
      targetDeviceId: 'shield-tv'
    });
  });

  it('returns 400 when contentId missing', async () => {
    const res = await request(app)
      .post('/api/v1/launch')
      .send({ targetDeviceId: 'shield-tv' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when targetDeviceId missing', async () => {
    const res = await request(app)
      .post('/api/v1/launch')
      .send({ contentId: 'retroarch:n64/mario-kart-64' });

    expect(res.status).toBe(400);
  });
});
```

```javascript
// tests/unit/suite/api/sync.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createSyncRouter } from '#api/v1/routers/sync.mjs';

describe('Sync API', () => {
  let app;
  let mockSyncService;

  beforeEach(() => {
    mockSyncService = {
      sync: jest.fn().mockResolvedValue({ synced: 30, errors: 0 }),
      getStatus: jest.fn().mockResolvedValue({ lastSynced: '2026-02-23T10:00:00Z', itemCount: 30 })
    };

    app = express();
    app.use(express.json());
    app.use('/api/v1/sync', createSyncRouter({
      syncService: mockSyncService,
      logger: { info: jest.fn(), error: jest.fn() }
    }));
  });

  describe('POST /api/v1/sync/:source', () => {
    it('triggers sync and returns result', async () => {
      const res = await request(app).post('/api/v1/sync/retroarch');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ synced: 30, errors: 0 });
      expect(mockSyncService.sync).toHaveBeenCalledWith('retroarch');
    });
  });

  describe('GET /api/v1/sync/:source/status', () => {
    it('returns sync status', async () => {
      const res = await request(app).get('/api/v1/sync/retroarch/status');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ lastSynced: '2026-02-23T10:00:00Z', itemCount: 30 });
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/suite/api/launch.test.mjs tests/unit/suite/api/sync.test.mjs --no-coverage`
Expected: FAIL — modules not found

**Step 3: Write implementations**

```javascript
// backend/src/4_api/v1/routers/launch.mjs
import express from 'express';

/**
 * @param {Object} config
 * @param {import('#apps/content/services/LaunchService.mjs').LaunchService} config.launchService
 * @param {Object} [config.logger]
 */
export function createLaunchRouter(config) {
  const { launchService, logger = console } = config;
  const router = express.Router();

  router.post('/', async (req, res) => {
    const { contentId, targetDeviceId } = req.body;

    if (!contentId || !targetDeviceId) {
      return res.status(400).json({
        error: 'Missing required fields: contentId, targetDeviceId'
      });
    }

    try {
      const result = await launchService.launch({ contentId, targetDeviceId });
      res.json(result);
    } catch (error) {
      const status = error.name === 'ValidationError' ? 400
        : error.name === 'EntityNotFoundError' ? 404
        : 500;
      logger.error?.('launch.api.error', { contentId, targetDeviceId, error: error.message });
      res.status(status).json({ error: error.message });
    }
  });

  return router;
}
```

```javascript
// backend/src/4_api/v1/routers/sync.mjs
import express from 'express';

/**
 * @param {Object} config
 * @param {import('#apps/content/services/SyncService.mjs').SyncService} config.syncService
 * @param {Object} [config.logger]
 */
export function createSyncRouter(config) {
  const { syncService, logger = console } = config;
  const router = express.Router();

  router.post('/:source', async (req, res) => {
    const { source } = req.params;
    try {
      const result = await syncService.sync(source);
      res.json(result);
    } catch (error) {
      const status = error.name === 'EntityNotFoundError' ? 404 : 500;
      logger.error?.('sync.api.error', { source, error: error.message });
      res.status(status).json({ error: error.message });
    }
  });

  router.get('/:source/status', async (req, res) => {
    const { source } = req.params;
    try {
      const result = await syncService.getStatus(source);
      res.json(result);
    } catch (error) {
      const status = error.name === 'EntityNotFoundError' ? 404 : 500;
      logger.error?.('sync.api.statusError', { source, error: error.message });
      res.status(status).json({ error: error.message });
    }
  });

  return router;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/suite/api/launch.test.mjs tests/unit/suite/api/sync.test.mjs --no-coverage`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/launch.mjs backend/src/4_api/v1/routers/sync.mjs tests/unit/suite/api/launch.test.mjs tests/unit/suite/api/sync.test.mjs
git commit -m "feat(api): add launch and sync routes"
```

---

## Task 10: Backend Wiring — Normalizer, Bootstrap, Route Registration

**Files:**
- Modify: `backend/src/1_adapters/content/list/listConfigNormalizer.mjs` — add `launch` action
- Modify: `backend/src/0_system/bootstrap.mjs` — register RetroArchAdapter, AdbLauncher, SyncService
- Modify: API route registration file — mount launch + sync routers
- Test: Run existing normalizer tests + full unit suite

**Step 1: Add `launch` action to listConfigNormalizer.mjs**

In `normalizeListItem()`, add a case in the switch at line 67:

```javascript
      case 'launch':
        result.launch = { contentId: normalized };
        break;
```

In `extractContentId()`, add after the display line:

```javascript
    || item.launch?.contentId
```

In `extractActionName()`, add after the display check:

```javascript
  if (item.launch) return 'Launch';
```

In `normalizeListItem()` pass-through check (line 35), add `item.launch`:

```javascript
  if (!item.input && !item.label && (item.play || item.open || item.display || item.list || item.queue || item.launch)) {
```

In `denormalizeItem()` delete block (line 256-260), add:

```javascript
  delete result.launch;
```

**Step 2: Add RetroArchAdapter registration in bootstrap.mjs**

After the AppRegistryAdapter registration (~line 656), before the `return { registry, savedQueryService }`:

```javascript
  // Register RetroArchAdapter if config exists
  if (config.retroarch?.config && config.retroarch?.catalog) {
    const retroarchManifest = (await import('#adapters/content/retroarch/manifest.mjs')).default;
    const { RetroArchAdapter } = await import('#adapters/content/retroarch/RetroArchAdapter.mjs');
    registry.register(
      new RetroArchAdapter({
        config: config.retroarch.config,
        catalog: config.retroarch.catalog,
        logger: deps.logger
      }),
      { category: retroarchManifest.capability, provider: retroarchManifest.provider }
    );
  }
```

**Step 3: Mount routes in the API layer**

Find the file where routers are mounted (look for `app.use('/api/v1/...`). Add:

```javascript
import { createLaunchRouter } from './routers/launch.mjs';
import { createSyncRouter } from './routers/sync.mjs';

// After other route mounts:
app.use('/api/v1/launch', createLaunchRouter({ launchService, logger }));
app.use('/api/v1/sync', createSyncRouter({ syncService, logger }));
```

**Step 4: Run full unit test suite to verify nothing is broken**

Run: `node tests/unit/harness.mjs`
Expected: All existing tests still pass

**Step 5: Commit**

```bash
git add backend/src/1_adapters/content/list/listConfigNormalizer.mjs backend/src/0_system/bootstrap.mjs
git commit -m "feat(wiring): register RetroArch adapter, launch/sync routes, normalizer"
```

---

## Task 11: Frontend — LaunchCard Component

**Files:**
- Create: `frontend/src/modules/Menu/LaunchCard.jsx`
- Modify: `frontend/src/modules/Menu/MenuStack.jsx` — add `launch` dispatch + render case

**Step 1: Create LaunchCard**

```jsx
// frontend/src/modules/Menu/LaunchCard.jsx
import { useState, useEffect, useMemo } from 'react';
import getLogger from '../../lib/logging/Logger.js';
import './LaunchCard.scss';

const LaunchCard = ({ launch, title, thumbnail, metadata, onClose }) => {
  const logger = useMemo(() => getLogger().child({ component: 'LaunchCard' }), []);
  const [status, setStatus] = useState('launching'); // 'launching' | 'success' | 'error'
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    if (!launch?.contentId) return;

    logger.info('launch.initiated', { contentId: launch.contentId });

    const deviceId = launch.targetDeviceId || window.__DAYLIGHT_DEVICE_ID || 'default';

    fetch('/api/v1/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentId: launch.contentId, targetDeviceId: deviceId })
    })
      .then(res => {
        if (!res.ok) return res.json().then(d => Promise.reject(new Error(d.error || 'Launch failed')));
        return res.json();
      })
      .then(data => {
        logger.info('launch.success', { contentId: launch.contentId, title: data.title });
        setStatus('success');
      })
      .catch(err => {
        logger.error('launch.failed', { contentId: launch.contentId, error: err.message });
        setStatus('error');
        setErrorMsg(err.message);
      });
  }, [launch?.contentId]);

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
            <button onClick={() => { setStatus('launching'); setErrorMsg(null); }}>Retry</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default LaunchCard;
```

**Step 2: Add `launch` dispatch to MenuStack.jsx**

In `handleSelect` (around line 86, after the `open` branch):

```javascript
  } else if (selection.launch) {
    push({ type: 'launch', props: selection });
  }
```

In the render switch (around line 210, before `default`):

```javascript
  case 'launch':
    return (
      <Suspense fallback={<div>Loading...</div>}>
        <LaunchCard
          launch={props.launch}
          title={props.title}
          thumbnail={props.thumbnail || props.image}
          metadata={props.metadata}
          onClose={clear}
        />
      </Suspense>
    );
```

Add the lazy import at the top of MenuStack.jsx:

```javascript
const LaunchCard = lazy(() => import('./LaunchCard.jsx'));
```

**Step 3: Add `?launch=` URL param to TVApp.jsx**

In the `mappings` object (around line 140 in TVApp.jsx), add:

```javascript
    launch:    (value) => ({ launch: { contentId: toContentId(value) } }),
```

**Step 4: Manual verification**

Start dev server and verify:
- `?launch=retroarch:n64/mario-kart-64` shows LaunchCard
- Menu item with `launch` action dispatches correctly

**Step 5: Commit**

```bash
git add frontend/src/modules/Menu/LaunchCard.jsx frontend/src/modules/Menu/MenuStack.jsx frontend/src/Apps/TVApp.jsx
git commit -m "feat(frontend): add LaunchCard component and launch action dispatch"
```

---

## Task 12: Frontend — Admin Games Section

**Files:**
- Create: `frontend/src/modules/Admin/Games/GamesIndex.jsx`
- Create: `frontend/src/modules/Admin/Games/ConsoleDetail.jsx`
- Modify: `frontend/src/Apps/AdminApp.jsx` — add routes
- Modify: `frontend/src/modules/Admin/AdminNav.jsx` — add sidebar item
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx` — add Launch action + game type

**Step 1: Create GamesIndex**

```jsx
// frontend/src/modules/Admin/Games/GamesIndex.jsx
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Group, Text, Badge, Stack, Loader } from '@mantine/core';
import getLogger from '../../../lib/logging/Logger.js';

const GamesIndex = () => {
  const logger = useMemo(() => getLogger().child({ component: 'GamesIndex' }), []);
  const navigate = useNavigate();
  const [consoles, setConsoles] = useState([]);
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    logger.info('gamesIndex.mounted');
    Promise.all([
      fetch('/api/v1/list/retroarch').then(r => r.json()),
      fetch('/api/v1/sync/retroarch/status').then(r => r.json()).catch(() => null)
    ]).then(([list, status]) => {
      setConsoles(list?.items || list || []);
      setSyncStatus(status);
      setLoading(false);
    });
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    logger.info('admin.sync.triggered', { source: 'retroarch' });
    try {
      await fetch('/api/v1/sync/retroarch', { method: 'POST' });
      const status = await fetch('/api/v1/sync/retroarch/status').then(r => r.json());
      setSyncStatus(status);
      const list = await fetch('/api/v1/list/retroarch').then(r => r.json());
      setConsoles(list?.items || list || []);
      logger.info('admin.sync.complete');
    } catch (err) {
      logger.error('admin.sync.failed', { error: err.message });
    }
    setSyncing(false);
  };

  if (loading) return <Loader />;

  return (
    <Stack p="md">
      <Group justify="space-between">
        <Text size="xl" fw={700}>Games</Text>
        <Group>
          {syncStatus && (
            <Text size="sm" c="dimmed">
              {syncStatus.itemCount} games · Last synced {syncStatus.lastSynced ? new Date(syncStatus.lastSynced).toLocaleString() : 'never'}
            </Text>
          )}
          <Button onClick={handleSync} loading={syncing}>Sync from Device</Button>
        </Group>
      </Group>

      {consoles.map(c => (
        <Card key={c.id} padding="sm" withBorder onClick={() => navigate(`/admin/content/games/${c.localId || c.id?.split(':')[1]}`)} style={{ cursor: 'pointer' }}>
          <Group justify="space-between">
            <Text fw={500}>{c.title}</Text>
            <Badge>{c.metadata?.gameCount || 0} games</Badge>
          </Group>
        </Card>
      ))}
    </Stack>
  );
};

export default GamesIndex;
```

**Step 2: Create ConsoleDetail**

```jsx
// frontend/src/modules/Admin/Games/ConsoleDetail.jsx
import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { SimpleGrid, Card, Image, Text, Stack, Loader } from '@mantine/core';
import getLogger from '../../../lib/logging/Logger.js';

const ConsoleDetail = () => {
  const logger = useMemo(() => getLogger().child({ component: 'ConsoleDetail' }), []);
  const { consoleId } = useParams();
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    logger.info('consoleDetail.mounted', { consoleId });
    fetch(`/api/v1/list/retroarch:${consoleId}`)
      .then(r => r.json())
      .then(data => {
        setGames(data?.items || data || []);
        setLoading(false);
      });
  }, [consoleId]);

  if (loading) return <Loader />;

  return (
    <Stack p="md">
      <Text size="xl" fw={700}>{games[0]?.metadata?.parentTitle || consoleId}</Text>
      <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 5 }} spacing="md">
        {games.map(game => (
          <Card key={game.id} padding="xs" withBorder>
            {game.thumbnail && <Image src={game.thumbnail} alt={game.title} height={160} fit="contain" />}
            <Text size="sm" ta="center" mt={4}>{game.title}</Text>
          </Card>
        ))}
      </SimpleGrid>
    </Stack>
  );
};

export default ConsoleDetail;
```

**Step 3: Add routes to AdminApp.jsx**

Add lazy imports at the top:

```javascript
const GamesIndex = lazy(() => import('../modules/Admin/Games/GamesIndex.jsx'));
const ConsoleDetail = lazy(() => import('../modules/Admin/Games/ConsoleDetail.jsx'));
```

Add routes inside `<Route element={<AdminLayout />}>` block:

```jsx
<Route path="content/games" element={<GamesIndex />} />
<Route path="content/games/:consoleId" element={<ConsoleDetail />} />
```

**Step 4: Add "Games" to AdminNav.jsx sidebar**

In the `CONTENT` section of `navSections`, add:

```javascript
{ label: 'Games', icon: IconDeviceGamepad2, to: '/admin/content/games' },
```

Add `IconDeviceGamepad2` to the Tabler icons import.

**Step 5: Add Launch action to ListsItemRow.jsx**

In `ACTION_OPTIONS` array, add:

```javascript
{ value: 'Launch', label: 'Launch' },
```

In `TYPE_ICONS`, add:

```javascript
game: IconDeviceGamepad2,
```

In `CONTAINER_TYPES` array, add `'console'`.

**Step 6: Commit**

```bash
git add frontend/src/modules/Admin/Games/ frontend/src/Apps/AdminApp.jsx frontend/src/modules/Admin/AdminNav.jsx frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "feat(admin): add Games section with sync and console browsing"
```

---

## Task 13: Config Files and Data Setup

**Files:**
- Create: `data/household/apps/retroarch/config.yml` — initial config template
- Create: Placeholder `data/household/shared/retroarch/catalog.yml`
- Create: Placeholder `data/household/shared/retroarch/thumbnails/.gitkeep`

**Step 1: Create config.yml**

Write `data/household/apps/retroarch/config.yml` with the structure from the design doc. Refer to the design doc for exact content — use the actual Shield TV IP, ports, and console-to-core mappings from the "Existing Games on Device" reference table.

**Step 2: Create empty catalog.yml**

```yaml
# data/household/shared/retroarch/catalog.yml
# Populated by sync from X-plore. Do not edit manually (except overrides).
sync:
  last_synced: null
  game_count: 0
games: {}
overrides: {}
```

**Step 3: Create thumbnails directory**

```bash
mkdir -p data/household/shared/retroarch/thumbnails
touch data/household/shared/retroarch/thumbnails/.gitkeep
```

**Step 4: Commit**

```bash
git add data/household/apps/retroarch/config.yml data/household/shared/retroarch/
git commit -m "feat(config): add RetroArch config and catalog scaffolding"
```

---

## Task 14: Run Full Test Suite and Verify

**Step 1: Run unit tests**

Run: `node tests/unit/harness.mjs`
Expected: All tests pass (including new tests from tasks 1-9)

**Step 2: Start dev server and smoke test**

Run: `npm run dev`

Manual checks:
- `GET /api/v1/list/retroarch` returns console list (or empty if no catalog yet)
- `GET /api/v1/sync/retroarch/status` returns status
- `POST /api/v1/sync/retroarch` triggers sync (will fail if X-plore unreachable — that's expected in dev)
- Admin UI at `/admin/content/games` loads
- TV UI with `?launch=retroarch:n64/mario-kart-64` shows LaunchCard

**Step 3: Commit any fixes**

Fix anything that broke during integration. Commit with descriptive message.

---

## Task 15: Create LaunchCard SCSS + Arcade Grid CSS

**Files:**
- Create: `frontend/src/modules/Menu/LaunchCard.scss`
- Modify: TVMenu CSS — add `arcade` menuStyle variant

**Step 1: Create LaunchCard.scss**

Style the launch overlay: centered boxart, title, console name, spinner/status. Full-screen dark overlay matching the TV app aesthetic.

**Step 2: Add arcade grid variant to TVMenu CSS**

When list metadata includes `menuStyle: 'arcade'`, apply a responsive grid layout with large boxart tiles instead of the default vertical list. Use CSS class `.tv-menu--arcade`.

**Step 3: Commit**

```bash
git add frontend/src/modules/Menu/LaunchCard.scss frontend/src/modules/Menu/TVMenu*.scss
git commit -m "feat(ui): add LaunchCard overlay and arcade grid CSS"
```

---

## Task 16: Documentation

**Files:**
- Create: `docs/reference/integrations/retroarch.md`
- Move design doc from WIP to archive: `docs/_wip/plans/2026-02-23-launchable-content-design.md` → `docs/_archive/`

**Step 1: Write integration reference**

Document the RetroArch integration: config structure, sync process, content ID scheme, ADB launch flow, troubleshooting. Reference the config and catalog file locations.

**Step 2: Archive design doc**

```bash
mv docs/_wip/plans/2026-02-23-launchable-content-design.md docs/_archive/2026-02-23-launchable-content-design.md
```

**Step 3: Commit**

```bash
git add docs/reference/integrations/retroarch.md docs/_archive/2026-02-23-launchable-content-design.md
git rm docs/_wip/plans/2026-02-23-launchable-content-design.md
git commit -m "docs: add RetroArch integration reference, archive design doc"
```
