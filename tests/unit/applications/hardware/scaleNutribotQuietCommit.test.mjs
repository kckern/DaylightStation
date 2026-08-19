//
// QUIET COMMIT. Weight, density and container arrive as separate events with no
// payload boundary, so "the composition is finished" is not an event anybody
// sends — it is an absence. These tests drive that absence by hand.
//
// The scheduler is INJECTED rather than faked with `vi.useFakeTimers()`: the
// bridge's commit path is async (it awaits AcceptFoodLog), and fake timers
// interleave badly with awaited promises here. A hand-driven scheduler makes the
// lull an explicit step in the test rather than a race against the event loop.

import { describe, it, expect, vi } from 'vitest';
import { createScaleNutribotBridge } from '#apps/hardware/ScaleNutribotBridge.mjs';

// A scheduler we drive by hand: no fake timers, no real waiting.
// `arms`/`clears` are counted so "restarts the interval" can be asserted as a
// re-arm rather than merely as "something is still pending", which a timer that
// was never touched would also satisfy.
function manualScheduler() {
  let pending = null;
  const counts = { arms: 0, clears: 0 };
  return {
    setTimeout: (fn, ms) => { pending = { fn, ms }; counts.arms += 1; return 1; },
    clearTimeout: () => { if (pending) counts.clears += 1; pending = null; },
    fire: () => { const p = pending; pending = null; p?.fn(); },
    get pending() { return pending; },
    counts,
  };
}

const SCALE = 'kitchen-food-scale';

const makeHarness = ({ complete = true } = {}) => {
  const accept = { execute: vi.fn().mockResolvedValue({ success: true }) };
  // Same convention as the existing bridge suite: an EDIT is told from a CREATE
  // by `existingLogUuid`, and must answer `edited: true` or the bridge treats the
  // dispatch as failed and bails before it can buffer (and so before it can arm).
  const logFromScale = {
    execute: vi.fn(async (input) => (input.existingLogUuid
      ? { success: true, logUuid: input.existingLogUuid, messageId: '9', edited: true }
      : { success: true, logUuid: 'L1', messageId: '9' })),
  };
  const compositionStore = {
    setWeight: vi.fn(), endPlacement: vi.fn(),
    read: vi.fn(() => ({ grams: 413, unit: 'g', density: 4, container: 'tupperware', complete, active: true })),
  };
  const handlers = {};
  const eventBus = { subscribe: (t, fn) => { handlers[t] = fn; return () => {}; } };
  const scheduler = manualScheduler();
  const bridge = createScaleNutribotBridge({
    eventBus,
    nutribotContainer: {
      getLogFoodFromScale: () => logFromScale,
      getAcceptFoodLog: () => accept,
      getRetractScaleLog: () => ({ execute: vi.fn() }),
    },
    userId: 'kckern', conversationId: 'telegram:b1_c2',
    scaleConfig: { minGrams: 5 },
    compositionStore,
    commitQuietMs: 25_000,
    scheduler,
    logger: { info() {}, warn() {}, debug() {} },
  });
  const publish = (p) => handlers['food-scale'](p);
  // The first settled frame only LEARNS the resting load (`s.baseline === null`
  // returns early), so every placement below has to be preceded by one or the
  // bridge never posts a prompt at all and there is nothing to commit.
  const prime = (unit = 'g') => publish({ id: SCALE, grams: 0, unit, stable: true });
  return { bridge, accept, logFromScale, compositionStore, scheduler, publish, prime };
};

