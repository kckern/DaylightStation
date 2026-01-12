# Phase 3f: External API Adapters Design

## Overview

This document describes the migration of 19+ external API adapters from `backend/_legacy/lib/` to the new clean architecture in `backend/src/2_adapters/`.

**Related Work:**
- Lifelog Domain (Phase 10) - Extractors that read harvested YAML
- Entropy Domain (Phase 10) - Data freshness monitoring
- Health Domain (Phase 9) - Consumes fitness/health data

## Problem Statement

External API adapters currently exist as flat files in `backend/_legacy/lib/`:
- `garmin.mjs`, `strava.mjs`, `lastfm.mjs`, `todoist.mjs`, etc.
- No consistent interface or structure
- Mixed concerns (fetching, transformation, storage, circuit breakers)
- Hard to test in isolation

## Architecture Decision: Hybrid Model

The system uses two data access patterns:

| Pattern | Purpose | Storage | Trigger |
|---------|---------|---------|---------|
| **Harvester** | Historical/batch data | `lifelog/*.yml` | Scheduled (cron) |
| **Current** | Live state/counts | `current/*.yml` | On-demand |

**Examples:**

| Harvester (Scheduled) | Current (On-Demand) |
|-----------------------|---------------------|
| Garmin activities | Gmail unread count |
| Last.fm scrobbles | Todoist open tasks |
| Strava workouts | Calendar today's events |
| GitHub commits | Weather current |
| Weight history | Home Assistant state |

**Data Flow:**

```
External APIs
      │
      ▼
┌─────────────────────────────────────────────────┐
│           ADAPTER LAYER (Phase 3f)              │
├────────────────────┬────────────────────────────┤
│  Harvester         │  Current                   │
│  Adapters          │  Adapters                  │
├────────────────────┼────────────────────────────┤
│  Writes to:        │  Writes to:                │
│  lifelog/*.yml     │  current/*.yml             │
└────────────────────┴────────────────────────────┘
      │                        │
      ▼                        ▼
┌─────────────────────────────────────────────────┐
│              CONSUMER DOMAINS                   │
├─────────────────────────────────────────────────┤
│  Lifelog: reads lifelog/*.yml via extractors   │
│  Entropy: reads both lifelog/ and current/     │
│  Health: reads lifelog/ (garmin, strava, etc.) │
│  Journalist: reads lifelog/ for day summaries  │
└─────────────────────────────────────────────────┘
```

## Adapter Structure

```
backend/src/2_adapters/
├── harvester/                      # Scheduled batch harvesters
│   ├── ports/
│   │   ├── IHarvester.mjs          # Common interface
│   │   └── ICircuitBreaker.mjs     # Resilience pattern
│   ├── fitness/
│   │   ├── GarminHarvester.mjs
│   │   ├── StravaHarvester.mjs
│   │   └── WithingsHarvester.mjs
│   ├── social/
│   │   ├── LastfmHarvester.mjs
│   │   ├── RedditHarvester.mjs
│   │   ├── LetterboxdHarvester.mjs
│   │   ├── GoodreadsHarvester.mjs
│   │   └── FoursquareHarvester.mjs
│   ├── productivity/
│   │   ├── GithubHarvester.mjs
│   │   ├── TodoistHarvester.mjs    # Completed tasks history
│   │   ├── ClickupHarvester.mjs    # Completed tasks history
│   │   ├── GmailHarvester.mjs      # Email history
│   │   └── CalendarHarvester.mjs   # Past events
│   ├── finance/
│   │   └── ShoppingHarvester.mjs
│   ├── CircuitBreaker.mjs          # Shared circuit breaker impl
│   └── index.mjs                   # Registry of all harvesters
│
├── current/                        # On-demand live data
│   ├── ports/
│   │   └── ICurrentDataSource.mjs
│   ├── GmailCurrentAdapter.mjs     # Unread count, inbox state
│   ├── TodoistCurrentAdapter.mjs   # Open tasks count
│   ├── ClickupCurrentAdapter.mjs   # Open tasks count
│   ├── CalendarCurrentAdapter.mjs  # Today's/upcoming events
│   ├── WeatherAdapter.mjs          # Current conditions
│   └── index.mjs
│
└── persistence/
    └── yaml/
        └── YamlLifelogStore.mjs    # Shared lifelog YAML I/O
```

