import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
import { inspectScanRepair, applyScanRepair, summarize, verifyCatalog, verifyLedger, main } from './health-scan-repair.cli.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const row = (id, item, over = {}) => ({
  id, uuid: id, item, version: 1, date: '2026-09-21', mealTime: 'evening', unit: 'g', amount: 100, grams: 100,
  originalQuantity: { amount: 100, unit: 'g', grams: 100 }, calories: 100, protein: 1, carbs: 1, fat: 1,
  icon: 'default', photoRef: null, manualFields: [], review: { state: 'provisional', startedAt: '2026-09-21T12:00:00.000Z', source: 'upc' },
  ...over,
});
const catalogEntry = (id, name, over = {}) => ({ id, name, normalizedName: name.toLowerCase(), nutrients: { calories: 100, protein: 1, carbs: 1, fat: 1 },
  useCount: 1, lastUsed: '2026-09-01', createdAt: '2026-01-01T00:00:00.000Z', icon: null, iconOverride: null, ...over });

let tree;
function build() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'scan-repair-')));
  const root = path.join(base, 'nutrition');
  const write = (rel, data) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), yaml.dump(data)); };
  write('nutrilist.yml', [
    row('m1', 'Magazine', { review: { source: 'upc', startedAt: '2026-09-21T21:50:11.000Z' }, photoRef: 'ph_stock' }),
    row('m2', 'Magazine', { review: { source: 'upc', startedAt: '2026-09-21T21:50:12.500Z' }, photoRef: 'ph_stock' }),
    row('oikos', 'OIKOS PRO PLAIN', { unit: 'ml', amount: 170, grams: null, icon: 'yogurt', originalQuantity: { amount: 170, unit: 'ml', grams: null } }),
    row('feta', 'Feta Cheese', { icon: 'cheese', review: { source: 'text', startedAt: '2026-09-21T12:00:00.000Z' } }),
    row('pb', 'Peanut Butter', { icon: 'peanut_butter', review: { source: 'text', startedAt: '2026-09-21T12:00:00.000Z' } }),
    row('set', 'OIKOS PRO PLAIN', { date: '2026-09-20', unit: 'ml', amount: 85, grams: null, icon: 'yogurt', manualFields: ['name', 'amount'],
      originalQuantity: { amount: 170, unit: 'ml', grams: null }, review: { source: 'text', startedAt: '2026-09-20T12:00:00.000Z' } }),
  ]);
  write('nutriday.yml', { '2026-01-01': { calories: 3011.0200000000004 } });
  write('archives/nutrilist/2026-08.yml', [
    row('arch', 'Pita Bread', { date: '2026-08-01', icon: 'pitasandwich', review: { source: 'text', startedAt: '2026-08-01T12:00:00.000Z' } }),
  ]);
  write('food_catalog.yml', [
    catalogEntry('c-feta', 'Feta Cheese', { icon: 'cheese' }),
    catalogEntry('c-oikos', 'OIKOS PRO PLAIN', { icon: 'yogurt', usageByBucket: {
      afternoon: { count: 4, lastUsed: '2026-09-11', quantity: { grams: 0, unit: 'ml', amount: 170 } } } }),
    catalogEntry('c-pb', 'Peanut Butter', { icon: 'peanut_butter' }),
  ]);
  fs.mkdirSync(path.join(root, 'photos'));
  fs.writeFileSync(path.join(root, 'photos/ph_stock.jpg'), 'stock art');
  fs.writeFileSync(path.join(root, 'photos/ph_stock.thumb.jpg'), 'stock thumb');
  fs.writeFileSync(path.join(root, 'food_catalog.yml.tmp-1-abc'), 'abandoned');
  fs.writeFileSync(path.join(root, 'nutrilist.yml.tmp-9-zzz'), 'not ours');
  const old = new Date('2026-09-11T08:19:00Z');
  fs.utimesSync(path.join(root, 'food_catalog.yml.tmp-1-abc'), old, old);
  const manifestPath = path.join(base, 'icon-manifest.yml');
  fs.writeFileSync(manifestPath, yaml.dump({
    icons: { 'feta-cubes': { path: 'img/nutrition/icons/cheese/feta-cubes.png' }, 'pita-bread': { path: 'img/nutrition/icons/bakery/pita-bread.png' },
      yogurt: { path: 'img/nutrition/icons/dairy/yogurt.png' }, cheese: { path: 'img/icons/food/cheese.png' },
      'peanut-butter': { path: 'img/nutrition/icons/vegan-food/peanut-butter.png' } },
    aliases: { peanut_butter: { path: 'img/nutrition/icons/vegan-food/peanut-butter.png' } },
  }));
  const iconTablePath = path.join(base, 'table.yml');
  fs.writeFileSync(iconTablePath, yaml.dump({ 'feta cheese': 'feta-cubes', 'pita bread': 'default' }));
  const foodNamesPath = path.join(base, 'names.yml');
  fs.writeFileSync(foodNamesPath, yaml.dump({ 'Pita Bread': 'pita-bread' }));
  const inputs = { manifestPath, iconTablePath, foodNamesPath, deleteIds: [], placeholderDigests: [sha('stock art')] };
  return { base, root, inputs };
}

