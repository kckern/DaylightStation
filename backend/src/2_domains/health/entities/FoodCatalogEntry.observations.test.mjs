import { describe, it, expect } from 'vitest';
import { FoodCatalogEntry } from './FoodCatalogEntry.mjs';

const make = (over = {}) => new FoodCatalogEntry({
  id: 'e1',
  name: 'Premier Protein Shake',
  nutrients: { calories: 610, protein: 66, carbs: 10, fat: 6 },
  lastUsed: '2026-08-19',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const bottle = (n, over = {}) => ({
  date: `2026-08-${String(n).padStart(2, '0')}`,
  kcal: 160, protein: 30, carbs: 5, fat: 3, grams: 330, logId: `r${n}`, ...over,
});

describe('FoodCatalogEntry.nutrients — derived, not stored', () => {
  it('falls back to the stored record when nothing has been observed', () => {
    // The absence rule (decision 2.6): an entry with no usable evidence keeps
    // working on whatever it already held. It must never become a zero.
    expect(make().nutrients).toEqual({ calories: 610, protein: 66, carbs: 10, fat: 6 });
  });

  it('returns the median-density serving once the ring has evidence', () => {
    const entry = make({ observations: [bottle(1), bottle(5), bottle(12, { kcal: 610, protein: 66, grams: 385 })] });
    expect(entry.nutrients.calories).toBe(160);
    expect(entry.canonicalGrams).toBe(330);
    expect(entry.densityKcalPerGram).toBeCloseTo(160 / 330, 6);
    expect(entry.observationSampleCount).toBe(3);
  });

  it('layers derived macros OVER the base record, so donated micros survive', () => {
    const entry = make({
      nutrients: { calories: 610, protein: 66, carbs: 10, fat: 6, sodium: 320, fiber: 2 },
      observations: [bottle(1), bottle(5), bottle(9)],
    });
    expect(entry.nutrients).toMatchObject({ calories: 160, sodium: 320, fiber: 2 });
  });
});

describe('FoodCatalogEntry.addObservation — the ring', () => {
  it('replaces by logId rather than appending, so a re-record is not a second row', () => {
    const entry = make();
    entry.addObservation(bottle(1));
    entry.addObservation(bottle(1));
    entry.addObservation({ ...bottle(1), kcal: 170 });
    expect(entry.observations).toHaveLength(1);
    expect(entry.observations[0].kcal).toBe(170);
  });

  it('keeps the newest 20 and drops the oldest, by (date, id)', () => {
    const entry = make();
    for (let i = 1; i <= 25; i++) entry.addObservation(bottle(i));
    expect(entry.observations).toHaveLength(20);
    expect(entry.observations[0].logId).toBe('r6');
    expect(entry.observations[19].logId).toBe('r25');
  });

  it('keeps the same twenty regardless of the order they arrived in', () => {
    const forwards = make();
    for (let i = 1; i <= 25; i++) forwards.addObservation(bottle(i));
    const backwards = make();
    for (let i = 25; i >= 1; i--) backwards.addObservation(bottle(i));
    expect(backwards.observations).toEqual(forwards.observations);
  });

  it('does not alias the caller\'s object', () => {
    const entry = make();
    const source = bottle(1);
    entry.addObservation(source);
    source.kcal = 9999;
    expect(entry.observations[0].kcal).toBe(160);
  });
});

describe('FoodCatalogEntry.setObservations — what the reconcile uses', () => {
  it('REPLACES the ring, so a rebuild from the same history is the same ring', () => {
    const entry = make({ observations: [bottle(1), bottle(2)] });
    entry.setObservations([bottle(7), bottle(8), bottle(9)]);
    expect(entry.observations.map((o) => o.logId)).toEqual(['r7', 'r8', 'r9']);
  });

  it('collapses duplicate ids in the input', () => {
    const entry = make();
    entry.setObservations([bottle(1), bottle(1), bottle(2)]);
    expect(entry.observations).toHaveLength(2);
  });
});

describe('FoodCatalogEntry.nutrientsForGrams — what quick-add scales by', () => {
  it('turns the bad 385 g portion into 187 kcal, not 610', () => {
    const entry = make({ observations: [bottle(1), bottle(5), bottle(9)] });
    expect(entry.nutrientsForGrams(385).calories).toBe(187);
  });

  it('is null — never zero — for an entry with no derivation', () => {
    expect(make().nutrientsForGrams(385)).toBeNull();
  });

  it('is null for a portion that is not a portion', () => {
    const entry = make({ observations: [bottle(1), bottle(5), bottle(9)] });
    expect(entry.nutrientsForGrams(0)).toBeNull();
    expect(entry.nutrientsForGrams(null)).toBeNull();
  });
});

describe('FoodCatalogEntry.donateMicros', () => {
  it('merges micros per key without touching the derived macros', () => {
    const entry = make({ observations: [bottle(1), bottle(5), bottle(9)] });
    entry.donateMicros({ sodium: 640 });
    expect(entry.nutrients.sodium).toBe(640);
    expect(entry.nutrients.calories).toBe(160);
    entry.donateMicros({ fiber: 3 });
    expect(entry.nutrients).toMatchObject({ sodium: 640, fiber: 3, calories: 160 });
  });
});
