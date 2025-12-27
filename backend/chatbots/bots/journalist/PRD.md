# Journalist Bot 2.0 - Product Requirements Document

## Document Information
- **Version:** 2.0
- **Date:** December 26, 2025
- **Status:** Draft
- **Author:** System Design

---

## Executive Summary

This document outlines a complete overhaul of the Journalist bot, transforming it from a reactive journaling companion into a proactive **Lifelog-Aware Journaling System**. The new system will leverage automatically-captured life data (calendar events, fitness activities, emails, media consumption, location check-ins, etc.) to generate contextual morning summaries and intelligent follow-up questions that help users document their lives more completely and effortlessly.

---

## Part 1: AS-IS System Analysis

### 1.1 Current Architecture Overview

The existing Journalist bot follows a clean hexagonal architecture pattern:

```
journalist/
├── container.mjs          # Dependency Injection Container
├── server.mjs             # Express Router
├── index.mjs              # Barrel exports
├── workplan.md            # Migration documentation
├── adapters/
│   └── JournalistInputRouter.mjs   # Routes IInputEvents → Use Cases
├── application/
│   ├── ports/             # Repository interfaces
│   └── usecases/          # Business logic
├── domain/
│   ├── entities/          # JournalEntry, ConversationMessage, MessageQueue
│   ├── services/          # PromptBuilder, QueueManager, HistoryFormatter
│   └── value-objects/     # EntrySource, PromptType, QuizCategory
└── handlers/
    ├── journal.mjs        # Journal export endpoint
    └── trigger.mjs        # HTTP trigger for prompts
```

### 1.2 Current Use Cases

| Use Case | File | Description |
|----------|------|-------------|
| `ProcessTextEntry` | ProcessTextEntry.mjs | Core journaling flow - saves user text, generates AI follow-up questions |
| `ProcessVoiceEntry` | ProcessVoiceEntry.mjs | Transcribes voice → delegates to ProcessTextEntry |
| `InitiateJournalPrompt` | InitiateJournalPrompt.mjs | Starts journaling session with opening question |
| `HandleCallbackResponse` | HandleCallbackResponse.mjs | Processes inline button selections |
| `GenerateMultipleChoices` | GenerateMultipleChoices.mjs | AI-generates response options for questions |
| `HandleSlashCommand` | HandleSlashCommand.mjs | Routes `/journal`, `/quiz`, `/analyze` commands |
| `HandleSpecialStart` | HandleSpecialStart.mjs | Handles 🎲 (change subject) and ❌ (cancel) |
| `SendQuizQuestion` | SendQuizQuestion.mjs | Delivers quiz questions with inline buttons |
| `HandleQuizAnswer` | HandleQuizAnswer.mjs | Records quiz responses |
| `RecordQuizAnswer` | RecordQuizAnswer.mjs | Persists quiz answers |
| `AdvanceToNextQuizQuestion` | AdvanceToNextQuizQuestion.mjs | Progresses through quiz queue |
| `GenerateTherapistAnalysis` | GenerateTherapistAnalysis.mjs | AI-generated emotional analysis of entries |
| `ReviewJournalEntries` | ReviewJournalEntries.mjs | Retrieves journal history |
| `ExportJournalMarkdown` | ExportJournalMarkdown.mjs | Exports entries as markdown |

### 1.3 Current Domain Services

| Service | Purpose |
|---------|---------|
| **PromptBuilder** | Constructs AI prompts: `buildBiographerPrompt`, `buildAutobiographerPrompt`, `buildTherapistPrompt`, `buildMultipleChoicePrompt` |
| **QueueManager** | Manages question queue: `shouldContinueQueue`, `getNextUnsent`, `formatQuestion`, `buildDefaultChoices` |
| **HistoryFormatter** | Formats conversation history: `formatAsChat`, `truncateToLength`, `buildChatContext` |
| **QuestionParser** | Parses AI responses: `parseGPTResponse`, `splitMultipleQuestions` |

### 1.4 Current Flow

```
User sends message
    → TelegramInputAdapter.parse() → IInputEvent
    → JournalistInputRouter.route(event)
    → ProcessTextEntry.execute()
        → Save message to repository
        → Load conversation history
        → Check for existing question queue
        → If queue exists: evaluate if user answered → continue or clear
        → Generate follow-up questions via AI
        → Generate multiple-choice options via AI
        → Send formatted question with inline buttons
```

### 1.5 Current Limitations

1. **Reactive Only**: Bot only responds when user initiates contact
2. **No Context Awareness**: Unaware of user's calendar, activities, location, etc.
3. **No Daily Structure**: No morning briefing or daily review concept
4. **Generic Questions**: AI generates questions without external context
5. **No Lifelog Integration**: Doesn't leverage existing harvester infrastructure
6. **Limited Quiz Categories**: Static quiz system without dynamic content
7. **No Multi-User Support**: Single-user design patterns

