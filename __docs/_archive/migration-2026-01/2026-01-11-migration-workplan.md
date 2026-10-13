# Backend Migration Workplan: AS-IS → TO-BE

**Created:** 2026-01-11
**Last Updated:** 2026-01-11 (Evening)
**Status:** ACTIVE - Phase 4 Complete, Phase 5 In Progress
**Goal:** Migrate all 322 legacy files from `__backend/_legacy/` to `__backend/src/` DDD architecture

---

## Executive Summary

| Metric | AS-IS | Current | TO-BE | Progress |
|--------|-------|---------|-------|----------|
| Legacy files | 322 | 322 | 0 | 🔄 Shims in place |
| New src/ files | 72 | 190+ | ~220 | ✅ 86% |
| Test coverage | 903 | 1134 | ~1200 | ✅ 94% |
| Domains implemented | 1 | 8 | 8 | ✅ 100% |
| Adapters implemented | 6 | 45+ | ~50 | ✅ 90% |
| Applications implemented | 0 | 4 | 4 | ✅ 100% |

---

## AS-IS State (Current)

### Legacy Structure (`__backend/_legacy/` - 322 files)

```
__backend/_legacy/
├── index.js                    # Main entry point (1 file)
├── api.mjs                     # Webhook server (1 file)
├── routers/                    # Express routers (15 files)
│   ├── fitness.mjs             # 1008 lines - COMPLEX
│   ├── media.mjs               # Plex/content endpoints
│   ├── fetch.mjs               # YAML data serving
│   ├── websocket.mjs           # WebSocket pub/sub
│   ├── health.mjs              # Health metrics
│   ├── lifelog.mjs             # Activity logging
│   ├── harvest.mjs             # Data harvesting
│   ├── home.mjs                # Home automation
│   ├── cron.mjs                # Scheduled jobs
│   ├── journalist.mjs          # Journalist bot routes
│   ├── gratitude.mjs           # Gratitude journaling
│   ├── plexProxy.mjs           # Plex streaming proxy
│   ├── printer.mjs             # Thermal printing
│   ├── tts.mjs                 # Text-to-speech
│   └── exe.mjs                 # Command execution
├── lib/                        # Shared libraries (43 files)
│   ├── config/                 # Configuration (12 files)
│   ├── logging/                # Logging system (9 files)
│   ├── ai/                     # AI utilities (5 files)
│   ├── budgetlib/              # Budget calculations (3 files)
│   ├── fitness/                # Fitness utilities (2 files)
│   ├── lifelog-extractors/     # Data extractors (17 files)
│   └── *.mjs                   # API clients & utilities (43 files)
├── chatbots/                   # Chatbot framework (193 files)
│   ├── bots/nutribot/          # Food logging bot (116 files)
│   ├── bots/journalist/        # Journal bot
│   ├── domain/                 # Shared domain (9 files)
│   ├── application/            # Shared application (9 files)
│   ├── infrastructure/         # Shared infra (16 files)
│   ├── adapters/               # Shared adapters (11 files)
│   └── _lib/                   # Shared utilities (32 files)
├── jobs/                       # Background jobs (3 files)
│   ├── finance/budget.mjs
│   ├── finance/payroll.mjs
│   └── weight.mjs
└── scripts/                    # Utility scripts (3 files)
```

### New Structure (`__backend/src/` - 190+ files, mostly complete)

