/**
 * Per-word status ladder (design "State machine"). Pure: every function takes
 * the study day and instant from its caller and returns a NEW word record.
 *
 *   NEW ──seen──► LEARNING ──"I know it"──► CLAIMED ──scheduled pass──► KNOWN
 *
 * Only a SCHEDULED check (CLAIMED from an earlier day, or KNOWN due today)
 * promotes. Review-quiz and paper passes are logged and change nothing. Any
 * miss, from any source, drops the word to LEARNING at step 0.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';
import { addDays } from '../termVerdict.mjs';

export const STATUS_SCHEMA = 'school.word-ladder-status/v1';
export const CHECK_GAPS = Object.freeze([3, 7, 14, 30]);
export const MAX_STEP = CHECK_GAPS.length - 1;
export const CHECK_PHASES = Object.freeze(['check', 'review', 'paper']);
const MISS_EVENT = Object.freeze({ check: 'check-miss', review: 'check-miss', paper: 'quiz-miss' });

export function emptyStatus() {
  return { schema: STATUS_SCHEMA, words: {}, paperAttemptsFolded: [], lastFoldedDay: null, days: {}, sessions: {} };
}

export function emptyWord() {
  return { state: 'new', step: 0, claimedDay: null, nextCheckDay: null, history: [] };
}

export function readWord(status, wordId) {
  const word = status?.words?.[wordId];
  return word ? structuredClone(word) : emptyWord();
}

export function isScheduledCheck(word, today) {
  if (word?.state === 'claimed') return typeof word.claimedDay === 'string' && word.claimedDay < today;
  if (word?.state === 'known') return typeof word.nextCheckDay === 'string' && word.nextCheckDay <= today;
  return false;
}

const withEvent = (word, event) => ({ ...word, history: [...(word.history ?? []), event] });

export function applyStudy(word, { at, day, recording, reason = null, take = null }) {
  if (!['taken', 'unavailable'].includes(recording)) throw new ValidationError(`unknown recording outcome '${recording}'`);
  const next = word.state === 'new' ? { ...word, state: 'learning' } : { ...word };
  return withEvent(next, {
    at, day, event: 'study', recording,
    ...(reason ? { reason } : {}),
    ...(take != null ? { take } : {}),
  });
}

export function applyMark(word, { at, day, mark }) {
  if (mark === 'know') {
    return withEvent({ ...word, state: 'claimed', step: 0, claimedDay: day, nextCheckDay: null }, { at, day, event: 'claim' });
  }
  if (mark === 'learning') {
    return withEvent({ ...word, state: 'learning', step: 0, claimedDay: null, nextCheckDay: null }, { at, day, event: 'still-learning' });
  }
  throw new ValidationError(`unknown mark '${mark}'`);
}

export function applyCheck(word, { at, day, correct, phase, direction = null, attemptId = null }) {
  if (!CHECK_PHASES.includes(phase)) throw new ValidationError(`unknown check phase '${phase}'`);
  const detail = { phase, ...(direction ? { direction } : {}), ...(attemptId ? { attemptId } : {}) };
  if (correct !== true) {
    return withEvent(
      { ...word, state: 'learning', step: 0, claimedDay: null, nextCheckDay: null },
      { at, day, event: MISS_EVENT[phase], ...detail },
    );
  }
  if (phase === 'paper') return withEvent({ ...word }, { at, day, event: 'quiz-pass', ...detail });
  if (phase === 'check' && isScheduledCheck(word, day)) {
    const step = word.state === 'claimed' ? 0 : Math.min((word.step ?? 0) + 1, MAX_STEP);
    return withEvent(
      { ...word, state: 'known', step, claimedDay: null, nextCheckDay: addDays(day, CHECK_GAPS[step]) },
      { at, day, event: 'check-pass', ...detail },
    );
  }
  return withEvent({ ...word }, { at, day, event: 'check-pass-early', ...detail });
}

/** Review run (rev 3): a card looked at after the day is done. Evidence only. */
export function applyReviewView(word, { at, day }) {
  return withEvent({ ...word }, { at, day, event: 'review' });
}
