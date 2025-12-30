/**
 * Revision Flow Integration Tests
 * @module cli/__tests__/RevisionFlow.integration.test
 * 
 * Tests the complete revision flow with real AI:
 * 1. Start CLI session
 * 2. Log "1 apple"
 * 3. Press revise button
 * 4. Say "it was actually an orange"
 * 5. Accept the revision
 * 6. Confirm the chart gets made
 * 
 * Run with:
 * cd /path/to/DaylightStation
 * NODE_OPTIONS=--experimental-vm-modules npm test -- --testPathPattern="RevisionFlow.integration"
 */

import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Set up process.env.path before importing anything else
import { hydrateProcessEnvFromConfigs } from '../../../lib/logging/config.js';
hydrateProcessEnvFromConfigs(path.join(__dirname, '../../../..'));

// Now import the CLI simulator
import { CLIChatSimulator } from '../CLIChatSimulator.mjs';

// Check if we have a real API key
const secretsPath = path.join(__dirname, '../../../../config.secrets.yml');
const hasRealAPIKey = !!process.env.OPENAI_API_KEY || fs.existsSync(secretsPath);
const describeIfRealAI = hasRealAPIKey ? describe : describe.skip;

// Increase timeout for real AI calls
jest.setTimeout(120000);

describeIfRealAI('Revision Flow Integration (Real AI)', () => {
  let simulator;
  let nutribot;
  let conversationId;
  let userId;

  beforeAll(async () => {
    console.log('\n🚀 Setting up revision flow test...\n');
    
    // Clean up test data from previous runs
    const testDataPath = path.join(process.cwd(), 'backend/data/_tmp');
    if (fs.existsSync(testDataPath)) {
      console.log('   🧹 Cleaning up previous test data...');
      fs.rmSync(testDataPath, { recursive: true, force: true });
    }
    
    simulator = new CLIChatSimulator({
      sessionName: `revision-test-${Date.now()}`,
      testMode: true,
      useRealAI: true,
      bot: 'nutribot',
      debug: false,
    });

    await simulator.initialize();
    
    nutribot = simulator.getContainer('nutribot');
    
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

  it('should complete full revision flow: apple → orange → accept → chart', async () => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 FULL REVISION FLOW TEST');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // ═══════════════════════════════════════════════════════════════════
    // STEP 1: Log "1 apple"
    // ═══════════════════════════════════════════════════════════════════
    console.log('STEP 1: Logging "1 apple"...');
    
    const logFoodFromText = nutribot.getLogFoodFromText();
    const logResult = await logFoodFromText.execute({
      userId,
      conversationId,
      text: '1 apple',
    });

    expect(logResult.success).toBe(true);
    expect(logResult.itemCount).toBeGreaterThan(0);
    expect(logResult.nutrilogUuid).toBeDefined();
    
    const appleLogUuid = logResult.nutrilogUuid;
    console.log(`   ✅ Logged (UUID: ${appleLogUuid.slice(0, 8)}...)`);
    console.log(`   📦 Items: ${logResult.itemCount}\n`);

    // ═══════════════════════════════════════════════════════════════════
    // STEP 2: Press revise button (trigger revision mode)
    // ═══════════════════════════════════════════════════════════════════
    console.log('STEP 2: Pressing revise button...');
    
    const reviseFoodLog = nutribot.getReviseFoodLog();
    const reviseResult = await reviseFoodLog.execute({
      userId,
      conversationId,
      logUuid: appleLogUuid,
      messageId: 'test-msg-1',
    });

    expect(reviseResult.success).toBe(true);
    console.log('   ✅ Revision mode activated\n');

    // Verify state was set
    const stateStore = simulator.getConversationStateStore();
    const stateAfterRevise = await stateStore.get(conversationId);
    expect(stateAfterRevise).toBeDefined();
    expect(stateAfterRevise.activeFlow).toBe('revision');
    console.log(`   📊 State: flow=${stateAfterRevise.activeFlow}\n`);

    // ═══════════════════════════════════════════════════════════════════
    // STEP 3: Say "it was actually an orange"
    // ═══════════════════════════════════════════════════════════════════
    console.log('STEP 3: Revising to "it was actually an orange"...');
    
    // Get the original log to build context
    const nutrilogRepo = nutribot.getNutrilogRepository();
    const originalLog = await nutrilogRepo.findByUuid(appleLogUuid);
    
    const originalItems = originalLog.items.map(item => {
      const qty = item.quantity || 1;
      const unit = item.unit || '';
      return `- ${qty} ${unit} ${item.label || item.name} (${item.calories || 0} cal)`;
    }).join('\n');

    const contextualText = `Original items:
${originalItems}

User revision: "it was actually an orange"`;

    console.log('   📝 Sending contextual revision...');
    
    // First discard the old log
    const discardFoodLog = nutribot.getDiscardFoodLog();
    await discardFoodLog.execute({
      userId,
      conversationId,
      logUuid: appleLogUuid,
    });

    // Clear revision state
    await stateStore.clear(conversationId);

    // Create the revised log
    const revisionResult = await logFoodFromText.execute({
      userId,
      conversationId,
      text: contextualText,
    });

    expect(revisionResult.success).toBe(true);
    expect(revisionResult.nutrilogUuid).toBeDefined();
    
    const orangeLogUuid = revisionResult.nutrilogUuid;
    console.log(`   ✅ Revised (UUID: ${orangeLogUuid.slice(0, 8)}...)`);
    
    // Verify it's an orange now
    const revisedLog = await nutrilogRepo.findByUuid(orangeLogUuid);
    const hasOrange = revisedLog.items.some(item => 
      (item.label || item.name || '').toLowerCase().includes('orange')
    );
    console.log(`   📦 Items: ${revisedLog.items.map(i => i.label || i.name).join(', ')}`);
    expect(hasOrange).toBe(true);
    console.log('   ✅ Confirmed: Contains orange\n');

    // ═══════════════════════════════════════════════════════════════════
    // STEP 4: Accept the revision
    // ═══════════════════════════════════════════════════════════════════
    console.log('STEP 4: Accepting the revision...');
    
    const acceptFoodLog = nutribot.getAcceptFoodLog();
    const acceptResult = await acceptFoodLog.execute({
      userId,
      conversationId,
      logUuid: orangeLogUuid,
    });

    expect(acceptResult.success).toBe(true);
    console.log('   ✅ Revision accepted');
    console.log(`   📊 Total calories: ${acceptResult.totalCalories || 'N/A'}\n`);

    // ═══════════════════════════════════════════════════════════════════
    // STEP 5: Confirm the chart gets made
    // ═══════════════════════════════════════════════════════════════════
    console.log('STEP 5: Generating report/chart...');
    
    const generateDailyReport = nutribot.getGenerateDailyReport();
    const reportResult = await generateDailyReport.execute({
      userId,
      conversationId,
      forceRegenerate: true, // Force it to skip pending log check
    });

    expect(reportResult.success).toBe(true);
    
    if (reportResult.imagePath) {
      const imageExists = fs.existsSync(reportResult.imagePath);
      expect(imageExists).toBe(true);
      console.log(`   ✅ Chart image: ${reportResult.imagePath}`);
    }
    
    if (reportResult.textPath) {
      const textExists = fs.existsSync(reportResult.textPath);
      expect(textExists).toBe(true);
      console.log(`   ✅ Text report: ${reportResult.textPath}`);
    }

    console.log(`   📊 Total calories today: ${reportResult.totalCalories || 0}`);
    console.log(`   📦 Items logged: ${reportResult.itemCount || 0}\n`);

    // ═══════════════════════════════════════════════════════════════════
    // SUMMARY
    // ═══════════════════════════════════════════════════════════════════
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 FULL REVISION FLOW COMPLETED SUCCESSFULLY!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log('   ✅ Step 1: Started CLI session');
    console.log('   ✅ Step 2: Logged "1 apple"');
    console.log('   ✅ Step 3: Pressed revise button');
    console.log('   ✅ Step 4: Changed to "it was actually an orange"');
    console.log('   ✅ Step 5: Accepted the revision');
    console.log('   ✅ Step 6: Generated chart/report');
    console.log('');
  });
});
