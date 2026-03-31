# Barcode → Screen Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire MQTT barcode scans through a gatekeeper to screen-framework media playback via WebSocket.

**Architecture:** Dedicated MQTT barcode adapter subscribes to `daylight/scanner/barcode`. Parsed payloads flow through a domain-layer gatekeeper (strategy pattern, default auto-approve) into an application-layer orchestrator that resolves target screen/action from config and broadcasts via WebSocket. The frontend's existing `useScreenCommands` picks up the broadcast and emits ActionBus events.

**Tech Stack:** Node.js (ES modules), MQTT.js, Jest, React hooks, WebSocket

**Spec:** `docs/superpowers/specs/2026-03-30-barcode-screen-pipeline-design.md`

---

## File Structure

| Layer | File | Responsibility |
|-------|------|----------------|
| Domain | `backend/src/2_domains/barcode/BarcodePayload.mjs` | Parse barcode strings into structured value objects |
| Domain | `backend/src/2_domains/barcode/BarcodeGatekeeper.mjs` | Run ordered strategy list, first-deny-wins |
| Domain | `backend/src/2_domains/barcode/strategies/AutoApproveStrategy.mjs` | Default strategy — approve unconditionally |
| Adapter | `backend/src/1_adapters/hardware/mqtt-barcode/MQTTBarcodeAdapter.mjs` | MQTT subscription, JSON validation, parse + callback |
| Application | `backend/src/3_applications/barcode/BarcodeScanService.mjs` | Orchestrate: resolve context → gatekeeper → broadcast |
| Frontend | `frontend/src/screen-framework/commands/useScreenCommands.js` | Add barcode source handling to existing WS command hook |
| System | `backend/src/0_system/bootstrap.mjs` | Wire adapter, gatekeeper, service |
| System | `backend/src/app.mjs` | Initialize barcode adapter alongside vibration adapter |
| Test | `tests/isolated/domain/barcode/BarcodePayload.test.mjs` | Parsing and validation tests |
| Test | `tests/isolated/domain/barcode/BarcodeGatekeeper.test.mjs` | Strategy execution tests |
| Test | `tests/isolated/assembly/adapters/barcode/MQTTBarcodeAdapter.test.mjs` | Adapter message handling tests |
| Test | `tests/isolated/assembly/barcode/BarcodeScanService.test.mjs` | Orchestration tests |

---

### Task 1: BarcodePayload Value Object

**Files:**
- Create: `backend/src/2_domains/barcode/BarcodePayload.mjs`
- Create: `tests/isolated/domain/barcode/BarcodePayload.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create the test file:

```javascript
// tests/isolated/domain/barcode/BarcodePayload.test.mjs
import { describe, it, expect } from '@jest/globals';
import { BarcodePayload } from '#domains/barcode/BarcodePayload.mjs';

const KNOWN_ACTIONS = ['queue', 'play', 'open'];

