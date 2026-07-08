# NiceDay Rider Assignment via Cycling Selector — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a rider claim the NiceDay bike with a physical Garage Cycling Selector button press, so the system knows who is riding.

**Architecture:** A Tuya 4-button Zigbee switch publishes `{"action":"N_single"}` over MQTT. A new `MQTTSelectorAdapter` (modeled on the existing `MQTTBarcodeAdapter`) maps each action to a `{equipmentId, userId}` from `fitness.yml` config and broadcasts a `rider_select` event over the existing MQTT→WebSocket path. The frontend `DeviceEventRouter` routes it to `FitnessSession`, which holds a session-scoped `equipmentRider` map. `GovernanceEngine` consumes the claim when selecting a cycle rider (claim wins; null falls back to today's random-from-eligible), and the live RPM avatar shows the claimed rider.

**Tech Stack:** Node.js ESM backend (`.mjs`), `mqtt` npm client, vitest for tests, React (`.jsx`) frontend, YAML config in the data volume.

---

## Design reference

Spec: `docs/superpowers/specs/2026-05-29-niceday-rider-assignment-selector-design.md`

**Locked decisions:** standing claim; dedicated config-driven button→user map in `fitness.yml`; null at session start; null→random-from-eligible fallback at challenge time; sticky + reassign + session reset; dedicated backend adapter; visual-only feedback.

**Two clarifications discovered during planning (supersede the spec where they differ):**

1. **"Claim is authoritative (bypasses eligible_users)" is implemented as "a claim grants eligibility."** Both `_startCycleChallenge` and `swapCycleRider` enforce `eligible_users` membership today. Rather than bypass those guards, we union the standing claim into `GovernanceEngine._getEligibleUsers(equipmentId)`, so a claimed rider is treated as eligible everywhere without weakening the invariant for unclaimed picks.
2. **The live RPM avatar lives in `frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx`** (the `rpm-group` block, using `@/modules/Fitness/components/RpmDeviceAvatar.jsx`) — not `RealtimeCards/RpmDeviceCard`. Task 8 targets the real path.

## Testing in a worktree (read before running any test command)

This plan is implemented in a git worktree. Per the known caveat (`reference_vitest_in_worktree.md` in memory): worktrees lack their own `node_modules`. Run vitest using the **main repo's** binary, invoked from the worktree directory:

```bash
WT=/opt/Code/DaylightStation/.claude/worktrees/niceday-rider-assignment
VITEST=/opt/Code/DaylightStation/node_modules/.bin/vitest
cd "$WT" && "$VITEST" run --config /opt/Code/DaylightStation/vitest.config.mjs <relative/path/to/test>
```

Backend `.mjs` tests resolve `#adapters/...` subpath imports via the worktree `package.json`, so they isolate correctly. If a frontend `@/`-aliased test resolves against main's `frontend/src` instead of the worktree's, run it after merging to main instead — note that in the task result rather than skipping the assertion.

## File structure

| File | Responsibility | Action |
|------|----------------|--------|
| `backend/src/1_adapters/hardware/mqtt-selector/MQTTSelectorAdapter.mjs` | Subscribe to selector topics, map `action`→`{equipmentId,userId}`, fire `onSelect` | Create |
| `backend/src/1_adapters/hardware/mqtt-selector/index.mjs` | Barrel export | Create |
| `tests/isolated/assembly/adapters/selector/MQTTSelectorAdapter.test.mjs` | Adapter unit tests | Create |
| `backend/src/0_system/bootstrap.mjs` | Construct `selectorAdapter` in `createHardwareAdapters` | Modify |
| `backend/src/app.mjs` | Read `selectors` config, wire `onSelect` broadcast, init adapter | Modify |
| `data/household/config/fitness.yml` (data volume, not in repo) | `selectors:` config block | Modify (deploy step) |
| `frontend/src/hooks/fitness/DeviceEventRouter.js` | Resolve `rider_select` payload type | Modify |
| `frontend/src/hooks/fitness/FitnessSession.js` | `equipmentRider` map, set/get, handler, reset, evaluate input | Modify |
| `frontend/src/hooks/fitness/GovernanceEngine.js` | `equipmentRiderMap` input; claim grants eligibility; claim precedence; live swap | Modify |
| `frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx` | Show claimed rider avatar on the bike | Modify |
| `frontend/src/hooks/fitness/CycleStateMachine.test.js` | Governance claim tests | Modify |
| `frontend/src/hooks/fitness/DeviceEventRouter.riderSelect.test.js` | Router routing test | Create |
| `frontend/src/hooks/fitness/FitnessSession.equipmentRider.test.js` | Session state test | Create |

---

### Task 1: Backend `MQTTSelectorAdapter`

**Files:**
- Create: `backend/src/1_adapters/hardware/mqtt-selector/MQTTSelectorAdapter.mjs`
- Create: `backend/src/1_adapters/hardware/mqtt-selector/index.mjs`
- Test: `tests/isolated/assembly/adapters/selector/MQTTSelectorAdapter.test.mjs`

The adapter mirrors `MQTTBarcodeAdapter` (host parsing, reconnect/backoff, connect/message/error/close handlers) but its message handler maps the Tuya `action` to a configured rider claim. Tests focus on the pure mapping logic (`resolveSelection`) and `getStatus`, which need no live broker.

- [ ] **Step 1: Write the failing test**

Create `tests/isolated/assembly/adapters/selector/MQTTSelectorAdapter.test.mjs`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MQTTSelectorAdapter } from '#adapters/hardware/mqtt-selector/MQTTSelectorAdapter.mjs';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

