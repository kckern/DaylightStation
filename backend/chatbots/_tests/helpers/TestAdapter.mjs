/**
 * Test Adapter
 * @module _tests/helpers/TestAdapter
 * 
 * Simulates Telegram interactions for integration testing.
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * Test Adapter for simulating Telegram interactions
 */
export class TestAdapter {
  #bot;
  #userId;
  #container;
  #router;
  #messages;
  #aiResponses;
  #currentState;

  /**
   * @param {Object} options
   * @param {'nutribot'|'journalist'} options.bot - Bot type
   * @param {string} [options.userId] - User/chat ID
   * @param {Object} options.container - DI Container
   * @param {Object} options.router - Event router
   */
  constructor(options) {
    if (!options.bot) throw new Error('bot is required');
    if (!options.container) throw new Error('container is required');
    if (!options.router) throw new Error('router is required');

    this.#bot = options.bot;
    this.#userId = options.userId || `test_${uuidv4().slice(0, 8)}`;
    this.#container = options.container;
    this.#router = options.router;
    this.#messages = [];
    this.#aiResponses = new Map();
    this.#currentState = null;

    // Setup message capture
    this.#setupMessageCapture();
  }

  // ==================== Simulation Methods ====================

  /**
   * Send a text message
   * @param {string} text
   */
  async sendText(text) {
    const event = this.#buildMessageEvent({
      text,
    });

    await this.#router.route(event);
  }

  /**
   * Send a photo message
   * @param {string} base64 - Base64 encoded image
   */
  async sendPhoto(base64) {
    const event = this.#buildMessageEvent({
      photo: [
        { file_id: `photo_${uuidv4().slice(0, 8)}`, width: 100, height: 100 },
        { file_id: `photo_${uuidv4().slice(0, 8)}`, width: 640, height: 480 },
      ],
      caption: '',
    });

    // Store base64 for mock file download
    event._testData = { base64 };

    await this.#router.route(event);
  }

  /**
   * Send a voice message
   * @param {Buffer} [buffer] - Audio buffer (optional)
   */
  async sendVoice(buffer) {
    const event = this.#buildMessageEvent({
      voice: {
        file_id: `voice_${uuidv4().slice(0, 8)}`,
        duration: 5,
      },
    });

    if (buffer) {
      event._testData = { audioBuffer: buffer };
    }

    await this.#router.route(event);
  }

  /**
   * Press a button from the last message
   * @param {string} buttonText - Text on the button
   */
  async pressButton(buttonText) {
    const lastMessage = this.getLastBotMessage();
    
    if (!lastMessage?.buttons) {
      throw new Error('No buttons available in last message');
    }

    // Find the button
    let foundButton = null;
    let callbackData = buttonText;

    for (const row of lastMessage.buttons) {
      for (const button of row) {
        if (typeof button === 'string') {
          if (button === buttonText || button.includes(buttonText)) {
            foundButton = button;
            callbackData = button;
            break;
          }
        } else if (button.text === buttonText || button.text?.includes(buttonText)) {
          foundButton = button;
          callbackData = button.callback_data || button.text;
          break;
        }
      }
      if (foundButton) break;
    }

    if (!foundButton) {
      const available = lastMessage.buttons.flat().map(b => 
        typeof b === 'string' ? b : b.text
      );
      throw new Error(`Button "${buttonText}" not found. Available: ${available.join(', ')}`);
    }

    // Build callback event
    const event = this.#buildCallbackEvent(callbackData, lastMessage.messageId);
    await this.#router.route(event);
  }

  /**
   * Send a slash command
   * @param {string} command - Command with or without leading /
   */
  async sendCommand(command) {
    const cmd = command.startsWith('/') ? command : `/${command}`;
    return this.sendText(cmd);
  }

  // ==================== Assertion Methods ====================

  /**
   * Get the last bot message
   * @returns {{ text: string, buttons: any[][], messageId: string }|null}
   */
  getLastBotMessage() {
    const botMessages = this.#messages.filter(m => m.isBot);
    return botMessages[botMessages.length - 1] || null;
  }

  /**
   * Get all bot messages
   * @returns {Array}
   */
  getAllBotMessages() {
    return this.#messages.filter(m => m.isBot);
  }

  /**
   * Get total message count
   * @returns {number}
   */
  getMessagesCount() {
    return this.#messages.length;
  }

  /**
   * Get bot message count
   * @returns {number}
   */
  getBotMessagesCount() {
    return this.#messages.filter(m => m.isBot).length;
  }

  /**
   * Get a repository from container
   * @param {string} name - Repository name
   * @returns {Object}
   */
  getRepository(name) {
    const methodName = `get${name.charAt(0).toUpperCase() + name.slice(1)}`;
    if (typeof this.#container[methodName] === 'function') {
      return this.#container[methodName]();
    }
    throw new Error(`Repository ${name} not found`);
  }

  /**
   * Get conversation state
   * @returns {Object|null}
   */
  async getState() {
    const stateStore = this.#container.getConversationStateStore?.();
    if (stateStore) {
      return stateStore.get(this.#userId);
    }
    return this.#currentState;
  }

  /**
   * Get user ID
   * @returns {string}
   */
  getUserId() {
    return this.#userId;
  }

  // ==================== Setup Methods ====================

  /**
   * Reset adapter state
   */
  reset() {
    this.#messages = [];
    this.#currentState = null;
    this.#aiResponses.clear();
  }

  /**
   * Set AI response for a pattern
   * @param {RegExp|string} pattern - Pattern to match
   * @param {string|Function} response - Response or function returning response
   */
  setAIResponse(pattern, response) {
    this.#aiResponses.set(pattern, response);
  }

  /**
   * Clear AI responses
   */
  clearAIResponses() {
    this.#aiResponses.clear();
  }

  // ==================== Private Methods ====================

  /**
   * Setup message capture from messaging gateway
   * @private
   */
  #setupMessageCapture() {
    const gateway = this.#container.getMessagingGateway?.();
    
    if (gateway && typeof gateway.sendMessage === 'function') {
      const originalSendMessage = gateway.sendMessage.bind(gateway);
      
      gateway.sendMessage = async (chatId, text, options = {}) => {
        const result = await originalSendMessage(chatId, text, options);
        
        this.#messages.push({
          isBot: true,
          chatId,
          text,
          buttons: options.choices || null,
          messageId: result.messageId || `msg_${uuidv4().slice(0, 8)}`,
          timestamp: new Date().toISOString(),
        });

        return result;
      };
    }
  }

  /**
   * Build a message event
   * @private
   */
  #buildMessageEvent(messageData) {
    const messageId = Date.now();
    
    return {
      update_id: messageId,
      message: {
        message_id: messageId,
        from: {
          id: parseInt(this.#userId) || 12345,
          is_bot: false,
          first_name: 'Test',
          username: 'testuser',
        },
        chat: {
          id: parseInt(this.#userId) || 12345,
          type: 'private',
        },
        date: Math.floor(Date.now() / 1000),
        ...messageData,
      },
    };
  }

  /**
   * Build a callback query event
   * @private
   */
  #buildCallbackEvent(data, originalMessageId) {
    return {
      update_id: Date.now(),
      callback_query: {
        id: `cb_${uuidv4().slice(0, 8)}`,
        from: {
          id: parseInt(this.#userId) || 12345,
          is_bot: false,
          first_name: 'Test',
          username: 'testuser',
        },
        message: {
          message_id: originalMessageId,
          chat: {
            id: parseInt(this.#userId) || 12345,
            type: 'private',
          },
        },
        data,
      },
    };
  }
}

export default TestAdapter;
