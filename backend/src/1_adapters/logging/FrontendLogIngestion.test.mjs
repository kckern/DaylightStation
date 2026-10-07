import { beforeEach, describe, expect, it } from 'vitest';
import { __checkIngestRateLimit, __resetIngestRateLimiter } from './FrontendLogIngestion.mjs';

const event = (name) => ({
  ts: '2026-10-07T12:00:00.000-07:00', level: 'info', event: name, data: {},
  context: { app: 'fitness', component: 'skyline-glider', ip: '127.0.0.1', userAgent: 'test' }, tags: [],
});

describe('frontend log ingestion rate policy', () => {
  beforeEach(() => __resetIngestRateLimiter());

  it('gives one-second Skyline samples a bounded 180-event burst budget', () => {
    for (let index = 0; index < 180; index += 1) {
      expect(__checkIngestRateLimit(event('skyline_glider.flight.sample')).allow).toBe(true);
    }
    const limited = __checkIngestRateLimit(event('skyline_glider.flight.sample'));
    expect(limited.allow).toBe(false);
    expect(limited.summary).toMatchObject({
      event: 'log.ingest.throttled', data: { throttledEvent: 'skyline_glider.flight.sample' },
    });
  });

  it('keeps the generic 30-event budget for other frontend logs', () => {
    for (let index = 0; index < 30; index += 1) {
      expect(__checkIngestRateLimit(event('skyline_glider.effect.executed')).allow).toBe(true);
    }
    expect(__checkIngestRateLimit(event('skyline_glider.effect.executed')).allow).toBe(false);
  });
});
