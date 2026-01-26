// backend/src/0_system/routing/ConfigLoader.mjs
import { loadYamlFromPath } from '../utils/FileIO.mjs';

/**
 * Load and validate routing configuration
 * @param {string} configPath - Path to routing.yml
 * @returns {Object} Validated config
 * @throws {Error} If config is invalid
 */
export function loadRoutingConfig(configPath) {
  const config = loadYamlFromPath(configPath);

  if (!config) {
    throw new Error(`Failed to load routing config from ${configPath}`);
  }

  const errors = [];

  // Validate default field
  if (!['new', 'legacy'].includes(config.default)) {
    errors.push(`Invalid default target "${config.default}"`);
  }

  for (const [path, rule] of Object.entries(config.routing || {})) {
    const target = typeof rule === 'string' ? rule : rule?.target;

    if (!['new', 'legacy'].includes(target)) {
      errors.push(`Path "${path}" has invalid target "${target}"`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Routing config invalid:\n${errors.join('\n')}`);
  }

  return config;
}
