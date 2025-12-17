/**
 * Config Path Resolver
 * 
 * Resolves config file paths based on environment:
 * - Docker: /usr/src/app/ (mounted by docker-compose)
 * - Local Dev: Uses DAYLIGHT_CONFIG_PATH and DAYLIGHT_DATA_PATH env vars
 * 
 * Environment Variables:
 *   DAYLIGHT_CONFIG_PATH - Path to config directory (required for local dev)
 *   DAYLIGHT_DATA_PATH   - Path to data directory (required for local dev)
 *   DAYLIGHT_NAS_MOUNT   - NAS mount point to check (optional)
 *   DAYLIGHT_SMB_SHARE   - SMB share URI for auto-mount (optional, macOS only)
 * 
 * Handles mount detection and graceful failure.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

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
    console.warn('[ConfigPath] Auto-mount not available on this platform');
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
    console.warn('[ConfigPath] Mount attempt failed:', err.message);
  }

  return false;
}

/**
 * Get the base config directory path
 * @param {object} options
 * @param {boolean} options.isDocker - Running in Docker container
 * @param {string} options.codebaseDir - Codebase directory (fallback for CI)
 * @returns {object} - { configDir, dataDir, source, mounted }
 */
export function resolveConfigPaths(options = {}) {
  const { isDocker, codebaseDir } = options;
  const config = getMountConfig();

  // In Docker, paths are mounted by docker-compose
  if (isDocker) {
    return {
      configDir: '/usr/src/app',
      dataDir: '/usr/src/app/data',
      source: 'docker',
      mounted: true
    };
  }

  // Check for explicit environment variables (preferred for local dev)
  if (config.configPath && config.dataPath) {
    if (pathExists(config.configPath)) {
      return {
        configDir: config.configPath,
        dataDir: config.dataPath,
        source: 'env-vars',
        mounted: pathExists(config.dataPath)
      };
    } else {
      // Configured but not accessible - try mount
      tryMount();
      if (pathExists(config.configPath)) {
        return {
          configDir: config.configPath,
          dataDir: config.dataPath,
          source: 'env-vars-after-mount',
          mounted: true
        };
      }
    }
  }

  // Fallback to codebase (for CI/testing only)
  if (codebaseDir && pathExists(path.join(codebaseDir, 'config.app.yml'))) {
    console.warn('[ConfigPath] WARNING: Using codebase config fallback');
    console.warn('[ConfigPath] Set DAYLIGHT_CONFIG_PATH and DAYLIGHT_DATA_PATH for local dev');
    return {
      configDir: codebaseDir,
      dataDir: path.join(codebaseDir, 'data'),
      source: 'codebase-fallback',
      mounted: false
    };
  }

  // No config available
  return {
    configDir: null,
    dataDir: null,
    source: 'none',
    mounted: false,
    error: 'No configuration source available. Set DAYLIGHT_CONFIG_PATH and DAYLIGHT_DATA_PATH environment variables.'
  };
}

/**
 * Get full paths to config files
 */
export function getConfigFilePaths(configDir) {
  if (!configDir) return null;
  
  return {
    app: path.join(configDir, 'config.app.yml'),
    secrets: path.join(configDir, 'config.secrets.yml'),
    local: path.join(configDir, 'config.app-local.yml'),
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
