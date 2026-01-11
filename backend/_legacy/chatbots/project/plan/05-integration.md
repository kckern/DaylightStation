# Phase 5: Integration & Journalist Advanced

> **Phase:** 5 of 6  
> **Duration:** Week 9  
> **Dependencies:** Phase 4 (Nutribot Advanced + Journalist Core)  
> **Deliverables:** HTTP adapters, routing, containers, Journalist advanced features

---

## Critical Constraints

1. **All tests MUST be in `backend/chatbots/_tests/`** - not in module folders
2. **Integration tests must use TestAdapter pattern (no real Telegram)**
3. **TestAdapter uses InMemoryRepository with io.mjs interface compatibility**
4. **Phase is ONLY complete when `npm test` (all tests) passes**

---

## Part A: Journalist Advanced Use Cases

### 5A.1 Quiz Use Cases

**File:** `journalist/application/usecases/SendQuizQuestion.mjs`

```
CLASS: SendQuizQuestion
├── constructor(deps)
│   - messagingGateway: IMessagingGateway
│   - quizRepository: IQuizRepository
│   - messageQueueRepository: IMessageQueueRepository
│   - logger: Logger
│
├── async execute(input: { chatId, category? }): Promise<Result>
│   1. Load questions for category
│   2. Select next unasked question (or rotate)
│   3. Queue remaining questions in category
│   4. Set foreignKey.quiz = question_uuid
│   5. Send first question with inline buttons (choices)
│   6. Mark question as asked
│   7. Return result
│
├── PRIVATE:
│   ├── #buildQuizKeyboard(choices: string[]): string[][]
│   │   - Each choice as separate row (inline)
│   │
│   └── #selectNextQuestion(questions: QuizQuestion[]): QuizQuestion
│       - Prefer unasked
│       - If all asked, reset category and pick first

TESTS:
- Sends quiz question
- Queues remaining questions
- Sets foreignKey correctly
- Rotation works
```

**File:** `journalist/application/usecases/RecordQuizAnswer.mjs`

```
CLASS: RecordQuizAnswer
├── constructor(deps)
│   - quizRepository: IQuizRepository
│   - messageQueueRepository: IMessageQueueRepository
│   - logger: Logger
│
├── async execute(input: { chatId, questionUuid, answer }): Promise<Result>
│   1. Create QuizAnswer entity
│   2. Record in repository
│   3. Return result

TESTS:
- Records answer with date
- Links to question correctly
```

**File:** `journalist/application/usecases/AdvanceToNextQuizQuestion.mjs`

```
CLASS: AdvanceToNextQuizQuestion
├── constructor(deps)
│   - messagingGateway: IMessagingGateway
│   - messageQueueRepository: IMessageQueueRepository
│   - journalEntryRepository: IJournalEntryRepository
│   - initiateJournalPrompt: InitiateJournalPrompt
│   - logger: Logger
│
├── async execute(input: { chatId, messageId }): Promise<Result>
│   1. Load next item from queue
│   2. IF next item has foreignKey.quiz:
│   │   a. Update existing message text/buttons (reuse message)
│   │   b. Update DB record
│   │   c. Mark queue item as sent
│   3. ELSE (no more quiz):
│   │   a. Delete quiz message
│   │   b. Initiate journal prompt
│   4. Return result

TESTS:
- Advances to next quiz question
- Reuses message for quiz flow
- Transitions to journal when quiz done
```

**File:** `journalist/application/usecases/HandleQuizAnswer.mjs`

```
CLASS: HandleQuizAnswer
├── constructor(deps)
│   - recordQuizAnswer: RecordQuizAnswer
│   - advanceToNextQuizQuestion: AdvanceToNextQuizQuestion
│   - logger: Logger
│
├── async execute(input: { chatId, messageId, questionUuid, answer, queueUuid }): Promise<Result>
│   1. Mark queue item as sent (if queueUuid)
│   2. Record quiz answer
│   3. Advance to next question
│   4. Return result

TESTS:
- Coordinates record and advance
- Updates queue state
```

---

### 5A.2 Analysis Use Cases

**File:** `journalist/application/usecases/GenerateTherapistAnalysis.mjs`

