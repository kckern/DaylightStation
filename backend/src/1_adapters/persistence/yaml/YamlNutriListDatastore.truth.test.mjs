import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadYaml, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';
import { YamlNutriListDatastore } from './YamlNutriListDatastore.mjs';

let root, store;
const row = (extra = {}) => ({ uuid: 'food-a', userId: 'u', name: 'Food', date: '2020-01-01', grams: 100, unit: 'g', amount: 100, calories: 200, fiber: 5, sodium: 300, ...extra });
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'health-truth-'));
  store = new YamlNutriListDatastore({ dataService: { user: { resolveDir: rel => path.join(root, rel) } }, logger: { info() {}, warn() {} } });
});
const summary = () => loadYaml(path.join(root, 'lifelog/nutrition/nutriday'));

describe('nutrition ledger truth', () => {
  it('never turns servings or explicit unknown grams into mass', async () => {
    await store.saveMany([row({ grams: 0, amount: 313, unit: 'servings' })]);
    expect((await store.findByUuid('u', 'food-a')).grams).toBeNull();
    expect((await store.findByUuid('u', 'food-a')).originalQuantity).toEqual({ amount: 313, unit: 'servings' });
  });
  it('clears the summary after the last row is deleted', async () => {
    await store.saveMany([row()]);
    await store.deleteById('u', 'food-a');
    expect(summary()['2020-01-01'].calories).toBe(0);
    expect(summary()['2020-01-01'].food_items).toEqual([]);
  });
  it('edits and moves archived entries, refreshing both days', async () => {
    await store.saveMany([row()]);
    await store.archiveOldItems('u');
    await store.updatePortion('u', 'food-a', 2);
    expect(await store.findByUuid('u', 'food-a')).toMatchObject({ grams: 200, fiber: 10, sodium: 600 });
    await store.update('u', 'food-a', { date: '2026-09-04' });
    expect(await store.findByDate('u', '2020-01-01')).toEqual([]);
    expect(summary()['2020-01-01'].calories).toBe(0);
    expect(summary()['2026-09-04'].calories).toBe(400);
  });
  it('rejects an entire batch when one version conflicts', async () => {
    await store.saveMany([row(), row({ uuid: 'food-b' })]);
    await expect(store.mutateEntries('u', { updates: [
      { id: 'food-a', changes: { calories: 10 }, expectedVersion: 1 },
      { id: 'food-b', changes: { calories: 10 }, expectedVersion: 99 },
    ] })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect((await store.findByUuid('u', 'food-a')).calories).toBe(200);
  });
  it('recovers a prepared transaction before a day read', async () => {
    const target = path.join(root, 'lifelog/nutrition/nutrilist');
    saveYamlToPathAtomic(path.join(root, 'lifelog/nutrition/ledger-transaction.yml'), {
      pending: true, writes: [[target, [row()]]],
    });
    expect(await store.findByDate('u', '2020-01-01')).toHaveLength(1);
    expect(loadYaml(path.join(root, 'lifelog/nutrition/ledger-transaction')).pending).toBe(false);
  });
  it('refuses impossible dates and corrupt storage', async () => {
    await expect(store.saveMany([row({ date: '2026-02-31' })])).rejects.toThrow('malformed');
    const target = path.join(root, 'lifelog/nutrition/nutrilist.yml');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '[ broken');
    await expect(store.saveMany([row()])).rejects.toThrow();
    expect(fs.readFileSync(target, 'utf8')).toBe('[ broken');
  });

  it('capture replay cannot undo a correction or resurrect a deleted item', async () => {
    const log = { id: 'capture-1', userId: 'u', isAccepted: true, status: 'accepted',
      meal: { date: '2020-01-01', time: 'morning' }, items: [row(), row({ uuid: 'food-b' })] };
    await store.syncFromLog(log);
    await store.update('u', 'food-a', { calories: 50 });
    await store.deleteById('u', 'food-b');
    await store.syncFromLog(log);
    expect((await store.findByUuid('u', 'food-a')).calories).toBe(50);
    expect(await store.findByUuid('u', 'food-b')).toBeNull();
    expect(summary()['2020-01-01'].calories).toBe(50);
    await expect(store.syncFromLog(log, { revision: true })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('an explicit first revision replaces its entire capture atomically, including omitted items', async () => {
    const log = { id: 'capture-1', userId: 'u', isAccepted: true, status: 'accepted',
      meal: { date: '2020-01-01', time: 'morning' }, items: [row(), row({ uuid: 'food-b' })] };
    await store.syncFromLog(log);
    await store.syncFromLog({ ...log, items: [row({ calories: 75 })] }, { revision: true });
    expect(await store.findByDate('u', '2020-01-01')).toHaveLength(1);
    expect(summary()['2020-01-01'].calories).toBe(75);
    await store.syncFromLog(log);
    expect(summary()['2020-01-01'].calories).toBe(75);
  });

  it('restores an archived group losslessly and a repeated Undo is harmless', async () => {
    await store.saveMany([row({ uuid: 'group', kind: 'group', calories: 0 }),
      row({ parentId: 'group', foodId: 'catalog-1', photoRef: 'photo-1', nutrientProvenance: { fiber: { source: 'user' } } })]);
    await store.archiveOldItems('u');
    const before = await store.findByUuid('u', 'food-a');
    await store.deleteById('u', 'group');
    expect(await store.findByDate('u', '2020-01-01')).toEqual([]);
    await store.restoreEntries('u', ['group', 'food-a']);
    await store.restoreEntries('u', ['group', 'food-a']);
    expect(await store.findByUuid('u', 'food-a')).toEqual({ ...before, version: 2 });
    expect(await store.findByDate('u', '2020-01-01')).toHaveLength(2);
    expect(summary()['2020-01-01'].calories).toBe(200);
  });

  it('coalesces concurrent operation retries and rejects a reused ID with different input', async () => {
    let calls = 0;
    const action = async () => { calls++; await store.saveMany([row()]); return { committed: true }; };
    const results = await Promise.all([store.runOperation('u', 'op-a', { text: 'food' }, action), store.runOperation('u', 'op-a', { text: 'food' }, action)]);
    expect(results).toEqual([{ committed: true }, { committed: true }]);
    expect(calls).toBe(1);
    await expect(store.runOperation('u', 'op-a', { text: 'another food' }, action)).rejects.toMatchObject({ status: 409 });
  });

  it('recovers a committed capture whose response was lost without running its parser again', async () => {
    await expect(store.runOperation('u', 'op-lost', { text: 'food' }, async () => {
      await store.saveMany([row()]);
      throw new Error('connection lost after commit');
    })).rejects.toThrow('connection lost');
    const result = await store.runOperation('u', 'op-lost', { text: 'food' }, () => { throw new Error('must not run'); });
    expect(result).toMatchObject({ committed: true, entryIds: ['food-a'] });
    expect(await store.findByDate('u', '2020-01-01')).toHaveLength(1);
  });
});
