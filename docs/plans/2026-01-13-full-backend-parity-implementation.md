# Full Backend Parity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete DDD migration for Lifelog, Homebot, External API Adapters, and Scheduling to achieve full legacy parity.

**Architecture:** Each phase builds on existing DDD infrastructure. Lifelog extractors are already ported (class-based), homebot needs application layer, adapters need harvester pattern, scheduling needs concrete implementations.

**Tech Stack:** Node.js ESM, YAML persistence, Telegram API, OAuth 2.0, cron-parser

---

## Discovery Summary

**What's Already Done (from exploration):**
- ✅ 15 lifelog extractors ported to DDD (`1_domains/lifelog/extractors/`)
- ✅ LifelogAggregator service exists
- ✅ Gratitude domain complete (`1_domains/gratitude/`)
- ✅ Some harvesters exist: StravaHarvester, TodoistHarvester, ClickUpHarvester
- ✅ Scheduling domain exists with entities/services/ports

**What's Needed:**
- Lifelog API router and integration
- Homebot application (4 use cases + conversation state)
- Missing harvesters (Withings, Garmin, GCal)
- Scheduling concrete implementations and wiring

---

## Phase 1: Lifelog Integration (3 Tasks)

The extractors are done. This phase wires them to the API.

### Task 1.1: Create Lifelog API Router

**Files:**
- Create: `backend/src/4_api/routers/lifelog.mjs`
- Test: `tests/unit/api/routers/lifelog.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/api/routers/lifelog.test.mjs
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// Mock the LifelogAggregator
const mockAggregator = {
  aggregate: jest.fn()
};

describe('lifelog router', () => {
  let app;

  beforeEach(async () => {
    jest.resetModules();
    const { createLifelogRouter } = await import('../../backend/src/4_api/routers/lifelog.mjs');
    app = express();
    app.use('/lifelog', createLifelogRouter({ aggregator: mockAggregator }));
  });

  it('should return 200 with aggregated data for valid date', async () => {
    mockAggregator.aggregate.mockResolvedValue({
      date: '2026-01-13',
      sources: { weight: { lbs: 180 } },
      summaries: [{ source: 'weight', text: 'WEIGHT: 180 lbs' }],
      summaryText: '## WEIGHT\n180 lbs'
    });

    const res = await request(app).get('/lifelog/aggregate/testuser/2026-01-13');
    expect(res.status).toBe(200);
    expect(res.body.date).toBe('2026-01-13');
    expect(mockAggregator.aggregate).toHaveBeenCalledWith('testuser', '2026-01-13');
  });

  it('should return 400 for invalid date format', async () => {
    const res = await request(app).get('/lifelog/aggregate/testuser/invalid-date');
    expect(res.status).toBe(400);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --testPathPattern="lifelog.test"`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

```javascript
// backend/src/4_api/routers/lifelog.mjs
import express from 'express';

/**
 * Create lifelog API router
 * @param {Object} config
 * @param {Object} config.aggregator - LifelogAggregator instance
 */
export function createLifelogRouter(config) {
  const { aggregator } = config;
  const router = express.Router();

  // Validate date format
  function isValidDate(dateStr) {
    return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !isNaN(Date.parse(dateStr));
  }

  /**
   * GET /lifelog/aggregate/:username/:date
   * Aggregate all lifelog data for a user on a specific date
   */
  router.get('/aggregate/:username/:date', async (req, res) => {
    try {
      const { username, date } = req.params;

      if (!isValidDate(date)) {
        return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
      }

      const result = await aggregator.aggregate(username, date);
      res.json(result);
    } catch (err) {
      console.error('[lifelog] Aggregate error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /lifelog/sources
   * List available extractor sources
   */
  router.get('/sources', (req, res) => {
    const sources = aggregator.getAvailableSources?.() || [];
    res.json({ sources });
  });

  return router;
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --testPathPattern="lifelog.test"`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/4_api/routers/lifelog.mjs tests/unit/api/routers/lifelog.test.mjs
git commit -m "feat(api): add lifelog router with aggregate endpoint"
```

---

### Task 1.2: Wire Lifelog Router in Bootstrap

**Files:**
- Modify: `backend/src/0_infrastructure/bootstrap.mjs`
- Modify: `backend/src/server.mjs`

**Step 1: Identify mount point in bootstrap.mjs**

Read: `backend/src/0_infrastructure/bootstrap.mjs` to find router mounting pattern

**Step 2: Add LifelogAggregator to bootstrap**

```javascript
// In bootstrap.mjs, import and instantiate:
import { LifelogAggregator } from '../1_domains/lifelog/services/LifelogAggregator.mjs';
import { createLifelogRouter } from '../4_api/routers/lifelog.mjs';

