# Backend Migration Status

**Last Updated:** 2026-01-12
**Test Status:** 1214 tests passing (92 suites)
**Detailed Workplan:** [migration-workplan.md](./2026-01-11-migration-workplan.md)

---

## Summary

| Metric | AS-IS | TO-BE | Gap |
|--------|-------|-------|-----|
| Legacy files (`_legacy/`) | 322 | 0 | -322 |
| New src/ files | 80 | ~180 | +100 |
| Domains with code | 2 | 7 | +5 |
| Applications | 0 | 4 | +4 |

---

## Phase Summary

| Phase | Description | Status | Progress |
|-------|-------------|--------|----------|
| 1a | Logging | ✅ Complete | 100% |
| 1b | Config | ✅ Complete | 100% |
| 1c | Scheduling | ✅ Complete | 100% |
| 1d | EventBus | ✅ Complete | 100% |
| **1** | **Infrastructure** | **✅ Complete** | **100%** |
| 2a | Fitness Domain | ✅ Complete | 100% |
| 2b | Finance Domain | ✅ Complete | 100% |
| 2c | Messaging Domain | ✅ Complete | 100% |
| 2d | Nutrition/Journaling | ✅ Complete | 100% |
| **2** | **Domains** | **✅ 4 of 4 done** | **100%** |
| 3a | Fitness Adapters | ✅ Complete | 100% |
| 3b | Finance Adapters | ✅ Complete | 100% |
| 3c | Messaging Adapters | ✅ Complete | 100% |
| 3d | Nutrition/Journaling Adapters | ✅ Complete | 100% |
| 3e | AI Adapters | ✅ Complete | 100% |
| 3f | External APIs (16) | ✅ Complete | 100% |
| **3** | **Adapters** | **✅ Complete** | **100%** |
| 4a | Nutribot (116 files) | ✅ Complete | 100% |
| 4b | Journalist (57 files) | ✅ Complete | 100% |
| 4c | Fitness App | ✅ Complete | 100% |
| 4d | Finance App | ✅ Complete | 100% |
| **4** | **Applications** | **✅ 4 of 4 done** | **100%** |
| 5a | Server Entry | ⬜ Not Started | 0% |
| 5b | Router Migration (15→5) | 🔄 Content + Fitness + Finance + Messaging + Nutrition + Journaling + AI | 70% |
| 5c | Webhook Server | ⬜ Not Started | 0% |
| 5d | Legacy Shims | 🔄 Content + Finance | 50% |
| **5** | **API Layer** | **🔄 In Progress** | **30%** |
| 6 | Cleanup | ⬜ Blocked | 0% |

---

## Completed Work

### Phase 1: Infrastructure ✅

**Logging** (`src/0_infrastructure/logging/`)
- [x] LogDispatcher with transport architecture
- [x] Console, File, Loggly transports (with unit tests)
- [x] Logger factory with structured logging
- [x] Config loading from YAML and environment
- [x] Frontend log ingestion (with unit tests)

**Config** (`src/0_infrastructure/config/`)
- [x] ConfigService with path resolution
- [x] UserDataService for household data
- [x] Healthcheck validation
- [x] Schema-based config loading

**Scheduling** (`src/0_infrastructure/scheduling/`)
- [x] TaskRegistry for job management
- [x] CronRunner for scheduled execution

**EventBus** (`src/0_infrastructure/eventbus/`)
- [x] IEventBus port interface
- [x] EventBusImpl core implementation
- [x] WebSocketAdapter for real-time broadcasts
- [x] MqttAdapter for sensor data

### Content Domain ✅ (Bonus - Done Early)

**Domain** (`src/1_domains/content/`)
- [x] ContentItem entity
- [x] WatchState entity
- [x] ContentSourceRegistry

**Adapters** (`src/2_adapters/content/`)
- [x] PlexAdapter (media libraries)
- [x] FolderAdapter (filesystem)
- [x] LocalContentAdapter (scripture, hymns, songs)
- [x] YamlWatchStateStore (progress tracking)

**API** (`src/4_api/`)
- [x] `/api/list/*` router - mounted
- [x] `/api/play/*` router - mounted
- [x] `/api/content/*` router - mounted
- [x] `/proxy/*` router - mounted
- [x] Legacy shims for backward compatibility

### Phase 2a: Fitness Domain ✅

