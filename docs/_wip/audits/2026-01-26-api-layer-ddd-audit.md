# API Layer DDD Compliance Audit

> **Date:** 2026-01-26
> **Layer:** `backend/src/4_api/`
> **Guidelines:** `docs/reference/core/layers-of-abstraction/api-layer-guidelines.md`
> **Status:** Audit Complete

---

## Executive Summary

**Overall Assessment: MOSTLY COMPLIANT**

The API layer is well-structured with 29 routers and 11 handlers properly organized. The team has done excellent work on naming conventions, factory patterns, and file organization. However, several violations of the DDD import rules need remediation.

| Category | Status |
|----------|--------|
| Naming conventions | ⚠️ Version in names (`apiV1.mjs`) |
| Factory patterns | ⚠️ 1 direct export (`morning.mjs`) |
| **Folder structure** | ❌ Missing versioned layout |
| JSDoc documentation | ✅ Fully compliant |
| Import rules | ❌ 6 violations |
| Dependency injection | ⚠️ 6 anti-patterns |
| Error handling | ⚠️ Inconsistent |
| Barrel exports | ⚠️ Missing `routers/index.mjs` |

---

## Files Examined

### Routers (30 files)
```
backend/src/4_api/routers/
├── agents.mjs          ├── health.mjs          ├── messaging.mjs
├── ai.mjs              ├── homeAutomation.mjs  ├── nutribot.mjs
├── apiV1.mjs           ├── homebot.mjs         ├── nutrition.mjs
├── calendar.mjs        ├── item.mjs            ├── play.mjs
├── content.mjs         ├── journaling.mjs      ├── printer.mjs
├── entropy.mjs         ├── journalist.mjs      ├── proxy.mjs
├── externalProxy.mjs   ├── lifelog.mjs         ├── scheduling.mjs
├── finance.mjs         ├── list.mjs            ├── static.mjs
├── fitness.mjs         ├── localContent.mjs    ├── tts.mjs
├── gratitude.mjs       └── admin/
├── harvest.mjs             ├── eventbus.mjs
                            └── legacy.mjs
```

### Handlers (11 files)
```
backend/src/4_api/handlers/
├── nutribot/
│   ├── report.mjs
│   ├── reportImg.mjs
│   ├── directInput.mjs
│   └── index.mjs
├── journalist/
│   ├── journal.mjs
│   ├── trigger.mjs
│   ├── morning.mjs
│   └── index.mjs
└── homebot/
    └── index.mjs
```

### Middleware (2 files)
```
backend/src/4_api/middleware/
├── cutoverFlags.mjs
└── legacyTracker.mjs
```

### Other
```
backend/src/4_api/webhook-server.mjs
```

---

## Violation Details

### 1. Domain Layer Imports (CRITICAL)

**Guideline violated:** API layer must not import from `1_domains/`

| File | Line | Import | Issue |
|------|------|--------|-------|
| `routers/journaling.mjs` | 7 | `JournalService` from `1_domains/journaling/services/` | Service should be injected via container |
| `routers/nutrition.mjs` | 7 | `FoodLogService` from `1_domains/nutrition/services/` | Service should be injected via container |
| `routers/play.mjs` | 3 | `WatchState` from `1_domains/content/entities/` | Domain entity accessed directly |
| `routers/content.mjs` | 5 | `WatchState` from `1_domains/content/entities/` | Domain entity accessed directly |

**Impact:** These violations couple the API layer to domain internals, making refactoring difficult and violating the principle that API has no domain knowledge.

**Fix:**
- Services should be created in bootstrap and passed via factory parameters
- WatchState usage should be replaced with adapter-level abstractions or plain objects from use cases

---

### 2. Config Service Imports (MEDIUM)

**Guideline violated:** Config values should come from bootstrap, not direct imports

| File | Line | Usage |
|------|------|-------|
| `routers/apiV1.mjs` | 15, 101 | `configService.getSafeConfig()` in response |
| `routers/item.mjs` | 5 | Direct configService import |

**Impact:** Routers depend on global config singleton instead of receiving resolved values.

**Fix:** Pass config values as factory parameters from bootstrap.

---

### 3. Inline Adapter Instantiation (ANTI-PATTERN)

**Guideline violated:** Adapters should be injected, not instantiated in routers