// In initializeApp function:
const lifelogAggregator = new LifelogAggregator({ dataPath: config.dataPath });
const lifelogRouter = createLifelogRouter({ aggregator: lifelogAggregator });
app.use('/api/lifelog', lifelogRouter);
```

**Step 3: Test manually**

Run: `npm run dev`
Test: `curl http://localhost:3112/api/lifelog/sources`
Expected: JSON response with source list

**Step 4: Commit**

```bash
git add backend/src/0_infrastructure/bootstrap.mjs backend/src/server.mjs
git commit -m "feat(bootstrap): wire lifelog router to server"
```

---

### Task 1.3: Add Lifelog Integration Test

**Files:**
- Create: `tests/integration/api/lifelog.test.mjs`

**Step 1: Write integration test**

```javascript
// tests/integration/api/lifelog.test.mjs
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { LifelogAggregator } from '../../../backend/src/1_domains/lifelog/services/LifelogAggregator.mjs';
import { createLifelogRouter } from '../../../backend/src/4_api/routers/lifelog.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.join(__dirname, '../../fixtures/lifelog');

describe('lifelog integration', () => {
  let app;

  beforeAll(() => {
    const aggregator = new LifelogAggregator({ dataPath: fixturesPath });
    app = express();
    app.use('/lifelog', createLifelogRouter({ aggregator }));
  });

  it('should return sources list', async () => {
    const res = await request(app).get('/lifelog/sources');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.sources)).toBe(true);
  });
});
```

**Step 2: Run integration test**

Run: `npm run test:assembly -- --testPathPattern="lifelog"`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/integration/api/lifelog.test.mjs
git commit -m "test(lifelog): add integration test for lifelog API"
```

---

## Phase 2: Homebot Application (7 Tasks)

Port the homebot chatbot to DDD architecture.

### Task 2.1: Create Conversation State Port

**Files:**
- Create: `backend/src/1_domains/messaging/ports/IConversationStateStore.mjs`
- Test: `tests/unit/domains/messaging/ports/IConversationStateStore.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/domains/messaging/ports/IConversationStateStore.test.mjs
import { jest } from '@jest/globals';