---

## Part 2: TO-BE Vision

### 2.1 Core Concept: The Morning Debrief

Every morning, Journalist will:

1. **Aggregate Yesterday's Lifelog Data** from all connected sources
2. **Generate a Summary Report** of captured activities
3. **Present an Interactive Briefing** via Telegram
4. **Offer Contextual Follow-up Categories** based on what was tracked
5. **Enable Easy Response** via voice, text, or button selection

### 2.2 Target Data Sources

| Source | Data Type | Harvest Endpoint | Storage Location |
|--------|-----------|------------------|------------------|
| **Google Calendar** | Events, meetings, appointments | `/harvest/gcal` | `lifelog/events.yml` |
| **Gmail** | Sent emails, important threads | `/harvest/gmail` | `lifelog/gmail.yml` |
| **Garmin** | Steps, heart rate, sleep, stress | `/harvest/garmin` | `lifelog/garmin.yml` |
| **Strava** | Workouts, routes, performance | `/harvest/strava` | `lifelog/strava.yml` |
| **Fitness Sync** | Aggregated activity data | `/harvest/fitness` | `lifelog/fitness.yml` |
| **Withings** | Weight, body composition | `/harvest/withings` | `lifelog/withings.yml` |
| **Last.fm** | Music listening history | `/harvest/lastfm` | `lifelog/lastfm.yml` |
| **Letterboxd** | Movies watched | `/harvest/letterboxd` | `lifelog/letterboxd.yml` |
| **Todoist** | Tasks completed | `/harvest/todoist` | `lifelog/todoist.yml` |
| **ClickUp** | Work tasks, projects | `/harvest/clickup` | `lifelog/clickup.yml` |
| **Plex** | TV/Movies consumed | *(new)* | `lifelog/plex.yml` |
| **Swarm/Foursquare** | Location check-ins | *(new)* | `lifelog/checkins.yml` |
| **Google Photos** | Photos taken (metadata) | *(new)* | `lifelog/photos.yml` |
| **Push Notifications** | Phone notification log | *(new)* | `lifelog/notifications.yml` |
| **Geolocation** | Timeline/significant places | *(new)* | `lifelog/locations.yml` |

### 2.3 User Experience Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    MORNING DEBRIEF (8:00 AM)                        │
├─────────────────────────────────────────────────────────────────────┤
│  📅 Yesterday: December 25, 2025                                    │
│                                                                     │
│  📆 CALENDAR                                                        │
│  • 10:00 Korean School (4 hrs)                                      │
│  • 15:00 Church (2 hrs)                                             │
│                                                                     │
│  🏃 FITNESS                                                         │
│  • 6,847 steps                                                      │
│  • Avg HR: 72 bpm                                                   │
│  • Sleep: 6h 23m                                                    │
│                                                                     │
│  🎵 MUSIC                                                           │
│  • 12 tracks played                                                 │
│  • Top: "Carol of the Bells"                                        │
│                                                                     │
│  📧 EMAIL                                                           │
│  • 3 emails sent                                                    │
│                                                                     │
│  ✅ TASKS                                                           │
│  • 2 Todoist tasks completed                                        │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  What would you like to talk about?                                 │
│                                                                     │
│  [📆 Events & People]  [🏃 Health & Fitness]  [💭 Thoughts]         │
│                                                                     │
│  [🎬 Media & Culture]  [✅ Work & Tasks]  [✍️ Free Write]           │
│                                                                     │
│  Or just start typing/speaking...                                   │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.4 Category-Based Follow-up Questions

When user selects a category, the system generates contextual questions:

**📆 Events & People** (based on calendar/checkins)
- "How was Korean School yesterday? Anything memorable happen?"
- "Church was from 3-5pm. What stood out from the service?"
- "I see you were at [location]. What brought you there?"

**🏃 Health & Fitness** (based on Garmin/Strava/Withings)
- "Your sleep was a bit short at 6 hours. Did anything keep you up?"
- "You hit 6,847 steps. Was that from the church activities or something else?"
- "Your resting heart rate was higher than usual. Stressful day?"

**🎬 Media & Culture** (based on Last.fm/Letterboxd/Plex)
- "You listened to a lot of Christmas music. Getting into the holiday spirit?"
- "Did you watch anything memorable last night?"

**✅ Work & Tasks** (based on Todoist/ClickUp/Gmail)
- "You completed 2 tasks yesterday. How's the [project name] coming along?"
- "I saw you emailed [recipient]. What was that about?"

---

## Part 3: Technical Design

### 3.1 New Architecture