## Port Interfaces

### IHarvester

```javascript
/**
 * Interface for scheduled batch data harvesters.
 * Harvesters fetch historical data from external APIs and persist to YAML.
 */
export class IHarvester {
  /**
   * Service identifier (e.g., 'garmin', 'lastfm')
   * @returns {string}
   */
  get serviceId() {
    throw new Error('IHarvester.serviceId must be implemented');
  }

  /**
   * Category for grouping (e.g., 'fitness', 'social', 'productivity')
   * @returns {string}
   */
  get category() {
    throw new Error('IHarvester.category must be implemented');
  }

  /**
   * Fetch data from external API and save to lifelog YAML.
   *
   * @param {string} username - Target user
   * @param {Object} [options] - Harvest options
   * @param {boolean} [options.full] - Full sync vs incremental
   * @param {boolean} [options.backfill] - Write directly to archives
   * @returns {Promise<{ count: number, status: string }>}
   */
  async harvest(username, options = {}) {
    throw new Error('IHarvester.harvest must be implemented');
  }

  /**
   * Get circuit breaker and harvest status.
   * @returns {{ isOpen: boolean, failures: number, lastSuccess: string|null }}
   */
  getStatus() {
    throw new Error('IHarvester.getStatus must be implemented');
  }
}
```

### ICurrentDataSource

```javascript
/**
 * Interface for on-demand live data sources.
 * Current adapters fetch real-time state (counts, active items).
 */
export class ICurrentDataSource {
  /**
   * Service identifier (e.g., 'gmail', 'todoist')
   * @returns {string}
   */
  get serviceId() {
    throw new Error('ICurrentDataSource.serviceId must be implemented');
  }

  /**
   * Fetch current state. May return cached data if recent.
   *
   * @param {string} username - Target user
   * @returns {Promise<{ data: any, lastUpdated: string }>}
   */
  async getCurrent(username) {
    throw new Error('ICurrentDataSource.getCurrent must be implemented');
  }

  /**
   * Force refresh, bypassing any cache.
   *
   * @param {string} username - Target user
   * @returns {Promise<{ data: any, lastUpdated: string }>}
   */
  async refresh(username) {
    throw new Error('ICurrentDataSource.refresh must be implemented');
  }
}
```

### CircuitBreaker

```javascript
/**
 * Circuit breaker for resilient external API calls.
 * Opens after consecutive failures, closes after cooldown.
 */
export class CircuitBreaker {
  #maxFailures;
  #cooldownMs;
  #failures = 0;
  #lastFailure = null;
  #state = 'closed'; // closed, open, half-open

  constructor({ maxFailures = 3, cooldownMs = 300000 }) {
    this.#maxFailures = maxFailures;
    this.#cooldownMs = cooldownMs;
  }

  isOpen() {
    if (this.#state === 'closed') return false;

    // Check if cooldown has passed
    const elapsed = Date.now() - this.#lastFailure;
    if (elapsed > this.#cooldownMs) {
      this.#state = 'half-open';
      return false;
    }
    return true;
  }

  recordSuccess() {
    this.#failures = 0;
    this.#state = 'closed';
  }

  recordFailure() {
    this.#failures++;
    this.#lastFailure = Date.now();
    if (this.#failures >= this.#maxFailures) {
      this.#state = 'open';
    }
  }

  getStatus() {
    return {
      state: this.#state,
      failures: this.#failures,
      lastFailure: this.#lastFailure,
    };
  }
}
```

## Adapter Implementation Example

### GarminHarvester

