# HomeBot + Gratitude App Integration Design

## Executive Summary

This document outlines the design for a new **HomeBot** chatbot and its integration with the **Gratitude** TV App. HomeBot will serve as a multi-modal input source for household-scoped applications, with `GratitudeInput` as its first feature. The goal is to allow users to contribute gratitude/hope items via Telegram (text or voice) which then appear in real-time on the TV app.

---

## 1. Current State Analysis

### 1.1 Gratitude TV App (`Gratitude.jsx`)

**Current Features:**
- User selection from a list of household members
- Two categories: "Gratitude" and "Hopes"
- Card-swiping interface using keyboard/remote (Left=discard, Right/Enter=select)
- WebSocket integration for real-time updates
- Snapshot save/restore for dev testing
- Printer integration endpoint exists but returns empty data

**Current Data Flow:**
```
User → Remote/Keyboard → React State → API POST → YAML Files
                                          ↓
                         WebSocket broadcast (for custom items only)
```

**Limitations:**
1. Legacy `gratitude/users.yaml` is unused and will be abandoned
2. No way to ADD new items from TV interface (only select from bank)
3. Custom items only come via `/api/gratitude/new?text=...` endpoint

### 1.2 Gratitude Backend (`gratitude.mjs`)

**Current Endpoints:**
- `GET /bootstrap` - Load all data (users, options, selections, discarded)
- `GET/POST /selections/:category` - CRUD for selections
- `GET/POST /discarded/:category` - CRUD for discarded items
- `GET /new?text=...` - Add custom item via WebSocket broadcast

**Data Storage (household-scoped):**
```
data/household/common/gratitude/
├── options.gratitude.yaml
├── options.hopes.yaml
├── selections.gratitude.yaml
├── selections.hopes.yaml
├── discarded.gratitude.yaml
├── discarded.hopes.yaml
└── snapshots/
```

**User Source:** `household.yml` (NOT legacy `users.yaml`)

### 1.3 WebSocket Infrastructure (`websocket.js`, `WebSocketContext.jsx`)

**Current Capabilities:**
- Server broadcasts to all connected clients
- Clients register callbacks to handle payloads
- `topic` field used to filter messages (e.g., `fitness` filtered out)
- Gratitude app listens for items with `item: { id, text }` structure

**WebSocket Payload Format (current):**
```json
{
  "item": { "id": 1703..., "text": "Sunny weather" },
  "timestamp": "2025-12-19T...",
  "type": "gratitude_item",
  "isCustom": true
}
```

### 1.4 Chatbots Framework (`chatbots/bots/`)

**NutriBot Pattern (reference implementation):**
1. **Container** - DI wiring for all dependencies
2. **Server/Router** - Express routes with middleware
3. **Use Cases** - Business logic (e.g., `LogFoodFromText.mjs`)
4. **Domain** - Entities, value objects
5. **Handlers** - Direct input handlers (non-Telegram)
6. **Repositories** - Data persistence

**Key NutriBot UX Pattern:**
1. User sends text/voice/image
2. Bot deletes original message
3. AI processes input
4. Bot sends confirmation message with inline keyboard
5. User confirms/revises
6. Data persisted

---

## 2. Design Decisions

### 2.1 Core Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **User Identity** | Single Telegram user (head of household) selects items FOR any household member | Practical for family use - one person often inputs for others |
| **Category Selection** | Inline keyboard toggle (Option D) | Explicit selection with minimal friction |
| **Item Processing** | Batch - all items get same user/category assignment | Natural for gratitude ("I'm grateful for X, Y, and Z") |
| **Duplicate Handling** | Allow duplicates | Item IDs are unique; same text can have different meaning on different days |
| **User Source** | `household.yml` only | Legacy `users.yaml` abandoned - never fully implemented |
| **Voice Input** | Transcribe → process as text | Reuse NutriBot's Whisper integration |
| **Printer** | Use existing canvas layout | Current `printer.mjs` layout is sufficient |
| **Backward Compatibility** | None required | Legacy gratitude users.yaml has no dependencies |

---

## 3. Proposed Architecture

### 3.1 HomeBot Structure

