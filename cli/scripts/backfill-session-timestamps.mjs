#!/usr/bin/env node
/**
 * Backfill session timestamps (timezone fix) and infer media event durations.
 *
 * 1. Timezone fix: Phase 2 sessions (Jan 6+) have session.start/end stored as
 *    UTC when they should be local time. Detects affected sessions by comparing
 *    the sessionId hour against session.start hour, then re-formats in the
 *    session's timezone.
 *
 * 2. Media duration inference: Media events have start but no end. Infers end
 *    from the next media event's start (or session end for the last one).
 *
 * 3. Re-computes session summary block after fixes.
 *
 * Usage:
 *   node cli/scripts/backfill-session-timestamps.mjs [options]
 *
 * Options:
 *   --write            Actually persist changes (dry-run by default)
 *   --data-path /path  Override default data path
 *   --help, -h         Show this help message
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import moment from 'moment-timezone';
import { buildSessionSummary } from '../../frontend/src/hooks/fitness/buildSessionSummary.js';
import { decodeSeries } from '../../backend/src/2_domains/fitness/services/TimelineService.mjs';

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

if (HELP) {
  console.log(`
Usage: node cli/scripts/backfill-session-timestamps.mjs [options]

Options:
  --write            Actually persist changes (dry-run by default)
  --data-path /path  Override default data path
  --help, -h         Show this help message
`);
  process.exit(0);
}

// =============================================================================
// Helpers
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
    return yaml.load(fs.readFileSync(filePath, 'utf8'));
  } catch { return null; }
}

function writeSession(filePath, data) {
  fs.writeFileSync(filePath, yaml.dump(data, {
    lineWidth: -1, noRefs: true, quotingType: "'", forceQuotes: false,
  }), 'utf8');
}

/**
 * Format epoch ms as "YYYY-MM-DD HH:mm:ss.SSS" in the given timezone.
 */
function formatLocal(epochMs, tz) {
  return moment(epochMs).tz(tz).format('YYYY-MM-DD HH:mm:ss.SSS');
}

/**
 * Parse a "YYYY-MM-DD HH:mm:ss[.SSS]" string as UTC and return epoch ms.
 */
function parseAsUtc(str) {
  const m = moment.utc(str, 'YYYY-MM-DD HH:mm:ss.SSS');
  return m.isValid() ? m.valueOf() : null;
}

/**
 * Parse a "YYYY-MM-DD HH:mm:ss[.SSS]" string as local time in tz, return epoch ms.
 */
function parseAsLocal(str, tz) {
  const m = moment.tz(str, 'YYYY-MM-DD HH:mm:ss.SSS', tz);
  return m.isValid() ? m.valueOf() : null;
}

/**
 * Extract hour from sessionId (format: YYYYMMDDHHmmss).
 */
function sessionIdHour(sid) {
  const num = sid.replace(/^fs_/, '');
  if (num.length < 10) return null;
  return parseInt(num.slice(8, 10), 10);
}

/**
 * Extract hour from a "YYYY-MM-DD HH:mm:ss" string.
 */
function stringHour(str) {
  if (!str) return null;
  const match = str.match(/(\d{2}):\d{2}:\d{2}/);
  return match ? parseInt(match[1], 10) : null;
}

// =============================================================================
// Main
// =============================================================================

