// tests/lib/testDataService.mjs
/**
 * Test Data Service - Provides curated test data from the data mount.
 *
 * Uses testdata.yml registry for preferred samples with expectations,
 * with discovery fallback when more samples are needed.
 */

import path from 'path';
import { loadYaml, dirExists, listYamlFiles } from '@backend/src/0_infrastructure/utils/FileIO.mjs';
import { validateExpectations } from './testDataMatchers.mjs';

// Re-export validateExpectations for convenience
export { validateExpectations };

// Default data path (can be overridden via environment variable)
const DATA_PATH = process.env.DAYLIGHT_DATA_PATH ||
  '/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data';

// Registry file path
const REGISTRY_PATH = path.join(DATA_PATH, 'system/testdata');

// Cache storage
let registryCache = null;
const resultsCache = new Map();

/**
 * Generate a cache key from a spec object
 * @param {Object} spec - The spec object
 * @returns {string} Cache key
 */
function getSpecCacheKey(spec) {
  // Sort keys for consistent ordering, then stringify
  const sorted = Object.keys(spec).sort().map(k => `${k}:${JSON.stringify(spec[k])}`);
  return sorted.join('|');
}

/**
 * Load the test data registry from testdata.yml
 * @returns {Object|null} Registry object or null if not found
 */
function loadRegistry() {
  if (registryCache !== null) {
    return registryCache;
  }

  registryCache = loadYaml(REGISTRY_PATH);
  return registryCache;
}

/**
 * Build a test sample object with merged expectations
 * @param {string} id - Sample ID
 * @param {Object} domainConfig - Domain configuration from registry
 * @param {Object} sampleConfig - Optional sample-specific config
 * @returns {Object} { id, expect }
 */
function buildSample(id, domainConfig, sampleConfig = null) {
  // Merge default_expect with sample-specific expect
  // Sample expect overrides default_expect for same keys
  const expect = {
    ...(domainConfig.default_expect || {}),
    ...(sampleConfig?.expect || {})
  };

  return { id, expect };
}

/**
 * Discover samples from filesystem
 * @param {string} discoverPath - Relative path from data mount
 * @param {number} count - Maximum number of samples to discover
 * @param {Object} domainConfig - Domain configuration for default_expect
 * @returns {Array<{id, expect}>} Discovered samples
 */
function discoverSamples(discoverPath, count, domainConfig) {
  const fullPath = path.join(DATA_PATH, discoverPath);

  if (!dirExists(fullPath)) {
    return [];
  }

  const files = listYamlFiles(fullPath);

  // Take up to 'count' files, using filename (without extension) as ID
  return files.slice(0, count).map(filename => buildSample(filename, domainConfig));
}

/**
 * Get samples for a domain based on count or specific IDs
 * @param {string} domain - Domain name
 * @param {number|string[]} specValue - Count or array of specific IDs
 * @param {Object} domainConfig - Domain configuration from registry
 * @returns {Array<{id, expect}>} Samples
 */
function getSamplesForDomain(domain, specValue, domainConfig) {
  const preferred = domainConfig.preferred || [];

  // Handle array of specific IDs
  if (Array.isArray(specValue)) {
    const results = [];
    for (const requestedId of specValue) {
      const preferred_sample = preferred.find(p => p.id === requestedId);
      if (preferred_sample) {
        results.push(buildSample(requestedId, domainConfig, preferred_sample));
      } else {
        // ID not in preferred list - use default expectations
        console.warn(`testDataService: Requested ID "${requestedId}" not in preferred list for domain "${domain}"`);
        results.push(buildSample(requestedId, domainConfig));
      }
    }
    return results;
  }

  // Handle count
  const count = Math.max(0, Number(specValue) || 0);
  if (count === 0) {
    return [];
  }

  // Get preferred samples first
  const results = [];
  for (let i = 0; i < Math.min(count, preferred.length); i++) {
    const sample = preferred[i];
    results.push(buildSample(sample.id, domainConfig, sample));
  }

  // If we need more, fall back to discovery
  if (results.length < count) {
    const needed = count - results.length;
    const discoverPath = domainConfig.discover_path;

    if (discoverPath) {
      console.warn(`testDataService: Only ${results.length} preferred samples for domain "${domain}", discovering ${needed} more from ${discoverPath}`);

      const existingIds = new Set(results.map(r => r.id));
      const discovered = discoverSamples(discoverPath, needed + existingIds.size, domainConfig);

      // Filter out duplicates and take what we need
      for (const sample of discovered) {
        if (!existingIds.has(sample.id) && results.length < count) {
          results.push(sample);
          existingIds.add(sample.id);
        }
      }
    } else if (results.length < count) {
      console.warn(`testDataService: Only ${results.length} preferred samples for domain "${domain}", no discover_path available`);
    }
  }

  return results;
}

/**
 * Load test data for multiple domains
 * @param {Object} spec - Specification object { domain: count | [ids] }
 * @returns {Promise<Object>} { domain: [{id, expect}] }
 */
export async function loadTestData(spec) {
  // Check cache first
  const cacheKey = getSpecCacheKey(spec);
  if (resultsCache.has(cacheKey)) {
    return resultsCache.get(cacheKey);
  }

  const registry = loadRegistry();
  const results = {};

  for (const [domain, specValue] of Object.entries(spec)) {
    const domainConfig = registry?.[domain];

    if (!domainConfig) {
      // Unknown domain - return empty array
      results[domain] = [];
      continue;
    }

    results[domain] = getSamplesForDomain(domain, specValue, domainConfig);
  }

  // Cache results
  resultsCache.set(cacheKey, results);

  return results;
}

/**
 * Get a single test sample for a domain
 * @param {string} domain - Domain name
 * @param {Object} options - Options
 * @param {string} options.id - Specific ID to get (optional)
 * @returns {Promise<{id, expect}|null>} Sample or null if not found
 */
export async function getTestSample(domain, options = {}) {
  const registry = loadRegistry();
  const domainConfig = registry?.[domain];

  if (!domainConfig) {
    return null;
  }

  const preferred = domainConfig.preferred || [];

  // If specific ID requested
  if (options.id) {
    const found = preferred.find(p => p.id === options.id);
    if (found) {
      return buildSample(options.id, domainConfig, found);
    }

    // ID not in preferred - warn and fall back
    console.warn(`testDataService: Requested ID "${options.id}" not found in preferred for domain "${domain}"`);

    // Return first preferred if available
    if (preferred.length > 0) {
      return buildSample(preferred[0].id, domainConfig, preferred[0]);
    }

    // Try discovery
    const discoverPath = domainConfig.discover_path;
    if (discoverPath) {
      const discovered = discoverSamples(discoverPath, 1, domainConfig);
      if (discovered.length > 0) {
        return discovered[0];
      }
    }

    return null;
  }

  // No specific ID - return first preferred
  if (preferred.length > 0) {
    return buildSample(preferred[0].id, domainConfig, preferred[0]);
  }

  // No preferred - try discovery
  const discoverPath = domainConfig.discover_path;
  if (discoverPath) {
    console.warn(`testDataService: No preferred samples for domain "${domain}", using discovery`);
    const discovered = discoverSamples(discoverPath, 1, domainConfig);
    if (discovered.length > 0) {
      return discovered[0];
    }
  }

  return null;
}

/**
 * Clear all caches
 */
export function clearCache() {
  registryCache = null;
  resultsCache.clear();
}
