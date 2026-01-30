# System Layer Guidelines

> Guidelines for `backend/src/0_system/` - the runtime plumbing layer in DDD architecture.

---

## Core Principle

**The system layer provides runtime services and utilities that all layers depend on, containing no business logic.**

This is the foundation layer. Domain, adapters, and applications all import from system - never the reverse.

| Layer | Contains | Examples |
|-------|----------|----------|
| **System** | Runtime plumbing, cross-cutting utilities | Config loading, logging, scheduling, time formatting |
| **Domain** | Timeless business logic | Entities, value objects, domain services |
| **Adapters** | External integrations | Repositories, API clients, messaging |
| **Applications** | Workflow orchestration | Use cases, containers, ports |

**The Isolation Test:** If your system code would need to import from `1_domains/`, `2_adapters/`, or `3_applications/`, it doesn't belong in system layer.

**What the system layer does NOT know:**
- What business domains exist (fitness, nutrition, finance)
- What external services are used (Telegram, Plex, OpenAI)
- What use cases the application has
- How entities are structured or validated

---

## System Services vs Utilities

The system layer contains two distinct categories:

### System Services

**Stateful components with lifecycle management.** They are instantiated, configured, started, and stopped.

| Characteristic | Description |
|----------------|-------------|
| **Lifecycle** | Has `start()`, `stop()`, or initialization phase |
| **State** | Maintains internal state (connections, caches, intervals) |
| **Singleton-ish** | Typically one instance per application |
| **Dependencies** | Often depends on other services or config |

**Examples:** ConfigService, Scheduler, EventBus, LogDispatcher, ProxyService

```javascript
// System service pattern
export class Scheduler {
  #intervalId = null;
  #running = false;

  constructor({ config, logger }) {
    this.#config = config;
    this.#logger = logger;
  }

  start() { /* begin interval */ }
  stop() { /* cleanup */ }
  isRunning() { return this.#running; }
}
```

### Utilities

**Stateless, pure functions.** No instantiation needed - import and call.

| Characteristic | Description |
|----------------|-------------|
| **Pure** | Same input → same output, no side effects |
| **Stateless** | No internal state between calls |
| **Importable** | Direct function imports, no instantiation |

**Examples:** `formatLocalTimestamp()`, `shortId()`, `parseToDate()`, `sanitizeYaml()`

```javascript
// Utility pattern
export function formatLocalTimestamp(date, timezone = 'America/Los_Angeles') {
  // Pure transformation - no state, no side effects
  return formatted;
}
```

---

## Bootstrap & Wiring

The bootstrap module is the **composition root** - the single place where all layers connect. It lives in system layer but is the only system code that touches other layers.

### Bootstrap Responsibilities

| Responsibility | Description |
|----------------|-------------|
| **Instantiate adapters** | Create concrete adapter instances with config |
| **Create services** | Wire adapters into domain/application services |
| **Build routers** | Connect services to API routes |
| **Manage lifecycle** | Start/stop order for services with dependencies |

### Factory Function Pattern

Each domain gets a factory function that returns configured services:

```javascript
/**
 * Create fitness domain services
 * @param {Object} config - Configuration values (not ConfigService)
 * @returns {Object} Fitness services
 */
export function createFitnessServices(config) {
  const { dataRoot, homeAssistant, logger = console } = config;

  const sessionStore = new YamlSessionStore({ dataRoot });
  const sessionService = new SessionService({ sessionStore });

  return { sessionStore, sessionService };
}
```

### Bootstrap Rules

| Rule | Rationale |
|------|-----------|
| **Config values, not ConfigService** | Factories receive resolved values, not the service itself |
| **Optional dependencies degrade gracefully** | Missing optional config → null adapter, not error |
| **Log disabled features** | When optional deps missing, log why feature is disabled |
| **No business logic** | Bootstrap only wires - logic lives in domain/application |

---

## Import Rules

### ALLOWED imports in `0_system/`

| Source | Examples |
|--------|----------|
| **Node.js core** | `fs`, `path`, `crypto`, `url` |
| **npm packages** | `yaml`, `moment-timezone`, `uuid`, `ws` |
| **Other system modules** | Utils can import config, logging can import utils |

### FORBIDDEN imports in `0_system/`

