/**
 * Pure math for the piano game-time budget (design 2026-08-27, D1/D4/D6).
 *
 * A day record is the LAYER-2 SOURCE OF TRUTH (D3/D15): per-learner seconds,
 * the device-wide total, and every metering session, bucketed on the household
 * STUDY day — the same 4am-boundary local day School uses, because a UTC reset
 * would hand back allowances mid-afternoon (D6).
 *
 * Settles are hold-and-settle with a cumulative high-water mark (D4): the
 * client always sends the running total since open, and the charge is the part
 * of that total not yet recorded. A retry re-sends a total the record already
 * holds and charges zero; a client that restarted at zero sends totals BELOW
 * the mark and charges zero until it climbs back past it — which is why open
 * hands the mark back to the client to seed from (the under-charging fix).
 *
 * Learner and device totals move in the same applySettle call on the same
 * record, so the two cannot drift (design: "one transaction").
 */
import { studyDate } from '#domains/school/timing.mjs';

export function budgetStudyDate(instant, timezone = null) {
  return studyDate(instant instanceof Date ? instant : new Date(instant), timezone);
}

export function emptyDay(studyDateStr) {
  return {
    schema: 'piano.game-budget-day/v1',
    studyDate: studyDateStr,
    device: { totalSeconds: 0 },
    learners: {},
    sessions: {},
  };
}

const clone = (day) => structuredClone(day);
const secondsBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 1000;

function openSessionFor(day, learnerId) {
  return Object.entries(day.sessions).find(
    ([, s]) => s.learnerId === learnerId && !s.closed,
  ) ?? null;
}

/**
 * One open session per learner (double-spend guard). A lingering session from
 * a kiosk crash is ADOPTED while fresh — the client resumes its cumulative —
 * and closed-then-replaced once stale, so play is never silently unmetered
 * (design metering §additions 1–2).
 */
export function applyOpen(day, { sessionId, learnerId, deviceId, at, staleAfterSeconds }) {
  const next = clone(day);
  const existing = openSessionFor(next, learnerId);
  if (existing) {
    const [existingId, s] = existing;
    const idleFor = secondsBetween(s.lastSettleAt ?? s.openedAt, at);
    if (idleFor < staleAfterSeconds) {
      return { day: next, sessionId: existingId, cumulativeSeconds: s.cumulativeSeconds, adopted: true };
    }
    // Stale: its high-water is already charged; just seal it.
    s.closed = true;
  }
  next.sessions[sessionId] = {
    learnerId, deviceId, openedAt: at, lastSettleAt: at, cumulativeSeconds: 0, closed: false,
  };
  if (!next.learners[learnerId]) next.learners[learnerId] = { totalSeconds: 0 };
  return { day: next, sessionId, cumulativeSeconds: 0, adopted: false };
}

export function applySettle(day, { sessionId, cumulativeSeconds, at }) {
  const next = clone(day);
  const s = next.sessions[sessionId];
  if (!s) throw new Error('unknown session');
  if (s.closed) throw new Error('session closed');
  const charged = Math.max(0, cumulativeSeconds - s.cumulativeSeconds);
  s.cumulativeSeconds = Math.max(s.cumulativeSeconds, cumulativeSeconds);
  s.lastSettleAt = at;
  if (charged > 0) {
    next.learners[s.learnerId] ??= { totalSeconds: 0 };
    next.learners[s.learnerId].totalSeconds += charged;
    next.device.totalSeconds += charged;
  }
  return { day: next, chargedSeconds: charged };
}

export function applyClose(day, { sessionId, cumulativeSeconds, at }) {
  const settled = applySettle(day, { sessionId, cumulativeSeconds, at });
  settled.day.sessions[sessionId].closed = true;
  return settled;
}

export function balanceFor(day, config, learnerId) {
  const learnerMinutes = config.users?.[learnerId]?.dailyMinutes ?? config.dailyMinutes;
  const learnerSecondsLeft = Math.max(0,
    learnerMinutes * 60 - (day.learners[learnerId]?.totalSeconds ?? 0));
  const deviceSecondsLeft = Math.max(0,
    config.deviceDailyMinutes * 60 - day.device.totalSeconds);
  return { learnerSecondsLeft, deviceSecondsLeft, secondsLeft: Math.min(learnerSecondsLeft, deviceSecondsLeft) };
}
