# Garage Fan Trigger Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task.

**Goal:** Turn on the Home Assistant smart-plug fan `switch.garage_fan_plug_temp` once per session when someone pedals a fanned bike ≥ its `min_rpm`, any active participant is in HR-zone `warm`+, and `sensor.garage_temp_temperature` > 65°F. Trigger-on only (a separate system turns it off).

**Architecture:** Frontend-driven, piggybacking the existing ambient-LED path. `FitnessContext` already holds RPM + HR zones; it POSTs a state snapshot to a new `/api/v1/fitness/equipment_fan` route. A backend `GarageFanAdapter` evaluates the conditions (reading garage temp from HA on demand) and fires the switch, latching per session. Shared machinery is extracted: `HaActionGuard` (backend throttle/circuit-breaker/metrics) and `useFitnessStateSync` (frontend debounce/throttle/beacon). The fan config nests under `equipment[].fan` and the adapter scans **all** equipment, so adding a fan elsewhere is config-only.

**Tech Stack:** Node ESM (`.mjs`) backend, React (`.jsx`) frontend, Vitest for unit tests (`tests/isolated/`), Home Assistant REST via `HomeAssistantAdapter`.

**Design doc:** `docs/_wip/plans/2026-06-06-garage-fan-trigger-design.md`

**Decisions locked in brainstorming:** frontend piggyback; "warm" = any active participant (no bike→rider matching); fire-once-per-session latch; re-arm on session end; LED migration onto `HaActionGuard` is a deferred follow-up (do NOT touch `AmbientLedAdapter` here).

---

## Conventions

- **Run a single backend/unit test file:**
  ```bash
  frontend/node_modules/.bin/vitest run --config vitest.config.mjs <path-to-test-file>
  ```
- **Test imports** use path aliases: `#adapters/...`, `#system/...`. Mirror `tests/isolated/adapter/fitness/AmbientLedAdapter.test.mjs`.
- **Mocks:** `import { vi } from 'vitest'`; `vi.fn().mockResolvedValue(...)`.
- **Commit after every green task.** Use `git add <specific files>` (never `git add -A`).
- **Do NOT run `deploy.sh`.** Do NOT modify `AmbientLedAdapter.mjs`.
- Config block already present in `data/household/config/fitness.yml` under `equipment[] → NiceDay → fan`.

---

## Task 1: `HaActionGuard` — shared HA-call guard

The reusable guard: throttle + circuit-breaker + dedup + metrics + `getStatus`/`getMetrics`/`reset`. No fitness/fan specifics.

**Files:**
- Create: `backend/src/1_adapters/fitness/HaActionGuard.mjs`
- Test: `tests/isolated/adapter/fitness/HaActionGuard.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/isolated/adapter/fitness/HaActionGuard.test.mjs
import { vi } from 'vitest';
import { HaActionGuard } from '#adapters/fitness/HaActionGuard.mjs';

describe('HaActionGuard', () => {
  let guard;
  beforeEach(() => {
    guard = new HaActionGuard({ name: 'test', logger: { error: vi.fn(), debug: vi.fn() } });
  });

  test('runs the action and returns ok when it succeeds', async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    const r = await guard.run({ key: 'a', throttleMs: 0, action });
    expect(action).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: true, key: 'a' });
    expect(r.skipped).toBeFalsy();
  });

  test('skips a duplicate key without calling the action', async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    await guard.run({ key: 'a', throttleMs: 0, action });
    const r = await guard.run({ key: 'a', throttleMs: 0, action });
    expect(action).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: true, skipped: true, reason: 'duplicate' });
  });

  test('rate-limits within the throttle window', async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    await guard.run({ key: 'a', throttleMs: 60000, action });
    const r = await guard.run({ key: 'b', throttleMs: 60000, action });
    expect(action).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: true, skipped: true, reason: 'rate_limited' });
  });

  test('opens the circuit after maxFailures and then skips with reason backoff', async () => {
    const action = vi.fn().mockResolvedValue({ ok: false, error: 'boom' });
    const g = new HaActionGuard({ name: 't', maxFailures: 2, logger: { error: vi.fn() } });
    const r1 = await g.run({ key: '1', throttleMs: 0, action });
    expect(r1.ok).toBe(false);
    const r2 = await g.run({ key: '2', throttleMs: 0, action }); // hits maxFailures → opens
    expect(r2.ok).toBe(false);
    const r3 = await g.run({ key: '3', throttleMs: 0, action }); // now in backoff
    expect(r3).toMatchObject({ ok: true, skipped: true, reason: 'backoff' });
  });

  test('reset clears latch/backoff state', async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    await guard.run({ key: 'a', throttleMs: 60000, action });
    guard.reset();
    const r = await guard.run({ key: 'a', throttleMs: 60000, action });
    expect(action).toHaveBeenCalledTimes(2); // dedup + throttle both cleared
    expect(r.skipped).toBeFalsy();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/adapter/fitness/HaActionGuard.test.mjs
```
Expected: FAIL — `Cannot find module '#adapters/fitness/HaActionGuard.mjs'`.

**Step 3: Write minimal implementation**