function main() {
  console.log('Session Timestamp & Media Duration Backfill');
  console.log(`  Data path: ${DATA_PATH}`);
  console.log(`  Mode: ${WRITE ? 'WRITE' : 'DRY-RUN'}`);
  console.log();

  const dateDirs = listDateDirs();
  console.log(`Found ${dateDirs.length} date directories\n`);

  let total = 0;
  let tzFixed = 0;
  let tzSkipped = 0;
  let mediaFixed = 0;
  let mediaSkipped = 0;
  let errors = 0;

  for (const dateDir of dateDirs) {
    for (const filePath of listSessionFiles(dateDir)) {
      total++;
      const data = readSession(filePath);
      if (!data) { errors++; continue; }

      const sid = data.sessionId || path.basename(filePath, '.yml');
      const tz = data.timezone || 'America/Los_Angeles';
      let modified = false;

      // ------------------------------------------------------------------
      // 1. Timezone fix
      // ------------------------------------------------------------------
      const startStr = data.session?.start;
      const endStr = data.session?.end;
      const sidHour = sessionIdHour(sid);
      const startHour = stringHour(startStr);

      if (sidHour != null && startHour != null && sidHour !== startHour) {
        // Phase 2: session.start is UTC, needs conversion to local
        const startMs = parseAsUtc(startStr);
        const endMs = endStr ? parseAsUtc(endStr) : null;

        if (startMs) {
          const fixedStart = formatLocal(startMs, tz);
          const fixedEnd = endMs ? formatLocal(endMs, tz) : null;
          const fixedDate = fixedStart.slice(0, 10);

          console.log(`  TZ  ${sid}: "${startStr}" → "${fixedStart}"`);
          data.session.start = fixedStart;
          if (fixedEnd) data.session.end = fixedEnd;
          if (data.session.date) data.session.date = fixedDate;
          modified = true;
          tzFixed++;
        }
      } else {
        tzSkipped++;
      }

      // ------------------------------------------------------------------
      // 2. Media duration inference
      // ------------------------------------------------------------------
      const events = data.timeline?.events || [];
      const mediaEvents = events
        .filter(e => e.type === 'media' && e.data?.start != null)
        .sort((a, b) => a.data.start - b.data.start);

      if (mediaEvents.length > 0) {
        // Resolve session end time for the last media event's end
        let sessionEndMs = null;
        const correctedEnd = data.session?.end;
        if (correctedEnd) {
          sessionEndMs = parseAsLocal(correctedEnd, tz);
        }
        if (!sessionEndMs && data.session?.duration_seconds && data.session?.start) {
          const startMs = parseAsLocal(data.session.start, tz);
          if (startMs) sessionEndMs = startMs + data.session.duration_seconds * 1000;
        }

        let anyMediaFixed = false;
        for (let i = 0; i < mediaEvents.length; i++) {
          const evt = mediaEvents[i];
          const nextStart = mediaEvents[i + 1]?.data?.start;
          const inferredEnd = nextStart || sessionEndMs;

          if (inferredEnd && evt.data.end == null) {
            evt.data.end = inferredEnd;
            anyMediaFixed = true;
          }
        }

        if (anyMediaFixed) {
          console.log(`  MED ${sid}: inferred end times for ${mediaEvents.length} media event(s)`);
          modified = true;
          mediaFixed++;
        } else {
          mediaSkipped++;
        }
      } else {
        mediaSkipped++;
      }

      // ------------------------------------------------------------------
      // 3. Re-compute summary if anything changed
      // ------------------------------------------------------------------
      if (modified && data.timeline?.series) {
        try {
          const decodedSeries = decodeSeries(data.timeline.series);
          const intervalSeconds = data.timeline?.interval_seconds || 5;
          data.summary = buildSessionSummary({
            participants: data.participants || {},
            series: decodedSeries,
            events: data.timeline?.events || [],
            treasureBox: data.treasureBox,
            intervalSeconds,
          });
        } catch (err) {
          console.error(`  ERR ${sid}: summary recompute failed: ${err.message}`);
        }
      }

      // ------------------------------------------------------------------
      // 4. Write
      // ------------------------------------------------------------------
      if (modified) {
        if (WRITE) {
          writeSession(filePath, data);
        } else {
          // dry-run, no write
        }
      }
    }
  }

  console.log(`
Summary:
  Total sessions:         ${total}
  Timezone fixed:         ${tzFixed}
  Timezone already OK:    ${tzSkipped}
  Media durations added:  ${mediaFixed}
  Media skipped:          ${mediaSkipped}
  Errors:                 ${errors}
`);
}

main();
