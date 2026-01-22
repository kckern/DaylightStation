# Test Data Service Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement testDataService to provide real, meaningful test data from the data mount and Plex, replacing hardcoded fixture IDs in integration tests.

**Architecture:** Service lives in `tests/lib/`, imports adapters from `backend/src/2_adapters/` to leverage their knowledge of data formats. Registry file lives in `data/system/testdata.yml`. Tests call `loadTestData()` to get samples with IDs and expectations.

**Tech Stack:** Node.js ESM, js-yaml, existing FileIO utilities, existing adapters (FilesystemAdapter, PlexAdapter)

---

## Task 1: Create Registry File

**Files:**
- Create: `data/system/testdata.yml` (in data mount: `/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data/system/testdata.yml`)

**Step 1: Create the registry file with DSL documentation and initial samples**

```yaml
# data/system/testdata.yml
# Test data registry - curated samples with expectations
# Used by testDataService to provide meaningful test inputs

# ============================================================
# Matcher DSL Reference (used in 'expect' blocks):
# ============================================================
#   "exact string"     - exact match
#   /pattern/i         - regex (i = case insensitive)
#   ">10"              - numeric: greater than
#   "<100"             - numeric: less than
#   ">=1"              - numeric: greater or equal
#   "10-100"           - numeric: inclusive range
#   exists             - field exists and is not null
#   array              - type is array
#   string             - type is string
#   number             - type is number
#   boolean            - type is boolean
#   "movie|episode"    - enum: one of the values
#   contains:foo       - array/string contains 'foo'
#   length:>0          - array/string length check
# ============================================================

scripture:
  discover_path: content/scripture
  default_expect:
    reference: exists
  preferred:
    - id: 1-nephi-1
      expect:
        reference: /1 Nephi 1/i
        verses: array
        verses: length:>0

hymn:
  discover_path: content/songs/hymn
  default_expect:
    title: exists
  preferred:
    - id: "2"
      expect:
        title: /./
        number: ">=1"

primary:
  discover_path: content/songs/primary
  default_expect:
    title: exists
  preferred:
    - id: "2"
      expect:
        title: exists

talk:
  discover_path: content/talks
  default_expect:
    title: exists
  preferred:
    - id: ldsgc202510/11
      expect:
        title: exists

poetry:
  discover_path: content/poetry
  default_expect:
    title: exists
  preferred:
    - id: remedy/01
      expect:
        title: exists

plex:
  discover_via: plex_api
  default_expect:
    title: exists
    type: exists
  preferred:
    - id: "545219"
      expect:
        title: /./
        type: "movie|episode|track"
    - id: "663035"
      expect:
        title: exists

list:
  discover_path: households/default/history
  default_expect:
    items: array
  preferred:
    - id: watchlist
      expect:
        items: array
```

**Step 2: Verify file is accessible**

Run: `cat /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data/system/testdata.yml | head -20`
Expected: Shows the header and DSL reference

**Step 3: Commit**

```bash
# No git commit for data mount file - it's outside the repo
```

---

## Task 2: Implement Matcher DSL Parser

**Files:**
- Create: `tests/lib/testDataMatchers.mjs`
- Test: `tests/unit/parity/testDataMatchers.unit.test.mjs`

**Step 1: Write failing tests for each matcher type**

