import { describe, it, expect } from 'vitest';
import {
  normalizeScaleNutribotConfig,
  DEFAULT_DENSITY_LEVELS,
  MIN_COMMIT_QUIET_SEC,
} from '#apps/nutribot/lib/scaleNutribotConfig.mjs';

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

  // Restores the intent of the original "leaves macros absent... rather than
  // fabricating a split" case: that objection is upheld, just not by leaving
  // macros undefined. A level the code defaults DO cover now borrows that
  // level's split AND says so — the fabrication itself is fine, doing it
  // silently is what let an icon-only override disable the whole scan
  // feature without a trace.
  it('backfills a missing macros split, and says so rather than doing it silently', () => {
    const warns = [];
    const logger = { warn: (e, d) => warns.push([e, d]) };
    const cfg = normalizeScaleNutribotConfig(
      { nutribot: { density_levels: [{ level: 1, kcal_per_g: 0.2 }] } },
      { logger },
    );
    expect(cfg.densityLevels[0].macros).toEqual(
      DEFAULT_DENSITY_LEVELS.find((d) => d.level === 1).macros,
    );
    expect(warns).toEqual([
      ['nutriscan.macros.backfilled', { level: 1, source: 'DEFAULT_DENSITY_LEVELS' }],
    ]);
  });

  it('does not warn when the row already supplies macros', () => {
    const warns = [];
    const logger = { warn: (e, d) => warns.push([e, d]) };
    normalizeScaleNutribotConfig(
      {
        nutribot: {
          density_levels: [{
            level: 1, kcal_per_g: 0.2,
            macros: { fat_pct: 10, carb_pct: 70, protein_pct: 20 },
          }],
        },
      },
      { logger },
    );
    expect(warns).toEqual([]);
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

// The quiet-commit interval — how long the bridge waits for the composition to
// stop growing before it finalises the entry. It reached `app.mjs` as
// `scaleConfig.commitQuietSec` while the normalizer emitted no such key, so the
// caller's `?? 25` always won and the documented `commit_quiet_sec:` knob did
// nothing at all. A config field the docs advertise and the code ignores is
// worse than no field.
describe('normalizeScaleNutribotConfig — commit_quiet_sec', () => {
  it('defaults to 25 seconds when the block says nothing', () => {
    expect(normalizeScaleNutribotConfig({}).commitQuietSec).toBe(25);
    expect(normalizeScaleNutribotConfig({ nutribot: {} }).commitQuietSec).toBe(25);
  });

  it('carries a configured value through', () => {
    expect(normalizeScaleNutribotConfig({ nutribot: { commit_quiet_sec: 40 } }).commitQuietSec).toBe(40);
  });

  // Same `num()` treatment as every neighbouring knob: a value YAML parsed as a
  // string is still a number, and unusable text falls back rather than poisoning
  // the timer with NaN (which would disable quiet-commit outright, silently).
  it('coerces a numeric string and falls back on unusable text', () => {
    expect(normalizeScaleNutribotConfig({ nutribot: { commit_quiet_sec: '40' } }).commitQuietSec).toBe(40);
    expect(normalizeScaleNutribotConfig({ nutribot: { commit_quiet_sec: 'soon' } }).commitQuietSec).toBe(25);
  });

  // `num()` accepts any FINITE number, and the two it happily let through each
  // changed the product rather than the timing: a negative fires the timer
  // immediately (commit-on-sufficiency, the design this feature explicitly
  // rejects — the 12:31 incident's container scan landed 4.4 s behind its
  // density), and `0` is falsy, so the bridge's `if (!commitQuietMs) return`
  // disabled quiet-commit outright with nothing anywhere saying so.
  it('clamps a zero or negative interval to the floor rather than changing the feature', () => {
    expect(MIN_COMMIT_QUIET_SEC).toBe(5);
    for (const bad of [0, -5, -0.1, '-5']) {
      expect(normalizeScaleNutribotConfig({ nutribot: { commit_quiet_sec: bad } }).commitQuietSec)
        .toBe(MIN_COMMIT_QUIET_SEC);
    }
    // The floor is a floor, not a replacement: anything above it is untouched.
    expect(normalizeScaleNutribotConfig({ nutribot: { commit_quiet_sec: 6 } }).commitQuietSec).toBe(6);
  });
});
