# Phase 4: Nutribot Advanced + Journalist Core

> **Phase:** 4 of 6  
> **Duration:** Week 7-8  
> **Dependencies:** Phase 3 (Nutribot Core)  
> **Deliverables:** Nutribot reporting/coaching/adjustments, Journalist domain & core use cases

---

## Critical Constraints

1. **All tests MUST be in `backend/chatbots/_tests/`** - not in module folders
2. **All repositories MUST use `loadFile`/`saveFile` from `backend/lib/io.mjs`**
3. **NutriDay (Gold tier) aggregation must update when NutriListItem changes**
4. **Phase is ONLY complete when `npm test -- --grep "Phase4"` passes**

---

## Part A: Nutribot Advanced Use Cases

### 4A.1 Reporting Use Cases

**File:** `nutribot/application/usecases/GenerateDailyReport.mjs`

```
CLASS: GenerateDailyReport
├── constructor(deps)
│   - messagingGateway: IMessagingGateway
│   - nutrilistRepository: INutrilistRepository
│   - nutriDayRepository: INutriDayRepository      # Gold tier
│   - reportRenderer: IReportRenderer
│   - conversationStateStore: IConversationStateStore
│   - thresholdChecker: ThresholdChecker (domain service)
│   - logger: Logger
│
├── async execute(input: { chatId, date?, forceRegenerate? }): Promise<Result>
│   1. Check for pending NutriLogs (if any, skip unless force)
│   2. Delete previous report message (from NutriDay.reportMessageId)
│   3. Load NutriListItems for date (from Silver)
│   4. If no items → skip
│   5. Get or create NutriDay (Gold) for date
│   6. Load history from NutriDay (past 7 days - fast read from Gold)
│   7. Build NutritionReport entity
│   8. Render report image
│   9. Send image to chat
│   10. Update NutriDay.reportMessageId
│   11. Check for threshold coaching
│   12. If threshold crossed → generate coaching message
│   13. Return result
│
├── PRIVATE:
│   ├── #loadHistory(chatId, days): Promise<NutriDay[]>
│   │   - Read directly from Gold tier for fast access
│   ├── #deletePreviousReport(chatId): Promise<void>
│   └── #checkAndTriggerCoaching(chatId, report): Promise<void>

TESTS:
- Generates report correctly
- Skips if pending logs exist
- Deletes previous report
- Triggers coaching on threshold
```

**File:** `nutribot/application/usecases/GetReportAsJSON.mjs`

```
CLASS: GetReportAsJSON
├── constructor(deps)
│   - nutrilistRepository: INutrilistRepository
│   - logger: Logger
│
├── async execute(input: { chatId, date? }): Promise<object>
│   1. Load items for date
│   2. Calculate totals
│   3. Build JSON response
│   4. Return structured data

FORMAT:
{
  date: "2024-12-13",
  items: [{ item, icon, calories, protein, carbs, fat, noomColor }],
  totals: { calories, protein, carbs, fat },
  pending: number
}

TESTS:
- Returns correct JSON format
- Handles no items
```

---

### 4A.2 Coaching Use Cases

**File:** `nutribot/application/usecases/GenerateThresholdCoaching.mjs`

```
CLASS: GenerateThresholdCoaching
├── constructor(deps)
│   - messagingGateway: IMessagingGateway
│   - aiGateway: IAIGateway
│   - nutrilistRepository: INutrilistRepository
│   - coachingRepository: IRepository<CoachingAdvice>
│   - logger: Logger
│
├── async execute(input: { chatId, threshold, dailyTotal, recentItems }): Promise<Result>
│   1. Check if coaching already given for this threshold today
│   2. If already given → skip
│   3. Build coaching prompt with context
│   4. Call AI for coaching message
│   5. Send message to chat
│   6. Record coaching given
│   7. Return result
│
├── PRIVATE:
│   └── #buildCoachingPrompt(threshold, total, remaining, items): ChatMessage[]
│       - System: supportive nutrition coach
│       - Context: threshold crossed, budget, remaining, recent items
│       - Tone guidance based on threshold level

TESTS:
- Generates appropriate message
- Skips duplicate coaching
- Different tone for different thresholds
```

**File:** `nutribot/application/usecases/GenerateOnDemandCoaching.mjs`

