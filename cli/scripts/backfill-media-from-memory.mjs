#!/usr/bin/env node
/**
 * Cross-reference media_memory with fitness sessions to recover lost media events.
 *
 * When a browser refresh or crash causes in-memory events to be lost,
 * media_memory/plex/14_fitness.yml still records what Plex content was playing.
 * This script cross-references those timestamps against session time windows
 * to reconstruct media events for sessions that lost them.
 *
 * Usage:
 *   node cli/scripts/backfill-media-from-memory.mjs [options]
 *
 * Options:
 *   --write              Actually persist changes (dry-run by default)
 *   --api-base <url>     Backend API base URL for Plex lookups (default: http://localhost:3112)
 *   --data-path /path    Override default data path
 *   --help, -h           Show this help message
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
const WRITE = args.includes('--write');
const HELP = args.includes('--help') || args.includes('-h');

const dataPathIdx = args.indexOf('--data-path');
const DATA_PATH = dataPathIdx !== -1 && args[dataPathIdx + 1]
  ? args[dataPathIdx + 1]
  : DEFAULT_DATA_PATH;

const apiIdx = args.indexOf('--api-base');
const API_BASE = apiIdx !== -1 && args[apiIdx + 1]
  ? args[apiIdx + 1]
  : 'http://localhost:3112';

if (HELP) {
  console.log(`
Usage: node cli/scripts/backfill-media-from-memory.mjs [options]

Options:
  --write              Actually persist changes (dry-run by default)
  --api-base <url>     Backend API base URL for Plex lookups (default: http://localhost:3112)
  --data-path /path    Override default data path
  --help, -h           Show this help message
`);
  process.exit(0);
}

// =============================================================================
// File Helpers
// =============================================================================

const FITNESS_DIR = path.join(DATA_PATH, 'household', 'history', 'fitness');
const MEDIA_MEMORY_FILE = path.join(DATA_PATH, 'household', 'history', 'media_memory', 'plex', '14_fitness.yml');

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

function readYaml(filePath) {
  try {
    return yaml.load(fs.readFileSync(filePath, 'utf8'));
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
// Plex Metadata Lookup
// =============================================================================

const plexCache = new Map();

async function lookupPlexItem(plexId) {
  const key = String(plexId);
  if (plexCache.has(key)) return plexCache.get(key);
  try {
    const res = await fetch(`${API_BASE}/api/v1/item/plex/${key}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      plexCache.set(key, null);
      return null;
    }
    const data = await res.json();
    plexCache.set(key, data);
    return data;
  } catch {
    plexCache.set(key, null);
    return null;
  }
}

// =============================================================================
// Parse media_memory entries into timestamped records
// =============================================================================

function parseMediaMemory(memoryData) {
  if (!memoryData || typeof memoryData !== 'object') return [];
  const entries = [];
  for (const [key, value] of Object.entries(memoryData)) {
    if (!value || typeof value !== 'object') continue;
    const lastPlayed = value.lastPlayed;
    if (!lastPlayed) continue;
    const ts = new Date(lastPlayed).getTime();
    if (!Number.isFinite(ts)) continue;
    // Extract numeric plex ID from key like "plex:662665"
    const match = key.match(/^plex:(\d+)$/);
    if (!match) continue;
    entries.push({
      plexId: match[1],
      key,
      lastPlayedTs: ts,
      lastPlayed,
      playhead: value.playhead ?? null,
      duration: value.duration ?? null,
      watchTime: value.watchTime ?? null,
      percent: value.percent ?? null,
    });
  }
  return entries.sort((a, b) => a.lastPlayedTs - b.lastPlayedTs);
}

// =============================================================================
// Parse session time windows
// =============================================================================

function parseSessionWindow(sessionData) {
  const start = sessionData?.session?.start;
  const end = sessionData?.session?.end;
  if (!start) return null;
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : null;
  if (!Number.isFinite(startMs)) return null;
  return {
    startMs,
    endMs: Number.isFinite(endMs) ? endMs : startMs + (sessionData?.session?.duration_seconds ?? 3600) * 1000,
  };
}

function sessionHasMediaEvents(sessionData) {
  const events = sessionData?.timeline?.events;
  if (!Array.isArray(events) || events.length === 0) return false;
  return events.some(e => e?.type === 'media');
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log('Media Memory Cross-Reference Backfill');
  console.log(`  Data path: ${DATA_PATH}`);
  console.log(`  API base:  ${API_BASE}`);
  console.log(`  Mode: ${WRITE ? 'WRITE' : 'DRY-RUN'}`);
  console.log();

  // Step 1: Load media_memory
  if (!fs.existsSync(MEDIA_MEMORY_FILE)) {
    console.error(`Media memory file not found: ${MEDIA_MEMORY_FILE}`);
    process.exit(1);
  }
  const memoryData = readYaml(MEDIA_MEMORY_FILE);
  const memoryEntries = parseMediaMemory(memoryData);
  console.log(`Loaded ${memoryEntries.length} media_memory entries\n`);

  // Step 2: Load all sessions and find those needing media recovery
  const dateDirs = listDateDirs();
  let totalSessions = 0;
  let alreadyHasMedia = 0;
  let noTimeWindow = 0;
  let noMatches = 0;
  let recovered = 0;
  let errorCount = 0;

  for (const dateDir of dateDirs) {
    const files = listSessionFiles(dateDir);

    for (const filePath of files) {
      totalSessions++;
      const data = readYaml(filePath);
      if (!data) {
        errorCount++;
        continue;
      }

      // Skip sessions that already have media events
      if (sessionHasMediaEvents(data)) {
        alreadyHasMedia++;
        continue;
      }

      // Parse session time window
      const window = parseSessionWindow(data);
      if (!window) {
        noTimeWindow++;
        continue;
      }

      const sessionId = data.sessionId || path.basename(filePath, '.yml');

      // Find media_memory entries whose lastPlayed falls within this session
      const matches = memoryEntries.filter(e =>
        e.lastPlayedTs >= window.startMs && e.lastPlayedTs <= window.endMs
      );

      if (matches.length === 0) {
        noMatches++;
        continue;
      }

      // Build media events from matches
      const mediaEvents = [];
      const summaryMedia = [];

      for (const match of matches) {
        // Try to look up Plex metadata for richer events
        let meta = null;
        try { meta = await lookupPlexItem(match.plexId); } catch { /* ok */ }

        const title = meta?.title || `Plex ${match.plexId}`;
        const grandparentTitle = meta?.grandparentTitle || null;
        const parentTitle = meta?.parentTitle || null;
        const grandparentId = meta?.grandparentId || meta?.grandparentRatingKey || null;
        const parentId = meta?.parentId || meta?.parentRatingKey || null;
        const contentType = meta?.type || 'episode';
        const durationSeconds = match.duration || (meta?.duration ? Math.round(meta.duration / 1000) : null);

        // Estimate start time: lastPlayed - watchTime (or playhead as fallback)
        const watchSeconds = match.watchTime || match.playhead || 0;
        const estimatedStartMs = match.lastPlayedTs - (watchSeconds * 1000);
        const startMs = Math.max(estimatedStartMs, window.startMs);

        mediaEvents.push({
          timestamp: startMs,
          type: 'media',
          data: {
            contentId: match.plexId,
            title,
            ...(grandparentTitle ? { grandparentTitle } : {}),
            ...(parentTitle ? { parentTitle } : {}),
            ...(grandparentId ? { grandparentId: Number(grandparentId) || grandparentId } : {}),
            ...(parentId ? { parentId: Number(parentId) || parentId } : {}),
            contentType,
            ...(durationSeconds ? { durationSeconds } : {}),
            start: startMs,
            end: match.lastPlayedTs,
            source: 'media_memory_crossref',
          },
        });

        const summaryEntry = {
          contentId: match.plexId,
          title,
          ...(grandparentTitle ? { showTitle: grandparentTitle } : {}),
          ...(grandparentId ? { grandparentId: Number(grandparentId) || grandparentId } : {}),
          ...(parentId ? { parentId: Number(parentId) || parentId } : {}),
        };
        summaryMedia.push(summaryEntry);
      }

      // Mark longest as primary
      if (summaryMedia.length > 0) {
        let longestIdx = 0;
        let longestDur = 0;
        mediaEvents.forEach((evt, i) => {
          const dur = (evt.data.end || 0) - (evt.data.start || 0);
          if (dur > longestDur) {
            longestDur = dur;
            longestIdx = i;
          }
        });
        summaryMedia[longestIdx].primary = true;
      }

      // Apply to session data
      if (!data.timeline) data.timeline = {};
      if (!Array.isArray(data.timeline.events)) data.timeline.events = [];
      data.timeline.events.push(...mediaEvents);
      data.timeline.events.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

      // Update summary.media
      if (!data.summary) data.summary = {};
      const existingSummaryMedia = data.summary.media;
      if (!Array.isArray(existingSummaryMedia) || existingSummaryMedia.length === 0) {
        data.summary.media = summaryMedia;
      }

      const desc = matches.map(m => `plex:${m.plexId} (${m.lastPlayed})`).join(', ');
      console.log(`  ✓ ${sessionId}: recovered ${matches.length} media → ${desc}`);

      if (WRITE) {
        writeSession(filePath, data);
      }
      recovered++;
    }
  }

  console.log(`
=== Media Memory Cross-Reference ${WRITE ? '' : '(DRY RUN)'} ===
  Total sessions scanned:   ${totalSessions}
  Already have media:       ${alreadyHasMedia}
  No time window:           ${noTimeWindow}
  No matching media:        ${noMatches}
  Recovered:                ${recovered}
  Errors:                   ${errorCount}
`);

  if (!WRITE && recovered > 0) {
    console.log('Dry run — no files written. Use --write to apply.\n');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
