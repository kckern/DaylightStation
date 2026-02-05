# Testing Infrastructure

**Related code:** `tests/`, `jest.config.js`

## Overview

DaylightStation uses dedicated test harnesses for running tests, with Jest under the hood. Playwright handles e2e runtime tests separately.

## Test Harnesses

### Unit Test Harness

```bash
node tests/unit/harness.mjs [options]
```

Runs mocked function tests from `tests/unit/suite/`.

### Integration Test Harness

```bash
node tests/integration/harness.mjs [options]
```

Runs backend API tests from `tests/integration/suite/` using testDataService for real data.

### Harness Options

| Option | Description |
|--------|-------------|
| `--only=a,b` | Run only specified folders |
| `--skip=a,b` | Skip specified folders |
| `--pattern=text` | Only tests matching pattern |
| `--verbose, -v` | Show full output |
| `--dry-run` | Show what would run |
| `--watch, -w` | Watch mode |
| `--coverage` | Generate coverage report |
| `--smoke` | (integration only) Run smoke tests |

### Examples

```bash
# Unit tests - all
node tests/unit/harness.mjs

# Unit tests - specific folders
node tests/unit/harness.mjs --only=adapters,domains

# Unit tests - pattern match
node tests/unit/harness.mjs --pattern=PlexAdapter

# Integration tests - all
node tests/integration/harness.mjs

# Integration tests - API only
node tests/integration/harness.mjs --only=api

# Integration tests - smoke only
node tests/integration/harness.mjs --smoke

# Watch mode
node tests/unit/harness.mjs --watch
```

## Directory Structure

```
tests/
├── _archive/              # Archived/obsolete tests
├── _fixtures/             # Dummy data for mocked tests
├── integration/
│   ├── harness.mjs        # Integration test harness
│   ├── _wip/              # Work in progress
│   ├── suite/             # Regression baseline
│   │   ├── api/           # API endpoint tests
│   │   ├── content-domain/
│   │   └── routing/
│   ├── edge/              # Edge cases
│   └── external/          # External API tests (credentials required)
│       └── harness.mjs    # External API harness
├── lib/                   # Test utilities
│   ├── testDataService.mjs
│   ├── testDataMatchers.mjs
│   └── migrate-imports.mjs
├── runtime/               # Playwright e2e tests
│   ├── _wip/
│   ├── suite/
│   └── edge/
└── unit/
    ├── harness.mjs        # Unit test harness
    ├── _wip/
    ├── suite/             # All unit tests
    │   ├── adapters/
    │   ├── api/
    │   ├── applications/
    │   ├── config/
    │   ├── content/
    │   ├── domains/
    │   ├── fitness/
    │   ├── infrastructure/
    │   ├── layout/
    │   ├── logging/
    │   ├── nutribot/
    │   └── voice-memo/
    └── edge/
```

### Subdirectory Purposes

| Directory | Purpose |
|-----------|---------|
| `_wip/` | Tests under development, debugging, or feature work |
| `suite/` | Stable regression tests that run in CI |
| `edge/` | Edge cases, special scenarios, flaky tests |

## Path Aliases

Tests use path aliases instead of relative paths. Configured in `jest.config.js`:

| Alias | Resolves To | Example |
|-------|-------------|---------|
| `@backend/` | `backend/` | `import { X } from '@backend/src/1_domains/...'` |
| `@frontend/` | `frontend/src/` | `import { X } from '@frontend/hooks/...'` |
| `@extensions/` | `_extensions/` | `import { X } from '@extensions/fitness/...'` |
| `@fixtures/` | `tests/_fixtures/` | `import { X } from '@fixtures/media/...'` |
| `@testlib/` | `tests/lib/` | `import { X } from '@testlib/testDataService.mjs'` |

### Migrating Imports

Use the migration script to convert relative paths to aliases:

```bash
# Preview changes
node tests/lib/migrate-imports.mjs --dry-run

# Apply changes
node tests/lib/migrate-imports.mjs
```

## Test Categories

| Category | Harness | Data Source |
|----------|---------|-------------|
| Unit | `node tests/unit/harness.mjs` | `_fixtures/` (dummy) |
| Integration | `node tests/integration/harness.mjs` | testDataService |
| External | `node tests/integration/external/harness.mjs` | Live APIs |
| Runtime | `npx playwright test` | Real backend |

## testDataService

Provides real, meaningful test data from the data mount instead of hardcoded fixtures.

### Usage

```javascript
import { loadTestData, validateExpectations } from '@testlib/testDataService.mjs';

describe('API tests', () => {
  let testData;

  beforeAll(async () => {
    testData = await loadTestData({
      scripture: 1,
      plex: 2,
      hymn: 1
    });
  });

  it('returns valid plex data', async () => {
    const sample = testData.plex[0];
    const res = await fetch(`/api/v1/info/plex/${sample.id}`);
    const body = await res.json();

    const result = validateExpectations(body, sample.expect);
    expect(result.errors).toEqual([]);
  });
});
```

### Registry File

Test samples are defined in `data/system/testdata.yml` (in the data mount):

```yaml
scripture:
  discover_path: content/scripture
  default_expect:
    reference: exists
  preferred:
    - id: 1-nephi-1
      expect:
        reference: /1 Nephi 1/i
        verses: array

plex:
  discover_via: plex_api
  preferred:
    - id: "545219"
      expect:
        title: /./
        type: "movie|episode|track"
```

### Matcher DSL

| Pattern | Example | Matches |
|---------|---------|---------|
| `"exact"` | `"hello"` | Exact string match |
| `/regex/i` | `/chapter/i` | Regex test |
| `exists` | `exists` | Not null/undefined |
| `string` | `string` | Type check |
| `number` | `number` | Type check |
| `boolean` | `boolean` | Type check |
| `array` | `array` | Array.isArray |
| `">N"` | `">10"` | Greater than |
| `"<N"` | `"<100"` | Less than |
| `">=N"` | `">=1"` | Greater or equal |
| `"N-M"` | `"10-100"` | Inclusive range |
| `"a\|b"` | `"movie\|episode"` | Enum (one of) |
| `contains:X` | `contains:foo` | Includes substring |
| `length:OP` | `length:>0` | Length check |

## Writing New Tests

1. **Choose the right category:**
   - Unit test? → `tests/unit/suite/`
   - API test? → `tests/integration/suite/`
   - External API? → `tests/integration/external/`
   - E2E? → `tests/runtime/suite/`

2. **Use path aliases:**
   ```javascript
   import { X } from '@backend/src/...';  // Not '../../../backend/...'
   ```

3. **Use testDataService for real data:**
   ```javascript
   import { loadTestData } from '@testlib/testDataService.mjs';
   ```

4. **Use `_fixtures/` only for dummy/mock data:**
   - Synthetic test data that doesn't need to be real
   - Mock responses for external services

5. **Naming conventions:**

| Pattern | Type |
|---------|------|
| `*.unit.test.mjs` | Unit tests |
| `*.assembly.test.mjs` | Multi-component unit tests |
| `*.test.mjs` | Integration tests |
| `*.spec.mjs` | Playwright tests |
| `_smoke.*.test.mjs` | Smoke tests |
