/**
 * Test Helpers barrel export
 * @module _tests/helpers
 * 
 * Provides utilities for integration testing with real AI.
 */

/**
 * Create test messaging gateway that captures messages for assertions.
 * This is NOT a mock - it captures real gateway calls for verification.
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

    sendImage: async (chatId, imageSource, caption, options = {}) => {
      const messageId = `test-msg-${messageCounter++}`;
      messages.push({
        type: 'image',
        chatId,
        imageSource: Buffer.isBuffer(imageSource) ? '[Buffer]' : imageSource,
        caption,
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

    updateKeyboard: async (chatId, messageId, choices) => {
      messages.push({
        type: 'update_keyboard',
        chatId,
        messageId,
        choices,
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

    answerCallbackQuery: async (callbackQueryId, options = {}) => {
      messages.push({
        type: 'callback_answer',
        callbackQueryId,
        options,
        timestamp: new Date().toISOString(),
      });
    },

    reset: () => {
      messages.length = 0;
      messageCounter = 1;
    },

    getLastMessage: () => messages[messages.length - 1] || null,
    
    getSentMessages: () => messages.filter(m => m.type === 'send'),
    
    getImages: () => messages.filter(m => m.type === 'image'),
    
    getAllMessages: () => [...messages],
  };
}
