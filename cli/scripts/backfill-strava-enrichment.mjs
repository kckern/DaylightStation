#!/usr/bin/env node

/**
 * Backfill Strava Enrichment
 *
 * Retroactively enriches existing fitness sessions with session-level strava
 * blocks, and creates new Strava-only sessions for unmatched archives.
 *
 * Two operations:
 *  1. ENRICH: For sessions that already have participants[*].strava.activityId,
 *     adds a top-level `strava` block with summary data from the archive.
 *  2. CREATE: For Strava archives with no matching session, creates a new
 *     Strava-only session YAML (same v3 structure as the webhook handler).
 *     Skips activities with duration < 120 seconds.
 *
 * Dry-run by default. Pass --write to persist.
 *
 * Usage:
 *   node cli/scripts/backfill-strava-enrichment.mjs [--write] [daysBack]
 *
 * Examples:
 *   node cli/scripts/backfill-strava-enrichment.mjs            # dry-run, back to Jan 2024
 *   node cli/scripts/backfill-strava-enrichment.mjs --write     # write mode
 *   node cli/scripts/backfill-strava-enrichment.mjs --write 90  # write mode, 90 days
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { existsSync, readdirSync } from 'fs';
import moment from 'moment-timezone';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '../..');

dotenv.config({ path: path.join(projectRoot, '.env') });

const isDocker = existsSync('/.dockerenv');
const baseDir = isDocker ? '/usr/src/app' : process.env.DAYLIGHT_BASE_PATH;
const dataDir = path.join(baseDir, 'data');
const configDir = path.join(dataDir, 'system', 'config');

// Bootstrap config
const { hydrateProcessEnvFromConfigs } = await import('#system/logging/config.mjs');
const { initConfigService, configService } = await import('#system/config/index.mjs');
const { loadYamlSafe, saveYaml, listYamlFiles, fileExists, dirExists, listDirs } = await import('#system/utils/FileIO.mjs');

hydrateProcessEnvFromConfigs(configDir);
initConfigService(dataDir);

// ------------------------------------------------------------------
// Parse CLI args
// ------------------------------------------------------------------
const args = process.argv.slice(2);
const writeMode = args.includes('--write');
const numericArg = args.find(a => /^\d+$/.test(a));
const defaultDays = Math.ceil(moment().diff(moment('2024-01-01'), 'days'));
const daysBack = parseInt(numericArg || String(defaultDays), 10);
const username = 'kckern';
const TIMEZONE = 'America/Los_Angeles';
const MIN_DURATION_SECONDS = 120;

console.log(`Backfill Strava enrichment for ${username}, ${daysBack} days back`);
console.log(`Mode: ${writeMode ? 'WRITE' : 'DRY-RUN'}\n`);

// ------------------------------------------------------------------
// Paths
// ------------------------------------------------------------------
const stravaArchiveDir = path.join(dataDir, 'users', username, 'lifelog', 'strava');
const fitnessHistoryDir = configService.getHouseholdPath('history/fitness');

const cutoff = moment().subtract(daysBack, 'days').format('YYYY-MM-DD');

// ------------------------------------------------------------------
// Step 1: Load all Strava archives into a map by activityId
// ------------------------------------------------------------------
console.log('Loading Strava archives...');
const archivesByActivityId = new Map();

if (dirExists(stravaArchiveDir)) {
  const archiveFiles = listYamlFiles(stravaArchiveDir);
  for (const baseName of archiveFiles) {
    // Filename format: 2025-12-20_Workout_16796552981
    const parts = baseName.split('_');
    const dateStr = parts[0]; // e.g. 2025-12-20
    if (dateStr < cutoff) continue;

    const archive = loadYamlSafe(path.join(stravaArchiveDir, baseName));
    if (!archive || !archive.id) continue;

    const activityId = String(archive.id);
    archivesByActivityId.set(activityId, archive);
  }
}

console.log(`Loaded ${archivesByActivityId.size} Strava archives (since ${cutoff})\n`);

// ------------------------------------------------------------------
// Step 2: Scan all session YAMLs and build activity-to-session map
// ------------------------------------------------------------------
console.log('Scanning fitness sessions...');
const matchedActivityIds = new Set();
let enriched = 0;
let created = 0;
let skipped = 0;

// Get all date directories in range
const dateDirs = listDirs(fitnessHistoryDir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= cutoff);
dateDirs.sort();

for (const dateDir of dateDirs) {
  const datePath = path.join(fitnessHistoryDir, dateDir);
  const sessionFiles = listYamlFiles(datePath);

  for (const sessionBaseName of sessionFiles) {
    const sessionFilePath = path.join(datePath, `${sessionBaseName}.yml`);
    const session = loadYamlSafe(sessionFilePath);
    if (!session || !session.participants) continue;

    // Check each participant for strava.activityId
    for (const [participantName, participant] of Object.entries(session.participants)) {
      const activityId = participant?.strava?.activityId;
      if (!activityId) continue;

      const activityIdStr = String(activityId);
      matchedActivityIds.add(activityIdStr);

      // Check if session-level strava block already exists
      if (session.strava?.name) {
        skipped++;
        continue;
      }

      // Find matching archive
      const archive = archivesByActivityId.get(activityIdStr);
      if (!archive?.data) {
        skipped++;
        continue;
      }

      const data = archive.data;

      // Build session-level strava block
      const stravaBlock = {
        activityId: archive.id,
        name: data.name || null,
        type: data.type || null,
        sportType: data.sport_type || null,
        movingTime: data.moving_time || 0,
        distance: data.distance || 0,
        totalElevationGain: data.total_elevation_gain || 0,
        trainer: data.trainer ?? true,
        avgHeartrate: data.average_heartrate || null,
        maxHeartrate: data.max_heartrate || null,
      };

      // Only include map if polyline is non-empty
      if (data.map?.summary_polyline) {
        stravaBlock.map = {
          polyline: data.map.summary_polyline,
          startLatLng: data.start_latlng || [],
          endLatLng: data.end_latlng || [],
        };
      }

      session.strava = stravaBlock;

      const sessionId = session.sessionId || sessionBaseName;
      console.log(`  ENRICH ${sessionId}: ${data.name} (${activityIdStr})`);

      if (writeMode) {
        // saveYaml handles .yml extension — pass path without .yml
        const savePath = path.join(datePath, sessionBaseName);
        saveYaml(savePath, session);
      }

      enriched++;
    }
  }
}

console.log(`\nEnriched: ${enriched}, Skipped (already enriched or no archive): ${skipped}`);

// ------------------------------------------------------------------
// Step 3: Create sessions for unmatched Strava archives
// ------------------------------------------------------------------
console.log('\nChecking for unmatched Strava archives...');

for (const [activityIdStr, archive] of archivesByActivityId) {
  // Skip if already matched to an existing session
  if (matchedActivityIds.has(activityIdStr)) continue;

  const data = archive.data;
  if (!data) {
    skipped++;
    continue;
  }

  // Skip short activities
  const durationSeconds = data.elapsed_time || data.moving_time || 0;
  if (durationSeconds < MIN_DURATION_SECONDS) {
    skipped++;
    continue;
  }

  // Parse start time from archive
  const startDateLocal = data.start_date_local || data.start_date;
  if (!startDateLocal) {
    skipped++;
    continue;
  }

  // Remove trailing Z from start_date_local (it's local, not UTC)
  const localStr = String(startDateLocal).replace('Z', '');
  const startMoment = moment.tz(localStr, TIMEZONE);
  if (!startMoment.isValid()) {
    skipped++;
    continue;
  }

  const sessionId = startMoment.format('YYYYMMDDHHmmss');
  const dateStr = startMoment.format('YYYY-MM-DD');
  const endMoment = startMoment.clone().add(durationSeconds, 'seconds');

  // Check if session file already exists (idempotency)
  const sessionDir = path.join(fitnessHistoryDir, dateStr);
  const sessionFilePath = path.join(sessionDir, `${sessionId}.yml`);
  if (fileExists(sessionFilePath)) {
    // Session already exists — still mark it as matched
    skipped++;
    continue;
  }

  // Build map data if GPS exists
  let mapData = null;
  if (data.map?.summary_polyline) {
    mapData = {
      polyline: data.map.summary_polyline,
      startLatLng: data.start_latlng || [],
      endLatLng: data.end_latlng || [],
    };
  }

  // Build v3 session file
  const sessionData = {
    version: 3,
    sessionId,
    session: {
      id: sessionId,
      date: dateStr,
      start: startMoment.format('YYYY-MM-DD HH:mm:ss'),
      end: endMoment.format('YYYY-MM-DD HH:mm:ss'),
      duration_seconds: durationSeconds,
      source: 'strava',
    },
    timezone: TIMEZONE,
    participants: {
      [username]: {
        display_name: username,
        is_primary: true,
        strava: {
          activityId: archive.id,
          type: data.type || data.sport_type || null,
          sufferScore: data.suffer_score || null,
          deviceName: data.device_name || null,
        },
      },
    },
    strava: {
      activityId: archive.id,
      name: data.name || null,
      type: data.type || null,
      sportType: data.sport_type || null,
      movingTime: data.moving_time || 0,
      distance: data.distance || 0,
      totalElevationGain: data.total_elevation_gain || 0,
      trainer: data.trainer ?? true,
      avgHeartrate: data.average_heartrate || null,
      maxHeartrate: data.max_heartrate || null,
      ...(mapData ? { map: mapData } : {}),
    },
    timeline: {
      series: {},
      events: [],
      interval_seconds: 5,
      tick_count: Math.ceil(durationSeconds / 5),
      encoding: 'rle',
    },
    treasureBox: {
      coinTimeUnitMs: 5000,
      totalCoins: 0,
      buckets: { blue: 0, green: 0, yellow: 0, orange: 0, red: 0 },
    },
    summary: {
      participants: {},
      media: [],
      coins: { total: 0, buckets: { blue: 0, green: 0, yellow: 0, orange: 0, red: 0 } },
      challenges: { total: 0, succeeded: 0, failed: 0 },
      voiceMemos: [],
    },
  };

  console.log(`  CREATE ${sessionId}: ${data.name} (${activityIdStr})`);

  if (writeMode) {
    // saveYaml auto-creates directories and appends .yml
    const savePath = path.join(sessionDir, sessionId);
    saveYaml(savePath, sessionData);
  }

  created++;
}

// ------------------------------------------------------------------
// Summary
// ------------------------------------------------------------------
console.log(`\nDone: ${enriched} enriched, ${created} created, ${skipped} skipped`);
if (!writeMode) {
  console.log('(dry-run -- pass --write to persist)');
}
