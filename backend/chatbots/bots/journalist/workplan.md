# Journalist Bot - Framework Conformity Workplan

## Executive Summary

The Journalist bot currently has its own `JournalistEventRouter` and `journalistWebhookHandler` that duplicate the unified patterns we've established for NutriBot. This workplan details how to migrate Journalist to use the shared infrastructure:

1. **TelegramInputAdapter** - Platform-specific parsing → IInputEvent  
2. **createTelegramWebhookHandler** - Unified HTTP handler factory
3. **UnifiedEventRouter** (or JournalistUnifiedRouter) - Routes IInputEvent → Use Cases

---

## Current State Analysis

### What Journalist Has (Duplicated)

| Component | Location | Issue |
|-----------|----------|-------|
| `JournalistEventRouter` | `journalist/adapters/EventRouter.mjs` | Duplicates Telegram parsing + routing |
| `journalistWebhookHandler` | `journalist/handlers/webhook.mjs` | Duplicates webhook handling pattern |
| Direct Telegram parsing | In EventRouter | Should use `TelegramInputAdapter` |

### What NutriBot Uses (Target Pattern)

| Component | Location | Purpose |
|-----------|----------|---------|
| `TelegramInputAdapter` | `adapters/telegram/TelegramInputAdapter.mjs` | Parse Telegram → IInputEvent |
| `createTelegramWebhookHandler` | `adapters/http/TelegramWebhookHandler.mjs` | Factory for webhook handlers |
| `UnifiedEventRouter` | `application/routing/UnifiedEventRouter.mjs` | Route IInputEvent → Use Cases |
| `IInputEvent` | `application/ports/IInputEvent.mjs` | Platform-agnostic event interface |

---

## Architecture Comparison

### Current Journalist Flow
```
Telegram Update 
    → journalistWebhookHandler() 
    → JournalistEventRouter.route(rawUpdate) 
    → #routeMessage/#routeCallback (parses Telegram-specific fields)
    → Use Case
```

### Target Flow (NutriBot Pattern)
```
Telegram Update 
    → createTelegramWebhookHandler(container, config) 
    → TelegramInputAdapter.parse(update, config) → IInputEvent
    → UnifiedEventRouter.route(event)  [or JournalistEventRouter.route(event)]
    → Use Case
```

---

## Migration Plan

### Phase 1: Update server.mjs to Use Unified Webhook Handler

**File:** `journalist/server.mjs`

**Changes:**
1. Replace `journalistWebhookHandler` import with `createTelegramWebhookHandler`
2. Configure botId for Journalist (from env/config)
3. Use the unified handler factory

**Before:**
```javascript
import { journalistWebhookHandler } from './handlers/webhook.mjs';

router.post(
  '/webhook',
  webhookValidationMiddleware('journalist'),
  idempotencyMiddleware({ ttlMs: 300000 }),
  asyncHandler(journalistWebhookHandler(container))
);
```

**After:**
```javascript
import { createTelegramWebhookHandler } from '../adapters/http/TelegramWebhookHandler.mjs';

const botId = options.botId 
  || container.getConfig?.()?.telegram?.botId 
  || process.env.JOURNALIST_TELEGRAM_BOT_ID;

const webhookHandler = createTelegramWebhookHandler(
  container,
  { botId, botName: 'journalist' },
  { gateway: options.gateway }
);

router.post(
  '/webhook',
  webhookValidationMiddleware('journalist'),
  idempotencyMiddleware({ ttlMs: 300000 }),
  asyncHandler(webhookHandler)
);
```

---

### Phase 2: Create JournalistEventRouter (IInputEvent-based)

**Option A: Extend UnifiedEventRouter** (if patterns are similar)  
**Option B: Create JournalistEventRouter** (if routing logic differs significantly)

Given Journalist's unique flow (quiz, multiple-choice, voice journaling), **Option B is recommended**.

**File:** `journalist/adapters/JournalistInputRouter.mjs` (new file)

