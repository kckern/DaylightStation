# Testing Infrastructure Roadmap

> Comprehensive test coverage through isolation tiers, synthetic data, and automated verification

**Last Updated:** 2026-01-30
**Status:** Phase 1 Complete (Structure & Migration), Phases 2-4 Pending
**Related:** docs/plans/2026-01-30-testing-strategy-design.md

---

## Overview

The testing infrastructure has been reorganized around a 3x6 matrix:
- **3 Isolation Levels:** isolated (no I/O), integrated (household-demo), live (real backend)
- **6 Test Targets:** domain, adapter, flow, contract, assembly, api

This document outlines next steps to fully realize the testing strategy.

---

## Current State (Completed)

### Infrastructure
- [x] Port lock manager (`scripts/port-manager.mjs`) for reliable dev server cleanup
- [x] Docker test environment (`docker-compose.test.yml`, `scripts/test-env.sh`)
- [x] Test harnesses for all three isolation tiers
- [x] Environment configuration (`dev`/`test`/`prod`)
- [x] npm scripts (`test:isolated`, `test:integrated`, `test:live`, etc.)

### Migration
- [x] 151 isolated tests migrated to `tests/isolated/`
- [x] 7 integrated tests migrated to `tests/integrated/`
- [x] 26 live adapter tests migrated to `tests/live/adapter/`
- [x] 26 runtime flow tests migrated to `tests/live/flow/`
- [x] Shared utilities consolidated in `tests/_lib/`

### Scaffolding
- [x] Generator skeletons (`setup-household-demo.mjs`, `strava.generator.mjs`, `fitness.simulator.mjs`)
- [x] Placeholder tests for new categories

---

## Phase 2: Fix Broken Import Paths

**Priority:** High
**Effort:** Medium
**Blocking:** Tests won't pass until imports are fixed

After migration, many test files have broken relative imports. Need to:

1. **Run import path updater:**
   ```bash
   node scripts/update-test-imports.mjs --dry-run  # Preview
   node scripts/update-test-imports.mjs            # Apply
   ```

2. **Manual fixes for edge cases:**
   - Tests importing from `../../lib/` need `#testlib/`
   - Tests importing from `../_fixtures/` need `#fixtures/`
   - Backend imports should use existing aliases (`#domains/`, `#adapters/`, etc.)

3. **Verify tests pass:**
   ```bash
   npm run test:isolated
   ```

### Success Criteria
- [ ] `npm run test:isolated` runs without import errors
- [ ] 80%+ of isolated tests pass (some may have other issues)

---

## Phase 3: Populate household-demo

**Priority:** High
**Effort:** Large
**Depends on:** Phase 2

The `tests/_infrastructure/generators/setup-household-demo.mjs` is a skeleton. Need to populate with realistic test data.

### Data to Generate

| Domain | Data Type | Generator |
|--------|-----------|-----------|
| Fitness | Workouts, sessions, zones | `strava.generator.mjs`, `withings.generator.mjs` |
| Finance | Transactions, budgets, accounts | `finance.generator.mjs` |
| Content | Watch history, playlists, queue | `plex.generator.mjs` |
| Calendar | Events, todos | `calendar.generator.mjs` |
| Journaling | Entries, debriefs | `journaling.generator.mjs` |

### Public Domain Characters

| User | Persona | Test Focus |
|------|---------|------------|
| Popeye | Fitness enthusiast | Workouts, sessions, zones |
| Olive Oyl | Organized planner | Calendar, todos, routines |
| Mickey Mouse | Media consumer | Playlists, watch history |
| Betty Boop | Music lover | Audio playback, songs |
| Tintin | Guest user | Limited permissions, onboarding |

### Date-Relative Generation

All timestamps should be relative to "now" so data always appears fresh:
```javascript
const today = new Date();
const workout = { date: addDays(today, -1), ... };
```

### Success Criteria
- [ ] `npm run test:reset-data` generates complete household-demo
- [ ] Integrated tests can read and verify the generated data
- [ ] Data matches production schema shapes

---

## Phase 4: Add Missing Test Categories

**Priority:** Medium
**Effort:** Large
**Depends on:** Phases 2-3

### Contract Tests (`tests/isolated/contract/`)

Interface compliance and schema validation:
- [ ] Adapter interface compliance (do adapters match their port signatures?)
- [ ] API response shape validation (do endpoints return expected shapes?)
- [ ] Event schema validation (do events match their contracts?)

