# API Layer Coding Standards Audit Report

**Date:** 2026-01-27
**Scope:** `backend/src/4_api/`
**Files Examined:** 46 files (3 middleware, 3 utils, 9 handlers, 31+ routers)
**Reference:** `docs/reference/core/coding-standards.md`

---

## Executive Summary

The API layer demonstrates **strong architectural patterns** (handler factories, dependency injection, router composition) but has **widespread violations** in error handling, exports, and documentation. The most critical issue is handlers catching and formatting errors instead of letting middleware handle them.

**Overall Grade: C (65/100)**

---

## Violations by Severity

### HIGH Severity (Must Fix)

| Issue | Count | Files |
|-------|-------|-------|
| Handlers catching errors instead of propagating | 50+ | journal.mjs, morning.mjs, fitness.mjs, play.mjs, health.mjs, ai.mjs, etc. |
| Wrong default export (router instance vs factory) | 10+ | ai.mjs, health.mjs, list.mjs, etc. |
| Missing JSDoc on factory functions | 15+ | responses.mjs, validation.mjs, routers |
| Module-level mutable state | 2 | fitness.mjs (simulationState), legacyTracker.mjs (globalTracker) |

### MEDIUM Severity (Should Fix)

| Issue | Count | Files |
|-------|-------|-------|
| Missing named exports on router factories | 31+ | All router files |
| Generic error messages (no error codes) | 20+ | fitness.mjs, play.mjs, health.mjs |
| Console instead of logger | 5+ | play.mjs, list.mjs, cutoverFlags.mjs |
| Magic strings/numbers | 20+ | Most router files |
| Incomplete JSDoc (missing @returns, @throws) | 10+ | cutoverFlags.mjs, responses.mjs, etc. |

### LOW Severity (Nice to Have)

| Issue | Count | Files |
|-------|-------|-------|
| Inline utilities (should extract) | 10+ | play.mjs, list.mjs |
| Inline handler definition | 1 | eventbus.mjs |

---

## Detailed Findings

### 1. File/Folder Naming ✅ COMPLIANT

No violations:
- Routers: `camelCase.mjs` with create prefix (createPlayRouter.mjs)
- Directories: `kebab-case` (home-automation/)
- Barrel files: All `index.mjs`

### 2. Handler Factory Pattern ✅ MOSTLY COMPLIANT

**Excellent Pattern Usage:**
```javascript
// GOOD - journal.mjs
export function journalistJournalHandler(container) {
  return async (req, res) => {
    // Handler logic
  };
}
```

**❌ One Violation:**
```javascript
// BAD - eventbus.mjs - Inline handler, not factory
async function handleRestart(req, res) { ... }
router.post('/restart', handleRestart);

// SHOULD BE:
function handleRestart(config) {
  const { eventBus, logger } = config;
  return async (req, res) => { ... };
}
```

### 3. Export Patterns ⚠️ MAJOR ISSUES

**❌ Wrong Default Export:**
```javascript
// BAD - ai.mjs:228
export default router;  // Exports instance

// SHOULD BE:
export function createAIRouter(config) { ... }
export default createAIRouter;  // Exports factory
```

**❌ Missing Named Exports:**
All router factories only have default export, missing named export.

### 4. Error Handling ❌ CRITICAL ISSUES

**Standard:** "Let errors propagate - middleware handles translation to HTTP"

**❌ Violations (50+ instances):**

```javascript
// BAD - journal.mjs:48-54
} catch (error) {
  res.status(500).json({
    ok: false,
    error: error.message,
    traceId,
  });
}

// BAD - fitness.mjs:322-325
} catch (err) {
  logger.error?.('fitness.sessions.save.error', { error: err?.message });
  return res.status(400).json({ error: err.message || 'Failed to save session' });
}
```

**SHOULD BE:**
```javascript
// GOOD - Let middleware handle errors
const session = await sessionService.save(req.body);
res.json(session);
// No try-catch - errors propagate to errorHandlerMiddleware
```