```
journalist/
├── container.mjs              # Enhanced DI Container
├── server.mjs                 # Express Router (add /morning endpoint)
├── config.yaml                # Bot configuration
│
├── adapters/
│   ├── JournalistInputRouter.mjs
│   └── LifelogAggregator.mjs  # NEW: Fetches from harvest endpoints
│
├── application/
│   ├── ports/
│   │   ├── IJournalEntryRepository.mjs
│   │   ├── IMessageQueueRepository.mjs
│   │   ├── ILifelogRepository.mjs     # NEW
│   │   └── ISummaryGenerator.mjs      # NEW
│   │
│   └── usecases/
│       │── ProcessTextEntry.mjs
│       │── ProcessVoiceEntry.mjs
│       │── InitiateJournalPrompt.mjs
│       │── HandleCallbackResponse.mjs
│       │── GenerateMultipleChoices.mjs
│       │── HandleSlashCommand.mjs
│       │── HandleSpecialStart.mjs
│       │
│       │── # Morning Debrief Use Cases (NEW)
│       │── GenerateMorningDebrief.mjs
│       │── SendMorningReport.mjs
│       │── HandleCategorySelection.mjs
│       │── GenerateContextualQuestions.mjs
│       │
│       │── # Quiz Use Cases
│       │── SendQuizQuestion.mjs
│       │── HandleQuizAnswer.mjs
│       │
│       │── # Analysis Use Cases
│       │── GenerateTherapistAnalysis.mjs
│       │── ReviewJournalEntries.mjs
│       └── ExportJournalMarkdown.mjs
│
├── domain/
│   ├── entities/
│   │   ├── JournalEntry.mjs
│   │   ├── ConversationMessage.mjs
│   │   ├── MessageQueue.mjs
│   │   ├── DailyLifelog.mjs           # NEW
│   │   └── MorningDebrief.mjs         # NEW
│   │
│   ├── services/
│   │   ├── PromptBuilder.mjs          # Enhanced with lifelog prompts
│   │   ├── QueueManager.mjs
│   │   ├── HistoryFormatter.mjs
│   │   ├── QuestionParser.mjs
│   │   ├── LifelogSummarizer.mjs      # NEW
│   │   └── CategoryRouter.mjs         # NEW
│   │
│   └── value-objects/
│       ├── EntrySource.mjs
│       ├── PromptType.mjs
│       ├── DebriefCategory.mjs        # NEW
│       └── LifelogSource.mjs          # NEW
│
├── handlers/
│   ├── journal.mjs
│   ├── trigger.mjs
│   └── morning.mjs                    # NEW: HTTP endpoint for cron
│
└── infrastructure/
    ├── HarvestClient.mjs              # NEW: Calls harvest endpoints
    └── LifelogFileRepository.mjs      # NEW: Reads lifelog YAML files
```

### 3.2 New Domain Entities

#### DailyLifelog Entity
```javascript
/**
 * Aggregates all lifelog data for a single day
 */
class DailyLifelog {
  #date;           // YYYY-MM-DD
  #calendar;       // Array of events
  #fitness;        // Garmin/Strava data
  #health;         // Withings measurements
  #music;          // Last.fm scrobbles
  #media;          // Letterboxd/Plex
  #tasks;          // Todoist/ClickUp completions
  #emails;         // Gmail sent/received
  #locations;      // Check-ins/geolocation
  #photos;         // Photo metadata
  #notifications;  // Push notification log
}
```

#### MorningDebrief Entity
```javascript
/**
 * Structured morning report with categories
 */
class MorningDebrief {
  #date;
  #lifelog;                // DailyLifelog reference
  #summaryText;            // Generated summary
  #availableCategories;    // Categories with data
  #suggestedQuestions;     // Pre-generated per category
  #messageId;              // Telegram message ID
}
```

### 3.3 New Use Cases

#### GenerateMorningDebrief
```javascript
/**
 * Orchestrates morning debrief generation
 * 1. Fetch yesterday's lifelog data from all sources
 * 2. Aggregate into DailyLifelog entity
 * 3. Generate summary text via AI
 * 4. Identify categories with sufficient data
 * 5. Pre-generate 3 questions per category
 * 6. Return MorningDebrief entity
 */
```

#### SendMorningReport
```javascript
/**
 * Sends the morning debrief via Telegram
 * 1. Format MorningDebrief as message
 * 2. Build category reply keyboard
 * 3. Send to user's chat
 * 4. Store message ID for callback handling
 */
```

#### HandleCategorySelection
```javascript
/**
 * Handles category button press from morning debrief
 * 1. Identify selected category
 * 2. Retrieve pre-generated questions for category
 * 3. Send first question with inline options
 * 4. Queue remaining questions
 */
```

### 3.4 Enhanced PromptBuilder

New prompt functions needed:

