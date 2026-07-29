// @vitest-environment node
/**
 * The anti-drift suite.
 *
 * Every code a provider emits is fed straight back through `parseScan`. If one of
 * these fails, a sheet would have been printed, laminated, and stuck on a fridge
 * carrying a QR that resolves to nothing — a failure with no error anywhere, only
 * a scan that does nothing. That is the single defect this whole seam exists to
 * make impossible, so the round-trip is asserted for the hand-built fixture AND
 * for the real default tables that ship in code.
 */
import { describe, it, expect } from 'vitest';
import { parseScan, CONTROL_VERBS } from '#domains/nutrition/services/ScanVocabularyService.mjs';
import { normalizeScaleNutribotConfig } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';
import { createNutritionProviders } from './sheetProviders.mjs';

/** Normalized-config shape, hand-built so a change to the defaults cannot mask a bug here. */
const FIXTURE = {
  densityLevels: [
    { level: 2, label: 'Light', emoji: '🥗', kcal_per_g: 0.6, hint: 'salad, fruit' },
    { level: 7, label: 'Rich', emoji: '🧀', kcal_per_g: 3.8, hint: 'cheese, creamy' },
  ],
  containers: {
    thresholdG: 150,
    items: [
      { id: 'dinner-bowl', label: 'Dinner bowl', emoji: '🥣', grams: 250 },
      { id: 'mug', label: 'Mug', emoji: '☕', grams: 350 },
    ],
  },
  foods: [
    { id: 'banana', label: 'Banana', sublabel: '~120 g' },
    { id: 'egg', label: 'Egg' },
  ],
};

const providersFor = (cfg) => createNutritionProviders({ getScaleConfig: () => cfg });

describe('nutrition sheet providers — anti-drift round-trip', () => {
  const codeEmitting = ['nutrition.density', 'nutrition.containers', 'nutrition.controls'];

  it('every emitted code parses back to a command (fixture config)', () => {
    const providers = providersFor(FIXTURE);
    for (const id of codeEmitting) {
      const items = providers[id]();
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(typeof item.code).toBe('string');
        expect(parseScan(item.code), `${id} emitted an unparseable code ${item.code}`).not.toBeNull();
      }
    }
  });

  it('every emitted code parses back to a command (REAL default config)', () => {
    // normalizeScaleNutribotConfig({}) falls back to DEFAULT_DENSITY_LEVELS /
    // DEFAULT_CONTAINERS — the tables that would actually reach a printer.
    const providers = providersFor(normalizeScaleNutribotConfig({}));
    for (const id of codeEmitting) {
      const items = providers[id]();
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(parseScan(item.code), `${id} default table emitted ${item.code}`).not.toBeNull();
      }
    }
    // The default tables are the shipped ones; pin their size so a truncated
    // table shows up here rather than as a sheet with missing buttons.
    expect(providers['nutrition.density']()).toHaveLength(9);
    expect(providers['nutrition.containers']()).toHaveLength(4);
  });

  it('a density code resolves to the level the item claims', () => {
    for (const cfg of [FIXTURE, normalizeScaleNutribotConfig({})]) {
      for (const item of providersFor(cfg)['nutrition.density']()) {
        expect(parseScan(item.code)).toEqual({ kind: 'density', level: item.meta.level });
      }
    }
  });

  it('a container code resolves to the id the item claims', () => {
    for (const cfg of [FIXTURE, normalizeScaleNutribotConfig({})]) {
      for (const item of providersFor(cfg)['nutrition.containers']()) {
        expect(parseScan(item.code)).toEqual({ kind: 'container', id: item.meta.id });
      }
    }
  });

  it('a control code resolves to the verb kind — clear parses to "reset", not "clear"', () => {
    // Asserting the REAL mapping, not the identity: `clear` is deliberately
    // asymmetric (ApplyScanToComposition switches on kind 'reset'), and a
    // provider that assumed identity would print a dead reset button.
    const expectedKind = { clear: 'reset', undo: 'undo', done: 'done' };
    for (const item of providersFor(FIXTURE)['nutrition.controls']()) {
      expect(parseScan(item.code)).toEqual({ kind: expectedKind[item.meta.verb] });
    }
  });

  it('food items carry NO code property at all', () => {
    // No `fd:` grammar exists. A code here — even '' or null — would be an
    // unparseable payload on a laminated sheet. `kind: label` renders these.
    for (const item of providersFor(FIXTURE)['nutrition.foods']()) {
      expect(Object.prototype.hasOwnProperty.call(item, 'code')).toBe(false);
      expect('code' in item).toBe(false);
      expect(item.label).toBeTruthy();
    }
  });
});

