#!/usr/bin/env node
/**
 * Backfill fitness session YAML files:
 * 1. Rename mediaId → contentId (key rename)
 * 2. Prefix bare numeric IDs (contentId, grandparentId, parentId) with plex: namespace
 *
 * Safe to run multiple times — skips already-renamed/namespaced fields.
 *
 * Usage:
 *   node cli/scripts/backfill-media-namespace.mjs [options]
 *
 * Options:
 *   --dry-run          Show what would change without writing
 *   --data-path /path  Override default data path
 *   --help, -h         Show this help message
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_DATA_PATH = process.env.DAYLIGHT_DATA_PATH
  || '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: node cli/scripts/backfill-media-namespace.mjs [--dry-run] [--data-path /path]`);
  process.exit(0);
}

const DRY_RUN = args.includes('--dry-run');
const dataPathIdx = args.indexOf('--data-path');
const DATA_ROOT = dataPathIdx >= 0 && args[dataPathIdx + 1]
  ? args[dataPathIdx + 1]
  : DEFAULT_DATA_PATH;

const FITNESS_DIR = path.join(DATA_ROOT, 'household/history/fitness');

// =============================================================================
// Helpers
// =============================================================================

const CONTENT_ID_FIELDS = ['contentId', 'grandparentId', 'parentId'];

function prefixBareId(id) {
  if (id == null) return id;
  const str = String(id);
  if (str.includes(':')) return str; // Already namespaced
  if (!/^\d+$/.test(str)) return str; // Not a bare numeric ID
  return `plex:${str}`;
}

/** Rename mediaId → contentId if present, then prefix all bare numeric ID fields. Returns true if any changed. */
function prefixMediaFields(obj) {
  if (!obj || typeof obj !== 'object') return false;
  let changed = false;

  // Key rename: mediaId → contentId
  if (obj.mediaId != null && obj.contentId == null) {
    obj.contentId = obj.mediaId;
    delete obj.mediaId;
    changed = true;
  }

  for (const field of CONTENT_ID_FIELDS) {
    if (obj[field] != null) {
      const prefixed = prefixBareId(obj[field]);
      if (prefixed !== String(obj[field])) {
        obj[field] = prefixed;
        changed = true;
      }
    }
  }
  return changed;
}

function processSession(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const doc = yaml.load(raw);
  if (!doc || typeof doc !== 'object') return false;
  let changed = false;

  // Fix events[].data.{mediaId, grandparentId, parentId}
  if (Array.isArray(doc.events)) {
    for (const evt of doc.events) {
      if (evt?.data && prefixMediaFields(evt.data)) changed = true;
    }
  }

  // Fix summary.media[].{mediaId, grandparentId, parentId}
  if (Array.isArray(doc.summary?.media)) {
    for (const m of doc.summary.media) {
      if (prefixMediaFields(m)) changed = true;
    }
  }

  // Fix timeline.events[].data.{mediaId, grandparentId, parentId}
  if (Array.isArray(doc.timeline?.events)) {
    for (const evt of doc.timeline.events) {
      if (evt?.data && prefixMediaFields(evt.data)) changed = true;
    }
  }

  if (changed && !DRY_RUN) {
    fs.writeFileSync(filePath, yaml.dump(doc, { lineWidth: -1, noRefs: true }));
  }

  return changed;
}

// =============================================================================
// Main
// =============================================================================

if (!fs.existsSync(FITNESS_DIR)) {
  console.error(`Fitness directory not found: ${FITNESS_DIR}`);
  process.exit(1);
}

const dateDirs = fs.readdirSync(FITNESS_DIR).filter(d => {
  const full = path.join(FITNESS_DIR, d);
  return fs.statSync(full).isDirectory();
});

let totalFiles = 0;
let totalChanged = 0;

for (const dateDir of dateDirs) {
  const dirPath = path.join(FITNESS_DIR, dateDir);
  const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.yml'));
  for (const file of files) {
    totalFiles++;
    const filePath = path.join(dirPath, file);
    try {
      if (processSession(filePath)) {
        totalChanged++;
        console.log(`${DRY_RUN ? '[DRY RUN] Would update' : 'Updated'}: ${dateDir}/${file}`);
      }
    } catch (err) {
      console.error(`Error processing ${dateDir}/${file}: ${err.message}`);
    }
  }
}

console.log(`\nProcessed ${totalFiles} files, ${totalChanged} ${DRY_RUN ? 'would be ' : ''}updated.`);
