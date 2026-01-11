# Phase 1: Foundation Implementation

> **Phase:** 1 of 6  
> **Duration:** Week 1-2  
> **Dependencies:** None  
> **Deliverables:** `_lib/`, common `domain/`, tests in `_tests/`

---

## Critical Constraints

1. **All tests MUST be in `backend/chatbots/_tests/`** - not in module folders
2. **Phase is ONLY complete when `npm test -- --grep "Phase1"` passes**
3. Tests must not depend on external services

---

## Objectives

1. Create shared infrastructure modules (`_lib/`)
2. Implement configuration management with validation
3. Set up structured logging
4. Define error taxonomy
5. Create common utility functions
6. Implement common domain value objects
7. **Create corresponding tests in `_tests/_lib/` and `_tests/domain/`**

---

## Task Breakdown

### 1.1 Configuration Management

**File:** `_lib/config/ConfigSchema.mjs`

```
PURPOSE: Define Zod schemas for configuration validation

SCHEMA STRUCTURE:
├── CommonConfig
│   ├── environment: 'development' | 'staging' | 'production'
│   ├── timezone: string (default: 'America/Los_Angeles')
│   ├── paths.data: string
│   ├── paths.icons: string  
│   ├── paths.fonts: string
│   └── logging.level: 'error' | 'warn' | 'info' | 'debug'
│
├── TelegramConfig
│   ├── token: string (required)
│   └── botId: string (required)
│
├── OpenAIConfig
│   ├── apiKey: string (required)
│   ├── model: string (default: 'gpt-4o')
│   ├── maxTokens: number (default: 1000)
│   └── timeout: number (default: 60000)
│
└── RateLimitConfig
    └── gptCallsPerMinute: number (default: 20)

VALIDATION:
- Fail fast on missing required fields
- Log validation errors with field paths
- Support environment variable interpolation (${VAR_NAME})

TESTS:
- Valid config passes validation
- Missing required field throws with helpful message
- Invalid enum value throws
- Environment variable interpolation works
```

**File:** `_lib/config/ConfigLoader.mjs`

```
PURPOSE: Load, merge, and validate configuration

FUNCTIONS:
├── loadConfig(botName?: string): Config
│   1. Load _common.yml as base
│   2. If botName provided, load {botName}.yml and deep merge
│   3. Interpolate environment variables
│   4. Validate against schema
│   5. Return frozen config object
│
├── interpolateEnvVars(obj: object): object
│   - Replace ${VAR_NAME} patterns with process.env values
│   - Support nested objects and arrays
│
└── deepMerge(base: object, override: object): object
    - Merge objects recursively
    - Arrays are replaced, not concatenated

CACHING:
- Cache loaded config per botName
- Expose clearConfigCache() for testing

TESTS:
- Loads common config correctly
- Merges bot-specific config over common
- Environment variable interpolation
- Caches loaded config
- clearConfigCache() works
```

---

### 1.2 Logging Infrastructure

**File:** `_lib/logging/Logger.mjs`

```
PURPOSE: Structured JSON logging

CLASS: Logger
├── constructor(context: object)
│   - Store base context (subsystem, bot, etc.)
│
├── child(extraContext): Logger
│   - Return new Logger with merged context
│
├── error(msg: string, meta?: object): void
├── warn(msg: string, meta?: object): void
├── info(msg: string, meta?: object): void
├── debug(msg: string, meta?: object): void
│   - Check log level before writing
│   - Format: JSON line to stdout
│   - Include: ts, level, subsystem, msg, ...context, ...meta
│
└── level(): string
    - Return current log level

LOG FORMAT:
{
  "ts": "2024-12-13T10:30:00.000Z",
  "level": "info",
  "subsystem": "chatbots",
  "bot": "nutribot",
  "msg": "webhook.received",
  "traceId": "abc-123",
  ...additionalFields
}

LEVEL FILTERING:
- error: 0 (always shown)
- warn: 1
- info: 2 (default)
- debug: 3

TESTS:
- Logs at correct levels
- Filters below threshold
- child() merges context correctly
- Output is valid JSON
- Timestamps are ISO format
```

**File:** `_lib/logging/RequestLogger.mjs`

