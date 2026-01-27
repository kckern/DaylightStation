# Backend Coding Standards

> Code conventions and standards for the DaylightStation backend. These rules apply across all layers.

**Related:** [Backend Architecture](./backend-architecture.md) | [DDD Reference](./layers-of-abstraction/ddd-reference.md)

---

## Naming Conventions

### Files & Folders

| Type | Convention | Examples |
|------|------------|----------|
| Classes | `PascalCase.mjs` | `SessionService.mjs`, `PlexAdapter.mjs` |
| Value Objects | `PascalCase.mjs` | `SessionId.mjs`, `ZoneName.mjs` |
| Utilities | `camelCase.mjs` | `time.mjs`, `shortId.mjs` |
| Factory files | `camelCase.mjs` | `createPlayRouter.mjs` |
| Barrel files | `index.mjs` | Always `index.mjs`, never `index.js` |
| Directories | `kebab-case` | `home-automation/`, `value-objects/` |

### Classes, Functions, Variables

| Type | Convention | Examples |
|------|------------|----------|
| Classes | `PascalCase` | `SessionService`, `ValidationError` |
| Factory functions | `camelCase` with `create` prefix | `createFitnessServices()`, `createPlayRouter()` |
| Methods | `camelCase` | `getSession()`, `findByDate()` |
| Private members | `#camelCase` | `#httpClient`, `#buildPath()` |
| Variables | `camelCase` | `sessionStore`, `dataRoot` |
| Boolean variables | `is`/`has`/`can` prefix | `isActive`, `hasParticipants`, `canComplete` |

### Constants & Enums

| Type | Convention | Examples |
|------|------------|----------|
| Module constants | `SCREAMING_SNAKE_CASE` | `TELEGRAM_API_BASE`, `DEFAULT_TIMEOUT_MS` |
| Enum objects | `PascalCase` | `MessageType`, `ZoneName` |
| Enum values | `SCREAMING_SNAKE_CASE` | `MessageType.VOICE`, `ZoneName.RECOVERY` |
| Enum arrays | `SCREAMING_SNAKE_CASE` plural | `ZONE_NAMES`, `MESSAGE_TYPES` |

---

## Import & Export Patterns

### Path Aliases

Use `#` aliases for cross-layer imports. Never use relative paths that traverse layers.

| Alias | Points To | Use For |
|-------|-----------|---------|
| `#domains/*` | `1_domains/*` | Entities, value objects, domain services |
| `#adapters/*` | `2_adapters/*` | Repository implementations, gateways |
| `#apps/*` | `3_applications/*` | Use cases, containers, ports |
| `#system/*` | `0_system/*` | Utils, config, logging |

```javascript
// GOOD - alias imports
import { Session } from '#domains/fitness';
import { formatLocalTimestamp } from '#system/utils/time.mjs';

// BAD - relative path hell
import { Session } from '../../../../1_domains/fitness/entities/Session.mjs';
```

### Import Organization

Group imports in this order, separated by blank lines:

1. Node.js built-ins (`fs`, `path`, `crypto`)
2. External packages (`yaml`, `moment-timezone`)
3. `#system/*` imports
4. `#domains/*` imports
5. `#adapters/*` imports
6. `#apps/*` imports
7. Relative imports (`./`, `../`)

```javascript
import { readFile } from 'fs/promises';
import yaml from 'yaml';

import { formatLocalTimestamp } from '#system/utils/time.mjs';
import { ValidationError } from '#domains/core/errors';
import { Session } from '#domains/fitness';

import { buildSessionPath } from './paths.mjs';
```

### Barrel Files

Every domain and major module has an `index.mjs` that exports its public API. Import from the directory, not the index file directly.

```javascript
// GOOD - implied index.mjs
import { Session, SessionId } from '#domains/fitness';
import { ValidationError } from '#domains/core/errors';

// BAD - explicit index.mjs (redundant)
import { Session } from '#domains/fitness/index.mjs';

// BAD - reaching into internals
import { Session } from '#domains/fitness/entities/Session.mjs';
```

### Export Conventions