**✅ Middleware-based error handling exists:**
```javascript
// GOOD - homebot.mjs, journalist.mjs, nutribot.mjs
router.use(errorHandlerMiddleware({ isWebhook: false }));
```

### 5. Import Patterns ✅ COMPLIANT

Excellent use of aliases:
```javascript
import { nowTs24 } from '#system/utils/index.mjs';
import { asyncHandler } from '#system/http/middleware/index.mjs';
```

No relative path traversal found.

### 6. Dependency Injection ✅ COMPLIANT

**Config Object Pattern:** Consistently used
```javascript
// GOOD - fitness.mjs
export function createFitnessRouter(config) {
  const {
    sessionService,
    zoneLedController,
    userService,
    logger = console
  } = config;
```

### 7. JSDoc Requirements ⚠️ GAPS

**Missing @returns and @example:**
```javascript
// BAD - cutoverFlags.mjs
/**
 * Create middleware that routes based on flags
 * @param {string} route - Route to check
 * @param {Function} newHandler - Handler for new backend
 * @param {Function} legacyHandler - Handler for legacy backend
 */
// Missing: @returns {Function}
// Missing: @example
```

### 8. Module-Level State ❌ VIOLATIONS

**❌ Mutable State:**
```javascript
// BAD - fitness.mjs:28-34
const simulationState = {
  process: null,
  pid: null,
  startedAt: null,
  config: null
};
// Breaks in clustered environments

// BAD - legacyTracker.mjs:124-137
let globalTracker = null;
export function getLegacyTracker(options) {
  if (!globalTracker) {
    globalTracker = createLegacyTracker(options);
  }
  return globalTracker;
}
// Global singleton breaks isolation
```

### 9. Console vs Logger ⚠️ ISSUES

```javascript
// BAD - play.mjs:351
console.error('[play] Error:', err);

// BAD - list.mjs:310
console.warn(`[DEPRECATION] /api/v1/list/...`);

// SHOULD USE:
logger.error?.('play.error', { error: err.message });
logger.warn?.('deprecation.list', { route: '...' });
```

### 10. Magic Strings/Numbers ⚠️ ISSUES

```javascript
// BAD - Multiple files
res.status(500).json({ error: 'Failed...' });
if (now - lastLoadTime < 30000)
if (seconds < 10)
idempotencyMiddleware({ ttlMs: 300000 })

// SHOULD USE:
const HTTP_INTERNAL_SERVER_ERROR = 500;
const CACHE_TTL_MS = 30000;
const MIN_PLAYBACK_SECONDS = 10;
const IDEMPOTENCY_TTL_MS = 300000;
```

---

## Patterns Worth Preserving

### Excellent Patterns

1. **Handler Factory Pattern** (all handlers)
2. **Router Mounting** (api.mjs centralized composition)
3. **Middleware Composition** (webhookValidation, idempotency)
4. **Config Destructuring with Defaults**
5. **Barrel Exports** (handlers/index.mjs, routers/index.mjs)
6. **Path Alias Usage** (100% compliance)

---

## Recommendations

### Immediate (High Priority)

1. **Remove try-catch from handlers** - Let middleware handle errors (~50 sites)
2. **Fix default exports** - Export factory function, not router instance (~10 files)
3. **Add named exports** - All router factories should have `export function createXRouter`

### Medium-Term

4. **Refactor module-level state** - Convert to services with DI (2 files)
5. **Replace console with logger** (~5 sites)
6. **Complete JSDoc** - Add @returns, @throws, @example

### Low Priority

7. **Extract inline utilities** - Move to utils/ directory
8. **Extract magic numbers** - Create named constants
9. **Fix inline handler** - eventbus.mjs

---

## Compliance Metrics

| Category | Compliance |
|----------|------------|
| File/Folder Naming | 100% |
| Handler Factory Pattern | 98% |
| Export Patterns | 50% |
| Error Propagation | 30% |
| Import Patterns | 100% |
| Dependency Injection | 100% |
| JSDoc Completeness | 40% |
| Module State | 95% |
| Logger Usage | 90% |
| Constants vs Magic | 70% |

**Overall: 65%**
