/**
 * The deterministic half of the typed-answer judge (spec §2 steps 1–6). A
 * mastery test, not a spelling test: bands count wrong units (keystrokes for
 * Hangul, letters for Latin, graphemes otherwise), short words forgive one, a
 * real other word is never a misspelling, and a wrong number is a different
 * answer. Script-specific behaviour comes from `scriptRules.mjs`.
 */
import { editDistance } from '#domains/school/language/transcription.mjs';
import { numbersMatch, ruleForTarget } from './scriptRules.mjs';

export const BANDS = Object.freeze([10, 8, 6, 4, 2]);
/** Latin: equal once accents are stripped, different with them — a small slip. */
export const ACCENT_SLIP_SCORE = 8;

function band(distance, length) {
  if (distance === 0) return 10;
  if (length <= 4) return distance === 1 ? 6 : 2;
  const ratio = distance / length;
  if (ratio <= 0.10) return 8;
  if (ratio <= 0.20) return 6;
  if (ratio <= 1 / 3) return 4;
  return 2;
}

/**
 * `target` is the target side's text; `targetScript` its script (`scriptFor`
 * the lexicon's target language). Without one, the script is read off the
 * target text itself. Order: exact → wrong script → other real word →
 * numbers → accent slip → distance bands.
 */
export function scoreTypedDeterministic({ target, typed, otherWords = [], targetScript = null }) {
  const rule = ruleForTarget(target, targetScript);
  const want = rule.normalize(target);
  const got = rule.normalize(typed);
  const length = rule.units(want).length;
  if (got === want) return { score: 10, judge: 'exact', distance: 0, length };
  // The floor applies only when the target itself has letters of its script (a bare "1776" has none).
  if (rule.isOfScript(want) && !rule.isOfScript(got)) return { score: 1, judge: 'wrong-script', distance: null, length };
  const others = new Set(otherWords.map((word) => rule.normalize(word)).filter((word) => word && word !== want));
  if (others.has(got)) return { score: 2, judge: 'guard', distance: null, length };
  if (!numbersMatch(want, got)) return { score: 2, judge: 'number', distance: null, length };
  if (rule.fold && rule.fold(got) === rule.fold(want)) return { score: ACCENT_SLIP_SCORE, judge: 'accent', distance: 0, length };
  const distance = editDistance(rule.units(got), rule.units(want));
  return { score: band(distance, length), judge: 'distance', distance, length };
}

/** ≤ 2 units (Hangul syllables, Han/kana characters, graphemes) is judged deterministically. */
export function isShortTarget(target, targetScript = null) {
  return ruleForTarget(target, targetScript).short(target).length <= 2;
}

export function modelMayRaise({ score, distance, length }) {
  return score >= 4 && score < 10 && distance != null && length > 0 && distance / length <= 1 / 3;
}

export function raiseOneBand(score) {
  const index = BANDS.indexOf(score);
  return index > 0 ? BANDS[index - 1] : score;
}
