import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createScaleNutribotBridge } from '#adapters/hardware/ScaleNutribotBridge.mjs';
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

// Same shape as the container mock in the existing bridge suite: a create is
// distinguished from an edit by `existingLogUuid`.
function makeContainer() {
  let n = 0;
  const execute = vi.fn(async (input) => {
    if (input.existingLogUuid) {
      return { success: true, logUuid: input.existingLogUuid, messageId: 'm1', stage: 'density', edited: true };
    }
    n += 1;
    return { success: true, logUuid: `l${n}`, messageId: `m${n}`, stage: 'density' };
  });
  const retract = vi.fn(async () => ({ success: true, retracted: true }));
  return {
    execute,
    container: { getLogFoodFromScale: () => ({ execute }), getRetractScaleLog: () => ({ execute: retract }) },
  };
}

// Plain recorder — we are asserting the bridge's CALLS, not CompositionStore's
// behaviour, which has its own suite.
function makeFakeStore() {
  return {
    weights: [],
    ends: [],
    setWeight(scaleId, payload) { this.weights.push({ scaleId, ...payload }); },
    setDensity() {},
    setContainer() {},
    endPlacement(scaleId) { this.ends.push(scaleId); return true; },
    clear() {},
    read() { return { grams: null, unit: null, density: null, container: null, complete: false, active: false }; },
  };
}