const SELECTORS = [
  {
    id: 'niceday_rider_selector',
    mqtt_topic: 'zigbee2mqtt-usb/Garage Cycling Selector',
    equipment: 'niceday',
    buttons: { '1_single': 'user_2', '2_single': 'user_3', '3_single': 'user_1', '4_single': 'user_4' },
  },
];

function makeAdapter() {
  return new MQTTSelectorAdapter(
    { host: 'mosquitto', port: 1883 },
    { selectors: SELECTORS, logger }
  );
}

describe('MQTTSelectorAdapter', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe('constructor', () => {
    it('reports configured when host and selectors are present', () => {
      expect(makeAdapter().isConfigured()).toBe(true);
    });
    it('reports not configured when host is missing', () => {
      const a = new MQTTSelectorAdapter({ host: '' }, { selectors: SELECTORS, logger });
      expect(a.isConfigured()).toBe(false);
    });
  });

  describe('resolveSelection', () => {
    let adapter;
    beforeEach(() => { adapter = makeAdapter(); });

    it('maps a known single-press action to a rider claim', () => {
      const sel = adapter.resolveSelection(
        'zigbee2mqtt-usb/Garage Cycling Selector',
        { action: '2_single' }
      );
      expect(sel).toEqual({
        selectorId: 'niceday_rider_selector',
        equipmentId: 'niceday',
        userId: 'user_3',
        action: '2_single',
      });
    });

    it('returns null for an unmapped gesture (double/hold)', () => {
      expect(adapter.resolveSelection('zigbee2mqtt-usb/Garage Cycling Selector', { action: '2_double' })).toBeNull();
      expect(adapter.resolveSelection('zigbee2mqtt-usb/Garage Cycling Selector', { action: '2_hold' })).toBeNull();
    });

    it('returns null for the empty reset action', () => {
      expect(adapter.resolveSelection('zigbee2mqtt-usb/Garage Cycling Selector', { action: '' })).toBeNull();
    });

    it('returns null for an unconfigured topic', () => {
      expect(adapter.resolveSelection('zigbee2mqtt-usb/Some Other Device', { action: '1_single' })).toBeNull();
    });

    it('returns null when payload has no action', () => {
      expect(adapter.resolveSelection('zigbee2mqtt-usb/Garage Cycling Selector', { battery: 100 })).toBeNull();
    });
  });

  describe('getStatus', () => {
    it('returns configured/connected/topics', () => {
      const status = makeAdapter().getStatus();
      expect(status.configured).toBe(true);
      expect(status.connected).toBe(false);
      expect(status.topics).toEqual(['zigbee2mqtt-usb/Garage Cycling Selector']);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "$WT" && "$VITEST" run --config /opt/Code/DaylightStation/vitest.config.mjs tests/isolated/assembly/adapters/selector/MQTTSelectorAdapter.test.mjs`
Expected: FAIL — cannot resolve `#adapters/hardware/mqtt-selector/MQTTSelectorAdapter.mjs` (module does not exist).

- [ ] **Step 3: Write the adapter**

Create `backend/src/1_adapters/hardware/mqtt-selector/MQTTSelectorAdapter.mjs`:

```javascript
/**
 * MQTTSelectorAdapter - MQTT subscription for rider-selector button events.
 *
 * Subscribes to one or more zigbee2mqtt selector topics (e.g. a Tuya 4-button
 * switch), maps the published `action` (e.g. "1_single") to a configured rider
 * claim {equipmentId, userId}, and emits it via an onSelect callback.
 *
 * Mirrors MQTTBarcodeAdapter's connection/reconnect behavior; only the message
 * handling differs (discrete action -> rider claim instead of barcode parse).
 *
 * @module adapters/hardware/mqtt-selector
 */

import mqtt from 'mqtt';

const DEFAULTS = {
  RECONNECT_INTERVAL_MS: 5000,
  MAX_RECONNECT_ATTEMPTS: 10,
  RECONNECT_BACKOFF_MULTIPLIER: 1.5,
  MAX_RECONNECT_INTERVAL_MS: 60000,
};

export class MQTTSelectorAdapter {
  #host;
  #port;
  #client;
  #topicMap;          // mqtt_topic -> { selectorId, equipmentId, buttons }
  #reconnectAttempts;
  #reconnectTimeout;
  #isShuttingDown;
  #onSelect;
  #logger;

  #reconnectIntervalMs;
  #maxReconnectAttempts;
  #reconnectBackoffMultiplier;
  #maxReconnectIntervalMs;

  /**
   * @param {Object} config
   * @param {string} config.host - MQTT broker host
   * @param {number} [config.port=1883] - MQTT broker port
   * @param {Object} [options]
   * @param {Array} [options.selectors] - Selector config: [{id, mqtt_topic, equipment, buttons}]
   * @param {Function} [options.onSelect] - Callback({selectorId, equipmentId, userId, action})
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
    this.#client = null;
    this.#topicMap = this.#buildTopicMap(options.selectors || []);
    this.#reconnectAttempts = 0;
    this.#reconnectTimeout = null;
    this.#isShuttingDown = false;
    this.#onSelect = options.onSelect || null;
    this.#logger = options.logger || console;

    this.#reconnectIntervalMs = config.reconnectIntervalMs || DEFAULTS.RECONNECT_INTERVAL_MS;
    this.#maxReconnectAttempts = config.maxReconnectAttempts || DEFAULTS.MAX_RECONNECT_ATTEMPTS;
    this.#reconnectBackoffMultiplier = config.reconnectBackoffMultiplier || DEFAULTS.RECONNECT_BACKOFF_MULTIPLIER;
    this.#maxReconnectIntervalMs = config.maxReconnectIntervalMs || DEFAULTS.MAX_RECONNECT_INTERVAL_MS;
  }

  #buildTopicMap(selectors) {
    const map = new Map();
    if (!Array.isArray(selectors)) return map;
    selectors.forEach((sel) => {
      if (sel?.mqtt_topic && sel.equipment && sel.buttons && typeof sel.buttons === 'object') {
        map.set(sel.mqtt_topic, {
          selectorId: sel.id || sel.equipment,
          equipmentId: sel.equipment,
          buttons: { ...sel.buttons },
        });
      }
    });
    return map;
  }

  isConfigured() {
    return Boolean(this.#host) && this.#topicMap.size > 0;
  }

  isConnected() {
    return this.#client?.connected || false;
  }

  getStatus() {
    return {
      configured: this.isConfigured(),
      connected: this.isConnected(),
      reconnectAttempts: this.#reconnectAttempts,
      topics: Array.from(this.#topicMap.keys()),
    };
  }

  /**
   * Pure mapping: resolve an incoming payload on a topic to a rider claim.
   * Returns null for unconfigured topics, missing/unmapped actions, and the
   * empty reset action.
   * @param {string} topic
   * @param {Object} data - Parsed payload (expects a string `action`)
   * @returns {{selectorId:string, equipmentId:string, userId:string, action:string}|null}
   */
  resolveSelection(topic, data) {
    const entry = this.#topicMap.get(topic);
    if (!entry) return null;
    const action = data && typeof data.action === 'string' ? data.action : '';
    if (!action) return null;
    const userId = entry.buttons[action];
    if (!userId) return null;
    return { selectorId: entry.selectorId, equipmentId: entry.equipmentId, userId, action };
  }

  setSelectCallback(callback) {
    this.#onSelect = callback;
  }

  init() {
    if (!this.#host) {
      this.#logger.warn?.('selector.mqtt.notConfigured', { message: 'No mqtt host configured' });
      return false;
    }
    if (this.#topicMap.size === 0) {
      this.#logger.info?.('selector.mqtt.noSelectors', { message: 'No selectors configured' });
      return false;
    }

    const brokerUrl = `mqtt://${this.#host}:${this.#port}`;
    this.#logger.info?.('selector.mqtt.initializing', { broker: brokerUrl, topics: Array.from(this.#topicMap.keys()) });

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
    this.#logger.info?.('selector.mqtt.closed');
  }

  // ─── Private ───────────────────────────────────────────

  #connectToBroker(brokerUrl) {
    if (this.#isShuttingDown) return;

    this.#client = mqtt.connect(brokerUrl, { reconnectPeriod: 0, connectTimeout: 10000 });

    this.#client.on('connect', () => {
      this.#logger.info?.('selector.mqtt.connected', { broker: brokerUrl });
      this.#reconnectAttempts = 0;
      this.#topicMap.forEach((_entry, topic) => {
        this.#client.subscribe(topic, (err) => {
          if (err) {
            this.#logger.error?.('selector.mqtt.subscribe.failed', { topic, error: err.message });
          } else {
            this.#logger.info?.('selector.mqtt.subscribed', { topic });
          }
        });
      });
    });

    this.#client.on('message', (topic, message) => {
      let data;
      try {
        data = JSON.parse(message.toString());
      } catch (parseErr) {
        this.#logger.warn?.('selector.mqtt.parseFailed', { topic, error: parseErr.message });
        return;
      }
      const selection = this.resolveSelection(topic, data);
      if (!selection) return;
      this.#logger.info?.('selector.mqtt.select', selection);
      if (this.#onSelect) this.#onSelect(selection);
    });

    this.#client.on('error', (err) => {
      this.#logger.error?.('selector.mqtt.error', { error: err.message, code: err.code });
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
        this.#scheduleReconnect(brokerUrl);
      }
    });

    this.#client.on('close', () => {
      if (this.#isShuttingDown) {
        this.#logger.info?.('selector.mqtt.disconnected.shutdown');
        return;
      }
      this.#logger.warn?.('selector.mqtt.disconnected.unexpected');
      this.#scheduleReconnect(brokerUrl);
    });

    this.#client.on('offline', () => {
      this.#logger.warn?.('selector.mqtt.offline');
    });
  }

  #scheduleReconnect(brokerUrl) {
    if (this.#isShuttingDown) return;
    if (this.#reconnectAttempts >= this.#maxReconnectAttempts) {
      this.#logger.error?.('selector.mqtt.reconnect.exhausted', { attempts: this.#reconnectAttempts });
      return;
    }
    const backoffMs = Math.min(
      this.#reconnectIntervalMs * Math.pow(this.#reconnectBackoffMultiplier, this.#reconnectAttempts),
      this.#maxReconnectIntervalMs
    );
    this.#reconnectAttempts += 1;
    this.#logger.info?.('selector.mqtt.reconnect.scheduled', { attempt: this.#reconnectAttempts, backoffMs });
    this.#reconnectTimeout = setTimeout(() => this.#connectToBroker(brokerUrl), backoffMs);
  }
}

