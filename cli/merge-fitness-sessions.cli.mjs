#!/usr/bin/env node
/**
 * Merge N fitness session YAML files into a single session.
 *
 * Works around two latent bugs in POST /api/v1/fitness/sessions/merge:
 *   1. Backend doesn't update the session.start/end/duration_seconds strings
 *      on the merged file (so the file claims to start later than its data).
 *   2. Backend doesn't recompute the summary block (so participant.coins,
 *      hr_min/max/avg, and zone_minutes still reflect only the target).
 *
 * This CLI does both correctly: pairwise-merges decoded timelines via
 * TimelineService.mergeTimelines (gap-filled with nulls), recomputes the
 * summary from scratch using the same logic as buildSessionSummary.js,
 * writes a single merged YAML at <date>/<latestSessionId>.yml, then
 * deletes the now-superfluous source files.
 *
 * Must run inside the daylight-station container (the host can't read the
 * data volume).
 *
 * Usage:
 *   node cli/merge-fitness-sessions.cli.mjs <date> <sessionId1> <sessionId2> [...]
 *
 * Example:
 *   node cli/merge-fitness-sessions.cli.mjs 2026-04-28 \
 *     20260428122815 20260428123501 20260428124229
 */

import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';

import {
  decodeSeries,
  encodeSeries,
  mergeTimelines
} from '#domains/fitness/services/TimelineService.mjs';

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
if (args.length < 3) {
  console.error('Usage: node cli/merge-fitness-sessions.cli.mjs <date> <sessionId1> <sessionId2> [...]');
  process.exit(1);
}

const date = args[0];
const sessionIds = args.slice(1);