```javascript
import { IHarvester } from '../ports/IHarvester.mjs';
import { CircuitBreaker } from '../CircuitBreaker.mjs';

export class GarminHarvester extends IHarvester {
  #garminClient;
  #lifelogStore;
  #archiveService;
  #circuitBreaker;
  #logger;

  constructor({ garminClient, lifelogStore, archiveService, logger = console }) {
    super();
    this.#garminClient = garminClient;
    this.#lifelogStore = lifelogStore;
    this.#archiveService = archiveService;
    this.#circuitBreaker = new CircuitBreaker({ maxFailures: 3, cooldownMs: 300000 });
    this.#logger = logger;
  }

  get serviceId() { return 'garmin'; }
  get category() { return 'fitness'; }

  async harvest(username, options = {}) {
    if (this.#circuitBreaker.isOpen()) {
      this.#logger.warn?.('garmin.harvest.circuitOpen', { username });
      throw new Error('Circuit breaker open - too many recent failures');
    }

    try {
      this.#logger.info?.('garmin.harvest.start', { username, options });

      // 1. Fetch from Garmin API
      const activities = await this.#garminClient.getActivities(0, 200);

      // 2. Transform to simplified format
      const simplified = activities.map(a => this.#simplifyActivity(a));

      // 3. Aggregate by date
      const byDate = this.#aggregateByDate(simplified);

      // 4. Load existing data and merge
      const existing = await this.#lifelogStore.load(username, 'garmin') || {};
      const merged = { ...existing, ...byDate };

      // 5. Save to lifelog
      await this.#lifelogStore.save(username, 'garmin', merged);

      this.#circuitBreaker.recordSuccess();

      this.#logger.info?.('garmin.harvest.complete', {
        username,
        activityCount: activities.length,
        dateCount: Object.keys(byDate).length,
      });

      return { count: activities.length, status: 'success' };

    } catch (error) {
      this.#circuitBreaker.recordFailure();
      this.#logger.error?.('garmin.harvest.error', {
        username,
        error: error.message,
        circuitState: this.#circuitBreaker.getStatus(),
      });
      throw error;
    }
  }

  getStatus() {
    return this.#circuitBreaker.getStatus();
  }

  #simplifyActivity(activity) {
    return {
      activityId: activity.activityId,
      activityName: activity.activityName,
      date: activity.startTimeLocal?.split('T')[0],
      distance: activity.distance,
      duration: Math.round((activity.duration || 0) / 60), // minutes
      calories: activity.calories,
      averageHR: activity.averageHR || null,
      maxHR: activity.maxHR || null,
      hrZones: activity.hrZones || null,
    };
  }

  #aggregateByDate(activities) {
    const byDate = {};
    for (const activity of activities) {
      if (!activity.date) continue;
      if (!byDate[activity.date]) {
        byDate[activity.date] = [];
      }
      byDate[activity.date].push(activity);
    }
    return byDate;
  }
}
```

### TodoistCurrentAdapter

```javascript
import { ICurrentDataSource } from '../ports/ICurrentDataSource.mjs';

export class TodoistCurrentAdapter extends ICurrentDataSource {
  #todoistClient;
  #currentStore;
  #cacheTtlMs;
  #logger;

  constructor({ todoistClient, currentStore, cacheTtlMs = 60000, logger = console }) {
    super();
    this.#todoistClient = todoistClient;
    this.#currentStore = currentStore;
    this.#cacheTtlMs = cacheTtlMs;
    this.#logger = logger;
  }

  get serviceId() { return 'todoist'; }

  async getCurrent(username) {
    // Check cache
    const cached = await this.#currentStore.load(username, 'todoist');
    if (cached && this.#isFresh(cached.lastUpdated)) {
      return cached;
    }

    return this.refresh(username);
  }

  async refresh(username) {
    this.#logger.debug?.('todoist.current.refresh', { username });

    const tasks = await this.#todoistClient.getActiveTasks();

    const result = {
      lastUpdated: new Date().toISOString(),
      taskCount: tasks.length,
      tasks: tasks.map(t => ({
        id: t.id,
        content: t.content,
        priority: t.priority,
        due: t.due?.date || null,
        project: t.project_id,
      })),
    };

    await this.#currentStore.save(username, 'todoist', result);

    return result;
  }

  #isFresh(lastUpdated) {
    if (!lastUpdated) return false;
    const age = Date.now() - new Date(lastUpdated).getTime();
    return age < this.#cacheTtlMs;
  }
}
```