```
backend/chatbots/bots/homebot/
├── container.mjs              # DI container
├── server.mjs                 # Express router
├── config/
│   └── HomeBotConfig.mjs     # Bot configuration
├── domain/
│   ├── GratitudeItem.mjs     # Value object
│   └── HouseholdMember.mjs   # Entity
├── application/
│   ├── ports/
│   │   ├── IGratitudeRepository.mjs
│   │   └── IHouseholdRepository.mjs
│   └── usecases/
│       ├── ProcessGratitudeInput.mjs   # Main use case
│       ├── AssignItemToUser.mjs        # Handle user selection callback
│       ├── ToggleCategory.mjs          # Handle category toggle callback
│       └── CancelGratitudeInput.mjs    # Handle cancel callback
├── handlers/
│   └── gratitude.mjs         # Direct API handlers (non-Telegram)
└── repositories/
    └── GratitudeRepository.mjs  # Wraps gratitude.mjs data access
```

### 3.2 Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         TELEGRAM                                  │
│   User sends: "Sunny weather, Good coffee, Family time"          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      HomeBot Router                              │
│   POST /homebot/webhook                                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              ProcessGratitudeInput Use Case                      │
│   1. Delete original message                                     │
│   2. Send "Processing..." status                                 │
│   3. AI extracts items: ["Sunny Weather", "Good Coffee", ...]   │
│   4. Send confirmation with category toggle + user keyboard      │
└─────────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
    User toggles        User selects        User cancels
    category            household member          │
          │                   │                   ▼
          ▼                   ▼           Delete message
    Update message    ┌─────────────────────────────────────────┐
    (swap category)   │       AssignItemToUser Use Case         │
                      │   1. Answer callback                    │
                      │   2. For each item:                     │
                      │      a. Create selection with userId    │
                      │      b. Broadcast to WebSocket          │
                      │   3. Update/delete confirmation message │
                      │   4. Send success reply                 │
                      └─────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                    WebSocket Broadcast                           │
│   { topic: "gratitude", items: [...], userId: "...", ... }      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Gratitude TV App                              │
│   WebSocket callback receives items                              │
│   Items animate into "Selected" column                           │
│   Highlighting shows they're new                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 Telegram UI Mockups

**Step 1: User Input**
```
User: Sunny weather, good coffee, and family time
```

**Step 2: Bot Confirmation (original message deleted)**
```
┌────────────────────────────────────────────┐
│ 📝 Items to Add                            │
│                                            │
│ • Sunny Weather                            │
│ • Good Coffee                              │
│ • Family Time                              │
│                                            │
│ Category:                                  │
│ ┌──────────────────┐ ┌──────────────────┐ │
│ │ ✅ Gratitude     │ │    Hopes         │ │
│ └──────────────────┘ └──────────────────┘ │
│                                            │
│ Who is adding these?                       │
│ ┌────────┐ ┌────────┐ ┌────────┐         │
│ │  Dad   │ │  Mom   │ │ User_2  │         │
│ └────────┘ └────────┘ └────────┘         │
│ ┌────────┐ ┌────────┐                     │
│ │  User_3  │ │  User_4  │                     │
│ └────────┘ └────────┘                     │
│ ┌────────────────────────────────┐        │
│ │            Cancel              │        │
│ └────────────────────────────────┘        │
└────────────────────────────────────────────┘
```

**Step 2b: After toggling to Hopes**
```
┌────────────────────────────────────────────┐
│ 📝 Items to Add                            │
│                                            │
│ • Sunny Weather                            │
│ • Good Coffee                              │
│ • Family Time                              │
│                                            │
│ Category:                                  │
│ ┌──────────────────┐ ┌──────────────────┐ │
│ │    Gratitude     │ │ ✅ Hopes         │ │
│ └──────────────────┘ └──────────────────┘ │
│                                            │
│ Who is hoping for these?                   │
│ ...                                        │
└────────────────────────────────────────────┘
```

**Step 3: After Selection (confirmation)**
```
✅ Added 3 gratitude items for Dad!
```

---

## 4. Integration Points

### 4.1 User Source: `household.yml`

Gratitude users will be derived directly from `household.yml`:

```yaml
# data/household/household.yml
users:
  - {username}    # Display name from user profile
  - user_2
  - user_3
  - user_4
  - user_5
```