describe('IConversationStateStore interface', () => {
  it('should define required methods', async () => {
    const { IConversationStateStore, isConversationStateStore } = await import(
      '../../../../../backend/src/1_domains/messaging/ports/IConversationStateStore.mjs'
    );

    const validStore = {
      get: async () => {},
      set: async () => {},
      delete: async () => {},
      clear: async () => {}
    };

    expect(isConversationStateStore(validStore)).toBe(true);
    expect(isConversationStateStore({})).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --testPathPattern="IConversationStateStore"`
Expected: FAIL - module not found

**Step 3: Write implementation**

```javascript
// backend/src/1_domains/messaging/ports/IConversationStateStore.mjs

/**
 * @typedef {Object} ConversationState
 * @property {string} activeFlow - Current flow name (e.g., 'gratitude_input', 'revision')
 * @property {Object} flowState - Flow-specific state data
 * @property {string} [updatedAt] - ISO timestamp of last update
 * @property {Object} [sessions] - Message-keyed session data
 */

/**
 * Interface for conversation state persistence
 * Supports multi-turn conversation flows with optional message-keyed sessions
 */
export class IConversationStateStore {
  /**
   * Get conversation state
   * @param {string} conversationId
   * @param {string} [messageId] - Optional message key for session
   * @returns {Promise<ConversationState|null>}
   */
  async get(conversationId, messageId) {
    throw new Error('IConversationStateStore.get() must be implemented');
  }

  /**
   * Set conversation state
   * @param {string} conversationId
   * @param {ConversationState} state
   * @param {string} [messageId] - Optional message key for session
   */
  async set(conversationId, state, messageId) {
    throw new Error('IConversationStateStore.set() must be implemented');
  }

  /**
   * Delete conversation state
   * @param {string} conversationId
   * @param {string} [messageId] - Optional: delete specific session
   */
  async delete(conversationId, messageId) {
    throw new Error('IConversationStateStore.delete() must be implemented');
  }

  /**
   * Clear all state for a conversation
   * @param {string} conversationId
   */
  async clear(conversationId) {
    throw new Error('IConversationStateStore.clear() must be implemented');
  }
}

/**
 * Type guard for IConversationStateStore
 */
export function isConversationStateStore(obj) {
  return obj &&
    typeof obj.get === 'function' &&
    typeof obj.set === 'function' &&
    typeof obj.delete === 'function' &&
    typeof obj.clear === 'function';
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --testPathPattern="IConversationStateStore"`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_domains/messaging/ports/IConversationStateStore.mjs tests/unit/domains/messaging/ports/IConversationStateStore.test.mjs
git commit -m "feat(messaging): add IConversationStateStore port"
```

---

### Task 2.2: Create YAML Conversation State Store

**Files:**
- Create: `backend/src/2_adapters/messaging/YamlConversationStateStore.mjs`
- Test: `tests/unit/adapters/messaging/YamlConversationStateStore.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/adapters/messaging/YamlConversationStateStore.test.mjs
import { jest } from '@jest/globals';
import { YamlConversationStateStore } from '../../../../backend/src/2_adapters/messaging/YamlConversationStateStore.mjs';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

describe('YamlConversationStateStore', () => {
  let store;
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'conv-state-'));
    store = new YamlConversationStateStore({ basePath: tempDir });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should return null for non-existent conversation', async () => {
    const state = await store.get('nonexistent');
    expect(state).toBeNull();
  });

  it('should set and get conversation state', async () => {
    const testState = { activeFlow: 'test', flowState: { count: 1 } };
    await store.set('conv123', testState);
    const retrieved = await store.get('conv123');
    expect(retrieved.activeFlow).toBe('test');
    expect(retrieved.flowState.count).toBe(1);
  });

  it('should support message-keyed sessions', async () => {
    await store.set('conv123', { activeFlow: 'flow1' }, 'msg1');
    await store.set('conv123', { activeFlow: 'flow2' }, 'msg2');

    const session1 = await store.get('conv123', 'msg1');
    const session2 = await store.get('conv123', 'msg2');

    expect(session1.activeFlow).toBe('flow1');
    expect(session2.activeFlow).toBe('flow2');
  });

  it('should delete specific session', async () => {
    await store.set('conv123', { activeFlow: 'flow1' }, 'msg1');
    await store.delete('conv123', 'msg1');
    const state = await store.get('conv123', 'msg1');
    expect(state).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --testPathPattern="YamlConversationStateStore"`
Expected: FAIL - module not found

**Step 3: Write implementation**

```javascript
// backend/src/2_adapters/messaging/YamlConversationStateStore.mjs
import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import { IConversationStateStore } from '../../1_domains/messaging/ports/IConversationStateStore.mjs';

/**
 * YAML-based conversation state persistence
 * Stores state at: {basePath}/{conversationId}.yml
 */
export class YamlConversationStateStore extends IConversationStateStore {
  #basePath;

  constructor(config) {
    super();
    this.#basePath = config.basePath;
  }

  #getFilePath(conversationId) {
    // Sanitize conversationId for filename (replace : with _)
    const safeId = conversationId.replace(/:/g, '_');
    return path.join(this.#basePath, `${safeId}.yml`);
  }

  async #loadFile(conversationId) {
    try {
      const filePath = this.#getFilePath(conversationId);
      const content = await fs.readFile(filePath, 'utf8');
      return yaml.load(content) || {};
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async #saveFile(conversationId, data) {
    const filePath = this.#getFilePath(conversationId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, yaml.dump(data), 'utf8');
  }

  async get(conversationId, messageId) {
    const data = await this.#loadFile(conversationId);
    if (!data) return null;

    if (messageId && data.sessions) {
      return data.sessions[messageId] || null;
    }
    return data;
  }

  async set(conversationId, state, messageId) {
    let data = await this.#loadFile(conversationId) || {};

    state.updatedAt = new Date().toISOString();

    if (messageId) {
      data.sessions = data.sessions || {};
      data.sessions[messageId] = state;
    } else {
      data = { ...data, ...state };
    }

    await this.#saveFile(conversationId, data);
  }

  async delete(conversationId, messageId) {
    if (messageId) {
      const data = await this.#loadFile(conversationId);
      if (data?.sessions?.[messageId]) {
        delete data.sessions[messageId];
        await this.#saveFile(conversationId, data);
      }
    } else {
      try {
        await fs.unlink(this.#getFilePath(conversationId));
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }
  }

  async clear(conversationId) {
    await this.delete(conversationId);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --testPathPattern="YamlConversationStateStore"`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/2_adapters/messaging/YamlConversationStateStore.mjs tests/unit/adapters/messaging/YamlConversationStateStore.test.mjs
git commit -m "feat(adapters): add YamlConversationStateStore"
```

---

### Task 2.3: Create Homebot Container

**Files:**
- Create: `backend/src/3_applications/homebot/HomeBotContainer.mjs`
- Create: `backend/src/3_applications/homebot/index.mjs`

**Step 1: Create directory structure**

```bash
mkdir -p backend/src/3_applications/homebot/usecases
```

**Step 2: Write container**

```javascript
// backend/src/3_applications/homebot/HomeBotContainer.mjs

/**
 * HomeBotContainer - Dependency injection container for HomeBot
 * Manages gratitude collection flows via Telegram
 */
export class HomeBotContainer {
  #config;
  #messagingGateway;
  #aiGateway;
  #conversationStateStore;
  #gratitudeService;
  #householdService;
  #logger;

  // Lazy-loaded use cases
  #processGratitudeInput;
  #assignItemToUser;
  #toggleCategory;
  #cancelGratitudeInput;

  constructor(config, options = {}) {
    this.#config = config;
    this.#messagingGateway = options.messagingGateway;
    this.#aiGateway = options.aiGateway;
    this.#conversationStateStore = options.conversationStateStore;
    this.#gratitudeService = options.gratitudeService;
    this.#householdService = options.householdService;
    this.#logger = options.logger || console;
  }

  get processGratitudeInput() {
    if (!this.#processGratitudeInput) {
      const { ProcessGratitudeInput } = require('./usecases/ProcessGratitudeInput.mjs');
      this.#processGratitudeInput = new ProcessGratitudeInput({
        messagingGateway: this.#messagingGateway,
        aiGateway: this.#aiGateway,
        conversationStateStore: this.#conversationStateStore,
        householdService: this.#householdService,
        logger: this.#logger
      });
    }
    return this.#processGratitudeInput;
  }

  get assignItemToUser() {
    if (!this.#assignItemToUser) {
      const { AssignItemToUser } = require('./usecases/AssignItemToUser.mjs');
      this.#assignItemToUser = new AssignItemToUser({
        messagingGateway: this.#messagingGateway,
        conversationStateStore: this.#conversationStateStore,
        gratitudeService: this.#gratitudeService,
        householdService: this.#householdService,
        logger: this.#logger
      });
    }
    return this.#assignItemToUser;
  }

  get toggleCategory() {
    if (!this.#toggleCategory) {
      const { ToggleCategory } = require('./usecases/ToggleCategory.mjs');
      this.#toggleCategory = new ToggleCategory({
        messagingGateway: this.#messagingGateway,
        conversationStateStore: this.#conversationStateStore,
        logger: this.#logger
      });
    }
    return this.#toggleCategory;
  }

  get cancelGratitudeInput() {
    if (!this.#cancelGratitudeInput) {
      const { CancelGratitudeInput } = require('./usecases/CancelGratitudeInput.mjs');
      this.#cancelGratitudeInput = new CancelGratitudeInput({
        messagingGateway: this.#messagingGateway,
        conversationStateStore: this.#conversationStateStore,
        logger: this.#logger
      });
    }
    return this.#cancelGratitudeInput;
  }
}
```

**Step 3: Create index.mjs**

```javascript
// backend/src/3_applications/homebot/index.mjs
export { HomeBotContainer } from './HomeBotContainer.mjs';
```

**Step 4: Commit**

```bash
git add backend/src/3_applications/homebot/
git commit -m "feat(homebot): add HomeBotContainer with lazy-loaded use cases"
```

---

### Task 2.4: Port ProcessGratitudeInput Use Case

**Files:**
- Create: `backend/src/3_applications/homebot/usecases/ProcessGratitudeInput.mjs`
- Test: `tests/unit/applications/homebot/ProcessGratitudeInput.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/applications/homebot/ProcessGratitudeInput.test.mjs
import { jest } from '@jest/globals';