```
__backend/src/
├── 0_infrastructure/           # ✅ COMPLETE (35 files)
│   ├── bootstrap.mjs           # Factory functions for all domains
│   ├── config/                 # ConfigService
│   ├── eventbus/               # EventBus + WS/MQTT adapters
│   ├── logging/                # Dispatcher + transports
│   └── scheduling/             # TaskRegistry
├── 1_domains/                  # ✅ COMPLETE (48 files)
│   ├── content/                # ✅ COMPLETE - Item, WatchState, Registry
│   ├── fitness/                # ✅ COMPLETE - Session, Zone, Participant, services
│   ├── finance/                # ✅ COMPLETE - Budget, Transaction, Account, Mortgage, services
│   ├── messaging/              # ✅ COMPLETE - Message, Conversation, Notification, services
│   ├── nutrition/              # ✅ COMPLETE - FoodLog, NutritionEntry, services
│   ├── journaling/             # ✅ COMPLETE - JournalEntry, services
│   ├── ai/                     # ✅ COMPLETE - IAIGateway port
│   └── journalist/             # ✅ COMPLETE - Entities, value objects, services
├── 2_adapters/                 # ✅ COMPLETE (45 files)
│   ├── content/                # ✅ Plex, Folder, LocalContent, Filesystem
│   ├── persistence/yaml/       # ✅ Session, Finance, WatchState, FoodLog stores
│   ├── ai/                     # ✅ OpenAI, Anthropic adapters
│   ├── finance/                # ✅ BuxferAdapter
│   ├── fitness/                # ✅ AmbientLed, VoiceMemo, HomeAssistant
│   ├── messaging/              # ✅ TelegramAdapter
│   └── journalist/             # ✅ Lifelog, Debrief, LoggingAI adapters
├── 3_applications/             # ✅ COMPLETE (60 files)
│   ├── nutribot/               # ✅ 24 use cases, container, handlers
│   ├── journalist/             # ✅ 21 use cases, container, ports
│   └── finance/                # ✅ Compilation, Harvest, Categorization services
└── 4_api/                      # 🔄 MOSTLY COMPLETE (32 files)
    ├── routers/                # ✅ 10+ routers (content, fitness, finance, list, play, etc.)
    ├── handlers/               # ✅ nutribot, journalist handlers
    └── middleware/             # ✅ Legacy shims for content + finance
```

---

## TO-BE State (Target)

### Final Structure

```
__backend/src/
├── 0_infrastructure/           # 35 files
│   ├── bootstrap.mjs           # App initialization
│   ├── registry.mjs            # AdapterRegistry
│   ├── config/                 # ConfigService (keep)
│   ├── eventbus/               # EventBus + WS/MQTT adapters (keep)
│   ├── logging/                # Logging system (keep)
│   └── scheduling/             # TaskRegistry + CronRunner
├── 1_domains/                  # 60 files
│   ├── content/                # Content browsing & playback
│   ├── fitness/                # Sessions, zones, equipment
│   ├── finance/                # Budgets, transactions, mortgages
│   ├── messaging/              # Conversations, notifications
│   ├── nutrition/              # Food logs, meals
│   ├── journaling/             # Journal entries
│   ├── lifelog/                # Activity aggregation
│   └── core/                   # Shared value objects
├── 2_adapters/                 # 55 files
│   ├── content/                # Plex, Folder, LocalContent (keep)
│   ├── persistence/            # YAML stores for each domain
│   ├── ai/                     # OpenAI, Whisper
│   ├── finance/                # Buxfer
│   ├── fitness/                # Garmin, Strava
│   ├── home-automation/        # HomeAssistant
│   ├── messaging/              # Telegram
│   ├── calendar/               # Google Calendar
│   ├── email/                  # Gmail
│   ├── social/                 # LastFM, Letterboxd, Goodreads, etc.
│   └── external/               # Weather, Reddit, etc.
├── 3_applications/             # 25 files
│   ├── nutribot/               # Food logging chatbot
│   ├── journalist/             # Journal chatbot
│   ├── fitness/                # Fitness session orchestration
│   └── finance/                # Budget sync jobs
└── 4_api/                      # 20 files
    ├── routers/                # All HTTP endpoints
    ├── middleware/             # Auth, logging, legacy shims
    └── webhook-server.mjs      # Separate webhook app
```

---

## Migration Phases

### Phase 1: Infrastructure ✅ COMPLETE
Already done. No work needed.

---

### Phase 2: Fitness Domain (Priority: HIGH)

**Why first:** Most complex router (1008 lines), actively used, good test of architecture.

#### 2.1 Domain Entities (`1_domains/fitness/entities/`)

| File | Source | Lines | Status |
|------|--------|-------|--------|
| `Session.mjs` | `routers/fitness.mjs:127-203` | ~80 | Shell exists |
| `Participant.mjs` | `routers/fitness.mjs:189-200` | ~30 | Shell exists |
| `Zone.mjs` | `routers/fitness.mjs:632-717` | ~50 | Shell exists |
| `Equipment.mjs` | NEW | ~40 | Not started |
| `VoiceMemo.mjs` | `routers/fitness.mjs:579-587` | ~30 | Not started |
| `Snapshot.mjs` | `routers/fitness.mjs:456-482` | ~40 | Not started |

