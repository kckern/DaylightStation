# HomeBot + Gratitude App Implementation Guide

## Overview

This document provides detailed implementation instructions for the HomeBot chatbot and its Gratitude input feature. It is a companion to [Design.md](Design.md) and should be followed during development.

---

## 1. Key Design Principles

### 1.1 Clean Architecture (Mandatory)

Follow the established chatbots framework pattern:

```
┌─────────────────────────────────────────────────────────────┐
│                      PRESENTATION LAYER                      │
│  server.mjs, handlers/, TelegramWebhookHandler               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      APPLICATION LAYER                       │
│  usecases/, ports/ (interfaces)                              │
│  - No direct dependencies on infrastructure                  │
│  - Depends only on domain and port interfaces                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        DOMAIN LAYER                          │
│  domain/ - Entities, Value Objects, Domain Services          │
│  - Zero external dependencies                                │
│  - Pure business logic                                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    INFRASTRUCTURE LAYER                      │
│  repositories/, shared infrastructure/                       │
│  - Implements port interfaces                                │
│  - External service integrations                             │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Dependency Injection

**DO:**
```javascript
// Use case receives dependencies via constructor
export class ProcessGratitudeInput {
  #messagingGateway;
  #aiGateway;
  #gratitudeRepository;
  #householdRepository;
  #conversationStateStore;
  #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    if (!deps.aiGateway) throw new Error('aiGateway is required');
    // ... validate all required deps
    
    this.#messagingGateway = deps.messagingGateway;
    this.#aiGateway = deps.aiGateway;
    // ...
  }
}
```

**DON'T:**
```javascript
// Never import infrastructure directly in use cases
import { TelegramGateway } from '../../../infrastructure/...'; // ❌ WRONG
```

### 1.3 Container Pattern

All wiring happens in `container.mjs`:

```javascript
export class HomeBotContainer {
  // Infrastructure (injected)
  #messagingGateway;
  #aiGateway;
  // ...

  // Use cases (lazy-loaded)
  #processGratitudeInput;
  #assignItemToUser;
  // ...

  constructor(config, options = {}) {
    this.#config = config;
    this.#messagingGateway = options.messagingGateway;
    this.#aiGateway = options.aiGateway;
    // ...
  }

  // Lazy getter pattern
  get processGratitudeInput() {
    if (!this.#processGratitudeInput) {
      this.#processGratitudeInput = new ProcessGratitudeInput({
        messagingGateway: this.#messagingGateway,
        aiGateway: this.#aiGateway,
        gratitudeRepository: this.gratitudeRepository,
        householdRepository: this.householdRepository,
        conversationStateStore: this.#conversationStateStore,
        config: this.#config,
        logger: this.#logger,
      });
    }
    return this.#processGratitudeInput;
  }
}
```

### 1.4 Conversation State Management

Use the shared `FileConversationStateStore` for tracking multi-step flows:

```javascript
// State structure for gratitude input flow
{
  activeFlow: 'gratitude_input',
  flowState: {
    items: ['Sunny Weather', 'Good Coffee'],
    category: 'gratitude',  // or 'hopes'
    originalMessageId: null,
    confirmationMessageId: '12345',
  },
  lastUpdated: 1703012345678
}
```

### 1.5 Error Handling

**Always:**
- Catch and log errors with context
- Send user-friendly error messages via Telegram
- Never expose stack traces to users
- Use structured logging

```javascript
try {
  await this.#processItems(input);
} catch (error) {
  this.#logger.error('gratitude.process.failed', {
    conversationId,
    error: error.message,
    stack: error.stack,
  });
  
  await this.#messagingGateway.sendMessage(conversationId, {
    text: '❌ Sorry, something went wrong. Please try again.',
  });
}
```

---

## 2. Implementation Phases

### Phase 1: HomeBot Skeleton

#### 1.1 Create Folder Structure

```bash
mkdir -p backend/chatbots/bots/homebot/{application/{ports,usecases},domain,config,handlers,repositories}
```

#### 1.2 Create `container.mjs`

Reference: `backend/chatbots/bots/nutribot/container.mjs`

```javascript
/**
 * HomeBot Dependency Injection Container
 * @module homebot/container
 */