```
CLASS: GenerateTherapistAnalysis
├── constructor(deps)
│   - messagingGateway: IMessagingGateway
│   - aiGateway: IAIGateway
│   - journalEntryRepository: IJournalEntryRepository
│   - promptTemplateRepository: IPromptTemplateRepository
│   - logger: Logger
│
├── async execute(input: { chatId }): Promise<Result>
│   1. Delete pending unanswered messages
│   2. Load extended conversation history
│   3. Build "therapist_analysis" prompt
│   4. Call AI for analysis
│   5. Send analysis with "📘" prefix
│   6. Return { messageId, analysis }
│
├── PRIVATE:
│   └── #buildAnalysisPrompt(history: string): ChatMessage[]
│       - System: supportive therapist role
│       - Focus: patterns, themes, insights
│       - Constraints: no prescriptive advice

TESTS:
- Generates thoughtful analysis
- Respects tone constraints
```

**File:** `journalist/application/usecases/ReviewJournalEntries.mjs`

```
CLASS: ReviewJournalEntries
├── constructor(deps)
│   - messagingGateway: IMessagingGateway
│   - journalEntryRepository: IJournalEntryRepository
│   - logger: Logger
│
├── async execute(input: { chatId, startDate?, endDate? }): Promise<Result>
│   1. Load entries for date range (default: past 7 days)
│   2. Group by date
│   3. Build review message
│   4. Send message
│   5. Return { messageId, entryCount }

TESTS:
- Groups entries correctly
- Formats review message
```

**File:** `journalist/application/usecases/ExportJournalMarkdown.mjs`

```
CLASS: ExportJournalMarkdown
├── constructor(deps)
│   - journalEntryRepository: IJournalEntryRepository
│   - logger: Logger
│
├── async execute(input: { chatId, startDate }): Promise<string>
│   1. Load entries from startDate
│   2. Group by date
│   3. Format as Markdown:
│      ## Friday, 13th December 2024
│      * Entry 1
│      * Entry 2
│   4. Return markdown string

TESTS:
- Generates valid Markdown
- Date formatting correct
```

---

### 5A.3 Command Use Cases

**File:** `journalist/application/usecases/HandleSlashCommand.mjs`

```
CLASS: HandleSlashCommand
├── constructor(deps)
│   - initiateJournalPrompt: InitiateJournalPrompt
│   - generateTherapistAnalysis: GenerateTherapistAnalysis
│   - reviewJournalEntries: ReviewJournalEntries
│   - logger: Logger
│
├── async execute(input: { chatId, command }): Promise<Result>
│   1. Parse command (strip leading /)
│   2. Route to appropriate use case:
│      - /journal, /prompt → InitiateJournalPrompt
│      - /analyze → GenerateTherapistAnalysis
│      - /review → ReviewJournalEntries
│      - /yesterday → InitiateJournalPrompt (with instructions)
│      - default → InitiateJournalPrompt
│   3. Return result

TESTS:
- Routes each command correctly
- Default to journal prompt
```

**File:** `journalist/application/usecases/HandleSpecialStart.mjs`

```
CLASS: HandleSpecialStart
├── constructor(deps)
│   - messagingGateway: IMessagingGateway
│   - messageQueueRepository: IMessageQueueRepository
│   - journalEntryRepository: IJournalEntryRepository
│   - initiateJournalPrompt: InitiateJournalPrompt
│   - logger: Logger
│
├── async execute(input: { chatId, messageId, text }): Promise<Result>
│   1. Delete unprocessed queue
│   2. Delete user's special start message
│   3. Delete recent bot messages (within 1 min)
│   4. Delete most recent unanswered bot message
│   5. IF "🎲" (roll):
│   │   → Initiate journal prompt with "change_subject"
│   6. IF "❌" (cancel):
│   │   → Just clear state, no new prompt
│   7. Return result

TESTS:
- Clears queue on special start
- Roll initiates new topic
- Cancel just clears
```

---

## Part B: HTTP Adapters & Routing

### 5B.1 HTTP Middleware

**File:** `adapters/http/middleware/tracing.mjs`

```
PURPOSE: Assign trace ID and attach to request

FUNCTION: tracingMiddleware()
├── Check for X-Trace-Id header
├── If not present, generate UUID
├── Attach to req.traceId
├── Set X-Trace-Id response header
└── Call next()

TESTS:
- Generates trace ID
- Uses header if provided
- Sets response header
```

**File:** `adapters/http/middleware/validation.mjs`