The `gratitude.mjs` backend will be updated to:
1. Read users from `configService.getHouseholdUsers(householdId)`
2. Map usernames to display names from user profiles
3. Ignore legacy `gratitude/users.yaml`

### 4.2 WebSocket Payload Enhancement

**Proposed:**
```json
{
  "topic": "gratitude",
  "action": "item_added",
  "items": [
    { "id": 123, "text": "Sunny Weather" },
    { "id": 124, "text": "Good Coffee" }
  ],
  "userId": "{username}",
  "userName": "Dad",
  "category": "gratitude",
  "source": "homebot",
  "timestamp": "2025-12-19T..."
}
```

Frontend will filter by `topic: "gratitude"` and handle multi-item payloads.

### 4.3 Telegram Bot Registration

**New Bot Token Required:**
- Bot name: `@DaylightHomeBot` or similar
- Webhook: `/homebot/webhook`
- Config location: `config.secrets.yml` → `TELEGRAM_HOMEBOT_TOKEN`

---

## 5. Implementation Phases

### Phase 1: HomeBot Skeleton
- Create homebot folder structure
- Implement basic container/server
- Register webhook in `api.mjs`
- Add bot token to config

### Phase 2: ProcessGratitudeInput Use Case
- Text input → AI itemization
- Category toggle keyboard generation
- User selection keyboard generation
- Message deletion flow

### Phase 3: AssignItemToUser Use Case
- Callback handling (user selection + category toggle)
- Data persistence via `gratitude.mjs`
- WebSocket broadcast

### Phase 4: TV App Integration
- Update `gratitude.mjs` to use `household.yml` users
- WebSocket payload handling updates
- Animation refinements for multi-item payloads

### Phase 5: Voice Support
- Transcription integration (reuse OpenAI Whisper from NutriBot)
- Same flow as text after transcription

### Phase 6: Printer Integration
- Pull finalized selections grouped by user/date
- Use existing `printer.mjs` canvas layout

---

## 6. Technical Notes

### 6.1 Shared Infrastructure to Reuse

From `chatbots/_lib/`:
- `logging/` - Logger with trace IDs
- `config/ConfigProvider.mjs` - Bot configuration
- `users/UserResolver.mjs` - User mapping (extend for household support)

From `chatbots/infrastructure/`:
- `messaging/TelegramGateway.mjs` - Send/delete messages, handle callbacks
- `ai/OpenAIGateway.mjs` - GPT for itemization, Whisper for transcription

From `chatbots/adapters/http/`:
- `middleware/` - Tracing, validation, idempotency
- `TelegramWebhookHandler.mjs` - Standard webhook processing

### 6.2 New Components Needed

1. `IGratitudeRepository` - Port for gratitude data access
2. `GratitudeRepository` - Implementation wrapping `gratitude.mjs` functions
3. `IHouseholdRepository` - Port for household member lookup
4. `HouseholdRepository` - Implementation using `ConfigService`

### 6.3 AI Prompt Design (Draft)

```
You are extracting gratitude items from user input.

User input: "{text}"

Extract a list of distinct items the user is grateful for or hoping for.
Clean up grammar and format each as Title Case.
Return as JSON array of strings.

Example:
Input: "sunny weather today, my morning coffee was great, and spending time with family"
Output: ["Sunny Weather", "Morning Coffee", "Family Time"]
```

---

## 7. Conclusion

HomeBot represents a natural extension of the chatbots framework to household-level applications. The `GratitudeInput` feature demonstrates the pattern for future HomeBot capabilities (e.g., calendar events, shopping lists, chores).

**Key Design Decisions:**
1. Follow NutriBot's proven UX pattern (delete → process → confirm → persist)
2. Batch item processing with single user/category selection
3. Category toggle via inline keyboard (Option D)
4. WebSocket broadcast for real-time TV updates
5. `household.yml` as sole source of truth for users (no legacy compatibility)
6. Voice input via transcription → text flow

**Next Steps:**
1. Set up HomeBot Telegram bot and obtain token
2. Begin Phase 1 implementation
3. Update `gratitude.mjs` to use household users

---

*Document Version: 1.1*  
*Author: GitHub Copilot*  
*Date: December 19, 2025*
