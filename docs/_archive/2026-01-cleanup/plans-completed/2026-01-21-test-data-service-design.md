# Test Data Service Design

## Overview

**testDataService** provides real, meaningful test data by reading from the data mount and Plex, replacing hardcoded fixture IDs in integration tests.

**Goals:**
- Avoid hardcoding fixture data in `tests/integration/`
- Test on real, meaningful data from the data mount and Plex
- Provide both input IDs and expected results for validation
- Read-only data only (mutable APIs use sandboxed fixtures)

## File Structure

```
data/system/testdata.yml           # Curated samples registry (in data mount)

tests/lib/testDataService.mjs      # Main service - orchestration, caching, sampling
tests/lib/testDataMatchers.mjs     # Expectation DSL parser & validators

backend/src/2_adapters/            # Existing adapters (may need minor additions)
  content/media/filesystem/        #   - FilesystemAdapter (local content)
  content/media/plex/              #   - PlexAdapter (plex items)
```

**Dependency flow:**

```
tests/integration/*.test.mjs
    ↓ imports
tests/lib/testDataService.mjs
    ↓ imports
backend/src/2_adapters/*Adapter.mjs
    ↓ imports
backend/src/0_infrastructure/utils/FileIO.mjs
```

## Registry File Format

Located at `data/system/testdata.yml`:

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
  # Where to discover if preferred samples missing
  discover_path: content/scripture

  preferred:
    - id: 1-nephi-1
      expect:
        reference: "1 Nephi 1"
        title: /chapter/i
        verses: array
        verses: length:>0

    - id: alma-32
      expect:
        reference: exists
        verses: array

hymn:
  discover_path: content/songs/hymns

  preferred:
    - id: "2"
      expect:
        title: /./              # non-empty string
        number: ">=1"
        hasAudio: boolean

primary:
  discover_path: content/songs/primary

  preferred:
    - id: "2"
      expect:
        title: exists

talk:
  discover_path: content/talks

  preferred:
    - id: ldsgc202510/11
      expect:
        title: exists
        speaker: string

poetry:
  discover_path: content/poetry

  preferred:
    - id: remedy/01
      expect:
        title: exists
        lines: array

plex:
  # No discover_path - uses Plex API
  discover_via: plex_api

  preferred:
    - id: "545219"
      expect:
        title: /./
        type: "movie|episode|track"
        duration: ">0"

    - id: "663035"
      expect:
        title: exists

list:
  discover_path: apps/lists

  preferred:
    - id: FHE
      expect:
        items: array
        items: length:>0
```

## Service API

### `loadTestData(spec)` - Primary batch loader

```javascript
/**
 * Load test data for multiple domains in one call.
 * Primary API for test setup.
 *
 * @param {Object} spec - What to load
 * @param {number} spec.scripture - Number of scripture samples
 * @param {number} spec.plex - Number of plex samples
 * @param {number} spec.hymn - Number of hymn samples
 * @param {number} spec.primary - Number of primary song samples
 * @param {number} spec.talk - Number of talk samples
 * @param {number} spec.poetry - Number of poetry samples
 * @param {string[]} spec.list - Specific list IDs to load
 * @returns {Promise<TestData>}
 *
 * @example
 * const data = await loadTestData({
 *   scripture: 2,
 *   plex: 3,
 *   hymn: 1,
 *   list: ['FHE', 'Bedtime']
 * });
 *
 * // Each sample has id + expected fields:
 * data.scripture[0].id        // '1-nephi-1'
 * data.scripture[0].expect    // { reference: '1 Nephi 1', ... }
 */
export async function loadTestData(spec) { }
```

### `getTestSample(domain, options)` - Single item fallback

```javascript
/**
 * Get a single test sample. Fallback for edge cases.
 *
 * @param {string} domain - 'scripture'|'plex'|'hymn'|'primary'|'talk'|'poetry'|'list'
 * @param {Object} options
 * @param {string} options.id - Specific ID (optional, otherwise picks from registry)
 * @returns {Promise<TestSample>}
 *
 * @example
 * const sample = await getTestSample('plex');
 * const specific = await getTestSample('list', { id: 'FHE' });
 */
export async function getTestSample(domain, options = {}) { }
```

### `validateExpectations(actual, expect)` - Response validator

```javascript
/**
 * Validate an API response against expected matchers.
 *
 * @param {Object} actual - API response body
 * @param {Object} expect - Matcher rules from sample.expect
 * @returns {{ valid: boolean, errors: string[] }}
 *
 * @example
 * const res = await fetchJSON(`/api/v1/content/plex/info/${sample.id}`);
 * const result = validateExpectations(res.body, sample.expect);
 * expect(result.errors).toEqual([]);
 */
