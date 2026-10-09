import { describe, it, expect } from 'vitest';
import { readRecentlyTitle } from './readRecentlyTitle.js';

describe('readRecentlyTitle', () => {
  it('names the weekday of the last read', () => {
    expect(readRecentlyTitle('2026-10-07', '2026-10-09')).toBe('You read this on Wednesday.');
  });
  it('says earlier today for today', () => {
    expect(readRecentlyTitle('2026-10-09', '2026-10-09')).toBe('You read this earlier today.');
  });
  it('degrades without a date', () => {
    expect(readRecentlyTitle(null, null)).toBe('You read this one lately.');
  });
});
