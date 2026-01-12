// tests/integration/api/_utils/baselineLoader.mjs
/**
 * Baseline loader with fail-loud enforcement.
 * Missing baselines cause test failures, not skips.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINES_DIR = path.resolve(__dirname, '../_baselines');

/**
 * Load a baseline file. Throws if missing (fail-loud).
 *
 * @param {string} relativePath - Path relative to _baselines/ (e.g., 'local-content/hymn-113.json')
 * @returns {Promise<Object>} Parsed baseline data
 * @throws {Error} If baseline file doesn't exist
 */
export async function loadBaseline(relativePath) {
  const fullPath = path.join(BASELINES_DIR, relativePath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(
      `MISSING BASELINE: ${relativePath}\n\n` +
      `Baselines are required for API integration tests.\n` +
      `Run: npm run test:capture-baselines\n\n` +
      `If this is a new endpoint, add it to CAPTURE_MANIFEST.mjs first.\n` +
      `Expected location: ${fullPath}`
    );
  }

  try {
    const content = await fs.promises.readFile(fullPath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    throw new Error(
      `BASELINE PARSE ERROR: ${relativePath}\n` +
      `Could not parse baseline file: ${err.message}\n` +
      `Location: ${fullPath}`
    );
  }
}

/**
 * Check if a baseline exists (for conditional tests).
 *
 * @param {string} relativePath - Path relative to _baselines/
 * @returns {boolean}
 */
export function baselineExists(relativePath) {
  const fullPath = path.join(BASELINES_DIR, relativePath);
  return fs.existsSync(fullPath);
}

/**
 * Save a baseline file.
 *
 * @param {string} relativePath - Path relative to _baselines/
 * @param {Object} data - Data to save
 * @param {Object} options
 * @param {boolean} options.overwrite - Overwrite existing baseline (default: false)
 */
export async function saveBaseline(relativePath, data, options = {}) {
  const { overwrite = false } = options;
  const fullPath = path.join(BASELINES_DIR, relativePath);

  if (fs.existsSync(fullPath) && !overwrite) {
    throw new Error(
      `BASELINE EXISTS: ${relativePath}\n` +
      `Use --overwrite flag to replace existing baseline.`
    );
  }

  // Ensure directory exists
  const dir = path.dirname(fullPath);
  await fs.promises.mkdir(dir, { recursive: true });

  // Add capture metadata
  const baselineData = {
    ...data,
    _captured: new Date().toISOString(),
    _source: 'baseline-capture'
  };

  await fs.promises.writeFile(
    fullPath,
    JSON.stringify(baselineData, null, 2),
    'utf-8'
  );

  return fullPath;
}

/**
 * List all captured baselines.
 *
 * @param {string} category - Optional category filter (e.g., 'local-content')
 * @returns {string[]} Array of baseline paths
 */
export function listBaselines(category = null) {
  const searchDir = category
    ? path.join(BASELINES_DIR, category)
    : BASELINES_DIR;

  if (!fs.existsSync(searchDir)) {
    return [];
  }

  const results = [];

  function scanDir(dir, prefix = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        scanDir(path.join(dir, entry.name), `${prefix}${entry.name}/`);
      } else if (entry.name.endsWith('.json')) {
        results.push(`${prefix}${entry.name}`);
      }
    }
  }

  scanDir(searchDir);
  return results;
}

/**
 * Get baseline statistics.
 *
 * @returns {Object} Stats about captured baselines
 */
export function getBaselineStats() {
  const baselines = listBaselines();
  const byCategory = {};

  for (const baseline of baselines) {
    const category = baseline.split('/')[0] || 'uncategorized';
    byCategory[category] = (byCategory[category] || 0) + 1;
  }

  return {
    total: baselines.length,
    byCategory,
    directory: BASELINES_DIR
  };
}

export default loadBaseline;