```javascript
// backend/src/1_adapters/fitness/HaActionGuard.mjs
/**
 * HaActionGuard — reusable guard rails around a single Home Assistant action.
 * Provides throttle, circuit-breaker, dedup, and metrics. Provider-agnostic;
 * the caller supplies `action` (an async fn returning { ok }).
 */
export class HaActionGuard {
  constructor({ logger, name = 'ha-action', maxFailures = 5 } = {}) {
    this.name = name;
    this.logger = logger || console;
    this.maxFailures = maxFailures;
    this.failureCount = 0;
    this.backoffUntil = 0;
    this.lastKey = null;
    this.lastRunAt = 0;
    this.metrics = {
      totalRequests: 0, ranCount: 0, failureCount: 0,
      skippedDuplicate: 0, skippedRateLimited: 0, skippedBackoff: 0,
      uptimeStart: Date.now()
    };
  }

  /**
   * @param {Object} opts
   * @param {string} opts.key - dedup key (skip if same as last successful run)
   * @param {number} [opts.throttleMs=2000] - min ms between runs
   * @param {boolean} [opts.dedupe=true]
   * @param {boolean} [opts.force=false] - bypass dedup + throttle
   * @param {Function} opts.action - async () => ({ ok, ... })
   */
  async run({ key, throttleMs = 2000, dedupe = true, force = false, action }) {
    this.metrics.totalRequests++;
    const now = Date.now();

    if (this.backoffUntil > now) {
      this.metrics.skippedBackoff++;
      return { ok: true, skipped: true, reason: 'backoff' };
    }
    if (dedupe && !force && key != null && key === this.lastKey) {
      this.metrics.skippedDuplicate++;
      return { ok: true, skipped: true, reason: 'duplicate', key };
    }
    if (!force && (now - this.lastRunAt) < throttleMs) {
      this.metrics.skippedRateLimited++;
      return { ok: true, skipped: true, reason: 'rate_limited' };
    }

    try {
      const result = await action();
      if (!result || result.ok === false) {
        throw new Error(result?.error || 'HA action failed');
      }
      this.failureCount = 0;
      if (key != null) this.lastKey = key;
      this.lastRunAt = now;
      this.metrics.ranCount++;
      return { ok: true, key, result };
    } catch (error) {
      this.failureCount++;
      this.metrics.failureCount++;
      if (this.failureCount >= this.maxFailures) {
        const backoffMs = Math.min(60000, 1000 * Math.pow(2, this.failureCount - this.maxFailures));
        this.backoffUntil = now + backoffMs;
        this.logger.error?.(`${this.name}.circuit_open`, { failureCount: this.failureCount, backoffMs, error: error.message });
      } else {
        this.logger.error?.(`${this.name}.failed`, { error: error.message, failureCount: this.failureCount });
      }
      return { ok: false, error: error.message, failureCount: this.failureCount };
    }
  }

  getStatus() {
    return {
      lastKey: this.lastKey,
      lastRunAt: this.lastRunAt,
      failureCount: this.failureCount,
      backoffUntil: this.backoffUntil,
      isInBackoff: this.backoffUntil > Date.now()
    };
  }

  getMetrics() {
    return { ...this.metrics, uptimeMs: Date.now() - this.metrics.uptimeStart };
  }

  reset() {
    this.failureCount = 0;
    this.backoffUntil = 0;
    this.lastKey = null;
    this.lastRunAt = 0;
    return { ok: true, reset: true };
  }
}
```

**Step 4: Run test to verify it passes** — same command as Step 2. Expected: PASS (5 tests).

**Step 5: Commit**

```bash
git add backend/src/1_adapters/fitness/HaActionGuard.mjs tests/isolated/adapter/fitness/HaActionGuard.test.mjs
git commit -m "feat(fitness): add HaActionGuard shared HA-call guard"
```

---

## Task 2: `GarageFanAdapter` — condition eval + latch + fire