**Entities** (`src/1_domains/fitness/entities/`)
- [x] Session (sessionId, startTime, endTime, roster, timeline, snapshots, metadata)
- [x] Participant (name, hrDeviceId, isGuest, isPrimary)
- [x] Zone (cool, active, warm, hot, fire with priority logic)

**Services** (`src/1_domains/fitness/services/`)
- [x] SessionService (CRUD, listing, filtering, timeline encoding)
- [x] ZoneService (zone resolution, group zone, colors)
- [x] TimelineService (RLE encoding/decoding for HR series)

**Ports** (`src/1_domains/fitness/ports/`)
- [x] ISessionStore (YAML persistence interface)
- [x] IZoneLedController (ambient LED control interface)

### Phase 3a: Fitness Adapters ✅

**Persistence** (`src/2_adapters/persistence/yaml/`)
- [x] YamlSessionStore - Full ISessionStore implementation
  - listDates, findByDate, findById, save, delete
  - Timestamp parsing with timezone support
  - v2 → v3 compatibility (participants → roster)

**Fitness** (`src/2_adapters/fitness/`)
- [x] HomeAssistantZoneLedAdapter - Full IZoneLedController implementation
  - Rate limiting (configurable throttle)
  - Circuit breaker with exponential backoff
  - Deduplication (skip duplicate scenes)
  - Zone priority resolution (highest zone wins)
  - fire_all detection (all users in fire zone)
  - Metrics and observability endpoints

### Fitness API Router (`src/4_api/routers/fitness.mjs`)
- [x] GET /api/fitness - Get fitness config (hydrated)
- [x] GET /api/fitness/sessions/dates - List session dates
- [x] GET /api/fitness/sessions - List sessions by date
- [x] GET /api/fitness/sessions/:sessionId - Get session detail
- [x] POST /api/fitness/save_session - Save session
- [x] POST /api/fitness/save_screenshot - Save screenshot
- [x] POST /api/fitness/voice_memo - Transcribe voice memo
- [x] POST /api/fitness/zone_led - Sync ambient LED
- [x] GET /api/fitness/zone_led/status - LED status
- [x] GET /api/fitness/zone_led/metrics - LED metrics
- [x] POST /api/fitness/zone_led/reset - Reset LED state

### Phase 2b: Finance Domain ✅

**Entities** (`src/1_domains/finance/entities/`)
- [x] Account (id, name, type, balance, currency, institution)
- [x] Transaction (id, date, amount, description, category, tags)
- [x] Budget (category, limit, spent, getRemaining, isOverBudget)
- [x] Mortgage (principal, rate, term, calculateMonthlyPayment)

**Services** (`src/1_domains/finance/services/`)
- [x] BudgetService (CRUD, syncBudgetSpending)
- [x] MortgageService (calculateAmortizationSchedule, getPayoffDate)

**Ports** (`src/1_domains/finance/ports/`)
- [x] ITransactionSource (findByCategory, findInRange, findByAccount)

### Phase 3b: Finance Adapters ✅

**Finance** (`src/2_adapters/finance/`)
- [x] BuxferAdapter - Full ITransactionSource implementation
  - Token-based authentication with caching
  - Paginated transaction fetching
  - Account balance retrieval
  - Transaction CRUD (add, update, delete)
  - Metrics and observability endpoints

### Finance API Router (`src/4_api/routers/finance.mjs`)
- [x] GET /api/finance - Get finance config overview
- [x] GET /api/finance/data - Get compiled finances (legacy /data/budget)
- [x] GET /api/finance/data/daytoday - Get current day-to-day budget
- [x] GET /api/finance/accounts - Get account balances
- [x] GET /api/finance/transactions - Get transactions
- [x] POST /api/finance/transactions/:id - Update transaction
- [x] GET /api/finance/budgets - List budgets
- [x] GET /api/finance/budgets/:budgetId - Get budget detail
- [x] GET /api/finance/mortgage - Get mortgage data
- [x] POST /api/finance/refresh - Trigger data refresh (replaces /harvest/budget)
- [x] POST /api/finance/compile - Trigger budget compilation
- [x] POST /api/finance/categorize - Trigger AI transaction categorization
- [x] GET /api/finance/memos - Get all memos
- [x] POST /api/finance/memos/:transactionId - Save memo
- [x] GET /api/finance/metrics - Get adapter metrics

### Phase 2c: Messaging Domain ✅

