/**
 * Config Loader
 *
 * Unified configuration loading with clear precedence order.
 * Handles YAML parsing, merging, and environment awareness.
 *
 * Config now lives in data/system/ directory.
 * Supports both new names (system.yml) and legacy names (app.yml, config.app.yml).
 *
 * Precedence (highest wins):
 * 1. Environment variables (PORT, DAYLIGHT_ENV, etc.)
 * 2. Machine-specific file (system-local.{hostname}.yml or system-local.docker.yml)
 * 3. Legacy system-local.yml (backwards compatibility)
 * 4. secrets.yml
 * 5. apps/*.yml (modular app configs)
 * 6. system.yml (main config)
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { parse } from 'yaml';

/**
 * Determine which machine-specific config file to load.
 * Detection order: DAYLIGHT_ENV > Docker > hostname > legacy fallback
 *
 * @param {string} configDir - Config directory path
 * @param {boolean} isDocker - Whether running in Docker
 * @returns {string|null} - Config filename to load, or null if none found
 */
function getMachineConfigFile(configDir, isDocker) {
  // 1. Explicit override via env var
  if (process.env.DAYLIGHT_ENV) {
    const envFile = `system-local.${process.env.DAYLIGHT_ENV}.yml`;
    if (fs.existsSync(path.join(configDir, envFile))) {
      return envFile;
    }
    console.warn(`[Config] DAYLIGHT_ENV=${process.env.DAYLIGHT_ENV} but ${envFile} not found, falling back`);
  }

  // 2. Docker auto-detect
  if (isDocker) {
    const dockerFile = 'system-local.docker.yml';
    if (fs.existsSync(path.join(configDir, dockerFile))) {
      return dockerFile;
    }
  }

  // 3. Hostname-based
  const hostname = os.hostname();
  const hostFile = `system-local.${hostname}.yml`;
  if (fs.existsSync(path.join(configDir, hostFile))) {
    return hostFile;
  }

  // 4. Legacy fallback
  if (fs.existsSync(path.join(configDir, 'system-local.yml'))) {
    return 'system-local.yml';
  }

  return null;
}

/**
 * Safely load and parse a YAML file
 * @param {string} filePath - Path to YAML file
 * @returns {object|null} - Parsed content or null if failed
 */
export function safeLoadYaml(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return parse(content) || {};
    }
  } catch (err) {
    console.error(`[ConfigLoader] Failed to load ${filePath}:`, err.message);
  }
  return null;
}

/**
 * Deep merge objects (later values override earlier)
 * @param {object} target - Base object
 * @param  {...object} sources - Objects to merge in
 * @returns {object} - Merged result
 */
export function deepMerge(target, ...sources) {
  if (!target) target = {};
  
  for (const source of sources) {
    if (!source) continue;
    
    for (const key of Object.keys(source)) {
      const sourceVal = source[key];
      const targetVal = target[key];
      
      // Deep merge objects (but not arrays)
      if (sourceVal && typeof sourceVal === 'object' && !Array.isArray(sourceVal)) {
        if (targetVal && typeof targetVal === 'object' && !Array.isArray(targetVal)) {
          target[key] = deepMerge({ ...targetVal }, sourceVal);
        } else {
          target[key] = deepMerge({}, sourceVal);
        }
      } else {
        target[key] = sourceVal;
      }
    }
  }
  
  return target;
}

/**
 * Try to load a config file, checking new name first then legacy name
 * @param {string} configDir - Config directory
 * @param {string} newName - New file name (e.g., 'system.yml')
 * @param {string} legacyName - Legacy file name (e.g., 'app.yml')
 * @returns {object} - { config, path, isLegacy }
 */
function loadConfigWithFallback(configDir, newName, legacyName) {
  const newPath = path.join(configDir, newName);
  const legacyPath = path.join(configDir, legacyName);

  // Try new name first
  if (fs.existsSync(newPath)) {
    const config = safeLoadYaml(newPath);
    return { config, path: newPath, isLegacy: false };
  }

  // Fall back to legacy name
  if (fs.existsSync(legacyPath)) {
    const config = safeLoadYaml(legacyPath);
    return { config, path: legacyPath, isLegacy: true };
  }

  return { config: null, path: null, isLegacy: false };
}

/**
 * Load all configuration files and merge them
 *
 * @param {object} options
 * @param {string} options.configDir - Directory containing config files
 * @param {string} options.dataDir - Data directory path
 * @param {boolean} options.isDocker - Running in Docker
 * @param {boolean} options.isDev - Development mode
 * @returns {object} - { config, layers, errors }
 */
