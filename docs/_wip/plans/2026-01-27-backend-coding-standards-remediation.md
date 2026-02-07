# Backend Coding Standards Remediation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring all backend layers (1_domains, 2_adapters, 3_applications, 4_api) into compliance with coding standards.

**Architecture:** Layer-by-layer remediation starting with the domain layer foundation, then adapters, applications, and finally API. Each task is a focused, testable unit of work.

**Tech Stack:** ES Modules (.mjs), ES2022 private fields, JSDoc, Jest

---

## Summary of Violations by Layer

| Layer | Grade | Critical Issues |
|-------|-------|-----------------|
| 0_system | B+ | ✅ Already remediated |
| 1_domains | B- (78%) | Public mutable fields, missing JSDoc, missing default exports on errors |
| 2_adapters | C+ (70%) | Generic errors, missing InfrastructureError, missing default exports |
| 3_applications | B+ (85%) | Singleton imports, generic errors, missing @throws |
| 4_api | C (65%) | Error handling in handlers, wrong exports, module state |

**Audit Reports:** `docs/_wip/audits/2026-01-27-*-layer-audit.md`

---

## Task 1: Domain Error Class Exports

**Priority:** HIGH
**Estimated Files:** 3
**Layer:** 1_domains

**Files:**
- Modify: `backend/src/1_domains/core/errors/ValidationError.mjs`
- Modify: `backend/src/1_domains/core/errors/DomainInvariantError.mjs`
- Modify: `backend/src/1_domains/core/errors/EntityNotFoundError.mjs`

**Step 1: Add default export to ValidationError**

Add at end of file:
```javascript
export default ValidationError;
```

**Step 2: Add default export to DomainInvariantError**

Add at end of file:
```javascript
export default DomainInvariantError;
```

**Step 3: Add default export to EntityNotFoundError**

Add at end of file:
```javascript
export default EntityNotFoundError;
```

**Step 4: Run tests**

Run: `npm test -- --testPathPattern="errors"`
Expected: All existing tests still pass

**Step 5: Commit**

```bash
git add backend/src/1_domains/core/errors/
git commit -m "refactor(domain): add default exports to error classes"
```

---

## Task 2: Adapter Default Exports

**Priority:** HIGH
**Estimated Files:** 15-20
**Layer:** 2_adapters

**Files to check and modify:**
- `backend/src/2_adapters/telegram/TelegramMessagingAdapter.mjs`
- `backend/src/2_adapters/telegram/TelegramWebhookParser.mjs`
- `backend/src/2_adapters/content/media/plex/PlexClient.mjs`
- Any other class files missing `export default ClassName;`

**Step 1: Find all adapter classes missing default export**

Run: `grep -rL "export default" backend/src/2_adapters/**/*.mjs | xargs grep -l "export class"`

**Step 2: Add default exports**

For each file found, add at end:
```javascript
export default ClassName;
```

**Step 3: Run tests**

Run: `npm test -- --testPathPattern="adapters"`
Expected: All existing tests still pass

**Step 4: Commit**

```bash
git add backend/src/2_adapters/
git commit -m "refactor(adapters): add default exports to all adapter classes"
```

---

## Task 3: API Router Export Pattern

**Priority:** HIGH
**Estimated Files:** 10+
**Layer:** 4_api

**Issue:** Routers export `router` instance instead of `createXRouter` factory function as default.

**Files:**
- `backend/src/4_api/v1/routers/ai.mjs`
- `backend/src/4_api/v1/routers/health.mjs`
- `backend/src/4_api/v1/routers/list.mjs`
- All other routers with `export default router;`

**Step 1: Find violating files**

Run: `grep -l "export default router" backend/src/4_api/v1/routers/*.mjs`

**Step 2: Fix export pattern**

For each file, change:
```javascript
// FROM:
export default router;

// TO:
export default createXRouter;  // Use actual function name
```

