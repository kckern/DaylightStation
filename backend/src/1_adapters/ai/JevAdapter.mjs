/**
 * JevAdapter - TypeSafe AI "System One" model (Jev) implementation
 *
 * Implements IDecisionGateway. Jev returns typed, calibrated answers to
 * questions whose answer space is fixed in advance — no text generation.
 *
 * Translates the port's provider-neutral question kinds to TypeSafe's wire
 * format and back:
 *   yesNo  { criteria: { yes, no } }  ↔ noul   { criteria: { true, false } } → { noul }
 *   choice { options }                ↔ choice { criteria }                 → { choice, confidence, probabilities }
 *   score  { levels }                 ↔ score  { criteria: [] }             → { score, confidence, probabilities: {"0": p, …} }
 *
 * API: POST https://api.typesafe.ai/v1/systemone (Bearer auth).
 * Pricing is per input token; output tokens are free.
 */

import { IDecisionGateway } from '#apps/common/ports/IDecisionGateway.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { estimateCostUsd } from './aiPricing.mjs';

const TYPESAFE_API_BASE = 'https://api.typesafe.ai/v1';
const DEFAULT_MODEL = 'jev-latest';
const DEFAULT_TIMEOUT_MS = 10000;

export class JevAdapter extends IDecisionGateway {
  /**
   * @param {Object} config
   * @param {string} config.apiKey - TypeSafe API key
   * @param {string} [config.model='jev-latest'] - Default model (pin a versioned id once thresholds are tuned)
   * @param {number} [config.timeout=10000] - Request timeout in ms
   * @param {Object} [config.pricing] - Per-model rate overrides for aiPricing
   * @param {Object} deps
   * @param {Object} deps.httpClient - HTTP client (axios-like post)
   * @param {Object} [deps.logger] - Logger instance
   * @param {Object} [deps.aiUsageLedger] - Usage ledger
   */
  constructor(config, deps = {}) {
    super();

    if (!config?.apiKey) {
      throw new InfrastructureError('TypeSafe API key is required', {
        code: 'MISSING_CONFIG',
        field: 'apiKey'
      });
    }
    if (!deps.httpClient) {
      throw new InfrastructureError('JevAdapter requires httpClient', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'httpClient'
      });
    }

    this.apiKey = config.apiKey;
    this.model = config.model || DEFAULT_MODEL;
    this.timeout = config.timeout || DEFAULT_TIMEOUT_MS;
    this.pricing = config.pricing || null;
    this.httpClient = deps.httpClient;
    this.logger = deps.logger || console;
    this.usageLedger = deps.aiUsageLedger || null;

