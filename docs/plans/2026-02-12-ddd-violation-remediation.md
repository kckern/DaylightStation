# DDD Violation Remediation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all DDD layer violations identified in the [2026-02-12 audit](../_wip/audits/2026-02-12-ddd-layer-audit.md), organized by risk level.

**Architecture:** Move misplaced code to correct DDD layers without changing behavior. Domain layer becomes pure (no I/O, no upward imports). Fat routers become thin by extracting business logic into application services. Entities gain encapsulation via private fields.

**Tech Stack:** Node.js ES modules (.mjs), Express routers, Jest (isolated/integrated tests), Playwright (live tests)

**Test commands:**
- Isolated: `npm run test:isolated`
- Integrated: `npm run test:integrated`
- All: `npm run test`
- Single file: `NODE_OPTIONS=--experimental-vm-modules npx jest <path> --no-cache`

**Audit doc:** `docs/_wip/audits/2026-02-12-ddd-layer-audit.md`

---

## Batch 1: Safe Wins (LOW risk)

These are cosmetic placement fixes — working code in the wrong layer. Logic stays identical.

---

### Task 1: Move `validateAdapter` into domain layer

ContentSourceRegistry (domain) imports `validateAdapter` from `3_applications`. The function should live in the domain.

**Files:**
- Read: `backend/src/3_applications/content/ports/IContentSource.mjs` (find `validateAdapter`)
- Create: `backend/src/2_domains/content/services/validateContentSource.mjs`
- Modify: `backend/src/2_domains/content/services/ContentSourceRegistry.mjs:2`

**Step 1: Read IContentSource.mjs to find validateAdapter**

Read the port file and copy the `validateAdapter` function.

**Step 2: Create domain validation file**

```javascript
// backend/src/2_domains/content/services/validateContentSource.mjs

/**
 * Validate that an object satisfies the content source adapter contract.
 * Moved from 3_applications/content/ports/IContentSource.mjs to keep
 * ContentSourceRegistry's imports within the domain layer.
 *
 * @param {Object} adapter - Adapter to validate
 * @throws {Error} If adapter doesn't satisfy the contract
 */
export function validateAdapter(adapter) {
  // Copy exact implementation from IContentSource.mjs — do NOT modify logic
}
```

**Step 3: Update ContentSourceRegistry import**

```javascript
// backend/src/2_domains/content/services/ContentSourceRegistry.mjs
// BEFORE (line 2):
import { validateAdapter } from '#apps/content/ports/IContentSource.mjs';

// AFTER:
import { validateAdapter } from './validateContentSource.mjs';
```

**Step 4: Run tests**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/domain/content --no-cache`
Expected: All pass (no behavior change)

**Step 5: Commit**

```bash
git add backend/src/2_domains/content/services/validateContentSource.mjs backend/src/2_domains/content/services/ContentSourceRegistry.mjs
git commit -m "refactor(content): move validateAdapter into domain layer

ContentSourceRegistry was importing from 3_applications (DDD violation).
Move the validation function into the domain where the registry lives.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Remove entropy backward-compat re-export

`2_domains/entropy/services/index.mjs` re-exports from `3_applications` — a domain-to-app import. The file itself documents this as intentional backward compat, but it violates the dependency rule.

**Files:**
- Modify: `backend/src/2_domains/entropy/services/index.mjs`
- Search: all consumers of `#domains/entropy/services`

**Step 1: Search for consumers**

```bash
grep -r '#domains/entropy/services' backend/src/
```

Expected: No production consumers (audit confirmed this). If consumers exist, update their imports to `#apps/entropy/services/EntropyService.mjs`.

**Step 2: Replace re-export with comment**

```javascript
// backend/src/2_domains/entropy/services/index.mjs

/**
 * Entropy Services
 * @module entropy/services
 *
 * EntropyService lives in the application layer (3_applications/entropy/services/)
 * because it uses infrastructure services (configService, logging).
 *
 * Import directly: import { EntropyService } from '#apps/entropy/services/EntropyService.mjs';
 */

// No exports — EntropyService is in the application layer
```

**Step 3: Run tests**

Run: `npm run test:isolated`
Expected: All pass

**Step 4: Commit**

```bash
git add backend/src/2_domains/entropy/services/index.mjs
git commit -m "refactor(entropy): remove domain-to-app re-export (DDD violation)

The entropy services barrel was re-exporting EntropyService from the
application layer into the domain layer. No production code imports
from this barrel, so safe to remove.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Inject TelegramAdapter into SystemBotLoader

SystemBotLoader directly imports TelegramAdapter. It should receive adapter factories via constructor.

**Files:**
- Modify: `backend/src/0_system/registries/SystemBotLoader.mjs:3` and `#createAdapter()` method
- Modify: `backend/src/0_system/bootstrap.mjs` (where SystemBotLoader is instantiated)

