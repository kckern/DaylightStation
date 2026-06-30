/**
 * userDisplayName — core, app-wide Single Source of Truth for resolving how a
 * person's name should be shown.
 *
 * Originally built for the Fitness HR overlay (device-centric, real-time), this
 * now backs many UXs (piano "Who's playing?", momentum widget, etc.), so it lives
 * in core. The old import path `hooks/fitness/DisplayNameResolver.js` re-exports
 * everything here for back-compat.
 *
 * The central idea is a *context* that answers one question: **is this a family
 * scene — are the children present alongside the labeled adults?** When yes, a
 * relational/group label reads best ("Dad", "Mom"); when no, the full name does
 * ("User_1"). That context can be derived in real time (HR devices present) OR
 * statically (a roster that simply lists the kids) — the resolver doesn't care
 * which; callers compute the flag and pass it in.
 */

/**
 * PRIORITY CHAIN — device-centric resolution (ownership → assignment → profile).
 * Order matters; first match wins.
 */
const PRIORITY_CHAIN = [
  {
    id: 'guest',
    description: 'Temporary guest using someone else\'s device',
    match: (ctx) => ctx.assignment?.occupantType === 'guest',
    resolve: (ctx) => ctx.assignment.occupantName,
  },
  {
    id: 'groupLabel',
    description: 'Owner\'s short relational label when in a family/group scene',
    match: (ctx) => ctx.preferGroupLabels && ctx.ownership?.groupLabel,
    resolve: (ctx) => ctx.ownership.groupLabel,
  },
  {
    id: 'owner',
    description: 'Device owner\'s display name',
    match: (ctx) => ctx.ownership?.name,
    resolve: (ctx) => ctx.ownership.name,
  },
  {
    id: 'profile',
    description: 'User profile display name (fallback)',
    match: (ctx) => ctx.profile?.displayName,
    resolve: (ctx) => ctx.profile.displayName,
  },
  {
    id: 'fallback',
    description: 'Device ID when nothing else available',
    match: () => true,
    resolve: (ctx) => ctx.deviceId,
  },
];

const labelOf = (u) => (u?.group_label || u?.groupLabel || '').toString().trim();

/**
 * Is a set of present people a "family scene" — children present alongside the
 * labeled adults? Relational labels ("Dad"/"Mom") are only meaningful when the
 * people they're relative to (the kids) are in view; with adults alone, full
 * names read better. A "child" here is any present user with no relational label.
 *
 * This is the STATIC way to derive the family-context flag (e.g. a roster). The
 * real-time way is `shouldPreferGroupLabels(devices)`. Both feed the same flag.
 *
 * @param {Array} users
 * @returns {boolean}
 */
export function hasFamilyContext(users) {
  if (!Array.isArray(users) || users.length === 0) return false;
  const hasLabeledAdult = users.some((u) => labelOf(u));
  const hasChild = users.some((u) => !labelOf(u));
  return hasLabeledAdult && hasChild;
}

/**
 * Real-time derivation of the family-context flag: 2+ present HR devices.
 *
 * A device is "present" if it's a heart_rate device not marked inactive. We do
 * NOT require heartRate > 0 — the trigger must match card visibility so names
 * switch the instant a card appears.
 *
 * @param {Array} devices
 * @returns {boolean}
 */
export function shouldPreferGroupLabels(devices) {
  if (!Array.isArray(devices)) return false;
  return devices.filter((d) => d.type === 'heart_rate' && !d.inactiveSince).length > 1;
}

/**
 * Counts present HR devices (same criteria as shouldPreferGroupLabels).
 * @param {Array} devices
 * @returns {number}
 */
export function countActiveHrDevices(devices) {
  if (!Array.isArray(devices)) return 0;
  return devices.filter((d) => d.type === 'heart_rate' && !d.inactiveSince).length;
}

/**
 * Builds the context object for device-centric resolution.
 * @param {Object} sources
 * @returns {DisplayNameContext}
 */