**Files:**
- Create: `backend/src/1_adapters/fitness/GarageFanAdapter.mjs`
- Test: `tests/isolated/adapter/fitness/GarageFanAdapter.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/isolated/adapter/fitness/GarageFanAdapter.test.mjs
import { vi } from 'vitest';
import { GarageFanAdapter } from '#adapters/fitness/GarageFanAdapter.mjs';

const fanCfg = () => ({
  equipment: [
    {
      name: 'NiceDay', id: 'niceday', type: 'stationary_bike', cadence: 7138,
      fan: { plug_entity: 'garage_fan_plug_temp', temp_entity: 'garage_temp_temperature', min_temp: 65, min_rpm: 30, min_hr_zone: 'warm' }
    },
    { name: 'NoFan', id: 'nofan', cadence: 999 } // no fan block → ignored
  ]
});

const ALL_GO = {
  rpm: { '7138': 72 },
  zones: [{ zoneId: 'warm', isActive: true }],
  sessionEnded: false,
  householdId: 'test'
};

describe('GarageFanAdapter', () => {
  let gateway, loadFitnessConfig, adapter;
  beforeEach(() => {
    gateway = {
      getState: vi.fn().mockResolvedValue({ state: '70' }), // 70°F
      callService: vi.fn().mockResolvedValue({ ok: true })
    };
    loadFitnessConfig = vi.fn().mockReturnValue(fanCfg());
    adapter = new GarageFanAdapter({ gateway, loadFitnessConfig, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } });
  });

  test('constructor throws without gateway', () => {
    expect(() => new GarageFanAdapter({ loadFitnessConfig })).toThrow('requires gateway');
  });

  test('fires switch.turn_on when all conditions are met', async () => {
    const r = await adapter.evaluate(ALL_GO);
    expect(gateway.callService).toHaveBeenCalledWith('switch', 'turn_on', { entity_id: 'switch.garage_fan_plug_temp' });
    expect(r.results.find(x => x.equipmentId === 'niceday')).toMatchObject({ activated: true });
  });

  test('reads garage temp from the normalized sensor entity', async () => {
    await adapter.evaluate(ALL_GO);
    expect(gateway.getState).toHaveBeenCalledWith('sensor.garage_temp_temperature');
  });

  test('does NOT fire when rpm below min_rpm', async () => {
    const r = await adapter.evaluate({ ...ALL_GO, rpm: { '7138': 10 } });
    expect(gateway.callService).not.toHaveBeenCalled();
    expect(r.results.find(x => x.equipmentId === 'niceday')).toMatchObject({ reason: 'rpm_below' });
  });

  test('does NOT fire when no active participant in warm+', async () => {
    const r = await adapter.evaluate({ ...ALL_GO, zones: [{ zoneId: 'active', isActive: true }] });
    expect(gateway.callService).not.toHaveBeenCalled();
    expect(r.results.find(x => x.equipmentId === 'niceday')).toMatchObject({ reason: 'zone_below' });
  });

  test('hot rider satisfies min_hr_zone warm', async () => {
    await adapter.evaluate({ ...ALL_GO, zones: [{ zoneId: 'hot', isActive: true }] });
    expect(gateway.callService).toHaveBeenCalledTimes(1);
  });

  test('does NOT fire when temp at/below min_temp', async () => {
    gateway.getState.mockResolvedValue({ state: '65' }); // not strictly > 65
    const r = await adapter.evaluate(ALL_GO);
    expect(gateway.callService).not.toHaveBeenCalled();
    expect(r.results.find(x => x.equipmentId === 'niceday')).toMatchObject({ reason: 'temp_below' });
  });

  test('fails closed when temp sensor unavailable', async () => {
    gateway.getState.mockResolvedValue(null);
    const r = await adapter.evaluate(ALL_GO);
    expect(gateway.callService).not.toHaveBeenCalled();
    expect(r.results.find(x => x.equipmentId === 'niceday')).toMatchObject({ reason: 'temp_unavailable' });
  });

  test('latches: fires once, then skips on subsequent evaluate', async () => {
    await adapter.evaluate(ALL_GO);
    const r = await adapter.evaluate(ALL_GO);
    expect(gateway.callService).toHaveBeenCalledTimes(1);
    expect(r.results.find(x => x.equipmentId === 'niceday')).toMatchObject({ reason: 'latched' });
  });

  test('sessionEnded re-arms the latch', async () => {
    await adapter.evaluate(ALL_GO);
    await adapter.evaluate({ ...ALL_GO, sessionEnded: true });
    await adapter.evaluate(ALL_GO);
    expect(gateway.callService).toHaveBeenCalledTimes(2);
  });

  test('skips entirely when no equipment has a fan block', async () => {
    loadFitnessConfig.mockReturnValue({ equipment: [{ id: 'x', cadence: 1 }] });
    const r = await adapter.evaluate(ALL_GO);
    expect(r).toMatchObject({ skipped: true, reason: 'no_fan_config' });
  });
});
```

**Step 2: Run test to verify it fails** — Expected: module-not-found.

**Step 3: Write minimal implementation**