```javascript
// tests/unit/parity/testDataMatchers.unit.test.mjs
import { parseMatcher, checkMatcher, validateExpectations } from '../../lib/testDataMatchers.mjs';

describe('testDataMatchers', () => {
  describe('parseMatcher', () => {
    it('parses exact string matcher', () => {
      const matcher = parseMatcher('hello');
      expect(matcher.type).toBe('exact');
      expect(matcher.value).toBe('hello');
    });

    it('parses regex matcher', () => {
      const matcher = parseMatcher('/chapter/i');
      expect(matcher.type).toBe('regex');
      expect(matcher.pattern.test('Chapter 1')).toBe(true);
      expect(matcher.pattern.test('verse')).toBe(false);
    });

    it('parses exists matcher', () => {
      const matcher = parseMatcher('exists');
      expect(matcher.type).toBe('exists');
    });

    it('parses type matchers', () => {
      expect(parseMatcher('string').type).toBe('type');
      expect(parseMatcher('number').type).toBe('type');
      expect(parseMatcher('boolean').type).toBe('type');
      expect(parseMatcher('array').type).toBe('type');
    });

    it('parses numeric comparison matchers', () => {
      expect(parseMatcher('>10').type).toBe('numeric');
      expect(parseMatcher('>10').operator).toBe('>');
      expect(parseMatcher('>10').value).toBe(10);

      expect(parseMatcher('>=5').operator).toBe('>=');
      expect(parseMatcher('<100').operator).toBe('<');
      expect(parseMatcher('<=50').operator).toBe('<=');
    });

    it('parses range matcher', () => {
      const matcher = parseMatcher('10-100');
      expect(matcher.type).toBe('range');
      expect(matcher.min).toBe(10);
      expect(matcher.max).toBe(100);
    });

    it('parses enum matcher', () => {
      const matcher = parseMatcher('movie|episode|track');
      expect(matcher.type).toBe('enum');
      expect(matcher.values).toEqual(['movie', 'episode', 'track']);
    });

    it('parses contains matcher', () => {
      const matcher = parseMatcher('contains:foo');
      expect(matcher.type).toBe('contains');
      expect(matcher.value).toBe('foo');
    });

    it('parses length matcher', () => {
      const matcher = parseMatcher('length:>0');
      expect(matcher.type).toBe('length');
      expect(matcher.operator).toBe('>');
      expect(matcher.value).toBe(0);
    });
  });

  describe('checkMatcher', () => {
    it('checks exact match', () => {
      expect(checkMatcher('hello', parseMatcher('hello'), 'field').valid).toBe(true);
      expect(checkMatcher('world', parseMatcher('hello'), 'field').valid).toBe(false);
    });

    it('checks regex match', () => {
      expect(checkMatcher('Chapter 1', parseMatcher('/chapter/i'), 'field').valid).toBe(true);
      expect(checkMatcher('verse', parseMatcher('/chapter/i'), 'field').valid).toBe(false);
    });

    it('checks exists', () => {
      expect(checkMatcher('value', parseMatcher('exists'), 'field').valid).toBe(true);
      expect(checkMatcher(0, parseMatcher('exists'), 'field').valid).toBe(true);
      expect(checkMatcher(null, parseMatcher('exists'), 'field').valid).toBe(false);
      expect(checkMatcher(undefined, parseMatcher('exists'), 'field').valid).toBe(false);
    });

    it('checks type', () => {
      expect(checkMatcher('hello', parseMatcher('string'), 'field').valid).toBe(true);
      expect(checkMatcher(42, parseMatcher('number'), 'field').valid).toBe(true);
      expect(checkMatcher(true, parseMatcher('boolean'), 'field').valid).toBe(true);
      expect(checkMatcher([1, 2], parseMatcher('array'), 'field').valid).toBe(true);
    });

    it('checks numeric comparisons', () => {
      expect(checkMatcher(15, parseMatcher('>10'), 'field').valid).toBe(true);
      expect(checkMatcher(5, parseMatcher('>10'), 'field').valid).toBe(false);
      expect(checkMatcher(10, parseMatcher('>=10'), 'field').valid).toBe(true);
    });

    it('checks range', () => {
      expect(checkMatcher(50, parseMatcher('10-100'), 'field').valid).toBe(true);
      expect(checkMatcher(5, parseMatcher('10-100'), 'field').valid).toBe(false);
      expect(checkMatcher(150, parseMatcher('10-100'), 'field').valid).toBe(false);
    });

    it('checks enum', () => {
      expect(checkMatcher('movie', parseMatcher('movie|episode'), 'field').valid).toBe(true);
      expect(checkMatcher('track', parseMatcher('movie|episode'), 'field').valid).toBe(false);
    });

    it('checks contains', () => {
      expect(checkMatcher('hello foo bar', parseMatcher('contains:foo'), 'field').valid).toBe(true);
      expect(checkMatcher(['foo', 'bar'], parseMatcher('contains:foo'), 'field').valid).toBe(true);
      expect(checkMatcher('hello bar', parseMatcher('contains:foo'), 'field').valid).toBe(false);
    });

    it('checks length', () => {
      expect(checkMatcher([1, 2, 3], parseMatcher('length:>0'), 'field').valid).toBe(true);
      expect(checkMatcher([], parseMatcher('length:>0'), 'field').valid).toBe(false);
      expect(checkMatcher('hello', parseMatcher('length:>0'), 'field').valid).toBe(true);
    });
  });

  describe('validateExpectations', () => {
    it('validates all expectations and returns errors', () => {
      const actual = { title: 'Chapter 1', count: 5 };
      const expect = { title: '/chapter/i', count: '>0' };
      const result = validateExpectations(actual, expect);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('returns errors for failed expectations', () => {
      const actual = { title: 'verse', count: 0 };
      const expect = { title: '/chapter/i', count: '>0' };
      const result = validateExpectations(actual, expect);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBe(2);
    });

    it('returns error for missing field', () => {
      const actual = { title: 'Chapter 1' };
      const expect = { title: 'exists', count: 'exists' };
      const result = validateExpectations(actual, expect);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('count');
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/parity/testDataMatchers.unit.test.mjs --runInBand`
Expected: FAIL - module not found