### Assembly Tests (`tests/integrated/assembly/`)

Cross-DDD layer wiring verification:
- [ ] API → Application wiring (does router call correct service?)
- [ ] Application → Domain wiring (does service call correct entities?)
- [ ] Domain → Adapter wiring (does domain use correct adapter?)
- [ ] Full vertical slices (request → response through all layers)

### Live API Tests (`tests/live/api/`)

Postman-like endpoint testing:
- [ ] Endpoint smoke tests (do all endpoints respond?)
- [ ] Response baseline tests (do responses match snapshots?)
- [ ] Error handling tests (do errors have correct shapes?)

---

## Phase 5: State Machine Flow Tests

**Priority:** Medium
**Effort:** Medium
**Depends on:** Phase 4

The Journalist and Fitness domains have complex state machines. Need exhaustive path coverage.

### Journalist Flow Tests

```
START → IDLE → ACTIVE → INTERVIEWING → COMPLETE
              ↓
           STUCK → RECOVERY
```

- [ ] Happy path: Full debrief completion
- [ ] Stuck state: Recovery from interruption
- [ ] Edge cases: Timeout, invalid input, concurrent sessions

### Fitness Governance Tests

```
WAITING → COUNTDOWN → ACTIVE → COOLDOWN → COMPLETE
                      ↓
                   PAUSED
```

- [ ] Happy path: Full session with zones
- [ ] Multi-user: Session handoff
- [ ] Edge cases: Device disconnect, zone fallback

---

## Phase 6: Real-Time Simulators

**Priority:** Low
**Effort:** Medium
**Depends on:** Phases 3-5

For testing WebSocket-based features without hardware.

### Fitness Simulator

Simulates ANT+ device data:
- Heart rate broadcasts
- Cadence/power data
- Device connect/disconnect events

```bash
# Run simulator during integration tests
node tests/_infrastructure/generators/realtime/fitness.simulator.mjs
```

### Piano Simulator

Simulates MIDI events:
- Note on/off events
- Sustain pedal
- Velocity changes

---

## Phase 7: CI/CD Integration

**Priority:** Low
**Effort:** Medium
**Depends on:** Phases 2-5

### GitHub Actions Pipeline

```yaml
# .github/workflows/test.yml
jobs:
  isolated:
    runs-on: ubuntu-latest
    steps:
      - run: npm run test:isolated

  integrated:
    runs-on: ubuntu-latest
    steps:
      - run: npm run test:reset-data
      - run: npm run test:integrated

  live:
    runs-on: ubuntu-latest
    services:
      daylight-test:
        image: kckern/daylight-station:test
        ports:
          - 3113:3111
    steps:
      - run: npm run test:live --env=test
```

### Coverage Tracking
- [ ] Configure Jest coverage for isolated tests
- [ ] Set up coverage reporting (Codecov, Coveralls)
- [ ] Add coverage badges to README

---

## Quick Reference

### Running Tests

```bash
# Fast, no I/O
npm run test:isolated

# With household-demo data
npm run test:integrated

# Against running backend
npm run test:live
npm run test:live:api
npm run test:live:flow

# Everything
npm run test:all
```

### Managing Test Environment

```bash
# Start/stop Docker test environment
npm run test:env:start
npm run test:env:stop
npm run test:env:reset

# Clean up ports
npm run test:clean-ports

# Regenerate test data
npm run test:reset-data
```

### Dev Server Management

```bash
# Start with port lock
./scripts/dev-server.sh

# Check port status
node scripts/port-manager.mjs status 3112

# Force kill stuck process
node scripts/port-manager.mjs kill 3112
```

---

## Dependencies

| Phase | Depends On | Blocks |
|-------|------------|--------|
| Phase 2 (Import Paths) | - | Everything |
| Phase 3 (household-demo) | Phase 2 | Phases 4-6 |
| Phase 4 (New Categories) | Phases 2-3 | Phase 7 |
| Phase 5 (State Machines) | Phase 4 | - |
| Phase 6 (Simulators) | Phases 3-5 | - |
| Phase 7 (CI/CD) | Phases 2-5 | - |

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Isolated test count | 151 | 200+ |
| Integrated test count | 7 | 50+ |
| Live test count | 52 | 75+ |
| Import errors | Many | 0 |
| household-demo completeness | Skeleton | Full |
| CI pipeline | None | Green |
