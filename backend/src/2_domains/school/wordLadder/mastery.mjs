/**
 * Word record v3 and every transition (mastery redesign §1). Pure: callers pass
 * the study day; nothing reads a clock. Only a quiz grades (rule 1); sorting
 * moves down freely and up only to `claimed` (rule 2); a graded miss lands on
 * `familiar`, never lower and never higher than the word already was (rule 3).
 */
import { ValidationError } from '#domains/core/errors/index.mjs';
import { addDays } from '../termVerdict.mjs';

export const GAPS = Object.freeze([1, 3, 7, 14, 30, 60]);
export const STATES = Object.freeze(['new', 'introduced', 'notYet', 'familiar', 'claimed', 'mastered']);
export const PILES = Object.freeze(['notYet', 'familiar', 'claimed']);
const SOURCES = new Set(['verify', 'recheck', 'paper']);
const GRADED_DEMOTABLE = new Set(['familiar', 'claimed', 'mastered']);

export function emptyWordV3() {
  return {
    state: 'new', stage: null, dueDay: null, missStreak: 0, tricky: false, trickySince: null,
    verifyFailedDay: null, lostMasteredDay: null, notYetCarry: false, introducedDay: null,
    rechecks: 0, lastGraded: null, excluded: false,
  };
}

export function introduce(word, day) {
  return { ...word, state: 'introduced', introducedDay: word.introducedDay ?? day };
}

export function applySort(word, pile, day) {
  if (!PILES.includes(pile)) throw new ValidationError(`unknown pile '${pile}'`);
  if (word.state === 'mastered') {
    if (pile === 'claimed') return word;
    return { ...word, state: pile, stage: null, dueDay: null, lostMasteredDay: day };
  }
  return { ...word, state: pile };
}

function miss(word, day, afterMisses) {
  const missStreak = (word.missStreak ?? 0) + 1;
  const becomesTricky = missStreak >= afterMisses;
  return {
    ...word,
    state: 'familiar', stage: null, dueDay: null, missStreak,
    tricky: word.tricky || becomesTricky,
    trickySince: word.tricky ? word.trickySince : (becomesTricky ? day : null),
  };
}

const passFlags = { missStreak: 0, tricky: false, trickySince: null, notYetCarry: false };

export function applyGraded(word, { source, correct, day, task, settings }) {
  if (!SOURCES.has(source)) throw new ValidationError(`unknown graded source '${source}'`);
  const lastGraded = { day, task, correct: correct === true };
  if (source === 'paper') {
    if (correct === true || !GRADED_DEMOTABLE.has(word.state)) return { ...word, lastGraded };
    const lost = word.state === 'mastered' ? { lostMasteredDay: day } : {};
    return { ...miss(word, day, settings.afterMisses), ...lost, lastGraded };
  }
  if (source === 'verify') {
    if (correct === true) {
      return { ...word, ...passFlags, state: 'mastered', stage: 0, dueDay: addDays(day, GAPS[0]), lastGraded };
    }
    return { ...miss(word, day, settings.afterMisses), verifyFailedDay: day, notYetCarry: false, lastGraded };
  }
  // recheck
  const rechecks = (word.rechecks ?? 0) + 1;
  if (correct === true) {
    const stage = (word.stage ?? 0) + 1;
    const gap = Math.round(GAPS[Math.min(stage, GAPS.length - 1)] * (settings.gapScale ?? 1));
    return { ...word, ...passFlags, state: 'mastered', stage, dueDay: addDays(day, Math.max(1, gap)), rechecks, lastGraded };
  }
  return { ...miss(word, day, settings.afterMisses), lostMasteredDay: day, rechecks, lastGraded };
}

/** A grown-up removed this word from every round, recheck, drill, practice run and quiz (spec §6). */
export function isExcluded(word) {
  return word?.excluded === true;
}

export function isDue(word, day) {
  if (isExcluded(word)) return false;
  return word?.state === 'mastered' && typeof word.dueDay === 'string' && word.dueDay <= day;
}

export function isUnsettled(word) {
  if (!word || isExcluded(word)) return false;
  if (['introduced', 'notYet', 'familiar', 'claimed'].includes(word.state)) return true;
  return word.state === 'mastered' && word.stage === 0;
}
