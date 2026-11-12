// Who can be the shooter: the people already in the fitness session (they are
// wearing the heart-rate straps that set the shot tier), then everyone else
// the household has configured. Pure.

const idOf = (person) => (typeof person === 'string' ? person : person?.id || person?.userId || person?.profileId || null);
const nameOf = (person) => (typeof person === 'string'
  ? null
  : person?.displayLabel || person?.group_label || person?.groupLabel || person?.displayName || person?.name || null);

/** @returns {{ id: string, name: string }[]} session participants first; anonymous straps and the guest left out */
export function listInvadersPeople(ctx) {
  const configured = [
    ...(ctx?.users || []),
    ...(ctx?.userCollections?.all || []),
    ...Object.values(ctx?.usersConfig || {}).flatMap((group) => (Array.isArray(group) ? group : [])),
  ];
  const people = new Map();
  for (const person of [...(ctx?.participantRoster || []), ...configured]) {
    const id = idOf(person);
    if (!id || id === 'guest' || String(id).startsWith('device:')) continue;
    const name = nameOf(person);
    // A bare id or a nameless entry never replaces a fuller one for the same person.
    if (!people.has(id) || (people.get(id).name === id && name)) people.set(id, { id: String(id), name: name || String(id) });
  }
  return [...people.values()];
}

const isPerson = (id) => !!id && id !== 'guest' && !String(id).startsWith('device:');

/**
 * Who is actually riding: the fitness session's roster (heart-rate straps),
 * plus the mat's assigned rider. These are the shooters the lobby offers; anyone
 * else is behind a hold. Pure.
 * @returns {string[]}
 */
export function listSessionRiderIds(ctx, mat = null) {
  const ids = (ctx?.participantRoster || []).map(idOf).filter(isPerson).map(String);
  if (isPerson(mat?.riderId)) ids.push(String(mat.riderId));
  return [...new Set(ids)];
}

/**
 * The school learners whose school day gates this round: everyone riding who
 * is a learner, and the shooter. The shooter is gated unless known not to be a
 * learner (`schoolLearner === false`); a session rider only when known to be
 * one, so a guest strap never locks the game. The gate follows the riders,
 * never the pick: choosing a grown-up as the shooter leaves a riding child's
 * gate in force. Pure.
 * @param {(id: string) => boolean|undefined} learnerOf  `ctx.getUserByName(id)?.schoolLearner`
 * @returns {string[]} sorted
 */
export function gateLearnerIds({ shooterId = null, riderIds = [], learnerOf = () => undefined } = {}) {
  const ids = new Set();
  if (isPerson(shooterId) && learnerOf(shooterId) !== false) ids.add(String(shooterId));
  for (const id of riderIds) if (isPerson(id) && learnerOf(id) === true) ids.add(String(id));
  return [...ids].sort();
}
