import { SessionSerializerV3 } from './SessionSerializerV3.js';
import { selectPrimaryMedia } from './selectPrimaryMedia.js';

/**
 * Look up a series by trying both v2 and compact key formats.
 * v2 keys:     user:<slug>:heart_rate, user:<slug>:zone_id, user:<slug>:rings_total
 * compact keys: <slug>:hr, <slug>:zone, <slug>:rings
 *
 * @param {Object} series - All series keyed by string
 * @param {string} slug - Participant slug
 * @param {string} v2Metric - v2 metric suffix (e.g. 'heart_rate')
 * @param {string} compactMetric - compact metric suffix (e.g. 'hr')
 * @returns {Array}
 */
/**
 * `legacyV2`/`legacyCompact` exist for the 2026-08-26 coins→rings rename: every
 * session written before it carries `coins_total` / `:coins` on disk, and the
 * data migration runs AFTER this ships so there is no flag day. Absent for
 * metrics that were never renamed.
 *
 * Delete both arguments once the migration reports zero `coins*` keys — see
 * backend/src/2_domains/fitness/services/ringSeries.mjs, which carries the same
 * fallback on the backend side and the same instruction to remove it.
 */
function findSeries(series, slug, v2Metric, compactMetric, legacyV2 = null, legacyCompact = null) {
  return series[`user:${slug}:${v2Metric}`]
    || series[`${slug}:${compactMetric}`]
    || (legacyV2 ? series[`user:${slug}:${legacyV2}`] : null)
    || (legacyCompact ? series[`${slug}:${legacyCompact}`] : null)
    || [];
}

/**
 * Build a session summary from raw session data.
 *
 * Pure function -- no side effects, no browser APIs, no React.
 * Delegates HR/zone/rings computation to SessionSerializerV3 static methods.
 *
 * @param {Object} params
 * @param {Object} params.participants - Map of slug -> display name (or metadata)
 * @param {Object} params.series - Raw or decoded series data keyed by string
 * @param {Array}  params.events - Timeline events array
 * @param {Object} params.treasureBox - { totalRings, buckets }
 * @param {number} params.intervalSeconds - Seconds per tick
 * @returns {Object} Session summary
 */
export function buildSessionSummary({ participants, series, events, treasureBox, intervalSeconds, warmupConfig }) {
  const safeSeries = series || {};
  const safeEvents = events || [];

  // ---------- Participants ----------
  const participantsSummary = {};
  for (const slug of Object.keys(participants || {})) {
    const hrSeries = findSeries(safeSeries, slug, 'heart_rate', 'hr');
    const zoneSeries = findSeries(safeSeries, slug, 'zone_id', 'zone');
    const ringsSeries = findSeries(safeSeries, slug, 'rings_total', 'rings', 'coins_total', 'coins');

    const hrStats = SessionSerializerV3.computeHrStats(hrSeries);
    const zoneTimeSeconds = SessionSerializerV3.computeZoneTime(zoneSeries, intervalSeconds);
    const rings = SessionSerializerV3.getLastValue(ringsSeries);

    // Convert zone seconds to minutes, rounded to 2 decimal places
    const zoneMinutes = {};
    for (const [zone, seconds] of Object.entries(zoneTimeSeconds)) {
      zoneMinutes[zone] = Math.round((seconds / 60) * 100) / 100;
    }

    participantsSummary[slug] = {
      rings,
      hr_avg: hrStats.avg,
      hr_max: hrStats.max,
      hr_min: hrStats.min,
      zone_minutes: zoneMinutes,
    };
  }

  // ---------- Media events ----------
  const mediaEvents = safeEvents.filter(e => e.type === 'media');
  const media = mediaEvents.map(e => {
    const d = e.data || {};
    const durationMs = (d.end != null && d.start != null) ? d.end - d.start : 0;
    const isTrack = d.contentType === 'track' || !!d.artist;
    return {
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
      ...(Array.isArray(d.labels) && d.labels.length ? { labels: d.labels } : {}),
    };
  });

  // Mark primary media (warmup-aware selection)
  const primary = selectPrimaryMedia(media, warmupConfig);
  if (primary) {
    primary.primary = true;
  }

  // ---------- Rings from treasureBox ----------
  const ringsTotal = treasureBox?.totalRings ?? 0;
  const ringsBuckets = treasureBox?.buckets ?? {};

  // ---------- Challenges ----------
  const challengeEvents = safeEvents.filter(e => e.type === 'challenge');
  const succeeded = challengeEvents.filter(e => e.data?.result === 'success').length;
  const failed = challengeEvents.length - succeeded;

  // ---------- Voice memos ----------
  const voiceMemos = safeEvents
    .filter(e => e.type === 'voice_memo')
    .map(e => ({
      transcript: e.data?.transcript || e.data?.transcriptPreview || null,
      durationSeconds: e.data?.durationSeconds ?? e.data?.duration_seconds ?? null,
      timestamp: e.timestamp,
    }));

  return {
    participants: participantsSummary,
    media,
    rings: { total: ringsTotal, buckets: ringsBuckets },
    challenges: { total: challengeEvents.length, succeeded, failed },
    voiceMemos,
  };
}