import { createLogger } from '../../_lib/logging/index.mjs';

// Use Cases
import { ProcessGratitudeInput } from './application/usecases/ProcessGratitudeInput.mjs';
import { AssignItemToUser } from './application/usecases/AssignItemToUser.mjs';
import { ToggleCategory } from './application/usecases/ToggleCategory.mjs';
import { CancelGratitudeInput } from './application/usecases/CancelGratitudeInput.mjs';

export class HomeBotContainer {
  #config;
  #options;
  #logger;
  
  // Infrastructure (injected)
  #messagingGateway;
  #aiGateway;
  #conversationStateStore;
  
  // Repositories (lazy)
  #gratitudeRepository;
  #householdRepository;

  // Use Cases (lazy)
  #processGratitudeInput;
  #assignItemToUser;
  #toggleCategory;
  #cancelGratitudeInput;

  constructor(config, options = {}) {
    this.#config = config;
    this.#options = options;
    this.#logger = options.logger || createLogger({ source: 'container', app: 'homebot' });
    
    // Injected infrastructure
    this.#messagingGateway = options.messagingGateway;
    this.#aiGateway = options.aiGateway;
    this.#conversationStateStore = options.conversationStateStore;
  }

  getConfig() {
    return this.#config;
  }

  // ... implement lazy getters for all use cases
}

export default HomeBotContainer;
```

#### 1.3 Create `server.mjs`

Reference: `backend/chatbots/bots/nutribot/server.mjs`

```javascript
/**
 * HomeBot Server/Router
 * @module homebot/server
 */

import { Router } from 'express';
import { 
  tracingMiddleware,
  webhookValidationMiddleware,
  idempotencyMiddleware,
  errorHandlerMiddleware,
  requestLoggerMiddleware,
  asyncHandler,
} from '../../adapters/http/middleware/index.mjs';
import { createTelegramWebhookHandler } from '../../adapters/http/TelegramWebhookHandler.mjs';
import { HomeBotInputRouter } from './adapters/HomeBotInputRouter.mjs';

export function createHomeBotRouter(container, options = {}) {
  const router = Router();

  const botId = options.botId 
    || container.getConfig?.()?.telegram?.botId 
    || process.env.HOMEBOT_TELEGRAM_BOT_ID;

  // Create input router for routing events to use cases
  const inputRouter = new HomeBotInputRouter(container);

  // Create webhook handler
  const webhookHandler = createTelegramWebhookHandler(
    container,
    { botId, botName: 'homebot', inputRouter },
    { gateway: options.gateway }
  );

  // Apply middleware
  router.use(tracingMiddleware());
  router.use(requestLoggerMiddleware({ logBody: false }));

  // Webhook endpoint
  router.post(
    '/webhook',
    webhookValidationMiddleware('homebot'),
    idempotencyMiddleware({ ttlMs: 300000 }),
    asyncHandler(webhookHandler)
  );

  // Apply error handler
  router.use(errorHandlerMiddleware({ isWebhook: false }));

  return router;
}

export default createHomeBotRouter;
```

#### 1.4 Register in `api.mjs`

Add to the imports and initialization section:

```javascript
// Add import
import { createHomeBotRouter } from './chatbots/bots/homebot/server.mjs';
import { HomeBotContainer } from './chatbots/bots/homebot/container.mjs';

// In the initialization section (similar to nutribot)
const homebotConfig = getConfigProvider().getConfig('homebot');
const homebotContainer = new HomeBotContainer(homebotConfig, {
  messagingGateway: telegramGateway,  // reuse or create new
  aiGateway: openAIGateway,
  conversationStateStore: conversationStateStore,
});

