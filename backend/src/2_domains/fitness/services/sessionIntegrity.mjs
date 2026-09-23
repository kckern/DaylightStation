/**
 * sessionIntegrity — invariants every saved fitness session should satisfy.
 *
 * Checked on every save (both the home-session datastore and the Strava
 * history repository). A failing session is still written — a false positive
 * must never drop a real workout — but it carries an `integrity` stamp that the
 * reconciliation sweep and the sync-health monitor pick up.
 *
 * Why this exists: for months Strava-only sessions were written ~5x too short
 * (sparse HR stream read as per-second) and nothing noticed, because nothing
 * compared the timeline to the duration.
 *
 * @module domains/fitness/services/sessionIntegrity
 */

// A Strava timeline must cover the activity's elapsed time to within this share.
const COVERAGE_TOLERANCE = 0.1;

/**
 * Number of ticks in a stored series: an RLE JSON string ('[130,[131,3]]') or
 * a decoded array. A run is `[value, count]` with an integer count.
 * @returns {number|null} null when the series can't be read
 */
export function seriesLength(stored) {
  let entries = stored;
  if (typeof stored === 'string') {
    try { entries = JSON.parse(stored); } catch { return null; }
  }
  if (!Array.isArray(entries)) return null;
  // Decoded arrays have no runs; stored strings do.
  if (typeof stored !== 'string') return entries.length;
  let n = 0;
  for (const entry of entries) {
    n += Array.isArray(entry) && entry.length === 2 && Number.isInteger(entry[1]) && entry[1] > 0 ? entry[1] : 1;
  }
  return n;
}

function lastValue(stored) {
  let entries = stored;
  if (typeof stored === 'string') {
    try { entries = JSON.parse(stored); } catch { return null; }
  }
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const last = entries[entries.length - 1];
  return Array.isArray(last) && typeof stored === 'string' ? last[0] : last;
}

/**
 * @param {Object} session - session record (stored or hydrated form)
 * @returns {{ok: boolean, violations: Object[]}}
 */
export function checkSessionIntegrity(session) {
  const violations = [];
  const timeline = session?.timeline;
  if (!timeline) return { ok: true, violations };

  const tickCount = Number.isInteger(timeline.tick_count) ? timeline.tick_count : null;
  const interval = timeline.interval_seconds || 5;
  const series = timeline.series || {};

  const duration = session.session?.duration_seconds;
  if (session.session?.source === 'strava' && tickCount != null && duration > 0) {
    const covered = tickCount * interval;
    if (Math.abs(covered - duration) > duration * COVERAGE_TOLERANCE) {
      violations.push({ check: 'coverage', expectedSeconds: duration, coveredSeconds: covered });
    }
  }

  if (tickCount != null) {
    for (const [key, stored] of Object.entries(series)) {
      const length = seriesLength(stored);
      if (length != null && length !== tickCount) {
        violations.push({ check: 'series-length', series: key, length, tickCount });
      }
    }
  }

  const summaryTotal = session.summary?.rings?.total;
  const boxTotal = session.treasureBox?.totalRings;
  const seriesTotal = series['global:rings'] != null ? lastValue(series['global:rings']) : undefined;
  const totals = [summaryTotal, boxTotal, seriesTotal].filter(v => Number.isFinite(v));
  if (totals.length >= 2 && new Set(totals).size > 1) {
    violations.push({ check: 'rings', summary: summaryTotal ?? null, treasureBox: boxTotal ?? null, series: seriesTotal ?? null });
  }

  return { ok: violations.length === 0, violations };
}

/**
 * Return the session with its `integrity` stamp set (on failure) or removed
 * (on success). Does not mutate the input.
 */
export function stampIntegrity(session, now) {
  if (!session || typeof session !== 'object') return session;
  const { integrity: _previous, ...rest } = session;
  const result = checkSessionIntegrity(rest);
  if (result.ok) return rest;
  return { ...rest, integrity: { ok: false, checkedAt: now.toISOString(), violations: result.violations } };
}
