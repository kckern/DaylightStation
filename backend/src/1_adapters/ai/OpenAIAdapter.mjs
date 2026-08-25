/**
 * OpenAIAdapter - OpenAI API implementation
 *
 * Implements IAIGateway for OpenAI's API.
 * Supports chat completions, vision, transcription (Whisper), and embeddings.
 */

import { IAIGateway } from '#apps/common/ports/IAIGateway.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { retryTransient } from '#system/utils/retryTransient.mjs';
import { estimateCostUsd } from './aiPricing.mjs';

const OPENAI_API_BASE = 'https://api.openai.com/v1';

/**
 * Model families that reject `max_tokens` in favour of `max_completion_tokens`
 * (the reasoning line, and gpt-5 onward). Matched by prefix so dated ids and
 * variants — `gpt-5.6-luna`, `o3-mini-2025-01-31` — are covered.
 */
const COMPLETION_TOKEN_PREFIXES = ['gpt-5', 'o1', 'o3', 'o4'];

export class OpenAIAdapter extends IAIGateway {
  /**
   * Models learned at runtime to need `max_completion_tokens`, from a 400 that
   * said so. Static so the lesson is shared by every adapter instance in the
   * process and survives a rebuilt gateway.
   */
  static completionTokenModels = new Set();

  /** Which max-tokens parameter name this model expects. */
  static maxTokensParamFor(model) {
    if (typeof model !== 'string') return 'max_tokens';
    if (OpenAIAdapter.completionTokenModels.has(model)) return 'max_completion_tokens';
    return COMPLETION_TOKEN_PREFIXES.some(prefix => model.startsWith(prefix))
      ? 'max_completion_tokens'
      : 'max_tokens';
  }

  /**
   * @param {Object} config
   * @param {string} config.apiKey - OpenAI API key
   * @param {string} [config.model='gpt-4o'] - Default model
   * @param {number} [config.maxTokens=1000] - Default max tokens
   * @param {number} [config.timeout=60000] - Request timeout in ms
   * @param {Object} [deps] - Dependencies
   * @param {Object} [deps.httpClient] - HTTP client (defaults to fetch)
   * @param {Object} [deps.logger] - Logger instance
   */
  constructor(config, deps = {}) {
    super();

    if (!config?.apiKey) {
      throw new InfrastructureError('OpenAI API key is required', {
        code: 'MISSING_CONFIG',
        field: 'apiKey'
      });
    }
    if (!deps.httpClient) {
      throw new InfrastructureError('OpenAIAdapter requires httpClient', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'httpClient'
      });
    }

    this.apiKey = config.apiKey;
    this.model = config.model || 'gpt-4.1';
    this.miniModel = config.miniModel || config.mini_model || 'gpt-4.1-mini';
    this.maxTokens = config.maxTokens || 1000;
    this.timeout = config.timeout || 60000;
    this.pricing = config.pricing || null;
    this.httpClient = deps.httpClient;
    this.logger = deps.logger || console;
    this.usageLedger = deps.aiUsageLedger || null;