export function buildDisplayNameContext(sources) {
  const {
    devices = [],
    deviceOwnership = new Map(),
    deviceAssignments = new Map(),
    userProfiles = new Map(),
  } = sources;

  const ownershipMap = deviceOwnership instanceof Map
    ? deviceOwnership : new Map(Object.entries(deviceOwnership || {}));
  const assignmentsMap = deviceAssignments instanceof Map
    ? deviceAssignments : new Map(Object.entries(deviceAssignments || {}));
  const profilesMap = userProfiles instanceof Map
    ? userProfiles : new Map(Object.entries(userProfiles || {}));

  return {
    preferGroupLabels: shouldPreferGroupLabels(devices),
    activeHrDeviceCount: countActiveHrDevices(devices),
    deviceOwnership: ownershipMap,
    deviceAssignments: assignmentsMap,
    userProfiles: profilesMap,
  };
}

/**
 * Device-centric resolution — resolve a display name for a device id.
 * @param {string} deviceId
 * @param {DisplayNameContext} context
 * @returns {DisplayNameResult}
 */
export function resolveDisplayName(deviceId, context) {
  if (!deviceId) {
    return { displayName: 'Unknown', source: 'fallback', preferredGroupLabel: false };
  }

  const deviceIdStr = String(deviceId);
  const resolutionCtx = {
    deviceId: deviceIdStr,
    preferGroupLabels: context.preferGroupLabels,
    ownership: context.deviceOwnership?.get(deviceIdStr) || null,
    assignment: context.deviceAssignments?.get(deviceIdStr) || null,
    profile: null,
  };

  if (resolutionCtx.ownership?.profileId && context.userProfiles) {
    resolutionCtx.profile = context.userProfiles.get(resolutionCtx.ownership.profileId) || null;
  }

  for (const rule of PRIORITY_CHAIN) {
    if (rule.match(resolutionCtx)) {
      const displayName = rule.resolve(resolutionCtx);
      if (displayName && typeof displayName === 'string' && displayName.trim()) {
        return {
          displayName: displayName.trim(),
          source: rule.id,
          preferredGroupLabel: context.preferGroupLabels,
        };
      }
    }
  }

  return { displayName: deviceIdStr, source: 'fallback', preferredGroupLabel: context.preferGroupLabels };
}

/**
 * Batch device-centric resolution.
 * @param {Array<string>} deviceIds
 * @param {DisplayNameContext} context
 * @returns {Map<string, DisplayNameResult>}
 */
export function resolveAllDisplayNames(deviceIds, context) {
  const results = new Map();
  if (!Array.isArray(deviceIds)) return results;
  for (const deviceId of deviceIds) {
    results.set(String(deviceId), resolveDisplayName(deviceId, context));
  }
  return results;
}

/**
 * Device-agnostic resolution — resolve a display name directly from a hydrated
 * user/profile object. Applies the family-context precedence: relational label
 * (when the scene is a family one) → name → id.
 *
 * Accepts either snake_case (`group_label`, config shape) or camelCase
 * (`groupLabel`, `displayName`).
 *
 * @param {Object} user - { id|profileId, name|displayName, group_label|groupLabel }
 * @param {Object} [context]
 * @param {boolean} [context.familyContext] - true → kids present → use the relational label
 * @param {boolean} [context.preferGroupLabels] - legacy alias for familyContext
 * @returns {DisplayNameResult} - { displayName, source, familyContext, preferredGroupLabel }
 */
export function resolveUserDisplayName(user, context = {}) {
  // `familyContext` is the abstract flag; `preferGroupLabels` is the legacy name.
  const preferRelational = !!(context.familyContext ?? context.preferGroupLabels ?? false);
  const groupLabel = labelOf(user);
  const name = (user?.name || user?.displayName || '').toString().trim();
  const id = (user?.id || user?.profileId || '').toString().trim();

  const tag = (displayName, source) => ({
    displayName,
    source,
    familyContext: preferRelational,
    preferredGroupLabel: preferRelational,
  });

  if (preferRelational && groupLabel) return { ...tag(groupLabel, 'groupLabel'), preferredGroupLabel: true };
  if (name) return tag(name, 'profile');
  if (groupLabel) return tag(groupLabel, 'groupLabel');
  return tag(id || 'Unknown', 'fallback');
}

/**
 * Get the priority chain for debugging/testing.
 * @returns {Array}
 */
export function getPriorityChain() {
  return PRIORITY_CHAIN.map((rule) => ({ id: rule.id, description: rule.description }));
}
