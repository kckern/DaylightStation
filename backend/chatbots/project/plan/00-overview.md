# Implementation Plan Overview

> **Version:** 1.1.0  
> **Status:** Planning  
> **Last Updated:** December 2024

---

## Executive Summary

This document outlines the phased implementation plan for refactoring the DaylightStation chatbot subsystem from a monolithic architecture to a layered hexagonal (Ports & Adapters) architecture.

The plan is divided into **6 phases** spanning approximately **10 weeks**, with each phase building on the previous one. The approach prioritizes:

1. **Foundation first** - Shared infrastructure before bot-specific code
2. **Parallel running** - Feature flags to toggle between old and new paths
3. **Incremental migration** - One use case at a time
4. **Test-driven** - Tests written alongside or before implementation

---

## Critical Constraints

### 1. Testing Requirements
- **ALL tests MUST reside in `backend/chatbots/_tests/`**
- Tests MUST NOT depend on Telegram bot integration
- Tests MUST mimic full flows using mocks
- **Each phase is ONLY complete when all tests pass**
- Run tests: `npm test -- --grep "Phase{N}"`

### 2. Data Access Layer
- **ALL persistence MUST use `loadFile`/`saveFile` from `backend/lib/io.mjs`**
- No direct `fs` operations
- No bypassing or altering `io.mjs`
- InMemoryRepository allowed for tests only

### 3. Data Model Tiers (Nutribot)
| Tier | Entity | Storage Path | Purpose |
|------|--------|--------------|---------|
| **Bronze** | `NutriLog` | `nutribot/nutrilog/{chatId}.yaml` | Raw input data |
| **Silver** | `NutriListItem` | `nutribot/nutrilist/{chatId}.yaml` | Validated entries |
| **Gold** | `NutriDay` | `nutribot/nutriday/{chatId}.yaml` | Pre-computed aggregates |

---

## Document Index

| Document | Description | Phase |
|----------|-------------|-------|
| [01-foundation.md](./01-foundation.md) | Shared infrastructure, config, logging, errors | Phase 1 |
| [02-ports-infrastructure.md](./02-ports-infrastructure.md) | Port interfaces, adapters (Telegram, OpenAI, File I/O) | Phase 2 |
| [03-nutribot-domain.md](./03-nutribot-domain.md) | Nutribot domain model & core use cases | Phase 3 |
| [04-nutribot-journalist.md](./04-nutribot-journalist.md) | Nutribot advanced + Journalist domain & core | Phase 4 |
| [05-integration.md](./05-integration.md) | HTTP adapters, routing, containers, Journalist advanced | Phase 5 |
| [06-migration.md](./06-migration.md) | Migration strategy, feature flags, rollout | Phase 6 |

---

## Phase Timeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        IMPLEMENTATION TIMELINE                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Week 1-2: PHASE 1 - Foundation                                             │
│   ─────────────────────────────────────────────────────────────────────────  │
│   • Shared infrastructure (_lib/)                                            │
│   • Configuration management                                                 │
│   • Logging & error handling                                                 │
│   • Common domain value objects                                              │
│   ✓ GATE: All _tests/_lib/*.test.mjs pass                                   │
│                                                                              │
│   Week 3-4: PHASE 2 - Ports & Infrastructure                                 │
│   ─────────────────────────────────────────────────────────────────────────  │
│   • Port interface definitions                                               │
│   • TelegramGateway implementation                                           │
│   • OpenAIGateway implementation                                             │
│   • File repository implementations (using io.mjs)                           │
│   • Mock implementations for testing                                         │
│   ✓ GATE: All _tests/infrastructure/*.test.mjs pass                          │
│                                                                              │
│   Week 5-6: PHASE 3 - Nutribot Core                                          │
│   ─────────────────────────────────────────────────────────────────────────  │
│   • Nutribot domain model (Bronze/Silver/Gold)                               │
│   • Core use cases (LogFoodFromImage, LogFoodFromText)                       │
│   • UPC gateway and use case                                                 │
│   • Accept/Discard/Revise use cases                                          │
│   ✓ GATE: All _tests/nutribot/domain/*.test.mjs pass                         │
│   ✓ GATE: All _tests/nutribot/usecases/*.test.mjs pass                       │
│                                                                              │
│   Week 7-8: PHASE 4 - Nutribot Advanced + Journalist Core                    │
│   ─────────────────────────────────────────────────────────────────────────  │
│   • Nutribot: Reporting, Coaching, Adjustments                               │
│   • Journalist domain model                                                  │
│   • Journalist core use cases (ProcessTextEntry, journalPrompt)              │
│   ✓ GATE: All _tests/nutribot/*.test.mjs pass                                │
│   ✓ GATE: All _tests/journalist/domain/*.test.mjs pass                       │
│                                                                              │
│   Week 9: PHASE 5 - Integration                                              │
│   ─────────────────────────────────────────────────────────────────────────  │
│   • HTTP adapters and routing                                                │
│   • Container wiring                                                         │
│   • Integration testing                                                      │
│   • Journalist advanced use cases (Quiz, Analysis)                           │
│   ✓ GATE: All _tests/**/*.test.mjs pass                                      │
│                                                                              │
│   Week 10: PHASE 6 - Migration & Rollout                                     │
│   ─────────────────────────────────────────────────────────────────────────  │
│   • Feature flag system                                                      │
│   • Parallel running validation                                              │
│   • Production rollout (canary → full)                                       │
│   • Legacy code removal                                                      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure (Final State)

