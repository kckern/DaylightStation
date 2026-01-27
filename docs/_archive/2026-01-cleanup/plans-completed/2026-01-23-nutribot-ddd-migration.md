# Nutribot DDD Migration Plan

## Overview

Migrate nutribot from `_legacy/chatbots/bots/nutribot/` into the DDD architecture, using application isolation with proper adapter abstractions.

## Goals

- **Application isolation**: Nutribot self-contained in `3_applications/nutribot/`
- **Clean abstractions**: Application layer doesn't know about Telegram, OpenAI, etc.
- **Proper adapters**: External services in `2_adapters/` with port interfaces
- **FileIO usage**: All file operations through `0_infrastructure/utils/FileIO.mjs`
- **Big bang cutover**: Build complete, swap router, delete legacy

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Shared chatbot lib | Inline into nutribot | DRY refactor later |
| External services | Adapters in `2_adapters/` | Swappable providers |
| Persistence | Yaml adapters in `2_adapters/persistence/yaml/` | Matches existing patterns |
| Domain entities | `1_domains/lifelog/entities/` | Nutrition is part of lifelog |
| Migration strategy | Big bang | Clean swap, no feature flags |

## Directory Structure

```
backend/src/
├── 1_domains/lifelog/
│   └── entities/
│       ├── NutriLog.mjs              # Aggregate root
│       └── FoodItem.mjs              # Value object
│
├── 2_adapters/
│   ├── telegram/
│   │   ├── TelegramMessagingAdapter.mjs    # Implements IMessagingGateway
│   │   └── TelegramWebhookParser.mjs       # Parse webhook → normalized input
│   ├── nutrition/
│   │   ├── NutritionixAdapter.mjs          # Implements INutritionLookup
│   │   ├── UPCDatabaseAdapter.mjs          # Implements INutritionLookup
│   │   └── FoodImageRecognitionAdapter.mjs # Google image search
│   ├── ai/
│   │   └── OpenAIFoodParserAdapter.mjs     # Implements IFoodParser
│   └── persistence/yaml/
│       ├── YamlNutriLogStore.mjs           # Implements INutriLogStore
│       ├── YamlNutriListStore.mjs          # Implements INutriListStore
│       └── YamlNutriCoachStore.mjs         # Implements INutriCoachStore
│
├── 3_applications/nutribot/
│   ├── NutribotContainer.mjs         # DI container
│   ├── config/
│   │   └── NutribotConfig.mjs        # User goals, storage paths (no Telegram)
│   ├── usecases/                     # 25+ use cases (already migrated)
│   ├── handlers/
│   │   └── WebhookHandler.mjs        # Routes normalized input → use cases
│   ├── ports/                        # Interfaces the app needs
│   │   ├── IMessagingGateway.mjs
│   │   ├── IFoodParser.mjs
│   │   ├── INutritionLookup.mjs
│   │   ├── INutriLogStore.mjs
│   │   └── INutriListStore.mjs
│   └── lib/                          # Inlined utilities
│       ├── callback.mjs
│       ├── prompts.mjs
│       └── formatters.mjs
│
└── 4_api/routers/
    └── nutribot.mjs                  # Wires Telegram adapter → WebhookHandler
```

## Data Flow

```
┌─────────────────┐
│ Telegram Server │
└────────┬────────┘
         │ POST /foodlog/webhook
         ▼
┌─────────────────────────────────────────────────┐
│ 4_api/routers/nutribot.mjs                      │
│  - Validates webhook signature                   │
│  - Calls TelegramWebhookParser.parse(req.body)  │
│  - Gets normalized: { type, text, image, user } │
└────────┬────────────────────────────────────────┘
         ▼
┌─────────────────────────────────────────────────┐
│ 3_applications/nutribot/WebhookHandler          │
│  - Routes by input type:                        │
│    text → LogFoodFromText use case              │
│    image → LogFoodFromImage use case            │
│    callback → HandleCallback use case           │
│  - Returns response payload (abstract)          │
└────────┬────────────────────────────────────────┘
         ▼
┌─────────────────────────────────────────────────┐
│ Use case (e.g., LogFoodFromText)                │
│  - Uses IFoodParser to parse "2 eggs, toast"    │
│  - Creates NutriLog entity                      │
│  - Uses INutriLogStore to persist               │
│  - Uses IMessagingGateway to send confirmation  │
└─────────────────────────────────────────────────┘
```

