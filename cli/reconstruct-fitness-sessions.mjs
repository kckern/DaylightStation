#!/usr/bin/env node

/**
 * Reconstruct Fitness Sessions from Strava Archives
 *
 * Creates v3 fitness session files for unmatched Strava entries that have
 * heart-rate data in their archives. Resamples per-second HR to 5s intervals,
 * derives zones, calculates coins, matches media from Tautulli + fitness memory,
 * and writes complete session files.
 *
 * Dry-run by default. Pass --write to persist files.
 *
 * Usage:
 *   node cli/reconstruct-fitness-sessions.mjs [--write] [daysBack]
 *
 * Examples:
 *   node cli/reconstruct-fitness-sessions.mjs            # dry-run, back to Jan 2024
 *   node cli/reconstruct-fitness-sessions.mjs --write     # write mode
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
// Default: back to Jan 2024
const defaultDays = Math.ceil(moment().diff(moment('2024-01-01'), 'days'));
const daysBack = parseInt(numericArg || String(defaultDays), 10);
const username = 'kckern';
const TIMEZONE = 'America/Los_Angeles';

console.log(`Reconstruct fitness sessions for ${username}, ${daysBack} days back`);
console.log(`Mode: ${writeMode ? 'WRITE' : 'DRY-RUN'}\n`);

// ------------------------------------------------------------------
// Zone configuration (from fitness.yml)
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
// Tautulli: fetch fitness library play history
// ------------------------------------------------------------------
const TAUTULLI_URL = 'https://tautulli.kckern.net/api/v2';
const TAUTULLI_KEY = 'I6vmpzwRpmVGh4kRkHmX6r19vS-cl_P8';
const TAUTULLI_SECTION = 14;

async function fetchTautulliPlays() {
  try {
    const url = `${TAUTULLI_URL}?apikey=${TAUTULLI_KEY}&cmd=get_history&section_id=${TAUTULLI_SECTION}&length=10000&order_column=date&order_dir=asc`;
    const resp = await fetch(url);
    const json = await resp.json();
    if (json.response?.result !== 'success') {
      console.warn('Tautulli API error:', json.response?.message);
      return [];
    }
    const plays = json.response.data.data || [];
    console.log(`Tautulli: loaded ${plays.length} fitness plays (${plays.length > 0 ? moment.unix(plays[0].started).format('YYYY-MM-DD') : 'none'} to ${plays.length > 0 ? moment.unix(plays[plays.length - 1].started).format('YYYY-MM-DD') : 'none'})`);
    return plays;
  } catch (err) {
    console.warn('Tautulli fetch failed:', err.message);
    return [];
  }
}

// ------------------------------------------------------------------
// Helper: get zone for a heart rate value
// ------------------------------------------------------------------
function getZone(hr) {
  for (let i = ZONES.length - 1; i >= 0; i--) {
    if (hr >= ZONES[i].min) return ZONES[i];
  }
  return ZONES[0];
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
    const rounded = Math.round(minutes * 100) / 100;
    if (rounded > 0) result[name] = rounded;
  }
  return result;
}

// ------------------------------------------------------------------
// Helper: compute treasure box buckets from zone shortcodes
// ------------------------------------------------------------------
function computeBuckets(zoneSeries) {
  const bucketMap = { blue: 0, green: 0, yellow: 0, orange: 0, red: 0 };
  for (const z of zoneSeries) {
    if (z == null) continue;
    const zoneDef = ZONES.find(zd => zd.short === z);
    if (!zoneDef || zoneDef.coins === 0) continue;
    bucketMap[zoneDef.color] += zoneDef.coins;
  }
  return bucketMap;
}

// ------------------------------------------------------------------
// Helper: find archive file for a strava entry
// Searches: lifelog/strava/ (3-part DATE_TYPE_ID) then
//           media/archives/strava/ (3-part and legacy 2-part DATE_ID)
// ------------------------------------------------------------------
function findArchive(date, type, id) {
  // 1. New format in lifelog/strava/: DATE_TYPE_ID.yml
  const newName = `${date}_${type}_${id}`;
  const newPath = path.join(stravaArchiveDir, newName);
  const newData = loadYamlSafe(newPath);
  if (newData) return { archive: newData, archivePath: newPath };

  // 2. New format in media/archives/strava/: DATE_TYPE_ID.yml
  const archiveNewPath = path.join(olderArchiveDir, newName);
  const archiveNewData = loadYamlSafe(archiveNewPath);
  if (archiveNewData) return { archive: archiveNewData, archivePath: archiveNewPath };

  // 3. Legacy format in media/archives/strava/: DATE_ID.yml
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
  const m = moment.tz(`${date} ${startTimeStr}`, 'YYYY-MM-DD hh:mm a', TIMEZONE);
  if (m.isValid()) return m;

  if (archive?.data?.start_date_local) {
    const local = archive.data.start_date_local.replace('Z', '');
    const fallback = moment.tz(local, TIMEZONE);
    if (fallback.isValid()) return fallback;
  }

  return null;
}

// ------------------------------------------------------------------
// Media matching: Tautulli (by time overlap) + 14_fitness.yml (by lastPlayed)
// Tautulli provides titles; 14_fitness.yml catches content not in Tautulli.
// De-duplicates by rating_key/mediaId.
// ------------------------------------------------------------------
function findMediaForWindow(tautulliPlays, mediaMemory, startMs, endMs, bufferMs = 5 * 60 * 1000) {
  const windowStartS = Math.floor((startMs - bufferMs) / 1000);
  const windowEndS = Math.ceil((endMs + bufferMs) / 1000);
  const windowStartMs = startMs - bufferMs;
  const windowEndMs = endMs + bufferMs;

  const seen = new Set();
  const matches = [];

  // 1. Tautulli: has started/stopped unix seconds, rating_key, full_title
  for (const play of tautulliPlays) {
    if (play.started <= windowEndS && play.stopped >= windowStartS) {
      const key = String(play.rating_key);
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({
        source: 'plex',
        mediaId: key,
        title: play.full_title || play.title || null,
        duration: play.duration || 0,
        startedMs: play.started * 1000,
      });
    }
  }

  // 2. 14_fitness.yml: lastPlayed timestamp, keyed by plex:MEDIAID
  if (mediaMemory) {
    for (const [memKey, entry] of Object.entries(mediaMemory)) {
      if (!entry.lastPlayed) continue;
      const playedMoment = moment.tz(entry.lastPlayed, 'YYYY-MM-DD HH:mm:ss', TIMEZONE);
      if (!playedMoment.isValid()) continue;
      const playedMs = playedMoment.valueOf();
      if (playedMs >= windowStartMs && playedMs <= windowEndMs) {
        const mediaId = memKey.replace('plex:', '');
        if (seen.has(mediaId)) continue;
        seen.add(mediaId);
        matches.push({
          source: 'plex',
          mediaId,
          title: null, // 14_fitness.yml has no titles
          duration: entry.duration || 0,
          startedMs: playedMs,
        });
      }
    }
  }

  return matches;
}

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------
const tautulliPlays = await fetchTautulliPlays();

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

entries.sort((a, b) => a.date.localeCompare(b.date));

let summaryModified = false;

for (const { date, entry } of entries) {
  processed++;

  // Skip already matched
  if (entry.homeSessionId) {
    skipped++;
    continue;
  }

  // Find archive with HR data
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

  // Find matching media (Tautulli + 14_fitness.yml)
  const startMs = sessionIdMoment.valueOf();
  const endMs = endMoment.valueOf();
  const mediaMatches = findMediaForWindow(tautulliPlays, mediaMemory, startMs, endMs);

  // Build timeline events for media
  const timelineEvents = mediaMatches.map(m => ({
    timestamp: m.startedMs,
    offsetMs: Math.max(0, m.startedMs - startMs),
    type: 'media_start',
    data: {
      source: m.source,
      mediaId: m.mediaId,
      plexId: m.mediaId,
      title: m.title,
      durationSeconds: m.duration,
    },
  }));

  // Build media summary
  const mediaTitles = mediaMatches.map(m => m.title).filter(Boolean);
  const mediaSummary = mediaMatches.map(m => m.title || `plex:${m.mediaId}`);

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

  const mediaLabel = mediaMatches.length > 0
    ? `${mediaMatches.length} media (${mediaTitles.join(', ') || 'untitled'})`
    : 'no media';
  const label = `${date} ${entry.type} (${entry.title}) -> ${sessionId} | ${mediaLabel} | ${totalCoins} coins`;

  if (writeMode) {
    saveYaml(sessionFilePath, sessionFile);

    entry.homeSessionId = sessionId;
    entry.homeCoins = totalCoins;
    if (mediaTitles.length > 0) entry.homeMedia = mediaTitles.join(', ');
    summaryModified = true;

    if (archive?.data && archivePath) {
      archive.data.homeSessionId = sessionId;
      archive.data.homeCoins = totalCoins;
      if (mediaTitles.length > 0) archive.data.homeMedia = mediaTitles.join(', ');
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
