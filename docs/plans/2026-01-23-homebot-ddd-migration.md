# Homebot DDD Migration - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete homebot migration to DDD folder structure, consolidating partial migration and wiring shared adapters.

**Key Advantage:** Domain layer (`1_domains/gratitude/`) is already complete. Main work is application consolidation and adapter wiring.

**Shared Adapters:** Uses `TelegramAdapter` and `OpenAIAdapter` from `2_adapters/`.

---

## Phase 1: Port Interfaces

### Task 1.1: Create IConversationStateStore Port

**Files:**
- Create: `backend/src/3_applications/homebot/ports/IConversationStateStore.mjs`

**Step 1: Create ports directory if needed**

```bash
mkdir -p backend/src/3_applications/homebot/ports
```

**Step 2: Create the port interface**

Create `backend/src/3_applications/homebot/ports/IConversationStateStore.mjs`:
```javascript
// backend/src/3_applications/homebot/ports/IConversationStateStore.mjs

/**
 * Port interface for conversation state persistence
 * Used to store temporary UI flow state during multi-step interactions
 * @interface IConversationStateStore
 */
export const IConversationStateStore = {
  /**
   * Get state for a conversation/message
   * @param {string} conversationId
   * @param {string} [messageId]
   * @returns {Promise<Object|null>}
   */
  async get(conversationId, messageId) {},

  /**
   * Set state for a conversation/message
   * @param {string} conversationId
   * @param {string} messageId
   * @param {Object} state
   * @param {number} [ttlMs] - Time to live in milliseconds
   * @returns {Promise<void>}
   */
  async set(conversationId, messageId, state, ttlMs) {},

  /**
   * Delete state for a conversation/message
   * @param {string} conversationId
   * @param {string} [messageId]
   * @returns {Promise<boolean>}
   */
  async delete(conversationId, messageId) {},

  /**
   * Check if state exists
   * @param {string} conversationId
   * @param {string} [messageId]
   * @returns {Promise<boolean>}
   */
  async has(conversationId, messageId) {}
};

/**
 * Validate object implements IConversationStateStore
 * @param {Object} obj
 * @returns {boolean}
 */
export function isConversationStateStore(obj) {
  return (
    obj &&
    typeof obj.get === 'function' &&
    typeof obj.set === 'function' &&
    typeof obj.delete === 'function'
  );
}
```

**Step 3: Commit**

```bash
git add backend/src/3_applications/homebot/ports/
git commit -m "feat(homebot): add IConversationStateStore port interface"
```

---

### Task 1.2: Create IHouseholdRepository Port

**Files:**
- Create: `backend/src/3_applications/homebot/ports/IHouseholdRepository.mjs`
- Create: `backend/src/3_applications/homebot/ports/index.mjs`

**Step 1: Create the port interface**

Create `backend/src/3_applications/homebot/ports/IHouseholdRepository.mjs`:
```javascript
// backend/src/3_applications/homebot/ports/IHouseholdRepository.mjs

/**
 * Port interface for household data access
 * @interface IHouseholdRepository
 */
export const IHouseholdRepository = {
  /**
   * Get household members
   * @param {string} householdId
   * @returns {Promise<Array<{userId: string, displayName: string, group?: string}>>}
   */
  async getMembers(householdId) {},

  /**
   * Get display name for a user
   * @param {string} householdId
   * @param {string} userId
   * @returns {Promise<string>}
   */
  async getMemberDisplayName(householdId, userId) {},

  /**
   * Get household timezone
   * @param {string} householdId
   * @returns {Promise<string>}
   */
  async getTimezone(householdId) {},

  /**
   * Resolve household ID from conversation ID
   * @param {string} conversationId
   * @returns {Promise<string|null>}
   */
  async resolveHouseholdId(conversationId) {}
};

/**
 * Validate object implements IHouseholdRepository
 * @param {Object} obj
 * @returns {boolean}
 */
export function isHouseholdRepository(obj) {
  return (
    obj &&
    typeof obj.getMembers === 'function' &&
    typeof obj.getMemberDisplayName === 'function' &&
    typeof obj.getTimezone === 'function'
  );
}
```

