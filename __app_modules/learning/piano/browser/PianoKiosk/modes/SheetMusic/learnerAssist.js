/**
 * learnerAssist — per-learner help on the Learn drill (`sheetmusic.learners.<id>`).
 *
 * Learn is a READING surface: by default the drill keyboard lights a key only
 * after a wrong note (`after-wrong`), the Silver check lights nothing, and a
 * wrong note flashes the owed notehead without saying what was played. That is
 * right for a child who reads. A child who is just starting does not know where
 * a printed note lives on the keys yet, and needs to see both at once.
 *
 *   sheetmusic:
 *     learners:
 *       <user id>:
 *         collection: files:docs/sheet-music/<folder>  # their track: the score grid opens on this tab
 *         keyboardHints: always                         # light the next key on every take, the check included
 *         wrongNoteGhosts: true                         # a translucent notehead on the staff at the wrong pitch
 *
 * The rhythm step stays dark whatever is set: it is pitch-free, so there is no
 * key to light. A learner without an entry gets exactly today's behaviour.
 */

const HINTS = new Set(['always', 'after-wrong', 'never']);

/** The learner's entry, by trimmed, case-folded id; null when they have none. */
function entryFor(learners, userId) {
  if (!learners || typeof learners !== 'object' || typeof userId !== 'string' || !userId.trim()) return null;
  const wanted = userId.trim().toLowerCase();
  const key = Object.keys(learners).find((id) => id.trim().toLowerCase() === wanted);
  const entry = key == null ? null : learners[key];
  return entry && typeof entry === 'object' ? entry : null;
}

/**
 * @param {object|null|undefined} learners `sheetmusic.learners` from piano.yml.
 * @param {string|null|undefined} userId The player.
 * @returns {{collection: string|null, keyboardHints: 'always'|'after-wrong'|'never'|null, wrongNoteGhosts: boolean}}
 */
export function resolveLearnerAssist(learners, userId) {
  const entry = entryFor(learners, userId);
  return {
    collection: typeof entry?.collection === 'string' && entry.collection.trim() ? entry.collection.trim() : null,
    keyboardHints: HINTS.has(entry?.keyboardHints) ? entry.keyboardHints : null,
    wrongNoteGhosts: entry?.wrongNoteGhosts === true,
  };
}

/**
 * The drill keyboard's hint policy for one take.
 * @param {{keyboardHints?: string|null}|null} assist resolveLearnerAssist's answer.
 * @param {{rhythm?: boolean, check?: boolean}} take `check` is the Silver check (assist: 'none').
 */
export function keyboardHintPolicyFor(assist, { rhythm = false, check = false } = {}) {
  if (rhythm) return 'never';
  if (assist?.keyboardHints) return assist.keyboardHints;
  return check ? 'never' : 'after-wrong';
}

export default resolveLearnerAssist;
