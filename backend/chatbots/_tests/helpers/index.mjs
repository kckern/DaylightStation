/**
 * Test Helpers barrel export
 * @module _tests/helpers
 */

export { TestAdapter } from './TestAdapter.mjs';

// Fixture loaders
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Load nutribot mock responses
 * @returns {Object}
 */
export function loadNutribotFixtures() {
  const filePath = path.join(__dirname, 'fixtures/nutribot/mockAIResponses.json');
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * Load journalist mock responses
 * @returns {Object}
 */
export function loadJournalistFixtures() {
  const filePath = path.join(__dirname, 'fixtures/journalist/mockAIResponses.json');
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * Create mock messaging gateway for testing
 * @returns {Object}
 */
export function createTestMessagingGateway() {
  const messages = [];
  let messageCounter = 1;

  return {
    messages,
    
    sendMessage: async (chatId, text, options = {}) => {
      const messageId = `test-msg-${messageCounter++}`;
      messages.push({
        type: 'send',
        chatId,
        text,
        options,
        messageId,
        timestamp: new Date().toISOString(),
      });
      return { messageId };
    },

    updateMessage: async (chatId, messageId, updates) => {
      messages.push({
        type: 'update',
        chatId,
        messageId,
        updates,
        timestamp: new Date().toISOString(),
      });
    },

    deleteMessage: async (chatId, messageId) => {
      messages.push({
        type: 'delete',
        chatId,
        messageId,
        timestamp: new Date().toISOString(),
      });
    },

    answerCallback: async (callbackId, text, showAlert) => {
      messages.push({
        type: 'callback_answer',
        callbackId,
        text,
        showAlert,
        timestamp: new Date().toISOString(),
      });
    },

    reset: () => {
      messages.length = 0;
      messageCounter = 1;
    },

    getLastMessage: () => messages[messages.length - 1] || null,
    
    getSentMessages: () => messages.filter(m => m.type === 'send'),
  };
}

/**
 * Create mock AI gateway for testing
 * @param {Object} [responses] - Pre-configured responses
 * @returns {Object}
 */
export function createTestAIGateway(responses = {}) {
  const calls = [];
  let defaultResponse = 'Mock AI response';

  return {
    calls,

    chat: async (messages, options = {}) => {
      calls.push({ type: 'chat', messages, options, timestamp: new Date().toISOString() });
      
      // Check for pattern match in responses
      const userMessage = messages.find(m => m.role === 'user')?.content || '';
      for (const [pattern, response] of Object.entries(responses)) {
        if (new RegExp(pattern, 'i').test(userMessage)) {
          return typeof response === 'function' ? response(userMessage) : response;
        }
      }
      
      return defaultResponse;
    },

    setDefaultResponse: (response) => {
      defaultResponse = response;
    },

    reset: () => {
      calls.length = 0;
    },

    getCalls: () => [...calls],
  };
}