Also add named export if missing:
```javascript
export function createXRouter(config) { ... }
export default createXRouter;
```

**Step 3: Update any imports**

Check if anything imports these routers and update accordingly.

**Step 4: Run tests**

Run: `npm test -- --testPathPattern="routers"`
Expected: All existing tests still pass

**Step 5: Commit**

```bash
git add backend/src/4_api/
git commit -m "refactor(api): fix router export patterns to export factory functions"
```

---

## Task 4: Remove Error Catching from API Handlers

**Priority:** HIGH
**Estimated Files:** 15+
**Layer:** 4_api

**Issue:** Handlers catch errors and format responses instead of letting middleware handle them.

**Files:**
- `backend/src/4_api/v1/handlers/journalist/*.mjs`
- `backend/src/4_api/v1/handlers/nutribot/*.mjs`
- `backend/src/4_api/v1/routers/fitness.mjs`
- `backend/src/4_api/v1/routers/play.mjs`
- `backend/src/4_api/v1/routers/health.mjs`
- `backend/src/4_api/v1/routers/ai.mjs`
- All other files with try-catch in handlers

**Step 1: Identify all try-catch blocks in handlers**

Run: `grep -rn "catch (error)" backend/src/4_api/v1/ | grep -v test`

**Step 2: Remove try-catch, let errors propagate**

Change pattern:
```javascript
// FROM:
return async (req, res) => {
  try {
    const result = await service.execute(input);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// TO:
return async (req, res) => {
  const result = await service.execute(input);
  res.json(result);
};
```

**Step 3: Ensure errorHandlerMiddleware is mounted**

Verify each router has:
```javascript
router.use(errorHandlerMiddleware({ ... }));
```

**Step 4: Run tests**

Run: `npm test -- --testPathPattern="api"`
Expected: All existing tests still pass (may need to update test expectations)

**Step 5: Commit**

```bash
git add backend/src/4_api/
git commit -m "refactor(api): remove error catching from handlers, use middleware"
```

---

## Task 5: Replace Generic Errors with InfrastructureError in Adapters

**Priority:** HIGH
**Estimated Files:** 20+
**Layer:** 2_adapters

**Issue:** Adapters throw generic `Error` for external failures instead of `InfrastructureError`.

**Files:**
- `backend/src/2_adapters/content/media/plex/PlexClient.mjs`
- `backend/src/2_adapters/ai/OpenAIAdapter.mjs`
- `backend/src/2_adapters/ai/AnthropicAdapter.mjs`
- `backend/src/2_adapters/finance/BuxferAdapter.mjs`
- `backend/src/2_adapters/home-automation/homeassistant/HomeAssistantAdapter.mjs`
- All adapters making external HTTP calls

**Step 1: Add InfrastructureError import**

Add to each adapter file:
```javascript
import { InfrastructureError } from '#system/utils/errors/index.mjs';
```

**Step 2: Replace generic Error throws**

Change pattern:
```javascript
// FROM:
throw new Error('API request failed');

// TO:
throw new InfrastructureError('API request failed', {
  code: 'EXTERNAL_SERVICE_ERROR',
  service: 'serviceName',
  isTransient: response.status >= 500
});
```

**Step 3: Replace constructor validation errors**

Change pattern:
```javascript
// FROM:
if (!config.host) throw new Error('host is required');

// TO:
import { ConfigurationError } from '#system/utils/errors/index.mjs';
if (!config.host) throw new ConfigurationError('host is required', {
  code: 'MISSING_CONFIG',
  field: 'host'
});
```

**Step 4: Run tests**

Run: `npm test -- --testPathPattern="adapters"`
Expected: Tests may need updates for new error types

**Step 5: Commit**

```bash
git add backend/src/2_adapters/
git commit -m "refactor(adapters): use InfrastructureError for external failures"
```

---

## Task 6: Replace Generic Errors in Applications

**Priority:** HIGH
**Estimated Files:** 10+
**Layer:** 3_applications