```
PURPOSE: Express middleware for request lifecycle logging

FUNCTION: requestLogger(botNameOrResolver)
├── Generate traceId (from header or uuid)
├── Attach traceId to req and response header
├── Create child logger with traceId + bot
├── Attach logger to req.logger
├── Log request.start (debug level)
├── On response finish, log request.finish (info level)
│   - Include: method, path, status, durationMs
└── Call next()

TESTS:
- Generates traceId if not provided
- Uses X-Trace-Id header if present
- Attaches logger to req
- Logs start and finish
- Duration is calculated correctly
```

---

### 1.3 Error Handling

**File:** `_lib/errors/DomainError.mjs`

```
PURPOSE: Base class for domain-level errors

CLASS HIERARCHY:
DomainError (base)
├── code: string
├── context: object
├── toJSON(): { name, message, code, context }
│
├── ValidationError
│   - code: 'VALIDATION_ERROR'
│   - context includes: field, value
│
├── NotFoundError
│   - code: 'NOT_FOUND'
│   - context includes: entity, id
│
├── ConflictError
│   - code: 'CONFLICT'
│   - context includes: entity, reason
│
└── BusinessRuleError
    - code: 'BUSINESS_RULE_VIOLATION'
    - context includes: rule

HTTP MAPPING:
- ValidationError → 400
- NotFoundError → 404
- ConflictError → 409
- BusinessRuleError → 422

TESTS:
- Each error type has correct code
- toJSON() serializes correctly
- instanceof checks work
- context is preserved
```

**File:** `_lib/errors/InfrastructureError.mjs`

```
PURPOSE: Errors from external systems

CLASS HIERARCHY:
InfrastructureError (base)
├── service: string
├── originalError?: Error
│
├── ExternalServiceError
│   - code: 'EXTERNAL_SERVICE_ERROR'
│   - For: Telegram API, OpenAI API, UPC APIs
│
├── RateLimitError
│   - code: 'RATE_LIMIT_EXCEEDED'
│   - context includes: retryAfter
│
└── PersistenceError
    - code: 'PERSISTENCE_ERROR'
    - For: File I/O, future DB errors

HTTP MAPPING:
- ExternalServiceError → 502
- RateLimitError → 429
- PersistenceError → 500

TESTS:
- Wraps original error
- Preserves stack trace
- service field is set
```

---

### 1.4 Utility Functions

**File:** `_lib/utils/time.mjs`

```
PURPOSE: Timezone-aware time utilities

FUNCTIONS:
├── nowInTimezone(tz?: string): moment
│   - Default timezone from config
│   - Return moment object in specified timezone
│
├── todayInTimezone(tz?: string): string
│   - Return 'YYYY-MM-DD' in timezone
│
├── formatDate(date, format, tz?): string
│   - Format date in timezone
│
├── parseDate(str, format?, tz?): moment
│   - Parse string to moment in timezone
│
├── getTimeOfDay(date?, tz?): 'morning' | 'midday' | 'evening' | 'night'
│   - morning: 5-11
│   - midday: 11-14
│   - evening: 14-21
│   - night: 21-5
│
└── daysAgo(n, tz?): string
    - Return 'YYYY-MM-DD' for n days ago

TESTS:
- Respects timezone
- Time of day boundaries correct
- Format/parse roundtrip works
```

**File:** `_lib/utils/retry.mjs`

```
PURPOSE: Retry with exponential backoff

FUNCTION: retry(fn, options)
├── options:
│   ├── maxAttempts: number (default: 3)
│   ├── baseDelayMs: number (default: 1000)
│   ├── maxDelayMs: number (default: 30000)
│   ├── shouldRetry: (error) => boolean (default: always true)
│   └── onRetry: (error, attempt) => void (optional)
│
├── Execute fn()
├── On success, return result
├── On failure:
│   - If attempts exhausted, throw
│   - If shouldRetry returns false, throw
│   - Calculate delay: baseDelay * 2^attempt (capped at maxDelay)
│   - Add jitter: ±10%
│   - Wait, then retry
│
└── Return: Promise<T>

TESTS:
- Succeeds on first try
- Retries on failure
- Respects maxAttempts
- shouldRetry can abort early
- Delay increases exponentially
- Jitter is applied
```

**File:** `_lib/utils/ratelimit.mjs`