describe('BarcodePayload', () => {
  describe('two-segment barcode (source:id)', () => {
    it('parses contentId with no action or screen', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'plex:12345', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS
      );
      expect(payload.contentId).toBe('plex:12345');
      expect(payload.action).toBeNull();
      expect(payload.targetScreen).toBeNull();
      expect(payload.device).toBe('scanner-1');
      expect(payload.timestamp).toBe('2026-03-30T01:00:00Z');
    });
  });

  describe('three-segment barcode (action:source:id)', () => {
    it('parses action when first segment is a known action', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'queue:plex:12345', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS
      );
      expect(payload.contentId).toBe('plex:12345');
      expect(payload.action).toBe('queue');
      expect(payload.targetScreen).toBeNull();
    });

    it('parses screen when first segment is not a known action', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'living-room:plex:12345', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS
      );
      expect(payload.contentId).toBe('plex:12345');
      expect(payload.action).toBeNull();
      expect(payload.targetScreen).toBe('living-room');
    });
  });

  describe('four-segment barcode (screen:action:source:id)', () => {
    it('parses both screen and action', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'living-room:queue:plex:12345', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS
      );
      expect(payload.contentId).toBe('plex:12345');
      expect(payload.action).toBe('queue');
      expect(payload.targetScreen).toBe('living-room');
    });

    it('parses play action with screen', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'office:play:plex:99999', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS
      );
      expect(payload.contentId).toBe('plex:99999');
      expect(payload.action).toBe('play');
      expect(payload.targetScreen).toBe('office');
    });
  });

  describe('validation', () => {
    it('returns null for single-segment barcode', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'invalid', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS
      );
      expect(payload).toBeNull();
    });

    it('returns null for empty barcode', () => {
      const payload = BarcodePayload.parse(
        { barcode: '', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS
      );
      expect(payload).toBeNull();
    });

    it('returns null for missing barcode field', () => {
      const payload = BarcodePayload.parse(
        { timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS
      );
      expect(payload).toBeNull();
    });

    it('returns null for missing device field', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'plex:12345', timestamp: '2026-03-30T01:00:00Z' },
        KNOWN_ACTIONS
      );
      expect(payload).toBeNull();
    });
  });

  describe('toJSON', () => {
    it('serializes all fields', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'office:queue:plex:12345', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS
      );
      expect(payload.toJSON()).toEqual({
        contentId: 'plex:12345',
        action: 'queue',
        targetScreen: 'office',
        device: 'scanner-1',
        timestamp: '2026-03-30T01:00:00Z',
      });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/isolated/domain/barcode/BarcodePayload.test.mjs --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```javascript
// backend/src/2_domains/barcode/BarcodePayload.mjs

/**
 * BarcodePayload - Value object for parsed barcode scan data.
 *
 * Parses barcode strings in these formats (right-to-left, last two segments are always source:id):
 *   source:id                    → contentId only
 *   action:source:id             → action + contentId (action must be in known list)
 *   screen:action:source:id      → screen + action + contentId
 *
 * If a three-segment barcode's first segment is not a known action, it's treated as a screen name.
 *
 * @module domains/barcode/BarcodePayload
 */
export class BarcodePayload {
  #contentId;
  #action;
  #targetScreen;
  #device;
  #timestamp;

  constructor({ contentId, action, targetScreen, device, timestamp }) {
    this.#contentId = contentId;
    this.#action = action;
    this.#targetScreen = targetScreen;
    this.#device = device;
    this.#timestamp = timestamp;
  }

  get contentId() { return this.#contentId; }
  get action() { return this.#action; }
  get targetScreen() { return this.#targetScreen; }
  get device() { return this.#device; }
  get timestamp() { return this.#timestamp; }

  /**
   * Parse an MQTT barcode message into a BarcodePayload.
   * @param {Object} message - Raw MQTT message { barcode, timestamp, device }
   * @param {string[]} knownActions - Valid action names from config
   * @returns {BarcodePayload|null} Parsed payload, or null if invalid
   */
  static parse(message, knownActions = []) {
    const { barcode, timestamp, device } = message || {};

    if (!barcode || !device) return null;

    const segments = barcode.split(':');
    if (segments.length < 2) return null;

    // Last two segments are always source:id
    const contentId = segments.slice(-2).join(':');
    const prefixes = segments.slice(0, -2);

    let action = null;
    let targetScreen = null;

    if (prefixes.length === 1) {
      // One prefix: action or screen
      if (knownActions.includes(prefixes[0])) {
        action = prefixes[0];
      } else {
        targetScreen = prefixes[0];
      }
    } else if (prefixes.length === 2) {
      // Two prefixes: screen then action
      targetScreen = prefixes[0];
      action = prefixes[1];
    }
    // prefixes.length === 0: just source:id, no overrides

    return new BarcodePayload({
      contentId,
      action,
      targetScreen,
      device,
      timestamp: timestamp || null,
    });
  }

  toJSON() {
    return {
      contentId: this.#contentId,
      action: this.#action,
      targetScreen: this.#targetScreen,
      device: this.#device,
      timestamp: this.#timestamp,
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/isolated/domain/barcode/BarcodePayload.test.mjs --no-coverage`
Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/barcode/BarcodePayload.mjs tests/isolated/domain/barcode/BarcodePayload.test.mjs
git commit -m "feat(barcode): add BarcodePayload value object with parsing logic"
```

---

### Task 2: AutoApproveStrategy

**Files:**
- Create: `backend/src/2_domains/barcode/strategies/AutoApproveStrategy.mjs`

- [ ] **Step 1: Write the implementation**

This is a single pure function — it will be tested through the BarcodeGatekeeper in Task 3.

```javascript
// backend/src/2_domains/barcode/strategies/AutoApproveStrategy.mjs

/**
 * AutoApproveStrategy - Default gatekeeper strategy that approves all scans.
 * @module domains/barcode/strategies/AutoApproveStrategy
 */

/**
 * Evaluate a scan context — always approves.
 * @param {Object} _scanContext - Scan context (unused)
 * @returns {Promise<{approved: boolean}>}
 */
export async function autoApprove(_scanContext) {
  return { approved: true };
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/2_domains/barcode/strategies/AutoApproveStrategy.mjs
git commit -m "feat(barcode): add AutoApproveStrategy"
```

---

### Task 3: BarcodeGatekeeper

**Files:**
- Create: `backend/src/2_domains/barcode/BarcodeGatekeeper.mjs`
- Create: `tests/isolated/domain/barcode/BarcodeGatekeeper.test.mjs`

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/isolated/domain/barcode/BarcodeGatekeeper.test.mjs
import { describe, it, expect } from '@jest/globals';
import { BarcodeGatekeeper } from '#domains/barcode/BarcodeGatekeeper.mjs';
import { autoApprove } from '#domains/barcode/strategies/AutoApproveStrategy.mjs';

const SCAN_CONTEXT = {
  contentId: 'plex:12345',
  targetScreen: 'office',
  action: 'queue',
  device: 'scanner-1',
  timestamp: '2026-03-30T01:00:00Z',
  policyGroup: 'default',
};

describe('BarcodeGatekeeper', () => {
  describe('with no strategies', () => {
    it('approves by default', async () => {
      const gatekeeper = new BarcodeGatekeeper([]);
      const result = await gatekeeper.evaluate(SCAN_CONTEXT);
      expect(result.approved).toBe(true);
    });
  });

  describe('with AutoApproveStrategy', () => {
    it('approves', async () => {
      const gatekeeper = new BarcodeGatekeeper([autoApprove]);
      const result = await gatekeeper.evaluate(SCAN_CONTEXT);
      expect(result.approved).toBe(true);
    });
  });

  describe('with a denying strategy', () => {
    it('denies with reason', async () => {
      const denyAll = async () => ({ approved: false, reason: 'blocked by test' });
      const gatekeeper = new BarcodeGatekeeper([denyAll]);
      const result = await gatekeeper.evaluate(SCAN_CONTEXT);
      expect(result.approved).toBe(false);
      expect(result.reason).toBe('blocked by test');
    });
  });

  describe('strategy ordering', () => {
    it('stops at first denial', async () => {
      const calls = [];
      const approve = async () => { calls.push('approve'); return { approved: true }; };
      const deny = async () => { calls.push('deny'); return { approved: false, reason: 'denied' }; };
      const neverCalled = async () => { calls.push('never'); return { approved: true }; };

      const gatekeeper = new BarcodeGatekeeper([approve, deny, neverCalled]);
      const result = await gatekeeper.evaluate(SCAN_CONTEXT);

      expect(result.approved).toBe(false);
      expect(calls).toEqual(['approve', 'deny']);
    });

    it('approves when all strategies approve', async () => {
      const approve1 = async () => ({ approved: true });
      const approve2 = async () => ({ approved: true });

      const gatekeeper = new BarcodeGatekeeper([approve1, approve2]);
      const result = await gatekeeper.evaluate(SCAN_CONTEXT);
      expect(result.approved).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/isolated/domain/barcode/BarcodeGatekeeper.test.mjs --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```javascript
// backend/src/2_domains/barcode/BarcodeGatekeeper.mjs

/**
 * BarcodeGatekeeper - Evaluates barcode scans against an ordered list of strategies.
 *
 * Each strategy is an async function: (scanContext) => { approved: boolean, reason?: string }
 * Strategies run in order. First denial wins. If all approve (or list is empty), scan is approved.
 *
 * @module domains/barcode/BarcodeGatekeeper
 */
export class BarcodeGatekeeper {
  #strategies;

  /**
   * @param {Array<Function>} strategies - Ordered list of async strategy functions
   */
  constructor(strategies = []) {
    this.#strategies = strategies;
  }

  /**
   * Evaluate a scan context against all strategies.
   * @param {Object} scanContext
   * @param {string} scanContext.contentId
   * @param {string} scanContext.targetScreen
   * @param {string} scanContext.action
   * @param {string} scanContext.device
   * @param {string} scanContext.timestamp
   * @param {string} scanContext.policyGroup
   * @returns {Promise<{approved: boolean, reason?: string}>}
   */
  async evaluate(scanContext) {
    for (const strategy of this.#strategies) {
      const result = await strategy(scanContext);
      if (!result.approved) {
        return result;
      }
    }
    return { approved: true };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/isolated/domain/barcode/BarcodeGatekeeper.test.mjs --no-coverage`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/barcode/BarcodeGatekeeper.mjs tests/isolated/domain/barcode/BarcodeGatekeeper.test.mjs
git commit -m "feat(barcode): add BarcodeGatekeeper with strategy pattern"
```

---

### Task 4: MQTTBarcodeAdapter

**Files:**
- Create: `backend/src/1_adapters/hardware/mqtt-barcode/MQTTBarcodeAdapter.mjs`
- Create: `tests/isolated/assembly/adapters/barcode/MQTTBarcodeAdapter.test.mjs`

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/isolated/assembly/adapters/barcode/MQTTBarcodeAdapter.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { MQTTBarcodeAdapter } from '#adapters/hardware/mqtt-barcode/MQTTBarcodeAdapter.mjs';

const KNOWN_ACTIONS = ['queue', 'play', 'open'];

// Silence logger
const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

describe('MQTTBarcodeAdapter', () => {
  describe('constructor', () => {
    it('reports configured when host is provided', () => {
      const adapter = new MQTTBarcodeAdapter(
        { host: 'mosquitto', port: 1883, topic: 'daylight/scanner/barcode' },
        { knownActions: KNOWN_ACTIONS, logger }
      );
      expect(adapter.isConfigured()).toBe(true);
    });

    it('reports not configured when host is missing', () => {
      const adapter = new MQTTBarcodeAdapter(
        { host: '', topic: 'daylight/scanner/barcode' },
        { knownActions: KNOWN_ACTIONS, logger }
      );
      expect(adapter.isConfigured()).toBe(false);
    });
  });

  describe('validateMessage', () => {
    let adapter;
    beforeEach(() => {
      adapter = new MQTTBarcodeAdapter(
        { host: 'mosquitto', topic: 'daylight/scanner/barcode' },
        { knownActions: KNOWN_ACTIONS, logger }
      );
    });

    it('accepts a valid barcode message', () => {
      const result = adapter.validateMessage({
        barcode: 'plex:12345',
        timestamp: '2026-03-30T01:00:00Z',
        device: 'scanner-1',
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects when barcode is missing', () => {
      const result = adapter.validateMessage({
        timestamp: '2026-03-30T01:00:00Z',
        device: 'scanner-1',
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('barcode must be a non-empty string');
    });

    it('rejects when device is missing', () => {
      const result = adapter.validateMessage({
        barcode: 'plex:12345',
        timestamp: '2026-03-30T01:00:00Z',
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('device must be a non-empty string');
    });

    it('rejects when timestamp is missing', () => {
      const result = adapter.validateMessage({
        barcode: 'plex:12345',
        device: 'scanner-1',
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('timestamp must be a non-empty string');
    });

    it('rejects non-object payloads', () => {
      const result = adapter.validateMessage(null);
      expect(result.valid).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('returns adapter status', () => {
      const adapter = new MQTTBarcodeAdapter(
        { host: 'mosquitto', topic: 'test/topic' },
        { knownActions: KNOWN_ACTIONS, logger }
      );
      const status = adapter.getStatus();
      expect(status.configured).toBe(true);
      expect(status.connected).toBe(false);
      expect(status.topic).toBe('test/topic');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/isolated/assembly/adapters/barcode/MQTTBarcodeAdapter.test.mjs --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```javascript
// backend/src/1_adapters/hardware/mqtt-barcode/MQTTBarcodeAdapter.mjs

/**
 * MQTTBarcodeAdapter - MQTT subscription for barcode scanner events.
 *
 * Subscribes to a barcode MQTT topic, validates incoming messages,
 * parses barcode strings via BarcodePayload, and emits parsed payloads
 * via an onScan callback.
 *
 * @module adapters/hardware/mqtt-barcode
 */

import mqtt from 'mqtt';
import { BarcodePayload } from '#domains/barcode/BarcodePayload.mjs';

const DEFAULTS = {
  RECONNECT_INTERVAL_MS: 5000,
  MAX_RECONNECT_ATTEMPTS: 10,
  RECONNECT_BACKOFF_MULTIPLIER: 1.5,
  MAX_RECONNECT_INTERVAL_MS: 60000,
};

export class MQTTBarcodeAdapter {
  #host;
  #port;
  #topic;
  #client;
  #knownActions;
  #reconnectAttempts;
  #reconnectTimeout;
  #isShuttingDown;
  #onScan;
  #logger;

  // Config
  #reconnectIntervalMs;
  #maxReconnectAttempts;
  #reconnectBackoffMultiplier;
  #maxReconnectIntervalMs;

  /**
   * @param {Object} config
   * @param {string} config.host - MQTT broker host
   * @param {number} [config.port=1883] - MQTT broker port
   * @param {string} config.topic - MQTT topic to subscribe to
   * @param {Object} [options]
   * @param {string[]} [options.knownActions] - Valid barcode action names
   * @param {Function} [options.onScan] - Callback for parsed BarcodePayload
   * @param {Object} [options.logger]
   */
  constructor(config, options = {}) {
    let host = config.host || '';
    let port = config.port || 1883;

    if (host) {
      try {
        const url = new URL(host.includes('://') ? host : `mqtt://${host}`);
        host = url.hostname;
        if (url.port && !config.port) port = parseInt(url.port, 10);
      } catch {
        const parts = host.split(':');
        host = parts[0];
        if (parts[1] && !config.port) port = parseInt(parts[1], 10);
      }
    }

    this.#host = host;
    this.#port = port;
    this.#topic = config.topic || 'daylight/scanner/barcode';
    this.#client = null;
    this.#knownActions = options.knownActions || [];
    this.#reconnectAttempts = 0;
    this.#reconnectTimeout = null;
    this.#isShuttingDown = false;
    this.#onScan = options.onScan || null;
    this.#logger = options.logger || console;

    this.#reconnectIntervalMs = config.reconnectIntervalMs || DEFAULTS.RECONNECT_INTERVAL_MS;
    this.#maxReconnectAttempts = config.maxReconnectAttempts || DEFAULTS.MAX_RECONNECT_ATTEMPTS;
    this.#reconnectBackoffMultiplier = config.reconnectBackoffMultiplier || DEFAULTS.RECONNECT_BACKOFF_MULTIPLIER;
    this.#maxReconnectIntervalMs = config.maxReconnectIntervalMs || DEFAULTS.MAX_RECONNECT_INTERVAL_MS;
  }

  isConfigured() {
    return Boolean(this.#host);
  }

  isConnected() {
    return this.#client?.connected || false;
  }

  getStatus() {
    return {
      configured: this.isConfigured(),
      connected: this.isConnected(),
      reconnectAttempts: this.#reconnectAttempts,
      topic: this.#topic,
    };
  }

  /**
   * Validate raw MQTT message shape.
   * @param {Object} data
   * @returns {{valid: boolean, errors: string[]}}
   */
  validateMessage(data) {
    const errors = [];
    if (data === null || typeof data !== 'object') {
      return { valid: false, errors: ['Payload must be an object'] };
    }
    if (!data.barcode || typeof data.barcode !== 'string') {
      errors.push('barcode must be a non-empty string');
    }
    if (!data.device || typeof data.device !== 'string') {
      errors.push('device must be a non-empty string');
    }
    if (!data.timestamp || typeof data.timestamp !== 'string') {
      errors.push('timestamp must be a non-empty string');
    }
    return { valid: errors.length === 0, errors };
  }

  /**
   * Set scan callback.
   * @param {Function} callback
   */
  setScanCallback(callback) {
    this.#onScan = callback;
  }

  /**
   * Initialize and connect to MQTT broker.
   * @returns {boolean}
   */
  init() {
    if (!this.#host) {
      this.#logger.warn?.('barcode.mqtt.notConfigured', { message: 'No mqtt host configured' });
      return false;
    }

    const brokerUrl = `mqtt://${this.#host}:${this.#port}`;
    this.#logger.info?.('barcode.mqtt.initializing', { broker: brokerUrl, topic: this.#topic });

    this.#isShuttingDown = false;
    this.#reconnectAttempts = 0;
    this.#connectToBroker(brokerUrl);

    return true;
  }

  close() {
    this.#isShuttingDown = true;
    if (this.#reconnectTimeout) {
      clearTimeout(this.#reconnectTimeout);
      this.#reconnectTimeout = null;
    }
    if (this.#client) {
      this.#client.end(true);
      this.#client = null;
    }
    this.#logger.info?.('barcode.mqtt.closed');
  }

  // ─── Private ───────────────────────────────────────────

  #connectToBroker(brokerUrl) {
    if (this.#isShuttingDown) return;

    this.#client = mqtt.connect(brokerUrl, {
      reconnectPeriod: 0,
      connectTimeout: 10000,
    });

    this.#client.on('connect', () => {
      this.#logger.info?.('barcode.mqtt.connected', { broker: brokerUrl });
      this.#reconnectAttempts = 0;

      this.#client.subscribe(this.#topic, (err) => {
        if (err) {
          this.#logger.error?.('barcode.mqtt.subscribe.failed', { topic: this.#topic, error: err.message });
        } else {
          this.#logger.info?.('barcode.mqtt.subscribed', { topic: this.#topic });
        }
      });
    });

    this.#client.on('message', (_topic, message) => {
      let data;
      try {
        data = JSON.parse(message.toString());
      } catch (parseErr) {
        this.#logger.warn?.('barcode.mqtt.parseFailed', { error: parseErr.message });
        return;
      }

      const validation = this.validateMessage(data);
      if (!validation.valid) {
        this.#logger.warn?.('barcode.mqtt.validationFailed', { errors: validation.errors });
        return;
      }

      const payload = BarcodePayload.parse(data, this.#knownActions);
      if (!payload) {
        this.#logger.warn?.('barcode.mqtt.invalidBarcode', { barcode: data.barcode });
        return;
      }

      this.#logger.info?.('barcode.mqtt.scan', {
        contentId: payload.contentId,
        action: payload.action,
        targetScreen: payload.targetScreen,
        device: payload.device,
      });

      if (this.#onScan) {
        this.#onScan(payload);
      }
    });

    this.#client.on('error', (err) => {
      this.#logger.error?.('barcode.mqtt.error', { error: err.message, code: err.code });
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
        this.#scheduleReconnect(brokerUrl);
      }
    });

    this.#client.on('close', () => {
      if (this.#isShuttingDown) {
        this.#logger.info?.('barcode.mqtt.disconnected.shutdown');
        return;
      }
      this.#logger.warn?.('barcode.mqtt.disconnected.unexpected');
      this.#scheduleReconnect(brokerUrl);
    });

    this.#client.on('offline', () => {
      this.#logger.warn?.('barcode.mqtt.offline');
    });
  }

  #scheduleReconnect(brokerUrl) {
    if (this.#isShuttingDown) return;

    if (this.#reconnectAttempts >= this.#maxReconnectAttempts) {
      this.#logger.error?.('barcode.mqtt.reconnect.exhausted', {
        attempts: this.#reconnectAttempts,
      });
      return;
    }

    const backoffMs = Math.min(
      this.#reconnectIntervalMs * Math.pow(this.#reconnectBackoffMultiplier, this.#reconnectAttempts),
      this.#maxReconnectIntervalMs
    );
    this.#reconnectAttempts += 1;

    this.#logger.info?.('barcode.mqtt.reconnect.scheduled', {
      attempt: this.#reconnectAttempts,
      backoffMs,
    });

    this.#reconnectTimeout = setTimeout(() => {
      this.#connectToBroker(brokerUrl);
    }, backoffMs);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/isolated/assembly/adapters/barcode/MQTTBarcodeAdapter.test.mjs --no-coverage`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/hardware/mqtt-barcode/MQTTBarcodeAdapter.mjs tests/isolated/assembly/adapters/barcode/MQTTBarcodeAdapter.test.mjs
git commit -m "feat(barcode): add MQTTBarcodeAdapter for barcode MQTT subscription"
```

