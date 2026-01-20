/**
 * YamlStateStore - Persists job runtime state to YAML files
 *
 * Stores state in: system/state/cron-runtime
 * Backup in: system/state/cron-runtime_bak
 */

import { JobState } from '../../1_domains/scheduling/entities/JobState.mjs';
import { IStateStore } from '../../1_domains/scheduling/ports/IStateStore.mjs';

export class YamlStateStore extends IStateStore {
  constructor({ loadFile, saveFile, logger = console }) {
    super();
    this.loadFile = loadFile;
    this.saveFile = saveFile;
    this.logger = logger;
    this.statePath = 'system/state/cron-runtime';
    this.backupPath = 'system/state/cron-runtime_bak';
  }

  /**
   * Load raw state object from file
   */
  loadRawState() {
    try {
      const state = this.loadFile(this.statePath);
      if (state && typeof state === 'object') {
        return state;
      }

      // Try backup
      const backup = this.loadFile(this.backupPath);
      if (backup && typeof backup === 'object') {
        this.logger.info?.('scheduler.stateStore.restored_from_backup');
        this.saveFile(this.statePath, backup);
        return backup;
      }

      return {};
    } catch (error) {
      this.logger.error?.('scheduler.stateStore.load_error', {
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

    try {
      this.saveFile(this.statePath, rawState);
    } catch (error) {
      this.logger.error?.('scheduler.stateStore.save_error', {
        jobId,
        error: error.message
      });
      throw error;
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

    try {
      this.saveFile(this.statePath, rawState);
    } catch (error) {
      this.logger.error?.('scheduler.stateStore.saveAll_error', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Backup current state
   * @returns {Promise<void>}
   */
  async backup() {
    const rawState = this.loadRawState();

    try {
      this.saveFile(this.backupPath, rawState);
      this.logger.debug?.('scheduler.stateStore.backup_success');
    } catch (error) {
      this.logger.error?.('scheduler.stateStore.backup_error', {
        error: error.message
      });
    }
  }
}

export default YamlStateStore;