// Mount router
app.use('/homebot', createHomeBotRouter(homebotContainer, { 
  botId: process.env.TELEGRAM_HOMEBOT_BOT_ID,
  gateway: homebotTelegramGateway,
}));
```

#### 1.5 Add Config to `config.secrets.yml`

```yaml
TELEGRAM_HOMEBOT_TOKEN: <bot_token_here>
```

---

### Phase 2: ProcessGratitudeInput Use Case

#### 2.1 Input Router

Create `backend/chatbots/bots/homebot/adapters/HomeBotInputRouter.mjs`:

```javascript
/**
 * HomeBot Input Router
 * Routes platform-agnostic IInputEvents to HomeBot use cases.
 */

import { createLogger } from '../../../_lib/logging/index.mjs';
import { InputEventType } from '../../../application/ports/IInputEvent.mjs';

export class HomeBotInputRouter {
  #container;
  #logger;

  constructor(container) {
    this.#container = container;
    this.#logger = createLogger({ source: 'input-router', app: 'homebot' });
  }

  async route(event) {
    this.#logger.debug('homebot.route.received', { 
      type: event.type, 
      conversationId: event.conversationId 
    });

    switch (event.type) {
      case InputEventType.TEXT:
        return this.#handleText(event);
      
      case InputEventType.VOICE:
        return this.#handleVoice(event);
      
      case InputEventType.CALLBACK:
        return this.#handleCallback(event);
      
      default:
        this.#logger.warn('homebot.route.unhandled', { type: event.type });
        return null;
    }
  }

  async #handleText(event) {
    // All text input goes to ProcessGratitudeInput
    return this.#container.processGratitudeInput.execute({
      userId: event.userId,
      conversationId: event.conversationId,
      text: event.text,
      messageId: event.messageId,
    });
  }

  async #handleVoice(event) {
    // Voice goes to ProcessGratitudeInput with voice flag
    return this.#container.processGratitudeInput.execute({
      userId: event.userId,
      conversationId: event.conversationId,
      voiceFileId: event.voice?.fileId,
      messageId: event.messageId,
    });
  }

  async #handleCallback(event) {
    const data = event.callbackData;
    
    if (data.startsWith('category:')) {
      return this.#container.toggleCategory.execute({
        conversationId: event.conversationId,
        callbackQueryId: event.callbackQueryId,
        messageId: event.messageId,
        category: data.replace('category:', ''),
      });
    }
    
    if (data.startsWith('user:')) {
      return this.#container.assignItemToUser.execute({
        conversationId: event.conversationId,
        callbackQueryId: event.callbackQueryId,
        messageId: event.messageId,
        userId: data.replace('user:', ''),
      });
    }
    
    if (data === 'cancel') {
      return this.#container.cancelGratitudeInput.execute({
        conversationId: event.conversationId,
        callbackQueryId: event.callbackQueryId,
        messageId: event.messageId,
      });
    }
  }
}
```

#### 2.2 ProcessGratitudeInput Use Case

Create `backend/chatbots/bots/homebot/application/usecases/ProcessGratitudeInput.mjs`:

```javascript
/**
 * Process Gratitude Input Use Case
 * @module homebot/application/usecases/ProcessGratitudeInput
 * 
 * Extracts gratitude/hope items from text or voice input.
 */

import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../../../../_lib/logging/index.mjs';

export class ProcessGratitudeInput {
  #messagingGateway;
  #aiGateway;
  #householdRepository;
  #conversationStateStore;
  #config;
  #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    if (!deps.aiGateway) throw new Error('aiGateway is required');
    if (!deps.householdRepository) throw new Error('householdRepository is required');
    if (!deps.conversationStateStore) throw new Error('conversationStateStore is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#aiGateway = deps.aiGateway;
    this.#householdRepository = deps.householdRepository;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#config = deps.config;
    this.#logger = deps.logger || createLogger({ source: 'usecase', app: 'homebot' });
  }

