#!/usr/bin/env node
/**
 * Backfill empty-events sessions with matched media data,
 * and archive unmatched sessions.
 *
 * Uses media memory (14_fitness.yml) lastPlayed timestamps to identify
 * which media was playing during sessions that have events: [].
 *
 * Usage:
 *   node cli/scripts/backfill-empty-sessions.mjs [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const DEFAULT_DATA_PATH = process.env.DAYLIGHT_DATA_PATH
  || '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const API_BASE = 'http://localhost:3112';

const FITNESS_DIR = path.join(DEFAULT_DATA_PATH, 'household', 'history', 'fitness');
const MEDIA_MEMORY_PATH = path.join(DEFAULT_DATA_PATH, 'household', 'history', 'media_memory', 'plex', '14_fitness.yml');
const ARCHIVE_DIR = path.join(FITNESS_DIR, '_archived_empty_events');

// ── Load media memory ──────────────────────────────────────────

function loadMediaMemory() {
  const content = fs.readFileSync(MEDIA_MEMORY_PATH, 'utf8');
  return yaml.load(content);
}

// ── Session helpers ────────────────────────────────────────────

function listAllSessions() {
  const sessions = [];
  for (const dateDir of fs.readdirSync(FITNESS_DIR)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateDir)) continue;
    const dir = path.join(FITNESS_DIR, dateDir);
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.yml')) continue;
      sessions.push({ dateDir, filePath: path.join(dir, file), fileName: file });
    }
  }
  return sessions;
}

function readSession(filePath) {
  try {
    return yaml.load(fs.readFileSync(filePath, 'utf8'));
  } catch { return null; }
}

function writeSession(filePath, data) {
  const content = yaml.dump(data, { lineWidth: -1, noRefs: true, quotingType: "'", forceQuotes: false });
  fs.writeFileSync(filePath, content, 'utf8');
}

// ── Timestamp parsing ──────────────────────────────────────────

/**
 * Session start/end are stored in UTC.
 * Media memory lastPlayed is stored in local time (America/Los_Angeles).
 * Convert both to comparable unix timestamps.
 */
function parseSessionTimestamp(ts) {
  // Session timestamps are UTC: '2026-01-01 09:03:19.000'
  if (!ts) return null;
  return new Date(ts.replace(' ', 'T') + 'Z').getTime();
}

function parseMediaTimestamp(ts) {
  // Media memory timestamps are local (PST/PDT).
  // PST = UTC-8, PDT = UTC-7. For simplicity, use PST (-8) for winter dates.
  if (!ts) return null;
  const d = new Date(ts.replace(' ', 'T'));
  // JavaScript's Date() parses without timezone as local time on the machine.
  // Since this runs on a machine in America/Los_Angeles, this should already be correct.
  return d.getTime();
}

// ── Plex API lookup ────────────────────────────────────────────

const plexCache = new Map();

async function lookupPlexItem(plexId) {
  const key = String(plexId);
  if (plexCache.has(key)) return plexCache.get(key);
  try {
    const res = await fetch(`${API_BASE}/api/v1/item/plex/${key}`);
    if (!res.ok) { plexCache.set(key, null); return null; }
    const data = await res.json();
    plexCache.set(key, data);
    return data;
  } catch {
    plexCache.set(key, null);
    return null;
  }
}

// ── Main ───────────────────────────────────────────────────────

