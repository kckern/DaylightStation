import { describe, it, expect } from 'vitest';
import { validateScanConfig } from '#apps/nutribot/lib/validateScanConfig.mjs';
import { DEFAULT_CONTAINERS, DEFAULT_DENSITY_LEVELS } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';
import { MAX_DENSITY_LEVEL } from '#domains/nutrition/index.mjs';

// `kcal_per_g` VARIES BY RUNG on purpose. It used to be a constant 1 for every
// level, which was harmless while only `level` was validated — but the printed
// code is now round(kcal_per_g * 100), so a constant makes all nine rungs collide
// on `dl:100`. n/10 gives each rung a distinct printable code (dl:10 .. dl:90).
const level = (n, over = {}) => ({
  level: n, label: `L${n}`, emoji: '🍽', kcal_per_g: n / 10,
  macros: { fat_pct: 30, carb_pct: 50, protein_pct: 20 },
  ...over,
});
const full = () => Array.from({ length: MAX_DENSITY_LEVEL }, (_, i) => level(i + 1));

describe('validateScanConfig', () => {
  it('accepts a complete table', () => {
    expect(() => validateScanConfig({
      densityLevels: full(),
      containers: { items: [{ id: 'mug', label: 'Mug', emoji: '☕', grams: 350 }] },
    })).not.toThrow();
  });

  it('rejects macros that do not sum to 100', () => {
    const levels = full();
    levels[2].macros = { fat_pct: 30, carb_pct: 50, protein_pct: 30 };
    expect(() => validateScanConfig({ densityLevels: levels, containers: { items: [] } }))
      .toThrow(/level 3.*sum to 100/i);
  });

  // The printed payload is the TARE, so that is what has to be printable. An id
  // the old grammar would have rejected (`Dinner Bowl`) is now perfectly fine —
  // ids are never printed — and the check that matters is the weight.
  it('rejects a container tare the encoder cannot print', () => {
    expect(() => validateScanConfig({
      densityLevels: full(),
      containers: { items: [{ id: 'Dinner Bowl', grams: 50000 }] },
    })).toThrow(/Dinner Bowl.*unprintable tare/);
  });

  it('accepts a container id that the printed grammar would have rejected', () => {
    expect(() => validateScanConfig({
      densityLevels: full(),
      containers: { items: [{ id: 'Dinner Bowl', grams: 250 }] },
    })).not.toThrow();
  });

  // Equal tares are literally the same QR on two cards, and `containerForTare`
  // would resolve every scan of it to whichever row came first.
  it('rejects two containers that share a tare', () => {
    expect(() => validateScanConfig({
      densityLevels: full(),
      containers: { items: [{ id: 'mug', grams: 250 }, { id: 'bowl', grams: 250 }] },
    })).toThrow(/collide on printed code ct:250/);
  });

  // Same hazard on the density side: two rungs rounding to one code.
  it('rejects two density rungs that round to the same printed code', () => {
    const levels = full();
    levels[1].kcal_per_g = levels[0].kcal_per_g;
    expect(() => validateScanConfig({ densityLevels: levels, containers: { items: [] } }))
      .toThrow(/collide on printed code dl:/);
  });

  it('rejects a duplicate container id', () => {
    expect(() => validateScanConfig({
      densityLevels: full(),
      containers: { items: [{ id: 'mug', grams: 350 }, { id: 'mug', grams: 200 }] },
    })).toThrow(/duplicate.*mug/i);
  });

  it('rejects a level outside the grammar range', () => {
    expect(() => validateScanConfig({
      densityLevels: [...full(), level(MAX_DENSITY_LEVEL + 1)],
      containers: { items: [] },
    })).toThrow(/1-9/);
  });

  it('accepts the shipped default table', () => {
    expect(() => validateScanConfig({
      densityLevels: DEFAULT_DENSITY_LEVELS,
      containers: DEFAULT_CONTAINERS,
    })).not.toThrow();
  });
});
