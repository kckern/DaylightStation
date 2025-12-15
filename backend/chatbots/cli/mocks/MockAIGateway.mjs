/**
 * Mock AI Gateway
 * @module cli/mocks/MockAIGateway
 * 
 * Provides AI responses for CLI testing - either canned responses or real OpenAI API.
 */

import { createLogger } from '../../_lib/logging/index.mjs';

/**
 * Canned responses for common food inputs
 */
const CANNED_RESPONSES = {
  // Text patterns and their responses
  patterns: [
    {
      match: /chicken.*salad|salad.*chicken/i,
      response: {
        items: [
          { name: 'Grilled Chicken Breast', quantity: 1, unit: 'piece', grams: 150, calories: 248, protein: 46, carbs: 0, fat: 5, color: 'green' },
          { name: 'Mixed Green Salad', quantity: 2, unit: 'cups', grams: 100, calories: 20, protein: 2, carbs: 4, fat: 0, color: 'green' },
          { name: 'Caesar Dressing', quantity: 2, unit: 'tbsp', grams: 30, calories: 150, protein: 1, carbs: 1, fat: 16, color: 'orange' },
        ],
      },
    },
    {
      match: /pizza/i,
      response: {
        items: [
          { name: 'Pepperoni Pizza', quantity: 2, unit: 'slices', grams: 214, calories: 596, protein: 24, carbs: 60, fat: 28, color: 'orange' },
        ],
      },
    },
    {
      match: /burger|hamburger/i,
      response: {
        items: [
          { name: 'Beef Burger', quantity: 1, unit: 'burger', grams: 226, calories: 540, protein: 34, carbs: 40, fat: 27, color: 'orange' },
          { name: 'French Fries', quantity: 1, unit: 'medium', grams: 117, calories: 365, protein: 4, carbs: 48, fat: 17, color: 'orange' },
        ],
      },
    },
    {
      match: /apple|banana|fruit/i,
      response: {
        items: [
          { name: 'Apple', quantity: 1, unit: 'medium', grams: 182, calories: 95, protein: 0, carbs: 25, fat: 0, color: 'green' },
        ],
      },
    },
    {
      match: /coffee|latte|cappuccino/i,
      response: {
        items: [
          { name: 'Latte', quantity: 1, unit: 'grande', grams: 480, calories: 190, protein: 13, carbs: 18, fat: 7, color: 'yellow' },
        ],
      },
    },
    {
      match: /egg|eggs|omelette|omelet/i,
      response: {
        items: [
          { name: 'Scrambled Eggs', quantity: 2, unit: 'large', grams: 100, calories: 182, protein: 12, carbs: 2, fat: 14, color: 'yellow' },
          { name: 'Toast', quantity: 1, unit: 'slice', grams: 30, calories: 79, protein: 3, carbs: 15, fat: 1, color: 'yellow' },
        ],
      },
    },
    {
      match: /sandwich/i,
      response: {
        items: [
          { name: 'Turkey Sandwich', quantity: 1, unit: 'sandwich', grams: 250, calories: 350, protein: 28, carbs: 35, fat: 10, color: 'yellow' },
        ],
      },
    },
    {
      match: /rice|fried rice/i,
      response: {
        items: [
          { name: 'Fried Rice', quantity: 1, unit: 'cup', grams: 200, calories: 238, protein: 6, carbs: 34, fat: 9, color: 'yellow' },
        ],
      },
    },
    {
      match: /soup/i,
      response: {
        items: [
          { name: 'Chicken Noodle Soup', quantity: 1, unit: 'bowl', grams: 300, calories: 175, protein: 12, carbs: 20, fat: 5, color: 'green' },
        ],
      },
    },
    {
      match: /steak/i,
      response: {
        items: [
          { name: 'Ribeye Steak', quantity: 8, unit: 'oz', grams: 227, calories: 544, protein: 48, carbs: 0, fat: 38, color: 'yellow' },
        ],
      },
    },
    {
      match: /pasta|spaghetti/i,
      response: {
        items: [
          { name: 'Spaghetti with Marinara', quantity: 2, unit: 'cups', grams: 400, calories: 440, protein: 16, carbs: 84, fat: 4, color: 'yellow' },
        ],
      },
    },
    {
      match: /yogurt/i,
      response: {
        items: [
          { name: 'Greek Yogurt', quantity: 1, unit: 'cup', grams: 245, calories: 130, protein: 17, carbs: 8, fat: 4, color: 'green' },
        ],
      },
    },
    {
      match: /smoothie/i,
      response: {
        items: [
          { name: 'Berry Smoothie', quantity: 16, unit: 'oz', grams: 480, calories: 280, protein: 8, carbs: 58, fat: 3, color: 'green' },
        ],
      },
    },
  ],

  // Default response for unrecognized input
  default: {
    items: [
      { name: 'Mixed Meal', quantity: 1, unit: 'serving', grams: 300, calories: 450, protein: 25, carbs: 45, fat: 18, color: 'yellow' },
    ],
  },

  // Image responses (since we can't actually analyze images)
  image: {
    items: [
      { name: 'Detected Food Item 1', quantity: 1, unit: 'serving', grams: 200, calories: 300, protein: 15, carbs: 30, fat: 12, color: 'yellow' },
      { name: 'Detected Food Item 2', quantity: 1, unit: 'serving', grams: 100, calories: 150, protein: 8, carbs: 20, fat: 5, color: 'green' },
    ],
  },
};