| Forbidden | Why | Instead |
|-----------|-----|---------|
| `#domains/*` | System has no business knowledge | Pass values via parameters |
| `#adapters/*` | Adapters depend on system, not reverse | Inject adapters in bootstrap |
| `#applications/*` | Applications depend on system | Inject via bootstrap |

### Exception: Bootstrap

Bootstrap is the **only** system code that imports from other layers. It's the composition root:

```javascript
// bootstrap.mjs - ONLY place this is allowed
import { SessionService } from '../1_domains/fitness/services/SessionService.mjs';
import { YamlSessionStore } from '../2_adapters/persistence/yaml/YamlSessionStore.mjs';
import { createFitnessRouter } from '../4_api/routers/fitness.mjs';
```

### Import Aliases

```javascript
// GOOD - system utilities
import { formatLocalTimestamp } from '#system/utils/time.mjs';
import { ConfigService } from '#system/config/ConfigService.mjs';

// BAD - reaching into domain from system util
import { Session } from '#domains/fitness/entities/Session.mjs';
```

---

## Error Handling

System layer defines its own error types for infrastructure concerns.

### System Error Types

| Error Type | When to Use | Examples |
|------------|-------------|----------|
| `ConfigurationError` | Invalid or missing configuration | Missing required env var, malformed config file |
| `SchedulerError` | Scheduler/job execution failures | Job timeout, invalid cron expression |
| `EventBusError` | Event pub/sub failures | Client disconnect, broadcast failure |
| `FileIOError` | File system operation failures | Read/write failures, permission denied |

### Error Structure

```javascript
// 0_system/utils/errors/ConfigurationError.mjs
export class ConfigurationError extends Error {
  constructor(message, { code, key, value, details } = {}) {
    super(message);
    this.name = 'ConfigurationError';
    this.code = code;       // Machine-readable: 'MISSING_SECRET'
    this.key = key;         // Which config key: 'OPENAI_API_KEY'
    this.value = value;     // What was provided (sanitized)
    this.details = details; // Additional context
  }
}
```

### Usage

```javascript
// Missing required configuration
if (!apiKey) {
  throw new ConfigurationError('API key required', {
    code: 'MISSING_SECRET',
    key: 'OPENAI_API_KEY'
  });
}

// Invalid configuration value
if (intervalMs < 1000) {
  throw new ConfigurationError('Interval must be at least 1000ms', {
    code: 'INVALID_VALUE',
    key: 'scheduler.intervalMs',
    value: intervalMs
  });
}
```

### Rules

- Always include `code` for programmatic handling
- Never expose secrets in error messages or `value` field
- System errors propagate up - let application layer decide how to handle

---

## File Structure & Naming

### Standard System Layer Structure

```
0_system/
├── bootstrap.mjs           # Composition root - wires all layers
│
├── config/                 # Configuration loading and access
│   ├── ConfigService.mjs   # Pure config accessor
│   ├── configLoader.mjs    # Loads config from files/env
│   ├── configValidator.mjs # Validates config schema
│   └── index.mjs           # Barrel exports
│
├── logging/                # Centralized logging
│   ├── LogDispatcher.mjs   # Routes logs to transports
│   ├── transports/         # Console, file, cloud transports
│   └── index.mjs
│
├── scheduling/             # Job scheduling
│   ├── Scheduler.mjs       # Runs the scheduling loop
│   ├── TaskRegistry.mjs    # Registered jobs
│   └── index.mjs
│
├── eventbus/               # Event pub/sub
│   ├── IEventBus.mjs       # Interface definition
│   ├── EventBusImpl.mjs    # In-memory implementation
│   ├── WebSocketEventBus.mjs
│   └── index.mjs
│
└── utils/                  # Pure utility functions
    ├── time.mjs            # Timestamp formatting
    ├── shortId.mjs         # ID generation
    ├── strings.mjs         # String helpers
    ├── FileIO.mjs          # File read/write utilities
    ├── errors/             # System error classes
    │   ├── ConfigurationError.mjs
    │   ├── SchedulerError.mjs
    │   └── index.mjs
    └── index.mjs
```

### Naming Conventions

