# Phase 2: Ports & Infrastructure

> **Phase:** 2 of 6  
> **Duration:** Week 3-4  
> **Dependencies:** Phase 1 (Foundation)  
> **Deliverables:** `application/ports/`, `infrastructure/`, tests in `_tests/infrastructure/`

---

## Critical Constraints

1. **All tests MUST be in `backend/chatbots/_tests/`** - not in module folders
2. **FileRepository MUST use `loadFile`/`saveFile` from `backend/lib/io.mjs`**
3. **No direct `fs` operations** - all persistence through io.mjs
4. **Phase is ONLY complete when `npm test -- --grep "Phase2"` passes**

---

## Objectives

1. Define all port interfaces (contracts)
2. Implement Telegram messaging gateway
3. Implement OpenAI gateway
4. Implement file-based repositories (using io.mjs)
5. Create mock implementations for testing
6. **Create corresponding tests in `_tests/infrastructure/`**

---

## Task Breakdown

### 2.1 Port Interfaces

**File:** `application/ports/IMessagingGateway.mjs`

```
PURPOSE: Abstract interface for chat platform messaging

INTERFACE DEFINITION:
/**
 * @typedef {Object} SendMessageOptions
 * @property {Array<Array<string|Object>>} [choices] - Keyboard buttons
 * @property {boolean} [inline] - Use inline keyboard
 * @property {boolean} [saveMessage] - Persist to history
 * @property {'Markdown'|'HTML'} [parseMode]
 * @property {Object} [foreignKey] - Metadata to attach
 */

METHODS:
├── sendMessage(chatId: ChatId, text: string, options?: SendMessageOptions)
│   → Promise<{ messageId: MessageId }>
│
├── sendImage(chatId: ChatId, imageSource: string|Buffer, caption?: string, options?)
│   → Promise<{ messageId: MessageId }>
│   - imageSource can be URL, file path, or Buffer
│
├── updateMessage(chatId: ChatId, messageId: MessageId, updates: object)
│   → Promise<void>
│   - updates: { text?, choices?, caption? }
│
├── updateKeyboard(chatId: ChatId, messageId: MessageId, choices: string[][])
│   → Promise<void>
│
├── deleteMessage(chatId: ChatId, messageId: MessageId)
│   → Promise<void>
│
├── transcribeVoice(voiceFileId: string)
│   → Promise<string>
│
└── getFileUrl(fileId: string)
    → Promise<string>

CONTRACT TESTS (to be implemented by all implementations):
- sendMessage returns messageId
- updateMessage modifies existing message
- deleteMessage removes message
- Handles rate limiting gracefully
```

**File:** `application/ports/IAIGateway.mjs`

```
PURPOSE: Abstract interface for AI/LLM services

INTERFACE DEFINITION:
/**
 * @typedef {Object} ChatMessage
 * @property {'system'|'user'|'assistant'} role
 * @property {string} content
 */

/**
 * @typedef {Object} ChatOptions
 * @property {string} [model]
 * @property {number} [maxTokens]
 * @property {number} [temperature]
 * @property {boolean} [jsonMode]
 */

METHODS:
├── chat(messages: ChatMessage[], options?: ChatOptions)
│   → Promise<string>
│   - Send conversation, get text response
│
├── chatWithImage(messages: ChatMessage[], imageUrl: string, options?: ChatOptions)
│   → Promise<string>
│   - Vision model call with image
│
├── chatWithJson(messages: ChatMessage[], options?: ChatOptions)
│   → Promise<object>
│   - Parse response as JSON, retry on parse failure
│
├── transcribe(audioBuffer: Buffer)
│   → Promise<string>
│   - Whisper API for voice transcription
│
└── embed(text: string)
    → Promise<number[]>
    - Text embedding (future use)

CONTRACT TESTS:
- chat returns non-empty string
- chatWithJson returns parsed object
- Handles API errors gracefully
- Respects rate limits
```

**File:** `application/ports/IRepository.mjs`

```
PURPOSE: Generic repository interface

INTERFACE DEFINITION:
/**
 * @template T
 * @interface IRepository
 */

METHODS:
├── save(entity: T)
│   → Promise<T>
│   - Insert or update
│
├── findById(id: string)
│   → Promise<T | null>
│
├── findAll(filter?: Partial<T>)
│   → Promise<T[]>
│
├── update(id: string, changes: Partial<T>)
│   → Promise<T>
│
├── delete(id: string)
│   → Promise<void>
│
└── exists(id: string)
    → Promise<boolean>

CONTRACT TESTS:
- save() persists entity
- findById() retrieves by id
- findById() returns null if not found
- update() modifies existing
- delete() removes entity
- findAll() filters correctly
```

**File:** `application/ports/IConversationStateStore.mjs`