export default MQTTSelectorAdapter;
```

Create `backend/src/1_adapters/hardware/mqtt-selector/index.mjs`:

```javascript
/**
 * MQTT Selector Adapter
 * @module adapters/hardware/mqtt-selector
 */

export { MQTTSelectorAdapter } from './MQTTSelectorAdapter.mjs';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "$WT" && "$VITEST" run --config /opt/Code/DaylightStation/vitest.config.mjs tests/isolated/assembly/adapters/selector/MQTTSelectorAdapter.test.mjs`
Expected: PASS (all `MQTTSelectorAdapter` tests green).

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/hardware/mqtt-selector/ tests/isolated/assembly/adapters/selector/MQTTSelectorAdapter.test.mjs
git commit -m "feat(fitness): add MQTTSelectorAdapter for rider-selector buttons"
```

---

### Task 2: Wire the selector adapter into `createHardwareAdapters`

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs` (import near line 125; construct in `createHardwareAdapters`, ~line 2062-2095)

- [ ] **Step 1: Add the import**

Near the existing hardware adapter imports (`backend/src/0_system/bootstrap.mjs:125-126`), add:

```javascript
import { MQTTSelectorAdapter } from '#adapters/hardware/mqtt-selector/MQTTSelectorAdapter.mjs';
```

- [ ] **Step 2: Construct the adapter in `createHardwareAdapters`**

In `createHardwareAdapters`, after the `barcodeAdapter` block and before the `return { ttsAdapter, mqttAdapter, barcodeAdapter };`, add a selector adapter block and include it in the return:

```javascript
  // MQTT selector adapter (optional) - rider-selector buttons
  let selectorAdapter = null;
  if (config.mqtt?.host && Array.isArray(config.selectors) && config.selectors.length > 0) {
    selectorAdapter = new MQTTSelectorAdapter(
      {
        host: config.mqtt.host,
        port: config.mqtt.port,
      },
      {
        selectors: config.selectors,
        onSelect: config.onSelectorSelect,
        logger,
      }
    );
  }

  return {
    ttsAdapter,
    mqttAdapter,
    barcodeAdapter,
    selectorAdapter,
  };
