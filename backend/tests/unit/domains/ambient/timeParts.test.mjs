// backend/tests/unit/domains/ambient/timeParts.test.mjs
import { parseHHMM, resolveNowParts } from '#domains/ambient/timeParts.mjs';

describe('parseHHMM', () => {
  it('parses HH:MM to minutes since midnight', () => {
    expect(parseHHMM('07:00')).toBe(420);
    expect(parseHHMM('00:00')).toBe(0);
    expect(parseHHMM('23:59')).toBe(1439);
  });
  it('returns null for malformed input', () => {
    expect(parseHHMM('7am')).toBeNull();
    expect(parseHHMM('24:00')).toBeNull();
    expect(parseHHMM('07:60')).toBeNull();
    expect(parseHHMM(null)).toBeNull();
  });
});

describe('resolveNowParts', () => {
  it('derives local dateStr, dow and minutes for a timezone', () => {
    // 2026-06-22T14:30:00Z === 07:30 Mon in America/Los_Angeles (PDT, -7)
    const p = resolveNowParts(new Date('2026-06-22T14:30:00Z'), 'America/Los_Angeles');
    expect(p.dateStr).toBe('2026-06-22');
    expect(p.dow).toBe(1);        // Monday
    expect(p.minutes).toBe(450);  // 07:30
  });
});
