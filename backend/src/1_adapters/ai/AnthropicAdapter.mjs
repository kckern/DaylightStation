/**
 * AnthropicAdapter - Anthropic Claude API implementation
 *
 * Implements IAIGateway for Anthropic's Claude API.
 * Supports chat completions and vision.
 * Note: Does not support transcription or embeddings (use OpenAI for those).
 */

import { IAIGateway } from '#apps/common/ports/IAIGateway.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const ANTHROPIC_API_BASE = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';

export class AnthropicAdapter extends IAIGateway {
  /**
   * @param {Object} config
   * @param {string} config.apiKey - Anthropic API key
   * @param {string} [config.model='claude-sonnet-4-20250514'] - Default model
   * @param {number} [config.maxTokens=1000] - Default max tokens
   * @param {number} [config.timeout=60000] - Request timeout in ms
   * @param {Object} [deps] - Dependencies
   * @param {Object} [deps.httpClient] - HTTP client (defaults to fetch)
   * @param {Object} [deps.logger] - Logger instance
   */
  constructor(config, deps = {}) {
    super();

    if (!config?.apiKey) {
      throw new InfrastructureError('Anthropic API key is required', {
        code: 'MISSING_CONFIG',
        field: 'apiKey'
      });
    }
    if (!deps.httpClient) {
      throw new InfrastructureError('AnthropicAdapter requires httpClient', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'httpClient'
      });
    }

    this.apiKey = config.apiKey;
    this.model = config.model || 'claude-sonnet-4-20250514';
    this.maxTokens = config.maxTokens || 1000;
    this.timeout = config.timeout || 60000;
    this.httpClient = deps.httpClient;
    this.logger = deps.logger || console;

