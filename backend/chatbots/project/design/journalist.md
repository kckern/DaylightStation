# Journalist Bot Architecture Design

> **Status:** Design Phase  
> **Last Updated:** December 2024  
> **Extends:** `_common.md`

---

## 1. Overview

Journalist is a Telegram chatbot for personal journaling and self-reflection. It acts as a biographical interviewer, asking follow-up questions based on user entries, conducting periodic quizzes, and providing therapeutic analysis of journal entries over time.

### 1.1 Core Capabilities

| Capability | Description |
|------------|-------------|
| **Biographical Interviewing** | AI-generated follow-up questions based on user entries |
| **Multiple Choice Prompts** | Context-aware response suggestions |
| **Quizzes** | Periodic self-assessment questionnaires |
| **Journal Review** | Analysis of entries over time periods |
| **Therapeutic Analysis** | AI-powered reflection on emotional patterns |
| **Voice Journaling** | Transcription and processing of voice messages |

---

## 2. Domain Model

### 2.1 Value Objects (Journalist-Specific)

```
┌─────────────────────────────────────────────────────────────────┐
│                    JOURNALIST VALUE OBJECTS                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   JournalPeriod                                                 │
│   └── 'morning' | 'afternoon' | 'evening' | 'night'             │
│                                                                 │
│   EntrySource                                                   │
│   └── 'text' | 'voice' | 'callback' | 'system'                  │
│                                                                 │
│   QuizCategory                                                  │
│   └── Enum of quiz types (mood, goals, gratitude, etc.)         │
│                                                                 │
│   PromptType                                                    │
│   └── 'biographer' | 'autobiographer' | 'therapist_analysis'    │
│       | 'multiple_choice' | 'evaluate_response'                 │
│                                                                 │
│   QueuedMessageType                                             │
│   └── 'followup' | 'quiz' | 'prompt'                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Entities

```
┌─────────────────────────────────────────────────────────────────┐
│                    JOURNALIST ENTITIES                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   JournalEntry                                                  │
│   ├── uuid: string                                              │
│   ├── chatId: ChatId                                            │
│   ├── date: Date                                                │
│   ├── period: JournalPeriod                                     │
│   ├── text: string                                              │
│   ├── source: EntrySource                                       │
│   ├── transcription?: string         (if voice)                 │
│   ├── analysis?: EntryAnalysis       (AI-generated)             │
│   └── createdAt: Timestamp                                      │
│                                                                 │
│   ConversationMessage                                           │
│   ├── messageId: MessageId                                      │
│   ├── chatId: ChatId                                            │
│   ├── timestamp: Timestamp                                      │
│   ├── senderId: UserId                                          │
│   ├── senderName: string                                        │
│   ├── text: string                                              │
│   └── foreignKey: {                                             │
│   │     quiz?: string,               (quiz key if quiz msg)     │
│   │     queue?: string,              (queue uuid)               │
│   │     prompt?: string              (prompt type)              │
│   │   }                                                         │
│                                                                 │
│   MessageQueue                                                  │
│   ├── uuid: string                                              │
│   ├── chatId: ChatId                                            │
│   ├── timestamp: Timestamp                                      │
│   ├── queuedMessage: string                                     │
│   ├── choices?: string[][]                                      │
│   ├── inline: boolean                                           │
│   ├── foreignKey: Record<string, any>                           │
│   └── messageId?: MessageId          (set when sent)            │
│                                                                 │
│   QuizQuestion                                                  │
│   ├── uuid: string                                              │
│   ├── category: QuizCategory                                    │
│   ├── question: string                                          │
│   ├── choices: string[]                                         │
│   ├── lastAsked?: Timestamp                                     │
│   └── responses: Map<Date, Answer>                              │
│                                                                 │
│   QuizAnswer                                                    │
│   ├── questionUuid: string                                      │
│   ├── chatId: ChatId                                            │
│   ├── date: Date                                                │
│   ├── answer: string | number                                   │
│   └── answeredAt: Timestamp                                     │
│                                                                 │
│   EntryAnalysis                                                 │
│   ├── entryUuid: string                                         │
│   ├── themes: string[]                                          │
│   ├── emotionalTone: string                                     │
│   ├── keyInsights: string[]                                     │
│   └── generatedAt: Timestamp                                    │
│                                                                 │
│   TherapistSession                                              │
│   ├── chatId: ChatId                                            │
│   ├── dateRange: DateRange                                      │
│   ├── entriesAnalyzed: number                                   │
│   ├── analysis: string               (GPT output)               │
│   └── generatedAt: Timestamp                                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 Entity Relationships

