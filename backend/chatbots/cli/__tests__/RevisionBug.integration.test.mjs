/**
 * Revision Bug Reproduction Test
 * @module cli/__tests__/RevisionBug.integration.test
 * 
 * Exact replication of the Telegram revision flow issue:
 * 1. Input "1 apple"
 * 2. Wait for analysis 
 * 3. Press revise button
 * 4. Input "double that" THROUGH THE ROUTER (not direct use case)
 * 5. Check response
 * 
 * CRITICAL: This test must go through UnifiedEventRouter to catch routing bugs!
 * 
 * Run with:
 * cd /Users/kckern/Documents/GitHub/DaylightStation
 * NODE_OPTIONS=--experimental-vm-modules npm test -- --testPathPattern="RevisionBug.integration"
 */

import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Set up process.env before importing anything else
import { hydrateProcessEnvFromConfigs } from '../../../lib/logging/config.js';
hydrateProcessEnvFromConfigs(path.join(__dirname, '../../../..'));

// Import the CLI simulator
import { CLIChatSimulator } from '../CLIChatSimulator.mjs';

// Import the router to test the full flow
import { UnifiedEventRouter } from '../../application/routing/UnifiedEventRouter.mjs';
import { createInputEvent, InputEventType } from '../../application/ports/IInputEvent.mjs';

// Check if we have a real API key
const secretsPath = path.join(__dirname, '../../../../config.secrets.yml');
const hasRealAPIKey = !!process.env.OPENAI_API_KEY || fs.existsSync(secretsPath);
const describeIfRealAI = hasRealAPIKey ? describe : describe.skip;

// Increase timeout for real AI calls
jest.setTimeout(120000);

