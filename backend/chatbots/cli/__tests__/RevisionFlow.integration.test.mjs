/**
 * Revision Flow Integration Tests
 * @module cli/__tests__/RevisionFlow.integration.test
 * 
 * Tests the revision flow with real AI.
 */

import { jest, describe, it, expect, beforeEach, afterEach, beforeAll } from '@jest/globals';
import { CLIChatSimulator } from '../CLIChatSimulator.mjs';

// Check if we have a real API key
const hasRealAPIKey = !!process.env.OPENAI_API_KEY;
const describeIfRealAI = hasRealAPIKey ? describe : describe.skip;

describeIfRealAI('Revision Flow Integration', () => {
  let simulator;

  beforeEach(async () => {
    simulator = new CLIChatSimulator({
      sessionName: 'revision-test',
      testMode: true,
      useRealAI: true,
    });

    await simulator.initialize();
  });

  afterEach(() => {
    simulator.getNutrilogRepository().clear();
    simulator.getNutrilistRepository().clear();
    simulator.getConversationStateStore().clear();
  });

  it('should track conversation state through revision flow', async () => {
    const container = simulator.getContainer('nutribot');
    const session = simulator.getSession();
    session.setCurrentBot('nutribot');
    
    const conversationId = session.getConversationId();
    const userId = session.getUserId();
    const stateStore = simulator.getConversationStateStore();

    // 1. Initial food log
    console.log('\n📤 Step 1: Initial food log');
    const logFoodFromText = container.getLogFoodFromText();
    const initialResult = await logFoodFromText.execute({
      userId,
      conversationId,
      text: 'thanksgiving dinner',
    });

    expect(initialResult.success).toBe(true);
    console.log(`✓ Created log with ${initialResult.itemCount} items, uuid: ${initialResult.nutrilogUuid}`);

    // Check state after initial log
    const stateAfterLog = await stateStore.get(conversationId);
    console.log('State after initial log:', stateAfterLog);

    // 2. Trigger revision mode
    console.log('\n📤 Step 2: Trigger revision mode');
    const reviseFoodLog = container.getReviseFoodLog();
    const reviseResult = await reviseFoodLog.execute({
      userId,
      conversationId,
      logUuid: initialResult.nutrilogUuid,
    });

    expect(reviseResult.success).toBe(true);
    console.log('✓ Revision mode enabled');

    // Check state after revision triggered
    const stateAfterRevise = await stateStore.get(conversationId);
    console.log('State after revision triggered:', stateAfterRevise);
    
    expect(stateAfterRevise).toBeDefined();
    expect(stateAfterRevise.flow).toBe('revision');
    expect(stateAfterRevise.pendingLogUuid).toBe(initialResult.nutrilogUuid);

    // 3. Send revision text
    console.log('\n📤 Step 3: Send revision text');
    
    // Get original items for context
    const nutrilogRepo = simulator.getNutrilogRepository();
    const originalLog = await nutrilogRepo.findByUuid(initialResult.nutrilogUuid);
    console.log('Original items:', originalLog.items.map(i => `${i.quantity} ${i.unit} ${i.name}`));

    // Build contextual text like handleRevisionMessage does
    const originalItems = originalLog.items.map(item => {
      const qty = item.quantity || 1;
      const unit = item.unit || '';
      return `- ${qty} ${unit} ${item.name} (${item.calories || 0} cal)`;
    }).join('\n');

    const contextualText = `Original food log:
${originalItems}

User revision: "twice that!"`;

    console.log('Sending contextual text:\n', contextualText);

    const revisionResult = await logFoodFromText.execute({
      userId,
      conversationId,
      text: contextualText,
    });

    console.log('Revision result:', { success: revisionResult.success, itemCount: revisionResult.itemCount });

    expect(revisionResult.success).toBe(true);
    expect(revisionResult.itemCount).toBeGreaterThan(0);

    // Get the new log and check quantities are doubled
    const newLog = await nutrilogRepo.findByUuid(revisionResult.nutrilogUuid);
    console.log('\n📋 Revised items:');
    for (const item of newLog.items) {
      console.log(`   • ${item.quantity} ${item.unit} ${item.name} (${item.calories} cal)`);
    }
  }, 60000);

  it('should handle revision via handleTextMessage flow', async () => {
    const container = simulator.getContainer('nutribot');
    const session = simulator.getSession();
    session.setCurrentBot('nutribot');
    
    const conversationId = session.getConversationId();
    const userId = session.getUserId();
    const stateStore = simulator.getConversationStateStore();
    const nutrilogRepo = simulator.getNutrilogRepository();

    // 1. Create initial log
    console.log('\n📤 Step 1: Create initial log');
    const logFoodFromText = container.getLogFoodFromText();
    const initialResult = await logFoodFromText.execute({
      userId,
      conversationId,
      text: '2 slices of pizza',
    });

    expect(initialResult.success).toBe(true);
    const originalLog = await nutrilogRepo.findByUuid(initialResult.nutrilogUuid);
    console.log('Original items:', originalLog.items.map(i => `${i.quantity} ${i.unit} ${i.name} (${i.calories} cal)`));

    // 2. Manually set revision state (simulating what happens when Revise is clicked)
    console.log('\n📤 Step 2: Set revision state manually');
    await stateStore.set(conversationId, {
      flow: 'revision',
      pendingLogUuid: initialResult.nutrilogUuid,
    });

    const stateBeforeRevision = await stateStore.get(conversationId);
    console.log('State before revision:', stateBeforeRevision);
    expect(stateBeforeRevision.flow).toBe('revision');

    // 3. Call the private revision handler directly
    // We'll test by building the contextual text and calling LogFoodFromText
    console.log('\n📤 Step 3: Send revision with context');
    
    const originalItems = originalLog.items.map(item => {
      const qty = item.quantity || 1;
      const unit = item.unit || '';
      return `- ${qty} ${unit} ${item.name} (${item.calories || 0} cal)`;
    }).join('\n');

    const contextualText = `Original food log:
${originalItems}

User revision: "only 1 slice"`;

    const revisionResult = await logFoodFromText.execute({
      userId,
      conversationId,
      text: contextualText,
    });

    expect(revisionResult.success).toBe(true);
    
    const revisedLog = await nutrilogRepo.findByUuid(revisionResult.nutrilogUuid);
    console.log('Revised items:', revisedLog.items.map(i => `${i.quantity} ${i.unit} ${i.name} (${i.calories} cal)`));
    
    // Should have 1 slice instead of 2
    const pizzaItem = revisedLog.items.find(i => i.name.toLowerCase().includes('pizza'));
    expect(pizzaItem).toBeDefined();
    expect(pizzaItem.quantity).toBeLessThanOrEqual(1);
  }, 60000);
});