describe('ProcessGratitudeInput', () => {
  let useCase;
  let mockMessagingGateway;
  let mockAiGateway;
  let mockStateStore;
  let mockHouseholdService;

  beforeEach(async () => {
    mockMessagingGateway = {
      sendMessage: jest.fn().mockResolvedValue({ messageId: 'msg123' }),
      updateMessage: jest.fn().mockResolvedValue(undefined)
    };
    mockAiGateway = {
      chatWithJson: jest.fn().mockResolvedValue({
        items: [{ text: 'Good health' }, { text: 'Family' }],
        category: 'gratitude'
      })
    };
    mockStateStore = {
      set: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue(null)
    };
    mockHouseholdService = {
      getMembers: jest.fn().mockResolvedValue([
        { username: 'user1', displayName: 'User One' }
      ])
    };

    const { ProcessGratitudeInput } = await import(
      '../../../../backend/src/3_applications/homebot/usecases/ProcessGratitudeInput.mjs'
    );
    useCase = new ProcessGratitudeInput({
      messagingGateway: mockMessagingGateway,
      aiGateway: mockAiGateway,
      conversationStateStore: mockStateStore,
      householdService: mockHouseholdService,
      logger: { info: jest.fn(), debug: jest.fn(), error: jest.fn() }
    });
  });

  it('should extract items and show confirmation UI', async () => {
    await useCase.execute({
      conversationId: 'telegram:123',
      text: 'I am grateful for good health and family'
    });

    expect(mockAiGateway.chatWithJson).toHaveBeenCalled();
    expect(mockMessagingGateway.sendMessage).toHaveBeenCalled();
    expect(mockStateStore.set).toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --testPathPattern="ProcessGratitudeInput"`
Expected: FAIL - module not found

**Step 3: Write implementation**

```javascript
// backend/src/3_applications/homebot/usecases/ProcessGratitudeInput.mjs
import { v4 as uuidv4 } from 'uuid';

/**
 * ProcessGratitudeInput - Extract gratitude items from user text/voice
 * Shows confirmation UI with extracted items and category toggle
 */
export class ProcessGratitudeInput {
  #messagingGateway;
  #aiGateway;
  #conversationStateStore;
  #householdService;
  #logger;

  constructor(config) {
    this.#messagingGateway = config.messagingGateway;
    this.#aiGateway = config.aiGateway;
    this.#conversationStateStore = config.conversationStateStore;
    this.#householdService = config.householdService;
    this.#logger = config.logger || console;
  }

  async execute({ conversationId, text, voiceFileId }) {
    this.#logger.info('processGratitudeInput.start', { conversationId, hasText: !!text });

    try {
      // Transcribe voice if provided
      let inputText = text;
      if (voiceFileId && !text) {
        inputText = await this.#messagingGateway.transcribeVoice?.(voiceFileId);
      }

      if (!inputText) {
        return { success: false, reason: 'No input provided' };
      }

      // Extract items using AI
      const extraction = await this.#extractItems(inputText);

      if (!extraction.items?.length) {
        await this.#messagingGateway.sendMessage(conversationId,
          "I couldn't identify any gratitude items. Please try again.");
        return { success: false, reason: 'No items extracted' };
      }

      // Get household members for assignment
      const members = await this.#householdService.getMembers();

      // Build confirmation UI
      const { messageId } = await this.#sendConfirmationUI(
        conversationId,
        extraction.items,
        extraction.category || 'gratitude',
        members
      );

      // Save state for callback handling
      await this.#conversationStateStore.set(conversationId, {
        activeFlow: 'gratitude_input',
        flowState: {
          items: extraction.items,
          category: extraction.category || 'gratitude',
          confirmationMessageId: messageId,
          originalText: inputText
        }
      }, messageId);

      return { success: true, itemCount: extraction.items.length };
    } catch (err) {
      this.#logger.error('processGratitudeInput.error', { conversationId, error: err.message });
      throw err;
    }
  }

  async #extractItems(text) {
    const prompt = `Extract gratitude or hopes items from this text. Return JSON:
{
  "items": [{"text": "item description"}],
  "category": "gratitude" or "hopes"
}

Text: "${text}"`;

    try {
      return await this.#aiGateway.chatWithJson([{ role: 'user', content: prompt }]);
    } catch {
      // Fallback: split by comma/newline
      const items = text.split(/[,\n]+/)
        .map(s => s.trim())
        .filter(s => s.length > 0)
        .map(text => ({ id: uuidv4(), text }));
      return { items, category: 'gratitude' };
    }
  }

  async #sendConfirmationUI(conversationId, items, category, members) {
    const itemList = items.map((item, i) => `${i + 1}. ${item.text}`).join('\n');
    const text = `📝 *${category === 'gratitude' ? 'Gratitude' : 'Hopes'}*\n\n${itemList}\n\nAssign to:`;

    const choices = [
      // Category toggle
      [{ label: category === 'gratitude' ? '🔄 Switch to Hopes' : '🔄 Switch to Gratitude',
         data: `category:${category === 'gratitude' ? 'hopes' : 'gratitude'}` }],
      // Member buttons
      ...members.map(m => [{ label: m.displayName, data: `user:${m.username}` }]),
      // Cancel
      [{ label: '❌ Cancel', data: 'cancel' }]
    ];

    return this.#messagingGateway.sendMessage(conversationId, text, { choices, parseMode: 'Markdown' });
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --testPathPattern="ProcessGratitudeInput"`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/homebot/usecases/ProcessGratitudeInput.mjs tests/unit/applications/homebot/ProcessGratitudeInput.test.mjs
git commit -m "feat(homebot): add ProcessGratitudeInput use case"
```

