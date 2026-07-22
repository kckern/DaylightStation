import { describe, it, expect, beforeEach } from 'vitest';
import { CompositionStore } from '#apps/nutribot/CompositionStore.mjs';
import { ApplyScanToComposition } from '#apps/nutribot/usecases/ApplyScanToComposition.mjs';

const CONFIG = {
  densityLevels: [
    { level: 1, label: 'Watery', emoji: '🥬', kcal_per_g: 0.2, macros: { fat_pct: 10, carb_pct: 70, protein_pct: 20 } },
    { level: 4, label: 'Mixed', emoji: '🍛', kcal_per_g: 1.4, macros: { fat_pct: 30, carb_pct: 50, protein_pct: 20 } },
  ],
  containers: { items: [{ id: 'mug', label: 'Mug', emoji: '☕', grams: 350 }] },
};

describe('ApplyScanToComposition', () => {
  let store; let apply; let clock;

  beforeEach(() => {
    clock = 1_000;
    store = new CompositionStore({ now: () => clock });
    apply = new ApplyScanToComposition({ store, config: CONFIG });
  });

  it('declines a code the grammar does not claim, so UPC can fall through', () => {
    expect(apply.execute({ scaleId: 'kitchen', code: '012345678905' })).toEqual({ handled: false });
    expect(store.read('kitchen').active).toBe(false);
  });

  it('records a configured density level', () => {
    const r = apply.execute({ scaleId: 'kitchen', code: 'dl:4' });
    expect(r).toMatchObject({ handled: true, kind: 'density', label: 'Mixed' });
    expect(store.read('kitchen').density).toBe(4);
  });

  it('refuses a level that parses but has no config row', () => {
    const r = apply.execute({ scaleId: 'kitchen', code: 'dl:9' });
    expect(r).toMatchObject({ handled: true, ok: false, error: 'UNKNOWN_DENSITY_LEVEL' });
    expect(store.read('kitchen').density).toBeNull();
  });

  it('records a configured container', () => {
    const r = apply.execute({ scaleId: 'kitchen', code: 'ct:mug' });
    expect(r).toMatchObject({ handled: true, kind: 'container', label: 'Mug', grams: 350 });
    expect(store.read('kitchen').container).toBe('mug');
  });

  it('refuses an unknown container instead of taring zero', () => {
    const r = apply.execute({ scaleId: 'kitchen', code: 'ct:teapot' });
    expect(r).toMatchObject({ handled: true, ok: false, error: 'UNKNOWN_CONTAINER' });
    expect(store.read('kitchen').container).toBeNull();
  });

  it('clears on rs:clear and reports whether anything was live', () => {
    apply.execute({ scaleId: 'kitchen', code: 'dl:4' });
    expect(apply.execute({ scaleId: 'kitchen', code: 'rs:clear' })).toMatchObject({ handled: true, hadState: true });
    expect(apply.execute({ scaleId: 'kitchen', code: 'rs:clear' })).toMatchObject({ handled: true, hadState: false });
  });
});
