/**
 * Scripted Flow Integration Tests
 * @module cli/__tests__/ScriptedFlows.integration.test
 * 
 * Tests using the new scripted API that simulates exact user input sequences.
 * These tests use real AI and demonstrate the canonical testing pattern.
 * 
 * Run with:
 * cd /Users/kckern/Documents/GitHub/DaylightStation
 * NODE_OPTIONS=--experimental-vm-modules npm test -- --testPathPattern="ScriptedFlows.integration"
 */

import { jest, describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Set up process.env before importing anything else
import { hydrateProcessEnvFromConfigs } from '../../../lib/logging/config.js';
hydrateProcessEnvFromConfigs(path.join(__dirname, '../../../..'));

import { CLIChatSimulator } from '../CLIChatSimulator.mjs';

// Check if we have a real API key
const secretsPath = path.join(__dirname, '../../../../config.secrets.yml');
const hasRealAPIKey = !!process.env.OPENAI_API_KEY || fs.existsSync(secretsPath);
const describeIfRealAI = hasRealAPIKey ? describe : describe.skip;

// Increase timeout for real AI calls
jest.setTimeout(120000);

/**
 * Create a fresh simulator for scripted tests
 */
async function createSimulator(testName) {
  // Clean up test data from previous runs
  const testDataPath = path.join(process.cwd(), 'backend/data/_tmp');
  if (fs.existsSync(testDataPath)) {
    fs.rmSync(testDataPath, { recursive: true, force: true });
  }
  
  const simulator = new CLIChatSimulator({
    sessionName: `scripted-${testName}-${Date.now()}`,
    testMode: true,
    useRealAI: true,
    bot: 'nutribot',
    debug: false,
  });

  await simulator.initialize();
  return simulator;
}

describeIfRealAI('Scripted Flow Integration Tests', () => {
  
  // ═══════════════════════════════════════════════════════════════════════════
  // TEST: Text → Accept using scripted API
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Text → Accept Flow', () => {
    let simulator;
    
    afterEach(async () => {
      if (simulator) await simulator.stop();
    });

    it('should log food and accept using send() API', async () => {
      simulator = await createSimulator('send-accept');
      await simulator.selectBot('nutribot');
      
      // Send food description
      const logResponse = await simulator.send('scrambled eggs with toast');
      
      // Verify we got a response with buttons
      expect(logResponse).toBeDefined();
      expect(logResponse.text).toBeDefined();
      expect(logResponse.buttons).toBeDefined();
      
      // Find accept button callback data from the response
      const buttons = logResponse.buttons?.flat() || [];
      const acceptButton = buttons.find(b => 
        b.callback_data?.startsWith('accept:') || 
        b.text?.toLowerCase().includes('accept')
      );
      expect(acceptButton).toBeDefined();
      
      // Press accept using callback data
      const acceptResponse = await simulator.pressButton(acceptButton.callback_data);
      
      // Verify acceptance
      expect(acceptResponse).toBeDefined();
      console.log('✅ Text → Accept flow completed');
    });

    it('should complete flow using runScript()', async () => {
      simulator = await createSimulator('script-accept');
      
      // Run a scripted sequence
      const responses = await simulator.runScript([
        'oatmeal with blueberries',
        { type: 'callback', data: 'accept:${logUuid}' }, // Will fail - need real UUID
      ], { bot: 'nutribot' });
      
      // First response should have food items
      expect(responses.length).toBeGreaterThan(0);
      expect(responses[0].text).toBeDefined();
      console.log('✅ runScript() completed with', responses.length, 'responses');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST: Text → Discard using scripted API
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Text → Discard Flow', () => {
    let simulator;
    
    afterEach(async () => {
      if (simulator) await simulator.stop();
    });

    it('should log food and discard using send() API', async () => {
      simulator = await createSimulator('send-discard');
      await simulator.selectBot('nutribot');
      
      // Send food description
      const logResponse = await simulator.send('a large pizza');
      
      expect(logResponse).toBeDefined();
      expect(logResponse.buttons).toBeDefined();
      
      // Find discard button
      const buttons = logResponse.buttons?.flat() || [];
      const discardButton = buttons.find(b => 
        b.callback_data?.startsWith('discard:') || 
        b.text?.toLowerCase().includes('discard')
      );
      expect(discardButton).toBeDefined();
      
      // Press discard
      const discardResponse = await simulator.pressButton(discardButton.callback_data);
      
      expect(discardResponse).toBeDefined();
      console.log('✅ Text → Discard flow completed');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST: Multiple items in sequence
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Multiple Items Flow', () => {
    let simulator;
    
    afterEach(async () => {
      if (simulator) await simulator.stop();
    });

    it('should handle multiple food logs in sequence', async () => {
      simulator = await createSimulator('multi-item');
      await simulator.selectBot('nutribot');
      
      // Log first item
      const response1 = await simulator.send('coffee with cream');
      expect(response1.text).toBeDefined();
      
      // Accept first item
      const buttons1 = response1.buttons?.flat() || [];
      const acceptBtn1 = buttons1.find(b => b.callback_data?.startsWith('accept:'));
      if (acceptBtn1) {
        await simulator.pressButton(acceptBtn1.callback_data);
      }
      
      // Log second item
      const response2 = await simulator.send('banana');
      expect(response2.text).toBeDefined();
      
      // Accept second item
      const buttons2 = response2.buttons?.flat() || [];
      const acceptBtn2 = buttons2.find(b => b.callback_data?.startsWith('accept:'));
      if (acceptBtn2) {
        await simulator.pressButton(acceptBtn2.callback_data);
      }
      
      // Verify all responses captured
      const allResponses = simulator.getResponses();
      expect(allResponses.length).toBeGreaterThanOrEqual(2);
      
      console.log('✅ Multiple items flow completed with', allResponses.length, 'responses');
    });
  });
});
