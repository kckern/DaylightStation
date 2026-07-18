import { describe, it, expect } from '@jest/globals';
import {
  normalizeScaleNutribotConfig,
  densityForLevel,
  buildDensityKeyboard,
  buildContainerKeyboard,
  buildConfirmButtons,
  densityPromptText,
  densityHelpText,
} from '#apps/nutribot/lib/scaleNutribotConfig.mjs';

describe('scaleNutribotConfig', () => {
  it('supplies defaults when the nutribot block is absent', () => {
    const cfg = normalizeScaleNutribotConfig({});
    expect(cfg.minGrams).toBe(5);
    expect(cfg.containers.thresholdG).toBe(150);
    expect(cfg.containers.items.length).toBeGreaterThan(0);
    expect(cfg.densityLevels).toHaveLength(9);
    expect(cfg.densityLevels[3]).toMatchObject({ level: 4, label: 'Mixed', kcal_per_g: 1.4 });
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
    expect(densityForLevel(cfg, 9)).toMatchObject({ label: 'Oil', kcal_per_g: 8.5 });
    expect(densityForLevel(cfg, 99)).toBeNull();
  });

  it('buildDensityKeyboard encodes sd callbacks with level + a container affordance', () => {
    const cfg = normalizeScaleNutribotConfig({});
    const enc = (cmd, data) => JSON.stringify({ cmd, ...data });
    const kb = buildDensityKeyboard(cfg, enc, 'log123');
    const decoded = kb.flat().map((b) => JSON.parse(b.callback_data));
    const sd = decoded.filter((d) => d.cmd === 'sd');
    expect(sd).toHaveLength(9);
    expect(sd[0]).toMatchObject({ cmd: 'sd', id: 'log123', l: 1 });
    // container affordance: 'st' with no container id = show the picker
    const affordance = decoded.find((d) => d.cmd === 'st');
    expect(affordance).toMatchObject({ cmd: 'st', id: 'log123' });
    expect(affordance.c).toBeUndefined();
  });

  it('buildContainerKeyboard puts None first and encodes st callbacks', () => {
    const cfg = normalizeScaleNutribotConfig({});
    const enc = (cmd, data) => JSON.stringify({ cmd, ...data });
    const kb = buildContainerKeyboard(cfg, enc, 'log123');
    expect(JSON.parse(kb[0][0].callback_data)).toMatchObject({ cmd: 'st', id: 'log123', c: 'none' });
    const encoded = kb.flat().map((b) => JSON.parse(b.callback_data));
    expect(encoded.some((e) => e.c === 'dinner-plate')).toBe(true);
    // button text = emoji + label, no tare number in the UI (grams resolved server-side from c.id)
    const plate = kb.flat().find((b) => JSON.parse(b.callback_data).c === 'dinner-plate');
    expect(plate.text).toBe('🍽 Dinner plate');
    expect(plate.text).not.toMatch(/\d/);
  });

  it('buildConfirmButtons emits accept/revise/discard', () => {
    const enc = (cmd, data) => JSON.stringify({ cmd, ...data });
    const rows = buildConfirmButtons(enc, 'log123');
    const cmds = rows.flat().map((b) => JSON.parse(b.callback_data).cmd);
    expect(cmds).toEqual(['a', 'r', 'x']);
  });

  it('normalizes dedupDeltaG and per-level hint with defaults', () => {
    const cfg = normalizeScaleNutribotConfig({});
    expect(cfg.dedupDeltaG).toBe(5);
    expect(cfg.densityLevels[0]).toMatchObject({ level: 1, hint: expect.any(String) });
    expect(cfg.densityLevels[0].hint.length).toBeGreaterThan(0);

    const overridden = normalizeScaleNutribotConfig({ nutribot: { dedup_delta_g: 10 } });
    expect(overridden.dedupDeltaG).toBe(10);
  });

  it('normalizes baseline/placement/dedup knobs with defaults (no expiry knob)', () => {
    const cfg = normalizeScaleNutribotConfig({});
    expect(cfg.baselineToleranceG).toBe(6);
    expect(cfg.placementDeltaG).toBe(10);
    expect(cfg.expireMs).toBeUndefined(); // weights never expire
    const o = normalizeScaleNutribotConfig({ nutribot: { baseline_tolerance_g: 8, placement_delta_g: 15, dedup_delta_g: 4 } });
    expect(o).toMatchObject({ baselineToleranceG: 8, placementDeltaG: 15, dedupDeltaG: 4 });
  });

  it('normalizes suspicion/force knobs with defaults', () => {
    const cfg = normalizeScaleNutribotConfig({});
    expect(cfg).toMatchObject({
      storageWeightG: 0,
      storageToleranceG: 15,
      suspicionWindowSec: 90,
      stormMinPushes: 2,
      heavyG: 300,
      forceToleranceG: 10,
    });
    const o = normalizeScaleNutribotConfig({
      nutribot: {
        storage_weight_g: 430, storage_tolerance_g: 20, suspicion_window_sec: 120,
        storm_min_pushes: 3, heavy_g: 250, force_tolerance_g: 8,
      },
    });
    expect(o).toMatchObject({
      storageWeightG: 430, storageToleranceG: 20, suspicionWindowSec: 120,
      stormMinPushes: 3, heavyG: 250, forceToleranceG: 8,
    });
  });

  it('buildDensityKeyboard lays out a 3x3 grid + a control row', () => {
    const cfg = normalizeScaleNutribotConfig({});
    const enc = (cmd, data) => JSON.stringify({ cmd, ...data });
    const kb = buildDensityKeyboard(cfg, enc, 'log123');
    // 3 density rows of 3, then 1 control row
    expect(kb).toHaveLength(4);
    expect(kb[0]).toHaveLength(3);
    expect(kb[1]).toHaveLength(3);
    expect(kb[2]).toHaveLength(3);
    expect(kb[3]).toHaveLength(3);
    // density button text = "<emoji> <label>" (no number; level rides in the payload)
    expect(kb[0][0].text).toBe('🥬 Watery');
    expect(JSON.parse(kb[0][0].callback_data)).toMatchObject({ cmd: 'sd', l: 1 }); // number stays in payload
    // control row callbacks: container (st), help (sh h:1), cancel (x)
    const ctrl = kb[3].map((b) => JSON.parse(b.callback_data));
    expect(ctrl[0]).toMatchObject({ cmd: 'st', id: 'log123' });
    expect(ctrl[1]).toMatchObject({ cmd: 'sh', id: 'log123', h: 1 });
    expect(ctrl[2]).toMatchObject({ cmd: 'x', id: 'log123' });
  });

  it('buildDensityKeyboard swaps Help for Back when showingHelp', () => {
    const cfg = normalizeScaleNutribotConfig({});
    const enc = (cmd, data) => JSON.stringify({ cmd, ...data });
    const kb = buildDensityKeyboard(cfg, enc, 'log123', { showingHelp: true });
    const help = JSON.parse(kb[3][1].callback_data);
    expect(kb[3][1].text).toBe('⬅️ Back');
    expect(help).toMatchObject({ cmd: 'sh', id: 'log123', h: 0 });
  });

  it('densityPromptText is slim; densityHelpText lists all levels', () => {
    const cfg = normalizeScaleNutribotConfig({});
    expect(densityPromptText(340)).toBe('⚖️ 340 g');
    const help = densityHelpText(cfg, 340);
    expect(help).toContain('340 g');
    expect(help).toContain('Watery');
    expect(help).toContain('Oil');
    expect(help.split('\n').filter((l) => /kcal\/g/.test(l))).toHaveLength(9);
  });
});
