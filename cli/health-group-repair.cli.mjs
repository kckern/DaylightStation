#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { inspectNutritionDirectory } from './health-ledger-repair.cli.mjs';
import { planGroupCaptureRepair } from '#apps/health/GroupCaptureRepair.mjs';
import { YamlNutriListDatastore } from '#adapters/persistence/yaml/YamlNutriListDatastore.mjs';
import { saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';

const values = data => Array.isArray(data) ? data : Object.values(data || {});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function inspectGroupRepair(directory, selection) {
  const inventory = inspectNutritionDirectory(directory);
  const rows = [], matches = [];
  for (const file of inventory.files) {
    if (!/^(nutrilog|nutrilist)\.ya?ml$|^archives\/(nutrilog|nutrilist)\/[^/]+\.ya?ml$/.test(file.relative)) continue;
    const data = yaml.load(fs.readFileSync(path.join(inventory.root, file.relative), 'utf8'));
    if (file.relative.includes('nutrilist')) rows.push(...values(data));
    else for (const log of values(data)) if (log.id === selection.logId) matches.push({ log, file: file.relative });
  }
  if (matches.length !== 1) throw new Error('Capture must occur in exactly one source file');
  return { root: inventory.root, files: inventory.files, nutrientDigest: inventory.nutrientDigest,
    selection, captureFile: matches[0].file, ...planGroupCaptureRepair(matches[0].log, rows, selection) };
}
export async function applyGroupRepair(manifest, backupDirectory, { offline = false } = {}) {
  if (!offline) throw new Error('Stop nutrition writers first; --offline is required');
  const fresh = inspectGroupRepair(manifest.root, manifest.selection);
  if (JSON.stringify(fresh) !== JSON.stringify(manifest)) throw new Error('Source changed; regenerate and review the manifest');
  const backup = path.resolve(backupDirectory);
  if (backup === manifest.root || backup.startsWith(manifest.root + path.sep)) throw new Error('Backup must be outside the nutrition directory');
  fs.mkdirSync(backup, { mode: 0o700 }); // Never replace a prior backup.
  for (const file of manifest.files) {
    const destination = path.join(backup, file.relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(manifest.root, file.relative), destination, fs.constants.COPYFILE_EXCL);
    if (hash(fs.readFileSync(destination)) !== file.sha256) throw new Error('Backup verification failed; no repair was applied');
  }
  fs.writeFileSync(path.join(backup, 'group-repair.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
  const sourcePath = path.join(manifest.root, manifest.captureFile);
  const source = yaml.load(fs.readFileSync(sourcePath, 'utf8'));
  for (const key of Object.keys(source)) if (source[key]?.id === manifest.selection.logId) source[key] = manifest.capture;
  saveYamlToPathAtomic(sourcePath, source);
  const store = new YamlNutriListDatastore({ dataService: { user: { resolveDir: relative =>
    path.join(manifest.root, relative.replace(/^lifelog\/nutrition\//, '')) } }, logger: { info() {}, warn() {} } });
  if (manifest.updates.length) await store.mutateEntries('repair-owner', { updates: manifest.updates });
  await store.syncNutriday('repair-owner');
  const after = inspectGroupRepair(manifest.root, manifest.selection);
  if (after.nutrientDigest !== manifest.nutrientDigest || after.updates.length) throw new Error('Verification failed; keep writers stopped and restore the verified backup');
  return { changed: manifest.updates.length, backup };
}
async function main(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--offline') options.offline = true;
    else if (['--nutrition-dir', '--log-id', '--label', '--children', '--calories', '--report', '--apply', '--backup'].includes(flag)) options[flag.slice(2)] = args[++index];
    else throw new Error('Unknown option');
  }
  if (options.apply) {
    if (!options.backup) throw new Error('--backup is required');
    process.stdout.write(JSON.stringify(await applyGroupRepair(JSON.parse(fs.readFileSync(options.apply, 'utf8')), options.backup, options)) + '\n');
    return;
  }
  if (!options['nutrition-dir'] || !options['log-id'] || !options.label || !options.children || !options.report || !Number.isFinite(Number(options.calories))) {
    throw new Error('Required: --nutrition-dir DIR --log-id ID --label DISH --children COMMA_LIST --calories N --report NEW.json');
  }
  const report = inspectGroupRepair(options['nutrition-dir'], { logId: options['log-id'], label: options.label,
    children: options.children.split(',').map(value => value.trim()), expectedCalories: Number(options.calories) });
  fs.writeFileSync(options.report, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
  process.stdout.write(JSON.stringify({ proposedChanges: report.updates.length, calories: report.expectedCalories }) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
