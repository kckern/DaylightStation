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

import { IDecisionGateway, isImage } from '#apps/common/ports/IDecisionGateway.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { estimateCostUsd } from './aiPricing.mjs';
import { createScopedView, usageAttribution } from './usageAttribution.mjs';

const TYPESAFE_API_BASE = 'https://api.typesafe.ai/v1';
const DEFAULT_MODEL = 'jev-latest';
const DEFAULT_TIMEOUT_MS = 10000;
// TypeSafe API limits (docs.typesafe.ai/api)
const MAX_CHOICE_OPTIONS = 255;
const MAX_SCORE_LEVELS = 10;
// How many leaders each part of a split choice sends to the final round
const FINALISTS_PER_PART = 3;
const PART_SEPARATOR = '__part';
// Images are a preview feature: multipart upload, opt-in header, 280-1568 px per side
const IMAGE_HEADER = 'TypeSafe-Danger-Zone-Images';
const IMAGE_MIN_SIDE = 280;
const IMAGE_MAX_SIDE = 1568;

/** Methods a scoped view tags, and the index of each one's options argument. */
const SCOPED_METHODS = Object.freeze({ evaluate: 2, callApi: 2 });

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

    // Jev caps a choice at MAX_CHOICE_OPTIONS. A larger option set is split
    // into balanced parts that ride along in the first request; a second
    // request then picks among each part's leaders. Callers never see this.
    const wireQuestions = {};
    const narrowed = new Map(); // question id → part wire ids
    for (const id of ids) {
      const question = questions[id];
      const optionKeys = question?.type === 'choice' ? Object.keys(question.options || {}) : [];
      if (optionKeys.length > MAX_CHOICE_OPTIONS) {
        const parts = splitBalanced(optionKeys, MAX_CHOICE_OPTIONS);
        const partIds = parts.map((keys, i) => `${id}${PART_SEPARATOR}${i}`);
        parts.forEach((keys, i) => {
          wireQuestions[partIds[i]] = toWireQuestion(id, { ...question, options: pick(question.options, keys) });
        });
        narrowed.set(id, partIds);
      } else {
        wireQuestions[id] = toWireQuestion(id, question);
      }
    }

    const model = options.model || this.model;
    const { wireState, assets, files } = extractImages(state);
    const base = assets ? { state: wireState, assets } : { state };
    const callOpts = { timeout: options.timeout, usageTags: options.usageTags, files };
    const first = await this.callApi('/systemone', { model, ...base, questions: wireQuestions }, callOpts);
    const results = [first];
    const wireAnswers = { ...(first.answers || {}) };

    if (narrowed.size) {
      const finals = {};
      for (const [id, partIds] of narrowed) {
        const finalists = partIds.flatMap(partId => leaders(requireAnswer(first, partId), FINALISTS_PER_PART));
        finals[id] = toWireQuestion(id, { ...questions[id], options: pick(questions[id].options, finalists) });
      }
      // Pin the second round to the model that answered the first, so an alias
      // moving between the two calls cannot mix versions in one answer
      const second = await this.callApi('/systemone', { model: first.model || model, ...base, questions: finals }, callOpts);
      results.push(second);
      Object.assign(wireAnswers, second.answers || {});
      this.logger.debug?.('jev.choice.narrowed', {
        questions: [...narrowed.keys()],
        parts: [...narrowed.values()].map(partIds => partIds.length),
        finalists: Object.fromEntries(Object.entries(finals).map(([id, q]) => [id, Object.keys(q.criteria).length]))
      });
    }

    const answers = {};
    for (const id of ids) answers[id] = fromWireAnswer(requireAnswer({ answers: wireAnswers }, id));

    const resultModel = results.at(-1).model || first.model || null;
    this.logger.debug?.('jev.evaluate', {
      model: resultModel,
      questions: ids.length,
      calls: results.length,
      answers: summarizeAnswers(answers)
    });

    return {
      model: resultModel,
      answers,
      usage: {
        inputTokens: sumUsage(results, 'input_tokens'),
        outputTokens: sumUsage(results, 'output_tokens')
      }
    };
  }

  isConfigured() {
    return !!this.apiKey;
  }

  /**
   * A view of this adapter whose calls are attributed to `tags` in the usage
   * ledger. Views nest; later tags win per key. See usageAttribution.mjs.
   * @param {{ app?: string, feature?: string }} tags
   */
  scoped(tags = {}) {
    return createScopedView(this, tags, SCOPED_METHODS);
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
      const files = options.files || null;
      const body = files ? toMultipart(data, files) : data;
      const headers = files
        ? { Authorization: `Bearer ${this.apiKey}`, [IMAGE_HEADER]: 'true' }
        : { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` };
      const response = await this.httpClient.post(url, body, {
        headers,
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
      this.#recordUsage({ endpoint, requestedModel: data.model, result, durationMs: Date.now() - startedAt, usageTags: options.usageTags });
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
      this.#recordUsage({ endpoint, requestedModel: data.model, durationMs: Date.now() - startedAt, error, usageTags: options.usageTags });
      throw error;
    }
  }

  /**
   * Emit one `jev.usage` event and one ledger row per API call. Never throws;
   * observing a call must not break it.
   * @private
   */
  #recordUsage({ endpoint, requestedModel, result = null, durationMs, error = null, usageTags = null }) {
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
        ...(error ? { httpStatus: error.status ?? null, error: error.message } : {}),
        ...usageAttribution(usageTags),
      };
      this.logger.info?.('jev.usage', entry);
      this.usageLedger?.record(entry);
    } catch (recordError) {
      this.logger.warn?.('jev.usage.record-failed', { endpoint, error: recordError.message });
    }
  }
}

// ============ Images ============

/**
 * Pull top-level image values out of an object state. Each becomes an asset
 * reference in the state and a file part in the multipart body.
 * @returns {{ wireState: any, assets: Object|null, files: Array|null }}
 */
function extractImages(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return { wireState: state, assets: null, files: null };
  const entries = Object.entries(state);
  if (!entries.some(([, v]) => isImage(v))) return { wireState: state, assets: null, files: null };
  const wireState = {};
  const assets = {};
  const files = [];
  for (const [key, value] of entries) {
    if (!isImage(value)) { wireState[key] = value; continue; }
    checkImageSize(key, value);
    const part = `img-${files.length}`;
    const ref = `asset-${files.length}-${key}`;
    assets[ref] = { type: 'image', part };
    files.push({ part, data: value.data, mediaType: value.mediaType || 'image/png' });
    wireState[key] = ref;
  }
  return { wireState, assets, files };
}

function checkImageSize(key, img) {
  const dims = (img.width && img.height) ? { width: img.width, height: img.height } : pngSize(img.data);
  if (!dims) return; // not a PNG and no size given: let the API judge
  const { width, height } = dims;
  if (Math.min(width, height) < IMAGE_MIN_SIDE || Math.max(width, height) > IMAGE_MAX_SIDE) {
    throw new InfrastructureError(`Image "${key}" is ${width}x${height}; Jev needs ${IMAGE_MIN_SIDE}-${IMAGE_MAX_SIDE} px per side`, {
      code: 'VALIDATION_ERROR',
      field: `state.${key}`
    });
  }
}

/** Width and height from a PNG's IHDR chunk, or null when the bytes are not a PNG. */
export function pngSize(data) {
  if (!data || data.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47];
  if (!sig.every((b, i) => data[i] === b)) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function toMultipart(data, files) {
  const form = new FormData();
  form.append('request', new Blob([JSON.stringify(data)], { type: 'application/json' }));
  for (const f of files) {
    form.append(f.part, new Blob([f.data], { type: f.mediaType }), `${f.part}.${f.mediaType.split('/')[1] || 'bin'}`);
  }
  return form;
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
      // An ordered rubric cannot be split and recombined; fail loudly instead
      if (question.levels?.length > MAX_SCORE_LEVELS) {
        throw new InfrastructureError(`Jev accepts at most ${MAX_SCORE_LEVELS} score levels ("${id}" has ${question.levels.length})`, {
          code: 'VALIDATION_ERROR',
          field: `questions.${id}.levels`
        });
      }
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

function requireAnswer(result, id) {
  const wire = result.answers?.[id];
  if (!wire) {
    throw new InfrastructureError(`TypeSafe response missing answer for "${id}"`, {
      code: 'EXTERNAL_SERVICE_ERROR',
      service: 'TypeSafe'
    });
  }
  return wire;
}

/** Split keys into the fewest parts of at most `max`, sized as evenly as possible. */
function splitBalanced(keys, max) {
  const partCount = Math.ceil(keys.length / max);
  const size = Math.ceil(keys.length / partCount);
  return Array.from({ length: partCount }, (_, i) => keys.slice(i * size, (i + 1) * size));
}

function pick(options, keys) {
  return Object.fromEntries(keys.map(key => [key, options[key] ?? null]));
}

/** The part's chosen option first, then the next most probable ones. */
function leaders(wireChoice, count) {
  const ranked = Object.entries(wireChoice.probabilities || {})
    .sort(([, a], [, b]) => b - a)
    .map(([key]) => key);
  return [...new Set([wireChoice.choice, ...ranked].filter(Boolean))].slice(0, count);
}

function sumUsage(results, field) {
  const values = results.map(r => r.usage?.[field]).filter(v => v != null);
  return values.length ? values.reduce((a, b) => a + b, 0) : null;
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