**Step 3: Implement the matchers module**

```javascript
// tests/lib/testDataMatchers.mjs
/**
 * Test Data Matchers - DSL for validating API responses
 *
 * Supported matchers:
 * - "exact string" - exact match
 * - /pattern/flags - regex match
 * - exists - field exists and is not null/undefined
 * - string|number|boolean|array - type check
 * - >N, <N, >=N, <=N - numeric comparison
 * - N-M - numeric range (inclusive)
 * - a|b|c - enum (one of values)
 * - contains:X - array/string contains X
 * - length:OP - length check (e.g., length:>0)
 */

const TYPE_MATCHERS = ['string', 'number', 'boolean', 'array'];

/**
 * Parse a matcher string into a structured matcher object
 * @param {string} matcherStr - Matcher definition
 * @returns {Object} Parsed matcher with type and parameters
 */
export function parseMatcher(matcherStr) {
  const str = String(matcherStr);

  // exists
  if (str === 'exists') {
    return { type: 'exists' };
  }

  // Type matchers: string, number, boolean, array
  if (TYPE_MATCHERS.includes(str)) {
    return { type: 'type', expectedType: str };
  }

  // Regex: /pattern/flags
  const regexMatch = str.match(/^\/(.+)\/([gimsuy]*)$/);
  if (regexMatch) {
    return {
      type: 'regex',
      pattern: new RegExp(regexMatch[1], regexMatch[2])
    };
  }

  // Length: length:>0, length:5, length:5-10
  if (str.startsWith('length:')) {
    const lengthPart = str.slice(7);
    // Check for range first
    const rangeMatch = lengthPart.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      return {
        type: 'length',
        subtype: 'range',
        min: parseInt(rangeMatch[1], 10),
        max: parseInt(rangeMatch[2], 10)
      };
    }
    // Check for comparison
    const compMatch = lengthPart.match(/^([<>]=?)(\d+)$/);
    if (compMatch) {
      return {
        type: 'length',
        subtype: 'comparison',
        operator: compMatch[1],
        value: parseInt(compMatch[2], 10)
      };
    }
    // Exact length
    return {
      type: 'length',
      subtype: 'exact',
      value: parseInt(lengthPart, 10)
    };
  }

  // Contains: contains:foo
  if (str.startsWith('contains:')) {
    return { type: 'contains', value: str.slice(9) };
  }

  // Numeric range: 10-100
  const rangeMatch = str.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    return {
      type: 'range',
      min: parseInt(rangeMatch[1], 10),
      max: parseInt(rangeMatch[2], 10)
    };
  }

  // Numeric comparison: >10, >=10, <10, <=10
  const numericMatch = str.match(/^([<>]=?)(\d+)$/);
  if (numericMatch) {
    return {
      type: 'numeric',
      operator: numericMatch[1],
      value: parseInt(numericMatch[2], 10)
    };
  }

  // Enum: movie|episode|track
  if (str.includes('|') && !str.startsWith('/')) {
    return { type: 'enum', values: str.split('|') };
  }

  // Default: exact match
  return { type: 'exact', value: str };
}

/**
 * Check if a value matches a parsed matcher
 * @param {any} value - Value to check
 * @param {Object} matcher - Parsed matcher object
 * @param {string} fieldName - Field name for error messages
 * @returns {{ valid: boolean, error?: string }}
 */
export function checkMatcher(value, matcher, fieldName) {
  switch (matcher.type) {
    case 'exists':
      if (value === null || value === undefined) {
        return { valid: false, error: `${fieldName}: expected to exist, got ${value}` };
      }
      return { valid: true };

    case 'type': {
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (actualType !== matcher.expectedType) {
        return { valid: false, error: `${fieldName}: expected type ${matcher.expectedType}, got ${actualType}` };
      }
      return { valid: true };
    }

    case 'regex':
      if (typeof value !== 'string' || !matcher.pattern.test(value)) {
        return { valid: false, error: `${fieldName}: expected to match ${matcher.pattern}, got "${value}"` };
      }
      return { valid: true };

    case 'exact':
      if (value !== matcher.value) {
        return { valid: false, error: `${fieldName}: expected "${matcher.value}", got "${value}"` };
      }
      return { valid: true };

    case 'numeric': {
      const num = Number(value);
      let pass = false;
      switch (matcher.operator) {
        case '>': pass = num > matcher.value; break;
        case '>=': pass = num >= matcher.value; break;
        case '<': pass = num < matcher.value; break;
        case '<=': pass = num <= matcher.value; break;
      }
      if (!pass) {
        return { valid: false, error: `${fieldName}: expected ${matcher.operator}${matcher.value}, got ${value}` };
      }
      return { valid: true };
    }

    case 'range': {
      const num = Number(value);
      if (num < matcher.min || num > matcher.max) {
        return { valid: false, error: `${fieldName}: expected ${matcher.min}-${matcher.max}, got ${value}` };
      }
      return { valid: true };
    }

    case 'enum':
      if (!matcher.values.includes(value)) {
        return { valid: false, error: `${fieldName}: expected one of [${matcher.values.join(', ')}], got "${value}"` };
      }
      return { valid: true };

    case 'contains': {
      const contains = Array.isArray(value)
        ? value.includes(matcher.value)
        : String(value).includes(matcher.value);
      if (!contains) {
        return { valid: false, error: `${fieldName}: expected to contain "${matcher.value}"` };
      }
      return { valid: true };
    }

    case 'length': {
      const len = value?.length ?? 0;
      let pass = false;

      if (matcher.subtype === 'range') {
        pass = len >= matcher.min && len <= matcher.max;
        if (!pass) {
          return { valid: false, error: `${fieldName}: expected length ${matcher.min}-${matcher.max}, got ${len}` };
        }
      } else if (matcher.subtype === 'comparison') {
        switch (matcher.operator) {
          case '>': pass = len > matcher.value; break;
          case '>=': pass = len >= matcher.value; break;
          case '<': pass = len < matcher.value; break;
          case '<=': pass = len <= matcher.value; break;
        }
        if (!pass) {
          return { valid: false, error: `${fieldName}: expected length ${matcher.operator}${matcher.value}, got ${len}` };
        }
      } else {
        pass = len === matcher.value;
        if (!pass) {
          return { valid: false, error: `${fieldName}: expected length ${matcher.value}, got ${len}` };
        }
      }
      return { valid: true };
    }

    default:
      return { valid: false, error: `${fieldName}: unknown matcher type ${matcher.type}` };
  }
}

/**
 * Validate an object against a set of expectations
 * @param {Object} actual - Actual object to validate
 * @param {Object} expectations - Map of field names to matcher strings
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateExpectations(actual, expectations) {
  const errors = [];

  for (const [field, matcherStr] of Object.entries(expectations)) {
    const value = actual?.[field];
    const matcher = parseMatcher(matcherStr);

    // For 'exists' check, undefined means missing
    if (matcher.type === 'exists' && value === undefined) {
      errors.push(`${field}: field is missing`);
      continue;
    }

    const result = checkMatcher(value, matcher, field);
    if (!result.valid) {
      errors.push(result.error);
    }
  }

  return { valid: errors.length === 0, errors };
}
```

