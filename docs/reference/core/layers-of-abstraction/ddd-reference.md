# Domain-Driven Design Reference

> Layer-agnostic principles and patterns for Domain-Driven Design. These concepts apply across all layers of the architecture.

---

## What is DDD?

**Domain-Driven Design** is an approach to software development that:
1. Places the **domain model** at the center of the system
2. Creates a **ubiquitous language** shared by developers and domain experts
3. Separates **core business logic** from infrastructure concerns

**The goal:** Software that directly reflects how the business thinks about problems, making it easier to understand, modify, and extend.

---

## The Dependency Rule

**Dependencies always point inward toward the domain.**

```
┌─────────────────────────────────────────────────┐
│  4_api (Presentation)                           │
│  ┌─────────────────────────────────────────┐    │
│  │  3_applications (Use Cases)             │    │
│  │  ┌─────────────────────────────────┐    │    │
│  │  │  1_domains (Core Business)      │    │    │
│  │  │                                 │    │    │
│  │  │    Entities, Value Objects,     │    │    │
│  │  │    Domain Services, Rules       │    │    │
│  │  │                                 │    │    │
│  │  └─────────────────────────────────┘    │    │
│  │                 ↑                       │    │
│  │  2_adapters (Infrastructure)            │    │
│  └─────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

| Layer | Can Import From | Cannot Import From |
|-------|-----------------|-------------------|
| `4_api` | 3_applications, 1_domains, 0_system | - |
| `3_applications` | 1_domains, 0_system | 2_adapters, 4_api |
| `2_adapters` | 1_domains, 0_system | 3_applications, 4_api |
| `1_domains` | 1_domains (lower level), 0_system/utils | Everything else |
| `0_system` | External packages only | All src layers |

**The inner layers are stable; the outer layers are volatile.**

---

## Strategic Design

### Bounded Contexts

A **bounded context** is a boundary within which a particular model applies. The same word can mean different things in different contexts.

| Term | In Fitness Context | In Nutrition Context | In Finance Context |
|------|-------------------|---------------------|-------------------|
| Session | A workout period | N/A | N/A |
| Log | Session recording | Food diary entry | Transaction record |
| Goal | Heart rate target | Calorie target | Budget target |
| Item | Workout activity | Food item | Line item |

**Rule:** Don't force a single model to cover multiple contexts. Let each context have its own vocabulary.

### Context Mapping

When bounded contexts need to communicate, define explicit relationships:

| Pattern | Description | Example |
|---------|-------------|---------|
| **Shared Kernel** | Contexts share a small common model | `core` domain used by all |
| **Customer-Supplier** | Upstream context provides what downstream needs | `fitness` provides data to `lifelog` |
| **Anti-Corruption Layer** | Translate between incompatible models | Adapters transforming external API responses |
| **Published Language** | Well-documented interchange format | API response schemas |

### Domain Hierarchy

```
Level 0 (foundation):   core (errors, utils, base types)
                          ↑
Level 1 (shared):       messaging, scheduling, entropy
                          ↑
Level 2 (features):     fitness, nutrition, finance, content,
                        journaling, gratitude, home-automation
                          ↑
Level 3 (aggregators):  lifelog, health, journalist
```

**Rule:** Import DOWN only. Level 3 can use Level 2, but Level 2 cannot use Level 3.

---

## Tactical Design

### Building Blocks

| Building Block | Purpose | Identity | Mutability | Location |
|----------------|---------|----------|------------|----------|
| **Entity** | Objects with identity that persists over time | Has unique ID | Controlled mutation | `1_domains/*/entities/` |
| **Value Object** | Objects defined by their attributes, not identity | No ID, identified by value | Immutable | `1_domains/*/value-objects/` |
| **Aggregate** | Cluster of entities/value objects with a root | Root has ID | Root controls mutation | `1_domains/*/entities/` |
| **Domain Service** | Stateless operations across multiple entities | N/A | N/A | `1_domains/*/services/` |
| **Domain Event** | Something that happened in the domain | Has ID + timestamp | Immutable | `1_domains/*/events/` |
| **Repository** | Abstraction for entity persistence | N/A | N/A | `2_adapters/*/` |
| **Factory** | Complex object creation | N/A | N/A | Entity static methods |

### Entities

Entities have **identity** - two entities with identical attributes are still different if they have different IDs.

```javascript
class Session {
  #id;
  #status;
  #startTime;

