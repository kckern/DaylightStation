#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { planNutritionRepair } from '#apps/health/NutritionRepair.mjs';
import { YamlNutriListDatastore } from '#adapters/persistence/yaml/YamlNutriListDatastore.mjs';
import { NUTRIENT_KEYS } from '#shared/contracts/health/foodQuantity.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function filesIn(root, relative = '') {
  return fs.readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap(entry => {
    // macOS AppleDouble sidecars are binary metadata, not nutrition YAML.
    if (entry.name.startsWith('._')) return [];
    if (entry.isSymbolicLink()) throw new Error('Repair refuses symbolic links');
    const name = path.join(relative, entry.name);
    return entry.isDirectory() ? filesIn(root, name) : /\.ya?ml$/.test(entry.name) ? [name] : [];
  }).sort();
}
const values = data => Array.isArray(data) ? data : data && typeof data === 'object' ? Object.values(data) : [];

export function inspectNutritionDirectory(directory) {
  const root = fs.realpathSync(directory);
  const rows = [], captureItems = [], files = [];
  for (const relative of filesIn(root)) {
    const bytes = fs.readFileSync(path.join(root, relative));
    let data;
    try { data = yaml.load(bytes.toString('utf8')); }
    catch { throw new Error(`Unreadable YAML: ${relative}. Repair stopped without changes.`); }
    files.push({ relative, sha256: hash(bytes) });
    if (/^(nutrilist\.ya?ml|archives\/nutrilist\/[^/]+\.ya?ml)$/.test(relative)) rows.push(...values(data));
    if (/^(nutrilog\.ya?ml|archives\/nutrilog\/[^/]+\.ya?ml)$/.test(relative)) {
      for (const log of values(data)) captureItems.push(...(log.items || []));
    }
    if (/ledger-transaction\.ya?ml$/.test(relative) && data?.pending) throw new Error('Recover the pending ledger transaction before planning repair');
  }
  const nutrientDigest = hash(JSON.stringify(rows.map(row => [row.uuid || row.id,
    ...NUTRIENT_KEYS.map(key => row[key])]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))));
  return { root, files, nutrientDigest, ...planNutritionRepair(rows, captureItems) };
}

export async function applyNutritionRepair(manifest, backupDirectory, { offline = false } = {}) {
  if (!offline) throw new Error('Stop all nutrition writers first; apply requires --offline');
  const current = inspectNutritionDirectory(manifest.root);
  if (JSON.stringify(current) !== JSON.stringify(manifest)) throw new Error('Data or repair plan changed after review; generate a fresh manifest');
  const backup = path.resolve(backupDirectory);
  if (backup === current.root || backup.startsWith(current.root + path.sep)) throw new Error('Backup must be outside the nutrition directory');
  fs.mkdirSync(backup, { recursive: false, mode: 0o700 }); // never overwrite an earlier backup
  for (const file of current.files) {
    const destination = path.join(backup, file.relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(current.root, file.relative), destination, fs.constants.COPYFILE_EXCL);
    if (hash(fs.readFileSync(destination)) !== file.sha256) throw new Error('Backup verification failed');
  }
  fs.writeFileSync(path.join(backup, 'repair-manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
  const events = [];
  const store = new YamlNutriListDatastore({
    dataService: { user: { resolveDir: relative => path.join(current.root, relative.replace(/^lifelog\/nutrition\//, '')) } },
    logger: { info: (event, data) => events.push({ event, data }), warn: (event, data) => events.push({ event, data }) },
  });
  const result = current.updates.length ? await store.mutateEntries('repair-owner', {
    updates: current.updates.map(({ evidence, ...update }) => update),
  }) : { affectedIds: [], affectedDates: [] };
  await store.syncNutriday('repair-owner');
  const after = inspectNutritionDirectory(current.root);
  if (after.rowCount !== current.rowCount || after.nutrientDigest !== current.nutrientDigest) {
    throw new Error('Row count or nutrition changed; keep writers stopped and recover from the verified backup');
  }
  if (after.updates.length) throw new Error('Repair did not converge; keep backup and inspect the report');
  return { changed: result.affectedIds.length, unresolved: after.unresolved, backup, events };
}

export async function main(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--offline') options.offline = true;
    else if (['--nutrition-dir', '--report', '--apply', '--backup'].includes(flag)) options[flag.slice(2)] = args[++i];
    else throw new Error('Usage: --nutrition-dir DIR --report NEW.json | --apply MANIFEST.json --backup NEW_DIR --offline');
  }
  if (options.apply) {
    if (!options.backup) throw new Error('--backup is required');
    const result = await applyNutritionRepair(JSON.parse(fs.readFileSync(options.apply, 'utf8')), options.backup, options);
    process.stdout.write(JSON.stringify({ changed: result.changed, unresolved: result.unresolved.length, backup: result.backup }) + '\n');
  } else {
    if (!options['nutrition-dir'] || !options.report) throw new Error('--nutrition-dir and --report are required');
    const report = inspectNutritionDirectory(options['nutrition-dir']);
    fs.writeFileSync(options.report, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
    process.stdout.write(JSON.stringify({ rows: report.rowCount, proposedChanges: report.updates.length, unresolved: report.unresolved.length }) + '\n');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
