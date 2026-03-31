# Barcode Control Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the barcode pipeline to support playback control commands (pause, next, volume, etc.) via scanned barcode cards.

**Architecture:** Add command detection to `BarcodePayload` parser (checked before content parsing for 1-3 segment barcodes). A new `BarcodeCommandMap` maps command names to WS payloads. `BarcodeScanService` branches on payload type — commands skip the gatekeeper and broadcast directly. Frontend gets handlers for `shader`, `volume`, `rate`, and `sleep` WS keys.

**Tech Stack:** Node.js (ES modules), Jest, React hooks

**Spec:** `docs/superpowers/specs/2026-03-30-barcode-control-commands-design.md`

---

## File Structure

| Layer | File | Change | Responsibility |
|-------|------|--------|----------------|
| Domain | `backend/src/2_domains/barcode/BarcodePayload.mjs` | Modify | Add `type`, `command`, `commandArg` fields; command parsing before content |
| Domain | `backend/src/2_domains/barcode/BarcodeCommandMap.mjs` | Create | Command → WS payload map, `KNOWN_COMMANDS` export |
| Application | `backend/src/3_applications/barcode/BarcodeScanService.mjs` | Modify | Branch on payload.type; command path skips gatekeeper |
| Adapter | `backend/src/1_adapters/hardware/mqtt-barcode/MQTTBarcodeAdapter.mjs` | Modify | Pass `knownCommands` to `BarcodePayload.parse()` |
| Frontend | `frontend/src/screen-framework/commands/useScreenCommands.js` | Modify | Add shader/volume/rate/sleep handlers |
| System | `backend/src/0_system/bootstrap.mjs` | Modify | Import `KNOWN_COMMANDS`, pass to adapter config |
| System | `backend/src/app.mjs` | Modify | Pass `knownCommands` in barcode config |
| Test | `tests/isolated/domain/barcode/BarcodePayload.test.mjs` | Modify | Add command parsing tests |
| Test | `tests/isolated/domain/barcode/BarcodeCommandMap.test.mjs` | Create | Command map tests |
| Test | `tests/isolated/assembly/barcode/BarcodeScanService.test.mjs` | Modify | Add command handling tests |

---

### Task 1: BarcodeCommandMap

**Files:**
- Create: `backend/src/2_domains/barcode/BarcodeCommandMap.mjs`
- Create: `tests/isolated/domain/barcode/BarcodeCommandMap.test.mjs`

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/isolated/domain/barcode/BarcodeCommandMap.test.mjs
import { describe, it, expect } from '@jest/globals';
import { COMMAND_MAP, KNOWN_COMMANDS, resolveCommand } from '#domains/barcode/BarcodeCommandMap.mjs';

