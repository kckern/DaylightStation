/**
 * DeviceOwnershipIndex — single source of truth for device → user resolution.
 *
 * Maintains a Map<string, Descriptor> from device ID to owner info.
 * Rebuilt by UserManager whenever user registrations or assignments change.
 * All device IDs are stored and looked up as strings.
 */
export class DeviceOwnershipIndex {
  constructor() {
    /** @type {Map<string, {id: string, name: string, type: 'hr'|'cadence'}>} */
    this._byDevice = new Map();
    /** @type {Map<string, string[]>} userId → deviceIds */
    this._byUser = new Map();
  }

  /**
   * Rebuild the entire index from the current user list.
   * @param {Array<{id: string, name: string, hrDeviceIds: Set<string>|Array<string>, cadenceDeviceId: string|null}>} users
   * Note: hrDeviceIds accepts Set or Array (iterated with for...of). Some callers may pass arrays from config.
   */
  rebuild(users) {
    this._byDevice.clear();
    this._byUser.clear();

    for (const user of users) {
      const deviceIds = [];

      for (const devId of user.hrDeviceIds) {
        const key = String(devId);
        this._byDevice.set(key, { id: user.id, name: user.name, type: 'hr' });
        deviceIds.push(key);
      }

      if (user.cadenceDeviceId) {
        const key = String(user.cadenceDeviceId);
        this._byDevice.set(key, { id: user.id, name: user.name, type: 'cadence' });
        deviceIds.push(key);
      }

      if (deviceIds.length > 0) {
        this._byUser.set(user.id, deviceIds);
      }
    }
  }

  /**
   * Get the owner descriptor for a device ID.
   * @param {string|number} deviceId
   * @returns {{id: string, name: string, type: 'hr'|'cadence'}|null}
   */
  getOwner(deviceId) {
    return this._byDevice.get(String(deviceId)) || null;
  }

  /**
   * Get all device IDs owned by a user.
   * @param {string} userId
   * @returns {string[]}
   */
  getDeviceIdsForUser(userId) {
    return this._byUser.get(userId) || [];
  }

  /**
   * Check whether a specific user owns a specific device.
   * @param {string} userId
   * @param {string|number} deviceId
   * @returns {boolean}
   */
  ownsDevice(userId, deviceId) {
    const owner = this._byDevice.get(String(deviceId));
    return owner?.id === userId;
  }

  /**
   * Number of indexed devices (useful for debugging).
   * @returns {number}
   */
  get size() {
    return this._byDevice.size;
  }
}