| File | Lines | What's Instantiated |
|------|-------|---------------------|
| `routers/ai.mjs` | 25-34 | `OpenAIAdapter`, `AnthropicAdapter` |
| `routers/journaling.mjs` | 23-24 | `YamlJournalDatastore`, `JournalService` |
| `routers/nutrition.mjs` | 22-23 | `YamlFoodLogDatastore`, `FoodLogService` |
| `routers/homebot.mjs` | 32-33 | `TelegramWebhookParser`, `HomeBotInputRouter` |
| `routers/nutribot.mjs` | 48-49 | `TelegramWebhookParser`, `NutribotInputRouter` |
| `routers/journalist.mjs` | 46-47 | `TelegramWebhookParser`, `JournalistInputRouter` |

**Example violation (ai.mjs:25-34):**
```javascript
// BAD - instantiating adapters in router
let openaiAdapter = null;
let anthropicAdapter = null;

if (openaiConfig?.apiKey) {
  openaiAdapter = new OpenAIAdapter(openaiConfig, { logger });
}
```

**Example fix:**
```javascript
// GOOD - receive pre-built adapters
export function createAIRouter({ openaiAdapter, anthropicAdapter, logger }) {
  // Use injected adapters directly
}
```

**Impact:** Routers become responsible for wiring, which belongs in bootstrap.

---

### 4. Handler Adapter Import (MEDIUM)

**Guideline violated:** Handlers should not import from adapters

| File | Line | Import |
|------|------|--------|
| `handlers/homebot/index.mjs` | 3 | `TelegramChatRef` from `2_adapters/telegram/` |

**Note:** This handler appears to be legacy code pending migration to `createBotWebhookHandler` pattern.

---

### 5. Version in Names (NAMING)

**Guideline violated:** "Version is a folder, not a name. Routers and handlers never contain version numbers."

| File | Issue |
|------|-------|
| `routers/apiV1.mjs` | Filename contains version |
| `createApiV1Router` | Function name contains version |

**Correct approach:** The file should be `routers/api.mjs` with function `createApiRouter`, and live inside a `v1/` folder.

---

### 6. Direct Handler Export (PATTERN)

**Guideline violated:** "Handlers are always factory functions that return Express handlers"

| File | Line | Export |
|------|------|--------|
| `handlers/journalist/morning.mjs` | 20 | `export async function handleMorningDebrief(deps, username, date)` |

This is a direct async function export, not a factory that returns a handler. Should be:
```javascript
// GOOD - Factory pattern
export function morningDebriefHandler(deps) {
  return async (req, res) => {
    const { username, date } = req.params;
    // ...
  };
}
```

---

### 7. Missing Barrel Exports (STRUCTURE)

**Guideline violated:** File structure shows `index.mjs` barrel exports for routers

| Directory | Has index.mjs? |
|-----------|----------------|
| `routers/` | ❌ Missing |
| `handlers/nutribot/` | ✅ Present |
| `handlers/journalist/` | ✅ Present |
| `handlers/homebot/` | ✅ Present |

The routers directory needs an `index.mjs` that exports all router factories.

---

### 8. Folder Structure (STRUCTURAL)

**Guideline violated:** API layer should use versioned folder structure

**Current structure:**
```
4_api/
├── handlers/           # ❌ Should be inside v1/
├── routers/            # ❌ Should be inside v1/
├── middleware/         # ✅ Correct location
└── webhook-server.mjs  # ✅ Correct location
```

**Required structure per guidelines:**
```
4_api/
├── v1/
│   ├── routers/        # All current routers go here
│   │   └── index.mjs   # Barrel export
│   └── handlers/       # All current handlers go here
│       └── index.mjs   # Barrel export
├── v2/                 # Created when endpoints change
│   ├── routers/
│   │   └── index.mjs   # Re-exports unchanged from v1
│   └── handlers/
├── utils/              # ❌ Missing - shared HTTP helpers
│   ├── validation.mjs
│   ├── responses.mjs
│   └── index.mjs
├── middleware/
└── webhook-server.mjs
```

**Impact:**
- No clear versioning strategy for API evolution
- Missing `utils/` folder for shared HTTP helpers like `requireParam()`
- Bootstrap cannot mount different versions independently

**Fix:** Restructure folders and update imports:
1. Create `v1/` directory
2. Move `routers/` → `v1/routers/`
3. Move `handlers/` → `v1/handlers/`
4. Create `utils/` with validation and response helpers
5. Add barrel exports (`index.mjs`) to each directory
6. Update bootstrap to import from versioned paths

---

## Compliance Matrix

