import { describe, it, expect } from 'vitest';
import {
  shouldTraceSeekAtDuration,
  captureSeekStack,
  buildSeekTracePayload
} from './seekTrace.js';

describe('shouldTraceSeekAtDuration', () => {
  it('returns true when seek lands at exact duration', () => {
    expect(shouldTraceSeekAtDuration({ currentTime: 441.76, duration: 441.76 })).toBe(true);
  });

  it('returns true at the audit-witnessed boundary (intent === duration === 441.759999)', () => {
    expect(shouldTraceSeekAtDuration({ currentTime: 441.759999, duration: 441.759999 })).toBe(true);
  });

  it('returns true within thresholdSeconds (default 0.5)', () => {
    expect(shouldTraceSeekAtDuration({ currentTime: 441.3, duration: 441.76 })).toBe(true);
    expect(shouldTraceSeekAtDuration({ currentTime: 441.26, duration: 441.76 })).toBe(true);
  });

  it('returns false outside threshold', () => {
    expect(shouldTraceSeekAtDuration({ currentTime: 441.25, duration: 441.76 })).toBe(false);
    expect(shouldTraceSeekAtDuration({ currentTime: 100, duration: 441.76 })).toBe(false);
  });

  it('respects a custom thresholdSeconds', () => {
    expect(shouldTraceSeekAtDuration({ currentTime: 440, duration: 441.76, thresholdSeconds: 2 })).toBe(true);
    expect(shouldTraceSeekAtDuration({ currentTime: 440, duration: 441.76, thresholdSeconds: 0.1 })).toBe(false);
  });

  it('returns false on invalid duration or currentTime', () => {
    expect(shouldTraceSeekAtDuration({ currentTime: 441, duration: 0 })).toBe(false);
    expect(shouldTraceSeekAtDuration({ currentTime: 441, duration: NaN })).toBe(false);
    expect(shouldTraceSeekAtDuration({ currentTime: NaN, duration: 441.76 })).toBe(false);
  });
});

describe('captureSeekStack', () => {
  it('returns a non-empty string starting with Error', () => {
    const stack = captureSeekStack();
    expect(typeof stack).toBe('string');
    expect(stack.length).toBeGreaterThan(0);
    expect(stack).toContain('seek-at-duration-trace');
  });

  it('truncates to a maximum of 1500 characters', () => {
    expect(captureSeekStack().length).toBeLessThanOrEqual(1500);
  });
});

describe('buildSeekTracePayload', () => {
  it('reproduces the audit-witnessed payload shape', () => {
    const payload = buildSeekTracePayload({
      assetId: 'plex:59518',
      mediaEl: {
        currentTime: 441.759999,
        duration: 441.759999,
        paused: true
      },
      stack: 'Error: seek-at-duration-trace\n    at handleSeeking …'
    });
    expect(payload).toEqual({
      mediaKey: 'plex:59518',
      intent: 441.759999,
      duration: 441.759999,
      paused: true,
      seekSource: 'programmatic',
      stack: 'Error: seek-at-duration-trace\n    at handleSeeking …'
    });
  });

  it('preserves a tagged __seekSource when present', () => {
    const payload = buildSeekTracePayload({
      assetId: 'plex:59518',
      mediaEl: { currentTime: 441.7, duration: 441.76, paused: false, __seekSource: 'bump' },
      stack: 'x'
    });
    expect(payload.seekSource).toBe('bump');
  });
});
