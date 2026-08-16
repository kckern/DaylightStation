# Testing Context

## Three runners, and how a file gets one

The repo runs **jest**, **vitest** and **node:test**, and which one executes a
file is decided by what the file imports — not by where it lives. Getting this
wrong does not produce an error; it produces a file nobody runs.

| Runner | Population | Gate |
|--------|-----------|------|
| jest | `tests/unit/suite/` | `npm run test:unit` |
| vitest | `tests/unit`, `tests/isolated` (excluding `suite/` and `backend/`) | `npm run test:unit:vitest` (ratchet) |
| mixed | `backend/tests/` — 60 vitest + 35 node:test | `npm run test:backend` |

The mixing is why `backend/tests` needs its own runner: `describe` from
`node:test` does not register with vitest (vitest reports "No test suite
found"), and a file importing from `'vitest'` does not run under `node --test`
at all. `scripts/test-backend.mjs` splits the tree by import and runs each half
under the right runner.

Two traps:

- **A file that imports nothing still runs under vitest**, because
  `vitest.config.mjs` sets `globals: true`. Seven files in `backend/tests` do
  exactly this. Absence of a `vitest` import does not mean it is a node:test
  file.
- **`@jest/globals` throws under vitest** and no jest glob covers
  `backend/tests`, so such a file is unrunnable anywhere. `test:backend` fails
  the run rather than skipping it.

All three are wired into `npm test`. Before 2026-08-16 `backend/tests` was in
none of them — 89 files executed by nothing, which is how it accumulated 18
vitest failures, 28 node:test failures, two files importing an alias that never
existed, and one testing a deleted module.

## Quick Reference

| Category | Harness | Data Source |
|----------|---------|-------------|
| Unit | `node tests/unit/harness.mjs` | `_fixtures/` (dummy) |
| Integration | `node tests/integration/harness.mjs` | testDataService |
| External | `node tests/integration/external/harness.mjs` | Live APIs |
| Runtime | `npx playwright test` | Real backend |

## Running Tests

### Unit Tests

```bash
# Run all unit tests
node tests/unit/harness.mjs

# Run specific folders
node tests/unit/harness.mjs --only=adapters,domains

# Skip folders
node tests/unit/harness.mjs --skip=voice-memo

# Pattern match
node tests/unit/harness.mjs --pattern=PlexAdapter

# Watch mode
node tests/unit/harness.mjs --watch
```

### Integration Tests

```bash
# Run all integration tests
node tests/integration/harness.mjs

# Run specific folders
node tests/integration/harness.mjs --only=api

# Pattern match
node tests/integration/harness.mjs --pattern=v1-regression

# Smoke tests only
node tests/integration/harness.mjs --smoke
```

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

## Directory Structure

```
tests/
├── _archive/              # Archived tests
├── _fixtures/             # Dummy data for mocked tests
├── integration/
│   ├── harness.mjs        # Integration test harness
│   ├── _wip/              # Work in progress
│   ├── suite/             # Regression baseline
│   ├── edge/              # Edge cases
│   └── external/          # External API tests
├── lib/                   # testDataService, matchers
├── runtime/               # Playwright e2e
└── unit/
    ├── harness.mjs        # Unit test harness
    ├── _wip/, suite/, edge/
```

## Path Aliases

Use these instead of relative paths:

```javascript
import { X } from '@backend/src/1_domains/...';    // backend/
import { X } from '@frontend/hooks/...';           // frontend/src/
import { X } from '@fixtures/media/...';           // tests/_fixtures/
import { X } from '@testlib/testDataService.mjs';  // tests/lib/
```

## testDataService

Provides real test data from the data mount instead of hardcoded fixtures.

```javascript
import { loadTestData, validateExpectations } from '@testlib/testDataService.mjs';

const testData = await loadTestData({ scripture: 1, plex: 2 });
const sample = testData.plex[0];
// sample.id = '545219'
// sample.expect = { title: /regex/, type: 'movie|episode' }
```

Registry: `data/system/testdata.yml`

## Writing Tests

1. **Use path aliases** - Not relative paths
2. **Use testDataService** - For real data from data mount
3. **Use `_fixtures/`** - Only for dummy/mock data
4. **Choose right category:**
   - Unit test? → `tests/unit/suite/`
   - API test? → `tests/integration/suite/`
   - E2E? → `tests/runtime/suite/`

## Reference

See `docs/reference/core/testing.md` for full documentation.