```
CLASS: GenerateOnDemandCoaching
├── constructor(deps) - same as threshold coaching
│
├── async execute(input: { chatId }): Promise<Result>
│   1. Load today's items
│   2. Calculate totals
│   3. Build coaching prompt (no threshold context)
│   4. Call AI for general coaching
│   5. Send message
│   6. Return result
│
└── PRIVATE: similar prompt building

TESTS:
- Works when called via /coach command
- Generates helpful general advice
```

---

### 4A.3 Adjustment Use Cases

**File:** `nutribot/application/usecases/StartAdjustmentFlow.mjs`

```
CLASS: StartAdjustmentFlow
├── constructor(deps)
│   - messagingGateway: IMessagingGateway
│   - conversationStateStore: IConversationStateStore
│   - nutrilistRepository: INutrilistRepository
│   - logger: Logger
│
├── async execute(input: { chatId }): Promise<Result>
│   1. Set conversation state: adjusting = { level: 0 }
│   2. Build date selection keyboard
│   3. Send message with date buttons
│   4. Return result
│
├── PRIVATE:
│   └── #buildDateKeyboard(daysBack: number): string[][]
│       - [☀️ Today] [Yesterday] [2 days ago] ...
│       - [↩️ Done]

TESTS:
- Sets state correctly
- Builds keyboard correctly
```

**File:** `nutribot/application/usecases/SelectDateForAdjustment.mjs`

```
CLASS: SelectDateForAdjustment
├── constructor(deps)
│   - messagingGateway: IMessagingGateway
│   - conversationStateStore: IConversationStateStore
│   - nutrilistRepository: INutrilistRepository
│   - logger: Logger
│
├── async execute(input: { chatId, messageId, date }): Promise<Result>
│   1. Load items for date
│   2. If no items → show message, stay at level 0
│   3. Update state: adjusting = { level: 1, date }
│   4. Build item selection keyboard
│   5. Update message with items
│   6. Return result
│
├── PRIVATE:
│   ├── #buildItemKeyboard(items, offset): string[][]
│   │   - Show items (paginated if >10)
│   │   - [⏭️ Next] if more items
│   │   - [☀️ Other Day] [↩️ Done]
│   │
│   └── #formatItemButton(item): string
│       - "🟢 Apple (100g)"

TESTS:
- Loads items for selected date
- Pagination works
```

**File:** `nutribot/application/usecases/SelectItemForAdjustment.mjs`

```
CLASS: SelectItemForAdjustment
├── constructor(deps) - same as above
│
├── async execute(input: { chatId, messageId, itemUuid }): Promise<Result>
│   1. Load item by uuid
│   2. Update state: adjusting = { level: 2, date, uuid }
│   3. Build action keyboard
│   4. Update message with item details and actions
│   5. Return result
│
├── PRIVATE:
│   └── #buildActionKeyboard(): string[][]
│       - Row 1: [¼] [⅓] [½] [⅔] [¾]
│       - Row 2: [×1¼] [×1½] [×2] [×3] [×4]
│       - Row 3: [🗑️ Delete] [📅 Move Day] [↩️ Done]

TESTS:
- Loads correct item
- Shows all adjustment options
```

**File:** `nutribot/application/usecases/ApplyPortionAdjustment.mjs`

```
CLASS: ApplyPortionAdjustment
├── constructor(deps)
│   - messagingGateway: IMessagingGateway
│   - nutrilistRepository: INutrilistRepository
│   - conversationStateStore: IConversationStateStore
│   - generateDailyReport: GenerateDailyReport
│   - logger: Logger
│
├── async execute(input: { chatId, messageId, factor }): Promise<Result>
│   1. Get adjusting state
│   2. Load item by uuid
│   3. Scale food item by factor
│   4. Update item in repository
│   5. Clear adjusting state
│   6. Delete adjustment message
│   7. Regenerate report
│   8. Return result
│
└── PRIVATE: factor parsing, validation

TESTS:
- Scales item correctly
- Regenerates report
- Clears state
```

**File:** `nutribot/application/usecases/DeleteListItem.mjs`

```
CLASS: DeleteListItem
├── constructor(deps) - same as ApplyPortionAdjustment
│
├── async execute(input: { chatId, messageId, itemUuid }): Promise<Result>
│   1. Get adjusting state
│   2. Delete item from repository
│   3. Clear adjusting state
│   4. Delete adjustment message
│   5. Regenerate report
│   6. Return result

TESTS:
- Deletes item
- Regenerates report
```