## Port Definitions

### IMessagingGateway

Abstract messaging operations - no Telegram concepts.

```javascript
{
  sendMessage(userId, text, options)           // Send text message
  sendPhoto(userId, imageBuffer, caption)      // Send image
  sendKeyboard(userId, text, buttons)          // Send inline keyboard
  editMessage(userId, messageId, text)         // Edit existing message
  deleteMessage(userId, messageId)             // Delete message
  answerCallback(callbackId, text)             // Acknowledge button press
}
```

### IFoodParser

AI food parsing abstraction.

```javascript
{
  parseText(text, context)     // "2 eggs, toast" → FoodItem[]
  parseImage(imageUrl)         // Photo → FoodItem[]
  parseVoice(audioBuffer)      // Voice memo → text → FoodItem[]
}
```

### INutritionLookup

Nutrition database abstraction.

```javascript
{
  lookupByName(foodName)       // "banana" → nutrition facts
  lookupByUPC(barcode)         // "012345678" → product + nutrition
}
```

### INutriLogStore

Meal log persistence.

```javascript
{
  save(nutriLog)
  findById(id)
  findByUserAndDate(userId, date)
  findPending(userId)
  updateStatus(id, status)
}
```

### INutriListStore

Denormalized items for fast reporting.

```javascript
{
  addItem(userId, date, foodItem)
  getItemsForDate(userId, date)
  removeItem(userId, itemId)
}
```

## Migration Phases

### Phase 1: Foundation

1. Create `1_domains/lifelog/entities/` - move `NutriLog.mjs` and `FoodItem.mjs` from legacy, update to use private fields pattern
2. Define ports in `3_applications/nutribot/ports/` - the 5 interfaces above
3. Create `2_adapters/persistence/yaml/` stores implementing the persistence ports, using FileIO

### Phase 2: External Adapters

4. Create `2_adapters/telegram/TelegramMessagingAdapter.mjs` implementing `IMessagingGateway`
5. Create `2_adapters/telegram/TelegramWebhookParser.mjs` - normalizes webhook payloads
6. Create `2_adapters/ai/OpenAIFoodParserAdapter.mjs` implementing `IFoodParser`
7. Create `2_adapters/nutrition/NutritionixAdapter.mjs` implementing `INutritionLookup`

### Phase 3: Application Layer

8. Inline utilities into `3_applications/nutribot/lib/` (callback, prompts, formatters)
9. Create `WebhookHandler.mjs` - routes normalized input to use cases
10. Update `NutribotContainer.mjs` to wire new adapters
11. Update existing use cases to use new ports instead of legacy imports

### Phase 4: Cutover

12. Update `4_api/routers/nutribot.mjs` to use new wiring
13. Update `0_infrastructure/bootstrap.mjs` to compose new dependencies
14. Test end-to-end
15. Delete legacy code

## Key Considerations

### What stays in legacy (for now)

- Other bots (homebot, journalist) - separate migration later
- Shared chatbot lib - duplicated in nutribot, DRY later

### Testing strategy

- Manual Telegram testing before cutover (send real messages)
- Compare responses between legacy and new implementation
- Verify YAML files written correctly

### Config handling

- `NutribotConfig.mjs` loads user goals, storage paths from existing `config.yaml`
- Telegram-specific config (bot token, webhook path) stays in `4_api/` router or `bootstrap.mjs`
- Secrets via environment variables, no changes needed

### Rollback plan

- Keep legacy code until new version is validated in production
- If issues, revert `bootstrap.mjs` wiring to use legacy router
- Delete legacy only after confidence period

## Provider Switching (Future)

The port abstraction enables swapping providers with zero application changes:

```
Current:
  IMessagingGateway ← TelegramMessagingAdapter

Future (hypothetical):
  IMessagingGateway ← SlackMessagingAdapter
  IFoodParser ← AnthropicFoodParserAdapter
```

Wiring changes happen in `bootstrap.mjs`, not in use cases.
