import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { CatalogReconcileJob } from './CatalogReconcileJob.mjs';
import { FoodCatalogEntry } from '#domains/health/entities/FoodCatalogEntry.mjs';

const NOW = new Date('2026-09-03T12:00:00-07:00').getTime();
const silent = { debug() {}, info() {}, warn() {}, error() {} };

/** A history row exactly as YamlNutriListDatastore hands one back. */
const row = (over) => ({
  uuid: 'u1', name: 'Premier Protein Shake', date: '2026-08-01',
  calories: 160, protein: 30, carbs: 5, fat: 3, grams: 330, unit: 'g', amount: 330,
  kind: 'item', ...over,
});

const makeEntry = (over = {}) => new FoodCatalogEntry({
  id: 'e1', name: 'Premier Protein Shake',
  nutrients: { calories: 610, protein: 66, carbs: 10, fat: 6 },
  useCount: 57, lastUsed: '2026-08-19', createdAt: '2026-01-01T00:00:00.000Z',
  usageByBucket: { morning: { count: 12, lastUsed: '2026-08-19', quantity: { grams: 385, unit: 'g', amount: 385 } } },
  icon: 'shake', favorite: true, ...over,
});

const harness = (rows, entries) => {
  const saved = [];
  const job = new CatalogReconcileJob({
    catalogStore: {
      getAll: async () => entries,
      save: async (e) => { saved.push(e.id); },
    },
    nutriListStore: { findByDateRange: async () => rows },
    clock: { now: () => NOW },
    logger: silent,
  });
  return { job, saved };
};

/** What the on-disk catalog would look like, for hashing. */
const fingerprint = (entries) => createHash('sha256').update(JSON.stringify(entries.map((e) => ({
  id: e.id, useCount: e.useCount, lastUsed: e.lastUsed, icon: e.icon, favorite: e.favorite,
  usageByBucket: e.usageByBucket, nutrients: e.nutrients, observations: e.observations,
})))).digest('hex');