| Type | Pattern | Examples |
|------|---------|----------|
| **Services** | `PascalCase.mjs` | `ConfigService.mjs`, `Scheduler.mjs` |
| **Utilities** | `camelCase.mjs` | `time.mjs`, `shortId.mjs`, `strings.mjs` |
| **Interfaces** | `IPascalCase.mjs` | `IEventBus.mjs`, `IProxyAdapter.mjs` |
| **Errors** | `PascalCaseError.mjs` | `ConfigurationError.mjs` |
| **Index files** | `index.mjs` | Barrel exports at each folder |

---

## JSDoc Conventions

### System Service JSDoc

```javascript
/**
 * Centralized configuration accessor.
 *
 * Receives pre-loaded, validated config via constructor.
 * All methods are simple property lookups - no I/O, no fallbacks.
 *
 * @class ConfigService
 * @property {Object} config - Frozen configuration object
 *
 * @example
 * const configService = new ConfigService(loadedConfig);
 * const apiKey = configService.getSecret('OPENAI_API_KEY');
 */
export class ConfigService {
```

### Service Method JSDoc

```javascript
/**
 * Get secret value by key.
 *
 * @param {string} key - Secret key name
 * @returns {string|null} Secret value, or null if not found
 */
getSecret(key) {
```

### Utility Function JSDoc

```javascript
/**
 * Format a date as a local timestamp string.
 *
 * @param {Date} [date=new Date()] - Date to format
 * @param {string} [timezone='America/Los_Angeles'] - IANA timezone
 * @returns {string} Formatted timestamp (YYYY-MM-DD HH:mm:ss)
 *
 * @example
 * formatLocalTimestamp(new Date(), 'America/New_York')
 * // => '2026-01-26 14:30:45'
 */
export function formatLocalTimestamp(date = new Date(), timezone = 'America/Los_Angeles') {
```

### Bootstrap Factory JSDoc

```javascript
/**
 * Create fitness domain services.
 *
 * @param {Object} config
 * @param {string} config.dataRoot - Base data directory
 * @param {Object} [config.homeAssistant] - Home Assistant configuration
 * @param {string} [config.homeAssistant.baseUrl] - HA base URL
 * @param {string} [config.homeAssistant.token] - HA long-lived token
 * @param {Object} [config.logger=console] - Logger instance
 * @returns {Object} Fitness services { sessionStore, sessionService, ... }
 */
export function createFitnessServices(config) {
```

### Required JSDoc Elements

| Element | Required On | Purpose |
|---------|-------------|---------|
| `@class` + description | Services | What this service does |
| `@param` / `@returns` | All public methods and functions | Input/output contract |
| `@throws` | Methods that throw | Document error conditions |
| `@example` | Utilities, factory functions | Show typical usage |

---

## Anti-Patterns Summary

| Anti-Pattern | Example | Fix |
|--------------|---------|-----|
| **Domain imports in system** | `import { Session } from '#domains/fitness/...'` | System has no domain knowledge |
| **Adapter imports in system** | `import { TelegramAdapter } from '#adapters/...'` | Only bootstrap imports adapters |
| **Business logic in utils** | `calculateCaloriesBurned()` in time.mjs | Move to domain layer |
| **Service without lifecycle** | Service class with no start/stop that could be pure functions | Make it a utility |
| **Utility with state** | Function that caches internally between calls | Make it a service |
| **Config access in utilities** | `import { configService } from '#system/config'` in a utility | Pass values as parameters |
| **Hardcoded paths** | `const dataDir = '/data/household'` | Use ConfigService |
| **Swallowed errors** | `catch (e) { }` | Throw system errors, let app layer handle |
| **Generic Error** | `throw new Error('config missing')` | `throw new ConfigurationError('...', { code })` |
| **Bootstrap business logic** | Calculating values, transforming data in bootstrap | Bootstrap only wires |
| **Singletons via module scope** | `export const scheduler = new Scheduler()` | Export class, instantiate in bootstrap |
| **Domain-specific code** | `PrayerCardRenderer.mjs` in system layer | Move to adapters |

---

## Import Aliases

**Configure in `package.json`:**

```json
{
  "imports": {
    "#system/*": "./backend/src/0_system/*",
    "#domains/*": "./backend/src/1_domains/*",
    "#adapters/*": "./backend/src/2_adapters/*",
    "#applications/*": "./backend/src/3_applications/*"
  }
}
```

**Note:** Rename from `#infrastructure/*` to `#system/*` when migrating.