## Migration Plan

### Strategy: Strangler Fig (Incremental)

Migrate adapters one at a time, keeping legacy harvest router functional throughout.

### Migration Waves

| Wave | Category | Adapters | Priority |
|------|----------|----------|----------|
| **1** | Fitness | garmin, strava, withings | High - used by health/entropy |
| **2** | Productivity | todoist, clickup, github | High - used by entropy counts |
| **3** | Social | lastfm, letterboxd, reddit, foursquare, goodreads | Medium |
| **4** | Communication | gmail, gcal | Medium |
| **5** | Other | weather, shopping, scripture | Low |

### Per-Adapter Migration Steps

```
1. CREATE new adapter in src/2_adapters/harvester/{category}/
   - Implement IHarvester interface
   - Extract logic from legacy adapter
   - Add circuit breaker
   - Inject dependencies

2. CREATE unit tests
   - Mock external API client
   - Test transformation logic
   - Test circuit breaker behavior

3. CREATE golden master test
   - Capture current YAML output from legacy
   - Verify new adapter produces identical output

4. WIRE into harvest router
   - Import new adapter in legacy harvest.mjs
   - Replace harvester function call

5. TEST end-to-end
   - Run /harvest/{service} endpoint
   - Verify YAML output matches

6. DELETE legacy adapter
   - Remove _legacy/lib/{service}.mjs
   - Update any remaining imports
```

### Harvest Router Bridge Pattern

During migration, the legacy harvest router delegates to new adapters:

```javascript
// backend/_legacy/routers/harvest.mjs

// Migrated adapters (Wave 1)
import { GarminHarvester } from '../../src/2_adapters/harvester/fitness/GarminHarvester.mjs';
import { StravaHarvester } from '../../src/2_adapters/harvester/fitness/StravaHarvester.mjs';

// Not yet migrated (Waves 2-5)
import { lastfm } from '../lib/lastfm.mjs';
import { github } from '../lib/github.mjs';

// Instantiate migrated harvesters
const garminHarvester = new GarminHarvester({ /* deps */ });
const stravaHarvester = new StravaHarvester({ /* deps */ });

const harvesters = {
  // Migrated - use new adapters
  garmin: (logger, guidId, username) => garminHarvester.harvest(username),
  strava: (logger, guidId, username) => stravaHarvester.harvest(username),

  // Legacy - use old functions
  lastfm: (_logger, guidId, username) => lastfm(guidId, { targetUsername: username }),
  github: (_logger, guidId, username) => github(guidId, { targetUsername: username }),
  // ...
};
```

## Bootstrap Integration

```javascript
// backend/src/0_infrastructure/bootstrap.mjs

import { GarminHarvester } from '../2_adapters/harvester/fitness/GarminHarvester.mjs';
import { StravaHarvester } from '../2_adapters/harvester/fitness/StravaHarvester.mjs';
import { TodoistCurrentAdapter } from '../2_adapters/current/TodoistCurrentAdapter.mjs';

/**
 * Create harvester adapters
 */
export function createHarvesterAdapters(config) {
  const { lifelogStore, archiveService, clients, logger } = config;

  return {
    garmin: new GarminHarvester({
      garminClient: clients.garmin,
      lifelogStore,
      archiveService,
      logger: logger.child({ adapter: 'garmin' }),
    }),
    strava: new StravaHarvester({
      stravaClient: clients.strava,
      lifelogStore,
      archiveService,
      logger: logger.child({ adapter: 'strava' }),
    }),
    // ... more harvesters
  };
}

/**
 * Create current data adapters
 */
export function createCurrentAdapters(config) {
  const { currentStore, clients, logger } = config;

  return {
    todoist: new TodoistCurrentAdapter({
      todoistClient: clients.todoist,
      currentStore,
      logger: logger.child({ adapter: 'todoist' }),
    }),
    // ... more current adapters
  };
}
```