```
┌─────────────────────────────────────────────────────────────────┐
│                    ENTITY RELATIONSHIP DIAGRAM                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌───────────────────┐         ┌───────────────────┐           │
│   │ ConversationMessage│ ──────▶│   MessageQueue    │           │
│   │   (user/bot msgs)  │  via   │ (pending prompts) │           │
│   │                    │ queue  │                    │           │
│   └─────────┬─────────┘  uuid   └───────────────────┘           │
│             │                                                   │
│             │ aggregates to                                     │
│             ▼                                                   │
│   ┌───────────────────┐                                         │
│   │   JournalEntry    │                                         │
│   │  (daily entries)  │                                         │
│   └─────────┬─────────┘                                         │
│             │                                                   │
│             │ analyzed by                                       │
│             ▼                                                   │
│   ┌───────────────────┐         ┌───────────────────┐           │
│   │   EntryAnalysis   │         │ TherapistSession  │           │
│   │  (per-entry AI)   │         │ (multi-entry AI)  │           │
│   └───────────────────┘         └───────────────────┘           │
│                                                                 │
│                                                                 │
│   ┌───────────────────┐         ┌───────────────────┐           │
│   │   QuizQuestion    │ ◀──────▶│    QuizAnswer     │           │
│   │  (question bank)  │   1:N   │  (user responses) │           │
│   └───────────────────┘         └───────────────────┘           │
│                                                                 │
│                                                                 │
│   CONVERSATION STATE (ephemeral)                                │
│   ─────────────────────────────────────                         │
│   ConversationState                                             │
│   ├── currentPromptType: PromptType | null                      │
│   ├── pendingQueueCount: number                                 │
│   └── lastActivity: Timestamp                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Domain Services

```
┌─────────────────────────────────────────────────────────────────┐
│                    DOMAIN SERVICES                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   HistoryFormatter (pure)                                       │
│   ─────────────────────────────────────────────────────────     │
│   formatAsChat(messages[]): string                              │
│   │  → "[datetime] SenderName: text • ..."                      │
│   │                                                             │
│   truncateToLength(history, maxLength): string                  │
│   │  → Preserve most recent messages within limit               │
│   │                                                             │
│   buildChatContext(messages[]): ChatMessage[]                   │
│   │  → Transform to {role, content}[] for GPT                   │
│                                                                 │
│   QuestionParser (pure)                                         │
│   ─────────────────────────────────────────────────────────     │
│   parseGPTResponse(text): string[]                              │
│   │  → Extract questions from various GPT response formats      │
│   │  → Handle JSON arrays, split on '?', strip markdown         │
│   │                                                             │
│   splitMultipleQuestions(text): string[]                        │
│   │  → Split compound questions into individual prompts         │
│                                                                 │
│   QuizRotation (pure)                                           │
│   ─────────────────────────────────────────────────────────     │
│   selectNextQuestion(questions[], lastAskedMap): Question       │
│   │  → Prefer unasked questions                                 │
│   │  → Rotate through category on exhaustion                    │
│   │                                                             │
│   shouldResetCategory(category, questions[]): boolean           │
│   │  → True if all questions in category have been asked        │
│                                                                 │
│   PromptBuilder (pure)                                          │
│   ─────────────────────────────────────────────────────────     │
│   buildBiographerPrompt(history, entry): ChatMessage[]          │
│   buildAutobiographerPrompt(history): ChatMessage[]             │
│   buildTherapistPrompt(history): ChatMessage[]                  │
│   buildMultipleChoicePrompt(history, comment, q): ChatMessage[] │
│   buildEvaluateResponsePrompt(history, resp, queue): ChatMsg[]  │
│                                                                 │
│   QueueManager (pure - state operations)                        │
│   ─────────────────────────────────────────────────────────     │
│   shouldContinueQueue(evalResult): boolean                      │
│   prepareNextQueueItem(queue[], choices): QueueItem             │
│   formatQuestion(text): string                                  │
│   │  → Add prefix emoji: "↘️ ...", "⏩ ...", "📘 ..."           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Port Interfaces (Journalist-Specific)

