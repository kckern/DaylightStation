#!/usr/bin/env node
/**
 * Backfill fitness session media events with Plex parent/grandparent IDs.
 * Also purges sessions shorter than a configurable minimum duration.
 *
 * For each session with media events, looks up the Plex item API to resolve
 * parentId, grandparentId, and corrects grandparentTitle/parentTitle.
 *
 * Usage:
 *   node cli/scripts/backfill-session-media.mjs [options]
 *
 * Options:
 *   --dry-run              Show what would change without writing
 *   --purge-under <sec>    Delete sessions shorter than N seconds (default: 600)
 *   --no-purge             Skip purging short sessions
 *   --data-path /path      Override default data path
 *   --api-base <url>       Backend API base URL (default: http://localhost:3112)
 *   --help, -h             Show this help message
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
const DRY_RUN = args.includes('--dry-run');
const HELP = args.includes('--help') || args.includes('-h');
const NO_PURGE = args.includes('--no-purge');

const dataPathIdx = args.indexOf('--data-path');
const DATA_PATH = dataPathIdx !== -1 && args[dataPathIdx + 1]
  ? args[dataPathIdx + 1]
  : DEFAULT_DATA_PATH;

const purgeIdx = args.indexOf('--purge-under');
const PURGE_THRESHOLD = NO_PURGE ? 0 : (
  purgeIdx !== -1 && args[purgeIdx + 1]
    ? Number(args[purgeIdx + 1])
    : 600
);

const apiIdx = args.indexOf('--api-base');
const API_BASE = apiIdx !== -1 && args[apiIdx + 1]
  ? args[apiIdx + 1]
  : 'http://localhost:3112';

if (HELP) {
  console.log(`
Usage: node cli/scripts/backfill-session-media.mjs [options]

Options:
  --dry-run              Show what would change without writing
  --purge-under <sec>    Delete sessions shorter than N seconds (default: 600)
  --no-purge             Skip purging short sessions
  --data-path /path      Override default data path
  --api-base <url>       Backend API base URL (default: http://localhost:3112)
  --help, -h             Show this help message
`);
  process.exit(0);
}

// =============================================================================
// Plex Lookup Cache
// =============================================================================

const plexCache = new Map();

async function lookupPlexItem(plexId) {
  if (!plexId) return null;
  const key = String(plexId);
  if (plexCache.has(key)) return plexCache.get(key);

  try {
    const res = await fetch(`${API_BASE}/api/v1/item/plex/${key}`);
    if (!res.ok) {
      console.warn(`  ⚠ Plex lookup failed for ${key}: ${res.status}`);
      plexCache.set(key, null);
      return null;
    }
    const data = await res.json();
    plexCache.set(key, data);
    return data;
  } catch (err) {
    console.warn(`  ⚠ Plex lookup error for ${key}: ${err.message}`);
    plexCache.set(key, null);
    return null;
  }
}

// =============================================================================
// Session File Helpers
// =============================================================================

const FITNESS_DIR = path.join(DATA_PATH, 'household', 'history', 'fitness');

function listDateDirs() {
  if (!fs.existsSync(FITNESS_DIR)) return [];
  return fs.readdirSync(FITNESS_DIR)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
}

function listSessionFiles(dateDir) {
  const dir = path.join(FITNESS_DIR, dateDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.yml'))
    .map(f => path.join(dir, f));
}

function readSession(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return yaml.load(content);
  } catch {
    return null;
  }
}

function writeSession(filePath, data) {
  const content = yaml.dump(data, {
    lineWidth: -1,
    noRefs: true,
    quotingType: "'",
    forceQuotes: false,
  });
  fs.writeFileSync(filePath, content, 'utf8');
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log(`Session Media Backfill`);
  console.log(`  Data path: ${DATA_PATH}`);
  console.log(`  API base:  ${API_BASE}`);
  console.log(`  Purge threshold: ${PURGE_THRESHOLD}s (${PURGE_THRESHOLD / 60} min)`);
  console.log(`  Dry run: ${DRY_RUN}`);
  console.log();

  const dateDirs = listDateDirs();
  console.log(`Found ${dateDirs.length} date directories\n`);

  let totalSessions = 0;
  let purgedCount = 0;
  let backfilledCount = 0;
  let alreadyGoodCount = 0;
  let noMediaCount = 0;
  let errorCount = 0;

  for (const dateDir of dateDirs) {
    const files = listSessionFiles(dateDir);

    for (const filePath of files) {
      totalSessions++;
      const data = readSession(filePath);
      if (!data) {
        console.warn(`  ✗ Failed to read: ${filePath}`);
        errorCount++;
        continue;
      }

      const durationSec = data.session?.duration_seconds ?? null;
      const sessionId = data.sessionId || path.basename(filePath, '.yml');

      // --- Purge short sessions ---
      if (PURGE_THRESHOLD > 0 && durationSec != null && durationSec < PURGE_THRESHOLD) {
        if (DRY_RUN) {
          console.log(`  🗑 [dry-run] Would purge ${sessionId} (${durationSec}s)`);
        } else {
          fs.unlinkSync(filePath);
          console.log(`  🗑 Purged ${sessionId} (${durationSec}s)`);
        }
        purgedCount++;
        continue;
      }

      // --- Find media events needing backfill ---
      const events = data.timeline?.events || [];
      const mediaEvents = events.filter(e => e.type === 'media' && e.data?.mediaId);

      if (mediaEvents.length === 0) {
        noMediaCount++;
        continue;
      }

      let sessionModified = false;

      for (const evt of mediaEvents) {
        const d = evt.data;
        const plexId = d.mediaId;

        // Skip if already has grandparentId
        if (d.grandparentId && d.parentId) {
          alreadyGoodCount++;
          continue;
        }

        const item = await lookupPlexItem(plexId);
        if (!item) continue;

        // Backfill IDs
        if (item.grandparentId) {
          d.grandparentId = item.grandparentId;
          sessionModified = true;
        }
        if (item.parentId) {
          d.parentId = item.parentId;
          sessionModified = true;
        }

        // Fix incorrect titles (e.g., "Fitness" → "Game Cycling")
        if (item.grandparentTitle && d.grandparentTitle !== item.grandparentTitle) {
          const old = d.grandparentTitle;
          d.grandparentTitle = item.grandparentTitle;
          if (old) console.log(`    Fixed grandparentTitle: "${old}" → "${item.grandparentTitle}"`);
          sessionModified = true;
        }
        if (item.parentTitle && d.parentTitle !== item.parentTitle) {
          const old = d.parentTitle;
          d.parentTitle = item.parentTitle;
          if (old) console.log(`    Fixed parentTitle: "${old}" → "${item.parentTitle}"`);
          sessionModified = true;
        }
      }

      if (sessionModified) {
        if (DRY_RUN) {
          console.log(`  ✏ [dry-run] Would update ${sessionId}`);
        } else {
          writeSession(filePath, data);
          console.log(`  ✏ Updated ${sessionId}`);
        }
        backfilledCount++;
      }
    }
  }

  // --- Clean up empty date directories ---
  if (!DRY_RUN && PURGE_THRESHOLD > 0) {
    for (const dateDir of dateDirs) {
      const dir = path.join(FITNESS_DIR, dateDir);
      if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
        fs.rmdirSync(dir);
        console.log(`  📁 Removed empty directory: ${dateDir}`);
      }
    }
  }

  console.log(`
Summary:
  Total sessions scanned: ${totalSessions}
  Purged (< ${PURGE_THRESHOLD}s):     ${purgedCount}
  Backfilled media IDs:   ${backfilledCount}
  Already had IDs:        ${alreadyGoodCount}
  No media events:        ${noMediaCount}
  Errors:                 ${errorCount}
`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
