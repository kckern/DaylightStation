/**
 * UpdateDeviceConfig use case.
 *
 * Patches a single HubDevice within the HubConfig aggregate and persists the
 * new aggregate. Returns the updated HubDevice.
 *
 * IMPORTANT — saving new volume bounds does NOT retroactively clamp a running
 * mpv on the hub. New bounds take effect on the next playback start (headset
 * reconnect, scheduled fire, or explicit Play Now). See design's note in the
 * `UpdateDeviceConfig` section. The frontend communicates this via tooltip.
 *
 * Failure semantics:
 *   - Unknown color → EntityNotFoundError (from HubConfig.findDevice).
 *   - Domain invariant violation (e.g. public class loses ha_entity_id) →
 *     thrown from HubDevice constructor; the save is NOT attempted.
 */

export class UpdateDeviceConfig {
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
      throw new Error('UpdateDeviceConfig: hubConfigRepository required');
    }
    this.#repo = hubConfigRepository;
    this.#logger = logger || console;
  }

  /**
   * @param {{ color: string, patch: object }} input
   * @returns {Promise<import('../../../2_domains/playback-hub/entities/HubDevice.mjs').HubDevice>}
   */
  async execute({ color, patch } = {}) {
    if (typeof color !== 'string' || color.length === 0) {
      const err = new Error('UpdateDeviceConfig.color must be a non-empty string');
      err.code = 'INVALID_INPUT';
      throw err;
    }
    if (!patch || typeof patch !== 'object') {
      const err = new Error('UpdateDeviceConfig.patch must be an object');
      err.code = 'INVALID_INPUT';
      throw err;
    }
    const config = await this.#repo.getConfig();
    // findDevice throws EntityNotFoundError on unknown color.
    config.findDevice(color);
    // patchDevice returns a NEW HubConfig; throws on invariant violation
    // BEFORE we get a chance to save, so saveConfig is correctly skipped.
    const newConfig = config.patchDevice(color, patch);
    await this.#repo.saveConfig(newConfig);
    this.#logger.info?.('playback-hub.config.updated', { what: 'device', id: color });
    return newConfig.findDevice(color);
  }
}

export default UpdateDeviceConfig;
