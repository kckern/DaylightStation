# API Layer DDD Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remediate DDD violations in the API layer to achieve full compliance with api-layer-guidelines.md

**Architecture:** The API layer will be restructured with versioned folders (`v1/`), centralized utils, and proper dependency injection. All domain/adapter imports will be removed from routers - services will be injected via factory parameters from bootstrap.

**Tech Stack:** Express.js routers, ES modules (.mjs), existing bootstrap pattern

---

## Pre-Requisites

Before starting, read these files to understand context:
- `docs/reference/core/layers-of-abstraction/api-layer-guidelines.md` - Target guidelines
- `docs/_wip/audits/2026-01-26-api-layer-ddd-audit.md` - Full audit with violation details
- `backend/src/0_system/bootstrap.mjs` - How routers are wired

---

## Phase 0: Folder Restructuring

### Task 0.1: Create Versioned Directory Structure

**Files:**
- Create: `backend/src/4_api/v1/` (directory)
- Create: `backend/src/4_api/utils/` (directory)

**Step 1: Create directories**

```bash
mkdir -p backend/src/4_api/v1
mkdir -p backend/src/4_api/utils
```

**Step 2: Verify directories exist**

Run: `ls -la backend/src/4_api/`
Expected: Shows `v1/` and `utils/` directories alongside existing `routers/`, `handlers/`, `middleware/`

**Step 3: Commit**

```bash
git add backend/src/4_api/v1 backend/src/4_api/utils
git commit -m "chore(api): create v1 and utils directories for DDD restructure"
```

---

### Task 0.2: Create Utils Module

**Files:**
- Create: `backend/src/4_api/utils/validation.mjs`
- Create: `backend/src/4_api/utils/responses.mjs`
- Create: `backend/src/4_api/utils/index.mjs`

**Step 1: Write validation.mjs**

```javascript
/**
 * Require a parameter from a source object
 * @param {Object} source - The source object (req.params, req.query, req.body)
 * @param {string} name - The parameter name
 * @returns {*} The parameter value
 * @throws {Error} 400 error if parameter is missing
 */
export function requireParam(source, name) {
  const value = source[name];
  if (value === undefined || value === null || value === '') {
    const error = new Error(`Missing required parameter: ${name}`);
    error.status = 400;
    throw error;
  }
  return value;
}

/**
 * Require multiple parameters from a source object
 * @param {Object} source - The source object
 * @param {string[]} names - Array of parameter names
 * @returns {Object} Object with parameter values keyed by name
 * @throws {Error} 400 error if any parameter is missing
 */
export function requireParams(source, names) {
  const result = {};
  for (const name of names) {
    result[name] = requireParam(source, name);
  }
  return result;
}
```

**Step 2: Write responses.mjs**

```javascript
/**
 * Send a success JSON response
 * @param {Object} res - Express response object
 * @param {*} data - Response data
 * @param {number} [status=200] - HTTP status code
 */
export function sendSuccess(res, data, status = 200) {
  res.status(status).json({ success: true, data });
}

/**
 * Send an error JSON response
 * @param {Object} res - Express response object
 * @param {string} message - Error message
 * @param {number} [status=500] - HTTP status code
 */
export function sendError(res, message, status = 500) {
  res.status(status).json({ success: false, error: message });
}
```

**Step 3: Write utils/index.mjs barrel export**

```javascript
export { requireParam, requireParams } from './validation.mjs';
export { sendSuccess, sendError } from './responses.mjs';
```

**Step 4: Verify files exist**

Run: `ls backend/src/4_api/utils/`
Expected: `index.mjs  responses.mjs  validation.mjs`

**Step 5: Commit**

```bash
git add backend/src/4_api/utils/
git commit -m "feat(api): add utils module with validation and response helpers"
```

---

### Task 0.3: Move Routers to v1 Directory

**Files:**
- Move: `backend/src/4_api/routers/` → `backend/src/4_api/v1/routers/`

**Step 1: Move routers directory**

```bash
mv backend/src/4_api/routers backend/src/4_api/v1/
```

**Step 2: Verify move**

Run: `ls backend/src/4_api/v1/routers/ | head -10`
Expected: Shows router files (agents.mjs, ai.mjs, apiV1.mjs, etc.)

**Step 3: Commit**

```bash
git add -A
git commit -m "refactor(api): move routers to v1 directory"
```

---

### Task 0.4: Move Handlers to v1 Directory

