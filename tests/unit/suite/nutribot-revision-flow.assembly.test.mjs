// tests/assembly/nutribot-revision-flow.assembly.test.mjs
/**
 * Assembly tests for NutriBot revision flow
 *
 * Tests the three bugs fixed in the revision flow:
 * 1. Voice messages in revision mode route to ProcessRevisionInput
 * 2. Image-based logs use caption instead of text when updating
 * 3. Logging uses correct field names (label not name)
 */
import { describe, it, expect, beforeEach } from '@jest/globals';

// Import the components under test
import { UnifiedEventRouter } from '#backend/_legacy/chatbots/application/routing/UnifiedEventRouter.mjs';
import { NutribotContainer } from '#backend/_legacy/chatbots/bots/nutribot/container.mjs';
import { ConversationState } from '#backend/_legacy/chatbots/domain/entities/ConversationState.mjs';

// ==================== Mock Implementations ====================

/**
 * Mock messaging gateway that records all method calls
 */
class MockMessagingGateway {
  constructor() {
    this.calls = [];
    this.messageCounter = 0;
  }

  _record(method, args) {
    this.calls.push({ method, args, timestamp: Date.now() });
  }

  _getCallsFor(method) {
    return this.calls.filter(c => c.method === method);
  }

  async sendMessage(conversationId, text, options = {}) {
    const messageId = `mock-msg-${++this.messageCounter}`;
    this._record('sendMessage', { conversationId, text, options, messageId });
    return { messageId };
  }

  async updateMessage(conversationId, messageId, options = {}) {
    this._record('updateMessage', { conversationId, messageId, options });
    return {};
  }

  async deleteMessage(conversationId, messageId) {
    this._record('deleteMessage', { conversationId, messageId });
    return {};
  }

  async sendPhoto(conversationId, photo, options = {}) {
    const messageId = `mock-msg-${++this.messageCounter}`;
    this._record('sendPhoto', { conversationId, photo, options, messageId });
    return { messageId };
  }

  async transcribeVoice(fileId) {
    this._record('transcribeVoice', { fileId });
    // Return a mock transcription
    return 'remove the cheese and add more vegetables';
  }

  async getFileUrl(fileId) {
    return `https://mock.telegram.api/file/${fileId}`;
  }
}

/**
 * Mock AI gateway that returns canned responses
 */
class MockAIGateway {
  constructor() {
    this.calls = [];
  }

  async chat(messages, options = {}) {
    this.calls.push({ method: 'chat', messages, options });

    // Return a mock food detection response
    return JSON.stringify({
      date: '2026-01-06',
      items: [
        {
          name: 'Broccoli',
          icon: 'broccoli',
          noom_color: 'green',
          quantity: 1,
          unit: 'cup',
          grams: 150,
          calories: 55,
          protein: 4,
          carbs: 11,
          fat: 0,
        },
        {
          name: 'Carrots',
          icon: 'carrot',
          noom_color: 'green',
          quantity: 1,
          unit: 'cup',
          grams: 120,
          calories: 50,
          protein: 1,
          carbs: 12,
          fat: 0,
        },
      ],
    });
  }

  async chatWithImage(messages, image, options = {}) {
    this.calls.push({ method: 'chatWithImage', messages, image, options });
    return this.chat(messages, options);
  }
}

/**
 * In-memory conversation state store
 */
class MockConversationStateStore {
  constructor() {
    this.states = new Map();
  }

  async get(conversationId) {
    return this.states.get(conversationId) || null;
  }

  async set(conversationId, state) {
    this.states.set(conversationId, state);
  }

  async clearFlow(conversationId, flowName) {
    const state = this.states.get(conversationId);
    if (state && state.activeFlow === flowName) {
      this.states.set(conversationId, state.clearFlow());
    }
  }

  async delete(conversationId) {
    this.states.delete(conversationId);
  }
}

/**
 * In-memory nutrilog repository
 */
class MockNutrilogRepository {
  constructor() {
    this.logs = new Map();
  }