describe('BarcodeCommandMap', () => {
  describe('KNOWN_COMMANDS', () => {
    it('contains all command names', () => {
      expect(KNOWN_COMMANDS).toContain('pause');
      expect(KNOWN_COMMANDS).toContain('play');
      expect(KNOWN_COMMANDS).toContain('next');
      expect(KNOWN_COMMANDS).toContain('prev');
      expect(KNOWN_COMMANDS).toContain('ffw');
      expect(KNOWN_COMMANDS).toContain('rew');
      expect(KNOWN_COMMANDS).toContain('stop');
      expect(KNOWN_COMMANDS).toContain('off');
      expect(KNOWN_COMMANDS).toContain('blackout');
      expect(KNOWN_COMMANDS).toContain('volume');
      expect(KNOWN_COMMANDS).toContain('speed');
    });

    it('is derived from COMMAND_MAP keys', () => {
      expect(KNOWN_COMMANDS).toEqual(Object.keys(COMMAND_MAP));
    });
  });

  describe('resolveCommand', () => {
    it('resolves simple playback commands', () => {
      expect(resolveCommand('pause')).toEqual({ playback: 'pause' });
      expect(resolveCommand('play')).toEqual({ playback: 'play' });
      expect(resolveCommand('next')).toEqual({ playback: 'next' });
      expect(resolveCommand('prev')).toEqual({ playback: 'prev' });
      expect(resolveCommand('ffw')).toEqual({ playback: 'fwd' });
      expect(resolveCommand('rew')).toEqual({ playback: 'rew' });
    });

    it('resolves action commands', () => {
      expect(resolveCommand('stop')).toEqual({ action: 'reset' });
      expect(resolveCommand('off')).toEqual({ action: 'sleep' });
    });

    it('resolves display commands', () => {
      expect(resolveCommand('blackout')).toEqual({ shader: 'blackout' });
    });

    it('resolves parameterized commands', () => {
      expect(resolveCommand('volume', '30')).toEqual({ volume: 30 });
      expect(resolveCommand('speed', '1.5')).toEqual({ rate: 1.5 });
    });

    it('returns null for unknown commands', () => {
      expect(resolveCommand('unknown')).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/isolated/domain/barcode/BarcodeCommandMap.test.mjs --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```javascript
// backend/src/2_domains/barcode/BarcodeCommandMap.mjs

/**
 * BarcodeCommandMap - Maps barcode command names to WebSocket broadcast payloads.
 *
 * Each entry is a function that accepts an optional argument and returns
 * the WS payload to broadcast. Parameterized commands (volume, speed)
 * use the argument; simple commands ignore it.
 *
 * @module domains/barcode/BarcodeCommandMap
 */

export const COMMAND_MAP = {
  pause:    () => ({ playback: 'pause' }),
  play:     () => ({ playback: 'play' }),
  next:     () => ({ playback: 'next' }),
  prev:     () => ({ playback: 'prev' }),
  ffw:      () => ({ playback: 'fwd' }),
  rew:      () => ({ playback: 'rew' }),
  stop:     () => ({ action: 'reset' }),
  off:      () => ({ action: 'sleep' }),
  blackout: () => ({ shader: 'blackout' }),
  volume:   (arg) => ({ volume: Number(arg) }),
  speed:    (arg) => ({ rate: Number(arg) }),
};

/**
 * All known command names, derived from COMMAND_MAP.
 * @type {string[]}
 */
export const KNOWN_COMMANDS = Object.keys(COMMAND_MAP);

/**
 * Resolve a command name and optional argument to a WS payload.
 * @param {string} command - Command name
 * @param {string} [arg] - Optional argument (e.g. '30' for volume)
 * @returns {Object|null} WS payload, or null if command unknown
 */
export function resolveCommand(command, arg) {
  const factory = COMMAND_MAP[command];
  if (!factory) return null;
  return factory(arg);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/isolated/domain/barcode/BarcodeCommandMap.test.mjs --no-coverage`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/barcode/BarcodeCommandMap.mjs tests/isolated/domain/barcode/BarcodeCommandMap.test.mjs
git commit -m "feat(barcode): add BarcodeCommandMap for control command payloads"
```

---

### Task 2: BarcodePayload — add command parsing

**Files:**
- Modify: `backend/src/2_domains/barcode/BarcodePayload.mjs`
- Modify: `tests/isolated/domain/barcode/BarcodePayload.test.mjs`

- [ ] **Step 1: Add command parsing tests**

Add a new `describe('command barcodes')` block to the existing test file, after the `delimiter normalization` describe:

```javascript
  describe('command barcodes', () => {
    const KNOWN_COMMANDS = ['pause', 'play', 'next', 'prev', 'ffw', 'rew', 'stop', 'off', 'blackout', 'volume', 'speed'];

    it('parses a bare command (1 segment)', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'pause', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS, KNOWN_COMMANDS
      );
      expect(payload.type).toBe('command');
      expect(payload.command).toBe('pause');
      expect(payload.commandArg).toBeNull();
      expect(payload.targetScreen).toBeNull();
      expect(payload.contentId).toBeNull();
    });

    it('parses screen:command (2 segments, second is command)', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'office:pause', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS, KNOWN_COMMANDS
      );
      expect(payload.type).toBe('command');
      expect(payload.command).toBe('pause');
      expect(payload.targetScreen).toBe('office');
      expect(payload.commandArg).toBeNull();
    });

    it('parses command:arg (2 segments, first is command)', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'volume:30', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS, KNOWN_COMMANDS
      );
      expect(payload.type).toBe('command');
      expect(payload.command).toBe('volume');
      expect(payload.commandArg).toBe('30');
      expect(payload.targetScreen).toBeNull();
    });

    it('parses screen:command:arg (3 segments)', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'office:volume:30', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS, KNOWN_COMMANDS
      );
      expect(payload.type).toBe('command');
      expect(payload.command).toBe('volume');
      expect(payload.commandArg).toBe('30');
      expect(payload.targetScreen).toBe('office');
    });

    it('parses semicolon-delimited commands', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'office;pause', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS, KNOWN_COMMANDS
      );
      expect(payload.type).toBe('command');
      expect(payload.command).toBe('pause');
      expect(payload.targetScreen).toBe('office');
    });

    it('falls through to content for 4+ segments even if play is a command', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'office:play:plex:12345', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS, KNOWN_COMMANDS
      );
      expect(payload.type).toBe('content');
      expect(payload.contentId).toBe('plex:12345');
      expect(payload.action).toBe('play');
      expect(payload.targetScreen).toBe('office');
    });

    it('preserves dashes in screen names for commands', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'living-room;blackout', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS, KNOWN_COMMANDS
      );
      expect(payload.type).toBe('command');
      expect(payload.command).toBe('blackout');
      expect(payload.targetScreen).toBe('living-room');
    });
  });