```javascript
/**
 * Journalist Event Router
 * Routes platform-agnostic IInputEvents to Journalist use cases.
 */
import { createLogger } from '../../_lib/logging/index.mjs';
import { InputEventType } from '../../application/ports/IInputEvent.mjs';

export class JournalistInputRouter {
  #container;
  #logger;

  constructor(container, options = {}) {
    if (!container) throw new Error('container is required');
    this.#container = container;
    this.#logger = options.logger || createLogger({ source: 'router', app: 'journalist' });
  }

  /**
   * Route an IInputEvent to the appropriate use case
   * @param {import('../../application/ports/IInputEvent.mjs').IInputEvent} event
   */
  async route(event) {
    const { type, userId, conversationId, messageId, payload, metadata } = event;

    this.#logger.debug('router.event', { type, conversationId, messageId });

    try {
      switch (type) {
        case InputEventType.TEXT:
          return this.#handleText(conversationId, payload, messageId, metadata);

        case InputEventType.VOICE:
          return this.#handleVoice(conversationId, payload, messageId, metadata);

        case InputEventType.COMMAND:
          return this.#handleCommand(conversationId, payload, messageId);

        case InputEventType.CALLBACK:
          return this.#handleCallback(conversationId, payload, messageId, metadata);

        default:
          this.#logger.warn('router.unknownEventType', { type });
          return null;
      }
    } catch (error) {
      this.#logger.error('router.error', { type, conversationId, error: error.message });
      throw error;
    }
  }

  // ... handler methods (see detailed implementation below)
}
```

---

### Phase 3: Refactor Handler Methods

Map current `JournalistEventRouter` methods to the new IInputEvent-based pattern:

| Current Method | Event Type | New Handler |
|----------------|------------|-------------|
| `#handleText(chatId, text, messageId, from)` | `InputEventType.TEXT` | `#handleText(conversationId, payload, messageId, metadata)` |
| `#handleVoice(chatId, voice, messageId, from)` | `InputEventType.VOICE` | `#handleVoice(conversationId, payload, messageId, metadata)` |
| `#handleCallback(chatId, messageId, data, message, from)` | `InputEventType.CALLBACK` | `#handleCallback(conversationId, payload, messageId, metadata)` |
| Special start check (`🎲`, `❌`) | Within TEXT handler | Check `payload.text` in `#handleText` |
| Slash command check | `InputEventType.COMMAND` | `#handleCommand` |

**Key Mapping Changes:**

| Old Parameter | New Source |
|---------------|------------|
| `chatId` | `event.conversationId` |
| `from.id` | `event.userId` or `event.metadata.senderId` |
| `from.first_name` | `event.metadata.firstName` |
| `message.voice.file_id` | `event.payload.fileId` |
| `callback_query.data` | `event.payload.data` |
| `callback_query.message.message_id` | `event.payload.sourceMessageId` |

---

### Phase 4: Update TelegramInputAdapter (if needed)

The shared `TelegramInputAdapter` already handles:
- ✅ Text messages
- ✅ Voice messages  
- ✅ Slash commands
- ✅ Callback queries
- ✅ Photos/Images

**May need to add:**
- Special start detection (`🎲`, `❌`) - Currently done in use case, but could be event type
- OR keep special start detection in the router (simpler)

**Recommendation:** Keep special start detection in the router/use case layer since it's business logic specific to Journalist.

---

### Phase 5: Update Container for Router Integration

The `UnifiedEventRouter` expects certain container methods. Ensure `JournalistContainer` provides equivalent methods or create a wrapper.

**Current container methods (good):**
- `getProcessTextEntry()`
- `getProcessVoiceEntry()`
- `getHandleCallbackResponse()`
- `getHandleSlashCommand()`
- `getHandleSpecialStart()`

**May need to add wrapper in TelegramWebhookHandler:**

The `createTelegramWebhookHandler` uses `UnifiedEventRouter` internally. We need to either:

