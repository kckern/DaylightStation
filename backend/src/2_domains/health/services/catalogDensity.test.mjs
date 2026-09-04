import { describe, it, expect } from 'vitest';
import {
  usableGrams,
  observationFromRow,
  deriveCanonical,
  weightedMedian,
  ratioApart,
  sortObservations,
  MIN_MASS_G,
} from './catalogDensity.mjs';

const obs = (over) => ({ date: '2026-08-01', kcal: 160, grams: 330, logId: 'r', ...over });

describe('usableGrams — the mass, never the count wearing its clothes', () => {
  it('takes a real mass', () => {
    expect(usableGrams({ grams: 330, unit: 'g', amount: 330 })).toBe(330);
  });

  it('REFUSES the 1g that a "1 serving" row arrives with', () => {
    // YamlNutriListDatastore#normalizeItem fills grams from amount. A 610 kcal
    // "1 bottle" row therefore claims 1 gram, and reading that as a mass makes
    // the food 610 kcal/g — the single worst thing this module could do.
    expect(usableGrams({ grams: 1, unit: 'serving', amount: 1 })).toBeNull();
  });

  it('refuses a count that survived the minimum-mass floor', () => {
    // 12 "pieces" of something, no mass. Above MIN_MASS_G, so the floor alone
    // would let it through; the unit is what gives it away.
    expect(usableGrams({ grams: 12, unit: 'piece', amount: 12 })).toBeNull();
  });

  it('keeps a mass that HAPPENS to equal the amount when the unit is a mass unit', () => {
    // The text parser writes `amount: gramsRounded, unit: 'g'` all the time.
    expect(usableGrams({ grams: 120, unit: 'g', amount: 120 })).toBe(120);
    expect(usableGrams({ grams: 250, unit: 'ml', amount: 250 })).toBe(250);
  });

  it('refuses anything below the rounding floor', () => {
    expect(usableGrams({ grams: MIN_MASS_G - 1, unit: 'g', amount: 2 })).toBeNull();
    expect(usableGrams({ grams: 0, unit: 'g' })).toBeNull();
    expect(usableGrams({})).toBeNull();
  });
});

describe('observationFromRow', () => {
  it('drops a row with no calories — a zero-calorie group header is not evidence', () => {
    expect(observationFromRow({ calories: 0, grams: 300, unit: 'g' })).toBeNull();
  });

  it('drops a row with no usable mass', () => {
    expect(observationFromRow({ calories: 610, grams: 1, unit: 'serving', amount: 1 })).toBeNull();
  });

  it('copies ONLY the macros the row actually carries', () => {
    const o = observationFromRow({ calories: 160, protein: 30, grams: 330, unit: 'g', uuid: 'r1', date: '2026-08-01' });
    expect(o).toEqual({ date: '2026-08-01', kcal: 160, grams: 330, logId: 'r1', source: null, protein: 30 });
    expect('carbs' in o).toBe(false);
    expect('fat' in o).toBe(false);
  });

  it('falls back to createdAt for the day when the row has no date', () => {
    const o = observationFromRow({ calories: 160, grams: 330, unit: 'g', createdAt: '2026-07-04T18:00:00Z' });
    expect(o.date).toBe('2026-07-04');
  });
});

describe('weightedMedian', () => {
  it('is the plain median at equal weights', () => {
    expect(weightedMedian([3, 1, 2], [1, 1, 1])).toBe(2);
  });

  it('a heavy value pulls the median onto itself', () => {
    // One UPC reading (weight 3) against two guesses (weight 1 each).
    expect(weightedMedian([1, 2, 9], [1, 1, 3])).toBe(9);
    expect(weightedMedian([1, 2, 9], [1, 1, 1])).toBe(2);
  });

  it('returns null when nothing is weighable', () => {
    expect(weightedMedian([], [])).toBeNull();
  });
});

