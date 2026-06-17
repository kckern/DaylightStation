import { describe, it, expect } from 'vitest';
import { resolveAdvance } from '../../../frontend/src/screen-framework/widgets/resolveAdvance.js';

describe('resolveAdvance', () => {
  it('passes explicit triggers through unchanged', () => {
    expect(resolveAdvance({ advance: 'hold' })).toBe('hold');
    expect(resolveAdvance({ advance: 'track', hasMusic: true })).toBe('track');
    expect(resolveAdvance({ advance: 'timer', intervalMs: 5000 })).toBe('timer');
  });

  it('honors an explicit trigger even when it cannot fire (track w/o music stays track)', () => {
    // Explicit means literal: no silent fallback. Use 'auto' to get the fallback chain.
    expect(resolveAdvance({ advance: 'track', hasMusic: false, intervalMs: 5000 })).toBe('track');
    expect(resolveAdvance({ advance: 'timer', intervalMs: 0 })).toBe('timer');
  });

  it('auto → track when music is present (interval ignored)', () => {
    expect(resolveAdvance({ advance: 'auto', hasMusic: true, intervalMs: 5000 })).toBe('track');
    expect(resolveAdvance({ advance: 'auto', hasMusic: true, intervalMs: 0 })).toBe('track');
  });

  it('auto → timer when there is no music but an interval is set', () => {
    expect(resolveAdvance({ advance: 'auto', hasMusic: false, intervalMs: 8000 })).toBe('timer');
  });

  it('auto → hold when there is neither music nor an interval', () => {
    expect(resolveAdvance({ advance: 'auto', hasMusic: false, intervalMs: 0 })).toBe('hold');
  });

  it('defaults to hold for unknown or missing values', () => {
    expect(resolveAdvance({})).toBe('hold');
    expect(resolveAdvance({ advance: 'bogus' })).toBe('hold');
    expect(resolveAdvance()).toBe('hold');
  });
});