**File:** `nutribot/application/usecases/MoveItemToDate.mjs`

```
CLASS: MoveItemToDate
├── constructor(deps) - same as above
│
├── async execute(input: { chatId, messageId, newDate }): Promise<Result>
│   1. Get adjusting state
│   2. Load item
│   3. Update item date
│   4. Save to repository
│   5. Clear state
│   6. Regenerate reports (both dates if different)
│   7. Return result

TESTS:
- Changes item date
- Regenerates correct reports
```

---

### 4A.4 Command Use Cases

**File:** `nutribot/application/usecases/HandleHelpCommand.mjs`

```
CLASS: HandleHelpCommand
├── constructor(deps)
│   - messagingGateway: IMessagingGateway
│
├── async execute(input: { chatId }): Promise<Result>
│   - Send help message with command list

HELP MESSAGE:
📱 Nutribot Commands

📸 Send a photo of food to log it
📝 Type a food description
🎤 Send a voice message
🔢 Send a UPC barcode

/help - This message
/report - Today's nutrition report
/review - Review and adjust entries
/coach - Get personalized advice

TESTS:
- Sends help message
```

**File:** `nutribot/application/usecases/HandleReviewCommand.mjs`

```
CLASS: HandleReviewCommand
├── constructor(deps)
│   - startAdjustmentFlow: StartAdjustmentFlow
│
├── async execute(input: { chatId }): Promise<Result>
│   - Delegate to StartAdjustmentFlow

TESTS:
- Starts adjustment flow
```

**File:** `nutribot/application/usecases/ConfirmAllPending.mjs`

```
CLASS: ConfirmAllPending
├── constructor(deps)
│   - nutrilogRepository: INutrilogRepository
│   - acceptFoodLog: AcceptFoodLog
│   - logger: Logger
│
├── async execute(input: { chatId }): Promise<Result>
│   1. Load all INIT status logs
│   2. For each, call AcceptFoodLog
│   3. Return count of confirmed

TESTS:
- Confirms all pending
- Handles empty list
```

---

## Part B: Journalist Domain & Core Use Cases

### 4B.1 Journalist Value Objects

**File:** `journalist/domain/value-objects/PromptType.mjs`

```
ENUM: PromptType
├── BIOGRAPHER = 'biographer'
├── AUTOBIOGRAPHER = 'autobiographer'
├── MULTIPLE_CHOICE = 'multiple_choice'
├── EVALUATE_RESPONSE = 'evaluate_response'
└── THERAPIST_ANALYSIS = 'therapist_analysis'

FUNCTIONS:
├── isValidPromptType(type: string): boolean
└── promptTypeDescription(type: PromptType): string

TESTS:
- All enum values valid
```

**File:** `journalist/domain/value-objects/EntrySource.mjs`

```
ENUM: EntrySource
├── TEXT = 'text'
├── VOICE = 'voice'
├── CALLBACK = 'callback'
└── SYSTEM = 'system'

FUNCTIONS:
├── isValidEntrySource(source: string): boolean
└── entrySourceEmoji(source: EntrySource): string
    - text → '📝', voice → '🎤', callback → '👆', system → '🤖'

TESTS:
- All enum values valid
```

**File:** `journalist/domain/value-objects/QuizCategory.mjs`

```
ENUM: QuizCategory
├── MOOD = 'mood'
├── GOALS = 'goals'
├── GRATITUDE = 'gratitude'
├── REFLECTION = 'reflection'
└── HABITS = 'habits'

FUNCTIONS:
├── isValidQuizCategory(cat: string): boolean
└── quizCategoryEmoji(cat: QuizCategory): string

TESTS:
- All enum values valid
```

---

### 4B.2 Journalist Entities

**File:** `journalist/domain/entities/ConversationMessage.mjs`

```
CLASS: ConversationMessage
├── #messageId: MessageId
├── #chatId: ChatId
├── #timestamp: Timestamp
├── #senderId: string
├── #senderName: string
├── #text: string
├── #foreignKey: { quiz?, queue?, prompt? }
│
├── constructor(props)
├── get messageId(): MessageId
├── ... (all getters)
│
├── isFromBot(): boolean
│   - Check if senderName is 'Journalist'
│
├── toJSON(): object
│
└── static fromTelegramUpdate(update, botName): ConversationMessage

TESTS:
- Creates valid message
- isFromBot() works
- Parses Telegram format
```