    // Metrics
    this.metrics = {
      startedAt: Date.now(),
      requestCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      errors: 0
    };
  }

  /**
   * Make an API request
   * @private
   */
  async callApi(endpoint, data, options = {}) {
    const url = `${ANTHROPIC_API_BASE}${endpoint}`;

    this.logger.debug?.('anthropic.request', {
      endpoint,
      model: data.model,
      messageCount: data.messages?.length
    });

    this.metrics.requestCount++;

    try {
      const response = await this._makeRequest(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION
        },
        body: JSON.stringify(data),
        timeout: options.timeout || this.timeout
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        this.metrics.errors++;

        if (response.status === 429) {
          const retryAfter = response.headers.get('retry-after') || 60;
          const error = new Error(`Rate limit exceeded. Retry after ${retryAfter}s`);
          error.code = 'RATE_LIMIT';
          error.retryAfter = parseInt(retryAfter, 10);
          throw error;
        }

        throw new InfrastructureError(errorData.error?.message || `AI API error: ${response.status}`, {
          code: 'EXTERNAL_SERVICE_ERROR',
          service: 'Anthropic',
          statusCode: response.status
        });
      }

      const result = await response.json();

      // Track token usage
      if (result.usage) {
        this.metrics.inputTokens += result.usage.input_tokens || 0;
        this.metrics.outputTokens += result.usage.output_tokens || 0;
      }

      this.logger.debug?.('anthropic.response', {
        endpoint,
        usage: result.usage
      });

      return result;
    } catch (error) {
      if (!error.code) {
        this.metrics.errors++;
      }
      this.logger.error?.('anthropic.error', { endpoint, error: error.message });
      throw error;
    }
  }

  /**
   * Internal HTTP request method
   * @private
   */
  async _makeRequest(url, options) {
    // Adapt httpClient.post to return fetch-like response
    // This maintains compatibility with existing callApi method
    const response = await this.httpClient.post(
      url,
      JSON.parse(options.body),
      {
        headers: options.headers,
        timeout: options.timeout
      }
    );

    return {
      ok: response.ok,
      status: response.status,
      json: () => Promise.resolve(response.data),
      headers: {
        get: (key) => response.headers[key.toLowerCase()]
      }
    };
  }

  /**
   * Convert OpenAI-style messages to Anthropic format
   * @private
   */
  convertMessages(messages) {
    let systemPrompt = null;
    const anthropicMessages = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrompt = msg.content;
      } else {
        anthropicMessages.push({
          role: msg.role,
          content: msg.content
        });
      }
    }

    return { systemPrompt, messages: anthropicMessages };
  }

  // ============ IAIGateway Implementation ============

  /**
   * Send conversation and get text response
   */
  async chat(messages, options = {}) {
    const { systemPrompt, messages: anthropicMessages } = this.convertMessages(messages);

    const data = {
      model: options.model || this.model,
      max_tokens: options.maxTokens || this.maxTokens,
      messages: anthropicMessages
    };

    if (systemPrompt) {
      data.system = systemPrompt;
    }

    if (options.temperature !== undefined) {
      data.temperature = options.temperature;
    }

    const response = await this.callApi('/messages', data, options);
    return response.content[0].text;
  }

  /**
   * Send conversation with image for vision analysis
   */
  async chatWithImage(messages, imageUrl, options = {}) {
    const { systemPrompt, messages: anthropicMessages } = this.convertMessages(messages);

    // Build messages with image in last user message
    const messagesWithImage = anthropicMessages.map((msg, index) => {
      if (msg.role === 'user' && index === anthropicMessages.length - 1) {
        // Determine if base64 or URL
        const isBase64 = imageUrl.startsWith('data:');

        const imageContent = isBase64
          ? {
              type: 'image',
              source: {
                type: 'base64',
                media_type: imageUrl.split(';')[0].split(':')[1],
                data: imageUrl.split(',')[1]
              }
            }
          : {
              type: 'image',
              source: {
                type: 'url',
                url: imageUrl
              }
            };

        return {
          role: 'user',
          content: [
            imageContent,
            { type: 'text', text: msg.content }
          ]
        };
      }
      return msg;
    });

    const data = {
      model: options.model || this.model,
      max_tokens: options.maxTokens || this.maxTokens,
      messages: messagesWithImage
    };

    if (systemPrompt) {
      data.system = systemPrompt;
    }

    const response = await this.callApi('/messages', data, options);
    return response.content[0].text;
  }

  /**
   * Attempt to repair common JSON issues
   * @private
   */
  #repairJSON(jsonString) {
    let repaired = jsonString;

    // Remove trailing commas before closing brackets/braces
    repaired = repaired.replace(/,(\s*[\]}])/g, '$1');

    // Fix missing commas between array elements (common AI error)
    repaired = repaired.replace(/}\s*{(?!\s*[,\]])/g, '},\n{');

    // Fix missing commas between object properties
    repaired = repaired.replace(/"\s*\n\s*"/g, '","');

    // Remove comments (sometimes AI adds them)
    repaired = repaired.replace(/\/\/.*$/gm, '');
    repaired = repaired.replace(/\/\*[\s\S]*?\*\//g, '');

    return repaired;
  }

  /**
   * Extract and parse JSON from response (handles wrapped JSON and markdown)
   * @private
   */
  #extractAndParseJSON(response) {
    let jsonStr = response.trim();

    // Remove markdown code block if present
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.slice(7);
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.slice(3);
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.slice(0, -3);
    }
    jsonStr = jsonStr.trim();

    // Try to extract JSON object from response if not already cleaned
    if (!jsonStr.startsWith('{')) {
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      } else {
        throw new Error('No JSON object found in response');
      }
    }

    // First attempt: direct parse
    try {
      return JSON.parse(jsonStr);
    } catch (directError) {
      this.logger.debug?.('anthropic.json.attemptRepair', {
        error: directError.message,
        position: directError.message.match(/position (\d+)/)?.[1],
      });

      // Second attempt: repair and parse
      try {
        const repaired = this.#repairJSON(jsonStr);
        const parsed = JSON.parse(repaired);
        this.logger.info?.('anthropic.json.repairSucceeded', {
          originalError: directError.message,
        });
        return parsed;
      } catch (repairError) {
        // Both attempts failed
        const error = new Error(`JSON parse failed: ${directError.message}`);
        error.originalError = directError;
        error.repairError = repairError;
        error.sample = jsonStr.substring(0, 200);
        throw error;
      }
    }
  }

  /**
   * Get structured JSON response with validation and repair
   */
  async chatWithJson(messages, options = {}) {
    const maxParseAttempts = options.maxParseAttempts || 2;

    // Anthropic doesn't have a native JSON mode, so we add instruction
    const jsonMessages = [...messages];
    const lastMsg = jsonMessages[jsonMessages.length - 1];

    if (lastMsg.role === 'user') {
      jsonMessages[jsonMessages.length - 1] = {
        ...lastMsg,
        content: lastMsg.content + '\n\nRespond with valid JSON only. No additional text or markdown.'
      };
    }

    for (let attempt = 1; attempt <= maxParseAttempts; attempt++) {
      const isRetry = attempt > 1;
      const messagesToSend = isRetry
        ? [
            ...messages,
            { role: 'user', content: 'Please respond with valid, complete JSON only. No markdown, no explanation. Ensure all arrays and objects are properly closed.' }
          ]
        : jsonMessages;

      try {
        const response = await this.chat(messagesToSend, options);

        // Extract and parse with repair capability
        const parsed = this.#extractAndParseJSON(response);

        if (isRetry) {
          this.logger.info?.('anthropic.json.parseRecovered', { attempt });
        }

        return parsed;
      } catch (parseError) {
        const isLastAttempt = attempt === maxParseAttempts;

        this.logger.warn?.('anthropic.json.parseError', {
          attempt,
          maxAttempts: maxParseAttempts,
          error: parseError.message,
          sample: parseError.sample,
        });

        if (isLastAttempt) {
          this.logger.error?.('anthropic.json.exhausted', {
            attempts: maxParseAttempts,
            originalError: parseError.originalError?.message,
            repairError: parseError.repairError?.message,
          });

          throw new InfrastructureError('Failed to parse JSON response after all attempts', {
            code: 'INVALID_JSON_RESPONSE',
            service: 'Anthropic',
            attempts: maxParseAttempts,
            details: parseError.message,
          });
        }

        // Continue to next attempt
      }
    }
  }

  /**
   * Transcribe audio - NOT SUPPORTED
   * Use OpenAI Whisper instead
   */
  async transcribe(audioBuffer, options = {}) {
    throw new InfrastructureError('Anthropic does not support audio transcription. Use OpenAI Whisper.', {
      code: 'NOT_IMPLEMENTED',
      service: 'Anthropic',
      feature: 'transcription'
    });
  }

  /**
   * Generate embedding - NOT SUPPORTED
   * Use OpenAI embeddings instead
   */
  async embed(text) {
    throw new InfrastructureError('Anthropic does not support embeddings. Use OpenAI embeddings.', {
      code: 'NOT_IMPLEMENTED',
      service: 'Anthropic',
      feature: 'embeddings'
    });
  }

  // ============ Utilities ============

  /**
   * Check if adapter is configured
   */
  isConfigured() {
    return !!this.apiKey;
  }

  /**
   * Get adapter metrics
   */
  getMetrics() {
    const ms = Date.now() - this.metrics.startedAt;
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    return {
      uptime: {
        ms,
        formatted: `${hours}h ${minutes % 60}m ${seconds % 60}s`
      },
      totals: {
        requests: this.metrics.requestCount,
        inputTokens: this.metrics.inputTokens,
        outputTokens: this.metrics.outputTokens,
        totalTokens: this.metrics.inputTokens + this.metrics.outputTokens,
        errors: this.metrics.errors
      }
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      startedAt: Date.now(),
      requestCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      errors: 0
    };
  }
}

export default AnthropicAdapter;
