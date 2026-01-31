# Testing Strategy Design

## Overview

A comprehensive testing framework organized by isolation level and test target, with rich synthetic test data and real public domain content for realistic testing.

## Test Organization

### Directory Structure

```
tests/
├── isolated/              # No I/O, no network, pure logic
│   ├── domain/            # Entity logic, services, calculations
│   ├── adapter/           # Mocked response handling, shape parsing
│   ├── flow/              # State machine transitions (mocked deps)
│   ├── contract/          # Interface shape definitions, schema validation
│   └── assembly/          # Layer wiring with mocked externals
│
├── integrated/            # Real I/O, controlled data (household-demo)
│   ├── domain/            # Cross-domain orchestration
│   ├── adapter/           # Real file I/O, real adapter calls
│   ├── flow/              # User journeys with synthetic data
│   ├── contract/          # Adapter-to-interface compliance
│   └── assembly/          # Full layer stack with household-demo
│
├── live/                  # Full stack, real services
│   ├── api/               # HTTP endpoint testing (Postman-like)
│   ├── adapter/           # External service connectivity (system input)
│   └── flow/              # E2E Playwright (browser automation)
│
└── _infrastructure/       # Shared tooling
    ├── generators/
    │   ├── harvesters/    # Fake data generators per service
    │   │   ├── strava.generator.mjs
    │   │   ├── withings.generator.mjs
    │   │   ├── garmin.generator.mjs
    │   │   ├── lastfm.generator.mjs
    │   │   ├── plex.generator.mjs
    │   │   └── ...
    │   ├── realtime/      # Real-time simulation
    │   │   ├── fitness.simulator.mjs   # HR, cadence
    │   │   └── piano.simulator.mjs     # MIDI events
    │   └── setup-household-demo.mjs    # Orchestrates all generators
    ├── household-demo/    # Generated synthetic data
    ├── harnesses/
    │   ├── isolated.harness.mjs
    │   ├── integrated.harness.mjs
    │   └── live.harness.mjs
    ├── baselines/         # API response snapshots
    └── environments.yml   # dev/test/prod configuration
```

### Isolation Levels

| Level | I/O | Network | Data Source | Use Case |
|-------|-----|---------|-------------|----------|
| **isolated** | None | None | Fixtures, mocks | Pure logic, fast feedback |
| **integrated** | Real | None (local) | household-demo | Controlled integration, reproducible |
| **live** | Real | Real | Real services | Production-like validation |

### Test Targets

| Target | Direction | What It Tests |
|--------|-----------|---------------|
| **domain** | Internal | Business logic, entities, services |
| **adapter** | Input | External service → system (harvesters, Plex, etc.) |
| **flow** | Journey | Multi-step user scenarios, state machines |
| **contract** | Shape | Interface compliance, response schemas |
| **assembly** | Wiring | DDD layer integration (API → App → Domain → Adapter) |
| **api** | Output | System → clients (HTTP endpoints) |

### Matrix

|              | isolated | integrated | live |
|--------------|----------|------------|------|
| **domain**   | ✓        | ✓          | -    |
| **adapter**  | ✓        | ✓          | ✓    |
| **flow**     | ✓        | ✓          | ✓    |
| **contract** | ✓        | ✓          | -    |
| **assembly** | ✓        | ✓          | -    |
| **api**      | -        | -          | ✓    |

---

## Test Data Strategy

### household-demo

A rich, regenerable synthetic dataset modeled after real production data.

**Generation:**
```bash
# Reset to known state before test runs
node tests/_infrastructure/generators/setup-household-demo.mjs

# Or as npm script
npm run test:reset-data
```

**Users (Public Domain Characters):**

| User | Persona | Test Focus |
|------|---------|------------|
| Popeye | Fitness enthusiast | Workouts, sessions, zones |
| Olive Oyl | Organized planner | Calendar, todos, routines |
| Mickey Mouse | Media consumer | Playlists, watch history |
| Betty Boop | Music lover | Audio playback, songs |
| Tintin | Guest user | Limited permissions, onboarding |

**Date-Relative Generation:**

All dates are generated relative to "now" so data always appears fresh:

```javascript
const today = new Date();
const databank = {
  calendar: [
    { title: "Spinach delivery", date: addDays(today, 2) },
    { title: "Gym with Bluto", date: addDays(today, -3) },
  ],
  workouts: [
    { user: "popeye", date: addDays(today, -1), type: "strength" },
  ],
  transactions: [
    { user: "olive", date: addDays(today, -5), amount: -42.50 },
  ]
};
```

### Real Public Domain Content

For `live/` tests, use real integrations with demo-safe content:

| Platform | Content | Purpose |
|----------|---------|---------|
| Plex | CC0 fitness videos | Player, FitnessPlayer testing |
| Plex | Public domain music | Audio playback, playlists |
| Immich | Public domain art album | Photo integration testing |

This enables testing real API behavior, real media playback, and real transcoding without privacy or copyright concerns.

### Harvester Data Generators

For each harvester adapter, a parallel generator creates matching fake data:

```
tests/_infrastructure/generators/harvesters/
├── strava.generator.mjs      # Fake activities, zones, heart rate
├── withings.generator.mjs    # Fake weight, blood pressure, sleep
├── garmin.generator.mjs      # Fake workouts, steps
├── lastfm.generator.mjs      # Fake scrobbles, listening history
├── plex.generator.mjs        # Fake watch history (refs real CC0 content)
├── calendar.generator.mjs    # Fake events, todos
├── finance.generator.mjs     # Fake transactions, budgets
└── ...
```

