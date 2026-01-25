# Chatbot Identity Standardization Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to create implementation plan from this design.

**Goal:** Standardize identity handling across chatbot framework - clean separation between conversation routing and user identity resolution.

**Architecture:** Adapter layer extracts platform user IDs from conversation context; application layer uses injected UserResolver to map to system users; config lives in household-scoped app configs.

**Tech Stack:** Node.js ES Modules, DDD layers, YAML config

---

## Identity Concepts

Three distinct identity types:

| Type | Format | Purpose | Layer |
|------|--------|---------|-------|
| **ConversationId** | `telegram:b6898194425_c575596036` | Routing, state storage | Domain |
| **PlatformUserId** | `575596036` (platform-specific) | Identity resolution | Adapter extracts |
| **SystemUser** | `kckern` | Internal user ID | Domain/Application |

**Key insight:** The adapter layer knows how to extract a platform user ID from a conversation context. This is platform-specific knowledge (Telegram has botId+chatId, Discord might have guildId+userId, etc.).

**Flow:**
```
Webhook arrives
    |
    v
TelegramAdapter parses --> ConversationId (for routing/state)
                       --> PlatformUserId (for identity)
    |
    v
Application layer receives both, asks UserResolver for SystemUser
```

---

## Config Location

**System level** (`data/system/apps/chatbots.yml`) - bot infrastructure only:

```yaml
bots:
  nutribot:
    token_key: TELEGRAM_NUTRIBOT_TOKEN
    telegram_bot_id: "6898194425"
    secretToken: "..."
    webhooks:
      prod: https://daylightstation-api.kckern.net/api/v1/nutribot/webhook

defaults:
  nutrition_goals: { ... }

data_paths:
  nutribot: { ... }
```

**Household level** (`data/households/{hid}/apps/chatbots.yml`) - user mappings:

```yaml
identity_mappings:
  telegram:
    "575596036": kckern
    "123456789": kirk
  # future platforms
  discord:
    "987654321": kckern
```

This mirrors the fitness pattern:
- System: Bot definitions (like app-wide settings)
- Household: identity_mappings (like devices.heart_rate mappings)

---

## UserResolver Service

**Location:** `backend/src/0_infrastructure/users/UserResolver.mjs`

**Interface:**

```javascript
class UserResolver {
  constructor(configService) { ... }

  /**
   * Resolve platform user ID to system user
   * @param {string} platform - 'telegram', 'discord', etc.
   * @param {string} platformUserId - Platform-specific user ID
   * @param {string} [householdId] - Optional, defaults to default household
   * @returns {string|null} - System username or null if unknown
   */
  resolveUser(platform, platformUserId, householdId = null) {
    const hid = householdId ?? this.#configService.getDefaultHouseholdId();
    const chatbotsConfig = this.#configService.getHouseholdAppConfig(hid, 'chatbots');
    return chatbotsConfig?.identity_mappings?.[platform]?.[platformUserId] ?? null;
  }
}
```

---

## Adapter Layer Extraction

**TelegramChatRef** gets a new property:

```javascript
// backend/src/2_adapters/telegram/TelegramChatRef.mjs

class TelegramChatRef {
  /**
   * Get the platform user ID (chat ID only, without bot context)
   * Used for identity resolution - the bot ID is irrelevant for "who is this person"
   * @returns {string}
   */
  get platformUserId() {
    return this.#chatId;
  }
}
```

**IInputEvent** gains `platform` and `platformUserId` fields:

```javascript
// backend/src/2_adapters/telegram/IInputEvent.mjs

function toInputEvent(parsed, telegramRef) {
  return {
    type: parsed.type,
    conversationId: telegramRef.toConversationId().toString(),  // for routing/state
    platform: 'telegram',                                        // abstract platform name
    platformUserId: telegramRef.platformUserId,                  // for identity
    messageId: parsed.messageId,
    payload: { ... },
    metadata: { ... },
  };
}
```

---

## Application Layer Usage

**Use cases receive abstract identifiers, no Telegram knowledge:**

```javascript
// backend/src/3_applications/nutribot/usecases/GenerateReport.mjs

class GenerateReport {
  #userResolver;

  constructor({ userResolver, ... }) {
    this.#userResolver = userResolver;
  }

  async execute({ conversationId, platform, platformUserId }) {
    // Resolve to system user via injected resolver
    const systemUser = this.#userResolver.resolveUser(platform, platformUserId);

    if (!systemUser) {
      return { error: 'unknown_user', platformUserId };
    }

    // Use systemUser for data access
    const goals = this.#config.getUserGoals(systemUser);
    // ...
  }
}
```

**Key points:**
- Application layer receives `platform` + `platformUserId` (abstract)
- Calls `userResolver.resolveUser(platform, platformUserId)`
- Never sees Telegram internals
- UserResolver is injected, testable

---

## Wiring & Bootstrap

**ConfigService addition:**

```javascript
getHouseholdAppConfig(householdId, appName) {
  const hid = householdId ?? this.getDefaultHouseholdId();
  return this.#config.households?.[hid]?.apps?.[appName] ?? null;
}
```

**ConfigLoader addition** - load household app configs in `loadAllHouseholds()`.

**Bootstrap wiring:**

```javascript
const userResolver = new UserResolver(configService);

const nutribotContainer = createNutribotServices({
  userResolver,
  // ...
});
```

---

## Migration Steps

1. Create `data/households/default/apps/chatbots.yml` with `identity_mappings`
2. Remove `identity_mappings` from `data/system/apps/chatbots.yml`
3. Update ConfigLoader to load household apps
4. Add `getHouseholdAppConfig()` to ConfigService
5. Enhance UserResolver to use new config path
6. Add `platformUserId` property to TelegramChatRef
7. Update IInputEvent to include `platform` and `platformUserId`
8. Update adapters/routers to pass platform identity fields
9. Update use cases to use UserResolver instead of bot-specific resolution
10. Remove hardcoded user resolution from NutriBotConfig, JournalistContainer, etc.
