/**
 * AI Gateway Module
 * 
 * Provides a unified interface for AI/LLM operations across the entire backend.
 * 
 * Usage:
 *   import { getAIGateway, systemMessage, userMessage } from './ai/index.mjs';
 *   
 *   const ai = getAIGateway();
 *   const response = await ai.chatWithJson([
 *     systemMessage('Extract data from text'),
 *     userMessage(emailContent)
 *   ]);
 * 
 * @module lib/ai
 */

import { OpenAIGateway } from './OpenAIGateway.mjs';
import { createLogger } from '../logging/logger.js';

// Re-export interface and helpers
export {
  isAIGateway,
  assertAIGateway,
  systemMessage,
  userMessage,
  assistantMessage,
} from './IAIGateway.mjs';

// Re-export error classes
export {
  AIError,
  AIServiceError,
  AIRateLimitError,
  AITimeoutError,
  isAIError,
  isAIServiceError,
  isAIRateLimitError,
  isAITimeoutError,
  isRetryableAIError,
} from './errors.mjs';

// Re-export gateway class for custom instantiation
export { OpenAIGateway } from './OpenAIGateway.mjs';

// Singleton instance (lazy-loaded)
let _gateway = null;

/**
 * Get the shared AI gateway instance
 * Creates on first call, reuses thereafter
 * 
 * @param {object} [options] - Override default config
 * @param {string} [options.model] - Default model (default: 'gpt-4o')
 * @param {number} [options.maxTokens] - Default max tokens (default: 2000)
 * @returns {OpenAIGateway}
 * @throws {Error} if OPENAI_API_KEY not configured
 */
export function getAIGateway(options = {}) {
    if (!_gateway) {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY not configured in environment');
        }
        
        _gateway = new OpenAIGateway(
            { 
                apiKey,
                model: options.model || 'gpt-4o',
                maxTokens: options.maxTokens || 2000,
            },
            { 
                logger: createLogger({ source: 'backend', app: 'ai' })
            }
        );
    }
    return _gateway;
}

/**
 * Create a new AI gateway instance with custom config
 * Use this when you need different settings than the default singleton
 * 
 * @param {object} config - Gateway config
 * @param {string} config.apiKey - OpenAI API key
 * @param {string} [config.model='gpt-4o'] - Default model
 * @param {number} [config.maxTokens=1000] - Default max tokens
 * @param {number} [config.timeout=60000] - Request timeout in ms
 * @param {object} [options] - Additional options
 * @param {object} [options.logger] - Logger instance
 * @param {object} [options.rateLimiter] - Rate limiter instance
 * @returns {OpenAIGateway}
 */
export function createAIGateway(config, options = {}) {
    return new OpenAIGateway(config, options);
}

/**
 * Reset the singleton instance (useful for testing)
 * @private
 */
export function _resetGateway() {
    _gateway = null;
}

// Default export for convenience
export default { 
    getAIGateway, 
    createAIGateway,
    OpenAIGateway,
};
