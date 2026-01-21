// tests/lib/parity-runner.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(__dirname, '../fixtures/parity-baselines/config.yml');
const BASELINES_DIR = path.resolve(__dirname, '../fixtures/parity-baselines');

let cachedConfig = null;

/**
 * Load global config
 */
export function loadConfig() {
  if (cachedConfig) return cachedConfig;

  const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
  cachedConfig = yaml.load(content);
  return cachedConfig;
}

/**
 * Get default ignore fields from config
 */
function getGlobalIgnore() {
  const config = loadConfig();
  return config.global_ignore || [];
}

/**
 * Normalize response by stripping volatile fields
 * @param {Object} response
 * @param {string[]} additionalIgnore - Additional fields to ignore
 * @returns {Object}
 */
export function normalizeResponse(response, additionalIgnore = []) {
  const ignoreFields = [...getGlobalIgnore(), ...additionalIgnore];

  function stripFields(obj) {
    if (obj === null || typeof obj !== 'object') return obj;

    if (Array.isArray(obj)) {
      return obj.map(stripFields);
    }

    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      if (ignoreFields.includes(key)) continue;
      result[key] = stripFields(value);
    }
    return result;
  }

  return stripFields(response);
}

/**
 * Compare two responses
 * @param {Object} baseline - Expected response
 * @param {Object} current - Actual response
 * @param {Object} options
 * @param {string[]} options.required_fields - Fields that must exist
 * @param {string[]} options.exact_matches - Fields that must match exactly
 * @param {string[]} options.type_checks - Fields where only type must match
 * @param {string[]} options.ignore - Additional fields to ignore
 * @returns {{ match: boolean, differences: Array }}
 */
export function compareResponses(baseline, current, options = {}) {
  const {
    required_fields = [],
    exact_matches = [],
    type_checks = [],
    ignore = []
  } = options;

  const differences = [];

  // Check required fields exist
  for (const field of required_fields) {
    if (!(field in current)) {
      differences.push({
        path: field,
        type: 'missing-in-current',
        expected: baseline[field]
      });
    }
  }

  // Deep compare
  function compare(base, curr, path = '') {
    // Handle nulls
    if (base === null && curr === null) return;
    if (base === null || curr === null) {
      differences.push({ path, baseline: base, current: curr });
      return;
    }

    // Handle primitives
    if (typeof base !== 'object' || typeof curr !== 'object') {
      const fieldName = path.split('.').pop();

      // Type check only?
      if (type_checks.includes(fieldName)) {
        if (typeof base !== typeof curr) {
          differences.push({
            path,
            type: 'type-mismatch',
            expected: typeof base,
            actual: typeof curr
          });
        }
        return;
      }

      // Value comparison
      if (base !== curr) {
        differences.push({ path, baseline: base, current: curr });
      }
      return;
    }

    // Handle arrays
    if (Array.isArray(base) && Array.isArray(curr)) {
      if (base.length !== curr.length) {
        differences.push({
          path,
          type: 'array-length',
          baseline: base.length,
          current: curr.length
        });
      }
      const minLen = Math.min(base.length, curr.length);
      for (let i = 0; i < minLen; i++) {
        compare(base[i], curr[i], `${path}[${i}]`);
      }
      return;
    }

    // Handle objects
    const allKeys = new Set([...Object.keys(base), ...Object.keys(curr)]);
    for (const key of allKeys) {
      if (ignore.includes(key)) continue;

      const newPath = path ? `${path}.${key}` : key;

      if (!(key in base)) {
        // Extra field in current - usually OK
        continue;
      }
      if (!(key in curr)) {
        differences.push({
          path: newPath,
          type: 'missing-in-current',
          baseline: base[key]
        });
        continue;
      }

      compare(base[key], curr[key], newPath);
    }
  }

  const normalizedBase = normalizeResponse(baseline, ignore);
  const normalizedCurr = normalizeResponse(current, ignore);
  compare(normalizedBase, normalizedCurr);

  return {
    match: differences.length === 0,
    differences
  };
}

/**
 * Load baseline from YAML file
 * @param {string} type - Input type (e.g., "plex")
 * @param {string} id - Item ID
 * @returns {Object | null}
 */
export function loadBaseline(type, id) {
  // Sanitize ID for filename
  const safeId = id.replace(/[/\\:]/g, '_');
  const filePath = path.join(BASELINES_DIR, type, `${safeId}.yml`);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  return yaml.load(content);
}

/**
 * Save baseline to YAML file
 * @param {string} type - Input type
 * @param {string} id - Item ID
 * @param {Object} data - Response data
 * @param {Object} meta - Metadata
 */
export function saveBaseline(type, id, data, meta = {}) {
  const safeId = id.replace(/[/\\:]/g, '_');
  const dir = path.join(BASELINES_DIR, type);

  fs.mkdirSync(dir, { recursive: true });

  const baseline = {
    _meta: {
      captured_at: new Date().toISOString(),
      source_id: id,
      ...meta
    },
    response: {
      status: 200,
      body: data
    }
  };

  const filePath = path.join(dir, `${safeId}.yml`);
  fs.writeFileSync(filePath, yaml.dump(baseline, { lineWidth: -1 }));

  return filePath;
}