```javascript
// backend/src/1_adapters/fitness/GarageFanAdapter.mjs
/**
 * GarageFanAdapter — fires a Home Assistant smart-plug fan when a fanned
 * piece of equipment is being pedaled hard, a participant is in a warm-enough
 * HR zone, and the garage is warm enough. Trigger-on only (latches per session;
 * a separate system turns the fan off). Scans `equipment[].fan` so any bike can
 * have a fan with zero code changes.
 */
import { HaActionGuard } from './HaActionGuard.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const ZONE_ORDER = ['cool', 'active', 'warm', 'hot', 'fire'];

function zoneRank(zoneId) {
  if (!zoneId) return -1;
  return ZONE_ORDER.indexOf(String(zoneId).toLowerCase().trim());
}

function normalizeEntity(id, domain) {
  if (!id) return null;
  const s = String(id).trim();
  return s.includes('.') ? s : `${domain}.${s}`;
}

function cadenceIds(equipment) {
  const c = equipment?.cadence;
  if (c == null) return [];
  return (Array.isArray(c) ? c : [c]).map((x) => String(x));
}

export class GarageFanAdapter {
  #gateway;
  #loadFitnessConfig;
  #logger;
  #guard;
  #latched;

  constructor(config) {
    if (!config?.gateway) {
      throw new InfrastructureError('GarageFanAdapter requires gateway', { code: 'MISSING_DEPENDENCY', dependency: 'gateway' });
    }
    if (!config?.loadFitnessConfig) {
      throw new InfrastructureError('GarageFanAdapter requires loadFitnessConfig', { code: 'MISSING_DEPENDENCY', dependency: 'loadFitnessConfig' });
    }
    this.#gateway = config.gateway;
    this.#loadFitnessConfig = config.loadFitnessConfig;
    this.#logger = config.logger || console;
    this.#guard = new HaActionGuard({ logger: this.#logger, name: 'fitness.equipment_fan' });
    this.#latched = new Set();
  }

  #fannedEquipment(fitnessConfig) {
    const list = Array.isArray(fitnessConfig?.equipment) ? fitnessConfig.equipment : [];
    return list.filter((e) => e?.fan && e.fan.plug_entity);
  }

  #maxActiveZoneRank(zones) {
    let max = -1;
    for (const z of Array.isArray(zones) ? zones : []) {
      if (z?.isActive === false) continue;
      max = Math.max(max, zoneRank(z?.zoneId));
    }
    return max;
  }

  async evaluate({ rpm = {}, zones = [], sessionEnded = false, householdId } = {}) {
    const fitnessConfig = this.#loadFitnessConfig(householdId);
    const fanned = this.#fannedEquipment(fitnessConfig);
    if (fanned.length === 0) {
      return { ok: true, skipped: true, reason: 'no_fan_config' };
    }

    const maxZoneRank = this.#maxActiveZoneRank(zones);
    const results = [];

    for (const equipment of fanned) {
      const key = `${householdId || 'default'}:${equipment.id}`;
      const fan = equipment.fan;

      if (sessionEnded) {
        this.#latched.delete(key);
        results.push({ equipmentId: equipment.id, skipped: true, reason: 'session_ended' });
        continue;
      }
      if (this.#latched.has(key)) {
        results.push({ equipmentId: equipment.id, skipped: true, reason: 'latched' });
        continue;
      }

      const minRpm = Number(fan.min_rpm ?? 0);
      const maxRpm = cadenceIds(equipment).reduce((m, id) => Math.max(m, Number(rpm?.[id] ?? 0)), 0);
      if (maxRpm < minRpm) {
        results.push({ equipmentId: equipment.id, skipped: true, reason: 'rpm_below', maxRpm, minRpm });
        continue;
      }

      const minZoneRank = zoneRank(fan.min_hr_zone);
      if (minZoneRank < 0 || maxZoneRank < minZoneRank) {
        results.push({ equipmentId: equipment.id, skipped: true, reason: 'zone_below', maxZoneRank, minZoneRank });
        continue;
      }

      const tempEntity = normalizeEntity(fan.temp_entity, 'sensor');
      const minTemp = Number(fan.min_temp ?? -Infinity);
      const tempState = await this.#gateway.getState(tempEntity);
      const tempVal = parseFloat(tempState?.state);
      if (!Number.isFinite(tempVal)) {
        this.#logger.warn?.('fitness.equipment_fan.temp_unavailable', { tempEntity, state: tempState?.state, equipmentId: equipment.id });
        results.push({ equipmentId: equipment.id, skipped: true, reason: 'temp_unavailable' });
        continue;
      }
      if (tempVal <= minTemp) {
        results.push({ equipmentId: equipment.id, skipped: true, reason: 'temp_below', tempVal, minTemp });
        continue;
      }

      const plugEntity = normalizeEntity(fan.plug_entity, 'switch');
      const runResult = await this.#guard.run({
        key,
        throttleMs: Number(fan.throttle_ms ?? 5000),
        action: () => this.#gateway.callService('switch', 'turn_on', { entity_id: plugEntity })
      });

      if (runResult.ok && !runResult.skipped) {
        this.#latched.add(key);
        this.#logger.info?.('fitness.equipment_fan.activated', { equipmentId: equipment.id, plugEntity, maxRpm, tempVal, householdId });
        results.push({ equipmentId: equipment.id, activated: true, plugEntity, tempVal, maxRpm });
      } else if (runResult.ok) {
        results.push({ equipmentId: equipment.id, skipped: true, reason: runResult.reason });
      } else {
        results.push({ equipmentId: equipment.id, ok: false, error: runResult.error });
      }
    }

    return { ok: true, results };
  }

  getStatus(householdId) {
    const fitnessConfig = this.#loadFitnessConfig(householdId);
    const fanned = this.#fannedEquipment(fitnessConfig);
    return {
      enabled: fanned.length > 0,
      fans: fanned.map((e) => ({
        id: e.id,
        plug: normalizeEntity(e.fan.plug_entity, 'switch'),
        tempEntity: normalizeEntity(e.fan.temp_entity, 'sensor'),
        minTemp: e.fan.min_temp,
        minRpm: e.fan.min_rpm,
        minHrZone: e.fan.min_hr_zone,
        latched: this.#latched.has(`${householdId || 'default'}:${e.id}`)
      })),
      guard: this.#guard.getStatus()
    };
  }

  getMetrics() {
    return this.#guard.getMetrics();
  }

  reset() {
    this.#latched.clear();
    this.#guard.reset();
    return { ok: true, reset: true };
  }
}
```

**Step 4: Run test to verify it passes** — Expected: PASS (all tests).

**Step 5: Commit**

```bash
git add backend/src/1_adapters/fitness/GarageFanAdapter.mjs tests/isolated/adapter/fitness/GarageFanAdapter.test.mjs
git commit -m "feat(fitness): add GarageFanAdapter condition trigger"
```

---

## Task 3: Bootstrap wiring

Construct the adapter when HA is available and export it alongside `ambientLedController`.

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs` (add import; construct after the `ambientLedController` block ~line 912; add to return object ~line 925)

**Step 1: Add the import** (near the other fitness adapter imports at the top of the file)

```javascript
import { GarageFanAdapter } from '#adapters/fitness/GarageFanAdapter.mjs';
```
(Confirm the alias style other imports use; if they use relative paths, match that.)

**Step 2: Construct after the ambient LED block**

Find:
```javascript
  } else {
    logger.warn?.('fitness.homeassistant.disabled', {
      reason: 'Missing baseUrl or token configuration'
    });
  }
```
Immediately after that closing brace, add:
```javascript
  let equipmentFanController = null;
  if (haGateway) {
    equipmentFanController = new GarageFanAdapter({
      gateway: haGateway,
      loadFitnessConfig,
      logger
    });
  }
```

**Step 3: Add to the return object**

In the `return { ... }` (the one containing `ambientLedController`), add:
```javascript
    equipmentFanController,
```

**Step 4: Verify it loads** (no unit test — wiring is exercised by the route test in Task 4 and a syntax/boot check)

```bash
node --check backend/src/0_system/bootstrap.mjs
```
Expected: no output (syntax OK).

**Step 5: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs
git commit -m "feat(fitness): wire GarageFanAdapter in bootstrap"
```

---

## Task 4: Router — `POST /equipment_fan` + status/reset

**Files:**
- Modify: `backend/src/4_api/v1/routers/fitness.mjs`
  - Add `equipmentFanController` to the destructured `config` (~line 78, next to `zoneLedController`)
  - Add routes after the existing `zone_led` block (~line 925)
