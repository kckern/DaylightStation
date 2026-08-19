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
import { CompositionStore } from '#apps/nutribot/CompositionStore.mjs';

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

  // The scale firmware heartbeats at 0.5 Hz while food SITS on the pan, and an
  // unsettled frame arrives on every wobble. Neither changes the composition, so
  // neither may restart the clock — the same reason CompositionStore keeps raw
  // frames out of its own window refresh. (A true AT-REST frame is a different
  // case again: it hits the placement-end crossing and DISARMS. See below.)
  it('does not restart the interval from a repeated or unsettled frame', async () => {
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

  // AcceptFoodLog is awaited, and a scan arriving during that await re-arms the
  // clock. If the prompt is still claimable when the second timer fires, the same
  // logUuid is accepted TWICE — a duplicate entry in nutrition history. Requires
  // the accept to outlast the whole quiet interval, which is why it is a latent
  // race rather than an everyday one; the cost when it lands is a wrong day's log.
  it('accepts a prompt only once, even if the clock re-fires mid-accept', async () => {
    const { bridge, accept, scheduler, publish, prime } = makeHarness();
    let release;
    const gate = new Promise((r) => { release = r; });
    accept.execute.mockImplementationOnce(async () => { await gate; return { success: true }; });

    await prime();
    await publish({ id: SCALE, grams: 639, unit: 'g', stable: true });

    scheduler.fire();                    // commit starts, parks on the gate
    expect(accept.execute).toHaveBeenCalledTimes(1);

    bridge.armCommitFor(SCALE);          // a scan lands while the accept is in flight
    scheduler.fire();                    // and the clock comes round again
    await Promise.resolve();
    expect(accept.execute).toHaveBeenCalledTimes(1);   // NOT twice

    release();
    await Promise.resolve();
    bridge.dispose();
  });

  // The claim must be a loan, not a theft: a failed accept has to leave the
  // prompt commitable again, or a Telegram blip silently strands the entry with
  // no way back other than answering it by hand.
  it('gives the prompt back when the accept fails, so the next lull retries', async () => {
    const { bridge, accept, scheduler, publish, prime } = makeHarness();
    accept.execute.mockRejectedValueOnce(new Error('telegram down'));

    await prime();
    await publish({ id: SCALE, grams: 639, unit: 'g', stable: true });

    scheduler.fire();
    await Promise.resolve();
    await Promise.resolve();
    expect(accept.execute).toHaveBeenCalledTimes(1);

    bridge.armCommitFor(SCALE);
    scheduler.fire();
    await Promise.resolve();
    expect(accept.execute).toHaveBeenCalledTimes(2);   // retried, not stranded
    bridge.dispose();
  });

  // A committed placement is OVER. Leaving the slots filled means the next food
  // inherits them, which is the exact failure `endPlacement` (D10) exists to
  // prevent — and quiet-commit makes it worse, because the inheriting entry then
  // auto-accepts too.
  it('consumes the composition once the accept succeeds', async () => {
    const { bridge, accept, scheduler, publish, prime, compositionStore } = makeHarness();
    await prime();
    await publish({ id: SCALE, grams: 639, unit: 'g', stable: true });
    expect(compositionStore.endPlacement).not.toHaveBeenCalled();

    scheduler.fire();
    await Promise.resolve();
    expect(accept.execute).toHaveBeenCalledTimes(1);
    expect(compositionStore.endPlacement).toHaveBeenCalledWith(SCALE);
    bridge.dispose();
  });

  it('leaves the composition alone when the commit is refused', async () => {
    for (const snapshot of [
      { grams: 413, unit: 'g', density: null, container: null, complete: false, active: true },
      { grams: 240, unit: 'ml', density: 4, container: null, complete: true, active: true },
    ]) {
      const { bridge, accept, scheduler, publish, prime, compositionStore } = makeHarness();
      compositionStore.read = () => snapshot;
      await prime(snapshot.unit);
      await publish({ id: SCALE, grams: snapshot.grams, unit: snapshot.unit, stable: true });
      scheduler.fire();
      await Promise.resolve();

      expect(accept.execute).not.toHaveBeenCalled();
      expect(compositionStore.endPlacement).not.toHaveBeenCalled();
      bridge.dispose();
    }
  });

  // Driven through the REAL CompositionStore, because the failure this guards is
  // a store-state failure: a mock hard-coded to `complete: true` reports the
  // inherited entry as healthy and cannot see it.
  it('does not let the next food on the pan inherit the committed density and tare', async () => {
    const handlers = {};
    const accept = { execute: vi.fn().mockResolvedValue({ success: true }) };
    const seen = [];
    const logFromScale = {
      execute: vi.fn(async (input) => {
        seen.push(input.composition);
        return input.existingLogUuid
          ? { success: true, logUuid: input.existingLogUuid, messageId: '9', edited: true }
          : { success: true, logUuid: `L${seen.length}`, messageId: '9' };
      }),
    };
    const store = new CompositionStore({ now: () => Date.now() });
    const scheduler = manualScheduler();
    const bridge = createScaleNutribotBridge({
      eventBus: { subscribe: (t, fn) => { handlers[t] = fn; return () => {}; } },
      nutribotContainer: {
        getLogFoodFromScale: () => logFromScale,
        getAcceptFoodLog: () => accept,
        getRetractScaleLog: () => ({ execute: vi.fn() }),
      },
      userId: 'kckern', conversationId: 'telegram:b1_c2',
      scaleConfig: { minGrams: 5 },
      compositionStore: store,
      commitQuietMs: 25_000,
      scheduler,
      logger: { info() {}, warn() {}, debug() {} },
    });
    const publish = (p) => handlers['food-scale'](p);

    await publish({ id: SCALE, grams: 0, unit: 'g', stable: true });   // resting load
    store.setDensity(SCALE, 4);
    store.setContainer(SCALE, 'tupperware');
    await publish({ id: SCALE, grams: 639, unit: 'g', stable: true }); // placement → prompt
    expect(seen[0]).toMatchObject({ density: 4, container: 'tupperware' });

    scheduler.fire();
    await Promise.resolve();
    expect(accept.execute).toHaveBeenCalledTimes(1);

    // The plate is never lifted — it is nudged, which is a fresh qualifying
    // placement. Under the old code this posted a prompt carrying the PREVIOUS
    // food's density and tare, and auto-accepted it 25s later.
    await publish({ id: SCALE, grams: 900, unit: 'g', stable: true });
    // The prompt's own snapshot carries no grams yet — `post` reads the
    // composition to render the prompt BEFORE it buffers the weight, which is
    // pre-existing and true of any first placement. The slots are what matter
    // here, and they are empty.
    expect(seen.at(-1)).toMatchObject({ density: null, container: null });
    expect(store.read(SCALE)).toMatchObject({ grams: 900, density: null, container: null });

    scheduler.fire();
    await Promise.resolve();
    expect(accept.execute).toHaveBeenCalledTimes(1);   // incomplete → no second entry
    bridge.dispose();
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
