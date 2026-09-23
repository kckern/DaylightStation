/**
 * Word record v3 and every transition (mastery redesign §1). Pure: callers pass
 * the study day; nothing reads a clock. Only a quiz grades (rule 1); sorting
 * moves down freely and up only to `claimed` (rule 2); a graded miss lands on
 * `familiar`, never lower and never higher than the word already was (rule 3).
 *
 * Ruling 2026-09-23 (owner): typing from memory is the final sign-off only —
 * recognition → claim → match → typed sign-off. Verify and the first recheck
 * are recognition (2.2 / 3.1) and each pass counts in `recognizedCount`; a
 * guided or practice match sets `matched`; only a word recognised twice,
 * claimed-and-verified (`mastered`), matched and at stage ≥ 1 is given a typed
 * recheck (3.3, or 1.4 dictation), and a typed pass stamps `typedSignedOff`.
 * Recording is practice only, never a quiz or a prerequisite.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';
import { addDays } from '../termVerdict.mjs';

export const GAPS = Object.freeze([1, 3, 7, 14, 30, 60]);
export const STATES = Object.freeze(['new', 'introduced', 'notYet', 'familiar', 'claimed', 'mastered']);
export const PILES = Object.freeze(['notYet', 'familiar', 'claimed']);
const SOURCES = new Set(['verify', 'recheck', 'paper']);
const GRADED_DEMOTABLE = new Set(['familiar', 'claimed', 'mastered']);
/** Graded tasks that ask the child to type the word with no model: the sign-off. */
export const TYPED_TASKS = Object.freeze(['3.3', '1.4']);
const isTypedTask = (task) => TYPED_TASKS.includes(task);

export function emptyWordV3() {
  return {
    state: 'new', stage: null, dueDay: null, missStreak: 0, tricky: false, trickySince: null,
    verifyFailedDay: null, lostMasteredDay: null, notYetCarry: false, introducedDay: null,
    rechecks: 0, lastGraded: null, excluded: false,
    recognizedCount: 0, matched: false, typedSignedOff: null,
  };
}

/**
 * The typed sign-off's prerequisites (ruling 2026-09-23): recognised at least
 * twice (the round quiz plus the first recheck), claimed-and-verified (the
 * word is `mastered`), matched, at its 2nd-or-later recheck (stage ≥ 1), and
 * not straight after a typed miss — that word is owed one recognition first.
 */
export function readyForSignOff(word) {
  if (word?.state !== 'mastered' || (word.stage ?? 0) < 1) return false;
  if ((word.recognizedCount ?? 0) < 2 || word.matched !== true) return false;
  return !typedLapse(word);
}

function typedLapse(word) {
  return isTypedTask(word?.lastGraded?.task) && word.lastGraded.correct === false;
}

/**
 * What a grown-up or child reads for a word: `mastered` means signed off by a
 * typed recheck; a verified word not yet signed off is `recognised`.
 */
export function ladderLevel(word) {
  const state = word?.state ?? 'new';
  if (state === 'new' || state === 'introduced') return state;
  if (state === 'mastered') return word.typedSignedOff ? 'mastered' : 'recognised';
  return 'learning';
}

/** Every word in a finished match (guided or practice) is matched. */
export function markMatched(word) {
  return word.matched === true ? word : { ...word, matched: true };
}

export function introduce(word, day) {
  return { ...word, state: 'introduced', introducedDay: word.introducedDay ?? day };
}

export function applySort(word, pile, day) {
  if (!PILES.includes(pile)) throw new ValidationError(`unknown pile '${pile}'`);
  if (word.state === 'mastered') {
    if (pile === 'claimed') return word;
    return { ...word, state: pile, stage: null, dueDay: null, lostMasteredDay: day, typedSignedOff: null };
  }
  return { ...word, state: pile };
}

function miss(word, day, afterMisses) {
  const missStreak = (word.missStreak ?? 0) + 1;
  const becomesTricky = missStreak >= afterMisses;
  return {
    ...word,
    state: 'familiar', stage: null, dueDay: null, missStreak, typedSignedOff: null,
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
  // A word reset to new mid-round can still be quizzed in that round; it
  // counts as introduced the day it was graded, or a miss is never carried.
  word = { ...word, introducedDay: word.introducedDay ?? day };
  const recognizedCount = (word.recognizedCount ?? 0) + (correct === true && !isTypedTask(task) ? 1 : 0);
  if (source === 'verify') {
    if (correct === true) {
      return { ...word, ...passFlags, state: 'mastered', stage: 0, dueDay: addDays(day, GAPS[0]), recognizedCount, lastGraded };
    }
    return { ...miss(word, day, settings.afterMisses), verifyFailedDay: day, notYetCarry: false, lastGraded };
  }
  // recheck
  const rechecks = (word.rechecks ?? 0) + 1;
  if (isTypedTask(task)) {
    if (correct === true) {
      const stage = (word.stage ?? 0) + 1;
      const gap = Math.round(GAPS[Math.min(stage, GAPS.length - 1)] * (settings.gapScale ?? 1));
      return {
        ...word, ...passFlags, state: 'mastered', stage, dueDay: addDays(day, Math.max(1, gap)), rechecks,
        typedSignedOff: word.typedSignedOff ?? day, lastGraded,
      };
    }
    // A typed miss drops the word back to recognition rechecks (ruling
    // 2026-09-23): still mastered (recognised), stage 1, due the next study
    // day, sign-off withdrawn. The miss counts toward tricky like any other.
    const missStreak = (word.missStreak ?? 0) + 1;
    const becomesTricky = missStreak >= settings.afterMisses;
    return {
      ...word, state: 'mastered', stage: 1, dueDay: addDays(day, GAPS[0]), missStreak, rechecks,
      tricky: word.tricky || becomesTricky,
      trickySince: word.tricky ? word.trickySince : (becomesTricky ? day : null),
      typedSignedOff: null, ...(word.typedSignedOff ? { lostMasteredDay: day } : {}), lastGraded,
    };
  }
  if (correct === true && typedLapse(word)) {
    // The recognition owed after a typed miss: the typed sign-off comes back
    // the next study day rather than climbing the gaps on a recognition pass.
    return { ...word, ...passFlags, state: 'mastered', dueDay: addDays(day, GAPS[0]), rechecks, recognizedCount, lastGraded };
  }
  if (correct === true) {
    const stage = (word.stage ?? 0) + 1;
    const gap = Math.round(GAPS[Math.min(stage, GAPS.length - 1)] * (settings.gapScale ?? 1));
    return { ...word, ...passFlags, state: 'mastered', stage, dueDay: addDays(day, Math.max(1, gap)), rechecks, recognizedCount, lastGraded };
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