**Step 2: Create ports barrel export**

Create `backend/src/3_applications/homebot/ports/index.mjs`:
```javascript
// backend/src/3_applications/homebot/ports/index.mjs
export { IConversationStateStore, isConversationStateStore } from './IConversationStateStore.mjs';
export { IHouseholdRepository, isHouseholdRepository } from './IHouseholdRepository.mjs';
```

**Step 3: Commit**

```bash
git add backend/src/3_applications/homebot/ports/
git commit -m "feat(homebot): add IHouseholdRepository port interface"
```

---

## Phase 2: Adapter Migration

### Task 2.1: Create HomeBotInputRouter Adapter

**Files:**
- Read: `backend/_legacy/chatbots/bots/homebot/adapters/HomeBotEventRouter.mjs`
- Read: `backend/src/3_applications/homebot/bot/HomeBotEventRouter.mjs`
- Create: `backend/src/2_adapters/homebot/HomeBotInputRouter.mjs`
- Create: `backend/src/2_adapters/homebot/index.mjs`

**Step 1: Create adapter directory**

```bash
mkdir -p backend/src/2_adapters/homebot
```

**Step 2: Consolidate event routers**

Review both legacy and new HomeBotEventRouter implementations. Create consolidated version at `backend/src/2_adapters/homebot/HomeBotInputRouter.mjs`:

```javascript
// backend/src/2_adapters/homebot/HomeBotInputRouter.mjs

/**
 * Routes normalized input events to homebot use cases
 * Follows same pattern as JournalistInputRouter
 */
export class HomeBotInputRouter {
  #container;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.container - HomeBotContainer
   * @param {Object} [config.logger]
   */
  constructor(config) {
    if (!config.container) {
      throw new Error('HomeBotInputRouter requires container');
    }
    this.#container = config.container;
    this.#logger = config.logger || console;
  }

  /**
   * Route input event to appropriate use case
   * @param {Object} event - Normalized input event
   * @returns {Promise<Object>}
   */
  async route(event) {
    this.#logger.debug?.('homebot.route', { type: event.type });

    switch (event.type) {
      case 'text':
        return this.#handleText(event);
      case 'voice':
        return this.#handleVoice(event);
      case 'callback':
        return this.#handleCallback(event);
      case 'command':
        return this.#handleCommand(event);
      default:
        this.#logger.warn?.('homebot.route.unknown', { type: event.type });
        return { handled: false };
    }
  }

  async #handleText(event) {
    const useCase = await this.#container.getProcessGratitudeInput();
    return useCase.execute({
      conversationId: event.conversationId,
      text: event.text,
      messageId: event.messageId
    });
  }

  async #handleVoice(event) {
    const useCase = await this.#container.getProcessGratitudeInput();
    return useCase.execute({
      conversationId: event.conversationId,
      voiceFileId: event.fileId,
      messageId: event.messageId
    });
  }

  async #handleCallback(event) {
    const data = event.callbackData;

    // Parse callback data format: "action:value"
    if (data.startsWith('user:')) {
      const username = data.slice(5);
      const useCase = await this.#container.getAssignItemToUser();
      return useCase.execute({
        conversationId: event.conversationId,
        messageId: event.messageId,
        username
      });
    }

    if (data.startsWith('category:')) {
      const category = data.slice(9);
      const useCase = await this.#container.getToggleCategory();
      return useCase.execute({
        conversationId: event.conversationId,
        messageId: event.messageId,
        category
      });
    }

    if (data === 'cancel') {
      const useCase = await this.#container.getCancelGratitudeInput();
      return useCase.execute({
        conversationId: event.conversationId,
        messageId: event.messageId
      });
    }

    this.#logger.warn?.('homebot.callback.unknown', { data });
    return { handled: false };
  }

  async #handleCommand(event) {
    // Homebot doesn't have many commands, but could add /gratitude, /hopes
    this.#logger.debug?.('homebot.command', { command: event.command });
    return { handled: false };
  }
}

export default HomeBotInputRouter;
```