- Modify: `backend/src/0_system/bootstrap.mjs` — pass `equipmentFanController` into `createFitnessRouter(...)` (~line 1035) **and** thread it from `createFitnessServices` result in `backend/src/app.mjs` if that's where the router is assembled. Verify the exact call site: `grep -n "createFitnessRouter(" backend/src/**/*.mjs`.
- Test: `tests/isolated/adapter/fitness/equipmentFanRoute.test.mjs`

**Step 1: Write the failing test** (mount the router with a stub controller)

```javascript
// tests/isolated/adapter/fitness/equipmentFanRoute.test.mjs
import { vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createFitnessRouter } from '#api/v1/routers/fitness.mjs';

function makeApp(equipmentFanController) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/fitness', createFitnessRouter({
    // minimal deps the router needs at construction; others are unused by this route
    sessionService: {}, userService: {}, configService: {}, contentRegistry: {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => ({ info: vi.fn(), error: vi.fn() }) },
    equipmentFanController
  }));
  return app;
}

describe('POST /api/v1/fitness/equipment_fan', () => {
  test('503 when controller not configured', async () => {
    const res = await request(makeApp(null)).post('/api/v1/fitness/equipment_fan').send({});
    expect(res.status).toBe(503);
  });

  test('delegates to controller.evaluate and returns its result', async () => {
    const controller = { evaluate: vi.fn().mockResolvedValue({ ok: true, results: [{ equipmentId: 'niceday', activated: true }] }) };
    const res = await request(makeApp(controller))
      .post('/api/v1/fitness/equipment_fan')
      .send({ rpm: { '7138': 72 }, zones: [{ zoneId: 'warm', isActive: true }], sessionEnded: false, householdId: 'test' });
    expect(res.status).toBe(200);
    expect(controller.evaluate).toHaveBeenCalledWith({ rpm: { '7138': 72 }, zones: [{ zoneId: 'warm', isActive: true }], sessionEnded: false, householdId: 'test' });
    expect(res.body).toMatchObject({ ok: true });
  });
});
```

> NOTE: If `createFitnessRouter` throws on missing deps at construction, add only the minimal stubs it requires (read the top of `createFitnessRouter` and the destructure). Keep the stub surface as small as the router actually touches before the route handler runs.

**Step 2: Run test to verify it fails**

```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/adapter/fitness/equipmentFanRoute.test.mjs
```
Expected: FAIL (404 on the route, or controller path not wired).

**Step 3: Implement**

In `createFitnessRouter`'s destructure, add:
```javascript
    equipmentFanController,
```

After the `zone_led/reset` route, add:
```javascript
  // =============================================================================
  // Equipment Fan Endpoints (require Home Assistant configuration)
  // =============================================================================

  /**
   * POST /api/fitness/equipment_fan - Evaluate fan trigger conditions and fire
   */
  router.post('/equipment_fan', async (req, res) => {
    if (!equipmentFanController) {
      return res.status(503).json({ ok: false, error: 'Equipment fan controller not configured (Home Assistant required)' });
    }
    try {
      const { rpm = {}, zones = [], sessionEnded = false, householdId } = req.body;
      const result = await equipmentFanController.evaluate({ rpm, zones, sessionEnded, householdId });
      return res.json(result);
    } catch (error) {
      logger.error?.('fitness.equipment_fan.error', { error: error.message });
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  /**
   * GET /api/fitness/equipment_fan/status
   */
  router.get('/equipment_fan/status', (req, res) => {
    if (!equipmentFanController) {
      return res.status(503).json({ ok: false, error: 'Equipment fan controller not configured' });
    }
    res.json(equipmentFanController.getStatus(req.query.householdId));
  });

  /**
   * POST /api/fitness/equipment_fan/reset
   */
  router.post('/equipment_fan/reset', (req, res) => {
    if (!equipmentFanController) {
      return res.status(503).json({ ok: false, error: 'Equipment fan controller not configured' });
    }
    res.json(equipmentFanController.reset());
  });
```

Then thread the dependency at the `createFitnessRouter({ ... })` call site (bootstrap.mjs ~1035): add
```javascript
    equipmentFanController: fitnessServices.equipmentFanController,
```
(Match how `zoneLedController: fitnessServices.ambientLedController` is passed — find that exact line and mirror it.)

**Step 4: Run test to verify it passes.** Then sanity-check the whole isolated suite still green for fitness adapters:
```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/adapter/fitness/
```
Expected: PASS, including the untouched `AmbientLedAdapter.test.mjs`.

