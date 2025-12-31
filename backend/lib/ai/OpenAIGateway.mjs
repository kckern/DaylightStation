/**
 * OpenAI API Gateway Implementation
 * @module lib/ai/OpenAIGateway
 */

import axios from 'axios';
import { AIServiceError, AIRateLimitError, AITimeoutError } from './errors.mjs';
import { createLogger } from '../logging/logger.js';

const OPENAI_API_BASE = 'https://api.openai.com/v1';

/**
 * OpenAI API implementation of IAIGateway
 */
export class OpenAIGateway {
  #apiKey;
  #model;
  #maxTokens;
  #timeout;
  #logger;
  #rateLimiter;

  /**
   * @param {Object} config - Gateway configuration
   * @param {string} config.apiKey - OpenAI API key
   * @param {string} [config.model='gpt-4o'] - Default model
   * @param {number} [config.maxTokens=1000] - Default max tokens
   * @param {number} [config.timeout=60000] - Request timeout in ms
   * @param {Object} [options] - Additional options
   * @param {Object} [options.logger] - Logger instance
   * @param {Object} [options.rateLimiter] - Rate limiter instance
   */
  constructor(config, options = {}) {
    if (!config?.apiKey) {
      throw new Error('OpenAI API key is required');
    }

    this.#apiKey = config.apiKey;
    this.#model = config.model || 'gpt-4o';
    this.#maxTokens = config.maxTokens || 1000;
    this.#timeout = config.timeout || 60000;
    this.#logger = options.logger || createLogger({ source: 'backend', app: 'ai' });
    this.#rateLimiter = options.rateLimiter || null;
  }

  /**
   * Get the default model
   * @returns {string}
   */
  get model() {
    return this.#model;
  }

  /**
   * Call OpenAI API
   * @private
   * @param {string} endpoint - API endpoint (e.g., '/chat/completions')
   * @param {Object} data - Request body
   * @param {Object} [options] - Request options
   * @returns {Promise<Object>}
   */
  async #callApi(endpoint, data, options = {}) {
    const url = `${OPENAI_API_BASE}${endpoint}`;
    
    // Check rate limit if configured
    if (this.#rateLimiter) {
      const canProceed = this.#rateLimiter.tryAcquire();
      if (!canProceed) {
        throw new AIRateLimitError('OpenAI', 60, { endpoint });
      }
    }

