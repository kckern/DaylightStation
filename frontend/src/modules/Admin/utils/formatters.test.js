import { describe, it, expect } from 'vitest';
import { formatSize, formatDuration, cronToHuman, capitalize } from './formatters.js';

describe('formatSize', () => {
  it.each([
    [null, ''],
    [undefined, ''],
    [0, '0 B'],
    [500, '500 B'],
    [1536, '1.5 KB'],
    [1048576, '1.0 MB'],
    [1073741824, '1.0 GB'],
  ])('formatSize(%s) → %s', (bytes, expected) => {
    expect(formatSize(bytes)).toBe(expected);
  });
});

describe('formatDuration', () => {
  it.each([
    [null, '—'],
    [500, '500ms'],
    [1500, '1s'],
    [65000, '1m 5s'],
  ])('formatDuration(%s) → %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

describe('cronToHuman', () => {
  it.each([
    ['', ''],
    ['*/5 * * * *', 'Every 5 min'],
    ['30 * * * *', 'Hourly at :30'],
    ['0 4 * * *', 'Daily at 4:00 AM'],
    ['15 19 * * 0', 'Daily at 7:15 PM'],
    ['not a cron', 'not a cron'],
  ])('cronToHuman(%s) → %s', (expr, expected) => {
    expect(cronToHuman(expr)).toBe(expected);
  });

  it('tolerates irregular whitespace', () => {
    expect(cronToHuman('  0   4  *  *  * ')).toBe('Daily at 4:00 AM');
  });
});

describe('capitalize', () => {
  it.each([
    ['', ''],
    ['fitness', 'Fitness'],
    ['a', 'A'],
    ['Finance', 'Finance'],
  ])('capitalize(%s) → %s', (str, expected) => {
    expect(capitalize(str)).toBe(expected);
  });
});
