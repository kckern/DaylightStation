import { describe, expect, it } from 'vitest';
import { buildDayGrid, WEEKDAY_LABELS, monthLabel, dayLabel } from './dayGrid.js';

const keys = (rows) => rows.flat().filter(Boolean).map((c) => c.key);

describe('buildDayGrid', () => {
  it('ends on today, starts on a Monday, covers at least 21 days, never shows the future', () => {
    const rows = buildDayGrid('2026-09-02'); // a Wednesday
    const flat = rows.flat().filter(Boolean);
    expect(flat.at(-1).key).toBe('2026-09-02');
    expect(rows[0][0].weekday).toBe(1);
    expect(flat.length).toBeGreaterThanOrEqual(21);
    expect(flat.every((c) => c.key <= '2026-09-02')).toBe(true);
    expect(rows).toHaveLength(4);
    expect(flat[0].key).toBe('2026-08-10');
  });

  it('pads the last row with nulls after today rather than future days', () => {
    const rows = buildDayGrid('2026-09-02');
    expect(rows.at(-1).map((c) => c?.key ?? null)).toEqual(['2026-08-31', '2026-09-01', '2026-09-02', null, null, null, null]);
  });

  it('a row that crosses a month boundary is ONE row, with the month change flagged on the cell', () => {
    const rows = buildDayGrid('2026-09-02');
    const crossing = rows.find((r) => r.some((c) => c?.key === '2026-08-31') && r.some((c) => c?.key === '2026-09-01'));
    expect(crossing).toBeTruthy();
    expect(crossing.find((c) => c?.key === '2026-09-01').monthStart).toBe(true);
    expect(crossing.find((c) => c?.key === '2026-08-31').monthStart).toBe(false);
  });

  it('today on a Sunday is exactly three full rows; today on a Monday adds a one-cell row', () => {
    const sun = buildDayGrid('2026-09-06');
    expect(sun).toHaveLength(3);
    expect(keys(sun)).toHaveLength(21);
    expect(keys(sun)[0]).toBe('2026-08-17');
    const mon = buildDayGrid('2026-09-07');
    expect(mon).toHaveLength(4);
    expect(mon.at(-1).filter(Boolean)).toHaveLength(1);
  });

  it('marks today and carries the day-of-month', () => {
    const today = buildDayGrid('2026-09-02').flat().find((c) => c?.key === '2026-09-02');
    expect(today.isToday).toBe(true);
    expect(today.day).toBe(2);
  });

  it('labels', () => {
    expect(WEEKDAY_LABELS).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(monthLabel('2026-08-31')).toBe('Aug');
    // 2026-08-31 is a Monday (the crossing-row literal above), so the 30th is
    // a Sunday and the 29th the Saturday a child would name.
    expect(dayLabel('2026-08-30')).toBe('Sunday 30 August');
    expect(dayLabel('2026-08-29')).toBe('Saturday 29 August');
  });

  it('refuses a bad key rather than guessing a grid', () => {
    expect(() => buildDayGrid('2026-9-2')).toThrow(/YYYY-MM-DD/);
  });
});
