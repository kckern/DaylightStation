/** Persistence boundary for enrolled calculator devices, not learners. */
export class ISchoolCalcDeviceRepository {
  /** @returns {Promise<object|null>} */
  async getDevice(deviceId) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolCalcDeviceRepository.getDevice must be implemented');
  }

  /** @returns {Promise<object|null>} */
  async findByCompactId(compactId) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolCalcDeviceRepository.findByCompactId must be implemented');
  }

  /**
   * Insert or replace one aggregate. `expectedRevision: null` means create;
   * otherwise a mismatch must fail rather than lose a concurrent sync update.
   */
  async saveDevice(device, { expectedRevision = null } = {}) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolCalcDeviceRepository.saveDevice must be implemented');
  }
}

export default ISchoolCalcDeviceRepository;