  async execute(input) {
    const { userId, conversationId, text, voiceFileId, messageId } = input;

    this.#logger.debug('gratitude.process.start', { 
      conversationId, 
      hasText: !!text, 
      hasVoice: !!voiceFileId 
    });

    try {
      // 1. Delete original message
      if (messageId) {
        try {
          await this.#messagingGateway.deleteMessage(conversationId, messageId);
        } catch (e) {
          // Ignore delete errors
        }
      }

      // 2. Send processing status
      const statusMsg = await this.#messagingGateway.sendMessage(conversationId, {
        text: '🔄 Processing...',
      });

      // 3. Get text (transcribe if voice)
      let inputText = text;
      if (voiceFileId) {
        inputText = await this.#transcribeVoice(voiceFileId);
      }

      if (!inputText?.trim()) {
        await this.#messagingGateway.editMessage(conversationId, statusMsg.message_id, {
          text: '❌ Could not understand input. Please try again.',
        });
        return;
      }

      // 4. Extract items via AI
      const items = await this.#extractItems(inputText);

      if (!items || items.length === 0) {
        await this.#messagingGateway.editMessage(conversationId, statusMsg.message_id, {
          text: '❌ No items found. Please describe what you\'re grateful for.',
        });
        return;
      }

      // 5. Get household members for keyboard
      const members = await this.#householdRepository.getHouseholdMembers();

      // 6. Build confirmation message with keyboard
      const keyboard = this.#buildConfirmationKeyboard(members, 'gratitude');
      const messageText = this.#buildConfirmationMessage(items, 'gratitude');

      await this.#messagingGateway.editMessage(conversationId, statusMsg.message_id, {
        text: messageText,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard },
      });

      // 7. Save state
      await this.#conversationStateStore.set(conversationId, {
        activeFlow: 'gratitude_input',
        flowState: {
          items: items.map(text => ({ id: uuidv4(), text })),
          category: 'gratitude',
          confirmationMessageId: statusMsg.message_id,
        },
        lastUpdated: Date.now(),
      });

      this.#logger.info('gratitude.process.complete', { 
        conversationId, 
        itemCount: items.length 
      });

    } catch (error) {
      this.#logger.error('gratitude.process.failed', {
        conversationId,
        error: error.message,
        stack: error.stack,
      });

      await this.#messagingGateway.sendMessage(conversationId, {
        text: '❌ Sorry, something went wrong. Please try again.',
      });
    }
  }

  async #transcribeVoice(fileId) {
    // Reuse NutriBot's pattern
    const fileUrl = await this.#messagingGateway.getFileUrl(fileId);
    return this.#aiGateway.transcribeAudio(fileUrl);
  }

  async #extractItems(text) {
    const prompt = `You are extracting gratitude items from user input.

User input: "${text}"

Extract a list of distinct items the user is grateful for or hoping for.
Clean up grammar and format each as Title Case (2-5 words max per item).
Return ONLY a JSON array of strings, no explanation.

Example:
Input: "sunny weather today, my break was great, and spending time with family"
Output: ["Sunny Weather", "Morning Coffee", "Family Time"]`;

    const response = await this.#aiGateway.chat([
      { role: 'system', content: 'You extract gratitude items and return JSON arrays only.' },
      { role: 'user', content: prompt },
    ], { 
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
    });

    try {
      // Parse response - handle both array and object formats
      const parsed = JSON.parse(response);
      return Array.isArray(parsed) ? parsed : parsed.items || [];
    } catch {
      this.#logger.warn('gratitude.extract.parse-failed', { response });
      return [];
    }
  }

  #buildConfirmationMessage(items, category) {
    const emoji = category === 'gratitude' ? '🙏' : '✨';
    const header = `📝 <b>Items to Add</b>\n\n`;
    const itemList = items.map(item => `• ${item}`).join('\n');
    const categoryLabel = category === 'gratitude' ? 'grateful' : 'hoping';
    const prompt = `\n\n<i>Who is ${categoryLabel} for these?</i>`;
    
    return header + itemList + prompt;
  }

  #buildConfirmationKeyboard(members, currentCategory) {
    const keyboard = [];
    
    // Category toggle row
    keyboard.push([
      {
        text: currentCategory === 'gratitude' ? '✅ Gratitude' : 'Gratitude',
        callback_data: 'category:gratitude',
      },
      {
        text: currentCategory === 'hopes' ? '✅ Hopes' : 'Hopes',
        callback_data: 'category:hopes',
      },
    ]);

    // Member rows (3 per row)
    const memberButtons = members.map(m => ({
      text: m.displayName,
      callback_data: `user:${m.username}`,
    }));
    
    for (let i = 0; i < memberButtons.length; i += 3) {
      keyboard.push(memberButtons.slice(i, i + 3));
    }

    // Cancel row
    keyboard.push([{ text: '❌ Cancel', callback_data: 'cancel' }]);

    return keyboard;
  }
}
```

---

### Phase 3: AssignItemToUser Use Case

Create `backend/chatbots/bots/homebot/application/usecases/AssignItemToUser.mjs`:

```javascript
/**
 * Assign Items To User Use Case
 * @module homebot/application/usecases/AssignItemToUser
 * 
 * Persists items and broadcasts to WebSocket.
 */