### 4.1 IPromptTemplateRepository

```
┌─────────────────────────────────────────────────────────────────┐
│                    IPromptTemplateRepository                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   PURPOSE:                                                      │
│   Load and fill prompt templates for GPT interactions.          │
│                                                                 │
│   METHODS:                                                      │
│   ─────────────────────────────────────────────────────────     │
│   getTemplate(promptId: PromptType): PromptTemplate             │
│   │                                                             │
│   fillTemplate(template, params): ChatMessage[]                 │
│   │  → Replace {{placeholders}} with values                     │
│   │                                                             │
│   listTemplates(): PromptType[]                                 │
│                                                                 │
│   PromptTemplate:                                               │
│   {                                                             │
│     id: string,                                                 │
│     sections: PromptSection[],                                  │
│     placeholders: string[]                                      │
│   }                                                             │
│                                                                 │
│   IMPLEMENTATIONS:                                              │
│   ─────────────────────────────────────────────────────────     │
│   • FilePromptTemplateRepository - YAML file based              │
│   • InMemoryPromptTemplateRepository - Testing                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 IJournalEntryRepository

```
┌─────────────────────────────────────────────────────────────────┐
│                    IJournalEntryRepository                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   EXTENDS: IRepository<JournalEntry>                            │
│                                                                 │
│   ADDITIONAL METHODS:                                           │
│   ─────────────────────────────────────────────────────────     │
│   findByDateRange(chatId, start, end): Promise<JournalEntry[]>  │
│   │                                                             │
│   findByDate(chatId, date): Promise<JournalEntry[]>             │
│   │                                                             │
│   findRecent(chatId, days): Promise<JournalEntry[]>             │
│   │                                                             │
│   getMessageHistory(chatId, limit): Promise<ConversationMsg[]>  │
│   │  → Recent messages for context building                     │
│   │                                                             │
│   aggregateByDate(chatId, startDate): Promise<DayEntries[]>     │
│   │  → Group entries by date for review                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4.3 IMessageQueueRepository

```
┌─────────────────────────────────────────────────────────────────┐
│                    IMessageQueueRepository                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   PURPOSE:                                                      │
│   Manage the queue of pending follow-up questions/prompts.      │
│                                                                 │
│   METHODS:                                                      │
│   ─────────────────────────────────────────────────────────     │
│   loadUnsentQueue(chatId): Promise<MessageQueue[]>              │
│   │  → Items with messageId = null, ordered by timestamp        │
│   │                                                             │
│   saveToQueue(chatId, items): Promise<void>                     │
│   │                                                             │
│   markSent(uuid, messageId): Promise<void>                      │
│   │                                                             │
│   clearQueue(chatId): Promise<void>                             │
│   │                                                             │
│   deleteUnprocessed(chatId): Promise<void>                      │
│   │  → Remove items that haven't been sent                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4.4 IQuizRepository

```
┌─────────────────────────────────────────────────────────────────┐
│                    IQuizRepository                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   METHODS:                                                      │
│   ─────────────────────────────────────────────────────────     │
│   loadQuestions(category?): Promise<QuizQuestion[]>             │
│   │                                                             │
│   getNextQuestion(category): Promise<QuizQuestion | null>       │
│   │  → Prefer unasked, rotate on exhaustion                     │
│   │                                                             │
│   recordAnswer(questionUuid, answer): Promise<void>             │
│   │                                                             │
│   resetCategory(category): Promise<void>                        │
│   │  → Clear lastAsked for all questions in category            │
│   │                                                             │
│   getAnswerHistory(chatId, dateRange): Promise<QuizAnswer[]>    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Use Cases

### 5.1 Use Case Catalog

