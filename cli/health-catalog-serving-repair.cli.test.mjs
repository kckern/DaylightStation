import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { inspectCatalogServingRepair, applyCatalogServingRepair, main } from './health-catalog-serving-repair.cli.mjs';

let base, root, manifestPath;
const write = (rel, data) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), yaml.dump(data)); };
const read = rel => yaml.load(fs.readFileSync(path.join(root, rel), 'utf8'));

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'serving-repair-')));
  root = path.join(base, 'nutrition');
  write('food_catalog.yml', [{ id: 'shake', name: 'Strawberry Milkshake', normalizedName: 'strawberry milkshake',
    nutrients: { calories: 140, protein: 30, carbs: 5, fat: 1 }, source: 'upc', barcodeUpc: '749826002033', useCount: 6,
    usageByBucket: { afternoon: { count: 1, lastUsed: '2026-09-22', quantity: { grams: 0, unit: 'g', amount: 0 } } },
    icon: null, iconOverride: null, lastUsed: '2026-09-22', createdAt: '2026-09-17T17:42:48.717Z' }]);
  write('nutrilist.yml', [
    { id: 'qa', uuid: 'qa-uuid', item: 'Strawberry Milkshake', foodId: 'shake', version: 1, icon: 'default', grams: null, unit: 'g', amount: null,
      calories: 140, protein: 30, carbs: 5, fat: 1, date: '2026-09-22', mealTime: 'afternoon', photoRef: null, settledBy: 'user', manualFields: [] },
  ]);
  write('archives/nutrilist/2026-09.yml', [
    { id: 'scan', uuid: 'scan', item: 'Strawberry Milkshake', foodId: 'shake', version: 4, icon: 'default', grams: null, unit: 'ml', amount: 325,
      originalQuantity: { amount: 325, unit: 'ml', grams: null }, calories: 140, protein: 30, carbs: 5, fat: 1, date: '2026-09-19', mealTime: 'evening',
      captureEvidence: { source: 'upc', upc: '749826002033', serving: { size: 325, unit: 'ml' } }, photoRef: 'ph_shakephoto' },
  ]);
  write('nutriday.yml', { '2026-09-22': { calories: 140 } });
  fs.mkdirSync(path.join(root, 'photos'));
  fs.writeFileSync(path.join(root, 'photos/ph_shakephoto.jpg'), 'jpeg');
  manifestPath = path.join(base, 'manifest.yml');
  fs.writeFileSync(manifestPath, yaml.dump({ icons: { milkshake: { path: 'img/nutrition/icons/drinks/milkshake.png' } } }));
});

describe('health-catalog-serving-repair', () => {
  it('dry run plans the milkshake repair and writes nothing', async () => {
    const before = fs.readFileSync(path.join(root, 'food_catalog.yml'), 'utf8');
    let printed = '';
    await main(['--nutrition-dir', root, '--manifest', manifestPath], { env: {}, out: { write: s => { printed += s; } } });
    const view = JSON.parse(printed);
    expect(view.summary).toMatchObject({ upcEntries: 1, catalogUpdates: 1, rowUpdates: 1, zeroQuantitiesCleared: 1 });
    expect(view.catalogUpdates[0].changes).toEqual({ serving: { amount: 325, unit: 'ml', grams: null }, photoRef: 'ph_shakephoto', icon: 'milkshake' });
    expect(view.rowUpdates[0]).toMatchObject({ id: 'qa-uuid', changes: { amount: 325, unit: 'ml', grams: null, photoRef: 'ph_shakephoto' } });
    expect(fs.readFileSync(path.join(root, 'food_catalog.yml'), 'utf8')).toBe(before);
  });

  it('apply refuses without --offline, then writes, audits and converges', async () => {
    await expect(applyCatalogServingRepair(root, path.join(base, 'backup'), { manifestPath })).rejects.toThrow(/offline/);
    const outcome = await applyCatalogServingRepair(root, path.join(base, 'backup'), { offline: true, manifestPath });
    expect(outcome).toMatchObject({ catalogUpdates: 1, rowsChanged: 1 });
    const [entry] = read('food_catalog.yml');
    expect(entry).toMatchObject({ serving: { amount: 325, unit: 'ml', grams: null }, photoRef: 'ph_shakephoto', icon: 'milkshake' });
    expect(entry.usageByBucket.afternoon.quantity).toBeNull();
    expect(read('nutrilist.yml')[0]).toMatchObject({ amount: 325, unit: 'ml', photoRef: 'ph_shakephoto', version: 2 });
    expect(Object.values(read('cleanup-audit.yml'))[0]).toMatchObject({ actor: 'catalog-serving-repair' });
    expect(read('nutriday.yml')).toEqual({ '2026-09-22': { calories: 140 } });
    expect(fs.existsSync(path.join(base, 'backup/food_catalog.yml'))).toBe(true);
    expect(inspectCatalogServingRepair(root, { manifestPath }).rowUpdates).toEqual([]);
  });
});