async function main() {
  console.log('Empty-Events Session Backfill & Archive');
  console.log(`  Data path: ${DEFAULT_DATA_PATH}`);
  console.log(`  Dry run: ${DRY_RUN}\n`);

  const mediaMemory = loadMediaMemory();
  const allSessions = listAllSessions();

  // Find sessions with empty events
  const emptySessions = [];
  for (const { dateDir, filePath, fileName } of allSessions) {
    const data = readSession(filePath);
    if (!data) continue;
    const events = data.timeline?.events;
    if (Array.isArray(events) && events.length === 0) {
      emptySessions.push({ dateDir, filePath, fileName, data });
    }
  }

  console.log(`Found ${emptySessions.length} sessions with empty events\n`);

  // Build media memory index: array of { mediaId, lastPlayedMs, entry }
  const mediaIndex = [];
  for (const [key, entry] of Object.entries(mediaMemory)) {
    if (!entry.lastPlayed) continue;
    const ms = parseMediaTimestamp(entry.lastPlayed);
    if (!ms) continue;
    mediaIndex.push({ mediaId: key, lastPlayedMs: ms, entry });
  }

  const BUFFER_MS = 5 * 60 * 1000; // 5 min buffer
  const matched = [];
  const unmatched = [];

  for (const session of emptySessions) {
    const startMs = parseSessionTimestamp(session.data.session?.start);
    const endMs = parseSessionTimestamp(session.data.session?.end);
    if (!startMs || !endMs) {
      unmatched.push(session);
      continue;
    }

    // Find media items whose lastPlayed falls within [start - buffer, end + buffer]
    const windowStart = startMs - BUFFER_MS;
    const windowEnd = endMs + BUFFER_MS;
    const matches = mediaIndex.filter(m => m.lastPlayedMs >= windowStart && m.lastPlayedMs <= windowEnd);

    if (matches.length > 0) {
      // Take the match closest to the session end time
      matches.sort((a, b) => Math.abs(a.lastPlayedMs - endMs) - Math.abs(b.lastPlayedMs - endMs));
      matched.push({ ...session, match: matches[0] });
    } else {
      unmatched.push(session);
    }
  }

  console.log(`Matched: ${matched.length}, Unmatched: ${unmatched.length}\n`);

  // ── Backfill matched sessions ──────────────────────────────
  console.log('── Backfilling matched sessions ──\n');
  for (const { filePath, fileName, data, match } of matched) {
    const rawId = match.mediaId.replace('plex:', '');
    const item = await lookupPlexItem(rawId);
    const sessionId = data.sessionId || path.basename(fileName, '.yml');

    if (!item) {
      console.log(`  ⚠ Could not look up ${match.mediaId} for session ${sessionId}`);
      unmatched.push({ filePath, fileName, data });
      continue;
    }

    const mediaEvent = {
      timestamp: parseSessionTimestamp(data.session?.start),
      type: 'media',
      data: {
        mediaId: String(item.key || rawId),
        title: item.title || null,
        grandparentTitle: item.grandparentTitle || null,
        parentTitle: item.parentTitle || null,
        grandparentId: item.grandparentId || null,
        parentId: item.parentId || null,
        contentType: item.type || 'episode',
        durationSeconds: item.duration || null,
        start: parseSessionTimestamp(data.session?.start),
        end: null,
        source: 'backfill_media_memory',
      }
    };

    data.timeline.events = [mediaEvent];

    if (DRY_RUN) {
      console.log(`  ✏ [dry-run] Would backfill ${sessionId} with ${item.title} (${item.grandparentTitle})`);
    } else {
      writeSession(filePath, data);
      console.log(`  ✏ Backfilled ${sessionId} with ${item.title} (${item.grandparentTitle})`);
    }
  }

  // ── Archive unmatched sessions ─────────────────────────────
  console.log(`\n── Archiving ${unmatched.length} unmatched sessions ──\n`);

  if (!DRY_RUN && !fs.existsSync(ARCHIVE_DIR)) {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  }

  for (const { dateDir, filePath, fileName } of unmatched) {
    const archiveDateDir = path.join(ARCHIVE_DIR, dateDir);
    const archivePath = path.join(archiveDateDir, fileName);

    if (DRY_RUN) {
      console.log(`  📦 [dry-run] Would archive ${dateDir}/${fileName}`);
    } else {
      if (!fs.existsSync(archiveDateDir)) {
        fs.mkdirSync(archiveDateDir, { recursive: true });
      }
      fs.renameSync(filePath, archivePath);
      console.log(`  📦 Archived ${dateDir}/${fileName}`);

      // Clean up empty source directory
      const sourceDir = path.join(FITNESS_DIR, dateDir);
      if (fs.existsSync(sourceDir) && fs.readdirSync(sourceDir).length === 0) {
        fs.rmdirSync(sourceDir);
        console.log(`  📁 Removed empty directory: ${dateDir}`);
      }
    }
  }

  console.log(`\nDone! Backfilled: ${matched.length}, Archived: ${unmatched.length}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
