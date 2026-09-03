// ObservationService — the durable replacement for ScaleNutribotBridge + CompositionStore.
//
// Every behaviour the shipped bridge had is pinned here against the NEW service before the
// old one is retired (Task 5.6). Where the bridge suite asserted a rule from two angles the
// two assertions are folded into one test; no RULE is dropped.
//
// Three deliberate choices in this harness:
//
//  • THE REAL `YamlObservationStore`, over an mkdtemp'd directory. The point of the phase is
//    durability, and a hand-rolled in-memory fake would prove the service works against a
//    fake. It also means the `IObservationStore` contract is exercised for real, including
//    the all-or-nothing `updateMany`.
//  • THE REAL `ApplyScanToComposition`. The service is a drop-in for `CompositionStore`, and
//    the only way to prove that is to let the shipped scan use case drive it unmodified —
//    the same grammar, the same config lookups, the same ack payloads.
//  • A HAND-DRIVEN scheduler and clock. The commit path awaits two use cases, and fake
//    timers interleave badly with awaited promises; the lull is an explicit step instead.
//    The clock runs in UTC so the local timestamp written into a row and the matcher's
//    window arithmetic are the same digits.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { YamlObservationStore } from '#adapters/persistence/yaml/YamlObservationStore.mjs';
import { ApplyScanToComposition } from '#apps/nutribot/usecases/ApplyScanToComposition.mjs';
import { createObservationService } from './ObservationService.mjs';

const SCALE = 'kitchen';
const USER = 'kckern';
const CONVO = 'telegram:b1_c2';

/** Scan config the fridge sheet would have been printed from. */
const SCAN_CONFIG = {
  densityLevels: [
    { level: 2, label: 'Light', emoji: '🥗', kcal_per_g: 0.6 },
    { level: 4, label: 'Medium', emoji: '🥘', kcal_per_g: 1.4 },
  ],
  containers: { items: [{ id: 'tupperware', label: 'Tupperware', emoji: '🍱', grams: 40 }] },
};
const DL_MEDIUM = 'dl:140';   // round(1.4 * 100)
const DL_LIGHT = 'dl:60';
const CT_TUPPERWARE = 'ct:40';

const silent = { info() {}, warn() {}, debug() {}, error() {} };

/** A scheduler we drive by hand — arms/clears counted so "re-armed" is distinguishable
 *  from "a timer nobody ever touched is still pending". */
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

/** Let queued microtasks AND both awaited use cases settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

/** Turn the loop until a condition holds. Used where a test has to reach INSIDE the
 *  commit's await chain (which is three awaits deep) rather than merely after it. */
const until = async (predicate, tries = 50) => {
  for (let i = 0; i < tries; i += 1) {
    if (predicate()) return;
    await flush();
  }
  throw new Error('until(): condition never held');
};

/** A NutriLog stand-in with the two methods `stampUnsettled` needs. */
function makeLog(items) {
  const log = {
    id: 'L1',
    items,
    updateItems(next) { return makeLog(next); },
  };
  return log;
}

let dir;

function makeWorld({ scaleConfig = { minGrams: 5 } } = {}) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'observation-service-'));
  const logs = [];
  const store = new YamlObservationStore({
    dataService: { user: { resolveDir: (rel, userId) => path.join(dir, userId, rel) } },
    logger: silent,
  });

  let clockMs = Date.UTC(2026, 8, 2, 18, 0, 0);
  const clock = () => new Date(clockMs);
  const tick = (ms) => { clockMs += ms; };

  const calls = [];
  const accept = { execute: vi.fn(async () => { calls.push('accept'); return { success: true }; }) };
  const selectDensity = {
    execute: vi.fn(async () => { calls.push('density'); return { success: true, calories: 578 }; }),
  };
  const retractScaleLog = { execute: vi.fn(async () => { calls.push('retract'); }) };
  const logFromScale = {
    execute: vi.fn(async (input) => {
      calls.push(input.existingLogUuid ? 'edit' : 'create');
      return input.existingLogUuid
        ? { success: true, logUuid: input.existingLogUuid, messageId: '9', edited: true }
        : { success: true, logUuid: 'L1', messageId: '9' };
    }),
  };

  const foodLogStore = {
    current: makeLog([{ id: 'i1', uuid: 'item-uuid-1', label: 'Medium', grams: 413, calories: 578 }]),
    saved: [],
    findByUuid: vi.fn(async () => foodLogStore.current),
    save: vi.fn(async (log) => { foodLogStore.saved.push(log); foodLogStore.current = log; }),
  };

  let handler = null;
  const scaleGateway = { subscribe: (fn) => { handler = fn; return () => { handler = null; }; } };
  const scheduler = manualScheduler();

  const build = (overrides = {}) => createObservationService({
    scaleGateway,
    observationStore: store,
    nutribotContainer: {
      getLogFoodFromScale: () => logFromScale,
      getAcceptFoodLog: () => accept,
      getSelectScaleDensity: () => selectDensity,
      getRetractScaleLog: () => retractScaleLog,
    },
    foodLogStore,
    userId: USER,
    conversationId: CONVO,
    scaleConfig,
    timezone: 'UTC',
    clock,
    scheduler,
    logger: { info: (e, d) => logs.push({ level: 'info', e, d }), warn: (e, d) => logs.push({ level: 'warn', e, d }), debug: (e, d) => logs.push({ level: 'debug', e, d }) },
    ...overrides,
  });

  const service = build();

  return {
    store, service, build, scheduler, clock, tick, logs, calls,
    accept, selectDensity, logFromScale, retractScaleLog, foodLogStore,
    publish: (p) => handler(p),
    emit: (grams, stable = true, unit = 'g') => handler({ id: SCALE, grams, stable, unit }),
    press: () => handler({ id: SCALE, event: 'button', press: 'short' }),
    rows: () => store.listByDate(USER, '2026-09-02'),
    open: () => store.openForScale(USER, SCALE),
    apply: new ApplyScanToComposition({ store: service, config: SCAN_CONFIG, logger: silent }),
    event: (name) => logs.filter((l) => l.e === name),
  };
}

