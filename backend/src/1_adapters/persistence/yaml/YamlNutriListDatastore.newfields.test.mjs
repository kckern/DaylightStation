import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { YamlNutriListDatastore } from './YamlNutriListDatastore.mjs';

// Same lifecycle/taxonomy fields threaded through the domain validators in
// Task 0.1 (schemas.mjs validateFoodItem) — this proves they survive a
// write-then-read cycle through the YAML persistence layer.

let dir, store;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nutrilist-'));
  store = new YamlNutriListDatastore({
    dataService: { user: { resolveDir: (rel) => path.join(dir, rel) } },
    logger: { warn: () => {}, info: () => {} },
  });
});

const groupItem = { id: 'gGgGgGgGgG', uuid: '11111111-1111-4111-8111-111111111111', label: 'Smoothie', icon: 'smoothie', grams: 400, unit: 'g', amount: 400, color: 'green', calories: 0, kind: 'group', parentId: null, settled: false, settledBy: null, settledAt: null, photoRef: 'ph_1', microsSource: null };
const childItem = { ...groupItem, id: 'cCcCcCcCcC', uuid: '22222222-2222-4222-8222-222222222222', label: 'Blueberries', kind: 'item', parentId: 'gGgGgGgGgG', calories: 80, photoRef: null };

describe('YamlNutriListDatastore lifecycle/taxonomy fields', () => {
  it('syncFromLog persists kind/parentId/settled/photoRef', async () => {
    await store.syncFromLog({ id: 'lLlLlLlLlL', userId: 'u1', isAccepted: true, status: 'accepted', items: [groupItem, childItem], meal: { date: '2026-09-02', time: 'morning' }, createdAt: '2026-09-02 08:00:00', acceptedAt: '2026-09-02 08:00:00' });
    const rows = await store.findByDate('u1', '2026-09-02');
    const g = rows.find((r) => r.kind === 'group');
    const c = rows.find((r) => r.parentId === 'gGgGgGgGgG');
    expect(g).toBeTruthy(); expect(g.settled).toBe(false); expect(g.photoRef).toBe('ph_1');
    expect(c).toBeTruthy(); expect(c.mealTime).toBe('morning');
  });

  it('saveMany persists settled/kind through findByDate', async () => {
    await store.saveMany([
      { uuid: '33333333-3333-4333-8333-333333333333', userId: 'u1', label: 'Trail Mix', calories: 150, date: '2026-09-02', kind: 'group', settled: false },
    ]);
    const rows = await store.findByDate('u1', '2026-09-02');
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('group');
    expect(rows[0].settled).toBe(false);
  });
});
