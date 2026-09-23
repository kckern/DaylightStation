import { describe, it, expect } from 'vitest';
import { YamlFoodCatalogDatastore } from './YamlFoodCatalogDatastore.mjs';
import { FoodCatalogEntry } from '#domains/health/entities/FoodCatalogEntry.mjs';

const silent = { debug() {}, info() {}, warn() {}, error() {} };

const makeStore = (initial = []) => {
  const disk = { rows: initial };
  const store = new YamlFoodCatalogDatastore({
    dataService: {
      user: {
        read: () => disk.rows,
        write: (_path, data) => { disk.rows = data; return true; },
      },
    },
    logger: silent,
  });
  return { store, disk };
};

const obs = (n) => ({
  date: `2026-08-0${n}`, kcal: 160, protein: 30, carbs: 5, fat: 3,
  grams: 330, logId: `r${n}`, source: n === 1 ? 'upc' : null,
});

describe('YamlFoodCatalogDatastore — the observation ring survives a restart', () => {
  it('preserves explicit artwork pins through persistence and hydration', async () => {
    const { store, disk } = makeStore();
    await store.save(new FoodCatalogEntry({ id: 'pinned', name: 'Eggs', icon: 'fried-eggs', iconOverride: 'fried-eggs',
      lastUsed: '2026-09-05', createdAt: '2026-09-05T12:00:00Z' }), 'u');
    expect(disk.rows[0].iconOverride).toBe('fried-eggs');
    expect((await store.getById('pinned', 'u')).iconOverride).toBe('fried-eggs');
  });
  it('writes the ring and reads it back whole', async () => {
    // A field missing from #dehydrate is a field that silently does not
    // survive a restart. That has happened four times in this program, so it
    // gets its own round-trip test rather than a comment.
    const { store, disk } = makeStore();
    const entry = new FoodCatalogEntry({
      id: 'e1', name: 'Premier Protein Shake',
      nutrients: { calories: 610, protein: 66 },
      observations: [obs(1), obs(2), obs(3)],
      lastUsed: '2026-08-25', createdAt: '2026-01-01T00:00:00.000Z',
    });
    await store.save(entry, 'u');
    expect(disk.rows[0].observations).toHaveLength(3);
    expect(disk.rows[0].observations[0]).toMatchObject({ logId: 'r1', kcal: 160, grams: 330, source: 'upc' });

    const [reloaded] = await store.getAll('u');
    expect(reloaded.observations).toEqual(entry.observations);
    expect(reloaded.nutrients.calories).toBe(160);
  });

  it('keeps base nutrition separate from the derived serving across repeated saves', async () => {
    const { store, disk } = makeStore();
    await store.save(new FoodCatalogEntry({
      id: 'e1', name: 'Premier Protein Shake',
      nutrients: { calories: 610, protein: 66, sodium: 320 },
      observations: [obs(1), obs(2), obs(3)],
      lastUsed: '2026-08-25', createdAt: '2026-01-01T00:00:00.000Z',
    }), 'u');
    expect(disk.rows[0].nutrients).toMatchObject({ calories: 610, protein: 66, sodium: 320 });
    const [entry] = await store.getAll('u');
    expect(entry.nutrients.calories).toBe(160);
    await store.save(entry, 'u');
    expect(disk.rows[0].nutrients).toMatchObject({ calories: 610, protein: 66, sodium: 320 });
  });

  it('a legacy row with no observations hydrates to an empty ring and keeps its stored numbers', async () => {
    const { store } = makeStore([{
      id: 'e1', name: 'Apple', normalizedName: 'apple',
      nutrients: { calories: 95, protein: 1, carbs: 25, fat: 0 },
      useCount: 4, lastUsed: '2026-08-01', createdAt: '2026-01-01T00:00:00.000Z',
    }]);
    const [entry] = await store.getAll('u');
    expect(entry.observations).toEqual([]);
    expect(entry.nutrients).toEqual({ calories: 95, protein: 1, carbs: 25, fat: 0 });
  });

  it('does not alias the entity\'s ring into the written file', async () => {
    const { store, disk } = makeStore();
    const entry = new FoodCatalogEntry({
      id: 'e1', name: 'X', observations: [obs(1)],
      lastUsed: '2026-08-01', createdAt: '2026-01-01T00:00:00.000Z',
    });
    await store.save(entry, 'u');
    entry.observations[0].kcal = 9999;
    expect(disk.rows[0].observations[0].kcal).toBe(160);
  });
});

describe('YamlFoodCatalogDatastore — a barcode food keeps its serving and photo', () => {
  it('writes serving and photoRef and reads them back', async () => {
    const { store, disk } = makeStore();
    await store.save(new FoodCatalogEntry({ id: 'shake', name: 'Strawberry Milkshake', photoRef: 'ph_2DyAMj3lb6osrZzr',
      serving: { amount: 325, unit: 'ml', grams: null }, lastUsed: '2026-09-22', createdAt: '2026-09-17T17:42:48.717Z' }), 'u');
    expect(disk.rows[0]).toMatchObject({ photoRef: 'ph_2DyAMj3lb6osrZzr', serving: { amount: 325, unit: 'ml', grams: null } });
    const back = await store.getById('shake', 'u');
    expect(back.photoRef).toBe('ph_2DyAMj3lb6osrZzr');
    expect(back.serving).toEqual({ amount: 325, unit: 'ml', grams: null });
  });

  it('an entry written before these fields loads unchanged, and a stored 0 g portion reads as absent', async () => {
    const { store } = makeStore([{ id: 'old', name: 'Old', lastUsed: '2026-09-01', createdAt: '2026-01-01T00:00:00Z',
      usageByBucket: { afternoon: { count: 1, lastUsed: '2026-09-01', quantity: { grams: 0, unit: 'g', amount: 0 } } } }]);
    const entry = await store.getById('old', 'u');
    expect(entry.photoRef).toBeNull();
    expect(entry.serving).toBeNull();
    expect(entry.usageByBucket.afternoon).toEqual({ count: 1, lastUsed: '2026-09-01', quantity: null });
  });
});