/**
 * Mock AI Gateway
 */
export class MockAIGateway {
  #useRealAPI;
  #realGateway;
  #mockResponses;
  #logger;
  #responseDelay;

  /**
   * @param {Object} [options]
   * @param {boolean} [options.useRealAPI=false] - Use actual OpenAI API
   * @param {Object} [options.realGateway] - Real AI gateway instance
   * @param {number} [options.responseDelay=500] - Simulated response delay in ms
   * @param {Object} [options.logger]
   */
  constructor(options = {}) {
    this.#useRealAPI = options.useRealAPI || false;
    this.#realGateway = options.realGateway;
    this.#mockResponses = new Map();
    this.#responseDelay = options.responseDelay ?? 500;
    this.#logger = options.logger || createLogger({ source: 'cli:ai', app: 'cli' });
  }

  /**
   * Chat with text prompt
   * @param {Array} messages - Chat messages
   * @param {Object} [options]
   * @returns {Promise<string>} - JSON response string
   */
  async chat(messages, options = {}) {
    this.#logger.debug('chat', { messageCount: messages.length, useRealAPI: this.#useRealAPI });

    if (this.#useRealAPI && this.#realGateway) {
      return this.#realGateway.chat(messages, options);
    }

    // Simulate processing delay
    await this.#delay();

    // Extract the user's message
    const userMessage = this.#extractUserMessage(messages);
    
    // Check for custom mock response
    const customKey = this.#findMockKey(userMessage);
    if (customKey && this.#mockResponses.has(customKey)) {
      const response = this.#mockResponses.get(customKey);
      this.#logger.debug('chat.customResponse', { key: customKey });
      return JSON.stringify(response);
    }

    // Find matching canned response
    const response = this.#findCannedResponse(userMessage);
    
    this.#logger.debug('chat.response', { itemCount: response.items.length });
    return JSON.stringify(response);
  }

  /**
   * Chat with image
   * @param {Array} messages - Chat messages
   * @param {string} imageUrl - Image URL or path
   * @param {Object} [options]
   * @returns {Promise<string>} - JSON response string
   */
  async chatWithImage(messages, imageUrl, options = {}) {
    this.#logger.debug('chatWithImage', { imageUrl: imageUrl?.substring(0, 50), useRealAPI: this.#useRealAPI });

    if (this.#useRealAPI && this.#realGateway?.chatWithImage) {
      return this.#realGateway.chatWithImage(messages, imageUrl, options);
    }

    // Simulate processing delay (longer for images)
    await this.#delay(this.#responseDelay * 2);

    // For mock mode, return generic image detection response
    const response = CANNED_RESPONSES.image;
    
    this.#logger.debug('chatWithImage.response', { itemCount: response.items.length });
    return JSON.stringify(response);
  }

  /**
   * Set a custom mock response for a specific trigger
   * @param {string|RegExp} trigger - Text trigger or pattern
   * @param {Object} response - Response object
   */
  setMockResponse(trigger, response) {
    const key = trigger instanceof RegExp ? trigger.source : trigger.toLowerCase();
    this.#mockResponses.set(key, response);
    this.#logger.debug('setMockResponse', { trigger: key });
  }

  /**
   * Clear all custom mock responses
   */
  clearMockResponses() {
    this.#mockResponses.clear();
  }

  /**
   * Enable/disable real API usage
   * @param {boolean} enabled
   */
  setUseRealAPI(enabled) {
    this.#useRealAPI = enabled;
    this.#logger.info('setUseRealAPI', { enabled });
  }

  /**
   * Set response delay
   * @param {number} delayMs
   */
  setResponseDelay(delayMs) {
    this.#responseDelay = delayMs;
  }

  // ==================== Private Helpers ====================

  /**
   * Extract user message from chat messages
   * @private
   */
  #extractUserMessage(messages) {
    if (!messages || messages.length === 0) return '';
    
    // Find the last user message
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        return messages[i].content || '';
      }
    }
    
    return messages[messages.length - 1].content || '';
  }

  /**
   * Find custom mock response key
   * @private
   */
  #findMockKey(text) {
    const lowerText = text.toLowerCase();
    
    for (const [key] of this.#mockResponses) {
      if (key instanceof RegExp) {
        if (key.test(text)) return key.source;
      } else if (lowerText.includes(key)) {
        return key;
      }
    }
    
    return null;
  }

  /**
   * Find matching canned response
   * @private
   */
  #findCannedResponse(text) {
    for (const pattern of CANNED_RESPONSES.patterns) {
      if (pattern.match.test(text)) {
        return pattern.response;
      }
    }
    
    return CANNED_RESPONSES.default;
  }

  /**
   * Simulate processing delay
   * @private
   */
  async #delay(ms = this.#responseDelay) {
    if (ms > 0) {
      await new Promise(resolve => setTimeout(resolve, ms));
    }
  }
}

export default MockAIGateway;
