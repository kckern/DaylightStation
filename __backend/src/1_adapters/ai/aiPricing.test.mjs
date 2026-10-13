import { describe, expect, it } from 'vitest';
import { estimateCostUsd, estimateTranscriptionCostUsd, estimateSpeechCostUsd } from './aiPricing.mjs';

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
    expect(estimateCostUsd('claude-sonnet-4', { promptTokens: 1000, completionTokens: 0, cachedTokens: 1000 }))
      .toBeCloseTo(1000 * 3.00 / 1e6, 9);
  });

  it('bills cached prompt tokens at the published cached rate for gpt-4o and gpt-4.1', () => {
    expect(estimateCostUsd('gpt-4o-2024-08-06', { promptTokens: 1_000_000, cachedTokens: 1_000_000 })).toBe(1.25);
    expect(estimateCostUsd('gpt-4.1-2025-04-14', { promptTokens: 1_000_000, cachedTokens: 1_000_000 })).toBe(0.5);
    expect(estimateCostUsd('gpt-4.1-mini', { promptTokens: 1_000_000, cachedTokens: 1_000_000 })).toBe(0.1);
    expect(estimateCostUsd('gpt-4o-mini', { promptTokens: 1_000_000, cachedTokens: 1_000_000 })).toBe(0.075);
  });
});

describe('gpt-5-nano', () => {
  it('prices the dated id at 0.05 in / 0.005 cached / 0.40 out per 1M', () => {
    expect(estimateCostUsd('gpt-5-nano-2025-08-07', { promptTokens: 1_000_000, completionTokens: 1_000_000 })).toBe(0.45);
    expect(estimateCostUsd('gpt-5-nano', { promptTokens: 1_000_000, cachedTokens: 1_000_000 })).toBe(0.005);
    // one card-ladder grading call as the ledger recorded it (252 in, 66 out)
    expect(estimateCostUsd('gpt-5-nano-2025-08-07', { promptTokens: 252, completionTokens: 66, cachedTokens: 0 })).toBeCloseTo((252 * 0.05 + 66 * 0.4) / 1e6, 12);
  });

  it('does not capture the gpt-5.6 family by prefix', () => {
    expect(estimateCostUsd('gpt-5.6-luna', { promptTokens: 1000 })).toBe(0.0002);
  });
});

describe('audio pricing', () => {
  it('bills Whisper per audio minute', () => {
    expect(estimateTranscriptionCostUsd('whisper-1', 60)).toBe(0.006);
    expect(estimateTranscriptionCostUsd('whisper-1', 30)).toBe(0.003);
    expect(estimateTranscriptionCostUsd('whisper-1', 0)).toBe(0);
  });

  it('returns null without a duration or for an unpriced model', () => {
    expect(estimateTranscriptionCostUsd('whisper-1', null)).toBeNull();
    expect(estimateTranscriptionCostUsd('whisper-1', undefined)).toBeNull();
    expect(estimateTranscriptionCostUsd('whisper-9', 60)).toBeNull();
  });

  it('bills speech per million characters, hd at twice the rate', () => {
    expect(estimateSpeechCostUsd('tts-1', 1_000_000)).toBe(15);
    expect(estimateSpeechCostUsd('tts-1-hd', 1_000_000)).toBe(30);
    expect(estimateSpeechCostUsd('tts-1', 200)).toBe(0.003);
    expect(estimateSpeechCostUsd('unknown-voice', 200)).toBeNull();
  });

  it('takes audio rates from the same overrides map', () => {
    expect(estimateTranscriptionCostUsd('whisper-1', 60, { 'whisper-1': { perMinute: 0.01 } })).toBe(0.01);
  });
});
