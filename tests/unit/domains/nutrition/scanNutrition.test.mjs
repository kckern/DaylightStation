import { describe, it, expect } from 'vitest';
import { computeNet, computeNutrition } from '#domains/nutrition';
import { ValidationError } from '#domains/core/errors/index.mjs';

const LEVEL_4 = {
  level: 4,
  label: 'Mixed',
  kcal_per_g: 1.4,
  macros: { fat_pct: 30, carb_pct: 45, protein_pct: 25 },
  per_100g: { fiber_g: 2, sugar_g: 5, sodium_mg: 300 },
};

describe('computeNet', () => {
  it('subtracts the container tare', () => {
    expect(computeNet(500, { grams: 180 })).toEqual({ netG: 320, tared: true, clamped: false });
  });

  it('passes gross through untared when no container', () => {
    expect(computeNet(500, null)).toEqual({ netG: 500, tared: false, clamped: false });
  });

  it('treats an omitted container the same as an explicit null', () => {
    expect(computeNet(500)).toEqual({ netG: 500, tared: false, clamped: false });
  });

  // Guaranteed during the placeholder-tare period (D6). Must clamp AND flag —
  // a silent 0 kcal entry auto-accepts into history and is worse than an error.
  it('clamps a negative net to zero and flags it', () => {
    expect(computeNet(100, { grams: 180 })).toEqual({ netG: 0, tared: true, clamped: true });
  });

  // A scale can legitimately read below zero after an item is lifted off. That
  // is a real reading, not corrupt data, so it clamps and flags rather than throwing.
  it('clamps a negative gross reading and flags it', () => {
    expect(computeNet(-5, null)).toEqual({ netG: 0, tared: false, clamped: true });
  });

  // Boundary: `clamped` means the subtraction went negative, not that the net is zero.
  it('does not flag a net of exactly zero', () => {
    expect(computeNet(180, { grams: 180 })).toEqual({ netG: 0, tared: true, clamped: false });
  });

  // A zero tare subtracts nothing, so nothing was tared. Keeps `tared` honest as
  // "the gross was adjusted" rather than "a container was scanned" — the container
  // id is recorded separately by the caller.
  it('reports a zero-weight container as untared', () => {
    expect(computeNet(500, { grams: 0 })).toEqual({ netG: 500, tared: false, clamped: false });
  });

  describe('rejects unusable input rather than coercing it', () => {
    // The core defect this contract exists to prevent: a non-finite gross must not
    // slip through as an unflagged NaN (which then floors to a silent 0 kcal entry).
    it.each([
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['undefined', undefined],
      ['null', null],
      ['a numeric string', '500'],
      ['a non-numeric string', 'abc'],
      ['an object', {}],
    ])('throws on a gross weight that is %s', (_label, gross) => {
      expect(() => computeNet(gross, null)).toThrow(ValidationError);
    });

    it('flags a bad gross weight with a specific error code', () => {
      expect(() => computeNet(NaN, null)).toThrow(
        expect.objectContaining({ code: 'INVALID_GROSS_WEIGHT', field: 'grossG' }),
      );
    });

    // A container object with no usable weight is a data defect in the container
    // table. Coercing it to a 0 tare would silently log the container's weight as food.
    it.each([
      ['missing grams', {}],
      ['a null grams', { grams: null }],
      ['a non-numeric grams', { grams: 'heavy' }],
      ['a NaN grams', { grams: NaN }],
      ['a negative grams', { grams: -10 }],
    ])('throws on a container with %s', (_label, container) => {
      expect(() => computeNet(500, container)).toThrow(ValidationError);
    });

    it('flags a bad container tare with a specific error code', () => {
      expect(() => computeNet(500, { grams: undefined })).toThrow(
        expect.objectContaining({ code: 'INVALID_CONTAINER_TARE' }),
      );
    });
  });
});