**Entities** (`src/1_domains/messaging/entities/`)
- [x] Message (id, conversationId, senderId, recipientId, type, content, timestamp)
- [x] Conversation (id, participants, messages, metadata)
- [x] Notification (id, type, title, body, recipient)

**Services** (`src/1_domains/messaging/services/`)
- [x] ConversationService (CRUD, message management, statistics)
- [x] NotificationService (send, schedule, priority routing)

**Ports** (`src/1_domains/messaging/ports/`)
- [x] IMessagingGateway (sendMessage, sendImage, updateMessage, transcribeVoice)
- [x] IConversationStore (save, findById, findByParticipants)
- [x] INotificationChannel (send notifications)

### Phase 3c: Messaging Adapters ✅

**Messaging** (`src/2_adapters/messaging/`)
- [x] TelegramAdapter - Full IMessagingGateway and INotificationChannel implementation
  - Bot management (getMe, setWebhook)
  - Message sending (text, image, with keyboards)
  - Message editing and deletion
  - Voice transcription support
  - Callback query handling
- [x] GmailAdapter - Email harvesting and notification support

### Phase 2d: Nutrition/Journaling Domain ✅

**Nutrition Entities** (`src/1_domains/nutrition/entities/`)
- [x] FoodLog (id, userId, date, entries, totalCalories, macros)
- [x] NutritionEntry (id, name, calories, protein, carbs, fat, servingSize)

**Nutrition Services** (`src/1_domains/nutrition/services/`)
- [x] FoodLogService (getLog, logFood, removeEntry, getDailySummary, getWeeklySummary)

**Nutrition Ports** (`src/1_domains/nutrition/ports/`)
- [x] IFoodLogStore (save, findByUserAndDate, findByUserInRange, listDates)

**Journaling Entities** (`src/1_domains/journaling/entities/`)
- [x] JournalEntry (id, userId, date, content, mood, tags, gratitudeItems)

**Journaling Services** (`src/1_domains/journaling/services/`)
- [x] JournalService (createEntry, updateEntry, deleteEntry, getMoodSummary)

**Journaling Ports** (`src/1_domains/journaling/ports/`)
- [x] IJournalStore (save, findById, findByUserAndDate, findByUserAndTag)

### Phase 3d: Nutrition/Journaling Adapters ✅

**Persistence** (`src/2_adapters/persistence/yaml/`)
- [x] YamlFoodLogStore - Food log YAML persistence
- [x] YamlJournalStore - Journal entry YAML persistence

### Nutrition/Journaling API Routers (`src/4_api/routers/`)
- [x] nutrition.mjs - GET/POST /api/nutrition/logs, summaries, ranges
- [x] journaling.mjs - GET/POST/PUT/DELETE /api/journaling/entries, mood-summary, tags

### Phase 3e: AI Adapters ✅

**Ports** (`src/1_domains/ai/ports/`)
- [x] IAIGateway - Core AI abstraction interface
  - chat(messages) - Send conversation and get text response
  - chatWithImage(messages, imageUrl) - Vision analysis
  - chatWithJson(messages) - Get structured JSON response
  - transcribe(audioBuffer) - Audio to text transcription
  - embed(text) - Generate text embeddings
  - Helper functions: isAIGateway, assertAIGateway, systemMessage, userMessage, assistantMessage
- [x] ITranscriptionService - Audio transcription interface
  - transcribe(buffer) - Transcribe audio buffer
  - transcribeUrl(url) - Transcribe from URL
  - getSupportedFormats() - List supported audio formats

**AI Adapters** (`src/2_adapters/ai/`)
- [x] OpenAIAdapter - Full IAIGateway implementation for OpenAI API
  - Chat completions with gpt-4o
  - Vision analysis with gpt-4o
  - Whisper transcription (mp3, mp4, wav, etc.)
  - Text embeddings (text-embedding-3-small)
  - Metrics tracking (requests, tokens, errors)
- [x] AnthropicAdapter - IAIGateway implementation for Anthropic Claude
  - Chat completions with claude-sonnet-4-20250514
  - Vision analysis (base64 and URL images)
  - System prompt extraction from messages
  - Markdown-wrapped JSON handling
  - Explicit errors for unsupported operations (transcribe, embed)