    this.#logger.debug('ai.openai.request', { 
      endpoint, 
      model: data.model,
      messageCount: data.messages?.length,
    });

    try {
      const response = await axios.post(url, data, {
        timeout: options.timeout || this.#timeout,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.#apiKey}`,
        },
      });

      this.#logger.debug('ai.openai.response', { 
        endpoint, 
        usage: response.data.usage,
      });

      return response.data;
    } catch (error) {
      // Handle rate limiting
      if (error.response?.status === 429) {
        const retryAfter = parseInt(error.response.headers['retry-after'] || '60', 10);
        this.#logger.warn('ai.openai.rateLimit', { endpoint, retryAfter });
        throw new AIRateLimitError('OpenAI', retryAfter, { endpoint });
      }

      // Handle timeout
      if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        this.#logger.error('ai.openai.timeout', { endpoint, timeout: this.#timeout });
        throw new AITimeoutError('OpenAI API call', this.#timeout, { endpoint });
      }

      // Handle other API errors
      const message = error.response?.data?.error?.message || error.message;
      this.#logger.error('ai.openai.error', { endpoint, error: message });
      throw new AIServiceError('OpenAI', message, {
        endpoint,
        statusCode: error.response?.status,
      });
    }
  }

  /**
   * Call chat completions API
   * @private
   */
  async #callCompletions(messages, options = {}) {
    const data = {
      model: options.model || this.#model,
      messages,
      max_tokens: options.maxTokens || this.#maxTokens,
    };

    if (options.temperature !== undefined) {
      data.temperature = options.temperature;
    }

    if (options.jsonMode) {
      data.response_format = { type: 'json_object' };
    }

    return this.#callApi('/chat/completions', data, options);
  }

  /**
   * Send conversation and get text response
   * @param {Array<{role: string, content: string}>} messages
   * @param {Object} [options]
   * @returns {Promise<string>}
   */
  async chat(messages, options = {}) {
    const response = await this.#callCompletions(messages, options);
    return response.choices[0].message.content;
  }

  /**
   * Send conversation with image for vision analysis
   * @param {Array<{role: string, content: string}>} messages
   * @param {string} imageUrl - URL or base64 data URL
   * @param {Object} [options]
   * @returns {Promise<string>}
   */
  async chatWithImage(messages, imageUrl, options = {}) {
    // Use vision model if not specified
    const model = options.model || 'gpt-4o';
    
    // Build messages with image
    const messagesWithImage = messages.map((msg, index) => {
      // Add image to last user message
      if (msg.role === 'user' && index === messages.length - 1) {
        return {
          role: 'user',
          content: [
            { type: 'text', text: msg.content },
            { 
              type: 'image_url', 
              image_url: { 
                url: imageUrl,
                detail: options.imageDetail || 'auto',
              },
            },
          ],
        };
      }
      return msg;
    });

    const response = await this.#callCompletions(messagesWithImage, { ...options, model });
    return response.choices[0].message.content;
  }

  /**
   * Get structured JSON response
   * @param {Array<{role: string, content: string}>} messages
   * @param {Object} [options]
   * @returns {Promise<Object>}
   */
  async chatWithJson(messages, options = {}) {
    const response = await this.chat(messages, { ...options, jsonMode: true });
    
    try {
      return JSON.parse(response);
    } catch (parseError) {
      // Retry with explicit instruction
      this.#logger.warn('ai.openai.json.parseError', { error: parseError.message });
      
      const retryMessages = [
        ...messages,
        { role: 'assistant', content: response },
        { role: 'user', content: 'Please respond with valid JSON only. No additional text.' },
      ];
      
      const retryResponse = await this.chat(retryMessages, { ...options, jsonMode: true });
      
      try {
        return JSON.parse(retryResponse);
      } catch (retryParseError) {
        this.#logger.error('ai.openai.json.retryFailed', { response: retryResponse });
        throw new AIServiceError('OpenAI', 'Failed to parse JSON response after retry', {
          response: retryResponse,
        });
      }
    }
  }

  /**
   * Transcribe audio using Whisper
   * @param {Buffer} audioBuffer
   * @param {Object} [options]
   * @returns {Promise<string>}
   */
  async transcribe(audioBuffer, options = {}) {
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    
    form.append('file', audioBuffer, {
      filename: 'audio.ogg',
      contentType: 'audio/ogg',
    });
    form.append('model', 'whisper-1');
    
    if (options.language) {
      form.append('language', options.language);
    }
    if (options.prompt) {
      form.append('prompt', options.prompt);
    }

    this.#logger.debug('ai.openai.transcribe.request', { 
      size: audioBuffer.length,
      language: options.language,
    });

    try {
      const response = await axios.post(`${OPENAI_API_BASE}/audio/transcriptions`, form, {
        timeout: this.#timeout,
        headers: {
          ...form.getHeaders(),
          'Authorization': `Bearer ${this.#apiKey}`,
        },
      });

      this.#logger.debug('ai.openai.transcribe.response', { 
        textLength: response.data.text?.length,
      });

      return response.data.text;
    } catch (error) {
      const message = error.response?.data?.error?.message || error.message;
      this.#logger.error('ai.openai.transcribe.error', { error: message });
      throw new AIServiceError('OpenAI', `Transcription failed: ${message}`);
    }
  }

  /**
   * Generate text embedding
   * @param {string} text
   * @returns {Promise<number[]>}
   */
  async embed(text) {
    const data = {
      model: 'text-embedding-3-small',
      input: text,
    };

    const response = await this.#callApi('/embeddings', data);
    return response.data[0].embedding;
  }
}

export default OpenAIGateway;