**Step 3: Create adapter barrel export**

Create `backend/src/2_adapters/homebot/index.mjs`:
```javascript
// backend/src/2_adapters/homebot/index.mjs
export { HomeBotInputRouter } from './HomeBotInputRouter.mjs';
```

**Step 4: Commit**

```bash
git add backend/src/2_adapters/homebot/
git commit -m "feat(homebot): add HomeBotInputRouter adapter"
```

---

### Task 2.2: Create ConfigHouseholdAdapter

**Files:**
- Create: `backend/src/2_adapters/homebot/ConfigHouseholdAdapter.mjs`
- Modify: `backend/src/2_adapters/homebot/index.mjs`

**Step 1: Create adapter implementing IHouseholdRepository**

Create `backend/src/2_adapters/homebot/ConfigHouseholdAdapter.mjs`:
```javascript
// backend/src/2_adapters/homebot/ConfigHouseholdAdapter.mjs

/**
 * Adapter implementing IHouseholdRepository using ConfigService
 */
export class ConfigHouseholdAdapter {
  #configService;
  #userResolver;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.configService - ConfigService instance
   * @param {Object} [config.userResolver] - UserResolver for conversation ID mapping
   * @param {Object} [config.logger]
   */
  constructor(config) {
    if (!config.configService) {
      throw new Error('ConfigHouseholdAdapter requires configService');
    }
    this.#configService = config.configService;
    this.#userResolver = config.userResolver;
    this.#logger = config.logger || console;
  }

  async getMembers(householdId) {
    const config = this.#configService.getHouseholdConfig(householdId);
    const users = config?.users || {};

    return Object.entries(users).map(([userId, userData]) => ({
      userId,
      displayName: userData.display_name || userData.name || userId,
      group: userData.group || null
    }));
  }

  async getMemberDisplayName(householdId, userId) {
    const config = this.#configService.getHouseholdConfig(householdId);
    const user = config?.users?.[userId];
    return user?.display_name || user?.name || userId;
  }

  async getTimezone(householdId) {
    const config = this.#configService.getHouseholdConfig(householdId);
    return config?.timezone || 'America/Los_Angeles';
  }

  async resolveHouseholdId(conversationId) {
    if (this.#userResolver) {
      const username = await this.#userResolver.resolveUsername(conversationId);
      if (username) {
        return this.#configService.getHouseholdIdForUser(username);
      }
    }
    // Fallback to default household
    return this.#configService.getDefaultHouseholdId();
  }
}

export default ConfigHouseholdAdapter;
```

**Step 2: Update adapter index**

Edit `backend/src/2_adapters/homebot/index.mjs`:
```javascript
// backend/src/2_adapters/homebot/index.mjs
export { HomeBotInputRouter } from './HomeBotInputRouter.mjs';
export { ConfigHouseholdAdapter } from './ConfigHouseholdAdapter.mjs';
```

**Step 3: Commit**

```bash
git add backend/src/2_adapters/homebot/
git commit -m "feat(homebot): add ConfigHouseholdAdapter implementing IHouseholdRepository"
```

---

## Phase 3: Application Consolidation

### Task 3.1: Consolidate Use Cases

**Files:**
- Read: `backend/_legacy/chatbots/bots/homebot/application/usecases/*.mjs`
- Read: `backend/src/3_applications/homebot/usecases/*.mjs`
- Modify: `backend/src/3_applications/homebot/usecases/*.mjs` (update imports)
- Create: `backend/src/3_applications/homebot/usecases/index.mjs`

**Step 1: Review both use case locations**

Compare legacy and new use case implementations. The new versions should be kept and updated.

**Step 2: Update imports in each use case**

For each use case file, update imports:
```javascript
// Old (if referencing legacy):
import { GratitudeItem } from '../../../1_domains/gratitude/entities/GratitudeItem.mjs';

// New (use barrel export):
import { GratitudeItem, Selection } from '../../../1_domains/gratitude/index.mjs';
```

**Step 3: Create usecases barrel export**

