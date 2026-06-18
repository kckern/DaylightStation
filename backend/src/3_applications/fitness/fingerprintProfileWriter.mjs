// backend/src/3_applications/fitness/fingerprintProfileWriter.mjs

/**
 * Append a fingerprint under identities.fingerprints, preserving other
 * identities (e.g. the admin flag). Returns a new object; does not mutate.
 * @param {object} profile
 * @param {{id: string, finger: string, enrolled: string}} entry
 * @returns {object}
 */
export function addFingerprintEntry(profile, entry) {
  const next = { ...profile, identities: { ...(profile?.identities || {}) } };
  const list = Array.isArray(next.identities.fingerprints) ? [...next.identities.fingerprints] : [];
  list.push({ id: entry.id, finger: entry.finger, enrolled: entry.enrolled });
  next.identities.fingerprints = list;
  return next;
}

/**
 * Remove the fingerprint whose id === uuid. Returns a new object; does not mutate.
 * @param {object} profile
 * @param {string} uuid
 * @returns {object}
 */
export function removeFingerprintEntry(profile, uuid) {
  const next = { ...profile, identities: { ...(profile?.identities || {}) } };
  const list = Array.isArray(next.identities.fingerprints) ? next.identities.fingerprints : [];
  next.identities.fingerprints = list.filter((fp) => fp?.id !== uuid);
  return next;
}

/**
 * Application-layer writer: read the user's profile via the injected persistence
 * datastore, mutate identities.fingerprints with the pure helpers above, write it
 * back, then refresh the cached profile so the change is visible without an app
 * restart. The datastore (a `1_adapters` persistence port) and configService are
 * injected — this orchestrator holds no filesystem code, keeping dependencies
 * pointing inward per the DDD layering reference.
 *
 * @param {object} deps
 * @param {{readProfile:(u:string)=>object|null, writeProfile:(u:string, p:object)=>void}} deps.datastore
 * @param {{reloadUserProfile:(u:string)=>any}} deps.configService
 */
export function createFingerprintProfileWriter({ datastore, configService }) {
  async function addFingerprint(username, entry) {
    const profile = datastore.readProfile(username) || {};
    datastore.writeProfile(username, addFingerprintEntry(profile, entry));
    configService.reloadUserProfile(username);
  }

  async function removeFingerprint(username, uuid) {
    const profile = datastore.readProfile(username) || {};
    datastore.writeProfile(username, removeFingerprintEntry(profile, uuid));
    configService.reloadUserProfile(username);
  }

  return { addFingerprint, removeFingerprint };
}