```
┌─────────────────────────────────────────────────────────────────┐
│                    JOURNALIST USE CASES                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   JOURNALING                                                    │
│   ─────────────────────────────────────────────────────────     │
│   UC-J01: ProcessTextEntry                                      │
│   UC-J02: ProcessVoiceEntry                                     │
│   UC-J03: HandleCallbackResponse                                │
│   UC-J04: GenerateFollowUpQuestion                              │
│   UC-J05: GenerateMultipleChoices                               │
│                                                                 │
│   PROMPTING                                                     │
│   ─────────────────────────────────────────────────────────     │
│   UC-P01: InitiateJournalPrompt                                 │
│   UC-P02: EvaluateResponsePath                                  │
│   UC-P03: ProcessQueuedMessage                                  │
│   UC-P04: ClearAndRestart                                       │
│                                                                 │
│   QUIZZES                                                       │
│   ─────────────────────────────────────────────────────────     │
│   UC-Q01: SendQuizQuestion                                      │
│   UC-Q02: RecordQuizAnswer                                      │
│   UC-Q03: AdvanceToNextQuizQuestion                             │
│                                                                 │
│   ANALYSIS                                                      │
│   ─────────────────────────────────────────────────────────     │
│   UC-A01: GenerateTherapistAnalysis                             │
│   UC-A02: ReviewJournalEntries                                  │
│   UC-A03: ExportJournalMarkdown                                 │
│                                                                 │
│   COMMANDS                                                      │
│   ─────────────────────────────────────────────────────────     │
│   UC-C01: HandleJournalCommand (/journal, /prompt)              │
│   UC-C02: HandleAnalyzeCommand (/analyze)                       │
│   UC-C03: HandleReviewCommand (/review)                         │
│   UC-C04: HandleYesterdayCommand (/yesterday)                   │
│   UC-C05: HandleSpecialStart (🎲, ❌)                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Use Case Details

#### UC-J01: ProcessTextEntry

```
┌─────────────────────────────────────────────────────────────────┐
│   UC-J01: ProcessTextEntry (dearDiary)                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ACTOR: User                                                   │
│   TRIGGER: User sends a text message (not slash command)        │
│                                                                 │
│   PRECONDITIONS:                                                │
│   • Message is not a slash command                              │
│   • Message does not start with special emoji (🎲, ❌)          │
│                                                                 │
│   FLOW:                                                         │
│   1. Save user message to conversation history                  │
│   2. Check for pending queued messages                          │
│   │                                                             │
│   3a. IF queue exists:                                          │
│   │   a. Evaluate if response allows continuing queue           │
│   │   b. IF yes → send next queued message with choices         │
│   │   c. IF no → clear queue, regenerate follow-up              │
│   │                                                             │
│   3b. IF no queue:                                              │
│   │   a. Build conversation context from history                │
│   │   b. Call AI with "biographer" prompt                       │
│   │   c. Parse response for questions                           │
│   │   d. IF multiple questions → queue all, send first          │
│   │   e. IF single question → generate choices, send            │
│   │                                                             │
│   4. Generate multiple choice options via AI                    │
│   5. Send follow-up question with choices                       │
│                                                                 │
│   ALTERNATE FLOWS:                                              │
│   3a.c. Cache exists for message hash → use cached response     │
│   4a. GPT returns unparseable response → retry up to 5 times    │
│                                                                 │
│   POSTCONDITIONS:                                               │
│   • User message saved to history                               │
│   • Follow-up question sent with multiple choice keyboard       │
│   • Queue may contain additional follow-up questions            │
│                                                                 │
│   DEPENDENCIES:                                                 │
│   • IMessagingGateway                                           │
│   • IAIGateway                                                  │
│   • IJournalEntryRepository                                     │
│   • IMessageQueueRepository                                     │
│   • IPromptTemplateRepository                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### UC-P01: InitiateJournalPrompt