import { createLogger } from '../../../../_lib/logging/index.mjs';
import { broadcastToWebsockets } from '../../../../websocket.js';

export class AssignItemToUser {
  #messagingGateway;
  #gratitudeRepository;
  #householdRepository;
  #conversationStateStore;
  #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    if (!deps.gratitudeRepository) throw new Error('gratitudeRepository is required');
    if (!deps.conversationStateStore) throw new Error('conversationStateStore is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#gratitudeRepository = deps.gratitudeRepository;
    this.#householdRepository = deps.householdRepository;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#logger = deps.logger || createLogger({ source: 'usecase', app: 'homebot' });
  }

  async execute(input) {
    const { conversationId, callbackQueryId, messageId, userId } = input;

    this.#logger.debug('gratitude.assign.start', { conversationId, userId });

    try {
      // 1. Answer callback immediately
      await this.#messagingGateway.answerCallbackQuery(callbackQueryId);

      // 2. Get state
      const state = await this.#conversationStateStore.get(conversationId);
      if (!state || state.activeFlow !== 'gratitude_input') {
        await this.#messagingGateway.sendMessage(conversationId, {
          text: '❌ Session expired. Please start again.',
        });
        return;
      }

      const { items, category } = state.flowState;

      // 3. Get user display name
      const member = await this.#householdRepository.getMemberByUsername(userId);
      const displayName = member?.displayName || userId;

      // 4. Save each item
      for (const item of items) {
        await this.#gratitudeRepository.addSelection(category, {
          userId,
          item: { id: item.id, text: item.text },
        });
      }

      // 5. Broadcast to WebSocket
      broadcastToWebsockets({
        topic: 'gratitude',
        action: 'item_added',
        items: items,
        userId: userId,
        userName: displayName,
        category: category,
        source: 'homebot',
        timestamp: new Date().toISOString(),
      });

      // 6. Delete confirmation message
      try {
        await this.#messagingGateway.deleteMessage(conversationId, messageId);
      } catch (e) {
        // Ignore
      }

      // 7. Send success message
      const emoji = category === 'gratitude' ? '🙏' : '✨';
      await this.#messagingGateway.sendMessage(conversationId, {
        text: `${emoji} Added ${items.length} ${category} item${items.length > 1 ? 's' : ''} for ${displayName}!`,
      });

      // 8. Clear state
      await this.#conversationStateStore.delete(conversationId);

      this.#logger.info('gratitude.assign.complete', { 
        conversationId, 
        userId, 
        category,
        itemCount: items.length 
      });

    } catch (error) {
      this.#logger.error('gratitude.assign.failed', {
        conversationId,
        error: error.message,
      });

      await this.#messagingGateway.sendMessage(conversationId, {
        text: '❌ Failed to save items. Please try again.',
      });
    }
  }
}
```

---

### Phase 4: Backend Updates

#### 4.1 Update `gratitude.mjs` for Household Users

Replace the `getUsers` function to read from `household.yml`:

```javascript
// In gratitude.mjs

