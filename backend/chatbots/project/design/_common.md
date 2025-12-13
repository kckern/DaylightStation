# Common Architecture Design

> **Status:** Design Phase  
> **Last Updated:** December 2024

---

## 1. Overview

This document defines the shared architectural foundations for all chatbots in the DaylightStation platform. Individual bots (Nutribot, Journalist, Devobot, Homebot) extend this common base with domain-specific functionality.

### 1.1 Critical Constraints

| Constraint | Description |
|------------|-------------|
| **Data Access** | All persistence MUST use `loadFile`/`saveFile` from `backend/lib/io.mjs`. No bypassing allowed. |
| **Testing** | All tests MUST reside in `backend/chatbots/_tests/`. Tests MUST NOT depend on Telegram integration. |
| **Phase Completion** | Each implementation phase MUST complete with all unit tests passing. |

---

## 2. Core Principles

### 2.1 Hexagonal Architecture (Ports & Adapters)

```
                     ┌─────────────────────────────────────┐
                     │         DRIVING ADAPTERS            │
                     │  (Express, CLI, Test Harness)       │
                     └──────────────┬──────────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                                                                           │
│    ┌─────────────────────────────────────────────────────────────────┐   │
│    │                    APPLICATION LAYER                             │   │
│    │                                                                  │   │
│    │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │   │
│    │   │  Use Case 1  │  │  Use Case 2  │  │  Use Case N  │          │   │
│    │   └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │   │
│    │          │                 │                 │                   │   │
│    │          └─────────────────┼─────────────────┘                   │   │
│    │                            │                                     │   │
│    │                            ▼                                     │   │
│    │   ┌────────────────────────────────────────────────────────┐    │   │
│    │   │              PORT INTERFACES (Contracts)               │    │   │
│    │   │  IMessagingGateway │ IAIGateway │ IRepository │ etc.   │    │   │
│    │   └────────────────────────────────────────────────────────┘    │   │
│    └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                      │
│    ┌───────────────────────────────┴───────────────────────────────┐     │
│    │                       DOMAIN LAYER                             │     │
│    │                                                                │     │
│    │   Entities │ Value Objects │ Domain Services │ Domain Events   │     │
│    │                        (PURE - No I/O)                         │     │
│    └────────────────────────────────────────────────────────────────┘     │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                     ┌─────────────────────────────────────┐
                     │         DRIVEN ADAPTERS             │
                     │  (Telegram, OpenAI, File I/O)       │
                     └─────────────────────────────────────┘
```

### 2.2 Layer Rules

| Layer | Imports From | Exports To | Contains |
|-------|--------------|------------|----------|
| **Domain** | Nothing (pure) | Application | Entities, Value Objects, Domain Services |
| **Application** | Domain, Port Interfaces | Adapters | Use Cases, Mappers |
| **Infrastructure** | Domain, Application (ports) | Application (implements ports) | Adapters for external services |
| **Adapters** | Application | External callers | HTTP handlers, CLI, tests |

### 2.3 Dependency Injection

All bots use a container pattern for dependency injection:

```
┌─────────────────────────────────────────────────────────────────┐
│                     CONTAINER PATTERN                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   container.mjs                                                 │
│   ├── registerInfrastructure()                                  │
│   │   ├── messagingGateway: TelegramGateway | MockGateway       │
│   │   ├── aiGateway: OpenAIGateway | MockGateway                │
│   │   ├── repository: FileRepository | InMemoryRepository       │
│   │   └── logger: ProductionLogger | TestLogger                 │
│   │                                                             │
│   ├── registerUseCases()                                        │
│   │   └── Each use case receives its dependencies               │
│   │                                                             │
│   └── resolve(useCaseName)                                      │
│       └── Returns fully wired use case instance                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Shared Domain Model

### 3.1 Value Objects (Common)

```
┌─────────────────────────────────────────────────────────────────┐
│                    SHARED VALUE OBJECTS                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ChatId                                                        │
│   ├── botId: string                                             │
│   ├── userId: string                                            │
│   ├── toString(): "b{botId}_u{userId}"                          │
│   └── static parse(str): ChatId                                 │
│                                                                 │
│   UserId                                                        │
│   └── value: string (Telegram user ID)                          │
│                                                                 │
│   BotId                                                         │
│   └── value: string (Telegram bot ID)                           │
│                                                                 │
│   MessageId                                                     │
│   └── value: number (Telegram message ID)                       │
│                                                                 │
│   Timestamp                                                     │
│   ├── unix: number                                              │
│   ├── timezone: string                                          │
│   └── toDate(): Date                                            │
│                                                                 │
│   DateRange                                                     │
│   ├── start: Date                                               │
│   └── end: Date                                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Common Entities