**Files:**
- Move: `backend/src/4_api/handlers/` → `backend/src/4_api/v1/handlers/`

**Step 1: Move handlers directory**

```bash
mv backend/src/4_api/handlers backend/src/4_api/v1/
```

**Step 2: Verify move**

Run: `ls backend/src/4_api/v1/handlers/`
Expected: Shows handler directories (nutribot/, journalist/, homebot/)

**Step 3: Commit**

```bash
git add -A
git commit -m "refactor(api): move handlers to v1 directory"
```

---

### Task 0.5: Update All Import Paths in Bootstrap

**Files:**
- Modify: `backend/src/0_system/app.mjs`
- Modify: `backend/src/0_system/bootstrap.mjs`
- Modify: Any other files importing from `4_api/routers/` or `4_api/handlers/`

**Step 1: Find all files importing from old paths**

Run: `grep -r "4_api/routers/" backend/src/ --include="*.mjs" -l`
Run: `grep -r "4_api/handlers/" backend/src/ --include="*.mjs" -l`

**Step 2: Update each file**

For each file found, update import paths:
- `../../4_api/routers/` → `../../4_api/v1/routers/`
- `../../4_api/handlers/` → `../../4_api/v1/handlers/`
- `../4_api/routers/` → `../4_api/v1/routers/`
- etc.

**Step 3: Verify no old imports remain**

Run: `grep -r "4_api/routers/" backend/src/ --include="*.mjs" | grep -v "v1/routers"`
Expected: No output (all paths should now include v1)

Run: `grep -r "4_api/handlers/" backend/src/ --include="*.mjs" | grep -v "v1/handlers"`
Expected: No output

**Step 4: Test the application starts**

Run: `cd backend && node --check src/0_system/app.mjs`
Expected: No syntax errors

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor(api): update all imports to v1 paths"
```

---

### Task 0.6: Update Internal Router Imports

**Files:**
- Modify: All files in `backend/src/4_api/v1/routers/` that import from handlers or other routers

**Step 1: Find internal cross-references**

Run: `grep -r "../handlers/" backend/src/4_api/v1/routers/ --include="*.mjs"`

**Step 2: Update relative paths**

Since routers and handlers are now siblings under `v1/`, relative paths like `../handlers/` should still work.
If any paths like `../../handlers/` exist, update to `../handlers/`.

**Step 3: Verify no broken imports**

Run: `cd backend && node --check src/4_api/v1/routers/nutribot.mjs`
Run: `cd backend && node --check src/4_api/v1/routers/journalist.mjs`
Expected: No errors

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor(api): fix internal v1 import paths"
```

---

### Task 0.7: Rename apiV1.mjs to api.mjs

**Files:**
- Rename: `backend/src/4_api/v1/routers/apiV1.mjs` → `backend/src/4_api/v1/routers/api.mjs`
- Modify: `backend/src/4_api/v1/routers/api.mjs` (rename function)
- Modify: Files importing `createApiV1Router`

**Step 1: Rename the file**

```bash
mv backend/src/4_api/v1/routers/apiV1.mjs backend/src/4_api/v1/routers/api.mjs
```

**Step 2: Update function name in the file**

In `backend/src/4_api/v1/routers/api.mjs`, change:
- `export function createApiV1Router(` → `export function createApiRouter(`

**Step 3: Find and update all imports**

Run: `grep -r "createApiV1Router" backend/src/ --include="*.mjs" -l`

For each file, update:
- `import { createApiV1Router }` → `import { createApiRouter }`
- `apiV1.mjs` → `api.mjs` in import path
- `createApiV1Router(` → `createApiRouter(` in usage

**Step 4: Verify no old references remain**

