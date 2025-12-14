/**
 * Mock AI Gateway for Testing
 * @module infrastructure/ai/MockAIGateway
 */

/**
 * Deterministic mock implementation of IAIGateway
 * Useful for testing without API calls
 */
export class MockAIGateway {
  /** @type {Array<Object>} */
  #calls = [];
  
  /** @type {Map<string|RegExp, string>} */
  #responses = new Map();
  
  /** @type {Map<string|RegExp, Object>} */
  #jsonResponses = new Map();
  
  /** @type {string} */
  #defaultResponse = 'Mock response';
  
  /** @type {Object} */
  #defaultJsonResponse = { success: true };
  
  /** @type {string} */
  #defaultTranscription = 'Mock transcription';
  
  /** @type {number[]} */
  #defaultEmbedding = new Array(1536).fill(0).map(() => Math.random());
  
  /** @type {Error|null} */
  #simulatedError = null;
  
  /** @type {number} */
  #latencyMs = 0;

  constructor() {
    this.model = 'mock-gpt-4';
  }

  // ==================== IAIGateway Implementation ====================

  /**
   * Send conversation and get text response
   * @param {Array<{role: string, content: string}>} messages
   * @param {Object} [options]
   * @returns {Promise<string>}
   */
  async chat(messages, options = {}) {
    await this.#maybeDelay();
    this.#checkForError();
    
    this.#calls.push({
      method: 'chat',
      messages,
      options,
      timestamp: new Date().toISOString(),
    });

    // Find matching response
    const lastUserMessage = this.#getLastUserMessage(messages);
    return this.#findResponse(lastUserMessage);
  }

  /**
   * Send conversation with image
   * @param {Array<{role: string, content: string}>} messages
   * @param {string} imageUrl
   * @param {Object} [options]
   * @returns {Promise<string>}
   */
  async chatWithImage(messages, imageUrl, options = {}) {
    await this.#maybeDelay();
    this.#checkForError();
    
    this.#calls.push({
      method: 'chatWithImage',
      messages,
      imageUrl,
      options,
      timestamp: new Date().toISOString(),
    });

    const lastUserMessage = this.#getLastUserMessage(messages);
    return this.#findResponse(lastUserMessage);
  }

  /**
   * Get structured JSON response
   * @param {Array<{role: string, content: string}>} messages
   * @param {Object} [options]
   * @returns {Promise<Object>}
   */
  async chatWithJson(messages, options = {}) {
    await this.#maybeDelay();
    this.#checkForError();
    
    this.#calls.push({
      method: 'chatWithJson',
      messages,
      options,
      timestamp: new Date().toISOString(),
    });

    const lastUserMessage = this.#getLastUserMessage(messages);
    return this.#findJsonResponse(lastUserMessage);
  }

  /**
   * Transcribe audio
   * @param {Buffer} audioBuffer
   * @param {Object} [options]
   * @returns {Promise<string>}
   */
  async transcribe(audioBuffer, options = {}) {
    await this.#maybeDelay();
    this.#checkForError();
    
    this.#calls.push({
      method: 'transcribe',
      bufferSize: audioBuffer.length,
      options,
      timestamp: new Date().toISOString(),
    });

    return this.#defaultTranscription;
  }

  /**
   * Generate text embedding
   * @param {string} text
   * @returns {Promise<number[]>}
   */
  async embed(text) {
    await this.#maybeDelay();
    this.#checkForError();
    
    this.#calls.push({
      method: 'embed',
      text,
      timestamp: new Date().toISOString(),
    });

    return [...this.#defaultEmbedding];
  }

  // ==================== Configuration ====================

  /**
   * Set response for a prompt pattern
   * @param {string|RegExp} pattern - Pattern to match against user message
   * @param {string} response - Response to return
   */
  setResponse(pattern, response) {
    this.#responses.set(pattern, response);
  }

  /**
   * Set JSON response for a prompt pattern
   * @param {string|RegExp} pattern
   * @param {Object} response
   */
  setJsonResponse(pattern, response) {
    this.#jsonResponses.set(pattern, response);
  }

  /**
   * Set default response
   * @param {string} response
   */
  setDefaultResponse(response) {
    this.#defaultResponse = response;
  }

  /**
   * Set default JSON response
   * @param {Object} response
   */
  setDefaultJsonResponse(response) {
    this.#defaultJsonResponse = response;
  }

  /**
   * Set default transcription result
   * @param {string} transcription
   */
  setDefaultTranscription(transcription) {
    this.#defaultTranscription = transcription;
  }

  /**
   * Set simulated latency
   * @param {number} ms
   */
  setLatency(ms) {
    this.#latencyMs = ms;
  }

  /**
   * Simulate an error on next call
   * @param {Error} error
   */
  simulateError(error) {
    this.#simulatedError = error;
  }

  /**
   * Clear simulated error
   */
  clearError() {
    this.#simulatedError = null;
  }

  // ==================== Testing Helpers ====================

  /**
   * Get all recorded calls
   * @returns {Array<Object>}
   */
  getCalls() {
    return [...this.#calls];
  }

  /**
   * Get the last call
   * @returns {Object|null}
   */
  getLastCall() {
    return this.#calls.length > 0 ? this.#calls[this.#calls.length - 1] : null;
  }

  /**
   * Get calls filtered by method
   * @param {string} method
   * @returns {Array<Object>}
   */
  getCallsByMethod(method) {
    return this.#calls.filter(c => c.method === method);
  }

  /**
   * Assert that a call was made with matching pattern
   * @param {string|RegExp} pattern
   * @throws {Error} if no matching call found
   */
  assertCalledWith(pattern) {
    const found = this.#calls.some(call => {
      if (!call.messages) return false;
      const lastUserMsg = this.#getLastUserMessageFromCall(call);
      return this.#matches(lastUserMsg, pattern);
    });
    
    if (!found) {
      throw new Error(`Expected call with pattern "${pattern}" not found`);
    }
  }

  /**
   * Get count of calls
   * @returns {number}
   */
  get callCount() {
    return this.#calls.length;
  }

  /**
   * Reset all state
   */
  reset() {
    this.#calls = [];
    this.#responses.clear();
    this.#jsonResponses.clear();
    this.#defaultResponse = 'Mock response';
    this.#defaultJsonResponse = { success: true };
    this.#defaultTranscription = 'Mock transcription';
    this.#simulatedError = null;
    this.#latencyMs = 0;
  }

  // ==================== Private Helpers ====================

  /**
   * Get last user message from messages array
   * @private
   */
  #getLastUserMessage(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        return messages[i].content;
      }
    }
    return '';
  }

  /**
   * Get last user message from a call record
   * @private
   */
  #getLastUserMessageFromCall(call) {
    if (!call.messages) return '';
    return this.#getLastUserMessage(call.messages);
  }

  /**
   * Check if content matches pattern
   * @private
   */
  #matches(content, pattern) {
    if (pattern instanceof RegExp) {
      return pattern.test(content);
    }
    return content.includes(pattern);
  }

  /**
   * Find matching response
   * @private
   */
  #findResponse(content) {
    for (const [pattern, response] of this.#responses) {
      if (this.#matches(content, pattern)) {
        return response;
      }
    }
    return this.#defaultResponse;
  }

  /**
   * Find matching JSON response
   * @private
   */
  #findJsonResponse(content) {
    for (const [pattern, response] of this.#jsonResponses) {
      if (this.#matches(content, pattern)) {
        return JSON.parse(JSON.stringify(response)); // Deep copy
      }
    }
    return JSON.parse(JSON.stringify(this.#defaultJsonResponse));
  }

  /**
   * Check for and throw simulated error
   * @private
   */
  #checkForError() {
    if (this.#simulatedError) {
      const error = this.#simulatedError;
      this.#simulatedError = null;
      throw error;
    }
  }

  /**
   * Maybe delay for simulated latency
   * @private
   */
  async #maybeDelay() {
    if (this.#latencyMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.#latencyMs));
    }
  }
}

export default MockAIGateway;