**Step 1: Change SystemBotLoader to accept adapter factories**

```javascript
// backend/src/0_system/registries/SystemBotLoader.mjs

// REMOVE this line:
import { TelegramAdapter } from '#adapters/messaging/TelegramAdapter.mjs';

// ADD constructor parameter:
constructor({ configService, logger, adapterFactories = {} }) {
  this.#configService = configService;
  this.#logger = logger;
  this.#bots = new Map();
  this.#adapterFactories = adapterFactories;
}

// UPDATE #createAdapter to use factory map:
#createAdapter(platform, appName, config, deps) {
  // ... existing token logic ...
  const factory = this.#adapterFactories[platform];
  if (!factory) {
    this.#logger?.warn('bots.unknown-platform', { platform, app: appName });
    return null;
  }
  return factory({ token, appName, ...deps });
}
```

**Step 2: Update bootstrap.mjs to pass factories**

```javascript
// In bootstrap.mjs where SystemBotLoader is created:
import { TelegramAdapter } from '#adapters/messaging/TelegramAdapter.mjs';

const botLoader = new SystemBotLoader({
  configService,
  logger,
  adapterFactories: {
    telegram: ({ token, appName, ...deps }) => new TelegramAdapter({ token, appName, ...deps })
  }
});
```

**Step 3: Run tests**

Run: `npm run test`
Expected: All pass

**Step 4: Commit**

```bash
git add backend/src/0_system/registries/SystemBotLoader.mjs backend/src/0_system/bootstrap.mjs
git commit -m "refactor(system): inject adapter factories into SystemBotLoader

SystemBotLoader was importing TelegramAdapter directly (DDD violation).
Now receives adapter factories via constructor, keeping 0_system free
of adapter imports. The composition root (bootstrap) provides factories.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Extract PlayResponseService from play.mjs

`toPlayResponse()` and `getWatchState()` contain business logic with zero req/res coupling. Extract to application service.

**Files:**
- Create: `backend/src/3_applications/content/services/PlayResponseService.mjs`
- Modify: `backend/src/4_api/v1/routers/play.mjs:34-101`
- Modify: `backend/src/0_system/bootstrap.mjs` (wire new service)

**Step 1: Write failing test**

```javascript
// tests/isolated/application/content/PlayResponseService.test.mjs
import { jest } from '@jest/globals';
import { PlayResponseService } from '#apps/content/services/PlayResponseService.mjs';