import { configService } from './lib/config/ConfigService.mjs';

/**
 * Get users from household.yml instead of legacy users.yaml
 */
const getHouseholdUsers = (householdId) => {
  const hid = householdId || configService.getDefaultHouseholdId();
  const usernames = configService.getHouseholdUsers(hid);
  
  // Map to user objects with display names
  return usernames.map((username, index) => {
    const profile = configService.getUserProfile(username);
    return {
      id: index + 1,
      username: username,
      name: profile?.display_name || profile?.name || username,
    };
  });
};

// Update the /users endpoint
gratitudeRouter.get('/users', (req, res) => {
  const hid = getHouseholdId(req);
  res.json({ users: getHouseholdUsers(hid), _household: hid });
});

// Update bootstrap to use household users
gratitudeRouter.get('/bootstrap', (req, res) => {
  const hid = getHouseholdId(req);
  res.json({
    users: getHouseholdUsers(hid),  // Changed from getUsers(hid)
    options: {
      gratitude: getOptions(hid, 'gratitude'),
      hopes: getOptions(hid, 'hopes'),
    },
    // ... rest unchanged
  });
});
```

#### 4.2 Create GratitudeRepository

Create `backend/chatbots/bots/homebot/repositories/GratitudeRepository.mjs`:

```javascript
/**
 * Gratitude Repository
 * @module homebot/repositories/GratitudeRepository
 * 
 * Wraps gratitude.mjs data access for use by HomeBot use cases.
 */

import { v4 as uuidv4 } from 'uuid';
import { userDataService } from '../../../lib/config/UserDataService.mjs';
import { configService } from '../../../lib/config/ConfigService.mjs';
import { createLogger } from '../../_lib/logging/index.mjs';

export class GratitudeRepository {
  #householdId;
  #logger;

  constructor(options = {}) {
    this.#householdId = options.householdId || configService.getDefaultHouseholdId();
    this.#logger = options.logger || createLogger({ source: 'repository', app: 'homebot' });
  }

  async addSelection(category, { userId, item }) {
    const selections = this.#readSelections(category);
    
    const entry = {
      id: uuidv4(),
      userId,
      item,
      datetime: new Date().toISOString(),
    };
    
    selections.unshift(entry);
    this.#writeSelections(category, selections);
    
    this.#logger.debug('gratitude.selection.added', { category, userId, itemId: item.id });
    
    return entry;
  }

  async getSelections(category) {
    return this.#readSelections(category);
  }

  #readSelections(category) {
    const data = userDataService.readHouseholdSharedData(
      this.#householdId, 
      `gratitude/selections.${category}`
    );
    return Array.isArray(data) ? data : [];
  }

  #writeSelections(category, data) {
    userDataService.writeHouseholdSharedData(
      this.#householdId,
      `gratitude/selections.${category}`,
      data
    );
  }
}
```

---

### Phase 5: Frontend Updates

#### 5.1 Update WebSocket Handler in `Gratitude.jsx`

Update `handleWebSocketPayload` to handle new payload format:

```javascript
const handleWebSocketPayload = useCallback((payload) => {
  console.log('WebSocket payload received:', payload);
  
  // Filter for gratitude topic
  if (payload.topic !== 'gratitude') return;
  
  // Handle multi-item payloads from HomeBot
  if (payload.action === 'item_added' && Array.isArray(payload.items)) {
    payload.items.forEach((item, index) => {
      // Stagger animations for multiple items
      setTimeout(() => {
        addItemToSelected(item, payload.userId, payload.userName);
      }, index * 400);
    });
    return;
  }
  
  // Handle legacy single-item format
  if (payload.item && payload.item.id) {
    addItemToSelected(payload.item);
  }
}, [addItemToSelected]);

