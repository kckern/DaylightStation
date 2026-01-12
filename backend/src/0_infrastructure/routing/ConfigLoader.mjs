// backend/src/0_infrastructure/routing/ConfigLoader.mjs
import fs from 'fs';
import yaml from 'js-yaml';

/**
 * Load and validate routing configuration
 * @param {string} configPath - Path to routing.yml
 * @param {Object} availableShims - Map of shim name to shim object
 * @returns {Object} Validated config
 * @throws {Error} If config is invalid
 */
export function loadRoutingConfig(configPath, availableShims) {
  const content = fs.readFileSync(configPath, 'utf8');
  const config = yaml.load(content);

  const errors = [];

  // Validate default field
  if (!['new', 'legacy'].includes(config.default)) {
    errors.push(`Invalid default target "${config.default}"`);
  }

  for (const [path, rule] of Object.entries(config.routing || {})) {
    const shimName = typeof rule === 'object' ? rule.shim : null;
    const target = typeof rule === 'string' ? rule : rule?.target;

    if (shimName && !availableShims[shimName]) {
      errors.push(`Path "${path}" references unknown shim "${shimName}"`);
    }

    if (!['new', 'legacy'].includes(target)) {
      errors.push(`Path "${path}" has invalid target "${target}"`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Routing config invalid:\n${errors.join('\n')}`);
  }

  return config;
}