```
PURPOSE: Ephemeral conversation state storage

METHODS:
├── get(chatId: ChatId)
│   → Promise<ConversationState | null>
│   - Return null if not found or expired
│
├── set(chatId: ChatId, state: ConversationState)
│   → Promise<void>
│
├── update(chatId: ChatId, changes: Partial<ConversationState>)
│   → Promise<ConversationState>
│   - Merge changes, update lastActivity
│
├── clear(chatId: ChatId)
│   → Promise<void>
│
└── clearFlow(chatId: ChatId, flowName: string)
    → Promise<void>
    - Clear only if current flow matches

CONTRACT TESTS:
- get() returns null when not set
- set() stores state
- get() returns null after TTL expires
- update() merges changes
- clear() removes state
```

---

### 2.2 Telegram Gateway Implementation

**File:** `infrastructure/messaging/TelegramGateway.mjs`

```
PURPOSE: Telegram Bot API implementation of IMessagingGateway

CLASS: TelegramGateway
├── constructor(config, logger, messageRepository?)
│   - config: { token, botId }
│   - logger: Logger instance
│   - messageRepository: optional, for saveMessage
│
├── IMPLEMENTS IMessagingGateway
│
├── PRIVATE METHODS:
│   ├── #callApi(method: string, params: object)
│   │   - POST to https://api.telegram.org/bot{token}/{method}
│   │   - Handle rate limiting (429 → RateLimitError)
│   │   - Handle errors → ExternalServiceError
│   │   - Log all calls at debug level
│   │
│   ├── #buildKeyboard(choices: string[][], inline: boolean)
│   │   - Convert choices array to Telegram format
│   │   - Handle callback_data for inline buttons
│   │
│   ├── #extractChatParams(chatId: ChatId)
│   │   - Return { chat_id: chatId.userId }
│   │
│   └── #saveToHistory(chatId, messageId, text, foreignKey)
│       - If messageRepository provided, persist message
│
├── sendMessage(chatId, text, options)
│   1. Build keyboard if choices provided
│   2. Call sendMessage API
│   3. Optionally save to history
│   4. Return { messageId }
│
├── sendImage(chatId, imageSource, caption, options)
│   1. Detect source type (URL, path, Buffer)
│   2. Call sendPhoto API
│   3. Return { messageId }
│
├── updateMessage(chatId, messageId, updates)
│   1. If text → editMessageText
│   2. If caption → editMessageCaption
│   3. If choices → editMessageReplyMarkup
│
├── updateKeyboard(chatId, messageId, choices)
│   → editMessageReplyMarkup
│
├── deleteMessage(chatId, messageId)
│   → deleteMessage API
│
├── transcribeVoice(voiceFileId)
│   1. getFile to get file_path
│   2. Download file
│   3. Send to OpenAI Whisper via AIGateway
│
└── getFileUrl(fileId)
    1. getFile API
    2. Return full URL

TESTS:
- Mocked HTTP tests for each method
- Error handling for API failures
- Rate limit handling
- Keyboard building
```

**File:** `infrastructure/messaging/MockMessagingGateway.mjs`

```
PURPOSE: In-memory mock for testing

CLASS: MockMessagingGateway
├── sentMessages: Array<{chatId, text, options, messageId}>
├── deletedMessages: Array<{chatId, messageId}>
├── nextMessageId: number
│
├── IMPLEMENTS IMessagingGateway (all methods)
│
├── TESTING HELPERS:
│   ├── getLastMessage(): object | null
│   ├── getMessagesTo(chatId): object[]
│   ├── simulateCallback(chatId, messageId, data): void
│   ├── reset(): void
│   └── setNextMessageId(id): void
│
└── All methods store actions, return mock IDs

TESTS:
- Captures all sent messages
- getLastMessage() returns correct message
- reset() clears state
```

---

### 2.3 OpenAI Gateway Implementation

**File:** `infrastructure/ai/OpenAIGateway.mjs`

```
PURPOSE: OpenAI API implementation of IAIGateway

CLASS: OpenAIGateway
├── constructor(config, logger, rateLimiter)
│   - config: { apiKey, model, maxTokens, timeout }
│   - rateLimiter: RateLimiter instance
│
├── IMPLEMENTS IAIGateway
│
├── PRIVATE METHODS:
│   ├── #callCompletions(messages, options)
│   │   - POST to /v1/chat/completions
│   │   - Include model, max_tokens, messages
│   │   - Handle rate limits (429)
│   │   - Log request/response at debug
│   │
│   ├── #callTranscription(audioBuffer)
│   │   - POST to /v1/audio/transcriptions
│   │   - multipart/form-data with audio file
│   │
│   └── #buildMessages(messages, imageUrl?)
│       - Convert to OpenAI format
│       - Include image as base64 data URL if provided
│
├── chat(messages, options)
│   1. Acquire rate limit token
│   2. Call completions API
│   3. Extract content from response
│   4. Return text
│
├── chatWithImage(messages, imageUrl, options)
│   1. Convert image to base64 if URL
│   2. Build vision message format
│   3. Call completions with vision model
│
├── chatWithJson(messages, options)
│   1. Add json_object response_format
│   2. Call completions
│   3. Parse JSON response
│   4. If parse fails, retry once with "respond only with valid JSON"
│
├── transcribe(audioBuffer)
│   1. Call transcription API with buffer
│   2. Return text
│
└── embed(text)
    1. POST to /v1/embeddings
    2. Return vector

TESTS:
- Mocked HTTP tests
- JSON parsing and retry
- Rate limiting integration
- Image encoding
- Error handling
```