Run: `grep -r "apiV1" backend/src/ --include="*.mjs"`
Expected: No matches for `createApiV1Router` or `apiV1.mjs`

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor(api): rename apiV1.mjs to api.mjs (version is folder not name)"
```

---

### Task 0.8: Create Router Barrel Export

**Files:**
- Create: `backend/src/4_api/v1/routers/index.mjs`

**Step 1: List all router exports**

Run: `ls backend/src/4_api/v1/routers/*.mjs | xargs -I {} basename {} .mjs | grep -v index`

**Step 2: Write the barrel export**

```javascript
// Core API
export { createApiRouter } from './api.mjs';
export { createHealthRouter } from './health.mjs';
export { createStaticRouter } from './static.mjs';

// Domain routers
export { createAgentsRouter } from './agents.mjs';
export { createAIRouter } from './ai.mjs';
export { createCalendarRouter } from './calendar.mjs';
export { createContentRouter } from './content.mjs';
export { createEntropyRouter } from './entropy.mjs';
export { createExternalProxyRouter } from './externalProxy.mjs';
export { createFinanceRouter } from './finance.mjs';
export { createFitnessRouter } from './fitness.mjs';
export { createGratitudeRouter } from './gratitude.mjs';
export { createHarvestRouter } from './harvest.mjs';
export { createHomeAutomationRouter } from './homeAutomation.mjs';
export { createHomebotRouter } from './homebot.mjs';
export { createItemRouter } from './item.mjs';
export { createJournalingRouter } from './journaling.mjs';
export { createJournalistRouter } from './journalist.mjs';
export { createLifelogRouter } from './lifelog.mjs';
export { createListRouter } from './list.mjs';
export { createLocalContentRouter } from './localContent.mjs';
export { createMessagingRouter } from './messaging.mjs';
export { createNutribotRouter } from './nutribot.mjs';
export { createNutritionRouter } from './nutrition.mjs';
export { createPlayRouter } from './play.mjs';
export { createPrinterRouter } from './printer.mjs';
export { createProxyRouter } from './proxy.mjs';
export { createSchedulingRouter } from './scheduling.mjs';
export { createTTSRouter } from './tts.mjs';

// Admin routers
export { createEventbusRouter } from './admin/eventbus.mjs';
export { createLegacyRouter } from './admin/legacy.mjs';
```

**Note:** Verify exact export names by checking each file. The above is based on naming convention.

**Step 3: Verify barrel export works**

Run: `cd backend && node --check src/4_api/v1/routers/index.mjs`
Expected: No errors

**Step 4: Commit**

```bash
git add backend/src/4_api/v1/routers/index.mjs
git commit -m "feat(api): add router barrel export"
```

---

## Phase 1: Critical Import Violations

### Task 1.1: Fix journaling.mjs Domain Imports

**Files:**
- Modify: `backend/src/4_api/v1/routers/journaling.mjs`
- Modify: `backend/src/0_system/bootstrap.mjs` (or relevant bootstrap file)

**Step 1: Read current journaling.mjs**

Run: `head -50 backend/src/4_api/v1/routers/journaling.mjs`

**Step 2: Identify domain/adapter imports to remove**

Look for imports like:
```javascript
import { JournalService } from '../../1_domains/journaling/services/JournalService.mjs';
import { YamlJournalDatastore } from '../../2_adapters/persistence/yaml/YamlJournalDatastore.mjs';
```

**Step 3: Update router to receive pre-built service**

Remove domain/adapter imports. Update factory signature:

```javascript
/**
 * Create journaling API router
 * @param {Object} config
 * @param {Object} config.journalService - Pre-built JournalService instance
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createJournalingRouter({ journalService, logger }) {
  const router = express.Router();
  // Use journalService directly (already built)
  // Remove any `new YamlJournalDatastore()` or `new JournalService()` calls
  // ...
  return router;
}
```

**Step 4: Update bootstrap to create and inject the service**

In `backend/src/0_system/bootstrap.mjs`, find where journaling router is created and update:

```javascript
import { JournalService } from '../1_domains/journaling/services/JournalService.mjs';
import { YamlJournalDatastore } from '../2_adapters/persistence/yaml/YamlJournalDatastore.mjs';

// In the bootstrap function:
const journalStore = new YamlJournalDatastore({ dataRoot });
const journalService = new JournalService({ journalStore });
const journalingRouter = createJournalingRouter({ journalService, logger });
```

**Step 5: Verify no domain imports in router**

Run: `grep -E "1_domains|2_adapters" backend/src/4_api/v1/routers/journaling.mjs`
Expected: No output

**Step 6: Test router creation**

Run: `cd backend && node --check src/4_api/v1/routers/journaling.mjs`
Expected: No errors

**Step 7: Commit**

```bash
git add backend/src/4_api/v1/routers/journaling.mjs backend/src/0_system/bootstrap.mjs
git commit -m "refactor(journaling): inject JournalService instead of importing domain"
```

---

### Task 1.2: Fix nutrition.mjs Domain Imports

**Files:**
- Modify: `backend/src/4_api/v1/routers/nutrition.mjs`
- Modify: `backend/src/0_system/bootstrap.mjs`

**Step 1: Read current nutrition.mjs**

Run: `head -50 backend/src/4_api/v1/routers/nutrition.mjs`

**Step 2: Update router to receive pre-built service**

Remove imports from `1_domains` and `2_adapters`. Update factory:

```javascript
/**
 * Create nutrition API router
 * @param {Object} config
 * @param {Object} config.foodLogService - Pre-built FoodLogService instance
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createNutritionRouter({ foodLogService, logger }) {
  const router = express.Router();
  // Use foodLogService directly
  return router;
}
```

**Step 3: Update bootstrap**

```javascript
import { FoodLogService } from '../1_domains/nutrition/services/FoodLogService.mjs';
import { YamlFoodLogDatastore } from '../2_adapters/persistence/yaml/YamlFoodLogDatastore.mjs';

const foodLogStore = new YamlFoodLogDatastore({ dataRoot });
const foodLogService = new FoodLogService({ foodLogStore });
const nutritionRouter = createNutritionRouter({ foodLogService, logger });
```

**Step 4: Verify no domain imports in router**

Run: `grep -E "1_domains|2_adapters" backend/src/4_api/v1/routers/nutrition.mjs`
Expected: No output

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/nutrition.mjs backend/src/0_system/bootstrap.mjs
git commit -m "refactor(nutrition): inject FoodLogService instead of importing domain"
```

---

### Task 1.3: Fix play.mjs WatchState Import

**Files:**
- Modify: `backend/src/4_api/v1/routers/play.mjs`

**Step 1: Read current play.mjs**

Run: `head -30 backend/src/4_api/v1/routers/play.mjs`

**Step 2: Analyze WatchState usage**

Check how WatchState is used. If it's used for:
- Type checking: Remove and use duck typing
- Constants/enums: Extract to a shared types file or pass via config
- Instance creation: Should come from use case results

**Step 3: Remove WatchState import**

Replace `WatchState` usage with plain objects returned from use cases, or pass any needed constants via factory config.

**Step 4: Verify no domain imports**

Run: `grep -E "1_domains" backend/src/4_api/v1/routers/play.mjs`
Expected: No output

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/play.mjs
git commit -m "refactor(play): remove WatchState domain entity import"
```

---

### Task 1.4: Fix content.mjs WatchState Import

**Files:**
- Modify: `backend/src/4_api/v1/routers/content.mjs`

**Step 1: Read current content.mjs**

Run: `head -30 backend/src/4_api/v1/routers/content.mjs`

**Step 2: Apply same fix as play.mjs**

Remove `WatchState` import and refactor usage.

**Step 3: Verify no domain imports**

Run: `grep -E "1_domains" backend/src/4_api/v1/routers/content.mjs`
Expected: No output

**Step 4: Commit**

```bash
git add backend/src/4_api/v1/routers/content.mjs
git commit -m "refactor(content): remove WatchState domain entity import"
```

---

### Task 1.5: Fix ai.mjs Adapter Instantiation

**Files:**
- Modify: `backend/src/4_api/v1/routers/ai.mjs`
- Modify: `backend/src/0_system/bootstrap.mjs`

**Step 1: Read current ai.mjs**

Run: `head -60 backend/src/4_api/v1/routers/ai.mjs`

**Step 2: Update router to receive pre-built adapters**

```javascript
/**
 * Create AI API router
 * @param {Object} config
 * @param {Object} [config.openaiAdapter] - Pre-built OpenAI adapter (optional)
 * @param {Object} [config.anthropicAdapter] - Pre-built Anthropic adapter (optional)
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createAIRouter({ openaiAdapter, anthropicAdapter, logger }) {
  const router = express.Router();
  // Use injected adapters directly - no `new OpenAIAdapter()` calls
  return router;
}
```

**Step 3: Move adapter instantiation to bootstrap**

```javascript
import { OpenAIAdapter } from '../2_adapters/ai/OpenAIAdapter.mjs';
import { AnthropicAdapter } from '../2_adapters/ai/AnthropicAdapter.mjs';

// In bootstrap:
const openaiAdapter = openaiConfig?.apiKey
  ? new OpenAIAdapter(openaiConfig, { logger })
  : null;
const anthropicAdapter = anthropicConfig?.apiKey
  ? new AnthropicAdapter(anthropicConfig, { logger })
  : null;

const aiRouter = createAIRouter({ openaiAdapter, anthropicAdapter, logger });
```

**Step 4: Verify no adapter imports in router**

Run: `grep -E "2_adapters|new.*Adapter" backend/src/4_api/v1/routers/ai.mjs`
Expected: No output

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/ai.mjs backend/src/0_system/bootstrap.mjs
git commit -m "refactor(ai): inject adapters instead of instantiating in router"
```

---

### Task 1.6: Fix Bot Routers (homebot, nutribot, journalist)

**Files:**
- Modify: `backend/src/4_api/v1/routers/homebot.mjs`
- Modify: `backend/src/4_api/v1/routers/nutribot.mjs`
- Modify: `backend/src/4_api/v1/routers/journalist.mjs`
- Modify: `backend/src/0_system/bootstrap.mjs`

**Step 1: Read current bot routers**

Run: `head -60 backend/src/4_api/v1/routers/homebot.mjs`
Run: `head -60 backend/src/4_api/v1/routers/nutribot.mjs`
Run: `head -60 backend/src/4_api/v1/routers/journalist.mjs`

**Step 2: Update each router to receive pre-built components**

For each bot router, update to receive:
- Pre-built `TelegramWebhookParser` instance
- Pre-built `InputRouter` instance (HomeBotInputRouter, NutribotInputRouter, etc.)

Example for nutribot:
```javascript
/**
 * Create nutribot API router
 * @param {Object} config
 * @param {Object} config.container - Nutribot DI container
 * @param {Object} config.webhookParser - Pre-built TelegramWebhookParser
 * @param {Object} config.inputRouter - Pre-built NutribotInputRouter
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createNutribotRouter({ container, webhookParser, inputRouter, logger }) {
  // Use injected components - no `new TelegramWebhookParser()` calls
}
```

**Step 3: Move instantiation to bootstrap**

For each bot:
```javascript
// In bootstrap
const nutribotParser = new TelegramWebhookParser({ botId: nutribotId, logger });
const nutribotInputRouter = new NutribotInputRouter(container, { userResolver, logger });
const nutribotRouter = createNutribotRouter({
  container,
  webhookParser: nutribotParser,
  inputRouter: nutribotInputRouter,
  logger
});
```

**Step 4: Verify no adapter imports in routers**

Run: `grep -E "2_adapters|new.*Parser|new.*Router" backend/src/4_api/v1/routers/homebot.mjs`
Run: `grep -E "2_adapters|new.*Parser|new.*Router" backend/src/4_api/v1/routers/nutribot.mjs`
Run: `grep -E "2_adapters|new.*Parser|new.*Router" backend/src/4_api/v1/routers/journalist.mjs`
Expected: No output for all three

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/homebot.mjs backend/src/4_api/v1/routers/nutribot.mjs backend/src/4_api/v1/routers/journalist.mjs backend/src/0_system/bootstrap.mjs
git commit -m "refactor(bots): inject webhook parsers and input routers"
```

---

### Task 1.7: Fix configService Imports

**Files:**
- Modify: `backend/src/4_api/v1/routers/api.mjs` (formerly apiV1.mjs)
- Modify: `backend/src/4_api/v1/routers/item.mjs`
- Modify: `backend/src/0_system/bootstrap.mjs`

**Step 1: Read current files**

Run: `grep -n "configService" backend/src/4_api/v1/routers/api.mjs`
Run: `grep -n "configService" backend/src/4_api/v1/routers/item.mjs`

**Step 2: Update routers to receive config values as parameters**

For api.mjs:
```javascript
export function createApiRouter({ safeConfig, ...otherDeps }) {
  // ...
  res.json({ config: safeConfig }); // Instead of configService.getSafeConfig()
}
```

For item.mjs:
```javascript
export function createItemRouter({ configValues, ...otherDeps }) {
  // Use configValues instead of configService
}
```

**Step 3: Update bootstrap to pass config values**

```javascript
const safeConfig = configService.getSafeConfig();
const apiRouter = createApiRouter({ safeConfig, ...otherDeps });
```

**Step 4: Verify no configService imports in routers**

Run: `grep -E "configService|0_system/config" backend/src/4_api/v1/routers/api.mjs`
Run: `grep -E "configService|0_system/config" backend/src/4_api/v1/routers/item.mjs`
Expected: No output

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/api.mjs backend/src/4_api/v1/routers/item.mjs backend/src/0_system/bootstrap.mjs
git commit -m "refactor(api): pass config values instead of importing configService"
```

---

## Phase 2: Code Quality Improvements

### Task 2.1: Fix Handler Factory Pattern in morning.mjs

**Files:**
- Modify: `backend/src/4_api/v1/handlers/journalist/morning.mjs`
- Modify: `backend/src/4_api/v1/handlers/journalist/index.mjs` (update export)

**Step 1: Read current morning.mjs**

Run: `cat backend/src/4_api/v1/handlers/journalist/morning.mjs`

**Step 2: Convert to factory pattern**

Current (BAD):
```javascript
export async function handleMorningDebrief(deps, username, date = null) {
  // Direct function - not a factory
}
```

Fixed (GOOD):
```javascript
/**
 * Create morning debrief handler
 * @param {Object} deps - Dependencies
 * @returns {Function} Express handler
 */