beforeEach(() => { dir = null; });

// ===========================================================================
// 1. Placement and the single live prompt  (ported: ScaleNutribotBridge.test.mjs)
// ===========================================================================

describe('ObservationService — placement and the single live prompt', () => {
  it('learns the initial resting weight silently', async () => {
    const w = makeWorld();
    w.emit(480); await flush();
    expect(w.logFromScale.execute).not.toHaveBeenCalled();
  });

  it('posts one prompt on placement, then edits IN PLACE as the weight climbs', async () => {
    const w = makeWorld();
    w.emit(480); await flush();
    w.emit(680); await flush();
    w.emit(740); await flush();
    expect(w.calls).toEqual(['create', 'edit']);
  });

  it('dedups a held value below the dedup delta', async () => {
    const w = makeWorld();
    w.emit(480); await flush();
    w.emit(680); await flush();
    w.emit(682); await flush();
    expect(w.calls).toEqual(['create']);
  });

  it('starts a NEW prompt once the live one has been answered', async () => {
    const w = makeWorld();
    w.emit(480); await flush();
    w.emit(680); await flush();
    w.logFromScale.execute.mockImplementationOnce(async () => ({ success: true, touched: true, edited: false }));
    w.emit(760); await flush();
    expect(w.calls.filter((c) => c === 'create')).toHaveLength(2);
  });

  it('KEEPS an unanswered prompt when the pan empties, superseding it on the next placement', async () => {
    const w = makeWorld();
    w.emit(480); await flush();
    w.emit(680); await flush();
    w.emit(482); await flush();                       // session end — closed, NOT retracted
    expect(w.retractScaleLog.execute).not.toHaveBeenCalled();
    w.emit(690); await flush();                       // a new placement supersedes it
    expect(w.retractScaleLog.execute).toHaveBeenCalledTimes(1);
    expect(w.calls.filter((c) => c === 'create')).toHaveLength(2);
  });

  it('suppresses a value inside the storage band', async () => {
    const w = makeWorld({ scaleConfig: { minGrams: 5, storageWeightG: 430, storageToleranceG: 15 } });
    w.emit(0); await flush();
    w.emit(438); await flush();
    expect(w.calls).toEqual([]);
    expect(w.event('scaleNutribot.suppressed').map((l) => l.d.why)).toContain('storage-band');
  });

  it('does not let a suppressed placement repaint a closed prompt', async () => {
    const w = makeWorld({ scaleConfig: { minGrams: 5, storageWeightG: 430, storageToleranceG: 15 } });
    w.emit(0); await flush();
    w.emit(200); await flush();                       // real placement → prompt
    w.emit(2); await flush();                         // session end → prompt CLOSED, not retracted
    expect(w.calls).toEqual(['create']);
    w.emit(438); await flush();                       // putting the scale away
    expect(w.calls).toEqual(['create']);              // no edit, no second create
    expect(w.event('scaleNutribot.suppressed').map((l) => l.d.why)).toContain('storage-band');
  });

  it('a button force overrides a suppressed value', async () => {
    const w = makeWorld({ scaleConfig: { minGrams: 5, storageWeightG: 430, storageToleranceG: 15 } });
    w.emit(0); await flush();
    w.emit(438); await flush();                       // suppressed
    expect(w.calls).toEqual([]);
    w.press(); await flush();
    expect(w.calls).toEqual(['create']);
  });

  it('suppresses a heavy jump right after a storm of recent posts', async () => {
    const w = makeWorld({ scaleConfig: { minGrams: 5, stormMinPushes: 2, heavyG: 300 } });
    w.emit(0); await flush();
    w.tick(1000); w.emit(50); await flush();          // post #1
    w.tick(1000); w.emit(0); await flush();
    w.tick(1000); w.emit(60); await flush();          // post #2
    w.tick(1000); w.emit(0); await flush();
    w.tick(1000); w.emit(400); await flush();         // rise >= heavy, 2 posts in window
    expect(w.calls.filter((c) => c === 'create')).toHaveLength(2);
    expect(w.event('scaleNutribot.suppressed').map((l) => l.d.why)).toContain('jump-after-storm');
  });

  it('trusts a lone heavy placement with no recent storm', async () => {
    const w = makeWorld();
    w.emit(0); await flush();
    w.tick(1000); w.emit(400); await flush();
    expect(w.calls).toEqual(['create']);
    expect(w.event('scaleNutribot.suppressed')).toHaveLength(0);
  });

  it('a button no-ops when a live prompt already covers ~this weight', async () => {
    const w = makeWorld();
    w.emit(480); await flush();
    w.emit(680); await flush();
    w.press(); await flush();
    expect(w.calls.filter((c) => c === 'create')).toHaveLength(1);
  });

  it('a button captures the latest weight even from an unstable frame', async () => {
    const w = makeWorld();
    w.emit(480); await flush();
    w.emit(690, false); await flush();                // unstable → auto ignores
    expect(w.calls).toEqual([]);
    w.press(); await flush();
    expect(w.logFromScale.execute.mock.calls.at(-1)[0].grams).toBe(690);
  });

  it('a button does nothing with no weight on the scale', async () => {
    const w = makeWorld();
    w.press(); await flush();
    expect(w.calls).toEqual([]);
    expect(w.event('scaleNutribot.force.noWeight')).toHaveLength(1);
  });

  it('does not double-create on two synchronous placement frames', async () => {
    const w = makeWorld();
    w.emit(480); await flush();
    w.emit(680); w.emit(680); await flush();
    expect(w.calls.filter((c) => c === 'create')).toHaveLength(1);
  });
});

