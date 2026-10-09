// backend/src/3_applications/fitness/manageAccessPolicy.mjs

/**
 * Resolve the management access decision for a target user (pure; no IO).
 *
 * - `requiresAuth` is false iff the target has zero enrolled fingerprints
 *   (trust-on-first-use: a brand-new user may enroll their first finger freely).
 * - `gallery` is the identify set used when auth IS required: the target's own
 *   fingerprint uuids PLUS every admin's uuids, deduped by uuid (an admin who is
 *   also the target appears once). Each entry carries its owning username so the
 *   caller can tell self-match from admin-match.
 *
 * An admin is any user with `identities.admin === true`.
 *
 * @param {Object<string, object>} profilesByUser - username -> parsed profile
 * @param {string} targetUsername
 * @returns {{ requiresAuth: boolean, gallery: Array<{uuid: string, username: string}> }}
 */
export function resolveManageAccess(profilesByUser, targetUsername) {
  const target = profilesByUser?.[targetUsername];
  const targetFps = target?.identities?.fingerprints || [];
  const requiresAuth = targetFps.length > 0;

  const seen = new Set();
  const gallery = [];
  const push = (uuid, username) => {
    if (!uuid || seen.has(uuid)) return;
    seen.add(uuid);
    gallery.push({ uuid, username });
  };

  for (const fp of targetFps) push(fp?.id, targetUsername);
  for (const [username, profile] of Object.entries(profilesByUser || {})) {
    if (profile?.identities?.admin !== true) continue;
    for (const fp of profile.identities.fingerprints || []) push(fp?.id, username);
  }

  return { requiresAuth, gallery };
}

/** Config-declared admin usernames (`fitness.yml → users.admin`). */
export function resolveAdminUsernames(fitnessConfig) {
  return fitnessConfig?.users?.admin || [];
}

/** Config-declared primary usernames (`fitness.yml → users.primary`). */
export function resolvePrimaryUsernames(fitnessConfig) {
  return fitnessConfig?.users?.primary || [];
}

/**
 * The fingerprint-enrollment universe: admins + primary users, deduped with
 * admins first (pure; no IO).
 *
 * Both groups have a profile.yml and may hold fingerprints; an admin need not be
 * primary (e.g. a spouse who manages but doesn't follow the program). Inline
 * family/friends have no profile and are never eligible. Falsy/blank usernames
 * are skipped.
 *
 * @param {object} fitnessConfig - parsed fitness.yml (reads `.users.admin/.primary`)
 * @returns {string[]} ordered, deduped eligible usernames
 */
export function resolveEligibleUsernames(fitnessConfig) {
  const seen = new Set();
  const ordered = [];
  for (const username of [...resolveAdminUsernames(fitnessConfig), ...resolvePrimaryUsernames(fitnessConfig)]) {
    if (!username || seen.has(username)) continue;
    seen.add(username);
    ordered.push(username);
  }
  return ordered;
}
