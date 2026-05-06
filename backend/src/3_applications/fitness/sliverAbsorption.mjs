/**
 * sliverAbsorption — pure-by-input function that deletes short HR-only home
 * sessions overlapping a Strava activity's window.
 *
 * Such "slivers" are typically cooldown / passing-through HR captures (e.g.
 * the user walked into the home receiver's range while finishing an outdoor
 * activity). They are never real workouts; the Strava activity has the
 * actual data. This helper is invoked from:
 *   1. FitnessActivityEnrichmentService._createStravaOnlySession (webhook path)
 *   2. StravaReconciliationService.reconcile (periodic + post-webhook)
 *   3. cli/scripts/backfill-strava-enrichment.mjs (historical backfill)
 *
 * Conservative absorption rules — a session is deleted only if ALL hold:
 *   - It is not a Strava-only session (`session.source !== 'strava'`)
 *   - It is not the just-created session (skip via `justCreatedSessionId`)
 *   - It has no media (`!summary.media || summary.media.length === 0`)
 *   - It is short (`session.duration_seconds < 15 * 60`)
 *   - Its time window overlaps the activity ±15 min buffer
 *
 * @module applications/fitness/sliverAbsorption
 */

import path from 'path';
import { unlinkSync } from 'fs';
import moment from 'moment-timezone';
import { loadYamlSafe, listYamlFiles, dirExists } from '#system/utils/FileIO.mjs';

export const SLIVER_MAX_DURATION_SEC = 15 * 60;
export const SLIVER_OVERLAP_BUFFER_MS = 15 * 60 * 1000;

/**
 * Delete short HR-only home-session slivers that overlap a Strava activity.
 *
 * @param {Object} activity - Strava activity (must have id, start_date, elapsed_time | moving_time)
 * @param {string} sessionDir - Date directory absolute path
 * @param {Object} [options]
 * @param {string} [options.justCreatedSessionId] - Skip this id (e.g. the strava-only session we just wrote)
 * @param {string} [options.tz='America/Los_Angeles'] - Default timezone for activity start parsing
 * @param {Object} [options.logger] - Logger with info/warn methods
 * @returns {{ scanned: number, absorbed: string[] }}
 */
export function absorbOverlappingSlivers(activity, sessionDir, options = {}) {
  const {
    justCreatedSessionId = null,
    tz = 'America/Los_Angeles',
    logger = console,
  } = options;

  if (!dirExists(sessionDir)) {
    return { scanned: 0, absorbed: [] };
  }

  const actStart = moment(activity.start_date).tz(tz);
  const actEnd = actStart.clone().add(
    activity.elapsed_time || activity.moving_time || 0,
    'seconds'
  );
  const bufStart = actStart.clone().subtract(SLIVER_OVERLAP_BUFFER_MS, 'ms');
  const bufEnd = actEnd.clone().add(SLIVER_OVERLAP_BUFFER_MS, 'ms');

  const files = listYamlFiles(sessionDir);
  const absorbed = [];

  for (const filename of files) {
    if (filename === justCreatedSessionId) continue;

    const filePath = path.join(sessionDir, `${filename}.yml`);
    const data = loadYamlSafe(filePath);
    if (!data) continue;
    if (data.session?.source === 'strava') continue;
    if (Array.isArray(data.summary?.media) && data.summary.media.length > 0) continue;

    const durSec = data.session?.duration_seconds || 0;
    if (durSec === 0 || durSec >= SLIVER_MAX_DURATION_SEC) continue;

    const sessTz = data.timezone || tz;
    const sessStart = data.session?.start ? moment.tz(data.session.start, sessTz) : null;
    const sessEnd = data.session?.end
      ? moment.tz(data.session.end, sessTz)
      : (sessStart ? sessStart.clone().add(durSec, 'seconds') : null);
    if (!sessStart || !sessEnd) continue;
    if (sessEnd.isBefore(bufStart) || sessStart.isAfter(bufEnd)) continue;

    try {
      unlinkSync(filePath);
      absorbed.push(filename);
      logger.info?.('strava.enrichment.sliver_absorbed', {
        activityId: activity.id,
        sliverFile: filename,
        sliverDurationSec: durSec,
        activityElapsedSec: activity.elapsed_time || activity.moving_time || 0,
      });
    } catch (err) {
      logger.warn?.('strava.enrichment.sliver_absorb_failed', {
        activityId: activity.id,
        sliverFile: filename,
        error: err?.message,
      });
    }
  }

  return { scanned: files.length, absorbed };
}