```
┌─────────────────────────────────────────────────────────────────┐
│                    SHARED ENTITIES                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Message                                                       │
│   ├── id: MessageId                                             │
│   ├── chatId: ChatId                                            │
│   ├── timestamp: Timestamp                                      │
│   ├── senderId: UserId                                          │
│   ├── senderName: string                                        │
│   ├── text: string                                              │
│   └── foreignKey: Record<string, any>                           │
│                                                                 │
│   ConversationState                                             │
│   ├── chatId: ChatId                                            │
│   ├── currentFlow: string | null                                │
│   ├── flowData: Record<string, any>                             │
│   ├── lastActivity: Timestamp                                   │
│   └── ttl: number (seconds until expiry)                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Port Interfaces (Contracts)

### 4.1 IMessagingGateway

```
┌─────────────────────────────────────────────────────────────────┐
│                    IMessagingGateway                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   METHODS:                                                      │
│   ─────────────────────────────────────────────────────────     │
│   sendMessage(chatId, text, options?) → Promise<{messageId}>    │
│   │  options:                                                   │
│   │    choices?: string[][] | Object[][]  (keyboard buttons)    │
│   │    inline?: boolean                   (inline keyboard)     │
│   │    saveMessage?: boolean              (persist to history)  │
│   │    parseMode?: 'Markdown' | 'HTML'                          │
│   │                                                             │
│   sendImage(chatId, imageUrl, caption?) → Promise<{messageId}>  │
│   │                                                             │
│   updateMessage(chatId, messageId, updates) → Promise<void>     │
│   │  updates:                                                   │
│   │    text?: string                                            │
│   │    choices?: string[][]                                     │
│   │    caption?: string                                         │
│   │                                                             │
│   updateKeyboard(chatId, messageId, choices) → Promise<void>    │
│   │                                                             │
│   deleteMessage(chatId, messageId) → Promise<void>              │
│   │                                                             │
│   transcribeVoice(voiceData) → Promise<string>                  │
│   │                                                             │
│   getFileUrl(fileId) → Promise<string>                          │
│                                                                 │
│   IMPLEMENTATIONS:                                              │
│   ─────────────────────────────────────────────────────────     │
│   • TelegramGateway  - Production Telegram Bot API              │
│   • ConsoleGateway   - CLI testing (stdout/stdin)               │
│   • MockGateway      - Unit testing (in-memory)                 │
│   • DiscordGateway   - Future platform support                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 IAIGateway

```
┌─────────────────────────────────────────────────────────────────┐
│                    IAIGateway                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   METHODS:                                                      │
│   ─────────────────────────────────────────────────────────     │
│   chat(messages, options?) → Promise<string>                    │
│   │  messages: {role: 'system'|'user'|'assistant', content}[]   │
│   │  options:                                                   │
│   │    model?: string                                           │
│   │    maxTokens?: number                                       │
│   │    temperature?: number                                     │
│   │    jsonMode?: boolean                                       │
│   │                                                             │
│   chatWithImage(messages, imageUrl, options?) → Promise<string> │
│   │                                                             │
│   transcribe(audioBuffer) → Promise<string>                     │
│   │                                                             │
│   embedText(text) → Promise<number[]>                           │
│                                                                 │
│   IMPLEMENTATIONS:                                              │
│   ─────────────────────────────────────────────────────────     │
│   • OpenAIGateway    - GPT-4o, Whisper                          │
│   • AnthropicGateway - Claude (future)                          │
│   • MockAIGateway    - Deterministic responses for testing      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4.3 IRepository (Generic)

```
┌─────────────────────────────────────────────────────────────────┐
│                    IRepository<T>                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   METHODS:                                                      │
│   ─────────────────────────────────────────────────────────     │
│   save(entity: T) → Promise<T>                                  │
│   │                                                             │
│   findById(id: string) → Promise<T | null>                      │
│   │                                                             │
│   findAll(filter?: Partial<T>) → Promise<T[]>                   │
│   │                                                             │
│   update(id: string, changes: Partial<T>) → Promise<T>          │
│   │                                                             │
│   delete(id: string) → Promise<void>                            │
│   │                                                             │
│   exists(id: string) → Promise<boolean>                         │
│                                                                 │
│   IMPLEMENTATIONS:                                              │
│   ─────────────────────────────────────────────────────────     │
│   • FileRepository<T>     - YAML/JSON file persistence          │
│   • InMemoryRepository<T> - Testing                             │
│   • SQLiteRepository<T>   - Future: structured queries          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4.4 IConversationStateStore

