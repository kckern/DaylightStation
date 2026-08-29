/**
 * Participant Entity - Represents a person in a fitness session
 */

export class Participant {
  constructor({
    name,
    hrDeviceId = null,
    isGuest = false,
    isPrimary = false,
    metadata = {}
  }) {
    this.name = name;
    this.hrDeviceId = hrDeviceId;
    this.isGuest = isGuest;
    this.isPrimary = isPrimary;
    this.metadata = metadata;
  }

  /**
   * Check if participant has a heart rate device
   */
  hasHrDevice() {
    return this.hrDeviceId !== null;
  }

  /**
   * Set as primary participant
   */
  setAsPrimary() {
    this.isPrimary = true;
  }

  /**
   * Set as guest
   */
  setAsGuest(isGuest = true) {
    this.isGuest = isGuest;
  }

  /**
   * Assign heart rate device
   */
  assignHrDevice(deviceId) {
    this.hrDeviceId = deviceId;
  }

  /**
   * Remove heart rate device
   */
  removeHrDevice() {
    this.hrDeviceId = null;
  }

}

export default Participant;