```
backend/chatbots/
├── _lib/                              # Shared infrastructure (Phase 1)
│   ├── config/
│   │   ├── ConfigLoader.mjs
│   │   ├── ConfigSchema.mjs
│   │   └── index.mjs
│   ├── errors/
│   │   ├── DomainError.mjs
│   │   ├── InfrastructureError.mjs
│   │   └── index.mjs
│   ├── logging/
│   │   ├── Logger.mjs
│   │   ├── RequestLogger.mjs
│   │   └── index.mjs
│   ├── utils/
│   │   ├── time.mjs
│   │   ├── retry.mjs
│   │   ├── ratelimit.mjs
│   │   ├── result.mjs
│   │   └── index.mjs
│   └── index.mjs
│
├── domain/                            # Common domain (Phase 1)
│   ├── value-objects/
│   │   ├── ChatId.mjs
│   │   ├── MessageId.mjs
│   │   ├── Timestamp.mjs
│   │   └── index.mjs
│   ├── entities/
│   │   ├── Message.mjs
│   │   ├── ConversationState.mjs
│   │   └── index.mjs
│   └── index.mjs
│
├── application/                       # Shared ports (Phase 2)
│   ├── ports/
│   │   ├── IMessagingGateway.mjs
│   │   ├── IAIGateway.mjs
│   │   ├── IRepository.mjs
│   │   ├── IConversationStateStore.mjs
│   │   └── index.mjs
│   └── index.mjs
│
├── infrastructure/                    # Shared adapters (Phase 2)
│   ├── messaging/
│   │   ├── TelegramGateway.mjs
│   │   ├── ConsoleGateway.mjs
│   │   └── MockMessagingGateway.mjs
│   ├── ai/
│   │   ├── OpenAIGateway.mjs
│   │   └── MockAIGateway.mjs
│   ├── persistence/
│   │   ├── FileRepository.mjs         # Uses io.mjs loadFile/saveFile
│   │   └── InMemoryRepository.mjs     # For tests only
│   └── index.mjs
│
├── _tests/                            # ALL TESTS GO HERE (not in modules)
│   ├── _lib/
│   │   ├── config.test.mjs
│   │   ├── errors.test.mjs
│   │   └── utils.test.mjs
│   ├── domain/
│   │   ├── ChatId.test.mjs
│   │   └── Timestamp.test.mjs
│   ├── infrastructure/
│   │   ├── FileRepository.test.mjs
│   │   └── TelegramGateway.test.mjs
│   ├── nutribot/
│   │   ├── domain/
│   │   │   ├── NoomColor.test.mjs
│   │   │   ├── Portion.test.mjs
│   │   │   └── FoodItem.test.mjs
│   │   ├── usecases/
│   │   │   ├── LogFoodFromImage.test.mjs
│   │   │   └── AcceptFoodLog.test.mjs
│   │   └── integration/
│   │       └── FoodLoggingFlow.test.mjs
│   ├── journalist/
│   │   ├── domain/
│   │   ├── usecases/
│   │   └── integration/
│   └── helpers/
│       ├── TestAdapter.mjs
│       ├── MockMessagingGateway.mjs
│       ├── MockAIGateway.mjs
│       └── fixtures/
│
├── nutribot/                          # Nutribot (Phase 3-4)
│   ├── domain/
│   ├── application/
│   ├── infrastructure/
│   ├── handlers/
│   ├── container.mjs
│   └── server.mjs
│
├── journalist/                        # Journalist (Phase 4-5)
│   ├── domain/
│   ├── application/
│   ├── infrastructure/
│   ├── handlers/
│   ├── container.mjs
│   └── server.mjs
│
├── adapters/                          # HTTP adapters (Phase 5)
│   ├── http/
│   │   └── middleware/
│   ├── cli/
│   └── test/
│
├── project/                           # Documentation
│   ├── design/
│   └── plan/
│
└── router.mjs                         # Root router (updated Phase 5)
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| **Breaking production** | Feature flags, parallel running, canary deployment |
| **Scope creep** | Strict phase boundaries, defer non-essential features |
| **Test coverage gaps** | TDD approach, mock implementations from Phase 2 |
| **Integration issues** | Integration tests at each phase boundary |
| **Performance regression** | Benchmark critical paths before/after |

---

## Success Criteria

### Phase 1 Complete
- [ ] All shared infrastructure in `_lib/`
- [ ] Configuration loads and validates
- [ ] Structured logging works
- [ ] Common value objects have 100% test coverage

### Phase 2 Complete
- [ ] All port interfaces defined
- [ ] TelegramGateway sends/receives messages
- [ ] OpenAIGateway calls GPT successfully
- [ ] Mock implementations pass contract tests

### Phase 3 Complete
- [ ] Nutribot domain model complete
- [ ] LogFoodFromImage works end-to-end (new path)
- [ ] LogFoodFromText works end-to-end (new path)
- [ ] Feature flag toggles between old/new

### Phase 4 Complete
- [ ] All Nutribot use cases migrated
- [ ] Journalist domain model complete
- [ ] Journalist core use cases work

### Phase 5 Complete
- [ ] All use cases wired through containers
- [ ] HTTP adapters route correctly
- [ ] Integration tests pass

### Phase 6 Complete
- [ ] Production rollout complete
- [ ] Legacy code removed
- [ ] Documentation updated
- [ ] Team trained on new architecture

---

## Next Steps

1. Review and approve this implementation plan
2. Begin Phase 1 with `01-foundation.md`
3. Set up feature flag infrastructure
4. Create tracking issues for each phase

---

*Proceed to [01-foundation.md](./01-foundation.md) for Phase 1 implementation details.*
