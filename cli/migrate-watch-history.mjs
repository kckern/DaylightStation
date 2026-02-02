#!/usr/bin/env node
/**
 * Watch History Migration Script
 *
 * Migrates all watch history YAML files to canonical format:
 * - Renames legacy field names to canonical
 * - Removes metadata that should come from source (title, parent, etc.)
 * - Backfills missing duration from Plex API
 * - Calculates percent when missing
 *
 * Canonical format:
 * ```yaml
 * plex:672449:
 *   playhead: 2043
 *   duration: 2043
 *   percent: 100
 *   playCount: 1
 *   lastPlayed: '2025-11-24 12:27:51'
 *   watchTime: 2043
 * ```
 *
 * Usage:
 *   node cli/migrate-watch-history.mjs --dry-run     # Preview changes
 *   node cli/migrate-watch-history.mjs --apply       # Apply changes
 *   node cli/migrate-watch-history.mjs --backfill    # Also backfill from Plex API
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

// ============================================================================
// Configuration
// ============================================================================

const DATA_PATH = process.env.DAYLIGHT_DATA_PATH
  || '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data';
const MEDIA_MEMORY_PATH = path.join(DATA_PATH, 'household/history/media_memory');
const PLEX_API_BASE = 'http://localhost:3112/api/v1/proxy/plex';

// Canonical fields to keep in watch history
const CANONICAL_FIELDS = new Set([
  'playhead',
  'duration',
  'percent',
  'playCount',
  'lastPlayed',
  'watchTime'
]);

// Field renames (old → new)
const FIELD_RENAMES = {
  mediaDuration: 'duration',
  seconds: 'playhead',
  time: 'lastPlayed'
};

// Fields to remove (metadata that should come from source)
const FIELDS_TO_REMOVE = new Set([
  'title',
  'parent',
  'parentId',
  'grandparent',
  'grandparentId',
  'libraryId',
  'mediaType',
  'media_key'  // Redundant with entry key
]);

// ============================================================================
// Statistics
// ============================================================================

const stats = {
  filesProcessed: 0,
  entriesProcessed: 0,
  fieldsRenamed: 0,
  fieldsRemoved: 0,
  durationsBackfilled: 0,
  percentsCalculated: 0,
  lastPlayedNormalized: 0,
  errors: []
};

// ============================================================================
// Helpers
// ============================================================================

function loadYaml(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return yaml.load(content) || {};
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

function saveYaml(filePath, data) {
  const content = yaml.dump(data, {
    indent: 2,
    lineWidth: -1,
    quotingType: "'",
    forceQuotes: false
  });
  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Normalize lastPlayed to canonical format: 'YYYY-MM-DD HH:MM:SS'
 */
function normalizeLastPlayed(value) {
  if (!value) return null;

  const str = String(value);

  // Already canonical: '2025-11-24 12:27:51' or '2025-11-24 12.27.51'
  if (/^\d{4}-\d{2}-\d{2} \d{2}[.:]\d{2}[.:]\d{2}$/.test(str)) {
    // Normalize dots to colons in time portion
    return str.replace(/(\d{2})\.(\d{2})\.(\d{2})$/, '$1:$2:$3');
  }

  // Format: '2026-01-05 04:05:16pm' → '2026-01-05 16:05:16'
  const pmMatch = str.match(/^(\d{4}-\d{2}-\d{2}) (\d{1,2}):(\d{2}):(\d{2})(am|pm)$/i);
  if (pmMatch) {
    let [, date, hour, min, sec, ampm] = pmMatch;
    hour = parseInt(hour, 10);
    if (ampm.toLowerCase() === 'pm' && hour !== 12) hour += 12;
    if (ampm.toLowerCase() === 'am' && hour === 12) hour = 0;
    return `${date} ${String(hour).padStart(2, '0')}:${min}:${sec}`;
  }

  // Try parsing as date and reformatting
  try {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
  } catch {}

  return str; // Return as-is if can't normalize
}

/**
 * Migrate a single entry to canonical format
 */
