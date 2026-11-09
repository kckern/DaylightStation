/**
 * The one "is this saved session junk?" rule, shared by the browser save gate
 * and the server history list.
 *
 * Junk = a strap that showed a few seconds of heart rate and then nothing else:
 * under a minute of HR readings in total, no timeline events (media, challenges,
 * zones, memos…), no rings, no strength runs, and no equipment series that ever
 * moved. Seen 2026-11-07/08: a stray guest strap (#2747) gave 15–20s of HR, went
 * silent, and a 4-minute empty session was saved and listed in history.
 *
 * Deliberately conservative — any single sign of a real workout clears it,
 * including a link to an outside record (Strava imports carry no series at all).
 */

/** One minute of readings at the 5s tick. Below this, HR is a strap flap, not a workout. */
export const MIN_HR_READINGS = 12;

const HR_SERIES = /:(hr|heart_rate|heart-rate)$/;

/** Series arrive decoded (browser), as RLE arrays, or as RLE JSON strings (YAML). */
function toEntries(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Positive readings in a series, honouring RLE `[value, count]` runs. */
function positiveReadings(value) {
  let count = 0;
  for (const entry of toEntries(value)) {
    if (Array.isArray(entry)) {
      const [v, n] = entry;
      if (Number(v) > 0 && Number(n) > 0) count += Number(n);
    } else if (Number(entry) > 0) {
      count += 1;
    }
  }
  return count;
}

/** Distinct positive values — a sensor that held one stale value never moved. */
function distinctPositiveValues(value) {
  const seen = new Set();
  for (const entry of toEntries(value)) {
    const v = Array.isArray(entry) ? entry[0] : entry;
    if (Number(v) > 0) seen.add(Number(v));
  }
  return seen.size;
}

/** Most HR readings held by any one HR series. */
export function countHrReadings(series = {}) {
  let best = 0;
  for (const [key, value] of Object.entries(series || {})) {
    if (HR_SERIES.test(key)) best = Math.max(best, positiveReadings(value));
  }
  return best;
}

/**
 * @param {Object} session
 * @param {Object} [session.series]      timeline series (any encoding)
 * @param {Array}  [session.events]      timeline events
 * @param {Array}  [session.voiceMemos]
 * @param {number} [session.totalRings]
 * @param {Array}  [session.strengthRuns]
 * @param {boolean} [session.external]  linked to an outside record (e.g. Strava)
 * @returns {{ junk: boolean, reason: string, hrReadings: number }}
 */
export function evaluateJunkSession({ series = {}, events = [], voiceMemos = [], totalRings = 0, strengthRuns = [], external = false } = {}) {
  const hrReadings = countHrReadings(series);
  const verdict = (junk, reason) => ({ junk, reason, hrReadings });
  if (external) return verdict(false, 'external');
  if (hrReadings >= MIN_HR_READINGS) return verdict(false, 'hr');
  if ((events?.length || 0) > 0) return verdict(false, 'events');
  if ((voiceMemos?.length || 0) > 0) return verdict(false, 'voice-memos');
  if (Number(totalRings) > 0) return verdict(false, 'rings');
  if ((strengthRuns?.length || 0) > 0) return verdict(false, 'strength');
  const equipmentMoved = Object.entries(series || {})
    .some(([key, value]) => !HR_SERIES.test(key) && distinctPositiveValues(value) >= 2);
  if (equipmentMoved) return verdict(false, 'equipment');
  return verdict(true, 'no-activity');
}

/** The same rule over a persisted session document (YAML shape). */
export function evaluateJunkSessionRecord(data = {}) {
  const timelineEvents = Array.isArray(data.timeline?.events) ? data.timeline.events : [];
  const rootEvents = Array.isArray(data.events) ? data.events : [];
  return evaluateJunkSession({
    series: data.timeline?.series || {},
    events: [...timelineEvents, ...rootEvents],
    voiceMemos: data.summary?.voiceMemos || [],
    totalRings: data.summary?.rings?.total ?? data.treasureBox?.totalRings ?? 0,
    strengthRuns: data.strength?.runs || [],
    external: !!(data.strava || data.session?.source
      || Object.values(data.participants || {}).some(p => p?.strava)),
  });
}
