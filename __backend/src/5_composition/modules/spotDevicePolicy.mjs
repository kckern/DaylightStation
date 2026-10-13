/**
 * Which device ids may key a per-screen spot (RecordPlaybackProgress
 * `isKnownSpotDevice`). `browser:` ids are self-minted and always accepted;
 * `fleet:` ids must name a device declared in the household's devices.yml, so
 * a typo or a forged header cannot invent a screen. When the device registry
 * cannot be read at all, fleet ids are accepted rather than dropping every
 * screen's spot.
 */
export function createSpotDevicePolicy({ configService, householdId = null, logger = console }) {
  return (deviceId) => {
    if (typeof deviceId !== 'string') return false;
    if (deviceId.startsWith('browser:')) return true;
    if (!deviceId.startsWith('fleet:')) return false;
    let devices;
    try {
      devices = configService.getHouseholdDevices(householdId)?.devices;
    } catch (error) {
      logger.warn?.('play.log.spot_policy_unreadable', { error: error.message });
      return true;
    }
    if (!devices || typeof devices !== 'object') return true;
    return Object.prototype.hasOwnProperty.call(devices, deviceId.slice(6));
  };
}

export default createSpotDevicePolicy;
