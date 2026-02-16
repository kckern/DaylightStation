// backend/src/3_applications/feed/services/ScrollConfigLoader.mjs
/**
 * ScrollConfigLoader
 *
 * Reads per-user scroll config from DataService and deep-merges
 * with hardcoded defaults. If no user config file exists, defaults
 * are returned unchanged.
 *
 * Consumed by FeedAssemblyService to control interleaving ratios,
 * spacing rules, and per-source distribution caps.
 *
 * @module applications/feed/services
 */

const DEFAULTS = Object.freeze({
  batch_size: 15,
  algorithm: Object.freeze({
    grounding_ratio: 5,
    decay_rate: 0.85,
    min_ratio: 2,
  }),
  focus_mode: Object.freeze({
    grounding_ratio: 8,
    decay_rate: 0.9,
    min_ratio: 3,
  }),
  spacing: Object.freeze({
    max_consecutive: 1,
  }),
  sources: Object.freeze({}),
});

export class ScrollConfigLoader {
  #dataService;

  constructor({ dataService }) {
    this.#dataService = dataService;
  }

  /**
   * Load scroll config for a user, merging overrides with defaults.
   *
   * @param {string} username
   * @returns {Object} Merged scroll config
   */
  load(username) {
    const userConfig = this.#dataService.user.read('config/scroll', username) || {};
    return this.#merge(userConfig);
  }

  #merge(user) {
    return {
      batch_size: user.batch_size ?? DEFAULTS.batch_size,
      algorithm: {
        ...DEFAULTS.algorithm,
        ...user.algorithm,
      },
      focus_mode: {
        ...DEFAULTS.focus_mode,
        ...user.focus_mode,
      },
      spacing: {
        ...DEFAULTS.spacing,
        ...user.spacing,
      },
      sources: {
        ...DEFAULTS.sources,
        ...user.sources,
      },
    };
  }
}