---

### Task 2.5: Port AssignItemToUser Use Case

**Files:**
- Create: `backend/src/3_applications/homebot/usecases/AssignItemToUser.mjs`
- Test: `tests/unit/applications/homebot/AssignItemToUser.test.mjs`

(Similar TDD pattern - write test, verify fail, implement, verify pass, commit)

---

### Task 2.6: Port ToggleCategory and CancelGratitudeInput

**Files:**
- Create: `backend/src/3_applications/homebot/usecases/ToggleCategory.mjs`
- Create: `backend/src/3_applications/homebot/usecases/CancelGratitudeInput.mjs`

(Similar TDD pattern)

---

### Task 2.7: Create HomeBotEventRouter

**Files:**
- Create: `backend/src/3_applications/homebot/bot/HomeBotEventRouter.mjs`
- Test: `tests/unit/applications/homebot/HomeBotEventRouter.test.mjs`

**Step 3: Write implementation**

```javascript
// backend/src/3_applications/homebot/bot/HomeBotEventRouter.mjs

const InputEventType = {
  TEXT: 'text',
  VOICE: 'voice',
  CALLBACK: 'callback',
  COMMAND: 'command'
};

/**
 * HomeBotEventRouter - Routes Telegram events to use cases
 */
export class HomeBotEventRouter {
  #container;
  #logger;

  constructor(container, options = {}) {
    this.#container = container;
    this.#logger = options.logger || console;
  }

  async route(event) {
    this.#logger.debug('homebot.route', { type: event.type, conversationId: event.conversationId });

    switch (event.type) {
      case InputEventType.TEXT:
        return this.#handleText(event);
      case InputEventType.VOICE:
        return this.#handleVoice(event);
      case InputEventType.CALLBACK:
        return this.#handleCallback(event);
      case InputEventType.COMMAND:
        return this.#handleCommand(event);
      default:
        this.#logger.warn('homebot.unknownEventType', { type: event.type });
        return null;
    }
  }

  async #handleText(event) {
    return this.#container.processGratitudeInput.execute({
      conversationId: event.conversationId,
      text: event.text
    });
  }

  async #handleVoice(event) {
    return this.#container.processGratitudeInput.execute({
      conversationId: event.conversationId,
      voiceFileId: event.fileId
    });
  }

  async #handleCallback(event) {
    const data = event.data;

    if (data.startsWith('user:')) {
      const username = data.replace('user:', '');
      return this.#container.assignItemToUser.execute({
        conversationId: event.conversationId,
        messageId: event.messageId,
        username
      });
    }

    if (data.startsWith('category:')) {
      const category = data.replace('category:', '');
      return this.#container.toggleCategory.execute({
        conversationId: event.conversationId,
        messageId: event.messageId,
        category
      });
    }

    if (data === 'cancel') {
      return this.#container.cancelGratitudeInput.execute({
        conversationId: event.conversationId,
        messageId: event.messageId
      });
    }

    return null;
  }

  async #handleCommand(event) {
    // Commands like /help, /start
    if (event.command === 'help') {
      return { type: 'help', text: 'Send me something you are grateful for!' };
    }
    return null;
  }
}

export { InputEventType };
```

