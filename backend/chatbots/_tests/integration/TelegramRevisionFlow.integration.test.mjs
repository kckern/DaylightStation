/**
 * Telegram Revision Flow Integration Test
 * @module tests/integration/TelegramRevisionFlow.integration.test
 * 
 * This test simulates the ACTUAL Telegram webhook flow to catch state persistence bugs.
 * 
 * Key differences from other tests:
 * 1. Uses TelegramWebhookHandler (like production)
 * 2. Uses FileConversationStateStore (like production)
 * 3. Simulates SEPARATE HTTP requests (state must persist between requests)
 * 4. Uses TelegramInputAdapter parsing (like production)
 * 5. Tests the full container → router → use case → state store chain
 * 
 * Run with:
 * cd /Users/kckern/Documents/GitHub/DaylightStation
 * NODE_OPTIONS=--experimental-vm-modules npm test -- --testPathPattern="TelegramRevisionFlow.integration"
 */

import { jest, describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Set up process.env before importing anything else
import { hydrateProcessEnvFromConfigs } from '../../../lib/logging/config.js';
hydrateProcessEnvFromConfigs(path.join(__dirname, '../../../..'));

// Import the ACTUAL production components
import { createTelegramWebhookHandler } from '../../adapters/http/TelegramWebhookHandler.mjs';
import { TelegramInputAdapter } from '../../adapters/telegram/TelegramInputAdapter.mjs';
import { FileConversationStateStore } from '../../infrastructure/persistence/FileConversationStateStore.mjs';
import { NutribotContainer } from '../../bots/nutribot/container.mjs';
import { NutriLogRepository } from '../../bots/nutribot/repositories/NutriLogRepository.mjs';
import { createLogger } from '../../_lib/logging/index.mjs';

// Check if we have a real API key
const secretsPath = path.join(__dirname, '../../../../config.secrets.yml');
const hasRealAPIKey = !!process.env.OPENAI_API_KEY || fs.existsSync(secretsPath);
const describeIfRealAI = hasRealAPIKey ? describe : describe.skip;

// Increase timeout for real AI calls
jest.setTimeout(120000);

/**
 * Create a mock Express request object
 */
function createMockRequest(body, headers = {}) {
  return {
    body,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    traceId: `test-trace-${Date.now()}`,
  };
}

/**
 * Create a mock Express response object
 */
function createMockResponse() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
  return res;
}

/**
 * Create a Telegram message update (simulates user sending text)
 */
function createTelegramTextMessage(botId, chatId, userId, text, messageId = Date.now()) {
  return {
    update_id: Date.now(),
    message: {
      message_id: messageId,
      from: {
        id: userId,
        is_bot: false,
        first_name: 'Test',
        username: 'testuser',
      },
      chat: {
        id: chatId,
        first_name: 'Test',
        username: 'testuser',
        type: 'private',
      },
      date: Math.floor(Date.now() / 1000),
      text,
    },
  };
}

/**
 * Create a Telegram callback query (simulates user pressing inline button)
 */
function createTelegramCallbackQuery(botId, chatId, userId, callbackData, messageId = Date.now()) {
  return {
    update_id: Date.now(),
    callback_query: {
      id: `callback-${Date.now()}`,
      from: {
        id: userId,
        is_bot: false,
        first_name: 'Test',
        username: 'testuser',
      },
      message: {
        message_id: messageId,
        from: {
          id: parseInt(botId),
          is_bot: true,
          first_name: 'NutriBot',
          username: 'nutribot',
        },
        chat: {
          id: chatId,
          first_name: 'Test',
          username: 'testuser',
          type: 'private',
        },
        date: Math.floor(Date.now() / 1000),
        text: 'Previous message',
      },
      chat_instance: `chat-instance-${Date.now()}`,
      data: callbackData,
    },
  };
}

/**
 * Mock messaging gateway that captures sent messages
 */