```
┌─────────────────────────────────────────────────────────────────┐
│                    IConversationStateStore                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   PURPOSE:                                                      │
│   Manages ephemeral conversation state (cursor) per chat.       │
│   State expires after TTL to prevent stale data issues.         │
│                                                                 │
│   METHODS:                                                      │
│   ─────────────────────────────────────────────────────────     │
│   get(chatId) → Promise<ConversationState | null>               │
│   │                                                             │
│   set(chatId, state) → Promise<void>                            │
│   │                                                             │
│   update(chatId, changes) → Promise<ConversationState>          │
│   │                                                             │
│   clear(chatId) → Promise<void>                                 │
│   │                                                             │
│   clearFlow(chatId, flowName) → Promise<void>                   │
│                                                                 │
│   IMPLEMENTATIONS:                                              │
│   ─────────────────────────────────────────────────────────     │
│   • FileStateStore    - File-based (current approach)           │
│   • RedisStateStore   - Future: distributed caching             │
│   • InMemoryStore     - Testing                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Shared Infrastructure

### 5.1 Configuration Management

```
┌─────────────────────────────────────────────────────────────────┐
│                    CONFIGURATION HIERARCHY                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   config/                                                       │
│   ├── _common.yml          # Shared across all bots             │
│   │   ├── logging.level                                         │
│   │   ├── timezone                                              │
│   │   ├── paths.data                                            │
│   │   ├── paths.icons                                           │
│   │   ├── paths.fonts                                           │
│   │   └── rateLimit.default                                     │
│   │                                                             │
│   ├── nutribot.yml         # Nutribot-specific                  │
│   │   ├── telegram.token                                        │
│   │   ├── telegram.botId                                        │
│   │   ├── openai.model                                          │
│   │   ├── reporting.calorieThresholds                           │
│   │   └── upc.providers[]                                       │
│   │                                                             │
│   └── journalist.yml       # Journalist-specific                │
│       ├── telegram.token                                        │
│       ├── telegram.botId                                        │
│       ├── journaling.prompts[]                                  │
│       └── quiz.categories[]                                     │
│                                                                 │
│   LOADING ORDER:                                                │
│   1. _common.yml (base)                                         │
│   2. {bot}.yml (overrides/extends)                              │
│   3. Environment variables (secrets, final override)            │
│   4. Validation via Zod schema                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Logging Standard

