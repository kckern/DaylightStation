# Backend DDD Architecture

## Overview

This document defines the Domain-Driven Design architecture for the entire backend system. It establishes clear boundaries between domains, adapters, infrastructure, and application layers.

**Guiding metaphor:** Domain is heaven (pure, abstract), adapter is earth (concrete, messy reality).

**Related documents:**
- [Unified Domain Backend Design](./2026-01-10-unified-domain-backend-design.md) - Content domain specifics (media, apps, games)
- [API Consumer Inventory](./2026-01-10-api-consumer-inventory.md) - Frontend migration impact

---

## 1. Folder Structure

```
backend/src/
├── domains/                        # HEAVEN - pure, testable, no external deps
│   ├── core/                       # Shared kernel
│   │   ├── entities/
│   │   │   ├── User.ts
│   │   │   └── Household.ts
│   │   └── ports/
│   │       └── IIdentityResolver.ts
│   │
│   ├── content/                    # Content domain
│   │   ├── capabilities/           # What content CAN DO
│   │   │   ├── Listable.ts
│   │   │   ├── Playable.ts
│   │   │   ├── Queueable.ts
│   │   │   └── Openable.ts
│   │   ├── entities/
│   │   │   ├── Item.ts
│   │   │   ├── WatchState.ts
│   │   │   └── Queue.ts
│   │   ├── ports/
│   │   │   └── IContentSource.ts
│   │   └── services/
│   │       └── QueueService.ts
│   │
│   ├── messaging/                  # Messaging domain
│   │   ├── entities/
│   │   │   ├── Conversation.ts
│   │   │   └── Message.ts
│   │   └── ports/
│   │       └── IMessagingPlatform.ts
│   │
│   ├── fitness/                    # Fitness domain
│   │   ├── entities/
│   │   │   ├── Session.ts
│   │   │   ├── Participant.ts
│   │   │   └── Zone.ts
│   │   └── services/
│   │
│   ├── finance/                    # Finance domain
│   │   ├── entities/
│   │   │   ├── Budget.ts
│   │   │   ├── Transaction.ts
│   │   │   ├── Mortgage.ts
│   │   │   └── Account.ts
│   │   ├── ports/
│   │   │   └── ITransactionSource.ts
│   │   └── services/
│   │       ├── BudgetService.ts
│   │       └── MortgageService.ts
│   │
│   ├── nutrition/                  # Nutrition domain
│   │   └── entities/
│   │       ├── FoodLog.ts
│   │       └── Meal.ts
│   │
│   └── journaling/                 # Journaling domain
│       └── entities/
│           └── JournalEntry.ts
│
├── adapters/                       # EARTH - implements ports, talks to outside
│   ├── content/                    # Implements IContentSource
│   │   ├── media/
│   │   │   ├── plex/
│   │   │   ├── filesystem/
│   │   │   └── local-content/
│   │   ├── apps/
│   │   │   └── native/
│   │   └── games/
│   │       └── retroarch/
│   │
│   ├── messaging/                  # Implements IMessagingPlatform
│   │   ├── telegram/
│   │   └── discord/
│   │
│   ├── ai/                         # Implements IAIProvider
│   │   ├── openai/
│   │   └── claude/
│   │
│   ├── persistence/                # Implements IPersistence
│   │   └── yaml/
│   │
│   ├── finance/                    # Implements ITransactionSource
│   │   └── buxfer/
│   │
│   └── home-automation/
│       └── homeassistant/
│
├── infrastructure/                 # Wiring, cross-cutting concerns
│   ├── bootstrap.ts                # Constructs & injects everything
│   ├── registry.ts                 # Typed sub-registries
│   ├── config/
│   ├── scheduling/
│   └── logging/
│
├── applications/                   # Orchestration layer (grouped by app)
│   ├── nutribot/                   # Nutrition tracking app
│   │   ├── bot/                    # Telegram bot handlers
│   │   └── jobs/                   # Scheduled jobs
│   ├── journalist/                 # Journaling app
│   │   ├── bot/                    # Telegram bot handlers
│   │   └── jobs/                   # Morning debrief, etc.
│   ├── fitness/                    # Fitness tracking app
│   │   └── jobs/                   # Garmin sync, session jobs
│   └── finance/                    # Finance app
│       └── jobs/                   # Budget sync, payroll
│
└── api/                            # HTTP entry points
    ├── routers/
    └── middleware/
```