**Step 4: Run tests to verify they pass**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/parity/testDataMatchers.unit.test.mjs --runInBand`
Expected: All tests pass

**Step 5: Commit**

```bash
git add tests/lib/testDataMatchers.mjs tests/unit/parity/testDataMatchers.unit.test.mjs
git commit -m "feat(test): add testDataMatchers DSL parser

Implements matcher DSL for validating API responses:
- Exact string, regex, exists, type checks
- Numeric comparisons (>, <, >=, <=)
- Range (N-M), enum (a|b|c)
- Contains, length checks

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Implement Core testDataService

**Files:**
- Create: `tests/lib/testDataService.mjs`
- Test: `tests/unit/parity/testDataService.unit.test.mjs`

**Step 1: Write failing tests for the service**

```javascript
// tests/unit/parity/testDataService.unit.test.mjs
import { loadTestData, getTestSample, clearCache } from '../../lib/testDataService.mjs';

describe('testDataService', () => {
  beforeEach(() => {
    clearCache();
  });

  describe('loadTestData', () => {
    it('returns samples for requested domains', async () => {
      const data = await loadTestData({ scripture: 1 });
      expect(data.scripture).toBeDefined();
      expect(data.scripture.length).toBe(1);
      expect(data.scripture[0].id).toBeDefined();
      expect(data.scripture[0].expect).toBeDefined();
    });

    it('returns multiple samples when requested', async () => {
      const data = await loadTestData({ hymn: 2 });
      expect(data.hymn.length).toBeLessThanOrEqual(2);
      // May return fewer if registry has fewer samples
    });

    it('caches results for same spec', async () => {
      const data1 = await loadTestData({ scripture: 1 });
      const data2 = await loadTestData({ scripture: 1 });
      expect(data1).toBe(data2); // Same reference
    });
  });

  describe('getTestSample', () => {
    it('returns a single sample', async () => {
      const sample = await getTestSample('scripture');
      expect(sample.id).toBeDefined();
      expect(sample.expect).toBeDefined();
    });

    it('returns specific sample by id', async () => {
      const sample = await getTestSample('scripture', { id: '1-nephi-1' });
      expect(sample.id).toBe('1-nephi-1');
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/parity/testDataService.unit.test.mjs --runInBand`
Expected: FAIL - module not found

