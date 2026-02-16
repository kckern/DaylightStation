#!/usr/bin/env node
/**
 * Migrate list YAML files from action-key format to input+action SSOT format.
 *
 * Reads all list YAML files in menus/, programs/, and watchlists/ directories,
 * applies denormalizeItem() to each item, and writes back clean YAML.
 *
 * Usage:
 *   node cli/scripts/migrate-lists-to-input-format.mjs [options]
 *
 * Options:
 *   --write            Actually persist changes (dry-run by default)
 *   --data-path /path  Override default data path
 *   --help, -h         Show this help message
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { denormalizeItem } from '../../backend/src/1_adapters/content/list/listConfigNormalizer.mjs';

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_DATA_PATH = process.env.DAYLIGHT_DATA_PATH
  || '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data';

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const HELP = args.includes('--help') || args.includes('-h');

const dataPathIdx = args.indexOf('--data-path');
const DATA_PATH = dataPathIdx !== -1 && args[dataPathIdx + 1]
  ? args[dataPathIdx + 1]
  : DEFAULT_DATA_PATH;

if (HELP) {
  console.log(`
Usage: node cli/scripts/migrate-lists-to-input-format.mjs [options]

Options:
  --write            Actually persist changes (dry-run by default)
  --data-path /path  Override default data path
  --help, -h         Show this help message
`);
  process.exit(0);
}

// =============================================================================
// Migration
// =============================================================================

const SUBDIRS = ['menus', 'programs', 'watchlists'];
const listsRoot = path.join(DATA_PATH, 'household', 'config', 'lists');

let totalFiles = 0;
let totalChanged = 0;
let totalItems = 0;

for (const subdir of SUBDIRS) {
  const dir = path.join(listsRoot, subdir);
  if (!fs.existsSync(dir)) {
    console.log(`  skip ${subdir}/ (not found)`);
    continue;
  }

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.yml'));
  for (const file of files) {
    const filePath = path.join(dir, file);
    const raw = yaml.load(fs.readFileSync(filePath, 'utf8'));
    if (!raw) continue;

    totalFiles++;
    let changedCount = 0;

    // Process items in the file (could be raw.items or raw.sections[].items)
    const processItems = (items) => {
      if (!Array.isArray(items)) return items;
      return items.map(item => {
        const before = JSON.stringify(item);
        const after = denormalizeItem(item);
        if (JSON.stringify(after) !== before) changedCount++;
        totalItems++;
        return after;
      });
    };

    if (Array.isArray(raw)) {
      // Bare array format
      const migrated = processItems(raw);
      if (changedCount > 0) {
        totalChanged++;
        console.log(`  ${subdir}/${file}: ${changedCount} items migrated`);
        if (WRITE) fs.writeFileSync(filePath, yaml.dump(migrated, { lineWidth: -1 }));
      }
    } else if (Array.isArray(raw.sections)) {
      for (const section of raw.sections) {
        if (section.items) section.items = processItems(section.items);
      }
      if (changedCount > 0) {
        totalChanged++;
        console.log(`  ${subdir}/${file}: ${changedCount} items migrated`);
        if (WRITE) fs.writeFileSync(filePath, yaml.dump(raw, { lineWidth: -1 }));
      }
    } else if (Array.isArray(raw.items)) {
      raw.items = processItems(raw.items);
      if (changedCount > 0) {
        totalChanged++;
        console.log(`  ${subdir}/${file}: ${changedCount} items migrated`);
        if (WRITE) fs.writeFileSync(filePath, yaml.dump(raw, { lineWidth: -1 }));
      }
    }
  }
}

console.log(`\n${WRITE ? 'WRITE' : 'DRY-RUN'}: ${totalFiles} files scanned, ${totalChanged} files changed, ${totalItems} items processed`);
if (!WRITE && totalChanged > 0) {
  console.log('Re-run with --write to persist changes.');
}
