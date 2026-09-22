#!/usr/bin/env node
// health-icon-manifest-merge.cli.mjs — merge a reviewed food-name → icon map
// into the installed icon manifest's `foodNames`.
//
// `foodNames` pins a food NAME to an offered hi-res slug, so a capture of that
// food gets that icon whatever the model proposed (see
// 2_domains/nutrition/services/icons.mjs confineIcon). Only `foodNames` is
// touched: `icons` and `aliases` are verified unchanged after the write.
//
// Usage:
//   node cli/health-icon-manifest-merge.cli.mjs --manifest PATH --food-names PATH
//   node cli/health-icon-manifest-merge.cli.mjs --manifest PATH --food-names PATH --apply --backup NEW_PATH
//
// The dry run prints what would be added or replaced. --apply copies the
// manifest to --backup (never overwriting an existing file), writes the merge
// atomically, and re-reads it. The backend caches the manifest; restart it (or
// reload the store) for the change to take effect.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';

const countOf = section => Object.keys(section && typeof section === 'object' ? section : {}).length;

/**
 * @param {object} installed - the parsed manifest ({ icons, aliases, foodNames? })
 * @param {Record<string, string|null>} foodNames - reviewed name → offered slug (null = no suitable art)
 * @returns {{ manifest: object, additions: Array, changes: Array }}
 */
export function mergeFoodNames(installed, foodNames) {
  const icons = installed?.icons && typeof installed.icons === 'object' ? installed.icons : {};
  const refused = Object.entries(foodNames || {})
    .filter(([, slug]) => slug !== null && !Object.hasOwn(icons, slug))
    .map(([name, slug]) => `${name} -> ${slug}`);
  if (refused.length) throw new Error(`Not offered by the manifest's icons: ${refused.join(', ')}`);
  const current = installed.foodNames && typeof installed.foodNames === 'object' ? installed.foodNames : {};
  const merged = { ...current };
  const additions = [], changes = [];
  for (const [name, slug] of Object.entries(foodNames || {})) {
    if (!Object.hasOwn(current, name)) additions.push({ name, slug });
    else if (current[name] !== slug) changes.push({ name, from: current[name], to: slug });
    merged[name] = slug;
  }
  const sorted = Object.fromEntries(Object.keys(merged).sort().map(key => [key, merged[key]]));
  return { manifest: { ...installed, foodNames: sorted }, additions, changes };
}

export function applyFoodNamesMerge(manifestPath, foodNames, backupPath) {
  const installed = yaml.load(fs.readFileSync(manifestPath, 'utf8'));
  const { manifest, additions, changes } = mergeFoodNames(installed, foodNames);
  fs.copyFileSync(manifestPath, backupPath, fs.constants.COPYFILE_EXCL);
  if (!fs.readFileSync(backupPath).equals(fs.readFileSync(manifestPath))) throw new Error('Backup verification failed; nothing was written');
  saveYamlToPathAtomic(manifestPath, manifest);
  const after = yaml.load(fs.readFileSync(manifestPath, 'utf8'));
  if (countOf(after.icons) !== countOf(installed.icons) || countOf(after.aliases) !== countOf(installed.aliases)) {
    throw new Error(`Icon or alias count changed; restore ${backupPath}`);
  }
  for (const [name, slug] of Object.entries(foodNames)) {
    if (after.foodNames?.[name] !== slug) throw new Error(`Merge did not land for ${name}; restore ${backupPath}`);
  }
  return { added: additions.length, changed: changes.length, icons: countOf(after.icons), aliases: countOf(after.aliases), backup: backupPath };
}

export function main(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--apply') options.apply = true;
    else if (['--manifest', '--food-names', '--backup'].includes(flag)) options[flag.slice(2)] = args[++i];
    else throw new Error('Usage: --manifest PATH --food-names PATH [--apply --backup NEW_PATH]');
  }
  if (!options.manifest || !options['food-names']) throw new Error('--manifest and --food-names are required');
  const foodNames = yaml.load(fs.readFileSync(options['food-names'], 'utf8')) || {};
  if (options.apply) {
    if (!options.backup) throw new Error('--backup is required with --apply');
    process.stdout.write(JSON.stringify(applyFoodNamesMerge(path.resolve(options.manifest), foodNames, path.resolve(options.backup))) + '\n');
    return;
  }
  const installed = yaml.load(fs.readFileSync(options.manifest, 'utf8'));
  const { additions, changes } = mergeFoodNames(installed, foodNames);
  process.stdout.write(JSON.stringify({ icons: countOf(installed.icons), aliases: countOf(installed.aliases),
    foodNamesBefore: countOf(installed.foodNames), additions, changes }, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
