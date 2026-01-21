# Data-Driven Parity Tests Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build data-driven parity test system that reads lists.yml and validates DDD endpoints match legacy baselines.

**Architecture:** Fixture loader parses lists.yml inputs, endpoint mapper translates to URLs, parity runner compares responses. CLI provides capture/test modes, Jest provides CI integration.

**Tech Stack:** Node.js, Jest, js-yaml, node-fetch

---

## Task 1: Create Endpoint Map Configuration

**Files:**
- Create: `tests/fixtures/parity-baselines/endpoint-map.yml`

**Step 1: Create directory structure**

```bash
mkdir -p tests/fixtures/parity-baselines
```

**Step 2: Write endpoint map configuration**

```yaml
# tests/fixtures/parity-baselines/endpoint-map.yml
# Maps input types from lists.yml to legacy and DDD endpoint patterns

plex:
  legacy: /media/plex/info/{id}
  ddd: /api/content/plex/{id}
  pattern: "^plex:\\s*(\\d+)"
  param: id

scripture:
  legacy: /data/scripture/{path}
  ddd: /api/local-content/scripture/{path}
  pattern: "^scripture:\\s*(.+)"
  param: path

hymn:
  legacy: /data/hymn/{num}
  ddd: /api/local-content/hymn/{num}
  pattern: "^hymn:\\s*(\\d+)"
  param: num

primary:
  legacy: /data/primary/{num}
  ddd: /api/local-content/primary/{num}
  pattern: "^primary:\\s*(\\d+)"
  param: num

talk:
  legacy: /data/talk/{path}
  ddd: /api/local-content/talk/{path}
  pattern: "^talk:\\s*(.+)"
  param: path

poem:
  legacy: /data/poetry/{path}
  ddd: /api/local-content/poem/{path}
  pattern: "^poem:\\s*(.+)"
  param: path

media:
  legacy: /media/local/{path}
  ddd: /api/local-content/media/{path}
  pattern: "^media:\\s*(.+)"
  param: path

list:
  legacy: /data/list/{key}
  ddd: /api/list/folder/{key}
  pattern: "^list:\\s*(.+)"
  param: key

queue:
  legacy: /data/list/{key}
  ddd: /api/list/folder/{key}
  pattern: "^queue:\\s*(.+)"
  param: key
```

**Step 3: Commit**

```bash
git add tests/fixtures/parity-baselines/endpoint-map.yml
git commit -m "test: add endpoint map for data-driven parity tests"
```

---

## Task 2: Create Global Config

**Files:**
- Create: `tests/fixtures/parity-baselines/config.yml`

**Step 1: Write global configuration**

```yaml
# tests/fixtures/parity-baselines/config.yml
# Global settings for parity test comparison

server:
  default_url: http://localhost:3112
  timeout_ms: 10000

global_ignore:
  - _cached
  - timestamp
  - fetchedAt
  - _source
  - generatedAt
  - lastUpdated
  - _meta

global_type_checks:
  duration: number
  items: array
  id: string

comparison:
  # Fields to always check exist (regardless of value)
  required_by_type:
    plex:
      - id
      - title
      - type
    scripture:
      - id
      - title
    hymn:
      - id
      - title
    talk:
      - id
      - title
```

**Step 2: Commit**

```bash
git add tests/fixtures/parity-baselines/config.yml
git commit -m "test: add global config for parity tests"
```

---

## Task 3: Create Endpoint Map Loader

**Files:**
- Create: `tests/lib/endpoint-map.mjs`
- Test: `tests/unit/parity/endpoint-map.unit.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/parity/endpoint-map.unit.test.mjs
import { describe, it, expect } from '@jest/globals';
import { loadEndpointMap, buildUrl, parseInput } from '../../lib/endpoint-map.mjs';

describe('endpoint-map', () => {
  describe('parseInput', () => {
    it('parses plex input', () => {
      const result = parseInput('plex: 663035');
      expect(result).toEqual({ type: 'plex', value: '663035' });
    });

    it('parses scripture input with path', () => {
      const result = parseInput('scripture: nt');
      expect(result).toEqual({ type: 'scripture', value: 'nt' });
    });

    it('parses scripture with version modifier', () => {
      const result = parseInput('scripture: gen 1; version nrsv');
      expect(result).toEqual({ type: 'scripture', value: 'gen 1; version nrsv' });
    });

    it('returns null for app inputs', () => {
      const result = parseInput('app: wrapup');
      expect(result).toBeNull();
    });

    it('returns null for invalid inputs', () => {
      const result = parseInput('unknown: foo');
      expect(result).toBeNull();
    });
  });

  describe('buildUrl', () => {
    it('builds legacy plex URL', () => {
      const url = buildUrl('plex', '663035', 'legacy');
      expect(url).toBe('/media/plex/info/663035');
    });

    it('builds ddd plex URL', () => {
      const url = buildUrl('plex', '663035', 'ddd');
      expect(url).toBe('/api/content/plex/663035');
    });

    it('builds scripture URL with path', () => {
      const url = buildUrl('scripture', 'bom/sebom/31103', 'legacy');
      expect(url).toBe('/data/scripture/bom/sebom/31103');
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/parity/endpoint-map.unit.test.mjs -v
```