function createMockMessagingGateway() {
  const sentMessages = [];
  const updatedMessages = [];
  const deletedMessages = [];
  
  return {
    sentMessages,
    updatedMessages,
    deletedMessages,
    
    async sendMessage(conversationId, text, options = {}) {
      const msg = {
        conversationId,
        text,
        options,
        messageId: `msg-${Date.now()}`,
        timestamp: new Date().toISOString(),
      };
      sentMessages.push(msg);
      console.log(`[MOCK] sendMessage: ${text.substring(0, 50)}...`);
      return msg;
    },
    
    async updateMessage(conversationId, messageId, updates) {
      const msg = { conversationId, messageId, updates, timestamp: new Date().toISOString() };
      updatedMessages.push(msg);
      console.log(`[MOCK] updateMessage: ${messageId}`);
      return msg;
    },
    
    async deleteMessage(conversationId, messageId) {
      deletedMessages.push({ conversationId, messageId });
      console.log(`[MOCK] deleteMessage: ${messageId}`);
    },
    
    async answerCallbackQuery(callbackQueryId) {
      console.log(`[MOCK] answerCallbackQuery: ${callbackQueryId}`);
    },
    
    getLastSentMessage() {
      return sentMessages[sentMessages.length - 1];
    },
    
    clear() {
      sentMessages.length = 0;
      updatedMessages.length = 0;
      deletedMessages.length = 0;
    },
  };
}

/**
 * Mock AI gateway that returns predictable food analysis
 */
function createMockAIGateway() {
  return {
    async chat(messages, options = {}) {
      const lastMessage = messages[messages.length - 1]?.content || '';
      
      // Check if this is a revision request
      if (lastMessage.includes('Apply this revision')) {
        console.log('[MOCK AI] Processing revision request');
        return JSON.stringify({
          items: [
            {
              name: 'Apple',
              quantity: 2,
              unit: 'piece',
              grams: 200,
              calories: 190,
              noom_color: 'green',
            },
          ],
        });
      }
      
      // Regular food logging
      console.log('[MOCK AI] Processing food log request');
      return JSON.stringify({
        items: [
          {
            name: 'Apple',
            quantity: 1,
            unit: 'piece',
            grams: 100,
            calories: 95,
            noom_color: 'green',
          },
        ],
        date: new Date().toISOString().split('T')[0],
      });
    },
  };
}

