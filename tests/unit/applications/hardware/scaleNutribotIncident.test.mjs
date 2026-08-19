//
// 2026-08-18 12:31 PM, reconstructed from the log store:
//   12:31:45  scale settles 639 g      -> prompt posted, stage: density
//   12:31:47  dl:140  (Mixed, 1.4)     -> swallowed; nutriscan was disabled
//   12:31:51  ct:60   (Tupperware)     -> swallowed, and logged nowhere at all
//   12:31:57  scale settles 473 g      -> entry edited, then stranded
// Net stayed equal to gross throughout: no tare, no density, no calories. The
// two scans were 4.4 s apart, which is why "commit the instant it looks
// complete" would still have been wrong — it would have closed the entry before
// the container scan landed.
//
// With the fusion in place this is ONE entry: 473 g gross - 60 g tare = 413 g
// net, at 1.4 kcal/g = 578 kcal.
//
// ## What is REAL here and what is a double
//
// REAL: `CompositionStore`, `ApplyScanToComposition`, `createScanDispatch` (so a
// scan travels the same route a fridge-sheet QR does and reaches `armCommitFor`
// the way production wires it), `createScaleNutribotBridge`,
// `normalizeScaleNutribotConfig`, and the derivation path
// (`resolveScaleNet` -> `computeNet`, and `computeNutrition`). A harness that
// stubs `compositionStore.read()` to answer `complete: true` proves nothing
// about the arithmetic, so nothing on the composition path is stubbed.
//
// DOUBLED: only the Telegram-facing use cases — `LogFoodFromScale`,
// `AcceptFoodLog`, `RetractScaleLog`. Those own message rendering and history
// persistence and have their own suites.
//
// TIME is driven by hand via an injected scheduler (same shape as
// `scaleNutribotQuietCommit.test.mjs`); `vi.useFakeTimers()` interleaves badly
// with the awaited AcceptFoodLog call.

import { describe, it, expect, vi } from 'vitest';
import { createScaleNutribotBridge } from '#apps/hardware/ScaleNutribotBridge.mjs';
import { CompositionStore } from '#apps/nutribot/CompositionStore.mjs';
import { ApplyScanToComposition } from '#apps/nutribot/usecases/ApplyScanToComposition.mjs';
import { resolveScaleNet } from '#apps/nutribot/usecases/LogFoodFromScale.mjs';
import {
  normalizeScaleNutribotConfig,
  densityForLevel,
  DEFAULT_DENSITY_LEVELS,
} from '#apps/nutribot/lib/scaleNutribotConfig.mjs';
import { computeNet, computeNutrition } from '#domains/nutrition/index.mjs';
import { createScanDispatch } from '#composition/modules/scanDispatch.mjs';

const SCALE = 'kitchen-food-scale';
const DEVICE = 'nutribot-upc';

// Let every queued microtask AND the awaited AcceptFoodLog settle. A single
// `await Promise.resolve()` is not enough: `commitNow` awaits the accept before
// it consumes the composition, so the post-commit state is only observable
// after a real turn of the loop.
const flush = () => new Promise((r) => setTimeout(r, 0));

// The container table the incident's sheet was printed from. `ct:60` carries the
// TARE IN GRAMS, so the row exists for its id and label — 60 g is the
// tupperware. The density table is the shipped default, which already holds
// level 4 "Mixed" at 1.4 kcal/g, i.e. exactly the `dl:140` that was scanned.
const CONFIG = normalizeScaleNutribotConfig({
  nutribot: {
    min_grams: 5,
    commit_quiet_sec: 25,
    containers: {
      threshold_g: 150,
      items: [
        { id: 'tupperware', label: 'Tupperware', emoji: '🥡', grams: 60 },
        { id: 'dinner-plate', label: 'Dinner plate', emoji: '🍽', grams: 340 },
      ],
    },
    density_levels: DEFAULT_DENSITY_LEVELS,
  },
});

// A scheduler we drive by hand: no fake timers, no real waiting. Same shape as
// `scaleNutribotQuietCommit.test.mjs`.
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

