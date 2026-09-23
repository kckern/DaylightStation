#!/usr/bin/env node
// health-scan-repair.cli.mjs — repair the ledger rows and catalog entries the
// 2026-09-22 scan data-quality audit found
// (docs/_wip/audits/2026-09-22-health-app-data-quality-audit.md).
//
// Plans (pure, backend/src/3_applications/health/ScanDataRepair.mjs):
//   ledger  - delete UPC re-fires (same day/meal/name/calories, <= 30 s apart)
//             and person-chosen ids; clear placeholder photoRefs; normalize
//             shouting UPC names (never a name a person set); fix mislabelled
//             ml servings from label grams; restore legacy quantities (rows
//             with no grams/amount but calories: a metric volume from
//             originalQuantity verbatim, else originalQuantity.amount as grams
//             when the implied kcal/g is plausible, tagged
//             quantityProvenance {source: legacy-amount}); re-icon retired or
//             reviewed icons.
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
import { planScanDataRepair, planCatalogIconRepair, manifestVocabulary } from '#apps/health/ScanDataRepair.mjs';
import { YamlNutriListDatastore } from '#adapters/persistence/yaml/YamlNutriListDatastore.mjs';
import { YamlFoodCatalogDatastore } from '#adapters/persistence/yaml/YamlFoodCatalogDatastore.mjs';
import { isPlaceholderImage, PLACEHOLDER_IMAGE_SHA256 } from '#adapters/nutribot/UPCGateway.mjs';
import { FoodCatalogEntry, usableQuantity } from '#domains/health/entities/FoodCatalogEntry.mjs';
import { normalizeIconFoodName } from '#domains/nutrition/services/icons.mjs';
import { NUTRIENT_KEYS } from '#shared/contracts/health/foodQuantity.mjs';
import { saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';

/**
 * Label grams per serving, from the OFF `serving_size` strings in the audit.
 * Spring Mix (UPC 032601901400) confirmed 2026-09-22: OFF prints "2 cup (85 g)".
 */
export const LABEL_GRAMS = Object.freeze({ 'OIKOS PRO PLAIN': 170, 'Mexican Style 4 Cheese Blend': 28, 'Premium Kidney Beans': 130, 'Spring Mix': 85 });
/**
 * Explicit renames. The duplicated-word collapse lives only here (name
 * normalization keeps repeated words), as do brand names the normalizer keeps
 * partly in capitals because a short word looks like an acronym.
 */
export const RENAMES = Object.freeze({
  'Sharp Cheddar Cheddar Cheese': 'Sharp Cheddar Cheese',
  'HOT POCKETS Pepperoni Pizza': 'Hot Pockets Pepperoni Pizza',
  'OIKOS PRO Vanilla': 'Oikos Pro Vanilla',
});
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
  return fs.readdirSync(root).filter(name => name.startsWith('food_catalog.yml.tmp-')).sort().map(name => {
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
  return {
    store,
    snapshot: () => structuredClone(data),
    flush: () => { if (dirty) saveYamlToPathAtomic(file, data, { durable: true }); return dirty; },
  };
}

/**
 * Plan. Deterministic for unchanged inputs, so apply can regenerate and compare.
 * @param {string} directory - the user's lifelog/nutrition directory
 */
export function inspectScanRepair(directory, inputs) {
  if (!inputs?.iconTablePath) throw new Error('--icon-table is required: without the reviewed table every retired icon falls through to default');
  const { manifestPath, iconTablePath, foodNamesPath = null, deleteIds = [],
    labelGrams = LABEL_GRAMS, renames = RENAMES, placeholderDigests = [...PLACEHOLDER_IMAGE_SHA256] } = inputs;
  const inventory = inspectNutritionDirectory(directory);
  const root = inventory.root;
  const located = ledgerRows(root, inventory.files);
  const rows = located.map(({ row }) => row);
  const { offered, aliases } = manifestVocabulary(readYaml(manifestPath) || {});
  const table = iconByName(iconTablePath, foodNamesPath);
  const placeholders = placeholderPhotoRefs(root, placeholderDigests);
  const ledger = planScanDataRepair(rows, { placeholderPhotoRefs: placeholders, labelGrams, iconByName: table,
    offered, aliases, deleteIds, renames });
  const catalogFile = path.join(root, 'food_catalog.yml');
  const catalogEntries = fs.existsSync(catalogFile) ? values(readYaml(catalogFile)) : [];
  const catalog = planCatalogIconRepair(catalogEntries, { iconByName: table, offered, aliases, renames,
    labelGrams, labelServingMl: ledger.report.labelServingMl });
  const fileOf = new Map();
  for (const { row, file } of located) {
    const id = identity(row);
    if (!fileOf.has(id)) fileOf.set(id, []);
    if (!fileOf.get(id).includes(file)) fileOf.get(id).push(file);
  }
  const dateOf = new Map(located.map(({ row }) => [identity(row), row.date]));
  const deleteDates = [...new Set(ledger.deleteIds.map(id => dateOf.get(id)).filter(Boolean))].sort();
  const archiveTouched = [...new Set([...ledger.deleteIds, ...ledger.updates.map(u => u.id)]
    .flatMap(id => fileOf.get(id) || []).filter(file => file.startsWith('archives/')))].sort();
  return {
    root,
    files: inventory.files,
    inputs: {
      manifestPath: path.resolve(manifestPath), manifestSha256: hash(fs.readFileSync(manifestPath)),
      iconTablePath: path.resolve(iconTablePath), iconTableSha256: hash(fs.readFileSync(iconTablePath)),
      foodNamesPath: foodNamesPath && path.resolve(foodNamesPath), foodNamesSha256: foodNamesPath ? hash(fs.readFileSync(foodNamesPath)) : null,
      deleteIds: [...deleteIds], labelGrams, renames, placeholderDigests,
    },
    offeredCount: offered.length,
    aliases,
    iconTableSize: Object.keys(table).length,
    placeholderPhotoRefs: placeholders,
    rowCount: ledger.report.rows,
    survivingNutrientDigest: survivingNutrientDigest(rows, ledger.deleteIds),
    archiveFilesTouched: archiveTouched,
    deleteIds: ledger.deleteIds,
    deleteDates,
    updates: ledger.updates,
    report: ledger.report,
    catalog,
    staleTempFiles: staleTempFiles(root),
  };
}

const total = counts => Object.values(counts || {}).reduce((sum, n) => sum + n, 0);

export function summarize(report) {
  const reasons = {};
  for (const update of report.updates) for (const reason of update.reasons) reasons[reason] = (reasons[reason] || 0) + 1;
  return {
    rows: report.rowCount,
    deletes: report.deleteIds.length,
    reFires: report.report.duplicates.map(d => ({ id: d.id, keptId: d.keptId, name: d.name, date: d.date, secondsAfter: d.secondsAfter })),
    updates: report.updates.length,
    updatesByReason: reasons,
    retiredFellThroughToDefault: total(report.report.fellThroughToDefault),
    retiredFellThroughToDefaultBySlug: report.report.fellThroughToDefault,
    archiveFilesTouched: report.archiveFilesTouched.length,
    emptyUpc: report.report.emptyUpc.length,
    manualNamesKept: report.report.manualNamesKept.length,
    mlUnresolved: report.report.mlUnresolved.length,
    legacyQuantityByKind: report.report.legacyQuantity.reduce((counts, entry) => ({ ...counts, [entry.kind]: (counts[entry.kind] || 0) + 1 }), {}),
    legacyQuantityUnresolved: report.report.legacyQuantityUnresolved.length,
    catalogIconUpdates: report.catalog.iconUpdates.length,
    catalogRetiredFellThroughToNull: total(report.catalog.fellThroughToNull),
    catalogPinsCleared: total(report.catalog.pinsCleared),
    catalogRenames: report.catalog.renames.length,
    catalogRenamesSkipped: report.catalog.skippedRenames.length,
    catalogQuantityUpdates: report.catalog.quantityUpdates.length,
    catalogQuantityUnresolved: report.catalog.quantityUnresolved.length,
    staleTempFiles: report.staleTempFiles.length,
  };
}

function isOpen(file) {
  try { execFileSync('lsof', [file], { stdio: 'ignore' }); return true; }
  catch (error) { if (error.code === 'ENOENT') throw new Error('lsof is required to move stale temp files'); return false; }
}

const restoreHint = backup => `keep writers stopped and restore by copying ${backup} back over the nutrition directory`;

/**
 * Everything on a catalog entry except what the repair may change: icon,
 * iconOverride, name, normalizedName and the remembered bucket quantities.
 */
function catalogInvariant(entries) {
  return values(entries).map(entry => {
    const { icon, iconOverride, name, normalizedName, usageByBucket, ...rest } = entry;
    const buckets = Object.fromEntries(Object.entries(usageByBucket || {})
      .map(([bucket, usage]) => { const { quantity, ...kept } = usage || {}; return [bucket, kept]; }));
    return { ...rest, usageByBucket: buckets };
  });
}

/** Same ids in the same order, and nothing but the planned fields changed. */
export function verifyCatalog(before, after, backup) {
  const ids = list => values(list).map(entry => entry.id);
  if (JSON.stringify(ids(before)) !== JSON.stringify(ids(after))) {
    throw new Error(`Catalog entries changed (ids or order); ${restoreHint(backup)}`);
  }
  if (hash(JSON.stringify(catalogInvariant(before))) !== hash(JSON.stringify(catalogInvariant(after)))) {
    throw new Error(`Catalog fields outside the plan changed; ${restoreHint(backup)}`);
  }
}

export function verifyLedger(fresh, after, backup) {
  if (after.survivingNutrientDigest !== fresh.survivingNutrientDigest) throw new Error(`Nutrition changed on surviving rows; ${restoreHint(backup)}`);
  if (after.rowCount !== fresh.rowCount - fresh.deleteIds.length) throw new Error(`Row count is not the planned count; ${restoreHint(backup)}`);
  if (after.updates.length || after.deleteIds.length || after.catalog.iconUpdates.length || after.catalog.renames.length
    || after.catalog.quantityUpdates.length) {
    throw new Error(`Repair did not converge; ${restoreHint(backup)}`);
  }
}

function nutridayChanges(before, after) {
  return [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].sort()
    .filter(date => JSON.stringify(before?.[date]) !== JSON.stringify(after?.[date]))
    .map(date => ({ date, before: before?.[date] ?? null, after: after?.[date] ?? null }));
}

export async function applyScanRepair(manifest, backupDirectory, { offline = false } = {}) {
  if (!offline) throw new Error('Stop all nutrition writers first (prod container included); apply requires --offline');
  if (!manifest?.inputs?.iconTablePath) throw new Error('The report was made without --icon-table; regenerate it with the reviewed table');
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

  // 1. Build and validate EVERY catalog change in memory before anything is
  //    written, so a catalog refusal leaves both files untouched.
  const catalogFile = path.join(fresh.root, 'food_catalog.yml');
  const catalogRaw = fs.existsSync(catalogFile) ? readYaml(catalogFile) : [];
  const { store: catalog, flush, snapshot } = bufferedCatalogStore(fresh.root);
  // Any save rewrites every entry through the store's hydrate/dehydrate. Take
  // the baseline AFTER one unchanged save, so verification compares like with
  // like; entries that round trip changes are counted in the result.
  const existing = await catalog.getAll(OWNER);
  if (existing.length) await catalog.save(existing[0], OWNER);
  const catalogBefore = existing.length ? snapshot() : catalogRaw;
  const roundTripChanged = values(catalogRaw).filter((entry, index) => JSON.stringify(entry) !== JSON.stringify(values(catalogBefore)[index])).length;
  const entryFor = async id => {
    const entry = await catalog.getById(id, OWNER);
    if (!entry) throw new Error(`Catalog entry ${id} is missing; nothing was written`);
    return entry;
  };
  for (const update of fresh.catalog.iconUpdates) {
    const entry = await entryFor(update.id);
    entry.icon = update.icon;
    entry.iconOverride = update.iconOverride;
    await catalog.save(entry, OWNER);
  }
  for (const rename of fresh.catalog.renames) {
    const duplicate = await catalog.findByNormalizedName(rename.to, OWNER);
    if (duplicate && duplicate.id !== rename.id) throw new Error(`Rename would collide: ${rename.from} -> ${rename.to}; nothing was written`);
    const entry = await entryFor(rename.id);
    entry.name = rename.to;
    entry.normalizedName = FoodCatalogEntry.normalize(rename.to);
    await catalog.save(entry, OWNER);
  }
  for (const change of fresh.catalog.quantityUpdates) {
    const entry = await entryFor(change.id);
    const usage = entry.usageByBucket?.[change.bucket];
    // Compared as the entity reads them: hydration turns a stored `grams: 0` into null.
    if (JSON.stringify(usableQuantity(usage?.quantity)) !== JSON.stringify(usableQuantity(change.from))) throw new Error(`Catalog portion for ${change.id}/${change.bucket} changed; nothing was written`);
    usage.quantity = { ...change.to };
    await catalog.save(entry, OWNER);
  }

  // 2. Ledger: one validated, journaled mutation across the hot file and
  //    every archive month. It recomputes nutriday for the affected dates only.
  const nutridayFile = path.join(fresh.root, 'nutriday.yml');
  const nutridayBefore = fs.existsSync(nutridayFile) ? readYaml(nutridayFile) : {};
  const events = [];
  const logger = { info: (event, data) => events.push({ event, data }), warn: (event, data) => events.push({ event, data }) };
  const result = (fresh.updates.length || fresh.deleteIds.length) ? await ledgerStore(fresh.root, logger).mutateEntries(OWNER, {
    updates: fresh.updates.map(({ reasons, ...update }) => update),
    deleteIds: fresh.deleteIds,
  }) : { affectedIds: [], affectedDates: [] };
  // mutateEntries recomputes the daily summary of every affected date. Only a
  // delete changes a day's totals; an icon, photo, name or unit fix does not,
  // and recomputing old summaries rewrites them with today's rounding. Every
  // other date keeps the summary it had.
  const nutridayRecomputed = fs.existsSync(nutridayFile) ? readYaml(nutridayFile) || {} : {};
  const keep = new Set(fresh.deleteDates);
  const nutridayKept = {};
  for (const date of new Set([...Object.keys(nutridayBefore || {}), ...Object.keys(nutridayRecomputed)])) {
    const source = keep.has(date) ? nutridayRecomputed : nutridayBefore;
    if (source && Object.hasOwn(source, date)) nutridayKept[date] = source[date];
  }
  if (JSON.stringify(nutridayKept) !== JSON.stringify(nutridayRecomputed)) saveYamlToPathAtomic(nutridayFile, nutridayKept, { durable: true });

  // 3. Catalog, written once, then verified field by field.
  flush();
  verifyCatalog(catalogBefore, fs.existsSync(catalogFile) ? readYaml(catalogFile) : [], backup);

  // 4. Ledger verification: no nutrition changed on surviving rows, and a
  //    re-plan (without the already-applied person-chosen deletes) is empty.
  verifyLedger(fresh, inspectScanRepair(fresh.root, { ...fresh.inputs, deleteIds: [] }), backup);
  const nutriday = nutridayChanges(nutridayBefore, fs.existsSync(nutridayFile) ? readYaml(nutridayFile) : {});

  // 5. The abandoned catalog temp file(s), now that writers are stopped.
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
  const outcome = { deleted: fresh.deleteIds.length, changedRows: result.affectedIds.length, affectedDates: result.affectedDates,
    nutridayChanged: nutriday.map(change => change.date), nutriday,
    catalogIcons: fresh.catalog.iconUpdates.length, catalogRenames: fresh.catalog.renames.length,
    catalogQuantities: fresh.catalog.quantityUpdates.length, catalogRoundTripChanged: roundTripChanged,
    movedTempFiles: moved, backup };
  fs.writeFileSync(path.join(backup, 'scan-repair-result.json'), JSON.stringify(outcome, null, 2), { flag: 'wx', mode: 0o600 });
  return outcome;
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
    const { nutriday, ...result } = await applyScanRepair(JSON.parse(fs.readFileSync(options.apply, 'utf8')), options.backup, options);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }
  if (!options['nutrition-dir'] || !options.manifest || !options['icon-table'] || !options.report) {
    throw new Error('--nutrition-dir, --manifest, --icon-table and --report are required');
  }
  const report = inspectScanRepair(options['nutrition-dir'], {
    manifestPath: options.manifest,
    iconTablePath: options['icon-table'],
    foodNamesPath: options['food-names'] || null,
    deleteIds: options['delete-ids'] ? options['delete-ids'].split(',').map(s => s.trim()).filter(Boolean) : [],
  });
  fs.writeFileSync(options.report, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
  process.stdout.write(JSON.stringify(summarize(report), null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
