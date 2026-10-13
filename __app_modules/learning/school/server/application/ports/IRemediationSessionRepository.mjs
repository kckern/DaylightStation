/** Durable, idempotent storage boundary for adaptive remediation sessions. */
export class IRemediationSessionRepository {
  async createOffer(session) { // eslint-disable-line no-unused-vars
    throw new Error('IRemediationSessionRepository.createOffer must be implemented');
  }

  async getSession(sessionId) { // eslint-disable-line no-unused-vars
    throw new Error('IRemediationSessionRepository.getSession must be implemented');
  }

  async listAvailable({ surface, endpointId, learnerIds }) { // eslint-disable-line no-unused-vars
    throw new Error('IRemediationSessionRepository.listAvailable must be implemented');
  }

  /**
   * Atomically claim one monotonically sequenced client action.
   * @returns {Promise<{status:'new'|'resume'|'duplicate'|'busy'|'conflict'|'out_of_order', session:object, action?:object, response?:object}>}
   */
  async claimAction(claim) { // eslint-disable-line no-unused-vars
    throw new Error('IRemediationSessionRepository.claimAction must be implemented');
  }

  async completeAction(completion) { // eslint-disable-line no-unused-vars
    throw new Error('IRemediationSessionRepository.completeAction must be implemented');
  }

  async failAction(failure) { // eslint-disable-line no-unused-vars
    throw new Error('IRemediationSessionRepository.failAction must be implemented');
  }
}

export default IRemediationSessionRepository;