```
PURPOSE: Validate webhook payload structure

FUNCTION: webhookValidationMiddleware(botName)
├── Check req.body exists
├── Validate basic structure (message or callback_query)
├── Extract chatId and attach to req
├── If invalid → return 200 (don't trigger Telegram retry)
└── Call next()

TESTS:
- Passes valid payloads
- Rejects invalid structure
- Always returns 200 (Telegram requirement)
```

**File:** `adapters/http/middleware/idempotency.mjs`

```
PURPOSE: Prevent duplicate processing of webhooks

FUNCTION: idempotencyMiddleware(options)
├── options.ttlMs: number (default: 300000 = 5 min)
│
├── Compute key: hash(botId + messageId + callbackData?)
├── Check in-memory store
├── If key exists → return 200 immediately
├── Store key with TTL
└── Call next()

STORAGE:
- In-memory Map with periodic cleanup
- Future: Redis for distributed

TESTS:
- First request passes through
- Duplicate blocked
- TTL expiry allows re-processing
```

**File:** `adapters/http/middleware/errorHandler.mjs`

```
PURPOSE: Catch and format errors

FUNCTION: errorHandlerMiddleware()
├── Wrap in try-catch
├── On DomainError:
│   - Map to HTTP status
│   - Return JSON error response
│   - Log at warn level
├── On InfrastructureError:
│   - Map to HTTP status
│   - Return JSON error response
│   - Log at error level
├── On unknown error:
│   - Return 500
│   - Log at error level
└── Always return 200 for webhooks (log actual status)

TESTS:
- Domain errors mapped correctly
- Infrastructure errors logged
- Unknown errors handled
```

---

### 5B.2 Event Routers

**File:** `nutribot/adapters/EventRouter.mjs`

```
PURPOSE: Route webhook events to use cases

CLASS: NutribotEventRouter
├── constructor(container: NutribotContainer)
│
├── async route(event: WebhookEvent): Promise<void>
│   1. Determine event type:
│      - message.photo → handlePhoto
│      - message.text (UPC pattern) → handleUPC
│      - message.text (slash command) → handleCommand
│      - message.text → handleText
│      - message.voice → handleVoice
│      - callback_query → handleCallback
│   2. Delegate to appropriate handler
│
├── PRIVATE HANDLERS:
│   ├── #handlePhoto(chatId, photo, messageId)
│   │   → LogFoodFromImage
│   │
│   ├── #handleUPC(chatId, upc, messageId)
│   │   → LogFoodFromUPC
│   │
│   ├── #handleText(chatId, text, messageId, from)
│   │   - Check conversation state for revising
│   │   - If revising → ProcessRevisionInput
│   │   - Else → LogFoodFromText
│   │
│   ├── #handleVoice(chatId, voice, messageId, from)
│   │   → LogFoodFromVoice
│   │
│   ├── #handleCallback(chatId, messageId, data, message)
│   │   - Parse callback data
│   │   - Route based on action type:
│   │     * accept → AcceptFoodLog
│   │     * discard → DiscardFoodLog
│   │     * revise → ReviseFoodLog
│   │     * portion:{factor} → SelectUPCPortion
│   │     * adjust:* → Adjustment use cases
│   │
│   └── #handleCommand(chatId, command, messageId)
│       - /help → HandleHelpCommand
│       - /report → GenerateDailyReport
│       - /review → StartAdjustmentFlow
│       - /coach → GenerateOnDemandCoaching

TESTS:
- Routes each event type correctly
- Handles unknown events gracefully
- State-aware routing for revision
```

**File:** `journalist/adapters/EventRouter.mjs`

```
PURPOSE: Route webhook events to use cases

CLASS: JournalistEventRouter
├── constructor(container: JournalistContainer)
│
├── async route(event: WebhookEvent): Promise<void>
│   1. Determine event type
│   2. Delegate to handler
│
├── PRIVATE HANDLERS:
│   ├── #handleText(chatId, text, messageId, from)
│   │   - Check for special starts (🎲, ❌)
│   │   - If special → HandleSpecialStart
│   │   - If slash command → HandleSlashCommand
│   │   - Else → ProcessTextEntry
│   │
│   ├── #handleVoice(chatId, voice, messageId, from)
│   │   → ProcessVoiceEntry
│   │
│   └── #handleCallback(chatId, messageId, data, message)
│       → HandleCallbackResponse

TESTS:
- Routes correctly
- Special start detection works
```

---

### 5B.3 HTTP Handlers

**File:** `nutribot/handlers/webhook.mjs`

