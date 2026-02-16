import { SessionSerializerV3 } from './SessionSerializerV3.js';

/**
 * Look up a series by trying both v2 and compact key formats.
 * v2 keys:     user:<slug>:heart_rate, user:<slug>:zone_id, user:<slug>:coins_total
 * compact keys: <slug>:hr, <slug>:zone, <slug>:coins
 *
 * @param {Object} series - All series keyed by string
 * @param {string} slug - Participant slug
 * @param {string} v2Metric - v2 metric suffix (e.g. 'heart_rate')
 * @param {string} compactMetric - compact metric suffix (e.g. 'hr')
 * @returns {Array}
 */
function findSeries(series, slug, v2Metric, compactMetric) {
  return series[`user:${slug}:${v2Metric}`]
    || series[`${slug}:${compactMetric}`]
    || [];
}

/**
 * Build a session summary from raw session data.
 *
 * Pure function -- no side effects, no browser APIs, no React.
 * Delegates HR/zone/coins computation to SessionSerializerV3 static methods.
 *
 * @param {Object} params
 * @param {Object} params.participants - Map of slug -> display name (or metadata)
 * @param {Object} params.series - Raw or decoded series data keyed by string
 * @param {Array}  params.events - Timeline events array
 * @param {Object} params.treasureBox - { totalCoins, buckets }
 * @param {number} params.intervalSeconds - Seconds per tick
 * @returns {Object} Session summary
 */
export function buildSessionSummary({ participants, series, events, treasureBox, intervalSeconds }) {
  const safeSeries = series || {};
  const safeEvents = events || [];

  // ---------- Participants ----------
  const participantsSummary = {};
  for (const slug of Object.keys(participants || {})) {
    const hrSeries = findSeries(safeSeries, slug, 'heart_rate', 'hr');
    const zoneSeries = findSeries(safeSeries, slug, 'zone_id', 'zone');
    const coinsSeries = findSeries(safeSeries, slug, 'coins_total', 'coins');

    const hrStats = SessionSerializerV3.computeHrStats(hrSeries);
    const zoneTimeSeconds = SessionSerializerV3.computeZoneTime(zoneSeries, intervalSeconds);
    const coins = SessionSerializerV3.getLastValue(coinsSeries);

    // Convert zone seconds to minutes, rounded to 2 decimal places
    const zoneMinutes = {};
    for (const [zone, seconds] of Object.entries(zoneTimeSeconds)) {
      zoneMinutes[zone] = Math.round((seconds / 60) * 100) / 100;
    }

    participantsSummary[slug] = {
      coins,
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
    return {
      mediaId: d.mediaId,
      title: d.title,
      showTitle: d.grandparentTitle,
      seasonTitle: d.parentTitle,
      grandparentId: d.grandparentId,
      parentId: d.parentId,
      durationMs,
    };
  });

  // Mark the longest-duration media event as primary
  if (media.length > 0) {
    let longestIdx = 0;
    for (let i = 1; i < media.length; i++) {
      if (media[i].durationMs > media[longestIdx].durationMs) {
        longestIdx = i;
      }
    }
    media[longestIdx].primary = true;
  }

  // ---------- Coins from treasureBox ----------
  const coinsTotal = treasureBox?.totalCoins ?? 0;
  const coinsBuckets = treasureBox?.buckets ?? {};

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
    coins: { total: coinsTotal, buckets: coinsBuckets },
    challenges: { total: challengeEvents.length, succeeded, failed },
    voiceMemos,
  };
}
