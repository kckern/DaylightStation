/**
 * Heart-rate plausibility — single source of truth for filtering physiologically
 * impossible HR readings out of recorded fitness series.
 *
 * Background: the garage ANT+ bridge pairs to ANY device broadcasting an HR page
 * (wildcard scan), so dying straps and bike sensors can leak a junk reading
 * (e.g. 10/11 BPM from a strap in a drawer) into a session. The bridge now gates
 * 50–230 BPM at ingestion (_extensions/fitness/src/ant.mjs), but the recorders
 * apply their own floor as defense-in-depth for the simulation/BLE paths and in
 * case the bridge regresses.
 *
 * MIN matches the bridge's ANT+ floor (50). MAX is kept lenient (250) on the
 * recording side so a genuine max-effort spike from a child (max HR can exceed
 * 210) is never silently clipped from the saved chart; the bridge's stricter
 * 230 ceiling is the live guard.
 */

export const MIN_PLAUSIBLE_HR = 50;
export const MAX_PLAUSIBLE_HR = 250;

/**
 * Coerce a raw HR value to a clean integer, or null if missing/implausible.
 * @param {*} value
 * @returns {number|null}
 */
export function sanitizeHeartRate(value) {
  if (value == null) return null;
  const hr = Number(value);
  if (!Number.isFinite(hr)) return null;
  if (hr < MIN_PLAUSIBLE_HR || hr > MAX_PLAUSIBLE_HR) return null;
  return Math.round(hr);
}