---

### Task 5: BarcodeScanService

**Files:**
- Create: `backend/src/3_applications/barcode/BarcodeScanService.mjs`
- Create: `tests/isolated/assembly/barcode/BarcodeScanService.test.mjs`

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/isolated/assembly/barcode/BarcodeScanService.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { BarcodeScanService } from '../../../../backend/src/3_applications/barcode/BarcodeScanService.mjs';
import { BarcodePayload } from '#domains/barcode/BarcodePayload.mjs';
import { BarcodeGatekeeper } from '#domains/barcode/BarcodeGatekeeper.mjs';

const KNOWN_ACTIONS = ['queue', 'play', 'open'];

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

function makePayload(barcode, device = 'scanner-1') {
  return BarcodePayload.parse(
    { barcode, timestamp: '2026-03-30T01:00:00Z', device },
    KNOWN_ACTIONS
  );
}

describe('BarcodeScanService', () => {
  let broadcastEvent;
  let gatekeeper;
  let deviceConfig;
  let pipelineConfig;

  beforeEach(() => {
    broadcastEvent = jest.fn();
    gatekeeper = new BarcodeGatekeeper([]); // auto-approve (no strategies)
    deviceConfig = {
      'scanner-1': { type: 'barcode-scanner', target_screen: 'office', policy_group: 'default' },
      'scanner-2': { type: 'barcode-scanner', target_screen: 'living-room', policy_group: 'strict' },
    };
    pipelineConfig = {
      default_action: 'queue',
      actions: KNOWN_ACTIONS,
    };
    logger.info.mockClear();
    logger.warn.mockClear();
  });

  function createService(overrides = {}) {
    return new BarcodeScanService({
      gatekeeper: overrides.gatekeeper || gatekeeper,
      deviceConfig: overrides.deviceConfig || deviceConfig,
      broadcastEvent: overrides.broadcastEvent || broadcastEvent,
      pipelineConfig: overrides.pipelineConfig || pipelineConfig,
      logger,
    });
  }

  describe('handle — approved scans', () => {
    it('broadcasts to the device default screen with default action', async () => {
      const service = createService();
      await service.handle(makePayload('plex:12345'));

      expect(broadcastEvent).toHaveBeenCalledWith('office', {
        action: 'queue',
        contentId: 'plex:12345',
        source: 'barcode',
        device: 'scanner-1',
      });
    });

    it('uses barcode action when specified', async () => {
      const service = createService();
      await service.handle(makePayload('play:plex:12345'));

      expect(broadcastEvent).toHaveBeenCalledWith('office', {
        action: 'play',
        contentId: 'plex:12345',
        source: 'barcode',
        device: 'scanner-1',
      });
    });

    it('uses barcode target screen when specified', async () => {
      const service = createService();
      await service.handle(makePayload('living-room:plex:12345'));

      expect(broadcastEvent).toHaveBeenCalledWith('living-room', {
        action: 'queue',
        contentId: 'plex:12345',
        source: 'barcode',
        device: 'scanner-1',
      });
    });

    it('uses both barcode screen and action when specified', async () => {
      const service = createService();
      await service.handle(makePayload('living-room:play:plex:12345'));

      expect(broadcastEvent).toHaveBeenCalledWith('living-room', {
        action: 'play',
        contentId: 'plex:12345',
        source: 'barcode',
        device: 'scanner-1',
      });
    });
  });

  describe('handle — denied scans', () => {
    it('does not broadcast when gatekeeper denies', async () => {
      const denyGatekeeper = new BarcodeGatekeeper([
        async () => ({ approved: false, reason: 'test deny' }),
      ]);
      const service = createService({ gatekeeper: denyGatekeeper });
      await service.handle(makePayload('plex:12345'));

      expect(broadcastEvent).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        'barcode.denied',
        expect.objectContaining({ reason: 'test deny' })
      );
    });
  });

  describe('handle — unknown device', () => {
    it('logs warning and does not broadcast for unknown scanner', async () => {
      const service = createService();
      await service.handle(makePayload('plex:12345', 'unknown-scanner'));

      expect(broadcastEvent).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'barcode.unknownDevice',
        expect.objectContaining({ device: 'unknown-scanner' })
      );
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/isolated/assembly/barcode/BarcodeScanService.test.mjs --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```javascript
// backend/src/3_applications/barcode/BarcodeScanService.mjs

/**
 * BarcodeScanService - Orchestrates barcode scan → gatekeeper → screen broadcast.
 *
 * Receives parsed BarcodePayloads, resolves target screen and action from
 * device config and pipeline config, runs the gatekeeper, and broadcasts
 * approved scans to the target screen via WebSocket.
 *
 * @module applications/barcode/BarcodeScanService
 */
export class BarcodeScanService {
  #gatekeeper;
  #deviceConfig;
  #broadcastEvent;
  #pipelineConfig;
  #logger;

  /**
   * @param {Object} deps
   * @param {import('#domains/barcode/BarcodeGatekeeper.mjs').BarcodeGatekeeper} deps.gatekeeper
   * @param {Object} deps.deviceConfig - Scanner device entries keyed by device ID
   * @param {Function} deps.broadcastEvent - (topic, payload) => void
   * @param {Object} deps.pipelineConfig - { default_action, actions }
   * @param {Object} [deps.logger]
   */
  constructor(deps) {
    this.#gatekeeper = deps.gatekeeper;
    this.#deviceConfig = deps.deviceConfig;
    this.#broadcastEvent = deps.broadcastEvent;
    this.#pipelineConfig = deps.pipelineConfig;
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
    const action = payload.action || this.#pipelineConfig.default_action;
    const policyGroup = scannerConfig.policy_group || 'default';

    const scanContext = {
      contentId: payload.contentId,
      targetScreen,
      action,
      device,
      timestamp: payload.timestamp,
      policyGroup,
    };

    const result = await this.#gatekeeper.evaluate(scanContext);

    if (!result.approved) {
      this.#logger.info?.('barcode.denied', {
        contentId: payload.contentId,
        device,
        reason: result.reason,
      });
      return;
    }

    this.#logger.info?.('barcode.approved', {
      contentId: payload.contentId,
      targetScreen,
      action,
      device,
    });

    this.#broadcastEvent(targetScreen, {
      action,
      contentId: payload.contentId,
      source: 'barcode',
      device,
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/isolated/assembly/barcode/BarcodeScanService.test.mjs --no-coverage`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/barcode/BarcodeScanService.mjs tests/isolated/assembly/barcode/BarcodeScanService.test.mjs
git commit -m "feat(barcode): add BarcodeScanService orchestrator"
```

---

### Task 6: Frontend — useScreenCommands barcode handling

**Files:**
- Modify: `frontend/src/screen-framework/commands/useScreenCommands.js`

- [ ] **Step 1: Read the current file**

Read `frontend/src/screen-framework/commands/useScreenCommands.js` to confirm its current state before editing.

- [ ] **Step 2: Add barcode source handling**

Add a barcode handler block after the `data.playback` handler and before the content reference extraction. This ensures barcode messages with `source: 'barcode'` get handled directly with their explicit `action` field, rather than falling through to the generic content extraction logic.

Insert after the playback handler block (after the `if (data.playback) { ... }` block, before the `// Content reference extraction` comment):

```javascript
    // Barcode scan
    if (data.source === 'barcode' && data.contentId) {
      const actionMap = { queue: 'media:queue', play: 'media:play', open: 'menu:open' };
      const busAction = actionMap[data.action] || 'media:queue';
      logger().info('commands.barcode', { action: busAction, contentId: data.contentId, device: data.device });
      bus.emit(busAction, { contentId: data.contentId });
      return;
    }
```

- [ ] **Step 3: Update the WS filter predicate**

Add `msg.source === 'barcode'` to the filter so barcode messages pass through:

Find this line in the filter predicate:
```javascript
        || msg.media || msg.playlist || msg.files || msg.poem)
```

Change to:
```javascript
        || msg.media || msg.playlist || msg.files || msg.poem
        || msg.source === 'barcode')
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/screen-framework/commands/useScreenCommands.js
git commit -m "feat(barcode): handle barcode WS messages in useScreenCommands"
```

---

### Task 7: Bootstrap Wiring

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs`
- Modify: `backend/src/app.mjs`

- [ ] **Step 1: Read bootstrap.mjs around createHardwareAdapters**

Read `backend/src/0_system/bootstrap.mjs` lines 1720-1800 to confirm current structure.

- [ ] **Step 2: Add MQTTBarcodeAdapter import to bootstrap.mjs**

Add the import near the other hardware adapter imports at the top of the file. Search for `MQTTSensorAdapter` import and add nearby:

```javascript
import { MQTTBarcodeAdapter } from '#adapters/hardware/mqtt-barcode/MQTTBarcodeAdapter.mjs';
```

- [ ] **Step 3: Add barcodeAdapter creation to createHardwareAdapters**

Inside `createHardwareAdapters()`, after the MQTT sensor adapter creation block and before the `return` statement, add:

```javascript
  // MQTT barcode adapter (optional)
  let barcodeAdapter = null;
  if (config.barcode?.host && config.barcode?.topic) {
    barcodeAdapter = new MQTTBarcodeAdapter(
      {
        host: config.barcode.host,
        port: config.barcode.port,
        topic: config.barcode.topic,
      },
      {
        knownActions: config.barcode.knownActions || [],
        onScan: config.onBarcodeScan,
        logger,
      }
    );
  }
```

Add `barcodeAdapter` to the return object.

- [ ] **Step 4: Add domain imports to bootstrap.mjs**

Add imports for the gatekeeper and strategy near the top:

```javascript
import { BarcodeGatekeeper } from '#domains/barcode/BarcodeGatekeeper.mjs';
import { autoApprove } from '#domains/barcode/strategies/AutoApproveStrategy.mjs';
import { BarcodeScanService } from '../../3_applications/barcode/BarcodeScanService.mjs';
```

- [ ] **Step 5: Read app.mjs around MQTT initialization**

Read `backend/src/app.mjs` lines 1170-1230 to confirm current structure.

- [ ] **Step 6: Wire barcode adapter in app.mjs**

Add the barcode pipeline setup after the existing MQTT sensor initialization block. This wires the adapter → service → broadcast chain.

After the MQTT sensor initialization block, add:

```javascript
  // Initialize barcode scanner MQTT adapter
  if (enableMqtt && hardwareAdapters.barcodeAdapter?.isConfigured()) {
    // Load barcode pipeline config
    const barcodeConfig = configService.getHouseholdAppConfig(householdId, 'barcode') || {};
    const devicesConfig = configService.getHouseholdAppConfig(householdId, 'devices') || {};

    // Build scanner device map (filter to barcode-scanner type)
    const scannerDeviceConfig = {};
    const devices = devicesConfig.devices || devicesConfig;
    for (const [id, device] of Object.entries(devices)) {
      if (device.type === 'barcode-scanner') {
        scannerDeviceConfig[id] = device;
      }
    }

    // Create gatekeeper with auto-approve (strategies from config in future)
    const gatekeeper = new BarcodeGatekeeper([autoApprove]);

    // Create scan service
    const barcodeScanService = new BarcodeScanService({
      gatekeeper,
      deviceConfig: scannerDeviceConfig,
      broadcastEvent: (topic, payload) => broadcastEvent({ topic, ...payload }),
      pipelineConfig: {
        default_action: barcodeConfig.default_action || 'queue',
        actions: barcodeConfig.actions || ['queue', 'play', 'open'],
      },
      logger: rootLogger.child({ module: 'barcode' }),
    });

    // Wire adapter callback
    hardwareAdapters.barcodeAdapter.setScanCallback((payload) => {
      barcodeScanService.handle(payload);
    });

    if (hardwareAdapters.barcodeAdapter.init()) {
      rootLogger.info('barcode.mqtt.initialized', {
        topic: hardwareAdapters.barcodeAdapter.getStatus().topic,
        scanners: Object.keys(scannerDeviceConfig),
      });
    }
  }
```

- [ ] **Step 7: Add barcode config to createHardwareAdapters call in app.mjs**

In the `createHardwareAdapters({...})` call, add the barcode config block alongside the existing `mqtt:` block:

```javascript
    barcode: {
      host: mqtt.host,
      port: mqtt.port || 1883,
      topic: (configService.getHouseholdAppConfig(householdId, 'barcode') || {}).topic || 'daylight/scanner/barcode',
      knownActions: (configService.getHouseholdAppConfig(householdId, 'barcode') || {}).actions || ['queue', 'play', 'open'],
    },
```

- [ ] **Step 8: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs backend/src/app.mjs
git commit -m "feat(barcode): wire barcode adapter, gatekeeper, and scan service in bootstrap"
```

---

### Task 8: Configuration Files

**Files:**
- Create: `data/household/config/barcode.yml` (inside Docker container)
- Modify: `data/household/config/devices.yml` (inside Docker container)

- [ ] **Step 1: Create barcode.yml config**

```bash
sudo docker exec daylight-station sh -c "cat > data/household/config/barcode.yml << 'EOF'
# Barcode Scanner Pipeline Configuration

topic: daylight/scanner/barcode
default_action: queue

actions:
  - queue
  - play
  - open

gatekeeper:
  default_policy: auto-approve
  policies:
    auto-approve:
      strategies: []
EOF"
```

- [ ] **Step 2: Add scanner device entry to devices.yml**

Read the current `devices.yml` first:

```bash
sudo docker exec daylight-station sh -c 'cat data/household/config/devices.yml'
```

Then append the scanner device entry to the `devices:` block. The exact edit depends on the current file contents — add under the existing devices:

```yaml
  # Barcode Scanner (Symbol USB)
  symbol-scanner:
    type: barcode-scanner
    target_screen: office
    policy_group: default
```

Write the updated file using `cat >` heredoc (never `sed -i` on YAML in the container).

- [ ] **Step 3: Verify configs are readable**

```bash
sudo docker exec daylight-station sh -c 'cat data/household/config/barcode.yml'
sudo docker exec daylight-station sh -c 'grep -A3 symbol-scanner data/household/config/devices.yml'
```

Expected: Both configs display correctly.

- [ ] **Step 4: Commit a note about the config**

Config files live in the data volume (not git-tracked). No git commit needed for this step. The configs are operational — they'll be picked up when the app restarts or when the container is rebuilt.

---

### Task 9: Integration Smoke Test

**Files:** None created — manual verification.

- [ ] **Step 1: Verify all unit tests pass**

```bash
npx jest tests/isolated/domain/barcode/ tests/isolated/assembly/adapters/barcode/ tests/isolated/assembly/barcode/ --no-coverage
```

Expected: All tests PASS (20 tests across 4 files).

- [ ] **Step 2: Verify the direct API still works as a comparison**

```bash
curl -s "http://localhost:3112/api/v1/nutribot/upc?user=kckern&upc=749826002019" | head -c 200
```

Expected: Response from the nutribot UPC endpoint (confirms backend is running).

- [ ] **Step 3: Test MQTT barcode publish manually**

If the dev server is running and connected to MQTT:

```bash
mosquitto_pub -h localhost -t "daylight/scanner/barcode" -m '{"barcode":"plex:12345","timestamp":"2026-03-30T12:00:00Z","device":"symbol-scanner"}'
```

Expected: Backend logs show `barcode.mqtt.scan` and `barcode.approved`, and a WS message is broadcast to the `office` topic.

- [ ] **Step 4: Commit all remaining changes**

Run a final `git status` check and commit any uncommitted files.

```bash
git status
```

---

### Task 10: Documentation Update

**Files:**
- Modify: `docs/reference/integrations/barcode-processing.md`

- [ ] **Step 1: Read the current doc**

Read `docs/reference/integrations/barcode-processing.md` to find the "Current Gap" section at the bottom.

- [ ] **Step 2: Replace the "Current Gap" section**

Replace the `## Current Gap: MQTT → Nutribot` section with documentation of the implemented pipeline:

```markdown
## MQTT → Screen Pipeline

The barcode scanner publishes to `daylight/scanner/barcode`. The backend subscribes via `MQTTBarcodeAdapter`, parses the barcode string, runs it through the `BarcodeGatekeeper`, and broadcasts to the target screen via WebSocket.

### Pipeline Components

| Component | File | Purpose |
|-----------|------|---------|
| `MQTTBarcodeAdapter` | `backend/src/1_adapters/hardware/mqtt-barcode/MQTTBarcodeAdapter.mjs` | MQTT subscription, message validation, barcode parsing |
| `BarcodePayload` | `backend/src/2_domains/barcode/BarcodePayload.mjs` | Value object — parses barcode string into contentId, action, screen |
| `BarcodeGatekeeper` | `backend/src/2_domains/barcode/BarcodeGatekeeper.mjs` | Strategy-based approve/deny evaluation |
| `BarcodeScanService` | `backend/src/3_applications/barcode/BarcodeScanService.mjs` | Orchestrator — resolves context, runs gatekeeper, broadcasts |

### Configuration

- **Pipeline config:** `data/household/config/barcode.yml` — topic, default action, gatekeeper policies
- **Scanner devices:** `data/household/config/devices.yml` — per-scanner target screen and policy group

### Testing

```bash
# Publish a test barcode
mosquitto_pub -h localhost -t "daylight/scanner/barcode" \
  -m '{"barcode":"plex:12345","timestamp":"2026-03-30T12:00:00Z","device":"symbol-scanner"}'
```
```

- [ ] **Step 3: Commit**

```bash
git add docs/reference/integrations/barcode-processing.md
git commit -m "docs: update barcode processing with MQTT → screen pipeline"
```