// ===========================================================================
// 2. The durable ledger  (ported: scaleNutribotBridgeComposition.test.mjs)
// ===========================================================================

describe('ObservationService — the durable ledger', () => {
  it('records a settled placement weight as an observation row against the scale id', async () => {
    const w = makeWorld();
    w.emit(480); await flush();
    w.emit(600); await flush();
    const rows = w.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'weight', value: 600, unit: 'g', scaleId: SCALE, status: 'open' });
  });

  it('follows the weight up, and the composition reports the LATEST weight', async () => {
    const w = makeWorld();
    w.emit(480); await flush();
    w.emit(600); await flush();
    w.emit(650); await flush();
    expect(w.rows().filter((r) => r.kind === 'weight').map((r) => r.value)).toEqual([600, 650]);
    expect(w.service.read(SCALE).grams).toBe(650);
  });

  it('does not record a weight for the resting baseline', async () => {
    const w = makeWorld();
    w.emit(480); await flush();
    w.emit(482); await flush();
    expect(w.rows()).toHaveLength(0);
  });

  it('ends the placement when the scale returns to its resting load', async () => {
    const w = makeWorld();
    w.emit(480); await flush();
    w.emit(600); await flush();
    w.emit(481); await flush();
    expect(w.open()).toHaveLength(0);
    expect(w.rows().map((r) => r.status)).toEqual(['dismissed']);
    expect(w.service.read(SCALE).active).toBe(false);
  });

  it('ends a placement that was never posted, so its scans cannot be inherited', async () => {
    const w = makeWorld();
    w.emit(480); await flush();
    w.apply.execute({ scaleId: SCALE, code: DL_MEDIUM });   // scan first
    expect(w.service.read(SCALE).density).toBe(4);
    w.emit(487); await flush();                             // rise above tolerance, below placementDelta
    w.emit(480); await flush();                             // crossing back
    expect(w.service.read(SCALE).active).toBe(false);
  });

  it('ends the placement once per crossing, not once per at-rest frame', async () => {
    const w = makeWorld();
    const spy = vi.spyOn(w.store, 'updateMany');
    w.emit(480); await flush();
    w.emit(600); await flush();
    w.emit(480); await flush();
    w.emit(480); await flush();      // firmware heartbeats on the shelf
    w.emit(481); await flush();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('passes the composition snapshot through on create and on edit', async () => {
    const w = makeWorld();
    w.emit(480); await flush();
    w.apply.execute({ scaleId: SCALE, code: CT_TUPPERWARE });
    w.emit(600); await flush();
    w.emit(650); await flush();
    w.emit(700); await flush();
    const [create, edit, edit2] = w.logFromScale.execute.mock.calls.map((c) => c[0]);
    expect(create.composition).toMatchObject({ container: 'tupperware', grams: null });
    // The composition is read BEFORE the new weight is recorded (the weight is only
    // buffered once the edit is known to have landed), so each render carries the state
    // as it stood when the frame arrived — exactly as the bridge's `bufferWeight`-after-
    // `editInPlace` ordering did.
    expect(edit.composition).toMatchObject({ container: 'tupperware', grams: 600 });
    expect(edit2.composition).toMatchObject({ container: 'tupperware', grams: 650 });
  });

  it('records the unit the scale actually reported, and threads it into the log use case', async () => {
    const w = makeWorld();
    w.emit(480, true, 'ml'); await flush();
    w.emit(600, true, 'ml'); await flush();
    expect(w.rows()[0]).toMatchObject({ kind: 'weight', unit: 'ml' });
    expect(w.logFromScale.execute.mock.calls[0][0].unit).toBe('ml');
  });

  it('falls back to grams only when the payload omits a unit', async () => {
    const w = makeWorld();
    w.publish({ id: SCALE, grams: 480, stable: true }); await flush();
    w.publish({ id: SCALE, grams: 600, stable: true }); await flush();
    expect(w.rows()[0].unit).toBe('g');
  });

  it('threads the unit through a force log that posts, and one that dedup-edits', async () => {
    const w = makeWorld();
    w.publish({ id: SCALE, grams: 300, stable: true, unit: 'ml' }); await flush();  // baseline only
    w.publish({ id: SCALE, grams: 300, stable: false, unit: 'ml', event: 'button' }); await flush();
    expect(w.logFromScale.execute.mock.calls.at(-1)[0].unit).toBe('ml');
    // Now a live prompt exists; a force within tolerance edits it, still in ml.
    w.publish({ id: SCALE, grams: 300, stable: false, unit: 'ml', event: 'button' }); await flush();
    expect(w.logFromScale.execute.mock.calls.at(-1)[0].unit).toBe('ml');
  });

  it('carries the original unit into a composition-triggered refresh', async () => {
    const w = makeWorld();
    w.emit(480, true, 'ml'); await flush();
    w.emit(600, true, 'ml'); await flush();
    await w.service.refreshPrompt(SCALE);
    expect(w.logFromScale.execute.mock.calls.at(-1)[0].unit).toBe('ml');
  });
});

