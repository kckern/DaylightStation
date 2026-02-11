import { describe, it, expect } from 'vitest';
import { formatDuration } from '#rendering/lib/LayoutHelpers.mjs';

describe('formatDuration', () => {
  it('formats minutes and seconds', () => {
    expect(formatDuration(125)).toBe('2m 5s');
  });

  it('formats minutes only when no seconds', () => {
    expect(formatDuration(120)).toBe('2m');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(3720)).toBe('1h 2m');
  });

  it('returns -- for null', () => {
    expect(formatDuration(null)).toBe('--');
  });

  it('returns -- for undefined', () => {
    expect(formatDuration(undefined)).toBe('--');
  });
});