**File:** `infrastructure/ai/MockAIGateway.mjs`

```
PURPOSE: Deterministic mock for testing

CLASS: MockAIGateway
├── responses: Map<string, string>  // prompt pattern → response
├── calls: Array<{method, messages, options}>
│
├── IMPLEMENTS IAIGateway
│
├── CONFIGURATION:
│   ├── setResponse(promptPattern: string|RegExp, response: string)
│   ├── setJsonResponse(promptPattern, object)
│   └── setDefaultResponse(response: string)
│
├── TESTING HELPERS:
│   ├── getCalls(): array
│   ├── getLastCall(): object
│   ├── reset(): void
│   └── assertCalledWith(pattern): void
│
├── chat(messages, options)
│   1. Record call
│   2. Match prompt against patterns
│   3. Return matched response or default
│
└── Other methods similar

TESTS:
- Returns configured responses
- Records all calls
- Pattern matching works
- reset() clears state
```

---

### 2.4 File Repository Implementation

**File:** `infrastructure/persistence/FileRepository.mjs`

```
PURPOSE: YAML file-based repository implementation using io.mjs

CRITICAL: Must use loadFile/saveFile from backend/lib/io.mjs
- import { loadFile, saveFile } from '../../../lib/io.mjs'
- NO direct fs operations
- NO direct yaml parsing

CLASS: FileRepository<T>
├── constructor(options)
│   - storePath: string (relative to data dir, e.g., 'nutribot/nutrilog')
│   - idField: string (default: 'uuid')
│   - perChat: boolean (default: true) → one file per chatId
│   - logger: Logger instance
│
├── IMPLEMENTS IRepository<T>
│
├── PRIVATE METHODS:
│   ├── #getPath(chatId?: string): string
│   │   - If perChat: `${storePath}/${chatId}`
│   │   - Else: storePath
│   │   - Returns path for loadFile/saveFile (no .yaml extension needed)
│   │
│   └── #getId(entity): string
│       - Extract ID from entity using idField
│
├── save(entity, chatId?)
│   1. const path = this.#getPath(chatId)
│   2. const data = loadFile(path) || {}
│   3. data[this.#getId(entity)] = entity
│   4. saveFile(path, data)
│   5. return entity
│
├── findById(id, chatId?)
│   1. const data = loadFile(this.#getPath(chatId))
│   2. return data?.[id] || null
│
├── findAll(filter?, chatId?)
│   1. const data = loadFile(this.#getPath(chatId))
│   2. if (!data) return []
│   3. Filter by partial match
│   4. Return array
│
├── update(id, changes, chatId?)
│   1. Load data
│   2. Merge changes
│   3. Save
│   4. Return updated
│
├── delete(id, chatId?)
│   1. Load data
│   2. Delete entry
│   3. Save
│
└── exists(id, chatId?)
    1. Load data
    2. Return id in data

WRITE QUEUE:
- Per-file queue to prevent concurrent writes
- Use global Map of Promises per file path

TESTS:
- Creates file if not exists
- Reads/writes YAML correctly
- Per-chat file separation
- Concurrent write protection
- Filter matching
```

**File:** `infrastructure/persistence/InMemoryRepository.mjs`

```
PURPOSE: In-memory repository for testing

CLASS: InMemoryRepository<T>
├── data: Map<string, Map<string, T>>  // chatId → (id → entity)
│
├── IMPLEMENTS IRepository<T>
│
├── TESTING HELPERS:
│   ├── seed(chatId: ChatId, entities: T[]): void
│   ├── getAll(chatId?: ChatId): T[]
│   ├── reset(): void
│   └── snapshot(): object
│
└── All methods operate on in-memory data

TESTS:
- Standard repository operations
- seed() populates data
- reset() clears all
- snapshot() for assertions
```

---

### 2.5 Conversation State Store

**File:** `infrastructure/persistence/FileConversationStateStore.mjs`

