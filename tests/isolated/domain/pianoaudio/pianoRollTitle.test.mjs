import { describe, it, expect } from 'vitest';
import { pianoRollTitleFromRel } from '#domains/pianoaudio/pianoRollTitle.mjs';

describe('pianoRollTitleFromRel', () => {
  it('derives a date/time title from a jamcorder path', () => {
    expect(pianoRollTitleFromRel('jamcorder/2026/2026-07/2026-07-09 07.22.03.mid'))
      .toBe('Thu Jul 9, 2026 · 7:22 AM');
  });

  it('derives a title from a per-user path (date folder + time filename)', () => {
    expect(pianoRollTitleFromRel('kckern/2026-03-03/18.19.09.mid'))
      .toBe('Tue Mar 3, 2026 · 6:19 PM');
  });

  it('formats midnight and noon correctly', () => {
    expect(pianoRollTitleFromRel('u/2026-01-01/00.05.00.mid')).toContain('12:05 AM');
    expect(pianoRollTitleFromRel('u/2026-01-01/12.00.00.mid')).toContain('12:00 PM');
  });

  it('returns empty string when no timestamp is present', () => {
    expect(pianoRollTitleFromRel('nope/whatever.mid')).toBe('');
  });
});