Create `backend/src/3_applications/homebot/usecases/index.mjs`:
```javascript
// backend/src/3_applications/homebot/usecases/index.mjs
export { ProcessGratitudeInput } from './ProcessGratitudeInput.mjs';
export { AssignItemToUser } from './AssignItemToUser.mjs';
export { ToggleCategory } from './ToggleCategory.mjs';
export { CancelGratitudeInput } from './CancelGratitudeInput.mjs';
```

**Step 4: Commit**

```bash
git add backend/src/3_applications/homebot/usecases/
git commit -m "refactor(homebot): consolidate use cases with updated imports"
```

---

### Task 3.2: Update HomeBotContainer

**Files:**
- Modify: `backend/src/3_applications/homebot/HomeBotContainer.mjs`

**Step 1: Update container to use shared adapters**

Update `backend/src/3_applications/homebot/HomeBotContainer.mjs`:
```javascript
// backend/src/3_applications/homebot/HomeBotContainer.mjs

import { ProcessGratitudeInput } from './usecases/ProcessGratitudeInput.mjs';
import { AssignItemToUser } from './usecases/AssignItemToUser.mjs';
import { ToggleCategory } from './usecases/ToggleCategory.mjs';
import { CancelGratitudeInput } from './usecases/CancelGratitudeInput.mjs';

/**
 * Dependency injection container for HomeBot
 * Uses shared adapters from 2_adapters/
 */
export class HomeBotContainer {
  #messagingGateway;
  #aiGateway;
  #gratitudeStore;
  #conversationStateStore;
  #householdRepository;
  #websocketBroadcast;
  #logger;

  // Cached use cases
  #processGratitudeInput;
  #assignItemToUser;
  #toggleCategory;
  #cancelGratitudeInput;

  /**
   * @param {Object} config
   * @param {Object} config.messagingGateway - TelegramAdapter instance
   * @param {Object} config.aiGateway - OpenAIAdapter instance
   * @param {Object} config.gratitudeStore - YamlGratitudeStore instance
   * @param {Object} config.conversationStateStore - IConversationStateStore implementation
   * @param {Object} config.householdRepository - IHouseholdRepository implementation
   * @param {Function} [config.websocketBroadcast] - WebSocket broadcast function
   * @param {Object} [config.logger]
   */
  constructor(config) {
    this.#messagingGateway = config.messagingGateway;
    this.#aiGateway = config.aiGateway;
    this.#gratitudeStore = config.gratitudeStore;
    this.#conversationStateStore = config.conversationStateStore;
    this.#householdRepository = config.householdRepository;
    this.#websocketBroadcast = config.websocketBroadcast;
    this.#logger = config.logger || console;
  }

  async getProcessGratitudeInput() {
    if (!this.#processGratitudeInput) {
      this.#processGratitudeInput = new ProcessGratitudeInput({
        messagingGateway: this.#messagingGateway,
        aiGateway: this.#aiGateway,
        conversationStateStore: this.#conversationStateStore,
        householdRepository: this.#householdRepository,
        logger: this.#logger
      });
    }
    return this.#processGratitudeInput;
  }

  async getAssignItemToUser() {
    if (!this.#assignItemToUser) {
      this.#assignItemToUser = new AssignItemToUser({
        messagingGateway: this.#messagingGateway,
        gratitudeStore: this.#gratitudeStore,
        conversationStateStore: this.#conversationStateStore,
        householdRepository: this.#householdRepository,
        websocketBroadcast: this.#websocketBroadcast,
        logger: this.#logger
      });
    }
    return this.#assignItemToUser;
  }

  async getToggleCategory() {
    if (!this.#toggleCategory) {
      this.#toggleCategory = new ToggleCategory({
        messagingGateway: this.#messagingGateway,
        conversationStateStore: this.#conversationStateStore,
        householdRepository: this.#householdRepository,
        logger: this.#logger
      });
    }
    return this.#toggleCategory;
  }

  async getCancelGratitudeInput() {
    if (!this.#cancelGratitudeInput) {
      this.#cancelGratitudeInput = new CancelGratitudeInput({
        messagingGateway: this.#messagingGateway,
        conversationStateStore: this.#conversationStateStore,
        logger: this.#logger
      });
    }
    return this.#cancelGratitudeInput;
  }

  // Expose adapters for router/handler access
  getMessagingGateway() {
    return this.#messagingGateway;
  }
}

export default HomeBotContainer;
```

