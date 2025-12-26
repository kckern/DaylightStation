/**
 * CLI Chat Simulator Integration Tests
 * @module cli/__tests__/CLIChatSimulator.integration.test
 * 
 * Tests the full integration of CLI components with NutriBot.
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { CLIChatSimulator } from '../CLIChatSimulator.mjs';
import { DEFAULT_NUTRITION_GOALS } from '../../bots/nutribot/config/NutriBotConfig.mjs';

// Mock inquirer prompts since we can't use interactive input in tests
jest.unstable_mockModule('@inquirer/prompts', () => ({
  input: jest.fn(),
  select: jest.fn(),
}));

describe('CLIChatSimulator Integration', () => {
  let simulator;

  beforeEach(async () => {
    simulator = new CLIChatSimulator({
      sessionName: 'integration-test',
      debug: false,
      testMode: true, // Non-interactive mode for tests
    });
  });

  afterEach(() => {
    // Clean up
    simulator.getNutrilogRepository().clear();
    simulator.getNutrilistRepository().clear();
    simulator.getConversationStateStore().clear();
  });

  describe('initialization', () => {
    it('should initialize all components', async () => {
      await simulator.initialize();

      expect(simulator.getMessagingGateway()).toBeDefined();
      expect(simulator.getAIGateway()).toBeDefined();
      expect(simulator.getUPCGateway()).toBeDefined();
      expect(simulator.getReportRenderer()).toBeDefined();
      expect(simulator.getNutrilogRepository()).toBeDefined();
      expect(simulator.getConversationStateStore()).toBeDefined();
    });

    it('should create NutriBot container', async () => {
      await simulator.initialize();
      
      const container = simulator.getContainer('nutribot');
      expect(container).toBeDefined();
    });
  });

  describe('AI Gateway integration', () => {
    it('should return canned response for food text', async () => {
      await simulator.initialize();
      
      const ai = simulator.getAIGateway();
      const response = await ai.chat([
        { role: 'user', content: 'I ate a chicken salad' }
      ]);
      
      const parsed = JSON.parse(response);
      expect(parsed.items).toBeDefined();
      expect(parsed.items.length).toBeGreaterThan(0);
    });

    it('should allow custom mock responses', async () => {
      await simulator.initialize();
      
      const ai = simulator.getAIGateway();
      ai.setMockResponse('test food', {
        items: [{ name: 'Test Food', calories: 123, protein: 10, carbs: 20, fat: 5 }]
      });

      const response = await ai.chat([
        { role: 'user', content: 'I ate test food' }
      ]);
      
      const parsed = JSON.parse(response);
      expect(parsed.items[0].name).toBe('Test Food');
      expect(parsed.items[0].calories).toBe(123);
    });
  });

  describe('UPC Gateway integration', () => {
    it('should look up built-in products', async () => {
      await simulator.initialize();
      
      const upc = simulator.getUPCGateway();
      const product = await upc.lookup('049000042566'); // Coca-Cola
      
      expect(product).toBeDefined();
      expect(product.name).toBe('Coca-Cola Classic');
      expect(product.servings.length).toBeGreaterThan(0);
    });

    it('should return null for unknown UPC', async () => {
      await simulator.initialize();
      
      const upc = simulator.getUPCGateway();
      const product = await upc.lookup('000000000000');
      
      expect(product).toBeNull();
    });
  });

  describe('Repository integration', () => {
    it('should save and retrieve nutrilogs', async () => {
      await simulator.initialize();
      
      const repo = simulator.getNutrilogRepository();
      
      const log = await repo.save({
        chatId: 'test-chat',
        items: [{ name: 'Apple', calories: 95 }],
        status: 'pending',
      });

      expect(log.uuid).toBeDefined();
      
      const found = await repo.findByUuid(log.uuid);
      expect(found.items[0].name).toBe('Apple');
    });

    it('should track conversation state', async () => {
      await simulator.initialize();
      
      const store = simulator.getConversationStateStore();
      const convId = 'test-conversation';

      await store.set(convId, { flow: 'food_confirmation', logId: '123' });
      
      const state = await store.get(convId);
      expect(state.flow).toBe('food_confirmation');
      expect(state.logId).toBe('123');
    });
  });

  describe('Report Renderer integration', () => {
    it('should generate text report', async () => {
      await simulator.initialize();
      
      const renderer = simulator.getReportRenderer();
      
      const report = await renderer.renderDailyReport({
        date: '2024-12-14',
        totals: { calories: 1500, protein: 100, carbs: 150, fat: 50 },
          goals: DEFAULT_NUTRITION_GOALS,
        items: [
          { name: 'Chicken Salad', calories: 350, color: 'green' },
          { name: 'Apple', calories: 95, color: 'green' },
        ],
      });

      expect(typeof report).toBe('string');
      expect(report).toContain('DAILY NUTRITION REPORT');
      expect(report).toContain('Calories');
      expect(report).toContain('Chicken Salad');
    });

    it('should generate food card', async () => {
      await simulator.initialize();
      
      const renderer = simulator.getReportRenderer();
      
      const card = await renderer.renderFoodCard({
        name: 'Quest Bar',
        brand: 'Quest Nutrition',
        calories: 190,
        protein: 21,
        carbs: 21,
        fat: 8,
        servings: [{ name: '1 bar' }],
      });

      expect(typeof card).toBe('string');
      expect(card).toContain('Quest Bar');
      expect(card).toContain('Quest Nutrition');
    });
  });

  describe('Session management', () => {
    it('should persist session data', async () => {
      await simulator.initialize();
      
      const session = simulator.getSession();
      session.setCurrentBot('nutribot');
      session.addToHistory({ role: 'user', content: 'test message' });
      
      await session.persist();
      
      // Create new session with same name
      const newSession = new CLIChatSimulator({
        sessionName: 'integration-test',
      });
      await newSession.initialize();
      
      expect(newSession.getSession().getCurrentBot()).toBe('nutribot');
      expect(newSession.getSession().getHistory().length).toBeGreaterThan(0);
    });
  });

  describe('Full flow simulation', () => {
    it('should handle food logging workflow', async () => {
      await simulator.initialize();
      
      const container = simulator.getContainer('nutribot');
      const session = simulator.getSession();
      session.setCurrentBot('nutribot');
      
      // Simulate user sending food text
      const conversationId = session.getConversationId();
      const userId = session.getUserId();
      
      // Get the LogFoodFromText use case
      const logFoodFromText = container.getLogFoodFromText();
      
      // Execute the use case
      const result = await logFoodFromText.execute({
        userId,
        conversationId,
        text: 'I had a chicken salad for lunch',
      });

      // Verify result
      expect(result.success).toBe(true);
      expect(result.nutrilogUuid).toBeDefined();
      expect(result.itemCount).toBeGreaterThan(0);

      // Verify log was saved
      const repo = simulator.getNutrilogRepository();
      const log = await repo.findByUuid(result.nutrilogUuid);
      expect(log).toBeDefined();
      expect(log.status).toBe('pending');
      expect(log.items.length).toBeGreaterThan(0);

      // Verify conversation state was updated
      const store = simulator.getConversationStateStore();
      const state = await store.get(conversationId);
      expect(state.flow).toBe('food_confirmation');
      expect(state.pendingLogUuid).toBe(result.nutrilogUuid);
    });

    it('should accept a pending food log', async () => {
      await simulator.initialize();
      
      const container = simulator.getContainer('nutribot');
      const session = simulator.getSession();
      session.setCurrentBot('nutribot');
      
      const conversationId = session.getConversationId();
      const userId = session.getUserId();
      
      // First, create a pending log
      const logFoodFromText = container.getLogFoodFromText();
      const logResult = await logFoodFromText.execute({
        userId,
        conversationId,
        text: 'I had pizza for dinner',
      });

      expect(logResult.success).toBe(true);
      
      // Now accept the log
      const acceptFoodLog = container.getAcceptFoodLog();
      const acceptResult = await acceptFoodLog.execute({
        conversationId,
        logUuid: logResult.nutrilogUuid,
      });

      expect(acceptResult.success).toBe(true);

      // Verify log status was updated
      const repo = simulator.getNutrilogRepository();
      const log = await repo.findByUuid(logResult.nutrilogUuid);
      expect(log.status).toBe('accepted');

      // Verify items were saved to nutrilist
      const nutrilist = simulator.getNutrilistRepository();
      expect(nutrilist.size).toBeGreaterThan(0);
    });

    it('should discard a pending food log', async () => {
      await simulator.initialize();
      
      const container = simulator.getContainer('nutribot');
      const session = simulator.getSession();
      session.setCurrentBot('nutribot');
      
      const conversationId = session.getConversationId();
      const userId = session.getUserId();
      
      // Create a pending log
      const logFoodFromText = container.getLogFoodFromText();
      const logResult = await logFoodFromText.execute({
        userId,
        conversationId,
        text: 'I had a burger',
      });

      // Discard the log
      const discardFoodLog = container.getDiscardFoodLog();
      const discardResult = await discardFoodLog.execute({
        conversationId,
        logUuid: logResult.nutrilogUuid,
      });

      expect(discardResult.success).toBe(true);

      // Verify log was deleted or marked as discarded/rejected
      const repo = simulator.getNutrilogRepository();
      const log = await repo.findByUuid(logResult.nutrilogUuid);
      
      // Either deleted or status changed to discarded/rejected
      if (log) {
        expect(['discarded', 'rejected']).toContain(log.status);
      }
    });
  });
});
