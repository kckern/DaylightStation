#!/usr/bin/env node
/**
 * Enrich bare plex:XXXXX media entries in fitness session files
 * with full metadata (show, episode, season, duration, timestamps).
 *
 * Fetches metadata from the local Plex API and rewrites:
 *   summary.media: bare IDs → rich objects with title, showTitle, etc.
 *   timeline.events: adds media event entries with timestamps
 *
 * Usage:
 *   node cli/scripts/enrich-session-media.mjs <sessions-dir> <api-url> [--dry-run]
 *
 * Example:
 *   node cli/scripts/enrich-session-media.mjs \
 *     /path/to/history/fitness/ \
 *     http://localhost:3112 \
 *     --dry-run
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const SESSIONS_DIR = process.argv[2];
const API_URL = process.argv[3] || 'http://localhost:3112';
const DRY_RUN = process.argv.includes('--dry-run');

if (!SESSIONS_DIR) {
  console.error('Usage: node enrich-session-media.mjs <sessions-dir> <api-url> [--dry-run]');
  process.exit(1);
}

// ── Step 1: Collect all unique plex IDs across all sessions ──

const BARE_MEDIA_RE = /^\s+- (plex:\d+)\s*$/;

const sessionFiles = [];
const allPlexIds = new Set();

const dateDirs = fs.readdirSync(SESSIONS_DIR).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();

for (const dateDir of dateDirs) {
  const datePath = path.join(SESSIONS_DIR, dateDir);
  const files = fs.readdirSync(datePath).filter(f => f.endsWith('.yml'));
  for (const file of files) {
    const filePath = path.join(datePath, file);
    const content = fs.readFileSync(filePath, 'utf8');

    // Check if this file has bare plex IDs in media section
    const lines = content.split('\n');
    let inMedia = false;
    let hasBareIds = false;
    const bareIds = [];

    for (const line of lines) {
      if (/^\s+media:/.test(line)) {
        inMedia = true;
        continue;
      }
      if (inMedia) {
        const match = line.match(BARE_MEDIA_RE);
        if (match) {
          bareIds.push(match[1]);
          allPlexIds.add(match[1]);
          hasBareIds = true;
        } else if (/^\s+\S/.test(line) && !line.match(/^\s+-\s/)) {
          inMedia = false;
        }
      }
    }

    if (hasBareIds) {
      sessionFiles.push({ filePath, dateDir, file, bareIds });
    }
  }
}

console.log(`Found ${sessionFiles.length} sessions with bare media IDs`);
console.log(`${allPlexIds.size} unique plex IDs to look up\n`);

if (allPlexIds.size === 0) {
  console.log('Nothing to enrich.');
  process.exit(0);
}

// ── Step 2: Fetch metadata for all unique plex IDs ──

const metadataCache = new Map();
let fetched = 0;
let failed = 0;

for (const plexId of allPlexIds) {
  const numericId = plexId.replace('plex:', '');
  try {
    const resp = await fetch(`${API_URL}/api/v1/info/plex/${numericId}`, {
      signal: AbortSignal.timeout(10000)
    });
    if (!resp.ok) {
      console.log(`  WARN: ${plexId} → HTTP ${resp.status}`);
      failed++;
      continue;
    }
    const data = await resp.json();
    const meta = data.metadata || {};
    metadataCache.set(plexId, {
      mediaId: numericId,
      title: data.title || `Episode ${numericId}`,
      showTitle: meta.grandparentTitle || null,
      seasonTitle: meta.parentTitle || null,
      grandparentId: meta.grandparentRatingKey ? Number(meta.grandparentRatingKey) : null,
      parentId: meta.parentRatingKey ? Number(meta.parentRatingKey) : null,
      contentType: meta.type || data.type || 'episode',
      durationMs: meta.duration ? Number(meta.duration) : null
    });
    fetched++;
  } catch (err) {
    console.log(`  WARN: ${plexId} → ${err.message}`);
    failed++;
  }
}

console.log(`Fetched metadata: ${fetched} OK, ${failed} failed\n`);

// ── Step 3: Rewrite session files ──

let enriched = 0;

for (const { filePath, dateDir, file, bareIds } of sessionFiles) {
  let content = fs.readFileSync(filePath, 'utf8');
  let session;
  try {
    session = yaml.load(content);
  } catch { continue; }

  const startMs = session?.session?.start ? new Date(session.session.start).getTime() : null;
  const endMs = session?.session?.end ? new Date(session.session.end).getTime() : null;
  const durationMs = startMs && endMs ? endMs - startMs : null;

  // Build rich media array for summary
  const richMedia = [];
  const mediaEvents = [];

  for (let i = 0; i < bareIds.length; i++) {
    const plexId = bareIds[i];
    const meta = metadataCache.get(plexId);

    if (meta) {
      // Summary entry
      const summaryEntry = {
        mediaId: meta.mediaId,
        title: meta.title,
        ...(meta.showTitle ? { showTitle: meta.showTitle } : {}),
        ...(meta.seasonTitle ? { seasonTitle: meta.seasonTitle } : {}),
        ...(meta.grandparentId ? { grandparentId: meta.grandparentId } : {}),
        ...(meta.parentId ? { parentId: meta.parentId } : {}),
        ...(meta.durationMs ? { durationMs: meta.durationMs } : {}),
        ...(i === 0 ? { primary: true } : {})
      };
      richMedia.push(summaryEntry);

      // Timeline event — estimate timestamps by dividing session evenly across media
      if (startMs && durationMs) {
        const segmentLength = durationMs / bareIds.length;
        const evtStart = Math.round(startMs + segmentLength * i);
        const evtEnd = Math.round(startMs + segmentLength * (i + 1));

        mediaEvents.push({
          timestamp: evtStart,
          type: 'media',
          data: {
            mediaId: meta.mediaId,
            title: meta.title,
            ...(meta.showTitle ? { grandparentTitle: meta.showTitle } : {}),
            ...(meta.seasonTitle ? { parentTitle: meta.seasonTitle } : {}),
            ...(meta.grandparentId ? { grandparentId: meta.grandparentId } : {}),
            ...(meta.parentId ? { parentId: meta.parentId } : {}),
            contentType: meta.contentType,
            ...(meta.durationMs ? { durationSeconds: Math.round(meta.durationMs / 1000) } : {}),
            start: evtStart,
            end: evtEnd,
            source: 'backfill_enrich'
          }
        });
      }
    } else {
      // Keep bare ID as fallback
      richMedia.push({ mediaId: plexId.replace('plex:', ''), title: `Unknown (${plexId})` });
    }
  }

  // Replace the bare media section in the YAML text
  // Find and replace `media:\n    - plex:XXXXX\n    - plex:YYYYY` blocks
  const mediaYamlLines = richMedia.map((m, i) => {
    const lines = [`    - mediaId: '${m.mediaId}'`];
    lines.push(`      title: ${m.title}`);
    if (m.showTitle) lines.push(`      showTitle: ${m.showTitle}`);
    if (m.seasonTitle) lines.push(`      seasonTitle: ${m.seasonTitle}`);
    if (m.grandparentId) lines.push(`      grandparentId: ${m.grandparentId}`);
    if (m.parentId) lines.push(`      parentId: ${m.parentId}`);
    if (m.durationMs) lines.push(`      durationMs: ${m.durationMs}`);
    if (m.primary) lines.push(`      primary: true`);
    return lines.join('\n');
  }).join('\n');

  // Build regex to find the bare media block
  const barePattern = bareIds.map(id => `\\s+- ${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).join('\\n');
  const mediaBlockRe = new RegExp(`(^\\s+media:)\\n${barePattern}`, 'm');

  const newMediaBlock = `$1\n${mediaYamlLines}`;
  const updatedContent = content.replace(mediaBlockRe, newMediaBlock);

  if (updatedContent === content) {
    // Fallback: replace each bare ID individually in media section
    let fallbackContent = content;
    for (const m of richMedia) {
      const bareId = `plex:${m.mediaId}`;
      const richYaml = [
        `mediaId: '${m.mediaId}'`,
        `      title: ${m.title}`,
        ...(m.showTitle ? [`      showTitle: ${m.showTitle}`] : []),
        ...(m.seasonTitle ? [`      seasonTitle: ${m.seasonTitle}`] : []),
        ...(m.grandparentId ? [`      grandparentId: ${m.grandparentId}`] : []),
        ...(m.parentId ? [`      parentId: ${m.parentId}`] : []),
        ...(m.durationMs ? [`      durationMs: ${m.durationMs}`] : []),
        ...(m.primary ? [`      primary: true`] : [])
      ].join('\n');
      fallbackContent = fallbackContent.replace(
        new RegExp(`(\\s+- )${bareId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm'),
        `$1${richYaml}`
      );
    }

    if (fallbackContent !== content) {
      content = fallbackContent;
    } else {
      console.log(`  SKIP: ${path.join(dateDir, file)} — could not match media block`);
      continue;
    }
  } else {
    content = updatedContent;
  }

  // Add media events to timeline.events if empty
  if (mediaEvents.length > 0) {
    try {
      const parsed = yaml.load(content);
      const existingEvents = parsed?.timeline?.events || [];
      const hasMediaEvents = existingEvents.some(e => e?.type === 'media');

      if (!hasMediaEvents && existingEvents.length === 0) {
        // Replace `events: []` with the media events
        const eventsYaml = mediaEvents.map(evt => {
          const lines = [
            `    - timestamp: ${evt.timestamp}`,
            `      type: ${evt.type}`,
            `      data:`,
            `        mediaId: '${evt.data.mediaId}'`,
            `        title: ${evt.data.title}`,
          ];
          if (evt.data.grandparentTitle) lines.push(`        grandparentTitle: ${evt.data.grandparentTitle}`);
          if (evt.data.parentTitle) lines.push(`        parentTitle: ${evt.data.parentTitle}`);
          if (evt.data.grandparentId) lines.push(`        grandparentId: ${evt.data.grandparentId}`);
          if (evt.data.parentId) lines.push(`        parentId: ${evt.data.parentId}`);
          lines.push(`        contentType: ${evt.data.contentType}`);
          if (evt.data.durationSeconds) lines.push(`        durationSeconds: ${evt.data.durationSeconds}`);
          lines.push(`        start: ${evt.data.start}`);
          lines.push(`        end: ${evt.data.end}`);
          lines.push(`        source: ${evt.data.source}`);
          return lines.join('\n');
        }).join('\n');

        content = content.replace(
          /^(\s+events:) \[\]/m,
          `$1\n${eventsYaml}`
        );
      }
    } catch { /* ignore parse errors for event injection */ }
  }

  if (!DRY_RUN) {
    fs.writeFileSync(filePath, content);
  }
  enriched++;

  const mediaDesc = richMedia.map(m => `${m.showTitle || '?'}/${m.title}`).join(', ');
  console.log(`  ${path.join(dateDir, file)}: ${mediaDesc}`);
}

// ── Report ──

console.log(`\n=== Media Enrichment ${DRY_RUN ? '(DRY RUN)' : ''} ===`);
console.log(`Sessions enriched: ${enriched}`);
console.log(`Metadata fetched: ${fetched}, failed: ${failed}`);

if (DRY_RUN) {
  console.log('\nDry run — no files written. Remove --dry-run to apply.');
}
