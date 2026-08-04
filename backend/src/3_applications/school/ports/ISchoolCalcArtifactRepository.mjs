/** Immutable compiled lesson artifacts and their grading metadata. */
export class ISchoolCalcArtifactRepository {
  /** @returns {Promise<object|null>} */
  async getArtifact(artifactId) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolCalcArtifactRepository.getArtifact must be implemented');
  }

  /**
   * First write wins. An implementation must reject an existing artifact ID
   * whose bytes or source digest differs from `artifact`.
   */
  async putArtifact(artifact) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolCalcArtifactRepository.putArtifact must be implemented');
  }
}

export default ISchoolCalcArtifactRepository;
