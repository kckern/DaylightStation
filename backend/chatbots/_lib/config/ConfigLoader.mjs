/**
 * Configuration loader with environment variable interpolation
 * @module _lib/config/ConfigLoader
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { getSchemaForBot, BotConfigSchema } from './ConfigSchema.mjs';

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
 * Load a YAML configuration file
 * @param {string} filePath - Path to the YAML file
 * @returns {object|null} - Parsed config or null if not found
 */
function loadYamlFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    return yaml.load(content) || {};
  } catch (error) {
    throw new Error(`Failed to load config file ${filePath}: ${error.message}`);
  }
}

/**
 * Get the config directory path
 * @returns {string}
 */
function getConfigDir() {
  // Check for explicit config path in env
  if (process.env.CHATBOT_CONFIG_DIR) {
    return process.env.CHATBOT_CONFIG_DIR;
  }
  // Default to config/ relative to chatbots directory
  return path.join(path.dirname(new URL(import.meta.url).pathname), '../../config');
}

/**
 * Load and validate configuration for a bot
 * @param {string} [botName] - Name of the bot (nutribot, journalist, etc.)
 * @param {object} [options] - Options
 * @param {boolean} [options.skipCache=false] - Skip cache lookup
 * @param {string} [options.configDir] - Override config directory
 * @returns {object} - Validated configuration object (frozen)
 */
export function loadConfig(botName = null, options = {}) {
  const { skipCache = false, configDir = getConfigDir() } = options;
  
  // Check cache
  const cacheKey = botName || '_common';
  if (!skipCache && configCache.has(cacheKey)) {
    return configCache.get(cacheKey);
  }
  
  // Load common config
  const commonPath = path.join(configDir, '_common.yml');
  let config = loadYamlFile(commonPath) || {};
  
  // Merge bot-specific config if provided
  if (botName) {
    const botPath = path.join(configDir, `${botName}.yml`);
    const botConfig = loadYamlFile(botPath);
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
  
  // Validate against schema
  const schema = botName ? getSchemaForBot(botName) : BotConfigSchema;
  const result = schema.safeParse(config);
  
  if (!result.success) {
    const errors = result.error.issues.map(issue => 
      `${issue.path.join('.')}: ${issue.message}`
    ).join('\n');
    throw new Error(`Configuration validation failed:\n${errors}`);
  }
  
  // Freeze and cache
  const frozenConfig = Object.freeze(result.data);
  configCache.set(cacheKey, frozenConfig);
  
  return frozenConfig;
}

/**
 * Clear the configuration cache
 * Useful for testing
 */
export function clearConfigCache() {
  configCache.clear();
}

/**
 * Get the current cache state (for testing)
 * @returns {Map<string, object>}
 */
export function getConfigCache() {
  return configCache;
}

export default {
  loadConfig,
  clearConfigCache,
  getConfigCache,
  interpolateEnvVars,
  deepMerge,
};
