# DaylightStation Test Suite

## Structure

```
tests/
├── isolated/      # No I/O, pure logic (fast)
├── integrated/    # Real I/O, household-demo data
├── live/          # Full stack, real services
├── _infrastructure/  # Generators, harnesses, baselines
├── _lib/          # Shared utilities
└── _fixtures/     # Test data files
```

## Running Tests

```bash
# All isolated tests (fast)
npm run test:isolated

# All integrated tests (requires household-demo)
npm run test:integrated

# All live tests (requires running backend)
npm run test:live

# Specific target
npm run test:isolated -- --only=domain
npm run test:live -- --only=api
```

## Environments

```bash
# Dev server (default)
npm run test:live

# Test Docker environment
npm run test:live -- --env=test

# Production (read-only)
npm run test:live -- --env=prod
```

## Live Adapter Tests as CLI Tools

Live adapter tests (`tests/live/adapter/`) connect to real APIs and can be used as CLI utilities for manual operations like backfilling and data maintenance.

See [`tests/live/adapter/README.md`](./live/adapter/README.md) for:
- Running the test harness with `--backfill-since`
- Using finance tests to categorize transactions
- Environment variables for dry-run and batch modes
- Writing new live tests that serve as CLI tools