describe('ScaleNutribotBridge → CompositionStore', () => {
  let bus; let store; let execute;
  const emit = (grams, stable = true) => bus.emit('food-scale', { id: 'kitchen', grams, stable, unit: 'g' });

  function build({ compositionStore } = {}) {
    const m = makeContainer();
    bus = makeBus();
    execute = m.execute;
    return createScaleNutribotBridge({
      eventBus: bus,
      nutribotContainer: m.container,
      userId: 'test-user',
      conversationId: 'telegram:b1_c2',
      scaleConfig: normalizeScaleNutribotConfig({}),
      logger,
      now: () => 1_000_000,
      compositionStore,
    });
  }

  beforeEach(() => { store = makeFakeStore(); });

  it('records a settled placement weight against the scale id', async () => {
    build({ compositionStore: store });
    emit(480); await flush();          // learn the resting baseline
    emit(600); await flush();          // placement → prompt posted

    expect(store.weights).toEqual([{ scaleId: 'kitchen', grams: 600, unit: 'g' }]);
  });

  it('follows the weight up while the same prompt is live', async () => {
    build({ compositionStore: store });
    emit(480); await flush();
    emit(600); await flush();
    emit(650); await flush();          // edit in place

    expect(store.weights.map((w) => w.grams)).toEqual([600, 650]);
  });

  it('does not record a weight for the resting baseline', async () => {
    build({ compositionStore: store });
    emit(480); await flush();
    emit(482); await flush();          // still at rest

    expect(store.weights).toEqual([]);
  });

  it('ends the placement when the scale returns to its resting load', async () => {
    build({ compositionStore: store });
    emit(480); await flush();
    emit(600); await flush();
    emit(481); await flush();          // removed

    expect(store.ends).toEqual(['kitchen']);
  });

  it('ends a placement that was never posted, so its scans cannot be inherited', async () => {
    build({ compositionStore: store });
    emit(480); await flush();
    emit(487); await flush();          // rise above tolerance, below placementDeltaG → no post
    emit(480); await flush();

    expect(store.weights).toEqual([]);
    expect(store.ends).toEqual(['kitchen']);
  });

  it('ends the placement once per crossing, not once per at-rest frame', async () => {
    build({ compositionStore: store });
    emit(480); await flush();
    emit(600); await flush();
    emit(480); await flush();
    emit(480); await flush();          // firmware heartbeats on the shelf
    emit(481); await flush();

    expect(store.ends).toEqual(['kitchen']);
  });

  // The buffer is OPTIONAL — the prompt flow works on its own and is what the
  // user is looking at. This asserts the prompt is still posted (with an explicit
  // null composition) rather than merely that nothing threw: `emit` returns
  // undefined and `onPayload` swallows its own errors, so a "did not throw"
  // assertion here would pass even if the bridge did nothing at all.
  it('still posts prompts, with a null composition, when no store is injected', async () => {
    build({});
    emit(480); await flush();          // learn the resting baseline
    emit(600); await flush();          // placement → prompt posted

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toMatchObject({ grams: 600, composition: null });

    emit(480); await flush();          // removed — nothing to end, still no throw
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('passes the composition snapshot through on create and on edit', async () => {
    store.read = () => ({ grams: 600, unit: 'g', density: 4, container: 'mug', complete: true, active: true });
    build({ compositionStore: store });
    emit(480); await flush();
    emit(600); await flush();          // create
    emit(650); await flush();          // edit in place

    expect(execute.mock.calls[0][0].composition).toMatchObject({ container: 'mug', density: 4 });
    expect(execute.mock.calls[1][0].composition).toMatchObject({ container: 'mug', density: 4 });
  });
});

describe('ScaleNutribotBridge unit passthrough', () => {
  let bus; let store; let execute;

  function build({ compositionStore } = {}) {
    const m = makeContainer();
    bus = makeBus();
    execute = m.execute;
    return createScaleNutribotBridge({
      eventBus: bus,
      nutribotContainer: m.container,
      userId: 'test-user',
      conversationId: 'telegram:b1_c2',
      scaleConfig: normalizeScaleNutribotConfig({}),
      logger,
      now: () => 1_000_000,
      compositionStore,
    });
  }

  beforeEach(() => { store = makeFakeStore(); });

  it('buffers the unit the scale actually reported', async () => {
    build({ compositionStore: store });
    bus.emit('food-scale', { id: 'kitchen', grams: 480, stable: true, unit: 'ml' }); await flush();
    bus.emit('food-scale', { id: 'kitchen', grams: 600, stable: true, unit: 'ml' }); await flush();

    expect(store.weights).toEqual([{ scaleId: 'kitchen', grams: 600, unit: 'ml' }]);
  });

  it('falls back to grams only when the payload omits a unit', async () => {
    build({ compositionStore: store });
    bus.emit('food-scale', { id: 'kitchen', grams: 480, stable: true }); await flush();
    bus.emit('food-scale', { id: 'kitchen', grams: 600, stable: true }); await flush();

    expect(store.weights).toEqual([{ scaleId: 'kitchen', grams: 600, unit: 'g' }]);
  });

  it('threads the unit into the log use case on create and on edit-in-place', async () => {
    build({ compositionStore: store });
    bus.emit('food-scale', { id: 'kitchen', grams: 480, stable: true, unit: 'ml' }); await flush();
    bus.emit('food-scale', { id: 'kitchen', grams: 600, stable: true, unit: 'ml' }); await flush(); // create
    bus.emit('food-scale', { id: 'kitchen', grams: 650, stable: true, unit: 'ml' }); await flush(); // edit in place

    expect(execute.mock.calls[0][0].unit).toBe('ml');
    expect(execute.mock.calls[1][0].unit).toBe('ml');
  });

  // No live prompt exists yet when the button fires (the one prior emit only
  // learns the baseline — `s.baseline === null` returns before any `execute`
  // call), so the force branch falls through to `post` → `create`. This is
  // the CREATE sub-path of force; see the next test for the DEDUP-EDIT
  // sub-path, which is a different call site in the bridge.
  it('threads the unit into the log use case on a force (button) log that POSTS (no live prompt yet)', async () => {
    build({ compositionStore: store });
    bus.emit('food-scale', { id: 'kitchen', grams: 300, stable: true, unit: 'ml' }); await flush();
    bus.emit('food-scale', { id: 'kitchen', grams: 300, stable: false, unit: 'ml', event: 'button' }); await flush();

    expect(execute).toHaveBeenCalledTimes(1);
    const call = execute.mock.calls[0][0];
    expect(call.existingLogUuid).toBeFalsy();   // proves this is create, not the dedup-edit path
    expect(call.unit).toBe('ml');
  });

  // Here a live prompt IS already posted (baseline, then a placement rise that
  // posts) before the button fires, and the button's weight lands within
  // `forceToleranceG` (default 10 g) of `s.live.grams` — so the force branch
  // takes the OTHER sub-path this time: `s.live && Math.abs(g - s.live.grams)
  // <= forceTolG` → `editInPlace(...)`, a call site the previous test never
  // reaches. Asserting `existingLogUuid` is truthy proves this really is the
  // edit call and not a second create.
  it('threads the unit into the log use case on a force (button) log that DEDUP-EDITS a live prompt', async () => {
    build({ compositionStore: store });
    bus.emit('food-scale', { id: 'kitchen', grams: 480, stable: true, unit: 'ml' }); await flush();   // baseline
    bus.emit('food-scale', { id: 'kitchen', grams: 600, stable: true, unit: 'ml' }); await flush();   // posts → s.live set
    execute.mockClear();

    // s.lastGrams is already 600 from the emit above; the button event's own
    // grams/stable fields are irrelevant to the force branch, which reads
    // s.lastGrams, not the payload.
    bus.emit('food-scale', { id: 'kitchen', grams: 600, stable: false, unit: 'ml', event: 'button' }); await flush();

    expect(execute).toHaveBeenCalledTimes(1);
    const call = execute.mock.calls[0][0];
    expect(call.existingLogUuid).toBeTruthy();  // proves this is the dedup EDIT, not a fresh post
    expect(call.unit).toBe('ml');
  });

  it('carries the original unit into a composition-triggered refresh (no new payload)', async () => {
    const bridge = build({ compositionStore: store });
    bus.emit('food-scale', { id: 'kitchen', grams: 480, stable: true, unit: 'ml' }); await flush();
    bus.emit('food-scale', { id: 'kitchen', grams: 600, stable: true, unit: 'ml' }); await flush(); // prompt live at 600 ml
    execute.mockClear();

    await bridge.refreshPrompt('kitchen');
    expect(execute.mock.calls[0][0].unit).toBe('ml');
  });
});

describe('ScaleNutribotBridge.refreshPrompt', () => {
  let bus; let store; let execute;

  const emit = (grams, stable = true) => bus.emit('food-scale', { id: 'kitchen', grams, stable, unit: 'g' });

  function build({ compositionStore } = {}) {
    const m = makeContainer();
    bus = makeBus();
    execute = m.execute;
    return createScaleNutribotBridge({
      eventBus: bus,
      nutribotContainer: m.container,
      userId: 'test-user',
      conversationId: 'telegram:b1_c2',
      scaleConfig: normalizeScaleNutribotConfig({}),
      logger,
      now: () => 1_000_000,
      compositionStore,
    });
  }

  beforeEach(() => { store = makeFakeStore(); });

  it('is exposed on the object the bridge returns', () => {
    const bridge = build({ compositionStore: store });
    expect(typeof bridge.refreshPrompt).toBe('function');
    expect(typeof bridge.dispose).toBe('function');
  });

  it('returns false and does not throw when nothing is live', async () => {
    const bridge = build({ compositionStore: store });
    await expect(bridge.refreshPrompt('kitchen')).resolves.toBe(false);
    await expect(bridge.refreshPrompt('nonexistent-scale')).resolves.toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it('re-renders the live prompt in place with the current composition', async () => {
    const bridge = build({ compositionStore: store });
    emit(480); await flush();
    emit(600); await flush();          // prompt is live at 600 g
    execute.mockClear();

    store.read = () => ({ grams: 600, unit: 'g', density: null, container: 'mug', complete: false, active: true });
    await expect(bridge.refreshPrompt('kitchen')).resolves.toBe(true);

    expect(execute).toHaveBeenCalledTimes(1);
    const arg = execute.mock.calls[0][0];
    expect(arg.grams).toBe(600);                       // same weight — only composition changed
    expect(arg.existingLogUuid).toBe('l1');
    expect(arg.messageId).toBe('m1');
    expect(arg.composition).toMatchObject({ container: 'mug' });
  });

  it('returns false rather than throwing when the edit blows up', async () => {
    const bridge = build({ compositionStore: store });
    emit(480); await flush();
    emit(600); await flush();
    execute.mockRejectedValueOnce(new Error('telegram down'));

    await expect(bridge.refreshPrompt('kitchen')).resolves.toBe(false);
  });

  // Scanning while the scale is still settling is the NORMAL interaction, and it
  // used to race: `onPayload` serialises per scale with `inflight`, but
  // refreshPrompt went straight to editInPlace, so a scan could edit a message
  // `post()` had just retracted — Telegram 400, and no ACK at all. Dropping the
  // refresh is safe because the buffer is already updated: the in-flight weight
  // edit reads it and renders the new state anyway.
  it('drops the refresh (returns false, no edit) while the scale is inflight', async () => {
    const bridge = build({ compositionStore: store });
    emit(480); await flush();
    emit(600); await flush();          // prompt live at 600 g
    execute.mockClear();

    let release;
    const gate = new Promise((r) => { release = r; });
    execute.mockImplementationOnce(async (input) => {
      await gate;
      return { success: true, logUuid: input.existingLogUuid, messageId: 'm1', stage: 'density', edited: true };
    });

    emit(700);                          // weight edit starts and parks on the gate
    await flush();

    await expect(bridge.refreshPrompt('kitchen')).resolves.toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);   // the weight edit only — no racing edit

    release(); await flush();
  });

  it('refreshes again normally once the scale is no longer inflight', async () => {
    const bridge = build({ compositionStore: store });
    emit(480); await flush();
    emit(600); await flush();
    emit(700); await flush();          // completes, releases the lock
    execute.mockClear();

    await expect(bridge.refreshPrompt('kitchen')).resolves.toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('forwards a transient notice to the prompt render', async () => {
    const bridge = build({ compositionStore: store });
    emit(480); await flush();
    emit(600); await flush();
    execute.mockClear();

    await bridge.refreshPrompt('kitchen', 'unknown container "teapot" — not tared');
    expect(execute.mock.calls[0][0].notice).toBe('unknown container "teapot" — not tared');
  });

  it('sends no notice when none is given, so it cannot leak into the next render', async () => {
    const bridge = build({ compositionStore: store });
    emit(480); await flush();
    emit(600); await flush();
    execute.mockClear();

    await bridge.refreshPrompt('kitchen', 'transient warning');
    await bridge.refreshPrompt('kitchen');
    expect(execute.mock.calls[1][0].notice ?? null).toBe(null);

    emit(700); await flush();          // a weight change re-renders clean too
    expect(execute.mock.calls[2][0].notice ?? null).toBe(null);
  });
});
