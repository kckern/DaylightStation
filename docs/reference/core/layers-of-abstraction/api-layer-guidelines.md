# API Layer Guidelines

> Guidelines for `backend/src/4_api/` - the HTTP translation layer in DDD architecture.

---

## Core Principle

**The API layer translates HTTP requests into application layer calls and formats responses. It contains no business logic and no wiring.**

The API layer is a driving adapter - it drives the application from HTTP. Its only job is translation:
- Parse HTTP request → call use case → format HTTP response
- Handle HTTP-specific concerns (status codes, headers, content types)
- Apply HTTP middleware (auth, logging, rate limiting)

**The Thin Layer Test:** If your router or handler contains business logic, validation rules, or instantiates adapters, it doesn't belong in the API layer.

**What the API layer does NOT know:**
- How entities are structured or validated (domain layer)
- What external services exist (adapters layer)
- How dependencies are wired together (bootstrap)
- Business rules or workflows (application layer)

| Layer | Responsibility |
|-------|----------------|
| **API (4_api)** | HTTP ↔ application translation |
| **Application (3_applications)** | Orchestrates use cases via containers |
| **Adapters (2_adapters)** | External system integration |
| **Domain (1_domains)** | Pure business logic |
| **System (0_system)** | Runtime utilities, bootstrap wiring |

---

## Import Rules

### ALLOWED imports in `4_api/`

| Source | Examples |
|--------|----------|
| `0_system/utils/` | `nowTs()`, `shortId()`, pure utilities |
| `0_system/http/middleware/` | `tracingMiddleware`, `errorHandlerMiddleware` |
| `4_api/utils/` | Layer-specific HTTP helpers |
| `4_api/middleware/` | Layer-specific middleware |

### FORBIDDEN imports in `4_api/`

| Forbidden | Why | Instead |
|-----------|-----|---------|
| `3_applications/*` | Containers are injected | Receive via factory params |
| `2_adapters/*` | Webhook handlers, parsers are injected | Receive via factory params |
| `1_domains/*` | API has no domain knowledge | Work with plain objects from use cases |
| `0_system/config/` | Config values come from bootstrap | Receive resolved values via params |

### The Injection Rule

Everything except system utilities comes through the factory function:

```javascript
// BAD - router imports and instantiates adapter
import { TelegramWebhookParser } from '../../2_adapters/telegram/index.mjs';
const parser = new TelegramWebhookParser({ botId });

// GOOD - router receives pre-built handler
export function createNutribotRouter({ container, webhookHandler, logger }) {
  // webhookHandler already has parser wired in
}
```

**Bootstrap is the only place where layers meet.** This applies to API layer wiring just as it does for application→adapter wiring.

---

## File Structure

```
4_api/
├── v1/
│   ├── routers/              # Express routers
│   │   ├── nutribot.mjs
│   │   ├── journalist.mjs
│   │   └── index.mjs         # Barrel exports
│   └── handlers/             # Request handlers by domain
│       ├── nutribot/
│       │   ├── report.mjs
│       │   ├── directInput.mjs
│       │   └── index.mjs
│       ├── journalist/
│       │   └── ...
│       └── index.mjs
├── v2/                       # Created when needed
│   ├── routers/
│   │   └── index.mjs         # Re-exports unchanged from v1
│   └── handlers/
├── utils/                    # Shared across versions
│   ├── validation.mjs
│   ├── responses.mjs
│   └── index.mjs
├── middleware/               # Layer-specific middleware
└── webhook-server.mjs        # Version-agnostic webhook server
```

---

## Versioning Strategy

**Version is a folder, not a name.** Routers and handlers never contain version numbers.

### Principles

- Routers are **resources**, not versions
- Versioning logic lives in **bootstrap**, not in 4_api
- Unchanged routers are **re-exported** from v1 into v2
- Only create v2 files for endpoints that **actually change**

### v2 Re-export Pattern

```javascript
// 4_api/v2/routers/index.mjs
export { createNutribotRouter } from './nutribot.mjs';           // v2 version (changed)
export { createJournalistRouter } from '../../v1/routers/journalist.mjs'; // reuse v1
```

### Bootstrap Mounting

