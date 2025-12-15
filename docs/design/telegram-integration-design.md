# Telegram Integration Design Document

**Author:** DaylightStation Team  
**Date:** December 15, 2025  
**Status:** Draft  

---

## Executive Summary

This document outlines the integration strategy for connecting the refactored NutriBot chatbot system (proven with `CLIChatSimulator`) to the Telegram platform via `TelegramGateway`. The goal is to ensure both CLI and Telegram interfaces share the same clean service layer without code duplication.

---

## Table of Contents

1. [Current Architecture Analysis](#1-current-architecture-analysis)
2. [Legacy Integration Review](#2-legacy-integration-review)
3. [Gap Analysis](#3-gap-analysis)
4. [Proposed Architecture](#4-proposed-architecture)
5. [Configuration Design](#5-configuration-design)
6. [ID Mapping Strategy](#6-id-mapping-strategy)
7. [Webhook Integration](#7-webhook-integration)
8. [Implementation Plan](#8-implementation-plan)
9. [Migration Strategy](#9-migration-strategy)

---

## 1. Current Architecture Analysis

### 1.1 Clean Architecture Layers

The current NutriBot implementation follows clean architecture principles:

```
┌─────────────────────────────────────────────────────────────┐
│                    Presentation Layer                        │
│  ┌──────────────────┐    ┌──────────────────┐              │
│  │ CLIChatSimulator │    │  TelegramGateway │              │
│  │   (proven ✅)    │    │   (to integrate) │              │
│  └────────┬─────────┘    └────────┬─────────┘              │
├───────────┼──────────────────────┼──────────────────────────┤
│           │   Adapter Layer      │                          │
│  ┌────────▼─────────┐    ┌───────▼────────┐                │
│  │CLIMessagingGateway│   │EventRouter.mjs │                │
│  │ (proven ✅)       │   │(needs update)  │                │
│  └────────┬─────────┘    └───────┬────────┘                │
├───────────┴──────────────────────┴──────────────────────────┤
│                    Application Layer                         │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                 NutribotContainer                     │  │
│  │  • LogFoodFromText    • AcceptFoodLog                │  │
│  │  • LogFoodFromImage   • DiscardFoodLog               │  │
│  │  • LogFoodFromVoice   • ReviseFoodLog                │  │
│  │  • LogFoodFromUPC     • GenerateDailyReport          │  │
│  │  • ProcessRevisionInput • GenerateThresholdCoaching  │  │
│  └────────────────────────┬─────────────────────────────┘  │
├───────────────────────────┼─────────────────────────────────┤
│                    Domain Layer                              │
│  ┌────────────────────────▼─────────────────────────────┐  │
│  │ Entities: NutriLog, FoodItem                         │  │
│  │ Value Objects: ChatId, MessageId, Timestamp          │  │
│  │ Schemas: validation rules                            │  │
│  └──────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                 Infrastructure Layer                         │
│  ┌─────────────────┐ ┌─────────────────┐ ┌──────────────┐  │
│  │ NutriLogRepo    │ │ NutriListRepo   │ │ OpenAIGateway│  │
│  │ (file-based)    │ │ (file-based)    │ │              │  │
│  └─────────────────┘ └─────────────────┘ └──────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 What Works Well

1. **IMessagingGateway Interface** (`application/ports/IMessagingGateway.mjs`):
   - Well-defined contract with methods: `sendMessage`, `sendImage`, `updateMessage`, `updateKeyboard`, `deleteMessage`, `transcribeVoice`, `getFileUrl`
   - Both `CLIMessagingGateway` and `TelegramGateway` implement this interface

2. **Use Case Independence**:
   - Use cases accept plain IDs (`userId`, `conversationId`, `messageId`) as strings
   - No Telegram-specific types leak into business logic

3. **Container Pattern**:
   - `NutribotContainer` manages dependency injection cleanly
   - Accepts adapters through constructor injection

### 1.3 Current Issues Identified

| Issue | Current State | Impact |
|-------|--------------|--------|
| **ChatId/ConversationId coupling** | TelegramGateway expects `ChatId` value objects with `.userId` property | Use cases pass plain strings, causing potential mismatches |
| **No unified event routing** | CLIChatSimulator has own routing; EventRouter.mjs has different routing | Code duplication, maintenance burden |
| **Legacy chat_id format** | Legacy: `b{bot_id}_u{user_id}` | New system uses `{channel}:{identifier}` |
| **Missing webhook orchestration** | No unified webhook handler wiring | Manual setup required |

---

## 2. Legacy Integration Review

### 2.1 Legacy `foodlog_hook.mjs` Analysis

The legacy implementation in `backend/journalist/foodlog_hook.mjs` provides valuable insights:

#### Chat ID Construction (Legacy)
```javascript
const chat_id = `b${bot_id}_u${user_id}`;
```

#### Webhook Payload Parsing
```javascript
const payload = (req.body && Object.keys(req.body).length > 0) ? req.body : req.query;
const user_id = parseInt(payload.message?.chat?.id || 
                         payload.callback_query?.message?.chat?.id || 
                         payload.chat_id || req.query.chat_id || journalist_user_id);
const message_id = payload.message?.message_id || 
                   payload.message_id || 
                   payload.callback_query?.message?.message_id || null;
```

#### Event Detection Pattern
```javascript
// Determine input type
if(slashCommand) await processSlashCommand(chat_id, slashCommand, message_id);
if(payload.callback_query) await processButtonpress(payload, chat_id);
if(img_id) await processImgMsg(file_id, chat_id, host, payload);
if(upc) await processUPC(chat_id, upc, message_id, res);
if(payload.message?.voice) await processVoice(chat_id, payload.message);
if(text && !slashCommand) await processText(chat_id, message_id, text);
```

#### Cursor-Based State Management
Legacy uses a "cursor" pattern for multi-step flows:
```javascript
const cursor = await getNutriCursor(chat_id);
if (cursor.revising) { /* handle revision state */ }
if (cursor.adjusting) { /* handle adjustment menu state */ }
```

### 2.2 Key Legacy Patterns to Preserve

1. **UPC Queue Management**: Uses message_id lookup instead of cursor for UPC portion selection
2. **Revision Flow**: Cursor links text input to message being revised
3. **Adjustment Menus**: Multi-level navigation state
4. **Report Generation**: Triggered only when all pending items complete

---

## 3. Gap Analysis

### 3.1 Service Layer Abstraction Assessment

**Question**: Is our service layer sufficiently abstracted?

**Answer**: **Partially Yes, but improvements needed.**

| Aspect | Assessment | Needs Work |
|--------|------------|------------|
| Use case inputs | ✅ Plain strings | No |
| Use case outputs | ✅ Platform-agnostic | No |
| Messaging gateway interface | ✅ Well-defined | No |
| Chat ID handling | ⚠️ Inconsistent | Yes |
| Event routing | ⚠️ Duplicated | Yes |
| Configuration | ⚠️ Scattered | Yes |

### 3.2 Specific Gaps

#### Gap 1: ChatId Inconsistency

**Problem**: `TelegramGateway.#extractChatParams()` expects `ChatId` objects:
```javascript
#extractChatParams(chatId) {
  return { chat_id: chatId.userId };  // Expects .userId property
}
```

But `EventRouter` passes plain strings:
```javascript
return useCase.execute({
  userId: chatId,        // Plain string "575596036"
  conversationId: chatId, // Plain string "575596036"
  text,
  messageId,
});
```

**Solution**: Standardize on plain string IDs at adapter boundaries, let adapters construct platform-specific formats.

#### Gap 2: Dual Event Routing

**Problem**: 
- `CLIChatSimulator` has its own input handling logic (lines 540-800)
- `EventRouter.mjs` has separate Telegram-specific routing

**Solution**: Create unified `IInputEvent` abstraction and shared routing logic.

#### Gap 3: Configuration Fragmentation

**Problem**: Bot configuration scattered across:
- `config.app.yml` (telegram bot IDs, webhook URLs)
- `config.secrets.yml` (tokens)
- Environment variables (`process.env.TELEGRAM_NUTRIBOT_TOKEN`)
- Hardcoded values in containers

**Solution**: Centralized configuration provider.

---

## 4. Proposed Architecture

### 4.1 Unified Adapter Layer

```
                    ┌─────────────────────────┐
                    │      InputEvent         │
                    │  • type: text|image|    │
                    │         voice|callback  │
                    │  • userId: string       │
                    │  • messageId: string    │
                    │  • payload: {...}       │
                    └───────────┬─────────────┘
                                │
         ┌──────────────────────┼──────────────────────┐
         │                      │                      │
┌────────▼────────┐    ┌───────▼───────┐    ┌────────▼────────┐
│ TelegramAdapter │    │  CLIAdapter   │    │  DiscordAdapter │
│  (new)          │    │  (existing)   │    │  (future)       │
└────────┬────────┘    └───────┬───────┘    └────────┬────────┘
         │                     │                      │
         └─────────────────────┼──────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  UnifiedEventRouter │
                    │  (shared logic)     │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  NutribotContainer  │
                    │  (use cases)        │
                    └─────────────────────┘
```

### 4.2 New Components

#### 4.2.1 `IInputEvent` Interface

```javascript
// backend/chatbots/application/ports/IInputEvent.mjs
/**
 * Platform-agnostic input event
 * @typedef {Object} IInputEvent
 * @property {'text'|'image'|'voice'|'callback'|'command'|'upc'} type
 * @property {string} userId - Platform user identifier
 * @property {string} conversationId - Chat/conversation identifier
 * @property {string} [messageId] - Source message ID (if applicable)
 * @property {Object} payload - Type-specific data
 */

/**
 * @typedef {Object} TextEventPayload
 * @property {string} text
 */

/**
 * @typedef {Object} ImageEventPayload
 * @property {string} fileId - Platform file identifier
 * @property {string} [url] - Direct URL if available
 */

/**
 * @typedef {Object} VoiceEventPayload
 * @property {string} fileId
 * @property {number} [duration] - Duration in seconds
 */

/**
 * @typedef {Object} CallbackEventPayload
 * @property {string} data - Callback data string
 * @property {string} sourceMessageId - Message the button was on
 */
```

#### 4.2.2 `TelegramInputAdapter`

```javascript
// backend/chatbots/adapters/telegram/TelegramInputAdapter.mjs
export class TelegramInputAdapter {
  /**
   * Parse Telegram webhook payload into IInputEvent
   * @param {Object} update - Telegram Update object
   * @param {Object} config - Bot configuration
   * @returns {IInputEvent|null}
   */
  static parse(update, config) {
    const { message, callback_query, edited_message } = update;

    if (callback_query) {
      return this.#parseCallback(callback_query, config);
    }

    if (message) {
      return this.#parseMessage(message, config);
    }

    return null; // Unsupported update type
  }

  static #parseMessage(message, config) {
    const userId = String(message.chat.id);
    const conversationId = this.#buildConversationId(config.botId, userId);
    const messageId = String(message.message_id);

    // Photo message
    if (message.photo?.length > 0) {
      const photo = message.photo[message.photo.length - 1];
      return {
        type: 'image',
        userId,
        conversationId,
        messageId,
        payload: { fileId: photo.file_id },
      };
    }

    // Voice message
    if (message.voice) {
      return {
        type: 'voice',
        userId,
        conversationId,
        messageId,
        payload: { 
          fileId: message.voice.file_id,
          duration: message.voice.duration,
        },
      };
    }

    // Text message
    if (message.text) {
      const text = message.text.trim();
      
      // UPC detection
      if (/^\d[\d-]{6,13}\d$/.test(text.replace(/-/g, ''))) {
        return {
          type: 'upc',
          userId,
          conversationId,
          messageId,
          payload: { upc: text.replace(/-/g, '') },
        };
      }

      // Slash command
      if (text.startsWith('/')) {
        return {
          type: 'command',
          userId,
          conversationId,
          messageId,
          payload: { command: text.slice(1).split(/\s+/)[0].toLowerCase() },
        };
      }

      // Regular text
      return {
        type: 'text',
        userId,
        conversationId,
        messageId,
        payload: { text },
      };
    }

    return null;
  }

  static #parseCallback(callbackQuery, config) {
    const message = callbackQuery.message;
    const userId = String(message?.chat?.id);
    const conversationId = this.#buildConversationId(config.botId, userId);

    return {
      type: 'callback',
      userId,
      conversationId,
      messageId: String(callbackQuery.id),
      payload: {
        data: callbackQuery.data,
        sourceMessageId: String(message?.message_id),
      },
    };
  }

  static #buildConversationId(botId, userId) {
    // New format: telegram:{botId}_{userId}
    return `telegram:${botId}_${userId}`;
  }
}
```

#### 4.2.3 Unified Event Router

```javascript
// backend/chatbots/application/routing/UnifiedEventRouter.mjs
export class UnifiedEventRouter {
  #container;
  #logger;

  constructor(container, options = {}) {
    this.#container = container;
    this.#logger = options.logger;
  }

  /**
   * Route an input event to the appropriate use case
   * @param {IInputEvent} event
   */
  async route(event) {
    const { type, userId, conversationId, messageId, payload } = event;

    switch (type) {
      case 'text':
        return this.#handleText(conversationId, payload.text, messageId);

      case 'image':
        return this.#handleImage(conversationId, payload.fileId, messageId);

      case 'voice':
        return this.#handleVoice(conversationId, payload.fileId, messageId);

      case 'upc':
        return this.#handleUPC(conversationId, payload.upc, messageId);

      case 'command':
        return this.#handleCommand(conversationId, payload.command, messageId);

      case 'callback':
        return this.#handleCallback(conversationId, payload.data, payload.sourceMessageId);

      default:
        this.#logger?.warn('router.unknownEventType', { type });
    }
  }

  async #handleText(conversationId, text, messageId) {
    // Check for revision state
    const stateStore = this.#container.getConversationStateStore();
    const state = await stateStore?.get(conversationId);

    if (state?.flow === 'revision' && state?.pendingLogUuid) {
      const useCase = this.#container.getProcessRevisionInput();
      return useCase.execute({
        userId: conversationId,
        conversationId,
        logUuid: state.pendingLogUuid,
        revisionText: text,
        messageId,
      });
    }

    const useCase = this.#container.getLogFoodFromText();
    return useCase.execute({
      userId: conversationId,
      conversationId,
      text,
      messageId,
    });
  }

  // ... other handlers follow same pattern
}
```

---

## 5. Configuration Design

### 5.1 Centralized Configuration Schema

Update `config.app.yml`:

```yaml
# Chatbot configurations
chatbots:
  # NutriBot configuration
  nutribot:
    # Telegram integration
    telegram:
      bot_id: 6898194425
      # Token loaded from secrets: TELEGRAM_NUTRIBOT_TOKEN
      webhook:
        dev: https://api-dev.kckern.net/chatbots/nutribot/webhook
        prod: https://daylightstation-api.kckern.net/chatbots/nutribot/webhook
    
    # User mappings (internal → telegram)
    users:
      default_user_id: 575596036
    
    # Data storage paths
    data:
      nutrilog_path: lifelog/nutribot/nutrilog
      nutrilist_path: lifelog/nutribot/nutrilist
    
    # Nutrition goals
    goals:
      calories: 2000
      protein: 150
      carbs: 200
      fat: 65
    
    # Report settings
    report:
      host: https://daylightstation-api.kckern.net
      timezone: America/Los_Angeles

  # Journalist configuration (for reference)
  journalist:
    telegram:
      bot_id: 580626020
      webhook:
        dev: https://api-dev.kckern.net/chatbots/journalist/webhook
        prod: https://daylightstation-api.kckern.net/chatbots/journalist/webhook
```

### 5.2 Configuration Provider

```javascript
// backend/chatbots/_lib/config/ConfigProvider.mjs
export class ConfigProvider {
  #appConfig;
  #secrets;

  constructor(appConfigPath, secretsPath) {
    this.#appConfig = yaml.load(fs.readFileSync(appConfigPath, 'utf8'));
    this.#secrets = yaml.load(fs.readFileSync(secretsPath, 'utf8'));
  }

  getNutribotConfig() {
    const config = this.#appConfig.chatbots?.nutribot || {};
    return {
      telegram: {
        botId: String(config.telegram?.bot_id),
        token: this.#secrets.TELEGRAM_NUTRIBOT_TOKEN,
        webhookUrl: process.env.NODE_ENV === 'production'
          ? config.telegram?.webhook?.prod
          : config.telegram?.webhook?.dev,
      },
      users: {
        defaultUserId: String(config.users?.default_user_id),
      },
      data: {
        nutrilogPath: config.data?.nutrilog_path,
        nutrilistPath: config.data?.nutrilist_path,
      },
      goals: config.goals || { calories: 2000, protein: 150 },
      report: {
        host: config.report?.host,
        timezone: config.report?.timezone || 'America/Los_Angeles',
      },
    };
  }

  getTelegramToken(botName) {
    const tokenKey = `TELEGRAM_${botName.toUpperCase()}_TOKEN`;
    return this.#secrets[tokenKey] || process.env[tokenKey];
  }
}
```

---

## 6. ID Mapping Strategy

### 6.1 Internal vs External IDs

| ID Type | Internal Format | Telegram Format | Legacy Format |
|---------|-----------------|-----------------|---------------|
| Conversation | `telegram:6898194425_575596036` | N/A | `b6898194425_u575596036` |
| User | `575596036` | `575596036` | Same |
| Message | `1234` | `1234` | Same |
| Bot | `nutribot` | `6898194425` | Same |

### 6.2 ID Conversion Utilities

```javascript
// backend/chatbots/_lib/ids/IdConverter.mjs
export class IdConverter {
  /**
   * Convert legacy chat_id format to new conversationId
   * Legacy: "b{botId}_u{userId}"
   * New: "telegram:{botId}_{userId}"
   */
  static legacyToConversationId(legacyChatId) {
    const match = legacyChatId.match(/^b(\d+)_u(\d+)$/);
    if (!match) throw new Error(`Invalid legacy chat_id: ${legacyChatId}`);
    return `telegram:${match[1]}_${match[2]}`;
  }

  /**
   * Convert conversationId to legacy format
   */
  static conversationIdToLegacy(conversationId) {
    const match = conversationId.match(/^telegram:(\d+)_(\d+)$/);
    if (!match) throw new Error(`Invalid conversationId: ${conversationId}`);
    return `b${match[1]}_u${match[2]}`;
  }

  /**
   * Extract userId from conversationId
   */
  static getUserId(conversationId) {
    // Handle both formats
    const telegramMatch = conversationId.match(/telegram:[\d]+_(\d+)/);
    if (telegramMatch) return telegramMatch[1];
    
    const legacyMatch = conversationId.match(/u(\d+)/);
    if (legacyMatch) return legacyMatch[1];
    
    // Plain userId
    return conversationId;
  }

  /**
   * Extract botId from conversationId
   */
  static getBotId(conversationId) {
    const telegramMatch = conversationId.match(/telegram:(\d+)_/);
    if (telegramMatch) return telegramMatch[1];
    
    const legacyMatch = conversationId.match(/^b(\d+)_/);
    if (legacyMatch) return legacyMatch[1];
    
    return null;
  }
}
```

### 6.3 Repository Compatibility

Update repositories to handle both ID formats during migration:

```javascript
// In NutriLogRepository
#getPath(userId) {
  // Handle conversationId format if passed
  const cleanUserId = IdConverter.getUserId(userId);
  return this.#config.getNutrilogPath(cleanUserId);
}
```

---

## 7. Webhook Integration

### 7.1 Webhook Handler Architecture

```javascript
// backend/chatbots/adapters/http/TelegramWebhookHandler.mjs
export function createTelegramWebhookHandler(container, config) {
  const router = new UnifiedEventRouter(container);
  const adapter = TelegramInputAdapter;

  return async (req, res) => {
    const traceId = req.traceId || uuidv4();
    
    try {
      // 1. Parse Telegram update into InputEvent
      const event = adapter.parse(req.body, config);
      
      if (!event) {
        return res.status(200).json({ ok: true, skipped: true });
      }

      // 2. Route to use case
      await router.route(event);

      // 3. Always return 200 to Telegram
      res.status(200).json({ ok: true });
    } catch (error) {
      console.error('webhook.error', { traceId, error: error.message });
      // Still return 200 to prevent retries
      res.status(200).json({ ok: true, error: error.message });
    }
  };
}
```

### 7.2 Webhook Registration

```javascript
// backend/chatbots/nutribot/setup.mjs
import { TelegramGateway } from '../infrastructure/messaging/TelegramGateway.mjs';

export async function setupNutribotTelegram(config) {
  // 1. Create gateway
  const gateway = new TelegramGateway({
    token: config.telegram.token,
    botId: config.telegram.botId,
  });

  // 2. Register webhook
  const webhookUrl = config.telegram.webhookUrl;
  const response = await fetch(
    `https://api.telegram.org/bot${config.telegram.token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`,
    { method: 'GET' }
  );
  
  const result = await response.json();
  console.log('Webhook registration:', result);

  return gateway;
}
```

### 7.3 Express Router Integration

```javascript
// backend/chatbots/nutribot/server.mjs (updated)
import { Router } from 'express';
import { createTelegramWebhookHandler } from '../adapters/http/TelegramWebhookHandler.mjs';

export function createNutribotRouter(container, config) {
  const router = Router();

  // Telegram webhook
  router.post(
    '/webhook',
    webhookValidationMiddleware('nutribot'),
    idempotencyMiddleware({ ttlMs: 300000 }),
    asyncHandler(createTelegramWebhookHandler(container, config))
  );

  // Report endpoints
  router.get('/report', asyncHandler(nutribotReportHandler(container)));
  router.get('/report.png', asyncHandler(nutribotReportImgHandler(container)));

  return router;
}
```

---

## 8. Implementation Plan

### Phase 1: Foundation (Week 1)

1. **Create `IInputEvent` interface and types** ✨
   - Define event types
   - Create TypeScript-style JSDoc definitions
   
2. **Implement `TelegramInputAdapter`** ✨
   - Parse webhook payloads
   - Build conversation IDs
   
3. **Create `IdConverter` utility** ✨
   - Legacy ↔ new format conversion
   - User/bot ID extraction

### Phase 2: Routing Unification (Week 2)

4. **Create `UnifiedEventRouter`** ✨
   - Extract routing logic from CLIChatSimulator
   - Merge with EventRouter patterns
   - Handle all event types

5. **Update `CLIChatSimulator`** to use `UnifiedEventRouter`
   - Replace inline routing with shared router
   - Verify all tests pass

### Phase 3: Configuration (Week 2-3)

6. **Create `ConfigProvider`** ✨
   - Load from config.app.yml
   - Merge with secrets
   - Environment-aware

7. **Update `config.app.yml`** with chatbot section
   - Document all config options
   - Add comments

### Phase 4: Gateway Integration (Week 3)

8. **Update `TelegramGateway`** 
   - Accept plain string IDs
   - Internal conversion to Telegram format
   - Remove ChatId value object dependency at boundary

9. **Create `TelegramWebhookHandler`**
   - Wire adapter → router → container
   - Error handling
   - Logging

### Phase 5: Testing & Migration (Week 4)

10. **Integration tests**
    - Mock Telegram payloads
    - Verify use case execution
    - Test ID conversions

11. **Parallel run with legacy**
    - Deploy new webhook alongside old
    - Compare results
    - Gradual cutover

---

## 9. Migration Strategy

### 9.1 Backward Compatibility

1. **Repository Dual-Format Support**
   - Accept both legacy `b{bot}_u{user}` and new `telegram:{bot}_{user}`
   - Store in new format
   - Convert on read if needed

2. **Environment Variable Fallback**
   ```javascript
   const token = config.getTelegramToken('nutribot') 
               || process.env.TELEGRAM_NUTRIBOT_TOKEN;
   ```

3. **Parallel Endpoints**
   ```
   /foodlog (legacy - keep for 2 weeks)
   /chatbots/nutribot/webhook (new)
   ```

### 9.2 Cutover Plan

| Day | Action |
|-----|--------|
| D+0 | Deploy new endpoint, keep both active |
| D+3 | Monitor error rates, compare outputs |
| D+7 | Switch webhook to new endpoint |
| D+14 | Remove legacy endpoint |
| D+21 | Clean up legacy code |

### 9.3 Rollback Plan

1. Update Telegram webhook to legacy URL
2. Disable new endpoint
3. Investigate and fix issues
4. Re-deploy

---

## Appendix A: File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `application/ports/IInputEvent.mjs` | Create | Input event interface |
| `adapters/telegram/TelegramInputAdapter.mjs` | Create | Telegram → InputEvent |
| `application/routing/UnifiedEventRouter.mjs` | Create | Shared routing logic |
| `_lib/config/ConfigProvider.mjs` | Create | Centralized config |
| `_lib/ids/IdConverter.mjs` | Create | ID format conversion |
| `adapters/http/TelegramWebhookHandler.mjs` | Create | Webhook handler factory |
| `infrastructure/messaging/TelegramGateway.mjs` | Update | Plain string ID support |
| `cli/CLIChatSimulator.mjs` | Update | Use UnifiedEventRouter |
| `nutribot/adapters/EventRouter.mjs` | Deprecate | Replace with unified |
| `nutribot/server.mjs` | Update | New handler wiring |
| `config.app.yml` | Update | Add chatbots section |

---

## Appendix B: Test Scenarios

### B.1 Unit Tests

1. `TelegramInputAdapter.parse()` with various webhook payloads
2. `IdConverter` format conversions
3. `UnifiedEventRouter` routing decisions

### B.2 Integration Tests

1. Text message → LogFoodFromText use case
2. Photo message → LogFoodFromImage use case
3. Callback query → AcceptFoodLog use case
4. UPC text → LogFoodFromUPC use case

### B.3 End-to-End Tests

1. Full flow: Send photo → Analyze → Accept → Report
2. Revision flow: Log → Revise → Confirm
3. UPC flow: Scan → Select portion → Confirm

---

## Appendix C: Open Questions

1. **Should we support Discord in Phase 1?**
   - Recommendation: No, but architecture should accommodate

2. **How to handle legacy data migration?**
   - Recommendation: Read both formats, write new format only

3. **Should UnifiedEventRouter be async or use event emitter pattern?**
   - Recommendation: Async/await for simplicity; consider events later if needed

---

*Document version: 1.0*
*Last updated: December 15, 2025*