Expected: FAIL with "Cannot find module"

**Step 3: Write implementation**

```javascript
// tests/lib/endpoint-map.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAP_PATH = path.resolve(__dirname, '../fixtures/parity-baselines/endpoint-map.yml');

let cachedMap = null;

/**
 * Load endpoint map from YAML config
 */
export function loadEndpointMap() {
  if (cachedMap) return cachedMap;

  const content = fs.readFileSync(MAP_PATH, 'utf-8');
  cachedMap = yaml.load(content);
  return cachedMap;
}

/**
 * Parse input string from lists.yml
 * @param {string} input - e.g., "plex: 663035" or "scripture: nt"
 * @returns {{ type: string, value: string } | null}
 */
export function parseInput(input) {
  if (!input || typeof input !== 'string') return null;

  const map = loadEndpointMap();

  for (const [type, config] of Object.entries(map)) {
    const regex = new RegExp(config.pattern);
    const match = input.match(regex);
    if (match) {
      return { type, value: match[1].trim() };
    }
  }

  return null;
}

/**
 * Build URL for endpoint
 * @param {string} type - Input type (e.g., "plex")
 * @param {string} value - Parsed value (e.g., "663035")
 * @param {'legacy' | 'ddd'} mode - Which endpoint to build
 * @returns {string}
 */
export function buildUrl(type, value, mode) {
  const map = loadEndpointMap();
  const config = map[type];

  if (!config) {
    throw new Error(`Unknown input type: ${type}`);
  }

  const template = mode === 'legacy' ? config.legacy : config.ddd;
  return template.replace(`{${config.param}}`, value);
}

/**
 * Get all supported input types
 */
export function getSupportedTypes() {
  return Object.keys(loadEndpointMap());
}
```

**Step 4: Run test to verify it passes**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/parity/endpoint-map.unit.test.mjs -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add tests/lib/endpoint-map.mjs tests/unit/parity/endpoint-map.unit.test.mjs
git commit -m "feat(test): add endpoint map loader for parity tests"
```

---

## Task 4: Create Fixture Loader

**Files:**
- Create: `tests/lib/fixture-loader.mjs`
- Test: `tests/unit/parity/fixture-loader.unit.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/parity/fixture-loader.unit.test.mjs
import { describe, it, expect } from '@jest/globals';
import { loadFixtures, groupByType } from '../../lib/fixture-loader.mjs';