## Testing Strategy

### Unit Tests

Test each adapter in isolation with mocked clients:

```javascript
// tests/unit/adapters/harvester/fitness/GarminHarvester.test.mjs

describe('GarminHarvester', () => {
  it('transforms activities to simplified format', async () => {
    const mockClient = {
      getActivities: vi.fn().mockResolvedValue([
        { activityId: 1, activityName: 'Run', distance: 5000, duration: 1800000 }
      ])
    };
    const mockStore = { load: vi.fn(), save: vi.fn() };

    const harvester = new GarminHarvester({
      garminClient: mockClient,
      lifelogStore: mockStore,
    });

    await harvester.harvest('testuser');

    expect(mockStore.save).toHaveBeenCalledWith(
      'testuser',
      'garmin',
      expect.objectContaining({
        // date-keyed with simplified activities
      })
    );
  });

  it('opens circuit breaker after 3 failures', async () => {
    // ...
  });
});
```

### Golden Master Tests

Verify migration produces identical output:

```javascript
// tests/golden-master/garmin.golden.test.mjs

import legacyGarmin from '../../../backend/_legacy/lib/garmin.mjs';
import { GarminHarvester } from '../../../backend/src/2_adapters/harvester/fitness/GarminHarvester.mjs';

describe('Garmin Golden Master', () => {
  it('new adapter produces same output as legacy', async () => {
    // Setup: same mock data for both
    const mockActivities = loadFixture('garmin-activities.json');

    // Run legacy
    const legacyOutput = await runLegacyHarvest(mockActivities);

    // Run new
    const newOutput = await runNewHarvest(mockActivities);

    // Compare
    expect(newOutput).toEqual(legacyOutput);
  });
});
```

## Adapter Inventory

### Harvester Adapters (19)

| Service | Category | Storage Format | Archive-Enabled |
|---------|----------|----------------|-----------------|
| garmin | fitness | date-keyed | Yes |
| strava | fitness | date-keyed | Yes |
| withings | fitness | date-keyed | No |
| lastfm | social | array | Yes |
| letterboxd | social | array | Yes |
| reddit | social | date-keyed | No |
| foursquare | social | array | No |
| goodreads | social | array | No |
| github | productivity | date-keyed | No |
| todoist | productivity | date-keyed | No |
| clickup | productivity | date-keyed | No |
| gmail | productivity | date-keyed | No |
| gcal | productivity | date-keyed | No |
| shopping | finance | date-keyed | No |
| scripture | other | custom | No |
| ldsgc | other | custom | No |

### Current Adapters (6)

| Service | Data Returned |
|---------|---------------|
| gmail | unreadCount, messages[] |
| todoist | taskCount, tasks[] |
| clickup | taskCount, tasks[] |
| gcal | todayEvents[], upcomingCount |
| weather | temperature, conditions |
| homeassistant | entity states |

## Related Code

- Lifelog Domain: `backend/src/1_domains/lifelog/`
- Entropy Domain: `backend/src/1_domains/entropy/`
- Legacy Harvesters: `backend/_legacy/lib/*.mjs`
- Legacy Harvest Router: `backend/_legacy/routers/harvest.mjs`
- Archive Service: `backend/_legacy/lib/ArchiveService.mjs`

## Success Criteria

Phase 3f complete when:
- [ ] All 19 harvester adapters migrated to `src/2_adapters/harvester/`
- [ ] All 6 current adapters migrated to `src/2_adapters/current/`
- [ ] Legacy adapter files deleted from `_legacy/lib/`
- [ ] Harvest router using new adapters via bootstrap
- [ ] Golden master tests passing for all adapters
- [ ] Circuit breaker behavior preserved
- [ ] No changes to YAML output format (backward compatible)
