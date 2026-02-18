#!/usr/bin/env node

/**
 * Reconstruct Fitness Sessions from Strava Archives
 *
 * Creates v3 fitness session files for unmatched Strava entries that have
 * heart-rate data in their archives. Resamples per-second HR to 5s intervals,
 * derives zones, calculates coins, matches media from fitness memory, and
 * writes complete session files.
 *
 * Dry-run by default. Pass --write to persist files.
 *
 * Usage:
 *   node cli/reconstruct-fitness-sessions.mjs [--write] [daysBack]
 *
 * Examples:
 *   node cli/reconstruct-fitness-sessions.mjs            # dry-run, 365 days
 *   node cli/reconstruct-fitness-sessions.mjs --write     # write mode, 365 days
 *   node cli/reconstruct-fitness-sessions.mjs --write 90  # write mode, 90 days
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { existsSync } from 'fs';
import moment from 'moment-timezone';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

dotenv.config({ path: path.join(projectRoot, '.env') });

const isDocker = existsSync('/.dockerenv');
const baseDir = isDocker ? '/usr/src/app' : process.env.DAYLIGHT_BASE_PATH;
const dataDir = path.join(baseDir, 'data');
const configDir = path.join(dataDir, 'system', 'config');

// Bootstrap config
const { hydrateProcessEnvFromConfigs } = await import('#system/logging/config.mjs');
const { initConfigService, configService } = await import('#system/config/index.mjs');
const { loadYamlSafe, saveYaml, fileExists } = await import('#system/utils/FileIO.mjs');
const { encodeSingleSeries } = await import('#domains/fitness/services/TimelineService.mjs');

hydrateProcessEnvFromConfigs(configDir);
initConfigService(dataDir);

// ------------------------------------------------------------------
// Parse CLI args
// ------------------------------------------------------------------
const args = process.argv.slice(2);
const writeMode = args.includes('--write');
const numericArg = args.find(a => /^\d+$/.test(a));
const daysBack = parseInt(numericArg || '365', 10);
const username = 'kckern';
const TIMEZONE = 'America/Los_Angeles';

console.log(`Reconstruct fitness sessions for ${username}, ${daysBack} days back`);
console.log(`Mode: ${writeMode ? 'WRITE' : 'DRY-RUN'}\n`);

// ------------------------------------------------------------------
// Zone configuration
// ------------------------------------------------------------------
const ZONES = [
  { name: 'cool',   short: 'c',    min: 0,   color: 'blue',   coins: 0 },
  { name: 'active', short: 'a',    min: 100, color: 'green',  coins: 1 },
  { name: 'warm',   short: 'w',    min: 120, color: 'yellow', coins: 2 },
  { name: 'hot',    short: 'h',    min: 140, color: 'orange', coins: 3 },
  { name: 'fire',   short: 'fire', min: 160, color: 'red',    coins: 5 },
];

const INTERVAL_SECONDS = 5;
const COIN_TIME_UNIT_MS = 5000;

// ------------------------------------------------------------------
// Paths
// ------------------------------------------------------------------
const stravaSummaryPath = path.join(dataDir, 'users', username, 'lifelog', 'strava');
const stravaArchiveDir = path.join(dataDir, 'users', username, 'lifelog', 'strava');
const olderArchiveDir = path.join(baseDir, 'media', 'archives', 'strava');
const mediaMemoryPath = path.join(dataDir, 'household', 'history', 'media_memory', 'plex', '14_fitness');
const fitnessHistoryDir = path.join(dataDir, 'household', 'history', 'fitness');

// ------------------------------------------------------------------
// Helper: get zone for a heart rate value
// ------------------------------------------------------------------
function getZone(hr) {
  // Walk the zones in reverse to find the highest matching zone
  for (let i = ZONES.length - 1; i >= 0; i--) {
    if (hr >= ZONES[i].min) return ZONES[i];
  }
  return ZONES[0]; // cool fallback
}

// ------------------------------------------------------------------
// Helper: resample per-second HR array to 5s intervals (point sampling)
// ------------------------------------------------------------------
function resampleHR(hrPerSecond) {
  const result = [];
  for (let i = 0; i < hrPerSecond.length; i += INTERVAL_SECONDS) {
    result.push(hrPerSecond[i]);
  }
  return result;
}

// ------------------------------------------------------------------
// Helper: derive zone shortcodes from HR array (already at 5s intervals)
// ------------------------------------------------------------------
function deriveZones(hrSamples) {
  return hrSamples.map(hr => {
    if (hr == null) return null;
    return getZone(hr).short;
  });
}

// ------------------------------------------------------------------
// Helper: derive cumulative coins from HR array (already at 5s intervals)
// ------------------------------------------------------------------
function deriveCoins(hrSamples) {
  const coins = [];
  let cumulative = 0;
  for (const hr of hrSamples) {
    if (hr == null) {
      coins.push(cumulative);
      continue;
    }
    const zone = getZone(hr);
    cumulative += zone.coins;
    coins.push(cumulative);
  }
  return coins;
}

// ------------------------------------------------------------------
// Helper: compute zone_minutes from zone shortcodes
// ------------------------------------------------------------------
function computeZoneMinutes(zoneSeries) {
  const tickCounts = {};
  for (const z of zoneSeries) {
    if (z == null) continue;
    const zoneDef = ZONES.find(zd => zd.short === z);
    if (!zoneDef) continue;
    tickCounts[zoneDef.name] = (tickCounts[zoneDef.name] || 0) + 1;
  }
  const result = {};
  for (const [name, count] of Object.entries(tickCounts)) {
    const minutes = (count * INTERVAL_SECONDS) / 60;
    // Round to 2 decimal places, omit if 0
    const rounded = Math.round(minutes * 100) / 100;
    if (rounded > 0) result[name] = rounded;
  }
  return result;
}

// ------------------------------------------------------------------
// Helper: compute treasure box buckets from zone shortcodes and coins
// ------------------------------------------------------------------
function computeBuckets(zoneSeries) {
  const bucketMap = { blue: 0, green: 0, yellow: 0, orange: 0, red: 0 };
  for (let i = 0; i < zoneSeries.length; i++) {
    const z = zoneSeries[i];
    if (z == null) continue;
    const zoneDef = ZONES.find(zd => zd.short === z);
    if (!zoneDef || zoneDef.coins === 0) continue;
    bucketMap[zoneDef.color] += zoneDef.coins;
  }
  return bucketMap;
}

// ------------------------------------------------------------------
// Helper: find archive file for a strava entry
// Returns { data, archivePath } or null
// ------------------------------------------------------------------
function findArchive(date, type, id) {
  // Try new format: DATE_TYPE_ID.yml in lifelog/strava/
  const newName = `${date}_${type}_${id}`;
  const newPath = path.join(stravaArchiveDir, newName);
  const newData = loadYamlSafe(newPath);
  if (newData) return { archive: newData, archivePath: newPath };

  // Try old format: DATE_ID.yml in media/archives/strava/
  const oldName = `${date}_${id}`;
  const oldPath = path.join(olderArchiveDir, oldName);
  const oldData = loadYamlSafe(oldPath);
  if (oldData) return { archive: oldData, archivePath: oldPath };

  return null;
}

// ------------------------------------------------------------------
// Helper: parse start time from archive or summary
// ------------------------------------------------------------------
function parseStartTime(date, startTimeStr, archive) {
  // Use the summary's startTime field: "06:25 am" format
  const m = moment.tz(`${date} ${startTimeStr}`, 'YYYY-MM-DD hh:mm a', TIMEZONE);
  if (m.isValid()) return m;

  // Fallback: use archive start_date_local (strip the misleading Z)
  if (archive?.data?.start_date_local) {
    const local = archive.data.start_date_local.replace('Z', '');
    const fallback = moment.tz(local, TIMEZONE);
    if (fallback.isValid()) return fallback;
  }

  return null;
}

// ------------------------------------------------------------------
// Helper: match media from fitness memory to a time window
// ------------------------------------------------------------------
function findMediaForWindow(mediaMemory, startMs, endMs, bufferMs = 5 * 60 * 1000) {
  if (!mediaMemory) return [];

  const windowStart = startMs - bufferMs;
  const windowEnd = endMs + bufferMs;
  const matches = [];

  for (const [key, entry] of Object.entries(mediaMemory)) {
    if (!entry.lastPlayed) continue;

    // lastPlayed is in America/Los_Angeles timezone
    const playedMoment = moment.tz(entry.lastPlayed, 'YYYY-MM-DD HH:mm:ss', TIMEZONE);
    if (!playedMoment.isValid()) continue;

    const playedMs = playedMoment.valueOf();
    if (playedMs >= windowStart && playedMs <= windowEnd) {
      // key is like "plex:11048"
      const parts = key.split(':');
      const source = parts[0];
      const mediaId = parts[1];
      matches.push({
        source,
        mediaId,
        duration: entry.duration || 0,
        lastPlayed: entry.lastPlayed,
        lastPlayedMs: playedMs,
      });
    }
  }

  return matches;
}

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------
const summary = loadYamlSafe(stravaSummaryPath) || {};
const mediaMemory = loadYamlSafe(mediaMemoryPath) || {};

const cutoff = moment().subtract(daysBack, 'days').format('YYYY-MM-DD');

let processed = 0;
let skipped = 0;
let matched = 0;

// Collect entries to process in date order
const entries = [];
for (const [date, dateEntries] of Object.entries(summary)) {
  if (date < cutoff) continue;
  if (!Array.isArray(dateEntries)) continue;
  for (const entry of dateEntries) {
    entries.push({ date, entry });
  }
}

// Sort by date ascending
entries.sort((a, b) => a.date.localeCompare(b.date));

let summaryModified = false;

for (const { date, entry } of entries) {
  processed++;

  // Skip already matched
  if (entry.homeSessionId) {
    skipped++;
    continue;
  }

  // Find archive
  const found = findArchive(date, entry.type, entry.id);
  const archive = found?.archive;
  const archivePath = found?.archivePath;
  const hrData = archive?.data?.heartRateOverTime;

  if (!hrData || !Array.isArray(hrData) || hrData.length < 2) {
    console.log(`[SKIP]  ${date} ${entry.type} (${entry.title}) -- no HR data`);
    skipped++;
    continue;
  }

  // Parse start time
  const startMoment = parseStartTime(date, entry.startTime, archive);
  if (!startMoment) {
    console.log(`[SKIP]  ${date} ${entry.type} (${entry.title}) -- cannot parse start time`);
    skipped++;
    continue;
  }

  // Build session ID from start_date_local in archive (more precise)
  let sessionIdMoment = startMoment;
  if (archive?.data?.start_date_local) {
    const local = archive.data.start_date_local.replace('Z', '');
    const precise = moment.tz(local, TIMEZONE);
    if (precise.isValid()) sessionIdMoment = precise;
  }

  const sessionId = sessionIdMoment.format('YYYYMMDDHHmmss');
  const dateStr = sessionIdMoment.format('YYYY-MM-DD');
  const startStr = sessionIdMoment.format('YYYY-MM-DD HH:mm:ss') + '.000';

  // Compute duration from HR data length (per-second data)
  const durationSeconds = hrData.length;
  const endMoment = sessionIdMoment.clone().add(durationSeconds, 'seconds');
  const endStr = endMoment.format('YYYY-MM-DD HH:mm:ss') + '.000';

  // Check if session file already exists
  const sessionDir = path.join(fitnessHistoryDir, dateStr);
  const sessionFilePath = path.join(sessionDir, `${sessionId}.yml`);
  if (fileExists(sessionFilePath)) {
    console.log(`[SKIP]  ${date} ${entry.type} (${entry.title}) -- session file already exists: ${sessionId}`);
    skipped++;
    continue;
  }

  // Resample HR to 5s intervals
  const hrSamples = resampleHR(hrData);
  const tickCount = hrSamples.length;

  // Derive zone and coins series
  const zoneSeries = deriveZones(hrSamples);
  const coinsSeries = deriveCoins(hrSamples);
  const totalCoins = coinsSeries.length > 0 ? coinsSeries[coinsSeries.length - 1] : 0;

  // Compute stats
  const validHR = hrSamples.filter(h => h != null && h > 0);
  const hrAvg = validHR.length > 0 ? Math.round(validHR.reduce((s, h) => s + h, 0) / validHR.length) : 0;
  const hrMax = validHR.length > 0 ? Math.max(...validHR) : 0;
  const hrMin = validHR.length > 0 ? Math.min(...validHR) : 0;
  const zoneMinutes = computeZoneMinutes(zoneSeries);
  const buckets = computeBuckets(zoneSeries);

  // Find matching media
  const startMs = sessionIdMoment.valueOf();
  const endMs = endMoment.valueOf();
  const mediaMatches = findMediaForWindow(mediaMemory, startMs, endMs);

  // Build timeline events for media
  const timelineEvents = mediaMatches.map(m => ({
    timestamp: m.lastPlayedMs,
    offsetMs: 0,
    type: 'media_start',
    data: {
      source: m.source,
      mediaId: m.mediaId,
      [`${m.source}Id`]: m.mediaId,
      durationSeconds: m.duration,
    },
  }));

  // Build media summary items
  const mediaSummary = mediaMatches.map(m => `${m.source}:${m.mediaId}`);

  // Encode series to RLE JSON strings
  const hrEncoded = encodeSingleSeries(hrSamples);
  const zoneEncoded = encodeSingleSeries(zoneSeries);
  const coinsEncoded = encodeSingleSeries(coinsSeries);

  // Build the v3 session file
  const sessionFile = {
    version: 3,
    sessionId,
    session: {
      id: sessionId,
      date: dateStr,
      start: startStr,
      end: endStr,
      duration_seconds: durationSeconds,
    },
    timezone: TIMEZONE,
    participants: {
      [username]: {
        display_name: 'KC Kern',
        hr_device: '40475',
        is_primary: true,
        base_user: 'KC Kern',
        strava: {
          activityId: entry.id,
          type: entry.type,
          sufferScore: entry.suffer_score || null,
          deviceName: entry.device_name || archive?.data?.device_name || null,
        },
      },
    },
    timeline: {
      series: {
        [`${username}:hr`]: hrEncoded,
        [`${username}:zone`]: zoneEncoded,
        [`${username}:coins`]: coinsEncoded,
        'global:coins': coinsEncoded,
      },
      events: timelineEvents,
      interval_seconds: INTERVAL_SECONDS,
      tick_count: tickCount,
      encoding: 'rle',
    },
    treasureBox: {
      coinTimeUnitMs: COIN_TIME_UNIT_MS,
      totalCoins,
      buckets,
    },
    summary: {
      participants: {
        [username]: {
          coins: totalCoins,
          hr_avg: hrAvg,
          hr_max: hrMax,
          hr_min: hrMin,
          zone_minutes: zoneMinutes,
        },
      },
      media: mediaSummary,
      coins: {
        total: totalCoins,
        buckets,
      },
      challenges: {
        total: 0,
        succeeded: 0,
        failed: 0,
      },
      voiceMemos: [],
    },
  };

  const label = `${date} ${entry.type} (${entry.title}) -> ${sessionId} | ${mediaMatches.length} media | ${totalCoins} coins`;

  if (writeMode) {
    // Write session file
    saveYaml(sessionFilePath, sessionFile);

    // Enrich strava summary entry
    entry.homeSessionId = sessionId;
    entry.homeCoins = totalCoins;
    if (mediaSummary.length > 0) entry.homeMedia = mediaSummary;
    summaryModified = true;

    // Enrich strava archive
    if (archive?.data && archivePath) {
      archive.data.homeSessionId = sessionId;
      archive.data.homeCoins = totalCoins;
      if (mediaSummary.length > 0) archive.data.homeMedia = mediaSummary;
      saveYaml(archivePath, archive);
    }

    console.log(`[WRITE] ${label}`);
  } else {
    console.log(`[MATCH] ${label}`);
  }

  matched++;
}

// Save enriched summary if modified
if (writeMode && summaryModified) {
  saveYaml(stravaSummaryPath, summary);
  console.log(`\nStrava summary updated with ${matched} homeSessionId enrichments.`);
}

console.log(`\nDone! Processed ${processed} entries: ${matched} reconstructed, ${skipped} skipped.`);
