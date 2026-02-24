#!/usr/bin/env node
/**
 * Reconstruct missing fitness sessions from Strava + media memory data.
 *
 * The PersistenceManager validation bug (checked `:hr` but series used
 * `:heart_rate`) silently rejected all sessions from Feb 15-23 2026.
 * This script rebuilds session files using:
 *   - Strava activity data (timestamps, duration, HR series)
 *   - Media memory (14_fitness.yml) for media played during each session
 *
 * Usage:
 *   node cli/scripts/reconstruct-missing-sessions.mjs \
 *     <strava-dir> <media-yml> <sessions-dir> [--dry-run]
 *
 * Example:
 *   node cli/scripts/reconstruct-missing-sessions.mjs \
 *     /path/to/lifelog/strava/ \
 *     /path/to/media_memory/plex/14_fitness.yml \
 *     /path/to/history/fitness/ \
 *     --dry-run
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const STRAVA_DIR = process.argv[2];
const MEDIA_PATH = process.argv[3];
const SESSIONS_DIR = process.argv[4];
const DRY_RUN = process.argv.includes('--dry-run');

if (!STRAVA_DIR || !MEDIA_PATH || !SESSIONS_DIR) {
  console.error('Usage: node reconstruct-missing-sessions.mjs <strava-dir> <media-yml> <sessions-dir> [--dry-run]');
  process.exit(1);
}

// Zone thresholds for kckern (from config)
const ZONE_THRESHOLDS = { cool: 0, active: 110, warm: 130, hot: 150, fire: 170 };

function getZoneId(hr) {
  if (hr >= ZONE_THRESHOLDS.fire) return 4;
  if (hr >= ZONE_THRESHOLDS.hot) return 3;
  if (hr >= ZONE_THRESHOLDS.warm) return 2;
  if (hr >= ZONE_THRESHOLDS.active) return 1;
  return 0;
}

function getZoneChar(hr) {
  if (hr >= ZONE_THRESHOLDS.fire) return 'f';
  if (hr >= ZONE_THRESHOLDS.hot) return 'h';
  if (hr >= ZONE_THRESHOLDS.warm) return 'w';
  if (hr >= ZONE_THRESHOLDS.active) return 'a';
  return 'c';
}

/** RLE-encode an array: [v,v,v] → [[v,3]] */
function rleEncode(arr) {
  if (!arr || arr.length === 0) return '[]';
  const result = [];
  let i = 0;
  while (i < arr.length) {
    const val = arr[i];
    let count = 1;
    while (i + count < arr.length && arr[i + count] === val) count++;
    if (count > 1) {
      result.push(JSON.stringify([val, count]));
    } else {
      result.push(JSON.stringify(val));
    }
    i += count;
  }
  return `'[${result.join(',')}]'`;
}

// ── Step 1: Load media memory ──

const mediaContent = fs.readFileSync(MEDIA_PATH, 'utf8');
const mediaData = yaml.load(mediaContent) || {};

// Index: "YYYY-MM-DD" → [{ id, lastPlayedMs }]
const mediaByDate = new Map();
for (const [id, entry] of Object.entries(mediaData)) {
  if (!entry?.lastPlayed) continue;
  const lp = entry.lastPlayed;
  const date = typeof lp === 'string' ? lp.slice(0, 10) : '';
  if (!date) continue;
  const lpMs = new Date(lp).getTime();
  if (!Number.isFinite(lpMs)) continue;
  if (!mediaByDate.has(date)) mediaByDate.set(date, []);
  mediaByDate.get(date).push({ id, lastPlayedMs: lpMs });
}
console.log(`Loaded ${Object.keys(mediaData).length} media entries across ${mediaByDate.size} dates.\n`);

// ── Step 2: Find existing session dates ──

const existingDates = new Set();
try {
  for (const d of fs.readdirSync(SESSIONS_DIR)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) existingDates.add(d);
  }
} catch {}

// ── Step 3: Scan Strava files for fitness activities ──

const FITNESS_TYPES = new Set(['Workout', 'WeightTraining', 'Yoga', 'Crossfit']);
const WINDOW_AFTER_END_MS = 2 * 60 * 60 * 1000;

const stravaFiles = fs.readdirSync(STRAVA_DIR)
  .filter(f => f.endsWith('.yml'))
  .sort();