```
PURPOSE: Express handler for Nutribot webhooks

FUNCTION: nutribotWebhookHandler(container)
├── Return async (req, res) => {
│   1. Extract event from req.body
│   2. Create event router with container
│   3. Route event
│   4. Return 200 (always, for Telegram)
│ }

TESTS:
- Integration tests with mocked container
```

**File:** `journalist/handlers/webhook.mjs`

```
PURPOSE: Express handler for Journalist webhooks

FUNCTION: journalistWebhookHandler(container)
├── Same pattern as Nutribot

TESTS:
- Integration tests
```

**File:** `nutribot/handlers/report.mjs`

```
PURPOSE: HTTP endpoint for JSON report

FUNCTION: nutribotReportHandler(container)
├── Return async (req, res) => {
│   1. Extract chatId from query/body
│   2. Get GetReportAsJSON use case
│   3. Execute
│   4. Return JSON response
│ }

TESTS:
- Returns valid JSON
- Handles missing chatId
```

**File:** `nutribot/handlers/reportImg.mjs`

```
PURPOSE: HTTP endpoint for report image

FUNCTION: nutribotReportImgHandler(container)
├── Return async (req, res) => {
│   1. Extract chatId, date from query
│   2. Generate report
│   3. Set Content-Type: image/png
│   4. Return image buffer
│ }

TESTS:
- Returns valid PNG
```

**File:** `journalist/handlers/journal.mjs`

```
PURPOSE: HTTP endpoint for journal export

FUNCTION: journalistJournalHandler(container)
├── Return async (req, res) => {
│   1. Extract chatId from query/body
│   2. Get ExportJournalMarkdown use case
│   3. Execute
│   4. Set Content-Type: text/markdown
│   5. Return markdown
│ }

TESTS:
- Returns valid Markdown
```

---

### 5B.4 Server Modules

**File:** `nutribot/server.mjs`

```
PURPOSE: Express router for Nutribot

FUNCTION: createNutribotRouter(container)
├── Create Express Router
├── Apply middleware:
│   - tracingMiddleware
│   - requestLogger
│   - webhookValidationMiddleware
│   - idempotencyMiddleware
├── Routes:
│   - POST /webhook → nutribotWebhookHandler
│   - GET /report → nutribotReportHandler
│   - GET /report.png → nutribotReportImgHandler
│   - POST /coach → nutribotCoachHandler
└── Return router

TESTS:
- All routes respond
- Middleware applied
```

**File:** `journalist/server.mjs`

```
PURPOSE: Express router for Journalist

FUNCTION: createJournalistRouter(container)
├── Create Express Router
├── Apply middleware
├── Routes:
│   - POST /webhook → journalistWebhookHandler
│   - GET /journal → journalistJournalHandler
│   - GET /trigger → journalistTriggerHandler
└── Return router

TESTS:
- All routes respond
```

---

### 5B.5 Root Router Integration

**File:** `router.mjs` (update existing)

```
PURPOSE: Root router that mounts all bot routers

CHANGES:
├── Import createNutribotRouter, createJournalistRouter
├── Import config loading
├── Create containers for each bot
├── Mount routers:
│   - /api/nutribot → nutribotRouter
│   - /api/journalist → journalistRouter
├── Apply global error handler
└── Feature flag for old vs new paths

FEATURE FLAG:
- Environment variable: USE_NEW_CHATBOT_ARCH=true|false
- If false, use legacy paths
- If true, use new architecture

TESTS:
- Feature flag toggles correctly
- Both paths work in parallel
```

---

## Part C: Integration Testing

### 5C.1 Test Adapter

**File:** `adapters/test/TestAdapter.mjs`

```
PURPOSE: Simulate Telegram interactions for testing

CLASS: TestAdapter
├── constructor(options)
│   - bot: 'nutribot' | 'journalist'
│   - userId: string
│   - container: Container (mock mode)
│
├── SIMULATION:
│   ├── sendText(text): Promise<void>
│   ├── sendPhoto(base64): Promise<void>
│   ├── sendVoice(buffer): Promise<void>
│   ├── pressButton(buttonText): Promise<void>
│   │   - Find button in last message
│   │   - Simulate callback_query
│   │
│   └── sendCommand(command): Promise<void>
│
├── ASSERTIONS:
│   ├── getLastBotMessage(): { text, buttons }
│   ├── getMessagesCount(): number
│   ├── getRepository(name): InMemoryRepository
│   └── getState(): ConversationState
│
└── SETUP:
    ├── reset(): void
    └── setAIResponse(pattern, response): void

TESTS:
- Simulates full conversation flows
- Enables end-to-end testing without network
```

