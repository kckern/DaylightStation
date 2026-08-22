/**
 * Resolve a camera's network endpoint from devices.yml — the single source of
 * truth for host + credentials. archive.yml used to restate both, so a re-IP'd
 * camera silently desynchronized the archive from the live view.
 *
 * Standalone peer module (not owned by either job handler): both the archive
 * job (Pipeline A, currently disabled) and the ledger job (Pipeline C, runs
 * nightly unconditionally) depend on this resolution and must not depend on
 * each other's file — see Decision D1 in both handlers against implicit
 * cross-dependencies between handlers.
 *
 * @module 3_applications/camera/resolveCameraEndpoint
 */

/**
 * @param {Object} configService - exposes getDeviceConfig(id, householdId)
 * @param {string} deviceId - devices.yml key
 * @param {string|null} householdId
 * @returns {{host: string, authRef: string|undefined}}
 */
export function resolveCameraEndpoint(configService, deviceId, householdId) {
  const device = configService.getDeviceConfig(deviceId, householdId);
  if (!device?.host) {
    throw new Error(
      `camera device '${deviceId}' has no host in devices.yml`,
    );
  }
  return { host: device.host, authRef: device.auth_ref };
}

export default resolveCameraEndpoint;