const reconstructed = [];

for (const file of stravaFiles) {
  const strava = yaml.load(fs.readFileSync(path.join(STRAVA_DIR, file), 'utf8'));
  if (!strava?.data) continue;

  const activityType = strava.type || strava.data.type;
  if (!FITNESS_TYPES.has(activityType)) continue;

  const date = strava.date;
  if (!date) continue;

  // Only process dates that DON'T already have a session
  if (existingDates.has(date)) continue;

  // Only process dates >= 2026-02-15 (bug window)
  if (date < '2026-02-15') continue;

  const d = strava.data;
  const startLocal = d.start_date_local; // ISO format but actually local time with Z
  if (!startLocal) continue;

  const elapsedSeconds = d.elapsed_time || d.moving_time || 0;
  if (elapsedSeconds < 60) continue;

  // Parse start time — strip trailing Z since Strava's start_date_local is local time
  const localTimeStr = startLocal.replace(/Z$/, '');
  const startDate = new Date(localTimeStr);
  const startMs = startDate.getTime();
  const endMs = startMs + elapsedSeconds * 1000;

  // Derive session ID from local start time (YYYYMMDDHHmmss)
  const pad = (n) => String(n).padStart(2, '0');
  const sessionId = `${startDate.getFullYear()}${pad(startDate.getMonth() + 1)}${pad(startDate.getDate())}${pad(startDate.getHours())}${pad(startDate.getMinutes())}${pad(startDate.getSeconds())}`;

  // Format timestamps like existing sessions
  const startReadable = `${date} ${pad(startDate.getHours())}:${pad(startDate.getMinutes())}:${pad(startDate.getSeconds())}.000`;
  const endDate = new Date(endMs);
  const endDateStr = `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(endDate.getDate())}`;
  const endReadable = `${endDateStr} ${pad(endDate.getHours())}:${pad(endDate.getMinutes())}:${pad(endDate.getSeconds())}.000`;

  // Get HR data from Strava (per-second)
  const hrRaw = d.heartRateOverTime || [];
  const hasHr = hrRaw.length > 0 && d.has_heartrate;

  // Downsample HR to 5s intervals (matching session tick interval)
  const TICK_INTERVAL = 5;
  const hrSeries = [];
  const zoneSeries = [];
  const coinsSeries = [];

  if (hasHr) {
    let coins = 0;
    for (let t = 0; t < elapsedSeconds; t += TICK_INTERVAL) {
      // Average HR over this 5s window
      const windowStart = t;
      const windowEnd = Math.min(t + TICK_INTERVAL, hrRaw.length);
      let sum = 0, count = 0;
      for (let s = windowStart; s < windowEnd && s < hrRaw.length; s++) {
        if (hrRaw[s] > 0) { sum += hrRaw[s]; count++; }
      }
      const hr = count > 0 ? Math.round(sum / count) : 0;
      const zoneId = getZoneId(hr);

      // Coin formula: zone-based accumulation per tick
      const coinRate = [0, 1, 2, 3, 4][zoneId] || 0;
      coins += coinRate;

      hrSeries.push(hr);
      zoneSeries.push(getZoneChar(hr));
      coinsSeries.push(coins);
    }
  }

  const tickCount = hrSeries.length;

  // Calculate zone minutes
  const zoneMinutes = { cool: 0, active: 0, warm: 0, hot: 0 };
  if (hasHr) {
    for (const hr of hrSeries) {
      const zone = getZoneChar(hr);
      const key = zone === 'c' ? 'cool' : zone === 'a' ? 'active' : zone === 'w' ? 'warm' : 'hot';
      zoneMinutes[key] += TICK_INTERVAL / 60;
    }
    // Round to 2 decimal places
    for (const k of Object.keys(zoneMinutes)) {
      zoneMinutes[k] = Math.round(zoneMinutes[k] * 100) / 100;
    }
  }

  // Match media
  const candidates = mediaByDate.get(date) || [];
  const matchedMedia = candidates
    .filter(m => m.lastPlayedMs >= startMs && m.lastPlayedMs <= endMs + WINDOW_AFTER_END_MS)
    .map(m => m.id);

  // Compute coin buckets
  const totalCoins = coinsSeries.length > 0 ? coinsSeries[coinsSeries.length - 1] : 0;
  const greenCoins = Math.round(zoneMinutes.active / (elapsedSeconds / 60) * totalCoins) || 0;
  const yellowCoins = Math.round(zoneMinutes.warm / (elapsedSeconds / 60) * totalCoins) || 0;
  const orangeCoins = Math.round(zoneMinutes.hot / (elapsedSeconds / 60) * totalCoins) || 0;

  // Build session YAML
  const hrAvg = d.average_heartrate ? Math.round(d.average_heartrate) : 0;
  const hrMax = d.max_heartrate || 0;
  const hrMin = hasHr ? Math.min(...hrSeries.filter(v => v > 0)) : 0;

  const mediaYaml = matchedMedia.length > 0
    ? matchedMedia.map(id => `    - ${id}`).join('\n')
    : '    []';

  const sessionYaml = `version: 3
sessionId: '${sessionId}'
session:
  id: '${sessionId}'
  date: '${date}'
  start: '${startReadable}'
  end: '${endReadable}'
  duration_seconds: ${elapsedSeconds}
timezone: America/Los_Angeles
participants:
  kckern:
    display_name: KC Kern
    hr_device: '40475'
    is_primary: true
    base_user: KC Kern
    strava:
      activityId: ${d.id}
      type: ${activityType}
      sufferScore: ${d.suffer_score || 0}
      deviceName: ${d.device_name || 'Garmin Forerunner 245 Music'}
timeline:
  series:
    kckern:hr: ${rleEncode(hrSeries)}
    kckern:zone: ${rleEncode(zoneSeries)}
    kckern:coins: ${rleEncode(coinsSeries)}
    global:coins: ${rleEncode(coinsSeries)}
  events: []
  interval_seconds: ${TICK_INTERVAL}
  tick_count: ${tickCount}
  encoding: rle
treasureBox:
  coinTimeUnitMs: ${TICK_INTERVAL * 1000}
  totalCoins: ${totalCoins}
  buckets:
    blue: 0
    green: ${greenCoins}
    yellow: ${yellowCoins}
    orange: ${orangeCoins}
    red: 0
summary:
  participants:
    kckern:
      coins: ${totalCoins}
      hr_avg: ${hrAvg}
      hr_max: ${hrMax}
      hr_min: ${hrMin}
      zone_minutes:
        cool: ${zoneMinutes.cool}
        active: ${zoneMinutes.active}
        warm: ${zoneMinutes.warm}
        hot: ${zoneMinutes.hot}
  media:
${mediaYaml}
  coins:
    total: ${totalCoins}
    buckets:
      blue: 0
      green: ${greenCoins}
      yellow: ${yellowCoins}
      orange: ${orangeCoins}
      red: 0
  challenges:
    total: 0
    succeeded: 0
    failed: 0
  voiceMemos: []
  reconstructed: true
  reconstructedFrom: strava
  reconstructedAt: '${new Date().toISOString()}'
`;

  const dateDir = path.join(SESSIONS_DIR, date);
  const filePath = path.join(dateDir, `${sessionId}.yml`);

  reconstructed.push({
    date,
    sessionId,
    activityType,
    elapsedSeconds,
    hrPoints: hrSeries.length,
    media: matchedMedia,
    filePath
  });

  if (!DRY_RUN) {
    fs.mkdirSync(dateDir, { recursive: true });
    fs.writeFileSync(filePath, sessionYaml);
  }
}

// ── Report ──

console.log(`=== Session Reconstruction ${DRY_RUN ? '(DRY RUN)' : ''} ===\n`);

if (reconstructed.length === 0) {
  console.log('No missing sessions found to reconstruct.');
} else {
  for (const r of reconstructed) {
    const duration = `${Math.round(r.elapsedSeconds / 60)}min`;
    console.log(`  ${r.date} | ${r.sessionId} | ${r.activityType} | ${duration} | ${r.hrPoints} HR ticks | media: ${r.media.join(', ') || 'none'}`);
  }
  console.log(`\nReconstructed: ${reconstructed.length} sessions`);
}

if (DRY_RUN) {
  console.log('\nDry run — no files written. Remove --dry-run to apply.');
}
