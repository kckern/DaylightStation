/**
 * AI Gateway Port Interface
 * @module lib/ai/IAIGateway
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
 * 
 * Implementations:
 * - OpenAIGateway: Real OpenAI API
 * - MockAIGateway: Deterministic mock for testing
 * 
 * @interface IAIGateway
 */

/**
 * @typedef {Object} IAIGateway
 * @property {function} chat - Send conversation, get text response
 * @property {function} chatWithImage - Vision model call with image
 * @property {function} chatWithJson - Get structured JSON response
 * @property {function} transcribe - Transcribe audio to text
 * @property {function} embed - Get text embedding vector
 */

/**
 * Method signatures for IAIGateway:
 * 
 * chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>
 *   - Send conversation messages to LLM
 *   - Returns text response
 * 
 * chatWithImage(messages: ChatMessage[], imageUrl: string, options?: ChatOptions): Promise<string>
 *   - Send conversation with image for vision analysis
 *   - imageUrl can be URL or base64 data URL
 *   - Returns text response
 * 
 * chatWithJson(messages: ChatMessage[], options?: ChatOptions): Promise<object>
 *   - Request JSON-formatted response
 *   - Automatically parses response
 *   - May retry on parse failure
 *   - Returns parsed object
 * 
 * transcribe(audioBuffer: Buffer, options?: TranscriptionOptions): Promise<string>
 *   - Transcribe audio using Whisper
 *   - Returns transcribed text
 * 
 * embed(text: string): Promise<number[]>
 *   - Generate embedding vector for text
 *   - Returns array of floats
 */

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
 * Create a type-safe wrapper that validates gateway implementation
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

export default {
  isAIGateway,
  assertAIGateway,
  systemMessage,
  userMessage,
  assistantMessage,
};
