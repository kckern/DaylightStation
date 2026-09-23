/**
 * The printed word-ladder quiz's document id. Two shapes, one naming rule
 * shared by the paper fold (which matches scanned `bankId`s) and the quiz
 * sources that print the documents:
 *  - the legacy per-deck quiz (`quizDocumentIdFor`) — every deck sharing a
 *    lexicon keeps folding these, forever.
 *  - the per-learner weekly quiz (`learnerQuizDocumentId`, spec §8 Printed
 *    quiz), whose accept prefix (`learnerQuizPrefix` WITH a learnerId) names
 *    the learner it folds into, and whose bare prefix (no learnerId) is what
 *    the fold uses to REFUSE a sibling's sheet.
 */
export function quizDocumentIdFor(deckId) {
  return `${deckId}-quiz`;
}

/** The directory part of a deck id: 'language/korean/week-01' -> 'language/korean'. */
export function deckDirOf(deckId) {
  return String(deckId).split('/').slice(0, -1).join('/');
}

/** ISO-8601 week ('YYYY-Www') for a 'YYYY-MM-DD' study day. Pure UTC arithmetic, no clock. */
export function isoWeekOf(day) {
  const date = new Date(`${day}T00:00:00.000Z`);
  const isoWeekday = date.getUTCDay() || 7; // Monday = 1 .. Sunday = 7
  date.setUTCDate(date.getUTCDate() + 4 - isoWeekday); // the ISO year is the one owning this week's Thursday
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** The per-learner quiz prefix: with no `learnerId` it is the bare prefix the fold refuses on a mismatch. */
export function learnerQuizPrefix({ deckDir, pkg, learnerId = '' }) {
  return `${deckDir}/${pkg}-quiz-${learnerId ? `${learnerId}-` : ''}`;
}

export function learnerQuizDocumentId({ deckDir, pkg, learnerId, isoWeek }) {
  return `${learnerQuizPrefix({ deckDir, pkg, learnerId })}${isoWeek}`;
}
