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
