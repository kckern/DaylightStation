# Bots Context

## Purpose

Chatbot framework for conversational interfaces. Includes journalist (lifelog), nutribot (nutrition), homebot (gratitude), and extensible bot architecture.

## Key Concepts

| Term | Definition |
|------|------------|
| **Bot** | Conversational agent with specific domain focus |
| **Adapter** | Protocol translator (HTTP, Canvas, Telegram) |
| **Message Builder** | Formats bot responses for different platforms |
| **ConfigProvider** | Manages bot-specific configuration |
| **Container** | DDD dependency injection container for bots |
| **Use Case** | Single-responsibility action handler (DDD pattern) |
| **EventRouter** | Routes incoming events to appropriate use cases |

## Exports

| Export | Location | Used By |
|--------|----------|---------|
| Bot framework | `chatbots/` | All bots |
| Journalist bot | `chatbots/bots/journalist/` | LifelogApp |
| Nutribot | `backend/src/3_applications/nutribot/` | HealthApp (DDD) |
| Homebot | `backend/src/3_applications/homebot/` | Gratitude tracking (DDD) |

## Imports

| Import | From | Purpose |
|--------|------|---------|
| AI/GPT lib | `lib/ai/`, `lib/gpt.mjs` | LLM integration |
| Lifelog extractors | `lib/lifelog-extractors/` | Data extraction |
| API client | foundations | External services |

## File Locations

### Backend
- `backend/chatbots/` - Bot framework root
  - `bots/journalist/` - Lifelog/journaling bot
  - `bots/nutribot/` - Nutrition tracking bot
  - `adapters/` - HTTP, Canvas adapters
  - `_lib/config/` - Bot configuration infrastructure
- `backend/routers/journalist.mjs` - Journalist API endpoints
- `backend/lib/lifelog-extractors/` - Data extraction modules (19 files)
- `backend/lib/gpt.mjs` - GPT/LLM integration

### Frontend
- `frontend/src/Apps/LifelogApp.jsx` - Lifelog interface
- `frontend/src/Apps/HealthApp.jsx` - Health/nutrition interface

### Config
- `data/households/{hid}/apps/lifelog/config.yml`
- `data/households/{hid}/apps/health/config.yml`

## Bot Architecture

**Pattern:** Adapter-based architecture

```
User Input → Adapter → Bot Logic → Message Builder → Adapter → Response
```

**Adapters:**
- HTTP adapter for web requests
- Canvas adapter for rich displays
- Telegram adapter for messaging

**Bots extend base class:**
```javascript
class JournalistBot extends BaseBot {
  async handleMessage(input, context) {
    // Process input, return response
  }
}
```

## Journalist Bot (Lifelog)

**Purpose:** Daily journaling, life event tracking, debrief conversations.

**Features:**
- Daily entry prompts
- Gratitude tracking
- Event extraction from conversation
- Context-aware follow-ups

**Related Docs:**
- `docs/bugs/change-subject-loses-debrief-context.md`
- `docs/design/lifelog-extractors.md`

## Nutribot

**Purpose:** Nutrition tracking, meal logging, health goals.

**Related Docs:**
- `docs/design/nutrition-goals-source-of-truth.md`
- `docs/ops/nutribot-data-migration.md`

## DDD Bot Applications (New Architecture)

The following bots use DDD architecture with dependency injection:

### Homebot (Gratitude Tracking)

**Purpose:** Collect and manage gratitude/hopes items via Telegram.

**Location:** `backend/src/3_applications/homebot/`

**Components:**
- `HomeBotContainer.mjs` - DI container with lazy-loaded use cases
- `HomeBotEventRouter.mjs` - Routes Telegram events to use cases
- `usecases/` - Use case implementations:
  - `ProcessGratitudeInput.mjs` - AI extraction of gratitude items
  - `AssignItemToUser.mjs` - Assign items to household member
  - `ToggleCategory.mjs` - Switch between gratitude/hopes
  - `CancelGratitudeInput.mjs` - Cancel flow

**Ports Used:**
- `IConversationStateStore` - Message-keyed session state
- `IMessagingGateway` - Telegram message sending
- `IAIGateway` - LLM for item extraction

### Nutribot (DDD Version)

**Location:** `backend/src/3_applications/nutribot/`

**Components:**
- `NutribotContainer.mjs` - DI container
- 31 use cases for nutrition tracking

## Common Tasks

- **Add new bot:** Create in `backend/src/3_applications/{botname}/`, implement Container and EventRouter
- **Add use case:** Create in `usecases/`, register in Container lazy getter
- **Add data extractor:** Create in `backend/src/1_domains/lifelog/extractors/`
- **Debug conversation:** Check bot logs, verify state store
- **Modify response format:** Update message builder or use case response handling
