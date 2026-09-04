import { describe, it, expect } from 'vitest';
import { CatalogAuditService, DRIFT_KEY_PREFIX } from './CatalogAuditService.mjs';
import { CatalogReconcileJob } from './CatalogReconcileJob.mjs';
import { FoodCatalogEntry } from '#domains/health/entities/FoodCatalogEntry.mjs';

const NOW = new Date('2026-09-03T12:00:00-07:00').getTime();
const silent = { debug() {}, info() {}, warn() {}, error() {} };

const row = (over) => ({
  uuid: 'u1', name: 'Premier Protein Shake', date: '2026-08-01',
  calories: 160, protein: 30, carbs: 5, fat: 3, grams: 330, unit: 'g', amount: 330, ...over,
});

const drifted = () => new FoodCatalogEntry({
  id: 'e1', name: 'Premier Protein Shake',
  // The catalog's stored total, left over from the two-bottle log.
  nutrients: { calories: 610, protein: 66, carbs: 10, fat: 6 },
  lastUsed: '2026-08-19', createdAt: '2026-01-01T00:00:00.000Z',
});

const history = [
  row({ uuid: 'a', date: '2026-08-01' }),
  row({ uuid: 'c', date: '2026-08-12' }),
  row({ uuid: 'e', date: '2026-08-25' }),
];

const harness = ({ rows = history, entries = [drifted()], dismissedKeys = [] } = {}) => {
  const catalogStore = { getAll: async () => entries, save: async () => {} };
  const dismissed = [...dismissedKeys];
  const templateService = {
    listDismissedKeys: async () => dismissed,
    dismissKey: async (key) => { dismissed.push(key); return { ok: true, key }; },
  };
  const svc = new CatalogAuditService({
    catalogStore,
    reconcileJob: new CatalogReconcileJob({
      catalogStore,
      nutriListStore: { findByDateRange: async () => rows },
      clock: { now: () => NOW },
      logger: silent,
    }),
    templateService,
    logger: silent,
  });
  return { svc, entries, dismissed };
};

describe('CatalogAuditService.report', () => {
  it('flags the entry whose serving its own history does not support', async () => {
    const { svc } = harness();
    const report = await svc.report('u');
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]).toMatchObject({
      key: `${DRIFT_KEY_PREFIX}premier protein shake`,
      name: 'Premier Protein Shake',
      catalogCalories: 610,
      historyCalories: 160,
      historyGrams: 330,
      rowCount: 3,
    });
    expect(report.entries[0].ratio).toBeCloseTo(610 / 160, 6);
  });

  it('says nothing about an entry that already agrees with its history', async () => {
    const entry = new FoodCatalogEntry({
      id: 'e1', name: 'Premier Protein Shake', nutrients: { calories: 160 },
      lastUsed: '2026-08-25', createdAt: '2026-01-01T00:00:00.000Z',
    });
    const { svc } = harness({ entries: [entry] });
    const report = await svc.report('u');
    expect(report.entries).toEqual([]);
    expect(report.considered).toBe(1);
  });

  it('refuses to argue with a median built from fewer than three rows', async () => {
    const { svc } = harness({ rows: history.slice(0, 2) });
    const report = await svc.report('u');
    expect(report.considered).toBe(0);
    expect(report.entries).toEqual([]);
  });

  it('honours the shared dismissal ledger — a refused proposal never comes back', async () => {
    const { svc } = harness({ dismissedKeys: [`${DRIFT_KEY_PREFIX}premier protein shake`] });
    const report = await svc.report('u');
    expect(report.entries).toEqual([]);
    expect(report.dismissed).toBe(1);
  });

  it('is deterministic — two runs, byte-identical reports', async () => {
    const { svc } = harness();
    const a = await svc.report('u');
    const b = await svc.report('u');
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('orders by how wrong each entry is', async () => {
    const mild = new FoodCatalogEntry({
      id: 'e2', name: 'Rice', nutrients: { calories: 800 },
      lastUsed: '2026-08-25', createdAt: '2026-01-01T00:00:00.000Z',
    });
    const riceRows = [1, 2, 3].map((i) => row({
      uuid: `r${i}`, name: 'Rice', date: `2026-08-0${i}`, calories: 260, grams: 200, amount: 200,
    }));
    const { svc } = harness({ rows: [...history, ...riceRows], entries: [mild, drifted()] });
    const report = await svc.report('u');
    expect(report.entries.map((e) => e.name)).toEqual(['Premier Protein Shake', 'Rice']);
  });
});

describe('CatalogAuditService.approve — re-seeds, never authors a number', () => {
  it('replaces the ring from history and the derived serving follows', async () => {
    const { svc, entries } = harness();
    const result = await svc.approve(`${DRIFT_KEY_PREFIX}premier protein shake`, 'u');
    expect(entries[0].observations).toHaveLength(3);
    expect(result.nutrients.calories).toBe(160);
    expect((await svc.report('u')).entries).toEqual([]);
  });

  it('refuses rather than writing a zero when history says nothing usable', async () => {
    const { svc, entries } = harness({ rows: [row({ uuid: 'a', grams: 1, unit: 'serving', amount: 1 })] });
    await expect(svc.approve(`${DRIFT_KEY_PREFIX}premier protein shake`, 'u')).rejects.toMatchObject({ code: 'NO_HISTORY' });
    expect(entries[0].nutrients.calories).toBe(610);
  });

  it('rejects a key from some other proposer', async () => {
    const { svc } = harness();
    await expect(svc.approve('breakfast-combo:eggs+toast', 'u')).rejects.toMatchObject({ code: 'BAD_KEY' });
  });

  it('404s for a name with no catalog entry', async () => {
    const { svc } = harness();
    await expect(svc.approve(`${DRIFT_KEY_PREFIX}kimchi stew`, 'u')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('CatalogAuditService.dismiss', () => {
  it('writes the key into the shared ledger and the entry stops being proposed', async () => {
    const { svc, dismissed } = harness();
    const key = `${DRIFT_KEY_PREFIX}premier protein shake`;
    expect((await svc.report('u')).entries).toHaveLength(1);
    await svc.dismiss(key, 'u');
    expect(dismissed).toEqual([key]);
    expect((await svc.report('u')).entries).toEqual([]);
  });

  it('changes no nutrition — the entry keeps the number it had', async () => {
    const { svc, entries } = harness();
    await svc.dismiss(`${DRIFT_KEY_PREFIX}premier protein shake`, 'u');
    expect(entries[0].nutrients.calories).toBe(610);
    expect(entries[0].observations).toEqual([]);
  });

  it('rejects a key from some other proposer', async () => {
    const { svc } = harness();
    await expect(svc.dismiss('breakfast-combo:eggs+toast', 'u')).rejects.toMatchObject({ code: 'BAD_KEY' });
  });
});
