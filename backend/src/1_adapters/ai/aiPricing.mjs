/**
 * AI model pricing — USD per 1M tokens.
 *
 * These defaults drift as providers reprice; treat the integration config as
 * the source of truth (`pricing:` on the openai/anthropic service entry merges
 * over these). An unknown model yields costUsd: null rather than a guess —
 * the tokens are still recorded, so cost can be backfilled once the price is
 * added to config.
 */

const DEFAULT_PRICING = Object.freeze({
  // OpenAI
  'gpt-4.1': { input: 2.00, output: 8.00 },
  'gpt-4.1-mini': { input: 0.40, output: 1.60 },
  'gpt-4.1-nano': { input: 0.10, output: 0.40 },
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
  'text-embedding-3-large': { input: 0.13, output: 0 },
  // Anthropic
  'claude-3-5-sonnet': { input: 3.00, output: 15.00 },
  'claude-3-5-haiku': { input: 0.80, output: 4.00 },
  'claude-haiku-4-5': { input: 1.00, output: 5.00 },
  'claude-sonnet-4': { input: 3.00, output: 15.00 },
  'claude-opus-4': { input: 15.00, output: 75.00 },
});

/**
 * Find the price entry whose key is the longest prefix of the model id, so
 * dated ids like `gpt-4o-2024-08-06` match `gpt-4o` while `gpt-4o-mini-…`
 * still prefers `gpt-4o-mini`.
 */
function priceFor(model, overrides) {
  const table = { ...DEFAULT_PRICING, ...(overrides || {}) };
  if (typeof model !== 'string' || !model) return null;
  if (table[model]) return table[model];
  let best = null;
  for (const [key, price] of Object.entries(table)) {
    if (model.startsWith(key) && (!best || key.length > best.key.length)) {
      best = { key, price };
    }
  }
  return best?.price || null;
}

/**
 * Estimate the USD cost of one API call.
 * @param {string} model - Model id the provider answered with
 * @param {{promptTokens?: number, completionTokens?: number}} usage
 * @param {Object} [overrides] - Per-model {input, output} USD-per-1M overrides
 * @returns {number|null} Cost in USD, or null when the model is unpriced
 */
export function estimateCostUsd(model, usage = {}, overrides = null) {
  const price = priceFor(model, overrides);
  if (!price) return null;
  const promptTokens = Number(usage.promptTokens) || 0;
  const completionTokens = Number(usage.completionTokens) || 0;
  const cost = (promptTokens * (price.input || 0) + completionTokens * (price.output || 0)) / 1_000_000;
  return Math.round(cost * 1e6) / 1e6;
}

export default { estimateCostUsd };