### AI API Router (`src/4_api/routers/ai.mjs`)
- [x] GET /api/ai - Get AI module status and configured providers
- [x] POST /api/ai/chat - Send chat messages (provider selection)
- [x] POST /api/ai/chat/json - Get structured JSON response
- [x] POST /api/ai/chat/vision - Vision analysis with image
- [x] POST /api/ai/transcribe - Audio transcription (OpenAI only)
- [x] POST /api/ai/embed - Text embeddings (OpenAI only)
- [x] GET /api/ai/metrics - Get adapter metrics
- [x] POST /api/ai/metrics/reset - Reset metrics

### Phase 3f: External API Harvesters ✅ (100%)

All harvesters implement `IHarvester` interface with:
- `harvest(username, options)` - Main data fetch method
- `getStatus()` - Circuit breaker state
- `serviceId` / `category` getters
- CircuitBreaker resilience with exponential backoff
- YamlLifelogStore / YamlAuthStore for persistence

**Fitness Harvesters** (`src/2_adapters/harvester/fitness/`)
- [x] GarminHarvester - OAuth activities, sleep, HR
- [x] StravaHarvester - OAuth activities with segments
- [x] WithingsHarvester - OAuth weight, BP measurements

**Productivity Harvesters** (`src/2_adapters/harvester/productivity/`)
- [x] TodoistHarvester - Completed tasks via Todoist API
- [x] ClickUpHarvester - Tasks with status, workspace-aware
- [x] GitHubHarvester - Commits, PRs, issues across repos

**Social Harvesters** (`src/2_adapters/harvester/social/`)
- [x] LastfmHarvester - Recent tracks via scrobble API
- [x] RedditHarvester - Comments/posts from user profile
- [x] LetterboxdHarvester - Film diary via RSS feed
- [x] GoodreadsHarvester - Books via RSS feed
- [x] FoursquareHarvester - Swarm check-ins with venue, photos, comments

**Communication Harvesters** (`src/2_adapters/harvester/communication/`)
- [x] GmailHarvester - Inbox/sent via Gmail API
- [x] GCalHarvester - Calendar events with multi-calendar support

**Finance Harvesters** (`src/2_adapters/harvester/finance/`)
- [x] ShoppingHarvester - Gmail receipt scanning with AI extraction (personal purchase history)

**Other Harvesters** (`src/2_adapters/harvester/other/`)
- [x] WeatherHarvester - Open-Meteo weather + air quality (household-level)
- [x] ScriptureHarvester - Scripture Guide API content fetch

**Wired into Legacy** (`_legacy/routers/harvest.mjs`)
- All 16 harvesters registered with strangler-fig pattern
- Legacy harvesters delegate to new DDD harvesters
- Budget handled separately via Finance domain (BuxferAdapter + BudgetCompilationService)

### Phase 4a: Nutribot Application ✅

**Domain Migration** (`src/1_domains/nutrition/`)
- [x] NutriLog entity (aggregate root with items, status lifecycle)
- [x] FoodItem value object (calories, macros, Noom colors)
- [x] Formatters (formatFoodList, formatDateHeader, NOOM_COLOR_EMOJI)
- [x] Schemas (Zod validation for items and logs)

**Adapters** (`src/2_adapters/persistence/yaml/`)
- [x] YamlFoodLogStore - Food log persistence (IFoodLogStore)
- [x] YamlNutriListStore - Daily nutrient list (INutriListStore)
- [x] YamlNutriCoachStore - Coaching history (INutriCoachStore)

**Use Cases** (`src/3_applications/nutribot/usecases/`) - 24 use cases migrated:
- [x] Food Logging: LogFoodFromText, LogFoodFromImage, LogFoodFromVoice, LogFoodFromUPC
- [x] Log Actions: AcceptFoodLog, DiscardFoodLog, ReviseFoodLog, SelectUPCPortion
- [x] Revision Flow: ProcessRevisionInput
- [x] Adjustment Flow: StartAdjustmentFlow, ShowDateSelection, SelectDateForAdjustment, SelectItemForAdjustment, ApplyPortionAdjustment, DeleteListItem, MoveItemToDate
- [x] Batch: ConfirmAllPending
- [x] Commands: HandleHelpCommand, HandleReviewCommand
- [x] Reports: GenerateDailyReport, GetReportAsJSON
- [x] Coaching: GenerateThresholdCoaching, GenerateOnDemandCoaching, GenerateReportCoaching

**Container & Config** (`src/3_applications/nutribot/`)
- [x] NutribotContainer - DI container with lazy-loaded use cases
- [x] NutriBotConfig - User mapping, goals, storage paths

