import { describe, it, expect } from 'vitest';
import { isWatchComplete } from './watchCompletion.mjs';

describe('isWatchComplete', () => {
  it('finishes a 30-minute item at 90%', () => {
    expect(isWatchComplete({ percent: 90, playhead: 1620, duration: 1800 })).toBe(true);
  });

  it('does not finish below 90% however little is left', () => {
    expect(isWatchComplete({ percent: 89, playhead: 160, duration: 180 })).toBe(false);
  });

  it('leaves anything up to 100 minutes on the old 90% rule', () => {
    expect(isWatchComplete({ percent: 90, playhead: 5400, duration: 6000 })).toBe(true);
  });

  it('does not finish a 4h51m longplay at 94% with 17 minutes left', () => {
    expect(isWatchComplete({ percent: 94, playhead: 16429, duration: 17467 })).toBe(false);
  });

  it('finishes the same longplay once 10 minutes or less remain', () => {
    expect(isWatchComplete({ percent: 97, playhead: 16867, duration: 17467 })).toBe(true);
  });

  it('falls back to percent alone when the duration is unknown', () => {
    expect(isWatchComplete({ percent: 95, playhead: 1000 })).toBe(true);
    expect(isWatchComplete({ percent: 95, playhead: 1000, duration: 0 })).toBe(true);
  });

  it('honours a caller-supplied bar', () => {
    const strict = { minPercent: 95, maxRemainingSec: 300 };
    expect(isWatchComplete({ percent: 96, playhead: 16768, duration: 17467 }, strict)).toBe(false);
    expect(isWatchComplete({ percent: 99, playhead: 17300, duration: 17467 }, strict)).toBe(true);
  });
});