// ===========================================================================
// 3. refreshPrompt  (ported: scaleNutribotBridgeComposition.test.mjs)
// ===========================================================================

describe('ObservationService.refreshPrompt', () => {
  it('returns false and does not throw when nothing is live', async () => {
    const w = makeWorld();
    await expect(w.service.refreshPrompt(SCALE)).resolves.toBe(false);
  });

  it('re-renders the live prompt in place with the current composition', async () => {
    const w = makeWorld();
    w.emit(480); await flush();
    w.emit(600); await flush();
    w.apply.execute({ scaleId: SCALE, code: DL_MEDIUM });
    await expect(w.service.refreshPrompt(SCALE)).resolves.toBe(true);
    expect(w.logFromScale.execute.mock.calls.at(-1)[0].composition.density).toBe(4);
  });

  it('returns false rather than throwing when the edit blows up', async () => {
    const w = makeWorld();
    w.emit(480); await flush();
    w.emit(600); await flush();
    w.logFromScale.execute.mockRejectedValueOnce(new Error('telegram 400'));
    await expect(w.service.refreshPrompt(SCALE)).resolves.toBe(false);
  });

  it('drops the refresh while the scale is inflight, and works again once it is not', async () => {
    const w = makeWorld();
    w.emit(480); await flush();
    w.emit(600); await flush();
    let release;
    w.logFromScale.execute.mockImplementationOnce(() => new Promise((r) => {
      release = () => r({ success: true, logUuid: 'L1', messageId: '9', edited: true });
    }));
    const inflight = (async () => { w.emit(700); })();
    await Promise.resolve();
    await expect(w.service.refreshPrompt(SCALE)).resolves.toBe(false);
    release();
    await inflight; await flush();
    await expect(w.service.refreshPrompt(SCALE)).resolves.toBe(true);
  });

  it('forwards a transient notice, and sends none when none is given', async () => {
    const w = makeWorld();
    w.emit(480); await flush();
    w.emit(600); await flush();
    await w.service.refreshPrompt(SCALE, 'unknown container "teapot"');
    expect(w.logFromScale.execute.mock.calls.at(-1)[0].notice).toBe('unknown container "teapot"');
    await w.service.refreshPrompt(SCALE);
    expect(w.logFromScale.execute.mock.calls.at(-1)[0].notice).toBeNull();
  });
});

// ===========================================================================
// 4. The control verbs, driven by the REAL ApplyScanToComposition
// ===========================================================================