```javascript
import * as v1 from './4_api/v1/routers/index.mjs';
import * as v2 from './4_api/v2/routers/index.mjs';

app.use('/api/v1', createApiRouter({ routerFactories: v1 }));
app.use('/api/v2', createApiRouter({ routerFactories: v2 }));
```

---

## Router Patterns

### Factory Signature

Routers use a deps object pattern - all dependencies passed as named properties:

```javascript
/**
 * Create NutriBot Express Router
 * @param {Object} deps
 * @param {Object} deps.container - NutribotContainer instance
 * @param {Function} deps.webhookHandler - Pre-built webhook handler from bootstrap
 * @param {Object} [deps.logger] - Logger instance
 * @returns {Router}
 */
export function createNutribotRouter(deps) {
  const { container, webhookHandler, logger = console } = deps;
  const router = Router();

  // ... mount routes

  return router;
}
```

### Router Responsibilities

| Do | Don't |
|----|-------|
| Mount handlers at endpoints | Instantiate adapters |
| Apply middleware to routes | Contain business logic |
| Configure route-level options | Import from adapters or applications |
| Return configured Express Router | Access config directly |

### Standard Router Structure

```javascript
export function createExampleRouter(deps) {
  const { container, logger = console } = deps;
  const router = Router();

  // 1. Apply middleware
  router.use(tracingMiddleware());
  router.use(requestLoggerMiddleware({ logBody: false }));

  // 2. Mount handlers
  router.get('/report', asyncHandler(exampleReportHandler({ container, logger })));
  router.post('/create', asyncHandler(exampleCreateHandler({ container, logger })));

  // 3. Health check (optional)
  router.get('/health', (req, res) => res.json({ status: 'ok' }));

  // 4. Apply error handler
  router.use(errorHandlerMiddleware());

  return router;
}
```

---

## Handler Patterns

### Factory Pattern (Always)

Handlers are always factory functions that return Express handlers:

```javascript
/**
 * Create report handler
 * @param {Object} deps
 * @param {Object} deps.container - NutribotContainer instance
 * @param {Object} [deps.logger] - Logger instance
 * @returns {Function} Express handler
 */
export function nutribotReportHandler(deps) {
  const { container, logger = console } = deps;

  return async (req, res) => {
    const { userId, date } = req.query;

    const useCase = container.getGenerateReport();
    const result = await useCase.execute({ userId, date });

    res.json(result);
  };
}
```

### Handler Responsibilities

| Do | Don't |
|----|-------|
| Extract data from request | Contain business logic |
| Call use cases from container | Catch and swallow errors |
| Format successful responses | Import from adapters or domains |
| Log request metadata | Instantiate services |

### Naming Convention

**`{domain}{Action}Handler`**

| Good | Bad |
|------|-----|
| `nutribotReportHandler` | `getReport` |
| `journalistTriggerHandler` | `handleTrigger` |
| `fitnessSessionCreateHandler` | `createSessionHandler` |

### Error Handling

Handlers let errors propagate. Middleware handles translation:

```javascript
// GOOD - let errors propagate
export function exampleHandler(deps) {
  const { container, logger } = deps;

  return async (req, res) => {
    // No try/catch - errorHandlerMiddleware catches
    const result = await container.getUseCase().execute(req.body);
    res.json(result);
  };
}

// BAD - swallowing errors
return async (req, res) => {
  try {
    const result = await container.getUseCase().execute(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message }); // Don't do this
  }
};
```

---

## HTTP Utilities

Shared HTTP helpers live in `4_api/utils/`. These are opt-in - handlers import what they need.

### Location

```
4_api/utils/
├── validation.mjs    # Request validation helpers
├── responses.mjs     # Response formatting helpers
└── index.mjs         # Barrel exports
```

### Validation Helpers

```javascript
// 4_api/utils/validation.mjs

/**
 * Extract required parameter or throw
 * @param {Object} source - req.query, req.body, or req.params
 * @param {string} name - Parameter name
 * @returns {string} Parameter value
 * @throws {Error} If parameter missing
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
```

### Response Helpers (Optional)

```javascript
// 4_api/utils/responses.mjs

/**
 * Send paginated response
 */
export function sendPaginated(res, { items, total, page, pageSize }) {
  res.json({
    items,
    pagination: { total, page, pageSize, pages: Math.ceil(total / pageSize) }
  });
}
```