| What | Pattern | Example |
|------|---------|---------|
| Classes | Named + default | `export class Foo {}` then `export default Foo;` |
| Factory functions | Default only | `export default function createRouter() {}` |
| Utilities | Named exports | `export function formatDate() {}` |
| Constants | Named exports | `export const DEFAULT_TIMEOUT = 5000;` |
| Barrel files | Named re-exports | `export { Foo } from './Foo.mjs';` |

**Why named + default for classes?**
- Named export enables tree-shaking and explicit imports
- Default export provides convenient single-class-per-file imports

---

## Class Patterns

### Private Fields

Use ES2022 `#` private fields for all private members. Never use underscore prefix.

```javascript
// GOOD - ES2022 private fields
class SessionService {
  #sessionStore;
  #logger;

  constructor(config) {
    this.#sessionStore = config.sessionStore;
    this.#logger = config.logger || console;
  }

  #buildPath(sessionId) {
    return `${this.#dataRoot}/${sessionId}.yml`;
  }
}

// BAD - underscore prefix (not truly private)
class SessionService {
  _sessionStore;

  _buildPath(sessionId) { ... }
}
```

### Constructor Validation

Required dependencies throw immediately. Optional dependencies default gracefully.

```javascript
constructor(config) {
  // Required - fail fast with clear message
  if (!config.sessionStore) throw new Error('sessionStore is required');
  if (!config.dataRoot) throw new Error('dataRoot is required');

  // Assign required
  this.#sessionStore = config.sessionStore;
  this.#dataRoot = config.dataRoot;

  // Optional - graceful defaults
  this.#logger = config.logger || console;
  this.#timeout = config.timeout ?? 5000;
}
```

### Factory Methods

Entities use static factory methods for creation. Constructors are for reconstitution from storage.

```javascript
class Session {
  // Constructor - used by repositories to reconstitute from storage
  constructor({ id, status, startTime, zones }) {
    if (!id) throw new ValidationError('id is required');
    this.#id = id;
    this.#status = status;
    this.#startTime = startTime;
    this.#zones = zones;
  }

  // Factory - used by application code to create new instances
  static create({ timestamp, startTime, zones }) {
    if (!timestamp) throw new ValidationError('timestamp is required');
    return new Session({
      id: SessionId.generate(timestamp),
      status: 'pending',
      startTime,
      zones
    });
  }
}
```

### Getters Over Public Fields

Expose state through getters, not public fields.

```javascript
// GOOD - getters protect encapsulation
class Session {
  #id;
  #status;

