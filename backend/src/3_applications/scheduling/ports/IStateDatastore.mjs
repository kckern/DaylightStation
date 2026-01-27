/**
 * IStateDatastore - Interface for job runtime state persistence
 *
 * Implementations:
 * - YamlStateStore: Persists to system/state/cron-runtime
 */
export class IStateDatastore {
  /**
   * Load all job states
   * @returns {Promise<Map<string, import('../entities/JobState.mjs').JobState>>}
   */
  async loadStates() {
    throw new Error('Not implemented');
  }

  /**
   * Get state for a specific job
   * @param {string} jobId
   * @returns {Promise<import('../entities/JobState.mjs').JobState|null>}
   */
  async getState(jobId) {
    throw new Error('Not implemented');
  }

  /**
   * Save state for a specific job
   * @param {string} jobId
   * @param {import('../entities/JobState.mjs').JobState} state
   * @returns {Promise<void>}
   */
  async saveState(jobId, state) {
    throw new Error('Not implemented');
  }

  /**
   * Save all job states
   * @param {Map<string, import('../entities/JobState.mjs').JobState>} states
   * @returns {Promise<void>}
   */
  async saveAllStates(states) {
    throw new Error('Not implemented');
  }

  /**
   * Backup current state
   * @returns {Promise<void>}
   */
  async backup() {
    throw new Error('Not implemented');
  }
}

export default IStateDatastore;