function makeIncidentHarness() {
  const noop = { debug() {}, info() {}, warn() {}, error() {} };

  // Telegram-facing doubles. A create is told from an edit by `existingLogUuid`,
  // and an edit MUST answer `edited: true` or the bridge treats the dispatch as
  // failed and bails before it buffers the weight (and so before it arms).
  const accept = { execute: vi.fn().mockResolvedValue({ success: true }) };
  const retract = { execute: vi.fn().mockResolvedValue({ success: true, retracted: true }) };
  const logFromScale = {
    execute: vi.fn(async (input) => (input.existingLogUuid
      ? { success: true, logUuid: input.existingLogUuid, messageId: 'm1', stage: 'density', edited: true }
      : { success: true, logUuid: 'L1', messageId: 'm1', stage: 'density' })),
  };

  // What the bridge says it committed, straight off its own commit path.
  const committed = [];
  const bridgeLogger = {
    debug() {}, warn() {}, error() {},
    info(event, data) { if (event === 'scaleNutribot.commit.committed') committed.push(data); },
  };

  // REAL store + REAL scan use case.
  const compositionStore = new CompositionStore({ now: () => Date.now() });
  const applyScanToComposition = new ApplyScanToComposition({
    store: compositionStore, config: CONFIG, logger: noop,
  });

  const handlers = {};
  const scheduler = manualScheduler();
  const bridge = createScaleNutribotBridge({
    eventBus: { subscribe: (t, fn) => { handlers[t] = fn; return () => {}; } },
    nutribotContainer: {
      getLogFoodFromScale: () => logFromScale,
      getAcceptFoodLog: () => accept,
      getRetractScaleLog: () => retract,
    },
    userId: 'kckern',
    conversationId: 'telegram:b1_c2',
    scaleConfig: CONFIG,
    compositionStore,
    commitQuietMs: CONFIG.commitQuietSec * 1000,
    scheduler,
    logger: bridgeLogger,
  });

  // The REAL dispatcher, so a scan reaches `armCommitFor` (and `refreshPrompt`)
  // by the same route a fridge-sheet QR takes in production rather than by the
  // test poking the bridge directly.
  const scanDispatch = createScanDispatch({
    schoolLifecycle: null,
    schoolCalcResultImporter: null,
    triggerDispatchService: { handleEvent: async () => ({ ok: true }) },
    relayInstances: { [DEVICE]: { route: 'nutribot', scale_id: SCALE } },
    relayConfig: {},
    applyScanToComposition,
    getScaleNutribotBridge: () => bridge,
    getLogFoodFromUPC: () => ({ execute: async () => ({ ok: true }) }),
    configService: { getSystemConfig: () => ({}), getHeadOfHousehold: () => 'kckern' },
    userIdentityService: { resolvePlatformId: () => null },
    screenNames: [],
    logger: noop,
    barcodeLogger: noop,
  });

  const publish = (payload) => handlers['food-scale'](payload);
  const scan = (code) => scanDispatch.handleScan({
    source: 'barcode-relay', device: DEVICE, route: 'nutribot', code, ts: '2026-08-18 12:31:00',
  });

  return {
    bridge, accept, retract, logFromScale, compositionStore, applyScanToComposition,
    scheduler, publish, scan, scanDispatch, committed,
  };
}

// The bridge SWALLOWS the first settled frame to learn its resting baseline
// (`if (s.baseline === null) { s.baseline = grams; return; }`), so a harness
// whose first bus event is the placement asserts against nothing at all. Every
// scenario below primes an at-rest frame first.
const prime = (h) => h.publish({ id: SCALE, grams: 0, unit: 'g', stable: true });
const settle = (h, grams) => h.publish({ id: SCALE, grams, unit: 'g', stable: true });

/**
 * Derive net grams and calories from a composition snapshot exactly the way
 * production does: `resolveScaleNet` (which calls the domain's `computeNet`) for
 * the tare, then `ScanNutritionService.computeNutrition` at the scanned level.
 */
function derive(snapshot) {
  const resolution = resolveScaleNet(
    { gross: snapshot.grams, composition: snapshot }, CONFIG.containers,
  );
  const level = densityForLevel(CONFIG, snapshot.density);
  const nutrition = computeNutrition(resolution.net, level);
  return { resolution, level, nutrition };
}

