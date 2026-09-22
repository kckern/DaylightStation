import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
import { inspectScanRepair, applyScanRepair, summarize } from './health-scan-repair.cli.mjs';

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
  ]);
  write('archives/nutrilist/2026-08.yml', [
    row('arch', 'Pita Bread', { date: '2026-08-01', icon: 'pitasandwich', review: { source: 'text', startedAt: '2026-08-01T12:00:00.000Z' } }),
  ]);
  write('food_catalog.yml', [
    catalogEntry('c-feta', 'Feta Cheese', { icon: 'cheese' }),
    catalogEntry('c-oikos', 'OIKOS PRO PLAIN', { icon: 'yogurt' }),
  ]);
  fs.mkdirSync(path.join(root, 'photos'));
  fs.writeFileSync(path.join(root, 'photos/ph_stock.jpg'), 'stock art');
  fs.writeFileSync(path.join(root, 'photos/ph_stock.thumb.jpg'), 'stock thumb');
  fs.writeFileSync(path.join(root, 'food_catalog.yml.tmp-1-abc'), 'abandoned');
  const old = new Date('2026-09-11T08:19:00Z');
  fs.utimesSync(path.join(root, 'food_catalog.yml.tmp-1-abc'), old, old);
  const manifestPath = path.join(base, 'icon-manifest.yml');
  fs.writeFileSync(manifestPath, yaml.dump({
    icons: { 'feta-cubes': { path: 'img/nutrition/icons/cheese/feta-cubes.png' }, 'pita-bread': { path: 'img/nutrition/icons/bakery/pita-bread.png' },
      yogurt: { path: 'img/nutrition/icons/dairy/yogurt.png' }, cheese: { path: 'img/icons/food/cheese.png' } },
    aliases: {},
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
    expect(report.catalog.iconUpdates.map(u => [u.id, u.icon])).toEqual([['c-feta', 'feta-cubes']]);
    expect(report.catalog.renames).toEqual([{ id: 'c-oikos', from: 'OIKOS PRO PLAIN', to: 'Oikos Pro Plain' }]);
    expect(report.staleTempFiles).toEqual([expect.objectContaining({ name: 'food_catalog.yml.tmp-1-abc', olderThanLive: true })]);
    expect(summarize(report)).toMatchObject({ deletes: 1, updates: 4, emptyUpc: 0, catalogIconUpdates: 1, catalogRenames: 1 });
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
    expect(result).toMatchObject({ deleted: 1, catalogIcons: 1, catalogRenames: 1, movedTempFiles: ['food_catalog.yml.tmp-1-abc'] });

    const hot = yaml.load(fs.readFileSync(path.join(tree.root, 'nutrilist.yml'), 'utf8'));
    expect(hot.map(r => r.id)).toEqual(['m1', 'oikos', 'feta']);
    expect(hot.find(r => r.id === 'm1').photoRef).toBeNull();
    expect(hot.find(r => r.id === 'oikos')).toMatchObject({ item: 'Oikos Pro Plain', grams: 170, unit: 'g', amount: 170, version: 2 });
    const archive = yaml.load(fs.readFileSync(path.join(tree.root, 'archives/nutrilist/2026-08.yml'), 'utf8'));
    expect(archive).toEqual([expect.objectContaining({ id: 'arch', icon: 'pita-bread' })]);
    const catalog = yaml.load(fs.readFileSync(path.join(tree.root, 'food_catalog.yml'), 'utf8'));
    expect(catalog.find(e => e.id === 'c-feta').icon).toBe('feta-cubes');
    expect(catalog.find(e => e.id === 'c-oikos')).toMatchObject({ name: 'Oikos Pro Plain', normalizedName: 'oikos pro plain' });
    expect(fs.existsSync(path.join(tree.root, '_backups/food_catalog.yml.tmp-1-abc'))).toBe(true);
    // The deleted row is recoverable from the tombstone and the backup.
    expect(Object.keys(yaml.load(fs.readFileSync(path.join(tree.root, 'ledger-deleted.yml'), 'utf8')))).toEqual(['m2']);
    expect(fs.existsSync(path.join(tree.base, 'backup/nutrilist.yml'))).toBe(true);
    expect(fs.existsSync(path.join(tree.base, 'backup/scan-repair.json'))).toBe(true);

    // The data changed, so the same report is refused.
    await expect(applyScanRepair(report, path.join(tree.base, 'backup-2'), { offline: true })).rejects.toThrow(/changed/);
  });
});
