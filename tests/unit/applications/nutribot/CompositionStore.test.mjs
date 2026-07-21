import { describe, it, expect, beforeEach } from 'vitest';
import { CompositionStore } from '#apps/nutribot/CompositionStore.mjs';
import { MAX_DENSITY_LEVEL } from '#domains/nutrition/index.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

describe('CompositionStore', () => {
  let clock, store;
  beforeEach(() => {
    clock = 1_000_000;
    store = new CompositionStore({ windowMs: 900_000, now: () => clock });
  });

  const permutations = [
    ['weight', 'density', 'container'],
    ['weight', 'container', 'density'],
    ['density', 'weight', 'container'],
    ['density', 'container', 'weight'],
    ['container', 'weight', 'density'],
    ['container', 'density', 'weight'],
  ];

  const apply = (id, step) => {
    if (step === 'weight')    store.setWeight(id, { grams: 500, unit: 'g' });
    if (step === 'density')   store.setDensity(id, 4);
    if (step === 'container') store.setContainer(id, 'dinner-bowl');
  };

  it.each(permutations)('converges identically: %s -> %s -> %s', (a, b, c) => {
    [a, b, c].forEach((step) => apply('scale-1', step));
    expect(store.read('scale-1')).toMatchObject({
      grams: 500, unit: 'g', density: 4, container: 'dinner-bowl', complete: true,
    });
  });

  it('is not complete without a weight', () => {
    store.setDensity('scale-1', 4);
    store.setContainer('scale-1', 'dinner-bowl');
    expect(store.read('scale-1').grams).toBeNull();
    expect(store.read('scale-1').complete).toBe(false);
  });

  it('is complete on weight + density with no container', () => {
    store.setWeight('scale-1', { grams: 500, unit: 'g' });
    store.setDensity('scale-1', 4);
    expect(store.read('scale-1').complete).toBe(true);
  });

  // THE regression case: two foods in one window.
  it('does not leak slots from one placement to the next', () => {
    store.setWeight('scale-1', { grams: 300, unit: 'g' });
    store.setDensity('scale-1', 2);
    store.setContainer('scale-1', 'small-bowl');
    store.endPlacement('scale-1');                     // pan returned to baseline

    clock += 6 * 60_000;                                // six minutes later
    store.setWeight('scale-1', { grams: 700, unit: 'g' });
    const s = store.read('scale-1');
    expect(s.density).toBeNull();
    expect(s.container).toBeNull();
    expect(s.complete).toBe(false);
  });

  it('scans refresh the window', () => {
    store.setDensity('scale-1', 4);
    clock += 800_000;
    store.setContainer('scale-1', 'mug');   // refresh
    clock += 800_000;                       // 1.6M total, but only 800k since refresh
    expect(store.read('scale-1').density).toBe(4);
  });

  it('expires after the window with no activity', () => {
    store.setDensity('scale-1', 4);
    clock += 900_001;
    expect(store.read('scale-1').density).toBeNull();
  });

  it('clear() empties every slot', () => {
    store.setWeight('scale-1', { grams: 500, unit: 'g' });
    store.setDensity('scale-1', 4);
    store.clear('scale-1');
    expect(store.read('scale-1')).toMatchObject({ grams: null, density: null, container: null });
  });

  it('keeps scales independent', () => {
    store.setDensity('scale-1', 4);
    store.setDensity('scale-2', 9);
    expect(store.read('scale-1').density).toBe(4);
    expect(store.read('scale-2').density).toBe(9);
  });

  it('keeps a weight on one scale from reaching another', () => {
    // The full independence claim, not just the density slot: two scales in the
    // kitchen are two separate placements.
    store.setWeight('scale-1', { grams: 300, unit: 'g' });
    store.setContainer('scale-1', 'small-bowl');
    store.setWeight('scale-2', { grams: 700, unit: 'ml' });
    expect(store.read('scale-1')).toMatchObject({ grams: 300, unit: 'g', container: 'small-bowl' });
    expect(store.read('scale-2')).toMatchObject({ grams: 700, unit: 'ml', container: null });
  });

  it('expires one scale without expiring another', () => {
    store.setDensity('scale-1', 4);
    clock += 800_000;
    store.setDensity('scale-2', 9);   // scale-2's window starts later
    clock += 200_000;                 // 1_000_000 for scale-1, 200_000 for scale-2
    expect(store.read('scale-1').active).toBe(false);
    expect(store.read('scale-2').density).toBe(9);
  });

  it('carries the unit through instead of assuming grams', () => {
    store.setWeight('scale-1', { grams: 250, unit: 'ml' });
    expect(store.read('scale-1').unit).toBe('ml');
  });

  // ---------------------------------------------------------------------------
  // Window arithmetic
  // ---------------------------------------------------------------------------

  describe('window', () => {
    it('is still live at exactly windowMs', () => {
      store.setDensity('scale-1', 4);
      clock += 900_000;
      expect(store.read('scale-1').density).toBe(4);
    });

    it('expires one millisecond past windowMs', () => {
      // Pins the comparison as strictly-greater from the other side: with `>=`
      // the exact-boundary case above dies, with `>` this one holds.
      store.setDensity('scale-1', 4);
      clock += 900_001;
      expect(store.read('scale-1').active).toBe(false);
    });

    it('does not let reads refresh the window', () => {
      // The refresh set is {setWeight, setDensity, setContainer}. A read is none
      // of them. The scale firmware heartbeats at 0.5 Hz while it rests on its
      // shelf, so if read() refreshed, the store would never expire.
      store.setDensity('scale-1', 4);
      clock += 800_000;
      expect(store.read('scale-1').density).toBe(4);   // read, does NOT refresh
      clock += 200_000;                                // 1_000_000 since the scan
      expect(store.read('scale-1').density).toBeNull();
    });

    it('does not let repeated reads keep an entry alive indefinitely', () => {
      // The heartbeat shape explicitly: poll every 100 s across the whole window.
      store.setDensity('scale-1', 4);
      for (let elapsed = 0; elapsed <= 900_000; elapsed += 100_000) {
        store.read('scale-1');
        clock += 100_000;
      }
      expect(store.read('scale-1').active).toBe(false);
    });

    it('drops a stale slot rather than merging it with a new one', () => {
      store.setDensity('scale-1', 4);
      store.setContainer('scale-1', 'small-bowl');
      clock += 900_001;
      store.setWeight('scale-1', { grams: 700, unit: 'g' });
      expect(store.read('scale-1')).toMatchObject({
        grams: 700, density: null, container: null, complete: false,
      });
    });

    it('rejects a non-positive windowMs at construction', () => {
      expect(() => new CompositionStore({ windowMs: 0, now: () => clock }))
        .toThrow(ValidationError);
      expect(() => new CompositionStore({ windowMs: -1, now: () => clock }))
        .toThrow(ValidationError);
      expect(() => new CompositionStore({ windowMs: NaN, now: () => clock }))
        .toThrow(ValidationError);
    });

    it('rejects a non-function now at construction', () => {
      expect(() => new CompositionStore({ now: 12345 })).toThrow(ValidationError);
    });
  });

  // ---------------------------------------------------------------------------
  // Input contract: the store never reimplements Composition's validation, it
  // lets the value object throw. These assert the store surfaces that refusal
  // rather than swallowing or pre-empting it — everything buffered here flows
  // into ScanNutritionService, which refuses non-finite and stringified numbers.
  // ---------------------------------------------------------------------------

  describe('input contract', () => {
    it('refuses a non-finite weight instead of storing NaN', () => {
      expect(() => store.setWeight('scale-1', { grams: NaN, unit: 'g' })).toThrow(ValidationError);
      expect(() => store.setWeight('scale-1', { grams: Infinity, unit: 'g' })).toThrow(ValidationError);
    });

    it('refuses a stringified weight', () => {
      // ScanNutritionService refuses '500'; accepting it here would mean the
      // store reports complete: true on something that throws downstream.
      expect(() => store.setWeight('scale-1', { grams: '500', unit: 'g' })).toThrow(ValidationError);
    });

    it('refuses a missing weight rather than coercing it to 0', () => {
      expect(() => store.setWeight('scale-1', { unit: 'g' })).toThrow(ValidationError);
      expect(() => store.setWeight('scale-1', { grams: null, unit: 'g' })).toThrow(ValidationError);
    });

    it('throws a ValidationError, not a TypeError, on a missing payload', () => {
      expect(() => store.setWeight('scale-1')).toThrow(ValidationError);
      expect(() => store.setWeight('scale-1', null)).toThrow(ValidationError);
    });

    it('leaves the store untouched when a setter rejects', () => {
      store.setDensity('scale-1', 4);
      expect(() => store.setWeight('scale-1', { grams: NaN, unit: 'g' })).toThrow(ValidationError);
      // The rejected weight must not have half-filled a slot, and must not have
      // refreshed the window on the caller's behalf.
      expect(store.read('scale-1')).toMatchObject({ grams: null, density: 4, complete: false });
    });

    const rejectedCalls = [
      ['setWeight',    (s) => s.setWeight('scale-1', { grams: 'oops', unit: 'g' })],
      ['setDensity',   (s) => s.setDensity('scale-1', 99)],
      ['setContainer', (s) => s.setContainer('scale-1', '')],
    ];

    it.each(rejectedCalls)('does not create a slot for a rejected %s', (_name, call) => {
      expect(() => call(store)).toThrow(ValidationError);
      expect(store.read('scale-1').active).toBe(false);
    });

    it.each(rejectedCalls)('does not refresh the window from a rejected %s', (_name, call) => {
      // A call that did not happen must not extend the window. If a rejected
      // setter touched the entry first, a stream of bad scans would keep a stale
      // store alive indefinitely.
      store.setDensity('scale-1', 4);
      clock += 800_000;
      expect(() => call(store)).toThrow(ValidationError);
      clock += 200_000;                     // 1_000_000 since the only real scan
      expect(store.read('scale-1').active).toBe(false);
    });

    it.each(rejectedCalls)('leaves an existing entry byte-for-byte intact after a rejected %s', (_name, call) => {
      // Stronger than "no window refresh": the surviving slots must be the ones
      // that were already there, with nothing partially applied over them.
      store.setWeight('scale-1', { grams: 300, unit: 'ml' });
      store.setDensity('scale-1', 4);
      store.setContainer('scale-1', 'mug');
      const before = store.read('scale-1');
      expect(() => call(store)).toThrow(ValidationError);
      expect(store.read('scale-1')).toEqual(before);
    });

    it('keeps a negative weight, which is a real scale reading', () => {
      // computeNet clamps and flags negatives rather than throwing; the store
      // must not pre-empt that decision.
      store.setWeight('scale-1', { grams: -12, unit: 'g' });
      expect(store.read('scale-1').grams).toBe(-12);
    });

    it('does not round the weight it was handed', () => {
      store.setWeight('scale-1', { grams: 500.5, unit: 'g' });
      expect(store.read('scale-1').grams).toBe(500.5);
    });

    it('defaults an absent unit to grams', () => {
      store.setWeight('scale-1', { grams: 500 });
      expect(store.read('scale-1').unit).toBe('g');
    });

    it('refuses a unit that is present but unusable', () => {
      expect(() => store.setWeight('scale-1', { grams: 500, unit: '' })).toThrow(ValidationError);
      expect(() => store.setWeight('scale-1', { grams: 500, unit: 7 })).toThrow(ValidationError);
    });

    it('refuses a density level outside the printed grammar', () => {
      expect(() => store.setDensity('scale-1', 0)).toThrow(ValidationError);
      expect(() => store.setDensity('scale-1', MAX_DENSITY_LEVEL + 1)).toThrow(ValidationError);
      expect(() => store.setDensity('scale-1', 2.5)).toThrow(ValidationError);
      expect(() => store.setDensity('scale-1', '4')).toThrow(ValidationError);
      expect(() => store.setDensity('scale-1', NaN)).toThrow(ValidationError);
    });

    it('accepts every level the grammar can print', () => {
      for (let level = 1; level <= MAX_DENSITY_LEVEL; level += 1) {
        store.setDensity('scale-1', level);
        expect(store.read('scale-1').density).toBe(level);
      }
    });

    it('refuses an unusable container id', () => {
      expect(() => store.setContainer('scale-1', '')).toThrow(ValidationError);
      expect(() => store.setContainer('scale-1', null)).toThrow(ValidationError);
      expect(() => store.setContainer('scale-1', 42)).toThrow(ValidationError);
    });

    it('refuses an unusable scale id', () => {
      expect(() => store.setDensity('', 4)).toThrow(ValidationError);
      expect(() => store.setDensity(null, 4)).toThrow(ValidationError);
      expect(() => store.read(null)).toThrow(ValidationError);
    });

    it('refuses an unusable scale id at every lifecycle method', () => {
      // endPlacement and clear delete state; a falsy id must not reach the Map.
      expect(() => store.setWeight('', { grams: 500 })).toThrow(ValidationError);
      expect(() => store.setContainer('', 'mug')).toThrow(ValidationError);
      expect(() => store.endPlacement('')).toThrow(ValidationError);
      expect(() => store.clear(null)).toThrow(ValidationError);
    });
  });

  // ---------------------------------------------------------------------------
  // Slot lifecycle (D10)
  // ---------------------------------------------------------------------------

  describe('slot lifecycle', () => {
    it('last scan of a kind wins', () => {
      store.setDensity('scale-1', 2);
      store.setDensity('scale-1', 7);
      store.setContainer('scale-1', 'mug');
      store.setContainer('scale-1', 'dinner-bowl');
      expect(store.read('scale-1')).toMatchObject({ density: 7, container: 'dinner-bowl' });
    });

    it('revises the weight in place while a placement is live', () => {
      store.setDensity('scale-1', 4);
      store.setWeight('scale-1', { grams: 300, unit: 'g' });
      store.setWeight('scale-1', { grams: 320, unit: 'g' });
      expect(store.read('scale-1')).toMatchObject({ grams: 320, density: 4, complete: true });
    });

    it('consumes scans even when no weight was ever recorded', () => {
      // The bridge ends sessions that never yield a weight: the min_grams floor
      // guard, and the suspicion filter that suppresses a storage-band placement
      // or a heavy jump after a post storm. Surviving those would hand the next
      // real weight a density and tare belonging to no food on the scale.
      store.setDensity('scale-1', 4);
      store.setContainer('scale-1', 'mug');
      store.endPlacement('scale-1');
      expect(store.read('scale-1')).toMatchObject({ density: null, container: null });
    });

    it('consumes a container-only buffer at placement end', () => {
      // The weight-gate mutant survives if only the density path is checked:
      // a lone tare scan is just as capable of leaking into the next weight.
      store.setContainer('scale-1', 'small-bowl');
      expect(store.endPlacement('scale-1')).toBe(true);
      expect(store.read('scale-1')).toMatchObject({ container: null, active: false });
    });

    it('does not let a suppressed placement leak scans into the next weight', () => {
      // Full walk of the configured leak path, end to end.
      store.setDensity('scale-1', 2);
      store.setContainer('scale-1', 'small-bowl');
      store.endPlacement('scale-1');            // suppressed placement: no weight posted

      clock += 60_000;
      store.setWeight('scale-1', { grams: 700, unit: 'g' });
      expect(store.read('scale-1')).toMatchObject({
        grams: 700, density: null, container: null, complete: false,
      });
    });

    it('reports whether it had anything to consume', () => {
      expect(store.endPlacement('scale-1')).toBe(false);   // nothing buffered at all
      store.setDensity('scale-1', 4);
      expect(store.endPlacement('scale-1')).toBe(true);    // weightless scans still count
      store.setWeight('scale-1', { grams: 300, unit: 'g' });
      expect(store.endPlacement('scale-1')).toBe(true);
    });

    it('treats an expired slot as nothing to consume', () => {
      // Matches clear(): an already-expired buffer was not consumed by this
      // placement, and must not report as though it were.
      store.setDensity('scale-1', 4);
      clock += 900_001;
      expect(store.endPlacement('scale-1')).toBe(false);
    });

    it('is idempotent on repeated placement ends', () => {
      store.setWeight('scale-1', { grams: 300, unit: 'g' });
      store.setDensity('scale-1', 4);
      expect(store.endPlacement('scale-1')).toBe(true);
      expect(store.endPlacement('scale-1')).toBe(false);
      expect(store.read('scale-1')).toMatchObject({ grams: null, density: null });
    });

    it('ends a placement on one scale without touching another', () => {
      store.setWeight('scale-1', { grams: 300, unit: 'g' });
      store.setDensity('scale-1', 2);
      store.setDensity('scale-2', 9);
      store.endPlacement('scale-1');
      expect(store.read('scale-1').density).toBeNull();
      expect(store.read('scale-2').density).toBe(9);
    });

    it('clears one scale without touching another', () => {
      store.setDensity('scale-1', 2);
      store.setDensity('scale-2', 9);
      expect(store.clear('scale-1')).toBe(true);
      expect(store.read('scale-1').active).toBe(false);
      expect(store.read('scale-2').density).toBe(9);
    });

    it('reports whether clear() had anything to clear', () => {
      // Drives the "nothing to clear" ack on a bare rs:clear scan.
      expect(store.clear('scale-1')).toBe(false);
      store.setDensity('scale-1', 4);
      expect(store.clear('scale-1')).toBe(true);
      expect(store.clear('scale-1')).toBe(false);
    });

    it('clears scans even when no weight was ever recorded', () => {
      // The asymmetry with endPlacement: rs:clear is an explicit human "forget
      // it", so unlike a session-end it wipes a weightless buffer too.
      store.setDensity('scale-1', 4);
      store.setContainer('scale-1', 'mug');
      expect(store.clear('scale-1')).toBe(true);
      expect(store.read('scale-1')).toMatchObject({ density: null, container: null });
    });

    it('treats an expired slot as nothing to clear', () => {
      store.setDensity('scale-1', 4);
      clock += 900_001;
      expect(store.clear('scale-1')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // read() shape
  // ---------------------------------------------------------------------------

  describe('read', () => {
    it('distinguishes an absent buffer from a live one', () => {
      expect(store.read('scale-1').active).toBe(false);
      store.setDensity('scale-1', 4);
      expect(store.read('scale-1').active).toBe(true);
      clock += 900_001;
      expect(store.read('scale-1').active).toBe(false);
    });

    it('distinguishes a live-but-empty entry from an absent one', () => {
      // Composition.empty() reads all-null and so does a scale with no entry at
      // all; `active` is the only thing telling them apart, and the rs:clear
      // "nothing to clear" ack depends on it.
      store.setDensity('scale-1', 4);
      store.setWeight('scale-1', { grams: 300, unit: 'g' });
      expect(store.read('scale-1').active).toBe(true);
      store.endPlacement('scale-1');
      const after = store.read('scale-1');
      expect(after).toMatchObject({ grams: null, density: null, container: null });
      expect(after.active).toBe(false);
    });

    it('returns the full documented shape', () => {
      store.setWeight('scale-1', { grams: 500, unit: 'g' });
      expect(Object.keys(store.read('scale-1')).sort())
        .toEqual(['active', 'complete', 'container', 'density', 'grams', 'unit']);
    });

    it('returns a snapshot that cannot mutate the store', () => {
      store.setDensity('scale-1', 4);
      const snap = store.read('scale-1');
      snap.density = 9;
      expect(store.read('scale-1').density).toBe(4);
    });

    it('returns a fresh object on every call', () => {
      // Not merely un-writeable-through: two reads must not be the same object,
      // or a caller holding an earlier snapshot would see it change underneath.
      store.setDensity('scale-1', 4);
      const first = store.read('scale-1');
      const second = store.read('scale-1');
      expect(first).not.toBe(second);
      expect(first).toEqual(second);
      store.setWeight('scale-1', { grams: 500, unit: 'g' });
      expect(first.grams).toBeNull();
    });

    it('does not hand back state that a setter return value could mutate', () => {
      const returned = store.setDensity('scale-1', 4);
      returned.density = 9;
      returned.container = 'mug';
      expect(store.read('scale-1')).toMatchObject({ density: 4, container: null });
    });

    it('survives being called through a detached reference', () => {
      // The bridge and the scan handler are separate call sites; either may
      // destructure the store. `this`-bound methods would break there.
      const { setWeight, setDensity, read } = store;
      setWeight('scale-1', { grams: 500, unit: 'g' });
      setDensity('scale-1', 4);
      expect(read('scale-1').complete).toBe(true);
    });
  });

  describe('clock injection', () => {
    it('requires a clock rather than defaulting to Date.now', () => {
      // No Date.now fallback: a caller who forgets to inject would otherwise get
      // wall-clock aging in a store whose contract is deterministic window math,
      // and no test would catch it. Fail at construction instead.
      expect(() => new CompositionStore({ windowMs: 900_000 })).toThrow(ValidationError);
      expect(() => new CompositionStore()).toThrow(ValidationError);
      expect(() => new CompositionStore({ windowMs: 900_000, now: undefined }))
        .toThrow(ValidationError);
    });

    it('ages only against the injected clock, never the wall clock', () => {
      // windowMs of 1 with a frozen clock: anything consulting Date.now would
      // expire this immediately, since real time advances between the two calls.
      const frozen = new CompositionStore({ windowMs: 1, now: () => 0 });
      frozen.setDensity('scale-1', 4);
      expect(frozen.read('scale-1').density).toBe(4);
      expect(frozen.endPlacement('scale-1')).toBe(true);
    });

    it('stamps touchedAt from the injected clock at write time', () => {
      // A store that stamped at read time, or from a captured constant, would
      // pass the coarse window tests but drift here.
      let ticks = 0;
      const counting = new CompositionStore({ windowMs: 10, now: () => ticks });
      counting.setDensity('scale-1', 4);
      ticks = 10;
      expect(counting.read('scale-1').active).toBe(true);   // exactly at the window
      counting.setContainer('scale-1', 'mug');              // re-stamps at 10
      ticks = 20;
      expect(counting.read('scale-1').active).toBe(true);   // exactly at the window again
      ticks = 21;
      expect(counting.read('scale-1').active).toBe(false);
    });

    it('defaults windowMs when only a clock is injected', () => {
      // The 15-minute default (D2) survives: 900_000 is live, 900_001 is not.
      const defaulted = new CompositionStore({ now: () => clock });
      defaulted.setDensity('scale-1', 4);
      clock += 900_000;
      expect(defaulted.read('scale-1').active).toBe(true);
      clock += 1;
      expect(defaulted.read('scale-1').active).toBe(false);
    });
  });
});
