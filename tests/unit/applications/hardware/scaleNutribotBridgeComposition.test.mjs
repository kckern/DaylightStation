import { describe, it, expect, beforeEach, vi } from 'vitest';
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

  it('works with no compositionStore injected', async () => {
    build({});
    emit(480); await flush();
    emit(600); await flush();
    await expect(Promise.resolve(emit(480))).resolves.not.toThrow();
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
});
