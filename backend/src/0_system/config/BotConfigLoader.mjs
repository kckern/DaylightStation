/**
 * Bot Configuration Loader
 *
 * Loads chatbot-specific YAML configuration with:
 * - Environment variable interpolation (${VAR_NAME})
 * - Deep merging of _common.yml with bot-specific config
 * - Optional schema validation via Zod
 *
 * @module infrastructure/config/BotConfigLoader
 */

import path from 'path';
import { loadYaml } from '../utils/FileIO.mjs';

/**
 * Environment variable interpolation pattern
 */
const ENV_VAR_PATTERN = /\$\{([^}]+)\}/g;

/**
 * Cache for loaded configurations
 * @type {Map<string, object>}
 */
const configCache = new Map();

/**
 * Interpolate environment variables in a value
 * Supports ${VAR_NAME} syntax
 * @param {any} value - Value to interpolate
 * @returns {any} - Interpolated value
 */
function interpolateEnvVars(value) {
  if (typeof value === 'string') {
    return value.replace(ENV_VAR_PATTERN, (match, envVar) => {
      const envValue = process.env[envVar];
      if (envValue === undefined) {
        // Return empty string for undefined env vars to allow optional config
        return '';
      }
      return envValue;
    });
  }

  if (Array.isArray(value)) {
    return value.map(item => interpolateEnvVars(item));
  }

  if (value !== null && typeof value === 'object') {
    const result = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = interpolateEnvVars(val);
    }
    return result;
  }

  return value;
}

/**
 * Deep merge two objects
 * Arrays are replaced, not concatenated
 * @param {object} base - Base object
 * @param {object} override - Override object
 * @returns {object} - Merged object
 */
function deepMerge(base, override) {
  if (!override) return base;
  if (!base) return override;

  const result = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Load and merge bot configuration
 * @param {string} botName - Name of the bot (nutribot, journalist, etc.)
 * @param {object} options - Options
 * @param {string} options.configDir - Directory containing config files
 * @param {boolean} [options.skipCache=false] - Skip cache lookup
 * @param {object} [options.schema] - Zod schema for validation (optional)
 * @returns {object} - Configuration object (frozen)
 */
export function loadBotConfig(botName, options = {}) {
  const { configDir, skipCache = false, schema = null } = options;

  if (!configDir) {
    throw new Error('configDir is required');
  }

  // Check cache
  const cacheKey = `${configDir}:${botName || '_common'}`;
  if (!skipCache && configCache.has(cacheKey)) {
    return configCache.get(cacheKey);
  }

  // Load common config
  const commonPath = path.join(configDir, '_common');
  let config = loadYaml(commonPath) || {};

  // Merge bot-specific config if provided
  if (botName) {
    const botPath = path.join(configDir, botName);
    const botConfig = loadYaml(botPath);
    if (botConfig) {
      config = deepMerge(config, botConfig);
    }
  }

  // Interpolate environment variables
  config = interpolateEnvVars(config);

  // Add default paths from environment if not specified
  if (!config.paths) {
    config.paths = {};
  }
  if (!config.paths.data && process.env.path?.data) {
    config.paths.data = process.env.path.data;
  }
  if (!config.paths.data && process.env.DATA_PATH) {
    config.paths.data = process.env.DATA_PATH;
  }

  // Validate against schema if provided
  if (schema) {
    const result = schema.safeParse(config);
    if (!result.success) {
      const errors = result.error.issues.map(issue =>
        `${issue.path.join('.')}: ${issue.message}`
      ).join('\n');
      throw new Error(`Configuration validation failed for ${botName}:\n${errors}`);
    }
    config = result.data;
  }

  // Freeze and cache
  const frozenConfig = Object.freeze(config);
  configCache.set(cacheKey, frozenConfig);

  return frozenConfig;
}

/**
 * Clear the configuration cache
 * Useful for testing
 */
export function clearBotConfigCache() {
  configCache.clear();
}

/**
 * Get the current cache state (for testing)
 * @returns {Map<string, object>}
 */
export function getBotConfigCache() {
  return configCache;
}

export { interpolateEnvVars, deepMerge };

export default {
  loadBotConfig,
  clearBotConfigCache,
  getBotConfigCache,
  interpolateEnvVars,
  deepMerge,
};
