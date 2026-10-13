/** Latest authoritative imported lesson-progress position per device/artifact. */
export class ISchoolCalcProgressRepository {
  /**
   * Persist only if `sequence` is newer; equal sequence+record is idempotent.
   * @returns {Promise<{status: 'accepted'|'duplicate'|'stale', progress: object}>}
   */
  async saveLatest(progress) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolCalcProgressRepository.saveLatest must be implemented');
  }

  async getLatest({ deviceId, artifactId }) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolCalcProgressRepository.getLatest must be implemented');
  }
}

export default ISchoolCalcProgressRepository;