  constructor({ id, status, startTime }) {
    if (!id) throw new ValidationError('id required');
    this.#id = id;
    this.#status = status;
    this.#startTime = startTime;
  }

  // Identity
  get id() { return this.#id; }

  // Behavior - entities own logic about themselves
  complete(completedAt) {
    if (this.#status !== 'active') {
      throw new DomainInvariantError('Session must be active to complete');
    }
    this.#status = 'completed';
    this.#endTime = completedAt;
  }

  // Factory method
  static create({ timestamp, startTime, ...props }) {
    return new Session({
      id: generateSessionId(timestamp),
      status: 'pending',
      startTime,
      ...props
    });
  }
}
```

**Key principles:**
- Protect invariants through controlled mutation (methods, not direct property access)
- Factory methods for creation, constructors for reconstitution
- Rich behavior, not anemic data bags

### Value Objects

Value objects have **no identity** - they are defined entirely by their attributes.

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

  // Operations return NEW instances
  add(other) { return new Distance(this.#meters + other.meters); }

  // Equality by value
  equals(other) { return this.#meters === other.meters; }
}
```

**Key principles:**
- Immutable (use `Object.freeze(this)`)
- Operations return new instances
- Equality based on attribute values
- Self-validating

**When to use value objects:**
- Measurements (Distance, Duration, Weight)
- Identifiers (ConversationId, SessionId)
- Ranges (DateRange, ZoneBounds)
- Money (Amount, Currency)
- Descriptors (ActivityType, ZoneName)

### Aggregates

An **aggregate** is a cluster of entities and value objects treated as a unit. The **aggregate root** is the entry point.

```
┌─────────────────────────────────────────┐
│  Session (Aggregate Root)               │
│  ├── id: SessionId                      │
│  ├── roster: Participant[]              │
│  ├── timeline: Timeline                 │
│  │   ├── series: HeartRateSeries[]      │
│  │   └── events: SessionEvent[]         │
│  └── snapshots: Snapshot[]              │
└─────────────────────────────────────────┘
```

**Aggregate rules:**

| Rule | Rationale |
|------|-----------|
| Reference aggregates by ID only | Prevents tight coupling between aggregates |
| Modify only through root | Root enforces invariants |
| Delete cascades to children | Children don't exist without root |
| One aggregate per transaction | Keeps transactions small |

```javascript
// GOOD - reference by ID
class Session {
  addParticipant(participantId) { ... }
}

// BAD - holds reference to other aggregate
class Session {
  addParticipant(participant: User) { ... }
}
```

### Domain Services

**Domain services** contain logic that doesn't naturally fit in an entity or value object.

```javascript
class ZoneService {
  /**
   * Find which zone contains a heart rate
   * @param {number} heartRate
   * @param {Zone[]} zones
   * @returns {Zone|null}
   */
  findZoneFor(heartRate, zones) {
    return zones.find(z => z.contains(heartRate)) || null;
  }

  /**
   * Calculate time distribution across zones
   * @param {HeartRateSample[]} samples
   * @param {Zone[]} zones
   * @returns {Map<string, number>}
   */
  calculateDistribution(samples, zones) {
    // Cross-entity logic
  }
}
```

**When to use domain services:**
- Logic spans multiple entities
- Logic doesn't belong to any single entity
- Stateless operations (no instance state)

**Domain service rules:**
- Stateless - all data via parameters
- Pure business logic - no I/O, no infrastructure
- Named with domain vocabulary

### Domain Events

**Domain events** capture something that happened in the domain.

```javascript
class SessionCompleted {
  constructor({ sessionId, completedAt, duration, participantIds }) {
    this.type = 'SessionCompleted';
    this.sessionId = sessionId;
    this.completedAt = completedAt;
    this.duration = duration;
    this.participantIds = participantIds;
    this.occurredAt = completedAt;
    Object.freeze(this);
  }
}
```

**Event rules:**
- Immutable (past cannot change)
- Named in past tense (`SessionCompleted`, `FoodLogged`)
- Contains all data needed to understand what happened
- No behavior, only data

---

## Ports and Adapters (Hexagonal Architecture)

**Ports** define what the application needs. **Adapters** implement how.

```
                    ┌─────────────────────┐
                    │   Application       │
                    │                     │
   ┌────────────────┤  Uses: Ports        ├────────────────┐
   │                │  (abstract needs)   │                │
   │                └─────────────────────┘                │
   │                          │                            │
   │                          │                            │
   ▼                          ▼                            ▼
┌──────────┐           ┌──────────┐               ┌──────────┐
│ Telegram │           │  OpenAI  │               │   YAML   │
│ Adapter  │           │ Adapter  │               │  Store   │
└──────────┘           └──────────┘               └──────────┘
```

### Port Interface Pattern

```javascript
// 3_applications/common/ports/IMessagingGateway.mjs

/**
 * @interface IMessagingGateway
 */
export class IMessagingGateway {
  async sendMessage(conversationId, text, options = {}) {
    throw new Error('IMessagingGateway.sendMessage must be implemented');
  }

  async updateMessage(conversationId, messageId, updates) {
    throw new Error('IMessagingGateway.updateMessage must be implemented');
  }
}

export function isMessagingGateway(obj) {
  return obj &&
    typeof obj.sendMessage === 'function' &&
    typeof obj.updateMessage === 'function';
}
```

### Adapter Implementation Pattern

```javascript
// 2_adapters/telegram/TelegramMessagingAdapter.mjs

import { IMessagingGateway } from '#apps/common/ports/IMessagingGateway.mjs';

export class TelegramMessagingAdapter extends IMessagingGateway {
  #token;
  #httpClient;

  constructor({ token, httpClient, logger }) {
    super();
    this.#token = token;
    this.#httpClient = httpClient;
    this.#logger = logger;
  }

  async sendMessage(conversationId, text, options = {}) {
    // Telegram-specific implementation
    const response = await this.#httpClient.post(
      `https://api.telegram.org/bot${this.#token}/sendMessage`,
      { chat_id: conversationId, text, ...this.#mapOptions(options) }
    );
    return { messageId: response.data.result.message_id };
  }
}
```

### Port Naming Conventions

| Port Type | Naming | Example |
|-----------|--------|---------|
| Gateway (outbound) | `I{Noun}Gateway` | `IAIGateway`, `IMessagingGateway` |
| Repository (persistence) | `I{Entity}Repository` | `ISessionRepository`, `IFoodLogRepository` |
| Service (external) | `I{Noun}Service` | `ITranscriptionService` |

### Port Location

| Layer | Contains |
|-------|----------|
| `3_applications/*/ports/` | Port interfaces (what the app needs) |
| `2_adapters/*/` | Adapter implementations (how it's done) |

---

## Repository Pattern

**Repositories** abstract persistence. The domain thinks in entities; the adapter handles storage.

### Repository Interface

```javascript
// 3_applications/fitness/ports/ISessionRepository.mjs