```
┌─────────────────────────────────────────────────────────────────┐
│                    STRUCTURED LOGGING                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   FORMAT: Single-line JSON per log entry                        │
│                                                                 │
│   REQUIRED FIELDS:                                              │
│   {                                                             │
│     "ts": "2024-12-13T10:30:00.000Z",  // ISO timestamp         │
│     "level": "info",                    // error|warn|info|debug│
│     "subsystem": "chatbots",            // Always "chatbots"    │
│     "bot": "nutribot",                  // Bot identifier       │
│     "msg": "webhook.received",          // Event name           │
│     "traceId": "abc-123-def"            // Request correlation  │
│   }                                                             │
│                                                                 │
│   OPTIONAL FIELDS:                                              │
│   {                                                             │
│     "chatId": "b123_u456",              // Chat context         │
│     "durationMs": 150,                  // Timing               │
│     "error": { ... },                   // Error details        │
│     "context": { ... }                  // Additional data      │
│   }                                                             │
│                                                                 │
│   LOG LEVELS:                                                   │
│   • error  - Failures requiring attention                       │
│   • warn   - Unexpected but handled conditions                  │
│   • info   - Normal operations (requests, responses)            │
│   • debug  - Detailed debugging (disabled in production)        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 5.3 Error Handling

```
┌─────────────────────────────────────────────────────────────────┐
│                    ERROR TAXONOMY                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   DomainError (base)                                            │
│   ├── ValidationError                                           │
│   │   └── Invalid input data (user error)                       │
│   │   └── HTTP: 400 Bad Request                                 │
│   │                                                             │
│   ├── NotFoundError                                             │
│   │   └── Requested entity doesn't exist                        │
│   │   └── HTTP: 404 Not Found                                   │
│   │                                                             │
│   ├── ConflictError                                             │
│   │   └── State conflict (duplicate, concurrent edit)           │
│   │   └── HTTP: 409 Conflict                                    │
│   │                                                             │
│   ├── BusinessRuleError                                         │
│   │   └── Domain logic violation                                │
│   │   └── HTTP: 422 Unprocessable Entity                        │
│   │                                                             │
│   InfrastructureError (base)                                    │
│   ├── ExternalServiceError                                      │
│   │   └── Telegram, OpenAI, UPC APIs failed                     │
│   │   └── HTTP: 502 Bad Gateway                                 │
│   │                                                             │
│   ├── RateLimitError                                            │
│   │   └── Too many requests to external service                 │
│   │   └── HTTP: 429 Too Many Requests                           │
│   │                                                             │
│   └── PersistenceError                                          │
│       └── File I/O, database failure                            │
│       └── HTTP: 500 Internal Server Error                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 5.4 Rate Limiting

```
┌─────────────────────────────────────────────────────────────────┐
│                    RATE LIMITING STRATEGY                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   TOKEN BUCKET ALGORITHM                                        │
│   ─────────────────────────────────────────────────────────     │
│   • Bucket fills at constant rate (tokens/second)               │
│   • Each request consumes one token                             │
│   • If bucket empty, request waits or fails                     │
│                                                                 │
│   RATE LIMIT SCOPES:                                            │
│   ─────────────────────────────────────────────────────────     │
│   Global:                                                       │
│   • OpenAI API: 20 calls/minute (all bots combined)             │
│                                                                 │
│   Per-Bot:                                                      │
│   • Telegram send: 30 messages/second per bot                   │
│   • Report generation: 1 per chat per 10 seconds                │
│                                                                 │
│   Per-User:                                                     │
│   • Webhook processing: 5 requests/second per chat              │
│   • AI calls: 10/minute per chat                                │
│                                                                 │
│   INTERFACE:                                                    │
│   ─────────────────────────────────────────────────────────     │
│   rateLimiter.tryAcquire(key, cost=1) → boolean                 │
│   rateLimiter.waitForToken(key, timeoutMs) → Promise<boolean>   │
│   rateLimiter.getRemaining(key) → number                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. Data Access Layer (MANDATORY)

### 6.1 Core Constraint

**ALL persistence operations MUST use `loadFile` and `saveFile` from `backend/lib/io.mjs`.**

```
┌─────────────────────────────────────────────────────────────────┐
│                    DATA ACCESS CONSTRAINT                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ❌ FORBIDDEN:                                                 │
│   • Direct fs.readFileSync / fs.writeFileSync                   │
│   • Direct YAML parsing (js-yaml)                               │
│   • Any new file I/O utilities                                  │
│   • Database connections (SQLite, Redis, etc.)                  │
│                                                                 │
│   ✅ REQUIRED:                                                  │
│   • import { loadFile, saveFile } from '../../lib/io.mjs'       │
│   • All repositories MUST use loadFile/saveFile                 │
│   • Test doubles (InMemoryRepository) are permitted             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 io.mjs API Contract

```javascript
// Load YAML file, returns parsed object or null
loadFile(path: string): object | null
// - path is relative to process.env.path.data
// - Automatically tries .yaml then .yml extension
// - Returns null if file doesn't exist
// - Creates empty file if missing (auto-touch)

// Save object to YAML file
saveFile(path: string, data: object): boolean
// - path is relative to process.env.path.data
// - Creates directories as needed
// - Uses write queue to prevent concurrent writes
// - Returns true on success
```

### 6.3 FileRepository Implementation Pattern