> If `supertest` is not installed, either add it as a dev dep or rewrite the test to call the handler via a light Express harness already used elsewhere — check `grep -rl "supertest" tests/`. Prefer the existing pattern.

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/fitness.mjs backend/src/0_system/bootstrap.mjs tests/isolated/adapter/fitness/equipmentFanRoute.test.mjs
git commit -m "feat(fitness): add /equipment_fan route wired to GarageFanAdapter"
```

---

## Task 5: `useFitnessStateSync` — shared frontend sync hook

Extract the debounce/throttle/fire-and-forget/beacon mechanics from `useZoneLedSync` into a generic hook.

**Files:**
- Create: `frontend/src/hooks/fitness/useFitnessStateSync.js`
- Test: `tests/isolated/hooks/fitness/useFitnessStateSync.test.jsx` (confirm the isolated hooks dir; if none, use `tests/isolated/modules/Fitness/` which already holds jsx tests)

**Step 1: Write the failing test** (fake timers; assert it POSTs after debounce, throttles repeats, sends session-end immediately)

```javascript
// tests/isolated/hooks/fitness/useFitnessStateSync.test.jsx
import { vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const postMock = vi.fn().mockResolvedValue({ ok: true });
vi.mock('../../../../frontend/src/lib/api.mjs', () => ({
  DaylightAPI: (...args) => postMock(...args)
}));

import { useFitnessStateSync } from '#frontend/hooks/fitness/useFitnessStateSync.js';
// If a '#frontend/...' alias does not exist for tests, import via relative path:
// import { useFitnessStateSync } from '../../../../frontend/src/hooks/fitness/useFitnessStateSync.js';

describe('useFitnessStateSync', () => {
  beforeEach(() => { postMock.mockClear(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  test('POSTs the built payload to the endpoint after debounce when signature changes', async () => {
    let signature = 'a';
    const { rerender } = renderHook(() => useFitnessStateSync({
      endpoint: 'api/v1/fitness/equipment_fan',
      enabled: true, sessionActive: true,
      buildSignature: () => signature,
      buildPayload: () => ({ marker: signature }),
      debounceMs: 1000, throttleMs: 5000
    }));
    signature = 'b'; rerender();
    await vi.advanceTimersByTimeAsync(1000);
    expect(postMock).toHaveBeenCalledWith('api/v1/fitness/equipment_fan', expect.objectContaining({ marker: 'b' }), 'POST');
  });

  test('sends session-end payload immediately when sessionActive flips false', async () => {
    const { rerender } = renderHook((props) => useFitnessStateSync(props), {
      initialProps: {
        endpoint: 'api/v1/fitness/equipment_fan', enabled: true, sessionActive: true,
        buildSignature: () => 'x', buildPayload: () => ({}), buildEndPayload: () => ({ sessionEnded: true })
      }
    });
    rerender({
      endpoint: 'api/v1/fitness/equipment_fan', enabled: true, sessionActive: false,
      buildSignature: () => 'x', buildPayload: () => ({}), buildEndPayload: () => ({ sessionEnded: true })
    });
    expect(postMock).toHaveBeenCalledWith('api/v1/fitness/equipment_fan', expect.objectContaining({ sessionEnded: true }), 'POST');
  });
});
```

> The exact mock path / alias for `DaylightAPI` must match the project's vitest config (`grep -rn "vi.mock" tests/isolated/modules/Fitness` for the established pattern). Adjust import + mock target to match a working sibling test before writing implementation.

**Step 2: Run to verify it fails** (module not found).

**Step 3: Implement** (generalize `useZoneLedSync`)

```javascript
// frontend/src/hooks/fitness/useFitnessStateSync.js
/**
 * useFitnessStateSync — generic debounced/throttled state push to a backend
 * fitness endpoint. Fire-and-forget; sends an immediate end-payload on session
 * end and a sendBeacon on unmount. Shared by useZoneLedSync and
 * useEquipmentFanSync.
 *
 * @param {Object} o
 * @param {string} o.endpoint - API path, e.g. 'api/v1/fitness/equipment_fan'
 * @param {boolean} o.enabled
 * @param {boolean} o.sessionActive
 * @param {() => string} o.buildSignature - change-detection signature
 * @param {() => object} o.buildPayload - snapshot payload to POST
 * @param {() => object} [o.buildEndPayload] - payload on session-end/unmount
 * @param {number} [o.throttleMs=5000]
 * @param {number} [o.debounceMs=1000]
 */
import { useRef, useCallback, useEffect } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';

export function useFitnessStateSync({
  endpoint,
  enabled = false,
  sessionActive = false,
  buildSignature,
  buildPayload,
  buildEndPayload,
  throttleMs = 5000,
  debounceMs = 1000
}) {
  const lastSigRef = useRef(null);
  const lastSentRef = useRef(0);
  const debounceRef = useRef(null);
  const wasActiveRef = useRef(false);
  const mountedRef = useRef(true);

  const post = useCallback((payload) => {
    try {
      DaylightAPI(endpoint, payload, 'POST').catch(() => {});
    } catch (_) { /* never interrupt a workout */ }
  }, [endpoint]);

  const schedule = useCallback(() => {
    if (!enabled) return;
    const sig = buildSignature?.() ?? '';
    if (sig === lastSigRef.current) return;
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    const elapsed = Date.now() - lastSentRef.current;
    const delay = Math.max(debounceMs, throttleMs - elapsed);
    debounceRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      lastSigRef.current = sig;
      lastSentRef.current = Date.now();
      debounceRef.current = null;
      post(buildPayload?.() ?? {});
    }, delay);
  }, [enabled, buildSignature, buildPayload, post, debounceMs, throttleMs]);

  // Schedule on dependency/signature change while a session is active
  useEffect(() => {
    if (!enabled || !sessionActive) return;
    schedule();
  });

  // Session start/end transitions
  useEffect(() => {
    const was = wasActiveRef.current;
    wasActiveRef.current = sessionActive;
    if (was && !sessionActive && enabled) {
      if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
      lastSigRef.current = null;
      post(buildEndPayload?.() ?? {});
    }
    if (!was && sessionActive) {
      lastSigRef.current = null;
      lastSentRef.current = 0;
    }
  }, [sessionActive, enabled, post, buildEndPayload]);

  // Unmount: best-effort beacon
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
      if (wasActiveRef.current && enabled && typeof navigator !== 'undefined' && navigator.sendBeacon) {
        try {
          navigator.sendBeacon(
            `${window.location.origin}/${endpoint.replace(/^\//, '')}`,
            JSON.stringify(buildEndPayload?.() ?? {})
          );
        } catch (_) { /* best effort */ }
      }
    };
  }, [enabled, endpoint, buildEndPayload]);
}