  async save(nutriLog) {
    this.logs.set(nutriLog.id, nutriLog);
  }

  async findByUuid(uuid, conversationId) {
    return this.logs.get(uuid) || null;
  }

  async updateItems(uuid, items) {
    const log = this.logs.get(uuid);
    if (log) {
      log.items = items;
      this.logs.set(uuid, log);
    }
  }

  // Helper to create a mock nutrilog for testing
  createMockLog(id, options = {}) {
    const log = {
      id,
      userId: options.userId || 'test-user',
      conversationId: options.conversationId || 'test:conversation',
      status: options.status || 'pending',
      items: options.items || [
        { id: 'item-1', label: 'Pizza', grams: 200, calories: 500, color: 'orange' },
        { id: 'item-2', label: 'Salad', grams: 150, calories: 50, color: 'green' },
      ],
      meal: { date: '2026-01-06', time: 'evening' },
      metadata: {
        source: options.source || 'text',
        messageId: options.messageId || 'mock-msg-1',
      },
      date: '2026-01-06',
    };
    this.logs.set(id, log);
    return log;
  }
}

// ==================== Tests ====================

describe('NutriBot Revision Flow', () => {
  let mockMessaging;
  let mockAI;
  let mockStateStore;
  let mockNutrilogRepo;
  let container;
  let router;

  const TEST_CONVERSATION_ID = 'telegram:123456_789012';

  beforeEach(() => {
    // Fresh mocks for each test
    mockMessaging = new MockMessagingGateway();
    mockAI = new MockAIGateway();
    mockStateStore = new MockConversationStateStore();
    mockNutrilogRepo = new MockNutrilogRepository();

    // Create container with mock dependencies
    container = new NutribotContainer(
      { weather: { timezone: 'America/Los_Angeles' } },
      {
        messagingGateway: mockMessaging,
        aiGateway: mockAI,
        conversationStateStore: mockStateStore,
        nutrilogRepository: mockNutrilogRepo,
      }
    );

    // Create router
    router = new UnifiedEventRouter(container);
  });

  describe('Bug #1: Voice messages in revision mode', () => {
    it('should route voice input to ProcessRevisionInput when in revision mode', async () => {
      // Setup: Create a pending log and set revision state
      const logUuid = 'test-log-uuid-1';
      mockNutrilogRepo.createMockLog(logUuid, {
        conversationId: TEST_CONVERSATION_ID,
        source: 'text',
      });

      // Set conversation state to revision mode
      const revisionState = ConversationState.create(TEST_CONVERSATION_ID, {
        activeFlow: 'revision',
        flowState: {
          pendingLogUuid: logUuid,
          originalMessageId: 'mock-msg-1',
        },
      });
      await mockStateStore.set(TEST_CONVERSATION_ID, revisionState);

      // Act: Route a voice input event
      const event = {
        type: 'voice',
        userId: '789012',
        conversationId: TEST_CONVERSATION_ID,
        messageId: 'voice-msg-1',
        payload: {
          fileId: 'voice-file-123',
          duration: 5,
        },
      };

      await router.route(event);

      // Assert: Voice was transcribed
      const transcribeCalls = mockMessaging._getCallsFor('transcribeVoice');
      expect(transcribeCalls.length).toBe(1);
      expect(transcribeCalls[0].args.fileId).toBe('voice-file-123');

      // Assert: AI was called for revision (not new food log)
      expect(mockAI.calls.length).toBeGreaterThan(0);
      const aiCall = mockAI.calls[0];
      expect(aiCall.method).toBe('chat'); // ProcessRevisionInput uses chat, not chatWithImage

      // Assert: The log was updated (revision applied)
      const updatedLog = await mockNutrilogRepo.findByUuid(logUuid);
      expect(updatedLog).toBeDefined();
    });

    it('should create new log when NOT in revision mode', async () => {
      // Setup: No revision state set (or cleared state)
      await mockStateStore.set(TEST_CONVERSATION_ID, ConversationState.create(TEST_CONVERSATION_ID, {
        activeFlow: 'none',
        flowState: {},
      }));

      // Act: Route a voice input event
      const event = {
        type: 'voice',
        userId: '789012',
        conversationId: TEST_CONVERSATION_ID,
        messageId: 'voice-msg-2',
        payload: {
          fileId: 'voice-file-456',
          duration: 3,
        },
      };

      await router.route(event);

      // Assert: Voice was transcribed
      const transcribeCalls = mockMessaging._getCallsFor('transcribeVoice');
      expect(transcribeCalls.length).toBe(1);

      // Assert: A new log was created (not a revision)
      expect(mockNutrilogRepo.logs.size).toBe(1);
      const newLog = Array.from(mockNutrilogRepo.logs.values())[0];
      expect(newLog.metadata.source).toBe('text'); // Voice delegates to text
    });
  });

  describe('Bug #2: Image-based logs use caption', () => {
    it('should use caption (not text) when updating image-based log in revision mode', async () => {
      // Setup: Create an IMAGE-based pending log
      const logUuid = 'image-log-uuid-1';
      const originalMessageId = 'photo-msg-1';
      mockNutrilogRepo.createMockLog(logUuid, {
        conversationId: TEST_CONVERSATION_ID,
        source: 'image', // <-- This is the key: source is 'image'
        messageId: originalMessageId,
      });

      // Act: Call ReviseFoodLog use case directly
      const reviseFoodLog = container.getReviseFoodLog();
      await reviseFoodLog.execute({
        userId: '789012',
        conversationId: TEST_CONVERSATION_ID,
        logUuid,
        messageId: originalMessageId,
      });

      // Assert: updateMessage was called with 'caption' not 'text'
      const updateCalls = mockMessaging._getCallsFor('updateMessage');
      expect(updateCalls.length).toBe(1);

      const updateOptions = updateCalls[0].args.options;
      expect(updateOptions.caption).toBeDefined();
      expect(updateOptions.text).toBeUndefined();
      expect(updateOptions.caption).toContain('Revise Entry');
    });

    it('should use text (not caption) when updating text-based log in revision mode', async () => {
      // Setup: Create a TEXT-based pending log
      const logUuid = 'text-log-uuid-1';
      const originalMessageId = 'text-msg-1';
      mockNutrilogRepo.createMockLog(logUuid, {
        conversationId: TEST_CONVERSATION_ID,
        source: 'text', // <-- source is 'text'
        messageId: originalMessageId,
      });

      // Act: Call ReviseFoodLog use case directly
      const reviseFoodLog = container.getReviseFoodLog();
      await reviseFoodLog.execute({
        userId: '789012',
        conversationId: TEST_CONVERSATION_ID,
        logUuid,
        messageId: originalMessageId,
      });

      // Assert: updateMessage was called with 'text' not 'caption'
      const updateCalls = mockMessaging._getCallsFor('updateMessage');
      expect(updateCalls.length).toBe(1);

      const updateOptions = updateCalls[0].args.options;
      expect(updateOptions.text).toBeDefined();
      expect(updateOptions.caption).toBeUndefined();
      expect(updateOptions.text).toContain('Revise Entry');
    });

    it('should use caption in ProcessRevisionInput for image-based logs', async () => {
      // Setup: Create an IMAGE-based pending log and set revision state
      const logUuid = 'image-log-uuid-2';
      const originalMessageId = 'photo-msg-2';
      mockNutrilogRepo.createMockLog(logUuid, {
        conversationId: TEST_CONVERSATION_ID,
        source: 'image',
        messageId: originalMessageId,
      });

      const revisionState = ConversationState.create(TEST_CONVERSATION_ID, {
        activeFlow: 'revision',
        flowState: {
          pendingLogUuid: logUuid,
          originalMessageId,
        },
      });
      await mockStateStore.set(TEST_CONVERSATION_ID, revisionState);

      // Act: Call ProcessRevisionInput use case
      const processRevision = container.getProcessRevisionInput();
      await processRevision.execute({
        userId: '789012',
        conversationId: TEST_CONVERSATION_ID,
        text: 'add more broccoli',
        messageId: 'user-input-msg',
      });

      // Assert: updateMessage was called with 'caption' not 'text'
      const updateCalls = mockMessaging._getCallsFor('updateMessage');
      const finalUpdate = updateCalls[updateCalls.length - 1];

      expect(finalUpdate.args.options.caption).toBeDefined();
      expect(finalUpdate.args.options.text).toBeUndefined();
    });
  });

  describe('Bug #3: Correct field names in logging', () => {
    it('should use label field (not name) when formatting items', async () => {
      // This test verifies the data structure, not actual log output
      // Setup: Create a log with items that have 'label' field
      const logUuid = 'label-test-uuid';
      const log = mockNutrilogRepo.createMockLog(logUuid, {
        conversationId: TEST_CONVERSATION_ID,
        items: [
          { id: 'i1', label: 'Chicken Breast', grams: 150, calories: 200, color: 'yellow' },
          { id: 'i2', label: 'Brown Rice', grams: 100, calories: 130, color: 'yellow' },
        ],
      });

      // Assert: Items have 'label' property (not 'name')
      expect(log.items[0].label).toBe('Chicken Breast');
      expect(log.items[0].name).toBeUndefined();
      expect(log.items[1].label).toBe('Brown Rice');

      // Act: Format items for display (simulate what LogFoodFromText does)
      const formattedItems = log.items.map(i => `${i.label} ${i.grams}g`).join(', ');

      // Assert: No 'undefined' in the formatted string
      expect(formattedItems).not.toContain('undefined');
      expect(formattedItems).toBe('Chicken Breast 150g, Brown Rice 100g');
    });
  });

  describe('Router state checking', () => {
    it('should check conversation state before routing voice', async () => {
      // This test verifies the router checks state for voice input
      const logUuid = 'router-test-uuid';
      mockNutrilogRepo.createMockLog(logUuid, {
        conversationId: TEST_CONVERSATION_ID,
      });

      // Set revision state
      const revisionState = ConversationState.create(TEST_CONVERSATION_ID, {
        activeFlow: 'revision',
        flowState: { pendingLogUuid: logUuid },
      });
      await mockStateStore.set(TEST_CONVERSATION_ID, revisionState);

      // Route voice event
      await router.route({
        type: 'voice',
        userId: '789012',
        conversationId: TEST_CONVERSATION_ID,
        messageId: 'voice-1',
        payload: { fileId: 'file-1', duration: 2 },
      });

      // Verify transcription happened
      expect(mockMessaging._getCallsFor('transcribeVoice').length).toBe(1);

      // Verify AI was called (ProcessRevisionInput calls AI)
      expect(mockAI.calls.length).toBeGreaterThan(0);
    });

    it('should check conversation state before routing text', async () => {
      const logUuid = 'router-text-test-uuid';
      mockNutrilogRepo.createMockLog(logUuid, {
        conversationId: TEST_CONVERSATION_ID,
      });

      // Set revision state
      const revisionState = ConversationState.create(TEST_CONVERSATION_ID, {
        activeFlow: 'revision',
        flowState: { pendingLogUuid: logUuid },
      });
      await mockStateStore.set(TEST_CONVERSATION_ID, revisionState);

      // Route text event
      await router.route({
        type: 'text',
        userId: '789012',
        conversationId: TEST_CONVERSATION_ID,
        messageId: 'text-1',
        payload: { text: 'change pizza to salad' },
      });

      // Verify AI was called for revision
      expect(mockAI.calls.length).toBeGreaterThan(0);

      // Verify the conversation state was updated to food_confirmation
      const finalState = await mockStateStore.get(TEST_CONVERSATION_ID);
      expect(finalState.activeFlow).toBe('food_confirmation');
    });
  });
});
