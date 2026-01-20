// backend/src/4_api/shims/index.mjs

import { financeShims } from './finance.mjs';
import { contentShims } from './content.mjs';

/**
 * Registry of all shims for transforming new API responses to legacy format.
 * Each shim has: name, description, transform(newResponse) => legacyResponse
 */
export const allShims = {
  ...financeShims,
  ...contentShims,
};

/**
 * Get a shim by name
 * @param {string} name - Shim name
 * @returns {Object|undefined} Shim object with transform function
 */
export function getShim(name) {
  return allShims[name];
}

/**
 * Apply a shim transformation
 * @param {string} name - Shim name
 * @param {Object} response - New format response
 * @returns {Object} Legacy format response
 * @throws {Error} If shim not found
 */
export function applyShim(name, response) {
  const shim = getShim(name);
  if (!shim) {
    throw new Error(`Shim not found: ${name}`);
  }
  return shim.transform(response);
}