**Step 2: Commit**

```bash
git add backend/src/3_applications/homebot/HomeBotContainer.mjs
git commit -m "refactor(homebot): update container to use shared adapters"
```

---

### Task 3.3: Update Application Index

**Files:**
- Modify: `backend/src/3_applications/homebot/index.mjs`

**Step 1: Update barrel export**

Edit `backend/src/3_applications/homebot/index.mjs`:
```javascript
// backend/src/3_applications/homebot/index.mjs
export * from './ports/index.mjs';
export * from './usecases/index.mjs';
export { HomeBotContainer } from './HomeBotContainer.mjs';
```

**Step 2: Commit**

```bash
git add backend/src/3_applications/homebot/index.mjs
git commit -m "refactor(homebot): update application barrel export"
```

---

## Phase 4: API Router

### Task 4.1: Create Homebot Router

**Files:**
- Create: `backend/src/4_api/routers/homebot.mjs`

**Step 1: Create router following journalist pattern**

Create `backend/src/4_api/routers/homebot.mjs`:
```javascript
// backend/src/4_api/routers/homebot.mjs

import { Router } from 'express';
import { HomeBotInputRouter } from '../../2_adapters/homebot/HomeBotInputRouter.mjs';

/**
 * Async handler wrapper
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Create Homebot Express Router
 * @param {import('../../3_applications/homebot/HomeBotContainer.mjs').HomeBotContainer} container
 * @param {Object} [options]
 * @param {string} [options.botId] - Telegram bot ID
 * @param {Object} [options.gateway] - TelegramAdapter for callback acknowledgements
 * @param {Function} [options.createTelegramWebhookHandler] - Webhook handler factory
 * @param {Object} [options.middleware] - Middleware functions
 * @returns {Router}
 */
export function createHomebotRouter(container, options = {}) {
  const router = Router();

  const {
    botId,
    gateway,
    createTelegramWebhookHandler,
    middleware = {}
  } = options;

  // Get middleware functions with defaults
  const {
    tracingMiddleware = () => (req, res, next) => next(),
    requestLoggerMiddleware = () => (req, res, next) => next(),
    webhookValidationMiddleware = () => (req, res, next) => next(),
    idempotencyMiddleware = () => (req, res, next) => next(),
    errorHandlerMiddleware = () => (err, req, res, next) => {
      res.status(500).json({ error: err.message });
    }
  } = middleware;

  // Apply middleware
  router.use(tracingMiddleware());
  router.use(requestLoggerMiddleware({ logBody: false }));

  // Webhook endpoint
  if (createTelegramWebhookHandler) {
    const webhookHandler = createTelegramWebhookHandler(
      container,
      { botId, botName: 'homebot' },
      {
        gateway,
        RouterClass: HomeBotInputRouter
      }
    );

    router.post(
      '/webhook',
      webhookValidationMiddleware('homebot'),
      idempotencyMiddleware({ ttlMs: 300000 }),
      asyncHandler(webhookHandler)
    );
  }

  // Health check endpoint
  router.get('/health', (req, res) => {
    res.json({ status: 'ok', bot: 'homebot' });
  });

  // Apply error handler
  router.use(errorHandlerMiddleware({ isWebhook: false }));

  return router;
}

export default createHomebotRouter;
```

**Step 2: Commit**

```bash
git add backend/src/4_api/routers/homebot.mjs
git commit -m "feat(homebot): add API router following journalist pattern"
```

---

### Task 4.2: Create Homebot Handler

**Files:**
- Create: `backend/src/4_api/handlers/homebot/index.mjs`

**Step 1: Create handlers directory and index**

```bash
mkdir -p backend/src/4_api/handlers/homebot
```

