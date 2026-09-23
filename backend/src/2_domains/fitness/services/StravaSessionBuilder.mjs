/**
 * StravaSessionBuilder — Pure functions to reconstruct fitness session
 * timeline data (HR, zones, rings) from Strava heart rate streams.
 *
 * Strava's heartrate stream is NOT one sample per second. Garmin "smart
 * recording" writes a point every 1–10s (sometimes longer), so the stream must
 * be placed on the clock with its companion `time` stream (seconds from start).
 * Treating the raw array as per-second compresses the timeline — an 82-minute
 * run with 1039 samples became a 17-minute session.
 *
 * Used by:
 * - FitnessActivityEnrichmentService (webhook pipeline, Strava-only sessions)
 * - cli/fitness.cli.mjs session reconstruct (backfill command)
 *
 * @module domains/fitness/services/StravaSessionBuilder
 */

const INTERVAL_SECONDS = 5;

// Longest gap between samples that is bridged by holding the previous value.
// Anything longer (watch paused, strap dropped) stays null — no HR, no rings.
const MAX_HOLD_SECONDS = 60;

const ZONES = [
  { name: 'cool',   short: 'c',    min: 0,   color: 'blue',   rings: 0 },
  { name: 'active', short: 'a',    min: 100, color: 'green',  rings: 1 },
  { name: 'warm',   short: 'w',    min: 120, color: 'yellow', rings: 2 },
  { name: 'hot',    short: 'h',    min: 140, color: 'orange', rings: 3 },
  { name: 'fire',   short: 'fire', min: 160, color: 'red',    rings: 5 },
];

function getZone(hr) {
  for (let i = ZONES.length - 1; i >= 0; i--) {
    if (hr >= ZONES[i].min) return ZONES[i];
  }
  return ZONES[0];
}

/**
 * Place a Strava heartrate stream on a per-second clock using its time stream.
 * Gaps up to maxHoldSeconds hold the previous reading; longer gaps are null.
 *
 * @param {number[]} hrStream - Strava `heartrate` stream data
 * @param {number[]} timeStream - Strava `time` stream data (seconds from start), same length
 * @returns {Array<number|null>|null} One entry per second, or null when the streams don't line up
 */
export function expandToPerSecond(hrStream, timeStream, maxHoldSeconds = MAX_HOLD_SECONDS) {
  if (!Array.isArray(hrStream) || !Array.isArray(timeStream)) return null;
  if (hrStream.length < 2 || hrStream.length !== timeStream.length) return null;

  const lastSec = timeStream[timeStream.length - 1];
  const perSecond = new Array(lastSec + 1).fill(null);
  for (let i = 0; i < timeStream.length; i++) {
    const start = timeStream[i];
    const next = i + 1 < timeStream.length ? timeStream[i + 1] : start + 1;
    const holdUntil = next - start <= maxHoldSeconds ? next : start + 1;
    for (let sec = start; sec < holdUntil && sec <= lastSec; sec++) {
      perSecond[sec] = hrStream[i];
    }
  }
  return perSecond;
}

export function resampleHR(hrPerSecond, interval = INTERVAL_SECONDS) {
  const result = [];
  for (let i = 0; i < hrPerSecond.length; i += interval) {
    result.push(hrPerSecond[i]);
  }
  return result;
}

export function deriveZones(hrSamples) {
  return hrSamples.map(hr => hr == null ? null : getZone(hr).short);
}

export function deriveRings(hrSamples) {
  const rings = [];
  let cumulative = 0;
  for (const hr of hrSamples) {
    if (hr != null) cumulative += getZone(hr).rings;
    rings.push(cumulative);
  }
  return rings;
}

export function computeZoneMinutes(zoneSeries, interval = INTERVAL_SECONDS) {
  const tickCounts = {};
  for (const z of zoneSeries) {
    if (z == null) continue;
    const zoneDef = ZONES.find(zd => zd.short === z);
    if (!zoneDef) continue;
    tickCounts[zoneDef.name] = (tickCounts[zoneDef.name] || 0) + 1;
  }
  const result = {};
  for (const [name, count] of Object.entries(tickCounts)) {
    const minutes = Math.round(((count * interval) / 60) * 100) / 100;
    if (minutes > 0) result[name] = minutes;
  }
  return result;
}

