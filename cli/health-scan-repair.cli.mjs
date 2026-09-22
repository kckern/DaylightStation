#!/usr/bin/env node
// health-scan-repair.cli.mjs — repair the ledger rows and catalog entries the
// 2026-09-22 scan data-quality audit found
// (docs/_wip/audits/2026-09-22-health-app-data-quality-audit.md).
//
// Plans (pure, backend/src/3_applications/health/ScanDataRepair.mjs):
//   ledger  - delete UPC re-fires (same day/meal/name/calories, <= 30 s apart)
//             and person-chosen ids; clear placeholder photoRefs; normalize
//             shouting UPC names (never a name a person set); fix mislabelled
//             ml servings from label grams; re-icon retired or reviewed icons.
//             Hot nutrilist.yml AND archives/nutrilist/*.yml.
//   catalog - re-icon non-offered icons, clear non-offered pins, normalize
//             names (skipping any that would collide).
//
// Same discipline as health-ledger-repair / health-group-repair: the dry run
// writes a report (never overwriting one); --apply takes that report, refuses
// if anything changed since, needs --offline (nutrition writers stopped,
// prod container included) and a NEW --backup directory outside the tree,
// verifies the backup, applies, and re-plans to prove convergence.
//
// Usage:
//   node cli/health-scan-repair.cli.mjs --nutrition-dir DIR --manifest ICON_MANIFEST.yml \
//     --icon-table REASSIGNMENT.yml --food-names FOOD_NAMES.yml [--delete-ids ID,ID] --report NEW.json
//   node cli/health-scan-repair.cli.mjs --apply REPORT.json --backup NEW_DIR --offline

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { inspectNutritionDirectory } from './health-ledger-repair.cli.mjs';
import { planScanDataRepair, planCatalogIconRepair } from '#apps/health/ScanDataRepair.mjs';
import { YamlNutriListDatastore } from '#adapters/persistence/yaml/YamlNutriListDatastore.mjs';
import { YamlFoodCatalogDatastore } from '#adapters/persistence/yaml/YamlFoodCatalogDatastore.mjs';
import { isPlaceholderImage, PLACEHOLDER_IMAGE_SHA256 } from '#adapters/nutribot/UPCGateway.mjs';
import { FoodCatalogEntry } from '#domains/health/entities/FoodCatalogEntry.mjs';
import { normalizeIconFoodName } from '#domains/nutrition/services/icons.mjs';
import { NUTRIENT_KEYS } from '#shared/contracts/health/foodQuantity.mjs';
import { saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';

/**
 * Label grams per serving, from the OFF `serving_size` strings in the audit.
 * Spring Mix (UPC 032601901400) confirmed 2026-09-22: OFF prints "2 cup (85 g)".
 */
export const LABEL_GRAMS = Object.freeze({ 'OIKOS PRO PLAIN': 170, 'Mexican Style 4 Cheese Blend': 28, 'Premium Kidney Beans': 130, 'Spring Mix': 85 });
/** The only duplicated-word collapse: name normalization keeps repeated words. */
export const RENAMES = Object.freeze({ 'Sharp Cheddar Cheddar Cheese': 'Sharp Cheddar Cheese' });
const RETIRED_ART_PREFIX = 'img/icons/food/';
const OWNER = 'repair-owner';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const values = data => Array.isArray(data) ? data : data && typeof data === 'object' ? Object.values(data) : [];
const readYaml = file => yaml.load(fs.readFileSync(file, 'utf8'));
const identity = row => row.uuid || row.id;

/** Hot file first, then archive months in order — the order mutateEntries reads. */
function ledgerRows(root, files) {
  const hot = files.filter(f => /^nutrilist\.ya?ml$/.test(f.relative));
  const archives = files.filter(f => /^archives\/nutrilist\/[^/]+\.ya?ml$/.test(f.relative));
  return [...hot, ...archives].flatMap(f => values(readYaml(path.join(root, f.relative))).map(row => ({ row, file: f.relative })));
}

function placeholderPhotoRefs(root, digests) {
  const dir = path.join(root, 'photos');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(name => name.endsWith('.jpg') && !name.endsWith('.thumb.jpg'))
    .filter(name => isPlaceholderImage(fs.readFileSync(path.join(dir, name)), digests)).map(name => name.slice(0, -'.jpg'.length)).sort();
}

/** The manifest's offered slugs. Flat-art entries are not offered (IconManifestStore drops them). */
function offeredIcons(manifestPath) {
  const manifest = readYaml(manifestPath) || {};
  return Object.entries(manifest.icons || {})
    .filter(([, entry]) => !(typeof entry?.path === 'string' && entry.path.startsWith(RETIRED_ART_PREFIX)))
    .map(([slug]) => slug).sort();
}

/** Reviewed reassignment table merged with the food-names map; food-names wins. */
function iconByName(iconTablePath, foodNamesPath) {
  const merged = {};
  for (const file of [iconTablePath, foodNamesPath]) {
    const map = file ? readYaml(file) || {} : {};
    for (const [name, slug] of Object.entries(map)) merged[normalizeIconFoodName(name)] = slug;
  }
  return merged;
}

/** Nutrients of the rows that survive, so apply can prove it changed none. */
function survivingNutrientDigest(rows, deleteIds) {
  const gone = new Set(deleteIds);
  const seen = new Set();
  const digestRows = [];
  for (const row of rows) {
    const id = identity(row);
    if (!id || gone.has(id) || seen.has(id)) continue;
    seen.add(id);
    digestRows.push([id, ...NUTRIENT_KEYS.map(key => row[key] ?? null)]);
  }
  return hash(JSON.stringify(digestRows.sort((a, b) => String(a[0]).localeCompare(String(b[0])))));
}

function staleTempFiles(root) {
  const live = path.join(root, 'food_catalog.yml');
  const liveMtime = fs.existsSync(live) ? fs.statSync(live).mtimeMs : Infinity;
  return fs.readdirSync(root).filter(name => /\.ya?ml\.tmp-/.test(name)).sort().map(name => {
    const stat = fs.statSync(path.join(root, name));
    return { name, bytes: stat.size, mtime: new Date(stat.mtimeMs).toISOString(), olderThanLive: stat.mtimeMs < liveMtime };
  });
}

/** Offline stores over the nutrition directory, constructed the way ledger repair does. */
function ledgerStore(root, logger) {
  return new YamlNutriListDatastore({
    dataService: { user: { resolveDir: relative => path.join(root, relative.replace(/^lifelog\/nutrition\//, '')) } },
    logger,
  });
}
/**
 * The catalog store reads and writes through `dataService.user.read/write`
 * (healthYaml.mjs). Stub them over an in-memory copy so every entry goes
 * through the store's own hydrate/dehydrate, then write the file ONCE.
 */
function bufferedCatalogStore(root) {
  const file = path.join(root, 'food_catalog.yml');
  let data = fs.existsSync(file) ? readYaml(file) : null;
  let dirty = false;
  const store = new YamlFoodCatalogDatastore({
    dataService: { user: {
      read: relative => (relative === YamlFoodCatalogDatastore.CATALOG_PATH ? structuredClone(data) : null),
      write: (relative, value) => {
        if (relative !== YamlFoodCatalogDatastore.CATALOG_PATH) return false;
        data = value; dirty = true; return true;
      },
    } },
    logger: { info() {}, warn() {} },
  });
  return { store, flush: () => { if (dirty) saveYamlToPathAtomic(file, data, { durable: true }); return dirty; } };
}

/**
 * Plan. Deterministic for unchanged inputs, so apply can regenerate and compare.
 * @param {string} directory - the user's lifelog/nutrition directory
 */
export function inspectScanRepair(directory, inputs) {
  const { manifestPath, iconTablePath = null, foodNamesPath = null, deleteIds = [],
    labelGrams = LABEL_GRAMS, renames = RENAMES, placeholderDigests = [...PLACEHOLDER_IMAGE_SHA256] } = inputs;
  const inventory = inspectNutritionDirectory(directory);
  const root = inventory.root;
  const located = ledgerRows(root, inventory.files);
  const rows = located.map(({ row }) => row);
  const offered = offeredIcons(manifestPath);
  const table = iconByName(iconTablePath, foodNamesPath);
  const placeholders = placeholderPhotoRefs(root, placeholderDigests);
  const ledger = planScanDataRepair(rows, { placeholderPhotoRefs: placeholders, labelGrams, iconByName: table,
    offered, deleteIds, renames });
  const catalogFile = path.join(root, 'food_catalog.yml');
  const catalogEntries = fs.existsSync(catalogFile) ? values(readYaml(catalogFile)) : [];
  const catalog = planCatalogIconRepair(catalogEntries, { iconByName: table, offered, renames });
  const fileOf = new Map();
  for (const { row, file } of located) {
    const id = identity(row);
    if (!fileOf.has(id)) fileOf.set(id, []);
    if (!fileOf.get(id).includes(file)) fileOf.get(id).push(file);
  }
  const archiveTouched = [...new Set([...ledger.deleteIds, ...ledger.updates.map(u => u.id)]
    .flatMap(id => fileOf.get(id) || []).filter(file => file.startsWith('archives/')))].sort();
  return {
    root,
    files: inventory.files,
    inputs: {
      manifestPath: path.resolve(manifestPath), manifestSha256: hash(fs.readFileSync(manifestPath)),
      iconTablePath: iconTablePath && path.resolve(iconTablePath), iconTableSha256: iconTablePath ? hash(fs.readFileSync(iconTablePath)) : null,
      foodNamesPath: foodNamesPath && path.resolve(foodNamesPath), foodNamesSha256: foodNamesPath ? hash(fs.readFileSync(foodNamesPath)) : null,
      deleteIds: [...deleteIds], labelGrams, renames, placeholderDigests,
    },
    offeredCount: offered.length,
    iconTableSize: Object.keys(table).length,
    placeholderPhotoRefs: placeholders,
    rowCount: ledger.report.rows,
    survivingNutrientDigest: survivingNutrientDigest(rows, ledger.deleteIds),
    archiveFilesTouched: archiveTouched,
    deleteIds: ledger.deleteIds,
    updates: ledger.updates,
    report: ledger.report,
    catalog,
    staleTempFiles: staleTempFiles(root),
  };
}

export function summarize(report) {
  const reasons = {};
  for (const update of report.updates) for (const reason of update.reasons) reasons[reason] = (reasons[reason] || 0) + 1;
  return {
    rows: report.rowCount,
    deletes: report.deleteIds.length,
    duplicates: report.report.duplicates.length,
    updates: report.updates.length,
    updatesByReason: reasons,
    archiveFilesTouched: report.archiveFilesTouched.length,
    emptyUpc: report.report.emptyUpc.length,
    manualNamesKept: report.report.manualNamesKept.length,
    mlUnresolved: report.report.mlUnresolved.length,
    catalogIconUpdates: report.catalog.iconUpdates.length,
    catalogRenames: report.catalog.renames.length,
    catalogRenamesSkipped: report.catalog.skippedRenames.length,
    staleTempFiles: report.staleTempFiles.length,
  };
}

function isOpen(file) {
  try { execFileSync('lsof', [file], { stdio: 'ignore' }); return true; }
  catch (error) { if (error.code === 'ENOENT') throw new Error('lsof is required to move stale temp files'); return false; }
}

export async function applyScanRepair(manifest, backupDirectory, { offline = false } = {}) {
  if (!offline) throw new Error('Stop all nutrition writers first (prod container included); apply requires --offline');
  const fresh = inspectScanRepair(manifest.root, manifest.inputs);
  if (JSON.stringify(fresh) !== JSON.stringify(manifest)) throw new Error('Data, inputs or plan changed after review; generate a fresh report');
  const backup = path.resolve(backupDirectory);
  if (backup === fresh.root || backup.startsWith(fresh.root + path.sep)) throw new Error('Backup must be outside the nutrition directory');
  fs.mkdirSync(backup, { recursive: false, mode: 0o700 }); // never overwrite an earlier backup
  for (const file of fresh.files) {
    const destination = path.join(backup, file.relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(fresh.root, file.relative), destination, fs.constants.COPYFILE_EXCL);
    if (hash(fs.readFileSync(destination)) !== file.sha256) throw new Error('Backup verification failed; no repair was applied');
  }
  fs.writeFileSync(path.join(backup, 'scan-repair.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });

  // Ledger: one validated mutation across the hot file and every archive month.
  const events = [];
  const logger = { info: (event, data) => events.push({ event, data }), warn: (event, data) => events.push({ event, data }) };
  const store = ledgerStore(fresh.root, logger);
  const result = (fresh.updates.length || fresh.deleteIds.length) ? await store.mutateEntries(OWNER, {
    updates: fresh.updates.map(({ reasons, ...update }) => update),
    deleteIds: fresh.deleteIds,
  }) : { affectedIds: [] };
  await store.syncNutriday(OWNER);

  // Catalog: entries go through the datastore's own save; the file is written once.
  const { store: catalog, flush } = bufferedCatalogStore(fresh.root);
  for (const update of fresh.catalog.iconUpdates) {
    const entry = await catalog.getById(update.id, OWNER);
    if (!entry) throw new Error(`Catalog entry vanished: ${update.id}; restore the verified backup`);
    entry.icon = update.icon;
    entry.iconOverride = update.iconOverride;
    await catalog.save(entry, OWNER);
  }
  for (const rename of fresh.catalog.renames) {
    const duplicate = await catalog.findByNormalizedName(rename.to, OWNER);
    if (duplicate && duplicate.id !== rename.id) throw new Error(`Rename would collide: ${rename.from} -> ${rename.to}`);
    const entry = await catalog.getById(rename.id, OWNER);
    entry.name = rename.to;
    entry.normalizedName = FoodCatalogEntry.normalize(rename.to);
    await catalog.save(entry, OWNER);
  }
  flush();

  // Verify: no nutrition changed on surviving rows, and a re-plan is empty.
  const after = inspectScanRepair(fresh.root, { ...fresh.inputs, deleteIds: [] });
  if (after.survivingNutrientDigest !== fresh.survivingNutrientDigest) throw new Error('Nutrition changed on surviving rows; keep writers stopped and restore the verified backup');
  if (after.rowCount !== fresh.rowCount - fresh.deleteIds.length) throw new Error('Row count is not the planned count; keep writers stopped and restore the verified backup');
  if (after.updates.length || after.deleteIds.length || after.catalog.iconUpdates.length || after.catalog.renames.length) {
    throw new Error('Repair did not converge; keep the backup and inspect a fresh report');
  }

  // The abandoned catalog temp file(s), now that writers are stopped.
  const moved = [];
  for (const temp of fresh.staleTempFiles) {
    const source = path.join(fresh.root, temp.name);
    if (!temp.olderThanLive || !fs.existsSync(source) || isOpen(source)) continue;
    const destination = path.join(fresh.root, '_backups', temp.name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (fs.existsSync(destination)) continue;
    fs.renameSync(source, destination);
    moved.push(temp.name);
  }
  return { deleted: fresh.deleteIds.length, changedRows: result.affectedIds.length,
    catalogIcons: fresh.catalog.iconUpdates.length, catalogRenames: fresh.catalog.renames.length, movedTempFiles: moved, backup };
}

export async function main(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--offline') options.offline = true;
    else if (['--nutrition-dir', '--manifest', '--icon-table', '--food-names', '--delete-ids', '--report', '--apply', '--backup'].includes(flag)) options[flag.slice(2)] = args[++i];
    else throw new Error('Usage: --nutrition-dir DIR --manifest PATH --icon-table PATH --food-names PATH [--delete-ids A,B] --report NEW.json | --apply REPORT.json --backup NEW_DIR --offline');
  }
  if (options.apply) {
    if (!options.backup) throw new Error('--backup is required');
    process.stdout.write(JSON.stringify(await applyScanRepair(JSON.parse(fs.readFileSync(options.apply, 'utf8')), options.backup, options)) + '\n');
    return;
  }
  if (!options['nutrition-dir'] || !options.manifest || !options.report) throw new Error('--nutrition-dir, --manifest and --report are required');
  const report = inspectScanRepair(options['nutrition-dir'], {
    manifestPath: options.manifest,
    iconTablePath: options['icon-table'] || null,
    foodNamesPath: options['food-names'] || null,
    deleteIds: options['delete-ids'] ? options['delete-ids'].split(',').map(s => s.trim()).filter(Boolean) : [],
  });
  fs.writeFileSync(options.report, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
  process.stdout.write(JSON.stringify(summarize(report), null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
