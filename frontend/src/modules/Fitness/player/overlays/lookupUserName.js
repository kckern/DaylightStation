/**
 * Resolve a user's given name from the configured user list (the userCollections.all
 * SSOT, each entry shaped { id, name }). This is the same source the participant roster
 * draws names from. Pure — no React, trivially unit-testable.
 *
 * rider_select events carry a user slug (e.g. "milo"), NOT a device id, so the
 * device-centric resolveDisplayName can't resolve them. Match the slug here instead.
 *
 * @param {Array<{id?:string,name?:string}>} configuredUsers
 * @param {string} userId - user slug from a rider_select event
 * @returns {string} the user's name, or the raw userId if not found
 */
export function lookupUserName(configuredUsers, userId) {
  if (userId == null) return userId;
  const list = Array.isArray(configuredUsers) ? configuredUsers : [];
  const target = String(userId).toLowerCase();
  const match = list.find((u) => u && u.id != null && String(u.id).toLowerCase() === target);
  return (match && match.name) || userId;
}

export default lookupUserName;