**Option A:** Make `createTelegramWebhookHandler` accept a custom router
```javascript
export function createTelegramWebhookHandler(container, config, options = {}) {
  const router = options.router || new UnifiedEventRouter(container, { logger });
  // ...
}
```

**Option B:** Create `createJournalistWebhookHandler` that uses `JournalistInputRouter`

**Recommendation:** Option A - add router injection to the existing factory.

---

### Phase 6: Delete Deprecated Files

Once migration is complete and tested:

| File | Action |
|------|--------|
| `journalist/handlers/webhook.mjs` | DELETE |
| `journalist/adapters/EventRouter.mjs` | DELETE (replaced by JournalistInputRouter) |
| `journalist/handlers/index.mjs` | UPDATE (remove webhook export) |

---

## Detailed Implementation Steps

### Step 1: Modify `createTelegramWebhookHandler` to Accept Custom Router

**File:** `adapters/http/TelegramWebhookHandler.mjs`

```javascript
export function createTelegramWebhookHandler(container, config, options = {}) {
  // ...
  
  // Allow custom router injection
  const RouterClass = options.RouterClass || UnifiedEventRouter;
  const router = new RouterClass(container, { logger });
  
  // ... rest unchanged
}
```

### Step 2: Create `JournalistInputRouter`

**File:** `journalist/adapters/JournalistInputRouter.mjs`

```javascript
import { createLogger } from '../../_lib/logging/index.mjs';
import { InputEventType } from '../../application/ports/IInputEvent.mjs';
import { HandleSpecialStart } from '../application/usecases/HandleSpecialStart.mjs';

export class JournalistInputRouter {
  #container;
  #logger;

  constructor(container, options = {}) {
    if (!container) throw new Error('container is required');
    this.#container = container;
    this.#logger = options.logger || createLogger({ source: 'router', app: 'journalist' });
  }

  async route(event) {
    const { type, conversationId, messageId, payload, metadata } = event;
    this.#logger.debug('router.event', { type, conversationId, messageId });

    switch (type) {
      case InputEventType.TEXT:
        return this.#handleText(conversationId, payload.text, messageId, metadata);

      case InputEventType.VOICE:
        return this.#handleVoice(conversationId, payload, messageId, metadata);

      case InputEventType.COMMAND:
        return this.#handleCommand(conversationId, payload.command, payload.args);

      case InputEventType.CALLBACK:
        return this.#handleCallback(conversationId, payload, messageId, metadata);

      default:
        this.#logger.warn('router.unknownEventType', { type });
        return null;
    }
  }

  async #handleText(conversationId, text, messageId, metadata) {
    // Check for special starts (🎲, ❌)
    if (HandleSpecialStart.isSpecialStart(text)) {
      const useCase = this.#container.getHandleSpecialStart?.();
      if (useCase) {
        return useCase.execute({ chatId: conversationId, messageId, text });
      }
    }

    // Regular text entry
    const useCase = this.#container.getProcessTextEntry();
    return useCase.execute({
      chatId: conversationId,
      text,
      messageId,
      senderId: metadata?.senderId || String(metadata?.userId || 'unknown'),
      senderName: metadata?.firstName || metadata?.username || 'User',
    });
  }

  async #handleVoice(conversationId, payload, messageId, metadata) {
    const useCase = this.#container.getProcessVoiceEntry();
    return useCase.execute({
      chatId: conversationId,
      voiceFileId: payload.fileId,
      messageId,
      senderId: metadata?.senderId || String(metadata?.userId || 'unknown'),
      senderName: metadata?.firstName || metadata?.username || 'User',
    });
  }

  async #handleCommand(conversationId, command, args) {
    const useCase = this.#container.getHandleSlashCommand?.();
    if (useCase) {
      return useCase.execute({ chatId: conversationId, command: `/${command}` });
    }
  }

  async #handleCallback(conversationId, payload, messageId, metadata) {
    const useCase = this.#container.getHandleCallbackResponse();
    return useCase.execute({
      chatId: conversationId,
      messageId: payload.sourceMessageId,
      callbackData: payload.data,
      options: {
        senderId: metadata?.senderId || String(metadata?.userId || 'unknown'),
        senderName: metadata?.firstName || metadata?.username || 'User',
        foreignKey: null, // Can be extracted from metadata if needed
      },
    });
  }
}
```

