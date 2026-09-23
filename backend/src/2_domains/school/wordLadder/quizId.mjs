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

/**
 * `isoWeek` is lowercased before it is embedded: a document id is a kebab-case
 * segment (`documentValidation.mjs`'s `ID_PATTERN` is lowercase-only), so
 * `2026-W39` becomes `2026-w39` in the id while `isoWeekOf` itself keeps
 * returning the display-cased `2026-W39` (also accepted on `--week`).
 */
export function learnerQuizDocumentId({ deckDir, pkg, learnerId, isoWeek }) {
  return `${learnerQuizPrefix({ deckDir, pkg, learnerId })}${String(isoWeek).toLowerCase()}`;
}

/**
 * Parses a per-learner quiz document id under `{deckDir, pkg}` into
 * `{ learnerId, isoWeek }`, or `null` when `docId` isn't a per-learner id for
 * this package at all. SEGMENT-BOUNDED, unlike a raw `startsWith` prefix
 * check: learner `a`'s bare `startsWith` prefix (`…-quiz-a-`) is ALSO a
 * prefix of sibling `a-b`'s doc (`…-quiz-a-b-2026-w39`), which would wrongly
 * accept — or refuse — the wrong learner's sheet. A learnerId may itself
 * contain hyphens, so the split point is anchored on the trailing
 * `YYYY-wWW` week token (always present, always this exact shape), not on
 * the first hyphen after the prefix.
 */
export function parseLearnerQuizId(docId, { deckDir, pkg }) {
  const prefix = `${deckDir}/${pkg}-quiz-`;
  if (typeof docId !== 'string' || !docId.startsWith(prefix)) return null;
  const rest = docId.slice(prefix.length);
  const m = /^(.+)-(\d{4}-w\d{2})$/.exec(rest);
  if (!m) return null;
  return { learnerId: m[1], isoWeek: m[2] };
}
