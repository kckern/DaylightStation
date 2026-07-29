import { describe, it, expect } from 'vitest';
import { normalizeScaleNutribotConfig } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';

describe('normalizeScaleNutribotConfig — density macros', () => {
  it('carries macros and per_100g through to the normalized level', () => {
    const cfg = normalizeScaleNutribotConfig({
      nutribot: {
        density_levels: [{
          level: 1, label: 'Watery', emoji: '🥬', kcal_per_g: 0.2,
          macros: { fat_pct: 10, carb_pct: 70, protein_pct: 20 },
          per_100g: { fiber_g: 2, sugar_g: 3, sodium_mg: 40 },
        }],
      },
    });

    expect(cfg.densityLevels[0].macros).toEqual({ fat_pct: 10, carb_pct: 70, protein_pct: 20 });
    expect(cfg.densityLevels[0].per_100g).toEqual({ fiber_g: 2, sugar_g: 3, sodium_mg: 40 });
  });

  it('leaves macros absent when the row omits them, rather than fabricating a split', () => {
    const cfg = normalizeScaleNutribotConfig({
      nutribot: { density_levels: [{ level: 1, kcal_per_g: 0.2 }] },
    });
    expect(cfg.densityLevels[0].macros).toBeUndefined();
  });
});

// Both mappers rebuild each row from an explicit field list, so a field nobody
// listed is silently dropped. That bit twice — density icons, then container icons
// — and each time the symptom was a printed sheet with blank spaces where the
// pictures should be, with no error anywhere. This pins the passthrough.
describe('normalizeScaleNutribotConfig — icon passthrough', () => {
  it('preserves icon on density levels', () => {
    const cfg = normalizeScaleNutribotConfig({
      nutribot: { density_levels: [{ level: 1, label: 'Watery', kcal_per_g: 0.2, icon: 'food/lettuce' }] },
    });
    expect(cfg.densityLevels[0].icon).toBe('food/lettuce');
  });

  it('preserves icon on containers', () => {
    const cfg = normalizeScaleNutribotConfig({
      nutribot: { containers: { items: [{ id: 'mug', label: 'Mug', grams: 350, icon: 'vessel/cup-handle' }] } },
    });
    expect(cfg.containers.items[0].icon).toBe('vessel/cup-handle');
  });

  it('yields null rather than undefined when no icon is configured', () => {
    const cfg = normalizeScaleNutribotConfig({
      nutribot: {
        density_levels: [{ level: 1, label: 'W', kcal_per_g: 0.2 }],
        containers: { items: [{ id: 'mug', label: 'Mug', grams: 350 }] },
      },
    });
    expect(cfg.densityLevels[0].icon).toBeNull();
    expect(cfg.containers.items[0].icon).toBeNull();
  });
});
