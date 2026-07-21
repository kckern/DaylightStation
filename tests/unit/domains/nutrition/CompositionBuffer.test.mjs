import { describe, it, expect, beforeEach } from 'vitest';
import { createCompositionBuffer, MAX_DENSITY_LEVEL } from '#domains/nutrition';
import { ValidationError } from '#domains/core/errors/index.mjs';

describe('CompositionBuffer', () => {
  let clock, buf;
  beforeEach(() => {
    clock = 1_000_000;
    buf = createCompositionBuffer({ windowMs: 900_000, now: () => clock });
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
    if (step === 'weight')    buf.setWeight(id, { grams: 500, unit: 'g' });
    if (step === 'density')   buf.setDensity(id, 4);
    if (step === 'container') buf.setContainer(id, 'dinner-bowl');
  };

  it.each(permutations)('converges identically: %s -> %s -> %s', (a, b, c) => {
    [a, b, c].forEach((step) => apply('scale-1', step));
    expect(buf.read('scale-1')).toMatchObject({
      grams: 500, unit: 'g', density: 4, container: 'dinner-bowl', complete: true,
    });
  });

  it('is not complete without a weight', () => {
    buf.setDensity('scale-1', 4);
    buf.setContainer('scale-1', 'dinner-bowl');
    expect(buf.read('scale-1').grams).toBeNull();
    expect(buf.read('scale-1').complete).toBe(false);
  });

  it('is complete on weight + density with no container', () => {
    buf.setWeight('scale-1', { grams: 500, unit: 'g' });
    buf.setDensity('scale-1', 4);
    expect(buf.read('scale-1').complete).toBe(true);
  });

  // THE regression case: two foods in one window.
  it('does not leak slots from one placement to the next', () => {
    buf.setWeight('scale-1', { grams: 300, unit: 'g' });
    buf.setDensity('scale-1', 2);
    buf.setContainer('scale-1', 'small-bowl');
    buf.endPlacement('scale-1');                       // pan returned to baseline

    clock += 6 * 60_000;                                // six minutes later
    buf.setWeight('scale-1', { grams: 700, unit: 'g' });
    const s = buf.read('scale-1');
    expect(s.density).toBeNull();
    expect(s.container).toBeNull();
    expect(s.complete).toBe(false);
  });

  it('scans refresh the window', () => {
    buf.setDensity('scale-1', 4);
    clock += 800_000;
    buf.setContainer('scale-1', 'mug');   // refresh
    clock += 800_000;                     // 1.6M total, but only 800k since refresh
    expect(buf.read('scale-1').density).toBe(4);
  });

  it('expires after the window with no activity', () => {
    buf.setDensity('scale-1', 4);
    clock += 900_001;
    expect(buf.read('scale-1').density).toBeNull();
  });

  it('clear() empties every slot', () => {
    buf.setWeight('scale-1', { grams: 500, unit: 'g' });
    buf.setDensity('scale-1', 4);
    buf.clear('scale-1');
    expect(buf.read('scale-1')).toMatchObject({ grams: null, density: null, container: null });
  });

  it('keeps scales independent', () => {
    buf.setDensity('scale-1', 4);
    buf.setDensity('scale-2', 9);
    expect(buf.read('scale-1').density).toBe(4);
    expect(buf.read('scale-2').density).toBe(9);
  });

  it('carries the unit through instead of assuming grams', () => {
    buf.setWeight('scale-1', { grams: 250, unit: 'ml' });
    expect(buf.read('scale-1').unit).toBe('ml');
  });

  // ---------------------------------------------------------------------------
  // Window arithmetic
  // ---------------------------------------------------------------------------

  describe('window', () => {
    it('is still live at exactly windowMs', () => {
      buf.setDensity('scale-1', 4);
      clock += 900_000;
      expect(buf.read('scale-1').density).toBe(4);
    });

    it('does not let reads refresh the window', () => {
      // The refresh set is {scans, qualifying placements}. A read is neither.
      // If read() refreshed, polling the buffer would keep it alive forever.
      buf.setDensity('scale-1', 4);
      clock += 800_000;
      expect(buf.read('scale-1').density).toBe(4);   // read, does NOT refresh
      clock += 200_000;                              // 1_000_000 since the scan
      expect(buf.read('scale-1').density).toBeNull();
    });

    it('drops a stale slot rather than merging it with a new one', () => {
      buf.setDensity('scale-1', 4);
      buf.setContainer('scale-1', 'small-bowl');
      clock += 900_001;
      buf.setWeight('scale-1', { grams: 700, unit: 'g' });
      expect(buf.read('scale-1')).toMatchObject({
        grams: 700, density: null, container: null, complete: false,
      });
    });

    it('rejects a non-positive windowMs at construction', () => {
      expect(() => createCompositionBuffer({ windowMs: 0, now: () => clock }))
        .toThrow(ValidationError);
      expect(() => createCompositionBuffer({ windowMs: -1, now: () => clock }))
        .toThrow(ValidationError);
      expect(() => createCompositionBuffer({ windowMs: NaN, now: () => clock }))
        .toThrow(ValidationError);
    });

    it('rejects a non-function now at construction', () => {
      expect(() => createCompositionBuffer({ now: 12345 })).toThrow(ValidationError);
    });
  });

  // ---------------------------------------------------------------------------
  // Input contract: this buffer feeds scanNutrition, which refuses non-finite
  // and stringified numbers. Storing what it would refuse just relocates the
  // failure to auto-accept time, past the point a human could catch it.
  // ---------------------------------------------------------------------------

  describe('input contract', () => {
    it('refuses a non-finite weight instead of storing NaN', () => {
      expect(() => buf.setWeight('scale-1', { grams: NaN, unit: 'g' })).toThrow(ValidationError);
      expect(() => buf.setWeight('scale-1', { grams: Infinity, unit: 'g' })).toThrow(ValidationError);
    });

    it('refuses a stringified weight', () => {
      // scanNutrition refuses '500'; accepting it here would mean the buffer
      // reports complete: true on something that throws downstream.
      expect(() => buf.setWeight('scale-1', { grams: '500', unit: 'g' })).toThrow(ValidationError);
    });

    it('refuses a missing weight rather than coercing it to 0', () => {
      expect(() => buf.setWeight('scale-1', { unit: 'g' })).toThrow(ValidationError);
      expect(() => buf.setWeight('scale-1', { grams: null, unit: 'g' })).toThrow(ValidationError);
    });

    it('throws a ValidationError, not a TypeError, on a missing payload', () => {
      expect(() => buf.setWeight('scale-1')).toThrow(ValidationError);
      expect(() => buf.setWeight('scale-1', null)).toThrow(ValidationError);
    });

    it('leaves the buffer untouched when a setter rejects', () => {
      buf.setDensity('scale-1', 4);
      expect(() => buf.setWeight('scale-1', { grams: NaN, unit: 'g' })).toThrow(ValidationError);
      // The rejected weight must not have half-filled a slot, and must not have
      // refreshed the window on the caller's behalf.
      expect(buf.read('scale-1')).toMatchObject({ grams: null, density: 4, complete: false });
    });

    const rejectedCalls = [
      ['setWeight',    (b) => b.setWeight('scale-1', { grams: 'oops', unit: 'g' })],
      ['setDensity',   (b) => b.setDensity('scale-1', 99)],
      ['setContainer', (b) => b.setContainer('scale-1', '')],
    ];

    it.each(rejectedCalls)('does not create a slot for a rejected %s', (_name, call) => {
      expect(() => call(buf)).toThrow(ValidationError);
      expect(buf.read('scale-1').active).toBe(false);
    });

    it.each(rejectedCalls)('does not refresh the window from a rejected %s', (_name, call) => {
      // A call that did not happen must not extend the window. If a rejected
      // setter touched the slot first, a stream of bad scans would keep a stale
      // buffer alive indefinitely.
      buf.setDensity('scale-1', 4);
      clock += 800_000;
      expect(() => call(buf)).toThrow(ValidationError);
      clock += 200_000;                     // 1_000_000 since the only real scan
      expect(buf.read('scale-1').active).toBe(false);
    });

    it('keeps a negative weight, which is a real scale reading', () => {
      // computeNet clamps and flags negatives rather than throwing; the buffer
      // must not pre-empt that decision.
      buf.setWeight('scale-1', { grams: -12, unit: 'g' });
      expect(buf.read('scale-1').grams).toBe(-12);
    });

    it('does not round the weight it was handed', () => {
      buf.setWeight('scale-1', { grams: 500.5, unit: 'g' });
      expect(buf.read('scale-1').grams).toBe(500.5);
    });

    it('defaults an absent unit to grams', () => {
      buf.setWeight('scale-1', { grams: 500 });
      expect(buf.read('scale-1').unit).toBe('g');
    });

    it('refuses a unit that is present but unusable', () => {
      expect(() => buf.setWeight('scale-1', { grams: 500, unit: '' })).toThrow(ValidationError);
      expect(() => buf.setWeight('scale-1', { grams: 500, unit: 7 })).toThrow(ValidationError);
    });

    it('refuses a density level outside the printed grammar', () => {
      expect(() => buf.setDensity('scale-1', 0)).toThrow(ValidationError);
      expect(() => buf.setDensity('scale-1', MAX_DENSITY_LEVEL + 1)).toThrow(ValidationError);
      expect(() => buf.setDensity('scale-1', 2.5)).toThrow(ValidationError);
      expect(() => buf.setDensity('scale-1', '4')).toThrow(ValidationError);
      expect(() => buf.setDensity('scale-1', NaN)).toThrow(ValidationError);
    });

    it('accepts every level the grammar can print', () => {
      for (let level = 1; level <= MAX_DENSITY_LEVEL; level += 1) {
        buf.setDensity('scale-1', level);
        expect(buf.read('scale-1').density).toBe(level);
      }
    });

    it('refuses an unusable container id', () => {
      expect(() => buf.setContainer('scale-1', '')).toThrow(ValidationError);
      expect(() => buf.setContainer('scale-1', null)).toThrow(ValidationError);
      expect(() => buf.setContainer('scale-1', 42)).toThrow(ValidationError);
    });

    it('refuses an unusable scale id', () => {
      expect(() => buf.setDensity('', 4)).toThrow(ValidationError);
      expect(() => buf.setDensity(null, 4)).toThrow(ValidationError);
      expect(() => buf.read(null)).toThrow(ValidationError);
    });
  });

  // ---------------------------------------------------------------------------
  // Slot lifecycle (D10)
  // ---------------------------------------------------------------------------

  describe('slot lifecycle', () => {
    it('last scan of a kind wins', () => {
      buf.setDensity('scale-1', 2);
      buf.setDensity('scale-1', 7);
      buf.setContainer('scale-1', 'mug');
      buf.setContainer('scale-1', 'dinner-bowl');
      expect(buf.read('scale-1')).toMatchObject({ density: 7, container: 'dinner-bowl' });
    });

    it('revises the weight in place while a placement is live', () => {
      buf.setDensity('scale-1', 4);
      buf.setWeight('scale-1', { grams: 300, unit: 'g' });
      buf.setWeight('scale-1', { grams: 320, unit: 'g' });
      expect(buf.read('scale-1')).toMatchObject({ grams: 320, density: 4, complete: true });
    });

    it('consumes scans even when no weight was ever recorded', () => {
      // The bridge ends sessions that never yield a weight: the min_grams floor
      // guard, and the suspicion filter that suppresses a storage-band placement
      // or a heavy jump after a post storm. Surviving those would hand the next
      // real weight a density and tare belonging to no food on the scale.
      buf.setDensity('scale-1', 4);
      buf.setContainer('scale-1', 'mug');
      buf.endPlacement('scale-1');
      expect(buf.read('scale-1')).toMatchObject({ density: null, container: null });
    });

    it('does not let a suppressed placement leak scans into the next weight', () => {
      // Full walk of the configured leak path, end to end.
      buf.setDensity('scale-1', 2);
      buf.setContainer('scale-1', 'small-bowl');
      buf.endPlacement('scale-1');            // suppressed placement: no weight posted

      clock += 60_000;
      buf.setWeight('scale-1', { grams: 700, unit: 'g' });
      expect(buf.read('scale-1')).toMatchObject({
        grams: 700, density: null, container: null, complete: false,
      });
    });

    it('reports whether it had anything to consume', () => {
      expect(buf.endPlacement('scale-1')).toBe(false);   // nothing buffered at all
      buf.setDensity('scale-1', 4);
      expect(buf.endPlacement('scale-1')).toBe(true);    // weightless scans still count
      buf.setWeight('scale-1', { grams: 300, unit: 'g' });
      expect(buf.endPlacement('scale-1')).toBe(true);
    });

    it('treats an expired slot as nothing to consume', () => {
      // Matches clear(): an already-expired buffer was not consumed by this
      // placement, and must not report as though it were.
      buf.setDensity('scale-1', 4);
      clock += 900_001;
      expect(buf.endPlacement('scale-1')).toBe(false);
    });

    it('is idempotent on repeated placement ends', () => {
      buf.setWeight('scale-1', { grams: 300, unit: 'g' });
      buf.setDensity('scale-1', 4);
      expect(buf.endPlacement('scale-1')).toBe(true);
      expect(buf.endPlacement('scale-1')).toBe(false);
      expect(buf.read('scale-1')).toMatchObject({ grams: null, density: null });
    });

    it('ends a placement on one scale without touching another', () => {
      buf.setWeight('scale-1', { grams: 300, unit: 'g' });
      buf.setDensity('scale-1', 2);
      buf.setDensity('scale-2', 9);
      buf.endPlacement('scale-1');
      expect(buf.read('scale-1').density).toBeNull();
      expect(buf.read('scale-2').density).toBe(9);
    });

    it('reports whether clear() had anything to clear', () => {
      // Drives the "nothing to clear" ack on a bare rs:clear scan.
      expect(buf.clear('scale-1')).toBe(false);
      buf.setDensity('scale-1', 4);
      expect(buf.clear('scale-1')).toBe(true);
      expect(buf.clear('scale-1')).toBe(false);
    });

    it('clears scans even when no weight was ever recorded', () => {
      // The asymmetry with endPlacement: rs:clear is an explicit human "forget
      // it", so unlike a session-end it wipes a weightless buffer too.
      buf.setDensity('scale-1', 4);
      buf.setContainer('scale-1', 'mug');
      expect(buf.clear('scale-1')).toBe(true);
      expect(buf.read('scale-1')).toMatchObject({ density: null, container: null });
    });

    it('treats an expired slot as nothing to clear', () => {
      buf.setDensity('scale-1', 4);
      clock += 900_001;
      expect(buf.clear('scale-1')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // read() shape
  // ---------------------------------------------------------------------------

  describe('read', () => {
    it('distinguishes an absent buffer from a live one', () => {
      expect(buf.read('scale-1').active).toBe(false);
      buf.setDensity('scale-1', 4);
      expect(buf.read('scale-1').active).toBe(true);
      clock += 900_001;
      expect(buf.read('scale-1').active).toBe(false);
    });

    it('returns a snapshot that cannot mutate the buffer', () => {
      buf.setDensity('scale-1', 4);
      const snap = buf.read('scale-1');
      snap.density = 9;
      expect(buf.read('scale-1').density).toBe(4);
    });

    it('survives being called through a detached reference', () => {
      // The bridge and the scan handler are separate call sites; either may
      // destructure the buffer. `this`-bound methods would break there.
      const { setWeight, setDensity, read } = buf;
      setWeight('scale-1', { grams: 500, unit: 'g' });
      setDensity('scale-1', 4);
      expect(read('scale-1').complete).toBe(true);
    });
  });

  describe('clock injection', () => {
    it('requires a clock rather than defaulting to Date.now', () => {
      // No Date.now fallback: a caller who forgets to inject would otherwise get
      // wall-clock aging in a module whose contract is deterministic window math,
      // and no test would catch it. Fail at construction instead.
      expect(() => createCompositionBuffer({ windowMs: 900_000 })).toThrow(ValidationError);
      expect(() => createCompositionBuffer()).toThrow(ValidationError);
      expect(() => createCompositionBuffer({ windowMs: 900_000, now: undefined }))
        .toThrow(ValidationError);
    });

    it('ages only against the injected clock, never the wall clock', () => {
      // windowMs of 1 with a frozen clock: anything consulting Date.now would
      // expire this immediately, since real time advances between the two calls.
      const frozen = createCompositionBuffer({ windowMs: 1, now: () => 0 });
      frozen.setDensity('scale-1', 4);
      expect(frozen.read('scale-1').density).toBe(4);
      expect(frozen.endPlacement('scale-1')).toBe(true);
    });
  });
});
