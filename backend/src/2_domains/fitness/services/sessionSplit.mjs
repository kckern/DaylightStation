/**
 * Pure logic to split one persisted v3 fitness session into two at a tick
 * boundary, re-zeroing cumulative series and recomputing summaries.
 *
 * @module 2_domains/fitness/services/sessionSplit
 */
import { computeParticipantStats } from './SessionStatsService.mjs';

const CUMULATIVE_SUFFIXES = ['beats', 'coins', 'rotations', 'impacts'];
const ZONE_COLOR = { cool: 'blue', active: 'green', warm: 'yellow', hot: 'orange', fire: 'red' };

/** A series whose values accumulate monotonically and must rebase to 0 in part 2. */
export function isCumulativeKey(key) {
  if (typeof key !== 'string') return false;
  const suffix = key.split(':').pop();
  return CUMULATIVE_SUFFIXES.includes(suffix);
}

export function zoneToColor(zone) {
  return ZONE_COLOR[zone] ?? null;
}

export function computeSplitTick({ splitTs, startAbsMs, intervalMs }) {
  return Math.round((splitTs - startAbsMs) / intervalMs);
}

/** Last non-null value at an index strictly less than splitTick (carry-forward). */
function baselineBefore(arr, splitTick) {
  for (let i = Math.min(splitTick, arr.length) - 1; i >= 0; i--) {
    if (arr[i] != null) return arr[i];
  }
  return 0;
}

/**
 * Split a map of decoded (flat-array) series at splitTick.
 * Instantaneous series are sliced; cumulative series are sliced and part 2 is
 * rebased so it starts near 0 (value - baseline, floored at 0).
 *
 * @param {Record<string, Array<number|string|null>>} decoded
 * @param {number} splitTick
 * @returns {{ part1: Record<string, any[]>, part2: Record<string, any[]> }}
 */
export function splitDecodedSeries(decoded, splitTick) {
  const part1 = {};
  const part2 = {};
  for (const [key, arr] of Object.entries(decoded)) {
    const a = Array.isArray(arr) ? arr : [];
    part1[key] = a.slice(0, splitTick);
    const tail = a.slice(splitTick);
    if (isCumulativeKey(key)) {
      const baseline = baselineBefore(a, splitTick);
      part2[key] = tail.map(v => (v == null ? null : Math.max(0, v - baseline)));
    } else {
      part2[key] = tail;
    }
  }
  return { part1, part2 };
}

/**
 * Recompute the per-part summary + treasureBox from that part's decoded series
 * and that part's events. Returns { summary, treasureBox }.
 *
 * @param {Object} args
 * @param {Record<string, any[]>} args.series   - decoded series for THIS part (coins already re-zeroed)
 * @param {string[]} args.slugs                 - participant slugs
 * @param {Array} args.events                   - events belonging to THIS part
 * @param {number} args.intervalMs
 * @param {number} args.coinTimeUnitMs
 */
export function recomputeSummaryForPart({ series, slugs, events, intervalMs, coinTimeUnitMs }) {
  const intervalSeconds = intervalMs / 1000;
  const participants = {};
  const buckets = { blue: 0, green: 0, yellow: 0, orange: 0, red: 0 };
  let totalCoins = 0;

  for (const slug of slugs) {
    const hr = series[`${slug}:hr`] || [];
    const zones = series[`${slug}:zone`] || [];
    const coins = series[`${slug}:coins`] || [];
    const hrValid = hr.filter(v => v != null && v > 0);
    if (hrValid.length === 0) continue; // participant not active in this part

    const stats = computeParticipantStats({ hr, zones, coins, intervalSeconds, participant: {} });
    const zoneMinutes = {};
    for (const [z, secs] of Object.entries(stats.zoneSeconds)) {
      zoneMinutes[z] = Math.round((secs / 60) * 100) / 100;
    }
    participants[slug] = {
      coins: stats.totalCoins,
      hr_avg: stats.avgHr,
      hr_max: stats.peakHr,
      hr_min: Math.min(...hrValid),
      zone_minutes: zoneMinutes,
    };
    totalCoins += stats.totalCoins || 0;
    for (const [zone, coinDelta] of Object.entries(stats.zoneCoins)) {
      const color = zoneToColor(zone);
      if (color) buckets[color] += coinDelta;
    }
  }

  const challengeEvents = events.filter(e => e?.type === 'challenge');
  const succeeded = challengeEvents.filter(e => e?.data?.result === 'success').length;
  const failed = challengeEvents.filter(e => e?.data?.result === 'failed').length;

  const mediaEvents = events.filter(e => e?.type === 'media');

  return {
    summary: {
      participants,
      media: mediaEvents.map(e => ({
        contentId: e.data?.contentId,
        title: e.data?.title ?? null,
        mediaType: 'video',
        showTitle: e.data?.grandparentTitle ?? null,
        seasonTitle: e.data?.parentTitle ?? null,
        grandparentId: e.data?.grandparentId ?? null,
        parentId: e.data?.parentId ?? null,
        durationMs: (e.data?.start != null && e.data?.end != null) ? Math.max(0, e.data.end - e.data.start) : 0,
        ...(e.data?.description ? { description: e.data.description } : {}),
        ...(Array.isArray(e.data?.labels) && e.data.labels.length ? { labels: e.data.labels } : {}),
      })),
      coins: { total: totalCoins, buckets },
      challenges: { total: challengeEvents.length, succeeded, failed },
    },
    treasureBox: { coinTimeUnitMs, totalCoins, buckets },
  };
}