function migrateEntry(key, entry, options = {}) {
  const migrated = {};
  const changes = [];

  // Process each field
  for (const [field, value] of Object.entries(entry)) {
    // Check for rename
    if (FIELD_RENAMES[field]) {
      const newField = FIELD_RENAMES[field];
      migrated[newField] = value;
      changes.push(`rename: ${field} → ${newField}`);
      stats.fieldsRenamed++;
      continue;
    }

    // Check for removal
    if (FIELDS_TO_REMOVE.has(field)) {
      changes.push(`remove: ${field}`);
      stats.fieldsRemoved++;
      continue;
    }

    // Keep canonical fields
    if (CANONICAL_FIELDS.has(field)) {
      migrated[field] = value;
      continue;
    }

    // Unknown field - keep but warn
    migrated[field] = value;
    if (options.verbose) {
      console.warn(`  [WARN] Unknown field '${field}' in ${key}`);
    }
  }

  // Normalize lastPlayed format
  if (migrated.lastPlayed) {
    const normalized = normalizeLastPlayed(migrated.lastPlayed);
    if (normalized !== migrated.lastPlayed) {
      changes.push(`normalize: lastPlayed '${migrated.lastPlayed}' → '${normalized}'`);
      migrated.lastPlayed = normalized;
      stats.lastPlayedNormalized++;
    }
  }

  // Calculate percent if missing but we have playhead and duration
  if (migrated.percent === undefined && migrated.playhead > 0 && migrated.duration > 0) {
    migrated.percent = Math.round((migrated.playhead / migrated.duration) * 100);
    changes.push(`calculate: percent = ${migrated.percent}`);
    stats.percentsCalculated++;
  }

  // Ensure playCount exists
  if (migrated.playCount === undefined) {
    migrated.playCount = 1;
  }

  // Order fields canonically
  const ordered = {};
  for (const field of ['playhead', 'duration', 'percent', 'playCount', 'lastPlayed', 'watchTime']) {
    if (migrated[field] !== undefined) {
      ordered[field] = migrated[field];
    }
  }
  // Add any remaining fields
  for (const [field, value] of Object.entries(migrated)) {
    if (!(field in ordered)) {
      ordered[field] = value;
    }
  }

  return { migrated: ordered, changes };
}

/**
 * Fetch duration from Plex API for backfill
 */
async function fetchPlexDuration(ratingKey) {
  try {
    const response = await fetch(`${PLEX_API_BASE}/library/metadata/${ratingKey}`, {
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) return null;

    const data = await response.json();
    const item = data.MediaContainer?.Metadata?.[0];
    if (!item) return null;

    // Duration in Plex is milliseconds
    const durationMs = item.duration;
    if (durationMs) {
      return Math.round(durationMs / 1000);
    }
    return null;
  } catch (err) {
    return null;
  }
}

/**
 * Process a single YAML file
 */
async function processFile(filePath, options = {}) {
  const { dryRun = true, backfill = false, verbose = false } = options;

  console.log(`\nProcessing: ${path.relative(MEDIA_MEMORY_PATH, filePath)}`);

  const data = loadYaml(filePath);
  const entries = Object.entries(data);

  if (entries.length === 0) {
    console.log('  (empty file)');
    return;
  }

  const migratedData = {};
  let fileChanges = 0;
  const needsBackfill = [];

  for (const [key, entry] of entries) {
    stats.entriesProcessed++;

    const { migrated, changes } = migrateEntry(key, entry, { verbose });
    migratedData[key] = migrated;

    if (changes.length > 0) {
      fileChanges += changes.length;
      if (verbose) {
        console.log(`  ${key}:`);
        for (const change of changes) {
          console.log(`    - ${change}`);
        }
      }
    }

    // Check if needs duration backfill
    if (backfill && !migrated.duration && migrated.playhead > 0) {
      // Extract Plex rating key from compound key
      const match = key.match(/^plex:(\d+)$/);
      if (match) {
        needsBackfill.push({ key, ratingKey: match[1], entry: migrated });
      }
    }
  }

  // Backfill durations from Plex API
  if (needsBackfill.length > 0) {
    console.log(`  Backfilling ${needsBackfill.length} durations from Plex...`);

    for (const { key, ratingKey, entry } of needsBackfill) {
      const duration = await fetchPlexDuration(ratingKey);
      if (duration) {
        entry.duration = duration;
        // Recalculate percent
        if (entry.playhead > 0) {
          entry.percent = Math.round((entry.playhead / duration) * 100);
        }
        stats.durationsBackfilled++;
        fileChanges++;
        if (verbose) {
          console.log(`    ${key}: backfilled duration=${duration}, percent=${entry.percent}`);
        }
      } else {
        if (verbose) {
          console.log(`    ${key}: could not fetch duration from Plex`);
        }
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 50));
    }
  }

  console.log(`  ${entries.length} entries, ${fileChanges} changes`);
  stats.filesProcessed++;

  // Save if not dry run
  if (!dryRun && fileChanges > 0) {
    // Backup original
    const backupPath = filePath + '.bak';
    fs.copyFileSync(filePath, backupPath);

    // Save migrated
    saveYaml(filePath, migratedData);
    console.log(`  ✓ Saved (backup: ${path.basename(backupPath)})`);
  }
}