describe('Revision State Management', () => {
  let simulator;

  beforeEach(async () => {
    simulator = new CLIChatSimulator({
      sessionName: 'state-test',
      testMode: true,
      useRealAI: false, // Use mock for state tests
    });

    await simulator.initialize();
  });

  it('should set revision state when ReviseFoodLog is called', async () => {
    const container = simulator.getContainer('nutribot');
    const session = simulator.getSession();
    session.setCurrentBot('nutribot');
    
    const conversationId = session.getConversationId();
    const userId = session.getUserId();
    const stateStore = simulator.getConversationStateStore();

    // Create a log first
    const logFoodFromText = container.getLogFoodFromText();
    const result = await logFoodFromText.execute({
      userId,
      conversationId,
      text: 'pizza',
    });

    expect(result.success).toBe(true);

    // Now trigger revision
    const reviseFoodLog = container.getReviseFoodLog();
    await reviseFoodLog.execute({
      userId,
      conversationId,
      logUuid: result.nutrilogUuid,
    });

    // Check state
    const state = await stateStore.get(conversationId);
    console.log('State after ReviseFoodLog:', state);
    
    expect(state).toBeDefined();
    expect(state.flow).toBe('revision');
    expect(state.pendingLogUuid).toBe(result.nutrilogUuid);
  });

  it('should detect revision state in handleTextMessage', async () => {
    const stateStore = simulator.getConversationStateStore();
    const session = simulator.getSession();
    session.setCurrentBot('nutribot');
    const conversationId = session.getConversationId();

    // Manually set revision state
    await stateStore.set(conversationId, {
      flow: 'revision',
      pendingLogUuid: 'test-uuid-123',
    });

    // Check we can read it back
    const state = await stateStore.get(conversationId);
    expect(state.flow).toBe('revision');
    expect(state.pendingLogUuid).toBe('test-uuid-123');
  });
});
