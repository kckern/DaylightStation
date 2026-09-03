import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { YamlNutriListDatastore } from './YamlNutriListDatastore.mjs';

// Same lifecycle/taxonomy fields threaded through the domain validators in
// Task 0.1 (schemas.mjs validateFoodItem) — this proves they survive a
// write-then-read cycle through the YAML persistence layer.
//
// The absence-preservation rule for `settled` is the whole point of this file:
// a row with NO `settled` key means "legacy row, treat as settled" downstream.
// `settled: false` alone cannot pin that rule — `false ?? x` is `false` either
// way, so a forbidden `settled: item.settled ?? null` regression would pass a
// `settled: false`-only test identically. The omitted-key tests below are the
// ones that actually catch that regression (see the self-check in the task
// report).

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

  it('syncFromLog: an item with NO settled key stays absent after round-trip (legacy-row migration rule)', async () => {
    // Deliberately no `settled` key at all — this is the "legacy row" shape.
    const legacyItem = { id: 'eEeEeEeEeE', uuid: '44444444-4444-4444-8444-444444444444', label: 'Legacy Toast', icon: 'toast', grams: 30, unit: 'g', amount: 30, color: 'yellow', calories: 90 };
    await store.syncFromLog({ id: 'mMmMmMmMmM', userId: 'u1', isAccepted: true, status: 'accepted', items: [legacyItem], meal: { date: '2026-09-02', time: 'morning' }, createdAt: '2026-09-02 08:00:00', acceptedAt: '2026-09-02 08:00:00' });
    const rows = await store.findByDate('u1', '2026-09-02');
    const row = rows.find((r) => r.label === 'Legacy Toast');
    expect(row).toBeTruthy();
    expect('settled' in row).toBe(false);
    expect(row.settled).toBeUndefined();
  });

  it('saveMany persists the full seven-field set (kind/parentId/photoRef/settled/settledBy/settledAt/microsSource) for a group + child', async () => {
    await store.saveMany([
      { uuid: 'gGgGgGgGg2', userId: 'u1', label: 'Trail Mix', calories: 150, date: '2026-09-02', kind: 'group', parentId: null, settled: false, settledBy: null, settledAt: null, photoRef: 'ph_2', microsSource: null },
      { uuid: 'cCcCcCcCc2', userId: 'u1', label: 'Cashews', calories: 90, date: '2026-09-02', kind: 'item', parentId: 'gGgGgGgGg2', settled: true, settledBy: 'user', settledAt: '2026-09-02T08:05:00.000Z', photoRef: null, microsSource: 'ai' },
    ]);
    const rows = await store.findByDate('u1', '2026-09-02');
    expect(rows).toHaveLength(2);

    const g = rows.find((r) => r.kind === 'group');
    expect(g).toBeTruthy();
    expect(g.parentId).toBeNull();
    expect(g.settled).toBe(false);
    expect(g.settledBy).toBeNull();
    expect(g.settledAt).toBeNull();
    expect(g.photoRef).toBe('ph_2');
    expect(g.microsSource).toBeNull();

    const c = rows.find((r) => r.kind === 'item' && r.name === 'Cashews');
    expect(c).toBeTruthy();
    expect(c.parentId).toBe('gGgGgGgGg2');
    expect(c.settled).toBe(true);
    expect(c.settledBy).toBe('user');
    expect(c.settledAt).toBe('2026-09-02T08:05:00.000Z');
    expect(c.photoRef).toBeNull();
    expect(c.microsSource).toBe('ai');
  });

  it('saveMany: an item with NO settled key stays absent after round-trip (legacy-row migration rule)', async () => {
    // No `settled` key in the input at all — the write path must not default it.
    await store.saveMany([
      { uuid: '55555555-5555-4555-8555-555555555555', userId: 'u1', label: 'Legacy Quick-Add', calories: 200, date: '2026-09-02' },
    ]);
    const rows = await store.findByDate('u1', '2026-09-02');
    expect(rows).toHaveLength(1);
    expect('settled' in rows[0]).toBe(false);
    expect(rows[0].settled).toBeUndefined();
  });
});
