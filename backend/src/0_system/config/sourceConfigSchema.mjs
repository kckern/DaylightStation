// backend/src/0_system/config/sourceConfigSchema.mjs

/**
 * Normalize source configuration from legacy or new format into a unified shape.
 *
 * New format:
 *   { sources: { plex: { driver: 'plex', host: '...' }, ... } }
 *
 * Legacy format:
 *   { adapters: { plex: { host: '...' } }, integrations: { plex: { token: '...' } } }
 *
 * Output: { plex: { driver: 'plex', host: '...', token: '...' }, ... }
 */

const DRIVER_INFERENCE = {
  plex: 'plex',
  immich: 'immich',
  audiobookshelf: 'audiobookshelf',
  komga: 'komga',
};

/**
 * @param {Object} rawConfig - Raw config (either new or legacy format)
 * @returns {Object<string, Object>} Normalized source config map
 */
export function normalizeSourceConfig(rawConfig) {
  // New format: { sources: { name: { driver, ...config } } }
  if (rawConfig.sources) {
    return { ...rawConfig.sources };
  }

  // Legacy format: { adapters: { name: config }, integrations: { name: config } }
  const result = {};
  const adapters = rawConfig.adapters || rawConfig;
  const integrations = rawConfig.integrations || {};

  for (const [name, config] of Object.entries(adapters)) {
    if (!config || typeof config !== 'object') continue;
    const driver = config.driver || DRIVER_INFERENCE[name] || 'filesystem';
    result[name] = { driver, ...config, ...(integrations[name] || {}) };
  }

  return result;
}
