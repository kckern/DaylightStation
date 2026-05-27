/**
 * FakeHubConfigRepository - In-memory IHubConfigRepository double for
 * use-case tests.
 *
 * NOT a production adapter. Lives under `test/` (not `usecases/`) to make its
 * non-production status obvious. The Phase 3 YamlHubConfigDatastore is the
 * production implementation.
 *
 * Features:
 *   - setConfig(hubConfig)  — seed the stored aggregate
 *   - getConfig()           — return seeded aggregate; throws if unset
 *   - saveConfig(hubConfig) — record `lastSaved`, replace stored aggregate
 *   - lastSaved             — last HubConfig passed to saveConfig
 *   - saveCount             — call count for assertions
 */

import { IHubConfigRepository } from '../ports/IHubConfigRepository.mjs';
import { HubConfig } from '../../../2_domains/playback-hub/entities/HubConfig.mjs';
import { EntityNotFoundError } from '../../../2_domains/core/errors/EntityNotFoundError.mjs';

export class FakeHubConfigRepository extends IHubConfigRepository {
  /** @type {HubConfig|null} */ #config;
  /** @type {HubConfig|null} */ lastSaved = null;
  /** @type {number} */ saveCount = 0;
  /** @type {Error|null} */ #saveError = null;

  /**
   * @param {{ config?: HubConfig|null }} [opts]
   */
  constructor({ config = null } = {}) {
    super();
    this.#config = config;
  }

  /**
   * Seed (or replace) the stored aggregate.
   * @param {HubConfig} hubConfig
   */
  setConfig(hubConfig) {
    if (!(hubConfig instanceof HubConfig)) {
      throw new Error('FakeHubConfigRepository.setConfig requires a HubConfig instance');
    }
    this.#config = hubConfig;
  }

  /**
   * Make the NEXT saveConfig() call reject. Single-shot.
   * @param {Error} err
   */
  setSaveError(err) {
    this.#saveError = err;
  }

  /**
   * @override
   * @returns {Promise<HubConfig>}
   */
  async getConfig() {
    if (!this.#config) {
      throw new EntityNotFoundError('HubConfig', 'default');
    }
    return this.#config;
  }

  /**
   * @override
   * @param {HubConfig} hubConfig
   * @returns {Promise<void>}
   */
  async saveConfig(hubConfig) {
    if (!(hubConfig instanceof HubConfig)) {
      throw new Error('FakeHubConfigRepository.saveConfig requires a HubConfig instance');
    }
    if (this.#saveError) {
      const err = this.#saveError;
      this.#saveError = null;
      throw err;
    }
    this.lastSaved = hubConfig;
    this.saveCount += 1;
    this.#config = hubConfig;
  }
}

export default FakeHubConfigRepository;
