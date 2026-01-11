/**
 * Bootstrap YAML Reader
 *
 * Minimal YAML reader for bootstrap/config loading BEFORE process.env is set.
 *
 * Key properties:
 * - Returns {} on missing file (for config merging with spread)
 * - Returns {} on parse error (graceful degradation)
 * - No logger dependency (avoids circular imports)
 * - Uses stderr for errors (always available)
 *
 * DO NOT USE FOR RUNTIME DATA - use io.mjs instead (has write queue, etc.)
 */

import fs from 'fs';
import { parse } from 'yaml';

/**
 * Read and parse a YAML file for bootstrap configuration.
 * Returns {} on any failure to support config merging: { ...defaults, ...loaded }
 *
 * @param {string} filePath - Absolute path to YAML file
 * @returns {object} Parsed YAML or empty object
 */
export const bootstrapReadYaml = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      return parse(raw) || {};
    }
  } catch (err) {
    process.stderr.write(`[bootstrap] Failed to read ${filePath}: ${err?.message || err}\n`);
  }
  return {};
};