### Step 3: Update `journalist/server.mjs`

```javascript
import { Router } from 'express';
import { 
  tracingMiddleware,
  webhookValidationMiddleware,
  idempotencyMiddleware,
  errorHandlerMiddleware,
  requestLoggerMiddleware,
  asyncHandler,
} from '../adapters/http/middleware/index.mjs';
import { createTelegramWebhookHandler } from '../adapters/http/TelegramWebhookHandler.mjs';
import { JournalistInputRouter } from './adapters/JournalistInputRouter.mjs';
import { journalistJournalHandler } from './handlers/journal.mjs';
import { journalistTriggerHandler } from './handlers/trigger.mjs';

export function createJournalistRouter(container, options = {}) {
  const router = Router();

  const botId = options.botId 
    || container.getConfig?.()?.telegram?.botId 
    || process.env.JOURNALIST_TELEGRAM_BOT_ID;

  const webhookHandler = createTelegramWebhookHandler(
    container,
    { botId, botName: 'journalist' },
    { 
      gateway: options.gateway,
      RouterClass: JournalistInputRouter,  // Use Journalist-specific router
    }
  );

  router.use(tracingMiddleware());
  router.use(requestLoggerMiddleware({ logBody: false }));

  router.post(
    '/webhook',
    webhookValidationMiddleware('journalist'),
    idempotencyMiddleware({ ttlMs: 300000 }),
    asyncHandler(webhookHandler)
  );

  router.get('/journal', asyncHandler(journalistJournalHandler(container)));
  router.get('/trigger', asyncHandler(journalistTriggerHandler(container)));

  router.use(errorHandlerMiddleware({ isWebhook: false }));

  return router;
}
```

### Step 4: Update Tests

Update existing tests to use the new pattern:

```javascript
// Example test structure
import { TelegramInputAdapter } from '../../adapters/telegram/TelegramInputAdapter.mjs';
import { JournalistInputRouter } from '../adapters/JournalistInputRouter.mjs';

describe('JournalistInputRouter', () => {
  it('should route text events to ProcessTextEntry', async () => {
    const mockContainer = {
      getProcessTextEntry: () => ({ execute: jest.fn() }),
    };
    const router = new JournalistInputRouter(mockContainer);
    
    const event = TelegramInputAdapter.parse({
      update_id: 123,
      message: { chat: { id: 456 }, text: 'Hello diary', message_id: 1 }
    }, { botId: '123' });
    
    await router.route(event);
    expect(mockContainer.getProcessTextEntry().execute).toHaveBeenCalled();
  });
});
```

---

## Migration Checklist

### Pre-Migration
- [x] Backup current EventRouter.mjs → `EventRouter.mjs.bak`
- [x] Document current behavior with integration tests (see below)
- [x] Identify all use cases invoked by EventRouter (see below)

---

## Pre-Migration Documentation

### Use Cases Invoked by Current EventRouter

| Event Type | Condition | Use Case | Container Method | Input Shape |
|------------|-----------|----------|------------------|-------------|
| **Text** | `HandleSpecialStart.isSpecialStart(text)` | `HandleSpecialStart` | `getHandleSpecialStart()` | `{ chatId, messageId, text }` |
| **Text** | `text.startsWith('/')` | `HandleSlashCommand` | `getHandleSlashCommand()` | `{ chatId, command: text }` |
| **Text** | (default) | `ProcessTextEntry` | `getProcessTextEntry()` | `{ chatId, text, messageId, senderId, senderName }` |
| **Voice** | `message.voice` | `ProcessVoiceEntry` | `getProcessVoiceEntry()` | `{ chatId, voiceFileId, messageId, senderId, senderName }` |
| **Callback** | `callback_query` | `HandleCallbackResponse` | `getHandleCallbackResponse()` | `{ chatId, messageId, callbackData, options: { senderId, senderName, foreignKey } }` |
| **Edited** | `edited_message` | (ignored) | - | - |

