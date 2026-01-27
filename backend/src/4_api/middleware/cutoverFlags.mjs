/**
 * Cutover Feature Flags
 *
 * Controls per-endpoint routing between legacy and new backend.
 * Flags are stored in YAML config for easy toggling without deploys.
 */

import { loadYamlFromPath, resolveYamlPath } from '#system/utils/FileIO.mjs';

const CONFIG_PATH = process.env.CUTOVER_FLAGS_PATH || '/data/config/cutover-flags.yml';

// Default flags - all routes go to legacy
const DEFAULT_FLAGS = {
  '/media/log': 'legacy',
  '/api/fitness/save_session': 'legacy',
  '/api/health': 'legacy',
  '/api/lifelog': 'legacy',
  '/api/gratitude': 'legacy'
};

let flags = { ...DEFAULT_FLAGS };
let lastLoadTime = 0;

/**
 * Load flags from YAML file (with 30s cache)
 */
function loadFlags() {
  const now = Date.now();
  if (now - lastLoadTime < 30000) return flags;

  try {
    const basePath = CONFIG_PATH.replace(/\.(yml|yaml)$/, '');
    const resolvedPath = resolveYamlPath(basePath);
    if (resolvedPath) {
      const parsed = loadYamlFromPath(resolvedPath);
      if (parsed) {
        flags = { ...DEFAULT_FLAGS, ...parsed };
        lastLoadTime = now;
      }
    }
  } catch (err) {
    console.error('[CutoverFlags] Failed to load config:', err.message);
  }

  return flags;
}

/**
 * Check if route should use new backend
 * @param {string} route - Route path (e.g., '/media/log')
 * @returns {boolean} - True if should route to new backend
 */
export function shouldUseNewBackend(route) {
  const currentFlags = loadFlags();
  return currentFlags[route] === 'new';
}

/**
 * Get all current flags
 */
export function getFlags() {
  return loadFlags();
}

/**
 * Create middleware that routes based on flags
 * @param {string} route - Route to check
 * @param {Function} newHandler - Handler for new backend
 * @param {Function} legacyHandler - Handler for legacy backend
 */
export function createCutoverMiddleware(route, newHandler, legacyHandler) {
  return (req, res, next) => {
    if (shouldUseNewBackend(route)) {
      return newHandler(req, res, next);
    }
    return legacyHandler(req, res, next);
  };
}
