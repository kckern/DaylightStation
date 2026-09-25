// Home fitness sessions as exercise credit.
//
// The workout ledger (Strava, else the Garmin daily rollup) only knows about a
// workout once the watch has uploaded it and the harvester has run. A session
// recorded by the home Fitness app — say a group game-cycling ride with no
// watch activity — would never reach the budget at all, and a watch workout is
// invisible for the hour or so before Strava catches up.
//
// So every home session the user took part in is also a candidate workout. It
// is added ONLY when no ledger row already covers it: a row linked to it by
// `homeSessionId`, a Strava activity it names by `stravaActivityId`, or a row
// whose clock window overlaps it. Once Strava catches up and the enrichment
// links the activity, the ledger row wins and the estimate drops out.
//
// Calories come from the participant's average heart rate over the session
// (Keytel, the same estimator the reconciliation uses for HR-only workouts) and
// are flagged `estimated: true` so the UI can say so.
import { CalorieReconciliationService } from '#domains/health/services/CalorieReconciliationService.mjs';

const LBS_TO_KG = 0.45359237;

// "01:20 pm" → minutes since midnight; null when unparseable.
export const clockMinutes = (text) => {
  const m = /^(\d{1,2}):(\d{2})\s*([ap])m$/i.exec(String(text || '').trim());
  if (!m) return null;
  const hour = (Number(m[1]) % 12) + (m[3].toLowerCase() === 'p' ? 12 : 0);
  return hour * 60 + Number(m[2]);
};

// Epoch ms → the ledger's "hh:mm am" in the session's own timezone.
export const clockLabel = (ms, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || 'UTC', hour: '2-digit', minute: '2-digit', hour12: true,
  }).formatToParts(new Date(ms));
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return `${get('hour')}:${get('minute')} ${get('dayPeriod').toLowerCase()}`;
};

const overlaps = (a, b) => a.start < b.end && b.start < a.end;

/**
 * @param {Object[]} rows - the day's ledger workouts (already one source)
 * @param {Object[]} homeSessions - this user's home sessions for the day, as
 *   YamlHealthDatastore returns them: { sessionId, segmentIds, startTime (ms),
 *   durationMs, timezone, title, stravaActivityId, avgHeartrate }
 * @param {{ weightLbs?: number, ageYears?: number, sex?: string }} body
 * @returns {Object[]} rows plus one estimated row per uncovered home session
 */
export function mergeHomeSessions(rows, homeSessions, body = {}) {
  const ledger = Array.isArray(rows) ? rows : [];
  const home = Array.isArray(homeSessions) ? homeSessions : [];
  if (!home.length) return ledger;

  const linked = new Set(ledger.map((r) => r?.homeSessionId).filter(Boolean).map(String));
  const ledgerIds = new Set(ledger.map((r) => r?.id).filter((id) => id != null).map(String));
  const windows = ledger.map((r) => {
    const start = clockMinutes(r?.startTime);
    const minutes = Number(r?.minutes ?? r?.duration_min);
    return start == null || !(minutes > 0) ? null : { start, end: start + minutes };
  }).filter(Boolean);

  const weightKg = Number(body.weightLbs) * LBS_TO_KG;
  const out = [...ledger];
  for (const s of home) {
    if (!s?.sessionId || !Number.isFinite(Number(s.startTime))) continue;
    const ids = [s.sessionId, ...(s.segmentIds || [])].map(String);
    if (ids.some((id) => linked.has(id))) continue;
    if (s.stravaActivityId != null && ledgerIds.has(String(s.stravaActivityId))) continue;

    const startTime = clockLabel(Number(s.startTime), s.timezone);
    const minutes = Math.round((Number(s.durationMs) || 0) / 600) / 100;
    const start = clockMinutes(startTime);
    if (start != null && windows.some((w) => overlaps(w, { start, end: start + minutes }))) continue;

    const avgHeartrate = Number(s.avgHeartrate) > 0 ? Number(s.avgHeartrate) : null;
    const calories = avgHeartrate && Number.isFinite(weightKg)
      ? CalorieReconciliationService.estimateCaloriesFromHR(
        avgHeartrate, minutes, weightKg,
        Number.isFinite(Number(body.ageYears)) ? Number(body.ageYears) : undefined,
        body.sex === 'female' ? 'female' : 'male')
      : 0;
    out.push({
      id: `home-${s.sessionId}`,
      source: 'home',
      estimated: true,
      homeSessionId: String(s.sessionId),
      title: s.title || 'Home workout',
      type: 'Workout',
      startTime,
      minutes,
      avgHeartrate,
      calories,
    });
  }
  return out;
}
