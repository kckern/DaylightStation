#!/usr/bin/env node

/**
 * Backfill 14_fitness.yml with missing entries from fitness session history.
 *
 * Scans all fitness session files for Plex content IDs (from summary.media,
 * timeline.events, and legacy plexId fields) and creates minimal entries
 * in 14_fitness.yml for any IDs not already present.
 *
 * Usage:
 *   node cli/backfill-fitness-media-memory.mjs          # dry-run (preview)
 *   node cli/backfill-fitness-media-memory.mjs --write   # actually write
 */

import fs from 'fs';
import path from 'path';
import YAML from 'yaml';

const MEDIA_MEMORY_PATH = process.env.MEDIA_MEMORY_PATH
  || path.resolve('data/household/history/media_memory/plex/14_fitness.yml');
const FITNESS_HISTORY_DIR = process.env.FITNESS_HISTORY_DIR
  || path.resolve('data/household/history/fitness');

const writeMode = process.argv.includes('--write');

// ---------------------------------------------------------------------------
// 1. Scan fitness sessions for plex content IDs
// ---------------------------------------------------------------------------
function extractPlexIds(session) {
  const ids = new Set();

  // summary.media[].contentId
  const media = session?.summary?.media || [];
  for (const m of media) {
    if (m.contentId?.startsWith('plex:')) ids.add(m.contentId);
  }

  // timeline.events[].data.contentId and legacy plexId
  const events = session?.timeline?.events || [];
  for (const evt of events) {
    const d = evt.data || {};
    if (d.contentId?.startsWith('plex:')) ids.add(d.contentId);
    if (d.plexId) ids.add(`plex:${d.plexId}`);
  }

  return ids;
}

function getSessionTimestamp(session) {
  // Prefer session.start, fall back to session.date
  return session?.session?.start || session?.session?.date || null;
}

console.log('Scanning fitness sessions...');

const dateDirs = fs.readdirSync(FITNESS_HISTORY_DIR).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
console.log(`Found ${dateDirs.length} session date directories`);

// Map: plexId -> { playCount, lastPlayed }
const plexMap = new Map();
let sessionsScanned = 0;
let sessionsWithMedia = 0;

for (const dateDir of dateDirs) {
  const dirPath = path.join(FITNESS_HISTORY_DIR, dateDir);
  const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.yml'));

  for (const file of files) {
    sessionsScanned++;
    const filePath = path.join(dirPath, file);
    const raw = fs.readFileSync(filePath, 'utf8');
    let session;
    try {
      session = YAML.parse(raw);
    } catch {
      continue; // skip unparseable files
    }

    const ids = extractPlexIds(session);
    if (ids.size === 0) continue;
    sessionsWithMedia++;

    const timestamp = getSessionTimestamp(session);

    for (const id of ids) {
      const existing = plexMap.get(id);
      if (!existing) {
        plexMap.set(id, { playCount: 1, lastPlayed: timestamp });
      } else {
        existing.playCount++;
        if (timestamp && (!existing.lastPlayed || timestamp > existing.lastPlayed)) {
          existing.lastPlayed = timestamp;
        }
      }
    }
  }
}

console.log(`Scanned ${sessionsScanned} sessions, ${sessionsWithMedia} had media references`);
console.log(`Found ${plexMap.size} unique Plex content IDs in sessions`);

// ---------------------------------------------------------------------------
// 2. Load existing 14_fitness.yml keys
// ---------------------------------------------------------------------------
const mediaMemoryRaw = fs.readFileSync(MEDIA_MEMORY_PATH, 'utf8');
const mediaMemory = YAML.parse(mediaMemoryRaw) || {};
const existingKeys = new Set(Object.keys(mediaMemory));

console.log(`Existing entries in 14_fitness.yml: ${existingKeys.size}`);

// ---------------------------------------------------------------------------
// 3. Find missing entries
// ---------------------------------------------------------------------------
const missing = [];
for (const [id, data] of plexMap) {
  if (!existingKeys.has(id)) {
    missing.push({ id, ...data });
  }
}

missing.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

console.log(`\nMissing from 14_fitness.yml: ${missing.length} entries`);

if (missing.length === 0) {
  console.log('Nothing to backfill!');
  process.exit(0);
}

// Show preview
console.log('\nPreview (first 10):');
for (const entry of missing.slice(0, 10)) {
  console.log(`  ${entry.id}: playCount=${entry.playCount}, lastPlayed=${entry.lastPlayed}`);
}
if (missing.length > 10) console.log(`  ... and ${missing.length - 10} more`);

// ---------------------------------------------------------------------------
// 4. Write if --write flag is set
// ---------------------------------------------------------------------------
if (!writeMode) {
  console.log('\nDry run. Use --write to apply changes.');
  process.exit(0);
}

// Build YAML entries to append
const newEntries = {};
for (const entry of missing) {
  const val = { playCount: entry.playCount };
  if (entry.lastPlayed) val.lastPlayed = entry.lastPlayed;
  newEntries[entry.id] = val;
}

const appendYaml = YAML.stringify(newEntries, { lineWidth: 0 });

// Ensure lastPlayed values are quoted so js-yaml parses them as strings, not Date objects.
// The compactItem function in the API layer drops Date objects (they have no enumerable keys).
const quotedYaml = appendYaml.replace(/^(\s+lastPlayed:\s+)(\d{4}-\d{2}-\d{2}\s.+)$/gm, "$1'$2'");

fs.appendFileSync(MEDIA_MEMORY_PATH, quotedYaml);

console.log(`\nWrote ${missing.length} new entries to ${MEDIA_MEMORY_PATH}`);