```javascript
// Generate summary from lifelog data
buildDailySummaryPrompt(lifelog: DailyLifelog)

// Generate contextual questions for a category
buildContextualQuestionsPrompt(category: DebriefCategory, lifelog: DailyLifelog)

// Evaluate if user response addresses the question
buildResponseEvaluationPrompt(question: string, response: string, context: DailyLifelog)

// Generate follow-up based on lifelog context
buildContextualFollowUpPrompt(history: string, entry: string, lifelog: DailyLifelog)
```

### 3.5 Harvest Integration

New harvesters needed in [harvest.js](harvest.js):

| Harvester | Data Source | Priority |
|-----------|-------------|----------|
| `plex` | Plex Media Server | High |
| `swarm` | Swarm/Foursquare API | Medium |
| `photos` | Google Photos API | Medium |
| `notifications` | Phone notification export | Low |
| `locations` | Google Timeline / Overland | Low |

### 3.6 Cron Schedule

```yaml
# config/apps/journalist.yml
morning_debrief:
  enabled: true
  schedule: "0 8 * * *"   # 8:00 AM daily
  timezone: "America/Los_Angeles"
  
  # Data aggregation settings
  lookback_days: 1        # Yesterday only
  min_data_sources: 2     # Require at least 2 sources with data
  
  # Categories
  categories:
    events:
      sources: [calendar, checkins]
      icon: "📆"
      label: "Events & People"
    health:
      sources: [garmin, strava, withings]
      icon: "🏃"
      label: "Health & Fitness"
    media:
      sources: [lastfm, letterboxd, plex]
      icon: "🎬"
      label: "Media & Culture"
    tasks:
      sources: [todoist, clickup, gmail]
      icon: "✅"
      label: "Work & Tasks"
    thoughts:
      sources: []  # Always available
      icon: "💭"
      label: "Thoughts & Reflections"
    freewrite:
      sources: []  # Always available
      icon: "✍️"
      label: "Free Write"
```

### 3.7 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/journalist/webhook` | POST | Telegram webhook (existing) |
| `/journalist/journal` | GET | Export journal (existing) |
| `/journalist/trigger` | GET | Trigger prompt (existing) |
| `/journalist/morning` | GET | Trigger morning debrief (NEW) |
| `/journalist/morning?date=YYYY-MM-DD` | GET | Debrief for specific date (NEW) |

### 3.8 Telegram Reply Markup

Morning debrief uses **ReplyKeyboardMarkup** for category selection:

```javascript
{
  keyboard: [
    [{ text: '📆 Events & People' }, { text: '🏃 Health & Fitness' }],
    [{ text: '🎬 Media & Culture' }, { text: '✅ Work & Tasks' }],
    [{ text: '💭 Thoughts' }, { text: '✍️ Free Write' }]
  ],
  resize_keyboard: true,
  one_time_keyboard: true
}
```

Follow-up questions use **InlineKeyboardMarkup** for quick answers:

```javascript
{
  inline_keyboard: [
    [{ text: 'It was great!', callback_data: 'quick:great' }],
    [{ text: 'Nothing special', callback_data: 'quick:nothing' }],
    [{ text: 'Something happened...', callback_data: 'quick:elaborate' }],
    [{ text: '🎲 Different question', callback_data: 'journal:change' }],
    [{ text: '❌ Done for now', callback_data: 'journal:exit' }]
  ]
}
```

---

## Part 4: Implementation Roadmap

### Phase 1: Lifelog Aggregation Foundation (Week 1-2)
- [ ] Create `DailyLifelog` entity
- [ ] Create `LifelogFileRepository` infrastructure
- [ ] Create `LifelogAggregator` adapter
- [ ] Add `ILifelogRepository` port
- [ ] Unit tests for aggregation logic

### Phase 2: Morning Debrief Core (Week 2-3)
- [ ] Create `MorningDebrief` entity
- [ ] Implement `GenerateMorningDebrief` use case
- [ ] Add summary prompt to `PromptBuilder`
- [ ] Implement `SendMorningReport` use case
- [ ] Add `/morning` HTTP endpoint
- [ ] Add cron job configuration

### Phase 3: Category System (Week 3-4)
- [ ] Create `DebriefCategory` value object
- [ ] Create `CategoryRouter` domain service
- [ ] Implement `HandleCategorySelection` use case
- [ ] Implement `GenerateContextualQuestions` use case
- [ ] Update `JournalistInputRouter` for category callbacks

### Phase 4: Enhanced Journaling (Week 4-5)
- [ ] Enhance `ProcessTextEntry` with lifelog context
- [ ] Add contextual follow-up prompts
- [ ] Implement response evaluation with context
- [ ] Add seamless transition between debrief and freeform

### Phase 5: New Harvesters (Week 5-6)
- [ ] Implement Plex harvester
- [ ] Implement Swarm/Foursquare harvester
- [ ] Implement Google Photos harvester (metadata only)
- [ ] Add lifelog YAML persistence for new sources