describe('ObservationService — the fridge-sheet control verbs', () => {
  it('applies a density scan and a container scan to the live composition', async () => {
    const w = makeWorld();
    w.emit(480); await flush();
    w.emit(600); await flush();
    expect(w.apply.execute({ scaleId: SCALE, code: DL_MEDIUM })).toMatchObject({ handled: true, ok: true, kind: 'density', level: 4 });
    expect(w.apply.execute({ scaleId: SCALE, code: CT_TUPPERWARE })).toMatchObject({ handled: true, ok: true, kind: 'container', id: 'tupperware' });
    expect(w.service.read(SCALE)).toMatchObject({ grams: 600, density: 4, container: 'tupperware', complete: true });
  });

  it('rs:clear discards the in-progress composition', async () => {
    const w = makeWorld();
    w.emit(480); await flush();
    w.emit(600); await flush();
    w.apply.execute({ scaleId: SCALE, code: DL_MEDIUM });
    const res = w.apply.execute({ scaleId: SCALE, code: 'rs:clear' });
    expect(res).toMatchObject({ handled: true, ok: true, kind: 'reset', hadState: true });
    expect(w.service.read(SCALE).active).toBe(false);
    expect(w.rows().every((r) => r.status === 'dismissed')).toBe(true);
  });

  it('rs:clear on an empty scale reports nothing to clear, and is not a refusal', () => {
    const w = makeWorld();
    expect(w.apply.execute({ scaleId: SCALE, code: 'rs:clear' })).toMatchObject({ ok: true, hadState: false });
  });

  it('rs:undo takes back the most recent scan, restoring the value it overwrote', async () => {
    const w = makeWorld();
    w.emit(480); await flush();
    w.emit(600); await flush();
    w.apply.execute({ scaleId: SCALE, code: DL_LIGHT });     // level 2
    w.tick(1000);
    w.apply.execute({ scaleId: SCALE, code: DL_MEDIUM });    // level 4 overwrites
    expect(w.service.read(SCALE).density).toBe(4);
    expect(w.apply.execute({ scaleId: SCALE, code: 'rs:undo' })).toMatchObject({ ok: true, undone: true });
    expect(w.service.read(SCALE).density).toBe(2);
  });

  it('rs:undo is ONE DEEP — a second consecutive undo is a no-op', async () => {
    const w = makeWorld();
    w.emit(480); await flush();
    w.emit(600); await flush();
    w.apply.execute({ scaleId: SCALE, code: DL_LIGHT });
    w.tick(1000);
    w.apply.execute({ scaleId: SCALE, code: DL_MEDIUM });
    expect(w.apply.execute({ scaleId: SCALE, code: 'rs:undo' })).toMatchObject({ undone: true });
    expect(w.apply.execute({ scaleId: SCALE, code: 'rs:undo' })).toMatchObject({ ok: true, undone: false });
    expect(w.service.read(SCALE).density).toBe(2);
  });

  it('rs:undo has nothing to take back after rs:clear', async () => {
    const w = makeWorld();
    w.emit(480); await flush();
    w.emit(600); await flush();
    w.apply.execute({ scaleId: SCALE, code: DL_MEDIUM });
    w.apply.execute({ scaleId: SCALE, code: 'rs:clear' });
    expect(w.apply.execute({ scaleId: SCALE, code: 'rs:undo' })).toMatchObject({ undone: false });
  });

  it('rs:done reads the snapshot BEFORE consuming the slots, and hands it back', async () => {
    const w = makeWorld();
    w.emit(480); await flush();
    w.emit(600); await flush();
    w.apply.execute({ scaleId: SCALE, code: DL_MEDIUM });
    const res = w.apply.execute({ scaleId: SCALE, code: 'rs:done' });
    expect(res).toMatchObject({ handled: true, ok: true, kind: 'done', hadState: true });
    expect(res.snapshot).toMatchObject({ grams: 600, density: 4, complete: true });
    expect(res.snapshot.observationIds).toHaveLength(2);
    expect(w.service.read(SCALE).active).toBe(false);
  });
});

// ===========================================================================
// 5. Quiet commit
// ===========================================================================