export class ISessionRepository {
  async save(session) {
    throw new Error('save must be implemented');
  }

  async findById(sessionId) {
    throw new Error('findById must be implemented');
  }

  async findByDate(date, householdId) {
    throw new Error('findByDate must be implemented');
  }

  async delete(sessionId) {
    throw new Error('delete must be implemented');
  }
}
```

### Repository Implementation

```javascript
// 2_adapters/persistence/yaml/YamlSessionDatastore.mjs

import { ISessionRepository } from '#apps/fitness/ports/ISessionRepository.mjs';
import { Session } from '#domains/fitness/entities/Session.mjs';

export class YamlSessionDatastore extends ISessionRepository {
  #dataRoot;
  #io;

  constructor({ dataRoot, io, logger }) {
    super();
    this.#dataRoot = dataRoot;
    this.#io = io;
    this.#logger = logger;
  }

  async save(session) {
    const path = this.#buildPath(session.id);
    const data = this.#toYaml(session);  // Adapter handles serialization
    await this.#io.writeFile(path, data);
  }

  async findById(sessionId) {
    const path = this.#buildPath(sessionId);
    const data = await this.#io.readFile(path);
    if (!data) return null;
    return this.#toDomain(data);  // Adapter handles reconstitution
  }

  // Private: serialization lives in adapter, not domain
  #toYaml(session) {
    return {
      id: session.id,
      start_time: session.startTime.toISOString(),
      status: session.status,
      // ...
    };
  }

  #toDomain(data) {
    return Session.fromData({
      id: data.id,
      startTime: new Date(data.start_time),
      status: data.status,
      // ...
    });
  }
}
```

### Repository Rules

| Rule | Rationale |
|------|-----------|
| Returns domain entities, not raw data | Domain layer works with entities |
| Handles serialization internally | Domain doesn't know storage format |
| One repository per aggregate root | Aggregates are persistence units |
| Query methods return entities or collections | Never return storage primitives |

---

## Use Case Pattern

**Use cases** orchestrate domain logic to accomplish application-specific goals.

```javascript
// 3_applications/fitness/usecases/CompleteSession.mjs