### Phase 6: Polish & Testing (Week 6-7)
- [ ] End-to-end integration tests
- [ ] Error handling and edge cases
- [ ] Performance optimization
- [ ] Documentation updates
- [ ] User acceptance testing

---

## Part 5: Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CRON (8:00 AM)                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          /journalist/morning                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     GenerateMorningDebrief Use Case                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ LifelogFile  │  │ LifelogFile  │  │ LifelogFile  │  │ LifelogFile  │     │
│  │  Repository  │  │  Repository  │  │  Repository  │  │  Repository  │     │
│  │  (calendar)  │  │   (garmin)   │  │   (gmail)    │  │   (music)    │     │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘     │
│         │                 │                 │                 │             │
│         └─────────────────┴─────────────────┴─────────────────┘             │
│                                     │                                       │
│                                     ▼                                       │
│                          ┌──────────────────┐                               │
│                          │   DailyLifelog   │                               │
│                          │     Entity       │                               │
│                          └──────────────────┘                               │
│                                     │                                       │
│                                     ▼                                       │
│                          ┌──────────────────┐                               │
│                          │  LifelogSumma-   │                               │
│                          │  rizer Service   │ ←── AI Gateway                │
│                          └──────────────────┘                               │
│                                     │                                       │
│                                     ▼                                       │
│                          ┌──────────────────┐                               │
│                          │  MorningDebrief  │                               │
│                          │     Entity       │                               │
│                          └──────────────────┘                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       SendMorningReport Use Case                            │
│                                     │                                       │
│                                     ▼                                       │
│                          ┌──────────────────┐                               │
│                          │ TelegramGateway  │ ──► Telegram API              │
│                          └──────────────────┘                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER RECEIVES                                  │
│                           Morning Debrief Message                           │
│                        + Category Reply Keyboard                            │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              ▼                       ▼                       ▼
    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
    │ Select Category │    │ Type/Voice Text │    │  Ignore/Later   │
    │    Button       │    │   Free Entry    │    │                 │
    └─────────────────┘    └─────────────────┘    └─────────────────┘
              │                       │
              ▼                       ▼
    ┌─────────────────┐    ┌─────────────────┐
    │ HandleCategory  │    │ ProcessTextEntry│
    │   Selection     │    │ (with lifelog   │
    │                 │    │    context)     │
    └─────────────────┘    └─────────────────┘
              │                       │
              ▼                       ▼
    ┌─────────────────┐    ┌─────────────────┐
    │ GenerateContex- │    │ Generate Follow │
    │ tualQuestions   │    │ Up Questions    │
    └─────────────────┘    └─────────────────┘
              │                       │
              └───────────────────────┘
                          │
                          ▼
              ┌─────────────────────────┐
              │  Standard Journal Flow  │
              │  (Questions → Answers)  │
              └─────────────────────────┘
```

---

## Part 6: Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Morning debrief open rate | N/A | 80% |
| Category selection rate | N/A | 60% |
| Questions answered per session | ~2 | 4-5 |
| Voice entry usage | ~10% | 30% |
| Daily active journaling | ~3 days/week | 5+ days/week |
| Average session duration | 2-3 min | 5-7 min |

---

## Part 7: Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Insufficient lifelog data | Medium | High | Graceful degradation; fall back to generic questions |
| AI summary quality | Low | Medium | Iterative prompt engineering; user feedback loop |
| Morning timing conflicts | Medium | Low | Configurable send time; "Catch up" command |
| Privacy concerns | Low | High | Local-first data; no cloud sync without consent |
| Notification fatigue | Medium | Medium | Smart frequency; "quiet mode" option |
| Harvester failures | Medium | Medium | Independent harvester status; partial reports |

---

## Part 8: Open Questions

1. **Multi-user support**: Should morning debrief be per-user or per-household?
2. **Historical debriefs**: Should users be able to request debriefs for past dates?
3. **Weekly summaries**: Should there be a weekly rollup in addition to daily?
4. **Export formats**: Should debrief data be exportable beyond journal markdown?
5. **Integration with NutriBot**: Should nutrition data appear in morning debrief?
6. **Timezone handling**: How to handle users traveling across timezones?

---

## Appendix A: Existing Lifelog Data Samples

### events.yml (Calendar)
```yaml
- id: 3j8go6he0dbs4s7q9u23fd1qfl_20251221T200000Z
  start: '2025-12-21T15:00:00-05:00'
  end: '2025-12-21T17:00:00-05:00'
  duration: 2
  summary: Church
  type: calendar
  calendarName: Family Calendar
  location: The Church of Jesus Christ of Latter-day Saints
```

### garmin.yml (Fitness)
```yaml
2025-12-25:
  - activityId: 12345678
    activityName: "Morning Walk"
    startTimeLocal: "2025-12-25T08:00:00"
    distance: 2.5
    duration: 1800
    averageHR: 95
    steps: 3200