```

- [ ] **Step 2: Run tests to verify new tests fail (old tests should still pass)**

Run: `npx jest tests/isolated/domain/barcode/BarcodePayload.test.mjs --no-coverage`
Expected: New command tests FAIL (no `type`/`command`/`commandArg` properties), old tests still pass

- [ ] **Step 3: Update BarcodePayload implementation**

Replace the entire file `backend/src/2_domains/barcode/BarcodePayload.mjs`:

```javascript
/**
 * BarcodePayload - Value object for parsed barcode scan data.
 *
 * Supports two barcode types:
 *
 * **Command barcodes** (1-3 segments, checked first):
 *   command                      → bare command (e.g. pause)
 *   command:arg                  → parameterized command (e.g. volume:30)
 *   screen:command               → command on specific screen
 *   screen:command:arg           → parameterized command on specific screen
 *
 * **Content barcodes** (2-4 segments, checked if no command match):
 *   source:id                    → contentId only
 *   action:source:id             → action + contentId
 *   screen:source:id             → screen + contentId
 *   screen:action:source:id      → screen + action + contentId
 *
 * Delimiters are forgiving — colon, semicolon, or space all work.
 * Dashes are NOT treated as delimiters (they appear in screen names like `living-room`).
 *
 * Commands are detected by checking segments against a knownCommands list.
 * Barcodes with 4+ segments skip command detection entirely.
 *
 * @module domains/barcode/BarcodePayload
 */
export class BarcodePayload {
  #type;
  #contentId;
  #action;
  #command;
  #commandArg;
  #targetScreen;
  #device;
  #timestamp;

  constructor({ type, contentId, action, command, commandArg, targetScreen, device, timestamp }) {
    this.#type = type;
    this.#contentId = contentId;
    this.#action = action;
    this.#command = command;
    this.#commandArg = commandArg;
    this.#targetScreen = targetScreen;
    this.#device = device;
    this.#timestamp = timestamp;
  }

