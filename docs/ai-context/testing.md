# Testing Context

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