export function journalistMorningDebriefHandler(deps) {
  return async (req, res) => {
    const { username } = req.params;
    const date = req.query.date || null;

    // Implementation using deps
    // ...

    res.json(result);
  };
}
```

**Step 3: Update barrel export if needed**

In `backend/src/4_api/v1/handlers/journalist/index.mjs`:
```javascript
export { journalistMorningDebriefHandler } from './morning.mjs';
```

**Step 4: Update any callers**

Find where `handleMorningDebrief` is called and update to use factory pattern.

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/handlers/journalist/
git commit -m "refactor(journalist): convert morning handler to factory pattern"
```

---

### Task 2.2: Fix Handler Adapter Import in homebot

**Files:**
- Modify: `backend/src/4_api/v1/handlers/homebot/index.mjs`

**Step 1: Read current file**

Run: `cat backend/src/4_api/v1/handlers/homebot/index.mjs`

**Step 2: Remove TelegramChatRef import**

If `TelegramChatRef` is used for type checking, remove it.
If it's used for instantiation, that should be done in bootstrap.

**Step 3: Verify no adapter imports**

Run: `grep -E "2_adapters" backend/src/4_api/v1/handlers/homebot/index.mjs`
Expected: No output

**Step 4: Commit**

```bash
git add backend/src/4_api/v1/handlers/homebot/index.mjs
git commit -m "refactor(homebot): remove adapter import from handler"
```