```

(Replace the existing `return { ttsAdapter, mqttAdapter, barcodeAdapter };` with the block above.)

- [ ] **Step 3: Verify the file parses**

Run: `cd "$WT" && node --check backend/src/0_system/bootstrap.mjs`
Expected: no output (exit 0).

- [ ] **Step 4: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs
git commit -m "feat(fitness): construct selector adapter in createHardwareAdapters"
```

---

### Task 3: Wire selectors config + broadcast in `app.mjs`

**Files:**
- Modify: `backend/src/app.mjs` (the `createHardwareAdapters({...})` call ~line 1290-1307; the MQTT init block ~line 1314-1322)

- [ ] **Step 1: Pass selectors config + onSelect into createHardwareAdapters**

In the `createHardwareAdapters({ ... })` config object in `app.mjs` (the same object that defines `onMqttMessage` at ~line 1303), add a `selectors` field sourced from the fitness config and an `onSelectorSelect` broadcast callback. Insert immediately after the `onMqttMessage` callback:

```javascript
    selectors: (configService.getHouseholdAppConfig(householdId, 'fitness') || {}).selectors || [],
    onSelectorSelect: (selection) => {
      // selection: { selectorId, equipmentId, userId, action }
      broadcastEvent({ topic: 'rider_select', ...selection });
    },
```

- [ ] **Step 2: Initialize the selector adapter alongside the sensor adapter**

After the existing `if (enableMqtt && hardwareAdapters.mqttAdapter?.isConfigured()) { ... }` block (ends ~line 1324), add:

```javascript
  // Initialize MQTT selector adapter if configured and enabled
  if (enableMqtt && hardwareAdapters.selectorAdapter?.isConfigured()) {
    if (hardwareAdapters.selectorAdapter.init()) {
      rootLogger.info('selector.mqtt.initialized', {
        topics: hardwareAdapters.selectorAdapter.getStatus().topics,
      });
    }
  }
```

- [ ] **Step 3: Verify the file parses**

Run: `cd "$WT" && node --check backend/src/app.mjs`
Expected: no output (exit 0).

- [ ] **Step 4: Commit**

```bash
git add backend/src/app.mjs
git commit -m "feat(fitness): read selectors config and broadcast rider_select events"
```

---

### Task 4: Add the `selectors:` config block (deploy step — data volume, not committed)

**Files:**
- Modify: `data/household/config/fitness.yml` — lives in the Docker data volume, NOT in the git repo. Edit via `sudo docker exec` heredoc (never `sed -i`); see `CLAUDE.local.md`.

This task ships no code commit. It is required for the feature to function at runtime. The button→user mapping must match the physical stickers — confirm with KC before writing.

- [ ] **Step 1: Read the current file and confirm the sticker mapping**

```bash
sudo docker exec daylight-station sh -c 'cat data/household/config/fitness.yml' | sed -n '1,5p'
```

Confirm with KC which user each button sticker names (buttons publish `1_single`..`4_single`).

- [ ] **Step 2: Append the `selectors:` block**

Add a top-level `selectors:` block (sibling to `equipment:`, `users:`, etc.). Example with placeholder mapping — replace user ids to match the stickers:

```yaml
selectors:
  - id: niceday_rider_selector
    mqtt_topic: "zigbee2mqtt-usb/Garage Cycling Selector"
    equipment: niceday
    buttons:
      "1_single": user_2
      "2_single": user_3
      "3_single": user_1
      "4_single": user_4
```

Write the complete file back via heredoc (do not use `sed -i`). Because top-level keys are normalized into `response.fitness` by `FitnessApp.jsx`, no frontend change is needed for the API to expose it; the backend reads `fitnessConfig.selectors` directly via `getHouseholdAppConfig`.

- [ ] **Step 3: Verify the block is present and well-formed**

```bash
sudo docker exec daylight-station sh -c 'grep -n -A8 "^selectors:" data/household/config/fitness.yml'
```

Expected: the `selectors:` block with the four button mappings.

---

### Task 5: Route `rider_select` payloads in `DeviceEventRouter`

**Files:**
- Modify: `frontend/src/hooks/fitness/DeviceEventRouter.js` (`_resolvePayloadType`, ~line 180-202)
- Test: `frontend/src/hooks/fitness/DeviceEventRouter.riderSelect.test.js`

The router resolves a payload type, then dispatches to a registered handler. We add `rider_select` resolution here; the handler is registered by `FitnessSession` in Task 6 (it needs session state). For this task we test only that resolution + dispatch reaches a registered handler.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/fitness/DeviceEventRouter.riderSelect.test.js`:

```javascript
import { describe, it, expect, vi } from 'vitest';
import { DeviceEventRouter } from './DeviceEventRouter.js';