export default useFitnessStateSync;
```

**Step 4: Run to verify it passes.**

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/useFitnessStateSync.js tests/isolated/hooks/fitness/useFitnessStateSync.test.jsx
git commit -m "feat(fitness): extract useFitnessStateSync shared sync hook"
```

---

## Task 6: Refactor `useZoneLedSync` to wrap the shared hook

Behavior-preserving. The existing zone-LED behavior must be unchanged.

**Files:**
- Modify: `frontend/src/hooks/fitness/useZoneLedSync.js`

**Step 1:** Confirm existing coverage. If a `useZoneLedSync` test exists (`grep -rl useZoneLedSync tests/`), run it first to capture green baseline. If none exists, add a minimal characterization test mirroring Task 5 before refactoring (signature from roster; end-payload `{ zones: [], sessionEnded: true }`).

**Step 2:** Rewrite the body to delegate:

```javascript
import { useFitnessStateSync } from './useFitnessStateSync.js';

function buildZoneSignature(roster) {
  if (!Array.isArray(roster) || roster.length === 0) return 'empty';
  return roster
    .filter(p => p && p.isActive !== false)
    .map(p => p.rawZoneId || p.zoneId || 'unknown')
    .sort().join(',') || 'empty';
}

export function useZoneLedSync({ participantRoster = [], sessionActive = false, enabled = false, householdId = null }) {
  useFitnessStateSync({
    endpoint: 'api/v1/fitness/zone_led',
    enabled,
    sessionActive,
    throttleMs: 5000,
    debounceMs: 1000,
    buildSignature: () => buildZoneSignature(participantRoster),
    buildPayload: () => ({
      zones: participantRoster.map(z => ({ zoneId: z.rawZoneId || z.zoneId || null, isActive: z.isActive !== false })),
      sessionEnded: false,
      householdId,
      timestamp: Date.now()
    }),
    buildEndPayload: () => ({ zones: [], sessionEnded: true, householdId, timestamp: Date.now() })
  });
}

export default useZoneLedSync;
```

**Step 3:** Run the zone-LED test(s) + the shared-hook test. Expected: PASS, no behavior change.

**Step 4: Commit**

```bash
git add frontend/src/hooks/fitness/useZoneLedSync.js tests/isolated/hooks/fitness/*.jsx
git commit -m "refactor(fitness): useZoneLedSync wraps useFitnessStateSync"
```

> If anything about the zone-LED timing is subtle and a characterization test is hard to stabilize, STOP and flag for review rather than risk regressing the working LED path.

---

## Task 7: `useEquipmentFanSync` — fan-specific wrapper

**Files:**
- Create: `frontend/src/hooks/fitness/useEquipmentFanSync.js`
- Test: `tests/isolated/hooks/fitness/useEquipmentFanSync.test.jsx`

**Step 1: Write the failing test** — assert it POSTs `{ rpm, zones, sessionEnded:false, householdId }` to `api/v1/fitness/equipment_fan` after debounce, and that the rpm map is keyed by device id.

```javascript
// tests/isolated/hooks/fitness/useEquipmentFanSync.test.jsx
import { vi } from 'vitest';
import { renderHook } from '@testing-library/react';
const postMock = vi.fn().mockResolvedValue({ ok: true });
vi.mock('../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: (...a) => postMock(...a) }));
import { useEquipmentFanSync } from '../../../../frontend/src/hooks/fitness/useEquipmentFanSync.js';

describe('useEquipmentFanSync', () => {
  beforeEach(() => { postMock.mockClear(); vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  test('POSTs rpm map + zones to equipment_fan', async () => {
    let rpm = { '7138': 0 };
    const { rerender } = renderHook(() => useEquipmentFanSync({
      enabled: true, sessionActive: true, householdId: 'test',
      rpmDevices: Object.entries(rpm).map(([id, v]) => ({ id, value: v })),
      participantRoster: [{ zoneId: 'warm', isActive: true }]
    }));
    rpm = { '7138': 72 }; rerender();
    await vi.advanceTimersByTimeAsync(1000);
    expect(postMock).toHaveBeenCalledWith('api/v1/fitness/equipment_fan',
      expect.objectContaining({ rpm: { '7138': 72 }, zones: [{ zoneId: 'warm', isActive: true }], householdId: 'test' }), 'POST');
  });
});
```

> Confirm the real field name for an rpm device's current value (`value` vs `rpm`). Read `frontend/src/context/FitnessContext.jsx` `rpmDevices` consumers (e.g. RPM meter components) to see which field carries the live reading, and key the map off `device.id`. Adjust the test + impl to the real field.

**Step 2: Run to verify it fails.**

**Step 3: Implement**