---

## Middleware

### Shared Middleware (0_system/http/middleware/)

Cross-cutting concerns that apply broadly:

- `tracingMiddleware` - Request tracing
- `requestLoggerMiddleware` - Request logging
- `errorHandlerMiddleware` - Error → HTTP status mapping
- `asyncHandler` - Async error wrapper

### Layer-Specific Middleware (4_api/middleware/)

Concerns specific to API layer evolution:

- `cutoverFlags.mjs` - Feature flags for migration
- `legacyTracker.mjs` - Track legacy endpoint usage

---

## Anti-Patterns Summary

| Anti-Pattern | Example | Fix |
|--------------|---------|-----|
| **Adapter import** | `import { TelegramWebhookParser } from '2_adapters/...'` | Receive via factory params |
| **Container import** | `import { NutribotContainer } from '3_applications/...'` | Receive via factory params |
| **Domain import** | `import { Session } from '1_domains/...'` | Work with plain objects |
| **Instantiating adapters** | `new YamlJournalDatastore({ dataRoot })` | Bootstrap wires, router receives |
| **Business logic in handler** | `if (calories > 2000) grade = 'F'` | Move to domain or use case |
| **Config access** | `configService.get('nutribot.botId')` | Receive resolved values via params |
| **Swallowed errors** | `catch (e) { res.status(500).json({...}) }` | Let errors propagate to middleware |
| **Version in names** | `createApiV1Router`, `nutribotV2Handler` | Use folder structure for versions |
| **Direct handler export** | `export async function handle(req, res)` | Factory pattern: `export function handler(deps) { return async (req, res) => ... }` |
| **Positional factory args** | `createRouter(container, logger, options)` | Deps object: `createRouter({ container, logger, ...options })` |

---

## JSDoc Conventions

### Router Factory

```javascript
/**
 * Create Example Express Router
 *
 * @param {Object} deps
 * @param {Object} deps.container - ExampleContainer instance
 * @param {Function} [deps.webhookHandler] - Pre-built webhook handler
 * @param {Object} [deps.logger] - Logger instance
 * @returns {import('express').Router}
 */
export function createExampleRouter(deps) {
```

### Handler Factory

```javascript
/**
 * Create report handler
 *
 * @param {Object} deps
 * @param {Object} deps.container - ExampleContainer instance
 * @param {Object} [deps.logger] - Logger instance
 * @returns {Function} Express request handler
 */
export function exampleReportHandler(deps) {
```

---

## Quick Reference

### Layer Boundaries

| API Layer KNOWS | API Layer DOES NOT KNOW |
|-----------------|-------------------------|
| HTTP verbs, status codes, headers | Domain entities, validation rules |
| Request/response formats | How adapters work internally |
| Which use case to call | How dependencies are wired |
| Route paths and middleware | Business logic or workflows |

### File Naming

| Type | Pattern | Examples |
|------|---------|----------|
| Routers | `{domain}.mjs` | `nutribot.mjs`, `journalist.mjs` |
| Handlers | `{resource}.mjs` | `report.mjs`, `directInput.mjs` |
| Handler functions | `{domain}{Action}Handler` | `nutribotReportHandler`, `journalistTriggerHandler` |
| Router factories | `create{Domain}Router` | `createNutribotRouter`, `createJournalistRouter` |

### Import Cheat Sheet

```javascript
// ✅ ALLOWED
import { nowTs } from '#system/utils/index.mjs';
import { tracingMiddleware } from '#system/http/middleware/index.mjs';
import { requireParam } from '../utils/validation.mjs';

// ❌ FORBIDDEN
import { TelegramWebhookParser } from '#adapters/telegram/index.mjs';
import { NutribotContainer } from '#applications/nutribot/NutribotContainer.mjs';
import { Session } from '#domains/fitness/index.mjs';
```

### Dependency Flow

```
Bootstrap
    │
    ├── Creates adapters (TelegramWebhookParser, etc.)
    ├── Creates containers (NutribotContainer, etc.)
    ├── Wires webhook handlers
    │
    └── Passes to router factories
            │
            └── Routers mount handlers
                    │
                    └── Handlers call container.getUseCase().execute()
```