beforeEach(() => { tree = build(); });

describe('inspectScanRepair', () => {
  it('plans across the hot file and archives, the catalog, photos and stale temp files', () => {
    const report = inspectScanRepair(tree.root, tree.inputs);
    expect(report.placeholderPhotoRefs).toEqual(['ph_stock']);
    expect(report.deleteIds).toEqual(['m2']);
    expect(report.archiveFilesTouched).toEqual(['archives/nutrilist/2026-08.yml']);
    // A flat-path manifest entry is never offered, so 'cheese' is retired.
    expect(report.updates.find(u => u.id === 'feta').changes).toEqual({ icon: 'feta-cubes' });
    // food-names wins over the reassignment table.
    expect(report.updates.find(u => u.id === 'arch').changes).toEqual({ icon: 'pita-bread' });
    // An alias pointing at hi-res art maps to the icon sharing its path.
    expect(report.updates.find(u => u.id === 'pb').changes).toEqual({ icon: 'peanut-butter' });
    // A person-set portion is never converted.
    expect(report.report.mlUnresolved).toEqual([{ id: 'set', name: 'OIKOS PRO PLAIN', reason: 'portion set by a person (amount)' }]);
    expect(report.catalog.iconUpdates.map(u => [u.id, u.icon])).toEqual([['c-feta', 'feta-cubes'], ['c-pb', 'peanut-butter']]);
    expect(report.catalog.renames).toEqual([{ id: 'c-oikos', from: 'OIKOS PRO PLAIN', to: 'Oikos Pro Plain' }]);
    expect(report.catalog.quantityUpdates).toEqual([expect.objectContaining({ id: 'c-oikos', bucket: 'afternoon', to: { grams: 170, unit: 'g', amount: 170 } })]);
    expect(report.staleTempFiles).toEqual([expect.objectContaining({ name: 'food_catalog.yml.tmp-1-abc', olderThanLive: true })]);
    expect(summarize(report)).toMatchObject({ deletes: 1, updates: 5, emptyUpc: 0, catalogIconUpdates: 2, catalogRenames: 1,
      catalogQuantityUpdates: 1, retiredFellThroughToDefault: 0,
      reFires: [{ id: 'm2', keptId: 'm1', name: 'Magazine', date: '2026-09-21', secondsAfter: 1.5 }] });
  });

  it('requires the reviewed icon table', () => {
    expect(() => inspectScanRepair(tree.root, { ...tree.inputs, iconTablePath: null })).toThrow(/icon-table/);
  });

  it('main refuses a dry run without --icon-table', async () => {
    await expect(main(['--nutrition-dir', tree.root, '--manifest', tree.inputs.manifestPath, '--report', path.join(tree.base, 'r.json')]))
      .rejects.toThrow(/icon-table/);
  });
});