**Tasks:**
```
[ ] 2.1.1 Implement Session entity with full properties
      - sessionId, startTime, endTime, durationMs, timezone
      - roster: Participant[], timeline: {series, events}
      - snapshots: {captures: Snapshot[]}

[ ] 2.1.2 Implement Participant entity
      - name, hrDeviceId, isGuest, isPrimary

[ ] 2.1.3 Implement Zone entity with priority logic
      - ZONE_PRIORITY: {cool:0, active:1, warm:2, hot:3, fire:4}
      - ZONE_ORDER: ['cool','active','warm','hot','fire']
      - normalizeZoneId(), getHighestZone()

[ ] 2.1.4 Implement Equipment entity
      - type: 'bike'|'jumprope'|'elliptical'
      - sensorConfig, calibration

[ ] 2.1.5 Implement VoiceMemo entity
      - sessionId, transcriptRaw, transcriptClean
      - startedAt, endedAt, durationSeconds

[ ] 2.1.6 Implement Snapshot entity
      - index, filename, path, timestamp, size
```

#### 2.2 Domain Services (`1_domains/fitness/services/`)

| File | Source | Lines | Status |
|------|--------|-------|--------|
| `SessionService.mjs` | `routers/fitness.mjs` | ~200 | Shell exists |
| `ZoneService.mjs` | `routers/fitness.mjs:632-717` | ~100 | Shell exists |
| `TimelineService.mjs` | `routers/fitness.mjs:64-125` | ~80 | Not started |

**Tasks:**
```
[ ] 2.2.1 Implement SessionService
      - listDates(householdId): string[]
      - listByDate(date, householdId): SessionSummary[]
      - getById(sessionId, householdId): Session
      - save(session): void
      - Uses ISessionStore port

[ ] 2.2.2 Implement ZoneService
      - resolveTargetScene(zones, sessionEnded, sceneConfig): string
      - getHighestActiveZone(zones): Zone
      - Uses IZoneLedController port

[ ] 2.2.3 Implement TimelineService
      - decodeSeries(encoded): {[key]: number[]}
      - encodeSeries(raw): {[key]: string}
      - parseToUnixMs(value, timezone): number
```

#### 2.3 Domain Ports (`1_domains/fitness/ports/`)

| File | Purpose | Status |
|------|---------|--------|
| `ISessionStore.mjs` | YAML persistence | Shell exists |
| `IZoneLedController.mjs` | HomeAssistant scenes | Not started |
| `IVoiceMemoTranscriber.mjs` | Whisper transcription | Not started |
| `IEquipmentSensor.mjs` | MQTT vibration data | Not started |

**Tasks:**
```
[ ] 2.3.1 Define ISessionStore interface
      - listDates(): string[]
      - listByDate(date): SessionSummary[]
      - load(sessionId): Session|null
      - save(session): void
      - saveSnapshot(sessionId, snapshot): void

[ ] 2.3.2 Define IZoneLedController interface
      - activateScene(sceneName): Promise<{ok, error?}>
      - getStatus(): {enabled, lastScene, failureCount}

[ ] 2.3.3 Define IVoiceMemoTranscriber interface
      - transcribe(audioBuffer, context): Promise<{raw, clean}>

[ ] 2.3.4 Define IEquipmentSensor interface
      - subscribe(equipmentId, handler): unsubscribe
      - getLatestReading(equipmentId): SensorReading
```

#### 2.4 Fitness Adapters (`2_adapters/fitness/`)

| File | Implements | Source |
|------|------------|--------|
| `YamlSessionStore.mjs` | ISessionStore | `routers/fitness.mjs:127-236` |
| `HomeAssistantZoneLed.mjs` | IZoneLedController | `routers/fitness.mjs:724-885` |
| `WhisperTranscriber.mjs` | IVoiceMemoTranscriber | `routers/fitness.mjs:494-595` |
| `MqttEquipmentSensor.mjs` | IEquipmentSensor | `lib/mqtt.mjs` |

**Tasks:**
```
[ ] 2.4.1 Implement YamlSessionStore
      - Path: households/{hid}/apps/fitness/sessions/{date}/{id}.yml
      - Uses io.mjs loadFile/saveFile
      - Handles v2↔v3 format conversion

[ ] 2.4.2 Implement HomeAssistantZoneLed
      - Rate limiting (throttleMs from config)
      - Circuit breaker (maxFailures, backoff)
      - Metrics tracking
      - Uses lib/homeassistant.mjs activateScene

[ ] 2.4.3 Implement WhisperTranscriber
      - OpenAI Whisper API
      - GPT-4 cleanup pass
      - Context building from session

[ ] 2.4.4 Implement MqttEquipmentSensor
      - Subscribe to vibration topics
      - Decode sensor payloads
      - Broadcast via EventBus
```

#### 2.5 Fitness API Router (`4_api/routers/fitness.mjs`)