  get id() { return this.#id; }
  get status() { return this.#status; }
  get isActive() { return this.#status === 'active'; }
}

// BAD - public fields allow external mutation
class Session {
  id;
  status;
}
```

---

## Function Patterns

### Dependency Injection

Pass dependencies as a single config object, not positional arguments.

```javascript
// GOOD - config object with destructuring
export function createPlayRouter(config) {
  const { registry, watchStore, logger = console } = config;
  // ...
}

// GOOD - in constructor
constructor(config) {
  const { httpClient, token, logger = console } = config;
  this.#httpClient = httpClient;
  this.#token = token;
  this.#logger = logger;
}

// BAD - positional arguments
export function createPlayRouter(registry, watchStore, logger) { ... }

// BAD - separate config and deps objects
constructor(config, deps = {}) {
  this.#httpClient = deps.httpClient;
}
```

### Factory Functions

Factory functions that create instances use `create` prefix and return configured objects.

```javascript
// Factory for services (in bootstrap)
export function createFitnessServices(config) {
  const { dataRoot, homeAssistant, logger = console } = config;

  const sessionStore = new YamlSessionStore({ dataRoot });
  const sessionService = new SessionService({ sessionStore, logger });

  return { sessionStore, sessionService };
}

// Factory for routers (in API layer)
export default function createPlayRouter(config) {
  const { registry, watchStore, logger = console } = config;
  const router = Router();

  router.get('/now', asyncHandler(playNowHandler({ registry, logger })));

  return router;
}
```

### Handler Factories

Express handlers are always factory functions that return the handler.

```javascript
// GOOD - factory returns handler
export function sessionCreateHandler(config) {
  const { container, logger = console } = config;

  return async (req, res) => {
    const result = await container.getCreateSession().execute(req.body);
    res.json(result);
  };
}

// BAD - direct handler export
export async function sessionCreateHandler(req, res) {
  // No way to inject dependencies
}
```

### Pure Utilities

Stateless utility functions are simple named exports. No factory pattern needed.

```javascript
// GOOD - pure function, named export
export function formatLocalTimestamp(date, timezone = 'America/Los_Angeles') {
  return moment(date).tz(timezone).format('YYYY-MM-DD HH:mm:ss');
}

// BAD - unnecessary factory for pure function
export function createTimestampFormatter(timezone) {
  return (date) => moment(date).tz(timezone).format('...');
}
```

---

## Error Handling

### Error Types

Use domain-specific error classes. Never throw generic `Error`.

| Error Type | When to Use | Layer |
|------------|-------------|-------|
| `ValidationError` | Input doesn't meet requirements | Domain |
| `DomainInvariantError` | Business rule would be violated | Domain |
| `EntityNotFoundError` | Referenced entity doesn't exist | Domain/App |
| `ConfigurationError` | Invalid or missing configuration | System |
| `InfrastructureError` | External system failure | Adapter |

### Error Structure

All errors include a machine-readable `code` for programmatic handling.

```javascript
throw new ValidationError('Duration must be positive', {
  code: 'INVALID_DURATION',
  field: 'duration',
  value: duration
});

throw new DomainInvariantError('Cannot complete session that is not active', {
  code: 'SESSION_NOT_ACTIVE',
  details: { currentStatus: this.#status }
});

throw new EntityNotFoundError('Session', sessionId);
```

### Throwing vs Returning

Throw errors, don't return failure objects.

```javascript
// GOOD - throw and let caller decide
async execute({ sessionId }) {
  const session = await this.#sessionStore.findById(sessionId);
  if (!session) {
    throw new EntityNotFoundError('Session', sessionId);
  }
  return session;
}

// BAD - returning failure objects
async execute({ sessionId }) {
  const session = await this.#sessionStore.findById(sessionId);
  if (!session) {
    return { success: false, error: 'Session not found' };
  }
  return { success: true, data: session };
}
```

### Never Swallow Errors

Log degradation, but never silently swallow errors.

```javascript
// GOOD - log and re-throw or degrade gracefully with logging
try {
  classification = await this.#classifyProduct(product);
} catch (error) {
  this.#logger.warn?.('classify.failed', { error: error.message });
  classification = null; // graceful degradation
}

// BAD - silent swallow
try {
  classification = await this.#classifyProduct(product);
} catch (e) { }
```

### Let Errors Propagate

Handlers let errors propagate. Middleware handles translation to HTTP.

```javascript
// GOOD - handler lets errors propagate
export function sessionGetHandler(config) {
  const { container } = config;

  return async (req, res) => {
    const session = await container.getSession().execute(req.params.id);
    res.json(session);
  };
}

// BAD - handler catches and formats
return async (req, res) => {
  try {
    const session = await container.getSession().execute(req.params.id);
    res.json(session);
  } catch (error) {
    res.status(500).json({ error: error.message }); // Don't do this
  }
};
```

---

## JSDoc Requirements

### Required Elements by Type

| Type | Required JSDoc | Elements |
|------|----------------|----------|
| Classes | Yes | `@class`, description, `@property` for public getters |
| Public methods | Yes | `@param`, `@returns`, `@throws` |
| Private methods | Optional | `@private` if documented |
| Factory functions | Yes | `@param`, `@returns`, `@example` |
| Utilities | Yes | `@param`, `@returns`, `@example` |
| Constants | No | Only if non-obvious |

### Class JSDoc

```javascript
/**
 * Manages fitness session lifecycle and persistence.
 *
 * @class SessionService
 * @property {string} dataRoot - Base directory for session storage
 */
class SessionService {
```

### Method JSDoc

```javascript
/**
 * Find sessions by date range.
 *
 * @param {Date} startDate - Start of range (inclusive)
 * @param {Date} endDate - End of range (inclusive)
 * @param {string} [householdId] - Filter by household
 * @returns {Promise<Session[]>} Sessions in range
 * @throws {ValidationError} If startDate > endDate
 */
async findByDateRange(startDate, endDate, householdId) {
```

### Factory JSDoc

```javascript
/**
 * Create fitness domain services.
 *
 * @param {Object} config
 * @param {string} config.dataRoot - Base data directory
 * @param {Object} [config.homeAssistant] - Home Assistant config
 * @param {Object} [config.logger=console] - Logger instance
 * @returns {{ sessionStore: YamlSessionStore, sessionService: SessionService }}
 *
 * @example
 * const { sessionService } = createFitnessServices({ dataRoot: '/data' });
 */
export function createFitnessServices(config) {
```

### Value Object JSDoc

```javascript
/**
 * Immutable session identifier.
 *
 * Format: YYYYMMDDHHmmss (timestamp-derived, sortable)
 *
 * @class SessionId
 *
 * @example
 * const id = SessionId.generate(new Date());
 * const parsed = SessionId.parse('20260127143052');
 */
class SessionId {
```

### Enum JSDoc

```javascript
/**
 * Valid message types for conversations.
 *
 * @enum {string}
 */
export const MessageType = Object.freeze({
  TEXT: 'text',
  VOICE: 'voice',
  IMAGE: 'image',
});
```

---

## Anti-Patterns

### Naming

| Anti-Pattern | Example | Instead |
|--------------|---------|---------|
| Underscore private | `_privateMethod()` | `#privateMethod()` |
| Generic names | `data`, `item`, `thing` | Domain terms: `session`, `entry` |
| Verb-less functions | `session()` | `getSession()`, `createSession()` |
| Abbreviated names | `sess`, `cfg`, `msg` | `session`, `config`, `message` |

### Imports

| Anti-Pattern | Example | Instead |
|--------------|---------|---------|
| Relative path traversal | `../../../1_domains/fitness/...` | `#domains/fitness` |
| Explicit index.mjs | `#domains/fitness/index.mjs` | `#domains/fitness` |
| Reaching into internals | `#domains/fitness/entities/Session.mjs` | `#domains/fitness` |
| Importing from wrong layer | Adapter imports in domain | Use dependency injection |

### Exports

| Anti-Pattern | Example | Instead |
|--------------|---------|---------|
| Multiple defaults | Two `export default` | One default per file |
| No barrel exports | Missing index.mjs | Create index.mjs for public API |
| Exporting internals | Exporting private helpers | Only export public API |

### Classes

| Anti-Pattern | Example | Instead |
|--------------|---------|---------|
| Public mutable fields | `this.status = 'active'` | Private field + getter |
| Constructor business logic | Calculations in constructor | Factory method |
| Anemic entities | All logic in services | Entity owns its behavior |
| Missing validation | Constructor accepts anything | Validate and throw |

### Functions

| Anti-Pattern | Example | Instead |
|--------------|---------|---------|
| Positional args | `createRouter(a, b, c)` | `createRouter({ a, b, c })` |
| Direct handler export | `export async function handle(req, res)` | Factory: `handler(config) => (req, res) => {}` |
| Stateful utilities | Utility that caches internally | Make it a service class |
| Config in utilities | Utility imports configService | Pass values as parameters |

### Error Handling

| Anti-Pattern | Example | Instead |
|--------------|---------|---------|
| Generic Error | `throw new Error('bad')` | `throw new ValidationError('...', { code })` |
| Silent swallow | `catch (e) { }` | Log and handle or re-throw |
| Return failure objects | `return { success: false }` | Throw error |
| Handler catch blocks | `catch (e) { res.status(500)... }` | Let middleware handle |
| Missing error code | `throw new ValidationError('bad')` | Include `{ code: 'ERROR_CODE' }` |

### Domain Layer

| Anti-Pattern | Example | Instead |
|--------------|---------|---------|
| `new Date()` in domain | `this.#createdAt = new Date()` | Receive timestamp as parameter |
| `toJSON()` in entity | Serialization in domain | Repository handles serialization |
| Adapter imports | `import { YamlStore }` | Pure domain, no I/O |
| Infrastructure imports | `import { configService }` | Pass values via constructor |

### General

| Anti-Pattern | Example | Instead |
|--------------|---------|---------|
| Magic strings | `if (status === 'active')` | `if (status === Status.ACTIVE)` |
| Magic numbers | `timeout: 5000` | `timeout: DEFAULT_TIMEOUT_MS` |
| Commented-out code | `// old implementation...` | Delete it (git has history) |
| TODO without context | `// TODO: fix this` | `// TODO(username): description + issue link` |