**Issue:** Application services throw generic `Error` instead of domain-specific errors.

**Files:**
- `backend/src/3_applications/harvester/HarvesterService.mjs`
- `backend/src/3_applications/agents/AgentOrchestrator.mjs`
- `backend/src/3_applications/content/jobs/MediaJobExecutor.mjs`
- `backend/src/3_applications/entropy/EntropyService.mjs`

**Step 1: Create application error classes (if not exist)**

Create `backend/src/3_applications/common/errors/ApplicationError.mjs`:
```javascript
import { DomainError } from '#system/utils/errors/index.mjs';

export class ApplicationError extends DomainError {
  static defaultCode = 'APPLICATION_ERROR';
}

export class ServiceNotFoundError extends ApplicationError {
  static defaultCode = 'SERVICE_NOT_FOUND';

  constructor(serviceName, serviceId) {
    super(`${serviceName} not found: ${serviceId}`, {
      code: ServiceNotFoundError.defaultCode,
      serviceName,
      serviceId
    });
  }
}

export default ApplicationError;
```

**Step 2: Replace generic errors**

Change pattern:
```javascript
// FROM:
throw new Error(`Harvester not found: ${serviceId}`);

// TO:
import { ServiceNotFoundError } from '../common/errors/ApplicationError.mjs';
throw new ServiceNotFoundError('Harvester', serviceId);
```

**Step 3: Run tests**

Run: `npm test -- --testPathPattern="applications"`
Expected: Tests may need updates for new error types

**Step 4: Commit**

```bash
git add backend/src/3_applications/
git commit -m "refactor(apps): use application-specific error classes"
```

---

## Task 7: Refactor Legacy Services to Use DI

**Priority:** MEDIUM
**Estimated Files:** 4
**Layer:** 3_applications

**Issue:** Some services import singletons directly instead of using dependency injection.

**Files:**
- `backend/src/3_applications/content/services/ArchiveService.mjs`
- `backend/src/3_applications/content/services/MediaMemoryService.mjs`
- `backend/src/3_applications/entropy/EntropyService.mjs`
- `backend/src/3_applications/nutribot/NutriBotConfig.mjs`

**Step 1: Refactor ArchiveService to class**

Change from module-scoped functions to class with DI:
```javascript
export class ArchiveService {
  #userDataService;
  #configService;
  #logger;

  constructor({ userDataService, configService, logger = console }) {
    if (!userDataService) throw new Error('userDataService is required');
    this.#userDataService = userDataService;
    this.#configService = configService;
    this.#logger = logger;
  }

  // Convert each exported function to a method
}

export default ArchiveService;
```

**Step 2: Update callers**

Update any code that imports ArchiveService to instantiate with dependencies.

**Step 3: Repeat for other services**

Apply same pattern to MediaMemoryService, EntropyService factory.

**Step 4: Run tests**

Run: `npm test`
Expected: All tests pass after updating test setup

**Step 5: Commit**

```bash
git add backend/src/3_applications/
git commit -m "refactor(apps): convert legacy services to classes with DI"
```

---

## Task 8: Remove Module-Level State from API

**Priority:** MEDIUM
**Estimated Files:** 2
**Layer:** 4_api

**Issue:** Module-level mutable state breaks in clustered environments.

**Files:**
- `backend/src/4_api/v1/routers/fitness.mjs` (simulationState)
- `backend/src/4_api/middleware/legacyTracker.mjs` (globalTracker)

**Step 1: Refactor simulationState to service**

Create or use existing SimulationService:
```javascript
// Pass as dependency instead of module state
export function createFitnessRouter(config) {
  const { simulationService, ... } = config;
  // Use simulationService instead of module state
}
```

**Step 2: Refactor globalTracker**

Pass LegacyTracker instance via dependency injection instead of singleton.

**Step 3: Update bootstrap**

Update application bootstrap to create and inject these services.

**Step 4: Run tests**

