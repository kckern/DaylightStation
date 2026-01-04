/**
 * Config Path Resolver
 *
 * Resolves config file paths based on environment.
 * Config now lives INSIDE the data directory at data/system/config/.
 *
 * Environment:
 * - Docker: /usr/src/app/data (config at /usr/src/app/data/system/config/)
 * - Local Dev: Uses DAYLIGHT_DATA_PATH env var
 *
 * Environment Variables:
 *   DAYLIGHT_DATA_PATH   - Path to data directory (primary)
 *   DAYLIGHT_CONFIG_PATH - DEPRECATED: config now lives inside data/system/config/
 *   DAYLIGHT_NAS_MOUNT   - NAS mount point to check (optional)
 *   DAYLIGHT_SMB_SHARE   - SMB share URI for auto-mount (optional, macOS only)
 *
 * Handles mount detection and graceful failure.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import createLogger from '../logging/logger.js';

const logger = createLogger({ app: 'config_path' });

/**
 * Get mount configuration from environment variables
 * Returns null for any unset values - no hardcoded defaults for paths
 */
function getMountConfig() {
  return {
    // Direct paths (preferred)
    configPath: process.env.DAYLIGHT_CONFIG_PATH || null,
    dataPath: process.env.DAYLIGHT_DATA_PATH || null,
    // Optional: NAS mount detection
    mountPoint: process.env.DAYLIGHT_NAS_MOUNT || null,
    // Optional: SMB share for auto-mount (macOS only)
    smbShare: process.env.DAYLIGHT_SMB_SHARE || null
  };
}

/**
 * Check if a path exists and is accessible
 */