---

## 2. Layer Responsibilities

### 2.1 Domains (Heaven)

Pure business logic. No external dependencies. No I/O.

| Domain | Entities | Purpose |
|--------|----------|---------|
| `core` | User, Household | Shared kernel - identity concepts used by all domains |
| `content` | Item, Queue, WatchState | Browsable, playable, queueable content (media, apps, games) |
| `messaging` | Conversation, Message | Chat interactions across platforms |
| `fitness` | Session, Participant, Zone | Workout tracking |
| `finance` | Budget, Transaction, Mortgage, Account | Budget tracking, mortgage amortization |
| `nutrition` | FoodLog, Meal | Food/nutrition tracking |
| `journaling` | JournalEntry | Personal journaling |

**Rules:**
- Never import from `adapters/`, `infrastructure/`, or `api/`
- Define ports (interfaces) that adapters implement
- Contain only entities, value objects, domain services, and ports

### 2.2 Adapters (Earth)

Implement domain ports. Handle external integrations.

| Category | Adapters | Implements |
|----------|----------|------------|
| `content/media` | Plex, Filesystem, LocalContent | `IContentSource` |
| `content/apps` | Native | `IContentSource` |
| `content/games` | RetroArch | `IContentSource` |
| `messaging` | Telegram, Discord | `IMessagingPlatform` |
| `ai` | OpenAI, Claude | `IAIProvider` |
| `persistence` | YAML | `IPersistence` |
| `finance` | Buxfer | `ITransactionSource` |
| `home-automation` | HomeAssistant | `IHomeAutomation` |

**Rules:**
- Depend on domain ports (interfaces)
- Never depend on other adapters
- Handle all external I/O, API calls, file access

### 2.3 Infrastructure

Cross-cutting concerns and wiring.

| Component | Purpose |
|-----------|---------|
| `bootstrap.ts` | Constructs adapters, wires dependencies |
| `registry.ts` | Typed sub-registries for adapter lookup |
| `config/` | Configuration loading (ConfigService) |
| `scheduling/` | Job runner infrastructure |
| `logging/` | Logging infrastructure |

**Rules:**
- Only place that knows concrete adapter types
- Performs dependency injection
- Application layer receives interfaces, not implementations

### 2.4 Applications

Use case orchestration. Thin coordination layer.

| App | Components | Purpose |
|-----|------------|---------|
| `nutribot` | bot/, jobs/ | Nutrition tracking via Telegram |
| `journalist` | bot/, jobs/ | Journaling via Telegram |
| `fitness` | jobs/ | Fitness sync (Garmin, Strava) |
| `finance` | jobs/ | Budget sync, payroll (Buxfer) |

**Rules:**
- Receive dependencies via injection (interfaces only)
- Never import concrete adapters
- Coordinate between domains and infrastructure

### 2.5 API

HTTP entry points. Request/response translation.

**Rules:**
- Thin layer: parse request, call application/domain, format response
- No business logic
- Handle HTTP concerns (auth, errors, serialization)

---

## 3. Port Interfaces

### 3.1 Content Domain

```typescript
// domains/content/ports/IContentSource.ts
interface IContentSource {
  readonly source: string;
  readonly prefixes: PrefixMapping[];

  getItem(id: string): Promise<Item | null>;
  getList(id: string): Promise<Listable[]>;
  resolvePlayables(id: string): Promise<Playable[]>;
}
```

### 3.2 Messaging Domain

```typescript
// domains/messaging/ports/IMessagingPlatform.ts
interface IMessagingPlatform {
  readonly platform: string;

  sendMessage(conversationId: string, content: MessageContent): Promise<void>;
  onMessage(handler: (msg: IncomingMessage) => void): void;
}
```

