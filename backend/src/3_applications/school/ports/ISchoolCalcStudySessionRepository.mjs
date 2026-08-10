/** Durable store for immutable Adaptive Study issuance and its terminal outcome. */
export class ISchoolCalcStudySessionRepository {
  async getByWorkSession(_workSessionId) {
    throw new Error('ISchoolCalcStudySessionRepository.getByWorkSession must be implemented');
  }

  async getByCode(_sixDigitCode) {
    throw new Error('ISchoolCalcStudySessionRepository.getByCode must be implemented');
  }

  async create(_studySession) {
    throw new Error('ISchoolCalcStudySessionRepository.create must be implemented');
  }

  async bindResolution(_args) {
    throw new Error('ISchoolCalcStudySessionRepository.bindResolution must be implemented');
  }

  async close(_args) {
    throw new Error('ISchoolCalcStudySessionRepository.close must be implemented');
  }
}

export default ISchoolCalcStudySessionRepository;