---

## Phase 3: Verification

### Task 3.1: Run Full Compliance Check

**Step 1: Check for domain imports in API layer**

Run: `grep -r "1_domains" backend/src/4_api/ --include="*.mjs"`
Expected: No output

**Step 2: Check for adapter imports in API layer**

Run: `grep -r "2_adapters" backend/src/4_api/ --include="*.mjs" | grep -v "// allowed"`
Expected: No output (or only allowed type imports with comment)

**Step 3: Check for configService imports**

Run: `grep -r "configService" backend/src/4_api/ --include="*.mjs"`
Expected: No output

**Step 4: Check for inline adapter instantiation**

Run: `grep -r "new.*Adapter\|new.*Parser\|new.*Router\|new.*Service" backend/src/4_api/ --include="*.mjs"`
Expected: No output

**Step 5: Check folder structure**

Run: `find backend/src/4_api -type d | sort`
Expected output:
```
backend/src/4_api
backend/src/4_api/middleware
backend/src/4_api/utils
backend/src/4_api/v1
backend/src/4_api/v1/handlers
backend/src/4_api/v1/handlers/homebot
backend/src/4_api/v1/handlers/journalist
backend/src/4_api/v1/handlers/nutribot
backend/src/4_api/v1/routers
backend/src/4_api/v1/routers/admin
```

**Step 6: Check barrel exports exist**

Run: `ls backend/src/4_api/v1/routers/index.mjs backend/src/4_api/utils/index.mjs`
Expected: Both files exist

---

### Task 3.2: Run Application Tests

**Step 1: Run backend tests**

Run: `cd backend && npm test`
Expected: All tests pass

**Step 2: Start the dev server and verify API responds**

Run: `cd backend && timeout 10 node src/0_system/app.mjs || true`
Expected: Server starts without errors

**Step 3: Commit verification results**

```bash
git add docs/_wip/audits/
git commit -m "docs: mark API layer audit as remediated"
```

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| 0 | 0.1-0.8 | Folder restructuring (v1/, utils/, barrel exports, rename apiV1) |
| 1 | 1.1-1.7 | Critical import violations (domain, adapter, config imports) |
| 2 | 2.1-2.2 | Code quality (handler patterns, legacy cleanup) |
| 3 | 3.1-3.2 | Verification and testing |

**Total tasks:** 17
**Estimated commits:** 17 (one per task)

After all tasks complete, the API layer will be fully compliant with `api-layer-guidelines.md`.