Run: `npm test -- --testPathPattern="api"`
Expected: All tests pass

**Step 5: Commit**

```bash
git add backend/src/4_api/
git commit -m "refactor(api): remove module-level mutable state"
```

---

## Task 9: Add JSDoc to Domain Classes

**Priority:** MEDIUM
**Estimated Files:** 69
**Layer:** 1_domains

**Issue:** Only 3 of 72 classes have `@class` JSDoc.

**Files:**
- All entity classes in `backend/src/1_domains/*/entities/`
- All service classes in `backend/src/1_domains/*/services/`

**Step 1: Add @class JSDoc to entities**

Template:
```javascript
/**
 * [Entity description - one line]
 *
 * [Additional context - 1-2 sentences]
 *
 * @class EntityName
 * @property {Type} propertyName - Description
 */
export class EntityName {
```

**Step 2: Add @class JSDoc to services**

Use same template.

**Step 3: Run linter**

Run: `npm run lint`
Expected: No JSDoc errors

**Step 4: Commit**

```bash
git add backend/src/1_domains/
git commit -m "docs(domain): add @class JSDoc to all domain classes"
```

---

## Task 10: Add JSDoc to Adapter Classes

**Priority:** MEDIUM
**Estimated Files:** 40
**Layer:** 2_adapters

**Issue:** ~40 classes missing @class JSDoc.

**Files:**
- All adapter classes in `backend/src/2_adapters/`

**Step 1: Add @class JSDoc**

Template:
```javascript
/**
 * [Adapter description - one line]
 *
 * Implements [interface] for [external service].
 *
 * @class AdapterName
 * @property {Type} propertyName - Description
 */
export class AdapterName {
```

**Step 2: Add @throws documentation to methods**

Add to all methods that throw:
```javascript
/**
 * @throws {InfrastructureError} If external service fails
 */
```

**Step 3: Run linter**

Run: `npm run lint`
Expected: No JSDoc errors

**Step 4: Commit**

```bash
git add backend/src/2_adapters/
git commit -m "docs(adapters): add @class and @throws JSDoc"
```

---

## Task 11: Add JSDoc to Application Classes

**Priority:** MEDIUM
**Estimated Files:** 25
**Layer:** 3_applications

**Issue:** Missing @class tags on containers, missing @throws on execute methods.

**Files:**
- `backend/src/3_applications/*/Container.mjs`
- `backend/src/3_applications/*/usecases/*.mjs`

**Step 1: Add @class JSDoc to containers**

Template:
```javascript
/**
 * Dependency injection container for [Domain].
 *
 * @class DomainContainer
 */
export class DomainContainer {
```

**Step 2: Add @throws to execute methods**

Template:
```javascript
/**
 * Execute the use case.
 *
 * @param {Object} input - Input parameters
 * @returns {Promise<Object>} Result
 * @throws {ValidationError} If input is invalid
 * @throws {EntityNotFoundError} If entity not found
 */
async execute(input) {
```

**Step 3: Commit**

```bash
git add backend/src/3_applications/
git commit -m "docs(apps): add @class and @throws JSDoc"
```

---

## Task 12: Add JSDoc to API Factories

**Priority:** MEDIUM
**Estimated Files:** 20
**Layer:** 4_api

**Issue:** Factory functions missing @returns, @throws, @example.

**Files:**
- `backend/src/4_api/utils/*.mjs`
- `backend/src/4_api/middleware/*.mjs`
- `backend/src/4_api/v1/routers/*.mjs`

**Step 1: Add complete JSDoc to utility functions**

Template:
```javascript
/**
 * Send a success JSON response.
 *
 * @param {Object} res - Express response object
 * @param {*} data - Response data
 * @param {number} [status=200] - HTTP status code
 * @returns {void}
 *
 * @example
 * sendSuccess(res, { user: { id: 1 } });
 */
export function sendSuccess(res, data, status = 200) {
```

**Step 2: Add JSDoc to router factories**

