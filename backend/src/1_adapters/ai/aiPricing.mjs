/**
 * AI model pricing — USD per 1M tokens.
 *
 * Rates drift as providers reprice; the integration config is the override
 * point (`pricing:` on the openai/anthropic service entry merges over these).
 * An unknown model yields costUsd: null rather than a guess — the tokens are
 * still recorded, so cost can be backfilled once the price is added.
 *
 * Entry shape (every field optional except `input`/`output`):
 *   input        uncached prompt tokens
 *   cachedInput  prompt tokens served from cache (much cheaper)
 *   cacheWrite   tokens written into the cache
 *   output       completion tokens
 *   long         same fields at the long-context tier
 *   longThreshold  prompt size at which `long` takes over
 */

/**
 * Prompt size at which the long-context rates apply. 128K is the standard
 * OpenAI boundary; it is NOT stated in the price table this was built from, so
 * treat it as an assumption and override per model (`longThreshold`) if a
 * provider publishes a different one. Every call this codebase makes today is
 * orders of magnitude below it, so the short-context rates are what bill.
 */
const LONG_CONTEXT_THRESHOLD_TOKENS = 128_000;

const DEFAULT_PRICING = Object.freeze({
  // OpenAI — gpt-5.6 family (short-context rates, with the long tier nested)
  'gpt-5.6-sol': {
    input: 4.00, cachedInput: 0.40, cacheWrite: 5.00, output: 20.00,
    long: { input: 8.00, cachedInput: 0.80, cacheWrite: 10.00, output: 30.00 },
  },
  'gpt-5.6-terra': {
    input: 2.00, cachedInput: 0.20, cacheWrite: 2.50, output: 12.00,
    long: { input: 4.00, cachedInput: 0.40, cacheWrite: 5.00, output: 18.00 },
  },
  'gpt-5.6-luna': {
    input: 0.20, cachedInput: 0.02, cacheWrite: 0.25, output: 1.20,
    long: { input: 0.40, cachedInput: 0.04, cacheWrite: 0.50, output: 1.80 },
  },
  // OpenAI — earlier families
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
 *
 * Cached prompt tokens are billed at the cheaper `cachedInput` rate and are
 * counted INSIDE the prompt total by both providers, so they are subtracted
 * from the uncached remainder rather than added on top.
 *
 * @param {string} model - Model id the provider answered with
 * @param {Object} usage
 * @param {number} [usage.promptTokens] - Total prompt tokens (cached included)
 * @param {number} [usage.completionTokens]
 * @param {number} [usage.cachedTokens] - Prompt tokens served from cache
 * @param {number} [usage.cacheWriteTokens] - Tokens written into the cache
 * @param {Object} [overrides] - Per-model rate overrides
 * @returns {number|null} Cost in USD, or null when the model is unpriced
 */
export function estimateCostUsd(model, usage = {}, overrides = null) {
  const entry = priceFor(model, overrides);
  if (!entry) return null;

  const promptTokens = Number(usage.promptTokens) || 0;
  const completionTokens = Number(usage.completionTokens) || 0;
  const cacheWriteTokens = Number(usage.cacheWriteTokens) || 0;
  // Cached tokens are a subset of the prompt; never let a bad value push the
  // uncached remainder negative.
  const cachedTokens = Math.min(Number(usage.cachedTokens) || 0, promptTokens);

  const threshold = entry.longThreshold || LONG_CONTEXT_THRESHOLD_TOKENS;
  const rates = (entry.long && promptTokens >= threshold) ? { ...entry, ...entry.long } : entry;

  const uncachedPrompt = promptTokens - cachedTokens;
  // A model with no published cached rate bills cache hits as ordinary input.
  const cachedRate = rates.cachedInput ?? rates.input ?? 0;
  const cost = (
    uncachedPrompt * (rates.input || 0)
    + cachedTokens * cachedRate
    + cacheWriteTokens * (rates.cacheWrite || 0)
    + completionTokens * (rates.output || 0)
  ) / 1_000_000;

  // Nanodollar precision: a quip costs ~3e-5 USD, and rounding each call to
  // microdollars would bias a month of them.
  return Math.round(cost * 1e9) / 1e9;
}

export default { estimateCostUsd };