```
┌─────────────────────────────────────────────────────────────────┐
│   UC-P01: InitiateJournalPrompt (journalPrompt)                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ACTOR: User or System (cron)                                  │
│   TRIGGER: /journal command OR /prompt command OR scheduled     │
│                                                                 │
│   FLOW:                                                         │
│   1. Delete any pending unanswered bot message                  │
│   2. Load recent conversation history                           │
│   3. Build "autobiographer" prompt                              │
│   4. Call AI to generate opening question                       │
│   5. Generate multiple choice options                           │
│   6. Send question with "📘" prefix                             │
│                                                                 │
│   SPECIAL CASE: "change_subject" instruction                    │
│   → Skip history loading, use empty context                     │
│   → Forces fresh topic generation                               │
│                                                                 │
│   POSTCONDITIONS:                                               │
│   • New journaling prompt visible to user                       │
│   • Previous unanswered prompts cleaned up                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### UC-A01: GenerateTherapistAnalysis

```
┌─────────────────────────────────────────────────────────────────┐
│   UC-A01: GenerateTherapistAnalysis (/analyze)                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ACTOR: User                                                   │
│   TRIGGER: /analyze command                                     │
│                                                                 │
│   FLOW:                                                         │
│   1. Delete pending unanswered messages                         │
│   2. Load extended conversation history                         │
│   3. Build "therapist_analysis" prompt                          │
│   4. Call AI for therapeutic reflection                         │
│   5. Send analysis with "📘" prefix                             │
│                                                                 │
│   AI PROMPT FOCUS:                                              │
│   • Identify emotional patterns                                 │
│   • Highlight recurring themes                                  │
│   • Offer supportive observations                               │
│   • Avoid prescriptive advice                                   │
│                                                                 │
│   POSTCONDITIONS:                                               │
│   • User receives therapeutic analysis message                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### UC-Q02: RecordQuizAnswer