    // Metrics
    this.metrics = {
      startedAt: Date.now(),
      requestCount: 0,
      tokenCount: 0,
      errors: 0,
      retryCount: 0
    };
  }

  /**
   * Sleep for specified milliseconds
   * @private
   */
  #sleep(ms) {
    // Allow test override
    if (this._sleepOverride) {
      return this._sleepOverride(ms);
    }
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Expose sleep for testing
   * @private
   */
  _testSleep(ms) {
    return this.#sleep(ms);
  }

  /**
   * Set sleep override for testing
   * @private
   */
  _setSleepOverride(fn) {
    this._sleepOverride = fn;
  }

  /**
   * Check if error is retryable
   * @private
   */
  #isRetryable(error) {
    // Network-level failures
    if (error.cause?.code === 'ECONNRESET') return true;
    if (error.cause?.code === 'ETIMEDOUT') return true;
    if (error.cause?.code === 'ENOTFOUND') return true;
    if (error.message?.includes('fetch failed')) return true;

    // Rate limit
    if (error.code === 'RATE_LIMIT') return true;

    // Server errors (5xx)
    if (error.status >= 500 && error.status < 600) return true;

    return false;
  }

  /**
   * Expose isRetryable for testing
   * @private
   */
  _testIsRetryable(error) {
    return this.#isRetryable(error);
  }

  /**
   * Calculate delay before retry
   * @private
   */
  #calculateDelay(error, attempt, baseDelay) {
    // Use retry-after for rate limits
    if (error.code === 'RATE_LIMIT' && error.retryAfter) {
      return error.retryAfter * 1000;
    }

    // Exponential backoff: baseDelay * 2^(attempt-1)
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);

    // Add jitter ±10%
    const jitter = exponentialDelay * 0.1 * (Math.random() * 2 - 1);

    return Math.floor(exponentialDelay + jitter);
  }

  /**
   * Expose calculateDelay for testing
   * @private
   */
  _testCalculateDelay(error, attempt, baseDelay) {
    return this.#calculateDelay(error, attempt, baseDelay);
  }

  /**
   * Execute function with retry and backoff
   * @private
   */
  async #retryWithBackoff(fn, options = {}) {
    const maxAttempts = options.maxAttempts || 3;
    const baseDelay = options.baseDelay || 1000;
    let totalDelayMs = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await fn();

        // Log recovery if we retried
        if (attempt > 1) {
          this.logger.info?.('openai.retry.recovered', { attempts: attempt, totalDelayMs });
        }

        return result;
      } catch (error) {
        const isRetryable = this.#isRetryable(error);
        const isLastAttempt = attempt === maxAttempts;

        if (!isRetryable || isLastAttempt) {
          throw error;
        }

        const delay = this.#calculateDelay(error, attempt, baseDelay);
        totalDelayMs += delay;

        this.logger.warn?.('openai.retry', {
          attempt,
          maxAttempts,
          delayMs: delay,
          error: error.message,
          errorCode: error.code || error.status
        });

        this.metrics.retryCount++;
        await this.#sleep(delay);
      }
    }
  }

  /**
   * Expose retryWithBackoff for testing
   * @private
   */
  _testRetryWithBackoff(fn, options) {
    return this.#retryWithBackoff(fn, options);
  }

  /**
   * Make an API request
   * @private
   */
  async callApi(endpoint, data, options = {}) {
    const url = `${OPENAI_API_BASE}${endpoint}`;

    this.logger.debug?.('openai.request', {
      endpoint,
      model: data.model,
      messageCount: data.messages?.length
    });

    this.metrics.requestCount++;
    const startedAt = Date.now();

    try {
      const result = await this.#retryWithBackoff(async () => {
        const response = await this._makeRequest(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
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

          const err = new Error(errorData.error?.message || `AI API error: ${response.status}`);
          err.status = response.status;
          err.apiError = errorData.error || null;
          throw err;
        }

        const result = await response.json();

        if (result.usage) {
          this.metrics.tokenCount += result.usage.total_tokens || 0;
        }

        return result;
      });

      this.#recordUsage({ endpoint, requestedModel: data.model, result, durationMs: Date.now() - startedAt });
      return result;
    } catch (error) {
      if (!error.code) {
        this.metrics.errors++;
      }
      this.logger.error?.('openai.error', {
        endpoint,
        model: data.model,
        status: error.status ?? null,
        error: error.message,
        apiError: error.apiError || null,
      });
      this.#recordUsage({ endpoint, requestedModel: data.model, durationMs: Date.now() - startedAt, error });
      throw error;
    }
  }

  /**
   * Emit one `openai.usage` event and one ledger row per API call — the
   * billing trail: which model, tokens in/out, estimated cost, and duration.
   * Never throws; observing a call must not break it.
   * @private
   */
  #recordUsage({ endpoint, requestedModel, result = null, durationMs, error = null }) {
    try {
      const usage = result?.usage || {};
      const model = result?.model || requestedModel || null;
      const promptTokens = usage.prompt_tokens ?? usage.input_tokens ?? null;
      const completionTokens = usage.completion_tokens ?? usage.output_tokens ?? null;
      const entry = {
        provider: 'openai',
        endpoint,
        model,
        requestedModel: requestedModel || null,
        promptTokens,
        completionTokens,
        totalTokens: usage.total_tokens ?? null,
        costUsd: error ? 0 : estimateCostUsd(model, { promptTokens, completionTokens }, this.pricing),
        durationMs,
        status: error ? 'error' : 'ok',
        ...(error ? { httpStatus: error.status ?? null, error: error.message } : {}),
      };
      this.logger.info?.('openai.usage', entry);
      this.usageLedger?.record(entry);
    } catch (recordError) {
      this.logger.warn?.('openai.usage.record-failed', { endpoint, error: recordError.message });
    }
  }

  /**
   * Internal HTTP request method
   * @private
   */
  async _makeRequest(url, options) {
    // Adapt httpClient.post to return fetch-like response
    // This maintains compatibility with existing callApi method
    // validateStatus keeps axios from throwing on 4xx/5xx, which would discard
    // the API's error body before callApi can read and log it
    const response = await this.httpClient.post(
      url,
      JSON.parse(options.body),
      {
        headers: options.headers,
        timeout: options.timeout,
        validateStatus: () => true
      }
    );

    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: () => Promise.resolve(response.data),
      headers: {
        get: (key) => response.headers[key.toLowerCase()]
      }
    };
  }

  /**
   * Call chat completions API
   * @private
   */
  async callCompletions(messages, options = {}) {
    const model = options.model || this.model;
    const data = {
      model,
      messages,
      [OpenAIAdapter.maxTokensParamFor(model)]: options.maxTokens || this.maxTokens
    };

    if (options.temperature !== undefined) {
      data.temperature = options.temperature;
    }

    if (options.reasoningEffort !== undefined) {
      data.reasoning_effort = options.reasoningEffort;
    }

    if (options.jsonMode) {
      data.response_format = { type: 'json_object' };
    }

    try {
      return await this.callApi('/chat/completions', data, options);
    } catch (error) {
      // Newer model families reject `max_tokens` and want
      // `max_completion_tokens`. The prefix list below cannot know every future
      // model, so learn from the rejection and retry once rather than failing a
      // call over a parameter rename.
      if (error?.apiError?.code === 'unsupported_parameter' && error.apiError.param === 'max_tokens') {
        OpenAIAdapter.completionTokenModels.add(model);
        this.logger.warn?.('openai.maxTokensParam.switched', { model, param: 'max_completion_tokens' });
        const { max_tokens: maxTokens, ...rest } = data;
        return this.callApi('/chat/completions', { ...rest, max_completion_tokens: maxTokens }, options);
      }
      throw error;
    }
  }

  // ============ IAIGateway Implementation ============

  /**
   * Send conversation and get text response
   */
  async chat(messages, options = {}) {
    const response = await this.callCompletions(messages, options);
    return response.choices[0].message.content;
  }

  /**
   * Send conversation with image for vision analysis
   */
  async chatWithImage(messages, imageSource, options = {}) {
    const model = options.model || this.model;

    // Convert Buffer to base64 data URI (OpenAI requires URL or data URI, not raw buffers)
    let imageUrl;
    if (Buffer.isBuffer(imageSource)) {
      const base64 = imageSource.toString('base64');
      imageUrl = `data:image/png;base64,${base64}`;
    } else {
      imageUrl = imageSource;
    }

    // Build messages with image in last user message
    const messagesWithImage = messages.map((msg, index) => {
      if (msg.role === 'user' && index === messages.length - 1) {
        return {
          role: 'user',
          content: [
            { type: 'text', text: msg.content },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl,
                detail: options.imageDetail || 'auto'
              }
            }
          ]
        };
      }
      return msg;
    });

    const response = await this.callCompletions(messagesWithImage, { ...options, model });
    return response.choices[0].message.content;
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
   * Extract and parse JSON from response (handles wrapped JSON)
   * @private
   */
  #extractAndParseJSON(response) {
    // Try to extract JSON object from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON object found in response');
    }

    let jsonString = jsonMatch[0];

    // First attempt: direct parse
    try {
      return JSON.parse(jsonString);
    } catch (directError) {
      this.logger.debug?.('openai.json.attemptRepair', {
        error: directError.message,
        position: directError.message.match(/position (\d+)/)?.[1],
      });

      // Second attempt: repair and parse
      try {
        const repaired = this.#repairJSON(jsonString);
        const parsed = JSON.parse(repaired);
        this.logger.info?.('openai.json.repairSucceeded', {
          originalError: directError.message,
        });
        return parsed;
      } catch (repairError) {
        // Both attempts failed
        const error = new Error(`JSON parse failed: ${directError.message}`);
        error.originalError = directError;
        error.repairError = repairError;
        error.sample = jsonString.substring(0, 200);
        throw error;
      }
    }
  }

  /**
   * Get structured JSON response with validation and repair
   * 
   * Uses jsonMode for OpenAI, validates and repairs malformed JSON,
   * retries with explicit instructions on parse failures.
   * 
   * @param {ChatMessage[]} messages - Conversation messages
   * @param {ChatOptions} options - Optional configuration
   * @param {number} [options.maxParseAttempts=2] - Max parse retry attempts
   * @returns {Promise<Object>} - Parsed JSON response
   * @throws {InfrastructureError} If JSON parsing fails after all attempts
   */
  async chatWithJson(messages, options = {}) {
    const maxParseAttempts = options.maxParseAttempts || 2;

    for (let attempt = 1; attempt <= maxParseAttempts; attempt++) {
      const isRetry = attempt > 1;
      const messagesToSend = isRetry
        ? [
            ...messages,
            { role: 'user', content: 'Please respond with valid, complete JSON only. No additional text. Ensure all arrays and objects are properly closed.' }
          ]
        : messages;

      try {
        const response = await this.chat(messagesToSend, { ...options, jsonMode: true });

        // Extract and parse with repair capability
        const parsed = this.#extractAndParseJSON(response);

        if (isRetry) {
          this.logger.info?.('openai.json.parseRecovered', { attempt });
        }

        return parsed;
      } catch (parseError) {
        const isLastAttempt = attempt === maxParseAttempts;

        this.logger.warn?.('openai.json.parseError', {
          attempt,
          maxAttempts: maxParseAttempts,
          error: parseError.message,
          sample: parseError.sample,
        });

        if (isLastAttempt) {
          this.logger.error?.('openai.json.exhausted', {
            attempts: maxParseAttempts,
            originalError: parseError.originalError?.message,
            repairError: parseError.repairError?.message,
          });

          throw new InfrastructureError('Failed to parse JSON response after all attempts', {
            code: 'INVALID_JSON_RESPONSE',
            service: 'OpenAI',
            attempts: maxParseAttempts,
            details: parseError.message,
          });
        }

        // Continue to next attempt
      }
    }
  }

  /**
   * Transcribe audio using Whisper
   */
  async transcribe(audioBuffer, options = {}) {
    const FormData = (await import('form-data')).default;
    const form = new FormData();

    form.append('file', audioBuffer, {
      filename: options.filename || 'audio.ogg',
      contentType: options.contentType || 'audio/ogg'
    });
    form.append('model', 'whisper-1');

    if (options.language) {
      form.append('language', options.language);
    }
    if (options.prompt) {
      form.append('prompt', options.prompt);
    }

    this.logger.debug?.('openai.transcribe.request', {
      size: audioBuffer.length,
      language: options.language
    });

    this.metrics.requestCount++;
    const startedAt = Date.now();

    try {
      const response = await retryTransient(
        () => this._makeFormRequest(
          `${OPENAI_API_BASE}/audio/transcriptions`,
          form
        ),
        {
          maxAttempts: 3,
          baseDelay: 2000,
          onRetry: (attempt, error) => {
            this.metrics.retryCount++;
            this.logger.warn?.('openai.transcribe.retry', {
              attempt,
              error: error.message,
              code: error.code || error.cause?.code,
              audioSize: audioBuffer.length
            });
          }
        }
      );

      this.logger.debug?.('openai.transcribe.response', {
        textLength: response.text?.length
      });

      // Whisper bills per audio minute rather than per token; record the call
      // and payload size so spend can be reconstructed from provider invoices.
      const entry = {
        provider: 'openai',
        endpoint: '/audio/transcriptions',
        model: 'whisper-1',
        requestedModel: 'whisper-1',
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        costUsd: null,
        audioBytes: audioBuffer.length,
        durationMs: Date.now() - startedAt,
        status: 'ok',
      };
      this.logger.info?.('openai.usage', entry);
      this.usageLedger?.record(entry);

      return response.text;
    } catch (error) {
      this.metrics.errors++;
      this.logger.error?.('openai.transcribe.error', { error: error.message });
      this.usageLedger?.record({
        provider: 'openai',
        endpoint: '/audio/transcriptions',
        model: 'whisper-1',
        audioBytes: audioBuffer.length,
        durationMs: Date.now() - startedAt,
        status: 'error',
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Internal form request method
   * @private
   */
  async _makeFormRequest(url, form) {
    const response = await this.httpClient.postForm(url, form, {
      timeout: this.timeout,
      headers: {
        ...form.getHeaders(),
        'Authorization': `Bearer ${this.apiKey}`
      }
    });
    return response.data;
  }

  /**
   * Generate text embedding
   */
  async embed(text) {
    const data = {
      model: 'text-embedding-3-small',
      input: text
    };

    const response = await this.callApi('/embeddings', data);
    return response.data[0].embedding;
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
        tokens: this.metrics.tokenCount,
        errors: this.metrics.errors,
        retries: this.metrics.retryCount
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
      tokenCount: 0,
      errors: 0,
      retryCount: 0
    };
  }
}

export default OpenAIAdapter;
