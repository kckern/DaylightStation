/**
 * Prompt Repository
 * @module _lib/prompts/PromptRepository
 * 
 * Main interface for loading and rendering prompts.
 * Combines PromptLoader (file loading) with PromptRenderer (templating).
 */

import { PromptLoader } from './PromptLoader.mjs';
import { render, renderMessages } from './PromptRenderer.mjs';
import { createLogger } from '../logging/index.mjs';

/**
 * @typedef {Object} PromptConfig
 * @property {string} [model] - AI model to use
 * @property {number} [temperature] - Temperature setting
 * @property {number} [maxTokens] - Max tokens
 */

/**
 * @typedef {Object} ChatMessage
 * @property {'system'|'user'|'assistant'} role
 * @property {string} content
 */

/**
 * Prompt Repository
 * 
 * High-level interface for working with externalized prompts.
 */
export class PromptRepository {
  #loader;
  #logger;
  #userResolver;

  /**
   * @param {Object} config
   * @param {string} config.dataPath - Base data directory
   * @param {number} [config.cacheTTL] - Cache TTL in ms
   * @param {Object} [options]
   * @param {Object} [options.logger] - Logger instance
   * @param {Object} [options.userResolver] - UserResolver for conversationId → username
   */
  constructor(config, options = {}) {
    this.#loader = new PromptLoader({
      dataPath: config.dataPath,
      cacheTTL: config.cacheTTL,
    });
    this.#logger = options.logger || createLogger({ source: 'prompts', app: 'repository' });
    this.#userResolver = options.userResolver;
  }

  /**
   * Get a prompt with variable substitution
   * 
   * @param {string} bot - Bot name (nutribot, journalist)
   * @param {string} promptId - Prompt identifier (e.g., 'food_detection')
   * @param {Object} [variables={}] - Template variables
   * @param {Object} [options={}]
   * @param {string} [options.userId] - User ID for user-specific prompts
   * @param {string} [options.conversationId] - Conversation ID (alternative to userId)
   * @returns {Promise<ChatMessage[]>} Rendered chat messages
   */
  async getPrompt(bot, promptId, variables = {}, options = {}) {
    const username = this.#resolveUsername(options);
    
    const promptDef = await this.#loader.loadPrompt(bot, promptId, username);
    
    if (!promptDef) {
      this.#logger.warn('prompts.notFound', { bot, promptId, username });
      return [];
    }

    if (!promptDef.messages || !Array.isArray(promptDef.messages)) {
      this.#logger.warn('prompts.noMessages', { bot, promptId });
      return [];
    }

    // Render templates with variables
    const rendered = renderMessages(promptDef.messages, variables);
    
    this.#logger.debug('prompts.rendered', { 
      bot, 
      promptId, 
      messageCount: rendered.length,
      hasUserOverride: !!username,
    });

    return rendered;
  }

  /**
   * Get prompt configuration (model, temperature, etc.)
   * 
   * @param {string} bot
   * @param {string} promptId
   * @param {Object} [options={}]
   * @returns {Promise<PromptConfig>}
   */
  async getPromptConfig(bot, promptId, options = {}) {
    const username = this.#resolveUsername(options);
    const promptDef = await this.#loader.loadPrompt(bot, promptId, username);

    if (!promptDef) {
      return {};
    }

    return {
      model: promptDef.model,
      temperature: promptDef.temperature,
      maxTokens: promptDef.max_tokens,
    };
  }

  /**
   * Get prompt with both messages and config
   * 
   * @param {string} bot
   * @param {string} promptId
   * @param {Object} [variables={}]
   * @param {Object} [options={}]
   * @returns {Promise<{messages: ChatMessage[], config: PromptConfig}>}
   */
  async getPromptWithConfig(bot, promptId, variables = {}, options = {}) {
    const [messages, config] = await Promise.all([
      this.getPrompt(bot, promptId, variables, options),
      this.getPromptConfig(bot, promptId, options),
    ]);

    return { messages, config };
  }

  /**
   * Check if a prompt exists
   * 
   * @param {string} bot
   * @param {string} promptId
   * @param {Object} [options={}]
   * @returns {Promise<boolean>}
   */
  async hasPrompt(bot, promptId, options = {}) {
    const username = this.#resolveUsername(options);
    const promptDef = await this.#loader.loadPrompt(bot, promptId, username);
    return !!promptDef;
  }

  /**
   * List available prompt IDs
   * 
   * @param {string} bot
   * @param {Object} [options={}]
   * @returns {Promise<string[]>}
   */
  async listPrompts(bot, options = {}) {
    const username = this.#resolveUsername(options);
    return this.#loader.listPromptIds(bot, username);
  }

  /**
   * Get the raw prompt definition (for debugging/admin)
   * 
   * @param {string} bot
   * @param {string} promptId
   * @param {Object} [options={}]
   * @returns {Promise<Object|null>}
   */
  async getRawPrompt(bot, promptId, options = {}) {
    const username = this.#resolveUsername(options);
    return this.#loader.loadPrompt(bot, promptId, username);
  }

  /**
   * Clear prompt cache
   * 
   * @param {string} [bot] - Optional: clear specific bot only
   * @param {Object} [options={}]
   */
  clearCache(bot = null, options = {}) {
    const username = this.#resolveUsername(options);
    this.#loader.clearCache(bot, username);
  }

  /**
   * Get the file path where prompts would be stored
   * 
   * @param {string} bot
   * @param {Object} [options={}]
   * @returns {string}
   */
  getPromptPath(bot, options = {}) {
    const username = this.#resolveUsername(options);
    return this.#loader.getPromptPath(bot, username);
  }

  /**
   * Resolve username from options
   * @private
   */
  #resolveUsername(options) {
    // Direct username
    if (options.username) {
      return options.username;
    }

    // Resolve from userId via UserResolver
    if (options.userId && this.#userResolver) {
      return this.#userResolver.resolveUsername(options.userId);
    }

    // Resolve from conversationId via UserResolver
    if (options.conversationId && this.#userResolver) {
      return this.#userResolver.resolveUsername(options.conversationId);
    }

    return null;
  }
}

export default PromptRepository;