```
PURPOSE: File-based conversation state storage

CLASS: FileConversationStateStore
├── constructor(options)
│   - storePath: string
│   - defaultTTL: number (seconds)
│   - logger: Logger
│
├── IMPLEMENTS IConversationStateStore
│
├── get(chatId)
│   1. Load state file
│   2. Check TTL expiration
│   3. Return state or null if expired
│
├── set(chatId, state)
│   1. Set lastActivity to now
│   2. Save to file
│
├── update(chatId, changes)
│   1. Load existing
│   2. Merge changes
│   3. Update lastActivity
│   4. Save
│
├── clear(chatId)
│   1. Delete state file or entry
│
└── clearFlow(chatId, flowName)
    1. Load state
    2. If currentFlow matches, clear flow data
    3. Save

TESTS:
- TTL expiration works
- update() merges correctly
- clearFlow() only clears matching flow
```

**File:** `infrastructure/persistence/InMemoryStateStore.mjs`

```
PURPOSE: In-memory state store for testing

CLASS: InMemoryStateStore
├── states: Map<string, ConversationState>
│
├── IMPLEMENTS IConversationStateStore
│
├── TESTING HELPERS:
│   ├── setState(chatId, state): void
│   ├── advanceTime(ms): void  // for TTL testing
│   └── reset(): void
│
└── All methods operate on in-memory data

TESTS:
- Standard state store operations
- advanceTime() triggers TTL expiration
```

---

## Contract Tests

**File:** `application/ports/__tests__/IMessagingGateway.contract.mjs`

```
PURPOSE: Shared contract tests for any IMessagingGateway implementation

EXPORT: runMessagingGatewayContractTests(createGateway: () => IMessagingGateway)

TESTS:
- sendMessage returns messageId
- updateMessage modifies message
- deleteMessage removes message
- (skip network tests if mock)

USAGE:
// In TelegramGateway.test.mjs
import { runMessagingGatewayContractTests } from '../ports/__tests__/IMessagingGateway.contract.mjs';
runMessagingGatewayContractTests(() => new MockMessagingGateway());
```

---

## Barrel Exports

**File:** `application/ports/index.mjs`
```javascript
export * from './IMessagingGateway.mjs';
export * from './IAIGateway.mjs';
export * from './IRepository.mjs';
export * from './IConversationStateStore.mjs';
```

**File:** `infrastructure/index.mjs`
```javascript
export * from './messaging/index.mjs';
export * from './ai/index.mjs';
export * from './persistence/index.mjs';
```

---

## Acceptance Criteria

- [ ] All port interfaces have JSDoc documentation
- [ ] TelegramGateway sends messages successfully (manual test)
- [ ] OpenAIGateway calls GPT successfully (manual test)
- [ ] FileRepository uses loadFile/saveFile from io.mjs (NO direct fs)
- [ ] FileRepository persists to correct paths
- [ ] All mock implementations pass contract tests
- [ ] Rate limiting works in OpenAIGateway
- [ ] No direct dependencies on concrete implementations in ports
- [ ] **`npm test -- --grep "Phase2"` passes**

---

## Test Files Created (in `_tests/`)

```
_tests/
├── infrastructure/
│   ├── TelegramGateway.test.mjs       # Mock-based tests
│   ├── OpenAIGateway.test.mjs         # Mock-based tests
│   ├── FileRepository.test.mjs        # Uses temp files via io.mjs
│   ├── InMemoryRepository.test.mjs
│   └── contracts.test.mjs             # Contract tests for all impls
│
└── helpers/
    ├── MockMessagingGateway.mjs       # Shared test helper
    ├── MockAIGateway.mjs              # Shared test helper
    └── fixtures/
        └── config/                     # Test config files
```

---

## Files Created (Summary)

```
application/
├── ports/
│   ├── IMessagingGateway.mjs
│   ├── IAIGateway.mjs
│   ├── IRepository.mjs
│   ├── IConversationStateStore.mjs
│   └── index.mjs
└── index.mjs

infrastructure/
├── messaging/
│   ├── TelegramGateway.mjs
│   ├── ConsoleGateway.mjs
│   ├── MockMessagingGateway.mjs
│   └── index.mjs
├── ai/
│   ├── OpenAIGateway.mjs
│   ├── MockAIGateway.mjs
│   └── index.mjs
├── persistence/
│   ├── FileRepository.mjs              # Uses io.mjs loadFile/saveFile
│   ├── InMemoryRepository.mjs          # For tests only
│   ├── FileConversationStateStore.mjs  # Uses io.mjs
│   ├── InMemoryStateStore.mjs          # For tests only
│   └── index.mjs
└── index.mjs
```

**Total: 17 source files + 5 test files = 22 files**

---

*Next: [03-nutribot-domain.md](./03-nutribot-domain.md)*