describe('applyScanRepair', () => {
  it('refuses without --offline', async () => {
    const report = JSON.parse(JSON.stringify(inspectScanRepair(tree.root, tree.inputs)));
    await expect(applyScanRepair(report, path.join(tree.base, 'backup'))).rejects.toThrow(/offline/);
  });

  it('refuses a backup inside the nutrition directory', async () => {
    const report = JSON.parse(JSON.stringify(inspectScanRepair(tree.root, tree.inputs)));
    await expect(applyScanRepair(report, path.join(tree.root, 'bk'), { offline: true })).rejects.toThrow(/outside/);
  });

  it('applies, keeps archive rows in their month, converges, and moves the stale temp file', async () => {
    const report = JSON.parse(JSON.stringify(inspectScanRepair(tree.root, tree.inputs)));
    const result = await applyScanRepair(report, path.join(tree.base, 'backup'), { offline: true });
    expect(result).toMatchObject({ deleted: 1, catalogIcons: 2, catalogRenames: 1, catalogQuantities: 1, movedTempFiles: ['food_catalog.yml.tmp-1-abc'] });
    // Only a date that lost a row gets a new daily total; icon, photo, name and
    // unit fixes leave every other day's summary as it was.
    expect(result.nutridayChanged).toEqual(['2026-09-21']);
    const nutriday = yaml.load(fs.readFileSync(path.join(tree.root, 'nutriday.yml'), 'utf8'));
    expect(nutriday['2026-01-01']).toEqual({ calories: 3011.0200000000004 });
    expect(fs.existsSync(path.join(tree.root, 'nutrilist.yml.tmp-9-zzz'))).toBe(true);

    const hot = yaml.load(fs.readFileSync(path.join(tree.root, 'nutrilist.yml'), 'utf8'));
    expect(hot.map(r => r.id)).toEqual(['m1', 'oikos', 'feta', 'pb', 'set']);
    expect(hot.find(r => r.id === 'set')).toMatchObject({ unit: 'ml', amount: 85 });
    expect(hot.find(r => r.id === 'm1').photoRef).toBeNull();
    expect(hot.find(r => r.id === 'oikos')).toMatchObject({ item: 'Oikos Pro Plain', grams: 170, unit: 'g', amount: 170, version: 2 });
    const archive = yaml.load(fs.readFileSync(path.join(tree.root, 'archives/nutrilist/2026-08.yml'), 'utf8'));
    expect(archive).toEqual([expect.objectContaining({ id: 'arch', icon: 'pita-bread' })]);
    const catalog = yaml.load(fs.readFileSync(path.join(tree.root, 'food_catalog.yml'), 'utf8'));
    expect(catalog.find(e => e.id === 'c-feta').icon).toBe('feta-cubes');
    expect(catalog.find(e => e.id === 'c-oikos')).toMatchObject({ name: 'Oikos Pro Plain', normalizedName: 'oikos pro plain' });
    expect(catalog.find(e => e.id === 'c-oikos').usageByBucket.afternoon).toEqual({ count: 4, lastUsed: '2026-09-11', quantity: { grams: 170, unit: 'g', amount: 170 } });
    expect(catalog.map(e => e.id)).toEqual(['c-feta', 'c-oikos', 'c-pb']);
    expect(fs.existsSync(path.join(tree.root, '_backups/food_catalog.yml.tmp-1-abc'))).toBe(true);
    // The deleted row is recoverable from the tombstone and the backup.
    expect(Object.keys(yaml.load(fs.readFileSync(path.join(tree.root, 'ledger-deleted.yml'), 'utf8')))).toEqual(['m2']);
    expect(fs.existsSync(path.join(tree.base, 'backup/nutrilist.yml'))).toBe(true);
    expect(fs.existsSync(path.join(tree.base, 'backup/scan-repair.json'))).toBe(true);

    // The data changed, so the same report is refused.
    await expect(applyScanRepair(report, path.join(tree.base, 'backup-2'), { offline: true })).rejects.toThrow(/changed/);
  });

  it('refuses when a file changed after the report, and writes nothing', async () => {
    const report = JSON.parse(JSON.stringify(inspectScanRepair(tree.root, tree.inputs)));
    const hotPath = path.join(tree.root, 'nutrilist.yml');
    const rows = yaml.load(fs.readFileSync(hotPath, 'utf8'));
    rows[0].calories = 101;
    fs.writeFileSync(hotPath, yaml.dump(rows));
    const before = fs.readFileSync(hotPath);
    await expect(applyScanRepair(report, path.join(tree.base, 'backup'), { offline: true })).rejects.toThrow(/changed after review/);
    expect(fs.readFileSync(hotPath).equals(before)).toBe(true);
    expect(fs.existsSync(path.join(tree.base, 'backup'))).toBe(false);
  });

  it('refuses a report made without the icon table', async () => {
    const report = JSON.parse(JSON.stringify(inspectScanRepair(tree.root, tree.inputs)));
    report.inputs.iconTablePath = null;
    await expect(applyScanRepair(report, path.join(tree.base, 'backup'), { offline: true })).rejects.toThrow(/icon-table/);
  });
});

describe('verification failures name the backup to restore', () => {
  const entry = { id: 'a', name: 'A', icon: null, usageByBucket: { morning: { count: 1, quantity: { unit: 'ml', amount: 1 } } }, useCount: 1 };
  it('catalog: a field outside the plan changed', () => {
    expect(() => verifyCatalog([entry], [{ ...entry, useCount: 2 }], '/safe/backup')).toThrow(/outside the plan.*\/safe\/backup/);
  });
  it('catalog: planned fields may change', () => {
    expect(() => verifyCatalog([entry], [{ ...entry, icon: 'x', name: 'B', usageByBucket: { morning: { count: 1, quantity: { unit: 'g', amount: 5 } } } }], '/b')).not.toThrow();
  });
  it('catalog: ids or order changed', () => {
    expect(() => verifyCatalog([entry, { ...entry, id: 'b' }], [{ ...entry, id: 'b' }, entry], '/safe/backup')).toThrow(/ids or order.*\/safe\/backup/);
  });
  it('ledger: nutrition or row count changed, or no convergence', () => {
    const fresh = { survivingNutrientDigest: 'x', rowCount: 10, deleteIds: ['d'] };
    const clean = { survivingNutrientDigest: 'x', rowCount: 9, updates: [], deleteIds: [], catalog: { iconUpdates: [], renames: [], quantityUpdates: [] } };
    expect(() => verifyLedger(fresh, clean, '/b')).not.toThrow();
    expect(() => verifyLedger(fresh, { ...clean, survivingNutrientDigest: 'y' }, '/safe/backup')).toThrow(/Nutrition changed.*\/safe\/backup/);
    expect(() => verifyLedger(fresh, { ...clean, rowCount: 10 }, '/safe/backup')).toThrow(/Row count.*\/safe\/backup/);
    expect(() => verifyLedger(fresh, { ...clean, updates: [{}] }, '/safe/backup')).toThrow(/converge.*\/safe\/backup/);
  });
});