export class CompleteSession {
  #sessionRepository;
  #eventPublisher;
  #logger;

  constructor({ sessionRepository, eventPublisher, logger }) {
    if (!sessionRepository) throw new Error('sessionRepository required');
    this.#sessionRepository = sessionRepository;
    this.#eventPublisher = eventPublisher;
    this.#logger = logger || console;
  }

  /**
   * Complete an active session
   * @param {Object} input
   * @param {string} input.sessionId
   * @param {Date} input.completedAt
   * @returns {Promise<Session>}
   */
  async execute({ sessionId, completedAt }) {
    // 1. Load aggregate
    const session = await this.#sessionRepository.findById(sessionId);
    if (!session) {
      throw new EntityNotFoundError('Session', sessionId);
    }

    // 2. Execute domain logic
    session.complete(completedAt);

    // 3. Persist changes
    await this.#sessionRepository.save(session);

    // 4. Publish domain event (optional)
    if (this.#eventPublisher) {
      await this.#eventPublisher.publish(new SessionCompleted({
        sessionId: session.id,
        completedAt,
        duration: session.getDurationMs(),
        participantIds: session.roster.map(p => p.id)
      }));
    }

    this.#logger.info?.('session.completed', { sessionId });
    return session;
  }
}
```

### Use Case Rules

| Rule | Rationale |
|------|-----------|
| Single responsibility | One use case = one business operation |
| Receives abstract dependencies | No concrete adapters |
| Coordinates, doesn't implement | Domain logic lives in domain |
| Returns domain entities | Not DTOs or primitives |

---

## Error Classification

| Error Type | Meaning | Layer | Example |
|------------|---------|-------|---------|
| `ValidationError` | Input doesn't meet requirements | Domain | Invalid duration, missing required field |
| `DomainInvariantError` | Business rule would be violated | Domain | Can't complete inactive session |
| `EntityNotFoundError` | Referenced entity doesn't exist | Domain/App | Session not found |
| `InfrastructureError` | External system failure | Adapter | Database connection failed |
| `ApplicationError` | Use case precondition failed | Application | User not authorized |

### Error Structure

```javascript
class ValidationError extends Error {
  constructor(message, { code, field, value } = {}) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;     // 'INVALID_DURATION'
    this.field = field;   // 'duration'
    this.value = value;   // -5
  }
}
```

### Error Handling by Layer

| Layer | Throws | Catches |
|-------|--------|---------|
| Domain | `ValidationError`, `DomainInvariantError` | Nothing (pure) |
| Adapter | `InfrastructureError` | Vendor-specific errors → wraps |
| Application | `ApplicationError`, `EntityNotFoundError` | Domain errors → decides handling |
| API | HTTP errors | All errors → maps to responses |

---

## Ubiquitous Language

**Use domain vocabulary everywhere** - in code, comments, logs, API responses, and conversations.

| Instead of | Use | Why |
|------------|-----|-----|
| `user` | `participant` (in fitness) | Domain term |
| `record` | `session`, `entry`, `log` | Specific to context |
| `item` | `activity`, `food`, `transaction` | Context-specific |
| `data` | `timeline`, `series`, `snapshot` | Meaningful |
| `object` | Entity or value object name | Precise |
| `thing` | Never | Meaningless |

### In Code

```javascript
// BAD
const data = await getData(id);
if (data.status === 'done') { ... }