---

## Phase 3: External API Harvesters (6 Tasks)

Port missing harvesters using the existing IHarvester pattern.

### Task 3.1: Create WithingsHarvester

**Files:**
- Create: `backend/src/2_adapters/harvester/fitness/WithingsHarvester.mjs`
- Test: `tests/unit/adapters/harvester/WithingsHarvester.test.mjs`

**Pattern to follow:** Reference existing `StravaHarvester.mjs` for:
- IHarvester interface implementation
- CircuitBreaker integration
- OAuth token refresh pattern
- YamlLifelogStore persistence

---

### Task 3.2: Create GarminHarvester

**Files:**
- Create: `backend/src/2_adapters/harvester/fitness/GarminHarvester.mjs`
- Test: `tests/unit/adapters/harvester/GarminHarvester.test.mjs`

---

### Task 3.3: Create GoogleCalendarHarvester

**Files:**
- Create: `backend/src/2_adapters/harvester/productivity/GoogleCalendarHarvester.mjs`
- Test: `tests/unit/adapters/harvester/GoogleCalendarHarvester.test.mjs`

---

### Task 3.4: Create GmailHarvester

**Files:**
- Create: `backend/src/2_adapters/harvester/communication/GmailHarvester.mjs`
- Test: `tests/unit/adapters/harvester/GmailHarvester.test.mjs`

