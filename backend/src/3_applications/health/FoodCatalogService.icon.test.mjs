import { describe, it, expect, beforeEach } from 'vitest';
import { FoodCatalogService } from './FoodCatalogService.mjs';
import { FoodCatalogEntry } from '#domains/health/entities/FoodCatalogEntry.mjs';

const NOW = new Date('2026-09-03T12:00:00-07:00').getTime();
const silent = { debug() {}, info() {}, warn() {}, error() {} };

function harness(entries = []) {
  const map = new Map(entries.map((e) => [e.id, e]));
  const catalogStore = {
    getById: async (id) => map.get(id) || null,
    findByNormalizedName: async (name) => {
      const n = FoodCatalogEntry.normalize(name);
      return [...map.values()].find((e) => e.normalizedName === n) || null;
    },
    save: async (e) => { map.set(e.id, e); },
    getAll: async () => [...map.values()],
  };
  const nutriListStore = { saved: null, saveMany: async (items) => { nutriListStore.saved = items; } };
  let n = 0;
  const svc = new FoodCatalogService({
    catalogStore, nutriListStore, clock: { now: () => NOW },
    createId: () => `id-${++n}`, logger: silent,
  });
  return { map, catalogStore, nutriListStore, svc };
}

const entry = (over = {}) => new FoodCatalogEntry({
  id: 'e1', name: 'Eggs', nutrients: { calories: 140, protein: 12, carbs: 1, fat: 10 },
  lastUsed: '2026-08-01', createdAt: '2026-01-01T00:00:00Z', ...over,
});

describe('FoodCatalogEntry.icon', () => {
  it('defaults to null when the entry was created without one', () => {
    expect(entry().icon).toBeNull();
  });

  it('carries an icon it was constructed with', () => {
    expect(entry({ icon: 'fried-eggs' }).icon).toBe('fried-eggs');
  });
});

describe('FoodCatalogService icon assignment', () => {
  let h;
  beforeEach(() => { h = harness(); });

  it('a new entry created by recordUsage takes the captured icon', async () => {
    await h.svc.recordUsage({ name: 'Eggs', calories: 140, icon: 'fried-eggs' }, 'u');
    const saved = await h.catalogStore.findByNormalizedName('Eggs', 'u');
    expect(saved.icon).toBe('fried-eggs');
  });

  it('an entry with NO icon gets one filled in by the next capture that carries one', async () => {
    h = harness([entry()]);
    await h.svc.recordUsage({ name: 'Eggs', calories: 140, icon: 'fried-eggs' }, 'u');
    expect(h.map.get('e1').icon).toBe('fried-eggs');
  });

  // U5.3: "always for this food" is a deliberate human choice. A later parse of
  // the same food must not quietly overwrite it, or the override would last
  // exactly until the next time that food is logged.
  it('an entry that ALREADY has an icon keeps it, even when a capture proposes another', async () => {
    h = harness([entry({ icon: 'boiled-egg' })]);
    await h.svc.recordUsage({ name: 'Eggs', calories: 140, icon: 'fried-eggs' }, 'u');
    expect(h.map.get('e1').icon).toBe('boiled-egg');
  });

  it('a capture with no icon never clears an icon the entry already has', async () => {
    h = harness([entry({ icon: 'boiled-egg' })]);
    await h.svc.recordUsage({ name: 'Eggs', calories: 140 }, 'u');
    expect(h.map.get('e1').icon).toBe('boiled-egg');
  });

  it('setIcon overrides whatever is there — this is the "always for this food" path', async () => {
    h = harness([entry({ icon: 'boiled-egg' })]);
    const updated = await h.svc.setIcon('e1', 'u', 'fried-eggs');
    expect(updated.icon).toBe('fried-eggs');
    expect(h.map.get('e1').icon).toBe('fried-eggs');
  });

  it('setIconByName finds the entry the row names', async () => {
    h = harness([entry()]);
    await h.svc.setIconByName('eggs', 'u', 'fried-eggs');
    expect(h.map.get('e1').icon).toBe('fried-eggs');
  });

  it('setIconByName throws for a food the catalog does not know', async () => {
    h = harness([entry()]);
    await expect(h.svc.setIconByName('Pterodactyl', 'u', 'fried-eggs')).rejects.toThrow(/not found/i);
  });

  it('setIcon(null) clears the icon back to the neutral fallback', async () => {
    h = harness([entry({ icon: 'boiled-egg' })]);
    const updated = await h.svc.setIcon('e1', 'u', null);
    expect(updated.icon).toBeNull();
  });
});