describe('deriveCanonical — the real Premier Protein Shake case', () => {
  // Half the rows are one bottle, half are two. Under "latest wins" the
  // catalog remembered whichever came last; the median density does not care.
  const ring = [
    obs({ date: '2026-08-01', kcal: 160, protein: 30, carbs: 5, fat: 3, grams: 330, logId: 'a' }),
    obs({ date: '2026-08-05', kcal: 320, protein: 60, carbs: 10, fat: 6, grams: 660, logId: 'b' }),
    obs({ date: '2026-08-12', kcal: 160, protein: 30, carbs: 5, fat: 3, grams: 330, logId: 'c' }),
    obs({ date: '2026-08-19', kcal: 610, protein: 66, carbs: 10, fat: 6, grams: 385, logId: 'd' }),
    obs({ date: '2026-08-25', kcal: 160, protein: 30, carbs: 5, fat: 3, grams: 330, logId: 'e' }),
  ];

  it('returns one bottle, not the last row logged', () => {
    const derived = deriveCanonical(ring);
    expect(derived.nutrients.calories).toBe(160);
    expect(derived.nutrients.protein).toBe(30);
    expect(derived.grams).toBe(330);
    expect(derived.sampleCount).toBe(5);
  });

  it('the 610/385 row moves neither median', () => {
    const without = deriveCanonical(ring.filter((o) => o.logId !== 'd'));
    expect(deriveCanonical(ring).nutrients).toEqual(without.nutrients);
  });

  it('scales the picked observation to the MEDIAN MASS, it does not just copy it', () => {
    // Only two-bottle rows: the median mass is 660, and the derived serving is
    // the doubled one. Nothing here invents a "half" — it reports what the
    // history actually says a serving of this name is.
    const doubles = [
      obs({ date: '2026-08-05', kcal: 320, protein: 60, grams: 660, logId: 'b' }),
      obs({ date: '2026-08-06', kcal: 320, protein: 60, grams: 660, logId: 'b2' }),
      obs({ date: '2026-08-07', kcal: 160, protein: 30, grams: 330, logId: 'a2' }),
    ];
    const derived = deriveCanonical(doubles);
    expect(derived.grams).toBe(660);
    expect(derived.nutrients.calories).toBe(320);
  });

  it('a UPC observation outweighs two model guesses about density', () => {
    const mixed = [
      obs({ date: '2026-08-01', kcal: 400, grams: 100, logId: 'g1' }),
      obs({ date: '2026-08-02', kcal: 380, grams: 100, logId: 'g2' }),
      obs({ date: '2026-08-03', kcal: 160, grams: 100, logId: 'u1', source: 'upc' }),
    ];
    expect(deriveCanonical(mixed).density).toBeCloseTo(1.6, 6);
    const unweighted = mixed.map((o) => ({ ...o, source: null }));
    expect(deriveCanonical(unweighted).density).toBeCloseTo(3.8, 6);
  });

  it('returns null — never a zero — when no observation carries a mass', () => {
    expect(deriveCanonical([])).toBeNull();
    expect(deriveCanonical([{ kcal: 610, grams: null }])).toBeNull();
    expect(deriveCanonical([{ kcal: 0, grams: 300 }])).toBeNull();
  });

  it('omits a macro the picked observation never carried, rather than writing 0', () => {
    const derived = deriveCanonical([obs({ kcal: 160, protein: 30, grams: 330, logId: 'x' })]);
    expect(derived.nutrients.protein).toBe(30);
    expect('carbs' in derived.nutrients).toBe(false);
    expect('fat' in derived.nutrients).toBe(false);
  });

  it('is a function of the SET, not of the arrival order', () => {
    const shuffled = [ring[3], ring[0], ring[4], ring[1], ring[2]];
    expect(deriveCanonical(shuffled)).toEqual(deriveCanonical(ring));
  });
});

describe('sortObservations', () => {
  it('orders by date then id — a total order, so two runs agree', () => {
    const sorted = sortObservations([
      obs({ date: '2026-08-02', logId: 'b' }),
      obs({ date: '2026-08-01', logId: 'z' }),
      obs({ date: '2026-08-02', logId: 'a' }),
    ]);
    expect(sorted.map((o) => o.logId)).toEqual(['z', 'a', 'b']);
  });
});

describe('ratioApart', () => {
  it('is symmetric and >= 1', () => {
    expect(ratioApart(610, 187)).toBeCloseTo(610 / 187, 6);
    expect(ratioApart(187, 610)).toBeCloseTo(610 / 187, 6);
  });

  it('is null when either side is unknown — "I could not tell" is not "they agree"', () => {
    expect(ratioApart(null, 100)).toBeNull();
    expect(ratioApart(100, 0)).toBeNull();
    expect(ratioApart(undefined, undefined)).toBeNull();
  });
});
