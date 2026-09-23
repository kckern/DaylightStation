#!/usr/bin/env node
// health-catalog-serving-repair.cli.mjs — give barcode foods back the label
// serving, product photo and icon their catalog entries never kept, clear the
// `{grams: 0, amount: 0}` portions quick-add remembered, and give the rows those
// quick-adds logged (amount null) the serving and photo
// (docs/_wip/plans/2026-09-23-health-today-ui-refresh-design.md §6).
//
// Plan: backend/src/3_applications/health/CatalogServingRepair.mjs (pure).
//
// DRY RUN BY DEFAULT: prints the summary and every change, writes nothing.
// --apply follows the discipline of health-scan-repair: nutrition writers
// stopped (--offline, prod container included — it holds the same tree), a NEW
// --backup directory outside the tree, verified before anything is written;
// catalog through the store's own hydrate/dehydrate, rows through one journaled
// mutateEntries with a cleanup-audit record (so Health > Settings history shows
// it and Undo works); then a re-plan must come back empty.
//
// Usage:
//   node cli/health-catalog-serving-repair.cli.mjs (--nutrition-dir DIR | --user ID) [--manifest ICON_MANIFEST.yml] [--json]
//   node cli/health-catalog-serving-repair.cli.mjs ... --apply --backup NEW_DIR --offline
//
// --user resolves $DAYLIGHT_BASE_PATH/data/users/ID/lifelog/nutrition; the
// manifest defaults to $DAYLIGHT_BASE_PATH/data/household/apps/health/icon-manifest.yml.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { planCatalogServingRepair } from '#apps/health/CatalogServingRepair.mjs';
import { manifestVocabulary } from '#apps/health/ScanDataRepair.mjs';
import { YamlNutriListDatastore } from '#adapters/persistence/yaml/YamlNutriListDatastore.mjs';
import { YamlFoodCatalogDatastore } from '#adapters/persistence/yaml/YamlFoodCatalogDatastore.mjs';
import { iconVocabulary } from '#domains/nutrition/services/icons.mjs';
import { saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';

const OWNER = 'repair-owner';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const values = data => Array.isArray(data) ? data : data && typeof data === 'object' ? Object.values(data) : [];
const readYaml = file => (fs.existsSync(file) ? yaml.load(fs.readFileSync(file, 'utf8')) : null);

/** The files this repair reads or writes, hot ledger first then archive months. */
function trackedFiles(root) {
  const archives = path.join(root, 'archives/nutrilist');
  const months = fs.existsSync(archives) ? fs.readdirSync(archives).filter(name => /\.ya?ml$/.test(name)).sort().map(name => `archives/nutrilist/${name}`) : [];
  return ['food_catalog.yml', 'nutrilist.yml', ...months, 'nutriday.yml', 'cleanup-audit.yml', 'ledger-revision.yml', 'ledger-transaction.yml']
    .filter(relative => fs.existsSync(path.join(root, relative)));
}

export function inspectCatalogServingRepair(directory, { manifestPath = null } = {}) {
  const root = fs.realpathSync(directory);
  const files = trackedFiles(root).map(relative => ({ relative, sha256: hash(fs.readFileSync(path.join(root, relative))) }));
  const rows = files.filter(f => /^(nutrilist\.ya?ml|archives\/nutrilist\/.+)$/.test(f.relative))
    .flatMap(f => values(readYaml(path.join(root, f.relative))));
  const entries = values(readYaml(path.join(root, 'food_catalog.yml')));
  let vocabulary = null;
  if (manifestPath) {
    const manifest = readYaml(manifestPath) || {};
    const { offered } = manifestVocabulary(manifest);
    const foodNames = Object.fromEntries(Object.entries(manifest.foodNames || {}).filter(([, slug]) => slug === null || offered.includes(slug)));
    vocabulary = iconVocabulary(offered.join(' '), foodNames);
  }
  const photoExists = ref => /^ph_[A-Za-z0-9_-]+$/.test(ref) && fs.existsSync(path.join(root, 'photos', `${ref}.jpg`));
  const plan = planCatalogServingRepair({ entries, rows, photoExists, vocabulary });
  return { root, files, manifestPath: manifestPath && path.resolve(manifestPath),
    manifestSha256: manifestPath ? hash(fs.readFileSync(manifestPath)) : null, rowCount: rows.length, ...plan };
}

export function summarize(report) {
  return { ...report.report, unresolved: report.report.unresolved.length, catalogUpdates: report.catalogUpdates.length,
    rowUpdates: report.rowUpdates.length };
}

/** Catalog store over an in-memory copy, so every entry goes through hydrate/dehydrate and the file is written once. */
function bufferedCatalogStore(root) {
  const file = path.join(root, 'food_catalog.yml');
  let data = readYaml(file);
  let dirty = false;
  const store = new YamlFoodCatalogDatastore({
    dataService: { user: {
      read: relative => (relative === YamlFoodCatalogDatastore.CATALOG_PATH ? structuredClone(data) : null),
      write: (relative, value) => { if (relative !== YamlFoodCatalogDatastore.CATALOG_PATH) return false; data = value; dirty = true; return true; },
    } },
    logger: { info() {}, warn() {} },
  });
  return { store, flush: () => { if (dirty) saveYamlToPathAtomic(file, data, { durable: true }); return dirty; } };
}

export async function applyCatalogServingRepair(directory, backupDirectory, { offline = false, manifestPath = null } = {}) {
  if (!offline) throw new Error('Stop all nutrition writers first (prod container included); apply requires --offline');
  const fresh = inspectCatalogServingRepair(directory, { manifestPath });
  const backup = path.resolve(backupDirectory);
  if (backup === fresh.root || backup.startsWith(fresh.root + path.sep)) throw new Error('Backup must be outside the nutrition directory');
  if (readYaml(path.join(fresh.root, 'ledger-transaction.yml'))?.pending) throw new Error('Recover the pending ledger transaction before repairing');
  fs.mkdirSync(backup, { recursive: false, mode: 0o700 }); // never overwrite an earlier backup
  for (const file of fresh.files) {
    const destination = path.join(backup, file.relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(fresh.root, file.relative), destination, fs.constants.COPYFILE_EXCL);
    if (hash(fs.readFileSync(destination)) !== file.sha256) throw new Error('Backup verification failed; no repair was applied');
  }
  fs.writeFileSync(path.join(backup, 'catalog-serving-repair.json'), JSON.stringify(fresh, null, 2), { flag: 'wx', mode: 0o600 });

  // 1. Catalog, built in memory. Saving through the store also drops every
  //    stored {grams: 0, amount: 0} portion (hydration reads it as absent).
  const { store, flush } = bufferedCatalogStore(fresh.root);
  for (const update of fresh.catalogUpdates) {
    const entry = await store.getById(update.id, OWNER);
    if (!entry) throw new Error(`Catalog entry ${update.id} is missing; nothing was written`);
    if (update.changes.serving) entry.serving = update.changes.serving;
    if (update.changes.photoRef) entry.photoRef = update.changes.photoRef;
    if (update.changes.icon && !entry.icon && !entry.iconOverride) entry.icon = update.changes.icon;
    await store.save(entry, OWNER);
  }

  // 2. Rows: one journaled mutation with an audit record. Only quantity and
  //    photo change, never nutrition, so the day summaries are kept as they were.
  const nutridayFile = path.join(fresh.root, 'nutriday.yml');
  const nutridayBefore = readYaml(nutridayFile);
  let result = { affectedIds: [], affectedDates: [] };
  if (fresh.rowUpdates.length) {
    const ledger = new YamlNutriListDatastore({
      dataService: { user: { resolveDir: relative => path.join(fresh.root, relative.replace(/^lifelog\/nutrition\//, '')) } },
      logger: { info() {}, warn() {}, debug() {} },
    });
    const operation = hash(JSON.stringify(fresh.rowUpdates)).slice(0, 24);
    result = await ledger.mutateEntries(OWNER, {
      updates: fresh.rowUpdates.map(({ id, expectedVersion, changes }) => ({ id, expectedVersion, changes })),
      audit: { id: `catalog-serving-${operation}`, fingerprint: operation, actor: 'catalog-serving-repair',
        reason: 'Quick-added barcode food had no quantity; restored the label serving and product photo from its original scan',
        evidence: fresh.catalogUpdates.flatMap(update => update.evidence.map(id => ({ id, kind: 'capture', entryId: update.id }))),
        at: new Date().toISOString() },
    });
    if (nutridayBefore) saveYamlToPathAtomic(nutridayFile, nutridayBefore, { durable: true });
  }
  flush();

  // 3. Convergence: a fresh plan has nothing left to do.
  const after = inspectCatalogServingRepair(fresh.root, { manifestPath });
  if (after.rowUpdates.length || after.catalogUpdates.some(update => Object.keys(update.changes).length || update.clearedBuckets.length)) {
    throw new Error(`Repair did not converge; keep writers stopped and restore by copying ${backup} back over the nutrition directory`);
  }
  const outcome = { catalogUpdates: fresh.catalogUpdates.length, rowsChanged: result.affectedIds.length, affectedDates: result.affectedDates, backup };
  fs.writeFileSync(path.join(backup, 'catalog-serving-repair-result.json'), JSON.stringify(outcome, null, 2), { flag: 'wx', mode: 0o600 });
  return outcome;
}

export async function main(args, { env = process.env, out = process.stdout } = {}) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (['--offline', '--apply', '--json'].includes(flag)) options[flag.slice(2)] = true;
    else if (['--nutrition-dir', '--user', '--manifest', '--backup'].includes(flag)) options[flag.slice(2)] = args[++i];
    else throw new Error('Usage: (--nutrition-dir DIR | --user ID) [--manifest PATH] [--json] [--apply --backup NEW_DIR --offline]');
  }
  const base = env.DAYLIGHT_BASE_PATH ? path.join(env.DAYLIGHT_BASE_PATH, 'data') : null;
  const directory = options['nutrition-dir'] || (options.user && base ? path.join(base, 'users', options.user, 'lifelog/nutrition') : null);
  if (!directory) throw new Error('--nutrition-dir, or --user with DAYLIGHT_BASE_PATH set, is required');
  const defaultManifest = base ? path.join(base, 'household/apps/health/icon-manifest.yml') : null;
  const manifestPath = options.manifest || (defaultManifest && fs.existsSync(defaultManifest) ? defaultManifest : null);
  if (options.apply) {
    if (!options.backup) throw new Error('--backup is required with --apply');
    out.write(JSON.stringify(await applyCatalogServingRepair(directory, options.backup, { offline: options.offline, manifestPath }), null, 2) + '\n');
    return;
  }
  const report = inspectCatalogServingRepair(directory, { manifestPath });
  const view = options.json ? report : {
    mode: 'dry-run (nothing written; --apply --backup NEW_DIR --offline to write)',
    manifest: manifestPath, summary: summarize(report),
    catalogUpdates: report.catalogUpdates.filter(update => Object.keys(update.changes).length)
      .map(({ id, name, changes, clearedBuckets }) => ({ id, name, changes, clearedBuckets })),
    zeroPortionsClearedOn: report.catalogUpdates.filter(update => update.clearedBuckets.length).map(update => `${update.name} (${update.clearedBuckets.join(', ')})`),
    rowUpdates: report.rowUpdates.map(({ id, name, date, changes }) => ({ id, name, date, changes })),
    unresolved: report.report.unresolved,
  };
  out.write(JSON.stringify(view, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
