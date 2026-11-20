/**
 * The see-and-type card variety (lexicon header `cards: see-and-type`).
 *
 * One card, everywhere: the target on screen, its audio played on show when
 * the entry has some, and the learner types it. Built for learning a script
 * and its keyboard (Hangul jamo, then syllables) before any vocabulary.
 *
 * A round is Learn › Quiz. Learn is the copy (ungraded, retry until it
 * matches; it is also the introduction — there is no flash card). The quiz
 * and every recheck are the same card graded on the first attempt (task K.1,
 * exact under the script's normalize, no judge). There is no sort stream, no
 * match, no choices, no dictation, no anchor side and no tricky-word drill.
 *
 * Mastery: a K.1 verify pass is Recognised (mastered stage 0); the first K.1
 * recheck pass signs the card off (Mastered). K.1 is a sign-off task like
 * 3.3 / 1.4 (`SIGN_OFF_TASKS` in mastery.mjs), so a recheck miss keeps the
 * card mastered at stage 1, due the next study day.
 */
export const SEE_AND_TYPE = 'see-and-type';
export const CARD_VARIETIES = Object.freeze(['standard', SEE_AND_TYPE]);
export const SEE_AND_TYPE_TASK = 'K.1';
/** Write (copy, with help) and Quiz me (K.1). Nothing that needs an anchor side. */
export const SEE_AND_TYPE_PRACTICE_MODES = Object.freeze(['write', 'quiz']);

export function isSeeAndType(lexicon) {
  return lexicon?.cards === SEE_AND_TYPE;
}
