/**
 * Merge N fitness session YAML files into a single session.
 *
 * Works around two latent bugs in POST /api/v1/fitness/sessions/merge:
 *   1. Backend doesn't update the session.start/end/duration_seconds strings
 *      on the merged file (so the file claims to start later than its data).
 *   2. Backend doesn't recompute the summary block (so participant.coins,
 *      hr_min/max/avg, and zone_minutes still reflect only the target).
 *
 * This command does both correctly: pairwise-merges decoded timelines via
 * TimelineService.mergeTimelines (gap-filled with nulls), recomputes the
 * summary from scratch using the same logic as buildSessionSummary.js,
 * writes a single merged YAML at <date>/<latestSessionId>.yml, then deletes
 * the now-superfluous source files.
 *
 * Must run where the data volume is readable — inside the daylight-station
 * container, or on a host with DAYLIGHT_BASE_PATH pointing at the data tree.
 *
 * @module cli/lib/fitness/merge
 */

import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';

import {
  decodeSeries,
  encodeSeries,
  mergeTimelines
} from '#domains/fitness/services/TimelineService.mjs';
import {
  getLastNonNull,
  buildSummary,
  isCumulativeSeriesKey
} from '../fitnessSessionSummary.mjs';
import { parseArgs, bool } from './argv.mjs';
import { CliError, isValidDate, isValidSessionId, fitnessHistoryDir } from './context.mjs';

// ---------------------------------------------------------------------------
// Timestamp helpers
// ---------------------------------------------------------------------------

/**
 * Format a unix-ms timestamp in the given IANA timezone as
 *   'YYYY-MM-DD HH:MM:SS.fff'
 */
function formatTimestampInTz(ms, tz) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date(ms)).map(p => [p.type, p.value])
  );
  // Intl en-CA gives '24' for midnight in some node versions; normalize.
  const hour = parts.hour === '24' ? '00' : parts.hour;
  const millis = String(((ms % 1000) + 1000) % 1000).padStart(3, '0');
  return `${parts.year}-${parts.month}-${parts.day} ${hour}:${parts.minute}:${parts.second}.${millis}`;
}

/**
 * Parse a 'YYYY-MM-DD HH:MM:SS.fff' wall-clock string in the given IANA tz
 * back to unix ms. Used to read session.start/end out of the input YAMLs.
 */
function parseWallClockInTz(wallClock, tz) {
  // wallClock: '2026-04-28 12:28:15.752'
  const m = String(wallClock).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!m) throw new Error(`Cannot parse wall-clock timestamp: ${wallClock}`);
  const [, Y, M, D, h, mn, s, ms] = m;
  const millis = ms ? Number(ms.padEnd(3, '0')) : 0;

  // Compute the offset for that wall-clock time in the target tz by formatting
  // a candidate UTC timestamp and seeing how far off it is. One-pass works
  // because we just need the right (DST-correct) offset.
  const guess = Date.UTC(+Y, +M - 1, +D, +h, +mn, +s, millis);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date(guess)).map(p => [p.type, p.value])
  );
  const seenY = +parts.year, seenM = +parts.month, seenD = +parts.day;
  const seenh = parts.hour === '24' ? 0 : +parts.hour;
  const seenmn = +parts.minute, seens = +parts.second;
  const seenAsUtc = Date.UTC(seenY, seenM - 1, seenD, seenh, seenmn, seens, millis);
  const offset = seenAsUtc - guess;
  return guess - offset;
}

// ---------------------------------------------------------------------------
// Cumulative-series rebasing
// ---------------------------------------------------------------------------

/**
 * For each cumulative series key present anywhere in `priorSessions`, sum
 * each session's terminal (last non-null) value. Returns a map of key -> total.
 *
 * Cumulative series count up monotonically within a session and reset to 0
 * across sessions. When merging, naively concatenating leaves the merged
 * series ending at the LAST session's terminal value (not the sum), so each
 * later session must be offset by the running total carried over.
 */
function cumulativeOffsets(priorSessions) {
  const offsets = {};
  for (const s of priorSessions) {
    for (const [key, arr] of Object.entries(s.timeline.series)) {
      if (!isCumulativeSeriesKey(key)) continue;
      const last = getLastNonNull(arr);
      offsets[key] = (offsets[key] || 0) + last;
    }
  }
  return offsets;
}

/**
 * Apply the offsets-map to a session's timeline series. Keys not present in
 * the map are left untouched; keys in the map but absent from this session's
 * series are skipped (nothing to rebase).
 */
