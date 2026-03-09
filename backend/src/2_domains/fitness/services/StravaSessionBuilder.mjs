/**
 * StravaSessionBuilder — Pure functions to reconstruct fitness session
 * timeline data (HR, zones, coins) from per-second heart rate arrays.
 *
 * Used by:
 * - FitnessActivityEnrichmentService (webhook pipeline, Strava-only sessions)
 * - cli/reconstruct-fitness-sessions.mjs (backfill script)
 *
 * @module domains/fitness/services/StravaSessionBuilder
 */

const INTERVAL_SECONDS = 5;

const ZONES = [
  { name: 'cool',   short: 'c',    min: 0,   color: 'blue',   coins: 0 },
  { name: 'active', short: 'a',    min: 100, color: 'green',  coins: 1 },
  { name: 'warm',   short: 'w',    min: 120, color: 'yellow', coins: 2 },
  { name: 'hot',    short: 'h',    min: 140, color: 'orange', coins: 3 },
  { name: 'fire',   short: 'fire', min: 160, color: 'red',    coins: 5 },
];

function getZone(hr) {
  for (let i = ZONES.length - 1; i >= 0; i--) {
    if (hr >= ZONES[i].min) return ZONES[i];
  }
  return ZONES[0];
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

export function deriveCoins(hrSamples) {
  const coins = [];
  let cumulative = 0;
  for (const hr of hrSamples) {
    if (hr != null) cumulative += getZone(hr).coins;
    coins.push(cumulative);
  }
  return coins;
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
    if (!zoneDef || zoneDef.coins === 0) continue;
    bucketMap[zoneDef.color] += zoneDef.coins;
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

export function buildStravaSessionTimeline(hrPerSecond) {
  if (!hrPerSecond || !Array.isArray(hrPerSecond) || hrPerSecond.length < 2) return null;

  const hrSamples = resampleHR(hrPerSecond);
  const zoneSeries = deriveZones(hrSamples);
  const coinsSeries = deriveCoins(hrSamples);
  const totalCoins = coinsSeries.length > 0 ? coinsSeries[coinsSeries.length - 1] : 0;

  return {
    hrSamples,
    zoneSeries,
    coinsSeries,
    totalCoins,
    zoneMinutes: computeZoneMinutes(zoneSeries),
    buckets: computeBuckets(zoneSeries),
    hrStats: computeHRStats(hrSamples),
  };
}
