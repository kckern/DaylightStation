/**
 * Shared, pure helpers for recomputing a fitness session's `summary` block
 * from its decoded timeline series + events. Extracted out of
 * `cli/merge-fitness-sessions.cli.mjs` (which originally defined these
 * inline) so `cli/heal-fitness-sessions.cli.mjs` can reuse the exact same
 * logic without duplicating it.
 *
 * All functions here are pure (no I/O, no encoding/decoding) — callers are
 * responsible for decoding RLE series (via TimelineService.decodeSeries)
 * before calling `buildSummary`.
 */

export const ZONE_MAP = { c: 'cool', a: 'active', w: 'warm', h: 'hot', fire: 'fire' };

/**
 * Cumulative series count up monotonically (coins/beats running totals) and
 * reset to 0 whenever the counter restarts (a new session, or — within a
 * single session — a new occupant id after a device swap). Both
 * `merge-fitness-sessions.cli.mjs` (cross-session rebase via
 * `cumulativeOffsets`/`rebaseCumulativeSeries`) and
 * `heal-fitness-sessions.cli.mjs` (device-swap identity-merge fold via
 * `foldOccupantSeries`) need to detect these keys so a split counter gets
 * recombined additively instead of naively deduped/maxed.
 *
 * Matches both the flat on-disk compact form used by heal
 * (`<id>:coins`, `<id>:beats`) and the `_total`/`global:` forms seen during
 * cross-session merges.
 *
 * @param {string} key
 * @returns {boolean}
 */
export function isCumulativeSeriesKey(key) {
  return /:coins(_total)?$/.test(key)
    || /:beats$/.test(key)
    || key === 'global:coins';
}

/**
 * Last non-null value in an array, or 0 if none. Used for cumulative series
 * (e.g. coins) where the terminal value is the running total.
 *
 * @param {Array} arr
 * @returns {number}
 */
export function getLastNonNull(arr) {
  for (let i = (arr || []).length - 1; i >= 0; i--) {
    if (arr[i] != null) return arr[i];
  }
  return 0;
}

/**
 * Min/max/avg over the non-null, positive samples of a heart-rate series.
 *
 * @param {Array<number|null>} hrSeries
 * @returns {{min:number, max:number, avg:number}}
 */
export function computeHrStats(hrSeries) {
  const valid = (hrSeries || []).filter(v => Number.isFinite(v) && v > 0);
  if (valid.length === 0) return { min: 0, max: 0, avg: 0 };
  return {
    min: Math.min(...valid),
    max: Math.max(...valid),
    avg: Math.round(valid.reduce((a, b) => a + b, 0) / valid.length)
  };
}

/**
 * Seconds spent in each HR zone, keyed by full zone name (via ZONE_MAP).
 *
 * @param {Array<string|null>} zoneSeries - single-letter (c/a/w/h) or full-word zone values
 * @param {number} intervalSeconds - seconds per timeline tick
 * @returns {Object<string, number>} zone name -> seconds
 */
export function computeZoneTime(zoneSeries, intervalSeconds) {
  const counts = {};
  (zoneSeries || []).forEach(z => {
    if (z == null) return;
    const name = ZONE_MAP[z] || z;
    counts[name] = (counts[name] || 0) + intervalSeconds;
  });
  return counts;
}

/**
 * Look up a participant's series by slug, accepting both the v2 flat-map key
 * form (`user:<slug>:<v2Suffix>`) and the on-disk compact form
 * (`<slug>:<compactSuffix>`).
 *
 * @param {Object} series - decoded series map
 * @param {string} slug
 * @param {string} v2Suffix - e.g. 'heart_rate', 'zone_id', 'coins_total'
 * @param {string} compactSuffix - e.g. 'hr', 'zone', 'coins'
 * @returns {Array}
 */
export function findSeries(series, slug, v2Suffix, compactSuffix) {
  return series[`user:${slug}:${v2Suffix}`]
    || series[`${slug}:${compactSuffix}`]
    || [];
}

/**
 * Recompute the full `summary` block from a session's (decoded) timeline.
 *
 * @param {Object} args
 * @param {Object} args.participants - session.participants map (slug -> participant)
 * @param {Object} args.series - decoded timeline series map
 * @param {Array} args.events - timeline events array
 * @param {Object} [args.treasureBox] - session.treasureBox block
 * @param {number} args.intervalSeconds - seconds per timeline tick
 * @returns {Object} summary block ({ participants, media, coins, challenges, voiceMemos })
 */
export function buildSummary({ participants, series, events, treasureBox, intervalSeconds }) {
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

export default {
  ZONE_MAP,
  isCumulativeSeriesKey,
  getLastNonNull,
  computeHrStats,
  computeZoneTime,
  findSeries,
  buildSummary
};
