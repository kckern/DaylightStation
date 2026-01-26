# Domain Layer Guidelines

> Guidelines for `backend/src/1_domains/` - the pure business logic layer in DDD architecture.

---

## Core Principle

**The domain layer contains timeless business logic that would be true in ANY application using these concepts.**

The Abstraction Test: If your domain logic would work identically in a completely different application (a competitor's fitness app, a different nutrition tracker), it belongs in `1_domains/`. If it's specific to how DaylightStation uses these concepts, it belongs in `3_applications/`.

| Layer | Contains | Example |
|-------|----------|---------|
| **Domain** | Universal truths, formulas, validations | Pace = distance / time. A zone has min/max bounds. |
| **Application** | How THIS app uses domain concepts | "Send morning debrief with grade-adjusted pace via messaging gateway" |

**What the domain layer does NOT know:**
- How entities are persisted (JSON, YAML, SQLite)
- How to format dates (`toISOString()`, `formatLocalTimestamp()`)
- What external services exist (Telegram, Plex, OpenAI)
- What this application's use cases are
- What time it is (`Date.now()`, `new Date()`)

---

## Entities vs Value Objects

**Entities** have identity - two sessions with the same data are still different sessions.

**Value Objects** have no identity - two "5 kilometers" are interchangeable.

| Aspect | Entity | Value Object |
|--------|--------|--------------|
| Identity | Has unique ID | Identified by value |
| Mutability | Controlled mutation via methods | Always immutable |
| Examples | Session, NutriLog, Budget, Message | ConversationId, DateRange, Distance, Zone bounds |

### Value Object Pattern

```javascript
class Distance {
  #meters;

  constructor(meters) {
    if (meters < 0) throw new ValidationError('Distance cannot be negative');
    this.#meters = meters;
    Object.freeze(this);
  }

  get meters() { return this.#meters; }
  get kilometers() { return this.#meters / 1000; }
  get miles() { return this.#meters / 1609.344; }

  add(other) { return new Distance(this.#meters + other.meters); }
  equals(other) { return this.#meters === other.meters; }
}
```

### Entity Pattern

```javascript
class Session {
  #id; #status; #startTime; #zones;

  constructor({ id, status, startTime, zones }) {
    if (!id) throw new ValidationError('Session id required');
    this.#id = id;
    this.#status = status || 'pending';
    // ...
  }

  // Controlled mutation - enforces invariants
  complete(completedAt) {
    if (this.#status !== 'active') {
      throw new DomainInvariantError('Cannot complete session that is not active');
    }
    this.#status = 'completed';
    this.#endTime = completedAt;
  }

  // Factory method with domain parameters (not JSON)
  static create({ startTime, zones, participants }) { ... }
}
```

---

## Domain Services

**When logic belongs in an entity vs a service:**

| Question | If Yes → | Example |
|----------|----------|---------|
| Operates on THIS instance only? | Entity | `session.complete()`, `zone.contains(hr)` |
| Spans multiple instances? | Service | `findByDateRange()`, `aggregateStats()` |
| Needs data the entity doesn't have? | Service | `isOverBudget(budget, spending)` |
| Complex factory logic? | Service | `createFromStravaActivity(data)` |

### Domain Service Pattern

```javascript
class ZoneService {
  /**
   * Find which zone a heart rate falls into
   * @param {number} heartRate - Current heart rate
   * @param {Zone[]} zones - Available zones to check
   * @returns {Zone|null}
   */
  findZoneFor(heartRate, zones) {
    return zones.find(zone => zone.contains(heartRate)) || null;
  }

  /**
   * Calculate time spent in each zone
   * @param {HeartRateSample[]} samples
   * @param {Zone[]} zones
   * @returns {Map<Zone, number>} Zone to duration in seconds
   */
  calculateZoneDistribution(samples, zones) {
    // Cross-entity logic - doesn't belong in Zone or Sample
  }
}
```

### Key Rules

- Domain services are **stateless** - no instance variables holding data between calls
- Domain services receive **entities as parameters** - they don't fetch data themselves
- Domain services contain **timeless logic** - the same formulas/rules any app would use
- If a service method takes one entity and only operates on it, the logic belongs in the entity

### Smell Test

```javascript
// BAD - service doing entity's job
zoneService.setHeartRateBounds(zone, min, max);

// GOOD - entity owns its state
zone.setBounds(min, max);
```

---

## Error Handling

**Three shared error types cover 95% of domain errors:**

| Error Type | Meaning | When to Use |
|------------|---------|-------------|
| `ValidationError` | Input doesn't meet requirements | Bad data coming IN to entity/service |
| `DomainInvariantError` | Business rule would be violated | Operation would break domain rules |
| `EntityNotFoundError` | Referenced entity doesn't exist | Lookup failed within domain logic |

### Error Structure

```javascript
class ValidationError extends Error {
  constructor(message, { code, field, value, details } = {}) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;       // Machine-readable: 'INVALID_DURATION'
    this.field = field;     // Which field: 'duration'
    this.value = value;     // What was passed: -5
    this.details = details; // Additional context
  }
}

class DomainInvariantError extends Error {
  constructor(message, { code, details } = {}) {
    super(message);
    this.name = 'DomainInvariantError';
    this.code = code;       // 'SESSION_NOT_ACTIVE'
    this.details = details;
  }
}
```

### Usage

```javascript
// Validation - bad input
if (duration < 0) {
  throw new ValidationError('Duration must be positive', {
    code: 'INVALID_DURATION',
    field: 'duration',
    value: duration
  });
}

// Invariant - business rule violation
complete(completedAt) {
  if (this.#status !== 'active') {
    throw new DomainInvariantError('Cannot complete session that is not active', {
      code: 'SESSION_NOT_ACTIVE',
      details: { currentStatus: this.#status }
    });
  }
}
```

### Rules

- Always include `code` for programmatic handling
- Never catch and swallow errors silently in domain layer
- Domain throws, application layer decides how to handle

---

## Import Rules

### ALLOWED imports in `1_domains/`

- Other domains (lower in hierarchy only - see Cross-Domain Dependencies)
- Pure utilities that don't touch infrastructure (`uuid`, `lodash` for pure functions)

### FORBIDDEN imports in `1_domains/`

| Forbidden | Why | Instead |
|-----------|-----|---------|
| `#infrastructure/*` | Domain doesn't know about infra | Pass values via factory methods |
| `#adapters/*` | Domain doesn't know implementations | Application layer coordinates |
| `#applications/*` | Domain is lower than application | Never import upward |
| `fs`, `path` | Domain doesn't do I/O | Repositories in adapters |
| Vendor SDKs | Domain doesn't know vendors | Abstract via application ports |

### No Serialization Knowledge

```javascript
// FORBIDDEN in domain
toJSON() { return { start_time: this.#startTime.toISOString() }; }
static fromJSON(json) { return new Session({ startTime: new Date(json.start_time) }); }

// ALLOWED in domain - factory with domain parameters
static create({ startTime, zones, participants }) {
  return new Session({
    id: generateId(),
    startTime,
    zones,
    participants,
    status: 'pending'
  });
}
```

### Where Serialization Lives

| Layer | Responsibility |
|-------|----------------|
| Domain | Factory methods with domain-typed parameters |
| Adapter (Repository) | Maps storage format ↔ domain entities |
| Infrastructure | Formatting utilities (`time.mjs`, etc.) |

```javascript
// 2_adapters/fitness/SessionRepository.mjs
import { formatLocalTimestamp, parseToDate } from '#infrastructure/utils/time.mjs';

async save(session) {
  const data = {
    id: session.id,
    start_time: formatLocalTimestamp(session.startTime),
    status: session.status,
  };
  await this.store.write(data);
}

async findById(id) {
  const data = await this.store.read(id);
  return Session.create({
    startTime: parseToDate(data.start_time),
    // ...
  });
}
```

---

## No Ports in Domain Layer

**Ports (abstract interfaces for external services) belong in `3_applications/`, not `1_domains/`.**

The domain layer is pure business logic with no external dependencies. It doesn't need to "call out" to anything - it just calculates, validates, and enforces rules.

| Layer | Has Ports? | Why |
|-------|------------|-----|
| Domain | **No** | Pure logic - no external dependencies |
| Application | **Yes** | Orchestrates use cases, defines what it needs |
| Adapter | Implements | Concrete implementations of application ports |

### If You're Tempted to Add a Port to Domain

| You want... | Solution |
|-------------|----------|
| Domain to persist itself | Repository in adapter layer, called by application |
| Domain to call external API | Gateway in application layer |
| Domain to send notifications | Messaging gateway in application layer |
| Domain to get current time | Pass time as parameter to factory/method |

### Example - Getting Current Time

```javascript
// BAD - domain reaches out to infrastructure
class Session {
  complete() {
    this.#endTime = new Date(); // Domain calling system clock
  }
}

// GOOD - time passed as parameter
class Session {
  complete(completedAt) {
    if (!completedAt) throw new ValidationError('completedAt required');
    this.#endTime = completedAt;
  }
}

// Application layer provides the time
import { parseToDate } from '#infrastructure/utils/time.mjs';
session.complete(parseToDate(new Date()));
```

**Existing `1_domains/*/ports/` folders should be migrated to `3_applications/`.**

---

## Cross-Domain Dependencies

**Domains can import from lower-level domains only. No circular dependencies.**

```
Level 0 (foundation):   core
                          ↑
Level 1 (shared):       messaging, ai, scheduling, entropy
                          ↑
Level 2 (features):     fitness, nutrition, finance, media, content,
                        journaling, gratitude, home-automation
                          ↑
Level 3 (aggregators):  lifelog, health, journalist
```

### Rules

| Rule | Example |
|------|---------|
| Import DOWN only | `lifelog` can import from `fitness` ✓ |
| No upward imports | `fitness` cannot import from `lifelog` ✗ |
| No circular deps | `fitness` ↔ `nutrition` both ways ✗ |
| Coordination in app layer | Cross-domain workflows go in `3_applications/` |

### What Each Level Contains

| Level | Purpose | Examples |
|-------|---------|----------|
| 0 - Foundation | Shared primitives, base classes | DateRange, UserId, base Error classes |
| 1 - Shared | Cross-cutting capabilities | Message entities, AI prompt structures |
| 2 - Features | Business domains | Session, NutriLog, Budget, Zone |
| 3 - Aggregators | Combine data from multiple domains | LifelogEntry, HealthSnapshot |

### Cross-Domain Coordination in Application Layer

```javascript
// 3_applications/journalist/usecases/GenerateDailyReport.mjs
async execute(date, userId) {
  // Application layer fetches from multiple domains
  const sessions = await this.#fitnessRepository.findByDate(date, userId);
  const meals = await this.#nutritionRepository.findByDate(date, userId);
  const journal = await this.#journalingRepository.findByDate(date, userId);

  // Domain aggregator combines them
  return DailyReport.create({ sessions, meals, journal, date });
}
```

---

## File Structure & Naming

### Standard Domain Folder Structure

```
1_domains/
└── {domain}/
    ├── entities/           # Aggregates and entities
    │   ├── Session.mjs
    │   └── Participant.mjs
    │
    ├── value-objects/      # Immutable value types
    │   ├── Distance.mjs
    │   ├── Duration.mjs
    │   └── ActivityType.mjs
    │
    ├── services/           # Cross-entity domain logic
    │   └── ZoneService.mjs
    │
    ├── errors/             # Domain-specific error context (optional)
    │   └── index.mjs       # Re-exports shared errors with domain codes
    │
    └── index.mjs           # Barrel exports (public API)
```

### Naming Conventions

| Type | Pattern | Examples |
|------|---------|----------|
| Entities | `PascalCase.mjs` | `Session.mjs`, `NutriLog.mjs`, `Budget.mjs` |
| Value Objects | `PascalCase.mjs` | `Distance.mjs`, `ConversationId.mjs` |
| Services | `PascalCaseService.mjs` | `ZoneService.mjs`, `SessionService.mjs` |
| Index files | `index.mjs` | Barrel exports at each level |

### Barrel Exports

```javascript
// 1_domains/fitness/index.mjs
export { Session } from './entities/Session.mjs';
export { Zone } from './entities/Zone.mjs';
export { Distance } from './value-objects/Distance.mjs';
export { Duration } from './value-objects/Duration.mjs';
export { ZoneService } from './services/ZoneService.mjs';
```

### Import from Barrel

```javascript
// GOOD - import from domain barrel
import { Session, Zone, Distance } from '#domains/fitness/index.mjs';

// AVOID - reaching into internal structure
import { Session } from '#domains/fitness/entities/Session.mjs';
```

---

## Import Aliases

**Configure in `package.json`:**

```json
{
  "imports": {
    "#domains/*": "./backend/src/1_domains/*",
    "#adapters/*": "./backend/src/2_adapters/*",
    "#applications/*": "./backend/src/3_applications/*",
    "#infrastructure/*": "./backend/src/0_system/*"
  }
}
```

### Usage

```javascript
// GOOD - clean alias imports
import { Session, Zone } from '#domains/fitness/index.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';
import { formatLocalTimestamp } from '#infrastructure/utils/time.mjs';

// BAD - relative path hell
import { Session } from '../../../../1_domains/fitness/entities/Session.mjs';
import { ValidationError } from '../../../1_domains/core/errors/ValidationError.mjs';
```

### Alias Naming Convention

| Alias | Points To | Used For |
|-------|-----------|----------|
| `#domains/*` | `1_domains/*` | Domain entities, value objects, services |
| `#adapters/*` | `2_adapters/*` | Repository implementations, gateways |
| `#applications/*` | `3_applications/*` | Use cases, containers, ports |
| `#infrastructure/*` | `0_system/*` | Utils, config, logging |

**The `#` prefix is Node.js subpath imports convention** - works without bundler configuration, supported natively since Node 12.19.

---

## ID Generation

**Each domain chooses the ID format that fits its semantics.**

| Pattern | When to Use | Example |
|---------|-------------|---------|
| **Timestamp-derived** | Time-series data, sortable records, session logs | `20260126143052` |
| **Timestamp + random** | Sortable but needs uniqueness within same second | `20260126143052-a7b3c` |
| **UUID v4** | Entities with no temporal ordering, distributed systems | `550e8400-e29b-41d4-...` |
| **Prefixed random** | Debugging clarity, logs with mixed entity types | `msg-1706284252-x7k9` |
| **shortId** | User-facing IDs, URLs, compact references | `a7b3c9x` |

### Guidelines

```javascript
// Time-series / sessions - timestamp-derived
// Timestamp passed from application layer
class Session {
  static create({ timestamp, startTime, ...props }) {
    if (!timestamp) throw new ValidationError('timestamp required');
    const id = formatTimestampId(timestamp); // 20260126143052
    return new Session({ id, startTime, ...props });
  }
}

// Messages - prefixed for debuggability
// Timestamp passed from application layer
class Message {
  static create({ timestamp, ...props }) {
    if (!timestamp) throw new ValidationError('timestamp required');
    const id = `msg-${timestamp}-${shortId()}`;
    return new Message({ id, createdAt: timestamp, ...props });
  }
}

// Entities with no temporal meaning - UUID
class Budget {
  static create(props) {
    const id = crypto.randomUUID();
    return new Budget({ id, ...props });
  }
}
```

### Rules

- ID generation happens in **factory methods**, not constructors
- Constructor accepts `id` as parameter (for reconstitution from storage)
- Document the ID format in the entity's JSDoc
- IDs are **immutable** once assigned
- **Never use `Date.now()` or `new Date()`** - receive timestamp as parameter

---

## JSDoc Conventions

### Entity JSDoc

```javascript
/**
 * Represents a fitness training session.
 *
 * @class Session
 * @property {string} id - Timestamp-derived ID (YYYYMMDDHHmmss)
 * @property {Date} startTime - When the session began
 * @property {Date|null} endTime - When the session ended (null if active)
 * @property {Zone[]} zones - Heart rate zones for this session
 * @property {string} status - pending | active | completed | cancelled
 *
 * @example
 * const session = Session.create({ timestamp, startTime, zones: [...] });
 * session.complete(completedAt);
 */
class Session {
```

### Factory Method JSDoc

```javascript
/**
 * Create a new session.
 *
 * @param {Object} params
 * @param {string} params.timestamp - Timestamp for ID generation (from infrastructure)
 * @param {Date} params.startTime - Session start time
 * @param {Zone[]} params.zones - Heart rate zones
 * @param {Participant[]} [params.participants=[]] - Optional participants
 * @returns {Session}
 * @throws {ValidationError} If startTime is missing or invalid
 */
static create({ timestamp, startTime, zones, participants = [] }) {
```

### Domain Method JSDoc

```javascript
/**
 * Mark the session as completed.
 *
 * @param {Date} completedAt - Completion timestamp
 * @throws {DomainInvariantError} If session is not active (code: SESSION_NOT_ACTIVE)
 */
complete(completedAt) {
```

### Value Object JSDoc

```javascript
/**
 * Immutable distance measurement.
 *
 * @class Distance
 * @property {number} meters - Distance in meters (read-only)
 *
 * @example
 * const d1 = new Distance(5000);
 * const d2 = d1.add(new Distance(1000)); // Returns new Distance(6000)
 */
```

### Service JSDoc

```javascript
/**
 * Cross-entity operations for heart rate zones.
 *
 * @class ZoneService
 * @stateless - No instance state; all data passed via parameters
 */
class ZoneService {

  /**
   * Find which zone contains the given heart rate.
   *
   * @param {number} heartRate - Current heart rate in BPM
   * @param {Zone[]} zones - Available zones to search
   * @returns {Zone|null} Matching zone, or null if none match
   */
  findZoneFor(heartRate, zones) {
```

### Required JSDoc Elements

| Element | Required On | Purpose |
|---------|-------------|---------|
| `@class` + description | All classes | What this entity/service represents |
| `@property` | Entities, Value Objects | Document shape |
| `@param` / `@returns` | All public methods | Input/output contract |
| `@throws` | Methods that throw | Document error conditions with codes |
| `@example` | Factory methods | Show typical usage |
| `@stateless` | Services | Clarify no instance state |

---

## Anti-Patterns Summary

| Anti-Pattern | Example | Fix |
|--------------|---------|-----|
| **Serialization in domain** | `toJSON()`, `fromJSON()` | Factory methods with domain params; repos serialize |
| **Infrastructure imports** | `import { configService } from '#infrastructure/...'` | Pass values via constructor/method params |
| **Adapter imports** | `import { PlexClient } from '#adapters/...'` | Domain has no external dependencies |
| **Raw time functions** | `Date.now()`, `new Date()` | Receive timestamp as parameter from caller |
| **Date formatting** | `this.#time.toISOString()` | Pass pre-formatted or let adapter format |
| **Ports in domain** | `1_domains/ai/ports/IAIGateway.mjs` | Move to `3_applications/{app}/ports/` |
| **Upward domain imports** | `fitness` imports from `lifelog` | Only import from lower-level domains |
| **Circular dependencies** | `fitness` ↔ `nutrition` | Coordinate in application layer |
| **Anemic entities** | All logic in services, entities are data bags | Entity owns logic about itself |
| **Service doing entity's job** | `service.complete(session)` | `session.complete()` via method |
| **Direct property mutation** | `session.status = 'done'` | `session.complete()` via method |
| **Swallowed errors** | `catch (e) { }` | Throw domain errors, let app layer handle |
| **Generic Error** | `throw new Error('bad')` | `throw new ValidationError('...', { code })` |
| **Mutable value objects** | `distance.meters = 500` | Value objects are frozen, return new instances |
| **Relative path imports** | `../../../1_domains/fitness/...` | Use `#domains/fitness/...` alias |