**File:** `journalist/domain/entities/MessageQueue.mjs`

```
CLASS: MessageQueue
├── #uuid: string
├── #chatId: ChatId
├── #timestamp: Timestamp
├── #queuedMessage: string
├── #choices: string[][] | null
├── #inline: boolean
├── #foreignKey: object
├── #messageId: MessageId | null (set when sent)
│
├── constructor(props)
├── get uuid(): string
├── ... (all getters)
│
├── isSent(): boolean
│   - Return messageId != null
│
├── withMessageId(messageId: MessageId): MessageQueue
│
├── toJSON(): object

TESTS:
- Creates valid queue item
- isSent() works
- Immutable
```

**File:** `journalist/domain/entities/JournalEntry.mjs`

```
CLASS: JournalEntry
├── #uuid: string
├── #chatId: ChatId
├── #date: string
├── #period: 'morning' | 'afternoon' | 'evening' | 'night'
├── #text: string
├── #source: EntrySource
├── #transcription: string | null
├── #analysis: EntryAnalysis | null
├── #createdAt: Timestamp
│
├── constructor(props)
├── ... (all getters)
│
├── withAnalysis(analysis: EntryAnalysis): JournalEntry
│
├── toJSON(): object
│
└── static fromMessages(messages: ConversationMessage[], date: string): JournalEntry[]
    - Aggregate messages into entries

TESTS:
- Creates valid entry
- Aggregation works
```

**File:** `journalist/domain/entities/QuizQuestion.mjs`

```
CLASS: QuizQuestion
├── #uuid: string
├── #category: QuizCategory
├── #question: string
├── #choices: string[]
├── #lastAsked: Timestamp | null
│
├── constructor(props)
├── ... (all getters)
│
├── markAsked(): QuizQuestion
│   - Set lastAsked to now
│
├── toJSON(): object

TESTS:
- Creates valid question
- markAsked() updates timestamp
```

**File:** `journalist/domain/entities/QuizAnswer.mjs`

```
CLASS: QuizAnswer
├── #questionUuid: string
├── #chatId: ChatId
├── #date: string
├── #answer: string | number
├── #answeredAt: Timestamp
│
├── constructor(props)
├── ... (all getters)
├── toJSON(): object

TESTS:
- Creates valid answer
- Links to question
```

---

### 4B.3 Journalist Domain Services

**File:** `journalist/domain/services/HistoryFormatter.mjs`

```
FUNCTIONS:
├── formatAsChat(messages: ConversationMessage[]): string
│   - "[datetime] SenderName: text • ..."
│
├── truncateToLength(history: string, maxLength: number): string
│   - Truncate from beginning, preserve most recent
│   - Add "..." prefix if truncated
│
└── buildChatContext(messages: ConversationMessage[]): ChatMessage[]
    - Transform to { role: 'user'|'assistant', content }[]
    - Bot messages → assistant
    - User messages → user

TESTS:
- Format correct
- Truncation preserves recent
- Context builds correctly
```

**File:** `journalist/domain/services/QuestionParser.mjs`

```
FUNCTIONS:
├── parseGPTResponse(text: string): string[]
│   1. Try JSON.parse for array
│   2. Strip markdown backticks
│   3. Split on "?" if not JSON
│   4. Filter empty/invalid
│   5. Clean up formatting
│
└── splitMultipleQuestions(text: string): string[]
    - Split compound questions
    - "What did you eat? How did it make you feel?" → 2 questions

TESTS:
- Parses JSON array
- Handles markdown-wrapped JSON
- Handles plain text with multiple questions
- Edge cases
```

**File:** `journalist/domain/services/QueueManager.mjs`

```
FUNCTIONS:
├── shouldContinueQueue(evalResult: string): boolean
│   - Return /1/gi.test(evalResult)
│
├── prepareNextQueueItem(queue: MessageQueue[], choices: string[][]): object
│   - Get last unsent item
│   - Attach choices
│   - Return prepared item
│
├── formatQuestion(text: string, prefix?: string): string
│   - Clean up leading non-alphanumeric
│   - Add prefix emoji (default: "⏩")
│
└── buildDefaultChoices(): string[][]
    - [["🎲 Change Subject", "❌ Cancel"]]

TESTS:
- Continue detection works
- Formatting correct
```