**Tasks:**
```
[ ] 2.5.1 Create new fitness router
      - GET /                   → config (hydrated)
      - GET /sessions/dates     → list dates
      - GET /sessions           → list by date
      - GET /sessions/:id       → session detail
      - POST /save_session      → save session
      - POST /save_screenshot   → save screenshot
      - POST /voice_memo        → transcribe memo
      - POST /zone_led          → sync LED scene
      - GET /zone_led/status    → LED status
      - GET /zone_led/metrics   → LED metrics
      - POST /zone_led/reset    → reset circuit breaker

[ ] 2.5.2 Mount in index.js
      - import { createFitnessRouter } from '../src/4_api/routers/fitness.mjs'
      - app.use('/api/fitness', createFitnessRouter({ registry }))

[ ] 2.5.3 Create legacy shim (if needed for frontend compat)
```

#### 2.6 Fitness Tests

**Tasks:**
```
[ ] 2.6.1 Unit tests for entities
      - Session validation, serialization
      - Zone priority ordering
      - Timeline encoding/decoding

[ ] 2.6.2 Unit tests for services
      - SessionService CRUD operations
      - ZoneService scene resolution

[ ] 2.6.3 Unit tests for adapters
      - YamlSessionStore file operations
      - HomeAssistantZoneLed rate limiting

[ ] 2.6.4 Integration tests for API
      - Full session lifecycle
      - Screenshot capture
      - Voice memo transcription

[ ] 2.6.5 Golden master tests
      - Compare new vs legacy responses
```

---

### Phase 3: External API Adapters (Priority: MEDIUM)

These are the 19+ API clients in `lib/` that need migration.

#### 3.1 Fitness-Related APIs

| Legacy File | New Location | Priority |
|-------------|--------------|----------|
| `garmin.mjs` | `2_adapters/fitness/garmin/` | HIGH |
| `strava.mjs` | `2_adapters/fitness/strava/` | HIGH |
| `fitsync.mjs` | `2_adapters/fitness/fitsync/` | HIGH |
| `withings.mjs` | `2_adapters/health/withings/` | MEDIUM |
| `health.mjs` | `1_domains/fitness/services/` | MEDIUM |

**Tasks:**
```
[ ] 3.1.1 Migrate GarminAdapter
      - OAuth token refresh
      - Activity fetching
      - Sleep data sync

[ ] 3.1.2 Migrate StravaAdapter
      - OAuth flow
      - Activity sync
      - Segment efforts

[ ] 3.1.3 Migrate WithingsAdapter
      - Weight measurements
      - Blood pressure
```

#### 3.2 Finance APIs

| Legacy File | New Location | Priority |
|-------------|--------------|----------|
| `buxfer.mjs` | `2_adapters/finance/buxfer/` | HIGH |
| `budget.mjs` | `1_domains/finance/services/` | HIGH |
| `budgetlib/` | `1_domains/finance/services/` | HIGH |

**Tasks:**
```
[ ] 3.2.1 Migrate BuxferAdapter
      - Transaction fetching
      - Account balances
      - Category mapping

[ ] 3.2.2 Migrate BudgetService logic
      - Budget calculations
      - Spending analysis
```

#### 3.3 Social/Lifelog APIs

| Legacy File | New Location | Priority |
|-------------|--------------|----------|
| `lastfm.mjs` | `2_adapters/social/lastfm/` | LOW |
| `letterboxd.mjs` | `2_adapters/social/letterboxd/` | LOW |
| `goodreads.mjs` | `2_adapters/social/goodreads/` | LOW |
| `github.mjs` | `2_adapters/social/github/` | LOW |
| `reddit.mjs` | `2_adapters/social/reddit/` | LOW |
| `foursquare.mjs` | `2_adapters/social/foursquare/` | LOW |

**Tasks:**
```
[ ] 3.3.x Migrate each social adapter
      - Standardize interface: fetch(since: Date): Activity[]
      - Error handling
      - Rate limiting
```

#### 3.4 Productivity APIs

| Legacy File | New Location | Priority |
|-------------|--------------|----------|
| `gcal.mjs` | `2_adapters/calendar/google/` | MEDIUM |
| `gmail.mjs` | `2_adapters/email/gmail/` | MEDIUM |
| `todoist.mjs` | `2_adapters/tasks/todoist/` | LOW |
| `clickup.mjs` | `2_adapters/tasks/clickup/` | LOW |

#### 3.5 Other APIs