describe('ObservationService — quiet commit', () => {
  const primed = async () => {
    const w = makeWorld();
    w.emit(480); await flush();
    w.emit(600); await flush();
    w.apply.execute({ scaleId: SCALE, code: DL_MEDIUM });
    w.service.armCommitFor(SCALE);
    return w;
  };

  it('commits a complete composition ONCE — not twice — after the lull', async () => {
    const w = await primed();
    expect(w.scheduler.pending.ms).toBe(25_000);
    w.scheduler.fire(); await flush();
    expect(w.accept.execute).toHaveBeenCalledTimes(1);
    expect(w.scheduler.pending).toBeNull();
    // Nothing re-arms on its own, so there is no second commit to make.
    expect(w.accept.execute).toHaveBeenCalledTimes(1);
  });

  it('does not commit while the composition is incomplete', async () => {
    const w = makeWorld();
    w.emit(480); await flush();
    w.emit(600); await flush();                 // weight only, no density
    w.scheduler.fire(); await flush();
    expect(w.accept.execute).not.toHaveBeenCalled();
    expect(w.event('scaleNutribot.commit.skipped').map((l) => l.d.reason)).toContain('incomplete');
  });

  it('restarts the interval when another weight arrives, and from a scan via armCommitFor', async () => {
    const w = makeWorld();
    w.emit(480); await flush();
    w.emit(600); await flush();
    const afterPost = w.scheduler.counts.arms;
    w.emit(700); await flush();
    expect(w.scheduler.counts.arms).toBe(afterPost + 1);
    w.apply.execute({ scaleId: SCALE, code: DL_MEDIUM });
    w.service.armCommitFor(SCALE);
    expect(w.scheduler.counts.arms).toBe(afterPost + 2);
    expect(w.scheduler.counts.clears).toBeGreaterThanOrEqual(2);
  });

  it('does not restart the interval from a repeated or unsettled frame', async () => {
    const w = makeWorld();
    w.emit(480); await flush();
    w.emit(600); await flush();
    const arms = w.scheduler.counts.arms;
    w.emit(602); await flush();                 // inside dedupDelta
    w.emit(900, false); await flush();          // unstable
    expect(w.scheduler.counts.arms).toBe(arms);
  });

  it('disarms the timer when the placement ends, and on dispose', async () => {
    const w = makeWorld();
    w.emit(480); await flush();
    w.emit(600); await flush();
    w.emit(481); await flush();
    expect(w.scheduler.pending).toBeNull();

    const w2 = makeWorld();
    w2.emit(480); await flush();
    w2.emit(600); await flush();
    w2.service.dispose();
    expect(w2.scheduler.pending).toBeNull();
  });

  it('applies the density BEFORE accepting, so the entry never reaches history without calories', async () => {
    const w = await primed();
    w.scheduler.fire(); await flush();
    expect(w.calls.filter((c) => c === 'density' || c === 'accept')).toEqual(['density', 'accept']);
  });

  it('does not accept when the density cannot be applied, and keeps the prompt live', async () => {
    const w = await primed();
    w.selectDensity.execute.mockResolvedValueOnce({ success: false, error: 'unknown level' });
    w.scheduler.fire(); await flush();
    expect(w.accept.execute).not.toHaveBeenCalled();
    expect(w.event('scaleNutribot.commit.skipped').map((l) => l.d.reason)).toContain('density-failed');
    // The prompt is claimable again: the next lull retries.
    w.scheduler.fire?.();
    await w.service.commitNowFor(SCALE); await flush();
    expect(w.accept.execute).toHaveBeenCalledTimes(1);
  });

  it('accepts a prompt only once, even if the clock comes round mid-accept', async () => {
    const w = await primed();
    let release;
    w.accept.execute.mockImplementationOnce(() => new Promise((r) => { release = () => r({ success: true }); }));
    w.scheduler.fire();
    await until(() => typeof release === 'function');
    const second = w.service.commitNowFor(SCALE);
    release(); await second; await flush();
    expect(w.accept.execute).toHaveBeenCalledTimes(1);
  });

  it('gives the prompt back when the accept fails, so the next lull retries', async () => {
    const w = await primed();
    w.accept.execute.mockRejectedValueOnce(new Error('telegram down'));
    w.scheduler.fire(); await flush();
    expect(w.open().length).toBeGreaterThan(0);          // observations NOT consumed
    await w.service.commitNowFor(SCALE); await flush();
    expect(w.accept.execute).toHaveBeenCalledTimes(2);
  });

  it('consumes the observations INTO the entry on success, recording the pairing', async () => {
    const w = await primed();
    w.scheduler.fire(); await flush();
    const rows = w.rows();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'consumed')).toBe(true);
    expect(rows.every((r) => r.pairedEntryUuid === 'item-uuid-1')).toBe(true);
    expect(w.open()).toHaveLength(0);
  });

  it('leaves the observations open when the commit is refused', async () => {
    const w = await primed();
    w.selectDensity.execute.mockResolvedValueOnce({ success: false, error: 'unknown level' });
    w.scheduler.fire(); await flush();
    expect(w.rows().every((r) => r.status === 'open')).toBe(true);
  });

  it('stamps every item settled:false through the Phase-1 seam before accepting', async () => {
    const w = await primed();
    w.scheduler.fire(); await flush();
    const stampedSave = w.foodLogStore.saved.at(-1);
    expect(stampedSave.items[0].settled).toBe(false);
    expect(w.foodLogStore.save).toHaveBeenCalled();
  });

  it('re-syncs the persisted weight against the committed snapshot before applying the density', async () => {
    const w = await primed();
    w.scheduler.fire(); await flush();
    const resync = w.logFromScale.execute.mock.calls.at(-1)[0];
    expect(resync.existingLogUuid).toBe('L1');
    expect(resync.composition).toMatchObject({ grams: 600, density: 4 });
  });

  it('stands down when the human has already answered the prompt', async () => {
    const w = await primed();
    w.logFromScale.execute.mockResolvedValueOnce({ success: true, logUuid: 'L1', edited: false, touched: true });
    w.scheduler.fire(); await flush();
    expect(w.accept.execute).not.toHaveBeenCalled();
    expect(w.event('scaleNutribot.commit.skipped').map((l) => l.d.reason)).toContain('answered-by-human');
  });

  it('rs:done short-circuits the wait and commits immediately', async () => {
    const w = makeWorld();
    w.emit(480); await flush();
    w.emit(600); await flush();
    w.apply.execute({ scaleId: SCALE, code: DL_MEDIUM });
    const outcome = w.apply.execute({ scaleId: SCALE, code: 'rs:done' });
    await w.service.commitNowFor(SCALE, outcome.snapshot); await flush();
    expect(w.accept.execute).toHaveBeenCalledTimes(1);
    expect(w.scheduler.pending).toBeNull();             // the lull was superseded, not raced
    expect(w.rows().every((r) => r.status === 'consumed')).toBe(true);
  });
});

