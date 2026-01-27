# Tests Folder Reorganization

**Status:** Complete

## Final Structure

```
tests/
├── _archive/                    # Old/obsolete tests
│   ├── parity-fixtures/         # Archived parity baselines
│   └── parity-unit-tests/       # Archived parity test code
├── _fixtures/                   # True dummy data only (no local env data)
│   ├── fitness/
│   ├── folder/
│   ├── local-content/
│   ├── media/
│   ├── profiling/
│   └── watch-state/
├── integration/                 # Backend API tests
│   ├── _wip/                    # Debug and feature dev
│   ├── suite/                   # Regression baseline
│   │   ├── api/                 # API endpoint tests
│   │   ├── content-domain/      # Content domain tests
│   │   └── routing/             # Routing middleware tests
│   ├── edge/                    # Special cases
│   └── external/                # External API tests (gmail, strava, etc.)
├── lib/                         # Test utilities
│   ├── testDataService.mjs      # Provides real test data from data mount
│   ├── testDataMatchers.mjs     # Expectation DSL parser
│   └── migrate-imports.mjs      # Path migration utility
├── runtime/                     # Playwright e2e (frontend + real backend)
│   ├── _wip/
│   ├── suite/
│   └── edge/
└── unit/                        # Mocked function invocations
    ├── _wip/
    ├── suite/                   # All unit tests organized by domain
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

## Path Aliases (jest.config.js)

Instead of brittle relative paths, tests now use path aliases:

| Alias | Resolves To | Usage |
|-------|-------------|-------|
| `@backend/` | `<rootDir>/backend/` | `import { X } from '@backend/src/...'` |
| `@frontend/` | `<rootDir>/frontend/src/` | `import { X } from '@frontend/...'` |
| `@extensions/` | `<rootDir>/_extensions/` | `import { X } from '@extensions/...'` |
| `@fixtures/` | `<rootDir>/tests/_fixtures/` | `import { X } from '@fixtures/...'` |
| `@testlib/` | `<rootDir>/tests/lib/` | `import { X } from '@testlib/...'` |

## Migration Script

`tests/lib/migrate-imports.mjs` converts relative paths to aliases:

```bash
# Dry run - see what would change
node tests/lib/migrate-imports.mjs --dry-run

# Actually convert
node tests/lib/migrate-imports.mjs
```

## Test Categories

| Category | Purpose | Data Source | Run By Default |
|----------|---------|-------------|----------------|
| `unit/suite/` | Mocked function invocations | `_fixtures/` (dummy) | Yes |
| `integration/suite/` | Backend API tests | testDataService | Yes |
| `integration/external/` | External API tests | Live external APIs | No |
| `runtime/suite/` | Playwright e2e | Real backend | No (Playwright) |

## Naming Conventions

| Pattern | Meaning |
|---------|---------|
| `*.unit.test.mjs` | Unit tests |
| `*.assembly.test.mjs` | Multi-component unit tests (in `unit/suite/`) |
| `*.test.mjs` | Integration tests |
| `*.spec.mjs` | Runtime/Playwright tests |
| `_smoke.*.test.mjs` | Quick sanity checks |

## Key Changes

1. **Path aliases** - No more brittle relative paths
2. **live/ → integration/external/** - External API tests properly categorized
3. **assembly/ → unit/suite/** - Multi-component tests are still unit tests
4. **smoke/ merged into integration/** - Now uses `_smoke.*` naming
5. **parity tests archived** - Moved to `_archive/` after conversion to regression tests
6. **fixtures/ deleted** - testDataService handles test data
7. **_wip/suite/edge structure** - Each test category has consistent organization