describe('the 12:31 incident', () => {
  it('produces one committed entry of net 413 g', async () => {
    const h = makeIncidentHarness();

    await prime(h);                       // the scale at rest on its shelf
    await settle(h, 639);                 // 12:31:45 — prompt posted
    await h.scan('dl:140');               // 12:31:47 — Mixed, 1.4 kcal/g
    await h.scan('ct:60');                // 12:31:51 — tupperware, 60 g tare
    await settle(h, 473);                 // 12:31:57 — settles lower, edited in place

    // Still gathering. Committing at any point up to here is what closed the old
    // entry 4.4 s before the container scan that belonged to it.
    expect(h.accept.execute).not.toHaveBeenCalled();

    // Every one of the four applied inputs pushed the deadline out — the post,
    // both scans, and the weight edit. Asserted as a COUNT because a hand-driven
    // scheduler leaves a timer armed forever once set, so "something is pending"
    // would also be true of a clock that no scan ever touched.
    expect(h.scheduler.counts.arms).toBe(4);
    expect(h.scheduler.counts.clears).toBe(3);

    // Read BEFORE the fire: this is the object `commitNow` reads synchronously
    // at the top of the timer callback, and the commit consumes the slots
    // immediately afterwards.
    const snapshot = h.compositionStore.read(SCALE);
    expect(snapshot.grams).toBe(473);
    expect(snapshot.unit).toBe('g');
    expect(snapshot.container).toBe('tupperware');
    expect(snapshot.density).toBe(4);
    expect(snapshot.complete).toBe(true);

    h.scheduler.fire();
    await flush();

    // ONE entry, and the bridge's own commit record agrees with the snapshot.
    expect(h.accept.execute).toHaveBeenCalledTimes(1);
    expect(h.accept.execute).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'kckern', conversationId: 'telegram:b1_c2', logUuid: 'L1', messageId: 'm1',
    }));
    expect(h.committed).toEqual([
      { id: SCALE, logUuid: 'L1', grams: 473, density: 4, container: 'tupperware' },
    ]);

    // And the placement is over: the slots are consumed, so the next food on the
    // pan cannot inherit this tare and density.
    expect(h.compositionStore.read(SCALE).active).toBe(false);

    h.bridge.dispose();
  });

  // The numbers the incident should have produced, run through the SAME
  // derivation production uses. Nothing here is a hard-coded product: the tare
  // comes off the container row and the calories off the density row. Only the
  // final totals are pinned, and those are the incident's own figures
  // (473 - 60 = 413 g; round(413 x 1.4) = 578 kcal).
  it('derives 413 g net and 578 kcal from what it committed', async () => {
    const h = makeIncidentHarness();
    await prime(h);
    await settle(h, 639);
    await h.scan('dl:140');
    await h.scan('ct:60');
    await settle(h, 473);

    const snapshot = h.compositionStore.read(SCALE);
    h.scheduler.fire();
    await flush();
    expect(h.accept.execute).toHaveBeenCalledTimes(1);

    const { resolution, level, nutrition } = derive(snapshot);

    // The tare was actually applied. The incident's signature failure was
    // net === gross, which this catches even where the totals happen to line up.
    expect(resolution.container.id).toBe('tupperware');
    expect(resolution.tared).toBe(true);
    expect(resolution.net).not.toBe(snapshot.grams);
    expect(resolution.net).toBe(snapshot.grams - resolution.container.grams);

    // The domain service agrees, called directly on the same inputs.
    expect(computeNet(snapshot.grams, resolution.container))
      .toMatchObject({ netG: resolution.net, tared: true, clamped: false });

    expect(level.level).toBe(4);
    expect(level.label).toBe('Mixed');
    expect(nutrition.calories).toBe(Math.round(resolution.net * level.kcal_per_g));
    // Macro grams burn back to the stored calorie total — the invariant that
    // justifies storing macros as percent-of-calories.
    expect(nutrition.fat_g * 9 + nutrition.carb_g * 4 + nutrition.protein_g * 4)
      .toBeCloseTo(nutrition.calories, 6);

    expect(resolution.net).toBe(413);
    expect(nutrition.calories).toBe(578);

    h.bridge.dispose();
  });

  // The 4.4 s gap is the whole point. A commit-on-sufficiency rule fires the
  // moment weight+density are both present, which here is BEFORE `ct:60`.
  it('is still waiting when the container scan arrives 4.4 s behind the density', async () => {
    const h = makeIncidentHarness();
    await prime(h);
    await settle(h, 639);
    await h.scan('dl:140');

    // Weight AND density are both in the buffer — "complete" by the store's own
    // rule — and still nothing has committed.
    expect(h.compositionStore.read(SCALE)).toMatchObject({ complete: true, container: null });
    expect(h.accept.execute).not.toHaveBeenCalled();

    await h.scan('ct:60');
    expect(h.compositionStore.read(SCALE).container).toBe('tupperware');

    h.scheduler.fire();
    await flush();
    expect(h.accept.execute).toHaveBeenCalledTimes(1);
    expect(h.committed[0]).toMatchObject({ grams: 639, density: 4, container: 'tupperware' });
    h.bridge.dispose();
  });

  // Each fridge-sheet scan must restart the clock through the real dispatcher.
  // This is what stops the 25 s lull being measured from the last WEIGHT.
  it('restarts the quiet clock from each scan, via the real dispatch path', async () => {
    const h = makeIncidentHarness();
    await prime(h);
    await settle(h, 639);
    expect(h.scheduler.counts.arms).toBe(1);   // armed by the post

    await h.scan('dl:140');
    expect(h.scheduler.counts.arms).toBe(2);
    await h.scan('ct:60');
    expect(h.scheduler.counts.arms).toBe(3);
    expect(h.scheduler.counts.clears).toBe(2); // each re-arm cancelled its predecessor
    expect(h.scheduler.pending.ms).toBe(25_000);

    // A code the fridge grammar does not claim must NOT touch the clock.
    await h.scan('012345678905');
    expect(h.scheduler.counts.arms).toBe(3);
    h.bridge.dispose();
  });
});

