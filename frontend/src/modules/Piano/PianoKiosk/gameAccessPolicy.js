/**
 * gameAccessPolicy — whether a player is offered games at all.
 *
 * This is the OUTERMOST of the four things standing between a child and a
 * game, and the only one that is not a lock. The school lock, the match gate
 * and the day's budget all say "not yet, and here is what would change that".
 * This one says the games are not for this player, and nothing they do today
 * changes it — so it is checked FIRST and never renders a route to unlock.
 *
 * It is deliberately a flat list of ids rather than a `users: { id: {...} }`
 * map like `gameGate` and `gameAddressing`. Those carry a settings object per
 * child; this carries one fact, and a map would invite a second setting to be
 * hung off it that this policy has no meaning for.
 *
 * Absent config means everyone may play — a household that has never heard of
 * this key must behave exactly as it always did.
 */

/** Ids, lowercased and trimmed; anything unusable is dropped rather than guessed at. */
function idsFrom(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * @param {{disabledFor?: string[]}|null|undefined} gameAccess The `gameAccess` config block.
 * @param {string|null|undefined} learnerId The player being asked about.
 * @returns {boolean} True when games must not be offered to this player.
 */
export function gamesDisabledFor(gameAccess, learnerId) {
  if (typeof learnerId !== 'string' || !learnerId.trim()) return false;
  return idsFrom(gameAccess?.disabledFor).includes(learnerId.trim().toLowerCase());
}

export default gamesDisabledFor;