---

### Task 3.5: Create FoursquareHarvester

**Files:**
- Create: `backend/src/2_adapters/harvester/social/FoursquareHarvester.mjs`
- Test: `tests/unit/adapters/harvester/FoursquareHarvester.test.mjs`

---

### Task 3.6: Create HarvesterRegistry

**Files:**
- Create: `backend/src/2_adapters/harvester/HarvesterRegistry.mjs`
- Test: `tests/unit/adapters/harvester/HarvesterRegistry.test.mjs`

**Purpose:** Central registry for all harvesters with category grouping

---

## Phase 4: Scheduling System (5 Tasks)

Wire DDD scheduling to concrete implementations.

### Task 4.1: Create YamlJobStore

**Files:**
- Create: `backend/src/2_adapters/scheduling/YamlJobStore.mjs`
- Test: `tests/unit/adapters/scheduling/YamlJobStore.test.mjs`

**Purpose:** Implements IJobStore, loads from `data/system/jobs.yml`

---

### Task 4.2: Create YamlStateStore

**Files:**
- Create: `backend/src/2_adapters/scheduling/YamlStateStore.mjs`
- Test: `tests/unit/adapters/scheduling/YamlStateStore.test.mjs`

**Purpose:** Implements IStateStore, persists to `data/system/state/cron-runtime.yml`