**File:** `journalist/domain/services/PromptBuilder.mjs`

```
FUNCTIONS:
├── buildBiographerPrompt(history: string, entry: string): ChatMessage[]
│
├── buildAutobiographerPrompt(history: string): ChatMessage[]
│
├── buildTherapistPrompt(history: string): ChatMessage[]
│
├── buildMultipleChoicePrompt(history: string, comment: string, question: string): ChatMessage[]
│
└── buildEvaluateResponsePrompt(history: string, response: string, plannedQuestions: string[]): ChatMessage[]

IMPLEMENTATION:
- Load templates from repository
- Fill placeholders
- Return structured messages

TESTS:
- Each prompt type builds correctly
- Placeholders filled
```

---

### 4B.4 Journalist Ports

**File:** `journalist/application/ports/IPromptTemplateRepository.mjs`

```
INTERFACE: IPromptTemplateRepository

METHODS:
├── getTemplate(promptType: PromptType): Promise<PromptTemplate>
├── fillTemplate(template: PromptTemplate, params: object): ChatMessage[]
└── listTemplates(): Promise<PromptType[]>

TYPE: PromptTemplate
├── id: string
├── sections: PromptSection[]
└── placeholders: string[]
```

**File:** `journalist/application/ports/IJournalEntryRepository.mjs`

```
INTERFACE: IJournalEntryRepository extends IRepository<JournalEntry>

ADDITIONAL METHODS:
├── findByDateRange(chatId, start, end): Promise<JournalEntry[]>
├── findByDate(chatId, date): Promise<JournalEntry[]>
├── findRecent(chatId, days): Promise<JournalEntry[]>
├── getMessageHistory(chatId, limit): Promise<ConversationMessage[]>
└── aggregateByDate(chatId, startDate): Promise<DayEntries[]>
```

**File:** `journalist/application/ports/IMessageQueueRepository.mjs`

```
INTERFACE: IMessageQueueRepository

METHODS:
├── loadUnsentQueue(chatId): Promise<MessageQueue[]>
├── saveToQueue(chatId, items: MessageQueue[]): Promise<void>
├── markSent(uuid, messageId): Promise<void>
├── clearQueue(chatId): Promise<void>
└── deleteUnprocessed(chatId): Promise<void>
```

**File:** `journalist/application/ports/IQuizRepository.mjs`

```
INTERFACE: IQuizRepository

METHODS:
├── loadQuestions(category?): Promise<QuizQuestion[]>
├── getNextQuestion(category): Promise<QuizQuestion | null>
├── recordAnswer(questionUuid, answer): Promise<void>
├── resetCategory(category): Promise<void>
└── getAnswerHistory(chatId, dateRange): Promise<QuizAnswer[]>
```

---

### 4B.5 Journalist Core Use Cases

**File:** `journalist/application/usecases/ProcessTextEntry.mjs`

```
CLASS: ProcessTextEntry (dearDiary)
├── constructor(deps)
│   - messagingGateway: IMessagingGateway
│   - aiGateway: IAIGateway
│   - journalEntryRepository: IJournalEntryRepository
│   - messageQueueRepository: IMessageQueueRepository
│   - promptTemplateRepository: IPromptTemplateRepository
│   - conversationStateStore: IConversationStateStore
│   - logger: Logger
│
├── async execute(input: { chatId, text, messageId, senderId, senderName }): Promise<Result>
│   1. Save message to history
│   2. Load unsent queue
│   3. IF queue exists:
│   │   a. Evaluate if response allows continuing queue
│   │   b. IF yes → send next queued message with choices
│   │   c. IF no → clear queue, generate new follow-up
│   4. IF no queue:
│   │   a. Build conversation context from history
│   │   b. Call AI with "biographer" prompt
│   │   c. Parse response for questions
│   │   d. IF multiple questions → queue all, send first
│   │   e. IF single question → generate choices, send
│   5. Return { messageId, prompt }
│
├── PRIVATE:
│   ├── #evaluateResponsePath(history, response, queue): Promise<boolean>
│   ├── #generateFollowUp(chatId, text): Promise<string[]>
│   ├── #generateMultipleChoices(chatId, comment, question): Promise<string[][]>
│   └── #sendQuestionWithChoices(chatId, question, choices): Promise<MessageId>

TESTS:
- Creates follow-up on new entry
- Continues queue when appropriate
- Clears queue when topic changes
- Handles multi-question responses
```