| Criterion | Status | Details |
|-----------|--------|---------|
| Factory naming (`create{Domain}Router`) | ⚠️ PARTIAL | 28/29 compliant; `createApiV1Router` has version in name |
| Handler naming (`{domain}{Action}Handler`) | ⚠️ PARTIAL | `handleMorningDebrief` not factory pattern |
| No version in names | ❌ FAIL | `apiV1.mjs`, `createApiV1Router` |
| No domain imports | ❌ FAIL | 4 files import from `1_domains/` |
| No unchecked adapter imports | ⚠️ PARTIAL | 6 routers instantiate adapters inline |
| Config from bootstrap | ❌ FAIL | 2 files import `configService` directly |
| Deps object pattern | ✅ PASS | All factories use `{ deps }` pattern |
| Error propagation | ⚠️ PARTIAL | Some routers catch errors inline |
| No business logic | ✅ PASS | Routers are thin delegation layers |
| JSDoc documentation | ✅ PASS | Comprehensive coverage |
| **Versioned folder structure** | ❌ FAIL | Missing `v1/` wrapper, missing `utils/` |
| Barrel exports | ⚠️ PARTIAL | Handlers have them, routers missing `index.mjs` |

---

## Positive Findings

The API layer demonstrates excellent adherence to several key principles:

### Naming Consistency
28 of 29 routers follow the `create{Domain}Router` pattern:
- `createAgentsRouter`, `createAIRouter`, `createCalendarRouter`, etc.
- Exception: `createApiV1Router` contains version in name (should be `createApiRouter` in `v1/` folder)

### Factory Pattern Implementation
All handlers correctly use the factory pattern:
```javascript
// nutribot/report.mjs - Correct pattern
export function nutribotReportHandler(container, options = {}) {
  return async (req, res) => {
    const useCase = container.getGetReportAsJSON();
    const result = await useCase.execute({ userId: chatId });
    res.json(result);
  };
}
```

### Clean Delegation
Routers properly delegate to containers without business logic:
```javascript
// Correct - thin delegation layer
const result = await container.getUseCase().execute(params);
res.json(result);
```

### Documentation Quality
Comprehensive JSDoc on all factory functions:
```javascript
/**
 * Create finance API router
 * @param {Object} config
 * @param {Object} config.buxferAdapter - BuxferAdapter instance
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
```

---

## Remediation Plan

### Priority 0: Folder Structure

#### 0.1 Restructure to Versioned Layout

```bash
# Create versioned structure
mkdir -p backend/src/4_api/v1
mkdir -p backend/src/4_api/utils

# Move routers and handlers into v1
mv backend/src/4_api/routers backend/src/4_api/v1/
mv backend/src/4_api/handlers backend/src/4_api/v1/

# Create barrel exports
touch backend/src/4_api/v1/routers/index.mjs
touch backend/src/4_api/v1/handlers/index.mjs
touch backend/src/4_api/utils/index.mjs
```

#### 0.2 Create Utils Module

```javascript
// 4_api/utils/validation.mjs
export function requireParam(source, name) {
  const value = source[name];
  if (value === undefined || value === null || value === '') {
    const error = new Error(`Missing required parameter: ${name}`);
    error.status = 400;
    throw error;
  }
  return value;
}

// 4_api/utils/index.mjs
export { requireParam } from './validation.mjs';
```

#### 0.3 Create Router Barrel Export

```javascript
// 4_api/v1/routers/index.mjs
export { createAgentsRouter } from './agents.mjs';
export { createAIRouter } from './ai.mjs';
export { createApiRouter } from './api.mjs';  // Note: renamed from apiV1
// ... all 29 routers
```

#### 0.4 Update Bootstrap Imports

```javascript
// Before
import { createNutribotRouter } from './4_api/routers/nutribot.mjs';

// After
import * as v1 from './4_api/v1/routers/index.mjs';
app.use('/api/v1', createApiRouter({ routerFactories: v1 }));
```

#### 0.5 Rename apiV1.mjs (Version in Name)

```bash
# Rename file
mv backend/src/4_api/v1/routers/apiV1.mjs backend/src/4_api/v1/routers/api.mjs
```

```javascript
// Before: apiV1.mjs
export function createApiV1Router(config) { ... }

// After: api.mjs
export function createApiRouter(config) { ... }
```

Update all imports referencing `apiV1` or `createApiV1Router`.

#### 0.6 Fix Direct Handler Export (morning.mjs)

```javascript
// Before: handlers/journalist/morning.mjs
export async function handleMorningDebrief(deps, username, date = null) {
  // Direct function - not a factory
}

// After: handlers/journalist/morning.mjs
export function journalistMorningDebriefHandler(deps) {
  return async (req, res) => {
    const { username } = req.params;
    const date = req.query.date || null;
    // Implementation
    res.json(result);
  };
}
```

---

### Priority 1: Critical Violations

#### 1.1 Remove Domain Imports from Routers

**journaling.mjs and nutrition.mjs:**

