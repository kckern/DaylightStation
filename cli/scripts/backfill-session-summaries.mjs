#!/usr/bin/env node
/**
 * Backfill session summary blocks into existing fitness session YAML files.
 *
 * Reads each session, decodes RLE-encoded timeline series, computes the summary
 * via buildSessionSummary(), and writes the summary block back into the YAML.
 *
 * Usage:
 *   node cli/scripts/backfill-session-summaries.mjs [options]
 *
 * Options:
 *   --write            Actually persist changes (dry-run by default)
 *   --force            Overwrite existing summary blocks
 *   --data-path /path  Override default data path
 *   --help, -h         Show this help message
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { buildSessionSummary } from '../../frontend/src/hooks/fitness/buildSessionSummary.js';
import { decodeSeries } from '../../backend/src/2_domains/fitness/services/TimelineService.mjs';

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_DATA_PATH = process.env.DAYLIGHT_DATA_PATH
  || '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data';

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const FORCE = args.includes('--force');
const HELP = args.includes('--help') || args.includes('-h');

const dataPathIdx = args.indexOf('--data-path');
const DATA_PATH = dataPathIdx !== -1 && args[dataPathIdx + 1]
  ? args[dataPathIdx + 1]
  : DEFAULT_DATA_PATH;

if (HELP) {
  console.log(`
Usage: node cli/scripts/backfill-session-summaries.mjs [options]

Options:
  --write            Actually persist changes (dry-run by default)
  --force            Overwrite existing summary blocks
  --data-path /path  Override default data path
  --help, -h         Show this help message
`);
  process.exit(0);
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

function main() {
  console.log('Session Summary Backfill');
  console.log(`  Data path: ${DATA_PATH}`);
  console.log(`  Mode: ${WRITE ? 'WRITE' : 'DRY-RUN'}`);
  console.log(`  Force overwrite: ${FORCE}`);
  console.log();

  const dateDirs = listDateDirs();
  console.log(`Found ${dateDirs.length} date directories\n`);

  let totalSessions = 0;
  let addedCount = 0;
  let skippedCount = 0;
  let noTimelineCount = 0;
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

      const sessionId = data.sessionId || path.basename(filePath, '.yml');

      // Skip if summary already exists (unless --force)
      if (data.summary && !FORCE) {
        skippedCount++;
        continue;
      }

      // Need timeline.series to compute summary
      if (!data.timeline?.series || typeof data.timeline.series !== 'object') {
        noTimelineCount++;
        continue;
      }

      try {
        // Decode RLE-encoded series back to raw arrays
        const decodedSeries = decodeSeries(data.timeline.series);

        const intervalSeconds = data.timeline?.interval_seconds || 5;
        const events = data.timeline?.events || [];

        const summary = buildSessionSummary({
          participants: data.participants || {},
          series: decodedSeries,
          events,
          treasureBox: data.treasureBox,
          intervalSeconds,
        });

        data.summary = summary;

        if (WRITE) {
          writeSession(filePath, data);
          console.log(`  ✏ Added summary: ${sessionId}`);
        } else {
          console.log(`  ✏ [dry-run] Would add summary: ${sessionId}`);
        }
        addedCount++;
      } catch (err) {
        console.error(`  ✗ Error processing ${sessionId}: ${err.message}`);
        errorCount++;
      }
    }
  }

  console.log(`
Summary:
  Total sessions scanned: ${totalSessions}
  Summaries added:        ${addedCount}
  Already had summary:    ${skippedCount}
  No timeline data:       ${noTimelineCount}
  Errors:                 ${errorCount}
`);
}

main();