```
┌─────────────────────────────────────────────────────────────────┐
│                    FILE REPOSITORY PATTERN                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   import { loadFile, saveFile } from '../../lib/io.mjs';        │
│                                                                 │
│   class FileNutrilogRepository {                                │
│     constructor(basePath = 'nutribot/nutrilog') {               │
│       this.basePath = basePath;                                 │
│     }                                                           │
│                                                                 │
│     #getPath(chatId) {                                          │
│       return `${this.basePath}/${chatId}`;                      │
│     }                                                           │
│                                                                 │
│     async findAll(chatId) {                                     │
│       const data = loadFile(this.#getPath(chatId));             │
│       return data ? Object.values(data) : [];                   │
│     }                                                           │
│                                                                 │
│     async save(chatId, entity) {                                │
│       const data = loadFile(this.#getPath(chatId)) || {};       │
│       data[entity.uuid] = entity;                               │
│       saveFile(this.#getPath(chatId), data);                    │
│       return entity;                                            │
│     }                                                           │
│                                                                 │
│     async findById(chatId, uuid) {                              │
│       const data = loadFile(this.#getPath(chatId));             │
│       return data?.[uuid] || null;                              │
│     }                                                           │
│   }                                                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 6.4 Data Model Tiers (Bronze/Silver/Gold)

```
┌─────────────────────────────────────────────────────────────────┐
│                    DATA MODEL TIERS                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   BRONZE LAYER: Raw Input Data                                  │
│   ─────────────────────────────────────────────────────────     │
│   • Captured exactly as received                                │
│   • Minimal transformation                                      │
│   • Examples: NutriLog, JournalMessage                          │
│   • Path: nutribot/nutrilog/{chatId}.yaml                       │
│                                                                 │
│   SILVER LAYER: Validated/Processed Data                        │
│   ─────────────────────────────────────────────────────────     │
│   • Cleaned, validated, enriched                                │
│   • Business logic applied                                      │
│   • Examples: NutriListItem, ConversationEntry                  │
│   • Path: nutribot/nutrilist/{chatId}.yaml                      │
│                                                                 │
│   GOLD LAYER: Aggregated/Derived Data                           │
│   ─────────────────────────────────────────────────────────     │
│   • Pre-computed aggregations                                   │
│   • Optimized for reads                                         │
│   • Examples: NutriDay, DailyJournalSummary                     │
│   • Path: nutribot/nutriday/{chatId}.yaml                       │
│                                                                 │
│   DATA FLOW:                                                    │
│   User Input → [Bronze] → Processing → [Silver] → Aggregation → [Gold]
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. Testing Strategy (MANDATORY)

### 7.1 Test Location

**ALL tests MUST be in `backend/chatbots/_tests/`**

```
backend/chatbots/_tests/
├── _lib/                          # Shared infrastructure tests
│   ├── config.test.mjs
│   ├── errors.test.mjs
│   ├── logging.test.mjs
│   └── utils.test.mjs
│
├── domain/                        # Common domain tests
│   ├── ChatId.test.mjs
│   ├── MessageId.test.mjs
│   └── Timestamp.test.mjs
│
├── nutribot/                      # Nutribot tests
│   ├── domain/
│   │   ├── NoomColor.test.mjs
│   │   ├── Portion.test.mjs
│   │   ├── MacroBreakdown.test.mjs
│   │   └── FoodItem.test.mjs
│   ├── usecases/
│   │   ├── LogFoodFromImage.test.mjs
│   │   ├── AcceptFoodLog.test.mjs
│   │   └── GenerateDailyReport.test.mjs
│   └── integration/
│       └── FoodLoggingFlow.test.mjs
│
├── journalist/                    # Journalist tests
│   ├── domain/
│   ├── usecases/
│   └── integration/
│
└── helpers/                       # Test utilities
    ├── TestAdapter.mjs
    ├── MockMessagingGateway.mjs
    ├── MockAIGateway.mjs
    └── fixtures/
```

### 7.2 Test Independence Constraint

