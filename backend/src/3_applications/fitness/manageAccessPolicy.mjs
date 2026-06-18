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
