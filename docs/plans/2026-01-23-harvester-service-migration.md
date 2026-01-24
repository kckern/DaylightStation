# Harvester Service Migration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a `HarvesterService` application that owns all harvest logic, callable from both API routes and scheduled jobs (DRY).

**Architecture:**
- `HarvesterService` in `3_applications/harvester/` orchestrates all harvester adapters from `2_adapters/harvester/`
- API routes (`4_api/routers/harvest.mjs`) call HarvesterService
- Scheduler (`1_domains/scheduling/`) calls HarvesterService via a registered executor
- Single source of truth for harvest logic, two entry points

**Tech Stack:** Express.js, YAML persistence, IHarvester interface, CircuitBreaker

---

## Task 1: Create HarvesterService Application

**Files:**
- Create: `backend/src/3_applications/harvester/HarvesterService.mjs`
- Create: `backend/src/3_applications/harvester/index.mjs`

**Step 1: Create HarvesterService**

```javascript
// backend/src/3_applications/harvester/HarvesterService.mjs
/**
 * HarvesterService - Orchestrates all data harvesting
 *
 * Single entry point for both API routes and scheduler.
 * Manages harvester registration, execution, and status.
 */

export class HarvesterService {
  #harvesters = new Map();
  #configService;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.configService - ConfigService for user resolution
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({ configService, logger = console }) {
    this.#configService = configService;
    this.#logger = logger;
  }

  /**
   * Register a harvester adapter
   * @param {IHarvester} harvester - Harvester implementing IHarvester interface
   */
  register(harvester) {
    if (!harvester.serviceId) {
      throw new Error('Harvester must have a serviceId');
    }
    this.#harvesters.set(harvester.serviceId, harvester);
    this.#logger.debug?.('harvester.registered', { serviceId: harvester.serviceId });
  }

  /**
   * Register multiple harvesters
   * @param {IHarvester[]} harvesters
   */
  registerAll(harvesters) {
    for (const harvester of harvesters) {
      this.register(harvester);
    }
  }

  /**
   * Execute harvest for a specific service
   * @param {string} serviceId - Service identifier (e.g., 'todoist', 'lastfm')
   * @param {string} [username] - Target username (defaults to head of household)
   * @param {Object} [options] - Harvest options
   * @returns {Promise<HarvestResult>}
   */
  async harvest(serviceId, username, options = {}) {
    const harvester = this.#harvesters.get(serviceId);
    if (!harvester) {
      throw new Error(`Unknown harvester: ${serviceId}`);
    }

    const targetUser = username || this.#configService?.getHeadOfHousehold?.() || 'default';

    this.#logger.info?.('harvester.harvest.start', { serviceId, username: targetUser });

    try {
      const result = await harvester.harvest(targetUser, options);
      this.#logger.info?.('harvester.harvest.complete', { serviceId, result });
      return result;
    } catch (error) {
      this.#logger.error?.('harvester.harvest.error', { serviceId, error: error.message });
      throw error;
    }
  }

  /**
   * Get status of a specific harvester
   * @param {string} serviceId
   * @returns {HarvesterStatus}
   */
  getStatus(serviceId) {
    const harvester = this.#harvesters.get(serviceId);
    if (!harvester) {
      return { error: `Unknown harvester: ${serviceId}` };
    }
    return {
      serviceId,
      category: harvester.category,
      ...harvester.getStatus()
    };
  }

  /**
   * Get status of all harvesters
   * @returns {Object<string, HarvesterStatus>}
   */
  getAllStatuses() {
    const statuses = {};
    for (const [serviceId, harvester] of this.#harvesters) {
      statuses[serviceId] = {
        category: harvester.category,
        ...harvester.getStatus()
      };
    }
    return statuses;
  }

  /**
   * List all registered harvesters
   * @returns {Array<{serviceId: string, category: string}>}
   */
  listHarvesters() {
    return Array.from(this.#harvesters.values()).map(h => ({
      serviceId: h.serviceId,
      category: h.category
    }));
  }

  /**
   * Check if a harvester is registered
   * @param {string} serviceId
   * @returns {boolean}
   */
  has(serviceId) {
    return this.#harvesters.has(serviceId);
  }

  /**
   * Get harvester by serviceId
   * @param {string} serviceId
   * @returns {IHarvester|undefined}
   */
  get(serviceId) {
    return this.#harvesters.get(serviceId);
  }
}

export default HarvesterService;
```

