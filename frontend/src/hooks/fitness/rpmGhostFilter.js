/**
 * rpmGhostFilter — suppress stray (unregistered) cadence sensors.
 *
 * A stray ANT+ cadence sensor that is not mapped to any configured equipment
 * (e.g. one left in a drawer) broadcasts 0 RPM and would otherwise render as an
 * extra RPM meter. This is the cadence-side analog of the unregistered-device
 * HR floor filter in ParticipantRoster: an UNREGISTERED `cadence` device with
 * no real signal (cadence ≤ 0) is treated as noise and dropped.
 *
 * Registered equipment is NEVER filtered — an idle configured bike legitimately
 * reads 0 RPM and must keep its meter. Non-cadence RPM device types are left
 * untouched.
 *
 * Note: DeviceManager holds the last cadence value for rpmZero (~1200ms) before
 * resetting it to 0, so an actively-pedaled (cadence > 0) device won't flicker.
 */

/**
 * Build the set of configured device ids from the equipment catalog. Keys match
 * the equipmentMap built in FitnessUsers (cadence/speed/ble device ids).
 * @param {Array<Object>} equipmentConfig
 * @returns {Set<string>}
 */
export function buildConfiguredDeviceIdSet(equipmentConfig) {
  const ids = new Set();
  if (Array.isArray(equipmentConfig)) {
    for (const e of equipmentConfig) {
      for (const key of ['cadence', 'speed', 'ble']) {
        if (e?.[key] != null) ids.add(String(e[key]));
      }
    }
  }
  return ids;
}

/**
 * True when a device is a stray, unregistered cadence sensor showing no signal.
 * @param {Object} device
 * @param {Set<string>} configuredIds
 * @returns {boolean}
 */
export function isGhostRpmDevice(device, configuredIds) {
  if (!device) return false;
  // Only cadence sensors can be ghosts; other RPM types pass through untouched.
  if (device.type !== 'cadence') return false;
  const id = String(device.id ?? device.deviceId ?? '');
  // Registered equipment is never a ghost (idle bikes read 0 and must show).
  if (configuredIds && configuredIds.has(id)) return false;
  // Unregistered + no positive cadence reading → stray sensor noise.
  const cadence = Number(device.cadence);
  return !(Number.isFinite(cadence) && cadence > 0);
}

/**
 * Drop ghost cadence devices from an RPM device list.
 * @param {Array<Object>} devices
 * @param {Set<string>} configuredIds
 * @returns {Array<Object>}
 */
export function filterGhostRpmDevices(devices, configuredIds) {
  if (!Array.isArray(devices)) return [];
  return devices.filter((d) => !isGhostRpmDevice(d, configuredIds));
}
