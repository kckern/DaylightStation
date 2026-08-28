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

/**
 * The timezone is REQUIRED, not defaulted. `studyDate` treats a falsy
 * timezone as "shift by the boundary and format in UTC" — a silent fallback
 * that resets allowances at UTC midnight instead of the household's local
 * 4am, which is precisely the failure D6 exists to prevent. A missing
 * timezone is a configuration bug and must be loud, not a quietly-wrong day.
 */
export function budgetStudyDate(instant, timezone) {
  if (typeof timezone !== 'string' || !timezone.trim()) {
    throw new Error('budgetStudyDate requires a non-empty household timezone (D6: no UTC fallback)');
  }
  return studyDate(instant instanceof Date ? instant : new Date(instant), timezone);
}

export function emptyDay(studyDateStr) {
  return {
    schema: 'piano.game-budget-day/v1',
    studyDate: studyDateStr,
    device: { totalSeconds: 0 },
    learners: {},
    sessions: {},
    // Idempotency ledger for PianoChallenge-earned time. It is compact (one
    // assessment id per credited pass/day) and belongs beside the day balance:
    // retries must not mint a second allowance after a kiosk reload.
    credits: {},
  };
}

const clone = (day) => structuredClone(day);
const secondsBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 1000;

/**
 * `day.sessions[sessionId]` on a plain object keyed straight from
 * client-supplied input (`sessionId` in `applySettle`/`applyClose` arrives
 * verbatim from the URL) is a live prototype-pollution vector:
 * `sessionId = '__proto__'` reads back `Object.prototype` itself — a
 * truthy, non-`undefined` object — which sails straight past a bare
 * `if (!s) throw` check. The mutations immediately following
 * (`s.cumulativeSeconds = ...`, `s.lastSettleAt = ...`) then land directly
 * ON `Object.prototype`: every plain object in the PROCESS inherits a
 * `cumulativeSeconds`/`lastSettleAt` property until the container restarts.
 * `sessionId = 'constructor'`/`'prototype'` are the same class of bug via
 * other inherited/own properties (the `Object` constructor function, its
 * `.prototype`) that are equally truthy and equally not a real session.
 *
 * The fix is OWNERSHIP, not truthiness: `Object.hasOwn` only ever answers
 * about the object's own properties, never anything reached via the
 * prototype chain, so a pollution attempt is indistinguishable from a
 * genuinely unknown session — both correctly hit "unknown session".
 *
 * `openSessionFor` below (used by `applyOpen`'s existing-session scan) is
 * already immune the same way: `Object.entries` only ever walks own
 * enumerable string keys, so it can't be tricked into returning a
 * prototype-chain entry — no change needed there.
 */
function ownSession(sessions, sessionId) {
  return Object.hasOwn(sessions, sessionId) ? sessions[sessionId] : undefined;
}

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
  const s = ownSession(next.sessions, sessionId);
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

/**
 * Close is called from both unmount and depletion, and those two can race —
 * a duplicate close is a normal event on this path, not an error. Closing an
 * already-closed session is therefore idempotent: a no-op that reports zero
 * charge. This is deliberately narrower than applySettle's throw: a bare
 * SETTLE after close is a genuine ordering bug (something kept metering after
 * the session ended) and stays loud; only the second CLOSE is treated as
 * expected.
 */
export function applyClose(day, { sessionId, cumulativeSeconds, at }) {
  const existing = ownSession(day.sessions, sessionId);
  if (!existing) throw new Error('unknown session');
  if (existing.closed) return { day: clone(day), chargedSeconds: 0 };
  const settled = applySettle(day, { sessionId, cumulativeSeconds, at });
  settled.day.sessions[sessionId].closed = true;
  return settled;
}

/**
 * Add earned seconds exactly once for a passed assessment. Assessment ids are
 * globally unique identifiers from the attempt pipeline, so they are safe as
 * the idempotency key across all learners in a study-day record.
 */
export function applyEarnedCredit(day, { assessmentId, learnerId, earnedSeconds, at }) {
  const next = clone(day);
  next.credits ??= {};
  if (Object.hasOwn(next.credits, assessmentId)) {
    return { day: next, duplicate: true, creditedSeconds: 0 };
  }
  next.learners[learnerId] ??= { totalSeconds: 0 };
  next.learners[learnerId].earnedSeconds = (next.learners[learnerId].earnedSeconds ?? 0) + earnedSeconds;
  next.credits[assessmentId] = { learnerId, earnedSeconds, creditedAt: at };
  return { day: next, duplicate: false, creditedSeconds: earnedSeconds };
}

/**
 * A missing dailyMinutes/deviceDailyMinutes is a config bug, not "unlimited
 * play": `undefined * 60` is NaN, `Math.max(0, NaN)` is NaN, and a caller
 * checking `secondsLeft <= 0` would see `NaN <= 0 === false` — the budget
 * gate would never trip. Throwing here instead of defaulting (either
 * direction — unlimited is the bug, and locking a child out over an adult's
 * yaml typo is its own failure) pushes the fix to where it belongs: Task 3's
 * service catches this, logs it loudly, and fails open unmetered per the
 * design's stated posture for gate 3 — visibly, not through a silent NaN.
 */
function requirePositiveMinutes(value, key) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`gameBudget: config.${key} must be a positive number`);
  }
  return value;
}

export function balanceFor(day, config, learnerId) {
  const earned = config.source === 'earned';
  const learnerMinutes = earned
    ? requirePositiveMinutes(config.earned?.maxDailyMinutes, 'earned.maxDailyMinutes')
    : requirePositiveMinutes(config.users?.[learnerId]?.dailyMinutes ?? config.dailyMinutes, 'dailyMinutes');
  const deviceMinutes = requirePositiveMinutes(config.deviceDailyMinutes, 'deviceDailyMinutes');
  const learner = day.learners[learnerId] ?? {};
  const learnerAllowance = earned
    ? Math.min(learnerMinutes * 60, learner.earnedSeconds ?? 0)
    : learnerMinutes * 60;
  const learnerSecondsLeft = Math.max(0,
    learnerAllowance - (learner.totalSeconds ?? 0));
  const deviceSecondsLeft = Math.max(0,
    deviceMinutes * 60 - day.device.totalSeconds);
  return { learnerSecondsLeft, deviceSecondsLeft, secondsLeft: Math.min(learnerSecondsLeft, deviceSecondsLeft) };
}
