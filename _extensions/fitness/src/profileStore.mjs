// Pure helpers for reading/mutating a user profile's fingerprint list.
//
// A fingerprint entry is the durable uuid registry that links a libfprint
// template (stored on the garage box as /var/lib/daylight-unlock/<uuid>.tpl) to a
// user. The backend resolves an unlock request's authorized users into a gallery
// of { uuid, username } candidates from these entries; the garage container then
// captures one finger and identifies it against the matching .tpl files.
//
// Kept pure (no I/O) so it is unit-testable without hardware or a filesystem.

/**
 * Append a fingerprint entry under `identities.fingerprints`, without mutating
 * the input. Existing identities (telegram, etc.) and fingerprints are preserved.
 *
 * @param {object} profile - the user profile object (may lack `identities`).
 * @param {{id: string, finger: string, enrolled?: string, simulated?: boolean}} entry
 * @returns {object} a new profile object with the entry appended.
 */
export function addFingerprintEntry(profile, entry) {
  const next = { ...profile, identities: { ...(profile?.identities || {}) } };
  const list = Array.isArray(next.identities.fingerprints)
    ? [...next.identities.fingerprints]
    : [];
  const record = { id: entry.id, finger: entry.finger };
  if (entry.enrolled !== undefined) record.enrolled = entry.enrolled;
  if (entry.simulated !== undefined) record.simulated = entry.simulated;
  list.push(record);
  next.identities.fingerprints = list;
  return next;
}

/**
 * Build the identify gallery: every enrolled fingerprint uuid of the authorized
 * users, tagged with its owning username so a match resolves back to a user.
 *
 * @param {Object<string, object>} profilesByUser - { username: profile }
 * @param {string[]} authorizedUsernames - users permitted for this lock
 * @returns {Array<{uuid: string, username: string}>}
 */
export function collectGalleryUuids(profilesByUser, authorizedUsernames) {
  const out = [];
  for (const username of authorizedUsernames || []) {
    const fps = profilesByUser?.[username]?.identities?.fingerprints || [];
    for (const fp of fps) {
      if (fp?.id) out.push({ uuid: fp.id, username });
    }
  }
  return out;
}
