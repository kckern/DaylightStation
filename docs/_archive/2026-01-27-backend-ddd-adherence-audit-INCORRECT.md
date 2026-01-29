# Backend DDD Architecture Adherence Audit

**Date:** 2026-01-27
**Scope:** `backend/src/` directory
**Status:** Evaluation

---

## Executive Summary

The backend demonstrates **strong adherence** to Domain-Driven Design principles with a well-structured layered architecture. The codebase shows intentional design with clear separation of concerns, though some areas show pragmatic deviations from strict DDD.

**Overall Grade: B+**

| Principle | Grade | Notes |
|-----------|-------|-------|
| Layer Separation | A | Clear boundaries between layers |
| Dependency Rule | A- | Inward dependencies mostly respected |
| Domain Purity | B+ | Domains mostly pure, some infrastructure leakage |
| Port/Adapter Pattern | B | Ports exist but inconsistent placement |
| Entity Design | B+ | Good entities with behavior |
| Value Objects | B- | Present but underutilized |
| Aggregate Roots | C+ | Implicit rather than explicit |
| Bounded Contexts | B | Good domain separation |

---

## Architecture Overview

### Layer Structure

```
src/
├── 0_system/        # Infrastructure: bootstrap, config, eventbus, utils
├── 1_domains/       # Core: entities, services, pure business logic
├── 2_adapters/      # Bridges: external integrations, persistence
├── 3_applications/  # Orchestration: use cases, containers
└── 4_api/           # Presentation: HTTP routes, handlers
```

**Observation:** The numbered prefix convention provides clear layer ordering and visual hierarchy. The documentation in `README.md` articulates the "heaven/earth" metaphor well.

### Domains Identified

| Domain | Entities | Services | Ports | Maturity |
|--------|----------|----------|-------|----------|
| `content` | Item, WatchState | ContentSourceRegistry | IContentSource | High |
| `fitness` | Session | SessionService | - | High |
| `messaging` | Conversation, Message, Notification | ConversationService, NotificationService | - | High |
| `scheduling` | Job, JobState, JobExecution | SchedulerService | - | Medium |
| `lifelog` | NutriLog, FoodItem | LifelogAggregator | ILifelogExtractor | Medium |
| `gratitude` | - | GratitudeService | - | Medium |
| `health` | - | HealthAggregationService | - | Medium |
| `journaling` | - | JournalService | - | Medium |
| `nutrition` | - | FoodLogService | - | Medium |
| `journalist` | - | - | - | Low |
| `entropy` | - | - | - | Low |
| `finance` | - | - | - | Low |
| `home-automation` | - | - | - | Low |
| `core` | - | - | errors, utils | Foundation |

---

## Strengths

### 1. Clean Layer Boundaries

The dependency rule is well enforced. Domain layer (`1_domains`) has **no imports from adapters**:

```bash
grep -r "from '.*2_adapters" backend/src/1_domains  # Returns nothing
```

### 2. Rich Domain Entities

Entities contain behavior, not just data. Example from `Session.mjs`:

```javascript
class Session {
  getDurationMs() { ... }
  isActive() { ... }
  addParticipant(participant) { ... }
  end(endTime) { ... }
  toJSON() { ... }
  static fromJSON(data) { ... }
}
```

This follows the "rich domain model" pattern - entities know how to validate and transform themselves.

### 3. Domain Errors

Custom domain errors exist in `1_domains/core/errors/`:
- `ValidationError`
- `EntityNotFoundError`
- `DomainInvariantError`

### 4. Well-Designed Adapters

Adapters properly implement interfaces and handle external concerns. Example `OpenAIAdapter`:
- Extends `IAIGateway` interface
- Handles retry logic, rate limiting
- Converts external responses to domain-friendly formats
- Metrics and observability built-in

### 5. Comprehensive Bootstrap/Composition Root

`0_system/bootstrap.mjs` acts as a proper composition root:
- Creates all dependencies
- Wires adapters to domain services
- Returns configured routers
- No business logic

### 6. Use Case Pattern in Application Layer

`3_applications/` contains proper use cases like `ProcessGratitudeInput`:
- Single responsibility
- Dependencies injected via constructor
- Clear execute() method
- Domain-agnostic (uses ports)

---

## Areas for Improvement

