// tests/unit/domains/nutrition/value-objects/compositionUnitGate.test.mjs
import { describe, it, expect } from 'vitest';
import { Composition } from '#domains/nutrition/index.mjs';

describe('Composition — unit gate', () => {
  it('is complete for grams plus a density', () => {
    const c = Composition.empty().withWeight({ grams: 413, unit: 'g' }).withDensity(4);
    expect(c.isComplete).toBe(true);
  });

  // A volume cannot be multiplied by kcal-per-GRAM. A wrong entry that
  // auto-commits is worse than no entry, and quiet-commit makes it commit.
  it('is NOT complete for millilitres, however much else is scanned', () => {
    const c = Composition.empty().withWeight({ grams: 240, unit: 'ml' }).withDensity(4);
    expect(c.isComplete).toBe(false);
  });

  it('is complete when unit is omitted (grams is the default contract)', () => {
    const c = Composition.empty().withWeight({ grams: 100 }).withDensity(2);
    expect(c.isComplete).toBe(true);
  });
});
