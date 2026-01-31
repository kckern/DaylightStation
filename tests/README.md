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