**File:** `journalist/application/usecases/ProcessVoiceEntry.mjs`

```
CLASS: ProcessVoiceEntry
├── constructor(deps)
│   - messagingGateway: IMessagingGateway
│   - processTextEntry: ProcessTextEntry
│   - logger: Logger
│
├── async execute(input: { chatId, voiceFileId, messageId, senderId, senderName }): Promise<Result>
│   1. Transcribe voice message
│   2. If no transcription → return error
│   3. Send transcription message
│   4. Delegate to ProcessTextEntry with transcribed text
│   5. Return result

TESTS:
- Transcribes and processes
- Handles empty transcription
```

**File:** `journalist/application/usecases/InitiateJournalPrompt.mjs`

```
CLASS: InitiateJournalPrompt (journalPrompt)
├── constructor(deps)
│   - messagingGateway: IMessagingGateway
│   - aiGateway: IAIGateway
│   - journalEntryRepository: IJournalEntryRepository
│   - promptTemplateRepository: IPromptTemplateRepository
│   - generateMultipleChoices: GenerateMultipleChoices
│   - logger: Logger
│
├── async execute(input: { chatId, instructions? }): Promise<Result>
│   1. Delete pending unanswered bot message
│   2. Load recent history (skip if instructions='change_subject')
│   3. Build "autobiographer" prompt
│   4. Call AI for opening question
│   5. Generate multiple choices
│   6. Send question with "📘" prefix and choices
│   7. Return { messageId, prompt }

TESTS:
- Generates opening question
- Respects change_subject instruction
- Deletes pending messages
```

**File:** `journalist/application/usecases/GenerateMultipleChoices.mjs`

```
CLASS: GenerateMultipleChoices
├── constructor(deps)
│   - aiGateway: IAIGateway
│   - promptTemplateRepository: IPromptTemplateRepository
│   - logger: Logger
│
├── async execute(input: { chatId, history, comment, question }): Promise<string[][]>
│   1. Check cache for question hash
│   2. If cached → return cached choices
│   3. Build "multiple_choice" prompt
│   4. Call AI
│   5. Parse JSON array of choices
│   6. Cache result
│   7. Format as keyboard: [[choice1], [choice2], ...]
│   8. Add default buttons: [["🎲 Change Subject", "❌ Cancel"]]
│   9. Return choices

TESTS:
- Generates valid choices
- Caches results
- Handles parse errors with retry
```

**File:** `journalist/application/usecases/HandleCallbackResponse.mjs`

```
CLASS: HandleCallbackResponse
├── constructor(deps)
│   - messagingGateway: IMessagingGateway
│   - journalEntryRepository: IJournalEntryRepository
│   - handleQuizAnswer: HandleQuizAnswer
│   - processTextEntry: ProcessTextEntry
│   - logger: Logger
│
├── async execute(input: { chatId, messageId, callbackData, options }): Promise<Result>
│   1. Parse callback data
│   2. Load message from DB to check foreignKey
│   3. IF foreignKey.quiz → delegate to HandleQuizAnswer
│   4. ELSE → treat as text response, process normally
│   5. Return result

TESTS:
- Routes quiz callbacks correctly
- Processes non-quiz callbacks as text
```

---

### 4B.6 Journalist Container

**File:** `journalist/container.mjs`

```
CLASS: JournalistContainer
├── constructor(config, options?)
│
├── INFRASTRUCTURE:
│   ├── getMessagingGateway(): IMessagingGateway
│   ├── getAIGateway(): IAIGateway
│   ├── getJournalEntryRepository(): IJournalEntryRepository
│   ├── getMessageQueueRepository(): IMessageQueueRepository
│   ├── getPromptTemplateRepository(): IPromptTemplateRepository
│   ├── getQuizRepository(): IQuizRepository
│   └── getConversationStateStore(): IConversationStateStore
│
├── USE CASES:
│   ├── getProcessTextEntry(): ProcessTextEntry
│   ├── getProcessVoiceEntry(): ProcessVoiceEntry
│   ├── getInitiateJournalPrompt(): InitiateJournalPrompt
│   ├── getGenerateMultipleChoices(): GenerateMultipleChoices
│   ├── getHandleCallbackResponse(): HandleCallbackResponse
│   └── ... (quiz, analysis use cases in Phase 5)
│
└── LIFECYCLE:
    ├── initialize(): Promise<void>
    └── shutdown(): Promise<void>
```

