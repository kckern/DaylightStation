/**
 * Media Memory Service - Path utilities for media memory storage
 *
 * Migrated from: backend/_legacy/lib/mediaMemory.mjs
 *
 * Provides consistent path resolution for household-scoped media memory storage.
 * Used by both the Plex library and media router.
 *
 * Note: sanitizeForYAML and sanitizeObjectForYAML have been migrated to
 * backend/src/0_system/utils/yamlSanitizer.mjs
 */

import path from 'path';
import fs from 'fs';
import { configService } from '../../../0_system/config/index.mjs';
import { userDataService } from '../../../0_system/config/UserDataService.mjs';
import { slugify } from '../../../0_system/utils/strings.mjs';

/**
 * Get the relative path for media memory storage
 * @param {string} category - The category/subfolder (e.g., 'plex', 'plex/movies')
 * @param {string|null} householdId - Optional household ID, defaults to default household
 * @returns {string} Relative path for use with loadFile/saveFile
 */
export const getMediaMemoryPath = (category, householdId = null) => {
  const hid = householdId || configService.getDefaultHouseholdId();
  const householdDir = userDataService.getHouseholdDir(hid);
  if (householdDir && fs.existsSync(path.join(householdDir, 'history', 'media_memory'))) {
    return `households/${hid}/history/media_memory/${category}`;
  }
  return `history/media_memory/${category}`;
};

/**
 * Get the absolute directory path for media memory storage
 * @param {string|null} householdId - Optional household ID, defaults to default household
 * @returns {string} Absolute path to media memory directory
 */
export const getMediaMemoryDir = (householdId = null) => {
  const hid = householdId || configService.getDefaultHouseholdId();
  const householdDir = userDataService.getHouseholdDir(hid);
  if (householdDir) {
    const householdMemPath = path.join(householdDir, 'history', 'media_memory');
    if (fs.existsSync(householdMemPath)) {
      return householdMemPath;
    }
  }
  // Fall back to legacy path
  const legacyPath = path.join(process.env.path.data, 'history', 'media_memory');
  return legacyPath;
};

/**
 * Parse library ID and name from filename like "14_fitness.yml"
 * @param {string} filename - Filename to parse
 * @returns {{libraryId: number, libraryName: string}|null} Parsed components or null if legacy format
 */
export const parseLibraryFilename = (filename) => {
  const match = filename.match(/^(\d+)_(.+)\.ya?ml$/);
  if (!match) return null;
  return {
    libraryId: parseInt(match[1], 10),
    libraryName: match[2]
  };
};

/**
 * Build filename from library ID and name
 * @param {number} libraryId - Library section ID
 * @param {string} libraryName - Library name (will be slugified)
 * @returns {string} Filename like "14_fitness.yml"
 */
export const buildLibraryFilename = (libraryId, libraryName) => {
  const slug = slugify(libraryName);
  return `${libraryId}_${slug}.yml`;
};

/**
 * Get all media memory files in plex directory
 * @param {string|null} householdId - Optional household ID
 * @returns {Array<{path: string, filename: string, libraryId: number|null, libraryName: string}>} File info array
 */
export const getMediaMemoryFiles = (householdId = null) => {
  const plexDir = path.join(getMediaMemoryDir(householdId), 'plex');
  if (!fs.existsSync(plexDir)) return [];

  return fs.readdirSync(plexDir)
    .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
    .filter(f => !f.startsWith('_')) // Exclude _archive, _logs
    .map(f => {
      const parsed = parseLibraryFilename(f);
      return {
        path: path.join(plexDir, f),
        filename: f,
        libraryId: parsed?.libraryId || null,
        libraryName: parsed?.libraryName || f.replace(/\.ya?ml$/, '')
      };
    });
};

// Re-export YAML sanitization functions from infrastructure for backwards compat
export {
  sanitizeForYAML,
  sanitizeObjectForYAML
} from '../../../0_system/utils/yamlSanitizer.mjs';

export default {
  getMediaMemoryPath,
  getMediaMemoryDir,
  parseLibraryFilename,
  buildLibraryFilename,
  getMediaMemoryFiles
};