const addItemToSelected = useCallback((item, userId, userName) => {
  // ... existing animation logic
  // Add userId/userName to item for display
  const enrichedItem = { ...item, userId, userName };
  setSelected(prev => [enrichedItem, ...prev]);
  // ... rest of animation
}, []);
```

#### 5.2 Update User Loading

Update to handle new user object format from backend:

```javascript
// In Gratitude.jsx or wherever users are loaded
const loadUsers = useCallback(async () => {
  const data = await DaylightAPI('/api/gratitude/bootstrap');
  // Users now have: { id, username, name }
  setUsers(data.users || []);
  // ...
}, []);
```

---

## 3. Testing Checklist

### Unit Tests

- [ ] `ProcessGratitudeInput` extracts items correctly
- [ ] `AssignItemToUser` persists and broadcasts
- [ ] `ToggleCategory` updates state correctly
- [ ] `CancelGratitudeInput` cleans up state

### Integration Tests

- [ ] Full flow: text → items → user selection → persist → broadcast
- [ ] Voice transcription → same flow
- [ ] Category toggle updates message correctly
- [ ] Cancel removes message and clears state

### E2E Tests

- [ ] Telegram message appears on TV app
- [ ] Multiple items animate sequentially
- [ ] User attribution displays correctly

---

## 4. Common Pitfalls

### ❌ Don't: Import websocket directly in use cases

```javascript
// WRONG - breaks clean architecture
import { broadcastToWebsockets } from '../../../../websocket.js';
```

**Solution:** Inject a `WebSocketGateway` or use an event emitter pattern.

### ❌ Don't: Hardcode household ID

```javascript
// WRONG
const hid = 'default';
```

**Solution:** Always use `configService.getDefaultHouseholdId()` or pass from context.

### ❌ Don't: Forget to answer callbacks

```javascript
// WRONG - Telegram will show loading spinner forever
async handleCallback(event) {
  // do stuff...
  // forgot answerCallbackQuery!
}
```

**Solution:** Always call `answerCallbackQuery` at the start of callback handlers.

### ❌ Don't: Block on message deletion

```javascript
// WRONG - deletion failures shouldn't block flow
await this.#messagingGateway.deleteMessage(conversationId, messageId);
```

**Solution:** Wrap in try/catch and ignore errors:

```javascript
try {
  await this.#messagingGateway.deleteMessage(conversationId, messageId);
} catch (e) {
  // Ignore - message may already be deleted
}
```

---

## 5. Configuration Reference

### Environment Variables

```bash
TELEGRAM_HOMEBOT_TOKEN=<bot_token>
TELEGRAM_HOMEBOT_BOT_ID=<bot_id_from_token>  # First part before colon
```

### Bot Config (config/apps/homebot.yaml)

```yaml
homebot:
  telegram:
    botId: "1234567890"
    
  gratitude:
    defaultCategory: "gratitude"
    maxItemsPerMessage: 10
    
  ai:
    model: "gpt-4o-mini"
    extractionPrompt: |
      Extract gratitude items from user input.
      Format as Title Case, 2-5 words per item.
```

---

## 6. Deployment Notes

1. **Create Telegram Bot** via @BotFather
   - Get token
   - Set webhook: `https://your-domain.com/homebot/webhook`

2. **Add Token** to `config.secrets.yml`

3. **Deploy** with `sh ./deploy.sh`

4. **Verify** webhook registration:
   ```bash
   curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo
   ```

5. **Test** by sending a message to the bot

---

*Document Version: 1.0*  
*Author: GitHub Copilot*  
*Date: December 19, 2025*
