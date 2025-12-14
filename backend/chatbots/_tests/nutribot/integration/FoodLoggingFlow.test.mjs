/**
 * NutriBot Food Logging Flow Integration Tests
 * @module _tests/nutribot/integration/FoodLoggingFlow.test
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { NutribotContainer } from '../../../nutribot/container.mjs';
import { NutribotEventRouter } from '../../../nutribot/adapters/EventRouter.mjs';

// Status constants matching domain schema
const NutriLogStatus = {
  INIT: 'pending',
  PENDING: 'pending',
  CONFIRMED: 'accepted',
  DISCARDED: 'rejected',
};

// ==================== Test Helpers ====================

class MockMessagingGateway {
  constructor() {
    this.messages = [];
    this.deletedMessages = [];
    this.lastMessageId = 0;
  }

  async sendMessage(conversationId, text, options = {}) {
    const messageId = `msg-${++this.lastMessageId}`;
    this.messages.push({ conversationId, text, options, messageId, type: 'text' });
    return { messageId };
  }

  async updateMessage(conversationId, messageId, options) {
    const msg = this.messages.find(m => m.messageId === messageId);
    if (msg) {
      msg.text = options.text || msg.text;
      msg.choices = options.choices;
      msg.updated = true;
    }
    return {};
  }

  async deleteMessage(conversationId, messageId) {
    this.deletedMessages.push({ conversationId, messageId });
  }

  async sendPhoto(conversationId, photoUrl, options = {}) {
    const messageId = `msg-${++this.lastMessageId}`;
    this.messages.push({ conversationId, photoUrl, options, messageId, type: 'photo' });
    return { messageId };
  }

  async getFileUrl(fileId) {
    return `https://telegram.files/${fileId}`;
  }

  async transcribeVoice(fileId) {
    return 'I had a grilled chicken salad for lunch';
  }

  getLastMessage() {
    return this.messages[this.messages.length - 1];
  }

  getMessagesByConversation(conversationId) {
    return this.messages.filter(m => m.conversationId === conversationId);
  }

  reset() {
    this.messages = [];
    this.deletedMessages = [];
    this.lastMessageId = 0;
  }
}

class MockAIGateway {
  constructor() {
    this.responses = new Map();
    this.defaultResponse = JSON.stringify({
      items: [
        { name: 'Grilled Chicken', quantity: 150, unit: 'g', calories: 250, protein: 40, carbs: 0, fat: 8 },
        { name: 'Garden Salad', quantity: 1, unit: 'cup', calories: 30, protein: 2, carbs: 5, fat: 0 },
      ]
    });
  }

  async chat(messages, options = {}) {
    return this.defaultResponse;
  }

  async chatWithImage(messages, imageUrl, options = {}) {
    return this.defaultResponse;
  }

  setResponse(response) {
    this.defaultResponse = response;
  }
}

class MockNutrilogRepository {
  constructor() {
    this.logs = new Map();
  }

  async save(log) {
    this.logs.set(log.uuid, { ...log });
  }

  async findByUuid(uuid) {
    const log = this.logs.get(uuid);
    return log ? { ...log } : null;
  }

  async findByStatus(chatId, status) {
    return Array.from(this.logs.values())
      .filter(l => l.chatId === chatId && l.status === status);
  }

  async findPending(userId) {
    return Array.from(this.logs.values())
      .filter(l => l.status === 'pending');
  }

  async getDailySummary(userId, date) {
    const dayLogs = Array.from(this.logs.values())
      .filter(l => l.status === 'accepted');
    
    // Flatten all items
    const allItems = dayLogs.flatMap(l => l.items || []);
    
    // Calculate totals from items
    let calories = 0, protein = 0, carbs = 0, fat = 0, totalGrams = 0;
    const colorCounts = { green: 0, yellow: 0, orange: 0 };
    const gramsByColor = { green: 0, yellow: 0, orange: 0 };
    
    for (const item of allItems) {
      calories += item.calories || 0;
      protein += item.protein || 0;
      carbs += item.carbs || 0;
      fat += item.fat || 0;
      totalGrams += item.grams || 0;
      
      const color = item.color || 'yellow';
      colorCounts[color] = (colorCounts[color] || 0) + 1;
      gramsByColor[color] = (gramsByColor[color] || 0) + (item.grams || 0);
    }
    
    return {
      logCount: dayLogs.length,
      itemCount: allItems.length,
      totalGrams,
      colorCounts,
      gramsByColor,
      totals: { calories, protein, carbs, fat },
      items: allItems,
    };
  }

  async updateStatus(uuid, status) {
    const log = this.logs.get(uuid);
    if (log) {
      log.status = status;
    }
  }

  async updateItems(uuid, items) {
    const log = this.logs.get(uuid);
    if (log) {
      log.items = items;
    }
  }

  reset() {
    this.logs.clear();
  }
}

class MockNutrilistRepository {
  constructor() {
    this.items = [];
  }

  async saveMany(items) {
    this.items.push(...items);
  }

  async findByDate(chatId, date) {
    return this.items.filter(i => i.chatId === chatId && i.date === date);
  }

  async getDailyTotals(chatId, date) {
    const dayItems = await this.findByDate(chatId, date);
    return dayItems.reduce((totals, item) => ({
      calories: totals.calories + (item.calories || 0),
      protein: totals.protein + (item.protein || 0),
      carbs: totals.carbs + (item.carbs || 0),
      fat: totals.fat + (item.fat || 0),
    }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
  }

  reset() {
    this.items = [];
  }
}

class MockConversationStateStore {
  constructor() {
    this.states = new Map();
  }

  async get(id) {
    return this.states.get(id);
  }

  async set(id, state) {
    this.states.set(id, state);
  }

  async delete(id) {
    this.states.delete(id);
  }

  reset() {
    this.states.clear();
  }
}

class MockUPCGateway {
  constructor() {
    this.products = new Map();
    this.products.set('012345678901', {
      upc: '012345678901',
      name: 'Protein Bar',
      brand: 'FitFood',
      imageUrl: 'https://example.com/bar.jpg',
      nutrition: { calories: 200, protein: 20, carbs: 25, fat: 8 },
      serving: { size: 60, unit: 'g' },
    });
  }

  async lookup(upc) {
    return this.products.get(upc) || null;
  }
}

// ==================== Integration Tests ====================

describe('NutriBot Food Logging Flow Integration', () => {
  let container;
  let router;
  let messagingGateway;
  let aiGateway;
  let nutrilogRepository;
  let nutrilistRepository;
  let conversationStateStore;
  let upcGateway;
  let config;

  beforeEach(() => {
    messagingGateway = new MockMessagingGateway();
    aiGateway = new MockAIGateway();
    nutrilogRepository = new MockNutrilogRepository();
    nutrilistRepository = new MockNutrilistRepository();
    conversationStateStore = new MockConversationStateStore();
    upcGateway = new MockUPCGateway();
    
    // Create proper config mock
    config = {
      goals: { calories: 2000, protein: 150, carbs: 200, fat: 65 },
      getUserTimezone: () => 'America/Los_Angeles',
      getGoalsForUser: () => ({ calories: 2000, protein: 150, carbs: 200, fat: 65 }),
    };

    container = new NutribotContainer(
      config,
      {
        messagingGateway,
        aiGateway,
        nutrilogRepository,
        nutrilistRepository,
        conversationStateStore,
        upcGateway,
      }
    );

    router = new NutribotEventRouter(container);
  });

  describe('Photo → Detect → Accept Flow', () => {
    it('should complete full photo logging flow', async () => {
      // Step 1: Send photo
      const photoResult = await container.getLogFoodFromImage().execute({
        userId: 'user-1',
        conversationId: 'chat-1',
        imageData: { fileId: 'photo-123' },
        messageId: 'orig-msg',
      });

      expect(photoResult.success).toBe(true);
      const logUuid = photoResult.nutrilogUuid;

      // Verify detection message sent
      const detectionMsg = messagingGateway.getLastMessage();
      expect(detectionMsg.text).toContain('I detected');
      expect(detectionMsg.choices).toBeDefined();

      // Step 2: Accept the log
      const acceptResult = await container.getAcceptFoodLog().execute({
        userId: 'user-1',
        conversationId: 'chat-1',
        logUuid,
        messageId: detectionMsg.messageId,
      });

      expect(acceptResult.success).toBe(true);

      // Verify log status
      const log = await nutrilogRepository.findByUuid(logUuid);
      expect(log.status).toBe(NutriLogStatus.CONFIRMED);

      // Verify items added to nutrilist
      const today = new Date().toISOString().split('T')[0];
      const items = await nutrilistRepository.findByDate('chat-1', today);
      expect(items.length).toBe(2);
    });
  });

  describe('Photo → Detect → Discard Flow', () => {
    it('should discard without saving', async () => {
      // Step 1: Send photo
      const photoResult = await container.getLogFoodFromImage().execute({
        userId: 'user-1',
        conversationId: 'chat-1',
        imageData: { fileId: 'photo-123' },
      });

      const logUuid = photoResult.nutrilogUuid;

      // Step 2: Discard
      const discardResult = await container.getDiscardFoodLog().execute({
        userId: 'user-1',
        conversationId: 'chat-1',
        logUuid,
      });

      expect(discardResult.success).toBe(true);

      // Verify log discarded
      const log = await nutrilogRepository.findByUuid(logUuid);
      expect(log.status).toBe(NutriLogStatus.DISCARDED);

      // Verify nothing added to nutrilist
      const today = new Date().toISOString().split('T')[0];
      const items = await nutrilistRepository.findByDate('chat-1', today);
      expect(items.length).toBe(0);
    });
  });

  describe('Photo → Detect → Revise → Accept Flow', () => {
    it('should revise and then accept', async () => {
      // Step 1: Send photo
      const photoResult = await container.getLogFoodFromImage().execute({
        userId: 'user-1',
        conversationId: 'chat-1',
        imageData: { fileId: 'photo-123' },
        messageId: 'orig-msg',
      });

      const logUuid = photoResult.nutrilogUuid;
      const detectionMsgId = messagingGateway.getLastMessage().messageId;

      // Step 2: Enter revision mode
      const reviseResult = await container.getReviseFoodLog().execute({
        userId: 'user-1',
        conversationId: 'chat-1',
        logUuid,
        messageId: detectionMsgId,
      });

      expect(reviseResult.success).toBe(true);
      expect(reviseResult.mode).toBe('revision');

      // Verify state
      const state = await conversationStateStore.get('chat-1');
      expect(state.flow).toBe('revision');

      // Step 3: Send revision
      aiGateway.setResponse(JSON.stringify({
        items: [
          { name: 'Grilled Chicken', quantity: 200, unit: 'g', calories: 330, protein: 53, carbs: 0, fat: 10 },
        ]
      }));

      const revisionResult = await container.getProcessRevisionInput().execute({
        userId: 'user-1',
        conversationId: 'chat-1',
        text: 'change chicken to 200g and remove the salad',
      });

      expect(revisionResult.success).toBe(true);
      expect(revisionResult.itemCount).toBe(1);

      // Step 4: Accept revised log
      const acceptResult = await container.getAcceptFoodLog().execute({
        userId: 'user-1',
        conversationId: 'chat-1',
        logUuid,
      });

      expect(acceptResult.success).toBe(true);

      // Verify final items
      const today = new Date().toISOString().split('T')[0];
      const items = await nutrilistRepository.findByDate('chat-1', today);
      expect(items.length).toBe(1);
      expect(items[0].name).toBe('Grilled Chicken');
    });
  });

  describe('Text Logging Flow', () => {
    it('should log from text description', async () => {
      const textResult = await container.getLogFoodFromText().execute({
        userId: 'user-1',
        conversationId: 'chat-1',
        text: 'I had grilled chicken and salad for lunch',
      });

      expect(textResult.success).toBe(true);
      expect(textResult.itemCount).toBe(2);

      // Accept
      await container.getAcceptFoodLog().execute({
        userId: 'user-1',
        conversationId: 'chat-1',
        logUuid: textResult.nutrilogUuid,
      });

      const today = new Date().toISOString().split('T')[0];
      const items = await nutrilistRepository.findByDate('chat-1', today);
      expect(items.length).toBe(2);
    });
  });

  describe('Voice Logging Flow', () => {
    it('should transcribe voice and log food', async () => {
      const voiceResult = await container.getLogFoodFromVoice().execute({
        userId: 'user-1',
        conversationId: 'chat-1',
        voiceData: { fileId: 'voice-123' },
      });

      expect(voiceResult.success).toBe(true);
    });
  });

  describe('UPC → Portion Select Flow', () => {
    it('should look up product and allow portion selection', async () => {
      // Step 1: Send UPC
      const upcResult = await container.getLogFoodFromUPC().execute({
        userId: 'user-1',
        conversationId: 'chat-1',
        upc: '012345678901',
      });

      expect(upcResult.success).toBe(true);
      expect(upcResult.product.name).toBe('Protein Bar');

      const logUuid = upcResult.nutrilogUuid;

      // Step 2: Select portion (half)
      const portionResult = await container.getSelectUPCPortion().execute({
        userId: 'user-1',
        conversationId: 'chat-1',
        portionFactor: 0.5,
      });

      expect(portionResult.success).toBe(true);
      expect(portionResult.scaledItems[0].calories).toBe(100); // 200 * 0.5

      // Verify saved to nutrilist
      const today = new Date().toISOString().split('T')[0];
      const items = await nutrilistRepository.findByDate('chat-1', today);
      expect(items.length).toBe(1);
      expect(items[0].calories).toBe(100);
    });
  });

  describe('Edge Cases', () => {
    it('should handle no food detected', async () => {
      aiGateway.setResponse('{ "items": [] }');

      const result = await container.getLogFoodFromImage().execute({
        userId: 'user-1',
        conversationId: 'chat-1',
        imageData: { fileId: 'photo-123' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('No food detected');
    });

    it('should handle UPC not found', async () => {
      const result = await container.getLogFoodFromUPC().execute({
        userId: 'user-1',
        conversationId: 'chat-1',
        upc: '999999999999',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Product not found');
    });

    it('should handle multiple logging sessions in parallel', async () => {
      // User 1 logs food
      const result1 = await container.getLogFoodFromText().execute({
        userId: 'user-1',
        conversationId: 'chat-1',
        text: 'eggs and toast',
      });

      // User 2 logs food
      const result2 = await container.getLogFoodFromText().execute({
        userId: 'user-2',
        conversationId: 'chat-2',
        text: 'pancakes',
      });

      // Both should succeed independently
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result1.nutrilogUuid).not.toBe(result2.nutrilogUuid);
    });
  });
});