describe('fixture-loader', () => {
  describe('loadFixtures', () => {
    it('loads fixtures from lists.yml', async () => {
      const fixtures = await loadFixtures();

      expect(Array.isArray(fixtures)).toBe(true);
      expect(fixtures.length).toBeGreaterThan(0);

      // Each fixture should have required fields
      const fixture = fixtures[0];
      expect(fixture).toHaveProperty('type');
      expect(fixture).toHaveProperty('value');
      expect(fixture).toHaveProperty('label');
      expect(fixture).toHaveProperty('uid');
    });

    it('excludes app inputs', async () => {
      const fixtures = await loadFixtures();
      const appFixtures = fixtures.filter(f => f.type === 'app');
      expect(appFixtures.length).toBe(0);
    });

    it('filters by type', async () => {
      const fixtures = await loadFixtures({ types: ['plex'] });
      expect(fixtures.every(f => f.type === 'plex')).toBe(true);
    });
  });

  describe('groupByType', () => {
    it('groups fixtures by type', async () => {
      const fixtures = await loadFixtures();
      const grouped = groupByType(fixtures);

      expect(grouped).toHaveProperty('plex');
      expect(Array.isArray(grouped.plex)).toBe(true);
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/parity/fixture-loader.unit.test.mjs -v
```

Expected: FAIL with "Cannot find module"

**Step 3: Write implementation**

```javascript
// tests/lib/fixture-loader.mjs
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { parseInput } from './endpoint-map.mjs';

// Data path from environment or default
const DATA_PATH = process.env.DAYLIGHT_DATA_PATH || '/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data';
const LISTS_PATH = path.join(DATA_PATH, 'households/default/state/lists.yml');

/**
 * Load test fixtures from lists.yml
 * @param {Object} options
 * @param {string[]} options.types - Filter to specific types
 * @param {string} options.listsPath - Override lists.yml path
 * @returns {Promise<Array<{ type: string, value: string, label: string, uid: string }>>}
 */
export async function loadFixtures(options = {}) {
  const { types = null, listsPath = LISTS_PATH } = options;

  const content = fs.readFileSync(listsPath, 'utf-8');
  const items = yaml.load(content);

  if (!Array.isArray(items)) {
    throw new Error('lists.yml must be an array');
  }

  const fixtures = [];

  for (const item of items) {
    if (!item.input) continue;

    const parsed = parseInput(item.input);
    if (!parsed) continue;  // Skip unsupported types (like 'app')

    if (types && !types.includes(parsed.type)) continue;

    fixtures.push({
      type: parsed.type,
      value: parsed.value,
      label: item.label || parsed.value,
      uid: item.uid || null,
      rawInput: item.input
    });
  }

  return fixtures;
}

/**
 * Group fixtures by type
 * @param {Array} fixtures
 * @returns {Object<string, Array>}
 */
export function groupByType(fixtures) {
  const grouped = {};

  for (const fixture of fixtures) {
    if (!grouped[fixture.type]) {
      grouped[fixture.type] = [];
    }
    grouped[fixture.type].push(fixture);
  }

  return grouped;
}

/**
 * Get unique fixture (deduplicate by type+value)
 * @param {Array} fixtures
 * @returns {Array}
 */
export function dedupeFixtures(fixtures) {
  const seen = new Set();
  return fixtures.filter(f => {
    const key = `${f.type}:${f.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
```

**Step 4: Run test to verify it passes**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/parity/fixture-loader.unit.test.mjs -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add tests/lib/fixture-loader.mjs tests/unit/parity/fixture-loader.unit.test.mjs
git commit -m "feat(test): add fixture loader for lists.yml"
```

---

## Task 5: Create Parity Runner Core

**Files:**
- Create: `tests/lib/parity-runner.mjs`
- Test: `tests/unit/parity/parity-runner.unit.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/parity/parity-runner.unit.test.mjs
import { describe, it, expect } from '@jest/globals';
import { normalizeResponse, compareResponses, loadBaseline } from '../../lib/parity-runner.mjs';

describe('parity-runner', () => {
  describe('normalizeResponse', () => {
    it('strips volatile fields', () => {
      const response = {
        id: '123',
        title: 'Test',
        timestamp: 1234567890,
        _cached: true,
        fetchedAt: '2026-01-21'
      };

      const normalized = normalizeResponse(response);

      expect(normalized.id).toBe('123');
      expect(normalized.title).toBe('Test');
      expect(normalized.timestamp).toBeUndefined();
      expect(normalized._cached).toBeUndefined();
      expect(normalized.fetchedAt).toBeUndefined();
    });

    it('handles nested objects', () => {
      const response = {
        data: {
          id: '123',
          _cached: true
        }
      };

      const normalized = normalizeResponse(response);

      expect(normalized.data.id).toBe('123');
      expect(normalized.data._cached).toBeUndefined();
    });
  });

  describe('compareResponses', () => {
    it('returns match for identical responses', () => {
      const baseline = { id: '123', title: 'Test' };
      const current = { id: '123', title: 'Test' };

      const result = compareResponses(baseline, current);

      expect(result.match).toBe(true);
      expect(result.differences).toHaveLength(0);
    });

    it('detects value differences', () => {
      const baseline = { id: '123', title: 'Test' };
      const current = { id: '123', title: 'Different' };

      const result = compareResponses(baseline, current);

      expect(result.match).toBe(false);
      expect(result.differences).toContainEqual(
        expect.objectContaining({ path: 'title' })
      );
    });

    it('respects type_checks option', () => {
      const baseline = { id: '123', duration: 100 };
      const current = { id: '123', duration: 200 };

      const result = compareResponses(baseline, current, {
        type_checks: ['duration']
      });

      // Type matches (both numbers), so should pass
      expect(result.match).toBe(true);
    });

    it('validates required_fields', () => {
      const baseline = { id: '123', title: 'Test' };
      const current = { id: '123' };  // missing title

      const result = compareResponses(baseline, current, {
        required_fields: ['id', 'title']
      });

      expect(result.match).toBe(false);
      expect(result.differences).toContainEqual(
        expect.objectContaining({ path: 'title', type: 'missing-in-current' })
      );
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/parity/parity-runner.unit.test.mjs -v
```

Expected: FAIL with "Cannot find module"

**Step 3: Write implementation**

```javascript
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
```

**Step 4: Run test to verify it passes**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/parity/parity-runner.unit.test.mjs -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add tests/lib/parity-runner.mjs tests/unit/parity/parity-runner.unit.test.mjs
git commit -m "feat(test): add parity runner core with comparison logic"
```

---

## Task 6: Create CLI Entry Point

**Files:**
- Create: `tests/parity-cli.mjs`

**Step 1: Write CLI implementation**

```javascript
#!/usr/bin/env node
// tests/parity-cli.mjs
/**
 * Parity Test CLI
 *
 * Usage:
 *   node tests/parity-cli.mjs --update              # Capture baselines from legacy
 *   node tests/parity-cli.mjs --update --type=plex  # Capture single type
 *   node tests/parity-cli.mjs --snapshot            # Test DDD against baselines
 *   node tests/parity-cli.mjs --live                # Compare legacy vs DDD live
 *   node tests/parity-cli.mjs --list                # List all baselines
 *   node tests/parity-cli.mjs --show plex/663035    # Show single baseline
 */

import { fileURLToPath } from 'url';
import { loadFixtures, dedupeFixtures, groupByType } from './lib/fixture-loader.mjs';
import { buildUrl, getSupportedTypes } from './lib/endpoint-map.mjs';
import {
  loadConfig,
  normalizeResponse,
  compareResponses,
  loadBaseline,
  saveBaseline
} from './lib/parity-runner.mjs';

// ============================================================================
// Argument Parsing
// ============================================================================

function parseArgs(argv) {
  const args = {
    mode: null,
    type: null,
    id: null,
    bail: false,
    verbose: false,
    show: null
  };

  for (const arg of argv.slice(2)) {
    if (arg === '--update') args.mode = 'update';
    else if (arg === '--snapshot') args.mode = 'snapshot';
    else if (arg === '--live') args.mode = 'live';
    else if (arg === '--list') args.mode = 'list';
    else if (arg.startsWith('--type=')) args.type = arg.split('=')[1];
    else if (arg.startsWith('--id=')) args.id = arg.split('=')[1];
    else if (arg === '--bail') args.bail = true;
    else if (arg === '--verbose') args.verbose = true;
    else if (arg.startsWith('--show')) {
      args.mode = 'show';
      args.show = argv[argv.indexOf(arg) + 1];
    }
  }

  return args;
}

// ============================================================================
// HTTP Fetching
// ============================================================================

async function fetchEndpoint(url, baseUrl) {
  const config = loadConfig();
  const fullUrl = `${baseUrl}${url}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.server.timeout_ms);

  try {
    const response = await fetch(fullUrl, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });

    clearTimeout(timeoutId);

    const data = await response.json().catch(() => null);
    return {
      success: response.ok,
      status: response.status,
      data,
      error: response.ok ? null : `HTTP ${response.status}`
    };
  } catch (err) {
    clearTimeout(timeoutId);
    return {
      success: false,
      status: 0,
      error: err.name === 'AbortError' ? 'Timeout' : err.message
    };
  }
}

// ============================================================================
// Output Formatting
// ============================================================================

const SYMBOLS = {
  pass: '\x1b[32m✓\x1b[0m',
  fail: '\x1b[31m✗\x1b[0m',
  skip: '\x1b[33m⊘\x1b[0m',
  type: '\x1b[36m▶\x1b[0m',
};

function log(msg) { console.log(msg); }
function logType(name, count) { log(`\n${SYMBOLS.type} ${name} (${count} items)`); }
function logPass(label) { log(`  ${SYMBOLS.pass} ${label}`); }
function logFail(label, reason) { log(`  ${SYMBOLS.fail} ${label} - ${reason}`); }
function logSkip(label, reason) { log(`  ${SYMBOLS.skip} ${label} - ${reason}`); }

// ============================================================================
// Commands
// ============================================================================

async function runUpdate(args) {
  const config = loadConfig();
  const baseUrl = config.server.default_url;

  log('\n═══════════════════════════════════════════════════');
  log('  PARITY BASELINE CAPTURE');
  log('═══════════════════════════════════════════════════');
  log(`  Server: ${baseUrl}`);
  log(`  Mode: Capture from LEGACY endpoints\n`);

  const types = args.type ? [args.type] : getSupportedTypes();
  const fixtures = await loadFixtures({ types });
  const unique = dedupeFixtures(fixtures);
  const grouped = groupByType(unique);

  let captured = 0, failed = 0, skipped = 0;

  for (const [type, items] of Object.entries(grouped)) {
    logType(type, items.length);

    for (const item of items) {
      const url = buildUrl(type, item.value, 'legacy');
      const result = await fetchEndpoint(url, baseUrl);

      if (!result.success) {
        logFail(item.label, result.error);
        failed++;
        continue;
      }

      const normalized = normalizeResponse(result.data);
      saveBaseline(type, item.value, normalized, {
        legacy_endpoint: url,
        source_label: item.label,
        source_uid: item.uid
      });

      logPass(item.label);
      captured++;
    }
  }

  log('\n───────────────────────────────────────────────────');
  log(`  Captured: ${captured}  Failed: ${failed}  Skipped: ${skipped}`);
  log('═══════════════════════════════════════════════════\n');

  return failed > 0 ? 1 : 0;
}

async function runSnapshot(args) {
  const config = loadConfig();
  const baseUrl = config.server.default_url;

  log('\n═══════════════════════════════════════════════════');
  log('  PARITY SNAPSHOT TEST');
  log('═══════════════════════════════════════════════════');
  log(`  Server: ${baseUrl}`);
  log(`  Mode: Test DDD against baselines\n`);

  const types = args.type ? [args.type] : getSupportedTypes();
  const fixtures = await loadFixtures({ types });
  const unique = dedupeFixtures(fixtures);
  const grouped = groupByType(unique);

  let passed = 0, failed = 0, skipped = 0;
  const failures = [];

  for (const [type, items] of Object.entries(grouped)) {
    logType(type, items.length);

    for (const item of items) {
      const baseline = loadBaseline(type, item.value);
      if (!baseline) {
        logSkip(item.label, 'no baseline');
        skipped++;
        continue;
      }

      const url = buildUrl(type, item.value, 'ddd');
      const result = await fetchEndpoint(url, baseUrl);

      if (!result.success) {
        logFail(item.label, result.error);
        failed++;
        failures.push({ type, item, error: result.error });
        if (args.bail) break;
        continue;
      }

      const comparison = compareResponses(
        baseline.response.body,
        result.data,
        baseline
      );

      if (comparison.match) {
        logPass(item.label);
        passed++;
      } else {
        const diffSummary = comparison.differences.slice(0, 3)
          .map(d => d.path).join(', ');
        logFail(item.label, `differs: ${diffSummary}`);
        failed++;
        failures.push({ type, item, differences: comparison.differences });
        if (args.bail) break;
      }
    }

    if (args.bail && failed > 0) break;
  }

  log('\n───────────────────────────────────────────────────');
  log(`  Passed: ${passed}  Failed: ${failed}  Skipped: ${skipped}`);
  log('═══════════════════════════════════════════════════\n');

  if (args.verbose && failures.length > 0) {
    log('FAILURES:\n');
    for (const f of failures) {
      log(`  ${f.type}/${f.item.value}:`);
      if (f.error) {
        log(`    Error: ${f.error}`);
      } else if (f.differences) {
        for (const d of f.differences.slice(0, 5)) {
          log(`    ${d.path}: expected=${JSON.stringify(d.baseline)?.slice(0, 40)} got=${JSON.stringify(d.current)?.slice(0, 40)}`);
        }
      }
      log('');
    }
  }

  return failed > 0 ? 1 : 0;
}

async function runLive(args) {
  const config = loadConfig();
  const baseUrl = config.server.default_url;

  log('\n═══════════════════════════════════════════════════');
  log('  PARITY LIVE COMPARISON');
  log('═══════════════════════════════════════════════════');
  log(`  Server: ${baseUrl}`);
  log(`  Mode: Compare LEGACY vs DDD live\n`);

  const types = args.type ? [args.type] : getSupportedTypes();
  const fixtures = await loadFixtures({ types });
  const unique = dedupeFixtures(fixtures);
  const grouped = groupByType(unique);

  let passed = 0, failed = 0, skipped = 0;

  for (const [type, items] of Object.entries(grouped)) {
    logType(type, items.length);

    for (const item of items) {
      const legacyUrl = buildUrl(type, item.value, 'legacy');
      const dddUrl = buildUrl(type, item.value, 'ddd');

      const [legacyResult, dddResult] = await Promise.all([
        fetchEndpoint(legacyUrl, baseUrl),
        fetchEndpoint(dddUrl, baseUrl)
      ]);

      if (!legacyResult.success && !dddResult.success) {
        logSkip(item.label, 'both failed');
        skipped++;
        continue;
      }

      if (!legacyResult.success) {
        logFail(item.label, `legacy: ${legacyResult.error}`);
        failed++;
        continue;
      }

      if (!dddResult.success) {
        logFail(item.label, `ddd: ${dddResult.error}`);
        failed++;
        continue;
      }

      const comparison = compareResponses(legacyResult.data, dddResult.data);

      if (comparison.match) {
        logPass(item.label);
        passed++;
      } else {
        const diffCount = comparison.differences.length;
        logFail(item.label, `${diffCount} differences`);
        failed++;
        if (args.bail) break;
      }
    }

    if (args.bail && failed > 0) break;
  }

  log('\n───────────────────────────────────────────────────');
  log(`  Passed: ${passed}  Failed: ${failed}  Skipped: ${skipped}`);
  log('═══════════════════════════════════════════════════\n');

  return failed > 0 ? 1 : 0;
}

async function runList() {
  const types = getSupportedTypes();
  const fixtures = await loadFixtures();
  const unique = dedupeFixtures(fixtures);
  const grouped = groupByType(unique);

  log('\n═══════════════════════════════════════════════════');
  log('  PARITY BASELINES');
  log('═══════════════════════════════════════════════════\n');

  for (const type of types) {
    const items = grouped[type] || [];
    const withBaseline = items.filter(i => loadBaseline(type, i.value));
    log(`  ${type.padEnd(12)} ${withBaseline.length}/${items.length} baselines`);
  }

  log('\n═══════════════════════════════════════════════════\n');
  return 0;
}

async function runShow(args) {
  if (!args.show) {
    log('Usage: --show <type>/<id>');
    return 1;
  }

  const [type, ...idParts] = args.show.split('/');
  const id = idParts.join('/');
  const baseline = loadBaseline(type, id);

  if (!baseline) {
    log(`No baseline found for ${type}/${id}`);
    return 1;
  }

  console.log(JSON.stringify(baseline, null, 2));
  return 0;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = parseArgs(process.argv);

  if (!args.mode) {
    log(`
Parity Test CLI

Usage:
  node tests/parity-cli.mjs --update              Capture baselines from legacy
  node tests/parity-cli.mjs --update --type=plex  Capture single type
  node tests/parity-cli.mjs --snapshot            Test DDD against baselines
  node tests/parity-cli.mjs --snapshot --bail     Stop on first failure
  node tests/parity-cli.mjs --live                Compare legacy vs DDD live
  node tests/parity-cli.mjs --list                List all baselines
  node tests/parity-cli.mjs --show plex/663035    Show single baseline

Options:
  --type=TYPE    Filter to single input type
  --bail         Stop on first failure
  --verbose      Show detailed failure info
`);
    return 0;
  }

  switch (args.mode) {
    case 'update': return runUpdate(args);
    case 'snapshot': return runSnapshot(args);
    case 'live': return runLive(args);
    case 'list': return runList();
    case 'show': return runShow(args);
    default:
      log(`Unknown mode: ${args.mode}`);
      return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then(code => process.exit(code)).catch(err => {
    console.error('CLI error:', err);
    process.exit(1);
  });
}

export { parseArgs, runUpdate, runSnapshot, runLive, runList };
```

**Step 2: Make executable and commit**

```bash
chmod +x tests/parity-cli.mjs
git add tests/parity-cli.mjs
git commit -m "feat(test): add parity CLI with update/snapshot/live modes"
```

---

## Task 7: Add npm Scripts

**Files:**
- Modify: `package.json`

**Step 1: Add parity scripts to package.json**

Add these scripts to the "scripts" section:

```json
"parity:update": "node tests/parity-cli.mjs --update",
"parity:snapshot": "node tests/parity-cli.mjs --snapshot",
"parity:live": "node tests/parity-cli.mjs --live",
"parity:list": "node tests/parity-cli.mjs --list"
```

**Step 2: Commit**

```bash
git add package.json
git commit -m "chore: add parity test npm scripts"
```

---

## Task 8: Create Jest Integration

**Files:**
- Create: `tests/integration/api/parity-data-driven.test.mjs`

**Step 1: Write Jest integration test**

```javascript
// tests/integration/api/parity-data-driven.test.mjs
/**
 * Data-Driven Parity Tests (Jest Integration)
 *
 * Runs snapshot mode tests via Jest for CI integration.
 * Reads baselines from tests/fixtures/parity-baselines/
 *
 * Run with: npm test -- parity-data-driven
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { loadFixtures, dedupeFixtures, groupByType } from '../../lib/fixture-loader.mjs';
import { buildUrl, getSupportedTypes } from '../../lib/endpoint-map.mjs';
import {
  loadConfig,
  normalizeResponse,
  compareResponses,
  loadBaseline
} from '../../lib/parity-runner.mjs';

const config = loadConfig();
const BASE_URL = process.env.PARITY_TEST_URL || config.server.default_url;

async function fetchJSON(url) {
  const response = await fetch(`${BASE_URL}${url}`, {
    headers: { 'Accept': 'application/json' }
  });
  return {
    status: response.status,
    data: response.ok ? await response.json() : null
  };
}

describe('Data-Driven Parity Tests', () => {
  beforeAll(async () => {
    // Check server is running
    try {
      const res = await fetch(`${BASE_URL}/api/ping`);
      if (!res.ok) throw new Error('Server not responding');
    } catch (err) {
      console.error(`
╔═══════════════════════════════════════════════════════════════╗
║  PARITY TESTS REQUIRE A RUNNING SERVER                        ║
║                                                                ║
║  Start the server:  npm run dev                                ║
║  Then run tests:    npm test -- parity-data-driven             ║
╚═══════════════════════════════════════════════════════════════╝
      `);
      throw err;
    }
  });

  // Generate tests dynamically from fixtures
  const types = getSupportedTypes();

  for (const type of types) {
    describe(`${type} endpoints`, () => {
      it.each(
        // This will be populated at runtime
        []
      )('$label matches baseline', async ({ value, label }) => {
        const baseline = loadBaseline(type, value);
        if (!baseline) {
          console.log(`  [SKIP] ${label} - no baseline`);
          return;
        }

        const url = buildUrl(type, value, 'ddd');
        const result = await fetchJSON(url);

        expect(result.status).toBe(200);

        const comparison = compareResponses(
          baseline.response.body,
          result.data,
          baseline
        );

        if (!comparison.match) {
          console.log(`  Differences for ${label}:`);
          comparison.differences.slice(0, 5).forEach(d => {
            console.log(`    ${d.path}: ${JSON.stringify(d.baseline)?.slice(0, 30)} vs ${JSON.stringify(d.current)?.slice(0, 30)}`);
          });
        }

        expect(comparison.match).toBe(true);
      });
    });
  }
});

// Dynamic test generation
// Note: Jest doesn't support truly dynamic describe blocks well,
// so we use a simpler approach for CI

describe('Parity Snapshot Tests', () => {
  let fixtures = [];
  let grouped = {};

  beforeAll(async () => {
    fixtures = await loadFixtures();
    const unique = dedupeFixtures(fixtures);
    grouped = groupByType(unique);
  });

  it('runs all baseline comparisons', async () => {
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    const failures = [];

    for (const [type, items] of Object.entries(grouped)) {
      for (const item of items) {
        const baseline = loadBaseline(type, item.value);
        if (!baseline) {
          skipped++;
          continue;
        }

        const url = buildUrl(type, item.value, 'ddd');
        const result = await fetchJSON(url);

        if (result.status !== 200) {
          failed++;
          failures.push({ type, item, error: `HTTP ${result.status}` });
          continue;
        }

        const comparison = compareResponses(
          baseline.response.body,
          result.data,
          baseline
        );

        if (comparison.match) {
          passed++;
        } else {
          failed++;
          failures.push({ type, item, differences: comparison.differences });
        }
      }
    }

    console.log(`\nParity Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);

    if (failures.length > 0) {
      console.log('\nFailures:');
      for (const f of failures.slice(0, 10)) {
        console.log(`  ${f.type}/${f.item.value}: ${f.error || f.differences?.length + ' diffs'}`);
      }
    }

    expect(failed).toBe(0);
  }, 120000); // 2 minute timeout for all tests
});
```

**Step 2: Commit**

```bash
git add tests/integration/api/parity-data-driven.test.mjs
git commit -m "feat(test): add Jest integration for data-driven parity tests"
```

---

## Task 9: Create Runbook

**Files:**
- Create: `docs/runbooks/parity-testing.md`

**Step 1: Write runbook**

```markdown
# Parity Testing Runbook

## Overview

The parity test system validates that DDD (new) endpoints return responses compatible with legacy endpoints. It uses real data from `lists.yml` to generate test cases.

## Quick Reference

```bash
# Capture baselines from legacy (run once, or when legacy changes)
npm run parity:update

# Test DDD endpoints against baselines
npm run parity:snapshot

# Compare legacy vs DDD live (during migration)
npm run parity:live

# List baseline coverage
npm run parity:list
```

## When to Update Baselines

Update baselines when:
1. **Initial setup** - Run `npm run parity:update` to capture all baselines
2. **Intentional legacy changes** - If legacy behavior changes intentionally
3. **New content added** - If new items are added to lists.yml
4. **After fixing legacy bugs** - Capture the corrected response

```bash
# Update all baselines
npm run parity:update

# Update single type
node tests/parity-cli.mjs --update --type=plex

# Update single item (useful for debugging)
node tests/parity-cli.mjs --update --type=plex --id=663035
```

## Investigating Failures

### 1. Run with verbose output

```bash
node tests/parity-cli.mjs --snapshot --verbose
```

### 2. Check specific item

```bash
# Show the baseline
node tests/parity-cli.mjs --show plex/663035

# Compare manually
curl localhost:3112/media/plex/info/663035 | jq .
curl localhost:3112/api/content/plex/663035 | jq .
```

### 3. Check what frontend expects

Look at how frontend destructures the response. Only fields the frontend uses need to match exactly.

### 4. Tweak expectations

Edit the baseline file to add:
- `required_fields` - Fields that must exist
- `type_checks` - Fields where only type matters
- `ignore` - Additional fields to skip

Example:
```yaml
# tests/fixtures/parity-baselines/plex/663035.yml
_meta:
  captured_at: 2026-01-21T15:30:00Z

required_fields:
  - id
  - title
  - type

type_checks:
  - duration

ignore:
  - thumb_url  # Different CDN in legacy vs new

response:
  status: 200
  body:
    id: "663035"
    title: "Christmas"
    # ...
```

## CI Integration

The Jest test runs in CI:

```bash
npm test -- parity-data-driven
```

This runs all snapshot comparisons and fails if any DDD response differs from baseline.

## Input Types

| Type | Count | Legacy Endpoint | DDD Endpoint |
|------|-------|-----------------|--------------|
| plex | 132 | `/media/plex/info/{id}` | `/api/content/plex/{id}` |
| scripture | 11 | `/data/scripture/{path}` | `/api/local-content/scripture/{path}` |
| media | 10 | `/media/local/{path}` | `/api/local-content/media/{path}` |
| talk | 5 | `/data/talk/{path}` | `/api/local-content/talk/{path}` |
| hymn | 4 | `/data/hymn/{num}` | `/api/local-content/hymn/{num}` |
| poem | 2 | `/data/poetry/{path}` | `/api/local-content/poem/{path}` |
| list | 2 | `/data/list/{key}` | `/api/list/folder/{key}` |
| queue | 1 | `/data/list/{key}` | `/api/list/folder/{key}` |
| primary | 1 | `/data/primary/{num}` | `/api/local-content/primary/{num}` |

## File Structure

```
tests/
├── parity-cli.mjs                    # CLI entry point
├── lib/
│   ├── endpoint-map.mjs              # Type → URL mapping
│   ├── fixture-loader.mjs            # Reads lists.yml
│   └── parity-runner.mjs             # Comparison logic
├── fixtures/
│   └── parity-baselines/
│       ├── config.yml                # Global settings
│       ├── endpoint-map.yml          # Endpoint patterns
│       ├── plex/*.yml                # Plex baselines
│       ├── scripture/*.yml           # Scripture baselines
│       └── ...
└── integration/
    └── api/
        └── parity-data-driven.test.mjs
```

## Troubleshooting

### "No baseline found"

Run `npm run parity:update` to capture baselines.

### "Server not responding"

Start the dev server: `npm run dev`

### "Timeout" errors

- Check if Plex is online for plex type tests
- Increase timeout in `tests/fixtures/parity-baselines/config.yml`

### Many failures after DDD changes

If you intentionally changed DDD response structure:
1. Verify changes are correct
2. Update baselines: `npm run parity:update`
3. Review and commit baseline changes
```

**Step 2: Commit**

```bash
git add docs/runbooks/parity-testing.md
git commit -m "docs: add parity testing runbook"
```

---

## Task 10: Initial Baseline Capture

**Step 1: Ensure dev server is running**

```bash
# Check if running
ss -tlnp | grep 3112

# If not, start it
npm run dev &
```

**Step 2: Capture baselines from legacy**

```bash
npm run parity:update
```

**Step 3: Review and commit baselines**

```bash
git add tests/fixtures/parity-baselines/
git commit -m "test: add initial parity baselines from legacy"
```

---

## Summary

| Task | Files | Description |
|------|-------|-------------|
| 1 | `endpoint-map.yml` | Endpoint mapping configuration |
| 2 | `config.yml` | Global comparison settings |
| 3 | `endpoint-map.mjs` + test | URL builder from input types |
| 4 | `fixture-loader.mjs` + test | lists.yml parser |
| 5 | `parity-runner.mjs` + test | Comparison engine |
| 6 | `parity-cli.mjs` | CLI entry point |
| 7 | `package.json` | npm scripts |
| 8 | `parity-data-driven.test.mjs` | Jest integration |
| 9 | `parity-testing.md` | Runbook documentation |
| 10 | baselines/ | Initial capture |

Total: ~10 tasks, ~15 commits