// ===========================================================================
// 6. The non-gram refusal
// ===========================================================================

describe('ObservationService — non-gram refusal', () => {
  it('does not commit a millilitre reading, however complete it looks', async () => {
    const w = makeWorld();
    w.emit(480, true, 'ml'); await flush();
    w.emit(600, true, 'ml'); await flush();
    w.apply.execute({ scaleId: SCALE, code: DL_MEDIUM });
    w.service.armCommitFor(SCALE);
    expect(w.service.read(SCALE)).toMatchObject({ unit: 'ml', complete: true });
    w.scheduler.fire(); await flush();
    expect(w.accept.execute).not.toHaveBeenCalled();
    const skipped = w.event('scaleNutribot.commit.skipped');
    expect(skipped.map((l) => l.d.reason)).toContain('non-gram-unit');
    expect(w.event('observation.commit.refused').map((l) => l.d.reason)).toContain('non-gram-unit');
  });
});

// ===========================================================================
// 7. Re-prompt dedup
// ===========================================================================

describe('ObservationService — re-prompt dedup', () => {
  const committed = async () => {
    const w = makeWorld();
    w.emit(480); await flush();
    w.emit(600); await flush();
    w.apply.execute({ scaleId: SCALE, code: DL_MEDIUM });
    w.service.armCommitFor(SCALE);
    w.scheduler.fire(); await flush();
    return w;
  };

  it('does not re-prompt when the committed food is still sitting on the pan', async () => {
    const w = await committed();
    const created = w.calls.filter((c) => c === 'create').length;
    w.emit(601); await flush();
    expect(w.calls.filter((c) => c === 'create').length).toBe(created);
    expect(w.event('observation.prompt.deduped').map((l) => l.d.reason)).toContain('already-committed');
  });

  it('still prompts when the weight changes after a commit', async () => {
    const w = await committed();
    const created = w.calls.filter((c) => c === 'create').length;
    w.emit(800); await flush();
    expect(w.calls.filter((c) => c === 'create').length).toBe(created + 1);
  });

  it('prompts again for the same weight once the pan has been cleared', async () => {
    const w = await committed();
    const created = w.calls.filter((c) => c === 'create').length;
    w.emit(480); await flush();                 // pan cleared → marker released
    w.emit(600); await flush();
    expect(w.calls.filter((c) => c === 'create').length).toBe(created + 1);
  });

  it('does not let the next food on the pan inherit the committed density and tare', async () => {
    const w = await committed();
    w.emit(480); await flush();                 // pan cleared
    w.emit(800); await flush();                 // new food, no scans
    const create = w.logFromScale.execute.mock.calls.at(-1)[0];
    expect(create.composition.density).toBeNull();
    expect(create.composition.container).toBeNull();
  });
});

// ===========================================================================
// 7b. Ledger failures are best-effort — they never break the prompt
// ===========================================================================