### 1. Port Placement (Medium Priority)

**Issue:** Ports are defined in `3_applications/*/ports/` instead of `1_domains/*/ports/`.

In canonical DDD/hexagonal architecture, ports belong to the domain layer because they define **what the domain needs**, not how it's implemented.

**Current:**
```
3_applications/
├── shared/ports/
│   ├── IAIGateway.mjs
│   ├── IMessagingGateway.mjs
│   └── IConversationDatastore.mjs
```

**Canonical:**
```
1_domains/
├── shared/ports/
│   ├── IAIGateway.mjs
│   └── IConversationDatastore.mjs
```

**Impact:** Low - functionality is correct, just non-standard location.

### 2. Missing Aggregate Roots (Medium Priority)

**Issue:** Aggregates are implicit. There's no explicit marker for aggregate root entities.

The `Session` entity appears to be an aggregate root (owns `roster`, `timeline`, `snapshots`) but this isn't formalized.

**Recommendation:** Consider adding:
```javascript
// Mark aggregate roots explicitly
class Session extends AggregateRoot {
  // ...
}
```

### 3. Underutilized Value Objects (Low Priority)

**Issue:** Value objects exist (`ConversationId.mjs`) but are sparse. Many implicit value objects are plain objects.

**Examples of candidates:**
- `SessionId` (14-digit format validation)
- `HeartRateZone` (enum + behavior)
- `Duration` (parsing, formatting)
- `Participant` (in Session.roster)

### 4. Domain Services with Infrastructure Concerns (Low Priority)

**Issue:** Some domain services accept infrastructure-level dependencies.

`ConversationService.mjs`:
```javascript
constructor({ conversationStore, logger }) {
  this.conversationStore = conversationStore;  // Port (OK)
  this.logger = logger || console;             // Infrastructure (questionable)
}
```

**Recommendation:** Logger should be injected at adapter/application layer, not domain.

### 5. Extractors in Domain Layer (Low Priority)

**Issue:** `1_domains/lifelog/extractors/` contains transformation logic that reads from specific file formats (YAML). This is borderline infrastructure.

**Current:**
```javascript
class StravaExtractor {
  get filename() { return 'strava'; }  // File system awareness
  extractForDate(data, date) { ... }
}
```

**Consideration:** These could arguably be adapters that transform external data into domain entities.

### 6. Backward Compatibility Re-exports (Low Priority)

**Issue:** Some domain index files re-export from adapters/applications for backward compatibility:

```javascript
// content/index.mjs
export { validateAdapter, ContentSourceBase } from '#apps/content/ports/IContentSource.mjs';
```

This inverts the dependency direction (domain knows about application layer).

---

## Metrics

### File Distribution by Layer

| Layer | Files | % |
|-------|-------|---|
| 0_system | ~40 | 12% |
| 1_domains | ~80 | 25% |
| 2_adapters | ~120 | 37% |
| 3_applications | ~40 | 12% |
| 4_api | ~50 | 14% |

### Domain Coverage

- **17 bounded contexts** identified in `1_domains/`
- **21 adapter families** in `2_adapters/`
- **Good ratio** of domains to adapters (adapters are expected to be numerous)

---

## Recommendations

### High Priority
1. **Document aggregate boundaries** - Add comments or base classes identifying aggregate roots

### Medium Priority
2. **Consider relocating ports** to `1_domains/*/ports/` for canonical structure
3. **Add domain events** for cross-aggregate communication (currently implicit in EventBus)

### Low Priority
4. **Extract more value objects** from primitive types
5. **Remove logger from domain services** - push to application/adapter layer
6. **Audit backward-compat re-exports** - consider deprecation path

---

## Conclusion

The backend architecture demonstrates thoughtful DDD implementation with strong fundamentals:

- **Layer isolation is excellent** - the core domain is protected from infrastructure
- **Entity design is good** - behavior lives with data
- **Adapter pattern is well-executed** - clean separation from external systems
- **Bootstrap composition is proper** - all wiring in infrastructure layer

The deviations noted are pragmatic trade-offs rather than architectural violations. The codebase is maintainable, testable, and follows the spirit of DDD even where it diverges from strict canonical form.

**Related code:** `backend/src/README.md`, `docs/_wip/plans/2026-01-10-backend-ddd-architecture.md`