describe('FoodCatalogService.quickAdd copies the catalog icon onto the row', () => {
  it('a quick-added row carries the entry icon, so a repeat food keeps its picture (U5.2)', async () => {
    const h = harness([entry({ icon: 'fried-eggs' })]);
    const item = await h.svc.quickAdd('e1', 'u');
    expect(item.icon).toBe('fried-eggs');
    expect(h.nutriListStore.saved[0].icon).toBe('fried-eggs');
  });

  it('an entry with no icon yields a row with no icon, never an invented one', async () => {
    const h = harness([entry()]);
    const item = await h.svc.quickAdd('e1', 'u');
    expect(item.icon).toBeNull();
  });
});

describe('FoodCatalogService.backfill donates icons from stored rows', () => {
  it('an existing stored row with an icon backfills the catalog entry that matches its name', async () => {
    const h = harness();
    h.nutriListStore.findByDate = async (_u, date) => (date === '2026-09-03'
      ? [{ label: 'Eggs', calories: 140, protein: 12, carbs: 1, fat: 10, icon: 'fried-eggs' }]
      : []);
    await h.svc.backfill('u', 1);
    const saved = await h.catalogStore.findByNormalizedName('Eggs', 'u');
    expect(saved.icon).toBe('fried-eggs');
  });

  it('a stored row whose icon is the neutral sentinel donates nothing, so "default" never sticks', async () => {
    const h = harness();
    h.nutriListStore.findByDate = async () => [{ label: 'Eggs', calories: 140, icon: 'default' }];
    await h.svc.backfill('u', 1);
    const saved = await h.catalogStore.findByNormalizedName('Eggs', 'u');
    expect(saved.icon).toBeNull();
  });

  // M-1. Every case above keys the name as `label` — the `syncFromLog` row
  // shape. The nutrilist also holds `item`-shaped rows (the `saveMany` path:
  // quick-adds, group children, AcceptFoodLog), and on the production hot file
  // those are the MAJORITY. The backfill's name gate used to read `item.label`
  // alone, so it silently skipped every one of them — and because this suite
  // only ever handed it `label` rows, nothing here could see that. Phase 7's
  // icon donation was 57% dead in production for exactly this reason. Pinned in
  // BOTH shapes now, so the gate cannot narrow again without a test noticing.
  it('donates the icon from an `item`-shaped row too — the shape that hid the defect', async () => {
    const h = harness();
    h.nutriListStore.findByDate = async (_u, date) => (date === '2026-09-03'
      ? [{ item: 'Kale', calories: 45, protein: 3, carbs: 9, fat: 1, icon: 'kale' }]
      : []);
    await h.svc.backfill('u', 1);
    const saved = await h.catalogStore.findByNormalizedName('Kale', 'u');
    expect(saved).not.toBeNull();
    expect(saved.icon).toBe('kale');
  });

  // The store's own resolved field wins where a row carries it, and a row that
  // can supply no name at all is skipped rather than catalogued as 'Unknown'.
  it('reads a `name`-resolved row, and skips a row with no usable name', async () => {
    const h = harness();
    h.nutriListStore.findByDate = async (_u, date) => (date === '2026-09-03'
      ? [{ name: 'Sunflower Seeds', calories: 200, icon: 'seed' },
         { name: 'Unknown', calories: 10, icon: 'mystery' },
         { calories: 5, icon: 'ghost' }]
      : []);
    await h.svc.backfill('u', 1);
    expect((await h.catalogStore.findByNormalizedName('Sunflower Seeds', 'u')).icon).toBe('seed');
    expect(await h.catalogStore.findByNormalizedName('Unknown', 'u')).toBeNull();
    expect((await h.catalogStore.getAll('u'))).toHaveLength(1);
  });
});