describeIfRealAI('Revision Bug Reproduction (Real AI)', () => {
  let simulator;
  let nutribot;
  let conversationId;
  let userId;
  let stateStore;
  let nutrilogRepo;

  beforeAll(async () => {
    console.log('\n🐛 Setting up revision bug reproduction test...\n');
    
    // Clean up test data from previous runs
    const testDataPath = path.join(process.cwd(), 'backend/data/_tmp');
    if (fs.existsSync(testDataPath)) {
      console.log('   🧹 Cleaning up previous test data...');
      fs.rmSync(testDataPath, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    // Fresh simulator for each test
    simulator = new CLIChatSimulator({
      sessionName: `revision-bug-${Date.now()}`,
      testMode: true,
      useRealAI: true,
      bot: 'nutribot',
      debug: true, // Enable debug logging
    });

    await simulator.initialize();
    
    nutribot = simulator.getContainer('nutribot');
    stateStore = simulator.getConversationStateStore();
    nutrilogRepo = nutribot.getNutrilogRepository();
    
    const session = simulator.getSession();
    session.setCurrentBot('nutribot');
    conversationId = session.getConversationId();
    userId = session.getUserId();
    
    console.log(`   Session: ${conversationId}`);
    console.log(`   User: ${userId}\n`);
  });

  afterAll(async () => {
    if (simulator) {
      await simulator.stop();
    }
  });

  it('should revise "1 apple" with "double that" using ProcessRevisionInput', async () => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🐛 BUG REPRODUCTION: 1 apple → revise → "double that"');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // ═══════════════════════════════════════════════════════════════════
    // STEP 1: Log "1 apple"
    // ═══════════════════════════════════════════════════════════════════
    console.log('STEP 1: Input "1 apple"...');
    
    const logFoodFromText = nutribot.getLogFoodFromText();
    const logResult = await logFoodFromText.execute({
      userId,
      conversationId,
      text: '1 apple',
    });

    console.log('   logResult:', JSON.stringify(logResult, null, 2));
    
    expect(logResult.success).toBe(true);
    expect(logResult.nutrilogUuid).toBeDefined();
    
    const appleLogUuid = logResult.nutrilogUuid;
    console.log(`   ✅ Logged (UUID: ${appleLogUuid})`);
    
    // Check what was logged
    const appleLog = await nutrilogRepo.findByUuid(appleLogUuid);
    console.log(`   📦 Items: ${JSON.stringify(appleLog?.items, null, 2)}`);
    
    // Verify the item has proper label field
    expect(appleLog.items[0].label).toBeDefined();
    expect(appleLog.items[0].label.toLowerCase()).toContain('apple');
    console.log(`   ✅ Item label verified: ${appleLog.items[0].label}`);

    // ═══════════════════════════════════════════════════════════════════
    // STEP 2: Press revise button
    // ═══════════════════════════════════════════════════════════════════
    console.log('\nSTEP 2: Press revise button...');
    
    const reviseFoodLog = nutribot.getReviseFoodLog();
    const reviseResult = await reviseFoodLog.execute({
      userId,
      conversationId,
      logUuid: appleLogUuid,
      messageId: 'test-msg-1',
    });

    console.log('   reviseResult:', JSON.stringify(reviseResult, null, 2));
    expect(reviseResult.success).toBe(true);
    
    // Verify the revision message shows proper food name, NOT "undefined"
    expect(reviseResult.message).toBeDefined();
    expect(reviseResult.message).not.toContain('undefined');
    expect(reviseResult.message.toLowerCase()).toContain('apple');
    console.log('   ✅ Revision mode activated');
    console.log(`   ✅ Message does NOT contain "undefined"`);

    // ═══════════════════════════════════════════════════════════════════
    // STEP 3: Check conversation state
    // ═══════════════════════════════════════════════════════════════════
    console.log('\nSTEP 3: Check conversation state...');
    
    const stateAfterRevise = await stateStore.get(conversationId);
    console.log('   State after revise:', JSON.stringify(stateAfterRevise, null, 2));
    
    expect(stateAfterRevise).toBeDefined();
    expect(stateAfterRevise.activeFlow).toBe('revision');
    expect(stateAfterRevise.flowState).toBeDefined();
    expect(stateAfterRevise.flowState.pendingLogUuid).toBe(appleLogUuid);
    console.log(`   ✅ State correct: activeFlow=${stateAfterRevise.activeFlow}, pendingLogUuid=${stateAfterRevise.flowState?.pendingLogUuid}`);

    // ═══════════════════════════════════════════════════════════════════
    // STEP 4: Input "double that" THROUGH THE ROUTER (like Telegram does!)
    // ═══════════════════════════════════════════════════════════════════
    console.log('\nSTEP 4: Input "double that" THROUGH ROUTER (not direct use case)...');
    
    // Create a router with the nutribot container - this is what Telegram does!
    const router = new UnifiedEventRouter(nutribot);
    
    // Create an input event like Telegram would
    const revisionEvent = createInputEvent({
      type: InputEventType.TEXT,
      channel: 'cli',
      userId,
      conversationId,
      messageId: 'test-msg-2',
      payload: { text: 'double that' },
    });

    // Route through the router - this should detect revision state and call ProcessRevisionInput
    const revisionResult = await router.route(revisionEvent);

    console.log('   revisionResult:', JSON.stringify(revisionResult, null, 2));

    // ═══════════════════════════════════════════════════════════════════
    // STEP 5: Check response - should NOT be "couldn't identify food"
    // ═══════════════════════════════════════════════════════════════════
    console.log('\nSTEP 5: Check response...');
    
    expect(revisionResult.success).toBe(true);
    expect(revisionResult.logUuid).toBeDefined();
    
    // Check the revised log
    const revisedLog = await nutrilogRepo.findByUuid(revisionResult.logUuid);
    console.log('   Revised log items:', JSON.stringify(revisedLog?.items, null, 2));
    
    // Verify quantity was doubled (should be 2 apples now)
    const hasDoubled = revisedLog?.items?.some(item => {
      const qty = item.quantity || item.amount || 1;
      return qty >= 2; // Should be 2 apples now
    });
    
    console.log(`   ✅ Revision result: ${revisionResult.success ? 'SUCCESS' : 'FAILED'}`);
    if (revisedLog?.items) {
      console.log(`   📦 Final items: ${revisedLog.items.map(i => `${i.amount || i.quantity || 1} ${i.label || i.name}`).join(', ')}`);
    }
    
    expect(hasDoubled).toBe(true);
  });

  it('should route revision text through UnifiedEventRouter correctly', async () => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🐛 ROUTER TEST: Verify router detects revision state');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // STEP 1: Log "1 apple"
    console.log('STEP 1: Log "1 apple"...');
    const logFoodFromText = nutribot.getLogFoodFromText();
    const logResult = await logFoodFromText.execute({
      userId,
      conversationId,
      text: '1 apple',
    });
    const appleLogUuid = logResult.nutrilogUuid;
    console.log(`   ✅ Logged (UUID: ${appleLogUuid})`);

    // STEP 2: Enable revision mode
    console.log('\nSTEP 2: Enable revision mode...');
    const reviseFoodLog = nutribot.getReviseFoodLog();
    await reviseFoodLog.execute({
      userId,
      conversationId,
      logUuid: appleLogUuid,
      messageId: 'test-msg-1',
    });
    console.log('   ✅ Revision mode enabled');

    // STEP 3: Check state before revision
    console.log('\nSTEP 3: State BEFORE routing...');
    const stateBefore = await stateStore.get(conversationId);
    console.log('   activeFlow:', stateBefore?.activeFlow);
    console.log('   flowState:', JSON.stringify(stateBefore?.flowState, null, 2));
    
    expect(stateBefore).toBeDefined();
    expect(stateBefore.activeFlow).toBe('revision');
    expect(stateBefore.flowState?.pendingLogUuid).toBe(appleLogUuid);

    // STEP 4: Route "double that" THROUGH THE ROUTER - this is the critical test!
    console.log('\nSTEP 4: Route "double that" through UnifiedEventRouter...');
    
    const router = new UnifiedEventRouter(nutribot);
    const revisionEvent = createInputEvent({
      type: InputEventType.TEXT,
      channel: 'cli',
      userId,
      conversationId,
      messageId: 'test-msg-2',
      payload: { text: 'double that' },
    });

    const result = await router.route(revisionEvent);
    
    console.log('   Result:', JSON.stringify(result, null, 2));
    
    // If this fails with itemCount: 0 or no logUuid, the router isn't detecting revision state
    if (!result.success) {
      console.log('\n   ❌ BUG: Router failed to route to ProcessRevisionInput');
      console.log(`   Error: ${result.error}`);
    } else if (result.itemCount === 0) {
      console.log('\n   ❌ BUG: Router went to LogFoodFromText instead of ProcessRevisionInput');
    } else {
      console.log('\n   ✅ Router correctly detected revision state');
    }
    
    expect(result.success).toBe(true);
    expect(result.logUuid).toBeDefined(); // ProcessRevisionInput returns logUuid, LogFoodFromText returns nutrilogUuid
  });
});