```
┌─────────────────────────────────────────────────────────────────┐
│   UC-Q02: RecordQuizAnswer                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ACTOR: User                                                   │
│   TRIGGER: User presses callback button on quiz message         │
│                                                                 │
│   PRECONDITIONS:                                                │
│   • Message has foreignKey.quiz set                             │
│                                                                 │
│   FLOW:                                                         │
│   1. Extract quiz key and answer from callback                  │
│   2. Record answer in quiz repository                           │
│   3. Check for next question in queue                           │
│   │                                                             │
│   4a. IF next question is also quiz:                            │
│   │   → Update message text and buttons (reuse message)         │
│   │   → Update message DB record                                │
│   │                                                             │
│   4b. IF next question is not quiz OR no queue:                 │
│   │   → Delete quiz message                                     │
│   │   → Return to journal prompting                             │
│                                                                 │
│   POSTCONDITIONS:                                               │
│   • Quiz answer recorded with date                              │
│   • UI transitions to next state                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. Conversation Flows

### 6.1 Main Conversation Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    JOURNALIST MAIN FLOW                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   INCOMING MESSAGE                                              │
│         │                                                       │
│         ▼                                                       │
│   ┌─────────────────────────────────────────────────┐           │
│   │ Is it a slash command? (/journal, /analyze...)  │           │
│   └─────────────────┬───────────────────────────────┘           │
│                     │                                           │
│          ┌──────────┴──────────┐                                │
│          │ YES                 │ NO                             │
│          ▼                     ▼                                │
│   ┌─────────────┐      ┌─────────────────────────────┐          │
│   │  Slash Cmd  │      │ Is it a special start?      │          │
│   │  Handler    │      │ (🎲 Change Subject, ❌ Cancel)│         │
│   └─────────────┘      └────────────┬────────────────┘          │
│                                     │                           │
│                          ┌──────────┴──────────┐                │
│                          │ YES                 │ NO             │
│                          ▼                     ▼                │
│                   ┌─────────────┐      ┌─────────────────┐      │
│                   │  Clear &    │      │ Is it a callback│      │
│                   │  Restart    │      │ query (button)? │      │
│                   └─────────────┘      └────────┬────────┘      │
│                                                 │               │
│                                      ┌──────────┴──────────┐    │
│                                      │ YES                 │ NO │
│                                      ▼                     ▼    │
│                               ┌─────────────┐      ┌───────────┐│
│                               │  Callback   │      │   Text/   ││
│                               │  Handler    │      │   Voice   ││
│                               │ (quiz/choice)│     │  Handler  ││
│                               └─────────────┘      └───────────┘│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 Follow-Up Question Flow (dearDiary)

```
┌─────────────────────────────────────────────────────────────────┐
│                    FOLLOW-UP QUESTION FLOW                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   USER ENTRY RECEIVED                                           │
│         │                                                       │
│         ▼                                                       │
│   ┌─────────────────────────────────────────────────┐           │
│   │ Check for pending queue                          │           │
│   └─────────────────┬───────────────────────────────┘           │
│                     │                                           │
│          ┌──────────┴──────────┐                                │
│          │ QUEUE EXISTS        │ NO QUEUE                       │
│          ▼                     ▼                                │
│   ┌─────────────────┐  ┌─────────────────────────────┐          │
│   │ Evaluate if     │  │ Generate new follow-up      │          │
│   │ response allows │  │ via biographer prompt       │          │
│   │ continuing queue│  └────────────┬────────────────┘          │
│   └────────┬────────┘               │                           │
│            │                        │                           │
│   ┌────────┴────────┐               │                           │
│   │ YES     │ NO    │               │                           │
│   ▼         ▼       │               │                           │
│  Send     Clear     │               │                           │
│  next     queue     │               │                           │
│  queued   └─────────┼───────────────┘                           │
│  message            │                                           │
│   │                 ▼                                           │
│   │         ┌─────────────────────────────────────┐             │
│   │         │ Parse GPT response for questions    │             │
│   │         └────────────┬────────────────────────┘             │
│   │                      │                                      │
│   │           ┌──────────┴──────────┐                           │
│   │           │ MULTIPLE Qs │ SINGLE Q                          │
│   │           ▼             ▼                                   │
│   │      Queue all     Generate                                 │
│   │      Send first    choices                                  │
│   │           │             │                                   │
│   └───────────┴─────────────┴──────────────┐                    │
│                                            ▼                    │
│                              ┌─────────────────────────────┐    │
│                              │ Generate multiple choices   │    │
│                              │ via multiple_choice prompt  │    │
│                              └──────────────┬──────────────┘    │
│                                             │                   │
│                                             ▼                   │
│                              ┌─────────────────────────────┐    │
│                              │ Send question with buttons  │    │
│                              │ [Choice 1] [Choice 2] ...   │    │
│                              │ [🎲 Change Subject] [❌ Cancel]│  │
│                              └─────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 6.3 Quiz Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    QUIZ FLOW                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   QUIZ INITIATED (e.g., by cron job)                            │
│         │                                                       │
│         ▼                                                       │
│   ┌─────────────────────────────────────────────────┐           │
│   │ Load questions for category                      │           │
│   │ Select unasked question (or rotate)              │           │
│   └─────────────────┬───────────────────────────────┘           │
│                     │                                           │
│                     ▼                                           │
│   ┌─────────────────────────────────────────────────┐           │
│   │ Queue all questions in category                  │           │
│   │ Set foreignKey.quiz = question_uuid              │           │
│   └─────────────────┬───────────────────────────────┘           │
│                     │                                           │
│                     ▼                                           │
│   ┌─────────────────────────────────────────────────┐           │
│   │ Send first question with inline buttons          │           │
│   │ [Option A] [Option B] [Option C] ...            │           │
│   └─────────────────┬───────────────────────────────┘           │
│                     │                                           │
│                     │ ◄──────── USER ANSWERS                    │
│                     ▼                                           │
│   ┌─────────────────────────────────────────────────┐           │
│   │ Record answer with date                          │           │
│   │ Check for more questions in queue                │           │
│   └─────────────────┬───────────────────────────────┘           │
│                     │                                           │
│          ┌──────────┴──────────┐                                │
│          │ MORE QUIZ Qs        │ NO MORE QUIZ                   │
│          ▼                     ▼                                │
│   ┌─────────────┐      ┌─────────────────┐                      │
│   │ Update same │      │ Delete message  │                      │
│   │ message with│      │ Return to       │                      │
│   │ next question│     │ journal prompt  │                      │
│   └─────────────┘      └─────────────────┘                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. AI Prompts Design

### 7.1 Prompt Template System

