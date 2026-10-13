/**
 * Resolve a rider's display name from the configured user list (the userCollections.all
 * SSOT, each entry shaped { id, name, groupLabel }). This is the same source the
 * participant roster draws names from. Pure — no React, trivially unit-testable.
 *
 * rider_select events carry a user slug (e.g. "user_3"), NOT a device id, so the
 * device-centric resolveDisplayName can't resolve them. Match the slug here instead.
 *
 * Mirrors the main resolver's name-vs-nickname rule: the short household nickname
 * (groupLabel, e.g. "Dad") is used only when `preferGroupLabels` is true — i.e. when 2+
 * heart-rate participants are present — otherwise the given name (e.g. "User_1"). Falls
 * back to the given name when there's no nickname, and to the raw id when unmatched.
 *
 * @param {Array<{id?:string,name?:string,groupLabel?:string}>} configuredUsers
 * @param {string} userId - user slug from a rider_select event
 * @param {{preferGroupLabels?: boolean}} [options]
 * @returns {string} the user's nickname or name, or the raw userId if not found
 */
export function lookupUserName(configuredUsers, userId, { preferGroupLabels = false } = {}) {
  if (userId == null) return userId;
  const list = Array.isArray(configuredUsers) ? configuredUsers : [];
  const target = String(userId).toLowerCase();
  const match = list.find((u) => u && u.id != null && String(u.id).toLowerCase() === target);
  if (!match) return userId;
  if (preferGroupLabels && match.groupLabel) return match.groupLabel;
  return match.name || userId;
}

export default lookupUserName;