describe('ScaleNutribotBridge quiet-commit', () => {
  it('commits the entry once the quiet interval elapses with the composition complete', async () => {
    const { bridge, accept, scheduler, publish, prime } = makeHarness();
    await prime();
    await publish({ id: SCALE, grams: 639, unit: 'g', stable: true });
    expect(accept.execute).not.toHaveBeenCalled();   // not yet — it is still quiet-waiting
    expect(scheduler.pending?.ms).toBe(25_000);
    scheduler.fire();
    await Promise.resolve();
    expect(accept.execute).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'kckern', conversationId: 'telegram:b1_c2', logUuid: 'L1',
    }));
    bridge.dispose();
  });

  // Task 5 was withdrawn and folded in here: a volume must never auto-commit.
  it('does not commit a millilitre reading, however complete it looks', async () => {
    const { bridge, accept, scheduler, publish, prime, compositionStore } = makeHarness();
    compositionStore.read = () => ({ grams: 240, unit: 'ml', density: 4, container: null, complete: true, active: true });
    await prime('ml');
    await publish({ id: SCALE, grams: 240, unit: 'ml', stable: true });
    scheduler.fire();
    await Promise.resolve();
    expect(accept.execute).not.toHaveBeenCalled();
    bridge.dispose();
  });

  it('does not commit while the composition is incomplete', async () => {
    const { bridge, accept, scheduler, publish, prime } = makeHarness({ complete: false });
    await prime();
    await publish({ id: SCALE, grams: 639, unit: 'g', stable: true });
    scheduler.fire();
    await Promise.resolve();
    expect(accept.execute).not.toHaveBeenCalled();
    bridge.dispose();
  });

  // The 12:31 incident: a container scanned 4.4s after the density must land
  // before the entry closes. Any applied input restarts the clock.
  it('restarts the interval when another input arrives', async () => {
    const { bridge, accept, scheduler, publish, prime } = makeHarness();
    await prime();
    await publish({ id: SCALE, grams: 639, unit: 'g', stable: true });   // posts
    await publish({ id: SCALE, grams: 473, unit: 'g', stable: true });   // edits in place
    expect(scheduler.pending).not.toBeNull();
    expect(scheduler.counts.arms).toBe(2);      // re-armed, not merely left running
    expect(scheduler.counts.clears).toBe(1);    // and the first one was cancelled
    scheduler.fire();
    await Promise.resolve();
    expect(accept.execute).toHaveBeenCalledTimes(1);
    bridge.dispose();
  });

  // A scan is the OTHER half of the composition and arrives on a different path
  // entirely (scanDispatch, not the event bus), so it needs its own way back in.
  it('restarts the interval from a scan, via armCommitFor', async () => {
    const { bridge, accept, scheduler, publish, prime } = makeHarness();
    await prime();
    await publish({ id: SCALE, grams: 639, unit: 'g', stable: true });
    expect(scheduler.counts.arms).toBe(1);

    bridge.armCommitFor(SCALE);
    expect(scheduler.counts.arms).toBe(2);
    expect(scheduler.counts.clears).toBe(1);

    bridge.armCommitFor('a-scale-that-was-never-seen');   // must not throw
    expect(scheduler.counts.arms).toBe(2);

    scheduler.fire();
    await Promise.resolve();
    expect(accept.execute).toHaveBeenCalledTimes(1);
    bridge.dispose();
  });

  // The scale firmware heartbeats at 0.5 Hz while it merely RESTS on its shelf.
  // A timer restarted by raw frames would never fire — the same reason
  // CompositionStore keeps raw frames out of its own window refresh.
  it('does not restart the interval from an at-rest heartbeat', async () => {
    const { bridge, scheduler, publish, prime } = makeHarness();
    await prime();
    await publish({ id: SCALE, grams: 639, unit: 'g', stable: true });
    expect(scheduler.counts.arms).toBe(1);

    await publish({ id: SCALE, grams: 641, unit: 'g', stable: true });   // within dedupDeltaG — same held value
    await publish({ id: SCALE, grams: 640, unit: 'g', stable: false });  // unsettled frame
    expect(scheduler.counts.arms).toBe(1);
    bridge.dispose();
  });

  // Lifting the food off ends the placement, which CONSUMES the buffered scans.
  // A timer still running past that point would commit against a composition the
  // store has already thrown away.
  it('disarms the timer when the placement ends', async () => {
    const { bridge, accept, scheduler, publish, prime } = makeHarness();
    await prime();
    await publish({ id: SCALE, grams: 639, unit: 'g', stable: true });
    await publish({ id: SCALE, grams: 1, unit: 'g', stable: true });     // back to the resting load

    expect(scheduler.pending).toBeNull();
    scheduler.fire();
    await Promise.resolve();
    expect(accept.execute).not.toHaveBeenCalled();
    bridge.dispose();
  });

  it('disarms the timer on dispose, so a torn-down bridge cannot commit', async () => {
    const { bridge, accept, scheduler, publish, prime } = makeHarness();
    await prime();
    await publish({ id: SCALE, grams: 639, unit: 'g', stable: true });
    expect(scheduler.pending).not.toBeNull();

    bridge.dispose();
    expect(scheduler.pending).toBeNull();
    scheduler.fire();
    await Promise.resolve();
    expect(accept.execute).not.toHaveBeenCalled();
  });

  // The buffer is OPTIONAL — the prompt flow stands on its own. With no store
  // there is no composition to be complete, so nothing may auto-commit.
  it('arms nothing when no composition store is injected', async () => {
    const handlers = {};
    const accept = { execute: vi.fn() };
    const scheduler = manualScheduler();
    const bridge = createScaleNutribotBridge({
      eventBus: { subscribe: (t, fn) => { handlers[t] = fn; return () => {}; } },
      nutribotContainer: {
        getLogFoodFromScale: () => ({ execute: vi.fn().mockResolvedValue({ success: true, logUuid: 'L1', messageId: '9' }) }),
        getAcceptFoodLog: () => accept,
        getRetractScaleLog: () => ({ execute: vi.fn() }),
      },
      userId: 'kckern', conversationId: 'telegram:b1_c2',
      scaleConfig: { minGrams: 5 },
      commitQuietMs: 25_000,
      scheduler,
      logger: { info() {}, warn() {}, debug() {} },
    });
    await handlers['food-scale']({ id: SCALE, grams: 0, unit: 'g', stable: true });
    await handlers['food-scale']({ id: SCALE, grams: 639, unit: 'g', stable: true });

    expect(scheduler.pending).toBeNull();
    expect(accept.execute).not.toHaveBeenCalled();
    bridge.dispose();
  });
});