Create `backend/src/4_api/handlers/homebot/index.mjs`:
```javascript
// backend/src/4_api/handlers/homebot/index.mjs

/**
 * Create webhook handler for homebot
 * @param {Object} container - HomeBotContainer
 * @param {Object} options
 * @param {string} options.botId
 * @param {string} options.botName
 * @param {Object} deps
 * @param {Object} deps.gateway - TelegramAdapter
 * @param {Function} deps.RouterClass - HomeBotInputRouter class
 * @returns {Function} Express handler
 */
export function createHomebotWebhookHandler(container, options, deps) {
  const { botId, botName } = options;
  const { gateway, RouterClass } = deps;

  const inputRouter = new RouterClass({
    container,
    logger: console
  });

  return async (req, res) => {
    try {
      const update = req.body;

      // Parse Telegram update
      const parsed = gateway.parseUpdate(update);
      if (!parsed) {
        return res.sendStatus(200);
      }

      // Normalize to input event
      const event = {
        type: parsed.type,
        conversationId: parsed.chatId,
        messageId: parsed.messageId,
        text: parsed.content,
        fileId: parsed.raw?.voice?.file_id || parsed.raw?.photo?.[0]?.file_id,
        callbackData: parsed.type === 'callback' ? parsed.content : null,
        callbackId: parsed.raw?.id
      };

      // Acknowledge callback immediately
      if (event.callbackId) {
        await gateway.answerCallbackQuery(event.callbackId);
      }

      // Route to use case
      await inputRouter.route(event);

      res.sendStatus(200);
    } catch (error) {
      console.error('homebot.webhook.error', error);
      res.sendStatus(200); // Always 200 to Telegram
    }
  };
}

export default createHomebotWebhookHandler;
```

**Step 2: Commit**

```bash
git add backend/src/4_api/handlers/homebot/
git commit -m "feat(homebot): add webhook handler"
```

---

## Phase 5: Verification & Cleanup

### Task 5.1: Run Tests

**Step 1: Run homebot tests**

```bash
npm test -- --grep homebot
```

**Step 2: Fix any failing tests**

Update test imports if they reference legacy paths.

**Step 3: Commit fixes**

```bash
git add .
git commit -m "test(homebot): update tests for new DDD structure"
```

---

### Task 5.2: Document Legacy for Deletion

**Step 1: Verify all functionality works**

- [ ] Text input for gratitude
- [ ] Voice input for gratitude
- [ ] Category toggle (gratitude ↔ hopes)
- [ ] Member assignment buttons
- [ ] Cancel flow
- [ ] WebSocket broadcast to gratitude wall

**Step 2: Create deletion manifest**

Document files to delete after confidence period:
- `backend/_legacy/chatbots/bots/homebot/` (entire directory)
- Related imports in `backend/_legacy/api.mjs`

**Step 3: Final commit**

```bash
git add .
git commit -m "docs(homebot): complete DDD migration - ready for legacy cleanup"
```

---

## Summary

**Total Tasks:** 11 tasks across 5 phases

**Files Created:**
- `3_applications/homebot/ports/IConversationStateStore.mjs`
- `3_applications/homebot/ports/IHouseholdRepository.mjs`
- `2_adapters/homebot/HomeBotInputRouter.mjs`
- `2_adapters/homebot/ConfigHouseholdAdapter.mjs`
- `4_api/routers/homebot.mjs`
- `4_api/handlers/homebot/index.mjs`

**Files Modified:**
- `3_applications/homebot/usecases/*.mjs` (import updates)
- `3_applications/homebot/HomeBotContainer.mjs` (shared adapter wiring)
- `3_applications/homebot/index.mjs` (barrel export)

**Already Complete (no changes needed):**
- `1_domains/gratitude/` - Domain layer
- `2_adapters/persistence/yaml/YamlGratitudeStore.mjs` - Persistence adapter

**Shared Adapters Used:**
- `2_adapters/messaging/TelegramAdapter.mjs`
- `2_adapters/ai/OpenAIAdapter.mjs`

**Key Patterns:**
- Port interfaces for dependency inversion
- Adapter classes wrapping external services
- Container for dependency injection
- Router + Handler pattern for API endpoints
- Barrel exports at each level