export function computeBuckets(zoneSeries) {
  const bucketMap = { blue: 0, green: 0, yellow: 0, orange: 0, red: 0 };
  for (const z of zoneSeries) {
    if (z == null) continue;
    const zoneDef = ZONES.find(zd => zd.short === z);
    if (!zoneDef || zoneDef.rings === 0) continue;
    bucketMap[zoneDef.color] += zoneDef.rings;
  }
  return bucketMap;
}

export function computeHRStats(hrSamples) {
  const valid = hrSamples.filter(h => h != null && h > 0);
  if (valid.length === 0) return { hrAvg: 0, hrMax: 0, hrMin: 0 };
  return {
    hrAvg: Math.round(valid.reduce((s, h) => s + h, 0) / valid.length),
    hrMax: Math.max(...valid),
    hrMin: Math.min(...valid),
  };
}

/**
 * @param {number[]} hrStream - Strava heartrate stream
 * @param {number[]} [timeStream] - Strava time stream. When given, samples are
 *   placed at their real offsets. Without it the stream is assumed per-second,
 *   which only holds for devices that record every second.
 */
export function buildStravaSessionTimeline(hrStream, timeStream = null) {
  if (!hrStream || !Array.isArray(hrStream) || hrStream.length < 2) return null;

  const hrPerSecond = timeStream ? expandToPerSecond(hrStream, timeStream) : hrStream;
  if (!hrPerSecond) return null;

  const hrSamples = resampleHR(hrPerSecond);
  const zoneSeries = deriveZones(hrSamples);
  const ringsSeries = deriveRings(hrSamples);
  const totalRings = ringsSeries.length > 0 ? ringsSeries[ringsSeries.length - 1] : 0;

  return {
    hrSamples,
    zoneSeries,
    ringsSeries,
    totalRings,
    zoneMinutes: computeZoneMinutes(zoneSeries),
    buckets: computeBuckets(zoneSeries),
    hrStats: computeHRStats(hrSamples),
  };
}

/**
 * Write a built Strava timeline into a session record: the participant's
 * hr/zone/rings series, global rings, tick_count, treasure box and summary.
 * The single place a Strava-derived timeline is applied — the webhook's
 * Strava-only session and the reconciliation repair both go through it, so the
 * two can't drift apart. Other series and fields are left untouched.
 *
 * @param {Object} session - session record (hydrated: series as arrays)
 * @param {Object} timeline - result of buildStravaSessionTimeline
 * @param {string} username - participant key
 * @returns {Object} new session record
 */
export function applyStravaTimeline(session, timeline, username) {
  const buckets = timeline.buckets;
  const summary = session.summary || {};
  return {
    ...session,
    timeline: {
      events: [],
      encoding: 'rle',
      ...(session.timeline || {}),
      series: {
        ...(session.timeline?.series || {}),
        [`${username}:hr`]: timeline.hrSamples,
        [`${username}:zone`]: timeline.zoneSeries,
        [`${username}:rings`]: timeline.ringsSeries,
        'global:rings': timeline.ringsSeries,
      },
      interval_seconds: INTERVAL_SECONDS,
      tick_count: timeline.hrSamples.length,
    },
    treasureBox: { ...(session.treasureBox || {}), ringTimeUnitMs: INTERVAL_SECONDS * 1000, totalRings: timeline.totalRings, buckets },
    summary: {
      media: [],
      challenges: { total: 0, succeeded: 0, failed: 0 },
      voiceMemos: [],
      ...summary,
      participants: {
        ...(summary.participants || {}),
        [username]: {
          ...(summary.participants?.[username] || {}),
          rings: timeline.totalRings,
          hr_avg: timeline.hrStats.hrAvg,
          hr_max: timeline.hrStats.hrMax,
          hr_min: timeline.hrStats.hrMin,
          zone_minutes: timeline.zoneMinutes,
        },
      },
      rings: { total: timeline.totalRings, buckets },
    },
  };
}
