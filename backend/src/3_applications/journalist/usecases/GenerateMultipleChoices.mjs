/**
 * Generate Multiple Choices Use Case
 * @module journalist/application/usecases/GenerateMultipleChoices
 *
 * Generates multiple choice options for a question.
 */

import { parseGPTResponse } from '#domains/journalist/services/QuestionParser.mjs';
import { buildDefaultChoices } from '#domains/journalist/services/QueueManager.mjs';
import { buildMultipleChoicePrompt } from '#domains/journalist/services/PromptBuilder.mjs';

// Simple in-memory cache
const choiceCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Generate multiple choices use case
 */
export class GenerateMultipleChoices {
  #aiGateway;
  #logger;

  constructor(deps) {
    if (!deps.aiGateway) throw new Error('aiGateway is required');

    this.#aiGateway = deps.aiGateway;
    this.#logger = deps.logger || console;
  }

  /**
   * Execute the use case
   * @param {Object} input
   * @param {string} input.chatId
   * @param {string} input.history - Conversation history
   * @param {string} input.comment - Context/comment
   * @param {string} input.question - Question to generate choices for
   * @returns {Promise<string[][]>}
   */
  async execute(input) {
    const { chatId, history, comment, question } = input;

    this.#logger.debug?.('choices.generate.start', { chatId, questionLength: question?.length });

    try {
      // 1. Check cache
      const cacheKey = this.#getCacheKey(chatId, question);
      const cached = this.#getFromCache(cacheKey);
      if (cached) {
        this.#logger.debug?.('choices.generate.cached', { chatId });
        return cached;
      }

      // 2. Build prompt
      const prompt = buildMultipleChoicePrompt(history || '', comment || '', question);

      // 3. Call AI
      const response = await this.#aiGateway.chat(prompt, { maxTokens: 200 });

      // 4. Parse choices
      let choices = parseGPTResponse(response);

      // 5. Validate and format
      if (!Array.isArray(choices) || choices.length < 2) {
        // Retry with explicit instruction
        const retryPrompt = [
          ...prompt,
          { role: 'assistant', content: response },
          {
            role: 'user',
            content:
              'Please respond with ONLY a JSON array of 4-6 answer options, like: ["Option 1", "Option 2", "Option 3", "Option 4"]',
          },
        ];

        const retryResponse = await this.#aiGateway.chat(retryPrompt, { maxTokens: 200 });
        choices = parseGPTResponse(retryResponse);
      }

      // 6. Format as keyboard
      let keyboard;
      if (Array.isArray(choices) && choices.length >= 2) {
        keyboard = choices.slice(0, 5).map((c) => [String(c)]);
        keyboard.push(...buildDefaultChoices());
      } else {
        keyboard = buildDefaultChoices();
      }

      // 7. Cache result
      this.#setCache(cacheKey, keyboard);

      this.#logger.info?.('choices.generate.complete', { chatId, choiceCount: keyboard.length - 1 });

      return keyboard;
    } catch (error) {
      this.#logger.error?.('choices.generate.error', { chatId, error: error.message });
      // Return default choices on error
      return buildDefaultChoices();
    }
  }

  /**
   * Generate cache key
   * @private
   */
  #getCacheKey(chatId, question) {
    const questionHash = question?.slice(0, 50).toLowerCase().replace(/\s+/g, '_') || 'unknown';
    return `${chatId}:${questionHash}`;
  }

  /**
   * Get from cache
   * @private
   */
  #getFromCache(key) {
    const entry = choiceCache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > CACHE_TTL) {
      choiceCache.delete(key);
      return null;
    }

    return entry.value;
  }

  /**
   * Set cache entry
   * @private
   */
  #setCache(key, value) {
    // Clean old entries
    if (choiceCache.size > 100) {
      const oldest = Array.from(choiceCache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)
        .slice(0, 50);
      oldest.forEach(([k]) => choiceCache.delete(k));
    }

    choiceCache.set(key, { value, timestamp: Date.now() });
  }

  /**
   * Clear cache (for testing)
   */
  static clearCache() {
    choiceCache.clear();
  }
}

export default GenerateMultipleChoices;
