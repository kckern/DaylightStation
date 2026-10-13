/**
 * IHubConfigRepository - Port interface for the HubConfig aggregate's
 * persistence boundary.
 *
 * Implementations include the production YamlHubConfigDatastore (Phase 3) and
 * the in-memory FakeHubConfigRepository used by use-case tests.
 *
 * Contract:
 *
 * getConfig(): Promise<HubConfig>
 *   Returns the latest persisted aggregate. May throw EntityNotFoundError if
 *   the file does not yet exist (deferred to the adapter).
 *
 * saveConfig(hubConfig: HubConfig): Promise<void>
 *   Atomically writes the aggregate. Implementations must serialize concurrent
 *   saves so two parallel callers do not lose writes — the production
 *   datastore uses an in-process mutex (see Phase 3 design).
 */

/**
 * Abstract base class. Throws on direct method use to surface missing
 * implementations early in tests and adapters.
 */
export class IHubConfigRepository {
  /**
   * @returns {Promise<import('../../../2_domains/playback-hub/entities/HubConfig.mjs').HubConfig>}
   */
  async getConfig() {
    throw new Error('IHubConfigRepository.getConfig must be implemented');
  }

  /**
   * @param {import('../../../2_domains/playback-hub/entities/HubConfig.mjs').HubConfig} hubConfig
   * @returns {Promise<void>}
   */
  async saveConfig(hubConfig) {
    throw new Error('IHubConfigRepository.saveConfig must be implemented');
  }
}

/**
 * Structural type-check for IHubConfigRepository implementers.
 * @param {object} obj
 * @returns {boolean}
 */
export function isHubConfigRepository(obj) {
  return Boolean(obj) && typeof obj.getConfig === 'function' && typeof obj.saveConfig === 'function';
}

export default IHubConfigRepository;
