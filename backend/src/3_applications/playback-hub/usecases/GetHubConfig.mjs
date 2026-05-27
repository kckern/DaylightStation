/**
 * GetHubConfig use case.
 *
 * Returns the validated HubConfig aggregate from the repository. Used by the
 * `GET /api/v1/playback-hub/config` route — the frontend renders the per-card
 * configuration (volume bounds, schedules, scheduled fires, HA bindings) from
 * the aggregate's contents.
 *
 * No transformation here — the aggregate's `toYaml()` is reserved for the
 * persistence boundary; consumers use the domain getters directly.
 */

export class GetHubConfig {
  /** @type {import('../ports/IHubConfigRepository.mjs').IHubConfigRepository} */ #repo;
  /** @type {object} */ #logger;

  /**
   * @param {{
   *   hubConfigRepository: import('../ports/IHubConfigRepository.mjs').IHubConfigRepository,
   *   logger?: object
   * }} deps
   */
  constructor({ hubConfigRepository, logger } = {}) {
    if (!hubConfigRepository) {
      throw new Error('GetHubConfig: hubConfigRepository required');
    }
    this.#repo = hubConfigRepository;
    this.#logger = logger || console;
  }

  /**
   * @returns {Promise<import('../../../2_domains/playback-hub/entities/HubConfig.mjs').HubConfig>}
   */
  async execute() {
    return this.#repo.getConfig();
  }
}

export default GetHubConfig;