| Legacy File | New Location | Priority |
|-------------|--------------|----------|
| `weather.mjs` | `2_adapters/external/weather/` | LOW |
| `homeassistant.mjs` | `2_adapters/home-automation/ha/` | HIGH |
| `plex.mjs` | Already in content adapters | DONE |
| `youtube.mjs` | `2_adapters/external/youtube/` | LOW |

---

### Phase 4: Chatbots Application (Priority: HIGH)

The chatbots are the largest subsystem (193 files). They already have DDD structure internally.

#### 4.1 Shared Infrastructure

| Legacy Location | New Location |
|-----------------|--------------|
| `chatbots/infrastructure/messaging/` | `2_adapters/messaging/telegram/` |
| `chatbots/infrastructure/ai/` | `2_adapters/ai/openai/` |
| `chatbots/infrastructure/gateways/` | `2_adapters/external/` |
| `chatbots/domain/` | `1_domains/messaging/` |
| `chatbots/application/` | Merge into bot apps |

**Tasks:**
```
[ ] 4.1.1 Migrate TelegramGateway
      - Message sending/receiving
      - Webhook handling
      - File uploads

[ ] 4.1.2 Migrate OpenAIGateway
      - Chat completions
      - Image analysis
      - Embeddings

[ ] 4.1.3 Migrate GoogleImageSearchGateway
      - Image search
      - Result parsing

[ ] 4.1.4 Migrate shared domain entities
      - Conversation
      - ConversationState
```

#### 4.2 Nutribot Application

| Component | Files | Notes |
|-----------|-------|-------|
| `bots/nutribot/domain/` | 8 files | FoodItem, NutritionFacts |
| `bots/nutribot/application/` | 12 files | Use cases, ports |
| `bots/nutribot/adapters/` | 6 files | Storage, AI |
| `bots/nutribot/handlers/` | 5 files | Telegram handlers |
| `bots/nutribot/container.mjs` | 1 file | DI container |

**Tasks:**
```
[ ] 4.2.1 Move nutribot to 3_applications/nutribot/
      - Preserve internal structure
      - Update imports to use new adapters

[ ] 4.2.2 Integrate with AdapterRegistry
      - Receive TelegramGateway from registry
      - Receive OpenAIGateway from registry
      - Receive FoodLogStore from registry

[ ] 4.2.3 Create NutribotApp orchestrator
      - Initialize handlers
      - Wire up dependencies
      - Expose start/stop methods

[ ] 4.2.4 Mount webhook routes
      - POST /api/foodlog/webhook
```

#### 4.3 Journalist Application

Similar structure to Nutribot.

**Tasks:**
```
[ ] 4.3.1 Move journalist to 3_applications/journalist/
[ ] 4.3.2 Integrate with AdapterRegistry
[ ] 4.3.3 Create JournalistApp orchestrator
[ ] 4.3.4 Mount webhook routes
```

---

### Phase 5: Remaining Routers (Priority: MEDIUM)

#### 5.1 Data/Fetch Router

| Endpoint | Action |
|----------|--------|
| `GET /data/*` | Serve YAML files |

**Tasks:**
```
[ ] 5.1.1 Create DataRouter in 4_api/routers/data.mjs
[ ] 5.1.2 Move YAML serving logic from fetch.mjs
[ ] 5.1.3 Add caching headers
```

#### 5.2 Health Router

| Endpoint | Action |
|----------|--------|
| `GET /api/health/weight` | Weight history |
| `GET /api/health/bp` | Blood pressure |

**Tasks:**
```
[ ] 5.2.1 Create HealthRouter in 4_api/routers/health.mjs
[ ] 5.2.2 Migrate from legacy health.mjs
```

#### 5.3 Lifelog Router

| Endpoint | Action |
|----------|--------|
| `GET /api/lifelog/*` | Activity aggregation |

**Tasks:**
```
[ ] 5.3.1 Create LifelogRouter
[ ] 5.3.2 Migrate lifelog-extractors/
```

#### 5.4 Home Router

| Endpoint | Action |
|----------|--------|
| `GET /home/*` | Home automation |

**Tasks:**
```
[ ] 5.4.1 Create HomeRouter
[ ] 5.4.2 Integrate HomeAssistant adapter
```

#### 5.5 Utility Routers

```
[ ] 5.5.1 Migrate cron.mjs → 4_api/routers/admin/cron.mjs
[ ] 5.5.2 Migrate harvest.mjs → 4_api/routers/admin/harvest.mjs
[ ] 5.5.3 Migrate printer.mjs → 4_api/routers/printer.mjs
[ ] 5.5.4 Migrate tts.mjs → 4_api/routers/tts.mjs
```