### 3.3 AI (Infrastructure)

```typescript
// infrastructure/ai/ports/IAIProvider.ts
interface IAIProvider {
  readonly provider: string;

  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
  transcribe(audio: Buffer): Promise<string>;
}
```

### 3.4 Finance Domain

```typescript
// domains/finance/ports/ITransactionSource.ts
interface ITransactionSource {
  readonly source: string;

  getTransactions(options: TransactionQuery): Promise<Transaction[]>;
  getAccountBalances(accounts: string[]): Promise<AccountBalance[]>;
}

// domains/finance/services/BudgetService.ts
class BudgetService {
  compileBudget(config: BudgetConfig, transactions: Transaction[]): Budget;
  reconcile(budget: Budget, transactions: Transaction[]): ReconcileResult;
}

// domains/finance/services/MortgageService.ts
class MortgageService {
  calculateAmortization(mortgage: Mortgage, paymentPlans: PaymentPlan[]): AmortizationSchedule;
  processPayments(mortgage: Mortgage, transactions: Transaction[]): MortgageStatus;
}
```

---

## 4. Typed Sub-Registries

Single registry with typed categories:

```typescript
// infrastructure/registry.ts
class AdapterRegistry {
  content: ContentSourceRegistry;     // IContentSource implementations
  messaging: MessagingRegistry;       // IMessagingPlatform implementations
  ai: AIProviderRegistry;             // IAIProvider implementations

  constructor() {
    this.content = new ContentSourceRegistry();
    this.messaging = new MessagingRegistry();
    this.ai = new AIProviderRegistry();
  }
}
```

**Usage in application layer (adapter-agnostic):**

```typescript
// Application receives interface, not implementation
const source: IContentSource = registry.content.resolve(compoundId);
const item = await source.getItem(localId);
```

---

## 5. Wiring and Bootstrap

```typescript
// infrastructure/bootstrap.ts
export function createRegistry(config: AppConfig): AdapterRegistry {
  const registry = new AdapterRegistry();

  // Content adapters
  registry.content.register(new PlexAdapter(config.plex));
  registry.content.register(new FilesystemAdapter(config.paths));
  registry.content.register(new LocalContentAdapter(config.paths));

  // Messaging adapters
  registry.messaging.register(new TelegramAdapter(config.telegram));

  // AI adapters
  registry.ai.register(new OpenAIAdapter(config.openai));

  return registry;
}

// Application receives interfaces via injection
export function createNutriBot(registry: AdapterRegistry): NutriBot {
  return new NutriBot(
    registry.messaging.get('telegram'),  // IMessagingPlatform
    registry.ai.get('openai'),           // IAIProvider
    new NutritionRepository()
  );
}
```

---

## 6. Jobs

Jobs are application-layer orchestration on a schedule:

```typescript
// applications/jobs/finance/BudgetSyncJob.ts
class BudgetSyncJob implements IJob {
  name = 'budget-sync';
  schedule = '0 6 * * *';

  constructor(
    private budgetService: BudgetService,
    private buxferAdapter: IBuxferAdapter
  ) {}

  async execute(): Promise<JobResult> {
    const transactions = await this.buxferAdapter.fetch();
    await this.budgetService.reconcile(transactions);
    return { success: true };
  }
}
```

---

## 7. Dependency Rules

```
┌─────────────────────────────────────────────────────────┐
│  api/                                                   │
│  - Depends on: applications, domains                    │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│  applications/                                          │
│  - Depends on: domains (entities + ports)               │
│  - Receives: adapters via injection (as interfaces)     │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│  domains/                                               │
│  - Depends on: NOTHING external                         │
│  - Defines: ports (interfaces)                          │
└─────────────────────────────────────────────────────────┘
                      ▲
                      │ implements
┌─────────────────────┴───────────────────────────────────┐
│  adapters/                                              │
│  - Depends on: domain ports                             │
│  - Implements: domain interfaces                        │
└─────────────────────────────────────────────────────────┘
                      ▲
                      │ constructs & injects
┌─────────────────────┴───────────────────────────────────┐
│  infrastructure/bootstrap.ts                            │
│  - Knows: all concrete types                            │
│  - Wires: everything together                           │
└─────────────────────────────────────────────────────────┘
```