---

### 5C.2 Integration Test Files

**File:** `nutribot/_test/FoodLoggingFlow.integration.mjs`

```
TESTS:
├── "photo → detect → accept → report"
│   1. Send photo
│   2. Assert detection message with buttons
│   3. Press Accept
│   4. Assert report generated
│
├── "photo → detect → discard"
│   1. Send photo
│   2. Press Discard
│   3. Assert no report (no items)
│
├── "photo → detect → revise → accept"
│   1. Send photo
│   2. Press Revise
│   3. Send revision text
│   4. Assert updated detection
│   5. Press Accept
│
└── "UPC → portion select → report"
    1. Send UPC code
    2. Assert product message with portions
    3. Select portion
    4. Assert report
```

**File:** `journalist/_test/JournalingFlow.integration.mjs`

```
TESTS:
├── "text entry → follow-up → response"
│   1. Send text entry
│   2. Assert follow-up question with choices
│   3. Press choice
│   4. Assert next question
│
├── "queue management"
│   1. Send text (generates multi-question)
│   2. Assert first question sent
│   3. Respond
│   4. Assert continues queue
│
├── "change subject clears queue"
│   1. Send text (generates queue)
│   2. Press 🎲 Change Subject
│   3. Assert new topic question
│
└── "quiz flow"
    1. Trigger quiz
    2. Answer questions
    3. Assert transitions back to journal
```

---

## Acceptance Criteria

### Journalist Advanced
- [ ] Quiz questions send and rotate correctly
- [ ] Quiz answers recorded
- [ ] Therapist analysis generates appropriate content
- [ ] Journal export produces valid Markdown
- [ ] Slash commands route correctly
- [ ] Special starts (🎲, ❌) work

### HTTP Integration
- [ ] Middleware chain works correctly
- [ ] Idempotency prevents duplicates
- [ ] Event routers route all event types
- [ ] Webhook handlers return 200
- [ ] Feature flag toggles old/new paths

### Integration Testing
- [ ] TestAdapter enables full flow testing
- [ ] Nutribot flows pass end-to-end
- [ ] Journalist flows pass end-to-end
- [ ] No network calls in integration tests
- [ ] **`npm test` (all tests) passes**

---

## Test Files Created (in `_tests/`)

```
_tests/
├── nutribot/
│   └── integration/
│       └── FoodLoggingFlow.test.mjs     # Full flow test
│
├── journalist/
│   ├── usecases/
│   │   ├── QuizFlow.test.mjs
│   │   └── AnalysisExport.test.mjs
│   └── integration/
│       └── JournalingFlow.test.mjs      # Full flow test
│
└── helpers/
    ├── TestAdapter.mjs                  # Simulates Telegram interactions
    └── fixtures/
        ├── nutribot/
        │   ├── samplePhoto.base64
        │   └── mockAIResponses.json
        └── journalist/
            └── mockAIResponses.json
```

---

## Files Created (Summary)

```
# Journalist Advanced (Part A)
journalist/application/usecases/
├── SendQuizQuestion.mjs
├── RecordQuizAnswer.mjs
├── AdvanceToNextQuizQuestion.mjs
├── HandleQuizAnswer.mjs
├── GenerateTherapistAnalysis.mjs
├── ReviewJournalEntries.mjs
├── ExportJournalMarkdown.mjs
├── HandleSlashCommand.mjs
└── HandleSpecialStart.mjs

# HTTP Adapters (Part B)
adapters/http/middleware/
├── tracing.mjs
├── validation.mjs
├── idempotency.mjs
├── errorHandler.mjs
└── index.mjs

nutribot/
├── adapters/
│   └── EventRouter.mjs
├── handlers/
│   ├── webhook.mjs
│   ├── report.mjs
│   └── reportImg.mjs
└── server.mjs

journalist/
├── adapters/
│   └── EventRouter.mjs
├── handlers/
│   ├── webhook.mjs
│   └── journal.mjs
└── server.mjs

# Test Adapter (shared helper in _tests/)
_tests/helpers/
└── TestAdapter.mjs

# Updated
router.mjs (update)
```

**Total: 26 files**

---

*Next: [06-migration.md](./06-migration.md)*