describe('computeNutrition', () => {
  it('derives calories and macro grams from percent-of-calories', () => {
    const r = computeNutrition(200, LEVEL_4);
    expect(r.calories).toBe(280);                 // 200 * 1.4
    expect(r.fat_g).toBeCloseTo(9.33, 2);         // 280 * .30 / 9
    expect(r.carb_g).toBeCloseTo(31.5, 2);        // 280 * .45 / 4
    expect(r.protein_g).toBeCloseTo(17.5, 2);     // 280 * .25 / 4
  });

  it('scales per-100g nutrients by net weight', () => {
    const r = computeNutrition(200, LEVEL_4);
    expect(r.fiber_g).toBeCloseTo(4, 2);
    expect(r.sugar_g).toBeCloseTo(10, 2);
    expect(r.sodium_mg).toBeCloseTo(600, 2);
  });

  it('returns zeros for a zero net weight', () => {
    expect(computeNutrition(0, LEVEL_4).calories).toBe(0);
  });

  it('returns zeros across every nutrient for a zero net weight', () => {
    const r = computeNutrition(0, LEVEL_4);
    expect(r).toEqual({
      calories: 0, fat_g: 0, carb_g: 0, protein_g: 0,
      fiber_g: 0, sugar_g: 0, sodium_mg: 0,
    });
  });

  // The point of storing macros as percent-of-calories: the derived grams must
  // burn back to exactly the calorie figure. This is what makes a table typo a
  // schema failure (Task 4) instead of a level whose macros contradict its calories.
  it('derives macro grams that reconcile to the calorie total', () => {
    const r = computeNutrition(200, LEVEL_4);
    expect(r.fat_g * 9 + r.carb_g * 4 + r.protein_g * 4).toBeCloseTo(r.calories, 6);
  });

  it('reconciles at every density level in a representative table', () => {
    const levels = [
      { kcal_per_g: 0.2, macros: { fat_pct: 5, carb_pct: 75, protein_pct: 20 } },
      { kcal_per_g: 2.5, macros: { fat_pct: 50, carb_pct: 20, protein_pct: 30 } },
      { kcal_per_g: 8.5, macros: { fat_pct: 98, carb_pct: 1, protein_pct: 1 } },
    ];
    for (const level of levels) {
      const r = computeNutrition(137, level);
      expect(r.fat_g * 9 + r.carb_g * 4 + r.protein_g * 4).toBeCloseTo(r.calories, 6);
    }
  });

  // 10 * 1.45 = 14.5 — chosen so rounding up is distinguishable from truncation.
  it('rounds calories to the nearest whole number rather than truncating', () => {
    expect(computeNutrition(10, { ...LEVEL_4, kcal_per_g: 1.45 })).toMatchObject({ calories: 15 });
  });

  it('scales linearly with net weight', () => {
    const single = computeNutrition(100, LEVEL_4);
    const double = computeNutrition(200, LEVEL_4);
    expect(double.calories).toBe(single.calories * 2);
    expect(double.sodium_mg).toBeCloseTo(single.sodium_mg * 2, 6);
  });

  // per_100g carries secondary nutrients only; absent means "none recorded", and a
  // zero there cannot fabricate calories the way a zeroed macro split would.
  it('treats a missing per_100g block as zero secondary nutrients', () => {
    const r = computeNutrition(200, { kcal_per_g: 1.4, macros: LEVEL_4.macros });
    expect(r.calories).toBe(280);
    expect(r).toMatchObject({ fiber_g: 0, sugar_g: 0, sodium_mg: 0 });
  });

  it('fills in only the absent fields of a partial per_100g block', () => {
    const r = computeNutrition(200, { ...LEVEL_4, per_100g: { sodium_mg: 300 } });
    expect(r).toMatchObject({ fiber_g: 0, sugar_g: 0 });
    expect(r.sodium_mg).toBeCloseTo(600, 2);
  });

  describe('rejects unusable input rather than coercing it', () => {
    it.each([
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['undefined', undefined],
      ['null', null],
      ['a numeric string', '200'],
    ])('throws on a net weight that is %s', (_label, netG) => {
      expect(() => computeNutrition(netG, LEVEL_4)).toThrow(ValidationError);
    });

    // computeNet already clamps, so a negative arriving here means the caller
    // bypassed it. Swallowing that to 0 would hide the bug behind a plausible entry.
    it('throws on a negative net weight', () => {
      expect(() => computeNutrition(-1, LEVEL_4)).toThrow(ValidationError);
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['a non-object', 4],
    ])('throws on a level that is %s', (_label, level) => {
      expect(() => computeNutrition(200, level)).toThrow(ValidationError);
    });

    it.each([
      ['missing kcal_per_g', { macros: LEVEL_4.macros }],
      ['a non-numeric kcal_per_g', { kcal_per_g: 'high', macros: LEVEL_4.macros }],
      ['a negative kcal_per_g', { kcal_per_g: -1, macros: LEVEL_4.macros }],
    ])('throws on a level with %s', (_label, level) => {
      expect(() => computeNutrition(200, level)).toThrow(ValidationError);
    });

    // A level with no usable macro split would yield calories with zero macros —
    // exactly the self-contradiction the percent-of-calories design rules out.
    it.each([
      ['no macros block', { kcal_per_g: 1.4 }],
      ['a null macros block', { kcal_per_g: 1.4, macros: null }],
      ['a missing fat_pct', { kcal_per_g: 1.4, macros: { carb_pct: 45, protein_pct: 25 } }],
      ['a non-numeric carb_pct', { kcal_per_g: 1.4, macros: { fat_pct: 30, carb_pct: '45', protein_pct: 25 } }],
      ['a negative protein_pct', { kcal_per_g: 1.4, macros: { fat_pct: 30, carb_pct: 45, protein_pct: -25 } }],
    ])('throws on a level with %s', (_label, level) => {
      expect(() => computeNutrition(200, level)).toThrow(ValidationError);
    });

    it('throws on a per_100g field that is present but not a number', () => {
      expect(() => computeNutrition(200, { ...LEVEL_4, per_100g: { fiber_g: 'lots' } }))
        .toThrow(ValidationError);
    });

    // An array would otherwise slip past a bare `typeof === 'object'` check and
    // read as a block whose every field is absent, i.e. silent zeros.
    it('throws on a per_100g that is an array', () => {
      expect(() => computeNutrition(200, { ...LEVEL_4, per_100g: [] })).toThrow(ValidationError);
    });
  });

  // Whether the macro percentages sum to 100 is the config schema's job (Task 4).
  // This module derives grams from whatever split it is handed; duplicating the
  // sum check here would let the two definitions drift.
  it('does not second-guess a macro split that fails to sum to 100', () => {
    const r = computeNutrition(200, { kcal_per_g: 1.4, macros: { fat_pct: 10, carb_pct: 10, protein_pct: 10 } });
    expect(r.calories).toBe(280);
    expect(r.fat_g).toBeCloseTo(280 * 0.1 / 9, 6);
  });
});