---

## 8. Key Principles

| Principle | Implementation |
|-----------|----------------|
| Domain is heaven | No imports from adapters/, infrastructure/, api/ |
| Adapter is earth | Implements ports, handles messy external reality |
| Application is adapter-agnostic | Receives `IContentSource`, never `PlexAdapter` |
| Single wiring point | `bootstrap.ts` is only file that knows all concrete types |
| Typed sub-registries | `registry.content`, `registry.messaging`, `registry.ai` |
| Content > Media | Media, apps, games are all content types with capabilities |

---

## 9. Migration Strategy

### 9.1 Strangler Fig Pattern

Wrap legacy code and gradually replace it from inside out:

```
backend/
├── index.js              # Entry point - routes to _legacy OR src/
├── _legacy/              # Current code, untouched
│   ├── api.mjs
│   ├── routers/
│   ├── lib/
│   ├── chatbots/
│   └── jobs/
└── src/                  # New DDD structure
    ├── domains/
    ├── adapters/
    ├── infrastructure/
    ├── applications/
    └── api/
```

### 9.2 Domain-by-Domain Big Bang

Since there's only one client (frontend), migrations can be big bang per domain:

1. **Build** new API in `src/`
2. **Switch** frontend to new endpoints
3. **Delete** legacy code for that domain
4. **Repeat** for next domain

No dual-write concerns. No sync issues. Old endpoint becomes dead code immediately after frontend switch.

### 9.3 Migration Order

| Phase | Domain | Rationale |
|-------|--------|-----------|
| 0 | Skeleton | Set up folder structure, bootstrap, registry |
| 1 | Content (media) | Biggest, most documented, existing design doc |
| 2 | Fitness | Self-contained, clear boundaries |
| 3 | Messaging + Bots | Already well-structured in chatbots/ |
| 4 | Jobs | Depends on domains being migrated first |
| 5 | Everything else | Finance, health, home, etc. |

### 9.4 File Mapping

| Current Location | Target Location |
|------------------|-----------------|
| `backend/lib/plex.mjs` | `src/adapters/content/media/plex/` |
| `backend/lib/io.mjs` | `src/adapters/persistence/yaml/` |
| `backend/lib/ai/OpenAIGateway.mjs` | `src/adapters/ai/openai/` |
| `backend/lib/config/` | `src/infrastructure/config/` |
| `backend/lib/budget.mjs` | `src/domains/finance/services/` |
| `backend/lib/budgetlib/` | `src/domains/finance/services/` |
| `backend/lib/buxfer.mjs` | `src/adapters/finance/buxfer/` |
| `backend/routers/*.mjs` | `src/api/routers/` |
| `backend/chatbots/bots/nutribot/` | `src/applications/nutribot/bot/` |
| `backend/chatbots/bots/journalist/` | `src/applications/journalist/bot/` |
| `backend/jobs/finance/` | `src/applications/finance/jobs/` |
| `backend/jobs/fitness/` | `src/applications/fitness/jobs/` |

### 9.5 Phase 0: Skeleton Setup

Before migrating any domain, establish the structure:

```bash
# 1. Move existing code to _legacy
mv backend/api.mjs backend/_legacy/
mv backend/routers backend/_legacy/
mv backend/lib backend/_legacy/
mv backend/chatbots backend/_legacy/
mv backend/jobs backend/_legacy/

# 2. Create proxy entry point
# backend/index.js - routes all traffic to _legacy/api.mjs

# 3. Create new structure
mkdir -p backend/src/{domains,adapters,infrastructure,applications,api}

# 4. Verify everything still works via proxy
```

### 9.6 Success Criteria

Migration complete when:
- [ ] `backend/_legacy/` is empty and deleted
- [ ] All endpoints served from `backend/src/`
- [ ] No imports from `_legacy` anywhere
- [ ] Frontend fully migrated to new API paths