**API Routes** (`src/4_api/`)
- [x] `routers/nutribot.mjs` - Express router for webhook and direct API
- [x] `handlers/nutribot/report.mjs` - JSON report handler
- [x] `handlers/nutribot/reportImg.mjs` - PNG report image handler
- [x] `handlers/nutribot/directInput.mjs` - UPC, image, text handlers

**Key Pattern Changes:**
- `nutrilogRepository` → `foodLogStore`
- `nutrilistRepository` → `nutriListStore`
- `nutricoachRepository` → `nutriCoachStore`
- Removed direct `createLogger` - uses injected logger with fallback
- `encodeCallback` injected as dependency

### Phase 4b: Journalist Application ✅

**Domain Migration** (`src/1_domains/journalist/`)
- [x] Value Objects: EntrySource, PromptType, QuizCategory
- [x] Entities: ConversationMessage, JournalEntry, MessageQueue, QuizQuestion, QuizAnswer
- [x] Services: HistoryFormatter, MessageSplitter, PromptBuilder, QueueManager, QuestionParser

**Ports** (`src/3_applications/journalist/ports/`)
- [x] IJournalEntryRepository - Journal entry persistence
- [x] IMessageQueueRepository - Message queue persistence
- [x] IPromptTemplateRepository - Prompt template access
- [x] IQuizRepository - Quiz question/answer persistence

**Adapters** (`src/2_adapters/journalist/`)
- [x] LifelogAggregator - Aggregates lifelog data from multiple sources
- [x] DebriefRepository - YAML-based debrief persistence
- [x] LoggingAIGateway - AI gateway with logging wrapper
- [x] JournalistInputRouter - Routes Telegram events to use cases

**Use Cases** (`src/3_applications/journalist/usecases/`) - 21 use cases migrated:
- [x] Core: ProcessTextEntry, ProcessVoiceEntry, InitiateJournalPrompt, GenerateMultipleChoices, HandleCallbackResponse
- [x] Quiz: SendQuizQuestion, RecordQuizAnswer, AdvanceToNextQuizQuestion, HandleQuizAnswer
- [x] Analysis: GenerateTherapistAnalysis, ReviewJournalEntries, ExportJournalMarkdown
- [x] Commands: HandleSlashCommand, HandleSpecialStart
- [x] Morning Debrief: GenerateMorningDebrief, SendMorningDebrief, HandleCategorySelection, HandleDebriefResponse, HandleSourceSelection, InitiateDebriefInterview

**Container & Config** (`src/3_applications/journalist/`)
- [x] JournalistContainer - DI container with lazy-loaded use cases
- [x] Application index.mjs - Barrel exports

**API Routes** (`src/4_api/`)
- [x] `routers/journalist.mjs` - Express router for webhook, trigger, journal export, morning debrief
- [x] `handlers/journalist/journal.mjs` - Journal markdown export handler
- [x] `handlers/journalist/trigger.mjs` - Journal prompt trigger handler
- [x] `handlers/journalist/morning.mjs` - Morning debrief handler

**Key Pattern Changes:**
- Removed direct `createLogger` - uses injected logger with fallback to console
- Domain services as pure functions (not classes)
- Immutable entities using private fields (`#`) and `Object.freeze()`
- Value objects as frozen enums with helper functions

### Phase 4c: Fitness Application ✅

**Domain** (already complete from Phase 2a)
- [x] Session, Participant, Zone entities
- [x] SessionService, ZoneService, TimelineService
- [x] ISessionStore, IZoneLedController ports

**Adapters** (already complete from Phase 3a, plus new additions)
- [x] YamlSessionStore - Session persistence
- [x] HomeAssistantZoneLedAdapter - Zone LED control with rate limiting and circuit breaker
- [x] VoiceMemoTranscriptionService - Wraps OpenAI for fitness-specific transcription
- [x] transcriptionContext.mjs - Builds Whisper prompts with session context

**Bootstrap** (`src/0_infrastructure/bootstrap.mjs`)
- [x] createFitnessServices - Creates SessionService, ZoneLedController, TranscriptionService
- [x] createFitnessApiRouter - Wires services to Express router

