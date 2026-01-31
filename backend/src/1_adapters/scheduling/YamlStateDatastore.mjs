/**
 * YamlStateDatastore - Persists job runtime state to YAML files
 *
 * Stores state in: {dataDir}/system/state/cron-runtime.yml
 * Backup in: {dataDir}/system/state/cron-runtime_bak.yml
 *
 * Uses DataService for filesystem abstraction - adapter does not
 * interact with filesystem directly.
 */

import { JobState } from '#domains/scheduling/entities/JobState.mjs';
import { IStateDatastore } from '#apps/scheduling/ports/IStateDatastore.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const STATE_PATH = 'state/cron-runtime';
const BACKUP_PATH = 'state/cron-runtime_bak';

export class YamlStateDatastore extends IStateDatastore {
  #dataService;
  #logger;

  constructor({ dataService, logger = console }) {
    super();
    if (!dataService) {
      throw new InfrastructureError('YamlStateDatastore requires dataService', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'dataService'
      });
    }
    this.#dataService = dataService;
    this.#logger = logger;
  }

  /**
   * Load raw state object from file
   */
  loadRawState() {
    try {
      const state = this.#dataService.system.read(STATE_PATH);
      if (state && typeof state === 'object') {
        return state;
      }

      // Try backup
      const backup = this.#dataService.system.read(BACKUP_PATH);
      if (backup && typeof backup === 'object') {
        this.#logger.info?.('scheduler.stateStore.restored_from_backup');
        this.#dataService.system.write(STATE_PATH, backup);
        return backup;
      }

      return {};
    } catch (error) {
      this.#logger.error?.('scheduler.stateStore.load_error', {
        error: error.message
      });
      return {};
    }
  }

  /**
   * Load all job states
   * @returns {Promise<Map<string, JobState>>}
   */
  async loadStates() {
    const rawState = this.loadRawState();
    const states = new Map();

    for (const [jobId, stateData] of Object.entries(rawState)) {
      states.set(jobId, JobState.fromObject(jobId, stateData));
    }

    return states;
  }

  /**
   * Get state for a specific job
   * @param {string} jobId
   * @returns {Promise<JobState|null>}
   */
  async getState(jobId) {
    const states = await this.loadStates();
    return states.get(jobId) || null;
  }

  /**
   * Save state for a specific job
   * @param {string} jobId
   * @param {JobState} state
   * @returns {Promise<void>}
   */
  async saveState(jobId, state) {
    const rawState = this.loadRawState();
    rawState[jobId] = state.toJSON();

    const result = this.#dataService.system.write(STATE_PATH, rawState);
    if (!result) {
      this.#logger.error?.('scheduler.stateStore.save_error', { jobId });
      throw new Error(`Failed to save state for job ${jobId}`);
    }
  }

  /**
   * Save all job states
   * @param {Map<string, JobState>} states
   * @returns {Promise<void>}
   */
  async saveAllStates(states) {
    const rawState = {};
    for (const [jobId, state] of states) {
      rawState[jobId] = state.toJSON();
    }

    const result = this.#dataService.system.write(STATE_PATH, rawState);
    if (!result) {
      this.#logger.error?.('scheduler.stateStore.saveAll_error');
      throw new Error('Failed to save all states');
    }
  }

  /**
   * Backup current state
   * @returns {Promise<void>}
   */
  async backup() {
    const rawState = this.loadRawState();

    const result = this.#dataService.system.write(BACKUP_PATH, rawState);
    if (result) {
      this.#logger.debug?.('scheduler.stateStore.backup_success');
    } else {
      this.#logger.error?.('scheduler.stateStore.backup_error');
    }
  }
}

export default YamlStateDatastore;