---

### Task 4.3: Wire Scheduling Service in Bootstrap

**Files:**
- Modify: `backend/src/0_infrastructure/bootstrap.mjs`

**Purpose:** Instantiate SchedulerService with concrete stores

---

### Task 4.4: Create Scheduling API Router

**Files:**
- Create: `backend/src/4_api/routers/scheduling.mjs`
- Test: `tests/unit/api/routers/scheduling.test.mjs`

**Endpoints:**
- GET /scheduling/status - All job statuses
- POST /scheduling/run/:jobId - Trigger job
- GET /scheduling/jobs - List job definitions

---

### Task 4.5: Integration Test Full Scheduling

**Files:**
- Create: `tests/integration/scheduling.test.mjs`

---

## Phase 5: Final Integration (3 Tasks)

### Task 5.1: Run Full Test Suite

Run: `npm test`
Expected: All tests pass

### Task 5.2: Update Audit Documents

Mark completed items in:
- `docs/_wip/audits/2026-01-13-full-backend-parity-audit.md`

### Task 5.3: Update AI Context Docs

Update relevant docs in `docs/ai-context/` with new capabilities.

---

## Completion Checklist

- [x] Phase 1: Lifelog Integration ✅
  - [x] Task 1.1: Create Lifelog API Router
  - [x] Task 1.2: Wire Lifelog Router in Bootstrap
  - [x] Task 1.3: Add Lifelog Integration Test

- [x] Phase 2: Homebot Application ✅
  - [x] Task 2.1: Create Conversation State Port
  - [x] Task 2.2: Create YAML Conversation State Store
  - [x] Task 2.3: Create Homebot Container
  - [x] Task 2.4: Port ProcessGratitudeInput
  - [x] Task 2.5: Port AssignItemToUser
  - [x] Task 2.6: Port ToggleCategory and CancelGratitudeInput
  - [x] Task 2.7: Create HomeBotEventRouter

- [x] Phase 3: External API Harvesters ✅ (Already existed)
  - [x] Task 3.1: WithingsHarvester (existed, added tests)
  - [x] Task 3.2: GarminHarvester (already existed)
  - [x] Task 3.3: GCalHarvester (already existed)
  - [x] Task 3.4: GmailHarvester (already existed)
  - [x] Task 3.5: FoursquareHarvester (already existed)
  - [x] Task 3.6: HarvesterRegistry (index.mjs already existed)

- [x] Phase 4: Scheduling System ✅ (Already existed, added tests)
  - [x] Task 4.1: YamlJobStore (already existed)
  - [x] Task 4.2: YamlStateStore (already existed)
  - [x] Task 4.3: Wire Scheduling Service in Bootstrap (already wired)
  - [x] Task 4.4: Scheduling API Router (already existed)
  - [x] Task 4.5: Integration Test Full Scheduling

- [x] Phase 5: Final Integration ✅
  - [x] Task 5.1: Run Full Test Suite (101 suites, 1364 tests passing)
  - [x] Task 5.2: Update Audit Documents
  - [x] Task 5.3: Update AI Context Docs
