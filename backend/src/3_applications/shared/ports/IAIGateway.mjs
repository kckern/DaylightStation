/**
 * IAIGateway Port Interface
 *
 * Abstract interface for AI/LLM services.
 * Implementations: OpenAIAdapter, AnthropicAdapter
 */

/**
 * @typedef {Object} ChatMessage
 * @property {'system'|'user'|'assistant'} role - Message role
 * @property {string} content - Message content
 */

/**
 * @typedef {Object} ChatOptions
 * @property {string} [model] - Model to use (overrides default)
 * @property {number} [maxTokens] - Maximum tokens in response
 * @property {number} [temperature] - Sampling temperature (0-2)
 * @property {boolean} [jsonMode=false] - Request JSON response format
 * @property {number} [timeout] - Request timeout in ms
 */

/**
 * @typedef {Object} TranscriptionOptions
 * @property {string} [language] - Language hint (ISO 639-1)
 * @property {string} [prompt] - Prompt to guide transcription
 */

/**
 * Abstract interface for AI/LLM services
 * @interface IAIGateway
 */
export class IAIGateway {
  /**
   * Send conversation and get text response
   * @param {ChatMessage[]} messages - Conversation messages
   * @param {ChatOptions} [options] - Optional configuration
   * @returns {Promise<string>} - Text response
   */
  async chat(messages, options = {}) {
    throw new Error('IAIGateway.chat must be implemented');
  }

  /**
   * Send conversation with image for vision analysis
   * @param {ChatMessage[]} messages - Conversation messages
   * @param {string} imageUrl - URL or base64 data URL
   * @param {ChatOptions} [options] - Optional configuration
   * @returns {Promise<string>} - Text response
   */
  async chatWithImage(messages, imageUrl, options = {}) {
    throw new Error('IAIGateway.chatWithImage must be implemented');
  }

  /**
   * Get structured JSON response
   * @param {ChatMessage[]} messages - Conversation messages
   * @param {ChatOptions} [options] - Optional configuration
   * @returns {Promise<Object>} - Parsed JSON response
   */
  async chatWithJson(messages, options = {}) {
    throw new Error('IAIGateway.chatWithJson must be implemented');
  }

  /**
   * Transcribe audio to text
   * @param {Buffer} audioBuffer - Audio data
   * @param {TranscriptionOptions} [options] - Optional configuration
   * @returns {Promise<string>} - Transcribed text
   */
  async transcribe(audioBuffer, options = {}) {
    throw new Error('IAIGateway.transcribe must be implemented');
  }

  /**
   * Generate text embedding vector
   * @param {string} text - Text to embed
   * @returns {Promise<number[]>} - Embedding vector
   */
  async embed(text) {
    throw new Error('IAIGateway.embed must be implemented');
  }

  /**
   * Check if gateway is configured
   * @returns {boolean}
   */
  isConfigured() {
    throw new Error('IAIGateway.isConfigured must be implemented');
  }
}

/**
 * Validate that an object implements IAIGateway
 * @param {Object} obj - Object to validate
 * @returns {boolean}
 */
export function isAIGateway(obj) {
  if (!obj || typeof obj !== 'object') return false;

  const requiredMethods = [
    'chat',
    'chatWithImage',
    'chatWithJson',
    'transcribe',
    'embed',
  ];

  return requiredMethods.every(method => typeof obj[method] === 'function');
}

/**
 * Assert that object implements IAIGateway
 * @template T
 * @param {T} gateway - Gateway implementation
 * @returns {T}
 * @throws {Error} if gateway doesn't implement IAIGateway
 */
export function assertAIGateway(gateway) {
  if (!isAIGateway(gateway)) {
    throw new Error('Object does not implement IAIGateway interface');
  }
  return gateway;
}

/**
 * Helper to create a system message
 * @param {string} content - System prompt content
 * @returns {ChatMessage}
 */
export function systemMessage(content) {
  return { role: 'system', content };
}

/**
 * Helper to create a user message
 * @param {string} content - User message content
 * @returns {ChatMessage}
 */
export function userMessage(content) {
  return { role: 'user', content };
}

/**
 * Helper to create an assistant message
 * @param {string} content - Assistant response content
 * @returns {ChatMessage}
 */
export function assistantMessage(content) {
  return { role: 'assistant', content };
}

export default IAIGateway;
