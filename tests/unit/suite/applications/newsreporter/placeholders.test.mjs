import { describe, it, expect } from '@jest/globals';
import { resolvePlaceholders, toCalendarDate } from '#apps/newsreporter/placeholders.mjs';

const ctx = { referenceDate: new Date('2026-06-21T06:50:00Z'), timezone: 'America/Denver' };

describe('placeholders', () => {
  it('resolves yesterday/today/date', () => {
    // 06:50Z == 00:50 MDT, still the 21st in Denver
    expect(resolvePlaceholders('d={{date}} y={{yesterday}}', ctx))
      .toBe('d=2026-06-21 y=2026-06-20');
  });

  it('treats {{today}} as today', () => {
    expect(resolvePlaceholders('t={{today}}', ctx)).toBe('t=2026-06-21');
  });

  it('deep-walks objects', () => {
    expect(resolvePlaceholders({ url: 'a?d={{yesterday}}' }, ctx))
      .toEqual({ url: 'a?d=2026-06-20' });
  });

  it('deep-walks arrays and nested objects', () => {
    expect(resolvePlaceholders({ items: [{ q: '{{today}}' }, 'x={{date}}'] }, ctx))
      .toEqual({ items: [{ q: '2026-06-21' }, 'x=2026-06-21'] });
  });

  it('toCalendarDate uses the timezone, not local methods', () => {
    // 2026-06-21T03:00:00Z == 2026-06-20 21:00 MDT (previous calendar day)
    expect(toCalendarDate(new Date('2026-06-21T03:00:00Z'), 'America/Denver'))
      .toBe('2026-06-20');
  });

  it('leaves non-string leaves untouched', () => {
    expect(resolvePlaceholders({ n: 5, b: true, s: '{{date}}' }, ctx))
      .toEqual({ n: 5, b: true, s: '2026-06-21' });
  });
});
