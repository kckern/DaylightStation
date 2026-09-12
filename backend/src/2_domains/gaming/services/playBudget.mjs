import { ValidationError } from '#domains/core/errors/index.mjs';

/**
 * How much play time is left, and when to say something about it.
 *
 * Pure: no clock, no I/O. Given what was played and what was granted, it
 * answers what remains and which warning — if any — is newly due.
 *
 * The ladder exists because ending a session destroys unsaved progress. There is
 * no way to make an emulator save from outside, so the warning IS the
 * mitigation, not a courtesy: a child must be told early enough to save. The
 * default rungs give five minutes, then one, then twenty seconds — spaced so the
 * first is actionable and the last is unmissable.
 *
 * Each rung fires at most once. Warnings are identified by their threshold, so a
 * caller that records which have fired can survive a restart without either
 * repeating itself or going quiet.
 */

export const DEFAULT_WARNING_LADDER_MS = Object.freeze([300_000, 60_000, 20_000]);

/** An unlimited grant — an admin session — is a grant with no ceiling. */
export const UNLIMITED = null;

/**
 * @param {Object} input
 * @param {number} input.playedMs
 * @param {number|null} input.grantedMs  null means unlimited.
 * @param {number[]} [input.warnedMs]    Thresholds already announced.
 * @param {number[]} [input.ladderMs]
 * @returns {{remainingMs: number|null, expired: boolean, dueWarningMs: number|null, unlimited: boolean}}
 */
export function assessBudget({
  playedMs, grantedMs, warnedMs = [], ladderMs = DEFAULT_WARNING_LADDER_MS,
}) {
  if (!Number.isFinite(playedMs) || playedMs < 0) {
    throw new ValidationError('playedMs must be a non-negative number', {
      code: 'INVALID_PLAYED_MS', field: 'playedMs', value: playedMs,
    });
  }
  if (grantedMs === UNLIMITED || grantedMs === undefined) {
    // Nothing to count down, nothing to warn about, nothing to expire.
    return { remainingMs: null, expired: false, dueWarningMs: null, unlimited: true };
  }
  if (!Number.isFinite(grantedMs) || grantedMs < 0) {
    throw new ValidationError('grantedMs must be a non-negative number or null', {
      code: 'INVALID_GRANTED_MS', field: 'grantedMs', value: grantedMs,
    });
  }

  const remainingMs = Math.max(0, grantedMs - playedMs);
  const expired = remainingMs <= 0;
  const already = new Set(warnedMs);

  // The lowest un-fired rung at or above the time remaining. Taking the LOWEST
  // matters when several rungs are crossed at once — after a long blind spot, a
  // child should hear "twenty seconds", not "five minutes".
  let dueWarningMs = null;
  if (!expired) {
    for (const rung of [...ladderMs].sort((a, b) => a - b)) {
      if (remainingMs <= rung && !already.has(rung)) { dueWarningMs = rung; break; }
    }
  }

  return { remainingMs, expired, dueWarningMs, unlimited: false };
}

/** Human phrasing for a warning rung, for speech and for the overlay. */
export function describeRemaining(ms) {
  const seconds = Math.round(ms / 1000);
  if (seconds >= 120) return `${Math.round(seconds / 60)} minutes`;
  if (seconds >= 60) return '1 minute';
  return `${seconds} seconds`;
}
