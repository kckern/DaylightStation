import { describe, it, expect } from 'vitest';
import { columnTemplateFor, fitScale } from './layoutSizing.js';

describe('columnTemplateFor', () => {
  it('weights a focus panel wider than standard ones', () => {
    expect(columnTemplateFor(['focus', 'standard'])).toBe('2fr 1fr');
  });
  it('gives equal columns to all-standard zones', () => {
    expect(columnTemplateFor(['standard', 'standard', 'standard'])).toBe('1fr 1fr 1fr');
  });
  it('falls back to a single full column when empty', () => {
    expect(columnTemplateFor([])).toBe('1fr');
  });
  it('treats unknown hints as standard weight', () => {
    expect(columnTemplateFor(['mystery', 'focus'])).toBe('1fr 2fr');
  });
});

describe('fitScale', () => {
  it('returns 1 when content already fits', () => {
    expect(fitScale({ width: 100, height: 80 }, { width: 200, height: 200 })).toBe(1);
  });
  it('returns the limiting ratio (<1) when content overflows', () => {
    expect(fitScale({ width: 400, height: 100 }, { width: 200, height: 200 })).toBe(0.5);
  });
  it('returns 1 for any non-positive dimension (nothing to scale)', () => {
    expect(fitScale({ width: 0, height: 0 }, { width: 200, height: 200 })).toBe(1);
    expect(fitScale({ width: 100, height: 100 }, { width: 0, height: 0 })).toBe(1);
  });
});