**Step 3: Implement the service**

```javascript
// tests/lib/testDataService.mjs
/**
 * Test Data Service
 *
 * Provides real, meaningful test data from the data mount and Plex.
 * Replaces hardcoded fixture IDs in integration tests.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { loadYaml, listYamlFiles, dirExists } from '../../backend/src/0_infrastructure/utils/FileIO.mjs';
import { validateExpectations } from './testDataMatchers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Cache
let registryCache = null;
let dataCache = {};

/**
 * Get data mount path from system config
 */
function getDataPath() {
  // Try environment variable first
  if (process.env.DAYLIGHT_DATA_PATH) {
    return process.env.DAYLIGHT_DATA_PATH;
  }

  // Try loading from system config
  try {
    const configPath = path.resolve(__dirname, '../../backend/src/0_infrastructure/routing/ConfigLoader.mjs');
    // Dynamic import not ideal in sync context, use known default path
  } catch (e) {
    // Fall through
  }

  // Default dev path
  return '/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data';
}

/**
 * Load the test data registry
 */
async function getRegistry() {
  if (registryCache) return registryCache;

  const dataPath = getDataPath();
  const registryPath = path.join(dataPath, 'system', 'testdata');

  registryCache = loadYaml(registryPath);

  if (!registryCache) {
    console.warn('[testData] No testdata.yml found at', registryPath, '- using discovery only');
    registryCache = {};
  }

  return registryCache;
}

/**
 * Check if a sample exists in the data mount
 */
function sampleExists(domain, id, registry) {
  const config = registry[domain];
  if (!config?.discover_path) return true; // Can't verify, assume exists

  const dataPath = getDataPath();
  const samplePath = path.join(dataPath, config.discover_path, id);

  // Check if directory or file exists
  if (dirExists(samplePath)) return true;

  // Check for YAML file
  const yamlPath = loadYaml(samplePath);
  return yamlPath !== null;
}

/**
 * Discover samples from the filesystem
 */
function discoverSamples(domain, config, count) {
  const dataPath = getDataPath();

  if (!config?.discover_path) {
    console.warn(`[testData] No discover_path for ${domain}, cannot discover`);
    return [];
  }

  const discoverPath = path.join(dataPath, config.discover_path);

  if (!dirExists(discoverPath)) {
    console.warn(`[testData] Discover path not found: ${discoverPath}`);
    return [];
  }

  // List YAML files in the directory
  const files = listYamlFiles(discoverPath, { stripExtension: true });

  // Pick random samples
  const shuffled = files.sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, count);

  return selected.map(id => ({
    id,
    expect: config.default_expect || { exists: 'exists' }
  }));
}

/**
 * Get samples for a domain
 */
async function getSamplesForDomain(domain, count, registry) {
  const config = registry[domain] || {};
  const samples = [];
  const warnings = [];

  // Try preferred samples first
  for (const preferred of config.preferred || []) {
    if (samples.length >= count) break;

    // For Plex, we can't easily check existence without API call
    if (domain === 'plex' || sampleExists(domain, preferred.id, registry)) {
      samples.push(preferred);
    } else {
      warnings.push(`[testData] Preferred ${domain}/${preferred.id} not found, will discover`);
    }
  }

  // Fall back to discovery if needed
  if (samples.length < count) {
    const needed = count - samples.length;

    if (domain === 'plex') {
      // Plex discovery requires API - skip for now, just use preferred
      if (samples.length === 0) {
        warnings.push(`[testData] No plex samples available (API discovery not implemented)`);
      }
    } else {
      const discovered = discoverSamples(domain, config, needed);

      if (discovered.length > 0) {
        warnings.push(`[testData] Discovered ${discovered.length} ${domain} samples`);
      }

      samples.push(...discovered);
    }
  }

  // Warn if still short
  if (samples.length < count) {
    warnings.push(`[testData] WARNING: Only found ${samples.length}/${count} ${domain} samples`);
  }

  // Log warnings
  warnings.forEach(w => console.warn(w));

  return samples;
}

/**
 * Load test data for multiple domains in one call.
 *
 * @param {Object} spec - What to load
 * @returns {Promise<Object>} Domain -> samples array
 */
export async function loadTestData(spec) {
  const cacheKey = JSON.stringify(spec);
  if (dataCache[cacheKey]) return dataCache[cacheKey];

  const registry = await getRegistry();
  const result = {};

  // Load all domains in parallel
  const domains = Object.keys(spec);
  await Promise.all(domains.map(async (domain) => {
    const countOrList = spec[domain];

    if (Array.isArray(countOrList)) {
      // Specific IDs requested
      const config = registry[domain] || {};
      result[domain] = countOrList.map(id => {
        // Find in preferred or create with default expect
        const preferred = config.preferred?.find(p => p.id === id);
        return preferred || { id, expect: config.default_expect || {} };
      });
    } else {
      // Count requested
      result[domain] = await getSamplesForDomain(domain, countOrList, registry);
    }
  }));

  dataCache[cacheKey] = result;
  return result;
}

/**
 * Get a single test sample
 */
export async function getTestSample(domain, options = {}) {
  if (options.id) {
    const registry = await getRegistry();
    const config = registry[domain] || {};
    const preferred = config.preferred?.find(p => p.id === options.id);
    return preferred || { id: options.id, expect: config.default_expect || {} };
  }

  const data = await loadTestData({ [domain]: 1 });
  return data[domain]?.[0] || null;
}

/**
 * Clear all caches
 */
export function clearCache() {
  registryCache = null;
  dataCache = {};
}

// Re-export validateExpectations for convenience
export { validateExpectations } from './testDataMatchers.mjs';
```

