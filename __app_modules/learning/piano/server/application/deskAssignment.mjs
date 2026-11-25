/**
 * deskAssignment — which piece a child's home-strip card is for, from
 * `sheetmusic.learners.<id>` in piano.yml (the same entries learnerAssist.js
 * reads on the kiosk).
 *
 *   sheetmusic:
 *     learners:
 *       <user id>:
 *         piece: files:docs/sheet-music/<folder>/<file>   # their piece: the card shows it
 *         collection: files:docs/sheet-music/<folder>     # their track: the card shows their newest piece in it
 *
 * An entry is ONE learner's. Nothing here applies to anyone else, and no entry
 * can apply to everyone: a key that is not on the piano roster (a typo, or a
 * catch-all such as `*`, `all`, `default`, `everyone`) is refused and logged, so
 * a config that would enrol the whole household in one child's piece or track
 * never reaches a card (2026-11-24: one child's First Notes track had taken every
 * child's card, by the newest-piece rule, once the others tried it).
 *
 * A track also belongs to its learner: on another child's card a piece inside
 * someone else's track never wins (see GetPianoDesk).
 */

const isObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const ref = (v) => (typeof v === 'string' && v.trim().startsWith('files:') ? v.trim().replace(/\/+$/, '') : null);

/** True when a score id lies inside a track (`files:<folder>`), at any depth. */
export const inTrack = (scoreId, track) => typeof scoreId === 'string' && !!track && scoreId.startsWith(`${track}/`);

/**
 * Every roster learner's desk assignment, and the entries refused.
 * @param {object|null|undefined} learners `sheetmusic.learners`
 * @param {string[]} roster the piano roster's user ids
 * @returns {{ byUser: Map<string, {piece: string|null, track: string|null}>, refused: Array<{key: string, reason: string}> }}
 */
export function resolveDeskAssignments(learners, roster = []) {
  const byUser = new Map();
  const refused = [];
  if (!isObject(learners)) return { byUser, refused };
  const rosterById = new Map(roster.map((id) => [String(id).trim().toLowerCase(), id]));
  for (const [key, entry] of Object.entries(learners)) {
    const userId = rosterById.get(String(key).trim().toLowerCase());
    if (!userId) { refused.push({ key, reason: 'not-on-roster' }); continue; }
    if (!isObject(entry)) continue;
    const piece = ref(entry.piece);
    if (entry.piece != null && !piece) refused.push({ key, reason: 'piece-not-a-library-score' });
    byUser.set(userId, { piece, track: ref(entry.collection) });
  }
  return { byUser, refused };
}

export default resolveDeskAssignments;
