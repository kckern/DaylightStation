import { describe, expect, it } from 'vitest';
import { formatFeedPlaybackTime } from './formatTime.js';

describe('formatFeedPlaybackTime', () => {
  it('keeps playback minutes unpadded and seconds padded', () => {
    expect(formatFeedPlaybackTime(5)).toBe('0:05');
    expect(formatFeedPlaybackTime(65)).toBe('1:05');
  });

  it('keeps elapsed time in minutes when playback passes an hour', () => {
    expect(formatFeedPlaybackTime(3600)).toBe('60:00');
  });

  it('shows unavailable and zero positions as 0:00', () => {
    expect(formatFeedPlaybackTime(0)).toBe('0:00');
    expect(formatFeedPlaybackTime(null)).toBe('0:00');
    expect(formatFeedPlaybackTime(Number.NaN)).toBe('0:00');
  });
});