**Step 4: Run tests to verify they pass**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/parity/testDataService.unit.test.mjs --runInBand`
Expected: All tests pass

**Step 5: Commit**

```bash
git add tests/lib/testDataService.mjs tests/unit/parity/testDataService.unit.test.mjs
git commit -m "feat(test): add testDataService core implementation

Provides real test data from data mount:
- loadTestData({ domain: count }) batch loader
- getTestSample(domain) single-item getter
- Curated samples from testdata.yml registry
- Discovery fallback with warnings

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Integration Test with Real Data

**Files:**
- Test: `tests/integration/api/testDataService.integration.test.mjs`

**Step 1: Write integration test that uses real data**

```javascript
// tests/integration/api/testDataService.integration.test.mjs
import { loadTestData, validateExpectations, clearCache } from '../../lib/testDataService.mjs';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3112';

async function fetchJSON(path) {
  const response = await fetch(`${BASE_URL}${path}`);
  return {
    status: response.status,
    body: response.ok ? await response.json() : null
  };
}

describe('testDataService Integration', () => {
  beforeAll(() => {
    clearCache();
  });

  it('loads scripture sample and validates API response', async () => {
    const data = await loadTestData({ scripture: 1 });
    expect(data.scripture.length).toBeGreaterThan(0);

    const sample = data.scripture[0];
    const res = await fetchJSON(`/api/v1/local-content/scripture/${sample.id}`);

    if (res.status === 404) {
      console.log('Scripture endpoint not available, skipping');
      return;
    }

    expect(res.status).toBe(200);

    const result = validateExpectations(res.body, sample.expect);
    expect(result.errors).toEqual([]);
  });

  it('loads hymn sample and validates API response', async () => {
    const data = await loadTestData({ hymn: 1 });
    expect(data.hymn.length).toBeGreaterThan(0);

    const sample = data.hymn[0];
    const res = await fetchJSON(`/api/v1/local-content/hymn/${sample.id}`);

    if (res.status === 404) {
      console.log('Hymn endpoint not available, skipping');
      return;
    }

    expect(res.status).toBe(200);
  });

  it('loads plex sample and validates API response', async () => {
    const data = await loadTestData({ plex: 1 });

    if (data.plex.length === 0) {
      console.log('No plex samples available, skipping');
      return;
    }

    const sample = data.plex[0];
    const res = await fetchJSON(`/api/v1/content/plex/info/${sample.id}`);

    if (res.status === 404 || res.status === 503) {
      console.log('Plex not configured, skipping');
      return;
    }

    expect(res.status).toBe(200);

    const result = validateExpectations(res.body, sample.expect);
    expect(result.errors).toEqual([]);
  });
});
```