```

### todoist.yml (Tasks)
```yaml
- id: '9338612970'
  start: null
  summary: Wagen
  description: Biography of Konrad Wagner...
  type: todoist
  url: https://app.todoist.com/app/task/9338612970
```

---

## Appendix B: Glossary

| Term | Definition |
|------|------------|
| **Lifelog** | Automatically-captured life data from various sources |
| **Harvester** | Backend service that fetches data from external APIs |
| **Morning Debrief** | Daily summary message sent each morning |
| **Category** | Grouping of lifelog sources (Events, Health, Media, etc.) |
| **Contextual Question** | AI-generated question based on specific lifelog data |
| **Free Write** | Unstructured journaling without guided questions |

---

## Part 9: Senior Architect Feedback & Review

### 9.1 Critical Architectural Concerns

#### 🚨 **Multi-User Architecture Missing**

**Issue:** The PRD completely ignores that DaylightStation already has a robust multi-user/household system (`UserDataService`, user profiles, household-scoped data). The "Open Questions" section asks "Should morning debrief be per-user or per-household?" but this should be a **fundamental design decision**, not an afterthought.

**Evidence from codebase:**
- `backend/lib/config/UserDataService.mjs` provides full user/household data management
- Lifelog data is already stored per-user at `users/{username}/lifelog/*`
- NutriBot successfully uses this pattern with `UserResolver` mapping Telegram IDs to usernames
- The journalist bot is already initialized with user mapping in `backend/api.mjs` lines 355-393

**Questions:**
1. How will the morning debrief handle households with multiple users? 
2. Should each user get their own debrief at their preferred time?
3. How do we handle shared calendar events vs. personal events?
4. What's the user resolution strategy when a Telegram message arrives?

**Required changes:**
- Add `UserResolver` dependency to JournalistContainer
- Update all use cases to accept and use `username` parameter
- Define per-user debrief scheduling strategy
- Document household data segregation patterns

---

#### 🚨 **Lifelog Data Ownership Confusion**

**Issue:** The PRD claims lifelog data will be stored at `lifelog/events.yml`, `lifelog/garmin.yml`, etc. (Appendix A), but the **actual codebase** stores this data per-user at `users/{username}/lifelog/*`. This is a fundamental misunderstanding of the existing data architecture.

**Evidence:**
- `UserDataService.getLifelogData(username, category)` → `users/{username}/lifelog/{category}`
- `io.mjs` userLoadFile/userSaveFile enforce user-namespaced paths
- Legacy paths like `lifelog/{service}` trigger deprecation warnings

**Questions:**
1. Is lifelog data truly per-user or shared? (Current implementation says per-user)
2. How do harvest endpoints know which user to write data for?
3. Should the `/harvest/garmin` endpoint accept a `?user=username` parameter?
4. What happens when multiple family members use Garmin?

**Required changes:**
- Update all sample paths in Appendix A to `users/{username}/lifelog/*`
- Define harvest endpoint user targeting strategy
- Document how LifelogAggregator resolves the target user
- Add username context to all lifelog operations

---

#### ⚠️ **Harvest Endpoint Integration Gap**

**Issue:** The PRD proposes "Harvest Integration" (Section 3.5) without understanding how harvest endpoints currently work. Looking at `backend/harvest.js`:
- Harvesters already exist: `garmin`, `strava`, `fitness`, `gcal`, `gmail`, `todoist`, `lastfm`, `letterboxd`, etc.
- They return JSON responses via HTTP GET
- They accept `?user=` query parameter and default to head of household
- **They do NOT automatically write to lifelog files**

The harvester functions return data, but there's no evidence they persist to `lifelog/*.yml` automatically. Who writes the files?

**Questions:**
1. Do harvest endpoints write YAML files, or just return JSON?
2. If they write files, where? (`users/{username}/lifelog/` or legacy paths?)
3. Is there a separate service that polls harvest endpoints and persists data?
4. Should LifelogAggregator call harvest endpoints or read existing files?
5. How fresh does the data need to be? (Real-time API calls vs. cached files)

**Required investigation:**
- Trace the full data flow: API source → Harvester → Storage → Consumer
- Document whether harvesters are write-through or read-through caches
- Define staleness tolerance (can we use yesterday's harvest results?)

---

#### ⚠️ **Cron System Misunderstanding**

**Issue:** The PRD proposes a new config file `config/apps/journalist.yml` for scheduling (Section 3.6), but the actual cron system uses:
- `state/cron.yml` for job definitions (dynamic, loaded by `backend/cron.mjs`)
- Jobs trigger HTTP GET requests to backend endpoints
- Scheduling uses `cron_tab` expressions with timezone support
- No evidence of `config/apps/*.yml` pattern in codebase

**Evidence:**
```javascript
// backend/cron.mjs lines 100-106
const loadCronConfig = () => {
  let cronJobs = loadFile("state/cron"); // NOT config/apps/journalist.yml
  ...
}
```

**Questions:**
1. Should journalist morning debrief be a cron job or triggered externally?
2. Who manages the cron job entries? (Manual YAML editing vs. API?)
3. How do per-user debrief times get scheduled? (One job per user? Dynamic?)
4. Should we reuse the existing cron system or build app-specific scheduling?

**Required changes:**
- Remove fictitious `config/apps/journalist.yml` example
- Document actual cron job registration process
- Define how per-user schedules are managed
- Clarify relationship between `/journalist/morning` endpoint and cron

---

#### ⚠️ **AI Context Window Explosion Risk**

**Issue:** The PRD proposes sending **entire lifelog aggregations** to AI for summary generation (Section 3.4: `buildDailySummaryPrompt(lifelog: DailyLifelog)`). This is dangerous:

**Problems:**
1. A single day could have 50+ calendar events, 100+ music tracks, 20+ emails
2. Token costs will be massive for daily operations
3. No mention of context length limits or truncation strategies
4. Existing `HistoryFormatter.truncateToLength()` only handles conversation history

**Questions:**
1. What's the max token budget for morning debrief generation?
2. Should we summarize each data source separately first? (hierarchical summarization)
3. Do we need source-specific summarizers? (CalendarSummarizer, FitnessSummarizer, etc.)
4. How do we prioritize what data makes it into the context?
5. Should summaries be cached to avoid redundant AI calls?

**Recommended approach:**
```javascript
// Phase 1: Summarize each source (parallel)
const calendarSummary = await summarizeCalendar(events);
const fitnessSummary = await summarizeFitness(activities);

// Phase 2: Generate debrief from summaries (not raw data)
const debrief = await generateDebrief([calendarSummary, fitnessSummary]);
```

---

#### ⚠️ **Telegram Reply Keyboard vs. Inline Keyboard Confusion**

**Issue:** Section 3.8 claims to use `ReplyKeyboardMarkup` for category selection, but this creates **persistent keyboard buttons at the bottom of the chat** that remain visible across all conversations. This is inconsistent with the existing journalist bot pattern.

**Evidence from codebase:**
- Existing journalist uses `inline_keyboard` for question responses (buttons attached to specific messages)
- NutriBot uses inline keyboards for quick actions
- Reply keyboards are persistent and can't be message-specific

**Problems with Reply Keyboard:**
1. Buttons persist after selection (need explicit removal)
2. Can't have multiple active question sets simultaneously
3. User might press old keyboard buttons hours later
4. Doesn't match existing journalist UX patterns

**Questions:**
1. Why switch from inline keyboards to reply keyboards?
2. How do we handle the user starting a new conversation while old keyboard is visible?
3. Should category buttons be ephemeral (inline) or persistent (reply)?

**Recommendation:** Use inline keyboards for consistency, or provide strong justification for the architectural change.

---

### 9.2 Implementation Concerns

#### ⚠️ **Phase Estimates Unrealistic**

**Issue:** 7-week timeline for this scope is aggressive:
- Phase 1 (Lifelog Aggregation): Needs to integrate with 10+ data sources, understand data formats, handle user resolution - **2 weeks minimum**
- Phase 2 (Morning Debrief Core): Complex AI prompt engineering, entity design - **2 weeks**
- Phase 5 (New Harvesters): Plex API alone is complex (authentication, library scanning) - **2 weeks**

**Realistic timeline:** 12-16 weeks for production-ready implementation with testing.

#### ⚠️ **Error Handling and Graceful Degradation Not Specified**

**Questions:**
1. What if Garmin API is down on debrief generation day?
2. What if zero lifelog data exists for yesterday?
3. What's the minimum viable debrief? (just a greeting?)
4. How do we handle partial failures? (3 of 5 sources succeeded)
5. Should we queue failed sources for retry?

#### ⚠️ **No Data Privacy/Security Section**

**Critical omissions:**
1. Where is PII stored? (email content, calendar event details, location check-ins)
2. Are lifelog files encrypted at rest?
3. What's the data retention policy?
4. GDPR compliance considerations?
5. Can users delete/export their lifelog data?

---

### 9.3 Design Decisions Requiring Justification

#### 🤔 **Why Pre-Generate All Category Questions?**

Section 3.2 states:
> "Pre-generate 3 questions per category"

**Concerns:**
1. This is 6 categories × 3 questions = **18 AI calls every morning**
2. Massive waste if user only picks one category
3. Questions may be stale by the time user responds hours later

**Alternative:** Generate questions **on-demand** when user selects category (lazy evaluation).

#### 🤔 **Why Send Full Daily Summary?**

The example morning debrief shows extensive details (steps, heart rate, music tracks). This might be:
1. Overwhelming for users
2. Redundant (user already knows they went to church)
3. Better suited for an on-demand "What did I do yesterday?" command

**Questions:**
1. Has user research validated that people want detailed summaries?
2. Would a simpler "You have 4 events, 12 songs, and 2 tasks to journal about" be better?
3. Should detail level be user-configurable?

#### 🤔 **Why 8:00 AM Hard-Coded Time?**

Config shows `schedule: "0 8 * * *"`. Problems:
1. Not everyone wants morning journaling at 8 AM
2. Timezone handling not addressed (traveling users?)
3. What if user is in a meeting at 8 AM every day?

**Recommendation:** Per-user configurable debrief time in user profile.

---

### 9.4 Missing Requirements

#### ❌ **No Interaction Flow Diagrams for Edge Cases**

Document these scenarios:
1. User ignores morning debrief for 3 days
2. User starts journaling at 2 PM (8 hours after debrief)
3. User sends random message mid-debrief (breaking context)
4. Multiple debriefs queued (system was down for 2 days)

#### ❌ **No Rollback/Migration Strategy**

If this 2.0 system fails in production:
1. How do we roll back to existing journalist bot?
2. Are existing journal entries compatible?
3. Can we run both systems in parallel during migration?

#### ❌ **No Performance Metrics**

Define acceptable performance:
1. Max time for morning debrief generation: **< 10 seconds?**
2. Max time for AI follow-up question: **< 5 seconds?**
3. Lifelog aggregation time: **< 3 seconds?**

#### ❌ **No Monitoring/Observability Plan**

How will we know if it's working?
1. Metrics: debrief_generation_duration, question_response_rate, source_fetch_errors
2. Alerts: debrief_failed, source_timeout, ai_error_rate_high
3. Dashboards: daily active journalers, questions answered per session

---

### 9.5 Recommended Changes Before Implementation

#### **Priority 1 (Blockers):**
1. ✅ Define multi-user/household strategy
2. ✅ Correct all lifelog data paths to user-namespaced format
3. ✅ Document actual harvest endpoint behavior (read/write patterns)
4. ✅ Replace fictitious config with actual cron system integration
5. ✅ Add AI context budget and truncation strategy

#### **Priority 2 (Important):**
1. Add data privacy/security section
2. Define error handling and graceful degradation
3. Adjust timeline to 12-16 weeks
4. Add performance requirements
5. Document edge case handling

#### **Priority 3 (Nice to Have):**
1. User research validation for summary verbosity
2. Consider lazy question generation instead of pre-generation
3. Per-user debrief time configuration
4. Monitoring and alerting plan

---

### 9.6 Questions for Product Owner

1. **User Research:** Has the target user (you?) validated that a detailed morning summary is desirable? Or is this solving a problem that doesn't exist?

2. **Scope Reduction:** Can we ship an MVP with just 3 data sources (calendar, fitness, tasks) and prove value before building 10+ harvesters?

3. **Existing Bot Users:** Is the current journalist bot actively used? What's the retention rate? Are we rebuilding something that works or fixing something that's broken?

4. **AI Cost Budget:** What's the acceptable monthly AI API cost for this feature? (18 questions × 7 days × $0.03/call = $3.78/week per user)

5. **Success Criteria:** How will we measure if this 2.0 system is better than 1.0? What's the success metric? (Entries per week? User satisfaction? Retention?)

6. **Fallback Plan:** If lifelog integration is too complex, can we ship the morning debrief with generic questions first, then add context later?

---

### 9.7 Final Recommendation

**STATUS: ⛔️ NOT READY FOR IMPLEMENTATION**

This PRD demonstrates enthusiasm and vision but lacks the technical rigor needed for a production system. The author made several incorrect assumptions about the existing codebase (data paths, config files, harvest behavior) that would cause implementation failures.

**Recommended next steps:**
1. **Shadow existing systems:** Spend 1-2 weeks reading code and understanding UserDataService, harvest endpoints, cron system
2. **Rewrite Section 3** (Technical Design) with accurate architecture
3. **Add missing sections:** Privacy, Performance, Monitoring
4. **Reduce scope** to 3 data sources for MVP
5. **Get architectural review** from senior engineer before proceeding

**Strengths of this PRD:**
- ✅ Clear vision and user value proposition
- ✅ Good use case breakdown
- ✅ Thoughtful domain entity design
- ✅ Comprehensive data source inventory

**Critical weaknesses:**
- ❌ Misunderstood existing codebase architecture
- ❌ No user/household strategy
- ❌ Incorrect data path assumptions
- ❌ Missing error handling and observability
- ❌ Unrealistic timeline

**Verdict:** Promising idea, poor execution plan. Needs significant revision before code can be written.

---

*End of Document*
