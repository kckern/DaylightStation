/**
 * DeleteScheduledFire use case.
 *
 * Removes a scheduled fire by id and persists the new HubConfig.
 * Unknown id → EntityNotFoundError (from HubConfig.removeScheduledFire);
 * the save is NOT attempted.
 */

export class DeleteScheduledFire {
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
      throw new Error('DeleteScheduledFire: hubConfigRepository required');
    }
    this.#repo = hubConfigRepository;
    this.#logger = logger || console;
  }

  /**
   * @param {{ id: string }} input
   * @returns {Promise<void>}
   */
  async execute({ id } = {}) {
    if (typeof id !== 'string' || id.length === 0) {
      const err = new Error('DeleteScheduledFire.id must be a non-empty string');
      err.code = 'INVALID_INPUT';
      throw err;
    }
    const config = await this.#repo.getConfig();
    // Throws EntityNotFoundError on unknown id; saveConfig is correctly skipped.
    const newConfig = config.removeScheduledFire(id);
    await this.#repo.saveConfig(newConfig);
    this.#logger.info?.('playback-hub.config.updated', { what: 'fire', id, deleted: true });
  }
}

export default DeleteScheduledFire;