**Step 2: Create index.mjs**

```javascript
// backend/src/3_applications/harvester/index.mjs
export { HarvesterService } from './HarvesterService.mjs';
```

**Step 3: Commit**

```bash
git add backend/src/3_applications/harvester/
git commit -m "$(cat <<'EOF'
feat(harvester): add HarvesterService application layer

Creates central orchestration service for all data harvesting.
Single entry point for both API routes and scheduled jobs.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Create HarvesterJobExecutor for Scheduler Integration

**Files:**
- Create: `backend/src/3_applications/harvester/HarvesterJobExecutor.mjs`
- Modify: `backend/src/3_applications/harvester/index.mjs`

**Step 1: Create HarvesterJobExecutor**

```javascript
// backend/src/3_applications/harvester/HarvesterJobExecutor.mjs
/**
 * HarvesterJobExecutor - Scheduler integration for harvester jobs
 *
 * Provides a job executor that the scheduler can use instead of
 * dynamic module imports for harvest-type jobs.
 */

export class HarvesterJobExecutor {
  #harvesterService;
  #configService;
  #logger;

  /**
   * @param {Object} config
   * @param {HarvesterService} config.harvesterService
   * @param {Object} config.configService
   * @param {Object} [config.logger]
   */
  constructor({ harvesterService, configService, logger = console }) {
    this.#harvesterService = harvesterService;
    this.#configService = configService;
    this.#logger = logger;
  }