**Step 2: Run integration test**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/integration/api/testDataService.integration.test.mjs --runInBand`
Expected: All tests pass (may skip if services unavailable)

**Step 3: Commit**

```bash
git add tests/integration/api/testDataService.integration.test.mjs
git commit -m "test(integration): add testDataService integration tests

Validates testDataService works with real API endpoints.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Migrate v1-regression.test.mjs

**Files:**
- Modify: `tests/integration/api/v1-regression.test.mjs`

**Step 1: Add testDataService imports and setup**

At the top of the file, add:

```javascript
import { loadTestData, validateExpectations, clearCache } from '../../lib/testDataService.mjs';
```

**Step 2: Add beforeAll to load test data**

After the existing imports and config, add:

```javascript
let testData;

beforeAll(async () => {
  clearCache();
  testData = await loadTestData({
    scripture: 1,
    hymn: 1,
    primary: 1,
    talk: 1,
    poetry: 1,
    plex: 1,
    list: ['watchlist']
  });
});
```

**Step 3: Update plex test to use testData**

Replace the hardcoded plex test:

```javascript
describe('Plex Content', () => {
  it('GET /api/v1/content/plex/info/{id} returns valid plex info', async () => {
    if (!testData.plex?.length) {
      console.log('No plex samples available, skipping');
      return;
    }

    const sample = testData.plex[0];
    const res = await fetchJSON(`/api/v1/content/plex/info/${sample.id}`);

    if (res.status === 404 || res.status === 503) {
      console.log('Plex not configured, skipping');
      return;
    }

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();

    const result = validateExpectations(res.body, sample.expect);
    expect(result.errors).toEqual([]);
  });
});
```

