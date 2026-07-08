/**
 * Participant statistics computation for fitness sessions.
 *
 * Pure domain logic — no rendering, no external dependencies.
 *
 * @module 2_domains/fitness/services/SessionStatsService
 */

import { ZONE_ORDER } from '../entities/Zone.mjs';

function zoneIntensity(zone) {
  const idx = ZONE_ORDER.indexOf(zone);
  return idx === -1 ? -1 : idx;
}

/**
 * Compute statistics for a single participant from decoded timeline data.
 *
 * @param {Object} params
 * @param {Array<number|null>} params.hr - Decoded heart rate array
 * @param {Array<string|null>} params.zones - Decoded zone name array
 * @param {Array<number|null>} params.coins - Decoded cumulative coins array
 * @param {number} params.intervalSeconds - Seconds per tick
 * @param {Object} params.participant - Participant metadata (coins_earned, active_seconds, display_name)
 * @returns {Object} Computed stats
 */
export function computeParticipantStats({ hr, zones, coins, intervalSeconds, participant }) {
  const p = participant || {};
  const hrValid = (hr || []).filter(v => v != null && v > 0);
  const peakHr = hrValid.length > 0 ? Math.max(...hrValid) : null;
  const avgHr = hrValid.length > 0 ? Math.round(hrValid.reduce((s, v) => s + v, 0) / hrValid.length) : null;
  const stdDevHr = hrValid.length > 1
    ? Math.round(Math.sqrt(hrValid.reduce((s, v) => s + (v - avgHr) ** 2, 0) / hrValid.length))
    : null;

  const zoneArr = zones || [];
  const coinArr = coins || [];
  const lastCoin = coinArr.length > 0 ? (coinArr[coinArr.length - 1] || 0) : 0;
  const totalCoins = p.coins_earned != null ? p.coins_earned : lastCoin;
  const activeTicks = zoneArr.filter(z => z != null).length;
  const activeSeconds = p.active_seconds != null ? p.active_seconds : activeTicks * intervalSeconds;
  const joinTick = (hr || []).findIndex(v => v != null && v > 0);
  const warmPlusTicks = zoneArr.filter(z => z === 'warm' || z === 'hot' || z === 'fire').length;
  const warmPlusRatio = activeTicks > 0 ? warmPlusTicks / activeTicks : 0;

  // Zone seconds
  const zoneTicks = {};
  for (const z of zoneArr) {
    if (z != null) zoneTicks[z] = (zoneTicks[z] || 0) + 1;
  }
  const zoneSeconds = {};
  for (const [z, count] of Object.entries(zoneTicks)) {
    zoneSeconds[z] = count * intervalSeconds;
  }

  // Zone HR boundaries
  const zoneBounds = {};
  for (let i = 0; i < (hr || []).length && i < zoneArr.length; i++) {
    const h = hr[i];
    const z = zoneArr[i];
    if (h != null && h > 0 && z != null) {
      if (!zoneBounds[z]) zoneBounds[z] = { min: h, max: h };
      else {
        if (h < zoneBounds[z].min) zoneBounds[z].min = h;
        if (h > zoneBounds[z].max) zoneBounds[z].max = h;
      }
    }
  }

  // Per-zone coins (delta from cumulative)
  const zoneCoins = {};
  for (let i = 0; i < zoneArr.length && i < coinArr.length; i++) {
    const z = zoneArr[i];
    if (z != null) {
      const cur = coinArr[i] || 0;
      const prev = i > 0 ? (coinArr[i - 1] || 0) : 0;
      const delta = Math.max(0, cur - prev);
      if (delta > 0) zoneCoins[z] = (zoneCoins[z] || 0) + delta;
    }
  }

  return {
    peakHr,
    avgHr,
    stdDevHr,
    totalCoins,
    activeSeconds,
    joinTick,
    warmPlusRatio,
    zoneSeconds,
    zoneBounds,
    zoneCoins,
    hrValues: hrValid,
  };
}

/**
 * Compute an HR histogram with per-bucket zone majority votes.
 *
 * Buckets span [minHr..maxHr] of the VALID samples (null/0 excluded). Each
 * bucket's zone is decided by counting how many (hr, zone) ticks landed in its
 * HR range and picking the zone with the most votes — boundary-matching fails
 * because zones overlap (HR 163 can be "cool" during cooldown). Ties prefer
 * the higher-intensity zone.
 *
 * Moved verbatim from FitnessReceiptRenderer (audit R-3): this is schema/stat
 * knowledge, not presentation.
 *
 * @param {Array<number|null>} hr - Decoded heart rate array (raw, may contain null/0)
 * @param {Array<string|null>} zones - Decoded zone-name array, index-paired with hr
 * @param {Object} [opts]
 * @param {number} [opts.buckets=10] - Number of histogram buckets
 * @returns {{ minHr: number, maxHr: number, bucketSize: number,
 *   counts: number[], maxCount: number, bucketZones: string[] } | null}
 *   null when there are no valid HR samples
 */