Each generator:
- Produces data matching the real API response shapes
- Uses date-relative timestamps
- Associates data with public domain user personas

### Real-Time Simulators

For WebSocket-based real-time features:

| Simulator | Data | Use Case |
|-----------|------|----------|
| `fitness.simulator.mjs` | Heart rate, cadence (ANT+ protocol) | Fitness session testing |
| `piano.simulator.mjs` | MIDI note on/off, sustain | Piano visualizer testing |

These follow the patterns from `_extensions/fitness/simulation.mjs` and `_extensions/piano/simulation.mjs` but are purpose-built for test automation.

---

## Environment Configuration

Tests are environment-agnostic; the target is configurable:

```yaml
# tests/_infrastructure/environments.yml
dev:
  url: http://localhost:3112
  data: household-demo

test:
  url: http://localhost:3113
  data: household-demo
  docker: daylight-test

prod:
  url: http://daylight.local:3111
  data: real
  readonly: true  # Only non-destructive tests
```

**Usage:**
```bash
# Default: dev server
node tests/live/api/harness.mjs

# Target test environment
node tests/live/api/harness.mjs --env=test

# Target prod (read-only tests)
node tests/live/api/harness.mjs --env=prod
```

---

## Migration from Current Structure

| Current | New Location |
|---------|--------------|
| `tests/unit/` | `tests/isolated/` (reorganized by target) |
| `tests/integration/suite/api/` | `tests/live/api/` |
| `tests/integration/external/` | `tests/live/adapter/` |
| `tests/runtime/` | `tests/live/flow/` |
| `tests/_fixtures/` | `tests/_infrastructure/household-demo/` (regenerated) |
| `tests/lib/` | `tests/_infrastructure/` (harnesses, utilities) |

---

## Test Harnesses

Each isolation level has a dedicated harness:

### isolated.harness.mjs
- No environment setup required
- Fast execution
- Mocking utilities built-in

### integrated.harness.mjs
- Ensures household-demo exists (regenerates if stale)
- Sets data mount to household-demo
- Provides test data utilities

### live.harness.mjs
- Validates environment connectivity
- Supports `--env` flag
- Read-only mode for production

---

## Assembly Tests (Cross-DDD Layer)

Verify DDD layers wire together correctly:

### isolated/assembly/
Tests layer boundaries with mocked dependencies:

```javascript
// api-to-application.test.mjs
describe('API → Application wiring', () => {
  it('fitness router calls FitnessService.startSession', async () => {
    const mockService = { startSession: jest.fn() };
    const router = createFitnessRouter({ fitnessService: mockService });

    await request(router).post('/session/start').send({ userId: 'popeye' });

    expect(mockService.startSession).toHaveBeenCalledWith('popeye');
  });
});
```

### integrated/assembly/
Tests full vertical slices with household-demo:

```javascript
// vertical-slice.test.mjs
describe('Full stack: Start fitness session', () => {
  it('API call flows through all layers', async () => {
    // Uses real services wired together, household-demo data
    const response = await fetch('/api/v1/fitness/session/start', {
      method: 'POST',
      body: JSON.stringify({ userId: 'popeye' })
    });

    expect(response.status).toBe(200);
    // Verify data written to household-demo
    const sessionFile = await fs.readFile('household-demo/users/popeye/fitness/sessions/...');
    expect(sessionFile).toContain('active');
  });
});
```

---

## Key Testing Scenarios

### Content/Media (Priority 1)
- Path resolution (file exists but not found)
- File I/O errors (permissions, missing mounts)
- Plex transcoding failures
- Silent failures (operation "succeeds" but data wrong)

### Journalist (Priority 2)
- State machine exhaustive paths
- Stuck states recovery
- AI prompt/response handling
- Flow divergence and recovery

### Fitness (Priority 3)
- Multi-user session flows
- Harvester integration desync
- Real-time WebSocket data (simulator)
- Governance state machines

### TVApp/Player (Priority 4)
- Configuration permutations (shader, volume, playback rate)
- Lifecycle paths (mount → play → pause → resume → unmount)
- Queue management
- Error recovery (stall, network failure)

---

## Success Criteria

1. **Reproducible** - Any test can be re-run with identical results
2. **Isolated** - Tests don't interfere with each other
3. **Fast feedback** - `isolated/` runs in seconds, `integrated/` in under a minute
4. **Real-world coverage** - Tests catch the failures seen in production
5. **Maintainable** - Adding new tests follows clear patterns

---

## Implementation Phases

### Phase 1: Infrastructure
- [ ] Create directory structure
- [ ] Build harnesses for each isolation level
- [ ] Create `setup-household-demo.mjs` scaffold
- [ ] Define public domain user personas

### Phase 2: household-demo Population
- [ ] Implement date-relative generators
- [ ] Create harvester data generators (strava, withings, etc.)
- [ ] Populate with realistic but synthetic data
- [ ] Prepare real CC0 content on Plex/Immich

### Phase 3: Migration
- [ ] Move existing tests to new structure
- [ ] Update import paths
- [ ] Fix broken tests

### Phase 4: New Coverage
- [ ] Add assembly tests for DDD layers
- [ ] Add flow tests for state machines
- [ ] Add contract tests for adapter interfaces
- [ ] Implement real-time simulators

### Phase 5: CI/CD Integration
- [ ] Configure test automation
- [ ] Add coverage tracking
- [ ] Set up failure notifications
