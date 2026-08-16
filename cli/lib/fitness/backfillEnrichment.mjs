/**
 * Retroactively enrich fitness sessions with Strava data, and create
 * Strava-only sessions for archives that never got matched.
 *
 * Two phases:
 *  1. ENRICH — for sessions that already carry
 *     `participants[*].strava.activityId`, add the top-level `strava` block
 *     built from the archived activity summary.
 *  2. CREATE — for Strava archives with no matching session, write a new
 *     Strava-only session YAML (the same v3 shape the webhook handler emits),
 *     then absorb any overlapping HR-only slivers. Activities shorter than
 *     120 seconds are skipped.
 *
 * Dry-run by default; `--write` persists.
 *
 * @module cli/lib/fitness/backfillEnrichment
 */

import path from 'path';
import moment from 'moment-timezone';
import { parseArgs, bool, num } from './argv.mjs';
import { CliError } from './context.mjs';

export const spec = {
  name: 'backfill-enrichment',
  summary: 'add session-level strava blocks and create strava-only sessions for unmatched archives',
  usage: 'fitness strava backfill-enrichment [--write] [--days=N]',
  details: `  --write    Apply changes (default: dry run)
  --days=N   How far back to scan (default: back to 2024-01-01).
             A bare numeric positional is accepted for back-compat.`,
};

const TIMEZONE = 'America/Los_Angeles';
const MIN_DURATION_SECONDS = 120;

/**
 * @param {string[]} argv - argv tail AFTER the group+command tokens
 * @param {Object} ctx - from `getContext()`
 * @returns {Promise<Object>}
 */
export async function run(argv, ctx) {
  // `--write` must be declared boolean: the standalone script's documented form
  // was `--write 90`, and without this the `90` becomes --write's value instead
  // of the day count — so `--write 1` would run the full 938-day history in
  // write mode rather than one day.
  const { positional, flags } = parseArgs(argv, { booleanFlags: ['write'] });

  const writeMode = bool(flags, 'write');

  // Back-compat: the standalone script took `daysBack` as a bare numeric
  // positional. `--days` wins when both are supplied.
  const bareDays = positional.find((a) => /^\d+$/.test(a));
  const defaultDays = Math.ceil(moment().diff(moment('2024-01-01'), 'days'));
  const daysBack = num(flags, 'days', bareDays != null ? parseInt(bareDays, 10) : defaultDays);

  // ----------------------------------------------------------------
  // Bootstrap the app's config + FileIO layers (kept inside run() so this
  // module stays side-effect free on import).
  // ----------------------------------------------------------------
  const configDir = path.join(ctx.dataDir, 'system', 'config');
  const { hydrateProcessEnvFromConfigs } = await import('#system/logging/config.mjs');
  const { initConfigService, configService } = await import('#system/config/index.mjs');
  const { loadYamlSafe, saveYaml, listYamlFiles, fileExists, dirExists, listDirs } =
    await import('#system/utils/FileIO.mjs');
  const { absorbOverlappingSlivers } = await import('#apps/fitness/sliverAbsorption.mjs');

  hydrateProcessEnvFromConfigs(configDir);
  // initConfigService throws when called twice; tolerate a dispatcher (or a
  // sibling command) having already booted it.
  if (!configService.isReady()) {
    await initConfigService(ctx.dataDir);
  }

  const username = 'user_1';

  console.log(`Backfill Strava enrichment for ${username}, ${daysBack} days back`);
  console.log(`Mode: ${writeMode ? 'WRITE' : 'DRY-RUN'}\n`);

  // ----------------------------------------------------------------
  // Paths
  // ----------------------------------------------------------------
  const stravaArchiveDir = path.join(ctx.dataDir, 'users', username, 'lifelog', 'strava');
  const fitnessHistoryDir = configService.getHouseholdPath('fitness/log') || ctx.fitnessHistoryDir;
  if (!fitnessHistoryDir) {
    throw new CliError('Could not resolve the fitness history directory');
  }

  const cutoff = moment().subtract(daysBack, 'days').format('YYYY-MM-DD');

  // ----------------------------------------------------------------
  // Step 1: Load all Strava archives into a map by activityId
  // ----------------------------------------------------------------
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

      archivesByActivityId.set(String(archive.id), archive);
    }
  }

  console.log(`Loaded ${archivesByActivityId.size} Strava archives (since ${cutoff})\n`);

  // ----------------------------------------------------------------
  // Step 2: Scan all session YAMLs and enrich matched ones
  // ----------------------------------------------------------------
  console.log('Scanning fitness sessions...');
  const matchedActivityIds = new Set();
  let enriched = 0;
  let created = 0;
  let skipped = 0;
  let sliversAbsorbed = 0;

  const dateDirs = listDirs(fitnessHistoryDir).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= cutoff);
  dateDirs.sort();

  for (const dateDir of dateDirs) {
    const datePath = path.join(fitnessHistoryDir, dateDir);
    const sessionFiles = listYamlFiles(datePath);

    for (const sessionBaseName of sessionFiles) {
      const sessionFilePath = path.join(datePath, `${sessionBaseName}.yml`);
      const session = loadYamlSafe(sessionFilePath);
      if (!session || !session.participants) continue;

      // Check each participant for strava.activityId
      for (const [, participant] of Object.entries(session.participants)) {
        const activityId = participant?.strava?.activityId;
        if (!activityId) continue;

        const activityIdStr = String(activityId);
        matchedActivityIds.add(activityIdStr);

        // Session-level strava block already present?
        if (session.strava?.name) {
          skipped++;
          continue;
        }

        const archive = archivesByActivityId.get(activityIdStr);
        if (!archive?.data) {
          skipped++;
          continue;
        }

        const data = archive.data;

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
          // saveYaml handles the .yml extension — pass the path without it
          saveYaml(path.join(datePath, sessionBaseName), session);
        }

        enriched++;
      }
    }
  }

  console.log(`\nEnriched: ${enriched}, Skipped (already enriched or no archive): ${skipped}`);

  // ----------------------------------------------------------------
  // Step 3: Create sessions for unmatched Strava archives
  // ----------------------------------------------------------------
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

    // Idempotency: don't clobber an existing session file
    const sessionDir = path.join(fitnessHistoryDir, dateStr);
    const sessionFilePath = path.join(sessionDir, `${sessionId}.yml`);
    if (fileExists(sessionFilePath)) {
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
          display_name: 'User_1',
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
      saveYaml(path.join(sessionDir, sessionId), sessionData);

      // Absorb any HR-only home slivers in the same date dir that overlap this
      // activity. Mirrors what the webhook flow does in
      // FitnessActivityEnrichmentService._createStravaOnlySession. The helper
      // expects the raw Strava activity body (start_date, elapsed_time, id);
      // the archive wrapper holds those at archive.data.
      const activityForAbsorb = { ...data, id: archive.id };
      const absorbResult = absorbOverlappingSlivers(activityForAbsorb, sessionDir, {
        justCreatedSessionId: sessionId,
        tz: TIMEZONE,
        logger: console,
      });
      sliversAbsorbed += absorbResult.absorbed.length;
    }

    created++;
  }

  // ----------------------------------------------------------------
  // Summary
  // ----------------------------------------------------------------
  console.log(`\nDone: ${enriched} enriched, ${created} created, ${skipped} skipped, ${sliversAbsorbed} slivers absorbed`);
  if (!writeMode) {
    console.log('(dry-run -- pass --write to persist)');
  }

  return { enriched, created, skipped, sliversAbsorbed, daysBack, cutoff, write: writeMode };
}