// Order independence is the correctness claim the whole feature rests on, and
// quiet-commit is the first thing that can break it: a timer armed by only SOME
// inputs converges differently depending on arrival order. `CompositionStore`
// already has this test for its own slots; this asserts it survives the timer.
const INPUTS = [
  { kind: 'weight', apply: (h) => settle(h, 473) },
  { kind: 'density', apply: (h) => h.scan('dl:140') },
  { kind: 'container', apply: (h) => h.scan('ct:60') },
];

const permutations = (xs) => (xs.length <= 1 ? [xs]
  : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));

describe('every arrival order converges on the same entry', () => {
  it.each(permutations(INPUTS).map((p) => [p.map((s) => s.kind).join(' -> '), p]))(
    'converges the same for %s',
    async (_label, order) => {
      const h = makeIncidentHarness();
      // The at-rest frame only teaches the bridge its resting load; it is not one
      // of the three inputs and carries no composition state, so priming it first
      // leaves the ordering under test intact. The WEIGHT-LAST orders are the
      // ones that matter: a scan arriving before any food is on the pan must
      // still be waiting when the weight lands.
      await prime(h);
      for (const step of order) await step.apply(h);

      const snap = h.compositionStore.read(SCALE);
      expect(snap).toMatchObject({
        grams: 473, unit: 'g', density: 4, container: 'tupperware', complete: true, active: true,
      });
      // Order independence of the CLOCK as well as of the slots: whichever way
      // round they arrive, all three inputs push the deadline out, and each
      // re-arm cancels its predecessor. Without this the permutations would
      // still pass with a dead `armCommitFor` — a hand-driven timer stays armed
      // once the post sets it, so only the count can tell.
      expect(h.scheduler.counts.arms).toBe(3);
      expect(h.scheduler.counts.clears).toBe(2);

      h.scheduler.fire();
      await flush();

      expect(h.accept.execute).toHaveBeenCalledTimes(1);
      expect(h.accept.execute).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'kckern', conversationId: 'telegram:b1_c2', logUuid: 'L1',
      }));
      // Identical committed snapshot in all six orders.
      expect(h.committed).toEqual([
        { id: SCALE, logUuid: 'L1', grams: 473, density: 4, container: 'tupperware' },
      ]);

      const { resolution, nutrition } = derive(snap);
      expect(resolution.net).toBe(413);
      expect(nutrition.calories).toBe(578);

      h.bridge.dispose();
    },
  );
});