  /**
   * Execute a harvest job
   * Called by scheduler instead of dynamic module import
   *
   * @param {string} serviceId - Service to harvest
   * @param {Object} [options] - Job options from jobs.yml
   * @param {Object} context - Execution context from scheduler
   * @param {Object} context.logger - Scoped logger
   * @param {string} context.executionId - Execution ID
   * @returns {Promise<void>}
   */
  async execute(serviceId, options = {}, context = {}) {
    const { logger = this.#logger, executionId } = context;

    logger.info?.('harvester.job.start', { serviceId, executionId });

    const username = options.username || this.#configService?.getHeadOfHousehold?.();

    try {
      const result = await this.#harvesterService.harvest(serviceId, username, options);

      logger.info?.('harvester.job.complete', {
        serviceId,
        executionId,
        result
      });

      return result;
    } catch (error) {
      logger.error?.('harvester.job.error', {
        serviceId,
        executionId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Create a job handler function for a specific service
   * Returns a function compatible with scheduler's dynamic import pattern
   *
   * @param {string} serviceId
   * @returns {Function}
   */
  createHandler(serviceId) {
    return async (logger, executionId) => {
      return this.execute(serviceId, {}, { logger, executionId });
    };
  }

  /**
   * Check if executor can handle a service
   * @param {string} serviceId
   * @returns {boolean}
   */
  canHandle(serviceId) {
    return this.#harvesterService.has(serviceId);
  }
}

export default HarvesterJobExecutor;
```

**Step 2: Update index.mjs**

```javascript
// backend/src/3_applications/harvester/index.mjs
export { HarvesterService } from './HarvesterService.mjs';
export { HarvesterJobExecutor } from './HarvesterJobExecutor.mjs';
```

**Step 3: Commit**

```bash
git add backend/src/3_applications/harvester/
git commit -m "$(cat <<'EOF'
feat(harvester): add HarvesterJobExecutor for scheduler integration

Provides scheduler-compatible job executor that calls HarvesterService.
Allows harvest jobs to use DDD service instead of legacy module imports.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add Harvester Bootstrap Factory Functions

**Files:**
- Modify: `backend/src/0_infrastructure/bootstrap.mjs`

**Step 1: Add imports and factory function**

Add after existing imports (around line 100):

```javascript
// Harvester application imports
import { HarvesterService, HarvesterJobExecutor } from '../3_applications/harvester/index.mjs';

// Harvester adapter imports
import {
  YamlLifelogStore,
  TodoistHarvester,
  ClickUpHarvester,
  GitHubHarvester,
  LastfmHarvester,
  RedditHarvester,
  LetterboxdHarvester,
  GoodreadsHarvester,
  FoursquareHarvester,
  GmailHarvester,
  GCalHarvester,
  ShoppingHarvester,
  WeatherHarvester,
  ScriptureHarvester,
  StravaHarvester,
  WithingsHarvester
} from '../2_adapters/harvester/index.mjs';
```

**Step 2: Add createHarvesterServices factory**

Add new bootstrap section:

```javascript
// =============================================================================
// Harvester Application Bootstrap
// =============================================================================

/**
 * Create harvester application services
 * @param {Object} config
 * @param {Object} config.io - IO functions { userLoadFile, userSaveFile }
 * @param {Object} config.httpClient - HTTP client (axios)
 * @param {Object} config.configService - ConfigService
 * @param {Object} [config.todoistApi] - Todoist API client factory
 * @param {Object} [config.aiGateway] - AI gateway for shopping extraction
 * @param {Object} [config.logger] - Logger instance
 * @returns {Object} Harvester services
 */
export function createHarvesterServices(config) {
  const {
    io,
    httpClient,
    configService,
    todoistApi,
    aiGateway,
    logger = console
  } = config;

  // Create shared lifelog store
  const lifelogStore = new YamlLifelogStore({ io, logger });

  // Create HarvesterService
  const harvesterService = new HarvesterService({
    configService,
    logger
  });

  // Harvester dependencies
  const deps = {
    httpClient,
    lifelogStore,
    configService,
    logger
  };

  // Register productivity harvesters
  if (todoistApi || httpClient) {
    harvesterService.register(new TodoistHarvester({
      todoistApi,
      httpClient,
      lifelogStore,
      configService,
      logger
    }));
  }

  if (httpClient) {
    harvesterService.register(new ClickUpHarvester({ ...deps }));
    harvesterService.register(new GitHubHarvester({ ...deps }));
  }

  // Register social harvesters
  if (httpClient) {
    harvesterService.register(new LastfmHarvester({ ...deps }));
    harvesterService.register(new RedditHarvester({ ...deps }));
    harvesterService.register(new FoursquareHarvester({ ...deps }));
  }

  // Letterboxd and Goodreads use RSS/scraping, no httpClient needed
  harvesterService.register(new LetterboxdHarvester({ lifelogStore, configService, logger }));
  harvesterService.register(new GoodreadsHarvester({ lifelogStore, configService, logger }));

  // Register communication harvesters
  if (httpClient) {
    harvesterService.register(new GmailHarvester({ ...deps }));
    harvesterService.register(new GCalHarvester({ ...deps }));
  }

  // Register fitness harvesters
  if (httpClient) {
    harvesterService.register(new StravaHarvester({ ...deps }));
    harvesterService.register(new WithingsHarvester({ ...deps }));
  }

  // Register finance harvesters
  if (httpClient && aiGateway) {
    harvesterService.register(new ShoppingHarvester({ ...deps, aiGateway }));
  }

  // Register other harvesters
  if (httpClient) {
    harvesterService.register(new WeatherHarvester({ ...deps }));
    harvesterService.register(new ScriptureHarvester({ ...deps }));
  }

  // Create job executor for scheduler integration
  const jobExecutor = new HarvesterJobExecutor({
    harvesterService,
    configService,
    logger
  });

  logger.info?.('harvester.services.created', {
    registeredCount: harvesterService.listHarvesters().length,
    harvesters: harvesterService.listHarvesters().map(h => h.serviceId)
  });

  return {
    harvesterService,
    jobExecutor,
    lifelogStore
  };
}
```

**Step 3: Commit**

```bash
git add backend/src/0_infrastructure/bootstrap.mjs
git commit -m "$(cat <<'EOF'
feat(bootstrap): add createHarvesterServices factory

Creates HarvesterService with all harvester adapters registered.
Provides HarvesterJobExecutor for scheduler integration.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Update Harvest Router to Use HarvesterService

**Files:**
- Modify: `backend/src/4_api/routers/harvest.mjs`

**Step 1: Rewrite harvest router**

Replace entire file:

```javascript
// backend/src/4_api/routers/harvest.mjs
/**
 * Harvest Router - Data Collection Endpoints (DDD)
 *
 * Provides RESTful endpoints for triggering data harvesting.
 * Delegates all harvest logic to HarvesterService.
 *
 * Endpoints:
 *   GET  /harvest              - List available harvesters with status
 *   GET  /harvest/:serviceId   - Trigger specific harvester
 *   POST /harvest/:serviceId   - Trigger specific harvester (with options)
 *   GET  /harvest/status/:serviceId - Get harvester status
 */
import express from 'express';
import crypto from 'crypto';

/**
 * Create harvest router
 * @param {Object} config
 * @param {Object} config.harvesterService - HarvesterService instance
 * @param {Object} config.configService - ConfigService for user resolution
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createHarvestRouter(config) {
  const router = express.Router();
  const {
    harvesterService,
    configService,
    logger = console
  } = config;

  // Timeout configuration (ms)
  const DEFAULT_TIMEOUT = 120000; // 2 minutes
  const TIMEOUTS = {
    fitness: 180000,    // 3 minutes
    strava: 180000,
    health: 180000,
    budget: 240000,     // 4 minutes
    gmail: 180000,
    shopping: 300000,   // 5 minutes
  };

  /**
   * Resolve target username from request
   */
  const resolveUsername = (req) => {
    if (req.query.user) return req.query.user;
    if (req.body?.user) return req.body.user;
    return configService?.getHeadOfHousehold?.() || 'default';
  };

  /**
   * Wrap promise with timeout
   */
  const withTimeout = (promise, timeoutMs, serviceId) => {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Timeout: ${serviceId} exceeded ${timeoutMs}ms limit`)),
          timeoutMs
        )
      )
    ]);
  };

  /**
   * Sanitize error for response
   */
  const sanitizeError = (error, serviceId) => {
    let message = error.message || 'Unknown error';
    message = message
      .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
      .replace(/token[=:]\s*[^\s&]+/gi, 'token=[REDACTED]')
      .replace(/key[=:]\s*[^\s&]+/gi, 'key=[REDACTED]');

    return {
      harvester: serviceId,
      message,
      type: error.name || 'Error'
    };
  };

  /**
   * GET /harvest
   * List all available harvesters with status
   */
  router.get('/', (req, res) => {
    const harvesters = harvesterService.listHarvesters();
    const statuses = harvesterService.getAllStatuses();

    res.json({
      ok: true,
      harvesters: harvesters.map(h => ({
        ...h,
        status: statuses[h.serviceId]
      })),
      usage: 'GET /harvest/:serviceId or POST /harvest/:serviceId with options'
    });
  });

  /**
   * GET /harvest/status/:serviceId
   * Get status of a specific harvester
   */
  router.get('/status/:serviceId', (req, res) => {
    const { serviceId } = req.params;

    if (!harvesterService.has(serviceId)) {
      return res.status(404).json({
        ok: false,
        error: `Unknown harvester: ${serviceId}`,
        available: harvesterService.listHarvesters().map(h => h.serviceId)
      });
    }

    const status = harvesterService.getStatus(serviceId);
    res.json({ ok: true, ...status });
  });

  /**
   * GET/POST /harvest/:serviceId
   * Trigger a specific harvester
   */
  const harvestHandler = async (req, res) => {
    const { serviceId } = req.params;
    const requestId = crypto.randomUUID().split('-').pop();
    const username = resolveUsername(req);
    const options = { ...req.query, ...req.body };
    delete options.user; // Don't pass user as option

    if (!harvesterService.has(serviceId)) {
      return res.status(404).json({
        ok: false,
        error: `Unknown harvester: ${serviceId}`,
        available: harvesterService.listHarvesters().map(h => h.serviceId),
        requestId
      });
    }

    logger?.info?.('harvest.request', {
      serviceId,
      username,
      requestId,
      method: req.method
    });

    try {
      const timeoutMs = TIMEOUTS[serviceId] || DEFAULT_TIMEOUT;
      const result = await withTimeout(
        harvesterService.harvest(serviceId, username, options),
        timeoutMs,
        serviceId
      );

      logger?.info?.('harvest.response', {
        serviceId,
        requestId,
        result
      });

      res.json({
        ok: true,
        harvester: serviceId,
        data: result,
        requestId
      });

    } catch (error) {
      logger?.error?.('harvest.error', {
        serviceId,
        requestId,
        error: error.message
      });

      const statusCode = error.message?.includes('Timeout') ? 504 :
                        error.message?.includes('cooldown') ? 503 :
                        error.response?.status === 429 ? 429 : 500;

      res.status(statusCode).json({
        ok: false,
        ...sanitizeError(error, serviceId),
        requestId
      });
    }
  };

  router.get('/:serviceId', harvestHandler);
  router.post('/:serviceId', harvestHandler);

  return router;
}

export default createHarvestRouter;
```

**Step 2: Commit**

```bash
git add backend/src/4_api/routers/harvest.mjs
git commit -m "$(cat <<'EOF'
refactor(harvest): update router to use HarvesterService

Router now delegates all harvest logic to HarvesterService.
Supports dynamic service registration, status checking.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Wire HarvesterService in app.mjs

**Files:**
- Modify: `backend/src/app.mjs`

**Step 1: Add import**

Add to imports section (around line 55):

```javascript
import { createHarvesterServices } from './0_infrastructure/bootstrap.mjs';
```

**Step 2: Create harvester services**

Replace the existing harvest router creation (lines 367-376) with:

```javascript
  // Harvester application services
  // Create shared IO functions for lifelog persistence
  const userSaveFile = (username, service, data) => userDataService.saveLifelogData(username, service, data);
  const harvesterIo = { userLoadFile, userSaveFile };

  // HTTP client for external API calls
  const axios = (await import('axios')).default;

  const harvesterServices = createHarvesterServices({
    io: harvesterIo,
    httpClient: axios,
    configService,
    todoistApi: null, // Will use httpClient directly
    aiGateway: nutribotAiGateway, // Reuse for shopping extraction
    logger: rootLogger.child({ module: 'harvester' })
  });

  // Create harvest router using HarvesterService
  v1Routers.harvest = createHarvestRouter({
    harvesterService: harvesterServices.harvesterService,
    configService,
    logger: rootLogger.child({ module: 'harvest-api' })
  });
```

**Step 3: Remove legacy imports**

Remove these lines (around 368-369):

```javascript
// DELETE:
// const { refreshFinancialData, payrollSyncJob } = await import('../_legacy/lib/budget.mjs');
// const Infinity = (await import('../_legacy/lib/infinity.mjs')).default;
```

**Step 4: Update createHarvestRouter import**

The import already exists, just verify it's there:

```javascript
import { createHarvestRouter } from './4_api/routers/harvest.mjs';
```

**Step 5: Commit**

```bash
git add backend/src/app.mjs
git commit -m "$(cat <<'EOF'
refactor(app): wire HarvesterService into application

Creates HarvesterService with all adapters via bootstrap factory.
Passes service to harvest router for API endpoint handling.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Add Harvester Executor to Scheduler Service

**Files:**
- Modify: `backend/src/1_domains/scheduling/services/SchedulerService.mjs`

**Step 1: Add harvester executor support**

Add to constructor:

```javascript
constructor({
  jobStore,
  stateStore,
  timezone = 'America/Los_Angeles',
  moduleBasePath = null,
  harvesterExecutor = null,  // ADD THIS
  logger = console
}) {
  this.jobStore = jobStore;
  this.stateStore = stateStore;
  this.timezone = timezone;
  this.moduleBasePath = moduleBasePath;
  this.harvesterExecutor = harvesterExecutor;  // ADD THIS
  this.logger = logger;
  this.runningJobs = new Map();
}
```

**Step 2: Modify executeJob to check harvester executor first**

Update the `executeJob` method (around line 220):

```javascript
async executeJob(job, executionId, manual = false) {
  const execution = JobExecution.create(job.id, executionId, manual);

  // Check if already running
  if (this.runningJobs.has(job.id)) {
    this.logger.warn?.('scheduler.job.already_running', { jobId: job.id });
    execution.fail(new Error('Job already running'));
    return execution;
  }

  this.runningJobs.set(job.id, executionId);
  execution.start();

  const scopedLogger = this.logger.child?.({ jobId: executionId, job: job.id }) || this.logger;

  try {
    // Check if harvester executor can handle this job
    if (this.harvesterExecutor?.canHandle(job.id)) {
      this.logger.debug?.('scheduler.job.using_harvester', { jobId: job.id });

      await Promise.race([
        this.harvesterExecutor.execute(job.id, job.options || {}, {
          logger: scopedLogger,
          executionId
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Job timeout after ${job.timeout}ms`)), job.timeout)
        )
      ]);
    } else {
      // Fall back to dynamic module import (legacy)
      const resolvedPath = this.resolveModulePath(job.module);
      const module = await import(resolvedPath);
      const handler = module.default;

      if (typeof handler !== 'function') {
        throw new Error(`Job module ${job.module} does not export a default function`);
      }

      const promise = handler.length >= 2
        ? handler(scopedLogger, executionId)
        : handler.length === 1
          ? handler(executionId)
          : handler(scopedLogger, executionId);

      await Promise.race([
        promise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Job timeout after ${job.timeout}ms`)), job.timeout)
        )
      ]);
    }

    execution.succeed();
    this.logger.info?.('scheduler.job.success', {
      jobId: job.id,
      executionId,
      durationMs: execution.durationMs
    });
  } catch (err) {
    if (err.message?.includes('timeout')) {
      execution.timeout();
    } else {
      execution.fail(err);
    }
    this.logger.error?.('scheduler.job.failed', {
      jobId: job.id,
      executionId,
      error: err.message,
      status: execution.status
    });
  } finally {
    this.runningJobs.delete(job.id);
  }

  return execution;
}
```

**Step 3: Commit**

```bash
git add backend/src/1_domains/scheduling/services/SchedulerService.mjs
git commit -m "$(cat <<'EOF'
feat(scheduler): add harvester executor integration

Scheduler now checks HarvesterJobExecutor before falling back to
legacy module imports. Enables DRY harvest execution.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Wire Harvester Executor to Scheduler in app.mjs

**Files:**
- Modify: `backend/src/app.mjs`

**Step 1: Pass harvester executor to scheduler service**

Update the SchedulerService instantiation (around line 638):

```javascript
const schedulerService = new SchedulerService({
  jobStore: schedulingJobStore,
  stateStore: schedulingStateStore,
  timezone: 'America/Los_Angeles',
  moduleBasePath: legacyCronRouterDir,
  harvesterExecutor: harvesterServices.jobExecutor,  // ADD THIS
  logger: rootLogger.child({ module: 'scheduler-service' })
});
```

**Step 2: Commit**

```bash
git add backend/src/app.mjs
git commit -m "$(cat <<'EOF'
feat(app): wire harvester executor to scheduler

Scheduler now uses HarvesterJobExecutor for harvest jobs.
Both API and scheduler use same HarvesterService (DRY).

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Test and Verify

**Step 1: Start dev server**

```bash
npm run dev
```

**Step 2: Test harvest list endpoint**

```bash
curl http://localhost:3112/api/v1/harvest | jq
```

Expected: List of registered harvesters with status

**Step 3: Test individual harvest**

```bash
curl http://localhost:3112/api/v1/harvest/weather | jq
```

Expected: Weather harvest result or cooldown status

**Step 4: Test status endpoint**

```bash
curl http://localhost:3112/api/v1/harvest/status/lastfm | jq
```

Expected: Circuit breaker status for lastfm harvester

**Step 5: Verify scheduler integration**

Check logs after scheduled job runs:

```bash
tail -f dev.log | grep harvester
```

Expected: `scheduler.job.using_harvester` log entries

---

## Summary

After completing all tasks:

1. **HarvesterService** (`3_applications/harvester/`) owns all harvest logic
2. **API routes** (`4_api/routers/harvest.mjs`) call HarvesterService
3. **Scheduler** (`1_domains/scheduling/`) calls HarvesterService via HarvesterJobExecutor
4. **Single source of truth** - both entry points use the same service
5. **Legacy fallback** - scheduler still supports legacy module imports for non-harvest jobs

Migration is complete when:
- [ ] All harvest API endpoints work via HarvesterService
- [ ] Scheduled harvest jobs use HarvesterJobExecutor
- [ ] Circuit breaker status is consistent across API and scheduler
- [ ] Legacy budget/payroll endpoints are migrated or deprecated