Template:
```javascript
/**
 * Create the [domain] router.
 *
 * @param {Object} config - Router configuration
 * @param {Object} config.service - Domain service
 * @param {Object} [config.logger=console] - Logger instance
 * @returns {Router} Configured Express router
 *
 * @example
 * const router = createFitnessRouter({ sessionService, logger });
 * app.use('/api/v1/fitness', router);
 */
export function createFitnessRouter(config) {
```

**Step 3: Commit**

```bash
git add backend/src/4_api/
git commit -m "docs(api): add complete JSDoc to factories"
```

---

## Task 13: Replace Console with Logger in API

**Priority:** LOW
**Estimated Files:** 5
**Layer:** 4_api

**Issue:** Direct console usage instead of injected logger.

**Files:**
- `backend/src/4_api/v1/routers/play.mjs`
- `backend/src/4_api/v1/routers/list.mjs`
- `backend/src/4_api/middleware/cutoverFlags.mjs`

**Step 1: Replace console.error/warn**

Change:
```javascript
// FROM:
console.error('[play] Error:', err);

// TO:
logger.error?.('play.error', { error: err.message });
```

**Step 2: Ensure logger is available**

Add logger to config destructuring if not present.

**Step 3: Commit**

```bash
git add backend/src/4_api/
git commit -m "refactor(api): use injected logger instead of console"
```

---

## Task 14: Extract Magic Numbers to Constants

**Priority:** LOW
**Estimated Files:** 10+
**Layer:** 4_api

**Issue:** Magic numbers for timeouts, thresholds, status codes.

**Files:**
- Various router files

**Step 1: Create constants file**

Create `backend/src/4_api/constants.mjs`:
```javascript
export const HTTP_STATUS = Object.freeze({
  OK: 200,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503
});

export const TIMEOUTS = Object.freeze({
  CACHE_TTL_MS: 30000,
  IDEMPOTENCY_TTL_MS: 300000
});

export const THRESHOLDS = Object.freeze({
  MIN_PLAYBACK_SECONDS: 10
});
```

**Step 2: Replace magic numbers**

```javascript
// FROM:
res.status(500).json({ ... });

// TO:
import { HTTP_STATUS } from '../constants.mjs';
res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ ... });
```

**Step 3: Commit**

```bash
git add backend/src/4_api/
git commit -m "refactor(api): extract magic numbers to named constants"
```

---

## Implementation Order

### Phase 1: Critical Fixes (HIGH priority)
1. Task 1: Domain error exports
2. Task 2: Adapter default exports
3. Task 3: API router export pattern
4. Task 4: Remove error catching from handlers
5. Task 5: InfrastructureError in adapters
6. Task 6: Application-specific errors

### Phase 2: Architecture Improvements (MEDIUM priority)
7. Task 7: Legacy services to DI
8. Task 8: Remove module-level state

### Phase 3: Documentation (MEDIUM priority)
9. Task 9: Domain JSDoc
10. Task 10: Adapter JSDoc
11. Task 11: Application JSDoc
12. Task 12: API JSDoc

### Phase 4: Polish (LOW priority)
13. Task 13: Console → Logger
14. Task 14: Magic numbers

---

## Execution Notes

- **Test after each task** - Don't accumulate untested changes
- **Tasks 1-3** can be done in parallel (independent)
- **Task 4** (error handling) is the highest-impact change
- **Tasks 9-12** (JSDoc) can be done incrementally
- Some tasks may reveal additional issues - add to backlog

---

## Verification Checklist

After completing all tasks:

- [ ] `npm test` passes
- [ ] `npm run lint` passes (if configured)
- [ ] No `export default router;` in routers (should be factory)
- [ ] No try-catch in handler functions
- [ ] No `throw new Error()` in adapters (use InfrastructureError)
- [ ] No direct singleton imports in application services
- [ ] All classes have @class JSDoc
- [ ] All public methods have @param/@returns/@throws