describe('DeviceEventRouter — rider_select', () => {
  it('routes a rider_select payload to a registered rider_select handler', () => {
    const router = new DeviceEventRouter();
    const handler = vi.fn(() => null);
    router.register('rider_select', handler);

    const payload = { topic: 'rider_select', equipmentId: 'niceday', userId: 'user_2', action: '1_single' };
    const result = router.route(payload);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({ equipmentId: 'niceday', userId: 'user_2' });
    expect(result.handled).toBe(true);
  });

  it('does not handle a rider_select payload when no handler is registered', () => {
    const router = new DeviceEventRouter();
    const result = router.route({ topic: 'rider_select', equipmentId: 'niceday', userId: 'user_2' });
    expect(result.handled).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "$WT" && "$VITEST" run --config /opt/Code/DaylightStation/vitest.config.mjs frontend/src/hooks/fitness/DeviceEventRouter.riderSelect.test.js`
Expected: FAIL — first test's `result.handled` is `false` (type not resolved, so no dispatch).

- [ ] **Step 3: Add `rider_select` resolution**

In `DeviceEventRouter._resolvePayloadType` (`frontend/src/hooks/fitness/DeviceEventRouter.js`), add a branch alongside the existing `payload.topic === 'vibration'` check (after line 184):

```javascript
    if (payload.topic === 'rider_select') {
      return 'rider_select';
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "$WT" && "$VITEST" run --config /opt/Code/DaylightStation/vitest.config.mjs frontend/src/hooks/fitness/DeviceEventRouter.riderSelect.test.js`
Expected: PASS (both tests green).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/DeviceEventRouter.js frontend/src/hooks/fitness/DeviceEventRouter.riderSelect.test.js
git commit -m "feat(fitness): resolve rider_select payload type in DeviceEventRouter"
```

---

### Task 6: `equipmentRider` state + handler + evaluate input in `FitnessSession`

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js` (constructor ~line 313; handler registration near the other router setup ~line 372-373; new methods near `getVibrationTracker` ~line 1075; evaluate inputs ~line 1986-1994; reset ~line 2370)
- Test: `frontend/src/hooks/fitness/FitnessSession.equipmentRider.test.js`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/fitness/FitnessSession.equipmentRider.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import FitnessSession from './FitnessSession.js';

describe('FitnessSession — equipmentRider', () => {
  it('starts with no rider claimed (null)', () => {
    const session = new FitnessSession();
    expect(session.getEquipmentRider('niceday')).toBeNull();
  });

  it('records a claim and reads it back', () => {
    const session = new FitnessSession();
    session.setEquipmentRider('niceday', 'user_2');
    expect(session.getEquipmentRider('niceday')).toBe('user_2');
  });

  it('reassigns the claim to the last user set', () => {
    const session = new FitnessSession();
    session.setEquipmentRider('niceday', 'user_2');
    session.setEquipmentRider('niceday', 'user_3');
    expect(session.getEquipmentRider('niceday')).toBe('user_3');
  });

  it('updates the claim when a rider_select event is routed', () => {
    const session = new FitnessSession();
    session.ingestData({ topic: 'rider_select', equipmentId: 'niceday', userId: 'user_1', action: '3_single' });
    expect(session.getEquipmentRider('niceday')).toBe('user_1');
  });
});
```

(If `FitnessSession` is a named export, adjust the import to match the other `FitnessSession.*.test.js` files in this directory — check the top of `FitnessSession.contentId.test.js` first.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "$WT" && "$VITEST" run --config /opt/Code/DaylightStation/vitest.config.mjs frontend/src/hooks/fitness/FitnessSession.equipmentRider.test.js`
Expected: FAIL — `getEquipmentRider is not a function`.

- [ ] **Step 3: Initialize the map in the constructor**

In the `FitnessSession` constructor, next to `this._vibrationTrackers = new Map();` (`frontend/src/hooks/fitness/FitnessSession.js:313`), add:

```javascript
    this._equipmentRider = new Map(); // equipmentId -> userId (current claimed rider; null/absent = unclaimed)
```

- [ ] **Step 4: Add set/get methods**

After `getVibrationTracker` (ends ~line 1082), add:

```javascript
  /**
   * Record the rider currently claiming a piece of equipment (physical selector
   * button press). Sticky until reassigned or the session resets. Last write wins.
   * @param {string} equipmentId
   * @param {string} userId
   */
  setEquipmentRider(equipmentId, userId) {
    if (!equipmentId || !userId) return;
    const prev = this._equipmentRider.get(String(equipmentId)) || null;
    this._equipmentRider.set(String(equipmentId), String(userId));
    getLogger().info('fitness.rider.claimed', { equipmentId: String(equipmentId), userId: String(userId), previousRider: prev });
  }

  /**
   * Get the currently claimed rider for a piece of equipment.
   * @param {string} equipmentId
   * @returns {string|null}
   */
  getEquipmentRider(equipmentId) {
    return this._equipmentRider?.get(String(equipmentId)) || null;
  }
```

- [ ] **Step 5: Register the `rider_select` router handler**

Near where the router is configured in the constructor (after `this._deviceRouter.setDeviceManager(this.deviceManager);` at `frontend/src/hooks/fitness/FitnessSession.js:373`), add:

```javascript
    this._deviceRouter.register('rider_select', (payload) => {
      this.setEquipmentRider(payload.equipmentId, payload.userId);
      return null; // no device object; claim state lives on the session
    });
```

(`getLogger` is already imported in this file — it's used throughout.)

- [ ] **Step 6: Run test to verify it passes**

Run: `cd "$WT" && "$VITEST" run --config /opt/Code/DaylightStation/vitest.config.mjs frontend/src/hooks/fitness/FitnessSession.equipmentRider.test.js`
Expected: PASS (all four tests green).

- [ ] **Step 7: Thread `equipmentRiderMap` into the governance evaluate inputs**

In the method that builds `equipmentCadenceMap` and calls `this.governanceEngine.evaluate({...})` (`frontend/src/hooks/fitness/FitnessSession.js:1976-1992`), build a sibling map and pass it. Replace the `evaluate({...})` call's argument with one that adds `equipmentRiderMap`:

```javascript
    // Build equipmentRiderMap: equipmentId -> claimed userId (or absent if unclaimed)
    const equipmentRiderMap = {};
    this._equipmentRider.forEach((userId, equipmentId) => {
      if (userId) equipmentRiderMap[equipmentId] = userId;
    });

    this.governanceEngine.evaluate({
        activeParticipants,
        userZoneMap,
        zoneRankMap,
        zoneInfoMap,
        totalCount: activeParticipants.length,
        hrInactiveUsers,
        equipmentCadenceMap,
        equipmentRiderMap
    });
```

- [ ] **Step 8: Clear the claim map on session teardown**

In the teardown block where vibration trackers are cleared (`frontend/src/hooks/fitness/FitnessSession.js:2370-2372`), add alongside the `this._vibrationTrackers.clear();`:

```javascript
    // Clear rider claims
    this._equipmentRider?.clear();
    this._equipmentRider = null;
```

- [ ] **Step 9: Verify the equipmentRider test still passes**

Run: `cd "$WT" && "$VITEST" run --config /opt/Code/DaylightStation/vitest.config.mjs frontend/src/hooks/fitness/FitnessSession.equipmentRider.test.js`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/hooks/fitness/FitnessSession.js frontend/src/hooks/fitness/FitnessSession.equipmentRider.test.js
git commit -m "feat(fitness): session-scoped equipmentRider claim state + evaluate input"
```

---

### Task 7: Consume the claim in `GovernanceEngine`

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js` (`evaluate` signature ~line 1743; early capture ~line 1875; `_latestInputs` write ~line 1986-1994; `_getEligibleUsers` ~line 326-333; `_startCycleChallenge` ~line 2436-2491; live-swap reconcile inside `evaluate` after the active-cycle tick)
- Test: `frontend/src/hooks/fitness/CycleStateMachine.test.js`

**Behavior:** claim grants eligibility (union into `_getEligibleUsers`); rider precedence in `_startCycleChallenge` is `forceRiderId` > standing claim > random-from-eligible; a claim change mid-challenge triggers a force swap during the swap window.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/hooks/fitness/CycleStateMachine.test.js` (the fixtures `buildSession`, `POLICY`, `CYCLE_SELECTION_ID`, `seededRng` already exist at the top of this file; reuse them):

```javascript
describe('Cycle SM — standing rider claim', () => {
  // buildSession()'s catalog uses equipment id 'cycle_ace' with eligible ['user_2'].
  // We exercise claim consumption through _startCycleChallenge + _getEligibleUsers.

  function makeEngine(seed = 42, equipmentRiderMap = {}) {
    let nowValue = 100000;
    const session = buildSession();
    const engine = new GovernanceEngine(session, { now: () => nowValue, random: seededRng(seed) });
    engine.configure(POLICY);
    engine.setMedia({ id: 'v1', type: 'episode', labels: ['cardio'] });
    // Seed the claim map the way FitnessSession would via evaluate().
    engine._latestInputs.equipmentRiderMap = equipmentRiderMap;
    return engine;
  }

  it('uses the standing claim as the rider when one is set', () => {
    const engine = makeEngine(42, { cycle_ace: 'user_2' });
    const active = engine._startCycleChallenge(
      { id: CYCLE_SELECTION_ID, equipment: 'cycle_ace', init: {}, hi_rpm_range: [60, 60], segment_count: [1, 1], segment_duration_seconds: [2, 2], ramp_seconds: [5, 5], lo_rpm_ratio: 0.5 },
      {}
    );
    expect(active.ok).not.toBe(false);
    expect(active.rider).toBe('user_2');
  });

  it('grants eligibility to a claimed rider not in eligible_users', () => {
    // 'user_1' is NOT in cycle_ace.eligible_users (['user_2']) in buildSession().
    const engine = makeEngine(42, { cycle_ace: 'user_1' });
    expect(engine._getEligibleUsers('cycle_ace')).toContain('user_1');
    const active = engine._startCycleChallenge(
      { id: CYCLE_SELECTION_ID, equipment: 'cycle_ace', init: {}, hi_rpm_range: [60, 60], segment_count: [1, 1], segment_duration_seconds: [2, 2], ramp_seconds: [5, 5], lo_rpm_ratio: 0.5 },
      {}
    );
    expect(active.rider).toBe('user_1');
  });

  it('falls back to random-from-eligible when no claim is set', () => {
    const engine = makeEngine(42, {}); // no claim
    const active = engine._startCycleChallenge(
      { id: CYCLE_SELECTION_ID, equipment: 'cycle_ace', init: {}, hi_rpm_range: [60, 60], segment_count: [1, 1], segment_duration_seconds: [2, 2], ramp_seconds: [5, 5], lo_rpm_ratio: 0.5 },
      {}
    );
    expect(active.rider).toBe('user_2'); // only eligible user
  });

  it('forceRiderId takes precedence over a standing claim', () => {
    const engine = makeEngine(42, { cycle_ace: 'user_3' }); // claim says user_3...
    const active = engine._startCycleChallenge(
      { id: CYCLE_SELECTION_ID, equipment: 'cycle_ace', init: {}, hi_rpm_range: [60, 60], segment_count: [1, 1], segment_duration_seconds: [2, 2], ramp_seconds: [5, 5], lo_rpm_ratio: 0.5 },
      { forceRiderId: 'user_2' } // ...but force wins
    );
    expect(active.rider).toBe('user_2');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "$WT" && "$VITEST" run --config /opt/Code/DaylightStation/vitest.config.mjs frontend/src/hooks/fitness/CycleStateMachine.test.js -t "standing rider claim"`
Expected: FAIL — claim is ignored (random/force only), and `_getEligibleUsers` does not include `user_1`.

- [ ] **Step 3: Accept `equipmentRiderMap` in `evaluate` and store it**

In `evaluate({ ... })` (`frontend/src/hooks/fitness/GovernanceEngine.js:1743`), add `equipmentRiderMap` to the destructured params:

```javascript
  evaluate({ activeParticipants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount, hrInactiveUsers, equipmentCadenceMap, equipmentRiderMap } = {}) {
```

Immediately after the early `equipmentCadenceMap` capture block (~line 1875-1877), add a parallel capture so the claim survives pulse-timer evaluate() calls that omit it:

```javascript
    if (equipmentRiderMap && typeof equipmentRiderMap === 'object') {
      this._latestInputs.equipmentRiderMap = { ...equipmentRiderMap };
    }
```

In the `_latestInputs = { ... }` rebuild that includes `equipmentCadenceMap` (~line 1986-1994), add a sibling line so the value is preserved on the full-rebuild path:

```javascript
        equipmentRiderMap: equipmentRiderMap && typeof equipmentRiderMap === 'object'
          ? { ...equipmentRiderMap }
          : (this._latestInputs?.equipmentRiderMap || {}),
```

Also add `equipmentRiderMap: {}` to the three other `_latestInputs = {` initializers (constructor ~line 261, reset ~line 837, ~line 1474) so the property always exists. For the preserve-on-throttle block (~line 1551-1558), add `const preservedEquipmentRiderMap = this._latestInputs?.equipmentRiderMap || {};` and include `equipmentRiderMap: preservedEquipmentRiderMap` in that rebuild.

- [ ] **Step 4: Union the claim into `_getEligibleUsers`**

Replace the body of `_getEligibleUsers` (`frontend/src/hooks/fitness/GovernanceEngine.js:326-333`) so a standing claim is treated as eligible:

```javascript
  _getEligibleUsers(equipmentId) {
    if (!equipmentId) return [];
    const catalog = this.session?._deviceRouter?.getEquipmentCatalog?.() || [];
    const entry = catalog.find(e => e.id === equipmentId);
    const base = (entry && Array.isArray(entry.eligible_users)) ? [...entry.eligible_users] : [];
    // A physical claim grants eligibility for that equipment (authoritative selector).
    const claimed = this._latestInputs?.equipmentRiderMap?.[equipmentId];
    if (claimed && !base.includes(claimed)) base.push(claimed);
    return base;
  }
```

- [ ] **Step 5: Add claim precedence in `_startCycleChallenge`**

In `_startCycleChallenge` (`frontend/src/hooks/fitness/GovernanceEngine.js:2436`), make two edits.

(a) Source `eligible` from `_getEligibleUsers` (which now includes the claim) instead of the raw catalog field. Replace line 2447:

```javascript
    const eligible = this._getEligibleUsers(selection.equipment);
```

(b) Insert a standing-claim branch between the `forceRiderId` branch and the random `else` branch. The current structure is `if (ctx.forceRiderId) { ... } else { ...random... }`. Change it to `if (ctx.forceRiderId) { ... } else if (claimedRider) { ... } else { ...random... }` by inserting, right before the existing `} else {` that opens the random branch:

```javascript
    } else if (this._latestInputs?.equipmentRiderMap?.[selection.equipment]) {
      // Standing claim: the rider physically claimed this bike. Authoritative —
      // skip the cooldown filter (a deliberate press overrides cooldown).
      const claimedRider = this._latestInputs.equipmentRiderMap[selection.equipment];
      rider = claimedRider;
      riderPool = [claimedRider];
```

(The existing `} else {` then becomes the final fallback; leave its random-pick body unchanged.)

- [ ] **Step 6: Run the standing-claim tests to verify they pass**

Run: `cd "$WT" && "$VITEST" run --config /opt/Code/DaylightStation/vitest.config.mjs frontend/src/hooks/fitness/CycleStateMachine.test.js -t "standing rider claim"`
Expected: PASS (all four new tests green).

- [ ] **Step 7: Add the live-swap reconcile + its test**

Append to `CycleStateMachine.test.js`:

```javascript
describe('Cycle SM — live rider swap on claim change', () => {
  it('force-swaps the active rider when the claim changes during the swap window', () => {
    let nowValue = 100000;
    const session = buildSession();
    const engine = new GovernanceEngine(session, { now: () => nowValue, random: seededRng(42) });
    engine.configure(POLICY);
    engine.setMedia({ id: 'v1', type: 'episode', labels: ['cardio'] });
    // Start with user_2 riding (manual trigger forces user_2, state = init).
    engine.triggerChallenge({ type: 'cycle', selectionId: CYCLE_SELECTION_ID, riderId: 'user_2' });
    expect(engine.challengeState.activeChallenge.rider).toBe('user_2');

    // A new claim arrives for user_3 on the same equipment, then a tick runs.
    engine._latestInputs.equipmentRiderMap = { cycle_ace: 'user_3' };
    nowValue += 200;
    engine.evaluate({
      activeParticipants: ['user_2', 'user_3'],
      userZoneMap: { user_2: 'warm', user_3: 'warm' },
      zoneRankMap: { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 },
      zoneInfoMap: { warm: { id: 'warm', name: 'Warm' } },
      totalCount: 2,
      equipmentCadenceMap: { cycle_ace: { rpm: 70, connected: true, ts: nowValue } },
      equipmentRiderMap: { cycle_ace: 'user_3' }
    });

    expect(engine.challengeState.activeChallenge.rider).toBe('user_3');
  });
});
```

Run it to confirm it fails: `cd "$WT" && "$VITEST" run --config /opt/Code/DaylightStation/vitest.config.mjs frontend/src/hooks/fitness/CycleStateMachine.test.js -t "live rider swap"`
Expected: FAIL — rider stays `user_2`.

Now add the reconcile. In `evaluate`, locate where the active cycle challenge is ticked each cycle (the block that processes `this.challengeState.activeChallenge` when `active.type === 'cycle'` — search for `tickManualCycle` / `_evaluateCycleChallenge` call site inside `evaluate`). Immediately BEFORE that per-tick cycle processing, add a reconcile that swaps to a changed claim:

```javascript
    // Reconcile a changed standing claim: a physical re-press during the swap
    // window reassigns the active cycle rider (force = bypass cooldown).
    const _activeCycle = this.challengeState?.activeChallenge;
    if (_activeCycle && _activeCycle.type === 'cycle') {
      const _claim = this._latestInputs?.equipmentRiderMap?.[_activeCycle.equipment];
      if (_claim && _claim !== _activeCycle.rider) {
        this.swapCycleRider(_claim, { force: true });
      }
    }
```

(`swapCycleRider` already no-ops with a logged reason when the swap window is closed, so this is safe to call every tick.)

- [ ] **Step 8: Run the full cycle test file**

Run: `cd "$WT" && "$VITEST" run --config /opt/Code/DaylightStation/vitest.config.mjs frontend/src/hooks/fitness/CycleStateMachine.test.js`
Expected: PASS (all pre-existing tests plus the new claim + swap tests green).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js frontend/src/hooks/fitness/CycleStateMachine.test.js
git commit -m "feat(fitness): governance consumes standing rider claim (eligibility, precedence, live swap)"
```

---

### Task 8: Show the claimed rider on the bike avatar

**Files:**
- Modify: `frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx` (the `rpm-group` block, ~line 815-844)

The live player renders each RPM device with `RpmDeviceAvatar` (`@/modules/Fitness/components/RpmDeviceAvatar.jsx`), passing `avatarSrc` = the equipment image. When a rider has claimed that equipment, show the rider's user avatar instead, so "who's riding" is visible without a challenge. This is a visual change verified by manual check (no unit test — the rpm-group render path has no isolated harness).

- [ ] **Step 1: Read the rider claim for each rpm device**

Inside the `rpmDevices.map(rpmDevice => { ... })` block (`FitnessUsers.jsx`, after `const equipmentId = equipmentInfo?.id || String(rpmDevice.deviceId);`, ~line 818), add:

```javascript
                        const claimedRiderId = fitnessContext.fitnessSessionInstance?.getEquipmentRider?.(equipmentId) || null;
                        const riderAvatarSrc = claimedRiderId
                          ? DaylightMediaPath(`/static/img/users/${claimedRiderId}`)
                          : null;
```

(`fitnessContext` is already in scope in this component — it is used at line ~855 for `fitnessContext.fitnessSessionInstance?.getVibrationTracker`. `DaylightMediaPath` is already imported and used in this block.)

- [ ] **Step 2: Use the rider avatar when claimed**

In the `<RpmDeviceAvatar ... />` props within that block (~line 830-841), change `avatarSrc` and `avatarAlt` to prefer the rider when claimed:

```javascript
                            avatarSrc={riderAvatarSrc || DaylightMediaPath(`/static/img/equipment/${equipmentId}`)}
                            avatarAlt={claimedRiderId ? claimedRiderId : deviceName}
```

(Leave `fallbackSrc={DaylightMediaPath('/static/img/equipment/equipment')}` as-is — if the user image 404s it falls back to the generic equipment image.)

- [ ] **Step 3: Manual verification**

Build and run the fitness app (dev server), open a session with the NiceDay bike present, and either press a physical selector button or simulate one by publishing to the topic:

```bash
sudo docker exec daylight-station node -e "
const mqtt=require('mqtt');const c=mqtt.connect('mqtt://mosquitto:1883');
c.on('connect',()=>{c.publish('zigbee2mqtt-usb/Garage Cycling Selector', JSON.stringify({action:'1_single'}), ()=>{c.end();process.exit(0);});});
"
```

Expected: the NiceDay RPM avatar swaps from the equipment image to the rider's user avatar; backend logs show `selector.mqtt.select`; frontend session logs show `fitness.rider.claimed`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx
git commit -m "feat(fitness): show claimed rider avatar on the NiceDay RPM card"
```

---

## Final verification

- [ ] **Run the full affected test set**

```bash
cd "$WT" && "$VITEST" run --config /opt/Code/DaylightStation/vitest.config.mjs \
  tests/isolated/assembly/adapters/selector/MQTTSelectorAdapter.test.mjs \
  frontend/src/hooks/fitness/DeviceEventRouter.riderSelect.test.js \
  frontend/src/hooks/fitness/FitnessSession.equipmentRider.test.js \
  frontend/src/hooks/fitness/CycleStateMachine.test.js
```
Expected: all PASS.

- [ ] **Deploy the config (Task 4)** to the data volume if not already done, and **deploy the app** per `CLAUDE.local.md` (build + `deploy-daylight`) so the backend picks up the new adapter and `selectors` config.

- [ ] **End-to-end check:** press each physical button; confirm the correct rider claims the NiceDay bike (avatar updates), and that a cycle challenge on the NiceDay uses the claimed rider.