function applyOffsets(series, offsets) {
  if (!offsets || Object.keys(offsets).length === 0) return series;
  const out = { ...series };
  for (const [key, offset] of Object.entries(offsets)) {
    if (!offset) continue;
    if (Array.isArray(out[key])) {
      out[key] = out[key].map(v => (v == null ? null : v + offset));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// mergeSessions()
// ---------------------------------------------------------------------------

/**
 * Merge the given session ids on `date` into one file.
 *
 * @param {string} date - YYYY-MM-DD
 * @param {string[]} sessionIds - two or more 14-digit session ids
 * @param {Object} [opts]
 * @param {string} [opts.baseDir] - data-dir root override
 * @param {boolean} [opts.dryRun=false] - compute and report without writing
 *   or deleting anything
 * @returns {Promise<{outFile: string, out: Object, sessions: Array, deleted: string[]}>}
 */
export async function mergeSessions(date, sessionIds, { baseDir, dryRun = false } = {}) {
  const resolvedBase = baseDir || process.env.DAYLIGHT_BASE_PATH || process.cwd();
  const dir = path.join(fitnessHistoryDir(path.join(resolvedBase, 'data')), date);

  const loadSession = async (id) => {
    const file = path.join(dir, `${id}.yml`);
    let raw;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (e) {
      throw new CliError(`Cannot read ${file}: ${e.message}`);
    }
    const obj = yaml.load(raw);
    if (!obj || typeof obj !== 'object') {
      throw new CliError(`Cannot parse YAML at ${file}`);
    }
    if (obj.finalized === true) {
      throw new CliError(`Refusing to merge: ${id} has finalized: true`);
    }
    const tz = obj.timezone || 'UTC';
    const intervalSeconds = obj.timeline?.interval_seconds || 5;
    return {
      id,
      file,
      obj,
      tz,
      startMs: parseWallClockInTz(obj.session.start, tz),
      endMs: parseWallClockInTz(obj.session.end, tz),
      intervalSeconds,
      timeline: {
        series: decodeSeries(obj.timeline?.series || {}),
        events: Array.isArray(obj.timeline?.events) ? obj.timeline.events : [],
        interval_seconds: intervalSeconds,
        tick_count: obj.timeline?.tick_count || 0
      }
    };
  };

  const sessions = [];
  for (const id of sessionIds) sessions.push(await loadSession(id));

  // Sort by start time ascending
  sessions.sort((a, b) => a.startMs - b.startMs);

  // --- Pairwise merge timelines ---
  let merged = sessions[0].timeline;
  let runningEndMs = sessions[0].endMs;
  const intervalMs = (merged.interval_seconds || 5) * 1000;

  for (let i = 1; i < sessions.length; i++) {
    const offsets = cumulativeOffsets(sessions.slice(0, i));
    const rebasedSeries = applyOffsets(sessions[i].timeline.series, offsets);
    const next = { ...sessions[i].timeline, series: rebasedSeries };
    const gapTicks = Math.max(0, Math.floor((sessions[i].startMs - runningEndMs) / intervalMs));
    merged = mergeTimelines(merged, next, gapTicks);
    runningEndMs = sessions[i].endMs;
  }

  const earliest = sessions[0];
  const latest = sessions[sessions.length - 1];
  const targetId = latest.id;
  const tz = earliest.tz;

  const sessionStartMs = earliest.startMs;
  const sessionEndMs = latest.endMs;
  const durationSeconds = Math.round((sessionEndMs - sessionStartMs) / 1000);

  // --- Merge participants (latest wins on conflict) ---
  const mergedParticipants = {};
  for (const s of sessions) {
    for (const [slug, p] of Object.entries(s.obj.participants || {})) {
      mergedParticipants[slug] = { ...(mergedParticipants[slug] || {}), ...p };
    }
  }

  // --- Merge treasureBox ---
  const mergedTreasureBox = {
    coinTimeUnitMs: latest.obj.treasureBox?.coinTimeUnitMs ?? 5000,
    totalCoins: 0,
    buckets: { blue: 0, green: 0, yellow: 0, orange: 0, red: 0 }
  };
  for (const s of sessions) {
    const tb = s.obj.treasureBox || {};
    mergedTreasureBox.totalCoins += tb.totalCoins || 0;
    for (const k of Object.keys(mergedTreasureBox.buckets)) {
      mergedTreasureBox.buckets[k] += (tb.buckets?.[k] || 0);
    }
  }

  // --- Recompute summary ---
  const summary = buildSummary({
    participants: mergedParticipants,
    series: merged.series,
    events: merged.events,
    treasureBox: mergedTreasureBox,
    intervalSeconds: merged.interval_seconds
  });

  // --- Build final output object (v3) ---
  const out = {
    version: 3,
    sessionId: String(targetId),
    session: {
      id: String(targetId),
      date,
      start: formatTimestampInTz(sessionStartMs, tz),
      end: formatTimestampInTz(sessionEndMs, tz),
      duration_seconds: durationSeconds
    },
    timezone: tz,
    participants: mergedParticipants,
    timeline: {
      series: encodeSeries(merged.series),
      events: merged.events,
      interval_seconds: merged.interval_seconds,
      tick_count: merged.tick_count,
      encoding: 'rle'
    },
    treasureBox: mergedTreasureBox,
    summary
  };

  // Carry over strava / strava_notes (latest wins, fall back to any source)
  for (const key of ['strava', 'strava_notes']) {
    let value = latest.obj[key];
    if (value == null) {
      for (let i = sessions.length - 2; i >= 0; i--) {
        if (sessions[i].obj[key] != null) { value = sessions[i].obj[key]; break; }
      }
    }
    if (value != null) out[key] = value;
  }

  // Carry entities (concatenate)
  const entities = [];
  for (const s of sessions) {
    if (Array.isArray(s.obj.entities)) entities.push(...s.obj.entities);
  }
  if (entities.length) out.entities = entities;

  // Carry metadata (latest wins)
  const metadata = {};
  let anyMeta = false;
  for (const s of sessions) {
    if (s.obj.metadata && typeof s.obj.metadata === 'object') {
      Object.assign(metadata, s.obj.metadata);
      anyMeta = true;
    }
  }
  if (anyMeta) out.metadata = metadata;

  // --- Write merged file, then delete sources ---
  const outFile = path.join(dir, `${targetId}.yml`);
  const sourcesToDelete = sessions.filter(s => s.id !== targetId);

  if (!dryRun) {
    await fs.writeFile(outFile, yaml.dump(out, { lineWidth: -1, noRefs: true }), 'utf8');
    for (const s of sourcesToDelete) await fs.unlink(s.file);
  }

  return { outFile, out, sessions, deleted: sourcesToDelete.map(s => s.file) };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export const spec = {
  name: 'merge',
  summary: 'combine same-day session fragments into one session file',
  usage: 'fitness session merge <date> <sessionId1> <sessionId2> [...]',
  details: `  --dry-run   Report the merge result without writing or deleting

  Writes the merged session to <date>/<latest sessionId>.yml and DELETES the
  other source files. Refuses to merge a session marked finalized: true.`,
};

/**
 * @param {string[]} argv
 * @param {Object} ctx
 * @returns {Promise<Object>}
 */
export async function run(argv, ctx) {
  const { positional, flags } = parseArgs(argv, { booleanFlags: ['dry-run'] });
  const dryRun = bool(flags, 'dry-run');

  if (positional.length < 3) {
    throw new CliError(`Usage: ${spec.usage}`);
  }

  const date = positional[0];
  const sessionIds = positional.slice(1);

  if (!isValidDate(date)) {
    throw new CliError(`<date> must be YYYY-MM-DD, got: ${date}`);
  }
  for (const id of sessionIds) {
    if (!isValidSessionId(id)) {
      throw new CliError(`session id must be 14 digits, got: ${id}`);
    }
  }

  const result = await mergeSessions(date, sessionIds, { baseDir: ctx.baseDir, dryRun });
  const { outFile, out, sessions, deleted } = result;
  const summary = out.summary;

  console.log(`=== Merge ${dryRun ? 'DRY RUN' : 'complete'} ===`);
  console.log(`Date:       ${date}`);
  console.log(`Timezone:   ${out.timezone}`);
  console.log(`Inputs (${sessions.length}, sorted by start):`);
  for (const s of sessions) {
    const coins = s.obj.summary?.coins?.total ?? s.obj.treasureBox?.totalCoins ?? 0;
    console.log(`  - ${s.id}  start=${s.obj.session.start}  end=${s.obj.session.end}  duration=${s.obj.session.duration_seconds}s  coins=${coins}`);
  }
  console.log(`Output:     ${outFile}`);
  console.log(`  start=${out.session.start}`);
  console.log(`  end=${out.session.end}`);
  console.log(`  duration_seconds=${out.session.duration_seconds}`);
  console.log(`  tick_count=${out.timeline.tick_count}`);
  console.log(`  summary.coins.total=${summary.coins.total}`);
  for (const [slug, p] of Object.entries(summary.participants)) {
    console.log(`  summary.participants.${slug}.coins=${p.coins}  hr_avg=${p.hr_avg}  hr_min=${p.hr_min}  hr_max=${p.hr_max}  zones=${JSON.stringify(p.zone_minutes)}`);
  }
  console.log(`${dryRun ? 'Would delete' : 'Deleted'} source files (${deleted.length}):`);
  for (const f of deleted) console.log(`  - ${f}`);
  if (dryRun) console.log('DRY RUN — nothing written or deleted.');

  return result;
}
