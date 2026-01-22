/**
 * Logging Configuration
 *
 * Loads logging configuration from YAML files and environment variables.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_CONFIG = {
  defaultLevel: 'info',
  loggers: {},
  tags: ['backend']
};

let cachedConfig = null;

/**
 * Safe YAML reader that returns {} on failure
 */
function safeReadYaml(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    const content = fs.readFileSync(filePath, 'utf8');
    return yaml.load(content) || {};
  } catch (err) {
    console.error(`[config] Failed to read ${filePath}:`, err.message);
    return {};
  }
}

/**
 * Apply environment variable overrides for logger levels
 * Format: LOG_LEVEL_<LOGGER_NAME>=<level>
 * Example: LOG_LEVEL_FITNESS__SESSION=debug (maps to fitness/session)
 */
function applyEnvOverrides(config) {
  const out = { ...config, loggers: { ...(config.loggers || {}) } };

  Object.entries(process.env || {}).forEach(([key, value]) => {
    if (!key.startsWith('LOG_LEVEL_')) return;
    const loggerName = key
      .replace(/^LOG_LEVEL_/, '')
      .toLowerCase()
      .replace(/__/g, '/')
      .replace(/_/g, '.');
    if (!loggerName) return;
    out.loggers[loggerName] = String(value || '').toLowerCase();
  });

  return out;
}

/**
 * Load logging configuration
 * @param {string} baseDir - Base directory for config files
 * @returns {Object} Logging configuration
 */
export function loadLoggingConfig(baseDir = null) {
  if (cachedConfig) return cachedConfig;

  // Default to project root (4 levels up from this file)
  const configDir = baseDir || path.resolve(__dirname, '../../../..');

  // Auto-detect environment
  const isProduction = fs.existsSync('/.dockerenv') || process.env.NODE_ENV === 'production';

  const loggingPath = path.join(configDir, 'config', 'logging.yml');
  const fileConfig = safeReadYaml(loggingPath);

  // Merge configs with environment-based defaults
  let merged = { ...DEFAULT_CONFIG, ...fileConfig };

  // Auto-adjust defaultLevel based on environment (if not explicitly set)
  if (!fileConfig.defaultLevel) {
    merged.defaultLevel = isProduction ? 'info' : 'debug';
  }

  // Apply environment variable overrides (highest priority)
  merged = applyEnvOverrides(merged);

  cachedConfig = merged;
  return merged;
}

/**
 * Reset cached config (useful for testing)
 */
export function resetLoggingConfig() {
  cachedConfig = null;
}

/**
 * Hydrate process.env from config files
 * @param {string} baseDir - Base directory for config files
 * @returns {Object} Merged configuration
 */
export function hydrateProcessEnvFromConfigs(baseDir = null) {
  const configDir = baseDir || path.resolve(__dirname, '../../../..');
  const isDocker = fs.existsSync('/.dockerenv');

  // Load from config structure
  const systemConfig = safeReadYaml(path.join(configDir, 'system.yml'));
  const secretsConfig = safeReadYaml(path.join(configDir, 'config.secrets.yml'));

  // Machine-specific config: DAYLIGHT_ENV > Docker > hostname > legacy fallback
  let localConfigFile = null;
  if (process.env.DAYLIGHT_ENV) {
    const envFile = `system-local.${process.env.DAYLIGHT_ENV}.yml`;
    if (fs.existsSync(path.join(configDir, envFile))) {
      localConfigFile = envFile;
    }
  }
  if (!localConfigFile && isDocker) {
    const dockerFile = 'system-local.docker.yml';
    if (fs.existsSync(path.join(configDir, dockerFile))) {
      localConfigFile = dockerFile;
    }
  }
  if (!localConfigFile) {
    const hostname = os.hostname();
    const hostFile = `system-local.${hostname}.yml`;
    if (fs.existsSync(path.join(configDir, hostFile))) {
      localConfigFile = hostFile;
    }
  }
  if (!localConfigFile && fs.existsSync(path.join(configDir, 'system-local.yml'))) {
    localConfigFile = 'system-local.yml';
  }

  const localConfig = localConfigFile ? safeReadYaml(path.join(configDir, localConfigFile)) : {};

  const merged = { ...systemConfig, ...secretsConfig, ...localConfig };
  process.env = { ...process.env, ...merged };
  return merged;
}

/**
 * Resolve log level for a specific logger
 * @param {string} name - Logger name (e.g., 'fitness/session')
 * @param {Object} config - Optional config override
 * @returns {string} Log level
 */
export function resolveLoggerLevel(name, config = null) {
  const cfg = config || loadLoggingConfig();
  if (!name) return cfg.defaultLevel || 'info';
  return cfg.loggers?.[name] || cfg.loggers?.[name.toLowerCase?.()] || cfg.defaultLevel || 'info';
}

/**
 * Get logging tags
 * @param {Object} config - Optional config override
 * @returns {string[]} Tags
 */
export function getLoggingTags(config = null) {
  const cfg = config || loadLoggingConfig();
  return cfg.tags || ['backend'];
}

/**
 * Resolve Loggly token from environment
 */
export function resolveLogglyToken() {
  return process.env.LOGGLY_TOKEN || process.env.LOGGLY_INPUT_TOKEN;
}

/**
 * Resolve Loggly subdomain from environment
 */
export function resolveLogglySubdomain() {
  return process.env.LOGGLY_SUBDOMAIN || process.env.LOGGLY_SUB_DOMAIN;
}

export default loadLoggingConfig;
