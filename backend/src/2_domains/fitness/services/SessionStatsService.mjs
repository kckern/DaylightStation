/**
 * Participant statistics computation for fitness sessions.
 *
 * Pure domain logic — no rendering, no external dependencies.
 *
 * @module 2_domains/fitness/services/SessionStatsService
 */

const ZONE_ORDER = ['cool', 'active', 'warm', 'hot', 'fire'];

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

export { zoneIntensity, ZONE_ORDER };
