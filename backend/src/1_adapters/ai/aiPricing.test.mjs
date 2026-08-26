import { describe, expect, it } from 'vitest';
import { estimateCostUsd } from './aiPricing.mjs';

describe('estimateCostUsd', () => {
  it('prices a chess quip at the gpt-5.6-luna short-context rates', () => {
    // The real observed call: 78 prompt + 15 completion.
    // 78 × $0.20/1M + 15 × $1.20/1M = $0.0000156 + $0.000018
    expect(estimateCostUsd('gpt-5.6-luna', { promptTokens: 78, completionTokens: 15 }))
      .toBeCloseTo(0.0000336, 9);
  });

  it('bills cache hits at the cached rate and does not double-count them', () => {
    // 1000 prompt of which 800 cached: 200 × $0.20/1M + 800 × $0.02/1M
    expect(estimateCostUsd('gpt-5.6-luna', { promptTokens: 1000, completionTokens: 0, cachedTokens: 800 }))
      .toBeCloseTo((200 * 0.20 + 800 * 0.02) / 1e6, 9);
    // and a fully-cached prompt costs the cached rate throughout
    expect(estimateCostUsd('gpt-5.6-luna', { promptTokens: 1000, completionTokens: 0, cachedTokens: 1000 }))
      .toBeCloseTo(1000 * 0.02 / 1e6, 9);
  });

  it('charges cache writes on top of the prompt', () => {
    expect(estimateCostUsd('gpt-5.6-terra', { promptTokens: 100, completionTokens: 0, cacheWriteTokens: 1000 }))
      .toBeCloseTo((100 * 2.00 + 1000 * 2.50) / 1e6, 9);
  });

  it('switches to long-context rates once the prompt crosses the threshold', () => {
    const short = estimateCostUsd('gpt-5.6-sol', { promptTokens: 127_999, completionTokens: 1000 });
    const long = estimateCostUsd('gpt-5.6-sol', { promptTokens: 128_000, completionTokens: 1000 });
    expect(short).toBeCloseTo((127_999 * 4.00 + 1000 * 20.00) / 1e6, 9);
    expect(long).toBeCloseTo((128_000 * 8.00 + 1000 * 30.00) / 1e6, 9);
    expect(long).toBeGreaterThan(short);
  });

  it('resolves dated and suffixed model ids by longest prefix', () => {
    expect(estimateCostUsd('gpt-4o-mini-2024-07-18', { promptTokens: 1e6, completionTokens: 0 }))
      .toBeCloseTo(0.15, 9); // gpt-4o-mini, not gpt-4o
    expect(estimateCostUsd('gpt-4o-2024-08-06', { promptTokens: 1e6, completionTokens: 0 }))
      .toBeCloseTo(2.50, 9);
  });

  it('returns null for an unpriced model rather than guessing', () => {
    expect(estimateCostUsd('some-unreleased-model', { promptTokens: 100, completionTokens: 100 })).toBeNull();
    expect(estimateCostUsd(null, { promptTokens: 100 })).toBeNull();
  });

  it('lets config override a published rate', () => {
    expect(estimateCostUsd('gpt-5.6-luna', { promptTokens: 1e6, completionTokens: 0 },
      { 'gpt-5.6-luna': { input: 99, output: 0 } })).toBeCloseTo(99, 9);
  });

  it('ignores a cached count larger than the prompt instead of going negative', () => {
    expect(estimateCostUsd('gpt-5.6-luna', { promptTokens: 10, completionTokens: 0, cachedTokens: 999 }))
      .toBeCloseTo(10 * 0.02 / 1e6, 9);
  });

  it('falls back to the input rate when a model publishes no cached rate', () => {
    expect(estimateCostUsd('gpt-4.1', { promptTokens: 1000, completionTokens: 0, cachedTokens: 1000 }))
      .toBeCloseTo(1000 * 2.00 / 1e6, 9);
  });
});