describe('CatalogReconcileJob', () => {
  const history = [
    row({ uuid: 'a', date: '2026-08-01' }),
    row({ uuid: 'b', date: '2026-08-05', calories: 320, protein: 60, grams: 660, amount: 660 }),
    row({ uuid: 'c', date: '2026-08-12' }),
    row({ uuid: 'd', date: '2026-08-19', calories: 610, protein: 66, grams: 385, amount: 385 }),
    row({ uuid: 'e', date: '2026-08-25' }),
  ];

  it('seeds the ring from history and the derived serving stops being the last row logged', async () => {
    const entry = makeEntry();
    expect(entry.nutrients.calories).toBe(610);
    const { job } = harness(history, [entry]);
    const result = await job.run('u');
    expect(result).toMatchObject({ scanned: 1, seeded: 1, unchanged: 0, skipped: 0 });
    expect(entry.observations).toHaveLength(5);
    expect(entry.nutrients.calories).toBe(160);
  });

  it('IS IDEMPOTENT — three runs, one hash', async () => {
    // `backfill` increments useCount per row per run (decision 2.29). This job
    // rebuilds rather than appends, so the second and third runs write nothing
    // at all and the catalog's fingerprint does not move.
    const entries = [makeEntry()];
    const { job, saved } = harness(history, entries);
    const hashes = [];
    const results = [];
    for (let i = 0; i < 3; i++) {
      results.push(await job.run('u'));
      hashes.push(fingerprint(entries));
    }
    expect(new Set(hashes).size).toBe(1);
    expect(results.map((r) => r.seeded)).toEqual([1, 0, 0]);
    expect(results.map((r) => r.unchanged)).toEqual([0, 1, 1]);
    expect(saved).toEqual(['e1']);
  });

  it('does not touch useCount, lastUsed, icon, favorite or bucket history', async () => {
    const entry = makeEntry();
    const before = {
      useCount: entry.useCount, lastUsed: entry.lastUsed, icon: entry.icon,
      favorite: entry.favorite, usageByBucket: JSON.stringify(entry.usageByBucket),
      createdAt: entry.createdAt,
    };
    const { job } = harness(history, [entry]);
    await job.run('u');
    expect(entry.useCount).toBe(before.useCount);
    expect(entry.lastUsed).toBe(before.lastUsed);
    expect(entry.icon).toBe(before.icon);
    expect(entry.favorite).toBe(before.favorite);
    expect(JSON.stringify(entry.usageByBucket)).toBe(before.usageByBucket);
    expect(entry.createdAt).toBe(before.createdAt);
  });

  it('creates nothing for a history name the catalog has never heard of', async () => {
    const { job, saved } = harness([row({ uuid: 'x', name: 'Kimchi Stew' })], []);
    const result = await job.run('u');
    expect(result).toMatchObject({ scanned: 0, seeded: 0 });
    expect(saved).toEqual([]);
  });

  it('skips an entry whose history holds nothing usable, leaving it exactly as it was', async () => {
    const entry = makeEntry();
    // Every row is a "1 serving" row: a total with nothing to divide by.
    const { job, saved } = harness(
      [row({ uuid: 'a', grams: 1, unit: 'serving', amount: 1 }), row({ uuid: 'b', grams: 1, unit: 'serving', amount: 1 })],
      [entry],
    );
    const result = await job.run('u');
    expect(result).toMatchObject({ seeded: 0, skipped: 1 });
    expect(entry.observations).toEqual([]);
    expect(entry.nutrients.calories).toBe(610);
    expect(saved).toEqual([]);
  });

  it('stays idempotent when history holds two rows under one id', async () => {
    // The stored ring keeps one observation per id, so the change check has to
    // compare against the SAME normalization. When it did not, this entry was
    // re-written on every run — identical bytes, but `seeded` never reached 0.
    // Found on the real 683-entry catalog, not invented here.
    const entries = [makeEntry()];
    const dupes = [...history, row({ uuid: 'e', date: '2026-08-25', calories: 999, grams: 700, amount: 700 })];
    const { job } = harness(dupes, entries);
    const runs = [await job.run('u'), await job.run('u'), await job.run('u')];
    expect(runs.map((r) => r.seeded)).toEqual([1, 0, 0]);
    expect(new Set(entries[0].observations.map((o) => o.logId)).size).toBe(entries[0].observations.length);
  });

  it('dryRun computes the same answer and writes nothing', async () => {
    const { job, saved } = harness(history, [makeEntry()]);
    const result = await job.run('u', { dryRun: true });
    expect(result).toMatchObject({ seeded: 1, dryRun: true });
    expect(saved).toEqual([]);
  });

  it('keeps the newest 20 when history is longer than the ring', async () => {
    const long = Array.from({ length: 30 }, (_, i) =>
      row({ uuid: `h${String(i).padStart(2, '0')}`, date: `2026-07-${String(i + 1).padStart(2, '0')}` }));
    const entry = makeEntry();
    const { job } = harness(long, [entry]);
    await job.run('u');
    expect(entry.observations).toHaveLength(20);
    expect(entry.observations[0].logId).toBe('h10');
  });

  it('re-attaches the UPC label a rebuilt observation would otherwise lose', async () => {
    // A stored nutrilist row does not record which capture path made it, so a
    // rebuild comes back sourceless and the panel would lose its extra weight.
    const entry = makeEntry({
      observations: [{ date: '2026-08-01', kcal: 160, grams: 330, protein: 30, carbs: 5, fat: 3, logId: 'a', source: 'upc' }],
    });
    const { job } = harness(history, [entry]);
    await job.run('u');
    expect(entry.observations.find((o) => o.logId === 'a').source).toBe('upc');
    expect(entry.observations.find((o) => o.logId === 'b').source ?? null).toBeNull();
  });

  it('ignores rows whose name is the store\'s Unknown sentinel', async () => {
    const entry = makeEntry();
    const { job } = harness([row({ uuid: 'a', name: 'Unknown' })], [entry]);
    expect((await job.run('u')).skipped).toBe(1);
  });
});
