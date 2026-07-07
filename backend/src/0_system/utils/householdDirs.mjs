/**
 * Household directory helpers
 *
 * Pure filesystem/string utilities for resolving household data folders.
 * Lives in the system utils layer (not config) so adapters can import them
 * without depending on the config singleton.
 */

import fs from 'fs';
import path from 'path';

/**
 * List household directories in the data directory.
 * Matches: household/ and household-{name}/ patterns.
 * @param {string} dataDir - Path to the data directory
 * @returns {string[]} Matching folder names
 */
export function listHouseholdDirs(dataDir) {
  if (!fs.existsSync(dataDir)) return [];

  return fs.readdirSync(dataDir)
    .filter(name => {
      if (name.startsWith('.') || name.startsWith('_')) return false;
      // Only match 'household' exactly or 'household-*' pattern
      if (name !== 'household' && !name.startsWith('household-')) return false;
      return fs.statSync(path.join(dataDir, name)).isDirectory();
    });
}

/**
 * Parse household ID from folder name.
 * household/ -> 'default'
 * household-jones/ -> 'jones'
 * @param {string} folderName
 * @returns {string}
 */
export function parseHouseholdId(folderName) {
  if (folderName === 'household') return 'default';
  return folderName.replace(/^household-/, '');
}

/**
 * Convert household ID to folder name.
 * 'default' -> 'household'
 * 'jones' -> 'household-jones'
 * @param {string} householdId
 * @returns {string}
 */
export function toFolderName(householdId) {
  if (householdId === 'default') return 'household';
  return `household-${householdId}`;
}
