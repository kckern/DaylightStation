// backend/src/3_applications/fitness/unlockPolicy.mjs

/**
 * Lock-policy resolution (pure).
 *
 * A `locks` map in the fitness config names authorized usernames per lock
 * (e.g. `locks: { dance_party: [userA, userB] }`). Each user's profile may
 * hold `identities.fingerprints[] = [{ id: <uuid>, finger, enrolled }]`.
 *
 * Given a lock name, this maps it to the list of candidate fingerprint uuids
 * (with owning username) to feed an on-box identify step later.
 *
 * Pure transform of two already-loaded config objects — no IO, no logging.
 *
 * @param {object} fitnessConfig - fitness config containing a `locks` map
 * @param {object} profilesByUser - username -> profile (with identities)
 * @param {string} lockName - the lock to resolve candidates for
 * @returns {Array<{ uuid: string, username: string }>}
 */
export function resolveCandidateUuids(fitnessConfig, profilesByUser, lockName) {
  const authorized = fitnessConfig?.locks?.[lockName];
  if (!Array.isArray(authorized)) return [];
  const out = [];
  for (const username of authorized) {
    const fps = profilesByUser?.[username]?.identities?.fingerprints || [];
    for (const fp of fps) if (fp?.id) out.push({ uuid: fp.id, username });
  }
  return out;
}