// GOOD
const session = await sessionRepository.findById(sessionId);
if (session.isCompleted()) { ... }
```

### In Logs

```javascript
// BAD
logger.info('processed item', { id: x.id });

// GOOD
logger.info('session.completed', { sessionId: session.id, duration: session.getDurationMs() });
```

### In Comments

```javascript
// BAD
// Check if the thing is finished

// GOOD
// A session can only be completed if it's currently active
```

---

## Testing by Layer

| Layer | Test Type | What to Test | Dependencies |
|-------|-----------|--------------|--------------|
| Domain | Unit | Entity behavior, invariants, value objects | None (pure) |
| Domain Service | Unit | Cross-entity logic | Domain entities only |
| Application | Integration | Use case orchestration | Fake repositories |
| Adapter | Integration | External system interaction | Real or mock externals |
| API | E2E | Request/response cycle | Full stack or mocks |

### Domain Testing (Pure)

```javascript
describe('Session', () => {
  it('throws when completing inactive session', () => {
    const session = new Session({ id: '123', status: 'pending' });
    expect(() => session.complete(new Date()))
      .toThrow(DomainInvariantError);
  });
});
```

### Use Case Testing (Fakes)

```javascript
describe('CompleteSession', () => {
  it('completes and persists session', async () => {
    const fakeRepo = new FakeSessionRepository();
    const session = Session.create({ ... });
    await fakeRepo.save(session);
    session.start();
    await fakeRepo.save(session);

    const useCase = new CompleteSession({ sessionRepository: fakeRepo });
    const result = await useCase.execute({
      sessionId: session.id,
      completedAt: new Date()
    });

    expect(result.isCompleted()).toBe(true);
    expect(await fakeRepo.findById(session.id)).toEqual(result);
  });
});
```

---

## Quick Reference

### Layer Responsibilities

| Layer | Responsibility | Contains |
|-------|---------------|----------|
| `0_system` | Infrastructure wiring | Config, logging, bootstrap, utils |
| `1_domains` | Pure business logic | Entities, value objects, domain services |
| `2_adapters` | External integrations | Repositories, gateways, API clients |
| `3_applications` | Use case orchestration | Use cases, containers, ports |
| `4_api` | HTTP presentation | Routes, handlers, middleware |

### File Locations

| Artifact | Location |
|----------|----------|
| Entity | `1_domains/{domain}/entities/{Entity}.mjs` |
| Value Object | `1_domains/{domain}/value-objects/{ValueObject}.mjs` |
| Domain Service | `1_domains/{domain}/services/{Service}Service.mjs` |
| Port Interface | `3_applications/{app}/ports/I{Name}.mjs` |
| Adapter | `2_adapters/{category}/{Name}Adapter.mjs` |
| Repository | `2_adapters/persistence/{format}/{Entity}Datastore.mjs` |
| Use Case | `3_applications/{app}/usecases/{Verb}{Noun}.mjs` |
| Container | `3_applications/{app}/{App}Container.mjs` |
| Router | `4_api/v1/routers/{domain}.mjs` |

### Decision Tree

```
Is this logic specific to DaylightStation?
├── No → 1_domains (universal truth)
└── Yes → 3_applications (application-specific)

Does this touch external systems?
├── Yes → 2_adapters (implementation)
└── No → Is it orchestration?
         ├── Yes → 3_applications
         └── No → 1_domains

Does this handle HTTP?
├── Yes → 4_api
└── No → (check above)
```

---

## Related Documentation

- [Domain Layer Guidelines](./domain-layer-guidelines.md)
- [Application Layer Guidelines](./application-layer-guidelines.md)
- [System Layer Guidelines](./system-layer-guidelines.md)
- [API Layer Guidelines](./api-layer-guidelines.md)