Current:
```javascript
import { JournalService } from '../../1_domains/journaling/services/JournalService.mjs';
import { YamlJournalDatastore } from '../../2_adapters/persistence/yaml/YamlJournalDatastore.mjs';

export function createJournalingRouter({ dataRoot, logger }) {
  const journalStore = new YamlJournalDatastore({ dataRoot });
  const journalService = new JournalService({ journalStore });
  // ...
}
```

Fixed:
```javascript
// No domain/adapter imports

/**
 * @param {Object} deps
 * @param {Object} deps.journalService - Pre-built JournalService instance
 * @param {Object} [deps.logger]
 */
export function createJournalingRouter({ journalService, logger }) {
  // Use injected service directly
}
```

Bootstrap wiring:
```javascript
// In bootstrap
const journalStore = new YamlJournalDatastore({ dataRoot });
const journalService = new JournalService({ journalStore });
const journalingRouter = createJournalingRouter({ journalService, logger });
```

**play.mjs and content.mjs:**

The `WatchState` entity import needs analysis. Options:
1. Move WatchState to adapter layer if it's a DTO
2. Have use cases return plain objects instead of domain entities
3. Create an API-layer response transformer

#### 1.2 Remove Config Imports

**apiV1.mjs:**

Current:
```javascript
import { configService } from '../../0_system/config/index.mjs';
// ...
res.json({ config: configService.getSafeConfig() });
```

Fixed:
```javascript
export function createApiV1Router({ safeConfig, ...deps }) {
  // ...
  res.json({ config: safeConfig });
}
```

### Priority 2: Anti-Pattern Remediation

#### 2.1 Inject Adapters Instead of Instantiating

**ai.mjs:**

Current:
```javascript
import { OpenAIAdapter } from '../../2_adapters/ai/OpenAIAdapter.mjs';

export function createAIRouter({ openaiConfig, anthropicConfig, logger }) {
  let openaiAdapter = null;
  if (openaiConfig?.apiKey) {
    openaiAdapter = new OpenAIAdapter(openaiConfig, { logger });
  }
}
```

Fixed:
```javascript
// No adapter imports

export function createAIRouter({ openaiAdapter, anthropicAdapter, logger }) {
  // Use pre-built adapters
}
```

**Bot routers (homebot, nutribot, journalist):**

Move `TelegramWebhookParser` and `InputRouter` instantiation to bootstrap:

```javascript
// Bootstrap
const parser = new TelegramWebhookParser({ botId, logger });
const inputRouter = new NutribotInputRouter(container, { userResolver, logger });
const webhookHandler = createBotWebhookHandler({ parser, inputRouter, logger });

// Pass to router
const nutribotRouter = createNutribotRouter({ container, webhookHandler, logger });
```

### Priority 3: Code Quality

#### 3.1 Standardize Error Handling

Replace inline try/catch with error propagation:

Current (anti-pattern):
```javascript
router.get('/data', async (req, res) => {
  try {
    const result = await service.getData();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

Fixed:
```javascript
router.get('/data', asyncHandler(async (req, res) => {
  const result = await service.getData();
  res.json(result);
}));

// Error handler middleware at router level
router.use(errorHandlerMiddleware());
```

#### 3.2 Migrate Legacy Handler

`handlers/homebot/index.mjs` should be migrated to use `createBotWebhookHandler` pattern, removing the direct `TelegramChatRef` import.

---

## Verification Checklist

After remediation, verify:

**Import Rules:**
- [ ] No imports from `1_domains/` in any `4_api/` file
- [ ] No imports from `2_adapters/` except for type definitions
- [ ] No `configService` imports in `4_api/`
- [ ] No `new Adapter()` calls in routers
- [ ] All services received via factory parameters

**Folder Structure:**
- [ ] `v1/` folder contains routers and handlers
- [ ] `utils/` folder exists with validation helpers
- [ ] `routers/index.mjs` barrel export exists
- [ ] No version numbers in file or function names

**Patterns:**
- [ ] All handlers use factory pattern (return Express handler)
- [ ] Error handling delegated to middleware
- [ ] All tests pass
- [ ] API responses unchanged (no breaking changes)

---

## Related Documents

- `docs/reference/core/layers-of-abstraction/api-layer-guidelines.md` - Source guidelines
- `docs/_wip/audits/2026-01-26-adapter-layer-ddd-audit.md` - Adapter layer audit
- `docs/_wip/audits/2026-01-26-application-layer-ddd-audit.md` - Application layer audit
- `docs/_wip/audits/2026-01-26-domain-layer-ddd-audit.md` - Domain layer audit