```
┌─────────────────────────────────────────────────────────────────┐
│                    PROMPT TEMPLATE SYSTEM                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   TEMPLATE STRUCTURE (YAML):                                    │
│   ─────────────────────────────────────────────────────────     │
│   biographer:                                                   │
│     - system: |                                                 │
│         You are a biographical interviewer...                   │
│         Given conversation history: {{MESSAGE_HISTORY}}         │
│     - user: "{{USER_ENTRY}}"                                    │
│     - assistant: "Let me think of a follow-up..."               │
│     - user: "Respond with a JSON array of questions..."         │
│                                                                 │
│   PLACEHOLDER INJECTION:                                        │
│   ─────────────────────────────────────────────────────────     │
│   {{MESSAGE_HISTORY}} - Recent conversation context             │
│   {{USER_ENTRY}}      - Current user input                      │
│   {{RESPONSE}}        - User's response for evaluation          │
│   {{PLANNED_QUESTIONS}} - Queued questions for path evaluation  │
│   {{COMMENT}}         - AI comment on user entry                │
│   {{FOLLOWUP_QUESTION}} - Question needing choices              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 Prompt Types

```
┌─────────────────────────────────────────────────────────────────┐
│                    PROMPT TYPES                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   biographer                                                    │
│   ─────────────────────────────────────────────────────────     │
│   PURPOSE: Generate follow-up questions based on user entry     │
│   INPUT: Conversation history + user entry                      │
│   OUTPUT: JSON array of questions ["Q1?", "Q2?", ...]           │
│   TONE: Curious, supportive, non-judgmental                     │
│                                                                 │
│   autobiographer                                                │
│   ─────────────────────────────────────────────────────────     │
│   PURPOSE: Generate opening journaling prompt                   │
│   INPUT: Recent conversation history                            │
│   OUTPUT: Single question to start journaling session           │
│   TONE: Inviting, thought-provoking                             │
│                                                                 │
│   multiple_choice                                               │
│   ─────────────────────────────────────────────────────────     │
│   PURPOSE: Generate multiple choice options for a question      │
│   INPUT: History, AI comment, follow-up question                │
│   OUTPUT: JSON array of 3-5 response options                    │
│   STYLE: Natural, varied, include emotional options             │
│                                                                 │
│   evaluate_response                                             │
│   ─────────────────────────────────────────────────────────     │
│   PURPOSE: Decide if queued questions are still relevant        │
│   INPUT: History, user response, planned questions              │
│   OUTPUT: "1" (continue queue) or "0" (abandon queue)           │
│   LOGIC: Abandon if user changed subject dramatically           │
│                                                                 │
│   therapist_analysis                                            │
│   ─────────────────────────────────────────────────────────     │
│   PURPOSE: Provide therapeutic reflection on journal entries    │
│   INPUT: Extended conversation history                          │
│   OUTPUT: Paragraph of supportive analysis                      │
│   TONE: Warm, validating, insightful                            │
│   CONSTRAINTS: No prescriptive advice, no diagnosis             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. Directory Structure (Journalist)