```
PURPOSE: Token bucket rate limiter

CLASS: RateLimiter
├── constructor(options)
│   ├── tokensPerInterval: number
│   ├── intervalMs: number
│   └── maxBurst?: number (default: tokensPerInterval)
│
├── tryAcquire(key: string, cost?: number): boolean
│   - Refill bucket based on time elapsed
│   - If tokens >= cost, consume and return true
│   - Else return false
│
├── waitForToken(key: string, timeoutMs?: number): Promise<boolean>
│   - If tryAcquire succeeds, return true
│   - Else wait until token available or timeout
│
├── getRemaining(key: string): number
│   - Return current token count for key
│
└── reset(key?: string): void
    - Reset bucket(s) to full

STORAGE:
- In-memory Map per key
- Structure: { tokens, lastRefill }

TESTS:
- Allows requests within limit
- Blocks when exhausted
- Refills over time
- Different keys are independent
- waitForToken respects timeout
```

**File:** `_lib/utils/result.mjs`

```
PURPOSE: Result<T, E> monad for error handling without exceptions

TYPES:
├── Ok<T> = { ok: true, value: T }
├── Err<E> = { ok: false, error: E }
└── Result<T, E> = Ok<T> | Err<E>

FUNCTIONS:
├── ok<T>(value: T): Ok<T>
├── err<E>(error: E): Err<E>
├── isOk<T, E>(result: Result<T, E>): result is Ok<T>
├── isErr<T, E>(result: Result<T, E>): result is Err<E>
├── map<T, U, E>(result: Result<T, E>, fn: (T) => U): Result<U, E>
├── mapErr<T, E, F>(result: Result<T, E>, fn: (E) => F): Result<T, F>
├── andThen<T, U, E>(result: Result<T, E>, fn: (T) => Result<U, E>): Result<U, E>
├── unwrap<T, E>(result: Result<T, E>): T (throws if Err)
└── unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T

TESTS:
- ok() creates Ok
- err() creates Err
- isOk/isErr type guards work
- map transforms Ok, passes through Err
- andThen chains Results
- unwrap throws on Err
- unwrapOr returns default on Err
```

---

### 1.5 Common Domain Value Objects

**File:** `domain/value-objects/ChatId.mjs`

```
PURPOSE: Composite identifier for bot+user conversation

CLASS: ChatId
├── #botId: string (private)
├── #userId: string (private)
│
├── constructor(botId: string, userId: string)
│   - Validate both are non-empty strings
│   - Store and freeze
│
├── get botId(): string
├── get userId(): string
├── toString(): string → "b{botId}_u{userId}"
├── equals(other: ChatId): boolean
│
└── static parse(str: string): ChatId
    - Parse "b123_u456" format
    - Throw ValidationError if invalid

TESTS:
- Creates valid ChatId
- Rejects empty botId/userId
- toString format correct
- parse() roundtrips
- equals() compares values
- Immutable (Object.freeze)
```

**File:** `domain/value-objects/MessageId.mjs`

```
PURPOSE: Wrapper for Telegram message ID

CLASS: MessageId
├── #value: number (private)
│
├── constructor(value: number)
│   - Validate is positive integer
│
├── get value(): number
├── toString(): string
├── equals(other: MessageId): boolean
│
└── static from(value: number | string): MessageId
    - Parse string to number if needed

TESTS:
- Creates valid MessageId
- Rejects non-positive numbers
- Rejects non-integers
- equals() compares values
```

**File:** `domain/value-objects/Timestamp.mjs`

```
PURPOSE: Timezone-aware timestamp

CLASS: Timestamp
├── #unix: number (private, seconds)
├── #timezone: string (private)
│
├── constructor(unix: number, timezone?: string)
│   - Default timezone from config
│
├── get unix(): number
├── get timezone(): string
├── toDate(): Date
├── toMoment(): moment
├── format(fmt: string): string
├── equals(other: Timestamp): boolean
│
├── static now(timezone?: string): Timestamp
├── static fromDate(date: Date, timezone?: string): Timestamp
└── static fromString(str: string, format?: string, timezone?: string): Timestamp

TESTS:
- now() returns current time
- Timezone is respected in format()
- Conversion to Date works
- equals() compares unix values
```

---

### 1.6 Common Domain Entities

