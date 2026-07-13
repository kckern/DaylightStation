import { describe, it, expect } from '@jest/globals';
import {
  normalizeScaleNutribotConfig,
  densityForLevel,
  buildDensityKeyboard,
  buildContainerKeyboard,
  buildConfirmButtons,
} from '#apps/nutribot/lib/scaleNutribotConfig.mjs';

describe('scaleNutribotConfig', () => {
  it('supplies defaults when the nutribot block is absent', () => {
    const cfg = normalizeScaleNutribotConfig({});
    expect(cfg.minGrams).toBe(5);
    expect(cfg.containers.thresholdG).toBe(150);
    expect(cfg.containers.items.length).toBeGreaterThan(0);
    expect(cfg.densityLevels).toHaveLength(9);
    expect(cfg.densityLevels[3]).toMatchObject({ level: 4, label: 'Everyday', kcal_per_g: 1.4 });
  });

  it('honours provided overrides', () => {
    const cfg = normalizeScaleNutribotConfig({
      nutribot: {
        min_grams: 10,
        containers: { threshold_g: 200, items: [{ id: 'plate', label: 'Plate', emoji: '🍽', grams: 300 }] },
        density_levels: [{ level: 1, label: 'Zero', emoji: '💧', kcal_per_g: 0 }],
      },
    });
    expect(cfg.minGrams).toBe(10);
    expect(cfg.containers.thresholdG).toBe(200);
    expect(cfg.containers.items).toHaveLength(1);
    expect(cfg.densityLevels).toHaveLength(1);
  });

  it('densityForLevel finds by ordinal', () => {
    const cfg = normalizeScaleNutribotConfig({});
    expect(densityForLevel(cfg, 9)).toMatchObject({ label: 'Pure fat', kcal_per_g: 8.5 });
    expect(densityForLevel(cfg, 99)).toBeNull();
  });

  it('buildDensityKeyboard encodes sd callbacks with level', () => {
    const cfg = normalizeScaleNutribotConfig({});
    const enc = (cmd, data) => JSON.stringify({ cmd, ...data });
    const kb = buildDensityKeyboard(cfg, enc, 'log123');
    const flat = kb.flat();
    expect(flat).toHaveLength(9);
    expect(JSON.parse(flat[0].callback_data)).toMatchObject({ cmd: 'sd', id: 'log123', l: 1 });
  });

  it('buildContainerKeyboard puts None first and encodes st callbacks', () => {
    const cfg = normalizeScaleNutribotConfig({});
    const enc = (cmd, data) => JSON.stringify({ cmd, ...data });
    const kb = buildContainerKeyboard(cfg, enc, 'log123');
    expect(JSON.parse(kb[0][0].callback_data)).toMatchObject({ cmd: 'st', id: 'log123', c: 'none' });
    const encoded = kb.flat().map((b) => JSON.parse(b.callback_data));
    expect(encoded.some((e) => e.c === 'dinner-plate')).toBe(true);
  });

  it('buildConfirmButtons emits accept/revise/discard', () => {
    const enc = (cmd, data) => JSON.stringify({ cmd, ...data });
    const rows = buildConfirmButtons(enc, 'log123');
    const cmds = rows.flat().map((b) => JSON.parse(b.callback_data).cmd);
    expect(cmds).toEqual(['a', 'r', 'x']);
  });
});