export function loadAllConfig(options = {}) {
  const { configDir, dataDir, isDocker = false, isDev = false } = options;

  if (!configDir) {
    return {
      config: {},
      layers: [],
      errors: ['No config directory provided']
    };
  }

  const layers = [];
  const errors = [];

  // ============================================================
  // Layer 1: Main system config (system.yml or legacy app.yml)
  // ============================================================
  const appResult = loadConfigWithFallback(configDir, 'system.yml', 'app.yml');
  const appConfig = appResult.config;
  if (appConfig) {
    layers.push({ name: 'app', path: appResult.path, keys: Object.keys(appConfig).length });
  } else if (appResult.path) {
    errors.push(`Failed to parse ${appResult.path}`);
  }

  // ============================================================
  // Layer 2: Legacy system config (for backwards compatibility)
  // Now merged into system.yml, but kept for transition
  // ============================================================
  // No longer needed - system.yml is now the main config

  // ============================================================
  // Layer 3: Modular app configs (apps/*.yml)
  // ============================================================
  const appsDir = path.join(configDir, 'apps');
  let appsConfig = {};
  if (fs.existsSync(appsDir)) {
    try {
      const appFiles = fs.readdirSync(appsDir)
        .filter(f => (f.endsWith('.yml') || f.endsWith('.yaml')) &&
                     !f.includes('.example.') &&
                     !f.startsWith('.') &&
                     !f.startsWith('_'));

      for (const file of appFiles) {
        const appName = file.replace(/\.(yml|yaml)$/, '');
        const appPath = path.join(appsDir, file);
        const config = safeLoadYaml(appPath);
        if (config) {
          appsConfig[appName] = config;
        }
      }

      if (Object.keys(appsConfig).length > 0) {
        layers.push({ name: 'apps', path: appsDir, keys: Object.keys(appsConfig).length });
      }
    } catch (err) {
      errors.push(`Failed to read apps directory: ${err.message}`);
    }
  }

  // ============================================================
  // Layer 4: Secrets (secrets.yml or legacy config.secrets.yml)
  // ============================================================
  const secretsResult = loadConfigWithFallback(configDir, 'secrets.yml', 'config.secrets.yml');
  const secretsConfig = secretsResult.config;
  if (secretsConfig) {
    layers.push({ name: 'secrets', path: secretsResult.path, keys: Object.keys(secretsConfig).length });
  }

  // ============================================================
  // Layer 5: Machine-specific overrides
  // Auto-detects: DAYLIGHT_ENV > Docker > hostname > legacy fallback
  // ============================================================
  let localConfig = null;
  const machineConfigFile = getMachineConfigFile(configDir, isDocker);
  if (machineConfigFile) {
    const localPath = path.join(configDir, machineConfigFile);
    localConfig = safeLoadYaml(localPath);
    if (localConfig) {
      layers.push({
        name: 'local',
        path: localPath,
        keys: Object.keys(localConfig).length,
        source: machineConfigFile
      });
    }
  }

  // ============================================================
  // Merge all layers
  // ============================================================
  const merged = deepMerge(
    {},
    appConfig || {},
    appsConfig,  // App configs go under their app name
    secretsConfig || {},
    localConfig || {}
  );

  // ============================================================
  // Layer 6: Path overrides (highest priority)
  // These come from pathResolver and should always win
  // In non-Docker environments, always derive paths from resolved dataDir
  // to avoid using Docker paths from config files
  // ============================================================
  if (dataDir) {
    const derivedPaths = {
      data: dataDir,
      media: path.join(dataDir, '..', 'media'),
      img: path.join(dataDir, '..', 'media', 'img'),
      font: path.join(dataDir, '..', 'media', 'fonts'),
      icons: path.join(dataDir, '..', 'media', 'img', 'icons')
    };
    
    // In Docker, keep config paths if they exist; locally, always use derived paths
    if (isDocker) {
      merged.path = deepMerge(merged.path || {}, {
        data: dataDir,
        media: merged.path?.media || derivedPaths.media,
        img: merged.path?.img || derivedPaths.img,
        font: merged.path?.font || derivedPaths.font,
        icons: merged.path?.icons || derivedPaths.icons
      });
    } else {
      // Local dev: always use derived paths to avoid Docker paths from config
      merged.path = deepMerge(merged.path || {}, derivedPaths);
    }
  }

  return {
    config: merged,
    layers,
    errors,
    summary: {
      layerCount: layers.length,
      errorCount: errors.length,
      hasSecrets: !!secretsConfig,
      hasLocal: !!localConfig,
      configDir,
      dataDir
    }
  };
}

/**
 * Log config loading summary
 * @param {object} result - Result from loadAllConfig
 * @param {object} logger - Logger instance (optional)
 */
export function logConfigSummary(result, logger) {
  const log = (level, msg, data) => {
    if (logger && typeof logger[level] === 'function') {
      logger[level](msg, data);
    } else {
      console.log(`[ConfigLoader] ${msg}`, data || '');
    }
  };

  log('info', 'config.loaded', {
    layers: result.layers.map(l => l.name),
    configDir: result.summary.configDir,
    dataDir: result.summary.dataDir
  });

  if (result.errors.length > 0) {
    log('warn', 'config.errors', { errors: result.errors });
  }
}

export default {
  safeLoadYaml,
  deepMerge,
  loadAllConfig,
  logConfigSummary
};