function pathExists(p) {
  if (!p) return false;
  try {
    fs.accessSync(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if the NAS volume is mounted (if mount point is configured)
 */
export function isMounted() {
  const config = getMountConfig();
  if (!config.mountPoint) return false;
  return pathExists(config.mountPoint);
}

/**
 * Attempt to mount the NAS volume (macOS only)
 * Returns true if mount succeeded or was already mounted
 */
export function tryMount() {
  const config = getMountConfig();
  
  if (isMounted()) {
    return true;
  }

  // Need SMB share configured to attempt mount
  if (!config.smbShare) {
    return false;
  }

  // Only attempt mount on macOS
  if (process.platform !== 'darwin') {
    logger.warn('config_path.auto_mount_unavailable_platform', { platform: process.platform });
    return false;
  }

  console.log('[ConfigPath] Attempting to mount NAS volume...');
  
  try {
    // Try to trigger Finder mount (macOS)
    // This opens the SMB share which should trigger credential prompt if needed
    execSync(`open "${config.smbShare}" 2>/dev/null || true`, { 
      timeout: 5000,
      stdio: 'ignore'
    });

    // Wait a moment for mount to complete
    execSync('sleep 2');

    if (isMounted()) {
      console.log('[ConfigPath] Mount successful');
      return true;
    }
  } catch (err) {
    logger.warn('config_path.mount_failed', { error: err.message });
  }

  return false;
}

/**
 * Get the base config directory path
 * Config now lives inside data directory at data/system/config/
 *
 * @param {object} options
 * @param {boolean} options.isDocker - Running in Docker container
 * @param {string} options.codebaseDir - Codebase directory (fallback for CI)
 * @returns {object} - { configDir, dataDir, source, mounted }
 */
export function resolveConfigPaths(options = {}) {
  const { isDocker, codebaseDir } = options;
  const mountConfig = getMountConfig();

  // Helper to find config dir (new structure first, then legacy)
  const findConfigDir = (dataDir) => {
    const newConfigDir = path.join(dataDir, 'system', 'config');
    const legacyConfigDir = path.join(dataDir, 'config');
    if (pathExists(newConfigDir)) return { configDir: newConfigDir, isLegacy: false };
    if (pathExists(legacyConfigDir)) return { configDir: legacyConfigDir, isLegacy: true };
    return { configDir: newConfigDir, isLegacy: false }; // Default to new structure
  };

  // In Docker, paths are mounted by docker-compose
  // Config is now inside data directory at system/config/
  if (isDocker) {
    const dataDir = '/usr/src/app/data';
    const { configDir } = findConfigDir(dataDir);
    return {
      configDir,
      dataDir,
      source: 'docker',
      mounted: true
    };
  }

  // Check for DAYLIGHT_DATA_PATH (primary method)
  if (mountConfig.dataPath) {
    const dataDir = mountConfig.dataPath;
    const { configDir, isLegacy } = findConfigDir(dataDir);

    if (pathExists(configDir)) {
      return {
        configDir,
        dataDir,
        source: isLegacy ? 'env-vars-legacy' : 'env-vars',
        mounted: true
      };
    }

    // Data path configured but config not accessible - try mount
    tryMount();
    const afterMount = findConfigDir(dataDir);
    if (pathExists(afterMount.configDir)) {
      return {
        configDir: afterMount.configDir,
        dataDir,
        source: 'env-vars-after-mount',
        mounted: true
      };
    }

    // Config dir doesn't exist yet - still return the paths
    // (config might be created later or we're in init mode)
    if (pathExists(dataDir)) {
      return {
        configDir,
        dataDir,
        source: 'env-vars-no-config',
        mounted: true
      };
    }
  }

  // DEPRECATED: Legacy support for separate DAYLIGHT_CONFIG_PATH
  if (mountConfig.configPath) {
    console.warn('[ConfigPath] DAYLIGHT_CONFIG_PATH is deprecated. Config now lives inside data/system/config/');
    if (pathExists(mountConfig.configPath)) {
      return {
        configDir: mountConfig.configPath,
        dataDir: mountConfig.dataPath || path.join(mountConfig.configPath, '..', 'data'),
        source: 'legacy-env-vars',
        mounted: true,
        deprecated: true
      };
    }
  }

  // Fallback to codebase (for CI/testing only)
  // Check for config inside data directory (new structure first)
  if (codebaseDir) {
    const dataDir = path.join(codebaseDir, 'data');
    const { configDir, isLegacy } = findConfigDir(dataDir);

    // Check if config exists at either location
    if (pathExists(path.join(configDir, 'app.yml')) ||
        pathExists(path.join(configDir, 'config.app.yml'))) {
      return {
        configDir,
        dataDir,
        source: isLegacy ? 'codebase-data-config-legacy' : 'codebase-data-config',
        mounted: false
      };
    }

    // Legacy location: root config.app.yml
    if (pathExists(path.join(codebaseDir, 'config.app.yml'))) {
      logger.warn('config_path.using_legacy_codebase_fallback');
      return {
        configDir: codebaseDir,
        dataDir,
        source: 'codebase-fallback',
        mounted: false,
        deprecated: true
      };
    }
  }

  // No config available
  return {
    configDir: null,
    dataDir: null,
    source: 'none',
    mounted: false,
    error: 'No configuration source available. Set DAYLIGHT_DATA_PATH environment variable.'
  };
}

/**
 * Get full paths to config files
 * Supports both new names (app.yml) and legacy names (config.app.yml)
 */
export function getConfigFilePaths(configDir) {
  if (!configDir) return null;

  // Helper to find file with fallback to legacy name
  const resolveFile = (newName, legacyName) => {
    const newPath = path.join(configDir, newName);
    const legacyPath = path.join(configDir, legacyName);
    // Prefer new name, fall back to legacy
    return pathExists(newPath) ? newPath : legacyPath;
  };

  return {
    app: resolveFile('app.yml', 'config.app.yml'),
    secrets: resolveFile('secrets.yml', 'config.secrets.yml'),
    local: resolveFile('app-local.yml', 'config.app-local.yml'),
    system: path.join(configDir, 'system.yml'),
    appsDir: path.join(configDir, 'apps')
  };
}

/**
 * Validate that required config files exist
 */
export function validateConfigFiles(configDir) {
  const files = getConfigFilePaths(configDir);
  if (!files) return { valid: false, missing: ['configDir'] };

  const required = ['app', 'secrets'];
  const missing = [];

  for (const key of required) {
    if (!pathExists(files[key])) {
      missing.push(files[key]);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    files
  };
}

export default {
  isMounted,
  tryMount,
  resolveConfigPaths,
  getConfigFilePaths,
  validateConfigFiles,
  getMountConfig
};
