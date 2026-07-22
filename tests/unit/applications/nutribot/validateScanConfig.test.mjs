import { describe, it, expect } from 'vitest';
import { validateScanConfig } from '#apps/nutribot/lib/validateScanConfig.mjs';
import { DEFAULT_CONTAINERS, DEFAULT_DENSITY_LEVELS } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';
import { MAX_DENSITY_LEVEL } from '#domains/nutrition/index.mjs';

const level = (n, over = {}) => ({
  level: n, label: `L${n}`, emoji: '🍽', kcal_per_g: 1,
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

  it('rejects a container id the encoder cannot print', () => {
    expect(() => validateScanConfig({
      densityLevels: full(),
      containers: { items: [{ id: 'Dinner Bowl', grams: 250 }] },
    })).toThrow(/Dinner Bowl/);
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