  get type() { return this.#type; }
  get contentId() { return this.#contentId; }
  get action() { return this.#action; }
  get command() { return this.#command; }
  get commandArg() { return this.#commandArg; }
  get targetScreen() { return this.#targetScreen; }
  get device() { return this.#device; }
  get timestamp() { return this.#timestamp; }

  /**
   * Parse an MQTT barcode message into a BarcodePayload.
   * @param {Object} message - Raw MQTT message { barcode, timestamp, device }
   * @param {string[]} knownActions - Valid action names for content barcodes
   * @param {string[]} knownCommands - Valid command names for control barcodes
   * @returns {BarcodePayload|null} Parsed payload, or null if invalid
   */
  static parse(message, knownActions = [], knownCommands = []) {
    const { barcode, timestamp, device } = message || {};

    if (!barcode || !device) return null;

    // Normalize delimiters: semicolons and spaces become colons
    const normalized = barcode.replace(/[; ]/g, ':');
    const segments = normalized.split(':');

    const common = { device, timestamp: timestamp || null };

    // ── Command detection (1-3 segments only) ──────────────────────
    if (segments.length <= 3 && knownCommands.length > 0) {
      const cmdResult = BarcodePayload.#parseCommand(segments, knownCommands);
      if (cmdResult) {
        return new BarcodePayload({
          type: 'command',
          contentId: null,
          action: null,
          command: cmdResult.command,
          commandArg: cmdResult.arg,
          targetScreen: cmdResult.screen,
          ...common,
        });
      }
    }

    // ── Content parsing (2-4 segments) ─────────────────────────────
    if (segments.length < 2) return null;

    const contentId = segments.slice(-2).join(':');
    const prefixes = segments.slice(0, -2);

    let action = null;
    let targetScreen = null;

    if (prefixes.length === 1) {
      if (knownActions.includes(prefixes[0])) {
        action = prefixes[0];
      } else {
        targetScreen = prefixes[0];
      }
    } else if (prefixes.length === 2) {
      targetScreen = prefixes[0];
      action = prefixes[1];
    } else if (prefixes.length > 2) {
      return null;
    }

    return new BarcodePayload({
      type: 'content',
      contentId,
      action,
      command: null,
      commandArg: null,
      targetScreen,
      ...common,
    });
  }

  /**
   * Try to parse segments as a command barcode.
   * @param {string[]} segments
   * @param {string[]} knownCommands
   * @returns {{command: string, arg: string|null, screen: string|null}|null}
   */
  static #parseCommand(segments, knownCommands) {
    if (segments.length === 1) {
      // "pause"
      if (knownCommands.includes(segments[0])) {
        return { command: segments[0], arg: null, screen: null };
      }
    } else if (segments.length === 2) {
      // "volume:30" (command:arg) or "office:pause" (screen:command)
      if (knownCommands.includes(segments[0])) {
        return { command: segments[0], arg: segments[1], screen: null };
      }
      if (knownCommands.includes(segments[1])) {
        return { command: segments[1], arg: null, screen: segments[0] };
      }
    } else if (segments.length === 3) {
      // "office:volume:30" (screen:command:arg)
      if (knownCommands.includes(segments[1])) {
        return { command: segments[1], arg: segments[2], screen: segments[0] };
      }
    }
    return null;
  }

  toJSON() {
    return {
      type: this.#type,
      contentId: this.#contentId,
      action: this.#action,
      command: this.#command,
      commandArg: this.#commandArg,
      targetScreen: this.#targetScreen,
      device: this.#device,
      timestamp: this.#timestamp,
    };
  }
}
```

- [ ] **Step 4: Update existing content tests to expect `type: 'content'`**

The existing tests don't assert on `type`. Add `expect(payload.type).toBe('content')` to the first test in the `two-segment barcode` describe block. The other content tests don't need updating — they'll pass because the new fields are additive. But update the `toJSON` test to include the new fields:

Find the existing toJSON test and update the expected object:

```javascript
    it('serializes all fields', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'office:queue:plex:12345', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS
      );
      expect(payload.toJSON()).toEqual({
        type: 'content',
        contentId: 'plex:12345',
        action: 'queue',
        command: null,
        commandArg: null,
        targetScreen: 'office',
        device: 'scanner-1',
        timestamp: '2026-03-30T01:00:00Z',
      });
    });
```

- [ ] **Step 5: Run all tests to verify they pass**

Run: `npx jest tests/isolated/domain/barcode/BarcodePayload.test.mjs --no-coverage`
Expected: All tests PASS (15 existing + 7 new = 22)

- [ ] **Step 6: Commit**

```bash
git add backend/src/2_domains/barcode/BarcodePayload.mjs tests/isolated/domain/barcode/BarcodePayload.test.mjs
git commit -m "feat(barcode): add command parsing to BarcodePayload"
```

---

### Task 3: BarcodeScanService — command handling

**Files:**
- Modify: `backend/src/3_applications/barcode/BarcodeScanService.mjs`
- Modify: `tests/isolated/assembly/barcode/BarcodeScanService.test.mjs`

- [ ] **Step 1: Add command handling tests**

Add to the existing test file. Import `resolveCommand` and add a new describe block after the `unknown device` block:

Add this import at the top:

```javascript
import { resolveCommand } from '#domains/barcode/BarcodeCommandMap.mjs';
```

Update `makePayload` to accept knownCommands:

```javascript
const KNOWN_COMMANDS = ['pause', 'play', 'next', 'prev', 'ffw', 'rew', 'stop', 'off', 'blackout', 'volume', 'speed'];

function makePayload(barcode, device = 'scanner-1') {
  return BarcodePayload.parse(
    { barcode, timestamp: '2026-03-30T01:00:00Z', device },
    KNOWN_ACTIONS, KNOWN_COMMANDS
  );
}
```

Update `createService` to include `commandResolver`:

```javascript
  function createService(overrides = {}) {
    return new BarcodeScanService({
      gatekeeper: overrides.gatekeeper || gatekeeper,
      deviceConfig: overrides.deviceConfig || deviceConfig,
      broadcastEvent: overrides.broadcastEvent || broadcastEvent,
      pipelineConfig: overrides.pipelineConfig || pipelineConfig,
      commandResolver: overrides.commandResolver || resolveCommand,
      logger,
    });
  }
```

Add new test block:

```javascript
  describe('handle — command barcodes', () => {
    it('broadcasts playback command to default screen', async () => {
      const service = createService();
      await service.handle(makePayload('pause'));

      expect(broadcastEvent).toHaveBeenCalledWith('office', {
        playback: 'pause',
        source: 'barcode',
        device: 'scanner-1',
      });
    });

    it('broadcasts command to barcode-specified screen', async () => {
      const service = createService();
      await service.handle(makePayload('office:pause'));

      expect(broadcastEvent).toHaveBeenCalledWith('office', {
        playback: 'pause',
        source: 'barcode',
        device: 'scanner-1',
      });
    });

    it('broadcasts parameterized command', async () => {
      const service = createService();
      await service.handle(makePayload('volume:30'));

      expect(broadcastEvent).toHaveBeenCalledWith('office', {
        volume: 30,
        source: 'barcode',
        device: 'scanner-1',
      });
    });

    it('broadcasts screen:command:arg', async () => {
      const service = createService();
      await service.handle(makePayload('office:speed:1.5'));

      expect(broadcastEvent).toHaveBeenCalledWith('office', {
        rate: 1.5,
        source: 'barcode',
        device: 'scanner-1',
      });
    });

    it('skips gatekeeper for commands', async () => {
      const denyGatekeeper = new BarcodeGatekeeper([
        async () => ({ approved: false, reason: 'deny all' }),
      ]);
      const service = createService({ gatekeeper: denyGatekeeper });
      await service.handle(makePayload('pause'));

      // Command still broadcasts despite deny-all gatekeeper
      expect(broadcastEvent).toHaveBeenCalled();
    });

    it('logs warning for unknown commands', async () => {
      // Force a command-type payload with an unknown command by using a custom resolver
      const service = createService({
        commandResolver: () => null,
      });
      await service.handle(makePayload('pause'));

      expect(broadcastEvent).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'barcode.unknownCommand',
        expect.objectContaining({ command: 'pause' })
      );
    });
  });
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `npx jest tests/isolated/assembly/barcode/BarcodeScanService.test.mjs --no-coverage`
Expected: New command tests FAIL, existing tests may also fail due to `makePayload` change

- [ ] **Step 3: Update BarcodeScanService implementation**

Replace the entire file `backend/src/3_applications/barcode/BarcodeScanService.mjs`:

```javascript
/**
 * BarcodeScanService - Orchestrates barcode scan → gatekeeper → screen broadcast.
 *
 * Handles two payload types:
 * - **content**: resolve screen/action → gatekeeper → broadcast contentId
 * - **command**: resolve screen → look up command map → broadcast (skip gatekeeper)
 *
 * @module applications/barcode/BarcodeScanService
 */
export class BarcodeScanService {
  #gatekeeper;
  #deviceConfig;
  #broadcastEvent;
  #pipelineConfig;
  #commandResolver;
  #logger;

  /**
   * @param {Object} deps
   * @param {import('#domains/barcode/BarcodeGatekeeper.mjs').BarcodeGatekeeper} deps.gatekeeper
   * @param {Object} deps.deviceConfig - Scanner device entries keyed by device ID
   * @param {Function} deps.broadcastEvent - (topic, payload) => void
   * @param {Object} deps.pipelineConfig - { default_action, actions }
   * @param {Function} deps.commandResolver - (command, arg) => wsPayload|null
   * @param {Object} [deps.logger]
   */
  constructor(deps) {
    this.#gatekeeper = deps.gatekeeper;
    this.#deviceConfig = deps.deviceConfig;
    this.#broadcastEvent = deps.broadcastEvent;
    this.#pipelineConfig = deps.pipelineConfig;
    this.#commandResolver = deps.commandResolver;
    this.#logger = deps.logger || console;
  }

  /**
   * Handle a parsed barcode scan.
   * @param {import('#domains/barcode/BarcodePayload.mjs').BarcodePayload} payload
   */
  async handle(payload) {
    const device = payload.device;
    const scannerConfig = this.#deviceConfig[device];

    if (!scannerConfig) {
      this.#logger.warn?.('barcode.unknownDevice', { device });
      return;
    }

    const targetScreen = payload.targetScreen || scannerConfig.target_screen;

    if (payload.type === 'command') {
      return this.#handleCommand(payload, targetScreen);
    }

    return this.#handleContent(payload, targetScreen, scannerConfig);
  }

  #handleCommand(payload, targetScreen) {
    const wsPayload = this.#commandResolver(payload.command, payload.commandArg);

    if (!wsPayload) {
      this.#logger.warn?.('barcode.unknownCommand', {
        command: payload.command,
        device: payload.device,
      });
      return;
    }

    this.#logger.info?.('barcode.command', {
      command: payload.command,
      commandArg: payload.commandArg,
      targetScreen,
      device: payload.device,
    });

    this.#broadcastEvent(targetScreen, {
      ...wsPayload,
      source: 'barcode',
      device: payload.device,
    });
  }

  async #handleContent(payload, targetScreen, scannerConfig) {
    const action = payload.action || this.#pipelineConfig.default_action;
    const policyGroup = scannerConfig.policy_group || 'default';

    const scanContext = {
      contentId: payload.contentId,
      targetScreen,
      action,
      device: payload.device,
      timestamp: payload.timestamp,
      policyGroup,
    };

    const result = await this.#gatekeeper.evaluate(scanContext);

    if (!result.approved) {
      this.#logger.info?.('barcode.denied', {
        contentId: payload.contentId,
        device: payload.device,
        reason: result.reason,
      });
      return;
    }

    this.#logger.info?.('barcode.approved', {
      contentId: payload.contentId,
      targetScreen,
      action,
      device: payload.device,
    });

    this.#broadcastEvent(targetScreen, {
      action,
      contentId: payload.contentId,
      source: 'barcode',
      device: payload.device,
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/isolated/assembly/barcode/BarcodeScanService.test.mjs --no-coverage`
Expected: All 12 tests PASS (6 existing + 6 new)

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/barcode/BarcodeScanService.mjs tests/isolated/assembly/barcode/BarcodeScanService.test.mjs
git commit -m "feat(barcode): add command handling to BarcodeScanService"
```

---

### Task 4: MQTTBarcodeAdapter — pass knownCommands

**Files:**
- Modify: `backend/src/1_adapters/hardware/mqtt-barcode/MQTTBarcodeAdapter.mjs`
- Modify: `tests/isolated/assembly/adapters/barcode/MQTTBarcodeAdapter.test.mjs`

- [ ] **Step 1: Update the adapter**

In `MQTTBarcodeAdapter.mjs`, add a `#knownCommands` private field. In the constructor, add:

```javascript
this.#knownCommands = options.knownCommands || [];
```

In the `#connectToBroker` method's `message` handler, change line 200:

```javascript
// Before:
const payload = BarcodePayload.parse(data, this.#knownActions);

// After:
const payload = BarcodePayload.parse(data, this.#knownActions, this.#knownCommands);
```

Update the scan log to include command info:

```javascript
this.#logger.info?.('barcode.mqtt.scan', {
  type: payload.type,
  contentId: payload.contentId,
  command: payload.command,
  action: payload.action,
  targetScreen: payload.targetScreen,
  device: payload.device,
});
```

- [ ] **Step 2: Update adapter tests**

Add a test to the existing `constructor` describe block:

```javascript
    it('accepts knownCommands option', () => {
      const adapter = new MQTTBarcodeAdapter(
        { host: 'mosquitto', topic: 'daylight/scanner/barcode' },
        { knownActions: KNOWN_ACTIONS, knownCommands: ['pause', 'volume'], logger }
      );
      expect(adapter.isConfigured()).toBe(true);
    });
```

- [ ] **Step 3: Run tests**

Run: `npx jest tests/isolated/assembly/adapters/barcode/MQTTBarcodeAdapter.test.mjs --no-coverage`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add backend/src/1_adapters/hardware/mqtt-barcode/MQTTBarcodeAdapter.mjs tests/isolated/assembly/adapters/barcode/MQTTBarcodeAdapter.test.mjs
git commit -m "feat(barcode): pass knownCommands through MQTTBarcodeAdapter"
```

---

### Task 5: Frontend — useScreenCommands new handlers

**Files:**
- Modify: `frontend/src/screen-framework/commands/useScreenCommands.js`

- [ ] **Step 1: Read the current file**

Read `frontend/src/screen-framework/commands/useScreenCommands.js` to confirm current state.

- [ ] **Step 2: Add new handlers**

After the `// Playback control` block (after the `if (data.playback)` handler, before the `// Barcode scan` block), add:

```javascript
    // Shader control
    if (data.shader) {
      logger().info('commands.shader', { shader: data.shader });
      bus.emit('display:shader', { shader: data.shader });
      return;
    }

    // Volume control
    if (data.volume != null) {
      logger().info('commands.volume', { level: data.volume });
      bus.emit('display:volume', { level: data.volume });
      return;
    }

    // Playback rate
    if (data.rate != null) {
      logger().info('commands.rate', { rate: data.rate });
      bus.emit('media:rate', { rate: data.rate });
      return;
    }
```

Add sleep handling by updating the existing `action` checks. After the `action === 'reload'` block, add:

```javascript
    // Sleep (display off)
    if (data.action === 'sleep') {
      logger().info('commands.sleep');
      bus.emit('display:sleep', {});
      return;
    }
```

- [ ] **Step 3: Update the WS filter predicate**

Add `msg.shader`, `msg.volume != null`, `msg.rate != null` to the filter:

```javascript
    ? (msg) => !!(msg.menu || msg.action || msg.playback || msg.play || msg.queue
        || msg.plex || msg.contentId || msg.hymn || msg.scripture || msg.talk
        || msg.primary || msg.media || msg.playlist || msg.files || msg.poem
        || msg.source === 'barcode'
        || msg.shader || msg.volume != null || msg.rate != null)
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/screen-framework/commands/useScreenCommands.js
git commit -m "feat(barcode): add shader, volume, rate, sleep handlers to useScreenCommands"
```

---

### Task 6: Bootstrap wiring — pass knownCommands and commandResolver

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs`
- Modify: `backend/src/app.mjs`

- [ ] **Step 1: Update bootstrap.mjs**

Add import near the other barcode imports:

```javascript
import { KNOWN_COMMANDS } from '#domains/barcode/BarcodeCommandMap.mjs';
```

In `createHardwareAdapters()`, update the barcodeAdapter creation to pass `knownCommands`:

Find:
```javascript
      {
        knownActions: config.barcode.knownActions || [],
        onScan: config.onBarcodeScan,
        logger,
      }
```

Change to:
```javascript
      {
        knownActions: config.barcode.knownActions || [],
        knownCommands: config.barcode.knownCommands || [],
        onScan: config.onBarcodeScan,
        logger,
      }
```

- [ ] **Step 2: Update app.mjs**

Add import:

```javascript
import { KNOWN_COMMANDS, resolveCommand } from '#domains/barcode/BarcodeCommandMap.mjs';
```

Note: `resolveCommand` is imported from the domain module, not defined in app.mjs. Check how other domain imports look in app.mjs and use `#domains/barcode/BarcodeCommandMap.mjs`.

In the `createHardwareAdapters()` call, add `knownCommands` to the barcode config block:

```javascript
    barcode: {
      host: mqtt.host,
      port: mqtt.port || 1883,
      topic: (configService.getHouseholdAppConfig(householdId, 'barcode') || {}).topic || 'daylight/scanner/barcode',
      knownActions: (configService.getHouseholdAppConfig(householdId, 'barcode') || {}).actions || ['queue', 'play', 'open'],
      knownCommands: KNOWN_COMMANDS,
    },
```

In the barcode initialization block, add `commandResolver` to the `BarcodeScanService` constructor:

Find:
```javascript
    const barcodeScanService = new BarcodeScanService({
      gatekeeper,
      deviceConfig: scannerDeviceConfig,
      broadcastEvent: (topic, payload) => broadcastEvent({ topic, ...payload }),
      pipelineConfig: {
```

Add `commandResolver: resolveCommand,` after `pipelineConfig`:

```javascript
    const barcodeScanService = new BarcodeScanService({
      gatekeeper,
      deviceConfig: scannerDeviceConfig,
      broadcastEvent: (topic, payload) => broadcastEvent({ topic, ...payload }),
      pipelineConfig: {
        default_action: barcodeConfig.default_action || 'queue',
        actions: barcodeConfig.actions || ['queue', 'play', 'open'],
      },
      commandResolver: resolveCommand,
      logger: rootLogger.child({ module: 'barcode' }),
    });
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs backend/src/app.mjs
git commit -m "feat(barcode): wire knownCommands and commandResolver in bootstrap"
```

---

### Task 7: Verify and document

**Files:** None created — verification and docs.

- [ ] **Step 1: Run all barcode tests**

```bash
npx jest tests/isolated/domain/barcode/ tests/isolated/assembly/adapters/barcode/ tests/isolated/assembly/barcode/ --no-coverage
```

Expected: All tests pass.

- [ ] **Step 2: Update barcode-processing.md**

Read `docs/reference/integrations/barcode-processing.md` and add command barcode documentation to the "MQTT → Screen Pipeline" section. Add a "Command Barcodes" subsection with the command table:

```markdown
### Command Barcodes

Control playback, volume, and display without loading content.

| Barcode | Effect |
|---------|--------|
| `pause` | Pause playback |
| `play` | Resume playback |
| `next` | Next track |
| `prev` | Previous track |
| `ffw` | Fast forward |
| `rew` | Rewind |
| `stop` | Dismiss player |
| `off` | Sleep display |
| `blackout` | Blackout shader |
| `volume:30` | Set volume to 30 |
| `speed:1.5` | Set playback speed to 1.5x |

Prefix with screen name to target: `office:pause`, `living-room:volume:20`.

Commands skip the gatekeeper — no approval needed for playback controls.
```

- [ ] **Step 3: Commit**

```bash
git add docs/reference/integrations/barcode-processing.md
git commit -m "docs: add barcode control commands to pipeline reference"
```