```
backend/chatbots/journalist/
├── domain/                           # Journalist-specific domain
│   ├── value-objects/
│   │   ├── JournalPeriod.mjs
│   │   ├── EntrySource.mjs
│   │   ├── QuizCategory.mjs
│   │   ├── PromptType.mjs
│   │   └── index.mjs
│   │
│   ├── entities/
│   │   ├── JournalEntry.mjs
│   │   ├── ConversationMessage.mjs
│   │   ├── MessageQueue.mjs
│   │   ├── QuizQuestion.mjs
│   │   ├── QuizAnswer.mjs
│   │   ├── EntryAnalysis.mjs
│   │   ├── TherapistSession.mjs
│   │   └── index.mjs
│   │
│   ├── services/
│   │   ├── HistoryFormatter.mjs
│   │   ├── QuestionParser.mjs
│   │   ├── QuizRotation.mjs
│   │   ├── PromptBuilder.mjs
│   │   ├── QueueManager.mjs
│   │   └── index.mjs
│   │
│   └── index.mjs
│
├── application/
│   ├── ports/
│   │   ├── IPromptTemplateRepository.mjs
│   │   ├── IJournalEntryRepository.mjs
│   │   ├── IMessageQueueRepository.mjs
│   │   ├── IQuizRepository.mjs
│   │   └── index.mjs
│   │
│   ├── usecases/
│   │   ├── journaling/
│   │   │   ├── ProcessTextEntry.mjs
│   │   │   ├── ProcessVoiceEntry.mjs
│   │   │   ├── HandleCallbackResponse.mjs
│   │   │   └── GenerateFollowUpQuestion.mjs
│   │   ├── prompting/
│   │   │   ├── InitiateJournalPrompt.mjs
│   │   │   ├── EvaluateResponsePath.mjs
│   │   │   ├── ProcessQueuedMessage.mjs
│   │   │   └── GenerateMultipleChoices.mjs
│   │   ├── quizzes/
│   │   │   ├── SendQuizQuestion.mjs
│   │   │   ├── RecordQuizAnswer.mjs
│   │   │   └── AdvanceToNextQuizQuestion.mjs
│   │   ├── analysis/
│   │   │   ├── GenerateTherapistAnalysis.mjs
│   │   │   ├── ReviewJournalEntries.mjs
│   │   │   └── ExportJournalMarkdown.mjs
│   │   ├── commands/
│   │   │   ├── HandleSlashCommand.mjs
│   │   │   └── HandleSpecialStart.mjs
│   │   └── index.mjs
│   │
│   └── index.mjs
│
├── infrastructure/
│   ├── persistence/
│   │   ├── FileJournalEntryRepository.mjs
│   │   ├── FileMessageQueueRepository.mjs
│   │   ├── FileQuizRepository.mjs
│   │   └── FilePromptTemplateRepository.mjs
│   │
│   ├── ai/
│   │   └── JournalistAIGateway.mjs
│   │
│   └── index.mjs
│
├── adapters/
│   └── EventRouter.mjs
│
├── handlers/
│   ├── webhook.mjs
│   ├── journal.mjs
│   └── trigger.mjs
│
├── container.mjs
├── server.mjs
├── config.mjs
│
└── _test/
    ├── ProcessTextEntry.test.mjs
    ├── QuizFlow.test.mjs
    └── AnalysisGeneration.test.mjs
```

---

## 9. Configuration Schema (Journalist)

```yaml
# config/journalist.yml
extends: _common.yml

telegram:
  token: ${TELEGRAM_JOURNALIST_BOT_TOKEN}
  botId: ${JOURNALIST_BOT_ID}

openai:
  model: gpt-4o
  maxTokens: 1000
  timeout: 30000

prompts:
  templateFile: journalist/templates.yml
  cacheTTL: 300  # seconds

queue:
  maxDepth: 10
  evaluatePathThreshold: 3  # messages before re-evaluating

quiz:
  categories:
    - mood
    - goals
    - gratitude
    - reflection
  rotationStrategy: unasked_first
  resetOnExhaustion: true

history:
  maxMessages: 100
  contextLength: 3000  # characters

analysis:
  minEntriesForTherapist: 5
  reviewPeriodDays: 7

paths:
  messagesStore: journalist/messages
  journalEntriesStore: journalist/journalentries
  queueStore: journalist/messagequeue
  quizQuestionsStore: journalist/quizquestions
  templatesFile: journalist/templates
```

---

## 10. Comparison: Nutribot vs Journalist

| Aspect | Nutribot | Journalist |
|--------|----------|------------|
| **Primary Input** | Images, UPC, text descriptions | Text, voice, button selections |
| **Output Style** | Visual reports, emoji feedback | Conversational follow-ups |
| **AI Usage** | Food detection, macro estimation | Follow-up generation, analysis |
| **State Complexity** | Medium (revision, adjustment flows) | Medium (queue management, quizzes) |
| **External Services** | UPC APIs, Image hosting | None (pure LLM) |
| **Data Persistence** | Nutrition data, daily summaries | Conversation history, quiz answers |
| **Report Output** | Canvas-generated images | Markdown text |
| **Interaction Pattern** | Action → Confirm/Revise → Report | Prompt → Response → Follow-up |

---

*This document details the Journalist bot design. See `_common.md` for shared architecture and `nutribot.md` for the Nutribot design.*