```
┌─────────────────────────────────────────────────────────────────┐
│                    TEST INDEPENDENCE                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ❌ TESTS MUST NOT:                                            │
│   • Call real Telegram API                                      │
│   • Call real OpenAI API                                        │
│   • Require network connectivity                                │
│   • Depend on external services                                 │
│   • Use real bot tokens                                         │
│                                                                 │
│   ✅ TESTS MUST:                                                │
│   • Use MockMessagingGateway for all messaging                  │
│   • Use MockAIGateway for all AI calls                          │
│   • Use InMemoryRepository or isolated temp files               │
│   • Be runnable in CI without secrets                           │
│   • Complete in under 100ms per test                            │
│   • Be deterministic (no randomness unless seeded)              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 7.3 Test Pyramid

```
┌─────────────────────────────────────────────────────────────────┐
│                    TEST PYRAMID                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                    ┌─────────────┐                              │
│                    │ Integration │  ~10% - Full flow tests      │
│                    │   Tests     │  using TestAdapter           │
│                    └──────┬──────┘                              │
│                           │                                     │
│                ┌──────────┴──────────┐                          │
│                │    Use Case Tests   │  ~30% - Single use case  │
│                │   (with mocks)      │  with mocked dependencies│
│                └──────────┬──────────┘                          │
│                           │                                     │
│         ┌─────────────────┴─────────────────┐                   │
│         │          Unit Tests               │  ~60% - Pure      │
│         │  (domain entities, services)      │  functions,       │
│         │                                   │  value objects    │
│         └───────────────────────────────────┘                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 7.4 Phase Completion Criteria

```
┌─────────────────────────────────────────────────────────────────┐
│                    PHASE COMPLETION CHECKLIST                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Each implementation phase is ONLY considered complete when:   │
│                                                                 │
│   □ All planned files are created                               │
│   □ All unit tests for new code exist in _tests/                │
│   □ All unit tests pass (npm test)                              │
│   □ Test coverage meets minimum (80% for domain layer)          │
│   □ No linting errors                                           │
│   □ Integration tests (if applicable) pass                      │
│   □ Documentation updated                                       │
│                                                                 │
│   COMMAND TO VERIFY:                                            │
│   npm test -- --grep "Phase{N}"                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 7.5 TestAdapter Pattern

```
┌─────────────────────────────────────────────────────────────────┐
│                    TEST ADAPTER                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   PURPOSE: Simulate complete chatbot flows without Telegram     │
│                                                                 │
│   class TestAdapter {                                           │
│     constructor(options: {                                      │
│       bot: 'nutribot' | 'journalist',                           │
│       userId: string,                                           │
│       mockAIResponses?: Map<RegExp, string>                     │
│     })                                                          │
│                                                                 │
│     // Simulate user actions                                    │
│     async sendText(text: string): Promise<void>                 │
│     async sendPhoto(base64: string): Promise<void>              │
│     async sendVoice(buffer: Buffer): Promise<void>              │
│     async pressButton(text: string): Promise<void>              │
│     async sendCommand(cmd: string): Promise<void>               │
│                                                                 │
│     // Inspect bot responses                                    │
│     getLastBotMessage(): { text, buttons, image? }              │
│     getAllBotMessages(): Message[]                              │
│     getMessageCount(): number                                   │
│                                                                 │
│     // Inspect state                                            │
│     getRepository(name: string): InMemoryRepository             │
│     getConversationState(): ConversationState                   │
│                                                                 │
│     // Control                                                  │
│     reset(): void                                               │
│     setAIResponse(pattern: RegExp, response: string): void      │
│   }                                                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. Webhook Processing Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                    WEBHOOK PIPELINE                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   INCOMING REQUEST                                              │
│         │                                                       │
│         ▼                                                       │
│   ┌─────────────────┐                                           │
│   │ 1. TRACING      │  Assign traceId, start timer              │
│   └────────┬────────┘                                           │
│            │                                                    │
│            ▼                                                    │
│   ┌─────────────────┐                                           │
│   │ 2. VALIDATION   │  Verify payload structure                 │
│   └────────┬────────┘                                           │
│            │                                                    │
│            ▼                                                    │
│   ┌─────────────────┐                                           │
│   │ 3. IDEMPOTENCY  │  Check (botId+messageId) not processed    │
│   └────────┬────────┘                                           │
│            │                                                    │
│            ▼                                                    │
│   ┌─────────────────┐                                           │
│   │ 4. RATE LIMIT   │  Check per-user rate limits               │
│   └────────┬────────┘                                           │
│            │                                                    │
│            ▼                                                    │
│   ┌─────────────────┐                                           │
│   │ 5. PARSE EVENT  │  Determine event type:                    │
│   │                 │  • message.text                           │
│   │                 │  • message.photo                          │
│   │                 │  • message.voice                          │
│   │                 │  • callback_query                         │
│   └────────┬────────┘                                           │
│            │                                                    │
│            ▼                                                    │
│   ┌─────────────────┐                                           │
│   │ 6. ROUTE        │  Select use case based on event type      │
│   │                 │  and conversation state                   │
│   └────────┬────────┘                                           │
│            │                                                    │
│            ▼                                                    │
│   ┌─────────────────┐                                           │
│   │ 7. EXECUTE      │  Run use case with injected deps          │
│   └────────┬────────┘                                           │
│            │                                                    │
│            ▼                                                    │
│   ┌─────────────────┐                                           │
│   │ 8. RESPOND      │  Always return 200 to Telegram            │
│   │                 │  (prevents retry storms)                  │
│   └────────┬────────┘                                           │
│            │                                                    │
│            ▼                                                    │
│   ┌─────────────────┐                                           │
│   │ 9. LOG          │  Structured log with timing               │
│   └─────────────────┘                                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. Testing Infrastructure