**Step 4: Update scripture test**

```javascript
it('GET /api/v1/local-content/scripture/{ref} returns scripture', async () => {
  if (!testData.scripture?.length) {
    console.log('No scripture samples available, skipping');
    return;
  }

  const sample = testData.scripture[0];
  const res = await fetchJSON(`/api/v1/local-content/scripture/${sample.id}`);

  if (res.status === 404 || res.status === 400) {
    console.log('Scripture data not available, skipping');
    return;
  }

  expect(res.status).toBe(200);
  expect(res.body).toBeDefined();

  const result = validateExpectations(res.body, sample.expect);
  expect(result.errors).toEqual([]);
});
```

**Step 5: Update hymn test**

```javascript
it('GET /api/v1/local-content/hymn/{num} returns hymn', async () => {
  if (!testData.hymn?.length) {
    console.log('No hymn samples available, skipping');
    return;
  }

  const sample = testData.hymn[0];
  const res = await fetchJSON(`/api/v1/local-content/hymn/${sample.id}`);

  if (res.status === 404 || res.status === 400) {
    console.log('Hymn data not available, skipping');
    return;
  }

  expect(res.status).toBe(200);
  expect(res.body).toBeDefined();
});
```

**Step 6: Update baseline validation tests**

Update the sampleIds object in the baseline tests to use testData:

```javascript
it(`validates ${type} response structure`, async () => {
  // Get sample from testData if available
  const sampleFromTestData = testData[type]?.[0];

  if (!sampleFromTestData) {
    console.log(`${type} sample not available, skipping`);
    return;
  }

  const endpoint = endpointMap[type](sampleFromTestData.id);
  const res = await fetchJSON(endpoint);

  if (res.status === 404 || res.status === 503) {
    console.log(`${type} service not available, skipping`);
    return;
  }

  expect(res.status).toBe(200);
  expect(res.body).toBeDefined();

  if (sampleFromTestData.expect) {
    const result = validateExpectations(res.body, sampleFromTestData.expect);
    if (result.errors.length > 0) {
      console.log(`Validation errors for ${type}:`, result.errors);
    }
    expect(result.errors).toEqual([]);
  }
});
```

**Step 7: Run tests to verify migration works**

Run: `npm run test:v1`
Expected: All tests pass

**Step 8: Commit**

```bash
git add tests/integration/api/v1-regression.test.mjs
git commit -m "refactor(test): migrate v1-regression to testDataService

Replace hardcoded fixture IDs with dynamic test data from registry.
Uses validateExpectations for structured response validation.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Summary

| Task | Files | Tests |
|------|-------|-------|
| 1. Registry file | data/system/testdata.yml | Manual verify |
| 2. Matcher DSL | tests/lib/testDataMatchers.mjs | testDataMatchers.unit.test.mjs |
| 3. Core service | tests/lib/testDataService.mjs | testDataService.unit.test.mjs |
| 4. Integration | tests/integration/api/testDataService.integration.test.mjs | Self |
| 5. Migration | tests/integration/api/v1-regression.test.mjs | npm run test:v1 |

**Commits:** 5 commits, each with passing tests

**Post-implementation:** Merge branch to main, delete worktree
