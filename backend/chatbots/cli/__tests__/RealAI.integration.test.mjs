/**
 * Real AI Integration Tests
 * @module cli/__tests__/RealAI.integration.test
 * 
 * Tests the full flow with real OpenAI API.
 * 
 * Run with:
 *   OPENAI_API_KEY=sk-... npm test -- --testPathPattern="RealAI.integration"
 * 
 * These tests are SKIPPED by default if OPENAI_API_KEY is not set.
 */

import { jest, describe, it, expect, beforeEach, afterEach, beforeAll } from '@jest/globals';
import { CLIChatSimulator } from '../CLIChatSimulator.mjs';

// Check if we have a real API key
const hasRealAPIKey = !!process.env.OPENAI_API_KEY;

// Conditionally run tests
const describeIfRealAI = hasRealAPIKey ? describe : describe.skip;

describeIfRealAI('Real AI Integration', () => {
  let simulator;

  beforeAll(() => {
    if (!hasRealAPIKey) {
      console.log('⚠️  Skipping Real AI tests - OPENAI_API_KEY not set');
    } else {
      console.log('✓ Running Real AI tests with OPENAI_API_KEY');
    }
  });

  beforeEach(async () => {
    simulator = new CLIChatSimulator({
      sessionName: 'real-ai-test',
      testMode: true,  // Non-interactive
      useRealAI: true, // Use real OpenAI API
    });

    await simulator.initialize();
  });

  afterEach(() => {
    // Clean up
    simulator.getNutrilogRepository().clear();
    simulator.getNutrilistRepository().clear();
    simulator.getConversationStateStore().clear();
  });

  describe('Thanksgiving Dinner Flow', () => {
    it('should parse thanksgiving dinner into itemized foods', async () => {
      const container = simulator.getContainer('nutribot');
      const session = simulator.getSession();
      session.setCurrentBot('nutribot');
      
      const conversationId = session.getConversationId();
      const userId = session.getUserId();
      
      // 1. Send "thanksgiving dinner" to LogFoodFromText
      const logFoodFromText = container.getLogFoodFromText();
      
      console.log('\n📤 Sending: "thanksgiving dinner"');
      const startTime = Date.now();
      
      const result = await logFoodFromText.execute({
        userId,
        conversationId,
        text: 'thanksgiving dinner',
      });

      const elapsed = Date.now() - startTime;
      console.log(`⏱️  AI response time: ${elapsed}ms`);

      // 2. Validate the result
      expect(result.success).toBe(true);
      expect(result.nutrilogUuid).toBeDefined();
      expect(result.itemCount).toBeGreaterThan(1); // Should have multiple items

      // 3. Get the nutrilog and inspect items
      const nutrilogRepo = simulator.getNutrilogRepository();
      const nutriLog = await nutrilogRepo.findByUuid(result.nutrilogUuid);
      
      expect(nutriLog).toBeDefined();
      expect(nutriLog.status).toBe('pending');
      expect(nutriLog.items).toBeDefined();
      expect(Array.isArray(nutriLog.items)).toBe(true);
      expect(nutriLog.items.length).toBeGreaterThan(1);

      // Log the AI response for inspection
      console.log('\n📋 AI Response - Food Items:');
      console.log(JSON.stringify(nutriLog.items, null, 2));

      // 4. Validate each item has required fields
      for (const item of nutriLog.items) {
        expect(item.name).toBeDefined();
        expect(typeof item.name).toBe('string');
        expect(item.name.length).toBeGreaterThan(0);
        
        // Should have nutrition data
        expect(item.calories).toBeDefined();
        expect(typeof item.calories).toBe('number');
        expect(item.calories).toBeGreaterThanOrEqual(0);
      }

      // 5. Expect typical thanksgiving foods
      const itemNames = nutriLog.items.map(i => i.name.toLowerCase()).join(' ');
      const thanksgivingFoods = ['turkey', 'stuffing', 'mashed', 'gravy', 'cranberry', 'pie', 'potato', 'green bean', 'roll', 'corn', 'yam', 'sweet potato'];
      
      const foundFoods = thanksgivingFoods.filter(food => itemNames.includes(food));
      console.log(`\n✓ Found thanksgiving foods: ${foundFoods.join(', ')}`);
      
      // Should find at least 2 thanksgiving-related items
      expect(foundFoods.length).toBeGreaterThanOrEqual(2);

      // 6. Calculate totals
      const totals = nutriLog.items.reduce((acc, item) => ({
        calories: acc.calories + (item.calories || 0),
        protein: acc.protein + (item.protein || 0),
        carbs: acc.carbs + (item.carbs || 0),
        fat: acc.fat + (item.fat || 0),
      }), { calories: 0, protein: 0, carbs: 0, fat: 0 });

      console.log('\n📊 Totals:');
      console.log(`   Calories: ${totals.calories}`);
      console.log(`   Protein:  ${totals.protein}g`);
      console.log(`   Carbs:    ${totals.carbs}g`);
      console.log(`   Fat:      ${totals.fat}g`);

      // Thanksgiving dinner should be substantial
      expect(totals.calories).toBeGreaterThan(500);
    }, 30000); // 30 second timeout for API call

    it('should accept thanksgiving dinner and update nutrilist', async () => {
      const container = simulator.getContainer('nutribot');
      const session = simulator.getSession();
      session.setCurrentBot('nutribot');
      
      const conversationId = session.getConversationId();
      const userId = session.getUserId();
      
      // 1. Create pending log
      const logFoodFromText = container.getLogFoodFromText();
      
      console.log('\n📤 Sending: "thanksgiving dinner"');
      const logResult = await logFoodFromText.execute({
        userId,
        conversationId,
        text: 'thanksgiving dinner',
      });

      expect(logResult.success).toBe(true);
      console.log(`✓ Created pending log: ${logResult.nutrilogUuid}`);
      console.log(`  Items: ${logResult.itemCount}`);

      // 2. Verify pending status
      const nutrilogRepo = simulator.getNutrilogRepository();
      let nutriLog = await nutrilogRepo.findByUuid(logResult.nutrilogUuid);
      expect(nutriLog.status).toBe('pending');

      // 3. Accept the log
      const acceptFoodLog = container.getAcceptFoodLog();
      
      console.log('\n✅ Accepting log...');
      const acceptResult = await acceptFoodLog.execute({
        conversationId,
        logUuid: logResult.nutrilogUuid,
      });

      expect(acceptResult.success).toBe(true);
      console.log('✓ Log accepted');

      // 4. Verify nutrilog status changed to accepted
      nutriLog = await nutrilogRepo.findByUuid(logResult.nutrilogUuid);
      expect(nutriLog.status).toBe('accepted');
      console.log(`✓ NutriLog status: ${nutriLog.status}`);

      // 5. Verify items were added to nutrilist
      const nutrilistRepo = simulator.getNutrilistRepository();
      expect(nutrilistRepo.size).toBeGreaterThan(0);
      console.log(`✓ NutriList items: ${nutrilistRepo.size}`);

      // 6. Log final state
      const allItems = nutrilistRepo.getAll();
      console.log('\n📋 NutriList Contents:');
      for (const item of allItems) {
        console.log(`   • ${item.name}: ${item.calories} cal`);
      }
    }, 30000);

    it('should discard thanksgiving dinner and not add to nutrilist', async () => {
      const container = simulator.getContainer('nutribot');
      const session = simulator.getSession();
      session.setCurrentBot('nutribot');
      
      const conversationId = session.getConversationId();
      const userId = session.getUserId();
      
      // 1. Create pending log
      const logFoodFromText = container.getLogFoodFromText();
      
      console.log('\n📤 Sending: "thanksgiving dinner"');
      const logResult = await logFoodFromText.execute({
        userId,
        conversationId,
        text: 'thanksgiving dinner',
      });

      expect(logResult.success).toBe(true);
      
      // 2. Discard the log
      const discardFoodLog = container.getDiscardFoodLog();
      
      console.log('\n🗑️  Discarding log...');
      const discardResult = await discardFoodLog.execute({
        conversationId,
        logUuid: logResult.nutrilogUuid,
      });

      expect(discardResult.success).toBe(true);
      console.log('✓ Log discarded');

      // 3. Verify nutrilog status
      const nutrilogRepo = simulator.getNutrilogRepository();
      const nutriLog = await nutrilogRepo.findByUuid(logResult.nutrilogUuid);
      
      if (nutriLog) {
        expect(['discarded', 'rejected']).toContain(nutriLog.status);
        console.log(`✓ NutriLog status: ${nutriLog.status}`);
      } else {
        console.log('✓ NutriLog deleted');
      }

      // 4. Verify nutrilist is empty
      const nutrilistRepo = simulator.getNutrilistRepository();
      expect(nutrilistRepo.size).toBe(0);
      console.log(`✓ NutriList items: ${nutrilistRepo.size} (expected: 0)`);
    }, 30000);
  });

  describe('Various Food Inputs', () => {
    const testCases = [
      { input: 'a slice of pepperoni pizza', expectMinItems: 1, expectMinCalories: 200 },
      { input: 'grilled chicken salad with ranch dressing', expectMinItems: 2, expectMinCalories: 300 },
      { input: 'grande caramel latte from starbucks', expectMinItems: 1, expectMinCalories: 150 },
      { input: 'big mac meal with large fries and coke', expectMinItems: 3, expectMinCalories: 1000 },
    ];

    it.each(testCases)('should parse "$input"', async ({ input, expectMinItems, expectMinCalories }) => {
      const container = simulator.getContainer('nutribot');
      const session = simulator.getSession();
      session.setCurrentBot('nutribot');
      
      const conversationId = session.getConversationId();
      const userId = session.getUserId();
      
      const logFoodFromText = container.getLogFoodFromText();
      
      console.log(`\n📤 Sending: "${input}"`);
      const result = await logFoodFromText.execute({
        userId,
        conversationId,
        text: input,
      });

      expect(result.success).toBe(true);
      expect(result.itemCount).toBeGreaterThanOrEqual(expectMinItems);

      const nutrilogRepo = simulator.getNutrilogRepository();
      const nutriLog = await nutrilogRepo.findByUuid(result.nutrilogUuid);
      
      console.log('📋 Items:');
      let totalCals = 0;
      for (const item of nutriLog.items) {
        console.log(`   • ${item.name}: ${item.calories} cal`);
        totalCals += item.calories || 0;
      }
      console.log(`   Total: ${totalCals} cal`);

      expect(totalCals).toBeGreaterThanOrEqual(expectMinCalories);
    }, 30000);
  });

  describe('AI Response Format Validation', () => {
    it('should return properly formatted JSON with all fields', async () => {
      const container = simulator.getContainer('nutribot');
      const session = simulator.getSession();
      session.setCurrentBot('nutribot');
      
      const conversationId = session.getConversationId();
      const userId = session.getUserId();
      
      const logFoodFromText = container.getLogFoodFromText();
      
      const result = await logFoodFromText.execute({
        userId,
        conversationId,
        text: 'chicken breast with rice and broccoli',
      });

      const nutrilogRepo = simulator.getNutrilogRepository();
      const nutriLog = await nutrilogRepo.findByUuid(result.nutrilogUuid);

      console.log('\n📋 Raw AI Response Structure:');
      console.log(JSON.stringify(nutriLog.items, null, 2));

      for (const item of nutriLog.items) {
        // Required fields
        expect(item).toHaveProperty('name');
        expect(typeof item.name).toBe('string');
        
        // Nutrition fields (should all be numbers)
        expect(typeof item.calories).toBe('number');
        
        // Optional but expected fields
        if (item.protein !== undefined) {
          expect(typeof item.protein).toBe('number');
        }
        if (item.carbs !== undefined) {
          expect(typeof item.carbs).toBe('number');
        }
        if (item.fat !== undefined) {
          expect(typeof item.fat).toBe('number');
        }
        if (item.grams !== undefined) {
          expect(typeof item.grams).toBe('number');
        }
      }
    }, 30000);
  });
});

// Always-run test to check configuration
describe('Real AI Configuration', () => {
  it('should report API key status', () => {
    if (hasRealAPIKey) {
      console.log('✓ OPENAI_API_KEY is set');
      expect(process.env.OPENAI_API_KEY).toBeDefined();
      expect(process.env.OPENAI_API_KEY.length).toBeGreaterThan(10);
    } else {
      console.log('⚠️  OPENAI_API_KEY is not set - real AI tests will be skipped');
      console.log('   Set it with: export OPENAI_API_KEY=sk-...');
    }
  });
});