    this.metrics = {
      startedAt: Date.now(),
      requestCount: 0,
      inputTokens: 0,
      errors: 0
    };
  }

  // ============ IDecisionGateway Implementation ============

  /**
   * Evaluate named questions against one state.
   */
  async evaluate(state, questions, options = {}) {
    if (state == null || state === '') {
      throw new InfrastructureError('evaluate() requires a state', { code: 'VALIDATION_ERROR', field: 'state' });
    }
    const ids = Object.keys(questions || {});
    if (!ids.length) {
      throw new InfrastructureError('evaluate() requires at least one question', { code: 'VALIDATION_ERROR', field: 'questions' });
    }

    const wireQuestions = {};
    for (const id of ids) wireQuestions[id] = toWireQuestion(id, questions[id]);

    const result = await this.callApi('/systemone', {
      model: options.model || this.model,
      state,
      questions: wireQuestions
    }, { timeout: options.timeout });

    const answers = {};
    for (const id of ids) {
      const wire = result.answers?.[id];
      if (!wire) {
        throw new InfrastructureError(`TypeSafe response missing answer for "${id}"`, {
          code: 'EXTERNAL_SERVICE_ERROR',
          service: 'TypeSafe'
        });
      }
      answers[id] = fromWireAnswer(wire);
    }

    this.logger.debug?.('jev.evaluate', {
      model: result.model,
      questions: ids.length,
      answers: summarizeAnswers(answers)
    });

    return {
      model: result.model || null,
      answers,
      usage: {
        inputTokens: result.usage?.input_tokens ?? null,
        outputTokens: result.usage?.output_tokens ?? null
      }
    };
  }

  isConfigured() {
    return !!this.apiKey;
  }

  getMetrics() {
    return {
      uptime: Date.now() - this.metrics.startedAt,
      requestCount: this.metrics.requestCount,
      inputTokens: this.metrics.inputTokens,
      errors: this.metrics.errors
    };
  }

  // ============ HTTP ============

  /**
   * Make an API request
   * @private
   */
  async callApi(endpoint, data, options = {}) {
    const url = `${TYPESAFE_API_BASE}${endpoint}`;

    this.logger.debug?.('jev.request', {
      endpoint,
      model: data.model,
      questionCount: Object.keys(data.questions || {}).length
    });

    this.metrics.requestCount++;
    const startedAt = Date.now();

    try {
      // validateStatus keeps axios from throwing on 4xx/5xx, which would
      // discard the API's error body before it can be read and logged
      const response = await this.httpClient.post(url, data, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        timeout: options.timeout || this.timeout,
        validateStatus: () => true
      });

      if (response.status < 200 || response.status >= 300) {
        this.metrics.errors++;
        const body = response.data || {};
        const message = body.error?.message || body.message || body.detail || `TypeSafe API error: ${response.status}`;

        if (response.status === 429) {
          const retryAfter = parseInt(response.headers?.['retry-after'] ?? 60, 10);
          const error = new Error(`Rate limit exceeded. Retry after ${retryAfter}s`);
          error.code = 'RATE_LIMIT';
          error.status = 429;
          error.retryAfter = retryAfter;
          throw error;
        }

        const err = new InfrastructureError(typeof message === 'string' ? message : JSON.stringify(message), {
          code: 'EXTERNAL_SERVICE_ERROR',
          service: 'TypeSafe',
          statusCode: response.status
        });
        err.status = response.status;
        err.apiError = body.error || body.detail || null;
        throw err;
      }

      const result = response.data || {};
      this.metrics.inputTokens += result.usage?.input_tokens || 0;
      this.#recordUsage({ endpoint, requestedModel: data.model, result, durationMs: Date.now() - startedAt });
      return result;
    } catch (error) {
      if (!error.status) this.metrics.errors++;
      this.logger.error?.('jev.error', {
        endpoint,
        model: data.model,
        status: error.status ?? null,
        error: error.message,
        apiError: error.apiError || null
      });
      this.#recordUsage({ endpoint, requestedModel: data.model, durationMs: Date.now() - startedAt, error });
      throw error;
    }
  }

  /**
   * Emit one `jev.usage` event and one ledger row per API call. Never throws;
   * observing a call must not break it.
   * @private
   */
  #recordUsage({ endpoint, requestedModel, result = null, durationMs, error = null }) {
    try {
      const usage = result?.usage || {};
      const model = result?.model || requestedModel || null;
      const promptTokens = usage.input_tokens ?? null;
      const completionTokens = usage.output_tokens ?? null;
      const entry = {
        provider: 'jev',
        endpoint,
        model,
        requestedModel: requestedModel || null,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens != null || completionTokens != null
          ? (promptTokens || 0) + (completionTokens || 0)
          : null,
        costUsd: error ? 0 : estimateCostUsd(model, { promptTokens, completionTokens }, this.pricing),
        durationMs,
        status: error ? 'error' : 'ok',
        ...(error ? { httpStatus: error.status ?? null, error: error.message } : {})
      };
      this.logger.info?.('jev.usage', entry);
      this.usageLedger?.record(entry);
    } catch (recordError) {
      this.logger.warn?.('jev.usage.record-failed', { endpoint, error: recordError.message });
    }
  }
}

// ============ Wire translation ============

function toWireQuestion(id, question) {
  const { type, instructions } = question || {};
  switch (type) {
    case 'yesNo': {
      const wire = { type: 'noul', instructions };
      const { yes, no } = question.criteria || {};
      if (yes != null || no != null) {
        wire.criteria = {};
        if (yes != null) wire.criteria.true = yes;
        if (no != null) wire.criteria.false = no;
      }
      return wire;
    }
    case 'choice':
      return { type: 'choice', instructions, criteria: question.options };
    case 'score':
      return { type: 'score', instructions, criteria: question.levels };
    default:
      throw new InfrastructureError(`Unknown decision question type "${type}" for "${id}"`, {
        code: 'VALIDATION_ERROR',
        field: `questions.${id}.type`
      });
  }
}

function fromWireAnswer(wire) {
  switch (wire.type) {
    case 'noul':
      return { type: 'yesNo', probability: wire.noul };
    case 'choice':
      return {
        type: 'choice',
        choice: wire.choice,
        confidence: wire.confidence,
        probabilities: wire.probabilities || {}
      };
    case 'score': {
      // TypeSafe keys level probabilities by stringified index; the port
      // exposes them as an array in rubric order
      const byIndex = wire.probabilities || {};
      const levelCount = Math.max(
        Object.keys(byIndex).length,
        Object.keys(wire.legend || {}).length
      );
      const probabilities = Array.from({ length: levelCount }, (_, i) => byIndex[String(i)] ?? 0);
      return { type: 'score', score: wire.score, confidence: wire.confidence, probabilities };
    }
    default:
      throw new InfrastructureError(`Unknown TypeSafe answer type "${wire.type}"`, {
        code: 'EXTERNAL_SERVICE_ERROR',
        service: 'TypeSafe'
      });
  }
}

function summarizeAnswers(answers) {
  const summary = {};
  for (const [id, a] of Object.entries(answers)) {
    if (a.type === 'yesNo') summary[id] = a.probability;
    else if (a.type === 'choice') summary[id] = { choice: a.choice, confidence: a.confidence };
    else summary[id] = { score: a.score, confidence: a.confidence };
  }
  return summary;
}

export default JevAdapter;