if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(`ERROR: <date> must be YYYY-MM-DD, got: ${date}`);
  process.exit(1);
}
for (const id of sessionIds) {
  if (!/^\d{14}$/.test(id)) {
    console.error(`ERROR: session id must be 14 digits, got: ${id}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ZONE_MAP = { c: 'cool', a: 'active', w: 'warm', h: 'hot', fire: 'fire' };

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
  const m = wallClock.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
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
  const offset = seenAsUtc - guess; // tz offset in ms (positive east of UTC: no — see math)
  return guess - offset;
}

function getLastNonNull(arr) {
  for (let i = (arr || []).length - 1; i >= 0; i--) {
    if (arr[i] != null) return arr[i];
  }
  return 0;
}

function computeHrStats(hrSeries) {
  const valid = (hrSeries || []).filter(v => Number.isFinite(v) && v > 0);
  if (valid.length === 0) return { min: 0, max: 0, avg: 0 };
  return {
    min: Math.min(...valid),
    max: Math.max(...valid),
    avg: Math.round(valid.reduce((a, b) => a + b, 0) / valid.length)
  };
}

function computeZoneTime(zoneSeries, intervalSeconds) {
  const counts = {};
  (zoneSeries || []).forEach(z => {
    if (z == null) return;
    const name = ZONE_MAP[z] || z;
    counts[name] = (counts[name] || 0) + intervalSeconds;
  });
  return counts;
}

function findSeries(series, slug, v2Suffix, compactSuffix) {
  return series[`user:${slug}:${v2Suffix}`]
    || series[`${slug}:${compactSuffix}`]
    || [];
}

// ---------------------------------------------------------------------------
// Load all input sessions
// ---------------------------------------------------------------------------

const baseDir = process.cwd(); // /usr/src/app inside container
const dir = path.join(baseDir, 'data', 'household', 'history', 'fitness', date);

async function loadSession(id) {
  const file = path.join(dir, `${id}.yml`);
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (e) {
    throw new Error(`Cannot read ${file}: ${e.message}`);
  }
  const obj = yaml.load(raw);
  if (!obj || typeof obj !== 'object') {
    throw new Error(`Cannot parse YAML at ${file}`);
  }
  if (obj.finalized === true) {
    throw new Error(`Refusing to merge: ${id} has finalized: true`);
  }
  const tz = obj.timezone || 'UTC';
  const startMs = parseWallClockInTz(obj.session.start, tz);
  const endMs = parseWallClockInTz(obj.session.end, tz);
  const decoded = decodeSeries(obj.timeline?.series || {});
  const intervalSeconds = obj.timeline?.interval_seconds || 5;
  return {
    id,
    file,
    obj,
    tz,
    startMs,
    endMs,
    intervalSeconds,
    timeline: {
      series: decoded,
      events: Array.isArray(obj.timeline?.events) ? obj.timeline.events : [],
      interval_seconds: intervalSeconds,
      tick_count: obj.timeline?.tick_count || 0
    }
  };
}

const sessions = [];
for (const id of sessionIds) {
  sessions.push(await loadSession(id));
}

// Sort by start time ascending
sessions.sort((a, b) => a.startMs - b.startMs);

// ---------------------------------------------------------------------------
// Pairwise merge timelines
// ---------------------------------------------------------------------------

let merged = sessions[0].timeline;
let runningEndMs = sessions[0].endMs;
const intervalMs = (merged.interval_seconds || 5) * 1000;

for (let i = 1; i < sessions.length; i++) {
  const next = sessions[i].timeline;
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

// ---------------------------------------------------------------------------
// Merge participants block (latest wins on conflict)
// ---------------------------------------------------------------------------

const mergedParticipants = {};
for (const s of sessions) {
  for (const [slug, p] of Object.entries(s.obj.participants || {})) {
    mergedParticipants[slug] = { ...(mergedParticipants[slug] || {}), ...p };
  }
}

// ---------------------------------------------------------------------------
// Merge treasureBox
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Recompute summary
// ---------------------------------------------------------------------------

function buildSummary({ participants, series, events, treasureBox, intervalSeconds }) {
  const participantsSummary = {};
  for (const slug of Object.keys(participants || {})) {
    const hrSeries = findSeries(series, slug, 'heart_rate', 'hr');
    const zoneSeries = findSeries(series, slug, 'zone_id', 'zone');
    const coinsSeries = findSeries(series, slug, 'coins_total', 'coins');

    const hrStats = computeHrStats(hrSeries);
    const zoneTimeSeconds = computeZoneTime(zoneSeries, intervalSeconds);
    const zoneMinutes = {};
    for (const [zone, secs] of Object.entries(zoneTimeSeconds)) {
      zoneMinutes[zone] = Math.round((secs / 60) * 100) / 100;
    }

    participantsSummary[slug] = {
      coins: getLastNonNull(coinsSeries),
      hr_avg: hrStats.avg,
      hr_max: hrStats.max,
      hr_min: hrStats.min,
      zone_minutes: zoneMinutes
    };
  }

  // Media — dedupe by contentId, keep first occurrence by timestamp.
  const mediaEvents = (events || []).filter(e => e.type === 'media');
  const seenContentIds = new Set();
  const media = [];
  for (const e of mediaEvents) {
    const d = e.data || {};
    const contentId = d.contentId;
    if (contentId && seenContentIds.has(contentId)) continue;
    if (contentId) seenContentIds.add(contentId);
    const durationMs = (d.end != null && d.start != null) ? d.end - d.start : 0;
    const isTrack = d.contentType === 'track' || !!d.artist;
    const item = {
      contentId: d.contentId,
      title: d.title,
      mediaType: isTrack ? 'audio' : 'video',
      ...(d.artist ? { artist: d.artist } : {}),
      showTitle: d.grandparentTitle,
      seasonTitle: d.parentTitle,
      grandparentId: d.grandparentId,
      parentId: d.parentId,
      durationMs,
      ...(d.description ? { description: d.description } : {}),
      ...(Array.isArray(d.labels) && d.labels.length ? { labels: d.labels } : {})
    };
    media.push(item);
  }
  if (media.length > 0) media[0].primary = true;

  const challengeEvents = (events || []).filter(e => e.type === 'challenge');
  const succeeded = challengeEvents.filter(e => e.data?.result === 'success').length;
  const failed = challengeEvents.length - succeeded;

  const voiceMemos = (events || [])
    .filter(e => e.type === 'voice_memo')
    .map(e => ({
      transcript: e.data?.transcript || e.data?.transcriptPreview || null,
      durationSeconds: e.data?.durationSeconds ?? e.data?.duration_seconds ?? null,
      timestamp: e.timestamp
    }));

  return {
    participants: participantsSummary,
    media,
    coins: { total: treasureBox?.totalCoins ?? 0, buckets: treasureBox?.buckets ?? {} },
    challenges: { total: challengeEvents.length, succeeded, failed },
    voiceMemos
  };
}

const summary = buildSummary({
  participants: mergedParticipants,
  series: merged.series,
  events: merged.events,
  treasureBox: mergedTreasureBox,
  intervalSeconds: merged.interval_seconds
});

// ---------------------------------------------------------------------------
// Build final output object (v3)
// ---------------------------------------------------------------------------

const encodedSeries = encodeSeries(merged.series);

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
    series: encodedSeries,
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

// ---------------------------------------------------------------------------
// Write merged file, then delete sources
// ---------------------------------------------------------------------------

const outFile = path.join(dir, `${targetId}.yml`);
const yamlText = yaml.dump(out, { lineWidth: -1, noRefs: true });
await fs.writeFile(outFile, yamlText, 'utf8');

const sourcesToDelete = sessions.filter(s => s.id !== targetId);
for (const s of sourcesToDelete) {
  await fs.unlink(s.file);
}

// ---------------------------------------------------------------------------
// Print summary
// ---------------------------------------------------------------------------

console.log('=== Merge complete ===');
console.log(`Date:       ${date}`);
console.log(`Timezone:   ${tz}`);
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
console.log(`Deleted source files (${sourcesToDelete.length}):`);
for (const s of sourcesToDelete) console.log(`  - ${s.file}`);

process.exit(0);