describe('PlayResponseService', () => {
  let service;
  let mockProgressMemory;
  let mockProgressSyncService;

  beforeEach(() => {
    mockProgressMemory = { get: jest.fn().mockResolvedValue(null) };
    mockProgressSyncService = { reconcileOnPlay: jest.fn().mockResolvedValue(null) };
    service = new PlayResponseService({
      mediaProgressMemory: mockProgressMemory,
      progressSyncService: mockProgressSyncService,
      progressSyncSources: new Set(['plex'])
    });
  });

  describe('toPlayResponse', () => {
    it('maps item fields to legacy response format', () => {
      const item = {
        id: 'plex:123',
        assetId: '123',
        title: 'Test',
        mediaUrl: '/video.mp4',
        mediaType: 'video',
        duration: 3600,
        thumbnail: '/thumb.jpg'
      };
      const result = service.toPlayResponse(item, null, { adapter: { source: 'plex' } });
      expect(result.id).toBe('plex:123');
      expect(result.title).toBe('Test');
      expect(result.mediaUrl).toBe('/video.mp4');
      expect(result.resumable).toBe(false);
    });

    it('sets resumable when watch state has valid playhead', () => {
      const item = { id: 'plex:123', duration: 3600 };
      const watchState = { playhead: 600, duration: 3600 };
      const result = service.toPlayResponse(item, watchState, { adapter: { source: 'plex' } });
      expect(result.resumable).toBe(true);
      expect(result.resumePosition).toBeGreaterThan(0);
    });
  });

  describe('getWatchState', () => {
    it('uses progressSyncService for sync sources', async () => {
      const item = { id: 'plex:123' };
      mockProgressSyncService.reconcileOnPlay.mockResolvedValue({ playhead: 100 });
      const result = await service.getWatchState(item, '/path', { source: 'plex' });
      expect(mockProgressSyncService.reconcileOnPlay).toHaveBeenCalled();
      expect(result).toEqual({ playhead: 100 });
    });

    it('falls back to mediaProgressMemory for non-sync sources', async () => {
      const item = { id: 'local:123' };
      mockProgressMemory.get.mockResolvedValue({ playhead: 50 });
      const result = await service.getWatchState(item, '/path', { source: 'local' });
      expect(mockProgressMemory.get).toHaveBeenCalled();
      expect(result).toEqual({ playhead: 50 });
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/application/content/PlayResponseService.test.mjs --no-cache`
Expected: FAIL — module not found

**Step 3: Create PlayResponseService**

Copy `toPlayResponse` and `getWatchState` from `play.mjs` lines 34-101 into a new service class. The functions are already pure (no req/res).

```javascript
// backend/src/3_applications/content/services/PlayResponseService.mjs
import { resolveFormat } from '#api/v1/utils/resolveFormat.mjs';
import { MediaProgress } from '#domains/content/entities/MediaProgress.mjs';

export class PlayResponseService {
  #mediaProgressMemory;
  #progressSyncService;
  #progressSyncSources;

  constructor({ mediaProgressMemory, progressSyncService, progressSyncSources }) {
    this.#mediaProgressMemory = mediaProgressMemory;
    this.#progressSyncService = progressSyncService;
    this.#progressSyncSources = progressSyncSources || new Set();
  }

  /**
   * Transform item + watch state into legacy-compatible play response
   * Extracted from play.mjs router to keep API layer thin.
   */
  toPlayResponse(item, watchState, { adapter }) {
    // Paste exact logic from play.mjs lines 35-89, replacing closured refs
    // with this.# fields. Do NOT modify any logic.
  }

  /**
   * Get watch state for an item, using sync service or local memory
   */
  async getWatchState(item, storagePath, adapter) {
    // Paste exact logic from play.mjs lines 95-101
    if (this.#progressSyncService && this.#progressSyncSources.has(adapter.source)) {
      return this.#progressSyncService.reconcileOnPlay(item, storagePath);
    }
    return this.#mediaProgressMemory.get(storagePath);
  }
}
```

**Note:** `resolveFormat` is imported from `#api/v1/utils/`. This is a presentation utility — consider moving it to `0_system/utils/` or `3_applications/content/` in a future cleanup. For now, the import is acceptable since `3_applications` can import from `4_api`... actually no, it can't. Check the import rule. `3_applications` CANNOT import from `4_api`. So `resolveFormat` must move first:
- Move `backend/src/4_api/v1/utils/resolveFormat.mjs` to `backend/src/3_applications/content/utils/resolveFormat.mjs`
- Update import in `play.mjs` to new location
- Import from new location in PlayResponseService

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/application/content/PlayResponseService.test.mjs --no-cache`
Expected: PASS

**Step 5: Update play.mjs to use service**

```javascript
// In play.mjs, replace inline functions with service calls:
// REMOVE: function toPlayResponse(...) { ... }
// REMOVE: function getWatchState(...) { ... }

// In createPlayRouter config, add:
const { ..., playResponseService } = config;

// In routes, replace:
//   toPlayResponse(item, watchState, { adapter })
// with:
//   playResponseService.toPlayResponse(item, watchState, { adapter })

// Replace:
//   getWatchState(item, storagePath, adapter)
// with:
//   playResponseService.getWatchState(item, storagePath, adapter)
```

**Step 6: Wire in bootstrap.mjs**

```javascript
// In bootstrap.mjs, create PlayResponseService and pass to play router
import { PlayResponseService } from '#apps/content/services/PlayResponseService.mjs';

const playResponseService = new PlayResponseService({
  mediaProgressMemory,
  progressSyncService,
  progressSyncSources
});

// Pass to createPlayRouter config:
createPlayRouter({ ..., playResponseService })
```

**Step 7: Run all tests**

Run: `npm run test`
Then: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/api/routers/play --no-cache`
Expected: All pass

**Step 8: Commit**

```bash
git add backend/src/3_applications/content/services/PlayResponseService.mjs \
       backend/src/4_api/v1/routers/play.mjs \
       backend/src/0_system/bootstrap.mjs \
       tests/isolated/application/content/PlayResponseService.test.mjs
git commit -m "refactor(play): extract PlayResponseService from fat router

Move toPlayResponse() and getWatchState() business logic out of the
API router into an application service. Router becomes a thin HTTP
layer. Also moves resolveFormat utility out of 4_api.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Extract gratitude helpers from router

Pure utility functions (timezone, validation, display names) that don't touch req/res.

**Files:**
- Create: `backend/src/3_applications/gratitude/services/GratitudeHouseholdService.mjs`
- Modify: `backend/src/4_api/v1/routers/gratitude.mjs:55-109`
- Modify: `backend/src/0_system/bootstrap.mjs`

**Step 1: Write failing test**

```javascript
// tests/isolated/application/gratitude/GratitudeHouseholdService.test.mjs
import { jest } from '@jest/globals';
import { GratitudeHouseholdService } from '#apps/gratitude/services/GratitudeHouseholdService.mjs';

describe('GratitudeHouseholdService', () => {
  let service;
  let mockConfigService;
  let mockGratitudeService;

  beforeEach(() => {
    mockConfigService = {
      getDefaultHouseholdId: jest.fn().mockReturnValue('default'),
      getHouseholdTimezone: jest.fn().mockReturnValue('America/Los_Angeles'),
      getUserProfile: jest.fn().mockReturnValue({ display_name: 'Test User' }),
      getHouseholdUsers: jest.fn().mockReturnValue(['user1'])
    };
    mockGratitudeService = {
      isValidCategory: jest.fn().mockReturnValue(true)
    };
    service = new GratitudeHouseholdService({ configService: mockConfigService, gratitudeService: mockGratitudeService });
  });

  it('resolves household ID with fallback', () => {
    expect(service.resolveHouseholdId('custom')).toBe('custom');
    expect(service.resolveHouseholdId(undefined)).toBe('default');
  });

  it('validates category', () => {
    expect(service.validateCategory('THANKS')).toBe('thanks');
    mockGratitudeService.isValidCategory.mockReturnValue(false);
    expect(() => service.validateCategory('invalid')).toThrow();
  });

  it('resolves display name with fallback chain', () => {
    mockConfigService.getUserProfile.mockReturnValue({ group_label: 'Family' });
    expect(service.resolveDisplayName('user1')).toBe('Family');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/application/gratitude/GratitudeHouseholdService.test.mjs --no-cache`
Expected: FAIL

**Step 3: Create GratitudeHouseholdService**

```javascript
// backend/src/3_applications/gratitude/services/GratitudeHouseholdService.mjs
import { ValidationError } from '#system/utils/errors/index.mjs';

export class GratitudeHouseholdService {
  #configService;
  #gratitudeService;

  constructor({ configService, gratitudeService }) {
    this.#configService = configService;
    this.#gratitudeService = gratitudeService;
  }

  resolveHouseholdId(explicit) {
    return explicit || this.#configService.getDefaultHouseholdId();
  }

  getTimezone(householdId) {
    return this.#configService.getHouseholdTimezone(householdId) || 'UTC';
  }

  generateTimestamp(householdId) {
    // Paste exact logic from gratitude.mjs lines 67-73
  }

  validateCategory(category) {
    // Paste exact logic from gratitude.mjs lines 78-81
  }

  resolveDisplayName(userId) {
    // Paste exact logic from gratitude.mjs lines 86-93
  }

  getHouseholdUsers(householdId) {
    // Paste exact logic from gratitude.mjs lines 98-109
  }
}
```

**Step 4: Run test, verify passes**

**Step 5: Update gratitude.mjs to use service**

Replace inline helpers with injected `gratitudeHouseholdService` calls. Keep only `getHouseholdId(req)` in the router (it reads `req.query`).

**Step 6: Wire in bootstrap.mjs, run all tests, commit**

```bash
git commit -m "refactor(gratitude): extract household helpers into application service

Move timezone, validation, display name, and user list logic out of
the gratitude router into GratitudeHouseholdService. Router keeps only
HTTP-specific getHouseholdId(req).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Batch 2: Contained Moves (MODERATE risk)

These involve splitting services or adding encapsulation. Blast radius is contained but requires careful testing.

---

### Task 6: Split HealthAggregationService

**Current:** Domain service that does I/O via `#healthStore`.
**Target:** Pure domain aggregator + application orchestrator.

**Files:**
- Modify: `backend/src/2_domains/health/services/HealthAggregationService.mjs` (keep pure methods only)
- Create: `backend/src/3_applications/health/AggregateHealthUseCase.mjs`
- Modify: `backend/src/2_domains/health/index.mjs` (update barrel)
- Modify: `backend/src/0_system/bootstrap.mjs` (update wiring)
- Modify: `backend/src/4_api/v1/routers/health.mjs` (use new service)

**Importers to update (4):** bootstrap.mjs, health/index.mjs, health router, health domain barrel.

**Step 1: Write test for pure domain aggregator**

```javascript
// tests/isolated/domain/health/services/HealthAggregator.test.mjs
import { HealthAggregator } from '#domains/health/services/HealthAggregationService.mjs';

describe('HealthAggregator', () => {
  it('aggregates day metrics from multiple sources', () => {
    const result = HealthAggregator.aggregateDayMetrics('2026-01-15', {
      weight: { lbs: 180, fat_percent: 20, lean_lbs: 144, water_weight: null, lbs_adjusted_average_7day_trend: 179 },
      strava: [{ title: 'Run', type: 'Run', minutes: 30, calories: 300, avgHeartrate: 150, maxHeartrate: 175 }],
      fitness: { activities: [], steps: { steps_count: 8000, bmr: 1800, duration: 60 } },
      nutrition: { calories: 2000, protein: 150, carbs: 200, fat: 80, food_items: [1,2,3] },
      coaching: null
    });
    expect(result.date).toBe('2026-01-15');
    expect(result.weight.lbs).toBe(180);
    expect(result.workouts).toHaveLength(1);
    expect(result.nutrition.calories).toBe(2000);
  });

  it('merges workouts from Strava and FitnessSyncer', () => {
    const result = HealthAggregator.mergeWorkouts(
      [{ title: 'Run', type: 'Run', minutes: 30, calories: 300 }],
      [{ title: 'Run', minutes: 31, calories: 280 }]
    );
    // Duration within 5-min tolerance → merged
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('strava+fitness');
  });

  it('generates date range from reference date', () => {
    const dates = HealthAggregator.generateDateRange(3, new Date('2026-01-15'));
    expect(dates).toEqual(['2026-01-15', '2026-01-14', '2026-01-13']);
  });
});
```

**Step 2: Refactor HealthAggregationService into static pure methods**

Keep `#aggregateDayMetrics`, `#mergeWorkouts`, `#generateDateRange`, `#mergeHealthData` as **static** public methods (pure, no `this`, no I/O). Remove constructor, remove `#healthStore`, remove `aggregateDailyHealth`, `getHealthForDate`, `getHealthForRange` (those move to the use case).

**Step 3: Create AggregateHealthUseCase**

```javascript
// backend/src/3_applications/health/AggregateHealthUseCase.mjs
import { HealthAggregator } from '#domains/health/services/HealthAggregationService.mjs';

export class AggregateHealthUseCase {
  #healthStore;

  constructor({ healthStore }) {
    this.#healthStore = healthStore;
  }

  async execute(userId, daysBack = 15, today) {
    // Load all data sources (I/O)
    const [weightData, activityData, fitnessData, nutritionData, existingHealth, coachingData] =
      await Promise.all([
        this.#healthStore.loadWeightData(userId),
        this.#healthStore.loadActivityData(userId),
        this.#healthStore.loadFitnessData(userId),
        this.#healthStore.loadNutritionData(userId),
        this.#healthStore.loadHealthData(userId),
        this.#healthStore.loadCoachingData(userId)
      ]);

    // Delegate to pure domain logic
    const dates = HealthAggregator.generateDateRange(daysBack, today);
    const metrics = {};
    for (const date of dates) {
      metrics[date] = HealthAggregator.aggregateDayMetrics(date, {
        weight: weightData[date],
        strava: activityData[date] || [],
        fitness: fitnessData[date],
        nutrition: nutritionData[date],
        coaching: coachingData[date]
      });
    }

    const mergedHealth = HealthAggregator.mergeHealthData(existingHealth, metrics);
    await this.#healthStore.saveHealthData(userId, mergedHealth);
    return metrics;
  }

  async getHealthForDate(userId, date) {
    // Move from old service — I/O method
  }

  async getHealthForRange(userId, startDate, endDate) {
    // Move from old service — I/O method
  }
}
```

**Step 4: Update barrel, bootstrap, router imports**

**Step 5: Run all tests, commit**

```bash
git commit -m "refactor(health): split HealthAggregationService into pure domain + use case

Pure aggregation logic (workout merging, metric building, date ranges)
stays in domain as static methods. I/O orchestration moves to
AggregateHealthUseCase in application layer.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 7: Session entity encapsulation

**Blast radius:** 2 files, 15 mutations.

**Files:**
- Modify: `backend/src/2_domains/fitness/entities/Session.mjs`
- Modify: `backend/src/2_domains/fitness/services/SessionService.mjs` (5 mutations)
- Modify: `tests/isolated/domain/fitness/entities/Session.test.mjs` (10 mutations)

**Step 1: Add domain methods for the 5 SessionService mutations**

Session needs these new methods to replace external property writes:

```javascript
// Add to Session.mjs:

/** Replace timeline (for encoding/decoding) */
replaceTimeline(timeline) {
  this.timeline = timeline;
}

/** Replace snapshots (for merging from existing) */
replaceSnapshots(snapshots) {
  this.snapshots = snapshots;
}

/** Remove snapshot by filename (dedup before add) */
removeDuplicateSnapshot(filename) {
  if (this.snapshots?.captures) {
    this.snapshots.captures = this.snapshots.captures.filter(
      entry => entry?.filename !== filename
    );
  }
}
```

**Step 2: Update SessionService to use new methods**

```javascript
// SessionService.mjs line 185 (getSession):
// BEFORE: session.timeline = prepareTimelineForApi(session.timeline, tz);
// AFTER:
session.replaceTimeline(prepareTimelineForApi(session.timeline, tz));

// Line 255 (saveSession):
// BEFORE: session.timeline = prepareTimelineForStorage(session.timeline);
// AFTER:
session.replaceTimeline(prepareTimelineForStorage(session.timeline));

// Lines 259-261 (saveSession):
// BEFORE: session.snapshots = existing.snapshots;
// AFTER:
session.replaceSnapshots(existing.snapshots);

// Line 286 (endSession):
// BEFORE: session.timeline = prepareTimelineForStorage(session.timeline);
// AFTER:
session.replaceTimeline(prepareTimelineForStorage(session.timeline));

// Lines 336-339 (addSnapshot):
// BEFORE: session.snapshots.captures = session.snapshots.captures.filter(...)
// AFTER:
session.removeDuplicateSnapshot(capture.filename);
```

**Step 3: Update Session.test.mjs**

Replace direct property writes with constructor params or new methods. Example:

```javascript
// BEFORE (line 39): session.durationMs = 300000;
// AFTER: const session = new Session({ sessionId: '20260115093000', startTime: t, durationMs: 300000 });

// BEFORE (line 67): session.endTime = ...;
// AFTER: session.end(endTimeMs);
```

**Step 4: Run tests**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/isolated/domain/fitness --no-cache`
Expected: All 43 + 67 tests pass

**Step 5: (Future) Convert to private fields**

Once all external mutations go through methods, convert `this.timeline` to `#timeline` with getter. This is a separate commit to isolate risk.

**Step 6: Commit**

```bash
git commit -m "refactor(fitness): add Session domain methods for state changes

Add replaceTimeline(), replaceSnapshots(), removeDuplicateSnapshot()
to Session entity. Update SessionService and tests to use domain
methods instead of direct property mutation. Prepares for private
field encapsulation.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 8: Move LifelogAggregator to application layer

**Current:** Domain service with I/O (`#userLoadFile` callback).
**Target:** Application service. Pure extractors stay in domain.

**Importers (5-8):** bootstrap.mjs, lifelog/index.mjs, journalist/index.mjs, JournalistContainer.mjs, lifelog router, tests.

**Files:**
- Move: `backend/src/2_domains/lifelog/services/LifelogAggregator.mjs` → `backend/src/3_applications/lifelog/LifelogAggregator.mjs`
- Modify: `backend/src/2_domains/lifelog/index.mjs` (remove export)
- Modify: `backend/src/2_domains/journalist/index.mjs` (if re-exports)
- Modify: `backend/src/3_applications/journalist/JournalistContainer.mjs:39`
- Modify: `backend/src/0_system/bootstrap.mjs`
- Modify: `tests/isolated/domain/lifelog/services/__tests__/LifelogAggregator.test.mjs` (update import)
- Modify: `tests/integrated/api/lifelog/lifelog.test.mjs` (update import)

**Step 1: Move file**

```bash
mkdir -p backend/src/3_applications/lifelog
mv backend/src/2_domains/lifelog/services/LifelogAggregator.mjs \
   backend/src/3_applications/lifelog/LifelogAggregator.mjs
```

**Step 2: Update import in the moved file**

```javascript
// backend/src/3_applications/lifelog/LifelogAggregator.mjs
// BEFORE:
import { extractors } from '../extractors/index.mjs';
// AFTER:
import { extractors } from '#domains/lifelog/extractors/index.mjs';
```

**Step 3: Update all importers**

Replace `#domains/lifelog/services/LifelogAggregator.mjs` (or barrel) with `#apps/lifelog/LifelogAggregator.mjs` in every file that imports it.

Update `lifelog/index.mjs` barrel:
```javascript
// REMOVE: export { LifelogAggregator } from './services/LifelogAggregator.mjs';
// Extractors and entities stay
```

**Step 4: Run all tests**

Run: `npm run test`
Expected: All pass

**Step 5: Commit**

```bash
git commit -m "refactor(lifelog): move LifelogAggregator to application layer

LifelogAggregator orchestrates I/O (file loading) so it belongs in
3_applications, not 2_domains. Pure extractors stay in the domain.
Also fixes DDD violation where JournalistContainer imported from
2_domains directly.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 9: Split SchedulerService

**Current:** Domain service with `path`, `url`, `crypto` imports and dynamic module loading.
**Target:** Pure scheduling logic in domain + orchestrator in application.

**Importers (3):** app.mjs, scheduling/index.mjs, scheduling.test.mjs

**Pure methods (stay in domain):**
- `computeNextRun(job, fromDate)` — cron parsing
- `checkDependencies(job, allStates)` — state checking
- `md5(str)`, `windowOffset(str)`, `generateExecutionId()` — utilities
- `formatDate(date)`, `parseDate(dateStr)` — formatting

**I/O methods (move to application):**
- `loadJobsWithState()`, `initializeStates()`, `getJobsDueToRun()` — store reads
- `executeJob()`, `runJob()`, `runDueJobs()`, `triggerJob()` — orchestration + execution
- `getStatus()` — reporting
- `resolveModulePath()` — file system (move to adapter or remove)

**Step 1: Write tests for pure scheduling logic**

Test `computeNextRun`, `checkDependencies`, `windowOffset` in isolation.

**Step 2: Extract pure methods into domain SchedulingService**

Keep only the pure methods. Remove `jobStore`, `stateStore`, `moduleBasePath`, `harvesterExecutor`, `mediaExecutor` from constructor.

**Step 3: Create SchedulerOrchestrator in 3_applications**

Move all I/O orchestration. Inject the domain scheduling service + stores + executors.

**Step 4: Update app.mjs and test imports**

**Step 5: Run tests, commit**

```bash
git commit -m "refactor(scheduling): split SchedulerService into pure domain + orchestrator

Pure scheduling logic (cron computation, dependency checks, window
offsets) stays in domain. I/O orchestration (store reads, job
execution, state persistence) moves to SchedulerOrchestrator in
application layer. Removes path/url/crypto from domain.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Batch 3: Needs Prep (MODERATE-HIGH risk)

---

### Task 10: Extract fitness.mjs config and classifier logic

**Prerequisite:** Untangle classifier instantiation from response building.

**Target extractions:**
1. `loadFitnessConfig()` → extend existing `FitnessConfigService`
2. Playlist thumbnail enrichment → new method on `FitnessConfigService`
3. Progress classifier setup + watch state mapping → new `FitnessPlayableEnricher` service

**Files:**
- Modify: `backend/src/3_applications/fitness/FitnessConfigService.mjs` (add methods)
- Create: `backend/src/3_applications/fitness/services/FitnessPlayableEnricher.mjs`
- Modify: `backend/src/4_api/v1/routers/fitness.mjs`
- Modify: `backend/src/0_system/bootstrap.mjs`

**Step 1:** Write test for `FitnessPlayableEnricher` covering classifier + watch state mapping.

**Step 2:** Implement enricher — receives items array, returns enriched items with `isWatched`, `watchProgress`, `watchSeconds`. Internally creates classifier from config.

**Step 3:** Move `loadFitnessConfig` and playlist enrichment into `FitnessConfigService.getHydratedConfig()`.

**Step 4:** Slim down fitness.mjs router — should only extract params, call services, return JSON.

**Step 5:** Run fitness tests (43 + 67 isolated, 110+ Playwright), commit.

---

### Task 11: Route admin/media.mjs through application service

**Files:**
- Create: `backend/src/3_applications/media/services/MetadataFetchService.mjs`
- Modify: `backend/src/4_api/v1/routers/admin/media.mjs:13,30`
- Modify: `backend/src/0_system/bootstrap.mjs`

**Step 1:** Create thin service wrapper:

```javascript
// backend/src/3_applications/media/services/MetadataFetchService.mjs
export class MetadataFetchService {
  #ytDlpAdapter;
  #logger;

  constructor({ ytDlpAdapter, logger }) {
    this.#ytDlpAdapter = ytDlpAdapter;
    this.#logger = logger;
  }

  async fetchChannelMetadata(channelId) {
    return this.#ytDlpAdapter.getChannelMetadata(channelId);
  }
}
```

**Step 2:** Remove direct `YtDlpAdapter` import from media.mjs. Inject `MetadataFetchService` via config.

**Step 3:** Wire in bootstrap, run tests, commit.

---

## Batch 4: Write Tests First (HIGH risk)

These are load-bearing pillars. Tests MUST exist before extraction.

---

### Task 12: Write tests for admin/content.mjs section operations

**PREREQUISITE for Task 13.** The router is the ONLY write path for lists. Section operations (split, reorder, move, update, delete) have NO test coverage.

**Files:**
- Create: `tests/integrated/api/admin/content-sections.test.mjs`

**Tests to write (minimum):**
1. POST /sections — add empty section to list
2. POST /sections/split — split section at item index, verify items redistribute
3. PUT /sections/reorder — reorder sections, verify new order persists
4. PUT /sections/:index — update section settings (title, shuffle, limit)
5. DELETE /sections/:index — delete section, verify fallback to empty section
6. PUT /items/move — move item between sections, verify source loses and target gains item
7. **Round-trip test:** Create list → add items → split section → move item → reorder → verify final state matches expectations
8. **Normalizer preservation:** After save+reload, verify `normalizeListConfig` produces identical structure

**Key risk:** Tests must use real YAML I/O (or carefully mocked FileIO) to catch serialization bugs.

**After tests pass → proceed to Task 13.**

---

### Task 13: Extract ListManagementService from admin/content.mjs

**PREREQUISITE:** Task 12 tests must pass.

**Files:**
- Create: `backend/src/3_applications/content/services/ListManagementService.mjs`
- Create: `backend/src/3_applications/content/ports/IListStore.mjs` (port interface)
- Create: `backend/src/1_adapters/persistence/yaml/YamlListDatastore.mjs` (adapter)
- Modify: `backend/src/4_api/v1/routers/admin/content.mjs` (thin down to HTTP layer)
- Modify: `backend/src/0_system/bootstrap.mjs`

**Architecture:**

```
admin/content.mjs (thin HTTP)
  → ListManagementService (orchestration)
    → IListStore port (abstract)
      → YamlListDatastore (concrete YAML I/O)
    → listConfigNormalizer (stays in adapter, called by datastore)
```

**Step 1: Create IListStore port**

```javascript
// backend/src/3_applications/content/ports/IListStore.mjs
export class IListStore {
  async getOverview(householdId) { throw new Error('not implemented'); }
  async listByType(type, householdId) { throw new Error('not implemented'); }
  async getList(type, name, householdId) { throw new Error('not implemented'); }
  async saveList(type, name, householdId, listConfig) { throw new Error('not implemented'); }
  async createList(type, name, householdId) { throw new Error('not implemented'); }
  async deleteList(type, name, householdId) { throw new Error('not implemented'); }
}
```

**Step 2: Create YamlListDatastore** — move all `loadYamlSafe`/`saveYaml`/`listYamlFiles`/`ensureDir`/`deleteYaml` calls here. Keep `normalizeListConfig`/`serializeListConfig` calls here (adapter handles serialization).

**Step 3: Create ListManagementService** — move all business logic (validation, field allowlists, denormalization). Receives `IListStore` via constructor.

**Step 4: Thin down admin/content.mjs** — each route becomes: extract params → call service → return JSON.

**Step 5: Run Task 12 section tests + existing Playwright tests**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/integrated/api/admin/content-sections.test.mjs --no-cache`
Run: `npx playwright test tests/live/flow/admin/ --reporter=line`
Expected: All pass

**Step 6: Commit**

```bash
git commit -m "refactor(admin): extract ListManagementService from fat content router

Move all list CRUD logic into ListManagementService with YamlListDatastore
behind IListStore port. Router becomes thin HTTP layer. Section operations,
item management, and settings updates all go through the service.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 14: Extract fitness screenshot handling

**PREREQUISITE:** Refactor interleaved I/O first.

**Files:**
- Create: `backend/src/3_applications/fitness/services/ScreenshotService.mjs`
- Modify: `backend/src/4_api/v1/routers/fitness.mjs:498-568`
- Modify: `backend/src/0_system/bootstrap.mjs`

**Step 1: Write test for ScreenshotService**

```javascript
// tests/isolated/application/fitness/ScreenshotService.test.mjs
describe('ScreenshotService', () => {
  it('decodes base64 and builds capture info', async () => {
    const service = new ScreenshotService({ sessionService: mockSessionService, fileIO: mockFileIO });
    const result = await service.saveScreenshot({
      sessionId: '20260115093000',
      imageBase64: 'iVBORw0KGgo=', // tiny valid base64
      mimeType: 'image/png',
      index: 1,
      household: 'default'
    });
    expect(result.filename).toMatch(/\.png$/);
    expect(mockFileIO.writeBinary).toHaveBeenCalled();
    expect(mockSessionService.addSnapshot).toHaveBeenCalled();
  });
});
```

**Step 2: Implement ScreenshotService** — encapsulates base64 decode, MIME normalization, filename construction, directory creation, file write, session update.

**Step 3: Slim down fitness.mjs** — `save_screenshot` route becomes: extract body fields → call `screenshotService.saveScreenshot(fields)` → return result.

**Step 4: Run fitness tests, commit.**

---

## Checklist

After all tasks:

- [ ] Run full test suite: `npm run test && npm run test:live`
- [ ] Update audit doc: check off remediation items in `docs/_wip/audits/2026-02-12-ddd-layer-audit.md`
- [ ] Verify no new DDD violations introduced: `grep -r '#api/' backend/src/3_applications/` should return nothing
- [ ] Verify domain purity: `grep -r '#apps\|#adapters\|#api' backend/src/2_domains/` should return only `core/utils/id.mjs` (accepted) and the `0_system/utils` imports
