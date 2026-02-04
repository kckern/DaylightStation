/**
 * DisplayNameResolver - Single Source of Truth for Fitness Display Names
 *
 * This module centralizes ALL display name resolution logic. Both FitnessContext
 * and FitnessUsers import from here - neither computes display names independently.
 *
 * See: docs/plans/2026-02-03-display-name-resolver-design.md
 * See: docs/_wip/audits/2026-02-03-fitness-display-name-architecture-problems.md
 */

/**
 * PRIORITY CHAIN - Explicit and documented
 *
 * Order matters. First match wins.
 * Each level has clear semantics for WHEN it applies.
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
    description: 'Owner\'s short name when 2+ users exercising together',
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

/**
 * Determines if group labels should be preferred.
 * SINGLE calculation - no more 3 different places computing this.
 *
 * A device is considered "present" if:
 * - It's a heart_rate device
 * - It's not marked as inactive (no inactiveSince)
 *
 * NOTE: We intentionally do NOT require heartRate > 0 here.
 * The trigger for preferring group labels must match the trigger for
 * card visibility. If a card appears, names should switch immediately -
 * not moments later when HR goes positive.
 *
 * @param {Array} devices - All devices
 * @returns {boolean} True if 2+ present HR devices
 */
export function shouldPreferGroupLabels(devices) {
  if (!Array.isArray(devices)) return false;

  const presentCount = devices.filter(d =>
    d.type === 'heart_rate' &&
    !d.inactiveSince
  ).length;

  return presentCount > 1;
}

/**
 * Counts present HR devices (same criteria as shouldPreferGroupLabels).
 *
 * @param {Array} devices - All devices
 * @returns {number} Count of present HR devices
 */
export function countActiveHrDevices(devices) {
  if (!Array.isArray(devices)) return 0;

  return devices.filter(d =>
    d.type === 'heart_rate' &&
    !d.inactiveSince
  ).length;
}

/**
 * Builds the context object needed for display name resolution.
 * Called once per render cycle, passed to resolveDisplayName.
 *
 * @param {Object} sources - Raw data from context/props
 * @param {Array} sources.devices - All devices
 * @param {Map|Object} sources.deviceOwnership - Map<deviceId, {name, groupLabel, profileId}>
 * @param {Map|Object} sources.deviceAssignments - Map<deviceId, {occupantType, occupantName, ...}>
 * @param {Map|Object} sources.userProfiles - Map<userId, {displayName, groupLabel}>
 * @returns {DisplayNameContext}
 */
export function buildDisplayNameContext(sources) {
  const {
    devices = [],
    deviceOwnership = new Map(),
    deviceAssignments = new Map(),
    userProfiles = new Map(),
  } = sources;

  // Normalize to Maps if objects were passed
  const ownershipMap = deviceOwnership instanceof Map
    ? deviceOwnership
    : new Map(Object.entries(deviceOwnership || {}));

  const assignmentsMap = deviceAssignments instanceof Map
    ? deviceAssignments
    : new Map(Object.entries(deviceAssignments || {}));

  const profilesMap = userProfiles instanceof Map
    ? userProfiles
    : new Map(Object.entries(userProfiles || {}));

  return {
    preferGroupLabels: shouldPreferGroupLabels(devices),
    activeHrDeviceCount: countActiveHrDevices(devices),
    deviceOwnership: ownershipMap,
    deviceAssignments: assignmentsMap,
    userProfiles: profilesMap,
  };
}

/**
 * Main entry point - resolves display name for a device.
 *
 * @param {string} deviceId - The device ID to resolve
 * @param {DisplayNameContext} context - Context from buildDisplayNameContext
 * @returns {DisplayNameResult} - { displayName, source, preferredGroupLabel }
 */
export function resolveDisplayName(deviceId, context) {
  if (!deviceId) {
    return {
      displayName: 'Unknown',
      source: 'fallback',
      preferredGroupLabel: false,
    };
  }

  const deviceIdStr = String(deviceId);

  // Build resolution context for this device
  const resolutionCtx = {
    deviceId: deviceIdStr,
    preferGroupLabels: context.preferGroupLabels,
    ownership: context.deviceOwnership?.get(deviceIdStr) || null,
    assignment: context.deviceAssignments?.get(deviceIdStr) || null,
    profile: null, // Will be looked up if ownership has profileId
  };

  // If we have ownership with profileId, look up the profile
  if (resolutionCtx.ownership?.profileId && context.userProfiles) {
    resolutionCtx.profile = context.userProfiles.get(resolutionCtx.ownership.profileId) || null;
  }

  // Walk the priority chain
  for (const rule of PRIORITY_CHAIN) {
    if (rule.match(resolutionCtx)) {
      const displayName = rule.resolve(resolutionCtx);

      // Ensure we always return a string
      if (displayName && typeof displayName === 'string' && displayName.trim()) {
        return {
          displayName: displayName.trim(),
          source: rule.id,
          preferredGroupLabel: context.preferGroupLabels,
        };
      }
      // If resolve returned empty/null, continue to next rule
    }
  }

  // Should never reach here due to fallback rule, but just in case
  return {
    displayName: deviceIdStr,
    source: 'fallback',
    preferredGroupLabel: context.preferGroupLabels,
  };
}

/**
 * Batch resolve - get display names for all devices at once.
 * More efficient than calling resolveDisplayName in a loop when
 * you need names for multiple devices.
 *
 * @param {Array<string>} deviceIds - Device IDs to resolve
 * @param {DisplayNameContext} context - Context from buildDisplayNameContext
 * @returns {Map<string, DisplayNameResult>}
 */
export function resolveAllDisplayNames(deviceIds, context) {
  const results = new Map();

  if (!Array.isArray(deviceIds)) {
    return results;
  }

  for (const deviceId of deviceIds) {
    results.set(String(deviceId), resolveDisplayName(deviceId, context));
  }

  return results;
}

/**
 * Get the priority chain for debugging/testing.
 *
 * @returns {Array} Copy of the priority chain
 */
export function getPriorityChain() {
  return PRIORITY_CHAIN.map(rule => ({
    id: rule.id,
    description: rule.description,
  }));
}
