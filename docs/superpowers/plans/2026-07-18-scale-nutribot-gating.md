# Scale→Nutribot Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bridge's "push every settled value" with a gated decision flow — smart-force dedup, supersede-while-loading + session-end cleanup, and a suspicion filter that keeps the shelf-storage phantom off the wire.

**Architecture:** `ScaleNutribotBridge` keeps one in-memory `live` prompt per scale (single-live invariant). Loading edits that prompt in place; answering it (detected lazily via `LogFoodFromScale`'s untouched check) frees it for the next placement. A new event-triggered `RetractScaleLog` use-case deletes an unanswered prompt on session end. A suspicion predicate (known storage-weight band OR a rolling-window "jump-after-storm" heuristic) suppresses phantom auto-posts; the ESP button bypasses it.

**Tech Stack:** Node ESM (`.mjs`), Jest (`@jest/globals`), existing nutribot DDD use-cases + `WebSocketEventBus`.

## Global Constraints

- Never delete/clobber a prompt the user has engaged with. The `isUntouched` guard (status `pending`, `metadata.source === 'scale'`, `containerId == null`, `densityLevel == null`) is the single source of truth for "unanswered". Verbatim from spec.
- Single-live invariant: at most one unanswered `live` prompt per scale at any time.
- Reported weight is always GROSS (baseline is a gate, never subtracted).
- Bridge takes an injected `now = () => Date.now()` for window math; no wall-clock timers (session end is event-driven).
- Structured logging only (`logger.info/warn/debug`), never raw console.
- Import alias: use `#apps/...` (as existing nutribot files do).

---

### Task 1: Config knobs

**Files:**
- Modify: `backend/src/3_applications/nutribot/lib/scaleNutribotConfig.mjs` (the `return {}` in `normalizeScaleNutribotConfig`, ~lines 47-57)
- Test: `tests/unit/suite/applications/nutribot/scaleNutribotConfig.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `normalizeScaleNutribotConfig(raw)` return object gains `storageWeightG`, `storageToleranceG`, `suspicionWindowSec`, `stormMinPushes`, `heavyG`, `forceToleranceG` (all numbers). Existing keys unchanged.

- [ ] **Step 1: Write the failing test**

Add inside the existing `describe('normalizeScaleNutribotConfig'...)` block in `scaleNutribotConfig.test.mjs`:

```javascript
  it('normalizes suspicion/force knobs with defaults', () => {
    const cfg = normalizeScaleNutribotConfig({});
    expect(cfg).toMatchObject({
      storageWeightG: 0,
      storageToleranceG: 15,
      suspicionWindowSec: 90,
      stormMinPushes: 2,
      heavyG: 300,
      forceToleranceG: 10,
    });
    const o = normalizeScaleNutribotConfig({
      nutribot: {
        storage_weight_g: 430, storage_tolerance_g: 20, suspicion_window_sec: 120,
        storm_min_pushes: 3, heavy_g: 250, force_tolerance_g: 8,
      },
    });
    expect(o).toMatchObject({
      storageWeightG: 430, storageToleranceG: 20, suspicionWindowSec: 120,
      stormMinPushes: 3, heavyG: 250, forceToleranceG: 8,
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/suite/applications/nutribot/scaleNutribotConfig.test.mjs -t "suspicion/force knobs" --silent`
Expected: FAIL — `storageWeightG` is `undefined`.

- [ ] **Step 3: Add the knobs**

In `scaleNutribotConfig.mjs`, in the `return {}` of `normalizeScaleNutribotConfig`, add after the `dedupDeltaG` line:

```javascript
    storageWeightG: num(nb.storage_weight_g, 0),
    storageToleranceG: num(nb.storage_tolerance_g, 15),
    suspicionWindowSec: num(nb.suspicion_window_sec, 90),
    stormMinPushes: num(nb.storm_min_pushes, 2),
    heavyG: num(nb.heavy_g, 300),
    forceToleranceG: num(nb.force_tolerance_g, 10),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/suite/applications/nutribot/scaleNutribotConfig.test.mjs --silent`
Expected: PASS (all tests in file).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/nutribot/lib/scaleNutribotConfig.mjs tests/unit/suite/applications/nutribot/scaleNutribotConfig.test.mjs
git commit -m "feat(nutribot): add suspicion/force config knobs for scale gating"
```

---

### Task 2: `RetractScaleLog` use-case + container wiring

**Files:**
- Create: `backend/src/3_applications/nutribot/usecases/RetractScaleLog.mjs`
- Create: `tests/unit/suite/applications/nutribot/RetractScaleLog.test.mjs`
- Modify: `backend/src/3_applications/nutribot/NutribotContainer.mjs` (import ~line 36, field ~line 96, getter near the other scale getters)

**Interfaces:**
- Consumes: `messagingGateway.deleteMessage(conversationId, messageId)`, `foodLogStore.findByUuid(logUuid, userId)` + `.updateStatus(userId, logUuid, status)`, `conversationStateStore.get/clear`.
- Produces:
  - `class RetractScaleLog { async execute({ userId, conversationId, logUuid, messageId }): Promise<{ success: true, retracted: boolean }> }` — `retracted:true` only when it was untouched and got rejected+deleted.
  - `NutribotContainer.prototype.getRetractScaleLog(): RetractScaleLog` (lazy singleton).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/suite/applications/nutribot/RetractScaleLog.test.mjs`:

```javascript
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { RetractScaleLog } from '#apps/nutribot/usecases/RetractScaleLog.mjs';

describe('RetractScaleLog', () => {
  let messagingGateway, foodLogStore, stateStore, logger, uc;
  beforeEach(() => {
    messagingGateway = { deleteMessage: jest.fn().mockResolvedValue(true) };
    foodLogStore = {
      findByUuid: jest.fn().mockResolvedValue({ status: 'pending', metadata: { source: 'scale' } }),
      updateStatus: jest.fn().mockResolvedValue(true),
    };
    stateStore = {
      get: jest.fn().mockResolvedValue({ flowState: { pendingLogUuid: 'log1' } }),
      clear: jest.fn().mockResolvedValue(true),
    };
    logger = { debug() {}, info() {}, warn() {} };
    uc = new RetractScaleLog({ messagingGateway, foodLogStore, conversationStateStore: stateStore, logger });
  });

  it('rejects + deletes an untouched pending scale log', async () => {
    const res = await uc.execute({ userId: 'kckern', conversationId: 'c1', logUuid: 'log1', messageId: '55' });
    expect(res).toMatchObject({ success: true, retracted: true });
    expect(foodLogStore.updateStatus).toHaveBeenCalledWith('kckern', 'log1', 'rejected');
    expect(messagingGateway.deleteMessage).toHaveBeenCalledWith('c1', '55');
    expect(stateStore.clear).toHaveBeenCalledWith('c1');
  });

  it('leaves a touched (density-picked) log alone', async () => {
    foodLogStore.findByUuid.mockResolvedValue({ status: 'pending', metadata: { source: 'scale', densityLevel: 4 } });
    const res = await uc.execute({ userId: 'kckern', conversationId: 'c1', logUuid: 'log1', messageId: '55' });
    expect(res).toMatchObject({ retracted: false });
    expect(foodLogStore.updateStatus).not.toHaveBeenCalled();
    expect(messagingGateway.deleteMessage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/suite/applications/nutribot/RetractScaleLog.test.mjs --silent`
Expected: FAIL — cannot find module `RetractScaleLog.mjs`.

- [ ] **Step 3: Create the use-case**

Create `backend/src/3_applications/nutribot/usecases/RetractScaleLog.mjs`:

```javascript
//
// Retract an UNANSWERED scale prompt — event-triggered (session-end sweep, forced
// supersede), the successor to the retired timer-based ExpireScaleLog. If the log is
// still untouched (user never engaged), reject it and delete its Telegram message. If
// the user has engaged (picked a container/density), leave it entirely alone.

export class RetractScaleLog {
  #messagingGateway; #foodLogStore; #conversationStateStore; #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    this.#messagingGateway = deps.messagingGateway;
    this.#foodLogStore = deps.foodLogStore;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#logger = deps.logger || console;
  }

  #isUntouched(log) {
    return !!log
      && log.status === 'pending'
      && log.metadata?.source === 'scale'
      && log.metadata?.containerId == null
      && log.metadata?.densityLevel == null;
  }

  async execute(input) {
    const { userId, conversationId, logUuid, messageId } = input;
    const log = await this.#foodLogStore.findByUuid(logUuid, userId);
    if (!this.#isUntouched(log)) return { success: true, retracted: false };

    await this.#foodLogStore.updateStatus(userId, logUuid, 'rejected');

    if (this.#conversationStateStore) {
      try {
        const st = await this.#conversationStateStore.get?.(conversationId);
        if (st?.flowState?.pendingLogUuid === logUuid) await this.#conversationStateStore.clear(conversationId);
      } catch (e) { this.#logger.debug?.('scaleRetract.clearFailed', { error: e.message }); }
    }

    if (messageId) {
      try { await this.#messagingGateway.deleteMessage(conversationId, messageId); }
      catch (e) { this.#logger.debug?.('scaleRetract.deleteFailed', { error: e.message }); }
    }

    this.#logger.info?.('scaleRetract.done', { conversationId, logUuid });
    return { success: true, retracted: true };
  }
}

export default RetractScaleLog;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/suite/applications/nutribot/RetractScaleLog.test.mjs --silent`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire into NutribotContainer**

In `backend/src/3_applications/nutribot/NutribotContainer.mjs`:

Add the import after the `ShowScaleDensityHelp` import:

```javascript
import { RetractScaleLog } from './usecases/RetractScaleLog.mjs';
```

Add the private field next to `#showScaleDensityHelp;`:

```javascript
  #retractScaleLog;
```

Add the getter after `getShowScaleDensityHelp()`:

```javascript
  getRetractScaleLog() {
    if (!this.#retractScaleLog) {
      this.#retractScaleLog = new RetractScaleLog({
        messagingGateway: this.getMessagingGateway(),
        foodLogStore: this.#foodLogStore,
        conversationStateStore: this.#conversationStateStore,
        logger: this.#logger,
      });
    }
    return this.#retractScaleLog;
  }
```

- [ ] **Step 6: Run the container scale test to verify wiring**

Run: `npx jest tests/unit/suite/applications/nutribot/NutribotContainerScale.test.mjs --silent`
Expected: PASS (container still constructs; no regression).

- [ ] **Step 7: Commit**

```bash
git add backend/src/3_applications/nutribot/usecases/RetractScaleLog.mjs tests/unit/suite/applications/nutribot/RetractScaleLog.test.mjs backend/src/3_applications/nutribot/NutribotContainer.mjs
git commit -m "feat(nutribot): RetractScaleLog use-case for event-triggered prompt cleanup"
```

---

### Task 3: Bridge decision flow (gating, supersede, smart-force, suspicion, sweep)

**Files:**
- Modify (full rewrite): `backend/src/3_applications/hardware/ScaleNutribotBridge.mjs`
- Test (full rewrite): `tests/unit/suite/applications/hardware/ScaleNutribotBridge.test.mjs`

**Interfaces:**
- Consumes: `nutribotContainer.getLogFoodFromScale().execute({userId, conversationId, grams, unit, scaleId, existingLogUuid?, messageId?})` returning:
  - create → `{ success, logUuid, messageId, stage:'density', edited: undefined }`
  - edit untouched → `{ success, logUuid, messageId, stage:'density', edited: true }`
  - edit touched → `{ success, logUuid, edited: false, touched: true }`
  - `nutribotContainer.getRetractScaleLog().execute({userId, conversationId, logUuid, messageId})` → `{ success, retracted }`
  - `scaleConfig` fields from Task 1 + existing `minGrams`, `baselineToleranceG`, `placementDeltaG`, `dedupDeltaG`.
- Produces: `createScaleNutribotBridge({ eventBus, nutribotContainer, userId, conversationId, scaleConfig, topics, logger, now })` → `{ dispose() }`. New optional `now = () => Date.now()`.

- [ ] **Step 1: Write the failing test suite**

Replace the entire contents of `tests/unit/suite/applications/hardware/ScaleNutribotBridge.test.mjs` with:

```javascript
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { createScaleNutribotBridge } from '#apps/hardware/ScaleNutribotBridge.mjs';
import { normalizeScaleNutribotConfig } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const flush = () => new Promise((r) => setTimeout(r, 0));

function makeBus() {
  const handlers = {};
  return {
    subscribe: (topic, cb) => { (handlers[topic] ||= []).push(cb); return () => {}; },
    emit: (topic, payload) => (handlers[topic] || []).forEach((cb) => cb(payload)),
  };
}

// LogFoodFromScale mock: create vs edit distinguished by existingLogUuid; `answered`
// flips edits to the touched shape. RetractScaleLog mock always reports retracted.
function makeContainer() {
  let n = 0;
  const state = { answered: false };
  const execute = jest.fn(async (input) => {
    if (input.existingLogUuid) {
      return state.answered
        ? { success: true, logUuid: input.existingLogUuid, edited: false, touched: true }
        : { success: true, logUuid: input.existingLogUuid, messageId: 'm1', stage: 'density', edited: true };
    }
    n += 1;
    return { success: true, logUuid: `l${n}`, messageId: `m${n}`, stage: 'density' };
  });
  const retract = jest.fn(async () => ({ success: true, retracted: true }));
  return {
    execute, retract, state,
    container: { getLogFoodFromScale: () => ({ execute }), getRetractScaleLog: () => ({ execute: retract }) },
  };
}

describe('ScaleNutribotBridge (gated: supersede, force, suspicion, sweep)', () => {
  let bus, execute, retract, cstate, clock, now;
  const emit = (grams, stable = true) => bus.emit('food-scale', { id: 'kitchen', grams, stable, unit: 'g' });
  const press = () => bus.emit('food-scale', { id: 'kitchen', event: 'button', press: 'short' });
  const createCalls = () => execute.mock.calls.filter((c) => !c[0].existingLogUuid);
  const editCalls = () => execute.mock.calls.filter((c) => c[0].existingLogUuid);

  function build(overrides = {}) {
    const m = makeContainer();
    execute = m.execute; retract = m.retract; cstate = m.state;
    bus = makeBus();
    clock = 1_000_000;
    now = () => clock;
    createScaleNutribotBridge({
      eventBus: bus, nutribotContainer: m.container,
      userId: 'kckern', conversationId: 'telegram:b1_c2',
      scaleConfig: normalizeScaleNutribotConfig({ nutribot: overrides }), logger, now,
    });
  }

  beforeEach(() => build());

  it('learns the initial resting weight silently', async () => {
    emit(480); await flush();
    expect(createCalls()).toHaveLength(0);
  });

  it('posts one prompt on placement, then edits IN PLACE as the weight climbs', async () => {
    emit(480); await flush();          // baseline
    emit(680); await flush();          // placement → create l1
    emit(740); await flush();          // +60 → edit in place, no new message
    expect(createCalls()).toHaveLength(1);
    expect(editCalls()).toHaveLength(1);
    expect(editCalls()[0][0]).toMatchObject({ grams: 740, existingLogUuid: 'l1' });
  });

  it('dedups a held value (change < dedupDelta)', async () => {
    emit(480); await flush();
    emit(680); await flush();
    emit(682); await flush();          // +2 < dedup(5)
    expect(createCalls()).toHaveLength(1);
    expect(editCalls()).toHaveLength(0);
  });

  it('after the prompt is answered, more food starts a NEW prompt', async () => {
    emit(480); await flush();
    emit(680); await flush();          // create l1
    cstate.answered = true;            // user picked a density
    emit(760); await flush();          // edit→touched → new placement → create l2
    expect(createCalls()).toHaveLength(2);
    expect(retract).not.toHaveBeenCalled(); // answered log is kept, never retracted
  });

  it('sweeps the unanswered prompt when the pan empties (session end)', async () => {
    emit(480); await flush();
    emit(680); await flush();          // create l1 (unanswered)
    emit(482); await flush();          // back near baseline → session end
    expect(retract).toHaveBeenCalledTimes(1);
    expect(retract.mock.calls[0][0]).toMatchObject({ logUuid: 'l1' });
    emit(690); await flush();          // new session → fresh create
    expect(createCalls()).toHaveLength(2);
  });

  it('suppresses a value inside the storage band (no post)', async () => {
    build({ storage_weight_g: 430, storage_tolerance_g: 15 });
    emit(0); await flush();            // baseline 0
    emit(438); await flush();          // in band 430±15 → suppressed
    expect(createCalls()).toHaveLength(0);
  });

  it('button force overrides a suppressed value', async () => {
    build({ storage_weight_g: 430, storage_tolerance_g: 15 });
    emit(0); await flush();
    emit(438); await flush();          // suppressed
    press(); await flush();            // force logs live 438
    expect(createCalls()).toHaveLength(1);
    expect(createCalls()[0][0]).toMatchObject({ grams: 438 });
  });

  it('suppresses a heavy jump right after a storm of recent posts', async () => {
    build({ storage_weight_g: 0, storm_min_pushes: 2, heavy_g: 300, suspicion_window_sec: 90 });
    emit(0); await flush();            // baseline 0
    clock += 1000; emit(50); await flush();   // post #1 (l1)
    clock += 1000; emit(0); await flush();    // session end
    clock += 1000; emit(60); await flush();   // post #2 (l2)
    clock += 1000; emit(0); await flush();    // session end  → 2 recent posts on record
    clock += 1000; emit(400); await flush();  // rise 400 ≥ heavy, 2 posts in window → suppressed
    expect(createCalls()).toHaveLength(2);
    press(); await flush();                   // force overrides
    expect(createCalls()).toHaveLength(3);
  });

  it('trusts a lone heavy placement with no recent storm', async () => {
    build({ storage_weight_g: 0, storm_min_pushes: 2, heavy_g: 300 });
    emit(0); await flush();
    clock += 1000; emit(400); await flush();  // no prior posts → trusted
    expect(createCalls()).toHaveLength(1);
  });

  it('button no-ops when a live prompt already covers ~this weight', async () => {
    emit(480); await flush();
    emit(680); await flush();          // create l1, live@680
    press(); await flush();            // lastGrams 680, within forceTol → edit(no-op), no new create
    expect(createCalls()).toHaveLength(1);
    expect(editCalls()).toHaveLength(1);
  });

  it('button captures the latest weight even from an unstable frame', async () => {
    emit(480); await flush();
    emit(690, false); await flush();   // unstable → auto ignores, lastGrams=690
    press(); await flush();
    expect(createCalls()).toHaveLength(1);
    expect(createCalls()[0][0]).toMatchObject({ grams: 690 });
  });

  it('button does nothing with no weight on the scale', async () => {
    press(); await flush();
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not double-create on two synchronous placement frames', async () => {
    emit(480); await flush();
    emit(680); emit(680);
    await flush();
    expect(createCalls()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the suite to verify it fails**

Run: `npx jest tests/unit/suite/applications/hardware/ScaleNutribotBridge.test.mjs --silent`
Expected: FAIL — current bridge lacks `now`, `getRetractScaleLog`, edit-in-place supersede, and suppression.

- [ ] **Step 3: Rewrite the bridge**

Replace the entire contents of `backend/src/3_applications/hardware/ScaleNutribotBridge.mjs` with:

```javascript
//
// Bridges the food-scale event-bus topic into nutribot with a gated decision flow.
//
// Single-live invariant: at most one UNANSWERED prompt per scale at a time.
//   • AUTO placement — a settled rise above the learned resting baseline posts ONE
//     prompt; further settles EDIT it in place (the prompt follows the weight up).
//     Answering it (detected lazily via LogFoodFromScale's untouched check) frees it, so
//     the next load starts a fresh prompt. Returning near baseline ends the session and
//     RETRACTS an unanswered prompt (cleanup — no leftover slop).
//   • SUSPICION filter — an auto placement is suppressed (logged, not posted) when it
//     looks like putting the scale away: it lands in the known storage-weight band, OR
//     it's a heavy jump right after a storm of recent posts (rolling time window).
//   • FORCE — an ESP button press logs the live weight now, bypassing the suspicion
//     filter. It no-ops when a live unanswered prompt already covers ~this weight, so it
//     never duplicates; otherwise it posts (retracting any stale live first).
//
// Weights NEVER expire. Reported weight is always GROSS. `now` is injected for testable
// window math; session end is event-driven (no wall-clock timers).

const DEFAULT_TOPICS = ['food-scale'];

export function createScaleNutribotBridge({
  eventBus, nutribotContainer, userId, conversationId, scaleConfig, topics,
  logger = console, now = () => Date.now(),
}) {
  if (!eventBus?.subscribe) throw new Error('createScaleNutribotBridge: eventBus with subscribe required');
  if (!nutribotContainer?.getLogFoodFromScale) throw new Error('createScaleNutribotBridge: nutribotContainer required');

  const minGrams = scaleConfig?.minGrams ?? 5;
  const baselineTolG = scaleConfig?.baselineToleranceG ?? 6;
  const placementDeltaG = scaleConfig?.placementDeltaG ?? 10;
  const dedupDeltaG = scaleConfig?.dedupDeltaG ?? 5;
  const storageWeightG = scaleConfig?.storageWeightG ?? 0;
  const storageTolG = scaleConfig?.storageToleranceG ?? 15;
  const suspicionWindowMs = (scaleConfig?.suspicionWindowSec ?? 90) * 1000;
  const stormMinPushes = scaleConfig?.stormMinPushes ?? 2;
  const heavyG = scaleConfig?.heavyG ?? 300;
  const forceTolG = scaleConfig?.forceToleranceG ?? 10;

  const scales = new Map();   // id -> { baseline, lastGrams, live, postTimes[] }
  const inflight = new Set();

  const stateFor = (id) => {
    let s = scales.get(id);
    if (!s) { s = { baseline: null, lastGrams: null, live: null, postTimes: [] }; scales.set(id, s); }
    return s;
  };

  const create = (grams, scaleId) =>
    nutribotContainer.getLogFoodFromScale().execute({ userId, conversationId, grams, unit: 'g', scaleId });
  const editInPlace = (grams, scaleId, live) =>
    nutribotContainer.getLogFoodFromScale().execute({
      userId, conversationId, grams, unit: 'g', scaleId,
      existingLogUuid: live.logUuid, messageId: live.messageId,
    });
  const retract = async (live) => {
    const uc = nutribotContainer.getRetractScaleLog?.();
    if (!uc || !live) return;
    try { await uc.execute({ userId, conversationId, logUuid: live.logUuid, messageId: live.messageId }); }
    catch (err) { logger.warn?.('scaleNutribot.retract.failed', { error: err.message }); }
  };

  // POST a fresh prompt, preserving the single-live invariant (retract any prior live).
  const post = async (id, s, grams, reason) => {
    if (s.live) { await retract(s.live); s.live = null; }
    const res = await create(grams, id);
    if (res?.success && res.logUuid) {
      s.live = { logUuid: res.logUuid, messageId: res.messageId || null, grams };
      s.postTimes.push(now());
      logger.info?.('scaleNutribot.pushed', { id, grams, reason });
    }
    return res;
  };

  const suspicious = (s, grams, rise) => {
    if (storageWeightG > 0 && Math.abs(grams - storageWeightG) <= storageTolG) return 'storage-band';
    const cutoff = now() - suspicionWindowMs;
    s.postTimes = s.postTimes.filter((t) => t >= cutoff);
    if (s.postTimes.length >= stormMinPushes && rise >= heavyG) return 'jump-after-storm';
    return null;
  };

  const onPayload = async (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const id = payload.id || 'unknown';
    const s = stateFor(id);

    // FORCE: an ESP button press logs the live weight now, bypassing suspicion.
    if (payload.event === 'button') {
      const g = s.lastGrams;
      if (!Number.isFinite(g) || g <= 0) { logger.warn?.('scaleNutribot.force.noWeight', { id }); return; }
      if (inflight.has(id)) return;
      inflight.add(id);
      try {
        if (s.live && Math.abs(g - s.live.grams) <= forceTolG) {
          const res = await editInPlace(g, id, s.live);
          if (res?.edited) { s.live.grams = g; return; }   // already handled → no duplicate
          if (res?.touched) s.live = null;                 // answered → post fresh below
        }
        await post(id, s, g, 'button');
      } finally { inflight.delete(id); }
      return;
    }

    const grams = Math.round(Number(payload.grams));
    if (!Number.isFinite(grams)) return;
    s.lastGrams = grams;                    // track live weight (stable or not) for force
    if (payload.stable !== true) return;    // auto acts only on settled frames
    if (s.baseline === null) { s.baseline = grams; return; } // learn resting load

    const rise = grams - s.baseline;

    if (inflight.has(id)) return;
    inflight.add(id);
    try {
      // SESSION END: back near/below the resting load ⇒ removed / tare / jostle.
      if (rise <= baselineTolG) {
        if (s.live) { await retract(s.live); s.live = null; } // sweep unanswered slop
        s.baseline = grams;
        return;
      }

      if (grams < minGrams) return;         // floor guard

      // LOADING: one live prompt follows the weight (edit in place).
      if (s.live) {
        if (Math.abs(grams - s.live.grams) < dedupDeltaG) return; // same held value
        const res = await editInPlace(grams, id, s.live);
        if (res?.edited) { s.live.grams = grams; return; }  // still unanswered → followed
        if (res?.touched) s.live = null;                    // answered → fall to new placement
        else return;                                        // dispatch failed → bail
      }

      // NEW PLACEMENT.
      if (rise < placementDeltaG) return;   // too small a rise
      const why = suspicious(s, grams, rise);
      if (why) { logger.info?.('scaleNutribot.suppressed', { id, grams, why }); return; }
      await post(id, s, grams, 'auto');
    } finally { inflight.delete(id); }
  };

  const unsubs = (topics && topics.length ? topics : DEFAULT_TOPICS).map((t) => eventBus.subscribe(t, onPayload));
  logger.info?.('scaleNutribot.bridge.ready', {
    conversationId, userId, minGrams, baselineTolG, placementDeltaG, dedupDeltaG,
    storageWeightG, storageTolG, stormMinPushes, heavyG, forceTolG, topics: topics || DEFAULT_TOPICS,
  });

  return { dispose: () => { for (const u of unsubs) { try { u?.(); } catch { /* noop */ } } } };
}

export default createScaleNutribotBridge;
```

- [ ] **Step 4: Run the suite to verify it passes**

Run: `npx jest tests/unit/suite/applications/hardware/ScaleNutribotBridge.test.mjs --silent`
Expected: PASS (13 tests).

- [ ] **Step 5: Run the full nutribot + hardware suites (no regressions)**

Run: `npx jest tests/unit/suite/applications/nutribot tests/unit/suite/applications/hardware --silent`
Expected: PASS (all suites).

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/hardware/ScaleNutribotBridge.mjs tests/unit/suite/applications/hardware/ScaleNutribotBridge.test.mjs
git commit -m "feat(nutribot): gated scale bridge — supersede, smart-force, suspicion filter, sweep"
```

---

### Task 4: Docs

**Files:**
- Modify: `_extensions/food-scale-relay/config.example.yml` (the `nutribot:` block)
- Modify: `_extensions/food-scale-relay/README.md` (Nutribot integration section)

**Interfaces:** none (documentation only).

- [ ] **Step 1: Document the new knobs in config.example.yml**

In the `nutribot:` block, after the `dedup_delta_g` line, add:

```yaml
  # Suspicion filter — keep the "scale put away on its shelf" phantom off nutribot.
  # A placement is suppressed (logged, not posted) when it lands in the storage band
  # OR is a heavy jump right after a burst of recent posts. The ESP button overrides.
  storage_weight_g: 0        # known put-away weight; 0 disables the band
  storage_tolerance_g: 15    # ± window around storage_weight_g
  suspicion_window_sec: 90   # how recently the "storm" of posts must have happened
  storm_min_pushes: 2        # recent posts within the window that constitute a storm
  heavy_g: 300               # min rise above rest for the jump-after-storm gate
  force_tolerance_g: 10      # button no-ops within this of the live prompt
```

- [ ] **Step 2: Update the README Nutribot section**

In `_extensions/food-scale-relay/README.md`, replace the two `AUTO` / `FORCE` bullets in the "Nutribot integration" section with:

```markdown
- **AUTO** — a settled rise above the learned resting load posts **one** prompt that
  then **edits in place** as the weight climbs (no message pile-up). Answering it frees
  it, so the next load starts fresh. Returning near the resting load ends the session and
  **retracts** an unanswered prompt (no leftover slop). A placement is **suppressed** when
  it looks like putting the scale away — it lands in the configured `storage_weight_g`
  band, or it's a `heavy_g`+ jump right after a burst of recent posts. Weights never
  expire.
- **FORCE** — an **ESP button press** logs the live weight now, **bypassing the suspicion
  filter**. It no-ops when a live prompt already covers ~this weight (no duplicate), so
  it's purely the override for anything auto suppressed or mis-gated.
```

- [ ] **Step 3: Commit**

```bash
git add _extensions/food-scale-relay/config.example.yml _extensions/food-scale-relay/README.md
git commit -m "docs(food-scale): document scale-nutribot suspicion filter + supersede behavior"
```

---

## Self-Review

**Spec coverage:**
- Smart-force dedup → Task 3 (force no-op test + code). ✓
- Supersede-while-loading (edit-in-place) → Task 3. ✓
- Session-end sweep → Task 2 (`RetractScaleLog`) + Task 3 (session-end branch). ✓
- Suspicion: storage band + jump-after-storm → Task 3 (`suspicious()`). Note: heuristic uses a **rolling-window post count** (`postTimes`) rather than the spec's per-session `pushCount`, because supersede makes a session only one post; this is the faithful implementation of "right after a storm of legit ones" and is flagged to the user. ✓
- Config knobs → Task 1. ✓
- Injected `now()` for testability → Task 3. ✓
- Docs → Task 4. ✓

**Placeholder scan:** No TBD/TODO; all code steps show complete code. ✓

**Type consistency:** `create`/`editInPlace`/`retract` signatures match the `LogFoodFromScale`/`RetractScaleLog` return shapes declared in the Interfaces blocks; `live` shape `{logUuid, messageId, grams}` used consistently; config field names match Task 1's `normalize` output. ✓