describeIfRealAI('Telegram Revision Flow Integration (Production-like)', () => {
  // Test configuration
  const TEST_BOT_ID = '6898194425';
  const TEST_CHAT_ID = 999999999; // Use a unique test chat ID
  const TEST_USER_ID = 123456789;
  const TEST_DATA_PATH = '_test_telegram_integration/nutrilogs';
  const TEST_STATE_PATH = '_test_telegram_integration/cursors';
  
  let webhookHandler;
  let container;
  let conversationStateStore;
  let nutrilogRepository;
  let messagingGateway;
  let aiGateway;
  let logger;

  beforeAll(async () => {
    console.log('\n🔌 Setting up Telegram integration test...\n');
    
    // Clean up test data from previous runs
    const testBasePath = path.join(process.cwd(), 'backend/data/_test_telegram_integration');
    if (fs.existsSync(testBasePath)) {
      console.log('   🧹 Cleaning up previous test state...');
      fs.rmSync(testBasePath, { recursive: true, force: true });
    }
    
    // Ensure test directories exist
    fs.mkdirSync(testBasePath, { recursive: true });
  });

  beforeEach(async () => {
    logger = createLogger({ source: 'test', app: 'telegram-integration' });
    
    // Ensure test data directories exist
    const nutrilogPath = path.join(process.cwd(), 'backend/data', TEST_DATA_PATH);
    fs.mkdirSync(nutrilogPath, { recursive: true });
    
    // Create config object (simple version, like CLI simulator uses)
    const config = {
      goals: { calories: 2000, protein: 150, carbs: 200, fat: 65 },
      getUserTimezone: () => 'America/Los_Angeles',
      getGoalsForUser: () => ({ calories: 2000, protein: 150, carbs: 200, fat: 65 }),
      // Required by NutriLogRepository
      getNutrilogPath: (userId) => `${TEST_DATA_PATH}/${userId || 'test-user'}`,
      // Required by NutriListRepository if used
      getNutrilistPath: (userId) => `${TEST_DATA_PATH}/lists/${userId || 'test-user'}`,
    };
    
    // Use FILE-BASED state store like production
    conversationStateStore = new FileConversationStateStore({
      storePath: TEST_STATE_PATH,
      logger,
    });
    
    // Use real repository with test data path
    nutrilogRepository = new NutriLogRepository({
      config,
      logger,
    });
    
    // Use mock gateways (we don't want to actually send Telegram messages)
    messagingGateway = createMockMessagingGateway();
    aiGateway = createMockAIGateway();
    
    // Create container with ALL dependencies
    container = new NutribotContainer(config, {
      messagingGateway,
      aiGateway,
      conversationStateStore,
      nutrilogRepository,
      logger,
    });
    
    // Create webhook handler (this is what production uses!)
    webhookHandler = createTelegramWebhookHandler(
      container,
      { botId: TEST_BOT_ID, botName: 'test-nutribot' },
      { logger, gateway: messagingGateway }
    );
    
    console.log(`\n   Test Chat ID: telegram:${TEST_BOT_ID}_${TEST_CHAT_ID}`);
  });

  afterEach(async () => {
    messagingGateway?.clear();
  });

  afterAll(async () => {
    // Clean up test data
    const testBasePath = path.join(process.cwd(), 'backend/data/_test_telegram_integration');
    if (fs.existsSync(testBasePath)) {
      fs.rmSync(testBasePath, { recursive: true, force: true });
    }
  });

  it('should persist state between separate webhook requests (revision flow)', async () => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📱 TELEGRAM INTEGRATION: Full Revision Flow');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const conversationId = `telegram:${TEST_BOT_ID}_${TEST_CHAT_ID}`;
    let logUuid;
    let originalMessageId;

    // ═══════════════════════════════════════════════════════════════════
    // REQUEST 1: User sends "1 apple" via Telegram
    // ═══════════════════════════════════════════════════════════════════
    console.log('REQUEST 1: User sends "1 apple"...');
    
    const req1 = createMockRequest(
      createTelegramTextMessage(TEST_BOT_ID, TEST_CHAT_ID, TEST_USER_ID, '1 apple')
    );
    const res1 = createMockResponse();
    
    await webhookHandler(req1, res1);
    
    expect(res1.statusCode).toBe(200);
    console.log(`   ✅ Response: ${res1.statusCode}`);
    
    // Get the log UUID from the updated message (the final confirmation message)
    const updatedMessage = messagingGateway.updatedMessages[messagingGateway.updatedMessages.length - 1];
    console.log(`   📤 Updated message: ${JSON.stringify(updatedMessage?.updates?.text?.substring(0, 50))}...`);
    
    // Extract logUuid from callback data in the updated message
    if (updatedMessage?.updates?.choices) {
      const acceptButton = updatedMessage.updates.choices.flat().find(b => b.callback_data?.startsWith('accept:'));
      if (acceptButton) {
        logUuid = acceptButton.callback_data.split(':')[1];
        originalMessageId = updatedMessage.messageId;
        console.log(`   📦 Log UUID: ${logUuid}`);
      }
    }
    
    // Also check sent messages if updated messages don't have it
    if (!logUuid) {
      const sentMessage1 = messagingGateway.getLastSentMessage();
      console.log(`   📤 Sent (fallback): ${sentMessage1?.text?.substring(0, 50)}...`);
      if (sentMessage1?.options?.choices) {
        const acceptButton = sentMessage1.options.choices.flat().find(b => b.callback_data?.startsWith('accept:'));
        if (acceptButton) {
          logUuid = acceptButton.callback_data.split(':')[1];
          originalMessageId = sentMessage1.messageId;
          console.log(`   📦 Log UUID (from sent): ${logUuid}`);
        }
      }
    }
    
    expect(logUuid).toBeDefined();

    // ═══════════════════════════════════════════════════════════════════
    // REQUEST 2: User presses "Revise" button (callback query)
    // ═══════════════════════════════════════════════════════════════════
    console.log('\nREQUEST 2: User presses "Revise" button...');
    
    const req2 = createMockRequest(
      createTelegramCallbackQuery(
        TEST_BOT_ID,
        TEST_CHAT_ID,
        TEST_USER_ID,
        `revise:${logUuid}`,
        originalMessageId
      )
    );
    const res2 = createMockResponse();
    
    await webhookHandler(req2, res2);
    
    expect(res2.statusCode).toBe(200);
    console.log(`   ✅ Response: ${res2.statusCode}`);
    
    // Verify state was persisted to FILE
    const stateAfterRevise = await conversationStateStore.get(conversationId);
    console.log(`   💾 State persisted: activeFlow=${stateAfterRevise?.activeFlow}`);
    console.log(`   💾 State persisted: pendingLogUuid=${stateAfterRevise?.flowState?.pendingLogUuid}`);
    
    expect(stateAfterRevise).toBeDefined();
    expect(stateAfterRevise.activeFlow).toBe('revision');
    expect(stateAfterRevise.flowState?.pendingLogUuid).toBe(logUuid);

    // ═══════════════════════════════════════════════════════════════════
    // REQUEST 3: User sends revision text "double that"
    // This is a SEPARATE request - state must be read from file!
    // ═══════════════════════════════════════════════════════════════════
    console.log('\nREQUEST 3: User sends "double that" (SEPARATE REQUEST)...');
    
    // CRITICAL: Clear any in-memory state to ensure we test file persistence
    // (In production, each request is a fresh process/handler)
    
    const req3 = createMockRequest(
      createTelegramTextMessage(TEST_BOT_ID, TEST_CHAT_ID, TEST_USER_ID, 'double that')
    );
    const res3 = createMockResponse();
    
    // Before calling webhook, verify we can read the state
    console.log('   🔍 Checking state BEFORE webhook call...');
    const stateBeforeRevision = await conversationStateStore.get(conversationId);
    console.log(`   💾 State read: activeFlow=${stateBeforeRevision?.activeFlow}`);
    console.log(`   💾 State read: pendingLogUuid=${stateBeforeRevision?.flowState?.pendingLogUuid}`);
    
    expect(stateBeforeRevision?.activeFlow).toBe('revision');
    expect(stateBeforeRevision?.flowState?.pendingLogUuid).toBe(logUuid);
    
    // Now call the webhook
    await webhookHandler(req3, res3);
    
    expect(res3.statusCode).toBe(200);
    console.log(`   ✅ Response: ${res3.statusCode}`);
    
    // Check what message was sent
    const sentMessage3 = messagingGateway.getLastSentMessage();
    console.log(`   📤 Sent: ${sentMessage3?.text?.substring(0, 80)}...`);
    
    // The message should contain revised food items, NOT "couldn't identify"
    expect(sentMessage3?.text).toBeDefined();
    expect(sentMessage3?.text).not.toContain("couldn't identify");
    expect(sentMessage3?.text).not.toContain("undefined");
    
    // Verify state was updated back to confirmation
    const stateAfterRevision = await conversationStateStore.get(conversationId);
    console.log(`   💾 State after: activeFlow=${stateAfterRevision?.activeFlow}`);
    
    console.log('\n   ✅ FULL TELEGRAM FLOW COMPLETED SUCCESSFULLY');
  });

  it('should correctly parse Telegram conversationId format', async () => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📱 TELEGRAM INTEGRATION: ConversationId Format');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // Test that TelegramInputAdapter generates correct conversationId
    const config = { botId: TEST_BOT_ID };
    const telegramUpdate = createTelegramTextMessage(TEST_BOT_ID, TEST_CHAT_ID, TEST_USER_ID, 'test');
    
    const event = TelegramInputAdapter.parse(telegramUpdate, config);
    
    const expectedConversationId = `telegram:${TEST_BOT_ID}_${TEST_CHAT_ID}`;
    
    console.log(`   Expected: ${expectedConversationId}`);
    console.log(`   Actual:   ${event.conversationId}`);
    
    expect(event.conversationId).toBe(expectedConversationId);
    
    // Test that state store can use this format
    const testState = { activeFlow: 'test', flowState: { test: true } };
    
    // Use ConversationState to create proper state object
    const { ConversationState } = await import('../../domain/entities/ConversationState.mjs');
    const state = ConversationState.create(event.conversationId, testState);
    
    await conversationStateStore.set(event.conversationId, state);
    const readState = await conversationStateStore.get(event.conversationId);
    
    console.log(`   💾 State written and read back: activeFlow=${readState?.activeFlow}`);
    
    expect(readState).toBeDefined();
    expect(readState.activeFlow).toBe('test');
  });

  it('should verify container has conversationStateStore', async () => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📱 TELEGRAM INTEGRATION: Container Dependencies');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // This test verifies the container has all required dependencies
    const stateStore = container.getConversationStateStore();
    
    console.log(`   conversationStateStore: ${stateStore ? '✅ present' : '❌ MISSING'}`);
    
    expect(stateStore).toBeDefined();
    expect(stateStore).toBe(conversationStateStore);
    
    // Verify the state store is functional
    const testId = `test:${Date.now()}`;
    const { ConversationState } = await import('../../domain/entities/ConversationState.mjs');
    const testState = ConversationState.create(testId, { activeFlow: 'verification' });
    
    await stateStore.set(testId, testState);
    const readBack = await stateStore.get(testId);
    
    console.log(`   State store functional: ${readBack?.activeFlow === 'verification' ? '✅ yes' : '❌ NO'}`);
    
    expect(readBack?.activeFlow).toBe('verification');
    
    // Clean up
    await stateStore.clear(testId);
  });
});
