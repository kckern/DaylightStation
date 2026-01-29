/**
 * Config Validator
 * 
 * Validates config against schema and throws on failure.
 * Provides actionable error messages with file paths checked.
 */

import { configSchema } from './configSchema.mjs';

/**
 * Error thrown when config validation fails.
 * Contains structured error list and checked file paths.
 */
export class ConfigValidationError extends Error {
  constructor(errors, checkedPaths = []) {
    super(formatErrors(errors, checkedPaths));
    this.name = 'ConfigValidationError';
    this.errors = errors;
    this.checkedPaths = checkedPaths;
  }
}

/**
 * Validate config object against schema.
 * Throws ConfigValidationError if invalid.
 *
 * @param {object} config - Config object from loader
 * @param {string} dataDir - Data directory (for error messages)
 * @returns {object} The validated config (unchanged)
 */
export function validateConfig(config, dataDir) {
  const errors = [];
  const checkedPaths = [
    `${dataDir}/system/config/system.yml`,
  ];

  // Validate system section
  if (!config.system) {
    errors.push({ path: 'system', message: 'missing required section' });
  } else {
    validateObject(config.system, configSchema.system.properties, 'system', errors);
  }

  // Validate secrets section (optional - may be loaded from system/auth/*.yml instead)
  if (config.secrets && Object.keys(config.secrets).length > 0) {
    validateObject(config.secrets, configSchema.secrets.properties, 'secrets', errors);
  }

  // Validate households
  if (!config.households || Object.keys(config.households).length === 0) {
    errors.push({ path: 'households', message: 'at least one household required' });
  } else {
    for (const [hid, household] of Object.entries(config.households)) {
      // Use flat structure: household/ for 'default', household-{id}/ for others
      const folderName = household._folderName || (hid === 'default' ? 'household' : `household-${hid}`);
      checkedPaths.push(`${dataDir}/${folderName}/household.yml`);
      validateObject(household, configSchema.households.valueSchema, `households.${hid}`, errors);
    }
  }

  // Validate users exist
  if (!config.users || Object.keys(config.users).length === 0) {
    errors.push({ path: 'users', message: 'at least one user required' });
  }

  // Cross-reference: default household exists
  const defaultHid = config.system?.defaultHouseholdId;
  if (defaultHid && config.households && !config.households[defaultHid]) {
    errors.push({
      path: 'system.defaultHouseholdId',
      message: `references '${defaultHid}' but household does not exist`,
    });
  }

  // Cross-reference: household users exist
  for (const [hid, household] of Object.entries(config.households ?? {})) {
    for (const username of household.users ?? []) {
      if (!config.users?.[username]) {
        errors.push({
          path: `households.${hid}.users`,
          message: `references user '${username}' but no profile found`,
        });
        checkedPaths.push(`${dataDir}/users/${username}/profile.yml`);
      }
    }
  }

  // Cross-reference: household head is in users list
  for (const [hid, household] of Object.entries(config.households ?? {})) {
    if (household.head && household.users && !household.users.includes(household.head)) {
      errors.push({
        path: `households.${hid}.head`,
        message: `head '${household.head}' is not in users list`,
      });
    }
  }

  if (errors.length > 0) {
    throw new ConfigValidationError(errors, checkedPaths);
  }

  return config;
}

// ─── Helpers ─────────────────────────────────────────────────

function validateObject(obj, schema, pathPrefix, errors) {
  if (!schema) return;

  for (const [key, rules] of Object.entries(schema)) {
    const fullPath = `${pathPrefix}.${key}`;
    const value = obj?.[key];

    // Check required
    if (rules.required && (value === undefined || value === null || value === '')) {
      errors.push({ path: fullPath, message: 'required but missing' });
      continue;
    }

    // Skip type check if value is missing and not required
    if (value === undefined || value === null) continue;

    // Check type
    if (rules.type) {
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (rules.type !== 'map' && actualType !== rules.type) {
        errors.push({ path: fullPath, message: `expected ${rules.type}, got ${actualType}` });
      }
    }
  }
}

function formatErrors(errors, checkedPaths) {
  const lines = ['Config validation failed:', ''];

  for (const err of errors) {
    lines.push(`  ✗ ${err.path}: ${err.message}`);
  }

  if (checkedPaths.length > 0) {
    lines.push('', 'Checked locations:');
    for (const p of [...new Set(checkedPaths)]) {
      lines.push(`  - ${p}`);
    }
  }

  return lines.join('\n');
}

export default validateConfig;