export function validateExpectations(actual, expect) { }
```

### `clearCache()` - Cache control

```javascript
/**
 * Clear cached data. Call between test suites if needed.
 */
export function clearCache() { }
```

## Matcher DSL

Located in `tests/lib/testDataMatchers.mjs`:

| Pattern          | Example        | Matches                          |
|------------------|----------------|----------------------------------|
| `"exact"`        | `"hello"`      | `value === "hello"`              |
| `/regex/flags`   | `/chapter/i`   | `regex.test(value)`              |
| `exists`         | `exists`       | `value !== null && value !== undefined` |
| `string`         | `string`       | `typeof value === 'string'`      |
| `number`         | `number`       | `typeof value === 'number'`      |
| `boolean`        | `boolean`      | `typeof value === 'boolean'`     |
| `array`          | `array`        | `Array.isArray(value)`           |
| `">N"`           | `">10"`        | `value > 10`                     |
| `"<N"`           | `"<100"`       | `value < 100`                    |
| `">=N"`          | `">=1"`        | `value >= 1`                     |
| `"<=N"`          | `"<=50"`       | `value <= 50`                    |
| `"N-M"`          | `"10-100"`     | `value >= 10 && value <= 100`    |
| `"a\|b\|c"`      | `"movie\|episode"` | `['movie','episode'].includes(value)` |
| `contains:X`     | `contains:foo` | `value.includes('foo')`          |
| `length:OP`      | `length:>0`    | `value.length > 0`               |

## Discovery & Fallback

When curated samples are unavailable:

1. **Try preferred samples first** - Check each exists
2. **Fall back to discovery** - Scan directories or query Plex API
3. **Log warnings** - Visible in CI when baselines drift
4. **Continue with partial results** - Tests don't fail due to missing fixtures

**Warning output example:**
```
[testData] Preferred plex/545219 not found, will discover
[testData] Discovered 1 plex samples (missing from registry)
```

**Discovery strategies:**

| Domain | Strategy |
|--------|----------|
| scripture, hymn, primary, talk, poetry | Scan `discover_path` directory |
| plex | Query Plex API for recently added items |
| list | Scan `apps/lists` directory |

## Caching

- Registry loaded once per test run
- Results cached by spec signature (JSON stringified)
- `clearCache()` available for test isolation if needed

## Adapter Additions Needed

```javascript
// FilesystemAdapter - may need:
listAvailableIds(contentType)  // List all valid IDs for a content type

// PlexAdapter - may need:
listRecentlyAdded({ limit })   // Get sample of available plex items
checkItemExists(ratingKey)     // Verify a specific item still exists
```

## Usage Example

```javascript
// tests/integration/api/v1-regression.test.mjs
import { loadTestData, validateExpectations } from '../../lib/testDataService.mjs';

describe('API v1 Content Domain', () => {
  let testData;

  beforeAll(async () => {
    testData = await loadTestData({
      scripture: 1,
      plex: 1,
      hymn: 1
    });
  });

  it('GET /api/v1/content/plex/info/{id} returns valid data', async () => {
    const sample = testData.plex[0];
    const res = await fetchJSON(`/api/v1/content/plex/info/${sample.id}`);

    expect(res.status).toBe(200);
    const result = validateExpectations(res.body, sample.expect);
    expect(result.errors).toEqual([]);
  });
});
```

## Migration Path

To migrate `v1-regression.test.mjs`:

1. Replace hardcoded IDs (`'545219'`) with `testData.plex[0].id`
2. Replace manual field checks with `validateExpectations(body, sample.expect)`
3. Add `beforeAll` block to load test data

## Data Sources (Phase 1)

| Source | Location | Example IDs |
|--------|----------|-------------|
| Scripture | `data/content/scripture/` | `1-nephi-1`, `alma-32` |
| Hymns | `data/content/songs/hymns/` | `2`, `134` |
| Primary songs | `data/content/songs/primary/` | `2`, `17` |
| Talks | `data/content/talks/` | `ldsgc202510/11` |
| Poetry | `data/content/poetry/` | `remedy/01` |
| Plex | Live API | `545219`, `663035` |
| Lists | `data/apps/lists/` | `FHE` |

## Key Principles

- **Read-only data only** - Mutable APIs use sandboxed fixtures
- **Curated first, discovery fallback** - Stability with resilience
- **Adapters are single source of truth** - No duplicated data access logic
- **Warn on drift** - Visible in CI logs when baselines are stale