describe('ObservationService — a failing ledger never breaks the prompt', () => {
  it('still posts the prompt when the append fails', async () => {
    const w = makeWorld();
    vi.spyOn(w.store, 'append').mockImplementation(() => { throw new Error('disk full'); });
    w.emit(480); await flush();
    w.emit(600); await flush();
    expect(w.calls).toEqual(['create']);
    expect(w.event('observation.append.failed')).toHaveLength(1);
  });

  it('renders an empty composition, and refuses to commit, when the file is corrupt', async () => {
    const w = makeWorld();
    w.emit(480); await flush();
    w.emit(600); await flush();
    const err = new Error('corrupt'); err.code = 'CORRUPT_OBSERVATIONS_FILE';
    vi.spyOn(w.store, 'openForScale').mockImplementation(() => { throw err; });
    // A corrupt file must NOT read as a clean day that happens to be complete.
    expect(w.service.read(SCALE).active).toBe(false);
    await w.service.commitNowFor(SCALE); await flush();
    expect(w.accept.execute).not.toHaveBeenCalled();
    expect(w.event('observation.read.failed').map((l) => l.d.code)).toContain('CORRUPT_OBSERVATIONS_FILE');
  });
});

// ===========================================================================
// 8. RESTART DURABILITY — the point of the whole phase
// ===========================================================================

describe('ObservationService — durability across a restart', () => {
  it('a FRESH service over the same store recovers the in-progress composition', async () => {
    const w = makeWorld();
    w.emit(480); await flush();
    w.emit(600); await flush();
    w.apply.execute({ scaleId: SCALE, code: DL_MEDIUM });
    w.apply.execute({ scaleId: SCALE, code: CT_TUPPERWARE });
    expect(w.service.read(SCALE)).toMatchObject({ grams: 600, density: 4, container: 'tupperware', complete: true });

    // The process dies. Everything the old bridge held — the Map, the window, the slots —
    // went with it; what survives is on disk.
    w.service.dispose();
    const restarted = w.build();

    expect(restarted.read(SCALE)).toMatchObject({
      grams: 600, unit: 'g', density: 4, container: 'tupperware', complete: true, active: true,
    });
    expect(restarted.read(SCALE).observationIds).toHaveLength(3);
  });

  it('the recovered composition is still committable, and consumes the SAME rows', async () => {
    const w = makeWorld();
    w.emit(480); await flush();
    w.emit(600); await flush();
    w.apply.execute({ scaleId: SCALE, code: DL_MEDIUM });
    w.service.dispose();

    const restarted = w.build();
    // A restart has no live prompt, so the placement re-posts and the recovered density is
    // already there when it does — the exact case the old bridge lost ("Backend restart
    // loses the buffer ... food already on the scale never posts").
    w.emit(480); await flush();
    w.emit(600); await flush();
    expect(restarted.read(SCALE).density).toBe(4);
    restarted.armCommitFor(SCALE);
    w.scheduler.fire(); await flush();
    expect(w.accept.execute).toHaveBeenCalledTimes(1);
    expect(w.rows().every((r) => r.status === 'consumed')).toBe(true);
  });

  it('an observation older than the window drops out of the composition on its own', async () => {
    const w = makeWorld();
    w.emit(480); await flush();
    w.emit(600); await flush();
    w.tick(901_000);                            // past the 900 s match window
    expect(w.service.read(SCALE).active).toBe(false);
    expect(w.open()).toHaveLength(1);           // the row is still there, just not live
  });
});

// ===========================================================================
// 9. The 12:31 incident — every arrival order converges
// ===========================================================================

describe('ObservationService — arrival order', () => {
  it('converges on the same complete composition however the three signals are ordered', async () => {
    const orders = [
      ['w', 'd', 'c'], ['w', 'c', 'd'], ['d', 'w', 'c'],
      ['d', 'c', 'w'], ['c', 'w', 'd'], ['c', 'd', 'w'],
    ];
    for (const order of orders) {
      const w = makeWorld();
      w.emit(480); await flush();
      for (const step of order) {
        if (step === 'w') { w.emit(600); await flush(); }
        if (step === 'd') w.apply.execute({ scaleId: SCALE, code: DL_MEDIUM });
        if (step === 'c') w.apply.execute({ scaleId: SCALE, code: CT_TUPPERWARE });
        w.tick(1000);
      }
      expect(w.service.read(SCALE)).toMatchObject({
        grams: 600, density: 4, container: 'tupperware', complete: true,
      });
    }
  });

  it('is still waiting when the container scan arrives 4.4 s behind the density', async () => {
    const w = makeWorld();
    w.emit(480); await flush();
    w.emit(600); await flush();
    w.apply.execute({ scaleId: SCALE, code: DL_MEDIUM });
    w.service.armCommitFor(SCALE);
    w.tick(4400);
    w.apply.execute({ scaleId: SCALE, code: CT_TUPPERWARE });
    w.service.armCommitFor(SCALE);
    expect(w.accept.execute).not.toHaveBeenCalled();     // the lull has not elapsed
    w.scheduler.fire(); await flush();
    const committed = w.event('observation.commit.committed')[0];
    expect(committed.d).toMatchObject({ grams: 600, density: 4, container: 'tupperware' });
  });
});
