/**
 * ScriptureHarvester
 *
 * Fetches scripture passages from Scripture Guide API.
 * Implements IHarvester interface with circuit breaker resilience.
 *
 * Note: This is more of a content fetch service than a lifelog harvester.
 * It caches scripture passages for offline/quick access.
 *
 * Features:
 * - Reference-based fetching
 * - Multi-version support (LDS, redc, etc.)
 * - Volume-based file organization
 *
 * @module harvester/other/ScriptureHarvester
 */

import { IHarvester, HarvesterCategory } from '../ports/IHarvester.mjs';
import { CircuitBreaker } from '../CircuitBreaker.mjs';

/**
 * Scripture content harvester
 * @implements {IHarvester}
 */
export class ScriptureHarvester extends IHarvester {
  #httpClient;
  #contentStore;
  #circuitBreaker;
  #logger;

  // Volume ID ranges for file organization
  static VOLUMES = {
    ot: 1,
    nt: 23146,
    bom: 31103,
    dc: 37707,
    pgp: 41361,
    lof: 41996,
  };

  static BASE_URL = 'https://raw.scripture.guide';
  static DEFAULT_VERSION = 'LDS';

  /**
   * @param {Object} config
   * @param {Object} config.httpClient - HTTP client for API requests
   * @param {Object} config.contentStore - Store for scripture content
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({
    httpClient,
    contentStore,
    logger = console,
  }) {
    super();

    if (!httpClient) {
      throw new Error('ScriptureHarvester requires httpClient');
    }
    if (!contentStore) {
      throw new Error('ScriptureHarvester requires contentStore');
    }

    this.#httpClient = httpClient;
    this.#contentStore = contentStore;
    this.#logger = logger;

    this.#circuitBreaker = new CircuitBreaker({
      maxFailures: 3,
      baseCooldownMs: 5 * 60 * 1000,
      maxCooldownMs: 30 * 60 * 1000,
      logger: logger,
    });
  }

  get serviceId() {
    return 'scripture';
  }

  get category() {
    return HarvesterCategory.OTHER;
  }

  /**
   * Harvest scripture passage from Scripture Guide
   *
   * @param {string} username - Target user (unused, scripture is shared content)
   * @param {Object} [options] - Harvest options
   * @param {string} [options.ref='Gen 1'] - Scripture reference
   * @param {string} [options.version='LDS'] - Scripture version
   * @returns {Promise<{ status: string, verseCount: number }>}
   */
  async harvest(username, options = {}) {
    const { ref = 'Gen 1', version = ScriptureHarvester.DEFAULT_VERSION } = options;

    // Check circuit breaker
    if (this.#circuitBreaker.isOpen()) {
      const cooldown = this.#circuitBreaker.getCooldownStatus();
      this.#logger.debug?.('scripture.harvest.skipped', {
        ref,
        reason: 'Circuit breaker active',
        remainingMins: cooldown?.remainingMins,
      });
      return {
        status: 'skipped',
        reason: 'cooldown',
        remainingMins: cooldown?.remainingMins,
      };
    }

    try {
      this.#logger.info?.('scripture.harvest.start', { ref, version });

      // Fetch primary version
      const url = `${ScriptureHarvester.BASE_URL}/${version}/${ref.replace(' ', '+')}`;
      const { data } = await this.#httpClient.get(url);

      // For 'redc' version, merge headings from default version
      if (version === 'redc') {
        const altUrl = `${ScriptureHarvester.BASE_URL}/${ScriptureHarvester.DEFAULT_VERSION}/${ref.replace(' ', '+')}`;
        const { data: altData } = await this.#httpClient.get(altUrl);

        for (const key of Object.keys(altData)) {
          data[key].headings = {
            ...altData[key].headings,
            ...data[key].headings,
          };
          if (!Object.keys(data[key].headings || {}).length) {
            delete data[key].headings;
          }
        }
      }

      // Determine volume from first verse ID
      const firstVerseId = Object.keys(data)[0];
      const volume = this.#findVolume(parseInt(firstVerseId));

      // Save to content store
      await this.#contentStore.save(volume, version, firstVerseId, Object.values(data));

      // Success - reset circuit breaker
      this.#circuitBreaker.recordSuccess();

      this.#logger.info?.('scripture.harvest.complete', {
        ref,
        version,
        volume,
        verseCount: Object.keys(data).length,
      });

      return {
        status: 'success',
        ref,
        version,
        volume,
        verseCount: Object.keys(data).length,
        data,
      };

    } catch (error) {
      this.#circuitBreaker.recordFailure(error);

      this.#logger.error?.('scripture.harvest.error', {
        ref,
        version,
        error: error.message,
        circuitState: this.#circuitBreaker.getStatus().state,
      });

      throw error;
    }
  }

  getStatus() {
    return this.#circuitBreaker.getStatus();
  }

  /**
   * Find volume name from verse ID
   * @private
   */
  #findVolume(verseId) {
    const volumes = Object.entries(ScriptureHarvester.VOLUMES);
    const [volume] = volumes.reduce((prev, curr) => {
      return verseId >= curr[1] ? curr : prev;
    });
    return volume;
  }
}

export default ScriptureHarvester;