describe('nutrition sheet providers — content', () => {
  it('density items read like the Telegram keyboard: config label + kcal/g', () => {
    const items = providersFor(FIXTURE)['nutrition.density']();
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      code: 'dl:2',
      label: 'Light',
      sublabel: '0.6 kcal/g',
      meta: { level: 2 },
    });
    expect(items[1]).toMatchObject({ code: 'dl:7', label: 'Rich', sublabel: '3.8 kcal/g' });
  });

  it('container items carry the config label and their tare weight', () => {
    const items = providersFor(FIXTURE)['nutrition.containers']();
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      code: 'ct:dinner-bowl',
      label: 'Dinner bowl',
      sublabel: '250 g',
      meta: { id: 'dinner-bowl' },
    });
    expect(items[1].code).toBe('ct:mug');
  });

  it('controls are derived from CONTROL_VERBS, not a hardcoded list', () => {
    const items = providersFor(FIXTURE)['nutrition.controls']();
    expect(items).toHaveLength(CONTROL_VERBS.length);
    expect(items.map((i) => i.meta.verb)).toEqual([...CONTROL_VERBS]);
    expect(items.map((i) => i.code)).toEqual(['rs:clear', 'rs:undo', 'rs:done']);
    // A human word plus a hint about what it does to the scan SEQUENCE.
    expect(items.map((i) => i.label)).toEqual(['Clear', 'Undo', 'Done']);
    for (const item of items) expect(item.sublabel).toBeTruthy();
  });

  it('controls do not depend on the scale config at all', () => {
    // They are grammar, not configuration — an empty config still prints them.
    expect(providersFor({})['nutrition.controls']()).toHaveLength(CONTROL_VERBS.length);
  });

  it('food items are label + sublabel from config', () => {
    const items = providersFor(FIXTURE)['nutrition.foods']();
    expect(items).toEqual([
      { label: 'Banana', sublabel: '~120 g', meta: { id: 'banana' } },
      { label: 'Egg', meta: { id: 'egg' } },
    ]);
  });
});

describe('nutrition sheet providers — missing config', () => {
  it('empty sections yield [] rather than throwing', () => {
    const providers = providersFor({ densityLevels: [], containers: { items: [] }, foods: [] });
    expect(providers['nutrition.density']()).toEqual([]);
    expect(providers['nutrition.containers']()).toEqual([]);
    expect(providers['nutrition.foods']()).toEqual([]);
  });

  it('absent sections yield [] rather than throwing', () => {
    // A block that renders empty is a visible hole on the sheet; a thrown error
    // at generation time would take the whole PDF down over an optional block.
    const providers = providersFor({});
    for (const id of ['nutrition.density', 'nutrition.containers', 'nutrition.foods']) {
      expect(() => providers[id]()).not.toThrow();
      expect(providers[id]()).toEqual([]);
    }
  });

  it('a config with no foods key still renders the block empty', () => {
    // normalizeScaleNutribotConfig defaults `foods` to [] — the fridge sheet ships
    // before anyone has written a food list.
    const providers = providersFor(normalizeScaleNutribotConfig({}));
    expect(providers['nutrition.foods']()).toEqual([]);
  });
});

describe('nutrition sheet providers — unprintable config fails loudly', () => {
  it('a density level outside the grammar throws instead of being dropped', () => {
    // Silently skipping the row would punch a hole in a laminated sheet.
    const providers = providersFor({ densityLevels: [{ level: 42, label: 'Nope', kcal_per_g: 1 }] });
    expect(() => providers['nutrition.density']()).toThrow(/Density level/);
  });

  it('a container id the parser would reject throws instead of being dropped', () => {
    const providers = providersFor({ containers: { items: [{ id: 'Big Bowl', label: 'Big bowl', grams: 1 }] } });
    expect(() => providers['nutrition.containers']()).toThrow(/Container id/);
  });
});
