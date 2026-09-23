/**
 * The deterministic half of the typed-answer judge (spec §2 steps 1–6). A
 * mastery test, not a spelling test: bands count wrong KEYSTROKES, short words
 * forgive one, a real other word is never a misspelling.
 */
import { editDistance } from '#domains/school/language/transcription.mjs';
import { hasHangul, keystrokeJamo, normalizeAnswer } from './jamo.mjs';

export const BANDS = Object.freeze([10, 8, 6, 4, 2]);

function band(distance, length) {
  if (distance === 0) return 10;
  if (length <= 4) return distance === 1 ? 6 : 2;
  const ratio = distance / length;
  if (ratio <= 0.10) return 8;
  if (ratio <= 0.20) return 6;
  if (ratio <= 1 / 3) return 4;
  return 2;
}

export function scoreTypedDeterministic({ target, typed, otherWords = [] }) {
  const want = normalizeAnswer(target);
  const got = normalizeAnswer(typed);
  const length = keystrokeJamo(want).length;
  if (got === want) return { score: 10, judge: 'exact', distance: 0, length };
  if (!hasHangul(got)) return { score: 1, judge: 'no-hangul', distance: null, length };
  const others = new Set(otherWords.map(normalizeAnswer).filter((word) => word && word !== want));
  if (others.has(got)) return { score: 2, judge: 'guard', distance: null, length };
  const distance = editDistance(keystrokeJamo(got).join(''), keystrokeJamo(want).join(''));
  return { score: band(distance, length), judge: 'distance', distance, length };
}

export function isShortTarget(target) {
  return [...normalizeAnswer(target)].length <= 2;
}

export function modelMayRaise({ score, distance, length }) {
  return score >= 4 && score < 10 && distance != null && length > 0 && distance / length <= 1 / 3;
}

export function raiseOneBand(score) {
  const index = BANDS.indexOf(score);
  return index > 0 ? BANDS[index - 1] : score;
}