export function computeHrHistogram(hr, zones, { buckets: numBuckets = 10 } = {}) {
  const hrValues = (hr || []).filter(v => v != null && v > 0);
  if (hrValues.length === 0) return null;

  const minHr = Math.min(...hrValues);
  const maxHr = Math.max(...hrValues);
  const hrRange = maxHr - minHr || 1;
  const bucketSize = hrRange / numBuckets;

  // Count HR values per bucket
  const counts = new Array(numBuckets).fill(0);
  for (const v of hrValues) {
    const idx = Math.min(numBuckets - 1, Math.floor((v - minHr) / bucketSize));
    counts[idx]++;
  }
  const maxCount = Math.max(...counts, 1);

  // Determine which zone each bucket belongs to using actual data votes
  const zoneArr = zones || [];
  const hrArr = hr || [];
  const bucketZones = [];
  for (let b = 0; b < numBuckets; b++) {
    const bucketMin = minHr + b * bucketSize;
    const bucketMax = minHr + (b + 1) * bucketSize;
    // Count how many ticks at this HR range were classified into each zone
    const votes = {};
    for (let i = 0; i < hrArr.length && i < zoneArr.length; i++) {
      const h = hrArr[i];
      const z = zoneArr[i];
      if (h != null && h > 0 && z != null) {
        const inBucket = b < numBuckets - 1
          ? (h >= bucketMin && h < bucketMax)
          : (h >= bucketMin && h <= bucketMax);
        if (inBucket) votes[z] = (votes[z] || 0) + 1;
      }
    }
    // Pick zone with most votes; on tie prefer higher intensity
    let bestZone = 'cool';
    let bestCount = 0;
    for (const zone of ZONE_ORDER) {
      const count = votes[zone] || 0;
      if (count > bestCount || (count === bestCount && count > 0 && zoneIntensity(zone) > zoneIntensity(bestZone))) {
        bestZone = zone;
        bestCount = count;
      }
    }
    bucketZones.push(bestZone);
  }

  return { minHr, maxHr, bucketSize, counts, maxCount, bucketZones };
}

/**
 * Coins-per-minute rate, formatted to one decimal (receipt display contract).
 * @param {number} totalCoins
 * @param {number} activeMinutes
 * @returns {string} e.g. '2.8'; '0.0' when no active time
 */
export function coinsPerMinute(totalCoins, activeMinutes) {
  return activeMinutes > 0 ? (totalCoins / activeMinutes).toFixed(1) : '0.0';
}

// Session event-type schema: raw stored types → normalized receipt categories.
// challenge_start is deliberately unmapped — only challenge_end carries the
// final result. overlay.* and other internal events are skipped the same way.
const EVENT_TYPE_MAP = {
  media_start: 'media',
  challenge_end: 'challenge',
  voice_memo: 'voice_memo',
};

/**
 * Flatten a session's events across BOTH stored schema shapes into a uniform
 * `{ type, event }` list (raw order preserved):
 *   - array shape:  [{ at, type, data }] — data spread flat, at/timestamp kept
 *   - dict shape:   { type: [events] }   — event fields override data fields
 * Unmapped types (challenge_start, overlay.*, unknown) are dropped.
 *
 * Moved verbatim from FitnessReceiptRenderer (audit R-3).
 *
 * @param {Object} session - Parsed session object with an `events` field
 * @returns {Array<{ type: 'media'|'challenge'|'voice_memo', event: Object }>}
 */
export function normalizeSessionEvents(session) {
  const rawEvents = session?.events || [];
  const allEvents = [];
  if (Array.isArray(rawEvents)) {
    for (const ev of rawEvents) {
      // Flatten: merge ev.data into top-level for uniform access
      allEvents.push({ ...ev.data, at: ev.at, timestamp: ev.timestamp, _type: ev.type });
    }
  } else if (rawEvents && typeof rawEvents === 'object') {
    for (const [type, evList] of Object.entries(rawEvents)) {
      if (!Array.isArray(evList)) continue;
      for (const ev of evList) {
        allEvents.push({ ...ev.data, ...ev, _type: type });
      }
    }
  }

  const normalized = [];
  for (const ev of allEvents) {
    const rawType = ev._type || 'unknown';
    const normalType = EVENT_TYPE_MAP[rawType];
    if (!normalType) continue;
    normalized.push({ type: normalType, event: ev });
  }
  return normalized;
}

/**
 * Deduplicate challenge events: keep only the LAST challenge_end per
 * challengeId (the final outcome). The caller supplies the list in the order
 * that defines "last" (the receipt passes time-sorted events).
 *
 * @param {Array<{ type: string, event: Object }>} events
 * @returns {Array<{ type: string, event: Object }>}
 */
export function dedupeChallengeEvents(events) {
  const challengeEndEvents = (events || []).filter(e => e.type === 'challenge' && e.event?._type === 'challenge_end');
  const challengeById = new Map();
  for (const chEv of challengeEndEvents) {
    challengeById.set(chEv.event.challengeId, chEv); // last one wins
  }
  return [...challengeById.values()];
}

/**
 * Discover participant slugs from a session timeline: union of `slug:zone`
 * series keys and the participants block, excluding the synthetic 'global'
 * aggregate and hardware pseudo-participants ('device:*', 'bike:*').
 *
 * Moved verbatim from FitnessReceiptRenderer (audit R-3): the prefix filtering
 * is timeline-schema knowledge, not presentation.
 *
 * @param {Object} series - timeline.series map (flat 'slug:metric' keys)
 * @param {Object} [participants] - session participants block
 * @returns {string[]} participant slugs
 */
export function discoverParticipants(series, participants = {}) {
  const seriesSlugs = new Set();
  for (const key of Object.keys(series || {})) {
    const match = key.match(/^([^:]+):zone$/);
    if (match) seriesSlugs.add(match[1]);
  }
  for (const slug of Object.keys(participants || {})) {
    seriesSlugs.add(slug);
  }
  return [...seriesSlugs].filter(s => s !== 'global' && !s.startsWith('device:') && !s.startsWith('bike:'));
}

export { zoneIntensity, ZONE_ORDER };