### 7.1 Test Doubles

```
┌─────────────────────────────────────────────────────────────────┐
│                    TEST DOUBLE STRATEGY                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   MockMessagingGateway                                          │
│   ├── sentMessages: Message[]      (capture for assertions)     │
│   ├── simulateCallback(data)       (trigger button press)       │
│   └── simulateMessage(text)        (trigger text input)         │
│                                                                 │
│   MockAIGateway                                                 │
│   ├── responses: Map<prompt, response>  (deterministic)         │
│   ├── setResponse(prompt, response)                             │
│   └── calls: {prompt, options}[]   (capture for assertions)     │
│                                                                 │
│   InMemoryRepository<T>                                         │
│   ├── data: Map<id, T>                                          │
│   ├── reset()                      (clear between tests)        │
│   └── seed(items: T[])             (set up test data)           │
│                                                                 │
│   TestClock                                                     │
│   ├── now: Date                    (controllable time)          │
│   ├── advance(ms)                  (move time forward)          │
│   └── setTimezone(tz)              (test timezone handling)     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 Test Adapter

```
┌─────────────────────────────────────────────────────────────────┐
│                    TEST ADAPTER USAGE                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   // Example: Testing food logging flow                         │
│                                                                 │
│   const testAdapter = new TestAdapter({                         │
│     bot: 'nutribot',                                            │
│     userId: 'test-user-123',                                    │
│   });                                                           │
│                                                                 │
│   // Simulate sending a photo                                   │
│   await testAdapter.sendPhoto('base64-image-data');             │
│                                                                 │
│   // Assert bot responded with food detection                   │
│   const response = testAdapter.getLastBotMessage();             │
│   expect(response.text).toContain('🟢');                        │
│   expect(response.buttons).toContain('✅ Accept');              │
│                                                                 │
│   // Simulate pressing Accept button                            │
│   await testAdapter.pressButton('✅ Accept');                   │
│                                                                 │
│   // Assert food was saved                                      │
│   const nutrilist = testAdapter.getRepository('nutrilist');     │
│   expect(nutrilist.findAll()).toHaveLength(1);                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. Directory Structure (Common)

