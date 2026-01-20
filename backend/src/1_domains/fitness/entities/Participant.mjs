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

  /**
   * Serialize to plain object
   */
  toJSON() {
    return {
      name: this.name,
      hrDeviceId: this.hrDeviceId,
      isGuest: this.isGuest,
      isPrimary: this.isPrimary,
      metadata: this.metadata
    };
  }

  /**
   * Create from plain object
   */
  static fromJSON(data) {
    return new Participant(data);
  }
}

export default Participant;