/**
 * Find all YAML files to process
 */
function findYamlFiles(dir) {
  const files = [];

  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    if (item.name.startsWith('.')) continue;

    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      files.push(...findYamlFiles(fullPath));
    } else if (item.name.endsWith('.yml') && !item.name.endsWith('.bak.yml')) {
      files.push(fullPath);
    }
  }

  return files;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const backfill = args.includes('--backfill');
  const verbose = args.includes('--verbose') || args.includes('-v');

  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║           Watch History Migration Script                       ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log(`║  Mode: ${dryRun ? 'DRY RUN (no changes)' : 'APPLY CHANGES'}`.padEnd(67) + '║');
  console.log(`║  Backfill: ${backfill ? 'Yes (fetch from Plex API)' : 'No'}`.padEnd(67) + '║');
  console.log(`║  Path: ${MEDIA_MEMORY_PATH.slice(-55)}`.padEnd(67) + '║');
  console.log('╚════════════════════════════════════════════════════════════════╝');

  if (dryRun) {
    console.log('\n⚠️  DRY RUN - No files will be modified. Use --apply to apply changes.\n');
  }

  // Find all YAML files
  const files = findYamlFiles(MEDIA_MEMORY_PATH);
  console.log(`Found ${files.length} YAML files to process.`);

  // Process each file
  for (const file of files) {
    try {
      await processFile(file, { dryRun, backfill, verbose });
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      stats.errors.push({ file, error: err.message });
    }
  }

  // Print summary
  console.log('\n' + '═'.repeat(68));
  console.log('MIGRATION SUMMARY');
  console.log('═'.repeat(68));
  console.log(`  Files processed:        ${stats.filesProcessed}`);
  console.log(`  Entries processed:      ${stats.entriesProcessed}`);
  console.log(`  Fields renamed:         ${stats.fieldsRenamed}`);
  console.log(`  Fields removed:         ${stats.fieldsRemoved}`);
  console.log(`  Durations backfilled:   ${stats.durationsBackfilled}`);
  console.log(`  Percents calculated:    ${stats.percentsCalculated}`);
  console.log(`  LastPlayed normalized:  ${stats.lastPlayedNormalized}`);
  console.log(`  Errors:                 ${stats.errors.length}`);

  if (stats.errors.length > 0) {
    console.log('\nErrors:');
    for (const { file, error } of stats.errors) {
      console.log(`  - ${path.basename(file)}: ${error}`);
    }
  }

  if (dryRun) {
    console.log('\n⚠️  This was a dry run. Run with --apply to apply changes.');
    console.log('   Add --backfill to also fetch missing durations from Plex API.');
    console.log('   Add --verbose for detailed output.');
  } else {
    console.log('\n✅ Migration complete. Backup files created with .bak extension.');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