---

## Acceptance Criteria

### Nutribot Advanced
- [ ] Daily report generates correctly
- [ ] Threshold coaching triggers at correct levels
- [ ] Adjustment flow navigates correctly
- [ ] Portion adjustments scale correctly
- [ ] Item deletion removes and regenerates
- [ ] Move item updates correct dates

### Journalist Core
- [ ] ProcessTextEntry generates follow-ups
- [ ] Queue management works (continue/clear)
- [ ] Voice transcription processes correctly
- [ ] Journal prompt generates opening questions
- [ ] Multiple choice generation caches correctly
- [ ] Callback responses route correctly
- [ ] **`npm test -- --grep "Phase4"` passes**

---

## Test Files Created (in `_tests/`)

```
_tests/nutribot/
├── usecases/
│   ├── GenerateDailyReport.test.mjs
│   ├── GenerateThresholdCoaching.test.mjs
│   ├── AdjustmentFlow.test.mjs        # Covers Start/Select/Apply/Delete/Move
│   └── Commands.test.mjs              # Help/Review/Confirm
│
└── integration/
    └── FullReportingFlow.test.mjs     # Bronze→Silver→Gold data flow

_tests/journalist/
├── domain/
│   ├── PromptType.test.mjs
│   ├── JournalEntry.test.mjs
│   └── services.test.mjs
│
└── usecases/
    ├── ProcessTextEntry.test.mjs
    ├── InitiateJournalPrompt.test.mjs
    └── HandleCallbackResponse.test.mjs
```

---

## Files Created (Summary)

```
# Nutribot Advanced (Part A)
nutribot/application/usecases/
├── GenerateDailyReport.mjs
├── GetReportAsJSON.mjs
├── GenerateThresholdCoaching.mjs
├── GenerateOnDemandCoaching.mjs
├── StartAdjustmentFlow.mjs
├── SelectDateForAdjustment.mjs
├── SelectItemForAdjustment.mjs
├── ApplyPortionAdjustment.mjs
├── DeleteListItem.mjs
├── MoveItemToDate.mjs
├── HandleHelpCommand.mjs
├── HandleReviewCommand.mjs
└── ConfirmAllPending.mjs

nutribot/infrastructure/persistence/
├── FileNutriDayRepository.mjs         # Gold tier - uses io.mjs
└── NutriDayAggregator.mjs             # Service to update Gold from Silver

# Journalist (Part B)
journalist/
├── domain/
│   ├── value-objects/
│   │   ├── PromptType.mjs
│   │   ├── EntrySource.mjs
│   │   ├── QuizCategory.mjs
│   │   └── index.mjs
│   ├── entities/
│   │   ├── ConversationMessage.mjs
│   │   ├── MessageQueue.mjs
│   │   ├── JournalEntry.mjs
│   │   ├── QuizQuestion.mjs
│   │   ├── QuizAnswer.mjs
│   │   └── index.mjs
│   ├── services/
│   │   ├── HistoryFormatter.mjs
│   │   ├── QuestionParser.mjs
│   │   ├── QueueManager.mjs
│   │   ├── PromptBuilder.mjs
│   │   └── index.mjs
│   └── index.mjs
├── application/
│   ├── ports/
│   │   ├── IPromptTemplateRepository.mjs
│   │   ├── IJournalEntryRepository.mjs
│   │   ├── IMessageQueueRepository.mjs
│   │   ├── IQuizRepository.mjs
│   │   └── index.mjs
│   ├── usecases/
│   │   ├── ProcessTextEntry.mjs
│   │   ├── ProcessVoiceEntry.mjs
│   │   ├── InitiateJournalPrompt.mjs
│   │   ├── GenerateMultipleChoices.mjs
│   │   ├── HandleCallbackResponse.mjs
│   │   └── index.mjs
│   └── index.mjs
└── container.mjs
```

**Total: 34 files**

---

*Next: [05-journalist-advanced.md](./05-journalist-advanced.md)*