**API Router** (already complete from Phase 3a)
- [x] GET /api/fitness - Config (hydrated)
- [x] GET/POST /api/fitness/sessions/* - Session CRUD
- [x] POST /api/fitness/save_screenshot - Screenshot capture
- [x] POST /api/fitness/voice_memo - Voice memo transcription
- [x] POST /api/fitness/zone_led - Ambient LED sync
- [x] GET /api/fitness/zone_led/* - Status and metrics

**Key Pattern:**
- WebSocket HR data handled by existing EventBus/WebSocketAdapter (no fitness-specific changes needed)
- Zone LED sync is HTTP-based with throttling/rate limiting
- VoiceMemoTranscriptionService uses Whisper + GPT-4o cleanup pipeline

### Phase 4d: Finance Application ✅

**Domain Services** (`src/1_domains/finance/services/`)
- [x] TransactionClassifier - Classifies transactions into buckets (income, day-to-day, monthly, short-term, transfer)
- [x] MortgageCalculator - Payment plans, payoff projections, amortization with UTC date handling

**Application Services** (`src/3_applications/finance/`)
- [x] BudgetCompilationService - Full budget compilation with monthly/daily breakdowns, surplus allocation
- [x] FinanceHarvestService - Data refresh orchestration from Buxfer with optional categorization
- [x] TransactionCategorizationService - AI-powered transaction categorization via IAIGateway

**Adapters** (`src/2_adapters/persistence/yaml/`)
- [x] YamlFinanceStore - YAML file persistence for budget config, transactions, balances, memos, compiled finances

**Bootstrap** (`src/0_infrastructure/bootstrap.mjs`)
- [x] createFinanceServices - Creates YamlFinanceStore, BuxferAdapter, application services
- [x] createFinanceApiRouter - Wires services to Express router

**Legacy Shims** (in `backend/_legacy/index.js`)
- [x] GET /data/budget → redirects to /api/finance/data
- [x] GET /data/budget/daytoday → redirects to /api/finance/data/daytoday
- [x] GET/POST /harvest/budget → redirects to /api/finance/refresh

**Tests** - 14 test files covering all layers:
- Domain entities: Budget, Transaction, Account, Mortgage
- Domain services: TransactionClassifier, MortgageCalculator, BudgetService, MortgageService
- Adapters: YamlFinanceStore, BuxferAdapter
- Application services: BudgetCompilationService, FinanceHarvestService, TransactionCategorizationService
- API router: finance.test.mjs with all 15 endpoints

---

## Next Priority: API Layer (Phase 5)

All applications complete. Focus now on:

1. **Server Entry Point (5a)** - Create `src/server.mjs` to replace `_legacy/index.js`
2. **Router Migration (5b)** - Remaining routers (health, lifelog, home, cron, harvest)
3. **Webhook Server (5c)** - Separate webhook app on port 3119
4. **Legacy Shims (5d)** - Add shims for remaining legacy endpoints

---

## File Counts

```
backend/_legacy/     322 files (to be migrated)
backend/src/         190+ files (migrated)
├── 0_infrastructure/ 35 files (logging, config, eventbus, scheduling, bootstrap)
├── 1_domains/        48 files (content, fitness, finance, messaging, nutrition, journaling, ai, journalist)
├── 2_adapters/       45 files (content, fitness, finance, messaging, ai, persistence)
├── 3_applications/   60 files (nutribot, journalist, finance)
└── 4_api/            32 files (routers, handlers, middleware, shims)
```

---

## Test Files Still Importing from _legacy

These test legacy code as "golden masters" - expected during migration:

1. `tests/unit/config/ConfigService.test.mjs`
2. `tests/unit/fitness/fitsync-auth.unit.test.mjs`
3. `tests/unit/services/mediaMemory.unit.test.mjs`
4. `tests/unit/gateways/GoogleImageSearchGateway.unit.test.mjs`
5. `tests/assembly/config-service.assembly.test.mjs`
6. `tests/assembly/io.assembly.test.mjs`
7. `tests/assembly/bootstrap-yaml.assembly.test.mjs`
8. `tests/assembly/fitness-session-v3.assembly.test.mjs`
9. `tests/integration/api/plex.api.test.mjs`
10. `tests/integration/api/proxy.test.mjs`
11. `tests/integration/chatbots/journalist/JournalistApp.test.mjs`

---

## Success Criteria

Migration complete when:
- [ ] `backend/_legacy/` deleted
- [ ] All endpoints served from `backend/src/`
- [ ] No imports from `_legacy` in production code
- [x] All tests passing (1134+)
- [ ] Frontend fully migrated
- [ ] Legacy route hit counts at 0
