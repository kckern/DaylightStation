/**
 * Logging AI Gateway Wrapper
 * @module journalist/adapters/LoggingAIGateway
 *
 * Wraps the AI gateway to log all GPT calls for debugging.
 * Saves the last prompt and response to last_gpt.yml.
 */

import { nowTs24 } from '../../0_system/utils/index.mjs';

/**
 * AI Gateway wrapper that logs calls
 */
export class LoggingAIGateway {
  #aiGateway;
  #logger;
  #username;
  #saveFile;

  /**
   * @param {Object} deps
   * @param {Object} deps.aiGateway - The actual AI gateway instance
   * @param {string} deps.username - Username for file path
   * @param {Object} [deps.logger] - Logger instance
   * @param {Function} [deps.saveFile] - Function to save files
   */
  constructor(deps) {
    if (!deps.aiGateway) throw new Error('aiGateway is required');
    if (!deps.username) throw new Error('username is required');

    this.#aiGateway = deps.aiGateway;
    this.#username = deps.username;
    this.#logger = deps.logger;
    this.#saveFile = deps.saveFile;
  }

  /**
   * Chat with AI and log the interaction
   * @param {Array|Object} messages - Messages array or single message
   * @param {Object} [options] - Chat options
   * @returns {Promise<string>} AI response
   */
  async chat(messages, options = {}) {
    const startTime = Date.now();

    try {
      // Call the actual AI gateway
      const response = await this.#aiGateway.chat(messages, options);

      // Log the interaction
      this.#logInteraction(messages, response, options, startTime, null);

      return response;
    } catch (error) {
      // Log the error
      this.#logInteraction(messages, null, options, startTime, error);
      throw error;
    }
  }

  /**
   * Log the interaction to file
   * @private
   */
  #logInteraction(messages, response, options, startTime, error) {
    try {
      const duration = Date.now() - startTime;

      const logEntry = {
        timestamp: nowTs24(),
        username: this.#username,
        duration_ms: duration,
        options: options,
        messages: messages,
        response: error ? null : response,
        error: error ? error.message : null,
      };

      // Save to file if saveFile function is available
      if (this.#saveFile) {
        this.#saveFile(`journalist/last_gpt.yml`, logEntry);
      }

      if (this.#logger) {
        this.#logger.debug('journalist.gpt.logged', {
          username: this.#username,
          duration,
          error: error?.message,
        });
      }
    } catch (logError) {
      // Don't let logging errors break the main flow
      if (this.#logger) {
        this.#logger.warn('journalist.gpt.log-failed', { error: logError.message });
      }
    }
  }

  /**
   * Pass through any other methods from the wrapped gateway
   */
  [Symbol.for('nodejs.util.inspect.custom')]() {
    return `LoggingAIGateway(${this.#username})`;
  }
}

export default LoggingAIGateway;