### Parameter Mapping (Old → New)

| Old Parameter | Source | New IInputEvent Field |
|---------------|--------|----------------------|
| `chatId` | `message.chat.id` | `event.conversationId` |
| `messageId` | `message.message_id` | `event.messageId` |
| `text` | `message.text` | `event.payload.text` |
| `voiceFileId` | `message.voice.file_id` | `event.payload.fileId` |
| `senderId` | `from.id` | `event.userId` or `event.metadata.senderId` |
| `senderName` | `from.first_name \|\| from.username` | `event.metadata.firstName \|\| event.metadata.username` |
| `callbackData` | `callback_query.data` | `event.payload.data` |
| `callback messageId` | `callback_query.message.message_id` | `event.payload.sourceMessageId` |

### Existing Test Coverage

| Test File | Coverage |
|-----------|----------|
| `_tests/journalist/integration/JournalingFlow.test.mjs` | Text entry flow, AI follow-up questions |
| `_tests/journalist/usecases.test.mjs` | Individual use case unit tests |
| `_tests/journalist/Commands.test.mjs` | Slash command handling |
| `_tests/journalist/QuizFlow.test.mjs` | Quiz callbacks |
| `_tests/journalist/services.test.mjs` | Domain services |

---

### Phase 1: Infrastructure
- [x] Add `RouterClass` option to `createTelegramWebhookHandler`
- [x] Create `JournalistInputRouter.mjs`
- [x] Ensure container methods match router expectations
- [x] Create tests for `JournalistInputRouter` (12 tests passing)

### Phase 2: Integration  
- [x] Update `journalist/server.mjs` to use new pattern
- [x] Add `JOURNALIST_TELEGRAM_BOT_ID` fallback to environment
- [x] All 147 journalist tests passing

### Phase 3: Testing
- [x] Update unit tests for JournalistInputRouter (12 tests)
- [x] All journalist tests pass (147 total)
- [x] Integration test coverage via existing test suite
- [ ] Manual end-to-end testing with live Telegram bot (optional - requires bot token)

### Phase 4: Cleanup
- [x] Delete `journalist/handlers/webhook.mjs`
- [x] Delete `journalist/adapters/EventRouter.mjs`
- [x] Delete `journalist/adapters/EventRouter.mjs.bak`
- [x] Update `journalist/handlers/index.mjs` (removed webhook export)
- [x] Delete pre-migration test `EventRouter.test.mjs`
- [x] All 135 tests passing

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Different chatId format | Use `conversationId` consistently (format: `telegram:{botId}_{userId}`) |
| Missing metadata in use cases | Map `event.metadata` to expected `from` object properties |
| Voice file handling | Ensure `payload.fileId` maps correctly to use case input |
| Special start detection | Keep in router layer, not input adapter |

---

## Timeline Estimate

| Phase | Effort | Dependencies |
|-------|--------|--------------|
| Phase 1: TelegramWebhookHandler update | 1 hour | None |
| Phase 2: JournalistInputRouter | 2 hours | Phase 1 |
| Phase 3: server.mjs update | 30 min | Phase 2 |
| Phase 4: Testing | 2 hours | Phase 3 |
| Phase 5: Cleanup | 30 min | Phase 4 |
| **Total** | **~6 hours** | |

---

## Success Criteria

1. All Journalist webhook traffic uses `createTelegramWebhookHandler`
2. All Telegram parsing uses shared `TelegramInputAdapter`
3. `JournalistEventRouter` (old) is deleted
4. `journalistWebhookHandler` is deleted
5. All existing tests pass
6. Manual testing confirms: text, voice, callbacks, commands, special starts work
