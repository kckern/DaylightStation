/**
 * Pure logic to split one persisted v3 fitness session into two at a tick
 * boundary, re-zeroing cumulative series and recomputing summaries.
 *
 * @module 2_domains/fitness/services/sessionSplit
 */
import { computeParticipantStats } from './SessionStatsService.mjs';

const CUMULATIVE_SUFFIXES = ['beats', 'coins', 'rotations', 'impacts'];
const ZONE_COLOR = { cool: 'blue', active: 'green', warm: 'yellow', hot: 'orange', fire: 'red' };

// Persisted `<slug>:zone` series store single-char zone SYMBOLS (see
// FitnessSession.ZONE_SYMBOL_MAP), not full names. Map them back before stats.
const ZONE_SYMBOL_TO_NAME = { c: 'cool', a: 'active', w: 'warm', h: 'hot', f: 'fire' };

/** Normalize a zone value (symbol or full name) to its full name; null stays null. */
export function normalizeZone(z) {
  if (z == null) return null;
  return ZONE_SYMBOL_TO_NAME[z] ?? z;
}

/** A series whose values accumulate monotonically and must rebase to 0 in part 2. */
export function isCumulativeKey(key) {
  if (typeof key !== 'string') return false;
  const suffix = key.split(':').pop();
  return CUMULATIVE_SUFFIXES.includes(suffix);
}

export function zoneToColor(zone) {
  return ZONE_COLOR[zone] ?? null;
}

const BUCKET_COLORS = ['blue', 'green', 'yellow', 'orange', 'red'];

/**
 * Split the ORIGINAL per-color coin buckets between two parts so that:
 *  - each color total is preserved exactly: part1[c] + part2[c] === orig[c]
 *  - each part's bucket sum equals its exact coin total (total1 / total2)
 *  - within those margins, allocation is weighted by each part's actual zone
 *    activity (est1/est2 estimated buckets); colors with no activity signal
 *    fall back to each part's share of total coins.
 *
 * Per-color buckets cannot be exactly reconstructed from the persisted per-tick
 * data (coins are colored by the highest zone per award interval, not stored),
 * so we redistribute the KNOWN originals rather than re-deriving them.
 *
 * @returns {{ part1: Record<string, number>, part2: Record<string, number> }}
 */
export function allocateBucketsRedistribute(orig, est1, est2, total1, total2) {
  const O = {};
  for (const c of BUCKET_COLORS) O[c] = Math.max(0, Math.round(orig?.[c] || 0));

  // Activity-weighted fractional part-1 target per color (seed), summing to total1
  // via water-filling that respects the [0, O[c]] caps.
  const seed = {};
  for (const c of BUCKET_COLORS) {
    const w1 = est1?.[c] || 0;
    const w2 = est2?.[c] || 0;
    const share = (w1 + w2) > 0
      ? w1 / (w1 + w2)
      : ((total1 + total2) > 0 ? total1 / (total1 + total2) : 0);
    seed[c] = O[c] * share;
  }

  const part1f = {};
  for (const c of BUCKET_COLORS) part1f[c] = 0;
  let remaining = total1;
  let active = BUCKET_COLORS.filter(c => O[c] > 0);
  for (let iter = 0; iter < 50 && active.length && remaining > 1e-9; iter++) {
    const dsum = active.reduce((s, c) => s + seed[c], 0);
    const overflow = [];
    if (dsum <= 1e-12) {
      // No activity signal among active colors — fill by remaining capacity.
      const capSum = active.reduce((s, c) => s + (O[c] - part1f[c]), 0) || 1;
      for (const c of active) part1f[c] += (O[c] - part1f[c]) * (remaining / capSum);
      break;
    }
    const scale = remaining / dsum;
    for (const c of active) {
      const want = part1f[c] + seed[c] * scale;
      if (want >= O[c]) { part1f[c] = O[c]; overflow.push(c); }
      else part1f[c] = want;
    }
    if (!overflow.length) break;
    remaining = total1 - BUCKET_COLORS.reduce((s, c) => s + part1f[c], 0);
    active = active.filter(c => !overflow.includes(c) && (O[c] - part1f[c]) > 1e-9);
  }

  // Integer rounding that preserves both margins exactly.
  const part1 = {};
  let used = 0;
  for (const c of BUCKET_COLORS) {
    part1[c] = Math.min(O[c], Math.floor(part1f[c]));
    used += part1[c];
  }
  let leftover = total1 - used;
  let guard = 0;
  while (leftover > 0 && guard++ < 100000) {
    let best = null;
    for (const c of BUCKET_COLORS) {
      if (O[c] - part1[c] <= 0) continue;
      const r = part1f[c] - Math.floor(part1f[c]);
      if (best === null || r > best.r) best = { c, r };
    }
    if (!best) break;
    part1[best.c] += 1;
    leftover -= 1;
  }

  const part2 = {};
  for (const c of BUCKET_COLORS) part2[c] = O[c] - part1[c];
  return { part1, part2 };
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
export function recomputeSummaryForPart({ series, slugs, events, intervalMs, coinTimeUnitMs, minHrSamples = 3 }) {
  const intervalSeconds = intervalMs / 1000;
  const participants = {};
  const buckets = { blue: 0, green: 0, yellow: 0, orange: 0, red: 0 };
  let totalCoins = 0;

  for (const slug of slugs) {
    const hr = series[`${slug}:hr`] || [];
    const zones = (series[`${slug}:zone`] || []).map(normalizeZone);
    const coins = series[`${slug}:coins`] || [];
    const hrValid = hr.filter(v => v != null && v > 0);
    // Require a minimum of real HR samples — a one-or-two-reading blip from a
    // strap that connected briefly is not a participant in this part.
    if (hrValid.length < minHrSamples) continue;

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
  const media = mediaEvents.map(e => ({
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
  }));

  // Mark the longest-watched media as `primary`. The list/grouping reads this:
  // a session with a primary video "stands alone" and is NOT merged into an
  // adjacent block — which is exactly what a deliberate split needs (two cards).
  let primaryIdx = -1;
  let primaryDur = -1;
  media.forEach((m, i) => {
    if (m.durationMs > primaryDur) { primaryDur = m.durationMs; primaryIdx = i; }
  });
  if (primaryIdx >= 0) media[primaryIdx].primary = true;

  return {
    summary: {
      participants,
      media,
      coins: { total: totalCoins, buckets },
      challenges: { total: challengeEvents.length, succeeded, failed },
    },
    treasureBox: { coinTimeUnitMs, totalCoins, buckets },
  };
}