```javascript
// frontend/src/hooks/fitness/useEquipmentFanSync.js
/**
 * useEquipmentFanSync — pushes live RPM + HR-zone state to the backend so the
 * GarageFanAdapter can decide whether to fire equipment fans. Fire-and-forget;
 * the backend owns all condition logic and the per-session latch.
 */
import { useFitnessStateSync } from './useFitnessStateSync.js';

function rpmMap(rpmDevices) {
  const map = {};
  for (const d of Array.isArray(rpmDevices) ? rpmDevices : []) {
    if (d?.id == null) continue;
    // NOTE: confirm the live-reading field name in FitnessContext rpmDevices.
    const v = Number(d.value ?? d.rpm ?? 0);
    map[String(d.id)] = Number.isFinite(v) ? v : 0;
  }
  return map;
}

function zonesPayload(roster) {
  return (Array.isArray(roster) ? roster : []).map(z => ({
    zoneId: z.rawZoneId || z.zoneId || null,
    isActive: z.isActive !== false
  }));
}

export function useEquipmentFanSync({
  rpmDevices = [],
  participantRoster = [],
  sessionActive = false,
  enabled = false,
  householdId = null
}) {
  useFitnessStateSync({
    endpoint: 'api/v1/fitness/equipment_fan',
    enabled,
    sessionActive,
    throttleMs: 5000,
    debounceMs: 1000,
    buildSignature: () => {
      const r = rpmMap(rpmDevices);
      const maxZone = zonesPayload(participantRoster)
        .filter(z => z.isActive).map(z => z.zoneId).sort().join(',');
      // bucket rpm so micro-fluctuations don't spam; fire when crossing thresholds
      const rpmSig = Object.entries(r).map(([k, v]) => `${k}:${v >= 30 ? 'go' : 'lo'}`).sort().join(',');
      return `${rpmSig}|${maxZone}`;
    },
    buildPayload: () => ({
      rpm: rpmMap(rpmDevices),
      zones: zonesPayload(participantRoster),
      sessionEnded: false,
      householdId,
      timestamp: Date.now()
    }),
    buildEndPayload: () => ({ rpm: {}, zones: [], sessionEnded: true, householdId, timestamp: Date.now() })
  });
}

export default useEquipmentFanSync;
```

**Step 4: Run to verify it passes.**

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/useEquipmentFanSync.js tests/isolated/hooks/fitness/useEquipmentFanSync.test.jsx
git commit -m "feat(fitness): add useEquipmentFanSync hook"
```

---

## Task 8: Wire `useEquipmentFanSync` into `FitnessContext`

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx` (alongside the existing `useZoneLedSync` call ~line 1631)

**Step 1:** Add the import near the `useZoneLedSync` import (line 11):
```javascript
import { useEquipmentFanSync } from '../hooks/fitness/useEquipmentFanSync.js';
```

**Step 2:** Right after the existing `useZoneLedSync({...})` call, add:
```javascript
  // Equipment fan: backend decides whether to fire; we just report live state.
  // Enabled whenever any equipment has a `fan` block in config.
  const equipmentFanEnabled = React.useMemo(() => {
    const list = Array.isArray(fitnessRoot?.equipment) ? fitnessRoot.equipment : [];
    return list.some(e => e?.fan && e.fan.plug_entity);
  }, [fitnessRoot]);

  useEquipmentFanSync({
    rpmDevices,
    participantRoster: zoneLedPayload,            // reuse the same {zoneId,isActive} snapshot
    sessionActive: !!session.sessionId,
    enabled: equipmentFanEnabled,
    householdId: fitnessRoot?._household || null
  });
```

> Confirm `rpmDevices`, `zoneLedPayload`, `session`, and `fitnessRoot` are all in scope at that point (they are used by the adjacent `useZoneLedSync` block and the `rpmDevices` memo earlier). If `zoneLedPayload` only carries zone info and drops the fields the fan needs, pass `participantRoster` from the same source `useZoneLedSync` uses.

**Step 3:** Verify the frontend builds / type-checks:
```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/modules/Fitness/
```
Expected: existing fitness component tests still PASS (no regression from the added hook).

**Step 4: Commit**

```bash
git add frontend/src/context/FitnessContext.jsx
git commit -m "feat(fitness): drive equipment fan from FitnessContext"
```

---

## Task 9: Full verification + docs

**Step 1: Run the whole isolated suite for touched areas**
```bash
frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/adapter/fitness/ tests/isolated/hooks/fitness/ tests/isolated/modules/Fitness/
```
Expected: all PASS, including the untouched `AmbientLedAdapter.test.mjs`.

**Step 2: Manual smoke (optional, requires running backend with HA configured).** With the dev server up:
```bash
curl -s -X POST http://localhost:3112/api/v1/fitness/equipment_fan \
  -H 'Content-Type: application/json' \
  -d '{"rpm":{"7138":72},"zones":[{"zoneId":"warm","isActive":true}],"sessionEnded":false,"householdId":"household"}'
curl -s http://localhost:3112/api/v1/fitness/equipment_fan/status | jq
```
Expected: first call `activated: true` (if garage temp > 65), second `latched`. (Use the backend port from `.claude/settings.local.json`.)

**Step 3: Update docs.** Mark the design doc status `Implemented`. Add a one-line entry to the fitness reference docs if the route table lives there (`grep -rn "zone_led" docs/`). Add a memory pointer if useful (the fan-config-under-equipment pattern + the `HaActionGuard`/`useFitnessStateSync` abstractions).

**Step 4: Commit**
```bash
git add docs/_wip/plans/2026-06-06-garage-fan-trigger-design.md docs/
git commit -m "docs(fitness): mark garage fan trigger implemented"
```

---

## Edge cases (must remain true)

- Equipment with no `fan` block → ignored (Task 2 test).
- RPM device reading 0 / ghost → fails `min_rpm`, no fire (upstream `rpmGhostFilter` already drops stray sensors).
- Temp sensor unavailable or non-numeric → fail-closed, no fire, warn logged (Task 2 test).
- Any one active participant in warm+ satisfies the zone condition (Task 2 test).
- Fires at most once per session per equipment; `sessionEnded` re-arms (Task 2 tests).
- HA absent → routes 503, controller null, no crash (Task 4 test).
- `AmbientLedAdapter` untouched and its tests still green (Task 4 / Task 9).

## Out of scope (do not implement here)

- Turning the fan **off** (separate deactivation system owns this).
- Migrating `AmbientLedAdapter` onto `HaActionGuard` (deferred follow-up).
- Bike→rider→HR-strap matching (decided against in brainstorming).
