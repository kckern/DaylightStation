/**
 * OpenAICostSource - Adapter for tracking OpenAI API usage costs
 * @module adapters/cost/openai/OpenAICostSource
 *
 * Tracks costs from OpenAI API usage by calculating costs from token counts
 * using configured rates. Supports real-time cost tracking via callbacks.
 *
 * @example
 * const rateConfig = {
 *   'gpt-4o': { input_tokens: 5.00, output_tokens: 15.00 },
 *   'gpt-4o-mini': { input_tokens: 0.15, output_tokens: 0.60 }
 * };
 *
 * const source = new OpenAICostSource({ rateConfig, logger: console });
 * source.onCost((entry) => costService.ingest(entry));
 *
 * // Called by OpenAI adapter after each API request
 * source.trackUsage(
 *   { model: 'gpt-4o', promptTokens: 1000, completionTokens: 500 },
 *   { householdId: 'default', userId: 'teen', feature: 'assistant' }
 * );
 */

import { CostEntry } from '#domains/cost/entities/CostEntry.mjs';
import { Money } from '#domains/cost/value-objects/Money.mjs';
import { Usage } from '#domains/cost/value-objects/Usage.mjs';
import { CostCategory } from '#domains/cost/value-objects/CostCategory.mjs';
import { Attribution } from '#domains/cost/value-objects/Attribution.mjs';
import { EntryType } from '#domains/cost/value-objects/EntryType.mjs';
import { ICostSource } from '#apps/cost/ports/ICostSource.mjs';

/**
 * OpenAICostSource - Tracks costs from OpenAI API usage
 *
 * Implements ICostSource interface for integration with the cost tracking system.
 * Calculates costs in real-time based on token counts and configured rates.
 *
 * @class OpenAICostSource
 * @extends ICostSource
 */
export class OpenAICostSource extends ICostSource {
  /** @type {Object} Rate configuration by model */
  #rateConfig;

  /** @type {Object} Logger instance */
  #logger;

  /** @type {Function[]} Registered cost callbacks */
  #callbacks;

  /**
   * Create an OpenAICostSource instance
   *
   * @param {Object} config - Configuration object
   * @param {Object} config.rateConfig - Rate configuration by model name
   * @param {Object} config.rateConfig[model] - Rates for a specific model
   * @param {number} config.rateConfig[model].input_tokens - Cost per 1K input tokens
   * @param {number} config.rateConfig[model].output_tokens - Cost per 1K output tokens
   * @param {Object} [config.logger=console] - Logger instance
   * @throws {Error} If rateConfig is not provided
   */
  constructor({ rateConfig, logger = console }) {
    super();

    if (!rateConfig) {
      throw new Error('rateConfig is required');
    }

    this.#rateConfig = rateConfig;
    this.#logger = logger;
    this.#callbacks = [];
  }

  /**
   * Get the unique identifier for this cost source
   *
   * @returns {string} Source identifier ('openai')
   */
  getSourceId() {
    return 'openai';
  }

  /**
   * Get the list of cost categories this source supports
   *
   * @returns {CostCategory[]} Array of supported CostCategory instances
   */
  getSupportedCategories() {
    return [
      CostCategory.fromString('ai/openai/gpt-4o/chat'),
      CostCategory.fromString('ai/openai/gpt-4o-mini/chat'),
      CostCategory.fromString('ai/openai/whisper/transcription')
    ];
  }

  /**
   * Fetch costs from the external source
   *
   * OpenAI does not provide a cost history API, so costs are tracked
   * in real-time only via trackUsage(). This method always returns
   * an empty array.
   *
   * @param {Date} [since] - Only fetch costs after this timestamp (ignored)
   * @returns {Promise<Object[]>} Always returns empty array
   */
  async fetchCosts(since) {
    // OpenAI doesn't provide a cost history API - costs tracked in real-time only
    return [];
  }

  /**
   * Register a callback for real-time cost events
   *
   * The callback will be invoked with a CostEntry whenever trackUsage()
   * successfully creates a new cost entry.
   *
   * @param {Function} callback - Callback function receiving CostEntry
   */
  onCost(callback) {
    this.#callbacks.push(callback);
  }

  /**
   * Track an OpenAI API call
   *
   * Called by OpenAI adapter after each API request. Calculates cost
   * based on token counts and configured rates, creates a CostEntry,
   * and notifies all registered callbacks.
   *
   * @param {Object} usage - Usage data from OpenAI response
   * @param {string} usage.model - Model name (e.g., 'gpt-4o', 'gpt-4o-mini')
   * @param {number} [usage.promptTokens=0] - Number of input/prompt tokens
   * @param {number} [usage.completionTokens=0] - Number of output/completion tokens
   * @param {number} [usage.totalTokens] - Total tokens (defaults to prompt + completion)
   * @param {Object} attribution - Attribution data for the cost
   * @param {string} attribution.householdId - Household identifier (required)
   * @param {string} [attribution.userId] - User identifier
   * @param {string} [attribution.feature] - Feature identifier
   * @returns {CostEntry|undefined} Created CostEntry, or undefined if no rates found
   */
  trackUsage({ model, promptTokens = 0, completionTokens = 0, totalTokens = 0 }, attribution) {
    const rates = this.#rateConfig[model] || this.#rateConfig.default;

    if (!rates) {
      this.#logger.warn?.('cost.openai.no_rate', { model });
      return;
    }

    const inputCost = (promptTokens / 1000) * rates.input_tokens;
    const outputCost = (completionTokens / 1000) * rates.output_tokens;
    const totalCost = inputCost + outputCost;

    const categoryPath = model.includes('whisper')
      ? 'ai/openai/whisper/transcription'
      : `ai/openai/${model}/chat`;

    const entry = new CostEntry({
      id: CostEntry.generateId(),
      occurredAt: new Date(),
      amount: new Money(totalCost),
      category: CostCategory.fromString(categoryPath),
      usage: new Usage(totalTokens || promptTokens + completionTokens, 'tokens'),
      entryType: EntryType.USAGE,
      attribution: new Attribution(attribution),
      metadata: {
        model,
        promptTokens,
        completionTokens
      }
    });

    for (const callback of this.#callbacks) {
      callback(entry);
    }

    return entry;
  }
}

export default OpenAICostSource;