**File:** `domain/entities/Message.mjs`

```
PURPOSE: Represents a chat message (sent or received)

CLASS: Message
├── id: MessageId
├── chatId: ChatId
├── timestamp: Timestamp
├── senderId: string
├── senderName: string
├── text: string
├── foreignKey: object (metadata)
│
├── constructor(props)
│   - Validate required fields
│   - Freeze object
│
└── toJSON(): object

TESTS:
- Creates valid Message
- Validates required fields
- Immutable
- toJSON() serializes correctly
```

**File:** `domain/entities/ConversationState.mjs`

```
PURPOSE: Ephemeral state for multi-turn conversations

CLASS: ConversationState
├── chatId: ChatId
├── currentFlow: string | null
├── flowData: object
├── lastActivity: Timestamp
├── ttl: number (seconds)
│
├── constructor(props)
├── isExpired(): boolean
├── withFlow(flowName: string, data: object): ConversationState
├── clearFlow(): ConversationState
├── updateActivity(): ConversationState
│
└── toJSON(): object

TESTS:
- Creates valid state
- isExpired() checks TTL
- withFlow() creates new instance with flow
- clearFlow() removes flow data
- Immutable operations
```

---

## Barrel Exports

**File:** `_lib/index.mjs`
```javascript
export * from './config/index.mjs';
export * from './errors/index.mjs';
export * from './logging/index.mjs';
export * from './utils/index.mjs';
```

**File:** `domain/index.mjs`
```javascript
export * from './value-objects/index.mjs';
export * from './entities/index.mjs';
```

---

## Testing Requirements

### Unit Tests
- Every class and function has tests
- 100% line coverage for value objects
- Edge cases documented in tests

### Test Structure
```
_lib/
├── config/
│   ├── ConfigLoader.mjs
│   └── ConfigLoader.test.mjs
├── errors/
│   ├── DomainError.mjs
│   └── DomainError.test.mjs
...

domain/
├── value-objects/
│   ├── ChatId.mjs
│   └── ChatId.test.mjs
...
```

### Test Commands
```bash
# Run all Phase 1 tests
npm test -- --grep "Phase1"

# Run with coverage
npm test -- --coverage --grep "Phase1"
```

---

## Acceptance Criteria

- [ ] `loadConfig()` returns validated config object
- [ ] Logger outputs valid JSON to stdout
- [ ] All error classes have correct HTTP mappings
- [ ] Time utilities respect configured timezone
- [ ] Rate limiter correctly throttles requests
- [ ] All value objects are immutable
- [ ] 100% test coverage for domain layer
- [ ] No circular dependencies
- [ ] **`npm test -- --grep "Phase1"` passes**

---

## Test Files Created (in `_tests/`)

```
_tests/
├── _lib/
│   ├── config.test.mjs             # ConfigLoader, ConfigSchema tests
│   ├── errors.test.mjs             # DomainError, InfrastructureError tests
│   ├── logging.test.mjs            # Logger tests
│   └── utils.test.mjs              # time, retry, ratelimit, result tests
│
└── domain/
    ├── ChatId.test.mjs
    ├── MessageId.test.mjs
    ├── Timestamp.test.mjs
    ├── Message.test.mjs
    └── ConversationState.test.mjs
```

---

## Files Created (Summary)

```
_lib/
├── config/
│   ├── ConfigSchema.mjs
│   ├── ConfigLoader.mjs
│   └── index.mjs
├── errors/
│   ├── DomainError.mjs
│   ├── InfrastructureError.mjs
│   └── index.mjs
├── logging/
│   ├── Logger.mjs
│   ├── RequestLogger.mjs
│   └── index.mjs
├── utils/
│   ├── time.mjs
│   ├── retry.mjs
│   ├── ratelimit.mjs
│   ├── result.mjs
│   └── index.mjs
└── index.mjs

domain/
├── value-objects/
│   ├── ChatId.mjs
│   ├── MessageId.mjs
│   ├── Timestamp.mjs
│   └── index.mjs
├── entities/
│   ├── Message.mjs
│   ├── ConversationState.mjs
│   └── index.mjs
└── index.mjs
```

**Total: 18 source files + 9 test files = 27 files**

---

*Next: [02-ports-infrastructure.md](./02-ports-infrastructure.md)*
