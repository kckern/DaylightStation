#!/usr/bin/env node
/**
 * Backfill empty summary.media arrays in fitness session files.
 *
 * Many sessions from ~Jan 2026 onward have `media: []` in their summary
 * despite having video playing. This script cross-references media memory
 * (14_fitness.yml) lastPlayed timestamps against session time windows to
 * reconstruct which media was playing during each session.
 *
 * Usage:
 *   node cli/scripts/backfill-watchtime.mjs <media-yml> <sessions-dir> [--dry-run]
 *
 * Example:
 *   node cli/scripts/backfill-watchtime.mjs \
 *     /path/to/media_memory/plex/14_fitness.yml \
 *     /path/to/history/fitness/ \
 *     --dry-run
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const MEDIA_PATH = process.argv[2];
const SESSIONS_DIR = process.argv[3];
const DRY_RUN = process.argv.includes('--dry-run');

if (!MEDIA_PATH || !SESSIONS_DIR) {
  console.error('Usage: node backfill-watchtime.mjs <media-yml> <sessions-dir> [--dry-run]');
  process.exit(1);
}

// ── Step 1: Build a date→media index from 14_fitness.yml ──

const mediaContent = fs.readFileSync(MEDIA_PATH, 'utf8');
const mediaData = yaml.load(mediaContent) || {};

// Index: "YYYY-MM-DD" → [{ id, lastPlayedMs, playhead, duration, percent }]
const mediaByDate = new Map();

for (const [id, entry] of Object.entries(mediaData)) {
  if (!entry?.lastPlayed) continue;
  const lp = entry.lastPlayed;
  const date = typeof lp === 'string' ? lp.slice(0, 10) : '';
  if (!date) continue;

  // Parse lastPlayed to ms (assume local time, same as session timestamps)
  const lpMs = new Date(lp).getTime();
  if (!Number.isFinite(lpMs)) continue;

  if (!mediaByDate.has(date)) mediaByDate.set(date, []);
  mediaByDate.get(date).push({
    id,
    lastPlayedMs: lpMs,
    playhead: entry.playhead || 0,
    duration: entry.duration || 0,
    percent: entry.percent || 0
  });
}

console.log(`Loaded ${Object.keys(mediaData).length} media entries across ${mediaByDate.size} dates.\n`);

// ── Step 2: Scan sessions with media: [] and match ──

const WINDOW_AFTER_END_MS = 2 * 60 * 60 * 1000; // 2 hours grace after session end
let fixed = 0;
let skipped = 0;
const changes = [];

const dateDirs = fs.readdirSync(SESSIONS_DIR).sort();

for (const dateDir of dateDirs) {
  const datePath = path.join(SESSIONS_DIR, dateDir);
  try {
    if (!fs.statSync(datePath).isDirectory()) continue;
  } catch { continue; }

  const files = fs.readdirSync(datePath).filter(f => f.endsWith('.yml'));
  for (const file of files) {
    const filePath = path.join(datePath, file);
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch { continue; }

    // Quick check: does this file have media: []?
    if (!content.includes('media: []')) continue;

    let session;
    try {
      session = yaml.load(content);
    } catch { continue; }

    // Get session time window
    const startStr = session?.session?.start;
    const endStr = session?.session?.end;
    if (!startStr || !endStr) { skipped++; continue; }

    const startMs = new Date(startStr).getTime();
    const endMs = new Date(endStr).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) { skipped++; continue; }

    // Find media whose lastPlayed falls within session window
    // lastPlayed is end-of-playback (Plex), so it's typically AFTER session end
    // Match: lastPlayed >= session start AND lastPlayed <= session end + grace window
    const sessionDate = dateDir;
    const candidates = mediaByDate.get(sessionDate) || [];

    const matched = candidates.filter(m =>
      m.lastPlayedMs >= startMs && m.lastPlayedMs <= endMs + WINDOW_AFTER_END_MS
    );

    if (matched.length === 0) continue;

    // Replace media: [] with matched IDs
    const mediaIds = matched.map(m => m.id);

    // Update the YAML — replace `media: []` with the list
    const mediaYaml = mediaIds.map(id => `    - ${id}`).join('\n');
    const updatedContent = content.replace(
      /^(\s+media:) \[\]/m,
      `$1\n${mediaYaml}`
    );

    if (updatedContent === content) { skipped++; continue; }

    changes.push({ file: path.join(dateDir, file), mediaIds });

    if (!DRY_RUN) {
      fs.writeFileSync(filePath, updatedContent);
    }
    fixed++;
  }
}

// ── Report ──

console.log(`=== Session Media Backfill ${DRY_RUN ? '(DRY RUN)' : ''} ===\n`);

for (const c of changes) {
  console.log(`  ${c.file}: ${c.mediaIds.join(', ')}`);
}

console.log(`\nSessions fixed: ${fixed}`);
console.log(`Sessions skipped (no match or parse error): ${skipped}`);

if (DRY_RUN) {
  console.log('\nDry run — no changes written. Remove --dry-run to apply.');
}