---

### Phase 6: Server Entry Point (Priority: HIGH)

#### 6.1 New Server Entry

**Tasks:**
```
[ ] 6.1.1 Create src/server.mjs
      - Initialize logging
      - Create AdapterRegistry
      - Initialize EventBus
      - Create Express app
      - Mount all routers
      - Start HTTP server
      - Start webhook server (port 3119)
      - Initialize scheduler

[ ] 6.1.2 Create src/0_infrastructure/registry.mjs
      - AdapterRegistry factory
      - Lazy adapter initialization
      - Dependency injection container

[ ] 6.1.3 Update package.json scripts
      - "start": "node __backend/src/server.mjs"
      - "start:legacy": "node __backend/_legacy/index.js"
```

---

### Phase 7: Cleanup (Priority: LOW)

**Tasks:**
```
[ ] 7.1 Add deprecation logging to legacy routes
[ ] 7.2 Monitor legacy route hit counts
[ ] 7.3 Update frontend to use new endpoints (where needed)
[ ] 7.4 Remove legacy shims when no longer used
[ ] 7.5 Delete __backend/_legacy/ folder
[ ] 7.6 Update all documentation
[ ] 7.7 Archive this workplan to __docs/_archive/
```

---

## Task Tracking

### Completed (as of 2026-01-12)

1. **[x] Fitness Domain** - All entities, services, adapters, API router complete
2. **[x] Finance Domain** - All entities, services, adapters, API router complete
3. **[x] Messaging Domain** - Entities, services, adapters complete
4. **[x] Nutrition/Journaling Domain** - Entities, services, adapters complete
5. **[x] AI Adapters** - OpenAI and Anthropic adapters complete
6. **[x] Nutribot Application** - All 24 use cases migrated
7. **[x] Journalist Application** - All 21 use cases migrated
8. **[x] Finance Application** - BudgetCompilationService, HarvestService, CategorizationService complete
9. **[x] Content Domain** - All 7 phases complete with legacy shims
10. **[x] Finance Legacy Shims** - /data/budget, /harvest/budget redirects complete
11. **[x] External API Harvesters (Phase 3f)** - ALL 16 harvesters migrated:
    - Fitness: Garmin, Strava, Withings
    - Productivity: Todoist, ClickUp, GitHub
    - Social: Lastfm, Reddit, Letterboxd, Goodreads, Foursquare
    - Communication: Gmail, GCal
    - Finance: Shopping (personal purchase history)
    - Other: Weather, Scripture

### Immediate Next Actions

1. **[ ] Create server.mjs** - `src/server.mjs` to replace `_legacy/index.js`
2. **[ ] Migrate health router** - `4_api/routers/health.mjs`
3. **[ ] Migrate lifelog router** - `4_api/routers/lifelog.mjs`
4. **[ ] Migrate home router** - `4_api/routers/home.mjs`
5. **[ ] Migrate cron router** - `4_api/routers/admin/cron.mjs`

### Definition of Done (per component)

- [x] Entity/Service/Adapter code written
- [x] Unit tests passing
- [x] Integration tests passing
- [ ] Golden master comparison passes (legacy parity)
- [x] Mounted in index.js
- [x] Documentation updated

---

## Effort Estimates

| Phase | Components | Estimated Files | Status |
|-------|------------|-----------------|--------|
| 2. Fitness Domain | 15 | 25 | ✅ COMPLETE |
| 2. Finance Domain | 12 | 20 | ✅ COMPLETE |
| 3. External APIs | 16 | 30 | ✅ COMPLETE |
| 4. Chatbots | 2 apps | 40 | ✅ COMPLETE |
| 4. Finance App | 4 | 8 | ✅ COMPLETE |
| 5. Remaining Routers | 8 | 15 | 🔄 IN PROGRESS |
| 6. Server Entry | 3 | 5 | ⬜ NOT STARTED |
| 7. Cleanup | - | - | ⬜ BLOCKED |

---

## Success Metrics

| Metric | Current | Target | Status |
|--------|---------|--------|--------|
| Legacy files | 322 | 0 | 🔄 In Progress |
| Test coverage | 1134 | 1200+ | ✅ 94% |
| src/ files | 190+ | ~220 | 🔄 86% |
| API response parity | N/A | 100% | 🔄 Testing |
| Legacy route hits | N/A | 0 | ⬜ Not tracked |
| Build time | - | <30s | ✅ OK |
| Startup time | - | <5s | ✅ OK |
