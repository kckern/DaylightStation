// _extensions/fingerprint/src/profileStore.mjs
//
// Pure helpers for the on-box enrollment CLI (Task 1.3). They transform an
// already-parsed user profile object — no IO here, so they're unit-testable
// without the filesystem or hardware. The enroll CLI reads data/users/<user>/
// profile.yml, applies addFingerprintEntry, and writes it back.

/**
 * Append a fingerprint entry under `identities.fingerprints`, preserving any
 * existing identities and fingerprints. Returns a new object (does not mutate).
 *
 * @param {object} profile - parsed profile.yml object
 * @param {{ id: string, finger: string, enrolled: string }} entry
 * @returns {object} a new profile with the entry appended
 */
export function addFingerprintEntry(profile, entry) {
  const next = { ...profile, identities: { ...(profile?.identities || {}) } };
  const list = Array.isArray(next.identities.fingerprints) ? [...next.identities.fingerprints] : [];
  list.push({ id: entry.id, finger: entry.finger, enrolled: entry.enrolled });
  next.identities.fingerprints = list;
  return next;
}

/**
 * Build the identify gallery for a set of authorized users: every enrolled
 * fingerprint uuid (with its owning username). Mirrors the backend's
 * resolveCandidateUuids so the on-box side and the API agree on shape.
 *
 * @param {Object<string, object>} profilesByUser - username -> parsed profile
 * @param {string[]} authorizedUsernames
 * @returns {Array<{ uuid: string, username: string }>}
 */
export function collectGalleryUuids(profilesByUser, authorizedUsernames) {
  const out = [];
  for (const username of authorizedUsernames) {
    const fps = profilesByUser?.[username]?.identities?.fingerprints || [];
    for (const fp of fps) if (fp?.id) out.push({ uuid: fp.id, username });
  }
  return out;
}
