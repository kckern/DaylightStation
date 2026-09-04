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

  it('writes the DERIVED serving under `nutrients`, so the file agrees with the app', async () => {
    const { store, disk } = makeStore();
    await store.save(new FoodCatalogEntry({
      id: 'e1', name: 'Premier Protein Shake',
      nutrients: { calories: 610, protein: 66, sodium: 320 },
      observations: [obs(1), obs(2), obs(3)],
      lastUsed: '2026-08-25', createdAt: '2026-01-01T00:00:00.000Z',
    }), 'u');
    expect(disk.rows[0].nutrients).toMatchObject({ calories: 160, protein: 30, sodium: 320 });
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