```
backend/chatbots/
├── _lib/                              # Shared infrastructure
│   ├── config/
│   │   ├── ConfigLoader.mjs           # Load & merge configs
│   │   ├── ConfigSchema.mjs           # Zod validation schemas
│   │   └── index.mjs
│   │
│   ├── errors/
│   │   ├── DomainError.mjs
│   │   ├── InfrastructureError.mjs
│   │   └── index.mjs
│   │
│   ├── logging/
│   │   ├── Logger.mjs                 # Structured logger
│   │   ├── RequestLogger.mjs          # Express middleware
│   │   └── index.mjs
│   │
│   ├── utils/
│   │   ├── time.mjs                   # Timezone utilities
│   │   ├── retry.mjs                  # Retry with backoff
│   │   ├── ratelimit.mjs              # Token bucket
│   │   ├── result.mjs                 # Result<T,E> monad
│   │   └── index.mjs
│   │
│   └── index.mjs                      # Barrel export
│
├── domain/                            # Pure domain (shared)
│   ├── value-objects/
│   │   ├── ChatId.mjs
│   │   ├── MessageId.mjs
│   │   ├── Timestamp.mjs
│   │   └── index.mjs
│   │
│   ├── entities/
│   │   ├── Message.mjs
│   │   ├── ConversationState.mjs
│   │   └── index.mjs
│   │
│   └── index.mjs
│
├── application/                       # Application layer (shared ports)
│   ├── ports/
│   │   ├── IMessagingGateway.mjs
│   │   ├── IAIGateway.mjs
│   │   ├── IRepository.mjs
│   │   ├── IConversationStateStore.mjs
│   │   └── index.mjs
│   │
│   └── index.mjs
│
├── infrastructure/                    # Shared adapter implementations
│   ├── messaging/
│   │   ├── TelegramGateway.mjs
│   │   ├── ConsoleGateway.mjs
│   │   └── MockMessagingGateway.mjs
│   │
│   ├── ai/
│   │   ├── OpenAIGateway.mjs
│   │   └── MockAIGateway.mjs
│   │
│   ├── persistence/
│   │   ├── FileRepository.mjs
│   │   └── InMemoryRepository.mjs
│   │
│   └── index.mjs
│
├── adapters/                          # Entry point adapters
│   ├── http/
│   │   ├── middleware/
│   │   │   ├── tracing.mjs
│   │   │   ├── validation.mjs
│   │   │   └── idempotency.mjs
│   │   └── index.mjs
│   │
│   ├── cli/
│   │   └── CLIAdapter.mjs
│   │
│   └── test/
│       └── TestAdapter.mjs
│
├── design/                            # Design documentation
│   ├── _common.md                     # This file
│   ├── nutribot.md                    # Nutribot-specific design
│   └── journalist.md                  # Journalist-specific design
│
├── nutribot/                          # Nutribot implementation
├── journalist/                        # Journalist implementation
├── devobot/                           # (Future)
├── homebot/                           # (Future)
│
└── router.mjs                         # Root Express router
```

---

## 9. Cross-Cutting Concerns

### 9.1 Idempotency

```
┌─────────────────────────────────────────────────────────────────┐
│                    IDEMPOTENCY STRATEGY                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   KEY: hash(botId + messageId + callbackData?)                  │
│                                                                 │
│   STORAGE:                                                      │
│   • In-memory Map with TTL (5 minutes)                          │
│   • Future: Redis for distributed deployments                   │
│                                                                 │
│   BEHAVIOR:                                                     │
│   1. On webhook receive, compute idempotency key                │
│   2. If key exists in store → return cached response            │
│   3. If key doesn't exist → process, store result, return       │
│                                                                 │
│   WHY:                                                          │
│   Telegram may retry webhooks on timeout. Without idempotency,  │
│   the same photo/text could be logged multiple times.           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 9.2 Metrics

```
┌─────────────────────────────────────────────────────────────────┐
│                    METRICS CATALOG                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   COUNTERS:                                                     │
│   • chatbot_webhook_total{bot, status}                          │
│   • chatbot_usecase_total{bot, usecase, status}                 │
│   • chatbot_external_call_total{service, status}                │
│   • chatbot_rate_limit_hit_total{bot, scope}                    │
│                                                                 │
│   HISTOGRAMS:                                                   │
│   • chatbot_webhook_duration_ms{bot}                            │
│   • chatbot_external_call_duration_ms{service}                  │
│   • chatbot_usecase_duration_ms{bot, usecase}                   │
│                                                                 │
│   GAUGES:                                                       │
│   • chatbot_active_conversations{bot}                           │
│   • chatbot_rate_limit_remaining{bot, scope}                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 10. Security Considerations

| Concern | Mitigation |
|---------|------------|
| **API Key Exposure** | Keys in env vars, never logged, redacted in errors |
| **Input Validation** | Zod schemas for all external input |
| **Rate Limiting** | Per-user and global limits |
| **File Path Traversal** | Sanitize all file paths, use allowlist |
| **PII in Logs** | Redact user messages, keep only metadata |
| **Webhook Authentication** | Telegram webhook verification (future) |

---

*This document defines the shared architectural foundation. See `nutribot.md` and `journalist.md` for bot-specific designs.*
