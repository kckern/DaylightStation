/**
 * Backfill the Plex fitness media-memory file from fitness session history.
 *
 * Scans every stored fitness session for Plex content IDs (from
 * `summary.media`, `timeline.events`, and the legacy `plexId` field) and
 * appends minimal `{ playCount, lastPlayed }` entries to
 * `data/household/media/memory/plex/14_fitness.yml` for any ID not
 * already present.
 *
 * Dry-run by default; `--write` appends.
 *
 * Converted from the standalone `cli/backfill-fitness-media-memory.mjs`.
 *
 * @module cli/lib/fitness/backfillMediaMemory
 */

import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { parseArgs, bool } from './argv.mjs';
import { CliError } from './context.mjs';

export const spec = {
  name: 'backfill-memory',
  summary: 'append missing plex ids from session history to 14_fitness.yml',
  usage: 'fitness media backfill-memory [--write]',
  details: `  --write   Apply changes (default: dry run)`,
};

/**
 * @param {string[]} argv - argv tail AFTER the group+command tokens
 * @param {Object} ctx - from `getContext()`
 * @returns {Promise<Object>}
 */
export async function run(argv, ctx) {
  const { flags } = parseArgs(argv, { booleanFlags: ['write'] });
  const writeMode = bool(flags, 'write');

  const fitnessHistoryDir = process.env.FITNESS_HISTORY_DIR || ctx.fitnessHistoryDir;
  const mediaMemoryPath = process.env.MEDIA_MEMORY_PATH
    || path.join(ctx.dataDir, 'household', 'media', 'memory', 'plex', '14_fitness.yml');

  // ------------------------------------------------------------------
  // 1. Scan fitness sessions for plex content IDs
  // ------------------------------------------------------------------
  console.log('Scanning fitness sessions...');

  if (!fs.existsSync(fitnessHistoryDir)) {
    throw new CliError(`Fitness history directory not found: ${fitnessHistoryDir}`);
  }

  const dateDirs = fs.readdirSync(fitnessHistoryDir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  console.log(`Found ${dateDirs.length} session date directories`);

  // Map: plexId -> { playCount, lastPlayed }
  const plexMap = new Map();
  let sessionsScanned = 0;
  let sessionsWithMedia = 0;

  for (const dateDir of dateDirs) {
    const dirPath = path.join(fitnessHistoryDir, dateDir);
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

  // ------------------------------------------------------------------
  // 2. Load existing 14_fitness.yml keys
  // ------------------------------------------------------------------
  if (!fs.existsSync(mediaMemoryPath)) {
    throw new CliError(`Media memory file not found: ${mediaMemoryPath}`);
  }
  const mediaMemoryRaw = fs.readFileSync(mediaMemoryPath, 'utf8');
  const mediaMemory = YAML.parse(mediaMemoryRaw) || {};
  const existingKeys = new Set(Object.keys(mediaMemory));

  console.log(`Existing entries in 14_fitness.yml: ${existingKeys.size}`);

  // ------------------------------------------------------------------
  // 3. Find missing entries
  // ------------------------------------------------------------------
  const missing = [];
  for (const [id, data] of plexMap) {
    if (!existingKeys.has(id)) {
      missing.push({ id, ...data });
    }
  }

  missing.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

  console.log(`\nMissing from 14_fitness.yml: ${missing.length} entries`);

  const summary = {
    writeMode,
    mediaMemoryPath,
    fitnessHistoryDir,
    sessionsScanned,
    sessionsWithMedia,
    uniqueIds: plexMap.size,
    existingEntries: existingKeys.size,
    missing: missing.length,
    written: 0,
  };

  if (missing.length === 0) {
    console.log('Nothing to backfill!');
    return summary;
  }

  // Show preview
  console.log('\nPreview (first 10):');
  for (const entry of missing.slice(0, 10)) {
    console.log(`  ${entry.id}: playCount=${entry.playCount}, lastPlayed=${entry.lastPlayed}`);
  }
  if (missing.length > 10) console.log(`  ... and ${missing.length - 10} more`);

  // ------------------------------------------------------------------
  // 4. Write if --write flag is set
  // ------------------------------------------------------------------
  if (!writeMode) {
    console.log('\nDry run. Use --write to apply changes.');
    return summary;
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

  fs.appendFileSync(mediaMemoryPath, quotedYaml);

  console.log(`\nWrote ${missing.length} new entries to ${mediaMemoryPath}`);

  summary.written = missing.length;
  return summary;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Collect `plex:`-prefixed content IDs referenced by a session.
 *
 * @param {Object} session - parsed session YAML
 * @returns {Set<string>}
 */
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

/**
 * Prefer `session.start`, fall back to `session.date`.
 *
 * @param {Object} session
 * @returns {string|null}
 */
function getSessionTimestamp(session) {
  return session?.session?.start || session?.session?.date || null;
}
