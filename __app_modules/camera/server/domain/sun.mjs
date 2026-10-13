/**
 * Sunrise/sunset via NOAA solar position — pure arithmetic, no network.
 *
 * Deliberately computed rather than fetched: the backfill spans ~95 historical
 * dates, and live sources (HA `sun.sun`, most weather APIs' free tiers) only
 * report today. This is exact for any past or future date and runs offline.
 *
 * Reference: NOAA Solar Calculator (General Solar Position Calculations).
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Days since the J2000.0 epoch for a UTC date at 00:00. */
function julianDay(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

function solarMeanAnomaly(d) {
  return (357.5291 + 0.98560028 * d) * RAD;
}

function eclipticLongitude(M) {
  const C = (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) * RAD;
  const P = 102.9372 * RAD;
  return M + C + P + Math.PI;
}

function declination(L) {
  const e = 23.4397 * RAD;
  return Math.asin(Math.sin(e) * Math.sin(L));
}

/**
 * Compute sunrise and sunset for a given calendar date and location.
 *
 * @param {string} isoDate  'YYYY-MM-DD' (local calendar date)
 * @param {number} latitude
 * @param {number} longitude
 * @returns {{ sunrise: Date, sunset: Date, solarNoon: Date, polar: null|'day'|'night' }}
 *   `polar` is non-null when the sun never rises/sets (possible at extreme
 *   latitudes); callers must treat the whole day as one phase in that case.
 */
export function sunTimes(isoDate, latitude, longitude) {
  const [y, m, d] = isoDate.split('-').map(Number);
  // Anchor at local noon UTC-shifted by longitude so the result lands on the
  // intended calendar day regardless of timezone.
  const noonUtc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));

  const n = Math.round(julianDay(noonUtc) - 2451545.0 - 0.0009 - -longitude / 360);
  const ds = 0.0009 + -longitude / 360 + n;

  const M = solarMeanAnomaly(ds);
  const L = eclipticLongitude(M);
  const dec = declination(L);

  const jNoon = 2451545.0 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);

  const phi = latitude * RAD;
  // -0.833deg accounts for refraction and the solar disc radius.
  const h0 = -0.833 * RAD;
  const cosOmega =
    (Math.sin(h0) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));

  const toDate = (jd) => new Date((jd - 2440587.5) * 86400000);
  const solarNoon = toDate(jNoon);

  if (cosOmega > 1) return { sunrise: null, sunset: null, solarNoon, polar: 'night' };
  if (cosOmega < -1) return { sunrise: null, sunset: null, solarNoon, polar: 'day' };

  const omega = Math.acos(cosOmega) * DEG;
  const jSet = 2451545.0 + (ds + omega / 360) + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const jRise = jNoon - (jSet - jNoon);

  return { sunrise: toDate(jRise), sunset: toDate(jSet), solarNoon, polar: null };
}

/**
 * Classify an instant as 'day' or 'night' for timelapse profile selection.
 *
 * `offsetMinutes` widens the day window past the geometric event, because
 * usable light and activity both outlast sunrise/sunset.
 *
 * @param {Date} at
 * @param {{sunrise: Date|null, sunset: Date|null, polar: string|null}} times
 * @param {{sunrise?: number, sunset?: number}} offsetMinutes
 * @returns {'day'|'night'}
 */
export function phaseAt(at, times, offsetMinutes = {}) {
  if (times.polar === 'day') return 'day';
  if (times.polar === 'night') return 'night';

  const riseOff = (offsetMinutes.sunrise ?? 0) * 60000;
  const setOff = (offsetMinutes.sunset ?? 0) * 60000;
  const start = times.sunrise.getTime() + riseOff;
  const end = times.sunset.getTime() + setOff;
  const t = at.getTime();
  return t >= start && t < end ? 'day' : 'night';
}

/**
 * Split a list of time-ranged items into day and night buckets.
 * Items spanning the boundary are assigned by their start time; timelapse
 * sampling is coarse enough that splitting mid-item buys nothing.
 */
export function partitionByPhase(items, isoDate, { latitude, longitude, offsetMinutes }) {
  const times = sunTimes(isoDate, latitude, longitude);
  const out = { day: [], night: [] };
  for (const item of items) {
    out[phaseAt(item.start, times, offsetMinutes)].push(item);
  }
  return { ...out, times };
}
