/**
 * `Composition` — immutable value object for one in-progress food composition.
 *
 * These cases are ported from `CompositionBuffer.test.mjs`: everything that was
 * about a SLOT (validation, the coercion refusals, completeness) rather than
 * about the per-scale store (window, expiry, consumption) lives here now. The
 * store keeps the rest (Task 4).
 *
 * The immutability block is the reason this file exists at all — without it this
 * class is a renamed mutable bag.
 */

import { describe, it, expect } from 'vitest';
import { Composition } from '#domains/nutrition/value-objects/index.mjs';
import { MAX_DENSITY_LEVEL } from '#domains/nutrition/services/ScanVocabularyService.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

describe('Composition', () => {
  describe('empty()', () => {
    it('starts with all four slots null', () => {
      const c = Composition.empty();
      expect(c.grams).toBeNull();
      expect(c.unit).toBeNull();
      expect(c.density).toBeNull();
      expect(c.container).toBeNull();
    });

    it('is not complete', () => {
      expect(Composition.empty().isComplete).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Immutability. Every with* returns a NEW instance and leaves the receiver
  // exactly as it was. This is what makes it a value object.
  // ---------------------------------------------------------------------------

  describe('immutability', () => {
    it('withWeight returns a new instance and leaves the original untouched', () => {
      const before = Composition.empty();
      const after = before.withWeight({ grams: 500, unit: 'g' });
      expect(after).not.toBe(before);
      expect(after.grams).toBe(500);
      expect(before.grams).toBeNull();
      expect(before.unit).toBeNull();
    });

    it('withDensity returns a new instance and leaves the original untouched', () => {
      const before = Composition.empty();
      const after = before.withDensity(4);
      expect(after).not.toBe(before);
      expect(after.density).toBe(4);
      expect(before.density).toBeNull();
    });

    it('withContainer returns a new instance and leaves the original untouched', () => {
      const before = Composition.empty();
      const after = before.withContainer('dinner-bowl');
      expect(after).not.toBe(before);
      expect(after.container).toBe('dinner-bowl');
      expect(before.container).toBeNull();
    });

    it('leaves an already-populated original untouched when overwritten', () => {
      // Not just empty -> filled: filled -> refilled is the case a mutating
      // implementation is most likely to get wrong.
      const first = Composition.empty().withDensity(2).withContainer('mug');
      const second = first.withDensity(7).withContainer('dinner-bowl');
      expect(first.density).toBe(2);
      expect(first.container).toBe('mug');
      expect(second.density).toBe(7);
      expect(second.container).toBe('dinner-bowl');
    });

    it('is frozen', () => {
      const c = Composition.empty();
      expect(Object.isFrozen(c)).toBe(true);
    });

    it('cannot be mutated through toData()', () => {
      const c = Composition.empty().withDensity(4);
      const data = c.toData();
      data.density = 9;
      expect(c.density).toBe(4);
      expect(c.toData().density).toBe(4);
    });

    it('survives being called through a detached reference', () => {
      // Call sites destructure freely; `this`-dependent helpers must still work
      // when the method is bound off the instance.
      const c = Composition.empty();
      const withDensity = c.withDensity.bind(c);
      expect(withDensity(4).density).toBe(4);
    });
  });

  // ---------------------------------------------------------------------------
  // Order independence: the three slots converge to the same value regardless of
  // which event arrived first. Ported from the buffer's permutation test.
  // ---------------------------------------------------------------------------

  describe('order independence', () => {
    const permutations = [
      ['weight', 'density', 'container'],
      ['weight', 'container', 'density'],
      ['density', 'weight', 'container'],
      ['density', 'container', 'weight'],
      ['container', 'weight', 'density'],
      ['container', 'density', 'weight'],
    ];

    const apply = (c, step) => {
      if (step === 'weight') return c.withWeight({ grams: 500, unit: 'g' });
      if (step === 'density') return c.withDensity(4);
      return c.withContainer('dinner-bowl');
    };

    it.each(permutations)('converges identically: %s -> %s -> %s', (a, b, c) => {
      const result = [a, b, c].reduce(apply, Composition.empty());
      expect(result.toData()).toEqual({
        grams: 500, unit: 'g', density: 4, container: 'dinner-bowl',
      });
      expect(result.isComplete).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // isComplete: weight AND density (D4). Those two are what auto-accept needs.
  // ---------------------------------------------------------------------------

  describe('isComplete', () => {
    it('is false without a weight', () => {
      const c = Composition.empty().withDensity(4).withContainer('dinner-bowl');
      expect(c.isComplete).toBe(false);
    });

    it('is false without a density', () => {
      const c = Composition.empty().withWeight({ grams: 500 }).withContainer('dinner-bowl');
      expect(c.isComplete).toBe(false);
    });

    it('is true on weight + density with no container', () => {
      const c = Composition.empty().withWeight({ grams: 500, unit: 'g' }).withDensity(4);
      expect(c.isComplete).toBe(true);
      expect(c.container).toBeNull();
    });

    it('is true on a zero weight, which is a real reading and not an absent one', () => {
      // 0 is falsy; a truthiness check here would report incomplete on a genuine
      // zero-gram reading. The slot is null-or-set, never truthy-or-not.
      const c = Composition.empty().withWeight({ grams: 0 }).withDensity(4);
      expect(c.isComplete).toBe(true);
    });

    it('is unaffected by the unit', () => {
      // The composition carries 'ml' faithfully; refusing a volumetric unit is
      // the application layer's call, not this object's.
      const c = Composition.empty().withWeight({ grams: 250, unit: 'ml' }).withDensity(4);
      expect(c.unit).toBe('ml');
      expect(c.isComplete).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Input contract. This feeds ScanNutritionService, which refuses non-finite and
  // stringified numbers. Accepting what it refuses only relocates the failure to
  // auto-accept time, past the point a human could catch it.
  // ---------------------------------------------------------------------------

  describe('withWeight', () => {
    it('refuses a non-finite weight instead of storing NaN', () => {
      expect(() => Composition.empty().withWeight({ grams: NaN })).toThrow(ValidationError);
      expect(() => Composition.empty().withWeight({ grams: Infinity })).toThrow(ValidationError);
      expect(() => Composition.empty().withWeight({ grams: -Infinity })).toThrow(ValidationError);
    });

    it('refuses a stringified weight', () => {
      // computeNet throws on '500'; accepting it here would mean reporting
      // isComplete on something that cannot be computed.
      expect(() => Composition.empty().withWeight({ grams: '500' })).toThrow(ValidationError);
    });

    it('refuses a missing weight rather than coercing it to 0', () => {
      expect(() => Composition.empty().withWeight({ unit: 'g' })).toThrow(ValidationError);
      expect(() => Composition.empty().withWeight({ grams: null })).toThrow(ValidationError);
    });

    it('refuses other coercible non-numbers', () => {
      expect(() => Composition.empty().withWeight({ grams: true })).toThrow(ValidationError);
      expect(() => Composition.empty().withWeight({ grams: [] })).toThrow(ValidationError);
      expect(() => Composition.empty().withWeight({ grams: {} })).toThrow(ValidationError);
    });

    it('throws a ValidationError, not a TypeError, on a missing payload', () => {
      expect(() => Composition.empty().withWeight()).toThrow(ValidationError);
      expect(() => Composition.empty().withWeight(null)).toThrow(ValidationError);
      expect(() => Composition.empty().withWeight('500g')).toThrow(ValidationError);
      expect(() => Composition.empty().withWeight([500])).toThrow(ValidationError);
    });

    it('keeps a negative weight, which is a real scale reading', () => {
      // computeNet clamps and flags negatives rather than throwing; this object
      // must not pre-empt that decision.
      expect(Composition.empty().withWeight({ grams: -12 }).grams).toBe(-12);
    });

    it('does not round the weight it was handed', () => {
      expect(Composition.empty().withWeight({ grams: 500.5 }).grams).toBe(500.5);
    });

    it('defaults an absent unit to grams', () => {
      expect(Composition.empty().withWeight({ grams: 500 }).unit).toBe('g');
      expect(Composition.empty().withWeight({ grams: 500, unit: null }).unit).toBe('g');
      expect(Composition.empty().withWeight({ grams: 500, unit: undefined }).unit).toBe('g');
    });

    it('refuses a unit that is present but unusable', () => {
      // 'ml' silently becoming 'g' would mislabel the entry, so a malformed unit
      // is a rejection rather than a fallback.
      expect(() => Composition.empty().withWeight({ grams: 500, unit: '' })).toThrow(ValidationError);
      expect(() => Composition.empty().withWeight({ grams: 500, unit: 7 })).toThrow(ValidationError);
      expect(() => Composition.empty().withWeight({ grams: 500, unit: {} })).toThrow(ValidationError);
    });

    it('does not half-build an instance when it rejects', () => {
      // Validate before constructing: a rejected call must leave no trace on the
      // receiver and must not hand back a partially-populated instance.
      const before = Composition.empty().withDensity(4);
      expect(() => before.withWeight({ grams: NaN })).toThrow(ValidationError);
      expect(before.grams).toBeNull();
      expect(before.unit).toBeNull();
      expect(before.density).toBe(4);
      expect(before.isComplete).toBe(false);
    });

    it('does not apply a valid grams when the unit is rejected', () => {
      const before = Composition.empty();
      expect(() => before.withWeight({ grams: 500, unit: 7 })).toThrow(ValidationError);
      expect(before.grams).toBeNull();
    });
  });

  describe('withDensity', () => {
    it('refuses a level outside the printed grammar', () => {
      expect(() => Composition.empty().withDensity(0)).toThrow(ValidationError);
      expect(() => Composition.empty().withDensity(-1)).toThrow(ValidationError);
      expect(() => Composition.empty().withDensity(MAX_DENSITY_LEVEL + 1)).toThrow(ValidationError);
      expect(() => Composition.empty().withDensity(2.5)).toThrow(ValidationError);
      expect(() => Composition.empty().withDensity('4')).toThrow(ValidationError);
      expect(() => Composition.empty().withDensity(NaN)).toThrow(ValidationError);
      expect(() => Composition.empty().withDensity(null)).toThrow(ValidationError);
      expect(() => Composition.empty().withDensity()).toThrow(ValidationError);
    });

    it('accepts every level the grammar can print', () => {
      for (let level = 1; level <= MAX_DENSITY_LEVEL; level += 1) {
        expect(Composition.empty().withDensity(level).density).toBe(level);
      }
    });

    it('validates against MAX_DENSITY_LEVEL rather than a hardcoded bound', () => {
      expect(Composition.empty().withDensity(MAX_DENSITY_LEVEL).density).toBe(MAX_DENSITY_LEVEL);
    });

    it('does not half-build an instance when it rejects', () => {
      const before = Composition.empty().withDensity(4);
      expect(() => before.withDensity(99)).toThrow(ValidationError);
      expect(before.density).toBe(4);
    });

    it('takes the last valid level', () => {
      expect(Composition.empty().withDensity(2).withDensity(7).density).toBe(7);
    });
  });

  describe('withContainer', () => {
    it('refuses an unusable container id', () => {
      expect(() => Composition.empty().withContainer('')).toThrow(ValidationError);
      expect(() => Composition.empty().withContainer(null)).toThrow(ValidationError);
      expect(() => Composition.empty().withContainer()).toThrow(ValidationError);
      expect(() => Composition.empty().withContainer(42)).toThrow(ValidationError);
      expect(() => Composition.empty().withContainer({})).toThrow(ValidationError);
    });

    it('accepts a well-formed id', () => {
      expect(Composition.empty().withContainer('small-bowl').container).toBe('small-bowl');
    });

    it('does not half-build an instance when it rejects', () => {
      const before = Composition.empty().withContainer('mug');
      expect(() => before.withContainer('')).toThrow(ValidationError);
      expect(before.container).toBe('mug');
    });

    it('takes the last valid id', () => {
      expect(Composition.empty().withContainer('mug').withContainer('dinner-bowl').container)
        .toBe('dinner-bowl');
    });
  });

  // ---------------------------------------------------------------------------
  // Equality contract
  // ---------------------------------------------------------------------------

  describe('equals', () => {
    it('is true for identical slots built by different paths', () => {
      const a = Composition.empty()
        .withWeight({ grams: 500, unit: 'g' })
        .withDensity(4)
        .withContainer('dinner-bowl');
      const b = Composition.empty()
        .withContainer('dinner-bowl')
        .withDensity(4)
        .withWeight({ grams: 500, unit: 'g' });
      expect(a.equals(b)).toBe(true);
      expect(b.equals(a)).toBe(true);
    });

    it('is true for two empties', () => {
      expect(Composition.empty().equals(Composition.empty())).toBe(true);
    });

    it('is true for a round trip through toData/fromData', () => {
      const a = Composition.empty().withWeight({ grams: 250, unit: 'ml' }).withDensity(9);
      expect(a.equals(Composition.fromData(a.toData()))).toBe(true);
    });

    const differing = [
      ['grams', (c) => c.withWeight({ grams: 501, unit: 'g' })],
      ['unit', (c) => c.withWeight({ grams: 500, unit: 'ml' })],
      ['density', (c) => c.withDensity(5)],
      ['container', (c) => c.withContainer('mug')],
    ];

    it.each(differing)('is false when %s differs', (_slot, mutate) => {
      const base = Composition.empty()
        .withWeight({ grams: 500, unit: 'g' })
        .withDensity(4)
        .withContainer('dinner-bowl');
      expect(base.equals(mutate(base))).toBe(false);
    });

    it('is false when a slot is set on one side only', () => {
      const filled = Composition.empty().withDensity(4);
      expect(filled.equals(Composition.empty())).toBe(false);
      expect(Composition.empty().equals(filled)).toBe(false);
    });

    it('is false against a non-Composition', () => {
      const c = Composition.empty().withDensity(4);
      expect(c.equals(null)).toBe(false);
      expect(c.equals(undefined)).toBe(false);
      expect(c.equals({ grams: null, unit: null, density: 4, container: null })).toBe(false);
      expect(c.equals('4')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  describe('toData / fromData', () => {
    it('round-trips every slot', () => {
      const a = Composition.empty()
        .withWeight({ grams: 500.5, unit: 'ml' })
        .withDensity(7)
        .withContainer('small-bowl');
      const b = Composition.fromData(a.toData());
      expect(b.toData()).toEqual(a.toData());
      expect(b.isComplete).toBe(true);
    });

    it('round-trips an empty composition', () => {
      const data = Composition.empty().toData();
      expect(data).toEqual({ grams: null, unit: null, density: null, container: null });
      expect(Composition.fromData(data).equals(Composition.empty())).toBe(true);
    });

    it('produces a plain object safe to persist', () => {
      const data = Composition.empty().withDensity(4).toData();
      expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
      expect(JSON.parse(JSON.stringify(data))).toEqual(data);
    });

    it('treats absent keys as empty slots', () => {
      expect(Composition.fromData({}).equals(Composition.empty())).toBe(true);
      expect(Composition.fromData({ density: 4 }).density).toBe(4);
    });

    it('refuses a payload that is not an object', () => {
      expect(() => Composition.fromData(null)).toThrow(ValidationError);
      expect(() => Composition.fromData()).toThrow(ValidationError);
      expect(() => Composition.fromData('x')).toThrow(ValidationError);
      expect(() => Composition.fromData([])).toThrow(ValidationError);
    });

    it('applies the same validation on reconstitution as on the setters', () => {
      // Stored data is not trusted more than live scans: a corrupted or
      // hand-edited record must fail loudly rather than reach auto-accept.
      expect(() => Composition.fromData({ grams: '500' })).toThrow(ValidationError);
      expect(() => Composition.fromData({ grams: NaN })).toThrow(ValidationError);
      expect(() => Composition.fromData({ density: 0 })).toThrow(ValidationError);
      expect(() => Composition.fromData({ density: MAX_DENSITY_LEVEL + 1 })).toThrow(ValidationError);
      expect(() => Composition.fromData({ container: '' })).toThrow(ValidationError);
      expect(() => Composition.fromData({ unit: 7 })).toThrow(ValidationError);
    });

    it('returns a fresh object each call', () => {
      const c = Composition.empty().withDensity(4);
      expect(c.toData()).not.toBe(c.toData());
    });
  });

  // ---------------------------------------------------------------------------
  // Error shape: callers surface err.message alone, so it has to name the field
  // and show what actually arrived.
  // ---------------------------------------------------------------------------

  describe('error reporting', () => {
    it('names the offending field and value', () => {
      expect(() => Composition.empty().withWeight({ grams: '500' }))
        .toThrow(/grams.*500/s);
      expect(() => Composition.empty().withDensity(99))
        .toThrow(new RegExp(`density.*1-${MAX_DENSITY_LEVEL}`, 's'));
      expect(() => Composition.empty().withContainer(''))
        .toThrow(/container/i);
    });

    it('reports the value it actually received, not a normalised stand-in', () => {
      // Someone reading err.message at the fridge needs to see what arrived. A
      // setter that folded null into undefined before validating would print
      // "received: undefined" for a null and send them looking for the wrong bug.
      expect(() => Composition.empty().withDensity(null)).toThrow(/received: null/);
      expect(() => Composition.empty().withDensity(undefined)).toThrow(/received: undefined/);
      expect(() => Composition.empty().withWeight({ grams: null })).toThrow(/received: null/);
      expect(() => Composition.empty().withContainer(null)).toThrow(/received: null/);
    });

    it('carries a structured code and field alongside the message', () => {
      const codes = [
        [() => Composition.empty().withWeight({ grams: 'x' }), 'INVALID_WEIGHT', 'grams'],
        [() => Composition.empty().withWeight({ grams: 1, unit: 7 }), 'INVALID_WEIGHT_UNIT', 'unit'],
        [() => Composition.empty().withWeight(null), 'INVALID_WEIGHT_PAYLOAD', 'weight payload'],
        [() => Composition.empty().withDensity(99), 'INVALID_DENSITY_LEVEL', 'density'],
        [() => Composition.empty().withContainer(''), 'INVALID_CONTAINER_ID', 'container'],
        [() => Composition.fromData(null), 'INVALID_COMPOSITION_DATA', 'composition data'],
      ];
      for (const [call, code, field] of codes) {
        try {
          call();
          throw new Error(`expected ${code} to throw`);
        } catch (err) {
          expect(err).toBeInstanceOf(ValidationError);
          expect(err.code ?? err.details?.code).toBe(code);
          expect(err.field ?? err.details?.field).toBe(field);
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // The one asymmetry worth pinning: an ABSENT slot in a data payload is an
  // empty slot, but an absent argument at a setter is a rejection. Collapsing
  // the two would turn `withDensity(undefined)` into a silent no-op.
  // ---------------------------------------------------------------------------

  describe('absent-value semantics', () => {
    it('reads null and undefined slots in a data payload as empty', () => {
      const c = Composition.fromData({
        grams: null, unit: undefined, density: null, container: undefined,
      });
      expect(c.equals(Composition.empty())).toBe(true);
    });

    it('refuses an absent argument at every setter', () => {
      expect(() => Composition.empty().withDensity(null)).toThrow(ValidationError);
      expect(() => Composition.empty().withDensity(undefined)).toThrow(ValidationError);
      expect(() => Composition.empty().withContainer(null)).toThrow(ValidationError);
      expect(() => Composition.empty().withContainer(undefined)).toThrow(ValidationError);
      expect(() => Composition.empty().withWeight({ grams: null })).toThrow(ValidationError);
      expect(() => Composition.empty().withWeight({ grams: undefined })).toThrow(ValidationError);
    });

    it('does not let a setter clear a slot that was already set', () => {
      const filled = Composition.empty().withDensity(4).withContainer('mug');
      expect(() => filled.withDensity(null)).toThrow(ValidationError);
      expect(() => filled.withContainer(null)).toThrow(ValidationError);
      expect(filled.density).toBe(4);
      expect(filled.container).toBe('mug');
    });
  });
});
