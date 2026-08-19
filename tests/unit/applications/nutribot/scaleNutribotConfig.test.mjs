import { describe, it, expect } from 'vitest';
import { normalizeScaleNutribotConfig, DEFAULT_DENSITY_LEVELS } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';

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

  // Superseded by the "macros backfill" describe block below: omitting macros
  // for a level the code defaults DO cover now borrows that level's split
  // instead of leaving it absent — that silent-absence behavior is exactly
  // what let an icon-only override disable the whole scan feature. This case
  // now pins the backfill instead of the old omission.
  it('backfills macros from the code default when the row omits them for a known level', () => {
    const cfg = normalizeScaleNutribotConfig({
      nutribot: { density_levels: [{ level: 1, kcal_per_g: 0.2 }] },
    });
    expect(cfg.densityLevels[0].macros).toEqual(
      DEFAULT_DENSITY_LEVELS.find((d) => d.level === 1).macros,
    );
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

describe('normalizeScaleNutribotConfig — macros backfill', () => {
  // Attaching a cosmetic field must never cost a required one. The live
  // scales.yml overrode this table purely to add `icon:` and dropped `macros`,
  // which disabled every ct:/dl:/rs: scan in the house for weeks.
  it('fills macros from the code defaults when a row omits them', () => {
    const cfg = normalizeScaleNutribotConfig({
      nutribot: {
        density_levels: [
          { level: 4, label: 'Mixed', kcal_per_g: 1.4, icon: 'food/rice-bowl' },
        ],
      },
    });
    const row = cfg.densityLevels.find((r) => r.level === 4);
    expect(row.icon).toBe('food/rice-bowl');
    expect(row.macros).toEqual(
      DEFAULT_DENSITY_LEVELS.find((d) => d.level === 4).macros,
    );
  });

  it('leaves explicit macros alone', () => {
    const macros = { fat_pct: 50, carb_pct: 30, protein_pct: 20 };
    const cfg = normalizeScaleNutribotConfig({
      nutribot: { density_levels: [{ level: 4, label: 'Mixed', kcal_per_g: 1.4, macros }] },
    });
    expect(cfg.densityLevels.find((r) => r.level === 4).macros).toEqual(macros);
  });

  // A level with no default to borrow from must still fail loudly downstream
  // rather than be invented.
  it('does not invent macros for a level the defaults do not have', () => {
    const cfg = normalizeScaleNutribotConfig({
      nutribot: { density_levels: [{ level: 42, label: 'Odd', kcal_per_g: 2.0 }] },
    });
    expect(cfg.densityLevels.find((r) => r.level === 42).macros).toBeUndefined();
  });
});
