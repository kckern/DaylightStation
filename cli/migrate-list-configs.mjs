#!/usr/bin/env node
// cli/migrate-list-configs.mjs
//
// Migrates old-format list configs (label/input/action, title/src/media_key)
// to new action-as-key format (title/play/open/display/list/queue).
//
// Usage:
//   node cli/migrate-list-configs.mjs <lists-path>          # Migrate in-place
//   node cli/migrate-list-configs.mjs <lists-path> --dry-run # Preview changes
//   node cli/migrate-list-configs.mjs --auto                 # Auto-detect path from .env
//   node cli/migrate-list-configs.mjs --auto --dry-run       # Auto-detect + preview
//
// The <lists-path> should point to household/config/lists/ containing menus/, programs/, watchlists/

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { load, dump } from 'js-yaml';
import { normalizeListItem } from '../backend/src/1_adapters/content/list/listConfigNormalizer.mjs';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const AUTO = args.includes('--auto');
const pathArg = args.find(a => !a.startsWith('--'));

function findListsPath() {
  if (pathArg) return resolve(pathArg);

  if (AUTO) {
    // Try .env file
    const envPath = join(process.cwd(), '.env');
    if (existsSync(envPath)) {
      const envContent = readFileSync(envPath, 'utf8');
      const match = envContent.match(/DAYLIGHT_BASE_PATH=(.+)/);
      if (match) {
        return join(match[1].trim(), 'data', 'household', 'config', 'lists');
      }
    }

    // Try DAYLIGHT_BASE_PATH env var
    if (process.env.DAYLIGHT_BASE_PATH) {
      return join(process.env.DAYLIGHT_BASE_PATH, 'data', 'household', 'config', 'lists');
    }

    console.error('Could not auto-detect lists path. Set DAYLIGHT_BASE_PATH or provide path argument.');
    process.exit(1);
  }

  console.error('Usage: node cli/migrate-list-configs.mjs <lists-path> [--dry-run]');
  console.error('       node cli/migrate-list-configs.mjs --auto [--dry-run]');
  process.exit(1);
}

const LISTS_PATH = findListsPath();

if (!existsSync(LISTS_PATH)) {
  console.error(`Lists path not found: ${LISTS_PATH}`);
  process.exit(1);
}

let totalFiles = 0;
let totalItems = 0;
let totalChanged = 0;

for (const subdir of ['menus', 'programs', 'watchlists']) {
  const dir = join(LISTS_PATH, subdir);
  if (!existsSync(dir)) {
    console.log(`[SKIP] ${dir} — directory not found`);
    continue;
  }

  const files = readdirSync(dir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));

  for (const file of files) {
    const filePath = join(dir, file);
    const raw = load(readFileSync(filePath, 'utf8'));

    let migrated;
    let itemCount = 0;

    if (raw?.items && Array.isArray(raw.items)) {
      // Menu format: { title: ..., items: [...] }
      itemCount = raw.items.length;
      migrated = { ...raw, items: raw.items.map(normalizeListItem) };
    } else if (Array.isArray(raw)) {
      // Flat list format (watchlists, programs)
      itemCount = raw.length;
      migrated = raw.map(normalizeListItem);
    } else {
      console.log(`[SKIP] ${filePath} — unexpected format`);
      continue;
    }

    totalFiles++;
    totalItems += itemCount;

    // Check if anything actually changed
    const originalYaml = dump(raw, { lineWidth: -1 });
    const migratedYaml = dump(migrated, { lineWidth: -1 });
    const changed = originalYaml !== migratedYaml;

    if (changed) totalChanged++;

    if (DRY_RUN) {
      const status = changed ? 'WOULD MIGRATE' : 'UNCHANGED';
      console.log(`[${status}] ${filePath} (${itemCount} items)`);
      if (changed && args.includes('--verbose')) {
        console.log(migratedYaml);
        console.log('---');
      }
    } else if (changed) {
      writeFileSync(filePath, migratedYaml);
      console.log(`[MIGRATED] ${filePath} (${itemCount} items)`);
    } else {
      console.log(`[UNCHANGED] ${filePath}`);
    }
  }
}

console.log(`\nSummary: ${totalFiles} files, ${totalItems} items, ${totalChanged} changed`);
if (DRY_RUN) {
  console.log('(dry run — no files were modified)');
}
