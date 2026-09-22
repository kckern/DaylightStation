const ID = /^[a-z0-9][a-z0-9:._/-]{0,127}$/;
export const FLASHCARD_MODES = Object.freeze(['fsrs', 'word-ladder']);
/** FSRS pacing knobs a word ladder has no use for; accepting them silently would be a lie. */
const FSRS_ONLY = Object.freeze(['newCardLimit', 'masteryPercent', 'minimumReviews']);

/** Validate the durable policy attached to a standalone flashcard assignment. */
export function validateFlashcardEnrollment(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { errors: ['flashcard enrollment must be a mapping'] };
  const deckId = raw.deckId ?? raw.corpusId;
  if (raw.programId !== 'flashcards') errors.push('programId must be flashcards');
  if (typeof deckId !== 'string' || !ID.test(deckId)) errors.push('deckId is required and must be a lowercase content reference');
  if (raw.title !== undefined && (typeof raw.title !== 'string' || !raw.title.trim())) errors.push('title must be a non-empty string when present');
  const policy = raw.policy ?? {};
  let mode = 'fsrs';
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) errors.push('policy must be a mapping');
  else {
    // `mode` lives INSIDE policy: SetAssignments persists only what this
    // validator returns, and policy is what already rides the launch target.
    if (policy.mode !== undefined && !FLASHCARD_MODES.includes(policy.mode)) errors.push('policy.mode must be fsrs or word-ladder');
    else if (policy.mode !== undefined) mode = policy.mode;
    for (const field of ['activeMinutes', 'minimumReviews', 'newCardLimit', 'sessionLimit']) {
      if (policy[field] !== undefined && (!Number.isInteger(policy[field]) || policy[field] < 0)) errors.push(`policy.${field} must be an integer >= 0`);
    }
    if (policy.masteryPercent !== undefined && (!Number.isInteger(policy.masteryPercent) || policy.masteryPercent < 0 || policy.masteryPercent > 100)) errors.push('policy.masteryPercent must be an integer from 0 to 100');
    if (policy.quizRequired !== undefined && typeof policy.quizRequired !== 'boolean') errors.push('policy.quizRequired must be boolean');
    if (policy.quizPassingPercent !== undefined && (!Number.isInteger(policy.quizPassingPercent) || policy.quizPassingPercent < 0 || policy.quizPassingPercent > 100)) errors.push('policy.quizPassingPercent must be an integer from 0 to 100');
    // A deck owns its optional assessment. Keeping a bank id on an assignment
    // made the same study set silently mean different tests for different
    // learners, and coupled card ids to quiz ids in the original design.
    if (policy.linkedQuizBankId !== undefined) errors.push('policy.linkedQuizBankId is no longer supported; set deck.assessment.bankId instead');
    if (mode === 'word-ladder') {
      FSRS_ONLY.filter((field) => policy[field] !== undefined).forEach((field) => errors.push(`policy.${field} is not used by word-ladder`));
    }
  }
  if (errors.length) return { errors };
  return {
    errors: [],
    enrollment: {
      programId: 'flashcards', corpusId: deckId, deckId, policy: { ...policy, mode },
      ...(typeof raw.title === 'string' ? { title: raw.title.trim() } : {}),
    },
  };
}

export default validateFlashcardEnrollment;
